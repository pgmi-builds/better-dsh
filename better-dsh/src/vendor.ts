/**
 * Zero-dependency vendor provisioner for runtime packages.
 *
 * The plugin declares no npm runtime dependencies: anything that cannot be
 * inlined at build time is fetched by THIS code into a plugin-owned directory,
 * from the public registry, with its integrity checked and its dependency
 * closure resolved here. Nothing shells out to npm/pnpm/npx.
 *
 * Why: a declared dependency is installed inside the *consumer's* install
 * transaction — shared with every other plugin in the profile — so one heavy
 * or unreachable package (the observed case: an 86 MB foreign-platform Bun
 * binary pulled in by another plugin) blocks installing this one. A vendored
 * package is fetched on our own schedule, in our own process, and a failure
 * only disables the component that needed it.
 *
 * Layout — a flat npm-shaped tree so Node's own resolver walks transitive
 * dependencies:
 *
 *     <vendorRoot>/node_modules/<name>/…
 *     <vendorRoot>/package.json          (marker + provenance)
 *
 * Every entry point is fail-open by contract: callers treat a rejection as
 * "this component is unavailable" and keep loading.
 * @module dashr/vendor
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, posix } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { PACKAGE_ROOT } from './kernel-env.ts'

/**
 * Plugin-owned vendor root: `<packageRoot>/.vendor`, beside the managed kernel
 * venv. Both live inside the installed package, so nothing is shared with any
 * other plugin in the profile and a reinstall re-provisions on demand.
 */
export const VENDOR_ROOT = join(PACKAGE_ROOT, '.vendor')

/** One package to make available locally. */
export interface VendorRequest {
  /** npm package name, e.g. `puppeteer-core`. */
  name: string
  /** Exact version; ranges are the caller's problem (pins live in code). */
  version: string
  /** Registry base URL; defaults to the public registry. */
  registry?: string
}

/** What the provisioner resolved and wrote. */
export interface VendorResult {
  /** Absolute directory of the installed package. */
  dir: string
  /** Node-resolvable entry file for `import()`. */
  entry: string
  /** True when the tree was already present and untouched. */
  reused: boolean
}

/** Registry metadata subset this module needs. */
interface PackumentVersion {
  dist?: { tarball?: string, integrity?: string, shasum?: string }
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  os?: string[]
  cpu?: string[]
  libc?: string[]
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const DOWNLOAD_TIMEOUT_MS = 120_000
const MARKER = 'package.json'

/** The host's platform tags, in npm's vocabulary. */
function hostTags(): { os: string, cpu: string, libc?: string } {
  const os = process.platform
  const cpu = process.arch
  const libc = os === 'linux' ? (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime !== undefined ? 'glibc' : 'musl' : undefined
  return libc === undefined ? { os, cpu } : { os, cpu, libc }
}

/** Whether a manifest's `os`/`cpu`/`libc` accept this host. */
function installable(manifest: { os?: string[], cpu?: string[], libc?: string[] }): boolean {
  const host = hostTags()
  const check = (values: string[] | undefined, actual: string | undefined): boolean => {
    if (values === undefined || values.length === 0 || actual === undefined) return true
    const positive = values.filter(value => !value.startsWith('!'))
    const negative = values.filter(value => value.startsWith('!')).map(value => value.slice(1))
    if (negative.includes(actual)) return false
    return positive.length === 0 || positive.includes(actual)
  }
  return check(manifest.os, host.os) && check(manifest.cpu, host.cpu) && check(manifest.libc, host.libc)
}

/** Read one package's metadata (an exact version) from the registry. */
async function fetchVersion(request: VendorRequest): Promise<PackumentVersion> {
  const registry = request.registry ?? DEFAULT_REGISTRY
  const url = `${registry.replace(/\/$/, '')}/${request.name.replace('/', '%2f')}`
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`vendor: ${request.name}: registry answered ${String(response.status)}`)
  const packument = await response.json() as { versions?: Record<string, PackumentVersion> }
  const version = packument.versions?.[request.version]
  if (version === undefined) throw new Error(`vendor: ${request.name}@${request.version} is not published`)
  return version
}

/** Download one tarball and check its advertised integrity. */
async function downloadTarball(name: string, version: PackumentVersion): Promise<Buffer> {
  const url = version.dist?.tarball
  if (url === undefined) throw new Error(`vendor: ${name}: registry gave no tarball URL`)
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`vendor: ${name}: tarball answered ${String(response.status)}`)
  const body = Buffer.from(await response.arrayBuffer())
  const integrity = version.dist?.integrity
  if (integrity !== undefined && integrity.startsWith('sha512-')) {
    const actual = createHash('sha512').update(body).digest('base64')
    if (actual !== integrity.slice('sha512-'.length)) throw new Error(`vendor: ${name}: integrity mismatch`)
  } else if (version.dist?.shasum !== undefined) {
    const actual = createHash('sha1').update(body).digest('hex')
    if (actual !== version.dist.shasum) throw new Error(`vendor: ${name}: shasum mismatch`)
  }
  return body
}

/**
 * Extract an npm tarball (gzip + tar, `package/` prefix) into `dest`.
 * Supports the ustar header plus the `x`/`g` pax records npm emits for long
 * paths — the only extensions the registry actually produces here.
 */
function extractTarball(body: Buffer, dest: string): Promise<void> {
  const tar = gunzipSync(body)
  const writes: Promise<void>[] = []
  let offset = 0
  let paxPath: string | undefined
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    offset += 512
    if (header.every(byte => byte === 0)) break
    const readString = (start: number, length: number): string =>
      header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '')
    const sizeField = readString(124, 12).trim()
    const size = sizeField === '' ? 0 : parseInt(sizeField, 8)
    const typeflag = readString(156, 1)
    const body2 = tar.subarray(offset, offset + size)
    offset += Math.ceil(size / 512) * 512
    const prefix = readString(345, 155)
    let name = prefix === '' ? readString(0, 100) : `${prefix}/${readString(0, 100)}`

    if (typeflag === 'x' || typeflag === 'g') {
      const record = body2.toString('utf8')
      const match = /(?:^|\n)\d+ path=([^\n]+)\n/.exec(record)
      if (match?.[1] !== undefined) paxPath = match[1]
      continue
    }
    if (paxPath !== undefined) { name = paxPath; paxPath = undefined }
    if (!name.startsWith('package/')) continue
    const relative = posix.normalize(name.slice('package/'.length))
    if (relative.startsWith('..') || posix.isAbsolute(relative)) continue
    const target = join(dest, relative)
    if (typeflag === '5') {
      writes.push(mkdir(target, { recursive: true }).then(() => undefined))
    } else if (typeflag === '0' || typeflag === '' || typeflag === '7') {
      writes.push((async () => {
        await mkdir(dirname(target), { recursive: true })
        // npm's `bin` entries arrive as 0755; everything else 0644.
        await writeFile(target, body2, { mode: (parseInt(readString(100, 8).trim() || '644', 8) & 0o777) || 0o644 })
      })())
    }
  }
  return Promise.all(writes).then(() => undefined)
}

/** Provision one package (and, recursively, its runtime closure).
 * @param request - package name and exact version.
 * @param vendorRoot - tree root; `<vendorRoot>/node_modules/<name>` is the target.
 * @param log - optional progress sink.
 * @returns Directory, resolvable entry, and whether the tree was reused.
 */
export async function ensureVendored(
  request: VendorRequest, vendorRoot: string, log?: (message: string) => void,
): Promise<VendorResult> {
  const modules = join(vendorRoot, 'node_modules')
  const dest = join(modules, request.name)
  const entryFrom = createRequire(join(vendorRoot, 'anchor.cjs'))

  if (existsSync(join(dest, MARKER))) {
    return { dir: dest, entry: entryFrom.resolve(request.name), reused: true }
  }

  const version = await fetchVersion(request)
  if (!installable(version)) throw new Error(`vendor: ${request.name}@${request.version} does not support ${process.platform}/${process.arch}`)
  log?.(`vendor: fetching ${request.name}@${request.version}`)
  const tarball = await downloadTarball(request.name, version)

  await mkdir(modules, { recursive: true })
  const staging = `${dest}.staging-${process.pid.toString()}`
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging, { recursive: true })
  try {
    await extractTarball(tarball, staging)
    await rm(dest, { recursive: true, force: true })
    await rename(staging, dest)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
  await writeFile(join(vendorRoot, MARKER), `${JSON.stringify({ provisionedBy: 'better-dsh/vendor', at: new Date().toISOString() }, undefined, 2)}\n`)

  for (const [name, range] of Object.entries(version.dependencies ?? {})) {
    await ensureVendored({ name, version: await resolveRange(name, range, request.registry), registry: request.registry }, vendorRoot, log)
  }
  for (const [name, range] of Object.entries(version.optionalDependencies ?? {})) {
    try {
      const resolved = await resolveRange(name, range, request.registry)
      const optional = await fetchVersion({ name, version: resolved, registry: request.registry })
      if (!installable(optional)) continue
      await ensureVendored({ name, version: resolved, registry: request.registry }, vendorRoot, log)
    } catch {
      // An optional dependency that will not provision is not a failure.
    }
  }
  return { dir: dest, entry: entryFrom.resolve(request.name), reused: false }
}

/**
 * Resolve a semver range against the registry.
 * Deliberately minimal — the manifest pins exact versions for everything this
 * module is asked to fetch today, so this only has to handle the ranges those
 * pinned dependencies declare (exact, caret, tilde, and `*`).
 * @param name - package name.
 * @param range - declared range.
 * @param registry - registry base URL.
 * @returns The highest published version satisfying the range.
 */
export async function resolveRange(name: string, range: string, registry?: string): Promise<string> {
  const trimmed = range.trim()
  if (/^\d+\.\d+\.\d+/.test(trimmed)) return trimmed.replace(/^[=v]/, '')
  const url = `${(registry ?? DEFAULT_REGISTRY).replace(/\/$/, '')}/${name.replace('/', '%2f')}`
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`vendor: ${name}: registry answered ${String(response.status)}`)
  const packument = await response.json() as { versions?: Record<string, unknown> }
  const versions = Object.keys(packument.versions ?? {}).filter(candidate => /^\d+\.\d+\.\d+$/.test(candidate))
  const matches = versions.filter(candidate => satisfies(candidate, trimmed))
  if (matches.length === 0) throw new Error(`vendor: no published version of ${name} satisfies ${range}`)
  return matches.sort(compareVersions).at(-1) as string
}

/** Minimal semver comparator (release precedence only; no prereleases needed). */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/** Whether `version` satisfies the caret/tilde/exact/`*` range forms. */
function satisfies(version: string, range: string): boolean {
  if (range === '' || range === '*' || range === 'latest') return true
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number)
  const caret = /^\^(\d+)\.(\d+)\.(\d+)/.exec(range)
  if (caret !== null) {
    const [wantMajor, wantMinor, wantPatch] = [Number(caret[1]), Number(caret[2]), Number(caret[3])]
    if (major !== wantMajor) return false
    if (wantMajor > 0) return true
    if (minor !== wantMinor) return false
    return wantMinor > 0 || patch >= wantPatch
  }
  const tilde = /^~(\d+)\.(\d+)\.(\d+)/.exec(range)
  if (tilde !== null) {
    return major === Number(tilde[1]) && minor === Number(tilde[2]) && patch >= Number(tilde[3])
  }
  return version === range
}

/** Read a provisioned package's manifest without loading its code. */
export async function readVendoredManifest(dir: string): Promise<{ name?: string, version?: string }> {
  return JSON.parse(await readFile(join(dir, MARKER), 'utf8')) as { name?: string, version?: string }
}

/**
 * Language-server registry + resolution for the vendored `dvc://lsp` device.
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/lsp/defaults.json
 * + config.ts + servers.ts, MIT — see ../LICENSE-OMP.md): the full upstream
 * registry is shipped verbatim as `defaults.json`, and the resolution paths are
 * ported thin — file-type → server selection (type-checkers preferred over
 * `isLinter` servers), root-marker workspace discovery (upstream
 * `hasRootMarkers`/`hasRootMarkerAncestor` with one-level glob markers), and
 * executable probing (`node_modules/.bin` + every `$PATH` dir with an X_OK
 * check; upstream `resolveCommand`). NOT vendored: user config overrides/
 * marketplace sources (`~/.config/…` loading), custom linter clients, the
 * warmup/`splitServers` fan-out machinery.
 */

import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import * as path from 'node:path'

import defaultsJson from './defaults.json' with { type: 'json' }
import type { ServerConfig } from './lsp-types.ts'

/** The verbatim upstream registry (54 servers), keyed by server name. */
const REGISTRY = defaultsJson as Record<string, ServerConfig>

/** Server names in registry (insertion) order — deterministic selection. */
const REGISTRY_NAMES = Object.keys(REGISTRY)

/** Cache resolved-command probes: command → absolute path or null (missing). */
const commandProbeCache = new Map<string, string | null>()

/**
 * Find servers whose `fileTypes` cover `filePath` (upstream getServersForFile,
 * extension match plus the basename entries defaults.json uses for Dockerfiles).
 */
export function serversForFile(filePath: string): Array<[string, ServerConfig]> {
  const lower = filePath.toLowerCase()
  const baseName = path.posix.basename(lower.replaceAll('\\', '/'))
  const extension = path.extname(lower)
  const matches: Array<[string, ServerConfig]> = []
  for (const name of REGISTRY_NAMES) {
    const config = REGISTRY[name]
    if (config === undefined) continue
    const hit = config.fileTypes.some(
      fileType => fileType === extension || (fileType !== '' && !fileType.startsWith('.') && fileType === baseName),
    )
    if (hit) matches.push([name, config])
  }
  return matches
}

/**
 * The primary server for a file: first non-linter match in registry order,
 * falling back to the first linter (upstream getServerForFile preference —
 * type intelligence over linting).
 */
export function primaryServerForFile(filePath: string): [string, ServerConfig] | null {
  const matches = serversForFile(filePath)
  return matches.find(([, config]) => config.isLinter !== true) ?? matches[0] ?? null
}

/** Look up a named registry entry (device `server` arg). */
export function serverByName(name: string): ServerConfig | undefined {
  return REGISTRY[name]
}

/** All registry names, for roster/error messages. */
export function registryNames(): string[] {
  return [...REGISTRY_NAMES]
}

// =============================================================================
// Root-marker workspace discovery (upstream config.ts)
// =============================================================================

/** One-level wildcard marker match: `*` crosses everything but `/` (upstream glob markers). */
function markerMatchesEntry(marker: string, entry: string): boolean {
  const star = marker.indexOf('*')
  if (star === -1) return marker === entry
  const prefix = marker.slice(0, star)
  const suffix = marker.slice(star + 1)
  return (
    entry.length >= prefix.length + suffix.length &&
    entry.startsWith(prefix) &&
    entry.endsWith(suffix) &&
    !entry.slice(prefix.length, entry.length - suffix.length).includes('/')
  )
}

/** Whether any root marker exists directly in `dir` (upstream hasRootMarkers). */
function hasRootMarkers(dir: string, markers: string[]): boolean {
  let entries: string[] | null = null
  for (const marker of markers) {
    if (marker.includes('*')) {
      if (entries === null) {
        try {
          entries = readdirSync(dir)
        } catch {
          return false
        }
      }
      if (entries.some(entry => markerMatchesEntry(marker, entry))) return true
      continue
    }
    if (existsSync(path.join(dir, marker))) return true
  }
  return false
}

/**
 * Nearest ancestor of `filePath` holding a root marker, stopping at the
 * filesystem root; `null` when no ancestor matches (upstream
 * hasRootMarkerAncestor walk, returning the dir instead of a boolean).
 */
export function findWorkspaceRoot(filePath: string, markers: string[]): string | null {
  if (markers.length === 0) return null
  let dir = path.dirname(path.resolve(filePath))
  for (;;) {
    if (hasRootMarkers(dir, markers)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

// =============================================================================
// Executable probe (upstream resolveCommand: local .bin first, then $PATH)
// =============================================================================

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve `command` to an absolute executable: the project's
 * `node_modules/.bin`, then every `$PATH` directory (upstream
 * resolveCommandFromLocalRoot + PATH scan). Absolute overrides (device
 * `command` args, fake-server fixtures) are probed directly. Result cached
 * per command; returns `null` when the binary is missing.
 */
export function resolveCommandPath(command: string, cwd: string): string | null {
  const cacheKey = `${command}\0${cwd}`
  const cached = commandProbeCache.get(cacheKey)
  if (cached !== undefined) return cached

  const candidates: string[] = path.isAbsolute(command)
    ? [command]
    : [path.join(cwd, 'node_modules', '.bin', command), ...(process.env.PATH ?? '').split(path.delimiter)
        .filter(dir => dir !== '')
        .map(dir => path.join(dir, command))]

  const resolved = candidates.find(candidate => isExecutableFile(candidate)) ?? null
  commandProbeCache.set(cacheKey, resolved)
  return resolved
}


// =============================================================================
// Install hints (device-side; upstream reports the bare command name)
// =============================================================================
/** Per-command install hints for the common servers (device-side aid; upstream only names the command). */
const INSTALL_HINTS: Record<string, string> = {
  'typescript-language-server': 'npm install -g typescript-language-server typescript',
  'vscode-eslint-language-server': 'npm install -g vscode-languageserver-types eslint vscode-eslint-language-server',
  'pyright-langserver': 'npm install -g pyright',
  pylsp: 'pip install "python-lsp-server[all]"',
  gopls: 'go install golang.org/x/tools/gopls@latest',
  'rust-analyzer': 'rustup component add rust-analyzer',
  clangd: 'apt install clangd (or brew install llvm)',
  biome: 'npm install -g @biomejs/biome',
  ruff: 'pip install ruff',
  'bash-language-server': 'npm install -g bash-language-server',
  'lua-language-server': 'install from https://github.com/LuaLS/lua-language-server/releases',
  marksman: 'install from https://github.com/artempyanykh/marksman/releases',
}

/** Install hint for a missing server binary; generic fallback otherwise. */
export function installHintFor(command: string): string {
  const hint = INSTALL_HINTS[command]
  if (hint !== undefined) return hint
  return `install the "${command}" language server and make sure it is on $PATH`
}

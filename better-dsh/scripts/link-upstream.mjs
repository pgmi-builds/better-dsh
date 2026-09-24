#!/usr/bin/env node
/**
 * Link the @deepseek-ai/* development namespace at a target node_modules to
 * the upstream checkout's PHYSICAL packages (source of truth for both dev-time
 * types and the test instance's runtime resolution layer).
 *
 * One generator serves both farms:
 *   - better-dsh's own node_modules (dev typecheck / vitest / tsdown dts)
 *   - .test/home/<rig>/profiles/node_modules (the prod-shaped ③ layer the
 *     profile-level plugin resolves its optional peers through)
 *
 * The symlink targets are DIRECTORIES, not versions: when upstream moves to a
 * new tag and rebuilds, every farm follows with zero package.json edits. The
 * version-range symbols live in peerDependencies (publishing contract); this
 * script is the only runtime truth for where dev types come from.
 *
 * NOTE: a later `npm install` may reclaim entries it owns (real deps like
 * schemastery); re-run this script afterwards to restore the farm.
 *
 * Usage:
 *   node scripts/link-upstream.mjs [--target <node_modules-dir>] [--upstream <checkout-dir>]
 * Defaults: target = ./node_modules, upstream = <repo>/upstream/deepseek-harness
 */
import { readFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, rmSync, lstatSync, readlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const read = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] !== undefined ? resolve(args[i + 1]) : fallback
}
const target = read('--target', resolve(here, '..', 'node_modules'))
const upstream = read('--upstream', resolve(here, '..', '..', 'upstream', 'deepseek-harness'))

if (!existsSync(join(upstream, 'pnpm-workspace.yaml'))) {
  console.error(`link-upstream: ${upstream} is not a harness checkout (no pnpm-workspace.yaml)`)
  process.exit(1)
}

/** Collect name -> physical dir for every workspace package (packages, vendor, apps trees). */
const packages = new Map()
const consider = (dir) => {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return
  try {
    const { name } = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof name === 'string' && name.startsWith('@deepseek-ai/')) packages.set(name, dir)
  } catch { /* unreadable manifest: skip */ }
}
for (const group of readdirSync(join(upstream, 'packages'), { withFileTypes: true })) {
  if (!group.isDirectory()) continue
  const groupDir = join(upstream, 'packages', group.name)
  for (const pkg of readdirSync(groupDir, { withFileTypes: true })) {
    if (pkg.isDirectory()) consider(join(groupDir, pkg.name))
  }
}
for (const area of ['vendor', 'apps']) {
  const areaDir = join(upstream, area)
  if (!existsSync(areaDir)) continue
  for (const pkg of readdirSync(areaDir, { withFileTypes: true })) {
    if (pkg.isDirectory()) consider(join(areaDir, pkg.name))
  }
}

if (packages.size === 0) {
  console.error('link-upstream: no workspace packages found — wrong checkout?')
  process.exit(1)
}

let created = 0
let kept = 0
for (const [name, dir] of packages) {
  const link = join(target, name)
  mkdirSync(dirname(link), { recursive: true })
  try {
    const st = lstatSync(link)
    if (st.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === resolve(dir)) {
      kept++
      continue
    }
    rmSync(link, { recursive: true, force: true })
  } catch { /* absent: create below */ }
  symlinkSync(resolve(dir), link, 'dir')
  created++
}
console.log(`link-upstream: ${created} linked, ${kept} already current, ${packages.size} total -> ${upstream}`)

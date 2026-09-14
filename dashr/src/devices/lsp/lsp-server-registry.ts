/**
 * Language-server registry + resolution for the vendored `dvc://lsp` device.
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent/src/lsp/defaults.json
 * + config.ts + servers.ts, MIT — see ../NOTICE-OMP.md): the full upstream
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
 * Clear cached negative probes for a command (after a successful install) so
 * availability is re-probed instead of failing forever until restart.
 */
export function clearCommandProbeCache(command?: string): void {
  if (command === undefined) {
    commandProbeCache.clear()
    return
  }
  for (const key of [...commandProbeCache.keys()]) {
    if (key.startsWith(`${command}\0`) && commandProbeCache.get(key) === null) commandProbeCache.delete(key)
  }
}

/**
 * The primary server for a file: first AVAILABLE non-linter match in
 * registry order (availability = its binary resolves), falling back to the
 * first available linter, and only then to the preference-order pick
 * (upstream filters by availability before routing — the vendored port was
 * availability-blind and bound .ts to a missing typescript-language-server
 * even when other covering servers were installed).
 */
export function primaryServerForFile(filePath: string): [string, ServerConfig] | null {
  const matches = serversForFile(filePath)
  if (matches.length === 0) return null
  const cwd = path.dirname(filePath)
  // Availability-first: first non-linter match whose binary resolves, then
  // the first available linter; only when NOTHING is installed do we return
  // the preference-order pick (so the structured LSP_SERVER_MISSING names
  // the server the user actually wants to install).
  const preferred = matches.find(([, config]) => config.isLinter !== true) ?? matches[0]!
  for (const match of matches) {
    if (match[1].isLinter === true && match[0] !== preferred[0]) continue
    if (resolveCommandPath(match[1].command, cwd) !== null) return match
  }
  return preferred
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
    : [
        path.join(cwd, 'node_modules', '.bin', command),
        // User-local install targets (npm prefix ~/.local, cargo, go) are
        // commonly missing from a daemon's scrubbed PATH — probe them
        // explicitly (2026-09-15: npm -g installed to ~/.local/bin which the
        // service PATH never contained).
        ...(process.env.HOME !== undefined ? [path.join(process.env.HOME, '.local', 'bin', command), path.join(process.env.HOME, '.cargo', 'bin', command), path.join(process.env.HOME, 'go', 'bin', command)] : []),
        ...(process.env.PATH ?? '').split(path.delimiter)
          .filter(dir => dir !== '')
          .map(dir => path.join(dir, command)),
      ]

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

/** Real installer commands (stage 5): only package-manager installables. */
const INSTALL_COMMANDS: Record<string, string[]> = {
  'typescript-language-server': ['npm', 'install', '-g', 'typescript-language-server', 'typescript'],
  'pyright-langserver': ['npm', 'install', '-g', 'pyright'],
  pylsp: ['pip', 'install', 'python-lsp-server[all]'],
  ruff: ['pip', 'install', 'ruff'],
  gopls: ['go', 'install', 'golang.org/x/tools/gopls@latest'],
  'rust-analyzer': ['rustup', 'component', 'add', 'rust-analyzer'],
  biome: ['npm', 'install', '-g', '@biomejs/biome'],
  'bash-language-server': ['npm', 'install', '-g', 'bash-language-server'],
}

/** The installer command for a server binary, when one is automatable. */
export function installCommandFor(command: string): string[] | undefined {
  return INSTALL_COMMANDS[command]
}

/**
 * Run the server's package-manager install, fail-soft (stage 5). A missing
 * installer tool or a non-zero exit resolves false — never throws; the
 * caller keeps its structured LSP_SERVER_MISSING path either way.
 */
export async function installServer(command: string, timeoutMs = 300_000): Promise<boolean> {
  const argv = INSTALL_COMMANDS[command]
  if (argv === undefined) return false
  try {
    const { execFile } = await import('node:child_process')
    return await new Promise<boolean>((resolve) => {
      execFile(argv[0] ?? command, argv.slice(1), { timeout: timeoutMs }, (error) => resolve(error === null || error === undefined))
    })
  } catch {
    return false
  }
}

/** Install hint for a missing server binary; generic fallback otherwise. */
export function installHintFor(command: string): string {
  const hint = INSTALL_HINTS[command]
  if (hint !== undefined) return hint
  return `install the "${command}" language server and make sure it is on $PATH`
}

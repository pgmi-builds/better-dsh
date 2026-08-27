/**
 * `dvc://browser` device — single-tab headless-Chrome adapter (Wave2).
 *
 * Vendored from `upstream/oh-my-pi` (packages/coding-agent, MIT — see
 * ../LICENSE-OMP.md), rewritten thin. The `open`/`run`/`close` action contract
 * follows `src/tools/browser.ts`; the launch argv + protocol-timeout handling
 * follow `src/tools/browser/launch.ts`.
 *
 * This is a **single-tab subset of omp's multi-tab supervisor**: one module-
 * level browser+page pair per process, no tab registry. Non-goals (omp's
 * advanced forms, TODO when they land): multi-tab sessions (tab-supervisor /
 * tab-worker), stealth patches (no anti-detection need against a local
 * headless Chrome), CDP connect to an existing endpoint, attaching desktop
 * app instances (`app.path` / `app.cdp_url` / relay kinds).
 *
 * Actions (JSON args via `dispatchDvcWrite('dvc://browser', ...)`):
 * - `{"action":"open","url":"..."}` — lazy-launch Chrome, open one page,
 *   navigate, return `{ok,url,title}`. `open` while a page is live navigates
 *   that page (single-tab semantics). Executable resolution: args
 *   `executablePath` → env `DASHR_BROWSER_BIN` → `/usr/bin/google-chrome-stable`.
 * - `{"action":"run", ...}` — exactly one of:
 *   - `{"code":"<async expr>"}` — evaluate the expression string in the live
 *     page (`(async () => <code>)()` shape) and return `{ok,result}` with the
 *     value JSON-ified (leaves JSON cannot carry — bigint/symbol/function/
 *     undefined — become `String(value)`).
 *   - convenience sub-actions, composable in fixed order goto→type→click:
 *     `{"goto":"<url>"}`, `{"type":{"selector":"...","text":"..."}}`,
 *     `{"click":"<selector>"}` — returns `{ok,url,title}` after the last step.
 * - `{"action":"close"}` — close page + browser, return `{ok:true}`. With
 *   nothing open it is a structured `BROWSER_NOT_OPEN` error (not idempotent:
 *   a close that closes nothing usually means a caller lost track).
 *
 * Unknown fields in the args payload are rejected per action (`BROWSER_BAD_
 * ARGS`, the device-local DVC_BAD_ARGS-style code); every other failure
 * throws a structured {@link UrlSchemaError} with the underlying cause
 * attached. Through the dvc dispatcher these all surface as
 * `DVC_DEVICE_ERROR` carrying the message.
 *
 * Known transport quirk (puppeteer 25 CDP `returnByValue`): a BigInt nested
 * inside a returned object silently drops the *whole* result (evaluate
 * resolves `undefined` → `"undefined"`); a top-level BigInt survives and is
 * String()-ified. Callers needing big numbers out of a page should stringify
 * them inside the evaluated expression.
 */

import { existsSync } from 'node:fs'

import type { Browser, Page } from 'puppeteer-core'

import { registerDvcDevice } from '../../../handlers/dvc.ts'
import type { DvcDevice } from '../../../handlers/dvc.ts'
import { UrlSchemaError } from '../../../selector.ts'

/**
 * puppeteer-core is imported lazily: a deployment without the optional browser
 * dependency must still load the whole dsh-url-schema plugin — only the browser
 * device itself reports missing, exactly like the ast loader's never-throw
 * degradation. The static shape is captured via `import type` (erased).
 */
type PuppeteerModule = typeof import('puppeteer-core')
let puppeteerModule: PuppeteerModule | undefined

/** Load puppeteer-core once; missing package → structured BROWSER_NO_PUPPETEER. */
async function loadPuppeteer(): Promise<PuppeteerModule> {
  if (puppeteerModule === undefined) {
    try {
      puppeteerModule = await import('puppeteer-core')
    } catch (err) {
      throw new UrlSchemaError(
        'BROWSER_NO_PUPPETEER',
        `puppeteer-core is not installed — the browser device needs it as a dependency (npm install puppeteer-core@^25.3.0): ${messageOf(err)}`,
      )
    }
  }
  return puppeteerModule
}


/** Default Chrome executable; overridable via env `DASHR_BROWSER_BIN` or open args. */
const DEFAULT_CHROME_PATH = '/usr/bin/google-chrome-stable'

/** Mirrors upstream `BROWSER_PROTOCOL_TIMEOUT_MS` (launch.ts): per-CDP-message cap. */
const PROTOCOL_TIMEOUT_MS = 60_000

/** Headless launch argv: rootless sandbox escape hatch + no GPU (upstream buildHeadlessLaunchArgs core). */
const LAUNCH_ARGS = ['--no-sandbox', '--disable-gpu'] as const

/**
 * Wave2 state: module-level single tab (one page per process). The multi-tab
 * shape is upstream's tab-supervisor/tab-worker pair and is deliberately out
 * of scope here — swap this pair for that layer when tabs land.
 */
let browser: Browser | undefined
let page: Page | undefined

/** Uniform `unknown`-error rendering (mirrors the dvc dispatcher's helper). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Attach `cause` to a structured error so launch/goto/eval roots stay reachable. */
function withCause(error: UrlSchemaError, cause: unknown): UrlSchemaError {
  error.cause = cause
  return error
}

/** Assert the args payload is a plain JSON object and return it as a record. */
function requireObjectArgs(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    const shape = args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      `browser device: args must be a JSON object with an "action" ("open" | "run" | "close"), got ${shape}`,
    )
  }
  return args as Record<string, unknown>
}

/** Reject fields outside the action's allowlist (typo guard, DVC_BAD_ARGS-style). */
function rejectUnknownFields(action: string, args: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key))
  if (unknown.length > 0) {
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      `browser device: unknown field(s) ${unknown.map((key) => JSON.stringify(key)).join(', ')} ` +
        `for action "${action}" — allowed: ${allowed.map((key) => JSON.stringify(key)).join(', ')}`,
    )
  }
}

/** Require a non-empty string field; `field` names it in the error. */
function requireString(args: Record<string, unknown>, field: string): string {
  const value = args[field]
  if (typeof value !== 'string' || value === '') {
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      `browser device: this action requires a non-empty "${field}" string`,
    )
  }
  return value
}

/** Resolve the Chrome executable: open args → env `DASHR_BROWSER_BIN` → distro default. */
function resolveExecutablePath(args: Record<string, unknown>): string {
  const fromArgs = args['executablePath']
  if (typeof fromArgs === 'string' && fromArgs !== '') return fromArgs
  const fromEnv = process.env['DASHR_BROWSER_BIN']
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return DEFAULT_CHROME_PATH
}

/** Close a target, swallowing "already closed"/crashed errors (teardown never throws). */
async function closeQuietly(target: Browser | Page | undefined, close: () => Promise<unknown>): Promise<void> {
  if (target === undefined) return
  try {
    await close()
  } catch {
    // A dead/crashed target must not fail teardown — state is already cleared.
  }
}

/** Navigate with the structured-error wrap shared by open and run's goto. */
async function gotoUrl(target: Page, url: string): Promise<void> {
  try {
    await target.goto(url, { waitUntil: 'domcontentloaded' })
  } catch (error) {
    throw withCause(
      new UrlSchemaError('BROWSER_GOTO_FAILED', `browser device: goto(${url}) failed: ${messageOf(error)}`),
      error,
    )
  }
}

/**
 * The live page, launching Chrome lazily on first use. The executable is
 * existence-probed first so a missing Chrome surfaces as a clean
 * `BROWSER_NO_CHROME` install hint rather than an opaque puppeteer error; a
 * probe-passing launch that still fails throws `BROWSER_LAUNCH_FAILED` with
 * the underlying cause attached.
 */
async function ensurePage(executablePath: string): Promise<Page> {
  if (page !== undefined) return page
  if (!existsSync(executablePath)) {
    throw new UrlSchemaError(
      'BROWSER_NO_CHROME',
      `browser device: Chrome executable not found at ${executablePath} — install Google Chrome ` +
        `(expected at ${DEFAULT_CHROME_PATH}), set DASHR_BROWSER_BIN, or pass "executablePath" in the open args`,
    )
  }
  const puppeteer = await loadPuppeteer()
  let launched: Browser
  try {
    launched = await puppeteer.launch({
      executablePath,
      // `true` IS the "new" headless mode in puppeteer-core 25 (`'new'` was removed in v23).
      headless: true,
      args: [...LAUNCH_ARGS],
      protocolTimeout: PROTOCOL_TIMEOUT_MS,
    })
  } catch (error) {
    throw withCause(
      new UrlSchemaError(
        'BROWSER_LAUNCH_FAILED',
        `browser device: Chrome launch failed (${executablePath}): ${messageOf(error)}`,
      ),
      error,
    )
  }
  try {
    page = await launched.newPage()
  } catch (error) {
    await closeQuietly(launched, () => launched.close()) // never leak a pageless browser
    throw withCause(
      new UrlSchemaError(
        'BROWSER_LAUNCH_FAILED',
        `browser device: opening a page in the launched Chrome failed: ${messageOf(error)}`,
      ),
      error,
    )
  }
  browser = launched
  return page
}

/** `{"action":"open"}` — lazy launch, navigate (the live page if one exists), report url+title. */
async function openAction(args: Record<string, unknown>): Promise<unknown> {
  rejectUnknownFields('open', args, ['action', 'url', 'executablePath'])
  const url = requireString(args, 'url')
  const target = await ensurePage(resolveExecutablePath(args))
  await gotoUrl(target, url)
  return { ok: true, url: target.url(), title: await target.title() }
}

/**
 * Recursively make an evaluate result JSON-safe: leaves JSON cannot carry
 * (bigint, symbol, function, undefined) become `String(value)`; containers
 * are walked (arrays keep length, plain objects keep entries).
 */
function jsonSafe(value: unknown): unknown {
  if (
    typeof value === 'bigint' ||
    typeof value === 'symbol' ||
    typeof value === 'function' ||
    value === undefined
  ) {
    return String(value)
  }
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) out[key] = jsonSafe(entry)
    return out
  }
  return value
}

/** Validate run's `type` sub-action shape: `{selector: string, text: string}`. */
function requireTypeSpec(action: string, value: unknown): { selector: string; text: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      `browser device: "${action}" field "type" must be {"selector": string, "text": string}`,
    )
  }
  const record = value as Record<string, unknown>
  const selector = record['selector']
  const text = record['text']
  if (typeof selector !== 'string' || selector === '' || typeof text !== 'string') {
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      `browser device: "${action}" field "type" must be {"selector": string, "text": string}`,
    )
  }
  return { selector, text }
}

/** The live page for a run action — every run shape needs an open tab. */
function requireLivePage(): Page {
  if (page === undefined) {
    throw new UrlSchemaError(
      'BROWSER_NO_PAGE',
      'browser device: no page open — write {"action":"open","url":"..."} to dvc://browser first',
    )
  }
  return page
}

/** `{"action":"run"}` — evaluate `code`, or run the goto/type/click convenience steps. */
async function runAction(args: Record<string, unknown>): Promise<unknown> {
  rejectUnknownFields('run', args, ['action', 'code', 'click', 'type', 'goto'])
  const hasCode = 'code' in args
  const hasConvenience = 'click' in args || 'type' in args || 'goto' in args
  if (hasCode && hasConvenience) {
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      'browser device: "run" takes either "code" or the convenience fields ("goto"/"type"/"click"), not both',
    )
  }
  if (!hasCode && !hasConvenience) {
    throw new UrlSchemaError(
      'BROWSER_BAD_ARGS',
      'browser device: "run" requires "code" or at least one of "goto"/"type"/"click"',
    )
  }
  // All shapes validated before the live page is required, so bad args are
  // BROWSER_BAD_ARGS regardless of whether a tab is open.
  const goto = 'goto' in args ? requireString(args, 'goto') : undefined
  const typeSpec = 'type' in args ? requireTypeSpec('run', args['type']) : undefined
  const click = 'click' in args ? requireString(args, 'click') : undefined
  const target = requireLivePage()
  if (hasCode) {
    const code = requireString(args, 'code')
    try {
      // Expression semantics: the string is spliced as `(async () => <code>)()`.
      // Constructing here (Node-side) turns syntax errors into structured
      // failures before anything is shipped to the page.
      const expression = new Function(`return (async () => ${code})()`) as () => unknown
      return { ok: true, result: jsonSafe(await target.evaluate(expression)) }
    } catch (error) {
      throw withCause(
        new UrlSchemaError('BROWSER_EVAL_FAILED', `browser device: evaluate failed: ${messageOf(error)}`),
        error,
      )
    }
  }

  // Convenience steps, fixed order goto→type→click (navigate, fill, submit).
  try {
    if (goto !== undefined) await gotoUrl(target, goto)
    if (typeSpec !== undefined) await target.type(typeSpec.selector, typeSpec.text)
    if (click !== undefined) await target.click(click)
  } catch (error) {
    if (error instanceof UrlSchemaError) throw error // goto failures are already structured
    throw withCause(
      new UrlSchemaError('BROWSER_STEP_FAILED', `browser device: run step failed: ${messageOf(error)}`),
      error,
    )
  }
  return { ok: true, url: target.url(), title: await target.title() }
}

/** `{"action":"close"}` — teardown; state clears before any await so a hung close never wedges it. */
async function closeAction(args: Record<string, unknown>): Promise<unknown> {
  rejectUnknownFields('close', args, ['action'])
  if (page === undefined && browser === undefined) {
    throw new UrlSchemaError(
      'BROWSER_NOT_OPEN',
      'browser device: nothing to close — no browser is open (open one with {"action":"open","url":"..."})',
    )
  }
  const openPage = page
  const openBrowser = browser
  page = undefined
  browser = undefined
  await closeQuietly(openPage, () => openPage?.close() ?? Promise.resolve())
  await closeQuietly(openBrowser, () => openBrowser?.close() ?? Promise.resolve())
  return { ok: true }
}

/** The `dvc://browser` device: dispatch on `action`, structured errors on every bad path. */
const browserDevice: DvcDevice = {
  async execute(args: unknown): Promise<unknown> {
    const record = requireObjectArgs(args)
    switch (record['action']) {
      case 'open':
        return openAction(record)
      case 'run':
        return runAction(record)
      case 'close':
        return closeAction(record)
      default:
        throw new UrlSchemaError(
          'BROWSER_BAD_ARGS',
          `browser device: unknown action ${JSON.stringify(record['action'] ?? null)} — expected "open", "run", or "close"`,
        )
    }
  },
  summary:
    'headless Chrome via puppeteer-core — open {url} / run {code|goto,type,click} / close; one tab per process (single-tab subset of omp\'s multi-tab browser)',
}

/** Registry seam: any `(name, device)` receiver; defaults to the dvc:// module registry. */
export type DvcRegistrar = (name: string, device: DvcDevice) => void

/**
 * Mount the browser device. Zero-cost by design: registration only hands the
 * closed device object over — Chrome launches lazily on the first `open`.
 * `registry` defaults to the dvc:// module-level registry
 * (`registerDvcDevice`); tests may pass their own recorder instead.
 */
export function registerBrowserDevice(registry: DvcRegistrar = registerDvcDevice): void {
  registry('browser', browserDevice)
}

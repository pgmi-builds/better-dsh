/**
 * `dvc://browser` device spec (Wave2 vendored device, tasks 5.3/5.4).
 *
 * Runs the real headless Chrome against the real system executable — the
 * loop open→run→close is a genuine launch, not a mock (the spike proved the
 * environment; this spec keeps proving it). Beyond the happy loop: the
 * single-tab navigate-on-second-open semantics, run's convenience sub-actions
 * (goto/type/click, composed in one call), JSON-ification of evaluate
 * results, the structured-error routes (eval failure with cause, goto
 * failure with cause, close-without-open, bad args), the `DASHR_BROWSER_BIN`
 * env override, and the full `dispatchDvcWrite` integration (result returns,
 * device failure wraps as `DVC_DEVICE_ERROR`).
 *
 * Module-level browser state is per test file (vitest worker isolation); the
 * afterEach teardown closes any leaked tab so one failing assertion cannot
 * wedge the rest of the file.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { dispatchDvcWrite, listDvcDevices } from '../../src/url-schema/handlers/dvc.ts'
import { UrlSchemaError } from '../../src/url-schema/selector.ts'
import { registerBrowserDevice } from '../../src/url-schema/vendored/devices/browser/browser-device.ts'

// Light registration: mounting must not launch anything (zero-cost register).
registerBrowserDevice()
const device = listDvcDevices().get('browser')

/** Data-URL builder so the HTML payloads stay readable in the assertions below. */
const htmlUrl = (html: string): string => `data:text/html,${encodeURIComponent(html)}`

/** Await a rejection and return its structured error. */
async function rejection(promise: Promise<unknown>): Promise<UrlSchemaError> {
  try {
    await promise
  } catch (error) {
    return error as UrlSchemaError
  }
  throw new Error('expected the device call to reject')
}

/** Execute an args payload directly on the device (device-local error codes). */
function execute(args: unknown): Promise<unknown> {
  if (device === undefined) throw new Error('browser device not registered')
  return device.execute(args)
}

afterEach(async () => {
  // Teardown must tolerate "nothing open" (BROWSER_NOT_OPEN) — swallow it.
  await execute({ action: 'close' }).catch(() => {})
  vi.unstubAllEnvs()
})

describe('dvc://browser device', () => {
  it('close with nothing open is a structured BROWSER_NOT_OPEN error', async () => {
    const error = await rejection(execute({ action: 'close' }))
    expect(error).toBeInstanceOf(UrlSchemaError)
    expect(error.code).toBe('BROWSER_NOT_OPEN')
  })

  it('open → run(evaluate) → close loop over the real Chrome', { timeout: 30_000 }, async () => {
    const opened = (await execute({
      action: 'open',
      url: htmlUrl('<title>t1</title><h1>hello</h1>'),
    })) as { ok: boolean; url: string; title: string }
    expect(opened.ok).toBe(true)
    expect(opened.url.startsWith('data:text/html')).toBe(true)
    expect(opened.title).toBe('t1')

    const summed = (await execute({ action: 'run', code: '1+1' })) as { ok: boolean; result: unknown }
    expect(summed).toEqual({ ok: true, result: 2 })

    // Same live page: the evaluate sees the DOM opened above.
    const heading = (await execute({
      action: 'run',
      code: 'document.querySelector("h1").textContent',
    })) as { ok: boolean; result: unknown }
    expect(heading).toEqual({ ok: true, result: 'hello' })

    // Non-JSON-able leaves are String()-ified at the top level; containers
    // keep their shape. (Known CDP quirk: a BigInt nested inside a returned
    // object silently drops the whole result — documented in the device.)
    const stringified = (await execute({
      action: 'run',
      code: 'BigInt(7)',
    })) as { ok: boolean; result: unknown }
    expect(stringified).toEqual({ ok: true, result: '7' })

    const undef = (await execute({ action: 'run', code: 'undefined' })) as {
      ok: boolean
      result: unknown
    }
    expect(undef).toEqual({ ok: true, result: 'undefined' })

    const shaped = (await execute({
      action: 'run',
      code: '({n: 7, list: [1, "two"]})',
    })) as { ok: boolean; result: unknown }
    expect(shaped.result).toEqual({ n: 7, list: [1, 'two'] })

    const closed = await execute({ action: 'close' })
    expect(closed).toEqual({ ok: true })
  })

  it('a second open navigates the live tab (single-tab semantics)', { timeout: 30_000 }, async () => {
    await execute({ action: 'open', url: htmlUrl('<title>first</title>') })
    const second = (await execute({
      action: 'open',
      url: htmlUrl('<title>second</title>'),
    })) as { ok: boolean; title: string }
    expect(second.ok).toBe(true)
    expect(second.title).toBe('second')
  })

  it('run convenience sub-actions: goto, type, click (composed in one call)', { timeout: 30_000 }, async () => {
    const form =
      '<title>form</title><input id="q"><button id="go" onclick="window.__clicked = document.getElementById(\'q\').value">go</button>'
    await execute({ action: 'open', url: htmlUrl(form) })

    // Fixed order goto→type→click: navigate to the same shape again, fill, submit.
    const stepped = (await execute({
      action: 'run',
      goto: htmlUrl(form),
      type: { selector: '#q', text: 'hi there' },
      click: '#go',
    })) as { ok: boolean; title: string }
    expect(stepped.ok).toBe(true)
    expect(stepped.title).toBe('form')

    const clicked = (await execute({ action: 'run', code: 'window.__clicked' })) as {
      ok: boolean
      result: unknown
    }
    expect(clicked).toEqual({ ok: true, result: 'hi there' })
  })

  it('evaluate failure is a structured BROWSER_EVAL_FAILED carrying the cause message', {
    timeout: 30_000,
  }, async () => {
    await execute({ action: 'open', url: htmlUrl('<title>eval</title>') })
    const error = await rejection(execute({ action: 'run', code: 'Promise.reject(new Error("boom-eval"))' }))
    expect(error.code).toBe('BROWSER_EVAL_FAILED')
    expect(error.message).toContain('boom-eval')
    expect(error.cause).toBeInstanceOf(Error)

    // Syntax errors are caught Node-side before anything ships to the page.
    const syntax = await rejection(execute({ action: 'run', code: '((' }))
    expect(syntax.code).toBe('BROWSER_EVAL_FAILED')
  })

  it('goto failure is a structured BROWSER_GOTO_FAILED with the cause attached', {
    timeout: 30_000,
  }, async () => {
    const error = await rejection(execute({ action: 'open', url: 'http://127.0.0.1:1/unreachable' }))
    expect(error.code).toBe('BROWSER_GOTO_FAILED')
    expect(error.message).toContain('goto(http://127.0.0.1:1/unreachable)')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('DASHR_BROWSER_BIN override: missing binary → NO_CHROME, broken binary → LAUNCH_FAILED', {
    timeout: 30_000,
  }, async () => {
    vi.stubEnv('DASHR_BROWSER_BIN', '/nonexistent/dashr-chrome')
    const missing = await rejection(execute({ action: 'open', url: htmlUrl('<title>x</title>') }))
    expect(missing.code).toBe('BROWSER_NO_CHROME')
    expect(missing.message).toContain('/nonexistent/dashr-chrome')

    // /bin/true exists (probe passes) but is no browser: the launch itself fails.
    vi.stubEnv('DASHR_BROWSER_BIN', '/bin/true')
    const broken = await rejection(execute({ action: 'open', url: htmlUrl('<title>x</title>') }))
    expect(broken.code).toBe('BROWSER_LAUNCH_FAILED')
    expect(broken.cause).toBeInstanceOf(Error)
  })

  it('run before open is a structured BROWSER_NO_PAGE error', async () => {
    const error = await rejection(execute({ action: 'run', code: '1' }))
    expect(error.code).toBe('BROWSER_NO_PAGE')
    expect(error.message).toContain('no page open')
  })
  it('bad args are structured BROWSER_BAD_ARGS on every route', async () => {
    const cases: Array<[unknown, string]> = [
      [{ action: 'open' }, 'non-empty "url"'], // open without url
      [{ action: 'open', url: htmlUrl('<title>x</title>'), wat: 1 }, '"wat"'], // unknown field
      [{ action: 'nope' }, 'unknown action "nope"'],
      [{ action: 'run' }, '"code" or at least one of'],
      [{ action: 'run', code: '1', click: '#a' }, 'not both'],
      [{ action: 'run', type: { selector: 1, text: 'x' } }, '"type" must be'],
      [['array'], 'must be a JSON object'],
      ['string', 'must be a JSON object'],
    ]
    for (const [args, needle] of cases) {
      const error = await rejection(execute(args))
      expect(error.code, `args ${JSON.stringify(args)}`).toBe('BROWSER_BAD_ARGS')
      expect(error.message, `args ${JSON.stringify(args)}`).toContain(needle)
    }
  })

  it('dispatchDvcWrite integration: result returns, device failure wraps as DVC_DEVICE_ERROR', {
    timeout: 30_000,
  }, async () => {
    const opened = (await dispatchDvcWrite('dvc://browser', JSON.stringify({
      action: 'open',
      url: htmlUrl('<title>dispatch</title>'),
    }))) as { ok: boolean; title: string }
    expect(opened.ok).toBe(true)
    expect(opened.title).toBe('dispatch')

    const echoed = await dispatchDvcWrite('dvc://browser', JSON.stringify({ action: 'run', code: '6*7' }))
    expect(echoed).toEqual({ ok: true, result: 42 })

    const error = await rejection(dispatchDvcWrite('dvc://browser', JSON.stringify({ action: 'wat' })))
    expect(error.code).toBe('DVC_DEVICE_ERROR')
    expect(error.message).toContain('unknown action "wat"')
  })
})

/**
 * Live-log verification driver (manual, standalone): exercises the REAL
 * ctx handler against the REAL production session log (session-788be2e1 —
 * 3 nested compaction episodes). Not wired to vitest.
 * Run: cd dashr && npx tsx test/url-schemes/verify-live.mts
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { UrlResolver } from '../../src/url-schemes/resolver.ts'
import { createCtxHandler } from '../../src/url-schemes/handlers/ctx.ts'

// 可用环境变量覆盖：CTX_SESSION_DIR / CTX_SESSION_ID / CTX_FILE
const SESSION_DIR = process.env.CTX_SESSION_DIR ?? process.env.HOME + '/.dsh/sessions/--home-u1-workspaces-dashr--'
const SESSION_ID = process.env.CTX_SESSION_ID ?? 'session-788be2e1-eb38-4d9a-b3cf-a22d148af1f6'
const FILE = process.env.CTX_FILE ?? `${SESSION_DIR}/${SESSION_ID}/session.jsonl.zstd`

// zstd CLI decompresses concatenated frames natively (alpha.5 container layout).
const text = execFileSync('zstd', ['-dc'], { input: readFileSync(FILE), maxBuffer: 1 << 28 }).toString('utf8')
const events = text.split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l))
console.log(`loaded ${events.length} events from ${SESSION_ID}`)

const resolver = new UrlResolver()
resolver.register('ctx', createCtxHandler({
  sessionPersistence: {
    open: async (_id: string, _access: 'read') => ({
      read: async () => ({ events }),
      close: async () => {},
    }),
  },
}))
const env = { agent: { id: SESSION_ID, status: 'running', options: {}, session: { header: { id: SESSION_ID, cwd: '/home/u1/workspaces/dashr' } } } }
const R = (url: string) => resolver.resolve(env, url)

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`PASS ${name}`); return }
  failures++
  console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`)
}

const roster = await R('ctx://')
check('roster lists session surface', roster.includes('ctx://session') && roster.includes('compactions'))

const snap = JSON.parse(await R('ctx://session'))
const labels = snap.compacted.map((e: { label: number }) => e.label)
check('snapshot: compactions count matches manifest', snap.totals.compactions === labels.length)
check('snapshot: identity card', snap.session.id === SESSION_ID)
check('manifest: labels sorted & unique', JSON.stringify(labels) === JSON.stringify([...labels].sort((a, b) => a - b)))
if (labels.length > 0) {
  let chainOk = snap.compacted[0].replaces_checkpoint === null
  for (let i = 1; i < snap.compacted.length; i++) {
    if (snap.compacted[i].replaces_checkpoint !== snap.compacted[i - 1].checkpoint_seq) chainOk = false
  }
  check('nested chain self-consistent', chainOk)
}

if (labels.length > 0) {
  const L0 = labels[0]
  const summary = await R(`ctx://session/compactions[${L0}]`)
  check('episode prepared = 8-section summary', summary.includes('## Primary Request and Intent') && summary.includes('## Critical Context'))
  const original = await R(`ctx://session/compactions[${L0}]:raw`)
  check(':raw = original span, not the summary', original.length > 10 * summary.length, `${original.length} vs ${summary.length}`)
  const win = await R(`ctx://session/compactions[${L0}]/original:1-3`)
  check(':1-3 window = 3 lines', win.split('\n').length === 3)
}

const transcript = await R('ctx://session/transcript')
check('transcript checkpoints ≥ min(2, compactions)', (transcript.match(/CHECKPOINT/g) ?? []).length >= Math.min(2, snap.totals.compactions))

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)

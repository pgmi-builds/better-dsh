
// Minimal reproduction: verify that a session surface node's text can be
// "rewritten" (summary + recall tag) via the append-only replace surfaceOp,
// and that the new compaction summary node's seq is determinable.
// Read-only spike — no dashr repo files touched.

import { Session } from '/home/u1/workspaces/dashr/dashr/node_modules/@deepseek-ai/dsh-session/lib/index.js'
import { createUserMessage, createAssistantMessage } from '/home/u1/workspaces/dashr/dashr/node_modules/@deepseek-ai/dsh-llm/lib/index.js'

const s = Session.create('spike-tag-demo')

const userMsg = (text) => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'user' },
})

const asstMsg = (text, step) => createAssistantMessage({
  content: [{ type: 'text', text }],
  source: { provider: 'p', model: 'm' },
})

const summarize = (m) => m.map(x => `${x.role}: ${x.content.map(b => b.text ?? '<non-text>').join('')}`).join('\n  ')

console.log('=== stage 0: four surface appends ===')
s.append('user/message', userMsg('user-0: hello'), { surfaceOp: 'append' })
s.append('assistant/message', { turn: 1, step: 1, message: asstMsg('asst-1: world', 1) }, { surfaceOp: 'append' })
s.append('user/message', userMsg('user-2: question'), { surfaceOp: 'append' })
s.append('assistant/message', { turn: 1, step: 2, message: asstMsg('asst-3: answer', 2) }, { surfaceOp: 'append' })
console.log('surface.nodes =', JSON.stringify(s.surface.nodes))
console.log('deriveMessages:\n  ' + summarize(s.deriveMessages()))

console.log('\n=== stage 1: simulate compactRegion writing a summary over nodes [1,2] ===')
// Mirror commitCompactionBody exactly: log-only compaction/summary, then the
// surface replacement user/message immediately after (summarySeq + 1).
const summaryEvent = s.append('compaction/summary', {
  compactionId: 'c-1',
  summary: [{ type: 'text', text: 'CONDENSED: user-2 and asst-3 happened.' }],
  shadowedRange: { start: 1, end: 2 },
  shadowedSeqs: [1, 2],
  shadowedTokenCount: 1234,
  provider: 'p', model: 'm',
})
const replacement = s.append('user/message',
  createUserMessage({
    content: [
      { type: 'text', text: 'This is an automatically generated checkpoint...\n\n<compacted-summary>' },
      { type: 'text', text: 'CONDENSED: user-2 and asst-3 happened.' },
      { type: 'text', text: '</compacted-summary>' },
    ],
    source: { kind: 'plugin', plugin: 'compact', compactionId: 'c-1' },
  }),
  {
    surfaceOp: { op: 'replace', start: 1, end: 2 },
    sourceEventSeqs: [summaryEvent.seq, 1, 2],
  },
)
console.log('summaryEvent.seq (compaction/summary) =', summaryEvent.seq)
console.log('replacement.seq (surface summary node) =', replacement.seq, ' === summarySeq+1 ?', replacement.seq === summaryEvent.seq + 1)
console.log('surface.nodes =', JSON.stringify(s.surface.nodes))
console.log('deriveMessages:\n  ' + summarize(s.deriveMessages()))

console.log('\n=== stage 2: PATCH the summary node text (append recall tag) ===')
// The summary surface node seq is determinable as summarySeq + 1 (== replacement.seq).
const summaryNodeSeq = replacement.seq
const tagged = s.append('user/message',
  createUserMessage({
    content: [
      { type: 'text', text: 'This is an automatically generated checkpoint...\n\n<compacted-summary>' },
      { type: 'text', text: 'CONDENSED: user-2 and asst-3 happened.' },
      { type: 'text', text: '</compacted-summary>' },
      { type: 'text', text: '\n[原文回溯: ctx-12] 全文可通过 recall(\'ctx-12\') 读取。' },
    ],
    source: { kind: 'plugin', plugin: 'compact', compactionId: 'c-1' },
  }),
  {
    surfaceOp: { op: 'replace', start: summaryNodeSeq, end: summaryNodeSeq },
    sourceEventSeqs: [summaryNodeSeq],
  },
)
console.log('patched node seq =', tagged.seq)
console.log('surface.nodes =', JSON.stringify(s.surface.nodes))
console.log('deriveMessages:\n  ' + summarize(s.deriveMessages()))

console.log('\n=== stage 3: shadowed originals remain recoverable from the append-only log ===')
console.log('shadowedSeqs [1,2] still in session.events:')
for (const seq of [1, 2]) {
  const e = s.events[seq]
  const m = s.deriveEventMessage(e)
  console.log(`  seq ${seq}: type=${e.type} role=${m?.role} text="${m?.content.map(b => b.text ?? '').join('')}"`)
}

console.log('\n=== stage 4: confirm in-place mutation is rejected (deep-frozen) ===')
const frozenMsg = s.deriveMessages().find(m => m.content.some(b => b.text?.includes('[原文回溯')))
let mutateOk = false
try {
  frozenMsg.content.push({ type: 'text', text: 'sneaky' })
  mutateOk = true
} catch (err) {
  console.log('mutation threw:', err.constructor.name, '-', err.message)
}
console.log('in-place push succeeded?', mutateOk)
console.log('total events:', s.events.length, '| seq (next):', s.seq)

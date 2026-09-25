# Chapter 14: Subsystems — Agent Loop (Goals, Plans, Subagents, Compaction)

## Core Idea
The agent-loop **spine** lives in core; these are **optional capability seams** the loop never depends on. Delegation (subagent), orchestration (workflow, agent-team), persistent collaboration state (goal, plan, todo), and context management (compaction, spill) each compose in only when a provider/consumer plugin is loaded.

## Frameworks Introduced
- **Subagent capability seam** (`ctx.subagents` → `SubagentRuntime`): named provider registry; one-shot `SubagentRun` + continuable children. Providers are trusted same-process transports.
  - When to use: delegate one self-contained task (`start`) or a steerable multi-turn child (`startContinuable`).
  - How: `start(name, request)` → `SubagentRun` (await `result`, always `dispose`); continuable path uses `startContinuable`/`sendMessage`/`interrupt`.
- **SubagentCapabilities** (`agentOptions`, `outputSchema`, `depthLimit`, `toolFilter`, `persona`): start-time feature flags.
  - When to use: request any non-default option; the service rejects unsupported requests loud (`SubagentError('UNSUPPORTED_CAPABILITY')`) — never accepted-then-ignored.
- **Continuation manager / Activation**: one durable child `Session` ⇒ at most one process-local **Activation** (resident reconstructed `Agent`).
  - How: `startContinuable` → `{ childId, messageId }`; turns ordered via `Agent.steer()` into the Agent inbox (the only queue).
- **Workflow seam** (`ctx.workflowEngine` → `WorkflowEngine`, abstract): runs a model-written orchestration **script** that spawns subagents.
  - How: `start(request)` → `WorkflowRun`; `meta`/`args` are plain JSON DATA validated before any script text runs.
- **GoalService** (`ctx.goals`): event-sourced same-session goal, backed exclusively by the owning session log.
  - How: compare-and-set mutations via `GoalRef {id, revision}`; every mutation appends a `goal/change` event.
- **CompactionEngine** (`ctx.compaction`, abstract): replaces a surface range with one summary node.
  - How: `compactIfNeeded(agent, trigger, signal)` / `compactNow` / `compactRegion(start, end, agent, signal)`.
- **SpillStore** (`ctx.spillStore`, abstract): persists oversized tool text, returns a locator + retrieval hint.
  - How: `saveText(input) → Promise<SpillRef>`.
- **TeamService** (`ctx.agentTeams`): experimental implicit-root multi-agent topology.
- **PlanModeController** (`ctx.planMode`): soft plan-mode guidance.

## Key Concepts
- **Activation**: process-local period a continuable child `Agent` is resident; one per child Session, may run many FIFO turns, stays while descendants run.
- **Continuable child**: durable child Session with an optional live Activation; no `SubagentRun`, no Task wrapper.
- **SubagentRun**: holder-owned one-shot handle — `id`, `localAgent?`, `result`, `dispose()`. No steering/resume.
- **SubagentStopReason**: merge-extensible `completed | aborted | error | max-tokens | refusal`; map non-`completed` to `isError`.
- **WorkflowMeta**: identity block `{name, description, whenToUse?, phases?}`; matches Claude Code dynamic-workflows meta vocabulary.
- **WorkflowError.fatal**: hook misuse (`fatal: true`) is re-thrown by `parallel()`/`pipeline()`, never folded to `null`.
- **GoalPhase**: durable `active | paused | blocked | complete`; **activation** (process-local continuation eligibility) is separate and never persisted.
- **GoalMessageSource**: `{kind:'goal', goalId, revision, round}` — positive sequential round attribution on admitted `user/message`.
- **CompactionTrigger**: `'pressure' | 'context-overflow'`; overflow may force a reduction even below threshold.
- **SpillRef / SpillLocator**: saved artifact (`locator` opaque branded, `bytes`, `retrievalHint`); consumers render hint, never parse locator.

## Mental Models
- Use **one-shot subagents** when the child is a single foreground delegation you await and dispose; use **continuable children** when the parent must steer/interrupt/resume across turns.
- Think of **compaction as surface-node shadowing, not deletion**: the append-only log retains everything; `shadowedSeqs` is the authoritative shadowed set, `shadowedRange` a position span (can have `start > end` after prior replaces).
- Think of **goal phase vs activation** as two questions: "what happened to the objective" (durable) vs "may a continuation consumer start another round" (process-local).
- Think of **spill** as "save text, return locator" — storage only; no retention, no tool-result replacement, no retrieval API.

## Anti-patterns
- **Accepting an unsupported subagent capability silently**: requests must reject loud; flags are checked before `start()`.
- **Reporting partial output as success**: a non-`completed` `stopReason` means `output` may be partial — map to `isError`.
- **Rejecting `result` on child-level failure**: a model/transport failure resolves with `stopReason:'error'`; only unrepresentable infrastructure faults reject.
- **Folding workflow hook misuse into `null`**: fatal `WorkflowError` must kill the script; `null` is reserved for child-run failures and ordinary stage errors.
- **Giving a listener a live `WorkflowRun` or the result value**: events carry DATA SNAPSHOTS (`WorkflowRunInfo`), and `workflow/end` omits `value`.
- **Coupling a provider's settlement/cleanup to a sibling**: providers isolate operation-local mutable state; a shared capacity controller may delay but never couple.

## Code Examples
```ts
// subagent routing by Activation state (SubagentRuntime.sendMessage)
//   running  → steer nearest step in same Activation
//   waiting  → wake and steer same Activation
//   no Activation → cold-resume a new Activation, then steer

// goal lifecycle (ctx.goals)
get(agent): GoalView | undefined
create(agent, { objective, maxGoalRounds? }): GoalView
edit(agent, ref, { objective?, maxGoalRounds? }): GoalView
pause(agent, ref) | resume(agent, ref) | complete(agent, ref): GoalView
block(agent, ref, { code, message }): GoalView
clear(agent, ref): GoalRef          // durable tombstone
disarm(agent): GoalView | undefined // process-local, no phase change

// plan mode (ctx.planMode)
get(agent): { active: boolean; pending?: boolean }
set(agent, active): 'committed' | 'queued' | 'cancelled' | 'noop'

// compaction (ctx.compaction)
compactIfNeeded(agent, 'pressure'|'context-overflow', signal): Promise<CompactionResult | null>
compactNow(agent, signal, sourceCommandId?): Promise<CompactionResult | null>
compactRegion(start, end, agent, signal?): Promise<CompactionResult>

// spill (ctx.spillStore)
saveText({ owner: {sessionId}, source: {toolName, callId, label},
           suggestedName, content }): Promise<SpillRef>
```

## Reference Tables

**Compaction session events (all log-only):**
| Event | Payload | Role |
|---|---|---|
| `compaction/start` | `{ turn }` | lock; number = open auto turn, `null` = standalone manual |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | safe projection + reconstructable one-shot call envelope |
| `compaction/end` | `{ turn, error? }` | releases lock; `error` = unsuccessful attempt |

**`ManualCompactionErrorCode`:** `busy` · `cancelled` · `changed` · `summary` · `commit` · `persistence`.

**Subagent provider registry names:** `spawn`, `fork`, `acp`, `codex`, `claude-code`, `dsh-sdk` (packages `dsh-subagent-<name>-in-process` / `-acp` / `-codex` / `-claude-code` / `-dsh-sdk`).

**Team task DAG statuses:** `pending` (unstarted/released) · `in_progress` (has owner) · `completed` (satisfies blockers) · `deleted` (tombstone); `blockedBy` must be acyclic and name non-deleted tasks.

## Key Takeaways
1. `subagent`, `workflow`, `compaction`, `spill`, `plan`, `goal` are all optional seams — the loop spine never imports them.
2. `sendMessage` routes purely by Activation residency; authority comes from the exact live sender (direct parent or direct continuable child only — siblings, ancestors, self, one-shot rejected).
3. `ctx.tokenMeter` owns compaction estimation/replay; `dsh-compaction-basic` owns thresholds, retention, sequencing, and routed summarization calls.
4. Compaction's only surface mutation is a `user/message` with `surfaceOp: {op:'replace', start, end}`; region edges must preserve tool-call/result pairing (`toolPairingBalancedBefore/After`).
5. Goal `resume` re-arms after a session-start edge while round budget remains; `create` may replace only a `complete` goal — otherwise `clear` or `resume` first.
6. Plan mode is soft guidance — sandbox mode and approval policy enforce independently and never read/write plan state.
7. Spill `saveText` rejects on real storage failure; the policy consumer degrades best-effort by keeping the inline result.

## Connects To
- **Ch15 (Tool Execution)**: `ctx.spillStore`/`dsh-spill-policy` are invoked from the `tools/post-execute` policy seam; `todo/write`, `exit_plan_mode` are model-facing tools.
- **Ch13 (Core Session)**: `Session`, `SessionSeq`, `session/end-seed`, `Agent.steer()`, inbox events, and `surfaceOp` underpin subagent, compaction, goal, and plan state.
- **Ch17 (LLM Streaming)**: compaction uses `ctx.llm.stream()` (the `llmStreamCall` marker); `ContentBlock` vocabulary is shared.
- **Ch16 (Session Data)**: `subagent/descriptor`, `goal/change`, `todo/write`, `plan/mode`, `compaction/*` are durable session events recovered on resume/fork/compaction.
- **Ch06 (Architecture) / Ch07 (Capability Seams)**: every entry here follows the Service Definition / Provider / Consumer split (e.g. `dsh-spill` + `dsh-spill-local` + `dsh-spill-policy`).
- **Ch09 (API Gateway)**: `ctx.subagents` exposes `@Remote` faces (`remoteExportList`, `prompt`, `interruptByParent`); `ctx.agentTeams` exposes `remoteView`/`remoteCreateTask`/`remoteUpdateTask`.

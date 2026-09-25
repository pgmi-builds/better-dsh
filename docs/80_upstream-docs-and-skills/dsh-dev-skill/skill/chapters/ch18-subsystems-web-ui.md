# Chapter 18: Subsystems — Web Server, Client & UI Slots

## Core Idea
The Web surface is a layered pair: a dumb Host HTTP carrier (`ctx.webServer`) whose security comes entirely from the composition (Connection plugin: Host/Origin checks + browser-session auth on every `/api` route), and a browser-side Cordis application whose only sanctioned UI extension point is the typed Slots system (`ctx.slots.inject`/`register`) — never cross-plugin imports. Around this sit the interaction subsystems (settings, commands, user-questions, skills, feedback, webhook, schedule, terminals) that plugins consume via narrow registries.

## Frameworks Introduced
- **WebServer route registry**: named `exact`/`prefix` routes + one claimable fallback seat.
  - When to use: serving plugin bundles, feature routes, webhook ingress on a second server.
  - How: `ctx.webServer.register({kind, path, handler})` → disposer; duplicate `(kind, path)` throws. Match order: exact table → longest prefix → fallback. Fallback is one-owner (SPA dist server claims it).
- **Index injection pipeline**: structured rows before raw HTML taps.
  - When to use: putting anything into index.html (boot script, meta).
  - How: answer `webserver/index-inject` emit with `IndexInjection[]` rows; `tapIndex(transform)` is the escape hatch, applied in registration order after structured rows.
- **Browser boot (WebBootGraph)**: Host writes composed graph to `window.__DSH_BOOT__` + installs module-loader facade before parser-preloaded scripts.
  - When to use: understanding plugin client-half load order.
  - How: lazy CommonJS table; boot kernel prefetches `immediately` entries, mounts vendored Cordis Loader; Cordis service injection (not graph order) determines activation; final step is the sole `ctx.slots.renderSlot('root')`.
- **Slots composition system**: typed React registry (`dsh-client-ui-slots`) + renderer (`dsh-client-ui-renderer`, only package using `useSyncExternalStore`/React contexts).
  - When to use: any browser UI contribution from a plugin.
  - How: declare via declaration-merge on `SlotMap` + `children` entry in the owning component; contribute via `ctx.slots.inject(key, callback)` → `ctx.slots.register({name, id, order}, Component)`.
- **Settings namespaces**: one user document, per-plugin sections resolved as schema defaults → composition `base` → user layer.
  - When to use: user-editable config distinct from `cordis.yml`.
  - How: `ctx.settings.register(ns, schema, {base, applies, validate})` → `SettingsScope` (`get`/`watch`/`update`/`replace`).
- **Layered provider registries** (skills): host + per-scope layers; nearest layer wins duplicate names outright; rank → provider order → local order within one layer.

## Key Concepts
- **Trusted hosts**: `dsh web` binds loopback by default and rejects `--host 0.0.0.0`; non-loopback exposure requires the composition to supply TLS/auth/Origin policy itself (carrier owns none).
- **WebRouteKind**: `'exact' | 'prefix'`; paths absolute, no trailing slash; handlers own the full response lifecycle (may hold SSE open).
- **Client models**: React-free mirrors of Host state (`ClientSessions → SessionManager → Session`, `ClientWorkspaceModel` → `ctx.workspaces`); UI packages never reproduce transport state in component stores.
- **Cardinality axes**: `single` (one winner by priority) / `list` (id + order) / `keyed` (entryKey dispatch) / `chain` (first non-null `select(owner)` wins); scope: `root` / `session-maybe` / `session`.
- **priority**: shadowing rank, lower renders first; reusing a shipped cell's id/key replaces its presentation — the sanctioned "override" mechanism (not import shadowing).
- **SettingsDescriptor**: `{ns, schema, value, revision, base?, user?, applies, secrets?}`; `redactSecrets: true` mandatory on wire surfaces; writes use `expectedRevision` CAS and `SettingsPathOp` (`set`/`unset`) so redacted callers can't delete unseen secrets.
- **TerminalSessionService**: exact-`Agent`-owned PTY sessions; one exclusive `TerminalSendOperation` per session; `TerminalWaitReason` (`stdin_read|inferred_idle|timeout|session_exit`) independent of session status.
- **CommandResult**: `{kind:'success', text?, sourceEventSeq?}` or `{kind:'error', text}` — direct UI outcomes, not tool results; slash commands bypass the model entirely.
- **SkillInvocationPolicy**: `modelInvocable`/`userInvocable` booleans from frontmatter keys `disable-model-invocation` and `user-invocable` (default true).
- **Fire-and-forget webhook**: no queue, retry, dedup, or completion state; a `WebhookRule`'s `WebhookSessionRequest` creates an ordinary root Session whose first message is a user-role follow-up with `source.kind: "webhook"`.
- **schedule/change**: version-1 Session event, the only durable Schedule authority; strict decoder rejects unknown versions/extra fields/reused ids.

## Mental Models
- Think of `ctx.webServer` as a dumb pipe: it knows no harness concepts; every feature route (including `/api`) is registered by another plugin. Security is a composition property, not a server property.
- Use `ctx.slots.inject(key, cb)` when contributing to a slot you don't own; the callback re-runs for each owner declaration lifetime and is cleaned up when the owner collapses.
- Think of settings layers as three-deep inheritance: schema defaults ⊂ composition `base` ⊂ user section; `replace({})` re-inherits everything (the reset path).
- Treat a `single` or occupied keyed cell as a replacement point; use a fresh list `id` for additive extension.

## Anti-patterns
- **Runtime-importing another feature plugin's values**: hard boundary; only `import type` for declarations is allowed — cross-package UI goes through slots.
- **Passing `ctx`, transport objects, or model services to slot components**: components get only derived props, hooks, store actions, inject faces; services stay in the `apply` closure.
- **`replace()` from a redacted descriptor view**: silently deletes every secret the wire never returned; use path ops (`mutate`).
- **Registering a second fallback handler or duplicate `(kind, path)` route**: throws — composition-level contract.
- **Expecting webhook/schedule delivery guarantees**: webhook is at-most "repeated delivery may create repeated Sessions"; schedule is at-least-once (crash interval can duplicate reminder content); neither has receipts or completion state.
- **`every` schedule catch-up enumeration**: only the latest due occurrence dispatches; missed intervals are never replayed.

## Code Examples
```ts
// Slot injection (plugin client half)
export const inject = ['slots']
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.session.header.actions', () =>
    ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'review', order: 100,
    }, HeaderAction))
}
// Component props derive, never copy:
type HeaderActionProps = PropsRuntime<'conversation.session.header.actions'>
```
```ts
// Settings registration
const scope = ctx.settings.register('my-plugin', MySchema, {
  base: { feature: true },          // composition layer
  applies: 'live',                  // or 'restart' (UI hint)
  validate: v => { if (!v.ok) throw new Error('cross-field') },
})
scope.watch((next, prev) => ...)    // after commit, deep-equal-gated
```
```ts
// WebServer route
ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler })
// Index injection: answer 'webserver/index-inject' emit; or escape hatch:
ctx.webServer.tapIndex(html => html.replace('</head>', snippet + '</head>'))
```
```ts
// Webhook rule
ctx.webhookRuntime.register({
  id: 'nightly', kind: 'github',
  run: async (delivery, signal) => ({
    workspacePath, title, text, agentPreset, permissionPreset, model?,
  }), // null = no session
})
```

## Reference Tables
| Slot (key extension surfaces) | Cardinality | Scope |
|---|---|---|
| `sidebar.brand.mark` / `sidebar.brand.name` / `sidebar.footer.action` | — | root |
| `sidebar.workspaces` (+ `.directoryFlow`) | — | root |
| `settings.general.item` | list | root |
| `settings.models.provider-card` / `settings.models.footer` | list | root |
| `settings.plugins.tab` (+ `settings.plugin.item`) | list | root |
| `conversation.session.header.actions` | list | session-maybe |
| `conversation.chat.node` (+ `assistant-actions`, `commandview`, `turnTail`) | — | session |
| `tool.call.toolview` (+ `tool.call.images`, `tool.view.cordis`) | — | session |
| `conversation.composer.bar` (+ `input.attachments/plan/model`) | list | session |
| `conversation.input.left` / `.right` / `.overlay` / `.dock` | list | session |
| `shell.overlay` | — | root |

Live tree query: `cordis_inspect what:"client"`; catalog regenerated by `pnpm run gen-client-catalog`.

| Skill discovery rank | Source | Root |
|---|---|---|
| 100 | project-dsh | `<projectRoot>/.dsh/skills` |
| 200 | project-agents | `<projectRoot>/.agents/skills` |
| 300 | custom | `Config.customSkillDirs` |
| 400 | user-dsh | `<dshHome>/skills` |
| 500 | user-agents | `<agentsHome>/skills` |
| 600 | bundled | `Config.bundledSkillDir` |

Project root = nearest `.git` ancestor, else cwd. Formats: `<name>/SKILL.md` bundle or flat `<name>.md`; no recursive `**/SKILL.md`.

| WebServer config | Default | Notes |
|---|---|---|
| `host` | `127.0.0.1` | only `0.0.0.0` alternative; `dsh web` rejects it |
| `port` | — | `0` = OS-assigned (read back via service `port`) |
| `compression` | `'none'` | shipped Web bundle: gzip level 1 |
| `compressionThresholdBytes` | 1024 | unknown-length streams always eligible |

## Key Takeaways
1. Add plugin UI exclusively through `ctx.slots.inject()` into shipped slot keys; check the generated client catalog (`cordis_inspect what:"client"`) for cardinality/scope/occupants before choosing an id.
2. The HTTP carrier is deliberately dumb — any non-loopback deployment must supply auth/Origin/TLS at the composition layer; webhook ingress should mount a second isolated WebServer (GitHub review guide pattern).
3. Never send a settings `replace` rebuilt from a redacted descriptor; wire surfaces always pass `redactSecrets: true` and edits travel as `SettingsPathOp`s with `expectedRevision`.
4. Slot components receive no `ctx`; four injection channels are ranked: owner props (render-time values) → registration `inject` (entry-private callbacks/observables) → slot-level `inject` (owner-controlled capability, e.g. `useTurnData`) → declared store (shared mutable view state).
5. Slash commands (`ctx.commands`) execute without creating model messages; lifecycle is logged as `command/run`/`command/done` direct appends with `sourceEventSeq` linking to richer domain events.
6. Skills: nearest scope layer wins outright; body-only edits change later `skill` tool calls without emitting catalog messages (catalog carries only name + description, default 500 chars).
7. Schedule is session-local: no external notification, no cold-session scheduling; dispatch waits for full Agent idleness and uses `followup()`, never `steer()`.

## Connects To
- **Ch 09**: the `/api` bridge, Connection generations, and Remote dispatch this server carries.
- **Ch 07**: capability-seam pattern shared by web access, skills, and user-questions providers.
- **Ch 02/03**: plugin packaging — client half registration and bundle serving via `/plugins/??<id>/client.js`.
- **Ch 10**: config keys cited here (`customSkillDirs`, `bundledSkillDir`, `collectCacheMaxEntries`, `catalogDescriptionMaxLength`).
- **Ch 13**: Session persistence barrier that schedule management and feedback sidecar writes wait on.
- **Ch 16**: storage domains (`message_feedback`) and the persistence catalog indexing `schedule/change`.
- **Ch 11**: tool contracts for `skill`, `schedule_*`, and `web_search`/`web_fetch` consumers.
- **Ch 20**: `pnpm run gen-client-catalog` / `verify-cordis-catalog` in doc-sync.

# Chapter 21: Postmortems (Failure Lessons)

## Core Idea
dsh postmortems record process failures — why every safety net missed a shipped bug — and each one motivates durable guardrails; the lessons are reusable rules for plugin exports, config interpolation, agent acceptance loops, and process attribution.

## Frameworks Introduced
- **Postmortem format**: Executive summary (30-second paragraph) → Summary / Timeline / Root cause / Guardrails.
  - When to use: a bug is subtle (non-obvious mechanism), systemic (gap in tests/tooling/conventions), and costly to rediscover — and it reached a real user, merged PR, or release.
  - How: chronology records evidence, not teaching sequence; link the guardrails (tests, AGENTS.md rules) the postmortem motivated.
- **Namespace-plugin/export invariant** (0001): cordis `Loader.unwrapExports` prefers `exports.default ?? exports`.
- **`!!js` interpolation scope** (0002): JS expressions evaluate only in plugin `config`; entry metadata like `disabled` stays literal.
- **Acceptance-target identity** (0003): an agent's verification must name one exact origin and observe the change there externally.
- **Conjunction-of-evidence classification** (0004): `RunnerFailureRule` = allowed exit codes + per-line fatal signatures + exact informational exclusions.

## Key Concepts
- **Agent Note vs postmortem**: an Agent Note records a deliberate decision and rejected alternatives (forward-looking); a postmortem records a failure (backward-looking).
- **`unwrapExports` trap**: a default export resolves to the bare function, discarding sibling `name`/`inject`/`Config`; the plugin fiber is built with empty `inject`.
- **Ancestor-only fiber walk**: the `reflect.ts` `get` handler walks only ancestors; a sibling-branch service read via `ctx.<name>` through a foreign shadow throws at root. `ctx.get(name)` uses the topology-independent global isolate-keyed store.
- **Top-level bypass**: from test code (`ctx.fiber.runtime === null`), property reads bypass the fiber walk entirely — masking shadow-path failures.
- **Expression-object truthiness**: a parsed `!!js` value in `disabled` is a truthy object → always disabled; no load-time diagnostic because the YAML tag is valid.
- **`window.__DSH_BOOT__`**: injected only by the full `dsh web` host; bare Vite HTTP 200 is transport readiness, not application readiness.
- **Launcher contract (Landlock)**: exit 125 + fatal `landlock-run:` line = launcher failure; exact notice `landlock-run: partial enforcement (older Landlock ABI)` = informational before a normal child run.
- **In-band stderr**: a confined child can deliberately reproduce a runner's fatal line and exit status; a shared prefix is not a protocol.

## Mental Models
- Use a keyless real-Loader e2e when the headline operation doesn't call the model — it belongs in CI, not behind a key gate.
- Think of snapshot refresh as recording whatever the system now does; semantic impossibilities (e.g. `UNKNOWN_TOOL`) need assertions independent of expected outputs.
- Think of every verification fact (source edit, build, HTTP 200, boot manifest, user's page) as separate; acceptance = the exact origin + external observation.
- Use overlays (`fs.cordis.yml`) when you need conditional composition; runtime permission presets cannot mount/unmount plugin fibers.

## Anti-patterns
- **`export default apply` in a namespace plugin**: Loader unwraps to the bare function and drops `inject` → `cannot get property "x" without inject` at load time.
- **`ctx.<optionalService>` for services not in `static inject`**: ancestor-only shadow walk throws; use `ctx.get(name)` (inactive backend reads as `undefined`).
- **`disabled: !!js ...` on a Loader entry**: never evaluated; entry stays permanently disabled.
- **Launching a replacement server to verify a change**: a second service proves only itself; the existing page may have already picked up rebuilt artifacts.
- **Classifying failure by stderr substring + nonzero exit**: joins unrelated facts from different processes; ordinary child exits (ripgrep's 1 = no matches) get mislabeled `SANDBOX_UNAVAILABLE`.
- **Trusting an elegant theory over the trace**: instrument the actual mechanism (fiber walk, real subprocess) before reasoning.

## Code Examples
```ts
// 0001 fix — delete the stray line:
// export default apply            // ← Loader unwraps .default, drops inject

// 0001 fix #2 — optional service read:
// this.ctx.sessionPersistence     // throws through foreign shadow
this.ctx.get('sessionPersistence') // topology-independent lookup
```
```ts
// unwrapExports (vendor/loader): prefers .default
exports = exports.default ?? exports
if (!exports.__esModule) return exports
return exports.default ?? exports
```
```ts
// RunnerFailureRule (0004 guardrail):
{ allowedExitCodes?: number[],      // Landlock: [125]
  fatalSignatures: string[],        // per-line, case-insensitive
  informationalExclusions: string[] } // exact lines, e.g. the partial-enforcement notice
```

## Reference Tables
| # | Incident | Root cause | Durable lesson |
|---|---|---|---|
| 0001 | ACP crashed on connect (`session/new`, `session/load`) | `export default apply` dropped `inject`; shadow-walk read of sibling service | Namespace exports and default export are mutually exclusive; optional services via `ctx.get()`; test the real Loader path |
| 0002 | Filesystem snapshot tools always disabled | `!!js` only interpolates `config`, not `disabled`; truthy expression object; snapshot refresh accepted `UNKNOWN_TOOL` | Verify which fields are interpolated; snapshot ≠ correctness review; conditional composition via overlays |
| 0003 | Web agent validated a replacement server, not the GUI | No model-visible identity for current GUI/URL/mode; bare Vite 200 treated as success | `DSH_WEB_URL` + `app:web-surface` prompt; reject standalone Vite before listen; acceptance names the exact origin |
| 0004 | Landlock notice misclassified child failures as `SANDBOX_UNAVAILABLE` | one substring signature + any nonzero exit; bash search replaced structured errors with `SEARCH_FAILED` | Conjunction of independent evidence; exact informational exclusions; preserve structured seam failures |

## Key Takeaways
1. 100% line coverage proves lines ran, not that the feature works as shipped — hand-mounted tests bypass both the Loader and fiber topology.
2. A no-key test of the real entry path (boot the profile through Loader, assert the first RPC) catches load-shape bugs unit tests structurally cannot.
3. `TSX_TSCONFIG_PATH` in subprocess spawns makes source resolution cwd-independent — otherwise imports silently fall back to stale built `lib/`.
4. Permission controls describe only the capabilities they govern; bash sandbox presets cannot retroactively confine in-process filesystem providers.
5. A regression test must be able to fail for the reported mechanism: process timeout ≠ fail-fast; post-exit port availability ≠ never bound.
6. Platform-dependent behavior (Landlock ABI) needs a deterministic fake at the native boundary plus one assembled product-path snapshot; a self-skipping real-kernel test cannot carry the regression.

## Connects To
- **Ch 04/05**: cordis fibers, shadows, `ctx.get` semantics behind 0001.
- **Ch 10**: `!!js` interpolation scope in cordis config entries (0002).
- **Ch 15**: tool execution and `UNKNOWN_TOOL` guardrail.
- **Ch 18**: Web GUI runtime modes, HMR, `__DSH_BOOT__` (0003).
- **Ch 20**: testing rules ("test the real entry path", "verify the world") codified from these incidents.

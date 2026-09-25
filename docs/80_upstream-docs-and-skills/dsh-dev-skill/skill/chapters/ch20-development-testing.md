# Chapter 20: Development & Testing Workflow

## Core Idea
dsh development runs on a two-aggregate TypeScript build (Host/Client), a tiered test policy whose highest-value tier is the keyless real-entry-path smoke, and a doc-standard (AGENTS.md) that enforces "one home per fact" through mechanical gates.

## Frameworks Introduced
- **Two-aggregate tsconfig solution**: `tsconfig.json` (solution root) → `tsconfig.host.json` + `tsconfig.client.json` programs sharing `tsconfig.base.json` as a paths facade.
  - When to use: any new package registration, build-script, or program-seeding work.
  - How: register a package in exactly one aggregate; seed `ts.Program` scripts with the aggregate, never the root (flattening both collides the cordis `Context` declaration merges).
- **Face-phased build (`DSH_BUILD_FACE`)**: `tsc -b tsconfig.host.json` → `tsdown --env.DSH_BUILD_FACE host` → `tsc -b tsconfig.client.json` → `tsdown --env.DSH_BUILD_FACE client` → `pnpm run build:web`.
  - When to use: complete builds; `pnpm run build` wraps it and embeds version + 7-char commit + dirty marker, writing a build record that release packing and web tests validate.
  - How: `pnpm run build`; Typert (Host reflection + Remote projection) runs only in the host tsdown pass.
- **Testing tiers**: unit → coverage gate → real-API e2e → expected-output → session snapshot → web browser snapshot.
- **Doc tier taxonomy**: root AGENTS.md / architecture / subsystems / Agent Notes / postmortems / cookbook / user / package README / generated references / skills — each fact has exactly one home.
- **Type-equivalence fences**: ` ```ts type-equiv ` / ` ```ts public-api ` registered in `scripts/type-equiv.manifest.json`.
  - When to use: pasting source declarations into docs.
  - How: `{doc, symbol, source}` (+`"projection": "public-api"`); `pnpm run verify-type-equiv` (in doc-sync) fails on drift.

## Key Concepts
- **Host/Client aggregates**: one program per side because both declaration-merge cordis `Context` under the same keys; collision exists only inside a `ts.Program`, never in module resolution.
- **Shared leaves**: `host/webserver`, `compaction/compaction`, `typert/registry` registered in both aggregates so each side type-checks the same source.
- **Split packages**: six packages (e.g. `api/remotes`, `session-log-export`) carry separate Host/Client leaf tsconfigs; the workspace `constraints` gate auto-discovers them via presence of both leaf configs.
- **Source plane**: vitest resolves workspace imports via `tsconfig.base.json` paths to `src`, never through package `exports` to built `lib/` (avoids duplicate module singletons).
- **Coverage gate**: per-file 100% on `packages/*/*/src`; an uncovered line is usually dead code to delete, not a missing test.
- **With-key policy**: "we are DeepSeek — do not ration real-API tests"; suites self-skip without keys so keyless CI stays green.
- **Snapshot fixture naming**: `session[.vN].jsonl` parents, `session.<ordinal>[.vN].jsonl` children; v0 suffixless, versions lowercase `.vN`; `snapshot.yml` declares profile/composition/policy.
- **TODO markers**: `FIXME` (release blocker) > `TODO` (soon) > `XXX` (someday).
- **Lefthook hooks**: pre-commit (staged pairing records, Oxlint staged profile, THIRD_PARTY_NOTICES, whitespace, vendor manifest guard), pre-merge-commit, pre-push (`pnpm run typecheck`). Hooks deliberately do not run tests/builds — CI owns exhaustive coverage.

## Mental Models
- Think of the repo as two type worlds sharing one paths facade: resolution may cross faces freely, but programs may not.
- Use a smoke test (boot shipped profile, one prompt, check the world) when you need to catch "green unit tests, broken product"; it needs no key when the operation doesn't call the model.
- Treat snapshot refresh as fixture production, not correctness review: semantic assertions must exist independently of expected outputs.
- Treat doc budgets as guardrails, not reduction targets: at/below target keep ≥5% headroom; above target freeze the ceiling until relocation/condensation.

## Anti-patterns
- **Hand-mounting plugins in tests** (`ctx.plugin({...})`): bypasses the Loader; cannot validate how the plugin actually loads.
- **Verifying the agent's self-report**: assert by re-running the command or re-reading the file externally; keyword probes let a cheating agent pass.
- **Adding `include`/`files` to `tsconfig.base.json`**: leaks into every extending package and narrows the match-all facade.
- **Restating catalogs/JSDoc/status in prose**: hand-restated inventories rot; link or generate.
- **Narrating change history in durable prose** ("previously", "now", PR numbers): document the live mechanism; put stories in commits/Agent Notes/postmortems.

## Code Examples
```sh
pnpm install            # also installs worktree-local Lefthook + pairing merge driver
pnpm run typecheck      # setup complete when this exits 0
pnpm run build          # tsc host → tsdown host → tsc client → tsdown client → build:web
pnpm run check:all      # opt-in comprehensive local gate set
pnpm dsh --profile headless "summarize this workspace"   # needs DEEPSEEK_API_KEY
```
```ts
// namespace plugin form — never add `export default apply`
export const name = 'acp'
export const inject = ['agents', 'sessions', 'sessionPersistence']
export function apply(ctx: Context, config: AcpConfig): void { /* … */ }
```

## Reference Tables
| Tier | Command | Key rule |
|---|---|---|
| Unit | `pnpm run test` | vitest, tests beside code; every registry gets an HMR-safety dispose test |
| Coverage | `pnpm run test:coverage` | per-file 100% on `packages/*/*/src` |
| Real-API e2e | `pnpm run test:e2e` | self-skips per missing key (`DEEPSEEK_API_KEY`, `EXA_API_KEY`, …) |
| Expected output | `pnpm run test:expected` | keyless assembled CLI/process expectations |
| Snapshot | `pnpm run test:snapshot[:record|:refresh]` | review every diff |
| Web snapshot | `pnpm run test:web` | Linux PR gate; CI forces read-only replay |

| Env var | Purpose |
|---|---|
| `DEEPSEEK_API_KEY` | real-API e2e + demos |
| `DEEPSEEK_BASE_URL` | optional, defaults to public API |
| `DSH_BUILD_FACE` | host/client phase selector for tsdown configs |
| `DSH_SNAPSHOT=replay` | CI-forced read-only web snapshot mode |

## Key Takeaways
1. Register new packages in exactly one tsconfig aggregate; seed repo-wide programs from an aggregate, never the solution root.
2. Preselect the smallest checks covering your changed surface; `pnpm run check:all` is opt-in, not an agent instruction.
3. Tests resolve source, not builds: built artifacts are consumed only via explicit `lib`-mode subprocesses and built smokes; run profile subprocesses through the shared dual-mode launcher, never hand-written `--import tsx`.
4. Every non-trivial model/protocol/UI change adds a keyless recorded-session scenario in the same PR; snapshot evidence is not replaced by package or mock-only tests.
5. Docs: one home per fact, one physical line per paragraph, fenced `ts` must compile, pairs update together; classify tutorial vs reference before writing.
6. When the doc-budget gate goes red: relocate → condense → only then raise the ceiling with a justified manifest diff.

## Connects To
- **Ch 06**: architecture.md's place in the doc tier taxonomy.
- **Ch 13–18**: subsystems pages own the type definitions that type-equiv fences mirror.
- **Ch 21**: postmortems are the failure lessons behind many testing rules codified here.
- **Ch 22**: the bilingual pairing contract is part of doc-sync gates contributors run.

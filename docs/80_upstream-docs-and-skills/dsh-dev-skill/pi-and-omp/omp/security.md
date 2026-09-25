<!--
source: https://omp.sh/docs/security
fetched: 2026-09-06
-->

# Security scans

> Run a deliberately scoped, read-only security review in the background, then inspect, validate, compare, and export its findings.

## Decide what you want reviewed

Use an omp-native security scan when you want vulnerability-focused review of a repository, a sensitive directory, an uncommitted checkout, or the change between two Git revisions. It is useful before a release, after authentication or authorization changes, around parsers and network boundaries, or as a second pass over a risky diff. It looks for plausible attacker-controlled paths and concrete impact; it is not a general style review, a compliance certificate, or proof that no vulnerability exists.

Security scanning is off by default because enabling it can send repository content to the provider behind your active model, make additional model requests, consume quota, and create reports that may contain sensitive source details. Opt in only for repositories and providers approved for that use.

The safest first run is a narrow, explicit plan followed by a separate start:

```text
/security plan --path src/auth --exclude src/auth/fixtures --knowledge-base SECURITY.md
/security scan secplan_…
```

The first command checks and freezes the scope without beginning model review. Read the returned plan ID and fingerprint, then pass that exact plan ID to the second command. For a whole-repository review, `/security scan` is the one-command shortcut: it performs preflight and starts immediately.

You can also ask omp in natural language, for example: “Plan an OMP-native security review of `src/auth`, excluding generated fixtures, and stop before starting it.” Prefer the slash commands when you need deterministic plan, operation, or scan IDs.

## Enable it and sign in

Open `/settings`, go to **Tools → Available Tools → Security**, and turn it on. For a scripted or next-launch configuration:

```sh
omp config set security.enabled true
```

The equivalent `~/.omp/agent/config.yml` entry is:

```yaml
security:
  enabled: true
```

A native preflight also requires all of the following:

- run omp inside a Git repository;
- select an active model with `/model`;
- have a stored **OAuth** login for that model's provider.

An API key from the environment, `models.yml`, `--api-key`, or a key saved through a login flow is not sufficient for a native scan. Choose an OAuth-capable provider route and use `/login <provider>`. For example, a ChatGPT subscription model uses `openai-codex`, not the API-key-based `openai` route.

When several OAuth accounts exist for the active provider, choose the intended account before planning:

```text
/session pin
/session pin 2
```

The first command lists the current provider's accounts; the second pins the displayed account number to this session. Security preflight then pins the underlying durable credential row and its account or workspace identity. The `--credential ID` plan option is also available for automation that already knows the durable credential ID; it is not the display position from `/session pin`.

## Choose one target

All `--path` and `--exclude` values are relative to the Git repository root, even when omp was started in a subdirectory. Repeat either option for several paths. Paths must exist and resolve inside the repository; exclusions win over inclusions.

| Intent | Command | What is reviewed |
| --- | --- | --- |
| Repository snapshot | `/security plan` | The current repository as a whole. This is the default. |
| One or more paths | `/security plan --path src/auth --path src/session` | Only the named files or directories, minus exclusions. At least one `--path` is required for this mode. |
| Revision range | `/security plan --diff origin/main HEAD` | The resolved base-to-head Git diff, inspected against a temporary detached checkout of the resolved head. |
| Working checkout | `/security plan --working-tree` | The current checkout recorded as a working-tree review, including in-scope tracked and untracked contents. This is not a changed-hunks-only diff. |

Choose only one of repository, revision-diff, or working-tree intent. `--path` and `--exclude` may narrow a diff or working-tree scan:

```text
/security plan --diff v2.4.0 HEAD --path packages/server --exclude packages/server/generated
/security plan --working-tree --path src --exclude dist
```

Repository, path, and working-tree plans fingerprint in-scope tracked and untracked file contents, executable bits, symlink targets, and the current `HEAD` (or an unborn repository state). A ref plan resolves both names to commit IDs and fingerprints their tree diff. Deleted or changed files therefore make an old plan stale instead of silently changing what it means.

`--path` and `--exclude` are review and publication scope, not a secrecy sandbox. The native reviewer can inspect surrounding repository code to verify control flow, and a ref review receives diff context. Do not run a scan from a checkout containing material that the selected provider is not allowed to process.

## Add guidance and choose an output directory

Repeat `--knowledge-base FILE` to pin security policies, threat models, or architecture notes to the plan. Each file is resolved from the repository root and pinned by its canonical path, size, and SHA-256 digest. Changing one requires a new plan. Treat these files as provider-bound scan input too.

Without `--output`, omp allocates a unique private directory in this project's security state. To write the initial result bundle somewhere else, choose an empty directory outside the scanned repository:

```text
/security plan --path src/auth --output /tmp/acme-auth-review
```

The output directory must have an existing parent, a canonical non-symlink identity, and cannot be inside the repository. A nonempty destination is rejected unless you explicitly allow archival:

```text
/security plan --output /tmp/acme-review --archive-existing
```

When the scan starts, omp renames the existing directory to an adjacent `.archive-<scan-id>` path and creates a fresh destination. On POSIX systems, generated directories are hardened to `0700` and files to `0600`.

## What preflight freezes

`/security plan` persists an immutable plan and returns its ID and fingerprint. It pins:

- the canonical repository root, target kind, normalized include/exclude scope, and target snapshot;
- resolved base and head commits for a ref scan;
- the active provider, model, thinking level, exact OAuth credential, and recorded account/workspace identity;
- the identity of every knowledge-base file;
- the output and archive policy;
- the relevant security setting and the versioned native review workflow.

Start an existing plan with only its ID:

```text
/security scan secplan_…
```

Starting recomputes the fingerprint. If code, refs, scope inputs, knowledge bases, output state, settings, or the built-in workflow changed, omp refuses with a stale-plan error. Run `/security plan` again; do not try to reuse the old ID. The model and account selected at preflight remain pinned even if the main session later changes model.

## Follow the background scan

A successful start immediately prints both a scan ID (`secscan_…`) and an operation ID. Review continues as a visible background job, so the main session does not need to wait silently. Progress moves through:

```text
queued → preparing → reviewing → publishing → completed
```

The job also reports user-facing milestones such as preparing the scan, reviewing with security workers, and publishing the finding count. Inspect all known operations or one exact operation with:

```text
/security status
/security status <operation-id>
```

The operation snapshot includes its phase, timestamps, plan and scan IDs, current finding count, and any session file or error that is available. Other terminal phases are `partial`, `cancelled`, and `failed`.

Cancel native background work with:

```text
/security cancel <operation-id>
```

Cancellation is cooperative. A successful request means stop was requested, not that cleanup has already finished; check status until it reaches `cancelled`. Completed or otherwise terminal operations are not cancellable.

The native scan session is restricted to read-only repository search, read-only code intelligence, and bundled security-review workers. Extensions, MCP servers, inter-agent chat, shell execution, model fallback, and account rotation are disabled for the scan. It does not edit the reviewed source tree.

## Inspect findings and artifacts

Results are stored per project, not globally mixed across repositories. Start with:

```text
/security scans
/security show <scan-id>
/security show security://scans/<scan-id>/findings
/security show security://scans/<scan-id>/findings/<finding-id>
```

The `security://` namespace is immutable and read-only. `/security show` can render these project resources:

| Resource | Contents |
| --- | --- |
| `security://scans/<scan-id>/manifest` | Public scan manifest and immutable plan. |
| `security://scans/<scan-id>/findings` | Finding IDs, severity, titles, and rules. |
| `security://scans/<scan-id>/findings/<finding-id>` | Locations, evidence, remediation, and operator disposition. |
| `security://scans/<scan-id>/coverage` | Reviewed surfaces, exclusions, deferred work, open questions, and completeness. |
| `security://scans/<scan-id>/report` | The Markdown review report, when publication completed. |
| `security://scans/<scan-id>/sarif` | SARIF 2.1 results, when available. |
| `security://scans/<scan-id>/provenance` | Redacted producer and run provenance. |

A completed native output directory contains `scan.json`, `findings.json`, `report.md`, `results.sarif`, and redacted `provenance.json`. The canonical project store remains the live record. Later validation or disposition changes update that record and its SARIF, not the original Markdown narrative or an already-written external output directory; export again when you need a current artifact.

## Validate and disposition findings

Validation and disposition answer different questions:

- **Validation** asks whether the technical claim is reproducible and security-relevant. `/security validate` asks the current omp session to inspect the cited source without modifying it, then records `validated`, `rejected`, `partial`, or `error` with a summary and any supporting evidence. A finding starts as `unvalidated`.
- **Disposition** records your handling decision: `open`, `false_positive`, `accepted_risk`, `fixed`, or `wont_fix`.

Validate using either a scan/finding pair or the exact finding URI:

```text
/security validate <scan-id> <finding-id>
/security validate security://scans/<scan-id>/findings/<finding-id>
```

Treat the result as model-assisted verification, not an automatic approval. Read the cited code and evidence before accepting a material conclusion.

Record the operator decision separately:

```text
/security disposition <scan-id> <finding-id> false_positive "Input cannot cross the authenticated boundary"
/security disposition <scan-id> <finding-id> accepted_risk "Mitigated by the isolated deployment profile"
/security disposition <scan-id> <finding-id> fixed "Patched and covered by the archive traversal regression test"
/security disposition <scan-id> <finding-id> open
```

Every non-`open` disposition requires a rationale. Returning a finding to `open` clears its previous rationale.

## Compare, import, and export

After remediation, run another scan over equivalent scope and compare lineage:

```text
/security compare <before-scan-id> <after-scan-id>
```

The result counts unchanged, introduced, and resolved findings and identifies their matched IDs. The after-scan must be `completed`; a partial, cancelled, or failed scan cannot prove that an earlier finding was resolved. Compare coverage as well as counts before treating the result as a release gate.

Import a SARIF file or a Codex Security result-bundle directory into the current project's canonical store:

```text
/security import artifacts/results.sarif
/security import /tmp/codex-security-bundle
```

Imported paths and findings are validated against the current repository. List the newly assigned scan ID with `/security scans`.

Export the current canonical state as a JSON bundle, SARIF, or Markdown report:

```text
/security export <scan-id> --output artifacts/security-bundle.json --format bundle
/security export <scan-id> --output artifacts/results.sarif --format sarif
/security export <scan-id> --output artifacts/security-report.md --format report
```

`bundle` is the default format. The current import command accepts SARIF files and Codex Security bundle directories; it does not re-import omp's single-file canonical JSON export. Report or SARIF export fails clearly when that scan has no corresponding artifact. Exported files use private file permissions on POSIX, but omp does not harden an existing parent directory—choose and protect the destination yourself.

## Native review versus Codex Security cloud

These are separate products and never fall back to one another.

|  | Omp-native | Codex Security cloud |
| --- | --- | --- |
| Execution | A restricted background omp session reviews the local Git checkout or detached ref target. | ChatGPT's Codex Security control plane scans its configured repository and environment. |
| Authentication | OAuth for the active model's provider, pinned at preflight. | An `openai-codex` ChatGPT OAuth account. This is not the public OpenAI API. |
| Scope | Repository/path/ref/working-tree options from `/security plan` or `/security scan`. | Repository, environment, and lookback configured in the cloud service. |
| Billing and quota | Requests count against the selected model/provider account. | Starting consumes the account's separate Codex Security cloud scan allowance. |
| Local result | Published directly into omp's project store. | Becomes local only after an explicit pull and import. |

Cloud controls are explicit:

```text
/security cloud scans
/security cloud start --repo-id <repository-id> --repo-url https://github.com/owner/repo --environment <environment-id> --lookback 30
/security cloud status <configuration-id>
/security cloud pull <configuration-id>
```

Use `--lookback all` for an unlimited cloud lookback. Add `--credential <durable-id>` to a cloud command only when you need to select a known `openai-codex` credential explicitly. `/security cloud scans` lists configurations visible to the selected account, including repository and environment IDs, state, progress, and remaining allowance when the service reports it.

A cloud pull fetches attributed findings, converts them to omp's canonical format, generates a report and SARIF, and stores a completed imported scan. It fails closed unless the current Git project has an `origin` whose normalized repository identity matches the cloud configuration URL. Imported cloud coverage is marked `unknown` because the cloud findings API does not provide a coverage receipt. Native `/security cancel` does not cancel cloud work; there is currently no `/security cloud cancel` command.

## Privacy, credentials, and recovery

- **Provider boundary:** Native review sends prompts and inspected repository material to the active model's provider. Cloud commands send repository configuration to ChatGPT's Codex Security service, and that service performs the remote scan. Choose accounts and services authorized for the repository.
- **Credential boundary:** The plan stores a reference to one OAuth row and recorded identity, not a license to rotate through sibling accounts. Refresh stays on that row. If the credential disappears, changes identity, expires beyond refresh, or the pinned model becomes unavailable, the scan fails instead of falling back. Log in or pin the intended account, select an available model, and create a new plan.
- **Artifact boundary:** Findings, reports, SARIF, coverage, and provenance can expose paths, vulnerable flows, and remediation details. Default state and generated files receive restrictive POSIX modes, but they are not a substitute for encrypted storage, careful backups, and access control. Turning the feature off does not delete stored scans or exported files.
- **Restart:** A process restart cannot resume a running native review. On recovery, omp marks persisted `planned` or `running` scan records as `failed` with an interruption error and cleans up a temporary ref-diff checkout. Inspect `/security status` or `/security scans`, then create and start a fresh plan.
- **Partial or failed publication:** A scan that ends without a canonical publication is `partial`; cancellation and execution errors are stored as their own terminal records. Such scans may have no report or SARIF. Inspect the status error, fix authentication/model/output conditions, and rerun rather than comparing them as proof of resolution.
- **Completed but missing external files:** The canonical result may already be safe in the project store even if a later output refresh failed. Inspect it with `/security show` and use `/security export` to write a fresh copy.

`security.enabled` is the only current persistent security setting. Targets, knowledge bases, model/account choice, and output policy are per plan. Disable the feature again in `/settings` or with `omp config set security.enabled false` when you no longer want `/security` and `security://` available; disabling availability leaves existing data in place.

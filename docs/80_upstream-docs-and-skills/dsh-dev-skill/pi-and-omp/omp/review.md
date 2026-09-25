<!--
source: https://omp.sh/docs/review
fetched: 2026-09-06
-->

# Code review

> Run a focused, read-only review of a branch, working copy, commit, or GitHub pull request before you merge or ask omp to make fixes.

## Review before you change

Use `/review` when a change is ready for a deliberate correctness pass: before opening or merging a pull request, after a risky refactor, or when staged work deserves a second look. The command identifies a concrete diff, removes common generated noise, and reports only evidence-backed problems introduced by that diff.

The shortest successful flow is:

```text
You: /review
omp: Review Mode
     1. Review against a base branch (PR Style)
     2. Review uncommitted changes
     3. Review a specific commit
     4. Custom review instructions
You: 2. Review uncommitted changes
```

Choose **uncommitted changes** while you are still working. In a Git repository, this reviews staged and unstaged diffs together. In a Jujutsu repository, it reviews the current JJ working-copy diff. omp then returns findings and an overall verdict; it does not edit the files.

A review is intentionally stricter than an open-ended prompt such as `review this`. `/review` first establishes an exact VCS or pull-request scope and applies a consistent finding contract. A finding must describe a provable, actionable, unintended problem introduced by the patch and point to changed lines. The review follows changed values across module boundaries to their receiving handlers and ignores ordinary style preferences, documentation nits, and pre-existing defects. An open-ended prompt remains useful when you want broader architectural advice, a design critique, or edits, but its scope and output are whatever you ask for rather than this fixed patch-review workflow.

## Choose the right review mode

### Compare the current branch with a base branch

Choose **Review against a base branch (PR Style)** for the local equivalent of reviewing a pull request:

```text
You: /review
You: 1. Review against a base branch (PR Style)
omp: Select base branch to compare against
You: main
```

omp lists local and remote Git branches, determines the current branch, and reviews the three-dot diff from the selected base to the current branch. In other words, the scope starts at their merge base and includes the changes introduced on your branch. This is usually the right mode immediately before opening a PR.

If the feature branch contains unrelated work, select a more appropriate base or review a specific commit instead. This chooser is Git-based; use the working-copy mode for current JJ changes.

### Review staged and unstaged work

Choose **Review uncommitted changes** for a pre-commit check:

```text
You: /review
You: 2. Review uncommitted changes
```

For Git, omp combines both of these scopes:

- unstaged changes in the working tree;
- staged changes in the index.

For Jujutsu, omp detects the repository and uses the JJ working-copy diff instead of Git status or Git diff. In either case, review findings refer to the actual changed files and lines. New untracked Git files are not present in a Git diff; add or stage them before reviewing if they belong in the scope.

### Review one commit

Choose **Review a specific commit** when you want to isolate one completed unit of work:

```text
You: /review
You: 3. Review a specific commit
omp: Select commit to review
You: a13f62c Fix token refresh race
```

The chooser shows the 20 most recent Git commits. omp reviews the selected commit's patch, not all changes between that commit and the current branch. This is useful for checking a fix before cherry-picking it or separating a suspicious commit from a larger branch.

### Review a GitHub pull request

When a GitHub PR URL or `pr://` reference appeared recently in the active conversation branch, `/review` can add up to three choices above the numbered modes:

```text
You: Please look at https://github.com/acme/widgets/pull/418
You: /review
omp: Review Mode
     Review PR acme/widgets#418 from conversation
     1. Review against a base branch (PR Style)
     ...
You: Review PR acme/widgets#418 from conversation
```

The most recently mentioned PR appears first, duplicate references are collapsed, and references from abandoned conversation branches do not leak into the chooser.

For a faster and less ambiguous flow, put an explicit PR URL on the command line. This bypasses the chooser:

```text
/review https://github.com/acme/widgets/pull/418
```

You can add a focus after the URL:

```text
/review https://github.com/acme/widgets/pull/418 focus on authorization boundaries
```

The standard GitHub URL may include `/files`, `/commits`, a query string, or an anchor. Fully qualified internal references also work:

```text
/review pr://acme/widgets/418/diff/all focus on migration safety
```

For a PR review, omp fetches the PR diff and keeps the review tied to that fetched content. It does not silently substitute files from the local checkout, which may be on a different revision. An issue URL, commit URL, another host, or an incomplete reference such as `pr://418` is not treated as a PR target; without an interactive UI it becomes ordinary focus text instead.

PR review requires the GitHub CLI, `gh`, on `PATH`, authenticated with an account that can read the repository. Run `gh auth login` if necessary. A private PR also requires access to that private repository. You may provide `owner/repository` in the URL even when the current directory is not that repository.

### Supply a custom focus

Choose **Custom review instructions** when the standard working-copy scope is right but a particular risk deserves extra attention:

```text
You: /review
You: 4. Custom review instructions
omp: Enter custom review instructions
You: Review the following:

     Trace every new queue state through serialization, restart recovery,
     and the consumer switch. Ignore naming unless it hides a correctness bug.
```

If the repository has uncommitted Git or JJ changes, omp includes that diff and applies your instructions to it. If no working-copy diff is available, the instructions become the review request, so name the files, commit, behavior, or other scope explicitly.

You can also put focus words after `/review`:

```text
/review focus on cancellation and cleanup
```

In the interactive TUI, those words are carried into whichever standard mode you choose, and the separate custom-instructions choice is omitted. This is a convenient way to retain the normal VCS scope while emphasizing one concern.

Good focus text names a failure boundary rather than asking for generic quality:

```text
/review focus on backward compatibility of the persisted session format
/review focus on authorization checks after redirects
/review focus on partial writes, retries, and idempotency
```

## How omp defines and scales the scope

Before review, omp parses the unified diff into changed files and counts added and removed lines. It excludes common low-signal files from the review scope:

- lock files such as `package-lock.json`, `Cargo.lock`, `poetry.lock`, and `flake.lock`;
- minified files, generated files, snapshots, and source maps;
- files under top-level `dist/`, `build/`, or `out/`, plus vendored dependencies;
- images, fonts, PDFs, and common archives.

The result reports excluded paths and reasons, so filtering is visible rather than silent. If every changed file is filtered, the command stops with **No reviewable files** instead of returning a misleading clean verdict. A file that merely happens to be named like generated output may need a custom, open-ended review if you intentionally want it inspected.

Review breadth scales with the reviewable diff. The current concurrency heuristics are:

| Reviewable change | Review breadth |
| --- | --- |
| Fewer than 100 changed lines, or at most 2 files | One focused pass |
| Fewer than 500 changed lines | Up to 2 parallel slices |
| Fewer than 2,000 changed lines | Up to 4 slices, roughly one per 3 files |
| Fewer than 5,000 changed lines | Up to 8 slices, roughly one per 2 files |
| 5,000 lines or more | Up to 16 slices, never more than the file count |

Added and removed lines both count. Related implementation and test files remain part of the same coherent review area rather than being judged without context.

For a diff of at most 20 reviewable files and 50,000 characters, the full diff is carried into the review. Above either limit, omp uses short per-file previews and has the review read the assigned diff sections directly. This reduces prompt noise without reducing the intended file scope. For local reviews, surrounding file context may also be read when needed. For GitHub PRs, context stays within the fetched PR diff rather than using local workspace files.

These rules make large reviews tractable, not infallible. A huge mechanical change may still be better reviewed in several logical commits, while a tiny authentication change may justify a very specific custom focus.

## Read the result

A finding contains:

- **Priority** — urgency and impact, from `P0` to `P3`.
- **Confidence** — a value from `0.0` to `1.0` estimating how likely the reported bug is real.
- **Title and explanation** — the discrete fix to make, the trigger condition, and the impact.
- **File and line range** — a short range that overlaps the reviewed diff.

| Priority | Meaning | Practical response |
| --- | --- | --- |
| `P0` | Universal release or operations blocker, such as data corruption or an authentication bypass. | Stop the release and investigate immediately. |
| `P1` | High-impact defect that should be fixed in the next cycle. | Fix before merge unless you explicitly accept the risk. |
| `P2` | Medium-impact edge case or correctness problem. | Plan and verify a fix; decide merge timing from your project policy. |
| `P3` | Informational, low-impact improvement. | Treat as optional unless it reveals a project requirement. |

Confidence is not severity. A `P0` at `0.55` describes a catastrophic claim with uncertain evidence; a `P2` at `0.98` describes a narrower problem supported by strong evidence. Verify both the trigger and the affected path before acting.

The final verdict is **correct** or **incorrect**, followed by a short explanation and verdict confidence. **Correct** means no correctness bugs or blockers were established under this review contract; it does not certify style, documentation completeness, performance in every environment, or the absence of all possible defects. **Incorrect** means the review established at least one material correctness problem. Finding counts are also summarized by priority; **Findings: none** is not a substitute for your own domain-specific checks.

## Turn findings into a deliberate follow-up

`/review` is read-only. It does not apply suggestions, modify your working tree, run a fix, or merge a PR. That separation gives you a decision point.

For each finding:

1. Open the cited changed lines and reproduce the stated trigger against surrounding code.
2. Decide whether the finding is valid and whether its priority matches your release policy.
3. Ask omp for the precise action you want, referencing the finding rather than saying only “fix everything.”
4. Run the relevant behavior or focused test, then review the resulting patch again if the fix was substantial.

For example:

```text
The P1 finding in src/auth/refresh.ts is valid. Fix the refresh race without
changing the public token API, run the focused auth test, and show me the result.
```

Or reject a finding explicitly:

```text
The P2 finding assumes retries can overlap, but this worker is single-flight by
contract. Confirm that invariant from the implementation and leave the code unchanged.
```

This preserves your control over scope and avoids converting a mistaken or low-confidence observation into an automatic edit.

## Headless use

Without an interactive UI, `/review` cannot show the mode chooser. A plain command requests a focused review of recent code changes, and trailing words become its focus:

```sh
omp -p "/review focus on authentication regressions"
```

Use an explicit GitHub PR URL when automation needs a deterministic remote scope:

```sh
omp -p "/review https://github.com/acme/widgets/pull/418 focus on API compatibility"
```

An explicit valid PR URL is fetched directly in both interactive and headless use. Without one, headless mode does not offer base-branch or commit selection; make the surrounding prompt identify the intended recent changes, or run the interactive TUI when you need one of those choosers. Review output remains read-only, so a CI script must decide separately whether and how a verdict affects its exit or merge policy.

## Troubleshooting

- **No uncommitted changes found** — the Git working tree and index are clean, or the JJ working-copy diff is empty. Choose base-branch or commit mode if the work is already committed.
- **No diff content found** — Git status noticed a change but staged and unstaged unified diffs were empty. A common cause is an untracked file; add or stage it, then rerun `/review`.
- **No changes between *base* and *branch*** — confirm the selected base and current branch. The comparison is merge-base-based, so choosing the current branch or the wrong remote branch can produce an empty diff.
- **No git branches found** — run omp inside the intended Git checkout and confirm it has branch refs. Detached `HEAD` can also make branch-oriented review confusing; use commit mode when that is the real scope.
- **No commits found** — the directory is not a readable Git repository or has no history. Use working-copy or custom mode as appropriate.
- **No reviewable files (all changes filtered out)** — every diff path matched a noise rule. This is not a clean review; use a custom open-ended prompt if those generated or binary artifacts genuinely need inspection.
- **Failed to get diff / Failed to get commit** — check that the repository and selected revision still exist and that Git or JJ can read them. Rerun after resolving an in-progress VCS operation or invalid ref.
- **Failed to fetch PR diff** — ensure `gh` is installed, run `gh auth login`, verify the account can view the repository and PR, and retry the explicit URL.
- **PR … has no diff content available** — the PR may have no changes, the fetched diff may be unavailable, or GitHub may not expose patch text for its contents. Open the PR's Files changed view before treating this as a clean result.
- **A recent PR is missing from the chooser** — only the three most recent distinct PR references on the active conversation branch are offered. Paste the full URL directly after `/review` to bypass detection.
- **The wrong files were reviewed** — cancel and choose the scope again. Use base-branch mode for the whole feature branch, uncommitted mode for the current working copy, commit mode for one commit, or an explicit PR URL for remote changes.

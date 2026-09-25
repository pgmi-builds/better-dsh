<!--
source: https://omp.sh/docs/github
fetched: 2026-09-06
-->

# GitHub

> Review issues and pull requests, search GitHub, work on PRs safely, and follow Actions from an omp prompt.

## Work with GitHub from a prompt

Use omp to investigate issues, review pull requests, search repositories, create or update a PR branch, and watch GitHub Actions without copying everything into the chat. omp uses the GitHub CLI (`gh`), so it sees the same repositories and permissions as your signed-in GitHub account.

Start by installing and authenticating `gh`, then enable the GitHub capability:

```sh
gh auth login
gh auth status
omp config set github.enabled true
```

You can also open `/settings` in an omp session and turn on **Tools → Available Tools → GitHub CLI**. `github.enabled` is off by default. If the capability is still unavailable in an already-running session, start a new session after enabling it.

Then ask for the outcome you want:

> Review PR #482. Summarize the behavior change, identify risky code paths, and call out missing tests. Do not check it out or modify anything.

omp shows the GitHub data it read, links back to the source item, and asks for the appropriate approval before a GitHub operation. It does not store a separate GitHub token in `~/.omp`; authentication remains managed by `gh`.

## Common workflows

Run omp from a checkout whose `origin` points to GitHub when you want short issue or PR numbers to mean that repository. Outside a checkout, name the repository in your request, such as `owner/repo`.

### Investigate issues

Ask omp to read an issue and its discussion, connect it to the code, or compare it with related reports:

> Read issue #731, trace the affected code in this checkout, and explain the most likely root cause. Do not change files yet.

> Find open `bug` issues in `acme/payments` updated in the last two weeks. Group duplicates and recommend the three highest-impact fixes.

The built-in GitHub capability reads and searches issues. It does not provide dedicated issue creation, editing, commenting, or closing operations. If omp proposes a separate shell-based `gh` command for such a write, that command is governed by your normal shell approval policy.

### Review pull requests

A review can stay remote: omp reads the PR metadata, discussion, changed-file list, and either individual file diffs or the complete diff.

> Review PR #482 without checking it out. Focus on authentication regressions, unsafe error handling, and whether the tests cover failure paths.

> Compare PRs #482 and #497. Explain which approach better preserves the public API and why.

For a pull request in another repository, be explicit:

> Review `acme/widgets` PR 482 and summarize unresolved review concerns.

### Work on a PR in an isolated worktree

When local execution or edits are necessary, ask omp to check out the PR. The GitHub integration creates a dedicated git worktree rather than switching or overwriting your current working tree. It reports the worktree path in the result.

> Check out `acme/widgets` PR 482 in a dedicated worktree, run the targeted tests, fix the failing redirect test, and show me the diff. Do not commit or push yet.

> Commit the approved changes and push them back to PR 482's source branch, then watch its CI.

PR branches are named `pr-<number>`. Worktrees normally live under `~/.omp/wt`; `OMP_WORKTREE_DIR` overrides that location, followed by the `worktree.base` setting. Existing matching worktrees are reused. If a local `pr-<number>` branch points at a different commit, checkout stops instead of resetting it unless you explicitly authorize a forced reset.

Pushing is deliberately constrained: omp can use the GitHub PR push workflow only for a branch previously acquired through its PR checkout workflow. This preserves the PR head repository, branch, and fork metadata and prevents an arbitrary local branch from being mistaken for a PR branch. A push can still fail when the PR author disabled maintainer edits or your GitHub account lacks permission.

### Open a pull request

Ask omp to create a PR from the current branch after you have reviewed and committed the changes:

> Create a draft PR from the current branch into `main`. Fill the title and body from the commits, add the `bug` label, and request review from `octocat`. Show me the URL.

Or supply the wording yourself:

> Open a PR titled “Fix login redirect after SSO” with a concise summary and test plan. Target `main` and leave it as a draft.

Creating the PR is a remote write and requires execution approval under the normal approval policy.

### Search GitHub

omp can search issues, pull requests, code, commits, and repositories. State the scope and filters in normal language; GitHub search qualifiers are also useful when you already know them.

> Search this repository for open PRs mentioning token rotation, created since 2026-07-01.

> Search code across the `acme` organization for calls to `legacyAuthenticate(` and list the repositories and paths.

> Find Rust repositories in the `acme` organization pushed in the last month that mention WebAuthn.

Issue, PR, code, and commit searches default to the current GitHub checkout when you omit a scope. Repository search is global unless your request includes an `org:`, `user:`, or similar GitHub qualifier. Search results are concise and capped, so ask omp to narrow the query rather than expecting an exhaustive export.

### Watch GitHub Actions

Ask omp to follow all workflow runs associated with the current `HEAD`, or give it a run URL:

> Watch GitHub Actions for the current HEAD. If a job fails, summarize the failure and show me where the full logs were saved.

> Watch `https://github.com/acme/widgets/actions/runs/123456789` until it finishes.

The result updates while jobs run. A failed job is reported quickly with a log tail; full failed-job logs are saved as a session artifact and referenced in the response. When watching the current commit, omp waits for all discovered workflows and performs an extra check before declaring success so a slightly later workflow is not missed.

## Paste GitHub references into a prompt

`pr://` and `issue://` are optional, user-facing references. Paste one into a prompt when a bare number would be ambiguous or when you want a specific view. You do not need to invoke a file-reading command yourself.

| Reference | Meaning |
| --- | --- |
| `issue://731` | Issue 731 in the current checkout's GitHub repository, including comments. |
| `issue://acme/widgets/731` | Fully qualified issue. |
| `issue://731?comments=0` | Issue without its discussion thread. |
| `pr://482` | PR 482 in the current repository, including comments and reviews. |
| `pr://acme/widgets/482` | Fully qualified PR. |
| `pr://482/diff` | Changed-file list. |
| `pr://482/diff/3` | Diff for the third file in that list; indices are 1-based. |
| `pr://482/diff/all` | Complete unified diff. |
| `issue://?state=open&label=bug&limit=20` | Recent matching issues in the current repository. |
| `pr://acme/widgets?state=merged&author=octocat&limit=20` | Matching PRs in a named repository. |

List references default to open items and 30 results. `limit` must be positive and is capped at 100. Issue lists accept `open`, `closed`, or `all`; PR lists also accept `merged`. Lists may be filtered by one `author` and one `label`.

Examples:

> Explain the user-visible impact of `pr://acme/widgets/482/diff/all` and identify migration risks.

> Triage `issue://?state=open&label=regression&limit=20` against the current code.

In the interactive editor, typing a standalone `#482` offers both a PR and an issue completion because GitHub shares the number space. Type `pr #482` or `issue #482` to constrain the completion.

These references work through omp's GitHub-backed reading support and do not depend on the broader `github.enabled` toggle. They still require `gh` to be installed, authenticated, and able to access the repository.

## Approvals, isolation, and cached data

GitHub access follows three visible boundaries:

- **GitHub permissions:** omp can access only what the active `gh` account can access. It cannot bypass organization SSO, repository permissions, branch protection, or fork restrictions.
- **Operation approval:** repository reads, searches, and Actions watches request read approval; PR creation, checkout, and push request execution approval. Your active approval mode determines whether omp pauses for confirmation.
- **Local isolation:** PR checkout creates or reuses a dedicated worktree. It does not switch the branch in your current working tree. Checkout changes local git state; PR creation and push change GitHub.

Single issue and PR views and PR diffs are cached by default in `~/.omp/cache/github-cache.db`. The cache may contain private issue bodies, comments, reviews, review comments, and diffs. Rows are separated by a fingerprint of the active GitHub credential, but the database is still local sensitive data and should be protected like the rest of your account cache.

Fresh entries are reused for 5 minutes. Older entries are returned while omp refreshes them in the background, and entries older than 7 days are discarded. To avoid persistent GitHub view caching:

```sh
omp config set github.cache.enabled false
```

## Settings reference

Defaults work after `gh` authentication except that the broader GitHub capability must be enabled.

| Setting | Default | Purpose |
| --- | --- | --- |
| `github.enabled` | `false` | Enables GitHub repository, file, search, PR worktree/push/create, and Actions workflows. |
| `github.cache.enabled` | `true` | Caches rendered single-issue, single-PR, and PR-diff views locally. |
| `github.cache.softTtlSec` | `300` | Time during which a cached view is returned without a network refresh. |
| `github.cache.hardTtlSec` | `604800` | Maximum age retained for a cached view. |
| `worktree.base` | unset | Base for omp-managed worktrees; unset normally resolves to `~/.omp/wt`. `OMP_WORKTREE_DIR` takes precedence. |

Inspect the effective values with `omp config get <setting>`, or see [Settings](/docs/settings) for config files and precedence.

## Troubleshooting

**GitHub workflows are unavailable.** Run `gh --version`. The capability is not exposed when `gh` is missing from `PATH`. Then verify `omp config get github.enabled` prints `true`; start a new omp session if you enabled it after the session began.

**Authentication fails.** Run `gh auth status`, then `gh auth login` if necessary. For a private or organization repository, confirm that the selected account has access and that any required SSO authorization is active.

**omp cannot determine the repository.** Start omp in a git checkout with a GitHub remote, or include `owner/repo` in your request. Prefer a fully qualified reference such as `pr://acme/widgets/482` when several repositories are in play.

**A PR or issue view looks stale.** Views may be served from the local cache. Recent writes through omp invalidate relevant cached views, but changes made elsewhere can remain fresh for up to the 5-minute soft TTL. Retry after refresh, lower `github.cache.softTtlSec`, or disable the cache when every read must hit GitHub.

**PR checkout refuses an existing branch.** A local `pr-<number>` branch already points somewhere else. Ask omp to explain the mismatch before authorizing a forced reset; do not force it if the branch contains work you need.

**Push is rejected.** Confirm that omp originally checked out this PR into its dedicated worktree, that your account can update the PR head branch, and that fork maintainer edits are allowed. Branch protection and required reviews still apply.

**No Actions runs appear.** Make sure the commit has been pushed and that the requested repository and branch are correct. If you know the run, paste its full GitHub Actions URL instead of asking omp to infer it from the local `HEAD`.

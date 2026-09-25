<!--
source: https://omp.sh/docs/commit
fetched: 2026-09-06
-->

# Creating commits

> Preview a Conventional Commit, let omp separate unrelated staged work into ordered atomic commits, and recover safely if a hook, model, or push fails.

## When to use `omp commit`

Use `omp commit` when the changes are ready but deciding commit boundaries and writing useful Conventional Commit messages would take more care than the final Git commands. The default workflow can keep related changes together, split unrelated files or hunks into atomic commits, order dependent commits, and update nearby changelogs.

You need:

- a Git repository with the changes you intend to commit;
- Git author name and email configured;
- an authenticated, available model in omp; and
- any repository commit hooks in working order.

For `--push`, the current branch must also have a usable upstream unless your Git configuration supplies one.

## Preview first

Stage the exact scope you want omp to consider, inspect it, and run a dry run:

```sh
git add src/widget.ts test/widget.test.ts
git status --short
omp commit --dry-run
```

The preview prints either a generated message or a numbered split plan with each commit's message and selected files or hunks. It does not create commits, push, or write changelog changes.

`--dry-run` can still change the Git index: if the index is empty, `omp commit` runs the equivalent of `git add -A` before analysis. For the safest preview, stage the intended files yourself first. Use `git status --short` afterward if you started with an empty index.

## Shortest successful workflow

After reviewing the preview, create the commit or commits:

```sh
omp commit
```

To push only after every commit succeeds:

```sh
omp commit --push
```

A single-commit proposal is committed without an additional confirmation. An interactive split proposal asks you to confirm the complete plan before Git history is changed. Answer anything other than `y` or `yes` to abort the split. In a non-interactive shell, a valid split plan proceeds without that prompt. A dry run never asks for confirmation.

`--push` does not add another confirmation. If there are no changes, `omp commit --push` still tries to push existing local commits; plain `omp commit` reports that there is nothing to commit.

## Which changes are considered

The index defines the boundary:

- If anything is already staged, omp considers the staged changes only. Unstaged and untracked work remains outside the workflow.
- If nothing is staged, omp stages all tracked modifications and deletions plus untracked, non-ignored files, as `git add -A` would.
- Git-ignored files remain excluded.
- Recognized dependency lock files are excluded from semantic analysis so generated content does not create false commit boundaries. They are still committed: a split plan attaches a lock file to the commit containing its matching manifest when possible, or to the last commit otherwise.

The default workflow can divide changes at file or hunk boundaries. Every staged change must appear exactly once in a split plan, and a file cannot be assigned to multiple commits. Dependencies determine commit order; invalid dependencies and cycles are rejected before any commit is created. This means a dirty tree containing several unrelated tasks may become several ordered commits rather than one broad commit.

If that is not what you want, stage a narrower set and preview again:

```sh
git reset
git add src/widget.ts test/widget.test.ts
omp commit --dry-run
```

`git reset` here only unstages changes; it does not discard the working-tree edits.

## Messages and validation

Generated headers use Conventional Commit form:

`fix(parser): handled empty token streams`.

Supported types are `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `style`, and `revert`. The optional scope is validated, the summary is normalized to remove a duplicate type prefix, must fit within 72 characters, and must begin with a past-tense verb. Type-specific checks reject clear mismatches such as `docs` without documentation files or `test` without test files. A message body, when present, is a short bullet list of important details. Invalid proposals are not executed.

Warnings such as a vague phrase, an oversized detail list, or weak evidence for a `perf` type are shown before committing; they do not by themselves block a valid proposal.

## Changelog updates

Unless `--no-changelog` is set, omp looks upward from each changed file for the nearest `CHANGELOG.md`, stopping at the repository root. A changelog file already in the staged set does not cause another target search. For each detected, parseable changelog, omp proposes user-visible entries and merges them into the unreleased section, avoiding duplicate entries, then stages the updated changelog.

In a split workflow, generated changelog files are placed in the last commit. Changelog updates are applied before the interactive split confirmation, so declining that confirmation can leave a changelog modified and staged even though no commit was created. Inspect `git status --short` and keep, unstage, or restore that file as appropriate.

Previewing performs changelog analysis but does not write the file. Skip all automatic changelog detection and updates when the repository does not use this format or when you want to edit release notes yourself:

```sh
omp commit --dry-run --no-changelog
omp commit --no-changelog
```

## Context, models, and the legacy workflow

Add concise information that the diff cannot reveal with `--context` (or `-c`):

```sh
omp commit --dry-run --context "This fixes #418 and preserves the old wire format"
```

Select a primary model for this run with `--model` (or `-m`):

```sh
omp commit --model anthropic/claude-opus-4-5
```

Without `--model`, omp resolves the configured `commit` model role, then its normal role fallbacks. The current default workflow uses the configured `smol` role for its commit agent when that role is available, with the selected primary model as fallback. Model selectors can include the same provider, model, and thinking-level syntax used elsewhere in omp.

The default is the current agentic workflow described above: it can inspect individual files and hunks, produce one commit or a validated dependency-ordered split, and fall back to a mechanical single commit if the agent fails. Use `--legacy` only when you specifically need the older deterministic orchestration:

```sh
omp commit --dry-run --legacy
omp commit --legacy
```

The legacy workflow creates one model-generated commit, has no atomic split review, and has no mechanical fallback when model generation fails. It still follows the same staged-change, changelog, hook, dry-run, and push rules.

## Failures and safe recovery

Git hooks run normally for every generated commit. A refusing `pre-commit` or `commit-msg` hook prints the hook's own message and makes `omp commit` exit nonzero. Fix the reported problem rather than bypassing the hook, then inspect the repository before retrying:

```sh
git status --short
git log -5 --oneline
```

For a single commit failure, the intended changes remain available and normally remain staged. For a split failure, commits completed before the failure remain in history; the currently failing group remains staged, and later groups remain in the working tree. omp reports how many commits were created and confirms that no changes were lost. Do not blindly restart the original full workflow. Fix the hook or files, commit or unstage the current group, then preview the remaining work again:

```sh
git status --short
omp commit --dry-run
omp commit
```

If a large or binary staged diff cannot be sliced safely, omp aborts before creating the split commits and advises committing the large file separately. Narrow the index, commit that file, then stage and preview the rest.

A model or agent failure in the default workflow may create a mechanical single fallback commit and still exit nonzero. Therefore, **a nonzero exit does not always mean no commit was created**. Check `git log` and `git status`, review the fallback message and content, and amend or undo it with your normal non-destructive Git recovery process if it is unsuitable. The legacy workflow instead exits nonzero without a fallback commit when model generation fails.

Push happens only after all requested commits have been created. If the remote rejects the push or no upstream exists, the local commits remain intact and omp exits nonzero. Repair the upstream or remote state, then push directly:

```sh
git push --set-upstream origin HEAD
```

Or, once the branch has a working upstream, let the clean-tree path retry the existing commits:

```sh
omp commit --push
```

After declining a split, a failed hook, a fallback, or a failed push, always use `git status` and `git log` as the source of truth before running `omp commit` again. Avoid `git reset --hard`: none of these failure paths require discarding working-tree changes.

## Options

| Option | Effect |
| --- | --- |
| `--dry-run` | Generates a message or split plan without committing, writing changelogs, or pushing. May stage all changes when the index starts empty. |
| `--push` | Pushes after successful commit creation, or pushes existing commits when there is nothing new to commit. |
| `--no-changelog` | Disables changelog detection and updates. |
| `--context <text>`, `-c <text>` | Adds run-specific intent for message, split, and changelog decisions. |
| `--model <selector>`, `-m <selector>` | Overrides primary model selection for this run. |
| `--legacy` | Uses the older single-commit deterministic pipeline. |
| `--help`, `-h` | Shows current command help. |

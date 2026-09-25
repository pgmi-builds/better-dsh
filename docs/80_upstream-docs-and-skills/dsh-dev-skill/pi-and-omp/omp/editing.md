<!--
source: https://omp.sh/docs/editing
fetched: 2026-09-06
-->

# Structural edits

> Change the same code shape safely across a project, review the exact matches before they land, and resolve merge conflicts without brittle search-and-replace.

Structural editing lets omp change syntax rather than matching raw text. It is useful for codemods that must survive different whitespace, comments, or formatting, while a staged preview makes an unexpectedly broad match visible before the change lands.

The smallest useful request is plain language:

> Across `src/**/*.ts`, replace calls to `legacyWrap` with `modernWrap`, preserving every argument. Show the proposed structural edit and apply it only if it changes call expressions.

You specify the outcome, scope, and safety conditions. omp chooses and operates the editing machinery; you do not need to write a pattern or invoke an editing tool yourself.

## Structural, symbol-aware, or text editing?

omp has three related ways to make code changes:

- **Structural editing** matches a syntactic shape. It can find the same function-call form despite formatting differences and rewrite many instances consistently. Use it for API migrations, repeated expression changes, import-form updates, or removal of a particular statement shape.
- **Symbol-aware editing** follows the identity of a declaration through references, scope, imports, and re-exports. Ask for this when renaming a real symbol rather than every piece of code with the same spelling. See [Code intelligence](/docs/code-intelligence).
- **Text or line editing** is best for a small, known location, prose, configuration, or code that has no supported parser. See [Files and editing](/docs/files).

A structural match is syntax-aware, not binding-aware. Two unrelated functions named `legacyWrap` can look identical to it. If identity matters, say so:

> Rename the exported `createSession` symbol from `src/session.ts` and update its real references and importers. Do not rename unrelated local functions with the same name.

For a codemod with similarly named code, give omp enough context to narrow it:

> In `packages/api/src/**/*.ts`, migrate only calls to `legacyWrap` imported from `@acme/legacy`. Do not touch test fixtures or locally declared functions. If the import origin cannot be proven, stop and explain the ambiguity.

## Requesting and reviewing a codemod

A strong request includes:

1. **Scope** — files, a directory, or a glob.
2. **Before and after behavior** — describe the code shape and what must be preserved.
3. **Exclusions** — generated code, fixtures, a second API with the same spelling, or any other boundary.
4. **Decision rule** — apply when the preview meets specific conditions, or preview only and stop.
5. **Verification** — the focused command or behavior omp should check after applying it.

For example:

> In `packages/client/src/**/*.ts`, convert direct `response.data` reads to optional access only where `response` may be absent. Preserve comments and surrounding control flow. Preview first; reject if more than 20 replacements or any file outside that directory is included. After applying, run the client typecheck.

### What the cards mean

Structural rewrites are staged before they touch disk. The TUI shows the affected files, replacement count, and removed/added lines.

- **Proposed** means the preview exists but its changes have not been written.
- **Accept** means omp accepted the proposal and reports what was actually written.
- **Reject** means the staged proposal was discarded; that proposal changed no files.

These labels report state; they are not shell commands. Tell omp what you want in natural language, such as “apply this only if every match is in `src/compat`” or “reject this proposal and explain the unexpected test-file matches.”

For an explicit two-pass review, start with:

> Preview this codemod only. Do not apply it.

omp will show the proposal and discard it rather than leave an old action pending. After reviewing the files and counts, ask omp to run the same codemod again with your approval conditions. The second run produces a fresh preview against the current working tree.

### Review safely

Before accepting a broad rewrite:

- Check the total replacement and file counts against your expectation.
- Expand the proposed card and inspect at least one match from every distinct code shape or package.
- Watch for same-spelled but unrelated symbols; switch to a symbol-aware rename when necessary.
- Narrow the path rather than accepting a surprising match and planning to repair it later.
- Ask omp to inspect the resulting diff and run the smallest relevant typecheck or test after acceptance.
- Keep unrelated uncommitted work visible in your review. A structural edit changes matched syntax in those files; it is not a substitute for checking the complete working-tree diff.

## If the preview becomes stale

Acceptance reruns the rewrite against the current files instead of blindly replaying old bytes. If another edit changes the matches between preview and acceptance, omp marks the preview as stale and reports the new result.

The outcome depends on what still matches:

- If nothing matches anymore, no replacements are applied.
- If only some previewed sites still match, those current matches can be applied before omp reports that the accepted result differs from the preview.
- If new matches appeared, omp can apply more replacements than the preview showed and flags the count mismatch.

Treat a stale result as an error, not as a successful all-or-nothing transaction. Inspect the reported files and current diff, then ask omp to re-read the affected code and generate a fresh, narrower preview. Do not repeatedly accept the old proposal.

Ambiguity is different from staleness: a structural matcher can validly find several syntactically identical sites even when only one is semantically intended. The file list and replacement count are the warning. Refine the request or use symbol-aware editing before applying.

## Resolving merge conflicts

You can ask for the desired result without choosing a side mechanically:

> Resolve the conflicts in `src/session.ts`. Preserve the retry behavior from our branch and the timeout validation from the incoming branch. Show the final diff and run the session tests.

When omp reads a file containing complete Git conflict markers, it assigns each block a session-local reference such as `conflict://1`. You may paste that reference into a follow-up to remove ambiguity:

> For `conflict://2`, combine both sides: keep our validation and their error message. Re-read the surrounding function before changing it.

> Keep ours for `conflict://1`, keep theirs for `conflict://3`, and hand-merge `conflict://4` so neither behavior is lost.

`conflict://*` means every conflict currently registered in the session. Use it cautiously and state whether the same policy really applies to all of them:

> Resolve `conflict://*`, but inspect each block independently. Do not choose one side wholesale; preserve both behaviors where they are compatible.

References appear only after omp has read and registered the marker block. They are session-local, and an ID from an old session should not be reused. If a block was edited or resolved after registration, omp refuses to splice a marker region it can no longer locate and asks for a re-read. Resolving one block does not invalidate unrelated registered blocks.

Conflict resolution is a direct merge operation rather than a structural-edit proposal. For high-risk merges, ask omp to explain the intended resolution first, then request the edit and review the resulting Git diff. A final search for conflict markers and the relevant tests should be part of the request.

## Configuration

Structural editing is enabled by default. Open `/settings`, then go to **Tools → Available Tools → AST Edit** to turn it on or off. The corresponding setting is `astEdit.enabled`; for shell-managed configuration:

```sh
omp config set astEdit.enabled true
omp config set astEdit.enabled false
```

See [Settings](/docs/settings) for configuration precedence and file locations.

A structural pass searches at most 1,000 files by default. Set the positive `PI_MAX_AST_FILES` environment variable before launching omp if a larger repository genuinely needs a different ceiling. Usually the safer response to a limit warning is to narrow the requested directory or glob, not raise the ceiling.

A restricted `--tools` list can also make structural editing unavailable even when the setting is enabled. In that case, restore the normal editing tools or ask omp for a scoped alternative.

## Limitations

- Structural editing understands syntax, not types, runtime behavior, or symbol ownership. Use code intelligence and verification where those matter.
- Only languages with a supported parser can be rewritten structurally. A file that does not parse cleanly may be skipped with a parse warning.
- The rewrite must map recognizable syntax to replacement syntax. Cross-file transformations that require generated data, control-flow analysis, or several coordinated statements may be better handled as a purpose-built script plus a reviewed diff.
- Comments and formatting do not prevent a syntax match, but a rewrite can still change formatting around the replaced node. Review the rendered diff.
- Large or overly general requests can hit the file ceiling or produce too many valid matches to review safely. Split them by package or code shape.
- Merge-conflict references recognize complete, well-formed Git marker blocks. Incomplete or hand-damaged markers must be inspected as ordinary text.

## Troubleshooting

### “No replacements made”

Ask omp to inspect one concrete example and explain why it did not match. The code may use a different syntax, the path may be too narrow, or symbol-aware editing may be the better operation. Do not broaden to the whole repository until one representative case previews correctly.

### Parse warnings

Have omp identify the affected files and confirm that they parse in their declared language. Fix broken syntax first, exclude generated or unsupported files, or use a tightly scoped text edit when structural parsing is not appropriate.

### Too many or unexpected matches

Reject the proposal. Add import origin, receiver type, enclosing function, package, file glob, or explicit exclusions to the request. If the distinction is symbol identity, request an [LSP-backed rename](/docs/code-intelligence) instead.

### “Limit reached”

Narrow the scope and rerun. The preview is incomplete when the search ceiling is reached, so its count is not a repository-wide total.

### “Preview is stale”

Inspect the current diff because a subset or a changed set of matches may already have been applied. Then ask omp to re-read the files and create a new preview; accept only when the fresh file and replacement counts are expected.

### A `conflict://` reference is unknown or no longer present

Ask omp to read the conflicted file again. This refreshes the session’s conflict index and avoids applying a decision to a block whose markers or surrounding file have changed.

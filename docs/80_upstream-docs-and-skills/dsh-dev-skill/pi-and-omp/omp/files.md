<!--
source: https://omp.sh/docs/files
fetched: 2026-09-06
-->

# Working with files

> Ask omp to explore a project, explain or compare files, extract information from documents and archives, and make precise changes. It can work across your local workspace, supported SSH hosts, web pages, notebooks, images, databases, and common archive formats.

Use file capabilities when you want omp to understand real project context instead of working from pasted snippets. Point it at a directory or file, describe the outcome, and let it narrow the search before changing anything.

## Start with a question

Launch omp in the project you want it to inspect:

```sh
cd my-project
omp
```

Then ask in ordinary language:

```text
Find where refresh tokens are created. Explain the flow and cite the relevant files. Do not edit anything.
```

omp searches the workspace, opens the relevant portions, and reports the paths it used. The final sentence makes this first pass explicitly read-only. Once the explanation looks right, follow up with a bounded change:

```text
Rename issueToken to mintToken across the implementation and its tests. Show me every changed file and run the focused tests.
```

Changes are made directly in the working tree. In the interactive transcript, omp shows the affected path and a colored diff for text changes; creates, moves, and deletes have distinct status rows. Expand a result to inspect more of a large diff. omp does not create a Git commit unless you ask it to.

## What you can ask for

| Goal | Example request |
| --- | --- |
| Understand a codebase | “Map the request path from `POST /login` to the database. Cite the important files and functions.” |
| Find text or files | “Find every test fixture that mentions the legacy host, including ignored fixtures under `testdata/`.” |
| Compare versions or formats | “Compare these two JSON files by meaning, not key order, and summarize the behavioral differences.” |
| Extract document data | “Pull the pricing tables from `vendor-proposal.xlsx` and flag inconsistent totals.” |
| Inspect an archive | “Inside `release.tar.zst`, find the production config and compare it with `config/production.yml`.” |
| Work with a notebook | “Update the plotting cell in `analysis.ipynb` to label both axes; leave the other cells alone.” |
| Inspect a database | “List the tables in `cache.db`, then show the schema and five newest rows from the sessions table. Do not modify it.” |
| Review an image | “Inspect `screenshots/error-state.png` and list the visible error text and layout problems.” |
| Use a remote host | “On `ssh://staging/etc/nginx/nginx.conf`, explain the proxy rules. Do not change the remote file.” |
| Make a bounded change | “In `src/config.ts`, replace the retired endpoint, update its tests, and show the diff.” |

A specific path, desired outcome, and boundary such as “do not edit,” “only change these files,” or “preserve formatting” usually produces the best result.

## Data omp understands

### Local files and directories

omp can navigate directories and inspect text, source code, configuration, logs, and other UTF-8 files. When it first opens a large source file, it may use a structural overview that shows declarations while omitting function bodies. Ask for the exact implementation, quoted lines, or a named function when you need the full text.

Workspace discovery respects `.gitignore` by default. If the answer lives in ignored build output, fixtures, logs, or a `.env` file, say explicitly which ignored path to include. Avoid exposing secret values unnecessarily; ask for variable names or structure rather than contents when that is enough.

Directory listings are depth-limited, and broad searches are capped so one request cannot flood the session. Narrow by directory, extension, symbol, or date when a project is large.

### Documents, notebooks, and images

omp extracts readable content from these document formats:

- PDF
- Word `.docx`
- PowerPoint `.pptx`
- Excel `.xlsx`
- EPUB

Legacy `.doc`, `.ppt`, `.xls`, and `.rtf` files are not converted automatically. Convert them to a modern format, PDF, or plain text first.

Jupyter `.ipynb` files are presented as editable code, Markdown, and raw cells rather than as raw notebook JSON. Existing notebook structure and cell metadata are preserved while cell source is changed. Supported images can be inspected inline; images larger than 20 MiB are rejected.

### Archives and compressed files

omp can list and inspect members without requiring you to unpack most common archives first. Read support includes:

- ZIP and ZIP-based packages such as JAR, APK, and Python wheels
- tar archives, including gzip, bzip2, xz, and zstd variants
- RAR, 7z, ISO, CAB, Debian, RPM, CPIO, ar, static libraries, LZH, ARJ, and ASAR
- single compressed streams using gzip, bzip2, xz, or zstd

Archive mutation is intentionally narrower. omp can change entries in ZIP-based archives (`.zip`, `.jar`, `.war`, `.ear`, `.apk`), `.tar`, `.tar.gz`/`.tgz`, `.tar.zst`, and `.asar`. Other archive formats are read-only; extract and repack them if they must change. Treat archive updates as direct mutations and keep a backup when the archive is not already version-controlled.

### SQLite databases

Files ending in `.sqlite`, `.sqlite3`, `.db`, or `.db3` can be inspected as databases: omp can list tables, show schemas, retrieve rows, and answer bounded query-style questions. It can also insert a row or update or delete a row identified by its key. State “read-only” when you only want analysis, and back up important databases before requesting mutations.

### Web pages, SSH hosts, and omp resources

Give omp an `http://` or `https://` URL to extract the page's main content as clean text. This is best for documentation and articles. If a page depends on JavaScript, authentication, or interaction, ask omp to open it in the browser instead.

A path beginning with `ssh://` can address a configured remote POSIX host. omp can list remote directories, read and search remote UTF-8 files, and write a remote file. Direct remote reads are limited to 1 MiB. The host must be configured and verified, and Windows SSH targets are not supported by this path interface; mount them locally or use an explicit remote shell workflow instead.

omp can also follow its own resource links—for example, cached GitHub issues and pull requests, session artifacts, histories, memory, and plan files. See [GitHub integration](/docs/github) for GitHub resources.

## What to expect when files change

1. **omp inspects before changing.** For ordinary text edits it uses the content it just saw to target the change. If another process changes that content first, omp can reject or recover the stale target instead of blindly applying it.
2. **Approval happens before mutation when your policy requires it.** A rejected approval leaves the target unchanged.
3. **The result is visible immediately.** Text edits show a diff and change counts. Creates, moves, deletes, no-op changes, and errors are labeled separately.
4. **Optional language feedback can follow.** LSP diagnostics and formatting depend on your settings. They are not a substitute for the build or test command you asked omp to run.
5. **The working tree remains yours.** Review with your normal editor or `git diff`, then ask omp to fix anything unexpected.

For symbol-aware renames and diagnostics, see [Code intelligence](/docs/code-intelligence).

## Safety and configuration

The default approval mode is **Yolo**, which allows read, write, and command execution unless a per-capability policy overrides it. For a session that pauses before workspace writes and commands, start omp with:

```sh
omp --approval-mode always-ask
```

You can change this persistently in `/settings` under **Interaction → Approvals**. “Always ask” permits read-only inspection automatically and requests confirmation for writes and command execution. For a design pass that cannot modify the workspace, use [Plan mode](/docs/plan).

File-related LSP controls are under `/settings` in **Files → LSP**. By default, format-on-write is off, diagnostics after a whole-file write are on, and diagnostics after incremental edits are off. Enable **Format on Write** or **Diagnostics on Edit** if you want those behaviors automatically, or ask omp to run a specific formatter or check after the change.

For sensitive or high-impact work:

- Begin with “inspect only” or use Plan mode.
- Name the allowed files and prohibited areas.
- Request a backup before mutating an archive, database, or unversioned remote file.
- Review the displayed diff and `git diff` before asking for a commit.
- Keep secrets out of prompts and diffs whenever their values are not needed.

See [Settings](/docs/settings) for configuration file locations and precedence.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| omp cannot find a local file | Check the path relative to the directory where omp started. Relaunch from the project root or use `omp --cwd /path/to/project`. |
| An ignored file is missing from results | Name the exact ignored directory or file and explicitly ask omp to include ignored content. Do not broadly include secret files. |
| A source file looks incomplete | omp probably returned a structural overview. Ask for the exact body of the named function, a line range, or verbatim content. |
| Results stop after a subset of files | Narrow the request by directory or file type, or ask omp to continue from the remaining matches. |
| An edit is rejected as stale | Another process changed the file after omp inspected it. Ask omp to reopen the current file and retry against the new content. |
| A document cannot be decoded | Confirm it is PDF, `.docx`, `.pptx`, `.xlsx`, or `.epub`; convert legacy Office formats first. |
| An archive can be inspected but not changed | Its format is read-only. Extract it and repack as a supported ZIP, tar, or ASAR format. |
| An SSH path fails | Verify that normal SSH access works, that the host is a POSIX system known to omp, and that the target is UTF-8 and no larger than 1 MiB for direct reads. |
| A web page is empty or incomplete | It likely requires JavaScript, a login, or interaction. Ask omp to use the browser and describe the action you want. |
| Formatting or diagnostics did not run | Ask for the exact formatter/check, or enable the relevant options in `/settings` under **Files → LSP**. |

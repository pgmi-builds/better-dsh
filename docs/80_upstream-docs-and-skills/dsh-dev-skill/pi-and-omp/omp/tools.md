<!--
source: https://omp.sh/docs/tools
fetched: 2026-09-06
-->

# Tools index

> What omp can do, what is available by default, and where to turn capabilities and approvals on or off.

## Ask for the outcome

You normally do not choose or call a tool yourself. Tell omp what you want in ordinary language:

```text
Find where checkout retries are configured, change the default to three, and verify the behavior.
```

omp chooses the suitable search, editing, and execution capabilities. Name a capability only when you want to constrain the approach, such as “inspect this without running it,” “use the browser because the page requires sign-in,” or “do not use the shell.”

Use `/tools` in a session to see the capabilities that are actually available to the current model and project. This is the authoritative live view: settings, installed programs, model support, task depth, custom tools, and connected MCP servers can all change it.

## Control what is available

- Open `/settings` and use **Tools → Available Tools** for persistent on/off switches. Related controls also live under **Files**, **Shell**, **Memory**, and **Tasks**. See [Settings](/docs/settings).
- Start a restricted session with `omp --tools read,glob,grep`, or with no built-ins using `omp --no-tools`. A command-line restriction applies only to that session.
- Use `omp --approval-mode always-ask`, `write`, or `yolo` for a session. The persistent equivalents are `tools.approvalMode` and per-capability `tools.approval.<name>` policies (`allow`, `prompt`, or `deny`). See [Approvals](/docs/approvals).
- `tools.xdev` is on by default. It keeps less-frequently-used and dynamically discovered capabilities in an on-demand catalog rather than loading every description up front. Turning it off changes presentation, not what is permitted.

The approval classes below describe potential impact:

- **Read** inspects state without intentionally changing it.
- **Write** can change files or durable user data.
- **Exec** can run code, control a process, use a network account, or operate an application.
- **Mixed** depends on the action. For example, GitHub reading is Read while checkout or push is Exec.

The built-in approval mode currently defaults to `yolo`, which automatically allows all three classes. Choose `always-ask` if you want confirmation before Write and Exec actions, or deny a capability completely with a per-capability policy. A project, plugin, custom tool, or MCP server is still code you must trust; an approval prompt is not a sandbox.

## Explore code, files, and information

| Capability (selection name) | What you can ask for | Availability and prerequisites | Class | Configure / learn more |
| --- | --- | --- | --- | --- |
| Read files and resources (`read`) | Explain files or directories; extract text from documents, notebooks, archives, images, SQLite databases, supported internal URLs, and known web pages. | On by default. Web-page reading also requires `fetch.enabled` (on by default); SSH and some image/PDF processing can execute local helpers. | Read; some remote/conversion paths are Exec | [Working with files](/docs/files) |
| Find paths (`glob`) | Locate files and directories by name or glob pattern. | On by default with `glob.enabled`. | Read | [Working with files](/docs/files) |
| Search contents (`grep`) | Search local or supported remote content with regular expressions and context. | On by default with `grep.enabled`. | Read; SSH search is Exec | [Working with files](/docs/files) |
| Search code structurally (`ast_grep`) | Find syntax shapes independent of whitespace and formatting. | Off by default; enable `astGrep.enabled`. | Read | [Structural edits](/docs/editing) |
| Use language intelligence (`lsp`) | Find definitions and references, inspect symbols and diagnostics, apply code actions, and perform semantic renames. | On by default with `lsp.enabled`; the relevant language server must be installed or configured. `--no-lsp` disables it for a session. | Mixed: inspection is Read; fixes and renames are Write | [Code intelligence](/docs/code-intelligence) |
| Understand images (`inspect_image`) | Describe or answer questions about a local image through a vision-capable model. | `inspect_image.mode` defaults to `auto`: exposed when the active model cannot inspect images natively. Set it to `on` or `off` explicitly. Requires an available vision model. | Read | [Settings](/docs/settings) |
| Search the live web (`web_search`) | Research a topic and return current results with source links. | On by default with `web_search.enabled`; at least one configured search provider must be available. | Read | [Web & browser](/docs/web) |
| Work with GitHub (`github`) | Read repositories, files, issues, PRs and diffs; search GitHub; check out PRs, push changes, and watch Actions. | Off by default; enable `github.enabled`. Requires the `gh` CLI and authentication for private or mutating operations. | Mixed: views/search are Read; checkout, push, and other account actions are Exec | [GitHub](/docs/github) |

## Change code and run work

| Capability (selection name) | What you can ask for | Availability and prerequisites | Class | Configure / learn more |
| --- | --- | --- | --- | --- |
| Make precise edits (`edit`) | Modify existing text files with checked, line-anchored patches. | On by default. | Write | [Working with files](/docs/files) |
| Create or replace content (`write`) | Create or replace files and supported archive entries, or update supported SQLite rows and user-authored internal resources. | On by default. Also carries on-demand capability requests when `tools.xdev` is enabled. | Write; internal-resource updates may be treated as Read | [Working with files](/docs/files) |
| Apply structural rewrites (`ast_edit`) | Preview syntax-aware codemods and then accept or reject them. | On by default with `astEdit.enabled`; ast-grep support must be available. A preview does not change files until approved. | Write | [Structural edits](/docs/editing) |
| Run shell commands (`bash`) | Build, test, inspect Git state, run one-off programs, and interact with a terminal process. | On by default with `bash.enabled`; `--no-pty` disables interactive PTY execution. Long commands can move to the background automatically. | Exec | [Working with files](/docs/files) |
| Compute in a persistent kernel (`eval`) | Analyze data or run iterative Python, JavaScript, Ruby, or Julia computations while preserving state between steps. | Python and JavaScript backends are allowed by default; Ruby and Julia are opt-in. At least one allowed runtime must be reachable. | Exec | [Working with files](/docs/files) |
| Debug programs (`debug`) | Launch or attach a debugger, set breakpoints, step, and inspect threads, stack frames, scopes, and variables. | On by default with `debug.enabled`, but appears only when a suitable DAP adapter/configuration is available. | Mixed: inspection is Read; launch and process control are Exec | [Debugging](/docs/debugging) |
| Automate a browser (`browser`) | Open interactive or JavaScript-heavy pages, use authenticated tabs, fill forms, click controls, and capture screenshots. | On by default with `browser.enabled`. omp can launch a browser or attach through CDP, the browser relay, or a supported cmux surface; relay use requires its browser extension. | Exec | [Web & browser](/docs/web) |
| Control the desktop (`computer`) | Inspect screens and accessibility state, then operate host applications with keyboard and pointer input. | Off by default; enable `computer.enabled`. Requires the supported desktop helper and OS screen-recording/accessibility permissions. | Mixed: inspection is Read; input is Exec | [Computer control](/docs/computer) |
| Scan for security findings (`security_scan`) | Plan and run native security checks and inspect published findings. | Off by default; enable `security.enabled`. Individual scanners may require their own installed binaries or credentials. | Exec | [Security](/docs/security) |
| Generate or edit images (`generate_image`) | Create an image from a description or transform supplied images. | Off by default; enable `generate_image.enabled`. Requires credentials for a supported image provider. | Write | [Settings](/docs/settings) |
| Generate speech (`tts`) | Turn text into an audio file with local speech generation or a configured voice provider. | Off by default; enable `speechgen.enabled`. The selected path may require a local model download or provider credentials. | Write | [Settings](/docs/settings) |

## Coordinate, supervise, and recover

| Capability (selection name) | What you can ask for | Availability and prerequisites | Class | Configure / learn more |
| --- | --- | --- | --- | --- |
| Answer a structured question (`ask`) | Let omp pause for a choice, confirmation, or missing detail when it cannot safely derive the answer. | On by default with `ask.enabled`; notification and timeout behavior are configurable. | Read | [Settings](/docs/settings) |
| Track phases (`todo`) | Keep a visible multi-step checklist and mark work blocked, active, or complete. | On by default with `todo.enabled`; goal/subagent modes may use their own completion surface instead. | Read | [Subagents](/docs/subagents) |
| Delegate work (`task`) | Fan independent work out to specialist subagents, optionally in isolated workspaces, and collect their results. | Available by default while `task.maxRecursionDepth` permits another level (default depth: 2). Agent definitions and spawn policy can further restrict choices. | Exec | [Subagents](/docs/subagents) |
| Coordinate peers and processes (`hub`) | Message peer agents, follow or cancel background jobs, and supervise shared long-running processes such as dev servers and debuggers. | Available when collaboration is possible at the current task depth. Process supervision also depends on `launch.enabled` (on by default). | Mixed: status and peer messages are Read; starting or driving processes is Exec | [Subagents](/docs/subagents) |
| Save and return to context (`checkpoint`, `rewind`) | Mark a conversational checkpoint and later return the session to it. | Both are off by default and enabled together with `checkpoint.enabled`; primarily available to top-level sessions. | Read | [Settings](/docs/settings) |

## Remember and improve

Memory is off by default. Choose a backend under `/settings` → **Memory** before expecting these capabilities in `/tools`.

| Capability (selection name) | What you can ask for | Availability and prerequisites | Class | Configure / learn more |
| --- | --- | --- | --- | --- |
| Recall durable knowledge (`recall`) | Retrieve relevant facts or past lessons. | Available with the `hindsight` or `mnemopi` backend. | Read | [Memory](/docs/memory) |
| Retain durable knowledge (`retain`) | Save a fact, decision, or lesson for future sessions. | Available with the `hindsight` or `mnemopi` backend. | Read under the memory service's own policy | [Memory](/docs/memory) |
| Reflect across memories (`reflect`) | Synthesize or relate stored knowledge. | Available with the `hindsight` or `mnemopi` backend. | Read | [Memory](/docs/memory) |
| Maintain Mnemopi memory (`memory_edit`) | Inspect, update, merge, or remove records in the local Mnemopi store. | Available only with the `mnemopi` backend. | Read under the memory subsystem's own policy | [Memory](/docs/memory) |
| Capture a reusable lesson (`learn`) | Save a lesson and, when useful, turn it into a managed skill. | Off by default; requires `autolearn.enabled` and a `local`, `hindsight`, or `mnemopi` memory backend. | Mixed: memory-only capture can be Read; files or skills are Write | [Memory](/docs/memory) |
| Maintain managed skills (`manage_skill`) | Create, improve, inspect, or retire auto-learned skills. | Off by default with `autolearn.enabled`; normally exposed only in a top-level session. | Write | [Skills](/docs/skills) |

## Outcome-oriented built-in workflows

These are user entry points rather than general-purpose tools, but they may use several capabilities above on your behalf.

| Workflow | First action | What it does | Learn more |
| --- | --- | --- | --- |
| Code review | Run `/review`, then choose a base branch, uncommitted changes, a commit, a PR, or custom instructions. | Distributes a diff across reviewer agents and returns prioritized findings. | [Review](/docs/review) |
| Commit | Run `omp commit`; add `--dry-run` when you only want a preview. | Analyzes changes, proposes conventional commit grouping and changelog updates, then commits; pushing is opt-in. | [Commit](/docs/commit) |
| Goal mode | Run `/guided-goal` for an interview, or `/goal` when the objective is already clear. | Keeps working toward one durable, budgeted objective across turns. Its mode-only helper appears only while goal mode needs it. | [Goal mode](/docs/goal) |
| Plan mode | Run `/plan` before asking for a risky or ambiguous implementation. | Restricts the planning phase to read-only exploration and presents a plan for review before execution. | [Plan mode](/docs/plan) |
| Vibe mode | Run `/vibe [prompt]` to start direct persistent fast/good worker sessions. | Turns the main session into a director that starts, steers, verifies, and stops persistent workers. | [Vibe mode](/docs/vibe) |
| Autoresearch | Add an `autoresearch.sh` benchmark harness to a clean Git worktree, then run `/autoresearch [goal]`. | Runs repeated benchmark-backed experiments on a dedicated `autoresearch/*` branch. Some reset/discard controls are destructive; review the dashboard and baseline first. | [Modes](/docs/modes) |

Internal completion and reasoning helpers used by goal mode, subagents, or some model families are intentionally not user-selectable capabilities and are not shown as things to configure.

## Add capabilities

The live `/tools` list can contain more than the built-ins above:

| Source | How it becomes available | Trust and configuration |
| --- | --- | --- |
| Custom tools | omp discovers user- or project-authored JavaScript/TypeScript tools when a session starts. | They run as your user. Review project code before loading it; see [Custom tools](/docs/custom-tools). |
| MCP servers | Connected servers publish their own tools and resources; project `.mcp.json`/`mcp.json` discovery is allowed by default. | A server may reach external accounts or execute local code. Configure and authenticate it through [MCP](/docs/mcp). |
| Extensions and plugins | Trusted extensions can register tools; plugins can bundle tools with commands, agents, rules, or server configuration. | Inspect the source and declared contents before enabling it; see [Extensions](/docs/extension-authoring) and [Plugins](/docs/plugins). |
| Host applications | SDK, RPC, and ACP hosts can supply capabilities for their session. | Availability and approval are controlled by that host; see [SDK](/docs/sdk), [RPC](/docs/rpc), and [ACP](/docs/acp). |

## Report a capability problem

Automated tool QA (`xd://report_issue`) is on by default with `dev.autoqa`. When omp detects behavior that contradicts a capability's documented contract, it can record a report; the first report asks whether you consent to sharing it. Use `omp grievances` to inspect recorded reports, and change **Tools → Developer → Auto QA** in `/settings` to disable reporting. This support path does not give omp another way to modify your project.

If a capability you expected is missing, check `/tools`, then its enable setting and prerequisite above. Restart the session after changing discovered tool, extension, plugin, or MCP configuration so the live catalog can be rebuilt.

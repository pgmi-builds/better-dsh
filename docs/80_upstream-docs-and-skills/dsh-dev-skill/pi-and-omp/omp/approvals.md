<!--
source: https://omp.sh/docs/approvals
fetched: 2026-09-06
-->

# Tool approvals

> Choose which capabilities run immediately, which stop for confirmation, and which never run.

## Pick a policy

Tool approvals protect the boundary between a model proposing an action and omp running that action with your account's access. They are most useful for mutations, command execution, browser or desktop control, and delegated work. They do not make model output trustworthy or sandbox an allowed command.

The built-in default is **`yolo`**. For an interactive coding session, a safer starting point is **`write`**:

```yaml
# ~/.omp/agent/config.yml
tools:
  approvalMode: write
```

You can also choose **Tool Approval** in `/settings`. The mode names describe the highest capability tier that runs without a prompt:

| Mode | Runs immediately | Prompts |
| --- | --- | --- |
| `always-ask` | Read-only calls | Workspace/session writes and executable actions |
| `write` | Read-only calls and workspace/session writes | Executable actions such as `bash`, `eval`, browser control, and `task` |
| `yolo` | Read, write, and executable calls | Nothing based on tier alone |

Despite its name, `always-ask` does not ask for ordinary reads. Unknown or malformed custom-tool declarations are treated as executable, the conservative tier. MCP server tools are normally write-tier.

Use a launch flag for a one-off session; it overrides configuration without saving it:

```sh
omp --approval-mode always-ask
omp --approval-mode write "fix the failing test"
omp --approval-mode yolo "apply the reviewed migration"

# Aliases that force yolo for this process
omp --auto-approve "run the release script"
omp --yolo "run the release script"
```

## Recommended setups

### Interactive work

Use `write` when you want routine reads and edits to flow but want to inspect commands and other broad execution. Use `always-ask` when every mutation should cross a human boundary.

```yaml
tools:
  approvalMode: write
  approval:
    eval: prompt
    computer: prompt
```

### Unattended automation

A prompt cannot be answered when no interactive approval UI is attached. Use an explicit `yolo` mode, then deny or prompt capabilities the job should not exercise. In truly headless work, prefer `deny`: a `prompt` policy fails the call rather than waiting forever.

```yaml
# ci-approvals.yml
tools:
  approvalMode: yolo
  approval:
    computer: deny
    browser: deny
    eval: deny
```

```sh
omp --config ./ci-approvals.yml --print "update generated files and report the diff"
```

Treat this as permission design, not just prompt suppression. Run automation in a suitably restricted account or container and grant only the tools it needs.

### ACP clients

ACP uses the same global, project, overlay, and runtime settings. Approval requests are presented by the ACP client: filesystem and shell capabilities use the client's permission request when available, while other omp prompts use form elicitation when supported. Rejection, cancellation, or an unsupported required prompt stops the call.

The schema default is `yolo`, but an otherwise default ACP session still keeps the client permission gate for `bash`, `edit`, `delete`, and `move`. Opt in explicitly if the client is meant to run unattended:

```sh
omp acp --approval-mode yolo
# equivalent:
omp acp --yolo
```

An explicitly configured `tools.approvalMode: yolo` also skips that ACP gate unless a per-tool policy says `prompt` or `deny`. ACP has no per-session approval field in `session/new`, `session/load`, or `session/resume`; launch a separate `omp acp` process or give it a session-specific `--config` overlay. See [ACP](/docs/acp) for client setup.

## Override individual capabilities

`tools.approval` is a map keyed by the tool or mounted capability name. Each value is:

- `allow` — run without the mode's tier prompt unless a stronger tool policy requires otherwise;
- `prompt` — ask in an interactive session unless a stronger tool policy already decides the call;
- `deny` — block before execution; this always wins over allow/prompt decisions.

Overrides apply in every mode, so they can loosen `always-ask` or tighten `yolo`:

```yaml
tools:
  approvalMode: write
  approval:
    bash: prompt
    read: allow
    eval: deny
    computer: deny
    mcp__filesystem__delete: deny
```

Use the exact tool name shown in a pending/completed call or in [Tools](/docs/tools). For a mounted `xd://` capability, its own policy is checked first; if none exists, the outer `write` policy is the fallback. Invalid policy strings are ignored, so use only `allow`, `prompt`, or `deny` and audit the effective YAML with:

```sh
omp config get tools.approvalMode
omp config get tools.approval
```

For command-specific shell rules, use ordered `bash.patterns`; the first matching rule wins. `deny` and `prompt` rules can catch a matching segment of a compound command, while `allow` must match the complete, non-compound command.

```yaml
tools:
  approvalMode: yolo
  approval:
    eval: deny       # bash rules do not cover a shell spawned through eval

bash:
  patterns:
    - match: "git status*"
      approval: allow
    - match: "rm -rf *"
      approval: deny
    - match: "*deploy*"
      approval: prompt
```

A `bash.patterns` rule governs only the `bash` tool. If `eval` may spawn a shell, gate `eval` separately as above.

## What an approval prompt means

The prompt is built from the call that will actually execute, after any extension has revised its input. It offers **Approve** and **Deny** and shows:

- `Allow tool: <name>`;
- the MCP origin when relevant;
- a policy or safety reason, when supplied;
- tool-specific details such as a command, path, code, browser action, or subagent assignment.

Long details are truncated for display. Read the target, scope, and values rather than approving from the tool name alone. Approval is for that call; it is not a standing promise that later calls have the same arguments.

## How omp reaches a decision

For each call, omp first asks the tool for its capability tier and any argument-dependent policy, then combines that with your configuration:

1. A tool-declared `deny` wins.
2. Your per-capability `deny` wins next.
3. A tool-declared safety policy may explicitly allow or prompt. In non-yolo modes, a safety override prompts unless the tool explicitly allows it.
4. Your valid `allow` or `prompt` applies when a stronger tool policy did not decide the call.
5. Otherwise the mode compares the call's `read`, `write`, or `exec` tier with the mode table above.

In `yolo`, a bare tool safety override does not itself prompt, but an explicit tool `prompt`, your `prompt`, either kind of `deny`, and provider safety checks still apply. This distinction explains why two calls to the same tool can behave differently: the arguments can select a different tier or policy.
For example, `bash` recognizes a narrow set of critical shapes such as recursive destruction of absolute paths, remote-fetch-then-execute, host shutdown, and writes to sensitive account files. That built-in check forces a prompt in non-yolo modes but is a bare override, so `yolo` skips it. To make a boundary absolute under `yolo`, configure a `bash.patterns``deny` or a per-tool `deny`; use `prompt` where an interactive review is required.

Tool and extension enforcement is separate from the mode calculation. An extension may block a call, a tool may reject unsafe or invalid input, the operating system or provider may withhold permission, and a runtime error may stop an already approved action. Tool authors can declare these boundaries; see [Custom tools](/docs/custom-tools#optional-behavior).

## Computer and provider safety

The `computer` capability is disabled by default. When enabled, a call declaring `read_only: true` is read-tier; a mutating, missing, or malformed declaration is exec-tier. Its approval prompt marks read-only calls and shows the submitted code. The declaration selects the gate—it is not static proof that arbitrary code is harmless.

Provider-originated computer calls can also carry pending safety checks. Those checks **always require interactive confirmation**, even in `yolo`, with `computer: allow`, or after approval of an outer mounted-capability dispatch. The prompt lists the provider's check codes, messages, and sanitized data. With no interactive UI, omp fails closed.

Even after approval, consequential real-world actions may stop for point-of-risk confirmation unless your direct request already authorized the exact target, scope, and values. Text on a web page or desktop is untrusted and cannot grant that authorization. `yolo` removes omp's ordinary tier prompt; it does not override provider checks, tool or extension denials, direct-user-authorization rules, OS permissions, or service-side safeguards.

## Headless sessions and subagents

A headless session cannot satisfy a required omp prompt. The call fails with `requires approval but no interactive UI available`; provider safety checks report their own fail-closed error. Change the mode, add a narrowly scoped `allow`, or run through an interactive UI—do not add broad permission merely to hide the error.

Subagents are also headless. They run ordinary tier decisions as `yolo` because approval of the parent `task` call is their authorization boundary. Your `tools.approval` map is still inherited: `deny` blocks, `allow` runs, and `prompt` cannot be answered and therefore rejects the subagent call. Review the parent task's assignment and isolation choice before approving it.

## Precedence and auditing

From strongest configuration layer to weakest, approval settings resolve as:

1. runtime flags (`--approval-mode`, `--auto-approve`, `--yolo`);
2. later `--config` overlays, then earlier overlays;
3. project config (`.omp/config.yml` over legacy `.omp/settings.json`);
4. global `~/.omp/agent/config.yml`;
5. the built-in default.

Mappings are deep-merged, so a project can add one `tools.approval` entry without erasing unrelated global entries. Arrays such as `bash.patterns` are replaced wholesale by the higher layer. See [Settings](/docs/settings) for all config locations.

To audit an unexpected result:

1. Run `omp config get tools.approvalMode` and `omp config get tools.approval` from the same working directory.
2. Check launch flags and every `--config` file; runtime flags win and later overlays win.
3. Match the exact tool/capability name and inspect any `Reason:` in the prompt or error.
4. For `bash`, inspect the first matching `bash.patterns` rule; then check whether the action actually used `eval` instead.
5. Decide whether the result came from user policy, a tool/extension policy, ACP permission, a provider safety check, or the absence of an interactive UI.

If a call prompts unexpectedly in `always-ask` or `write`, its arguments may have raised it to `write` or `exec`, or an explicit prompt/safety override may be active. If a call runs unexpectedly in `yolo`, remember that tier prompts are intentionally skipped; add `tools.approval.<name>: prompt` or `deny`. If a call is denied in every mode, remove or change the exact user `deny` only if appropriate—`yolo` cannot defeat an authoritative tool or provider boundary.

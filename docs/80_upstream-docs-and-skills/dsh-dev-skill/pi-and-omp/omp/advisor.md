<!--
source: https://omp.sh/docs/advisor
fetched: 2026-09-06
-->

# Advisor models

> Add an optional reviewer model that watches omp's work, catches risky mistakes, and steers the main agent before they become expensive.

## Add a second set of eyes

An advisor is a separate model that reviews the main agent's work as the session unfolds. It can flag a missed requirement, a risky API, weak verification, or unnecessary complexity while the main agent still has a chance to correct course. Use one for long or high-stakes changes, unfamiliar repositories, security-sensitive work, or whenever independent review is worth more than maximum speed.

The tradeoff is real: the advisor makes its own model requests, uses its own context, and is billed separately. A larger model may catch subtler problems but costs more; several advisors multiply that usage. Review normally happens in the background, but an important note can cause more main-agent work, and optional catch-up settings can add latency. For routine edits, leave it off or choose a fast, inexpensive reviewer.

The smallest persistent setup is two entries in [`~/.omp/agent/config.yml`](/docs/settings):

```yaml
modelRoles:
  advisor: anthropic/claude-sonnet-4-5:medium

advisor:
  enabled: true
```

Use any model selector available in your installation. Restart omp or start a new session after editing the file, then check it:

```text
/advisor status
```

With no `WATCHDOG.yml` roster, omp creates one default advisor using `modelRoles.advisor`. If the role does not resolve to an available, authenticated model, the feature is configured but cannot run.

## What happens during a session

The advisor follows new user prompts, main-agent responses, reasoning, and tool activity. Its default tools let it read and search the project, so it can verify claims instead of reviewing prose alone. It does not approve the main agent's actions and its advice is not automatically correct: the main agent is instructed to weigh each note against your request rather than obey it blindly.

Accepted notes appear visibly in the session with one of three severities:

| Severity | Meaning | What omp does |
| --- | --- | --- |
| `nit` | Cleanup, simplification, or a low-risk edge case. | Adds a non-interrupting aside at a safe boundary. |
| `concern` | A material risk, missed constraint, or likely wrong direction. | Can steer work that is still running; a late note after a completed answer remains visible for the next turn. |
| `blocker` | Continuing is likely to waste work or produce a broken result. | Can interrupt active work and can trigger follow-up even after a nominally completed answer. |

Only a blocker may interrupt a partially completed review. Repeated or content-free notes are suppressed, and after an interrupt omp normally gives the main agent several turns before allowing another advisor interrupt. If you deliberately stop the agent, advisor notes stay visible instead of unexpectedly restarting it. In plan mode, notes are also shown for you to consider rather than steering the plan automatically.

Treat a note as informed review, not a new user instruction. If the main agent rejects useful advice, refer to the visible note in your next prompt. If the advisor is creating noise, turn it off for the session or narrow its priorities in `WATCHDOG.md`.

## Inspect and control it

| Command | Result |
| --- | --- |
| `/advisor` | Toggle all configured advisors for this session. |
| `/advisor on` | Enable or rebuild them for this session. This does not save `advisor.enabled`. |
| `/advisor off` | Stop them for this session. This does not change your config file. |
| `/advisor status` | Show each advisor's state, model, context use, token use, and cost. |
| `/advisor dump` | Copy a compact advisor transcript to the clipboard. |
| `/advisor dump raw` | Copy the full diagnostic dump, including instructions, thinking, and tool activity. Handle it as sensitive data. |
| `/advisor configure` | Open the interactive editor for project- or user-level `WATCHDOG.yml`. TUI only. |

A bare `/advisor` is a toggle, not a status command. Session toggles are temporary; edit [`config.yml`](/docs/settings) when you want the choice to persist.

## Give the reviewer project-specific priorities

Put reviewer-only guidance in `WATCHDOG.md`. This is the best place for architectural boundaries, dangerous APIs, recurring failure modes, and the evidence you expect before a change is called complete. It guides advisors without adding the same material to the main agent's ordinary context.

```markdown
# Review priorities

Especially watch for:

- Writes that bypass the durable queue in `src/jobs/`.
- User-controlled text rendered without escaping.
- Schema changes without a backwards-compatible rollout.
- Claims of success that are not supported by a focused runtime check.
```

Keep it specific enough to change a review decision. General requests such as “write good code” add cost but little signal.

omp loads every readable `WATCHDOG.md` on this path:

1. the active user agent directory, normally `~/.omp/agent/WATCHDOG.md`;
2. `WATCHDOG.md` and `.omp/WATCHDOG.md` in the current directory;
3. the same two locations in each parent directory up to the Git root, or up to your home directory when there is no Git root.

The user file is broad guidance. Project files are applied from outer directories toward the current directory, so narrower guidance is most prominent. Files accumulate rather than the nearest one replacing the others. You can also place a line such as `@review/security.md` in a watchdog file to import another file; relative paths resolve beside the importing file, and imports inside code spans or fenced code blocks remain literal.

## Configure several specialist advisors

Use `WATCHDOG.yml` or `WATCHDOG.yaml` when one reviewer is not enough. The file declares a roster; once any roster entries are discovered, that roster replaces the single default-advisor arrangement.

```yaml
instructions: |
  Prefer fixes that preserve public APIs and keep tests focused.

advisors:
  - name: Architecture
    enabled: true
    model: anthropic/claude-sonnet-4-5:medium
    tools: [read, grep, glob]
    instructions: |
      Watch module boundaries, dependency direction, and public API growth.

  - name: Security
    enabled: true
    model: openai/gpt-5.5:high
    tools: [read, grep, glob]
    instructions: |
      Trace untrusted input through authentication, storage, and rendering.

  - name: Release
    enabled: false
    tools: []
    instructions: |
      Check migrations, compatibility, and rollback instructions.
```

| Field | Purpose |
| --- | --- |
| top-level `instructions` | Shared guidance added to every advisor from all discovered roster files. |
| `name` | Required display name. Names also identify entries for precedence; punctuation and spacing normalize to a slug. |
| `enabled` | Per-advisor switch. Defaults to `true`; `false` leaves the entry visible as paused. |
| `model` | Optional model selector and thinking level. When omitted, the entry uses `modelRoles.advisor`. |
| `tools` | Optional built-in tools. Omitted gives `read`, `grep`, and `glob`; `[]` gives no investigative tools. |
| `instructions` | This advisor's specialization. It supports the same `@` imports as `WATCHDOG.md`. |

Roster files use the same user, ancestor, current-directory, and `.omp/` discovery locations as `WATCHDOG.md`. All discovered files participate. Shared top-level instructions accumulate; when two entries normalize to the same name, the more specific project entry replaces the ancestor or user entry. Avoid defining the same name twice at the same directory level or keeping both `.yml` and `.yaml` variants there—the result is harder to reason about. Invalid YAML or an invalid schema is logged and that file is skipped rather than breaking the main session.

### Tool grants are a security boundary

The default `read`/`grep`/`glob` grant is appropriate for review. A roster may grant other built-ins, including `edit`, `write`, `bash`, `eval`, or `browser`. Those grants can change files, run commands, or send data through another service. Normal approval and per-tool policies still apply, but a permissive approval mode may not stop a bad action. Grant mutating or networked tools only to a model you trust and only when the specialist genuinely needs them.

Unknown tool names are dropped with a warning. Check `/advisor status` and the logs after changing a roster rather than assuming a misspelled tool was granted.

## Cost, latency, and supervision settings

These optional settings belong in [`config.yml`](/docs/settings):

```yaml
advisor:
  enabled: true
  syncBacklog: "1"
  immuneTurns: 3

tier:
  advisor: none
```

| Setting | Default | Use it for |
| --- | --- | --- |
| `advisor.syncBacklog` | `off` | `off` never waits for review catch-up. `"1"`, `"3"`, or `"5"` pauses the main agent for up to 30 seconds when review falls that many turns behind; `"1"` is the closest to synchronous review. Quote numeric values in YAML because these are enum strings. |
| `advisor.immuneTurns` | `3` | Number of main-agent turns after an interrupt during which further concerns and blockers become non-interrupting asides. Use `0` for maximum supervision, or a larger value to reduce churn. |
| `tier.advisor` | `none` | Service tier for advisor requests. `inherit` follows the main model's live provider-family tier; concrete tiers apply only where the provider supports them. |

Even with catch-up enabled, advisor trouble does not permanently stall the main agent: catch-up waits are bounded and released on failure.

## One-off and headless runs

Enable review for one print-mode process without changing persistent settings:

```sh
omp -p --advisor "Audit this migration plan and report the safest rollout."
```

`--advisor` enables the configured default or roster for that process; it still needs resolvable advisor models and provider credentials. Print mode waits for final review before disposal so late notes are not silently lost, which can make the command finish later than an ordinary `-p` run. Use it selectively in automation and account for both the extra model cost and the longer completion time. See the [CLI reference](/docs/cli) for other launch flags.

## Privacy and safety

Enabling an advisor sends session material to the advisor model's provider. That includes your prompts, the main agent's output and reasoning, and relevant tool results; investigative tools can expose any files they read. Session-managed secrets are obfuscated before provider-bound advisor messages, but this is not a substitute for choosing a provider and model allowed to process the repository. A multi-provider roster may send the same project context to several vendors.

Advisor turns and usage are recorded with the owning session so cost reporting and later inspection work. `/advisor dump raw` contains substantially more detail than the compact dump; review it before pasting it into an issue or chat. Turning the advisor off stops new reviews but does not erase already recorded session artifacts.

omp rejects unsafe advisor output before it can dispatch tools or steer the main agent. This is defense in depth, not permission to grant broad tools: keep the least-privilege roster, retain normal approval policies, and inspect any proposed high-impact change yourself.

## Troubleshooting

- **“Advisor setting is enabled, but no model is assigned” / `no model`** — set `modelRoles.advisor`, or add a valid `model` to every enabled roster entry. Confirm the provider is installed and authenticated with `/model` and `/login`, then run `/advisor off` followed by `/advisor on`.
- **An advisor shows `paused`** — its roster entry has `enabled: false`, or the subsystem is off for this session. Enable the entry in `WATCHDOG.yml` (or `/advisor configure`) and run `/advisor on`.
- **An advisor shows `quota exhausted`** — its provider/account hit a usage limit after fallback recovery was unable to continue. Fix credentials, quota, or the model choice, then toggle the advisor off and on, reload configuration, or start a new session.
- **An advisor shows `error`** — repeated or permanent request failures halted that reviewer so the main agent could continue. Check provider/model availability and logs, then use `/advisor off` and `/advisor on` to rebuild it.
- **One roster member fails while others run** — entries are independent. Fix that member's model or enabled state; the rest can continue reviewing.
- **Changes to `WATCHDOG.yml` do not appear** — check the filename and YAML shape, make sure omp is running in the project tree you intended, then restart omp after a manual file edit. Changes saved through `/advisor configure` apply immediately. A malformed file is skipped and reported in logs.
- **Review is too expensive or distracting** — choose a cheaper model, reduce the roster, keep `syncBacklog: off`, raise `immuneTurns`, narrow watchdog instructions, or use `/advisor off` for routine work.
- **A late concern did not restart the agent** — this is expected after a completed answer, after your deliberate interrupt, and in plan mode. The visible note is included when you continue with a new prompt or the continue shortcut.

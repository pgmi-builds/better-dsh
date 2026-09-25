<!--
source: https://omp.sh/docs/roles
fetched: 2026-09-06
-->

# Model roles

> Route everyday work, quick utility work, planning, vision, and subagents to the right models without choosing a model for every request.

## Route work by purpose

Model roles let omp use different models for different kinds of work. You might keep a balanced model for the main session, a faster model for lightweight work, and a stronger reasoning model for difficult planning or review. Configure each role once; features that use that role pick it automatically.

You do not have to configure roles before using omp. After you sign in to a provider, omp automatically chooses usable models for unassigned built-in roles. Start with the defaults, then pin a role only when you want predictable quality, latency, cost, or provider usage.

A role chooses **which model** handles a kind of work; an agent also chooses **how that worker behaves and what it can use**. See [Agents & model roles](/docs/agents-and-roles) when you are deciding which layer to change.

The quickest way to make an assignment is:

1. Enter `/model` (or press <kbd>Alt</kbd>+<kbd>M</kbd>).
2. Open **Roles**.
3. Select a role, choose a model, and optionally choose its thinking level.
4. Return to **Roles** to see the effective assignment.

Most people only need to consider these roles:

| Role | Configure it when… |
| --- | --- |
| `default` | You want to choose the model for normal interactive work. |
| `smol` | You want lightweight work to favor speed and cost. It is also the usual handoff target for [prewalk](/docs/prewalk). |
| `slow` | You want difficult reasoning and review to use a stronger model. |
| `plan` | You want [plan mode](/docs/plan) to use a dedicated architect model. |
| `vision` | Your main model cannot inspect images, or you want image analysis routed elsewhere. |

## What happens automatically

With an empty `modelRoles` map, omp resolves roles from the models that are available and authenticated. Specialized features therefore work without a complete role map.

A few defaults are worth knowing:

- `default` is the main session model.
- Unassigned `smol`, `slow`, and `designer` roles can use the configured `default` model before omp looks for another suitable model.
- Unassigned `tiny` work follows the fast-model preference used by `smol`.
- An unassigned `advisor` seeks a separate strong reasoning model rather than inheriting `default`. See [Advisor](/docs/advisor) for the advisor workflow.
- If no usable model can satisfy a role, omp skips that route or shows an actionable model/authentication error instead of silently using an unauthenticated provider.

Automatic choices can change as providers, credentials, or the model catalog change. Pin the roles whose behavior must remain stable.

## Assign roles in the model hub

`/model` and <kbd>Alt</kbd>+<kbd>M</kbd> open the full model hub. Its **Roles** view is the recommended configuration surface because it shows both explicit assignments and automatic choices.

- Selecting a role opens the available model catalog.
- Selecting a model lets you choose a supported thinking level.
- Clearing an explicit assignment returns the role to automatic selection.
- The view also manages the <kbd>Ctrl</kbd>+<kbd>P</kbd> quick-cycle order and retry fallback chains.
- Locked providers lead to sign-in rather than creating an unusable assignment.

By default, assignments are global and are saved in the active profile's agent configuration (normally `~/.omp/agent/config.yml`). To allow per-project assignments, set:

```yaml
modelRoleStorage: project
```

The hub will then ask whether to save an assignment globally or for the current project. Project assignments are written to `.omp/config.yml`; a role missing there continues to use its global assignment.

## Configure roles in YAML

The smallest useful manual configuration is a `modelRoles` map in `~/.omp/agent/config.yml`:

```yaml
modelRoles:
  default: anthropic/claude-sonnet-4-6
  smol: anthropic/claude-haiku-4-5
  slow: openai-codex/gpt-5.3-codex:high
  plan: anthropic/claude-opus-4-6:high
```

Use `omp models find <name>` to find selectors available in your installation. An explicit `provider/model-id` is the most predictable value. A thinking suffix can be `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, or `auto`; unsupported levels are constrained to what the selected model supports.

Role values also accept:

| Form | Meaning | Example |
| --- | --- | --- |
| Model selector or pattern | Select a matching model. Prefer a full provider-qualified selector in durable config. | `google/gemini-3-pro` |
| Ordered selectors | Try comma-separated selectors from left to right and use the first available match. | `anthropic/claude-sonnet-4-6,openai/gpt-5.4` |
| Role alias | Reuse another configured role. `@role` is canonical; `*` means `@default`. | `task: "@slow"` |
| Thinking suffix | Pin or automatically choose effort for this role. | `openai-codex/gpt-5.3-codex:xhigh` |

`pi/role` remains accepted as a legacy role alias, but new configuration should use `@role`.

## Override roles for one launch

Launch flags and environment variables are useful for an experiment or script. They do not rewrite your saved role assignments.

| Target | Shell flag | Environment variable | Precedence |
| --- | --- | --- | --- |
| Active main model | `--model <selector>` | — | Launch flag |
| `smol` | `--smol <selector>` | `PI_SMOL_MODEL` | Flag, then environment, then config/automatic choice |
| `slow` | `--slow <selector>` | `PI_SLOW_MODEL` | Flag, then environment, then config/automatic choice |
| `plan` | `--plan <selector>` | `PI_PLAN_MODEL` | Flag, then environment, then config/automatic choice |

For example:

```sh
omp --model @default --slow openai-codex/gpt-5.3-codex:xhigh
PI_SMOL_MODEL=anthropic/claude-haiku-4-5 omp
```

`--model` chooses the active model for that session; it is not a persistent `modelRoles.default` assignment.

## Switch and verify in a running session

| Control | Result |
| --- | --- |
| `/model` or `/models` | Open the persistent model-and-role hub. Use **Roles** to inspect and edit assignments. |
| <kbd>Alt</kbd>+<kbd>M</kbd> | Open the same persistent hub. |
| `/switch` or <kbd>Alt</kbd>+<kbd>P</kbd> | Choose a model for the current session only. It does not change role configuration. |
| <kbd>Ctrl</kbd>+<kbd>P</kbd> | Move forward through the configured quick-role cycle. |
| <kbd>Shift</kbd>+<kbd>Ctrl</kbd>+<kbd>P</kbd> | Move backward through the configured quick-role cycle. |

The default cycle is `smol` → `default` → `slow`. omp skips roles that have no usable assignment; if only one role model is available, it reports that there is nothing to cycle to. Cycling changes the active model for the current session, not the saved role map.

Change the order in the Roles view or with `cycleOrder`:

```yaml
cycleOrder:
  - default
  - slow
  - smol
```

After an assignment, reopen `/model` and inspect **Roles** to verify the model and thinking level that omp resolved. For the main session, the status line also shows the active model after switching or cycling.

## All built-in roles

| Role | Work routed to it |
| --- | --- |
| `default` | Normal interactive work and the main-session default. |
| `smol` | Fast, inexpensive utility work and fast handoff paths. |
| `slow` | Thorough reasoning where extra latency is acceptable. |
| `vision` | Image inspection when a vision-capable model is needed. |
| `plan` | Plan-mode architecture and review. |
| `designer` | The designer subagent. |
| `commit` | Commit-message generation; commit flows can fall through to other usable roles when this is unassigned. |
| `tiny` | Very small online classifications, titles, memory support, and speech cleanup; when unassigned it follows the `smol` preference. |
| `task` | General subagent work when the agent does not request another model. |
| `advisor` | The independent reasoning model used by [Advisor](/docs/advisor). |

Extensions and authored agents can introduce additional role names. A custom role becomes visible in the model hub when it appears in `modelRoles`, `cycleOrder`, or `modelTags`; the extension or agent must actually refer to that role for work to be routed through it.

## Add retry fallback models

Role assignment chooses the preferred model. Retry fallback chains say where omp may move when an eligible request failure or quota condition makes that model unavailable.

The easiest setup is in `/model` → **Roles**: add fallback rows beneath a role, or choose **New fallback** to protect a particular model or provider. Order matters; omp tries usable entries from top to bottom.

A minimal YAML chain looks like this:

```yaml
retry:
  modelFallback: true
  fallbackChains:
    default:
      - openai/gpt-5.4
      - google/gemini-3-pro
  fallbackRevertPolicy: cooldown-expiry
```

A `default` chain is also used for configured roles that do not have their own chain. Give a role its own list when it needs different cost, capability, or provider boundaries:

```yaml
retry:
  fallbackChains:
    default:
      - openai/gpt-5.4
    vision:
      - google/gemini-3-pro
    "google-antigravity/*":
      - google/*
      - google-vertex/*
```

Fallback-chain keys and entries have stricter syntax than role values:

| Syntax | As a key | As a fallback entry |
| --- | --- | --- |
| Role name, such as `default` or `vision` | Protect that role's selected model. | Not used as an entry; name a model instead. |
| `provider/model-id` | Protect that exact active model, regardless of which role selected it. | Switch to that exact model. A thinking suffix is allowed. |
| `provider/*` | Protect any active model from that provider. | Keep the current model id and try it through the named provider. |
| `provider/id-prefix/*` | Protect matching ids under that provider-side prefix. | Re-prefix the current bare model id for routing providers such as OpenRouter. |

Use full provider-qualified selectors in fallback arrays. Every fallback also needs working credentials and a catalog entry; unavailable candidates are skipped.

## Role and fallback settings reference

### Routing settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `modelRoles` | `{}` | Map role names to model selections. Empty built-in roles resolve automatically. |
| `modelRoleStorage` | `global` | `global` saves role changes in the active profile; `project` enables global/project choice and `.omp/config.yml` overrides. |
| `cycleOrder` | `[smol, default, slow]` | Ordered role names used by the <kbd>Ctrl</kbd>+<kbd>P</kbd> quick cycle. |
| `modelTags` | `{}` | Optional display metadata for built-in or custom roles: `name`, optional theme `color`, and optional `hidden`. |

### Retry fallback settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `retry.modelFallback` | `true` | Allow retry recovery to switch to configured fallback models. |
| `retry.fallbackChains` | `{}` | Map a role, exact model, provider wildcard, or prefixed provider wildcard to an ordered array of fallback selectors. |
| `retry.fallbackRevertPolicy` | `cooldown-expiry` | `cooldown-expiry` returns to the primary after its suppression window; `never` stays on the fallback until you switch manually. |
| `retry.usageAwareFallback` | `false` | Use reliable coding-plan quota reports to move between accounts and then configured models before a hard limit. Ordinary API-key quotas are not inferred. |
| `retry.usageReservePct` | `10` | Remaining coding-plan percentage treated as the reserve margin when usage-aware fallback is enabled. |
| `retry.usageReservePolicy` | `confirm` | `confirm` asks in interactive sessions (background agents fall back automatically), `auto` always selects the next eligible fallback, and `fail-closed` uses neither reserve quota nor a fallback. |

See [Settings](/docs/settings) for configuration precedence and [Providers](/docs/providers) for credentials and provider-specific model discovery.

## Troubleshooting

### A role resolves to the same model as another role

That can be automatic behavior, especially for unassigned `smol`, `slow`, or `designer`. Assign the role explicitly in `/model` → **Roles** if you need separation.

### Ctrl+P says only one role model is available

Open `/model` and check the roles named in `cycleOrder`. Assign at least two to available, authenticated models. The quick cycle skips missing or unusable assignments; `--models` scopes the model catalog for a launch but does not replace `cycleOrder`.

### A change disappears in another project—or appears everywhere

Check `modelRoleStorage`. With `global`, hub changes apply across projects. With `project`, inspect whether the Roles view saved the assignment to **project** or **global**; `.omp/config.yml` overrides the global value only for that project.

### omp reports an unknown model or missing API key

Run `omp models find <name>` and use a listed `provider/model-id`, then sign in with `/login` or configure that provider's credential. If a provider has just published a model, run `omp models refresh` before searching again.

### A fallback never runs

Confirm that `retry.modelFallback` is `true`, that the active role/model has a matching non-empty chain, and that at least one fallback has valid credentials. Role aliases and fuzzy names are useful in `modelRoles`, but fallback arrays should use concrete `provider/model-id` selectors or supported provider wildcards.

### A fallback runs but does not return to the primary

Set `retry.fallbackRevertPolicy: cooldown-expiry` to return after the primary model's suppression window. With `never`, switch manually using `/switch`, `/model`, or the model keybindings.

### Image inspection says no vision model is configured

Assign `modelRoles.vision` to a model whose catalog entry supports image input. Merely naming a text-only model in the `vision` slot does not add vision capability.

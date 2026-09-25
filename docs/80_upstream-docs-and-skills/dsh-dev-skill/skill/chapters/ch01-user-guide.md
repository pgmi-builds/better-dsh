# Chapter 1: User Guide — Providers, MCP Memory, Proxy, SDK, Schedules

## Core Idea
Every user-facing surface — the Models page, MCP overlays, proxy env vars, the Python SDK, Schedule and GitHub-review overlays — reads or writes the same file-backed composition (`$DSH_HOME/settings.yaml` + Cordis patch layers); model and provider changes take effect on the next request with no server restart.

## Frameworks Introduced
- **Models page (`Settings → Models`)**: minimal provider form — API key, display name, base URL, API protocol, per-model id/name/context-window/max-output-tokens. Everything else lives in `settings.yaml`.
  - When to use: DeepSeek, a built-in provider (`anthropic`, `openai`, `moonshotai`/Kimi, `zai`/GLM), or a custom gateway. OAuth providers (Codex) unsupported.
  - How: enter key → save. Keys are write-only (page receives a redacted descriptor); the secret lands in `$DSH_HOME/.credentials.yaml`, settings keep only a credential reference.
- **Custom provider form**: lowercase permanent Provider ID + base URL + one API protocol (`openai-completions` | `openai-responses` | `anthropic-messages`) + credential + ≥1 model. One protocol per provider; a dual-protocol gateway needs two providers.
- **`@deepseek-ai/dsh-mcp-client` row**: generic MCP connector; discovered tools surface as `mcp__<serverName>__<tool>`. Default-off reference configs: Memorix `1.3.0`, MCP Reference Memory `2026.7.4`, Engram `v1.20.0` (all stdio).
  - When to use: third-party memory or any MCP server.
  - How: `dsh web --patch <overlay>.cordis.yml`; persist by merging the `insert` row into `$DSH_HOME/profiles/<name>/cordis.patch.yml` (one profile) or `$DSH_HOME/cordis.patch.yml` (all profiles). Never overwrite an existing patch file.
- **Python SDK (`deepseek-harness-sdk`)**: pip wheel bundling a native runtime + the `dsh` CLI (no system Node); a context manager lazily starts `dsh --profile sdk-minimal` and reuses it until exit.
- **Schedule overlay**: session-local reminders via `schedule_create` / `schedule_list` / `schedule_delete` (positive `after_seconds`, absolute `at`, or `every_seconds` ≥ 300).
- **GitHub review overlay**: signed webhook endpoint creating read-only review Sessions on PR `ready_for_review`.

## Key Concepts
- **Provider ID**: permanent lowercase id — requests, saved sessions, model defaults, and credential references use it; rename = add new + delete old.
- **`compat` route block**: request-shape corrections pi-ai cannot infer from the URL (`supportsDeveloperRole`, `maxTokensField`, `thinkingFormat`); full switch list = `PiAiCompatProfile` in the generated `dsh-llm-pi-ai` config reference.
- **`reasoningEfforts`**: per-model map of menu level → wire spelling of `reasoning_effort`; only `off` may be empty (param absence); `compat.thinkingFormat: deepseek` makes `off` send `thinking: {type: disabled}` and other levels `thinking: {type: enabled}` beside the effort.
- **`input` / `defaultInput` / `modelOverrides`**: modality claims (`text`, `image`) at model level, route fallback (default `[text]`, never strips a catalog model's images), and per-model overrides on built-in providers; unknown modality refused everywhere.
- **`--patch` overlay**: one-file config layer passed at launch; argv order matters (layer order in Ch 2).
- **stdio env scrubbing**: the MCP bridge removes credential-named ambient vars and all `DSH_*` vars before spawning a child; per-row `config.env` is the sanctioned secret channel.
- **Proxy env vars**: `HTTPS_PROXY`/`HTTP_PROXY` read at launch; `NO_PROXY` matches host + subdomains (leading `.`/`*.` equivalent, `*` bypasses all, CIDR never works); loopback always direct; SOCKS reported and skipped; `ALL_PROXY` fallback; `NODE_EXTRA_CA_CERTS` for TLS-intercepting proxies.
- **`sdk-minimal` profile**: `dsh-sdk-app` JSON-RPC row over an empty root (no `dsh-base`); pins `danger-full-access`; uncompressed JSONL sessions; no compaction, telemetry, or web tools.
- **Session-local reminder**: owned by the session log; delivered as a queued follow-up turn when the root Agent is fully idle; reopening a cold session restores overdue reminders; forks don't inherit.

## Mental Models
- Think of the Models page as a deliberate thin editor over `settings.yaml` — same document, re-read per request by the adapters.
- Treat MCP as a ferry, not a supervisor: DSH parses the overlay, launches/monitors stdio children, re-syncs tools on reconnect — it never installs servers, migrates data, or manages models/embeddings.
- Proxy reachability is three unrelated mechanisms (OS settings, env vars, TUN mode); CLI tools see only env vars — export them or use TUN.
- Schedule delivery is "the session talks to itself later": no browser/OS/email channel, just a follow-up turn in the original conversation.

## Anti-patterns
- **Renaming a Provider ID in place**: every reference (sessions, defaults, credentials) uses it; add a new provider and delete the old one.
- **Proxy vars in a project `.env`**: DSH refuses to start — a repository must not decide where traffic goes; use a shell profile or `$DSH_HOME/.env` (exported vars win).
- **CIDR entries in `NO_PROXY`**: no effect; use hostnames/domain suffixes.
- **Trusting built-in provider discovery against a gateway**: the installed catalog always answers; fetch through a custom provider to see what the gateway really serves.
- **Reading webhook `202` as "session created"**: it means only signature + JSON accepted and rule calls scheduled in memory.
- **Expecting notifications from Schedule**: no external notification exists; delivery is only the queued follow-up.

## Code Examples
Custom provider with the two most common compat fixes:
```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      compat:
        supportsDeveloperRole: false   # gateway rejects role: "developer"
        maxTokensField: max_tokens     # gateway refuses max_completion_tokens
      models:
        - id: vision-preview
          input: [text, image]
        - id: my-reasoner
          reasoningEfforts: { off: , high: high, max: max }
```
Generic MCP row (stdio):
```yaml
- insert:
    - id: memory-my-server
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: my-memory
        transport: stdio        # remote: streamable-http + url + headers
        command: my-memory-mcp
        args: []
        env: {}
        cwd: !!js process.cwd()
```
SDK entry point:
```python
from deepseek_harness import DeepSeekHarness
with DeepSeekHarness(provider="deepseek-official", model="deepseek-v4-flash",
                     max_tokens=49_152, cwd=str(ws), dsh_home=str(home),
                     profile="sdk-minimal") as harness:
    result = harness.run("Inspect the repository.", session_id="example-001")
print(result.final_response)
```
Proxy:
```sh
export HTTPS_PROXY=http://user:pass@proxy.example:8080  # creds in URL, never printed back
export NO_PROXY=internal.example.com,.corp.example.com
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem    # export before process start
```

## Reference Tables
| Surface | Activation | Persistence |
|---|---|---|
| Custom provider / compat | Models page or `settings.yaml` | `settings.yaml` (re-read per request) |
| MCP memory server | `--patch examples/mcp-memory/<x>.cordis.yml` | merge row into `cordis.patch.yml` |
| Schedule | `--patch examples/schedule/cordis.yml` | overlay only (per-process opt-in) |
| GitHub review | `--patch` + `DSH_GITHUB_WEBHOOK_SECRET` | rows appended to profile patch; `github-ready-review-rule.mjs` beside it |
| SDK plugins | `dsh plugin --profile sdk-minimal add file:/path` | `$DSH_HOME/profiles/sdk-minimal/cordis.patch.yml` |

| Symptom | Fix |
|---|---|
| `MISSING_CREDENTIAL` | store key via Models page or set the referenced env var |
| `UNKNOWN_MODEL` | select a configured model or add it to the custom provider |
| model fetch → 401 | bad key; discovery calls `GET /models` — enter models by hand if absent |
| only reasoning models fail | `compat.supportsDeveloperRole: false` |
| `off` doesn't stop DeepSeek thinking | `compat.thinkingFormat: deepseek` on model or route |
| image refused before sending | add `input: [text, image]`; after removing a wrong claim, start a new session (log replays the attachment) |

Schedule `at`: strict RFC 3339 with `Z` or numeric offset, or `{date, time, time_zone}` with explicit `UTC`/IANA Area/Location; DST gaps rejected, overlaps pick the first instant, records keep UTC only. Overdue `every` records: latest occurrence only, same-idle batches combined (one-shots first), no backlog; cron/calendar unsupported.

## Key Takeaways
1. Model config is two-tier: the form covers what a route needs to exist; reasoning, modality, compat, headers, timeouts, retries live under `llm-pi-ai.providers.<id>` in `settings.yaml` (DeepSeek's own route: `llm-deepseek.reasoningEffort`, e.g. `max`).
2. Compat switches and modality lists state claims, not checks — they never probe the endpoint; an empty compat key is refused, not ignored.
3. A crashed MCP child reconnects with backoff and tool re-sync; after the reconnect budget is exhausted, tools unregister until reload/restart. Initial discovery is async — wait for `mcp__...` tools before validating.
4. Model-authored workflow/code-runtime workers never receive proxy settings; OTLP telemetry is always direct (`DSH_TELEMETRY_MODE=DISABLED` to disable); `web_fetch` to literal private addresses is refused.
5. The SDK never silently reads `~/.dsh` — pass an explicit `dsh_home`; `web` is a separate CLI application and cannot serve a Python SDK client.
6. Webhook `run()` is trusted JS: policy-service gates and repo→path maps are ordinary code returning `null` to skip; the secret authenticates inbound data only, granting no outbound GitHub access.

## Connects To
- **Ch 2**: `--patch` overlays here are the same rows bundles ship; layer order defined there.
- **Ch 10**: generated config catalog owns every `llm-pi-ai` field incl. `PiAiCompatProfile`.
- **Ch 17**: compat/reasoning switches map onto the LLM streaming adapter contract.
- **Ch 7**: MCP rows and provider config are capability seams in the composition.
- **Ch 18**: Models page, reminder catalog, and sidebar alarms are Web UI surfaces.

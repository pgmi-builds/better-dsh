<!--
source: https://omp.sh/docs/env
fetched: 2026-09-06
-->

# Environment variables

> Use environment variables for credentials, CI, one-shell overrides, and standard cloud or proxy configuration. This page lists omp's supported public variables and explains how they differ from YAML settings and CLI flags.

## Choose the right kind of configuration

Use an environment variable when a value belongs to the machine or process rather than the project: a secret, a cloud credential, a proxy, a CI-only value, or a temporary override. For example:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."
omp
```

For one invocation, put the assignment before the command instead of exporting it:

```sh
PI_SLOW_MODEL="openai/gpt-5.5:high" omp
```

Environment variables are **not** YAML settings and are **not** CLI flags:

- Use [`~/.omp/agent/config.yml`](/docs/settings) or project settings for persistent omp behavior that should be reviewed with the rest of the configuration.
- Use [`omp` flags](/docs/cli) for an explicit one-run choice. Where a flag and an environment variable control the same value, the flag wins; for example, `--slow` wins over `PI_SLOW_MODEL`.
- Use the variables on this page in the shell or a `.env` file. Do not put `export PI_FOO=...` inside `config.yml`, and do not expect a YAML key named `PI_FOO` to work.

There is no universal “environment always beats YAML” rule. Some variables are fallbacks, while others explicitly override the corresponding setting. Each table below says which behavior applies.

When a row says **truthy**, omp's shared flag parser accepts `1`, `y`, `true`, `yes`, or `on` in the listed lower- or uppercase forms. Some subsystems normalize case or require one exact value; those rows spell that out.

For providers with an interactive login, `/login` is usually safer than keeping OAuth tokens in shell startup files. Treat every API key, token, cookie, client key, and credential file as a secret.

## Where omp gets environment values

At startup, omp keeps the first non-empty value it finds in this order:

1. The environment inherited from the shell that launched omp.
2. `$PWD/.env` in the launch directory.
3. The active agent `.env`: normally `~/.omp/agent/.env`, or `~/.omp/profiles/<name>/agent/.env` for a named profile.
4. The active config-root `.env`: normally `~/.omp/.env`, or `~/.omp/profiles/<name>/.env` for a named profile.
5. `~/.env`.

Bun may preload its supported launch-directory files—such as `.env.local`, `.env.<NODE_ENV>`, and `.env.<NODE_ENV>.local`—before omp runs. Values loaded that way already appear in the inherited process environment and therefore have the first source's priority.

`PI_CONFIG_DIR` changes the `.omp` root name. `PI_CODING_AGENT_DIR` changes the default profile's agent directory; named profiles ignore it.

Inside a parsed `.env` file, an `OMP_FOO` key is also copied to `PI_FOO`, and the copied value wins over a same-file `PI_FOO`. This compatibility rule applies only to `.env` files, not to variables inherited from the parent shell.

> Restart omp after changing a `.env` file. Environment changes are not hot-reloaded.

### `.env` syntax

Names must match `[A-Za-z_][A-Za-z0-9_]*`. Blank lines and `#` comments are allowed; `export` is optional. Single, double, and backtick quotes are accepted.

```sh
# ~/.omp/.env
export ANTHROPIC_API_KEY="sk-ant-..."
PI_SLOW_MODEL='anthropic/claude-opus-4-8:high'
PI_NOTIFICATIONS=off
```

OMP's own parser keeps values literal. The launch-directory `.env` can be loaded by Bun before omp starts, so Bun-supported expansion may already have happened there; do not rely on expansion in the other `.env` files.

## Provider credentials

Set only the provider credentials you use. A stored credential from `/login` or provider configuration may take precedence over an environment fallback; the priority notes below describe precedence between environment names.

| Provider or service | Variable(s) and resolution |
| --- | --- |
| Anthropic | `ANTHROPIC_OAUTH_TOKEN` → `ANTHROPIC_API_KEY`. With Foundry mode enabled: `ANTHROPIC_FOUNDRY_API_KEY` → OAuth token → API key. |
| ai& | `AIAND_API_KEY`. |
| AIML API | `AIMLAPI_API_KEY`. |
| Alibaba Coding Plan | `ALIBABA_CODING_PLAN_API_KEY`. |
| QwenCloud Token Plan | `ALIBABA_TOKEN_PLAN_API_KEY` → `BAILIAN_TOKEN_PLAN_API_KEY`. |
| Baseten | `BASETEN_API_KEY`. |
| Cerebras | `CEREBRAS_API_KEY`. |
| Cloudflare AI Gateway | `CLOUDFLARE_AI_GATEWAY_API_KEY`. |
| CoreWeave Serverless Inference | `COREWEAVE_API_KEY` → `WANDB_API_KEY`; set `COREWEAVE_PROJECT=<team>/<project>` when the account requires an OpenAI-Project header. |
| Cursor | `CURSOR_ACCESS_TOKEN` for runtime auth; `CURSOR_API_KEY` is also recognized during catalog discovery. `/login cursor` is preferred. |
| DeepSeek | `DEEPSEEK_API_KEY`. |
| Devin | `DEVIN_API_KEY`. |
| Fire Pass | `FIREPASS_API_KEY`. |
| Fireworks | `FIREWORKS_API_KEY`. |
| GitHub Copilot | `COPILOT_GITHUB_TOKEN`; generic `GITHUB_TOKEN` and `GH_TOKEN` are not Copilot credentials. |
| GitLab Duo and Duo Agent | `GITLAB_TOKEN`. |
| GMI Cloud | `GMI_API_KEY`. |
| Google Gemini | `GEMINI_API_KEY`; image generation falls back to `GOOGLE_API_KEY`. |
| Groq | `GROQ_API_KEY`. |
| Hugging Face | `HUGGINGFACE_HUB_TOKEN` → `HF_TOKEN`. |
| Kilo Gateway | `KILO_API_KEY`; catalog discovery also permits an unauthenticated gateway. |
| Kimi Code | `KIMI_API_KEY` for API-key discovery; `/login kimi-code` is the common path. |
| LiteLLM | `LITELLM_API_KEY`; optional for an unauthenticated proxy. |
| LM Studio | `LM_STUDIO_API_KEY`; optional for the usual local server. |
| llama.cpp | `LLAMA_CPP_API_KEY`; optional for the usual local server. |
| Meta Model API | `MODEL_API_KEY` → `META_API_KEY`. |
| MiniMax | `MINIMAX_API_KEY`. |
| MiniMax Code | `MINIMAX_CODE_API_KEY`. |
| MiniMax Code CN | `MINIMAX_CODE_CN_API_KEY`. |
| Mistral | `MISTRAL_API_KEY`. |
| Moonshot | `MOONSHOT_API_KEY` → `KIMI_API_KEY`. |
| NanoGPT | `NANO_GPT_API_KEY`. |
| NVIDIA | `NVIDIA_API_KEY`. |
| Novita | `NOVITA_API_KEY`; catalog discovery also permits an unauthenticated endpoint. |
| Ollama | `OLLAMA_API_KEY`; optional for the usual local server. |
| Ollama Cloud | `OLLAMA_CLOUD_API_KEY`, or `/login ollama-cloud`. |
| OpenAI | `OPENAI_API_KEY`. |
| OpenAI Codex | `OPENAI_CODEX_OAUTH_TOKEN`, or `/login openai-codex`. |
| OpenCode Go / Zen | `OPENCODE_API_KEY`. |
| OpenRouter | `OPENROUTER_API_KEY`; unauthenticated custom endpoints are also discoverable. |
| Qianfan | `QIANFAN_API_KEY`. |
| Qwen Portal | `QWEN_OAUTH_TOKEN` → `QWEN_PORTAL_API_KEY`. |
| Sakana / Fugu | `SAKANA_API_KEY` → `FUGU_API_KEY`. |
| SiliconFlow | `SILICONFLOW_API_KEY`. |
| SiliconFlow China | `SILICONFLOW_CN_API_KEY`. |
| Synthetic | `SYNTHETIC_API_KEY`. |
| Together | `TOGETHER_API_KEY`. |
| Umans AI Coding Plan | `UMANS_AI_CODING_PLAN_API_KEY`; an unauthenticated endpoint is also allowed. |
| Venice | `VENICE_API_KEY`; unauthenticated access is allowed. |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` for runtime auth; `VERCEL_AI_GATEWAY_API_KEY` is also checked for catalog discovery. |
| vLLM | `VLLM_API_KEY`; any non-empty value opts a no-auth local server into discovery. |
| Wafer Serverless | `WAFER_SERVERLESS_API_KEY`, or `/login wafer-serverless`. |
| xAI | `XAI_API_KEY`. For the SuperGrok OAuth route, `XAI_OAUTH_TOKEN` wins over `XAI_API_KEY`. |
| Xiaomi MiMo | `XIAOMI_API_KEY`. |
| Xiaomi Token Plan | `XIAOMI_TOKEN_PLAN_AMS_API_KEY`, `XIAOMI_TOKEN_PLAN_CN_API_KEY`, or `XIAOMI_TOKEN_PLAN_SGP_API_KEY` for the selected region. |
| z.ai | `ZAI_API_KEY`. |
| ZenMux | `ZENMUX_API_KEY`; unauthenticated endpoints are allowed. |
| Zhipu Coding Plan | `ZHIPU_API_KEY`. |

Example for a CI job:

```sh
export OPENAI_API_KEY="$CI_OPENAI_API_KEY"
export PI_SLOW_MODEL="openai/gpt-5.5:high"
omp -p "Review this change for correctness"
```

### Remote auth broker

These variables select a remote credential vault instead of the local credential database.

| Variable | Accepted value and default implication |
| --- | --- |
| `OMP_AUTH_BROKER_URL` | Broker base URL. When set, broker mode is selected and this value wins over `auth.broker.url`. If no token can be resolved, startup fails rather than falling back to local credentials. |
| `OMP_AUTH_BROKER_TOKEN` | Bearer token. Resolution is env → `auth.broker.token` → `<config-root>/auth-broker.token`. |
| `OMP_AUTH_BROKER_SNAPSHOT_TTL_MS` | Non-negative milliseconds; default `3600000` (1 hour). `0` disables encrypted snapshot-cache reads and writes. |
| `OMP_AUTH_BROKER_SNAPSHOT_CACHE` | Snapshot-cache path; default `~/.omp/cache/auth-broker-snapshot.enc` or its XDG equivalent. |
| `OMP_AUTH_BROKER_ACCOUNT_POOL_FILE` | JSON file mapping provider IDs to allowed broker `identityKey` arrays. Invalid input fails closed. Missing providers are unrestricted; `[]` hides that provider's OAuth accounts. |

```sh
export OMP_AUTH_BROKER_URL="https://broker.example.net:8765"
export OMP_AUTH_BROKER_TOKEN="..."
omp
```

## Network, proxy, and endpoint configuration

### Outbound proxies

For a provider request, omp checks `NO_PROXY` first, then resolves a proxy in this order:

1. `PI_PROXY_<PROVIDER>` where the provider ID is uppercase and punctuation becomes `_`, such as `PI_PROXY_GITHUB_COPILOT`.
2. `PI_PROXY`.
3. `HTTPS_PROXY` / `https_proxy` for HTTPS and WebSocket, or `HTTP_PROXY` / `http_proxy` for HTTP.
4. `ALL_PROXY` / `all_proxy`.

`NO_PROXY` and `no_proxy` contain the usual comma-separated exclusions. Loopback, link-local, and RFC 1918 private addresses bypass provider proxying. `PI_PROXY` is process-wide and also covers login, refresh, usage, and discovery calls; a provider-specific variable covers only that provider.

```sh
export PI_PROXY="http://127.0.0.1:7890"
export NO_PROXY="localhost,127.0.0.1,.internal.example"
```

### Provider endpoints and protocol controls

| Variable | Accepted value and default implication |
| --- | --- |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL fallback; the configured provider/model URL wins. |
| `ANTHROPIC_BASE_URL` | Anthropic base URL fallback; default `https://api.anthropic.com`. |
| `MOONSHOT_BASE_URL` | Moonshot chat and model-discovery base; default `https://api.moonshot.ai/v1`. |
| `XAI_BASE_URL` | xAI API base URL override. |
| `SAKANA_BASE_URL`, `FUGU_BASE_URL` | Sakana/Fugu base URL; `SAKANA_BASE_URL` wins. |
| `AIAND_BASE_URL` | ai& endpoint override. |
| `LITELLM_BASE_URL` | LiteLLM fallback base; default `http://localhost:4000/v1`. Explicit provider or `models.yml` configuration wins. |
| `LM_STUDIO_BASE_URL` | Implicit LM Studio discovery base; default `http://127.0.0.1:1234/v1`. |
| `OLLAMA_BASE_URL` | Implicit Ollama discovery base. Falls back to `OLLAMA_HOST`, then `http://127.0.0.1:11434`. |
| `OLLAMA_HOST` | Ollama-style host such as `127.0.0.1:11434`; used only when `OLLAMA_BASE_URL` is unset. |
| `OLLAMA_CONTEXT_LENGTH` | Positive integer context window used by omp's budgeting for implicit Ollama models. It does not change Ollama's server-side context. |
| `LLAMA_CPP_BASE_URL` | Implicit llama.cpp base; default `http://127.0.0.1:8080`. |
| `PI_OPENROUTER_RESPONSES` | Responses API is on by default; exactly `0` selects Chat Completions. |
| `UMANS_WEBSEARCH_PROVIDER` | Default Anthropic web-search provider name for Umans models when not configured on the model. |

```sh
export OLLAMA_BASE_URL="http://gpu-box.local:11434"
export OLLAMA_CONTEXT_LENGTH=32768
omp
```

### Anthropic Foundry, custom headers, and TLS

| Variable | Accepted value and default implication |
| --- | --- |
| `CLAUDE_CODE_USE_FOUNDRY` | `1`, `true`, `yes`, or `on` enables Foundry mode. |
| `FOUNDRY_BASE_URL` | Anthropic endpoint in Foundry mode; otherwise the configured/model URL remains the fallback. |
| `ANTHROPIC_FOUNDRY_API_KEY` | Foundry bearer token; highest-priority Anthropic env credential in Foundry mode. |
| `ANTHROPIC_CUSTOM_HEADERS` | Comma- or newline-separated `name: value` headers. Also used with a non-Anthropic `ANTHROPIC_BASE_URL`. |
| `NODE_EXTRA_CA_CERTS` | PEM file path or inline PEM, including escaped `\n`. The extra CA applies to all provider fetches. |
| `CLAUDE_CODE_CLIENT_CERT`, `CLAUDE_CODE_CLIENT_KEY` | Paired client certificate and private key, each as a PEM path or inline PEM; Foundry mTLS only. |

### Amazon Bedrock

Region resolution is request option → `AWS_REGION` → `AWS_DEFAULT_REGION` → profile region → `us-east-1`.

| Variable | Accepted value and default implication |
| --- | --- |
| `AWS_REGION`, `AWS_DEFAULT_REGION` | Primary and fallback region. |
| `AWS_PROFILE` | Named profile; default profile name is `default`. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | IAM access key pair and optional session token. |
| `AWS_BEARER_TOKEN_BEDROCK` | Highest-priority Bedrock bearer-token path; skips the AWS credential chain. |
| `AWS_SHARED_CREDENTIALS_FILE`, `AWS_CONFIG_FILE` | Override the standard AWS INI paths. |
| `AWS_SDK_LOAD_CONFIG` | `1` or `true` loads shared config even without an explicit profile. |
| `AWS_WEB_IDENTITY_TOKEN_FILE`, `AWS_ROLE_ARN`, `AWS_ROLE_SESSION_NAME` | Web-identity role credentials and optional session name. |
| `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_CONTAINER_CREDENTIALS_FULL_URI` | ECS credential endpoint. |
| `AWS_CONTAINER_AUTHORIZATION_TOKEN`, `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` | ECS credential-endpoint authorization. |
| `AWS_EC2_METADATA_DISABLED` | `true` disables IMDSv2. |
| `AWS_EC2_METADATA_SERVICE_ENDPOINT` | IMDS endpoint override. |
| `AWS_EC2_METADATA_SERVICE_ENDPOINT_MODE` | `ipv6` selects the IPv6 IMDS fallback; other values use IPv4. |
| `AWS_BEDROCK_SKIP_AUTH` | Truthy flag injects dummy credentials for a trusted no-auth proxy. |
| `AWS_BEDROCK_FORCE_CACHE` | Truthy flag forces Bedrock prompt-cache behavior even when the model catalog does not mark it explicit. |

### Azure OpenAI Responses

| Variable | Accepted value and default implication |
| --- | --- |
| `AZURE_OPENAI_API_KEY` | Required unless supplied by provider configuration. |
| `AZURE_OPENAI_API_VERSION` | API version; Responses default is `v1` (the Chat Completions compatibility path defaults to `2024-10-21`). |
| `AZURE_OPENAI_BASE_URL` | Direct base URL; wins over the resource-name-derived URL. |
| `AZURE_OPENAI_RESOURCE_NAME` | Builds `https://<resource>.openai.azure.com/openai/v1`. |
| `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Comma-separated `model=deployment` pairs. |

### Google Vertex AI

| Variable | Accepted value and default implication |
| --- | --- |
| `GOOGLE_CLOUD_PROJECT`, `GCP_PROJECT`, `GCLOUD_PROJECT` | Project ID in that order. |
| `GOOGLE_VERTEX_LOCATION`, `GOOGLE_CLOUD_LOCATION`, `VERTEX_LOCATION` | Vertex location in that order; required for ADC-backed Vertex use. |
| `GOOGLE_CLOUD_API_KEY` | Direct Vertex API-key auth; otherwise omp uses ADC. |
| `GOOGLE_APPLICATION_CREDENTIALS` | ADC JSON path; fallback is `~/.config/gcloud/application_default_credentials.json`. |
| `GOOGLE_CLOUD_ACCESS_TOKEN`, `CLOUDSDK_AUTH_ACCESS_TOKEN` | Explicit OAuth access token in that order; bypasses ADC token acquisition. |
| `GOOGLE_CLOUD_PROJECT_ID` | Gemini CLI login-helper project fallback; not the primary Vertex project variable. |

## Web search

These variables make a search provider available or refine its endpoint. `/login` can store credentials for providers that support it.

| Variable | Accepted value and default implication |
| --- | --- |
| `EXA_API_KEY` | Exa search and Exa MCP access. |
| `BRAVE_API_KEY` | Brave Search API key. |
| `PERPLEXITY_API_KEY` | Direct Perplexity API mode. |
| `PERPLEXITY_COOKIES` | Perplexity consumer cookie auth; wins over stored OAuth. |
| `PI_PERPLEXITY_RESPONSES` | Exactly `1` selects the Responses endpoint; otherwise Chat Completions. |
| `PI_PERPLEXITY_MODEL` | Consumer-subscription model; default `experimental`. |
| `PI_PERPLEXITY_API_MODEL` | Direct API model; default `sonar-pro`. |
| `TINYFISH_API_KEY` | TinyFish search/browser API key. |
| `FIRECRAWL_API_KEY` | Firecrawl API key; a configured custom endpoint can also be keyless. |
| `FIRECRAWL_BASE_URL`, `FIRECRAWL_API_URL` | Firecrawl endpoint override; `FIRECRAWL_BASE_URL` wins. |
| `GOOGLE_GEMINI_BASE_URL` | Gemini search endpoint override; must be an absolute HTTP(S) URL. |
| `GEMINI_SEARCH_MODEL` | Gemini search model override. |
| `TAVILY_API_KEY` | Tavily API key. |
| `ZAI_API_KEY` | z.ai search, also used for z.ai chat models. |
| `PI_CODEX_WEB_SEARCH_MODEL` | Codex search model override. |
| `MOONSHOT_SEARCH_API_KEY`, `KIMI_SEARCH_API_KEY` | Kimi/Moonshot search key; Moonshot name wins. |
| `MOONSHOT_SEARCH_BASE_URL`, `KIMI_SEARCH_BASE_URL` | Kimi/Moonshot search endpoint; Moonshot name wins. |
| `KAGI_API_KEY` | Kagi Search API key. |
| `JINA_API_KEY` | Jina API key. |
| `PARALLEL_API_KEY` | Parallel API key. |
| `SEARXNG_ENDPOINT` | SearXNG endpoint; falls back to the `searxng.endpoint` YAML setting. |
| `SEARXNG_TOKEN` | SearXNG bearer token; env is the fallback after its YAML setting. |
| `SEARXNG_BASIC_USERNAME`, `SEARXNG_BASIC_PASSWORD` | SearXNG Basic Auth; env is the fallback after YAML settings. |
| `ANTHROPIC_SEARCH_API_KEY` | Search-only Anthropic key; wins over normal Anthropic credentials for search. |
| `ANTHROPIC_SEARCH_BASE_URL` | Search-only base URL; wins over Foundry and `ANTHROPIC_BASE_URL`. |
| `ANTHROPIC_SEARCH_MODEL` | Search model; default `claude-haiku-4-5`. |
| `PI_AUTH_NO_BORROW` | Any non-empty value disables borrowing the Perplexity macOS app token during login. |

```sh
export BRAVE_API_KEY="..."
omp -p "Find the current release notes and summarize the breaking changes"
```

## Models, execution, and session behavior

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_SMOL_MODEL` | Session-only `smol` role model; `--smol` wins. |
| `PI_SLOW_MODEL` | Session-only `slow` role model; `--slow` wins. |
| `PI_PLAN_MODEL` | Session-only `plan` role model; `--plan` wins. |
| `PI_TINY_DEVICE` | Overrides `providers.tinyModelDevice`. Default CPU. Accepted: `cpu`, `gpu`, `metal`, `webgpu`, `auto`, `cuda`, `dml`, `coreml`, `wasm`, `webnn`, `webnn-gpu`, `webnn-cpu`, `webnn-npu`. |
| `PI_TINY_DTYPE` | Overrides `providers.tinyModelDtype`. Unset keeps the model's shipped dtype, currently `q4`. Accepted: `auto`, `fp32`, `fp16`, `q8`, `int8`, `uint8`, `q4`, `bnb4`, `q4f16`, `q2`, `q2f16`, `q1`, `q1f16`. |
| `PI_NO_TITLE` | Any non-empty value disables automatic first-message session titles. `--no-title` sets the same behavior. |
| `PI_NO_INTERLEAVED_THINKING` | Exactly `1` disables Anthropic interleaved-thinking budgets. |
| `PI_NO_THINKING_LOOP_GUARD` | Exactly `1` disables the thinking-loop guard. |
| `NULL_PROMPT` | Exactly `true` returns an empty system prompt; intended for raw-model diagnostics. |
| `PI_CACHE_RETENTION` | `long`, `short`, or `none`; invalid values are ignored. Applies where supported by Anthropic, OpenAI Responses, and Bedrock. |
| `PI_PACKAGE_DIR` | Package asset root for bundled docs, examples, and changelog. |
| `OMP_SKIP_SETUP` | Any non-empty value except `0`, `false`, or `no` skips automatic interactive setup; an explicitly forced setup still runs. |
| `PI_DISABLE_LSPMUX` | Exactly `1` disables lspmux and uses direct language-server processes. |
| `PI_RPC_EMIT_TITLE` | Truthy flag enables title events in RPC mode. |
| `OMP_MCP_TIMEOUT_MS` | Global MCP request timeout in milliseconds. Positive integer overrides every server timeout; `0` disables client-side timeouts; invalid values are ignored. |
| `PI_BROWSER_RELAY` | `1` enables or `0` disables the browser relay, overriding `browser.relay`. |
| `PI_BROWSER_CMUX` | `1` enables or `0` disables cmux browser surfaces, overriding `browser.cmux`. |

### Eval runtimes

These environment gates override `eval.py`, `eval.js`, `eval.rb`, and `eval.jl`. The standard truthy values are `1`, `y`, `true`, `yes`, and `on` in the recognized casing; any other defined value is false.

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_PY` | Python gate; unset uses the YAML setting, default enabled. |
| `PI_JS` | JavaScript gate; unset uses the YAML setting, default enabled. |
| `PI_RB` | Ruby gate; unset uses the YAML setting, default disabled. |
| `PI_JL` | Julia gate; unset uses the YAML setting, default disabled. |
| `PI_PYTHON_SKIP_CHECK` | Truthy skips the Python availability probe; the runtime still starts on demand. |
| `PI_RUBY_SKIP_CHECK` | Truthy skips the Ruby availability probe. |
| `PI_PYTHON_IPC_TRACE` | Truthy logs Python runner NDJSON frames. |
| `PI_RUBY_IPC_TRACE` | Truthy logs Ruby runner frames. |
| `PI_JULIA_IPC_TRACE` | Truthy logs Julia runner frames. |
| `VIRTUAL_ENV` | Highest-priority Python environment path. |
| `CONDA_PREFIX` | Python environment fallback after `VIRTUAL_ENV`, before local `.venv` and `venv`. |

### Subagents and operation limits

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_TASK_MAX_OUTPUT_BYTES` | Maximum captured bytes per subagent; default `500000`. |
| `PI_TASK_MAX_OUTPUT_LINES` | Maximum captured lines per subagent; default `5000`. |
| `PI_BLOCKED_AGENT` | Exact subagent type to block. Unset blocks none. |
| `PI_SUBPROCESS_CMD` | Complete replacement command used to launch subagents instead of locating `omp` / `omp.cmd`. |
| `PI_MAX_AST_FILES` | Positive maximum files accepted by one structural-edit operation; default `1000`. Invalid, zero, and negative values use the default. |
| `PI_WALK_WORKERS` | Filesystem walker workers for `omp grep`; default `4`, and `0` selects available parallelism automatically. |

### Editing, shell, and images

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_EDIT_VARIANT` | `patch`, `replace`, `hashline`, or `apply_patch`; invalid values are ignored. |
| `PI_STRICT_EDIT_MODE` | Exactly `1` disables model-specific edit-mode fallback. |
| `PI_INTENT_TRACING` | Boolean-like override for `tools.intentTracing`. |
| `PI_NO_PTY` | Exactly `1` disables interactive PTY execution; `--no-pty` sets it internally. |
| `PI_DISABLE_UUTILS_BUILTINS` | Any non-empty value except `0` or `false` disables bundled shell utilities. `shell.env.PI_DISABLE_UUTILS_BUILTINS` wins when present. |
| `PI_BASH_NO_CI`, `CLAUDE_BASH_NO_CI` | Canonical variable and legacy fallback; any non-empty value suppresses automatic `CI=true` in spawned shells. |
| `PI_BASH_NO_LOGIN`, `CLAUDE_BASH_NO_LOGIN` | Canonical variable and legacy fallback; any non-empty value changes Unix shell arguments from `-l -c` to `-c`. |
| `PI_SHELL_PREFIX`, `CLAUDE_CODE_SHELL_PREFIX` | Canonical wrapper prefix and legacy fallback, applied to each shell command. |
| `VISUAL`, `EDITOR` | External editor command and fallback, used by <kbd>Ctrl</kbd>+<kbd>G</kbd>. |
| `OMP_NO_WEBP` | `1` or `true`, case-insensitive, disables WebP selection during image resizing. |
| `OMP_NATIVE_LIBRARY_PATH` | Linux-only colon-separated native library directories appended to `LD_LIBRARY_PATH` for local model workers; useful on NixOS. |

## Storage, profiles, and compatibility paths

| Variable | Accepted value and default implication |
| --- | --- |
| `OMP_PROFILE` | Named profile selector. It wins over `PI_PROFILE` even when explicitly empty; empty, whitespace, or `default` selects the default profile. Names must match `[a-z0-9][a-z0-9._-]{0,63}`, cannot be `.` or `..`, cannot end in `.`, and cannot be a Windows reserved device name. |
| `PI_PROFILE` | Legacy profile selector, used only when `OMP_PROFILE` is undefined. |
| `PI_CONFIG_DIR` | Config-root directory name under home; default `.omp`. |
| `PI_CODING_AGENT_DIR` | Full agent-directory override for the default profile only; named profiles ignore it. |
| `PI_CODING_AGENT_SESSION_DIR` | Initial session-directory override used during launch argument parsing. |
| `PI_CONFIG_FILES` | `:`-separated YAML overlay paths on Unix or `;`-separated paths on Windows. They load in order after project settings and before repeated `--config` overlays. |
| `OMP_WORKTREE_DIR` | Agent-managed worktree root; default `~/.omp/wt`. Must be absolute or `~`-relative; invalid relative paths are ignored. It wins over `worktree.base`. |
| `OMP_AUTORESEARCH_DB_DIR` | Directory for per-project autoresearch databases and artifacts. |
| `OMP_GITHUB_CACHE_DB` | GitHub virtual-URL SQLite cache path; default `~/.omp/cache/github-cache.db`. |
| `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` | On macOS/Linux, redirect the corresponding omp paths only when the target `omp` root or named-profile root already exists. |
| `CLAUDE_CONFIG_DIR` | Relocates imported Claude Code commands, plugins, MCP configuration, sessions, and `.claude.json`; unset uses the normal Claude paths. |
| `COPILOT_HOME` | GitHub Copilot config home; default `~/.copilot`. |
| `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` | Comma-separated additional Copilot instruction directories. |
| `JS_DEBUG_DAP_SERVER` | Address of an existing JavaScript debug-adapter server. |

`PWD`, `HOME`, `XDG_CONFIG_HOME`, `APPDATA`, `SHELL`, and `ComSpec` also participate in normal operating-system path and shell discovery; they are not omp-specific settings.

## Memory backends

### Hindsight

Every `HINDSIGHT_*` value below overrides its matching `hindsight.*` YAML setting. Empty strings are ignored. Booleans are case-insensitive: only `true`, `1`, and `yes` mean true. Invalid integers and enum values are ignored.

| Variable | Accepted value and built-in default |
| --- | --- |
| `HINDSIGHT_API_URL` | Non-empty URL; `http://localhost:8888`. |
| `HINDSIGHT_API_TOKEN` | Non-empty token; unset. |
| `HINDSIGHT_BANK_ID` | Non-empty ID; unset, so scoping derives it. |
| `HINDSIGHT_BANK_MISSION` | String; empty. |
| `HINDSIGHT_RETAIN_MODE` | `full-session` or `last-turn`; `full-session`. |
| `HINDSIGHT_RECALL_BUDGET` | `low`, `mid`, or `high`; `mid`. |
| `HINDSIGHT_AUTO_RECALL` | Boolean; `true`. |
| `HINDSIGHT_AUTO_RETAIN` | Boolean; `true`. |
| `HINDSIGHT_SCOPING` | `global`, `per-project`, or `per-project-tagged`; `per-project-tagged`. |
| `HINDSIGHT_DEBUG` | Boolean; `false`. |
| `HINDSIGHT_RECALL_MAX_TOKENS` | Integer; `1024`. |
| `HINDSIGHT_RECALL_CONTEXT_TURNS` | Integer; `1`. |
| `HINDSIGHT_RECALL_MAX_QUERY_CHARS` | Integer; `800`. |
| `HINDSIGHT_RETAIN_EVERY_N_TURNS` | Integer; `3`. |
| `HINDSIGHT_REQUEST_TIMEOUT_MS` | Integer milliseconds; `30000`. |
| `HINDSIGHT_REFLECT_TIMEOUT_MS` | Integer milliseconds; `120000`. |
| `HINDSIGHT_RECALL_TIMEOUT_MS` | Integer milliseconds; `30000`. |
| `HINDSIGHT_RETAIN_TIMEOUT_MS` | Integer milliseconds; `60000`. |

### Mnemopi

| Variable | Accepted value and default implication |
| --- | --- |
| `MNEMOPI_EMBEDDING_MODEL` | Embedding model override when `mnemopi.embeddingModel` is unset; otherwise the configured variant chooses the model. |
| `MNEMOPI_POLYPHONIC_RECALL` | Exactly `1` enables; any other defined value disables. Overrides `mnemopi.polyphonicRecall`, whose default is false. |
| `MNEMOPI_ENHANCED_RECALL` | Exactly `1` enables; any other defined value disables. Overrides `mnemopi.enhancedRecall`, whose default is false. |
| `MNEMOPI_PROACTIVE_LINKING` | Exactly `1` enables; any other defined value disables. Overrides `mnemopi.proactiveLinking`, whose default is false. |

## Terminal and browser behavior

Most terminal identity variables are set by the terminal itself. Set the omp-specific controls only to work around detection problems.

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_NOTIFICATIONS` | `off`, `0`, or `false` suppresses desktop notifications; other values leave them enabled. |
| `PI_TUI_WRITE_LOG` | Non-empty file path records all TUI writes. |
| `PI_TUI_RAW_BACKSPACE_IS_CTRL` | Exactly `1` treats raw byte `0x08` as Ctrl+Backspace. |
| `PI_HARDWARE_CURSOR` | Truthy enables hardware cursor mode. |
| `PI_NO_SYNC_OUTPUT` | Any non-empty value disables DEC 2026 synchronized-output wrappers. |
| `PI_TUI_SYNC_OUTPUT` | Exactly `0` disables or `1` enables synchronized output. `PI_NO_SYNC_OUTPUT` has priority over the enabling value. |
| `PI_FORCE_SYNC_OUTPUT` | Exactly `1` enables synchronized output when `PI_NO_SYNC_OUTPUT` and `PI_TUI_SYNC_OUTPUT` do not disable it. |
| `PI_NO_DECCARA` | Any non-empty value except `0` or `false` disables Kitty DECCARA background fills. |
| `PI_DEBUG_REDRAW` | Exactly `1` enables redraw diagnostics. |
| `PI_FORCE_IMAGE_PROTOCOL` | `kitty`, `iterm2`/`iterm`, or `sixel` forces that protocol. `off`, `none`, `0`, or `false` disables terminal images. Any other non-empty value also disables image detection, so use only the documented values. |
| `PI_ALLOW_SIXEL_PASSTHROUGH` | Truthy allows passthrough only when the forced protocol is `sixel`. |
| `PI_KITTY_PLACEHOLDERS` | `1`, `true`, `on`, `yes`, or `y` forces Kitty Unicode placeholders on; `0`, `false`, `off`, `no`, or `n` forces them off, case-insensitive. |
| `PI_NO_KITTY_PLACEHOLDERS` | `1`, `true`, `on`, `yes`, or `y` disables Kitty placeholders and wins over `PI_KITTY_PLACEHOLDERS`. |
| `PI_TUI_RESIZE_SCROLLBACK` | `preserve`, `append`, or `rebuild`; default `preserve`. `append` replays finalized history at the new width, while `rebuild` first clears native scrollback and then replays it. |
| `PUPPETEER_EXECUTABLE_PATH` | Chromium executable path. |
| `PUPPETEER_PROXY` | Chromium `--proxy-server` value. |
| `PUPPETEER_PROXY_BYPASS_LOOPBACK` | `1`, `true`, `yes`, or `on`, case-insensitive, sends localhost through the proxy. |
| `PUPPETEER_PROXY_IGNORE_CERT_ERRORS` | Same truthy values; starts Chromium while ignoring certificate errors. |
| `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID` | cmux workspace/surface target for a browser split. |
| `CMUX_RELAY_ID`, `CMUX_RELAY_TOKEN` | cmux relay identity and credential fallback. |

Auto-detected terminal signals include `COLORTERM`, `TERM`, `COLORFGBG`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `TERMINAL_EMULATOR`, `WT_SESSION`, `TMUX_PANE`, `CMUX_SURFACE_ID`, `KITTY_WINDOW_ID`, `WEZTERM_PANE`, `TERM_SESSION_ID`, `ZELLIJ_PANE_ID`, and `ZELLIJ_SESSION_NAME`. OMP also respects `NO_COLOR`; on Linux it detects clipboard/display support from `DISPLAY`, `WAYLAND_DISPLAY`, `WSL_DISTRO_NAME`, `WSL_INTEROP`, and `TERMUX_VERSION`.

## Diagnostics and advanced controls

### Startup, provider, and commit diagnostics

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_TIMING` | Any non-empty value prints accumulated timings to stderr. `full` includes every module-load span; `x` prints startup timings and exits successfully before the TUI. |
| `PI_DEBUG_STARTUP` | Any non-empty value streams synchronous `[startup] phase:start/done` markers to stderr. |
| `DEBUG_CURSOR` | Non-empty enables Cursor logs; `2` or `verbose` includes payload snippets. |
| `DEBUG_CURSOR_LOG` | Cursor JSONL log path. |
| `PI_CODEX_DEBUG` | Truthy enables Codex provider diagnostics. |
| `PI_COMMIT_TEST_FALLBACK` | Case-insensitive `true` forces heuristic commit-message fallback. |
| `PI_COMMIT_NO_FALLBACK` | Case-insensitive `true` leaves the commit proposal empty when generation fails. |
| `PI_COMMIT_MAP_REDUCE` | Case-insensitive `false` disables map-reduce analysis for large diffs. |
| `DEBUG` | Any non-empty value prints the full commit-generation error stack. |
| `PI_AUTO_QA` | Highest-priority boolean override for automatic tool-issue recording; `0`/`false` disables, `1`/`true` enables. |
| `PI_AUTO_QA_PUSH` | `1`/`true` bypasses the consent dialog and allows recording in headless environments. |
| `PI_AUTO_QA_PUSH_URL` | Push endpoint; wins over `dev.autoqaPush.endpoint`. |
| `PI_AUTO_QA_PUSH_TOKEN` | Push bearer token; wins over `dev.autoqaPush.token`. |

### Codex and stream transport

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_CODEX_WEBSOCKET` | Boolean-like websocket preference; unset uses model/catalog behavior. |
| `PI_CODEX_RESPONSES_LITE` | `1`/`true` forces Responses Lite; `0`/`false` forces standard Responses; unset uses catalog behavior. |
| `PI_OPENAI_STATEFUL` | Boolean-like override for stateful Responses chaining. Default on for `api.openai.com`, off elsewhere. |
| `PI_CODEX_ZSTD` | Compression is on by default for official Codex; `0`/`false` disables it. |
| `PI_CODEX_WEBSOCKET_IDLE_TIMEOUT_MS` | Positive milliseconds; default `300000`. |
| `PI_CODEX_WEBSOCKET_FIRST_EVENT_TIMEOUT_MS` | Positive milliseconds; default `300000`. |
| `PI_CODEX_WEBSOCKET_PING_INTERVAL_MS` | Positive milliseconds; default `10000`. |
| `PI_CODEX_WEBSOCKET_PONG_TIMEOUT_MS` | Positive milliseconds; default `60000`. |
| `PI_CODEX_WEBSOCKET_MESSAGE_QUEUE_CAPACITY` | Buffered message count; default `4096`. |
| `PI_CODEX_WEBSOCKET_MAX_IDLE_REUSE_MS` | Maximum idle reuse in milliseconds; default `30000`. |
| `PI_CODEX_WEBSOCKET_RETRY_BUDGET` | Non-negative retry count; default `5`. |
| `PI_CODEX_WEBSOCKET_RETRY_DELAY_MS` | Positive base backoff in milliseconds; default `500`. |
| `PI_STREAM_FIRST_EVENT_TIMEOUT_MS` | Generic first-event timeout in milliseconds; `0` disables. |
| `PI_STREAM_IDLE_TIMEOUT_MS` | Generic idle timeout in milliseconds; `0` disables. |
| `PI_OPENAI_STREAM_FIRST_EVENT_TIMEOUT_MS` | OpenAI-specific override; `0` disables and takes precedence over the generic value. |
| `PI_OPENAI_STREAM_IDLE_TIMEOUT_MS` | OpenAI-specific override; `0` disables and takes precedence over the generic value. |

### Compatibility user agents

| Variable | Accepted value and default implication |
| --- | --- |
| `PI_AI_GEMINI_CLI_VERSION` | Gemini CLI user-agent version; default `0.46.0`. |
| `PI_AI_ANTIGRAVITY_VERSION` | Antigravity hub version override; auto-discovered when possible, fallback `2.8.0`. |
| `PI_AI_ANTIGRAVITY_CL` | Antigravity changelist; default `963137146`. |
| `PI_AI_ANTIGRAVITY_OS` | Antigravity OS tag; default `darwin`. |
| `PI_AI_ANTIGRAVITY_ARCH` | Antigravity architecture tag; default `arm64`. |
| `KIMI_CODE_OAUTH_HOST`, `KIMI_OAUTH_HOST` | Kimi OAuth host in that order; default `https://auth.kimi.com`. |
| `KIMI_CODE_BASE_URL` | Kimi usage endpoint base URL. |
| `SMITHERY_URL` | Smithery web URL; default `https://smithery.ai`. |
| `SMITHERY_API_URL` | Smithery API base; default `https://api.smithery.ai`. |
| `SMITHERY_API_KEY` | Smithery managed-MCP lookup key. |

### GitLab Duo workflow

| Variable | Accepted value and default implication |
| --- | --- |
| `GITLAB_CLIENT_ID` | OAuth client ID; unset uses omp's bundled GitLab OAuth app ID. |
| `GITLAB_REDIRECT_URI` | Exact HTTP(S) callback URI. Unset uses `http://localhost:8080/callback` with random-port fallback. |
| `GITLAB_DUO_NAMESPACE_ID` | Workflow namespace override; explicit runtime configuration wins. |
| `GITLAB_DUO_PROJECT_ID` | Project ID override; wins over `GITLAB_DUO_PROJECT_PATH`. |
| `GITLAB_DUO_PROJECT_PATH` | Project path override when no project ID is set. |
| `GITLAB_DUO_WORKFLOW_DEFINITION` | Workflow definition; default `ambient`. |
| `GITLAB_DUO_WORKFLOW_TRACE` | Exactly `1` appends workflow trace events. |
| `GITLAB_DUO_WORKFLOW_TRACE_FILE` | Trace JSONL path; blank uses the package's `.tmp/gitlab-duo-workflow-trace.log`. |

### OpenTelemetry export

OMP starts OTLP export only when at least one signal endpoint is configured.

| Variable | Accepted value and default implication |
| --- | --- |
| `OTEL_SDK_DISABLED` | Case-insensitive `true` disables initialization. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Common OTLP endpoint fallback. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Per-signal endpoint; each wins over the common endpoint. |
| `OTEL_TRACES_EXPORTER`, `OTEL_LOGS_EXPORTER`, `OTEL_METRICS_EXPORTER` | A list containing `none` disables that signal. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Common protocol. Only `http/protobuf` is supported; another explicit value disables export. |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL`, `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL`, `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | Per-signal protocol; each wins over the common protocol. |
| `OTEL_SERVICE_NAME` | Service name resource attribute. |
| `OTEL_RESOURCE_ATTRIBUTES` | Standard comma-separated OpenTelemetry resource attributes. |
| `OTEL_LOG_LEVEL` | Minimum exported omp log level. |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | `summary` captures summaries; `true`, `1`, `yes`, or `full` captures full message content; anything else captures none. This can expose prompts and responses. |

## Troubleshooting

**A value in `.env` appears to be ignored**

- Check the launch shell first: an existing non-empty value wins over every `.env` file.
- Confirm the file is in the launch directory, active profile directory, config root, or home location listed above.
- Restart omp. Values are loaded once at startup.
- Remember that named profiles use `~/.omp/profiles/<name>/...` and ignore `PI_CODING_AGENT_DIR`.

**A YAML setting and environment variable disagree**

Read the row for that variable. Some env values are explicit overrides (`PI_TINY_DEVICE`, Hindsight variables), some are fallbacks (`LITELLM_BASE_URL`), and some are superseded by CLI flags (`PI_SLOW_MODEL`). Use `omp config get <setting>` to inspect YAML; use `env | sort` in your shell to inspect inherited environment values.

**Authentication still fails**

Prefer `/login` for supported OAuth providers. Otherwise verify the exact provider-specific name above, remove whitespace, and make sure a generic key such as `GITHUB_TOKEN` is not being used where a provider-specific token such as `COPILOT_GITHUB_TOKEN` is required.

**A secret was committed or printed**

Revoke and rotate it immediately. Removing it from the latest file is not enough because it remains in history and logs. Keep credential-bearing `.env` files out of version control and restrict their permissions, for example `chmod 600 ~/.omp/.env`.

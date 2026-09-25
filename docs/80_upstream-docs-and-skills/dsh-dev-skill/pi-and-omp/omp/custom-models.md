<!--
source: https://omp.sh/docs/custom-models
fetched: 2026-09-06
-->

# Custom models & providers

> Connect omp to a local server, an OpenAI-compatible gateway, or a model that is not in the built-in catalog.

## Connect a model omp does not already know

Use a custom provider when your model runs at a private URL, behind a company gateway, or under an id that omp does not list. You can declare the exact model yourself or let omp discover the models exposed by the server.

You often do **not** need this file for local inference. omp automatically looks for Ollama at `http://127.0.0.1:11434`, llama.cpp at `http://127.0.0.1:8080`, and LM Studio at `http://127.0.0.1:1234/v1`. Start the server and open `/model`; if its models are already there, select one and stop.

Otherwise, create `~/.omp/agent/models.yml`. This is the smallest valid configuration for an unauthenticated server that implements OpenAI Chat Completions:

```yaml
providers:
  local-openai:
    baseUrl: http://127.0.0.1:8000/v1
    api: openai-completions
    auth: none
    models:
      - id: Qwen/Qwen2.5-Coder-32B-Instruct
```

The provider id, `local-openai`, is yours to choose. The model `id` must be the exact id accepted by the server. Use `openai-responses` instead if the server implements `/v1/responses` rather than `/v1/chat/completions`.

For a newly declared model, omitted metadata defaults to its id as the display name, text-only input, no configurable reasoning, a 128,000-token context window, a 16,384-token output limit, and zero cost. Those defaults make a minimal entry usable, but you should set the real limits and capabilities when they differ.

## Verify and select it

First ask omp to load the file and list just your provider:

```bash
omp models local-openai
```

A valid, available model appears under `local-openai` with its context, output, thinking, and image capabilities. A YAML or schema problem instead prints `models.yml validation failed` and the field that failed.

Then exercise the endpoint with an exact selector:

```bash
omp -p --model local-openai/Qwen/Qwen2.5-Coder-32B-Instruct "Reply with only OK"
```

Exact `provider/model-id` selectors avoid ambiguity when several providers expose the same model id. To make it your normal interactive model, start `omp`, enter `/model`, find the provider and model, and assign it to **Default**. The model hub reloads `models.yml` when it opens and saves the role assignment. `/switch` (or <kbd>Alt</kbd>+<kbd>P</kbd>) switches only the current session.

See [Model roles](/docs/roles) for assigning the same model to `smol`, `slow`, `plan`, or another role.

## Add authentication

For a remote OpenAI-compatible service, point `apiKey` at an environment variable:

```yaml
providers:
  myco:
    baseUrl: https://llm.internal.example/v1
    apiKey: MYCO_LLM_API_KEY
    api: openai-responses
    models:
      - id: myco-large
        name: MyCo Large
        reasoning: true
        input: [text, image]
        contextWindow: 200000
        maxTokens: 32000
        cost:
          input: 3
          output: 15
          cacheRead: 0.3
          cacheWrite: 3.75
```

```bash
export MYCO_LLM_API_KEY='…'
omp models myco
```

`apiKey` resolution is deliberate but worth knowing:

1. A value beginning with `!` is a shell command; its trimmed stdout is the key.
2. Otherwise, omp looks for an environment variable with that exact name.
3. If no such variable exists, omp uses the configured text as the literal key.

For example, `apiKey: "!op read op://team/llm/key"` reads from 1Password. Header values use the same rules. Prefer environment variables or secret-manager commands over committing a literal credential. See [Environment variables](/docs/env) and [Providers](/docs/providers) for built-in provider authentication.

`auth` defaults to `apiKey`. Use `auth: none` only for a genuinely unauthenticated endpoint. `auth: oauth` is valid only when that provider's OAuth support is already supplied by omp or an extension; `models.yml` cannot define a new OAuth flow.

Set `authHeader: true` only when a gateway specifically needs `Authorization: Bearer <resolved-apiKey>` injected as an ordinary header. Standard provider clients already apply their normal authentication scheme.

## Discover a server's model list

If an OpenAI-compatible server exposes `GET /v1/models`, discovery avoids maintaining a `models` list by hand:

```yaml
providers:
  lab:
    baseUrl: http://127.0.0.1:8000/v1
    api: openai-completions
    auth: none
    discovery:
      type: openai-models-list
```

Run `omp models refresh lab` to force an online refresh and show only matching models. Ordinary launches use the cached catalog when it is fresh.

`discovery.type` accepts:

| Type | Use it for |
| --- | --- |
| `ollama` | Ollama's native `/api/tags` and `/api/show` endpoints. |
| `llama.cpp` | llama.cpp's native model and properties endpoints. |
| `lm-studio` | LM Studio's OpenAI-compatible model list and metadata. |
| `openai-models-list` | A generic OpenAI-compatible `GET /v1/models` endpoint. |
| `litellm` | A LiteLLM gateway; uses its richer metadata routes and falls back to `/v1/models`. |
| `proxy` | A mixed OpenAI/Anthropic proxy whose model rows advertise `supported_endpoint_types`. |

Except for `proxy`, discovery requires provider-level `api`. `proxy` derives a model's API from its advertised endpoint types and uses provider-level `api` only as a fallback. Optional `discovery.timeoutMs` must be a positive number of milliseconds.

Do not label a generic OpenAI-compatible server as `ollama`: Ollama discovery expects Ollama's native endpoints. Use `openai-models-list` instead.

## Override a built-in provider

A provider entry without `models` changes an existing provider rather than replacing its catalog. This is useful for a company gateway or for correcting metadata:

```yaml
providers:
  openai:
    baseUrl: https://gateway.internal.example/v1
    apiKey: COMPANY_OPENAI_KEY
    headers:
      X-Team: coding
    modelOverrides:
      gpt-5.4:
        contextWindow: 400000
```

Provider `headers`, `compat`, and `remoteCompaction` are baselines. Model headers replace provider headers with the same name, and `modelOverrides` patches one bundled or discovered model. If a custom `models` entry uses the same provider and id as an existing model, the custom definition replaces that model's transport configuration.

## File and provider reference

The default path is `~/.omp/agent/models.yml`; `~/.omp/agent/models.yaml` is used when the `.yml` file is absent. If neither YAML file exists and legacy `models.json` does, omp migrates it to `models.yml`. The root object accepts only `providers`.

Each key below `providers` becomes the provider portion of the selector.

| Provider field | Meaning |
| --- | --- |
| `baseUrl` | Endpoint root. Required when `models` is non-empty. It must be a non-empty string. |
| `api` | Default API for declared or discovered models. May instead be set on every declared model. |
| `apiKey` | Environment-variable name, `!command`, or literal credential. Required for declared models unless `auth` is `none` or `oauth`. |
| `auth` | `apiKey` (default), `none`, or `oauth`. |
| `headers` | String-to-string request headers. Values support environment-variable and `!command` resolution. |
| `authHeader` | When true, adds a Bearer `Authorization` header from `apiKey`. |
| `models` | Full model definitions owned by this provider. |
| `discovery` | Live catalog configuration: `type` plus optional positive `timeoutMs`. |
| `modelOverrides` | Map from model id to sparse metadata patches. |
| `compat` | Advanced request/response compatibility overrides; normally omit it and use omp's automatic detection. |
| `disableStrictTools` | Disables strict tool-schema markers for endpoints, commonly Anthropic-compatible proxies, that reject them. |
| `remoteCompaction` | Provider-wide remote compaction configuration. Model values merge on top. |
| `guardrailIdentifier` | Amazon Bedrock guardrail id or ARN. |
| `guardrailVersion` | Bedrock guardrail version; defaults to `DRAFT` when a guardrail is set. |
| `guardrailTrace` | Bedrock trace mode: `enabled`, `disabled`, or `enabled_full`. |
| `transport` | Only `pi-native`; routes through a compatible `omp auth-gateway`. Requires that gateway as `baseUrl` and its bearer as `apiKey`. |

A provider without models must still do something: set at least one usable override such as `baseUrl`, `headers`, `apiKey`, `auth: none`, `compat`, `disableStrictTools`, `guardrailIdentifier`, `remoteCompaction`, `modelOverrides`, or `discovery`.

### API values

| `api` value | Endpoint family |
| --- | --- |
| `openai-completions` | OpenAI-compatible Chat Completions. |
| `openai-responses` | OpenAI-compatible Responses API. |
| `openai-codex-responses` | Codex-flavored Responses API. |
| `azure-openai-responses` | Azure-hosted Responses API. |
| `anthropic-messages` | Anthropic Messages API. |
| `bedrock-converse-stream` | Amazon Bedrock Converse streaming. |
| `google-generative-ai` | Gemini public API. |
| `google-gemini-cli` | Gemini CLI-compatible API. |
| `google-vertex` | Gemini through Vertex AI. |

These are the transports built into omp. An endpoint with a different wire protocol requires an extension, not another string in `models.yml`.

## Model field reference

| Model field | Meaning |
| --- | --- |
| `id` | Required, non-empty upstream model id. |
| `name` | Picker label; defaults to `id`. |
| `api` | Overrides provider `api` for this model. |
| `baseUrl` | Overrides provider `baseUrl` for this model. |
| `reasoning` | Marks the model as reasoning-capable. Must be true for a `thinking` control surface to apply. |
| `thinking` | Explicit effort controls; see below. Omit it to let known model identity and compatibility determine controls. |
| `input` | Supported inputs: `[text]` or `[text, image]`. |
| `imageInputDecoder` | Only `stb`; converts WebP input for a local backend that cannot decode it. |
| `tokenizer` | Optional local token estimator: `claude-v3`, `claude-v47`, `claude-v5`, `claude-v5-sonnet`, `qwen3`, `deepseek-v3`, `kimi-k2`, or `glm5`. |
| `supportsTools` | Whether the endpoint supports tool calling. |
| `cost` | Per-million-token rates. A full definition requires `input`, `output`, `cacheRead`, and `cacheWrite`. |
| `premiumMultiplier` | Multiplier applied to reported model cost. |
| `contextWindow` | Positive total context-token limit used by the context meter and overflow handling. |
| `maxTokens` | Positive maximum output tokens. |
| `omitMaxOutputTokens` | Omits the maximum-output-token request field when true. |
| `headers` | Per-model headers, merged over provider headers. Values support env names and `!command`. |
| `compat` | Per-model compatibility overrides, merged over provider `compat`. |
| `contextPromotionTarget` | Model id or `provider/model-id` to switch to after a context-overflow error, before compaction. |
| `compactionModel` | Model selector to prefer for compaction. |
| `remoteCompaction` | Per-model remote compaction settings. |

`modelOverrides` accepts the same metadata fields except `id`, `api`, and `baseUrl`. Its `cost` object may be partial, while a full model definition's `cost` must contain all four rates.

### Thinking fields

A new explicit `thinking` block uses this shape:

```yaml
reasoning: true
thinking:
  mode: effort
  efforts: [low, medium, high]
  defaultLevel: medium
```

| Field | Meaning |
| --- | --- |
| `mode` | Required: `effort`, `budget`, `google-level`, `anthropic-adaptive`, or `anthropic-budget-effort`. |
| `efforts` | Required for new configs: an ordered, non-empty subset of `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |
| `defaultLevel` | Default from the supported effort set. |
| `effortMap` | Optional mapping from those effort names to provider-specific strings. |
| `supportsDisplay` | Whether the provider accepts a thinking-display preference. |

Legacy `levels`, or the pair `minLevel` and `maxLevel`, are still accepted and normalized to `efforts`; prefer `efforts` in new files.

### Remote compaction fields

`remoteCompaction` may appear at provider, model, or override level. It accepts `enabled`, `api`, `endpoint`, `model`, `v2StreamingEnabled`, `v2Endpoint`, and `streamingEndpoint`. Endpoint and model strings must be non-empty. Leave this block out unless your provider offers a compatible server-side compaction endpoint.

## Advanced compatibility fields

Most OpenAI-compatible services work without `compat`. Set these fields only to match documented endpoint behavior or to address a concrete request error. Every field is optional; provider values form the baseline and model values merge over them.

**Request and streaming:**`supportsStore`, `supportsDeveloperRole`, `supportsMultipleSystemMessages`, `maxTokensField` (`max_completion_tokens` or `max_tokens`), `supportsUsageInStreaming`, `supportsToolChoice`, `supportsForcedToolChoice`, `alwaysSendMaxTokens`, `strictResponsesPairing`, `streamIdleTimeoutMs`, `cacheControlFormat` (`anthropic`), `supportsLongPromptCacheRetention`, `supportsImageDetailOriginal`, and `extraBody`.

**Reasoning:**`supportsReasoningEffort`, `supportsReasoningParams`, `reasoningEffortMap`, `thinkingFormat` (`openai`, `openrouter`, `zai`, `qwen`, or `qwen-chat-template`), `qwenTemplateReasoningEffort`, `reasoningContentField` (`reasoning_content`, `reasoning`, or `reasoning_text`), `requiresReasoningContentForToolCalls`, `allowsSyntheticReasoningContentForToolCalls`, `requiresAssistantContentForToolCalls`, `disableReasoningOnForcedToolChoice`, `disableReasoningOnToolChoice`, and `whenThinking`. `whenThinking` contains another partial compatibility block applied only while thinking is active.

**Tools and message history:**`requiresToolResultName`, `requiresMistralToolIds`, `requiresAssistantAfterToolResult`, `requiresThinkingAsText`, `supportsStrictMode`, `toolStrictMode` (`all_strict` or `none`), and `requiresToolResultId`.

**Streaming and Anthropic-compatible behavior:**`streamMarkupHealingPattern` (`kimi`, `dsml`, `qwen`, or `thinking`), `supportsEagerToolInputStreaming`, `allowAnthropicHeaderOverrides`, and `replayUnsignedThinking`.

**Gateway routing:**`openRouterRouting` and `vercelGatewayRouting`, each with optional `only` and `order` string lists.

**Bedrock prompt caching:**`promptCacheMode` (`none`, `automatic`, or `explicit`), `promptCacheMinimumTokens`, `promptCacheMaximumCheckpoints`, and `supportsLongPromptCacheRetention`.

## Troubleshooting

### The provider does not appear

Run `omp models <provider-id>`. One invalid custom entry disables custom providers from that file for the run, while built-in providers remain available. Check these rules first:

- A provider with `models` needs `baseUrl`.
- It needs `apiKey`, unless `auth` is `none` or already-supported `oauth`.
- It needs provider-level `api` or an `api` on every model.
- `id` must be non-empty; provided `contextWindow` and `maxTokens` must be positive.
- The root key is `providers`; settings such as `modelRoles` and `modelProviderOrder` belong in `config.yml`, not `models.yml`.

### The model appears but requests return 401 or 403

Confirm that the environment variable named by `apiKey` is exported in the shell that starts omp. Remember that a missing variable name falls back to a literal token, so `apiKey: MYCO_LLM_API_KEY` can still load even when the variable is absent. Check whether the service expects its normal SDK auth header or an explicit Bearer header; only the latter needs `authHeader: true`.

### Requests return 404 or “unsupported endpoint”

Check the API family and URL together. `openai-completions` needs Chat Completions, while `openai-responses` needs Responses. Generic OpenAI-compatible base URLs commonly end in `/v1`; llama.cpp discovery accepts its native root and normalizes model request URLs itself.

### Discovery returns no models

Make sure the server is running, then run `omp models refresh <provider-id>`. Use `ollama` only for native Ollama endpoints and `openai-models-list` for a generic `/v1/models` service. If the server is remote or slow, set a larger positive `discovery.timeoutMs`.

### Tool calls or reasoning fail with a 400

For an Anthropic-compatible proxy that rejects strict tool schemas, set `disableStrictTools: true`. For an OpenAI-compatible dialect mismatch, change only the relevant `compat` field named by the service's error; broad copied compatibility blocks can disable features the endpoint actually supports.

### Context or usage numbers look wrong

Discovered endpoints do not always report reliable metadata. Declare the model explicitly, or add a `modelOverrides` entry with the real `contextWindow`, `maxTokens`, `input`, `reasoning`, and `cost` values.

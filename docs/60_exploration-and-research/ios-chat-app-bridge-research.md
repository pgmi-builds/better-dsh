# iOS 原生 Chat App 桥接 DSH 调研（Chatbox / Cherry Studio）

- 日期：2026-09-02
- 结论状态：调研完成，未实施
- 目标：让没有 iOS App 的 Agent（DSH）借用已有原生 iOS App 的壳，获得原生移动端体验。核心思路：把 DSH 桥接成 OpenAI-compatible 的数据流（`/v1/chat/completions` SSE），供 Chatbox / Cherry Studio 消费。

---

## TL;DR

| 问题 | 答案 |
|---|---|
| Chatbox 有 iOS App 吗 | **有，已上架 App Store**（[id6471368056](https://apps.apple.com/us/app/chatbox-powerful-ai-client/id6471368056)，4.6★），Google Play/APK 也有 |
| Chatbox iOS 能接自定义 OpenAI 兼容端点吗 | **能**。自定义 provider 只支持 OpenAI 规范（`apiHost` + `apiPath`，默认 `/v1/chat/completions`），且支持 JSON/deep-link 一键导入（v1.15.1+） |
| Cherry Studio iOS 过了测试期吗 | **没有**。截至 2026-09-02 仍是 TestFlight 内测 + IPA 侧载，最新版 v0.1.7（2026-02-27），未上 App Store |
| DSH 能被桥接吗 | **能，且不需改 harness 内核**。官方已有 4 个程序化表面：`headless` 一次性 CLI、Python/TS SDK（JSON-RPC over stdio，带事件流）、ACP server（标准 Agent Client Protocol）、webhook。推荐：OpenAI shim + Python SDK |
| 推荐路线（2026-09-02 下午更新，见 §9） | **主路线：ACP 直连** —— iOS ACP 客户端已存在且在 App Store（Agmente 等），DSH 自带 `--profile acp`，套一层 stdio→wss 即零开发直连；**兜底：Chatbox + OpenAI shim**（§4）。Cherry Studio 观望其 GA |
| iOS 上有"Cherry Studio × Chatbox 整合体"吗 | **有，Agmente**：原生 iOS、App Store 在架、直接说 ACP（thinking/tool call/权限审批全语义）、支持远端 `wss://`（见 §9） |

---

## 1. Chatbox 现状

### 1.1 基本信息

- 仓库：[chatboxai/chatbox](https://github.com/chatboxai/chatbox)（Community Edition，**GPLv3**，Electron 桌面端开源；官方注明"regularly sync code from the pro repo"，iOS/Android 由 pro 仓库构建发布）。
- iOS：**App Store 正式在架**（[Chatbox - Powerful AI Client](https://apps.apple.com/us/app/chatbox-powerful-ai-client/id6471368056)，"Designed for iPad"，4.6★/595 ratings）。Android：Google Play（`xyz.chatboxapp.chatbox`）+ 官网 APK。
- 特性（App Store 页自述）：多模型接入、"**Flexibly configure your own model services**"（自定义模型服务）、文档理解、图片生成、Markdown/LaTeX/HTML 渲染、本地优先存储、流式回复。

### 1.2 Provider 协议（桥接的关键契约）

官方[导入第三方提供方配置文档](https://raw.githubusercontent.com/chatboxai/chatbox-docs/main/guides/providers/import-config.md)（v1.15.1+）定义的 `ProviderConfig`：

```typescript
{
  id: string, name: string,
  type: 'openai',            // 目前仅支持 openai 规范的 API
  urls: { website, getApiKey?, docs?, models? },
  settings: {
    apiHost: string,          // 如 https://bridge.pc.randomhash.app
    apiPath?: string,         // 默认 /v1/chat/completions
    apiKey?: string,          // 桥的 Bearer token
    models: ModelInfo[]       // modelId/nickname/_type/capabilities/contextWindow/maxOutput
  }
}
```

- **对我们最重要的一条**：自定义 provider 走且仅走 **OpenAI Chat Completions 规范**——这正好是桥接层要实现的东西，无需任何私有协议。
- 一键导入：`chatbox://provider/import?config=$BASE64_JSON`（deep link，iOS Safari 点击即入 App）。可以做一个"扫码/点链接即配好"的 onboarding 页面。
- `ModelInfo.capabilities`（`vision | reasoning | tool_use`）与 `contextWindow/maxOutput` 决定 Chatbox 的调用方式与限流，桥应在 `/v1/models` + 导入配置里如实声明。

### 1.3 对桥接的含义

- Chatbox 把**完整对话历史**随每个请求发来（OpenAI API 无状态语义）→ 桥可以无状态化，也可以做"粘性会话"（见 §4.3）。
- Chatbox 支持图片输入（vision）→ OpenAI `image_url` 消息可映射到 DSH SDK 的 `SdkEncodedImageBlock`。
- Chatbox 是纯 chat UI，不渲染 function-call 协议 → agent 的工具调用必须在**服务端**由 DSH 自己闭环，进度只能以文本增量呈现。

---

## 2. Cherry Studio 移动端现状（用户 asked：测试过了没？）

**答案：还没。截至 2026-09-02 仍是内测（TestFlight），未上 App Store。**

### 2.1 版本时间线（[releases](https://github.com/CherryHQ/cherry-studio-app/releases)）

| 版本 | 日期 | 要点 |
|---|---|---|
| 0.1.0 | 2025-10-31 | Day one 内测：[iOS TestFlight](https://testflight.apple.com/join/Mdd3bqvT) + IPA/APK 侧载（[LINUX.do 公告](https://linux.do/t/topic/1109448)） |
| 0.1.1 | 2025-11-04 | CherryAI 免费模型、token 用量展示、局域网同步、provider 增删改修复 |
| 0.1.2 | 2025-11-20 | Gemini 3 适配、响应式布局、ai-core 升级 |
| 0.1.5 | 2025-12-25 | 左滑 Topic、粘贴图片、局域网传输改 TCP |
| 0.1.6 | 2026-01-08 | PDF 上传、**StreamableHTTP MCP**、迁移 pnpm |
| **0.1.7（最新）** | **2026-02-27** | HeroUI 重构、流式自动滚动开关等；此后 ~6 个月无新 release |

### 2.2 仓库与 Roadmap

- 仓库：[CherryHQ/cherry-studio-app](https://github.com/CherryHQ/cherry-studio-app)（Expo React Native + Tamagui + Redux，开源）。
- [Roadmap #234](https://github.com/CherryHQ/cherry-studio-app/issues/234)（最后更新 2026-04-25，仍 open）：待办 = 同步桌面端 V2 数据结构、WebDAV、桌面↔移动数据同步、升级 RN 0.83/Expo 55。
- README：多 LLM provider"逐步集成 OpenAI, Gemini, Anthropic 等"；provider/渠道管理已可用（0.1.1 起修复增删改）。

### 2.3 判断

- 用户两个月前（~2026-07）"在测试"的信息**今天仍成立**：最新 release 停在 2026-02 的 0.1.7，roadmap 未完成，未见 App Store listing。
- 移动端已有 OpenAI 规范 provider + 自定义渠道 + MCP（StreamableHTTP）——**一旦桥做好，Cherry Studio 移动端同样能直接消费**（它的 provider 模型与桌面版同源：自定义 apiHost + OpenAI 兼容格式）。
- 风险：项目节奏慢（半年没发版）、iOS 侧载 IPA 需自签（个人 Apple ID 7 天过期）、TestFlight 席位可能满。**不宜作为第一落地目标**。

---

## 3. DSH 侧可桥接面盘点（本机 upstream `dsh-v0.1.2-alpha.5` 源码实证）

DSH 官方已有 **4 个程序化驱动表面**，桥接完全不需要 hack web GUI：

| 表面 | 入口 | 特性 | 适配桥接度 |
|---|---|---|---|
| **headless profile** | `dsh --profile headless "task"` | 跑一个任务、打印最终答案、exit code 表达成败；不开端口、不留进程 | ★★★（最简 MVP，但**无增量流式**、一次一任务） |
| **Python SDK**（`pip install deepseek-harness-sdk`，[PyPI 已发布](https://pypi.org/project/deepseek-harness-sdk/)：v0.1.2a3 2026-09-01 上架，owner `DeepSeek-Harness`，MIT，随包捆绑同版本 `deepseek-harness-runtime-bin` dsh runtime wheel，无需系统 Node） | `DeepSeekHarness(dsh_home, cwd, provider, model, reasoning_effort, max_tokens)` → `harness.run(prompt, session_id=...)` | 启动 `dsh --profile sdk` 子进程，newline-JSON-RPC over stdio；`RunResult(final_response, finish_reason, events, notifications)`；**`session.event` 通知流 = 增量文本块 → 可转 SSE**；session_id 复用即续会话（durable）；支持图片块 | ★★★★★（推荐主通道） |
| **TS SDK / JSON-RPC server** | `dsh-sdk-client` ↔ `dsh-sdk-jsonrpc-server` 插件 | 同一协议的 TS 实现（`initialize` / `session/prompt` / `session.event` / `session.status` / `subagent.*`） | ★★★★（若桥用 Node 写） |
| **ACP server** | `dsh --profile acp` | 标准 Agent Client Protocol（JSON-RPC stdio）：建/列/续/关会话、发文本+图片、收语义更新、**答权限询问**、取消 | ★★★★（标准化更好，但生态里 chat app 不讲 ACP，最终仍要 shim） |
| webhook 子系统 | `webhook-github` 等 | 已验证的外部事件 → 创建 Session（fire-and-forget） | ★★（触发型，非对话型） |
| web GUI 私有协议 | 3080 端口 typertGateway Remote 层 | token 认证 + 私有 typed 协议，**非公开稳定 API**，streaming 刻意在其外 | ✗（不建议第三方 App 直连） |

两个额外发现：

1. **`packages/test-support/llm-mock-server`（`dsh-llm-mock-server`）——是测试替身，不是桥，对 Python 桥参考价值≈0**：只存在于 upstream 源码 `test-support/` 区（**不随 prod npm 包分发**；入口是 monorepo 根的 `pnpm run mock:llm`）。协议层它确实是 OpenAI-compatible `POST /v1/chat/completions` + Bearer + SSE。但用途是给 **DSH 自己的 LLM 客户端**当假供应商：按预写剧本（FIFO）回放流重置/429/500/畸形 chunk 等抽风行为，在真实 HTTP 边界测 DSH 的重试/退避/超时——这活儿真供应商和 openai 官方 SDK（客户端库）都演不出来，所以 DSH 才自己造了个假服务端。**它不连模型、不跑 agent，把 Chatbox 指上去只会收到剧本假响应**。注意桥的协议契约的权威是 **OpenAI 规范 + Chatbox 实际发送/期待的行为**，不是 DSH 的测试代码——mock server 被 DSH 测试验证过，对 Chatbox 兼容性没有任何背书。Python 桥的正确参考物：openai 官方 Python SDK 的 pydantic 类型（可直接 import 解析请求/构造响应）+ FastAPI/sse-starlette（SSE 分帧），测试时把 openai 官方客户端指向桥跑通即可。mock server 仅在选 TS/Node 桥（用 `dsh-sdk-client`）时才有同语言搬运价值。
2. **安全默认**：SDK/ACP 是 automation-only（无人值守），`DeepSeekHarness` 必须显式 `dsh_home`（绝不读 `~/.dsh`）——桥应使用独立 DSH_HOME（如 `.dsh-bridge/`），与 prod `~/.dsh` 隔离，天然规避误操作。

---

## 4. 桥接架构提案（`dsh-openai-bridge`）

### 4.1 组件图

```
┌─────────────┐  OpenAI 规范    ┌──────────────────────────┐  JSON-RPC/stdio  ┌────────────────┐
│ Chatbox iOS │ ──────────────▶ │  dsh-openai-bridge       │ ───────────────▶ │ dsh --profile  │
│ (App Store) │  GET /v1/models │  (FastAPI, 常驻)          │  session/prompt  │ sdk (子进程池)  │
│ Cherry 移动端│  POST /v1/chat/ │  Bearer 校验              │  session.event   │  → 工具/模型/   │
│ (TestFlight)│  completions    │  model→profile 映射       │  ◀── 通知流      │    会话持久化   │
└─────────────┘  (SSE stream)   └──────────────────────────┘                  └────────────────┘
       ▲                               │
       │  chatbox://provider/import     │ 独立 DSH_HOME（隔离 prod）
       └──── onboarding 页(一键导入配置) │ 部署: LAN 直连 / Caddy 反代(需批准) / Tailscale
```

### 4.2 协议映射

| OpenAI 侧 | DSH 侧 |
|---|---|
| `POST /v1/chat/completions` | `harness.run(prompt, session_id=…)` |
| `messages[]`（含图片 `image_url`） | 文本拼装为任务 prompt；图片 → `SdkEncodedImageBlock` |
| `model: "dsh-agent"` / `"dsh-web"` / … | 伪模型名 → (profile / provider / reasoning_effort) 映射表 |
| SSE `delta.content` | `session.event` 通知流中的文本块增量（`on_notification`） |
| `finish_reason: stop/length` | `RunResult.finish_reason`: `completed`→stop、`max-tokens`→length、`error`→stop+错误文本 |
| `GET /v1/models` | 映射表导出（同时生成 Chatbox `ProviderConfig` JSON） |
| `Authorization: Bearer <key>` | 桥自有 API key（用户填进 Chatbox 的 apiKey 字段） |

### 4.3 会话连续性（关键设计点）

OpenAI 请求无状态（全量 history 每次都发），两条路线：

- **A. 无状态（MVP）**：每次请求把整段 history 压成一个 prompt，跑一次性任务（headless 或新 session）。实现最简，语义忠实；代价是 DSH 侧上下文/工具状态不复用、每请求冷启动。
- **B. 粘性会话（推荐 V1）**：以 (chat 标识 + history 前缀哈希) 映射到稳定 `session_id`，只发**最新一轮 user 消息**，DSH 侧 durable session 保留上下文与工作区状态；检测到 history 被编辑/回退则重开 session。SDK 明确支持：*"Reusing both a harness and session id continues the durable conversation"*。
- 进程模型：常驻 `DeepSeekHarness` 子进程池（按 session 粘住），避免每请求 spawn dsh（冷启动秒级）。

### 4.4 流式与长任务

- Agent 一轮可能跑数分钟（工具循环）。SSE 需周期性 keep-alive（注释帧/心跳 delta），防止 iOS URLSession/Chatbox 超时断流。
- 工具活动不可用 function-call 协议呈现 → 约定**文本化进度**：如 `⚙️ running bash …` 细节折叠（Chatbox 渲染 Markdown，可用 `> ` 引用块或 `<details>`），最终只保留 assistant 正文。
- 非流式兜底：`stream:false` 直接回 `RunResult.final_response`。

### 4.5 部署拓扑（贴合本机现状）

- 桥进程：systemd user unit，监听 `127.0.0.1:<port>`；独立 `DSH_HOME=~/.dsh-bridge`。
- 暴露三选一：① LAN 直连（iPhone 同 WiFi，`http://192.168.31.130:port/v1`，Chatbox 允许 http 自定义 host）；② **Caddy 反代**加子域（如 `dshapi.pc.randomhash.app` → 桥端口，HTTPS 自动证书，外网可达）——改 `/etc/caddy/Caddyfile` 按 AGENTS.md 需明确批准；③ Tailscale（最省事且不暴露公网）。
- 凭据：桥的 Bearer key 即 Chatbox 里填的 API key；`.env` 沿用 `~/.dsh/.env` 的真实 key 供 DSH 模型侧使用。

### 4.6 安全

- 桥 = 公网可打到的 agent 执行面：必须有 Bearer 鉴权、限流、超时；建议白名单 workspace（`cwd` 固定到专用目录）+ sandbox 策略（workspace-write、危险操作 guard）。
- automation 表面无人工确认（ACP 才有 permission answer 循环，SDK 直接跑）→ 远端触发 `bash` 等工具的风险要靠 DSH 侧 sandbox/permission profile 约束，而不是靠 App。

---

## 5. 先例（prior art）

- [i-am-logger/claude-code-proxy](https://github.com/i-am-logger/claude-code-proxy)、[AntonioAEMartins/claude-code-proxy](https://github.com/AntonioAEMartins/claude-code-proxy)：把 Claude Code CLI 包成 OpenAI Chat Completions API（含 SSE）——**同一模式的成熟先例**，证明"CLI agent → OpenAI 兼容端点 → 任意 chat App"路线可行且社区有需求。
- keenturbo/[2API](https://github.com/keenturbo/2API)：各家模型互转 OpenAI 兼容 API 的教程集。
- 桥的 OpenAI 协议面：openai 官方 Python SDK（客户端库；其 pydantic 类型可 import 来做服务端解析/构造，也是测试桥的首选客户端）+ FastAPI/sse-starlette；DSH repo 内 `dsh-llm-mock-server`（TS，测试替身）仅在 TS 桥路线下可搬运其服务端代码（见 §3）。

---

## 6. 风险与缺口

| 风险 | 影响 | 缓解 |
|---|---|---|
| Cherry Studio 移动端长期 0.1.x、半年无 release | 第二目标不确定 | 先落地 Chatbox；Cherry 观望 v0.2/GA |
| 长任务 SSE 被移动端掐断 | 体验中断 | 心跳帧 + 非流式兜底 + 断线后按 session_id 拉回结果 |
| 每请求冷启动慢（spawn dsh） | 首字延迟 | 常驻子进程池 + 粘性会话 |
| 无 function-call 透传，工具过程只能文本化 | 可视化降级 | 约定 Markdown 进度样式；未来可发富卡片（仅 dsh web 有） |
| 公网暴露 agent 执行面 | 安全 | Bearer + 限流 + sandbox profile + Tailscale 优先 |
| Chatbox 移动端与桌面端 provider 能力可能有差 | 配置不通 | iOS 实测验证（App Store 版当前支持自定义 provider，见 §1.1）；deep link 导入兜底 |
| GPLv3（Chatbox CE） | 仅 API 互通无碍；若 fork 其代码需遵守 GPL | 我们只做服务端，不碰其代码 |

---

## 7. 建议路线

1. **MVP（半天级）**：FastAPI 单文件桥：`POST /v1/chat/completions`（`stream:false`）→ 每请求 `dsh --profile headless` 拼全量 history 跑一次；`/v1/models` 假列表 + Chatbox 导入 JSON。局域网 iPhone 实测 Chatbox 连通。
2. **V1（1–2 天）**：换 Python SDK 常驻进程池 + 粘性 session_id + `session.event`→SSE 增量流 + 心跳；onboarding 页生成 `chatbox://provider/import` deep link；Caddy/Tailscale 暴露。
3. **V2（按需）**：图片输入（vision）、`model` 后缀映射 reasoning_effort、多 profile 伪模型（dsh-fast/dsh-max）、Cherry Studio 移动端接入验证、ACP 后端可替换实现。

> 附带红利：桥一旦存在，**任何** OpenAI 兼容客户端（不止这两个 App：LobeChat、OpenWebUI、Raycast、快捷指令……）都能直接消费 DSH agent。

---

## 8. 参考

- Chatbox：[GitHub](https://github.com/chatboxai/chatbox) · [App Store](https://apps.apple.com/us/app/chatbox-powerful-ai-client/id6471368056) · [官网](https://chatboxai.app) · [provider 导入配置文档](https://raw.githubusercontent.com/chatboxai/chatbox-docs/main/guides/providers/import-config.md)
- Cherry Studio 移动端：[GitHub](https://github.com/CherryHQ/cherry-studio-app) · [Releases](https://github.com/CherryHQ/cherry-studio-app/releases) · [Roadmap #234](https://github.com/CherryHQ/cherry-studio-app/issues/234) · [TestFlight](https://testflight.apple.com/join/Mdd3bqvT) · [发布公告 (LINUX.do)](https://linux.do/t/topic/1109448)
- DSH（本机源码 `upstream/deepseek-harness` @ `dsh-v0.1.2-alpha.5`）：`python/README.md`、`python/sdk/README.md`、`packages/sdk/protocol/README.md`、`packages/bundle/headless/README.md`、`packages/acp/README.md`、`packages/api/README.md`、`packages/test-support/llm-mock-server/README.md`
- 先例：[claude-code-proxy (i-am-logger)](https://github.com/i-am-logger/claude-code-proxy) · [claude-code-proxy (AntonioAEMartins)](https://github.com/AntonioAEMartins/claude-code-proxy) · [2API](https://github.com/keenturbo/2API)

---

## 9. 追加调研（2026-09-02 下午）：ACP 路线成立，OpenClaw 官方 iOS 已上架

> 背景：用户把目标升级为"iOS 上现成的、能接 **Agent**（非纯 LLM）的 App"——即 Cherry Studio（Agent 接口完善）× Chatbox（App Store 入场券）的整合体。结论：**这个整合体已经存在，而且不止一个。**

### 9.1 iOS 上的 ACP 原生客户端（[ACP 官方 clients 页](https://agentclientprotocol.com/get-started/clients) Mobile clients 专区）

| App | App Store | 协议/形态 | 远端连接 | 备注 |
|---|---|---|---|---|
| **[Agmente](https://github.com/rebornix/Agmente)** ⭐首推 | ✅ [id6756249477](https://apps.apple.com/us/app/agmente/id6756249477) | **原生 ACP** + Codex app-server；Swift 原生、MIT；工具调用/结果/会话历史全渲染 | ✅ 官方路径：远端 host 起 agent → `stdio→wss`（`npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 "<agent> --acp" --port 8765`）→ TLS → App 填 `wss://`；支持 Bearer + Cloudflare Access | 作者 rebornix（GitHub 资深工程师）；README 明示支持 Copilot CLI/Gemini CLI/Claude Code adapters/Qwen/Mistral Vibe 等"任何 ACP agent" |
| [Shellular](https://github.com/shellular-org/app) | ✅ [id6761985327](https://apps.apple.com/us/app/shellular/id6761985327) | Claude Code/Codex/Pi 手机遥控（ACP 类） | ✅ | 2026-07 HN 热帖"用手机跑编程 agent" |
| [MobileVibe/Mobvibe](https://github.com/Eric-Song-Nop/mobvibe) | ✅ [id6758524635](https://apps.apple.com/tw/app/mobilevibe/id6758524635) | Claude Code Remote Control | ✅ | LINUX.do 作者帖（封号后自做） |
| [Happy](https://github.com/slopus/happy) | ✅ [id6748571505](https://apps.apple.com/us/app/happy-claude-code-client/id6748571505) | Claude Code/Codex 专用（`happy` CLI 包装 + 自家 E2E relay） | ✅（自家 server 中转） | 产品成熟但**绑定 claude/codex 两个 CLI**，对任意 ACP agent 不通用 |
| ACP UI（formulahendry/acp-ui） | 未逐个核实 | 声称 iOS/Android/Web | — | 备选 |

**对 DSH 的意义——零开发直连路径（理论，待 iPhone 实测）**：

```bash
# PC 侧（DSH 自带 ACP server profile）：
DSH_HOME=~/.dsh-acp npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 \
  "dsh --profile acp" --port 8765
# Caddy 给 wss:// 套 TLS（改 Caddyfile 需批准，AGENTS.md 约定）
# iPhone Agmente 填 wss://<host> + Bearer
```

ACP 的表达力正是 OpenAI shim 给不了的：**thinking 过程、tool call 事件、权限审批（permission request→iOS 上点批准）、cancel**，DSH 的 ACP server（`packages/acp`：建/续/关会话、MCP attach、模型选择、文本+图片 prompt、语义更新、答权限、取消）全部原生覆盖。原 §4 的 OpenAI shim 方案**降级为兜底**（覆盖 Chatbox 等纯 LLM 壳 App 仍有价值）。

### 9.2 OpenClaw：官方 iOS App **已于 2026-06-30 上架** App Store + Google Play

- 多源报道（2026-06-30）：[新浪](https://finance.sina.com.cn/roll/2026-06-30/doc-inifczzw4921295.shtml)、[ZOL](https://ai.zol.com.cn/1207/12079539.html)、[太平洋](https://www.pconline.com.cn/ai/article/1612736.html)、[MacMagazine](https://macmagazine.com.br/post/2026/06/30/openclaw-ganha-aplicativo-para-ios-com-controle-remoto-de-agentes/)、[36氪（"OpenClaw和Cursor杀入手机"）](https://www.36kr.com/p/3875041298961416)；repo 有 `apps/ios/`；设计方向见 [issue #85731](https://github.com/openclaw/openclaw/issues/85731)（含 approvals/approval queue 界面 = 权限审批一等公民）。
- 对 DSH：**无直接消费价值**——OpenClaw App 只连 OpenClaw 自家 gateway（它本身是 agent 运行时，不是通用 agent 客户端）。除非把 DSH 包装成 OpenClaw 的 skill/agent（不建议）。但生态信号明确：OpenClaw 也在向 ACP 收敛（acpx CLI 在 ACP clients 榜单、`@openclaw/acp-standard` plugin PR #28662）。
- 用户问"OpenClaw 有没有 iOS 计划"——答案：不只是计划，**已上架两个月**。

### 9.3 Cherry Studio iOS 状态复查（2026-09-02 当日二次核实）

- repo **活跃**：`pushed_at = 2026-09-02T13:12Z`（当天数小时前还在推代码）；stars 3776。
- 但 **最新 release 仍是 v0.1.7（2026-02-27），TestFlight 仍在，App Store 仍无 listing**——用户在 App Store 搜不到是准确的。判断：v0.2/桌面端 V2 数据同步重构进行中（roadmap #234），上架遥遥无期，继续观望。
- **协议考证（纠正）**：用户猜测 Cherry Studio 接 OpenClaw 走 ACP。经官方文档 ask 接口核实：Cherry 官方文档中 **Cherry Agent 的后端协议要求是 Anthropic 兼容（`/v1/messages`）**（[providers 文档](https://docs.cherryai.com.cn/pre-basic/providers.md)："Cherry Agent 需要此类型（Anthropic 兼容）"），文档中未见 ACP。网上"Cherry Studio 接 OpenClaw"教程大概率是把 OpenClaw 的 **Anthropic 兼容端点**当 provider 用。若 Cherry iOS 将来上架，DSH 对接它的正确姿势可能是 **Anthropic `/v1/messages` shim**（而非 ACP bridge），比 OpenAI shim 多一层 thinking/tool_use 块语义，工作量相近。
- DeepWiki 显示 cherry-studio 桌面版有 "Code Tools and CLI Integration"（Claude Code 等 CLI 集成）章节，其协议（ACP 或内部 spawn）未证实——若为 ACP，则 Cherry 桌面/未来 iOS 亦可直连 DSH ACP server。

### 9.4 更新后的路线排序

1. **主路线（ACP 直连，≈零开发）**：Agmente + `@rebornix/stdio-to-ws` + `dsh --profile acp` + Caddy TLS。先 iPhone 实测握手兼容性（DSH ACP 是标准 Zed 式 ACP，理论兼容，未实测）。
2. **兜底（OpenAI shim，1–2 天）**：§4 方案不变，覆盖 Chatbox 等一切 OpenAI 兼容客户端。
3. **观望**：Cherry Studio iOS（若上架，按 Anthropic-compat shim 对接）；OpenClaw App（与 DSH 无消费关系）。

### 9.5 本机 runtime 网络接口扫描（2026-09-02 实测；用户已装 Agmente，确认其服务端形态 = WS/WSS + Bearer）

**问题**：本机已装的 agent 运行时，有没有原生就挂 WS/WSS（说 ACP）的？——**答案：没有。**

| Runtime（本机实测） | 网络原生接口 | ACP 传输层 | Agmente 直连？ |
|---|---|---|---|
| **Hermes** v0.20.6 | HTTP API ×4 个 profile 常驻（`0.0.0.0:8642-8645`，JSON+SSE：`/api/sessions/{id}/chat`、`/v1/runs`、OpenAI 兼容子集）；**WebSocket 仅 `/v1/browser-control/ws`**（浏览器控制通道，一次性 ticket + 子协议，非 agent 对话入口）——源码 `~/.hermes/hermes-agent/gateway/platforms/api_server.py` 实证 | `hermes acp` = **stdio only**（`--help` 无任何 port/ws 参数，面向 Zed/VS Code/JetBrains） | ❌ HTTP API 是 Hermes 私有 REST，非 ACP |
| **OpenCode** 1.17.13 | `opencode serve`（自家 HTTP API + basic auth） | `opencode acp --port N` 的 **port 是它内部 HTTP server**（供 ACP 层经 SDK 调 opencode 本体），ACP wire 本身接在 stdin/stdout（二进制字符串实证：handler 把 `process.stdin` ReadableStream 喂给 ACP connection，stdout 做 sink） | ❌ 矩阵文档"stdio + HTTP"的 HTTP 部分不承载 ACP |
| **DSH** 0.1.2-alpha.3/5 | web GUI 私有协议（3080/3081/4999） | `dsh --profile acp` = stdio（upstream `packages/acp` 明确 JSON-RPC over stdio） | ❌ |
| Pi / Claude Code / agy | 无 HTTP/WS daemon | 无原生 ACP（Claude 有 `@agentclientprotocol/claude-agent-acp` adapter） | ❌（Claude 走 adapter+wrapper） |
| OpenClaw | WS gateway :18789 是**自家协议**非 ACP；且不在本机（在 dev4） | `openclaw acp`（bridge to gateway） | ❌ |

**结论与对策**：ACP 生态目前的远端标准形态就是"远端 host 起 stdio ACP agent → `stdio-to-ws` 包成 wss"（Agmente 官方 quick start 即如此）。`@rebornix/stdio-to-ws` v0.2.0（npm 实查：Apache-2.0，31KB，仅依赖 ws+minimist，`--persist --grace-period 604800` 断连后子进程保活 7 天）就是为这个缺口而生的通用件。零代码拓扑：

```
iPhone Agmente ─wss+Bearer→ Caddy(TLS) → stdio-to-ws → stdio → ┬─ dsh --profile acp  (DSH_HOME=~/.dsh-acp)
                                                                ├─ hermes acp
                                                                └─ opencode acp
```
每个 agent 一个 wrapper 实例/端口。若要**单端点多路复用多 agent**（一个 wss，session 级路由到不同 agent），才需要自研小 ACP-over-WS 网关（Node+ws 几百行，newSession 时路由）——建议先跑通单 agent 实测 Agmente 兼容性再决定。

⚠️ 顺手发现：Hermes 4 个 API server 绑 `0.0.0.0`（全网卡监听）；已有 `API_SERVER_KEY` 认证（`~/.hermes/.env`），但建议确认 LAN 暴露是否合意。

---

## 10. DSH-ACP 实测记录（2026-09-02 晚，全部通过）

测试环境：`DSH_HOME=<ws>/.dsh-test`（隔离测试 home，真实模型 key），agent 工作目录 `.scratch/acp-playground`，模型 `deepseek-official/deepseek-v4-flash`（3 次真实小回合）。脚本：`.scratch/acp_smoke.py`（stdio 直连）、`.scratch/acp_ws_test.py`（WS 两阶段，含断线重连）。

### 10.1 Phase 1 — stdio 直连 `dsh --profile acp`：✅ PASS

| 步骤 | 结果 |
|---|---|
| `initialize` | 1.7s 返回；agentInfo `deepseek-harness-acp v0.0.1`；caps：mcp.http=true、sessionCapabilities **close/list/resume**、promptCapabilities image=false |
| `session/new` | sessionId + configOptions（model select：deepseek-official/deepseek-v4-flash） |
| `session/prompt`（"Reply with exactly: ACP-OK"） | 流式 `agent_message_chunk` + `usage_update`；stopReason=end_turn；回复正是 `ACP-OK` |
| `session/close` + stdin EOF | 干净退出 |

### 10.2 Phase 2 — WebSocket（Agmente 确切路径）：✅ PASS

`npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 "dsh --profile acp" --port 8800`

- **Phase A**：connect → 信封帧 `{"type":"connected","clientId":…}` → initialize → session/new → prompt → **`WS-ACP-OK`**；期间观察到 `agent_thought_chunk`（思维流）、`agent_message_chunk`、`usage_update`。
- **Phase B（断线重连）**：断开 → 带 `X-Client-Id` 头重连 → 信封 `{"type":"reconnect",…}`（**同一 dsh 子进程被重新挂上**）→ `session/list` 列出 2 个会话（含 Phase 1 stdio 测试的历史会话 = 跨进程持久化）→ 对原 sessionId 直接 prompt "What was the secret word?" → 回答 **`KIWI-7741`**（断线前埋的秘密词）→ **memory-across-reconnect: PASS**。

### 10.3 踩坑记录（对给 Agmente 配 DSH 有直接参考价值）

1. **换行分隔必须由客户端补**：wrapper 是纯字节管道，ACP 是 newline-delimited JSON-RPC。发 JSON 不带 `\n` → dsh 行读取器永远等待 → 表现为"子进程沉默卡死"。补 `\n` 后立刻全通。
2. **wrapper 信封协议**：每连接首帧 `{"type":"connected","clientId"}`；重连须带 `X-Client-Id` 请求头 → 收 `{"type":"reconnect"}` 并回放断线期间缓冲的消息。ACP 消息解析前要跳过信封帧。
3. **黏包**：一个 stdout chunk 的多条 JSON 可能黏在一个 WS 帧里，客户端须按行拆分。
4. **`session/load` 不存在**（-32601）；DSH 的会话恢复按 caps 是 **`session/resume`**。且 `--persist` 同子进程存活期间，直接对原 sessionId `session/prompt` 也能续（B 阶段即如此）。
5. `promptCapabilities.image=false`：当前默认路由不接受图片 prompt。

### 10.4 结论与服务端建议命令

DSH → iOS Agmente 的服务端链路**已在协议层全通**（stdio 与 WS 两种传输、断线重连、跨进程会话持久化、思维流/工具事件通道均验证）。剩余步骤只有网络暴露与 iPhone 真机连接：

```bash
# systemd user service 建议形态
Environment=DSH_HOME=/home/u1/workspaces/dashr/.dsh-acp   # 建议专用 home，与 .dsh-test/prod 分离
Environment=npm_config_cache=/home/u1/workspaces/dashr/.scratch/npm-cache
ExecStart=/usr/bin/env npx -y @rebornix/stdio-to-ws --persist --grace-period 604800 \
  "dsh --profile acp" --port 8800
# Caddy: dshacp.pc.randomhash.app { reverse_proxy 127.0.0.1:8800 } → iPhone Agmente 填 wss://dshacp.pc.randomhash.app
# （改 Caddyfile 需批准；wrapper 本身不带 Bearer 校验，认证依赖 TLS + Cloudflare Access 或前置网关，见 §9.1 Agmente 的 Access 支持）

### 10.5 iPhone Agmente 真机首连（2026-09-02 深夜）— 首连成功，notice 已定性

用户 iPhone Agmente 连 `ws://192.168.31.130:8800`：服务器被识别（deepseek-harness-acp v0.0.1），随后 App 弹 `Session…NotSupported` 提示。wrapper 日志定性：

- Agmente 连接序列：initialize（clientInfo "Agmente iOS"）→ `session/list` → **`session/load {sessionId:"capability-probe"}` 能力探测** → -32601 → 弹 notice。它还实测了 X-Client-Id 重连（wrapper 信封 reconnect 正常工作）。
- **规范定性（ACP schema 原文）**：`session/resume` = "Resumes an existing session without returning previous messages (unlike session/load)"。DSH 实现的是 resume（与它宣告的 `sessionCapabilities.resume{}` 一致），未实现 `session/load`（完整 transcript 回放）。**该 notice 是能力降级提示，非故障**——Agmente 自己的 App Store 描述就是这个模式的说明（历史本地存、agent 记得即可续）。
- **聊天主路径已验证**：模拟 Agmente 全序列（initialize→list→load 探测→session/new cwd=/tmp→中文 prompt）→ stopReason=end_turn、回复正常。**用户操作：关掉 notice，新建对话直接聊。**
- 次要坑：Agmente 发过 `cwd:"~/.dsh-acp"` 被 DSH 拒（-32602 要求绝对路径）——App 里 workspace/目录字段须填绝对路径（如 `/tmp` 或 `/home/u1/workspaces/dashr/.scratch/acp-playground`），不能带 `~`。
- 消除 notice/获得完整回放需给 DSH 实现 `session/load`（upstream 功能缺口，非配置项）；当前 resume-only 已满足移动端使用。

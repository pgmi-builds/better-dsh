# Design — native-tools (0.1.9-a)

## Context

前置事实（v0.1.8f 四连修 + 本轮 explore 调查坐实）：

- `collectSdkSchemas` 从 `registry.schemas(scope)` 读，**跳过无 `output.schema` 的 definition**（index.ts:848-849）——桥要进目录必须带 output schema。
- `ctx.llm` 服务存在且是 **host plane**（dsh-llm `LlmRuntime`，`super(ctx, "llm")`）——与 `subagents` 同类，**没有** workflowEngine 那样的 preset realm 隔离，`ctx.get('llm')` 直达。
- 调用形态先例：dsh-session-title-llm 就是一次「无工具一次性 LLM 调用」——`llm.stream({provider, model, messages, system, maxTokens, sessionId, purpose, signal})` 异步迭代 → `BlockAssembler` 聚合 → finish 终止检查 → 拒绝 tool-call 块、只取 text。
- `llm.stream` 的 options **没有 tools 字段**——omp 式 respond-tool 强约束在此面不存在。

## Goals / Non-Goals

**Goals**
1. 恢复 A.1 不变式：直调面 ≡ REPL 面 ≡ 目录面，单一来源 = registry。
2. write/edit 闭环反馈（diagnostics + format）。
3. cell 内零 spawn 的 LLM 调用。

**Non-Goals**
- `llm_completion` 的 schema 化输出（延后，见 Open Questions）。
- 成本预算系统、模型分级路由（omp 的 smol/slow 在 dsh 无对应面，不仿）。
- 桥行为变更——本 change 只改工具的**注册形态**，不改任何桥的参数面与语义。

## D1 — 三桥注册为真工具

- 注册位：`runtimeCtx.tools.register`，与 `eval` 同一宿主位（inject 回调内，早于 session-start）。
- 实现重构：桥 callable 从闭包捕获 cell `exec` 改为 `(args, exec, deps)` 纯函数；注册工具的 execute 每次派发拿自己的 `ToolRunContext`（signal/agent 同形）。
- **output.schema 是唯一新声明**：成功 shape ∪ `{error}` 的 union（`anyOf`），或宽松 object——取 union，wire 面类型提示值得。
- 参数 schema：桥自校验（`rejectUnknownKeys` 等）保留在 execute 内；`parameters` 用 SchemaMaster 平铺字段声明（`meta`/`args` 用 `type: 'json'`）。
- 退役：`AGENT_BRIDGE_SCHEMAS`、`createAgentBridgeBindings`、`createRunCellTool` 内的桥绑定注入。目录渲染回到单源 `collectSdkSchemas`。
- 白捡收益：REPL 桥调用改走 dispatch 管道——获得与其他工具一致的 code-dispatch 审计与 presentation 渲染（现状 cell 闭包直调绕过审计）。
- 验收：`registry.schemas(scope)` 与 cell 绑定集逐名相等；例外白名单 = `EVAL_NAME`（机制现成，collectSdkSchemas:845）。
- 回滚 = 反操作（撤 register、恢复手写 schema 路径）。

## D2 — lsp 接线进 write/edit

- 落点：url-schema 的 write wrapper（v0.1.9-a 无 edit wrapper——DASHR 面只有 read/write/grep/glob 四件，edit 仍是裸 native；edit 接线前移入 Open Questions）。
- 钩子形态：`preWriteFormat`（写前一次性格式化——单次 write-intent 审计，before/after 保真）+ `postWrite`（写后诊断摘要附加）。两个钩子带 EXACT content 走设备（lsp-client 新增 `syncFileContent`：didOpen/didChange 全量，杜绝 stale didOpen 的旧内容诊断——正确性关键点）。
- 行为：目标文件的语言有 language server 在位 → write/edit 返回值附 diagnostics 摘要（error/warning 计数 + 首条明细）+ format-on-write（有 formatter 时）。
- 语言判定按扩展名映射 lsp 设备的 server 能力面；无 server 的语言零行为变化（钩子跳过）。
- 诊断拉取走既有 `xd://lsp` 设备通道（surface-and-devices 已落地的四件之一），不新建服务。

## D3 — `llm_completion` 新工具

**命名决策**：`llm_completion` 而非 `agent_completion`——delegation 家族（`agent`/`agent_message`/`agent_workflow`）的语义轴是「经 agent 平台的动作」（spawn、寻址、编排 agent 实体）；completion 不创建不寻址任何 agent，无工具无历史无会话，操作对象是 LLM 调用本身。错误的家族归属比前缀统一更贵。

**语义**（与 omp `completion()` 对齐，oneshot stateless）：
- 参数：`{prompt, system?, maxTokens?}`。
- 实现：`ctx.get('llm')` → `createUserMessage` → `llm.stream` 迭代 → `BlockAssembler` → finish 检查（非 stop 报错；出现 tool-call 块报错——裸调用不该产生）→ 拼接 text 返回。
- **路由**：继承 calling agent 的 `ModelSelection`（agent-scoped，judge 用同级模型才有意义）；agent 不可得时回落 dsh-agent-default-model settings。
- 审计：`purpose: 'completion'`、`sessionId` 归属 calling agent 的 session；护栏 = maxTokens 默认上限。
- 结构化错误为返回值不抛异常，与三桥一致。
- 注册形态：**出生即真工具**（D1 模式），不经历桥阶段——它就是 D1 的活体验收用例。

**对 A.1 表述的微调**（本 change 确立）：「DASHR 的新工具 = 包装原生定义（**工具或服务**）的真工具」——`llm_completion` 包装 native 服务 `ctx.llm`；`eval` 先例已允许 DASHR 构建传输工具，此句把服务面正式纳入。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 目录断言迁移（手写 schema 渲染 → registry 渲染，签名顺序变） | presentation/surface spec 断言同步改；vitest 全量守门 |
| output.schema union 声明质量 | D1 定 union 形态；不准确时降级宽松 object，行为不受影响 |
| format-on-write 意外重排用户手写代码 | format 仅在 server 声明 formatter 能力时启用；诊断摘要只读不改 |
| completion 滥用（无预算） | purpose 审计 + maxTokens 上限；个人部署面接受 |

## Open Questions

1. **schema 化输出两案**（defer，等真实用例逼出强约束再选）：a) prompt 尾注 JSON Schema + 严格解析 + 一次重试（零依赖，约束弱一档）；b) 复用 subagent respond-tool 机制（强约束但即 spawn，语义不再是 completion）。
2. **edit 工具的 lsp 接线**：需要先给 DASHR 建 edit wrapper（old_string/new_string 语义 + native 委托 + URL 面），再挂同一对钩子。
3. package-lock 同步、cross-platform pi-natives 平台包登记（继承自 surface-and-devices 的 deferred 项）。

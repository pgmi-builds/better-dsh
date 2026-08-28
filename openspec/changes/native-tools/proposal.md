## Why

v0.1.8f 五轮实测坐实了两个结构欠账和一个能力缺口：

1. **表面不变式被三桥违反**。「运行时直调面 ≡ REPL `tool.*` 面 ≡ 目录声明面」对 URL wrapper 成立（真工具注册 + D3 自动桥接单源投影），但 `agent`/`agent_message`/`agent_workflow` 是 cell 内闭包绑定 + 手写 `AGENT_BRIDGE_SCHEMAS` 喂目录——模型在 wire 上直调不到，目录声明与运行时校验双源平行维护，payload 形调用（长 prompt spawn、多行 workflow script）还要过一层 cell 字符串转义。
2. **lsp 设备只有 discoverable，没有 wired**。`xd://lsp` 接线已完成设备面，但 write/edit 后零反馈：写完不知道有没有引入诊断错误。这是当前表面唯一还清零的反馈环。
3. **cell 内无零 spawn 的 LLM 调用**。judge/extraction/handoff 压缩目前只能 spawn 子代理（重）或外置（断环）。

## What Changes

Release **0.1.9-a**，三件事共享一个不变式验收：

1. **三桥退役为真工具**（tool-surface）：`tools.register` 与 `eval` 同宿主位，execute 直调现有桥实现（`(args, exec, deps)` 纯函数化）；REPL 侧经 D3 自动桥接自然拾取；`AGENT_BRIDGE_SCHEMAS` 与 `createAgentBridgeBindings` 的手写绑定路径退役。验收：`registry.schemas(scope)` 与 cell 绑定集逐名相等（例外仅 `eval` 自身——`collectSdkSchemas` 已有该 continue）。
2. **lsp 接线进 write/edit**（dvc）：url-schema 的 write/edit wrapper 加 post-write 钩子——目标语言有 language server 时自动拉 diagnostics 附进结果 + format-on-write。edit 完立即知道写对了没有。
3. **`llm_completion` 新工具**（tool-surface 首个增量消费者）：one-shot、无工具、无历史、非 agent。绑定 `ctx.llm` 服务（host plane，无 realm 隔离坑），v1 纯文本——**schema 化输出明确延后**（design 记录两案与触发条件）。

不新增：桥改名、mask 名单变更、成本预算系统（purpose='completion' 进 session 审计 + maxTokens 上限即护栏）。

## Capabilities

### New Capabilities

无全新 capability。

### Modified Capabilities

- `tool-surface`：三桥从 cell-only 绑定改为真工具注册（不变式恢复 + 手写 schema 路径退役）；`llm_completion` 作为新模式下首个原生工具加入。
- `dvc`：lsp 从 discoverable 设备升级为 wired into write/edit（post-write diagnostics + format-on-write）。

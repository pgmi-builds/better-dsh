# Design — hashline-edit (0.2.0-b)

## Context

vendored 树（`vendored/hashline/`，dsh-better-edit 的源）自 v0.1.8c 起就在仓库里，其 `index.js` 是为独立 cordis 插件写的（bundle mount 形态）。DASHR 的接线不走独立插件：照其 `installAgentTools` 的模式，在 DASHR 自己的 per-agent 装配（`url-schema/index.ts` 的 `installAgentTools`，与 read/write wrapper 同一 own-layer）直接调用注册函数。

## D1 — 编辑家族接线

- `installAgentTools` 内新增（read/write/grep/glob wrapper 之后）：
  - `registerEditTool(rootCtx, agent.ctx, io, sandbox)` — hash 锚定 edit，own-layer shadow 宿主原生 `edit`（nearest layer wins，无需动 mask 名单）
  - `registerUndoTool(rootCtx, agent.ctx, io, sandbox)` — `undo_last_edit`
  - `registerWriteHook(rootCtx, agent.ctx, io)` — `tools/post-execute` 监听，write 成功后追加 fresh hashline preview
  - `io = ctxFsIO(rootCtx.fs, rootCtx)`、`sandbox = new FsSandboxController(rootCtx)`（与 hashline index.js 的构造一致；`fs` 为 host-plane 服务）
- **guidance**：移植 index.js 的 sections 挂载——`agentPresets` 服务在位走 `composeSections(presetId, configDir())`，失败/缺服务降级 `compiledDefaultSections()`；sections 挂 agent own layer 的 systemPrompt（shadow preset 内建 tool guidance，同名同层胜出）。

## D2 — lsp 反馈环挂 edit

- hashline edit 的落盘走自己的 fs-write（不经 DASHR 的 write wrapper）——反馈环不能挂在 write wrapper 上等它。
- 落点：hashline `fs-write.js` 的 IO seam 层（`fsBridge` 写路径）？侵入 vendored 内部过深。**改在 DASHR 装配层**：包一层 `io`（`ctxFsIO` 返回的对象包一层 write 方法？）——查 fs-bridge 的 IO 接口形态后定（若 io.writeFile(path, content) 存在，包装它：pre-format → 写 → 异步 post-diagnostics 无法附结果——**edit 的结果形态是 hashline 自己的 edit-response**）。
- **降级决策（若包装不可行）**：edit 的 lsp 反馈 v1 不做结果附加，靠 write-hook 同款 `tools/post-execute` listener 给 edit 成功结果追加诊断摘要（与 hashline 的 write preview hook 同机制、同层共存）——该路径对所有落盘工具统一，不再逐 wrapper 挂钩。**以此为主方案**：一个 DASHR 自己的 post-execute 诊断 hook（edit/write 都覆盖），write wrapper 内的既有钩子保留（数据一致性，避免双跑——见 D3）。

## D3 — 钩子去重

write wrapper 已有 pre-format + post-diagnostics（per-call）。若 D2 的 post-execute hook 也对 write 跑诊断 → 双拉。取舍：
- **write 走 wrapper 钩子（现状，含 format）；edit 走 post-execute hook（仅诊断）**——post-execute hook 跳过 `write` 名（wrapper 已管），只处理 `edit`。format-on-edit 依赖 hashline 的预览语义，v1 不做（edit 本身就是精确替换，format 价值低于 write）。

## D4 — housekeeping（执行记录）

- **pi-natives**：核对发现**已登记**（package.json optionalDependencies 四平台包 `@oh-my-pi/pi-natives-{linux,darwin}-{x64,arm64}@18.0.6`，linux-x64 实际在位）——历史某轮已顺手完成，design 欠账记录未同步，本轮更正。
- **package-lock**：完整 re-resolve（`npm install --package-lock-only`）三次尝试（默认 300s / prefer-offline 540s / 纯 offline 90s）全部卡死——本环境对 npm registry 深层解析不通。**降级执行**：lock 身份字段（name/version）对齐当前 package.json，依赖树保留既有声明性快照。完整同步记为 Open Question（网络可用时跑一次）。

## Open Questions

1. package-lock 完整 re-resolve（registry 可达时执行 `npm install --package-lock-only`）。

## Non-Goals

- tool-batch-edit（vendored 有但 dsh-better-edit 原版也未注册——跟随上游形态，不擅自加面）。
- edit 的 format-on-edit（见 D3）。
- 独立 dsh-better-edit 插件的 bundle 挂载（接线走 DASHR 内部，一份数据源）。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| own-layer edit shadow 与 preset 内建 edit 的 guidance 冲突 | hashline guidance sections 同层同名 shadow（其设计原意）；实测校验 |
| write preview hook 与 lsp 诊断附加的 content 形态叠加 | 两者追加不同结构（preview block vs 诊断行）；测试覆盖叠加态 |
| post-execute hook 的 exec.arguments 路径解析（edit 参数形态） | 读 hashline tool-edit 的参数面后适配；路径不在则跳过（静默，同 serverless 语义） |

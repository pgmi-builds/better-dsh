## Why

**v0.1.8c（commit `074b6ae`）规划的主特性只落地了一半，另一半在仓库里躺了三个版本**：pi-hashline-edit-lsz 的 dsh 移植整树已 vendored（`src/url-schema/vendored/hashline/`，45+ 模块：edit-engine/edit-pipeline/edit-diff/tool-edit/tool-undo/tool-batch-edit/write-hook/guidance 全套），但只有 read 被接线（DASHR 的 read wrapper 复用其 read pipeline）；**hashline 编辑家族从未注册**——模型的 edit 还是宿主原生的 old_string/new_string 形态，没有 hash 锚定、没有 drift 校验、没有 undo、没有写后 preview。profile 的 bundles 也不含 dsh-better-edit（该插件以独立包形态存在但未挂载）。

同时清两笔工程卫生欠账（用户已确认）：package-lock 与手动落盘的依赖树脱节；pi-natives 平台专属包未在 package.json 登记。

## What Changes

Release **0.2.0-b**（git tag `v0.2.0b`）：

1. **hashline 编辑家族接线**（url-schema）：DASHR 的 per-agent 装配（own-layer 模式，与 read/write wrapper 同层）注册：
   - `edit`（tool-edit.js：hash 锚定编辑，shadow 宿主原生 edit——nearest layer wins，无需 mask）
   - `undo_last_edit`（tool-undo.js：回退最近一次 hashline edit）
   - write hook（write-hook.js：write 成功后追加 fresh hashline preview——与既有 lsp 反馈环共存，互不触碰对方字段）
   - guidance sections（compiled defaults fast path；agentPresets 服务在位时走 per-preset 覆盖，解析失败降级 compiled）
2. **lsp 反馈环挂上 hashline edit**（dvc）：edit 与 write 同为落盘操作——pre-format + post-diagnostics 同一对钩子。
3. **housekeeping**：`npm install --package-lock-only` 同步 lock（不动 node_modules，维持手动落盘流程）；pi-natives 平台包登记进 optionalDependencies。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tool-surface`：绑定/注册面新增 hashline `edit` / `undo_last_edit`（own-layer shadow 语义）。
- `dvc`：lsp 反馈环覆盖 edit（与 write 同一契约：EXACT content 同步、didSave 新鲜度、超时降级、span 校验）。

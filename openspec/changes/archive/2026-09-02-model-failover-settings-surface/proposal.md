## Why

alpha.5 本地实测（`docs/upstream-dsh-0.1.2-alpha.5-local-test-report.md` §4 P1）：4999 测试实例的 Settings > General 页面看不到 Model Failover。但源码侧两端均已存在——host 侧 `dashr/src/index.ts` 已 `installFailover(ctx)`（root-context per-turn 瀑布 failover），client 侧 `dashr/src/failover/client/FailoverRow.tsx` 已把双模型选择器行注册进 `settings.general.item` slot。测试实例看不到的直接原因是：**monorepo 测试路径从未构建 client 卡片半边（`build-client`，AGENTS.md「已验证/未验证」❓ 项）**，而非 alpha.5 回归。

本 change 收口两件事：让源码级测试路径（Dev/Test 1）能渲染 dashr 的客户端卡；并在 alpha.5 对齐态上端到端验证 Model Failover 的 Settings 呈现与实际 failover 行为，把「想加的特色」钉成「已验证的特色」。

## What Changes

- **测试路径补 client 半边**：让 `build-client` 在 monorepo 副本内可跑（处理副本缺 `../docs` 等 prebuild 限制），并入 Dev/Test 1 回归循环（S7 冒烟清单加"dashr 客户端卡渲染"项）。
- **alpha.5 端到端验证**：Settings > General 出现 FailoverRow（双模型选择器）、配置持久化、主模型失败时按行配置瀑布切换（host 侧行为回归）。
- **缺口修复**：验证中发现的真缺口（如 alpha.5 的 settings slot 契约变化导致的适配需求）在本 change 内修。

## Capabilities

### New Capabilities

- `model-failover`: Model Failover 的设置面呈现与行为契约（General 页 failover 行 + host 侧 per-turn 瀑布）。

### Modified Capabilities

（无）

## Impact

- **代码**：`dashr/scripts/build-client.ts`（monorepo 可跑性）、`dashr/src/failover/client/*`（仅当发现 alpha.5 slot 契约偏移时适配）。
- **流程**：AGENTS.md Dev/Test 1「已验证/未验证」节的 ❓ 项转 ✅；`.agents/skills/upstream-alignment/SKILL.md` S7 加客户端卡冒烟项。
- **测试**：4999 实例端到端（UI 渲染 + 行为）；既有 failover 单测保持绿。

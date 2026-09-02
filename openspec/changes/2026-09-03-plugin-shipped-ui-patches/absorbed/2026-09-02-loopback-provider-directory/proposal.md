## Why

alpha.5 本地实测（实测报告 §4 P2）：Settings > Models 显示 "loading the provider directory failed"，模型清单不出——**user 私人的 loopback auth patch 失效**。该 patch 不在 `dashr/src` 内（grep 无落点，维护位置待审计），其触点在 alpha.3 → alpha.5 间随上游 provider directory / 模型清单相关代码改动而漂移（alpha.4 为 8.5k commit 大改）。

> **部署边界（user 裁决 2026-09-02）**：本 patch 为 user 特别为自己加的本地增强，**不随 dashr 发布默认启用**；产出物是可重放的本地 patch + 维护文档，随上游对齐轮重适配。

## What Changes

- **审计定位**：找到 loopback auth patch 的现维护位置（本机 prod 部署位 / 独立 overlay / 其他工作区），还原其 alpha.3 态的触点与意图。
- **漂移分析**：diff 上游 alpha.3→alpha.5 中 patch 触点相关代码（provider directory 加载链路），定位失效机理。
- **重适配**：在新触点上重做 patch（优先配置面/扩展点，其次本地 overlay；避免直接改 vendored 产物导致升级即丢）。
- **可维护性**：patch 位置、触点、重放步骤落文档，纳入 upstream-alignment 技能的 S7 检查项，下次对齐不再无迹可循。

## Capabilities

### New Capabilities

- `provider-directory`（user-scope）：Models 页 provider directory 在 loopback 认证形态下的加载契约。

### Modified Capabilities

（无）

## Impact

- **代码**：patch 落点待任务 1 定位（预期不在 dashr ship 面；若复用 dashr 的扩展点则进 `dashr/src` 并以配置门控、默认关闭）。
- **验证**：prod 与 4999 双实例 Settings > Models 清单加载成功。
- **文档**：patch 维护说明（触点表 + 重放命令）。

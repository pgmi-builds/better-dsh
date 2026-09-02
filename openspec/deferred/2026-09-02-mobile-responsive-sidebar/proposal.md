## Why

alpha.5 本地实测（实测报告 §4 P3）：移动端模式下右侧栏未隐藏（宽度不为 0），手指左右滑动交互失效——**user 私人的 mobile responsiveness patch 失效**。失效有明确的机理背景：上游 alpha.3→alpha.5 把布局反应性从「JS 读 DOM 几何写样式」大规模迁移到「语义属性 + 静态 CSS」（container query / `:has()` / 预设档位，调研报告专题一），原 patch 若挂在 JS 侧布局逻辑上，其挂点已被上游删除。

> **部署边界（user 裁决 2026-09-02）**：本 patch 为 user 特别为自己加的本地增强，**不随 dashr 发布默认启用**。

## What Changes

- **审计定位**：找到 mobile patch 的现维护位置与原实现路线（JS 挂点 / CSS 覆盖 / 别的层）。
- **CSS 路线重做**：对齐上游新范式——用 media/container query + 语义属性（或上游侧栏已有的响应式机制扩展点）实现「移动端右侧栏隐藏（宽度 0）」，恢复滑动交互。
- **滑动手势加速率判定（2026-09-03 user 补充）**：现判定只看起点与滑动距离，慢速的「按住拖选文本」被误判为滑动。补上速率门槛：真实滑动有速率，与轻按选定文字的慢速动作不同——起点 + 距离 + 速率三条件齐全才算滑动。
- **可维护性**：与 loopback patch 同样落触点文档、进 upstream-alignment S7 查表。

## Capabilities

### New Capabilities

- `mobile-layout`（user-scope）：窄视口下侧栏隐藏与滑动手势恢复的契约。

### Modified Capabilities

（无）

## Impact

- **代码**：patch 落点待任务 1 定位（预期为 user 级 CSS overlay 或 dashr client 配置门控面）。
- **验证**：移动端视口实测（浏览器 devtools 移动模拟 + 真机）。
- **文档**：patch 维护说明。

## Why

iOS Safari 上 DSH Web UI 的第一个 breaking point：任何 focus（用户点击或 JS 自动定位到 input/checkbox/select/contenteditable）都把页面从 100% 瞬间放大到约 115–120%，渲染内容溢出屏幕。研究（`docs/60_exploration-and-research/dsh-mobile-spa-ios-input-experience-research.md` v2）已定案机制：iOS Safari 对 computed font-size < 16px 的可聚焦控件自动放大，DSH 全线输入面 13–14px（composer 默认 14px、原生 select 13px），viewport 无 maximum-scale —— 必然触发。实测对照：TypingMind 手机端刻意维持 16px（390px 视口实测 16px / 桌面 14px）。

**user 2026-09-03 裁决**：放大防护选方案 B（JS 改写 viewport meta 追加 `user-scalable=no` / `maximum-scale=1`）先行观察行为 —— 零视觉扰动（UI 放大缩小全由 UI 自己实现），且 Discourse PR #30877 实证该手法在 iOS 10+ 只杀 focus 自动放大、并不禁双指缩放。方案 A（字号地板 16px）保留为后续可选。同轮裁决：左栏挤压（原 D4）no-go；键盘遮蔽问题按"先修放大、真机观察是否自愈"推进（user 主用法是 Add to Home Screen 的 PWA 模式，放大在 PWA 态同样发生，且放大态会破坏 standalone 引擎的键盘避让几何 —— 有相当概率放大压制后键盘遮蔽随之缓解）。

## What Changes

- **boot script 早期改写 viewport meta**（方案 B）：better-dsh host 半现有的 `webserver/index-inject` 内联 head 脚本（`src/web-trust.ts`，早于一切 application bundle）增量：在 iOS 系浏览器 + 窄视口（沿用 `mobile.breakpoint`）双门控下，把页面 viewport meta 追加改写为含 `maximum-scale=1, user-scalable=no`；跨断口（旋转/分屏）时重评估改写或还原；meta 缺失时自建；改写幂等。
- **配置面**：`mobile.zoomGuard`（`'meta'`（默认）| `'off'`）进 dashr 行 schema，并透传到 boot script 的 `__DASHR_MOBILE__` payload；`'font'`（方案 A）值位预留、本 change 不实现。
- **真机观察实验**（关键交付，非代码）：user 真机 iOS **PWA standalone 模式**验证 ①focus 不再放大；②键盘弹出后 composer 是否被引擎原生 resize（standalone 态 innerHeight/100dvh 随键盘收缩）抬到键盘上方 —— 即键盘遮蔽是否随放大压制而自愈；③键盘关闭后 viewport 是否正常回弹（对照 dev.to 记录的 iOS 17/18 standalone 卡死 bug）。观察结论决定是否立 follow-up change（visualViewport shim / display-flip 自愈）。
- **非目标（Non-goals）**：键盘 shim（M2/M2b）、focus gate（移动端切会话自动聚焦去留，待观察后讨论）、字号地板 A（`zoomGuard:'font'` 预留）、侧栏切会话自动收起（D4 no-go）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `mobile-layout`：ADDED Requirement「iOS focus 自动放大抑制（narrow viewport）」—— viewport meta 早期改写的门控、幂等、断口重评估与配置语义。（注：`mobile-layout` capability 由未归档的 `2026-09-03-plugin-shipped-ui-patches` 首创，主 specs 尚无该目录；本 delta 在归档时与其合成。）

## Impact

- **代码**：`dashr/src/web-trust.ts`（boot script 增量：iOS 判定 + 断口判定 + meta 改写 + resize 重评估）、config schema（`mobile.zoomGuard`）、`__DASHR_MOBILE__` payload 扩键；client 半零改动（纯 host 半）。
- **验证**：vitest 单测（iOS UA 判定矩阵 × 断口 × config；改写幂等；还原语义；payload 合成）；4999 实例（boot script 注入形状 + CDP 视口模拟矩阵 + dump-config）；user 真机 iOS PWA 观察清单（放大抑制 + 键盘自愈判定 + 回弹）。
- **文档**：研究文档回填观察结论；`docs/50_test-reports/` 实测报告；AGENTS.md ✅ 条目；upstream-alignment S7 查表（index.html viewport 行形状）。
- **风险**：a11y 张力（maximum-scale 历史上与 WCAG 1.4.4 冲突 —— 缓解：iOS 10+ 双指缩放保留、`'off'` 逃生门、门控仅 iOS+窄屏）；iOS viewport meta 行为为引擎经验行为非规范承诺 → 真机矩阵为准；上游 index.html meta 演进（对齐轮查表项）。

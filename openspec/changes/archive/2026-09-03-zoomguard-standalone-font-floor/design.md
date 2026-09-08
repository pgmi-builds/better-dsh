## Context

v0.2.4（change `2026-09-03-ios-focus-zoom-suppression`）已实现浏览器态 meta 改写并在 4999 全矩阵验证；user 真机首批观察（2026-09-03）发现 standalone PWA 态引擎**尊重** `user-scalable=no` → pinch 失效，需按 display-mode 分流（proposal Why）。实现基座：`dashr/src/mobile/zoom-guard.ts` 的 `buildZoomGuardSection()`（ES5/零依赖/toString 嵌入约束不变）+ 既有 stub-DOM eval 测试基建。

## Goals / Non-Goals

**Goals:**
- boot script 启动时一次性判定 standalone（MQ `(display-mode: standalone)` 为主源，`navigator.standalone===true` 兜底）；standalone → 零 meta 机器 + 注入 font-floor style；browser → v0.2.4 行为原样。
- 判定与 CSS 生成为纯函数可单测；浏览器态全矩阵零回归。

**Non-Goals:**
- 不改 `zoomGuard` enum（'meta' 语义升级为自动双形态，'off' 不变）；不做 'font' 全局值（预留位维持）。
- 不处理键盘遮蔽（独立 follow-up，待 user 观察结论）。

## Decisions

**D1 — 分流点在 zoomGuard 段入口（iOS 判定之后、meta 机器之前）。** standalone 判定一次性、启动期完成（display-mode 不会运行期翻转）；standalone 分支 return 前只做 style 注入，保证"零监听零 timer"的字面成立（spec Scenario 要求）。

**D2 — style 注入与属性。** `document.createElement('style')`，`id="ios-zoom-font-floor"`，`data-plugin="better-dsh"` + `data-plugin-css="better-dsh/zoom-font-floor"`（与 mobile CSS tag 同款认领属性，claimStyles 语义友好）；textContent = `buildFontFloorCss(bp)` 纯函数生成；注入 `headEl()`（复用现有 helper 的等价内联）。boot script 期 head 已在场（v0.2.4 provisional 路径已证）。

**D3 — CSS 形状（user 裁决原文 + 断口参数化）。** `@media (max-width:{bp-0.02}px){ input,textarea,select,[contenteditable="true"]{ font-size:16px !important } }`。`!important` 压 CSS module 的 13/14px 与 body inline var 链；`[contenteditable="true"]` 只匹配 editable 态（React 渲染 `contentEditable={bool}` → 属性值为 "true"/"false"）。

**D4 — standalone 判定纯函数双源。** `isStandaloneDisplay(mqMatchesStandalone, navStandalone) = mqMatchesStandalone === true || navStandalone === true`；MQ 不可用时（老引擎无 matchMedia？v0.2.4 已守卫）退 navigator 单源。

**D5 — 测试策略。** 既有 eval 基建加 `displayMode`/`navStandalone` stub 参数：standalone 矩阵（style 在场/meta 零触碰/无 setTimeout/addEventListener/MutationObserver 痕迹）+ browser 回归全矩阵 + 双源判定单测 + off 双零。CSS 文本断言钉住 selector/`!important`/断口派生（900→899.98）。

## Risks / Trade-offs

- **视觉变化**：standalone 窄屏输入面 13/14→16px —— user 已裁决接受（pinch 优先）。
- **display-mode 判定漏检**（未来引擎怪异）：漏检 = standalone 走 browser 分支 = 现状（pinch 失效但不比 v0.2.4 差）；误检 = browser 态走 font floor = 多了字号地板、pinch 不受影响 —— 两向退化均 benign。
- **`[contenteditable="true"]` 与上游 DOM 演进**：上游若改 contenteditable 用法 → floor 漏 composer → 真机观察暴露；S7 查表已有 composer 锚点项。

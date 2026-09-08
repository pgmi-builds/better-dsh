## Why

真机观察（user iOS 设备，2026-09-03，tasks 3.1 首批结论）修正了 v0.2.4 的一个引擎行为假设：

- **浏览器内 Safari**：zoomGuard meta 改写 ✅ 放大被抑制，✅ 双指缩放仍可用（iOS 10+ 浏览器态忽略 `user-scalable=no` 对 pinch 的约束 —— Discourse 先例成立）。
- **Add to Home Screen PWA standalone 态**：✅ 放大被抑制，❌ **双指缩放失效** —— standalone 态引擎**尊重** `user-scalable=no`（Discourse 注释未覆盖此形态；真机数据推翻 spec v1 的 "pinch remains engine-controlled" 括号在 standalone 的普适性）。

user 主用法即 PWA standalone，pinch 不可牺牲。user 裁决方案：**standalone 态完全不碰 viewport meta（pinch 恢复），改注入 16px 字号地板 CSS 杀 focus 自动放大**（方案 A 的作用域化：`input,textarea,select,[contenteditable="true"]{font-size:16px !important}` @ 窄视口）——即浏览器态走 B（meta，零视觉扰动）、standalone 态走 A（font floor，pinch 完整），两形态各取所长。

## What Changes

- boot script zoomGuard 段增 **standalone 分支**：启动时一次性判定 `(display-mode: standalone)` MQ 或 `navigator.standalone===true`；standalone 时**跳过全部 meta 机器**（无 provisional/无 reconcile/无梯子/无监听），改为注入 `<style id="ios-zoom-font-floor" data-plugin="better-dsh" data-plugin-css="better-dsh/zoom-font-floor">` —— `@media (max-width:{breakpoint-0.02}px){ input,textarea,select,[contenteditable="true"]{ font-size:16px !important } }`（断点复用 `mobile.breakpoint`）。
- 浏览器态行为不变（v0.2.4 全套：meta 改写 + 梯子 + 双通道复评）。
- `mobile.zoomGuard` 配置面语义更新：`'meta'`（默认）= 浏览器态 meta 改写 + standalone 态 font floor（自动双形态）；`'off'` = 两形态都完全不发射。enum 不动（无破坏面）。
- 修正 spec 文字：pinch 保留的表述按真机数据分形态陈述。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `mobile-layout`：MODIFIED Requirement「iOS focus auto-zoom suppression on narrow viewports」—— 按 display-mode 分裂为双形态行为（browser: meta rewrite；standalone: font-floor CSS，meta 零触碰）；新增 standalone 场景（pinch 不受影响 + 字号地板在场）；原 7 场景中受影响的表述更新。

## Impact

- **代码**：`dashr/src/mobile/zoom-guard.ts`（standalone 判定 + style 注入段；纯函数增 `isStandaloneDisplay(mq, navStandalone)` 与 `buildFontFloorCss(bp)`）、`dashr/test/zoom-guard.spec.ts`（standalone 矩阵）；`web-trust.ts` 零改动（同一 boot script 段内分流）。
- **验证**：vitest 增 standalone 矩阵（standalone → 无 meta 机器痕迹 + style 在场；browser → 现行全矩阵不回归；off → 双零；display-mode 判定的 MQ/navigator.standalone 双源）；4999 CDP 用 `Emulation.setEmulatedMedia(features:[{name:'display-mode',value:'standalone'}])` 实证双形态分流；真机 PWA 复验（pinch 恢复 + 无放大）。
- **风险**：standalone 判定双源（MQ 为主、`navigator.standalone` 兜底 —— 老 iOS 仅暴露后者）；字号地板的视觉变化仅 standalone 窄屏（user 已裁决接受）；`[contenteditable="true"]` 精确匹配 editable 态（composer 非编辑态不放大目标，focus 不可能，无影响）。

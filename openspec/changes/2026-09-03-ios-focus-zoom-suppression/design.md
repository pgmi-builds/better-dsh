## Context

研究 v2（`docs/60_exploration-and-research/dsh-mobile-spa-ios-input-experience-research.md`）已定案：focus 放大 = iOS 对 <16px 可聚焦控件的自动放大；DSH 输入面全线 13–14px；上游 viewport 行 `width=device-width, initial-scale=1`（`apps/web/index.html:5`）无缩放约束。user 主用法为 Add to Home Screen 的 **PWA standalone**，放大在该模式同样发生，且放大态破坏 standalone 引擎的键盘避让几何（键盘遮蔽的可能放大器）。

现有可复用基建：better-dsh host 半 `src/web-trust.ts` 经 `webserver/index-inject` 往页面 head 推内联 boot script（当前职责：trusted hostname → `__DSH_TRANSPORT__`；mobile config → `__DASHR_MOBILE__` payload）—— head 内联、早于一切 application bundle 物化，天然满足"先于任何 focus"的时序要求，无新注入通道需求。client 半 v0.2.1f 已有 mobile 模块（CSS + 手势），本 change **纯 host 半**，client 零改动。

## Goals / Non-Goals

**Goals:**

- iOS + 窄视口双门控下，boot script 早期把 viewport meta 改写为含 `maximum-scale=1, user-scalable=no`，压制 focus 自动放大。
- 门控/改写/重评估逻辑全部纯函数化并可单测；行为由 `mobile.zoomGuard` 配置（`'meta'` 默认 / `'off'` 逃生门；`'font'` 值位预留）。
- 真机 PWA 观察清单落地，产出"键盘遮蔽是否随放大压制自愈"的结论，为 follow-up（shim / display-flip 自愈 / focus gate）提供裁决输入。

**Non-Goals:**

- 键盘 visualViewport shim（M2）与 standalone viewport 卡死自愈（M2b）—— 待真机观察结论。
- focus gate（移动端切会话自动聚焦去留）—— 待讨论，本 change 不动聚焦行为。
- 字号地板（方案 A）—— `zoomGuard:'font'` 预留值位，不实现。
- 侧栏切会话自动收起（D4 no-go）。

## Decisions

**D1 — 载体 = host 半 boot script 增量（非 client 半、非 patch 线）。** 时序是本需求的硬约束（先于 unlock effect 的首次程序化 focus），boot script 是唯一"head 内联 + 早于 bundle"的既有通道；client 半 materialize 太晚，patch 线改上游 index 行则过重且违背"上游行形状演进由对齐轮盯"的既定模式。副作用：boot script 体量 +~15 行，维持现有"无依赖、纯同步"风格。

**D2 — iOS 判定 = UA 嗅探（对齐 Discourse `capabilities.isIOS` 语义），非 pointer:coarse。** Android Chrome 从不 focus-zoom，而 `maximum-scale` 在 Android 有历史副作用 → 门控收紧到 iOS 系（iPhone|iPod|iPad，含 iPadOS 13+ 桌面 UA 冒充：`Macintosh` && `maxTouchPoints>1`）。UA 嗅探的脆弱性由单测矩阵 + 对齐轮兜底（UA 串形变 = 行为退化为"不改写"，benign）。

**D3 — 窄视口判定 = `matchMedia('(max-width: breakpoint-0.02px)')`，断口复用 `mobile.breakpoint`（默认 768）。** 与 client 半手势 CSS 的断口语义一致（`mobileCss()` 已用 `breakpoint-0.02` 防边界抖动）；`resize` 事件仅做 matchMedia 复评（media query 本身去抖边界），进出断口分别执行改写/还原。

**D4 — 改写语义 = token 级合并、幂等、可还原。** 记录 stock content（首次读取），改写 = 在 content 上合并 `maximum-scale=1`、`user-scalable=no` 两 token（已有则覆盖值，无则追加），还原 = 写回 stock content。meta 缺失则 `createElement('meta')` + `name=viewport` 后同路径。幂等性 = 合并算法按 token key 去重，重复评估不叠加。

**D5 — 配置透传 = `__DASHR_MOBILE__` payload 扩键 `zoomGuard`。** 与 `enabled/breakpoint/...` 同路径同生命周期（profile `cordis.patch.yml` better-dsh 行 config → host → boot script JSON.stringify），无新配置通道；schema 面在 dashr 行 config 增 `mobile.zoomGuard` enum。

**D6 — 观察实验 = user 真机 PWA standalone 清单（非代码交付）。** 三个判定项：①focus 各输入点无放大；②键盘弹出后 composer 是否被引擎原生 resize 抬到键盘上方（standalone 态 innerHeight/100dvh 随键盘收缩，DSH 的 `html/body/#root{height:100%}` 链应联动）；③键盘关闭后 viewport 回弹（对照 dev.to 2026-07 记录的 iOS 17/18 standalone 卡死 bug）。②③结论直接决定 follow-up change 的取舍。

## Risks / Trade-offs

- **a11y 张力**：`maximum-scale=1` 历史上与 WCAG 1.4.4（缩放能力）冲突。缓解：iOS 10+ 引擎忽略 `user-scalable=no` 对双指缩放的约束（Discourse 注释实证），pinch 保留；`'off'` 逃生门；门控仅 iOS+窄屏（桌面完全不动）。真机清单含"双指缩放仍可用"验证项。
- **iOS viewport meta 行为非规范承诺**：maximum-scale/user-scalable 语义随 iOS 版本有波动史（旧版禁 pinch、新版不禁）。缓解：真机矩阵按 iOS 版本记录；行为若漂移，退路是切方案 A（`zoomGuard:'font'`，字号地板，行为确定性高）。
- **UA 嗅探脆弱性**：上游/苹果改 UA 形状 → 判定失效 → 退化为现状（不改写、放大复现），benign；对齐轮查表项。
- **改写与上游 meta 演进的耦合**：若上游 index.html 未来自带缩放约束，token 合并语义保持幂等（覆盖同 key），不冲突；S7 查表记录上游行形状。
- **观察实验的开放性**：键盘自愈是概率性结论（依赖 iOS 版本的 standalone 行为与 300523 类引擎 bug 的修复态），不阻塞本 change 验收 —— 本 change 的验收 = 放大抑制 + 门控矩阵；键盘结论只驱动 follow-up 取舍。

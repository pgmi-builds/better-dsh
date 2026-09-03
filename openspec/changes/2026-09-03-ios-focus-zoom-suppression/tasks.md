## 1. 配置面与 payload

- [ ] 1.1 **config schema**：dashr 行 config 的 `mobile` 增 `zoomGuard` 键（enum：`'meta'`（默认）| `'off'`；`'font'` 值位预留并在 schema/文档标注未实现），默认值语义 = 未配置时按 `'meta'` 行为；schema 单测（默认值、非法值 fail-loud）。
- [x] 1.1 **config schema**：dashr 行 config 的 `mobile` 增 `zoomGuard` 键（enum：`'meta'`（默认）| `'off'`；`'font'` 值位预留并在 schema/文档标注未实现），默认值语义 = 未配置时按 `'meta'` 行为；schema 单测（默认值、非法值 fail-loud）。
  - 证据：`src/index.ts` MOBILE_CONFIG 增 `zoomGuard: z.union(['meta','off']).default('meta')`（schemastery 本 fork 无 choice()，union 字面量数组即 enum，'font' 非法值在 config load 即抛 ValidationError = fail-loud，'font' 预留值位以注释标注不进 enum——未实现值静默 no-op 比报错更危险）；单测 `test/zoom-guard.spec.ts` 'config schema' describe：`Config({}).mobile.zoomGuard==='meta'`、`'off'` 透传、null 回落 meta、`'font'`/`'bogus'` toThrow。
- [x] 1.2 **payload 透传**：`src/web-trust.ts` 的 `__DASHR_MOBILE__` payload 合成扩 `zoomGuard` 键；`dsh --dump-config` 快照断言（mobile 行含 zoomGuard）。
  - 证据：payload 条件展开 `...(mobile?.zoomGuard !== undefined ? { zoomGuard: mobile.zoomGuard } : {})`（与 breakpoint 等键同构；schema 默认保证生产 payload 必带）；单测断言 `"zoomGuard":"off"`/`"meta"` 序列化。dump-config（4999 monorepo 副本 + tsdown 后）：`--patch` 覆盖层 `mobile.zoomGuard:'off'` 在 dashr-repl 行逐字渲染（`.scratch/zg-overlay.yml`）——dump-config 只渲染 patch 层不含 schema 默认，schema 默认由单测钉住。
## 2. boot script 增量（核心）

- [ ] 2.1 **判定与改写纯函数**：`isIOSClassUA(ua, maxTouchPoints)`（iPhone|iPod|iPad + iPadOS 桌面冒充 `Macintosh&&maxTouchPoints>1`）、`mergeViewportTokens(content, tokens)`（token 级合并、同 key 覆盖、幂等）、`shouldApplyZoomGuard(config, isIOS, isNarrow)`；vitest 单测矩阵（UA × 视口 × config 三维；幂等重复评估；还原写回 stock；meta 缺失自建路径）。
- [x] 2.1 **判定与改写纯函数**：`isIOSClassUA(ua, maxTouchPoints)`（iPhone|iPod|iPad + iPadOS 桌面冒充 `Macintosh&&maxTouchPoints>1`）、`mergeViewportTokens(content, tokens)`（token 级合并、同 key 覆盖、幂等）、`shouldApplyZoomGuard(config, isIOS, isNarrow)`；vitest 单测矩阵（UA × 视口 × config 三维；幂等重复评估；还原写回 stock；meta 缺失自建路径）。
  - 证据：`src/mobile/zoom-guard.ts` 三个纯函数（ES5 自包含，经 Function.prototype.toString 嵌入 boot script = 单测源即发布源）；`test/zoom-guard.spec.ts`：UA 矩阵（iPhone/iPod/iPad/Mac+touch/Mac 单点/Android/桌面 Chrome/Win+touch/空 UA）、merge 矩阵（追加/同 key 覆盖保位/大小写不敏感/空白容差/bare token/值含`=`/空 content/幂等三层）、gate 矩阵；meta 缺失与还原在 eval 矩阵覆盖。
- [x] 2.2 **boot script 接线**：内联脚本增 zoomGuard 段 —— 记录 stock content → 门控判定（iOS && matchMedia(max-width: breakpoint-0.02px) && zoomGuard==='meta'）→ 改写/还原 → `resize` 复评；维持无依赖纯同步风格；注入行形状单测（payload 序列化 + 脚本片段形状）。
  - 证据：`buildZoomGuardSection()`（zoom-guard.ts）生成 ES5 零依赖段；**关键发现**：webserver head 注入 splice 在 `<head>` 开标签后 = stock meta 尚未解析（`packages/host/webserver/src/injections.ts` renderIndexInjections），故正常路径 = 先建 provisional meta（时序要求满足）+ MutationObserver 在 stock meta 解析插入时 reconcile（记录真 stock → 改写 stock → 移除 provisional，单 meta 文档，不依赖引擎 multi-meta 合并语义；无 MutationObserver 引擎降级为 provisional 常驻）；shape 单测（`(max-width:767.98px)` 断点派生、ES5 无箭头无模板串、无 `</script`）+ eval 端到端（stub DOM：provisional/reconcile/还原字节级/resize 风暴幂等/Android 与桌面零副作用/off 逃生门/两腿共存）。构建后产物复核：lib/index.js 抽取三函数源（ES5-ok）重组段 eval 全绿（`.scratch/zg-built-check.ts`）。

## 3. 真机观察实验（user iOS 设备，PWA standalone 主用法）

- [ ] 3.1 **放大抑制判定**：4999/真实入口在 iPhone Safari 与 Add to Home Screen PWA 两种形态下，focus composer / permission select / settings 各 input / 切会话自动聚焦 —— 全部无 115–120% 放大；双指缩放仍可用；`zoomGuard:'off'` 时放大复现（逃生门复验）。
- [ ] 3.2 **键盘遮蔽自愈判定**（观察结论，驱动 follow-up）：PWA 态 unzoomed 下 focus composer —— 键盘弹出后 composer 是否被引擎 resize 抬到键盘上方（`html/body/#root{height:100%}` 链联动 innerHeight 收缩）；键盘关闭后 viewport 是否回弹（对照 dev.to iOS 17/18 standalone 卡死 bug）；浏览器内 Safari 态对照记录。
- [ ] 3.3 **观察结论回填**：研究文档（v2 §6 决策点 3/4）+ 决定是否立 follow-up change（visualViewport shim / display-flip 自愈 / focus gate 讨论输入）。

## 4. 收口

- [x] 4.1 **回归**：vitest 全量（既有基线 + 新增）+ tsc 0 错；`dsh --dump-config` 快照。
  - 证据：canonical 全量 vitest **460/460 通过**（基线 428 + 本 change 新增 32；35→36 files）；`tsc --noEmit` 0 错（含新 spec）；dump-config 快照见 1.2 证据。
- [x] 4.2 **文档**：`docs/50_test-reports/` 实测报告（含真机观察矩阵）；AGENTS.md ✅ 条目 + 第一节 mobile 配置面补 `zoomGuard`；upstream-alignment S7 查表加 index.html viewport 行形状 + boot script 段形状两项。
  - 证据：`docs/50_test-reports/v0.2.4-ios-focus-zoom-suppression实测报告.md`（自测结果已填，真机观察章节留 TODO 给 user）；AGENTS.md 二节已验证列表增 v0.2.4 ✅ 条目（含 zoomGuard 配置面说明——mobile 配置面的文档化位置即该节，第一节无 mobile config 叙述处）；`.agents/skills/upstream-alignment/SKILL.md` S7 增第 8 条（viewport 行形状 + 注入 splice 次序两查点）。
- [x] 4.3 **版本**：package.json 版本号（实现时按当时已发布版顺延 patch）+ 本地 commit/tag；发布与 prod 部署另按年龄门流程，不在本 change 内。
  - 证据：canonical `dashr/package.json` 0.2.2-a → **0.2.4**（npm 已发布线 v0.2.3 顺延一档；0.2.3 为改名重发包，canonical 源仍停在 0.2.2-a）；workspace git（toplevel=/home/u1/workspaces/dashr）本地 commit（message 含 change id `2026-09-03-ios-focus-zoom-suppression`）+ tag **v0.2.4**；未 publish 未 push。

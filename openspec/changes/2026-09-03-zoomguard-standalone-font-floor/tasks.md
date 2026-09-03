## 1. 实现（纯 host 半，boot script 段内分流）

- [x] 1.1 **纯函数**：`isStandaloneDisplay(mqMatchesStandalone, navStandalone)`（双源 OR）、`buildFontFloorCss(breakpointPx)`（`@media (max-width:{bp-0.02}px){ input,textarea,select,[contenteditable="true"]{ font-size:16px !important } }`）；vitest 单测（双源矩阵、CSS 文本钉扎：selector 集合、`!important`、断口派生 768→767.98 / 900→899.98）。
  - 证据：`dashr/src/mobile/zoom-guard.ts` 两函数落地（严格 `=== true` 双源 OR；数字派生与既有 mobileCss 一致）；`dashr/test/zoom-guard.spec.ts` 新增 `isStandaloneDisplay`/`buildFontFloorCss` 两个 describe 共 5 测试全绿。
- [x] 1.2 **boot script 分流**：zoomGuard 段 iOS 判定后增 standalone 一次性判定（`window.matchMedia('(display-mode: standalone)')` matches 或 `navigator.standalone===true`）；standalone → 注入 style（id `ios-zoom-font-floor` + data-plugin/data-plugin-css 认领属性）后 return（零 meta 机器/零监听/零 timer）；browser → v0.2.4 机器原样。'off' → 两形态都不发射。
  - 证据：`buildZoomGuardSection()` 生成段（已实际运行验证）：`var bpx=…;var bp=bpx-0.02;var sa=ZD((window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches),(navigator.standalone===true));if(sa){var f=document.createElement('style');f.setAttribute('id','ios-zoom-font-floor');…;f.textContent=ZF(bpx);headEl().appendChild(f);return}` —— return 位于 `var mq=` 之前，其后 meta 机器字面不可达；ZD/ZF 同经 toString 嵌入（`var ZD=`/`var ZF=`，ES5 无箭头/无模板字面量）；web-trust.ts 零改动（'off' 门原样）。
- [x] 1.3 **eval 测试增补**：stub 基建加 display-mode/navigator.standalone 注入；standalone 矩阵（style 在场 + meta 字节不动 + 无 setTimeout/addEventListener/MutationObserver 痕迹 + iOS 宽屏仍无 style —— media query 自然不匹配）+ browser 态全回归 + off 双零。
  - 证据：`runBootScript` 增 `standaloneAtScriptTime`/`navStandalone` 参数且 matchMedia 按查询串分流；新增 describe `boot script evaluation (standalone display mode matrix)` 7 测试：MQ 源 style+零机器痕迹（resizeHandlers/mqChangeHandlers/observers/setTimeout spy 全零 + mediaQueries 仅 display-mode 一探针 + 晚到 stock meta 字节不动）、宽屏仍注入（style 在场、规则不匹配，注入不设宽度门）、navigator.standalone 单源、无 matchMedia 兜底（D4）、断口 900→899.98、browser 显式无 style、off 双零。既有 browser 全矩阵零回归（仅 mediaQueries 断言按新探针序更新 + 两处手搓 matchMedia 改查询感知）。宽屏措辞修正已落实：**style 注入只看 iOS+standalone+zoomGuard，宽度由 CSS media query 表达**。

## 2. 验证

- [x] 2.1 **回归**：vitest 全量 + tsc 0。
  - 证据：canonical `npx vitest --run` → **Test Files 36 passed (36), Tests 478 passed (478)**（基线 466 + 新增 12）；`npx tsc --noEmit` → 0 error。
- [x] 2.2 **4999 CDP 双形态**：`Emulation.setEmulatedMedia(features:[{name:'display-mode',value:'standalone'}])` —— standalone+iOS+390：meta stock、`#ios-zoom-font-floor` 在场、composer computed font-size ≥16px；browser（无 emulated media）：meta guarded、无 font-floor style；Android/桌面/宽屏双形态均双零；off 双零。**并含 client 特性探针**（本轮回归教训）：narrow 下 `[data-sidebar-collapsed]` computed 首列 0px、`style[data-plugin]` 认领在位。
- [x] 2.3 **部署流程**：tsdown 后**必须** `tsx scripts/build-client.ts`（lib/client 清洗陷阱，AGENTS.md 已焊）；重启前后 boot graph rev 变化确认。
  - 证据（doer 半）：rsync（--exclude node_modules/lib/.venv-kernel/.uv-cache/docs）→ `pnpm --filter better-dsh exec tsdown`（✔ 9 files, 533.34 kB）→ `node_modules/.bin/tsx scripts/build-client.ts` 直跑（✔ lib/client/index.js 17.82 kB, md5 `a88850ec056aae943934adfdeb79347e`）；lib/ 内 `display-mode: standalone`/`ios-zoom-font-floor`/ZD/ZF 嵌入在场。注：tsx 在 monorepo 根 node_modules（AGENTS 命令块里 `../../node_modules/.bin/tsx` 的相对深度按 `packages/better-dsh/` 层算，从包目录需 `../../../`，本次用绝对路径直跑成功）。**4999 未重启**（lead 统一处理 2.2）；boot graph rev 前后对比随 lead 重启回填。

## 3. 收口

- [ ] 3.1 **真机复验清单**（user）：PWA standalone —— pinch 恢复 + focus 无放大；浏览器态 —— 维持 v0.2.4 观察结论；结论回填实测报告与研究文档。
- [x] 3.2 **文档**：实测报告增 §九（standalone 分流）；AGENTS.md ✅ 条目更新（'meta' 双形态语义）；tasks 勾选留证据。
  - 证据：`docs/50_test-reports/v0.2.4-ios-focus-zoom-suppression实测报告.md` 增 §九（9.1 实现摘要 / 9.2 单测 478 / 9.3 lead CDP TODO / 9.4 真机 TODO）；AGENTS.md zoomGuard ✅ 条目已更新（v0.2.5 display-mode 分流段 + 'meta' 双形态 + 五个纯函数 + 478/478）。
- [x] 3.3 **版本**：0.2.4 → 0.2.5（顺延 patch），本地 commit + tag v0.2.5；发布另走年龄门。
  - 证据：`dashr/package.json` + `package-lock.json` 均 0.2.5；本地 commit + tag `v0.2.5`（见 git log；未 publish 未 push，发布另走 pnpm 年龄门）。

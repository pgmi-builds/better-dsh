# 2026-09-13-preact-ui-shell 实测报告

- change: `2026-09-13-preact-ui-shell`（openspec valid）
- 依据: `~/workspaces/superd/apps/ui-preact` PoC（2026-09-09，0.1.3-alpha.2 + superd 伺服路径）
- gates: 测试线 4999，`urlSchemes:true + hashline:false + preact shell build`
- 结论先行: **shell 渲染引擎已换 Preact**（只 preact，无 @preact/signals——user 2026-09-13 裁决），全上游 UI 语料零改动获得 Preact 渲染；shell index chunk **555,959 → 434,173 B（−21.9%）**；浏览器级 A/B 实测挂载面与 stock 完全一致。

## 1. 改动面（全部属 monorepo 本地 patch，不入 upstream git）

| # | 改动 | 说明 |
|---|---|---|
| 1 | `apps/web/vite.config.ts` `resolve.alias` +5 条 | react / react/jsx-runtime / react/jsx-dev-runtime / react-dom / react-dom/client → preact/compat 家族（regex 锚定，防 `react-dom` 先命中 `react`） |
| 2 | 同文件 `resolve.dedupe` + `'preact'` | dedupe 条目从本包 node_modules 解析——**缺它必挂**：seed importer 在 `packages/client/web/lib`，node 向上走看不到 `apps/web/node_modules/preact`（报 `Could not load preact/compat`） |
| 3 | `apps/web/package.json` devDeps + `preact@10.29.8` | 精确 pin 对齐 PoC；仅 devDep，发布面无它 |
| 4 | `vendor/{AGENTS,CLAUDE,README}.md` → `vendor/docs/` | **根除 `vendor/CLAUDE.md` ENOTDIR/exit 236 老坑**（见 §4） |

AGENTS.md §二 harness 本地 patch 已记档（换 tag 需重放）。

## 2. 体积（实测）

| chunk | stock | preact build | Δ |
|---|---|---|---|
| `index-*.js`（react 家族 rides index） | 555,959 B | 434,173 B | **−121,786 B（−21.9%）** |
| `vendor-*.js`（react-free，katex/shiki/markdown 管线） | 740,575 B | 740,575 B | 0（设计内） |

## 3. 浏览器级 A/B 验证（playwright，同脚本双跑）

| 断言 | stock React build | preact build |
|---|---|---|
| UI 语料挂载（侧栏/会话列表/Settings/输入框文本） | ✅ 全 | ✅ 全（逐字一致） |
| `#root button` 数 | 31 | 31 |
| composer（textarea/contenteditable） | 1 | 1 |
| console.error | 0 | 0 |
| shell 内 react-dom 痕迹 | **`version:"18.3.1", rendererPackageName:"react-dom"` banner 在 shell** | **无**（唯一 `react-dom` 字串 = 平台模块种子表键 `{react:Y3, "react-dom":Y3, ...}`——同一个 preact 实例登记两个平台词，设计终态） |
| pageerror | slot 重复注册 ×1 | slot 重复注册 ×1 |

**pageerror 定责（A/B）**：`settings.general.item` slot id `compaction-tuning` 重复注册在 **stock 上同样存在**（factory id `Ba` vs `f5` 仅 minified 差异）→ **存量问题**，属 `.dsh-test` profile 的 compaction-tuning 本地插件，与渲染引擎无关，挂账另修。`better-dsh/client.js` 内的 `react-dom` 匹配为 pnpm 依赖路径字符串（`@tanstack+react-virtual@…_react-dom@18.3.1…`），stock/preact 两面同在，非本体。

**user 未亲自引爆项声明**：深交互面（聊天流式渲染、shiki 高亮、markdown 管线）未逐项人工过——零 console.error 为强信号非穷尽证明（PoC 同款边界声明）。

## 4. 顺带根除：`vendor/CLAUDE.md` ENOTDIR/exit 236 老坑

`vendor/` 根下三个文档文件（AGENTS/CLAUDE/README.md）撞 `pnpm-workspace.yaml` 的 `vendor/*` workspace glob：任何 workspace 枚举器读 `<条目>/package.json`——目录 ENOENT（容忍跳过），**文件 ENOTDIR（炸）**。历史受害面：`npm run build-client`（2026-09-03 记档）、本轮 `npx vite build`（exit 236、裸单行错误）。已移入 `vendor/docs/`（目录无 package.json → ENOENT 跳过）。换 tag 重放时记得同款处理。

**新坑记档**：`pnpm add` 之后 `npx vite` 从根解析到 **vite 8/rolldown**（错误形态完全不同）——web 构建一律走 `pnpm run build:web`（workspace 内 vite 6.4.3）。

## 5. 范围裁决

- **不入 better-dsh npm 发布物**：本 change 是测试线 monorepo 本地 patch。插件若要随发布把 Preact UI 带到 prod，必须附带 preact 前端 dist + web-runtime override 行（PoC 路径 B 已在 0.1.3-alpha.2 验证可行）——代价是 UI 语料冻结在 fork 点，且 prod host（0.1.3-alpha.2）与测试线（0.1.5-rc.2）语料版本错位。**该决定挂 prod host 升级门下，另行裁决。**
- 因此本轮 npm alpha（0.2.3-e）的插件内容不含 Preact——发布内容 = url-schemes 系（skill:// 收口等）+ 本轮清理。

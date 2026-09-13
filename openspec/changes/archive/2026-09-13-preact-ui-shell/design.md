# 2026-09-13-preact-ui-shell — Design

## 背景

user 指示：把渲染引擎换成 Preact 的 UI enhancement 先做，做完再 GitHub push + npm publish（最小 alpha）。PoC 依据 = `~/workspaces/superd/apps/ui-preact`（2026-09-09 一手实测：完整上游语料在 preact/compat 上挂载、零 pageerror/console.error、交互通过——但那是 0.1.3-alpha.2 的 apps/web + superd 伺服）。

## 机制（与 PoC 同一手术位）

React 依赖隔离在两处：① shell 内平台模块种子表（`dsh-client-web` 的 seed 静态实例，烧在 shell bundle 里，无运行时 seam）；② 各 ui-* 插件 bundle 的 `require("react")` 语料（零改动）。唯一手术位 = **重建 shell**：`apps/web/vite.config.ts` 的 `resolve.alias` 加 react 家族 → `preact/compat`（regex 锚定防 `react-dom` 先命中 `react`）。shell 里的种子物化出 preact 实例，运行时 require 字典把 preact 发给所有插件 bundle。

## 改动（monorepo 本地 patch #3，与 tsdown.client.ts REPOSITORY_ROOT patch 同类）

`apps/web/vite.config.ts` `resolve.alias` 数组增加：

```ts
{ find: /^react$/, replacement: 'preact/compat' },
{ find: /^react\/jsx-runtime$/, replacement: 'preact/compat/jsx-runtime' },
{ find: /^react\/jsx-dev-runtime$/, replacement: 'preact/compat/jsx-dev-runtime' },
{ find: /^react-dom$/, replacement: 'preact/compat' },
{ find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
```

保留 `react()` 插件与 `dedupe`（0.1.5-rc.2 shell 无自有 JSX——工作区包按构建产物消费，react() 实际惰性；保留以最小化 diff）。**上游源码零修改之外仅此一处，且属本地 patch，不入 upstream git。**

## 验收（同类原则：改的是渲染引擎，验收 = 活体 UI 真的由 Preact 渲染）

1. `pnpm run build:web` 成功；shell bundle 无 react-dom 痕迹、有 preact 标识。
2. 4999 重启后浏览器级验证：全语料挂载、零 pageerror / 零 console.error、可交互元素在位（playwright，PoC 同款断言思路）。
3. 体积对比实测：stock `index` chunk vs alias 后 `index` chunk（react 家族 rides index），记录差值。
4. 回归：url-schemes 面（FS 层边界错误、https、dsh 选择器）不受影响。

## 范围裁决（本 change 明确不做）

- **不入 better-dsh npm 发布物**。要经插件把 Preact UI 带到 prod，必须 better-dsh 附带 preact 前端 dist + web-runtime override 行（PoC 路径 B 已在 0.1.3-alpha.2 验证可行），但 dist 会把 UI 语料冻结在 fork 点、prod（0.1.3-alpha.2）与测试线（0.1.5-rc.2）语料版本错位——该决定挂在 prod host 升级门下，另行裁决。
- 深交互面（聊天流式渲染、shiki 高亮、markdown 管线）不逐项人工过——零 console.error 为强信号非穷尽证明（PoC 同款边界声明）。

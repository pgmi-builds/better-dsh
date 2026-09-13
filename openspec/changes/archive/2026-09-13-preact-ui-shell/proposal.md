# 2026-09-13-preact-ui-shell — Proposal

## Why

user 指示（2026-09-13）：发布（GitHub push + npm 最小 alpha）前，把「渲染引擎换 Preact」的 UI enhancement 做进测试线。依据 PoC（superd/apps/ui-preact，2026-09-09）：vite alias 把 react 家族解析到 preact/compat、重建 shell，全上游 UI 语料零改动获得 Preact 渲染，体积显著更轻。

## What Changes

- monorepo 本地 patch #3：`apps/web/vite.config.ts` `resolve.alias` 增加 react 家族 → preact/compat 五条（regex 锚定）
- 重建 `build:web`，4999 活体验证（挂载/零 pageerror/交互/体积实测）
- AGENTS.md 本地 patch 清单记档（换 tag 需重放）

## Capabilities

### preact-ui-shell
测试线 web shell 可按 alias 构建 Preact 渲染引擎；发布物（插件包）内容不因本 change 改变——ship-in-plugin 选项挂在 prod host 升级门下另行裁决。

## Impact

- 代码：仅 upstream checkout 的 apps/web/vite.config.ts（本地 patch，不入 upstream git）
- 发布物：better-dsh 包内容不变（url-schemes 工作照常发布）

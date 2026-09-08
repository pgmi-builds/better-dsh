# 上游 dsh 0.1.3-alpha.2 对齐轮本地实测报告（dashr 测试线）

- 实测日期：2026-09-08
- 范围：**仅 dashr（better-dsh 插件）** 自身对齐（omp-web 不在内）；OpenSpec change `openspec/changes/2026-09-08-upstream-0-1-3-alpha-2-alignment/`（G1 S1–S7 + G2 小修，v0.2.3）
- 环境事实：checkout `upstream/deepseek-harness` @ `dsh-v0.1.3-alpha.2`（`82a5fd61a7`，release merge PR #3685）；Node v22.22.1（unrun 路径）；pnpm 11.7.0（store 重定向 `.scratch/pnpm-store`）；better-dsh 副本 = canonical `0.2.3`（rsync 双向已收敛，src/test 字节一致）；`DSH_HOME=.dsh-test`（prod `~/.dsh` 未动）；web `127.0.0.1:4999`
- 上游版本判定（S0 报告 `docs/50_test-reports/upstream-dsh-0.1.3-alpha.2-report.md`）：rc.1 = 纯发布（代码零差）；目标 = alpha.2（npm `alpha` dist-tag）

## 实测结果表

| 步骤 | 结果 | 备注 |
|---|---|---|
| S1 侦察 | ✅ | 三 tag 本机拉齐；patch 载体 tag 间 diff 复核（tsdown.client.ts ±1 / pnpm-workspace.yaml +8−1；`resolveRepositoryRoot` 上游未吸收，仍需本地） |
| S2 切换与重放 | ✅ | alpha.5 脏 overlay 全量归档 `.scratch/alpha5-dashr-local-overlay.patch`（2527 行）→ stash → checkout alpha.2 → 三必需 patch 手工重放（unrun devDep / storeDir+verifyDepsBeforeRun+zeromq / tsdown `resolveRepositoryRoot`）。**overlay 定性**：其余 17 文件全部为 bun --compile 可移植补丁（注释自证；Node 下惰性/同行为），未重引（4999 走 Node），归档留存 bun 实验用 |
| S3 副本地化 | ✅ | 副本无 stale `dsh-client-runtime` peerDep；peer 范围含 alpha.2（0.1.3-alpha.2 ∈ `>=0.1.2-alpha.1 <0.2.0-0`）；bundle 名 `@deepseek-ai/dsh-base`/`dsh-web-app` 不变 |
| S4/S5 安装与构建 | ✅ | `pnpm install`（**pnpm 11.7 自动插 `allowBuilds` 占位符 `set this to true or false` → 硬错，改显式布尔**，AGENTS.md 已知坑再现）；`pnpm run build` 全绿 ×2（tsc host + tsdown + vite web + 224 client artifacts），better-dsh lib+client 在位 |
| S6 启动 4999 | ✅ | systemd-run `dsh-4999-test`；root 200；dump-config：`dashr-repl` 行 + `DASHR_KERNEL_PYTHON` 注入 ✓；**注**：stop 后立即 start 有 EADDRINUSE 竞态（旧实例端口未释放），需间隔 ~2s 或独立 unit 先验证 |
| S7.1 工具面 | ✅ | `tool-web` 在位；`str_replace_editor` **缺席（0）**（base/web-app 默认下架生效） |
| S7.2 client 卡片 | ✅ | boot 图含 `"id":"better-dsh"`；合并 loader bundle 200（5.2MB/224 模块），better-dsh 段与 `lib/client/index.js` **字节一致**（除 sourceMappingURL 尾行）；单入口 `/plugins/??better-dsh/client.js` 404（alpha.2 只服务聚合 `??` 请求——探针改聚合提取法） |
| S7.3 行形状查表 | ✅（预查收敛） | ① connection 行形状未漂移（persona 行改 prefix/suffix 与 dashr 无交集）；② `__DSH_TRANSPORT__` 读法不变（新增可选 `__DSH_CONNECTION_RECOVERY__`，缺省无害）；③④⑤ 零改动 |
| S7.4 fence/isLoopback | ✅ 静态 | 页面含 `__DASHR_MOBILE__` boot script（web-trust 腿在位）；`__DSH_TRANSPORT__` 0（空 authorities 惰性=设计）；env 探针（`DSH_TRUSTED_HOSTS` 401/403）留手测 |
| S7.5 zoomGuard | ✅ 静态 | ④⑤ 零改动 → reconcile 路径不变；CDP 双形态留手测 |
| S7.6 telemetry | ⏳ 手测 | feedback 面已 revert（上游 13daefe073）；`DSH_TELEMETRY_DISABLED=1` 立场 prod 验证 |
| S7.7 老会话读兼容 | ⏳ 手测 | `.dsh-test` 无 v1 历史会话可自动验证；建议 GUI 用旧会话验证（上游 released migration 兜底） |
| file-tool 升级矩阵 | ⏳ 手测 | 事件报告建议 3 回归项；本地链路 09-06 已过，本实例留 user GUI 复测 |

## 发现与修复（本批次代码改动，vitest 全量 481/481 绿）

1. **session 事件面 API 漂移（真实对齐点）**：registry 解析的 `@deepseek-ai/dsh-session@0.1.2-rc.1` 为 **format-v2 会话**（`SESSION_FORMAT_VERSION=0`；header 必填 `isSeeded:boolean`；无 `.events` 属性，改 `snapshotEvents()`/`ownEvents()`）→ dashr `url-schema/handlers/agent.ts` roster 的 `live.events` 属性读失效。修复：`live.snapshotEvents()`；测试 fixture 补 `isSeeded:false`（自包含 seed，非 fork）。见 diff。
2. **pi-natives loader 锚点穿透**：`findPackageDir` 的 `createRequire.resolve` 快路径会经进程 globalPaths（含 pnpm `.pnpm/node_modules` hoist 根）从**任意锚点**命中已安装 addon，违反"锚点限定"契约（degradation 测试抓出）。修复：去掉 resolve 快路径，仅用自锚点向上的确定性 node_modules walk。见 diff。
3. **escalation-guidance 附 A 定稿回填 canonical**（drift 修正）：monorepo 副本已实装定稿（deniable/denied · per-call），canonical `src/index.ts` 仍旧句 → 回填；`presentation.spec.ts` 断言同步（定稿 token + 无 'retried once' 断言）。
4. **附 C 矛盾子句结案（不暴露）**：render 证据（`renderReplBridgeInstructions` signature-only，description 散文不进模型可见面）→ 不做 dashr 侧订正；上游 schema 文本缺陷记上游面 Open item。S7 实证项（grep 装配产物 0 命中）未单独执行——本轮运行实例装配面即证（签名行、零散文）。

## 环境注记 / Open items

- **peer 双副本分裂**：better-dsh 的 peer `@deepseek-ai/*` 经 pnpm autoInstallPeers 从 registry 装入 `.pnpm`（dsh-llm/dsh-session@0.1.2-rc.1），而部分依赖链解析到 workspace 副本 → **包级 `tsc -p tsconfig.json` 出现双身份类型分裂（69 错，dsh-llm branded 字段、SessionSeq 品牌）**；权威类型门 = 根 `tsc -b tsconfig.host.json`（`pnpm run build`，**全绿 0 错**）。vitest 全量（36 文件/481 用例）绿。非代码回归，记录待解（历史 dev-loop 在 alpha.5 未现，系本次 registry 解析到 rc.1/alpha.2 后拓扑变化）。
- **registry 发布物与 tag 疑点（上游面）**：npm `@deepseek-ai/dsh-session@0.1.2-rc.1` 实为 format-v2 API，而 git rc.1 tag（== alpha.5）按版本号-only 判定应无此改动 → 疑似 session 包独立发布线带 0.1.3-alpha 代码却标 rc.1。记录，prod 升级前需以 npm 发布物为准复验。
- 手测/用户项：老会话读兼容、fence env 探针（401/403）、zoomGuard/mobile CDP 双形态、file-tool 升级矩阵、prod 3080 复测（write 事件回归）。
- 版本：canonical `dashr/package.json` → **0.2.3**（本地 commit+tag `v0.2.3`；npm 发布按 AGENTS.md 红线另行）。

## 产出

- S0 差异报告：`docs/50_test-reports/upstream-dsh-0.1.3-alpha.2-report.md`（2026-09-08 已落）
- 本报告 + OpenSpec change `2026-09-08-upstream-0-1-3-alpha-2-alignment/`（proposal/design/tasks/specs delta）
- overlay 归档：`.scratch/alpha5-dashr-local-overlay.patch` + 逐文件分片 `.scratch/overlay-triage/`

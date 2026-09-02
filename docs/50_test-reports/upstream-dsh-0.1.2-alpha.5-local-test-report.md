# 上游 dsh 0.1.2-alpha.5 本地实测报告（Dev/Test 1 源码级 4999 实例）

- 实测日期：2026-09-02
- 范围：upstream checkout 升级 alpha.3 → alpha.5、本地构建、4999 隔离实例启动、工具面冒烟、agent 侧功能实测（user 驱动）、session storage 热升级观察、web UI 手工核查（user）
- 结论：**PASS —— 无破坏性更新，整体可跑起来；dashr 工具与界面介入 functionality 衔接正常，无大适配性问题**。3 项 UI/功能瑕疵记录在案，作为下一波 alignment 的 change 输入（§4）。

前置调研见 `upstream-dsh-0.1.2-alpha.5-report.md`（alpha.3 → alpha.5 差异分析）。

---

## 1. 实测范围与结果

| # | 测试 | 结果 |
|---|---|---|
| T1 | checkout `dsh-v0.1.2-alpha.5` + 本地 patch 重放（stash → checkout → stash pop） | ✅ patch 载体文件（`pnpm-workspace.yaml`/`tsdown.client.ts`）tag 间零改动，干净重放；备份 `.scratch/alpha3-local-patches-backup.patch` |
| T2 | `pnpm install`（268 workspace projects，store 重定向 `.scratch/pnpm-store`） | ✅ EXIT=0（修两坑后，见 §2 备注） |
| T3 | `pnpm run build` + better-dsh tsdown | ✅ tsc + tsdown host/client + vite web（220 client artifacts）+ 插件产物 |
| T4 | 4999 实例启动（`DSH_HOME=.dsh-test`，与 prod 3080 完全隔离） | ✅ `dsh-root@0.1.2-alpha.5` 监听 127.0.0.1:4999，token URL 正常签发 |
| T5 | 工具面冒烟（dump-config） | ✅ `dashr-repl` 工具行在、`DASHR_KERNEL_PYTHON` 注入正常；`tool-web` 为 `fetchProvider: http`，`web-fetch-http` 服务挂载——alpha.5 的 **web_fetch 默认开放**在本实例得到确认（base 层行为，含无审批匿名公网抓取，见调研报告专题二） |
| T6 | web shell 冒烟（cookie jar + 303 认证链） | ✅ 根页 200（title: DSH Local Build）+ 新构建 asset（`/assets/index-*.js`）200 |
| T7 | **session storage 热升级观察**（重点，见 §3） | ✅ 结构变更就地完成，全程无崩溃 |
| T8 | agent 侧功能实测（user 在实例上驱动运行中的 agent） | ✅ dashr 工具与界面介入 functionality 均能衔接，整体无大适配性问题 |
| T9 | web UI 手工核查（user） | ⚠️ 3 项瑕疵，见 §4（1 项为 dashr 计划特色未实现；2 项为 user 私人 patch 未适配） |

## 2. 环境事实

| 项 | 值 |
|---|---|
| Harness checkout | `./upstream/deepseek-harness`，detached at `dsh-v0.1.2-alpha.5`（db6bdc3576） |
| 本地 patch（3 个，全部重放成功） | ① `tsdown.client.ts` REPOSITORY_ROOT 推导（本机 Node 22.22.1 无 native TS loader，必需）；② `pnpm-workspace.yaml` storeDir 重定向 + `verifyDepsBeforeRun: false`；③ 根 `package.json` 补 `unrun` devDep |
| dashr 副本 | `packages/better-dsh/better-dsh/`（workspace 成员，npm-range peerDeps 靠 `linkWorkspacePackages` 解析） |
| 用户数据 | `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`（**携 alpha.3 时代存量数据直接升级**，这正是 T7 的观察对象） |
| 实例 | `npm run dsh -- web --no-open --port 4999`；prod `~/.dsh` 全程未动 |

本轮融资到的两个坑（已修，并已固化进 AGENTS.md）：

1. **stale peerDep 复发**：rsync 从 canonical 带回 `@deepseek-ai/dsh-client-runtime` peerDep；alpha.5 workspace 已无此包、npm 亦无匹配 range 的版本 → `ERR_PNPM_NO_MATCHING_VERSION`。修法：副本 package.json 删该 peerDep + `peerDependenciesMeta` 条目（每次 rsync 后须重删）。
2. **zeromq build 审批**：pnpm 11.7 插入的 `set this to true or false` 占位符在 strictDepBuilds 下为硬错误。修法：`allowBuilds` 显式 `zeromq: true`（zeromq 是 better-dsh 自己的 kernel IPC 依赖，必须放行）。

另：`pnpm install | tail` 会吞退出码（本次正是靠 `pipefail` 抓到第一坑），流程里一律 `set -o pipefail`。

## 3. 重点观察：session storage 结构性更新与热升级自愈（T7）

**这是本轮实测最重要的一条记录：上游 alpha.5 自带的 session storage 热升级在真实测试实体上可观察地完成了——结构变了，系统没有崩溃。**

背景（上游笔记 `.agents/notes/implemented/architecture/2026-09-02-projcache-cross-version-read-compat.zh.md`）：`session_projcache` 域磁盘结构三代演进——v3（0.1.1-rc.2，单文件）→ v4（0.1.2-alpha.3，per-record `sessions/<sessionId>.json`）→ v5（0.1.2-alpha.4/5，同布局，identity 新增 `isSeeded`/`inheritedEventCount` lineage 字段）。alpha.5 的热修以声明式读兼容实现自愈：域声明 `version: 5, compatibleVersions: [3, 4]`，旧版本戳记录直接读入，**读到旧记录后的下一次 checkpoint 自然把它重写为当前版本**；schema 兜底 `backup-and-skip`（改名 `.bak.<ts>` 留档跳过），取代此前"整域拒开/列表丢标题"的故障模式。

本实例的磁盘证据（`.dsh-test/storages/`，时间线）：

| 观察 | 事实 | 解读 |
|---|---|---|
| 存量保留 | `session_projcache/` 目录 mtime 停在 16:44（alpha.3 建域时刻）原地保留 | 升级未清场、未迁移重摆 |
| **热升级写回** | `sessions/session-2547aab1….json`（createdAt ≈ 16:44，**与 alpha.3 建域精确吻合的旧会话**）mtime 21:48（alpha.5 运行期），内容已是 `"version": 5` 且带 `isSeeded`/`inheritedEventCount` | v4 旧记录被读兼容接受后，checkpoint 重写为 v5——**"自愈"的直接物证** |
| 新写会话 | 23:31 起新会话文档 `version: 5` 正常写入（新 id 无 `session-` 前缀） | 新版本戳写入路径正常 |
| 混版本共存 | 23:36/23:48 仍有 `version: 4` 新文档落盘（cwd=`.scratch/acp-playground`；**已确认（user）：另一 agent 的 dsh ACP 测试共享 `.dsh-test` profile**——隔离分区、共享测试 profile，属预期形态），与 v5 文档同域共存、SessionList 照常服务 | 读兼容不仅容忍存量，也容忍**并发旧版本写入**（新老实例并发共享一个 home 的额外压力证据） |
| 无崩溃 | 整个测试窗口（含 user 交互实测至 23:49）实例持续服务 | "没有发生破坏性崩溃"——虽然结构变了，升级对使用侧透明 |

结论：对将来的 prod 升级（目前 prod 仍为 alpha.3 = v4 home）而言，本轮等于在隔离实体上预演了同一条升级路径（v4 home → alpha.5），**存储侧无阻断性风险**。

## 4. 发现的瑕疵（下一波 alignment 的 change 输入）

| # | 现象 | 定性 | 去向 |
|---|---|---|---|
| P1 | Settings > General 未见 **Model Failover** 功能 | dashr 计划中的特色功能，尚未实现——非 alpha.5 回归 | 排入 dashr 下一波开发 |
| P2 | **Loopback Auth Patch** 未生效：Settings > Models 显示 "loading the provider directory failed"，模型清单不出 | user 私人 patch（不随 dashr ship）；alpha.4/5 对 provider directory 相关代码有改动，patch 触点漂移 | alignment change：为 patch 重定位触点 |
| P3 | **Mobile Responsiveness UI Patch** 未生效：移动端右侧栏未隐藏（宽度不为 0），手指左右滑动交互失效 | user 私人 patch（不随 dashr ship）；布局逻辑向 CSS 迁移（调研报告专题一）后原 JS 侧挂点失效 | alignment change：改走 CSS/语义属性路线重做 |

dashr 本体（工具注册、REPL pad、界面介入）：无适配性问题（T5/T8）。

## 5. 流程化产出（本轮已落地）

1. **`.agents/skills/upstream-alignment/SKILL.md`**：把"上游插件项目的版本对齐"固化为可复用技能——checkout 最新上游 → wire 最新插件 → 验证运行 → 发现的不足作为下一波 change。本轮 alpha.5 实测即其首次全流程演练。
2. **AGENTS.md 部署规范**：新增"user, just another user"生产部署原则（registry 同源安装：npm 主体 + npm/plugin-market 插件），与 dev/test 源码路径（第二、三节）正式分离。

## 6. Open items

- ~~确认 §3 混版本共存中 v4 新文档的确切写入方~~ **已确认（user 2026-09-02）**：另一 agent 的 dsh ACP 测试共享 `.dsh-test` profile（隔离分区、共享 profile），v4 新文档即其写入，属预期测试形态。
- P2/P3 两个 user 私人 patch 在 alpha.5 下的重适配（触点重定位 / CSS 路线重做）。
- P1 Model Failover 的设计与排期。
- dashr web UI 卡片半边（`build-client`）在 monorepo 内仍未跑（沿用既有记载，需要时再补）。
- prod（3080）升级决策：本轮存储侧与插件侧均无阻断项；升级时按调研报告专题二复核工具面（base 默认多出无审批 `web_fetch`）。

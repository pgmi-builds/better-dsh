# upstream dsh npm 版本对账：prod 0.1.3-alpha.2 → 0.1.5-rc.2

> 生成时间：2026-09-10（本地时区）
> 数据源：npm registry（`@deepseek-ai/dsh`）元数据 + `upstream/deepseek-harness` git tag 对账
> 目标：回答「npm 上比 prod 更高的版本是什么、diff 有多大、对 prod 意味着什么」

---

## 〇、一句话结论

prod 当前跑 **`@deepseek-ai/dsh@0.1.3-alpha.2`**。npm 上比它高的版本是整条 **0.1.5 线**（`alpha.1 / alpha.2 / rc.1 / rc.2`，**0.1.4 从未发布，直接跳号**）。最高版本是 **`0.1.5-rc.2`**（挂在 `next` dist-tag，而 `latest` 还停在 `0.1.5-rc.1`）。

这条 0.1.5 线是**大版本级聚合**：846 commits、3170 文件、约 10.4 万行新增。核心是 **Session 格式 v3 重写**（会话持久化契约变更，对 prod 是**破坏性升级，不可 drop-in**），外加 Electron 桌面打包、Sidebar/dockkit 重构、文件交付「present」工具、图渲染预览、模型默认值切换（DeepSeek V41 Flash）等一批功能。**升级 prod 前必须按 AGENTS.md §一/§二 走对齐轮，不能只换版本号。**

---

## 一、版本全景

npm registry 当前 dist-tags：

| dist-tag | 指向版本 |
|---|---|
| `latest` | 0.1.5-rc.1 |
| `next` | **0.1.5-rc.2**（最高） |
| `alpha` | 0.1.5-alpha.2 |

比 prod（0.1.3-alpha.2）更高的版本，按发布顺序：

| 版本 | npm 发布时间 (UTC) | dist-tag |
|---|---|---|
| 0.1.5-alpha.1 | 2026-09-08 15:57 | — |
| 0.1.5-alpha.2 | 2026-09-09 14:41 | `alpha` |
| 0.1.5-rc.1 | 2026-09-10 03:12 | `latest` |
| **0.1.5-rc.2** | **2026-09-10 14:57** | `next` |

> 注意点：`latest` 并不指向最高版本（rc.1 vs rc.2）；「最高版本」= `next` 上的 **0.1.5-rc.2**。0.1.4 未在 npm 出现过。

对应 git tag（本地 `upstream/deepseek-harness`，已 fetch）：

```
dsh-v0.1.3-alpha.2  2026-09-07 19:45 +0800   ← prod 当前
dsh-v0.1.5-alpha.1  2026-09-08 23:25 +0800
dsh-v0.1.5-alpha.2  2026-09-09 22:13 +0800
dsh-v0.1.5-rc.1     2026-09-10 09:36 +0800
dsh-v0.1.5-rc.2     2026-09-10 21:50 +0800
```

---

## 二、diff 规模

`dsh-v0.1.3-alpha.2 .. dsh-v0.1.5-rc.2`：

| 指标 | 值 |
|---|---|
| commits | **846** |
| 文件 | 3170 changed |
| 行 | +103,990 / −17,687 |
| 源码侧（排除 snapshots/tests） | 2474 文件，+68,818 / −13,973 |

分段 commit 分布：

| 区间 | commits |
|---|---|
| 0.1.3-alpha.2 → 0.1.5-alpha.1 | 563（大头，聚合了 Session V3 与一堆 feature） |
| 0.1.5-alpha.1 → 0.1.5-alpha.2 | 262 |
| 0.1.5-alpha.2 → 0.1.5-rc.1 | 17 |
| 0.1.5-rc.1 → 0.1.5-rc.2 | 4（收尾/backport） |

---

## 三、依赖面变化（对 prod 直接可见）

prod 0.1.3-alpha.2 有 **71 个 dependencies**，0.1.5-rc.2 有 **72 个**。差异：

1. **新增运行期包 `@deepseek-ai/dsh-tool-present`**（`packages/fs/tool-present`）——新「present」工具：把 agent 产出的文件以不可变交付卡片（download card）呈现，是文件交付特性的宿主半。
2. `apps/cli` devDeps 新增 `@deepseek-ai/dsh-agent-loop`、`@deepseek-ai/dsh-agent-loop-testkit`（内部，不影响 prod 运行面）。
3. 新增 client 包 `ui-deliverables`（`PresentRow` / `PresentedFileCard` / `present-open`），属 web shell 交付卡片 UI。
4. 其余全部 `@deepseek-ai/*` 依赖整体从 `^0.1.3-alpha.2` 抬到 `^0.1.5-rc.2`（同版本号齐步，无个别漂移）。
5. 底层 `cordis` / `schemastery` / `commander` / `js-yaml` 等版本**未变**（`cordis ^4.0.2`、`schemastery ^3.18.2` 等，与 0.1.3-alpha.2 相同）。

---

## 四、主要变更主题（按 prod 相关度排序）

### 1. Session 格式 v3 重写（⚠ 破坏性，最高风险）
`session-log-v3` 工作线，是本次最大的变更块。要点：

- 会话身份 **V2 → V3 迁移**（`feat(session): add identity V2-to-V3 migration and writer skeleton`）。
- system prompt 表示为 **surface node zero**（`refactor(session): represent the system prompt as surface node zero`）。
- **canonical envelopes**、PTC durable vocabulary、in-history system prompt 表示、JSONL 跨进程写所有权（lease）。
- 大量 `session.v3.jsonl` 快照与 V2/V3 迁移覆盖面单测。

> **对 prod 的含义**：会话持久化契约改变。上一轮（0.1.3-alpha.2 对齐）已实测：上游 tag diff 会打到 `session-persistence-omp.ts` / `replay.ts` / store 的 handle+lease 契约（见 2026-09-08 对齐报告）。**0.1.5 的 V3 比 0.1.3 的 V2 更进一步，破坏面更大**，`better-dsh` / `omp-web` 这类桥接会话数据的插件必须重新对齐，不能 drop-in。

### 2. Electron 桌面打包（对 3080 web 无直接作用）
Windows/macOS/Linux 构建、mac 签名+公证、Windows 签名、auto-update、IPC 性能优化。纯桌面宿主线，与本机 `dsh web`（3080）部署无关，但意味着上游发布面从此多一个桌面产物。

### 3. Sidebar / dockkit 重构
- `dockkit` 可逆停靠引擎、pointer 交互。
- 全局 sidebar panel、tab 导航、live tab 标题 + 文件类型图标、末 tab 关闭规则、响应式右栏、全屏 shell。
- session-log 控制移入 header「更多」菜单。

### 4. 文件交付「present」工具 + 文档预览
- 新 `dsh-tool-present` 包：不可变文件交付下载卡片、artifact 卡原生文件动作、workspace 文件操作。
- 可扩展文档预览、文本预览分页 tab、文件类型图标集、`ui-deliverables` client 卡。
- `feat(fs)`：bounded byte-range reads（fs-local / fs-e2b）、dual-face 文件 API。

### 5. 图表 / Markdown 预览
Chat 代码块内预览 Mermaid / Graphviz / SVG / HTML fence，适配应用主题。

### 6. LLM 模型默认值切换（⚠ 影响 prod 行为）
- Chat Completions 默认切到 **DeepSeek V41 Flash**（`feat(llm): default Chat Completions to DeepSeek V41 Flash`）。
- 保留 V4 模型、恢复 V4 Flash Vision Exp catalog 条目。
> prod 若升级，默认模型会跟着变；需确认是否期望。

### 7. Feedback 对话框
`/feedback` 与 Dislike 统一为一个带分类的对话框 + toast。

### 8. Subagent catalog
记录并观察 parent-owned child catalog（子代理目录）。

### 9. native system / node-addon-system
包族改名 `node-addon-system`，预编译 Node-API flock、Landlock capability 子路径。**新增原生依赖面，升级安装需留意 prod 机上的原生构建/预编译匹配**（本机已有一处 zeromq allowBuilds 特例，见 AGENTS.md §二）。

### 10. minimal profile 行为调整
- `str_replace_editor` 从 minimal profiles 移除。
- persistent bash 输出与 one-shot shell 契约对齐。
> 只影响 minimal profile，不影响 prod `web` profile 的默认工具集。

### 11. 其它
- CLI：从 shipped 模板创建 profile。
- skills：Playwright 视频录制 GIF。
- 内部 CI/审查自动化（weighted PR approval、review owner 排名等）——与 prod 运行无关。

---

## 五、对 prod 升级的风险评估（简要）

| 风险项 | 级别 | 说明 |
|---|---|---|
| Session V3 格式迁移 | 🔴 高 | 会话持久化契约变更；`better-dsh`/`omp-web` 会话桥接面需重新对齐，先例（0.1.3 V2）已证实非 drop-in |
| 模型默认切 V41 Flash | 🟠 中 | 默认行为变化，需 user 确认是否接受 |
| 新原生依赖（node-addon-system） | 🟡 中低 | 安装面原生构建/预编译匹配；本机 pnpm strictDepBuilds/allowBuilds 需复核 |
| 新工具 `dsh-tool-present` | 🟡 中低 | 新工具进入 agent 运行时，需确认与现有工具/插件无 id 冲突 |
| Sidebar/dockkit UI 重构 | 🟢 低（功能面） | 纯增量 UI，但 better-dsh 的 mobile 手势/侧栏 patch 需复测是否仍对齐 |
| Electron 桌面 | ⚪ 无关 | 不影响 web 部署 |

---

## 六、建议

1. 本次**只做对账、不做升级**：0.1.5 是聚合大版本，且含 Session V3 破坏性契约变更，不能当「换版本号」处理。
2. 若后续要升级，按 AGENTS.md §一/§二走 **Dev/Test 1（4999 源码级）对齐轮**：切 `dsh-v0.1.5-rc.2` → 重放三处本地 patch（storeDir / unrun devDep / resolveRepositoryRoot）→ install/build → 插件契约对齐（重点 `session-persistence-omp.ts`/`replay.ts`/store 的 V3 handle+lease）→ tsc/单测 → 4999 第一人称实测 → 报告落 `docs/50_test-reports/` → user 确认 → 才动 prod 3080。
3. 升级目标版本**首选 `0.1.5-rc.2`（`next`）而非 `latest`（rc.1）**，因为 rc.2 才是最高版本；但 rc 阶段仍建议等上游正式 stable 后再定。
4. 升级前单独确认模型默认值（V41 Flash）是否要在 prod 生效。

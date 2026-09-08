# 诊断报告：hashline edit `E_RANGE_UNVERIFIED` 跨轮会话键失效

> 日期：2026-09-08 · 环境：DSH v0.1.2-alpha 线（Web GUI），file policy = workspace-write
> （workspace：`/home/u1/workspaces/dashr`），better-dsh hashline edit 桥（vendored
> `dashr/src/url-schema/vendored/hashline/`，dsh-better-edit 工具集）。
> 性质：**行为诊断**（非实测计划）；一次真实触发 + 源码级与账本级取证。
> 前置关联：`2026-09-06-write工具sandbox升级透传bug复发及挂起-事件报告.md`（同桥另一缺陷线）。

---

## 0. 一句话结论

`E_RANGE_UNVERIFIED` 拒绝**不是校验代码的 bug**：write 后 auto-read 确实记了账，但 hashline
的 served 账本按 **(session_id, path)** 键存储，而本部署**每个对话轮（continuation round）更换
harness session id**——上一轮 write-hook 记的账，下一轮 edit 用自己的新键去查，必然查空。锚点
与磁盘内容当时完全匹配（echo 可证），拒绝是**出处（provenance）账本问题，不是 staleness**。
fail-closed 与批量原子性按设计工作，零数据损伤；代价是**跨轮编辑必须冗余 read 一次**。

---

## 1. 现象与错误解剖

原始报错（13-tuple 批量 edit 的第 0 个 tuple）：

```
Error: [E_BATCH_ABORT] edits[0] (…/docs/superd/01-component-boundaries.md) failed:
[E_RANGE_UNVERIFIED] cannot verify range against served state in …:
remove_from "Utw" has no served position; remove_to "Utw" has no served position.
Current range:
Utw│# Super D 组件边界与 UI 组合层（v0.1）
Retry with these anchors (no read needed). … The whole batch was rejected and
NOTHING was written — no file changed and earlier items in the batch were NOT applied.
```

三层套叠，每层各自按契约工作：

| 错误码 | 含义 | 触发条件 | 本次是否命中 |
|---|---|---|---|
| `E_RANGE_UNVERIFIED` | 出处校验失败：锚点 hash 在**本会话 served 账本**查无位置 | 账本没记过"你看过这行" | ✅（本案） |
| `E_RANGE_STALE` | 内容漂移：served 位置上的 hash 与当前文件不一致 | 文件在 serve 之后被改过 | ❌ |
| `E_RANGE_UNSERVED` | 区间中洞：起止锚在账，中间行从未 served | 部分服务（截断读后编辑跨页） | ❌ |
| `E_BATCH_ABORT` | 批量原子中止：任一 tuple 失败 ⇒ 整批不写、先前 tuple 也不应用 | 防半套状态 | ✅（外层包装） |

注意 echo 行 `Utw│# Super D 组件边界与 UI 组合层（v0.1）` 与磁盘逐字节一致——**锚点本身完全
有效**，拒绝纯粹因为账本查无出处。

---

## 2. 事发回放（时间线）

| 时刻 | 轮 | 动作 | 结果 |
|---|---|---|---|
| 轮 B | 蓝图 + 边界文档轮 | `write` 创建 `01-component-boundaries.md`（244 行） | write-hook 触发：结果尾部带 `--- Auto-read (hashline anchors) ---`，全文件锚点（`Utw…Pb8`）；`readAndServe → recordServed` 记账，键 = 轮 B 的 session id |
| 轮 B→C | 轮边界 | harness 换 session id | （无感知） |
| 轮 C | 透传/认证轮 | 拿 auto-read 锚点提交 13-tuple edit | `loadServed(轮C键, path)` = 空 → `E_RANGE_UNVERIFIED` → 整批拒绝，**零写入** |
| 轮 C | 同轮 | `read` 全文（重新记账到轮 C 键）→ 原样重交 | 13/13 全部成功 |

---

## 3. 取证

### 3.1 代码链（vendored hashline，全部一手核对）

| 环节 | 文件 | 事实 |
|---|---|---|
| 拒绝点 | `hashline/anchor-pipeline.js:462` `verifyServedRange()` | 先 `servedPositionsOf(served, hash)` 查账：查无 → `E_RANGE_UNVERIFIED`；查到但内容不匹配 → `E_RANGE_STALE`；区间中洞 → `E_RANGE_UNSERVED` |
| 批量原子性 | `edit-engine.js:270` | 任一 item 失败 → `[E_BATCH_ABORT]` + 当前区间 echo，整批不写 |
| write 记账 | `write-hook.js`（`tools/post-execute` 监听） | write 成功后调 `readAndServe(io, path, cwd, { sessionKey: execSessionKey(exec) })`——**渲染锚点与记账是同一次调用**，preview 出现 = 记账执行过；catch 兜底只影响回显不影响 write 本体 |
| 账本读写 | `read-and-serve.js` → `session-view.js` `recordServed/loadServed` | served 按 **(session_id, path)** 唯一键 upsert |
| 键推导 | `session-view.js:47-58` | `sessionKeyFor(exec.agent?.session.id)`；缺 id 时落到进程级 `randomUUID()` 兜底键 |
| 存储位置 | `paths.js` `configDir(cwd)` | `<workspace>/.dsh_better_edit/hash-store.sqlite`；workspace = `exec.agent.session.header.cwd`（`withWorkspace` 传播） |

### 3.2 账本验尸（sqlite 实查）

库：`/home/u1/workspaces/dashr/.dsh_better_edit/hash-store.sqlite`（表：snapshots / meta / undo /
served；served 666 行、579 快照）。

本对话相关行（节选，按时间）：

```
09-08 01:18  session-cb07ad10…  （轮 A：dash-research 深化轮）
09-08 02:13  session-a1b3097d…  01-component-boundaries.md  ["Utw","AuN",…]   ← v0.1 布局
09-08 02:15  session-a1b3097d…  00-blueprint.md              ["aD5",…]
09-08 03:20  session-a61bbf92…  00-blueprint.md              ["C7S",…]（v0.3 期）
09-08 03:41  session-328368a6…  01-component-boundaries.md  ["pKk",…]        ← v0.3 后布局
09-08 03:53  session-328368a6…  00-blueprint.md              ["rJz",…]
```

关键观察：

1. **每轮一个键**：served 表共 50+ 个 distinct session 键（含大量无 `session-` 前缀的裸 UUID——
   `sessionKeyFor(undefined)` 的进程兜底键，来自 preview/test 形态）。本对话各轮 `memory_flush`
   回显的 session id 与账本键一一对应（轮 A=`cb07ad10…`、轮 B=`7104efad…`），**轮 B 的键在
   本库无任何行**——它的 read/edit/write-hook 记账落在了别处（store 跟随 exec cwd）或同样因
   轮界不可见；轮 C 的编辑因此查空。
2. **(session, path) upsert 语义**：同键同路径后写覆盖前写，跨键各留一行——这正是"跨轮每换
   一键就重读一次"摩擦的账面痕迹（blueprint 在 4+ 个键下各有一行）。
3. **snapshots 表全局按 path**（不分会话）——与 served 的会话隔离形成对照：文件指纹证据本来
   就有全局权威，只有"谁看过"是会话私有的。

### 3.3 判定时刻的锚点有效性

拒绝时的 echo 显示 `Utw` 行与磁盘一致；且调用方必须先在**当前文件哈希表**里定位出锚点区间才能
构造该 echo（`verifyServedRange` 收到 `fileHashes` 与定位后的 `startLine/endLine`）。即：**锚点
与磁盘逐字节匹配的条件下仍然被拒**——拒绝条件是纯账本出处，非内容漂移。这是提出修复方案 1
（content-match 快道）的直接依据。

---

## 4. 判定

**没有坏的部分**（逐项核对通过）：

- 校验逻辑三分支语义正确、先账本后内容、顺序合理；
- write-hook 记账链无缺陷（渲染与记账同调用，preview 出现即记账执行）；
- fail-closed：查不到出处一律拒绝，绝不带疑写入；
- 批量原子性：`E_BATCH_ABORT` 整批回滚，先前的 tuple 不落盘（本案 13 tuple 零写入）；
- 恢复路径干净：一次 `read` 重记帐后原样重交即全绿。

**缺口**（设计假设与部署现实不符）：

- 账本假设"一个逻辑对话 = 一个稳定 session id"；本部署每个 continuation round 换新 id（且
  store 目录跟随 exec cwd），**跨轮 served 必然不可见** ⇒ 每个轮界对每个待编辑文件强制一次
  冗余 read——纯摩擦、无风险、可完全消除。
- 报错文案 `"Retry with these anchors (no read needed)"` 对多 tuple 批是误导：echo 只把
  `edits[0]` 的区间记为 served，原样重交会在 `edits[1]` 上再失败、循环往复；正确指引是
  "read 一次后整批重交"。

---

## 5. 修复建议（better-dsh，按性价比排序）

1. **content-match 快道（推荐）**：`verifyServedRange` 已持有当前 `fileHashes` 与定位区间——
   当锚点 hash 在当前文件的定位区间上**逐行全匹配**时直接接受。byte-exact 保障不损（全匹配
   ⇔ 自锚点生成以来该区间未变），served 账本从"门禁"降级为 echo/undo 的辅助。整体消灭此类
   摩擦，且不依赖 harness 侧任何改动。
2. **served 键去 session 化**：per-workspace 一份；或当前键为空时采纳该 path 的最近 serves
   （`snapshots` 已是全局按 path 的先例）。改动小，但弱化"多会话并行同一文件"的隔离语义，
   需评估并发场景。
3. **改键源**：若 harness exec 暴露 conversation/root id（resume/continuation 的稳定根），
   以其代替 `session.id` 做键——语义最正，依赖上游字段存在。
4. **廉价修（文案）**：多 tuple 批失败时指引改为"对本文件 read 一次后整批重交"；顺带在
   `E_RANGE_UNVERIFIED` 文案中点明"write auto-read 的锚点跨轮不可复用"这一部署事实。

建议 1 与 2/3 不互斥：1 消摩擦，2/3 修语义。落地走 openspec change 流程（含单测：write → 模拟
换 sessionKey → edit 应成功/回退行为明确）。

---

## 6. 复现与回归要点

- 触发条件：轮 N `write`（或 read）文件 → 轮 N+1 直接 edit 同文件 → 必现
  `E_RANGE_UNVERIFIED`（首个 tuple 即拒）。
- 快速复现（不依赖轮界）：同文件两次 edit 之间，用不同 `sessionKey` 调 `loadServed` 即等价
  （单测可直接构造）。
- 回归断言：修复后 write/read 的锚点在**任意后续轮**直接可用；`E_RANGE_STALE`（真漂移）与
  `E_RANGE_UNSERVED`（区间中洞）行为不变；批量原子性不变。

## 来源

- 一手源码：`dashr/src/url-schema/vendored/hashline/{write-hook,read-and-serve,session-view,
  paths}.js`、`hashline/anchor-pipeline.js`（verifyServedRange）、`edit-engine.js`（批量中止）
- 一手账本：`/home/u1/workspaces/dashr/.dsh_better_edit/hash-store.sqlite`（served/snapshots/
  undo 表实查，2026-09-08）
- 触发实录：本 session 轮 B→轮 C（`docs/superd/01-component-boundaries.md`，13-tuple 批，
  拒绝后 read 重交 13/13 成功）

---


## 7. 勘误与设计裁决（2026-09-08 第二轮复核，user 主持）

> 本节修正上文 §0/§2/§4 的关键归因错误，并记录用户裁决的修复方向。原文保留作诊断过程记录。

### 7.1 勘误："每轮换 session id" 不成立，真实机制是会话树 fork

| 上文断言 | 复核结论 | 一手证据 |
|---|---|---|
| "本部署每个 continuation round 更换 harness session id" | **不成立**。账本键 = `exec.agent?.session.id` 原样（`session-view.js:47-58`，无加工），与 `~/.dsh/sessions/<workspace>/session-<uuid>/` 目录及 `session.jsonl.zstd` header.id **一一对应**；同 id 跨多小时/多轮复用（328368a6：03:41+03:53 两笔；2f3a8234：04:27→11:41 跨 7h，本报告即该会话所写） | dashr 桶 6 个 session 目录与账本键全对上 |
| "轮 B→C harness 换 id（无感知）" | 真实机制 = **DSH 会话是树，延续/fork 产生新节点**：header 带 `parentSession` + `seedLength`；`packages/core/session/src/index.ts` 有显式 `fork(source, boundary?, childSessionId?)`（注释："Seeding with an existing event log replays/forks a session"）。fork 对 UI 与上下文透明，故 agent/user 均感知为"同一对话" | 实测谱系：`345e1e12 →fork→ cb07ad10 (seed 23,388)`；`a1b3097d(根, 01:24) →fork(03:08)→ 328368a6 (seed 65,305) →fork(03:11)→ a61bbf92 (seed 65,308)`；`2f3a8234` 独立根 |
| 病根表述 | 修正为：**轮 B write（02:13:16/02:15:02，键 a1b3097d）与轮 C edit（03:41:38/03:53:15，键 328368a6）分属父子会话节点**，served 按 (session节点， path) 记账 → 子节点查空 → `E_RANGE_UNVERIFIED`。fail-closed、批量原子、恢复路径等结论不变 | 账本 sqlite 逐行时间核对 |
| "memory_flush 回显 session id 与账本键一一对应（轮 B=7104efad…）" | **不成立，观察源即错**。corti-memory `memory_flush` 回显的是 `exec?.session?.id`（`corti-memory/dist/index.js:381-384`，fallback `lastSeenSessionId`/"dsh-session"），**不是写账本的 `exec.agent?.session.id`**；7104efad 属 `/home/u1/workspaces/base`（workspace.json：base 桶 updated `09-07T18:13:19Z` = 本地 09-08 02:13；base 桶 `session-7104efad…/session.jsonl.zstd` 206KB，02:13–02:18 活跃），而账本 02:13 行键 = a1b3097d | 两个 id 分属不同 workspace 的会话对象 |

### 7.2 write 语义与守卫归属（确认）

- better-dsh **未干预 write 执行**：上游 `packages/fs/tool-fs/src/write.ts` 自述 *"Model-facing full-file write … no policy means an unconditional atomic create-or-overwrite"*，确认信封 *"no file content is echoed back"*。better-dsh 仅经 `tools/post-execute` 追加锚点回放（模型面 content）。
- **整文件写在逻辑上不要求"之前见过"**：新文件天然无此前提；已有文件的守卫归覆盖确认层（DSH approval policy + `dsh-fs-observation-policy` 的 createIfAbsent/replaceIfVersion），与 hashline 无关。上文 §5 建议 4 中"write auto-read 锚点跨轮不可复用"的文案指引随 §7.3 裁决一并重写。

### 7.3 hook 时机与回放必要性（裁决）

- `tools/post-execute` 即 **tool-result 相位**水漏（`pre-execute → execute → post-execute`；core/tools invariant："post-execute must follow pre-execute or execute"；spill-policy 同瀑布组合；签名 `(exec, result, next) → Promise<PostToolDecision>`，write-hook `await next()` 后追加内容，**异步安全**）。挂点选对了。
- 脆弱点：`final-result` 路径 **bypass post-execute**（core/tools `index.ts:421`）——未来异步/后台写工具若走该路径，回放会静默丢失。
- **回放与 edit 解耦（裁决）**：OMP write 模型面 = 成功确认 + 新 `[path#TAG]`，**不回显内容**（渲染器 12/6 行预览仅 UI 侧）。DSH write-hook 现回放全文件锚点预览（`fmtReadPreview` 默认上限 `DEFAULT_MAX_LINES=2000` 行、单行 200KB）——对整文件写是过度供给。裁决：write 结果**仅返回动作确认（+ 可选新 tag 头）**，内容核实由 agent 主动 read；write-hook 回放砍掉或降级为确认行。

### 7.4 locator 去 session 化（裁决）

- 键 = **canonical 绝对路径（现成键，零新增）**：全部状态表本就以 `resolveTarget()` 的绝对路径为主键——`snapshots(path PRIMARY KEY)`、`undo(path PRIMARY KEY)` 现状即无 session；唯一 session 化的 `served` 去 `session_id` 列、PK 改 `(path)`，drift `reported` 列随行走。绝对路径单机全局唯一，集中单库不撞键。**不引入 CWD basename 前缀**（第三轮复核裁决）：模型面 locator（行级 3-char 锚）永远伴随 edit 调用的显式 path 参数使用，不存在"裸 hash 找文件"的 surface，前缀列零收益——minimal effort 即删列。
- 全量哈希（xxh64 `contentChecksum`）仍是内容身份，现库 checksum 命中原样保留；跨会话共享同 path 的 served 行是期望行为（内容权威下"谁看过"无判定义务）。随键清理：`wipeServedState(sessionKey)` 删除；`SERVED_TTL_MS` 7 天 TTL 按 `updated_at` 照常 prune（`hash-store.js:488`）。迁移 = `HASH_STORE_VERSION` 6→7 重建 served 表；旧 12 个点目录弃置（TTL 反正清空，不作数据导入）。
- **§5 建议 3（改用 conversation/root id 作键源）作废**：host session id 引入 fork/子代理嵌套等不可控复杂度，被本节 path 键方案整体取代。建议 1（content-match 快道）与本节合流：内容即权威，served 出处账本对校验不再必需（undo/echo 归属另议）。

### 7.5 存储布局："到处拉屎"（裁决：集中化）

- 现状：`configDir(cwd)` 把 `hash-store.sqlite` 落在每个 workspace 下，实测 **12 个 workspace 各一份**（base 1.4MB、dashr 6.1MB+4MB WAL、superd/research/dsh-omp/browser-agent/temp/agent-harness/kb-dev/sidecarx/SoftEng/orchestra …）。
- 裁决（第三轮精化）：迁移到 **`$DSH_HOME/storages/dsh-better-edit/hash-store.sqlite`**。`storages/` 是宿主状态数据区（workspace.json / message_feedback.json / session_projcache），语义对口；实测 `~/.dsh/plugins/dsh-better-edit/` 是安装脚手架位（README/code/cordis/minimal/standard），代码里原"无 cwd 兜底"指向 `plugins/` 属语义错位，一并修正。实现 = `configDir(cwd)` 删除 cwd 分支，统一走 `resolveDshHome()`（感知 `DSH_HOME` → 4999 测试线 `.dsh-test` 自动隔离）。

### 7.6 修复批次合并

§7.2–§7.5 与原 §5 建议 1/2/4 合并为**一个 openspec change**（暂名 `hashline-content-locator`）：内容寻址 locator + 集中存储 + write 回放解耦 + 多 tuple 失败文案修正。回归断言沿用 §6，另加：write→（fork 会话）→edit 应直接成功；`.dsh_better_edit/` 不再新建；上游 `~/.dsh` 下单库增长可观测。

### 7.7 渊源备注

better-dsh vendored 头注自述 *"a dsh port of pi-hashline-edit-lsz"*（pi 系 = OMP 同族，即用户所称 "BetaEdit" 分支）。两支同源已分岔：OMP = 整文件快照 + 4-hex tag + session 级内存 store；DSH 分支 = 3-char 行锚（62³ 文件内唯一分配）+ (session,path) served 账本 + per-workspace SQLite。本次裁决实质是把 DSH 分支的校验权威从"会话出处"迁回 OMP 所在的"内容快照"一边，存储形态再叠加集中化。

---


## 8. 落地回执（v0.2.3b，2026-09-08）


§7 五项裁决已实现并实测：change `openspec/changes/2026-09-08-v0-2-3b-hashline-content-locator/`；
单测 `test/hashline-store.spec.ts` 12/12；4999 第一人称实测见
`v0.2.3b-hashline-content-locator实测报告.md`。要点：中心库落位
`.dsh-test/storages/dsh-better-edit/`（served 表无 session_id 列）、write 无回放、
内容快道在账本未见时直接放行；实测发现宿主 `dsh-fs-observation-policy` 的
`E_NOT_OBSERVED`（read-before-edit）为跨会话 edit 的另一道设计内守卫，予以保留。
发布闸：a 实测 ✅ / b 报告 ✅ / c user 确认 ⏳。

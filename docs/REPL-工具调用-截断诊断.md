# REPL 工具调用截断诊断（v0.2.1b 实测中发现，2026-09-01）

## 结论先行

**任何从 REPL（`eval` cell）内部发起的工具调用（`tool.<name>(...)`）都会让 dsh web daemon 进程崩溃并自动重启；会话日志在 `tool/code-dispatch-start` 处撕裂，恢复时 repair 机制合成「interrupted-tool-result」，模型看到的即「工具调用被截断、结果未知」。** 4 次探针 4 次复现，与 journald 守护进程崩溃记录逐条对应。

这不是 REPL 同步/异步的问题，也不是 subagent 特有问题——是 dashr 子分派桥接层的结构性缺陷 + 部署运行态注册表视图缺 symbol 的直接原因叠加。

## 一、复现矩阵（第一人称）

| # | cell 内容 | 结果 |
|---|---|---|
| 1 | `await tool.subagent({… run_in_background: false })` | 截断（daemon 崩溃 17:39:17） |
| 2 | `await tool.subagent({… run_in_background: true })` | 截断（daemon 崩溃 17:41:15） |
| 3 | `await tool.bash({… run_in_background: true })` | 截断（daemon 崩溃 17:57:05） |
| 4 | `await tool.read({path: "dashr/package.json"})` | 截断（daemon 崩溃 18:02:27） |

对照：纯 Python cell（`dir(tool)`、顶层 `return` 判错、`await asyncio.sleep(0)`）全部正常。**凡含 `tool.*` RPC 的 cell 必崩，与工具、与 background 与否无关。**

## 二、截断面定位（三层证据）

### 1. 会话日志（`~/.dsh/sessions/…/session.jsonl.zstd`）
4 次截断的共同指纹：`tool/call (eval)` → `tool/code-dispatch-start`（**已持久化**）→ 日志撕裂（无 `tool/code-dispatch`、无 `step/end`/`turn/end`）→ 重载时 `packages/core/session/src/repair.ts` 的 `interruptedTurnClosers` 合成 `interrupted-tool-result-<callId>-<seq>`（`TOOL_OUTCOME_UNKNOWN`）。会话内 **0 条 error 事件**——错误根本没走到会话层。

### 2. 守护进程日志（`journalctl --user -u dsh.service`）——铁证
```
Sep 01 17:39:17 pnpm[414449]: dsh: fatal load failure: TypeError: Cannot read properties of undefined (reading 'prepare')
    at Object.start (…/better-dsh/lib/index.js:11281:41)
    at <anonymous> (…/lib/index.js:11191:21)
    at drive (…/lib/index.js:11207:7)
    at outcome (…/lib/index.js:11310:6)
    at new Promise (<anonymous>)
    at toolFunctions.<computed> (…/lib/index.js:11320:72)
    at Proxy.dispatchHostRequest (…/lib/index.js:2180:21)
Sep 01 17:39:19 systemd: dsh.service: Main process exited, code=exited, status=1/FAILURE
Sep 01 17:39:23 systemd: dsh.service: Scheduled restart job, restart counter is at 1.
```
17:39:17 / 17:41:15 / 17:57:05 / 18:02:27 四次崩溃，栈完全一致。`scheduler.prepare` 中 `scheduler` 为 `undefined`——即 `registry[TOOL_RUNTIME_SCHEDULER]` 在部署运行态取不到值。

### 3. 源码链（`dashr/src/index.ts`）
- kernel 侧：`tool.<name>(...)` → `binding.call` RPC（`src/bootstrap.ts` `_dashr_callable`）。
- host 侧：`dispatchHostRequest`（`src/runtime.ts:545`）→ `await fn(args)`（`src/index.ts` `binding()`）。
- `binding()` 内部（`src/index.ts:666`）：`const scheduler = registry[TOOL_RUNTIME_SCHEDULER]` → 单驱动道 `drive()`（`src/index.ts:591-621`）→ `start()` 内 `await scheduler.prepare(input)`（`src/index.ts:712`）。
- **结构性缺陷**：`drive()` 的 async IIFE 是 `try { … } finally { … }`，**没有 catch**；调用处是 `void drive()`。任何 `start()`/`commit()` 抛错（如 `scheduler.prepare` TypeError）都会变成 **unhandled rejection**——binding promise 既不 resolve 也不 reject，cell 永久挂起，错误外泄给进程。
**完整链条**：cell 工具调用 → dispatch 启动（`code-dispatch-start` 已入日志）→ `registry[TOOL_RUNTIME_SCHEDULER]` 为 undefined → `scheduler.prepare` TypeError → driver 无 catch → unhandled rejection → `installFailLoud` 判定 fatal → daemon exit(1) → systemd 重启 → 会话重载 repair 合成「interrupted-tool-result」→ 模型收到截断消息。**截断面：binding 桥 → registry symbol 查询 → driver 的未处理拒绝。**

## 三、命名澄清：REPL dispatch log 与 code-dispatch 是两个不同层（重要）

容易混淆，先分清：

| 名字 | 层级 | 是谁 | 本次 change 是否改名 |
|---|---|---|---|
| `tool/code-dispatch-start` / `tool/code-dispatch` | **会话持久日志事件**（durable log，`agent.session.append`） | dashr `src/index.ts:689,712`；harness `known-event-types.ts:63-64` 注册 | **否**——v0.1.x 就有，历史遗留名 |
| `dashr/repl-dispatch-log` | **waterfall 扩展点**（内容整形监听事件） | dashr 自注册（`src/index.ts:458`） | **是**——v0.2.1 从上游 `tools/code-dispatch-log`/`tools/ptc-dispatch-log` 改名为「自己的 REPL dispatch log」 |
| `tools/ptc-dispatch-log` | waterfall（上游 PTC 用） | harness `src/ptc.ts:282` + spill policy 监听（`spill-policy/src/index.ts:217`） | dashr 已不再 emit（仅注释提及） |

**结论**：
- 「自己的 REPL dispatch log」`dashr/repl-dispatch-log` **在代码里存在且自注册**——目标形态已就位。它之所以「没被触发」，是因为崩溃发生在它之前的 `scheduler.prepare`（它在 settle 之后才跑）——**是崩溃的结果，不是原因**。
- 会话日志里我用作定位证据的 `tool/code-dispatch-start` 是**持久日志事件名**，与 waterfall 改名无关，只是「撕裂点之前最后一条已写入事件」的定位标记。
- 改名引入了一个**真实但非崩溃的副作用**：harness 的 spill policy 仍监听上游 `tools/ptc-dispatch-log`，dashr 不再 emit → 溢出限幅（oversized 结果的 preview+locator 替换）对 eval 子调用日志**静默失效**。**已补（2026-09-01 晚，见六）**：dashr `shapeDispatchLog` 跑完 `dashr/repl-dispatch-log` 后，再把同一 dispatch（载荷结构与上游 `PtcDispatchLog` 完全一致）喂进 `tools/ptc-dispatch-log` 载体，spill 臂恢复生效。改动在 `dashr/src/index.ts`，lib 已重建（`f0febba7…`），**部署位同步 + daemon 重启待用户执行**。

## 四、为什么 `registry[TOOL_RUNTIME_SCHEDULER]` 是 undefined（直接原因）


- 已排除：dsh-tools 双副本 symbol 不一致（实测插件与 daemon 均解析到同一 realpath `/home/u1/workspaces/dsh-alpha/packages/core/tools`，symbol 严格相等）；dashr 分派代码改动（266d232/06e516a/HEAD 逐字节一致）；dsh-tools alpha.1 vs alpha.3 差异（仅 import 整理/ToolCallId brand 等外观差异）。
- 关键观察：`classify()` 调用的 `registry.executionMode(input)` **正常**（`code-dispatch-start` 已写入日志，证明 `start()` 之前的分派逻辑跑通），而 `registry[TOOL_RUNTIME_SCHEDULER]` **取不到**。`executionMode` 是 ToolRuntime 类方法、`TOOL_RUNTIME_SCHEDULER` 是类实例 symbol 字段——即部署运行态 `runtimeCtx.tools` 返回的**不是原生 ToolRuntime 实例**，而是一个有方法、缺实例 symbol 字段的服务视图（cordis 作用域服务解析 / plugin tree 挂载路径差异）。
- 测试为什么全绿：dashr 测试组合（`test/helpers.ts`）把 `ctx.tools` 解析到**根作用域的原生 ToolRuntime 实例**，symbol 在位；生产组合经 harness plugin tree / scope 层解析，拿到的是视图。
- **何时坏的（重要修正）**：v0.1.8 实测报告（2026-08-24）实证 DASHR 自己的 `eval` 桥当时**正常工作**——同 cell 并发 `tool.read` + `tool.bash` 完成。2026-08-28 会话用的是 harness 自带 PTC `run_cell`（`tools.bash`，复数命名空间 = PTC SDK 形态；该 PTC 核心经 `@deepseek-ai/dsh-code-runtime-python` 执行 **Python**，非 TS），不能代表 dashr 桥状态。**崩溃由 2026-09-01 的 harness alpha（0.1.2-alpha.1）升级引入**——升级后 plugin tree 里 `runtimeCtx.tools` 变成缺实例 symbol 字段的服务视图；dashr v0.2.1 的 dispatch-log 改名不是崩溃原因。

## 五、REPL 同步/异步问题的回答（顺带闭环）

- 模型层：`eval` 是同步工具调用，模型等 cell 结果——这是设计使然，与缺陷无关。
- cell 内：`tool.<name>(...)` 是 kernel→host 的 `binding.call` RPC，被 cell `await`；host 经与原生调用同一 registry 分派器执行。`run_in_background: true` 的工具实现**快速返回 id**（subagent `{kind:'continuable', subagentId}`、bash 返回 job id），background 语义本应保留、子任务与 cell 结束无关。
- 但**当前运行时该路径整体坏掉**：任何子分派在 `scheduler.prepare` 即 TypeError，与 background 无关——所以「在 REPL 里 background 是否异步」目前是伪问题，路径不通；修好后 background 语义会按上述设计成立。

## 六、修复方向（分层）

1. **dashr 立即修（阻断 daemon 崩溃）**：`drive()` 加 catch / `start()`、`commit()` 失败必须 settle binding promise 为错误结果——cell 内工具调用失败应变成可见的 `ToolCallError`，**绝不允许以 unhandled rejection 外泄杀 daemon**。这是把「任何分派错误」放大成「整个运行时崩溃」的放大器，无论直接原因是什么都必须先修。
2. **dashr 防御**：`registry[TOOL_RUNTIME_SCHEDULER]` 为 undefined 时抛带上下文的 loud 错误（cell 可见），而不是裸 `undefined.prepare` TypeError。
3. **根因定位（harness 接线）**：在活体 daemon 上探针确认 plugin tree 中 `runtimeCtx.tools` 的实际对象（cordis 作用域服务视图 / 第二个 tools 实例），修正挂载使插件拿到原生 ToolRuntime（symbol 在位）。这一步需要 daemon 侧可写环境（本会话 bwrap 沙箱只读宿主，无法直接探查活体）。
4. **测试补强（部分完成）**：已加「`tools/ptc-dispatch-log` 载体回喂」回归用例（`test/bridge.spec.ts`，全量 396 绿）。仍缺「生产形态」挂载测试——按 harness 的 plugin-tree/scope 方式挂载插件，断言 `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 已定义 + 一个真实工具 RPC 从 cell 完成；防止此环境差异回归。
5. **回归核验基线**：修复后重跑本文档第一节的 4 探针矩阵（4/4 应全部返回结果而非截断），并观察 `journalctl --user -u dsh.service` 无新崩溃。

## 附：证据文件
- 会话日志：`~/.dsh/sessions/--home-u1-workspaces-dashr--/session-ad9ac311-3400-4304-b501-e7303da850df/session.jsonl.zstd`
- 守护进程日志：`journalctl --user -u dsh.service`（17:39:17 / 17:41:15 / 17:57:05 / 18:02:27 四条 fatal load failure）
- 对照工作会话：`06ac8b2c-fb2e-458f-80d6-a0d28e50f193`（2026-08-28，9 对完整 code-dispatch，PTC run_cell 路径）

---

## 七、v0.2.1c 修复执行记录（2026-09-01，change v0-2-1c-repl-tool-crash-fix）

### 六.1 + 六.2 已实现（dashr 侧）

- `drive()` async IIFE 补 `catch`：lane 级 backstop——任何逃逸 start()/commit() 自身包裹的错误（或 classify() 抛错）settle 所有 queued-but-unsettled 分派为可见错误、清空队列、复位 exclusive、记 warn，**绝不外泄 unhandled rejection**。
- `PendingDispatch` 新增 `fail(error)`：把 binding promise settle 为 `{ isError: true, message }`（经 `settleError` → `settle`，kernel 转 `ToolCallError`）。
- `start()` / `commit()` 各自 try/catch：prepare 失败、dispatch body rejection、finalize/finish 失败都 settle 自己的 binding，不再向 lane 抛。
- `binding()` 内 `registry[TOOL_RUNTIME_SCHEDULER]` 判空：undefined 时抛带上下文的 loud 错误（点名 symbol、指向 harness 挂载接线），替代裸 `undefined.prepare` TypeError。
- 回归测试 3 个（`test/bridge.spec.ts`，全量 399 绿含 3 新）：view 缺 symbol → cell 收到含 `TOOL_RUNTIME_SCHEDULER` 的 loud 错误；`scheduler.prepare` 抛错 → binding settle 为可见错误；classify 抛错 → lane backstop settle 且进程存活。

### 六.3 根因探针（本轮结论，待活体 daemon 复核）

- **根因已锁定并更正（2026-09-02 活体探针 + 受控实验；推翻本节 2026-09-01 的 shadow 分支推断）**：真实根因是**部署拓扑 dual-copy**——崩溃期（2026-09-01 17:39–18:02）部署位插件嵌套 `node_modules/@deepseek-ai/*` 的 17 条 symlink（已退役 dev 接线）指向 dsh-alpha 源码树，插件 import 的 `TOOL_RUNTIME_SCHEDULER` 来自 alpha 副本的 dsh-tools 模块实例；daemon 的 `ToolRuntime` 实例由 host vendored 副本构建，其 symbol 字段以 host 副本 symbol 为键。两 symbol 为不同 `Symbol()` 实例：跨副本读实例字段 → `undefined`（`executionMode` 等字符串键方法不受影响、照常工作——症状逐字吻合）。
- 证据链（2026-09-02）：① 活体 4 探针（`tool.bash` fg/bg、`tool.read`、`tool.subagent` bg:false/bg:true）经 `eval` cell 路径 4/4 真实结果——现行生产形态 symbol 在位；② 部署位 `require.resolve('@deepseek-ai/dsh-tools')` = `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js`（host vendored，③→④ 层）；③ 受控实验：host 与 z_dsh-alpha 两副本 `TOOL_RUNTIME_SCHEDULER` 严格不等，host 键实例经 alpha symbol 读 → `undefined`、经 host symbol 读 → object；④ 时间线闭环：改名 `dsh-alpha → z_dsh-alpha`（2026-09-01 22:29）→ symlink 悬空 → 2026-09-02 清理删除 → daemon 重启 → 自愈。
- shadow 分支理论为何被否：它与症状吻合但从未被活体证实，且无法解释「拓扑清理 + 重启后自愈」；dual-copy 机制同时解释故障与恢复。v0.2.1c 报告引「symbol 严格相等」的排除测量与崩溃期拓扑矛盾（疑测同一副本两次或取于改名后），以直接证据为准。
- cordis traceable proxy 本身无嫌疑（symbol 转发分支在位；现行活体 plain read 即返回带 symbol 原生实例）。
- dashr 侧交付边界：六.1+六.2（不崩溃 + loud 错误）继续有效；dual-copy 已由部署拓扑收敛消除（部署纪律：插件 `node_modules/@deepseek-ai/` 只留 `schemastery`+`cosmokit`）；v0.2.1d 给 guard 错误附 dsh-tools 解析路径实现事件自诊断。
### 六.4 生产形态挂载测试（说明）

- 三个回归用例以「缺 symbol 视图」「prepare 抛错」「classify 抛错」三种形态驱动 `createRunCellTool`，覆盖六.1+六.2 全部防御面；测试组合（根作用域原生实例）本就 symbol 在位，断言 `runtimeCtx.tools[TOOL_RUNTIME_SCHEDULER]` 定义的用例属于测试组合自身形态（根挂载原生实例），无法复现生产 realm 差异——该差异须在活体 daemon 上复核（六.5）。

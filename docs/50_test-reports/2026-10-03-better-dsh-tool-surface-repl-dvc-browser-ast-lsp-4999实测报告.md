# better-dsh 0.2.5-a 工具面实测报告：REPL / dvc://browser / dvc://ast_grep / dvc://ast_edit / dvc://lsp（4999 rig）

> **状态**：第一人称实测完成（agent 在真实 4999 会话内自测并留证）。
> **性质**：工具面**冒烟 + 回归**，**不是**发布验收——本轮未走 AGENTS.md §〇 的 a–d 发布闸，
> 不涉及也不授权 `npm publish`。
> **被测版本**：better-dsh `0.2.5-a`（package.json 与 profile 实装双侧一致）；core `@deepseek-ai/dsh` `0.2.0-rc.2`。
> **仓库 commit**：`fb49834`（根仓与 `better-dsh/` 同 SHA）。
> **rig**：`.test/home/compat`，端口 4999，unit `dsh-4999-test123`；本轮**未重启、未改产物、未动 prod**。
> **时间**：2026-10-03 01:40–01:56 HKT（2026-10-02 17:40–17:56 UTC）。
> **相关前序**：[2026-09-27-lsp-ast-reminder-4999实测报告.md](2026-09-27-lsp-ast-reminder-4999实测报告.md)（lsp/ast 提醒的发布轮）。

---

## 0. 方法

- 全部证据取自**本会话内的真实工具调用**（第一人称），非单测、非静态检查、非进程活性。
- `dvc://` 设备经 `write dvc://<device>` 执行，`read dvc://<device>` 仅取用法；REPL 证据取自 `eval` 单元。
- 临时产物集中在 `.scratch/ast-probe/`；browser 设备测毕已 `close`（无孤儿 Chrome）。

## 1. 结论摘要

| # | 面 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | REPL（`eval`） | ✅ 全绿 | 跨 cell 状态、完成值、工具桥、错误信封、异常存活 7/7 |
| 2 | `dvc://browser` | ✅ 功能全绿；⚠️ 进不去带密码闸的 GUI | open/run/type+click/close + 字段白名单全通 |
| 3 | `dvc://ast_grep` | ✅ 可用；⚠️ 相对路径基准非 workspace | 15 命中、`metaVariables`、`offset/limit` |
| 4 | `dvc://ast_edit` | ✅ dryRun 与实写均正确 | `dryRun:true` 不落盘；`false` → `applied:true` 且盘面核实 |
| 5 | `dvc://lsp` | ✅ gate + diagnostics + hover 全绿 | TS2322 error + TS6133 hint，坐标精确 |
| 6 | AST 可用性提醒 | ✅ 实测出现 | `write` 结果尾行一行提醒 |

净结论：**四个 dvc 设备与 REPL 主体功能无回归**；发现 2 个可用性摩擦（F1/F2）与 1 个 API 面不一致（F3），
均非阻断，建议并入下一次批量发布（AGENTS.md §〇.5）。

## 2. REPL（`eval` / dashr-repl 桥）— 全绿

| 探针 | 结果 |
|---|---|
| 跨 cell 状态 | cell 1 设 `REPL_MARKER = "cell-1-alive"`，cell 2/4/6 读回一致 |
| 导入持久 | cell 3 `import asyncio, json, collections`，cell 4 仍绑定 |
| 完成值协议 | 末行裸表达式 `x`（=42）作为 completion value 返回，与 `print` 并存 |
| 工具桥 | `await tool.bash({"command": "echo bridge-ok"})` → `bridge-ok`，exit 0 |
| 错误信封 | 失败子调用抛 `ToolCallError`，`.toolName == "read"` |
| 入参校验 | `tool.read({})` → `[E_BAD_SHAPE] Read request requires a non-empty "path" string.` |
| 异常存活 | 内核在 SyntaxError、AttributeError 两次异常后仍持有全部状态 |
| 内核 | CPython `3.11.15`（profile 内 `.venv-kernel`） |

桥接口径与 wire description 一致（`await tool.<name>(args)` 单位置参数对象，`true/false/null` → `True/False/None`）。

## 3. `dvc://browser`

| 动作 | 结果 |
|---|---|
| `{"action":"open","url":"https://example.com"}` | `{ok:true, url, title:"Example Domain"}` |
| `{"action":"run","code":"…"}`（DOM eval） | 取回 `title/links/readyState`，JSON 字符串回传 |
| `{"action":"run","type":…,"click":…}` | 复合动作生效：`data:` 页 title 由 `t0` → `hello-dvc` |
| `{"action":"close"}` | `{ok:true}` |
| 未知字段 | `{"action":"open",…,"bogusField":1}` → `unknown field(s) "bogusField" for action "open" — allowed: "action", "url", "executablePath"` |

**⚠️ 限制（F2）**：指向本 GUI（`http://127.0.0.1:4999`）时，`?token=` 启动 URL **不能**为新浏览器铸出会话——
页面停在 `Enter the session password to continue. PASSWORD Unlock`，`window.__DSH_BOOT__` 不存在、
无任何 `better-dsh` 资源请求。因此 `dvc://browser` 目前**无法**用于对本 GUI 做端到端第一人称验收，
除非补一条 cookie 注入/免密通道。（本 rig 是密码闸实例；token 只负责首铸 cookie，而全新 Chrome 无 cookie。）

**方法学附注（假阳性预防）**：首轮 DOM 探针返回 `h1count: 0`，一度疑似设备缺陷；
核对线上原文后确认 **example.com 今日已无 `<h1>`**（仅 `<p>` + `<script>`），**设备是对的，探针是我的错**。
记录此条以防后续把同类现象误判为插件 bug。

## 4. `dvc://ast_grep`

| 项 | 结果 |
|---|---|
| 模式 | `defineTool($$$ARGS)`，`includeMeta:true` → 命中 15 / 13 文件 / 扫 189 文件，`limitReached:true` |
| 结构信息 | 每条含 `byteStart/byteEnd/startLine/startColumn/endLine/endColumn` + AST 级 `metaVariables` |
| 分页 | `offset:10, limit:2` → 精确返回 2 条（分页生效） |
| 语法错误容忍 | `defineTool({$$$})` 在 `defaults.json` 上语法不合法 → 该文件进 `parseErrors[]`，**整次搜索不失败**，其余 15 命中照常返回 |

**⚠️ 相对路径基准（F1）**：`path:"better-dsh/src"` → `Path not found: No such file or directory (os error 2)`；
改为绝对路径即通。决定性实验：**`path:"../../better-dsh/src"` 命中 15 条，与绝对路径结果一致**。
即 ast 设备的相对路径基准 = **harness 进程 cwd（`upstream/deepseek-harness`）**，而非会话 workspace
（`/home/u1/workspaces/dashr`）——与 `read/glob/grep` 的 workspace 基准**不一致**。
返回值里的 `path` 也用同一基准显示（`../../better-dsh/src/bridges/index.ts`）。
**规避**：始终传绝对路径。

## 5. `dvc://ast_edit`

输入（作用于 scratch 文件）：

```json
{"ops":[{"pat":"const $NAME = function ($ARG) { $$$B }","out":"function $NAME($ARG) { $$$B }"}],
 "paths":["/home/u1/workspaces/dashr/.scratch/ast-probe/sample.ts"],"dryRun":true}
```

| 项 | 结果 |
|---|---|
| `dryRun:true`（默认） | 返回 `before`/`after` 与字节区间 `byteStart:74, byteEnd:128, deletedLength:54`；**`applied:false`，盘面未变** |
| `dryRun:false` | 同区间，**`applied:true`**；盘面核实：`const legacy = function (x: number) {…}` → `function legacy(x: number) { return x * 2 }` |
| `fileChanges`/`totalReplacements`/`filesTouched` | 1 / 1 / 1，与 `limitReached:false` 自洽 |

`paths` 同样受 F1 影响（本轮用绝对路径，未复现相对路径问题）。

## 6. `dvc://lsp`

| 步骤 | 结果 |
|---|---|
| 初始 `status` | `{ok:true, gate:"unasked"}` —— per-session 闸，未询问态 |
| `{"action":"on"}` | `{ok:true, gate:"on", message:"lsp on for this session: servers warm-start per language on first file contact; no repo artifacts are written."}` |
| `diagnostics`（植入 2 处错） | `server:"typescript-language-server"`，自动推断 `root`；返回 **TS2322 error**（`Type 'number' is not assignable to type 'string'`，4:3）+ **TS6133 hint**（`'unusedVar' is declared but its value is never read.`，1:7）；`summary:"1 error(s), 1 hint(s)"` |
| `hover`（3:17） | ```typescript\nfunction bad(x: number): string\n``` |

坐标与 `severityName`（error/hint）均正确；服务器来源为 `typescript-language-server`。

## 7. AST 可用性提醒 — 实测出现

对新建 `.ts` 文件执行 `write`，结果尾部实测出现：

```
ast_edit / ast_grep available — write dvc://ast_edit (structured rewrite) or dvc://ast_grep (pattern search)
```

与前序报告的制度一致（提醒挂 `write/edit/grep` 结果尾部、per-session cap）。
**注**：本轮未观测到 **LSP nag**（在接触代码文件前已把 gate 置 `on`，`unasked` 条件不再成立），故 nag 路径未覆盖；
提醒的 **cap 计数**本轮亦未触及边界（未做 >5 次触发）。

## 8. 发现清单

| ID | 严重度 | 面 | 现象 | 建议 |
|---|---|---|---|---|
| **F1** | 中（摩擦） | `dvc://ast_grep`/`ast_edit` | 相对 `path` 基准 = harness 进程 cwd（`upstream/deepseek-harness`），非会话 workspace；`"better-dsh/src"` 直接 `Path not found` | 二选一：①基准改为 workspace / `exec.cwd`；②保持现状但在 device help 明写"仅收绝对路径" |
| **F2** | 中（能力缺口） | `dvc://browser` | 无 cookie 注入通道，进不去密码闸 GUI；`?token=` 不足以对新浏览器铸会话 | 若要支撑 GUI 端到端第一人称验收，需补 cookie/免密通道 |
| **F3** | 中（API 一致性） | `llm_completion` | **返回类型不稳定**：成功回 **裸 `str`**（`'alpha beta gamma'`），失败回 **`dict`**（`{"error":"llm_completion() output reached its maxTokens ceiling"}`）；调用方 `r["text"]` / `r.keys()` 会炸 | 统一为判别式对象（`{ok:true,text}` / `{ok:false,error}`） |
| **F4** | 低（调优） | REPL 子调用池 | 变更类子调用实际**串行**：4×`sleep 1` = 4.78s；6×`glob` = 14.71s。源码有 `maxParallelSubCalls`（默认 10）与 `parallel\|exclusive` 分类，但观测未见并行收益 | 复核 classify 是否把常用工具过度判为 `exclusive` |
| **F5** | 低（体验） | `llm_completion` | `maxTokens` 偏小（16）时因推理吃掉预算而**整次失败**而非截断 | 考虑截断或给出可操作的错误提示 |
| — | 观察（正面） | harness | 连续 5 次同参调用触发**重复调用护栏**并阻止了潜在死循环 | 保留 |

## 9. 未覆盖 / 遗留

- `dvc://lsp` 的 `references` / `definition` / `format` / `rename` / `code_actions` / `reload` 未在本轮复测
  （2026-09-27 报告已全绿；本轮只补 `status`/`on`/`diagnostics`/`hover`）。
- LSP **nag 路径**与 AST 提醒 **cap 边界**未覆盖（见 §7）。
- `dvc://ast_edit` 相对路径未复测（F1 已在 `ast_grep` 上定位）。
- `agent` / `agent_message` / `agent_workflow` / `remote` / 各 URL scheme（`ctx://` `skill://` `dsh://`）
  本轮未测（不属本次指定的工具面；`ctx://` 另有 2026-10-02 专项报告）。
- 生产 3080 **未部署验证**（本轮纯 4999，未触碰 prod）。

## 10. 复现命令

```bash
# REPL：在任意 4999 会话内
#   eval: REPL_MARKER = "cell-1-alive"   →  下一 cell: print(REPL_MARKER)

# ast_grep（务必绝对路径，或按 F1 用 ../../ 相对 harness 根）
#   write dvc://ast_grep {"patterns":["defineTool($$$ARGS)"],
#     "path":"/home/u1/workspaces/dashr/better-dsh/src","limit":5,"includeMeta":true}

# ast_edit dryRun → 实写
#   write dvc://ast_edit {"ops":[{"pat":"const $NAME = function ($ARG) { $$$B }",
#     "out":"function $NAME($ARG) { $$$B }"}],
#     "paths":["<abs>/sample.ts"],"dryRun":true}     # 再 dryRun:false 并 cat 盘面

# lsp
#   write dvc://lsp {"action":"status"}              # → gate:"unasked"
#   write dvc://lsp {"action":"on"}                  # → gate:"on"
#   write dvc://lsp {"action":"diagnostics","file":"<abs>/diag.ts"}
#   write dvc://lsp {"action":"hover","file":"<abs>/diag.ts","line":3,"character":17}

# browser
#   write dvc://browser {"action":"open","url":"https://example.com"}
#   write dvc://browser {"action":"run","code":"document.title"}
#   write dvc://browser {"action":"close"}
```

## 11. 附：本轮环境事实

| 项 | 值 |
|---|---|
| better-dsh | `0.2.5-a`（package.json ≡ profile 实装） |
| core | `@deepseek-ai/dsh` `0.2.0-rc.2` |
| commit | `fb49834` |
| rig home | `.test/home/compat` |
| 内核 | CPython `3.11.15`（`.venv-kernel`） |
| LSP 服务器 | `typescript-language-server` |
| browser 引擎 | Chromium（`puppeteer-core`，UA 含 `HeadlessChrome`） |

> 注：`readlink /proc/<pid>/cwd` 在本沙箱内取不到 4999 进程的 cwd（进程在另一命名空间），
> F1 的基准结论由**路径算术实验**（`better-dsh/src` 失败 vs `../../better-dsh/src` 全量命中）独立钉死，不依赖该读法。

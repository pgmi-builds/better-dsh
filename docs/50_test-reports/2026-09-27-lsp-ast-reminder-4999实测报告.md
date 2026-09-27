# v0.2.4-b（未发版 HEAD）LSP mount 修复 + AST 可用性提醒 4999 实测报告

> 状态：**第一人称实测通过**（user 真实会话，2026-09-27）；报告落位 = 发布闸 b 完成。
> 发布闸 c（user 单次确认发包）**待定**。
> 变更：change `2026-09-26-lsp-ast-reminder`（commit `f92a7cc`，含此前 HEAD 上未发布的
> `agent/created` mount 修复 `ce0541c`）；计划 `docs/10_plans/2026-09-26-lsp-ast-reminder.md`。

## 1. 被测内容

| 项 | 内容 |
|---|---|
| LSP gate mount 修复 | per-agent 安装事件 `agent/session-start`（0.1.7 已死）→ `agent/created`；修的是"hook 从未装上" |
| AST 可用性提醒 | `write/edit/grep` 结果尾部一行 `ast_edit / ast_grep available — …`；per-session cap 5（write/edit/grep 共享预算，agent dispose 重置）；语言范围 = AST 自身 grammar 能力面（实测探针：py/js 家族/rs/go/c-cpp-h/html/css/json/yaml/sh/rb；排除 .md 与未证实 grammar），与 LSP 表解耦 |
| 交付形态 | 新规范（guide §4.2）：`npm pack` → `plugin remove` → `plugin add tarball`；rig `test123`（`.test/home/compat`） |

## 2. 构建卫生（agent 侧）

- 单测 **621 passed + 1 skipped**（新增 ast-reminder 单测 + post-execute 钩子级测试）
- `tsc --noEmit` host + client **0 错**；`npm run build` 干净
- rig 重启后 boot graph 含 `better-dsh`；cookie 认证 200（新规则 §3.3 生效实证）

## 3. 第一人称实测（user，2026-09-27，rig 4999 真实会话）

**三个设备全绿**（user 实测原文要点）：

- **ast_grep** ✅：`owners.set($K, $V)` 命中 2 处，含位置与 `metaVariables`；
- **ast_edit** ✅：dry-run 正确计算替换区间不落盘；`dryRun:false` 实改 scratch 文件
  `add($A, $B)` → `add($B, $A)` 一次换两个调用点，`applied: true`，盘面核实后清理；
- **lsp（typescript-language-server）** ✅：diagnostics（精确命中 2×TS6133）/ hover
  （返回接口 + doc comment）/ references（3 处，跨文件）/ definition / format
  （`changed: true`）/ reload / status 全通。

**提醒链路（agent 侧客观证据，rig session log）**：user 验收会话
`session-d33f5db1`（superd workspace）工具结果尾部实测出现
**LSP nag ×1 + AST 提醒行 ×1**——mount 修复 + 提醒链路在真实运行时生效的直接证据。
（另一会话 `session-c8472342` 的 15 次 AST 行属**旧无 cap lib** 时段（今晨 04:59–05:08
HKT，早于调优构建 16:19 HKT），非 cap 违规；新 lib 时段计数正常。）

## 4. 实测学到的 gotcha（攒批处理清单）

| # | 现象 | 候修 |
|---|---|---|
| G1 | **LSP 冷启动竞态**：server spawn 后首次 hover/references/definition 返回空（`text:""`/`locations:[]`），diagnostics 可预热，reload+重试确认 | 设备侧查询前 ensure/等待就绪，或空结果附 retryHint |
| G2 | **ast_grep/ast_edit 要求绝对路径**：workspace 相对路径 ENOENT | 相对路径按 workspace cwd 解析 |
| G3 | **lsp write 必须 `action` 字段**：usage 字符串的 `read:` 选择器语法易误导（`status`/`diagnostics?file=` 是 read 面） | usage 文案补 write 契约示例 |
| G4 | **`plugin remove` 曾停掉运行中的 rig unit**（journal "Stopping" 恰在 remove 时刻，观察 1 次） | 查 CLI remove/reconcile 是否有停 unit 副作用 |

## 5. 发布闸状态

- a. 4999 第一人称实测 ✅（本文 §3）
- b. 报告落位 ✅（本文）
- c. **user 单次确认发包：待定**。HEAD = `v0.2.4b` + 19 commits（含 0.1.7 对齐修复、
  本 change）；下一版号建议 `0.2.4c`（字母顺延），批量携带 G1–G4 修复与否由发布时定。

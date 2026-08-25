## Why

DASHR 目前只有「工具面」（flat `tool.*` + `eval`），没有「资源层」：模型要读 skill 正文、子 agent 输出、harness 配置或运行时上下文，只能走一次性动作（action）——`skill({name})` 工具调用，或伸手进 `eval` 的 kernel 里 `print()` 变量。上游 OMP 已证明另一条路：把资源放进 URL 空间、用 `read`/`write` 统一寻址，工具面保持扁平、模型零额外学习成本（它本来就认识 read）。这是「Better Dash」从插件走向完整 App 的基础设施层，对应 distro-blueprint §2.1 的「URL Schema 基础设施层」。

## What Changes

- 引入统一 URL resolver 基础设施：`read`/`write`/`grep`/`glob` 接受 `scheme://` URL，按 scheme 路由到 handler，共享同一套 selector 语法（`:50-100`、`:raw`、`/path`、`?q=`）。
- 新增 5 个 scheme（各成一个 capability）：
  - `skill://` —— skill 正文 + skill 内部资源寻址。
  - `agent://` —— 合并 agent 名册（roster）、输出 artifact、`/transcript`（吸收上游 `history://`）。
  - `dsh://` —— harness 文档 + app-level 生效配置/环境（静态自描述）。
  - `ctx://` —— 运行时状态 + context-as-variable（内核变量读写）。
  - `xd://` —— 设备执行面占位（空 scheme，暂不挂载任何 device，handler 返回「no devices mounted / unknown device」）。
- **BREAKING**：mask 上游 `skill` 工具，skill 寻址改走 `skill://`（本地 filesystem provider 覆盖；remote/embedded provider 列为已知缺口）。
- **BREAKING**：`history://` 语义并入 `agent://`，不再单开 history scheme。
- 不做（记录为边界）：`local://`（丢弃——直接传文件路径零摩擦，边际收益极小）、`artifact://`（留 hook——spill locator 已是可读路径，涉云时再上 scheme）、`vault://`（Work 模式）、`rule://` / `issue://` / `pr://`。

## Capabilities

### New Capabilities
- `url-schema`: 统一 URL resolver 基础设施（scheme 路由 + read/write/grep/glob 注入 + selector 语法）。
- `skill`: `skill://` 资源寻址。
- `agent`: `agent://` 名册 / 输出 / transcript 合并寻址。
- `dsh`: `dsh://` 文档 + 配置/环境自描述。
- `ctx`: `ctx://` 运行时上下文 + context-as-variable。
- `xd`: `xd://` 设备执行面（空，占位）。

### Modified Capabilities

（无 —— 本仓库首个 openspec change，无既有 specs。）

## Impact

- 新增插件层 URL resolver（落点与 `dashr-repl` 的关系在 design.md 定）。
- vendor BetterEdit hashline 进 DASHR 包（`src/vendored/`，署名 Rianico/dsh-better-edit + pi-hashline-edit-lsz），DASHR `read` 工具合一为「URL 路由 + hashline」一个实现两条分支；write/grep/glob 走 URL 路由（无 hashline 冲突）。
- mask 上游 `skill` 工具（presentation 层，复用 DASHR 已有 masking 机制）。
- 依赖：`ctx.skills`（skill 解析）、`dsh-subagent`/session（agent 名册与输出）、`dsh-settings`/`dsh-launch-environment`（`dsh://` 配置）、内核 query/set 通道（`ctx://` 变量读写，需内核协议新增消息类型）。

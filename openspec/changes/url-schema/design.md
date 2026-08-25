## Context

动机见 proposal.md - Why。本设计只讲「怎么做」。

关键现状与约束：

- dsh 工具执行流水线（`dsh-agent-loop` README）：`tools/pre-execute`（deny/ask）→ `tools/execute` → `tools/post-execute`（result decisions）→ `tools/result`。**`pre-execute` 只能拒绝/询问，不能返回内容；`post-execute` 才能替换结果；`execute` 不可扩展。**
- `read`/`write` 在 `dsh-tool-fs`，`grep`/`glob` 在 `dsh-tool-fs-search`，都是上游，DASHR 不能 patch（distro 原则：rebranding §5.4）。BetterEdit shadow `read`/`edit`/`batch_edit`/`undo_last_edit`；**不替换 `write`**（`write` 保留原生，只挂 write-hook 装饰结果），grep/glob 也不受影响。
- BetterEdit 证明了一件事：**agent-scope 工具 shadow 可行**——它在 agent 自己的 scope 层注册同名 `read`/`edit`，全量自实现（走 `ctxFsIO`，不委托原生），「nearest layer wins」。
- DASHR 已有 presentation-layer masking 机制（mask 过 `send_message`/`report`）。
- dsh 侧现成底座：`ctx.skills`（skill 注册表）、`dsh-subagent`/session（agent 名册与输出）、`dsh-settings`/`dsh-launch-environment`（配置）、DASHR 的持久内核（`ctx://` 的变量来源）。

## Goals / Non-Goals

**Goals:**
- 让 `read`/`write`/`grep`/`glob` 接受 `scheme://` URL，5 个 scheme（skill/agent/dsh/ctx/xd）各自一个 handler，统一 selector 语法。
- DASHR 的 `read` 工具统一提供 URL 路由 + hashline（hashline vendor 进 DASHR，不再依赖 BetterEdit shadow），无两个 read 竞争。
- 工具面保持扁平：不新增任何模型可见工具，`skill` 工具反而被 mask。

**Non-Goals:**
- 不做 `local://`、`artifact://`、`vault://`、`rule://`、`issue://`、`pr://`（见 proposal - What Changes）。
- 不做 remote/embedded skill provider（`skill://` 只覆盖 filesystem provider，远程 skill 列为缺口）。
- 不改上游 `dsh-tool-fs` 源码。

## Decisions

### D1. URL resolver 是独立插件层服务，不并入 `dashr-repl` 内核

**决策**：新建 `dsh-url-schema`（或等价插件行），持有 scheme→handler 注册表，暴露 `resolve(schemeUrl) → text/JSON 视图`。`dashr-repl` 只作为 `ctx://` 的变量来源（内核 query/set 通道），不承担路由。

**理由**：URL schema 是基础设施层（blueprint §2.1），面向所有模式；`dashr-repl` 是 REPL 能力。解耦后 `ctx://` 依赖内核、`skill://` 依赖 `ctx.skills`、`dsh://` 依赖 settings，各自独立演化。

**备选**：并入 `dashr-repl`。否决——会让 REPL 插件背上与 REPL 无关的路由职责，且 `ctx://` 之外四个 scheme 与内核无关。

### D2. read 工具合一：URL 路由 + hashline（vendor + 署名）

**决策（定稿）**：DASHR 自己的 `read` 工具是「一个实现、两条分支」——`scheme://` → URL resolver，普通文件 → hashline。hashline 通过 **vendor BetterEdit 源码直拷进 `src/`** 成为 DASHR 一等公民（仿 OMP `@oh-my-pi/hashline` 先例），并按 OMP 模式**署名**：LICENSE/README 并列 dsh-better-edit（Rianico）与上游 pi-hashline-edit-lsz（Prime Intellect）。

**消解「closest wins / 两个 read 竞争」**：只有 DASHR 一个 read，URL 路由与 hashline 在同一工具内按路径类型分流（OMP `read.ts` 的 `resolveFileDisplayMode` 模式）。无 shadow、无 pre-execute、REPL 无第二份 read。

**REPL 侧**：REPL 的 `read` = `tool.read` = 桥 → 这个 host read。无独立 prelude read 实现。

**守卫不逃逸**：vendor 的 hashline 逻辑仍走 `ctx.fs`（沙箱 fs）；read 用 `defineTool` 注册走正常 dispatch——沙箱/审批/审计照常生效。

**署名链（4 层，据 LICENSE 实测）**：pi-hashline-edit / pi-hashline-edit-pro（RimuruW + Yugimob，原始）→ pi-hashline-edit-lsz（pi port / hashline core）→ dsh-better-edit（dsh port，Rianico/dsh-better-edit）→ DASHR。LICENSE（MIT）已含前 3 条版权并列，DASHR 加第 4 条。

**spike #1 已定**：vendor 形态 = **源码直拷进 `src/vendored/`**。BetterEdit 工具面 = `read`/`edit`/`batch_edit`/`undo_last_edit` 四工具，hashline 锚点由 read 产出、edit/undo 消费，耦合一体，故 **vendor = 整包吸收**（不只 read）；不替换 `write`——write/grep/glob 的 URL 路由无 BetterEdit 冲突。**外部 BetterEdit 插件挂载（cordis.patch.yml 那行）随之移除**，DASHR 全盘接手 hashline 工具链（OMP 模型）。

**vendor 清单（tasks 1.1 结论）**：
- **源码形态**：published package 只含**编译 JS + `.d.ts`**（`lib/`），**无 TS 源码**（`.ts` 在 GitHub `Rianico/dsh-better-edit`）。DASHR 是 TS 项目 → 倾向从 GitHub 取 TS 源码集成；回退方案直拷编译 JS + types（node_modules 即可，需带 3 个运行时依赖）。
- **文件**：`lib/` 整目录——35+ 顶层 `.js` + `types/`（38 个 `.d.ts`）+ `hashline/`（11 个）+ `guidance/`（4 个）+ `LICENSE`。
- **运行时依赖（3）**：`diff`、`file-type`、`xxhash-wasm`（vendor 后 DASHR 需自带这 3 个 npm 依赖）。
- **移除挂载**：`cordis.patch.yml` 里 `insert: id: dsh-better-edit` 那一行（即外部插件加载声明）。

### D3. 5 个 scheme 的 handler 契约

| scheme | handler 产出 | 依赖 | 备注 |
|---|---|---|---|
| `skill://<name>` `/<path>` | skill 正文 / 内部资源文本 | `ctx.skills` | filesystem provider 覆盖；`ignoreResultLimits`（完整分页） |
| `agent://` 裸 / `<id>` / `<id>/transcript` / `<id>/<child>` | roster 表 / 输出 artifact / transcript / 嵌套输出 | `dsh-subagent`、session | 吸收 `history://` |
| `dsh://docs` / `dsh://config` | 静态文档 / resolved settings | docs、`dsh-settings` | config 必须挡 raw secrets |
| `ctx://<var>` | 内核变量值 | DASHR 内核 query 通道 | 见 D4 |
| `xd://` 裸 / `<device>` | 设备清单 / 设备文档；write = dispatch | （无，占位） | 先空；handler 返回「no devices mounted / unknown device」，确立 write 分发路径 |

**selector 语法统一**：`:50-100`、`:raw`、`/path`、`?q=` 对所有 scheme 与普通文件一视同仁（对齐 OMP）。

### D4. `ctx://` 读契约：JSON-safe → JSON，否则 repr

**决策**：内核 query/set 通道按名读写 `user_ns`。变量 JSON 可序列化就返回 JSON，否则返回 `repr` 文本（或 dill round-trip）。`ctx://` 裸 = 列命名空间。

**理由**：内核变量不保证 JSON 可序列化（这正是快照用 dill 全命名空间的原因）。要「context as variable」在 URL 形态下可用，必须定死序列化边界。

**Rationale —— 为何 CTX 而非纯 Eval（用户定）**：功能上 Eval 图灵完备、能读写任何变量，但 Eval 是「工具之一」，模型要拿上下文变量得「伸手进 kernel 箱子」——这是二级入口；`ctx://` 是「变量直接摆在面前」的一级入口，与其他 scheme 同形，模型零额外心智成本。且模型每 turn 都有任务在身，不会主动做上下文自我维护（v0.1.8b 报告 §1.3 已证），「被动读一个变量」是零注意力操作。CTX 是所有模式共用的基底；Eval 之后可按模式/Profile 差别对待。

### D5. mask `skill` 工具

**决策**：mask 上游 `skill` 工具（presentation-layer，复用 DASHR masking），skill 寻址改走 `skill://`。`<available_skills>` 目录消息保留（那是发现层，不是工具）。

**理由**：`skill({name})` 的正文加载功能被 `read skill://<name>` 取代，mask 后工具面再减一。remote/embedded provider 列为缺口。

### D6. 不做 local/artifact/spill 的 Rationale

**决策**：不引入本地文件系统寻址等价的 scheme（`local://`、`artifact://`、spill URI 化）。

**Rationale（用户定）**：直接传文件路径（full/relative）模型零摩擦接受，多开 scheme 边际收益极小。dsh-spill 的 locator 已是可读路径（`read <path>` 即可）。**只有涉云时（云端加载 skill、S3 存储）才值得用 scheme 区分**——届时再上，现在留 hook 不写死。

## Risks / Trade-offs

- [vendor 维护负担] → BetterEdit 上游更新需手工同步 hashline 逻辑 → 缓解：vendor 时记录来源 commit + 署名，定期对照上游 CHANGELOG 同步。
- [`ctx://` 序列化边界] → 非 JSON 变量返回 repr，模型可能误读 → 缓解：handler 输出带类型标注，明确「这是 repr 文本」。
- [`dsh://config` 泄密] → resolved settings 可能含 API key → 缓解：config handler 白名单字段，排除 credentials/env secret。
- [mask `skill` 丢 remote skill] → 远程/嵌入式 skill 不再可达 → 缓解：列为已知缺口，`ctx.skills` 若后续支持 remote provider 再补。

## Migration Plan

- 无破坏性迁移：新增插件行 + mask `skill` + `history://` 语义并入 `agent://`。
- 回滚：卸载 `dsh-url-schema` 插件、撤销 mask 即回到纯工具面。
- 部署：DASHR `read` 工具（URL 路由 + vendored hashline）+ mask `skill` + `history://` 语义并入 `agent://`。

## Open Questions

- **spike #1（vendor 机制）**：hashline vendor 的机械形态（源码直拷 vs 依赖引 dsh-better-edit）+ BetterEdit 在 distro bundle 的去留。解答不改 specs（5 个 scheme 契约不变），只改实现路径，列为首个任务而非阻塞项。

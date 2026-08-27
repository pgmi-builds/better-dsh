# Design: surface-and-devices

机制侦察已完成（4 路并行，全部结论带源码行号），以下决定均有代码级依据。

## Context

- 四层表面矩阵（v0.1.8d 实测 §6）：L0 注册表 / L1A 目录 / L1B 原生可调 / L2 REPL 可调。v0.1.8d 的掩码只打 L1A（catalog 投影）+ L2（allowlist），L1B 直调漏出。
- 上游呈现层事实：`wireSchemas`（dsh-tools:2706）、`registry.schemas`（:2900）、`sdkSchemas`（:2904）、run_code 子绑定（:1308）**全部**读 `view(scope).visible`；`view`（:2836-2856）用 `layers.every(admits)` 过滤继承名，own 层注册无条件可见（:2852）。

## Decisions

### D1. 掩码机制 = agent-scope `restrict({deny})`（否决 waterfall 软掩码）

**Decision**：在 `agent/session-start`（我们注册 own-layer wrapper 之后）调 `agentCtx.tools.restrict({deny: [...]})`。

**依据**（ScoutRestrict/WireChannel）：
- restrict 编译为 `{allow:Set, deny:Set}` 追加进 agent own 层 restrictions（dsh-tools:2778-2786）；`admits` 对继承名全票制（:2523-2527）→ 被拒名从 `visible` 消失 → wire/catalog/SDK/run_code 绑定/**按名 dispatch** 五面同步（dispatch 链 `createExecution.get()` :3016 → `resolveExecution` :3171 → UNKNOWN_TOOL :3178，nested 不豁免——`collapses` 纯 mode 折叠 :2975）。
- ordering hazard 只在「restrict 时名字未注册」（对照 `restrictableNames` throw，:2783-2785）；session-start 时点全部插件已 apply，安全。
- own 层（我们的 URL wrapper read/write/grep/glob、桥 agent_message）**绕过 admits**（:2852），不受 deny 影响。
- `run_code` 不可 restrict（:2782）——本就要保留。
- 否决的备选：`system-prompt/assemble` waterfall 过滤 wire 数组（软掩码）——只掩 wire 一面，catalog/SDK 仍显示该工具 → 模型看到却调不到的不一致面，维护成本高。

**deny 名单（默认，可配置；全部 registry 掩码 visible=false）**：`skill`、上游 `send_message`、`report`、`list_agents`、`subagent`、`subagent_fork`、`interrupt_agent`、`workflow`、`ralph`。

**能力保留靠工具层桥，不靠 registry 豁免**（源码事实，`dsh-subagent`/`dsh-tool-subagent-*`）：
- native `send_message` = `ctx.subagents.followup(parent, childId, ...)`；recipient 约束 `authorizeLineage`（`dsh-subagent/lib/index.js:1336-1339`）强制 `childId.parentSession === parent.id`——**只能给自己的 direct child 发，peer/sibling send 原生不存在**（非被 jail，上游即无此能力）。
- native `report` 只向上 direct parent（无 recipient 参数），注册在 child scope（对父与 sibling 不可见）。
- **服务层授权不可绕过**：`authorizeLineage` 另验 `this.ctx.agents.get(parent.id) !== parent → UNAUTHORIZED`（:1337）——即使桥在服务层直调 `followup/reportFrom` 绕过工具 registry 的 restrict，服务内部仍校验 exact live parent。桥的透传**不会**打开越权面。
- **peer/sibling 增强是新增能力，非透传**（原生 `followup` 对非 direct child 直接 UNAUTHORIZED）——另开 change，不混入本轮。

### D2. 捕获定义仅供 DASHR 内部（被掩名对 LLM 全链路消失）

**Decision**：被掩名对 LLM 是**全链路不可达**——wire/catalog/SDK/REPL 绑定/按名 dispatch 五面一致消失（restrict 的 `visible` 投影就是唯一源）。session-start 在 restrict **之前**的全量捕获（per-agent WeakMap `Map<name, ToolDefinition>`）**只服务于 DASHR 内部**：URL wrapper 的非 URL 委托、`agent_message` 桥（child 下行透传捕获的 `send_message.execute`，parent 上行透传捕获的 `report.execute`——语义与原生一致，含投递模式：内容以 user-role 投递为目标的下一轮 turn，工具返回 messageId 确认，非工具结果）。REPL 绑定**不绑被掩名**——「LLM 直调 = REPL 桥接」是同一投影源的结构保证，不需要（也不应该）向 LLM 解释这个对应关系。

### D3. REPL 自动映射（废除 allowlist，单态）

**Decision**：绑定安装 = restrict **之后**枚举 `registry.schemas(agent)`（= visible 全集，含 own-layer wrapper），凡 `isFlatBindableName` 自动绑，by-name `scheduler.prepare`（完整政策管线）。无二态、无名单：被掩名天然不在 visible 里，自然不绑。`MASKED_TOOL_NAMES` 的绑定过滤职责删除（名单仅作 restrict deny 来源）。MCP 非平坦名（`__`/连字符）跳过并在 bridge instructions 如实注明名称形态限制。不呈现 REPL 可调清单——模型经 `Object.keys(tools)` 自查（运行时真相；文本目录无跨重启稳定性，见 wire-vs-transcription 教训）。

### D4. 目录段 = REPL bridge instructions（呈现形态两选项，spike 裁决）

**Decision**：`dashr:tool-catalog` 段 id 保留（避免 prompt-cache 断裂），定位改为 REPL bridge instructions。**omp 事实参照**（源码 `eval.ts:326-363` + `eval-code-mode.md`）：omp code mode 在 eval 工具 description 内生成**逐工具 TS 签名目录**（`generateCodeModeDeclarations`：每工具一行 `name(args: {…}): Promise<unknown>`，每次 description 读取时从 live registry 重新生成防漂移，并排除 direct-callable 工具）；omp 无输出契约目录（返回恒 `Promise<unknown>`）。两选项：

- **A. 纯约定**（零重复）：一句「wire 上声明的工具可经 `await tools.<name>(args)` 调用（非平坦名除外）」+ 保留 `ToolOutputMap`。省 ~23KB；风险：flash 档模型参数形状错误率待 A/B。
- **B. omp 式紧凑签名**：每工具一行签名（`read(args: {path: string}): Promise<unknown>` 形态，~1-2KB 总量）+ 输出契约。比 dsh 现 ToolArgsMap interface 块轻一个量级，omp 量产实证。

推荐 **B**（omp 实证 + 低档模型稳健），A/B 由部署实测 `unknown binding`/参数错误率后定案。两选项共同点：不解释「wire = REPL」的对应机制（结构保证，非模型知识）。


### D5. run_code = REPL scripting pad（表述原则）

run_code 定位为 **REPL scripting pad（草稿本）**：会话持久的运行环境，平级工具之一，不是特权入口。LLM 可见文案**不用 kernel 一词**（避免与模型交互的真实环境混淆——LLM 真正的环境就是呈现给它的全部 runtime facilities）。当前仅 Python；TS 及更多语言为自然扩展（omp 四语言实证同一桥接形态）。直调（效率）与 REPL（组合能力）并存，不改变 run_code 注册机制。


### D6. roster = caller 的 family tree（native list_agents 语义对齐，修正全局超集）

**原则**：既不缩小上游能力，也不自造 feature。原生 `list_agents`（`dsh-tool-subagent-control/lib/types/list-agents.js`）= `ctx.subagents.listChildren()/listDescendants()` 的 caller 视角投影——**只列自己的 family tree**（children / 可选 descendants），且**只列 continuable 子**（one-shot 子明确省略：不可续谈、模型无从选择；遍历 one-shot 仅为发现孙辈），status 为 `running|idle|ready`。可见但不可通讯的全局超集无意义（跨 family 本就 UNAUTHORIZED），且属自造 feature。

**修法（roster）**：裸 `agent://` 从「全部 live session」改为 **caller 的 family tree**：`listDescendants(caller.id)` 投影，行 = continuable 子，列 = `id`（`label ?? rawId`）、`status`（running/idle/ready，native 语义：ready = 仅存持久化、可续谈非终态）、`parent`、`last activity`。无子时名册为空（native 同型）。全局 session 枚举（v0.1.8d 的 sessions.list() 行为）**移除**——那是无意引入的 feature。

**修法（寻址范围）**：`agent://<id>` / `<id>/transcript` / `<id>/<child>` 限定 caller 自己 + 其 family descendants——自己的上下文与自己的孩子是 caller 的既有能力面（job_output/notice 语义），别人的不是。settled one-shot 子不进名册但**可寻址**（id 来自 spawn 返回/notice，native 用 job_output 收集，URL 等价物）：`activity:'inactive'` → `ctx.sessionPersistence.inspect(childId)` → `finalAssistantOutput(events)`；live 子走 live 库。`inject` 增加 `'sessionPersistence'`。

**label 寻址**：`SubagentListEntry.label` 是 continuable 子的持久创建标签（如 `doer-1`）。名册 id 列 `label ?? rawId`；寻址**双匹配**——先 exact raw session id，未中按 label（native `list_agents` 的 label 字段同名语义）。label 冲突时 raw id 优先并文档注明。

### D7. RAM 物化 = /dev/shm tmpfs

`/dev/shm` 实测 tmpfs 6.6G。materialize.ts 的根目录从 `os.tmpdir()` 改为 `/dev/shm`（存在且可写时），content-backed 内容本就是 KB 级快照；单次物化 >8MB 或 shm 不可用回退 `/tmp`。ripgrep 对 tmpfs 无感知，原生 grep/glob 零改动；tmpfs 崩溃挥发，比 /tmp 更干净。

### D8. dvc 设备 = vendor omp（MIT）

源码 `upstream/oh-my-pi/packages/coding-agent/src/`（MIT）。契约同构：`write dvc://<device>` content=JSON args → execute → result（omp `dispatchXdevTool` / `XdProtocolHandler`）。

**设备与顺序**：
1. **ast_edit + ast_grep**（28.3KB + 19.9KB TS）：native 依赖 `@oh-my-pi/pi-natives@18.0.6` **在 npm**（实测），普通 dependency 即可——无阻塞，优先。
2. **browser**（17.7KB + browser/ 模块 ~156KB TS）：`puppeteer-core`（需评估 omp 的 33.6KB fork patch 是否必需；patchedDependencies 机制 DASHR 侧用 patch-package 或评估绕过）+ 系统 Chrome（本机 `/usr/bin/google-chrome-stable` 已装）。
3. **lsp**（模块 ~100KB TS）：纯 TS；外部语言服务器二进制按需（`defaults.json` 53 项注册表拷入，运行时探测，缺则该语言优雅降级）。

`handlers/dvc.ts` 从占位改造为设备注册表 + `dispatchDvcWrite` 真分发；bare read = 设备名册（不再恒 `no devices mounted`）。署名链照 vendored hashline 惯例（LICENSE 并列 MIT 条款）。

## Risks / Trade-offs

- [被掩名直调绕过政策管线] 捕获定义直调不走 pre-execute guard/超时瀑布——与 URL wrapper 委托原生 write 的既有取舍一致；被掩名（skill/delegation）本就是低风险只读或已有桥语义的工具。
- [prompt-cache 命中] 目录段瘦身（~23KB）与标题变更会使旧会话前缀失效一次——一次性成本。
- [pi-natives 平台覆盖] npm 包需含 linux-x64-modern 之外的产物时才可跨平台；本机优先，跨平台列为 open question。
- [browser patch] 若 fork patch 为必需，patch-package 引入新构建步骤；评估结论落在 tasks。
- [restrict 名单漂移] host 未来新增 delegation 工具不会自动进 deny——名单可配置 + 文档注明维护点。

## Migration Plan

- `MASKED_TOOL_NAMES` 保留导出但职责缩为 restrict 名单来源（避免双名单漂移）。
- 回滚：去掉 restrict 调用 + 绑定回退 by-name 即回到 v0.1.8d 行为（dvc 设备独立可禁用）。

## Open Questions

- browser 的 puppeteer-core patch 是否必需（spike 首个任务内裁决）。
- `@oh-my-pi/pi-natives` npm 产物是否覆盖 darwin/arm64（本机 linux-x64 已验证）。

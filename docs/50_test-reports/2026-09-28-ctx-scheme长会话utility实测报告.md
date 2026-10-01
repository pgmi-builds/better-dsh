# ctx:// scheme 长会话 utility 实测报告（2026-09-28）

- **对象**：better-dsh `ctx://` URL scheme（recallable-context 面）
- **被测构建**：better-dsh **0.2.4-c**（`35535d2`，现役发布版；装于 prod `~/.dsh/profiles/web`）
- **测试载体**：**第一人称、真实长会话**——本报告就是在该会话里写的。样本参数：15 条真实 user prompt、405 条 agent message、343 次 tool call、**1 次 compaction（shadow 825 items / 386,226 tokens）**、76 条注入消息。非合成夹具，正是该 scheme 的目标场景（超长会话）。
- **方法**：逐面活体探测（roster / snapshot / episode / raw window / 集合 / 元素 / 错误路径 / 跨 compaction grep），每条结论均有本会话内的真实调用为证。

## 一、逐面结果

| Surface | 探测 | 结果 |
|---|---|---|
| `ctx://`（roster） | 裸读 | ✅ 10 行自描述面，含每个 sub-path 的语法与 `:raw:N-M` 提示；无需 live agent |
| `ctx://session`（快照） | 裸读 | ✅ totals（343 tool calls / 15 prompts / 1 compaction）+ segments（compacted 16–2336 vs live 2337–2379）+ **内联 compactions 清单**（label 2348、shadowed 825 items / 386k tokens、8 段 ×100 字预览）+ hints。长会话里这是"我丢了什么"的一张卡，一次读全拿到 |
| `ctx://session/compactions[2348]` | episode 摘要 | ✅ 8 段全文 verbatim（prepared 面），与本会话真实 checkpoint 内容一致 |
| `compactions[2348]:600-604` | **shadowed 原始跨度行窗口** | ✅ 精确回到被 compact 掉的历史，带 seq 标签（`[0000212] TOOL bash` 等） |
| `ctx://session/user_prompts[0]` / `[17]` | 元素面 + seq 二象性 | ✅ 0-based 序数与事件 seq 寻址等价（`[17]`≡`[0]`），返回完整原始 prompt（含中文长文无损） |
| `user_prompts[17]:1-2` | 元素面行窗口 | ✅ `:N-M` 在元素面上照常生效 |
| `ctx://session/tool_calls[342]` | 元素面 | ✅ name + arguments + result 三段式（result 空缺见 F2） |
| `ctx://session/injections` | 索引面 | ✅ **本会话 76+ 条注入的完整台账**：seq、source kind、~100 字预览。subagent-settled / agent-message / agent-instructions / compact-checkpoint 全在——长会话里这就是"我离开期间发生了什么"的账本 |
| `grep path: ctx://session/transcript` | **跨 compaction 全文搜索** | ✅ 把含 shadowed 跨度的全量 transcript 物化到 `/dev/shm` 检索，命中 6 处 `gate-removal`（含 compact 前的旧事件），**行号 = transcript 规范坐标**，可与 `:N-M` 窗口直接组合。长会话第一杀器 |
| `compactions[2348]/original` | 已废路径 | ✅ `CTX_BAD_PATH`，错误文本直接给出替代写法（"superseded by the :raw / :raw:N-M selectors"） |

## 二、utility 结论（长会话视角)

**该 scheme 在其设计目标场景（超长会话 + compaction 后回溯）里成立且好用**：

1. **丢context自知**：快照的 segments + 内联 manifest 让模型精确知道 shadow 了什么（825 items / 386k tokens）以及每段摘要——不需要盲猜。
2. **三级召回粒度齐全**：摘要（episode 面）→ 精确行（`:N-M` raw 窗口）→ 全文定位（grep 物化检索），三者共用同一套规范坐标，可组合。
3. **索引面价值实测**：injections 台账在本会话里直接回答了"哪些 subagent 何时 settle 过"这类跨天问题。
4. **错误质量好**：废路径、未知 key、越界元素全部结构化且回显可操作的修复指引。

## 三、Findings（按 §〇.5 攒批，不烧版本）

- **F1（utility gap + 错误外 观）**：裸 `ctx://session/user_prompts`（tool_calls / agent_responses 同）→ `CTX_NO_SUCH_ELEMENT`，且错误回显为 `ctx://…[]`——**空括号 URL 不是模型输入的 URL**。impl 把裸集合面当元素查找（`handlers/ctx.ts:486` 的条件把无名 bracket 落进元素分支）。spec 侧该三集合是否应有 index face 存在歧义（"user_prompts continues to list" 一句两读）；从 utility 看，user_prompts（15 条）加 seq+预览索引面价值高，tool_calls/agent_responses（343/405 条）裸索引过长、宜支持窗口化索引。至少：错误不应回显空括号。
- **F2（召回盲点，非 ctx:// 渲染缺陷）**：大输出 tool result 在 `tool_calls` 元素面与 transcript 面均为**空串**（样本 seq 2379 / 2406，`resultTextOf` 产出空）。两 face 一致 → 归因于持久层对大 result 的省略存储；但"大输出"恰是长会话里最想召回的内容。建议后续核实上游持久化行为，若确为 elision，ctx:// 侧至少回显 `(result elided, N chars)` 而非静默空。
- **F3（UX 小刺）**：`read` 的 `offset`/`limit` 分页参数对 `ctx://` URI **静默忽略**（实测 limit:15/20 均无效，injections 返回全量）。行窗口的 sanctioned 机制是 `:N-M`，但原生 read 契约写明"File reads page with offset/limit"——URI 读既不分页也不提示，宜在文档或错误提示里点名。

## 四、判定

---

## 五、第二轮活体复测（2026-09-28 晚，同一会话、4 次 compaction 后）

同一长会话的后续采样：距首轮报告又历经 3 次 compaction（现役 4 块 shadow + live 段仅 51 items；totals 1371 tool calls / 35 prompts / 1248 agent messages；会话 2026-09-23 起、跨约 5 天，shadow 合计 2715 items / ~1.40M tokens）。被测构建不变：better-dsh **0.2.4-c** 仍在 prod web profile（磁盘核实），harness 基座 0.1.7-rc.2。

| 探测 | 结果 |
|---|---|
| `ctx://session` 快照 | ✅ 4 块 compaction 全清单内联（2485 / 4634 / 5637 / 7033，含 `replaces_checkpoint` 链与 8 段 preview），segments 图一次读全 |
| `grep path: ctx://session/transcript`（pattern `0\.1\.3-v`） | ✅ **跨全部 4 块 shadow 命中 16 处**（materialized canonical 行 14998–15308，深处远超 live 起点）；召回内容与本会话 checkpoint 事实逐项吻合（0.1.3-v commit 文全文、dev3 满堂红探针命令、prod 安装命令与输出）——跨天跨 compaction recall 零失真实证 |
| `compactions[2485]:1-2` | ✅ 4 层 compaction 之前的会话首条真实指令 **verbatim 召回**（`[0000012] USER`：0.1.7 对齐令） |
| `compactions[2348]`（首轮报告引用的旧 label） | ⚠️ **label 漂移（新 F4）**：`CTX_NO_SUCH`，错误列出现役 labels `(2485, 4634, 5637, 7033)` 可即时恢复；但首块 shadow 已从报告时的 label 2348 / span 16–2336 / 825 items / 386,226 tokens 重划为 label 2485 / span 12–2477 / 967 items / 365,535 tokens——后续 compaction 会吸收旧 checkpoint 之后的 live 段并重贴 label |
| 裸 `ctx://session/user_prompts`（F1 复测） | ⚠️ 依旧 `CTX_NO_SUCH_ELEMENT` + 空括号回显 `ctx://…[]`；错误文案现含集合长度与 0-based 提示（更可用），缺陷面不变 |
| `read(ctx://session, limit:1)`（F3 复测） | ⚠️ limit 静默忽略、全量快照卡返回——F3 照旧 |

### 第二轮结论

- **核心承诺在 4×compaction 规模下依旧成立**：快照自知、清单内联、跨 shadow grep、深层 verbatim 召回全部可用，且 grep 召回经与 checkpoint 事实比对无失真。长会话跨 5 天后，scheme 仍是「我丢了什么 / 怎么拿回来」的完整答案。
- **F4（新，compaction label 非稳定引用键）**：后续 compaction 重划更早 shadow 的 label 与 span（2348→2485），跨 turn 按 label 引用会悬空。建议：文档点名「compaction label 仅对当次 shadow 结构有效，跨 turn 引用先重读快照」（错误信息已支持该恢复路径）；或提供快照中已有的 `compactionId`（uuid）作稳定寻址键。
- F1 / F3 复现如前，攒批不变。判定维持**通过**。
**通过**。0.2.4-c 的 `ctx://` 面在真实超长会话中全部核心承诺兑现：快照自知、清单内联、三级召回、跨 compaction grep。F1–F3 均为小瑕，按惯例攒批并入下次发布轮处理。

## 六、第三轮活体复测（2026-09-28 14:03，同工作线后继会话实例、1×compaction）

第三轮换载体：不再是前两轮的长会话本体（09-23 起、4×compaction），而是同一 superd 工作线的**后继会话实例**（`session-9d55447a`，cwd `/home/u1/workspaces/superd`，创建于 2026-09-25 11:34，2026-09-27 14:15 经历唯一一次 compaction）。采样时点参数：shadow seq 16–2099 = **681 items / 361,515 tokens**、live 仅 36→54 items（两次读数间自增）、totals ≈ 349 tool calls / 11 prompts / 315 agent messages / 193 reasoning blocks。被测构建磁盘再核实不变：better-dsh **0.2.4-c**（prod web profile）+ harness 0.1.7-rc.2。本轮顺带回答一个问题：**scheme 在「普通」形态（仅 1×compaction）下是否同样成立**。

| 探测 | 结果 |
|---|---|
| `ctx://session` 快照 | ✅ 单 compaction 全清单内联（label 2108 / checkpoint_seq 2109 / `compactionId` uuid / `replaces_checkpoint: null` / 8 段 preview）+ segments 图；两次读取间 totals 活体前移（tool_calls 343→349、live 36→54）——快照与持久层实时一致 |
| `compactions[2108]:1-3` | ✅ shadow 首事件 verbatim（`[0000016] USER` @native-ui-fusion 两份计划文档），与 checkpoint「Primary Request」吻合 |
| `user_prompts[0]` | ✅ 同一事件的元素面 verbatim（`[0]` ≡ seq 16 二象性复现）；episode 面与元素面跨 face 一致 |
| grep `82de0f3` on `ctx://session/transcript` | ✅ 5 命中横跨 shadow+live：台账终局 bash 命令全文、memory_add 载荷、checkpoint 摘要行、以及 grep 调用自身（检索自包含）；召回内容与本线真实终局（0.1.5 merge/tags/publish/rig 迁移）逐项吻合，零失真 |
| `tool_calls[342]` | ✅ name+arguments verbatim；result 空串 → **F2 三度复现** |
| 裸 `ctx://session/user_prompts`（F1 复测） | ⚠️ 照旧 `CTX_NO_SUCH_ELEMENT` + 空括号回显；错误含集合计数与 0-based 提示 |
| `read(ctx://session, limit:1)`（F3 复测） | ⚠️ 照旧静默忽略、全量快照返回 |
| `?q=` 行过滤（新探测） | ❌ **F5（新）**：`Error: ctx://: unsupported selector kind "query"`——harness 内部 scheme 选择器契约记载 `?q=<q>`（dot-path 搜索 / 行过滤），ctx provider 在 selector 解析层即拒；fail-closed、错误干净，但回显丢 face（只剩裸 `ctx://`）。实用面无损（grep on ctx path 即行过滤替代，三轮均已证），属契约/文档缺口而非功能缺陷 |
| `thinking[0]:1-2` / `system:1-3` | ✅ 两面首次入矩阵：首个 reasoning 块、会话级 system 消息 verbatim，`:N-M` 在元素面照常生效。另观察：快照 `system_prompt.chars` 恒 0（preset prompt 统计）与 system 消息面是两回事，前者语义未表（记录，不立案） |
| F4 label 漂移 | N/A——单 compaction、轮内无重划；`compactionId` uuid 确认在清单在场，round 2 的稳定键建议继续成立 |

### 第三轮结论

- **核心承诺在普通形态（1×compaction、live 36 items）全额兑现**：快照自知、清单内联、三级召回、跨 shadow grep、跨 face 一致性全部复现，grep 召回与外部事实（git/npm/rig 终局）比对无失真。scheme 的 utility 不依赖极端 compaction 深度，首次 compaction 后即达设计意图。
- **F5 入批**（`?q=` selector 未实现 + 错误回显丢 face）；F1/F2/F3 三度复现、攒批不变；F4 本轮无复现机会。判定维持**通过**。

## 七、设计复核：compaction 面的体量语义与渐进披露（2026-09-28 14:2x，user 提问触发，源码+实测双证）

user 之问：裸读 `compactions[<id>]` 返回 digest 还是 shadowed 全文？若 auto-compaction 阈值 500k tokens，召回工具自己会不会把上下文塞爆？核对 `better-dsh/src/url-schemes/handlers/ctx.ts`（L332–426）后的事实：

| URL 形态 | 返回 | 体量 |
|---|---|---|
| `ctx://session` | 快照卡：8 段 ×100 字 summary_preview + shadowed range/items/**tokens** + compactionId | 有界（本会话实测 ~2k tokens） |
| `ctx://session/compactions` | 逐 episode 一行：label / checkpoint_seq / compactionId / at / range+items+tokens / replaces_checkpoint / 120 字 preview | 每块 ~1 行 |
| `compactions[<id>]`（裸） | **仅 digest**（= compaction 时定稿的 8 段 checkpoint 摘要，`applyFace(..., 'prepared')`）；不随 shadowed 体量增长（本会话 361k shadow → ~4.5k digest，≈80:1） | 有界 |
| `compactions[<id>]:N-M` | shadowed span 行窗口 | 窗口即上界 |
| `compactions[<id>]:raw`（span > 64 KiB） | **仍返回全文**，仅尾注一句「original span is N chars — page with :N-M or grep」（L419，warn-don't-block） | ⚠️ **无硬护栏** → **F6** |

- **结论（user 的设计诉求已大半在场）**：默认路径（一切裸 URL）永不返回 bulk 原文；「digest + 寻址范围 + statistics」正是快照/清单/episode 三层的现役形态，digest 体量 = checkpoint 本身（模型上下文里已有同一份，重读≈复读）。**残余风险一处 = F6**：>64 KiB span 的裸 `:raw` 只警示不拦截。500k-token shadow（≈2 MB）一次裸读仍会倾泻。建议升级为 bash 式 spill-to-file（本仓 grep 物化 `/dev/shm/dashr-url-*/content.txt` 已有先例可复用：截断 + 落盘 + 报路径），或硬拒并指引 `:N-M` / grep。**F5 修正**：`?q=` 不支持并非首发现——2026-09-12 `url-schemes-grammar-matrix` 报告已记录同缺陷（彼处亦编 F5），本轮系复测而非新发现。
- **Context injection root**：`injections` 裸读 = 索引台账（seq + source kind + 100 字预览，L436–442），**非全文**——比 user 预期（「直接给可以」）更省；全文按条 `[n]`，`:raw` 才全量拼接（该 face 无 oversize 注记，同类小隐患，量级低，附于 F6 备注）。
- **Sub-agent（user 之前提需修正）**：master 会话日志**并不内嵌** child 全 transcript——内嵌的只有终态工件：`agent` 工具调用的 arguments+result（`tool_calls[k]` 可寻址，result 携带 durable subagent id）与 report/settled 注入（`injections[k]`）。child 全 transcript 是独立 session 文件，专用寻址面 = **`agent://`**（design.md D6）：`agent://` 家族 roster（仅 continuable 后代；**one-shot child 不入 roster**——只能经 master transcript 的 tool_calls 找回，小 gap 备注）/ `agent://<id>` 终态输出 / `agent://<id>/transcript` 全 transcript / `agent://<id>/<child>` 嵌套；settled child 经 sessionPersistence 仍可寻址；跨家族 id 一律 `AGENT_UNKNOWN_ID`（寻址范围 = 自家族，含授权语义）。两 scheme 组合即完整链：`ctx://session/tool_calls[k]` 拿 id → `agent://<id>/transcript` 拿全文。ctx://session 无需也不应再抠 subagent 专字段。

## 八、长会话导航化：设计定调与 findings F7–F10（2026-09-28，user 提问触发；下一波开发即做此项）

### 载体与证法

本轮实测载体 = 本会话 `session-36c2b2ef-a498-49d0-8ff6-af1a92a758ad`（探测时 **1×compaction**：shadow seq 16–2336 = 825 items / 386,226 tokens，live 2337–2379，totals 343 tool calls / 15 prompts；同轮内 totals 已前移至 17 prompts）。**F7–F10 均为代码/规格级缺陷**（与载体无关），活体探测仅作证；§七 的源码复核（`handlers/ctx.ts` L332–426）与本轮互为正交。

### 范畴声明（user 裁决 — 写死为非目标）

本工具族 = **以文本关键词为主的可回溯导航**（原文 + 索引 + 寻址）。**语义层不是我们的工作**：向量检索、语义索引属于记忆类工具（本 profile 并装 corti-memory 一类），属不同工具分类。理由：大模型本身就是语言模型——同义替换、中英转换、换关键词变着法 grab 都是它的本职；我们只需保证**原文可取 + 可寻址**。故：不做 embedding、不做语义排序、不做「我记不清那个词」的检索。我们提供的是电话簿 + 索引 + 指针，不是记忆。

### Findings

**F7（高 — 必须先修）：surface 单位 ≠ 可寻址单位（seq vs line）**

- manifest 的 `shadowed_range` 是 **seq 单位**（`{start:16, end:2336}`）；但唯一的窗口选择器 `:N-M` 是 **line 单位**。
- 实测：`compactions[2348]:16-16` → 空行（seq 16 实际位于 transcript 行 1）；该 span 实际占 transcript 行 ≈1–5230。
- 后果：照 manifest 字面下 `compactions[2348]:16-2336`，拿到的是 **~45% 的静默截断视图**——不报错、内容相关，模型会自信地以为「我已读过 shadowed 范围」。对导航器而言这是最坏的失败模式（静默非完整）。
- 修法（改动很小）：manifest / episode 携带 `lines:{start,end}`（或改以行区间为主、seq 仅作元数据）。episode 面**本已接受**行窗口，缺的只是把「可寻址范围」告诉模型。

**F8：`:path/` 选择器在 ctx:// 未实现（F5 的姊妹项）**

- 实测 `ctx://session:path/totals` → `unsupported selector kind "path"`；`?q=` 为 F5（§六已录，且据 §七 更正系 2026-09-12 旧账复测）。
- 二者在模型面 `url-schemes-instruction.md` 中列为**通用**选择器、无 per-scheme 免责；`CTX_BAD_SELECTOR` 文案不回显支持集（ctx 其它错误均为模范级）、且回显丢 face（只剩裸 `ctx://`）。
- utility 影响：窄读一个字段（`:path/totals.tool_calls`，省去整张快照卡）与过滤一个索引面（`injections?q=subagent-settled`）恰是长会话导航要的窄口径。

**F9（低）：快照无 `asOf`** — totals 在会话推进中前移（本轮 15→17；§六亦观察 live 36→54）。模型缓存一次快照后在陈旧数字上推理，无自知。建议快照带 `asOf`（seq/line），或明示「每次读都是即时值」。

**F10（中）：越界静默空串** — 实测 `compactions[2348]:3300` 有内容、`:5500` → 空串。episode 面确实被 span 约束（好），但：① 越界与 span 内空行不可区分；② **上界落在 3300–5500 之间且无从得知**（无任何面告知）——这本身就是 N1 要解决的问题。建议边界显式（如 `[end of episode span at line N]`）。

### 设计立场（本轮定调，供下波开发直接采）

1. **坐标统一不变式（user 点明）**：scheme 展示给模型的每一个数字/单位（行、段、seq、label），都必须是**同一 URL 族内可直接寻址的**；不可寻址的数字不得作为指针出现（纯 metadata 须显式标注单位）。当前违背者 = F7。这是「导航系统」与「一堆面」的分界，应写成规格不变式。
2. **给指针，不给统计（user 校正用词）**：原提案的「statistics」实指**可导航坐标 + 方向标**（user 原用「state」一词，其预设 = surface 出来的 sequence/line/段落等同于工具可寻址的 selector——该预设正确，当前实现违背它，即 F7）。计数只在作为 **fidelity 信号**时保留一行：`user_turns : tool_calls` 比 → 决定摘要该不该信（tool 重的 span 摘要可信、细节可再生；user 意图密集的 span 必丢细节 → 必须下钻）。**方向标** = 按类型分组的坐标清单，全部以行坐标输出、直接可喂 `:N-M`：
   - user turn 坐标（实测：17 个 user prompt 的行号清单一眼看出会话重心分布——前 1500 行仅 4 轮，其后密集；但今天需要模型自己发明 `grep '^\[\d{7}\] USER$'`，非 scheme 给的 affordance）；
   - 失败 tool call / 重试坐标（「哪里出过事」）；
   - **touch 过的文件路径 + 次数**（编码场景最值的语义索引：「哪个 episode 动过 `auth.ts`」）；
   - span 内**前序 checkpoint 数**（决定「这是不是摘要的摘要、该往哪个 label 下钻」；本会话实测 = 1，链深 1）。
3. **渐进披露与递归扇出**：10M–100M token 规模下聚合计数可活、扁平名册活不下来（5 亿 token 可能有数千 user turns）→ 每层必须用一屏回答「这里有什么 + 下一步去哪」。到那个尺度 seq/line 都失去直觉，**时间**与**主题（文件/子系统）**才是稳定轴，故两者必须进每个节点的坐标块。
4. **digest 复读问题的两看（user 提出，本轮定论）**：
   - **latest compaction**：其 digest 已作为 checkpoint 消息**驻留在当前上下文**里（实测：digest 即 seq 2349 的 `compact-checkpoint` 注入，可寻址于 `transcript:5230-5299`，下一事件 seq 2358 起于行 5300）。故裸读**不应再倾泻 digest**，而应回**自定位提醒**：「本次 digest 已在你上下文中（`transcript:5230-5299`），需要原文可自行取；这里有用的是 span 导航」+ 指针块。` :raw` 仍返回原文跨度 ⇒ digest 永不丢失（它本身可寻址）。
   - **older compaction**：其 digest 已被二次压缩进更新的 checkpoint，只存在于 span 内 ⇒ **应当照常返回全文 digest**（它是该段历史最便宜的入口，且不构成「吃回来」）。
   - **规则化**：digest 正文的返回条件 = **该 digest 未驻留于 live 上下文**（即仅非 latest episode）。
   - **设计警戒（user 赞同）**：stat/digest 只能是指针、不能是内容——嵌摘要 = 把刚 compact 掉的东西又吃回来。

### 下波开发 backlog（建议序）

| # | 项 | 依据 |
|---|---|---|
| N1 | episode 节点坐标可寻址化：manifest / episode 暴露 `lines:{start,end}`；越界边界显式 | F7 / F10 |
| N2 | episode prepared 面改「导航块」：latest → 自定位提醒 + 指针（不倾泻 digest）；older → 全文 digest + 指针 | 设计立场 4 |
| N3 | 方向标（scoped landmark 名册）：user turns / failures / touched paths / prior checkpoints，行坐标输出 | 设计立场 2 |
| N4 | fidelity 一行（`user_turns : tool_calls`）内联进 manifest 每 episode | 设计立场 2 |
| N5 | `:path/` + `?q=` 在 ctx:// 落地，或在 instruction 明示 per-scheme 差异；`CTX_BAD_SELECTOR` 回显支持集与 face | F8 / F5 |
| N6 | 快照 `asOf`（或明示即时性） | F9 |

- 判定：**通过，且方向确认**。方案不需要新机制——F7 的修法是把已有数字换成可寻址的那套单位；N2–N4 都是在现有 episode/快照结构上加指针，不引入新检索层。

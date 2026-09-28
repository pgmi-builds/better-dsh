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

**通过**。0.2.4-c 的 `ctx://` 面在真实超长会话中全部核心承诺兑现：快照自知、清单内联、三级召回、跨 compaction grep。F1–F3 均为小瑕，按惯例攒批并入下次发布轮处理。

# ctx:// 长会话导航化实测报告（2026-10-02）

- **对象**：better-dsh `ctx://` scheme 长会话导航化 —— backlog N1–N6 + findings F1/F2（自 `2026-09-28-ctx-scheme长会话utility实测报告.md` §八）
- **被测构建**：better-dsh 0.2.4-d（+ 本次改动，未发布），harness 基座 **0.2.0-rc.2**（本轮对齐）
- **载体**：单测夹具 + 4999 rig 第一人称活体（headless 真实 agent session，模型 = deepseek-flash）
- **设计/规格**：`docs/superpowers/specs/2026-10-02-ctx-navigation-design.md`；live spec `docs/specs/ctx/spec.md`

## 一、改动一览

| 项 | 内容 |
|---|---|
| N1/F7/F10 | 新增 transcript line index（`buildTranscript`）；episode/manifest/快照暴露 `lines:{start,end}` + 标注 `seq=`；episode 行窗 **transcript 相对**（`compactions[l]:N-M` ≡ `transcript:N-M`），越界返回显式边界注记（不再静默空/截断） |
| N2 | digest residence：**latest** episode prepared face = 导航块（不重吐 digest，指向 `digest resident at seq=<checkpointSeq>`）；older = 全文 digest + 指针块 |
| N3 | landmark 名册（user turns / failures / touched paths / prior checkpoints，全为 transcript 行坐标，封顶） |
| N4 | `fidelity=<user_turns>:<tool_calls>` 内联 manifest/快照/episode 指针块 |
| N5/F5/F8 | `:path/` + `?q=` 在 ctx:// 落地（复用 `applySelector`），manifest 也走 `applySelector` |
| N6/F9 | 快照 `asOf:{seq,line}` |
| F1 | `user_prompts`/`tool_calls`/`agent_responses` 裸读给索引面（长集合封顶 20 + tail），错误不再回显空括号 |
| F2 | `resultTextOf` 增加 flat text-block 兜底 |

## 二、F2 根因更正（重要）

报告 §八 曾推断「持久层对大 result 的省略存储」。实测 0.2.0-rc.2 真实 `tool/result` 事件后确认根因是**内容块形状变化**：0.2.0 的 tool-result message `content` 是**平铺** `[{type:"text",text:"…"}]`，而 `resultTextOf` 只取**嵌套** `tool-result` 块 → 对所有 result 一律产空。本次改为嵌套优先、平铺兜底，`tool_calls[<seq>]` 的 result 恢复非空。非「省略」，无需 elision 标记。

## 三、验证

**单测**：`ctx.spec.ts` 23→30（新增 7：N1 坐标/asOf、N1/F10 transcript 相对 + 越界注记、N2 最新/旧 episode、N3 landmark、N5 `:path/`+`?q=`、F1 索引面、F2 flat result）。全量 **648 passed / 1 skipped**（57 文件）；`tsc --noEmit` **0 错**。关键不变式测试：episode `:N-M` ≡ `transcript:N-M`（episode span ≡ transcript slice，结构上保证坐标一致）。

**第一人称（headless，dsh 0.2.0-rc.2）**：真实 session 内逐面活体探测，agent 复述各步通过：
- `ctx://session` 解析，含 `asOf:{seq:26,line:311}` 卡 + totals（`user_prompts:1` 等）；
- `ctx://session:path/totals.tool_calls` 窄读 → 数字（`3`）；
- `ctx://session/user_prompts` / `tool_calls` 索引面正常（含 in-progress 调用的 `(no result captured)` 行）；
- `tool_calls[20]` result 非空（`result: hello-probe-1790893221`，F2 修复实证）。

compaction 特定面（lines/fidelity/landmark/digest-residence）为代码级缺陷，单测夹具（2×compaction）覆盖；本短活体无 compaction 事件，与报告 §八「活体探测仅作证」一致。

## 四、判定

**通过**。N1–N6 + F1/F2 全部落地，单测全绿，0.2.0-rc.2 上第一人称活体逐面兑现。坐标不变式成立（transcript 单一坐标空间，越界显式）。prod 3080 未部署；发布走 §〇.5 门（第一人称 + user 确认），本轮不发包。

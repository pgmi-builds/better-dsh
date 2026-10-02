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

## 五、独立复核（2026-10-02，本轮报告发布后的第三方复验）

**缘由**：user 在报告落盘后要求独立确认 §一 声称的修复是否真在场，不复述原文。复核采用三重证据：

1. **部署物同一性**：4999 rig profile 内 `better-dsh/lib/url-schemes/index.js` 与构建产物 md5 一致（`ad5b4820c4ca97520ccc196d72b3aa3f`，286,916 B）→ 活体进程加载的确实是本次改动，而非旧构建。
2. **第一人称活体探测**：本会话即 4999 运行实例（`session-6c5f8e8e-0cd7-42a0-85da-3aec7256339f`，harness 0.2.0-rc.2），逐面实读。
3. **回归全量**：`tsc --noEmit` **0 错**；`vitest run` **648 passed / 1 skipped**（57 文件）——与 §三 数字一致。

### 5.1 逐项复核结果

| 项 | 结论 | 证据（活体 / 代码） |
|---|---|---|
| F1 | ✅ 已修 | 裸 `user_prompts`/`tool_calls`/`agent_responses` 返回索引面（`seq=<n>` + ≤100 字预览）；长集合封顶 20 + `… +N more — use :raw / ?q= / [n\|seq]` 尾注；越界错误列集合名与条数，无空括号回显 |
| F2 | ✅ 已修 | `resultTextOf` 嵌套优先、平铺兜底（`ctx.ts` L128–137）；活体 `tool_calls[99]` result 非空；in-progress 调用显式 `(no result captured)` |
| F5 | ✅ 已修 | 活体 `ctx://session/tool_calls?q=bash` 行过滤生效 |
| F7 | ✅ 已修 | 快照/manifest 内 `seq=` 与 `lines=` 双坐标并存；坐标不变式已入 spec（Requirement: Coordinate invariant） |
| F8 | ✅ 已修 | 活体 `ctx://session:path/asOf` → `{"seq":198,"line":1431}`；`:path/totals.tool_calls` → `13`（数字，非 JSON 包裹） |
| F9 | ✅ 已修 | 快照 `asOf:{seq,line}` 在场，且与后续窄读的前移一致（模型可自知陈旧） |
| F10 | ✅ 已修（episode 面） | `applyEpisodeLines` 越界追加 `[ctx:// note: episode span is transcript lines s-e]`（`ctx.ts` L291–318）；单测 `N1/F10` 断言 |
| N1 | ✅ 已修 | 上述 F7/F10 证据；transcript 行索引为单一坐标源 |
| N2 | ✅ 已在代码 | latest episode 走 `digest resident at seq=<checkpointSeq> (transcript:<s>-<e>)` 指针块，older 出 digest + 指针块 |
| N3 | ✅ 已在代码 | `landmarkBlock`：user turns / failures / touched paths（含次数）/ prior checkpoints，全为行坐标并封顶 |
| N4 | ✅ 已在代码 | `fidelity=<user_turns>:<tool_calls>` 三处内联（manifest / 快照 `compacted[].fidelity` / episode 指针块） |
| N5 / N6 | ✅ 已修 | 同 F5/F8 与 F9 |

**N2–N4 的活体限度**：本会话 `compactions: 0`（快照实证），compaction 特定面无法活体触达；证据 = 代码 + 2×compaction 单测夹具，与 §三 口径一致，不构成缺口。附带观察：快照 `segments[].lines` 对 `live` 尾段为 `null`（开放区间无上界），compaction 段才带 `lines:{start,end}`——与「live 无 end」语义自洽。

### 5.2 未闭合项（本轮未声称修复，复核确认仍开）

- **F3 仍开**：`read` 的 `offset`/`limit` 对 `ctx://` 依旧静默忽略——活体 `read(ctx://session, limit:1)` 返回全量快照 JSON。
- **F4 仍开**：compaction label 仍为事件 seq，后续 compaction 重划 span 时仍会漂移；未改稳定键，亦未加文档点名（`compactionId` 为既有字段）。
- **F6 仍开**：episode `:raw` > 64 KiB 仍为 warn-don't-block（返回全文 + 注记，`ctx.ts` L528–536），无 spill-to-file / 硬护栏。

### 5.3 新发现 F11：spec 宽于实现（越界注记仅 episode 面兑现）

spec「Canonical and prepared content faces」写明*任何*越过 canonical 范围的 `:N-M` 都应回显显式边界注记；实测仅 **episode 面**成立：

- 活体 `ctx://session/transcript:1-3` → 正常返回该行窗内容；
- 活体 `ctx://session/transcript:9000-9010`、`:999999-999999` → **静默空串**（`applyLines` 无 extent 概念、无注记逻辑）。

即 §一 表中「越界返回显式边界注记（不再静默空/截断）」仅在 episode 窗口范围内为真，spec 文字面（全资源）未兑现。建议入批 F11：把 `applyLines` 升格为带 canonical extent 入参的同款注记，或把 spec 措辞收窄到 episode 面。

### 5.4 复核判定

**通过，无夸大**——§一/§三 声称的 N1–N6 + F1/F2 全部经独立证据兑现；§四 的部署与发布口径亦复核无误：4999 rig 已加载修复（md5 同一），prod 3080 仍为 **0.2.4-c**，修复未发布；发布仍走 §〇.5 门（第一人称实测 ✅ + user 确认）。遗留 F3/F4/F6 + 新增 F11 按 §〇 惯例攒批，不单烧版本。

## 六、F11 修复（2026-10-02，复核后同波闭合）

§五.3 的 F11 属实：本波 spec 文字面宽于实现（越界注记只在 episode 面）。因本改动**尚未发布**，不适用「攒批」——同波闭合：

- **修法**：ctx 侧 `applyLines` 升格为 extent-aware —— 越界窗口按 canonical 上界截断并追加 `[ctx:// note: canonical content ends at line <N>]`；`:N-` 开尾读**豁免**（刻意读到尾，非越界）；manifest 的 line 窗口也改走同一函数（原先走共享 `applySelector`，无注记）。
- **未采纳**另一选项（把 spec 措辞收窄到仅 episode 面）：不收窄，因为「不静默截断」是 N1/F10 的原意，应全资源成立。
- **验证**：单测新增 `F11`（越界 → 注记；`1-2` in-range 与 `1-` 开尾 → 无注记）；全量 **649 passed / 1 skipped**（57 文件）+ `tsc` 0 错；**第一人称活体**（headless，0.2.0-rc.2）读 `ctx://session/transcript:9000-9010` → 输出含 `ctx:// note`（`F11=yes`）。4999 rig 已重启加载修复（`lib/url-schemes/index.js` md5 `48771cb6…` 与构建产物同一）。
- **仍开**：F3（read offset/limit 静默忽略）、F4（compaction label 漂移）、F6（episode `:raw` >64 KiB warn-not-block）——三者不在本波 N1–N6 范围，按 §〇 攒批。

## 七、第二轮复核记录（2026-10-02）与越界注记语义定论

第三方复核独立确认 F11 修复已在**运行进程**中生效（构建产物与 rig lib md5 同一 + 重启后取到新行为），并逐条活体复验：

| 探测 | 结果 |
|---|---|
| `transcript:9000-9010` / `:999999-999999`（完全越界） | 仅注记（`canonical content ends at line <N>`），**不再静默空** ✅ |
| `transcript:1940-2000`（部分越界） | 上界截断 **+ 尾注** ✅ |
| `transcript:1-3`（范围内） | 正常内容，无注记 ✅ |
| `transcript:1945-` / `compactions:1-`（开尾） | 无注记（豁免）✅ |
| `compactions:2-`（起点越界） | 仅注记 ✅ |
| `compactions:1-3` / `compactions:9000-9010`（manifest 新路径） | 文本+注记 / 仅注记，上界正确 ✅ |

回归扫：F1/F2/F5/F7/F8/F9 全部仍绿；`tsc` 0 错、`vitest` 649 passed / 1 skipped（与 §六 一致）。

### 7.1 语义定论：上界越界**保留**注记（不软化）

复核提出一档可议行为：**上界越界也注记**，使 `:N-M`（M 贴/略过上界）从「纯值」变为「值 + 注记」；其测试后果即既有断言 `injections:4-5` 改为 `injections:4-`。

**定论：保留现语义，不采纳「`a <= total < b` 时不注记」的软化方案。** 依据 = F10 原意本身：

- F10 的病症是「越界与 span 内空行**不可区分**、上界落在何处**无从得知**」。若上界越界不注记，`:1940-2000`（1947 行）静默回 1940–1947，模型无法判断 1948–2000 是「空行」还是「不存在」——**正是 F10 要修的歧义**；软化 = 回退该修复。
- 两种「读到尾」的正规形已豁免/覆盖：**开尾 `:N-`** 无注记（刻意读到尾）；**上界恰为 total**（`:4-4`）无注记。故越界注记只在「模型对内容长度有错误假设」时出现，而该注记正是纠正该假设的信息。
- 代价可接受：一行元信息；远小于「误以为已读全」的风险。若未来真会话统计证明其为高频噪音，另立 finding 重议；本轮不改。
- 规格已同步补 scenario「Over-read notes, open tail does not」（`docs/specs/ctx/spec.md`）。

### 7.2 仍开（复核独立确认，非本波 N1–N6 范围）

F3（`read` offset/limit 静默忽略）、F4（compaction label 漂移，无稳定键）、F6（episode `:raw` >64 KiB warn-not-block）——按 §〇 攒批。发布仍待 user 明确放行。

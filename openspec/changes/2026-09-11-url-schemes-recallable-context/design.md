# Design — URL Schemes 服务化与 ctx:// 可回溯上下文

> **2026-09-12 对齐修订（reshape 后，design 验证报告 F4/F11）**：本文写于 reshape 之前，以下事实已按 user 批示演化，以 spec delta 与实现为准——① `/original` 子路径裁撤（`:raw` / 组合 `:raw:N-M` ≡ `:N-M` 取代；超尺守卫移至无窗 `:raw`）；② `/transcript` 保留为 canonical 别名（未裁撤）；③ 新增 `thinking`/`system`/`injections` 三个 index-faced 集合面；④ 快照携带 `segments`（per-compaction 段 + live 尾段）；⑤ D4 的「有序 transform 链」不落地（user 裁定 no goal）：保持「单一注册权 + capture-delegate 终端」形态，transforms.ts 保留为类型/死代码，由 Phase-2 FS 层挂载接替；⑥ D7 fs backend spike 维持**不挂载**结论（代码+单测就绪，收益待下一 change 兑现）。


研究底稿：`docs/60_exploration-and-research/04-session-storage/alpha5-compaction-jsonl-mapping.md` §9–§15.11（2026-09-04 ~ 09-11 六轮源码取证 + 实测测绘），本文件只记决策与理由。

## D1 文法（定稿）

`ctx://session/<sub-path>…/[<label|ordinal>][/more…][:raw][:<lines>]`

- slash 子路径（对齐 OMP 自身 `split("/")` 惯例）；dot 链方案已废弃（§15.7/15.8 二修三修史）。
- 方括号：label = 该元素的原生不可变 seq 坐标（compactions 用 `compaction/summary` 事件 seq；消息集合用消息事件 seq），精确命中优先，miss 回落 0-based 序号；序号与 seq 理论可撞、实践无歧义（seq ≫ 序号且稀疏单调）。
- 冒号：行窗 `:N / :N-M / :N+K / :N- / 逗号多区间` 恒作用 canonical；`:raw` = 内容模式（canonical vs prepared 默认面）。
- 判别法则：换内容 → path/brackets；换看法 → colon modifier。命名视图 selector v1 不引入。

## D2 canonical / prepared 二元模型

每个资源节点一份 canonical 内容（`:raw` 返回、行号基准）；部分资源另有 prepared 默认面（裸 URL 返回）。`session`：裸=统计快照、canonical=全文 transcript（**非 JSONL**：JSONL 单行=一事件可达 300KB，行窗无意义；结构化访问由 `[label]` 元素集合承担；transcript 行格式 v1 冻结=行号稳定性契约）。`compactions[N]`：裸=8 段 summary、canonical=shadowed 原文。无 prepared 的资源裸=canonical。`/original`、`/transcript`、`/events` 子路径全部裁撤（本体误当子资源）。

## D3 label 与失败剧集

label = `type:"compaction/summary"` 事件的 `seq`。四项依据：跨 resume 单调稳定（5 个 end-seed 实证）、唯一、失败剧集无 summary 事件故天然排除（对照：compactionId 主键需滤 `end.error`）、log-only 永不被 replace 故不可漂移（checkpoint 节点 seq 会被打标签操作漂移，已否决）。嵌套链：后档 `shadowedSeqs[0]` = 前档 checkpoint seq；summarizer 输入含前档 summary（信息金字塔），CP1 之前原文唯一回溯路径 = CP1 自己的 shadowedSeqs ⇒ manifest 必须显式携带 `replaces_checkpoint`。

## D4 服务形态与 read chassis

`dsh-url-schemes` = cordis service（UrlResolver + handlers，零工具）；四 wrapper = 工具层。read 注册权单一化：同层同名硬错（`NamedEntries`）⇒ chassis + 有序 transform 链（URL → hashline anchor → delegate = captured native read，`ctx.tools.get(name, agent)` 按语义名捕获、session-start 时先于自注册 flush——`get` 自注册后解析回自己即无限递归）。hashline = anchor transform（chassis 缺席 fallback 自持最小 wrapper）。config gates 双开关（urlSchemes/hashline），off 的 branch 直通 captured native。

## D5 ctx handler 重塑

`ctx://session`：prepared = 统计快照（session 头 + identity 吸收 + storage/totals（DSH 原生字段名：user_prompts/agent_messages/block_reasoning/block_tool-call/tool_calls/injected_user_messages/compactions）+ per-segment 分段（按 compaction 切段 + live 热区）+ compacted 清单内联（label/checkpoint_seq/compactionId/at/shadowedRange/shadowedItems/shadowedTokenCount/replaces_checkpoint/summary_preview 8×100 字）+ system_prompt 卡（chars+preview 200））；canonical = 全文 transcript。`ctx://model`/`ctx://cwd` 移除一级 key（信息卡并入快照）；裸 `ctx://` roster 更新；`CTX_UNKNOWN_KEY` 错误改回显 key 清单（L3 模式）。原型实测：6,213 bytes @ 3 压缩（`alpha5-compaction-sample/session-stats.json`）。

## D6 披露（OMP 三层模型落位）

L1 存在性 = `url-schema:general` guidance section（数百字、pointer-first；与 0.2.3-d 单源化不冲突——URL 文法无第二源）；L2' 裸枚举 = `read <scheme>://` 返回 roster/清单；L2'' 情境披露 = compaction hook 打标签时刻；L3 = 响应尾行动 note + 未知 label 回显。

## D7 Phase-2：继承式 fs backend（spike）

`class UrlAwareFileSystem extends SandboxedFileSystem`（fs 域组合惯例 = 类继承，fs-sandbox extends fs-local 为官方先例；继承即委托——未覆写方法自动正确，透传矩阵塌缩为 4-5 个 override）：`resolve` 拦 scheme → virtual FsTarget（`{targetKey: URL 串, displayPath: URL}`——FsTarget 本为非文件后端设计）；`stat` 照答 `{type:'file'}`（校验是 fs 下游消费者，非闸门）；`readText` 解引用；写系对 virtual key 返 typed 只读错误；其余 super。挂载 = home 层同 id 行重述 `fs-sandbox` row（官方 patch 行机制）。风险边界：grep/glob（ripgrep 走真实路径）与锚点（呈现层）仍在工具层；fs 消费者回归面（session/storage/compaction/web）。替代形态否决记录：事件 policy 形态只有否决/记录权（waterfall 无"返回新 target"形状），变不出原文。

## D8 验证与红线

单测（ctx 规格/chassis/gates/hashline fallback/fs spike）→ 4999 第一人称（真实会话 `/compact` → `ctx://session` → label 下钻 → `:raw`/行窗 → 嵌套链回溯）→ 报告 → **user 确认后才有 npm publish**（AGENTS §〇）。

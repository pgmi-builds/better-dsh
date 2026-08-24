# Recallable Compaction（可回溯压缩）— 设计备忘

> 状态：设计备忘（**未实现**）· 2026-08-20 · 用户方向 + API 面 spike 验证通过
> 归属：`dashr/dev/`（gitignored 本地 scratch，不进公开仓库）
> 上游文档：`dev/dashr-compaction-window-and-archive.md`（Feature 2 压缩损失补偿的总纲；本文档是其「回溯通道」的落地设计，并回收其 §3 开放问题中已解决项）

## 0. 背景：Context as variable 的四方向与本 gap

dashr 参考 Prime Agent 的三个核心特点（RLM 模式 / IPython REPL tool calling / Context as variable）中，前两个已完全实现；第三个目前只实现一半。完全体的四个方向：

| 方向 | 状态 |
|---|---|
| 1. 事件流过滤 | ✅ 已实现（`recencyWindowTokens`，Feature 1，v0.1.1+） |
| 2. 运行时变量存取 | ✅ 已实现（kernel 变量自由存取） |
| 3. **上下文压缩与回溯** | ❌ **未实现 ← 本文档** |
| 4. 广义上下文组件化 | ✅ 已实现（Continual Harness / `refine()`） |

方向 3 的缺口：压缩后旧上下文被摘要 shadow，运行时模型无法直接读取原文（原文虽在 session 持久化文件中，但模型经资源工具查询繁琐且难定位）。Feature 2 原设计（强制归档 + 摘要尾部标记）解决「可恢复」，本文档补上「模型可寻址的回溯通道」与全部 API 面验证。

## 1. Spike 结论（2026-08-20，Dash agent 实证 + 本机复验）

> 委托方式：Dash HTTP API（session `session-a2a61011`，`cwd=/home/u1/workspaces/dashr`，rlm-mode preset）。证据脚本 `dev/spike-tag-repro.mjs` 已随文档保存，本机复跑 exit 0、输出吻合。

| # | 事实 | 对设计的影响 |
|---|---|---|
| 1 | surface 是 **append-only + 深冻结** 的不可变投影；唯一写入口 `Session.append`；**不存在原地 patch 节点文本的 API** | 不能 mutate，只能 replace |
| 2 | 「改写单个节点」的官方正解 = 再 append 一个 `replace`，`start === end === 目标 seq`，新节点 shadow 旧节点 —— 这正是上游 compaction 改写历史所用的同一机制 | 挂 tag 的通道 ✓ |
| 3 | 新摘要节点 seq = **`result.summarySeq + 1`**（contractual adjacency；`commitCompactionBody` 源码确认：`compaction/summary` 事件后紧邻 `user/message` 替换节点，`= endSeq - 1`） | 摘要节点可精确定位 ✓ |
| 4 | 被 shadow 的原文**事后仍可读**：`session.events[shadowedSeqs]` 完整保留（append-only log 不删除，shadow 只是从 surface 投影隐去） | **归档不必在压缩前捕获** —— 顺序约束消失 |
| 5 | `user/message` 重写无限制（`assertToolResultRewrite` 只约束 `tool/result`） | 摘要文本可自由追加 tag 块 |
| 6 | 替换节点保留原 `source`（含 `compactionId`）时，下游 checkpoint 识别（`isCompactCheckpointSource`）不破 | tag 挂载无损 ✓ |

**关键修正**：原方案「归档先于压缩」（压缩前取到将被 shadow 的区间 → 归档 → 才允许压缩）不再需要。事实 #3+#4 意味着顺序可以是**先压缩、后归档、再挂 tag**——每一步只依赖已提交的事实，**tag 永不悬挂，无需任何补偿逻辑**。

## 2. 设计：三步流程

在 `compactIfNeeded`（与 `compactNow` 共用）的 `compactRegion` 返回之后：

1. **读原文**（事后，从 append-only log）：`result.shadowedSeqs` → `session.deriveEventMessage(session.events[seq])` → 分类 → 序列化。
2. **写归档存储**：介质二选一（§2.2，待用户拍板）。
3. **挂 tag**：单节点 `replace`（`start === end === result.summarySeq + 1`），把 tag 文本块追加到摘要内容尾部。

归档失败时降级为现状行为（照常压缩、仅无 tag），**不阻塞压缩**（沿用旧 doc 原则）。

### 2.1 分类（沿用旧 doc §2.2，纯机械非语义）

| bucket | 来源 | 说明 |
|---|---|---|
| `user_requests` | user 消息 | 用户指令原文 |
| `assistant_responses` | assistant 消息 | 正文 verbatim；thinking 块剥除与否见开放项 |
| `tool_results` | toolResult 消息 | 含 cell stdout |
| `file_ops` | 机械提取 | read/modified 列表 |

### 2.2 归档介质（开放决策，二选一）

**方案 K — kernel 变量 + dill snapshot**（旧 doc 原方案）：
- 复用 State Storage，实现量最小。
- 代价：(a) trunk 与用户工作变量抢同一个 `capBytes` 预算，超限时**整个 snapshot 被 skip**（连用户变量一起丢）；(b) dill 跨 Python 版本脆弱；(c) 原文常驻 kernel 进程 RAM，随压缩次数线性涨。

**方案 F — 独立 trunk 文件 + kernel 索引 + `recall()` 读文件**（推荐）：
- trunk 本体 = 纯文本 JSON（带 role/seq），落 `kernel-snapshots/<sessionId>/trunks/<compactionId>.json`；kernel 里只放索引 dict（tag → 路径）；`recall(tag)` helper 直接读文件。
- 好处：独立预算天然成立（不吃 snapshot cap）；写入即时持久（无 snapshot 的 1500ms debounce 窗口）；恢复 = 回填索引或重扫目录；绕开 dill 版本问题。
- 代价：recall 读文件比读内存慢几毫秒，对 LLM 无感。
- State Storage 职责因此更清晰：snapshot 管用户工作变量，trunk store 管压缩原文。

### 2.3 tag 与 recall 协议

- tag id：`ctx-<compactionId>`（或自增计数）。
- tag 文本块（挂摘要尾部，格式示例）：

```
[原文回溯: ctx-12]
本轮压缩的原始上下文已归档，需要细节时用 recall('ctx-12') 读取。
```

- `recall(tag)` helper（py-sdk 注入）：保留命名空间藏 trunk 数据（**不暴露裸全局**，防模型 cell 误覆盖/`del`）；只读访问；超长输出截断提示；缺失报明确错误。
- Control Prompt 增加约定段：摘要条目带 `ctx-N` 标签时，需要全文就 `recall('ctx-N')`。
- token 经济学：摘要照常在上下文（tag 一行文本 ≈ 0 成本）；模型只在需要时付出一次读取成本；归档不查询则不进上下文。

### 2.4 预算与淘汰（开放数字）

归档随压缩次数线性增长，必须设上限，否则省下的上下文 token 从 RAM/磁盘侧门还回去。候选：最近 N 档 / 总 token 预算 / LRU。淘汰是安全的——session log 里原文永远在（§2.5）。

### 2.5 自愈（compactionId 稳定性）

tag 携带 `compactionId + shadowedSeqs`；revive 时发现归档缺失，可从 session log 重放重建。本质：**session log 就是原文的持久层，归档只是模型可寻址的快路径缓存**。

### 2.6 两条触发路径（共用挂点）

- auto pressure：`RecencyAwareCompactionEngine.compactIfNeeded`
- manual：`/compact` → `compactNow`
- 挂点都在 `compactRegion` 返回后，路径无关。

## 3. 代码骨架（compactRegion 返回后）

```ts
const result = await this.compactRegion(range.start, range.end, agent, signal)
if (result === null) return null

const session = agent.session
const summaryNodeSeq = result.summarySeq + 1        // contractual adjacency

// 1) 事后读原文（append-only log 完整保留）
const original = result.shadowedSeqs
  .map(seq => session.deriveEventMessage(session.events[seq]))
  .filter((m): m is Message => m !== null)
// 2) 归档（介质见 §2.2，失败则跳过第 3 步、不阻塞压缩）
const tagId = `ctx-${result.compactionId}`
// await archiveRecall(tagId, classify(original))   // 分类见 §2.1
// 3) 单节点 replace 挂 tag
const summaryMsg = session.deriveEventMessage(session.events[summaryNodeSeq])!
session.append('user/message', createUserMessage({
  content: [...summaryMsg.content, { type: 'text', text: `\n[原文回溯: ${tagId}] 全文可通过 recall('${tagId}') 读取。` }],
  source: summaryMsg.source,                        // 保留 compactionId，checkpoint 识别不破
}), {
  surfaceOp: { op: 'replace', start: summaryNodeSeq, end: summaryNodeSeq },
  sourceEventSeqs: [summaryNodeSeq],
})
```

## 4. 与旧 doc §3 开放问题对照

| # | 问题 | 状态 |
|---|---|---|
| 1 | 实现路径 A/B/C | 已裁定方案 B（子类化），Feature 1 已落地 v0.1.1+ |
| 3 | 摘要后编辑口 | **已解决**（本文档 §1）：落盘前无插入口，落盘后单节点 replace 等效；且原文可事后读取，归档无需压缩前捕获 |
| 8 | compactionId 稳定性 | **已解决**（§2.5 自愈：log 重放重建） |
| 4 | 归档增长上限 | 仍开放（§2.4 候选方案） |
| 5 | thinking 块剥不剥 | 仍开放（剥=省空间丢推理过程；留=完整但体积翻倍） |
| 6 | 标记措辞与 token 预算 | 仍开放（§2.3 给出了候选格式） |
| 7 | 与 pruner 的交互 | 仍开放，但假设已变：recency 路径在 compactRegion 前调 `pruneSession`；若 prune 也是 surface-replace 机制，则 log 原文应仍在（append-only），需实现时验证 |
| 9 | recency 低于 system prompt 体积 | Feature 1 已带 no-op 守卫，软警告低优先 |

## 5. 验证计划（实现时执行）

- **单测**：分类落桶（每条消息恰落一桶）、tag 格式、单节点 replace（`dev/spike-tag-repro.mjs` 已是该场景的可运行骨架）。
- **e2e**：灌满上下文 → 触发压缩（auto + manual 各一次）→ 断言：(1) 归档存储含被压缩区间原文；(2) 摘要尾部含 tag；(3) 模型执行 `recall(tag)` 能复述原文某细节。
- **pruner 交互**（开放项 #7）：`pruneSession` 之后 log 里的原文事件是否完整。
- **回归**：未配归档时行为与现状一致（默认全关）；测试只增不减（现有 140/140 不动）。

## 6. 参考

- `dev/dashr-compaction-window-and-archive.md`（Feature 2 总纲 + Feature 1 已实现记录）
- `dev/spike-tag-repro.mjs`（API 面复现脚本，`node dev/spike-tag-repro.mjs` 可复跑，exit 0）
- `dashr/src/compaction/recency-engine.ts`（挂点）、`dashr/src/py-sdk.ts`（recall helper 注入点）
- 上游源码：`@deepseek-ai/dsh-session`（append/surface）、`@deepseek-ai/dsh-compaction-basic/lib/index.js` `commitCompactionBody`（替换节点 append 顺序）、`@deepseek-ai/dsh-compaction`（CompactionResult）
- 委托 spike 报告：`/tmp/a2a/dashr-tag-spike.md`（Dash agent 产出，2026-08-20；关键结论已全部吸收进本文档 §1）

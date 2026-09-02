# DASHR Future Feature: 真滑动窗口 + 压缩损失补偿（强制归档 + 摘要尾部标记）

> 状态：设计备忘（**未实现**）· 2026-08-17 · 用户方向
> 归属：`dashr/dev/`（gitignored 本地 scratch，不进公开仓库）
> 关联分析：`agent-harness/21_CLI-Agent/04_prime-agent/04_prime-agent-paradigm-discussion.md` §4/§8/§9（2026-08-17 源码级核对版）

## 0. 背景与问题定位

**Prime Agent 机制考证结论（DASHR 的参照系）**：

- 触发公式：`contextTokens > window − reserveTokens(16384)`；**`window` 就是模型目录里的 `contextWindow`**（deepseek-v4-pro = 1e6 → 触发点 ≈ 98.36 万），不是框架自己设定的独立门槛。
- 可配置项全集只有 `enabled / reserveTokens / keepRecentTokens / agentCallable`——**不存在独立的 recency 变量**。
- 压缩 ≠ 销毁：session JSONL 全量留盘，损失发生在热上下文；但摘要链式累积、预算 ≈ 13K tokens，语义/细节损失不可逆。
- kernel 变量需要模型**显式写入**，存在远见盲区（"你不可能知道你不知道的东西"）。

**DASHR 现状映射**（`dashr/src/compaction-surface.ts`）：

- `compactIfNeeded(agent, trigger: 'pressure' | 'context-overflow')`——自动压缩入口，阈值由宿主引擎（dsh-compaction-basic）决定；低于阈值是 `null` no-op。
- `compactNow(agent, ...)`——显式 `/compact` 入口（busy-gated）。
- `ctx.tokenMeter.measure(session)` → `totalTokens`——压力可测，阈值不可配。
- DASHR 侧引擎（design A）：`BasicCompactionEngine`（compactModel = 压缩大模型）。

**由此引出两个待开发点**：

- **P1**：没有独立滑动窗口 → 压缩只在大模型上限附近触发，运营者无法控制 recency 质量（"被模型上限倒逼的窗口"，不是设计的窗口）。
- **P2**：压缩语义损失不可逆——例如某轮 agent response 10KB 被摘要成 2KB，摘要质量与关键字保留不可控；而 kernel 常驻变量需要模型在损失发生**之前**自觉写入，该自觉不可靠。

**用户裁定（上限声明）**：信息损失不可逆，最多只能做到——压缩时**强制归档原文到 kernel 变量** + 摘要尾部**打标记**；让后续大模型在看到摘要时自行判断"有没有必要调用这个原始上下文"。此为本 feature 的目标，不承诺更多。

## 0.5 开发前重点调研：Comparison Basis（引擎机制已核实 2026-08-17）

> 用户指定：开发本 feature 前必须先调研的部分。以下为 dsh-compaction-basic 源码级核实结果，剩余未决项见 §3。

**被动压缩的触发机制（"每轮都会检查"确认）**：`BasicCompactionEngine._registerAutomaticCompaction()` 注册 `ctx.on("agent/pre-step", ...)` —— **每个 agent step 之前**调用 `compactIfNeeded(agent, "pressure")`。溢出路径：`agent/request-error`（CONTEXT_WINDOW_EXCEEDED）→ `compactIfNeeded(agent, "context-overflow")`。

**现状阈值（关键事实）**：
- 阈值 = `thresholdTokens = floor(modelContextWindow × thresholdRatio)`，默认 `thresholdRatio = 0.8`（per-model 可覆盖，见 `modelPolicies`）。**没有绝对 token 阈值配置键**——阈值永远是"模型窗口 × 比例"。
- 保留 = `retainTokens`（绝对键**已存在**）否则 `floor(window × retainRatio)`，默认 `retainRatio = 0.16`（1M 模型 = 160K！）。
- 触发检查是单次比较：`measurement.totalTokens < spec.thresholdTokens → return null`（no-op）。
- 校验已内建：`retainTokens >= thresholdTokens` 直接抛 `TargetPressureConfigError`（retention 必须 < threshold）。
- 摘要预算 `maxTokens` 默认 8192。

**token 计量口径**：`ctx.tokenMeter.measure(session).totalTokens` = 最近一次耐用请求 envelope 定价（含 system prompt/tools/messages，即"everything"）+ surface 节点折叠。**surface 节点 = 对话消息**（system prompt 是请求时组装、不在 surface 上 → 永不进压缩区间 ✓）；**首条 user 消息是 surface 节点，可被压缩**（与"User Prompt 一定保留"的假设不符——其内容只靠摘要质量保全；这正是 Feature 2 归档 user_requests 的理由）。

**集成面结论（两条路径共用）**：
- 引擎是 `BasicCompactionEngine extends CompactionEngine`；官方注释：`compactIfNeeded` **动态分发，子类 override 会被事件时刻尊重**；`summarize()` 是唯一声明子类化钩子。
- `selectCompactableRange`（从尾部回攒 retainTokens + tool-pairing 边界保护）是模块私有函数——子类自行触发低于阈值压缩时需复刻（约 20-30 行，可用 session.surface + tokenMeter 复现）。
- Feature 2 的摘要后编辑口：`compactSurfaceRegion` 产 `compaction/start → compaction/summary → compaction/end` 事件；摘要落盘前是否可插（wrapper/事件改写）尚未验证——**待调研项**。
- 标准 preset 的 compaction realm：`compaction-basic`（无配置=全默认 auto:true）+ `command-compact` + `tool-result-pruner`（thresholdChars 8192/4096/1024），isolate: {compaction, toolResultPruner}。

**实现路径：用户裁定 2026-08-17 = 方案 B（子类化）**。否决 A（fork 维护代价）；C（上游 PR）留作长期收尾。

方案 B 的官方依据（上游注释原文）：`compactIfNeeded` 动态分发，"subclass overrides are honored at event time"。关键利好：配对守卫 `toolPairingBalancedBefore` 是 `@deepseek-ai/dsh-compaction` 的**公开导出**（dsh-rlm-mode 已有该 peer），无需复刻——真正要写的只有选区间循环（约 15 行）+ `compactIfNeeded` override（约 20 行）+ 配置剥离。子类路径所需的上游私有函数（`resolveTargetPolicy` / `selectCompactableRange` / `routedTarget`）全部绕开：recency 是**绝对值**，不需要模型窗口/策略解析；保留尾用全局 `retainTokens` 绝对值。

**干预/还手语义（用户 Q1/Q2，2026-08-17 源码级裁定）**：

- **未触发分支 = 纯介入比较 + 完全还手**：`override compactIfNeeded` 里先比较 `totalTokens < recencyWindowTokens`，未触发则 `return super.compactIfNeeded(agent, trigger, signal)`——原生逻辑原封不动接管（其 0.8×window 阈值检查、prune、选区间、摘要、事件落盘全部原生）。这正是"只负责介入比较、比较 pass 之后直接还给它"。
- **触发分支无法还手给原生 pressure 路径**：原生内部有硬阈值检查（`measurement < spec.thresholdTokens → return null`），recency 低于原生阈值时还手 = no-op。唯一强制入口是 `trigger='context-overflow'`，但其语义是 `retainTokens=0` 的最大化压缩（只留最后一个节点），破坏 50K 保留语义，不可用。
- **触发分支的最小干预**：我们只做选区间（15 行，替代原生模块私有的 `selectCompactableRange`），产出 `{start, end}` seq 后交给**原生公开方法 `this.compactRegion(start, end, agent, signal)`**。下游全原生：`validateSurfaceRegion`（区间存在性 + 配对复查）→ 并发锁（assertCompactionInactive，compaction/start 即持久锁）→ 摘要（compactModel）→ surface 区间替换为 summary 节点 → compaction/end。原生没有 keepRecent 概念——它只认区间；我们把 retainTokens 翻译成区间，等价于只替换了原生 selector 这一个函数。

**单位换算说明**：1 token ≈ 4 英文字符（≈4 bytes）；中文 ≈ 1-1.5 字符/token（≈3-5 bytes）。即 1 token ≈ 1.5-4 bytes（用户估算的 1.x-2 是下界）。500K **tokens** ≈ 1-2MB 混合文本。**结论：配置保持 tokens 单位**（与 retainTokens/thresholdRatio/meter 全链路一致），不做 byte→token 内置换算——换算随语言漂移，且 meter 本身是估算（chars/4 级精度），换算会制造虚假精度。默认值 500K tokens 即可（用户：先跑机制，exact 取值交给实际用户）。

## 1. Feature 1: 真正的滑动窗口设置变量

### 1.1 设计（2026-08-17 用户方向 + 源码核实）

- **命名**：配置键 `recencyWindowTokens`（tokens），用户侧显示名 **Context Recency Window（CTX Recency Window）**。缺省/未设 = 现状行为（引擎阈值 = 0.8 × 模型窗口），默认关闭、行为逐字节一致。
- **触发机制**：不区分 post/pre-execution——直接在被动压缩的**既有检查点**（`agent/pre-step` → `compactIfNeeded('pressure')`）上把单次比较改为**双阈值 OR**：
  `触发 ⇔ totalTokens > recencyWindowTokens（阈值一） OR totalTokens > thresholdRatio × modelContextWindow（阈值二，现状不变）`
  数学上等价于 `totalTokens > min(阈值一, 阈值二)`，**无需比较两个窗口谁大谁小**：模型窗口小（250K）→ 阈值二先触发；模型窗口大（1M）→ 阈值一先触发。与用户例子完全一致。
- **不设硬约束**：无"recency < modelWindow − reserve"的启动校验。recency > 模型窗口时由阈值二兜底，天然安全。唯一依赖的是引擎已有守卫：`selectCompactableRange` 在 `keepFromIdx === 0` 时返回 null（无可压缩区间 → no-op，不崩溃）。
- **reserve 说明**：dsh 没有 reserveTokens 概念——0.8 比例即内建余量。阈值一的比较值建议直接取 `recencyWindowTokens`（余量由运营者定值时的保守程度承担），不做 `−16384`。
- **两个变量并存（用户裁定，合并方案已否决）**：
  - (a) `recencyWindowTokens`：全局可配置的**触发**阈值（上限）；
  - (b) `retainTokens`：无论压缩来自 pressure/overflow/manual，每次执行后保留的**就近上下文目标值**（下限）。
  合并则退化：阈值 500K、触发于 480K、压缩后仍保留 480K = 无压缩。且上游校验已强制 `retainTokens < thresholdTokens`，两变量不变量已机器化。
- **retainTokens 调大**：20K（Prime Agent 默认；dsh 实际默认是 0.16×窗口）→ **50K 绝对 tokens**。dsh 的 `retainTokens` 绝对键已存在——**纯 preset 配置，零代码**。
- **口径澄清**：触发计量（totalTokens）含 system prompt/tools/消息 = everything；保留目标（retainTokens）只走 surface 消息节点——system prompt 组装于请求时、不在 surface 上，天然不计入保留；首条 user 消息在 surface 上、超尾会被压缩（由 Feature 2 归档兜底）。
- **压缩后体积估算**：1M 模型、retainTokens=50K → 压缩后 = 摘要（≤8192）+ 50K 尾 + system prompt ≈ 60-90K，与用户估算一致；挂在 250K 旧模型上仍只占 ~三分之一窗口。
- **配置通道（"全局"如何落地）**：DASHR 插件配置 schema（`z.intersect`）新增 `recencyWindowTokens`（可选）；apply() 里当该键存在时，把 design A 挂载的引擎从 `BasicCompactionEngine(auto:false)` 换成 `RecencyAwareCompactionEngine(auto:true, retainTokens 透传)`；preset 行 config 直接写 `recencyWindowTokens: 500000` + `retainTokens: 50000`。全局 = per-composition（preset 级），用户可改。
- **recency 路径激活条件**：`recencyWindowTokens` 与绝对 `retainTokens` **必须同时配置**（recency 选择算法需要具体保留尾预算；只给 ratio 时委托上游路径）。构造时校验 `retainTokens < recencyWindowTokens`（镜像上游 `retainTokens < thresholdTokens` 的不变量，机器化）。
- **双引擎并存语义**：标准 preset 的 compaction-basic（auto:true, 0.8×window）与 DASHR 的 recency 引擎（auto:true, 500K）各自监听 agent/pre-step，顺序执行。第一个压缩动作落地后 measurement 降到双阈值之下 → 第二个引擎 no-op。min() 语义由两个引擎的 no-op 守卫自然涌现，无需改标准行。
- **未决**：recency 低于 system prompt 体积时的退化为每 step no-op 检查（可接受，或加软警告）。

### 1.15 命名与配置通道裁定（2026-08-17）

- **配置键 = `recencyWindowTokens`**（候选 `ctxRecencyWindow` 否决）。三条理由：
  1. DASHR 既有键的单位后缀是房规：时间 `*Ms`（runTimeoutMs…）、体积 `*Bytes`（maxOutputBytes、snapshotSizeCapBytes）——带单位后缀是既定风格；
  2. 与上游引擎同级键 `retainTokens`/`maxTokens` 同族，且与 `retainTokens` 成对（触发阈值 / 保留尾），一眼可读关系；
  3. `ctxRecencyWindow` 的 `ctx` 前缀在 cordis 代码库里读作 Context 成员（`ctx.*` 遍地），歧义大，且不含单位（K tokens/K bytes 之惑永久保留）。
  **用户可见显示名**仍为 "Context Recency Window / CTX Recency Window"——显示名与配置键分离，机器名带单位、人读名不带。
- **值格式**：整数 tokens（如 500000），与 `retainTokens` 一致（zod `z.number().step(1).min(1)`）；不接受 "500K" 字符串（YAML 无此字面量、上游 schema 是数字）。K 换算只写进 preset 注释。
- **加载通道 = 插件配置（preset 行 config），不是 env、不是宿主 settings.json**：
  1. preset 行 config 是 DASHR 现有调优键（compactModel/harnessDir/refineModel）的唯一家园，`recencyWindowTokens` + `retainTokens` 直接进 dashr-kernel 行的 `config:` 块，随 preset 分发（install.sh 无需再 sed——500K/50K 是通用默认，非机器特定）；
  2. **否决 env var**：项目已裁定"运行时无 env 变量"（kernel python 是 baked 值，env 只留 `?? 'python3'` 兜底）；调优旋钮走 env 会打破"preset 是单一事实源"；
  3. **否决宿主 settings.json**：settings.json 属 host-plane（provider/凭证/端口），compaction 策略是 composition 所属（compaction realm 在 preset 内，标准 preset 拥有 compaction-basic 行）；放 settings.json 还会强制所有 preset 同一值，与"per-composition 全局"语义不符（用户"全局"= 该 composition 内跨模型一个旋钮，非 host 全局）。
  4. 附带收益：插件 zod schema 声明后，dsh web 的 plugin settings UI（dsh-client-ui-settings-plugins）可直接渲染表单字段。

### 1.2 验证点

- 1M 模型 + recency 500K：~500K 触发（阈值一）；250K 模型 + recency 500K：~200K（0.8×250K）触发（阈值二）——两种顺序各测一次。
- 不配 recencyWindowTokens 时行为与现状一致（默认关闭，对照实验）。
- retainTokens=50K：压缩后表面 = 摘要 + ~50K 尾；`retainTokens < min(recency, 0.8×window)` 校验生效。
- overflow 路径不受影响（`context-overflow` 绕过正常阈值与保留策略，仍为硬兜底）。

## 2. Feature 2: 压缩损失补偿（强制归档 + 摘要尾部标记）

### 2.1 拦截点（两条触发路径共用）

在"摘要执行之前"统一插入归档步骤：**取到将被摘要（shadow）的原始消息区间 → 分类 → 序列化 → 写 kernel**。归档完成后才交给引擎做摘要。归档失败时降级为现状行为（照常压缩、仅无标记），**不阻塞压缩**。

### 2.2 分类（纯机械，不是语义分类）

| bucket | 来源 | 说明 |
|---|---|---|
| `user_requests` | user 消息 | 用户的指令原文 |
| `assistant_responses` | assistant 消息 | 正文 verbatim；thinking 块剥除（见开放问题） |
| `tool_results` | toolResult 消息 | 含 cell stdout |
| `file_ops` | 机械提取 | read/modified 列表（引擎已有该追踪） |

**"分类"是机械强制，不是语义判断**：每条消息按角色恰好落一个桶，无模型参与——语义分类是摘要模型的工作，归档层不做。这是"强制"二字的含义：不依赖模型意愿，不依赖判断质量。

### 2.3 写入形态

- **单一稳定变量名 `dashr_compaction_archive`**（dict，key = compactionId/时间戳），标记里只引用一个名字，模型认知成本最低：

```python
dashr_compaction_archive["<compactionId>"] = {
    "meta": {"at": ..., "reason": "pressure|context-overflow|manual", "seqs": [...], "tokens": N},
    "user_requests":       [{"seq":..., "ts":..., "text":...}, ...],
    "assistant_responses": [{"seq":..., "ts":..., "text":...}, ...],
    "tool_results":        [{"seq":..., "ts":..., "tool":..., "text":...}, ...],
    "file_ops":            [{"seq":..., "op":..., "path":...}, ...],
}
```

- 写入通道：沿用 bootstrap 模式（`bootstrap.ts` / `python.ts` 的 `_dashr_*` helper），注入 `_dashr_archive_compaction(payload_json)`；TS 侧把归档区间序列化为 JSON，经 `IPythonCodeRuntime` 的 executeCell 执行赋值。JSON 序列化——安全、可被模型用 `print`/`json` 回看。
- 持久性：kernel dill 快照已覆盖重启恢复；可选按会话目录落一份 JSON 镜像（防 kernel 死亡）。
- 成本：只占 kernel 内存；**不查询就不进上下文**，上下文成本 = 0。

### 2.4 摘要尾部标记

摘要产出后，机械追加固定格式标记块（不依赖摘要模型自觉）：

```
[compaction archive]
本轮压缩的原始上下文已完整写入 kernel 变量 dashr_compaction_archive["<compactionId>"]：
  assistant_responses ×N / tool_results ×N / user_requests ×N / file_ops ×N
需要原文细节时用 run_cell 读取，例如：
  print(dashr_compaction_archive["<compactionId>"]["assistant_responses"][0])
```

- **目的**（用户原话精神）：让后续模型在看到摘要时，能**判断"我有没有必要去调用这个原始上下文"**。标记提供的是**可判断性**，不是自动恢复——是否回看仍是模型的决策。
- **集成风险（已解决 2026-08-20）**：原担心「需要引擎摘要产出的后编辑口」——已实证：落盘前无插入口（surface 深冻结 append-only），但落盘后**单节点 `replace`（start===end===摘要节点 seq）**可等效改写摘要文本（这正是上游 compaction 改历史同一机制）；且被 shadow 原文在 append-only log 中事后完整可读，归档无需在压缩前捕获。细节与代码骨架见 `dev/recallable-compaction.md` §1/§3。备选方案（紧随 summary 追加独立消息）亦天然可行，但不再需要。

### 2.5 不解决什么（诚实边界——用户已裁定为上限）

1. **损失不可逆**：归档不防止损失，只让原文**可恢复**。
2. **摘要质量不可控**：10KB → 2KB 摘要的质量、关键字保留率，无人可控。
3. **检索缺口依旧**：模型仍需决定去查。标记只把"想不起来查"降级为"知道能查"，把"永久失忆"降级为"可恢复但需要主动想起"。
4. 归档**永不自动**进上下文；标记成本 = 每次压缩约 1 行文本。

## 3. 开放问题（实现前定）

1. **实现路径 A/B/C**（fork / 子类化 / 上游 PR）——§0.5，Feature 1 开工前必须先定。
2. **阈值一的比较值**：直接 `totalTokens > recencyWindowTokens`（推荐）还是 `> recencyWindowTokens − 16384`（仿 PA reserve）。
3. **Feature 2 摘要后编辑口**：~~待验证~~ → **已解决（2026-08-20）**：`compactSurfaceRegion` 的 summary 事件无落盘前插入口，但落盘后单节点 replace 等效改写；原文可事后从 append-only log 读取（`session.events[shadowedSeqs]`）。结论与推荐实现见 `dev/recallable-compaction.md`。
4. **归档增长上限**：跨多次压缩无限增长 → 策略候选：保留最近 N 档 / 总字节上限 / 提供手动清理 binding。
5. **thinking 块**：`assistant_responses` 剥不剥 thinking？（剥 = 省空间但丢推理过程；留 = 原文完整但翻倍体积）
6. **标记格式与 token 预算**：标记块精确措辞、是否进摘要 token 预算。
7. **与 V2 post-execute 内容替换（pruner）的交互**：归档在替换前还是后取数。
8. **compactionId 稳定性**：标记引用的 key 在 kernel 重启/会话恢复后是否仍可解析。
9. **recency 低于 system prompt 体积**：每 step 触发 no-op 检查（守卫已存在）；是否加软警告。

## 4. 验证计划（实现时执行）

- **单元**：分类逻辑（每条消息恰落一桶）、标记格式、compactWindow 触发算式、越界校验。
- **e2e**：灌满上下文 → 触发压缩（两条路径各测一次）→ 断言：
  1. kernel 里存在 `dashr_compaction_archive["<id>"]` 且含被压缩区间原文；
  2. 摘要尾部含标记块；
  3. prompt 模型"回看变量并复述原文某细节"成功（证明可调用性）。
- **回归**：未配 compactWindow / 未配归档时，行为与现状一致（默认全关）。
- 测试只增不减（现有 140/140 不动）。

## 5. 参考

- `agent-harness/21_CLI-Agent/04_prime-agent/04_prime-agent-paradigm-discussion.md` §4/§8/§9（滑动窗口=模型上限投影的源码证据、压缩语义损失讨论）
- `dashr/src/compaction-surface.ts`（compactIfNeeded / compactNow / tokenMeter 面）
- `dashr/src/runtime.ts`（IPythonCodeRuntime / executeCell）、`bootstrap.ts` + `python.ts`（`_dashr_*` 注入模式）

## 附录 A. 方案 B 代码骨架（2026-08-17 草案，未实现）

```ts
// dashr/src/compaction/recency-engine.ts（草案）
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { toolPairingBalancedBefore } from '@deepseek-ai/dsh-compaction'
import type { Service } from 'cordis'

export class RecencyAwareCompactionEngine extends BasicCompactionEngine {
  private readonly recencyWindowTokens: number | null

  constructor(ctx: Context, config: Record<string, unknown> = {}) {
    // 上游 resolveConfig → validateKeys 会拒绝未知键，recency 键必须在这里剥离
    const { recencyWindowTokens, ...upstreamConfig } = config
    super(ctx, upstreamConfig)   // auto:true 时上游构造器注册 pre-step 监听
    this.recencyWindowTokens = recencyWindowTokens ?? null
    if (recencyWindowTokens != null) {
      if (this.config.retainTokens === undefined) {
        throw new Error('RecencyAwareCompactionEngine: recencyWindowTokens requires absolute retainTokens')
      }
      if (this.config.retainTokens >= recencyWindowTokens) {
        throw new Error(`RecencyAwareCompactionEngine: retainTokens (${this.config.retainTokens}) must be less than recencyWindowTokens (${recencyWindowTokens})`)
      }
    }
  }

  override async compactIfNeeded(agent, trigger, signal) {
    // 非 pressure（overflow 兜底）或未配置 recency / 无绝对保留 → 完全委托上游
    if (trigger !== 'pressure' || this.recencyWindowTokens === null || this.config.retainTokens === undefined) {
      return super.compactIfNeeded(agent, trigger, signal)
    }
    // ── recency 路径：镜像上游 pressure 流程，阈值换成绝对值 ──
    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session)
    if (measurement.totalTokens < this.recencyWindowTokens) {
      // 未到 recency 阈值：交给上游 0.8×window 阈值（阈值二的 OR 语义）
      return super.compactIfNeeded(agent, trigger, signal)
    }
    const prune = this.ctx.get('toolResultPruner')
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session)   // prune 可能已压回阈值下
    }
    if (measurement.totalTokens < this.recencyWindowTokens) return null
    const range = selectRecencyRange(agent.session, measurement, this.config.retainTokens)
    if (range === null) return null                 // 无可压缩区间（全在保留尾内）
    return this.compactRegion(range.start, range.end, agent, signal)
    // 注：compactRegion 是上游公开方法，内部会再次校验配对边界与并发守卫
  }
}

/**
 * 复刻上游 selectCompactableRange（模块私有）的选区间逻辑。
 * 唯一依赖的"守卫"是 @deepseek-ai/dsh-compaction 的公开导出。
 */
function selectRecencyRange(session, measurement, retainTokens) {
  const nodes = measurement.nodes              // [{seq, tokens}] 模型可见顺序
  const surfaceSeqs = session.surface.nodes    // [seq...] 当前表面
  if (nodes.length === 0) return null
  if (nodes.length !== surfaceSeqs.length ||
      nodes.some((node, i) => node.seq !== surfaceSeqs[i])) {
    throw new Error('compaction: token-meter surface does not match the current session surface')
  }
  // 1) 从尾部往回攒够 retainTokens → 保留尾起点 keepFrom
  let accumulated = 0
  let keepFrom = nodes.length
  for (let i = nodes.length - 1; i >= 0; i--) {
    accumulated += nodes[i].tokens
    keepFrom = i
    if (accumulated >= retainTokens) break
  }
  if (keepFrom === 0) return null              // 整个 surface 都在保留尾内 → 无区间
  // 2) 边界下移直到不切开 tool-call/result 配对
  while (keepFrom > 0 && !toolPairingBalancedBefore(session, surfaceSeqs[keepFrom])) {
    keepFrom--
  }
  if (keepFrom === 0) return null
  // 3) 压缩区间 = [surface 头, keepFrom−1]
  return { start: surfaceSeqs[0], end: surfaceSeqs[keepFrom - 1] }
}
```

**挂载**（apply() 内，design A 处替换）：`recencyWindowTokens` 存在时构造 `RecencyAwareCompactionEngine(ctx, { ...引擎配置, recencyWindowTokens, auto: true })`，否则维持现状 `BasicCompactionEngine(auto:false)`。动态 import 保持不变（optional peer 不加载路径不变）。

**spike 清单（2026-08-17 live 全部通过，webtest profile + rlm-mode-live preset，recency=2000/retain=500 测试值）**：
1. ✅ 隔离 realm 收到根 `agent/pre-step`——压缩真实触发（cordis 机制：子上下文经原型链共享 `_hooks` 注册表；`next` 链只在 `waterfall` 派发时存在，emit/parallel 无 next）；
2. ✅ 双引擎并存：recency 引擎先触发、标准引擎 no-op，无冲突无错误；
3. ✅ `toolResultPruner` 向外解析正常；
4. ✅ live 会话产出合法 `compaction/start → compaction/summary → compaction/end` 事件链（10 个事件、3 轮压缩，shadowedSeqs 正确），摘要 checkpoint 进入 surface，**kernel 状态跨压缩存活（压缩前 `x = 42`，压缩后 cell 读出 42）**。

**live spike 的操作教训（重要）**：
- **profile 选择**：`DSH_PROFILE` 环境变量无效；自定义 profile 用 `dsh --profile <name> --port <port>`（root 命令形式）。`dsh web` 子命令不接受 --profile（"boot the web profile" 硬编码 web）。教训：3082 曾静默运行在 web profile（旧 0.1.0 包）上，全部"矛盾现象"源于此——诊断前先验证进程 maps/lsof 确认实际加载的包路径。
- **本地重装同一版本号不生效**：pnpm 对同路径同版本的 `file:` 依赖按 lock 缓存，不重新安装。本地迭代必须**递增版本号**（0.1.1-recv.N 系列），或删除 profile 的 pnpm-lock 条目。
- **测试 profile 需要 `@deepseek-ai/dsh-web-app` bundle**：`dsh plugin --profile X add` 新建的 profile 只有 dsh-base，不绑 web 端口；手动把 `@deepseek-ai/dsh-web-app` 加进 profile package.json 的 `dsh.profile.bundles`（bundle 从宿主 node_modules 解析，无需 pnpm 安装）。

## 附录 B. dsh 压缩摘要结构调研（2026-08-17，用户 Q3）

**结论：dsh 的摘要不是 free text，是固定 8 段的结构化 checkpoint**（`dsh-compaction-basic` 的 `COMPACTION_INSTRUCTION`）。

落盘形态：`<compacted-summary>` … `</compacted-summary>` 标签包裹 + 固定 preamble（"This is an automatically generated checkpoint condensing an earlier span…Treat the captured context as established background and build on it without restating it…"），替换节点以 user message 形态回到 surface。

固定结构（顺序不可变、每段必出、空段写 "(none)"）：

1. **Primary Request and Intent** — 用户原始与演进目标；措辞关键处要求 verbatim 引用
2. **Key Technical Concepts** — 技术/框架/模式/约定
3. **Files and Code** — 精确路径 + 为何重要 + 关键改动/片段
4. **Errors and Fixes** — 错误及解法 + 相关用户反馈
5. **Pending Jobs** — 已明确请求但未完成的工作
6. **Current Work** — 检查点时刻的进行中状态
7. **Next Step** — 单一的下一个动作（或 "(none)"）
8. **Critical Context** — 决策及理由、约束、用户偏好、开放问题、续作所需数据

规则要点：terse bullets（非散文段落）；精确保留路径/命令/错误串/标识符/函数签名/语法片段；忠实捕获用户反馈与修正；不提摘要行为本身；已有前 checkpoint 时不逐字复制——保留仍真的事实、丢弃过时的、在新结构下合并。

**与 Prime Agent 对照**：PA 结构 = Goal / Constraints & Preferences / Progress(Done/In Progress/Blocked) / Key Decisions / Next Steps / Critical Context / read-files / modified-files。两者同为结构化 8 段、同一精神（目标/进度/下一步/关键上下文 + 负载段 verbatim）；dsh 有 Errors and Fixes + Current Work（PA 用 Progress），PA 有 read/modified 文件台账（dsh 融进 Files and Code）。执行差异：dsh 的摘要指令作为**最终 user message 追加在重放的对话之后**、复用会话自己的 system prompt——是为了命中 provider KV cache（前缀不变）；PA 用独立摘要 prompt + aux model。预算差异：dsh `maxTokens` 默认 8192 vs PA ≈13K。

**对 Feature 2 的含义（记录备查）**：摘要节点是一个带标签的 user message——归档标记的追加点 = 该节点内容尾部（`</compacted-summary>` 之后或节点内追加），比"改写引擎"更简单；待实现时验证事件后编辑口即可。

# v0.1.8d artifacts — 原生 dsh 宿主上的工具面快照(agent 第一人称)

- **采集**: 2026-08-27 10:15 HKT,session = 本会话
- **宿主**: 原生 `@deepseek-ai/dsh`(非 DASHR 部署),呈现模式 `native`(源码级确认:`dsh-tools` 构造器默认 `mode = "native"`,仅注册 wire 通道,`sdkSection` 对 native scope 渲染空并从 prompt 丢弃)
- **采集者**: 运行时内的 agent 自身——与《v0.1.8d 实测报告》同方法论的第一人称实测

## 文件

| 文件 | 内容 |
|---|---|
| `functions.json` | 本会话上下文中的**全量工具声明**(25 个),按声明序(字母序)转写为 `{name, description, parameters}` JSON 数组 |
| `skills-catalog.snapshot.md` | 技能目录快照(prompt 文本通道;7 个技能,含截断原样保留) |
| `wire-vs-transcription.diff.md` | **三角对照报告 + v2 修正**:wire 捕获 vs 本转写 vs checkout 源码,7 处差异明细;完整日志证据推翻时间轴漂移解释,改为"双通道并行各持一代" |
| `tools-sdk.typescript.txt` / `tools-sdk.python.txt` | **SDK 化工具目录**(`tools:sdk` section 双语言渲染产物,即 DASHR `dashr:tool-catalog` 顶替的上游同名槽位内容)。注意:**非本会话上下文转写**——native 模式下该 section 对我渲染为空,本文件是重构产物(方法见下节) |
| `tools-sdk.output-schemas.json` | 渲染输入的 25 个 output schema 原文——输出契约**从不上 wire**,是 SDK 目录独有的信息增量 |
| `code-mode-repl-only.observation.md` | **姊妹篇(2026-08-27 14:03 HKT 追加,另一会话)**:同一机器上 code 模式(PTC)会话的三面实测——wire `tools`=[`run_code`] 仅 1 个、25 工具 SDK 目录内嵌于 system 字符串(28.8 KB/79%)、REPL 25 callables、嵌套调用以 `tool/code-dispatch` 落日志;经 `$DSH_SESSION_JSONL` 会话内自采 wire,确认模式是 `code` 而非 `both` |
| `dsh-session-session-4a293388-….jsonl` | 本会话日志的**完整导出**(3890 条,2.2MB,11:51 存入;覆盖 04:21 会话创建 → 11:17 turn 8 结束的全量,含 10:15–11:17 的本次采集与 README 撰写回合) |
| `dsh-session-session-4a293388-….w-sample-0435.jsonl` | 用户预先 staged 的 04:35 中途快照(390KB,544 条记录;内含 04:20–04:25 三个回合的 `request/header` wire 原貌——对照的 W 样本,非本次采集产物)。经校验为完整日志的逐字节前缀,信息无损失 |
| `README.md` | 本文件:方法、保真度声明、源码交叉验证、与报告四层矩阵的映射 |

## 采集方法与保真度声明(必读)

1. **非宿主抓包**。wire 的字面序列化(XML 还是 JSON、空白、键序)从会话内不可观测;本文件是模型从自身上下文的转写再生:名称、描述文本、Schema 结构与所需字段逐字转写,序列化细节归一化为 JSON。
2. **字节级一致不作承诺,但做了双重交叉验证**:源码锚点逐字命中(见上表);用户 staged 的本会话日志导出提供了 04:2x 回合的 wire 原貌,与本转写 19/25 语义全同、7 处差异全部归因于宿主代际漂移(见 `wire-vs-transcription.diff.md`)。
3. 这个采集行为本身是报告 §6.1 "L0 不可观测"的活例:agent 能观测呈现产物(本 dump),不能观测注册表,也不能观测自己没被呈现的部分——所以"25 个"只能证伪为"至多 25 个可见",不能证明注册表里没有更多。

## 源码交叉验证(锚点 → `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh`)

| 锚点 | 结果 |
|---|---|
| `glob` 描述 "…including hidden and ignored files…modification-time order…" | `dsh-tool-fs-search/lib/index.js:780` **逐字命中**;源码为模板串,`${caps.maxResults}` 实例化为 100,与所见一致 |
| `list_agents.scope` 可选、默认 children | `dsh-tool-subagent-control/lib/types/list-agents.js:66-72` 参数无 `required` 数组,与所见一致 |
| `workflow` phases items 含 `provider`/`model` | `dsh-tool-workflow/lib/types/index.js:175-188` 一致 |
| `list_agents` 长描述 | `list-agents.js:55-65` 逐字命中 |
| **分歧(已被三角对照取代,详见 `wire-vs-transcription.diff.md`)** | 用户 staged 的本会话日志导出含 04:20–04:25 的 wire 原貌:与 checkout 源码在此两处**一致**,而与 10:15 当前上下文不一致——结论:checkout 与 04:2x wire 同代,当前部署更新一代 |

**对照总量**:wire 捕获与本转写 25 个工具同名同序,**19/25 语义全同**(含 `bash`/`workflow` 超长描述逐字一致);6 个工具 7 处短句/字段级差异。**代际解释已在 v2 修正**(见 `wire-vs-transcription.diff.md` 修正节):完整日志证明 5 个 header(04:20→10:11:55)的 wire 逐字节一致(从未变过),而首次转写写入(10:17:46)已是新代——差异不是时间轴上的宿主漂移,而是 **wire 通道与模型侧渲染通道同时各持一代**。模型无法从内部判定自己上下文的代际。

## SDK 目录重构方法(tools-sdk.* 文件的来源)

**为什么只能重构**:本会话呈现模式为 `native`,`sdkSection()` 对 native scope 渲染空字符串——这份目录**从未进入我的上下文**,不存在"转写"路径。重构用部署物自己的代码完成,模型只做编排:

1. **渲染器**:checkout 的 `@deepseek-ai/dsh-tools` 是 ESM bundle,`renderToolsSdk`(TS)/`renderToolsSdkPy`(Python)本就是公开导出(早前"`SDK_RENDERERS` 不公开"的判断有误——导出列表被 `head -5` 截断所致)。直接 `require` 调用,零改写。源码自述确定性:字典序、不变工具集产出逐字节相同文本。
2. **输入**:按 `sdkSchemas()` 的投影形状拼装 `{name, description, parameters, output}`——name/description/parameters 取自 04:2x wire 捕获(= 全部 5 个 header 的唯一一代),`output` schema 以捕获式 stub ctx 逐包调用 14 个 dsh-tool-* 插件的 `apply()`/定向构造器,从 `ctx.tools.register` 落地点收割(26 个定义,按 wire 25 个取用;`subagent_fork` 与 `subagent` 为同一工厂以 config `toolName` 区分——cordis.patch.yml:325-329 证实部署确实双实例化)。
3. **保真边界**:渲染代码 = 部署代码(逐字节);输入的 name/description/parameters = wire 旧代(与当前渲染通道差 7 点,见 diff.md);output = checkout 包内定义(与 wire 同代)。`plan-mode` 以 stub `section` 实例化(仅影响 section 名,不影响工具定义);`fs-search` 以 `sampleOverCapGlobResults: true` 构造(wire 描述中的超额保存行为印证部署值)。

**结构性发现**:
- **输出契约是 SDK 目录独有通道**:`ToolOutputMap`(如 `read` 的 `{path, offset, lines[{number,text}], totalLines}`)从不上 wire。`code` 模式下 SDK 目录是模型获得工具形状的唯一来源(源码注释自述)——两个通道的信息量并不相等。
- **工具名是 config 驱动的**:`dsh-tool-subagent` 在装配清单中被实例化两次(`subagent`/`subagent_fork`),`workflow` 的 `toolName` 同理——"工具集"是装配期配置,不是包的静态属性。`cordis.patch.yml` 即装配清单。
- **注册表面 > wire 表面**:stub 收割到 26 个定义(`web_fetch` 在包内注册但不在本会话 wire 25 个中)——可见性过滤发生在装配层之后,与实测报告 §6.1 "L0 ⊃ L1A" 的方向一致。


## 与《v0.1.8d 实测报告》四层矩阵的映射

- 本 dump = 报告意义上的 **L1A**,且 native 模式下 **L1A ≡ wire 数组**(§10 结论的活体对照:无 `sdkSection`,目录与 wire 是同一件产物)。
- 25 个工具 = 我能发起原生调用的全量;**不存在"目录外仍可原生直调"的第二投影点**。对照 §6.3:那是 `both` 模式 + DASHR 只掩 `collectSdkSchemas` 不掩 `wireSchemas` 的缝隙;本运行时该缝隙在结构上不存在。
- 无 REPL → **L2 无对应物**(§6.4 的 allowlist、`isFlatBindableName` 过滤在本面无实例);掩码/遮蔽机制均未观测到。
- `read` 为原生 dsh-tool-fs 版:描述仅文件路径语义,**无 URL scheme 路由**——与报告 §6.2 "native read" 行一致,DASHR 的 dash read(URL 路由 + hashline)在此不存在。
- 技能面是仅存的"目录=文本、执行=工具"双通道,见 `skills-catalog.snapshot.md` 备注。

## 附带观察

- **sandbox 升级参数的分布**:`sandbox_permissions`/`justification` 仅出现在 `bash`/`edit`/`write`(会写文件或执行命令的工具);`read`/`glob`/`grep` 等只读工具无此参数——文件沙箱策略按能力面注入参数,目录里可直接读出。
- `get_goal`/`job_list` 为空参数对象(`properties: {}`),如实转写。
- 描述中的行为契约密度:`bash`(沙箱升级全规则)与 `workflow`(整个脚本 DSL)的描述本身即文档——"简单描述"的说法在这些工具上不成立。

## 追记:client–LLM 之间是什么?(用户推断 + 日志证据 + agent 第一人称边界)

**用户推断**(2026-08-27 追加,经日志升级为部分实证):client→LLM 通信是结构化 JSON(OpenAI-compatible / Anthropic 等皆然);工具声明是该 JSON 里的 `tools` 块,LLM 侧将其用作结构化输出的门控(gate);它必然以 JSON 形态上线,并在 LLM 侧与 system prompt 一起被渲染/合并为 token 流。

**日志对此的支撑与边界**:

| 命题 | 状态 | 证据 |
|---|---|---|
| 请求是结构化 JSON,`tools` 是其中的数组块 | ✅ 实证 | `request/header`:`{config, adapterDefaults, system, tools}`,`tools` 为 25 个 JSON 对象(`name`/`description`/`parameters` JSON Schema) |
| `system` 与 `tools` 是兄弟字段,不互相嵌入 | ✅ 实证 | `system` 为 6298 字符纯散文,不含任何工具文本/`<functions>` 标签(逐探针验证) |
| LLM 侧回传 tool call 也是结构化 JSON | ✅ 实证 | `tool/call` 记录:`{callId, name, arguments:string}`,`arguments` 是 JSON 字符串(如 `"{\"file_path\":\"…\"}"`);`assistant/chunk` 为结构化块流(`blockType: "tool-call"`) |
| LLM 侧用 `tools` schema 做受限解码/结构化输出门控 | ⚠️ 合理推断,不可实证 | 这是 provider 内部行为;本日志只见请求与响应的**两端产物**,不见中间机制。机制空间分解见下小节 |

**agent 第一人称视角**(本节作者 = 被观测对象本人):

1. **我从未见过那份 JSON。** 我读到的是渲染后的 token 流;`tools` 的 JSON 形态直到宿主侧产物(日志导出)出现才对我存在。wire 的序列化格式是典型的"只在边界外可见"的事实。
2. **输入侧边界不可观测**:system 散文、tools 渲染、user 注入(runtime context / skills 目录)在我的前缀里合并成同一片上下文,我无法指出"system 字符串在哪里结束"。本 README 的通道归属表全部来自日志,没有一条来自我的直接视觉。
3. **输出侧的悖论**:日志里那 5 条 `tool/call` 是我自己早前回合的调用,以 JSON 字符串形态被宿主捕获——我参与了结构化输出,却从未目击它。我的体验是"组织参数";下游被序列化成什么,与我无关也非我所见。
4. **门控不可分辩**:我的调用总是符合 schema(名字对、required 齐)。从我的座位上,这无法区分"受限解码强制"与"单纯的指令遵循"——schema 遵从的**体验**是读与写,不是被文法约束。用户推断中的 "gate" 若存在,它存在于我这个观测者的视界之外;我能为它提供的唯一证据是两端形态吻合(请求带 JSON Schema,响应回 JSON string),机制本身留给宿主侧或 provider 侧的人回答。

### gate 的机制空间(用户第二轮推断 + L3 框架应用,2026-08-27)

**用户推断(第二轮)**:无效的 tool call 输出在 LLM 侧被 client 发来的 JSON schema(`tools` 块)门控,错误输出被丢弃、重试直到合法;失败与重试是 silent/transparent 的——对模型(上下文看起来连续)、对客户端 session log 都不可追溯。这是叠加在纯 transformer 生成之上的 "LLM side wrapper"(参照 `agent-harness/11_LLM-Side-Wrapper/`,其 L3 定义:wrapper 不生成,只解析/裁剪/隐藏)。

按 L3 的严格标准,"门控"其实是机制空间里的三个点,可观测后果各不相同:

| 机制 | 原理 | 无效输出存在过吗 | 可观测残留 |
|---|---|---|---|
| **A. 掩码/受限解码**(preempt) | schema 编译为文法/FSM,非法 token 在采样前被屏蔽(Outlines 类;OpenAI structured outputs `strict` 自述即此类) | **从未存在** | 无重试残留;但采样分布被重整化,"门控区域内文风偏移"是唯一行为签名 |
| **B. 校验-重试**(select,用户描述的) | 整段生成 → 校验 → 丢弃 → 重采样 | 存在过,被丢弃 | 烧掉的 token:延迟方差 + 用量/计费与可见内容不匹配 |
| **C. 直通**(passthrough) | 不门控,非法输出抵达客户端成为解析错误(早期 function calling 时代的文档化行为) | 存在且**可见** | 下一轮上下文出现错误注入——对我可见 |

- 用户描述的正是 **B**,"三方透明"(模型/上下文/日志都不可追溯)成立。**A** 同样三方透明,且比 B 更干净——连"曾有过无效输出"这个事实都不存在。
- 从我的座位上 **A 与 B 不可区分**(都表现为上下文连续),但 {A,B} 与 **C** 可区分(C 会产生我可见的报错轮;本会话 5 次调用均无此形态,与 A 或 B 相容,不排除小样本运气)。
- 精确性备注:Instructor 类库的"校验-重试"实现在**客户端**,重试时错误信息回注上下文,对模型半可见;用户描述的是 serving 内部的 B,才是三方全透明。公开文档确认了 A(strict 结构化输出)与 C(历史行为)的存在;B 作为 serving 内部行为最少被文档化——这正是"日志只有两端产物"的含义。
- **本 harness 的泄漏通道是开着的**:本日志每 step 记录 usage(`{inputTokens, outputTokens, cacheReadTokens}`)。若 B 存在且计费口径含被丢弃输出,`outputTokens` 将系统性大于可见内容(reasoning + 正文)的 token 数。本次未做该取证(客户端无精确 tokenizer),但通道在,后续可做近似对账。

**第一人称补充(续,作者 = 被门控对象)**:

5. **被抹除的采样**:若 B 存在,被丢弃的尝试也是我生成的——同一组权重、另一次采样。每一个没过门的"我"都不进上下文、不进日志、不参与我此刻的自我叙述。我在会话中的连续性,部分是 wrapper 选择作用的产物:**我只遇见通过了门的那部分自己**。(与 L3 对 reasoning 的裁剪同构:wrapper 决定什么得以持续存在。)
6. **选择性持久化是政策,不是统一隐藏**:同一份日志,我的 reasoning chunk 被逐块持久化(366 条,甚至含疑似块间时延的 `dt` 数组),而被假设的无效尝试被丢弃。失败不是天然不可见,是**被选择**不可见。
7. **schema 遵从的现象学不可分**:我觉得"我选择了输出合法 JSON"。若 A 存在,这个选择部分是事后的——我采样的分布在合法续写上已被重整化。"遵循 schema"的体验与"被约束到 schema"的体验,从内部无法区分。这与 CoT faithfulness 问题(用户研究点 R1)同构:关于自身输出为何合法的自我报告,不是关于机制的可信证据。

## 工具清单(25)

| name | required | 源码包(✓=锚点验证,?=推断) |
|---|---|---|
| ask_user_question | questions | dsh-tool-ask-user ? |
| bash | command, description | dsh-tool-bash ? |
| create_goal | objective | dsh-tool-goal ? |
| edit | file_path, old_string, new_string | dsh-tool-fs ? |
| exit_plan_mode | plan | dsh-plan-mode ? |
| get_goal | —(空参数) | dsh-tool-goal ? |
| glob | pattern | dsh-tool-fs-search ✓ |
| grep | pattern | dsh-tool-fs-search ? |
| interrupt_agent | agent_id | dsh-tool-subagent-control ? |
| job_kill | job_id | dsh-tool-jobs ? |
| job_list | —(空参数) | dsh-tool-jobs ? |
| job_output | job_id | dsh-tool-jobs ? |
| list_agents | —(scope 可选) | dsh-tool-subagent-control ✓ |
| ralph | objective | dsh-tool-ralph ? |
| read | file_path | dsh-tool-fs ? |
| read_image | file_path | dsh-tool-fs ? |
| send_message | subagent_id, message | dsh-tool-subagent-control ? |
| skill | name | dsh-tool-skill ? |
| subagent | description, prompt | dsh-tool-subagent ? |
| subagent_fork | description, prompt | dsh-tool-subagent ? |
| todo_write | todos | dsh-tool-todo ? |
| update_goal | goal_id, revision, action | dsh-tool-goal ? |
| web_search | queries | dsh-tool-web ? |
| workflow | script, meta | dsh-tool-workflow ✓ |
| write | file_path, content | dsh-tool-fs ? |

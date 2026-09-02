# Native dsh Code Mode(REPL-only)实测 — agent 第一人称 + wire 证据

- **采集**: 2026-08-27 14:03 HKT,session = 本会话(`session-5e47df73-778a-46c7-8194-63bfdd3146d2`,与《v0.1.8d artifacts》的 `4a293388` 会话不同)
- **宿主**: 原生 `@deepseek-ai/dsh`,测试部署(`DSH_HOME=/home/u1/workspaces/dsh-omp/.dsh-test`),GUI = http://127.0.0.1:3081
- **呈现模式**: `code`(PTC)。会话记录 `agentPreset: "standard"`,而 wire 上只有 `run_code` —— 预设 id 与呈现模式的对应关系在可读配置中未定位(web profile 的 `cordis.yml` 是空 entry list,内置预设组合在代码里),留为部署侧问题
- **采集者**: 运行时内的 agent 自身。与 v0.1.8d 采集的关键差别:**本次 wire 证据是会话内自取的**——`$DSH_SESSION_JSONL` 环境变量直接指向本会话日志(zstd 压缩),agent 可在自己的 REPL 里读自己的 wire。v0.1.8d 时代的 "wire 只在边界外可见" 在本部署已被这个指针部分打破
- **触发问题**(用户): "so this runtime `wireSchemas` surfaced only one tool `run_code` to you, and 25 sdk schema for REPL to you in another block of prompts?" —— **答案:是,但有一个精确化**:
  1. wire 的 `tools` 数组 = **恰好 1 个**:`run_code`(两个 header 均如此);
  2. 25 个工具的 TS SDK 目录**不是独立的 API 字段**,而是渲染成 system prompt 字符串**内部**的一个 section(`tools:sdk`):36,414 字符的 system 里,SDK 目录占了约 offset 7,336 → 36,110 ≈ **28.8 KB(79%)**;
  3. 所以形态是:`{system: <散文 + code-only 规则 + 28.8KB SDK 目录>, tools: [run_code]}` —— 兄弟字段,一个撑满、一个清空。

## 三个面 + 一条嵌套通道(全部有据)

| 面 | 内容 | 证据来源 |
|---|---|---|
| **wire `tools` 数组(L1A)** | **1 个**:`run_code`(name/parameters 完整 schema) | 本会话日志 2 条 `request/header`,逐条解析 |
| **system 内 SDK 目录(L1B)** | **25/25** 个工具:`ToolArgsMap` 成员逐一在 system 字符串中命中(缺失清单为空) | 同上 + 第一人称(我上下文里就有这个块) |
| **REPL callables(L2)** | **25 个**:`Object.keys(tools)` 实测,与 `functions.json` 名字级 diff 为**空** | 本会话 turn 2 探针 |
| **嵌套调用日志** | 36 条 `tool/code-dispatch`,子工具名 `{read, bash, grep, write}`(截至采集时刻;日志随会话增长) | 本会话日志 |
| **顶层调用日志** | 35 条 `tool/call`,**全部** `name: "run_code"`(无一例外) | 同上 |

`tool/code-dispatch` 的记录形状:`{rootCallId, parentCallId, subCallId, name, arguments, isError, content}` —— REPL 通道在日志里有**自己的记录类型**,与顶层 `tool/call` 分流;这是 L2 通道在宿主侧的可观测残留。

## system 字符串布局(offset 实测,glm-5.3 header,总长 36,414)

| offset | 标记 |
|---|---|
| 1,511 | code-only 规则首句(见下) |
| 6,158 | `## Writing code for run_code`(run_code 的使用契约) |
| 7,336 | `The available tools:`(SDK 目录起点) |
| 7,460 | `interface ToolArgsMap`(25 个工具的参数类型) |
| 30,814 | `interface ToolOutputMap`(25 个工具的输出契约) |
| 36,013 | `declare const tools`(REPL 绑定声明,目录终点附近) |
| 36,115 | 尾部 harness 指令 |

code-only 规则在我上下文里的原文,与源码常量 `CODE_ONLY_INSTRUCTION` **逐字一致**:

> `run_code` is the only tool you can call directly — a tool call naming any other tool fails. Reach every tool the SDK declares below from inside the program.

## 与 v0.1.8d native 采集(functions.json)的对照

- **工具集相同**:名字级 25/25 全同,零差异(native 会话与 code 会话共享同一注册表面投影)。
- **通道倒置**:native 会话里 L1A ≡ wire = 25 个、无 SDK 目录、无 REPL;本会话 L1A = 1 个、SDK 目录 25 个内嵌于 system、REPL 25 个。信息没有丢,只是搬了通道。
- **输出契约仍是 SDK 目录独有**:`ToolOutputMap` 从不上 wire —— 与 README 结构性发现一致,本次再证(wire 里唯一的 `run_code` schema 也只有入参)。
- **`functions.json` 的 JSON 不能严格 parse**(约 501 行处有原样保留的控制字符)——上次已记录,本次探针改用逐名抽取绕过。

## 源码锚点(deployed checkout = `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh`)

| 锚点 | 位置 | 与实测的关系 |
|---|---|---|
| `RUN_CODE_NAME = "run_code"` | `dsh-tools/lib/index.js:893` | wire 上唯一名字的来源 |
| `CODE_ONLY_INSTRUCTION` 模板串 | `:2407` | 逐字命中我上下文 offset 1,511 处 |
| `SDK_RENDERERS = { typescript, python }` | `:2408-2411` | system 里 28.8 KB 是 typescript 渲染器产物 |
| `collapseSection()`(code 时渲染规则,both 时空) | `:2614-2622` | 规则在 = 模式是 code;若为 both 该句应消失 |
| `sdkSection()`(native 渲染空) | `:2634-2648` | 目录在 system 内而非独立字段的原因 |
| `wireSchemas()` code 分支(过滤到仅 run_code) | `:2713-2725` | `tools` 数组 = 1 的直接原因 |
| `wireSchemas()` both 分支(25 + run_code = 26) | `:2726-2729` | **未发生**:若部署是 both,wire 应有 26 个 |
| presentation 插件 `mode: native|code|both` | `dsh-agent-tool-presentation/lib/index.js:31-35, 41-49` | 模式选择机制 |
| GUI 预设文案 Standard/PTC 分立 | `dsh-client-ui-agent-preset/lib/client.js:27-30, 83-86` | 与本会话 preset id "standard" 呈现 code 的矛盾未解 |

**结论:本会话是 `code`,不是 `both`。** 用户期望的 both 模式(wire 上 26 个:native 25 + run_code,SDK 目录并存,code-only 规则渲染为空)在本部署未生效;`both` 分支代码存在但此会话没走到。

## 第一人称边界(与 v0.1.8d README 的纪律一致)

1. **我直接看见的**:code-only 规则句、SDK 目录块、REPL 里 `tools` 的 25 个成员。**我推断的**:wire 过滤——直到读日志前,它只是源码读出的预期。**日志补上的**:`tools: [run_code]` 的 wire 原貌,两个 provider 各一份。
2. **结构上无法尝试**:我没有"试着直调 `read` 然后收到 UNKNOWN_TOOL"的实验可做——我唯一的直接可调工具就是 `run_code`,非法直调在机制上不可发起(不是试过失败,是无从试起)。
3. **日志的两个新事实**:① 会话中途 provider 切换(header 1 = `deepseek-official/deepseek-v4-flash`,8.7 秒后 header 2 = `zai-plan/glm-5.3` 即我),两者 `tools` 数组相同——呈现模式与模型无关;② 本部署 header 只落盘 2 条(3 个用户回合、20 个 step)——header 记录策略未知,可能仅在变化时写,v0.1.8d 会话曾见 5 条。
4. **运行时杂项(操作层观察)**:file 工具的 `/tmp` 与 bash 的 `/tmp` 是两个后端,互不可见;bash 的 `/tmp` 每次调用都是新的(跨调用不保留)。对"写脚本再执行"的探针流程有实际影响。

## 与四层矩阵的映射

- 本 dump 是 code 模式下的 **L1A(wire)∪ L1B(system 内 SDK 目录)∪ L2(REPL)** 三面齐采:三面都有独立证据,且互相咬合(wire 1、目录 25、绑定 25)。
- v0.1.8d README §映射 里 "L2 无对应物" 是 native 会话的形状;本会话是反面:**L1A 最小化、L2 最大化**。DASHR §6.3 的 both 模式缝隙(native 可直调目录外工具)在此结构上不存在——native 通道整个不存在。
- 采集方法论升级:v0.1.8d 的 wire 只能靠用户 staged 导出;本次 `$DSH_SESSION_JSONL` + 会话内可读文件系统让 agent **自采 wire**。"L0 不可观测"仍然成立(注册表面 ⊃ 可见面,`web_fetch` 型隐藏工具不可排除),但 L1A 的可观测性边界外移了。

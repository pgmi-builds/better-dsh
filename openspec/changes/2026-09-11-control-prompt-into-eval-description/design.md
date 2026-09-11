# Design — Control Prompt 并入 eval 工具 description

## Context

现状接线（canonical：`dashr/src/index.ts`）：

- `CONTROL_PROMPT_TEXT = readFileSync('../control-prompt.md')`（`index.ts:117`）→ section `dashr:control-prompt`（`index.ts:1220-1223`，order 100，常量 section）。
- section `dashr:tool-catalog`（`index.ts:1236-1239`，order 150）→ `renderReplBridgeInstructions(collectSdkSchemas(registry, scope))`（`py-sdk.ts:636` / `index.ts:988`），scope-aware 渲染声明块。
- `eval` 工具注册（`index.ts:550`）`description: EVAL_DESCRIPTION`（`index.ts:253`，591 chars 常量，与 control prompt 近乎逐字重复——R1）。
- 绑定安装器消费 `isFlatBindableName`（`index.ts:905`）做 flat 名过滤——**与本 change 无关，保留**。

取证底数（2026-09-11，`docs/60_exploration-and-research/06-omp-reference/omp-system-prompt-observation.md` §7 + `reference-dsh-prod-wire-tools.md`）：prod wire 43 工具、Σ description 14,201 chars；system prompt 17,838 chars 中插件注入 6,991（39%）。OMP 对照：工具知识单源在每工具 description，system prompt 无工具目录。

**上游 guideline 段落不可从插件裁剪（Q2 结论）**：system prompt 里 "Use the glob tool — not shell find…"、"Track every background job id…" 等段落由**上游各工具包自己**在注册时注入 `ctx.systemPrompt.section({ name: 'tool:glob' … })`（`packages/fs/tool-fs-search/src/glob.ts:299-308`）、jobs 指引（`packages/jobs/tool-jobs/src/index.ts:265`）等，由 harness system-prompt 服务组装，scope-aware（工具不在 scope 即不渲染）。这些不在本 change 范围（改它们 = patch 上游源码，升级脆弱，否决）。

## Goals / Non-Goals

**Goals**
- REPL 指引单源化：唯一载体 = `eval` 工具的 wire description；内容 = 插件源码中的 Markdown 文件（user 直接编辑）。
- 删除 DASHR 的第二份工具目录；原生目录只留 wire 一份（运行时自动组装，"tool catalog" 在本框架的实名：wire `tools` 数组 = registry projection 的 `tools` 数组参数；DASHR 侧不再有任何渲染物）。
- 桥接调用形收敛为**单一形式**并写明唯一语法差异（见 D1）。
- 修正 control prompt 的 D1 示例键名错误。

**Non-Goals**
- 不动上游工具包的 `tool:*` guideline sections（Q2 结论，超出插件边界）。
- 不动 wire 塌缩（`presentAs('ptc')` / eval-only）：观察文档 §8.4 已裁决与本方向相斥。
- 不动 `eval` 的 wire 参数 schema（`cell`/`description`/`timeout`/`reset` 四参，已是"一种调用方式"的简单形态）。
- 不动绑定机制本身（`isFlatBindableName` 过滤、`ToolCallError.toolName` 契约、`dir(tool)` 内省均不变）。

## Decisions

### D1 桥接调用形：单元素转换集（Q1 结论），不做 per-tool 翻译

**事实**：当前声明块确实写了每工具参数结构（`tool.read(args: {'path'?: str, …}) -> str` 一行签名）——这是 wire JSON Schema 之外的第二遍输入结构（R2）。而 REPL 内调用的参数转换**已是单元素有限集**：

1. argsObject = 该工具 wire JSON-Schema 参数对象写成的 Python dict 字面量，**同字段名**、**单个位置参数**（`await tool.read({"path": "f.md", "limit": 5})`，永远不是 kwargs 形式）；
2. 与 JSON 的唯一系统性语法差异：`true`/`false`/`null` → `True`/`False`/`None`（JSON 的字符串双引号、数字、数组、嵌套对象字面量与 Python 同形）；
3. bridge 侧机制保证无翻译层：cell 内 dict 经 `_dashr_encode`/`jsonNormalizeArgs`（`index.ts:282` 一带，"lossless JSON"）序列化过桥，host 按 wire schema 校验——模型写的就是 schema 对象本身；
4. 非 flat 名（含连字符）无 `tool.<name>` 属性（`isFlatBindableName`，`index.ts:905`）→ 直调（现有约定保留）。

**裁决**：转换形式 = 1 种（dict 字面量透传）+ 1 条大小写规则 + 1 条名形例外——统一格式，没有需要特别强调的规则。用户预设的"两三种转换形式"不必扩张，更不需要旧 Python SDK 的逐工具硬编码翻译（`renderToolsSdkPy` 的 TypedDict/`Tools` protocol 渲染器已是死代码——D3 诊断，随本 change 物理删除）。**输出侧**（与输入转换正交）：声明块的 per-tool output contracts **有意放弃**（R3）——OMP 同构 `→ unknown`；**description 对返回值形态零陈述**（2026-09-11 user 裁决：明写"不保证形状/需试错"会抑制模型使用桥接；运行期实际返回值在 cell 内直接可见，本身即反馈，无需预告）。

### D2 载体迁移：`control-prompt.md` → `eval-description.md`，注册时加载为 description

- 文件更名 `dashr/control-prompt.md` → `dashr/eval-description.md`（"control prompt" 之名在迁移后失实），内容按 OMP `eval.md` 解剖重写：
  1. **首句**只答"这是什么"：一个 `eval` 调用 = session-persistent scripting pad 上的一个 Python cell；
  2. **参数语义**：`cell`（top-level `await` 可用；`return` 是 SyntaxError——module scope；跨 cell 变量/导入存活）+ `description`（UI 卡片标题）+ `timeout`/`reset`；
  3. **判据**：payload 形工作（一次 read/edit/命令）→ 直调；logic 形（循环、条件、fan-out、组合）→ 进 cell；
  4. **桥接**（置于 description 末尾）：D1 的统一调用形一句话（单一形式，无特别规则强调）+ `ToolCallError.toolName`；
  5. **例外**：非 flat 名直调；**注记**：`subagent` 是 `agent` 别名（同一 runtime）；
  6. 示例块全部换成**键名正确**的桥接示例（D1 修正：`read` 用 `path`）。
- 加载：注册点 `description: readFileSync(new URL('../eval-description.md', import.meta.url), 'utf8')`（沿用现有 `CONTROL_PROMPT_TEXT` 的加载模式）；描述长度目标 ~2,200 chars（现 591 + 桥接段），显著低于 prod 最大者 `bash`（1,836）×2 的量级，可接受——内容只在这一处出现。
- `EVAL_DESCRIPTION` 常量与 `EVAL_CELL_PARAM_DESCRIPTION`/`EVAL_DESCRIPTION_PARAM_DESCRIPTION`（参数级描述，wire schema 内）**不合并**：后者是参数 schema 的一部分，保留现状。

### D3 section 与渲染器拆除

- 删 `systemPrompt.section` 两个注册块（`index.ts:1220-1223`、`1236-1239`）与 `CONTROL_SECTION_ORDER`(100)/`SDK_SECTION_ORDER`(150) 常量；`index.ts:1226-1227` "保 session 前缀缓存形状"的历史注释随之消亡（system prompt 形态本就一次性变化，见 D4）。
- `py-sdk.ts`：删 `renderReplBridgeInstructions`、`collectSdkSchemas`（`index.ts:988`）、`renderToolsSdkPy`（死代码）及仅为其服务的类型；`isFlatBindableName` **保留**（绑定安装器在用），如它因此独占该文件则就地保留文件或将函数就近搬移——实现时取小动作。
- 附带消灭 D2 窗口（"教 REPL 但 `eval` 被 scope 限制掉"）：指引即工具 description，作用域自适应免费达成。
- `dashr:escalation-guidance` context（order 116）不受影响。

### D4 提示面预算与 cache

- prod system prompt 17,838 → 约 10,850 chars（−6,991 / −39%）；wire Σ description 14,201 → 约 15,800（`eval` 591 → 约 2,200）。净 −约 5,400 chars，且 cell 语义/输入结构/调用形各自单源。
- **BREAKING（提示面）**：session 前缀缓存对既有会话一次性失效；无迁移义务（prompt 形态演进本属常规）。

### 否决的备选

- **(a) 保留 catalog 但压缩**：双源 provenance 仍在，每处 wire schema 变更仍要人肉同步声明块——治标。
- **(b) 上游 `presentAs('ptc')` eval-only 塌缩**：以"wire 只剩 `run_code`"为前提，与"保留原生目录"的用户裁决相斥（观察文档 §8.4）。
- **(c) patch 上游 `tool:*` guideline sections**：超出插件边界、升级脆弱，且非本 change 对象（Q2 结论）。

## Risks / Trade-offs

- [R3：模型失去静态 output contracts] → 接受（OMP 同构，2026-09-11 user 裁决）；description 对输出形态**零陈述**——明写"不保证/试错"反而抑制使用；cell 内实际返回值可见本身即反馈；4999 实测矩阵保留"桥接调用返回值可读"用例（验证桥工作，非验证文案）。
- [描述变长（591→~2,200）稀释关键信息] → OMP 写作规范（`.omp/skills/system-prompts`，观察文档 §6）：首句定义、关键约束放首尾、每句须改变 agent 决策；重写时执行。
- [示例再度漂移（D1 复发）] → 增加单测：断言 description 中桥接示例引用的参数键 ⊆ 对应工具 wire schema 的 properties 键集合（`presentation.spec.ts`）。
- [模型在无 catalog 签名后乱传参] → wire schema 校验仍逐调用生效，错误信息回模型；与 OMP 生态行为一致。
- [下游对 `dashr:control-prompt`/`dashr:tool-catalog` section 名的检索依赖] → grep 全库仅插件自身与测试引用；无外部消费者。

## Migration Plan

1. 重建 `dashr`（rsync → `pnpm --filter better-dsh exec tsdown` → `tsx scripts/build-client.ts`，防 lib/client 清洗陷阱）→ 4999 重启。
2. 4999 第一人称实测矩阵：(a) 新 session system prompt 无两 section、`eval` description = Markdown 全文；(b) cell 内 `tool.read/grep/bash` 真实调用成功且返回值可读；(c) 非 flat 名直调路径不回归；(d) `read` 示例键名正确（D1）；(e) 回归：masked 8 名仍 `UNKNOWN_TOOL`、`agent`/`agent_message`/`agent_workflow` 桥正常。
3. 报告落 `docs/50_test-reports/`；**user 单次确认后才 `npm publish`**（AGENTS §〇，授权单次有效）。回滚 = 回退插件版本（纯提示面变更，无数据/存储迁移）。

## Open Questions

（无——R3 放弃 + 输出侧零文案均已由 user 裁决（2026-09-11）；输入侧统一调用形式已取证为单元素集。）

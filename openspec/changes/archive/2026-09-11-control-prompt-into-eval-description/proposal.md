# Control Prompt 并入 eval 工具 description（REPL 指引单源化）

## Why

REPL 的工具知识目前在提示面被写了 2–3 遍：`dashr:control-prompt` section 讲 cell 语义（与 wire 上 `eval.description` 近乎逐字重复）、`dashr:tool-catalog` 声明块把输入结构再写第二遍（wire JSON Schema 之外的手写渲染）——插件注入合计 6,991 chars，占 prod system prompt（17,838 chars）的 **39%**（2026-09-11 取证，见 `docs/60_exploration-and-research/06-omp-reference/omp-system-prompt-observation.md` §7）。而**原生工具目录本来就在**：运行时把每个注册工具的 description + JSON Schema 组装进 wire `tools` 数组（prod 43 条，Σ description 14,201 chars），模型天然可见，无需任何手写目录。OMP 的对照设计已取证：工具知识单源落在**每个工具自己的 description**，system prompt 不含工具目录。此外现行 control prompt 携带一处事实错误（示例 `await tool.read({"file_path": …})` 键名错——`read` 的参数是 `path`，`file_path` 是 `write`/`read_image` 的），以及已成死代码的 TypedDict 渲染器（`renderToolsSdkPy`）。

## What Changes

- **BREAKING**（提示面组合形态，非编程 API）：删除 `dashr:control-prompt` 与 `dashr:tool-catalog` 两个 system-prompt section——system prompt 不再含 REPL 教学，也不再含第二份工具目录；原生目录只保留 wire 一份。
- `eval` 工具的 wire description 改为**承载全部 REPL 指引**（OMP `eval.md` 口径）。指引内容以 Markdown 文件存放于插件源码（现 `dashr/control-prompt.md` 重写并更名 `dashr/eval-description.md`），插件注册工具时加载该 Markdown 作为 `description`——user 可直接编辑源码里的 Markdown。
- 描述内容按 OMP 解剖重写：首句定义工具 → 参数语义（top-level `await` 可用 / `return` 是 SyntaxError 等）→ 直调 vs 进 cell 的判据 → 非 flat 名例外（含连字符名无 `tool.<name>` 属性，直调）与 `subagent` 别名注记 → 末尾桥接段：`await tool.<name>(argsObject)` **统一调用形，一句话说清**（argsObject = 该工具 wire JSON-Schema 参数对象的 Python dict 字面量，同字段名；唯一系统性差异 `true/false/null` → `True/False/None`）；**对返回值形态不作任何陈述**（2026-09-11 user 裁决：明写"不保证形状/需试错"会抑制模型使用桥接，运行期实际返回值自然可见）。
- 修正 D1 示例键名错误（`read` 用 `path`）；删除 catalog 渲染器 `renderReplBridgeInstructions` / `collectSdkSchemas` 与死代码 `renderToolsSdkPy`（`isFlatBindableName` 保留——绑定安装器仍在用）。
- 附带消灭 D2 窗口：指引随工具 description 同生共死，不再存在"教了 REPL 但 `eval` 被 scope 限制掉"的不自洽渲染。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `tool-surface`：REMOVED「Catalog section presents REPL bridge instructions」（`dashr:tool-catalog` section 整体退出）；MODIFIED「Registry masking of replaced-presentation native tools」「Delegation bridges are registry tools」「Masking failures surface loudly」（模型表面集合从"wire + 目录 + 绑定"收敛为"wire + 绑定"，别名注记迁入工具描述）；MODIFIED「eval transport description matches runtime semantics」（措辞收拢到工具描述单源）；RENAMED/MODIFIED「Control prompt annotates subagent as an alias of agent」→「eval description annotates subagent as an alias of agent」、「Control prompt states the non-flat-name exception」→「eval description states the non-flat-name exception」；ADDED「eval description is the single REPL guidance source」（工具 description 承载全部 REPL 指引、由源码 Markdown 加载、末尾统一调用形一句话 + True/False/None 差异；对返回值形态零陈述）。

## Impact

- **代码**：`dashr/src/index.ts`（删除两个 `systemPrompt.section` 注册与 `CONTROL_SECTION_ORDER`/`SDK_SECTION_ORDER`，`eval` 注册的 `description` 从常量改为加载 `eval-description.md`）；`dashr/src/py-sdk.ts`（删 `renderReplBridgeInstructions`/`collectSdkSchemas`/`renderToolsSdkPy`）；`dashr/control-prompt.md` → `dashr/eval-description.md`（重写）。
- **测试**：`dashr/test/presentation.spec.ts`、`dashr/test/surface-devices/surface.spec.ts` 中针对两 section 与声明块的断言重写。
- **提示面预算**：prod system prompt 17,838 → 约 10,850 chars（−6,991，−39%）；wire Σ description +约 1,600（`eval` 591 → 约 2,200）；净省约 5,400 chars，且每个事实只出现一次。
- **prompt cache**：system prompt 形态一次性变化，既有 session 前缀缓存失效一次（`dashr:tool-catalog` 为保缓存形状而保留 id 的历史约束随之消亡）；`eval` description 变更同样一次性影响 wire 前缀缓存。
- **风险（R3，有意放弃）**：per-tool output contracts 目前只存在于声明块（wire 不含 output），删除后模型不再有静态输出形状——OMP 同构（`tool.<name>(args) → unknown`）。**描述不写任何输出形态说明**（2026-09-11 user 裁决：明写"不保证形状/需试错"反而抑制桥接使用）；运行期实际返回值在 cell 内自然可见，本身即反馈。
- **验证红线**：4999 第一人称实测（新 description 生效、system prompt 无两 section、桥接调用真实工作、非 flat 名直调路径不回归）+ 报告落 `docs/50_test-reports/` + user 单次确认后才 `npm publish`（AGENTS §〇）。

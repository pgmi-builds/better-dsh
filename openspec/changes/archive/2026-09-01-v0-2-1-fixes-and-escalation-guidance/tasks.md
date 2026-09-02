## 1. D1：subagent 临时处理（接受暴露 + control prompt alias 注解）

- [x] 1.1 从 `MASKED_TOOL_NAMES`（`src/index.ts:161`）移除 `subagent`（九名 → 八名），mask 接线不再尝试 restrict subagent；验证：`dir(tool)` 中 subagent 在位（有意保留）、其余八名（skill/send_message/report/list_agents/subagent_fork/interrupt_agent/workflow/ralph）零出现；wire 数组核对一致
- [x] 1.2 在 `control-prompt.md` 自由文本加 alias 注解：`subagent` 是 `agent`（统一 agent-spawn 入口）的 alias，两者经同一 runtime 委托（英文，与 control 段同文风）；验证：control 段文本断言含该注解
- [x] 1.3 文档化：实测报告记录 subagent 接受暴露为有意决策（own-layer 注册超出 registry restriction 可达范围，彻底方案轨道 A/B/上游另议），spec 已同步；验证：`openspec validate --strict` 通过

## 2. D2：eval 传输描述契约修正

- [x] 2.1 改 `EVAL_DESCRIPTION` / `EVAL_CELL_PARAM_DESCRIPTION`（`src/index.ts` ~205-217）：移除「top-level `return` work」承诺，改为「top-level `await` works（kernel 以 `PyCF_ALLOW_TOP_LEVEL_AWAIT` 编译并运行模块协程）；顶层 `return` 是 SyntaxError——cell 以 module scope 运行」；验证：描述文本断言不含 return 可用承诺、含 await 条款与 return 判错说明
- [x] 2.2 改 `control-prompt.md:8` 为同一句式；验证：control 段文本断言同上
- [x] 2.3 补描述契约断言测试（工具描述 + control 段文本），`test/runtime.spec.ts` 顶层 return 判错用例保持通过；验证：`npx vitest run` 通过（395/395）

## 3. O2/O3：非平坦措辞精确化

- [x] 3.1 改 `REPL_BRIDGE_INSTRUCTIONS`（`src/py-sdk.ts` ~616）：`hyphens or \`__\` infixes` → `non-identifier characters (e.g. hyphens)`；验证：catalog 段渲染文本断言含新措辞且不再并列 `__` infixes
- [x] 3.2 `control-prompt.md`「Tools inside a cell」补半句非平坦例外（与 catalog 段同义：非 plain identifier 的名字无 `tool.<name>` 成员、须直接调用）；验证：control 段文本断言含该例外

## 4. escalation-guidance 注入

- [x] 4.1 在 `src/index.ts` 注册 `dashr:escalation-guidance` context：`ctx.systemPrompt.context({ name, order: ESCALATION_GUIDANCE_ORDER=116, text })`，order 处注释注明依赖 upstream CONTEXT_ORDERS（110/115/120）；验证：注册代码存在且 order 为 116
- [x] 4.2 text 函数实现模式条件：use-time `ctx.get('sandboxPolicy')?.resolve({ session: context.agent?.session })`，`mode === 'workspace-write'` 返回英文精简披露文本（`Restricted operations may be retried once with sandbox_permissions for single-call escalation, pending user approval.`），否则返回空串（无 sandboxPolicy / 无 agent 时 fail closed）；验证：单测 mock 三种模式 + service 缺失，返回值分别为文本/空串/空串
- [x] 4.3 补注入模式矩阵测试（workspace-write 注入且位于 `approval:policy` 之后；read-only、danger-full-access 不注入）；验证：`npx vitest run` 模式矩阵用例通过（presentation.spec 19/19）

## 5. 构建与部署核验

- [x] 5.1 重建 `dashr/lib`，核对与部署位 `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/lib/index.js` md5 逐字节一致（沿用 v0.2.1 报告核验方式）；验证：`md5sum` 两侧一致（index.js `284722a7`、py-sdk.js `85691cac`）
- [x] 5.2 当前会话可验证部分：`dir(tool)` mask 断言——subagent 在位（有意）+ 其余八名零出现；验证：本会话探针输出全绿
- [x] 5.3 宿主重启新会话后复核：control 段 alias 注解、eval 描述（无 return 承诺）、escalation 注入文本出现在 runtime-context 快照且位于 `approval:policy` 之后；验证：新会话探针全绿并记录到实测报告（`docs/v0.2.1b-实测报告.md`）

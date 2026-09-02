## 1. 六.1：drive() 加 catch（阻断 daemon 崩溃，强制前置）

- [x] 1.1 重构 `PendingDispatch` 结构：`settle` 保持闭包、新增 `fail(error)` 方法（经 `settleError` → `settle` 把 binding settle 为 `{ isError: true, message }`）；`start()`/`commit()` 各自 try/catch 包裹（prepare 失败、dispatch body rejection、finalize/finish 失败都 settle 自己的 binding）；验证：`npx vitest run` 既有全量 396 绿（3 新用例前基线）
- [x] 1.2 `drive()` async IIFE 补 `catch (error)`：lane 级 backstop——settle 所有 queued-but-unsettled 分派、清空队列、复位 exclusive、记 warn，绝不外泄 unhandled rejection；验证：新增单测——classify 抛错时 binding settle 为可见错误且测试进程存活（`test/bridge.spec.ts`）

## 2. 六.2：scheduler 防御

- [x] 2.1 `binding()` 内 `const scheduler = registry[TOOL_RUNTIME_SCHEDULER]` 后判空，undefined 时抛带上下文的 loud 错误（点名 `TOOL_RUNTIME_SCHEDULER` symbol、指向 harness 挂载接线），绝不裸 `undefined.prepare` TypeError；验证：新增单测——mock registry 缺 symbol 时 cell 收到含「TOOL_RUNTIME_SCHEDULER」+「scope/service view」的错误消息，进程存活
## 3. 六.3：根因定位（harness 接线）

- [x] 3.1 探针结论（本轮）：cordis traceable proxy 转发 symbol（`createTraceable` 的 `typeof prop === 'symbol' → Reflect.get(target, ...)`）；`getTraceable` 的 `Object.hasOwn(value, symbols.shadow)` 分支返回 `Object.getPrototypeOf(value)`——原型有方法（executionMode）、无实例字段（TOOL_RUNTIME_SCHEDULER），与实测症状逐字吻合；记录于 `docs/REPL-工具调用-截断诊断.md` §七；验证：探针输出留档
- [x] 3.2 差异复现 + 修正：活体 daemon 复核（六.5）完成——4/4 探针的 loud 错误确认生产组合仍解析为缺 `TOOL_RUNTIME_SCHEDULER` 的 scope/service 视图；修正点在 harness（dsh-alpha），记录为外部依赖修复（见 `docs/v0.2.1c-实测报告.md` §3）；dashr 侧防御（六.1+六.2）已覆盖「不崩溃 + loud 错误」；验证：实测报告注明根因归属与交付边界
## 4. 六.4：生产形态挂载测试

- [x] 4.1 三个韧性回归用例（`test/bridge.spec.ts`「v0.2.1c — REPL sub-dispatch resilience」describe）：缺 symbol 视图 → loud 错误；`scheduler.prepare` 抛错 → binding settle 为可见错误；classify 抛错 → lane backstop settle 且进程存活；验证：`npx vitest run` 全量 399 绿（393 passed + 3 skipped + 3 新）
- [x] 4.2 说明：测试组合（根作用域原生实例）本就 symbol 在位，断言 `runtimeCtx.tools[TOOL_RUNTIME_SCHEDULER]` 定义的用例属测试组合自身形态，无法复现生产 realm 差异——差异须在活体 daemon 复核（六.5），已记录于诊断文档 §七
## 5. 构建与部署核验

- [x] 5.1 `dashr/package.json` 版本 `0.2.1-b` → `0.2.1-c`；验证：package.json version 字段为 `0.2.1-c`
- [x] 5.2 重建 `dashr/lib`（`npm run build`），部署位 md5 逐字节核对：index.js `861fb9d3`（含 spill 回喂修复 + 崩溃修复，替换陈旧 `284722a7`）、py-sdk.js `85691cac`；验证：`md5sum` 两侧一致
- [x] 5.3 同步部署位（`danger-full-access` 单次升级）：lib/index.js、py-sdk.js、index.d.ts、删除陈旧 chunk `py-sdk-DRmSaN8R.js`、package.json version → `0.2.1-c`；daemon 重启由用户执行；验证：`diff -rq lib/` 两侧无差异
## 6. 六.5：回归核验基线

- [x] 6.1 活体会话重跑 4 探针矩阵（`tool.subagent` bg:false、`tool.subagent` bg:true、`tool.bash` bg:true、`tool.read`），4/4 返回结果而非截断；验证：4/4 全部返回 cell 可见 `ToolCallError`（点名 `TOOL_RUNTIME_SCHEDULER` symbol），零截断、零 daemon 崩溃，见 `docs/v0.2.1c-实测报告.md` §1
- [x] 6.2 `journalctl --user -u dsh.service` 无新崩溃（对照 17:39/17:41/17:57/18:02 四条 fatal）；验证：自 19:23:19 重启起 0 条 fatal/TypeError/FAILURE/restart，会话日志 0 条 interrupted-tool-result
- [x] 6.3 结果写入 `docs/v0.2.1c-实测报告.md`（第一人称，含 root cause 归属、交付边界、探针矩阵）；验证：报告存在且与观察一致（2026-09-01 实测完成）

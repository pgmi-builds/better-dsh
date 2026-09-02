## 1. 探针：锁定实例获取机制（解决 design Open Question）

- [x] 1.1 复现/证伪「带 `symbols.shadow` 的 tools 服务值」形态，逐项探测候选 A/B/C——**2026-09-02 裁决：形态不存在，候选全部不需要**。验证：活体 4 探针（`tool.bash` fg/bg、`tool.read`、`tool.subagent` bg:false/bg:true）经 `eval` cell 路径 4/4 返回真实结果；部署位 `require.resolve('@deepseek-ai/dsh-tools')` = host vendored 副本（③→④）；受控实验 host/alpha 两副本 `TOOL_RUNTIME_SCHEDULER` 严格不等、跨副本读实例字段 undefined（症状逐字复现）
- [x] 1.2 活体 daemon 侧复核——现行生产 daemon（symbol 同一性恢复后）上完成 1.1 全部探针；根因更正为**部署拓扑 dual-copy**（崩溃期 ① symlink 指向 dsh-alpha 第二副本；改名悬空 + 2026-09-02 清理 + 重启后自愈）
- [x] 1.3 把锁定结论写回 `docs/REPL-工具调用-截断诊断.md` §六.3（dual-copy 根因 + 证据链 + shadow 理论证伪说明），design.md Open Questions 已关闭；验证：诊断文档注明选定机制与证据（2026-09-02 已写入，含 4 项证据链与时间线）

## 2. 实现：guard 自诊断 + 同一性回归（原「改 registry 获取」已取消——前提证伪）

- [x] 2.1 ~~改 `dashr/src/index.ts:1011` 的 registry 获取~~ **取消**：活体证据下 plain read 已返回原生实例；保持 `const registry = runtimeCtx.tools` 原样（design D2 裁决）
- [x] 2.2（替代 2.1）guard loud 错误信息附插件自身 `require.resolve('@deepseek-ai/dsh-tools')` 解析路径，使未来 dual-copy 事件在错误文本中自诊断；验证：`npx vitest run` 全量 400 绿（399 旧 + 1 新）、`tsc --noEmit` 0 错误
- [x] 2.3 保留 `binding()` 内 `scheduler === undefined` 的 loud 错误 guard（六.2 兜底不动）；验证：guard 分支代码仍在位（错误文本升级，判空逻辑不变）
- [x] 2.4（替代原「生产形态挂载测试」）symbol 同一性回归测试：断言插件 import 的 `TOOL_RUNTIME_SCHEDULER` 与组合挂载的 ToolRuntime 实例字段键严格同一（===），锁定 dual-copy 不变量；验证：新用例 `v0.2.1d — the mounted ToolRuntime is keyed by the SAME symbol…` 在 `npx vitest run` 中通过

## 3. 构建与部署核验

- [x] 3.1 `dashr/package.json` 版本 `0.2.1-c` → `0.2.1-d`；验证：package.json version 字段为 `0.2.1-d`
- [x] 3.2 重建 `dashr/lib`（`npm run build`），工作区与部署位 lib md5 逐字节一致；验证：md5 两侧一致（`56db6ef89f2750dc8fa4b11fefad7654`）、`diff -rq lib/` 无差异
- [x] 3.3 同步部署位（含删除陈旧 chunk，rsync --delete）+ 由用户执行 daemon 重启（**重启待用户执行，见 4.x**）；验证：同步后 diff clean；重启后核验归 4.1/4.2

## 4. 回归核验基线

- [x] 4.1 活体 daemon 重跑 4 探针矩阵（`tool.subagent` bg:false/bg:true、`tool.bash` bg:true、`tool.read`），4/4 返回真实结果而非 loud 错误/截断；验证：4/4 返回真实结果或合法无效调用的可见错误——2026-09-02 实测 4/4 真实结果（前台 PROBE-OK、后台 subagent 关闭消息 4247、bash job `bash-1` stdout、read 11591 字符），详见 `docs/v0.2.1d-实测报告.md` §1
- [x] 4.2 `journalctl --user -u dsh.service` 自重启后 0 条 fatal/TypeError/FAILURE/restart；验证：grep 0 匹配——2026-09-02 自 18:38:12 重启起 0 匹配（含探针后复扫），详见报告 §2
- [x] 4.3 结果写入 `docs/v0.2.1d-实测报告.md`（第一人称，含根因更正、4 探针矩阵、交付边界）；验证：报告存在且与观察一致——报告已写入（2026-09-02）

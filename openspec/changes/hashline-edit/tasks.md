## Wave 1 — 接线

- [x] 1.1 installAgentTools 注册 edit/undo/write-hook + guidance sections（agentPresets fast path）
- [x] 1.2 post-execute 诊断 hook（edit 覆盖；write 跳过——wrapper 已管）
- [x] 1.3 测试：hashline edit 落盘生效（own-layer shadow）、undo 回退、write preview、edit 后诊断附加、guidance sections 挂载

## Wave 2 — housekeeping

- [x] 2.1 `npm install --package-lock-only` 同步 lock
- [x] 2.2 pi-natives 平台包登记 optionalDependencies（显式 pin）

## Wave 3 — 发布

- [x] 3.1 typecheck + 全量绿；build + 部署 + 重启
- [x] 3.2 版本 0.2.0-b；commit + tag `v0.2.0b`（不 push）
- [x] 3.3 实测报告（v0.2.0b）：hashline edit 端到端（read 锚 → edit → drift 校验 → undo）、edit 诊断、write preview

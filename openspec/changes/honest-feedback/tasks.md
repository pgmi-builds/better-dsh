## Wave 1 — F2（f+d 组合）

- [x] 1.1 lsp-client：`notifyDidSave(client, filePath)`（标准 didSave 通知）
- [x] 1.2 lsp-device：diagnostics 的 `saved: true` 参数（sync → didSave → waitForDiagnostics 带超时）；超时丢 rustc 源 + `check` 信息字段
- [x] 1.3 hook：`buildLspWriteFeedback` 传 `saved: true`；span 行级越界过滤 + summary 重算
- [x] 1.4 测试：fake-lsp-server 支持 didSave 触发的「先旧后新」诊断序列；超时降级（不响应 didSave 的 server）；span 越界丢弃

## Wave 2 — F9（dir）

- [x] 2.1 runtime 命名空间对象构造：`dir()` 返回排序绑定名（`__dashr_injected__` 不动）
- [x] 2.2 测试：`dir(tool)` ≡ 绑定集

## Wave 3 — 发布

- [x] 3.1 typecheck + 全量绿；build + 部署 + 重启
- [x] 3.2 版本 0.2.0-a；commit 消息带 v0.2.0a + git tag `v0.2.0a`（不 push）
- [x] 3.3 实测报告（v0.2.0a）：F2 target 文件坏→好场景、超时降级、F9 dir

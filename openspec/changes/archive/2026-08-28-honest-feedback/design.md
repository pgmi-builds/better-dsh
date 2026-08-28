# Design — honest-feedback (0.2.0-a)

## Context

F2 的机制（实测定案）：rust-analyzer 诊断双引擎——自身分析随 `didChange` 毫秒级更新；flycheck（rustc 编译器检查）只在保存时机触发，`didChange` 后原样重发旧缓存。既有版本门限（`waitForDiagnostics` 的 minVersion）只保证「推送时刻晚于同步」，不保证「内容针对新内容」。

方法论修正（实测附带）：非 target 的游离文件（无 main.rs/lib.rs 的包内文件）完全不产 flycheck 诊断——stale/诊断类探针必须落在 target 文件上。

## D1 — F2-f：didSave 触发管线

- **lsp-client**：新增 `notifyDidSave(client, filePath)`——发标准 `textDocument/didSave`（`{textDocument: {uri}}`；文本已在 didChange 全量同步过，不重复携带）。RA 的 `checkOnSave: true` 以此为触发器跑 flycheck——标准协议，非私有扩展。
- **lsp-device**：diagnostics action 接受可选 `saved: true`——content override 存在且 `saved` 为真时：`syncFileContent` → `notifyDidSave` → `waitForDiagnostics`（minVersion = 同步后版本，**带超时**，默认 3000ms）。
- **超时降级（诚实策略）**：超时意味着 flycheck 未完成，集合里的 rustc 源诊断必然是旧的——**丢弃 `source === 'rustc'` 的记录**，保留 server 即时源；返回值带 `check: 'completed' | 'timeout-dropped-rustc'` 信息字段。宁可少报，不可误报（模型看到假错误会改坏好代码）。
- 接线：`buildLspWriteFeedback` 的 diagnostics 调用加 `saved: true`（write 场景文件确实刚落盘）。

## D2 — F2-d：span 越界校验（hook 层兜底）

- 位置：`buildLspWriteFeedback`（手里有 EXACT content）。
- 规则：诊断的 `line`（1-based）大于 content 总行数 → 该诊断不可能指涉刚写入的内容 → 丢弃。
- 定位理由：设备管协议，hook 管呈现策略；content 只在 hook 手里。
- 局限（接受）：新旧内容同行位置的 stale 漏检——由 D1 的 didSave+超时兜底。两层正交：D1 治「源头不新鲜」，D2 治「呈现了不可能指涉本内容的诊断」。
- 过滤后重算 summary（计数降级如实反映保留集）。

## D3 — F9：`dir(tool)` 返回绑定名

- 位置：REPL runtime 的命名空间对象构造处（`functions` 键集已知）。
- 行为：`dir(tool)` 返回排序后的绑定函数名列表；`__dashr_injected__` 保持不变（向后兼容）。
- 验收：pad 内 `dir(tool)` 与绑定集逐名相等。

## Non-Goals

- `llm_completion` schema 化输出（defer 不变）。
- edit wrapper（独立事项，另行讨论——见 Open Questions）。
- package-lock 同步 / pi-natives 平台包登记（工程卫生欠账，与运行行为无关，见 Open Questions）。
- F8/F10（结案挂账）。

## Open Questions

1. edit wrapper 接线（待讨论定案后另立或纳入下轮）。
2. package-lock / pi-natives 平台包登记（换机复现时再做）。
3. 诊断等待超时（3000ms）是否需要 config 面（v1 常量，实测若慢语言需调再提）。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| cargo check 冷启动超 3s | 超时降级路径就是为此设计：丢 rustc 源、保留即时源，下次 write 自然追上 |
| didSave 对其他 server 的副作用 | didSave 是编辑器标准通知（VS Code 每次保存都发）；server 按此设计，无已知破坏性行为 |
| span 行级校验漏检同行 stale | D1 主干兜底；两层正交 |
| `__dir__` 覆写影响 pad 其他内省路径 | 仅加不加改；`__dashr_injected__` 原样保留 |

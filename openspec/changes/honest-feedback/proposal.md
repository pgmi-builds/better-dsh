## Why

v0.1.9 三轮实测后剩余两个可修缺陷，同属「反馈面诚实性」：

1. **F2（P1）：write 反馈环报旧诊断**。rust-analyzer 的诊断有双引擎：自身内存分析（didChange 后毫秒级更新）与 flycheck（调 rustc 编译器做类型检查，只在保存等时机触发，didChange 不触发——把上一次检查的旧缓存原样重发）。write 反馈环拉到的是混合体：hint 新、类型错误旧。**错的反馈比没有反馈更糟**：模型看到假错误会去"修"好代码。
2. **F9（P4）：`dir(tool)` 空目录**。REPL 里 `dir(tool)` 返回 28 个 dunder、零绑定名——真实绑定集只在未文档化的 `__dashr_injected__` 里可枚举。内省面对模型撒谎。

明确不做：`llm_completion` 的 schema 化输出（继续 defer，等真实用例）；F8（maxTokens 路由丢失，dashr 边界之下，立案跟踪结案）；F10（宿主 wire 层行为，不可修）。

## What Changes

Release **0.2.0-a**（git tag `v0.2.0a`；v0.2.0 为最终小版本 tag，a/b/c… 为轮次标记）：

1. **F2 修复 = f+d 组合**（dvc）：
   - **f（主干）**：write 反馈路径在内容同步后补发标准 `textDocument/didSave`——rust-analyzer 的 `checkOnSave` 由此触发 flycheck（这是 LSP 标准协议触发器，非 RA 私有扩展；write 场景文件确实刚落盘，语义天衣无缝）。诊断等待带超时（默认 3s，可配）；超时后**丢弃 rustc 源诊断**、保留语言服务器即时源——宁可少报，不可误报。
   - **d（兜底）**：span 越界校验——诊断的行号超出刚写入内容的行数时必然不指涉当前内容，丢弃。通用（任何 server 的 stale 大概率越界），抓同位置以外的漏网。
2. **F9 修复**（tool-surface）：REPL `tool` 命名空间的 `dir()` 返回绑定函数名集（排序），内省面与真实绑定集一致。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `dvc`：write 反馈环的诚实性要求——didSave 触发管线、超时降级策略、span 校验；超时丢 rustc 源的降级语义。
- `tool-surface`：REPL 绑定命名空间的内省契约——`dir(tool)` 列出全部绑定名。

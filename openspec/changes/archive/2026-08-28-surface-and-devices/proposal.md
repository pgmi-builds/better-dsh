# Proposal: surface-and-devices

## 动机

v0.1.8d 实测确认了 DASHR 表面层的一个结构性矛盾：目录掩码（presentation-only）只摘广告不摘通路——被掩的 `skill` 在 `both` 模式下模型直调照样执行（实测探针 §6.3）。同时 REPL 绑定仍靠手工维护的 allowlist，工具 SDK 目录与 wire 协议面大量重复。另一侧，`dvc://` 仍是空占位，而本机 omp harness 已验证 ast/lsp/browser 三类设备的高价值形态。

## 变更内容

1. **注册表掩码**：被 DASHR 替代**呈现面**的原生工具（`skill`、上游 `send_message`、`report`、`list_agents`、`subagent`、`subagent_fork`、`interrupt_agent`、`workflow`、`ralph`）在 agent scope 用 `ctx.tools.restrict({deny})` 摘出 registry 投影——wire schema、目录、REPL 绑定、按名 dispatch 一处生效。能力保留靠工具层桥（`agent_message` 透传 child 下行/parent 上行、`agent://`、`read skill://`），非 registry 豁免。
2. **REPL 自动桥接**：`tool.*` 绑定废除名单，session-start 对 registry 可见全集机械转换（平坦名）；被掩名随投影消失自然不绑。MCP 非平坦名如实注明名称形态限制，不呈现可调清单。
3. **目录改名**：tool-catalog 段改为 REPL bridge instructions（呈现形态 A 纯约定 / B omp 式紧凑签名，实测定案；保留输出契约；措辞为 REPL scripting pad，避免 kernel 一词）。
4. **dvc 设备**：从 omp（MIT，源码在 `upstream/oh-my-pi`）vendor 设备框架 + ast_edit/ast_grep（经 npm `@oh-my-pi/pi-natives`）、browser（puppeteer-core + 系统 Chrome）、lsp（纯 TS + 外部语言服务器可选）。
5. **agent:// roster 修复**：名册并入子代理（含已完成一次性 subagent，经 `listChildren` 的 live+persisted 合并）；`<id>/<child>` 对已完成子代理回退读持久化日志（`sessionPersistence` → `finalAssistantOutput`）。
6. **RAM 物化**：grep/glob 的 content-backed 临时物化从磁盘 `/tmp` 切到 `/dev/shm`（tmpfs 即 RAM blob，ripgrep 无感知，崩溃挥发），回退 `/tmp`。

## 非目标

- 不做 `restrict()` 之外的可见性干预机制（waterfall 软掩码方案已评估并否决，见 design）。
- 不掩 bash/read/write/grep/glob/agent_message/agent_list/goal/todo/MCP——直调是效率通道，REPL 是能力通道，两者平级并存。
- 不改 REPL（run_code/eval）本身的注册方式——它已经是一个平级工具。
- ctx:// 扩键（preset 等）留后续 change。

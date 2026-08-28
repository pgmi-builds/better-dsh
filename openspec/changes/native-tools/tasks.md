## Wave 1 — 三桥退役为真工具（D1）

- [x] 1.1 桥实现纯函数化：`createAgentBridgeBindings` 的三个 callable 改为 `(args, exec, deps)` 形态，行为零变更
- [x] 1.2 三桥 `tools.register`（与 `eval` 同宿主位）：SchemaMaster 平铺参数声明（`meta`/`args` 用 `type:'json'`），`output.schema` 成功∪error union，execute 直调纯函数实现
- [x] 1.3 退役手写路径：删 `AGENT_BRIDGE_SCHEMAS`、`createAgentBridgeBindings` 绑定注入；目录渲染回单源 `collectSdkSchemas`
- [x] 1.4 测试迁移：bridges/surface/presentation spec 从手写 schema 断言迁到 registry 断言；新增「三面逐名相等（例外 eval）」断言与「wire 直调 agent 走 dispatch 管道带审计」断言

## Wave 2 — `llm_completion` 首个原生工具（D3）

- [x] 2.1 实现 `llm_completion` 工具：`ctx.get('llm')` → `createUserMessage` → `llm.stream` + `BlockAssembler` → finish/tool-call 检查 → text；`purpose:'completion'`、路由=calling agent ModelSelection 回落 default-model、maxTokens 上限
- [x] 2.2 出生即注册（Wave 1 模式），wire+REPL+目录三面自动在场；结构化错误不抛
- [x] 2.3 测试：fake llm 服务（route 继承断言 / maxTokens 与 abort 的 error 值断言 / 无 spawn 断言）

## Wave 3 — lsp 接线 write/edit（D2）

- [x] 3.1 write/edit wrapper post-write 钩子：按扩展名映射 lsp server，diagnostics 摘要（计数+首条）附进结果
- [x] 3.2 format-on-write（server 声明 formatter 能力时）；无 server 语言零行为变化
- [x] 3.3 测试：有 server 的语言（诊断注入场景）/ 无 server 语言 byte-identical 断言

## Wave 4 — 发布

- [x] 4.1 typecheck + vitest 全量绿；build + 部署 profile web + 重启（获用户指令后）
- [x] 4.2 版本 0.1.9-a；实测报告新篇；用户实测通过后归档

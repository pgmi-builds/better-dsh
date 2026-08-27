# Tasks: surface-and-devices

## 1. Surface（wire 掩码 + REPL 自动映射 + 目录改名）

- [ ] 1.1 捕获层扩展：`native-capture.ts` 泛化为「session-start 全量捕获」（restrict 前枚举 `registry.schemas(agent)` + 逐名 `ctx.tools.get`，per-agent WeakMap 存 `Map<name, ToolDefinition>`）
- [ ] 1.2 restrict 接线：`agent/session-start` 末尾 `agentCtx.tools.restrict({deny: WIRE_MASKED_NAMES})`（默认名单见 design D1，config 可覆盖）；own-layer wrapper 注册先行（时序断言入测试）
- [ ] 1.3 REPL 绑定单态自动映射：restrict **之后**枚举 `registry.schemas(agent)`（= visible 全集），凡平坦名自动绑、by-name scheduler；无名单无二态（被掩名天然不在 visible）；MCP 非平坦名跳过；删除 MASKED_TOOL_NAMES 的绑定过滤路径（名单仅作 restrict deny 来源）
- [ ] 1.4 `agent_message` 桥下行内部分发改捕获定义（原 `binding('send_message')` 按名会被 restrict 断）
- [ ] 1.5 目录段改 REPL bridge instructions，两选项（design D4）：A 纯约定一句 / B omp 式紧凑签名（每工具一行 `name(args: {…}): Promise<unknown>`，参照 upstream eval.ts `generateCodeModeDeclarations`）；均保留 ToolOutputMap、非平坦名例外、不呈现 REPL 可调清单；部署实测 `unknown binding`/参数错误率定案
- [ ] 1.6 测试：restrict 后 schemas/wireSchemas 无被掩名（fake registry 层链）；被掩名 binding 不存在且 dispatch UNKNOWN_TOOL（全链路消失）；新 host 工具零改动自动入绑；own-layer wrapper 不受 deny 影响

## 2. agent:// roster 修复

- [ ] 2.1 roster 并 children：每个 live session 追加 `listChildren(parentId)` 行（activity→status 映射、parent=该 session、kind=subagent）；inject 增加 `'sessionPersistence'`
- [ ] 2.2 nestedOutput 持久化回退：`activity==='inactive'` → `sessionPersistence.inspect(childId)` → `finalAssistantOutput(events)`；`AgentSubagentsSurface` 扩展对应类型
- [ ] 2.3 label 寻址：roster id 列 `label ?? rawId`；`<id>`/`<id>/<child>` 双匹配（raw id exact 优先，未中按 label）；label 冲突时 raw 优先；测试覆盖 label 命中/raw 优先/冲突
- [ ] 2.4 测试：settled 子出现在名册且输出可取；live 子原路径不回归；unknown child 错误不变

## 3. RAM 物化

- [ ] 3.1 `materialize.ts` 根目录切 `/dev/shm`（可写探测），>8MiB 或不可用回退 `os.tmpdir()`；tmpfs 路径前缀保持 `dashr-url-*`
- [ ] 3.2 测试：shm 可用→目录落在 /dev/shm 且 finally 清理；模拟 shm 不可用→回退 /tmp；超大内容回退

## 4. dvc 设备框架

- [ ] 4.1 `handlers/dvc.ts` 改设备注册表：`registerDevice(name, {execute, docs?})`；bare read=名册（含各设备一行简介）；unknown device 报错保留；`dispatchDvcWrite` 真分发（JSON args 解析、设备错误结构化）
- [ ] 4.2 vendored 署名：`src/url-schema/vendored/devices/` 目录头 LICENSE 并列（omp MIT 条款 + 来源 commit）
- [ ] 4.3 测试：注册/未注册/坏 JSON/设备抛错四路

## 5. 设备 vendor（顺序：ast → browser → lsp）

- [ ] 5.1 spike：`@oh-my-pi/pi-natives` npm 安装实测（linux-x64 加载 + astEdit/astGrep 冒烟）；确认无 postinstall 陷阱后入 dependencies
- [ ] 5.2 vendor `ast-edit.ts`/`ast-grep.ts`（适配 dvc 契约：execute(args)→result），`dvc://ast_edit`、`dvc://ast_grep` 注册 + 测试
- [ ] 5.3 spike：puppeteer-core 是否需 omp 的 33.6KB patch（无 patch 冒烟 open/goto/evaluate）；结论落 design 后再定 vendor 形态
- [ ] 5.4 vendor browser 模块（tools/browser.ts + browser/ 子模块），系统 Chrome 启动参数与 omp 运行时取证对齐；`dvc://browser` 注册 + 冒烟测试
- [ ] 5.5 vendor lsp 模块（lsp/ 目录 + defaults.json），二进制探测优雅降级；`dvc://lsp` 注册 + 已装 server 的最小诊断测试
- [ ] 5.6 三设备接线进 url-schema index.ts（懒加载：session-start 不拉起设备进程，首次 write 才初始化）

## 6. 集成与收尾

- [ ] 6.1 全量 typecheck + vitest；新增依赖过 typecheck 门
- [ ] 6.2 部署 profile + 重启 dsh；实测清单：wire 上无被掩名、`tool.subagent()` cell 内可调、roster 见 children、shm 物化路径、`dvc://` 名册、`dvc://ast_grep` 冒烟
- [ ] 6.3 openspec 文档同步（design spike 结论回填）

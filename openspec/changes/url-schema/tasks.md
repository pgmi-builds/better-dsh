## 1. Spike：vendor 机制定案

- [ ] 1.1 定 vendor 范围（源码直拷进 `src/vendored/`：dsh-better-edit 整包——`hashline/`、`fs-bridge.js`、`tool-read.js`、`tool-edit.js`、`tool-batch-edit.js`、`tool-undo.js`、`edit-engine.js`、`hash-store.js`、`anchor-pipeline.js` 等）+ 移除外部 BetterEdit 插件挂载（cordis.patch.yml 那行），结论写回 design.md D2。验证：确认 dsh-better-edit 完整文件清单与 LICENSE 署名条款，书面化 vendor 文件清单 + 署名清单。

## 2. URL resolver 基础设施

- [ ] 2.1 新建 dsh-url-schema 插件行（cordis.patch.yml host-plane 挂载 + 骨架），验证：插件挂载成功、无 inject 缺失错误、所有 preset（标准/编程模式）均加载。
- [ ] 2.2 实现 scheme→handler 注册表与统一 selector 解析，验证：单元测试覆盖 :N-M / :raw / /path / ?q= 及未注册 scheme 结构化报错。
- [ ] 2.3 vendor BetterEdit hashline 源码直拷进 `src/`，署名 LICENSE/README（Rianico / dsh-better-edit + pi-hashline-edit-lsz），验证：vendor 代码可编译、署名文件含三版权并列。
- [ ] 2.4 实现 DASHR `read` 工具（一个实现两条分支：`scheme://` → resolver；普通文件 → vendored hashline），验证：read skill://foo 返回解析内容、read 普通文件返回 hashline 锚点、沙箱/审批对两条分支均生效。
- [ ] 2.5 实现 write/grep/glob 的 URL 路由（URL → resolver；非 URL → 原生，无 hashline 冲突），验证：write ctx://<var> 生效、grep/glob scheme 资源返回匹配、普通路径无回归。

## 3. skill://

- [ ] 3.1 实现 skill:// handler（ctx.skills → 正文/内部资源，完整分页），验证：read skill://<name> 返回正文、skill://<name>/<path> 返回资源、未注册名结构化报错。
- [ ] 3.2 mask 上游 skill 工具，验证：工具目录不含 skill，skill:// 仍可寻址 skill 内容。

## 4. agent://

- [ ] 4.1 实现 agent:// 四形态（roster / output / transcript / child），验证：裸 agent:// 返回名册、agent://<id> 返回输出、/transcript 返回历史、/child 返回嵌套输出。
- [ ] 4.2 history:// 语义并入 agent://，验证：history:// 不再可用（或提示已并入）。

## 5. dsh://

- [ ] 5.1 实现 dsh://docs（静态文档映射），验证：dsh://docs 返回清单、dsh://docs/<doc> 返回内容。
- [ ] 5.2 实现 dsh://config（resolved settings + 白名单挡 secret），验证：dsh://config 返回生效配置且不含 API key 等 secret。

## 6. ctx://

- [ ] 6.1 给内核新增 query/set 通道（协议消息类型），验证：运行时能按名查/设 user_ns 变量。
- [ ] 6.2 实现 ctx:// handler（JSON-safe→JSON、否则 repr 标注；裸 ctx:// 列命名空间），验证：read ctx://<var> 返回变量值、非 JSON 变量返回 repr 并标注、write ctx://<var> 写入后 read 返回新值。

## 7. xd://（空 scheme）

- [ ] 7.1 实现 xd:// 空 handler（裸 = no devices mounted，xd://<device> = unknown device，write = 无设备可调度报错），验证：read xd:// 与 xd://<name> 返回结构化占位结果。

## 8. 集成验证

- [ ] 8.1 全量复测：read/write/grep/glob 普通路径无回归 + 5 个 scheme 端到端，验证：npm test 全绿（含新增 spec 对应测试）+ 手动 smoke read skill://、agent://、dsh://config、ctx://、xd:// 均返回预期，且 hashline 锚点与沙箱/审批对 URL 解析与文件读取均生效。

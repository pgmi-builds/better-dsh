# fs-scheme-resolution — 实测报告（change 2026-09-12-fs-scheme-resolution）

> 状态：**代码 + 单测 + 活体自测完成**；npm publish 未启动（AGENTS §〇，等 user 单次确认）。

## 1. 被测对象与身份锚定

| 项 | 值 |
|---|---|
| change | `2026-09-12-fs-scheme-resolution`（FS 层挂载 + 工具解绑——上一 change 的 Phase-2 尖兵兑现） |
| 实例 | `dsh-4999-test`（0.1.5-rc.2 + better-dsh monorepo 副本，home `.dsh-test`） |
| 挂载 | home 层 `.dsh-test/cordis.patch.yml`（新建）：`{id: fs-sandbox, name: 'better-dsh/fs-aware-sandbox', config: {urlSchemes: true}}` + `{id: better-dsh, config: {hashline: false}}` |
| 关键裁决 | D2：ctx:///agent:// 为会话型 scheme，FS 层不解析（结构化 `CTX_SESSION_LAYER` 边界），工具层呈现分支继续服务 |
| 实测会话 | `session-1c6ebcab`（自驱，`.scratch/url-schemes-live-driver5.sh`） |

## 2. 代码交付

- `src/fs-aware/sandbox-plugin.ts`：`FsAwareSandboxFileSystem extends SandboxedFileSystem`（**静态**继承——替换行下沙箱包定义性在场；`fs` 服务名由 FileSystem 基类 `super(ctx, 'fs')` 烙定）；override resolve/stat/readText（scheme → UrlResolver 解引用；ctx://、agent:// → `CTX_SESSION_LAYER`）+ writeText/editText（virtual → `FS_VIRTUAL_READONLY`）；`urlSchemes: false` → 全 super 逐位 stock。FS 层 resolver = skill（ctx.skills + fs=this）/ dsh（ctx.settings + resolveDocsDir）/ dvc（模块级共享注册表）/ http。
- 构建面：tsdown 第二 entry → `lib/fs-aware/sandbox-plugin.js`；package.json `exports['./fs-aware-sandbox']`。

## 3. 验证

| 层 | 结果 |
|---|---|
| 单测 `fs-aware.spec` | **5/5**：dsh://docs 虚拟解引用 + stat、CTX_SESSION_LAYER 边界（resolve/readText/agent://）、FS_VIRTUAL_READONLY（writeText×2）、真实路径透传、gate off stock 退化 |
| 全量 | vitest **487 passed / 14 failed**（基线同族，宿主 API 漂移）；tsc **13 基线**；openspec **2/2**（新 change strict 过） |
| 活体（三轮自驱同法） | 见 §4 |

## 4. 活体自测（hashline OFF = read 为零工具层参与的原生 read）

| # | 探针 | 观测 | 判定 |
|---|---|---|---|
| 1 | 原生 read `dsh://docs` | **8,929 chars 文档清单**（agent-lifecycle.md、AGENTS.md、api-gateway.md…） | ✅ **FS 闸口解析直达证据**——零工具层 scheme 代码参与 |
| 2 | 原生 read `dvc://` | 677 chars 设备表（ast_edit/ast_grep/browser/lsp） | ✅ 注册表共享成立 |
| 3 | 原生 read `ctx://session` 系 | 走工具层呈现分支（gates.urlSchemes on），未知 face → 结构化错误；`user_prompts[0]` 正常 | ✅ D2 边界：会话型留工具层；无 wrapper 的消费方则得 `CTX_SESSION_LAYER`（单测证明） |
| 4 | 原生 read `package.json`（path 参数） | isError=true（原生参数校验诚实失败），agent 自纠 `dashr/package.json` 成功 | ✅ 原生语义如实呈现 |
| 5 | 真实路径读取 | 正常（native 格式，无锚点——hashline off 的预期形态） | ✅ 真实路径零扰动 |
| 6 | agent 自发扩展 | eval/glob/bash 附加探针（50,520 chars 输出）全健康 | ✅ 无回归 |

压缩链（`/compact`，13 items / 7,889 tok）与 session persistence 全程正常（FS 替换未扰动会话存储——其自持 fs 不经 ctx.fs，设计如此）。

## 4b. 挂载机制的证伪与改道（重要工程记录）

「home/profile 层同 id 行重述 fs-sandbox + name 重指」在 0.1.5-rc.2 上**不可用**：三种 name 形态（bare 子路径 / 带引号 bare / 相对路径）全部**静默回滚**为 stock（dump 与活体行为双证）。根因：boot 期行导入走 `loader.internal.import`（编译期 bun-registry，仅 @deepseek-ai/* 在册），非在册名替换导入失败 → `Entry.update` 回滚；upstream 根 symlink 亦不达（import 不走 Node 分支）。**采纳改道 = 实例级方法包装**（`src/fs-aware/wrap.ts`，doc §5.3 最后手段）：包装活体 ctx.fs 的 5 个公开方法，urlSchemes 总闸 + symbol 幂等 + 随重启还原；子路径模块/exports 实验回退（D1b 详录 design.md）。已知代价：上游改这 5 个方法签名即碎（公开面，可控）。

> **gates 标签（2026-09-13 补）**：§4 活体于 `urlSchemes: true + hashline: false`（原生 read + FS 包装层）取证。

## 4c. Gate on/off 变体 + LSP 成功路径（✅ 2026-09-12 深夜补测）

- **gate OFF 活体变体（task 2.4 ✅）**：双闸关闭（better-dsh `urlSchemes:false` + fs 行 false）重启后自驱实测——原生 read 把 `dsh://docs` 按相对路径折叠（`/home/u1/workspaces/dashr/dsh:/docs not found`，测试 agent 原话「只有常规的 not found…没有虚拟文件系统，也没有 scheme 解析失败之类的专门报错」），真实文件读取不受影响——**逐位等同 stock**，unit+live 双证。
- **LSP 成功路径（task 2.5 ✅）**：安装 typescript-language-server 6.0.0 + typescript@5.9（**坑**：TS 7.x 无 JS tsserver，t-ls 6.x 需 5.x；且 t-ls 6.0 无 `--tsserver-path` 选项，靠 workspace 根的 node_modules 发现——已装 `/home/u1/workspaces/dashr/node_modules/typescript`）。`write dvc://lsp {action:diagnostics, file:.scratch/lsp-probe.ts}` → server 拉起 → 结构化诊断**精准命中夹具故意埋的 TS2322 type error（line 8）**；同一探针的 wire 渲染含完整 payload JSON（§3.1 修复活体证实）。definition/references/hover/format 共享同一 LSP client，按需补测。
- 六 scheme 修复（§3.1/§3.3/§3.4）已随后续轮次活体证实：`?q=` 行过滤、glob path-backed 翻译、dvc payload 上 wire。

## 4d. skill:// 重分类为会话层 scheme（✅ 2026-09-13 user 裁决 + 活体复验）

**裁决**：技能加载路径解析（CWD / user-level global / app 运行时根如 `.claw/skills`、`.hermes/skills`；扫描深度——DSH 只扫 `skills/` 下一层（`dir/SKILL.md` 或 `*.md`），superpowers/openspec 的二层嵌套扫不到，而 OMP 式 `**/skills/*/SKILL.md` 任意深度命中）**全部是宿主 `dsh-skill-filesystem` 的业务逻辑，插件不得自写一套近似版**。第一版补通道（`sessionCwd` 配置 + scopedAware list 启发式 + 错误信息建议 `.agents/skills/<name>/SKILL.md` 直读）整体拆除。

**证伪链**（推翻上一轮「P1-b 已修复」的活体结论）：
1. **dump-config（.dsh-test 活体）**：`dsh-web-app` bundle patch 在宿主层 **disable** 了 `skill-filesystem` 与 `tool-skill` 行 → web profile 的 **全局层没有任何 skill provider**，技能只在各 agent preset 的 scope 层可见（会话 catalog 可见书签级技能即是 preset 层工具的产物）。
2. **离线 probe**（monorepo 同组合）：全局层 `list({cwd})` 11 项、`get('book-to-skill',{cwd})` OK——registry 本身无恙；4999 活体失败是部署组合（provider 只在 preset 层）所致，非「agent-scope 结构性不可见」。
3. **4999 活体 A/B**（session 8b6dcf85）：FS 层读 user-global 技能（`skill://markitdown`，**无需 cwd** 即应可见）与 project 技能（`skill://book-to-skill`）**双双 `unknown`** → sessionCwd 通道与启发式在真实部署下从未生效（全局层 list 同空）。

**最终形态**：`skill://` 与 `ctx://`/`agent://` 同族，FS 层一律 `CTX_SESSION_LAYER` 边界错误（指名原生 `skill` 工具为调用通道）；`sessionCwd` 从 schema、wrap 线、profile patch 行整体移除；工具层 handler lookup 收敛为 `dsh-tool-skill` 精确镜像（cwd 只取 `agent.session.header.cwd`，scope = agent）；原生 `skill` 工具解禁态即为全功能调用路径。

**活体复验（5+1 探针全过，2026-09-13）**：

| 探针 | 结果 |
|---|---|
| `read skill://book-to-skill`（FS 层） | ✅ 结构化边界错误，指名原生 skill 工具（session 37899b26） |
| `read skill://markitdown:1-5`（FS 层，user-global 名） | ✅ 同上，与技能名无关（session bfa99754） |
| 原生 `skill` 工具 `name=book-to-skill` | ✅ 完整 `<skill_content>` + resourceBase（session f12a206e） |
| `read https://example.com` | ✅ 正常抓取，P1-a 存活（session 60418790） |
| `read dsh://docs:1-3` | ✅ 选择器正常（session c742a81f） |
| `grep path=skill://book-to-skill pattern=^#` | ✅ 560 matches，工具层通道完好（session 029aa5bb） |

回归：vitest 489 passed / 14 failed（agent-family 12 + url-schemes.spec 2，host-drift 基线族，零新增；总测试数 505→504 系删除一条已失效的 cwd-passthrough 测试）；tsc 13（基线）；openspec valid。构建：rsync → tsdown → build-client，`sessionCwd`/`URL_SKILL_NOT_INVOCABLE_SCOPE` 在 lib 双 chunk 0 命中。

## 5. 边界与遗留

- `urlSchemes:false` 活体变体：单测已覆盖（gate off 全 super 矩阵），活体变体启动一轮并入下次批量验证（tasks 2.4 部分完成）。
- `FS_VIRTUAL_READONLY` 经工具 write 不可达（write wrapper 的 scheme 分发先行拦截——dvc 执行语义保留），该错误面由非 wrapper 消费方触发，单测覆盖。
- prod 采用：用户侧加同款 home patch 行（模板见 `.dsh-test/cordis.patch.yml`）；npm publish 未启动。

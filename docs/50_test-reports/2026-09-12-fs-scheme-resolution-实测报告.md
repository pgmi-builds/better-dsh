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

## 5. 边界与遗留

- `urlSchemes:false` 活体变体：单测已覆盖（gate off 全 super 矩阵），活体变体启动一轮并入下次批量验证（tasks 2.4 部分完成）。
- `FS_VIRTUAL_READONLY` 经工具 write 不可达（write wrapper 的 scheme 分发先行拦截——dvc 执行语义保留），该错误面由非 wrapper 消费方触发，单测覆盖。
- prod 采用：用户侧加同款 home patch 行（模板见 `.dsh-test/cordis.patch.yml`）；npm publish 未启动。

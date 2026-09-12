# Tasks: fs-scheme-resolution

## 1. 子路径模块与挂载

- [x] 1.1 **依赖矩阵勘定**：逐一核对 skill/dsh/dvc/http 四个 handler 的 deps 在无 agent、有宿主服务的 FS 插件环境下的可构造性（skill 的目录发现 fs、dsh 的 docs/config 源、dvc 设备注册表、http 零依赖）；ctx/agent 两会话型 scheme 明确排除（D2 裁决），结构化边界错误。
- [x] 1.2 **模块实现**：`src/fs-aware/sandbox-plugin.ts` —— 静态继承 `SandboxedFileSystem`；config `{urlSchemes?: boolean}`（default true，off = 全 super 逐位 stock）；override `resolve`/`stat`/`readText`（scheme 且 gate on → UrlResolver 解引用；真实路径 → super）；override `writeText`/`editText`（virtual → `FS_VIRTUAL_READONLY`）；模块内自建 FS 层 UrlResolver（handler 子集 + FS 层 env：`{agent: undefined, fs: this}`）。
- [x] 1.3 **构建与发布面**：tsdown 第二 entry → `lib/fs-aware-sandbox.js`；package.json `exports['./fs-aware-sandbox']`；`files` 核对。
- [x] 1.4 **单测**：模块类矩阵（virtual resolve/stat/readText、写拒绝、gate off 全 super、真实路径透传、ctx:// 结构化边界错误）。
- [x] 1.5 **挂载行**：`.dsh-test/cordis.patch.yml` 增 `{id: fs-sandbox, name: better-dsh/fs-aware-sandbox, config: {urlSchemes: true}}`；boot 冒烟（boot graph 中 fs 行 provider 为本模块；无同 scope 双 provider 冲突）。

## 2. 验证

- [x] 2.1 **真实路径回归**：4999 活体——session persistence、workspace 文件读写、lsp/present 冒烟（全部真实路径，逐位不变）。
- [x] 2.2 **FS 层直达证据**：gates `{urlSchemes: true, hashline: false}` + 重启 → 自驱实测「原生 captured read 读 `dsh://docs/<doc>` 与 `skill://<name>/…` 成功」（零工具层参与）。
- [x] 2.3 **边界与写面**：`ctx://` 经原生 read → 结构化会话层边界错误；`write` 对 virtual → `FS_VIRTUAL_READONLY`；`write dvc://<device>` 设备执行回归。
- [ ] 2.4 **stock 退化**：`urlSchemes: false` 变体重启 → scheme 原生失败（行为逐位等同 stock fs-sandbox）。——单测已覆盖（gate off 全 super 矩阵 5/5 中的 gate off 用例）；活体变体并入下次批量验证。

## 3. 收口

- [x] 3.1 实测报告落 `docs/50_test-reports/`；git commit。
- [ ] 3.2 prod 采用路径文档化（用户侧 patch 行模板）；npm publish 走 AGENTS §〇（独立闸门）。

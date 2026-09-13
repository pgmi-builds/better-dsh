# Proposal: fs-scheme-resolution — scheme resolution at the FS gate, tools stay native

## WHY

User ruling (2026-09-12, url-schemes 复盘): URL scheme 解析的正确生态位是 **ctx.fs 闸口**（FileSystemService），不是工具层。当前工具层 wrapper（read URL branch / grep / glob / write 的 scheme 转译）是为零 host-swap 风险先拿到价值的 Phase-1 形态；Phase-2 尖兵（`UrlAwareFileSystem extends SandboxedFileSystem`，commit 155f067 已带实现与 5/5 单测）就是终态，本 change 兑现挂载。

## WHAT CHANGES

1. **挂载**：better-dsh 新增子路径模块 `better-dsh/fs-aware-sandbox`（default export = `UrlAwareFileSystem`，静态继承 `SandboxedFileSystem`——被替换行下 `fs` 服务名由 FileSystem 基类 `super(ctx, 'fs')` 自动继承）。部署侧以 home 层同 id 行重述 `fs-sandbox` row、`name` 重指本模块（`Entry.update` replace 分支，失败自动回滚旧插件）。`urlSchemes: false` 时全部 override 短路 → 行为逐位等同 stock fs-sandbox。
2. **解绑面（本 change 兑现）**：`ctx.fs` 的全部消费者自动获得 scheme 解析——原生 read（dsh-tool-fs）、native write/edit 的 resolve、lsp、present、workspace-files。验收锚点 = **hashline gate 关闭**（read 退到 captured 原生 read，零工具层参与）时 `read ctx://session` 仍可用，即「纯原生工具经 FS 层解析 scheme」的直达证据。
3. **保留面（不在本 change 动）**：read.ts 的 scheme 呈现分支（scheme 内容不加 hashline 锚点、不入 served 账本——呈现决策，非解析）；write wrapper 的 `dvc://` 设备执行分发（设备执行语义 ctx.fs 无法表达）；grep/glob wrapper（ripgrep 子进程旁路 ctx.fs，转译型 wrapper）。
4. **写面**：virtual target 写系 → `FS_VIRTUAL_READONLY` typed 错误（尖兵既有行为）；真实路径写/编辑栅栏（sandbox policy、observation policy）全部 `super` 透传不受影响。

## CAPABILITIES

### New: fs-scheme-resolution
挂载契约、virtual 只读面、gate 行为、stock 退化、真实路径零扰动。

## IMPACT

- `better-dsh`：新增子路径模块 + package.json exports + tsdown 第二 entry；read.ts 不动（呈现分支保留）；无数据库/协议变更。
- 部署：4999 home 层 patch 行一行；prod 采用 = 同一行（用户侧加一行或随 better-dsh 附带安装说明）。
- 风险：整插件替换（`Entry.update` replace 分支带回滚）；回归面 = ctx.fs 全部消费者（session persistence 自持 fs 不经 ctx.fs、storage/compaction/web 已列透传矩阵逐一冒烟）。

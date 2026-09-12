# Design: fs-scheme-resolution

## D1b 挂载机制（2026-09-12 深夜实证修订——D1 的行重指被证伪）

D1 原设计（home/profile 层同 id 行 `name` 重指）在 0.1.5-rc.2 上**被证伪**：三种 name 形态（bare 子路径 / 带引号 bare / 相对路径）重述 `fs-sandbox` 行全部**静默回滚**为 stock（dump 与活体行为双证）。根因（源码级）：boot 期行导入走 `loader.internal.import`（`vendor/loader/src/config/tree.ts:150+` 分支 1），按**编译期 bun-registry** 解析——`better-dsh/*` 不在册，替换导入失败 → `Entry.update` 回滚；upstream 根加 symlink 亦不达（import 不走 Node 解析分支）。

**D1b（采纳）**：doc §5.3「最后手段」的实例级方法包装——better-dsh apply 时对活体 `ctx.fs` 实例原位包装 5 个公开方法（resolve/stat/readText 拦 scheme 解引用；writeText/editText 对 virtual 抛 `FS_VIRTUAL_READONLY`；其余原样），`urlSchemes` gate 总闸，symbol 幂等，随重启还原。已实证：hashline:false（原生 read 直通）下 `dsh://docs` 经包装层返回 251 条文档清单。已知代价（doc 明示）：上游改动这 5 个方法签名即碎（公开面，风险可控）；无跨重启记账。原 D1（行重指）保留如下供考古。

## D1 挂载机制（源码锚定；已证伪，见 D1b）

- base bundle 行（`packages/bundle/base/cordis.patch.yml:479`）：`- id: fs-sandbox` / `name: '@deepseek-ai/dsh-fs-sandbox'`（无 config）。
- 行 `name` 重指 = 整插件替换：`EntryTree.import` 对 bare 包名走标准 node_modules 解析（部署拓扑四层，better-dsh 在 profile 树上）；`Entry.update` 对 name 变更走 replace 分支（dispose 旧 + import 新 + 失败回滚）。
- home 层（`.dsh-test/cordis.patch.yml`）同 id 行：
  ```yaml
  - id: fs-sandbox
    name: better-dsh/fs-aware-sandbox
    config:
      urlSchemes: true
  ```
- `fs` 服务名由 `FileSystem` 基类 `super(ctx, 'fs')` 烙定（`packages/fs/fs/src/index.ts:88`）⇒ 子类链自动以 `fs` 名提供服务，无需注册声明。

## D2 子路径模块

`src/fs-aware/sandbox-plugin.ts`：**静态** `import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'`（替换行下该包定义性在场，尖兵的动态 import fail-soft 形态只服务于「未挂载」场景，保留于原工厂不删）。default export：

```ts
export default class UrlAwareSandboxedFileSystem extends SandboxedFileSystem {
  private readonly schemeResolution: boolean
  constructor(ctx: Context, config: { urlSchemes?: boolean } & LocalConfig) {
    super(ctx, config)
    this.schemeResolution = config?.urlSchemes !== false
  }
  // resolve/stat/readText 拦 scheme（urlSchemes off → super 直通）
  // writeText/editText 对 virtual → FS_VIRTUAL_READONLY（gate off → super，即真实路径语义）
  // 其余 super
}
```

virtual 判定复用尖兵 `isSchemePath`（`^[a-z][a-z0-9]*:\/\//`）。virtual `resolve` 返回 `{targetKey: URL, displayPath: URL}`；`readText` 解引用经 UrlResolver（构造时注入——插件的 `apply` 无法用：本模块是纯 Service 类，UrlResolver 从哪来？⇒ 模块内自建：`new UrlResolver()` + 注册全部 handler（与 index.ts 的 handler 注册同源，抽公共工厂复用），deps 的 sessionPersistence 等 env 依赖用 duck-typed 空实现 + agent undefined —— ctx handler 需要 agent env，方案：resolver env 由 `readText` 的调用缺省（`{agent: undefined}`），**ctx:// 在 FS 层不可用**（ctx 需要 live agent 语义，属会话层而非文件层）；FS 层只服务其余五个 scheme + 未知 scheme 的结构化错误。ctx:// 继续走 read.ts 既有 scheme 呈现分支（工具层保留面）。此为 D2 的关键裁决：**FS 层解析文件型 scheme，会话型 scheme 留工具层**。

## D3 解绑边界（兑现 vs 保留）

| 消费者 | FS 层后 | 动作 |
|---|---|---|
| 原生 read（dsh-tool-fs） | `ctx.fs.resolve` → virtual → 解引用 | **零改动即获得**（验收锚点） |
| native write/edit resolve | virtual → `FS_VIRTUAL_READONLY` | 零改动，typed 只读 |
| lsp / present / workspace-files | ctx.fs | 零改动 |
| read.ts scheme 呈现分支 | 保留（无锚点呈现 + ctx:// 会话语义） | 不动 |
| write wrapper `dvc://` 分发 | 保留（设备执行语义） | 不动 |
| grep/glob wrapper | 保留（rg 子进程旁路） | 不动 |
| urlSchemes gate 语义迁移 | 工具层 read branch gate → **FS 挂载 gate**（模块 config） | gate 关 = 行为逐位等同 stock |

## D4 回归面与守卫

- 真实路径零扰动：`isSchemePath` 不匹配 → 全部 super（sandbox containment、observation events、原子写、read-match-write 临界区原样）。
- session/storage：session-persistence-jsonl 自持 fs（不经 ctx.fs）；workspace-files 走 ctx.fs（真实路径为主，行为不变）。
- fs-observation-policy：waterfall 只有否决/记录权，无法改写 target——virtual read 不产生 observation 记录（无真实路径可记），edit-intent/write-intent 对 virtual 的 intent 校验依赖 target 解析 → 由 `FS_VIRTUAL_READONLY` 先行短路。
- 回滚：patch 行删除/`urlSchemes: false` 即回 stock；`Entry.update` replace 失败自动回滚旧插件。

## D5 验证（同类原则）

1. 单测：模块类矩阵（virtual resolve/stat/readText、写拒绝、gate off 全 super、真实路径透传）。
2. 4999 活体（自驱）：`hashline:false` + 挂载 → **原生 captured read 读文件型 scheme（`dsh://docs/<doc>`、`skill://<name>/…`）成功**（零工具层参与的直达证据）；`ctx://` 经原生 read 返回结构化「会话层 scheme」边界错误（D2 裁决：ctx 需要 live agent 语义，留工具层呈现分支）；真实文件读取回归；`write dvc://` 设备执行回归；`write` 对 virtual → `FS_VIRTUAL_READONLY`；`urlSchemes:false` 变体 → scheme 原生失败（stock 退化）。

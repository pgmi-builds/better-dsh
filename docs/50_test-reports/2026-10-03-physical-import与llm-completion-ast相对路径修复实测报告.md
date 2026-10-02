# better-dsh：vendored 包改物理 import + `llm_completion` 返回形态 + ast 相对路径（2026-10-03）

- **对象**：better-dsh `0.2.5-a`（本地过程版本，未发布）
- **载体**：dev 树 + 4999 rig（`.test/home/compat`，unit `dsh-4999-test123`，core `0.2.0-rc.2`）
- **前序**：[2026-10-03-schemastery-cosmokit源码内联实测报告](2026-10-03-schemastery-cosmokit源码内联实测报告.md)、[2026-10-03-better-dsh-tool-surface-repl-dvc-browser-ast-lsp-4999实测报告](2026-10-03-better-dsh-tool-surface-repl-dvc-browser-ast-lsp-4999实测报告.md)（后者的 F1/F3 在本轮修复）

## 一、vendored 包改为"物理 import"（去掉我上一轮加的 shim）

user 裁决：不要额外逻辑，**物理 import** 即可 —— 文件名就叫 `@deepseek-ai/<pkg>`，目标只是避开构建期/运行期的解析 logistics。

**终态**（41 个文件 / **348 KB**）：

```
third_party/
  schemastery/                                   @deepseek-ai/schemastery 3.18.4 (MIT)
    lib/index.mjs  lib/index.cjs  lib/types/…
    lib/index.d.mts                              ← 唯一自加文件（见下）
    src/index.ts  LICENSE  README.md  package.json
    node_modules/@deepseek-ai/cosmokit/           @deepseek-ai/cosmokit 1.8.5 (MIT)
    node_modules/@standard-schema/spec/           1.1.0 (MIT, 仅类型)
```

`package.json` 里一个子路径映射（**删除了 `src/schemastery.ts`**）：

```json
"imports": {
  "#schemastery": {
    "types":   "./third_party/schemastery/lib/index.d.mts",
    "default": "./third_party/schemastery/lib/index.mjs"
  }
}
```

9 个源文件统一 `import z from '#schemastery'`。

**两个必须知道的机制点**（都是实测撞出来的，不是猜的）：

1. **TS 拒绝把 `imports` target 指进 `node_modules` 段**。最初的镜像布局是
   `third_party/node_modules/@deepseek-ai/schemastery/…`，`tsc` 报
   `package.json scope … has invalid type for target of specifier '#schemastery'`；
   读 TS 源码定位到该诊断位于 `loadModuleFromTargetImportOrExport` 的
   `!startsWith(target, "./")` 分支后，把 target 换成不含 `node_modules` 的路径即通。
   于是 schemastery **平铺**在 `third_party/schemastery/`，而它的依赖仍按真实安装形态
   **嵌在它自己的 `node_modules/` 里**——这样 schemastery 内部的
   `import '@deepseek-ai/cosmokit'` 就地解析，**vendored 代码一行都不用改**（`diff -rq`
   与上游逐字节一致，除我们新增的 `lib/index.d.mts`）。
2. **`lib/index.d.mts` 这一个两行文件是必需的**：本包 `"type": "module"`，TS 会把
   `lib/types/index.d.ts` 当 CJS 声明，直接 import `lib/index.mjs` 时取不到类型；
   `.d.mts` 是 TS 的标准 ESM 声明位。

**副产品（比预期更好）**：类型面也不再引用外部 —— `lib/*.d.ts` 现在从**本地 chunk**
（`import { t as Schema } from "./index-DZQNwO7f.js"`）取 `Schema`，`lib/` 里既无
`#schemastery` 也无裸 `@deepseek-ai/schemastery`。即发布物**运行期 + 类型面双双自包含**。

## 二、F3：`llm_completion` 返回形态统一（这是**我们自己**的工具）

它是本插件自研的 one-shot / 无工具 / 无上下文的工具（`src/llm-completion.ts`），桥接上游
`ctx.llm` 服务；不是上游工具。原实现**成功回裸 `str`、失败回 `{ error }`**，程序化调用方
`r["text"]` / `r.keys()` 会炸。

修法（三层一起改，缺一不可）：

- 返回值：`{ ok: true, text }` / `{ ok: false, error }`（9 个错误点 + 1 个成功点）；
- 工具 `output.schema`：`oneOf: [textVariant, errorVariant]`（原为 `oneOf: [string, errorVariant]`
  —— **不改这里会直接报** `value must match exactly one oneOf branch (matched 0)`）；
- `render`：成功时仍渲染纯文本（模型面可读），失败渲染 JSON；
- 描述补一句"直接调用成功时只渲染文本"，消除"契约说对象、surface 是文本"的歧义（本轮第一人称
  agent 如实报了这一点）。
- 测试同步：`test/surface-devices/llm-completion.spec.ts` 4/4 绿。

## 三、F1：ast 设备的相对路径基准改为**会话 workspace**

根因：eval 工具用的是 `exec.agent.session.header.cwd`（`src/index.ts:896`），而 dvc 写入这条路
只把 `session` 传进设备（`dispatchDvcWrite(path, content, meta.session)`），没传 cwd，
`ast-device` 的 `ctxCwd()` 只能回落到**守护进程 cwd**（= `upstream/deepseek-harness`）。

修法：把同一个 cwd 作为 transport 槽位补齐（不是 payload，避免触发设备的严格字段校验）：

- `tools/write.ts`：`writeScheme(..., { session, ...exec.agent ? { cwd: exec.agent.session.header.cwd } : {} })`；
- `handlers/dvc.ts`：`dispatchDvcWrite(path, content, session?, cwd?)` → `device.execute(args, { session, ...(cwd ? { cwd } : {}) })`。

## 四、验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（host + client） | **0 错** |
| `npm run build` | 通过；产物 JS 无任何裸 `@deepseek-ai/schemastery\|cosmokit`；`lib/` 无 `#schemastery` |
| 全量单测 | **57 文件 / 649 passed, 1 skipped** |
| rig 安装 | 两个 profile 均 **`Packages: +1`** |
| rig 启动 | 零 `failed to import` / `did not activate` / `EPIPE`（上一轮修的 EPIPE：新 boot 段实测干净） |
| **F1 第一人称** | `write dvc://ast_grep {"patterns":["loadPiNatives"],"path":"better-dsh/src"}` → 命中 2 文件 / 3 处，且返回 `path` 为 **workspace 相对**（`better-dsh/src/devices/ast/ast-device.ts`） |
| **F3 第一人称** | `llm_completion({prompt:'只回答一个词：OK'})` → 程序化值为 `{ok:true,text:"OK"}`；agent 观测到的 surface 为纯文本 `OK`（render 层行为，描述已写明） |

## 五、未做 / 限制

- **发布**：按 AGENTS.md §〇，`npm publish` 需 user 单次明确放行，本轮未发。
- `third_party/` **不随 tarball 发布**（`files` 不含它）：`lib/` 已经内联了运行期与类型面，
  发布物自包含；vendored 源码只服务本仓构建。`package.json#imports` 因此在发布物里是
  "指向未发布文件"的悬空映射 —— 发布物内没有任何代码 import 它（已实测 `lib/` 零引用）。
- `llm_completion` 的 F5（`maxTokens` 过小时整次失败而非截断）**未动**，见汇报；改动它会变更语义。
- F2（browser 无 cookie 注入通道）、F4（REPL 子调用未并行）未动。

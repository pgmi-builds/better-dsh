# better-dsh：schemastery / cosmokit 源码内联实测报告（2026-10-03）

- **对象**：better-dsh `0.2.5-a`（本地过程版本，未发布）——`@deepseek-ai/schemastery` 从 **optional peer** 改为 **源码内联**（`third_party/`），同批内联其运行时依赖 `@deepseek-ai/cosmokit` 与（类型only的）`@standard-schema/spec`。
- **裁决**：user，2026-10-03 —— "这两个包直接抄进我们的源码里…这样我们就不必去看真实安装环境下它的上游到底在哪里、能不能够得着、解析路径对不对"。
- **载体**：本机 dev 树 + 4999 rig（`.test/home/compat`，unit `dsh-4999-test123`，core dsh `0.2.0-rc.2`）。

## 一、为什么要内联（与前序报告的取舍关系）

[2026-10-02-schemastery依赖声明修复实测报告](2026-10-02-better-dsh-schemastery依赖声明修复实测报告.md) 记录过一次事故与一次撤回：

- 事故：schemastery 曾是我们的 **`dependencies`** → pnpm 在 profile 里**实体化出第二份**并被 profile 锁文件冻在 **3.18.2** → `.volatile()`（3.18.3+）缺失 → `failover`/`compaction` 在**模块作用域**建 schema 时抛错，loader 记为 `failed to import`。
- 撤回：当时结论是"DSH 已自带一份，ride-on-DSH 的插件不该再抄第二份"，改为 optional peer，让解析回落到 harness installation scope。

**本次内联与那次撤回并不矛盾，因为失败模式不同**：

| | 当年（dependencies） | 本次（third_party 源码内联） |
|---|---|---|
| 版本从哪来 | profile 锁文件 / 上游解析 | **本仓 `third_party/` 钉死** |
| 会不会出现两份不同版本 | 会（宿主 3.18.4 vs profile 3.18.2） | 不会：我们只用自己这一份，且**不再声明该依赖** |
| 解析路径依赖 | 强（walk-up / installation scope） | 无（相对路径 import，构建期内联） |

即：把"解析到哪一份"这个变量彻底消掉，而不是把它交给环境的解析顺序。

## 二、改动

- 新增 `third_party/`（344K）：
  - `third_party/schemastery/` = `@deepseek-ai/schemastery@3.18.4`（MIT，Copyright (c) 2021-present Shigma）原样副本；
  - `third_party/schemastery/node_modules/@deepseek-ai/cosmokit/` = `@deepseek-ai/cosmokit@1.8.5`（同版权人）——放这一层是为了让 schemastery 自己的 `import "@deepseek-ai/cosmokit"` **就地解析**，不必改动 vendored 代码；
  - `third_party/schemastery/node_modules/@standard-schema/spec/` = `1.1.0`（MIT，Copyright (c) 2024 Colin McDonnell），仅类型。
  - **唯一自加文件**：`third_party/schemastery/lib/index.d.mts`（转发到包自带的 `lib/types/index.d.ts`，因为直接 import `.mjs` 不会走它的 `exports.types` 映射）。
- `package.json` 增 `imports` 子路径映射 `#schemastery`（→ `./third_party/schemastery/lib/index.mjs`）；9 个源文件（`index` / `runtime` / `web-password` / `web-trust` / `mobile` / `compaction` / `remote` / `failover` / `url-schemes`）统一 `import z from '#schemastery'`。**（后续已改为物理 import 形态并删除 `src/schemastery.ts`：见 [2026-10-03-physical-import与llm-completion-ast相对路径修复实测报告](2026-10-03-physical-import与llm-completion-ast相对路径修复实测报告.md)）**
- `package.json`：删除 `@deepseek-ai/schemastery` peer 声明与其 `peerDependenciesMeta` 条目（peer 59 条 → 58 条生效面）；`files` 增列 `THIRD_PARTY_NOTICES.md`。
- 署名：`THIRD_PARTY_NOTICES.md`（包根，随 tarball 发布：清单 + MIT 全文 + 各权利人）、`third_party/README.md`（provenance、布局、升级步骤、为何内联）。
- `.gitignore`：放行 `third_party/schemastery/node_modules/`（vendored 拷贝要入库）。

## 三、验证

1. **类型**：`tsc --noEmit`（host）与 `tsc -p tsconfig.client.json` 均 **0 错**。
2. **构建**：`npm run build` 通过。产物 **JS 已内联**（`lib/schemastery-*.js` 分块，含 `createVolatile`/`isVolatile`）；运行时**无任何**裸 `@deepseek-ai/schemastery|cosmokit` 引用（仅 `.d.ts` 里保留裸类型引用——与改动前行为一致，非回归；类型面宿主本就供给该包）。
3. **单测**：`vitest run` **57 文件 / 649 passed, 1 skipped**。
4. **4999 rig（第一人称）**：
   - 安装 `Packages: +1`（仍只加自己）；`deps`/`optional` 均为空，schemastery 已不在 peer 清单。
   - **把 profile 树里的 `node_modules/@deepseek-ai/` 整个删掉**后启动：**零 `failed to import`、零 `did not activate`**；`--dump-config` 里 `dashr-failover` + `dashr-compaction-tuning` 两行在场——**正是当年挂掉的那两行**。
   - rig 树里后来重新出现的 `@deepseek-ai/*` 来自 **profile 里的另一个插件 `corti-memory`**（其 `dependencies` 含 `@deepseek-ai/schemastery ^3.18.1`，lockfile 实证），与本插件无关：我们不再贡献该包。

## 四、同批修掉的一个 crash 级 bug（本轮发现，非本次改动的目标）

rig 停机日志出现：

```
dsh: fatal uncaught exception: Error: write EPIPE
    at KernelTransport.send (…/better-dsh/lib/index.js)
    at IpyKernelBridge.dispose
    at DashrRuntime.teardownKernel
```

根因：round 2 新写的 `KernelTransport` 在 teardown 往**已死的 bridge stdin** 写 `shutdown`，`EPIPE` 以**异步 error 事件**到达，而没有 `error` 监听 → Node 升级为 uncaught exception（守护进程级）。修法：给 `child.stdin`/`stdout` 挂 error 监听（吞掉并把 transport 标死、结算 waiter），并把写操作收敛到 `writeLine()`：先查 `writable` 再写，失败抛普通 Error 而不是让管道错误逃逸。**实测**：重装后 boot + stop 全程日志零 `EPIPE`/`fatal uncaught`。

## 五、未做 / 限制

- **未发布**：按 AGENTS.md §〇，`npm publish` 需 user 单次明确放行。
- ~~`.d.ts` 里仍以裸名引用 `@deepseek-ai/schemastery`~~ **已于同日解决**：改为物理 import 后，dts bundler 把 schemastery 类型内联进本地 declaration chunk，`lib/` 里既无 `#schemastery` 也无裸名——运行期与类型面双双自包含。
- 升级 vendored 版本是**行为变更**（settings/config 全表面）：须跑全量单测 + 4999 第一人称后方可发版（步骤见 `third_party/README.md`）。

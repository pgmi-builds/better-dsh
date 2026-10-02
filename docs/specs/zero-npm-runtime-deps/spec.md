# better-dsh 归零 npm 运行时依赖（zero-npm-runtime-deps）

状态：**已完成**（round 1–4 全部落地并实测；发布待 user 放行） ｜ 规格路径：`docs/specs/zero-npm-runtime-deps/spec.md`（仓库根 docs；`better-dsh/docs/` 是 `prebuild` 由 `../docs` 重建的产物，别写那里）

## 0. 动机（实证）

一次 DSH UI Plugin Manager 安装的真实日志：

```
+ better-dsh 0.2.5-a
Packages: +15 -71
node_modules/zeromq install$ node ./script/install.js     ← 我们的 REPL 原生依赖，cmake 构建
Done in 3.7s using pnpm v11.7.0
[WARN] GET …/@oven/bun-linux-aarch64-android/-/…-1.4.2.tgz error (UND_ERR_SOCKET). Will retry in 10 seconds.
dsh: pnpm printed nothing for 600000ms and was terminated
```

1. **卡住的东西不是 better-dsh 的**：`bun@1.4.2`（12 个平台包，各 ~86 MB）来自同一 profile 的 `super-dsh@0.1.9`。DSH 把插件 profile 设计成**一个共享 pnpm 工程**，于是"装插件 X" = "重解整个 profile"（`Packages: +15 -71` 是指纹）。
2. **失败形态是超时、不是构建错误**：Plugin Manager 对每条捕获输出的 pnpm 运行挂 600000 ms 静默上限（`packages/boot/plugin-manager/src/index.ts:184`），超时杀树并打印 `operations.ts:453` 那句；真正的错误只是一条被吞掉的 WARN。
3. **我们自己也在这条链上**：`zeromq@6.6.0` 是硬 `dependencies`，其 install 脚本用 cmake-ts 现场编译；`src/kernel.ts:20` 是**顶层静态 import**，该原生模块一旦拿不到，**整个插件加载死**（不只是 REPL）。`docs/specs/kernel-provisioning` 的三级自愈只覆盖 Python venv。

user 裁决（2026-10-03）：**不要 declare 任何运行时依赖，不要 postinstall，不要碰 Node 包管理器**；二进制由我们自己的代码在 spin-up 自检与首次使用 lazy 时自装；装不上就那个组件不可用，其他组件照常。

## 1. 目标态（硬契约）— ✅ 已达成

- `package.json`：`dependencies` / `optionalDependencies` / `scripts.postinstall` **全部不存在**；60 条 `peerDependencies` 保留（harness 契约，由 loader 安装域供给）。真实安装器实测 `Packages: +1`（只加自己）。
- 运行时需要的一切只有两条出路：**构建期进产物**（tsdown `noExternal` 内联；资产随 `files`）或**运行期自装到插件自管目录**（不调用 npm/pnpm/npx）。
- 供给触发点只剩：**守护进程 spin-up 自检** + **首次使用 lazy**。
- **fail-open 硬要求**：任何一项失败只让该组件不可用，插件整体加载与其余组件零影响。

## 2. 逐依赖处置与进度

| 依赖 | 用户 | 处置 | 状态 |
|---|---|---|---|
| `diff` | hashline `edit-diff.js` | tsdown `noExternal` 内联 | ✅ 已内联（`//#region node_modules/diff/...` 实证），已从 `dependencies` 移除 |
| `xxhash-wasm` | hashline `hash-assign.js` | 同上（wasm 在 esm 构建里已内联为 `Uint8Array`，无外部资产） | ✅ 已内联，已移除 |
| `file-type` | hashline `file-view.js`（A/B 实测：该调用点在**改动前就已被 tree-shake**，产物里只剩一条裸 `import "file-type"`） | 直接移除；内联与否不影响运行时 | ✅ 已移除 |
| `use-sync-external-store` | client 半 | client 构建早已 `noExternal` 内联（产物零引用实证） | ✅ 已移除 |
| `puppeteer-core` | `dvc://browser`（`await import()`） | 构建期内联（`lib/puppeteer-core-*.js`，206 导出）；实测拉起系统 Chrome 成功；保留 vendor 自装兜底 | ✅ 已移除声明 |
| `zeromq` | REPL `src/kernel.ts:20` 静态 import | 删除；传输层改 venv 内 Python bridge | ✅ 已删除（`dependencies` 现只剩 `puppeteer-core`；Node 产物零 zeromq 引用） |
| `@oh-my-pi/pi-natives-<platform>` | AST（`natives-loader.ts` 已 fail-open） | `ensurePiNatives()` 首用自装到 `<packageRoot>/.vendor`；加载器 vendor 精确查找 + 锚点有界 | ✅ 已移除声明，实测通过 |

`scripts.postinstall`：✅ 早已不存在（0.2.2-a 起零 lifecycle script）——本次要消灭的是**依赖带进来的 install script**（zeromq）。

## 3. REPL 传输层重写（round 2 已落地，待 4999 复测）

现状：Node 是 Jupyter 客户端，用 `Dealer`/`Subscriber` 直连 ipykernel 的 shell/iopub/control（`src/kernel.ts:249-344`）。

目标：

```
Node(TS) ──stdio JSON lines──► bridge.py（venv python + pyzmq/jupyter_client）──ZMQ──► ipykernel
```

- `pyzmq` / `jupyter_client` 由 `ipykernel` 传递依赖保证在场（实证：`.venv-kernel/lib/python3.11/site-packages/zmq`）。
- 保留语义：cell 串行、iopub 流式、control 中断 + SIGALRM 升级、超时/dispose 时序、comm（host 请求桥）。
- Node 侧不得再出现 zeromq/原生 socket；venv 未就绪时 `dashr-repl` 行**不抛**，标为未就绪。

## 4. 供给阶梯（改造后）

1. **守护进程 spin-up 自检**（主路径；`resolveKernelEnv` 已有，新增 bridge 可启动检查）。
2. **首次使用 lazy**（兜底）。
3. ~~postinstall~~ 不存在。

## 5. 验收（对齐"改动点同类"红线）

- 清单零 `dependencies`/`optionalDependencies`/`postinstall`；`npm pack` 后 tarball 自足。
- 断网/无 npm：`dsh plugin add <tarball>` 成功、插件加载成功、REPL 由 venv 自足跑通一次真实 `eval`。
- 无 zeromq 时：插件加载正常、其余组件全可用、只有 REPL 在缺 venv 时明确报"未就绪"。
- 4999 第一人称实测 + 报告落 `docs/50_test-reports/`。
- 发布仍需 user 明确放行。

## 6. 已知风险

- `puppeteer-core` 打包兼容性（动态 require / `import.meta`）未验。
- Python bridge 多一跳后的中断/流式时序（SIGALRM 升级路径最敏感）。
- 自装代码自担：版本钉死、sha512 校验、平台探测、并发去重、代理/离线行为。

## 7. 进展日志

- **round 1（2026-10-03）**：`tsdown.config.ts` 增 `BUNDLED_RUNTIME` + `noExternal`（含 `file-type` 的纯 JS 闭包：`@borewit/text-codec`/`@tokenizer/*`/`debug`/`ieee754`/`strtok3`/`token-types`/`uint8array-extras`）；`package.json` 的 `dependencies` 从 6 项降到 2 项（只剩 `puppeteer-core`、`zeromq`）。验证：`npm run build` 通过；产物内联 `diff` + `xxhash-wasm`，除 `puppeteer-core`/`zeromq` 外无任何外部包引用；全量单测 **649 passed / 1 skipped**。
- 顺手发现：`better-dsh/docs/` 是构建产物（`scripts/copy-docs.mjs` 会 `rmSync + cpSync ../docs`），规格必须写在仓库根 `docs/`。
- **round 4（2026-10-03）**：清单归零并接线自装器。`vendor.ts` 增 `VENDOR_ROOT = <packageRoot>/.vendor`；`natives-loader` 增 `ensurePiNatives()`（首用 lazy；显式 anchor 永不 provision）+ vendor 精确查找；`ast-device` 两处调用点 `await nativesOrThrow()`；`browser-device.loadPuppeteer()` 失败时走 vendor。删 `dependencies` + `optionalDependencies`（顺带修掉 round 2 我引入的重复 `puppeteer-core` 键）。实测：**`Packages: +1`**；puppeteer 内联后成功 `launch()` 系统 Chrome（`BUNDLED_PUPPETEER_OK`）；`dsh headless` 让 agent 走 `dvc://ast_grep` → `totalMatches 3 / files 2 / searched 189`，同时 `<plugin>/.vendor` 出现 314MB pi-natives，而 **profile 树里无 `@oh-my-pi`**（证明自装生效）；全量单测 **649 passed / 1 skipped**。报告：`docs/50_test-reports/2026-10-03-zero-npm-runtime-deps实测报告.md`。
- **round 3（2026-10-03）**：① 新传输最后一条未验路径打通：`/tmp/smoke-comm.mts` 走通 host-request comm（内核 `create_comm('dashr.host')` → iopub → Node → **control** 通道 `comm_msg` 回包 → 内核 control-thread handler 解 future），cell 打印 `HOSTREPLY {'pong': True, ...}`。② **4999 第一人称实测**：新 tarball 装进 rig 的 web + headless profile（物理树里 **`zeromq` 已消失**），`dsh headless` 真实 session：`eval` 跑出 `REPL_OK 42`，同一 Python session 内 `await tool.bash({...})` 拿回 `HOST_OK\n`（宿主参数校验失败路径也顺带被触发），启动日志零错误、composed tree 含 `dashr-repl`。③ 新增 `src/vendor.ts`——零依赖自装器（registry packument → sha512/shasum 校验 → 自写 tar+pax 解包 → `createRequire` 解析入口 → 递归依赖闭包 + os/cpu/libc 平台过滤 → staging+rename 原子落盘）。实测：provision `@oh-my-pi/pi-natives-linux-x64@18.0.6`（2×163MB `.node`）并 **dlopen 成功**（exports `astGrep`/`astEdit`/…），二次调用 reuse。④ 注意：`better-dsh-0.2.5*.tgz` 是**入库的** rig 交付物，本轮为实测重新打包覆盖。
- **round 2（2026-10-03）**：REPL 传输层换成 venv 内 Python bridge。新增 `src/kernel-bridge.py`（stdio JSON lines ↔ pyzmq/jupyter_client；`default=str` 序列化，避免 header 的 `datetime` 打死 pump 线程）与 `src/kernel-transport.ts`（spawn/readline/`waitFor`/`onExit`）；`kernel.ts` 删掉 `import { Dealer, Subscriber } from 'zeromq'`、`DELIM`/`encode`/`decode`/socket 字段/iopub pump，改由 `handleTransportMessage` 路由。`scripts/copy-kernel-bridge.mjs` 把 .py 拷进 `lib/`（`files: [lib]` 覆盖），`build` 链尾追加。验证：`tsc --noEmit` 0 错；全量产物零 `zeromq`；真实 ipykernel 冒烟通过（kernel_info ✅ / `print("SMOKE",6*7)` → `"SMOKE 42\n"` ✅ / 到 idle ✅ / **KERNEL_BOOTSTRAP 单元执行无错** ✅ / interrupt ✅ / dispose ✅）。⚠ 尚未经新传输验证的路径：host-request comm（内核侧 `dashr.host` → Node `serveHostRequest` → control 通道 comm_msg 回包），留给 4999 实测。

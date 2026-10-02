# better-dsh 归零 npm 运行时依赖 — 实测报告

日期：2026-10-03 ｜ 规格：`docs/specs/zero-npm-runtime-deps/spec.md` ｜ 目标版本：`0.2.5-a`（本地过程版本，未发布）

## 0. 一句话

better-dsh 的 `dependencies` / `optionalDependencies` / `postinstall` **全部为空**（60 条 `peerDependencies` 契约保留）；真实安装器（DSH Plugin Manager 底层 pnpm）安装本插件现在只加 **1 个包**；REPL 的原生 ZMQ 依赖被换成 venv 内的 Python bridge；AST 的原生 `.node` 与 browser 的 puppeteer 由**我们自己的代码**在首次使用时自装/内联；任何一项失败只让该组件不可用。

## 1. 起因（user 报告的真实现象）

DSH UI Plugin Manager 安装 better-dsh 时卡住并显示：

```
+ better-dsh 0.2.5-a
Packages: +15 -71
node_modules/zeromq install$ node ./script/install.js     ← 我们的 REPL 原生依赖（cmake 构建）
Done in 3.7s using pnpm v11.7.0
[WARN] GET …/@oven/bun-linux-aarch64-android/-/…-1.4.2.tgz error (UND_ERR_SOCKET). Will retry in 10 seconds.
dsh: pnpm printed nothing for 600000ms and was terminated
```

定性：**不是构建错误，是超时**。Plugin Manager 对每条捕获输出的 pnpm 运行挂 600000 ms 静默上限（`packages/boot/plugin-manager/src/index.ts:184`），超时杀树并打印 `operations.ts:453` 那句。卡住的下载（Android/arm64 的 Bun 二进制）来自**同一 profile 里另一个插件**（`super-dsh@0.1.9 → bun@1.4.2`）：插件 profile 是一个共享 pnpm 工程，"装插件 X" = "重解整个 profile"，于是**别人的安装步骤能拖死我们的安装**。user 裁决：不再 declare 任何运行时依赖、不要 postinstall、不碰 npm/pnpm，二进制由组件自己按需自装。

## 2. 改动清单

| 组件 | 原依赖 | 现处置 |
|---|---|---|
| hashline（`diff`/`file-type`/`xxhash-wasm`） | npm 依赖 | `tsdown noExternal` 内联进 `lib/`（`file-type` 经 A/B 构建证明在改动前就已被 tree-shake，直接删） |
| client（`use-sync-external-store`） | npm 依赖 | 早已内联进 `lib/client/index.js`，删除声明 |
| REPL（`zeromq`） | npm 依赖 + **顶层静态 import**（缺原生模块 → **整个插件加载死**） | 声明删除；新增 `src/kernel-bridge.py`（venv 内 pyzmq/jupyter_client，stdio JSON lines）+ `src/kernel-transport.ts` |
| browser（`puppeteer-core`） | npm 依赖 | 构建期内联（实测可拉起 Chrome）；保留 vendor 自装兜底 |
| AST（`@oh-my-pi/pi-natives-*`） | 5 条 `optionalDependencies` | 声明删除；新增 `src/vendor.ts`，首次使用时自装到 `<packageRoot>/.vendor` |

新增：`src/vendor.ts`（零依赖自装器：registry packument → sha512/shasum 校验 → 自写 tar+pax 解包 → `createRequire` 解析入口 → 递归闭包 + `os/cpu/libc` 平台过滤 → staging+rename 原子落盘）、`scripts/copy-kernel-bridge.mjs`（把 .py 拷进 `lib/`）。**全程无 `child_process`、无 npm/pnpm/npx 调用**。

供给触发点：**守护进程 spin-up 自检**（原有，fire-and-forget）+ **首次使用 lazy**（`ensurePiNatives()` / `loadPuppeteer()` / venv lazy）。无 postinstall。

## 3. 实测证据

### 3.1 安装（真实安装器，rig profile）

```
web       Packages: +1   Done in 1.8s using pnpm v11.7.0
headless  Packages: +1   Done in 858ms using pnpm v11.7.0
```

安装前后 profile 物理树零 `zeromq` / 零 `@oh-my-pi` / 零 `puppeteer`；插件照常加载，启动日志零错误，composed tree 含 `dashr-repl`。**这同时证明 fail-open：REPL 的原生依赖不在场，插件不再跟着死。**

### 3.2 REPL（新传输层）

- 直连冒烟（真实 ipykernel）：kernel_info ✅ / `print("SMOKE",6*7)` → `"SMOKE 42\n"` 流式 ✅ / 到 idle ✅ / **KERNEL_BOOTSTRAP 单元执行无错** ✅ / interrupt ✅ / dispose ✅。
- host-request comm（新传输唯一未覆盖路径）：内核 `create_comm('dashr.host')` → iopub → Node → **control 通道** `comm_msg` 回包 → 内核 control-thread handler 解 future；cell 打印 `HOSTREPLY {'pong': True, ...}` ✅。
- **4999 第一人称**（`dsh headless` 真实 session）：
  - `eval` → `REPL_OK 42`；
  - 同一 Python session 内 `await tool.bash({...})` → `HOST_OK\n`（宿主参数校验失败路径亦被触发）。

### 3.3 AST（自装器）

- 自装器单测：provision `@oh-my-pi/pi-natives-linux-x64@18.0.6`（2×163MB `.node`）→ **dlopen 成功**（exports `astGrep`/`astEdit`/…）→ 二次调用 reuse → `^18.0.0 -> 18.4.12`。
- **4999 第一人称（最终产物）**：`dsh headless` 让 agent 用 `dvc://ast_grep` 搜 `loadPiNatives` → `totalMatches: 3 / filesWithMatches: 2 / filesSearched: 189`；同一时刻 `<plugin>/.vendor` 出现 **314MB** 的 `@oh-my-pi/pi-natives-linux-x64`，而 **profile 树里没有 `@oh-my-pi`** —— 证明二进制是我们自己下的。

### 3.4 browser（puppeteer 内联）

`lib/puppeteer-core-*.js` 导出 206 项（含 `launch`/`connect`）；用系统 Chrome 实测 `launch()` → `setContent` → `evaluate` 取回 `BUNDLED_PUPPETEER_OK`。

### 3.5 构建卫生

`tsc --noEmit` 0 错；`npm run build` 通过；产物除 peer 契约外无外部包引用（`zeromq` 彻底消失）；全量单测 **57 files / 649 passed, 1 skipped**。

## 4. 过程中修掉的两个真 bug（都是本轮暴露、本轮修复）

1. **bridge 静默死通道**：jupyter_client 反序列化后的 header `date` 是 `datetime`，`json.dumps` 抛异常且**在 pump 线程里静默打死整条通道**（现象："桥 ready 了但一条消息都没有"）。修法：`default=str` + 单条消息失败不许杀通道。
2. **自装器锚点逃逸**：`findPackageDir(name, VENDOR_ROOT)` 会从 `.vendor` **向上走出**到 `node_modules`，破坏加载器"锚点有界"契约（单测 `ast-device.spec.ts` 抓到）。修法：vendor 走精确路径 `VENDOR_ROOT/node_modules/<name>`，且显式 `fromDir` 探测时**永不 provision**。
   另修正 round 2 我引入的 `package.json` **重复 `puppeteer-core` 键**（已在清空依赖块时一并消除）。

## 5. 未做 / 已知限制

- **未发布**。按本仓红线，`npm publish` 需 user 单次明确放行。
- 自装代码自担：版本钉死、sha512 校验、平台探测、并发去重（当前无锁：两个进程同时首用可能重复下载，后者被 rename 覆盖）、代理/离线行为。
- AST 首次使用要下 ~314MB（上游包内含 baseline+modern 两个 CPU 变体，无法只取其一）。
- `.vendor`/`.venv-kernel` 都在包目录内，**重装插件会重下**（与既有 venv 行为一致）。
- 本机 rig 树里残留的旧 `@puppeteer`/`@oh-my-pi` 目录已手工清除（pnpm hoisted 树不回收无引用目录）。

# better-dsh schemastery 依赖声明修复实测报告（2026-10-02）

- **对象**：better-dsh **0.2.5 → 0.2.5-a** —— `@deepseek-ai/schemastery` 从 `dependencies` 改为 optional **peer**（commit `c4018aa`）
- **症状（用户报告）**：prod 实例每次启动都出现
  `dashr-failover (better-dsh/failover): failed to import` +
  `dashr-compaction-tuning (better-dsh/compaction-tuning): failed to import`
  （本机 PC 3080 journal 自 **Sep 29** 起、共 **10 次 boot** 均复现，另附 `corti-memory`；dev3 prod 3080 同样两行）
- **载体**：本机 PC 3080 / dev3 prod 3080（dsh **0.2.0-rc.2**）+ 干净 profile 单变量复现 + dev3 全新重装验收

## 一、根因

**链条**：better-dsh 把 `@deepseek-ai/schemastery` 写在自己的 **`dependencies`** → pnpm 在 `profiles/<p>/node_modules/@deepseek-ai/schemastery` **实体化出第二份** → Node 就近 walk-up 先命中这一份，**永远走不到 harness 的 installation-scope 拦截** → 该份被 profile 的 lockfile 冻在 **3.18.2**，而宿主已随 dsh 升到 **3.18.4**。

**为什么致命**：`.volatile()`（dsh 0.1.7+ settings 模型所需）**3.18.3 才引入**。better-dsh 的 `failover` / `compaction` 在**模块作用域**用 `.volatile()` 建 Config schema，导入即抛 → loader 记为 `failed to import`（fiber 根本没建）。

| 构建产物 | `volatile` 命中 | 实测 |
|---|---|---|
| `lib/failover/index.js` | 4 | **FAILS** |
| `lib/compaction/index.js` | 4 | **FAILS** |
| `lib/url-schemes/index.js` | 0 | OK |
| `lib/index.js`（main） | 0 | OK |

**harness 本来就已经供给它**（app-boot `collectInstallationScopePackages`）：从已安装的 `@deepseek-ai/dsh` manifest 出发，BFS 走 **`dependencies ∪ peerDependencies` 传递闭包**，闭包内每个名字对**所有 profile** 生效。而 **dsh 自己 declare 了 `@deepseek-ai/schemastery: ~3.18.4`**，宿主树内即有（`…/dsh/node_modules/@deepseek-ai/schemastery`，**3.18.4**，带 `.volatile()`）。所以指针本应指向宿主，被我们自己搬到了 profile 层。

## 二、修复

`c4018aa`：把 `@deepseek-ai/schemastery` 从 `dependencies` **删除**，只保留 optional peer 声明（与 `@deepseek-ai/dsh-*` 等其他 harness 包同款）。这样 pnpm 不再在 profile 里物化副本，解析回落到 installation scope（宿主的 3.18.4）。

（前一轮 `f11dda8` 的 floor bump `^3.18.1 → ^3.18.3` 保留为 0.2.5 存量用户的桥；peer 修正落地后不再有实际作用。**已按 §〇.5 撤回自包含/vendoring 方案** —— DSH 已 bundle 过一次，ride-on-DSH 的插件不应再抄一份。）

## 三、验证

**1) 单变量复现/对照（决定性）**：一个 boot 完全干净的 profile，把 schemastery 从 3.18.4 换成 **3.18.2** → 重启后**恰好这两行**失败；换回即干净。单一变量、单一结果。

**2) 新 profile 装修正版**：profile 内 **`@deepseek-ai/` 整个目录都不存在**；boot **零 `did not activate`**。

**3) dev3 全新重装验收（第一人称，按 user 指令做的实验）**：
- 保留全部 user 数据（`sessions`/`storages`/`credentials`/`superd`/`task-board`），`cordis.patch.yml`（111 行用户层）原样恢复；
- 清空 `~/.dsh/profiles`（2.4G）与全局 DSH → DSH **从 registry** 重装 `0.2.0-rc.2`；
- profile 重建：DSH/SuperD **从 registry**，**better-dsh 用本次修正 tarball**；
- 结果对照：

  | | 修复前 | 修复后 |
  |---|---|---|
  | `dashr-failover`/`dashr-compaction-tuning` `failed to import` | **2** | **0** |
  | `dsh: warning: N entries did not activate` | 有 | **整行消失** |
  | profile 层 `node_modules/@deepseek-ai/` | schemastery 3.18.2 + cosmokit | **不存在** |
  | 正向验证 `curl :3080/` | — | **200 + `Enter the session password`**（web-password 行活着，独占 exact `/`） |

- 剩余 warning 属 **super-dsh**（`superd-hermes`/`superd-codex` 各 1 条 `session-controller: pending (waiting for service: fileUploads)`）——**pending 非 failed，且修复前的 boot 同样存在**，与本修复无关。

**4) 单元/类型**：`tsc --noEmit` **0 错**；`vitest run` **649 passed / 1 skipped**（57 文件）。

## 四、附：一个独立的运维坑（非本 bug）

本机曾出现 `dsh plugin add/remove` 报 `node_modules was installed with a different major version of pnpm`。根因 = **两个 pnpm 版本打架**：`/home/u1/.local/bin/pnpm` = 11.7.0（profile 的 node_modules 由它建，store **v11**）、`/usr/local/bin/pnpm` = **10.29.2**；某些调用上下文 PATH 不含 `~/.local/bin` → harness 调到 pnpm 10 去动 v11 建的树 → 硬错。

**已修**：`sudo npm i -g pnpm@11.7.0` → 两个路径均 **11.7.0**；模拟"`~/.local/bin` 掉出 PATH"的最坏情况仍得 11.7.0。dev3 全程用其本地 pnpm 10.33.2 干净完成安装，证明**该 bug 与 pnpm 无关**。

## 五、判定

**通过**。根因单一且已用单变量复现 + 全新重装双重证明；修复面只有一个声明位的移动；dev3 第一人称验收 0 失败。发布 `0.2.5-a`。

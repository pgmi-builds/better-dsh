# test123 — plugin-add 测试 rig

Dev/Test 的现行形态：**干净 harness + 交付物插件**。与 prod 完全同构的解析分层，只是"全局 npm 安装"换成了 upstream checkout。

## 形态

```
upstream/deepseek-harness     # 纯上游：tag + 本地构建 patch（见 .scratch/rc1-local.patch 流程）
                              #   不含 better-dsh 任何内容
better-dsh/                   # 插件 canonical：独立开发（symlink 农场供类型），npm pack 出 tarball
.tests/test123/
  start.sh                    # 启动/重启（PORT 可覆盖，默认 4999；LAN 中继默认开）
  home/                       # DSH_HOME（gitignored；user data 跨重启保留）
    profiles/
      node_modules/@deepseek-ai/*   # ③ 层 symlink 农场 → upstream 物理包
      web/                    # profile：better-dsh 为物理安装（tarball 经 plugin add）
    sessions/ storages/ .env ...
```

## 建立/重建（种子再生）

```bash
# 0) 前提：upstream checkout 在目标 tag 上、已 pnpm install + pnpm run build
# 1) home + ③ 层农场 + .env
mkdir -p .tests/test123/home/profiles
node better-dsh/scripts/link-upstream.mjs --target .tests/test123/home/profiles/node_modules
cp ~/.dsh/.env .tests/test123/home/.env
# 2) profile 由 plugin add 首次使用时自动初始化；zeromq 构建决策点在
#    home/profiles/web/pnpm-workspace.yaml 的 allowBuilds 填空（set this to true or false → true）
DSH_HOME=$PWD/.tests/test123/home node upstream/deepseek-harness/apps/cli/lib/bin.js \
  plugin --profile web add $PWD/better-dsh/better-dsh-0.2.4-b.tgz
# 3) 启动
bash .tests/test123/start.sh
```

## 重置（只清源码依赖，不动 user data）

```bash
rm -rf .tests/test123/home/profiles/web
# 然后从上面第 2 步重来（农场、sessions、storages、.env 原地不动）
```

专门测卸载语义时才走 `plugin --profile web remove better-dsh`（reconcile 自动把
better-dsh 从 bundles 摘掉、node_modules 移除）；"回到干净"用上面的种子再生。

## 已知坑（2026-09-24 实测）

- **file: tarball 内容更新后 pnpm 不自动刷新**（同版本同路径 → `added 0`）：
  改了包必须 remove → add 一个来回，别信"add 幂等刷新"。
- **首启有 Internal Testing Notice 公告**，自动化探针要先关 dialog。
- 插件 manifest 的 `dsh.client`（platform/inject）是 client 半边进 boot graph 的
  发现机制；`dsh.bundle.patch` 是 host 组合入场券。两者缺一不可，改 manifest 后
  重新 pack + remove/add。

## 热插拔（2026-09-24 二次实测修正：**真热插拔**，首测结论作废）

首测"不热"是测量事故：只等了 2 秒就下结论——刷新链（chokidar 写入稳定 + 全量 profile 重载 +
reconcile 的异步 import/dispose）需要 5~15 秒；且 boot graph 是**每请求从活树渲染**的，不是
boot 快照（用 web-trust 注入的 zoom-guard 脚本作每请求信号验证过）。

| 操作（daemon 全程不重启） | 生效时间 | 证据 |
|---|---|---|
| profile patch YAML 加 disable 行 | ~6s | zoom-guard 脚本从 HTML 消失、graph 归零 |
| 恢复 YAML（拔掉 disable） | ~8s | 脚本回归、graph=1 |
| `dsh plugin remove`（manifest+node_modules） | ~15s | graph 归零、磁盘删除 |
| `dsh plugin add` tarball | **~5s** | graph=1，浏览器实测两行设置面正常（保存✔） |

机制（0.1.7 源码）：HMR 同时 watch `profile.patchPath`、home 层 patch、**profile `package.json`**
（`hmr/src/index.ts:235-236`）；refresh 走 `readProfilePatches`→`loadProfileDirectory` 全量重载
（含 bundle 层）→ `reconcileProfilePatches` 活树增删（entry 层）。运行时解析表对 profile
`node_modules` 是**每次 statSync 的活检查**（resolver route:native 分支），新装包即装即解析。

**仍不热的边界**：`node_modules` 内的**代码替换**——HMR module 层 watcher 显式 ignore
`**/node_modules`；改已装插件的 lib 代码必须重启（或走 profile 内 lib 覆盖 + 刷新只对
client 半边有效）。installation-scope 重定向集合进程内冻结（`replace()` 对既有条目变更
直接 throw "requires a process restart"）。

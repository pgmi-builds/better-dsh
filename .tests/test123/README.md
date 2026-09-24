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

## 热插拔边界（沿 guides 草案 §5）

- plugin add / remove = 组合结构变化 → **重启 profile**（start.sh）后生效。
- client 半边（lib/client）重建 + 刷新页面即生效，无需重启。
- profile 配置（cordis.patch.yml）默认热重载。

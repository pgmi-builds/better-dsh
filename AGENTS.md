# DASHR (better-dsh) — dsh 拓扑与 Dev/Test 约定

本文件是 agent 指引的一站式契约：prod 拓扑、两条 dev/test 路径、以及当前已知风险。（旧 `agents.md` 的 Prod/Caddy 事实已并入本文件。）

---

## 一、Production Native dsh 拓扑

### Core（`~/.local`）— 用户级全局安装

```
/home/u1/.local/bin/dsh
   └─ symlink → /home/u1/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
```

- `@deepseek-ai/dsh` = **v0.1.2-alpha.3**（npm 发布版），约 313MB，自带 vendored `node_modules`。`npm install -g --prefix ~/.local` 的用户级全局安装。
- `dsh` 不是 ELF，是 `#!/usr/bin/env node` 的 JS 入口。**它只当启动器**：`bin.js` 解析 boot 哪个 profile、哪些 patch overlay，其余参数透传；`web` 是 `--profile web` 的硬别名；`plugin` 子命令转发给 pnpm 管 profile 依赖。
- systemd unit `dsh.service`（user）: `ExecStart=/opt/node-v22.23.2/bin/node /home/u1/.local/bin/dsh web --no-open --trusted-host dsh.pc.randomhash.app pc.randomhash.app 192.168.31.130`，`Environment=DSH_HOME=/home/u1/.dsh`，端口 **3080**，Caddy 代理 `dsh.pc.randomhash.app` → `127.0.0.1:3080`（`/etc/caddy/Caddyfile`，未经明确批准勿改）。`/opt/node-v22.23.2` 官方 Node（bundled amaro）是 PTC 模式 `run_code` type-stripping 必需。

### Profile level（`~/.dsh/profiles/`）— 两层，不是单一树

| 路径 | 性质 |
|---|---|
| `~/.dsh/profiles/node_modules/` | 全 symlink → `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/*`（全局 harness 依赖树） |
| `~/.dsh/profiles/web/node_modules/` | 物理文件（pnpm hoisted 树，有 `.pnpm/`、`.modules.yaml`） |

`~/.dsh/profiles/web/` 本身是一个 pnpm workspace：
- `package.json` 的 `dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket", "dsh-better-sidebar", "corti-memory", "@pgmi-builds/better-dsh"]`
- `cordis.yml` 为空 `[]`（树由 patch 组成），实际 overlay 在 `cordis.patch.yml`。
- **plugin add 的供应链年龄门（2026-09-02 实证）**：pnpm 11.7 自带 supply-chain 策略引擎（`minimumReleaseAge`/trust policy）；`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 按精确版本豁免。**刚发布的 better-dsh 新版本会被年龄门挡回旧豁免版并静默覆盖部署位**（0.2.1-d 曾因此被回落成 0.2.1-a）——升级时用精确版本 add（pnpm 会自动补 exclude 条目并提示 `minimumReleaseAgeStrict`），勿信 `@latest`。另：pnpm 打完 `Done` 后偶发子进程不退出（11.7.0 worker 边车问题，Ctrl-C 无损）；profile package.json 的 `pnpm.onlyBuiltDependencies` 已失效（继任 `allowBuilds` 在 pnpm-workspace.yaml），其 WARN 为噪音可清理。

### 依赖解析 — 分层，不是一棵树

Node 从 better-dsh 的 `lib/index.js` 出发向上走：

```
① ~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/node_modules/   ← 插件嵌套依赖（另一份 @deepseek-ai/*）
② ~/.dsh/profiles/web/node_modules/                                         ← web profile（pnpm 树）
③ ~/.dsh/profiles/node_modules/                                             ← 全 symlink → 全局 dsh 的 node_modules
④ ~/.local/lib/node_modules/                                             ← 全局
```

关键：**插件的 `@deepseek-ai/*` harness 依赖不在插件自己的树里**——声明为 optional peers，运行期全部由 ②③ 层的 host 副本提供（实测 14/14 解析，见文末 ✅ 节）；插件嵌套层 ① 只保留真实 dependency `schemastery`+`cosmokit`。

### User data（`~/.dsh/*`）

`settings.yaml`、`sessions/`、`plugins/`（只有 `dsh-better-edit`）、`profiles/`、`storages/`、`attachments/`、`.env`、`.credentials.yaml`、`corti.json` 等。

---

## 二、Dev/Test 1：源码级 4999 实例（upstream checkout + 内嵌 dashr）— 推荐回归路径

整个 harness 从源码跑，dashr 作为 workspace 成员内嵌其中，与 prod 完全隔离。**2026-09-02 已全链路验证。**

### 组成

- Harness: `./upstream/deepseek-harness`，git tag `dsh-v0.1.2-alpha.3`（与 prod npm 版本对齐），pnpm workspace（`linkWorkspacePackages: true`）。
- dashr 放置: `packages/better-dsh/better-dsh/`（`./dashr` 的副本，workspace 成员）。副本上的本地化改动（一次性，已做）: 58 个 `@deepseek-ai/*` 依赖 → `workspace:*`；删除 stale 的 `@deepseek-ai/dsh-client-runtime` peerDep（better-dsh 不 import 它）。
- 用户数据: `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`。profile `web` 在 `.dsh-test/profiles/web/package.json` 声明 bundles `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@pgmi-builds/better-dsh"]`，其 node_modules symlink 指向 monorepo 的 `packages/bundle/base`、`packages/bundle/web-app`、`packages/better-dsh/better-dsh`。`.env` 从 `~/.dsh/.env` 拷贝（真实 key）。prod `~/.dsh` 完全不动。

### harness 本地 patch（该环境必须，缺一 build 即挂）

1. `packages/client/tsdown.client.ts`: `REPOSITORY_ROOT` 由 `resolveRepositoryRoot()` 推导（`pnpm-workspace.yaml` 锚定，`process.cwd()` 兜底）。原因: 本机 Node 22.22.1 `process.features.typescript=false` → tsdown auto loader 选 unrun，unrun 的 bundle 级 define 把内联 preset 的 `import.meta.url` 改写成各包入口 config 的 URL，`packages/*/*` 深度下 `../..` 落到 `<repo>/packages/`，manifest glob 全空 → `no packages/*/*/package.json declares the name …`。upstream CI 的新 Node 走 native loader，看不到此问题。
2. `pnpm-workspace.yaml`: `storeDir: /home/u1/workspaces/dashr/.scratch/pnpm-store` + `verifyDepsBeforeRun: false`。原因: pnpm 11 不读 `.npmrc`；默认 deps-check 会 spawn `pnpm install`，向只读的用户级 store 注册 project → EROFS。

### 构建（setup 或 harness 变更后）

```bash
cd ~/workspaces/dashr/upstream/deepseek-harness
pnpm install        # store 已重定向到 .scratch/pnpm-store
pnpm run build      # tsc lib/types + tsdown host/client + vite web + client build record（269 projects）
```

### 启动 / 重启

```bash
cd ~/workspaces/dashr/upstream/deepseek-harness
DSH_HOME=/home/u1/workspaces/dashr/.dsh-test npm run dsh -- web --no-open --port 4999
```

- token 每次启动轮换，从 stdout 取 `?token=…` URL；curl 冒烟需 cookie jar: `curl -c jar -L '<token-url>'`（303 重定向靠 cookie 保认证）。
- 数据只落 `.dsh-test/`（storages/sessions），与 prod 隔离。

### 日常回归循环（recurring）

canonical src 在 `./dashr/src` → rsync 进 monorepo → 只重建 better-dsh 的 node 半边 → 重启：

```bash
rsync -a --delete --exclude node_modules --exclude lib --exclude .venv-kernel --exclude docs \
  ~/workspaces/dashr/dashr/ ~/workspaces/dashr/upstream/deepseek-harness/packages/better-dsh/better-dsh/
cd ~/workspaces/dashr/upstream/deepseek-harness
pnpm --filter @pgmi-builds/better-dsh exec tsdown
# 然后重启上面的启动命令
```

- 勿在副本里 `npm run build`（prebuild 拷 `../docs`，副本无该目录会失败）。
- 快速迭代也可直接改副本 src 再 `pnpm --filter @pgmi-builds/better-dsh exec tsdown`，但改动须回填 `./dashr`。
- 验证: `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test npm run dsh -- web --dump-config | grep -A2 dashr-repl`。

### 已验证 / 未验证

- ✅ `dashr-repl` 工具行 + `DASHR_KERNEL_PYTHON` config 注入；web shell + assets HTTP 200；`.dsh-test/storages/workspace.json` 落盘。
- ❓ client 卡片半边（`build-client`）在 monorepo 内未跑；需要 dashr 的 web UI 卡片时再补。

---

## 三、Dev/Test 2：wire the prod core（prod 核 + dev 插件）— 未实操，细节待勘误

prod npm CLI 当 harness 核，只把插件本体和它的 harness 依赖换成 dev 版。

- 核: `~/.local` npm 全局 `@deepseek-ai/dsh` 0.1.2-alpha.3（`bin.js` 启动器）；profile `web` 在 `~/.dsh/profiles/web`（pnpm hoisted 物理 tree）。
- 插件线: `./dashr` `npm run build`（= `tsdown && npm run build-client`）→ md5 核对同步 `lib/` 到 `~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/lib`（v0.2.1c 的部署方式）→ 重启 `dsh.service`。
- harness 依赖线: **已退役**（原 `better-dsh/node_modules/@deepseek-ai/*` symlink 到 dsh-alpha 源码的方案，2026-09-02 已删——实测 host ②③ 层全量自供，嵌套 symlink 无一必需，且 alpha.1 指向对 alpha.3 host 是版本偏斜负债）。
- 解析即第一节 ①→④ 分层；现已验证插件运行期只依赖 ②③（host 自供）+ ① 的 schemastery/cosmokit。
- ~~剩余待验证~~ **已收敛（2026-09-02）**: `./dashr` 构建产物 md5 同步线的 prod 冒烟已跑（v0.2.1c 同步态活体 4 探针 4/4）；profile 锁/lockfile/部署位已统一为 `0.2.1-d`（经 `dsh plugin add @pgmi-builds/better-dsh@0.2.1-d`，见第一节供应链年龄门）。**发布态部署的正道是 pnpm add 精确版本**，手工 md5 同步仅限未发布的本地迭代。

---

## ✅ prod 插件嵌套 symlink 悬空 — 已清理（2026-09-02），重启安全

`dsh-alpha` 改名 `z_dsh-alpha` 后，`~/.dsh/profiles/web/node_modules/@pgmi-builds/better-dsh/node_modules/@deepseek-ai/*` 的 17 条 symlink 曾全部悬空。**实测: daemon 重启不会崩** —— 运行期实际 import 的 14 个 `@deepseek-ai/*` 包全部从 ②③ 层解析（host 自带）；`dsh-client-ui-slots` 不是运行期 import（只在 `scripts/build-client.ts` 的 client external 列表，浏览器侧经 shell module table / `.dsh-module-fallback` 解析）。

**为什么声明 58 个 peerDeps**: 全是 dev-time 需要 —— `tsc --noEmit` 类型检查、`tsdown` dts、以及 vitest 单测（在 dsh host 之外直接 import harness 包；dev workspace 靠 pnpm `autoInstallPeers` 装上）。部署副本里它们是 `peerDependencies` 且 `peerDependenciesMeta` 全部 `optional: true`，pnpm-lock.yaml 对嵌套路径 0 引用 —— pnpm 从不要求它们在场。真正的 `dependencies` 只有 `@deepseek-ai/schemastery`（非 harness API，是插件自用的 Schema 描述符库；描述符是结构化数据、宿主 cordis 当数据解释，故可以自带副本，与 cordis 必须 peer 的身份要求相反）+ cosmokit（schemastery 的传递依赖）。

**已执行**: 删除 17 条悬空 symlink，保留 `schemastery`+`cosmokit`；清理后 14/14 运行期 import 解析复测通过。曾考虑的 A（重指 z_dsh-alpha，alpha.1 与 alpha.3 host 版本偏斜、「两份 cordis」身份风险）与 B（重指 upstream checkout）均已否决。另: ~~profile package.json 锁 `0.2.1-a` 而部署实为 `0.2.1-c`~~ 漂移已于 2026-09-02 收敛——锁/lockfile/部署位统一 `0.2.1-d`（pnpm add 精确版本线）。

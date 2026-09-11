# DASHR (better-dsh) — dsh 拓扑与 Dev/Test 约定

本文件是 agent 指引的一站式契约：prod 拓扑、两条 dev/test 路径、以及当前已知风险。（旧 `agents.md` 的 Prod/Caddy 事实已并入本文件。）

---

## 〇、Development Operation Contract — 发布与验收红线（2026-09-06 裁决）

> 起因：0.2.2-c 违规发包——agent 只做了"4999 拉起来没崩"级别的检查就直发 npm，跳过了第一人称实测与 user 确认两道闸。
> 先例与不可逆性：npm **发了就发了，撤不回、盖不掉**（registry 上的游离 `better-dsh@0.2.3` 即 2026-09-03 匆忙上错发、永留的先例）；GitHub 可逆——tag 可加、可摘、可挪。

1. **npm publish 前置条件，缺一不可，顺序不可换**：
   - a. **4999 第一人称实测通过**：真实 agent session 在实际运行时里走通改动路径（HTTP 端点发起 session 自测 / browser-use / 视觉模型操作，任一形态）。拉起进程没崩、单测绿、tsc 0、boot graph 在位、产物 grep 命中——这些是构建卫生，**不是验收**；带病工具的 prod 照样能拉起来。
   - b. 实测结果落报告 `docs/50_test-reports/`。
   - c. **user 明确确认放行**（第一人称实测通过 ≠ user 确认，两道独立闸门；agent 不得以"测试都绿了"推断放行）。
   - d. 以上全齐后才 `npm publish`。
2. **验收标准必须与改动点同类**：改的是"实际运行时上下文里工具/行为可不可用"，验收就必须是"实际运行时里该工具/行为可用"，由第一人称实测证明，不得降级为进程活性或静态证据。
3. **未经 user 单次明确同意，不得 `npm publish`**。授权粒度单次有效：user 对某次发布的授权、或对"修这个 bug"的授权，都不自动覆盖下次发包。
4. GitHub 侧（commit / tag / push）可逆，风险低，但同样跟随上述节奏走，不抢在 a–c 之前定版。
5. **已发布版本的微小瑕疵：记录在案、攒批处理**，不为零碎微调烧版本号（0.2.2-c 后的措辞微调、附 C 类新 bug 一律并入下一次批量发布，见 `docs/50_test-reports/2026-09-06-write工具sandbox升级透传bug复发及挂起-事件报告.md` 附 A/B/C）。

---

## 一、Production Native dsh 拓扑

### Core（`~/.local`）— 用户级全局安装

```
/home/u1/.local/bin/dsh
   └─ symlink → /home/u1/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
```

- `@deepseek-ai/dsh` = **0.1.3-alpha.2**（npm dist-tag `alpha`，2026-09-08 user 裁决 prod 对齐 npm 最高版，与 4999 测试线同版；旧值 0.1.2-alpha.3），约 313MB，自带 vendored `node_modules`。`npm install -g --prefix ~/.local` 的用户级全局安装。
- `dsh` 不是 ELF，是 `#!/usr/bin/env node` 的 JS 入口。**它只当启动器**：`bin.js` 解析 boot 哪个 profile、哪些 patch overlay，其余参数透传；`web` 是 `--profile web` 的硬别名；`plugin` 子命令转发给 pnpm 管 profile 依赖。
- systemd unit `dsh.service`（user）: `ExecStart=/opt/node-v22.23.2/bin/node /home/u1/.local/bin/dsh web --no-open --trusted-host dsh.pc.randomhash.app pc.randomhash.app 192.168.31.130`，`Environment=DSH_HOME=/home/u1/.dsh`，端口 **3080**，Caddy 代理 `dsh.pc.randomhash.app` → `127.0.0.1:3080`（`/etc/caddy/Caddyfile`，未经明确批准勿改）。`/opt/node-v22.23.2` 官方 Node（bundled amaro）是 PTC 模式 `run_code` type-stripping 必需。

### Profile level（`~/.dsh/profiles/`）— 两层，不是单一树

| 路径 | 性质 |
|---|---|
| `~/.dsh/profiles/node_modules/` | 全 symlink → `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/*`（全局 harness 依赖树） |
| `~/.dsh/profiles/web/node_modules/` | 物理文件（pnpm hoisted 树，有 `.pnpm/`、`.modules.yaml`） |

`~/.dsh/profiles/web/` 本身是一个 pnpm workspace：
- `package.json` 的 `dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket", "corti-memory", "better-dsh"]`（2026-09-11 user 裁决移除 dsh-better-sidebar，prod 3080 已重启验证；测试 profile 同步移除。遗留已清：2026-09-11 mobile wave 已把右滑重指向原生 ui-sidebar-right 官方控件（见 §二 mobile wave 条目））
- `cordis.yml` 为空 `[]`（树由 patch 组成），实际 overlay 在 `cordis.patch.yml`。
- **plugin add 的供应链年龄门（2026-09-02 实证；2026-09-03 修正 exclude 形式）**：pnpm 11.7.0 自带 supply-chain 策略引擎（默认 `minimumReleaseAge`≈24h）。**版本号形式的 exclude（`pkg@x.y.z`，含 pnpm 自动补的）只作用于解析相位，不盖锁文件校验相位**——条目发布未满 24h 时，后续任何 `pnpm install`/`add` 的锁文件校验都会再拦一次（0.2.2 发布当天装 prod 即中此坑）。**持久形式 = 裸包名**：`minimumReleaseAgeExclude: ['better-dsh']` 全相位生效（scratch A5–A7 实证：校验/全新 add/复验全过）。升级仍用精确版本 add，勿信 `@latest`（回落+静默覆盖部署位的坑仍在）。**v0.2.2a 起包为零 lifecycle script**（owner 裁决 2026-09-03：postinstall 移除，kernel 供给 = spin-up 主路径 + 首用 lazy 两级；`npm run kernel:venv` 手动入口保留）——0.2.2-a 及以后**无 allowBuilds 要求**（该条仅对 0.2.2 这一个带 postinstall 的版本有意义）。~~带 postinstall 的版本还需 `allowBuilds: {'@pgmi-builds/better-dsh': true}`**（strictDepBuilds 下未列 build script = 硬错；0.2.2 起 kernel-provision postinstall 属发布面）。另：pnpm 打完 `Done` 后偶发子进程不退出（11.7.0 worker 边车，Ctrl-C 无损）；`pnpm.onlyBuiltDependencies` 已失效（继任 `allowBuilds` 在 pnpm-workspace.yaml），其 WARN 为噪音。prod profile 的两处修正于 2026-09-03 落位（备份 `.scratch/pnpm-workspace.yaml.bak-0.2.2`）。

### 依赖解析 — 分层，不是一棵树

Node 从 better-dsh 的 `lib/index.js` 出发向上走：

```
① ~/.dsh/profiles/web/node_modules/better-dsh/node_modules/   ← 插件嵌套依赖（另一份 @deepseek-ai/*）
② ~/.dsh/profiles/web/node_modules/                                         ← web profile（pnpm 树）
③ ~/.dsh/profiles/node_modules/                                             ← 全 symlink → 全局 dsh 的 node_modules
④ ~/.local/lib/node_modules/                                             ← 全局
```

关键：**插件的 `@deepseek-ai/*` harness 依赖不在插件自己的树里**——声明为 optional peers，运行期全部由 ②③ 层的 host 副本提供（实测 14/14 解析，见文末 ✅ 节）；插件嵌套层 ① 只保留真实 dependency `schemastery`+`cosmokit`。

### User data（`~/.dsh/*`）

`settings.yaml`、`sessions/`、`plugins/`（只有 `dsh-better-edit`）、`profiles/`、`storages/`、`attachments/`、`.env`、`.credentials.yaml`、`corti.json` 等。

### 部署规范 — user, just another user（2026-09-02 裁决）

- **生产部署原则：user, just another user。** 本机 prod（3080）是 user 真实在用的部署，按普通 user 的方式从 registry 安装：主体 npm 安装，插件 npm 安装或经 dsh plugin market 安装——plugin market 底层拿的也是 npm，同源。**不做源码级/手工同步侵入 prod**（手工 md5 同步仅限未发布本地迭代，见第三节；发布态部署的正道是 pnpm add 精确版本，见第一节年龄门）。
- **本地部署基本全用 npm（registry 同源生态）**；dev/test 的源码级路径是第二、三节的独立轨道，两者据此分离。升级 prod 前先在 Dev/Test 1 预演（同版本 checkout → 验证 → 报告），本轮 alpha.5 即该模式的首演。

---

## 二、Dev/Test 1：源码级 4999 实例（upstream checkout + 内嵌 dashr）— 推荐回归路径

整个 harness 从源码跑，dashr 作为 workspace 成员内嵌其中，与 prod 完全隔离。**2026-09-02 已全链路验证。**

### 组成

- Harness: `./upstream/deepseek-harness`，git tag `dsh-v0.1.5-rc.2`（2026-09-11 对齐轮从 0.1.3-alpha.2 切换并全链路验证，见 `docs/50_test-reports/upstream-dsh-0.1.5-rc.2-local-test-report.md`；prod npm 仍 0.1.3-alpha.2，**测试线领先 prod 一档**——升 prod 需另行裁决），pnpm workspace（`linkWorkspacePackages: true`）。**tag 间 `pnpm-workspace.yaml` 有实质改动**（0.1.5 起：native/landlock-run→native/system、allowBuilds 去 fs-ext 加 electron-winstaller/msgpackr-extract）——本地 patch（unrun devDep / storeDir+verifyDeps+zeromq / tsdown `resolveRepositoryRoot`）按对齐轮 S2 手工重放，勿盲 stash pop（allowBuilds 区必冲突，按 0.1.5-rc.2 报告 §二的手解顺序）。
- dashr 放置: `packages/better-dsh/better-dsh/`（`./dashr` 的副本，workspace 成员）。**rsync 后必打 devDeps 手术（2026-09-11 实证）**：副本 package.json 的 devDependencies 注入 14 个 `@deepseek-ai/dsh-*` = `workspace:*`（dashr src/test 实际 import 的名单：dsh-agent/fs/host-webserver/llm/llm-retry/sandbox/scope/session/session-persistence/settings/skill/subagent/system-prompt/tools）。原因：canonical 的 npm-range optional peers（`>=0.1.2-alpha.1 <0.2.0-0`）在 pnpm 11 严格预发布 semver 下不匹配 workspace `0.1.5-rc.2`（元组规则），autoInstallPeers 落 registry `0.1.2-rc.1` → 副本 node_modules 双身份 → tsc 品牌类型互斥报错。canonical 保持 npm range 不动（发布语义）；手术只在副本。stale `dsh-client-runtime` peerDep 已于 0.2.2-a 在源头删除，rsync 不带回。另: `pnpm-workspace.yaml` allowBuilds 需 `zeromq: true`（better-dsh kernel IPC 依赖）。
- 用户数据: `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`。profile `web` 在 `.dsh-test/profiles/web/package.json` 声明 bundles `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "better-dsh"]`，其 node_modules symlink 指向 monorepo 的 `packages/bundle/base`、`packages/bundle/web-app`、`packages/better-dsh/better-dsh`。`.env` 从 `~/.dsh/.env` 拷贝（真实 key）。prod `~/.dsh` 完全不动。

### harness 本地 patch（该环境必须，缺一 build 即挂）

1. `packages/client/tsdown.client.ts`: `REPOSITORY_ROOT` 由 `resolveRepositoryRoot()` 推导（`pnpm-workspace.yaml` 锚定，`process.cwd()` 兜底）。原因: 本机 Node 22.22.1 `process.features.typescript=false` → tsdown auto loader 选 unrun，unrun 的 bundle 级 define 把内联 preset 的 `import.meta.url` 改写成各包入口 config 的 URL，`packages/*/*` 深度下 `../..` 落到 `<repo>/packages/`，manifest glob 全空 → `no packages/*/*/package.json declares the name …`。upstream CI 的新 Node 走 native loader，看不到此问题。
2. `pnpm-workspace.yaml`: `storeDir: /home/u1/workspaces/dashr/.scratch/pnpm-store` + `verifyDepsBeforeRun: false` + allowBuilds `zeromq: true`（better-dsh 自 0.2.2-a 起零 lifecycle script，无自身 allowBuilds 条目）。原因: pnpm 11 不读 `.npmrc`；默认 deps-check 会 spawn `pnpm install`，向只读的用户级 store 注册 project → EROFS；strictDepBuilds 下未列 build script = install 硬错。

### 构建（setup 或 harness 变更后）

```bash
cd ~/workspaces/dashr/upstream/deepseek-harness
pnpm install        # store 已重定向到 .scratch/pnpm-store
pnpm run build      # tsc lib/types + tsdown host/client + vite web + client build record（0.1.5-rc.2: 234 client artifacts，含 build:native-system）
```

### 启动 / 重启

```bash
# ⚠ 2026-09-11 起：测试实例一律用 `bash test/start-4999.sh`（PORT=xxxx 可覆盖）。
#   默认 = 无中继（superd start-4999.sh 模板：纯 systemd-run，loopback）；仅当 user
#   要求外网/LAN 直达 **且没有 Caddy 可用** 时加 `LAN=1`（用户态 socat 中继）。
#   机制事实：webserver 配置只收 127.0.0.1|0.0.0.0 两个字面量（zod union）且 startup
#   硬拒 0.0.0.0（RCE 安全门）→ 直接绑 LAN IP 不可能；LAN=1 的中继只绑 LAN IP 转发
#   loopback（⚠ 万不可绑 0.0.0.0——与 loopback 同端口 EADDRINUSE）。2026-09-06 port
#   3098 首创，2026-09-11 固化进脚本。脚本自带：端口占用拒绝（外来进程）、停旧+等
#   端口真释放（node drain 竞态）、本 boot token 轮询提取（append 日志防串台）。
# ⚠ 端口现状（2026-09-11 实证）：4997/4998/4999 被 superd multi-context PoC 占用
#   （~/workspaces/superd/.scratch/multi-context-poc/poc4-v3-e2e.mjs，独立 DSH_HOME，user 在跑实验勿杀）。
#   对齐轮实例换可用端口（0.1.5-rc.2 轮用了 4988/unit dsh-4988-test）；若 Caddy test.pc 后端指 4999，
#   域名叫到的是 superd 实例——域名验收前先对齐端口。下例保留 4999 形参，按实际替换：
# 首选（agent 从沙箱会话重启时必须用这条；user 从自己终端（非沙箱）也可直接跑下面的 npm 形式）:
systemctl --user stop dsh-4999-test 2>/dev/null
systemd-run --user --unit=dsh-4999-test \
  -p WorkingDirectory=/home/u1/workspaces/dashr/upstream/deepseek-harness \
  -p Environment=DSH_HOME=/home/u1/workspaces/dashr/.dsh-test \
  -p 'Environment="DSH_TRUSTED_HOSTS=test.pc.randomhash.app pc.randomhash.app 192.168.31.130"' \
  -p 'UnsetEnvironment=DISPLAY WAYLAND_DISPLAY' \
  -p StandardOutput=append:/home/u1/workspaces/dashr/.scratch/dsh-4999.log \
  -p StandardError=append:/home/u1/workspaces/dashr/.scratch/dsh-4999.log \
  "$(which node)" --import tsx/esm apps/cli/src/bin.ts web --no-open --port 4999
# ⚠ 与 prod 对齐的两行必须带：DSH_TRUSTED_HOSTS（fence + web-trust authorities 单源，
#   覆盖 test.pc… / pc.randomhash.app / LAN）与 UnsetEnvironment=DISPLAY WAYLAND_DISPLAY
#   （prod dsh.service 同款——否则 directory-picker auto 在图形 env 下选 native，zenity
#   弹在宿主桌面，经 Caddy 远端访问时 Add workspace 表现为无响应后置灰；2026-09-08 实证）
# user 终端（非沙箱）等价简式:
# cd ~/workspaces/dashr/upstream/deepseek-harness && DSH_HOME=~/.dsh-test 的 npm run dsh -- web --no-open --port 4999
```

> **勿从 agent 沙箱化 bash 直接拉 daemon（2026-09-03 实证）**：沙箱内启动的 daemon 继承嵌套沙箱环境，其 bwrap 功能探测（`sandbox-local defaultProbeBwrap`）报 `No permissions to create a new namespace` → `SANDBOX_UNAVAILABLE`（agent bash 无沙箱后端）。systemd-run --user 在沙箱外启动（对齐 prod 形态）；沙箱内连 user bus 会被拒，需单命令 `danger-full-access` 升级。stop/日志：`systemctl --user ... dsh-4999-test` / `.scratch/dsh-4999.log`。

- token 每次启动轮换，从 `.scratch/dsh-4999.log`（或 stdout）取 `?token=…` URL；curl 冒烟需 cookie jar: `curl -c jar -L '<token-url>'`（303 重定向靠 cookie 保认证）。
- 数据只落 `.dsh-test/`（storages/sessions），与 prod 隔离。

### 日常回归循环（recurring）

canonical src 在 `./dashr/src` → rsync 进 monorepo → 只重建 better-dsh 的 node 半边 → 重启：

```bash
rsync -a --delete --exclude node_modules --exclude lib --exclude .venv-kernel --exclude .uv-cache --exclude docs \
  ~/workspaces/dashr/dashr/ ~/workspaces/dashr/upstream/deepseek-harness/packages/better-dsh/better-dsh/
cd ~/workspaces/dashr/upstream/deepseek-harness
pnpm --filter better-dsh exec tsdown
# ⚠ tsdown 默认 clean lib/ —— 会连带抹掉 lib/client/！client 半必须重跑（直跑 tsx，勿 npm/npx，ENOTDIR 陷阱）：
cd packages/better-dsh/better-dsh && ../../../node_modules/.bin/tsx scripts/build-client.ts && cd ../../..
# ⚠ 0.1.5-rc.2 起路径为三级 ../..（packages/node_modules 不再生成，../.. 直跑必 127）
# 然后重启上面的启动命令
```

- **⚠ lib/client 清洗陷阱（2026-09-03 实证，曾致 v0.2.1f mobile 特性在 4999 整体消失）**：tsdown 默认清空 outDir（lib/），`lib/client/` 一并被抹；只跑 rsync→tsdown→重启 的循环 = 服务一个没有 client 半的插件（无 mobile CSS/手势/卡片）。**每次 tsdown 后必须 `tsx scripts/build-client.ts`**（monorepo 根的 tsx 直跑）。验证含 client 探针：narrow 下 `[data-sidebar-collapsed]` computed 首列 0px、`style[data-plugin]` 认领在位。

- 勿在副本里 `npm run build`（prebuild 拷 `../docs`，副本无该目录会失败）。
- 快速迭代也可直接改副本 src 再 `pnpm --filter better-dsh exec tsdown`，但改动须回填 `./dashr`。
- 验证: `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test npm run dsh -- web --dump-config | grep -A2 dashr-repl`。

### 已验证 / 未验证

- ✅ `dashr-repl` 工具行 + `DASHR_KERNEL_PYTHON` config 注入；web shell + assets HTTP 200；`.dsh-test/storages/workspace.json` 落盘。
- ✅ **kernel 三级供给**（2026-09-03，change `kernel-provisioning-completeness`）：postinstall/spin-up/首用 lazy 全 fail-open；冷启动 spin-up 自动重建 venv（pinned ipykernel 7.3.0 / dill 0.4.1 / CPython 3.11，无 uv 时 python3-venv 兜底 3.14.4 实测兼容）；uv cache 重定向包内 `.uv-cache`，只读 HOME 实测无碍；一页文档 `docs/kernel-provisioning.md`。
- ✅ **client 卡片半边已通**（2026-09-03，change `model-failover-settings-surface`；2026-09-03 npm 改名后 id 为 `better-dsh`）：副本内构建用 **`tsx scripts/build-client.ts` 直跑**（33ms；⚠ `npm run build-client` 在 monorepo 副本必死——npm 自身 pre-script 的 workspace 枚举读 pnpm-workspace `vendor/*` glob 匹配到普通文件 CLAUDE.md → ENOTDIR/exit 236，与脚本无关）；验证法：鉴权拉 shell 页 → boot graph 应含 `"id":"better-dsh"` 与 `/plugins/??better-dsh/client.js&rev=…` URL → curl 该 URL 200 且与 `lib/client/index.js` 字节一致（服务端仅追加 sourceMappingURL 行）。原生注册路径已核实：settings 行 = client bundle 内 `ctx.slots.inject('settings.general.item', …)`（与 locale/ui-chat 原生行同构）。
- ✅ **web-trust 双腿 + mobile-layout 随插件发布**（2026-09-03，change `plugin-shipped-ui-patches`，v0.2.1-f；**round-4 手势整体重写为 z_dsh-alpha `1706b81` 逐条照搬**，commit `0676811`）：**fence 腿** = bundle patch 整行重述 `connection` 行（`trustedHosts: !!js (process.env.DSH_TRUSTED_HOSTS ?? '').split(/\s+/).filter(Boolean).concat(ctx.webRuntime.trustedHosts)`；⚠ `!!js` 是 scalar tag，表达式**不能以 `[` 开头**否则 yaml 按 flow-seq 拒收）；**isLoopback 腿** = host 半 `webserver/index-inject` 内联 boot script（trusted hostname → `window.__DSH_TRANSPORT__={ownsHost:true}`；mobile 阈值 → `__DASHR_MOBILE__`——client 半无 config，页面全局即配置通道）；**mobile 手势 = 旧 ui-layout 补丁 exact port**：X120 左缘带 / 右 3/4 起点区（viewport/4）/ 距离 40px / 水平占优 ×1.3 / 断点 <768 / **pointermove 中途一次性触发**（pointerup 判定被浏览器滚动手势 pointercancel 吃掉 = "必须快划"的根因）/ document 捕获监听 / 右面板 = Better Sidebar 浮层，经 `[data-dsh-toggle-cluster]` 末按钮 DOM click、状态读 `body[data-dsh-sidebar-collapsed]`、会话门槛读 `[data-slot="conversation.session.header"]`；**唯一增量** = 速率门 `swipeVelocityPxPerMs` 默认 0.15（0=关闭）。round-2 发明的 48/28 值已废弃。425/425 + tsc 0；4999 经用户真实 URL `https://test.pc.randomhash.app` CDP 实证（开/关左栏 + 开/关右栏 + Models provider 列表全过；该域名已入 trustedPageAuthorities）。报告 `docs/50_test-reports/v0.2.1f-plugin-shipped-ui-patches实测报告.md`。

- ✅ **iOS focus 放大抑制 zoomGuard**（2026-09-03，change `ios-focus-zoom-suppression`，v0.2.4，commit `59870fc`；纯 host 半，client 零改动）：boot script 增 zoomGuard 段 —— iOS 系 UA（iPhone|iPod|iPad + iPadOS 桌面冒充 Macintosh&&maxTouchPoints>1）∧ 窄视口（`matchMedia('(max-width:'+(breakpoint-0.02)+'px)')`，断点复用 mobile.breakpoint）双门控下 token 级合并 viewport meta `maximum-scale=1, user-scalable=no`（幂等、可还原、resize + MQ change 双通道复评 + **早期载入重评梯子** ~10ms×200tick —— 引擎载入期应用 viewport 不派发 resize 的实测缺口，deferred focus 可先于事件补评）；**mobile 配置面新增 `zoomGuard`**：`'meta'`（默认，**v0.2.5 起自动双形态**：browser=meta 改写 / standalone=字号地板）| `'off'`（逃生门，'off' = 整段不发射），`'font'` 值位预留不进 enum（未实现值 fail-loud）。五个纯函数（`src/mobile/zoom-guard.ts`，ES5 自包含）经 `Function.prototype.toString` 嵌入 boot script = 单测源即发布源。**关键机制发现**：head 注入 splice 在 `<head>` 开标签紧后 = stock viewport meta 后于脚本解析 → provisional meta + MutationObserver reconcile（stock 插入时改写其本体并移除 provisional，单 meta 文档，S7 查表第 8 条盯两查点）。**v0.2.5 display-mode 分流**（2026-09-03，change `zoomguard-standalone-font-floor`，tag `v0.2.5`；真机实证：standalone PWA 态引擎尊重 `user-scalable=no` → pinch 失效）：iOS 门后、meta 机器前一次性判定 standalone（`(display-mode: standalone)` MQ ∨ `navigator.standalone===true`，严格 `=== true` 双源 OR）→ 注入 `<style id="ios-zoom-font-floor" data-plugin="better-dsh" data-plugin-css="better-dsh/zoom-font-floor">`（16px 字号地板，`@media (max-width:{bp-0.02}px)` 与 meta 腿同派生 768→767.98；**注入不设宽度门**，宽度由 CSS media query 表达）后 return —— 零 meta 机器/零监听/零 timer/零窄带 MQ 探针，meta 字节不动；browser 态 v0.2.4 机器原样，'off' 两形态都不发射（web-trust 门不变零改动）。478/478 + tsc 0。466/466 + tsc 0（v0.2.4）；**4999 已验**（CDP 矩阵 9/9 + off 逃生门 live + 桌面 user 复验，报告 §八；v0.2.5 双形态 CDP 待 lead，报告 §九）；真机 PWA 复验待 user（报告 `docs/50_test-reports/v0.2.4-ios-focus-zoom-suppression实测报告.md`，键盘遮蔽自愈判定驱动 follow-up 取舍）。CLI 注：`web` 子命令不认 `--patch`，config 覆盖走 home 层 `cordis.patch.yml`。**发布定格（2026-09-03 user 裁决）**：本地过程版本 0.2.4/0.2.5 的 tag（v0.2.3~v0.2.5）已清，npm/GitHub 发布为 **`0.2.2-b` / tag `v0.2.2b`**（0.2.2 系列顺延；真机全过后 user 以普通用户身份从 npm 装 prod 实测）。

- ✅ **hashline content-locator**（2026-09-08，change `2026-09-08-v0-2-3b-hashline-content-locator`，v0.2.3-b）：served 账本去 session 化（schema v7，**path 主键**，`E_RANGE_UNVERIFIED` 跨会话类消灭）、集中存储 **`$DSH_HOME/storages/dsh-better-edit/`**（`configDir()` 无参化，终结 12 个 workspace 点目录——"到处拉屎"裁决落地）、verifyServedRange 内容快道（账本双界未见→内容放行；STALE/UNSERVED 保留；retryHint 改 read-once-then-resubmit）、write-hook 删除（write 仅上游确认信封，无锚点回放）。单测 `test/hashline-store.spec.ts` 12/12；全量 491/2（2 挂经 stash 基线证实先于本改动）；4999 第一人称实测通过（write 无回放 / 中心库无 session_id 列 / 无点目录 / read-then-edit 落盘）。实测定性：宿主 `dsh-fs-observation-policy` 的 `E_NOT_OBSERVED`（read-before-edit）为跨会话 edit 的**另一道设计内守卫，保留**。报告 `docs/50_test-reports/v0.2.3b-hashline-content-locator实测报告.md`。**新坑**：副本构建必须 `pnpm --filter better-dsh exec tsdown`——裸跑 `node_modules/.bin/tsdown` 产出 `.mjs` 形态，boot 即 `ERR_MODULE_NOT_FOUND lib/index.js`。已发布 **v0.2.3-b**（npm registry 2026-09-08 18:15 UTC+8，dist-tag `latest`）并部署 prod（18:19 装机、18:44 重启上线，中央 v7 库活体——本 3080 实例即运行其上）。

- ✅ **mobile wave：官方寻址 + 状态驱动响应式**（2026-09-11，对齐 0.1.5-rc.2；**已发布 `0.2.3-c` / tag `v0.2.3c`**，npm dist-tag latest，含随批的 0.1.5 对齐移植；prod 3080 未部署——user 未指令，待 user 以普通用户身份自装实测）：①**手势状态输入只认官方面**（红线，起因：旧实现把 readRightOpen 挂在第三方 Better Sidebar 的 body 属性上，插件移除后恒 true 毒死整个状态机——左滑右滑全灭）；左栏 = `ctx.layout.toggleSidebar()` + AppFrame `[data-sidebar-collapsed]`，右栏 = 官方控件 `[data-sidebar-right-expand]`（会话头角落，开）/`[data-sidebar-right-toggle]`（dock chrome，关；store 动作 setExpanded/toggleExpanded 为 slot-store 内部，跨插件硬边界 → 原生按钮即正规入口）+ 状态读双 facet：`[data-rightbar-fullscreen]` 在场即开（手机全屏右栏不占轨道、`data-rightbar-collapsed` 同场在场——单 facet 读法致右滑误开左栏，user 真机诊断后修复）。②**响应式零自设像素阈值**：CSS 键纯 `[data-sidebar-collapsed]`（无 @media）——上游 auto-collapse（今日 1024）为真收 56px rail 时我们压成 0px，上游改阈值自动跟随；手势 band = 粗指针（`pointer: coarse`）∨ 任一面板处于窄态，细指针全静息（桌面文本拖选永不误触）。③**`mobile.breakpoint` 配置删除**（schema+boot payload+client），zoomGuard 自带内部 768 兜底不受影响；所谓"mobile 配置卡"从未存在过（client 半唯一设置行是 failover）——MOBILE_CONFIG 一直是纯配置文件面。425→492 tests + tsc 0（monorepo 0.1.5-rc.2 手术环境）；4988 已部署活体 + user iPhone 真机确认（"没有问题，是成功的"）；0.1.3-alpha.2 prod host 兼容矩阵源码核验通过（stat/open、sendMessage、ptc-dispatch-log 均在；`tool/ptc-dispatch` 事件 vocabulary-growth 容忍 = 降级不破坏，host 升 0.1.5 自愈），报告 `docs/50_test-reports/v0.2.3c-mobile-wave实测报告.md`。


- ✅ **REPL 指引单源化：control prompt 并入 eval description**（2026-09-11，change `2026-09-11-control-prompt-into-eval-description`，**已发布 `0.2.3-d` / tag `v0.2.3d`**）：`dashr:control-prompt` + `dashr:tool-catalog` 两 system-prompt section 整体删除，全部 REPL 指引改由 **`eval` 的 wire description** 承载（内容 = 包根 `dashr/eval-description.md`，`package.json files` 同步——坑：漏列即模块期 readFileSync ENOENT、插件加载即死，实测已修）；`src/py-sdk.ts` 渲染器整体拆除只留 `isFlatBindableName`；桥接口径 = 统一调用形一句话（`await tool.<name>(args)` 单位置参数对象，`true/false/null`→`True/False/None`），**对返回值形态零陈述**（user 裁决：明写"不保证/试错"抑制使用）；示例键 `path`（D1 修正——注意 vendored `normalizeRequest` 的 `file_path→path` 别名仍在，旧键侥幸可用，见报告 §5.1）。提示面 A/B：两 section **−8,759 chars**（本 change 净 −52.6%，残余 +1,944 为 v0.2.3-b hashline 指引）。实测报告 `docs/50_test-reports/2026-09-11-control-prompt-into-eval-description实测报告.md`；遗留：非 flat 名无真实 MCP 端到端样本（本 runtime 无 MCP 工具）、prod 3080 未部署（待 user 以普通 user 自装实测）。

---

## 三、Dev/Test 2：wire the prod core（prod 核 + dev 插件）— 未实操，细节待勘误

prod npm CLI 当 harness 核，只把插件本体和它的 harness 依赖换成 dev 版。

- 核: `~/.local` npm 全局 `@deepseek-ai/dsh` 0.1.3-alpha.2（`bin.js` 启动器；2026-09-08 对齐）；profile `web` 在 `~/.dsh/profiles/web`（pnpm hoisted 物理 tree）。
- 插件线: `./dashr` `npm run build`（= `tsdown && npm run build-client`）→ md5 核对同步 `lib/` 到 `~/.dsh/profiles/web/node_modules/better-dsh/lib`（v0.2.1c 的部署方式）→ 重启 `dsh.service`。
- harness 依赖线: **已退役**（原 `better-dsh/node_modules/@deepseek-ai/*` symlink 到 dsh-alpha 源码的方案，2026-09-02 已删——实测 host ②③ 层全量自供，嵌套 symlink 无一必需，且 alpha.1 指向对 alpha.3 host 是版本偏斜负债）。
- 解析即第一节 ①→④ 分层；现已验证插件运行期只依赖 ②③（host 自供）+ ① 的 schemastery/cosmokit。
- ~~剩余待验证~~ **已收敛（2026-09-02）**: `./dashr` 构建产物 md5 同步线的 prod 冒烟已跑（v0.2.1c 同步态活体 4 探针 4/4）；profile 锁/lockfile/部署位已统一为 `0.2.1-d`（经 `dsh plugin add @pgmi-builds/better-dsh@0.2.1-d`，见第一节供应链年龄门）。**发布态部署的正道是 pnpm add 精确版本**，手工 md5 同步仅限未发布的本地迭代。

---

## 四、dsh 插件开发面（机制速查）— 2026-09-03 研究裁决

机制层知识已从 ws skill 蒸馏入文档（2026-09-06，skill 已删）：**`docs/60_exploration-and-research/05-dashr-dev/plugin-development.md`**（决策树 + host core / client web-ui 两分量，源码锚点齐；论证底稿 = `docs/60_exploration-and-research/01-cordis-runtime/cordis-customization-and-override-mechanics.md`）。要点裁决（细节以该文档为准）：

- **官方声明式 patch 线 = `cordis.patch.yml`**：行 schema `{id, name, config, inject, disabled}`；层序 bundles（列序）→ profile → home → `--patch`；后层按 id **整行重述**覆盖前层（非 merge）；`!!js` boot 表达式可读 `process.env` 与 loader 上下文服务。presets/features/settings 全是插件行 config → 全部 patch-线可达。dashr 自己的 bundle patch 已在用（compaction 三行 re-enable、`DASHR_KERNEL_PYTHON`）。
- **override 的三条硬边界**（勿再凭直觉）：① 浏览器模块表同 id = 双侧硬错（无 last-wins，同名包遮蔽不可行）；② cordis 同 scope 同名 service = 硬错，"closest wins" 仅祖先/isolate 遮蔽（兄弟插件间不存在）；③ 官方 UI 组件遮蔽 = **slot 同 cell 更低 priority 注册（lowest renders）**，同 priority 才报错。整插件替换的正规入口 = patch 行 id 覆盖 + `name` 重指（记录未用）。
- **`/api` 信任栅栏（alpha.5 起）**：服务端化 + 配置化——`connection` 行 config `trustedHosts`（`--trusted-host` CLI → web-app bundle `webRuntime` 服务 → `!!js ctx.webRuntime.trustedHosts`）；上游注释明示拼接扩展式。alpha.3 的 prod 手改 patch（vendored `isLoopbackHostname` 放宽）在 alpha.5+ 由 patch 线取代（v0.2.1f change `plugin-shipped-ui-patches` 落地中，含 4999 症状复诊与 `isLoopback` 残余评估）。
- **手势/状态类 client 代码只认官方面（2026-09-11 红线）**：任何"读状态/触发动作"的 DOM 寻址只许指向上游官方表面（layout 服务方法、AppFrame 语义属性、官方控件 data-\*）；第三方插件 DOM **永不做状态输入**（Better Sidebar body 属性毒死手势状态机的先例），第三方至多做可选的增量目标、缺席时静默降级。
- **client 半 CSS 注入是一等公民**（`claimStyles` 按插件认领 `<style>`）；上游 `ui-layout`：窄视口侧栏折叠为 56px rail 永不为 0、`SIDEBAR_AUTO_COLLAPSE=1024`、视口 <920 details 必关、**无原生滑动手势**（插件手势 = 纯增量）。

---


## ✅ prod 插件嵌套 symlink 悬空 — 已清理（2026-09-02），重启安全

`dsh-alpha` 改名 `z_dsh-alpha` 后，`~/.dsh/profiles/web/node_modules/better-dsh/node_modules/@deepseek-ai/*` 的 17 条 symlink 曾全部悬空。**实测: daemon 重启不会崩** —— 运行期实际 import 的 14 个 `@deepseek-ai/*` 包全部从 ②③ 层解析（host 自带）；`dsh-client-ui-slots` 不是运行期 import（只在 `scripts/build-client.ts` 的 client external 列表，浏览器侧经 shell module table / `.dsh-module-fallback` 解析）。

**为什么声明 58 个 peerDeps**: 全是 dev-time 需要 —— `tsc --noEmit` 类型检查、`tsdown` dts、以及 vitest 单测（在 dsh host 之外直接 import harness 包；dev workspace 靠 pnpm `autoInstallPeers` 装上）。部署副本里它们是 `peerDependencies` 且 `peerDependenciesMeta` 全部 `optional: true`，pnpm-lock.yaml 对嵌套路径 0 引用 —— pnpm 从不要求它们在场。真正的 `dependencies` 只有 `@deepseek-ai/schemastery`（非 harness API，是插件自用的 Schema 描述符库；描述符是结构化数据、宿主 cordis 当数据解释，故可以自带副本，与 cordis 必须 peer 的身份要求相反）+ cosmokit（schemastery 的传递依赖）。

**已执行**: 删除 17 条悬空 symlink，保留 `schemastery`+`cosmokit`；清理后 14/14 运行期 import 解析复测通过。曾考虑的 A（重指 z_dsh-alpha，alpha.1 与 alpha.3 host 版本偏斜、「两份 cordis」身份风险）与 B（重指 upstream checkout）均已否决。另: ~~profile package.json 锁 `0.2.1-a` 而部署实为 `0.2.1-c`~~ 漂移已于 2026-09-02 收敛——锁/lockfile/部署位统一 `0.2.1-d`（pnpm add 精确版本线）。

---

## 五、嵌套 AGENTS.md 约定

- **本文件身份**：DASHR（better-dsh）的根 AGENTS.md（总纲，无更上层）。
- **嵌套（Nesting）**：支持层层嵌套，但每一层并非都必须有——只在有实质内容的子目录放置；中间层级无 AGENTS.md 则跳过，沿用最近上层。
- **作用范围（Scope）**：每个 AGENTS.md 只管辖其所在目录及所有子目录，不约束兄弟目录、不反向影响上层。
- **优先级（Precedence）**：对某文件，生效规则 = 从根到该文件路径上所有 AGENTS.md 的叠加；冲突时离文件最近者胜出（nearest wins）；用户显式指令优先级高于一切 AGENTS.md。
- **子目录模板**：子目录/孙目录若需自己的 AGENTS.md，复制下方模板、填入 `<相对路径>` 即可（"去根目录拿一个"；中间层级无 AGENTS.md 时上层直指根）：

  ```markdown
  # <相对路径> — AGENTS.md

  本文件是 `<相对路径>` 子目录的 AGENTS.md。上层为 DASHR 根目录 `AGENTS.md`；其规则对本目录仍有效，冲突时以本文件为准。
  ```

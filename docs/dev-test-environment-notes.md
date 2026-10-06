# 开发环境拓扑与历史记录（根 AGENTS.md 迁出）

本文件按需阅读，不是自动加载的行为总纲。以下保留 2026-10-06 迁出时的原文，包含已退役路径、旧版本验证与待勘误事项，不能当作当前操作手册照抄。

现行通用开发与测试规范以 [Cordis-dsh-dev-test-guides.md](../Cordis-dsh-dev-test-guides.md) 为准；rig、启动和测试资产以 [.test/README.md](../.test/README.md) 及对应 seed 文档为准。遇到冲突先核实当前脚本和上游官方入口，不将历史 workaround 当作必需机制。

## 二、Dev/Test 1：源码级 4999 实例（upstream checkout + 内嵌 dashr）— 推荐回归路径

整个 harness 从源码跑，dashr 作为 workspace 成员内嵌其中，与 prod 完全隔离。**2026-09-02 已全链路验证。**
插件开发与测试环境的现行规范见仓库根 `Cordis-dsh-dev-test-guides.md`（两层文档制的第二层，2026-09-27 起；冲突以其为准）；本节记录本仓拓扑事实，rig 清单（含 bun distro 产物 rig `bun-test`）见 `.test/README.md`。

### 组成（2026-09-24 重构：干净 harness + plugin-add 交付形态；旧 monorepo 内嵌流已退役）

- Harness: `./upstream/deepseek-harness`，git tag **`dsh-v0.1.7-rc.1`**（2026-09-24 全新 clone 重建；本地 patch：unrun devDep / root vite devDep（rc.1 新增，apps/desktop tsdown config 运行时 import vite，unrun 缓存目录解析不到）/ storeDir+verifyDeps+zeromq+ssh2 / tsdown `resolveRepositoryRoot` / vite preact 三件套，重放流程与坑见 `docs/50_test-reports/2026-09-24-v0.1.7-rc.1对齐轮-compaction与failover设置面修复实测报告.md` §四）。**upstream 内不允许出现 better-dsh 的任何内容**（旧 `packages/better-dsh/` 内嵌副本 + devDeps 手术 + sync 脚本已于本轮废除）。
- better-dsh **独立开发**：devDependencies 不含任何 `@deepseek-ai/*`（范围符号在 peerDependencies = 发布契约）；`node_modules/@deepseek-ai/*` 由 `scripts/link-upstream.mjs` 生成 symlink 农场指向 upstream 物理包——upstream 换 tag 后 farm 自动跟随（目录级 symlink），package.json 零改动。`.npmrc` `legacy-peer-deps=true` 防 npm 自动装 optional peers（tuple 规则会解析到三代前的 0.1.5-rc.3）。开发循环：`npm run build` → `tsc --noEmit`（0 错基线）→ `npx vitest run`（600/601）。
- 测试 rig **`.test/seed/test123/`**（现行，README 有完整种子再生步骤）：home 在 `.test/home/`（2026-09-27 裁决：**home 复用不换场**——`compat/` = 默认长寿命 home，user data 与 `.credentials.yaml` 是测试资产跨重置保留；`RIG_HOME=clean` 仅在专门验证首次行为时临时建一个、用完即删；gitignored）；~~`profiles/node_modules/@deepseek-ai/*` symlink 农场~~ **已于 2026-09-26 删除**（user 指令；0.1.7 安装域拦截供给全部 harness 面——无农场 boot 实证：shell 200 + boot graph 含 better-dsh + client.js 200 + zoom-guard/`__DASHR_MOBILE__` host 半注入在位、日志零解析错误；rig 与 prod 解析模型现完全同构）；profile `web` 的 better-dsh 是 **`dsh plugin add <tarball>` 物理安装**（入场一律走 plugin add；`npm pack` 出交付物 → add → 重启；remove→add 一个来回才能刷新 file: tarball 内容）。旧 `.tests/dsh-test1/` 与 `.dsh-test/` 已删除（2026-09-24 清理，`.test/` 布局落地）。**0.1.7 settings 模型**：namespace = Loader entry id（如 `dashr-failover`），`installSection` 已删；volatile 字段 + `settings.configure({auto:false})` + configEditor 落 profile patch 用户层（upstream `agent-default-model` 范式）。

### harness 本地 patch（该环境必须，缺一 build 即挂）

1. `packages/client/tsdown.client.ts`: `REPOSITORY_ROOT` 由 `resolveRepositoryRoot()` 推导（`pnpm-workspace.yaml` 锚定，`process.cwd()` 兜底）。原因: 本机 Node 22.22.1 `process.features.typescript=false` → tsdown auto loader 选 unrun，unrun 的 bundle 级 define 把内联 preset 的 `import.meta.url` 改写成各包入口 config 的 URL，`packages/*/*` 深度下 `../..` 落到 `<repo>/packages/`，manifest glob 全空 → `no packages/*/*/package.json declares the name …`。upstream CI 的新 Node 走 native loader，看不到此问题。
2. `pnpm-workspace.yaml`: `storeDir: /home/u1/workspaces/dashr/.scratch/pnpm-store` + `verifyDepsBeforeRun: false` + allowBuilds `zeromq: true`（better-dsh 自 0.2.2-a 起零 lifecycle script，无自身 allowBuilds 条目）。原因: pnpm 11 不读 `.npmrc`；默认 deps-check 会 spawn `pnpm install`，向只读的用户级 store 注册 project → EROFS；strictDepBuilds 下未列 build script = install 硬错。
   （**另记 2026-09-13**：`pnpm add` 之后 `npx vite` 会从根解析到 vite 8/rolldown——web 构建一律走 `pnpm run build:web`（workspace 内 vite 6.4.3），勿用 npx 直呼。）
3. **（2026-09-13，change `2026-09-13-preact-ui-shell`）** `apps/web/vite.config.ts`: `resolve.alias` 增 react 家族五条 → `preact/compat`（regex 锚定）+ `resolve.dedupe` 增 `'preact'`（dedupe 条目从本包 node_modules 解析——缺它则 `packages/client/web/lib` 的 seed 解析不到 apps/web 里的 preact）；`apps/web` devDeps 加 `preact@10.29.8` 精确 pin。效果：shell 平台种子物化 preact 实例，全部 ui-* 插件 bundle 的 `require("react")` 零改动获得 Preact；shell index chunk 555,959 → 434,173 B（−21.9%），A/B 实测挂载面一致、console 零错。**同一 patch 顺带根除了 `vendor/CLAUDE.md` ENOTDIR/exit 236 老坑**：`vendor/` 根下的三个文档文件（AGENTS/CLAUDE/README.md）撞 `vendor/*` workspace glob——**0.1.6 起 `vendor/docs/` 也不行**（tsdown root tsdown.config 的 `vendor/*` workspace glob 会把无 package.json 的目录当幻影包，整 build 死，见对齐轮 §七），三个文件现放 **`.scratch/vendor-docs/`**（vendor 根下不允许存在任何子目录缺 package.json）。
### 构建（setup 或 harness 变更后）

```bash
cd ~/workspaces/dashr/upstream/deepseek-harness
pnpm install        # store 已重定向到 .scratch/pnpm-store
pnpm run build      # tsc lib/types + tsdown host/client + vite web + client build record（0.1.5-rc.2: 234 client artifacts，含 build:native-system）
```

### 启动 / 重启

```bash
# 2026-09-24 起：测试实例一律用 `bash .test/seed/test123/start.sh`（PORT=xxxx 可覆盖，默认 4999；
# LAN 中继默认开——socat 只绑 LAN IP 转发 loopback；webserver 只收 127.0.0.1|0.0.0.0 字面量
# 且 startup 硬拒 0.0.0.0，直接绑 LAN IP 不可能）。脚本自带：停旧+等端口真释放、
# 测试口无主化接管（2026-09-27 裁决：占口者属测试 unit 即停掉接管，非测试监听才拒绝）、
# seed 感知输出（seed 持久时明说 cookie 仍有效）、本 boot token 轮询提取（append 日志防串台）。
# 脚本内部即下面的 canonical 命令（unit dsh-4999-test123 + test123-lan-4999-relay）：
systemctl --user stop dsh-4999-test123 test123-lan-4999-relay 2>/dev/null
systemd-run --user --unit=dsh-4999-test123 \
  -p WorkingDirectory=/home/u1/workspaces/dashr/upstream/deepseek-harness \
  -p Environment=DSH_HOME=/home/u1/workspaces/dashr/.test/home/compat \
  -p 'Environment="DSH_TRUSTED_HOSTS=test.pc.randomhash.app pc.randomhash.app 192.168.31.130"' \
  -p 'UnsetEnvironment=DISPLAY WAYLAND_DISPLAY' \
  -p StandardOutput=append:/home/u1/workspaces/dashr/.scratch/dsh-4999-test123.log \
  -p StandardError=append:/home/u1/workspaces/dashr/.scratch/dsh-4999-test123.log \
  "$(which node)" apps/cli/lib/bin.js web --no-open --port 4999
# ⚠⚠ 2026-09-22 双平面修复起：boot 必须走**构建产物** `apps/cli/lib/bin.js` + 裸 node，
#   勿再用 `node --import tsx/esm apps/cli/src/bin.ts`（tsx 源码启动）！
#   根因（dual-plane symbol split）：tsx 源码启动下 TS 文件经 tsconfig.base.json `paths`
#   落 src/，而 plugin loader 把组合行解析到构建 lib 的 file URL → 同进程两份
#   dsh-tools/cordis 模块实例 → `Symbol('@deepseek-ai/dsh-tools.scheduler')` 键在
#   lib 侧 ToolRuntime 与 src 侧 agent-loop 之间错位 → 每个 session 的**第一个工具调用**
#   必崩 `Cannot read properties of undefined (reading 'prepare')`（UNKNOWN），孤儿
#   tool/call 事件毒化 session log → 后续每轮 DeepSeek INVALID_REQUEST "tool calls
#   need immediate results"。const enum（如 cordis `FiberState`）使 paths-less 收敛
#   不可行——唯一正解 = 产物面启动（与 prod 同构）。lib/bin.js 前置条件：改动 src 后先
#   `pnpm run build` 全量。A/B + 真 session 证据见
#   `docs/50_test-reports/2026-09-22-4988双平面启动修复实测报告.md`。
# ⚠ 与 prod 对齐的两行必须带：DSH_TRUSTED_HOSTS（fence + web-trust authorities 单源，
#   覆盖 test.pc… / pc.randomhash.app / LAN）与 UnsetEnvironment=DISPLAY WAYLAND_DISPLAY
#   （prod dsh.service 同款——否则 directory-picker auto 在图形 env 下选 native，zenity
#   弹在宿主桌面，经 Caddy 远端访问时 Add workspace 表现为无响应后置灰；2026-09-08 实证）
# user 终端（非沙箱）等价简式:
# cd ~/workspaces/dashr/upstream/deepseek-harness && DSH_HOME=~/workspaces/dashr/.test/home/compat node apps/cli/lib/bin.js web --no-open --port 4999
# ⚠ 旧简式 `npm run dsh -- web …`（内部 tsx 源码启动）自 2026-09-22 起禁止用于回归验收——同上双平面必崩
#   （`--dump-config` 这类 config 面检查不受影响，仍可用 tsx 形态）。
```

> **勿从 agent 沙箱化 bash 直接拉 daemon（2026-09-03 实证）**：沙箱内启动的 daemon 继承嵌套沙箱环境，其 bwrap 功能探测（`sandbox-local defaultProbeBwrap`）报 `No permissions to create a new namespace` → `SANDBOX_UNAVAILABLE`（agent bash 无沙箱后端）。systemd-run --user 在沙箱外启动（对齐 prod 形态）；沙箱内连 user bus 会被拒，需单命令 `danger-full-access` 升级。stop/日志：`systemctl --user ... dsh-4999-test` / `.scratch/dsh-4999.log`。

- token（`?token=`）是 per-boot 进程内随机 launch token，只负责首铸 cookie；**认证 seed 持久在 `$DSH_HOME/.credentials.yaml`**——home 不换则 seed 不变，**浏览器 cookie 30 天内跨重启直接可用，重启 rig 不需要换 token / 重注 cookie**（2026-09-27 裁决；机制见 guide §3.3）。从 `.scratch/dsh-4999-test123.log`（或 start.sh 输出）取 token URL；curl 冒烟需 cookie jar: `curl -c jar -L '<token-url>'`（303 重定向靠 cookie 保认证）。
- 数据只落 `.test/home/compat/`（sessions/storages），与 prod 隔离；重置只动 `profiles/web`，user data 保留。

### 日常回归循环（recurring，2026-09-24 起：交付形态）

canonical 构建 → 验收走 tarball；快速迭代走 profile 内物理 lib 替换（**只碰 profile，永不碰 upstream**）：

```bash
cd ~/workspaces/dashr/better-dsh && npm run build        # tsdown + build-client
# 快路径（client 半边改动）：直接覆盖 profile 里的物理安装，刷新页面即生效
rsync -a --delete lib/ ~/workspaces/dashr/.test/home/compat/profiles/web/node_modules/better-dsh/lib/
# host 半边改动：同上覆盖后重启（start.sh）
# 阶段性验收（发布前必走）：npm pack → remove → add → 重启
cd ~/workspaces/dashr && DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js \
  plugin --profile web remove better-dsh
DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js \
  plugin --profile web add $PWD/better-dsh/better-dsh-<version>.tgz
bash .test/seed/test123/start.sh
```

- **⚠ file: tarball 内容更新 pnpm 不自动刷新**（同版本同路径 → `added 0`）：改完包必须 remove → add 一个来回，别信 add 幂等。
- **⚠ lib/client 清洗陷阱仍在**：tsdown 清空 lib/ 会抹掉 lib/client/，`npm run build`（= tsdown && build-client）已串好两步，勿单跑 tsdown。
- 验证：boot graph 含 `"id":"better-dsh"`；`/plugins/??better-dsh/client.js&rev=…` 200；Settings/General 两行在（compaction stepper + failover selects）。
- `--dump-config`：`DSH_HOME=… node upstream/deepseek-harness/apps/cli/lib/bin.js web --dump-config | grep -A2 dashr-repl`。

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

- 核: `~/.local` npm 全局 `@deepseek-ai/dsh` 0.1.7-rc.1（2026-09-23/24 user 升级）；profile `web` 在 `~/.dsh/profiles/web`（pnpm hoisted 物理 tree）。
- 插件线: `./better-dsh` `npm run build`（= `tsdown && npm run build-client`）→ md5 核对同步 `lib/` 到 `~/.dsh/profiles/web/node_modules/better-dsh/lib`（v0.2.1c 的部署方式）→ 重启 `dsh.service`。
- harness 依赖线: **已退役**（原 `better-dsh/node_modules/@deepseek-ai/*` symlink 到 dsh-alpha 源码的方案，2026-09-02 已删——实测 host ②③ 层全量自供，嵌套 symlink 无一必需，且 alpha.1 指向对 alpha.3 host 是版本偏斜负债）。
- 解析即第一节 ①→④ 分层；现已验证插件运行期只依赖 ②③（host 自供）+ ① 的 schemastery/cosmokit。
- ~~剩余待验证~~ **已收敛（2026-09-02）**: `./better-dsh` 构建产物 md5 同步线的 prod 冒烟已跑（v0.2.1c 同步态活体 4 探针 4/4）；profile 锁/lockfile/部署位已统一为 `0.2.1-d`（经 `dsh plugin add @pgmi-builds/better-dsh@0.2.1-d`，见第一节供应链年龄门）。**发布态部署的正道是 pnpm add 精确版本**，手工 md5 同步仅限未发布的本地迭代。

---

## ✅ prod 插件嵌套 symlink 悬空 — 已清理（2026-09-02），重启安全

`dsh-alpha` 改名 `z_dsh-alpha` 后，`~/.dsh/profiles/web/node_modules/better-dsh/node_modules/@deepseek-ai/*` 的 17 条 symlink 曾全部悬空。**实测: daemon 重启不会崩** —— 运行期实际 import 的 14 个 `@deepseek-ai/*` 包全部从 ②③ 层解析（host 自带）；`dsh-client-ui-slots` 不是运行期 import（只在 `scripts/build-client.ts` 的 client external 列表，浏览器侧经 shell module table / `.dsh-module-fallback` 解析）。

**为什么声明 58 个 peerDeps**: 全是 dev-time 需要 —— `tsc --noEmit` 类型检查、`tsdown` dts、以及 vitest 单测（在 dsh host 之外直接 import harness 包；dev workspace 靠 pnpm `autoInstallPeers` 装上）。部署副本里它们是 `peerDependencies` 且 `peerDependenciesMeta` 全部 `optional: true`，pnpm-lock.yaml 对嵌套路径 0 引用 —— pnpm 从不要求它们在场。真正的 `dependencies` 只有 `@deepseek-ai/schemastery`（非 harness API，是插件自用的 Schema 描述符库；描述符是结构化数据、宿主 cordis 当数据解释，故可以自带副本，与 cordis 必须 peer 的身份要求相反）+ cosmokit（schemastery 的传递依赖）。

**已执行**: 删除 17 条悬空 symlink，保留 `schemastery`+`cosmokit`；清理后 14/14 运行期 import 解析复测通过。曾考虑的 A（重指 z_dsh-alpha，alpha.1 与 alpha.3 host 版本偏斜、「两份 cordis」身份风险）与 B（重指 upstream checkout）均已否决。另: ~~profile package.json 锁 `0.2.1-a` 而部署实为 `0.2.1-c`~~ 漂移已于 2026-09-02 收敛——锁/lockfile/部署位统一 `0.2.1-d`（pnpm add 精确版本线）。

---

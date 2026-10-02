# Cordis / DSH 开发与测试指南

> 本文件是 DASHR 仓**唯一**的通用 dev/test 指引（两层文档制：根 `AGENTS.md` = 总纲、拓扑事实与发布红线；本文件 = 插件开发与测试的全部机制细节。子目录 `AGENTS.md` 只放局部规则与指针，不复制本文件内容）。
> 历史文档（`docs/50_test-reports/`、`docs/60_exploration-and-research/`）是事实参考，**规范以本文件为准**。
> 状态：v1（2026-09-27，user 裁决落版：① 测试口无主化；② test home 复用不换场；③ seed 持久 ⇒ cookie 30 天免重注入；④ 文档两层化）。标 ⚠ = 实测事实，标 ❓ = 待验证。

---

## 0. 范围与例外

**在范围内**：DSH 插件（Cordis 插件包）的开发方式、依赖归属、以及"真实用户视角"的本地测试流程。

**例外（不在本规范内，各自另立守则）**：

- **DSH distro**（`dashr/` 交付层）—— 组合/发行形态，与单插件开发不同。
- **半构建（semi-built）产品** —— 内嵌副本手术模式，不走 registry/tarball 安装面。
- **harness 本体（upstream checkout）的本地 patch** —— 属于"改造 harness"，不是"开发插件"。

---

## 1. 心智模型

### 1.1 一切皆 Cordis 插件行

运行的 DSH = 按层组合出来的 Cordis 插件树（bundles 列序 → profile patch → home patch → `--patch`）。
**没有特权内核**：工具、模型、会话、沙箱、审批、UI 槽位，全是插件行。

由此推出的两条硬规则：

- **patch 行按 id 整行重述**，不是深合并 —— 改一个字段也必须把该行所有字段写全。
- **插件顺序由 `inject` 依赖决定**，不是 YAML 位置。

### 1.2 两个平面（先定平面，再写代码）

| 平面 | 装什么 | 判据 |
|---|---|---|
| **Host composition** | 注册表（`tools`/`systemPrompt`/`agents`/`agent-loop`/`sessions`）、跨会话设施（持久化/查询/存储/settings/凭据/遥测）、沙箱与审批栈、模型路由、subagent 注册表 | **必须被共享** |
| **Agent preset** | 单个 session 贡献给上述注册表的东西：工具插件、persona/prompt 段、compaction 策略 | **一个 session 一份** |

**关键红线**：发布服务的行不能裸放在 preset 里。裸放 = 落进进程全局 realm，第二个 session 挂载即冲突，挂载会直接拒绝。
preset 自己拥有的服务，必须把**提供者与所有消费者**一起包在一个带 `isolate` realm 的 group 里。

### 1.3 供给三分桶（"我该 import 还是 inject"）

**唯一判据：运行期是谁提供这个东西。**

| 你要用的东西 | 机制 | 产物形态 | 运行期谁提供 |
|---|---|---|---|
| **会被组合替换的服务实例**（`fs`/`llm`/`tools`/`sessions`/`settings`…） | **`inject`** + `ctx.get()` / `ctx.<svc>` | 不 import 实现，顶多 import **类型**做结构镜像 | 宿主组合 |
| **库函数 / 类型 / 组件**（宿主 API） | **`import`**（声明为 optional peer） | 裸 `import`（tsdown `platform:'node'` 默认外部化 deps+peers，**零配置**） | 宿主：0.1.7 起 = loader 安装域拦截 |
| **你自带的真依赖** | **`import`**（写进 `dependencies`） | 裸 `import`，由消费者安装 | 你自己的包 |

**`import` 语句永远必须在你的源码里**；但被 import 的**模块不必在你的包里** —— 它可以在宿主的树里，也可以在浏览器 module table 里。

---

## 2. 开发期主线

### 2.1 服务端半边（host half）

三层职责，各自独立：

| 层 | 干什么 | 落点 |
|---|---|---|
| **服务/事件层** | 提供或消费 Cordis 服务、监听 `agent/*`、`tools/*` 等事件 | `inject` + `ctx.on(...)`；服务按 1.2 的平面规则放置 |
| **能力注册层** | `defineTool` 注册工具、注册 prompt section、注册 slot | 必须在 host 平面或 preset 平面的正确一侧 |
| **配置面** | settings namespace（0.1.7 起 = **Loader entry id**）、`configEditor` 落盘 | 用 volatile 字段 + `settings.configure({auto:false})`，不要用已删除的 `installSection`/`settings.get` |

### 2.2 客户端半边（client half）

三层职责：

| 层 | 干什么 | 注意 |
|---|---|---|
| **纯逻辑层** | 状态机、几何计算、阈值判定 | 写成纯函数，脱离浏览器可单测（本仓 `src/mobile/gesture.ts` 就是这个形态） |
| **UI 注入层** | `ctx.slots.inject(...)` + React 组件 | 只许寻址**官方表面**（服务方法 / 语义 `data-*`）；第三方插件 DOM 永不作为状态输入 |
| **构建期外部化层** | `CLIENT_EXTERNALS` 名单 | ⚠ 名单**不是 `declare`**，它只决定"内联还是留 `require`"；`import` 一行都不能少 |

**客户端运行期 = 浏览器 module table**：`CLIENT_EXTERNALS` 里的裸 `require(...)` 由 shell 的 **platform seed** 解析
（`react` / `react/jsx-runtime` / `react-dom` / `react-dom/client` / `cordis` / `ui-slots` / `ui-primitives` / `client-store`）。
所以插件拿到的 UI 原语**和宿主 UI 是同一个模块实例** —— 这就是"dsh native 组件"的准确含义，也是**绝不能自己 vendor 一份**的原因。

### 2.3 依赖解析与发布面（这是开发内容的一部分）

三种归属，对应三种命运：

| 归属 | 消费者会不会装 | 判定 |
|---|---|---|
| `dependencies` | **会**（进你的包） | 宿主不提供的东西：`schemastery`、`zeromq`、`diff`、`file-type`、`puppeteer-core`、`xxhash-wasm`、`use-sync-external-store` |
| `peerDependencies`（+ `optional:true`） | **不会**，期望宿主提供 | 全部 harness API 包。⚠ 客户端那几个还必须是 `CLIENT_EXTERNALS` 成员 |
| `devDependencies` | 不会 | **只为开发期存在**：typecheck、vitest、dts 类型解析。不影响运行期，也不进发布物 |

**两个必须同时成立的门（否则会出现"本地能过、线上静默坏"）**：

1. **`tsconfig` 的覆盖门**：客户端半边若被 `exclude`，就等于**完全没有类型检查**。必须有一条 client lane（本仓已立：`better-dsh/tsconfig.client.json`）。
2. **版本同源门**：dev 期解析到的类型必须与**运行期提供者**同源（客户端 = shell 构建产物；服务端 = 宿主树）。
   ⚠ 只要 dev 期解析到 registry 上的旧版本，类型检查就会**给假绿灯** —— 这正是 2026-09-24 图标 `[object Object]` 事件的机制。

> ⚠ 发布契约上，npm-range 形式的 optional peer 有个坑：**预发布版本的 tuple 规则**。
> 例如 `>=0.1.5-0 <0.3.0-0` **不匹配** `0.1.7-rc.1`（0.1.7 的 tuple 没有预发布比较器），
> 于是 auto-install 会落到 `0.1.5-rc.3` —— 一个三代之前的 API。devDeps 必须**钉精确版本**来消除这个偏斜；
> 且**永远不要在子包里 `npm install @deepseek-ai/*`**（物化物理副本 → 双模块实例 → scope Symbol 分裂）。

---

## 3. 测试环境规范

### 3.1 端口：测试口无主化（2026-09-27 user 裁决）

- **499x 一族全是测试口，没有谁占用谁（4999 也是）**。起线前 `ss -tln` 动态探测。
- 端口被占时的处置：经 `/proc/<listener-pid>/cgroup` 找到归属 user unit——属**测试基建**（unit 名 `dsh-*` / `test123-*` / `bun-test-*` / `*-test` / `*-relay` 等）→ **停掉接管**；**非测试监听**（prod 3080/3081、未知进程）→ 拒绝并换口。两个 rig 的 `start.sh` 均已内置此逻辑。
- **4999 = Caddy `test.pc.randomhash.app`**（wan 可见）是**通道事实**，不是占用特权；非 Caddy 端口由 rig 自动拉 **socat LAN relay**（只绑 LAN IP、绝不 0.0.0.0；`LAN=0` 仅限本机调试）。
- ⚠ webserver 只接受 `127.0.0.1` / `0.0.0.0` 字面量且**启动硬拒 `0.0.0.0`**（RCE 门）——LAN 直连只能走用户态中继。
- **永不触碰 3080（prod）/ 3081（omp-web prod）**；prod 3080 的重启只凭 user 明确下令（根 AGENTS 红线）。

### 3.2 目录布局与 test home：**种子**与**运行数据**分开；home 复用不换场（2026-09-27 user 裁决）

仓库根下两种东西语义完全不同，种子入库、运行数据 gitignored：

| 角色 | 内容 | 是否入库 | 现状 |
|---|---|---|---|
| **种子 / 配置模板** | 启动脚本、profile 种子、rig README（含 session schema 版本与最近兼容验证日期） | **入库**（可重生成） | `.test/seed/<rig>/` |
| **运行 home** | `sessions/`、`storages/`、`snapshots/`、`profiles/*/node_modules`、`.credentials.yaml` | **gitignored** | `.test/home/<rig>/` |

**home 使用纪律**：

- 一个 rig 一个**长寿命 home**（test123 = `home/compat/`）。**测试现场不需要换 home**：被测件的隔离单位 = profile（`dsh plugin add` 物理装进 `profiles/web/node_modules`），换被测版本 = remove → add（或重装 tarball），**home 与 user data 原地不动**。
- **user data 是测试资产**：`sessions/`、`storages/`、`.credentials.yaml` 跨重置保留——已创建的会话记录直接拿来测（list / replay / 跨版本读取兼容），不需要从零造数据。
- 全新 home（`RIG_HOME=clean`）只在**专门验证首次行为**（first boot / 干净启动）时临时建一个，用完即删——非常设配对（旧"compat/clean 双 home 常备制"废止）。
- 例外 rig：`bun-test` 的 home 由其脚本自治（重启默认保留 = resume test；`CLEAN=1` 清测试数据但保留 keep-set 含 `.credentials.yaml`）。
- **绝不触碰 `~/.dsh`（prod home）**；rig 脚本只写 `.test/home/`。

### 3.3 认证：seed 持久 + cookie 30 天，不搞 token 仪式（2026-09-27 user 裁决）

机制（⚠ upstream 实证：`packages/client/connection/src/browser-auth.ts` + `packages/credentials/credentials-local`）：

- 浏览器会话认证的**签名 secret（seed，32B）持久在 `$DSH_HOME/.credentials.yaml`**（owner-only 600）：每 home 一份，跨重启、跨 `plugin add/remove`、跨 profile 重装不变——**只要不删 home，seed 就不变**（bun-test 的 `CLEAN=1` 也把它列入 keep-set）。
- 浏览器 cookie = `v1.<payload>.<HMAC-SHA256(seed, payload)>`，有效期 = `connection.cookieMaxAgeDays`（schema 默认 **30 天**），cookie 名绑定 authority（Host）——同一 home 的不同访问 authority（Caddy 域名 vs `LAN-IP:port` vs loopback）各铸各的 cookie，吃同一个 seed。
- URL 里的 `?token=<launch token>` 是 **per-boot 进程内随机值**，唯一职责 = 首次访问时铸 cookie。

**纪律**：

1. **重启测试 rig 不需要换 token、不需要重注 cookie**——旧 cookie 在 30 天窗口内、authority 没变、home 没删，就直接过认证。rig `start.sh` 在 seed 已存在时明说这一点，token URL 只标注为「首登 / 新 client 用」。
2. 需要重走 token 的仅三种情况：home 被删/换（seed 重生成）、换了访问 authority、cookie 过 30 天窗口。

---

## 4. 本地测试流程（真实用户视角）

### 4.1 目标与现状

让测试实例**尽可能像真实用户的部署**：装的是**发布产物**，不是源码符号链接。

✅ **已达标（2026-09-24 重构 + 2026-09-26 farmless 实证）**：test123 rig 的 profile `web` 中 better-dsh 是 **`dsh plugin add <tarball>` 物理安装**；`profiles/node_modules` symlink 农场已删除——0.1.7 安装域拦截供给全部 harness 面，rig 与 prod 解析模型**完全同构**。本节旧版描述的"symlink 源码形态偏差"已消灭。

### 4.2 步骤（test123 rig）

```sh
# 0) 日常启动/重启（幂等；端口接管 + LAN relay + token 提取全自动）
bash .test/seed/test123/start.sh                 # 默认 4999 + home/compat

# 1) 构建插件 —— 交付形态（tarball），不是 symlink
cd better-dsh && npm run build && npm pack       # → better-dsh-<version>.tgz

# 2) 按真实用户方式安装（⚠ 相对路径锚定在"调用者 cwd"，不是 profile 目录）
DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js \
  plugin --profile web add $PWD/better-dsh/better-dsh-<version>.tgz

# 3) 验收（见 §5 的热插拔边界——add/remove 热生效 5~15s，daemon 不重启）
# 4) 卸载（**不是停实例**）
… plugin --profile web remove better-dsh
```

⚠ **file: / 同版本 tarball 内容更新 pnpm 不自动刷新**（`added 0`）：改完包必须 remove → add 一个来回，别信 add 幂等。

### 4.3 命令语义（⚠ 均为源码实测事实）

- **`dsh plugin --profile <name> <args…>` 是 pnpm 的参数透传**：只有 `allow-version` / `revoke-version` /
  `version-exemptions` 三个子命令由 DSH 自己处理，其余原样交给 pnpm（`apps/cli/src/plugin.ts`）。
- **tarball / 本地路径是"一等支持"**，不是 hack：`anchorPathSpec()` 专门把相对路径 spec 锚到**调用者 cwd**。
- **子命令是 `remove`，不是 `delete`**：pnpm 没有 `delete` 命令；别名可用 `rm` / `uninstall`。
- **卸载/安装会自动维护 `dsh.profile.bundles`**：任何一次成功的 pnpm run 之后 `reconcile()`
  会把已不在 `dependencies` 里的名字从 bundles 摘掉、新装的 bundle 加进去。**不需要手工编辑 bundles。**
- **安装失败会回滚**：恢复 `package.json` + `pnpm-lock.yaml`，打印 `dsh: installation rejected`——"试装"安全。
- ❓ 待验证：本地 tarball 是否触发 profile 的**供应链年龄门**（registry 安装有 ≈24h 门；本地 tarball 预期不触发）。
  registry 安装的持久 exclude 形式 = **裸包名** `minimumReleaseAgeExclude`（版本号形式只盖解析相位，不盖锁文件校验相位）。

---

## 5. 热插拔规范（Comply or Explain）

### 5.1 五类「热插拔」不是一回事（⚠ 0.1.7 实测边界；2026-09-24 二次实测修正——首测"组合变化必须重启"作废）

| 变更对象 | 现状 | 生效方式 |
|---|---|---|
| **profile 配置**（`cordis.patch.yml` / 行 config） | **默认开**（base bundle `hmr` 行；`watch-config.ts` 精确监听 patch 文件） | **改文件即热生效**（秒级，实测 ~6-8s） |
| **profile 依赖面**（`plugin add`/`remove`、manifest、增删 bundle 行） | **支持**——HMR entry 层同时 watch patch 文件**与 profile `package.json`**（`hmr/src/index.ts:235-236`），refresh 全量重组 | **热生效 ≈5–15s**（实测：add tarball ≈5s、remove ≈15s），daemon 零重启 |
| **插件 host 代码**（`lib/*.js`） | **不热**：module 层 watcher 显式 ignore `**/node_modules`；`hmr.config.root` 默认 `root: []` | 重启；或 profile 内 lib 覆盖（仅 client 半边免重启） |
| **插件 client bundle**（`lib/client/index.js`） | **支持**：宿主按 artifact rev 提供 bundle | 重建后**刷新页面即生效**（2026-09-24 图标修复即此路径） |
| **installation-scope 解析表变更** | **冻结**：`replace()` 对既有条目变更直接 throw "requires a process restart" | 重启 |

**测量纪律**：热插拔结论必须在刷新链窗口（**≥15s**）之后下，且先用**每请求信号**（如 web-trust 注入的 zoom-guard 脚本在场性）证明 boot graph 是活树渲染而非 boot 快照——首测"不热"即 2 秒读数的测量事故。

### 5.2 规范条文

1. **默认要求**：插件的**行为改动**应当能通过"client bundle 重建 + 刷新"、"配置文件热重载"或"`plugin add`/`remove` 热装卸"验证，**不重启实例**。
2. **Comply or Explain**：做不到 1 的，必须在插件 README 或 PR 说明中给出**具体原因**（"开发不到位"是默认结论）。
3. **允许重启的情形**：boot / loader 相关；`node_modules` 内**代码替换**；installation-scope 解析表变更。⚠ 增删 bundle、首次安装/卸载**不属于此列**（实测热生效）。
4. **⚠ remove→add 循环不是重启替代**（2026-09-25 同源 harness 实证）：`remove` 热卸载成立，但随后的 `add` **不回装 rows**——树停在无插件态直到重启。改包内容走「remove → add → 需要时重启」。
5. **允许重启 ≠ 允许停实例**：卸载走 `dsh plugin remove`，不得用"把 rig 停掉"代替清理；prod 永不碰。
6. 重启后必须**复验**：端口、boot graph（`--dump-config` 看行真挂上）、认证/挂载探针（不是"进程活着"就算数）。

### 5.3 进程内解析模型（0.1.7，与 prod 同构）

**表 = 重定向表 + 原生兜底**：启动时 `createRuntimeResolution({installAnchor, profile})` 算纯内存解析表，`PluginPackages` 进程内拦截导入（零磁盘 symlink）。`routeScoped()` 三分支：profile `node_modules` 物理存在 → native（`statSync` 每请求查盘 ⇒ **即装即解析**）；表里有 installation-scope 条目 → 重定向到 install tree；都没有 → 原生祖先链兜底。推论：表外名字不被拦；运行时装进 profile 的新包无需重启即可解析；installation scope 进程内冻结。**世界/子进程不经 launcher 时无表**，须自带供给（本仓暂无此形态，记录备查）。

---

## 6. 待定（Open Questions）

1. ❓ 本地 tarball 是否触发供应链年龄门（§4.3 末条；registry 侧的裸包名 exclude 形式已实证）。
2. ❓ `hmr.config.root` 打开后，插件 host 代码热重载对**已注册工具/服务**的实际语义（是重注册还是新增）？需一次实测。
3. ✅ `.test/{seed,home}` 布局已落地（2026-09-24），旧 `.tests/`、`.dsh-test*/` 已删除。
4. ✅ session schema 版本清单由各 rig README 承载（`​.test/seed/test123/README.md`）。

---

## 附录 A：事实锚点（源码位置，便于复核）

- pnpm 透传与 DSH 自有子命令：`apps/cli/src/plugin.ts`
- 安装/卸载/reconcile/回滚：`packages/boot/plugin-manager/src/operations.ts`
- hmr 行与开关：`packages/bundle/base/cordis.patch.yml`；配置热重载 `packages/boot/hmr/src/watch-config.ts`；entry 层 watch `packages/boot/hmr/src/index.ts:235-236`
- 解析表：`apps/cli/src/profile-boot.ts`（`createRuntimeResolution`）、`packages/boot/plugin-manager/src/resolver.ts`（`routeScoped`）
- 认证 seed：`packages/client/connection/src/browser-auth.ts`、`packages/credentials/credentials-local/src/index.ts`（`.credentials.yaml`）
- client hmr：`packages/bundle/web-app/cordis.patch.yml`、`packages/client/hmr/src/`
- platform seed：`packages/client/web/src/seed.ts`
- 客户端外部化名单：`better-dsh/scripts/build-client.ts` 的 `CLIENT_EXTERNALS`；typecheck lane：`better-dsh/tsconfig.client.json`
- rig 种子：`.test/seed/test123/`（README 含热插拔实测表与端口纪律）、`.test/seed/bun-test/`

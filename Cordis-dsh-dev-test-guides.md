# Cordis / DSH 开发与测试指南

> 本文件是 DASHR 仓关于 **Cordis 插件开发** 与 **本地测试环境** 的现行规范。
> 历史文档（`AGENTS.md`、`docs/50_test-reports/`、`docs/60_exploration-and-research/`）可作为事实参考，
> 但**规范以本文件为准**；冲突时以本文件为准。
>
> 状态：草案 v0（2026-09-24）。标 ⚠ 的条目是**实测事实**，标 ❓ 的是**待验证**。

---

## 0. 范围与例外

**在范围内**：DSH 插件（Cordis 插件包）的开发方式、依赖归属、以及"真实用户视角"的本地测试流程。

**例外（不在本规范内，各自另立守则）**：

- **DSH distro**（`dashr/` 交付层）—— 组合/发行形态，与单插件开发不同。
- **半构建（semi-built）产品** —— 内嵌副本手术模式，不走 registry/tarball 安装面。
- **harness 本体（upstream checkout）的本地 patch** —— 属于"改造 harness"，不是"开发插件"。

例外部分与插件开发有相似之处，将来可参照本指南编写各自的守则。

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
| **库函数 / 类型 / 组件**（宿主 API） | **`import`**（声明为 optional peer） | 裸 `import`（tsdown `platform:'node'` 默认外部化 deps+peers，**零配置**） | 宿主：node 从插件向上 → profile → 全局 |
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

1. **`tsconfig` 的覆盖门**：客户端半边若被 `exclude`，就等于**完全没有类型检查**。必须有一条 client lane。
2. **版本同源门**：dev 期解析到的类型必须与**运行期提供者**同源（客户端 = shell 构建产物；服务端 = 宿主树）。
   ⚠ 只要 dev 期解析到 registry 上的旧版本，类型检查就会**给假绿灯** —— 这正是 2026-09-24 图标 `[object Object]` 事件的机制。

> ⚠ 发布契约上，npm-range 形式的 optional peer 有个坑：**预发布版本的 tuple 规则**。
> 例如 `>=0.1.5-0 <0.3.0-0` **不匹配** `0.1.7-rc.1`（0.1.7 的 tuple 没有预发布比较器），
> 于是 auto-install 会落到 `0.1.5-rc.3` —— 一个三代之前的 API。devDeps 必须**钉精确版本**来消除这个偏斜。

---

## 3. 测试环境规范

### 3.1 端口

- 默认取一个约定端口（现为 **4999**），**整机共享**。
- ⚠ 候选端口表**不能写死**。实测（2026-09-24）：`4990`、`4997`、`4999` 均在监听中，其中 4999 就是当前开发实例。
  启动前必须动态探测可用端口，并检测"端口已被外来进程占用"。
- ⚠ webserver 只接受 `127.0.0.1` / `0.0.0.0` 两个字面量，且**启动时硬拒 `0.0.0.0`**（RCE 安全门）。
  要 LAN 直连只能加一层**用户态中继**（只绑 LAN IP 转发到 loopback）—— 详见 `.test/seed/test123/start.sh`。

### 3.2 目录布局：**种子**与**运行数据**必须分开

这是本规范对"统一到 `.test/`"的修正：仓库根下**两种东西语义完全不同**，合进一个目录会把会话数据带进 git。

| 角色 | 内容 | 是否入库 | 现状 |
|---|---|---|---|
| **种子 / 配置模板** | profile 的 `package.json`、`cordis.patch.yml`、复现步骤 README | **入库**（可重生成） | `.test/seed/<rig>/`（2026-09-24 迁移后） |
| **运行 home** | `sessions/`、`storages/`、`snapshots/`、`profiles/*/node_modules` | **gitignored** | `.test/home/<rig>/`（2026-09-24 迁移后） |

推荐形态（保留一个父目录即可满足"统一"）：

```
.test/
  seed/<rig>/          # 入库：profile 种子、启动脚本、README
  home/<rig>/          # gitignored：DSH_HOME 实体（sessions/storages/profiles）
```

### 3.3 持久化与格式兼容性

- 会话数据**默认就持久化**在 `$DSH_HOME/sessions/`。长寿命 home 的价值是**持续验证旧 session log 对未来版本可读**。
- ⚠ 但长寿命 home 与"干净可复现"互相污染（迁移产物如 `settings.yaml.imported`、历史 storages 会残留）。
  **规范：两个 home 配对使用** ——
  - `home/compat/`：长期保留，专测格式兼容；
  - `home/clean/`：每次可弃，专测干净启动。
- 每个 rig 的 README 记录它当前承载的 **session schema 版本**与最近一次兼容验证日期。

---

## 4. 本地测试流程（真实用户视角）

### 4.1 目标

让测试实例**尽可能像真实用户的部署**：装的是**发布产物**，不是源码符号链接。

⚠ 现状偏差（必须承认）：当前 4999 实例**不是**"干净原生"——
它的 profile `dsh.profile.bundles` 含 `better-dsh`，`dependencies` 写 `0.2.4-a`，
而 `node_modules/better-dsh` 是**指向 monorepo 副本的符号链接**。要实现本节流程，必须先把这条 symlink 换成真 tarball 安装。

### 4.2 步骤

```sh
# 1. 一个干净原生实例常驻（只有 base + web-app，不含开发中的插件）
DSH_HOME=.test/home/clean node apps/cli/lib/bin.js web --no-open --port <PORT>

# 2. 构建插件 —— 交付形态与源码形态分离（symlink 是源码形态，tarball 是交付形态）
cd better-dsh && npm pack            # → better-dsh-<version>.tgz

# 3. 按真实用户方式安装（⚠ 相对路径锚定在"调用目录"，不是 profile 目录）
dsh plugin --profile web add ./better-dsh-0.2.4-b.tgz

# 4. 验收（见 §5 的热插拔边界）
# 5. 卸载（**不是停实例**）
dsh plugin --profile web remove better-dsh
```

### 4.3 命令语义（⚠ 均为源码实测事实）

- **`dsh plugin --profile <name> <args…>` 是 pnpm 的参数透传**：只有 `allow-version` / `revoke-version` /
  `version-exemptions` 三个子命令由 DSH 自己处理，其余原样交给 pnpm（`apps/cli/src/plugin.ts`）。
- **tarball / 本地路径是"一等支持"**，不是 hack：`anchorPathSpec()` 专门把相对路径 spec 锚到**调用者 cwd**
  （`plugin-manager/src/operations.ts:62`、`runProfilePnpm` 里 `args.map(arg => anchorPathSpec(arg, context.cwd))`）。
- **子命令是 `remove`，不是 `delete`**：`INSTALL_COMMANDS = new Set(['add','install','i'])`，
  其余交给 pnpm；pnpm 没有 `delete` 命令。别名可用 `rm` / `uninstall`。
- **卸载会自动维护 `dsh.profile.bundles`**：任何一次**成功的 pnpm run** 之后都会跑 `reconcile()`
  （`operations.ts:464`），它会把已不在 `dependencies` 里的名字从 bundles 中摘掉，并把新装的 bundle 加进去。
  **不需要手工编辑 profile 的 bundles 列表。**
- **安装失败会回滚**：校验不通过时恢复 `package.json` + `pnpm-lock.yaml`（尽量连 `node_modules` 一起），
  并打印 `dsh: installation rejected`。所以"试装"是安全的。
- ❓ 待验证：本地 tarball 是否触发 profile 的**供应链年龄门**（registry 安装有过 24h 门；本地 tarball 预期不触发，需实测确认）。

---

## 5. 热插拔规范（Comply or Explain）

### 5.1 三种"热插拔"不是一回事（⚠ 实测边界）

**"默认必须支持热插拔"这句话只有在拆成下面三种之后才成立。** 笼统地要求"默认支持"会写出无法执行的规范。

| 变更对象 | 现状 | 生效方式 |
|---|---|---|
| **profile 配置**（`cordis.patch.yml` / patch 行 / 行 config） | **默认开**。base bundle 的 `hmr` 行 `disabled: !!js "!ctx.get('profileContext')"`、`config.root: []`，注释写明 "Profile configuration reloads by default; module roots are opt-in"；`watch-config.ts` 精确监听 patch 文件 | **改文件即热生效** |
| **插件 host 代码**（`lib/*.js`） | **默认关**（`root: []` = 不 watch 任何模块根）。模块监听是**显式 opt-in** | 要么把模块根加进 `hmr.config.root`，要么重启 |
| **插件 client bundle**（`lib/client/index.js`） | **支持**：宿主按 artifact rev 提供 bundle | ⚠ 实测：重建 `lib/client/index.js` 后**刷新页面即生效，无需重启 daemon**（2026-09-24 图标修复即此路径）。⚠ shell / `apps/web` 改动则需重建 Web 产物 + 刷新 |
| **组合结构变化**（`plugin add`/`remove` bundle、新增 package） | **不支持进程内热插拔** | **必须重启 profile**（plugin-manager 走 pnpm 改依赖树，进程内不重新解析） |

### 5.2 规范条文

1. **默认要求**：插件的**行为改动**应当能通过"client bundle 重建 + 刷新"或"配置文件热重载"验证，**不重启实例**。
2. **Comply or Explain**：做不到 1 的，必须在插件 README 或 PR 说明中给出**具体原因**（"开发不到位"是默认结论）。
3. **允许重启的情形**（启动插拔）：
   - 改动涉及 **boot / loader**；
   - 改动涉及**组合结构**（增删 bundle、依赖树变化）；
   - 插件首次安装或卸载。
4. **允许重启 ≠ 允许停实例**：§4.2 的卸载步骤走 `dsh plugin remove`，**不得**用"把 4999 停掉"代替清理。
5. 重启后必须**复验**：端口、boot graph、以及"插件行真的挂上了"（不是进程活着就算数）。

---

## 6. 待定（Open Questions）

1. ❓ 本地 tarball 是否触发供应链年龄门（§4.3 末条）。
2. ❓ `hmr.config.root` 打开后，插件 host 代码热重载对**已注册工具/服务**的实际语义（是重注册还是新增）？需一次实测。
3. ✅ `.test/{seed,home}` 布局已落地（2026-09-24 清理）：迁移完成，旧 `.tests/`、`.dsh-test*/` 已删除；bun distro 产物 rig `bun-test` 同批建立（always-clean home，见 `.test/README.md`）。
4. ❓ 长期 `home/compat/` 的 session schema 版本清单由谁维护（建议每个 rig README 承载）。

---

## 附录 A：事实锚点（源码位置，便于复核）

- pnpm 透传与 DSH 自有子命令：`apps/cli/src/plugin.ts`
- 安装/卸载/reconcile/回滚：`packages/boot/plugin-manager/src/operations.ts:62,88,143,464`
- hmr 行与开关：`packages/bundle/base/cordis.patch.yml:27-31`
- 配置热重载实现：`packages/boot/hmr/src/watch-config.ts`、`packages/boot/hmr/src/index.ts`
- client hmr：`packages/bundle/web-app/cordis.patch.yml:183-184`、`packages/client/hmr/src/`
- platform seed（客户端运行期提供者）：`packages/client/web/src/seed.ts`
- 客户端外部化名单：`better-dsh/scripts/build-client.ts` 的 `CLIENT_EXTERNALS`
- 客户端 typecheck lane：`better-dsh/tsconfig.client.json`

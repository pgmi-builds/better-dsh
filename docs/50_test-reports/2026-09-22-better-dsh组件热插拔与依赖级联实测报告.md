# better-dsh 六组件热插拔（Cordis HMR）与行间依赖级联 实测报告

- 日期：2026-09-22
- 问题：better-dsh 是否可热插拔（cordis HMR）？六个组件行是否逐个可热插拔？若组件间存在依赖，关掉被依赖组件时，依赖方是自动关闭还是留在 active 里运行时出错？
- 测试环境：Dev/Test 1 实例 **4988**（`DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`，harness 0.1.6-alpha.2 + better-dsh 0.2.4，与 prod 3080 同版），systemd `dsh-4988-test.service`
- 结论：**全部可热插拔（零重启）**；**六个组件行无一例外**；**行间不存在 inject 边，因此关闭任一组件不会级联关闭其他组件**（诊断见 §四）

---

## 一、机制事实（源码锚点）

### 1.1 行开关 = 写 profile 用户层 patch + 活体重算

- `Plugins` 页的行开关落到 `PluginManager.setPluginEnabled`（`upstream/deepseek-harness/packages/boot/plugin-manager/src/index.ts:302`）：写 `{id, disabled}` 到 `profile.patchPath`，再 `reload()`。
- `writePluginEnabled`（`packages/boot/plugin-manager/src/patch.ts:14`）用 yaml Document **原地改最后一个同 id 行**（有则改 `disabled`，无则追加），保留注释与其余字段；本实例对应文件 `.dsh-test/profiles/web/cordis.patch.yml`。
- `reload()` → `reconcileProfilePatches`（`packages/boot/app-boot/src/index.ts:251`）：把完整 patch 列表`entry.update()` 进根 Include 行，然后 `ctx.loader.await()` 等激活收敛——**在同一个进程里 unmount/mount**。
- `change()`（`plugin-manager/src/index.ts:557`）里 `application` 的取值由是否在场决定：`ctx.get('hmr') !== undefined ? 'applied' : 'restart-required'`。即**没有 hmr 服务的 profile，开关仍写盘，但要重启才生效**。
- 反向兜底：`dsh-hmr` 也 watch profile patch 文件本身（`packages/boot/hmr/src/index.ts:215`，watch `profile.patchPath` + `$DSH_HOME/cordis.patch.yml` + profile `package.json`），所以**手改这些文件同样热生效**，不必点 UI。

### 1.2 什么被 watch，什么不被 watch

- `packages/bundle/base/cordis.patch.yml:28-32` 给 hmr 行配的是 **`root: []`**（注释原文 "Profile configuration reloads by default; module roots are opt-in."；`HmrConfig` JSDoc："an empty list leaves only explicit configuration watches"）。
- 推论：**只有配置面热**。改 better-dsh 的 `lib/*.js` 不会触发 host 侧重载，必须重启（除非显式给 hmr 配非空 `root`）。
- client 面：整套客户端是**一个 bundle**（`package.json` 的 `dsh.client`），不按组件拆；`client-hmr`（`packages/client/hmr/src/index.ts`）是 host 侧 500ms stat-poll 每个 graph 行的 client bundle + SSE 推 `rebuilt`，浏览器侧换模块——**行开关不碰 client bundle**，客户端靠"页面全局缺席即休眠"降级。

### 1.3 组件行的定义

页面上的"组件" = bundle patch 的 **insert 行**（`declaredRows()`，`plugin-manager/src/index.ts:447`）；非 insert 行只进 `overrides`，页面不列、不可单独开关。

`better-dsh/cordis.patch.yml:19` 起共 **6 条 insert**：

| 行 id | 模块 | 源码 inject |
|---|---|---|
| `dashr-repl` | `better-dsh` | `['tools']`（`better-dsh/src/index.ts:132`） |
| `dashr-url-schemes` | `better-dsh/url-schemes` | `['tools','fs','skills','subagents','sessions','settings','agents','sessionPersistence']`（`better-dsh/src/url-schemes/index.ts:78`） |
| `dashr-failover` | `better-dsh/failover` | `[]`（行内 `ctx.inject(['settings'])`，`better-dsh/src/failover/index.ts:43`） |
| `dashr-compaction-tuning` | `better-dsh/compaction-tuning` | `[]`（行内 `ctx.inject(['settings'])`/`['compaction']`，`better-dsh/src/compaction/index.ts:56`） |
| `dashr-web-trust` | `better-dsh/web-trust` | `[]`（行内 `ctx.inject(['webServer'])`，`better-dsh/src/web-trust.ts:180`） |
| `dashr-mobile` | `better-dsh/mobile` | `[]`（行内 `ctx.inject(['webServer'])`，`better-dsh/src/mobile/plugin.ts:29`） |

override 行 4 条：`compaction-basic` / `command-compact` / `tool-result-pruner`（再启用）+ `connection`（fence）——**不是组件**，页面无法开关。

---

## 二、实测方法

1. 备份 profile 用户层 patch：`.scratch/cordis.patch.yml.bak-hotplug-probe-1790010496`。
2. 取本 boot token URL（`.scratch/.4988-url`），`curl -c jar -L` 拉 served HTML 作为 boot script 双腿探针（基线 `http=200 bytes=36031`；`__DASHR_MOBILE__ 2`、`__DSH_TRANSPORT__ 1`、`ios-zoom-font-floor 1`、`zoomGuard 2`）。
3. 逐行 `plugin_manager set_plugin {enabled:false}` → 读 `list_plugins`（`enabled` / `fiberPhase`）→ 再 `{enabled:true}` → 复读。
4. 全程以 `ChangeResult.application` 判定是否热生效；`restart-required` 与 `applied` 互斥可验。
5. 收尾：从备份还原 patch 文件并复验 composed 状态与 served HTML。

---

## 三、实测结果

### 3.1 逐组件 off → on（全部 `{"changed":true,"application":"applied","warnings":[]}`）

| 行 | off 后 `fiberPhase` | on 后 | 副作用探针 |
|---|---|---|---|
| `include:dashr-mobile` | `null`（enabled:false） | `active` | served HTML：`__DASHR_MOBILE__` 2→**0**→2、`zoomGuard` 2→**0**→2、`ios-zoom-font-floor` 1→**0**→1；`__DSH_TRANSPORT__` 恒 1（web-trust 腿不牵连） |
| `include:dashr-web-trust` | `null` | `active` | `__DSH_TRANSPORT__` 1→**0**→1；mobile 腿恒 2（互不牵连） |
| `include:dashr-failover` | `null` | `active` | — |
| `include:dashr-compaction-tuning` | `null` | `active` | — |
| `include:dashr-url-schemes` | `null` | `active` | off 期间 read/grep/edit 回落原生语义仍可用（`read`/`grep` 复验通过）；核心行全程 `active` |
| `include:dashr-repl`（核心） | `null` | `active` | off 时同页 `list_plugins` 里**其余 5 行全部保持 enabled:true / active**；eval 工具随行卸载，重开后 `eval` 恢复（复验 cell 跑通，pad 命名空间由 turn-1 快照恢复） |

- 用户层 patch 形态（以 mobile 为例）：`- id: dashr-mobile` + `disabled: true`（关闭）→ `disabled: false`（打开），原地改写、注释保留。
- **零重启**：全程 `application:"applied"`，无 `restart-required`。

### 3.2 收尾复原

- `diff` 备份 vs 现文件：**逐字一致**（`cp` 还原 + `RESTORED IDENTICAL`）。
- served HTML 回基线（2 / 1 / 1 / 2），`list_plugins` 六行全 `enabled:true / active`。
- NOTE：`writePluginEnabled` 的语义是"改最后一次匹配行，否则追加"，所以 probe 期间会给 `dashr-web-trust`/`dashr-failover`/`dashr-compaction-tuning`/`dashr-url-schemes` 追加 `disabled: false` 覆盖行、并给 `dashr-repl` 行补 `disabled: false`；**这些都只是 probe 残留，已随备份还原清除**。正常 UI 使用中，用户关闭过的行会留下 `disabled: false` 覆盖行，这是该实现的设计行为（幂等、语义无变化）。

---

## 四、行间依赖与级联：结论与通用语义

### 4.1 better-dsh 六行之间：不存在依赖边，无级联

- **实测**：关任一组件时其余五行保持 active（含关核心 `dashr-repl` 的那一刻）。
- **静态**：六行 `inject` 只声明 host 服务；行内动态 `ctx.inject([...])` 也是 host 服务（`settings` / `webServer` / `compaction`）。全包 grep **无 `provide()`**；唯一被提供的服务 `replRuntime` 由核心行自己 `ctx.plugin(DashrRuntime)` 注册、并由**同一行**的 `ctx.inject(['replRuntime'])`（`better-dsh/src/index.ts:966`、`:997`）消费——是**行内边**，随行一起销毁/重建，不跨行。
- **唯一跨组件耦合**是模块级单例 `native-capture`（`better-dsh/src/native-capture.ts`，capture-before-mask）：核心行的 wire mask 监听器第一步自己调 `captureAllTools`，url-schemes 行缺席也照常；反之 url-schemes 缺席时核心的 eval/委派桥正常。这是**共享 ESM chunk，不是 cordis 服务边**，因此不参与 fiber 依赖计算。
- 组件行关闭后的降级形态是设计内且 fail-open 的（见 `docs/specs/plugins-page-components/spec.md` §五 / §Out of Scope）：url-schemes 关 → read/write/grep/glob 回落原生；failover / compaction-tuning 关 → 其 client 设置卡仍在但无消费者；mobile / web-trust 关 → 页面全局缺席，客户端惰性。

### 4.2 若真存在 inject 边：消费方**自动挂起（PENDING）**，不是留在 active 里运行时崩

Cordis fiber 的依赖语义（`upstream/deepseek-harness/vendor/cordis/src/fiber.ts`）：

- `_refresh()`（`:611`）把消费方的 epoch 由"每个 inject 服务提供者 fiber 的 uid 串"决定；provider 消失（`reflect` 删 impl 后 `notify` → 各依赖 fiber `_refresh()`，`vendor/cordis/src/reflect.ts:277`/`:314`）→ epoch 变 `INACTIVE`。
- `_setEpoch()`（`:625`）在 epoch active→INACTIVE 时调 **`_unload()`**（`:675`）：跑完该 fiber 全部 disposer、撤销其全部注册（工具、事件、slot…），状态落到 **`PENDING`**。
- provider 回来 → epoch 变有效 → **`_reload()`**（`:646`）重跑 plugin `apply`。即 **自动关 + 自动开**。
- 启动/重算期把这状态报成 `pending (waiting for service(s): X)`（`packages/boot/app-boot/src/index.ts:795`、`:826`）；preset 挂载审计里是 `... waiting for X`（`packages/preset/agent-presets/src/mount.ts:322`）。

**重要副作用（本次新发现，源码推导，未做破坏性实测）**：`reconcileProfilePatches` 把重算后新出现的非 ACTIVE 条目判为 introduced failure 并 **throw**（`packages/boot/app-boot/src/index.ts:268`；`inactiveEntries` 遍历全部 loader 条目、非 ACTIVE 即计入，`:769`）。因此"关掉被依赖组件"这一次 toggle 的返回会是 **`application:"failed"` + diagnostic（点名 pending 的依赖方）**，而盘上的 `disabled:true` 已经写入且运行时确实已挂起依赖方——即用户看到的是**开关报错 + 依赖方变 pending**，而非静默坏掉或"留在 active 里崩"。

**例外：用 `ctx.get()` 的消费方不参与依赖计算**，provider 消失时它**留在 active**、运行时自行降级或报错。本插件内就有这种形态：`better-dsh/src/compaction/index.ts:116`/`:151` 的 `ctx.get('llm')`/`ctx.get('compaction')`、以及 plugin-manager 自己 `ctx.get('hmr')`（缺 hmr 就退回 `restart-required`）。

---

## 五、边界与未验证

- **代码面默认不热**：`hmr` 行 `root: []`，默认部署下改 `better-dsh/lib/*.js` 不触发热重载。**但 opt-in 后可用**，见 §七（同日追加轮实测）；prod 安装态的不可热性为源码推导，未实测。
- **client 半不按组件拆**：行开关只影响 served HTML 注入腿；client bundle 需重建 + `client-hmr` stat-poll 才会换模块。
- **§4.2 的级联失败路径为源码推导**：本 profile 内没有"两个都可开关、且其一 inject 另一个"的行对（六组件间无边；host 侧 provider 行多为 `management-required` 或动它会打断本 session），故未做破坏性 live 验证。若日后需要实证，最小实验是造一对测试行（provider + `inject:[...]` 消费方）在同一 bundle patch 里，关 provider 观察消费方 `fiberPhase` 与 `ChangeResult`。
- 本次实测在 Dev/Test 1（4988）；prod 3080 未动。

---

## 七、追加轮（2026-09-22）：代码热替换（module HMR）实测 ✅

**更正前文口径**：§1.2 的"只有配置面热"是**默认部署**的结论，不是 DSH 的能力边界。给 hmr 行配非空 `root` 后，**改插件代码会活得即时重载**。同实例（4988）实测：

1. profile 用户层 patch 追加：`- id: hmr` + `config: { root: [/…/packages/better-dsh/better-dsh/lib] }`（hmr 行自重配，组合照常收敛，served HTML 标记不变）。
2. 在构建产物 `lib/mobile/plugin.js` 给注入脚本加可观测标记（`raw + "\n/*hmrprobe*/"`）。
3. 无重启 `curl` 鉴权页面：`hmrprobe` **0 → 1** —— 进程清模块缓存、重新 import、重新 apply 该行插件。
4. 还原文件：`hmrprobe` **1 → 0**，文件字节一致；随后摘掉 hmr `root` 覆写，patch 文件回基线（`diff` 逐字一致），页面标记回 `mobile=2 / transport=1`。

**为什么 dev rig 能热、prod 安装态不能**（源码锚点，`packages/boot/hmr/src/index.ts`）：上游把可重载单元定义为"用户代码"，`loadDependencies` 与变更分类都硬排除 `/node_modules/`（`:70`、`:357`），reload 判定只认"依赖树里含 accepted 文件"的插件（`:441-453`）。prod profile 里插件 realpath 就在 `node_modules` → 依赖列表为空 → 永不重载；dev rig 的 `node_modules/better-dsh` 是指向 monorepo 的 symlink，Node ESM 解析到 realpath（无 `node_modules` 段）→ 可重载。§七步骤 3 的成功本身反向印证了这一点。

**已知粒度风险（未实测）**：`partialReload` 只重载"accepted"模块，一次 `tsdown` 全量重建会改 chunk 文件名，可能出现新旧 chunk 混装的中间态；手工改单文件很干净。

机制详述与开法见 dev doc：`~/workspaces/superd/docs/02-dsh/plugin-row-hot-plug.md` §2。

---

## 六、相关文档

- 组件拆分设计：`docs/specs/plugins-page-components/spec.md`
- 前序实测（拆分 + 真 UI 开关往返）：`docs/50_test-reports/2026-09-17-plugins页六组件拆分实测报告.md`
- 插件机制速查：`docs/60_exploration-and-research/05-dashr-dev/plugin-development.md`
- override 三条硬边界 / patch 层序：根 `AGENTS.md` §四

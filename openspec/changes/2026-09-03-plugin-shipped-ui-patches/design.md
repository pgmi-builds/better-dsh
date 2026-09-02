## Context

- **user 裁决（2026-09-03）**：两个 UI patch 不再走本地 patch（含 prod），改随 better-dsh 插件发布。前置三个研究问题（patch 线 / UI 插件 / override 机制）已全部源码核验。
- 研究基线：upstream checkout `dsh-v0.1.2-alpha.5`；两份研究文档（agent-harness workspace 的 slot-system 与 profile-package-map）结论与 alpha.5 源码复核一致处直接引用，漂移处以源码为准。
- alpha.3 遗产（memory 2026-08-28 取证）：所谓 "loopback auth patch" 实为 **prod vendored 文件手改**——`dsh-client-connection` 的 `isLoopbackHostname`（`/api` 浏览器信任栅栏）放宽 127/8 ∪ 192/8 ∪ `*.randomhash.app`，index.js 与浏览器 bundle client.js 双侧改；升级即丢。记录位 `~/workspaces/base/50_AI-Facility/07_dsh-agent/dsh-patches.md`。

## 研究结论（三问，一手源码）

### Q1 — 声明式 patch 线：存在，且就是官方扩展面

`cordis.patch.yml` 是**分层的行级 patch 系统**（`packages/boot/app-boot/src/profile.ts` + vendored `include` 的 `applyEntryPatches`）：

- 行 schema（`vendor/loader/src/config/entry.ts` `EntryOptions`）：`{ id, name, config, inject, disabled, group }`。`name` 是模块说明符（包名或路径）；改 `name` 触发重新 import（`Entry.update` 对 `name`/`inject`/`group` 的 diff 走 replace 分支）。
- 层序（`docs/user/develop/basic/publish.md` + `architecture.md`）：空表上依次应用 profile `dsh.profile.bundles` 列出的各 bundle patch → profile 级 `cordis.patch.yml` → home 级 → `--patch` overlay。**后来的层可按 `id` 覆盖前面层的行——必须整行重述，不是增量合并**。官方先例：`dsh-web-app` bundle 覆盖 `dsh-base` 行；**dashr 自己已在用**（`dashr/cordis.patch.yml` 对 compaction 三行 `disabled: false` 反转 web-app 的禁用）。
- `!!js` 表达式在 boot 时求值，可读 `process.env` 与 loader 上下文里的服务。dashr 先例：`python: !!js process.env.DASHR_KERNEL_PYTHON ?? 'python3'`。
- `dsh --dump-config` 可预览合成结果（vendored `applyEntryPatches` 导出即为此服务）。

**对 presets/features/settings 的含义**：agent preset、feature、settings 全部是插件行的 `config`，因此全部 patch-线可达。P2 的 alpha.5 正解就是一条 patch 线（见 D2）。

### Q2 — UI 插件：路径已验证（FailoverRow 首演），且 CSS 注入是一等公民

- `dsh.client` 声明（package.json `dsh.client`：`platform: "web"` + `inject`/`external`/`immediately`）→ host 侧 `ClientModuleRegistry`（`packages/client/modules/src/index.ts`，服务名 `clientModules`）扫描 loader 条目、解析 `exports['./client']`、把行并入 boot graph、从 `/plugins/<pkg>/client.js` 服务 bundle。v0.2.1e 已全链路走通（boot graph 含 `@pgmi-builds/better-dsh`、URL 字节一致）。
- 浏览器侧 `cordis-client-runner` 再起一套 cordis，逐插件跑 client 半的 `apply(ctx)`；组合走 `ctx.slots`（`SlotMap` 声明合并、`register`/`renderSlot`）。
- **CSS 注入被模块系统官方认领**（`system.ts` `claimStyles`）：工厂执行期注入的 `<style>` 自动打 `data-plugin` 归属标记并纳入 HMR 记账——插件注入样式是设计内行为，不是黑魔法。

### Q3 — override：三层机制，各有精确边界

**(a) 浏览器模块表（同 id 覆盖）= 硬错，无 last-wins**

- client 侧（`system.ts`）：`duplicate graph entry "<id>"` 直接 throw；已注册 factory 再注册 = `duplicate factory registration` throw。注释明言这是"bundle purity gate 的运行时镜像"。
- host 侧（`index.ts` `reconcilePackage`）：同一包名从多个活跃 loader source 解析 = `remove one entry` 硬错。
- 结论：**不可能用同名包在 boot graph 里遮蔽原生模块**。

**(b) npm 同名包 = 死路（作为遮蔽机制），但解析引擎本身是 patch 线的执行器**

- `@deepseek-ai` scope 归上游所有，npm 发不了同名包。
- host 侧 require 从 ②③ 层（profile/全局树）出发，插件嵌套 ① 层无法遮蔽宿主自己的 import（2026-09-02 已实证 14/14 从 ②③ 解析）。
- npm 解析真正有用的位置：patch 行的 `name` 经 loader 的 ESM resolution（`internal.resolveSync(baseUrl, specifier)`，baseUrl = 所属 entry tree）落到具体文件——**行的代码来源由解析决定，行本身由 patch 层决定**。pnpm `overrides`（用户侧 workspace 配置）可做包替换，但那是部署者操作，不是插件可随发的面。

**(c) cordis 层："closest wins" 的确切语义 = 祖先链遮蔽；同 scope 同名 = 硬错**

- `vendor/cordis/src/reflect.ts`：service 解析从消费 fiber 沿 `fiber.parent` 链上行找 `fiber.store[prop]`，**最近的祖先 provider 胜出**；跨 isolate 边界即停。所以"closest wins"只服务于 (i) 祖先插件为子树提供的实现、(ii) isolate scope 内的局部遮蔽——**兄弟插件之间不存在遮蔽**。
- 同 scope 重复 `provide`：`service "x" has been registered at <...>` 硬错（加载期即炸）。
- 非官方后门（记录备查，本 change 不用）：`internal/get` 是 waterfall 事件，任何插件可监听并短路全局 service 解析。真实存在但属框架内部协议，上游无稳定性承诺。

**(d) 官方 UI 组件覆盖面 = slot 优先级遮蔽（本研究的正面发现）**

`packages/client/ui-slots/src/index.ts` `SlotCore.register`：

> Shadowing (single/keyed/list): entries sharing one cell … coexist at distinct priorities, sorted ascending … **the cell's lowest live entry renders**. A second registration at an occupied cell's exact priority (default 0) throws … so priority-less composition keeps the historical one-occupant-per-cell fail-loud.

即：**以更低 priority 注册同一槽/key/id 即可官方遮蔽原生组件**（lowest renders）；同优先级才冲突报错。single（整个槽）、keyed（同 key）、list（同 id）三 kind 都支持。这给了 P3 一条"CSS 不够时"的正规升级路径（如整体遮蔽 `sidebar` 槽组件），但首版不需要。

**(e) 官方整插件替换面 = patch 行 id 重述 + name 重指**

patch 行按 id 覆盖时可改 `name`（重指到 fork 包或本地路径）——上游文档明示用户层可如此覆盖任意行。这是"换掉整个原生插件"的正规入口，同样超出本 change 需要，记录为机制结论。

## Goals / Non-Goals

- Goals：P2/P3 以插件随发形态落地；alpha.3 手改 patch 退役路径明确；4999 症状复诊；机制知识沉淀进 skill。
- Non-Goals：不动上游认证语义（fence 只加授权，不改判定算法）；不做通用移动端改造（仅侧栏 + 手势）；不用 `internal/get` 后门；不做整插件 fork/替换（机制已记录，无当前需要）。

## Decisions

### D1 发布面反转（user 裁决）

两特性随插件发布：P3 config 门控默认开（`mobile.enabled`，阈值可调）；P2 env 门控惰性（无 `DSH_TRUSTED_HOSTS` 时行为与原生完全一致）。原 deferred 两 change 的"不随 dashr 发布"条款作废。

### D2 P2 = bundle patch 覆盖 `connection` 行（上游注释明示的扩展式）

alpha.5 已把栅栏服务端化 + 配置化：`dsh-client-connection` 行 config `trustedHosts`（`z.array(String)`），`isTrustedApiRequest` = loopback ∪ trustedHosts ∝ 同源 Origin 检查；CLI `--trusted-host` 经 web-app bundle 汇成 `webRuntime` 服务，行内以 `!!js ctx.webRuntime.trustedHosts` 消费（`packages/bundle/web-app/cordis.patch.yml` `id: connection` 行，注释原文："A deployment adding authorities keeps this expression and concatenates its literals, for example: `['app.internal', ...ctx.webRuntime.trustedHosts]`"）。

dashr bundle patch（列序在 web-app 之后，层序天然胜出）追加：

```yaml
- id: connection
  name: '@deepseek-ai/dsh-client-connection'
  inject: [webRuntime]
  config:
    trustedHosts: !!js [...(process.env.DSH_TRUSTED_HOSTS ?? '').split(/\s+/).filter(Boolean), ...ctx.webRuntime.trustedHosts]
```

- 整行重述 `name`/`inject`/`config`（官方契约）；用户 profile patch 层仍可再覆盖我们（用户优先，分层语义不变）。
- 安全语义：`DSH_TRUSTED_HOSTS` 是**信任授予决策**——每条 = 一个被授权越过 DNS-rebinding 栅栏的权威；malformed 条目由上游 `assertTrustedAuthority` 在加载期炸出（fail-loud，不静默放宽）。文档必须写明。
- ~~4999 症状复诊（任务 1.3）~~ **已钉死（2026-09-03，user 提供 prod 实测）**，见下一条腿。
- **浏览器侧 `isLoopback` 腿——病灶与修法均已定案（2026-09-03 user 两轮裁决）**：prod Models 页报 `…failed: settings are unavailable in this browser` = `ui-settings-models/store.ts:190` fallback——`ui-settings` 在 non-loopback 页面把持久化定为 `'memory'`，memory 模式 terminally unavailable、never touches the wire（`settings-mirror.ts` + 测试原话），mirror 永空 → Models 必败。**`trustedHosts` 对此腿无效**（只管服务端 fence）。**定性（2026-09-03 二次修正，上游设计笔记实证）**：`2026-08-06-host-backed-web-preferences.md` 原文——"keeps Host persistence disabled on non-loopback pages, so their preferences remain **process-local** even though Connection authenticates the complete API"：设计决策只覆盖"非 loopback 不写 Host 持久化（偏好进程本地、页面照常）"；describe mirror 把 `'memory'` 做成终态不可用（拒绝读）属实现层过度收紧，describe 依赖面 remote 全瘫是无人设计过的产物——`trustedHosts` 信任模型未传导 + mirror 过收紧，两层叠加。这正是当年源码 patch 存在的全部理由（user 裁决记录）。佐证：该报错串是硬编码 fallback（locales.ts 0 命中），同页 loadFailed 是双语文案。**user 否决 A（127.0.0.1 直访——需求本体就是其他 device 访问）与 C（上游 PR——上游关掉所有 PR，此路永久否决）**。**B 升为唯一正解且机制已验证**：
  - **B 机制（时序竞争已消除）**：插件 **host 半**监听公共事件 `webserver/index-inject`（`packages/host/webserver/src/index.ts:34`，每次 index 渲染 emit、行数据 emit 时新鲜读取），push 一行 `{ kind: 'script', placement: 'head', text }` 内联脚本（client-modules 的 queue script 即此形状）：`location.hostname ∈ config.trustedPageAuthorities` 时设 `window.__DSH_TRANSPORT__ = { ownsHost: true }`。脚本在 `<head>` 页面加载即执行——**早于一切 application bundle 物化**，connection apply 读到 ownsHost=true → `isLoopback=true`；不带 fetch/openStream → `createWebConnectionRpc(undefined, undefined)` 走默认 HTTP/WS 传输（connection client apply 的可选链已核验）——**唯一效应就是 isLoopback 翻真**（`ownsHost` 全仓单消费点已 grep 证实）。
  - **语义**：trustedPageAuthorities = trustedHosts 的浏览器侧孪生（operator 声明"这些页面权威是我自己的机器"）；空列表 = 不注入 = 惰性。手机经 `192.168.31.130:3080`、桌面经 `dsh.pc.randomhash.app` 均恢复 settings/Models。
  - **残余风险（记录 + 对齐轮查表）**：`ownsHost` 属 off-label 使用（其文档意图是 worker shell 传输所有权）；若上游未来新增 ownsHost 消费点，行为面可能变宽——S7 查表项盯 connection client 的 ownsHost 消费点。inline script 无 CSP 障碍（queue script 本身即 inline）。

### D3 P3 = client 半边 CSS 覆盖 + 增量手势（对齐上游 CSS 化范式）

上游事实（`ui-layout`）：

- 三列框架 `AppFrame` 以**内联** `gridTemplateColumns: ${sidebar}px minmax(0,1fr) ${details}px` 求解（`columns.ts` 纯函数 concession 链）；框架 div 带语义属性 `data-sidebar-collapsed` / `data-details-collapsed`。
- 窄视口（< `SIDEBAR_AUTO_COLLAPSE` = 1024）自动折叠侧栏到 **56px rail**（`SIDEBAR_COLLAPSED`）——"closed = rail，永不为 0"正是要覆盖的行为；手动 toggle 在窄视口翻转 `narrowExpanded`（overlay 式再展开）。
- 视口 < 920（280+0+640 链）时 details 必然自动关闭 → 手机档模板确定是 `56px minmax(0,1fr) 0px`。
- **上游没有任何滑动手势代码**（全 client UI 包 grep 证实）→ 手势是纯增量。

设计：

- **CSS**：client bundle 注入 `<style data-plugin-css="dashr-mobile">`，媒体查询（≤ 断点）+ `[data-sidebar-collapsed]` 属性选择器 + `!important` 覆盖内联 grid template → 侧栏轨 0；rail 内容 overflow hidden。断点取上游 1024 对齐（配置项留阈值）。920–1023 区间 details 可能开着的模板冲突：限定 `:not([data-details-collapsed])` 之外仍不确定宽度 → 首版接受"手机档完美、平板窄档保守"（见任务 2.2 验证矩阵）。
- **手势**：document 级 pointerdown/move/up 监听，判定 = 起点（边缘带内）∧ 距离 ≥ 阈值 ∧ **速率 ≥ 阈值**（位移/耗时）；命中即 `ctx.layout.toggleSidebar()`（窄视口语义 = 翻转 `narrowExpanded`）。速率判定纯函数化（可单测）。忽略可交互元素起点（链接/按钮/输入）。
- **落点**：并入现有 client 入口（`dashr/src/client/`），`ctx.effect` 生命周期托管；配置进 dashr 行 config（`mobile: { enabled, breakpoint, swipeDistancePx, swipeVelocityPxPerMs }`）。

### D4 手改 patch 退役

prod 升级 alpha.5+ 时：fence 面 = 本 change 的 patch 线；`dsh-patches.md` 的 isLoopbackHostname 条目标记 retired（Caddy cookie gate / Host 重写等部署侧不变）。升级前在 4999 预演（upstream-alignment 流程）。

## Risks / Trade-offs

- **行形状漂移**：上游改 `connection` 行的 `name`/`inject`/子 config 键 → 我们的整行重述会回写旧形状。缓解：进 upstream-alignment S7 查表项（diff `web-app/cordis.patch.yml` 的 connection 行）。
- **信任面扩大**：`DSH_TRUSTED_HOSTS` 误配 = 授予栅栏越权。缓解：fail-loud 校验（上游）+ 文档明示语义 + 空值惰性。
- **CSS 覆盖内联样式**依赖 `!important` 与语义属性存活；上游 DOM/属性演进可能破。缓解：属性选择器为主、少挂类名；S7 查表加 AppFrame 属性项；破时退化 = rail 复现（非崩溃）。
- **P2 病因未证**：若 4999 复诊显示与 fence 无关，D2 仍成立（官方配置面替换手改 patch），但症状修复需另寻触点——任务 1.3 有明确出口。

## Open Questions

- ~~4999 P2 的真实病因？~~ **已钉死（2026-09-03）**：prod 实测消息后缀 `settings are unavailable in this browser` = 浏览器侧 isLoopback 门（memory 持久化终态不可用），见 D2；4999 若经非 loopback 拼法访问则同族。剩余待证仅"4999 当时访问拼写"，不影响机制结论。
- `ui-settings` memory 持久化在 domain 访问下的实际损失面？（任务 1.4 评估，可能催生后续 change）
- 平板窄档（920–1023）details 开启时的模板共存策略？（任务 2.2 验证后定：接受保守 or 精细选择器）

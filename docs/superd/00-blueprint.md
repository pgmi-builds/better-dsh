# Super D (superD) 开发蓝图 v0.4

> 2026-09-06 · 由 grilling Q&A（4 轮）收敛而成。全程决策记录见 §9。
> 2026-09-08 v0.2 修订：前端 UI 策略重构——弃"全量字段大全包"，改为与后端 Agent Adapter
> 对偶的 Agent UI Adapter 组合层（§3.5）；组件级边界与包 roster 见 `01-component-boundaries.md`。
> 2026-09-08 v0.3 修订：DSH 面全透传 + routing mux 裁决（§3.6，token/cookie 认证链源码级
> 取证）；品牌 MVP 不动；selector 定位"品牌与 New Session 之间"（§3.7）。
> 2026-09-08 v0.4 修订：selector 移位侧栏底部 footer 区——落位现成 list 槽 `sidebar.footer.action`
> occupant（Settings 上方），**撤回 superd-sidebar copy**，ui-sidebar 回归中性底座（§3.7，决策 #24）。
> 引用研究（2026-09-08 去重后路径）：剥离边界 / 后端数据盘点 / wire 附录 → `02-dsh/`，
> iOS bridge → `03-mobile-ios/`（镜像自 dashr 研究集）；异构运行时 SDK 调研（六家，含
> Codex/Hermes）→ `research/research-heterogeneous-agent-runtimes.md`（superd 专属）；
> 深层引用 dashr 仓 `docs/60_exploration-and-research/`（package map、slot system、composability）。

---

## 1. 定位与命名

- **是什么**：多 Agent 运行时的统一入口（桥接层 / UI-BFF）。Super D **不提供** Agent 运行时——它把
  本机与远端机器上已存在的各类 Agent 运行时，统一映射到 DSH Web UI 可消费的数据面。
- **不是什么**：不是 DSH 的 fork/profile，不 vendor 修改上游源码；不含自己的模型调用链。
- **命名**：App 名 **Super Dash**，品牌/简称 **Super D**，CLI 与代码标识 **superd**（无空格无连字符）。
  npm：顶层 unscoped `superD`（主发布名）+ 私有 scope（`@pgmi-builds/*`）用于 adapter 子包。
- **品牌原则**：只有自研代码用 Super D 品牌（App 标识、Machine 标识、自有 UI 组件）；
  上游包内的 DSH/Web UI 名称原样沿用；runtime 名称（DSH、OMP、Claude Code…）照实显示。
  brand 槽（`brand.mark`/`brand.name`）**MVP 不替换**（v0.3）：沿用当前激活 runtime 的上游品牌，
  切换 runtime 也不改页面品牌；后续各 composition 填各自 runtime 品牌，Super D 自有品牌延后引入。
- **形态**：独立 App。安装后即使机器上没有任何 Agent 运行时，服务器照常起、UI 照常访问（内容为空，
  可连 remote）。本地无 runtime 时它就是一个壳——这是特性不是缺陷。

## 2. 架构

```
浏览器（DSH Web UI 中性底座原样复用 + per-runtime Agent UI Adapter 组合层，见 §3.5）
   │  4 条 wire 契约（剥离研究 §1.3）：①静态资产 ②boot graph ③/api unary ④WS mux
   ▼
superD 服务器（端口 3090，唯一 origin、唯一认证面）
   ├─ Cordis 核心（自举）：入口 CLI `superd`，第一个插件即 superd 主插件
   ├─ 载体插件（上游原样）：webserver / frontend-static / client-modules / connection / gateway
   │    （WS traffic 与 connection 全部交由上层/上游处理）
   ├─ superd 自有插件：
   │    · Provider Registry（RuntimeProvider 统一接口，见 §3）
   │    · Machine Manager（local/remote 清单、连接池、探测）
   │    · Session Pairing（配对表，见 §4）
   │    · Selector UI patch（multi-agent selector，见 §6）
   │    · Composition Registry（per-runtime UI 组合选择，见 §3.5）
   │    · Routing Mux（/api namespace 分流：superD 自有面本地应答，其余透传 active adapter，见 §3.6）
   │    · AuthChain（预留中间件链，见 §7）
   │    · Consumers（TG 等 messaging channel，M2+，见 §8）
   └─ Adapter 插件 ×N（各自独立 npm 包，Provider 类别注册）
```

- **分界点**（剥离研究裁决）：浏览器半 + 4 条 wire 契约是保留层；**SessionController 及其下的
  TypertRemoteService 命名空间实现是替换层**——由 superd 的 Provider Registry + 各 adapter 接管。
  替换层形态是 **thin routing mux** 而非全量重实现：superD 自有 namespace 本地应答，其余按
  active adapter 透传/翻译（DSH 面全透传，见 §3.6）。
- **前端分界点**（v0.2 裁决）：浏览器侧会话面 UI（chat/conversation/session/…）从"单一全量 UI"
  改为 per-runtime Agent UI Adapter 组合层——同一时刻仅一个 composition 激活，随 selector 整组
  换装；中性底座（slots/renderer/layout/sidebar/theme/settings 壳）原样复用（§3.5）。
- **骨架形态**：最小 cordis 宿主（研究 §2.4 变体升格为主线）。进程形态与 DASH 同构：入口起 cordis
  核心，自举 superd 插件，bundle 上游载体组件。理由：WS mux 帧格式无兼容承诺，复用 gateway 让
  wire 面 100% 原样、升级跟随 upstream；该层"无稳定性承诺"的风险被锁版策略对冲（§5）。

## 3. Adapter 体系（RuntimeProvider 统一接口）

- **一套标准、统一出口，不分 proxy/translate 类型**。所有 adapter 做的都是"桥接"：把上游 runtime
  能提供的字段/事件映射到 superD 标准字段（DSH SessionEvent 词汇）。DSH adapter 今天实现为
  wire 级转发，明天上游 breaking change 时在 adapter 层消化翻译——对下游消费层始终同一接口。
- **能力协商靠"两半"注册**：adapter 声明上游有什么数据字段（observable 字段注册），UI 侧按在场
  字段渲染；缺字段 = 空，不崩、对应 element 隐藏。DSH Web UI 的降级容错是设计内行为（事件子集
  可任意裁剪，`request/header` 缺失有显式占位；roster/patch 两级披露旋钮）。
- **桥接范围**：能桥尽桥——会话列表/新建、消息流（含 WS streaming）、agent 状态 check、模型列表/
  选择器、settings 面（可自定义增页）、附件、slash 命令、技能（slash 调出）。以 OMP Web 经验为准，
  各 runtime 用户交互面共性远大于差异。
- **UI composition 随 selector 切换**：字段在场制（两半注册）保留用于**同一 runtime 内**的降级
  容错；**跨 runtime 形态差异**由 Agent UI Adapter 组合层承接（§3.5）——切换即整组换装，而非
  往单一全量 UI 里叠字段。
- **接入层选型**（依 `docs/research/research-heterogeneous-agent-runtimes.md`）：优先 SDK 或厂商
  官方协议面（app-server / stream-json / serve RPC），ACP/CLI spawn 作回退；A 档四家
  （Claude Code / Codex 等）SDK 自带引擎、独立 API key、可与用户全局安装完全隔离共存；Hermes
  无官方 SDK（B/C 档），只能协议桥或源码 import，与用户共享 `~/.hermes` 现场需 profile 隔离。
- **5 个 adapter 与排序**（第一期 OMP 打头）：
  1. **DSH**（参考实现，最薄：**全透传**——session / workspace / settings 三个面同 wire 协议逐帧
     转发 unary + WS mux 到目标 machine；UI 与上游锁死同版 ⇒ 数据面契约逐字节相同；认证走服务端
     token→cookie 注入，见 §3.6）
  2. **OMP**（第一期主力：复用 `~/workspaces/dsh-omp/apps/omp-web` 现成桥接——`agent.ts` 事件映射表、
     `rpc.ts` spawn `omp --mode rpc` NDJSON/stdio、union persistence、`pairing.ts`；差异点：omp-web 是
     "替换原生"（disable agent-loop/llm-*），superD 需要**多 runtime 并存**）
  3. **Pi**（与 OMP 同系，源码大部分共用，独立注册）
  4. **Claude Code**（A 档：SDK 捆绑官方 core，stdio/JSON-RPC 子进程驱动；独立 API key，不碰用户登录态）
  5. **Codex**（A 档同型；SDK 形态见研究档）
  6. **Hermes**（无官方 SDK：JSON-RPC/OpenAI 兼容 HTTP 协议面或源码 import；注意现场隔离，排序最后）
- **发布粒度**：主包 bundle 全部 adapter（装完即用，selector 直接可见）；将来数量多了再走按需安装
  （cordis patch 线现成）。
- **法律边界提示**（研究档结论）：Claude/Codex 等厂商禁止借用用户订阅登录态做产品转售——
  adapter 必须用独立 API key 认证，这是 wrapper 的合规边界。
- **Provisioning 预留**：adapter 契约留可选方法位 `detect / install / locate-isolated-instance`，
  v1 全部 not-supported；**不留配置段**（避免"写了不生效"误导）。后续两路径：辅助安装（registry
  拉取）与实例隔离安装（独立版本、与现场实例完全隔离，仅供 superD 消费——A 档 SDK 的
  "自包含引擎 + 独立认证"特性使这条路径天然可行）。

### 3.5 前端 Agent UI Adapter（与后端 Adapter 对偶）

> 2026-09-08 裁决：弃"全量字段大全包"路线（把所有 runtime 的字段/插槽往一套 UI 里累加）——
> 五个上游 runtime 更新步伐不一，全量表同步成本随时爆炸，且 superD 自有字段会与之互相污染。
> 改为前后端对偶的组合层；组件级边界与包 roster 见 `01-component-boundaries.md`。

- **对偶原则**：后端 **Agent Adapter**（数据面：runtime → superD 标准字段）↔ 前端 **Agent UI
  Adapter**（呈现面：标准字段 → 该 runtime 的 UI 形态；实现机制是插槽组合，行文亦称
  composition）。两者都是 cordis 插件，同一 selector 驱动、同组启停（一个 runtime 一对包）。
- **三条策略**：
  1. **agent-ui-dsh**：copy 一版 DSH 会话面 UI（精准锁版），完全对齐 DSH 形态——它既是 DSH
     runtime 的 composition，也是其余 composition 的**蓝本**。
  2. **agent-ui-omp / -pi / -claude-code / -codex / -hermes**：各自从蓝本 copy 成独立包、独立
     修改维护。各 runtime 会话面共性远多于差异（thinking / tool call / user prompt / agent
     response / context injection / system prompt…），从 DSH 起步后慢慢调；runtime 特有字段只改
     自己的包。
  3. **动态切换与扩展**：selector 切 runtime → 该组 composition 整组换装（cordis 插件行
     enable/disable + 前端重渲染，两档实现见边界文档 §5）；后续可加 superD 自有全页 Tab 与
     专属插槽。
- **互斥保证**：同一时刻仅一个 composition 激活（conversation.* 等槽带同 key 双注册会撞、
  list 槽会叠渲染）——由 Composition Registry 按 selector 计算互斥的插件行集合。
- **维护解耦**：Codex 字段更新 → 只改 agent-ui-codex + codex adapter；DSH Web UI 更新 → 想跟
  进就 diff 抄进 agent-ui-dsh，不跟则维持锁版；各 composition 演进节奏完全独立。这是把
  "everything is plug-in" 从后端延伸到前端的自然结论：**换 provider（runtime）= 换整组插件行**。
- **命名**：对偶名 **Agent UI Adapter**；包名 `@pgmi-builds/agent-ui-*` ↔ 后端
  `@pgmi-builds/agent-adapter-*`。

### 3.6 DSH 面全透传与认证链（v0.3 裁决）

**裁决：方案一（服务端全透传）胜出，细化为一层 routing mux；方案二（前端直连上游端口）否决。**

- **透传范围**：DSH adapter 对 session / workspace / settings 三个面全部逐帧转发——superD 的 DSH
  UI 包与上游**锁死同版**（无滞后），数据面契约逐字节一致，透传零翻译、上游新 feature 自动出现。
  superD 自有面（machines / selector / pairing 查询 / TG bindings）由 routing mux **本地应答**：按
  RPC method namespace 分流（`machines.*` / `superd.*` 本地，其余转发 active adapter）。分界不在
  "哪些面透传"，而在"哪些 namespace 属于 superD"。
- **settings 呈现纪律**：settings 面按 machine 整体呈现（切换 active machine 即切换到该 machine 的
  settings document）；superD 自有 namespace 永不与上游 namespace 合并写入——跨边界 `replace()`
  是 CAS 灾难，写操作只走各自 namespace 内的 path-op。
- **否决方案二的硬理由**（前端 JS 直连上游 3080）：① multi-machine 直接不可行——remote runtime 无
  公网面，必须经 superD 中转（决策 #17）；② cookie 是 authority-bound 的，浏览器对 3090/3080 是
  两套 authority 两套握手，HttpOnly cookie 互不可见；③ 上游 `/api` 信任栅栏要求 Origin 与 Host 同
  authority——3090 页面跨源打 3080 会被 Origin fence 直接拒（除非把 3090 域名配进上游
  trustedHosts，逆流而上）；④ 统一认证面 / 审计 / TG consumer 复用全部被打散。
- **认证链（一手源码取证：`client-connection/src/{browser-auth,rpc-host,api-request-trust}.ts`）**：
  1. DSH 每次进程启动生成 launch token（进程级随机；`authenticatedUrl()` 印在终端的 `?token=` URL）；
  2. 任何 HTTP client GET `/?token=…` → 校验通过 → 303 到 `/` + `Set-Cookie`（`dsh-auth-<hash>`，
     HttpOnly / SameSite=Strict，默认 30 天 = `cookieMaxAgeDays`）；
  3. cookie 由 HMAC-SHA256 签名，签名密钥**持久**存于 DSH credentials store
     （`credentialKey('client-connection','browser-session')`）——⇒ **cookie 跨 DSH 重启有效**，
     每次轮换的只是 launch token；
  4. 此后每个 `/api` 请求（unary 与 WS upgrade 面）过同一 `requestRejection`：Host/Origin 信任栅栏
     （loopback Host 天然过）+ `isAuthenticated` cookie 校验（authority 精确匹配）。**两道闸相互独立：
     栅栏 loopback 免**（防 DNS rebinding / 跨源浏览器请求，源码注释明言 "not an auth layer"）；
     **认证 loopback 不免**——本机 curl 冒烟也必须先走 token URL 换 cookie 即证。superD 透传过关
     靠的不是"loopback 特权"，而是手里持有 mint 出来的 cookie。
- **superD 侧落地**：machine 配置 `{name, url, token}`（§6 已预留）的 token 用于**一次性 mint**——
  DSH adapter 服务端 GET `http://127.0.0.1:3080/?token=…`，收下 cookie 存入 adapter 自己的 cookie
  jar（cookie 绑定 `127.0.0.1:3080` 这个精确 authority），此后所有 unary/WS 转发自动附带。
  **运维含义**：token 只需首次配置或 cookie 过期（默认 30 天）时提供一次；DSH 重启**不需要**换
  token。未来 provisioning 托管拉起 DSH 时可从子进程 stdout 自动读 token URL，实现零手工。
- **patch 上游去 token gate：否决**。源码确认 `BrowserAuth` 在 Connection 插件激活时**无条件**创建，
  config 仅 `trustedHosts / cookieMaxAgeDays / maxRequestBodyBytes`，无 auth-off 配置口——patch
  违背"不修改上游源码"与 user-just-another-user 部署形态，且升级要重打、remote 裸奔；仅作绝对
  兜底记录在案，不进方案。
- **superD 自身浏览器面**：复用 client-connection 原样 ⇒ 3090 自带同款 token URL + cookie 认证
  （浏览器↔superD 唯一认证面的 MVP 实现；authChain / Caddy 白名单前置，§7 不变）。

### 3.7 selector 位置与品牌呈现（v0.4 裁决，取代 v0.3 的"品牌与 New Session 之间"）

- **位置（v0.4）**：左栏**底部 footer 区**——注册为 `sidebar.footer.action` 槽的 occupant，渲染在
  **Settings 行的上方**。源码锚点：`ui-sidebar/src/client/SidebarRoot.tsx` 注释原话
  "Footer actions stack above Settings in both sidebar widths"；`footArea` 为
  `flex-direction: column`（footer 块在上、settings 块在下）。
- **为什么不能"与 Settings 同一行"**：owner（ui-sidebar）的 foot 区是垂直堆叠布局，occupant
  从槽内改不了 owner 的布局（footer.action 的 owner props 只给 `{wide: boolean}`）。多
  occupant 之间倒是横排（`footerActions` 为 row）——将来有第二个 action 会并排。**先实现先
  显示，位置观感后调**（v0.4 纪律）。
- **现成官方槽，零 copy**：`sidebar.footer.action` 是 ui-sidebar 声明的 **list 槽**（kind:
  'list'，scope: 'root'），契约注释明言 "Optional actions beside Settings at the sidebar
  foot"——正是"append 一个 Settings 附近按钮"的官方用途。实现即标准 occupant 注册：
  `ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name:
  'sidebar.footer.action', id: 'superd-agents', order }, AgentsButton))`。`wide` 两形态
  自担（宽栏 = 与 Settings 行同宽样式的按钮；56px rail = 单图标）；样式对齐 Settings 观感即可。
- **撤回 superd-sidebar copy（v0.3 #23 机制作废）**：copy 是为"brand 与 New Session 之间无槽"
  而设；selector 移位底部后不再需要——**ui-sidebar 回归中性底座原样依赖，中性底座 copy 例外
  清零**，上游 PR 路线同步撤销。v0.3 的机制结论仍有效，保留备查：① brand 与 workspaces 之间
  不可插入的原因是**该位置没有声明槽**（children 是 owner 源码结构；YAML patch 作用于插件行、
  不动包内代码、不存在方法级 patch）；② 若将来确需 owner 级改动，正道是 bundle 级整包替换
  （superD 是独立 app，装自己的 copy、不装上游包）或上游 PR；DOM 注入（与 React 树竞争父
  容器）仅 fallback。能力图谱：bundle 级能换整插件不能改包内代码；patch 行级能 id 覆盖/name
  重指/config 重述/disabled，不能动 method；`!!js` 只算 config；CSS claim / index-inject 只到
  样式与 head 层脚本。
- **品牌 MVP 策略**：见 §1——brand 槽不替换、不跟随 runtime 切换，全部沿用上游品牌；后续各
  composition 再填各自 runtime 的品牌。

## 4. Session Pairing（配对层）

- superD **不持久化任何原始会话**——全量对话数据都在上游 runtime。
- 但维护**单一统一配对表**：superD session id ↔ `{machine, runtime, upstreamId, locator?,
  consumerBindings?}`。存在 `~/.superd/pairings.json`（M1 起即此形态）。存在原因：DSH Web UI 的
  session id 格式与各上游不兼容，不可直传；配对即含寻址（如直接定位 OMP 物理文件做重放）。
- 生命周期：会话列表刷新时对上游已不存在的配对惰性 GC（标 dead 不立删，防误删）。
- Web UI 与 messaging channel 是同一会话的两条消费通道，查同一张表。

## 5. 依赖策略与构建（半构建 ready）

- **方案 B：精确锁版 + 构建期内嵌**，不提交上游源码进仓：
  - 依赖三系列：**cordis 系列**（核心，全量需要）+ **dsh-web-app 系列**（限中性底座包，roster 见
    `01-component-boundaries.md` §4）+ **@pgmi-builds/agent-ui-*** 系列（自研 composition 包，
    从 DSH 会话面源码 copy 起步、独立演进）。
  - exact-pin（无 `^`）；repo 本地 node_modules 是唯一依赖来源，**禁止解析机器全局包**（不设
    NODE_PATH、不 symlink 全局树）——开发测试与生产环境隔离，版本一致。
  - **vendor 保护**：`superd vendor verify`（tarball hash 比对检漂移）+ `superd vendor restore`
    （registry 强制重拉覆盖）——防 agent/人工误改 vendor 源码，GitHub/npm 覆盖一步复原。
  - 修改上游一律走 patch 机制 / 自有插件（cordis.patch.yml 层序），非必要不碰源码——上游升级
    随时跟进，patch 同步调整。
- **Bun 单文件可执行**：交付期 `bun build --compile`，node_modules 整体嵌入 binary（静态锚定、
  环境完整）。dev 期建议统一 bun runtime，避免 node/bun 双漂移（待 PoC 验证 bun 对上游包兼容性，
  见 §11）。
- **半构建 ready 验收**：最终产物在本机 / DEV3 / Docker / LXD container 以普通 user 试安装——
  命令行能调出、SupervisorD/systemd 能拉起、服务器能跑——为测试终点。

## 6. Machine 概念与运行时发现

- **层级**：Local（DSH, OMP…）+ Remote（DEV3-DSH, DEV3-OMP…）。无 remote 时默认连 local DSH。
- **Remote 条目 v1 仅 superD-to-superD**：remote 机器上必须装 superD（它本身是服务器），本机连其
  URL。CLI 型 runtime（OMP 等）无网络服务概念，PC 上的 superD 无法向 DEV3 的 OMP 直接发起 RPC——
  必须由 DEV3 上的 superD 起 adapter、spawn 本地 OMP，再经 HTTP 暴露。裸 runtime endpoint 直连
  将来若有需求再加 `kind: raw` 档。
- **配置**：machines 列表 `{name, url, token}`，纯 manual；remote 不做任何自动扫描（不扫内网、
  无 mDNS）。
- **本地发现（自动扫描）**：可配置启动时扫 / 定时（如每小时）扫。
  1. `which dsh` 等探测 PATH 上的 CLI（装了什么）；
  2. DSH 服务探测三步：`which dsh` → 3080 握手探针（非 DSH 应答即放弃，**不盲扫端口**）→
     扫进程树找 dsh 进程并解析 `--port` 参数（prod/测试线均显式 --port 启动；`ps e` 还可取
     DSH_HOME 标识实例）；
  3. DSH 服务是否存活由 DSH adapter 内部消化；CLI 型（Claude Code/OMP）无守护进程，探测即探测
     binary 在不在。
  - 参考 Multica 的发现方式（路径待 user 提供，届时对照修正）。

## 7. Auth（预留）

- **入站**：所有 traffic（Web UI 对 3090、TG webhook）过同一 `authChain` 中间件序列。v1 只挂空壳
  whitelist 插件（Caddy 已做 IP 白名单，插件实际什么都不做）。未来加真实 auth = 往 chain 插
  provider，不动业务层。
- **出站**：machine 连接的 token 走 `machine.credentials` 独立配置段。入站/出站概念分离，v1 实现
  可暂保持一致。

## 8. Consumers（messaging channels，M2+）

- TG/Slack 与 Web UI 同级：都只是消费通道，不与特定 runtime 强绑定。
- **模型**：仿 DASH 方法论与 schema——类别 `consumer`，类型 `messaging channel`，实例 Telegram
  （后续 Slack、WhatsApp…）。
- **绑定**：用户添加 TG binding（提供 bot token）→ 平台具备该 channel facility → 在 UI 上把 channel
  自由配对给任意 runtime（local DSH 或 remote OMP 皆可）。
- **会话语义（A 方案）**：一个 TG chat 配对一个 runtime；无 session 时首条消息自动创建；用户可
  slash command 主动新建/切换（含 switch agent runtime）；**TTL 轮换**：新 prompt 距 session
  last-modified 超阈值（默认 24h，可按 channel 配置）则自动开新会话——借鉴 Hermes
  （`idle_minutes=1440`，`gateway/session.py::_is_session_expired`），但 superD 用**新 prompt 到达时
  惰性判定**，不用 Hermes 的后台 watcher（无常驻轮换进程，更省）。
- **TTL 归属 consumer 侧**（非 adapter/全局）：TTL 是消费通道的使用习惯；Web UI 通道永远显式新建，
  不自动轮换。
- **复用**：orchestra 的 telegram-consumer（`~/workspaces/orchestra/src/packages/consumer/
  telegram-consumer/`，grammy，long polling：`bot.start({drop_pending_updates})`；binding/deliver/
  media 分文件）搬运 + 改挂 superD pairing 层。设计参考 `~/workspaces/research/a2a-telegram/`。

## 9. 决策记录（grilling 全量裁决）

| # | 决策 | 裁决 |
|---|---|---|
| 1 | 进程形态 | 独立 App：superd CLI 起 cordis 核心，最小 cordis 宿主 + 自有插件；非 dsh profile |
| 2 | 命名 | superD / `superD`(npm unscoped 主发布) + `@pgmi-builds/*` scope；repo `~/workspaces/superd`（dashr 同级新仓） |
| 3 | 数据/端口 | 独立 `~/.superd/`（用户 dsh 数据不动）；默认 3090（避 3080/3081/4999） |
| 4 | 桥接范围 | 能桥尽桥，字段在场制 + UI 降级；"两半"注册一套统一标准 |
| 5 | remote 注册 | manual `{name,url,token}`；remote 无自动扫描；本地扫描 PATH+端口+进程树 |
| 6 | M1 形态 | 两条腿（DSH 透传 + OMP adapter）+ DEV3 remote；TG 为 M2 |
| 7 | 依赖 | 方案 B：exact-pin + bun compile 内嵌；repo 自包含；vendor verify/restore 保护 |
| 8 | 骨架 | 最小 cordis 宿主（webserver/frontend-static/client-modules/connection/gateway 原样） |
| 9 | Provider 接口 | 统一 RuntimeProvider，不分 passthrough/translate 类型 |
| 10 | 会话归属 | 不存原始会话；单一 pairing 表（~/.superd/pairings.json，惰性 GC） |
| 11 | adapter 发布 | 主包 bundle 全部 5+1 个 adapter |
| 12 | provisioning | 只留方法位（detect/install/locate-isolated），不留配置段 |
| 13 | 品牌原则 | 仅自研代码用 Super D；上游与 runtime 名原样 |
| 14 | TG 会话 | A 方案 + TTL（24h 默认，consumer 侧惰性判定） |
| 15 | auth | authChain 空壳中间件（Caddy 白名单先行）；入站/出站概念分离 |
| 16 | dev/test | 端口 4999（机器共用惯例，用完即停）；home `.superd-test`（user space 或仓内均可）；预配置 local-dsh(3080)/local-omp/dev3-superd 三 machine |
| 17 | 远程协议 | v1 仅 superD-to-superD；CLI 型 runtime 无网络面，必须由 remote superD 本地桥接 |
| 18 | 前端 UI 策略 | 弃全量字段大全包；Agent UI Adapter 与后端对偶，per-runtime composition（agent-ui-dsh 为蓝本），selector 切换整组换装（§3.5） |
| 19 | UI roster 分界 | 中性底座（slots/renderer/layout/**sidebar**/theme/settings 壳/wire 桩）原样依赖；会话面包全部进 composition 层替换；草案见 01-component-boundaries.md，M1 定稿（v0.4：ui-sidebar 回归，见 #24） |
| 20 | DSH 面透传 | 方案一全透传（session/workspace/settings）+ routing mux 按 namespace 分流；否决前端直连 3080（§3.6） |
| 21 | DSH 认证 | 服务端 token 一次性 mint cookie jar（持久 secret ⇒ cookie 跨上游重启有效，默认 30 天）；否决 patch 去 token gate（§3.6） |
| 22 | 品牌 MVP | brand 槽不替换：沿用上游/runtime 品牌，切换不改；Super D 品牌延后（§1/§3.7） |
| 23 | selector 位置 | ~~品牌与 New Session 之间；superd-sidebar copy~~（位置与机制已被 #24 取代） |
| 24 | selector 移位（v0.4） | 侧栏底部 footer 区：`sidebar.footer.action` list 槽 occupant（Settings 上方，源码 stack above）；撤回 superd-sidebar copy，ui-sidebar 回归中性底座；先实现先显示、位置后调（§3.7） |

## 10. 里程碑

**M1（第一期）**：
- superD 源码仓 + 最小 cordis 宿主骨架，dev 实例 4999 + `.superd-test` home，UI 完整可访问（中性底座 + agent-ui-dsh composition）；
- selector 显示 Local: DSH, OMP + Remote: DEV3（位置：侧栏底部 footer 区 Settings 上方，§3.7）；
- DSH adapter（全透传 3080 三面：session/workspace/settings + 服务端 token→cookie mint，§3.6）；OMP adapter（复用 omp-web 桥接，多 runtime 并存改造）：
  新建会话、收发一轮含工具调用的消息；
- DEV3 部署 superD 并连入，其 local OMP 出现在列表（Caddy IP 白名单，无认证负担）；
- 交付验收按"半构建 ready"标准（本机/容器普通 user 试装拉起）。

**M2**：TG consumer 转正（binding 配对、slash 命令、TTL）；Pi adapter + agent-ui-pi；auth 真实实现（若需要）。

**M3+**：Claude Code → Codex → Hermes adapter（接入层选型依 §3，各 adapter 同步交付对应 agent-ui-* composition）；辅助安装/实例隔离 provisioner；Multica 式发现对照；Electron 壳（借鉴 MIT 开源 DSH Desktop，Web UI 装壳即 GUI App）。

## 11. 开放问题

1. ~~Codex adapter 专项研究缺失~~ → 已由 `docs/research/research-heterogeneous-agent-runtimes.md`
   覆盖（A 档 SDK 形态、协议面、独立 API key 要求）；M3 动工前按其选型结论细化事件映射即可。
2. ~~Hermes 进程面勘测~~ → 同上文档已测绘（无官方 SDK，JSON-RPC/OpenAI 兼容 HTTP 协议面或源码
   import；现场隔离注意事项已记）。剩余：协议面事件词汇 → SessionEvent 的具体映射表，M3 前做。
3. **bun 兼容性 PoC**：上游包在 `bun build --compile` 下的行为（native addon、`import.meta.url`
   技巧、vendored 树）未实测。
4. ~~DSH 零认证探针端点~~ → **已解决**（2026-09-08 源码核实）：GET `/` 未带 token/cookie 时返回
   401 + 特征响应体 `dsh web authentication required; reopen the URL printed by dsh web.`
   （browser-auth.ts `writeUnauthorized`）——这本身就是零认证、且带 DSH 指纹的探针应答。
5. **Multica 发现方式**：user 将提供路径，届时对照修正本地扫描设计。
6. **dsh-web-app 系列包清单定格**：三档草案（中性底座 / composition 蓝本 / 排除）已在
   `01-component-boundaries.md` §4，随 M1 骨架落地定稿。
7. **DSH WS upgrade 握手鉴权细节**：高置信推断与 `/api` 同走 `requestRejection`（rpc-host.ts L98
   调用点）；M1 落地 DSH adapter 时实证并记录。
8. **DSH 呈现层嵌入模式裁决**：直连 iframe / 透明反代+iframe（lite composition）/ 集成
   composition 三档——上游六条事实已核验（无 frame 头、token 仅进程内存、栅栏按 Host、
   客户端按 location.origin、资产 root-相对），利弊与验证清单见 `02-dsh-embed-modes.md`；
   建议 M1 用 lite（本地直连 + 远程镜像反代）、集成版为终态，落地前过该文档 §7 清单。

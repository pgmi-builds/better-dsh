# 上游 dsh 0.1.2-alpha.3 → 0.1.2-alpha.5 改进调研报告

- 调研日期：2026-09-02
- 方法：npm tarball diff（伞包仅版本号与 vendored 树增删变化）+ upstream git tag diff（`dsh-v0.1.2-alpha.3..alpha.5`，2391 文件 +30k/−21k）+ 仓内 `.agents/notes/implemented/` 设计笔记（上游每个决策都有 as-built 笔记，本报告的结论均有笔记或 diff 直接佐证）
- 版本事实：alpha.4（09-01）为大批量发布（~8.5k agent 生成的 commit，重测试/文档）；alpha.5（09-02）为 4-commit 存储安全热修。`latest` dist-tag 仍为 0.1.1-rc.2，本线仅在 alpha 通道。

---

## 专题一：前端布局逻辑迁移到 CSS

### 1.1 动机：不是"React 太重"，而是"JS 驱动的布局测量太贵"

React 本身没有被替换——组件、store、渲染管线全部保留。被替换的是**用 JS 读 DOM 几何、再写回样式**的那类"布局反应性"代码。三个典型案例（均有 commit diff 实证）：

**案例 A — ReasoningRow（`perf(ui-chat): move reasoning tail alignment to CSS`，203e2440ac）**
- 之前：组件持有一个 40 行的 `use-throttled-visual-update` hook，每次流式文本更新后同步读 `scrollWidth`/`clientWidth` 再写 `scrollLeft`，把"推理摘要跟随末尾"对齐。这是教科书式的 forced synchronous layout（读-写-读交替触发反复强制布局），且发生在**每个流式 token 到达时**。
- 之后：hook 整个删除；对齐改为 `data-follow-end` 属性 + CSS `display:flex; justify-content:flex-end; min-width:100%`，浏览器原生完成尾部跟随，零 JS。

**案例 B — MessageIconActions（`derive user action reveal in CSS`，f808112ec8）**
- 之前：每个用户消息组件订阅 conversation store，倒序遍历节点序列计算"我是不是最新用户行"，决定操作按钮常显/悬停显——转写一变就可能触发一批组件重渲染。
- 之后：store 订阅与 `reveal` prop 全部删除；CSS 用 `:has(~ :is([data-chat-flow-kind='user'],…))` 兄弟选择器从 DOM 结构直接推导"后面还有没有更新的用户行"。

**案例 C — ProducedFiles（`move overflow sizing to CSS`，e5bbee893b + 笔记 `2026-09-01-css-produced-file-layout`）**
- 之前：产出文件行在隐藏探针树里**复制每个候选 chip**，layout effect 同步读 computed style 与元素几何，行或探针 resize 时反复重测——只为算"一行放得下几个文件名"。
- 之后：探针树、resize observer、布局 state、几何读取全部删除；改为 inline-size 容器查询 + 预设宽度档位（`@container (max-width: 687/583/479/375px)` 四档，每档预算 = 96px/chip + 8px gap + 64px 剩余标签），flex 收缩 + ellipsis 兜底。

**判断依据是逐案取舍，不是教条**：同一波里 `aad1ce0c68 perf(ui-chat): retain the stats resize observer` 明确保留了 StatsLine 的 resize observer——CSS 表达不了的真实内容测量仍留在 JS。配套的流式性能潮（每 2–3 帧发布一次流式更新、滚动几何采样节流）说明整体背景：流式会话让主线程每秒都在跑布局相关代码，把能下沉到 CSS 的布局反应性下沉，是性价比最高的削减。

结论：**转变的动因是性能（layout thrashing / per-frame observer 与 state churn），而非框架更换或 React 本身太重**。

### 1.2 解耦与维护维度：CSS 是静态资产，store 驱动的 DOM 自适应

先回答核心疑问：**CSS 不随 store 动态增加或减少。它就是你猜的第二种——构建期静态资产，所有可能形态预定义在样式表（甚至预渲染在 DOM）里，React 产生的模块去自适应。**

机制拆解（对照"基础组件 → 中间层转译 → 统一 store → 渲染层"的既有心智模型）：

1. **store → 转译/slot → React 的管线完全没动**。变化只在渲染产物这一段：从"JS state 驱动布局"改为"语义属性 + 静态 CSS"。
2. **CSS 载体是 CSS Modules**（`*.module.css`，与组件同目录，构建期编译打包）。alpha.3 → alpha.5 ui-chat 包内 `.module.css` 数量不变（16 → 16），不存在运行时生成/注入 CSS 的通道。
3. **耦合面是一张有界的语义属性词表**：`data-chat-flow-kind={routedNode.kind}`、`data-follow-end`、`data-shown='N'`、`data-pending-steering`……全部是渲染时从节点数据**一次性落下的静态标注**。store 变化 → React 重渲染 → 属性/内容更新 → CSS 选择器（container query、`:has()`、media query）自动反应。CSS 侧永远不感知 store 结构。
4. **"所有变体预渲染 + CSS 挑选"**：ProducedFiles 每行至多渲染 6 个 chip 加一组预渲染的本地化 `+ N files` span，CSS 档位只让其中 0 或 1 个可见——所有分支都在 DOM 里，由 `@container` 决定显隐，不做运行时测量。

**是否多了一个维护维度？是，但有界、且被上游显式文档化并测试锁定**：

- 代价 1：变体必须预渲染，DOM 略胖（每行多几个短 span）。
- 代价 2：档位断点与布局预算强耦合——改 chip 最大宽/间距要同步改四档断点（预算以局部 CSS 自定义属性 `--produced-file-chip-max`/`--produced-file-gap` 为准，笔记里写明了换算）。
- 代价 3：语义属性词表成为 React 侧与 CSS 侧的契约，两侧需同步演进；行为由 client spec + e2e 锁定（单行、无横向溢出、响应式省略、无悬停设备回退）。
- 代价 4：**精度换确定性**——固定档位忽略实际文本宽度与本地化标签宽度，可能比精确测量多/少显示一个 chip。上游在笔记里明确接受了这一近似（`+ N files` 计数始终准确）。

对比维护成本：删掉的是每组件一份的 observer + layout effect + 布局 state + 几何读取（每处 40–140 行 JS），换来的是一份静态样式表里的几十行声明式规则。上游把这类改动归档在 `simplification/`（简化）而非 `architecture/`（架构）目录——他们将其定性为**净删减复杂度**。

---

## 专题二：web_fetch 默认开放的含义

**是什么**：共享基础 bundle `dsh-base` 的 `tool-web` 配置从 `fetch: false` 改为 `fetch: true`（`packages/bundle/base/cordis.patch.yml`）。即 `web_fetch` 从"各产品层各自 opt-in"变为 **base 层默认挂载的模型工具**。

**之前（alpha.3 及更早，笔记 `2026-07-31-web-default-search`）**：base 只默认暴露 `web_search`；`web_fetch` 需要产品层逐个 override 开启（Web 的 cordis/ptc/standard presets、headless、full SDK 开了），ACP 被漏掉，新建 base-only profile 默认没有 fetch，快照头也因此按产品分裂。

**之后（笔记 `2026-09-01-shared-base-web-fetch-default`）**：所有已交付完整产品对匿名公共抓取的策略已收敛一致，重复 override 不再编码任何产品差异，于是上收到 base：

- headless / full SDK / **ACP** / 自定义 base-only profile 全部直接继承 `web_search` + `web_fetch`，零应用层 override；
- Web app 改为禁用 base 的 tool-web 行、按 agent preset 组合同样一对工具（行为不变，配置位置变化）；
- `sdk-minimal` 不经过 base，不受影响。

**安全边界（笔记原文要点）**：

- 匿名 `http:`/`https:` 请求，且**仅允许校验过的公共目的地**（public-destination validation，即防 SSRF 打内网/环回）；
- 抓取在 shell/文件沙箱与审批预设**之外**执行，**无需逐调用审批**；
- 笔记明说"public-destination validation does not prevent public data egress"——只限目的地是公网，不限制公网数据外发；
- 需要不同网络策略的产品/部署，必须在更晚的 bundle 或 profile patch 里**显式覆盖整个 tool-web 配置**。

**对本机的含义**：全局 dsh 若从 alpha.3 升级，所有 base-backed 面（含 Dash Agent 本体与 ACP）的默认模型工具面会多出无审批的 `web_fetch`。omp-web 因禁用了原生 agent-loop/llm routes，其 OMP-backed agent 不直接受影响，但共享同一 host 工具注册面，升级时值得在 4999 测例里过一眼工具清单。

---

## 其余要点（回顾，详见前次会话总结）

- **新包 `dsh-experimental-code-runtime-python`**：`ctx.codeRuntime` 能力缝的 CPython 子进程实现（fd 3 JSON-lines 协议、RLIMIT/墙钟/SIGKILL 约束），即 `run_code`/"Code Mode" 底层；vendored 树同时移除 `dsh-tool-subagent-report`。
- **内部破坏性重构**：session 事件 seq 与 log offset 分离（笔记 `2026-08-31-session-sequence-and-log-offset-brands`）。
- **alpha.5 存储热修**：per-record 单元跨版本读兼容 + backup-and-skip 抢救；升级后的 session-projection 缓存保持可读（笔记 `2026-09-02-projcache-cross-version-read-compat`）——升级 prod 前必读。
- **视觉刷新**：超椭圆圆角 + 发丝线阴影描边（两份 09-01 笔记）。

## 参考索引

| 主题 | 证据 |
|---|---|
| CSS 布局档位笔记 | `.agents/notes/implemented/simplification/2026-09-01-css-produced-file-layout.md`（中英双语） |
| 尾部对齐 CSS 化 | commit `203e2440ac`（删 `use-throttled-visual-update.ts`） |
| 悬停显隐 CSS 化 | commit `f808112ec8`（`:has(~ …)` 替代 store 订阅） |
| 溢出测量 CSS 化 | commit `e5bbee893b` + `ProducedFiles.module.css` 宽度档位 |
| 保留 observer 的反例 | commit `aad1ce0c68` |
| web_fetch 默认开放 | 笔记 `feature/2026-09-01-shared-base-web-fetch-default.md`；`bundle/base/cordis.patch.yml` `fetch: false→true` |
| 被取代的旧决策 | 笔记 `feature/2026-07-31-web-default-search.md`（fetch opt-in 段落被标注 superseded） |

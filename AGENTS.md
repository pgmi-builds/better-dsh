# DASHR (better-dsh) — Agent 开发总纲

本文件只保留项目背景、开发原则与发布边界；操作细节按需从链接披露，新增细节不继续堆入根总纲。

## 流程纪律

- 任务开始先读 `.agents/skills/superpowers/using-superpowers/SKILL.md`，按任务加载适用技能；用户指令与本文件优先于技能。
- 规格写入 `docs/specs/<topic>/spec.md`；历史提案位于 `openspec/changes/archive/`。

## 仓库编排 — 一仓两包

- `better-dsh/` 是插件包（npm `@pgmi-builds/better-dsh`），`dashr/` 是 distro 组合与交付层；两目录各自自包含，不建立根 pnpm workspace。上游 checkout 与 `.test/` 是共用验证基座。
- 不跨目录相对 import 源码；distro 消费精确发布版本或内嵌副本，组件缺陷回插件包修复并发版。局部规则见 `dashr/AGENTS.md`。
- tag：`v*` 用于插件，`dashr-v*` 用于 distro；两目录保持可独立拆仓。

## 〇、发布与验收红线

- npm 发布顺序不可省略：4999 实际运行时第一人称验收 → 报告落 `docs/50_test-reports/` → user 对本次发布明确放行 → `npm publish`；授权不能沿用到下次。
- 验收必须覆盖实际改动行为；构建、单测、进程存活和静态命中不能替代运行时验收。GitHub commit / tag / push 同样不抢在验收、报告和放行之前定版。
- 已发布版本的零碎瑕疵记录后攒批处理；生产按普通用户方式安装 registry 精确版本。

---

## 一、Production Native dsh 拓扑

### Core（`~/.local`）— 用户级全局安装

```
/home/u1/.local/bin/dsh
   └─ symlink → /home/u1/.local/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
```

- `@deepseek-ai/dsh` = **0.1.7-rc.1**（2026-09-23/24 user 升级；本机 `package.json` 实证，2026-09-24 对齐轮核验；旧值 0.1.6-alpha.2），自带 vendored `node_modules`。`npm install -g --prefix ~/.local` 的用户级全局安装。**0.1.7 settings 模型已变**：`settings.yaml` 移除，settings namespace = Loader entry id，值经 configEditor 落 profile patch 用户层；`installSection`/`settings.get` 不复存在（详见 `docs/50_test-reports/2026-09-24-v0.1.7-rc.1对齐轮-compaction与failover设置面修复实测报告.md`）。
- `dsh` 不是 ELF，是 `#!/usr/bin/env node` 的 JS 入口。**它只当启动器**：`bin.js` 解析 boot 哪个 profile、哪些 patch overlay，其余参数透传；`web` 是 `--profile web` 的硬别名；`plugin` 子命令转发给 pnpm 管 profile 依赖。
- systemd unit `dsh.service`（user）: `ExecStart=/opt/node-v22.23.2/bin/node /home/u1/.local/bin/dsh web --no-open --trusted-host dsh.pc.randomhash.app pc.randomhash.app 192.168.31.130`，`Environment=DSH_HOME=/home/u1/.dsh`，端口 **3080**，Caddy 代理 `dsh.pc.randomhash.app` → `127.0.0.1:3080`（`/etc/caddy/Caddyfile`，未经明确批准勿改）。`/opt/node-v22.23.2` 官方 Node（bundled amaro）是 PTC 模式 `run_code` type-stripping 必需。

### Profile level（`~/.dsh/profiles/`）— 0.1.7 起单层树

| 路径 | 性质 |
|---|---|
| `~/.dsh/profiles/web/node_modules/` | 物理文件（pnpm 树，有 `.pnpm/`、`.modules.yaml`）：**只装插件与其真实依赖**——2026-09-26 实测：`.pnpm` store 内零 `@deepseek-ai/dsh-*`，根 `@deepseek-ai/` 仅 `cosmokit`+`schemastery`（插件的 declared real deps，pnpm hoist 到根）；harness 核心包不在 profile 树内 |
| ~~`~/.dsh/profiles/node_modules/`~~ | **0.1.7 已不存在**（旧 ③ symlink 农场已废；harness 供给改走 loader 安装域拦截，见下节。插件不应期待此层——2026-09-26 user 裁决，period） |

`~/.dsh/profiles/web/` 本身是一个 pnpm workspace：
- `package.json` 的 `dsh.profile.bundles` = `["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-experimental-auto-review", "corti-memory", "better-dsh", "super-dsh", "dshmarket"]`（2026-09-26 实测更新；2026-09-11 user 裁决移除 dsh-better-sidebar，prod 3080 已重启验证，mobile wave 已把右滑重指向原生 ui-sidebar-right 官方控件。`dsh.profile.bundles` 是 loader 层 bundle 引用，非 npm 依赖——npm `dependencies` 只含插件本体，见下节解析模型）
- `cordis.yml` 为空 `[]`（树由 patch 组成），实际 overlay 在 `cordis.patch.yml`。
- **plugin add 的供应链年龄门（2026-09-02 实证；2026-09-03 修正 exclude 形式）**：pnpm 11.7.0 自带 supply-chain 策略引擎（默认 `minimumReleaseAge`≈24h）。**版本号形式的 exclude（`pkg@x.y.z`，含 pnpm 自动补的）只作用于解析相位，不盖锁文件校验相位**——条目发布未满 24h 时，后续任何 `pnpm install`/`add` 的锁文件校验都会再拦一次（0.2.2 发布当天装 prod 即中此坑）。**持久形式 = 裸包名**：`minimumReleaseAgeExclude: ['better-dsh']` 全相位生效（scratch A5–A7 实证：校验/全新 add/复验全过）。升级仍用精确版本 add，勿信 `@latest`（回落+静默覆盖部署位的坑仍在）。**v0.2.2a 起包为零 lifecycle script**（owner 裁决 2026-09-03：postinstall 移除，kernel 供给 = spin-up 主路径 + 首用 lazy 两级；`npm run kernel:venv` 手动入口保留）——0.2.2-a 及以后**无 allowBuilds 要求**（该条仅对 0.2.2 这一个带 postinstall 的版本有意义）。~~带 postinstall 的版本还需 `allowBuilds: {'@pgmi-builds/better-dsh': true}`**（strictDepBuilds 下未列 build script = 硬错；0.2.2 起 kernel-provision postinstall 属发布面）。另：pnpm 打完 `Done` 后偶发子进程不退出（11.7.0 worker 边车，Ctrl-C 无损）；`pnpm.onlyBuiltDependencies` 已失效（继任 `allowBuilds` 在 pnpm-workspace.yaml），其 WARN 为噪音。prod profile 的两处修正于 2026-09-03 落位（备份 `.scratch/pnpm-workspace.yaml.bak-0.2.2`）。

### 依赖解析 — 0.1.7：安装域拦截 + profile 树，无农场（2026-09-26 实测重写）

```
① …/web/node_modules/<plugin>/node_modules      ← 插件嵌套真实依赖
② ~/.dsh/profiles/web/node_modules/             ← profile 树：插件本体 + hoisted 真实依赖
③ harness peer（@deepseek-ai/dsh-* bare import）← 不走 walk-up：loader 安装域拦截
   （routeScoped → ~/.local 全局 dsh 的 vendored node_modules，进程内冻结——0.1.7 官方契约）
```

关键：**插件的 `@deepseek-ai/*` harness 依赖不在插件自己的树里也不在 profile 树里**——声明为 optional peers，运行期由安装域拦截供给（安装 scope 进程内冻结；profile 物理包即时生效；表外名字回落原生）。旧 ①→④ 四层 walk-up 模型（含 ③ 农场、④ 全局）为 0.1.6 时代布局，已废。

### User data（`~/.dsh/*`）

`settings.yaml`、`sessions/`、`plugins/`（只有 `dsh-better-edit`）、`profiles/`、`storages/`、`attachments/`、`.env`、`.credentials.yaml`、`corti.json` 等。

### 部署规范 — user, just another user（2026-09-02 裁决）

- **生产部署原则：user, just another user。** 本机 prod（3080）是 user 真实在用的部署，按普通 user 的方式从 registry 安装：主体 npm 安装，插件 npm 安装或经 dsh plugin market 安装——plugin market 底层拿的也是 npm，同源。**不做源码级/手工同步侵入 prod**（手工 md5 同步仅限未发布本地迭代，见第三节；发布态部署的正道是 pnpm add 精确版本，见第一节年龄门）。
- **本地部署基本全用 npm（registry 同源生态）**；dev/test 的源码级路径是第二、三节的独立轨道，两者据此分离。升级 prod 前先在 Dev/Test 1 预演（同版本 checkout → 验证 → 报告），本轮 alpha.5 即该模式的首演。

---

## 二、开发与测试原则

- **Harness 有两类交付物**：Code Logic（硬编码逻辑）与 Semantic Engineering（语义工程）必须一起设计、实现和验收；不能仅凭传统编程经验把语义当作附属文案。
- **Surface 就是产品**：明确哪些内容、在什么时机进入消费 Harness 的模型上下文；tool catalog、工具描述、教学指引、错误信息和结果中的恢复提示都属交付范围。Inline comment 面向人类或开发 Agent，不能代替运行时 Surface。
- **Agent 对代码库承担 ownership**：负责实现选择、依赖链和副作用；把 user 当 supervisor / reviewer，以目标、结论、用户可见影响和必要决策汇报，不能默认其熟悉内部字段、Schema 或调用链。内部细节由 Agent 查清并消化，需要解释时先说明它与目标的关系。
- **LSP 与 AST 工具必须实际使用**：开发前用 LSP 查定义、引用与调用关系，用 AST（如 ast-grep）核实结构和匹配范围，追踪上游已有 CLI、配置与扩展入口，再决定实现。优先官方机制；环境变量绕行或 monkey patch 须有官方入口不足的证据；工具不可用时明确缺口，不能声称已核实。
- **开发验证与生产隔离，按真实交付路径验收**：插件独立构建，通过实际安装与实际运行时验证代码行为和模型看到的 Surface；测试 home 与用户数据按 rig 规范保留，生产变更遵守发布红线。
- **细节按需披露**：通用规范见 [Cordis-dsh-dev-test-guides.md](Cordis-dsh-dev-test-guides.md)，rig 与启动见 [.test/README.md](.test/README.md)，上游本地 patch、旧路径与历史验证见 [开发环境记录](docs/dev-test-environment-notes.md)；局部守则放对应子目录 `AGENTS.md`，根目录不收纳命令清单与排障流水账。

---

## 三、开发路径选择

默认使用与生产隔离的 Dev/Test 1。Dev/Test 2（生产核 + 开发插件）是历史实验路径，不能据此直接侵入生产；两条路径的背景及验证状态按需查阅 [开发环境记录](docs/dev-test-environment-notes.md)。

---

## 四、dsh 插件开发面（机制速查）— 2026-09-03 研究裁决

机制层知识已从 ws skill 蒸馏入文档（2026-09-06，skill 已删）：**`docs/60_exploration-and-research/05-dashr-dev/plugin-development.md`**（决策树 + host core / client web-ui 两分量，源码锚点齐；论证底稿 = `docs/60_exploration-and-research/01-cordis-runtime/cordis-customization-and-override-mechanics.md`）。要点裁决（细节以该文档为准）：

- **官方声明式 patch 线 = `cordis.patch.yml`**：行 schema `{id, name, config, inject, disabled}`；层序 bundles（列序）→ profile → home → `--patch`；后层按 id **整行重述**覆盖前层（非 merge）；`!!js` boot 表达式可读 `process.env` 与 loader 上下文服务。presets/features/settings 全是插件行 config → 全部 patch-线可达。dashr 自己的 bundle patch 已在用（compaction 三行 re-enable、`DASHR_KERNEL_PYTHON`）。
- **override 的三条硬边界**（勿再凭直觉）：① 浏览器模块表同 id = 双侧硬错（无 last-wins，同名包遮蔽不可行）；② cordis 同 scope 同名 service = 硬错，"closest wins" 仅祖先/isolate 遮蔽（兄弟插件间不存在）；③ 官方 UI 组件遮蔽 = **slot 同 cell 更低 priority 注册（lowest renders）**，同 priority 才报错。整插件替换的正规入口 = patch 行 id 覆盖 + `name` 重指（记录未用）。
- **`/api` 信任栅栏（alpha.5 起）**：服务端化 + 配置化——`connection` 行 config `trustedHosts`（`--trusted-host` CLI → web-app bundle `webRuntime` 服务 → `!!js ctx.webRuntime.trustedHosts`）；上游注释明示拼接扩展式。alpha.3 的 prod 手改 patch（vendored `isLoopbackHostname` 放宽）在 alpha.5+ 由 patch 线取代（v0.2.1f change `plugin-shipped-ui-patches` 落地中，含 4999 症状复诊与 `isLoopback` 残余评估）。
- **手势/状态类 client 代码只认官方面（2026-09-11 红线）**：任何"读状态/触发动作"的 DOM 寻址只许指向上游官方表面（layout 服务方法、AppFrame 语义属性、官方控件 data-\*）；第三方插件 DOM **永不做状态输入**（Better Sidebar body 属性毒死手势状态机的先例），第三方至多做可选的增量目标、缺席时静默降级。
- **client 半 CSS 注入是一等公民**（`claimStyles` 按插件认领 `<style>`）；上游 `ui-layout`：窄视口侧栏折叠为 56px rail 永不为 0、`SIDEBAR_AUTO_COLLAPSE=1024`、视口 <920 details 必关、**无原生滑动手势**（插件手势 = 纯增量）。

---


## 五、嵌套 AGENTS.md 约定

- **本文件身份**：DASHR 仓（`better-dsh` 插件 + `dashr` distro，一仓两包，见「仓库编排」节）的根 AGENTS.md（总纲，无更上层）。
- **嵌套（Nesting）**：支持层层嵌套，但每一层并非都必须有——只在有实质内容的子目录放置；中间层级无 AGENTS.md 则跳过，沿用最近上层。
- **作用范围（Scope）**：每个 AGENTS.md 只管辖其所在目录及所有子目录，不约束兄弟目录、不反向影响上层。
- **优先级（Precedence）**：对某文件，生效规则 = 从根到该文件路径上所有 AGENTS.md 的叠加；冲突时离文件最近者胜出（nearest wins）；用户显式指令优先级高于一切 AGENTS.md。
- **子目录模板**：子目录/孙目录若需自己的 AGENTS.md，复制下方模板、填入 `<相对路径>` 即可（"去根目录拿一个"；中间层级无 AGENTS.md 时上层直指根）：

  ```markdown
  # <相对路径> — AGENTS.md

  本文件是 `<相对路径>` 子目录的 AGENTS.md。上层为 DASHR 根目录 `AGENTS.md`；其规则对本目录仍有效，冲突时以本文件为准。
  ```

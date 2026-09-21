# plugins-page-components Specification

## Purpose

让 better-dsh 在原生 Plugins 页（`dsh-client-ui-plugin-manager`）上呈现与官方 bundle 同等的两件事：

1. **卡片描述**：页面的 `BundleInfo.description` 直接取自包 manifest 的 `description` 字段；better-dsh 的 package.json 缺该字段导致卡片无描述。补齐为 awesome-dsh-plugins listing 的同款文案（单一事实源，两表面一致）。
2. **组件化**：页面只把 bundle patch 的 **`insert` 行**列为可开关组件（每行一个 toggle，写 profile 用户层 `cordis.patch.yml` 的 `{id, disabled}` 覆盖行，HMR 即时生效）；非 insert 行只进 `overrides`（本页不显示）。现状 better-dsh 只有一条 insert（`dashr-repl`），整个插件是"一个组件"。本变更把 bundle patch 拆成 **6 条 insert**，每条 = 一个可独立开关的功能组件，映射原生 Agent Teams 的双组件形态。

## Requirements

### Requirement: 六组件行结构

bundle patch（`cordis.patch.yml`）SHALL 恰好声明 6 条 insert 行，全部指向同一 npm 包 `better-dsh` 的子路径导出：

| row id | module | 内容 |
|---|---|---|
| `dashr-repl` | `better-dsh` | 核心：kernel runtime + spin-up 供给检查 + `eval` + 三委派桥 + `llm_completion` + wire mask + escalation guidance |
| `dashr-url-schemes` | `better-dsh/url-schemes` | URL 感知 I/O + hashline + devices（原 `DshUrlSchemes`，行配置载 `urlSchemes`/`hashline` gates） |
| `dashr-failover` | `better-dsh/failover` | LLM failover 瀑布（settings 驱动，行配置 = 两个 fallback 槽） |
| `dashr-compaction-tuning` | `better-dsh/compaction-tuning` | 自动压缩阈值偏好（settings 驱动） |
| `dashr-web-trust` | `better-dsh/web-trust` | `webserver/index-inject` **authorities 腿**（`__DSH_TRANSPORT__.ownsHost`）；行配置 `trustedPageAuthorities`（schema 默认派生自 `DSH_TRUSTED_HOSTS`） |
| `dashr-mobile` | `better-dsh/mobile` | `webserver/index-inject` **mobile 腿**（`__DASHR_MOBILE__` + zoomGuard 段）；行配置 = 原 `MOBILE_CONFIG` |

#### Scenario: 页面呈现

- **WHEN** 用户打开 Plugins 页的 better-dsh 卡片
- **THEN** 卡片显示 listing 文案描述与 6 个组件行，每行可独立开关

#### Scenario: 行开关落盘

- **WHEN** 用户关闭任一组件行
- **THEN** profile 用户层 patch 追加该 id 的 `{disabled: true}` 覆盖行，HMR 即时卸载该组件；重新打开则移除覆盖

### Requirement: 配置键迁移（行 = 配置归属）

`urlSchemes`、`hashline`、`trustedPageAuthorities`、`mobile` SHALL 从 `dashr-repl` 的 Config schema 移除，改由所属行的 schema 承载（schema 级默认逐键填充，跨 patch 覆盖层存活——v0.2.2a 裁决的延续）。config-file 用户改以行 id 为目标。

#### Scenario: 行级 gates

- **WHEN** `dashr-url-schemes` 行配置 `hashline: false`
- **THEN** hashline read 锚点与 edit/undo 家族不安装，captured 原生 read 独立站立（既有 gate 语义不变，只是配置位置从核心行移到本行）

### Requirement: 行间无注入边，排序无关

任何组件行 SHALL NOT inject 另一组件行提供的服务；行为正确的唯一跨行约束——**capture-before-mask**（url-schemes 的继承面快照必须在 wire mask `restrict({deny})` 之前完成，快照保存被 mask 的委派工具定义）——SHALL 由 mask 监听器自身保证：mask 监听器第一步调用共享模块 `native-capture`（单例 chunk）的 `captureAllTools(agent)`（幂等，WeakMap 缓存），随后才 restrict。两个入口行（entry）的激活顺序因此无关紧要。

#### Scenario: 顺序反转仍正确

- **WHEN** cordis 激活顺序使 mask 监听器先于 url-schemes 的 session-start 监听器运行
- **THEN** mask 先经 `captureAllTools` 固化 pre-mask 全量快照再 restrict；url-schemes 随后的 `captureNativeTools` 命中同一缓存，wrappers 照常安装（own-layer 注册不受已落限制过滤）

#### Scenario: url-schemes 行关闭时桥不断

- **WHEN** `dashr-url-schemes` 行关闭、`dashr-repl` 行开启
- **THEN** mask 监听器的 capture 步骤照常固化快照，captured 委派工具定义仍可供读取；eval 与委派桥正常工作

### Requirement: 双腿 boot script

`buildBootScript` SHALL 拆为两个纯函数腿构建器：`buildTrustScript`（authorities 段）与 `buildMobileScript`（`__DASHR_MOBILE__` + zoomGuard 段），各自为空即注入 nothing；两行各自注册 `webserver/index-inject` 监听器（list 事件，`table.push` 天然可组合）。

#### Scenario: 单腿开关

- **WHEN** `dashr-mobile` 行关闭而 `dashr-web-trust` 行开启
- **THEN** 页面仍注入 authorities 腿脚本，`__DASHR_MOBILE__` 缺席，client 移动手势/zoomGuard 保持惰性（client 半无改动，读页面全局缺席即休眠）

### Requirement: override 行保持原样

compaction 再启用三条（`compaction-basic`/`command-compact`/`tool-result-pruner`）与 `connection` fence 行 SHALL 保持 override 行形态。原生页面不列出 override 行（把再启用做成 insert 需 fork 上游插件模块，不采纳）。

### Requirement: 描述单源

package.json `description` SHALL 逐字采用 awesome-dsh-plugins listing 的 en 文案，使 Plugins 卡片与市场 listing 单源一致。

## Out of Scope

- npm publish（另行裁决，按发布红线走两道闸）。
- `plugins.row.config` / `plugins.bundle.config` 配置表单（本变更只要求原生行开关；行配置仍走 config file）。
- client half 改动（页面全局缺席即休眠的既有形态已满足）。

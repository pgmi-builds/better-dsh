## Why

v0.2.1e 收口时搁在 `openspec/deferred/` 的两个 user 私人 UI patch（loopback provider directory、mobile responsive sidebar），原计划走"本地可重放 patch + 对齐轮查表"路线。**user 2026-09-03 裁决转向：不再本地 patch（包括 prod 实例），改为研究并实现随 better-dsh 插件发布。**

前置可行性研究已完成（见 design.md，全部结论一手源码核验于 alpha.5 checkout）：

1. **存在官方声明式 patch 线**：`cordis.patch.yml` 按 `id` 定位行、整行替换/插入/禁用，`!!js` boot 表达式可读 `process.env` 与服务（dashr 自己的 bundle patch 已在用：`DASHR_KERNEL_PYTHON`、compaction 三行 re-enable）。P2 的 alpha.5 正解就是一条 patch 线：`connection` 行 `config.trustedHosts`（上游 web-app bundle 注释明文示范了拼接扩展式）。
2. **UI 插件路径已验证**（v0.2.1e FailoverRow 首演）：`dsh.client` 声明 + client bundle + `ctx.slots` 组合；CSS 注入是 client-modules 的一等公民（`claimStyles` 按插件认领 `<style>`）。
3. **override 有三层精确答案**：浏览器模块表同 id = 硬错（双侧）；cordis 同 scope 同名 service = 硬错，"closest wins" 仅限祖先/isolate 遮蔽；**官方 UI 组件覆盖面 = slot 优先级遮蔽（lowest renders，同优先级才报错）**；官方整插件替换面 = patch 行按 id 重述 + `name` 重指。

## What Changes

- **P2 → 插件随发的 fence 授权线**：better-dsh bundle patch 覆盖 `connection` 行，`trustedHosts` 由 `DSH_TRUSTED_HOSTS` env（空白分隔）与上游 `ctx.webRuntime.trustedHosts` 合并；alpha.3 手改 patch（prod vendored `isLoopbackHostname`）正式退役。附 4999 P2 症状复诊（bind=127.0.0.1 时 fence 本应放行，真实病因未证）与浏览器侧 `isLoopback` 残余影响评估。
- **P3 → 插件 client 半边的移动布局 + 手势**：注入 CSS（媒体查询 + 语义属性 + `!important` 覆盖内联 `gridTemplateColumns`）实现窄视口侧栏宽 0；新增指针手势（起点 + 距离 + **速率**三条件）调 `ctx.layout.toggleSidebar()`。alpha.5 上游无原生滑动手势 → 纯增量、零冲突。
- **部署边界反转**：两个特性从"user 私人不随 dashr 发布"反转为**随插件默认发布**（config/env 门控、无 env 时惰性）。
- **吸收**：`openspec/deferred/2026-09-02-loopback-provider-directory/` 与 `2026-09-02-mobile-responsive-sidebar/` 移入本 change `absorbed/` 作设计输入，deferred 清空。
- **知识沉淀**：新建 ws skill `.agents/skills/dsh-plugin-development/`（core framework / web UI 两分量），AGENTS.md 回填。

## Capabilities

### New Capabilities

- `web-trust-fence`：插件随发的 `/api` 信任栅栏授权（env 合并式 patch 线）契约。
- `mobile-layout`：插件随发的窄视口侧栏隐藏 + 三条件滑动手势契约。

### Modified Capabilities

（无）

## Impact

- **代码**：`dashr/cordis.patch.yml`（+connection 行覆盖）、`dashr/src/`（client 半边新增 mobile 模块或并入现有 client 入口；host 半边无新服务）、`dashr/package.json`（version 0.2.1-f）、schema/config 面（mobile 配置项）。
- **验证**：4999 实例双特性实测（fence：非 loopback Host 经 `/api` 403→200 对比；mobile：视口模拟 + 手势速率判定）；vitest 单测（手势判定纯函数、env 合并表达式）；既有 403 用例回归。
- **文档**：`docs/50_test-reports/` 新报告；AGENTS.md；skill 文件。
- **风险**：patch 行覆盖须整行重述（`name`/`inject`/`config`），上游行形状漂移 = 对齐轮检查项（进 upstream-alignment S7 查表）；`trustedHosts` 是信任决策面，env 驱动 + 文档明示安全语义。

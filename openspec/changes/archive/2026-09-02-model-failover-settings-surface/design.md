## Context

- host 半边：`dashr/src/index.ts:1002` `installFailover(ctx)`——root context、per-turn 瀑布（alpha.5 对齐态下随插件加载，实测 T5 工具面正常）。
- client 半边：`dashr/src/failover/client/`（`FailoverRow.tsx` + `FailoverRow.module.css` + `locales.ts`），经 `settings.general.item` slot 契约注册（type-only import `@deepseek-ai/dsh-client-ui-settings/client`）。
- 测试路径缺口的机理：`build-client` 产出浏览器侧卡片 bundle；monorepo 副本从未执行该步（副本限制：prebuild 拷 `../docs` 会失败；client externals 靠 `.dsh-module-fallback` 解析）。

## Goals / Non-Goals

- Goals：Dev/Test 1 实例能渲染 dashr 全部客户端卡；alpha.5 端到端验证 Model Failover。
- Non-Goals：不改 failover 的 host 侧算法；不做 failover 策略扩展（重试预算、多级链等另行立项）。

## Decisions

- **D1 收口测试路径而非绕过**：在 monorepo 内让 `build-client` 可跑（为副本提供 prebuild 所需物或改为显式跳过 docs 拷贝的开关），使「测试实例 = 生产形态减端口」成立。绕过（只在 prod 验证 UI）会让每次上游对齐都留一块盲区。
- **D2 slot 契约对齐优先侦察**：alpha.4/5 client 包大改（CSS 化、slot 契约可能有版本演进）；实现前先 diff `settings.general.item` 契约在 alpha.3→alpha.5 的变化，按需适配而非盲跑。
- **D3 双实例核验**：prod（0.2.1-d，client 半边已构建）先核验 FailoverRow 是否呈现——区分「测试路径缺构建」与「真实回归」两种可能，避免误修。
- **D4 原生注册链路核实（2026-09-03 user 挑战，升级为前置侦察）**：对照原生链路（底层模块产出定义 → API Gateway/API-to-UI 中间件自动注册 UI Store → 后端供数据字段与 API → React 按 Store 定义取组件渲染）核实 `settings.general.item` slot 契约是否即该链路在 Settings 模块的官方介入面。若存在**纯服务端注册面**（把新增字段正确传给 Settings 模块即可自动渲染、无需插件自带客户端 bundle），则优先迁移到该路径——「Settings 怎么分发到最前端是它设计好的生态，不由插件操心」；客户端 slot 组件仅当需要富交互行（双模型选择器这类自定义 UI）且原生面表达不了时保留。修正记录：4999 的缺口定性为**客户端产物未构建**（交付物缺失），非绕开原生机制；但「是否已走最原生路径」以本核实结论为准，不预设。
## Risks / Trade-offs

- monorepo 内 build-client 需要浏览器侧 external 的 fallback 树配合，`.dsh-module-fallback` 在测试 profile 已有先例（dsh-client-ui-primitives/slots symlink），风险可控但需逐 external 核对。

## Open Questions

- alpha.5 的 `settings.general.item` slot 契约相对 alpha.3 是否有破坏性变化？（任务 1.2 侦察回答）
- prod 实例上 FailoverRow 当前是否已呈现？（任务 1.1 回答；若已呈现，本 change 聚焦测试路径 + alpha.5 复验）

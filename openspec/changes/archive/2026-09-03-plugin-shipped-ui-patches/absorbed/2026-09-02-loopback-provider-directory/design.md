## Context

- 症状仅出现于 alpha.5 对齐态实测；prod（alpha.3）上 Models 页正常（patch 生效中）。
- patch 不在 `dashr/src`（grep loopback/127.0.0.1-auth 无命中），真实落点未知——这是本 change 第一个要回答的问题。
- 上游侧：模型/provider 清单链路在 alpha.4 大改中变动的面（api-gateway / api-remotes / web-app 的 provider directory 加载）需 diff 确认。

## Goals / Non-Goals

- Goals：恢复 Models 页清单加载；patch 可维护、可随上游对齐重放。
- Non-Goals：不把 loopback auth 变成 dashr 的发布功能；不改变上游认证语义（仅本地回环形态的旁路/注入）。

## Decisions

- **D1 先审计后动手**：patch 落点不明，任何"直接重写"都可能产生第二份漂移副本；任务 1 必须先锁定唯一维护位。
- **D2 优先配置面/扩展点**：重适配优先走上游暴露的配置（如 base-URL/credentials 注入面）或 dashr 自有扩展点；仅当无扩展点可用才做本地 overlay patch，且 overlay 必须是"可重放脚本"而非手改产物。
- **D3 文档化触点**：重放步骤写进 patch 自述 + upstream-alignment S7，形成"上游动 → 对齐轮查表 → 重放"的闭环。

## Risks / Trade-offs

- 若 patch 原是手改 prod 部署产物（无源），审计可能只能还原意图不能还原差异——按意图重做，并在文档标注此事实。

## Open Questions

- patch 现维护位置与本轮失效的确切上游 commit/变更？（任务 1/2 回答）
- 上游是否在 alpha.4/5 提供了官方 loopback/本地 provider 配置面，使 patch 可以整体退役？（任务 2 顺带回答——若可退役，本 change 缩为"迁移到官方面 + 删 patch"）

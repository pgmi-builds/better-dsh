## Why

诊断报告 `docs/50_test-reports/2026-09-08-hashline-edit-E_RANGE_UNVERIFIED跨轮会话键失效-诊断报告.md` 三轮复核（§7 勘误与设计裁决，user 主持）定案：

- **根因（修正后）**：`E_RANGE_UNVERIFIED` 不是校验代码 bug，而是 served 账本按 `(session_id, path)` 记账 × DSH 会话树 fork 换节点——轮 B write（键 a1b3097d）与轮 C edit（键 328368a6，fork 子节点）分属两会话对象，查空必拒。原报告"每轮换 session id"归因已勘误（fork 机制实证 + memory_flush 回显源错误）。
- **user 裁决**：校验权威迁到内容本身（OMP 同构，`pi-hashline-edit-lsz` 两分支合流）；locator 去 session 化走 minimal 形态——**canonical 绝对路径主键，不加 CWD 前缀**（绝对路径单机唯一 + 模型面锚点恒伴 path 参数，前缀零收益）；存储集中 `$DSH_HOME/storages/dsh-better-edit/`（终结 12 个 workspace 各一份 sqlite 的"到处拉屎"）；write 是全文件写，**不需要"之前见过"校验、不需要锚点回放**（上游确认信封即契约，OMP 同样不回显内容）；多 tuple 失败文案修正。

## What Changes

- **served 去 session 化（schema v6→7）**：`served` PK `(session_id, path)` → `(path)`；`execSessionKey`/`sessionKeyFor`/`wipeServedState` 及贯穿 read-and-serve / edit-pipeline / drift / write-hook 的 sessionKey 管道整体拆除；`snapshots`/`undo` 本就 path 主键，不动；7 天 TTL prune 保留。
- **verifyServedRange 内容快道**：锚点在当前文件 canonical 行哈希中**唯一定位即通过**（served 不再是校验门禁，降级为 echo/undo 辅助）；多位置歧义回落 served 消歧；真漂移（锚点哈希在当前文件不存在）仍 fail-closed；批量原子性 `E_BATCH_ABORT` 不变。
- **集中存储**：`configDir(cwd)` 删除 cwd 分支，统一 `$DSH_HOME/storages/dsh-better-edit/hash-store.sqlite`（`resolveDshHome()` 感知 `DSH_HOME`，4999 测试线自动隔离）；旧 `<workspace>/.dsh_better_edit/` 不再创建、不做数据迁移（TTL 清空语义，弃置）。
- **write-hook 移除**：`registerWriteHook`（post-execute 全文件锚点回放）删除，write 结果保持上游确认信封（`Created/Updated` + bytes）；guidance 同步——写后可直接 edit（锚随内容）或主动 read。
- **失败文案**：多 tuple 批失败指引从误导性的 "Retry with these anchors (no read needed)" 改为 "read 一次后整批重交"；真漂移文案点明内容已变。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `tool-surface`：MODIFIED Requirement「Hashline edit family registered on the agent's own layer」——write 侧 hook 从"追加 hashline 预览"改为"不介入，上游确认信封原样返回"；ADDED Requirement「Hashline edit verification is content-anchored」（内容快道 + 跨 fork 免 read + 漂移 fail-closed + 批量原子不变 + 多 tuple 文案）；ADDED Requirement「Hashline store centralized under DSH_HOME」（单点存储 + path 主键 + TTL + 版本门迁移）。

## Impact

- **代码**：`dashr/src/url-schema/vendored/hashline/{hash-store,session-view,paths,read-and-serve,anchor-pipeline,edit-engine,constants,index,write-hook(删),prompts/guidance}`；测试新增 `dashr/test/hashline-store.spec.ts`（v7 迁移 / path 键 / TTL / 集中化 / 内容快道矩阵）。
- **验证**：vitest 全量 + tsc 0；rsync → tsdown → `tsx scripts/build-client.ts`（lib/client 清洗陷阱）→ 4999 重启；**第一人称复现原剧本**（write 轮 → fork 续聊 → 直接多 tuple edit 免 read 成功）+ 回归矩阵（外部改文件后 edit 拒绝、`undo_last_edit`、`E_BATCH_ABORT` 零写入）；存储探针（无新点目录、`storages/dsh-better-edit` 在场、`.dsh-test` 隔离）。报告落 `docs/50_test-reports/`。
- **风险**：同 path 并发会话共享 served/undo——`undo` 现状即 path 主键、同 workspace 多会话本就共享，集中化仅跨 workspace 扩展（路径不相交），实际新增暴露≈0；锚点歧义回落保守正确。**发布红线**：4999 第一人称实测 + 报告落盘 + user 单次确认后才 `npm publish`（AGENTS §〇，授权单次有效）。
- **版本**：0.2.3-b，tag `v0.2.3b`。

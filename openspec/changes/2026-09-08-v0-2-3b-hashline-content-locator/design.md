## Context

诊断报告三轮复核（§7.1–§7.7）已定案的事实与裁决，本设计不再重复论证，只给落点。源码锚点均为 canonical（`dashr/src/url-schema/vendored/hashline/`）。

## D1 served 去 session 化（schema v6→7）

- DDL：`served` 改 `path TEXT NOT NULL PRIMARY KEY` + `hashes/reported/updated_at`（去 `session_id`）；`snapshots`/`undo` 现状即 `path PRIMARY KEY`（`hash-store.js:127-146`），零改动。
- 版本门沿用既有模式（`hash-store.js:147-170`）：`HASH_STORE_VERSION` 6→7；`versionChanged` → wipe snapshots/undo + `DROP TABLE served` 重建新 DDL。防御检查从"缺 `session_id` 列即 DROP"反转为"**仍含** `session_id` 列即 DROP"。
- 语句面（`hash-store.js:181-189`）：`servedGet/servedUpsert/servedReportedUpsert/servedReportedClear/servedDelete` 去 session 参；`servedWipeStmt`（`DELETE ... WHERE session_id = ?`）删除。
- API 收敛（`session-view.js`）：`loadServed/recordServed/recordServedTruncated/driftReported/markDriftReported/clearDriftReported` 去 `sessionKey` 参数；`sessionKeyFor/execSessionKey/fallbackSessionKey` 删除；`withWorkspace/workspaceCwd/execCwd` 保留（cwd 仍是文件解析与 fs 桥的传播通道）。调用点：`read-and-serve.js`、`edit-pipeline`、`drift`、测试。

## D2 集中存储

- `paths.js configDir(cwd)` → 无条件 `join(resolveDshHome(), "storages", "dsh-better-edit")`；`hashStorePath/legacyHashStorePath/hashStoreDir` 随行；签名保留 `cwd` 形参会误导，直接改无参并更新调用面。目录创建沿用 hash-store open 路径的既有 mkdir（实现时确认 `recursive: true`）。
- `resolveDshHome()`（`@deepseek-ai/dsh-home-paths`）感知 `DSH_HOME` → prod `~/.dsh` 与 4999 `~/.dsh/workspaces/dashr/.dsh-test` 天然分库。
- 语义修正记录：原"无 cwd 兜底指向 `$DSH_HOME/plugins/dsh-better-edit`"（`paths.js:11-13`）指向了安装脚手架位（实测该目录为 README/code/cordis/minimal/standard），`storages/` 才是宿主状态数据区（workspace.json / message_feedback.json / session_projcache）。

## D3 内容快道（错误语义映射）

`anchor-pipeline.js verifyServedRange`（`anchor-pipeline.js:462` 一带）判定顺序改为：

| 情形 | 判定 | 结果 |
|---|---|---|
| tuple 全部锚点在当前 `fileHashes` **唯一定位**且 (from,to) 配对一致 | content-match | **直接接受**，served 不查 |
| 锚点在当前文件多位置命中（外部编辑造成重复内容行） | 回落 served 定位消歧 | served 可消歧 → 接受；仍歧义 → `E_RANGE_UNVERIFIED`（新文案） |
| 锚点哈希在当前文件不存在 | 真漂移 | `E_RANGE_STALE` 语义（文案点明"内容已变，重新 read"） |
| 走 served 路径时起止齐而中段无账 | — | `E_RANGE_UNSERVED` 保持 |

- 唯一性依据：`mapStableHashes`/分配不变量保证**经 hashline 编辑过**的文件行哈希文件内唯一；外部整写可能引入重复行 → 命中歧义分支，保守正确。
- `E_BATCH_ABORT`（`edit-engine.js:270`）整批零写入语义不变。
- served 降级为 echo/undo 辅助：`recordServed` 照常记账（path 键），跨会话/跨 fork 共享即期望行为。

## D4 write-hook 移除与 guidance

- `write-hook.js` 删除；`index.js` 安装面（`registerWriteHook` 调用与导出）摘除；`AUTO_READ_HEADING` 消失。write 结果 = 上游确认信封（`tool-fs/src/write.ts`："no file content is echoed back"），无任何 hashline 介入——校验逻辑上整文件写无"之前见过"命题，守卫在 approval policy + `dsh-fs-observation-policy`（createIfAbsent/replaceIfVersion），与 hashline 无关。
- guidance/prompts 四节中 write auto-read 相关文案改写：写后可直接 edit（锚随内容）或主动 read；不再承诺 write 结果附带锚点。
- 可选跟进（不在本 change 范围）：post-execute 瀑布上若未来挂异步写工具，注意 `final-result` bypass post-execute（core/tools `index.ts:421`）。

## D5 TTL / 清理

`servedPruneOlderThan(Date.now() - SERVED_TTL_MS)`（7 天，开库时执行，`hash-store.js:488`）保留，path 键下按 `updated_at` 照常工作。snapshots/undo 不新增清理（容量另议）。旧 12 个 `<workspace>/.dsh_better_edit/` 不迁移、不自动删除（弃置；user 手动清理另行决定）。

## D7 风险与取舍

- **跨会话共享 served/undo**：`undo` 现状即 path 主键、同 workspace 多会话本就共享；集中化把共享面扩到跨 workspace——不同 workspace 路径不相交，实际新增暴露≈0。同 path 并发双写仍由 fs 观察策略与 approval 管辖。
- **歧义回落**保守正确；内容快道消除原报告主摩擦（fork 节点换键）后，served 查空不再可能成为假阴性来源。
- **发布红线**（AGENTS §〇）：4999 第一人称实测通过 + 报告落 `docs/50_test-reports/` + user 单次明确确认，三闸齐备才 `npm publish`；GitHub 侧 commit/tag 随节奏走不抢跑。

# URL Schemes 可回溯上下文 — 4999 实测剧本（change 2026-09-11-url-schemes-recallable-context）

> 实例：`http://127.0.0.1:4999/?token=0yiwNoRDNyBpN4JQ43P-OVu88W2o6rIXbzXkIKikanA`（systemd 单元 `dsh-4999-test`，DSH_HOME=仓库内 `.dsh-test`，构建=本 change 源码树；2026-09-12 user 指令下线 omp-web-4999-test/lan-relay 后由 4986 迁入 4999）
> 驱动方式（0.2.3-d 先例）：user 在 GUI 打开上述 URL 开一个**新会话**，把下方「粘贴给 agent 的指令」整段贴进去；agent 完成后把它的回复贴回本 change 的实测报告。
> **✅ 已执行（2026-09-12，agent 经 HTTP RPC 自驱，10/10 判定全过）**：被测会话 `session-eec306df`，结果与判定对照见实测报告 §3.2；本剧本存档留作复演模板。

## 粘贴给 agent 的指令

```text
请按顺序执行以下第一人称实测，每步原文贴出关键输出（不要省略）：

1. read ctx:// — 贴出完整 roster。
2. read ctx://session — 贴出 JSON 的 totals 与 compacted 字段（此时 compacted 应为空清单或不存在条目）。
3. 为了制造可压缩的历史：请连续 read 以下三个文件并各贴出一行内容摘要——
   dashr/src/url-schemes/transforms.ts、dashr/src/url-schemes/handlers/ctx.ts、dashr/src/url-schemes/fs-backend.ts。
4. 执行 /compact（手动压缩一次）。完成后 read ctx://session/compactions — 贴出清单；记下第一个 label（记为 L1）。
5. read ctx://session/compactions[L1] — 贴出 8 段 summary 的前 5 行。
6. read ctx://session/compactions[L1]:raw — 贴出前 10 行与总行数；确认包含第 3 步读过的文件名。
7. 再正常对话 2-3 轮（例如问「transcript 格式 v1 冻结是什么意思」）后再次执行 /compact（第二次，嵌套前档）。然后 read ctx://session/compactions — 贴出新清单；确认第二个条目的 replaces_checkpoint 等于 L1 的 checkpoint_seq。
8. read ctx://session/compactions[<第二个label>] — 贴出 8 段前 5 行。
9. read ctx://session/compactions[L1]:raw — 关键回归：第一次压缩的原文在第二次压缩后必须仍可读；贴出前 10 行，确认包含第 3 步的文件名与 'hello world' 级别的原始内容。
10. read ctx://session/compactions[L1]/original:1-5 — 贴出行窗结果。
```

## 判定基准（对照 mapping doc §9–§15.11）

| # | 断言 |
|---|---|
| 1 | roster 含 `ctx://session`、`compactions`、语法提示 |
| 2 | snapshot JSON 含 `totals`/`compacted: []`/`syntax` 字段；`session.id` 正确 |
| 4 | manifest 出现 1 个条目，label = compaction/summary 事件 seq |
| 5 | 8 段 summary 原文（prepared face） |
| 6 | `:raw` = 被 shadow 的原文（含第 3 步文件内容），**不含** summary 的 `## ` 段落 |
| 7 | 第二条目 `replaces_checkpoint` = L1 的 checkpoint_seq（嵌套链） |
| 9 | **嵌套后 L1 原文仍可读**（log 永不删除 ⇒ 全链可寻址） |
| 10 | `/original:1-5` 行窗作用于 canonical |

已知边界（非缺陷）：`ctx://model`/`ctx://cwd` 一级 key 已按 spec 移除（信息卡并入 `ctx://session`）；未挂 fs backend spike 时原生 read 不解析 scheme（chassis 内 URL branch 承担全部 scheme 寻址）。

## 环境事实

- 实例：4999（systemd `dsh-4999-test`，restart = `systemctl --user restart dsh-4999-test`；日志 `.scratch/dsh-4999.log`；2026-09-12 自 4986 迁入）
- 事故记录：4988 为 superd multi-context PoC 占用（AGENTS §二 勿杀）——首轮启动误占即 EADDRINUSE（loud fail，符合预期）后改 4986；2026-09-12 user 指令下线 omp-web-4999-test / omp-web-lan-4999-relay 后迁入 4999。
- 构建链：canonical rsync → devDeps 手术（14 × workspace:*）→ `pnpm --filter better-dsh exec tsdown` → `tsx scripts/build-client.ts`。

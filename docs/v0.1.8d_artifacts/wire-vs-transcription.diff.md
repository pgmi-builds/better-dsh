# Wire 捕获 vs 模型转写 vs checkout 源码 — 三角对照

- **对照时间**: 2026-08-27 10:20 HKT
- **三个样本**:
  - **W(wire)**: `dsh-session-session-4a293388-….jsonl` 内 3 条 `request/header` 记录的 `tools` 数组(04:20:23 / 04:23:56 / 04:25:25,三者逐字节一致)——**本会话早期回合的 wire 原貌**(日志身份已验证:session id、cwd、首条 user message 与本对话逐字相同;04:35 被导出存放在本目录,先于 10:15 的当前回合)
  - **T(transcription)**: `functions.json`,模型对 10:15 当前上下文的逐字转写
  - **S(source)**: `/home/u1/.local/lib/node_modules/@deepseek-ai/dsh` checkout 内的工具声明源码

## 总量结果

| 维度 | 结果 |
|---|---|
| 工具数 | W = T = 25,名称与顺序完全一致 |
| 语义全同 | **19 / 25**(含 `bash`、`workflow` 的超长 description 逐字一致) |
| 有差异 | 6 / 25,全部为短句/字段级,集中在 goal / todo / subagent_fork / workflow 参数 |

## 差异明细(W = 04:2x wire,S = checkout,T = 10:15 我所见)

| # | 位置 | W(04:2x) | T(10:15) | S(checkout) |
|---|---|---|---|---|
| 1 | `create_goal.description` | 多一句 "**Execution rejects non-human and subagent authority.**" | 无此句 | 未验 |
| 2 | `todo_write.description` | 多一句 "**Statuses: `pending` (not started), `in_progress` (being worked on now), `completed` (finished).**" | 无此句 | 未验 |
| 3 | `todo_write` status 参数 description | "in_progress **(now)**" | "in_progress **(being worked on now)**" | 未验 |
| 4 | `update_goal.action` | **有** description:"edit \| pause \| resume \| complete \| blocked" | **无** description | 未验 |
| 5 | `subagent_fork.description` | "…depends on **receiving the** result." | "…depends on **its** result." | 未验 |
| 6 | `workflow.script` 参数 description | "…statement**;** end with…" | "…statement** — **end with…" | **同 W**(分号) |
| 7 | `workflow` phases[].title description | "The **phase title** phase() calls match…" | "The **title** phase() calls match…" | **同 W** |

## 解释

1. **不是转写误差**(对 #1–#4):这些是 W 有、T 无的整句/整字段;它们在 T 对应的当前上下文中确实不存在,转写忠实于所见。
2. **是同会话内的宿主声明漂移**:日志内部 3 个 header(04:20–04:25)逐字节一致,排除日志内漂移;差异全部落在 04:25 → 10:15 的会话挂起窗口,期间宿主经历过重建/重启(与 runtime-context snapshot "supersedes earlier snapshots" 的语义一致)。
3. **代际关系**:S 与 W 在两处可验锚点(#6、#7)上一致,属同一代;T 比两者都新。即 checkout 落后于当前部署一代。
4. **漂移方向值得注意**:新代**删掉了** #1、#2、#4 的语义内容(权限拒绝说明、状态枚举说明、action 枚举描述)——工具声明文本在宿主升级中不是单调增长的;对依赖目录文本做探针/断言的方法论(如 v0.1.8d 报告的 catalog 探针),这意味着**目录文本没有跨重启的稳定性保证**。

## 修正(v2,2026-08-27 13:50 —— 完整日志推翻"时间轴漂移"解释)

用户随后存入的完整日志(`dsh-session-….jsonl`,2.2MB,3890 条,覆盖 04:21→11:17 共 8 个 turn)提供了新证据:

| 新证据 | 内容 |
|---|---|
| 完整日志含 **5 个** `request/header` | 04:20:23 / 04:23:56 / 04:25:25 / 10:11:26 / 10:11:55,**五者 tools 数组逐字节一致(全部旧代)** |
| 10:11 之后的 turn(10:44 / 11:04 / 11:13)无新 header | 与 "request-cache stability"(cordis.patch.yml 明文)一致:未变的请求前缀复用,不再重记 header |
| 首次 `write functions.json`(10:17:46)的 arguments 与磁盘现文件逐字节一致 | 我的转写在 10:17 就已是**新代文本**(`being worked on now`/`its result`/`The title`,且无 `Execution rejects`/`Statuses:`) |

**结论修正**:上节"漂移窗口 04:25→10:15 宿主换代"的**时间轴解释作废**。事实是:

1. **wire 通道从未变过**——从 04:20 到 10:11:55(乃至后续无 header 记录的 turn),client 发出的 JSON 一直是旧代。
2. **渲染通道在会话挂起后(10:11 恢复)已是新代**——10:17 的转写与我现在上下文里的 `<functions>` 块均为新代。
3. 即:**client→LLM 的请求 JSON 与 模型侧实际渲染进 token 流的工具声明,是两件不同步的产物,可以同时各持一代**。差异不是"先后",是"并行"。

**机制推断**(标注为推断,与观测一致):会话恢复时,请求侧从事件存储**重放**了 session 创建时存储的 header(tools 逐字节旧代,event-sourcing 语义),而模型可见上下文由 projection 层从**当前代**定义重新渲染(`dsh-session-projection`/`-cache` 包存在支持此路径)。两个未决子假设:(H1) 04:20 当时的渲染也是旧代、10:11 恢复时被整块换掉——若成立,连"我的前缀自会话开始就连续"都是重构出来的幻觉;(H2) 渲染从 04:20 起就与 wire 不同源。日志内无证据可裁决二者。

**对第一人称方法论的冲击**(比 v1 更深):v1 说"转写只对产生它的那一代宿主有效"——v2 的坏消息是,模型**连"自己上下文属于哪一代"都无法从内部判定**。wire 与渲染物的代际差只能靠宿主侧日志发现;模型对自身 prompt 的任何断言,在存在会话恢复/投影重建的部署里都是不可信的。

# 上游 dsh 0.1.2-alpha.5 / rc.1 → 0.1.3-alpha.2 差异调研报告

- 调研日期：2026-09-08（本机复核日；上游 rc.1 发布 2026-09-03、alpha.2 发布 2026-09-07T13:11Z）
- 方法：**clean source git diff，非 npm tarball**。本机 `upstream/deepseek-harness` checkout 拉取 `dsh-v0.1.2-rc.1` / `dsh-v0.1.3-alpha.1` / `dsh-v0.1.3-alpha.2` 三个 tag 后，以 tag 树间 diff + 仓内 `.agents/notes/implemented/` 设计笔记 + npm registry 事实三源互证。文件/行数口径：`dsh-v0.1.2-alpha.5` vs `dsh-v0.1.3-alpha.2`（rc.1 与 alpha.5 代码零差，等价）；commit 数口径：`rc.1..alpha.2`（rc.1 是 alpha.2 的祖先，范围线性、无歧义）。
- 版本事实：
  - **rc.1 = release-only**：`alpha.5..rc.1` 只有 2 个 commit——release commit `a66e470204`（`release(dsh): 0.1.2-rc.1`，2026-09-03）+ 1 个空 merge（`5a69ba1cdd` Merge PR #3445，把 alpha.5 发布分支并入主线）；代码差**为零**（见专题一）。npm `latest`/`next` dist-tag 均指 `0.1.2-rc.1`——今天裸装 `@deepseek-ai/dsh` 拿到的就是 alpha.5 代码。
  - **alpha.1 = 只 tag 未上 npm**：`dsh-v0.1.3-alpha.1` tag 存在（merge PR #3554，09-04），但 registry `versions` 里 **没有 0.1.3-alpha.1**，0.1.3 线从 alpha.2 起；`alpha` dist-tag = `0.1.3-alpha.2`。
  - alpha.2 tag = merge PR #3685（worktree/release-dsh-0.1.3-alpha.2，09-07）；rc.1 与 alpha.1 均为其祖先（rc.1..alpha.1 = 328，alpha.1..alpha.2 = 316）。

---

## 数字复核表（转述值 → 实测值）

对来源总结逐项复核，两处需修正口径，其余全部精确命中：

| 来源总结 | 实测（本机复核） | 结论 |
|---|---|---|
| rc.1 落后 alpha.5 "1 commit" | `alpha.5..rc.1` = 2 commits（release `a66e470204` + 空 merge `5a69ba1cdd`） | 口径差异；结论不变——代码零差 |
| rc.1 vs alpha.5 "252 文件全 package.json 版本号" | 252 文件，**0 个非 package.json**，diff 行过滤 `"version"` 后**零残留** | ✅ 精确命中 |
| alpha.2 "417 commits" | `rc.1..alpha.2` 共 **644** commits = 227 merges + **417 非 merge**（first-parent 仅 76） | 417 = 非 merge 数；总数 644 |
| "~103k+/40k− across 4.8k files" | 4,866 files，**+103,306 / −39,537** | ✅ 命中 |
| "~59k+/19k− 真实代码（剔 notes/snapshots/docs）" | 仅剔这三前缀 = 1,974 files，**+84,482 / −27,248**——到不了 59k | ❌ **不可复现**（见下"剔除阶梯"） |
| fix 178 / test 97 / docs 53 / ci 11 / perf 9 | 对 644 条 subject 前缀统计：fix **178** / test **97** / docs **53** / ci **11** / perf **9**（另有 refactor 27 / feat 21 / chore 13 / revert 2 / release 3 / merge+other 230） | ✅ 全命中 |
| rc.1 = latest/next；alpha = alpha.2 | `npm view dist-tags`：latest=0.1.2-rc.1, next=0.1.2-rc.1, alpha=0.1.3-alpha.2 | ✅ |
| alpha.1 从未上 npm | `npm view versions` 无 0.1.3-alpha.1 | ✅ |

**真实代码量的"剔除阶梯"（都可精确复现）**：ALL 4,866 files +103,306/−39,537 → 剔 `.agents/notes/`+`snapshots/`+`docs/` 1,974 files +84,482/−27,248 → 再剔 `pnpm-lock.yaml` 1,973 files +83,369/−27,204 → 再剔各包 `tests/`·`test/`·`__snapshots__` 1,366 files +38,948/−11,653。来源总结的 ~59k+/19k− 落在前两档之间，对应的剔除集本机未能还原（可能含更大的生成语料剔除），**引用时以阶梯为准，勿再用 59k 口径**。

主题占比（包组级，alpha.5..alpha.2，实测）：`session*`（session 组全部 8 包）211 files **+25,333/−10,849**；`client*` 358 files +10,871/−2,691；`apps/web` 95 files +2,423/−641；`subagent` 75 files +3,144/−1,955；`api` 64 files +3,695/−985；`core` 71 files +2,919/−1,861；`llm` 68 files +3,011/−493。与来源"dominant areas = client/session/subagent/core/llm/api/apps/web"一致，session 显著居首。

---

## 专题一：rc.1 是一个纯发布 commit——bump 过去只买一个标签

`git diff dsh-v0.1.2-alpha.5 dsh-v0.1.2-rc.1`：252 个变更文件全部是各包 `package.json`，且 diff 内容除 `"version"` 字段外零残留（无 lockfile、无源码、无配置）。rc.1 相对 alpha.5 **功能字节级一致**。

含义：**以 rc.1 为目标 = 白动**（只换 dist-tag 外观）。真正的代码分水岭在 `dsh-v0.1.3-alpha.2`。若只想要"稳定标签"，rc.1 与 alpha.5 无差别；若需要 0.1.3 线的修复，只能走 alpha 通道（alpha.2 起）。

---

## 专题二：session format v2 + 内嵌 assistant 流（落盘/回放契约变更）

**三个 breaking commit 全部落在 omp-web 桥接的会话持久化/回放接缝上**（均实测在 `rc.1..alpha.2` 范围内）：

| commit | subject（实测原文） | 性质 |
|---|---|---|
| `f99b06eaed` (09-01) | `feat(session)!: embed assistant streams in format v2` | 断（格式面） |
| `d1521ea783` (08-31) | `feat(session)!: add released format migration` | 断（迁移面） |
| `bec6805d6a` (08-28) | `refactor(session-persistence)!: handle-based seam with a lifecycle-owned write path` | 断（写路径面） |
| `c58097a826` (08-31) | `feat(session-persistence-jsonl): cross-process write-ownership lease` | 紧邻（lease 即 `session-persistence-omp.ts` 直接对话对象） |

配套证据（tag 树内设计笔记，路径均已核实）：
- `implemented/architecture/2026-09-01-v2-embedded-assistant-streams.md`（v2 内嵌流设计）
- `implemented/architecture/2026-09-05-read-only-session-migration-preparation.md` + `2026-09-06-embedded-stream-record-readers.md`（回放侧按 compact record 读内嵌流）
- `implemented/feature/2026-08-31-cross-process-session-write-lease.md`、`implemented/simplification/2026-08-30-jsonl-only-session-persistence.md`（jsonl-only 收敛 + 跨进程写权）
- 新包齐备：`packages/session/` 下新增 `session-format`、`session-format-catalog`、`session-format-v0-to-v1`、`session-format-v1-to-v2`（src：codec/dispositions/migration/validation）、`session-log-deepseek`、`session-checkpoint-policy`；`session-persistence-jsonl/src` 现含 `lease.ts`/`migration-verifier.ts`/`format.ts`/`generation.ts`/`storage.ts`/`worker.ts`。迁移测试语料是全 diff 最大单体（`v1-to-v2/tests/migration.spec.ts` +1,251）。

流/回放修复链（同簇，非断）：`30e045dfad` `feat(agent): emit live assistant stream frames`；`165cc31eb8` `perf(llm,host): read embedded Assistant streams per compact record`；`7bab91d247` `fix(llm): retain Anthropic resolved model during replay`。

---

## 专题三：persistence 重构主题（读/写/迁移的 perf 潮）

除专题二四枚外，`session-persistence*` 在本范围有一整条 perf 链：prepared reads before publication、streamed migration publication/verification、restore 冻结读（来源总结定性）；`2026-09-04-session-open-performance-gate` 测试笔记佐证"打开会话性能门槛"成为一等关注。对桥接方的含义集中在专题二列出的断点 + lease——即"谁持有某 jsonl 写权、生命周期何时移交、跨进程并发写如何排他"，这正是第三方持久化实现需要对齐的契约。

---

## 专题四：其余主题簇（非断，但升级需知）

| 簇 | 证据（实测 subject，均 in-range） | 备注 |
|---|---|---|
| **str_replace_editor 默认下架** | `36a4665144` `feat(base): remove str_replace_editor from default tools`；`965adbb5cf` `feat(sdk): disable str_replace_editor by default` | 笔记 `2026-09-05-base-default-file-editor`；升级后默认工具面少一个 editor |
| **outbound 全走 proxy** | `545e2ad914` `feat(net): route every outbound request through the configured proxy` | 未配 proxy 时无行为变化 |
| **read_image 图片卡** | `56ca8af0ee` / `a4d4404708`（ui-tool 渲染嵌套/直接 read_image 结果为图） | 前端渲染面 |
| **通用文件存储 + 提交生命周期流式** | `bafa6ae11d` `feat(conversation): stream files through submission lifecycle` | 附件面 |
| **agent/UX** | `48cc1cf1d6` `feat(agent): announce model switches`；`96ead6091d` `feat(subagent): align human inbox controls`；`040d73871b` `feat(agent-team): unify messages on steer` | |
| **message-edit：landed 又 revert** | `ef88756f13`（09-02）`feat(session, agent, web): support same-session message editing` → `e974a655a0`（09-02）`Revert "…"` | 同日往返；**别按该 feat 写适配** |
| **telemetry/feedback：default-on 又回滚** | `02a029e679` feedback 记录进 session log、`9ffe85a512` OTel 默认全量上传统计 → `13daefe073` `revert(session-telemetry-otel): leave telemetry on its own transport` | 笔记 `2026-09-05-canonical-feedback-log` / `nonofficial-feedback-otel`；prod 跑 `DSH_TELEMETRY_DISABLED=1`，升级时查 session log 是否开始夹带 feedback 记录 |
| 其余重churn | fix 178 / test 97 / docs 53 / ci 11 / perf 9；web-heavy（sending states、skill chips、terminal cards、session reveal） | 体积主导：`.agents/notes`（含 notes i18n.yaml 迁移与 archived manifest.json 重组，~2.4k files）+ session/client 组 |

---

## 对本线（omp-web 桥 + dashr 测试线）的含义

1. **对 omp-web 不是 drop-in bump**。format v2（`f99b06eaed`）+ released migration（`d1521ea783`）+ handle-based seam（`bec6805d6a`）+ 写权 lease（`c58097a826`）恰好是 `session-persistence-omp.ts` / `replay.ts` 桥接的契约面。升级 = 一次 upstream-alignment 适配轮：diff 载体 → 新格式读写 + lease 语义对齐 → 迁移读兼容验证 → 冒烟，按所在仓的 AGENTS.md 节奏（dashr 侧即 S1–S7）。
2. **别追 alpha.1**：npm 无该版本，registry 线从 alpha.2 起；本地 tag 在库即可，发布侧不存在。
3. **dashr 自己的 4999 测试线（现 alpha.5）将来对齐 alpha.2 时的 S7 盯点**（本轮不执行）：默认工具面少 `str_replace_editor`（工具清单对比）；session 落盘格式迁移（老 session 读兼容靠上游 released migration，验收一条老会话打开）；`__DSH_TRANSPORT__`/`connection` 行/`AppFrame` 语义属性的行形状是否被 web-heavy churn 漂移（upstream-alignment.md S7.5 三处 + S7.8 两处查表在切换轮现查）；telemetry 默认面变化对 `DSH_TELEMETRY_DISABLED=1` 立场的验证。
4. **数字口径提醒**：引用本报告数字时用复核表/剔除阶梯的实测值；"417 commits""~59k real code"两个转述口径已修正。

---

## 参考索引

| 主题 | 证据 |
|---|---|
| rc.1 release-only | commit `a66e470204`；`git diff alpha.5 rc.1` = 252 package.json，版本号-only |
| format v2 / 内嵌流 | commit `f99b06eaed`；笔记 `implemented/architecture/2026-09-01-v2-embedded-assistant-streams.md` |
| released 迁移 | commit `d1521ea783`；包 `packages/session/session-format-v1-to-v2/`（codec/migration/validation） |
| handle seam | commit `bec6805d6a`；`session-persistence-jsonl/src/{lease,storage,worker,migration-verifier}.ts` |
| 写权 lease | commit `c58097a826`；笔记 `implemented/feature/2026-08-31-cross-process-session-write-lease.md` |
| jsonl-only 收敛 | 笔记 `implemented/simplification/2026-08-30-jsonl-only-session-persistence.md` |
| 回放读内嵌流 | commit `165cc31eb8`；笔记 `implemented/architecture/2026-09-06-embedded-stream-record-readers.md` |
| 迁移只读准备 | 笔记 `implemented/architecture/2026-09-05-read-only-session-migration-preparation.md` |
| message-edit 往返 | commit `ef88756f13` / revert `e974a655a0`（均 09-02） |
| telemetry 往返 | commit `02a029e679`/`9ffe85a512` → revert `13daefe073`；笔记 `…/2026-09-05-{canonical-feedback-log,nonofficial-feedback-otel}.md` |
| editor 下架 | commit `36a4665144` + `965adbb5cf`；笔记 `simplification/2026-09-05-base-default-file-editor.md` |
| proxy 全覆盖 | commit `545e2ad914` |
| 图片卡 / 文件流 | commit `56ca8af0ee`/`a4d4404708`/`bafa6ae11d` |
| agent/UX | commit `48cc1cf1d6`/`96ead6091d`/`040d73871b` |
| 体积与类型 | 复核表 + 剔除阶梯；session 组 +25,333/−10,849 居首 |

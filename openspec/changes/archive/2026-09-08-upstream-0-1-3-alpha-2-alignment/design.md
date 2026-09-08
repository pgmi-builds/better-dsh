# Design — 上游 0.1.3-alpha.2 对齐轮 + 事件报告小修批次

> 所有结论均为 2026-09-08 一手核验（dashr checkout：`upstream/deepseek-harness` 三 tag 已拉齐；dashr canonical + monorepo 副本对照）。差异总量与主题簇详见 S0 报告 `docs/50_test-reports/upstream-dsh-0.1.3-alpha.2-report.md`。

## 1. 对齐预查结论（S1 前置侦察已完成的部分）

### 1.1 版本契约：peer 范围兼容，无需改版

- alpha.2 各子包版本 = `0.1.3-alpha.2`（抽查 client-connection / host-webserver / bundle base+web-app / core-agent 全部一致）。
- dashr peer 范围 = `>=0.1.2-alpha.1 <0.2.0-0` → **0.1.3-alpha.2 落在范围内**；monorepo `linkWorkspacePackages` 按 name+version 链到 workspace 副本不受影响。唯一历史坑（stale `dsh-client-runtime` peerDep，rsync 回带）仍在 S3 重删清单。

### 1.2 S1 patch 载体：tag 间均有 diff → S2 必须核验重放

| 载体 | alpha.5→alpha.2 diff | 含义 |
|---|---|---|
| `package.json` | 有（版本号） | 无冲突风险 |
| `pnpm-workspace.yaml` | +8/−1 | 本地 storeDir/verifyDepsBeforeRun/allowBuilds 补丁上下文可能移位 → stash pop 冲突需手工核验；alpha.2 tag 树已自带 `allowBuilds:`（34 行） |
| `packages/client/tsdown.client.ts` | ±1 | `resolveRepositoryRoot` 本地补丁**上游未吸收**（两 tag 树均 0 命中）→ 本地补丁仍是必需，重放核验重点 |

### 1.3 dashr patch 重述行：目标全部在位（无重述失效）

`dashr/cordis.patch.yml` 四组行（`dashr-repl` insert、`compaction-basic`/`command-compact`/`tool-result-pruner` re-enable、`connection` 整行重述）在 alpha.2 web-app `cordis.patch.yml` 中 id 全部存在、形状未变（connection 行 `trustedHosts: !!js ctx.webRuntime.trustedHosts` 位置 176→无形状漂移）。

### 1.4 S7 行形状五处预查（本 turn 已做，进查表）

| # | 上游文件 | a5→a2 | 对 dashr 的结论 |
|---|---|---|---|
| ① | `packages/bundle/web-app/cordis.patch.yml` | **改** | connection 行形状未漂移；改动为 persona 行 `persona`→`personaPrefix/personaSuffix`（dashr 不重述该行，无影响）、新增 `open-in-app`/`ui-open-in-app`/`file-upload` 行、删除 `tool-str-replace-editor disabled` 行（base 已默认下架） |
| ② | `packages/client/connection/src/client/index.ts` | **改** | `ConnectionConfig`→`ConnectionRecoveryConfig` + 新增**可选**全局 `__DSH_CONNECTION_RECOVERY__`；`__DSH_TRANSPORT__` 读法与 `isLoopback` 消费点不变 → web-trust.ts isLoopback 腿无需改（缺省无害） |
| ③ | `packages/client/ui-layout/src/client/AppFrame.tsx` | 零 | `data-sidebar-collapsed` 语义不变 → mobile client 面安全 |
| ④ | `apps/web/index.html` | 零 | viewport meta 基线不变 → zoomGuard 安全 |
| ⑤ | `packages/host/webserver/src/injections.ts` | 零 | head 注入位置不变 → zoomGuard reconcile 路径安全 |

### 1.5 行为面（S7 冒烟对照项，源自 S0 报告）

- 工具面：`str_replace_editor` 自 base 默认下架、web-app 删除禁用行（dashr 无引用）；net 请求全走 proxy（未配即无行为变化）；工具清单对比即可。
- session 面：format v2 + released migration + handle seam + lease 四断点——dashr **不解析宿主 session jsonl**（命中均为会话对象/工具会话语义）→ 影响间接；冒烟验一条 alpha.5 老会话在 alpha.2 打开（读兼容走上游 migration）。
- telemetry：feedback 进 session log + OTel 默认全量已 revert（`13daefe073`，telemetry 留在自有 transport）；`DSH_TELEMETRY_DISABLED=1` 立场冒烟复核。
- message-edit：landed 后同日 revert（勿按 feat 适配）；断点 commit 群 = 对齐轮回归的定向锚。

## 2. 事件报告小修设计

### 2.1 附 A 定稿回填（drift 修正）

- 现状：monorepo 副本 `packages/better-dsh/better-dsh/src/index.ts:1261` 已是定稿句（deniable/denied · per-call，即当前运行实例快照）；**canonical `dashr/src/index.ts:1261` 仍为旧句**（`Restricted operations may be retried once … pending user approval`）——附 A 定稿改在 dev 副本未回填 canonical（AGENTS.md 明令的漂移方向，须回填）。
- 动作：canonical 字符串替换为定稿（字节对齐副本）；`dashr/test/presentation.spec.ts` 措辞断言同步（现断言旧 token）；`openspec/specs/escalation-guidance/spec.md` 基线更新。
- 语义决策（产品面，来自附 A/B 定稿）：per-call、runtime 无配额记录、deny 只作用于该 call、预升级与 deny 后升级同为合法路径（deniable 与 denied 并列中立覆盖）；注入只在 `workspace-write` 生效。

### 2.2 附 C 矛盾子句：结案——不进模型可见面（2026-09-08 实证）

- 上游事实（不变）：矛盾句在 alpha.2 **原样存续**（tool-bash/tool-pwsh src 0 diff，全树 38 处含 35 快照）；README 版无此句（次级漂移）；runtime 无 prior-denial 状态检查（纯 prompt 层规范）；上游 PR 路线已关闭（2026-09-03 裁决）。
- **渲染实证（本 turn）**：`dashr:tool-catalog` 由 `renderReplBridgeInstructions`（py-sdk.ts）生成，默认 `'signatures'` 模式只发**每工具一行签名**（`tool.<name>(args: {…}) -> …`，`compactSketch(parameters)`）；`collectSdkSchemas` 虽收集 `schema.description`，渲染器不使用。bash/pwsh **不在** `MASKED_TOOL_NAMES`（= skill/send_message/report/list_agents/subagent_fork/interrupt_agent/workflow/ralph），但它们的 description 散文从不进入 prompt 文本——运行实例（dashr 面）装配产物即证：无任何 bash/pwsh 散文。
- **结论**：附 C「模型读到自相矛盾句」的前提在 dashr 会话**不成立** → **不做 dashr 侧描述订正**；豁免语义裁决保留为纯语义记录（附 A 定稿的 deniable/per-call 已覆盖其冗余语义）。
- **收尾动作**：4999 S7 抓装配/首请求产物 grep 该句（预期 0 命中，实证闭环）；上游文本缺陷记为上游面 Open item（PR 通道关闭；仅当未来 catalog 渲染 description 散文时重开本项）。

### 2.3 write 工具挂起/透传回归（事件报告建议 3）

- 同日本地实测链路已过 → 缺陷疑为环境/构建相关（或已修复）。
- 本批动作 = 回归矩阵纳入 S7：`write`/`edit`/`undo_last_edit` × workspace-write/read-only 基线 × 升级路径（denial marker + affordance → 单次升级 → 审批）；结果入 local-test 报告。prod 3080 复测属 prod 升级 ops（user 驱动），不在本 change。

## 3. 变更面清单（代码）

| 文件 | 动作 |
|---|---|
| `dashr/src/index.ts` | guidance 句回填定稿（附 A）——**无附 C 代码改动** |
| `dashr/test/presentation.spec.ts` | 措辞断言 → 定稿 token（无附 C 断言） |
| `openspec/specs/escalation-guidance/spec.md` | 基线措辞同步（allowed-once→deniable/denied per-call；MODIFIED only） |
| `dashr/package.json` | 版本 bump **v0.2.3**（user 定稿 2026-09-08；发布按红线另行） |
| `docs/60_exploration-and-research/05-dashr-dev/upstream-alignment.md` | S7 查表追加 §1.4 预查结论 |
| `AGENTS.md` | 测试线版本事实 alpha.5→alpha.2（对齐轮完成后） |

## 4. Open items / 决策记录

- **版本编号**：**v0.2.3**（user 定稿 2026-09-08）；0.2.2-c 后措辞微调与附 C 类 bug 攒批并入本批次。
- **附 C**：已结案（不暴露，无订正/fallback 面）；仅当 catalog 未来渲染 description 散文时重开。
- **对齐轮若现上游回归**：按 S0 报告主题簇定向处理，进 local-test 报告"发现的瑕疵"节，按 AGENTS.md 攒批或回写。
- **prod（3080, alpha.3 npm + better-dsh）升级**：不属于本 change（红线：4999 报告 → user 确认 → 按 Dev/Test 2/发布流程）。

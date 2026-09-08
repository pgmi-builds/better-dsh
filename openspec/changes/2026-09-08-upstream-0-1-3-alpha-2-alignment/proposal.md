# 上游 0.1.3-alpha.2 对齐轮 + 事件报告小修批次

## Why

本仓只承担 dashr（better-dsh 插件）自身的上游对齐（omp-web 不在此范围）。上游已发布 `0.1.3-alpha.2`（npm `alpha` dist-tag；`latest`/`next` 仍指纯发布版的 `0.1.2-rc.1`，其相对 alpha.5 **代码零差**）。本仓 dev/test 线（4999 实例，`upstream/deepseek-harness`）现停在 `dsh-v0.1.2-alpha.5`，距上游当前线落后一整档；差异分析报告已落 `docs/50_test-reports/upstream-dsh-0.1.3-alpha.2-report.md`（S0 完成）。

对齐预查（本 change 的 design.md 与 S0 报告，全部一手核对）表明：dashr 的 peer 契约（`>=0.1.2-alpha.1 <0.2.0-0`）与 patch 重述行目标在 alpha.2 **全部兼容/在位**，S7 五处行形状中三处零改动、两处形状未漂移——本轮是**验证型对齐**而非接口改造。批次内有一个真实 drift 需修复、一个文本疑点需结案：

1. **附 A 定稿回填 drift**：`2026-09-06-write工具sandbox升级透传bug复发及挂起-事件报告.md` 附 A 定稿的 escalation-guidance 措辞（deniable/denied · per-call）已实装于 monorepo dev 副本（本实例运行快照即此句），**canonical `dashr/src/index.ts` 仍是旧措辞**（allowed-once），且 `openspec/specs/escalation-guidance/spec.md` 基线描述旧语义——回填 + spec 同步。
2. **附 C 矛盾子句：结案为不暴露**：该句是上游 bash/pwsh 的 schema `description` 散文，dashr 的模型可见 catalog（`dashr:tool-catalog`）为 signature-only、不渲染 description（实证 2026-09-08，见 design §2.2）→ **不做 dashr 侧订正**，仅记录为上游面 Open item（PR 通道关闭）。

## What Changes

- **测试线对齐轮（S1–S7）**：`upstream/deepseek-harness` alpha.5 → `0.1.3-alpha.2`，patch 重放（三载体均有 tag 间 diff，S2 须核验 stash pop 干净或按备份手工重放）、安装/构建/副本重定位、4999 启动、S7 冒烟全清单（含工具清单对比：`str_replace_editor` 已自 base/web-app 默认下架；老会话打开读兼容；file-tool 升级矩阵回归——事件报告回归项）。产出 `docs/50_test-reports/upstream-dsh-0.1.3-alpha.2-local-test-report.md`。
- **附 A 定稿回填 canonical**：`dashr/src/index.ts` escalation-guidance 注入句 → 定稿（与 monorepo 副本字节一致）；`dashr/test/presentation.spec.ts` 措辞断言同步；`openspec/specs/escalation-guidance` 基线更新为 deniable/denied · per-call 语义。
- **附 C 实证结案**：S7 抓装配/首请求产物 grep 矛盾句（预期 0 命中）闭环；上游文本缺陷记为上游面 Open item，不进入 dashr 代码。
- **文档回填**：upstream-alignment.md S7 查表追加本轮预查结论（五处状态 + alpha.2 事实）；AGENTS.md 测试线版本事实更新；若对齐轮发现新坑回写 AGENTS.md。

## Capabilities

### New Capabilities

（无新增能力——本轮为对齐 + 语义订正，不引入新运行时面。）

### Modified Capabilities

- `escalation-guidance`：注入文本语义从 allowed-once（retried once … pending approval）改为 **deniable/denied · per-call**（附 A 定稿回填 canonical + spec 同步）。
- （对齐轮属运行/回归活动，不新增 capability；`tool-surface` 既有规范随 S7 工具清单对比复核，如发现 drift 另行 change。）

## Impact

- **代码**：`dashr/src/index.ts`（guidance 句回填定稿）、`dashr/test/presentation.spec.ts`（措辞断言同步）、`dashr/package.json`（版本 bump **v0.2.3**）。
- **流程/环境**：`upstream/deepseek-harness` 切 tag 至 alpha.2 并重构建；`.dsh-test` profile 重链核验（bundle 名 `@deepseek-ai/dsh-base`/`dsh-web-app` 在 alpha.2 未变）；4999 重启（systemd-run）。
- **验证**：S7 冒烟全清单（diff report §对本线含义 已列盯点）；vitest（guidance 文本断言）；矛盾句 0 命中实证（附 C 结案）；老会话读兼容 + file-tool 升级矩阵（事件报告建议 3）；CDP 侧 mobile/zoomGuard 回归（AppFrame/viewport/injections 三处零改动，属确认型）。
- **文档**：`docs/50_test-reports/` 新增 local-test 报告；upstream-alignment.md S7 查表；AGENTS.md。
- **风险**：S2 patch 重放冲突（三载体 tag 间 diff 已确认存在，resolveRepositoryRoot 等本地 patch 上游未吸收，需手工核验）；测试线切 alpha.2 后如现上游回归，按 diff report 主题簇定向回退。发布与 prod 升级严格按 AGENTS.md 红线（实测 + 报告 + user 确认）另行执行，不在本 change 内。

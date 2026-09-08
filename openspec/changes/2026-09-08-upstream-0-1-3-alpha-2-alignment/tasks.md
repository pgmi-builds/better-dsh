# Tasks — 上游 0.1.3-alpha.2 对齐轮 + 事件报告小修批次

> 状态标记：`[ ]` 待办 / `[x]` 完成。验收注释以 `#` 尾注。G1 对齐轮为顺序执行（S1→S7）；G2 小修可先于或并行于 G1 的构建窗口。

## G0 前置确认（user 决策项）

- [ ] 0.1 版本编号：**v0.2.3**（user 定稿 2026-09-08）。  # 发布按 AGENTS.md 红线另走，本 change 只定 package.json 版本
- [ ] 0.2 附 C 结案确认：矛盾子句不进入 dashr 会话模型可见面（catalog=signature-only、description 散文不渲染，实证见 design §2.2）→ **不做 dashr 侧描述订正**；若未来 catalog 改渲染 description 散文则重开此项。

## G1 对齐轮：dev/test 线 alpha.5 → 0.1.3-alpha.2（S1–S7）

- [ ] 1.1 **S1 侦察**：`git ls-remote --tags origin` 三 tag 在位（本机已拉齐 rc.1/alpha.1/alpha.2）；三 patch 载体（package.json / pnpm-workspace.yaml / tsdown.client.ts）tag 间 diff 复核（预查见 design §1.2——tsdown.client.ts ±1、pnpm-workspace.yaml +8/−1，resolveRepositoryRoot 上游未吸收）。
- [ ] 1.2 **S2 切换与 patch 重放**：`git diff > .scratch/alpha5-local-patches-backup.patch` → checkout -- pnpm-lock.yaml → stash（package.json/pnpm-workspace.yaml/tsdown.client.ts）→ checkout `dsh-v0.1.3-alpha.2` → stash pop；冲突按备份手工重放。验证三 patch 在场：`grep -c '"unrun"' package.json` / `grep -c 'storeDir|verifyDepsBeforeRun' pnpm-workspace.yaml` / `grep -c 'resolveRepositoryRoot' packages/client/tsdown.client.ts`。  # 预查提示：pnpm-workspace 上下文可能移位；a2 tag 树自带 allowBuilds 行
- [ ] 1.3 **S3 副本地化**：重删 rsync 回带的 stale `dsh-client-runtime` peerDep（副本 package.json 的 peerDependencies + peerDependenciesMeta）；`pnpm-workspace.yaml` allowBuilds 保持 `zeromq: true`；确认 alpha.2 各包版本（0.1.3-alpha.2）在 dashr peer 范围（`>=0.1.2-alpha.1 <0.2.0-0`）内（design §1.1，预期无需改）。
- [ ] 1.4 **S4/S5 安装与构建**（`set -o pipefail`）：`pnpm install`（store 已重定向 .scratch/pnpm-store，错误读全文）；`pnpm run build`；`pnpm --filter better-dsh exec tsdown`；**tsdown 后必须** `cd packages/better-dsh/better-dsh && ../../node_modules/.bin/tsx scripts/build-client.ts`（lib/client 清洗陷阱，AGENTS.md）。
- [ ] 1.5 **S6 启动 4999**：`systemctl --user stop dsh-4999-test` → `systemd-run --user`（WorkingDirectory/DSH_HOME=.dsh-test/日志 .scratch/dsh-4999.log）→ 从日志取 `?token=` URL；`DSH_HOME=… npm run dsh -- web --dump-config | grep -A3 dashr-repl` 验证工具行 + `DASHR_KERNEL_PYTHON`。  # 沙箱会话重启必须 systemd-run（嵌套沙箱 bwrap 探测失败）；user bus 被拒时单命令 danger-full-access
- [ ] 1.6 **S7 冒烟**：
  - 工具行/工具清单对比：dashr-repl 在位；默认工具面无 `str_replace_editor`（对照 alpha.5 清单）。
  - 会话读兼容：一条 alpha.5 老会话在 alpha.2 打开（session format v2 released migration 生效）。
  - client 卡片：鉴权拉 shell 页 grep `"id":"better-dsh"` boot 行 → curl `/plugins/??better-dsh/client.js&rev=…` 200 且与 `lib/client/index.js` 字节一致。
  - 行形状查表（预查已收敛，见 design §1.4）：connection 行 / `__DSH_TRANSPORT__` / `data-sidebar-collapsed` / viewport meta / head 注入五处复核落报告；persona 行键变化（personaPrefix/Suffix）与 dashr 无交集复核。
  - fence/isLoopback 双腿：`DSH_TRUSTED_HOSTS=probe.example` → `Host: probe.example` /api 401 vs `Host: evil.example` 403；boot script `__DSH_TRANSPORT__` + `__DASHR_MOBILE__` 在场。
  - zoomGuard：browser/standalone 两形态 CDP 抽查（④⑤ 零改动，确认型）。
  - telemetry：`DSH_TELEMETRY_DISABLED=1` 立场复核（feedback 默认面已 revert，见 S0 报告）。
- [ ] 1.7 **file-tool 升级矩阵回归（事件报告建议 3，并入 S7）**：`write`/`edit`/`undo_last_edit` × workspace-write 与 read-only 基线 × 越界→denial marker+affordance→单次升级→审批→落盘成功；全程无挂起/字段丢失。  # 结果入 local-test 报告；同日本地复测链路为对照
- [ ] 1.8 **报告**：`docs/50_test-reports/upstream-dsh-0.1.3-alpha.2-local-test-report.md`（骨架沿用 alpha.5 报告：实测范围与结果表 → 环境事实 → 重点观察 → 发现的瑕疵（定性+去向）→ 流程化产出 → Open items）。
- [ ] 1.9 **文档回填**：`upstream-alignment.md` S7 查表追加 §1.4 预查结论（五处状态一行式）；AGENTS.md 测试线版本事实（alpha.5→alpha.2 需在实测通过后更新）；新坑回写 AGENTS.md/速查表。

## G2 事件报告小修

- [ ] 2.1 **附 A 定稿回填 canonical**：`dashr/src/index.ts` escalation-guidance 注入句替换为定稿（与 monorepo 副本字节一致：deniable/denied · per-call 句）。  # 回填后 canonical 与副本 diff 收敛（drift 消除）
- [ ] 2.2 **测试同步**：`dashr/test/presentation.spec.ts` 措辞断言 → 定稿 token（含断言不含 'retried once'/quota 措辞）。  # vitest 绿 + tsc 0
- [ ] 2.3 **附 C 实证（替代订正实现）**：4999 S7 抓装配/首请求产物 grep `already denied the same access` —— 预期 **0 命中**（dashr:tool-catalog 为 signature-only，`renderReplBridgeInstructions` 不使用 `schema.description`）；意外命中 → 回报重议（design §2.2）。
- [ ] 2.4 **结案记录**：render 证据与实证结果写入 local-test 报告 + upstream-alignment S7 注记；上游文本缺陷（tool-bash/pwsh schema description + 35 快照）存续且 PR 通道关闭 → 记为上游面 Open item，不进 dashr 代码。
- [ ] 2.5 **spec 同步**：`openspec/specs/escalation-guidance/spec.md` 基线更新为 deniable/denied · per-call（MODIFIED）；本 change 的 delta 仅含 MODIFIED Requirements（无描述订正 ADDED）。
- [ ] 2.6 **回归**：G2 全部改动后 vitest 全量 + tsc 0；`dashr/cordis.patch.yml` 未受影响复核。

## G3 收口

- [ ] 3.1 全量 vitest + tsc 0 + 4999 冒烟通过后：canonical → monorepo 副本 rsync（方向正确：canonical 源 → 副本）并重构建 client 半（若 canonical 有改动）。
- [ ] 3.2 版本：`dashr/package.json` bump（编号见 G0.1）；本地 commit + tag（发布与 prod 部署按年龄门/红线另走，不在本 change）。
- [ ] 3.3 报告与文档复核：local-test 报告 + S0 报告 + upstream-alignment S7 查表 + AGENTS.md 事实一致。
- [ ] 3.4 user 验收：4999 实例功能实测放行确认（第一人称实测 → user 确认两道闸，AGENTS.md §0）。

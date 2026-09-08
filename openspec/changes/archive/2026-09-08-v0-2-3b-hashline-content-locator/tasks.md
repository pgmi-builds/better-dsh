## 1. 实现

- [x] 1.1 **schema v7**：`hash-store.js` served 新 DDL（path 主键）、语句面去 session 参、`servedWipeStmt` 删、`HASH_STORE_VERSION` 6→7、防御检查反转（含 `session_id` 列即 DROP 重建）。
  - 证据：`hash-store.js:155-165`（防御反转 + 新 DDL）、`:178-185`（语句面）、域方法 `getServed(path)` 族；`constants.js` v7。
- [x] 1.2 **sessionKey 管道拆除**：`session-view.js`（API 去参 + `sessionKeyFor/execSessionKey/fallbackSessionKey` 删）、`read-and-serve.js`、`mutation.js`、`edit-engine.js`、`anchor-pipeline.js recordEchoServes`、四工具调用面、`.d.ts` 同步。
  - 证据：`grep -rn sessionKey src --include=*.ts`（vendored 外）零残留。
- [x] 1.3 **集中存储**：`paths.js configDir()` 无参化 → `$DSH_HOME/storages/dsh-better-edit`；`resolveDshHome()` 接线（DSH_HOME 感知）。
  - 证据：`paths.js:14-26`；单测断言库落位与无点目录。
- [x] 1.4 **内容快道**：`verifyServedRange` 早返（账本双界未见 → 内容放行）+ 歧义/单边回落（`E_RANGE_UNVERIFIED` 新文案）+ STALE/UNSERVED 保持 + `retryHint` 改 read-once。
  - 证据：`anchor-pipeline.js:456-458,473-478`；单测六态矩阵。
- [x] 1.5 **write-hook 移除**：`write-hook.js`（+.d.ts）删、`index.js` 与 `src/url-schema/index.ts` 安装面摘除；guidance 三节本无 write 回放文案，零改动。
  - 证据：`grep -rn registerWriteHook src/` 零命中。
- [x] 1.6 **测试**：新增 `test/hashline-store.spec.ts` **12/12 绿**（v7 重建、path 键 upsert/merge、TTL prune、集中化与无点目录、跨会话免 read、内容快道六态）。
  - 证据：`npx vitest --run test/hashline-store.spec.ts` → Tests 12 passed。

## 2. 验证

- [x] 2.1 vitest 全量 + tsc：全量 **491 passed / 2 failed**——2 挂项（`snapshotEvents`/`isSeeded`）经 `git stash` 基线复跑证实**先于本改动存在**（上游 alpha.2 类型漂移）；tsc 仅同 3 条既有错，本改动零新增。
  - 证据：`Test Files 2 failed | 35 passed (37)；Tests 2 failed | 491 passed (493)`；stash 基线同 2 挂。
- [x] 2.2 monorepo 同步构建：rsync → `pnpm --filter better-dsh exec tsdown`（**9 files 529.98 kB，lib/index.js**）→ `tsx scripts/build-client.ts`（lib/client/index.js 17.82 kB，md5 `a88850ec…`）→ 4999 systemd-run 重启 active。
  - 新增坑（已亲历并记入报告 §2）：裸跑 `node_modules/.bin/tsdown` 不经 pnpm workspace env 会产出 `.mjs` 形态（boot `ERR_MODULE_NOT_FOUND lib/index.js`）——必须用 `pnpm --filter` 形态。
- [x] 2.3 **4999 第一人称实测**（CDP 驱动真实 agent session，工作区 /home/u1）：S1 write 仅上游确认信封（无锚点回放）→ read 记账中心库（served 列 `path,hashes,reported,updated_at` 无 session_id；行 `/home/u1/probe-v023b.md`；无 `.dsh_better_edit` 点目录）→ S2 新会话盲 edit 被宿主 `E_NOT_OBSERVED`（`dsh-fs-observation-policy` read-before-edit，**设计内守卫，保留**，见报告 §4）→ S2 read 后同参数 edit 成功落盘（`beta line EDITED-BY-v0.2.3b-PROBE`），全程零 E_RANGE_*。
- [x] 2.4 实测报告落 `docs/50_test-reports/v0.2.3b-hashline-content-locator实测报告.md` + 诊断报告 §8 落地回执。

## 3. 收口

- [x] 3.1 AGENTS.md ✅ 条目更新 + 诊断报告 §7 回填落地结果。  # AGENTS ✅ 条目已落（commit 4f9982a/4b296e7，含新坑段）；诊断报告 §8 落地回执已落（2026-09-08）
- [x] 3.2 版本 0.2.3-b（`dashr/package.json` + lock），本地 commit + tag `v0.2.3b`；**publish 另走年龄门 + user 单次确认**（授权单次有效）。  # 0.2.3-b：commit 4f9982a + tag v0.2.3b；npm publish 2026-09-08 18:15 UTC+8（registry dist-tag latest，user 单次确认已获）；prod 装机 18:19 + dsh.service 重启 18:44 上线

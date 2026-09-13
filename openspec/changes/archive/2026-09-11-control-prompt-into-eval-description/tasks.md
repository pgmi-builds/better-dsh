## 1. 指引文件重写

- [x] 1.1 **`eval-description.md` 重写**：`dashr/control-prompt.md` → `dashr/eval-description.md`，按 design D2 六段解剖重写（首句定义 → 参数语义 → 直调 vs cell 判据 → 非 flat 名例外 + `subagent` 别名注记 → 键名正确的示例块 → **末尾桥接段**：统一调用形一句话 + `True`/`False`/`None`，对返回值形态零陈述）。
  - 证据：文件存在；示例中 `read` 的参数键为 `path`（非 `file_path`）；全文无 "This agent has TWO ways to act" 式 system-prompt 口吻（改为工具 description 口吻）；`grep -in "canonical\|试错\|not guaranteed\|trial" dashr/eval-description.md` 零命中。
- [x] 1.2 **描述单测护栏**：`test/presentation.spec.ts` 新增断言——`eval` 注册 description 等于包内 Markdown 文件字节内容；桥接示例引用的参数键 ⊆ 对应工具 wire schema properties 键集合（防 D1 漂移复发）。
  - 证据：`npx vitest --run test/presentation.spec.ts` 绿。

## 2. section 与渲染器拆除

- [x] 2.1 **两 section 注销**：删 `dashr:control-prompt`（`index.ts:1220-1223`）与 `dashr:tool-catalog`（`index.ts:1236-1239`）两个 `systemPrompt.section` 注册块 + `CONTROL_SECTION_ORDER`/`SDK_SECTION_ORDER` 常量及"保缓存形状"注释。
  - 证据：`grep -n "dashr:control-prompt\|dashr:tool-catalog" src/` 零命中。
- [x] 2.2 **eval description 接线**：`EVAL_DESCRIPTION` 常量（`index.ts:253`）删除，注册点（`index.ts:550`）改为 `readFileSync(new URL('../eval-description.md', import.meta.url), 'utf8')`；`EVAL_CELL_PARAM_DESCRIPTION`/`EVAL_DESCRIPTION_PARAM_DESCRIPTION` 与 wire 参数 schema（四参）不动。
  - 证据：`grep -n "EVAL_DESCRIPTION" src/index.ts` 仅剩注册点文件加载；wire schema 仍 `cell/description/timeout/reset`。
- [x] 2.3 **py-sdk 清理**：删 `renderReplBridgeInstructions`、`renderToolsSdkPy`、`collectSdkSchemas`（`index.ts:988`）及仅为其服务的类型/导出；`isFlatBindableName` 保留（`index.ts:905` 绑定安装器在用），文件去留取小动作。
  - 证据：`grep -rn "renderReplBridgeInstructions\|renderToolsSdkPy\|collectSdkSchemas" src/ test/` 零命中；`grep -rn "isFlatBindableName" src/` 安装器调用点健在。
- [x] 2.4 **既有测试重写**：`test/presentation.spec.ts`、`test/surface-devices/surface.spec.ts` 中针对两 section / 声明块 / CONTROL_PROMPT_TEXT 的断言改为新契约（无 DASHR 目录 section；masked 名在 wire + bindings 双面缺席；两表面 flat 名集合相等，仅 `eval` 例外）。
  - 证据：两 spec 文件绿；`grep -rn "CONTROL_PROMPT\|TOOL_CATALOG" test/` 零命中。

## 3. 构建与回归

- [x] 3.1 **单测 + 类型**：vitest 全量 458/14（14 挂 = agent-family+url-schema 既有基线，stash 对照 14/41↔14/41 零差异）；重写三 spec 32/32 绿（presentation 20 + surface 10 + py-sdk 2）；tsc 14 条 = 基线同数零新增。
  - 证据：`npx vitest --run` → `Tests 14 failed | 458 passed (472)`；stash 基线两轮对比记录。
- [x] 3.2 **monorepo 同步构建**：rsync（test/ 不随行）→ `pnpm --filter better-dsh exec tsdown`（8 files 495.94 kB；lib/py-sdk.d.ts 1.0 kB 瘦身态）→ `tsx scripts/build-client.ts`（lib/client/index.js 18.57 kB）；`eval-description.md` 落包根随包发布。**4999 重启挂起**：start 脚本的 systemd-run 需 user-bus，沙箱升级被拒——待 user 终端拉起（`PORT=4989 bash test/start-4999.sh`）后继续 3.3/3.4。
- [x] 3.3 **第一人称实测**（design 迁移计划矩阵 a–e）：实测落在 4989 + 私有 `DSH_HOME=.dsh-test-4989`（共享 home 跨进程锁事故见报告 §3）；user 经 GUI 驱动真实 agent 会话完成全部矩阵项，含 delegation 桥端到端与 D1 补充事实（旧键 `file_path` 经 vendored 别名仍可用——定性为文档正确性修正，报告 §5.1）。
  - 证据：`docs/50_test-reports/2026-09-11-control-prompt-into-eval-description实测报告.md` §2–§3。
- [x] 3.4 **提示面预算复测**：同族 A/B（Sep-06 基线 session vs 本活体）：两 section **−8,759 chars**，残余 +1,944 经行级 diff 定位为 v0.2.3-b hashline 指引（与本 change 无关）；本 change 净效应 −52.6%；`eval` description 2,092（目标 ~2,200 达标）。design 的 prod 绝对值预估系 43 工具口径，与 26 工具 web profile 不可直比。
  - 证据：实测报告 §4（基线 session-851d54da，可复算）。

## 4. 收口

- [x] 4.1 实测报告落 `docs/50_test-reports/2026-09-11-control-prompt-into-eval-description实测报告.md`；`docs/60_exploration-and-research/06-omp-reference/omp-system-prompt-observation.md` §7/§8 回填落地回执（R1/R2/D1/D2 消灭、R3 有意放弃、D3 死代码已删）。
- [x] 3.5 **【发布阻断缺陷，实测中由验证 agent 发现并就地修复】**：`package.json` `files` 仍列 `control-prompt.md` 且缺 `eval-description.md` → 原样发包 = 插件模块期 `readFileSync` ENOENT、加载即死（活体跑源码树看不见此坑）。修复 1 行 + canonical 重建 + `npm pack` 复验（70 files 含新 md，模块期同款 URL 读取成功）。
  - 证据：实测报告 §5.2（含修复前 tarball ENOENT 复现）。
- [x] 4.2 AGENTS.md ✅ 条目更新；版本号 `0.2.3-c`→`0.2.3-d`；commit + tag `v0.2.3d`。（首 commit 误吞 untracked 垃圾含 .credentials.yaml——push 前拦截，软重置重做为白名单 commit，零远端泄漏。）
- [x] 4.3 **npm publish**：user 指令"git push npm publish, bump a alphabet version"= 闸 c 放行；`better-dsh@0.2.3-d` 已发（tarball 69 files 含 eval-description.md、无 control-prompt.md）；prod 3080 未动，待 user 以普通 user 自装实测。
  - 证据：npm publish 输出 `+ better-dsh@0.2.3-d`；tarball 复验记录。

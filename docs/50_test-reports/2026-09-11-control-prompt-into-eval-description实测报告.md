# control-prompt 并入 eval description — 第一人称实测报告

- 日期：2026-09-11
- change：`openspec/changes/2026-09-11-control-prompt-into-eval-description/`（design D1–D4）
- 被测运行时：**本 agent 自己所在的活体实例** —— `dsh web` @ `127.0.0.1:4989`，`DSH_HOME=/home/u1/workspaces/dashr/.dsh-test-4989`，profile `web` bundles = `[@deepseek-ai/dsh-base, @deepseek-ai/dsh-web-app, better-dsh]`，host 源码 = `upstream/deepseek-harness`（0.1.5-rc.2 线），插件来自 workspace 成员 `packages/better-dsh/better-dsh`（= canonical `./dashr` 的 rsync 副本，二者 src 已核为同步）。
- 端口说明：design 迁移计划写作 4999，实际 4997/4998/4999 已被 superd PoC 占用，本轮活体为 **4989**（`PORT=4989 bash test/start-4999.sh`，systemd 单元已起，日志 `.scratch/dsh-4989.log`）。
- 方法：**第一人称实测**——本 agent 的系统提示、wire 工具表、`eval` cell 桥接全部取自这个正在运行的 runtime；wire 侧数据从本会话落盘的 `session.v3.jsonl.zstd`（`request/header` / `system/message` 事件）读取，不由人手转写。

---

## 0. 结论

| 判定项 | 结果 |
|---|---|
| 两 section 是否消失、指引是否单源进 `eval` description | ✅ 通过（活体 wire 证据） |
| cell 内桥接调用（read/grep/bash/glob + delegation） | ✅ 通过（真实调用、返回可读） |
| 非 flat 名直调路径 / masked 8 名路由回文 / `dir(tool)` 内省 | ✅ 通过（无回归） |
| D1 示例键名修正 | ✅ 文档层正确；**行为层非修复**（旧键 `file_path` 仍被别名接受，见 §5.1） |
| 单测 / 类型无新增回归 | ✅ 458 passed / 14 failed（与 pristine HEAD 基线同数）；tsc 13 = 基线 13 |
| 提示面预算 | ✅ 本 runtime 实测 −8,759 chars（−52.6% 等效），Σ description +1,965 |
| **发布面完整性** | ❌→✅ **发现发布阻断缺陷并已修复复验**：`package.json` `files` 未随文件更名更新，`npm pack` 产物不含 `eval-description.md` → 插件模块期 `readFileSync` 必 ENOENT（§5.2） |

**一句话**：change 在运行时行为上完全落地且无功能回归；但**原样发版会把插件打成一个加载即死的包**，已就地修好 `files` 并重建 canonical 产物复验。

---

## 1. 被测对象与构建事实

| 项 | 值 |
|---|---|
| 插件版本 | `dashr/package.json` = `better-dsh@0.2.3-c`（未 bump，任务 4.2 待做） |
| 活体副本产物 | `upstream/deepseek-harness/packages/better-dsh/better-dsh/lib/index.js` 内含 `readFileSync(new URL("../eval-description.md", import.meta.url), "utf8")`（11052 行） |
| 指引文件 | `dashr/eval-description.md` = 2,092 chars；与副本同名文件 **字节相同** |
| canonical 产物 | 本轮用 `tsdown` + `tsx scripts/build-client.ts` 重建：`lib/index.js` 440.07 kB、`lib/py-sdk.js` 0.10 kB、`lib/py-sdk.d.ts` 1.00 kB（渲染器拆除后的瘦身态）、`lib/client/index.js` 18.52 kB |
| 前状态的坑 | 修复前 canonical `dashr/lib` 是 **Sep 11 04:01 的改前产物**（内含 `control-prompt.md` 引用 1 处、`eval-description.md` 0 处），而 `dashr/control-prompt.md` 已删除 → 那个时点打包出来的是「lib 指旧文件 + 包内无新文件」的双坏包（§5.2） |

---

## 2. 静态契约核验

1. **两 section 注销**：`dashr/src/*.ts` 已无 `systemPrompt.section` 注册，`dashr:control-prompt` / `dashr:tool-catalog` 仅剩两处**历史注释**（`src/index.ts:242`、`src/py-sdk.ts:5`）——无注册、无渲染物。
2. **接线单源**：`EVAL_DESCRIPTION`（`src/index.ts:244`）= `readFileSync(new URL('../eval-description.md', import.meta.url), 'utf8')`；注册点 `src/index.ts:535` `description: EVAL_DESCRIPTION`；参数级 `EVAL_DESCRIPTION_PARAM_DESCRIPTION`（`:256` → `:541`）保留。
3. **wire 参数 schema 未动**：`eval.parameters.properties` = `['cell','description','timeout','reset']`（与 design 一致）。
4. **渲染器已删、策略保留**：`renderReplBridgeInstructions` / `renderToolsSdkPy` / `collectSdkSchemas` 在 `src/`+`test/` 零命中（仅注释追述）；`isFlatBindableName` 仍在 `src/py-sdk.ts:35`，被 `src/index.ts:103/890`（绑定安装器）调用。
5. **单测**：
   - 三个被改 spec：`presentation.spec.ts` + `py-sdk.spec.ts` + `surface-devices/surface.spec.ts` → **32 passed / 3 files passed**（presentation 20 + surface 10 + py-sdk 2），与 tasks 3.1 记录一致。
   - 全量：**Tests 14 failed | 458 passed (472)**；失败集中在 `agent-family.spec.ts` / `url-schema.spec.ts`（`SessionSeq is not a function`）。
   - **独立基线对照（本轮新做，非引用任务记录）**：`git worktree add --detach /tmp/dashr-head HEAD` 拉 pristine HEAD（改前）→ 同两文件 **14 failed | 41 passed (55)**，`tsc --noEmit` = **13 error TS**；改动树 `tsc --noEmit` 同为 **13**。→ 14 失败与 13 类型错误均为既有基线，**零新增**。
6. **D1 漂移护栏在位**：`presentation.spec.ts` 断言「注册 description `toBe(packaged md)`」+「description 中所有 `"key":` 引用的键 ∈ 相关工具 wire properties ∪ eval 自身四参」。

---

## 3. 活体第一人称矩阵（design 迁移计划 a–e）

### (a) 新 session 无两 section、`eval.description` = Markdown 全文 ✅

从本会话落盘的 wire 证据（非人工转写）：

```
system prompt chars = 7894
mentions dashr:control-prompt: False     mentions dashr:tool-catalog: False
mentions 'TWO ways to act'   : False     mentions 'Calling tools from the scripting pad': False
mentions 'tool.<name>' 归因段 : False     system prompt 内 'REPL' 出现次数: 0
wire eval.description chars  = 2092
byte-identical to dashr/eval-description.md                        : True
byte-identical to monorepo 副本 eval-description.md                 : True
```

description 内六段解剖全部命中：首句定义（"Run one Python cell …"）、参数语义（"top-level `return` is a SyntaxError"）、直调 vs cell 判据（"Payload-shaped work…"）、非 flat 例外（"not plain identifiers"）、`subagent` 别名注记（"`subagent` is its native alias"）、末尾桥接段（"ONE positional argument" + "`true`/`false`/`null` become `True`/`False`/`None`" + "ToolCallError"）；**输出侧零陈述**（`not guaranteed` / `trial` / `试错` 等一律 0 命中）——符合 R3 user 裁决。

### (b) cell 内真实桥接调用、返回值可读 ✅

单个 cell 内实跑（真实 host 调用，非 mock）：

```json
{"read_path_ok": true, "read_head": "yY8│# Better Dsh — Dashr",
 "grep_matches": 3,
 "bash_stdout": "bridge-ok\n/home/u1/workspaces/dashr",
 "glob_paths": ["upstream/deepseek-harness/packages/better-dsh/better-dsh/eval-description.md",
                "dashr/eval-description.md"],
 "glob_shape": ["paths", "root"],
 "dir_tool_count": 25}
```

delegation 桥端到端（真起了子 agent，回收两轮回执）：

```
tool.agent({"description":"bridge smoke","prompt":"Reply with exactly: bridge-alive","run_in_background":True})
  → {'kind': 'continuable', 'subagentId': '55661884-…'}
  ← child 结束语: bridge-alive
tool.agent_message({"receiver":"child","subagent_id":"55661884-…","message":"Reply with exactly: bridge-alive-2"})
  → {'messageId': 'd0e77672-…'}
  ← child 结束语: bridge-alive-2
```

`web_search` / `job_list` 桥同样返回结构化可读值。cell 语义三断言实测：跨 cell 变量存活（前 cell 的 `masked`/`sid` 在后 cell 可见）；`compile("return 5","<cell>","exec")` → `SyntaxError: 'return' outside function`；kwargs 形 `tool.read(path=…)` → `TypeError: dashr binding calls do not accept keyword arguments`；`reset=True` 后 `masked`/`sid`/`marker` 全部消失而桥接照常可用。

### (c) 非 flat 名直调路径不回归 ✅（本 scope 无真名，用等价物证）

本 runtime wire 26 名**全部是 flat 标识符**，非 flat 分支无真实样本。等价验证：

```
getattr(tool, "mcp__demo-server")({})  → ToolCallError: unknown binding "tool.mcp__demo-server"
`tool.mcp__demo-server(...)` 属性语法    → Python SyntaxError（语言层就不可写）
```

即「非 flat 名没有 `tool.<name>` 成员、必须直调」的契约成立；`isFlatBindableName` 本身由 `py-sdk.spec.ts` 单测覆盖（2 tests 绿）。**声明**：真实带连字符/`__` 的 MCP 工具在场的端到端用例本轮未覆盖（本 runtime 无 MCP 工具），见 §6。

### (d) `read` 示例键名 `path` 正确 ✅（并发现旧键仍可用，见 §5.1）

```
tool.read({"path": "README.md", "limit": 3})           → 成功（'"yY8│# Better Dsh — Dashr"' 等 hash 行）
tool.read({"limit": 2})                                 → ToolCallError（path 缺失必错）
tool.read({"file_path": "README.md", "limit": 2})       → **也成功，且返回值与 path 版完全一致**
dir(tool) 内 25 名 = wire 26 名 − eval                     （与 `_dashr_install_bindings` 注入的 25 名逐一吻合）
```

### (e) masked 8 名 / 别名 / 内省回归 ✅

- masked 8 名（`skill,send_message,report,list_agents,subagent_fork,interrupt_agent,workflow,ralph`）在 **wire 26 名中全缺席**，在 `dir(tool)` 中亦不在绑定清单；`tool.skill({})` → `ToolCallError`，`str(e) == 'unknown binding "tool.skill"'`，`.toolName == 'skill'`（契约字段健在），与瞎编名 `tool.definitely_not_a_tool` 的**模型可见回文完全同形** → 同一条 route-back 路。
- `agent`/`agent_message`/`subagent`/`agent_workflow` 桥正常（§3b）；`dir(tool)` 内省面 25 名不变。
- `dashr:escalation-guidance`（order 116）不在本 change 范围，本轮实测该 context 仍以 runtime-context 段落出现（升级指引文案可读），未受影响。

---

## 4. 提示面预算复测（task 3.4）

**基线取法（同 harness 家族、可复算）**：`.dsh-test` 里 2026-09-06 的旧 session（`session-851d54da…`，wire 25 工具、`eval` 591 chars）留有完整 `system/message` + `request/header`；与本活体的会话记录做 A/B。

| 指标 | 改前（Sep 06 基线） | 改后（本活体 2026-09-11） | Δ |
|---|---|---|---|
| base system prompt | 14,709 chars | **7,894 chars** | **−6,815（−46.3%）** |
| 其中 `## The DASHR REPL interface`（control prompt） | 4,127 chars | 0 | −4,127 |
| 其中 `## Calling tools from the scripting pad` + 27 行 `tool.x(args: …) -> …` 声明块 | 4,632 chars | 0 | −4,632 |
| 两 section 合计 | 8,759 chars | 0 | **−8,759** |
| 残余漂移（非本 change） | — | — | **+1,944** |
| wire Σ description | 9,726（25 工具） | **11,691（26 工具）** | +1,965（+20.2%） |
| 其中 `eval` 单工具 | 591 | **2,092** | **+1,501** |
| 其中新增工具 `present` | — | 464 | +464 |

**残余 +1,944 已定位且与本 change 无关**：对「去掉两 section、去掉 runtime-context 段落（checkout/GUI/cwd/model 四段，位置与端口不同不算内容）」后的**核心**提示做行级 diff，得出**纯插入 19 行**、且校验 `基线核心 + 插入行 == 当前核心` 为 True——插入内容全部是 v0.2.3-b（09-08）hashline content-locator 带来的 `read`/`edit` HASH 锚点指引段。即：**本 change 的作用就是把两份 section（−8,759）从提示面移除，别处一字未动**。
⇒ 若只看本 change 对今日 runtime 的净影响：`7,894 + 8,759 = 16,653 → 7,894`（**−52.6%**）。

与 design 预估（prod 43 工具：17,838 → ~10,850；Σ 14,201 → ~15,800）方向一致，绝对值不可直接比（本 runtime 是 26 工具的 web profile，scope 不同）；design 对 `eval` 描述长度的目标 ~2,200 chars，实测 **2,092**，达标。

---

## 5. 发现与处置

### 5.1 D1「示例键名修正」是文档准确性问题，不是行为修复（低）

`dashr/eval-description.md` 把示例从 `file_path` 改成 `path`，与 wire schema（`read.parameters` = `path/offset/limit`）一致——**正确**。但实测旧键**并未失效**：vendored hashline 的 `normalizeRequest` 显式做 `file_path → path` 别名（`src/url-schema/vendored/hashline/contract.js:74` 一带）。结论：
- 旧 control prompt 的 `file_path` 示例属于「与 wire schema 不符但侥幸可用」；
- 新示例消除了这层侥幸（若上游/我们日后收紧 `additionalProperties`，旧写法即死）；
- 报告据此把 D1 定性为**文档正确性修正**，而非「修了一个报错」。建议（不改本轮结论）：如果确实希望旧键成为硬错，需要单独 change 去掉该别名，本 change 不应背这个期望。

### 5.2 【发布阻断，已修复并复验】`package.json` `files` 未随文件更名更新

**症状**：`dashr/package.json` `files` 仍写 `"control-prompt.md"`（该文件已删除），且**没有** `"eval-description.md"`。

**证据链**：
1. 修复前 `npm pack --dry-run`（`--cache /tmp/npmcache`，因 `~/.npm` 只读）→ 69 个文件，`eval-description.md` **不在**产物中，`control-prompt.md` 也不在（已被删）。
2. 而插件在**模块期**就执行 `readFileSync(new URL('../eval-description.md', import.meta.url), 'utf8')`（`lib/index.js:11052`），路径解析到**包根**。
3. 用修复前语义复现：从真实 tarball 解包后把该文件移走 → `ENOENT: no such file or directory, open '/tmp/pkgcheck/package/eval-description.md'`。
   ⇒ 部署态后果不是「指引缺失」而是 **`better-dsh` 整个插件加载即抛错**（挂载失败，插件全部功能死）；而 4989 活体因跑源码树（文件在盘上）完全看不到这个问题——典型的「活体绿、发版死」。
4. 附带事实：修复前 canonical `dashr/lib` 还是 04:01 的**改前产物**（仍引用 `control-prompt.md`，而该文件已删），故那一时点即使补上 `files`，lib 侧依旧指旧文件——两个坑叠加。

**处置**：
- 改 `dashr/package.json`：`files` 中 `"control-prompt.md"` → `"eval-description.md"`（1 行）。
- 重建 canonical 产物：`tsdown`（8 files / 495.94 kB，`py-sdk.d.ts` 瘦到 1.00 kB）+ `tsx scripts/build-client.ts`（18.52 kB）。
- 复验：`npm pack`（真实打包）→ **70 files**，根层含 `eval-description.md`；解包后 `lib/index.js` 对 `control-prompt.md` 引用 0、对 `eval-description.md` 引用 1；按**模块期同款 URL** 读取成功，`chars = 2092`，首行 = `Run one Python cell on a session-persistent scripting pad. …`。

**残留提醒（未改，交 user/后续任务裁决）**：
- 版本号与 lock 仍 `0.2.3-c`、AGENTS ✅ 条目与 tasks 3.3/3.4/4.1 未回填（本轮只做验证与报告，不做发布动作）；
- `openspec/…/tasks.md` 的 3.2 记录「canonical 未重建、4999 挂起」与现状已不符（活体已在 4989 跑起来），建议收口时同步。

### 5.3 小瑕疵（不影响判定）

- `src/index.ts:242`、`src/py-sdk.ts:5` 的注释仍以「former section」口吻提到 `dashr:control-prompt`/`dashr:tool-catalog`——tasks 2.1 的「`grep src/` 零命中」严格说不成立（是注释，不是注册）。可在收口时顺手改写以免后人误解为「还在」。
- `eval-description.md` 示例路径 `docs/README.md` 在 dashr 仓库**不存在**（README 在根；`upstream/deepseek-harness/docs/README.md` 也没有）。示例属通用示意（与上游 `eval` 文档同构），但既然本 change 以「消灭键名漂移」为由加了单测护栏，路径同样可以选一个真实存在的（如 `README.md`）以免带偏模型。**注**：这正是本轮第一次 cell 试跑踩到的 `E_NOT_FOUND`。

---

## 6. 未覆盖 / 残留风险

1. **非 flat 名的端到端**：本 runtime 无 MCP/带连字符工具，只有「无成员 + 属性语法不可写 + 同名 route-back」的等价证据与单测覆盖（§3c）。若验收要求真名，需挂一个 MCP 工具再跑一次。
2. **prompt 前缀缓存一次性失效（design D4 自述 BREAKING）**：本轮未量化既有会话的 cache 命中变化（无 provider 侧计数入口）。
3. **prod 侧未验证**：本报告全部结论来自 4989 源码级实例；prod 3080 仍是发布态 `better-dsh@0.2.3-c`（未装本 change），按 AGENTS §〇 需 user 单次确认后才发布、再以普通 user 身份装机实测。
4. **未跑 `pnpm run build` 全量**（仅 `tsdown` + `build-client` + `tsc` + vitest）；monorepo 侧本轮未重建（活体所用产物在此之前已由 change 作者构建并处于在位状态，本轮只核了它的字节行为）。

---

## 7. 发布闸门状态（AGENTS §〇）

| 闸 | 状态 |
|---|---|
| a. 第一人称实测通过 | ✅ 本报告 §3（同一 runtime 上跑通改动路径；且本 agent 自身即运行在被改的提示面上） |
| b. 报告落盘 `docs/50_test-reports/` | ✅ 本文件 |
| c. user 单次明确确认放行 | ⏳ **未取得** |
| d. 前置修复（`files` 缺口 + canonical 产物重建） | ✅ 已做并复验（§5.2） |

⇒ **不具备发布条件**，等 user 明确放行；本报告不构成发布授权。

---

## 附录 A — 原始证据位置

| 证据 | 位置/取法 |
|---|---|
| 本会话 wire 快照（`system/message`、`request/header`） | `.dsh-test-4989/sessions/--home-u1-workspaces-dashr--/session-21747443-752d-4647-9208-c929a635c998/session.v3.jsonl.zstd`（`zstd -dc` 后按 `type` 取事件） |
| 改前基线 session | `.dsh-test/sessions/--home-u1-workspaces-temp--/session-851d54da-bffa-4c44-83db-c3991708e3ab/session.v3.jsonl.zstd`（2026-09-06，25 工具 / eval 591） |
| pristine HEAD 基线（单测+tsc） | `git worktree add --detach /tmp/dashr-head HEAD`（HEAD=`f69528f`）→ 14 failed/41 passed（两 spec）、tsc 13 |
| 打包复验 | `npm pack --cache /tmp/npmcache --pack-destination /tmp/pkgcheck2` → `/tmp/pkgcheck2/better-dsh-0.2.3-c.tgz`（70 files，含包根 `eval-description.md`） |
| 活体 cell 记录 | 本 session transcript 的 `tool/call`/`tool/result`（eval × 6，含 delegation 往返） |

### 附 A.1 本报告触发的一次实际改动

```
dashr/package.json:  files: ["lib","docs","cordis.patch.yml","eval-description.md","scripts/kernel-provision.mjs"]
                     （原 "control-prompt.md"）
重建：dashr/lib/*（tsdown 8 files 495.94 kB；client 18.52 kB）
```

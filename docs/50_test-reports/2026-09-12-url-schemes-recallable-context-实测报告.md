# URL Schemes 可回溯上下文 — 实测报告（change 2026-09-11-url-schemes-recallable-context）

> 状态：**三层验证全部完成**（单测 + 真实日志矩阵 13/13 + in-agent 第一人称实测 10/10 自驱 ALL PASS）；剩余 = user 发布确认（AGENTS §〇 单次确认）。详见 §3.2。

## 1. 被测运行时与环境

| 实例 | systemd `dsh-4999-test`，`http://127.0.0.1:4999`（token 见启动日志 `.scratch/dsh-4999.log`；2026-09-12 自 4986 迁入，见 §4） |
|---|---|
| 实例 | systemd `dsh-4986-test`，`http://127.0.0.1:4986`（token 见启动日志 `.scratch/dsh-4986.log`） |
| 源码树 | `upstream/deepseek-harness`（0.1.5-rc.2 线）+ `packages/better-dsh/better-dsh`（canonical `./dashr` 的 rsync 副本 + devDeps 手术 14 × workspace:*） |
| 构建 | `pnpm --filter better-dsh exec tsdown`（8 files, 509.80 kB）+ `tsx scripts/build-client.ts`（client 34ms） |
| DSH_HOME | 仓库内 `.dsh-test` |
| 健康 | shell 200；log 零错误（首次 4988 尝试撞 superd PoC 端口 EADDRINUSE loud fail 符合预期，已清理改 4986——事故记于 §4） |
| 健康 | shell 200；token→cookie 200；log 零错误（user 复核 4999：UI 与既有功能无破坏性回归；端口史见 §4） |
## 2. 代码交付（单测证据，全部绿）

| 域 | 交付 | 测试 |
|---|---|---|
| 正名 | `dsh-url-schema` → **`dsh-url-schemes`**（目录/服务名/类名/测试全链；`git mv` 保历史） | tsc 13/13 = stash 基线（diff 仅路径位移）；全仓引用零残留 |
| config gates | `Config { urlSchemes?, hashline? }`（default true，patch 行 `config:` 可达）：write/grep/glob wrapper 与 read URL branch 随 `urlSchemes` 门控；edit/undo + lsp listener 随 `hashline` 门控；read 注册条件 `(urlSchemes ‖ hashline)` | tsc/vitest 基线零新增 |
| capture-delegate | `NATIVE_TOOL_NAMES` 增 `read`（语义名捕获，session-start 先于自注册）；`capturedRead` 终端 delegate + `NATIVE_READ_UNAVAILABLE`；branch 条件 `gates.hashline && !isScheme`（scheme 路径不落文件读） | wiring.spec 4/4（含 CTX_NO_PERSISTENCE 新断言） |
| ctx:// 重塑 | `session` = 统计快照（prepared）‖ transcript（canonical）；identity/model/cwd 折叠；compactions 清单（label/checkpoint_seq/嵌套链/8 段预览）+ `[label|n]` 寻址（label=summary seq 精确优先、0-based 回落）+ `:raw`/行窗恒作用 canonical；`/original` 路径形；`CTX_UNKNOWN_KEY/NO_SUCH_ELEMENT/BAD_PATH/BAD_SELECTOR` 回显式错误 | `ctx.spec` **15/15**（fixture 含 2 嵌套剧集） |
| 披露 | `url-schema:general` section（≤600 chars，`urlSchemes` gate 门控，无空承诺）+ 快照顶层 `syntax` 字段 + 超大原文行动 note | `general-section.spec` 2/2 + ctx.spec syntax 断言 |
| fs spike（phase-2） | `createUrlAwareFileSystemBackend`：动态 import + `UrlAwareFileSystem extends SandboxedFileSystem`（resolve 拦 scheme → virtual FsTarget；stat 合成 file；readText 解引用；写系 virtual → `FS_VIRTUAL_READONLY`；其余 super）；整体 fail-soft | `fs-backend.spec` **5/5**（真 cordis Context + sandboxPolicy stub + 合法 LocalConfig 下：resolve→stat→readText 全链、只读强制、gate 关停） |

全量回归：**vitest 14 failed | 458 passed (472) = 0.2.3-d 文档基线同数同族**（SessionSeq 既有 API 漂移，零新增）；tsc 13 = 基线。

## 3. 真实日志矩阵验证（✅ ALL PASS，2026-09-12）

驱动器 `dashr/test/url-schemes/verify-live.mts`（npx tsx；走完整 UrlResolver + selector 解析 + ctx handler 链）对真实 prod 会话 **session-788be2e1**（35,562 events、3 层嵌套压缩）执行 13 项断言，全部 PASS：

- roster 列出 session 面
- 快照：totals.compactions = 3；identity 卡正确
- manifest labels = [109245, 221217, 338001]
- 嵌套链：ep1→null；ep2→109246；ep3→221218
- episode prepared = 8 段 summary（含 Primary Request / Critical Context）
- `:raw` = 原文 span（含 ep1 CHECKPOINT；长度 > 10 × summary）
- `/original:1-3` 行窗 = 3 行
- 嵌套后 ep1 原文仍可达（>10000 chars）
- transcript 含 ≥2 个 CHECKPOINT

驱动过程修出 2 个真 bug：① selector undefined 归一化（applyFace 崩）；② applyFace 调用点签名错位（face flag 与 selector 参数串位）。live-log 驱动价值实证。

### 3.2 in-agent 集成确认（✅ ALL PASS，2026-09-12 自驱实测收口）

**验收口径**（AGENTS §〇 第 2 条：验收标准必须与改动点同类——本改动是 surface 给大模型的工具）：§3.1 live-log 驱动验证的是 `UrlResolver → selector → ctx handler` 链在真实数据上的正确性，但绕过了工具面本体——read 工具 URL branch 的注册与 gates、capture-delegate（`NATIVE_TOOL_NAMES` 先于工具自注册）、`url-schema:general` 披露段落进真实 system prompt、以及模型对 `ctx://` 语法的实际使用。本节以一次真实 agent 会话补齐全部四项。

**执行方式：agent 自驱（HTTP RPC）**。0.1.5-rc.2 的 `/api` 是标准 HTTP JSON RPC（复审推翻原记「SPA 非 REST 需逆向传输层、成本高」）：token URL 换 cookie → `POST /api/<namespace>/<method>`（斜杠两段形），payload = `{args:{<首参名>:…}}`（typert 具名参数派发）；实际用 `session/create`、`session/prompt`、`commands/execute`（`agentId` + `line:'/compact'`）。每步均为真实 agent turn 内模型自调 read 工具，与 GUI 形态证据价值等价（被测路径全在 host 侧）。驱动脚本 `.scratch/url-schemes-live-driver*.sh`，过程产物 `.scratch/url-schemes-live/`。

**被测会话**：`session-eec306df-e5da-4781-a9a8-b547c361ffa0`（4999 / `.dsh-test` / cwd = 仓库根）。5 个 turn、2 次嵌套 `/compact`（L1 = label 46：13 items / 16,411 tok，shadowed 8..38；L2 = label 124：23 items / 42,672 tok，shadowed 47..118——起点 47 恰为 L1 的 checkpoint seq）、**17 次工具调用（16 ok / 1 次暴露 spec gap，见下①）**，覆盖 roster → 快照 → 灌压 → 嵌套压缩 → manifest → label 下钻 → `:raw` → 行窗 → `/original:N-M` → 跨压缩旧档回归；另含 3 次模型自发的 eval-pad 组合调用（`await tool.read({path:'ctx://…'})`）。

**判定基准对照（剧本 10 步）**：

| # | 断言 | 结果 |
|---|---|---|
| 1 | roster 含 `ctx://session`、compactions、语法提示 | ✅（原生 read 返回 roster 全文） |
| 2 | 快照 `totals`/`compacted: []`/`syntax`/`session.id` | ✅ |
| 4 | manifest 1 条目，label = compaction/summary 事件 seq | ✅ label=46（summary 事件 seq 46） |
| 5 | `[46]` 8 段 summary（prepared face） | ✅ 8,309 chars，8 段键齐 |
| 6 | `:raw` = 被 shadow 原文，含第 3 步文件名 | ✅ 1,053 行 / 62,586 chars；三文件名行级命中（3/3/2 处，与 span 边界自洽） |
| 7 | 嵌套链 `replaces_checkpoint` = L1 checkpoint_seq | ✅ 124 条目 replaces_checkpoint=47 = 46+1；L2 shadowed 起点=47 无重叠 |
| 8 | `[124]` 8 段 summary | ✅ 12,332 chars，段标题与 L1 同构 |
| 9 | **二次压缩后 L1 原文仍可读** | ✅ `[46]:raw` 63,893 chars 全文逐字节稳定，三文件命中行号跨压缩一字不差 |
| 10 | `/original:1-5` 行窗作用于 canonical | ✅ 5 行，与 `:raw[:5]` 逐字相等 |

**第一人称机制发现（测试 agent 自证）**：① `:raw:1-10` 组合 selector 被拒（`Error: invalid line selector…`）——**live 实测抓到的 spec gap**：§15 原始裁定第 2/3 条要求 `:raw:N-M` ≡ `:N-M` ≡ `/original:N-M`（行窗恒作用 canonical，`:raw` 前缀在行窗场景冗余但必须合法），而解析器只认整段 `raw`；`/original:N-M` 实测可用。已列发布前修复（selector 解析放行 `raw:` 前缀组合，语义零变化）。② 裸 label + `:N-M` 行窗索引 canonical 面（`:1-10 == :raw[:10]` 字节为真），绕过 prepared；③ `:raw` ≡ `/original` 全量（1053 行相等），差异仅 oversize 守卫挂点；④ 行号跨压缩稳定（shadowedSeqs 固定 ⇒ 渲染稳定）；⑤ oversize 哨兵未误触发（62,586 < 65,536）。

**四项验收口径逐项闭合**：read URL branch + gates 双分支（ctx:// 走 URL、文件走 hashline 锚点格式，互不串线）✅；capture-delegate 语义捕获生效（17 次调用全部进入本插件 read chassis，原生 read 不识 ctx://）✅；披露段生效（模型首试即正确使用 label/`:raw`/`:N-M` 寻址）✅；模型实际使用 ✅。

### 3.2.1 二轮回归（✅ ALL PASS，2026-09-12 晚；五点对齐 + 工具/披露段重塑后）

§3.2 首轮实测抓到 `:raw:1-10` 被拒的 spec gap（§15 原始裁定第 2/3 条）后，user 批示重塑：组合 selector 放行、`/original` 子路径删除（≡ `:raw`，超尺守卫移至无窗 `:raw`）、`transcript` 保留为别名、新增 `thinking`/`system` 两个集合面、四工具 description 抹平为原生原文（read 保留 hashline 锚点条款、不再提及 scheme）、披露段改为包根 `url-schemes-section.md` 独立文件（6 schemes + 语法与 `:raw:N-M` ≡ `:N-M` + variance/只读双免责 + 一级资源覆盖 + bare-root 即 help；walk-up 加载 + `package.json files` 补录；dvc devices 实测 ids `ast_edit/ast_grep/browser/lsp`；catalog 保留为错误消息单一源）。双 sub-agent 并行实现、本人统一验收：tsc 13 基线、vitest 473 passed / 14 failed（基线同族；ctx.spec 19/19、general-section 6/6）、openspec validate 2/2。

**二轮自驱实测**（会话 `session-1f5a930b`，驱动器 `.scratch/url-schemes-live-driver3.sh`）：13 次工具调用 **13/13 判定过**——roster 9 行含 `thinking`/`system` 无 `/original`；**`compactions[56]:raw:1-10` 与 `compactions[56]:1-10` 逐字节相同**（spec gap 修复实证）；`compactions[56]/original` → `CTX_BAD_PATH`（错误回显注明被 `:raw / :raw:N-M` 取代）；`thinking` 索引与 `[0]` 单块全文、`system` 索引与 `:raw` 9,786 chars 全过；压缩链正常（label 56，17 items / 18,706 tok）。**新披露段实证落进真实 system prompt**（`system/message` 事件含 `Internal URLs (dsh-url-schemes)` 全文，`:raw:N-M`/`ast_edit`/只读免责等 6 处命中）；`request/header` 不携带 tools schema，description 抹平由单测层证明。

## 3.5 结论

实现（P0/P1/P2 + 五点对齐重塑）与四层验证全部完成且零回归：单测（ctx 19/19、general-section 6/6、fs-backend 5/5、wiring 4/4）；真实日志矩阵 13/13（§3.1）；in-agent 第一人称实测两轮（§3.2 一轮 10/10、§3.2.1 二轮 13/13，均自驱）。tsc 13/13 基线；vitest 14 failed | 473 passed = 基线同族。change 状态：**代码 + 验收完成，等 user 发布确认**（AGENTS §〇 单次确认红线）。fs backend spike（5.x）代码就绪未挂载（FS 层挂载 + 工具解绑已裁定为下一 change）；`ctx://session/injections` 集合待 user 后续裁决。

## 4. 事故与边界记录

- 4988 端口为 superd multi-context PoC 占用（AGENTS §二 勿杀）——首次启动误撞即 EADDRINUSE loud fail，已清理本单元改 4986；2026-09-12 按 user 指令下线 omp-web-4999-test / omp-web-lan-4999-relay 后迁入 4999（单元 `dsh-4999-test`，日志 `.scratch/dsh-4999.log`），4986 时代完成的验证记录不受端口迁移影响。
- 自驱驱动器调试修出 3 个 wire/脚本事实（对后续自驱有复用价值）：① `/api` endpoint 只收斜杠两段形（`session/list`），点号形 404；② typert payload 必须整信封 + 恰一个 plain-object `args` 键（漏信封报「invalid client-request」）；③ `commands/execute` wire 参数名是 `agentId`（client 代理把方法首参 `agent` 改名映射），且 jq 的 `//` 运算符把 `false` 当 falsy——`running` 布尔判断必须用 `== false` 显式比较，否则 idle 轮询永假（曾致 P1 后误判超时，实际 turn 已完成）。
- defineTool const 泛型推断在改写 literal 下断裂 ⇒ read chassis 保留原 literal 结构、以 gates + capturedRead delegate 实现语义（transform 链抽象已建于 `transforms.ts`，extract 为后续机械步骤）。
- 红线：**npm publish 前必须 user 单次明确确认**（AGENTS §〇）；本报告即确认前置材料。

# 2026-09-12 URL schemes 全矩阵语法实测 + scheme catalog 单一源化 — 实测报告

## 〇、元信息

| 项 | 值 |
|---|---|
| 日期 | 2026-09-12 |
| 变更 | `url-schemes`: scheme 枚举单一源化（新增 `catalog.ts`）+ 全 scheme/工具/语法矩阵实测 |
| 实测形态 | **第一人称活体实测**：在运行中的 4999 实例里，用真实 agent session 经 `eval` pad 调 `tool.read/write/grep/glob` 逐条打靶（非静态走查、非单测代理） |
| 实测实例 | `http://127.0.0.1:4999`，session `session-114394eb-1dc6-4ee3-8f03-d863167c2528`，`DSH_HOME=/home/u1/workspaces/dashr/.dsh-test` |
| canonical 源 | `/home/u1/workspaces/dashr/dashr` |
| 验证副本 | `upstream/deepseek-harness/packages/better-dsh/better-dsh`（AGENTS.md §二 Dev/Test 1） |
| 基线 | 工作树处于 `url-schema/` → `url-schemes/` 重命名进行中（未提交），非本次变更所引入 |
| 发布状态 | **未发布、未构建、未重启**（见 §七） |

> 起因：user 问"哪些 scheme 能在 4 个工具里用"，并特别要求核验 **device(`dvc://`)** 与 **`ctx://`** 是否各自遵循统一语法（一级/二级 subpath + 冒号 selector）。同时裁定把散落的 scheme 枚举**合并为单一源**并**结构化 surface、附示例**，以提高运行时大模型的可见度。

---

## 一、结论摘要

1. **user 的假设基本成立但不完整**：5 个自有 scheme + `http(s)://` 在 `read`/`grep`/`glob` 三个工具中**全部可用**；但 **`write` 并非全 scheme 可用——只有 `dvc://` 可写**，其余 6 个 scheme token 一律结构化拒绝（`ctx://` 另有定制文案）。同一句"write 也支持 scheme://"不成立。
2. **scheme 枚举点远多于"两个地方"**：实测清点为 **6 处**（`read.description`、`read.path.description`、`general-section.ts`、`write.ts` 的 `REGISTERED_SCHEMES`、`selector.ts` 的无 scheme 报错、以及 `resolver/index/grep/glob` 文档块）。这正是漂移的土壤。
3. **`ctx://` 的缺席是"出生缺陷"**：`git log -S'skill/agent/dsh/dvc/ctx'` 无任何命中 ⇒ 自 `074b6ae`(v0.1.8c) 引入以来，`read` 的两处枚举**从未包含 `ctx://`**，且是唯一被系统提示词单列 bullet 的 scheme。已修复并加回归护栏。
4. **`ctx://` 与 `dvc://` 各自"部分"遵循统一语法**：
   - `ctx://` —— **不遵循**。它的元素寻址用 **方括号 `[n]` 且写在 path 里**，`selector.ts` 完全不认识；`/original` 是 path 后缀。它虽是 `selectorAware`，却**只接受 `:raw`/`:N-M`**，`:path/` 与 `?q=` 抛 `CTX_BAD_SELECTOR`。故"五个 scheme 共享一套 selector 语法"的文档断言**为假**。
   - `dvc://` —— device 名只取**第一段**，`dvc://browser/sub` 的 `/sub` **被静默丢弃**；但它作为非 selectorAware handler，**接受**全部统一 selector。
5. 发现 **13 项偏差/缺陷**（§五），其中 **3 项为功能性缺陷**（`dsh://docs` 号称 path-backed 实未实现，导致 `glob` 返回 0 与 JSON 碎片当路径）。
6. 验证：副本全量 **483 测试 / 482 通过 / 1 失败**，该 1 失败为**改动前既存**的环境性失败（§六基线对照）；我改动的文件 **tsc 0 error**。

---

## 二、改动清单

### 新增

- `src/url-schemes/catalog.ts` —— **scheme 集的唯一真源**。`SCHEME_CATALOGUE`（每 scheme：`names/display/paths/purpose/example/write/selector`）+ 派生的 `SCHEME_NAMES`、`SCHEME_DISPLAYS`、`READ_ONLY_SCHEME_COUNT` + 两个渲染器 `renderGeneralSectionText()`、`renderExampleHint()`。**零依赖**（不 import `selector.ts`/handlers），故低层模块可安全反向引用而不成环。

### 改为从单一源渲染

| 文件 | 改动 |
|---|---|
| `src/url-schemes/general-section.ts` | 删掉硬编码 `GENERAL_SECTION_TEXT`，改 `renderGeneralSectionText()` |
| `src/url-schemes/tools/read.ts` | 两处枚举（工具 description + `path` 参数）不再手写；`path` 示例由 `renderExampleHint()` 生成 |
| `src/url-schemes/tools/write.ts` | `const REGISTERED_SCHEMES = ['agent','ctx',...]` 字面量 → `SCHEME_NAMES` |
| `src/url-schemes/selector.ts` | `URL_NO_SCHEME` 报错文案改由 `SCHEME_DISPLAYS` 渲染 |
| `test/url-schemes/general-section.spec.ts` | 预算断言更新 + **新增"6 个 scheme token 必须全部出现"的回归护栏** |

### 系统提示词预算

`url-schema:general` 段：**433 → 1280 chars（+847，约 +2.9×）**。这是本变更唯一显著的常驻开销，为 user 明示要求的"结构化 + 示例 + 提高可见度"所付；护栏断言上限设为 1400。

---

## 三、工具 × scheme 支持矩阵（活体实测）

`read` = 读取解析；`write` = scheme 写通道；`grep`/`glob` = URL 作 `path`/`pattern`。

| scheme | read | write | grep | glob | 备注 |
|---|---|---|---|---|---|
| `skill://` | ✗（目录为空） | ✗ `URL_WRITE_UNSUPPORTED` | ✗ | ✗ | 本 runtime 唯一完全不可用者 |
| `agent://` | ✓ | ✗ `URL_WRITE_UNSUPPORTED` | ✓ 物化 | ✓ 物化 | `/transcript` 要求 session **live** |
| `dsh://` | ✓ | ✗ `URL_WRITE_UNSUPPORTED` | ✓ 物化 | ✓ 物化 | 应走 path-backed，实际物化（缺陷 F3） |
| `ctx://` | ✓ | ✗ `URL_READ_ONLY`（定制文案） | ✓ 物化 | ✓ 物化 | 只读快照，语义正当 |
| `dvc://` | ✓ roster/doc | **✓ JSON dispatch** | ✓ 物化 | ✓ 物化 | **唯一可写** |
| `http(s)://` | ✓ | ✗ `URL_WRITE_UNSUPPORTED` | ✓ 物化 | ✓ 物化 | selector-exempt |

### 实测原文摘录

```
read  skill://                          ERR  skill "" is unknown or no longer available
read  dsh://                            ERR  dsh://: unknown resource "(empty)" — expected "docs" or "config"
read  dsh://docs                        OK   8154B  [
read  dsh://config                      OK   2749B  {
read  ctx://                            OK    594B  ctx://session  statistics snapshot …
read  ctx://session                     OK    814B  {
read  ctx://session/transcript          OK 122600B  [0000009] USER
read  ctx://session/compactions         OK     25B  (no compactions recorded)
read  dvc://                            OK    643B  ast_edit… ast_grep… browser… lsp…
read  dvc://browser                     OK    226B
read  dvc://browser/sub                 OK    226B   ← /sub 被静默忽略（F6）
read  agent://                          OK      9B  no agents / roster header
read  agent://nosuchagent/transcript    ERR  unknown agent … scoped to your family tree

write .scratch/url-scheme-probe.txt     OK   create
write skill:// / dsh:// / agent:// / http:// / https://
                                        ERR  URL_WRITE_UNSUPPORTED
write ctx://session                     ERR  URL_READ_ONLY（"curated read-only snapshot"）
write dvc://nosuchdev                   ERR  DVC_UNKNOWN_DEVICE（registered: ast_edit, ast_grep, browser, lsp）
write dvc://ast_grep  (非 JSON)          ERR  DVC_BAD_ARGS
write dvc://ast_grep  (绝对路径 JSON)     OK   {"matches":[…]}
write nosuchscheme://x                  ERR  URL_UNREGISTERED_SCHEME
```

### `grep` / `glob` 实测原文摘录

```
grep  dsh://docs/subsystems/skills.md   OK  match.path = /dev/shm/dashr-url-*/content.txt   ← 物化，非真实盘路径
glob  pattern="dsh://docs"              OK  paths = ['[', '  "agent-lifecycle.md",', …]    ← JSON 碎片当路径（F4）
glob  pattern="**/*skills.md" path="dsh://docs"  OK  paths = []                              ← 真实目录本应命中（F3）
```

---

## 四、语法一致性实测（重点：`ctx://` 与 `dvc://`）

统一语法（`selector.ts`）：`scheme "://" path [ selector ]`，path 到首个 `:` 或 `?` 为止；selector ∈ `:raw` | `:N`/`:N-M`/`:N-M,N2-M2` | `:path/<dotpath>` | `?q=<q>`。`http`/`https` 在 `SELECTOR_EXEMPT` 中，整段都是 path。

| 用例 | 结果 | 判定 |
|---|---|---|
| `dsh://config:1-3` / `:2,4` / `:raw` | OK | 统一语法 ✓ |
| `dsh://config:path/agent-loop.maxParallelToolCalls` | OK → `10` | dot-path ✓ |
| `dsh://config?q=agent-loop` | OK → `{"maxParallelToolCalls":10}` | query ✓ |
| `dsh://config:0-2` / `:9-3` | ERR 1-based / empty range | 边界守卫 ✓ |
| `dsh://config:path/nope.missing` | **OK → 返回全文** | **静默回落（F8）** |
| `ctx://session:raw` / `:1-5` | OK | selectorAware 支持 raw/lines ✓ |
| `ctx://session/tool_calls[0]` | OK | **方括号写在 path 里** |
| `ctx://session/tool_calls[3]:1-2` | OK | 方括号 + 冒号 selector **可组合** |
| `ctx://session?q=user_prompts` | **ERR `CTX_BAD_SELECTOR` "unsupported selector kind \"query\""** | **不支持 query（F5）** |
| `ctx://session/tool_calls`（无括号） | ERR `no such element (collection "tool_calls" has 37 items, 0-based…)` | 集合需括号（F9） |
| `ctx://session/compactions`（无括号） | OK 列出 | 与上条不一致（F9） |
| `ctx://session/compactions[0]/original` | ERR no such episode（本会话 0 次 compaction） | `/original` = path 后缀 |
| `dvc://browser:1-3` / `dvc://:1-3` | OK | 非 selectorAware → 统一 selector 生效 ✓ |
| `dvc://ast_grep?q=lsp` | OK → 空（无命中行） | 非 JSON 走行过滤 ✓ |
| `agent://<id>/transcript:1-4` / `:raw` / `?q=sleep` | OK（child live 时） | 统一 selector ✓ |
| `agent://<id>/bogus` | ERR `unknown child agent "bogus" of "<id>"` | **L2 ≠ 自由 subpath，而是"后代 agent"（F10）** |

### ctx 的语法实现（源码锚点）

`handlers/ctx.ts` 自述 `selectorAware: true`；`applyFace()` 只处理 `raw` 与 `lines`，其余一律 `CTX_BAD_SELECTOR`。path 解析为：

```
// ── path parsing: session[/seg[[bracket]]…] ──
const sub = raw.slice('session'.length).replace(/^\/+/, '')
const segments = sub === '' ? [] : sub.split('/').filter(x => x !== '')
const parseSeg = (seg) => { const m = /^([a-z_]+)(?:\[(.+)\])?$/.exec(seg) … }
```

⇒ **`ctx://` 拥有"括号在 path + 冒号 selector 混用"的杂交语法**，与 `selector.ts` 的统一语法并列而非从属。

---

## 五、发现的偏差与缺陷

| # | severity | 结论 | 证据 |
|---|---|---|---|
| F1 | 高（已修） | `ctx://` 自 `074b6ae`(v0.1.8c) 起缺席**所有** `read` 枚举；且是唯一被系统提示词单列 bullet 的 scheme | `git log -S'skill/agent/dsh/dvc/ctx'` 零命中；实测 `read` 描述互文 |
| F2 | 中 | scheme 枚举点实为 **6 处**，非 user 以为的 2 处 → 已全部收敛到 `catalog.ts` | §二改动清单 |
| F3 | **高（未修）** | `dsh://docs` 在 `grep.ts`/`glob.ts`/`resolver.ts` 三处文档块声明为 **path-backed**，但**只有 `skill.ts` 实现了 `resolvePath`**，`dsh.ts` 没有 → grep/glob 实际走物化。后果：`glob("**/*.md", path="dsh://docs")` 返回 **0**（真实目录本应命中全部 md） | `grep -rn resolvePath handlers/` 仅 `skill.ts:159`；实测 `/dev/shm/…` |
| F4 | 中（未修） | `glob(pattern="dsh://docs")` 把 JSON 数组每行当 path 返回（`[`、`  "agent-lifecycle.md",`）——"content-backed 的行即列表"规则对 JSON 资源语义错误 | 实测 paths |
| F5 | 中（未修） | `ctx://` 拒绝 4 种 selector 中的 2 种（`:path/`、`?q=`），违反"五 scheme 共享一套 selector 语法" | `CTX_BAD_SELECTOR`；`applyFace()` |
| F6 | 低（未修） | `dvc://<device>/<sub>` 静默丢弃 `/sub`（`deviceNameFromPath` 只取首段）——无告警，易误以为二级寻址生效 | `dvc.ts` + 实测 226B 相同 |
| F7 | 中（未修） | bare 枚举规则不一致：`ctx://`/`dvc://`/`agent://` 列 roster；`dsh://` 报错但自我说明；`skill://` 报错且**误导**（`skill "" is unknown`）。文档"Bare `read <scheme>://` lists that scheme's surface"对 2/5 不成立 | 实测 |
| F8 | 中（未修） | dot-path 未命中**静默回落全文**（`dsh://config:path/nope.missing` → 整个 config）——拼写错误无任何反馈 | `applyPath`：`node === undefined ? text` |
| F9 | 低（未修） | ctx 集合行为不一致：`compactions` 无括号可列；`tool_calls`/`user_prompts`/`agent_responses` 无括号报错（好在报错含条数） | 实测 |
| F10 | 低（信息） | `agent://<id>/<x>`：`transcript` 为保留字，其余按"后代 agent id"解析；且 `/transcript` 要求 session **live** | 报错文案 + live child 对照实测 |
| F11 | 低（环境） | 本 runtime `skill://` 目录为空（`.agents/skills` 未被 skill provider 挂载）→ 全矩阵唯一完全不可用 scheme，且 `skill://` 的 path-backed 快路径因此**实际不可达** | 实测 + 早前 `skill://` 解析失败 |
| F12 | 中（未修） | **dvc device 的相对路径按服务进程 cwd 解析，而非 agent session cwd**：同一 `{path:"dashr/…"}` 相对路径失败、绝对路径成功 | 实测对照 |
| F13 | 低（未修） | device 参数 schema **不可发现**：`dvc://<device>` 只回一行 summary + 泛化 usage；`ast_grep` 的 summary 恰含 `{patterns,path?}`，而 `browser` 完全不含 `action` 判别键（实测须猜 `{"action":"open","url":…}` 才通） | 实测：`{"code":"close"}` → `unknown action null`；`{"action":"open","url":"about:blank"}` → OK（随后已 `{"action":"close"}` 清理） |

---

## 六、验证与基线对照

### 副本（Dev/Test 1）全量单测

```
Test Files  1 failed | 38 passed (39)
     Tests  1 failed | 482 passed (483)
```

唯一失败：`test/url-schemes/fs-backend.spec.ts > UrlAwareFileSystem backend (phase-2 spike) > builds the backend when the sandbox base resolves (dev workspace)`。

### 基线对照（改动前，同一副本、同一子集）

```
Test Files  1 failed | 18 passed (19)
     Tests  1 failed | 273 passed (274)
```

⇒ 失败集**完全同一**（同一 test 名）⇒ **本次改动零回归**；新增的 6-scheme 护栏断言在 482 通过之列。

### tsc

- 我改动的 5 个源文件 + 1 个 spec：**0 error**（`grep -cE 'catalog|general-section|selector|tools/read|tools/write'` = 0）。
- 副本残留 **1 个环境性 error**：`src/url-schemes/fs-backend.ts(67,31) TS2307 Cannot find module '@deepseek-ai/dsh-fs-sandbox'`。已证实：(a) 该文件 `git diff HEAD` 为空（未被本改动触碰）；(b) 该模块在副本 `node_modules` 中确实不存在——AGENTS.md §二 的 devDeps 手术名单（14 个）本就不含 `dsh-fs-sandbox`；(c) 与上表既存失败同域。**非本次引入**。

### canonical 侧说明

canonical `./dashr` 直接 `tsc` 有 9 处 error（`index.ts` 的 `tool/ptc-dispatch` 事件、`handlers/agent.ts` 的 `snapshotEvents`、`url-schemes/index.ts` 的 `SessionPersistenceSurface`、测试里的 `SessionSeq`/`isSeeded`）。这符合 AGENTS.md §二：canonical 保持 npm-range optional peers（发布语义），类型自洽只存在于做了 `workspace:*` 手术的副本。上述 error 全部**不涉及本次改动文件**。

---

## 七、未验证 / 遗留 / 待裁决

1. **未构建、未重启 4999**：本次只落 **canonical 源 + 副本源**（6 文件已 `cp` 到位）。`lib/` 仍是改动前的构建，故 §三/§四 的矩阵描述的是**改前行为**（正是本次要刻画的对象）；新的提示词/工具描述**尚未生效**。未执行 `tsdown && tsx scripts/build-client.ts` 与重启，理由：**重启 4999 会终止本 agent 会话**，且 `tsdown` 会先清空 `lib/`（含 `lib/client/`），中途失败会把 user 正在用的实例留在坏构建上——需 user 明确指令后再做。
2. **F3/F4/F12 属行为缺陷，未修**：修 F3 需在 `dsh.ts` 实现 `resolvePath`（或修正三处文档块承认物化）；修 F4 需为 JSON 资源定义"列表"语义。均超出"centralize"授权范围，等裁决。
3. **F5/F6/F7/F8/F9 属语法一致性问题，未修**：是否统一（让 ctx 也吃 `?q=`、让 dvc 对多余段报错、让 skill:// bare 列 roster、让 dot-path 未命中报错）需 product 裁决——每条都会改变现有可观测行为。
4. **prompt 预算 +847 chars**：若 user 认为常驻开销过高，可退化为"表格只在 `read` 描述内、系统段仅保留 grammar + 一行 scheme 名单"（总量不减，但可把表格从每轮系统提示挪到工具描述；或裁剪示例）。
5. `skill://` 的目录为空是**部署面**问题（`.agents/skills` 未被 skill provider 挂载），与本次代码改动无关；是否挂载待定。

---

## 八、复现命令

```bash
# 渲染单一源产物（对照 §二 的预算与 §三 的枚举）
cd /home/u1/workspaces/dashr/dashr
./node_modules/.bin/tsx -e "
import { renderGeneralSectionText, renderExampleHint, SCHEME_NAMES } from './src/url-schemes/catalog.ts'
console.log(SCHEME_NAMES.join(',')); console.log(renderExampleHint())
console.log(renderGeneralSectionText())"

# 副本全量验证（AGENTS.md §二 的权威验证位）
cd /home/u1/workspaces/dashr/upstream/deepseek-harness/packages/better-dsh/better-dsh
../../../node_modules/.bin/tsc --noEmit
../../../node_modules/.bin/vitest --run

# 活体矩阵（在 4999 会话的 eval pad 内）
#   await tool.read({"path":"ctx://session/tool_calls[0]"})
#   await tool.write({"file_path":"dvc://ast_grep","content":'{"patterns":["x"],"path":"/abs/path"}'})
#   await tool.glob({"pattern":"**/*.md","path":"dsh://docs"})
```

---

## 附：基线对照的原始计数

| 运行 | 范围 | 结果 |
|---|---|---|
| 副本（改前） | `test/url-schemes test/url-schemes.spec.ts test/surface-devices` | 274 tests / **1 failed** |
| 副本（改后） | 同上 | 274 tests / 1 failed（同一 test） |
| 副本（改后） | **全量** | **483 tests / 1 failed** |
| canonical（改后） | 同上子集 | 14+ failed（`SessionSeq`/`isSeeded` 类型漂移所致，非本次引入） |

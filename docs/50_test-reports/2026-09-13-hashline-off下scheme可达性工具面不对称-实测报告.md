# hashline:false 配置下 URL scheme 可达性的**工具面不对称** — 实测报告

- 日期：2026-09-13
- 被测对象：`dashr/src/url-schemes/` 七类 URL scheme（`skill://`、`agent://`、`dsh://`、`ctx://`、`dvc://`、`http(s)://`）在**当前活体配置**下的 `read`/`grep`/`glob`/`write` 行为。
- 被测运行时：**本 agent 自己所在的活体实例** —— `dsh web` @ `http://127.0.0.1:4999`，`DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`，`DSH_SESSION_ID=session-1ae1181e-abb7-4d59-939e-f5e0400a4258`，cwd `/home/u1/workspaces/dashr`。
- 方法：**第一人称实测**。全部调用由本 agent 在真实 runtime 中发出（`read`/`grep`/`glob`/`write` 工具），无静态推断。被观测返回值原文摘录于 §3。
- change：无（系统冒烟，非某 change 的验收）。
- 关联：`2026-09-12-fs-scheme-resolution-实测报告.md`、`2026-09-12-url-schemes-六scheme冒烟与边界实测报告.md`（差异见 §5）。

---

## 0. 结论速览

| 判定项 | 结果 |
|---|---|
| `dsh://` / `dvc://` / `http://` 在 `read` 上可达 | ✅ |
| `ctx://` / `agent://` 在 `read` 上可达 | ❌ 结构化 `CTX_SESSION_LAYER` 边界错误 |
| `skill://` 在 `read` 上可达 | ❌ 全部 `"is unknown or no longer available"` |
| `https://` 在 `read` 上可达 | ❌ `no handler registered for scheme "https"` |
| 同一批 scheme 在 `grep`/`glob` 上可达 | ✅ `ctx://`、`agent://`、`skill://`、`https://` 全部可达（§2、§3） |
| 根因 | **`hashline:false` 使 DASHR 的 `read` 包装不安装 → `read` 退化为平台原生工具 → 只剩 FS 层 resolver；`grep`/`glob`/`write` 包装仅由 `urlSchemes` 门控，仍在场 → 走工具层 resolver** |

**一句话**：不是 scheme 坏了，是**同一实例里 `read` 与 `grep`/`glob`/`write` 分属两套 resolver**。`hashline:false` 配置下，会话型（`ctx://`/`agent://`）与需 workspace 作用域的 `skill://` 只能经 `grep`/`glob` 抵达，`read` 是死的；`https://` 更因 FS 层只登记了 `http` 而整条断掉。

---

## 1. 环境与配置锚定

### 1.1 配置来源（profile 层唯一）

`.dsh-test/profiles/web/cordis.patch.yml`（0.1.5-rc.2 无 home patch 层，故 `.dsh-test/cordis.patch.yml` 空）：

```yaml
- id: dashr-repl
  config:
    python: !!js process.env.DASHR_KERNEL_PYTHON ?? 'python3'
    snapshotDir: /home/u1/workspaces/dashr/.dsh-test/snapshots
    hashline: false        # ← 关键
    urlSchemes: true

- id: fs-sandbox
  name: './node_modules/better-dsh/lib/fs-aware/sandbox-plugin.js'
  config:
    urlSchemes: true
```

### 1.2 活体日志佐证

`.scratch/dsh-4999.log`（每个 session-start 一行）：

```
DEBUG-INSTALL gates: {"urlSchemes":true,"hashline":false}
```

### 1.3 工具面身份判定（决定性）

当前 `read` 工具**不是** DASHR 的 URL-aware read：

| 证据 | 值 |
|---|---|
| 工具入参名 | `file_path`（DASHR 包装用 `path`，见 `url-schemes/tools/read.ts:92`） |
| 输出形态 | 行号前缀 `N: content`（DASHR 包装 scheme 分支返回原文、文件分支返回 `HASH│content`） |
| 包装注册门 | `url-schemes/index.ts:188` `if (gates.hashline) { …register(createReadTool…) }` → `hashline:false` 即不注册 |
| 注释自证 | `index.ts:158-159`：**"`hashline: false` → read wrapper 不安装（captured 原生 read 独立站立，scheme 解析由挂载的 FS 后端承担）"** |

`grep`/`glob`/`write` 的注册门是 `urlSchemes`（`index.ts:197`、`266-268`），故**仍在场**，走工具层 resolver。实测 `write dsh://config` 报的是 `url-schemes/tools/write.ts:130` 的文案、`write dvc://ast_grep` 成功派发，均可交叉印证工具层包装在场。

### 1.4 两套 resolver 的登记差异（根因表）

| resolver | 构造点 | 登记 schemes | 环境字段 |
|---|---|---|---|
| **工具层**（read/grep/glob/write 包装消费） | `url-schemes/index.ts:283-328` | `skill`、`agent`、`dsh`、`dvc`、`ctx`、**`HTTP_SCHEMES = ['http','https']`** | `{ agent, cwd, rawUrl }`（`tools/read.ts:119-121`、`tools/grep.ts:69`） |
| **FS 层**（原生 read/grep/glob 经 `ctx.fs` 消费） | `fs-aware/wrap.ts:49-59` | `skill`、`dsh`、`dvc`、**仅字面 `http`** | 仅 `{ fs, rawUrl }`（`wrap.ts:81`，**无 agent/cwd**） |
| **FS 层会话型守卫** | `wrap.ts:37-46`、`99-115` | `ctx://`/`agent://` → 结构化 `CTX_SESSION_LAYER` | — |

两处差异直接产生全部四个失败：`https` 未登记、`ctx`/`agent` 被守卫、`skill` 缺 `cwd`+`scope`。

---

## 2. scheme × 工具 可达性矩阵

（✅ 实测可达；❌ 实测失败；`—` 本轮未测）

| scheme | `read`（原生 / FS 层） | `grep`（工具层） | `glob`（工具层） | `write`（工具层） |
|---|---|---|---|---|
| `dsh://` | ✅ 列表/配置/选择器 | ✅（`path: dsh://docs` 命中 4 行） | ✅（`dsh://docs/subsystems` → 116 文件） | ❌ 只读（`tools/write.ts:130`） |
| `dvc://` | ✅ roster + 各设备文档 | — | — | ✅ 三设备真派发（`ast_grep`/`ast_edit`/`browser`） |
| `http://` | ✅（`example.com` 抓回） | — | — | ❌ 只读 |
| `https://` | ❌ **未登记** | ✅（`example.com` 命中） | — | — |
| `skill://` | ❌ **unknown** | ✅（`book-to-skill` 命中 560 行/约 130 文件） | ✅（全部文件路径列出） | ❌ 只读 |
| `ctx://` | ❌ **边界错误** | ✅（`user_prompts[0]` 命中本轮首条 prompt） | — | — |
| `agent://` | ❌ **边界错误** | — | ✅（物化到 `/dev/shm`） | — |

`dsh://` 选择器四形态在 `read` 上全通：`:N-M`、`:raw`（与 `:raw:N-M` 等价）、`:path/agent-loop`、`?q=`。

---

## 3. 原始观测（判定依据，原文摘录）

### 3.1 `read` 侧四个失败

```
read dsh://docs                      → ✅ 251 条文档索引
read dsh://config:path/agent-loop    → ✅ {"maxParallelToolCalls":10}
read dsh://docs/tool-catalog.md?q=ui-deliverables → ✅ 过滤命中 1 行

read skill://book-to-skill           → ❌ skill "book-to-skill" is unknown or no longer available
read skill://book-to-skill/SKILL.md  → ❌ 同上（子路径无效，仍是 registry 查无此名）
read ctx://session/transcript:1-8    → ❌ CTX_SESSION_LAYER: session-layer scheme — read it through the read tool (…)
read ctx://session/compactions       → ❌ 同上
read agent://                        → ❌ 同上
read https://example.com             → ❌ no handler registered for scheme "https" (registered: dsh, dvc, http, skill)
```

后者的 `registered: dsh, dvc, http, skill` 是 **FS 层 resolver 的登记表**，直接坐实 `read` 走的是 FS 层。

### 3.2 `grep`/`glob` 侧全通（反证）

```
grep  path=skill://book-to-skill  pattern=^#      → ✅ 560 matches（真实落到 .agents/skills/book-to-skill/*）
glob  path=skill://book-to-skill  pattern=*       → ✅ 约 130 条文件路径
grep  path=ctx://session/user_prompts[0] pattern="test your tools"
                                                  → ✅ 1 match:/dev/shm/dashr-url-UTBpHR/content.txt:2
grep  path=https://example.com    pattern="Example Domain"
                                                  → ✅ 1 match:/dev/shm/dashr-url-NqMEfC/content.txt:3
glob  path=agent://               pattern=*       → ✅ /dev/shm/dashr-url-6h2V9Y/content.txt
```

并可见 `ctx://` 选择器语法细节：集合下标是 **0-based 方括号**，标签为事件 seq：

```
grep path=ctx://session/user_prompts pattern=… → ❌ ctx://…[]: no such element
                                                  (collection "user_prompts" has 2 items, 0-based; labels are event seqs)
```

### 3.3 `write` 侧

```
write dsh://config   {…}   → ❌ write to dsh:// is not supported (read-only scheme, or its write channel is not wired yet)
write dvc://ast_grep {patterns:[…] path:/abs} → ✅ 结构化 payload 完整渲染（含 matches/totalMatches/parseErrors）
write dvc://ast_edit {ops:[…] dryRun:true}    → ✅ {"applied": false, …}（dryRun 生效，未落盘）
write dvc://browser  {"action":"open"|"close"} → ✅ {"ok":true,"url":"about:blank"} / {"ok":true}
```

**`dvc://` 设备 payload 已被完整渲染进工具结果**（见 §5 与旧报告的差异）。

### 3.4 旁路发现

1. **`dvc://` 设备相对路径以服务端 cwd 为根，不是会话 workspace。** `path:"."` 全量搜了 monorepo checkout（6950 文件，返回 `../../dashr/src/...`）；`path:"dashr/src"` 直接 `Path not found`；绝对路径才命中（163 文件）。设备 cwd = `upstream/deepseek-harness`。
2. **`ast_grep` 的 `export function $NAME` 形态静默 0 命中**，而 `function $NAME` 在同一路径命中 646。导出声明的 pattern 形态在本 vendored 实现下**不报错也不匹配**（部分语言另报 `Multiple AST nodes are detected`）。
3. **发布面残留调试日志**：`url-schemes/index.ts:154` 与 `:337` 仍有 `console.log('DEBUG-INSTALL …')`，并已在 4999 日志里逐 session 打印。
4. **会话指引与部署面不符**：本 session 收到的 URL scheme 指引把 `read` 描述为 `HASH│content` 锚点读；`hashline:false` 下实际是原生行号读。指引来源疑为 `renderGeneralSectionText()` / `generalSection()`（`index.ts:263`、`catalog.ts:135`），建议门控对齐。

---

## 4. 发现清单

### P1 — `https://` 在 FS 层未登记（一行修复，✅ 2026-09-13 复验存活）

`fs-aware/wrap.ts:57` 写死 `resolver.register('http', createHttpHandler())`，而工具层正确循环 `HTTP_SCHEMES = ['http','https']`（`handlers/http.ts:45`）。`hashline:false` 时 FS 层是 `read` 的唯一路径 → `read https://…` 恒失败。修法：`buildFsLayerResolver` 同样 `for (const s of HTTP_SCHEMES) resolver.register(s, handler)`。skill:// 重分类重构后复验：`read https://example.com` 正常抓取（session 60418790）。遗留小项（与本次无关，记录在案）：`read https://example.com:1-3` 这类**把行选择器写进 URL** 的形态会整串进 `new URL()` 报 invalid URL——http handler 不剥选择器后缀，dsh handler 剥（`dsh://docs:1-3` 正常）；属探针写法与既有限制，非本次回归。

### P1 — `skill://` 在 FS 层丢失 agent/cwd（workspace 技能全不可见）

`wrap.ts:81` 只给 `{ fs, rawUrl }`；`handlers/skill.ts:106-113` 的 `lookupOptions` 需要 `cwd` + `scope`，两者皆缺时 workspace 作用域技能层读作 absent → 全部 `unknown`。FS 层结构性拿不到 agent，所以要么把 skill 解析留在工具层、要么在 `hashline:false` 下补一条 scheme 呈现通道。

> **处置（2026-09-13 user 裁决后重定方向，推翻本报告早前的"补通道"方案）**：第一版补通道（sessionCwd 配置 + scopedAware list 启发式）经活体证伪——dump-config 实证 **dsh-web-app bundle patch 在宿主层 disable 了 `skill-filesystem`/`tool-skill`**，web profile 全局层没有任何 skill provider，list 与 get 同空，启发式从未命中（A/B 活体：user-global 的 `skill://markitdown` 与 project 的 `skill://book-to-skill` 双双 `unknown`，session 8b6dcf85）。根因不是"缺 cwd"，而是**技能加载路径解析（CWD/user-global/app 运行时根、扫描深度）是宿主 `dsh-skill-filesystem` 的业务逻辑**，FS 层不得自写近似版。最终处置：`skill://` 重分类为会话层 scheme，FS 层一律答 `CTX_SESSION_LAYER` 边界错误（指名原生 `skill` 工具）；`sessionCwd` 配置整体移除；工具层 handler lookup 收敛为 `dsh-tool-skill` 的精确镜像。详见 `2026-09-12-fs-scheme-resolution-实测报告.md` §4d 与 change design.md §D6。
>
> **活体复验（session 37899b26 / bfa99754 / f12a206e / 60418790 / 029aa5bb，2026-09-13）**：`read skill://book-to-skill` → 结构化边界错误（指名原生 skill 工具）；`read skill://markitdown:1-5` → 同（与技能名无关）；**原生 `skill` 工具加载 `book-to-skill` 成功**（完整 `<skill_content>` + resourceBase）；`grep path=skill://book-to-skill pattern=^#` → 560 matches（工具层通道完好）；`read https://example.com` → 正常抓取（P1-a 存活）。
### P2 — `hashline:false` 下会话型 scheme 无 `read` 通道，且注释与事实不符

`index.ts:288-290` 声称 *"Session-layer schemes (ctx://, agent://) answer the structured boundary error here; **the read tool's scheme branch keeps serving them with the calling agent's context**"* —— 该 "read tool's scheme branch" 只在 `hashline:true` 时存在。`hashline:false` 下 `ctx://`/`agent://` 在 `read` 上无任何通道（`grep`/`glob` 可用，但那是另一个工具面的补偿，不等于 read 通道）。注释与 `index.ts:158-159` 的 gate 说明应统一。

### P2 — 发布前清理 `DEBUG-INSTALL` 调试 `console.log`

`url-schemes/index.ts:154`、`:337`。

### P3 — `ast_grep` 导出形态 pattern 静默漏报

建议在设备文档或实现里显式声明支持的 pattern 形态（或对 0 命中且 pattern 含 `export ` 时给出提示）。

### P3 — `dvc://` 设备根目录与会话 workspace 不一致

易误伤脚本化调用（相对路径静默落到别的树）。建议设备文档写明"相对路径以服务端 cwd 为根"，或与 `ctxFsIO` 的 workspace 对齐。

---

## 5. 与既有报告的差异（待对齐）

| 项 | 既有报告 | 本轮观测 | 研判 |
|---|---|---|---|
| `read` 上六 scheme 全可达 | `2026-09-12-url-schemes-六scheme冒烟与边界实测报告.md` §0：**✅ 6/6** | `read` 上 `ctx`/`agent`/`skill`/`https` **全 ❌** | **两次实测的 `gates` 不同**：该报告应以 `hashline:true`（DASHR read 包装在场）跑出；本轮为 `hashline:false`。二者不矛盾，但结论必须带配置标签——"六 scheme 可达"仅在 `hashline:true` 成立 |
| `glob` 的 URL-in-`path` 分支在 `dsh://docs` 失效 | 同上 §0：⚠️ 失效 | ✅ 正常（`glob path=dsh://docs/subsystems` → 116 文件） | 疑似已修或与 `hashline` 门控相关，建议复测后销项 |
| `dvc://` 设备 payload 在渲染面丢失 | 同上 §0：❌ 缺口（只输出 `Executed dvc://<device>`） | ✅ payload 完整渲染（§3.3） | **该缺口在当前构建已不复现**，建议销项 |
| FS 层 = skill/dsh/dvc/http，会话型走边界错误 | `2026-09-12-fs-scheme-resolution-实测报告.md` §1/§2（D2） | 一致 | ✅ 与本轮 §1.4 完全吻合；本轮增量是**定位到"read 独有"**并给出 `https`/`skill` 两个具体缺口 |

**建议**：两份 09-12 报告在标题或结论处补注其 `gates.urlSchemes/hashline` 取值，否则后来者会据"6/6"误判 `read` 可用性。

---

## 6. 未覆盖面（诚实声明）

- `grep` 未测 `dvc://`、`agent://`、`http://`；`glob` 未测 `ctx://`、`http(s)://`、`dvc://`（矩阵中以 `—` 标注）。
- `write` 仅测 `dvc://`（三设备）与 `dsh://`（只读拦截）；未测 `ctx://`/`agent://`/`skill://` 写拦截的具体错误分类器。
- 未测 `hashline:true` 组合作对照（本轮无该实例），故 §5 的"配置差异"为**推断**，需一次 `hashline:true` 复跑坐实。
- 未测 `skill://` 的**全局（非 workspace）技能**路径——它们可能不依赖 cwd，若存在则 FS 层 `skill://` 并非全灭。
- 未覆盖工具：`eval` 桥（`await tool.*` 内调用 scheme）、`present`、`subagent`、`workflow`、`agent_message`、`web_search`、`web_fetch`、`goal_*`、`todo_write`、`ask_user_question`。
- 未做 `tsc`/`vitest`——本轮是活体冒烟，非 change 验收。

---

## 附：探针清单（可复现）

```
# read（原生 / FS 层）
read dsh://docs
read dsh://config:path/agent-loop
read dsh://docs/tool-catalog.md?q=ui-deliverables
read skill://book-to-skill            # ❌ unknown
read ctx://session/transcript:1-8     # ❌ CTX_SESSION_LAYER
read agent://                         # ❌ CTX_SESSION_LAYER
read https://example.com              # ❌ unregistered
read http://example.com               # ✅

# grep / glob（工具层）
grep path=dsh://docs pattern=trustedHosts
glob path=dsh://docs/subsystems pattern=*.md
grep path=skill://book-to-skill pattern='^#'
grep path=ctx://session/user_prompts[0] pattern='test your tools'
grep path=https://example.com pattern='Example Domain'
glob path=agent:// pattern='*'

# write（工具层）
write dvc://ast_grep {"patterns":["function $NAME"],"path":"/home/u1/workspaces/dashr/dashr/src","limit":3}
write dvc://ast_edit {"ops":[{"pat":"console.log($$$A)","out":"logger.info($$A)"}],"paths":[…],"dryRun":true}
write dvc://browser {"action":"open","url":"about:blank"} ; write dvc://browser {"action":"close"}
write dsh://config "nope"             # ❌ read-only
```

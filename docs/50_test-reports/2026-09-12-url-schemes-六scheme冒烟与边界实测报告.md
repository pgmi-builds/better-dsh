# dsh-url-schemes 六 scheme 冒烟与边界实测报告

- 日期：2026-09-12
- 被测对象：`dashr/src/url-schemes/` 的六类 URL scheme（`skill://`、`agent://`、`dsh://`、`ctx://`、`dvc://`、`http(s)://`）在活体 runtime 中的 `read`/`write`/`grep`/`glob` 行为。
- 被测运行时：**本 agent 自己所在的活体实例** —— `dsh web` @ `http://127.0.0.1:4999`（`DSH_WEB_URL`），`DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`，session id `session-92ef9c82-fbf8-4b71-87af-a92125e0734c`，cwd `/home/u1/workspaces/dashr`，agentPreset `standard`。
- 方法：**第一人称实测**——全部调用由本 agent 在真实 runtime 中发出（`read`/`write`/`grep`/`glob` 工具 + `eval` pad 内 `await tool.*`），无静态推断、无人工转写返回值。`dvc://` 写路径的"是否真落地"由回读文件系统二次确认。
- change：无（本轮为既有能力的系统冒烟，非某个 change 的验收）。

---

## 0. 结论

| 判定项 | 结果 |
|---|---|
| 六类 scheme 在 `read` 上全部可达 | ✅ 6/6 |
| 未登记 scheme / 已登记只读 scheme 的写拦截 | ✅ 三类错误各自精确（`URL_READ_ONLY` / `URL_WRITE_UNSUPPORTED` / `URL_UNREGISTERED_SCHEME`） |
| `dvc://` 写是否**真实执行**（非 dry-run 空转） | ✅ `ast_edit` `dryRun:false` 改写落盘，回读确认 |
| 选择器四形态（`:raw` / `:N-M` / `:path/` / `?q=`） | ✅ 基本全通；目录列表上的 `?q=` 不过滤（§3.3） |
| `http(s)://` selector-exempt（端口/查询不误解析） | ✅ `:443` 与 `?x=1` 均原样进请求 |
| 内容型 scheme 的 `grep`/`glob` 支持 | ⚠️ `grep` 经 `/dev/shm` 物化可用；`glob` 的 URL-in-`path` 分支在 `dsh://docs` 上失效（§3.4） |
| **`dvc://` 结果的 wire 可见性** | ❌ **缺口**：`write` 渲染面只输出 `Executed dvc://<device>`，设备 payload 仅存在于结构化 `after` 字段（§3.1） |

**一句话**：六类 scheme 功能面完整、错误分类精确、`dvc://` 写是真执行；唯二值得处理的是 **`dvc://` 设备结果在渲染文本里丢失**（直接影响 `ast_grep`/`lsp`/`browser` 的可用性），以及 **`glob` 在 `dsh://docs` 上的 path 分支空转**。

---

## 1. 被测对象与环境事实

| 项 | 值 |
|---|---|
| 运行时 | `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`；`DSH_SESSION_ID=session-92ef9c82-fbf8-4b71-87af-a92125e0734c`；`DSH_SHELL=1` |
| GUI 端点 | `http://127.0.0.1:4999`（监听于 `127.0.0.1`）；直连无 token 返回 **401** `dsh web authentication required; reopen the URL printed by dsh web.`（≈133 B，空 `<title>`） |
| 方案单源 | `dashr/src/url-schemes/catalog.ts` 的 `SCHEME_CATALOGUE`（六条、`SCHEME_NAMES` 排序后 = `agent, ctx, dsh, dvc, http, https, skill`） |
| 实现入口 | `dashr/src/url-schemes/index.ts`（挂载）、`resolver.ts`（端到端解析）、`selector.ts`（统一选择器）、`handlers/*`（六 scheme）、`tools/{read,write,grep,glob,materialize}.ts`（工具改写） |
| 设备实现 | `vendored/devices/ast/ast-device.ts`（`ast_edit`/`ast_grep`）、`vendored/devices/browser/browser-device.ts`、`vendored/devices/lsp/lsp-device.ts` |
| 已核 ctx 快照 | `ctx://session`：segments（live 0–34）、`system_prompt.chars = 0`、totals 与后续增长一致 |
| 临时物化 | `grep` 对 URL 内容物化到 `/dev/shm/dashr-url-*/content.txt`；调用后目录被清理（收尾核 `/dev/shm` 为空） |

---

## 2. 逐 scheme 实测矩阵

| Scheme | 已测形式 | 实测结果 |
|---|---|---|
| `skill://` | 裸根；`skill://dsh-dev-skill`；`/SKILL.md`；`/chapters/ch01-user-guide.md`；`:1-4`；`glob` 列目录 | 裸根 → `skill "" is unknown or no longer available`；`dsh-dev-skill` → 全文（= `.agents/skills/cordis-dsh-dev/SKILL.md`）；子文件可读；`:1-4` 正确截 4 行；`glob` 返回 26 个真实相对路径 |
| `agent://` | 裸根；`agent://<原始id>`；`<原始id>/transcript`；`:1-8`；`agent://<label>`；含 `:` 的 label | 裸根 → `no agents`（无子 agent 时）/ 之后为 4 列表格；settled child 原始 id → 产出物 `pong`；live child transcript 可读并可开窗；label 可寻址；含 `:` 的 label → 选择器解析错误（§3.5） |
| `dsh://` | 裸根；`/docs`；`/docs/subsystems`；`/docs/subsystems/slots.md?q=priority`；`/config`；`:path/` 点路径（含数组下标） | 裸根 → `expected "docs" or "config"`；目录列 JSON 数组；文件可读；`?q=priority` → 3 行命中；`/config` → 完整配置 JSON；`:path/permission.defaultPreset` → `workspace-write`；`:path/llm-deepseek.models.0.id` → `deepseek-flash` |
| `ctx://` | 裸根；`transcript`；`system`；`thinking[0]`；`user_prompts[0]`；`tool_calls[n]`；`agent_responses[0]`；`injections:raw`；`compactions`；`:raw:N-M` | 全部可读；`[n]` 按 0 基序号或事件 seq 双寻址；越界报错带集合长度；`compactions` 无内容 → `(no compactions recorded)`；`:raw:1-3` ≡ `:1-3` |
| `dvc://` | 裸根；设备文档（4 个）；`write` 执行（`ast_grep`/`ast_edit`/`browser`）；非法参数；尾部 `/sub` | 裸根 → 4 行设备表；设备文档 + usage 提示；写执行见 §4；非法 JSON → 带解析信息的错误；`dvc://browser/ignored-sub` → 仍返回 browser 文档（首段寻址） |
| `http(s)://` | `read` 原始 GET；`web_fetch` 解码；`?x=1`；`:443`；loopback | `read https://example.com` → 原始 HTML（带 `[url-fetch]` 前缀）；`web_fetch` → 解码纯文本；查询与端口均原样保留；`127.0.0.1` 被拒（§3.6） |

---

## 3. 关键发现

### 3.1 `dvc://` 设备结果在 wire 渲染面上不可见（唯一实质性缺口）

`tools/write.ts` 对 `dvc://` 写构造 `WriteOutcome{ operation:'execute', after: JSON.stringify(result,null,2) }`，但 `render` 只输出：

```
const verb = … value.operation === 'execute' ? 'Executed' : …
return [{ type: 'text', text: `${verb} ${value.path}` }]
```

→ 渲染文本恒为 `Executed dvc://ast_grep`。设备 payload 只在结构化 `after` 里。

实测对照（同一次 `ast_grep` 调用）：

- 直接 `write dvc://ast_grep` → 模型侧只看到 `Executed dvc://ast_grep`；
- `eval` pad 内 `await tool.write({"file_path":"dvc://ast_grep", …})` → 完整 JSON：`totalMatches:143`、`filesWithMatches:28`、`filesSearched:162`、`limitReached:true`、`matches[]`（含 `byteStart/startLine/…`）、`parseErrors[]`。

**影响**：模型直调 `ast_grep`/`lsp`/`browser` 拿不到任何结果数据（既无匹配也无报错），而这三个设备恰是输出价值最高的三个。建议 `write.ts` 的 device 分支把 payload 一并渲染进文本（或以可读摘要进文本、全量进 structure）。这是本轮唯一建议改代码的点。

### 3.2 `skill://` 按 frontmatter 名寻址，而非目录名

`skill://dsh-dev-skill` 命中，其解析路径为 `.agents/skills/cordis-dsh-dev/`——目录名 `cordis-dsh-dev` 反而不被接受（`skill "cordis-dsh-dev" is unknown`）。同理 `superpowers`（顶层无 `SKILL.md`）不可寻址，裸 `skill://` 亦报未知。属正确语义（skill 名 = frontmatter `name`），但"猜目录名"是最自然的错误路径，可考虑错误信息附带候选名提示。

### 3.3 `?q=` 在目录列表上不过滤

- `dsh://docs/subsystems/slots.md?q=priority` → 正确返回 3 行命中（含行号与上下文）；
- `dsh://docs/subsystems?q=slots` → 返回**未过滤**的完整 98 项目录列表。

即查询选择器只在"文件内容"语义下生效，目录列表（JSON 数组）上的 `?q=` 静默失效。建议改为：JSON 无匹配路径时对列表做行过滤，或明确忽略时给出提示。

### 3.4 `glob` 的 URL-in-`path` 分支在 `dsh://docs` 上空转

`tools/glob.ts` 头注声称 "path-backed schemes (`skill://`, `dsh://docs`) implement the handler's optional `resolvePath`"，但实测：

- `glob({path:"skill://dsh-dev-skill", pattern:"ch01*.md"})` → ✅ 1 个文件（pattern 生效，any-depth 语义正确）；
- `glob({path:"dsh://docs/subsystems", pattern:"slots.md"})` → ❌ `(no output)`。

对照 `glob({pattern:"dsh://docs/subsystems"})` → ✅ 返回列表（content-backed "非空行即列表" 分支）。结论：`dsh://docs` 实际走 content-backed，`glob-in-path` 把列表 JSON 物化成 `content.txt` 后自然搜不到 `slots.md`。**头注与实现不符（注释过期）**，建议二选一：给 dsh docs 补 `resolvePath`，或订正注释。

### 3.5 含 `:` 的 agent label 无法寻址

`agent://Dummy child for agent:// test` → `invalid line selector ":// test" — expected N, N-M, or N-M,N2-M2`。原因是 `parseUrl` 的 path 截断在第一个 `:`，label 中的 `://` 被当成选择器。**原始 session id 始终可寻址**（本轮据此拿到 settled child 的 `pong` 产出物）。属方案语法的固有边界，值得在 `agent://` 文档里点明"label 含 `:` 时请用原始 id"。

### 3.6 `http(s)://` 的两条路径与 SSRF 门

- `read https://example.com` → 原始 curl 式 GET（返回完整 HTML，前缀 `[url-fetch] plain-text result of a direct HTTP GET (curl-equivalent). No JS execution or interaction`）；
- `web_fetch https://example.com/` → 解码后的纯文本；
- `read https://example.com:443/` 与 `?x=1` → 原样进请求（selector-exempt 生效，未误判为行选择器/点路径）；
- `web_fetch http://127.0.0.1:4999/` → ❌ `URL hostname "127.0.0.1" resolves to a non-public IP address`（私网/回环 SSRF 门，与官方文档 Ch1 "web_fetch to literal private addresses is refused" 一致）；
- `dvc://browser` 走设备路径**可合法访问 loopback**：`open http://127.0.0.1:4999` → `{ok:true,url:"http://127.0.0.1:4999/",title:""}`；页内求值 `document.title` → `""`、`bodyLen:133`。经 curl 侧核验，该 133 B 即 **401 认证栅栏文本**——浏览器探针到达了服务端但未携带 token（预期行为，非传输故障）。

### 3.7 错误分类精确、可直接排障

| 触发 | 返回 |
|---|---|
| `write ctx://session/transcript` | `ctx:// is a curated read-only snapshot — write to ctx://session/transcript is not supported`（`URL_READ_ONLY`） |
| `write skill://dsh-dev-skill/SKILL.md` | `write to skill:// is not supported (read-only scheme, or its write channel is not wired yet)`（`URL_WRITE_UNSUPPORTED`） |
| `write foo://bar` | `no handler registered for scheme "foo" (registered: agent, ctx, dsh, dvc, http, https, skill)` |
| `read dvc://nope` | `unknown device: nope` |
| `read ctx://session/tool_calls[999]` | `no such element (collection "tool_calls" has 40 items, 0-based; labels are event seqs)` |
| `write dvc://ast_grep`（非 JSON） | `dvc:// write dispatch: device "ast_grep" requires a JSON args payload (Unexpected token 'h', "this is not json" is not valid JSON)` |
| `dvc://lsp`（action 缺失 / 二进制缺失） | 先 `unknown action null — expected "diagnostics", "definition", "references", "hover", or "format"`；补 `action` 后 → `language server binary "typescript-language-server" not found … — npm install -g typescript-language-server typescript` |
| `dvc://browser`（action 缺失） | `unknown action null — expected "open", "run", or "close"` |

### 3.8 临时物化无残留

`grep` 对 `dsh://docs/subsystems/slots.md` 的搜索把内容物化到 `/dev/shm/dashr-url-c2cNM0/content.txt` 后由 `finally` 清理；收尾核 `/dev/shm` 已空。符合 `tools/materialize.ts` 的设计（shm 优先、>8 MiB 回退 `os.tmpdir()`）。

---

## 4. `dvc://` 写路径的真执行证据（核心）

### 4.1 `ast_edit`（`dryRun:false`）真实落盘

目标 scratch 文件（写前）：

```js
export function greet(name) {
  return `hello ${name}`
}

export function farewell(name) {
  return `bye ${name}`
}
```

调用：

```json
{"ops": [{"pat": "export function farewell($N) { $$$B }",
          "out": "export function goodbye($N) { $$$B }"}],
 "paths": ["/home/u1/workspaces/dashr/.scratch/dvc-scheme-test.js"],
 "dryRun": false}
```

回读（写后）：

```js
export function greet(name) {
  return `hello ${name}`
}

export function goodbye(name) { return `bye ${name}` }
```

→ 函数名改写 + ast-grep 单行重排均落盘，**证明这是真执行而非空转**。（该 scratch 文件在收尾时已删除。）

### 4.2 `ast_grep` 结构化输出（经 eval pad 取得）

```json
{ "totalMatches": 143, "filesWithMatches": 28, "filesSearched": 162,
  "limitReached": true,
  "matches": [ { "path": "../../dashr/src/url-schemes/vendored/hashline/contract.js",
                 "text": "export function isNormalizedEdit(input) { … }",
                 "byteStart": 775, "byteEnd": 877, "startLine": 15, "startColumn": 1,
                 "endLine": 17, "endColumn": 2 }, … ],
  "parseErrors": [ "…: url-schemes/vendored/devices/lsp/defaults.json: GenericFailure, Invalid pattern: Multiple AST nodes are detected…" ] }
```

（`parseErrors` 出现在 `patterns` 含多节点模式时，属预期：该 pattern 在 JSON 文件上不成立。）

### 4.3 `dvc://` 首段寻址

`read dvc://browser/ignored-sub` → 仍返回 browser 设备文档，证实 `catalog.ts` 所述"`dvc://` 只按第一段寻址，尾部 `/sub` 被解析后丢弃"。

---

## 5. 遗留与建议（按优先级）

1. **【建议改码】`dvc://` 设备 payload 进渲染文本**（§3.1）——否则 `ast_grep`/`lsp`/`browser` 对模型是"看得见工具、看不见结果"。当前唯一绕行 = 在 `eval` cell 内 `await tool.write(...)` 取 `after`。
2. **【建议改码或订正注释】`glob` 的 `dsh://docs` path 分支**（§3.4）——头注声称 path-backed，实际 content-backed 空转。
3. **【建议改码】目录列表上的 `?q=`**（§3.3）——静默失效，至少应给提示。
4. **【文档】`skill://` 按 frontmatter 名寻址**、**`agent://` label 含 `:` 需用原始 id**（§3.2/§3.5）——两条最易踩，建议进 `agent://`/`skill://` 的模型面说明或错误信息附提示。
5. **【无需动作】** `http(s)` 私网拒绝、`ctx://` 只读、`dvc://` 尾段丢弃、临时物化清理——均为设计内行为，已复核无异常。
6. **【未覆盖】** 本轮未测：`dvc://lsp` 的 `definition/references/hover/format` 成功路径（缺 `typescript-language-server`，仅验到报错分支）、`http(s)` 的重定向/压缩/大响应物化、`ctx://` 分片（compaction 后多 segment）形态。留待后续按需补测。

---

## 附：证据来源

- 全部返回值取自本 session（`session-92ef9c82…`）在 `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test` 下的活体调用；`ctx://session/tool_calls[n]` 事后可回放本轮每一次调用与其结果。
- 源码核验：`dashr/src/url-schemes/{catalog,selector,resolver,index}.ts`、`handlers/{agent,ctx,dsh,dvc,skill,http}.ts`、`tools/{read,write,grep,glob,materialize}.ts`、`vendored/devices/ast/ast-device.ts`、`vendored/devices/browser/browser-device.ts`。

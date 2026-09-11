# URL Schemes 服务化与 ctx:// 可回溯上下文（recallable context）

## Why

压缩（compaction）把被 shadow 的历史原文留在 append-only session log 里，但模型看不见任何入口：checkpoint 可见文本无标识符（逐字节验证，`docs/60_exploration-and-research/04-session-storage/alpha5-compaction-jsonl-mapping.md` §4）、任意时刻 surface 只呈现最新 checkpoint（§12 三层验证）。模型既不知道发生过几次压缩，也无法回看任何被压缩内容——上下文压缩的信息损失不可恢复。同时，现有 `dsh-url-schema` 模块存在两处结构债：(a) read wrapper 的 file branch 硬编码 vendored hashline 管线，URL 解析与 hashline 焊死在同一 shipment，单独发布即成残疾服务（§15.8）；(b) 服务名 `schema` 系误拼（RFC 3986 术语为 scheme），且管理复数注册表应取复数（§15.7）。

## What Changes

- **正名与独立化**：`dsh-url-schema` → **`dsh-url-schemes`**（目录/服务名/patch 行 id 同步）；服务形态对齐 FS 教科书（`dsh-fs` 服务包 ‖ `tool-fs` 工具包分离）：服务包只含 UrlResolver + scheme handlers（零工具），四个 URL-aware 工具 wrapper 是消费服务的工具层。
- **config gates**：`Config = { urlSchemes?: boolean = true, hashline?: boolean = true }`——patch 行 `config:` 块可独立关停 URL 能力或 hashline 能力；关闭的 branch 直通 captured native definition（capture-and-delegate，语义名锚定：`ctx.tools.get(name, agent)`）。
- **read chassis + transform 管线**：read 的注册权归 url-schemes chassis（同层同名硬错 ⇒ 不允许第二个 read wrapper，§15.9 勘误）；chassis 内有序 transform 链（URL transform → hashline anchor transform → … → 终端 delegate = captured native read）；hashline 以 transform 身份接入（chassis 缺席时 fallback 自持最小 wrapper）。
- **ctx:// 重塑（recallable context）**：`ctx://session` 升级为**统计快照**（prepared 默认面：session 头 + identity 字段吸收 + storage/totals/per-segment 统计 + compactions 清单内联 + 每档 8 段各前 100 字预览 + `replaces_checkpoint` 嵌套链）；`ctx://model`/`ctx://cwd` 收敛为快照内信息卡（一级 key 移除）。文法：`ctx://session/<sub-path>[<label|ordinal>][:raw][:<lines>]`——slash 子路径 + 方括号元素定位（label = compaction/summary 事件 seq 精确命中优先、miss 回落 0-based 序号）+ 冒号行寻址；`:raw` = canonical 全文（跳过 prepared 面），行号恒作用 canonical。
- **嵌套链可寻址**：manifest 条目携带 `replaces_checkpoint`；任一档可下钻 summary（默认）或 shadowedSeqs 原文；失败压缩（无 summary 事件）天然不入档。
- **披露分层（OMP 三层模型）**：`url-schema:general` guidance section（数百字：通用文法 + 裸 `read <scheme>://` 枚举指引 + 大资源 AVOID）+ 入口资源一行语法提示 + 响应尾行动 note + 未知 label 回显有效清单。
- **Phase 2（spike，同 change 内独立验收）**：`UrlAwareFileSystem extends SandboxedFileSystem`——`resolve` 拦 `scheme://` → virtual FsTarget（stat 照答 `type:'file'`），`readText` 解引用，写系对 virtual key 返 typed 只读错误，其余 super 透传；挂载 = home 层同 id 行重述 `fs-sandbox` row。达成基底正交：未 wrap 的原生 read/edit 亦能读 `ctx://`。

## Capabilities

### New Capabilities

- `compaction-recall`：被压缩历史的可寻址回溯（manifest、label 语义、canonical/prepared 二元面、嵌套链、失败剧集排除）。

### Modified Capabilities

- `ctx`：`session` key 从 identity JSON 升级为统计快照（吸收 model/cwd 信息卡）；新增子路径文法（compactions/user_prompts/tool_calls/agent_responses/transcript）；`:raw`/行号语义；未知 key 错误改回显 key 清单。
- `url-schema`：服务正名 `dsh-url-schemes`；config gates 双开关；read chassis + transform 管线（read 注册权单一化）；write/grep/glob 维持 capture-delegate；`url-schema:general` section 披露。

## Impact

- **代码**：`dashr/src/url-schema/` → `dashr/src/url-schemes/`（正名）；`handlers/ctx.ts` 重塑（统计快照 + 子路径 + 文法解析）；`tools/read.ts` 改造为 chassis + transform；`native-capture.ts` 增 capture `read`；`index.ts` config gates；新增 `handlers/` 子资源解析与 session log 读取（`session.jsonl.zstd` → seq 索引）；新增 guidance section。
- **测试**：ctx handler 规格（快照字段、文法、`:raw`、嵌套链、失败剧集排除）、chassis transform 顺序、config gates、hashline fallback、fs backend spike 行为。
- **行为兼容**：`ctx://session` 旧消费者（identity JSON）获得超集字段；`ctx://model`/`ctx://cwd` 一级 key 移除（BREAKING，快照 roster 与 guidance 同步更新）；URL 文法新增不破坏既有 path 寻址。
- **性能**：session log 解析为整文件 zstd 解压 + 单遍扫描（seq 索引）；统计快照实测 6.2KB @ 3 压缩（预算成立）；原文解引用 lazy、超截断不管（agent 自有工具组合）。
- **风险**：宿主 read 的 scheme 枚举是我们 wrapper 的 description（宿主原生 read 零 scheme 感知已核实）——chassis 缺席时 URL 能力随 gate 关停，属设计内；fs backend spike 触及全 fs 消费者，独立验收、可整体放弃。
- **验证红线**：单测全绿 + 4999 第一人称实测（真实会话灌压触发 `/compact` → 读 `ctx://session` → 按 label 下钻 → `:raw`/行区间 → 嵌套链回溯）+ 报告落 `docs/50_test-reports/` + **user 单次确认后才 `npm publish`**（AGENTS §〇）。

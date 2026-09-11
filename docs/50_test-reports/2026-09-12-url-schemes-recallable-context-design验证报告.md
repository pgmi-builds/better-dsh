# design.md 设计符合性验证报告 — URL Schemes 服务化与 ctx:// 可回溯上下文

- **被验对象**：`openspec/changes/2026-09-11-url-schemes-recallable-context/design.md`（D1–D8）
- **对照物**：同 change 的 spec delta（`specs/url-schema/spec.md`、`specs/ctx/spec.md`、`specs/compaction-recall/spec.md`）+ 实际代码 + 4999 活体行为
- **验证时间**：2026-09-12 06:41 ~ 07:0x（UTC+8）
- **验证者**：agent（本会话即 4999 测试实例）
- **结论**：**不通过（有条件）**——D1/D3 机制陈述与实现一致；D2/D4/D5/D6 存在 4 项实质偏差（其中 2 项为 spec 要求未落地：快照 `segments`、read transform 链），另有 6 项证据/文案失真。**未触发任何发布动作**（AGENTS §〇 红线未动）。

---

## 1. 验证环境与被验代码的身份锚定

| 项 | 值 |
|---|---|
| 运行时 | `DSH_HOME=/home/u1/workspaces/dashr/.dsh-test`，GUI `http://127.0.0.1:4999`，会话 `session-e96cd10a-41c8-4e82-89fd-5ff4118b9d41` |
| 插件版本 | `better-dsh@0.2.3-d` |
| 活体实现位置 | `upstream/deepseek-harness/packages/better-dsh/better-dsh/`（profile `web` 的 bundle 成员） |
| canonical 源 | `dashr/` |

**身份锚定（关键前提）**：`diff -rq dashr/src upstream/deepseek-harness/packages/better-dsh/better-dsh/src` 与 `.../test` **均无输出** ⇒ 本轮被验的 canonical 源与 4999 实际运行的代码**逐字节相同**，「源码核验」与「第一人称实测」指向同一份实现，不存在副本漂移。

## 2. 验证方法（四路独立取证）

| 路径 | 手段 | 产物 |
|---|---|---|
| A 源码锚点 | 逐文件读取 `src/url-schemes/**`，对每条 design 陈述定位实现点 | 本报告 §4 表格 |
| B 第一人称 live 探针 | **以本会话自己的 `read` 工具**打真实 URL（read 即被验 chassis） | §5 |
| C 单测全量 | `npx vitest run`（canonical `dashr/`） | `.scratch/verify-url-schemes-vitest.log` |
| D 类型/规格 | `npm run typecheck`；`openspec validate <change> --strict` | `.scratch/verify-url-schemes-tsc.log` |

## 3. 一句话判定表

| design 项 | 判定 | 一句话 |
|---|---|---|
| D1 文法（slash/bracket/colon） | ✅ 一致 | 解析器与 ctx handler 与设计同构，live 全通 |
| D2 canonical/prepared 二元 | ⚠️ 部分 | 模型成立，但设计说 `/transcript` 已裁撤——实现与 ctx spec 都保留它 |
| D3 label 与失败剧集 | ✅ 一致 | label = `compaction/summary` seq，嵌套链、失败排除均成立 |
| D4 服务形态与 read chassis | ❌ 不符 | 单一注册权 ✅、capture-delegate ✅，但 **有序 transform 链是死代码**；hashline 独立化（tasks 2.3）未交付 |
| D5 ctx handler 重塑 | ❌ 不符 | 快照缺 **`segments`（ctx spec 明文要求）**；`system_prompt` 条件性消失；未知 key 不回显子路径 |
| D6 披露三层 | ⚠️ 部分 | 单源/门控/description 静默 ✅；但 **bare-root 即 help 对 `skill://` 是假的**；≤600 chars 预算说法不成立 |
| D7 Phase-2 继承式 fs backend | ⚠️ 未挂载 | 代码+单测齐（fail-soft），未挂载，设计的收益（未 wrap 的原生 read/edit 可读 `ctx://`）**未兑现** |
| D8 验证与红线 | ✅ 纪律守住 | openspec strict 过、url-schemes 8/8 文件全绿；14 挂与 tsc 13 错已独立定性为宿主 API 漂移；未 publish |

## 4. 逐项取证

### D1 文法 — ✅ 一致

- `selector.ts:36` `SCHEME_RE` 认 `scheme://`；`:59-60` 首标记（`:` 或 `?`）切 path/selector；`:72` `SELECTOR_EXEMPT={http,https}` ⇒ `:8443` 是端口、`?x=1` 是 query（与设计「variance」一致）。
- `:97-99` `selPart.startsWith('raw:')` ⇒ 组合式 `:raw:N-M` 解析为 `lines`，与 `:N-M` 同构（tasks 6.2 首轮抓到的 spec gap 已修）。
- `[<label|ordinal>]` 不进 `parseUrl`，由 handler 消费（`ctx.ts:322-329` `parseSeg` 正则 `^([a-z_]+)(?:\[(.+)\])?$`）⇒ 设计「换内容 → path/brackets；换看法 → colon modifier」在实现里成立。
- `handlers/ctx.ts:376-380` `pickEpisode`：`String(e.label) === bracket` 精确优先，miss 回落 `Number(bracket)` 0-based —— 与设计 D1/D3 逐字一致。

### D2 canonical / prepared — ⚠️ 部分（设计已过时）

- 成立部分：`session` 裸=快照（`ctx.ts:335-339`，`applyFace(prepared, canonical, sel, 'prepared')`），`:raw`/行窗恒作用 canonical（`applyFace` `:200-207`）；`compactions[label]` 裸=8 段 summary、`:raw`=shadowedSeqs 原文（`:355-368`）。
- **不符**：design.md D2 写「`/original`、`/transcript`、`/events` 子路径全部裁撤」。实际：`/original` 确实裁撤（`ctx.ts:370-374` → `CTX_BAD_PATH`），但 **`/transcript` 被保留为 canonical 别名**（`ctx.ts:334` `seg0.name === 'transcript'` → `forceCanonical`），ctx spec「Bare listing」也明文要求列出 `transcript`。live 探针 `ctx://session/transcript:1-3` 正常返回 3 行（§5）。
- 另：design.md（D1/D5/D6）**通篇未提 `thinking` / `system` 两个集合面**，而 ctx spec 有独立 ADDED Requirement「Thinking and system collections」，实现齐备（`ctx.ts:388-436`）。design.md 是 reshape 前的产物（reshape 过程见既有实测报告 §3.2.1）。

### D3 label 与失败剧集 — ✅ 一致

- `ctx.ts:283` `if (e.type !== 'compaction/summary') continue` ⇒ label = summary 事件 seq；失败压缩无 summary 事件 ⇒ 天然不入档（与 spec「Failed compaction is not addressable」同构）。
- `ctx.ts:311-313` `replacesCheckpoint = prevCheckpoint !== null && d.shadowedSeqs.includes(prevCheckpoint) ? prevCheckpoint : null` ⇒ 嵌套链（信息金字塔）成立；单测 fixture 两档嵌套断言 `compacted[1].replaces_checkpoint === 21` 绿。

### D4 服务形态与 read chassis — ❌ 不符

成立部分：
- 服务零工具 + 四 wrapper 在工具层：`index.ts:14-24` 只 register handler，工具注册在 `installAgentTools`（`:169-261`）。
- capture-before-register 纪律：`native-capture.ts` + `wiring.spec` 断言 `capture:write/grep/glob/host_extra` 全部先于 `agent-register:read`，且 `NATIVE_TOOL_NAMES = ['read','write','grep','glob']`（`native-capture.ts:57`）。
- capture-delegate 与结构化缺省错误齐备：`NATIVE_WRITE_UNAVAILABLE`（write.ts:199）、`NATIVE_GREP/GLOB_UNAVAILABLE`（grep.ts:86 / glob.ts:84）、`NATIVE_READ_UNAVAILABLE`（read.ts:154）。

**不符（实质）**：
1. **有序 transform 链未接线**。`transforms.ts` 导出的 `createUrlTransform` / `createAnchorTransform` / `ReadTransform` **在全仓（src+test）零调用点**——仅被 `general-section.ts:23`、`fs-backend.ts:26` 当 **类型** 引入 `ReadGates`。`read.ts` 仍是内联双分支结构（`:117` urlSchemes 分支 / `:130` hashline 分支 / `:147` 终端 delegate）。
2. 由此 `transforms.ts:50` 的注释「Scheme-prefix fork — **kept in ONE place** so every stage agrees on the split」是假的：`SCHEME_URL_RE` 在 `read.ts:73` 与 `transforms.ts:50` **各定义一份**。设计 D4「chassis 内有序 transform 链」与 url-schema spec ADDED「Read chassis with ordered transforms」目前只有「单一注册权 + 终端 delegate」满足，**链本身不存在**。
3. 设计 D4「hashline 以 transform 身份接入（chassis 缺席时 fallback 自持最小 wrapper）」= tasks 2.3，**未做**（tasks 2.3 未勾）。当前 hashline 锚点能力**无法脱离本插件独立安装**——插件缺席即无锚点。这不是回归（旧行为相同），但 spec 的这条 SHALL 未兑现。

### D5 ctx handler 重塑 — ❌ 不符

成立部分（live 逐字核对，§5）：
- identity 吸收（`ctx.ts:527-531`）：`id/createdAt/cwd/agentPreset/status/origin/delegationDepth`；`ctx://model` / `ctx://cwd` 一级 key 已移除（live `CTX_UNKNOWN_KEY`）。
- `storage` / `totals` 用 DSH 原生字段名并做零值规范化（`:503-513`）：live 实测 `user_prompts/injected_user_messages/agent_messages/block_reasoning/block_text/block_tool-call/tool_calls/tool_results/compactions` 九键齐。
- `compacted[]` 九字段 + 每档 8 段 ×100 字预览（`:533-541`、`sectionPreviews` `:186-194`）；顶层 `syntax` 字段（`:518`）；`hints` 三条（`:542-546`）。

**不符**：
1. **快照无 `segments`**。ctx spec MODIFIED「Curated snapshot keys」明文要求 prepared 面携带「per-compaction segments plus a `live` tail segment」，design D5 亦写「per-segment 分段（按 compaction 切段 + live 热区）」。`buildSnapshot` 全函数（`:508-550`）**无任何分段字段**，live `ctx://session` 亦无（§5）。且 **无任何单测断言它**——spec 要求与测试双缺口。
2. **`system_prompt` 卡条件性消失**：`ctx.ts:536` `system === undefined ? undefined : {...}`，`JSON.stringify` 丢弃 undefined ⇒ 无 `request/header` 的会话里该 key 整体不存在（live 实测确实缺失）。spec 说快照 SHALL carry the card；模型侧看到的是「字段不存在」而非「字段为空」。
3. **未知 key 不回显子路径**：spec「Unknown key echoes known keys」要求列出「currently known first-level keys **and the sub-path pointer**」。实测 `ctx://bogus` / `ctx://model` 只回 `unknown key (known: session — model/cwd folded into the session info card)`（`ctx.ts:250-253`），**无子路径清单**。（另一条兜底错误 `:556-558` 才列出全部子路径，但它只对 `session/<未知段>` 触发。）
4. **行窗在 bracket 元素路径上被忽略**：spec 说「line windows ... on **every** resolved resource」。实测 `ctx://session/user_prompts[0]:1-1` 与 `:2-2` 返回**同一个完整两项文本**；`agent_responses[0]:1-1` 同样。代码路径（`ctx.ts:452-462`、`:476-481`）在 bracket 命中后 `return bySeq.text` / `items[ordinal].text`，**不经 `applyFace`**。

### D6 披露 — ⚠️ 部分

成立部分：
- 单源：`general-section.ts:44-45` 模块期 `readFileSync` walk-up 加载包根 `url-schemes-section.md`；`package.json files` 含 `url-schemes-section.md`（漏列即 boot ENOENT，0.2.3-d 教训已内建）。
- 门控：`generalSection(gates)` 在 `urlSchemes: false` 返回 `undefined`（`general-section.ts:88`），单测断言绿。
- 工具 description 静默：四个 wrapper 的 `description:` 字符串（read.ts:89 / write.ts:149 / grep.ts:101 / glob.ts:99）**零 `scheme://`**——spec scenario「Tool descriptions stay scheme-silent」成立（`scheme://` 只出现在源码注释里）。
- L3：未知 label 回显有效清单（`ctx.ts:482-489` pickEpisode 列出 labels）；超尺 `:raw` 尾行 note（`:357-361`）单测覆盖。

**不符**：
1. **bare-root 即 help 对 `skill://` 是假的**。shipped section 第 3 行写着「Reading a bare root (`ctx://`, `agent://`, `dvc://`, `skill://`) lists that scheme's surface — treat it as the scheme's help.」实测：`ctx://`（9 行 roster）、`agent://`（"no agents"）、`dvc://`（4 设备表）确实枚举；**`skill://` → `Error: skill "" is unknown or no longer available`**（`skill.ts:141` `URL_SKILL_NOT_FOUND`，因为 `splitSkillPath('')` 得空名去查注册表）；`dsh://` 裸根亦报错 `unknown resource "(empty)" — expected "docs" or "config"`（`dsh://` 未在该句里点名，但同属「静态/系统资源」）。这是**上报给模型的事实性误导**，每次会话渲染，代价是白跑一次工具调用。
2. **≤600 chars 预算不成立**。tasks 4.1 与既有实测报告 §2 都写「≤600 chars（断言绿）」。实测 shipped 文件 = **1,788 字符 / 19 行**（`wc -c` 1768 字节）；`general-section.spec.ts` 只断言**覆盖度**（6 schemes + `:raw:N-M` + read-only + transcript/thinking/system），**没有任何预算断言**。该说法应更正。

### D7 Phase-2 fs backend — ⚠️ 未挂载（spike 姿态正确）

- `fs-backend.ts` 实现齐：`resolve` 拦 scheme → virtual target（`targetKey` = URL）、`stat` 合成 `{type:'file',size}`、`readText` 解引用、`writeText`/`editText` 抛 `FS_VIRTUAL_READONLY`、其余 `super`；`build()` 对 `@deepseek-ai/dsh-fs-sandbox` 动态 import 失败返回 `null`（fail-soft，`:120-127`）。
- **未挂载**：`createUrlAwareFileSystemBackend` 在 `src/` 内零引用（只在自身模块与 `fs-backend.spec.ts`），index.ts 不 import ⇒ 设计 D7 的挂载动作（home 层同 id 行重述 `fs-sandbox`）与收益（「未 wrap 的原生 read/edit 亦能读 `ctx://`」）**均未兑现**，与 tasks 5.2「未执行」一致。
- 三个 spec delta 里**没有 fs 相关 requirement** ⇒ 该 spike 不构成 spec 欠账，属设计内可整体放弃项。

### D8 验证与红线 — ✅ 纪律守住

- `openspec validate 2026-09-11-url-schemes-recallable-context --strict` → **`Change ... is valid`**。
- url-schemes 八个 spec 文件**全绿**：`http 35 / tools-delegation 29 / ctx 19 / skill 16 / fs-backend 5 / escalation-forward 5 / wiring 4 / general-section 2` = **115 用例**。
- 全量：`Test Files 2 failed | 37 passed (39)`，`Tests 14 failed | 473 passed (487)`。**14 挂全部同一根因**：`TypeError: SessionSeq is not a function`，落在 `test/url-schemes.spec.ts`（2，`agent://` roster）与 `test/surface-devices/agent-family.spec.ts`（12，`agent://` family roster/addressing）——**宿主 session API 漂移，与被验 change 的代码路径无交集**（ctx/compaction 全部通过）。
- `tsc --noEmit` = **13 错**（非 0），分布：`src/index.ts` ×3（`tool/ptc-dispatch*` 事件词表、`SubagentRuntime.sendMessage`）、`src/url-schemes/handlers/agent.ts:344`（`Session.snapshotEvents` 不存在）、`src/url-schemes/index.ts:282`（宿主 `SessionPersistence` 缺 `stat`/`open`，对 `agent.ts` 的 `SessionPersistenceSurface` 不匹配）、测试 ×8（`SessionSeq`/`isSeeded`/never 推断）。**全部为宿主 API 漂移族**，无一落在 `ctx.ts`/`read.ts`/`selector.ts`/`transforms.ts`/`fs-backend.ts`。注：ctx handler 用 `sessionPersistence: unknown` duck-typing，是它躲过第 3 类错误的直接原因——design D4 的「duck-typed 抗漂移」在这一点上自证有效。
- **未 publish**：AGENTS §〇 的 a–d 四闸未启动；tasks 6.3（user 确认后归档/发布）仍待 user。

## 5. 第一人称 live 探针矩阵（本会话 `read`，即被验 read chassis）

| # | URL | 观测 | 判定 |
|---|---|---|---|
| 1 | `ctx://` | 9 行 roster（session / transcript / compactions / compactions[label\|n] / user_prompts / tool_calls / agent_responses / thinking / system） | ✅ 与 spec 覆盖一致（tasks 3.2 的「7 行」失真） |
| 2 | `ctx://session` | 快照 JSON：`resource/syntax/session{7 字段}/storage/totals{9 键}/compacted[]/hints[3]`；**无 `segments`**；**无 `system_prompt`**（`compacted` 空因本会话 0 压缩） | ❌ F1/F7 现场复现 |
| 3 | `ctx://session/transcript:1-3` | 3 行 transcript（`[0000008] USER` + 正文） | ⚠️ 设计说已裁撤，实际可用（F4） |
| 4 | `ctx://session/user_prompts[0]:1-1` | 返回**两项完整文本**（非 1 行） | ❌ F3（行窗被忽略） |
| 5 | `ctx://session/user_prompts[0]:2-2` | 与 #4 **逐字节相同** | ❌ F3 确证 |
| 6 | `ctx://session/agent_responses[0]:1-1` | 返回完整两项文本 | ❌ F3 确证（同代码路径） |
| 7 | `ctx://bogus` | `Error: ctx://bogus: unknown key (known: session — model/cwd folded into the session info card)` | ⚠️ F5（无子路径清单） |
| 8 | `ctx://model` | 同上 `CTX_UNKNOWN_KEY` | ✅ 一级 key 确实移除 |
| 9 | `skill://` | `Error: skill "" is unknown or no longer available` | ❌ F6（section 承诺的 bare-help 不存在） |
| 10 | `dsh://` | `Error: dsh://: unknown resource "(empty)" — expected "docs" or "config"` | ⚠️ 同类（句内未点名） |
| 11 | `agent://` | `no agents` | ✅ 枚举成立 |
| 12 | `dvc://` | 4 设备表（`ast_edit/ast_grep/browser/lsp`） | ✅ 与 section 的 devices 列一致 |

> 未能在 live 覆盖的两点，如实声明：`/original` 与 `compactions[label]` 需有效压缩档，本会话 `compactions: 0`，故 `CTX_BAD_PATH`（/original 裁撤）只由单测 `ctx.spec` 第 8 例证明；config gates 的四个分支需改 patch 行并重启实例，本轮未做（见 F10）。

## 6. 发现清单（按处置优先级）

| # | 级别 | 发现 | 证据 | 建议处置 |
|---|---|---|---|---|
| F1 | **高** | 快照缺 `segments`（per-compaction 分段 + live 热区）——ctx spec 明文要求、design D5 明文要求、无实现、无测试 | `ctx.ts:508-550` 无该字段；live #2 | 二选一：补实现（首选，spec 是契约）或在本轮明确降级并改 spec；**不可两边都不动** |
| F2 | **高** | read「有序 transform 链」未接线，`transforms.ts` 为死代码；`SCHEME_URL_RE` 双份与「kept in ONE place」注释矛盾；tasks 2.3（hashline 独立化）未交付 | `createUrlTransform/createAnchorTransform` 全仓零调用；`read.ts:73` vs `transforms.ts:50`；tasks 2.3 未勾 | 要么落地 extract（read.ts 走 chassis），要么把 spec 的 ADDED「ordered transform chain」降级为「单一注册 + 终端 delegate」并改注释；死代码不应留在发布面 |
| F3 | 中 | bracket 元素路径忽略 `:N-M` 行窗 | live #4/#5/#6；`ctx.ts:452-462`/`:476-481` 不过 `applyFace` | spec 的「every resolved resource」是硬话；补 `applyFace` 一行即可，或收窄 spec 措辞 |
| F4 | 中 | design.md D2 与实现/ctx spec 冲突（`/transcript` 保留为 canonical 别名） | `ctx.ts:334`；live #3；ctx spec「Bare listing」 | 改 design.md（存档件纠偏），不要改实现 |
| F5 | 中 | `CTX_UNKNOWN_KEY` 不回显子路径清单 | `ctx.ts:250-253`；live #7 | 把 `:556` 那份子路径清单并入 unknown-key 消息 |
| F6 | 中 | section 的 bare-root-as-help 对 `skill://`（及 `dsh://`）失实 | live #9/#10；`skill.ts:141` | 改 `url-schemes-section.md` 一句（点名真正支持枚举的 ctx/agent/dvc），或给 skill/dsh 补 bare 枚举 |
| F7 | 低 | `system_prompt` 卡在无 `request/header` 时整键消失 | `ctx.ts:536`；live #2 | 输出 `{chars:0, preview:''}` 之类的显式空卡，或 spec 注明条件性 |
| F8 | 低 | 「≤600 chars」说法不成立（实际 1,788 字符 / 19 行，无预算断言） | `wc -m url-schemes-section.md` = 1788；`general-section.spec.ts` 无预算断言 | 更正 tasks 4.1 与实测报告 §2；如确实要控体积，补一条真实的预算断言 |
| F9 | 低 | 证据链数字漂移：ctx.spec「15/15」实为 **19/19**；§3.2.1「general-section 6/6」实为 **2/2**；tasks 3.2「roster 7 行」实为 **9 行**；tasks 3.3/3.4/6.2b 仍把 `[label]/original` 当可用面（已被 §3.2.1 的 reshape 裁撤） | 本轮 vitest 逐文件计数；live #1 | 更正 tasks.md 与实测报告，避免后续 session 按错数字验收 |
| F10 | 低 | config gates **无工具层测试**：`urlSchemes:false`/`hashline:false` 四个分支零断言，`resolveGates` 零单测（仅 `general-section` 与 `fs-backend` 各 1 处 gate 断言） | `grep -rn 'urlSchemes: *false\|hashline: *false' test/` 仅 3 命中 | tasks 1.2 承诺的「4-gate 组合注册断言」补齐；行为本身按源码静态读到是对的 |
| F11 | 记录 | fs backend spike 未挂载、收益未兑现（spec 无对应 requirement，属可放弃项） | `createUrlAwareFileSystemBackend` src 内零引用；design D7 | 保持 spike 姿态；若本轮放弃，在 design/报告注明「不挂载」结论 |
| F12 | 记录 | 源码注释漂移：`selector.ts:6` 与 `resolver.ts:6` 写「All five schemes / 五个 handler」而注册了六个（含 http(s)）；`index.ts:19-22` 仍写「`read` keeps its vendored hashline file branch and **captures nothing**」（capture-read 已落地） | 文件头即证 | 顺手更正，避免下一轮再被旧注释误导 |

## 7. 结论

1. **design.md 的机制主干成立**：D1 文法、D3 label/嵌套链、D2 的 canonical/prepared 模型、D6 的单源+门控、D8 的验证纪律，均在实际代码与活体行为上找到对应，无一处是空头设计。
2. **但 design.md 已被 reshape 甩开**：`/transcript` 的存废、`thinking`/`system` 两面、`/original` 的重塑，设计文本停在回改之前（既有实测报告 §3.2.1 记录了 user 的 reshape 批示）。**设计文件需要一次对齐修订**，否则它作为「研究底稿 → 决策」的索引会持续误导后续 session（F4/F9）。
3. **两项实质欠账必须处置**：F1（快照 `segments`，spec 明文）与 F2（read transform 链，spec ADDED 明文）。两者都不是文档问题，是**契约与实现的差**；要么补实现，要么改 spec——按 AGENTS §〇 的验收同类原则，**不能靠「单测绿」把 spec 要求悄悄抹掉**（F1 恰恰是「spec 有、测试无」才活到今天的）。
4. **发布红线未触碰**：本轮无 `npm publish`、无 prod 改动、无 tag。tasks 6.3（user 确认 → 归档 → 发布）仍原样待 user 裁决。

**附带产物**（可复核）：
- `.scratch/verify-url-schemes-vitest.log` — 全量单测原始输出（含 14 例失败的完整堆栈）
- `.scratch/verify-url-schemes-tsc.log` — tsc 13 错原始输出

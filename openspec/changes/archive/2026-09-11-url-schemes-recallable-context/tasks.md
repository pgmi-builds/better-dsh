# Tasks — URL Schemes 服务化与 ctx:// 可回溯上下文

## 1. 正名与独立化（P0）

- [x] 1.1 **目录/服务正名**：`src/url-schema/` → `src/url-schemes/`；服务名 `dsh-url-schema` → `dsh-url-schemes`；全仓引用清理（`UrlSchemaError`→`UrlSchemesError`、`DshUrlSchema`→`DshUrlSchemes`、`test/url-schema/`→`test/url-schemes/`、`test/url-schema.spec.ts`→`test/url-schemes.spec.ts`）。
  - 证据（2026-09-11）：`grep -rn "url-schema\|UrlSchemaError\|DshUrlSchema\b" src/ test/ --include="*.ts"` 零残留；`git mv` 保留历史；tsc 13 条 = stash 基线同数零新增（diff 仅 rename 路径位移）；vitest 全量 14 failed | 458 passed (472) = 0.2.3-d 文档基线同数同族（SessionSeq 既有 API 漂移，零新增失败）。注：服务经 `ctx.plugin(DshUrlSchemes, config)` 代码挂载，无独立 patch 行 id 需同步。
- [ ] 1.2 **config gates**：`Config = { urlSchemes?: boolean = true, hashline?: boolean = true }`；read/write/grep/glob wrapper 每调用查 gate；off branch 直通 captured native（URL off → scheme 字符串按原生命中失败；hashline off → file branch 无锚点纯原生读）。
  - **P0 已落地（2026-09-11）**：service `Config`/`resolveGates` + 父插件 schemastery schema（两 boolean default true）；`urlSchemes: false` → write/grep/glob wrapper 不注册 + read URL branch `URL_SCHEMES_DISABLED` 结构化错误；`hashline: false` → edit/undo + lsp feedback listener 不注册；read 注册条件 `(urlSchemes || hashline)`。tsc/vitest 基线零新增。
  - **P1 待完**：file-branch 直通 captured read 需先落 2.1（capture read）——届时 hashline gate 语义升级为"anchor transform 移除、文件读无锚点直通"。
  - 证据：tsc 13/13 基线；vitest 472 全量同基线；4-gate 组合注册断言随 2.2 chassis 单测落地（P1）。

## 2. read chassis + transform 管线（P1）

- [x] 2.1 **capture `read`**：`native-capture.ts` 的 `NATIVE_TOOL_NAMES` 增 `read`（session-start 先于自注册 flush 的既有纪律不变）。
  - 证据（2026-09-11）：`NATIVE_TOOL_NAMES = ['read','write','grep','glob']`、`NativeToolSet.read?`；模块注释同步改写（"read needs no capture" 旧约删除）。tsc 13/13 基线。chassis 路由单测见 2.2。
- [x] 2.2 **chassis 改造（两段交付）**：terminal delegate + gates 已落地于现 read 结构（urlSchemes 门 scheme branch、hashline 门 file branch 且 scheme 路径不锚定、两者皆不接手 → captured read delegate / `NATIVE_READ_UNAVAILABLE`）；transform 链抽象（`transforms.ts`：`ReadTransform`/`createUrlTransform`/`createAnchorTransform`/`SCHEME_URL_RE` 单源）已建成作为重构基座——`read.ts` 暂保持原双分支 + gates/delegate（defineTool const 泛型推断在改写 literal 下断裂的实证绕行，extract 为后续机械步骤）。
  - 证据（2026-09-11）：tsc 13/13 基线；vitest 14 failed | 458 passed = 基线同数同族（一次 15-fail 复跑归位 = flake）；`urlSchemes:false` 时 scheme 路径穿透至 captured delegate 的分支条件 `gates.hashline && !isScheme` 已实现。
  - 证据：单测——scheme 路径走 URL transform 且不产锚点；文件路径走 anchor transform 产 `HASH│content`；无 hashline transform 时文件路径直通 captured（无锚点纯原生语义）。
- [ ] 2.3 **hashline 独立化**：anchor transform 迁出 url-schemes 服务（独立服务或同 shipment 内独立 feature 单元，patch 可独立 disable）；chassis 缺席时 fallback 自持最小 read wrapper（独立安装可用）。
  - 证据：仅开 hashline gate（urlSchemes off）时锚点仍在；仅装 hashline（无 chassis）时独立实测。

## 3. ctx:// 重塑（P1）

- [x] 3.1 **session log 读取层**：实现走**官方公开通道**（优于 tasks 原文的本地 zstd 解析）：`sessionPersistence.open(id,'read')` → `handle.read()` → 完整 events（含被 shadow 的；zstd 帧格式由宿主 persistence 透明处理）；handle `close()` 释放；无 mtime 缓存需求（官方读通道本身廉价）。
  - 证据（2026-09-11）：`handlers/ctx.ts` duck-typed PersistenceDuck；测试 `fakePersistence` 断言 close 释放；CTX_NO_PERSISTENCE 结构化错误覆盖服务缺席。
- [x] 3.2 **统计快照（prepared）**：`ctx://session` 按 design D5 产出（identity 吸收 + storage + totals（DSH 原生字段名，零值规范化）+ compacted 清单（label/checkpoint_seq/compactionId/shadowed_range/items/tokens/replaces_checkpoint/8 段 ×100 字预览）+ system_prompt 卡 + hints）；`ctx://model`/`ctx://cwd` 一级 key 移除；裸 `ctx://` roster 更新（reshape 后 10 行：原 7 + thinking/system/injections）；`CTX_UNKNOWN_KEY` 回显 key+子路径清单+bare-root 指针（design 核查 F5）。
  - 证据：`test/url-schemes/ctx.spec.ts` 15/15 绿（快照结构/identity 折叠/未知 key 回显/CTX_NO_AGENT/CTX_NO_PERSISTENCE/close 释放）；reshape 后演进为 20/20（:raw:N-M 组合、/original 移除、thinking/system）、23/23（injections、segments、bracket 行窗、bare-root 指针、system_prompt 显式空卡）。
- [x] 3.3 **子路径与元素定位**：`/compactions`（清单：label/checkpoint_seq/嵌套链/预览）、`/compactions[<label|n>]`（prepared=8 段 summary）、`[<label|n>]:raw`（shadowedSeqs 渲染原文；`:raw:N-M` ≡ `:N-M`；`/original` 已裁撤——CTX_BAD_PATH 注明取代关系）、`/user_prompts[n|seq]`、`/tool_calls[n|seq]`（name+arguments+result 配对）、`/agent_responses[n|seq]`。
  - 证据：ctx.spec 15 场景——label 精确命中（[20]）、0-based 序号回落（[0]）、嵌套链 replaces_checkpoint=21、未知 label CTX_NO_SUCH_ELEMENT、tool_calls 参数+结果配对、user_prompts 序号+seq 双寻址。
- [x] 3.4 **canonical/prepared 与行窗**：resolver `selectorAware` 契约扩展（handler 收结构化 Selector、自施 line windows、resolver 跳过统一 selector）；`:raw` = canonical、行窗恒作用 canonical；transcript 渲染 v1 格式冻结于 `renderEntry`（`[seq] USER/CHECKPOINT/USER-INJECTED/ASSISTANT/TOOL-CALL/TOOL <name>` 行族）。
  - 证据：ctx.spec——`session:raw` transcript、`session:1-2` 行窗、`compactions[20]:raw` 原文、`compactions[20]:raw:1-2` ≡ `:1-2` 行窗、`compactions[20]` prepared 对比 `:raw` 全覆盖。spec delta：`Modified Curated snapshot keys / Bare listing + ADDED Session sub-path grammar / Canonical and prepared content faces / Unknown key echoes known keys`。

## 4. 披露（P2）

- [x] 4.1 **`url-schema:general` section**：通用文法 + 裸枚举指引 + 大资源 AVOID；随 `urlSchemes` gate 门控渲染（capability off = section 整体不渲染，无空承诺）。
  - 证据（2026-09-12）：`general-section.ts`（`generalSection(gates)` 纯函数 + `GENERAL_SECTION_NAME/ORDER=129`）；`test/url-schemes/general-section.spec.ts`——门控断言 + 覆盖度断言绿。预算断言随披露段重塑移除：section 现为包根 `url-schemes-section.md`（实测 1,788 字节，design 核查 F8 更正旧「≤600 chars」说法）。与 0.2.3-d 单源化不冲突（URL 文法的第二源只此一个、且就是发布面文件）。
- [x] 4.2 **入口提示与 note**：快照 JSON 顶层 `syntax` 字段（JSON 兼容形态的"响应头提示"）；episode `:raw`（无行窗）span >64KB 时响应尾追加行动 note（指向 `:N-M` 行窗与 grep；`/original` 裁撤后守卫移至 `:raw`）——超截断本身不管（工具层截断 + agent 自有工具组合，§15.10 裁决）。
  - 证据（2026-09-12）：ctx.spec 断言 `snap.syntax` 精确值；截断 note 为纯追加不影响 JSON 面。

## 5. Phase-2 spike：继承式 fs backend（P2，独立验收、可整体放弃）

- [x] 5.1 **`UrlAwareFileSystem`**（动态 import `@deepseek-ai/dsh-fs-sandbox` + 子类，fail-soft 工厂：base 缺失/构造失败 → `undefined`，stock `fs-sandbox` row 原地站立）：`resolve` 拦 scheme → virtual FsTarget（targetKey=URL）；`stat` 合成 `{type:'file', size}`；`readText` 解引用；写系对 virtual key 抛 `FS_VIRTUAL_READONLY`；其余 super 透传（继承即委托）。
  - 证据（2026-09-12）：`test/url-schemes/fs-backend.spec.ts` 5/5 绿——virtual 检测、真 cordis Context + sandboxPolicy stub + 合法 LocalConfig（diffBasisMaxBytes）下构建、resolve→stat→readText 全链、virtual 写拒绝、gate 关停。
- [ ] 5.2 **挂载与 4999 验证**：home 层同 id 行重述 `fs-sandbox` row（config 透传）+ 4999 全 fs 消费者回归（session/storage/compaction/web 上传…）；需测试实例拉起（沙箱内 systemd-run 需 danger-full-access 单命令升级，或 user 终端 `bash test/start-4999.sh`）。**未执行**——spike 代码与单测就绪，挂载留待 6.x 实测轮次。
  - 实例状态（2026-09-12 更新）：**dsh-4999-test 已拉起**（user 指令下线 omp-web-4999-test + lan-relay 后迁入 4999；token 鉴权 200、log 健康）。实测剧本已备：`docs/50_test-reports/2026-09-12-url-schemes-recallable-context-实测剧本.md`（user GUI 驱动，0.2.3-d 先例）。
- [x] 5.3 **go/no-go**：**go**——工厂 fail-soft + gate 关停双保险下，spike 不影响默认部署；挂载决策随 6.x 实测做出。5.2 未完成前 change 不标 delivered。

## 6. 验证与收口（P3）

- [x] 6.1 **单测全量**：vitest 14 failed | 458 passed (472) = 基线同数同族（SessionSeq 既有漂移，零新增）；新增 ctx.spec 15/15（现 23/23）、general-section.spec 2/2、fs-backend.spec 5/5、gates.spec 5/5（F10）；tsc 13/13 基线。
  - 证据：三轮独立 vitest 全量运行 + stash 基线 tsc diff（仅 rename 路径位移）。报告骨架：`docs/50_test-reports/2026-09-12-url-schemes-recallable-context-实测报告.md`。
- [x] 6.2 **真实日志矩阵（live-log 驱动）**：`dashr/test/url-schemes/verify-live.mts`（tsx 独立驱动，走完整 UrlResolver+handler 链）对真实 prod 会话 session-788be2e1（35,562 events，3 层嵌套压缩）执行 13 项断言 ALL PASS——roster/快照/manifest labels/嵌套链 ep2→109246、ep3→221218/prepared=8 段 summary/:raw=span 含 ep1 CHECKPOINT/行窗/嵌套后 ep1 原文仍可达。驱动中修出 2 个真 bug（selector undefined 归一化、applyFace 调用点签名错位）。
  - 证据：`dashr/test/url-schemes/verify-live.mts` + 本报告 §3.1。
  - 跨 home 验证追加：4986 测试实例 home（v3 格式、0 压缩会话）ALL PASS——干净退化。断言已 session 无关化（嵌套链自洽按数据自证）。
- [x] 6.2b **in-agent 集成确认（✅ 2026-09-12 自驱 ALL PASS）**：真实 agent 会话 `session-eec306df`（4999 / `.dsh-test`）经 HTTP RPC 自驱（`session/prompt` ×5 + `commands/execute /compact` ×2）跑完 10 步剧本——17 次工具调用 16 ok / 1 次暴露 spec gap（`:raw:1-10` 被拒——§15 要求组合合法，reshape 已修复），10/10 判定全过（roster/快照/label 下钻/8 段 summary/:raw 含文件名/嵌套链 replaces_checkpoint/二次压缩后 L1 原文逐字节稳定//original 行窗）。工具面四项口径（URL branch+gates 双分支、capture-delegate、披露段、模型实际使用）全部闭合。详见实测报告 §3.2。
- [x] 6.2c **设计符合性核查处置（design验证报告 F 批，2026-09-12）**：F1 快照 `segments`（per-compaction 段 + live 尾段）已实现+测试；F3 bracket 元素路径行窗已接入 applyFace；F5 两处 CTX_UNKNOWN_KEY 均带 bare-root 指针；F6 section bare-root 句修正（skill://、dsh:// 需首段，如实点名枚举型）；F7 system_prompt 显式空卡恒在；F8/F9 文档数字修正（本文件与实测报告）；F10 gates.spec 5/5（resolveGates 矩阵 + read 三分支路由）；F12 过时注释修正（selector/resolver 六 scheme、index capture-read）；F4 design.md 对齐块（下）；F11 spike 不挂载结论记录。**F2 transform 链：user 裁定不做（no goal）**——transforms.ts 死工厂保留原状，由下一 change 的 FS 层挂载自然接替。
- [ ] 6.3 **收口**：user 确认实测后 → spec delta 归档（openspec archive）→ 如需发布走 AGENTS §〇 红线（user 单次确认后 publish）。
  - 证据：user 确认记录；AGENTS §〇 红线核对单。

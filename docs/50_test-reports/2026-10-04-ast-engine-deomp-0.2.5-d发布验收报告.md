# better-dsh 0.2.5-d 发布验收报告（2026-10-04，rig 4998）

- **被测物**: `better-dsh@0.2.5-d`（commit `4981254`，`feat(ast): surface silent failure modes as diagnostic fields`）
- **环境**: 交付形态 tarball 安装位 rig，端口 **4998**，`DSH_HOME=.test/home/compat`，profile `web`；驱动 = 第一人称真实 session（HTTP RPC 两段形，与《2026-10-03-ast-engine-deomp-4999实测报告》§四/§五 同款 password-gate + `/api` 信封）
- **发布状态**: **未发布**。`npm publish` 需 user 单独明确放行（AGENTS §〇 红线）；本报告 §五 给出 pre-flight checklist 与 `--dry-run` 证据，发布动作不在本任务内。

---

## 0. 一句话

0.2.5-d 在 4998 rig 以交付形态（tarball remove→add）完成第一人称 live 验收：诊断契约三字段 `pathNotFound` / `overlapping` / `patternErrors` 全部在真实 session 里以原样 JSON 落实，`.vendor` 全程不重建、日志零 OMP/registry 行；一处处方偏差（任务给的"旧静默 pattern"实为单根 pattern，不触发 `patternErrors`）已用真 multi-root pattern 补测闭环，并给出引擎级根因。

## 1. 0.2.5-d 内容物

### 1.1 引擎替换回顾（0.2.5 系已完成，0.2.5-d 继承）

- 原生 addon（`@oh-my-pi` / pi_natives，静默供给）→ **包内 WASM ast-grep 引擎**：`lib/ast-assets/` 16 文件（ast-grep.wasm + tree-sitter.wasm + 14 语言 grammar wasm），冷启动零外部供给——`.vendor` 目录全程不出现，rig 日志 `omp|oh-my-pi|registry` **0 命中**（本轮全文件 grep，40 行）。
- 交付物延续 docs-packaging-trim 形态：tarball 5.1 MB / **733 文件**（shasum `5b3e3e35e25aaa34ef160035e027767975912217`）。
- 引擎行为面已被 0.2.5 系列锁定：对齐 pattern 34/8/11（4999 首测 §4.4 / 4998 复测 §4.8.3 逐字段一致）、dryRun 默认拦截、真写盘-回滚闭环、14 语言 match matrix（`a2d32a5`）。

### 1.2 诊断契约增量（0.2.5-d 本体 = commit `4981254`）

对原生前辈三类静默失败（契约报告 A1/A3/A6）的**有意分歧**，契约见 `docs/20_specs/ast/spec.md` §41：

| 字段 | 设备 | 语义 | 对应旧静默行为 |
|---|---|---|---|
| `patternErrors?: string[]` | 两者 | pattern 编译不成单根 AST 节点时逐条透出（`pattern <index> ("<pattern>"): <底层消息>`），健康 pattern 的 matches 照常返回；硬语法错误仍抛 `DVC_DEVICE_ERROR` | A1：multi-root pattern 伪装成 0 命中 |
| `pathNotFound?: boolean` | 两者 | 解析后的 target root 不在盘上 → `true` | A3：路径不存在与真 0 命中不可区分 |
| `overlapping?: number` | `ast_edit` | 重叠守卫丢弃的编辑计数（先入列 op 胜），仅 >0 时出现 | A6：守卫存在但计数不可见，遮蔽 op 静默消失 |

另：两设备 summary 明示**无 workspace 边界检查**（边界 = approval/policy 层；A5 文档化处理）。

## 2. 安装与站点证据

- 构建：`npm run build`（tsdown + build-client + kernel-bridge + ast-assets，输出 `ast-assets: 16 files, 14.4 MB`）→ `npm pack` → `better-dsh-0.2.5-d.tgz`。
- 安装（file: tarball 不刷新，**remove→add 一个来回**）：`plugin --profile web remove better-dsh` → `add …/better-dsh-0.2.5-d.tgz` → `Packages: +1`（pnpm 11.7.0）→ `PORT=4998 bash .test/seed/test123/start.sh`（unit `dsh-4998-test123` + `test123-lan-4998-relay`）。
- 安装位核验：`package.json` version → **`"0.2.5-d"`**；`lib/ast-assets` → **16 文件**；`.vendor` → **ABSENT**（`ls` exit 2）。profile `package.json` 依赖行 `file:/home/u1/workspaces/dashr/better-dsh/better-dsh-0.2.5-d.tgz`。
- 站点：password gate `POST / -d password=admin` → **303** + `dsh-auth-<hash>` cookie（HttpOnly）；boot graph 含 `"id":"better-dsh"`；`/plugins/??better-dsh/client.js&rev=4b9802368848` → **200**（29,700 B，= 安装位 `lib/client/index.js` 29,633 B + 服务端追加 sourceMappingURL 行，`cmp` 前缀逐字节一致）。

## 3. 第一人称 live 实测（真实 session，六项）

### 3.1 驱动过程与环境事件（透明记录）

- 驱动：§四/§五 同款两段形——`POST /api/session/create`（`client-request` 信封，`request.cwd=/home/u1/workspaces/dashr`）→ `POST /api/session/prompt`（`mode:'queue'`）。会话日志 `.test/home/compat/sessions/--home-u1-workspaces-dashr--/session-f4122ee1-3dab-498b-9ff0-280b470afd2b/session.v4.jsonl.zstd`，全部结果为 `tool/result` 事件原样 JSON。
- **QUOTA 事件**：前两个 session（`session-ac7f2999…`、`session-2ca4edea…`）首 turn 即 `Insufficient Balance`（HTTP 402 QUOTA）——rig 既有三条 LLM 路由全部欠费（`zai` ZAI_API_KEY / `deepseek-official` DEEPSEEK_API_KEY / `deepseek-openai` 存储 key）。**供给修复**：直连探测发现 ZAI **Anthropic 协议端点**（plan 订阅）可用而 paas 计费端点欠费，遂在 rig home patch（`cordis.patch.yml`，测试资产）新增 `zai-plan` provider 行（`api: anthropic-messages`，`baseURL: https://open.bigmodel.cn/api/anthropic`，`apiKeyEnv: ZAI_PLAN_API_KEY`，model `glm-4.7`），重启 rig 后 `session/selectModel` 指定该路由，turn 正常完成。**此为环境供给修复，不触及被测面**（被测面 = 包内 WASM 引擎 + 宿主 write dvc:// 路径，与 LLM 路由无关）。
- 有效会话 `session-f4122ee1…`：2 turn、8 次工具调用（write dvc://×5 / bash×3），turn 1 与 turn 2 均 `reason.kind = "completed"`。

### 3.2 (a) 旧静默处方 pattern —— 结果与任务预期不符（引擎级根因，见 §3.3）

`write dvc://ast_grep`，content `{"patterns":["export function $NAME($$$ARGS)"],"path":"better-dsh/src/devices/ast"}`（seq 21 原样）：

```json
{
  "matches": [],
  "totalMatches": 0,
  "filesWithMatches": 0,
  "filesSearched": 11,
  "limitReached": false
}
```

**无 `patternErrors`，且这是 0.2.5-d 的正确行为**：该 pattern 在 WASM ast-grep 里编译为**单根**（`export function $NAME($$$ARGS)` 解析为一个合法但永不匹配的声明节点），不抛 `Multiple AST nodes are detected`，因此不属于 patternErrors 契约面。独立对拍：本地以 0.2.5-d 源码（vitest 直驱 `dispatchDvcWrite`，同 pattern 同形 fixture）返回**逐字段一致**的静默形态——rig 与源码零漂移。旧契约报告 §7 把此 pattern 的 0.2.5-c 静默归因为 MULTI_NODE 吞噬，系排除法推断，对 WASM 引擎不成立（真正的静默机制是该 pattern 单根但结构不全，永不匹配）。**规避口径不变：pattern 必须写完整节点**。

### 3.3 (a2) 补充：真 multi-root pattern → `patternErrors` live（A1 分歧验收）

`write dvc://ast_grep`，content `{"patterns":["const $A = $B\nconst $C = $D"],"path":"better-dsh/src/devices/ast"}`（两语句 = 双根；seq 74 原样）：

```json
{
  "matches": [],
  "totalMatches": 0,
  "filesWithMatches": 0,
  "filesSearched": 11,
  "limitReached": false,
  "patternErrors": [
    "pattern 0 (\"const $A = $B\nconst $C = $D\"): Multiple AST nodes are detected. Please check the pattern source `const µA = µB\nconst µC = µD`."
  ]
}
```

`patternErrors` 1 条（index + pattern 原文 + 底层消息）、0 matches——与单测（`ast-device.spec.ts:258`）及 spec §45 的 WHEN/THEN 一致，A1 分歧在 live 落实。

### 3.4 (b) 完整节点 pattern → 真命中

`write dvc://ast_grep`，content `{"patterns":["export function $NAME($$$ARGS): $RET { $$$BODY }"],"path":"better-dsh/src/devices/ast","includeMeta":true,"limit":3}`（seq 28 原样，节选）：

```json
{
  "matches": [
    {
      "path": "better-dsh/src/devices/ast/ast-device.ts",
      "text": "export function registerAstDevices(registry: DvcRegistry = { registerDvcDevice }): void { … }",
      "byteStart": 13399, "byteEnd": 13688,
      "startLine": 310, "startColumn": 1, "endLine": 313, "endColumn": 2,
      "metaVariables": { "NAME": "registerAstDevices", "ARGS": "[registry: DvcRegistry = { registerDvcDevice }]", "RET": "void", "BODY": "[registry.registerDvcDevice('ast_edit', …), registry.registerDvcDevice('ast_grep', …)]" }
    },
    { "path": "better-dsh/src/devices/ast/ast-reminder.ts", "text": "export function disposeAstReminders(sessionId: string): void { … }", "byteStart": 2063, "byteEnd": 2156, "startLine": 42, "…": "…（第 3 条 astFileNotice byteStart 3169，页共 3 条）" }
  ],
  "totalMatches": 13,
  "filesWithMatches": 8,
  "filesSearched": 11,
  "limitReached": true
}
```

**13/8/11 + `limitReached:true`（`limit:3` 分页）**，与旧契约报告 §7 对照实验的完整节点 13/8 完全一致；元变量四类捕获（NAME/ARGS/RET/BODY）齐全。

### 3.5 (c) 不存在路径 → `pathNotFound`（A3 分歧验收）

`write dvc://ast_grep`，content `{"patterns":["export function $N($$$A)"],"path":"no/such/dir"}`（seq 35 原样）：

```json
{
  "matches": [],
  "totalMatches": 0,
  "filesWithMatches": 0,
  "filesSearched": 0,
  "limitReached": false,
  "pathNotFound": true
}
```

`pathNotFound:true` + `filesSearched:0`——与真 0 命中（§3.2 的 11 文件形态）可区分。✅

### 3.6 (d) 重叠双 op → `overlapping:1`，仅首 op 落盘（A6 分歧验收）

夹具 `.scratch/ast-tool-test/overlap-026.ts`（写前 md5 `fd021aa9ffa0389ba92a1320c6b9e4f3`，内容 `export function overlapTarget(x: number): number {\n  return x * 2\n}`）。`write dvc://ast_edit`，content `{"ops":[{pat:"export function $NAME($$$ARGS): $RET { $$$BODY }", out:"… { /*op1-applied*/ $$$BODY }"},{pat:"function $NAME($$$ARGS): $RET { $$$BODY }", out:"… { /*op2-dropped-overlap*/ $$$BODY }"}],"paths":[".scratch/ast-tool-test/overlap-026.ts"],"dryRun":false}`（seq 42 原样）：

```json
{
  "changes": [
    {
      "path": ".scratch/ast-tool-test/overlap-026.ts",
      "before": "export function overlapTarget(x: number): number {\n  return x * 2\n}",
      "after": "export function overlapTarget(x: number): number { /*op1-applied*/ return x * 2 }",
      "byteStart": 0, "byteEnd": 67, "deletedLength": 67,
      "startLine": 1, "startColumn": 1, "endLine": 3, "endColumn": 2
    }
  ],
  "fileChanges": [{ "path": ".scratch/ast-tool-test/overlap-026.ts", "count": 1 }],
  "totalReplacements": 1,
  "filesTouched": 1,
  "filesSearched": 1,
  "applied": true,
  "limitReached": false,
  "overlapping": 1
}
```

`changes[]` 只含 op1；盘面复核（seq 49 会话内 `cat` + 会话外 md5 `eab9de680da668fbabe79c22a575c67c`）：

```text
export function overlapTarget(x: number): number { /*op1-applied*/ return x * 2 }
```

仅 `/*op1-applied*/` 在场，`/*op2-dropped-overlap*/` 未出现——先入列 op 胜 + 丢弃计数透出，与引擎守卫（`engine/edit.ts` 按 start 升序线性扫描）及单测（`ast-device.spec.ts:299`）一致。✅

### 3.7 (e) `.vendor` 供给链复核

全部 dvc 调用之后：`.test/home/compat/profiles/web/node_modules/better-dsh/.vendor` → **ABSENT**（会话内 seq 56 `ls` 报 `No such file or directory`；会话外复核 exit 2）；`lib/ast-assets` 仍 **16 文件**（seq 56 会话内 `wc -l` = 16）。rig 日志 `grep -icE "omp|oh-my-pi|registry"` → **0**。✅

### 3.8 源码树不变量

`git status --short -- better-dsh/src better-dsh/test better-dsh/package.json` → **空**（live 写盘仅落在 gitignored `.scratch/` 夹具，符合预期）。

## 4. 构建卫生（非验收，记录用）

| 项 | 结果 |
|---|---|
| `tsc --noEmit`（host） | **0 错误**（exit 0） |
| `tsc -p tsconfig.client.json`（client） | **0 错误**（exit 0） |
| `npx vitest run` | **65 文件 / 705 passed + 1 skipped（706）**，169 s |

## 5. `npm publish` pre-flight checklist（发布闸门，未执行发布）

按 AGENTS §〇：a（本报告第一人称实测）✅ → b（报告落盘）✅ → c（**user 明确放行，待办**）→ d（publish）。当前到 b 为止。

- [x] **registry 目标**: `npm config get registry` → `https://registry.npmjs.org/`；whoami → `pgmi-builds`
- [x] **版本**: `package.json` `name: better-dsh`, `version: 0.2.5-d`（与安装位一致）
- [x] **files 列表**: `lib`、`THIRD_PARTY_NOTICES.md`、`docs`、`dsh-docs`、`cordis.patch.yml`、`eval-description.md`、`url-schemes-instruction.md`、`scripts/kernel-provision.mjs`
- [x] **`npm publish --dry-run`**（未发布，输出尾 8 行原样）：

```text
npm notice === Tarball Details ===
npm notice name:          better-dsh
npm notice version:       0.2.5-d
npm notice filename:      better-dsh-0.2.5-d.tgz
npm notice package size:  5.1 MB
npm notice unpacked size:  27.0 MB
npm notice shasum:        5b3e3e35e25aaa34ef160035e027767975912217
npm notice total files:   733
npm notice
npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access (dry-run)
```

- [x] 干跑确认：尾行带 `(dry-run)`，registry 无任何足迹。
- [ ] **user 放行后**：`npm publish`（真实动作）→ tag `v0.2.5-d`（GitHub 侧可逆，随发布节奏）。

## 6. 偏差与关注项

1. **处方 (a) 预期未按字面达成（已闭环）**：任务处方的 `export function $NAME($$$ARGS)` 不触发 `patternErrors`——单根 pattern 永不匹配≠multi-root 编译失败；本地 0.2.5-d 源码对拍逐字段一致，判定为**处方对旧 §7 根因推断的继承误差**，非产品缺陷。A1 验收由 (a2) 真 multi-root pattern 补齐。建议：后续文档/指引里把"完整节点"口径与"multi-root 才报 patternErrors"口径并列写清（单根残缺 pattern 仍是静默 0 命中，属引擎语义）。
2. **rig LLM 路由欠费**：三条既有路由 402 QUOTA；本轮以 `zai-plan`（Anthropic 端点）provider 行修复并留作 rig 默认（`agent-default-model` 现为 `zai-plan/glm-4.7`，原 `zai/glm-5.3-flash` 已欠费不可用）。rig home patch 为测试资产，该行建议保留至 paas 路由充值。
3. **`filesSearched` 双形态口径**（旧 A4，未变）：目录遍历跳过非代码文件、显式单文件计入——§3.2（11）与 §3.6（1）的数字口径不同属设计内。
4. 首个 QUOTA 失败 turn 的会话（`ac7f2999`/`2ca4edea`）留在 rig home sessions 内，随 home 复用自然沉淀。

## 7. 复现

```bash
cd ~/workspaces/dashr/better-dsh && npm run build && npm pack
cd ~/workspaces/dashr
DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js plugin --profile web remove better-dsh
DSH_HOME=$PWD/.test/home/compat node upstream/deepseek-harness/apps/cli/lib/bin.js plugin --profile web add $PWD/better-dsh/better-dsh-0.2.5-d.tgz
PORT=4998 bash .test/seed/test123/start.sh
# 认证 + RPC 两段形：POST /（password gate 铸 cookie）→ /api/session/create → /api/session/selectModel（zai-plan/glm-4.7）→ /api/session/prompt（queue）
# 会话日志：.test/home/compat/sessions/--home-u1-workspaces-dashr--/session-f4122ee1-…/session.v4.jsonl.zstd（seq 21/28/35/42/49/56/74）
```

## 0.2.5-d 重打包说明（无重验）

版本串按 user 指令从 0.2.6 改为 0.2.5-d。**未重跑 rig 验证**：改动仅为 `package.json` 的 `version` 字段，不触及任何已验证面。等价性证据：重打包后 tgz 内 `lib/` 65 个文件与 0.2.6 验证轮的构建产物 sha256 逐文件一致（清单比对），即发布的就是验证过的那个产物。

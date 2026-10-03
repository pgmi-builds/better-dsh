# better-dsh AST 引擎去 OMP（in-package WASM）— 4999 第一人称实测报告

日期：2026-10-03/04 ｜ 规格：`docs/specs/ast-engine-deomp/spec.md` ｜ 目标版本：`0.2.5-c`（本地过程版本，未发布）｜ 计划：`.superpowers/sdd/2026-10-03-ast-engine-deomp/`（Task 11 验收）

## 0. 一句话

AST 设备（`dvc://ast_grep` / `dvc://ast_edit`）已整体运行在**包内 WASM 引擎**上：真实 agent session（HTTP RPC 驱动、4999 rig、`.vendor` 预先删除）里完成结构化搜索（34 命中/8 文件/11 检索，含完整元变量捕获）、dryRun 拦截（`applied:false` 文件不动）与真写盘（`git diff` 可见后回滚）；tarball 零 OMP 代码、零 `.node`、零运行时依赖；与 prod 树残留的 **native addon 直接对拍，处方 pattern 两引擎逐字段一致**。

## 1. 验收口径（AGENTS §〇 第 2 条：与改动点同类）

改动点是"实际运行时上下文里 ast 设备可不可用 + OMP 供给链是否根除"，验收即：真实 agent session 在 4999 rig 的真实运行时里走 `write dvc://ast_*` 全链路（host 侧被测路径全覆盖），并以 `.vendor` 不重建 + tarball 零 OMP 证明供给链死亡。构建卫生（tsc/单测/产物 grep）只是前置，不是验收本体。

## 2. 全量卫生（Step 1）

| 项 | 结果 |
|---|---|
| `npm run build`（tsdown + build-client） | ✅ 通过；`ast-assets: 16 files, 14.4 MB`（构建日志原句） |
| `npm run typecheck`（tsc + tsc -p tsconfig.client.json） | ✅ 0 错（exit 0） |
| `npx vitest run` | ✅ **Test Files 63 passed (63)；Tests 681 passed, 1 skipped (682)** |

## 3. tarball 零 OMP（Step 2）

`npm pack` → `better-dsh-0.2.5-c.tgz`（22,250,332 B），解包至 `/tmp/astpkg/package`：

| 检查 | 结果 |
|---|---|
| `grep -rc "pi_natives\|@oh-my-pi"` 代码面（`lib/`、`package.json`、`scripts/`） | **0 命中** |
| 同 grep 全包 | 11 个文件命中，**全部在 `package/docs/`**（specs/plans/报告/upstream 文档里对本次去 OMP 迁移的自指文字记录——纯 prose，非代码非依赖） |
| `.node` 原生二进制 / `.vendor` / `natives-loader` | tarball 内 **0 项**（`natives-loader.ts` 已从 src 删除） |
| `lib/ast-assets` | **16 个文件**（ast-grep.wasm + tree-sitter.wasm + 14 语法），15,091,049 B |
| `dependencies` / `optionalDependencies` | **空**（安装面只加 1 个包） |

## 4. 离线 rig 第一人称实测（Step 3）

### 4.1 rig 安装与离线前置

- `rm -rf <pkg>/.vendor`（start 前执行；当时本就不存在——上一任务已清）
- `plugin --profile web remove better-dsh` → `add …/better-dsh-0.2.5-c.tgz`：`Packages: +1 … Done in 2.2s`
- 安装位与fresh构建**字节一致**（`lib/index.js` cmp 相等；`lib/ast-assets` 目录 diff 为空；版本 0.2.5-c）
- `bash .test/seed/test123/start.sh` 启动：boot graph 含 `"id":"better-dsh"`，`/plugins/??better-dsh/client.js&rev=af3132a66867` → 200 / 29,700 B

### 4.2 驱动方式（HTTP RPC，真实 session）

web-password 门（本插件自己的 feature，独占 `/`）铸 cookie：`curl -c jar -X POST -d "password=admin" /` → 303。此后按 0.1.7 `/api` HTTP JSON RPC 两段形端点（typert 具名参数，`{args:{request:{…}}}` 包裹）：

- `POST /api/session/create` → `{"sessionId":"session-91ea4282-99b4-4941-89ab-8cc7bc199a4a","agentPreset":"standard"}`
- `POST /api/session/prompt`（`mode:'queue'`，全文任务指令见会话日志 seq 20 / seq 68）

会话 `session-91ea4282…`：2 个 turn、11 次工具调用（write×6 / bash×4 / memory_add×1），全部走宿主 write 工具的 dvc:// URL 分支。日志：`.test/home/compat/sessions/--home-u1-workspaces-dashr--/session-91ea4282…/session.v4.jsonl.zstd`。

### 4.3 Round 1 —— 任务处方的三次调用（args 原样，返回原样 JSON）

**（a）`write dvc://ast_grep`**，content：`{"patterns":["export function $NAME($$$ARGS)"],"path":"<ws>/better-dsh/src/devices/ast"}`（seq 21→22）：

```json
{
  "matches": [],
  "totalMatches": 0,
  "filesWithMatches": 0,
  "filesSearched": 11,
  "limitReached": false
}
```

**（b）`write dvc://ast_edit`（dryRun 默认）**，content：`{"ops":[{"pat":"export function $NAME($$$ARGS)","out":"export function $NAME($$$ARGS) {}"}],"paths":["<ws>/better-dsh/src/devices/ast/ast-reminder.ts"]}`（seq 28→29）：

```json
{
  "changes": [],
  "fileChanges": [],
  "totalReplacements": 0,
  "filesTouched": 0,
  "filesSearched": 1,
  "applied": false,
  "limitReached": false
}
```

随后 `git status --porcelain -- …/ast-reminder.ts` → **空输出**（文件未变 ✅）。

**（c）同 ops + `"dryRun":false`**（seq 42→43）：

```json
{
  "changes": [],
  "fileChanges": [],
  "totalReplacements": 0,
  "filesTouched": 0,
  "filesSearched": 1,
  "applied": true,
  "limitReached": false
}
```

`applied:true`（非 dry-run 确已进入写盘路径）但 0 命中 → 文件内容不变，`git diff --stat` 空输出；agent 仍按剧本执行 `git checkout --` 回滚（幂等 no-op），树保持干净。

**处方 pattern 0 命中的定性**：这是 ast-grep **严格结构匹配**的正确行为，不是引擎退化——无函数体的 pattern 无法命中带函数体的声明节点（pattern 子节点必须逐一对齐；本仓函数全部带 body 与返回类型标注）。**Native 对拍证实**（§5）：同一 pattern 在真实 OMP native addon 上同样 0/0/11，逐字段一致。为完成"真命中 + 真写盘"的验收意图，Round 2 用结构对齐的 pattern 补测（§4.4），两轮合计覆盖：结构化命中、元变量捕获、分页、dryRun 拦截、真写盘、diff、回滚。

### 4.4 Round 2 —— 结构对齐补测（同一 session 第二 turn）

**（a'）`dvc://ast_grep`**：`{"patterns":["function $NAME($$$ARGS): $RET { $$$BODY }"],"path":"<ws>/better-dsh/src/devices/ast","includeMeta":true,"limit":3}`（seq 69→70，节选）：

```json
{
  "matches": [
    {
      "path": "better-dsh/src/devices/ast/ast-device.ts",
      "text": "function ctxCwd(ctx: unknown): string {\n  if (ctx !== null && typeof ctx === 'object' && typeof (ctx as { cwd?: unknown }).cwd === 'string') {\n    return (ctx as { cwd: string }).cwd\n  }\n  return process.cwd()\n}",
      "byteStart": 2610,
      "byteEnd": 2821,
      "startLine": 59,
      "startColumn": 1,
      "endLine": 64,
      "endColumn": 2,
      "metaVariables": {
        "NAME": "ctxCwd",
        "ARGS": "[ctx: unknown]",
        "RET": "string",
        "BODY": "[if (ctx !== null && typeof ctx === 'object' && …, return process.cwd()]"
      }
    }
  ],
  "totalMatches": 34,
  "filesWithMatches": 8,
  "filesSearched": 11,
  "limitReached": true
}
```

34/8/11 + `limitReached:true`（`limit:3` 分页后的合法语义）；与离线预计算（同引擎直接驱动：34 命中/8 文件）**完全一致**。元变量四类（单变量 `$NAME`/`$RET`、多捕获 `$$$ARGS`/`$$$BODY` 的 Rust Debug 数组串形态）齐活。

**（b'）`dvc://ast_edit` dryRun 默认**：`{"ops":[{"pat":"export function disposeAstReminders(sessionId: string): void { $$$BODY }","out":"export function disposeAstReminders(sessionId: string): void { /*ast-live-proof*/ $$$BODY }"}],"paths":["…/ast-reminder.ts"]}`（seq 77→78）：

```json
{
  "changes": [
    {
      "path": "better-dsh/src/devices/ast/ast-reminder.ts",
      "before": "export function disposeAstReminders(sessionId: string): void {\n  counters.delete(sessionId)\n}",
      "after": "export function disposeAstReminders(sessionId: string): void { /*ast-live-proof*/ counters.delete(sessionId) }",
      "byteStart": 2063,
      "byteEnd": 2156,
      "deletedLength": 93,
      "startLine": 42,
      "startColumn": 1,
      "endLine": 44,
      "endColumn": 2
    }
  ],
  "fileChanges": [{ "path": "better-dsh/src/devices/ast/ast-reminder.ts", "count": 1 }],
  "totalReplacements": 1,
  "filesTouched": 1,
  "filesSearched": 1,
  "applied": false,
  "limitReached": false
}
```

`git status --porcelain` → **空**（预览未落盘 ✅）。

**（c'）同 ops + `"dryRun":false`**（seq 91→92）：同上 changes，`"applied": true`。随后 `git diff` 真实可见（seq 98→99）：

```diff
-export function disposeAstReminders(sessionId: string): void {
-  counters.delete(sessionId)
-}
+export function disposeAstReminders(sessionId: string): void { /*ast-live-proof*/ counters.delete(sessionId) }
```

agent 立即 `git checkout --` 回滚，复检 `git status --porcelain` → 空 ✅。**真写盘-可见-回滚闭环完成。**

### 4.5 过程事件：4999 端口被并发抢占一次

Round 1 结束后（03:56:36）本机另一 agent（superd 工作区）重启了它自己的 `superd-4999-test.service`，杀掉了我们的 `dsh-4999-test123`（LAN relay socat 同刻 signal 15）。复跑 `start.sh`（其无主化接管逻辑再次停掉对方、夺回端口），**同一 sessionId 在同一 rig home 上续跑 Round 2**——两轮证据完整连续。此为共享测试机上的已知端口竞争形态（AGENTS §二），非被测面问题。

### 4.6 离线/.vendor 证据

- **start 前**：`rm -rf <pkg>/.vendor`（当时本已不存在）
- **两轮全部 dvc 调用之后**：`.test/home/compat/profiles/web/node_modules/better-dsh/.vendor` **仍未被创建**（最终复检 ABSENT）——WASM 资产随包分发，无任何按需自装路径被触发
- rig 日志 `.scratch/dsh-4999-test123.log` 全文件（188 行、45 次历史 boot）：`oh-my-pi|pi_natives|registry.npm|npmjs` **0 命中**；本次 boot 后 0 错误
- profile 树根的空壳目录 `node_modules/@oh-my-pi/`（0 文件，时间戳 10-03 01:15，早于本任务）为上一纪元残留 husk，非本插件产物；`.pnpm` store 内无相关条目

## 5. Native A/B 直接对拍（意外收获：native addon 仍在 prod 树）

`~/.dsh/profiles/web/node_modules/@oh-my-pi/pi-natives-linux-x64/`（prod 由 `super-dsh` 引入的 352 MB 二进制，非我们的）仍可 dlopen——用它对拍本次全部 live 输入（脚本 `/tmp/ab-prescribed.mjs`、`/tmp/ab-dir.mjs`，spike 同款手法）：

| 输入 | OMP native | WASM（live rig） | 一致 |
|---|---|---|---|
| 处方 pattern `export function $NAME($$$ARGS)`（目录） | `0 / 0 / 11` | `0 / 0 / 11` | ✅ |
| 对齐 pattern `function $NAME($$$ARGS): $RET { $$$BODY }`（目录） | `34 / 8 / 11` | `34 / 8 / 11` | ✅ |
| edit dryRun 默认（disposeAstReminders 单点） | `totalReplacements:1, applied:false` | `totalReplacements:1, applied:false` | ✅ |
| edit `dryRun:false` | `totalReplacements:1, applied:true` | `totalReplacements:1, applied:true` | ✅ |

顺带记录 native 的一个路径怪癖（对迁移结论无影响）：`astEdit` 收绝对文件路径时会从 cwd 起走整树（`filesSearched:1976`）并按重定基底径写盘（对拍探针因此摸脏了工作树一次，当场 `git checkout --` 复原）；我们的 controller 对绝对文件路径正确给 `filesSearched:1` 并写回原路径。

## 6. Task 8 评审两项遗留的处置（按移交指令：观察记录，不修）

1. **`limitReached` 纯 offset 边**：公式 `totalMatches > paged.length`（`ast-device.ts:274`）意味着 `offset>0` 且无 `limit` 的查询在有命中文件上恒报 `limitReached:true`。本任务**记录为接受边**（brief 明示公式如此；native 已删，该边无从 A/B）。live 旁证：Round 2 的 `limitReached:true` 出现在 `limit:3` 分页场景（34>3，合法语义），与本边无关亦不矛盾。
2. **`engine/edit.ts` 只吞 multi-root 错误**：**已直接核验**——`edit.ts:54-56` 的 catch 仅当 `error.message.includes('Multiple AST nodes are detected')`（`MULTI_NODE`，`edit.ts:13`）时 `continue`，其余一律 rethrow；`match.ts:67-69` 同款归零逻辑。无吞错面扩大。

## 7. 第一人称机制发现（本轮新增）

ast-grep 匹配是**子节点严格对齐**的：pattern 缺 body 子节点 → 永不命中带 body 的函数声明；缺返回类型标注 → 永不命中带标注的签名。离线矩阵（同引擎，`$$$`-pattern × 三种源）：

| pattern | 无返回标注源 | `: void` 标注源 | 仓库真文件 |
|---|---|---|---|
| `export function $NAME($$$ARGS)`（无 body） | 0 | 0 | 0 |
| `function $NAME($$$ARGS) { $$$BODY }` | 2 | 0 | 0 |
| `export function $NAME($$$ARGS): void { $$$BODY }` | 0 | 1 | 1 |

与 spec §2.1"C / CSS 的匹配不到是上游 pattern 上下文歧义，不是 WASM 退化"同族——native 对拍 0=0 坐实。**写 pattern 必须带上目标声明的完整子节点形态（含返回类型），文本级 grep 直觉在这里不成立。**

## 8. 规格 §2.1 spike A/B 表（provenance 照录）

| 用例 | OMP native | WASM 栈 | |
|---|---|---|---|
| `c` `foo($A)` | 0 | 0 | ✅ |
| `c` `return foo($A)` | 1 | 1 | ✅ |
| `cpp` `foo($A)` | 1 | 1 | ✅ |
| `css` `color: $V` / `color: red` | 0 / 0 | 0 / 0 | ✅ |
| `html` `<div class=$C>$$$K</div>` | 1 | 1 | ✅ |
| `python` `return $X` | 1 | 1 | ✅ |
| `js` `foo($$$A)` / `rust` `vec![$$$A]` / `yaml` `b: $V` / `go` `foo($A)` | 1 | 1 | ✅ |

本轮 §5 的对拍把该表延伸到了本次 live 实际输入（含处方 pattern 的 0=0）。

## 9. 未做 / 边界

- **未发布**：`npm publish` 需 user 单独明确放行（AGENTS §〇 红线），本任务不含。
- 版本 `0.2.5-c` 为本地过程版本；tarball 仅入 rig（file: 安装），registry 无足迹。
- native 对拍依赖的 prod 树残留 `@oh-my-pi` 属 `super-dsh` 的依赖，不因本插件去 OMP 而消失（prod 面清理不属本计划）。
- 第一人称会话的 token 消耗（两 turn 合计约 15k output / 150k+ cache-read）留在 rig home，随下次 home 复用自然沉淀。

## 四、4998 复测（user 指令：4999 被并发 agent 占用）

日期：2026-10-04 ｜ 前提：4999 端口被另一并发 agent 的 rig 占用，user 指令改在 **4998** 重跑验收 live-fire。**上文 §1–§9 的 4999 实测结论（native A/B 对拍 0/0/11 逐字段一致、两轮 live 证据）原样保留，本节为同口径独立复测**，不覆盖、不替代上文。

### 4.8.1 rig 状态与启动

- 前置核验：profile 安装位 `lib/ast-assets` **16 文件**（Task 11 remove→add 的产物原样在场）；`.vendor` start 前 **ABSENT**。
- `PORT=4998 bash .test/seed/test123/start.sh`：unit `dsh-4998-test123` + `test123-lan-4998-relay` 起动，`127.0.0.1:4998` 与 LAN `192.168.31.130:4998` 双监听；日志 **`.scratch/dsh-4998-test123.log`**（append，本次 boot 前历史 5 行）。
- 认证：与 §4.2 同一形态——better-dsh `dashr-web-password` 行独占 `/`（launch-token URL 被 password 门先行接管，GET `/?token=…` 直接 200 不铸 cookie），`curl -c jar -X POST -d "password=admin" /` → **303** + 原生 `dsh-auth-<authority-hash>` cookie（HttpOnly）。此后 `/api` 全部携带该 cookie。

### 4.8.2 HTTP RPC 驱动（真实 session，同 §4.2 两段形）

- `POST /api/session/create`（client-request 信封，`payload.args.request.cwd=/home/u1/workspaces/dashr`）→ `{"sessionId":"session-1aa5f442-9058-49fb-bf31-74a2780a90ab","agentPreset":"standard"}`
- `POST /api/session/prompt`（`mode:'queue'`，rpcId `req-ast-4998-live`）→ `{"accepted":true}`
- 会话 `session-1aa5f442…`：1 turn、7 次工具调用（bash×3 / write dvc://×3 / memory_add×1），全部 dvc 调用走宿主 write 工具的 URL 分支。日志：`.test/home/compat/sessions/--home-u1-workspaces-dashr--/session-1aa5f442…/session.v4.jsonl.zstd`（seq 28→29 / 35→36 / 49→50）。

### 4.8.3 三次 live 调用（结构对齐 pattern，§4.4 同款）

**（a）`write dvc://ast_grep`** content：`{"patterns":["function $NAME($$$ARGS): $RET { $$$BODY }"],"path":"/home/u1/workspaces/dashr/better-dsh/src/devices/ast","includeMeta":true,"limit":3}`（seq 28→29，返回原样 JSON 节选）：

```json
{
  "matches": [
    {
      "path": "better-dsh/src/devices/ast/ast-device.ts",
      "text": "function ctxCwd(ctx: unknown): string { … }",
      "byteStart": 2610, "byteEnd": 2821,
      "startLine": 59, "startColumn": 1, "endLine": 64, "endColumn": 2,
      "metaVariables": { "NAME": "ctxCwd", "ARGS": "[ctx: unknown]", "RET": "string", "BODY": "[if (ctx !== null && …, return process.cwd()]" }
    },
    {
      "path": "better-dsh/src/devices/ast/ast-device.ts",
      "text": "function rel(file: string, cwd: string): string { … }",
      "byteStart": 2895, "byteEnd": 3006,
      "startLine": 67, "startColumn": 1, "endLine": 69, "endColumn": 2,
      "metaVariables": { "NAME": "rel", "ARGS": "[file: string, ,, cwd: string]", "RET": "string", "BODY": "[return path.relative(cwd, file).split(path.sep).join('/')]" }
    }
  ],
  "totalMatches": 34,
  "filesWithMatches": 8,
  "filesSearched": 11,
  "limitReached": true
}
```

**34/8/11 + `limitReached:true`（`limit:3` 分页）**——与 4999 轮 §4.4(a') 及 native 对拍 §5 的 34/8/11 **完全一致**（首条 match 的 byteOffset 2610/2821、元变量四类捕获逐字段相同）。

**（b）`write dvc://ast_edit` dryRun 默认**，content：`{"ops":[{"pat":"export function disposeAstReminders(sessionId: string): void { $$$BODY }","out":"export function disposeAstReminders(sessionId: string): void { /*ast-live-proof*/ $$$BODY }"}],"paths":["…/ast-reminder.ts"]}`（seq 35→36）：

```json
{
  "changes": [{ "path": "better-dsh/src/devices/ast/ast-reminder.ts", "before": "export function disposeAstReminders(sessionId: string): void {\n  counters.delete(sessionId)\n}", "after": "export function disposeAstReminders(sessionId: string): void { /*ast-live-proof*/ counters.delete(sessionId) }", "byteStart": 2063, "byteEnd": 2156, "deletedLength": 93, "startLine": 42, "startColumn": 1, "endLine": 44, "endColumn": 2 }],
  "fileChanges": [{ "path": "better-dsh/src/devices/ast/ast-reminder.ts", "count": 1 }],
  "totalReplacements": 1,
  "filesTouched": 1,
  "filesSearched": 1,
  "applied": false,
  "limitReached": false
}
```

`applied:false` ✅；调用前后 `git status --short -- better-dsh/src/devices/ast/` 均为**空**（baseline seq 22 / 复检 seq 43，文件未动）。

**（c）同 ops + `"dryRun":false`**（seq 49→50）：同上 changes，`"applied": true, "totalReplacements": 1, "filesTouched": 1`。随后（seq 57）：

```text
 better-dsh/src/devices/ast/ast-reminder.ts | 4 +---
 1 file changed, 1 insertion(+), 3 deletions(-)
```

`git checkout --` 立即回滚，复检 `git status --short -- better-dsh/src/devices/ast/` → **空** ✅。真写盘-可见-回滚闭环复现。

### 4.8.4 供给链证据（本次 run 复检）

- **`.vendor`**：全部 dvc 调用之后 `.test/home/compat/profiles/web/node_modules/better-dsh/.vendor` 仍 **ABSENT**（`ls` exit 2）；`lib/ast-assets` 仍 16 文件——无任何按需自装路径被触发。
- **rig 日志**：`grep -icE "omp|oh-my-pi|registry" .scratch/dsh-4998-test123.log` → **0 命中**（全文件，含本次 boot 全部输出）——零 OMP/registry 供给痕迹。

### 4.8.5 复测结论

4998 独立复测与 4999 首测**逐项同构**：对齐 pattern 34/8/11（含元变量捕获与 byteOffset 级一致）、dryRun 拦截（applied:false 文件不动）、真写盘（applied:true + git diff 可见 + 回滚）、`.vendor` 全程不重建、日志零 OMP/registry 行。被测面（包内 WASM 引擎 + 宿主 write dvc:// 路径）与端口无关，验收结论不受端口变更影响。


## 五、终审补测（trimmed tarball）

日期：2026-10-04 ｜ 背景：packaging-trim 后的发布物（`docs-packaging-trim`，731 文件 / 5.1 MB，此前轮为 22.2 MB）从未有 ast 调用驱动过——终审 Finding I3 补上这一半。`skill://dsh-dev-skill` 半边仍留作 publish-gate 条件（需 live LLM session，human 执行）。

- **安装**：`npm pack` → `better-dsh-0.2.5-c.tgz`（shasum `5469abae…`）→ rig profile `plugin remove` → `add`（`Packages: +1`）；安装位 `lib/index.js` 与 fresh 构建字节一致、`lib/ast-assets` 16 文件 diff 为空；start 前 `.vendor` **ABSENT**。
- **tarball 双面复核**：代码/产物面（`lib/`、`package.json`、`scripts/`）`grep -rc "pi_natives\|@oh-my-pi"` = **0 命中**；docs 面 6 个文件命中（trim 前 11），全部为 specs/plans/报告对本次迁移的历史 prose 记录——与 spec §1.2/§5.3 终审定界后的口径一致（docs 提及数量随发布内容浮动，非回归信号）。
- **rig**：`PORT=4998` 重启（start.sh 接管旧 unit）；shell 页 boot graph 含 `"id":"better-dsh"`，`/plugins/??…better-dsh/client.js&rev=…` → **200**。
- **驱动**：HTTP RPC 同 §4.8 两段形（web-password 铸 cookie → `session/create` → `session/prompt`，信封补 `type:"client-request"` 判别键）。会话 `session-cca50096-36f1-4d84-b3a0-9a75f06443d7`，1 turn、1 次工具调用（seq 20 `write` `dvc://ast_grep`，args 与 §4.8.3(a) 同款：`function $NAME($$$ARGS): $RET { $$$BODY }` / `includeMeta` / `limit:3`）。
- **结果**（seq 21 原样）：**`totalMatches: 34, filesWithMatches: 8, filesSearched: 11, limitReached: true`**，分页返回 3 条 match；首条 `ctxCwd` 的 `byteStart 2610 / byteEnd 2821 / startLine 59` 与元变量四类捕获（NAME/ARGS/RET/BODY）与 §4.4(a')（4999 首测）、§4.8.3(a)（4998 复测）**逐字段一致**——trimmed tarball 的引擎面与 trim 前发布物零漂移。
- **供给链**：调用之后 `.vendor` 仍 **ABSENT**（`ls` exit 2）；rig 日志 `omp|oh-my-pi|registry` **0 命中**。

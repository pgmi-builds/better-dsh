# Remote 执行框架 — 第一人称复测报告（approval policy = `never`）

- **日期**: 2026-09-23（矩阵 20:52–20:59 +08:00）
- **分支/HEAD**: `remote-framework` @ `ac8720a`（**post-P15**：pty 4M 尾窗环 + deathWaiter 摘除）
- **复测载体**: **本 agent 自己的 live session**（Dev/Test 1 实例 4999 Web 运行时，`session-95c48291-f958-455c-83ab-98de3fa815a4`，cwd `/home/u1/workspaces/dashr`），直接以 `remote` 工具逐条派发——不是 headless 代跑
- **策略面**: 同一 session 内 `approval/policy: ask → never`（seq 2 → 6）、`sandbox/mode: workspace-write → danger-full-access`（seq 1 → 5）；全部复测动作发生在 `never` 之后
- **对照**: 原验收报告 `docs/50_test-reports/2026-09-23-remote-framework实测报告.md`（矩阵 @ c696fca，**pre-P15**）+ SDD ledger `.superpowers/sdd/2026-09-23-remote-framework-impl/progress.md`
- **运行时同一性**: 实例 20:22:08 启动，`lib/remote/plugin.js` 构建于 20:21:34；rsync 后 worktree `src/` 与 monorepo 副本 `src/` `diff -rq` 为空 → **所测即 `ac8720a`**。P15 之前从未在真运行时跑过矩阵（Task 10 矩阵早于 `ac8720a`），本报告是 **P15 代码的首次第一人称实测**。

---

## 一、结论

| 面 | 结果 |
|---|---|
| 18 case 矩阵（本 agent 亲自派发） | **18/18 ✅**（1–8、10–18 直接复现；9 别名腿在 4999 原地热生效后复现） |
| P15/C1 输出帽（此前仅单测） | **✅ 第一人称**（oneshot 30k 帽 + pty 4M 环，尾保留，daemon 存活） |
| 原报告 §八 遗留「unreachable 真机路径」 | **✅ 补上真机证据**（`192.0.2.1` 黑洞 → `Connection timed out`） |
| 审计事件 | **✅** 本 session 日志含结构化 `dashr/remote-exec`（target/cmd/cwd/exit/durationMs，含 exit 130 中断） |
| approval 耦合 | **零**。`never` 下无一次 approval 询问/拒绝（63 次工具调用，0 错误，0 `approval/request|denied`） |
| `test/remote/` 单测 | **70/70 ✅**（9 spec） |
| 全量 vitest | 14 失败（**同基线 2 文件**）/ **578 通过** / 1 skip（593） |
| `tsc --noEmit` | **14 错，集合同基线，`remote` 0 提及** |

---

## 二、18 case 矩阵（本 session verbatim）

| # | case | 本 session 调用与结果 | 判定 |
|---|---|---|---|
| 1 | ssh oneshot | `{dev4, echo CASE1: … / git --version}` → `CASE1: 0 \| ok / git version 2.43.0`，exit 0 · 4.2s | ✅ |
| 2 | 退出码透传 | `{dev4, exit 42}` → exit **42** · 3.4s | ✅ |
| 3 | 复合语法 | `{dev4, ls / \| head -2 && echo $HOME}` → `bin / bin.usr-is-merged / /home/u1` | ✅ |
| 4 | pty 状态保持 | `cd /tmp && export F=1`（cwd `/tmp`）→ `pwd && echo $F` → `/tmp` `1` | ✅ |
| 5 | pty 多行单帧 | `"echo a\necho b"` → `a\nb` 一帧，exit 0 · 0.3s | ✅ |
| 6 | 伪 marker 免疫 | `printf '\033]133;D;deadbeefdeadbeef;99\007' ; echo real-after-marker` → `real-after-marker`，exit **0**（非 99） | ✅ |
| 7 | pty 超时打断 | `sleep 300` timeout 2 → `exit 130 · 2.2s · interrupted`；随后 `echo alive` → exit 0（会话存活） | ✅ |
| 8 | incus oneshot | `{incus:ctr-1, cat /etc/os-release \| head -1}` → `Ubuntu 26.04 LTS` | ✅ |
| 9 | incus pty + **别名路由** | 显式前缀 pty `cd / && hostname && pwd` → `ctr-1` `/`；**裸名 `ctr-1`** pty `cd / && echo via-alias && hostname && pwd && cat /etc/os-release \| head -1` → `via-alias / ctr-1 / / Ubuntu 26.04 LTS`，cwd `/` | ✅ |
| 10 | docker oneshot | 新起 `dashr-remote-t1`（ubuntu:24.04）→ `in-docker / Ubuntu 24.04.5 LTS` | ✅ |
| 11 | docker pty（script 托管） | `cd /root && pwd` → cwd `/root` · 0.1s | ✅ |
| 12 | BYO-PTY spawn | `{spawn:"docker exec -it dashr-remote-t1 bash", cmd:"echo spawned && hostname"}` → `spawned / de819743d988` | ✅ |
| 13 | 错误透明 | ssh：`ssh: Could not resolve hostname no-such-host-xyz: Temporary failure in name resolution`（exit 255）；docker：`Error response from daemon: No such container: no-such-ctr`（exit 1）——原生 stderr 逐字 | ✅ |
| 14 | 断联自愈 | `kill -9 $$` → `exit null` · 0.2s；次调用 → 首行逐字 `[remote: session reconnected to fresh shell; cwd reset to default]` + `back /home/u1`，cwd `/home/u1` | ✅ |
| 15 | 后台输出 Non-Goal | `nohup sleep 5 >/dev/null 2>&1 & echo bg-ok` → 输出恰 `bg-ok`，stderr 空，**3.6s**（见 §四.1） | ✅ |
| 16 | status 可达探测 | 无 pty 的 `dev3`/`dev2`：`probe: reachable in 1438/1061ms (just now, on demand)` + `session: none — dials on first exec`；**全文无 "offline"** | ✅ |
| 17 | status 会话层 | 用过 pty 后 `{dev4}` → `session: idle 8s (connected)` | ✅ |
| 18 | status 容器事实/错误 | `{docker:no-such-ctr}` → `probe: error — error: no such object: no-such-ctr`；`{docker:dkr-1}`（已退容器）→ `probe: container exited` | ✅ |

**审计抽查 ✅**：本 session 日志（`session.v3.jsonl.zstd` 解压）含逐条 `dashr/remote-exec`：`{target, cmd, cwd, exit, durationMs}`——含 `sleep 300 → exit 130, 2233ms`、别名腿 `target: "ctr-1" → cwd "/", exit 0`、`target: "docker exec -it … bash"`（spawn）。工具面失败路径（Task 8 的 Ruling 14）本轮无异类失败可触发，未新增样本。

---

## 三、补测：原报告遗留缺口

### 3.1 输出帽（P15 / 终审 C1，此前仅 5M 单测）

| 面 | 调用 | 结果 |
|---|---|---|
| oneshot 30k 帽 | `{dev4, python3 -c "print('x'*50000)"}` | 文本首行 `[truncated: showing last 30000 of 50001 chars]`，尾标 `truncated, original 50001 chars`，exit 0 · 3.4s |
| pty 4M 尾窗环 | `{dev4, mode:pty, head -c 5000000 /dev/zero \| tr '\0' 'y'; echo; echo TAIL-MARK-OK}` | 文本首行 `[truncated: showing last 30000 of 4000000 chars]`，**尾部 `TAIL-MARK-OK` 在位**，尾标 `truncated, original 4000000 chars`，exit 0 · 4.8s |

判读：pty 收集段被 4,000,000 UTF-16 环截断（`OUTPUT_HARD_CAP`），模型面再经 30k 尾窗；超 5MB 输出下 daemon 无 OOM、无卡死、尾字节保留——**C1 修复在真运行时成立**。注意 `original 4000000` 是**环上界**而非真实总量（帽后切片，设计如此）。

### 3.2 status 真机 `unreachable`（原报告 §八 缺口）

`{192.0.2.1}`（TEST-NET 黑洞）→

```
192.0.2.1 — ssh host
probe: unreachable — ssh: connect to host 192.0.2.1 port 22: Connection timed out
session: none — dials on first exec
```

词汇表 `unreachable — <native error>` 自此有真机证据（此前仅单测标签路径）。

### 3.3 别名路由的**热生效**事实（新发现）

原 Task 10 把 case 9 的别名腿当"改 home 层 patch（隐含需重启）"处理。本次实测：写入 `.dsh-test/cordis.patch.yml`（`[]` → 一行 `dashr-remote` 行重述 + `containers: {ctr-1: incus:ctr-1}`），**约 3s 内 4999 活体自行重新对账**——

- 之前：`{ctr-1}` → `ctr-1 — ssh host`（~/.ssh/config 同名 Host 胜出）
- 之后：`{ctr-1}` → `ctr-1 — incus container` + `probe: container RUNNING`，pty 落容器（`via-alias / ctr-1`）
- 复原（`[]`）同样 ~3s 热生效：`{ctr-1}` 回到 `ssh host`

即 0.1.6 的 HMR reconcile 覆盖 home 层 patch 写读，**别名腿无需重启**。副产品观察见 §四.2。

---

## 四、与原报告的差异 / 真实观察（均不阻塞）

1. **case 15 的"oneshot 等 ssh 会话通道 ~16.6s"未复现**。本轮同形命令 **3.6s** 返回（≈常规 ssh 握手成本），输出/退出码/静默性均符 Non-Goal。原 §六 第 1 条的持留观察在本环境本轮不成立；描述文本是否补披露可再议（不据此改代码——一次观测 vs 一次观测，证据对等）。
2. **配置热重载会丢弃 live pty 会话**：别名行热生效后，此前 idle 的 dev4 pty 会话从 `session: idle 8s (connected)` 变为 `session: none — dials on first exec`（插件行重挂 → `PtyPool` 重建）。行为可解释（重挂即新建 driver），但**不是** `idleTtlSec` 的语义，属"配置热改的代价"，记录在案。
3. **case 17 的 idle 语义**在热重载前验证成立（8s connected）；热重载后必然归 none，两者不矛盾。
4. dev4 无 docker，嵌套穿透（ssh -t 内嵌 docker）仍未覆盖（与原报告一致）——spawn 腿（case 12）已独立证 BYO-PTY 机制。

---

## 五、approval policy `never` 的专门核对

- 同一 session 策略事件：`approval/policy {ask}`（seq 2, 20:46）→ `{never}`（seq 6, 20:50）；`sandbox/mode {workspace-write}` → `{danger-full-access}`。
- `never` 生效后：**63 次工具调用、0 次 `approval/request` / `approval/denied` / `sandbox/denied`**，18 case + 补测全部完成。
- 源码面核对：`src/remote/*` 无 `approval` / `sandbox` / `escalat` 任何引用（grep 0 命中）——本框架在 daemon 侧直接派发系统 CLI，**不经** agent 工具审批链，因此策略从 `ask` 收紧到 `never` 对 `remote` 功能面无影响。这条正是本轮复测要回答的问题。

---

## 六、单测 / 类型基线（worktree @ `ac8720a`）

- `npx vitest run test/remote/` → **Test Files 9 passed (9)，Tests 70 passed (70)**（nonce 13 / target 5 / transports 9 / oneshot 6 / pty-session 14 / driver 6 / status 7 / tool 7 / plugin 3——pty-session 较原报告的 13 多 1，即 P15 的 5M 回归）。
- `npm test` → **14 failed | 578 passed | 1 skipped (593)**；失败恒为 **2 文件**：`test/url-schemes.spec.ts`（2）+ `test/surface-devices/agent-family.spec.ts`（12），单独复跑同得 `14 failed | 41 passed`——**全为 main 既有病，与本特性无关**。（ledger 记的 577 为 `ac8720a` 前数值；P15 新增 1 测试后应为 578。）
- `npx tsc --noEmit` → 14 错，文件集合同基线（`src/index.ts` 3、`src/url-schemes/index.ts` 1、`src/url-schemes/handlers/agent.ts` 1、`test/url-schemes.spec.ts` 2、`test/url-schemes/gates.spec.ts` 1、`test/surface-devices/agent-family.spec.ts` 6）；**`remote` 0 提及**。

---

## 七、清理与现场状态

- 别名 patch：`.dsh-test/cordis.patch.yml` 已还原为 `[]`（原文件备份 `.scratch/cordis.patch.yml.bak-task10retest`），并已复核热还原。
- scratch 容器 `dashr-remote-t1` 已 `docker rm -f`；`docker ps -a` 无残留（`{docker:dashr-remote-t1}` 现报 `no such object` 即为清理后真值）。
- 未触碰 `corti` / `jellyfin` / `ctr-1` / `app` 等既有资产；未改任何源码或构建产物；未重启 4999（本轮全程在同一 session 内完成）。
- 证据落盘：解压后的本 session 日志 `.scratch/retest-session.jsonl`（356 行，含全部 audit 事件）。

## 八、遗留

- 复核结论：**矩阵与缺口补测全过，approval `never` 无影响；分支 `ac8720a` 的实测证据面现覆盖 post-P15 代码**。
- 原报告 §八 其余两项仍开放（仅作里程碑候选）：`ws://` transport（spec 远期）；oneshot 会话通道持留语义的披露措辞（且本轮未复现，证据对等）。
- 本轮产物：本报告；无源码/测试改动，故无新单测需求。

# `remote` 工具（BYO-PTY label 重构）第一人称实测报告

- **日期**: 2026-10-03（矩阵 18:37–18:52 +08:00，UTC 10:37–10:52）
- **被测对象**: `better-dsh` 的 `remote` 工具（`src/remote/*`，11 模块）
- **代码身份**: 工作树 `better-dsh` @ HEAD `5aa48ea`（release 0.2.5-b）+ **未提交的 remote 重构改动**（6 文件，+296/−47：`driver.ts` / `pty-session.ts` / `status.ts` / `tool.ts` + 两个 spec）
- **实例**: Dev/Test 1 源码级 4999 rig（`.test/home/compat`，better-dsh 以 tarball 装入 profile）；**本 agent 自己的 live session**
- **第一人称载体**: 本 session 直接派发 `remote` 工具，共 **60 处**工具调用记录（原生 `tool/call`+`tool/result`）
- **对照**: `docs/50_test-reports/2026-09-23-remote-framework实测报告.md`（18 case @ `c696fca`）、`…-第一人称复测报告.md`（@ `ac8720a`）
- **prod（3080）未触碰**；未改任何源码/构建产物；未重启 4999

---

## 一、被测代码身份（先证「所测即所构」）

| 锚点 | 值 |
|---|---|
| 构建产物 | `better-dsh/lib/remote/plugin.js`（18:28:44） |
| rig 装入物 | `.test/home/compat/profiles/web/node_modules/better-dsh/lib/remote/plugin.js`（18:29:06） |
| **md5（两者相同）** | `b9669d1bf34a4e975e2e55a38394a079` |
| 运行面证据 | 本 session 的 `remote` tool description 已含 `pty:<label>` / `[E_LABEL_CONFLICT]` / `[E_NO_SESSION]` 新文案；未提交新面活体生效 |
| 单测 | `npx vitest run test/remote/` → **11 files / 89 tests 全过**（原 78/78，本轮改动 +11） |
| 类型 | `npx tsc --noEmit` → **exit 0**（旧报告记录的 14 条基线错已归零） |

本次改动把 BYO-PTY 从「`{spawn, cmd}` 独立入口 + 池键 `s:<spawn原文>`」改为 **`{target:"pty:<label>", spawn?, cmd}`：label 自选、即复用入口；spawn 降级为「仅创建时出席」的伴生参数**，并新增池内活 label 作为裸名候选表末位、`pty:` 专用状态行、roster `pty:` 渲染与一族错误码。

---

## 二、结论速览

| 面 | 结果 |
|---|---|
| 三传输基线（ssh / docker / incus） | **全过**（oneshot 退出码、stderr 逐字、cwd/环境持久、超时打断、多行单帧、伪 marker 免疫、stdin、输出帽） |
| BYO-PTY 新面（建/复用/同源提示/冲突/no-session/裸名末位候选/mode 锁/标签字符集/状态行/roster） | **全过**（20+ 项，见 §四.D） |
| 路由优先级（ssh → docker → incus → 池内 pty → ssh 兜底） | **全过**，含 `corti`/`ctr-1` 撞名实测 |
| 参数守卫（9 个错误码） | **全过**，全部 fail-loud、零静默降级、提示可执行 |
| 失败路径观测 | **3 条记录在案**（§五 F1–F3），其中 F2 为真实 UX 缺陷 |
| 输出帽 | oneshot 30k 尾窗 ✅、pty 30k 尾窗 ✅（4M 环仅单测） |
| 审计 | 原生 `tool/call`+`tool/result` 60 条，无自定义事件（P17 决议保持一致） |

---

## 三、方法与边界

- 全部 45 项检查均由本 agent 在**真实运行时**里以 `remote` 工具派发；无 headless 代跑、无桩。
- 逐条取证：文本取 verbatim 关键片段，退出码/时长/cwd/`session`/`truncated` 取自工具返回的结构化字段。
- 未覆盖（诚实边界）：idle TTL **600s 实时收割**（单测覆盖）、4M pty 环形帽（单测 + 旧报告 live）、`ws://`（spec 远期）、ssh→docker 嵌套穿透（dev4 无 docker）；`E_SESSION_START` 取 30s init 超时真路径（已实测）。
- 现场只做了只读型远程命令（`echo` / `hostname` / `uname` / `cat /etc/os-release` / `cd` / `export` / `kill -9 $$` 自杀 / `head -c`）；未改任何远端文件。

---

## 四、矩阵逐条（verbatim）

### A. roster 与状态探测

| # | 调用 | 结果 | 判定 |
|---|---|---|---|
| A1 | `{}` | 4 行：`ssh hosts (~/.ssh/config): github.com, dev2, dev3, mac, dev1, 137.131.54.174, dev4, ctr-1` / `docker containers: corti (running), jellyfin (running)` / `incus containers: ctr-1 (RUNNING)` / `live pty sessions: …` | ✅ |
| A2 | `{dev4}` | `probe: reachable in 2666ms (just now, on demand)` + `session: none — dials on first exec` | ✅ |
| A3 | `{incus:ctr-1}` | `probe: container RUNNING (just now, on demand)` | ✅ |
| A4 | `{docker:corti}` | `probe: container running (just now, on demand)` | ✅ |
| A5 | `{192.0.2.1}`（TEST-NET 黑洞） | `probe: unreachable — ssh: connect to host 192.0.2.1 port 22: Connection timed out`；词汇表全程无 `offline` | ✅ |

### B. oneshot（ssh / docker / incus 三传输）

| # | 调用 | 结果 | 判定 |
|---|---|---|---|
| B1 | dev4 `echo "A1 $(whoami)@$(hostname)"; git --version; python3 -V` | `A1 u1@dev4` / `git version 2.43.0` / `Python 3.12.3`，`exit 0 · 2.4s` | ✅ |
| B2 | dev4 `echo A2-start; exit 42; echo unreachable` | 输出 `A2-start`，**`exit 42`**（二进制退出码零扫描） | ✅ |
| B3 | docker:corti | `A3 f698ca647029` / `Debian GNU/Linux 13 (trixie)`，`0.1s` | ✅ |
| B4 | incus:ctr-1 | `A4 ctr-1` / `Ubuntu 26.04 LTS` / `7.0.0-34-generic` | ✅ |
| B5 | ssh 不存在的 host | `exit 255`，`[stderr] ssh: Could not resolve hostname no-such-host-xyz: Temporary failure in name resolution` | ✅ 逐字 |
| B6 | docker 不存在的容器 | `exit 1`，`[stderr] Error response from daemon: No such container: no-such-ctr` | ✅ 逐字 |
| B7 | incus 不存在的容器 | `exit 1`，`[stderr] Error: Failed to fetch instance "no-such-ctr" in project "default": Instance not found` | ✅ 逐字 |
| B8 | dev4 `cat` + `stdin:"STDIN-ONESHOT-OK"` | 输出恰 `STDIN-ONESHOT-OK` | ✅ |
| B9 | dev4 输出 50 015 字符 | 首行 `[truncated: showing last 30000 of 50015 chars]`，尾部 `CAP-TAIL-MARK` 在位，`exit 0 · truncated, original 50015 chars` | ✅ |
| B10 | incus `nohup sleep 5 >/dev/null 2>&1 & echo bg-ok` | 输出恰 `bg-ok`，stderr 空，`0.0s`（Non-Goal：使用者自负重定向） | ✅ |
| B11 | `{corti}`（docker 容器 vs 无同名 ssh） / `{ctr-1}`（ssh config vs incus 撞名） | `corti` → 容器内 `f698ca647029 /build`；`ctr-1` → ssh（hostname `ctr-1`）——优先级 ssh→docker→incus 与旧报告一致 | ✅ |

### C. pty（transport target）——持久状态与生命周期

| # | 调用 | 结果 | 判定 |
|---|---|---|---|
| C1 | dev4 pty `cd /tmp && export LABVAR=hello && pwd && hostname` | `/tmp` / `dev4`，`cwd /tmp` | ✅ |
| C2 | 次轮 `pwd; echo LABVAR=$LABVAR; date +%T` | `/tmp` / `LABVAR=hello` / `18:38:09`（跨轮持久） | ✅ |
| C3 | `sleep 300; echo NEVER-REACHED` + `timeout:2` | 输出空，**`exit 130 · 2.2s · interrupted`**，`cwd /tmp` 保持 | ✅ |
| C4 | 打断后 `echo ALIVE; pwd; echo LABVAR=…` | `ALIVE / /tmp / LABVAR=hello`（会话未被杀死） | ✅ |
| C5 | `"echo a\necho b"` | 一帧 `a\nb` | ✅ |
| C6 | `printf '\033]133;D;deadbeefdeadbeef;99\007'; echo real-after-marker` | `real-after-marker`，**`exit 0`（非 99）** | ✅ |
| C7 | `read X; echo "GOT:[$X]"` + `stdin:"REPL-VALUE\n"` | `GOT:[REPL-VALUE]` | ✅ |
| C8 | 200 015 字符（pty 收集） | `[truncated: showing last 30000 of 200015 chars]`，尾部 `PTY-TAIL-MARK` 在位，`exit 0` | ✅ |
| C9 | `kill -9 $$` → 次轮 `echo back; pwd` | 首个 `exit null · 0.2s`；次轮首行逐字 `[remote: session reconnected to fresh shell; cwd reset to default]` + `back /home/u1` | ✅ |
| C10 | 黑洞主机 pty | `Error: [E_SESSION_START] remote pty session 'session-a7b0aad7-…|t:192.0.2.1' did not initialize in 30s`（30s 硬门） | ✅ 见 F1 |

### D. BYO-PTY（本轮新面，逐条）

| # | 调用 | 结果 | 判定 |
|---|---|---|---|
| D1 | `{target:"pty:alpha", spawn:"ssh dev4", cmd:"hostname; cd /var/tmp && export BVAR=zeta && pwd"}` | `dev4 / /var/tmp`，结构字段 `cwd=/var/tmp · pty:alpha`（**新：返回值带 session label**） | ✅ |
| D2 | `{target:"pty:alpha", cmd:"pwd; echo BVAR=$BVAR; whoami"}`（**无 spawn**） | `/var/tmp / BVAR=zeta / u1`（label 即复用入口） | ✅ |
| D3 | 同 label 再给**同源** spawn | 首行引导：`[remote: pty:alpha already runs that exact command and is persistent — reuse it with { target: "pty:alpha", cmd: "…" }; spawn is only needed to create.]`，命令照跑 | ✅ |
| D4 | 同 label 给**异源** spawn（`ssh dev3`）+ `cmd:"echo SHOULD-NOT-RUN"` | `Error: [E_LABEL_CONFLICT] … nothing was run.` + `existing spawn: "ssh dev4"` / `given spawn: "ssh dev3"` + 两条修复路径；**命令未执行** | ✅ |
| D5 | `{target:"pty:beta", spawn:"docker exec -it corti bash", …}` | 容器内 `f698ca647029` / `Debian 13`，`cwd /root` | ✅ |
| D6 | pty:beta `kill -9 $$` → 次轮 | `exit null` → 次轮 `[remote: session reconnected…]` + 容器 hostname（**按原 spawn 自愈重连**） | ✅ |
| D7 | 标签字符集正例 `pty:lab.2_x` | 创建成功，`session: idle 5s (connected)` | ✅ |
| D8 | `{target:"pty:corti", spawn:"docker exec -it corti bash"}` 存在时调 `{target:"corti", cmd…}` | 命中 **docker 容器**（容器内 `/build`），不命中活 pty 会话——「撞名靠前者胜」 | ✅ 见 F3 |
| D9 | `{target:"alpha", cmd:"echo BARE-HIT; pwd; echo BVAR=$BVAR"}`（裸名，无 mode） | `BARE-HIT / /var/tmp / BVAR=zeta`，结构字段 `pty:alpha`（**候选表末位命中**） | ✅ |
| D10 | `{target:"alpha", mode:"oneshot", cmd:…}` | `exit 255 · ssh: Could not resolve hostname alpha…`——显式 oneshot **不吃** pty 候选，旧行为逐位保留 | ✅ |
| D11 | `{target:"pty:probe-none"}` / `{target:"pty:alpha"}` / `{target:"pty:deadspawn"}` | `session: none — no live PTY under this label`（**不会自建**，与 transport 的 "dials on first exec" 明确区分）/ `idle 0s (connected)` / `died — next exec cold-starts a fresh shell` | ✅ |
| D12 | `{}`（池内有会话时） | `live pty sessions: dev4 [ready, idle 4s], pty:alpha [ready, idle 0s], pty:beta [ready, idle 4s]`——transport 会话裸名、BYO 会话 `pty:` 前缀，池内部标记（`sessionKey|p:`）零泄漏 | ✅ |

### E. 参数守卫（fail-loud）

| # | 输入 | 输出（verbatim 要点） |
|---|---|---|
| E1 | `pty:bad label` / `pty:`（空标签） | `[E_BAD_LABEL] … must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (got "bad label"/"")` |
| E2 | `pty:alpha` + `mode:"oneshot"` | `[E_BAD_MODE] remote: "pty:alpha" is a PTY selector — mode is locked to 'pty'` |
| E3 | `pty:ghost`（从未创建、无 spawn） | `[E_NO_SESSION] … it is reaped after the idle TTL (600s)` + `Create it: …` |
| E4 | `dev4` + `spawn` | `[E_PARAMS] remote: spawn requires a "pty:<label>" target …` |
| E5 | 仅 `{spawn, cmd}`（无 target） | 同上 E_PARAMS（spawn 不能独立成形） |
| E6 | `{target:"dev4", stdin:"…"}`（无 cmd） | `[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd — status probes take no input` |
| E7 | `timeout:0` | `[E_BAD_TIMEOUT] … must be a positive number of seconds (got 0)` |
| E8 | `mode:"bogus"` | 宿主 schema 先拦：`Error: invalid arguments: "mode" must be one of ["oneshot","pty"]` |
| E9 | `pty:deadspawn` + spawn 坏命令（`ssh … no-such-host-xyz`） | `Error: [E_SESSION_DIED] remote pty session 'session-a7b0aad7-…\|p:deadspawn' died before initializing` |
| E10 | 死标签**复用**（无 spawn）/ 换 spawn | 复用 → 同 E_SESSION_DIED（重跑同一坏 spawn）；换 spawn → E_LABEL_CONFLICT —— **标签被锁死**（F2） |

---

## 五、问题与观察（按严重度排序）

### F1（中）`E_SESSION_DIED` / `E_SESSION_START` 泄漏池内部键，且丢掉原生传输错误

实测两条：

```
Error: [E_SESSION_DIED] remote pty session 'session-a7b0aad7-b3fc-4bff-949d-d12d4ab9d2b4|p:deadspawn' died before initializing
Error: [E_SESSION_START] remote pty session 'session-a7b0aad7-b3fc-4bff-949d-d12d4ab9d2b4|t:192.0.2.1' did not initialize in 30s
```

- 直接暴露内部池键（agent session id + `|p:` / `|t:` 内部标记 + pty label 或 target）。同一份代码在 roster 渲染处专门做了「池 key 内部标记剥离」（D12 实测），此处漏做——模型面两条规则不一致。
- 两条错误都**没有** `; transport stderr tail: …` 尾注（`doStart()` 里该分支存在），因为 BYO/ssh 的传输错误经 pty 从 `script`/`sshd` 走 **stdout**，而 `diag` 只收子进程 stderr ⇒ 原生原因（`Could not resolve hostname` / `Connection timed out`）在错误面消失。与「Native transport errors pass through verbatim」的对外承诺相邻面不一致：oneshot 逐字透传（B5–B7 实测），pty 初始化失败只给一个内部键。
- 建议：错误面统一走 `renderXXX` 的模型面形态（`pty:deadspawn — …`），并把 init 期内 pty 输出尾部也纳入 `diag`（或明确注明「无原生细节」）。

### F2（中）一次坏的 spawn 会把 label **锁死**，无自救入口

E9→E10 实测链条：

1. `{target:"pty:deadspawn", spawn:"ssh … no-such-host-xyz", cmd:…}` → E_SESSION_DIED；
2. 再复用（不给 spawn）→ **同一条 E_SESSION_DIED**（dispatch 对 `state==='dead'` 走 `start()`，重跑**冻结的**首建 argv）；
3. 改给可用 spawn → **E_LABEL_CONFLICT**（origin 不同即拒），且提示 `To reuse it: … (drop spawn)` 对死会话是**无效建议**。

代码面进一步：`markDead()` 会 `clearIdleTimer()`，而 idle timer 仅在 `onFrame`（初始化成功）里 `resetIdleTimer()` —— **died-before-init 的会话没有任何收割定时器**，`PtyPool.disposeAll/onDead` 也不会触发，`getOrCreate` 只替换 `disposed` 态。⇒ 该池项在**进程生命周期内**留存，label 事实上永久不可复用（重启 rig 或换 label 是唯二出路）。单测只有「ready 后 idle TTL 收割」一条（`idle TTL disposes the session and drops it from the pool`），无 died-before-init 收割用例。
（诚实边界：600s 实时收割未跑；「永久」为代码推论 + 观察到的「复用仍死、换源被拒」。）

建议：a) `markDead()` 对 **init 期死亡**的会话安排一次 dispose/出池（或 `getOrCreate` 把 `dead` 且 `origin!==undefined` 的 BYO 项视同可替换）；b) E_LABEL_CONFLICT 提示分叉：`existing.state==='dead'` 时改说「该 label 的首建命令已失败，请换 label 或先释放」。

### F3（低）裸名会被同名实体遮蔽，`pty:` 是唯一显式入口

`pty:corti` 活会话存在时，`{target:"corti"}` 仍命中 docker 容器（D8）——这与 description 的「on a collision the earlier source wins」完全一致，属**文档化行为**，不是 bug；但模型若用裸名做「按名找人」很容易把手伸进容器/主机而非自己的 BYO 会话。D9/D10 证明「裸名命中 pty」仅在三个 transport 都不撞名时成立。建议在 description 的裸名顺序里把这一后果写得更醒目（或让 `pty:` 成为文档首推写法）。

### F4（信息）轮次观察（不阻塞）

- 旧报告 §六.1「oneshot 等 ssh 会话通道」本轮未复测（B10 用 incus 0.0s 返回）；该披露措辞仍开放。
- `E_SESSION_START` 的 30s 硬门在黑洞主机上如期触发（C10），无挂死、无残留（`{192.0.2.1}` 后续 status 报 `session: died`，语义自洽）。
- `pty` 面 stdout/stderr 合流（spec §4.2 诚实代价）保持不变。

---

## 六、单测 / 类型基线（工作树 @ 5aa48ea + 未提交改动）

```
npx vitest run test/remote/
  Test Files  11 passed (11)
       Tests  89 passed (89)      Duration 24.55s
npx tsc --noEmit      → exit 0（零错误）
```

旧报告基线为「78/78（11 spec）+ tsc 14 既有错」；本轮改动新增 11 个用例（`driver.spec` +`tool.spec` 为主），类型面已归零。

## 七、审计与清理

- **审计**：本 session 日志 `session-a7b0aad7-b3fc-4bff-949d-d12d4ab9d2b4/session.v4.jsonl.zstd` 含 **60** 处 `"name":"remote"` 记录（原生 `tool/call`+`tool/result`）；插件未注册任何自定义 session 事件（与 P17 决议一致）。
- **清理**：未改源码/产物、未重启 rig、未动 prod；远端只执行只读命令，无残留文件。内存池会话（`dev4` / `pty:alpha` / `pty:beta` / `pty:lab.2_x` / `pty:deadspawn` / `192.0.2.1`）留在本 agent 进程池内——ready 者由 600s idle TTL 收割，died-before-init 者按 F2 留存；工具面目前无显式 dispose 入口（可归入 F2 的修复面）。

## 八、遗留与后续建议

1. **F2 优先**：给 died-before-init 的 BYO 池项以出池路径（收割或可替换），并让 E_LABEL_CONFLICT 对死会话给有效建议。
2. **F1**：E_SESSION_* 错误面去内部键 + 补原生原因（或明示缺失）。
3. 仍未覆盖：600s TTL 真机收割（单测覆盖）、4M pty 环形帽真机（单测 + 旧报告 live）、`ws://`（远期）、ssh→docker 嵌套穿透。
4. 发布纪律：本轮为**未提交工作树**的第一人称实测，按 AGENTS.md §〇，这**不构成** npm publish 前置条件；若要把该重构发包，需先固化提交/版本号，再由 user 明确放行。

---

## 九、复核轮 v2（2026-10-03 19:00–19:06 +08:00）— `byop:` 改名 + F1/F2 修复后重测

> 阅读提示：§一–§八 记的是**改名前的构建**（选择器写作 `pty:`）；本轮该选择器已改名为 `byop:`，其余面基本同构。

### 9.1 本轮被测身份

| 锚点 | 值 |
|---|---|
| 代码 | `better-dsh` @ HEAD `5aa48ea`（0.2.5-b）+ **更新后的未提交改动**（7 文件，+357/−55：`driver` / `pty-session` / `status` / `tool` + 2 spec，另 root `AGENTS.md`） |
| 规格 | 新增 **`docs/specs/remote-pty-label/spec.md`**（**126 行，9 条 Requirement + 17 个 Scenario**）——本轮首次有正式 spec 可对照。_(计数订正：§九 当时为 118 行 / 8 条 / 16 个 Scenario，原稿「14」为笔误；§十 的「roster 活性面按 agent session 作用域」再增 1 条 Requirement + 1 个 Scenario。)_ |
| 构建产物 | `better-dsh/lib/remote/plugin.js` 18:56:50，md5 **`ca2924024a724b508ca0d37bac9b81c6`** |
| rig 装入物 | profile 内同路径文件 18:57:11，**md5 相同**（所测即所构） |
| 实例 | rig 于 19:00 前后重启（`.scratch/dsh-4999-test123.log` 第三个 boot token `XDt0ul…`）；本 session 继续、池从零起 |

**本轮改动点（对着 §八 建议看）**：

1. **选择器改名 `pty:` → `byop:`**，`byop:<label>` 成为 BYO-PTY 唯一入口，`spawn` 降级为「仅创建时出席」的伴生参数；
2. 新增 **`displayKey()`**（`pty-session.ts`）为「池键 → 模型面名字」的**唯一**映射，roster 与错误面共用；
3. `PtySession` 增 `everReady`；**init 期死亡（从未 ready）即 `dispose()` 出池**，ready 过的死亡仍走 reconnect；
4. description 补一句「A spawn that fails to come up leaves nothing behind — the label stays free」；
5. 单测 `driver.spec` +`tool.spec` 扩到 92 例。

### 9.2 两条旧发现复核

| 旧编号 | 结论 | 本轮 verbatim 证据 |
|---|---|---|
| **F1**（E_SESSION_* 泄漏池内部键） | **键泄漏已修**；（native cause 仍缺 → 见下） | `Error: [E_SESSION_DIED] remote pty session 'byop:deadspawn' died before initializing` · `Error: [E_SESSION_START] remote pty session '192.0.2.1' did not initialize in 30s`——只出现模型面名字，`session-<uuid>` 与 `\|p:` / `\|t:` **零出现** |
| **F1 残留**（原生原因丢失） | **未修，降为 low** | 两条错误均**无** `; transport stderr tail:` 尾注（init 期 pty 报文走 stdout，`diag` 只收子进程 stderr）；`Native transport errors pass through verbatim` 在 pty 初始化失败面仍不成立 |
| **F2**（坏 spawn 锁死 label） | **全修** | ① 失败后 `{byop:deadspawn}` status = `session: none — no live PTY under this label`（**已出池**，不再是 `died`）；② 无 spawn 复用 = `[E_NO_SESSION]`（不再重跑冻结 argv）；③ 换 spawn 新建 = **成功**（`REPURPOSE-OK / dev4 / /home/u1 · byop:deadspawn`），无 `[E_LABEL_CONFLICT]` |
| **F3**（裸名被同名实体遮蔽） | 保持文档化行为 | 活着的 `byop:corti` 在池内时，`{corti}` 仍命中 docker 容器（`SHADOW-CORTI / f698ca647029 / /build`）——`byop:` 是唯一显式入口 |
| ready-death 半支（spec「已 ready 的会话死亡仍可重连」） | ✅ | `byop:beta` `kill -9 $$` → `exit null`；status 仍 `session: died — next exec cold-starts a fresh shell`（**留池**）；下次调用 `[remote: session reconnected to fresh shell; cwd reset to default]` + 容器 hostname |

### 9.3 新发现 F4（low–medium）：roster 不按 agent 作用域过滤

双 agent 实测（本 agent 派一个子 agent 做探针，同 daemon）：

- 子 agent 调 `{target:"byop:alpha"}`（本 agent 的活 label）→ `[E_NO_SESSION]`；**寻址层隔离成立** ✅
- 子 agent 建 `{target:"byop:shared", spawn:"ssh dev4"}` → 正常创建（其自己的命名空间）
- 本 agent 调 `{target:"byop:shared"}` → `[E_NO_SESSION]`（反向也隔离）✅
- **但**本 agent 的 `{}` roster 里出现了它：

```
live pty sessions: byop:deadspawn [ready, …], byop:beta [ready, …], dev4 […], byop:alpha […],
                   byop:lab.2_x […], byop:corti […], byop:shared [ready, idle 5s]
```

即：roster 面 `this.pool.list()` 不带 sessionKey 过滤，于是**广告了调用方无法使用的 label**（照着用必得 `[E_NO_SESSION]`），并把他 agent 的 label 名暴露给本 agent。spec 只固定了「池键按 agent 隔离」与「B 拿 E_NO_SESSION」，**未写 roster 作用域**——属 spec 空白 + 面间不一致。建议：roster 按 `callCtx.sessionKey` 过滤（或在 spec 里显式承认全局可见）。

### 9.4 矩阵 v2（重跑 43 项）

| 组 | 项 | 结果 | 备注 |
|---|---|---|---|
| A roster / status（roster、byop:probe-none、dev4、incus、docker、192.0.2.1） | 6 | ✅ | `byop:` 状态行 `session: none — no live PTY under this label` |
| B oneshot（ssh/docker/incus、`exit 42`、stdin、ssh/docker/incus 三错误） | 8 | ✅ | 与 §四.B 同名用例逐条复现，stderr 仍逐字 |
| C pty transport（cwd/env 持久、`timeout:2` 打断 `exit 130 · interrupted`、打断后存活、多行单帧、伪 OSC marker `exit 0`、pty stdin、reconnect） | 9 | ✅ | |
| D BYO-PTY（建、无 spawn 复用、同源 spawn notice、异源 `E_LABEL_CONFLICT`、docker spawn、自愈重连、`byop:lab.2_x` 字符集、status、roster 渲染、裸名 `alpha`/`beta` 末位命中） | 10 | ✅ | 结果字段一律 `· byop:<label>` |
| E 守卫（`E_BAD_LABEL`×2、`E_BAD_MODE`、`E_NO_SESSION`、`E_PARAMS`×2、`E_STDIN_WITHOUT_CMD`、`E_BAD_TIMEOUT`、schema 拒 `mode:"bogus"`） | 9 | ✅ | 全部 fail-loud，提示形状均为 `byop:<label>` |
| F 路由/撞名（`alpha`+`mode:oneshot` 逃逸、`corti`→docker、`ctr-1`→ssh） | 3 | ✅ | 优先级 ssh→docker→incus→池内 pty→ssh 兜底一位不挪 |
| G 双 agent 隔离 | 2 | ⚠️ | 寻址 ✅ / roster ❌（F4） |
| **未重跑** | 3 | — | oneshot 30k 帽、pty 30k 帽、4M 环形帽：`oneshot.ts` / `tailWindow` / `nonce-framing.ts` 本轮未改，§四 的 live 证据仍有效 |

**改名破坏性观察**：旧写法的 `{target:"pty:alpha", spawn:…}` 现在**不再**是 PTY 选择器——`pty:alpha` 落裸名解析 → ssh 兜底，且 `spawn` 与它同席时报 `[E_PARAMS] spawn requires a "byop:<label>" target`。属未发布 API 的干净改名（无兼容包袱），但 prompt / 文档 / 记忆里所有 `pty:` 字样需同步。

### 9.5 单测 / 类型（v2）

```
npx vitest run test/remote/   →  Test Files 11 passed (11) · Tests 92 passed (92)
npx tsc --noEmit              →  exit 0
```

较 v1 的 89 例 +3（覆盖 F1 `displayKey` 与 F2 出池/重建）。

### 9.6 附 A：`remote` 工具的 JSON Schema（权威版，由 `defineTool` 实构）

生成方式：以 stub driver 调 `createRemoteTool()`，序列化 `ToolDefinition.parameters`（编译后的输入 schema）与 `.output.schema`（字面声明）——`npx tsx .scratch/remote-schema-dump.ts`。

```json
{
  "name": "remote",
  "parameters": {
    "type": "object",
    "properties": {
      "target": { "type": "string", "description": "Single entry point. Bare name / IP / domain matches in order: ssh config, then docker, then incus, then a live pty label (a collision goes to the earlier source). \"byop:<label>\" / \"docker:<name>\" / \"incus:<name>\" / \"ssh:<name>\" force a channel. For \"byop:<label>\", pass spawn the first time to create it and omit spawn afterwards to reuse it. Omit cmd → status probe." },
      "spawn": { "type": "string", "description": "Only valid together with a \"byop:<label>\" target, and required the first time that label is created: …" },
      "cmd": { "type": "string", "description": "One raw shell string parsed by the remote bash (multi-line = one compound; exit = last command's). Omit with target → status probe; omit everything → roster." },
      "mode": { "type": "string", "enum": ["oneshot", "pty"], "description": "… A \"byop:<label>\" target locks mode to 'pty'." },
      "stdin": { "type": "string", "description": "Input fed to the command. oneshot: piped to stdin. pty: written right after the command line (REPL-style) — only helps commands that read stdin there. Requires cmd." },
      "timeout": { "type": "number", "description": "Per-command timeout in seconds (default 120, row-configurable). pty: Ctrl-C first, then kill; an interrupt does not kill the session." }
    }
  },
  "output": {
    "type": "object",
    "additionalProperties": false,
    "required": ["kind", "text"],
    "properties": {
      "kind":       { "type": "string", "enum": ["exec", "status", "roster"] },
      "text":       { "type": "string" },
      "exit":       { "oneOf": [{ "type": "integer" }, { "type": "null" }] },
      "durationMs": { "type": "integer" },
      "cwd":        { "type": "string" },
      "stderr":     { "type": "string" },
      "timedOut":   { "type": "boolean" },
      "reconnected":{ "type": "boolean" },
      "truncated":  { "type": "integer" },
      "session":    { "type": "string" },
      "notice":     { "type": "string" }
    }
  }
}
```

（输入面的 description 为节省篇幅有截断，`spawn`/`mode` 两条完整原文见 §一 与 §9.1；文档字符串的逐字全文在 `better-dsh/src/remote/tool.ts`。）

**schema 面的两个结构性事实**（值得记）：

1. **输入参数是隐式开放对象**：编译结果只有 `type: "object"` + `properties`，**没有 `required` 数组、也没有 `additionalProperties: false`**。原因是 `remote` 的六个参数确实全部可选（`{}`=roster、`{target}`=status、`{target,cmd}`=oneshot）；「哪个组合合法」由 `execute` 内的三闸守卫（`E_PARAMS` / `E_STDIN_WITHOUT_CMD` / `E_BAD_MODE`）在**运行期**表达，schema 只能表达单字段约束（`mode` 的 enum）。
2. **输出面相反，是封闭且必填的**：`additionalProperties: false` + `required: ["kind", "text"]`——与 `defineTool` 的 `output.schema` 必须显式声明开放性的契约一致（`output` 里每个属性写 `required: true` 就被投影进 `required` 数组）。

### 9.7 复核轮结论

- **F2 关闭**（出池 + label 自由，两个 spec Scenario 都实测通过）；**F1 的键泄漏关闭、native-cause 残留降为 low**；**新记 F4（roster 未按 agent 过滤）**。
- 43 项重跑全过；92/92 单测；`tsc` 0 错。
- 与 v1 相同的发布纪律仍然适用：**未提交工作树**，不构成 publish 前置条件。

---

## 十、增量复核 v3（2026-10-03 19:17–19:26 +08:00）— **只测改动面**

用户裁决：本轮只测有调整的面，不做全量回归。

### 10.1 范围声明与基线可及性

**不重跑**（附理由，不含糊带过）：

| 不重跑项 | 理由 |
|---|---|
| oneshot 三 transport 矩阵 / `exit 42` / stdin / 原生错误透传 | `oneshot.ts` / `transports.ts` / `target.ts` 本轮零改动（mtime 停在 09-24） |
| 30k 输出帽（oneshot + pty 两处）、4M pty 环 | oneshot 帽在 `oneshot.ts`；pty 帽与 **4M 环都在 `pty-session.ts`（`OUTPUT_HARD_CAP` L45，采集处 L110/L111）**；帧协议在 `nonce-framing.ts`。本轮三者均未触碰采集/帽子路径（`pty-session.ts` 的改动是 v2 轮的 init 失败出池，与本面无关）；v1/v2 活体证据仍有效 |
| pty 多行 / OSC 免疫 / `exit 130` / 重连 | 同上，本轮无差异被触发 |
| idle TTL 600s 现场回收 | 仅单测覆盖（§9.5），本轮仍不现场验证 |

**基线可及性声明（方法学）**：§9.1 记录的 §九 被测物 `ca292402…` 已在本轮被同路径同版本号覆盖，**无法逐字节 diff**。因此本轮 delta 不靠「两包对差」推出，而由三条独立证据合成：① 源文件 mtime（`driver/roster/tool.ts` 19:17 一批、两个 spec 19:17:48）与工作树 vs `HEAD` 的 diff；② 本轮新增/改写的单测所固定的契约；③ `docs/specs/remote-pty-label/spec.md` 19:18:00 的 Requirement/Scenario。每个 delta 项的「改动前」状态取 §一–§九 已记录的旧行为，逐条对照，不做无法证实的字节级断言。

### 10.2 被测身份

| 项 | 值 |
|---|---|
| 源码树 | `better-dsh` @ `5aa48ea` + 未提交工作树（8 文件 +397/−61，含根 `AGENTS.md` 2 行） |
| 构建产物 | `better-dsh/lib/remote/plugin.js` 19:18:41，md5 **`ecc5fd44f6ac5753b3edbdd0d0bf4371`** |
| 交付包 | `.scratch/better-dsh-0.2.5-b+byop.tgz` 19:18:52 → profile 装入 19:18:58，**md5 与构建产物一致** |
| rig | 4999 于 19:19:01 以该装入物重启（本轮第 4 个 boot token `GeAQIRcl…`），插件池冷启 |
| 身份证据 | 构建产物与 rig 装入物 **md5 相等**（`ecc5fd44…`），且 unit `ActiveEnterTimestamp=19:19:01` 即加载该装入物的那次 boot。<br>（附注：`{spawn, cmd}`（无 target）返回 `E_PARAMS` 只能区分 HEAD 与 v2+——该组合自引入 label 选择器那一轮起就是 `E_PARAMS`，见 §四.E 行 E5——**不能**区分 v2 与 v3，故不作为本轮身份证据。） |

### 10.3 delta 矩阵（26 项，全部第一人称在 4999 活体执行）

| # | 调用 | 本轮期望 | 实测 | 结论 |
|---|---|---|---|---|
| A1 | `{spawn:"bash", cmd:"echo hi"}`（无 target） | `E_PARAMS`：spawn 降格为修饰符，非独立入口 | 同（报文含 `spawn requires a "byop:<label>" target`） | ✓ 新行为（旧=直接建会话） |
| A2 | `{target:"dev4", spawn:"bash", cmd}` | `E_PARAMS`：spawn 仅配合 `byop:` | 同 | ✓ |
| A3 | `{target:"byop:", spawn:"bash", cmd}` | `E_BAD_LABEL` | `…label must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (got "")` | ✓ |
| A4 | `{target:"byop:has space", …}` | `E_BAD_LABEL` | 同型（`got "has space"`） | ✓ |
| A5 | `{target:"byop:lab3", spawn:"bash", cmd, mode:"oneshot"}` | `E_BAD_MODE`：锁 pty | `"byop:lab3" is a PTY selector — mode is locked to 'pty'` | ✓ |
| B1 | 建 `byop:d1`（spawn `bash`；`cd /tmp`） | 建成，退出行带 `· byop:d1` | `[exit 0 · 0.0s · cwd /tmp · byop:d1]` | ✓ 新 `session` 字段渲染在位 |
| B2 | 复用 `{target:"byop:d1", cmd}` | env/cwd 存活、无 notice | `live` + `/tmp`，无 notice | ✓ |
| B3 | 同 label **重复给同一 spawn** | 复用 + `notice` 教学行 + 仍执行 | notice 行「already runs that exact command…」+ `live` | ✓ 新 `notice` 字段 |
| B4 | 同 label 给**不同** spawn（`bash -l`） | `E_LABEL_CONFLICT`，零执行 | 四行冲突报文（existing / given / To reuse / To start new） | ✓ |
| B4v | B4 之后读 `$MARK3` | 仍 `live`（未被 clobber） | `MARK3=[live]` | ✓ 冲突确实没跑命令 |
| B5 | 未知 label 复用 | `E_NO_SESSION` + Create it 形态 | 同 | ✓ |
| B6 | 未知 label status | `byop:never — BYO pty session` + `session: none — no live PTY under this label` | 同 | ✓ 零拨号 |
| B7 | 活 label status | `session: idle 0s (connected)` | `byop:d1 — BYO pty session` + 同 | ✓ |
| C1 | 建 `byop:bareX` 后以**裸名** `bareX`（未指定 mode）跑 | 命中候选表末位 PTY：懒复用成立 | `baremark`，退出行 `· byop:bareX` | ✓ 新候选 |
| C2 | 裸名 `bareX` + `mode:"oneshot"` | 不吃末位候选，走 ssh 兜底原生错误、无 `session` 标记 | `[exit 255 · 0.0s]` + `ssh: Could not resolve hostname barex…`，无 pty 标记 | ✓ 旧行为逐位保留 |
| C3 | 裸名 `bareX` status | 同样落到 PTY 候选 | `byop:bareX — BYO pty session` + idle | ✓ status 与 exec 同一张候选表 |
| D1 | 我（sessionKey A）建 `byop:d1`/`byop:bareX` 后空调用 | 只列我的会话 | `live pty sessions: byop:d1 [ready, idle 4s], byop:bareX [ready, idle 13s]` | ✓ |
| D2 | 子 agent 建 `byop:subdelta` **之后**我再空调用 | 仍只列我的两条，**不含 subdelta** | 同上（读数 11s / 24s） | ✓ **即 F4 的反证** |
| D3 | 子 agent 空调用 | 只列 `byop:subdelta`，不含我的两条 | `live pty sessions: byop:subdelta [ready, idle 1s]` | ✓ |
| D4 | 我寻址 `byop:subdelta` | `E_NO_SESSION` | 同 | ✓ |
| D5 | 子 agent 寻址 `byop:d1` / `byop:bareX` | 双向 `E_NO_SESSION` | 两条同型报文 | ✓ 隔离是双向的 |
| D6 | 静态三段（ssh/docker/incus）双侧 | 全局可见、内容一致 | 双方各自列出同一 ssh hosts / docker / incus 三段 | ✓ 设计内（静态公共配置） |
| E1 | 重生成权威 JSON Schema（`.scratch/remote-schema-v3.json`） | 输出面 **9→11** 属性；`required` / `additionalProperties` 不变；输入面不变 | 见 §10.4 | ✓ |
| E2 | `npx vitest run test/remote/` | 全绿 | 11 文件 / **94 tests passed**（§九 基线 92，+2） | ✓ |
| E3 | `npx tsc --noEmit` | 0 错 | exit 0 | ✓ |
| E4 | status 回归抽查（改动行 `resolveBareName` 换了返回型） | ssh / docker 两分支照旧 | `dev4 — ssh host` + probe + `session: none — dials on first exec`；`corti — docker container` 同型 | ✓ |

### 10.4 关键证据（verbatim）

```
# A1 —— spawn 不再是入口（同时是本轮活体身份自证）
[E_PARAMS] remote: spawn requires a "byop:<label>" target — e.g. { target: "byop:dev3", spawn: "ssh dev3", cmd: "…" }; it is not a standalone entry point

# B3 —— 同 spawn 重复：notice 行（新字段）在前，命令照跑
[remote: byop:d1 already runs that exact command and is persistent — reuse it with { target: "byop:d1", cmd: "…" }; spawn is only needed to create.]
live

[exit 0 · 0.0s · cwd /tmp · byop:d1]

# B4 —— 异 spawn 冲突：零执行
[E_LABEL_CONFLICT] remote: byop:d1 already exists and was created by a different command — nothing was run.
  existing spawn: "bash"
  given spawn:    "bash -l"
  To reuse it:    { target: "byop:d1", cmd: "…" }   (drop spawn — spawn only ever creates)
  To start new:   pick another label, e.g. { target: "byop:d12", spawn: "bash -l", cmd: "…" }

# C2 —— 显式 oneshot 的逃生门：不吃末位候选，旧行为逐位保留
[exit 255 · 0.0s]
[stderr]
ssh: Could not resolve hostname barex: Temporary failure in name resolution
```

双侧 roster（D2 / D3，同一时刻、同一进程、不同 agent session）：

```
# 我（sessionKey A）——D2：子 agent 的 byop:subdelta 已在池中，但不在我的名单里
ssh hosts (~/.ssh/config): github.com, dev2, dev3, mac, dev1, 137.131.54.174, dev4, ctr-1
docker containers: corti (running), jellyfin (running)
incus containers: ctr-1 (RUNNING)
live pty sessions: byop:d1 [ready, idle 11s], byop:bareX [ready, idle 24s]

# 子 agent（sessionKey B）——D3：看不到我的两条
live pty sessions: byop:subdelta [ready, idle 1s]
```

E1 输出面（`remote-schema-v3.json`，11 属性 + `required`/`additionalProperties` 不变）：

```json
{ "type": "object", "additionalProperties": false,
  "properties": { "kind": {"type":"string","enum":["exec","status","roster"]}, "text": {"type":"string"},
    "exit": …, "durationMs": …, "cwd": …, "stderr": …, "timedOut": …, "reconnected": …, "truncated": …,
    "session": { "type": "string" }, "notice": { "type": "string" } },
  "required": ["kind", "text"] }
```

（输入面与 §9.6 一致：6 属性、**无 `required`**、无 `additionalProperties`——合法性仍由运行期守卫表达。）

### 10.5 F4 关闭

§9.3 记的 F4（roster 不按 agent 作用域过滤，low–medium）**关闭**：

- **实现**：`roster()` 以 `${sessionKey}|` 前缀过滤池，名字渲染收敛到单一定义 `displayKey(key)`；`ssh/docker/incus` 三段保持全局。
- **活体双侧反证**：D2 —— 子 agent 的 `byop:subdelta` 是**活会话**（其 roster 自见），而我的 roster 在同一时刻不含它；D5 —— 双向寻址皆 `E_NO_SESSION`。这正是 §9.3 记录的失败场景（当时我的名单里出现了别人的 label）在本轮的对照复现。
- **spec 同步**：`spec.md` 19:18:00 已含 `Requirement: roster 的活性面按 agent session 作用域`，并把「静态公共配置 vs 操作环境」的取舍写进理由，与实现逐条对齐。

### 10.6 观察与残留

- **F1（native-cause 残留，low）**：维持——本轮未触碰该段（init 期 pty 输出走 stdout、`diag` 只捞子进程 stderr）。
- **F3（裸名遮蔽，设计内）**：不变，且本轮把它的边界钉得更死——PTY label 只在候选表**末位**参与（C1/C3），撞名时 ssh/docker/incus 仍胜出；spec Scenario 明写「命中顺序即优先级」。
- **观察·构建卫生（附注不入发现账）**：仓库根 `better-dsh/better-dsh-0.2.5-b.tgz`（36,833 B，mtime 19:01:14）包内 `lib/remote/plugin.js` 是 **pre-refactor（spawn 键时代）** 产物——`byop:` 命中 0、`startsWith('pty:')` 命中 0（label 选择器从未发布过，故本就不该有）。**这是正确状态而非陈旧物**：它是 `5aa48ea "release 0.2.5-b"` 提交的、**被 git track 的发布记录**（`git check-ignore` 不忽略、`git ls-files 'better-dsh/*.tgz'` 列出五个、`git log -1 -- <file>` 指向该 release commit）；mtime 19:01:14 来自一次 `git checkout --` 还原，不是 pack 时间。本轮 rig 的真实交付包装是 `.scratch/better-dsh-0.2.5-b+byop.tgz`（见 §10.2），二者各司其职——**不得重 pack 或删除仓库根那一份**。<br>（附注仍成立：`better-dsh` scripts 无 `prepack`，`npm pack` 只打包当下 `lib/`、不重建。）
- **观察·产品面（信息）**：退出行的 `· byop:<label>` 标签对**显式** `byop:` 调用是冗余（target 本就是模型写的），对 C1 那种**裸名懒复用**才是承载信息——它把「以为在打 ssh、实际落到 PTY」显式化。记录，不建议改。
- 未重跑项与理由见 §10.1。

### 10.7 结论

- 本轮 delta 的四个面（`spawn` 降格 / `byop:` status 零拨号 / 裸名末位 PTY 候选 / roster 调用方作用域）+ 输出结构面（`session`、`notice` 两字段）**全部实测通过：26/26**；`test/remote/` 94/94、`tsc` exit 0。
- **F4 关闭**；spec 与实现同步（19:18:00 的 spec 已覆盖三条新契约），无文档漂移。
- 发布纪律不变：本轮仍是**未提交工作树**，实测通过 ≠ 放行，**不构成 publish 前置条件**（AGENTS.md §〇：需 user 明确单次授权）。

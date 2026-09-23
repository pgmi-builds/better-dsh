# Remote 执行框架（`remote` 工具）4986 第一人称实测报告

- **日期**: 2026-09-23
- **分支**: `remote-framework`（worktree `.worktrees/remote-framework`，基 `main` @ e9061b8）
- **代码范围**: `better-dsh/src/remote/*`（nonce-framing / target / transports / oneshot / pty-session / driver / status / tool / plugin，9 模块）+ 三处接线（exports `./remote`、tsdown entry、cordis.patch.yml `dashr-remote` 行）
- **对照设计**: `docs/10_plans/2026-09-23-remote-execution-framework.md`（spec 权威）+ 实施计划 `docs/10_plans/2026-09-23-remote-framework-impl.md`（含 Rulings P1–P14）
- **第一人称载体**: `dsh --profile headless`（真实运行时 session、真实 LLM、真实工具派发；9 次 headless 运行覆盖 18 case 矩阵）

## 一、环境与部署

- Dev/Test 1：monorepo `upstream/deepseek-harness`（dsh-v0.1.6-alpha.2 基线 + 仓内 patch）；canonical src 自 worktree rsync，devDeps 手术 14× workspace:* 照旧重打。
- **零新增依赖**：本框架纯 `node:child_process` / `node:crypto` + 系统 CLI（ssh / docker / incus / util-linux script）——RM0 的 ssh2 native 依赖面不存在。
- 构建：`pnpm --filter better-dsh exec tsdown` + `tsx scripts/build-client.ts`（lib/client 清洗陷阱照旧）；`lib/remote/plugin.js` 产出。
- 实例：`PORT=4986 bash .tests/dsh-test1/start-4999.sh`（unit `dsh-4986-test`，boot 走构建产物 `apps/cli/lib/bin.js` + 裸 node——双平面红线遵守）。
- 配置面：`web --dump-config`（产物 bin）确认 `dashr-remote` 行入组合（`- id: dashr-remote / name: better-dsh/remote`，紧随 better-dsh/mobile）。
- 别名路由（case 9）：test home 层 `cordis.patch.yml` 追加 `dashr-remote` 行重述 + `config.containers.{"ctr-1": "incus:ctr-1"}`——**行重述覆盖机制真通**（home 层 config 覆盖 bundle 层默认）。验收后已清理还原。

## 二、18 case 验收矩阵（全部 ✅）

| # | case | 证据（第一人称 verbatim 摘录） | 判定 |
|---|---|---|---|
| 1 | ssh oneshot 基础 | `{dev4, echo ok && git --version}` → `CASE1: 0 \| ok / git version 2.43.0` | ✅ |
| 2 | 退出码透传 | `{dev4, exit 42}` → `CASE2: 42`（二进制退出码，零字符串扫描） | ✅ |
| 3 | 复合语法（管道+变量） | `{dev4, ls / \| head -2 && echo $HOME}` → `bin / bin.usr-is-merged / /home/u1` | ✅ |
| 4 | pty 状态保持 | cd /tmp + export F=1 → 次 turn `pwd && echo $F` → `/tmp` + `1`，`cwd=/tmp` | ✅ |
| 5 | 多行单帧 | `"echo a\necho b"`（单串含换行）→ 一帧 `a\nb`，exit 0 | ✅ |
| 6 | 伪 marker 免疫 | 打印静态 `\033]133;D;deadbeef…;99` → exit **0**（非 99）、输出含 real、流无截断（agent 转打时引号被 shell 搅碎成 command-not-found 噪音——帧判定不受影响，更狠的实证） | ✅ |
| 7 | pty 超时打断 | `sleep 300` timeout 2 → `exit 130 \| interrupted \| 2.3s`（P8 两段打断在真 `ssh -tt` 上成立）；随后 `echo alive` exit 0 **会话存活** | ✅ |
| 8 | incus oneshot | `{incus:ctr-1, cat /etc/os-release \| head -1}` → `Ubuntu 26.04 LTS` | ✅ |
| 9 | incus pty + 别名路由 | 显式前缀 pty `cd / && pwd` → `cwd=/`；裸名 `ctr-1` → 路由进容器（`via-alias / ctr-1` hostname 证实）——别名优先于 ~/.ssh/config 同名 Host | ✅ |
| 10 | docker oneshot | `{docker:dashr-remote-t1, …}` → `in-docker / Ubuntu 24.04.5 LTS` | ✅ |
| 11 | docker pty（script 托管） | `cd /root && pwd` → `cwd=/root`（util-linux `script -qfec` 宿主 PTY + 远端 init 双层静默成立） | ✅ |
| 12 | BYO-PTY spawn | `{spawn:"docker exec -it dashr-remote-t1 bash", cmd:"echo spawned && hostname"}` → `spawned / 728e1cf8a10e` | ✅ |
| 13 | 错误透明 | ssh：`ssh: Could not resolve hostname no-such-host-xyz: Temporary failure in name resolution`（exit 255）；docker：`Error response from daemon: No such container: no-such-ctr`（exit 1）——原生 stderr 逐字 | ✅ |
| 14 | 断联自愈 | `kill -9 $$` → exit null；次调用 → 首行逐字 `[remote: session reconnected to fresh shell; cwd reset to default]` + `back` + `cwd /home/u1`（归默认） | ✅ |
| 15 | 后台输出 Non-Goal | `nohup sleep 5 >/dev/null 2>&1 & echo bg-ok` → 输出恰 `bg-ok`、stderr 空、零噪声（使用者重定向职责示范成立） | ✅ |
| 16 | status 可达探测 | `{dev4}`（无 cmd）→ `probe: reachable in 3193ms (just now, on demand)` + `session: none — dials on first exec`；**全文无 "offline"**（agent 明确确认） | ✅ |
| 17 | status 会话层 | pty 用过之后 → `session: idle 4s (connected)`（user 裁决的 idle 语义：连接在、无 activity） | ✅ |
| 18 | status 容器事实/错误 | `{docker:no-such-ctr}` → `probe: error — error: no such object: no-such-ctr`（docker 原生文本透传） | ✅ |

**审计抽查** ✅：headless session log（`session-5628b047…`）含结构化 `dashr/remote-exec` 事件 3+ 条/会话——`{target, cmd, cwd, exit, durationMs}`（含中断记录：`sleep 300 → exit 130, 2260ms`）。

## 三、四层模型映射核对

| spec 层 | 实现 | 证据 |
|---|---|---|
| L2 Bash One-shot（选定） | `ssh -o BatchMode=yes -T / docker exec -i / incus --force-noninteractive` + `bash -lc`，退出码即收尾 | case 1-3, 8, 10, 13 |
| L4 Assisted PTY（选定） | `ssh -tt` / `incus --force-interactive` / `script -qfec`（docker+spawn）+ nonce 收帧 | case 4-7, 9, 11, 12, 14 |
| L1/L3（拒绝） | 不存在对应代码路径 | — |

## 四、状态词汇表行为证据（user 2026-09-23 裁决）

- **禁 `offline`**：三态探测输出 + 会话层输出全程缺席（agent 被直接问及并明确否认）。
- reachable / unreachable / 容器事实态 / error + `idle Ns` / `busy` / `none — dials on first exec` / `died` 全部按 Ruling 16 渲染。
- **on-demand 双重超时**（Ruling 17）：探测在调用瞬间执行（"just now, on demand" 标注）；本矩阵全部真目标秒回，超时上限（5s/10s）未触发——由单测覆盖（`probe timed out after 10s` 标签路径）。
- 对比 RM0 时代的歧义（agent reasoning log 里纠结 "offline 是什么"）：本轮 agent 零困惑、零多余 verify 尝试。

## 五、Non-Goal 三条行为证据

1. **后台输出不隔离**：case 15 使用者显式重定向 → 输出干净；未重定向的后台进程按 POSIX 会话语义自然出现在流里（工具不清洗）。
2. **不重建 shell 内存状态**：case 14 重连后 cwd 归默认 + 明示提示行——由 Agent 上下文决定是否 cd 回去。
3. **不暴露终端微调**：行列固定 40×120 烤进 init（无任何参数面）。

## 六、真实观察（不阻塞，记录在案）

- **oneshot 会等 ssh 会话通道收尾**：case 15 中 `nohup sleep 5 >/dev/null 2>&1 &` 后调用持约 16.6s 才返回（远超 echo 即出的 bg-ok）——OpenSSH 会话通道语义（sshd 等会话内全部进程释放 fd），非本工具缺陷；agent 需要"发射后不管"时应加 `timeout` 或 `setsid` 全脱钩。工具侧如实等待（错误透明原则），描述文本可后续补一句披露。
- status probe 的 rtt 含 ssh 全握手（LAN 约 3.2s——含 DNS/KEX）；纯 TCP rtt 需另设基准，非本期范围。
- dev4 无 docker，嵌套穿透（spec 场景 3 范式 A/B 的 ssh -t 嵌套 docker）未在本矩阵覆盖——spawn 通道（case 12）已证 BYO-PTY 机制本身；嵌套留待有嵌套环境时补测。
- pty 模式 stdout/stderr 合流（spec §4.2 诚实代价）；oneshot 分离保留。

## 七、测试基线

- worktree 单测：`test/remote/` **9 spec 69/69**（nonce 13 / target 5 / transports 9 / oneshot 6 / pty-session 13 / driver 6 / status 7 / tool 7 / plugin 3）。
- 全量 vitest（worktree）：恰为基线 14 失败（url-schemes 2 + surface-devices/agent-family 12，皆先在、与本特性无关），577 通过 + 1 skip，无新增失败。
- `tsc --noEmit`：14 既有错误（同基线集合），remote/* 0 新错。

## 八、遗留（后续里程碑候选）

- RM2 线：forward / tmux 驻留 / WebUI 终端面板（本框架 Non-Goal 边界外）。
- `ws://` transport（spec §二.2 远期）。
- status 的 `unreachable` 真机路径（断网/防火墙 DROP 场景）只有单测证据，真机矩阵未覆盖（需临时断 dev4）。
- 描述文本补一句 oneshot 会话通道持留语义的披露（§六 第 1 条）。

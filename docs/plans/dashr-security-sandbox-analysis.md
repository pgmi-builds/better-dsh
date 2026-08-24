# DASHR 安全风控分析：kernel subprocess 沙箱边界穿透

> 日期：2026-08-17
> 范围：`dashr/`（`dashr-code-runtime-ipython`）provider 的持久 IPython kernel 子进程
> 关联：`dashr-blueprint.md` §5 风险登记「沙箱边界穿透」条目
> 性质：实测证据链 + 风险升级建议
> 对照：§4 为同一宿主机上 Claude Code 运行时的同探针对照样（2026-08-17）

## 1. 结论先行

blueprint §5 已登记「沙箱边界穿透（kernel 内 pip/网络不受 dsh sandbox 管）」为**中**风险，
缓解措施「kernel 启动参数收窄 + dsh sandbox 对 kernel 子进程整体套用」标记 M2/M3。

2026-08-17 实测证实：该风险**不仅尚未落地缓解，实际暴露面远超原评估**。kernel
子进程当前是**零隔离**的宿主机特权执行体——任意文件读写 + passwordless sudo 提权。
建议风险等级从「中」上调为「高」，并给出分层的可落地方案（§5）。

同日对照实测（§4）：同一宿主机上的 Claude Code 运行时，其模型代码执行体的暴露面与
本 provider kernel 路径**完全等同**（同一 init mount namespace、workspace 外可写、
`sudo -n true` 通过）——权限继承是普遍事实，任何 Agent 运行时都面对；两者差别仅在
沙箱的**覆盖方式**（dsh：漏了 kernel 通道）与**启用状态**（CC：有能力未开启）。

## 2. 实测证据链

测试环境：`/home/u1/workspaces/agent-harness`（dsh session），kernel 由 dsh host 拉起。

### 2.1 权限继承链（进程树实测）

```
systemd --user (pid 6820)
└─→ node (pid 3840092)      ← dsh host（DeepSeek Harness，node 进程）
     └─→ python3 (pid 3852226)   ← ipykernel_launcher，本 provider 的持久 kernel
          └─→ 任意 subprocess     ← cell 内 import subprocess 起的子进程
```

三层全以 `u1`(uid 1000) 身份运行。kernel 只是 host→脚本 之间的一层 indirection，
**没有在中间做任何权限收窄**。

### 2.2 kernel 进程的隔离状态（/proc/self/status 实测）

| 字段 | 实测值 | 含义 |
|---|---|---|
| `NoNewPrivs` | `0` | 未设 no_new_privs → **setuid 提权可用**（sudo 走通） |
| `Seccomp` / `Seccomp_filters` | `0` / `0` | 无 seccomp filter |
| `CapEff` / `CapPrm` | `0` | 无 effective/permitted capabilities（非特权进程常态） |
| `CapBnd` | `000001ffffffffff` | bounding set 基本全量，未收窄 |
| mount namespace | `mnt:[4026531832]` | **宿主 init namespace**，未进隔离 |
| 根挂载 `/` | `/dev/sdc3 ext4 rw,relatime` | 真实可写文件系统 |

对比：`tools.bash` 命令看到的根挂载是 `/dev/sdc3 ext4 **ro,nosuid,nodev**,relatime`
（`dsh` 对 bash 工具套的沙箱视图），而 kernel 进程看到的是 **rw**。

### 2.3 沙箱绕过对比测试（同一位置、同一操作）

| 路径 | 目标 | 结果 |
|---|---|---|
| `tools.bash` 写 workspace 内 | 正对照 | ✅ 成功（sandbox `mode=workspace-write, denied=false`） |
| `tools.bash` 写 `/home/u1/.probe` | 沙箱边界 | ❌ `denied=true`，stderr `Read-only file system` |
| **kernel 内 `subprocess` 写 `/home/u1/.probe`** | 绕过测试 | ✅ 成功，`-rw-rw-r-- 1 u1 u1` 真实落盘 |

### 2.4 提权可达性

`sudo -n true` 在 kernel 内 subprocess 中返回退出码 **0**——passwordless sudo 对
kernel 进程成立。结合 `NoNewPrivs=0`，kernel 内任意 Python 可 `sudo` 到 root。

## 3. 根因与定性

**权限来源**：最终权限不是 dsh 代码"授予"的，而是 dsh host 的启动环境——`u1` 用户
会话 + 系统配置的 passwordless sudo。任何以 `u1` 身份、能 spawn 子进程的程序都天然
具备同样的 sudo 能力。

**dsh 的问题不是"制造了 sudo"，而是"未在 kernel 这条不受信代码执行路径上收窄继承下来的权限"**。
dsh 对 `tools.bash` 命令套了 `ro,nosuid,nodev` 文件系统沙箱，但对 `run_cell` 交给
kernel 的 Python 代码**没有套任何隔离**——而 kernel 内 `import subprocess` / `os.system` /
`open()` 等 Python 原生能力，全部绕开 bash 工具那条沙箱路径，直接在宿主机 init
namespace 上裸跑。

**两个正交概念**（易混，需区分）：
- *权限继承*：OS 默认行为，子进程继承父进程权限——这是事实，任何框架都面对。
- *沙箱*：框架**主动**加的一层隔离，目的是打破默认继承。dsh 有该能力（bash 路径
  已用），只是**未在 kernel 路径启用**。故"沙箱限制不了脚本运行"是误读；准确说法
  是"dsh 的沙箱只覆盖了 bash 路径，漏掉了 kernel 路径"。

## 4. 对照实测：Claude Code 运行时（同宿主机，同日）

为验证 §3 的定性——**权限继承是 OS 普遍事实、沙箱是框架的主动选择**——2026-08-17
在**同一台宿主机**上对 Claude Code 运行时（本分析的撰写 session 本身）跑了一遍 §2
的同款探针。结论：CC 的模型代码执行体与 dsh kernel 路径**暴露面完全等同**，但缺失
环节的性质不同。

### 4.1 权限继承链（进程树实测）

```
systemd (pid 1, root)
└─ sshd → sshd-session（root → u1 降权）
   └─ bash (u1)
      └─ claude (pid 3911309, u1)          ← CC Agent Loop 运行时
         ├─ chrome-devtools-mcp / corti mcp_server.py   ← MCP 子进程，同权继承
         └─ bash (pid 3920593, u1)         ← Bash 工具子进程（模型代码的执行体）
```

`claude` 进程与其工具 bash 全链路 `u1`(uid 1000)，无任何收窄——与 §2.1 同构。

### 4.2 隔离状态与绕过测试（对照 §2.2–§2.4）

| 指标 | CC：`claude` / Bash 工具 | dsh kernel（§2） | dsh `tools.bash`（§2.2 对比） |
|---|---|---|---|
| `NoNewPrivs` | **0** | 0 | — |
| `Seccomp` | **0** | 0 | — |
| `CapBnd` | `000001ffffffffff`（全量） | 全量 | — |
| mount namespace | **`mnt:[4026531832]`（宿主 init ns）** | init ns | 隔离视图 |
| 根挂载 | **`/dev/sdc3 ext4 rw`** | rw | `ro,nosuid,nodev` |
| 写 workspace 外 | **✅ `/home/u1/.cc-probe-outside` 落盘**（已清理） | ✅ 落盘 | ❌ DENIED |
| `sudo -n true` | **exit 0** | exit 0 | — |

CC 实测的 mount namespace inode 与 dsh kernel **完全相同**（`4026531832`）——两者是
同一宿主 init namespace 里的裸执行体。

### 4.3 差异定性：为什么暴露面等同，问题却不同

| | dsh（kernel 路径） | CC（本环境实测） |
|---|---|---|
| 模型代码执行引擎 | **两个**：bash 工具 + 持久 kernel | **一个**：Bash 工具 |
| 执行路径上的策略点 | kernel 路径**无任何过滤**（`run_cell` 不过 bash 策略层） | 必须过 Bash；PreToolUse hook 管道（matcher `*`）+ 权限模式都在路上 |
| OS 沙箱 | bash 路径已套 `ro` 视图；**kernel 路径漏配** | **能力在、未启用**：`/usr/bin/bwrap` 已安装，settings 无 sandbox 配置 |
| 当前暴露面 | u1 + passwordless sudo | **等同** |
| 问题定性 | **架构覆盖缺口**（第二条执行通道漏掉沙箱） | **配置未启用**（开关没开） |
| 修复成本 | 需给 kernel spawn 工程化加隔离（§5） | 改配置 |

两点在对照中验证出的一般规律（对任何 Agent 运行时成立）：

1. **权限继承不可选择**：`claude` 与 dsh host 一样，没有"授予"子进程权限——权限
   来自启动环境（`u1` 会话 + 系统 sudo 配置），运行时能做的只有**是否收窄**。
2. **策略点 ≠ 隔离**：本 session Bash 通道上有 ECC GateGuard（首条命令要求陈述
   事实 + 破坏性模式黑名单），实测其拦得住流程失误、拦不住权限——补两句事实
   陈述后同一条探针原样放行，落盘 + sudo 全部走通。hook 是**流程门**，不是
   **硬边界**；硬边界只有 OS 级沙箱。误读警示：被 hook 拦住恰说明该通道**在**
   策略层覆盖内，而非存在绕开策略层的裸通道——dsh kernel 的问题才是后者。

### 4.4 对本分析结论的影响

CC 的对照不改变 §1 的风险升级建议（dsh kernel 暴露面实测为零隔离，仍应升「高」），
但补充一个事实：**"运行时自带沙箱能力"不等于"暴露面受控"**——CC 与 dsh 代表了
两种典型的失效模式（未启用 vs 未覆盖），落地 §5 方案时两者都需以实测探针（§2/§4.2
这张表）做验收，而非以"沙箱已配置"自证。

## 5. 风控措施（分层，业界对照 + dashr 落地）

业界对"执行不受信代码"默认隔离，从轻到重三层（参考 AgentPatterns sandbox-runtime
对比、Modal/Northflank 2026 沙箱综述）：

| 层级 | 机制 | 代表 | 对 dashr 的落地点 |
|---|---|---|---|
| OS 级（轻） | NoNewPrivs + drop cap + seccomp filter + mount ro | Claude Code Bash sandbox（bwrap/Seatbelt） | spawn kernel 时套用，改动最小 |
| 容器（中） | Docker / containerd | OpenInterpreter Docker 模式 | 包住整个 host 或 kernel |
| microVM（强） | Firecracker / Cloud Hypervisor | e2b / Modal / Devin | 每执行环境一个轻量 VM，重 |

针对 `dashr/` provider（spawn `ipykernel_launcher` 处）的**最小可用收窄**，按
blueprint §5 原缓解「kernel 启动参数收窄」落地：

1. **`NoNewPrivs=1`**：Node `spawn` 后经 wrapper 设 `PR_SET_NO_NEW_PRIVS`，直接阻断
   setuid（含 sudo）提权——性价比最高的一条。
2. **drop capabilities**：收窄 `CapBnd`，禁 `CAP_SYS_ADMIN` 等；配合 NoNewPrivs。
3. **seccomp filter**：默认 deny + 白名单 IPython 所需 syscall（zmq/socket/exec 等）。
4. **mount namespace 隔离**：复用 dsh 对 bash 的 `ro,nosuid,nodev` 视图——kernel 只
   对 workspace 挂 `rw`，其余 `ro`。
5. **资源限制**：rlimit（CPU/内存/fork 数），防 fork bomb / 内存风暴。
6. **网络隔离**：对应原条目「pip/网络」——net namespace 或策略路由，默认无外网、
   白名单 pip 源。

以上 1–4 组合即可把 kernel 从"宿主机特权执行体"降到"受限执行体"，且不牺牲
「持久 namespace」的核心价值。

## 6. 建议后续动作

1. blueprint §5「沙箱边界穿透」条目：风险等级「中」→「高」，暴露面描述从
   「pip/网络」扩为「任意文件读写 + sudo 提权」，状态 M2/M3 → 未落地（实测证实）。
2. 排入 M4/M5 里程碑：优先落地 §5 的第 1 项（NoNewPrivs），成本最低、收益最大。
3. 补回归测试：kernel 内 `sudo -n true` 应失败、写 workspace 外应失败、`/proc/self/status`
   的 `NoNewPrivs=1` 断言。
4. 本轮实测的完整交互记录（unified tool path、`dashr.host` comm 桥、ro 挂载对比、
   sudo 探测）已存档于 session memory（Corti）。

---

*本文档为实测驱动的安全分析，非 milestone 交付报告；与 `upstream-analysis.md`、
`dashr-blueprint-review.md` 同层，供 blueprint §5 风险条目升级引用。*

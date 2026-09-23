# Remote 执行框架与统一工具规范（全新阶段设计与开发计划）

- 创建日期：2026-09-23
- 阶段定位：下一代 Remote 执行工具设计规范（从单一专用 `ssh` 升维至通用 `remote`）
- 核心导向：**思维模型引领、双轨极简收敛、严守职责边界、拒绝无限缝补**

---

## 零、 痛点与设计宗旨

过去在执行层面由于缺乏顶层思维模型，常常陷入“看到一个 edge case 就钻进去无休止打补丁”的陷阱：
- 把 POSIX 终端的正常物理现象（如后台进程输出未重定向）误当成工具缺陷去搞复杂的流隔离；
- 把网络或进程断开后由 Agent 自然消化（读文件系统继续干活）的常态，误当成必须耗费 300% 复杂度去 100% 还原会话内存的死磕目标；
- 把单一的 `ssh` 工具与底层通信协议、执行模式死死耦合在一起。

**本阶段核心宗旨**：
1. **思维模型先行**：建立清晰的四层执行模型，把通用计算与控制复杂度正交拆开；
2. **两极收敛（Two-Track）**：One-shot 与 Persistent 各取其一，拒绝提供一堆让用户和 Agent 困惑的冗余选项；
3. **把边界焊死（Strict Non-Goals）**：工具只负责建立可靠通道和精准收帧，不越俎代庖去替进程和模型擦屁股。

---

## 一、 第一性原理：四层底层执行模型（4-Layer Execution Model）

在 Linux / Unix 世界里，任何对目标环境的命令执行，在底层本质上精确划分为四个层次：

```
┌────────────────────────────────────────────────────────────────────────┐
│                        4-Layer Execution Model                         │
├────────────────────────────────┬───────────────────────────────────────┤
│ 1. Execute One-shot            │ 裸系统调用 execve()，直接加载二进制文件  │
│    (Raw Exec)                  │ ❌ 无管道、无变量展开、无通配符、无语法支持 │
├────────────────────────────────┼───────────────────────────────────────┤
│ 2. Execute Bash One-shot       │ 调用 bash -c "cmd string"             │
│    (Shell Interpreted Exec)    │ ✅ 支持管道、重定向、复合条件、极速且用完即退 │
├────────────────────────────────┼───────────────────────────────────────┤
│ 3. Execute Bash Interactive    │ 保持 Bash 进程常驻，通过无终端管道读写   │
│    (Pure Stream Session)       │ ❌ 无终端控制、发不了 ^C、sudo 报 no tty  │
├────────────────────────────────┼───────────────────────────────────────┤
│ 4. Execute PTY                 │ 分配物理/伪终端 (/dev/pts/X)，在内跑 Bash│
│    (Assisted PTY Session)      │ ✅ 完整终端特性、支持 ^C 打断、支持交互   │
└────────────────────────────────┴───────────────────────────────────────┘
```

### 二元取舍与收敛矩阵

这四个层次天然划分为两大阵营：**One-shot（用完即走）** 与 **Persistent（长命会话）**。

在架构设计上，**我们坚决不在每个阵营内提供冗余选项，每个类型严格各取一个最优解**：

| 阵营 | 候选层级 | 决策结果 | 取舍原因 |
|---|---|---|---|
| **One-shot 组** | 第 1 层 vs 第 2 层 | **选第 2 层（Bash One-shot）** | Agent 敲出的命令全是复合语句（含管道 `\|`、重定向 `>`、环境变量 `$VAR`、通配符 `*`）。第 1 层纯裸 exec 会导致 90% 复合语法直接报语法错误，对 Agent 毫无实用价值；第 2 层具备完整的 Shell 语法解析能力，且进程随命令结束而自然退出，由系统内核或协议层直接回传二进制退出码，**零字符串解析需求、零前后状态残留、天然支持并发并发**。 |
| **Persistent 组** | 第 3 层 vs 第 4 层 | **选第 4 层（Assisted PTY）** | 只要会话是长命的，第 3 层和第 4 层同样逃不掉“在未关闭的数据流中判定何时执行完毕”的收帧解析；但第 3 层失去了打断失控命令的 `^C`（SIGINT），且执行 `sudo` 时会因为缺少 tty 直接卡死。既然收帧成本相同，必须选功能完备、具备真实终端控制能力的第 4 层。 |

---

## 二、 工具命名与定位：从 `ssh` 升维为 `remote`

### 1. 概念解耦：Transport 协议 vs 会话形态
- 过去叫 `ssh`，把工具的名字限定在了一种网络协议上。
- 但实际上：
  - 连接远端 VM 用的是 **SSH**；
  - 连接本地容器用的是 **Incus / Docker API 或 CLI**；
  - 随后接入内部网络/跨公网环境，可能使用的是 **WebSocket** 或 **HTTP Gateway**。
- **统一命名**：工具正式定名为 **`remote`**（语义：在远端/独立上下文环境中执行操作）。

### 2. Target 标识与自动协议推导（Smart Target Routing）
Agent 不需要关心底层用的是什么晦涩的网络参数，仅通过目标标识即可直达：

- **统一的 Target 表达**：
  - 如果是普通名称（如 `dev1`, `dev2`, `dev4`, `mac`）或 IP/域名：底层路由到 **SSH 传输层**；
  - 如果带有容器前缀或属于已知容器（如 `docker:corti`, `incus:ctr-1`, 或直接注册的容器名 `ctr-1`）：底层路由到 **容器传输层**；
  - 未来如果是 URL 格式（如 `ws://gateway:8080`）：底层路由到 **WebSocket 传输层**。

---

## 三、 Agent 工具注册接口（API 契约）

我们提供的是**便利性（Convenience）**，而不是**技术可行性（Feasibility）**。
使用主体是具备语义理解、上下文自愈能力的运行时 Agent。
- 拒绝 20 个琐碎参数；
- 拒绝在工具层做保姆式的配置界面（修改 SSH 配置、添加容器等，Agent 自己在命令行就能做）；
- 提供 **BYO-PTY（Bring Your Own PTY）** 逃生门，让工具聚焦于最核心的价值——**PTY 流生命周期管理与字符解析（Framing）**。

```typescript
interface RemoteToolParams {
  /** 
   * 目标环境（便利通道）：
   * - SSH Host: 如 'dev4', 'dev1', '137.131.54.174'
   * - 容器前缀: 如 'docker:my-container', 'incus:ctr-1'
   * - 注：无需预先静态注册；若目标不存在，直接透传原生底层错误给 Agent
   */
  target?: string;

  /** 
   * BYO-PTY 自由生成通道（自定义命令直挂 PTY 解析器）：
   * 当 Agent 动态创建了特殊容器、K8s pod 或特种跳板机 SSH 时，
   * Agent 可直接提供启动 PTY 的完整命令（如 'docker exec -it custom-img bash'）。
   * 工具只提供 PTY 托管、动态 Nonce 注入与精准收帧。
   * (target 与 spawn 二选一)
   */
  spawn?: string;

  /** 要在环境中执行的具体命令 */
  cmd: string;

  /** 
   * 执行模式：
   * - 'oneshot' (默认): 独立无状态执行 (bash -c)，天然高并发，无污染
   * - 'pty': 交互式长命终端会话，保持目录与上下文，支持 ^C 打断与交互
   * (当使用 spawn 时，模式自动锁定为 'pty')
   */
  mode?: 'oneshot' | 'pty';

  /** 可选标准输入内容 (在 pty 交互或 oneshot 管道时使用) */
  stdin?: string;

  /** 单次命令超时时长 (秒) */
  timeout?: number;
}
```

- **常规便利通道（`target`）**：针对常用的 Dev 环境，省去每次拼装长命令的摩擦；
- **自由接入通道（`spawn` / BYO-PTY）**：针对运行时动态创建的临时容器或特种连接，工具退守为纯粹的“PTY 字符解析与收帧引擎”；
- **错误透明原则**：底层任何连接失败、找不到容器、权限拒绝，原汁原味返回 stderr，不搞过度包裹，让 Agent 依据语义软性自愈（Soft Fail-close）。

---

## 四、 核心使用场景与 Agent 操作范式说明

本工具面向具备自治理解能力的 Agent，以下是针对常见与复杂环境的标准使用范式：

### 场景 1：80% 的日常探查与构建（默认 One-shot）
- **特点**：无状态、用完即走、天然支持多命令并发执行，零污染。
- **示例**：
  ```typescript
  // 检查远端 git 分支
  remote({ target: 'dev4', cmd: 'git status' })
  // 检查本机容器状态
  remote({ target: 'ctr-1', cmd: 'cat /etc/os-release' })
  ```

### 场景 2：需要保持目录与环境变量的多步交互（Opt-in PTY）
- **特点**：跨 turn 保持 `cd` 路径、激活虚拟环境、支持 `sudo` 输入密码或 `^C` 打断。
- **示例**：
  ```typescript
  // Turn 1: 进入目录并激活 venv
  remote({ target: 'dev4', mode: 'pty', cmd: 'cd /data/project && source .venv/bin/activate' })
  // Turn 2: 直接在该环境中运行，状态保持
  remote({ target: 'dev4', mode: 'pty', cmd: 'pytest -v' })
  ```

### 场景 3：嵌套环境与多层穿透（Nested Docker / 跳板机）
- **核心原理：流穿透性（Pass-through Transparency）**
  中间的网络层、容器层全部是透明管道（Dumb Pipes），只有最内层的 Bash 在执行并打出 Nonce 结束标记。**从 Host 解析器来看，无论嵌套多少层，永远只需要解析一层流！**
- **范式 A：像人类一样交互式进入（两步走）**
  ```typescript
  // 步骤 1: 登录 dev3 后，直接在终端里 exec 进容器
  remote({ target: 'dev3', mode: 'pty', cmd: 'docker exec -it model-runner bash' })
  // 步骤 2: 下一条命令已经处于容器内部，直接跑容器内任务
  remote({ target: 'dev3', mode: 'pty', cmd: 'python train.py' })
  ```
- **范式 B：使用 BYO-PTY 一行直达穿透**
  ```typescript
  // 直接拉起透传通道，工具只负责捕获最内层返回的 Exit Code
  remote({
    spawn: "ssh -t dev3 'docker exec -it model-runner bash'",
    cmd: "python train.py"
  })
  ```

### 场景 4：动态发现与免注册自愈
- **场景**：Agent 刚才在远端通过命令自己起了一个新容器 `temp-worker`；
- **操作**：Agent 下一刻直接调用 `remote({ spawn: "docker exec -it temp-worker bash", cmd: "..." })`，无需任何预先配置或注册，即插即用；
- **自愈**：若容器挂了或名字拼错，Docker 原生报错原样输出给 Agent，Agent 看到后自动通过上下文调整修正。

---

## 五、 底层执行与收帧设计

### 1. 模式 A：One-shot 执行流水线（极速、无解析、零残留）
- **SSH 目标**：直接执行 `ssh -o BatchMode=yes <target> "bash -lc '<cmd>'"`（不分配 tty，`-T`）；
- **Docker 目标**：直接执行 `docker exec -i <target> bash -lc "<cmd>"`（不加 `-t`）；
- **Incus 目标**：直接执行 `incus exec <target> -- bash -lc "<cmd>"`（不加 `-t`）；
- **收尾判断**：直接获取子进程退出码（Exit Code 0~255）。**完全不经过任何字符串扫描，绝对不可伪造，绝对无污染。**

### 2. 模式 B：Persistent PTY 执行流水线（带内动态 Nonce 严密收帧）
针对长命 PTY 会话，解决上一阶段暴露的偶发结束符冲突与生命周期问题：

1. **每轮下发随机 Nonce**：
   - 每次下发命令前，Host 生成一个简短的 8 字节随机字符串 `$NONCE`；
   - PTY 会话在命令末尾执行的收帧指令带上该 Nonce：
     `printf "\033]133;D;%s;%s\007" "$NONCE" "$?"`
   - Host 端的流解析器**只有在匹配到当前轮次下发的 `$NONCE` 时才收帧**。
   - 任何远端命令偶然打印的静态 `\033]133;D;`，因为 Nonce 不匹配，一律被当成普通输出文本打印，绝不会导致命令提前中断或退出码被窜改。
2. **空闲保活与回收（10 分钟活跃 TTL）**：
   - 会话从最后一次收到活跃命令开始计时，10 分钟无新交互自动关闭 SSH/容器连接，释放宿主资源；
   - 下次调用时透明冷启动拉起。
3. **断联自愈哲学（大模型上下文接管）**：
   - 当遇到容器重启、SSH 偶发断联、会话 Shell 崩溃退出时，**底层绝不做耗费数百行代码的虚拟环境状态盲目重建**；
   - 底层统一行为：重新建立干净的初始会话，返回明确提示：
     `[remote: session reconnected to fresh shell; cwd reset to default]`；
   - 依赖 Agent 自身强大的 Transcript 上下文记忆与自愈能力，由 Agent 自行决定是否需要 `cd` 回工作目录。

---

## 六、 明确的边界法则（Strict Non-Goals）

为了彻底阻断无边界的复杂度下钻，本框架将以下事项焊死为“非工具职责”：

1. **后台进程输出不隔离（属于使用者职责）**：
   - 终端共享标准输出是 POSIX 规范基础行为。任何在本机、物理机、容器后台执行的进程，若未重定向输出，其日志自然会打在终端上。
   - **决不在底层尝试黑魔法拦截或清洗后台流**。Agent 若需要起常驻后台进程，必须按规范显式编写重定向：`cmd > /path.log 2>&1 &`。
2. **不追求 100% 内存状态重建**：
   - 真实的状态在文件系统（磁盘）和 Agent 上下文里。不投入精力去快照和回放 Shell 内部的临时环境变量。
3. **不暴露过多物理终端微调参数**：
   - 终端行列大小固定满足标准（如 40×120），不向 Agent 暴露行列宽高调整接口，避免界面与认知膨胀。

---

## 七、 开发推进路线图（Roadmap）

- [ ] **Phase 1：内核解耦与 Nonce 收帧验证**
  - 在底层 framing 模块中增加基于随机 Nonce 的收帧状态机原型；
  - 验证随机 Nonce 下任意打印 ANSI 字符不会导致流截断。
- [ ] **Phase 2：抽象 `remote` 双轨调度器**
  - 编写统一的 `RemoteDriver` 抽象基类；
  - 实现 `OneShotRunner`（直接系统执行）与 `PersistentPtyRunner`（维护 PTY 实例池与 10min TTL）。
- [ ] **Phase 3：多 Transport 适配器接入**
  - 封装 `SshTransport`（VM 远端）；
  - 封装 `IncusTransport` / `DockerTransport`（容器直连）；
  - 注册统一的 `remote` Agent 工具入口。
- [ ] **Phase 4：实测回归与文档定稿**
  - 在 `dev4`（SSH）与 `ctr-1`（Incus）上运行标准化测试矩阵；
  - 输出全新阶段的验收实测报告。

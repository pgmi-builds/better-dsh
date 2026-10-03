# remote-pty-label Specification

## Purpose

`remote` 工具的持久化 BYO-PTY 通道从「`spawn` 命令原文即会话键」改为「`target` 选择器寻址的具名会话」。旧实现的池键就是整条 spawn 文本，于是「同一条命令」与「同一个会话」被绑死：改一个 token 就**静默**新开一个 shell（cwd/env 全丢、零提示），roster 又拿整整一条 shell 命令当会话名。本规格固定新契约——`byop:<label>` 是唯一入口、label 由调用方（模型）自选并因此成为复用入口、`spawn` 降格为该 label 首次创建时的伴生参数——并据此定义创建/复用/冲突三分支、失败面，以及裸名候选表的末位新增项。

## Requirements

### Requirement: 单入口寻址

`target` SHALL 是 `remote` 工具的唯一分流入口。以 `byop:` 开头的 target SHALL 被解析为 PTY 选择器，冒号之后的全部内容为 label。`spawn` SHALL 仅在与 `byop:<label>` target 同时出现时合法——它不再是独立入口。

#### Scenario: spawn 不能独立成调用

- **WHEN** 调用只给 `spawn`（无 target，或 target 不是 `byop:` 选择器）
- **THEN** 系统返回 `[E_PARAMS]` 并在消息内给出正确形状 `{ target: "byop:<label>", spawn: "…", cmd: "…" }`，且不创建、不触碰任何会话

#### Scenario: label 字符集

- **WHEN** label 不匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`（空 label、含空白、含 `:` 等）
- **THEN** 系统返回 `[E_BAD_LABEL]` 并在消息内给出合法形状，且不触碰会话池

#### Scenario: PTY 选择器锁定 mode

- **WHEN** `byop:<label>` target 与显式 `mode:"oneshot"` 同时出现
- **THEN** 系统返回 `[E_BAD_MODE]`，而不是静默降级或静默改写 mode

### Requirement: label 即复用入口，命名空间按 agent 隔离

PTY 会话 SHALL 以 `` `${agentSessionKey}|p:${label}` `` 为池键。`spawn` 原文 SHALL 作为创建来源（origin）随会话保存，仅用于同 label 重复给 spawn 时的比对。label 首次创建之后，仅给 `{ target: "byop:<label>", cmd }` SHALL 复用该会话，cwd/env 存活。

#### Scenario: 创建后仅凭 label 复用

- **WHEN** 先调用 `{target:"byop:dev3", spawn:"bash", cmd:"cd /tmp && export MARK=live"}`，再调用 `{target:"byop:dev3", cmd:'echo "$MARK" && pwd'}`
- **THEN** 第二次调用在**同一个** shell 内执行，输出含 `live`、cwd 为 `/tmp`，且结果带 `session: "byop:dev3"`

#### Scenario: 两个 agent 的同名 label 互不可见

- **WHEN** agent A 创建了 `byop:dev3`，agent B 以同一 label 且不给 spawn 调用
- **THEN** B 得到 `[E_NO_SESSION]`，A 的会话不受任何影响

### Requirement: 同 label 重复 spawn 的三分支

对已存在的 label 再次给 `spawn` 时，系统 SHALL 将其与创建来源比对：相同即复用并在结果内附教学提示；不同即拒绝，且 SHALL NOT 执行任何命令。

#### Scenario: 同一 spawn → 复用 + 提示

- **WHEN** 对活着的 `byop:dev3` 再次传入与创建时逐字相同的 `spawn`
- **THEN** 调用在既有会话内执行，结果的 `notice` 说明该 PTY 是持久化的、后续可省略 `spawn`（只写 label）

#### Scenario: 不同 spawn → 冲突，什么都不跑

- **WHEN** 对活着的 `byop:dev3` 传入与创建时不同的 `spawn`
- **THEN** 系统返回 `[E_LABEL_CONFLICT]`，消息内含既有 spawn 原文与「丢掉 spawn 复用它 / 换一个 label 新建」两条出路，**cmd 不执行**，既有会话状态不变

### Requirement: 无会话面 fail-loud 且不保留 spawn

label 从未创建、或已被 idle TTL（默认 600s）回收时，不带 `spawn` 的调用 SHALL 返回 `[E_NO_SESSION]`。spawn 命令 SHALL NOT 被跨会话保留（无墓碑、无自动重建）。

#### Scenario: 回收后必须重贴 spawn

- **WHEN** `byop:dev3` 因 idle TTL 出池后调用 `{target:"byop:dev3", cmd:"echo hi"}`
- **THEN** 系统返回 `[E_NO_SESSION]`，消息内给出带 `spawn` 的重建形状，并说明 spawn 未被保留

### Requirement: 初始化失败不留任何东西

首建命令未能初始化（`[E_SESSION_DIED]` / `[E_SESSION_START]`）时，该 PTY 会话 SHALL 出池：label 与 TTY SHALL NOT 被建立——这里从来没有过一个可用会话。**已 ready 过**的会话死亡 SHALL 留在池内（那是 reconnect 语义），不受本需求约束。

#### Scenario: 失败的 spawn 之后 label 仍然自由

- **WHEN** `{target:"byop:x", spawn:"…", cmd:"…"}` 的首建命令未能初始化
- **THEN** 随后不带 spawn 的复用得到 `[E_NO_SESSION]`（而非重跑冻结的 argv 再失败一次），且带**任意** spawn 的调用 SHALL 正常新建——不得被创建来源比对拦成 `[E_LABEL_CONFLICT]`

#### Scenario: 已 ready 的会话死亡仍可重连

- **WHEN** 一个曾经初始化成功的 `byop:<label>` shell 死亡后被复用
- **THEN** 该会话留在池内、按原创建命令重连并附 reconnect 提示
### Requirement: 状态面与 roster 以 label 呈现

`{target:"byop:<label>"}`（无 cmd）SHALL 只读池内状态、零拨号。roster SHALL 以 `byop:<label>` 命名会话，SHALL NOT 泄露 spawn 命令。

#### Scenario: 探测不存在的 label

- **WHEN** 对无会话的 `byop:<label>` 做 status 调用
- **THEN** 返回 `session: none — no live PTY under this label`（不是 transport target 的 "dials on first exec"，也不报错）

#### Scenario: roster 只给 label

- **WHEN** 调用方自己以 `UNIQUESPAWNMARKER bash` 创建了 `byop:dev3`
- **THEN** roster 包含 `live pty sessions: byop:dev3`，且文本中不出现 `UNIQUESPAWNMARKER`

### Requirement: roster 的活性面按 agent session 作用域

「live pty sessions」段 SHALL 只列调用方 agent session 自己的会话（池键前缀 = 调用方 sessionKey）。`ssh hosts` / `docker containers` / `incus containers` 三段名字候选 SHALL 保持全局可见。理由：名字候选是**静态公共配置**（谁都能 `ssh dev4`），活会话却是**操作环境**——复用别的 agent 留下的 shell 等于继承未知状态，而两个 agent 各开一条线的代价可忽略。BYO-PTY 天然是活的，因此自然落进这个 scope，无需另立规则。

#### Scenario: 两个 agent 各自只看见自己的活会话

- **WHEN** agent `a1` 建了 `byop:mine`、agent `a2` 建了 `byop:theirs`，随后各自调 `{}`
- **THEN** `a1` 的 roster 含 `byop:mine` 且不含 `byop:theirs`（反之亦然），而两边 `ssh hosts` / `docker containers` / `incus containers` 三段内容相同
### Requirement: 模型面不得泄露池内部键

面向模型的文本（roster、status、错误消息）SHALL 只出现模型面名字（`byop:<label>`、裸 transport target），SHALL NOT 出现池键（`` `${agentSessionKey}|p:<label>` `` / `|t:<target>`）。key→名字 SHALL 是单一定义（`displayKey`），roster 与错误面共用同一条规则。

#### Scenario: 初始化失败的错误消息

- **WHEN** agent `sess-abc` 的 `byop:x` 初始化失败
- **THEN** 错误消息含 `'byop:x'`，且不含 `sess-abc`、不含 `|p:`

### Requirement: 裸名候选表末位新增 PTY label

裸名解析顺序 SHALL 保持 ssh config 字面 host → docker → incus **一位不挪**，并在这三段之后、ssh 兜底之前追加「池内活 PTY label」候选。该候选 SHALL 仅在调用面未显式指定 `mode:"oneshot"` 时参与匹配。命中顺序即优先级：同名冲突时更靠前的来源胜出。

#### Scenario: 无重名时裸 label 可达（懒复用）

- **WHEN** 池内有 `byop:lab`，ssh config / docker / incus 均无 `lab`，且调用 `{target:"lab", cmd:"…"}`（未指定 mode）
- **THEN** 调用落在该 PTY 会话上（mode 为 `pty`），结果 `session` 为 `"byop:lab"`

#### Scenario: 重名时 ssh host 优先

- **WHEN** ssh config 存在 `Host lab`，同时池内有 `byop:lab`
- **THEN** 裸名 `lab` 仍解析为 ssh transport（现有优先级逐位不变）；要进 PTY 通道必须显式写 `byop:lab`

#### Scenario: 显式 oneshot 不吃 PTY 候选

- **WHEN** 调用显式带 `mode:"oneshot"` 且 target 为裸名
- **THEN** 该调用不走 PTY 末位候选，裸名在 `mode:"oneshot"` 下的旧行为逐位保留

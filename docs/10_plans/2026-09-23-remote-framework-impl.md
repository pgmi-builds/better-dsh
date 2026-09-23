# Remote 执行框架（`remote` 工具）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 2026-09-23 设计文档的全新阶段——一个 `remote` 工具（`dashr-remote` composition row），双轨执行（oneshot 默认 / pty opt-in）、CLI 子进程 transports（ssh / docker / incus）、BYO-PTY `spawn` 通道、随机 Nonce 收帧、10min 空闲 TTL、断联透明冷启——在 4999 系 dev 实例第一人称验收。

**Architecture:** 全新实现（不基于 RM0 分支——RM0 的 ssh2 库 + 连接池 + 准备层路线被本设计否决，分支存档不动）。新代码在 `better-dsh/src/remote/` 下：纯模块（framing / target 路由 / argv builders）先行 TDD， runners（oneshot 子进程、pty 会话池）用本地真 `bash` 与 `script(1)` 夹具测试，零网络依赖；工具面与插件行复用 RM0 已验证的注册形态（`defineTool` + `- id: dashr-remote` bundle patch 行）。零新增 npm 依赖（ssh2 移出依赖面；只加 `node:child_process` / `node:crypto` stdlib）。

**Tech Stack:** TypeScript（ESM，`.ts` import specifiers）、node:child_process、node:crypto、util-linux `script(1)`（宿主 PTY 托管）、schemastery row config、vitest（serial suite）。

**Spec:** `docs/10_plans/2026-09-23-remote-execution-framework.md`（本计划论证之源；设计文档为约束权威，本计划在其留白处以 Rulings 裁决）。

## Global Constraints（spec 逐条摘录，全部任务隐含遵守）

- **双轨收敛**：One-shot = 第 2 层（`bash -lc` 经 CLI 传输，进程退出码即收尾，**零字符串扫描**）；Persistent = 第 4 层（PTY + Nonce 收帧）。每阵营严格各一，不做第 1/3 层。
- **One-shot argv 形态（§五.1 原文）**：SSH = `ssh -o BatchMode=yes <target> "bash -lc '<cmd>'"`（不分配 tty）；Docker = `docker exec -i <target> bash -lc "<cmd>"`（不加 `-t`）；Incus = `incus exec <target> -- bash -lc "<cmd>"`（不加 `-t`）。
- **Nonce 收帧（§五.2）**：每次下发前 Host 生成 8 字节随机串 `$NONCE`；命令末尾收帧指令 `printf "\033]133;D;%s;%s\007" "$NONCE" "$?"`；**只有匹配当前轮次 Nonce 才收帧**；远端偶然打印的静态 `\033]133;D;` 一律当普通输出，不得截断流或窜改退出码。
- **空闲 TTL = 10 分钟**（默认 600s，可配），到期自动关连接释放资源；下次调用透明冷启动。
- **断联自愈**：底层绝不重建 shell 内存状态；统一行为 = 重建干净初始会话并返回明确提示 `[remote: session reconnected to fresh shell; cwd reset to default]`（此字符串逐字使用）。
- **Strict Non-Goals（§六）**：① 后台进程输出不隔离、不清洗（使用者显式 `cmd > log 2>&1 &`）；② 不快照/回放 shell 临时环境变量；③ 不暴露终端行列调整接口（内部固定 40×120）。
- **错误透明**：连接失败 / 找不到容器 / 权限拒绝，原生 stderr 原样返回，不过度包裹（Soft Fail-close）。
- **便利性而非保姆性（§三）**：参数面 = `{target?, spawn?, cmd, mode?, stdin?, timeout?}`；target 与 spawn 二选一；spawn 时 mode 锁定 `'pty'`；无静态注册要求。
- **Target 智能路由（§二.2）**：容器前缀 `docker:x` / `incus:x` → 容器传输；普通名称 / IP / 域名 → SSH；URL 形态（`ws://`）本期不做。
- **测试纪律**：vitest 全绿；新增规格先测后码（TDD）；单测不得要求外网或真实远端主机。
- **交付形态**：`dashr-remote` 为 better-dsh 内 composition row（subpath export + tsdown entry + bundle patch insert），插件管理器可开关，不新建 npm 包。
- **发布红线**：npm publish 需 4999 第一人称实测 + 报告 + user 放行（Development Operation Contract）；本计划只到 dev 实例验收。

## Rulings（本计划对 spec 留白的裁决）

1. **基座分支**：`remote-framework` 分支自 `main`（已核验 `main` 与 `dashr-bun-port-m1` 的 `better-dsh/` 零差异）；worktree `.worktrees/remote-framework`。RM0 分支（`remote-tool-rm0` / `arch/…`）存档不动，其代码不合并、不 import——但 `src/remote/tool.ts` 的注册形态（defineTool + 审计事件）与 `plugin.ts` 的行形态被本计划照抄结构。
2. **传输 = 系统 CLI，宿主无 PTY 库**：ssh pty = `ssh -tt -o BatchMode=yes -- <host> bash` 走宿主管道（远端 pty 的行规程吃 `\x03` 成 SIGINT——与 ssh2 pty channel 同构）；incus pty = `incus exec --force-interactive`（API 代理容器侧 pty，宿主管道）；**docker pty 与一切 `spawn`（BYO-PTY）= util-linux `script -qfec '…' /dev/null` 托管宿主 PTY**（docker CLI 对 `-t` 要求 stdin 是 TTY；node-pty 是原生模块，违反零 lifecycle-script 包红线，否决）。script 命令串前置 `stty -echo 2>/dev/null ; exec ` 关掉本地 pty 回显。
3. **marker 为三字段超集**：`\x1b]133;D;<nonce>;<exit>;<cwd>\x07`（spec 两字段 + cwd 只读回传）。cwd 是状态**报告**不是状态重建（Non-Goal ② 不破）——`cd` 后 Agent 需要知道自己在哪。终止符收 BEL 与 ST（`\x1b\\`）两种。nonce = `crypto.randomBytes(8).toString('hex')`（16 hex 字符）。
4. **无 C 标记**：nonce 门控使 OSC 133 C（PS0）不必要——init 之后的流里，帧间内容只可能是本轮输出（PS1/PS2 已哑）。比 RM0 少一个解析维度。
5. **init 协议**：会话冷启后先发 `stty -echo 2>/dev/null ; stty rows 40 cols 120 2>/dev/null ; PS1='' ; PS2='' ; export TERM=dumb ; printf '\033]133;D;<INIT_NONCE>;0;%s\007' "$PWD"\n`，INIT_NONCE 帧到达 = ready；帧前字节（回显残响/ssh banner）全部丢弃。固定 40×120 在此落位（Non-Goal ③）。
6. **会话键与 Agent 隔离**：pty 会话键 = `<agentSessionKey>|t:<target>` 或 `|s:<spawn>`；agentSessionKey 默认 `exec.agent?.id`（无 agent 用常量 `no-session`）。同一 Agent 跨 turn 保持状态（spec 场景 2），并发 Agent 互不污染（RM0 Ruling 7 先例）。同键命令串行排队，不同键天然并发。
7. **意外死亡 vs TTL**：进程死亡（EOF/被杀）后会话对象**留在池内**（state=dead），下次 dispatch 同对象重启并置 `reconnected: true`（带提示行）；TTL/row dispose 才出池（出池后重建是新对象 = 透明冷启，无提示）。
8. **超时语义**：默认 120s（row `execTimeoutSec`）。pty 超时 = 写 `\x03` + **紧随注入同 nonce 的 130-marker 行**（`printf '\033]133;D;<NONCE>;130;%s\007' "$PWD"`——交互 bash 被打断后放弃当前命令行剩余部分，尾部 marker 不再执行，注入行在 bash 回到读取态后补帧；若 bash 续行则原 marker 先帧、注入行帧被 parser 丢弃——两路皆 exit 130，会话存活）→ 3s 宽限无帧则 kill 进程组，`exit: null`。oneshot 超时 = SIGTERM → 2s → SIGKILL（**进程组杀**——后台子进程占管道时 close 永不触发，实测必挂），`timedOut: true`。超时秒数非正/非有限 → dispatch 前 `E_BAD_TIMEOUT` 拒绝。
9. **杀进程纪律**：全部子进程 `detached: true` 起进程组，杀 = `process.kill(-pid, SIGTERM)` → 2s → SIGKILL（script 会连带 docker CLI 一并收掉）。
10. **输出纪律**：回模型前机械剥残余 ANSI + CRLF→LF（RM0 连续性）；超帽保留尾窗 + 前置 `[truncated: showing last N of M chars]`（row `maxOutputChars` 默认 30000）。oneshot stdout/stderr 分离保留；pty 合流是诚实代价（spec §4.2 精神）。
11. **stdin 语义**：oneshot = 管道直写后 close；pty = 紧随命令行裸写（REPL 式 best-effort——cmd 不读则残行被 bash 当下一条命令执行、输出计入本轮，Agent 看到后自纠）。工具层校验 `stdin` 依赖 `cmd` 在场。
12. **别名注册**：row config `containers: { 'ctr-1': 'incus:ctr-1' }` 形态（裸名 → 容器传输的"已知容器"判定）；别名值必须是 `docker:`/`incus:` 前缀形态，否则 `E_TARGET_FORMAT`。裸名无别名命中 → ssh（本机 `~/.ssh/config` 里 ctr-1 同时是 ssh Host，显式前缀/别名优先于 ssh）。
13. **审计**：engine 回调 → 工具层 append session 事件 `dashr/remote-exec`（对齐 RM0 Ruling 10 / `tool/ptc-dispatch` 先例，成功与失败都记，best-effort 不破坏命令路径）。
14. **oneshot ssh 单层机械转义**：`bash -lc <shQuote(cmd)>` 作为 host 后的**单个 argv**（ssh 拼接 argv 后远端 sh 只做一次解析）；shQuote = POSIX 单引号包裹。docker/incus 的 argv 直传无二次解析。
15. **不做的**：ControlMaster 复用（oneshot 天然并发，握手成本可接受，YAGNI）；`ws://` 传输；forward/tmux/WebUI 终端（RM2 线）；host key 管理（ssh CLI 的 known_hosts 即正道，RM0 的 TOFU pin 文件随 ssh2 路线一并退役）；targets 列表面（发现是 agent 自己的活：`cat ~/.ssh/config`、`docker ps`、`incus list`——工具不做保姆注册表）。
16. **状态词汇表（user 2026-09-23 裁决，禁止歧义）**：本工具面向 LLM agent——它有语义理解与自愈能力，前提是不被误导。状态必须如实、无死灭暗示：**禁止 `offline`**（无人发起过连接当然是"未连接"，该词零信息且诱导 agent 误判配置已死——实测 reasoning log 里 agent 确实困惑过）。词汇表：探测面 `reachable (in Nms)` / `unreachable — <原生 stderr 单行>` / 容器事实态（`running`/`stopped`/`exited`…来自 inspect/list，不臆造）/ `error — <原生错误>`；会话层 `session: idle Ns (connected)`（连接存在、当前无 activity）/ `session: busy (a command is running)` / `session: none — dials on first exec`（明说"未拨号"而非任何可达性断言）/ `session: died — next exec cold-starts a fresh shell`。
17. **status 探测时机 = on-demand**（user 两选项中选此）：`remote({target})`（无 cmd）= 调用瞬间拨一次探测，**双重超时**：ssh `ConnectTimeout=5` + 外层 hard timeout 10s（防个别机器永不回复卡死 agent）；探测结果即当时事实，永不启动期扫描、永不缓存（启动扫描会立即过期且拖慢 boot）。status 只报探测面 + 会话层两行，不含任何注册表断言。

---

### Task 0: worktree 与基座

**Files:**
- Create: `.worktrees/remote-framework/`（git worktree，branch `remote-framework` off `main`）
- Create（分支内）: `docs/10_plans/2026-09-23-remote-execution-framework.md`（spec 副本）、`docs/10_plans/2026-09-23-remote-framework-impl.md`（本计划副本）

- [ ] **Step 1: 建 worktree + 分支**

```bash
cd /home/u1/workspaces/dashr
git worktree add .worktrees/remote-framework -b remote-framework main
```

- [ ] **Step 2: spec + 本计划入库（分支自包含，executor 只读 worktree）**

```bash
cp docs/10_plans/2026-09-23-remote-execution-framework.md docs/10_plans/2026-09-23-remote-framework-impl.md \
   .worktrees/remote-framework/docs/10_plans/
cd .worktrees/remote-framework && git add docs/10_plans/ && git commit -m "docs(remote): framework spec + implementation plan (2026-09-23 stage)"
```

- [ ] **Step 3: node_modules 软链**（worktree 不带 untracked 文件；canonical 的 dev 依赖树直接复用，本计划零新增依赖故版本面一致；⚠ 勿与 canonical 同时跑 vitest——`.vite` 缓存会撞）

```bash
ln -s /home/u1/workspaces/dashr/better-dsh/node_modules /home/u1/workspaces/dashr/.worktrees/remote-framework/better-dsh/node_modules
```

- [ ] **Step 4: 基线绿**

```bash
cd /home/u1/workspaces/dashr/.worktrees/remote-framework/better-dsh && npm test
```
Expected: 全绿（main 基线）。

---

### Task 1: Nonce 收帧纯模块 `nonce-framing.ts`

**Files:**
- Create: `better-dsh/src/remote/nonce-framing.ts`
- Test: `better-dsh/test/remote/nonce-framing.spec.ts`

**Interfaces（后续任务消费）:**
```ts
export interface PtyFrame { exit: number; cwd: string | null }
export function genNonce(bytes?: number): string                       // 16 hex chars
export function wrapPtyCommand(cmd: string, nonce: string): string     // 含尾 \n 的整行下发串
export function buildInitCommand(nonce: string): string                // init 串含尾 \n
export function stripAnsi(s: string): string
export function normalizePtyText(s: string): string                    // stripAnsi + CRLF→LF + 孤 CR 删除
export function tailWindow(text: string, cap: number): { text: string; truncated?: number }
export interface FrameParserEvents { onOutput?(text: string): void; onFrame(frame: PtyFrame): void }
export interface NonceFrameParser { feed(chunk: string): void; flush(): void }
export function createNonceFrameParser(nonce: string, events: FrameParserEvents): NonceFrameParser
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  buildInitCommand, createNonceFrameParser, genNonce, normalizePtyText, tailWindow, wrapPtyCommand,
} from '../../src/remote/nonce-framing.ts'

describe('command builders', () => {
  it('wrapPtyCommand braces cmd and bakes nonce marker with $?/$PWD', () => {
    const s = wrapPtyCommand('echo hi', 'abcd1234abcd1234')
    expect(s).toContain('{\necho hi\n} ; printf')
    expect(s).toContain(`'\\033]133;D;abcd1234abcd1234;%s;%s\\007' "$?" "$PWD"`)
    expect(s.endsWith('\n')).toBe(true)
  })
  it('buildInitCommand silences the terminal and ends with the init marker', () => {
    const s = buildInitCommand('ffffffffffffffff')
    for (const frag of ["stty -echo 2>/dev/null", "stty rows 40 cols 120", "PS1=''", "PS2=''", 'export TERM=dumb'])
      expect(s).toContain(frag)
    expect(s).toContain(`'\\033]133;D;ffffffffffffffff;0;%s\\007' "$PWD"`)
  })
  it('genNonce is 16 hex chars and unique', () => {
    expect(genNonce()).toMatch(/^[0-9a-f]{16}$/)
    expect(new Set([genNonce(), genNonce(), genNonce(), genNonce()]).size).toBe(4)
  })
})

describe('createNonceFrameParser', () => {
  const MARK = (nonce: string, exit: number, cwd: string) =>
    `\x1b]133;D;${nonce};${exit};${cwd}\x07`

  it('emits pre-marker output normalized and parses exit + cwd', () => {
    const out: string[] = []
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const nonce = genNonce()
    const p = createNonceFrameParser(nonce, { onOutput: (t) => out.push(t), onFrame: (f) => frames.push(f) })
    p.feed(`hello\r\nworld\r\n${MARK(nonce, 3, '/data')}`)
    expect(out.join('')).toBe('hello\nworld\n')
    expect(frames).toEqual([{ exit: 3, cwd: '/data' }])
  })

  it('survives the marker split at every chunk boundary', () => {
    const nonce = genNonce()
    const stream = `out${MARK(nonce, 0, '/tmp')}tail-is-dropped`
    for (let split = 1; split < stream.length; split++) {
      const frames: Array<{ exit: number; cwd: string | null }> = []
      const p = createNonceFrameParser(nonce, { onFrame: (f) => frames.push(f) })
      p.feed(stream.slice(0, split)); p.feed(stream.slice(split))
      expect(frames, `split at ${split}`).toEqual([{ exit: 0, cwd: '/tmp' }])
    }
  })

  it('a forged marker with a WRONG nonce is ordinary output, never frames', () => {
    const nonce = genNonce()
    const out: string[] = []
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const p = createNonceFrameParser(nonce, { onOutput: (t) => out.push(t), onFrame: (f) => frames.push(f) })
    p.feed(`ok\n${MARK('deadbeefdeadbeef', 99, '/pwn')}${MARK(nonce, 0, '/')}`)
    expect(frames).toEqual([{ exit: 0, cwd: '/' }])
    expect(out.join('')).toBe('ok\n') // forged OSC stripped as ANSI residue
  })

  it('accepts ST (ESC backslash) terminator and empty cwd -> null', () => {
    const nonce = genNonce()
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const p = createNonceFrameParser(nonce, { onFrame: (f) => frames.push(f) })
    p.feed(`\x1b]133;D;${nonce};7;\x1b\\`)
    expect(frames).toEqual([{ exit: 7, cwd: null }])
  })
  it('frames a cwd containing ; (terminal field — only BEL/ST end it)', () => {
    const nonce = genNonce()
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const p = createNonceFrameParser(nonce, { onFrame: (f) => frames.push(f) })
    p.feed(`\x1b]133;D;${nonce};2;/pa;th\x07`)
    expect(frames).toEqual([{ exit: 2, cwd: '/pa;th' }])
  })
  it('the spec\'s literal static 133-D marker (no nonce field) is ordinary output', () => {
    const nonce = genNonce()
    const out: string[] = []
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const p = createNonceFrameParser(nonce, { onOutput: (t) => out.push(t), onFrame: (f) => frames.push(f) })
    p.feed(`ok\n\x1b]133;D;0\x07text${MARK(nonce, 0, '/')}`)
    expect(frames).toEqual([{ exit: 0, cwd: '/' }])
    expect(out.join('')).toBe('ok\ntext') // 静态 marker 被 ANSI 剥洗当噪音清掉，正文保留
  })

  it('holds back a partial marker prefix at buffer end; flush releases it', () => {
    const nonce = genNonce()
    const out: string[] = []
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const p = createNonceFrameParser(nonce, { onOutput: (t) => out.push(t), onFrame: (f) => frames.push(f) })
    p.feed(`ok\n\x1b]133;D;${nonce.slice(0, 5)}`)
    expect(out.join('')).toBe('ok\n')
    p.flush()
    expect(out.join('')).toContain(nonce.slice(0, 5))
    expect(frames).toEqual([])
  })

  it('ignores everything after the first frame (post-frame bytes are next turn\'s business)', () => {
    const nonce = genNonce()
    const frames: Array<{ exit: number; cwd: string | null }> = []
    const p = createNonceFrameParser(nonce, { onFrame: (f) => frames.push(f) })
    p.feed(`${MARK(nonce, 1, '/a')}noise${MARK(nonce, 2, '/b')}`)
    expect(frames).toEqual([{ exit: 1, cwd: '/a' }])
  })
})

describe('text hygiene', () => {
  it('normalizePtyText strips CSI/OSC and normalizes line endings', () => {
    expect(normalizePtyText('a\r\nb\rc \x1b[31mred\x1b[0m\x1b]0;title\x07end')).toBe('a\nbc redend')
  })
  it('tailWindow caps from the tail with a disclosure header', () => {
    const r = tailWindow('x'.repeat(100), 10)
    expect(r.truncated).toBe(100)
    expect(r.text).toBe('[truncated: showing last 10 of 100 chars]\n' + 'x'.repeat(10))
    expect(tailWindow('short', 10)).toEqual({ text: 'short' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd better-dsh && npm test -- test/remote/nonce-framing.spec.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

```ts
import { randomBytes } from 'node:crypto'

/** 收帧帧体：退出码 + 只读回传的 cwd（Non-Goal ②：报告不重建）。 */
export interface PtyFrame { exit: number; cwd: string | null }

/** 8 字节随机串的 hex 形（spec §五.2：每次下发前生成）。 */
export function genNonce(bytes = 8): string {
  return randomBytes(bytes).toString('hex')
}

/** 命令整行：花括号复合体 + Nonce 收帧尾（spec §五.2 的 printf 逐字落地 + cwd 第三字段）。 */
export function wrapPtyCommand(cmd: string, nonce: string): string {
  return `{\n${cmd}\n} ; printf '\\033]133;D;${nonce};%s;%s\\007' "$?" "$PWD"\n`
}

/** init 整行：哑终端（echo/PS1/PS2/TERM）+ 固定 40×120（Non-Goal ③）+ INIT 帧。 */
export function buildInitCommand(nonce: string): string {
  return `stty -echo 2>/dev/null ; stty rows 40 cols 120 2>/dev/null ; PS1='' ; PS2='' ; export TERM=dumb ; printf '\\033]133;D;${nonce};0;%s\\007' "$PWD"\n`
}

const ANSI_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)?|\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

export function normalizePtyText(s: string): string {
  return stripAnsi(s).replace(/\r\n/g, '\n').replace(/\r/g, '')
}

export function tailWindow(text: string, cap: number): { text: string; truncated?: number } {
  if (text.length <= cap) return { text }
  return { text: `[truncated: showing last ${cap} of ${text.length} chars]\n${text.slice(text.length - cap)}`, truncated: text.length }
}

export interface FrameParserEvents {
  /** 输出文本：feed 路径经 normalize（剥 ANSI/规整换行）；flush 路径为**裸放出**（残余字节原样，勿假设已剥洗）。 */
  onOutput?(text: string): void
  onFrame(frame: PtyFrame): void
}

export interface NonceFrameParser { feed(chunk: string): void; flush(): void }

const FRAME_BODY_RE = /^(\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/ // cwd 是尾字段：合法路径可含 `;`，只有 BEL/ESC 终止它

/**
 * 单 nonce、单帧解析器：一轮 dispatch 一个实例。只认 `\x1b]133;D;<nonce>;`，
 * 错误 nonce 的静态/伪造 marker 永不匹配，按普通输出流过（再经 ANSI 剥洗）。
 * 缓冲尾若可能是 marker 前缀则扣留，flush() 时作为输出放出。
 */
export function createNonceFrameParser(nonce: string, events: FrameParserEvents): NonceFrameParser {
  const prefix = `\x1b]133;D;${nonce};`
  let buf = ''
  let done = false

  const emit = (raw: string): void => {
    const text = normalizePtyText(raw)
    if (text.length > 0) events.onOutput?.(text)
  }

  const holdback = (): number => {
    const max = Math.min(buf.length, prefix.length - 1)
    for (let k = max; k > 0; k--) if (buf.endsWith(prefix.slice(0, k))) return k
    return 0
  }

  const consume = (): void => {
    if (done) return
    const i = buf.indexOf(prefix)
    if (i < 0) {
      const keep = holdback()
      emit(buf.slice(0, buf.length - keep))
      buf = buf.slice(buf.length - keep)
      return
    }
    emit(buf.slice(0, i))
    const rest = buf.slice(i + prefix.length)
    const m = FRAME_BODY_RE.exec(rest)
    if (m === null) { buf = buf.slice(i); return } // 帧体未到齐，整段扣留
    events.onFrame({ exit: Number(m[1]!), cwd: m[2]!.length > 0 ? m[2]! : null })
    done = true // 帧后字节一律丢弃（下一轮是新解析器）
    buf = ''
  }

  return {
    feed(chunk: string): void { buf += chunk; consume() },
    // 流结束 = 裸放出扣留的残余（含未完成的 marker 前缀）：不经过 ANSI 剥洗——
    // stripAnsi 会把未闭合 OSC 整段吃掉，扣留字节就此蒸发，违背 flush 语义。
    flush(): void { if (buf.length > 0) events.onOutput?.(buf); buf = '' },
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — `npm test -- test/remote/nonce-framing.spec.ts` → PASS。

- [ ] **Step 5: Commit**

```bash
git add src/remote/nonce-framing.ts test/remote/nonce-framing.spec.ts
git commit -m "feat(remote): nonce-gated framing module — wrap/init/parse/strip/tail-window"
```

---

### Task 2: Target 智能路由 `target.ts`

**Files:**
- Create: `better-dsh/src/remote/target.ts`
- Test: `better-dsh/test/remote/target.spec.ts`

**Interfaces:**
```ts
export type TargetPlan = { kind: 'ssh'; host: string } | { kind: 'docker' | 'incus'; container: string }
export class TargetFormatError extends Error { readonly code = 'E_TARGET_FORMAT' }
export function resolveTarget(target: string, containerAliases?: Record<string, string>): TargetPlan
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { resolveTarget, TargetFormatError } from '../../src/remote/target.ts'

describe('resolveTarget', () => {
  it('routes plain names / IPs / domains to ssh', () => {
    expect(resolveTarget('dev4')).toEqual({ kind: 'ssh', host: 'dev4' })
    expect(resolveTarget('137.131.54.174')).toEqual({ kind: 'ssh', host: '137.131.54.174' })
    expect(resolveTarget('mac.example.com')).toEqual({ kind: 'ssh', host: 'mac.example.com' })
  })
  it('routes explicit container prefixes', () => {
    expect(resolveTarget('docker:corti')).toEqual({ kind: 'docker', container: 'corti' })
    expect(resolveTarget('incus:ctr-1')).toEqual({ kind: 'incus', container: 'ctr-1' })
  })
  it('registered bare container names beat ssh (ctr-1 is also an ssh Host)', () => {
    expect(resolveTarget('ctr-1', { 'ctr-1': 'incus:ctr-1' })).toEqual({ kind: 'incus', container: 'ctr-1' })
  })
  it('ssh: explicit selector forces ssh even when an alias would match (Ruling P16)', () => {
    expect(resolveTarget('ssh:ctr-1', { 'ctr-1': 'incus:ctr-1' })).toEqual({ kind: 'ssh', host: 'ctr-1' })
    expect(resolveTarget('ssh:dev4')).toEqual({ kind: 'ssh', host: 'dev4' })
  })
  it('explicit prefix beats the alias map', () => {
    expect(resolveTarget('incus:ctr-1', { 'ctr-1': 'docker:other' })).toEqual({ kind: 'incus', container: 'ctr-1' })
  })
  it('bad alias value and empty target fail loud', () => {
    expect(() => resolveTarget('x', { x: 'dev4' })).toThrowError(TargetFormatError)
    expect(() => resolveTarget('   ')).toThrowError(/E_TARGET_FORMAT/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -- test/remote/target.spec.ts` → FAIL。

- [ ] **Step 3: 最小实现**

```ts
/** 解析后的传输计划：三种 CLI 传输之一。 */
export type TargetPlan =
  | { kind: 'ssh'; host: string }
  | { kind: 'docker'; container: string }
  | { kind: 'incus'; container: string }

export class TargetFormatError extends Error {
  readonly code = 'E_TARGET_FORMAT'
  constructor(message: string) { super(message); this.name = 'TargetFormatError' }
}

/** 显式协议选择器（Ruling P16）：可扩展新协议——加一个词即一条新传输腿。 */
const PREFIX_RE = /^(docker|incus|ssh):(.+)$/
/** 别名表值只接受容器形态（ssh 无别名意义——裸名即 ssh）。 */
const CONTAINER_PREFIX_RE = /^(docker|incus):(.+)$/

/** spec §二.2 智能路由（Ruling 12 + P16）：显式选择器 > 别名表（人工 pin，撞名时赢）> ssh 缺省。 */
export function resolveTarget(target: string, containerAliases: Record<string, string> = {}): TargetPlan {
  const raw = target.trim()
  if (raw.length === 0) throw new TargetFormatError('[E_TARGET_FORMAT] remote: empty target')
  const direct = PREFIX_RE.exec(raw)
  if (direct !== null) {
    if (direct[1] === 'ssh') return { kind: 'ssh', host: direct[2]! }
    return { kind: direct[1] as 'docker' | 'incus', container: direct[2]! }
  }
  const aliased = containerAliases[raw]
  if (aliased !== undefined) {
    const m = CONTAINER_PREFIX_RE.exec(aliased)
    if (m === null)
      throw new TargetFormatError(
        `[E_TARGET_FORMAT] remote: container alias '${raw}' must map to 'docker:<name>' or 'incus:<name>' (got ${JSON.stringify(aliased)})`)
    return { kind: m[1] as 'docker' | 'incus', container: m[2]! }
  }
  return { kind: 'ssh', host: raw }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): smart target routing — prefix/alias/ssh"`（含 add）。

---

### Task 3: 传输 argv builders `transports.ts`

**Files:**
- Create: `better-dsh/src/remote/transports.ts`
- Test: `better-dsh/test/remote/transports.spec.ts`

**Interfaces:**
```ts
export function shQuote(s: string): string
export function buildOneShotArgv(plan: TargetPlan, cmd: string): string[]
export function buildPtyArgv(plan: TargetPlan): string[]
export function buildSpawnArgv(spawnCommand: string): string[]
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { buildOneShotArgv, buildPtyArgv, buildSpawnArgv, shQuote } from '../../src/remote/transports.ts'

describe('shQuote', () => {
  it('wraps in single quotes and escapes embedded quotes POSIX-style', () => {
    expect(shQuote('ls -la')).toBe(`'ls -la'`)
    expect(shQuote("it's")).toBe(`'it'\\''s'`)
    expect(shQuote('a\nb')).toBe(`'a\nb'`)
  })
})

describe('buildOneShotArgv (spec §五.1 verbatim shapes)', () => {
  it('ssh: BatchMode, no tty, one mechanically-quoted argv after the host', () => {
    expect(buildOneShotArgv({ kind: 'ssh', host: 'dev4' }, "git status | head -1"))
      .toEqual(['ssh', '-o', 'BatchMode=yes', '-T', '--', 'dev4', `bash -lc 'git status | head -1'`])
  })
  it('ssh survives a cmd containing single quotes (one mechanical layer)', () => {
    const argv = buildOneShotArgv({ kind: 'ssh', host: 'dev4' }, "echo 'hi'")
    expect(argv.at(-1)).toBe(`bash -lc 'echo '\\''hi'\\'''`)
  })
  it('docker: exec -i, argv-direct (no -t, no re-parse)', () => {
    expect(buildOneShotArgv({ kind: 'docker', container: 'c1' }, 'echo x'))
      .toEqual(['docker', 'exec', '-i', '--', 'c1', 'bash', '-lc', 'echo x'])
  })
  it('incus: exec without -t semantics (--force-noninteractive)', () => {
    expect(buildOneShotArgv({ kind: 'incus', container: 'ctr-1' }, 'echo x'))
      .toEqual(['incus', 'exec', '--force-noninteractive', 'ctr-1', '--', 'bash', '-lc', 'echo x'])
  })
})

describe('buildPtyArgv', () => {
  it('ssh: force-tty over host pipes, BatchMode', () => {
    expect(buildPtyArgv({ kind: 'ssh', host: 'dev4' }))
      .toEqual(['ssh', '-tt', '-o', 'BatchMode=yes', '--', 'dev4', 'bash'])
  })
  it('docker: script(1) hosts the PTY, local echo pre-silenced, exec replaces the shell', () => {
    expect(buildPtyArgv({ kind: 'docker', container: 'my c' }))
      .toEqual(['script', '-qfec', `stty -echo 2>/dev/null ; exec docker exec -it -- 'my c' bash`, '/dev/null'])
  })
  it('incus: force-interactive over host pipes', () => {
    expect(buildPtyArgv({ kind: 'incus', container: 'ctr-1' }))
      .toEqual(['incus', 'exec', '--force-interactive', 'ctr-1', '--', 'bash'])
  })
})

describe('buildSpawnArgv (BYO-PTY)', () => {
  it('hosts any spawn command under script with echo pre-silenced', () => {
    expect(buildSpawnArgv('docker exec -it temp-worker bash'))
      .toEqual(['script', '-qfec', 'stty -echo 2>/dev/null ; exec docker exec -it temp-worker bash', '/dev/null'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 最小实现**

```ts
import type { TargetPlan } from './target.ts'

/** POSIX 单引号机械转义（唯一一层转义，spec §三"一层机械转义"）。 */
export function shQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`
}

/** One-shot（§五.1）：不分配 tty，收尾 = 子进程退出码，零字符串扫描。 */
export function buildOneShotArgv(plan: TargetPlan, cmd: string): string[] {
  switch (plan.kind) {
    case 'ssh':
      // ssh 把 host 后的 argv 用空格拼接交远端 shell 解析——预先整体 shQuote，
      // 远端只做这一层解析，bash -lc 拿到原样 cmd。
      return ['ssh', '-o', 'BatchMode=yes', '-T', '--', plan.host, `bash -lc ${shQuote(cmd)}`]
    case 'docker':
      return ['docker', 'exec', '-i', '--', plan.container, 'bash', '-lc', cmd]
    case 'incus':
      return ['incus', 'exec', '--force-noninteractive', plan.container, '--', 'bash', '-lc', cmd]
  }
}

/** Persistent pty（Ruling 2）：ssh/incus 走宿主管道，docker 经 script(1) 托管宿主 PTY。 */
export function buildPtyArgv(plan: TargetPlan): string[] {
  switch (plan.kind) {
    case 'ssh':
      return ['ssh', '-tt', '-o', 'BatchMode=yes', '--', plan.host, 'bash']
    case 'docker':
      return ['script', '-qfec', `stty -echo 2>/dev/null ; exec docker exec -it -- ${shQuote(plan.container)} bash`, '/dev/null']
    case 'incus':
      return ['incus', 'exec', '--force-interactive', plan.container, '--', 'bash']
  }
}

/** BYO-PTY（§三 spawn）：工具只提供 PTY 托管 + Nonce 注入 + 收帧。 */
export function buildSpawnArgv(spawnCommand: string): string[] {
  return ['script', '-qfec', `stty -echo 2>/dev/null ; exec ${spawnCommand}`, '/dev/null']
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): CLI transport argv builders (ssh/docker/incus + script-hosted BYO-PTY)"`。

---

### Task 4: One-shot runner `oneshot.ts`

**Files:**
- Create: `better-dsh/src/remote/oneshot.ts`
- Test: `better-dsh/test/remote/oneshot.spec.ts`

**Interfaces:**
```ts
export interface OneShotOptions { stdin?: string; timeoutSec?: number }
export interface OneShotResult { exit: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }
export async function runOneShot(argv: string[], opts?: OneShotOptions): Promise<OneShotResult>
```

- [ ] **Step 1: 写失败测试**（本地真 `bash` 当 CLI 夹具，零网络）

```ts
import { describe, expect, it } from 'vitest'
import { runOneShot } from '../../src/remote/oneshot.ts'

const BASH = (cmd: string): string[] => ['bash', '-c', cmd]

describe('runOneShot', () => {
  it('captures stdout, stderr and the binary exit code', async () => {
    const r = await runOneShot(BASH('echo out; echo err >&2; exit 42'))
    expect(r.exit).toBe(42)
    expect(r.stdout).toBe('out\n')
    expect(r.stderr).toBe('err\n')
    expect(r.timedOut).toBe(false)
  })
  it('pipes stdin and closes it', async () => {
    const r = await runOneShot(BASH('cat'), { stdin: 'line1\nline2\n' })
    expect(r.exit).toBe(0)
    expect(r.stdout).toBe('line1\nline2\n')
  })
  it('preserves utf8 across chunk boundaries', async () => {
    const r = await runOneShot(BASH("printf '中%.0s' $(seq 1 20000); echo"))
    expect(r.stdout).toBe('中'.repeat(20_000) + '\n')
    expect(r.exit).toBe(0)
  })
  it('timeout: TERM ignored -> KILL escalation observable (exit null, >2s), flagged, bounded', async () => {
    const r = await runOneShot(BASH('trap "" TERM; sleep 30'), { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.exit).toBe(null)
    expect(r.durationMs).toBeGreaterThan(2_500)
    expect(r.durationMs).toBeLessThan(8_000)
  })
  it('timeout bounds completion when a background descendant holds the pipes (process-group kill)', async () => {
    const r = await runOneShot(BASH('sleep 8 & sleep 8'), { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.durationMs).toBeLessThan(5_000)
  })
  it('spawn failure surfaces the OS error verbatim (error transparency)', async () => {
    const r = await runOneShot(['definitely-not-a-real-cli-xyz', '--version'])
    expect(r.exit).toBe(null)
    expect(r.stderr).toContain('spawn failed')
    expect(r.stderr).toContain('ENOENT')
  })
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 最小实现**

```ts
import { spawn } from 'node:child_process'

export interface OneShotOptions { stdin?: string; timeoutSec?: number }
export interface OneShotResult { exit: number | null; timedOut: boolean; stdout: string; stderr: string; durationMs: number }

/** 单流硬收集帽（4M UTF-16 code units，ASCII≈4MB）：防失控输出吃内存；模型面截断由上层 tailWindow 负责。 */
const HARD_CAP = 4_000_000

/** One-shot：子进程退出码即收尾（spec §五.1），stdout/stderr 分离保留。 */
export async function runOneShot(argv: string[], opts: OneShotOptions = {}): Promise<OneShotResult> {
  const started = Date.now()
  // detached+进程组：超时杀整组——后台子进程若仍占着管道，只杀直接子进程会让 close
  // 永不触发（实测 `sleep 30 &` 场景无限挂起）；组杀与 Ruling 9 的 pty 杀法同构。
  const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  child.stdout.setEncoding('utf8').on('data', (d: string) => {
    if (stdout.length < HARD_CAP) stdout = (stdout + d).slice(0, HARD_CAP)
  })
  child.stderr.setEncoding('utf8').on('data', (d: string) => {
    if (stderr.length < HARD_CAP) stderr = (stderr + d).slice(0, HARD_CAP)
  })
  child.stdin.on('error', () => {}) // EPIPE on early exit is not ours to raise
  if (opts.stdin !== undefined) child.stdin.write(opts.stdin)
  child.stdin.end()

  let termTimer: NodeJS.Timeout | undefined
  let killTimer: NodeJS.Timeout | undefined
  const clearTimers = (): void => {
    if (termTimer !== undefined) clearTimeout(termTimer)
    if (killTimer !== undefined) clearTimeout(killTimer)
  }
  if (opts.timeoutSec !== undefined) {
    const killGroup = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) { child.kill(sig); return }
      try { process.kill(-child.pid, sig) } catch { /* group already gone */ }
    }
    termTimer = setTimeout(() => {
      timedOut = true
      killGroup('SIGTERM')
      killTimer = setTimeout(() => killGroup('SIGKILL'), 2_000)
    }, opts.timeoutSec * 1_000)
  }

  const exit = await new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
    child.once('error', (err) => {
      stderr += `\n[remote: spawn failed: ${err.message}]`
      resolve(null)
    })
  })
  clearTimers()
  return { exit, timedOut, stdout, stderr, durationMs: Date.now() - started }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): one-shot runner — exit code only, split streams, TERM/KILL timeout"`。

---

### Task 5: Persistent PTY 会话与池 `pty-session.ts`

**Files:**
- Create: `better-dsh/src/remote/pty-session.ts`
- Test: `better-dsh/test/remote/pty-session.spec.ts`

**Interfaces:**
```ts
export const RECONNECT_NOTICE = '[remote: session reconnected to fresh shell; cwd reset to default]'
export interface PtySessionOptions { key: string; argv: string[]; idleTtlSec: number; initTimeoutSec?: number; onDead?: () => void }
export interface PtyDispatchOptions { stdin?: string; timeoutSec?: number }
export interface PtyDispatchResult { output: string; exit: number | null; cwd: string | null; timedOut: boolean; reconnected: boolean; durationMs: number }
export type PtyState = 'cold' | 'starting' | 'ready' | 'dead' | 'disposed'
/** 会话运行时快照（status 面消费，Ruling 16 词汇源）。 */
export interface SessionSnapshot { state: PtyState; busy: boolean; idleMs: number | null; pid: number | null }
export class PtySession {
  constructor(opts: PtySessionOptions)
  get sessionState(): PtyState
  get snapshot(): SessionSnapshot
  dispatch(cmd: string, opts?: PtyDispatchOptions): Promise<PtyDispatchResult>
  dispose(): Promise<void>
}
export interface PtyPoolDefaults { idleTtlSec: number; initTimeoutSec?: number }
export class PtyPool {
  constructor(defaults: PtyPoolDefaults)
  getOrCreate(key: string, argv: string[]): PtySession
  get size(): number
  inspect(key: string): SessionSnapshot | undefined
  disposeAll(): Promise<void>
}
```

- [ ] **Step 1: 写失败测试**（本地 `bash` 与 `script -qfec bash /dev/null` 当传输夹具——真协议、真 init、真帧，零网络）

```ts
import { describe, expect, it } from 'vitest'
import { PtyPool, PtySession } from '../../src/remote/pty-session.ts'

const OPTS = { idleTtlSec: 600 }

describe('PtySession over plain local bash', () => {
  it('cold starts, frames output/exit/cwd', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch('echo hello && cd /tmp && pwd')
    expect(r.output.trim()).toBe('hello\n/tmp')
    expect(r.exit).toBe(0)
    expect(r.cwd).toBe('/tmp')
    expect(r.reconnected).toBe(false)
    await s.dispose()
  })
  it('multi-line cmd = one compound frame, exit is the last command\'s', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch('echo a\necho b\nfalse')
    expect(r.output).toBe('a\nb\n')
    expect(r.exit).toBe(1)
    await s.dispose()
  })
  it('state persists across dispatches (cwd/env)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('export FOO=bar && cd /tmp')
    const r = await s.dispatch('echo "$FOO" && pwd')
    expect(r.output).toBe('bar\n/tmp\n')
    await s.dispose()
  })
  it('snapshot feeds the status face: ready+idle after dispatch, disposed after dispose', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('echo hi')
    expect(s.snapshot).toMatchObject({ state: 'ready', busy: false })
    expect(s.snapshot.idleMs).toBeGreaterThanOrEqual(0)
    const pool = new PtyPool({ idleTtlSec: 600 })
    const s2 = pool.getOrCreate('t:x', ['bash'])
    expect(pool.inspect('t:x')?.state).toBe('cold')
    expect(pool.inspect('missing')).toBeUndefined()
    await s2.dispatch('echo y')
    expect(pool.inspect('t:x')).toMatchObject({ state: 'ready', busy: false })
    await s.dispose(); await pool.disposeAll()
  })
  it('serializes concurrent dispatches on one session (clean A/B output = no stdin interleave)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const [r1, r2] = await Promise.all([
      s.dispatch('sleep 0.4 ; echo A'),
      s.dispatch('echo B'),
    ])
    expect(r1.output.trim()).toBe('A')
    expect(r2.output.trim()).toBe('B')
    expect(r1.durationMs).toBeGreaterThan(300)
    await s.dispose()
  })
  it('unexpected shell death: partial + null exit; next dispatch reconnects with the notice', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r1 = await s.dispatch('kill -9 $$')
    expect(r1.exit).toBe(null)
    const r2 = await s.dispatch('echo back')
    expect(r2.reconnected).toBe(true)
    expect(r2.output.trim()).toBe('back')
    expect(r2.exit).toBe(0)
    await s.dispose()
  })
  it('idle TTL disposes the session and drops it from the pool (transparent cold start, no notice)', async () => {
    const pool = new PtyPool({ idleTtlSec: 1 })
    const s = pool.getOrCreate('t:x', ['bash'])
    await s.dispatch('echo hi')
    await new Promise((r) => setTimeout(r, 1_800))
    expect(s.sessionState).toBe('disposed')
    expect(pool.size).toBe(0)
    const s2 = pool.getOrCreate('t:x', ['bash'])
    const r = await s2.dispatch('echo again')
    expect(r.reconnected).toBe(false)
    await pool.disposeAll()
  })
})

describe('PtySession over script(1)-hosted PTY (BYO-PTY shape)', () => {
  it('timeout sends ^C through the pty line discipline: framed exit 130, flagged interrupted', async () => {
    const s = new PtySession({ key: 'k', argv: ['script', '-qfec', 'bash', '/dev/null'], ...OPTS })
    const r = await s.dispatch('sleep 30', { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.durationMs).toBeLessThan(8_000)
    expect(r.exit).toBe(130)
    const r2 = await s.dispatch('echo alive') // session survived the interrupt
    expect(r2.exit).toBe(0)
    await s.dispose()
  }, 20_000)
  it('timeout kill fallback on a transport without interrupt (plain bash over pipes)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch('trap "" INT; sleep 30', { timeoutSec: 1 })
    expect(r.timedOut).toBe(true)
    expect(r.exit).toBe(null)
    expect(r.durationMs).toBeLessThan(10_000)
    await s.dispose()
  }, 20_000)
  it('forged static 133-D marker with wrong nonce never truncates the stream', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch(`printf '\\x1b]133;D;deadbeefdeadbeef;99;/pwn\\x07' ; echo real`)
    expect(r.exit).toBe(0)
    expect(r.output.trim()).toBe('real')
    await s.dispose()
  })
  it('caps dispatch output collection (tail ring) — runaway output cannot eat host memory', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const r = await s.dispatch("printf 'x%.0s' $(seq 1 5000000) ; echo ; echo TAILMARK")
    expect(r.output.length).toBeLessThanOrEqual(4_000_001)
    expect(r.output.trim().endsWith('TAILMARK')).toBe(true)
    await s.dispose()
  }, 30_000)
  it('grace-expiry kill fallback reaps the process group (snapshot pid null, group gone)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('echo warm')
    const pid = s.snapshot.pid
    expect(pid).toBeTypeOf('number')
    const r = await s.dispatch('trap "" INT; sleep 30', { timeoutSec: 1 })
    expect(r.exit).toBe(null)
    expect(r.timedOut).toBe(true)
    expect(s.snapshot.pid).toBe(null)
    await new Promise((r) => setTimeout(r, 1_200)) // 等组长异步收割（zombie 保留 PGID，同 tick 断言必假阴）
    expect(() => process.kill(-pid!, 0)).toThrow()
    await s.dispose()
  }, 20_000)
  it('dispose is terminal: stale-reference dispatch rejects E_SESSION_DISPOSED', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    await s.dispatch('echo hi')
    await s.dispose()
    await expect(s.dispatch('echo late')).rejects.toThrow(/E_SESSION_DISPOSED/)
  })
  it('dispose mid-flight settles the in-flight dispatch promptly (exit null, not timedOut)', async () => {
    const s = new PtySession({ key: 'k', argv: ['bash'], ...OPTS })
    const p = s.dispatch('sleep 30', { timeoutSec: 30 })
    await new Promise((r) => setTimeout(r, 300))
    await s.dispose()
    const r = await p
    expect(r.exit).toBe(null)
    expect(r.timedOut).toBe(false)
    expect(r.durationMs).toBeLessThan(5_000)
    await new Promise((r2) => setTimeout(r2, 1_200)) // 等 dispose 的 killTree 兑现，防组泄漏到下一测试
  }, 20_000)
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 最小实现**

```ts
import { spawn, type ChildProcess } from 'node:child_process'
import { buildInitCommand, createNonceFrameParser, genNonce, wrapPtyCommand } from './nonce-framing.ts'

/** spec §五.2 逐字。 */
export const RECONNECT_NOTICE = '[remote: session reconnected to fresh shell; cwd reset to default]'

export interface PtySessionOptions {
  key: string
  argv: string[]
  idleTtlSec: number
  initTimeoutSec?: number
  /** 池回调：会话彻底出池（dispose）时触发；进程意外死亡不出池（Ruling 7）。 */
  onDead?: () => void
}

export interface PtyDispatchOptions { stdin?: string; timeoutSec?: number }
export interface PtyDispatchResult {
  output: string
  exit: number | null
  cwd: string | null
  timedOut: boolean
  reconnected: boolean
  durationMs: number
}

export type PtyState = 'cold' | 'starting' | 'ready' | 'dead' | 'disposed'

const DEFAULT_INIT_TIMEOUT_SEC = 30
const INTERRUPT_GRACE_MS = 3_000
/** pty 收集内存安全帽（Ruling P15，与 oneshot HARD_CAP 对齐）：模型面只见尾窗，保留尾部。 */
const OUTPUT_HARD_CAP = 4_000_000

export class PtySession {
  private proc: ChildProcess | null = null
  private state: PtyState = 'cold'
  private startPromise: Promise<void> | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: NodeJS.Timeout | null = null
  private onChunk: ((c: string) => void) | null = null
  private deathWaiters: Array<() => void> = []
  private diag = ''
  private inFlight = 0
  private lastSettleAt = 0

  constructor(private readonly opts: PtySessionOptions) {}

  get sessionState(): PtyState { return this.state }

  /** status 面快照：state + busy（有命令在跑）+ idleMs（上次 settle 至今）+ pid（进程组头，kill 兜底可观测）。 */
  get snapshot(): SessionSnapshot {
    return { state: this.state, busy: this.inFlight > 0, idleMs: this.lastSettleAt > 0 ? Date.now() - this.lastSettleAt : null, pid: this.proc?.pid ?? null }
  }

  /** 同一会话命令严格串行（FIFO）；死亡/冷态先重启。 */
  dispatch(cmd: string, dOpts: PtyDispatchOptions = {}): Promise<PtyDispatchResult> {
    const attempt = async (): Promise<PtyDispatchResult> => {
      const started = Date.now()
      const reconnected = this.state === 'dead'
      if (this.state !== 'ready') await this.start()
      this.inFlight++
      return await new Promise<PtyDispatchResult>((resolve) => {
        const nonce = genNonce()
        let output = ''
        let interrupted = false
        let settled = false
        let interruptTimer: NodeJS.Timeout | undefined
        let killTimer: NodeJS.Timeout | undefined
        const deathWaiter = (): void => finish({ output, exit: null, cwd: null, timedOut: interrupted })
        const cleanup = (): void => {
          this.onChunk = null
          // I1（终审）：已结算 dispatch 的死亡等待必须摘除——否则闭包钉住整段 output，
          // 长命会话每调用累积一个 waiter（init 路径的 filter 同款形态）
          this.deathWaiters = this.deathWaiters.filter((w) => w !== deathWaiter)
          if (interruptTimer !== undefined) clearTimeout(interruptTimer)
          if (killTimer !== undefined) clearTimeout(killTimer)
        }
        const finish = (r: Omit<PtyDispatchResult, 'durationMs' | 'reconnected'>): void => {
          if (settled) return
          settled = true
          cleanup()
          this.inFlight--
          this.lastSettleAt = Date.now()
          this.resetIdleTimer()
          resolve({ ...r, reconnected, durationMs: Date.now() - started })
        }
        const parser = createNonceFrameParser(nonce, {
          onOutput: (t) => {
            output += t
            // C1（终审）：内存安全帽——无帽时一条 cat /dev/urandom 能在 120s 看门狗内
            // 吃垮宿主 daemon。帽上切片避开代理对（首字符为低位代理则让出一字符）。
            if (output.length > OUTPUT_HARD_CAP) {
              output = output.slice(output.length - OUTPUT_HARD_CAP)
              if (output.charCodeAt(0) >= 0xdc00 && output.charCodeAt(0) <= 0xdfff) output = output.slice(1)
            }
          },
          onFrame: ({ exit, cwd }) => finish({ output, exit, cwd, timedOut: interrupted }),
        })
        this.onChunk = (c) => parser.feed(c)
        this.write(wrapPtyCommand(cmd, nonce))
        if (dOpts.stdin !== undefined) this.write(dOpts.stdin) // Ruling 11: REPL 式紧随
        interruptTimer = setTimeout(() => {
          interrupted = true
          // P8 两段打断：\x03 中断前台作业后，交互 bash 会放弃当前命令行的剩余部分
          // （尾部 marker 不再执行）；紧随注入的同 nonce 130-marker 行在 bash 回到
          // 读取态后被执行。无论 bash 弃行还是续行，帧都在宽限内到达且 exit=130，
          // 会话存活；若命令 trap 掉 SIGINT，原 marker 先帧、注入行帧后字节被丢弃。
          this.write('\x03')
          this.write(`printf '\\033]133;D;${nonce};130;%s\\007' "$PWD"\n`)
          killTimer = setTimeout(() => {
            // Ruling 8 的 kill 兜底：宽限无帧 = 会话不可恢复，杀整组后收尸
            // （否则 trap-INT 的卡死进程永生，重连后旧组再不可达）
            this.killTree()
            this.markDead()
            finish({ output, exit: null, cwd: null, timedOut: true })
          }, INTERRUPT_GRACE_MS)
        }, dOpts.timeoutSec === undefined ? 120_000 : dOpts.timeoutSec * 1_000)
        this.deathWaiters.push(deathWaiter)
      })
    }
    const run = this.queue.then(attempt, attempt)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** TTL / row teardown：尽力 exit，1s 后杀组，出池。 */
  async dispose(): Promise<void> {
    if (this.state === 'disposed') return
    this.clearIdleTimer()
    this.state = 'disposed'
    this.startPromise = null
    this.write('exit\n')
    setTimeout(() => this.killTree(), 1_000).unref()
    this.opts.onDead?.()
  }

  private write(s: string): void {
    if (this.proc?.stdin?.writable !== true) return
    try { this.proc.stdin.write(s) } catch { /* dead: death waiter settles the dispatch */ }
  }

  private async start(): Promise<void> {
    if (this.state === 'disposed')
      throw new Error(`[E_SESSION_DISPOSED] remote pty session '${this.opts.key}' was disposed — the pool replaces disposed sessions; this reference is stale`)
    if (this.startPromise === null) {
      this.state = 'starting'
      this.startPromise = this.doStart().catch((err: unknown) => {
        this.startPromise = null
        this.markDead()
        throw err
      })
    }
    return this.startPromise
  }

  private async doStart(): Promise<void> {
    const proc = spawn(this.opts.argv[0]!, this.opts.argv.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Ruling 9: 进程组杀法
    })
    this.proc = proc
    proc.stdout.setEncoding('utf8')
    proc.stdout.on('data', (d: string) => { this.onChunk?.(d) })
    proc.stderr.setEncoding('utf8').on('data', (d: string) => { this.diag = (this.diag + d).slice(-2_000) })
    proc.once('close', () => this.markDead())
    proc.once('error', (err) => { this.diag = (this.diag + `\n[remote: spawn failed: ${err.message}]`).slice(-2_000) })

    const initTimeoutSec = this.opts.initTimeoutSec ?? DEFAULT_INIT_TIMEOUT_SEC
    const initNonce = genNonce()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.killTree()
        reject(new Error(
          `[E_SESSION_START] remote pty session '${this.opts.key}' did not initialize in ${initTimeoutSec}s` +
          (this.diag.length > 0 ? `; transport stderr tail: ${this.diag}` : '')))
      }, initTimeoutSec * 1_000)
      const waiter = (): void => {
        clearTimeout(timer)
        reject(new Error(
          `[E_SESSION_DIED] remote pty session '${this.opts.key}' died before initializing` +
          (this.diag.length > 0 ? `; transport stderr tail: ${this.diag}` : '')))
      }
      this.deathWaiters.push(waiter)
      const parser = createNonceFrameParser(initNonce, {
        onFrame: () => {
          clearTimeout(timer)
          this.deathWaiters = this.deathWaiters.filter((w) => w !== waiter)
          if (this.state === 'disposed') {
            // dispose 竞态 init：不得复活已终态会话（否则重挂 idle timer + 幽灵 ready）
            reject(new Error(`[E_SESSION_DISPOSED] remote pty session '${this.opts.key}' disposed during init`))
            return
          }
          this.state = 'ready'
          this.resetIdleTimer()
          resolve()
        },
      })
      this.onChunk = (c) => parser.feed(c)
      this.write(buildInitCommand(initNonce))
    })
  }

  private markDead(): void {
    if (this.state === 'disposed') {
      // dispose 是终态：不再翻转 state，但在飞 dispatch 的死亡等待仍需立即结算
      // （row teardown 不是超时——不得等 123s 看门狗，也不得错标 timedOut）
      const waiters = this.deathWaiters
      this.deathWaiters = []
      for (const w of waiters) w()
      return
    }
    this.state = 'dead'
    this.startPromise = null
    this.clearIdleTimer()
    const waiters = this.deathWaiters
    this.deathWaiters = []
    for (const w of waiters) w()
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => void this.dispose(), this.opts.idleTtlSec * 1_000)
    this.idleTimer.unref()
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  private killTree(): void {
    const pid = this.proc?.pid
    this.proc = null
    if (pid === undefined) return
    try { process.kill(-pid, 'SIGTERM') } catch { /* already gone */ }
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ } }, 2_000).unref()
  }
}

export interface PtyPoolDefaults { idleTtlSec: number; initTimeoutSec?: number }

/** 会话池：键 → 会话。意外死亡的会话留在池内（下次 dispatch 带 reconnect 提示）。 */
export class PtyPool {
  private readonly sessions = new Map<string, PtySession>()

  constructor(private readonly defaults: PtyPoolDefaults) {}

  get size(): number { return this.sessions.size }

  /** status 面：键上的会话快照（无会话 = undefined → "none — dials on first exec"）。 */
  inspect(key: string): SessionSnapshot | undefined {
    return this.sessions.get(key)?.snapshot
  }

  getOrCreate(key: string, argv: string[]): PtySession {
    let s = this.sessions.get(key)
    if (s === undefined || s.sessionState === 'disposed') {
      s = new PtySession({ key, argv, ...this.defaults, onDead: () => this.sessions.delete(key) })
      this.sessions.set(key, s)
    }
    return s
  }

  async disposeAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => s.dispose()))
    this.sessions.clear()
  }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS（130 断言由 Ruling P8 两段打断保证确定性：交互 bash 弃行→注入行补帧 130；续行→原 marker 报 130；trap INT 忽略→宽限后 kill 兜底 exit null，走另一测试）。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): persistent pty session pool — init protocol, serial dispatch, ^C interrupt, TTL, reconnect notice"`。

---

### Task 6: `RemoteDriver` 调度器 `driver.ts`

**Files:**
- Create: `better-dsh/src/remote/driver.ts`
- Test: `better-dsh/test/remote/driver.spec.ts`

**Interfaces:**
```ts
export interface RemoteCallParams { target?: string; spawn?: string; cmd: string; mode?: 'oneshot' | 'pty'; stdin?: string; timeout?: number }
export interface RemoteCallResult {
  mode: 'oneshot' | 'pty'; target: string; exit: number | null; cwd: string | null
  timedOut: boolean; reconnected: boolean; stdout: string; stderr?: string
  durationMs: number; truncated?: number
}
export interface RemoteAuditRecord { target: string; cmd: string; cwd?: string; exit?: number | null; durationMs?: number; error?: string }
export interface RemoteDriverOptions {
  containers?: Record<string, string>
  execTimeoutSec?: number   // default 120
  idleTtlSec?: number       // default 600 (spec: 10min)
  maxOutputChars?: number   // default 30000
  onAudit?: (r: RemoteAuditRecord) => void
  /** 测试缝：覆写 argv 构造（默认走 buildOneShotArgv / buildPtyArgv / buildSpawnArgv）。 */
  oneshotArgvFor?: (plan: TargetPlan, cmd: string) => string[]
  ptyArgvFor?: (plan: TargetPlan) => string[]
  spawnArgvFor?: (spawnCommand: string) => string[]
}
export class RemoteDriver {
  constructor(opts?: RemoteDriverOptions)
  call(params: RemoteCallParams, callCtx?: { sessionKey?: string }): Promise<RemoteCallResult>
  dispose(): Promise<void>
}
```

- [ ] **Step 1: 写失败测试**（测试缝把 argv 指到本地 bash，其余全真）

```ts
import { describe, expect, it } from 'vitest'
import { RemoteDriver, type RemoteAuditRecord } from '../../src/remote/driver.ts'

const driverWith = (over: Partial<ConstructorParameters<typeof RemoteDriver>[0]> = {}): RemoteDriver =>
  new RemoteDriver({
    oneshotArgvFor: () => ['bash', '-lc', 'echo fixed'],
    ptyArgvFor: () => ['bash'],
    spawnArgvFor: () => ['bash'],
    idleTtlSec: 600,
    ...over,
  })

describe('RemoteDriver validation', () => {
  it('rejects target+spawn and neither (E_PARAMS), and bad timeout (E_BAD_TIMEOUT)', async () => {
    const d = driverWith()
    await expect(d.call({ target: 'dev4', spawn: 'bash', cmd: 'x' })).rejects.toThrow(/E_PARAMS/)
    await expect(d.call({ cmd: 'x' })).rejects.toThrow(/E_PARAMS/)
    await expect(d.call({ target: 'dev4', cmd: 'x', timeout: 0 })).rejects.toThrow(/E_BAD_TIMEOUT/)
    await expect(d.call({ target: 'dev4', cmd: 'x', timeout: Number.POSITIVE_INFINITY })).rejects.toThrow(/E_BAD_TIMEOUT/)
  })
  it('spawn locks mode to pty even if oneshot was asked', async () => {
    const d = driverWith()
    const r = await d.call({ spawn: 'docker exec -it x bash', cmd: 'echo hi', mode: 'oneshot' })
    expect(r.mode).toBe('pty')
    await d.dispose()
  })
})

describe('RemoteDriver routing', () => {
  it('oneshot default: runs the transport argv, returns binary exit + split stderr', async () => {
    const seen: string[][] = []
    const d = new RemoteDriver({
      oneshotArgvFor: (_plan, cmd) => { seen.push(['oneshot', cmd]); return ['bash', '-c', 'echo out; echo err >&2; exit 3'] },
    })
    const r = await d.call({ target: 'dev4', cmd: 'git status' })
    expect(r.mode).toBe('oneshot')
    expect(r.exit).toBe(3)
    expect(r.stdout).toBe('out\n')
    expect(r.stderr).toBe('err\n')
    expect(seen).toEqual([['oneshot', 'git status']])
    await d.dispose()
  })
  it('pty mode: session key isolates agents, state persists per key', async () => {
    const d = driverWith()
    await d.call({ target: 'dev4', mode: 'pty', cmd: 'cd /tmp' }, { sessionKey: 'a1' })
    const r = await d.call({ target: 'dev4', mode: 'pty', cmd: 'pwd' }, { sessionKey: 'a1' })
    expect(r.cwd).toBe('/tmp')
    const r2 = await d.call({ target: 'dev4', mode: 'pty', cmd: 'pwd' }, { sessionKey: 'a2' })
    expect(r2.cwd).not.toBe('/tmp') // different agent, fresh session
    await d.dispose()
  })
  it('truncates oversized output to the tail window with disclosure', async () => {
    const d = new RemoteDriver({
      maxOutputChars: 10,
      oneshotArgvFor: () => ['bash', '-c', 'printf "x%.0s" $(seq 1 100)'],
    })
    const r = await d.call({ target: 'dev4', cmd: 'x' })
    expect(r.truncated).toBe(100)
    expect(r.stdout).toContain('[truncated: showing last 10 of 100 chars]')
    await d.dispose()
  })
  it('emits one audit record per attempt (success, nonzero exit, and error paths)', async () => {
    const audit: RemoteAuditRecord[] = []
    const d = driverWith({ onAudit: (r) => audit.push(r) })
    await d.call({ target: 'dev4', cmd: 'echo ok' })
    const d255 = new RemoteDriver({
      onAudit: (r) => audit.push(r),
      oneshotArgvFor: () => ['bash', '-c', 'exit 255'],
    })
    await d255.call({ target: 'no-such-host-xyz', cmd: 'echo no' }).catch(() => {})
    await expect(d.call({ target: 'a', spawn: 'b', cmd: 'x' })).rejects.toThrow(/E_PARAMS/)
    expect(audit[0]).toMatchObject({ target: 'dev4', cmd: 'echo ok', exit: 0 })
    expect(audit[1]).toMatchObject({ target: 'no-such-host-xyz', exit: 255 })
    expect(audit[2]).toMatchObject({ target: 'a', cmd: 'x', error: expect.stringContaining('E_PARAMS') })
    await d.dispose(); await d255.dispose()
  })
})
```

注：`no-such-host-xyz` 用例经 `exit 255` 缝走**非零退出的成功分支**审计（`runOneShot` 把 exit 收集为数据、不抛错）；真正的 catch 审计路径用 `E_PARAMS` 拒绝断言（`target ?? spawn ?? '?'` 回退）。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 最小实现**

```ts
import { runOneShot } from './oneshot.ts'
import { PtyPool } from './pty-session.ts'
import { tailWindow } from './nonce-framing.ts'
import { resolveTarget, type TargetPlan } from './target.ts'
import { buildOneShotArgv, buildPtyArgv, buildSpawnArgv } from './transports.ts'

export interface RemoteCallParams {
  target?: string
  spawn?: string
  cmd: string
  mode?: 'oneshot' | 'pty'
  stdin?: string
  timeout?: number
}

export interface RemoteCallResult {
  mode: 'oneshot' | 'pty'
  target: string
  exit: number | null
  cwd: string | null
  timedOut: boolean
  reconnected: boolean
  stdout: string
  stderr?: string
  durationMs: number
  truncated?: number
}

export interface RemoteAuditRecord {
  target: string
  cmd: string
  cwd?: string
  exit?: number | null
  durationMs?: number
  error?: string
}

export interface RemoteDriverOptions {
  containers?: Record<string, string>
  execTimeoutSec?: number
  idleTtlSec?: number
  maxOutputChars?: number
  onAudit?: (r: RemoteAuditRecord) => void
  oneshotArgvFor?: (plan: TargetPlan, cmd: string) => string[]
  ptyArgvFor?: (plan: TargetPlan) => string[]
  spawnArgvFor?: (spawnCommand: string) => string[]
}

/** 双轨调度器（spec §七 Phase 2）：参数校验 → 路由 → oneshot 子进程 / pty 会话池。 */
export class RemoteDriver {
  private readonly pool: PtyPool
  constructor(private readonly opts: RemoteDriverOptions = {}) {
    this.pool = new PtyPool({ idleTtlSec: opts.idleTtlSec ?? 600 })
  }

  async call(params: RemoteCallParams, callCtx: { sessionKey?: string } = {}): Promise<RemoteCallResult> {
    const started = Date.now()
    try {
      const routing = this.route(params)
      const result = await this.execute(params, routing, callCtx)
      this.audit({
        target: routing.display, cmd: params.cmd, cwd: result.cwd ?? undefined,
        exit: result.exit, durationMs: Date.now() - started,
      })
      return result
    } catch (error) {
      this.audit({
        target: params.target ?? params.spawn ?? '?', cmd: params.cmd,
        error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started,
      })
      throw error
    }
  }

  /** Ruling 13：审计 best-effort——钩子抛错不得影响命令路径（成功被毒化成失败+双重审计）。 */
  private audit(r: RemoteAuditRecord): void {
    try { this.opts.onAudit?.(r) } catch { /* audit hook failure is never the command's failure */ }
  }

  private route(params: RemoteCallParams): { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; spawn?: string } {
    const hasTarget = params.target !== undefined && params.target.length > 0
    const hasSpawn = params.spawn !== undefined && params.spawn.length > 0
    if (hasTarget && hasSpawn)
      throw new Error('[E_PARAMS] remote: pass exactly one of target or spawn, not both')
    if (!hasTarget && !hasSpawn)
      throw new Error('[E_PARAMS] remote: target or spawn is required (e.g. { target: "dev4", cmd: "git status" })')
    if (params.timeout !== undefined && (!Number.isFinite(params.timeout) || params.timeout <= 0))
      throw new Error(`[E_BAD_TIMEOUT] remote: timeout must be a positive number of seconds (got ${JSON.stringify(params.timeout)})`)
    if (params.stdin !== undefined && (params.cmd === undefined || params.cmd.length === 0))
      throw new Error('[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd')
    const mode: 'oneshot' | 'pty' = hasSpawn ? 'pty' : params.mode ?? 'oneshot'
    if (hasSpawn) return { mode, display: params.spawn!, spawn: params.spawn }
    return { mode, display: params.target!, plan: resolveTarget(params.target!, this.opts.containers ?? {}) }
  }

  private async execute(params: RemoteCallParams, routing: { mode: 'oneshot' | 'pty'; display: string; plan?: TargetPlan; spawn?: string }, callCtx: { sessionKey?: string }): Promise<RemoteCallResult> {
    const timeoutSec = params.timeout ?? this.opts.execTimeoutSec ?? 120
    const cap = this.opts.maxOutputChars ?? 30_000
    if (routing.mode === 'oneshot') {
      const argv = (this.opts.oneshotArgvFor ?? buildOneShotArgv)(routing.plan!, params.cmd)
      const r = await runOneShot(argv, { stdin: params.stdin, timeoutSec })
      const out = tailWindow(r.stdout, cap)
      const err = r.stderr.length > 0 ? tailWindow(r.stderr, cap) : undefined
      return {
        mode: 'oneshot', target: routing.display, exit: r.exit, cwd: null,
        timedOut: r.timedOut, reconnected: false, stdout: out.text,
        ...(err !== undefined ? { stderr: err.text } : {}), durationMs: r.durationMs,
        ...(out.truncated !== undefined ? { truncated: out.truncated } : {}),
      }
    }
    const argv = routing.spawn !== undefined
      ? (this.opts.spawnArgvFor ?? buildSpawnArgv)(routing.spawn)
      : (this.opts.ptyArgvFor ?? buildPtyArgv)(routing.plan!)
    const key = `${callCtx.sessionKey ?? 'no-session'}|${routing.spawn !== undefined ? `s:${routing.spawn}` : `t:${routing.display}`}`
    const session = this.pool.getOrCreate(key, argv)
    const r = await session.dispatch(params.cmd, { stdin: params.stdin, timeoutSec })
    const out = tailWindow(r.output, cap)
    return {
      mode: 'pty', target: routing.display, exit: r.exit, cwd: r.cwd,
      timedOut: r.timedOut, reconnected: r.reconnected, stdout: out.text,
      durationMs: r.durationMs, ...(out.truncated !== undefined ? { truncated: out.truncated } : {}),
    }
  }

  async dispose(): Promise<void> { await this.pool.disposeAll() }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): two-track driver — routing matrix, agent-scoped session keys, audit hook"`。

---

### Task 7: 状态面 `status.ts`（诚实词汇表 + on-demand 探测）

**Files:**
- Create: `better-dsh/src/remote/status.ts`
- Test: `better-dsh/test/remote/status.spec.ts`

**Interfaces:**
```ts
export type ProbeOutcome =
  | { state: 'reachable'; rttMs: number }
  | { state: 'unreachable'; detail: string }          // 含原生 stderr 单行 / 超时标注
  | { state: 'container'; status: string }            // running / stopped / exited …（事实态）
  | { state: 'error'; detail: string }                // CLI 级错误（No such object 等，原样）
export interface ProbeOptions {
  connectTimeoutSec?: number   // default 5（ssh ConnectTimeout）
  hardTimeoutSec?: number      // default 10（外层硬顶，Ruling 17 双重超时）
  runner?: typeof runOneShot   // 测试缝
}
export async function probeTarget(plan: TargetPlan, opts?: ProbeOptions): Promise<ProbeOutcome>
export function renderProbe(p: ProbeOutcome): string
/** Ruling P12：renderSession 只消费 state/busy/idleMs 三字段（Pick 超集，测试字面量无需 pid）。 */
export function renderSession(s: Pick<SessionSnapshot, 'state' | 'busy' | 'idleMs'> | undefined): string
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { probeTarget, renderProbe, renderSession } from '../../src/remote/status.ts'
import type { OneShotResult } from '../../src/remote/oneshot.ts'

const R = (over: Partial<OneShotResult>): OneShotResult =>
  ({ exit: 0, timedOut: false, stdout: '', stderr: '', durationMs: 10, ...over })

describe('probeTarget vocabulary (Ruling 16 — offline is banned)', () => {
  it('ssh exit 0 -> reachable with rtt', async () => {
    const p = await probeTarget({ kind: 'ssh', host: 'dev4' }, { runner: async () => R({}) })
    expect(p).toMatchObject({ state: 'reachable' })
    expect(p.state === 'reachable' && p.rttMs).toBeGreaterThanOrEqual(0)
    expect(renderProbe(p)).toContain('reachable')
  })
  it('ssh failure -> unreachable + native stderr verbatim, never "offline"', async () => {
    const p = await probeTarget({ kind: 'ssh', host: 'x' }, {
      runner: async () => R({ exit: 255, stderr: 'ssh: connect to host x port 22: Connection timed out\r\n' }),
    })
    expect(p.state).toBe('unreachable')
    expect(p.state === 'unreachable' && p.detail).toContain('Connection timed out')
    const text = renderProbe(p)
    expect(text).toContain('unreachable')
    expect(text).not.toContain('offline')
  })
  it('ssh hang -> hard timeout labeled', async () => {
    const p = await probeTarget({ kind: 'ssh', host: 'x' }, {
      runner: async () => R({ exit: null, timedOut: true }),
    })
    expect(p).toMatchObject({ state: 'unreachable', detail: expect.stringContaining('probe timed out after 10s') })
  })
  it('docker inspect -> factual container state; native error passes through', async () => {
    const p1 = await probeTarget({ kind: 'docker', container: 'c1' }, { runner: async () => R({ stdout: 'running\n' }) })
    expect(p1).toEqual({ state: 'container', status: 'running' })
    const p2 = await probeTarget({ kind: 'docker', container: 'nope' }, {
      runner: async () => R({ exit: 1, stderr: 'Error: No such object: nope\n' }),
    })
    expect(p2).toMatchObject({ state: 'error', detail: expect.stringContaining('No such object') })
  })
  it('incus csv -> exact-name row status; missing name -> explicit error', async () => {
    const out = 'ctr-1,RUNNING\nctr-11,STOPPED\n'
    const p1 = await probeTarget({ kind: 'incus', container: 'ctr-1' }, { runner: async () => R({ stdout: out }) })
    expect(p1).toEqual({ state: 'container', status: 'RUNNING' })
    const p2 = await probeTarget({ kind: 'incus', container: 'zz' }, { runner: async () => R({ stdout: out }) })
    expect(p2).toMatchObject({ state: 'error', detail: expect.stringContaining("no container named 'zz'") })
  })
})

describe('renderSession (session layer, Ruling 16)', () => {
  it('undefined -> none, says dial-on-first-exec, no reachability claim', () => {
    expect(renderSession(undefined)).toBe('session: none — dials on first exec')
  })
  it('ready+quiet -> idle with age; busy -> busy; dead -> died notice', () => {
    expect(renderSession({ state: 'ready', busy: false, idleMs: 45_000 })).toBe('session: idle 45s (connected)')
    expect(renderSession({ state: 'ready', busy: true, idleMs: 0 })).toBe('session: busy (a command is running)')
    expect(renderSession({ state: 'dead', busy: false, idleMs: null })).toBe('session: died — next exec cold-starts a fresh shell')
  })
})
```

- [ ] **Step 2: 跑测试确认失败** — `npm test -- test/remote/status.spec.ts` → FAIL。

- [ ] **Step 3: 最小实现**

```ts
import { runOneShot, type OneShotOptions, type OneShotResult } from './oneshot.ts'
import type { SessionSnapshot } from './pty-session.ts'
import type { TargetPlan } from './target.ts'

/** Ruling 16 词汇表的机器面。 */
export type ProbeOutcome =
  | { state: 'reachable'; rttMs: number }
  | { state: 'unreachable'; detail: string }
  | { state: 'container'; status: string }
  | { state: 'error'; detail: string }

export interface ProbeOptions {
  connectTimeoutSec?: number
  hardTimeoutSec?: number
  runner?: (argv: string[], opts?: OneShotOptions) => Promise<OneShotResult>
}

function oneLine(s: string): string {
  return s.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
}

/**
 * On-demand 探测（Ruling 17）：调用瞬间拨一次，双重超时（ssh ConnectTimeout
 * 5s + 外层 hard 10s），结果即当时事实。绝不缓存、绝不在 boot 时扫。
 */
export async function probeTarget(plan: TargetPlan, opts: ProbeOptions = {}): Promise<ProbeOutcome> {
  const ct = opts.connectTimeoutSec ?? 5
  const hard = opts.hardTimeoutSec ?? 10
  const runner = opts.runner ?? runOneShot
  const started = Date.now()
  const argv =
    plan.kind === 'ssh'
      ? ['ssh', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${ct}`, '-T', '--', plan.host, 'true']
      : plan.kind === 'docker'
        ? ['docker', 'inspect', '--format', '{{.State.Status}}', plan.container]
        : ['incus', 'list', plan.container, '--format', 'csv', '--columns', 'ns']
  const r = await runner(argv, { timeoutSec: hard })
  if (plan.kind === 'ssh') {
    if (r.exit === 0 && !r.timedOut) return { state: 'reachable', rttMs: Date.now() - started }
    const detail = r.timedOut
      ? `probe timed out after ${hard}s`
      : oneLine(r.stderr) || `ssh exited ${r.exit}`
    return { state: 'unreachable', detail }
  }
  if (plan.kind === 'docker') {
    if (r.exit === 0 && !r.timedOut) return { state: 'container', status: r.stdout.trim() }
    return { state: 'error', detail: oneLine(r.stderr) || `docker inspect exited ${r.exit}` }
  }
  const row = r.stdout.trim().split(/\r?\n/).find((l) => l.split(',')[0] === plan.container)
  if (r.exit === 0 && !r.timedOut && row !== undefined) return { state: 'container', status: row.split(',')[1]?.trim() ?? 'unknown' }
  if (r.exit === 0 && !r.timedOut) return { state: 'error', detail: `incus list has no container named '${plan.container}'` }
  return { state: 'error', detail: oneLine(r.stderr) || `incus exited ${r.exit}` }
}

export function renderProbe(p: ProbeOutcome): string {
  switch (p.state) {
    case 'reachable': return `probe: reachable in ${p.rttMs}ms (just now, on demand)`
    case 'unreachable': return `probe: unreachable — ${p.detail}`
    case 'error': return `probe: error — ${p.detail}`
    case 'container': return `probe: container ${p.status} (just now, on demand)`
  }
}

export function renderSession(s: Pick<SessionSnapshot, 'state' | 'busy' | 'idleMs'> | undefined): string {
  if (s === undefined || s.state === 'cold' || s.state === 'starting' || s.state === 'disposed')
    return 'session: none — dials on first exec'
  if (s.state === 'dead') return 'session: died — next exec cold-starts a fresh shell'
  if (s.busy) return 'session: busy (a command is running)'
  return `session: idle ${Math.round((s.idleMs ?? 0) / 1000)}s (connected)`
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): on-demand status probe — honest vocabulary (reachable/unreachable/container fact), session layer render"`。

---

### Task 8: driver 状态集成 + 模型面工具 `tool.ts`

**Files:**
- Create: `better-dsh/src/remote/tool.ts`
- Modify: `better-dsh/src/remote/driver.ts`（增 `status()` 方法 + `probeRunner` 测试缝）
- Test: `better-dsh/test/remote/tool.spec.ts`

**Interfaces:**
```ts
// driver.ts 增量：
export interface RemoteDriverOptions { /* …Task 6 全部字段… */ probeRunner?: ProbeOptions['runner'] }
export class RemoteDriver { /* …Task 6 全部成员… */ status(target: string, callCtx?: { sessionKey?: string }): Promise<string> }
// tool.ts：
export function createRemoteTool(driver: RemoteDriver, opts?: { getSessionKey?: (exec: ToolRunContext) => string }): ToolDefinition
```
（`defineTool` / `ToolRunContext` 来自 `@deepseek-ai/dsh-tools`，`ContentBlock` 来自 `@deepseek-ai/dsh-llm`——照 RM0 `src/remote/tool.ts` 的 import 面；RM0 文件在 `.worktrees/remote-tool-rm0/better-dsh/src/remote/tool.ts`，结构样板。）

> **Ruling P13（2026-09-23，Task 8 实测裁决）**：本 Task 代码块以"tsc 零新增"门为准做 6 处**类型层** harmonization（RM0 形态）：①value 信封 `cwd?: string` 且**非 null 才置键**（置 `cwd: null` 会越工具自身声明的 output schema——计划原稿 bug）；②guard 后 `args.target as string` / `args.cmd as string`（带注释）；③spec 的 execute 结果 cast（`Promise<unknown>` 面）；④driver 增量 import 补 `type ProbeOptions`。运行时语义与断言逐字不变。

**driver.ts 增量代码（并入 Task 6 骨架）：**

```ts
import { probeTarget, renderProbe, renderSession } from './status.ts'
// RemoteDriverOptions 增一个测试缝字段：
//   probeRunner?: ProbeOptions['runner']

  /** Ruling 16/17：on-demand 探测 + 会话层，两行如实陈述。 */
  async status(target: string, callCtx: { sessionKey?: string } = {}): Promise<string> {
    const plan = resolveTarget(target, this.opts.containers ?? {})
    const head = `${target} — ${plan.kind === 'ssh' ? 'ssh host' : `${plan.kind} container`}`
    const probe = await probeTarget(plan, { runner: this.opts.probeRunner })
    const key = `${callCtx.sessionKey ?? 'no-session'}|t:${target}`
    return [head, renderProbe(probe), renderSession(this.pool.inspect(key))].join('\n')
  }
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createRemoteTool } from '../../src/remote/tool.ts'
import { RemoteDriver } from '../../src/remote/driver.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

const fakeDriver = (): RemoteDriver =>
  new RemoteDriver({
    oneshotArgvFor: () => ['bash', '-c', 'echo out'],
    ptyArgvFor: () => ['bash'],
    spawnArgvFor: () => ['bash'],
  })

const fakeExec = (): { exec: ToolRunContext; appended: Array<[string, unknown]> } => {
  const appended: Array<[string, unknown]> = []
  const exec = {
    agent: { id: 'agent-1', session: { append: (k: string, v: unknown) => appended.push([k, v]) } },
  } as unknown as ToolRunContext
  return { exec, appended }
}

describe('createRemoteTool', () => {
  it('registers under the name "remote"', () => {
    expect(createRemoteTool(fakeDriver()).name).toBe('remote')
  })
  it('executes through the driver and returns the value envelope', async () => {
    const tool = createRemoteTool(fakeDriver())
    const { exec, appended } = fakeExec()
    const v = await tool.execute!({ target: 'dev4', cmd: 'echo out' } as never, exec)
    expect(v.text).toBe('out\n')
    expect(v.exit).toBe(0)
    expect(appended).toHaveLength(1)
    expect(appended[0]![0]).toBe('dashr/remote-exec')
  })
  it('renders output + footer (+cwd), stderr block, and the reconnect notice line', async () => {
    const tool = createRemoteTool(fakeDriver())
    const blocks = tool.output!.render!({} as never, {
      kind: 'exec', text: 'hello', exit: 0, durationMs: 1500, cwd: '/data', reconnected: true,
    } as never)
    const text = (blocks[0] as { type: string; text: string }).text
    expect(text).toContain('[remote: session reconnected to fresh shell; cwd reset to default]')
    expect(text).toContain('hello')
    expect(text).toContain('[exit 0 · 1.5s · cwd /data]')
    const blocks2 = tool.output!.render!({} as never, {
      kind: 'exec', text: 'x', exit: 1, durationMs: 100, stderr: 'boom', timedOut: true, truncated: 999,
    } as never)
    const text2 = (blocks2[0] as { type: string; text: string }).text
    expect(text2).toContain('interrupted')
    expect(text2).toContain('truncated, original 999 chars')
    expect(text2).toContain('[stderr]\nboom')
  })
  it('parameter violations fail before any execution', async () => {
    const tool = createRemoteTool(fakeDriver())
    const { exec } = fakeExec()
    await expect(tool.execute!({ target: 'a', spawn: 'b', cmd: 'x' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    await expect(tool.execute!({ cmd: 'x' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    await expect(tool.execute!({ spawn: 'docker exec -it x bash' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    await expect(tool.execute!({} as never, exec)).rejects.toThrow(/discovery is yours/)
  })
  it('cmd-less target call = on-demand status, honest vocabulary, never "offline"', async () => {
    const d = new RemoteDriver({
      probeRunner: async () => ({ exit: 0, timedOut: false, stdout: '', stderr: '', durationMs: 240 }),
    })
    const tool = createRemoteTool(d)
    const { exec } = fakeExec()
    const v = await tool.execute!({ target: 'dev4' } as never, exec)
    expect(v.kind).toBe('status')
    expect(v.text).toContain('dev4 — ssh host')
    expect(v.text).toContain('reachable')
    expect(v.text).toContain('session: none — dials on first exec')
    expect(v.text).not.toContain('offline')
  })
  it('failed exec attempts append an error audit record before rethrowing', async () => {
    const tool = createRemoteTool(fakeDriver())
    const { exec, appended } = fakeExec()
    await expect(tool.execute!({ target: 'a', spawn: 'b', cmd: 'x' } as never, exec)).rejects.toThrow(/E_PARAMS/)
    expect(appended).toHaveLength(1)
    expect(appended[0]![1]).toMatchObject({ target: 'a', cmd: 'x', error: expect.stringContaining('E_PARAMS') })
  })
  it('garbage mode and stdin-without-cmd fail loud before any execution', async () => {
    const tool = createRemoteTool(fakeDriver())
    const { exec } = fakeExec()
    await expect(tool.execute!({ target: 'dev4', cmd: 'x', mode: 'pty ' } as never, exec)).rejects.toThrow(/E_BAD_MODE/)
    await expect(tool.execute!({ target: 'dev4', stdin: 's' } as never, exec)).rejects.toThrow(/E_STDIN_WITHOUT_CMD/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 最小实现**（骨架照 RM0 tool.ts；description 按 spec §三/§四 范式写全）

```ts
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session/types'
import { RECONNECT_NOTICE } from './pty-session.ts'
import type { RemoteCallResult, RemoteDriver } from './driver.ts'

/** 会话审计记录（RM0 Ruling 10 形态连续）。 */
export interface RemoteExecAudit {
  target?: string
  cmd?: string
  cwd?: string
  exit?: number | null
  durationMs?: number
  error?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'dashr/remote-exec': RemoteExecAudit
  }
}

interface RemoteToolValue {
  kind: 'exec' | 'status'
  text: string
  exit: number | null
  durationMs: number
  /** P13：schema 推断为 string——非 null 才置键（`cwd: null` 会越 output schema）。 */
  cwd?: string
  stderr?: string
  timedOut?: boolean
  reconnected?: boolean
  truncated?: number
}

const NO_SESSION_KEY = 'remote:no-session'

export function createRemoteTool(
  driver: RemoteDriver,
  opts: { getSessionKey?: (exec: ToolRunContext) => string } = {},
): ToolDefinition {
  const getSessionKey = opts.getSessionKey ?? ((exec: ToolRunContext) => exec.agent?.id ?? NO_SESSION_KEY)
  return defineTool({
    name: 'remote',
    description:
      'Run a command on a remote host or container. Two tracks: oneshot (default) runs `bash -lc` statelessly — fast, ' +
      'parallel, zero residue, the exit code is the process\'s own; mode "pty" keeps one persistent terminal session ' +
      'per (agent, target): cwd/env survive across calls, Ctrl-C interrupts work, sudo password prompts are possible. ' +
      '`target` routes smartly: an ssh host name/IP/domain goes over ssh; "docker:<name>" / "incus:<name>" (or a ' +
      'server-registered alias) go to that container; an explicit "ssh:<name>" selector always forces ssh — use it ' +
      'when a bare name is ambiguous (e.g. registered as a container alias but also an ssh host). ' +
      '`spawn` is the BYO-PTY escape hatch: give the full command that ' +
      'starts an interactive shell (e.g. "docker exec -it img bash" or "ssh -t jump \'docker exec -it runner bash\'") ' +
      'and the tool hosts its PTY with nonce framing (mode locks to pty). Nested hops are dumb pipes — only the ' +
      'innermost bash frames. `stdin` feeds the command\'s input; `timeout` (seconds) interrupts then kills. Native ' +
      'transport errors pass through verbatim — self-correct from them. Background processes must redirect their own ' +
      'output (`cmd > log 2>&1 &`): the shared terminal is POSIX behavior, not a tool defect. ' +
      'Omit `cmd` (with `target`) for an on-demand status probe: the tool dials once right then, bounded (5s connect / ' +
      '10s hard), and reports honestly — "reachable"/"unreachable — <native error>" for ssh, the factual container ' +
      'state for docker/incus, plus the session layer ("idle Ns", "busy", or "none — dials on first exec"). It never ' +
      'reports "offline": a connection not existing says nothing about the target. Probes run at call time, never ' +
      'cached from boot. Discovery of valid names is yours: read ~/.ssh/config, `docker ps`, `incus list` with your ' +
      'local tools.',
    parameters: {
      target: { type: 'string', description: 'SSH host / IP / domain, or docker:<name> / incus:<name> container, or a registered alias. Omit when using spawn.' },
      spawn: { type: 'string', description: 'BYO-PTY: full command starting an interactive shell; the tool hosts the PTY + framing. Mode locks to pty.' },
      cmd: { type: 'string', description: 'One raw shell string parsed by the remote bash (multi-line = one compound; exit = last command\'s). Omit (with target) for an on-demand status probe.' },
      mode: { type: 'string', description: "'oneshot' (default) or 'pty' (persistent session)." },
      stdin: { type: 'string', description: 'Optional input fed to the command (oneshot pipe, or written right after it on the pty).' },
      timeout: { type: 'number', description: 'Per-command timeout in seconds (default 120). pty: Ctrl-C then kill.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true, enum: ['exec', 'status'] },
          text: { type: 'string', required: true },
          exit: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
          durationMs: { type: 'integer' },
          cwd: { type: 'string' },
          stderr: { type: 'string' },
          timedOut: { type: 'boolean' },
          reconnected: { type: 'boolean' },
          truncated: { type: 'integer' },
        },
      },
      render: (_args, value): ContentBlock[] => [{ type: 'text', text: renderValue(value as RemoteToolValue) }],
    },
    async execute(args, exec): Promise<RemoteToolValue> {
      const hasCmd = typeof args.cmd === 'string' && args.cmd.length > 0
      const hasTarget = typeof args.target === 'string' && args.target.length > 0
      const hasSpawn = typeof args.spawn === 'string' && args.spawn.length > 0
      // fail-loud 三闸：垃圾 mode 不静默降级；status 面不吃 stdin。
      if (args.mode !== undefined && args.mode !== 'oneshot' && args.mode !== 'pty')
        throw new Error(`[E_BAD_MODE] remote: mode must be 'oneshot' or 'pty' (got ${JSON.stringify(args.mode)})`)
      // cmd 缺省 + target 在场 = on-demand status（Ruling 16/17）；spawn 无可探测物。
      if (!hasCmd) {
        if (args.stdin !== undefined)
          throw new Error('[E_STDIN_WITHOUT_CMD] remote: stdin requires cmd — status probes take no input')
        if (hasSpawn)
          throw new Error('[E_PARAMS] remote: spawn is an exec channel — pass cmd (there is nothing to probe for BYO-PTY)')
        if (!hasTarget)
          throw new Error(
            '[E_PARAMS] remote: target or spawn is required; discovery is yours — read ~/.ssh/config, ' +
            '`docker ps`, `incus list` with your local tools')
        const text = await driver.status(args.target as string, { sessionKey: getSessionKey(exec) })
        return { kind: 'status', text, exit: null, durationMs: 0 }
      }
      try {
        const r: RemoteCallResult = await driver.call(
          {
            target: args.target, spawn: args.spawn, cmd: args.cmd as string,
            mode: args.mode === 'oneshot' || args.mode === 'pty' ? args.mode : undefined,
            stdin: args.stdin, timeout: args.timeout,
          },
          { sessionKey: getSessionKey(exec) },
        )
        appendAudit(exec, { target: r.target, cmd: args.cmd, cwd: r.cwd ?? undefined, exit: r.exit, durationMs: r.durationMs })
        const v: RemoteToolValue = { kind: 'exec', text: r.stdout, exit: r.exit, durationMs: r.durationMs }
        if (r.cwd !== null) v.cwd = r.cwd
        if (r.stderr !== undefined) v.stderr = r.stderr
        if (r.timedOut) v.timedOut = true
        if (r.reconnected) v.reconnected = true
        if (r.truncated !== undefined) v.truncated = r.truncated
        return v
      } catch (error) {
        // Ruling 13：失败的 exec 尝试同样落审计（RM0 Ruling 10 形态），随后原样重抛
        appendAudit(exec, {
          target: args.target ?? args.spawn, cmd: args.cmd,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    },
  })
}

function renderValue(v: RemoteToolValue): string {
  if (v.kind === 'status') return v.text
  const parts: string[] = []
  if (v.reconnected === true) parts.push(RECONNECT_NOTICE)
  parts.push(v.text)
  const secs = ((v.durationMs ?? 0) / 1_000).toFixed(1)
  const markers: string[] = []
  if (v.timedOut === true) markers.push('interrupted')
  if (v.truncated !== undefined) markers.push(`truncated, original ${v.truncated} chars`)
  const suffix = markers.length > 0 ? ` · ${markers.join(' · ')}` : ''
  const cwdTag = typeof v.cwd === 'string' && v.cwd.length > 0 ? ` · cwd ${v.cwd}` : ''
  parts.push(`[exit ${v.exit} · ${secs}s${suffix}${cwdTag}]`)
  if (v.stderr !== undefined && v.stderr.length > 0) parts.push('[stderr]', v.stderr)
  return parts.join('\n')
}

function appendAudit(exec: ToolRunContext, data: RemoteExecAudit): void {
  try { exec.agent?.session.append('dashr/remote-exec', data) } catch { /* best-effort by contract */ }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): model-facing remote tool — exec + on-demand status face, transparent errors, audit event"`。

---

### Task 9: `dashr-remote` 插件行接线 `plugin.ts` + 全量绿

**Files:**
- Create: `better-dsh/src/remote/plugin.ts`
- Modify: `better-dsh/package.json`（exports 增 `"./remote"`，紧随 `"./mobile"` 后）
- Modify: `better-dsh/tsdown.config.ts`（entry 增 `'src/remote/plugin.ts'`）
- Modify: `better-dsh/cordis.patch.yml`（bundles 段落内、`compaction-basic` 行之前插 `- id: dashr-remote` 行，注释风格对齐 RM0）
- Test: `better-dsh/test/remote/plugin.spec.ts`

**Interfaces:**
```ts
export const name = 'dashr-remote'
export const Config: z<RemoteRowConfig>   // { containers: Record<string,string>; execTimeoutSec: number; idleTtlSec: number; maxOutputChars: number }
export const apply = (ctx: Context, config: RemoteRowConfig): (() => void) | void
export default { name, inject: [], Config, apply }
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { apply, Config, name } from '../../src/remote/plugin.ts'
import type { Context } from '@deepseek-ai/cordis'

describe('dashr-remote row', () => {
  it('Config defaults: no containers, 120s exec, 600s TTL, 30000 chars', () => {
    const c = Config(undefined) as { containers: unknown; execTimeoutSec: number; idleTtlSec: number; maxOutputChars: number }
    expect(c).toMatchObject({ containers: {}, execTimeoutSec: 120, idleTtlSec: 600, maxOutputChars: 30_000 })
  })
  it('mounts dormant without tools, registers the remote tool when tools compose, disposer is safe', () => {
    expect(name).toBe('dashr-remote')
    const registered: Array<{ name: string }> = []
    const fakeCtx = {
      inject: (_deps: string[], fn: (c: unknown) => void) => {
        fn({ tools: { register: (t: { name: string }) => registered.push(t) } })
      },
    } as unknown as Context
    const disposer = apply(fakeCtx, Config(undefined) as never) as () => void
    expect(registered).toHaveLength(1)
    expect(registered[0]!.name).toBe('remote')
    expect(() => disposer()).not.toThrow()
  })
  it('patch row and build wiring are in place', async () => {
    const patch = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'))
    expect(patch).toContain('- id: dashr-remote')
    expect(patch).toContain("name: 'better-dsh/remote'")
    const pkg = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')))
    expect(pkg.exports['./remote']).toEqual({ types: './lib/remote/plugin.d.ts', default: './lib/remote/plugin.js' })
    const tsd = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../tsdown.config.ts', import.meta.url), 'utf8'))
    expect(tsd).toContain("'src/remote/plugin.ts'")
  })
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 最小实现**

```ts
/**
 * `dashr-remote` — the remote-execution-framework row (plan
 * docs/10_plans/2026-09-23-remote-framework-impl.md Task 9; spec
 * docs/10_plans/2026-09-23-remote-execution-framework.md). Same row shape as
 * `src/mobile/plugin.ts` / the archived RM0 row: one bundle-patch row that,
 * when a `tools` service is composed, boots one RemoteDriver and registers
 * the model-facing `remote` tool. The driver (pty session pool + idle timers)
 * is disposed with the row's fiber. Zero static injects: loads dormant in
 * compositions without tools.
 */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { RemoteDriver } from './driver.ts'
import { createRemoteTool } from './tool.ts'

export const name = 'dashr-remote'
export const inject: string[] = []

/** 已知容器裸名 → 'docker:<name>' / 'incus:<name>'（Ruling 12）。 */
export interface RemoteRowConfig {
  containers: Record<string, string>
  execTimeoutSec: number
  idleTtlSec: number
  maxOutputChars: number
}

export const Config: z<RemoteRowConfig> = z
  .object({
    containers: z.dict(z.string()).default({}),
    execTimeoutSec: z.natural().min(1).default(120),
    idleTtlSec: z.natural().min(1).default(600),
    maxOutputChars: z.natural().min(1).default(30_000),
  })
  .default({ containers: {}, execTimeoutSec: 120, idleTtlSec: 600, maxOutputChars: 30_000 }) as unknown as z<RemoteRowConfig>

/** MUST stay an arrow（RM0 plugin.ts 同注：function 声明会被 cordis 当构造器 new 掉，返回的 disposer 丢失）。 */
export const apply = (ctx: Context, config: RemoteRowConfig): (() => void) => {
  const driver = new RemoteDriver({
    containers: config.containers,
    execTimeoutSec: config.execTimeoutSec,
    idleTtlSec: config.idleTtlSec,
    maxOutputChars: config.maxOutputChars,
  })
  ctx.inject(['tools'], (toolsCtx: Context) => {
    toolsCtx.tools.register(
      createRemoteTool(driver, { getSessionKey: (exec) => exec.agent?.id ?? 'remote:no-session' }),
    )
  })
  return () => void driver.dispose()
}

export default { name, inject, Config, apply }
```

package.json exports（`"./mobile"` 条目后插）：
```json
  "./remote": {
    "types": "./lib/remote/plugin.d.ts",
    "default": "./lib/remote/plugin.js"
  },
```

tsdown.config.ts entry 数组 `'src/mobile/plugin.ts'` 后插 `'src/remote/plugin.ts'`。

cordis.patch.yml（RM0 同位、同注释风格）：
```yaml
    # Remote execution framework (plan 2026-09-23-remote-framework-impl.md):
    # `remote` tool face — two-track (oneshot default / pty opt-in), CLI
    # transports (ssh/docker/incus), BYO-PTY spawn, nonce framing, 10min TTL.
    # All config defaults, so the row carries no config block.
    - id: dashr-remote
      name: 'better-dsh/remote'
```

- [ ] **Step 4: 全量绿 + 类型零**

```bash
cd better-dsh
npm test                 # 全量（含既有套件）
npx tsc --noEmit         # 0 errors
```

- [ ] **Step 5: Commit** — `git commit -m "feat(remote): dashr-remote composition row — driver + tool wiring, exports/entry/patch"`。

---

### Task 10: Phase-4 实测回归（真 targets + 第一人称）与报告

**Files:**
- Create: `docs/50_test-reports/2026-09-23-remote-framework实测报告.md`

**前置事实（已勘）**：`dev4` BatchMode SSH 可达（bash 5.2.21）；本机 `incus` 有运行中 `ctr-1`；`docker` 有 `corti`/`jellyfin`（**勿动这两个**——临时容器自起自清）；`/usr/bin/script` 在位；`~/.ssh/config` 的 `ctr-1` Host 与容器别名同名（别名优先路由是设计内行为）。

- [ ] **Step 1: rsync 进 monorepo + 双半构建**（AGENTS.md §二 日常回归循环，注意 lib/client 清洗陷阱）

```bash
rsync -a --delete --exclude node_modules --exclude lib --exclude .venv-kernel --exclude .uv-cache --exclude docs \
  ~/workspaces/dashr/.worktrees/remote-framework/better-dsh/ \
  ~/workspaces/dashr/upstream/deepseek-harness/packages/better-dsh/better-dsh/
cd ~/workspaces/dashr/upstream/deepseek-harness
pnpm --filter better-dsh exec tsdown
cd packages/better-dsh/better-dsh && ../../../node_modules/.bin/tsx scripts/build-client.ts && cd ../../..
```

- [ ] **Step 2: 起 dev 实例**（`bash .tests/dsh-test1/start-4999.sh PORT=4986`；端口被占则换；boot 必须走构建产物 `apps/cli/lib/bin.js`——脚本已内置）

- [ ] **Step 3: 配置面冒烟**

```bash
DSH_HOME=/home/u1/workspaces/dashr/.dsh-test node apps/cli/src/bin.ts web --dump-config | grep -B1 -A6 'dashr-remote'
```
Expected: `dashr-remote` 行在位（默认 config 生效）。鉴权拉 shell 页 → boot graph 含 `"id":"better-dsh"` 与 `/plugins/??better-dsh/remote/client 无关`（本 row 无 client 半——只验 lib 产物 `/lib/remote/plugin.js` 在 dist 内）。

- [ ] **Step 4: 第一人称实测矩阵**（真实 agent session 通过 web 界面调 `remote` 工具；每项记 exit/cwd/时长/原始输出）：

  | # | case | 调用 | 判据 |
    |---|---|---|---|
  | 1 | ssh oneshot | `{target:'dev4', cmd:'echo ok && git --version'}` | exit 0，输出含 ok 与 git 版本 |
  | 2 | ssh oneshot 退出码透传 | `{target:'dev4', cmd:'exit 42'}` | exit 42（无字符串解析） |
  | 3 | ssh oneshot 复合语法 | `{target:'dev4', cmd:'ls | head -1 && echo $HOME'}` | 管道+变量展开正常（单层转义证明） |
  | 4 | ssh pty 状态保持 | 两连击：`{target:'dev4',mode:'pty',cmd:'cd /tmp && export F=1'}` → `{target:'dev4',mode:'pty',cmd:'pwd && echo $F'}` | 第二击 `/tmp` + `1` |
  | 5 | ssh pty 多行单帧 | `{target:'dev4',mode:'pty',cmd:'echo a\necho b'}` | 一帧，a/b，exit 0 |
  | 6 | ssh pty 伪 marker 免疫 | `{target:'dev4',mode:'pty',cmd:"printf '\\x1b]133;D;deadbeefdeadbeef;99;/pwn\\x07'; echo real"}` | exit 0，输出 real，无 99 |
  | 7 | ssh pty 超时打断 | `{target:'dev4',mode:'pty',cmd:'sleep 300',timeout:2}` | interrupted，秒级返回，会话存活（后续 echo 正常） |
  | 8 | incus oneshot | `{target:'incus:ctr-1', cmd:'cat /etc/os-release | head -1'}` | exit 0 |
  | 9 | incus pty + 别名路由 | home 层 patch 加 `containers: {'ctr-1':'incus:ctr-1'}` 后 `{target:'ctr-1',mode:'pty',cmd:'cd / && pwd'}` | cwd `/` |
  | 10 | docker oneshot | 临时容器 `docker run -d --name dashr-remote-t1 ubuntu:24.04 sleep 600` → `{target:'docker:dashr-remote-t1', cmd:'echo in-docker'}` | exit 0 |
  | 11 | docker pty（script 托管） | `{target:'docker:dashr-remote-t1', mode:'pty', cmd:'cd /root && pwd'}` | cwd `/root` |
  | 12 | BYO-PTY spawn | `{spawn:'docker exec -it dashr-remote-t1 bash', cmd:'echo spawned'}` | exit 0，输出 spawned |
  | 13 | 错误透明 | `{target:'no-such-host-xyz', cmd:'echo x'}`（预期 ssh 原生报错）与 `{target:'docker:no-such-ctr', cmd:'x'}` | 原生 stderr 原样可见，agent 可自愈 |
  | 14 | 断联自愈 | pty 会话中 `{target:'dev4',mode:'pty',cmd:'kill -9 $$'}` → 再 `{target:'dev4',mode:'pty',cmd:'echo back'}` | 第二击含 `[remote: session reconnected to fresh shell; cwd reset to default]` 行 |
  | 15 | 后台输出 Non-Goal | `{target:'dev4',cmd:'nohup sleep 5 >/dev/null 2>&1 & echo bg-ok'}` | 输出干净 bg-ok（使用者重定向职责示范） |
  | 16 | status 可达探测 | `{target:'dev4'}`（无 cmd） | `probe: reachable in Nms`；**全文无 "offline" 字样** |
  | 17 | status 会话层 | case 4 之后 `{target:'dev4'}` | `session: idle Ns (connected)` |
  | 18 | status 容器事实/错误 | `{target:'docker:no-such-ctr'}` | `probe: error —` 行含 docker 原生 No such object |

  结束清理：`docker rm -f dashr-remote-t1`；移除 home 层别名 patch（若加了）。

- [ ] **Step 5: 审计抽查** — 实测 session 的存储里 `dashr/remote-exec` 事件在案（target/cmd/exit/durationMs）。

- [ ] **Step 6: 写报告** — `docs/50_test-reports/2026-09-23-remote-framework实测报告.md`：环境（端口/sha/矩阵表）、18 case 结果、四层模型映射核对表、状态词汇表行为证据（矩阵 16-18：无 offline 歧义）、Non-Goal 三条的行为证据、遗留清单（如 130 断言环境差异、dev4 无 docker 的嵌套穿透未测等如实记录）。

- [ ] **Step 7: Commit** — `git add docs/50_test-reports/… && git commit -m "test(remote): phase-4 acceptance matrix report at dev instance (ssh/incus/docker/spawn)"`。

---

### Task 11: 收尾（finishing-a-development-branch）

- [ ] 全量 `npm test` + `npx tsc --noEmit` 最后一遍确认。
- [ ] REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` — 按 skill 走验证与选项呈现（merge / PR / 保留分支），**等 user 选择**；npm publish 不在本计划范围（Development Operation Contract：需 user 单次明确放行）。

---

## Self-Review 记录

- **Spec 覆盖**：§一 四层模型→双轨（Task 4/5）；§二 命名与智能路由（Task 2）；§三 API 契约 target/spawn/cmd/mode/stdin/timeout + 错误透明（Task 6/8）；§四 场景 1-4（Task 10 矩阵 1-14）；§五 oneshot 流水线 argv 逐字（Task 3）、nonce 收帧/TTL/断联自愈（Task 1/5 + 矩阵 6/7/14）；§六 Non-Goals（矩阵 15 + Ruling 5 固定 40×120 + 无状态回放）；§七 Phase 1-4（Task 1 / 4-5 / 2-3+6-9 / 10）。**user 2026-09-23 状态词汇裁决**（禁 offline；reachable/unreachable/容器事实态/idle/busy/none；on-demand 双重超时探测）→ Ruling 16/17 + Task 5 snapshot + Task 7 全任务 + Task 8 status 面 + 矩阵 16-18。无缺task。
- **类型一致性**：`PtyFrame{exit,cwd}`（Task 1 定义，Task 5 消费）；`TargetPlan`（Task 2 定义，Task 3/6/7 消费）；`OneShotResult`（Task 4，Task 7 runner 缝消费）；`PtyDispatchResult`（Task 5）在 Task 6 `execute` 合成 `RemoteCallResult`（Task 8 消费）；`SessionSnapshot`（Task 5 定义，Task 7 `renderSession` / Task 8 `driver.status` 消费）；`ProbeOutcome`（Task 7 定义，Task 8 消费）；`RECONNECT_NOTICE`（Task 5 定义，Task 8 render 消费）；`RemoteRowConfig`（Task 9）。已复核命名一致。
- **占位符扫描**：各 Step 均含实码/实命令；Task 10 步骤 4 矩阵为实测脚本性步骤（验收性质，非代码占位）。
- **已知测试环境风险**：130 断言确定性由 Ruling P8 两段打断（\x03 + 注入 130-marker 行）保证——两路（弃行/续行）皆 exit 130；trap INT 场景走 kill 兜底测试。若 CI 型环境无 /dev/ptmx，`script` 夹具会挂——本仓测试恒在真 Linux 跑，可接受。

## Post-acceptance 增量记录

- **Ruling P16**（user 2026-09-23 选 A）：补 `ssh:` 显式协议选择器（与 docker:/incus: 组成可扩展选择器族，未来新传输加一词即成）；撞名优先级维持"别名 override 赢"（人工显式意图），裸名缺省仍走 ssh；别名表值只接受容器形态（CONTAINER_PREFIX_RE 单独校验，ssh 无别名意义）。工具描述同步补 selector 消歧指引。若错：代价=极小（选择器仅显式路径）。
- **Ruling P17**（user 实测发现，2026-09-23）：session log 的自定义类型事件**不可持久化**——`KNOWN_SESSION_EVENT_TYPES` 为冻结原生集（catalog 刻意独立于插件），`Session.append()` 无 ignorable 通道，`tool/ptc-dispatch` 先例是原生类型而非插件自定义。审计迁出 session log → 插件自有存储 `$DSH_HOME/storages/better-dsh/remote-exec-audit.jsonl`（hashline/hostkeys 同款先例）；tool 面改注入式 audit sink；被毒化会话以 `ignorable: true` 信封标记手术修复（loader 契约内合法，事件以无表面语义的 opaque 形态保留）。若错：代价=审计从 session 视图消失（改回即恢复），但 session-log 通道本就非法。
- **Ruling P18**（user 2026-09-23，实测后裁决）：**删除别名机制整条腿**。插件环境数据不得上 cordis 配置面（行重述热插是对组合平面的误用，env-var 级需求用了系统级 YAML）；别名本身伪需求——显式选择器已全覆盖，发现走 on-demand probe（当下事实 > 任何别名表/定时扫盘；扫描器亦不建，运行态无人改配置）。`resolveTarget(target)` 单参化（裸名恒 ssh）；行 config 只留运行旋钮（execTimeoutSec/idleTtlSec/maxOutputChars）。若错：代价=裸名容器便利消失，补插件私有 JSON 即可（P18 明确不走 cordis 面）。
- **Ruling P19**（user 2026-09-23，attention 裁决）：`remote({})` 空调用 = **roster 面（注意力第一现场）**。区分两个概念：roster = 把名字放进上下文（读 ~/.ssh/config hosts + docker ps -a + incus list + 池内活会话，纯本地廉价扫描，零可达性检查）；probe = 单点验证（既有 on-demand status，第二现场）。"模型自己会发现"只在 attention 已存在后成立——工具 catalog 是 attention 的注入点，便利性（spec §三宗旨）要求入口自带清单。E_PARAMS 发现指引退役；描述文本改为 no-args 列清单。若错：代价=多一个只读面（几行渲染），可删。

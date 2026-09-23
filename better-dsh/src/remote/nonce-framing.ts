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
  onOutput?(text: string): void
  onFrame(frame: PtyFrame): void
}

export interface NonceFrameParser { feed(chunk: string): void; flush(): void }

const FRAME_BODY_RE = /^(\d+);([^;\x07\x1b]*)(?:\x07|\x1b\\)/

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

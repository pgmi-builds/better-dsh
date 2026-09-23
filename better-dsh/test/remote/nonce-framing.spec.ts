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

import { describe, expect, it } from 'vitest'
import { parseSshConfig, resolveSshHost } from '../../src/remote/ssh-config.ts'

const CFG = `
Host dev3
  HostName dev3.example.com
  User u1
  Port 2201
  IdentityFile ~/.ssh/id_ed25519
  IdentityFile ~/.ssh/id_ed25519_2

Host * !dev3
  User fallback
  ServerAliveInterval 30

Host mac
  HostName 192.168.31.7
`
describe('parseSshConfig', () => {
  it('parses one block with multi IdentityFile and ~ expansion', () => {
    const { entries, skipped } = parseSshConfig(CFG)
    expect(skipped).toContain('ServerAliveInterval')
    const dev3 = entries.find(e => e.host === 'dev3')!
    expect(dev3.hostName).toBe('dev3.example.com')
    expect(dev3.user).toBe('u1')
    expect(dev3.port).toBe(2201)
    expect(dev3.identityFiles).toEqual([
      expect.stringContaining('.ssh/id_ed25519'),
      expect.stringContaining('id_ed25519_2'),
    ])
    expect(dev3.identityFiles[0]).not.toContain('~')
  })
  it('resolves with ssh first-obtained-wins across blocks', () => {
    const { entries } = parseSshConfig(CFG)
    const mac = resolveSshHost(entries, 'mac')!
    expect(mac.user).toBe('fallback')          // 继承自通配块（dev3 不含 mac）
    expect(mac.hostName).toBe('192.168.31.7')  // 自己块里的已得值不被覆盖
  })
  it('exact alias beats wildcard; unknown → undefined', () => {
    const { entries } = parseSshConfig(CFG)
    expect(resolveSshHost(entries, 'dev3')!.user).toBe('u1')
    expect(resolveSshHost(entries, 'nope')).toBeUndefined()
  })
  it('supports ? and comma lists and negation matching', () => {
    const { entries } = parseSshConfig(CFG)
    expect(resolveSshHost(entries, 'dev3')!.user).toBe('u1') // !dev3 不吃通配块
  })
})

// 覆盖简报检查单中 verbatim 用例未直接命中的项：`?` 单字符通配、逗号多模式、
// 大小写不敏感匹配、Include/Match 及未知指令进 skipped（去重、保序）。
describe('parseSshConfig coverage additions', () => {
  it('matches ? single-char wildcards and comma pattern lists, case-insensitively', () => {
    const { entries } = parseSshConfig([
      'Host web?',
      '  User webuser',
      '',
      'Host web1',
      '',
      'Host web12',
      '',
      'Host db1, db2',
      '  User dbuser',
    ].join('\n'))
    expect(resolveSshHost(entries, 'web1')!.user).toBe('webuser')   // web? 通配块继承
    expect(resolveSshHost(entries, 'WEB1')!.user).toBe('webuser')   // 匹配大小写不敏感
    expect(resolveSshHost(entries, 'web12')!.user).toBeUndefined()  // ? 只吃一个字符
    expect(resolveSshHost(entries, 'db2')!.user).toBe('dbuser')     // 逗号列表第二个模式
  })

  it('records Include/Match/unknown directives in skipped, deduped and in order', () => {
    const { skipped } = parseSshConfig([
      'Include ~/.ssh/config.d/*',
      'Host a',
      '  Match host b',
      '  ForwardAgent yes',
      '  match host c',
      '  forwardagent no',
    ].join('\n'))
    expect(skipped).toEqual(['Include', 'Match', 'ForwardAgent'])
  })
})

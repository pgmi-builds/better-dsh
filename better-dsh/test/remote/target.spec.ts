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
    expect(() => resolveTarget('x', { x: 'ssh:y' })).toThrowError(TargetFormatError)
    expect(() => resolveTarget('   ')).toThrowError(/E_TARGET_FORMAT/)
  })
})

import { describe, expect, it } from 'vitest'
import { applySelector, parseUrl, UrlSchemaError } from '../src/url-schema/selector.ts'
import { UrlResolver } from '../src/url-schema/resolver.ts'
import type { ResolverEnv, SchemeHandler } from '../src/url-schema/resolver.ts'

describe('parseUrl', () => {
  it('parses a bare scheme URL with no selector', () => {
    expect(parseUrl('skill://foo')).toEqual({ scheme: 'skill', path: 'foo', selector: null })
  })

  it('parses a multi-segment path', () => {
    expect(parseUrl('agent://abc/transcript')).toEqual({
      scheme: 'agent',
      path: 'abc/transcript',
      selector: null,
    })
  })

  it('parses :raw', () => {
    expect(parseUrl('skill://foo:raw')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'raw' },
    })
  })

  it('parses a single line :N', () => {
    expect(parseUrl('skill://foo:5')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'lines', ranges: [[5, 5]] },
    })
  })

  it('parses a closed range :N-M', () => {
    expect(parseUrl('skill://foo:5-10')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'lines', ranges: [[5, 10]] },
    })
  })

  it('parses an open range :N-', () => {
    expect(parseUrl('skill://foo:5-')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'lines', ranges: [[5, Infinity]] },
    })
  })

  it('parses multiple comma-separated ranges', () => {
    expect(parseUrl('skill://foo:5-10,20-30')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'lines', ranges: [[5, 10], [20, 30]] },
    })
  })

  it('parses a :path/ subresource selector', () => {
    expect(parseUrl('skill://foo:path/sub/file.md')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'path', value: 'sub/file.md' },
    })
  })

  it('parses a ?q= query selector', () => {
    expect(parseUrl('skill://foo?q=bar')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'query', q: 'bar' },
    })
  })

  it('parses a bare ? query without the q= prefix', () => {
    expect(parseUrl('skill://foo?bar')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'query', q: 'bar' },
    })
  })

  it('treats a colon inside a query value as part of the query', () => {
    expect(parseUrl('skill://foo?q=a:b')).toEqual({
      scheme: 'skill',
      path: 'foo',
      selector: { kind: 'query', q: 'a:b' },
    })
  })

  it('throws a structured error when there is no scheme', () => {
    expect(() => parseUrl('foo/bar')).toThrowError(UrlSchemaError)
    expect(() => parseUrl('/just/a/path')).toThrowError(/no scheme/)
  })

  it('exposes the URL_NO_SCHEME code', () => {
    try {
      parseUrl('plain.txt')
      throw new Error('expected parseUrl to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UrlSchemaError)
      expect((err as UrlSchemaError).code).toBe('URL_NO_SCHEME')
    }
  })

  it('throws a structured error on a malformed line selector', () => {
    expect(() => parseUrl('skill://foo:abc')).toThrowError(UrlSchemaError)
  })
})

describe('applySelector', () => {
  const text = 'a\nb\nc\nd\ne'

  it('returns text unchanged for null and :raw', () => {
    expect(applySelector(text, null)).toBe(text)
    expect(applySelector(text, { kind: 'raw' })).toBe(text)
  })

  it('slices a single closed range (1-based, inclusive)', () => {
    expect(applySelector(text, { kind: 'lines', ranges: [[2, 4]] })).toBe('b\nc\nd')
  })

  it('slices a single line', () => {
    expect(applySelector(text, { kind: 'lines', ranges: [[1, 1]] })).toBe('a')
  })

  it('combines multiple ranges in order', () => {
    expect(applySelector(text, { kind: 'lines', ranges: [[2, 2], [4, 4]] })).toBe('b\nd')
  })

  it('clamps a range past the end', () => {
    expect(applySelector(text, { kind: 'lines', ranges: [[4, 99]] })).toBe('d\ne')
  })

  it('supports an open tail via Infinity', () => {
    expect(applySelector(text, { kind: 'lines', ranges: [[3, Infinity]] })).toBe('c\nd\ne')
  })

  it('returns empty for an out-of-bounds range', () => {
    expect(applySelector(text, { kind: 'lines', ranges: [[10, 20]] })).toBe('')
  })

  it('navigates a JSON sub-resource via :path', () => {
    expect(applySelector('{"a":{"b":42}}', { kind: 'path', value: 'a.b' })).toBe('42')
  })

  it('navigates array indices via :path', () => {
    expect(applySelector('{"a":[10,20,30]}', { kind: 'path', value: 'a.1' })).toBe('20')
  })

  it('passes non-JSON text through unchanged for :path', () => {
    expect(applySelector('not json', { kind: 'path', value: 'a.b' })).toBe('not json')
  })

  it('returns text unchanged when a :path misses', () => {
    expect(applySelector('{"a":1}', { kind: 'path', value: 'nope' })).toBe('{"a":1}')
  })

  it('filters lines by substring for ?q= on plain text', () => {
    expect(applySelector('foo\nbar\nbaz', { kind: 'query', q: 'ba' })).toBe('bar\nbaz')
  })

  it('navigates JSON for ?q=', () => {
    expect(applySelector('{"a":1,"b":2}', { kind: 'query', q: 'b' })).toBe('2')
  })
})

describe('UrlResolver', () => {
  const env: ResolverEnv = {}

  it('dispatches to a registered handler and applies the selector', async () => {
    const handler: SchemeHandler = {
      resolve: async (_env, path) => {
        expect(path).toBe('foo')
        return 'a\nb\nc'
      },
    }
    const resolver = new UrlResolver()
    resolver.register('skill', handler)
    await expect(resolver.resolve(env, 'skill://foo:2-3')).resolves.toBe('b\nc')
  })

  it('passes the environment through to the handler', async () => {
    const seen: ResolverEnv[] = []
    const handler: SchemeHandler = { resolve: async (e) => { seen.push(e); return 'x' } }
    const resolver = new UrlResolver()
    resolver.register('dsh', handler)
    await resolver.resolve(env, 'dsh://config')
    expect(seen).toEqual([env])
  })

  it('applies a :path selector over the handler result', async () => {
    const handler: SchemeHandler = { resolve: async () => '{"a":{"b":7}}' }
    const resolver = new UrlResolver()
    resolver.register('agent', handler)
    await expect(resolver.resolve(env, 'agent://id:path/a.b')).resolves.toBe('7')
  })

  it('throws a structured error for an unregistered scheme', async () => {
    const resolver = new UrlResolver()
    await expect(resolver.resolve(env, 'https://example.com')).rejects.toThrowError(UrlSchemaError)
    await expect(resolver.resolve(env, 'skill://foo')).rejects.toThrowError(/no handler registered/)
  })

  it('exposes the URL_UNREGISTERED_SCHEME code', async () => {
    const resolver = new UrlResolver()
    try {
      await resolver.resolve(env, 'https://x')
      throw new Error('expected resolve to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(UrlSchemaError)
      expect((err as UrlSchemaError).code).toBe('URL_UNREGISTERED_SCHEME')
    }
  })

  it('propagates the parse error for a scheme-less URL', async () => {
    const resolver = new UrlResolver()
    await expect(resolver.resolve(env, 'not-a-url')).rejects.toThrowError(/no scheme/)
  })
})

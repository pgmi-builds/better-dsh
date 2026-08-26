import { describe, expect, it } from 'vitest'
import type { SkillDefinition, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type { FsTarget } from '@deepseek-ai/dsh-fs'

import { UrlSchemaError } from '../../src/url-schema/selector.ts'
import { createSkillHandler, type SkillEnv } from '../../src/url-schema/handlers/skill.ts'

/** Minimal `SkillDefinition` fixture; per-test fields arrive via `overrides`. */
function def(name: string, overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name,
    description: `${name} skill`,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'project-dsh',
    provider: 'test',
    content: `# ${name}\nbody`,
    ...overrides,
  }
}

/** One recorded `skills.get` call, for cwd-passthrough assertions. */
interface GetCall {
  name: string
  options: SkillViewOptions | undefined
}

/** Recording fake for the `ctx.skills` surface the skill handler calls. */
export interface FakeSkills {
  calls: GetCall[]
  get(name: string, options?: SkillViewOptions): Promise<SkillDefinition | undefined>
}

/** Recording fake for the `ctx.fs` surface the skill handler calls. */
export interface FakeFs {
  resolved: string[]
  resolve(path: string): Promise<FsTarget>
  readText(target: FsTarget): Promise<string>
}

/**
 * Fake registry: `get` records every call and delegates to the per-test
 * resolver, which may be cwd-sensitive (returning `undefined` for the wrong
 * workspace, exactly like the real workspace-scoped providers).
 */
function fakeSkills(
  get: (name: string, options?: SkillViewOptions) => SkillDefinition | undefined,
): FakeSkills {
  const calls: GetCall[] = []
  return {
    calls,
    async get(name, options) {
      calls.push({ name, options })
      return get(name, options)
    },
  }
}

/** Fake sandbox fs: resolves paths to themselves, reads from a fixture map. */
function fakeFs(files: Record<string, string>): FakeFs {
  const resolved: string[] = []
  return {
    resolved,
    async resolve(path) {
      resolved.push(path)
      return { targetKey: path as FsTarget['targetKey'], displayPath: path }
    },
    async readText(target) {
      const text = files[target.displayPath]
      if (text === undefined) throw new Error(`no fixture for "${target.displayPath}"`)
      return text
    },
  }
}

/** Env carrying an agent whose session was created in `cwd`. */
function agentEnv(cwd: string | undefined): SkillEnv {
  return { agent: { session: { header: cwd === undefined ? {} : { cwd } } } }
}

/**
 * The handler's full surface as built: `resolve` plus the path-backed view
 * (`SchemeHandler.resolvePath` is optional at the interface level, so the
 * spec types the concrete shape the factory returns instead of `?.`-probing).
 */
interface PathAwareSkillHandler {
  resolve(env: SkillEnv, path: string): Promise<string>
  resolvePath(env: SkillEnv, path: string): Promise<string | undefined>
}

/** Handler under test, typed at its actual (path-aware) surface. */
function makeHandler(skills: FakeSkills, fs: FakeFs): PathAwareSkillHandler {
  return createSkillHandler({ skills, fs }) as PathAwareSkillHandler
}

describe('skill handler: cwd passthrough', () => {
  it('passes the agent session cwd and the agent as lookup scope to skills.get', async () => {
    const skills = fakeSkills(() => def('demo'))
    const h = makeHandler(skills, fakeFs({}))
    const env = agentEnv('/ws/project')
    await h.resolve(env, 'demo')
    expect(skills.calls).toEqual([{ name: 'demo', options: { cwd: '/ws/project', scope: env.agent } }])
  })

  it('prefers an explicit env cwd over the agent session cwd', async () => {
    const skills = fakeSkills(() => def('demo'))
    const h = makeHandler(skills, fakeFs({}))
    const env = { ...agentEnv('/ws/a'), cwd: '/ws/b' }
    await h.resolve(env, 'demo')
    expect(skills.calls).toEqual([{ name: 'demo', options: { cwd: '/ws/b', scope: env.agent } }])
  })

  it('calls get without options when the env has no agent and no cwd', async () => {
    const skills = fakeSkills(() => def('demo'))
    const h = makeHandler(skills, fakeFs({}))
    await h.resolve({}, 'demo')
    expect(skills.calls).toEqual([{ name: 'demo', options: undefined }])
  })

  it('passes the agent as lookup scope when the session has no cwd', async () => {
    const skills = fakeSkills(() => def('demo'))
    const h = makeHandler(skills, fakeFs({}))
    const env = agentEnv(undefined)
    await h.resolve(env, 'demo')
    expect(skills.calls).toEqual([{ name: 'demo', options: { scope: env.agent } }])
  })
})

describe('skill handler: workspace-scoped lookup', () => {
  // The regression this file pins: workspace-scoped providers only surface a
  // skill when the lookup cwd falls inside the skill's project root. Without
  // the cwd, `get` misses and the handler must report the same unknown-skill
  // error it always did.
  const workspaceScoped = (name: string, root: string) =>
    fakeSkills((_n, options) => (options?.cwd === root ? def(name) : undefined))

  it('resolves the skill body when the cwd reaches the project root', async () => {
    const h = makeHandler(workspaceScoped('demo', '/ws/project'), fakeFs({}))
    await expect(h.resolve(agentEnv('/ws/project'), 'demo')).resolves.toBe('# demo\nbody')
  })

  it('keeps the unchanged unknown-skill error when no cwd reaches the skill', async () => {
    const h = makeHandler(workspaceScoped('demo', '/ws/project'), fakeFs({}))
    await expect(h.resolve({}, 'demo')).rejects.toThrowError(UrlSchemaError)
    await expect(h.resolve({}, 'demo')).rejects.toThrowError(
      'skill "demo" is unknown or no longer available',
    )
  })
})

describe('skill handler: resource subpaths', () => {
  const base = { kind: 'directory', path: '/skills/demo/res' } as const

  it('reads a resource file through the sandbox', async () => {
    const fs = fakeFs({ '/skills/demo/res/guide.md': 'guide text' })
    const h = makeHandler(fakeSkills(() => def('demo', { resourceBase: base })), fs)
    await expect(h.resolve(agentEnv('/ws'), 'demo/guide.md')).resolves.toBe('guide text')
    expect(fs.resolved).toEqual(['/skills/demo/res/guide.md'])
  })

  it('rejects a subpath escaping the resource directory', async () => {
    const h = makeHandler(fakeSkills(() => def('demo', { resourceBase: base })), fakeFs({}))
    await expect(h.resolve(agentEnv('/ws'), 'demo/../../etc/passwd')).rejects.toThrowError(
      UrlSchemaError,
    )
    await expect(h.resolve(agentEnv('/ws'), 'demo/../../etc/passwd')).rejects.toThrowError(
      /escapes its directory/,
    )
  })

  it('rejects a subpath when the skill has no directory resource base', async () => {
    const h = makeHandler(
      fakeSkills(() => def('demo', { resourceBase: { kind: 'opaque', description: 'x' } })),
      fakeFs({}),
    )
    await expect(h.resolve(agentEnv('/ws'), 'demo/file.md')).rejects.toThrowError(
      /has no filesystem resource directory/,
    )
  })

  it('returns the bare body for a name with no resource base at all', async () => {
    const h = makeHandler(fakeSkills(() => def('demo')), fakeFs({}))
    await expect(h.resolve(agentEnv('/ws'), 'demo')).resolves.toBe('# demo\nbody')
  })
})

describe('skill handler: resolvePath', () => {
  const base = { kind: 'directory', path: '/skills/demo/res' } as const

  it('maps a bare name to the resource directory root', async () => {
    const h = makeHandler(fakeSkills(() => def('demo', { resourceBase: base })), fakeFs({}))
    await expect(h.resolvePath(agentEnv('/ws'), 'demo')).resolves.toBe('/skills/demo/res')
  })

  it('maps a subpath to the joined file path', async () => {
    const h = makeHandler(fakeSkills(() => def('demo', { resourceBase: base })), fakeFs({}))
    await expect(h.resolvePath(agentEnv('/ws'), 'demo/docs/guide.md')).resolves.toBe(
      '/skills/demo/res/docs/guide.md',
    )
  })

  it('passes the cwd through to the lookup', async () => {
    const skills = fakeSkills((_n, options) =>
      options?.cwd === '/ws/project' ? def('demo', { resourceBase: base }) : undefined,
    )
    const h = makeHandler(skills, fakeFs({}))
    await expect(h.resolvePath(agentEnv('/ws/project'), 'demo')).resolves.toBe('/skills/demo/res')
    await expect(h.resolvePath({}, 'demo')).resolves.toBeUndefined()
  })

  it('returns undefined for an unknown skill', async () => {
    const h = makeHandler(fakeSkills(() => undefined), fakeFs({}))
    await expect(h.resolvePath(agentEnv('/ws'), 'nope')).resolves.toBeUndefined()
  })

  it('returns undefined for a non-directory resource base', async () => {
    const urlBase = { kind: 'url', url: 'https://example.com/skills/demo' } as const
    const h = makeHandler(fakeSkills(() => def('demo', { resourceBase: urlBase })), fakeFs({}))
    await expect(h.resolvePath(agentEnv('/ws'), 'demo')).resolves.toBeUndefined()
  })

  it('returns undefined for an escaping subpath instead of a guessed path', async () => {
    const h = makeHandler(fakeSkills(() => def('demo', { resourceBase: base })), fakeFs({}))
    await expect(h.resolvePath(agentEnv('/ws'), 'demo/../../etc/passwd')).resolves.toBeUndefined()
  })
})

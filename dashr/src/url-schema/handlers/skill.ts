/**
 * `skill://` scheme handler.
 *
 * Resolves two URL shapes:
 *   - `skill://<name>`            → the skill's SKILL.md body (full text).
 *   - `skill://<name>/<path>`     → a file inside the skill's resource
 *                                   directory, loaded through the sandbox.
 *
 * The handler returns the FULL text of the resource; the resolver applies any
 * explicit selector (line ranges / `:raw` / `:path/…` / `?q=`) uniformly, so
 * there is no default line truncation here.
 *
 * Skill discovery is workspace-sensitive: the registry only sees skills whose
 * project roots cover the lookup `cwd` (the same rule `dsh-tool-skill` applies
 * when it renders `<available_skills>`). The env handed over by the tool layer
 * therefore contributes the calling agent's session cwd, and every registry
 * call passes it through — without it the lookup falls into the empty default
 * workspace and every skill reports as unknown.
 *
 * Dependencies (captured once by `createSkillHandler(deps)`):
 *   - `ctx.skills` — the skill registry (`SkillRegistry` from
 *     `@deepseek-ai/dsh-skill`); `.get(name, {cwd})` yields the winning
 *     `SkillDefinition` (body `content` + optional `resourceBase`).
 *   - `ctx.fs` — the sandbox filesystem (`FileSystem` from
 *     `@deepseek-ai/dsh-fs`); `.resolve(path)` + `.readText(target)` load
 *     internal resource files through the sandbox, so reads obey the same
 *     containment/audit rules as the host read tool.
 */

import { join, relative } from 'node:path'
import type { SkillDefinition, SkillViewOptions } from '@deepseek-ai/dsh-skill'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { UrlSchemaError } from '../selector.ts'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'

/**
 * Structural slice of `Agent` the cwd lookup reads — deliberately not the full
 * `@deepseek-ai/dsh-agent` type so callers and tests pass a plain object.
 */
interface SkillEnvAgent {
  readonly session: { readonly header: { readonly cwd?: string } }
}

/**
 * Environment fields the skill handler reads on top of {@link ResolverEnv}.
 * Both are optional: without them discovery degrades to the registry's
 * default workspace (the pre-cwd behavior) with identical error surface.
 */
export interface SkillEnv extends ResolverEnv {
  /** Calling agent; its session header carries the workspace cwd. */
  readonly agent?: SkillEnvAgent
  /** Explicit cwd when the tool layer already resolved one; wins over `agent`. */
  readonly cwd?: string
}

/** The subset of `ctx.skills` this handler calls (structural, test-friendly). */
export interface SkillRegistrySurface {
  /** Load the winning skill definition for a workspace (see SkillViewOptions). */
  get(name: string, options?: SkillViewOptions): Promise<SkillDefinition | undefined>
}

/** The subset of `ctx.fs` this handler calls (structural, test-friendly). */
export interface SkillFsSurface {
  /** Map a model-supplied path to a stable sandbox target. */
  resolve(path: string): Promise<FsTarget>
  /** Read the target's full text through the sandbox. */
  readText(target: FsTarget): Promise<string>
}

/** Services required by the skill handler, supplied at construction. */
export interface SkillHandlerDeps {
  /** `ctx.skills`: resolves a skill name to its definition (body + resourceBase). */
  readonly skills: SkillRegistrySurface
  /** `ctx.fs`: reads internal skill resource files through the sandbox. */
  readonly fs: SkillFsSurface
}

/** Split `path` into `{ name, subpath }`; `subpath` is `null` for a bare name. */
function splitSkillPath(path: string): { name: string; subpath: string | null } {
  const slash = path.indexOf('/')
  if (slash === -1) return { name: path, subpath: null }
  const subpath = path.slice(slash + 1)
  return { name: path.slice(0, slash), subpath: subpath === '' ? null : subpath }
}

/** Join `subpath` under the skill's resource directory, rejecting escapes. */
function resolveResourcePath(baseDir: string, subpath: string): string {
  const full = join(baseDir, subpath)
  const rel = relative(baseDir, full)
  if (rel === '' || rel === '..' || rel.startsWith('../')) {
    throw new UrlSchemaError(
      'URL_SKILL_RESOURCE_ESCAPE',
      `skill resource path "${subpath}" escapes its directory`,
    )
  }
  return full
}

/**
 * Registry lookup options for one env, mirroring `dsh-tool-skill`'s lookup:
 * the workspace cwd (explicit `cwd`, else the agent session's) plus the
 * calling agent as the viewing `scope` — without it a scoped skill layer
 * reads as absent. Both absent → `undefined`, the exact call shape of the
 * cwd-less era.
 */
function lookupOptions(env: SkillEnv): SkillViewOptions | undefined {
  const cwd = env.cwd ?? env.agent?.session.header.cwd
  if (cwd === undefined && env.agent === undefined) return undefined
  return {
    ...cwd === undefined ? {} : { cwd },
    ...env.agent === undefined ? {} : { scope: env.agent },
  }
}

/**
 * Build the `skill://` handler over the given services. Besides `resolve`
 * (full text), it implements the optional path-backed view: `resolvePath`
 * maps a URL to its on-disk location so `grep`/`glob` can search the real
 * files instead of resolved text.
 */
export function createSkillHandler(deps: SkillHandlerDeps): SchemeHandler {
  const handler: SchemeHandler & {
    resolvePath(env: ResolverEnv, path: string): Promise<string | undefined>
  } = {
    async resolve(env: SkillEnv, path: string): Promise<string> {
      const { name, subpath } = splitSkillPath(path)

      const skill = await deps.skills.get(name, lookupOptions(env))
      if (skill === undefined) {
        throw new UrlSchemaError(
          'URL_SKILL_NOT_FOUND',
          `skill "${name}" is unknown or no longer available`,
        )
      }

      if (subpath === null) return skill.content

      if (skill.resourceBase === undefined || skill.resourceBase.kind !== 'directory') {
        throw new UrlSchemaError(
          'URL_SKILL_NO_RESOURCE_BASE',
          `skill "${name}" has no filesystem resource directory`,
        )
      }

      const resourcePath = resolveResourcePath(skill.resourceBase.path, subpath)
      const target = await deps.fs.resolve(resourcePath)
      return await deps.fs.readText(target)
    },

    /**
     * On-disk location for path-backed consumers: `skill://<name>` → the
     * skill's resource directory root, `skill://<name>/<subpath>` → the file
     * inside it (same escape guard as `resolve`). Returns `undefined`
     * whenever the URL is not disk-backed — unknown skill, a `url`/`opaque`
     * resource base, or an escaping subpath — so the caller falls back to
     * text resolution (which then reports the structured error) instead of
     * searching a guessed path.
     */
    async resolvePath(env: SkillEnv, path: string): Promise<string | undefined> {
      const { name, subpath } = splitSkillPath(path)
      const skill = await deps.skills.get(name, lookupOptions(env))
      if (skill === undefined) return undefined
      const base = skill.resourceBase
      if (base === undefined || base.kind !== 'directory') return undefined
      if (subpath === null) return base.path
      try {
        return resolveResourcePath(base.path, subpath)
      } catch {
        return undefined
      }
    },
  }
  return handler
}

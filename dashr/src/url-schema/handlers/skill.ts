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
 * Dependencies (captured once by `createSkillHandler(deps)`):
 *   - `ctx.skills` — the skill registry (`SkillRegistry` from
 *     `@deepseek-ai/dsh-skill`); `.get(name)` yields the winning
 *     `SkillDefinition` (body `content` + optional `resourceBase`).
 *   - `ctx.fs` — the sandbox filesystem (`FileSystem` from
 *     `@deepseek-ai/dsh-fs`); `.resolve(path)` + `.readText(target)` load
 *     internal resource files through the sandbox, so reads obey the same
 *     containment/audit rules as the host read tool.
 */

import { join, relative } from 'node:path'
import type { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { UrlSchemaError } from '../selector.ts'
import type { ResolverEnv, SchemeHandler } from '../resolver.ts'

/** Services required by the skill handler, supplied at construction. */
export interface SkillHandlerDeps {
  /** `ctx.skills`: resolves a skill name to its definition (body + resourceBase). */
  readonly skills: SkillRegistry
  /** `ctx.fs`: reads internal skill resource files through the sandbox. */
  readonly fs: FileSystem
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

/** Build the `skill://` handler over the given services. */
export function createSkillHandler(deps: SkillHandlerDeps): SchemeHandler {
  return {
    async resolve(_env: ResolverEnv, path: string): Promise<string> {
      const { name, subpath } = splitSkillPath(path)

      const skill = await deps.skills.get(name)
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
  }
}

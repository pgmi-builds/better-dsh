/** 解析后的传输计划：三种 CLI 传输之一。 */
export type TargetPlan =
  | { kind: 'ssh'; host: string }
  | { kind: 'docker'; container: string }
  | { kind: 'incus'; container: string }

export class TargetFormatError extends Error {
  readonly code = 'E_TARGET_FORMAT'
  constructor(message: string) { super(message); this.name = 'TargetFormatError' }
}

const PREFIX_RE = /^(docker|incus):(.+)$/

/** spec §二.2 智能路由：显式前缀 > 别名表（已知容器裸名）> ssh。 */
export function resolveTarget(target: string, containerAliases: Record<string, string> = {}): TargetPlan {
  const raw = target.trim()
  if (raw.length === 0) throw new TargetFormatError('[E_TARGET_FORMAT] remote: empty target')
  const direct = PREFIX_RE.exec(raw)
  if (direct !== null) return { kind: direct[1] as 'docker' | 'incus', container: direct[2]! }
  const aliased = containerAliases[raw]
  if (aliased !== undefined) {
    const m = PREFIX_RE.exec(aliased)
    if (m === null)
      throw new TargetFormatError(
        `[E_TARGET_FORMAT] remote: container alias '${raw}' must map to 'docker:<name>' or 'incus:<name>' (got ${JSON.stringify(aliased)})`)
    return { kind: m[1] as 'docker' | 'incus', container: m[2]! }
  }
  return { kind: 'ssh', host: raw }
}

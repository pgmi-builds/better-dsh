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

/** spec §二.2 智能路由（Ruling P18）：显式选择器 > ssh 缺省；无别名表面——容器一律显式前缀，发现走 on-demand probe。 */
export function resolveTarget(target: string): TargetPlan {
  const raw = target.trim()
  if (raw.length === 0) throw new TargetFormatError('[E_TARGET_FORMAT] remote: empty target')
  const direct = PREFIX_RE.exec(raw)
  if (direct !== null) {
    if (direct[1] === 'ssh') return { kind: 'ssh', host: direct[2]! }
    return { kind: direct[1] as 'docker' | 'incus', container: direct[2]! }
  }
  return { kind: 'ssh', host: raw }
}

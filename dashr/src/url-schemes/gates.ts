/**
 * Feature gates (patch-line `config:` block). Every key defaults on — the
 * service is opt-out, not opt-in. Gates are RUNTIME options only: the code
 * itself is module-ized so each feature works with the other absent
 * (orthogonality ruling, 2026-09-13) — a gate decides what the composition
 * root wires, never how a module is written.
 */

/** Feature gates. */
export interface ReadGates {
  /** URL scheme resolution: scheme branches of read/write/grep/glob + `ctx://`. */
  readonly urlSchemes: boolean
  /** Hashline feature: read anchors + the `edit`/`undo` tool family. */
  readonly hashline: boolean
}

/** Plugin config shape (patch-line `config:` block). */
export interface UrlSchemesConfig {
  urlSchemes?: boolean
  hashline?: boolean
}

/** Every key defaults on — the service is opt-out, not opt-in. */
export function resolveGates(config: UrlSchemesConfig | undefined): ReadGates {
  return {
    urlSchemes: config?.urlSchemes !== false,
    hashline: config?.hashline !== false,
  }
}

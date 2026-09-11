/**
 * DASHR REPL binding-name policy: the ONE name-shape rule the bridge's
 * binding loop (src/index.ts) applies before installing a `tool` member.
 * `validateBindings` enforces.
 * @module dashr-repl/py-sdk
 */
import { PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS } from './vendored/repl-runtime.ts'

/** The language-portable identifier subset the seam accepts as a binding global (mirrors the runtime's private rule). */
const PORTABLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Whether a tool name can be bound as a `tool` member — the ONE
 * policy the bridge's binding loop (src/index.ts) applies, so the
 * bindings never promise a name the kernel does
 * not bind. Strictly narrower than the runtime's validation: the
 * language-portable identifier subset (`[A-Za-z_][A-Za-z0-9_]*`, ASCII — a
 * non-ASCII XID name is legal CPython but not portable, so the runtime
 * refuses it as a binding global), minus
 * every portable reserved word (ECMAScript ∪ Python — `type` and `match`
 * are legal Python but reserved on the seam), minus the seam's reserved
 * binding globals (`console`, dunders), minus underscore-leading names
 * (kernel-shim prefix plus the call-site hazards; not callable as taught
 * flat globals). The runtime's `validateBindings` remains the authoritative
 * backstop: everything this accepts, it accepts.
 */
export function isFlatBindableName(name: string): boolean {
  return PORTABLE_IDENTIFIER.test(name)
    && !name.startsWith('_')
    && !PORTABLE_RESERVED_WORDS.has(name)
    && !RESERVED_BINDING_GLOBALS.has(name)
}

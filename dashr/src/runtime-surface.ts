/**
 * The `replRuntime` seam surface, as the presentation half of this plugin
 * consumes it — a STRUCTURAL MIRROR of the vendored Service Definition
 * (`src/vendored/rlm-runtime.ts`, itself vendored verbatim from
 * `@deepseek-ai/dsh-code-runtime@0.1.0-rc.6` `src/types.ts`).
 *
 * Why a mirror instead of a direct import, even inside one package: the
 * presentation programs against a NARROW view of the runtime contract
 * (bindings, dispatch logs, results) — the same shape a third-party
 * `ctx.replRuntime` implementation would expose. Structural typing is what
 * the Cordis service boundary is built on (contexts resolve implementations
 * by key, not by class identity), so depending on the shape — not on our own
 * `DashrRuntime` class — keeps the presentation implementation-agnostic.
 *
 * Drift control: `test/compat.spec.ts` statically asserts this surface is
 * exactly compatible with the vendored types — a contract change there
 * fails this package's typecheck.
 * @module dashr-repl/runtime-surface
 */

/** One host-side function exposed to the program as an async callable; args and resolution must be lossless JSON. */
export type ReplBindingFunction = (args: unknown) => Promise<ReplJsonValue>

/** A lossless JSON value transferable through the dependency-light Service Definition. */
export type ReplJsonValue = null | boolean | number | string | ReplJsonValue[] | { [key: string]: ReplJsonValue }

/** Program-visible typed rejection for one binding namespace (constructor name + member carrying the called name). */
export interface ReplBindingErrorClass {
  /** Constructor global and resulting `Error.name`. */
  name: string
  /** Non-empty own property for the member name. */
  memberNameProperty: string
}

/** A named group of binding functions exposed as one global object (e.g. `tools`). */
export interface ReplBindingNamespace {
  /** The global identifier the program sees (portable identifier subset, no reserved words). */
  global: string
  /** The callable members, keyed by the exact name the program calls. */
  functions: Record<string, ReplBindingFunction>
  /**
   * Materialize the global itself as a callable function rather than an
   * object whose members are callable. When true, `functions` must contain
   * EXACTLY ONE entry — the single host function the bare global call
   * dispatches. Mirrors the vendored seam's DASHR-owned `callable` field
   * (M3-B: the bridge callables and the v0.1.5 flat per-tool bindings).
   */
  callable?: true
  /** Optional program-visible typed rejection contract for this namespace. */
  errorClass?: ReplBindingErrorClass
}

/** One run: the program source plus everything the runtime acts on. */
export interface ReplRunRequest {
  /** The program source; runs as one cell with top-level `await`/`return` available. */
  program: string
  /** Host functions exposed to the program, one global object per namespace. */
  bindings: ReplBindingNamespace[]
  /** Abort the run; resolves with a failure of kind `'abort'`. */
  signal?: AbortSignal
  /**
   * The calling session/agent identity (the `Agent` id): a stateful backend
   * keys its persistent namespace by this, so sessions sharing one service
   * instance never share state (kernel-per-session, M3-A). DASHR-owned delta
   * on the upstream seam — see the vendored Service Definition's types.
  principal?: string
  /** Per-run wall budget override in milliseconds; absent → the runtime's configured default. */
  timeoutMs?: number
  /** Reset the persistent namespace to empty before this run. */
  reset?: boolean
}

/** Why a run failed; an error is a FIELD on the resolved result, never a rejection of `run()`. */
export interface ReplRunFailure {
  /** The failure class. */
  kind: 'exception' | 'timeout' | 'abort' | 'worker-exit' | 'invalid-output' | 'output-limit'
  /** Human-readable detail, suitable for feeding back to a model to self-correct. */
  message: string
}

/** The outcome of one run. */
export interface ReplRunResult {
  /** The program's completion value, when it crossed the lossless-JSON boundary. */
  value?: ReplJsonValue
  /** Text the program emitted, in order. */
  logs: string[]
  /** Present iff the run failed. */
  error?: ReplRunFailure
}

/**
 * The `ctx.replRuntime` service as this plugin reads it. The language check
 * belongs to the presentation: only `'python'` has an SDK renderer here.
 */
export interface ReplRuntimeSurface {
  /** The source language {@link run} expects `program` to be written in (lowercase identifier). */
  readonly language: string
  /** Execute one program against the request's bindings and capture what it emitted. */
  run(request: ReplRunRequest): Promise<ReplRunResult>
}

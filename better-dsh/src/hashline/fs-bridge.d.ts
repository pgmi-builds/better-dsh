/**
 * IO seam for the hashline tool layer. The tools resolve, read, and write
 * through this bridge so they honor the deployment's `ctx.fs` backend — a
 * sandboxed or remote filesystem — instead of reaching around it.
 *
 * The bridge also participates in dsh's `fs/*` event gate exactly like the
 * built-in tools: writes dispatch `fs/write-intent` (so the observation policy
 * derives its create/replace guard and stale-version checks) and every
 * successful read/mutation emits `fs/observed` with the resulting version. A
 * hashline tool that silently skipped those events would leave the policy's
 * observed state stale, and the next built-in `write` on the same file would
 * fail with `FS_NOT_OBSERVED` / `FS_STALE_VERSION`.
 *
 * The local implementation exists for tests and pure-pipeline verification.
 * @module dsh-better-edit/fs-bridge
 */
import type { Context } from "@deepseek-ai/cordis";
import type { FileSystem } from "@deepseek-ai/dsh-fs";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { SandboxExecutionPolicy } from "@deepseek-ai/dsh-sandbox";
/** Text-IO operations the hashline tools need, keyed by canonical absolute path. */
export interface FileIO {
    /** Resolve a (possibly relative) request path against the session cwd to a canonical absolute path. */
    resolve(path: string, cwd: string, signal?: AbortSignal): Promise<string>;
    /** Read whole text; missing files, directories, and binary content throw. */
    readText(absolutePath: string, signal?: AbortSignal): Promise<string>;
    /**
     * Atomically write whole text, preserving mode when the file exists. On the
     * dsh backend this dispatches `fs/write-intent` (policy guard), stamps the
     * sandbox policy (session workspace root + mode) onto the write, and emits
     * `fs/observed` with the new version on success, so later built-in tools
     * see a fresh observation.
     * @param exec - the calling execution; carries the session the policy keys by.
     * @param sandboxPolicy - the per-call sandbox mode + workspace root the
     *   confined backend checks (resolved from the session by the tool layer);
     *   omitted on an unsandboxed backend.
     */
    writeText(absolutePath: string, content: string, signal?: AbortSignal, exec?: ToolExecution, sandboxPolicy?: SandboxExecutionPolicy): Promise<void>;
    /**
     * Emit `fs/observed` (present at the current version) for a successful
     * read, so the policy records that this session has seen the file.
     * @param exec - the calling execution; carries the session the policy keys by.
     */
    emitObserved(absolutePath: string, exec?: ToolExecution, signal?: AbortSignal): Promise<void>;
    /** Opaque change-version for snapshot bookkeeping, or undefined when unavailable. */
    statVersion(absolutePath: string, signal?: AbortSignal): Promise<string | undefined>;
}
/**
 * Map an `ctx.fs` failure onto the hashline model-facing vocabulary so the
 * model sees the same structured error codes as the pure pipeline.
 * @param error - the thrown FsError or any error.
 * @param displayPath - the path as the model wrote it.
 * @returns the mapped error, rethrown.
 */
export declare function mapFsError(error: unknown, displayPath: string): never;
/** FileIO over the deployment's `ctx.fs` service. */
export declare function ctxFsIO(fs: FileSystem, ctx: Context): FileIO;
/** FileIO over the host filesystem directly (tests, previews, fallback). */
export declare function localIO(): FileIO;

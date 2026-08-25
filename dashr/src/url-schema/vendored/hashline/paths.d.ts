/**
 * On-disk home for dsh-better-edit state. Inside a tool call the store lives
 * co-located with the files being edited: `<workspace>/.dsh_better_edit/` (the
 * workspace is the session cwd, carried through the execution by
 * `withWorkspace`). Outside a tool call — tests, previews, startup — the store
 * falls back to the shared DeepSeek Harness home
 * (`$DSH_HOME/plugins/dsh-better-edit`, default `~/.dsh/plugins/dsh-better-edit`),
 * so a caller without a workspace never writes into an arbitrary cwd.
 * @param cwd - the workspace root, or undefined for the shared-home fallback.
 */
export declare function configDir(cwd?: string): string;
export declare function hashStorePath(cwd?: string): string;
export declare function legacyHashStorePath(cwd?: string): string;
export declare function hashStoreDir(cwd?: string): string;
export declare function toCwd(filePath: string, cwd: string): string;
/**
 * Canonicalize a path, resolving every symlink component to its target
 * (loop-guarded, ELOOP on cycles). Non-existent final components resolve
 * lexically — the canonical form of a not-yet-created file. The hashline
 * tools key their state by canonical absolute paths, so the same file reached
 * through different symlink spellings lands on the same store rows.
 * @param path - the path to canonicalize (absolute or relative).
 */
export declare function resolveTarget(path: string): Promise<string>;

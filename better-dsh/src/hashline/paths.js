import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath, join, dirname, parse, sep, } from "node:path";
import { lstat, readlink } from "node:fs/promises";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { errCode } from "./utils.js";
/**
 * On-disk home for dsh-better-edit state: ONE centralized store per harness
 * home — `$DSH_HOME/storages/dsh-better-edit` (default
 * `~/.dsh/storages/dsh-better-edit`), resolved through the harness home
 * resolver so `DSH_HOME` isolates deployments (test homes never touch prod).
 * There is no per-workspace state directory: the store keys everything by
 * canonical absolute path.
 */
export function configDir() {
    return join(resolveDshHome(), "storages", "dsh-better-edit");
}
export function hashStorePath() {
    return join(configDir(), "hash-store.sqlite");
}
export function legacyHashStorePath() {
    return join(configDir(), "hash-store.json");
}
export function hashStoreDir() {
    return dirname(hashStorePath());
}
function homeBase() {
    const envHome = process.env.HOME;
    return envHome && envHome.length > 0 ? envHome : homedir();
}
function expand(filePath) {
    const home = homeBase();
    if (filePath === "~")
        return home;
    if (filePath.startsWith("~/"))
        return home + filePath.slice(1);
    return filePath;
}
export function toCwd(filePath, cwd) {
    const expanded = expand(filePath);
    return isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
}
/**
 * Canonicalize a path, resolving every symlink component to its target
 * (loop-guarded, ELOOP on cycles). Non-existent final components resolve
 * lexically — the canonical form of a not-yet-created file. The hashline
 * tools key their state by canonical absolute paths, so the same file reached
 * through different symlink spellings lands on the same store rows.
 * @param path - the path to canonicalize (absolute or relative).
 */
export async function resolveTarget(path) {
    const absolutePath = resolvePath(path);
    const { root } = parse(absolutePath);
    const parts = absolutePath
        .slice(root.length)
        .split(sep)
        .filter((part) => part.length > 0);
    const visitedSymlinks = new Set();
    async function resParts(currentPath, remainingParts) {
        if (remainingParts.length === 0) {
            return currentPath;
        }
        const [nextPart, ...tail] = remainingParts;
        const candidatePath = join(currentPath, nextPart);
        try {
            const candidateStats = await lstat(candidatePath);
            if (!candidateStats.isSymbolicLink()) {
                return resParts(candidatePath, tail);
            }
            if (visitedSymlinks.has(candidatePath)) {
                const error = new Error(`Too many symbolic links while resolving ${path}`);
                error.code = "ELOOP";
                throw error;
            }
            visitedSymlinks.add(candidatePath);
            const linkTargetPath = resolvePath(dirname(candidatePath), await readlink(candidatePath));
            const targetParts = linkTargetPath
                .slice(parse(linkTargetPath).root.length)
                .split(sep)
                .filter((part) => part.length > 0);
            return resParts(parse(linkTargetPath).root, [
                ...targetParts,
                ...tail,
            ]);
        }
        catch (error) {
            if (errCode(error) === "ENOENT") {
                return join(candidatePath, ...tail);
            }
            throw error;
        }
    }
    return resParts(root, parts);
}

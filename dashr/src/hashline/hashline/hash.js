/**
 * Hash persistence — deep persistence wrapper for HashAssign.
 * Private to HashAssign seam; use `from "./hash-assign.js"` for pure APIs
 * and `from "./hash.js"` only for persistence-aware lineHashes.
 * Now imports pure APIs from hash-assign (no circular).
 * Hash line purity seam: lineHashes takes HashSnapshotIO injection so hash.ts
 * is the only place that touches the DB — hash-assign stays pure.
 * @module dsh-better-edit/hashline/hash
 */
import { splitLines } from "../utils.js";
import { loadHashStore } from "../hash-store.js";
import { contentChecksum, initHasher, HASH_RE } from "./hash-assign.js";
import { lineHashesPure, mapStableHashes } from "./hash-assign.js";
let defaultHashSnapshotIO;
export function setDefaultHashSnapshotIO(io) {
    defaultHashSnapshotIO = io;
}
export function snapshotIOFor(store) {
    if (store) {
        return {
            get: (path, content, deleteCorrupt) => Promise.resolve(store.getSnapshot(path, content, deleteCorrupt)),
            upsert: (path, checksum, lineCount, hashes) => {
                store.upsertSnapshot(path, checksum, lineCount, hashes);
                return Promise.resolve();
            },
        };
    }
    return defaultHashSnapshotIO ?? {
        get: async (path, content, deleteCorrupt) => {
            const s = await loadHashStore();
            return s.getSnapshot(path, content, deleteCorrupt);
        },
        upsert: async (path, checksum, lineCount, hashes) => {
            const s = await loadHashStore();
            s.upsertSnapshot(path, checksum, lineCount, hashes);
        },
    };
}
export function isValidHashList(value) {
    if (!Array.isArray(value))
        return false;
    for (const hash of value) {
        if (typeof hash !== "string" || !HASH_RE.test(hash))
            return false;
    }
    return true;
}
export async function lineHashes(content, path, previous, ioOrStore, persist) {
    await initHasher();
    if (!path)
        return lineHashesPure(content);
    // Back-compat: caller may pass HashStore as 4th arg; adapt to IO.
    const io = ioOrStore && "getSnapshot" in ioOrStore
        ? snapshotIOFor(ioOrStore)
        : ioOrStore ?? snapshotIOFor(undefined);
    if (previous) {
        const newHashes = mapStableHashes(previous.content, previous.hashes, content, previous.removedHashes);
        if (persist !== false && io) {
            try {
                await io.upsert(path, contentChecksum(content), splitLines(content).length, newHashes);
            }
            catch (e) {
                console.error("Failed to persist hash snapshot:", e);
            }
        }
        return newHashes;
    }
    let cached;
    if (io) {
        try {
            cached = await io.get(path, content, persist !== false);
        }
        catch (e) {
            console.error("Failed to read hash store snapshot:", e);
        }
    }
    if (cached)
        return cached;
    const newHashes = lineHashesPure(content);
    if (persist !== false && io) {
        try {
            await io.upsert(path, contentChecksum(content), splitLines(content).length, newHashes);
        }
        catch (e) {
            console.error("Failed to persist hash snapshot:", e);
        }
    }
    return newHashes;
}

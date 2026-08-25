/**
 * Undo persistence for the hashline tools: before an edit is applied, the
 * pre-edit state (content, BOM, original line ending, hash anchors, and the
 * result content that the undo must verify against) is written to the hash
 * store. `undo_last_edit` reverts only when the file still matches the stored
 * result — a later external write clears the history instead of being
 * overwritten. Undo survives restarts (the store is on disk).
 * @module dsh-better-edit/undo-edit
 */
import type { LineEnding } from './edit-diff.js';
export interface UndoEntry {
    content: string;
    bom: string;
    originalEnding: LineEnding;
    hashes: string[];
    resultContent: string;
}
/**
 * Persist an undo entry for one path before mutating it.
 * @param path - canonical absolute path.
 * @param entry - the pre-edit state plus the result content the undo will verify.
 * @returns whether persistence succeeded, plus a restore that puts the previous
 *   undo entry back (used when the mutation itself fails).
 */
export declare function saveUndo(path: string, entry: UndoEntry): Promise<{
    persisted: boolean;
    restore: () => Promise<void>;
}>;
/** Load the last undo entry for a path, if any. */
export declare function getUndo(path: string): Promise<UndoEntry | undefined>;
/** Drop the undo entry for a path (a write or an undone revert clears history). */
export declare function clearUndo(path: string): Promise<void>;

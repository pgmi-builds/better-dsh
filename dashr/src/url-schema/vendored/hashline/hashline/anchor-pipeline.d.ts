/**
 * AnchorPipeline — deep module owning the anchor autofix chain.
 *
 * Single ordering invariant (private):
 *   swapReversed → stripBare → stripDiff → valEdit → boundaryDups splice → valEdit → verifyServed → resToSpan
 *
 * Detection (valEdit → boundaryDups[]) and correction (splice + second valEdit)
 * were split across resolve.ts / apply.ts with an implicit coupling.
 * This seam co-locates that invariant. Public surface is two functions:
 *   resEdit  — pre-validation (tool-layer, no file state)
 *   applyEdit — full pipeline (file + hashes + served verification)
 *
 * Private to this seam (not re-exported): stripBarePrefixes, stripDiffPrefixes,
 * swapReversedRanges, valEdit, boundaryDups helpers, warnUnicodeEsc, findNewEdge,
 * resAnchorFromMap, assertAligned, etc. They remain exported from resolve.ts
 * for backwards compat but are marked @internal and should be imported via this
 * module only.
 *
 * @module dsh-better-edit/hashline/anchor-pipeline
 */
export type Anchor = {
    hash: string;
};
declare function parseRef(ref: string): Anchor;
export declare const parseHashRef: typeof parseRef;
export declare function parseText(edit: string): string[];
export type RAnchor = {
    line: number;
    hash: string;
    hashMatched: boolean;
};
export type HEdit = {
    content_lines: string[];
    hash_bounds: [Anchor, Anchor];
};
export type RHEdit = {
    content_lines: string[];
    hash_bounds: [RAnchor, RAnchor];
};
export interface BDup {
    kind: "trailing" | "leading" | "first-new-after" | "last-new-before";
    replacementLineIndex: number;
}
export interface AutoFix {
    kind: "trailing" | "leading" | "first-new-after" | "last-new-before";
    removedLine: string;
    removedLineIndex: number;
}
export interface NEdit {
    loc: string;
    currentContent: string;
}
export type HTEdit = {
    replacement_text: string;
    remove_from: string;
    remove_to: string;
};
export declare function resEdit(edit: HTEdit, warnings?: string[]): HEdit;
declare function warnUnicodeEsc(edit: HEdit, warnings: string[]): void;
/** @internal — private to anchor-pipeline seam */
export declare function findNewEdge(contentLines: string[], rangeLines: string[], fromEnd: boolean): {
    index: number;
    line: string;
} | undefined;
export { warnUnicodeEsc };
export type ServedCode = "E_RANGE_STALE" | "E_RANGE_UNSERVED" | "E_RANGE_UNVERIFIED";
export interface ServedRow {
    position: number;
    hash: string;
}
export declare class ServedRejectionError extends Error {
    readonly code: ServedCode;
    readonly firstOffendingLine: number | undefined;
    readonly servedRows: ServedRow[];
    constructor(opts: {
        code: ServedCode;
        message: string;
        firstOffendingLine?: number;
        servedRows: ServedRow[];
    });
}
export declare function isServedRejection(error: unknown): error is ServedRejectionError;
export declare class AnchorMismatchError extends Error {
    readonly servedRows: ServedRow[];
    constructor(message: string, servedRows: ServedRow[]);
}
export declare function isAnchorMismatch(error: unknown): error is AnchorMismatchError;
export declare function buildRangeEcho(startLine: number, endLine: number, fileHashes: string[]): ServedRow[];
export declare function fmtServedRows(rows: ServedRow[], fileLines: string[]): string;
export declare function verifyServedRange(args: {
    served: (string | null)[];
    startHash: string;
    endHash: string;
    startLine: number;
    endLine: number;
    fileHashes: string[];
    fileLines: string[];
    filePath?: string;
}): void;
export interface ResolvedRange {
    startLine: number;
    endLine: number;
    startHash: string;
    endHash: string;
    delta: number;
}
export type ServeRecordPolicy = "live" | "preview";
export declare function recordEchoServes(sessionKey: string, path: string, rows: ServedRow[], policy: ServeRecordPolicy, lineCount?: number): Promise<void>;
type LIdx = {
    fileLines: string[];
    lineStarts: number[];
};
export declare function buildIdx(content: string): LIdx;
export declare function applyEdit(content: string, edit: HEdit, signal?: AbortSignal, precomputedHashes?: string[], filePath?: string, served?: (string | null)[]): {
    content: string;
    firstChangedLine: number | undefined;
    lastChangedLine: number | undefined;
    range: ResolvedRange;
    warnings?: string[];
    noopEdit?: NEdit;
    autoFixes?: AutoFix[];
};
export declare function fmtRegion(hashes: string[], lines: string[]): string;
export declare function changedRange(original: string, result: string): {
    firstChangedLine: number;
    lastChangedLine: number;
} | null;

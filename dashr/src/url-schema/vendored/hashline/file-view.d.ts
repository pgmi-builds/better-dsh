/**
 * FileView — deep module owning "what the model sees".
 *
 * Single seam for normalize → hash → render → truncate → served-row
 * selection. Previously split across file-reader, read-render, truncate,
 * file-kind, validation — each shallow (interface≈implementation). Now one
 * file owns the invariant; deleting it would scatter complexity (deep).
 *
 * Private helpers inlined from file-reader (normFromText/fileSnap),
 * read-render (fmtReadPreview), truncate (truncateHead), file-kind
 * (loadFileKindAndText), validation (valKind/valAccess).
 * Old files are shims re-exporting from this seam for compat.
 *
 * Two surfaces:
 *  - `preview` (pure, no IO) — tested without filesystem
 *  - `readView` (IO) — read + normalize + render + truncate + hashes
 *
 * @module dsh-better-edit/file-view
 */
import { type LineEnding } from "./edit-diff.js";
import type { FileIO } from "./fs-bridge.js";
import type { ServedRow } from "./hashline/served.js";
import type { HashStore } from "./hash-store.js";
export declare const MAX_HASH_LINES: number;
export declare const DEFAULT_MAX_LINES = 2000;
export declare const DEFAULT_MAX_BYTES: number;
export interface TruncationResult {
    content: string;
    truncated: boolean;
    truncatedBy: 'lines' | 'bytes' | null;
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    lastLinePartial: boolean;
    firstLineExceedsLimit: boolean;
    maxLines: number;
    maxBytes: number;
}
export declare function formatSize(bytes: number): string;
export declare function truncateHead(content: string, options?: {
    maxLines?: number;
    maxBytes?: number;
}): TruncationResult;
export type LFile = {
    kind: "directory";
} | {
    kind: "image";
    mimeType: string;
} | {
    kind: "text";
    text: string;
    hadUtf8DecodeErrors?: true;
} | {
    kind: "binary";
    description: string;
};
export interface LoadFileOptions {
    maxLines?: number;
    displayPath?: string;
}
export declare function loadFileKindAndText(filePath: string, options?: LoadFileOptions): Promise<LFile>;
export declare function valAccess(absolutePath: string, path: string, accessMode?: number): Promise<void>;
export declare function valKind(file: LFile, path: string): asserts file is {
    kind: "text";
    text: string;
    hadUtf8DecodeErrors?: true;
};
export interface NormFile {
    absolutePath: string;
    normalized: string;
    bom: string;
    originalEnding: LineEnding;
    fileHashes: string[];
    hadUtf8DecodeErrors: boolean;
}
export type SnapInfo = {
    snapshotId: string;
    ino: number;
    mtimeMs: number;
    ctimeMs: number;
    size: number;
};
export declare function fileSnap(absolutePath: string): Promise<SnapInfo>;
export interface ReadNormOptions {
    signal?: AbortSignal;
    accessMode?: number;
    preloadedFile?: LFile;
    maxLines?: number;
    store?: HashStore;
    noPersist?: boolean;
}
export declare function normFromText(input: {
    absolutePath: string;
    rawText: string;
    displayPath: string;
    signal?: AbortSignal;
    maxLines?: number;
    store?: HashStore;
    noPersist?: boolean;
    hadUtf8DecodeErrors?: boolean;
}): Promise<NormFile>;
export declare function readNormFile(path: string, cwd: string, options?: ReadNormOptions): Promise<NormFile>;
export declare function formatPaginationHint(startLine: number, endLine: number, totalLines: number, nextOffset: number, byteLimit?: number): string;
export declare function fmtReadPreview(text: string, options: {
    offset?: number;
    limit?: number;
}, precomputedHashes?: string[], path?: string, maxLineBytes?: number, maxTruncLines?: number): Promise<{
    text: string;
    truncation?: TruncationResult;
    nextOffset?: number;
    served: ServedRow[];
}>;
export interface FileView {
    text: string;
    hashes: string[];
    served: ServedRow[];
    absolutePath: string;
    truncation?: TruncationResult;
    nextOffset?: number;
    hadUtf8DecodeErrors: boolean;
    bom: string;
    originalEnding: LineEnding;
    normalized: string;
}
export interface PreviewOpts {
    offset?: number;
    limit?: number;
}
export interface ReadViewOpts extends PreviewOpts {
    signal?: AbortSignal;
}
export declare function preview(content: string, hashes: string[], opts?: PreviewOpts, absolutePath?: string): Promise<{
    text: string;
    served: ServedRow[];
    truncation?: TruncationResult;
    nextOffset?: number;
}>;
export declare function readView(io: FileIO, path: string, cwd: string, opts?: ReadViewOpts): Promise<FileView>;

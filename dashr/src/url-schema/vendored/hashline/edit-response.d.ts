import type { ServedRow } from "./hashline/served.js";
export type EditDetails = {
    diff: string;
    firstChangedLine?: number;
    snapshotId?: string;
    classification?: "noop";
    metrics?: RMetrics;
    servedRows?: ServedRow[];
    servedByPath?: Array<{
        path: string;
        servedRows: ServedRow[];
    }>;
    warnings?: string[];
    driftNotice?: string;
};
type TResult = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
    details: EditDetails;
};
export type RMetrics = {
    edits_attempted: number;
    edits_noop: number;
    warnings: number;
    classification: "applied" | "noop";
    changed_lines?: {
        first: number;
        last: number;
    };
    added_lines?: number;
    removed_lines?: number;
};
export type RMeta = {
    editsAttempted: number;
    noopEditsCount: number;
    firstChangedLine?: number;
    lastChangedLine?: number;
    addedLines: number;
    removedLines: number;
};
type NEditEntry = {
    loc: string;
    currentContent: string;
};
export interface NoopInput {
    path: string;
    noopEdit: NEditEntry | undefined;
    snapshotId?: string;
    editMeta: RMeta;
    warnings: string[] | undefined;
    driftNotice?: string;
}
export interface SuccessInput {
    path: string;
    originalNormalized: string;
    originalHashes: string[];
    result: string;
    resultHashes: string[];
    warnings: string[] | undefined;
    snapshotId?: string;
    editMeta: RMeta;
    driftNotice?: string;
}
export declare function buildMetrics(args: {
    classification: "applied" | "noop";
    editsAttempted: number;
    noopEditsCount: number;
    warningsCount: number;
    firstChangedLine?: number;
    lastChangedLine?: number;
    addedLines?: number;
    removedLines?: number;
}): RMetrics;
export interface FinalizeInput {
    diff: string;
    warnings?: string[];
    driftNotice?: string;
}
export declare function finalizeResult(input: FinalizeInput): string;
export declare function finalizeToolResult(details: EditDetails): {
    content: Array<{
        type: "text";
        text: string;
    }>;
    servedRows: ServedRow[] | undefined;
};
export declare function buildNoop(input: NoopInput): TResult;
export declare function buildChanged(input: SuccessInput): TResult;
export type BatchSection = {
    path: string;
    originalNormalized: string;
    result: string;
    originalHashes: string[];
    resultHashes: string[];
    warnings: string[] | undefined;
    driftNotice: string | undefined;
    appliedCount: number;
    noopCount: number;
    totalAddedLines: number;
    totalRemovedLines: number;
};
export type BatchDetails = EditDetails;
export declare function buildBatchResult(sections: BatchSection[]): TResult;
export {};

/**
 * Debounced preview controller — extracted from buildToolDef so hashline seams
 * stay pure and the debounce invariant is testable.
 * @module dsh-better-edit/preview-controller
 */
export declare const PREVIEW_DEBOUNCE_MS = 150;
export interface PreviewHost {
    cwd: string;
    executionStarted: boolean;
    argsComplete: boolean;
    state: RRState;
    invalidate: () => void;
}
export type PreviewCompute = (args: unknown, cwd: string) => Promise<RPreview>;
export interface RPreview {
    error?: string;
    text?: string;
}
export interface RRState {
    argsKey?: string;
    preview?: RPreview;
    previewGeneration?: number;
    previewTimer?: ReturnType<typeof setTimeout>;
}
export declare function getPreviewInput(_args: unknown): unknown;
export declare class DebouncedPreview {
    private readonly compute;
    private readonly debounceMs;
    constructor(compute: PreviewCompute, debounceMs?: number);
    renderCall(host: PreviewHost, args: unknown): void;
    cancel(state: RRState): void;
    clearResult(state: RRState): void;
}

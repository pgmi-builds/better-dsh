/**
 * Debounced preview controller — extracted from buildToolDef so hashline seams
 * stay pure and the debounce invariant is testable.
 * @module dsh-better-edit/preview-controller
 */
export const PREVIEW_DEBOUNCE_MS = 150;
export function getPreviewInput(_args) {
    return null;
}
export class DebouncedPreview {
    compute;
    debounceMs;
    constructor(compute, debounceMs = PREVIEW_DEBOUNCE_MS) {
        this.compute = compute;
        this.debounceMs = debounceMs;
    }
    renderCall(host, args) {
        const { state } = host;
        const previewInput = getPreviewInput(args);
        if (host.executionStarted || !host.argsComplete || !previewInput) {
            this.cancel(state);
            return;
        }
        const argsKey = JSON.stringify(previewInput);
        if (state.argsKey === argsKey)
            return;
        this.cancel(state);
        state.argsKey = argsKey;
        const previewGeneration = (state.previewGeneration ?? 0) + 1;
        state.previewGeneration = previewGeneration;
        state.previewTimer = setTimeout(() => {
            state.previewTimer = undefined;
            this.compute(args, host.cwd)
                .then((preview) => {
                if (state.argsKey === argsKey && state.previewGeneration === previewGeneration) {
                    state.preview = preview;
                    host.invalidate();
                }
            })
                .catch((err) => {
                if (state.argsKey === argsKey && state.previewGeneration === previewGeneration) {
                    state.preview = { error: err instanceof Error ? err.message : String(err) };
                    host.invalidate();
                }
            });
        }, this.debounceMs);
    }
    cancel(state) {
        if (state.previewTimer) {
            clearTimeout(state.previewTimer);
            state.previewTimer = undefined;
        }
        state.argsKey = undefined;
        state.preview = undefined;
        state.previewGeneration = (state.previewGeneration ?? 0) + 1;
    }
    clearResult(state) {
        if (state.previewTimer) {
            clearTimeout(state.previewTimer);
            state.previewTimer = undefined;
        }
        state.preview = undefined;
        state.previewGeneration = (state.previewGeneration ?? 0) + 1;
    }
}

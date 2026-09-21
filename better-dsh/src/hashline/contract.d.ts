/**
 * One module owns the request shapes for the hashline tools — edit,
 * read, undo_last_edit — plus their validation. Field sets are
 * declared once here; every tool validates through these asserts, and the
 * [E_BAD_SHAPE] vocabulary is shared instead of re-implemented per tool.
 *
 * Contract now mirrors upstream ADR-0007: {path: string|null, edits: [[remove_from,remove_to,replacement_text],...]} tuple payload,
 * single-file, atomic. batch_edit is removed.
 * @module dsh-better-edit/contract
 */
export type EditItem = {
    remove_from: string;
    remove_to: string;
    replacement_text: string;
};
export type EditRequest = {
    path: string | null;
    edits: EditItem[];
};
export interface EditParams {
    path: string;
    remove_from: string;
    remove_to: string;
    replacement_text: string;
}
export interface ReadParams {
    path: string;
    offset?: number;
    limit?: number;
}
export interface UndoParams {
    path: string;
}
export interface BatchItemParams {
    path?: string;
    remove_from: string;
    remove_to: string;
    replacement_text: string;
}
export interface BatchEditParams {
    edits: BatchItemParams[];
}
export declare const normalizedEdit: unique symbol;
export type NormalizedEditRequest = EditRequest & {
    [normalizedEdit]?: true;
};
export declare function isNormalizedEdit(input: unknown): input is NormalizedEditRequest;
export declare function itemFromTuple(value: unknown): EditItem | undefined;
export declare function editRequestFrom(input: unknown): NormalizedEditRequest | undefined;
export declare const EDIT_TUPLE_HINT: string;
/**
 * Normalize `file_path` → `path` alias on the request record and tuple edits → objects.
 * Returns the input unchanged when not a record; otherwise returns a shallow copy with
 * the alias applied so callers never mutate the original `args` object.
 */
export declare function normalizeRequest(input: unknown): unknown;
/** @deprecated use normalizeRequest — kept as alias for migration */
export declare const normReq: typeof normalizeRequest;
export declare function prepareEditArguments(args: unknown): Record<string, unknown>;
export declare function assertEditRequest(request: unknown): asserts request is NormalizedEditRequest;
export declare function assertBatchEditRequest(_request: unknown): asserts _request is BatchEditParams;
export declare function assertReadRequest(request: unknown): asserts request is ReadParams;
export declare function assertUndoRequest(request: unknown): asserts request is UndoParams;
export declare const replacementTextSchema: {
    readonly type: "string";
    readonly description: "Complete replacement for the range; use \"\" to delete";
};
export declare const removeFromSchema: {
    readonly type: "string";
    readonly description: "First line to remove (inclusive)";
};
export declare const removeToSchema: {
    readonly type: "string";
    readonly description: "Last line to remove (inclusive)";
};
export declare const pathSchema: {
    readonly type: "string";
    readonly description: "File path; null infers it from anchors";
};
export declare const editPathSchema: {
    readonly anyOf: readonly [{
        readonly type: "string";
        readonly minLength: 1;
        readonly description: "File path; null infers it from anchors";
    }, {
        readonly type: "null";
        readonly description: "null infers path from anchors";
    }];
};
export declare const editTupleSchema: {
    readonly type: "array";
    readonly prefixItems: readonly [{
        readonly type: "string";
        readonly description: "First line to remove (inclusive)";
    }, {
        readonly type: "string";
        readonly description: "Last line to remove (inclusive)";
    }, {
        readonly type: "string";
        readonly description: "Complete replacement for the range; use \"\" to delete";
    }];
    readonly minItems: 3;
    readonly maxItems: 3;
    readonly description: "[remove_from, remove_to, replacement_text]";
};
export declare const editToolSchema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly required: readonly ["path", "edits"];
    readonly properties: {
        readonly path: {
            readonly anyOf: readonly [{
                readonly type: "string";
                readonly minLength: 1;
                readonly description: "File path; null infers it from anchors";
            }, {
                readonly type: "null";
                readonly description: "null infers path from anchors";
            }];
        };
        readonly edits: {
            readonly type: "array";
            readonly description: "Ordered list of edit tuples";
            readonly minItems: 1;
            readonly maxItems: 32;
            readonly items: {
                readonly type: "array";
                readonly prefixItems: readonly [{
                    readonly type: "string";
                    readonly description: "First line to remove (inclusive)";
                }, {
                    readonly type: "string";
                    readonly description: "Last line to remove (inclusive)";
                }, {
                    readonly type: "string";
                    readonly description: "Complete replacement for the range; use \"\" to delete";
                }];
                readonly minItems: 3;
                readonly maxItems: 3;
                readonly description: "[remove_from, remove_to, replacement_text]";
            };
        };
    };
};

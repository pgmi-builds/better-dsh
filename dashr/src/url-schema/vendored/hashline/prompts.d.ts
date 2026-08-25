/**
 * Model-facing prompt text for the hashline tools, embedded so the bundle
 * ships no external prompt files. Each tool's schema `description` is short;
 * the `tool:*` system-prompt sections carry the brief guidance the model
 * reads when the tools are presented. Guidance is uniform: a one-line opener
 * followed by tight bullets.
 * @module dsh-better-edit/prompts
 */
export interface ToolGuidance {
    intro: string;
    lines: readonly string[];
}
export declare const EDIT_DESCRIPTION: string;
export declare const EDIT_GUIDANCE: ToolGuidance;
export declare const READ_DESCRIPTION: string;
export declare const READ_GUIDANCE: ToolGuidance;
export declare const UNDO_DESCRIPTION: string;
export declare const UNDO_GUIDANCE: ToolGuidance;
/**
 * @deprecated batch_edit guidance seam was removed with ADR-0003 (payload contract
 * merged batch_edit into edit's {path, edits:[[hash,hash,text]]} arity). This alias
 * is kept for backwards compat — use EDIT_DESCRIPTION. The guidance system no
 * longer includes tool:batch_edit.
 */
export declare const BATCH_EDIT_DESCRIPTION: string;
/** @deprecated see BATCH_EDIT_DESCRIPTION — use EDIT_GUIDANCE */
export declare const BATCH_EDIT_GUIDANCE: ToolGuidance;

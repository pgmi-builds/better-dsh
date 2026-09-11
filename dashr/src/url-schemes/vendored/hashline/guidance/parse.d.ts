/**
 * Pure parser for per-preset guidance override files.
 *
 * Only a leading `---` fence whose lines are empty or `order: <integer>` is
 * accepted. This module has zero IO — exhaustive unit testing without a temp
 * home.
 * @module dsh-better-edit/guidance/parse
 */
/** The parsed content of one override file. */
export interface ParsedSection {
    /** Front-matter `order`, when present and valid. */
    order?: number;
    /** The section text: the file body, or the whole file when no fence is present. */
    text: string;
    /** True when a leading `---` fence is present but does not parse (fast fail). */
    malformed?: boolean;
    /** Human-readable parse reason, present only when `malformed` is true. */
    reason?: string;
}
/**
 * Parse an override file. Only a leading `---` fence whose lines are empty or
 * `order: <integer>` is accepted. A leading `---` that does not parse (no
 * closing fence, unknown key, non-integer value) is a malformed override;
 * anything else is pure prose (the whole file as text).
 */
export declare function parseSectionFile(content: string): ParsedSection;
/**
 * True when an override file is blank: whitespace-only body and NO front-matter
 * fence (the "I want the default" case). The single source of truth for whether
 * a boot-time materialization pass should re-seed a file. False for prose with
 * content, for any valid fence (including a keyless/empty one — a deliberate
 * blank), and for malformed files.
 */
export declare function isBlankOverride(content: string): boolean;
/** True when an override file opens with a leading `---` fence that is malformed. */
export declare function isMalformedOverride(content: string): boolean;

/** One overridable tool section. */
export interface GuidanceSection {
    /** Registry section name, e.g. `tool:edit`. */
    name: string;
    /** Override file name inside a preset directory, e.g. `edit.md`. */
    file: string;
    /** Order used when the override file carries no front-matter `order`. */
    defaultOrder: number;
    /** The compiled default text, byte-identical to today's inline rendering. */
    renderDefault(): string;
}
/** The three sections, in default-order sequence. */
export declare const GUIDANCE_SECTIONS: readonly GuidanceSection[];
/** Render the compiled default text for one section. */
export declare function renderSectionDefault(name: string): string;
/** Options for resolving one section's guidance. */
export interface ResolveGuidanceOptions {
    /** Agent preset id, or undefined to skip the preset layer. */
    presetId?: string;
    /** Plugin shared home directory (`$DSH_HOME/plugins/dsh-better-edit`). */
    homeDir: string;
}
/** The resolved text and order for one section. */
export interface GuidanceResolution {
    order: number;
    text: string;
    /** Set when the override file was malformed and the compiled default was used. */
    malformed?: {
        file: string;
        reason: string;
    };
}
/**
 * Resolve one section's guidance: the first override file that exists wins,
 * falling back to the compiled default. A missing or blank file (ENOENT, or
 * whitespace-only with no fence) advances the chain; a malformed file resolves
 * to the compiled default and reports itself; any other read error propagates.
 */
export declare function resolveSection(name: string, options: ResolveGuidanceOptions): Promise<GuidanceResolution>;
/** The resolved configuration of one section, ready for the systemPrompt registry. */
export interface SectionOverride {
    name: string;
    order: number;
    text: string;
    /** Set when the override file was malformed and the compiled default was used. */
    malformed?: {
        file: string;
        reason: string;
    };
}
/**
 * Resolve all three sections for a preset. `presetId === undefined` skips the
 * `<preset>/` layer and resolves straight to the compiled defaults.
 */
export declare function composeSections(presetId: string | undefined, homeDir: string): Promise<SectionOverride[]>;

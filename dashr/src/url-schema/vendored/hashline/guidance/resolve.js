/**
 * Resolver: IO-light seam owning "first existing candidate wins, blank=skip,
 * malformed=fallback+report" policy for guidance override files.
 *
 * Tested via temp-home FS; materializer stubs this module.
 * @module dsh-better-edit/guidance/resolve
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EDIT_GUIDANCE, READ_GUIDANCE, UNDO_GUIDANCE, } from "../prompts.js";
import { errCode } from "../utils.js";
import { isBlankOverride, parseSectionFile } from "./parse.js";
/**
 * Render one tool's guidance as its intro line, a blank line, then bullets.
 * Uniform across the four sections: no tool-schema description is duplicated
 * (that already reaches the model through the tool catalog).
 */
function guidanceText(g) {
    return [g.intro, "", bulletLines(g.lines)].join("\n");
}
function bulletLines(lines) {
    return lines.map((line) => `- ${line}`).join("\n");
}
/** The three sections, in default-order sequence. */
export const GUIDANCE_SECTIONS = [
    {
        name: "tool:read",
        file: "read.md",
        defaultOrder: 130,
        renderDefault: () => guidanceText(READ_GUIDANCE),
    },
    {
        name: "tool:edit",
        file: "edit.md",
        defaultOrder: 131,
        renderDefault: () => guidanceText(EDIT_GUIDANCE),
    },
    {
        name: "tool:undo_last_edit",
        file: "undo_last_edit.md",
        defaultOrder: 133,
        renderDefault: () => guidanceText(UNDO_GUIDANCE),
    },
];
const SECTION_BY_NAME = new Map(GUIDANCE_SECTIONS.map((section) => [section.name, section]));
/** Render the compiled default text for one section. */
export function renderSectionDefault(name) {
    const section = SECTION_BY_NAME.get(name);
    if (!section)
        throw new Error(`unknown guidance section: ${name}`);
    return section.renderDefault();
}
function overrideCandidates(file, options) {
    const candidates = [];
    if (options.presetId !== undefined) {
        candidates.push(join(options.homeDir, options.presetId, file));
    }
    return candidates;
}
/**
 * Resolve one section's guidance: the first override file that exists wins,
 * falling back to the compiled default. A missing or blank file (ENOENT, or
 * whitespace-only with no fence) advances the chain; a malformed file resolves
 * to the compiled default and reports itself; any other read error propagates.
 */
export async function resolveSection(name, options) {
    const section = SECTION_BY_NAME.get(name);
    if (!section)
        throw new Error(`unknown guidance section: ${name}`);
    for (const candidate of overrideCandidates(section.file, options)) {
        const content = await readFile(candidate, "utf-8").catch((error) => {
            if (errCode(error) === "ENOENT")
                return undefined;
            throw error;
        });
        if (content === undefined)
            continue;
        const parsed = parseSectionFile(content);
        if (parsed.malformed) {
            // A broken override must never reach the model. Resolve to the
            // compiled default and report the file + parse reason to the caller.
            return {
                order: section.defaultOrder,
                text: section.renderDefault(),
                malformed: {
                    file: candidate,
                    reason: parsed.reason ?? "malformed override",
                },
            };
        }
        // Blank (no fence, whitespace-only) means "use the default": advance the
        // fallback chain rather than render an empty section.
        if (isBlankOverride(content))
            continue;
        return { order: parsed.order ?? section.defaultOrder, text: parsed.text };
    }
    return { order: section.defaultOrder, text: section.renderDefault() };
}
/**
 * Resolve all three sections for a preset. `presetId === undefined` skips the
 * `<preset>/` layer and resolves straight to the compiled defaults.
 */
export async function composeSections(presetId, homeDir) {
    return Promise.all(GUIDANCE_SECTIONS.map(async (section) => {
        const resolved = await resolveSection(section.name, {
            presetId,
            homeDir,
        });
        return {
            name: section.name,
            order: resolved.order,
            text: resolved.text,
            malformed: resolved.malformed,
        };
    }));
}

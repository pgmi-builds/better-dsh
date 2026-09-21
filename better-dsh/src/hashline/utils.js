export function isRec(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function normalizeFilePath(record) {
    if (typeof record.path !== "string" && typeof record.file_path === "string") {
        record.path = record.file_path;
        delete record.file_path;
    }
}
export function splitLines(text) {
    if (text.length === 0)
        return [""];
    const lines = text.split("\n");
    return text.endsWith("\n") ? lines.slice(0, -1) : lines;
}
export function visLines(text) {
    if (text.length === 0)
        return [];
    const lines = text.split("\n");
    return text.endsWith("\n") ? lines.slice(0, -1) : lines;
}
export function rejectUnknownFields(obj, allowed, label, hint) {
    const unknown = Object.keys(obj).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
        const suffix = hint ? ` ${hint}` : "";
        throw new Error(`[E_BAD_SHAPE] ${label} contains unknown or unsupported fields: ${unknown.join(", ")}.${suffix}`);
    }
}
export function cntDiff(diff, marker) {
    if (!diff)
        return 0;
    let count = 0;
    for (const line of diff.split("\n")) {
        if (line.startsWith(marker) &&
            !line.startsWith(`${marker}${marker}${marker}`)) {
            count += 1;
        }
    }
    return count;
}
export function abortIf(signal) {
    if (signal?.aborted)
        throw new Error("Operation aborted");
}
export function errCode(error) {
    if (error instanceof Error) {
        return error.code;
    }
    return undefined;
}
export function lastNonEmptyIndex(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].length > 0)
            return i;
    }
    return -1;
}
export function firstNonEmptyIndex(lines) {
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 0)
            return i;
    }
    return -1;
}
export function lastNonEmpty(lines) {
    const idx = lastNonEmptyIndex(lines);
    return idx >= 0 ? lines[idx] : undefined;
}
export function firstNonEmpty(lines) {
    const idx = firstNonEmptyIndex(lines);
    return idx >= 0 ? lines[idx] : undefined;
}
export function clipLine(line, maxLen = 200) {
    const flat = line.replace(/\n/g, "\\n");
    return flat.length > maxLen ? `${flat.slice(0, maxLen)}...` : flat;
}

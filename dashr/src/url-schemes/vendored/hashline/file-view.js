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
import { constants } from "node:fs";
import { open as fsOpen, stat as fsStat } from "fs/promises";
import { access as fsAccess } from "fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { SNIFF_BYTES, MAX_BYTES, MAX_READ_LINE_BYTES } from "./constants.js";
import { lineHashes, fmtRegion, HASH_SEP } from "./hashline/index.js";
import { HASH_SPACE } from "./hashline/hash-assign.js";
import { visLines, abortIf, errCode } from "./utils.js";
import { detectEnding, toLF, stripBOM } from "./edit-diff.js";
import { resolveTarget, toCwd } from "./paths.js";
export const MAX_HASH_LINES = HASH_SPACE;
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
function splitLinesForCounting(content) {
    if (content.length === 0)
        return [];
    const lines = content.split('\n');
    if (content.endsWith('\n'))
        lines.pop();
    return lines;
}
export function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
export function truncateHead(content, options = {}) {
    const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const totalBytes = Buffer.byteLength(content, 'utf-8');
    const lines = splitLinesForCounting(content);
    const totalLines = lines.length;
    if (totalLines <= maxLines && totalBytes <= maxBytes) {
        return {
            content,
            truncated: false,
            truncatedBy: null,
            totalLines,
            totalBytes,
            outputLines: totalLines,
            outputBytes: totalBytes,
            lastLinePartial: false,
            firstLineExceedsLimit: false,
            maxLines,
            maxBytes,
        };
    }
    const firstLineBytes = Buffer.byteLength(lines[0] ?? '', 'utf-8');
    if (firstLineBytes > maxBytes) {
        return {
            content: '',
            truncated: true,
            truncatedBy: 'bytes',
            totalLines,
            totalBytes,
            outputLines: 0,
            outputBytes: 0,
            lastLinePartial: false,
            firstLineExceedsLimit: true,
            maxLines,
            maxBytes,
        };
    }
    const outputLinesArr = [];
    let outputBytesCount = 0;
    let truncatedBy = 'lines';
    for (let i = 0; i < lines.length && i < maxLines; i++) {
        const line = lines[i];
        const lineBytes = Buffer.byteLength(line, 'utf-8') + (i > 0 ? 1 : 0);
        if (outputBytesCount + lineBytes > maxBytes) {
            truncatedBy = 'bytes';
            break;
        }
        outputLinesArr.push(line);
        outputBytesCount += lineBytes;
    }
    if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
        truncatedBy = 'lines';
    }
    const outputContent = outputLinesArr.join('\n');
    const finalOutputBytes = Buffer.byteLength(outputContent, 'utf-8');
    return {
        content: outputContent,
        truncated: true,
        truncatedBy,
        totalLines,
        totalBytes,
        outputLines: outputLinesArr.length,
        outputBytes: finalOutputBytes,
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines,
        maxBytes,
    };
}
// --- File kind (from file-kind.ts, private) ---
const IMG_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
]);
const TEXT_TYPES = new Set([
    "application/rtf",
    "application/xml",
    "application/x-ms-regedit",
]);
function detectTextBom(sample) {
    if (sample.length >= 4 &&
        sample[0] === 0xff &&
        sample[1] === 0xfe &&
        sample[2] === 0x00 &&
        sample[3] === 0x00)
        return "UTF-32LE";
    if (sample.length >= 4 &&
        sample[0] === 0x00 &&
        sample[1] === 0x00 &&
        sample[2] === 0xfe &&
        sample[3] === 0xff)
        return "UTF-32BE";
    if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe)
        return "UTF-16LE";
    if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff)
        return "UTF-16BE";
    return undefined;
}
function isTextType(mimeType) {
    return mimeType.startsWith("text/") || TEXT_TYPES.has(mimeType);
}
export async function loadFileKindAndText(filePath, options) {
    const pathStat = await fsStat(filePath);
    if (pathStat.isDirectory()) {
        return { kind: "directory" };
    }
    if (!pathStat.isFile()) {
        return {
            kind: "binary",
            description: "unsupported file type",
        };
    }
    if (pathStat.size > MAX_BYTES) {
        return {
            kind: "binary",
            description: `file exceeds ${MAX_BYTES} byte limit`,
        };
    }
    const fileHandle = await fsOpen(filePath, "r");
    try {
        const buffer = Buffer.alloc(SNIFF_BYTES);
        const { bytesRead } = await fileHandle.read(buffer, 0, SNIFF_BYTES, 0);
        if (bytesRead === 0) {
            return { kind: "text", text: "" };
        }
        const sample = buffer.subarray(0, bytesRead);
        const textBom = detectTextBom(sample);
        if (textBom) {
            return {
                kind: "binary",
                description: `${textBom} encoded text`,
            };
        }
        const detectedMimeType = (await fileTypeFromBuffer(sample))?.mime;
        if (detectedMimeType !== undefined &&
            !isTextType(detectedMimeType)) {
            if (IMG_TYPES.has(detectedMimeType)) {
                return { kind: "image", mimeType: detectedMimeType };
            }
            return {
                kind: "binary",
                description: detectedMimeType,
            };
        }
        const decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true });
        let hadUtf8DecodeErrors = false;
        let newlineCount = 0;
        const parts = [];
        function decodeChunk(chunk, stream) {
            const decoded = decoder.decode(chunk, { stream });
            if (!hadUtf8DecodeErrors && decoded.includes("\uFFFD")) {
                hadUtf8DecodeErrors = true;
            }
            if (options?.maxLines !== undefined) {
                for (let i = 0; i < decoded.length; i++) {
                    if (decoded.charCodeAt(i) === 10)
                        newlineCount++;
                }
                if (newlineCount > options.maxLines) {
                    throw new Error(`[E_FILE_TOO_LARGE] ${options.displayPath ?? filePath} has more than ${options.maxLines} lines, exceeding the ${options.maxLines}-line edit limit. Hashline editing targets source-sized files; for very large files use write or a non-line-based approach.`);
                }
            }
            return decoded;
        }
        parts.push(decodeChunk(sample, true));
        let position = bytesRead;
        while (true) {
            const { bytesRead: chunkBytesRead } = await fileHandle.read(buffer, 0, SNIFF_BYTES, position);
            if (chunkBytesRead === 0) {
                break;
            }
            const chunk = buffer.subarray(0, chunkBytesRead);
            parts.push(decodeChunk(chunk, true));
            position += chunkBytesRead;
        }
        parts.push(decodeChunk(new Uint8Array(0), false));
        return {
            kind: "text",
            text: parts.join(""),
            ...(hadUtf8DecodeErrors ? { hadUtf8DecodeErrors: true } : {}),
        };
    }
    finally {
        await fileHandle.close();
    }
}
// --- Validation (from validation.ts, private) ---
export async function valAccess(absolutePath, path, accessMode = constants.R_OK) {
    try {
        await fsAccess(absolutePath, accessMode);
    }
    catch (error) {
        const code = errCode(error);
        if (code === "ENOENT") {
            throw new Error(`[E_NOT_FOUND] File not found: ${path}`);
        }
        if (code === "EACCES" || code === "EPERM") {
            const accessLabel = accessMode & constants.W_OK ? "not writable" : "not readable";
            throw new Error(`[E_ACCESS] File is ${accessLabel}: ${path}`);
        }
        if (code === "ELOOP") {
            throw new Error(`[E_ACCESS] Too many symbolic links while resolving: ${path}`);
        }
        throw new Error(`[E_ACCESS] Cannot access file: ${path}`);
    }
}
export function valKind(file, path) {
    if (file.kind === "directory") {
        throw new Error(`[E_NOT_TEXT] Path is a directory: ${path}. Use ls to inspect directories.`);
    }
    if (file.kind === "binary") {
        throw new Error(`[E_NOT_TEXT] Path is a binary file: ${path} (${file.description}). Hashline edit only supports text files.`);
    }
    if (file.kind === "image") {
        throw new Error(`[E_NOT_TEXT] Path is an image file: ${path}. Hashline edit only supports text files.`);
    }
}
function fmtSnapId(canonicalPath, info) {
    return `v2|${canonicalPath}|${info.ino}|${info.mtimeMs}|${info.ctimeMs}|${info.size}`;
}
export async function fileSnap(absolutePath) {
    const canonicalPath = await resolveTarget(absolutePath);
    const stats = await fsStat(canonicalPath);
    return {
        snapshotId: fmtSnapId(canonicalPath, stats),
        ino: stats.ino,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
        size: stats.size,
    };
}
export async function normFromText(input) {
    const { absolutePath, displayPath, signal } = input;
    abortIf(signal);
    const { bom, text: rawContent } = stripBOM(input.rawText);
    const originalEnding = detectEnding(rawContent);
    const normalized = toLF(rawContent);
    if (input.maxLines !== undefined) {
        const lineCount = visLines(normalized).length;
        if (lineCount > input.maxLines) {
            throw new Error(`[E_FILE_TOO_LARGE] ${displayPath} has ${lineCount} lines, exceeding the ${input.maxLines}-line edit limit. Hashline editing targets source-sized files; for very large files use write or a non-line-based approach.`);
        }
    }
    const fileHashes = await lineHashes(normalized, absolutePath, undefined, input.store, input.noPersist !== true);
    return {
        absolutePath,
        normalized,
        bom,
        originalEnding,
        fileHashes,
        hadUtf8DecodeErrors: input.hadUtf8DecodeErrors === true,
    };
}
export async function readNormFile(path, cwd, options) {
    const absolutePath = toCwd(path, cwd);
    const resolvedPath = await resolveTarget(absolutePath);
    const signal = options?.signal;
    const accessMode = options?.accessMode ?? constants.R_OK;
    abortIf(signal);
    await valAccess(resolvedPath, path, accessMode);
    abortIf(signal);
    const file = options?.preloadedFile ??
        (await loadFileKindAndText(resolvedPath, {
            maxLines: options?.maxLines,
            displayPath: path,
        }));
    valKind(file, path);
    return normFromText({
        absolutePath: resolvedPath,
        rawText: file.text,
        displayPath: path,
        signal,
        maxLines: options?.maxLines,
        store: options?.store,
        noPersist: options?.noPersist,
        hadUtf8DecodeErrors: file.hadUtf8DecodeErrors,
    });
}
// --- Read render (from read-render.ts, private) ---
function normPosInt(value, name) {
    if (value === undefined)
        return undefined;
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`[E_BAD_SHAPE] Read request field "${name}" must be a positive integer.`);
    }
    return value;
}
export function formatPaginationHint(startLine, endLine, totalLines, nextOffset, byteLimit) {
    const sizeSuffix = byteLimit !== undefined ? ` (${formatSize(byteLimit)} limit)` : '';
    return `[Showing lines ${startLine}-${endLine} of ${totalLines}${sizeSuffix}. Use offset=${nextOffset} to continue.]`;
}
export async function fmtReadPreview(text, options, precomputedHashes, path, maxLineBytes = MAX_READ_LINE_BYTES, maxTruncLines = DEFAULT_MAX_LINES) {
    const allLines = visLines(text);
    const totalLines = allLines.length;
    const startLine = normPosInt(options.offset, 'offset') ?? 1;
    if (totalLines === 0) {
        if (startLine === 1) {
            const allHashes = precomputedHashes ??
                (await (path ? lineHashes(text, path) : lineHashes(text)));
            const emptyLineHash = allHashes[0];
            return {
                text: `${emptyLineHash}${HASH_SEP}\n[File is empty. Use edit to insert content.]`,
                served: [{ position: 0, hash: emptyLineHash }],
            };
        }
        return {
            text: `Offset ${startLine} is beyond end of file (0 lines total). The file is empty. Use edit to insert content.`,
            served: [],
        };
    }
    if (startLine > totalLines) {
        return {
            text: `Offset ${startLine} is beyond end of file (${totalLines} lines total). Use offset=1 to read from the start, or offset=${totalLines} to read the last line.`,
            served: [],
        };
    }
    const limit = normPosInt(options.limit, 'limit');
    const endIdx = limit
        ? Math.min(startLine - 1 + limit, totalLines)
        : totalLines;
    const selected = allLines.slice(startLine - 1, endIdx);
    const allHashes = precomputedHashes ??
        (await (path ? lineHashes(text, path) : lineHashes(text)));
    const selectedHashes = allHashes.slice(startLine - 1, endIdx);
    const formatted = fmtRegion(selectedHashes, selected);
    const maxBytes = maxLineBytes;
    const rowSizes = selected.map((line, index) => ({
        lineNumber: startLine + index,
        bytes: Buffer.byteLength(`${selectedHashes[index]}${HASH_SEP}${line}`, 'utf-8'),
    }));
    if (rowSizes.some((row) => row.bytes > maxBytes)) {
        const oversized = rowSizes.filter((row) => row.bytes > maxBytes);
        const rows = rowSizes.map((row, index) => row.bytes > maxBytes
            ? `[Line ${row.lineNumber} is ${formatSize(row.bytes)}, exceeds ${formatSize(maxBytes)}; content not shown. Use bash: sed -n '${row.lineNumber}p' <path> | head -c ${maxBytes}]`
            : fmtRegion([selectedHashes[index]], [selected[index]]));
        const skippedTruncation = truncateHead(rows.join('\n'), {
            maxBytes,
            maxLines: maxTruncLines,
        });
        const shownRowCount = skippedTruncation.content === ''
            ? 0
            : skippedTruncation.content.split('\n').length;
        const lastShownLine = shownRowCount > 0 ? startLine + shownRowCount - 1 : startLine - 1;
        const lineLabel = oversized.length === 1
            ? `Line ${oversized[0].lineNumber}`
            : `Lines ${oversized.map((row) => row.lineNumber).join(', ')}`;
        const verb = oversized.length === 1 ? 'exceeds' : 'exceed';
        const addresses = oversized.map((row) => `${row.lineNumber}p`).join(';');
        const warning = `[${lineLabel} ${verb} ${formatSize(maxBytes)}; content not shown because hashline anchors require full lines. Inspect with bash: sed -n '${addresses}' <path> | head -c ${maxBytes}]`;
        let preview = skippedTruncation.content;
        let nextOffset;
        if (shownRowCount > 0 &&
            (skippedTruncation.truncated || lastShownLine < totalLines)) {
            nextOffset = lastShownLine + 1;
            preview += `\n\n${warning}\n${formatPaginationHint(startLine, lastShownLine, totalLines, nextOffset, skippedTruncation.truncated ? skippedTruncation.maxBytes : undefined)}`;
        }
        else {
            preview += `\n\n${warning}`;
        }
        const served = [];
        for (let index = 0; index < shownRowCount; index++) {
            if (rowSizes[index].bytes <= maxBytes) {
                served.push({
                    position: startLine - 1 + index,
                    hash: selectedHashes[index],
                });
            }
        }
        return {
            text: preview,
            truncation: skippedTruncation.truncated ? skippedTruncation : undefined,
            ...(nextOffset !== undefined ? { nextOffset } : {}),
            served,
        };
    }
    const truncation = truncateHead(formatted, {
        maxBytes,
        maxLines: maxTruncLines,
    });
    let preview = truncation.content;
    let nextOffset;
    if (truncation.truncated) {
        const endLineDisplay = startLine + truncation.outputLines - 1;
        nextOffset = endLineDisplay + 1;
        if (truncation.truncatedBy === 'lines') {
            preview += `\n\n${formatPaginationHint(startLine, endLineDisplay, totalLines, nextOffset)}`;
        }
        else {
            preview += `\n\n${formatPaginationHint(startLine, endLineDisplay, totalLines, nextOffset, truncation.maxBytes)}`;
        }
    }
    else if (endIdx < totalLines) {
        nextOffset = endIdx + 1;
        preview += `\n\n${formatPaginationHint(startLine, endIdx, totalLines, nextOffset)}`;
    }
    const served = [];
    for (let index = 0; index < truncation.outputLines; index++) {
        served.push({
            position: startLine - 1 + index,
            hash: selectedHashes[index],
        });
    }
    return {
        text: preview,
        truncation: truncation.truncated ? truncation : undefined,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        served,
    };
}
export async function preview(content, hashes, opts = {}, absolutePath) {
    return fmtReadPreview(content, opts, hashes, absolutePath);
}
export async function readView(io, path, cwd, opts = {}) {
    const { signal } = opts;
    const absolutePath = await io.resolve(path, cwd, signal);
    const rawText = await io.readText(absolutePath, signal);
    const { normalized, fileHashes, hadUtf8DecodeErrors, bom, originalEnding } = await normFromText({
        absolutePath,
        rawText,
        displayPath: path,
        signal,
        maxLines: MAX_HASH_LINES,
    });
    const r = await fmtReadPreview(normalized, { offset: opts.offset, limit: opts.limit }, fileHashes, absolutePath);
    return {
        text: r.text,
        hashes: fileHashes,
        served: r.served,
        absolutePath,
        truncation: r.truncation,
        nextOffset: r.nextOffset,
        hadUtf8DecodeErrors,
        bom,
        originalEnding,
        normalized,
    };
}

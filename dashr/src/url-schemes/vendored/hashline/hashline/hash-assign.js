/**
 * HashAssign — deep module owning hash assignment.
 *
 * Owns the `HASH_SPACE = 62^3` allocation invariant: every line gets a unique
 * 3-char anchor derived from canonicalized content via xxHash + probe-stride.
 * Previously split across alphabet.ts (ALPH), hasher.ts (xxh32), pure.ts
 * (lineHashesPure/mapStableHashes), hash.ts (lineHashes persistence).
 * Now one file owns the triad — ALPH/xxh32/hashAt are private to this seam.
 *
 * Callers use this seam's public surface: lineHashesPure, mapStableHashes,
 * lineHashes, canon, HASH_SEP, etc. Deleting this module would scatter the
 * allocation invariant across 4 files — it concentrates.
 *
 * @module dsh-better-edit/hashline/hash-assign
 */
import xxhash from "xxhash-wasm";
import { splitLines } from "../utils.js";
let hasher = null;
export function getH() {
    if (hasher)
        return hasher;
    throw new Error("xxhash-wasm hasher not initialized; await initHasher() before calling hashline APIs.");
}
const hasherP = xxhash().then((h) => {
    hasher = h;
    return hasher;
}).catch((err) => {
    console.error("xxhash-wasm initialization failed:", err);
    throw err;
});
export function initHasher() {
    return hasherP;
}
export function xxh32(input, seed = 0) {
    return getH().h32(input, seed) >>> 0;
}
export function contentChecksum(content) {
    return getH().h64ToString(content);
}
// --- alphabet (private to this seam) ---
export const HASH_LEN = 3;
export const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ALPH_SAFE = ALPH.replace(/-/g, "\\-");
export const ALPH_RE = new RegExp(`^[${ALPH_SAFE}]+$`);
export const HASH_CLASS = `[${ALPH_SAFE}]{${HASH_LEN}}`;
export const HASH_RE = new RegExp(`^${HASH_CLASS}$`);
// --- pure (allocation invariant) ---
export const ANCHOR_LEN = HASH_LEN;
export const HASH_SEP = "│";
export const HASH_SPACE = ALPH.length ** HASH_LEN;
export const MAX_HASH_LINES = HASH_SPACE;
export const HASH_PROBE_STRIDE = ALPH.length ** 2 + ALPH.length + 1;
function idxToHash(idx) {
    let out = "";
    for (let j = 0; j < HASH_LEN; j++) {
        out = ALPH[idx % ALPH.length] + out;
        idx = Math.floor(idx / ALPH.length);
    }
    return out;
}
const hashCache = new Map();
function hashAt(idx) {
    let hash = hashCache.get(idx);
    if (hash === undefined) {
        hash = idxToHash(idx);
        hashCache.set(idx, hash);
    }
    return hash;
}
export const HL_PREFIX_PLUS_RE = new RegExp(`^\\+${HASH_CLASS}│`);
export const HL_PREFIX_MINUS_RE = new RegExp(`^-(?:${HASH_CLASS}│| {${ANCHOR_LEN}}│)`);
export const HL_BARE_PREFIX_RE = new RegExp(`^\\s*(${HASH_CLASS})│`);
export const CANON_VERSION = 2;
const CANON_RE = /[ \t\r\n]+/g;
export function canon(line) {
    return line.replace(CANON_RE, "");
}
function getCanon(cache, line) {
    let v = cache.get(line);
    if (v !== undefined)
        return v;
    v = canon(line);
    cache.set(line, v);
    return v;
}
const BITSET_WORDS = Math.ceil(HASH_SPACE / 32);
function getBit(bits, idx) {
    return (bits[idx >>> 5] >>> (idx & 31) & 1) !== 0;
}
function setBit(bits, idx) {
    bits[idx >>> 5] |= 1 << (idx & 31);
}
function nextZeroBit(bits, start) {
    const totalBits = HASH_SPACE;
    let idx = start % totalBits;
    for (let i = 0; i < totalBits; i++) {
        if (!getBit(bits, idx))
            return idx;
        idx += HASH_PROBE_STRIDE;
        if (idx >= totalBits)
            idx -= totalBits;
    }
    throw new Error(`[E_FILE_TOO_LARGE] Cannot allocate a unique hash anchor: the file exceeds the ${HASH_SPACE}-line limit for ${HASH_LEN}-char hashline anchors.`);
}
function assignHash(used, baseIdx, hint) {
    if (!getBit(used, baseIdx)) {
        setBit(used, baseIdx);
        hint.value = baseIdx + HASH_PROBE_STRIDE;
        return hashAt(baseIdx);
    }
    const nextIdx = nextZeroBit(used, hint.value);
    setBit(used, nextIdx);
    hint.value = nextIdx + HASH_PROBE_STRIDE;
    return hashAt(nextIdx);
}
export function lineHashesPure(content) {
    const lines = splitLines(content);
    const hashes = new Array(lines.length);
    const used = new Uint32Array(BITSET_WORDS);
    const hint = { value: 0 };
    const canonCache = new Map();
    for (let i = 0; i < lines.length; i++) {
        const c = getCanon(canonCache, lines[i]);
        const baseIdx = (xxh32(c) >>> 14) % HASH_SPACE;
        hashes[i] = assignHash(used, baseIdx, hint);
    }
    return hashes;
}
function hashToIndex(hash) {
    let idx = 0;
    for (let j = 0; j < HASH_LEN; j++) {
        const charIdx = ALPH.indexOf(hash[j]);
        if (charIdx < 0)
            return -1;
        idx = idx * ALPH.length + charIdx;
    }
    return idx;
}
function nearestNew(candidates, target) {
    let lo = 0;
    let hi = candidates.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (candidates[mid] < target)
            lo = mid + 1;
        else
            hi = mid;
    }
    const left = lo - 1;
    const right = lo;
    if (left >= 0 && (right >= candidates.length || target - candidates[left] <= candidates[right] - target)) {
        return left;
    }
    return right < candidates.length ? right : -1;
}
export function mapStableHashes(oldContent, oldHashes, newContent, removedHashes) {
    const oldLines = splitLines(oldContent);
    const newLines = splitLines(newContent);
    const newHashes = new Array(newLines.length);
    const used = new Uint32Array(BITSET_WORDS);
    const hint = { value: 0 };
    const canonCache = new Map();
    const removed = removedHashes ?? new Set();
    const oldHashIndex = new Map();
    for (let i = 0; i < oldHashes.length; i++) {
        const hash = oldHashes[i];
        oldHashIndex.set(hash, i);
        const idx = hashToIndex(hash);
        if (idx >= 0)
            setBit(used, idx);
    }
    const removedIndexes = new Set();
    for (const hash of removed) {
        const idx = oldHashIndex.get(hash);
        if (idx !== undefined)
            removedIndexes.add(idx);
    }
    let spanStart = oldLines.length;
    let spanEnd = -1;
    for (const idx of removedIndexes) {
        if (idx < spanStart)
            spanStart = idx;
        if (idx > spanEnd)
            spanEnd = idx;
    }
    const spanLen = spanEnd >= spanStart ? spanEnd - spanStart + 1 : 0;
    const replacementLen = newLines.length - oldLines.length + spanLen;
    const shiftAfterSpan = spanEnd >= spanStart ? replacementLen - spanLen : 0;
    const survivors = [];
    const removedEntries = [];
    for (let i = 0; i < oldLines.length; i++) {
        const entry = { index: i, hash: oldHashes[i] };
        if (removedIndexes.has(i))
            removedEntries.push(entry);
        else
            survivors.push(entry);
    }
    const newByContent = new Map();
    for (let i = 0; i < newLines.length; i++) {
        const key = getCanon(canonCache, newLines[i]);
        const list = newByContent.get(key);
        if (list)
            list.push(i);
        else
            newByContent.set(key, [i]);
    }
    const markUsed = (hash) => {
        const idx = hashToIndex(hash);
        if (idx >= 0) {
            setBit(used, idx);
            if (idx + HASH_PROBE_STRIDE > hint.value)
                hint.value = idx + HASH_PROBE_STRIDE;
        }
    };
    for (const entry of survivors) {
        const candidates = newByContent.get(getCanon(canonCache, oldLines[entry.index]));
        if (!candidates || candidates.length === 0)
            continue;
        const target = entry.index > spanEnd ? entry.index + shiftAfterSpan : entry.index;
        const pos = nearestNew(candidates, target);
        if (pos < 0)
            continue;
        const newIdx = candidates.splice(pos, 1)[0];
        newHashes[newIdx] = entry.hash;
        markUsed(entry.hash);
    }
    const removedByContent = new Map();
    for (const entry of removedEntries) {
        const key = getCanon(canonCache, oldLines[entry.index]);
        let queue = removedByContent.get(key);
        if (!queue) {
            queue = { hashes: [], pos: 0 };
            removedByContent.set(key, queue);
        }
        queue.hashes.push(entry.hash);
    }
    for (let i = 0; i < newLines.length; i++) {
        if (newHashes[i])
            continue;
        const queue = removedByContent.get(getCanon(canonCache, newLines[i]));
        if (!queue || queue.pos >= queue.hashes.length)
            continue;
        newHashes[i] = queue.hashes[queue.pos];
        queue.pos += 1;
    }
    for (let i = 0; i < newLines.length; i++) {
        if (newHashes[i])
            continue;
        const c = getCanon(canonCache, newLines[i]);
        const baseIdx = (xxh32(c) >>> 14) % HASH_SPACE;
        newHashes[i] = assignHash(used, baseIdx, hint);
    }
    return newHashes;
}
// --- persistence wrapper (from hash.ts) ---

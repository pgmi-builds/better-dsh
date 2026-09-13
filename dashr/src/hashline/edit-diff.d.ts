import type { ServedRow } from "./hashline/served.js";
export type LineEnding = "\r\n" | "\n" | "\r";
export declare function detectEnding(content: string): LineEnding;
export declare function toLF(text: string): string;
export declare function restoreEndings(text: string, ending: LineEnding): string;
export declare function stripBOM(content: string): {
    bom: string;
    text: string;
};
export declare function genDiff(oldContent: string, newContent: string, contextLines?: number, newContentHashes?: string[], oldContentHashes?: string[]): {
    diff: string;
    firstChangedLine: number | undefined;
    servedRows: ServedRow[];
};

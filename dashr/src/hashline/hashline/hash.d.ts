import { type HashStore } from "../hash-store.js";
export interface HashSnapshotIO {
    get(path: string, content: string, deleteCorrupt: boolean): Promise<string[] | undefined>;
    upsert(path: string, checksum: string, lineCount: number, hashes: string[]): Promise<void>;
}
export declare function setDefaultHashSnapshotIO(io: HashSnapshotIO | undefined): void;
export declare function snapshotIOFor(store?: HashStore): HashSnapshotIO | undefined;
export declare function isValidHashList(value: unknown): value is string[];
export declare function lineHashes(content: string, path?: string, previous?: {
    content: string;
    hashes: string[];
    removedHashes?: Set<string>;
}, ioOrStore?: HashStore | HashSnapshotIO, persist?: boolean): Promise<string[]>;

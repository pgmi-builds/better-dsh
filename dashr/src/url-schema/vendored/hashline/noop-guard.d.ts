import { NOOP_LOOP_THRESHOLD } from "./constants.js";
export declare function noopPayloadKey(absolutePath: string, removeFrom: string, removeTo: string, replacementText: string): string;
export declare function trackNoopPayload(absolutePath: string, payload: string): number;
export declare function clearNoopLoop(absolutePath: string): void;
export { NOOP_LOOP_THRESHOLD };
export interface NoopPolicyInput {
    absolutePath: string;
    removeFrom: string;
    removeTo: string;
    replacementText: string;
    ref: string;
    batch: boolean;
    range: {
        startLine: number;
        endLine: number;
    };
    hashes: string[];
    lines: string[];
    sessionKey: string;
}
export type NoopPolicyOutcome = {
    action: "proceed";
    count: number;
} | {
    action: "warn";
    count: number;
    notice: string;
} | {
    action: "reject";
    count: number;
    message: string;
};
export declare function runNoopPolicySync(input: NoopPolicyInput, count: number): NoopPolicyOutcome;
export declare function runNoopPolicy(input: NoopPolicyInput): Promise<NoopPolicyOutcome>;

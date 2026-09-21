import { NOOP_LOOP_THRESHOLD } from "./constants.js";
const noopLoopTracker = new Map();
export function noopPayloadKey(absolutePath, removeFrom, removeTo, replacementText) {
    return JSON.stringify([absolutePath, removeFrom, removeTo, replacementText]);
}
export function trackNoopPayload(absolutePath, payload) {
    const existing = noopLoopTracker.get(absolutePath);
    const count = existing && existing.payload === payload ? existing.count + 1 : 1;
    noopLoopTracker.set(absolutePath, { payload, count });
    return count;
}
export function clearNoopLoop(absolutePath) {
    noopLoopTracker.delete(absolutePath);
}
export { NOOP_LOOP_THRESHOLD };
export function runNoopPolicySync(input, count) {
    if (count >= NOOP_LOOP_THRESHOLD) {
        const message = input.batch
            ? `[E_NOOP_LOOP] ${input.ref}: identical edit (${input.removeFrom} → ${input.removeTo}) submitted ${count}×, no changes each time. Range already contains this text; resend will reject the batch.`
            : `[E_NOOP_LOOP] identical edit (${input.removeFrom} → ${input.removeTo} ${input.ref}) submitted ${count}×, no changes each time. Range already contains this text; resend will reject.`;
        return { action: "reject", count, message };
    }
    if (count === 2) {
        const notice = input.batch
            ? `[E_NOOP_LOOP] Notice: ${input.ref} — identical edit no-op'd twice; range already has this text. Resend will reject the batch.`
            : `[E_NOOP_LOOP] Notice: identical edit (${input.removeFrom} → ${input.removeTo} ${input.ref}) no-op'd twice; range already has this text. Resend will reject.`;
        return { action: "warn", count, notice };
    }
    return { action: "proceed", count };
}
export async function runNoopPolicy(input) {
    const payload = noopPayloadKey(input.absolutePath, input.removeFrom, input.removeTo, input.replacementText);
    const count = trackNoopPayload(input.absolutePath, payload);
    return runNoopPolicySync(input, count);
}

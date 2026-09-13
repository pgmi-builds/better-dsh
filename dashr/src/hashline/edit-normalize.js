import { isRec, normalizeFilePath } from "./utils.js";
export function normReq(input) {
    if (!isRec(input)) {
        return input;
    }
    const record = { ...input };
    normalizeFilePath(record);
    return record;
}

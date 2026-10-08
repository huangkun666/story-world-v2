// 原有设定抽取分块尺寸；主抽取与补抽地图共用，数值不变。
export const SETTING_CHUNK_CHAR = 30000;
export function normalizeExtractChunkChars(raw) {
    const n = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? n : SETTING_CHUNK_CHAR;
}

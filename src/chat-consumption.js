// 消息身份随同一次世界候选提交；不在宿主保存第二份正式世界。
export function validateMessageReference(ref) {
    if (ref == null) return null;
    const keys = ['chatId', 'messageId', 'version', 'fingerprint'];
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).length !== keys.length
        || !keys.every(k => typeof ref[k] === 'string' && ref[k])) throw new TypeError('消息身份无效');
    return ref;
}
export function sameMessageVersion(a, b) {
    return !!a && !!b && ['chatId','messageId','version','fingerprint'].every(k => a[k] === b[k]);
}
export function recordConsumption(next, { world, messageRef, result, priorEventIds = null }) {
    if (!messageRef) return;
    const records = world?.meta?.chatConsumption || [];
    if (records.some(r => sameMessageVersion(r, messageRef))) return;
    const oldIds = new Set(priorEventIds ?? (world?.events || []).map(e => e.id));
    const eventIds = (next.events || []).filter(e => !oldIds.has(e.id) && e.source?.type === 'dialogue').map(e => e.id);
    const changedFields = result?.dialogueStats?.changedFields ?? [];
    next.meta.chatConsumption = [...records, { ...messageRef, tick: next.meta.tick, eventIds,
        changedFields: changedFields.map(({ entityId, field }) => ({ entityId, field })) }];
}

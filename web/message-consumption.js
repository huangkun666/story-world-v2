// Message identity and history guards live here; no body-based deduplication.
export const MESSAGE_ID_KEY = 'story_world_v2_message_id';

export function chatScope(ctx) {
    return JSON.stringify([ctx?.chatId ?? ctx?.getCurrentChatId?.() ?? null, ctx?.characterId ?? null, ctx?.groupId ?? null]);
}

export function assistantMessage(message) {
    return !!message && !message.is_user && !message.is_system && !['user', 'system', 'tool'].includes(message.role);
}

export function latestAssistantText(ctx) {
    const last = Array.isArray(ctx?.chat) ? ctx.chat.at(-1) : null;
    return assistantMessage(last) && typeof last.mes === 'string' ? last.mes : '';
}

function fingerprint(text) {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 16777619);
        b = Math.imul(b, 33) ^ text.charCodeAt(i);
    }
    return `${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

function messageId(message, create = false) {
    const native = message?.message_id ?? message?.id;
    if ((typeof native === 'string' && native) || (typeof native === 'number' && Number.isFinite(native))) return `host:${native}`;
    if (!message?.extra?.[MESSAGE_ID_KEY] && create) {
        message.extra ??= {};
        message.extra[MESSAGE_ID_KEY] = globalThis.crypto?.randomUUID?.() ?? `sw2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return message?.extra?.[MESSAGE_ID_KEY] ? `extra:${message.extra[MESSAGE_ID_KEY]}` : null;
}

export function messageReference(ctx, message, { create = false } = {}) {
    const id = messageId(message, create);
    if (!id) return null;
    return { chatId: chatScope(ctx), messageId: id, version: String(message.swipe_id ?? message.swipeId ?? 0),
        fingerprint: fingerprint(typeof message.mes === 'string' ? message.mes : '') };
}

function sameVersion(a, b) {
    return a?.chatId === b?.chatId && a?.messageId === b?.messageId && a?.version === b?.version && a?.fingerprint === b?.fingerprint;
}

export function historyConflicts(ctx, world) {
    const records = world?.meta?.chatConsumption || [];
    const messages = new Map((Array.isArray(ctx?.chat) ? ctx.chat : []).map(m => [messageId(m), m]));
    return records.filter(r => r.chatId === chatScope(ctx)).flatMap(record => {
        const message = messages.get(record.messageId);
        const reason = !message ? 'deleted' : !assistantMessage(message) ? 'role-changed'
            : !sameVersion(record, messageReference(ctx, message)) ? 'version-changed' : null;
        return reason ? [{ ...record, reason, restoreBeforeTick: record.tick }] : [];
    });
}

/** Read-only recovery preview; missing original inputs are explicit, never guessed. */
export function previewConsumptionRecovery(ctx, world) {
    const conflicts = historyConflicts(ctx, world);
    if (!conflicts.length) return { required: false, conflicts: [], replay: [] };
    const firstTick = Math.min(...conflicts.map(c => c.tick));
    const messages = new Map((Array.isArray(ctx?.chat) ? ctx.chat : []).map(m => [messageId(m), m]));
    const records = (world?.meta?.chatConsumption || []).filter(r => r.chatId === chatScope(ctx) && r.tick >= firstTick);
    const replay = records.map(record => {
        const message = messages.get(record.messageId);
        const current = message ? messageReference(ctx, message) : null;
        const oldSwipe = message?.swipes?.[Number(record.version)];
        const original = current && sameVersion(record, current) ? message.mes
            : typeof oldSwipe === 'string' && fingerprint(oldSwipe) === record.fingerprint ? oldSwipe : null;
        return { record: structuredClone(record), current, originalDialogue: original, missingOriginal: original === null };
    });
    return { required: true, restoreBeforeTick: firstTick, conflicts: structuredClone(conflicts), replay,
        note: '仅预览输入副本；原文缺失或世界单独推进的轮次须人工核对，未自动重放或替换世界。' };
}

export function recordConsumption(next, { world, messageRef, result }) {
    if (!messageRef) return;
    const records = world?.meta?.chatConsumption || [];
    if (records.some(r => sameVersion(r, messageRef))) return;
    const oldIds = new Set((world?.events || []).map(e => e.id));
    const eventIds = (next.events || []).filter(e => !oldIds.has(e.id) && e.source?.type === 'dialogue').map(e => e.id);
    const changedFields = result?.dialogueStats?.changedFields ?? [];
    next.meta.chatConsumption = [...records, { ...messageRef, tick: next.meta.tick, eventIds,
        changedFields: changedFields.map(({ entityId, field }) => ({ entityId, field })) }];
}

export function createMessageConsumptionHub({ getCtx, getWorld, getQueue, onStatus = () => {} }) {
    let lastReadout = null;
    function historyGuard() {
        const conflicts = historyConflicts(getCtx(), getWorld());
        if (conflicts.length) throw new Error(`已入账消息发生编辑、删除或版本切换；请先从第 ${Math.min(...conflicts.map(c => c.tick))} 轮之前的快照恢复，再核对重算（原事实保留）`);
    }
    return {
        readout: () => lastReadout,
        onOutcome(outcome) { lastReadout = { ...lastReadout, save: outcome }; },
        advance({ manual = false } = {}) {
            const queue = getQueue();
            if (!queue) return { ok: false, skipped: 'no-queue' };
            if (queue.busy) return queue.advance();
            try {
                historyGuard();
                const ctx = getCtx(), world = getWorld();
                const message = Array.isArray(ctx?.chat) ? ctx.chat.at(-1) : null;
                const text = latestAssistantText(ctx);
                const ref = text ? messageReference(ctx, message, { create: true }) : null;
                const consumed = ref && (world?.meta?.chatConsumption || []).some(r => sameVersion(r, ref));
                const dialogue = consumed ? '' : text;
                lastReadout = { message: ref, consumed: !!consumed, manual, dialogueChars: dialogue.length, mode: dialogue ? 'message' : 'world-only' };
                if (!manual && !dialogue) return { ok: false, skipped: consumed ? 'same-message' : 'no-assistant-message' };
                return queue.advance(dialogue, { messageRef: dialogue ? ref : null, saveMessages: !!dialogue && !!ref?.messageId.startsWith('extra:'),
                    validate() {
                        historyGuard();
                        if (ref && !consumed) {
                            const now = (getCtx()?.chat || []).find(m => messageId(m) === ref.messageId);
                            if (!assistantMessage(now) || !sameVersion(ref, messageReference(getCtx(), now))) throw new Error('待处理助手消息已编辑、删除或切换版本，结果已作废');
                        }
                    } }).catch(err => ({ ok: false, error: String(err?.message || err) }));
            } catch (err) {
                const error = String(err?.message || err);
                lastReadout = { mode: 'history-conflict', conflicts: historyConflicts(getCtx(), getWorld()), error };
                onStatus(error);
                return { ok: false, skipped: 'history-conflict', error };
            }
        },
    };
}

// Shared identity only; creation validates it before registering a task.
export function chatIdentity(ctx) {
    const direct = ctx?.chatId;
    const raw = typeof direct === 'string' && direct.trim() ? direct
        : typeof ctx?.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null;
    return { chatId: typeof raw === 'string' && raw.trim() ? raw.trim() : null,
        characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null };
}
export function identityScope({chatId, characterId, groupId}) {
    return JSON.stringify([chatId, characterId, groupId]);
}

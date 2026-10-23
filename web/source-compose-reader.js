// 宿主来源合订编排：异步前后核对当前来源，未读全时不给生成交付正文。
import { composeInitSource } from '../src/init-source.js';
import { macroNamesFromCtx } from '../src/macros.js';
import {
    captureSourceOwner, sourceOwnerSuperseded, sourceOwnerLoadingAdvanced,
    ensureCharacterLoaded, pickCharacter, collectWorldInfoEntries,
} from './book-source.js';

const INCOMPLETE_REASON = '挂载世界书未完整读到，或角色卡还没加载完，请重新读取';
const SWITCHED_REASON = '聊天或来源已切换，请重新读取';

function sourceDiagnostics(ctx, character, read = {}, composed = {}) {
    return {
        identity: { characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null, chatId: ctx?.chatId ?? null },
        character: { name: character?.name ?? null, world: character?.world ?? null,
            hasBook: Boolean(character?.character_book || character?.data?.character_book) },
        worldSources: read.worldSources ?? null,
        incomplete: read.incomplete === true || character?.shallow === true,
        excluded: composed.excluded || [], warnings: composed.warnings || [],
    };
}

function failed(reason, { incomplete = false, sourceDiag = null } = {}) {
    // 控制台只报类别和数量；正文、宿主异常原话及配置值不进日志。
    try {
        console.warn('[story-world-v2] 初始化设定源失败诊断', {
            status: incomplete ? 'incomplete' : 'source-switched',
            worldSources: Array.isArray(sourceDiag?.worldSources) ? sourceDiag.worldSources.length : 0,
        });
    } catch {}
    return { ok: false, reason, incomplete, text: '', sourceItems: [],
        effectiveEntries: [], worldInfoEntries: [], sourceDiag };
}

export async function composeFromHostSource({ getCtx, getSelection = () => ({ mode: 'default' }), completeSelectedSources = false }) {
    let ctx = null, character = null, read = {}, sourceDiag = null;
    try {
        ctx = getCtx();
        const before = captureSourceOwner(ctx);
        await ensureCharacterLoaded(ctx);
        const live = getCtx();
        if (sourceOwnerSuperseded(before, live) && !sourceOwnerLoadingAdvanced(before, live)) {
            return failed(SWITCHED_REASON);
        }
        // 宿主可能交付新的上下文外壳；全卡和挂载必须从这份当前上下文重取。
        ctx = live;
        character = pickCharacter(ctx);
        const owner = captureSourceOwner(ctx);
        read = await collectWorldInfoEntries(ctx, character);
        sourceDiag = sourceDiagnostics(ctx, character, read);
        if (sourceOwnerSuperseded(owner, getCtx())) return failed(SWITCHED_REASON, { sourceDiag });
        const incomplete = read.incomplete === true || character?.shallow === true;
        if (incomplete) return failed(INCOMPLETE_REASON, { incomplete: true, sourceDiag });

        const res = composeInitSource({ character, worldInfoEntries: read.entries, worldSources: read.worldSources,
            macroNames: macroNamesFromCtx(() => ctx, character), selection: getSelection(ctx), completeSelectedSources });
        sourceDiag = sourceDiagnostics(ctx, character, read, res);
        if (sourceOwnerSuperseded(owner, getCtx())) return failed(SWITCHED_REASON, { sourceDiag });
        res.sourceDiag = sourceDiag;
        res.incomplete = false;
        res.worldInfoEntries = res.effectiveEntries;
        if (!res.ok) {
            try {
                console.warn('[story-world-v2] 初始化设定源失败诊断', {
                    status: 'unavailable',
                    worldSources: Array.isArray(read.worldSources) ? read.worldSources.length : 0,
                });
            } catch {}
        }
        return res;
    } catch {
        if (!sourceDiag) {
            try { sourceDiag = sourceDiagnostics(ctx, character, { ...read, incomplete: true }); } catch {}
        }
        return failed(INCOMPLETE_REASON, { incomplete: true, sourceDiag });
    }
}

import { collectAbstractSources } from '../src/abstract-input.js';
import { normalizeAbstractSelection } from '../src/abstract-selection.js';
import { creationScope, CREATION_SELECTION_KEY, creationError, freezeCreationValue } from '../src/creation-task.js';
const copyCreation = value => structuredClone(value);
const selectionIdentity = value => JSON.stringify(value);
export function creationSelectionFor(ctx) {
    const value = ctx?.extensionSettings?.story_world_v2?.[CREATION_SELECTION_KEY]?.[creationScope(ctx)];
    if (value == null) return { mode: 'default', selectedIds: [], version: 2, reads: {} };
    if (value.version !== 2 || !['default', 'custom'].includes(value.mode)) throw creationError('invalid-selection', '当前新建流程的选源设置无效，请重新选择');
    return normalizeAbstractSelection(value);
}
function creationContext(ctx) {
    creationScope(ctx);
    const normalized = Object.create(ctx);
    Object.defineProperty(normalized, 'chatId', { value: JSON.parse(creationScope(ctx))[0], enumerable: true });
    return normalized;
}
function assertSourceSignal(signal) { if (signal?.aborted) throw Object.assign(new Error('来源读取已停止'), { name: 'AbortError' }); }
function sourceWait(promise, signal) {
    if (!signal) return promise;
    assertSourceSignal(signal);
    return new Promise((resolve, reject) => {
        const abort = () => { cleanup(); reject(Object.assign(new Error('来源读取已停止'), { name: 'AbortError' })); };
        const cleanup = () => signal.removeEventListener('abort', abort);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
        if (signal.aborted) abort();
    });
}
/** One current-source read shared by the picker and the new-world command; no cache or migration. */
export async function readCreationSourceFrame({ getCtx, getSelection = creationSelectionFor, signal = null } = {}) {
    let ctx = creationContext(getCtx()), scope = creationScope(ctx);
    const before = captureSourceOwner(ctx), initialSelection = copyCreation(getSelection(ctx));
    const namesBefore = macroNamesFromCtx(() => ctx, pickCharacter(ctx));
    await sourceWait(ensureCharacterLoaded(ctx), signal);
    let live = creationContext(getCtx());
    if (creationScope(live) !== scope || sourceOwnerSuperseded(before, live) && !sourceOwnerLoadingAdvanced(before, live)) throw creationError('stale-source', SWITCHED_REASON);
    if (selectionIdentity(initialSelection) !== selectionIdentity(getSelection(live))) throw creationError('stale-source', '勾选来源已变化，请重新读取');
    ctx = live;
    const character = pickCharacter(ctx), owner = captureSourceOwner(ctx), macros = macroNamesFromCtx(() => ctx, character);
    // Loading the same shallow card may fill its name; other macro changes invalidate input.
    if (!before.shallow && selectionIdentity(namesBefore) !== selectionIdentity(macros)) throw creationError('stale-source', SWITCHED_REASON);
    const selection = freezeCreationValue(copyCreation(getSelection(ctx)));
    const read = await sourceWait(collectWorldInfoEntries(ctx, character), signal);
    assertSourceSignal(signal);
    const ownerCurrent = () => {
        try {
            const now = creationContext(getCtx());
            return !signal?.aborted && creationScope(now) === scope && !sourceOwnerSuperseded(owner, now)
                && selectionIdentity(macros) === selectionIdentity(macroNamesFromCtx(() => now, pickCharacter(now)));
        } catch { return false; }
    };
    const current = () => ownerCurrent() && selectionIdentity(selection) === selectionIdentity(getSelection(creationContext(getCtx())));
    if (!current()) throw creationError('stale-source', SWITCHED_REASON);
    const pinnedCharacter = copyCreation(character), entries = copyCreation(read.entries ?? []), worldSources = copyCreation(read.worldSources);
    const sources = collectAbstractSources({ character: pinnedCharacter, worldInfoEntries: entries, worldSources });
    const cardPending = Boolean(!character && (ctx.characterId != null || ctx.groupId != null)) || character?.shallow === true;
    const incomplete = read.incomplete === true || cardPending;
    const compose = picked => composeInitSource({ character: copyCreation(pinnedCharacter), worldInfoEntries: copyCreation(entries),
        worldSources: copyCreation(worldSources), macroNames: { ...macros }, selection: copyCreation(picked), completeSelectedSources: true });
    return { scope, owner: { key: scope + '\u0000' + owner.key, scope, isCurrent: ownerCurrent }, sources, worldSources,
        incomplete, cardPending, selection, character: pinnedCharacter, compose, isCurrent: current, macros };
}
export async function captureCreationSource(options) {
    const frame = await readCreationSourceFrame(options);
    if (frame.incomplete) return { ok: false, code: 'incomplete-source', reason: INCOMPLETE_REASON };
    const composed = frame.compose(frame.selection);
    const allowed = composed.allowedBlocks ?? [], used = new Set(allowed.map(block => block.sourceId));
    const originals = (composed.sourceItems ?? []).filter(item => used.has(item.id)).map(item => ({
        source_id: item.id, title: item.title, kind: item.kind, raw_text: item.rawText,
        read_mode: item.readMode, status: item.status, effective_chars: item.effectiveChars,
    }));
    const effective = (composed.sourceItems ?? []).filter(item => used.has(item.id) && item.status === 'effective').reduce((sum, item) => sum + Array.from(String(item.content ?? '').trim()).length, 0);
    if (!composed.ok || !effective || !allowed.length) return { ok: false, code: 'empty-source', reason: composed.reason || '当前勾选来源没有有效正文，未建立任务' };
    const snapshot = freezeCreationValue(copyCreation({ protocol: 'creation-source-v1', scope: frame.scope,
        world_name: composed.worldName || '新世界', selection: frame.selection, macros: frame.macros,
        world_sources: frame.worldSources, originals, allowed_blocks: allowed, effective_chars: effective }));
    return { ok: true, snapshot, isCurrent: frame.isCurrent };
}

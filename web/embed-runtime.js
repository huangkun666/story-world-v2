import { harnessOf, emptyStore } from '../src/vector-store.js';
import { stepEmbed, recallForPack } from '../src/embed-orchestration.js';
import { chronicleDelta, timelineOf, recallQueryOf, movingIdsOf, RECALL_TOP_DEFAULT } from '../src/ledger-vector.js';
import { RECENT_WINDOW_TURNS } from '../src/limits.js';
import { activeHistoryRows, historyStamp, matchingHistoryStore, completeHistoryThrough } from '../src/vector-history.js';

export function createEmbedRuntime({ indexStore, client = null, clientFactory = null, windowTurns = null, signature = {}, onStatus = null, getScope = () => '' } = {}) {
    let cached = null, loaded = false, writes = 0, generation = 0, busy = false;
    let lastResult = null, lastRecall = null, writeQueue = Promise.resolve(), loading = null;
    let scopeId = String(getScope());
    const signatureNow = () => typeof signature === 'function' ? signature() : signature;
    const clientNow = () => {
        try { return typeof client === 'function' ? client() : clientFactory ? clientFactory() : client; }
        catch (err) { onStatus?.('注意：造嵌入客户端失败：' + err.message); return null; }
    };
    const windowNow = () => Number(typeof windowTurns === 'function' ? windowTurns() : windowTurns) || RECENT_WINDOW_TURNS;
    const floorOf = (world, floor, wt = null) => floor != null && Number.isFinite(Number(floor)) ? Number(floor)
        : Math.max(0, Number(world?.meta?.tick || 0) - (Number(wt) > 0 ? Number(wt) : windowNow()) + 1);
    function syncScope() {
        if (scopeId !== String(getScope())) { scopeId = String(getScope()); generation++; cached = null; loaded = false; loading = null; lastResult = null; }
    }
    async function readIndex() {
        syncScope();
        if (!loaded) {
            if (!loading) {
                const epoch = generation, writeCount = writes;
                const job = (async () => {
                    try { const raw = await indexStore?.load?.(); if (epoch === generation && writeCount === writes) { cached = raw || null; loaded = true; } }
                    catch (err) { if (epoch === generation) onStatus?.('注意：读向量索引失败：' + err.message); }
                })();
                loading = job; job.finally(() => { if (loading === job) loading = null; });
            }
            await loading;
        }
        return cached;
    }
    function rowsOf(world, volumes, scope, timeMarkOf = null) {
        const hasChronicle = (world?.chronicle?.length || 0) + (volumes || []).reduce((n, v) => n + (v.rows?.length || 0), 0);
        return activeHistoryRows(hasChronicle ? world : { ...world, chronicle: timelineOf(world, { timeMarkOf, world }) }, volumes, scope);
    }
    async function commit(next, epoch) {
        const task = writeQueue.then(async () => {
            if (epoch !== generation || scopeId !== String(getScope())) return false;
            await indexStore?.save?.(next);
            if (epoch !== generation) return false;
            cached = next; loaded = true; writes++; return true;
        });
        writeQueue = task.catch(() => {});
        return task;
    }
    const decoded = raw => harnessOf(signatureNow(), { stored: raw ? JSON.stringify(raw) : null }).store();
    const api = {
        writes: () => writes,
        invalidate(reload = false) { generation++; lastRecall = null; lastResult = null; loading = null; if (reload) { cached = null; loaded = false; } },
        async captureHistory(world, volumes = []) {
            return { version: 1, known: Object.fromEntries(rowsOf(world, volumes, world?.meta?.memoryHistory).map(r => [String(r.id), historyStamp(r)])) };
        },
        async restoreHistory(world, history = null) {
            api.invalidate();
            const old = decoded(await readIndex()), epoch = generation;
            const scope = { known: { ...(history?.known || {}) }, restoredAt: Number(world?.meta?.tick) || 0 };
            const rows = rowsOf(world, [], scope);
            for (const row of rows) scope.known[String(row.id)] = historyStamp(row);
            const next = { ...matchingHistoryStore(old, rows, scope.known), historyScope: scope, completedThrough: 0 };
            cached = next; loaded = true;
            try { await commit(next, epoch); }
            catch (err) { onStatus?.('注意：快照记忆隔离未落盘：' + err.message); }
            const verifiedArchive = Boolean(history && history.verified !== false);
            if (!verifiedArchive) onStatus?.('注意：旧快照未记录历史校验，已隔离无法确认的旧卷');
            return { isolated: true, verifiedArchive, count: next.ids.length };
        },
        async stepForTick({ world, floor = null, volumes = null, timeMarkOf = null, maxItemsPerTurn = undefined, windowTurns: wt = null } = {}) {
            if (busy) return { embedded: 0, skipped: 'busy', pending: lastResult?.pending || 0 };
            const selectedClient = clientNow();
            if (!selectedClient) return { embedded: 0, pending: 0, skipped: 'no-client' };
            busy = true;
            try {
                syncScope(); const epoch = generation, raw = await readIndex();
                if (epoch !== generation || !clientNow()) return { embedded: 0, skipped: 'cancelled' };
                const old = decoded(raw), scope = old.historyScope;
                const rows = rowsOf(world, volumes, scope, timeMarkOf), f = floorOf(world, floor, wt);
                const clean = matchingHistoryStore(old, rows);
                const harness = harnessOf(signatureNow(), { stored: JSON.stringify(clean) });
                const r = await stepEmbed({ ssot: world, rows, harness, client: selectedClient, floor: f, timeMarkOf, maxItemsPerTurn });
                if (epoch !== generation || !clientNow()) return { embedded: 0, skipped: 'cancelled', pending: r.pending };
                const next = harness.store();
                next.sourceById = Object.fromEntries(rows.filter(row => next.ids.includes(String(row.id))).map(row => [String(row.id), historyStamp(row)]));
                next.completedThrough = completeHistoryThrough(rows, next, f);
                if (scope) next.historyScope = { ...scope, known: { ...scope.known, ...Object.fromEntries((world?.chronicle || []).map(row => [String(row.id), historyStamp(row)])) } };
                if ((next.ids.length || old.ids.length || scope) && JSON.stringify(next) !== JSON.stringify(old)) {
                    try { if (!await commit(next, epoch)) return { embedded: 0, skipped: 'cancelled' }; }
                    catch (err) { onStatus?.('注意：向量索引写不进去：' + err.message); return lastResult = { ...r, embedded: 0, note: '写不进去：' + err.message, pending: r.pending + r.embedded }; }
                }
                return lastResult = { ...r, completedThrough: next.completedThrough, targetThrough: Math.max(0, f - 1), currentTick: world?.meta?.tick };
            } catch (err) { return lastResult = { embedded: 0, pending: 0, note: String(err.message), failed: 1, blockedWorld: false }; }
            finally { busy = false; }
        },
        async recallForTick({ ssot = null, tickNow = null, floor = null, volumes = null, top = undefined, minScore = undefined, queryText = null } = {}) {
            try {
                const selectedClient = clientNow(); if (!selectedClient?.embed) return null;
                syncScope(); const epoch = generation, raw = await readIndex();
                if (epoch !== generation || scopeId !== String(getScope()) || !clientNow()) return null;
                const old = decoded(raw), rows = rowsOf(ssot, volumes, old.historyScope);
                const store = matchingHistoryStore(old, rows);
                if (!store.ids.length) return null;
                const query = queryText != null ? String(queryText) : recallQueryOf(ssot, { tickNow });
                if (!query.trim()) return null;
                const vectors = await selectedClient.embed([query]);
                if (epoch !== generation || scopeId !== String(getScope()) || !clientNow()) return null;
                const vector = vectors?.length === 1 && Array.isArray(vectors[0]) && vectors[0].length ? vectors[0] : null;
                if (!vector) { lastRecall = { reason: 'bad-vector', returned: 0 }; return null; }
                const r = recallForPack(ssot, store, { qVector: vector, floor: floorOf(ssot, floor), tickNow, rows,
                    top: top ?? RECALL_TOP_DEFAULT, minScore: minScore ?? 0, rippleIds: movingIdsOf(ssot) });
                lastRecall = { ...r.report }; return r;
            } catch (err) { lastRecall = { reason: 'error', note: String(err.message), returned: 0 }; onStatus?.('注意：向量检索失败：' + err.message); return null; }
        },
        lastStats: () => ({ ...(lastResult || {}), completedThrough: cached?.completedThrough || 0, count: cached?.ids?.length || 0, dims: cached?.vecs?.[0]?.length || cached?.dims, recall: lastRecall }),
        async stats({ enabled = true, world = null, floor = null, volumes = null, timeMarkOf = null } = {}) {
            const store = decoded(await readIndex()), rows = rowsOf(world, volumes, store.historyScope, timeMarkOf);
            const clean = matchingHistoryStore(store, rows), f = floorOf(world, floor);
            return { enabled, count: world ? clean.ids.length : store.ids.length, model: store.model, dims: store.dims, pending: world ? chronicleDelta(world, { rows, embedded: clean.ids, floor: f }).pending : 0,
                completedThrough: completeHistoryThrough(rows, clean, f), targetThrough: Math.max(0, f - 1),
                failed: lastResult?.note ? 1 : 0, failureNote: lastResult?.note || null, lastEmbedded: lastResult?.embedded || 0, recall: lastRecall };
        },
        async reset() { api.invalidate(); cached = emptyStore(signatureNow()); loaded = true; await writeQueue; try { await indexStore?.drop?.(); } catch (err) { onStatus?.('注意：清索引失败：' + err.message); } },
    };
    return api;
}

// Production provenance is independent from causal provenance. Never follow source.ref.
const PRODUCERS = new Set(['chat', 'world', 'setting', 'unknown']);
const TYPES = new Set(['result', 'state', 'maintenance']);
const MAINTENANCE_ID = /^ch_\d+_(?:evc|evc2|evs|cyc|can|canS|adv|fin|ful|ret|pumpC)_/;
const WORLD_ID = /^ch_\d+_(?:ev|ag|ent|fate|rev|rel|relc|pump)_/;
const CHAT_ID = /^ch_\d+_dlg_\d+$/;

function sourceProducer(row) {
    if (PRODUCERS.has(row?.producer)) return row.producer;
    const source = row?.source?.type;
    if (source === 'dialogue') return 'chat';
    if (source === 'seed') return 'setting';
    if (['plot', 'ripple', 'state'].includes(source)) return 'world';
    return null;
}

function recordLookups(ssot, { volumes = null, rows = null } = {}) {
    const records = new Map();
    const events = new Map();
    for (const m of ssot?.milestones || []) for (const e of m?.rows || []) if (e?.id) events.set(String(e.id), e);
    for (const e of ssot?.events || []) if (e?.id) events.set(String(e.id), e);
    for (const v of volumes || []) for (const r of v?.rows || []) if (r?.id) records.set(String(r.id), r);
    for (const r of ssot?.chronicle || []) if (r?.id) records.set(String(r.id), r);
    for (const r of rows || []) if (r?.id) records.set(String(r.id), r);
    return { records, events };
}

function classifierOf({ records, events }) {
    return (input) => {
        const id = String(input?.id ?? '');
        const row = { ...(records.get(id) || events.get(id) || {}), ...input };
        const maintenance = MAINTENANCE_ID.test(id);
        const linked = events.get(String(row.eventRef || (maintenance ? row.chainRef : '') || ''));
        const producer = sourceProducer(row) || sourceProducer(linked)
            || (CHAT_ID.test(id) ? 'chat' : (maintenance || WORLD_ID.test(id) ? 'world' : 'unknown'));
        // kind=state describes a chronicle display class, not a current-state record.
        const recordType = TYPES.has(row.recordType) ? row.recordType
            : (maintenance ? 'maintenance' : (TYPES.has(linked?.recordType) ? linked.recordType : 'result'));
        return { producer, recordType };
    };
}

/** Build lookup tables once per batch; rows may be vector IDs with no body attached. */
export function createRecordClassifier(ssot, opts = {}) {
    return classifierOf(recordLookups(ssot, opts));
}

// Project only the engine's explicit causal clause, verified against event IDs.
// The world consequence and stored history remain intact; unrelated prose is untouched.
function projectChatCause(input, { records, events }) {
    const stored = records.get(String(input?.id ?? '')) || input;
    const event = events.get(String(stored?.eventRef || input?.sourceRef || ''));
    if (event?.source?.type !== 'ripple') return input;
    const cause = events.get(String(event.source.ref || ''));
    if (sourceProducer(cause) !== 'chat' || !cause.title || !event.title) return input;
    const clause = `事件「${event.title}」——沿「${cause.title}」而来`;
    if (!String(stored?.text || '').includes(clause)) return input;
    const replacement = `事件「${event.title}」——沿事件 ${cause.id} 而来`;
    let projected = input;
    for (const key of ['text', 'title', 'line']) {
        if (typeof input?.[key] !== 'string' || !input[key].includes(clause)) continue;
        if (projected === input) projected = { ...input };
        projected[key] = input[key].replace(clause, replacement);
    }
    return projected;
}

export function classifyRecord(ssot, row, opts = {}) {
    return createRecordClassifier(ssot, opts)(row);
}

function decision(classification) {
    const { producer, recordType } = classification;
    const reason = recordType === 'maintenance' ? 'maintenance'
        : producer === 'chat' && recordType === 'result' ? 'chat-result' : '';
    return { ...classification, include: !reason, reason };
}

export function chatRecallDecision(ssot, row, opts = {}) {
    return decision(classifyRecord(ssot, row, opts));
}

/** Unknown sources remain eligible and are reported honestly, without title inference. */
export function filterChatRecords(ssot, rows, opts = {}) {
    const lookups = recordLookups(ssot, opts);
    const classify = classifierOf(lookups);
    const items = [];
    const report = { selectedIds: [], filtered: [], unknownSources: 0, counts: { chat: 0, world: 0, setting: 0, unknown: 0 }, records: [] };
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
        const d = decision(classify(row));
        const id = String(row?.id ?? '');
        if (!seen.has(id || row)) {
            seen.add(id || row);
            report.counts[d.producer]++;
            report.records.push({ id, producer: d.producer, recordType: d.recordType });
            if (d.producer === 'unknown') report.unknownSources++;
            if (!d.include) report.filtered.push({ id, reason: d.reason });
        }
        if (d.include) { items.push(projectChatCause(row, lookups)); report.selectedIds.push(id); }
    }
    return { items, report };
}

// story-world-v2/demo/inspect-lookup.js
// 第二十五棒 d 实机复验专用：只读打印「查书补全」落账证据（meta.entityFields）。
//
// 为什么单独写一个：demo/inspect-chat-world.js 只打印摘要（指纹/五件套/实体清单），
//   而复验判据全在 `meta.entityFields` 里 —— 那个脚本看不见，肉眼在面板上也数不清 623 条。
//
// 纯只读（readFileSync），不写聊天文件、不改任何代码。
// 用法：
//   node demo/inspect-lookup.js                      # 扫默认 chats 目录，对每个非空热账出证据
//   node demo/inspect-lookup.js <聊天jsonl路径>       # 只查一个聊天
//   node demo/inspect-lookup.js <路径> 吞天妖王 姬元真  # 额外点名核对若干实体
//
// 【关键判据】字段四种状态别混（这是本棒治过的假 bug 的根）：
//   ok      = 查到值并落账           → 面板该显示值
//   absent  = 真读到书 + 书里确无该条目 → 「书未明述」（合法终态）
//   pending = 读过但模型没回 / 回文被丢弃 → 可重试（不是终态！）
//   （无记录）= 这栏从来没查过         → 查书链路根本没跑（2026-09-11 前的真 bug 形态）
//   「pending 堆积 + ok=0」= 取书或回文对齐坏了；「全无记录」= 任务没启动或被吞。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CHATS = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/chats';
const DEFAULT_GROUP_CHATS = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/group-chats';
const FIELDS = ['实力', '位置'];

function readHot(file) {
    let raw;
    try { raw = readFileSync(file, 'utf8'); } catch (e) { return { err: `READ FAIL: ${e.message}` }; }
    const nl = raw.indexOf('\n');
    const firstLine = nl < 0 ? raw : raw.slice(0, nl);
    let header;
    try { header = JSON.parse(firstLine); } catch (e) { return { err: `PARSE FAIL: ${e.message}` }; }
    const box = header?.chat_metadata?.story_world_v2;
    if (!box || typeof box !== 'object') return { err: 'no story_world_v2 in chat_metadata' };
    const w = box.world;                       // 实测结构是 story_world_v2.world（多一层），不是裸 SSOT
    if (!w || typeof w !== 'object') return { err: 'story_world_v2.world missing/empty' };
    if (w.meta === undefined && w.entities === undefined) return { err: 'empty stub (legacy {} from K35)' };
    return { world: w, headerLen: firstLine.length };
}

function report(file, extraNames) {
    const got = readHot(file);
    if (got.err) { console.log(`[SKIP] ${file}\n       ${got.err}`); return false; }
    const w = got.world;
    const lk = w.meta?.entityFields || {};
    const ids = Object.keys(lk);

    console.log('='.repeat(72));
    console.log(`FILE      : ${file}`);
    console.log(`tick      : ${w.meta?.tick}`);
    console.log(`world     : ${w.context?.world}`);
    console.log(`entities  : ${w.entities?.length}`);
    console.log(`positions : ${w.context?.positions?.length} (position whitelist)`);
    console.log(`entityFields records: ${ids.length} / ${w.entities?.length ?? 0}`);
    console.log(`entityLookup.circuit : ${JSON.stringify(w.meta?.entityLookup ?? null)}`);

    if (!ids.length) {
        console.log('--> VERDICT: NO lookup ledger at all.');
        console.log('    If you clicked the batch button, this means the task never wrote back');
        console.log('    (or the page was reloaded before it ran) -- NOT "book says nothing".');
        return true;
    }

    // 逐字段状态统计（四态）
    const tally = {};
    for (const f of FIELDS) tally[f] = { ok: 0, absent: 0, pending: 0, norec: 0 };
    const others = new Set();
    let locInSet = 0, locNormMiss = 0, pushed = 0, quoted = 0;
    for (const id of ids) {
        const rec = lk[id] || {};
        for (const f of Object.keys(rec.fields || {})) if (!FIELDS.includes(f)) others.add(f);
        for (const f of FIELDS) {
            const has = rec.fields?.[f]?.value;
            const st = rec.attempts?.[f]?.state;
            if (has) tally[f].ok += 1;
            else if (st === 'absent') tally[f].absent += 1;
            else if (st === 'pending') tally[f].pending += 1;
            else tally[f].norec += 1;
        }
        const lf = rec.fields?.['位置'];
        if (lf?.value) { if (lf['位置in集']) locInSet += 1; else locNormMiss += 1; }
        if (rec['位置来源'] === '结构推导') pushed += 1;
        if (rec['位置来源'] === '书里原话') quoted += 1;
    }
    console.log('field-state tally (ok / absent / pending / no-record):');
    for (const f of FIELDS) {
        const t = tally[f];
        console.log(`  ${f}: ok=${t.ok}  absent=${t.absent}  pending=${t.pending}  norec=${t.norec}`);
    }
    if (others.size) console.log(`  other fields seen: ${[...others].join(', ')}`);
    console.log(`location provenance: quoted(book)=${quoted}  derived(推)=${pushed}`);
    console.log(`location normalized into position set: ${locInSet}  (out-of-set, ledger-only): ${locNormMiss}`);

    // 点名录：把这 5 条（或全部有记录的）逐条列出来，看是"设定关键词"还是"真角色"
    console.log('--- lookup ledger records ---');
    const triedAt = [];
    for (const id of ids) {
        const rec = lk[id] || {};
        const e = (w.entities || []).find((x) => x.id === id);
        const st = FIELDS.map((f) => `${f}:${rec.attempts?.[f]?.state ?? '-'}${rec.fields?.[f]?.value ? '=' + rec.fields[f].value : ''}`).join('  ');
        console.log(`  ${id}  ${e ? e.name + ' [' + e.kind + ']' : '(not in roster)'}  ${st}  srcs=${rec.sources?.length ?? 0}`);
        const at = FIELDS.map((f) => rec.attempts?.[f]?.lastTriedAt).filter((x) => x !== undefined);
        console.log(`      attempts: ${FIELDS.map((f) => `${f}@{count:${rec.attempts?.[f]?.count ?? 0},at:${rec.attempts?.[f]?.lastTriedAt ?? '-'}}`).join('  ')}`);
        if (at.length) triedAt.push(...at);
        if ((rec.sources || []).length) console.log(`      src: ${rec.sources.slice(0, 3).join(' | ')}`);
    }

    // location 列还有多少是「未明/未载」——复验第 4 条判据
    const ents = w.entities || [];
    const named = ents.filter((e) => !lk[e.id]?.fields?.['位置']?.value);
    const notYet = ents.filter((e) => !lk[e.id]).length;
    const stillUnknown = named.filter((e) => String(e.location ?? '').includes('未')).length;
    console.log(`entities with NO 位置 value: ${named.length}  (of which never-looked-up: ${notYet})`);
    console.log(`  ...and location still 未明/未载: ${stillUnknown}`);

    // 点名核对
    for (const nm of extraNames) {
        const e = ents.find((x) => x.name === nm || x.name?.includes(nm));
        if (!e) { console.log(`[${nm}] NOT IN ROSTER`); continue; }
        const rec = lk[e.id] || {};
        console.log(`[${nm}] id=${e.id} kind=${e.kind}`);
        console.log(`    e.location = ${JSON.stringify(e.location)}   (provenance: ${rec['位置来源'] ?? '-'})`);
        for (const f of FIELDS) {
            const fr = rec.fields?.[f];
            const at = rec.attempts?.[f];
            console.log(`    ${f}: value=${JSON.stringify(fr?.value ?? null)}  state=${at?.state ?? 'no-record'}  tries=${at?.count ?? 0}`);
            if (f === '位置' && fr) console.log(`        in-set=${JSON.stringify(fr['位置in集'] ?? null)} how=${fr['位置归一'] ?? '-'}`);
        }
        console.log(`    sources(${rec.sources?.length ?? 0}) = ${(rec.sources || []).slice(0, 6).join(' | ') || '-'}`);
    }

    // 对时：这些 absent 是"旧代码留下的"还是"修完仍在写"？
    //   本棒 leg25 d 的三处修复（异步/取书路径/段落兜底）在 fix tick 之后才生效
    //   ⇒ lastTriedAt 落在修复之前 = 旧账（可用面板「重查」清），落在之后 = 现役 bug。
    if (triedAt.length) {
        console.log(`lookup attempts at ticks: ${[...new Set(triedAt)].sort((a, b) => a - b).join(', ')}  (world tick now = ${w.meta?.tick})`);
    }

    // 判词
    const ok = tally['实力'].ok + tally['位置'].ok;
    if (!ok) {
        console.log('--> VERDICT: ledger exists but ZERO values written.');
        console.log('    pending-dominant  => book read / reply alignment broken.');
        console.log('    absent-dominant   => book read OK but model returned nothing (check entry payload).');
    } else {
        console.log(`--> VERDICT: ${ok} field values written. Lookup pipeline is writing back.`);
        console.log('    Now check panel: header must say 构建 leg25d-lookup-batch.');
    }
    return true;
}

const arg = process.argv[2];
const extraNames = process.argv.slice(3);
if (!extraNames.length) extraNames.push('吞天妖王');

if (arg) {
    report(arg, extraNames);
} else {
    let found = 0;
    for (const [label, dir] of [['chats', DEFAULT_CHATS], ['group-chats', DEFAULT_GROUP_CHATS]]) {
        if (!existsSync(dir)) { console.log(`[${label}] dir missing: ${dir}`); continue; }
        for (const charDir of readdirSync(dir)) {
            let files = [];
            try { files = readdirSync(join(dir, charDir)).filter((f) => f.endsWith('.jsonl')); } catch (_) { continue; }
            for (const f of files) {
                const full = join(dir, charDir, f);
                const got = readHot(full);
                if (got.err) continue;                       // 静默跳过：--scan 只列有热账的
                if (got.world.meta?.entityFields && Object.keys(got.world.meta.entityFields).length) {
                    found += 1;
                    report(full, extraNames);
                }
            }
        }
    }
    if (!found) {
        console.log('No chat with a non-empty lookup ledger found under the default chats dirs.');
        console.log('Pass a path explicitly:  node demo/inspect-lookup.js "<chat.jsonl>"');
    }
}

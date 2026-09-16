// story-world-v2/test/scales-reextract.test.js
// leg62c: locks for the "只重抽设定" (setting-only re-extraction) path.
//
// Origin (user's real machine, two console screenshots):
//   1) one "只重抽设定" run took >22 min and the status stayed at "已 0 段" (zero segments done);
//   2) the console showed the real shape: after ONE genuine timeout (31739 chars / 177.7s) came a
//      halving waterfall -- 21576 / 13175 / 8835 / 6548 / 6401 chars, ALL failing in 0.3s
//      ("Failed to fetch"), and that chunk never succeeded even once.
//
// Two fixes under test:
//   1) `skipRoster`: when re-extracting only settings, the roster pass does not run at all.
//      Its product (`bookEntities`) is consumed only by `seedBookEntities`, and the entities are
//      already in the ledger => that pass burns N calls on a product nobody reads.
//      Call count per chunk: 2 -> 1.
//   2) A TRANSPORT-level failure (the request never arrived) must NOT be halved: splitting the
//      payload cannot fix a broken channel. Halving treats "the model could not finish writing",
//      which is a different failure class.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractWorldSetting, chunkRows, SETTING_CHUNK_CHAR, CANON_SRC_CHAR } from '../src/abstract.js';

/**
 * Big-book fixture: must exceed CANON_SRC_CHAR (30000) to take the chunked path.
 * A small book takes the single-call path where skipRoster is meaningless, so these locks
 * deliberately exercise the multi-chunk path only.
 */
function bigBook(n = 140) {
    const rows = [];
    for (let i = 0; i < n; i += 1) rows.push(`[k${i}] name${i} ` + 'x'.repeat(300));
    return rows.join('\n');
}

/** Deterministic mock: pulls entry names out of the given source (extract-only, never invents). */
function countingExtract(calls) {
    return async (prompt) => {
        calls.push(prompt.length);
        const header = '———— 设定原文如下 ————';
        const src = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        const names = [...src.matchAll(/\[k(\d+)\] (\S+)/g)].map((m) => ({ name: m[2], kind: 'character' }));
        // ★档位名必须**逐字出现在这一块的原文里**（净化层的出处闸会丢编造的档位）⇒
        //   夹具的档位名从原文里取（这里用"第一块的第一个条目名"当档位名），否则整张概念表会被丢空。
        const tier = names.length ? names[0].name : 'fallback';
        return JSON.stringify({
            刻度: [{ 名: 'scale-A', 用途: 'rating', 档位: [{ 档: tier, 注: 'one' }] }],
            rules: ['rule-one'], society: 'soc', techOrMagic: 'magic', historyNotes: ['hist-one'],
            bookEntities: names,
        });
    };
}

test('leg62c skipRoster: the roster pass does not run => call count halves (2 per chunk -> 1)', async () => {
    const src = bigBook();
    assert.ok(Array.from(src).length > CANON_SRC_CHAR, `fixture must be a big book (got ${Array.from(src).length} chars)`);
    const chunks = chunkRows(src.split('\n').map((s) => s.trim()).filter(Boolean), SETTING_CHUNK_CHAR);
    assert.ok(chunks.length >= 2, `fixture must be multi-chunk (got ${chunks.length})`);

    // Arm A: default (roster pass + attribute pass)
    const callsA = [];
    const a = await extractWorldSetting({ sourceText: src, extract: countingExtract(callsA), cache: null, force: true });
    assert.equal(a.ok, true);
    // Arm B: skipRoster
    const callsB = [];
    const b = await extractWorldSetting({ sourceText: src, extract: countingExtract(callsB), cache: null, force: true, skipRoster: true });
    assert.equal(b.ok, true);

    assert.equal(callsB.length, chunks.length, `skipRoster => 1 call per chunk (chunks ${chunks.length} => expect ${chunks.length}, got ${callsB.length})`);
    assert.equal(callsA.length, chunks.length * 2, `default => 2 calls per chunk (roster + attributes, got ${callsA.length})`);
    assert.ok(callsB.length < callsA.length, 'call count really dropped (main cause of the "格外慢" report)');
});

test('leg62c skipRoster: settings still extracted, roster deliberately absent (caller must keep the ledger copy)', async () => {
    const src = bigBook();
    const calls = [];
    const r = await extractWorldSetting({ sourceText: src, extract: countingExtract(calls), cache: null, force: true, skipRoster: true });
    assert.equal(r.ok, true);
    const canon = r.setting.frozen.canon;
    assert.ok((canon.刻度 || []).length > 0, 'concept table still extracted (the point of this action)');
    assert.ok((canon.rules || []).length > 0, 'rules still extracted');
    assert.ok((canon.powerScale || []).length > 0, 'legacy two columns derived from the concept table (panel/pack read them)');
    // With the roster pass skipped, bookEntities is empty here.
    // That is exactly why the wiring layer MUST restore the ledger copy -- otherwise swapping the
    // setting would blank the roster (this repo's recurring "deleted a field only halfway" bug).
    assert.equal((canon.bookEntities || []).length, 0, 'roster pass skipped => no roster in this canon (reported honestly)');
});

test('leg62c transport failure is NOT halved: splitting cannot fix a broken channel', async () => {
    const src = bigBook();
    const chunks = chunkRows(src.split('\n').map((s) => s.trim()).filter(Boolean), SETTING_CHUNK_CHAR);
    // Arm A: every call fails at the transport layer (simulating "Failed to fetch")
    const calls = [];
    const failing = async (prompt) => { calls.push(prompt.length); throw new Error('Failed to fetch'); };
    const r = await extractWorldSetting({ sourceText: src, extract: failing, cache: null, force: true, skipRoster: true });
    assert.equal(calls.length, chunks.length,
        `at most 1 call per chunk (no recursion, no fallback retry): chunks ${chunks.length} => expect ${chunks.length}, got ${calls.length} (extra ones are the halving waterfall)`);
    // ★全块都失败 ⇒ 如实报失败（`ok=false`）——这正是要的：编排层据此**不动账本**。
    //   ★这一条本棒第一版写反了（断言成 ok=true），是判据自己把自己的语义给纠了。
    assert.equal(r.ok, false, 'all chunks failed => ok=false (world untouched, caller keeps the old setting)');
    assert.ok((r.errors || []).length > 0, 'failures reported, not silent');
    // Arm B (counter-check): a NON-transport error (model returned bad JSON) still halves --
    // splitting the input IS the right treatment there. Without this arm the assertion above
    // could be vacuously true because halving was disabled wholesale.
    const calls2 = [];
    const badJson = async (prompt) => { calls2.push(prompt.length); return 'not json at all'; };
    await extractWorldSetting({ sourceText: src, extract: badJson, cache: null, force: true, skipRoster: true });
    assert.ok(calls2.length > chunks.length,
        `model output broken (halving can help) => call count SHOULD exceed chunk count (got ${calls2.length} > ${chunks.length})`);
});

test('leg62c wiring: reextract-setting passes skipRoster and preserves bookEntities', () => {
    const web = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const start = web.indexOf("bus['reextract-setting']");
    const nextBus = web.indexOf('bus[', web.indexOf('};', start));
    const body = web.slice(start, nextBus > start ? nextBus : undefined);
    assert.ok(body.length > 200, 'located the reextract-setting function body');
    assert.match(body, /skipRoster:\s*true/, 'wiring really passes skipRoster (otherwise the change is dead code)');
    assert.match(body, /keptBook/, 'wiring captured the existing roster from the ledger');
    assert.match(body, /bookEntities\s*=\s*keptBook/, 'and writes it back into the new canon (skipping the roster pass without this blanks the roster)');
    assert.ok(!/seedBookEntities\(/.test(body), 'still must NOT call seedBookEntities (that step == restarting the world)');
});

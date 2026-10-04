// story-world-v2/test/abstract-passes.test.js
// ★★★leg150（用户令「甲案＋丙案，开工吧」· 2026-09-29）：**抽象的「三遍」收成「两遍」**。
//
// 细案 = `docs/spec-abstract-passes.md`。用户拍板范围两件：
//   **甲案** —— **起根并进第二遍**：第二遍（属性那一遍）的第 2..N 块里**顺带**问一句"书里正在发生的事"
//             ⇒ 调用数 **3N → 2N**（三国 42 → 28 次，约 21 分 → 约 14 分）。
//             ★候选名单不必等落账：第一遍跑完名字就全有了，"被事件点名过的"在开局那一刻**恒为空集**
//              （起根本身才是这个世界的第一批事件）。
//   **丙案** —— **删掉第二遍首块那份重复的设定**：第一遍（名册遍）本来就问过设定五件套；
//             而 leg63 已用实测推翻"设定只在头块"这个前提（大荒首块只覆盖全书 **10.1%**）
//             ⇒ 那一问**既重复**（对着头块问第二遍）**又没补到漏**（第 2..N 块的设定它一个字没问）。
//
// 这一族锁六件事：
//   ① 那一问**一处定义**（单发起根与并进第二遍共用同一份说明，不许各写一份——本仓最贵的病是"两份复制品漂移"）；
//   ② **接线真的接上了**（初始化时第二遍的第 2..N 块真问、首块不问、根真带得回来、总段数 = 2N）；
//   ③ **丙案之后第二遍只问属性**（形状里只剩 entities；那份"设定＋属性"的首块提示词整份删掉）；
//   ④ **候选名单仍然干净**（玩家自己不进去；两个入口共用同一个排序——细案验收判据 4/5）；
//   ⑤ **不该起根的路一次都不许问**（小书单发那一路、以及「只重抽设定」那条 `skipRoster` 路）；
//   ⑥ **改了问法就要抬缓存版本戳**（否则老书命中旧缓存，新问法一次都不会被行使——leg141 ㉟ 同款耦合）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    extractWorldSetting, CANON_SRC_CHAR, SETTING_CHUNK_CHAR, chunkRows,
    buildAttrsOnlyPrompt, describeProgress,
} from '../src/abstract.js';
import {
    seedRootsFromPass, rankSeedCandidates, maxRootsPerChunk, seedFingerprint,
    SEED_ROOTS_MAX, SEED_CANDIDATES_TOP,
} from '../src/seed-roots.js';
import { buildSeedCandidatePool } from '../src/seed-roots.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const FILLER = '说明说明说明说明说明说明说明说明说明说明'.repeat(6);   // 60 字

/** 测试书：每行 ≈70 字符、带一个唯一名号（名号取自行内的 `【条目N】`，与名册同一治法）。 */
function makeBook(nLines) {
    return Array.from({ length: nLines }, (_, i) => `【条目${i}】甲境。${FILLER}`).join('\n');
}
/** 这本书会被切成几块（**同一把尺子**：块尺寸与块算法都从生产代码取，不在这条判据里另写一份）。 */
const chunkCountOf = (src) => chunkRows(String(src).split('\n').map((s) => s.trim()).filter(Boolean), SETTING_CHUNK_CHAR).length;

const namesIn = (body) => [...body.matchAll(/【条目(\d+)】/g)].map((m) => ({ name: `条目${m[1]}`, kind: 'character' }));

// ══════════════════════════════════════════════════════════════════════════════
// ① 那一问「一处定义」＋ 甲案契约面
// ══════════════════════════════════════════════════════════════════════════════
test('★★★leg150 甲案·契约：第二遍可以「顺带起根」，那一问与单发起根**共用同一份说明**', () => {
    const withRoots = buildAttrsOnlyPrompt('原文', [], { roots: { candidates: ['青丘', '白泽'] } });
    // 单发起根那一份里的四道判据与"不许发明"，必须原样出现在这一份里（抄一份就会漂移）
    for (const w of ['正在发生的事', '有地点', '有当事人', '还没了结', '能往下走', '不要发明']) {
        assert.ok(withRoots.includes(w), `★起根那一问原样带进第二遍（缺「${w}」）`);
    }
    assert.ok(withRoots.includes('青丘') && withRoots.includes('白泽'), '★候选名单递进去了（当事人优先从名单里挑）');
    assert.ok(/"roots"/.test(withRoots) && /"parties"/.test(withRoots), '★输出形状里真有 `roots` 那一格（含 parties）');
    // ★零扰动：不给 opts ⇒ 一个字都不许多问（老调用方一字不改）
    const plain = buildAttrsOnlyPrompt('原文', []);
    assert.ok(!plain.includes('正在发生的事'), '★不给 `roots` ⇒ 不问起根（老调用方零扰动）');
    assert.ok(!plain.includes('"roots"'), '★不给 `roots` ⇒ 形状里也不许出现它');
});

test('★leg150 丙案：第二遍**只问属性**（形状里只剩 `entities`），那份重复的设定整份删掉', () => {
    const src = read('../src/abstract.js');
    // ★删除位锁：那份"设定＋属性"的首块提示词**已删**（丙案就是删它；不许哪天被顺手请回来）
    assert.ok(!/export function buildSettingPrompt/.test(src), '★`buildSettingPrompt` 已删（丙案：那一份设定是重复的）');
    assert.ok(!/isFirst \? buildSettingPrompt/.test(src), '★第二遍不再按"首块/其余块"分叉选词');
    const p = buildAttrsOnlyPrompt('原文', []);
    // ★别拿"力量谱系"当前缀判（它在这一份里**作为反面说明**出现：「设定（力量谱系/法则/…）本遍不要」）
    //   ——本判据第一版就是这么假红的（词面代替语义，本仓的老毛病）。判**形状**：
    const parsed = JSON.parse(p.slice(p.indexOf('{\n'), p.lastIndexOf('}') + 1));
    assert.deepEqual(Object.keys(parsed), ['entities'], '★形状里只剩 `entities` 那一格（设定那五件套一格都不在）');
    for (const k of ['刻度', 'rules', 'society', 'techOrMagic', 'historyNotes', 'situation', 'tension', 'env']) {
        assert.ok(!(k in parsed), `★形状里不许有 \`${k}\`（那是设定那一半的格）`);
    }
    assert.ok(!p.includes('本遍只干两件事'), '★"两件事（设定＋属性）"那句不许再出现');
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 接线：真的只跑两遍（2N 段），且起根落在第 2..N 块上
// ══════════════════════════════════════════════════════════════════════════════
test('★★★leg150 甲案·接线：初始化只跑**两遍**（2N 段），起根在第二遍的第 2..N 块里顺带问出来', async () => {
    const src = `${makeBook(700)}\n【玩家甲】甲境。${FILLER}`;
    assert.ok(Array.from(src).length > CANON_SRC_CHAR, '前置：确为大书（小书那一路不变，另有判据）');
    const N = chunkCountOf(src);
    assert.ok(N >= 3, `前置：这本书要切成 ≥3 块才量得到"第 2..N 块"（实际 ${N}）`);
    const prompts = [];
    const extract = async (prompt) => {
        prompts.push(prompt);
        const header = '———— 设定原文如下 ————';
        const body = prompt.slice(prompt.indexOf(header) + header.length);
        const names = namesIn(body);
        if (body.includes('玩家甲')) names.push({ name: '玩家甲', kind: 'character' });
        const out = { bookEntities: names, entities: names.slice(0, 1).map((n) => ({ name: n.name, kind: 'character', fields: { 身份: '甲境' } })) };
        if (/正在发生的事/.test(prompt)) {
            // ★原话必须真在**这一块**的书文里（起根那道出处闸是逐块核的，与生产同尺）
            const who = (body.match(/【条目(\d+)】/) || [])[1] || '0';
            out.roots = [{ title: `正在办的事${who}`, position: '', parties: [`条目${who}`], quote: body.slice(0, 14) }];
        }
        return JSON.stringify(out);
    };
    const r = await extractWorldSetting({
        sourceText: src, extract, cache: null, seedRoots: { playerName: '玩家甲' },
    });
    assert.equal(r.ok, true, `抽取要成功（errors=${JSON.stringify((r.errors || []).slice(0, 3))}）`);
    // ③ 段数：两遍 × N 块（旧口径是三遍）
    assert.equal(r.timing.calls, 2 * N, `★初始化期间的完成段数 = 2N（旧口径 3N；实际 ${r.timing.calls}，N=${N}）`);
    // ★两遍的招牌句（**别拿"你是世界设定的抽取器"当前缀**——旧口径那份"设定＋属性"的首块提示词
    //   开头也是它，会把两条路混成一条：这正是丙案要删的那一份，本判据第一版就是这么假绿的）
    const roster = prompts.filter((p) => p.includes('提取事实与名号及其属性'));
    const attrs = prompts.filter((p) => p.startsWith('你是世界属性的抽取器'));
    assert.equal(roster.length, N, `名册遍每块一次（实际 ${roster.length}）`);
    assert.equal(attrs.length, N, `★第二遍也每块一次、且**每块都用同一份**（丙案；实际 ${attrs.length}）`);
    assert.ok(!prompts.some((p) => /只从给定的设定原文里提取事实与属性原话/.test(p)),
        '★丙案：那份"设定＋属性"的首块提示词不再出现');
    // ① 起根落在哪几块：首块不问，第 2..N 块问
    assert.ok(!/正在发生的事/.test(attrs[0]), '★首块不问起根（P2 口径：只塞第 2..N 块）');
    assert.equal(attrs.slice(1).filter((p) => /正在发生的事/.test(p)).length, N - 1, '★第 2..N 块都问了起根');
    assert.equal(roster.filter((p) => /正在发生的事/.test(p)).length, 0, '★名册遍一个字都不问起根（那一遍的活儿是名号一个不许漏）');
    // ② 根真的带回来了，而且是**按块**带回来的（收口在编排层做）
    assert.ok(Array.isArray(r.rawRoots), '★第二遍把根带回来了（没有这一格 ⇒ 甲案没接上）');
    assert.equal(r.rawRoots.length, N, '★按块编号带回来（块序，收口时才去重——与 rawBookNames/rawRelations 同一治法）');
    assert.ok(r.rawRoots.slice(1).every((list) => list.length === 1), '★每块那一条都过了出处闸（原话真在那一块里）');
    assert.deepEqual(r.rawRoots[0], [], '★首块没问 ⇒ 那一格是空数组（不是缺格）');
    // ④ 候选名单干净：人设名不进名单（红线 1：玩家不当代言人）
    const listed = attrs.slice(1).map((p) => (p.match(/才用书里别处明述的名号）：\n([^\n]*)/) || [])[1] || '');
    assert.ok(listed.every((s) => s.length > 0), '前置：名单那一行取得到（取不到 ⇒ 下面那条是空绿）');
    assert.ok(listed.every((s) => !s.includes('玩家甲')), '★人设名不在候选名单里（玩家自己不许进候选池）');
    // ★名单里的名字必须**全是这本书里真有的名号**（第一遍的产出真的递进去了，没有凭空的名字）。
    //   ★别写死"头一个必须是条目0"——排序键是"这名字在书里出现多少次"，
    //     而 `条目1` 这种短名会作为**子串**出现在 `条目10/100…` 里 ⇒ 排在前面的不是书里第一个名号。
    //     （本判据第一版就是那么假红的：那是"排序键在干活"的证据，不是病。）
    const listedNames = listed.map((s) => s.split('、'));
    assert.ok(listedNames.every((arr) => arr.length >= 2 && arr.every((n) => /^条目\d+$/.test(n))),
        '★名单里全是这本书里真出现过的名号（第一遍的产出真的递进去了）');
});

test('★leg150 边界：小书单发那一路**不变**（它本来就只有一次调用，起根仍走老路）', async () => {
    const src = makeBook(100);
    assert.ok(Array.from(src).length <= CANON_SRC_CHAR, '前置：确为小书');
    const prompts = [];
    const r = await extractWorldSetting({
        sourceText: src, cache: null, seedRoots: { playerName: '玩家甲' },
        extract: async (p) => { prompts.push(p); return JSON.stringify({ bookEntities: namesIn(p) }); },
    });
    assert.equal(r.ok, true);
    assert.equal(r.timing.mode, 'small');
    assert.equal(r.timing.calls, 1, '小书 = 1 次调用（甲案只管大书那条路）');
    assert.equal(r.rawRoots, undefined, '★小书不带 `rawRoots` ⇒ 接线层照旧走 `seedRootsForWorld`（行为零变化）');
    assert.ok(!prompts.some((p) => /正在发生的事/.test(p)), '★小书这一路一个字都不问起根');
});

test('★leg150 边界：「只重抽设定」那条路（`skipRoster`）一次都不许起根', async () => {
    const src = makeBook(700);
    assert.ok(Array.from(src).length > CANON_SRC_CHAR, '前置：确为大书');
    const prompts = [];
    const r = await extractWorldSetting({
        sourceText: src, skipRoster: true, force: true, seedRoots: { playerName: '玩家甲' },
        extract: async (p) => { prompts.push(p); return JSON.stringify({ 刻度: [{ 名: '表', 源: '条目0', 档位: [{ 档: 'X1', 注: '甲境' }] }] }); },
    });
    assert.ok(prompts.length > 1, '前置：真的跑了多块');
    assert.ok(prompts.every((p) => !/正在发生的事/.test(p)), '★重抽设定不许起根（它的产物不入账，问了纯白烧）');
    assert.equal(r.rawRoots, undefined, '★这条路不带 `rawRoots`');
});

// ══════════════════════════════════════════════════════════════════════════════
// ②b 端到端：第二遍带回来的根**真的落成账上的事件**（"机制在、线断了"那张卡）
// ══════════════════════════════════════════════════════════════════════════════
test('★★★leg150 端到端：并进第二遍的根**真的落成账上的事件**，且玩家一个字都不当当事人', async () => {
    const src = `${makeBook(700)}\n【玩家甲】甲境。${FILLER}`;
    const extract = async (prompt) => {
        const header = '———— 设定原文如下 ————';
        const body = prompt.slice(prompt.indexOf(header) + header.length);
        const names = namesIn(body);
        if (body.includes('玩家甲')) names.push({ name: '玩家甲', kind: 'character' });
        const out = { bookEntities: names, entities: names.slice(0, 1).map((n) => ({ name: n.name, kind: 'character', fields: { 身份: '甲境' } })) };
        if (/正在发生的事/.test(prompt)) {
            const who = (body.match(/【条目(\d+)】/) || [])[1] || '0';
            // ★两条：①当事人是**这本账上真有的名号** ②原话逐字来自**这一块**的书文（出处闸逐块核）
            out.roots = [{ title: `正在办的事${who}`, position: '', parties: [`条目${who}`, '玩家甲'], quote: body.slice(0, 14) }];
        }
        return JSON.stringify(out);
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null, seedRoots: { playerName: '玩家甲' } });
    assert.equal(r.ok, true);
    // 造一个与初始化同形的世界账（名册已成实体 ＋ 玩家棋子已安好）
    const world = {
        version: 1,
        context: { world: '测试', tension: 0.5, positions: ['未明'], setting: r.setting, playerId: 'e_player' },
        entities: [{ id: 'e_player', kind: 'character', name: '玩家甲' }],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
    };
    for (let i = 0; i < 700; i += 1) world.entities.push({ id: `e_${i}`, kind: 'character', name: `条目${i}` });
    const applied = seedRootsFromPass(world, { perChunk: r.rawRoots, fingerprint: 'fp-e2e', at: 't' });
    const seeds = world.events.filter((e) => e.source?.type === 'seed');
    assert.equal(applied.ok, true, `落账要成功（errors=${JSON.stringify(applied.errors || [])}）`);
    assert.equal(seeds.length, applied.seeded);
    assert.ok(seeds.length >= 2, `★真的落成事件了（实际 ${seeds.length} 条）`);
    assert.ok(seeds.every((e) => e.ripples.length >= 1), '每条根都有当事人（账上认得出的实体）');
    assert.ok(seeds.every((e) => !e.ripples.includes('e_player')), '★★玩家不当任何一条根的当事人（红线 1）');
    assert.ok(seeds.every((e) => e.closed === false && e.seedFrom?.quote), '★根是未了结的线头，且带着书里那句原话');
    assert.equal(world.meta.seedRoots.fingerprint, 'fp-e2e', '★幂等指纹写上了（同一本书不重种）');
    // 幂等：同指纹再落一次 = 一条都不加（同名跨块去重也认老账已有的标题）
    const again = seedRootsFromPass(world, { perChunk: r.rawRoots, fingerprint: 'fp-e2e', at: 't2' });
    assert.equal(again.seeded, 0, '★同一批根再落一次一条都不加（跨块去重把老账已有的标题也算"先见到的"）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 收口落账（与分块起根同一套口径）
// ══════════════════════════════════════════════════════════════════════════════
const mkWorld = () => ({
    context: { world: '测试', positions: ['青丘'], playerId: 'e_p' },
    entities: [
        { id: 'e_p', kind: 'character', name: '你' },
        { id: 'e_a', kind: 'faction', name: '青丘' },
        { id: 'e_b', kind: 'character', name: '白泽' },
    ],
    events: [],
    agendas: [],
    meta: { tick: 0 },
});
const root = (title, party) => ({ title, position: '', parties: [party], quote: 'q', why: '' });

test('★leg150 收口：跨块去重**按块序**（先见到的那块算数）＋ 上限 ＋ 幂等指纹', () => {
    const w = mkWorld();
    const r = seedRootsFromPass(w, {
        perChunk: [[], [root('甲事', '青丘')], [root('甲事', '青丘'), root('乙事', '白泽')], []],
        fingerprint: 'fp1', at: 't1',
    });
    assert.equal(r.seeded, 2, '★同名跨块只算一条');
    assert.deepEqual(w.events.filter((e) => e.source?.type === 'seed').map((e) => e.title), ['甲事', '乙事'],
        '★按块序（后见到的重复丢掉——与 seedRootsChunked 的 seenTitles 同一口径）');
    assert.equal(w.meta.seedRoots.fingerprint, 'fp1', '★写幂等指纹（同一本书不重种）');
    assert.equal(w.meta.seedRoots.chunks, 4, '★块数落账（诊断面要能复述"这次几块在起根"）');
    assert.ok(w.meta.seedRoots.ids.length === 2);
    // 上限：跨块加起来也不许超过 SEED_ROOTS_MAX
    const many = mkWorld();
    const perChunk = Array.from({ length: 20 }, (_, i) => [root(`事${i}`, '青丘')]);
    const r2 = seedRootsFromPass(many, { perChunk, fingerprint: 'fp2', at: 't2' });
    assert.ok(r2.seeded <= SEED_ROOTS_MAX, `★总条数硬上限 ${SEED_ROOTS_MAX}（实际 ${r2.seeded}）`);
    // 一条都没有 ⇒ 如实返回失败，但**不许抛**（失败零阻塞）
    const empty = mkWorld();
    const r3 = seedRootsFromPass(empty, { perChunk: [[], []], fingerprint: 'fp3', at: 't3' });
    assert.equal(r3.ok, false, '★一条也没起出来 ⇒ ok=false（调用方据此出声，不静默）');
    assert.equal(empty.meta.seedRoots, undefined, '★空结果不写指纹（下次还能重试）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 候选池：两个入口**同一个纯函数**（细案验收判据 4）
// ══════════════════════════════════════════════════════════════════════════════
test('★leg150 候选池：账本入口与名册入口产出**逐字相同**的名单（同一个纯函数的两个入口）', () => {
    const src = '诸葛亮 诸葛亮 诸葛亮 关羽 关羽 大汉 一 <user> 玩家甲';
    const entities = [
        { id: 'e1', name: '大汉', status: 'active' },
        { id: 'e2', name: '诸葛亮', status: 'active' },
        { id: 'e3', name: '关羽', status: 'active' },
        { id: 'e4', name: '玩家甲', status: 'active' },
    ];
    const world = { context: { playerId: 'e4' }, entities, events: [] };
    const byBook = buildSeedCandidatePool(world, src, SEED_CANDIDATES_TOP);
    const byNames = rankSeedCandidates(entities.filter((e) => e.name !== '玩家甲').map((e) => e.name), src, { top: SEED_CANDIDATES_TOP });
    assert.deepEqual(byBook, byNames, '★两条入口同一个名单（各写一份排序＝迟早漂移）');
    assert.deepEqual(byBook, ['诸葛亮', '关羽', '大汉'], '★按"这本书里出现多少次"降序（leg61 口径未变）');
    // 名号形态闸 + 玩家排除：单字名、占位符、人设名都不进
    const gated = rankSeedCandidates(['一', '<user>', '玩家甲', '正常角色'], '一 <user> 玩家甲 正常角色', { top: 60, exclude: '玩家甲' });
    assert.deepEqual(gated, ['正常角色'], '★2–12 字 ∧ 不含 <>{} ∧ 不是玩家自己');
});

test('★leg150 每块上限：与老口径同一个算式（三国 14 块 ⇒ 每块 2 条）', () => {
    assert.equal(maxRootsPerChunk(14), 2, '★14 块时每块上限 2 条（细案 §6 的原数）');
    assert.equal(maxRootsPerChunk(1), SEED_ROOTS_MAX, '一条块的书：上限就是总数（不许把上限算成 0）');
    assert.equal(maxRootsPerChunk(4), 2);
    assert.equal(maxRootsPerChunk(9), 2);
    const web = read('../web/seed-roots-wiring.js');   // ★Task 4：起根那一族搬去新家（web/index.js 有行数硬锁）
    assert.match(web, /maxPerChunk:\s*maxRootsPerChunk\(/, '★分块起根那条路也用这一个算式（不许内联第二份）');
});

test('★leg150 指纹：串形与老口径**逐字相同**（两条路的幂等判据必须对得上）', () => {
    const src = makeBook(20);
    let h = 0;
    for (let i = 0; i < src.length; i += 1) h = (Math.imul(31, h) + src.charCodeAt(i)) | 0;
    const oldForm = `seed:${src.length}:30000:${(h >>> 0).toString(36)}`;
    assert.equal(seedFingerprint(src), oldForm,
        '★同一本书经"并进第二遍"与"分块起根"两条路必须得到同一个指纹（否则同一本书会被种两遍根）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 接线层：按"并进来了没有"分叉（并进来了就直接落账，不再发第三遍调用）
// ══════════════════════════════════════════════════════════════════════════════
test('★leg150 接线：初始化把并进来的根直接落账，并进来的那一次**不再发第三遍调用**', () => {
    const web = read('../web/index.js');
    assert.match(web, /seedRootsFromPass\(seed,/, '★有个"收下并进来的根"的入口（住 src/seed-roots.js）');
    assert.match(web, /Array\.isArray\(r\.rawRoots\)/, '★按"并进来了没有"分叉：并进来了直接落账；没并进来（小书/命中缓存）才走老的分块起根');
    assert.match(web, /seedRoots:\s*\{\s*playerName/, '★把人设名递进抽取（玩家自己不许进候选池）');
    assert.ok(!/seedRootsForWorld\(seed[\s\S]{0,400}?seedRootsForWorld\(/.test(web), '★同一条路上不许两次起根（只会有一个收口）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 改了问法 ⇒ 缓存版本戳必须同批抬（leg141 ㉟ 的同款耦合）
// ══════════════════════════════════════════════════════════════════════════════
test('★★leg150 耦合：抽取的问法变了 ⇒ `CACHE_VERSION` 必须同批抬（否则老书命中旧缓存，新问法一次都不会被行使）', () => {
    const fpSrc = read('../src/fp-hash.js');
    const ver = Number((/CACHE_VERSION = (\d+)/.exec(fpSrc) || [])[1]);
    assert.ok(Number.isFinite(ver), '★`CACHE_VERSION` 必须取得到（它是这条耦合锁的一头）');
    assert.ok(ver >= 4, `★这一笔同时改了"删设定"与"并起根"两处问法 ⇒ CACHE_VERSION 必须 ≥4（现为 ${ver}）`);
    assert.match(fpSrc, /起根|问法/, '★版本戳的注释要点名这次是**问法**变了（下一个人得看懂它是给谁抬的）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 四个文案面：这一遍现在叫「属性」（丙案之后"属性与设定"是假话）
// ══════════════════════════════════════════════════════════════════════════════
test('★leg150 文案：实施清单仍印块号（leg149 那条棘轮不许回退），但这一遍叫「属性」', () => {
    const line = describeProgress([{ phase: 'finish', step: 'attrs', index: 3, count: 14, chars: 30000, ms: 90000, ok: true }])[0];
    assert.ok(line.includes('第 3/14 块'), `★块号照旧要印（leg149 的棘轮：实际「${line}」）`);
    assert.ok(line.includes('属性'), '★第二遍只问属性');
    assert.ok(!line.includes('属性与设定'), '★丙案之后"与设定"是假话，四处文案都不许再印');
    const web = read('../web/index.js');
    for (const bad of ["'属性与设定'", '属性与设定第']) {
        assert.ok(!web.includes(bad), `★状态栏/心跳/事件日志三处也不许再印「${bad}」`);
    }
    assert.ok(web.includes("'属性'"), '★状态栏那一支现在认"属性"');
});

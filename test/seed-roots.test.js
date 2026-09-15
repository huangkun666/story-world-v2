// story-world-v2/test/seed-roots.test.js
// ★★leg40：**从世界源起根**——把书里"正在发生的事"提取成账上的线头事件（治"世界源只剩名册、一条事都没起过"）。
// 这一族用例锁四件事：
//   ① **只提取不发明**：当事人必须是**账上真有的实体名**（对不上就丢这条根，绝不新建、绝不猜）；
//   ② **净化是机械的**：没有书里原话 / 没有当事人 / 形状不对 ⇒ 丢，且如实上报；
//   ③ **幂等 + 零调用**：同一本书只种一次；线头够用时一次调用都不发（`shouldSeedRoots`）；
//   ④ **失败零阻塞 + 不碰世界进度**：调用抛错/返回非 JSON ⇒ 原样返回不抛；落账只追加 `events` 与 `meta.seedRoots`。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSeedRootsPrompt, sanitizeSeedRoots, applySeedRoots, shouldSeedRoots, seedRoots,
    SEED_ROOTS_MAX,
} from '../src/seed-roots.js';
import { computeOpenRoots } from '../src/pack.js';

const mkWorld = () => ({
    context: { world: '测试', positions: ['青丘', '九霄'], playerId: 'e_p' },
    entities: [
        { id: 'e_p', kind: 'character', name: '你' },
        { id: 'e_a', kind: 'faction', name: '青丘' },
        { id: 'e_b', kind: 'character', name: '白泽' },
    ],
    events: [{ id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '九霄', ripples: ['e_a'], closed: false }],
    agendas: [],
    meta: { tick: 7 },
});

test('leg40·起根：提示词只问"书里正在发生的事"，并要求指回原话（不许发明）', () => {
    const p = buildSeedRootsPrompt('书文正文');
    assert.ok(p.includes('正在发生的事'), '问的是"正在发生的事"（不是"你想点什么"）');
    assert.ok(p.includes('有地点'), '判据①：有地点');
    assert.ok(p.includes('有当事人'), '判据②：有当事人');
    assert.ok(p.includes('还没了结'), '判据③：还没了结');
    assert.ok(p.includes('能往下走'), '判据④：能往下走');
    assert.ok(p.includes('不要发明'), '★"不许发明"必须明写（引擎只提取）');
    assert.ok(p.includes('"roots"'), '输出形状：roots 数组');
    assert.ok(p.includes('书文正文'), '书文正文必须真的拼进去');
});

test('leg40·起根：净化是机械的——没原话/没当事人/重复/形状不对的丢，且如实上报', () => {
    const { roots, warnings } = sanitizeSeedRoots({
        roots: [
            { title: '遗迹试炼大开', position: '青丘（推）', parties: ['青丘', '白泽'], quote: '复苏历：遗迹试炼大开' },
            { title: '', parties: ['甲'], quote: 'x' },                    // 无标题
            { title: '没有原话', parties: ['乙'], quote: '' },              // 指不回书里
            { title: '没有当事人', parties: [], quote: 'y' },               // 没人办的事
            { title: '遗迹试炼大开', position: '青丘', parties: ['青丘'], quote: '重复' },   // 与第一条重名
            'not-an-object',
        ],
    });
    assert.equal(roots.length, 1, '六条里只有一条合格');
    assert.equal(roots[0].title, '遗迹试炼大开');
    assert.equal(roots[0].position, '青丘', '★位置走 normalizePosition（「（推）」注解剥掉——与全局同一条口径）');
    assert.deepEqual(roots[0].parties, ['青丘', '白泽']);
    assert.ok(warnings.length >= 4, '每一条被丢的都要有理由（不静默丢料）');
    assert.ok(warnings.some((w) => w.includes('没有书里原话')), '缺 quote 的理由要写明');
    // 上限
    const many = sanitizeSeedRoots({ roots: Array.from({ length: 20 }, (_, i) => ({ title: `事${i}`, parties: ['青丘'], quote: `q${i}` })) });
    assert.ok(many.roots.length <= SEED_ROOTS_MAX, `条数硬上限 ${SEED_ROOTS_MAX}`);
});

test('leg40·起根：当事人必须在账上——对不上就丢这条根（宁缺勿造），玩家不当代言人', () => {
    const w = mkWorld();
    const { seeded, skippedParties, ids } = applySeedRoots(w, [
        { title: '遗迹试炼大开', position: '青丘', parties: ['青丘', '查无此人'], quote: 'q1' },
        { title: '全是生人', position: '九霄', parties: ['张三', '李四'], quote: 'q2' },
        { title: '玩家来办', position: '九霄', parties: ['你'], quote: 'q3' },
    ], { fingerprint: 'fp1', at: 'now' });
    assert.equal(seeded, 1, '只有第一条能落（青丘在册）');
    assert.deepEqual(ids, ['ev_seed_1']);
    assert.deepEqual(skippedParties, ['查无此人', '张三', '李四'], '对不上的名字如实记账（含"整条根因此被丢"的那两个），不新建实体');
    assert.equal(w.entities.length, 3, '★绝不新建实体（名册只由名册抽取那条路管）');
    const ev = w.events.find((e) => e.id === 'ev_seed_1');
    assert.equal(ev.source.type, 'seed', '★第四型源：seed（世界源起的根）');
    assert.equal(ev.closed, false, '根必须是未决的（否则当不了线头）');
    assert.deepEqual(ev.ripples, ['e_a']);
    assert.equal(ev.seedFrom.quote, 'q1', '★书里原话随根留下（可核查：这条根指得回书里）');
    assert.equal(ev.position, '青丘');
    // 它必须真的被算成"线头"（否则整条通路白做）
    assert.ok(computeOpenRoots(w).some((r) => r.id === 'ev_seed_1'), '★种下的根必须被 computeOpenRoots 认成线头');
});

test('leg40·起根：幂等 + 线头够用时不调用（零 token），落账不碰世界进度', () => {
    const w = mkWorld();
    const before = { tick: w.meta.tick, events: w.events.length, agendas: w.agendas.length };
    // ① 线头够用（起点已有一条线头 ev_1）⇒ 不种、且**一次调用都不发**
    let calls = 0;
    const extract = async () => { calls += 1; return { roots: [{ title: 'X', parties: ['青丘'], quote: 'q' }] }; };
    return seedRoots({ ssot: w, sourceText: '书文', extract, fingerprint: 'fp1', minRoots: 1 })
        .then((r1) => {
            assert.equal(r1.skipped, true, '线头够用 ⇒ 跳过');
            assert.equal(calls, 0, '★跳过时零调用（幂等与省钱的底线）');
            return seedRoots({ ssot: w, sourceText: '书文', extract, fingerprint: 'fp1', minRoots: 99 });
        })
        .then((r2) => {
            assert.equal(r2.ok, true);
            assert.equal(r2.seeded, 1, '线头不足 ⇒ 种下 1 条');
            assert.equal(calls, 1);
            assert.equal(w.meta.tick, before.tick, '★不碰 tick');
            assert.equal(w.agendas.length, before.agendas, '★不碰盘算');
            assert.equal(w.events.length, before.events + 1, '只追加事件');
            assert.equal(w.meta.seedRoots.fingerprint, 'fp1', '★留指纹（同一本书不重复种）');
            // ② 同一本书再来一次 ⇒ 零调用
            return seedRoots({ ssot: w, sourceText: '书文', extract, fingerprint: 'fp1', minRoots: 99 });
        })
        .then((r3) => {
            assert.equal(r3.skipped, true, '同一本书第二次 ⇒ 幂等跳过');
            assert.equal(calls, 1, '第二次没再发调用');
            assert.equal(w.events.length, before.events + 1, '账上不多不少');
        });
});

test('leg40·起根：失败零阻塞（调用抛错 / 返回非 JSON / 源为空 ⇒ 原样返回，不抛）', async () => {
    const w = mkWorld();
    const opts = { ssot: w, sourceText: '书文', fingerprint: 'fpX', minRoots: 99 };
    const boom = await seedRoots({ ...opts, extract: async () => { throw new Error('网关 502'); } });
    assert.equal(boom.ok, false);
    assert.ok(String(boom.errors[0]).includes('502'), '错误如实上报');
    assert.equal(w.events.length, 1, '世界原样不动');
    assert.equal(w.meta.seedRoots, undefined, '失败不写指纹（下次还能重试）');
    const notJson = await seedRoots({ ...opts, extract: async () => '这不是 JSON' });
    assert.equal(notJson.ok, false);
    const noSrc = await seedRoots({ ...opts, sourceText: '   ', extract: async () => ({ roots: [] }) });
    assert.equal(noSrc.ok, false);
    const empty = await seedRoots({ ...opts, extract: async () => ({ roots: [] }) });
    assert.equal(empty.ok, false, '抽取结果为空 ⇒ 如实报失败，不假装种过');
    assert.equal(w.meta.seedRoots, undefined, '空结果也不写指纹');
    // 围栏 JSON 能吃进来（真实模型常包一层）
    const fenced = await seedRoots({ ...opts, extract: async () => '```json\n{"roots":[{"title":"围栏也能吃","parties":["青丘"],"quote":"q"}]}\n```' });
    assert.equal(fenced.ok, true);
    assert.equal(fenced.seeded, 1);
});

test('leg40·起根：shouldSeedRoots 的判据（已种过 / 线头够用 / 线头不足）', () => {
    const w = mkWorld();
    assert.equal(shouldSeedRoots(w, { fingerprint: 'fp1', minRoots: 3 }).seed, true, '只有 1 条线头 < 3 ⇒ 该种');
    assert.equal(shouldSeedRoots(w, { fingerprint: 'fp1', minRoots: 1 }).seed, false, '线头够 ⇒ 不种');
    w.meta.seedRoots = { fingerprint: 'fp1', ids: ['ev_seed_1'] };
    assert.equal(shouldSeedRoots(w, { fingerprint: 'fp1', minRoots: 99 }).seed, false, '★已种过 ⇒ 不再种（幂等，零调用）');
    assert.equal(shouldSeedRoots(w, { fingerprint: 'fp2', minRoots: 99 }).seed, true, '换了书（指纹不同）⇒ 允许再种');
});

// story-world-v2/test/full-roster-smoke.test.js
// K47（full-roster-lens-spec C3/C5 拍板）：全量棋盘 100t 冒烟——
// 345 实体起步（seed 全量+权重预填）连跑：无超席强制（无"席位满员"编年）、全册保持、
// 镜头 30k 预算内（全量入镜实证）、坏账 0、观测台三读数可出（驻留=镜头口径）、确定性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmoke } from '../src/smoke.js';
import { seedBookEntities } from '../src/abstract.js';
import { scanDanglingRefs, residencyStats, rejectionStats } from '../src/observatory.js';
import { lensList, EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

// 全量棋盘世界：345 名号（117 势力/228 角色，含 13 location 与 8 个隶属子势力——实机量级同构）
function fullRosterWorld() {
    const book = [];
    for (let i = 0; i < 228; i += 1) book.push({ name: `角色${i}`, kind: 'character' });
    for (let i = 0; i < 117; i += 1) book.push({ name: `势力${i}`, kind: 'faction' });
    for (let i = 0; i < 13; i += 1) book.push({ name: `地界${i}`, kind: 'location' });
    book.push({ name: '总盟', kind: 'faction' }, { name: '分堂一', kind: 'faction', parent: '总盟' }, { name: '分堂二', kind: 'faction', parent: '总盟' });
    const w = {
        version: 1,
        context: { world: '全量棋盘', tension: 0.5, positions: ['中央'], setting: { frozen: { fingerprint: 'fp_test', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities: book } }, dynamic: { tension: { polarity: '守序与破序', direction: '', intensity: 0.5 }, env: {} } } },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
    };
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 346, '角色228 + 独立势力118（117+总盟）——13 location 不入池，分堂一/二折叠');
    assert.equal(r.folded, 2, '分堂一/二折叠进总盟 branches');
    return w;
}

function busyStepGen(t) {
    return (tick, world) => {
        const open = world.agendas.filter((a) => !a.closed);
        const actions = open.slice(0, 12).map((a) => ({ entity: a.owner, verb: '推进', position: '中央' }));
        const newEvents = open.slice(0, 4).map((a) => ({ title: `局面演进（${a.goal}）`, source: { type: 'plot', ref: a.id }, position: '中央', ripples: [a.owner] }));
        const agendaAdvances = open.slice(0, 12).map((a) => ({ agendaId: a.id, step: `第 ${tick} 步`, stage: '推进' }));
        if (tick === 5 || tick % 30 === 0) actions.push({ entity: world.entities.find((e) => e.kind === 'character')?.id, verb: '走动', position: '中央' });
        return { actions, newEvents, agendaAdvances, stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    };
}

test('K47 全量棋盘 100t：345+ 实体连跑——无超席强制、全册保持、镜头 30k、坏账 0、三读数可出', async () => {
    const w0 = fullRosterWorld();
    const w1 = structuredClone(w0);
    const { world, metrics } = await runSmoke({ ssot: w0, extractCtx: {}, ticks: 100, stepGen: busyStepGen() });
    assert.equal(metrics.ticks, 100);
    // 无超席强制：全程无"席位满员"编年（K45 语义）
    assert.ok(!world.chronicle.some((c) => c.text.includes('席位满员')), '无席位满员编年');
    // 全册保持：无强制退休（345+ 实体减员只能来自闲置退休/覆灭；本冒烟无覆灭提议、无闲置满 20 轮者——全活）
    assert.equal(world.entities.filter((e) => !e.status || e.status === 'active').length, w1.entities.length, '全册 active 保持（无超席强制、无闲置退休：全程步进活跃）');
    // 镜头 30k：打包预算全达标（345 全量入镜实证）
    assert.ok(metrics.maxPackTokens <= EVOLUTION_BUDGET_TOKENS, `输入峰 ${metrics.maxPackTokens} ≤ ${EVOLUTION_BUDGET_TOKENS}`);
    assert.equal(lensList(world).length, world.entities.filter((e) => !e.status || e.status === 'active').length, '全量入镜（30k 现规模容纳）');
    // 坏账 0 + 观测台三读数（镜头口径驻留）
    const d = scanDanglingRefs(world);
    assert.equal(d.count, 0, `坏账 ${d.count}`);
    const res = residencyStats(world);
    assert.equal(res.entities, w1.entities.length);
    assert.equal(res.inLens, res.statusCount.active, '镜头人数=全册 active（全量入镜）');
    assert.ok(typeof res.lensIdle.p50 === 'number');
    const rej = rejectionStats(world.meta.simLog);
    assert.ok(rej.ok === false || typeof rej.rate === 'number', '拒签读数可出');
    // 形状合法 + 确定性（同输入重跑逐字节一致）
    assert.equal(validate(world, ssotSchema).ok, true);
    const { world: worldB } = await runSmoke({ ssot: w1, extractCtx: {}, ticks: 100, stepGen: busyStepGen() });
    assert.equal(JSON.stringify(world), JSON.stringify(worldB), '确定性逐字节');
    // K47 曲线（铁律 8：落台账）
    const sizes = metrics.bytes.map((b) => b.bytes);
    console.log(`[K47 曲线] 全量棋盘 100t: 实体 ${world.entities.length}（全册） · 输入峰 ${metrics.maxPackTokens}/${EVOLUTION_BUDGET_TOKENS} · 在飞峰 ${metrics.peakOpenAgendas}/≤15 · 警告 ${metrics.warningsTotal} · 驻留 p50=${res.lensIdle.p50} p90=${res.lensIdle.p90} 摸鱼 ${res.loungers.length} · 终态 ${sizes[sizes.length - 1]}B`);
});
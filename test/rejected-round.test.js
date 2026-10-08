import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTick, settleWithHealing, emptyStep } from '../src/tick.js';
import { createTickQueue } from '../src/async-tick.js';
import { checkWorldStep } from '../src/check-step.js';
import { diagnostics } from '../src/diagnostics.js';
import { hotAccountShape } from '../src/storage.js';
import * as diagnosticTransport from '../web/diagnostic-transport.js';

// ★★★leg199（用户令「**删掉降级吧**」）：**没有 ` ```tags ` 块 ⇒ 零收获** ⇒ 要读出标签的夹具必须包块。
const FENCE = '`'.repeat(3);
/** 把若干行标签包进一个 ` ```tags ` 块（"只扫块里"这条口径的夹具入口）。 */
const fenced = (...lines) => [FENCE + 'tags', ...lines, FENCE].join('\n');

const world = () => ({
    version: 1, context: { world: '测试世界', tension: 0.5, positions: ['大营'] },
    entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '大营', lastActiveTick: 0 }],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
});
const event = () => ({ title: '合法新事', source: { type: 'state' }, position: '大营', ripples: ['e_a'] });
const malformedAgenda = () => ({
    entity: 'e_a', goal: '安插亲信', visibility: 'known', source: { type: 'state' }, 'stage:安插亲信': '',
});
const badStep = () => ({ ...emptyStep(), newAgendas: [malformedAgenda()] });
const transport = step => async () => ({ text: JSON.stringify(step) });

test('首轮未知字段只丢该提议，合法事件保留并正常落账', async () => {
    const w = world(), step = { ...badStep(), newEvents: [event()] };
    assert.equal(checkWorldStep(step, w).ok, false, '字段形状闸仍严格');
    const before = structuredClone(step);
    const r = await runTick({ ssot: w, transport: transport(step), dialogue: '（继续）' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.meta.tick, 1);
    assert.ok(r.ssot.events.some(e => e.title === '合法新事'), '不能整轮用空步替掉合法内容');
    assert.equal(r.healed.fallback, false);
    assert.equal(r.ssot.agendas.length, 0);
    assert.ok(r.healed.dropped.some(d => d.family === 'newAgendas' && d.reason.includes('stage:安插亲信')));
    assert.deepEqual(step, before, '不能修写模型提议');
});

test('首轮所有提议非法：结算失败，轮数、世界和模拟日志均不变', () => {
    const w = world(), before = structuredClone(w);
    const r = settleWithHealing({ ssot: w, step: badStep() });
    assert.equal(r.ok, false, '全坏不能记作成功的安静一轮');
    assert.deepEqual(r.ssot, before);
    assert.deepEqual(w, before);
    assert.match(r.stage.warnings.join('；'), /stage:安插亲信/);
    assert.match(r.stage.warnings.join('；'), /未推进/);
});

test('净化后仍非法：拒绝整步，不用空步替代和推进轮数', async () => {
    const w = world(), before = structuredClone(w);
    const step = { ...emptyStep(), newEvents: [event()], badTopLevel: true };
    const r = await runTick({ ssot: w, transport: transport(step), dialogue: '（继续）' });
    assert.equal(r.ok, false);
    assert.match(r.error, /badTopLevel/);
    assert.deepEqual(w, before);
    assert.equal(r.streams, null);
});

test('失败演算不泄漏本轮正文事实或已展示标记到输入账', async () => {
    for (const reply of ['', JSON.stringify(badStep())]) {
        const w = world(), before = structuredClone(w);
        const r = await runTick({ ssot: w, transport: async () => reply, dialogue: fenced('【协议】3', '【行动】甲｜守卫营门｜大营', '【事件】E1｜营门戒严确立｜甲｜已完成') });
        assert.equal(r.ok, false);
        assert.ok(r.dialogueStats.events > 0, '确实处理了本轮正文事实');
        assert.deepEqual(w, before);
    }
});

test('真实队列全坏首轮不保存，可重试且下一次合法输出仍落在第1轮', async () => {
    let current = world(), fail = true, saves = 0;
    const statuses = [];
    const queue = createTickQueue({
        load: () => current,
        tick: ({ world: ssot, dialogue }) => runTick({ ssot, dialogue, transport: transport(fail ? badStep() : { ...emptyStep(), newEvents: [event()] }) }),
        save: ssot => { saves++; return current = ssot; },
        onStatus: message => statuses.push(message),
    });
    const before = structuredClone(current);
    const rejected = await queue.advance('（继续）');
    assert.equal(rejected.ok, false);
    assert.equal(saves, 0);
    assert.equal(queue.busy, false);
    assert.deepEqual(current, before);
    assert.match(statuses.at(-1), /演算失败.*可重试/);
    fail = false;
    assert.deepEqual(await queue.advance('（重试）'), { ok: true, tick: 1 });
    assert.equal(saves, 1);
    assert.equal(current.meta.simLog.length, 1);
});

test('非空模型响应被校验拒绝时，插件调试记录仍可看到演算错误和原因', async () => {
    diagnostics.clear();
    const step = badStep();
    const r = await runTick({ ssot: world(), dialogue: '（继续）', transport: diagnosticTransport.diagExtract({ model: 'fixture', transport: transport(step) }) });
    assert.equal(typeof diagnosticTransport.diagTickOutcome, 'function');
    diagnosticTransport.diagTickOutcome(r, 0);
    const records = diagnostics.snapshot();
    assert.ok(records.some(rec => rec.module === '模型' && rec.message === '调用完成'));
    assert.ok(records.some(rec => rec.module === '演算' && rec.level === 'error' && JSON.stringify(rec).includes('stage:安插亲信')));
    diagnostics.clear();
});

test('前置查书保存后失败：热账不泄漏演算事实，未查到新字段时不误触发保存', async () => {
    for (const changed of [false, true]) {
        const w = world();
        w.meta.entityFields = {};
        let hot = hotAccountShape(w), writes = 0;
        const r = await runTick({
            ssot: w, dialogue: fenced('【协议】3', '【行动】甲｜守卫营门｜大营', '【事件】E1｜营门戒严确立｜甲｜已完成'), transport: async () => '',
            preStep: async ({ ssot }) => ({ ssot: changed
                ? { ...ssot, meta: { ...ssot.meta, entityFields: { e_a: { lookedUp: true } } } } : ssot }),
            onPreStep: async pre => {
                const shapeBefore = hot.world;
                if (shapeBefore && pre.ssot.meta?.entityFields !== shapeBefore.meta?.entityFields) {
                    hot = hotAccountShape(pre.ssot);
                    writes++;
                }
            },
        });
        assert.equal(r.ok, false);
        assert.ok(r.dialogueStats.events > 0);
        assert.equal(writes, changed ? 1 : 0);
        assert.equal(hot.world.meta.tick, 0);
        assert.equal(hot.world.events.length, 0, '正文事实不许经前置保存的同一引用泄漏');
        assert.equal(hot.world.chronicle.length, 0);
        assert.deepEqual(hot.world.meta.entityFields, changed ? { e_a: { lookedUp: true } } : {});
    }
});

test('丢弃前置坏新事件：其依赖不得重指幸存事件，幸存事件的合法依赖仍保留', async () => {
    const w = world();
    const agenda = (goal, ref) => ({ entity: 'e_a', goal, visibility: 'known', source: { type: 'event', ref } });
    const step = { ...emptyStep(),
        newEvents: [{ ...event(), title: '坏事件', unknown: true }, event()],
        newAgendas: [agenda('依赖坏事件', 'ev_1_1'), agenda('依赖好事件', 'ev_1_2')],
        newEntities: [
            { name: '依赖坏事的人', source: { type: 'event', ref: 'ev_1_1' } },
            { name: '依赖好事的人', source: { type: 'event', ref: 'ev_1_2' } },
        ],
    };
    const original = structuredClone(step);
    const r = await runTick({ ssot: w, dialogue: '（继续）', transport: transport(step) });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.events.length, 1);
    assert.equal(r.ssot.agendas.length, 1);
    assert.equal(r.ssot.agendas[0].goal, '依赖好事件');
    assert.equal(r.ssot.agendas[0].source.ref, r.ssot.events[0].id);
    assert.equal(r.ssot.entities.some(e => e.name === '依赖坏事的人'), false);
    assert.ok(r.ssot.entities.some(e => e.name === '依赖好事的人'));
    assert.ok(r.healed.dropped.some(d => d.family === 'newAgendas' && d.label.includes('依赖坏事件')));
    assert.deepEqual(step, original);
});

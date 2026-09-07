// story-world-v2/test/bystander-world.test.js
// 旁观者世界健康检查：三方互斗与玩家无关 + 8 回合提取命中。演示工具，引擎零改动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { extractMove } from '../src/extract.js';
import { runTick } from '../src/tick.js';

const WORLD = JSON.parse(readFileSync(new URL('./fixtures/bystander-world.json', import.meta.url), 'utf8'));
const CTX = JSON.parse(readFileSync(new URL('./fixtures/bystander-ctx.json', import.meta.url), 'utf8'));

test('旁观者世界：通过 SSOT schema，三方盘算互斗且不含玩家', () => {
    const r = validate(WORLD, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(WORLD.agendas.length, 3);
    const texts = JSON.stringify(WORLD.agendas) + JSON.stringify(WORLD.events) + JSON.stringify(WORLD.chronicle);
    assert.ok(!texts.includes('黄坤') && !texts.includes('坊市少年'), '世界初始状态不含玩家任何痕迹');
});

const CASES = [
    ['我去看看坊市西门的动静', { verb: '探查', object: null, location: '云砂坊市' }],
    ['掌柜，这筐药材值几何？', { verb: '询价', object: '掌柜', location: null }],
    ['回铺子，我要开始修炼了', { verb: '修炼', object: '铺子', location: null }],
    ['（继续）', { verb: null, object: null, location: null }],
    ['此地太吵，我们离开这里', { verb: '离开', object: null, location: null }],
    ['我谋划把这间铺子买下来', { verb: '图谋', object: '铺子', location: null }],
    ['掌柜，带路吧', { verb: '跟随', object: '掌柜', location: null }],
    ['（静一静，想想心事）', { verb: null, object: null, location: null }],
];

test('旁观者回合：落子提取命中（全部与战局无关的小事）', () => {
    for (const [dialogue, exp] of CASES) {
        const got = extractMove(dialogue, CTX);
        assert.equal(got.verb, exp.verb, `${dialogue} → verb`);
        assert.equal(got.object, exp.object, `${dialogue} → object`);
        assert.equal(got.location, exp.location, `${dialogue} → location`);
    }
});

test('旁观者世界：跑一个 tick 不炸（fake 空步）', async () => {
    const idle = async () => ({ text: JSON.stringify({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [] }) });
    const r = await runTick({ transport: idle, ssot: WORLD, dialogue: '（静默）', extractCtx: CTX });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.meta.tick, 1);
});
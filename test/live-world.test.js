// story-world-v2/test/live-world.test.js
// 活演示世界的健康检查：schema 合法 + 提取得当（引擎零改动，纯演示工具）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { extractMove } from '../src/extract.js';
import { runTick } from '../src/tick.js';

const WORLD = JSON.parse(readFileSync(new URL('./fixtures/live-world.json', import.meta.url), 'utf8'));
const CTX = JSON.parse(readFileSync(new URL('./fixtures/live-ctx.json', import.meta.url), 'utf8'));

test('活演示世界：通过 SSOT schema（三实体三盘算，薛铁衣暗盘算）', () => {
    const r = validate(WORLD, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(WORLD.agendas.length, 3);
    assert.equal(WORLD.agendas.find((a) => a.id === 'a_xie').visibility, 'concealed', '薛铁衣在暗处（§4.4⑤ 明暗双流都在流）');
});

const CASES = [
    ['我去大盘谷看看薛铁衣的动静', { verb: '探查', object: '薛铁衣', location: '大盘谷' }],
    ['我想问偏将大人，灵脉交割的章程', { verb: '询问', object: '大虞偏将', location: null }],
    ['薛铁衣，你究竟是什么来路', { verb: '盘问', object: '薛铁衣', location: null }],
    ['万法阁的道友，带路吧', { verb: '跟随', object: '万法阁', location: null }],
    ['我谋划拿下这条灵脉', { verb: '图谋', object: '灵脉', location: null }],
    ['太岁残骨的事，我向万法阁询个价', { verb: '询价', object: '万法阁', location: null }],
    ['此地煞气太重，我们离开这里', { verb: '离开', object: null, location: null }],
    ['回黄府后，我要开始修炼了', { verb: '修炼', object: null, location: '黄府' }],
];

test('活演示世界：八条演示对话的落子提取命中', () => {
    for (const [dialogue, exp] of CASES) {
        const got = extractMove(dialogue, CTX);
        assert.equal(got.verb, exp.verb, `${dialogue} → verb`);
        assert.equal(got.object, exp.object, `${dialogue} → object`);
        assert.equal(got.location, exp.location, `${dialogue} → location`);
    }
});

test('活演示世界：多实体世界跑一个 tick（fake 空步）不炸', async () => {
    const idle = async () => ({ text: JSON.stringify({ actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [] }) });
    const r = await runTick({ transport: idle, ssot: WORLD, dialogue: '（静默）', extractCtx: CTX });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.meta.tick, 1);
});
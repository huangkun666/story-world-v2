// story-world-v2/test/bystander-world.test.js
// 旁观者世界健康检查：三方互斗与玩家无关 + 8 回合提取命中。演示工具，引擎零改动。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
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

// ★★★leg198 翻案：这 8 条原来对拍的是老口径那张动词词表（含两条"猜不出 ⇒ 动词空"的对照）——
//   用户 2026-10-05 令把那一族整族拆掉（"没标签就不进正文的行动"）⇒ 被测对象不存在了。
//   新口径的判据在 `test/no-guess.test.js`。

test('旁观者世界：跑一个 tick 不炸（fake 空步）', async () => {
    // leg25 c：世界步契约已无 `stateChanges`（四维浮点整条删除）——fake 空步不再拼它，
    //   否则 checkWorldStep 判"未知字段"整步被拒，tick 不推进。
    const idle = async () => ({ text: JSON.stringify({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] }) });
    const r = await runTick({ transport: idle, ssot: WORLD, dialogue: '（静默）', extractCtx: CTX });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.meta.tick, 1);
});
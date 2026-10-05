// story-world-v2/test/live-world.test.js
// 活演示世界的健康检查：schema 合法 + 提取得当（引擎零改动，纯演示工具）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { runTick } from '../src/tick.js';

const WORLD = JSON.parse(readFileSync(new URL('./fixtures/live-world.json', import.meta.url), 'utf8'));
const CTX = JSON.parse(readFileSync(new URL('./fixtures/live-ctx.json', import.meta.url), 'utf8'));

test('活演示世界：通过 SSOT schema（三实体三盘算，薛铁衣暗盘算）', () => {
    const r = validate(WORLD, ssotSchema);
    assert.equal(r.ok, true, r.errors.join('; '));
    assert.equal(WORLD.agendas.length, 3);
    assert.equal(WORLD.agendas.find((a) => a.id === 'a_xie').visibility, 'concealed', '薛铁衣在暗处（§4.4⑤ 明暗双流都在流）');
});

// ★★★leg198 翻案：这里原来有 8 条"演示对话的落子提取命中"（对拍老口径那张 13 条动词表）——
//   用户 2026-10-05 令「**这个词表按道理说早应该拆了…这个功能要猜，没标签就不进正文的行动即可**」
//   ⇒ 那个模块整族删除，这 8 条**没有东西可测了**（不是放宽，是被测对象不存在了）。
//   新口径的判据在 `test/no-guess.test.js`（无标签 ⇒ 落子为空；有标签 ⇒ 照旧成立）。

test('活演示世界：多实体世界跑一个 tick（fake 空步）不炸', async () => {
    // leg25 c：世界步契约已无 `stateChanges`（四维浮点整条删除）——fake 空步不再拼它。
    const idle = async () => ({ text: JSON.stringify({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] }) });
    const r = await runTick({ transport: idle, ssot: WORLD, dialogue: '（静默）', extractCtx: CTX });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.ssot.meta.tick, 1);
});
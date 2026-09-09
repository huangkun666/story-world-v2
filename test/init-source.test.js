// story-world-v2/test/init-source.test.js
// 第十八棒：初始化设定源合订（编排层助手纯函数）——自动合订角色卡+世界信息 /
// 世界书条目全量不截断（v1 教训对齐）/ 尊重禁用标记 / 卡件 v1 spend 同款 / 防御上限 / 去重 / 确定性。
// 换源/worldBook 机制已整体废除——本模块不再接受任何外部文本槽。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    composeInitSource, INIT_SOURCE_HARD_CEILING, INIT_PIECE_CAPS,
} from '../src/init-source.js';

const CARD = {
    name: '江州奇谭',
    description: '大虞边陲江州，妖邪四起。'.repeat(30), // 约 360 字
    scenario: '边关告急，商路断绝。'.repeat(20),
    personality: '各方势力各怀鬼胎。'.repeat(10),
    first_mes: '雨夜，你站在城门口。'.repeat(5),
};

const ENTRY = (key, content) => ({ key, content });
const BOOK_ENTRY = (uid, content) => ({ uid, key: `k${uid}`, content });

test('自动合订卡四件套，顺序=描述/场景/人格/开场白，worldName=卡名', () => {
    const r = composeInitSource({ character: CARD });
    assert.equal(r.ok, true);
    assert.ok(r.label.includes('自动合订'));
    assert.equal(r.worldName, '江州奇谭');
    assert.equal(r.pieceCount, 4);
    assert.ok(r.text.includes('大虞边陲江州'));
    assert.ok(r.text.includes('边关告急'));
    assert.ok(r.text.includes('各方势力'));
    assert.ok(r.text.includes('雨夜，你站在城门口'));
    const iDesc = r.text.indexOf('大虞边陲江州');
    const iScen = r.text.indexOf('边关告急');
    const iPers = r.text.indexOf('各方势力');
    const iMes = r.text.indexOf('雨夜，你站在城门口');
    assert.ok(iDesc < iScen && iScen < iPers && iPers < iMes, '四件套按 描述→场景→人格→开场白 排');
});

test('卡件各自截断到提案上限（v1 spend 同款），世界书条目不受此限', () => {
    const big = { ...CARD, description: '妖'.repeat(5000), first_mes: '雨'.repeat(3000) };
    const r = composeInitSource({ character: big });
    const descPart = r.text.split('\n').find((s) => s.startsWith('妖'));
    const mesPart = r.text.split('\n').find((s) => s.startsWith('雨'));
    assert.ok(Array.from(descPart).length <= INIT_PIECE_CAPS.description, '描述 spend ≤ 1200');
    assert.ok(Array.from(mesPart).length <= INIT_PIECE_CAPS.first_mes, '开场白 spend ≤ 400');
});

test('世界书条目全量不截断：长条目完整保留（v1 教训对齐：头截断砍名字密集段）', () => {
    const longContent = '妖'.repeat(3000) + '青面兽，盘踞枯井。' + '妖'.repeat(3000);
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [ENTRY('枯井', longContent)],
    });
    assert.ok(r.text.includes('青面兽，盘踞枯井。'), '条目深处的名号不被截断');
    assert.equal(r.truncated, false, '世界书不做预算裁剪');
});

test('世界书条目优先于卡件：条目在前，且带【键】前缀', () => {
    const r = composeInitSource({
        character: CARD,
        worldInfoEntries: [ENTRY('江州', '三面环山，一面临水，妖气盘踞。'), ENTRY('边关', '铁门紧闭。')],
    });
    assert.ok(r.text.startsWith('【江州】三面环山'));
    assert.ok(r.text.indexOf('【江州】') < r.text.indexOf('大虞边陲江州'), '条目排在卡件前');
    assert.equal(r.entryCount, 2);
});

test('尊重酒馆禁用标记：disable/enabled:false 条目不注入（v1 同款）', () => {
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [
            ENTRY('启用', '青面兽。'),
            { key: '禁用', content: '金算盘。', disable: true },
            { key: '停用', content: '白小娥。', enabled: false },
        ],
    });
    assert.ok(r.text.includes('【启用】'));
    assert.ok(!r.text.includes('金算盘') && !r.text.includes('白小娥'));
    assert.equal(r.entryCount, 1);
});

test('卡内置世界书双通道：character_book 顶层与 data.character_book（v1 ch.data?.character_book || ch.character_book）', () => {
    const cardTop = { ...CARD, character_book: { entries: [BOOK_ENTRY(1, '书内名号：青面兽。')] } };
    const rTop = composeInitSource({ character: cardTop });
    assert.ok(rTop.text.includes('【k1】书内名号：青面兽。'));

    const cardData = { ...CARD, data: { character_book: { entries: [BOOK_ENTRY(2, '书内名号：金算盘。')] } } };
    const rData = composeInitSource({ character: cardData });
    assert.ok(rData.text.includes('【k2】书内名号：金算盘。'));
});

test('双通道同内容去重：worldInfo 与 character_book 同键同文只记一次', () => {
    const card = { ...CARD, character_book: { entries: [{ key: '万法阁', content: '万法阁：藏经三千。' }] } };
    const r = composeInitSource({
        character: card,
        worldInfoEntries: [ENTRY('万法阁', '万法阁：藏经三千。')],
    });
    assert.equal((r.text.match(/万法阁：藏经三千。/g) || []).length, 1);
    assert.equal(r.entryCount, 1);
});

test('防御上限：仅超现实量级才裁剪（机制保留，正常世界书永不触发）', () => {
    const bigEntries = [];
    for (let i = 0; i < 300; i += 1) bigEntries.push({ key: `k${i}`, content: `条目${i}：` + '字'.repeat(200) });
    const r = composeInitSource({ character: null, worldInfoEntries: bigEntries });
    assert.equal(r.truncated, false); // 6 万字符世界书默认上限下全量
    assert.ok(r.usedChars > 50000);
    const tiny = composeInitSource({ character: CARD, worldInfoEntries: bigEntries, budget: 500 });
    assert.equal(tiny.truncated, true); // 注入极小防御上限验证机制仍在
    assert.ok(tiny.usedChars <= 500);
});

test('防御上限 0 / 负数：回退默认上限', () => {
    const r = composeInitSource({ character: CARD, budget: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.pieceCount, 4);
});

test('世界书条目全部禁用：ok=false 且 reason 指认禁用面', () => {
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [
            { key: 'a', content: '内容', disable: true },
            { key: 'b', content: '内容', enabled: false },
        ],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reason.includes('禁用'));
});

test('全空输入：ok=false（不产出空设定）', () => {
    const r = composeInitSource({});
    assert.equal(r.ok, false);
    assert.ok(r.reason);
    const r2 = composeInitSource({ character: { name: '无四件套' } });
    assert.equal(r2.ok, false);
});

test('确定性：同输入两次逐字节一致', () => {
    const input = { character: CARD, worldInfoEntries: [ENTRY('江州', '三面环山。'), ENTRY('边关', '铁门紧闭。')] };
    const a = composeInitSource(input);
    const b = composeInitSource(input);
    assert.deepEqual(a, b);
    assert.equal(a.text, b.text);
});
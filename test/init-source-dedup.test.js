// story-world-v2/test/init-source-dedup.test.js
// 第二十五棒 e（五）：**同一本书不许被读两遍**——初始化合订源的条目去重锁。
// 实机病案（用户实报"怎么变成 50 万字了，之前是 26 万"）：
//   卡内置 `character_book` 与 ST 挂载世界书经 `loadWorldInfo` 取回的是**同一本书**（466/468 条内容相同）。
//   ① `collectWorldInfoEntries` 把两路直接 push 到一起（**没按条目去重**，旧注释只说"候选世界名去重"）；
//   ② `normalizeEntry` 取主键时写成 `String(e.key ?? …)`，而 ST 形状里 `e.key` 是**数组**
//      （`["九宸玄陆","世界总纲",…]`）⇒ 变成一长串逗号连接 ⇒ 两路的行**不可能相同** ⇒ 去重交集 **0**。
//   ⇒ 同一本书被送进抽取两遍：**499,526 字符 / 424 条 / 顶到 50 万防御上限（truncated:true）**，白烧一半 token。
// 修后实测（真卡 + 真书）：**301,538 字符 / 228 条 / truncated:false**。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeInitSource, normalizeEntryKey } from '../src/init-source.js';

// ST 形状（实测）：卡内置 character_book 条目用**复数 keys**，世界书文件条目用**数组 key**
const cardBookEntry = { keys: ['万妖盟', '十万大山'], comment: '混乱之地·万妖盟', content: '- 吞天妖王 (男, T8大乘中期): 盟主。' };
const worldBookEntry = { key: ['万妖盟', '十万大山'], comment: '混乱之地·万妖盟', content: '- 吞天妖王 (男, T8大乘中期): 盟主。' };

test('leg25 e：主键取值必须处理数组——`key: []` 与 `keys: []` 同书必须归一到同一个键', () => {
    assert.equal(normalizeEntryKey(worldBookEntry), '万妖盟', '数组 key 取首元素（旧法 String(数组) ⇒ 一长串逗号）');
    assert.equal(normalizeEntryKey(cardBookEntry), '万妖盟', '复数 keys 同口径');
    assert.equal(normalizeEntryKey({ key: '单一键', content: 'x' }), '单一键', '字符串 key 原样');
    assert.equal(normalizeEntryKey({ uid: 7, content: 'x' }), '7', '退到 uid');
    assert.equal(normalizeEntryKey({ comment: '只有注释', content: 'x' }), '只有注释', '退到 comment');
});

test('leg25 e：同一本书两路来源（世界书文件 + 卡内置）⇒ 合订只算一份（本命回归锁）', () => {
    const entries = [worldBookEntry, { key: ['世界总纲'], comment: '世界总设定', content: '大荒世界。' }];
    const character = {
        name: '大荒z',
        description: '一个修真世界。',
        character_book: { entries: [cardBookEntry, { keys: ['世界总纲'], comment: '世界总设定', content: '大荒世界。' }] },
    };
    const r = composeInitSource({ character, worldInfoEntries: entries });
    assert.equal(r.ok, true);
    assert.equal(r.entryCount, 2, `★同一本书只算一份（实际 ${r.entryCount}——>2 就是又被读了两遍）`);
    assert.equal(r.text.split('【').length - 1, 2, '文本里每个条目只出现一次');
    assert.equal(r.truncated, false, '不到防御上限（旧案顶到 50 万）');
    assert.match(r.text, /吞天妖王/, '正文在');
});

test('leg25 e：两路内容**真不同**时不许误并（去重只并同一条，不吞不同条）', () => {
    const character = {
        name: 'X',
        description: '卡描述。',
        character_book: { entries: [{ keys: ['甲'], comment: '甲条', content: '甲的内容' }] },
    };
    const r = composeInitSource({ character, worldInfoEntries: [{ key: ['乙'], comment: '乙条', content: '乙的内容' }] });
    assert.equal(r.entryCount, 2, '不同条目各算一份');
    assert.match(r.text, /甲的内容/);
    assert.match(r.text, /乙的内容/);
});

test('leg25 e：禁用标记跳过 + 空内容条目不出现在合订源里', () => {
    const character = { name: 'X', description: '卡描述。' };
    const r = composeInitSource({
        character,
        worldInfoEntries: [
            { key: ['活'], content: '活条目' },
            { key: ['禁'], content: '禁条目', disable: true },
            { key: ['空'], content: '   ' },
        ],
    });
    assert.match(r.text, /活条目/);
    assert.doesNotMatch(r.text, /禁条目/, '禁用条目跳过（v1 同款）');
    assert.equal(r.entryCount, 1);
});

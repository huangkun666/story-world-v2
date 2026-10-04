// story-world-v2/test/abstract-confirmation.test.js
// Task 3（抽取确认与完整入账）的**真实数据流**回归：模型语义 vs 程序簿记。
//
// 依据（已批准，不再重复批准）：
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.1/§6.2/§6.3
//   · F:/deepseek/tmp/leg185-abstraction-sources/task-3-brief.md Step 1/3
//
// 本文件全部用**生产函数真跑**（sanitizeCanon / dedupeRoster / extractWorldSetting /
// seedBookEntities / seedBookRelations / tag-extract 的真入口），不写"被测逻辑的复制品"。
// 固定响应只证明**程序保存链**，不宣称模型识别质量（设计 §8 末条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeCanon, dedupeRoster, seedBookEntities, seedBookRelations,
    extractWorldSetting, verifyClaimedParent, computeContainmentParents,
} from '../src/abstract.js';
import { freezeAllowedSources, summarizeEvidence } from '../src/abstract-evidence.js';
import { createCache, bookFingerprint } from '../src/fp-hash.js';
import { extractMove } from '../src/extract.js';
import { resolveEntityName, resolveEntityIdentity } from '../src/entity-identity.js';

const blocksOf = (pairs) => pairs.map(([sourceId, text]) => ({ sourceId, text }));
const fixed = (payload, calls = null) => async (prompt) => {
    if (calls) calls.push(prompt);
    return JSON.stringify(payload);
};
const worldOf = (setting, { positions = ['未明'], entities = [] } = {}) => ({
    context: { tension: 0.5, positions, setting },
    entities: [...entities],
    weights: {},
});
// 小书夹具：真实生产链路（extractWorldSetting → setting → seedBookEntities）
async function runSmall({ text, blocks, payload, onEvidence = null, cache = null }) {
    const calls = [];
    const r = await extractWorldSetting({
        sourceText: text, extract: fixed(payload, calls), allowedSources: blocks, onEvidence, cache,
    });
    assert.equal(r.ok, true, `抽取应成功：${(r.errors || []).join('；')}`);
    return { r, calls };
}

// ---- F1/F2：正确归属在普通括注字段与部分成员名单之后仍然保留 -------------------------------
const SCI_TEXT = [
    '【科学团】科学团\n口号（为了明天）\n基地（地下）\n性格（沉稳）\n- 露娜（女，T3）：通信员。',
    '【月野兔】月野兔（水手月亮），所属势力：科学团。她是科学团的成员。',
].join('\n');
const SCI_BLOCKS = blocksOf([
    ['w1', '【科学团】科学团\n口号（为了明天）\n基地（地下）\n性格（沉稳）\n- 露娜（女，T3）：通信员。'],
    ['w2', '【月野兔】月野兔（水手月亮），所属势力：科学团。她是科学团的成员。'],
]);
const SCI_PAYLOAD = {
    bookEntities: [
        { name: '科学团', kind: 'faction', ev: { s: 'w1', q: '科学团\n口号（为了明天）' } },
        { name: '月野兔', kind: 'character', aliases: ['水手月亮'], parent: '科学团', ev: { s: 'w2', q: '月野兔（水手月亮），所属势力：科学团。' } },
    ],
};

test('Task3 F1/F2：普通括注字段与部分成员名单不得反驳正确归属（严格证据道）', async () => {
    const { r } = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload: SCI_PAYLOAD });
    const canon = r.setting.frozen.canon;
    assert.equal(r.evidence.policy, 'strict');
    const moon = canon.bookEntities.find((b) => b.name === '月野兔');
    assert.equal(moon.parent, '科学团', '正确归属必须保留（设计 §6.2：未列举不构成否定）');
    const world = worldOf(r.setting, { positions: ['未明'] });
    seedBookEntities(world);
    const ent = world.entities.find((e) => e.name === '月野兔');
    assert.equal(ent.parent, '科学团', '入账后归属仍在');
    assert.deepEqual(ent.aliases, ['水手月亮'], '已确认别名必须落到实体账');
    assert.equal(ent.parentSourceFrom, 'model-claim');
    assert.equal(r.setting.frozen.canon.bookEntities.some((b) => b.name === '月野兔' && b.parent === undefined), false);
});

test('Task3 F3：名字包含只作候选，不建立势力上下级、不折叠真势力', () => {
    const book = [{ name: '昆仑', kind: 'faction' }, { name: '昆仑道宫', kind: 'faction' }];
    const candidates = computeContainmentParents(book);
    assert.equal(candidates.get('昆仑道宫')?.parent, '昆仑', '候选解析仍可复述（历史出处值不许抹掉）');
    const world = worldOf({ frozen: { canon: { bookEntities: book } } });
    const r = seedBookEntities(world);
    assert.equal(world.entities.length, 2, '两个势力都必须独立入账（不许折叠掉真势力）');
    assert.equal(world.entities.find((e) => e.name === '昆仑道宫').parent, undefined, '名字包含不得建立 parent');
    assert.ok(r.warnings.some((x) => /候选/.test(x) && /昆仑道宫/.test(x)), `候选要留痕：${r.warnings.join('|')}`);
});

test('Task3 F4：缺类别不默认角色，保留为待核对候选并可见', async () => {
    const canon = sanitizeCanon({ bookEntities: [{ name: '月野兔', aliases: ['水手月亮'] }] }).canon;
    assert.equal(Object.hasOwn(canon.bookEntities[0], 'kind'), false, '缺类别不得补 character');
    const world = worldOf({ frozen: { canon: { bookEntities: canon.bookEntities } } });
    const r = seedBookEntities(world);
    assert.equal(r.seeded, 0, '未确认类别不得当角色入账');
    assert.equal(world.entities.length, 0);
    assert.equal(r.pendingKind, 1, '待核对候选必须计数（不许悄悄消失）');
    assert.ok(r.warnings.some((x) => /类别未确认|待核对/.test(x)), `候选要留痕：${r.warnings.join('|')}`);
    assert.deepEqual(r.pendingNames, ['月野兔']);
});

test('Task3 F5：别名走完 抽取→名册→实体→搜索/标签→关系端点', async () => {
    const { r } = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload: SCI_PAYLOAD });
    const world = worldOf(r.setting, { positions: ['未明'] });
    seedBookEntities(world);
    const moon = world.entities.find((e) => e.name === '月野兔');
    assert.deepEqual(moon.aliases, ['水手月亮']);
    // ① 实体解析（entity-lookup / 关系落账共用的同一把尺子）
    assert.equal(resolveEntityName(world.entities, '水手月亮')?.id, moon.id);
    assert.equal(resolveEntityName(world.entities, '月野兔')?.id, moon.id);
    assert.equal(resolveEntityIdentity(world.entities, '查无此人').status, 'unresolved');
    // ② 标签提取（tag-extract 的真口径：`extractMove` 读玩家那句话，走 ctx.entityNames 的名字/别名）
    const move = extractMove('我要用水手月亮的力量', { entityNames: world.entities });
    assert.equal(move.object, '月野兔', `标签应按别名认人：${JSON.stringify(move)}`);
    // ③ 关系端点（seedBookRelations）
    const rel = seedBookRelations(world, { edges: [{ from: '水手月亮', to: '科学团', type: '同伴' }] });
    assert.equal(rel.seeded, 1, `别名端点必须解析得出：${rel.dropped.join('|')}`);
});

test('Task3 F6：跨类别同名与共享别名都不得被自动合并', () => {
    const cross = dedupeRoster([
        { name: '月野兔', kind: 'character', aliases: ['水手月亮'] },
        { name: '水手月亮', kind: 'location' },
    ]);
    assert.equal(cross.length, 2, '不同类别的同名项不许并成一个实体');
    const shared = dedupeRoster([
        { name: '甲', kind: 'character', aliases: ['大人'] },
        { name: '乙', kind: 'character', aliases: ['大人'] },
    ]);
    assert.equal(shared.length, 2, '共享泛称不是同一实体的证据');
    const same = dedupeRoster([
        { name: '白小娥', kind: 'character', aliases: ['小娥'] },
        { name: '小娥', kind: 'character' },
    ]);
    assert.equal(same.length, 1, '同名/别名同类别仍要归一（既有能力不许弄丢）');
    const conflicts = [];
    dedupeRoster([
        { name: '月野兔', kind: 'character', parent: '科学团' },
        { name: '月野兔', kind: 'faction', parent: '黑暗王国' },
    ], { conflicts });
    assert.ok(conflicts.length, '冲突必须留诊断（不许静默先到先得）');
    // 同名但类别冲突 ⇒ 不许由书序裁决：摘掉类别，留作待核对候选
    const sameNameConflict = dedupeRoster([
        { name: '甲', kind: 'faction' },
        { name: '甲', kind: 'character' },
    ], { conflicts: [] });
    assert.equal(sameNameConflict.length, 1);
    assert.equal(sameNameConflict[0].kind, undefined, '类别冲突不得由书序决定（摘掉 ⇒ 待核对）');
});

// ---- 严格证据：允许来源编号 + 原话；未核实一律拒收并留原因 ------------------------------
test('Task3：严格证据道拒收缺出处/来源不在用料/原话对不上，并逐条留原因', async () => {
    const records = [];
    const payload = {
        bookEntities: [
            { name: '月野兔', kind: 'character', parent: '科学团' },                                  // 缺 ev
            { name: '露娜', kind: 'character', ev: { s: 'S9', q: '露娜' } },                            // 来源不在本次用料
            { name: '科学团', kind: 'character', ev: { s: 'w1', q: '书里根本没有的句子' } },            // 原话对不上
        ],
    };
    const { r } = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload, onEvidence: (x) => records.push(x) });
    const canon = r.setting.frozen.canon;
    for (const nm of ['月野兔', '露娜', '科学团']) {
        const b = canon.bookEntities.find((x) => x.name === nm);
        assert.ok(b, `${nm} 的名号仍应在册（待核对候选，不许消失）`);
        assert.equal(b.kind, undefined, `${nm} 的未核实类别不得成为世界事实`);
        assert.equal(b.parent, undefined, `${nm} 的未核实归属不得成为世界事实`);
    }
    const whys = records.map((x) => x.why);
    assert.ok(whys.some((w) => /缺来源|缺出处/.test(String(w))), `缺出处要留原因：${whys.join('|')}`);
    assert.ok(whys.some((w) => /来源不在本次用料/.test(String(w))), `来源越界要留原因：${whys.join('|')}`);
    assert.ok(whys.some((w) => /原话对不上/.test(String(w))), `原话对不上要留原因：${whys.join('|')}`);
    assert.ok(r.evidence.summary.dropped >= 3);
    // 名号本身没出现在材料里 ⇒ 连候选都不留（既有"纯编造名号照旧丢"的口径不变）
    const bogus = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload: { bookEntities: [{ name: '查无此人', kind: 'character' }] } });
    assert.equal(bogus.r.setting.frozen.canon.bookEntities.length, 0);
});

test('描述属性不再因引用不匹配而拒收，原始模型值完整保留', async () => {
    const records = [];
    const text = '【月野兔】月野兔，实力 T8大乘中期。';
    const blocks = blocksOf([['w1', text]]);
    const payload = {
        entities: [{
            name: '月野兔', kind: 'character',
            fields: { 实力: 'T8大乘中期', 身份: '编造的身份' },
            ev: { s: 'w1', q: '月野兔，实力 T8大乘中期。' },
        }],
    };
    const { r } = await runSmall({ text, blocks, payload, onEvidence: (x) => records.push(x) });
    const ent = r.setting.frozen.canon.settings.find((x) => x.name === '月野兔');
    assert.equal(ent.fields['实力'], 'T8大乘中期');
    assert.equal(ent.fields['身份'], '编造的身份', '按用户要求保留模型提交的描述，不冒充引用核验结论');
    assert.equal(records.some((x) => x.class === 'field' && x.action === 'drop'), false);
});

test('Task3：关系边必须带允许来源与原话，核不过丢并留原因；核过的照常收下', async () => {
    const records = [];
    const text = SCI_TEXT;
    const blocks = SCI_BLOCKS;
    const payload = {
        bookEntities: SCI_PAYLOAD.bookEntities,
        relations: [
            { from: '月野兔', to: '科学团', type: '成员', quote: '月野兔（水手月亮），所属势力：科学团。', s: 'w2' },
            { from: '露娜', to: '科学团', type: '成员', quote: '书里没有的句子', s: 'w1' },
            { from: '亚提密斯', to: '科学团', type: '成员', quote: '露娜（女，T3）：通信员。' },
        ],
    };
    const { r } = await runSmall({ text, blocks, payload, onEvidence: (x) => records.push(x) });
    const rels = r.setting.frozen.canon.relations || [];
    assert.equal(rels.length, 1, `只有核过的边能收下：${JSON.stringify(rels)}`);
    assert.equal(rels[0].from, '月野兔');
    // ★边上不挂常驻出处章（用户 2026-09-27 裁示）：名册里可以带 quote（抽取面），**落账后**的边只有
    //   `{id,from,to,type,tick}`（与 test/book-relations.test.js 同一把尺子）。
    const world = worldOf(r.setting, { positions: ['未明'] });
    seedBookEntities(world);
    const seededRel = seedBookRelations(world);
    assert.equal(seededRel.seeded, 1, `核过的边要落账：${seededRel.dropped.join('|')}`);
    const edge = world.relations[0];
    assert.deepEqual(Object.keys(edge).sort(), ['from', 'id', 'tick', 'to', 'type'], '边上不许有 quote/s/cause');
    const whys = records.filter((x) => x.class === 'relation').map((x) => x.why);
    assert.ok(whys.some((w) => /原话对不上/.test(String(w))), `对不上的边要留原因：${whys.join('|')}`);
    assert.ok(whys.some((w) => /缺来源编号/.test(String(w))), `缺来源编号要留原因：${whys.join('|')}`);
});

test('Task3：legacy（调用方未给允许来源）必须显式，且如实标未核验', async () => {
    const r = await extractWorldSetting({
        sourceText: SCI_TEXT,
        extract: fixed({ bookEntities: [{ name: '月野兔', kind: 'character', parent: '科学团' }] }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.evidence.policy, 'legacy');
    assert.ok(r.errors.some((x) => /未做来源核验/.test(x)), `legacy 必须自己说出来：${r.errors.join('|')}`);
    assert.equal(r.setting.frozen.canon.bookEntities.find((b) => b.name === '月野兔').kind, 'character');
});

// ---- 小书属性通道：单发一次调用里就要保住已确认属性 -----------------------------------------
test('Task3：小书单发路径必须保住已确认属性（同一次调用，不加轮数）', async () => {
    const text = '【月野兔】月野兔，实力 T8大乘中期，所属势力：科学团。\n【科学团】科学团\n口号（为了明天）';
    const blocks = blocksOf([
        ['w1', '【月野兔】月野兔，实力 T8大乘中期，所属势力：科学团。'],
        ['w2', '【科学团】科学团\n口号（为了明天）'],
    ]);
    const calls = [];
    const payload = {
        bookEntities: [
            { name: '月野兔', kind: 'character', parent: '科学团', fields: { 实力: 'T8大乘中期', 所属: '科学团' }, ev: { s: 'w1', q: '月野兔，实力 T8大乘中期，所属势力：科学团。' } },
            { name: '科学团', kind: 'faction', ev: { s: 'w2', q: '科学团\n口号（为了明天）' } },
        ],
    };
    const { r, calls: used } = await runSmall({ text, blocks, payload });
    assert.equal(used.length, 1, '小书仍是一次调用（不许加轮数）');
    assert.match(used[0], /"fields"/, '小书提示词必须把属性形状写出来（原缺口：单发提示词没有属性通道）');
    const moon = r.setting.frozen.canon.bookEntities.find((b) => b.name === '月野兔');
    assert.equal(moon.fields['实力'], 'T8大乘中期');
    const world = worldOf(r.setting, { positions: ['未明'] });
    seedBookEntities(world);
    assert.equal(world.entities.find((e) => e.name === '月野兔')['实力'], 'T8大乘中期');
});

// ---- 缓存：严格策略标记 + sourceDigest 才算命中；旧标记缺失必须 miss ------------------------
test('Task3：严格缓存只认「严格标记 + 同一份发射块 digest」，同文不同来源必 miss', async () => {
    const cache = createCache();
    const first = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload: SCI_PAYLOAD, cache });
    assert.equal(first.r.cached, false);
    const second = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload: SCI_PAYLOAD, cache });
    assert.equal(second.r.cached, true, '同一份允许来源 + 严格标记 ⇒ 命中');
    assert.equal(second.calls.length, 0, '命中缓存不得再发调用');
    // 同文本、不同来源 ID ⇒ 严格缓存必须 miss（归因不同）
    const otherIds = blocksOf(SCI_BLOCKS.map((b, i) => [`other-${i}`, b.text]));
    const third = await runSmall({ text: SCI_TEXT, blocks: otherIds, payload: SCI_PAYLOAD, cache });
    assert.equal(third.r.cached, false, '同文不同来源 ID 不得命中严格缓存');
    // 旧缓存条目（没有严格标记）⇒ miss，绝不推断成 legacy 免检
    const legacyCache = createCache();
    const fp = bookFingerprint(SCI_TEXT, []);
    legacyCache.set(fp, { canon: { bookEntities: [] }, tension: { polarity: '', direction: '' }, env: {} }, '2026-01-01T00:00:00.000Z');
    const fourth = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload: SCI_PAYLOAD, cache: legacyCache });
    assert.equal(fourth.r.cached, false, '缺严格标记的旧条目必须 miss');
});

// ---- 旧账兼容 / 幂等 / 不复活 / 规模原话不造人 ---------------------------------------------
test('Task3：旧世界与死账零扰动——不重建、不复活、不改旧出处章', () => {
    const entities = [
        { id: 'e_bk_1', kind: 'character', name: '月野兔', location: '未明', status: 'dead', parent: '昆仑', parentSource: '名字包含', parentSourceFrom: '名字包含@昆仑' },
    ];
    const world = worldOf({
        frozen: { canon: { bookEntities: [{ name: '月野兔', kind: 'character' }] } },
    }, { entities });
    const r = seedBookEntities(world);
    assert.equal(world.entities.length, 1, '已有实体（含 dead）不得重建');
    assert.equal(world.entities[0].status, 'dead', 'dead 不回魂');
    assert.equal(world.entities[0].parentSource, '名字包含', '历史出处值保留（旧世界照旧渲染）');
    assert.equal(r.seeded, 0);
    const again = seedBookEntities(world);
    assert.equal(again.seeded, 0);
    assert.equal(world.entities.length, 1);
});

test('Task3：老世界加载补缺只补别名空位——幂等、不重建、不覆盖已有别名', () => {
    const world = worldOf({
        frozen: { canon: { bookEntities: [{ name: '月野兔', kind: 'character', aliases: ['水手月亮'] }] } },
    }, { entities: [{ id: 'e_bk_1', kind: 'character', name: '月野兔', location: '未明' }] });
    const r = seedBookEntities(world);
    assert.equal(world.entities.length, 1, '不重建');
    assert.deepEqual(world.entities[0].aliases, ['水手月亮'], '老世界也能按别名查到人');
    assert.equal(r.seeded, 0);
    assert.equal(r.aliasesAttached, 1, '补缺计数可见');
    const again = seedBookEntities(world);
    assert.equal(again.aliasesAttached ?? 0, 0, '幂等：第二次零变化');
    assert.deepEqual(world.entities[0].aliases, ['水手月亮']);
});

// ---- 同一事实的多种排版：叙述 / 成员列表 / 表格；包裹题名只作候选 ---------------------------
test('Task3：同一归属在叙述、列表、表格三种排版下都走通；包裹题名只作待核对候选', async () => {
    const variants = [
        ['叙述', '【月野兔】月野兔是科学团的成员。', { name: '月野兔', kind: 'character', parent: '科学团', ev: { s: 'w2', q: '月野兔是科学团的成员。' } }],
        ['列表', '【月野兔】- 月野兔（女，T3）：科学团成员。', { name: '月野兔', kind: 'character', parent: '科学团', ev: { s: 'w2', q: '- 月野兔（女，T3）：科学团成员。' } }],
        ['表格', '【月野兔】| 月野兔 | 科学团 | 成员 |', { name: '月野兔', kind: 'character', parent: '科学团', ev: { s: 'w2', q: '| 月野兔 | 科学团 | 成员 |' } }],
    ];
    for (const [label, line, claim] of variants) {
        const text = ['【科学团】科学团', line].join('\n');
        const blocks = blocksOf([['w1', '【科学团】科学团'], ['w2', line]]);
        const payload = {
            bookEntities: [
                { name: '科学团', kind: 'faction', ev: { s: 'w1', q: '科学团' } },
                claim,
            ],
        };
        const { r } = await runSmall({ text, blocks, payload });
        const world = worldOf(r.setting, { positions: ['未明'] });
        seedBookEntities(world);
        assert.equal(world.entities.find((e) => e.name === '月野兔')?.parent, '科学团', `${label}排版下正确归属必须保留`);
    }
    // 包裹题名（作者题名面 / 控制器题名行）：**只作候选**——没有类别确认就不入账，也不建立归属
    const text = ['【科学团】科学团', '【月野兔】月野兔。'].join('\n');
    const blocks = blocksOf([['w1', '【科学团】科学团'], ['w2', '【月野兔】月野兔。']]);
    const payload = {
        bookEntities: [
            { name: '科学团', kind: 'faction', ev: { s: 'w1', q: '科学团' } },
            { name: '月野兔', aliases: ['水手月亮'], ev: { s: 'w2', q: '月野兔。' } },   // 题名候选：没给类别
        ],
    };
    const { r } = await runSmall({ text, blocks, payload });
    const moon = r.setting.frozen.canon.bookEntities.find((b) => b.name === '月野兔');
    assert.equal(Object.hasOwn(moon, 'kind'), false, '题名候选不许被补成角色');
    const world = worldOf(r.setting, { positions: ['未明'] });
    const seeded = seedBookEntities(world);
    assert.equal(seeded.pendingKind, 1, '题名候选留在待核对');
    assert.equal(world.entities.some((e) => e.name === '月野兔'), false, '未确认类别不入账');
});

test('Task3：规模原话照抄，绝不按「十人」发明成员', () => {
    const world = worldOf({
        frozen: { canon: { bookEntities: [{ name: '万妖盟', kind: 'faction', fields: { 规模: '十人' } }] } },
    });
    seedBookEntities(world);
    assert.equal(world.entities.length, 1, '规模文本不得变成实体');
    assert.equal(world.entities[0]['规模'], '十人', '规模保留原话');
});

test('Task3：合并冲突有诊断，不静默先到先得；未知类别与已知类别按兼容规则合', () => {
    const conflicts = [];
    const out = dedupeRoster([
        { name: '白小娥', kind: 'character', parent: '甲门', aliases: ['小娥'] },
        { name: '小娥', kind: 'character', parent: '乙门' },
    ], { conflicts });
    assert.equal(out.length, 1);
    // ★★★Task 3 复查（task-3-review.md ④；设计 §6.2「不能静默选择先到的值」）：同一身份两个上级
    //   = 明确矛盾 ⇒ 归属留空 + 冲突留诊断（旧断言要的是"先到者为正"——那正是被点名的口径）。
    assert.equal(out[0].parent, undefined, '明确矛盾的归属不选先到者');
    assert.ok(conflicts.some((c) => /parent/.test(String(c.field))), `归属冲突要留诊断：${JSON.stringify(conflicts)}`);
    const unknown = dedupeRoster([{ name: '月野兔' }, { name: '月野兔', kind: 'character' }]);
    assert.equal(unknown.length, 1, '待核对（缺类别）与已确认同名仍是同一实体');
    assert.equal(unknown[0].kind, 'character');
});

test('Task3：verifyClaimedParent 不再用成员名单反驳，也不把成员行当正面证据', () => {
    const entry = { name: '科学团', comment: '科学团', key: ['科学团'], content: '- 露娜（女，T3）：通信员。' };
    assert.equal(verifyClaimedParent({ name: '露娜', claimed: '科学团', memberEntry: entry }), 'unverifiable');
    assert.equal(verifyClaimedParent({ name: '月野兔', claimed: '科学团', memberEntry: entry }), 'unverifiable', '名单缺席不得反驳');
    assert.equal(verifyClaimedParent({ name: '露娜', claimed: '科学团', memberEntry: entry, bookDeclared: true }), 'tag', '合法作者声明仍可用');
    const explicit = { name: '月野兔', content: '月野兔，所属势力：科学团。' };
    assert.equal(verifyClaimedParent({ name: '月野兔', claimed: '科学团', ownEntry: explicit, memberEntry: entry }), 'explicit');
});

test('Task3：证据摘要可复述（计数与原因），明细只在调试面', async () => {
    const records = [];
    const payload = { bookEntities: [{ name: '月野兔', kind: 'character' }] };
    const { r } = await runSmall({ text: SCI_TEXT, blocks: SCI_BLOCKS, payload, onEvidence: (x) => records.push(x) });
    const sum = summarizeEvidence(records);
    assert.ok(sum.raw >= 1 && sum.dropped >= 1);
    assert.equal(r.evidence.summary.dropped, sum.dropped);
    assert.ok(!('quote' in (r.evidence.summary || {})), '摘要不带原话（明细走诊断面）');
});

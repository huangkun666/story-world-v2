// story-world-v2/test/integration-boundary-aliases.test.js
// ★★★Task 4（integration boundaries · 复审接口②）：**已确认别名完整保存 + 全部身份消费者**的真实数据流回归。
//
// 依据（全部已批准，不重复批准）：
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.3「不同名字的同一实体在名册到实体账
//     的转换中保留**全部**已确认叫法，相关搜索与实体解析使用相同的身份信息」/ §6.2（歧义不许合并）
//     / §9「别名完整保存」＋「**没有新增数值阈值或数量上限**」
//   · F:/deepseek/tmp/leg185-abstraction-sources/integration-boundary-probe-red.json（红：13 条只入账前 8 条、
//     31 字的完整别名被切到 30 字、且没有任何诊断）
//
// 纪律：全部走**生产函数**（`extractWorldSetting` → `dedupeRoster` → `seedBookEntities` →
//   `extractTags` / `entsSearchTextOf` / `selectEntityPage` / `runBatchLookup` / `seedBookRelations` /
//   `applySeedRoots`），不写"被测逻辑的复制品"；固定响应只证明程序保存链（设计 §8 末条）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractWorldSetting, dedupeRoster, seedBookEntities, seedBookRelations } from '../src/abstract.js';
import { extractTags } from '../src/tag-extract.js';
import { entsSearchTextOf, selectEntityPage } from '../src/render.js';
import { runBatchLookup } from '../src/entity-lookup.js';
import { resolveEntityIdentityWithCanon } from '../src/entity-identity.js';
import { applySeedRoots } from '../src/seed-roots.js';

const blocksOf = (pairs) => pairs.map(([sourceId, text]) => ({ sourceId, text }));
const worldOf = (setting, entities = []) => ({
    version: 1, context: { world: '本地', tension: 0.5, positions: ['未明'], playerId: 'player', setting },
    entities, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});

// 12 条普通已确认叫法 + 1 条 >30 字的完整叫法（= 复审红载荷：旧法只入账前 8 条、长的那条被截到 30 字）
const ALIASES = [...Array.from({ length: 12 }, (_, i) => `已确认别名${i}`),
    '这是一条超过三十个字符且已由原文确认的完整实体别名不能被截短丢失'];
const ALIAS_QUOTE = `陆青，别称${ALIASES.join('、')}。`;
const PARENT_QUOTE = '陆青出身甲宗。';
const FACTION_QUOTE = '甲门，别称甲宗。';
const BOOK_TEXT = `【人物】${ALIAS_QUOTE}\n${PARENT_QUOTE}\n【门派】${FACTION_QUOTE}`;

async function fullFlow() {
    const extract = async (prompt) => {
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });
        return JSON.stringify({
            bookEntities: [
                { name: '陆青', kind: 'character', aliases: ALIASES, parent: '甲宗', parentEv: { s: 'w1', q: PARENT_QUOTE }, ev: { s: 'w1', q: ALIAS_QUOTE } },
                { name: '甲门', kind: 'faction', aliases: ['甲宗'], ev: { s: 'w1', q: FACTION_QUOTE } },
            ],
            relations: [{ from: '陆青', to: '甲宗', type: '同门', ev: { s: 'w1', q: PARENT_QUOTE } }],
        });
    };
    const r = await extractWorldSetting({ sourceText: BOOK_TEXT, extract, allowedSources: blocksOf([['w1', BOOK_TEXT]]) });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const canon = r.setting.frozen.canon;
    // ① 名册层：一条都不许丢
    assert.deepEqual(canon.bookEntities.find((b) => b.name === '陆青').aliases, ALIASES,
        `★名册层就要完整（旧法 ` + '`sanitizeAliases` 截到 8 条 / 30 字）');
    // ② 去重层（`dedupeRoster` 本来就不截；这里钉住"别在别处又加一刀"）
    const deduped = dedupeRoster(canon.bookEntities);
    assert.deepEqual(deduped.find((b) => b.name === '陆青').aliases, ALIASES, '去重层不许丢叫法');
    // ③ 实体账：`seedBookEntities` 是唯一写 `entities[].aliases` 的地方
    const world = worldOf(r.setting);
    seedBookEntities(world);
    const lu = world.entities.find((e) => e.name === '陆青');
    assert.ok(lu, `陆青要入账：${JSON.stringify(world.entities)}`);
    assert.deepEqual(lu.aliases, ALIASES, `★实体账要保留全部 ${ALIASES.length} 条已确认叫法（含 >30 字那条）`);
    assert.equal(lu.aliases.at(-1), ALIASES.at(-1), '★超长完整别名原样保存，不许截短');
    return { r, world, lu };
}

test('Task4·别名完整保存：抽取→名册→去重→实体账一条不丢（>8 条、>30 字）', async () => {
    const { lu } = await fullFlow();
    assert.equal(lu.aliases.length, 13, `★13 条全在（旧法只留前 8 条）；实际 ${JSON.stringify(lu.aliases)}`);
});

test('Task4·身份消费者：搜索 / 标签 / 查书 / 归属 / 关系端点 / 起根当事人 全都能用别名认人', async () => {
    const { world, lu } = await fullFlow();
    const LONG = ALIASES.at(-1);

    // ① 搜索面（UI 实体页按别名搜得到）
    assert.match(entsSearchTextOf(lu), new RegExp(LONG.slice(0, 12)), '★搜索面必须含已确认别名');
    assert.deepEqual(selectEntityPage(world, { q: LONG }).rows.map((e) => e.id), [lu.id], '按别名搜索要查到人');

    // ② 标签路由（`extractTags` 走共用身份解析）
    //   ★★★leg199：**没有 ` ```tags ` 块 ⇒ 零收获** ⇒ 夹具必须包块（"只扫块里"这条口径）。
    const tags = extractTags(['```tags', `【行动】${LONG}｜修炼`, '```'].join('\n'), world);
    assert.equal(tags.actions[0]?.actorId, lu.id, `★标签用别名认人：${JSON.stringify(tags.unresolved)}`);

    // ③ 归属（`seedBookEntities` 的 canon 父级解析：别名写的上级归到正名）
    assert.equal(lu.parent, '甲门', '★归属走别名时要归到正名那一项');

    // ④ 关系端点（`seedBookRelations`：别名端点不再被提前丢）
    const rel = seedBookRelations(world);
    assert.equal(rel.seeded, 1, `★别名端点要能连边：${JSON.stringify(rel.dropped)}`);
    assert.equal(world.relations[0].from, lu.id);
    assert.equal(world.relations[0].to, world.entities.find((e) => e.name === '甲门').id);

    // ⑤ 查书（严格出处道：模型用**别名**回话也要对到人；证据只进诊断）
    const bookText = async () => [{ name: '人物条目', text: `${LONG}的境界为感气境。`, sourceId: 'entry-1' }];
    const transport = async () => JSON.stringify({ [LONG]: { 实力: { 文: '感气境', ev: { s: 'S1', q: `${LONG}的境界为感气境。` } } } });
    const looked = await runBatchLookup({ ssot: world, ids: [lu.id], transport, bookText, tick: 3 });
    assert.equal(looked.stats.ok, 1, `★别名回话要落到本人：${JSON.stringify(looked.stats)} / ${looked.warning}`);
    assert.equal(looked.ssot.entities.find((e) => e.id === lu.id)['实力'], '感气境');
    assert.equal(/"ev"|"quote"/.test(JSON.stringify(looked.ssot)), false, '★原始凭证不落世界账');

    // ⑥ 起根当事人（`applySeedRoots` 与上面五处同一把尺子）
    const rootWorld = { entities: [...world.entities], events: [], meta: { tick: 0 }, context: { playerId: 'player' } };
    const rooted = applySeedRoots(rootWorld, [{ title: '赴会', parties: [LONG], quote: '陆青赴会。' }]);
    assert.equal(rooted.seeded, 1, `★起根也要认得出别名当事人：${JSON.stringify(rooted.skippedParties)}`);
    assert.deepEqual(rootWorld.events[0].ripples, [lu.id]);
});

test('Task4·共享别名/跨类别同名仍是"歧义即未定"（不许先到先得、不许并成一个身份）', () => {
    const world = {
        entities: [
            { id: 'a', name: '甲', kind: 'character', aliases: ['大人'] },
            { id: 'b', name: '乙', kind: 'character', aliases: ['大人'] },
            { id: 'c', name: '甲', kind: 'faction' },
        ],
    };
    assert.equal(resolveEntityIdentityWithCanon(world.entities, [], '大人').status, 'ambiguous');
    assert.equal(resolveEntityIdentityWithCanon(world.entities, [], '甲').status, 'ambiguous', '跨类别同名也不许合并');
    // ★★★leg199：同样要包块（没有块 ⇒ 零收获，那时这条判据会变成空绿）
    const tags = extractTags(['```tags', '【行动】大人｜修炼', '```'].join('\n'), world);
    assert.equal(tags.count, 0, '共享别名 ⇒ 不归给先到者');
    assert.ok(tags.unresolved.some((u) => u.name === '大人'), '归不上要如实报数');
    const rootWorld = { entities: [...world.entities], events: [], meta: { tick: 0 }, context: { playerId: 'player' } };
    const r = applySeedRoots(rootWorld, [{ title: '赴会', parties: ['大人', '甲'], quote: '大人赴会。' }]);
    assert.equal(r.seeded, 0, '歧义当事人 ⇒ 这条根起不了（不猜）');
    assert.deepEqual(r.skippedParties.sort(), ['大人', '甲'].sort(), '歧义要如实留痕');
    assert.equal(rootWorld.events.length, 0);
});

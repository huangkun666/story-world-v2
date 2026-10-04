// story-world-v2/test/abstract-review-fixes2.test.js
// Task 3 **第二轮**复查（`F:/deepseek/tmp/leg185-abstraction-sources/task-3-fixes-review.md` 的 8 条
//   Important + 1 条 Minor）的**真实数据流**回归。
//
// 依据（全部已批准，不重复批准）：
//   · F:/deepseek/tmp/leg185-abstraction-sources/task-3-fixes-review.md（本轮要修的 8+1 条）
//   · F:/deepseek/tmp/leg185-abstraction-sources/task-3-fixes-reviewer-probe.mjs（独立红证据，逐字同款载荷）
//   · docs/superpowers/specs/2026-10-03-abstraction-sources-design.md §6.1/§6.2/§6.3
//
// 纪律（与上一轮同一把尺子，一条都不许松）：
//   ① 全部走**生产函数**（`extractWorldSetting` / `sanitizeCanon` / `dedupeRoster` / `seedBookEntities` /
//      `seedBookRelations` / `extractTags` / `applyLookup` / `verifyQuote`），不写"被测逻辑的复制品"；
//   ② 固定响应只证明**程序保存链**（哪些主张被收下/拒收、写成了什么形状），**不宣称模型识别质量**（设计 §8 末条）；
//   ③ 每条判据都对着**复审的原载荷**复现一次——旧实现必须红（红证据见报告与 `git stash` 对照）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    sanitizeCanon, dedupeRoster, seedBookEntities, seedBookRelations, extractWorldSetting, classifyBookEdge,
} from '../src/abstract.js';
import { freezeAllowedSources, verifyQuote, scopeForRows, materialRowsOf } from '../src/abstract-evidence.js';
import { extractTags } from '../src/tag-extract.js';
import {
    resolveEntityIdentityWithCanon, resolveEntityIdentityPreferred,
} from '../src/entity-identity.js';
import { applyLookup } from '../src/entity-lookup.js';
import { createCache } from '../src/fp-hash.js';
import { makeSnapshot } from '../src/snapshot.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const blocksOf = (pairs) => pairs.map(([sourceId, text]) => ({ sourceId, text }));
const fixed = (payload, calls = null) => async (prompt) => {
    if (calls) calls.push(prompt);
    return JSON.stringify(typeof payload === 'function' ? payload(prompt) : payload);
};
const worldOf = (setting, { positions = ['未明'], entities = [] } = {}) => ({
    version: 1,
    context: { world: '本地', tension: 0.5, positions, setting },
    entities: [...entities],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});
async function runSmall({ text, blocks, payload, onEvidence = null }) {
    const calls = [];
    const r = await extractWorldSetting({
        sourceText: text, extract: fixed(payload, calls), allowedSources: blocks, onEvidence,
    });
    assert.equal(r.ok, true, `抽取应成功：${(r.errors || []).join('；')}`);
    return { r, calls };
}
/** 从提示词里取出**本次真正交出去的书文**（提示词正文段的结尾就是它）。 */
const chunkOf = (prompt) => {
    const i = prompt.indexOf('———— 设定原文如下 ————');
    return i < 0 ? prompt : prompt.slice(i);
};
/** 大书分块用的填充行（形态与上一轮判据同一把尺子）。 */
const filler = (mark, n) => Array.from({ length: n }, (_, i) => `${mark}填充${i}：把书撑过大书分块下限。`).join('\n');
const permutations = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((rest) => [x, ...rest])));

// ══════════════════════════════════════════════════════════════════════════════
// ① 子串候选只作诊断：解析不出 ⇒ 归属留空、势力独立（不许把猜出来的名字写成事实）
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮①：名字包含只是候选——「海」不许被当成「海盟」写进归属，也不许折叠独立势力', async () => {
    // 复审原载荷（task-3-fixes-reviewer-probe.mjs 的 substringWorld/Seed）
    const text = '海盟是组织。主角效忠海。支队归海管辖。';
    const { r } = await runSmall({
        text, blocks: blocksOf([['w1', text]]),
        payload: {
            bookEntities: [
                { name: '海盟', kind: 'faction', ev: { s: 'w1', q: text } },
                { name: '主角', kind: 'character', parent: '海', ev: { s: 'w1', q: text } },
                { name: '支队', kind: 'faction', parent: '海', ev: { s: 'w1', q: text } },
            ],
        },
    });
    const canon = r.setting.frozen.canon;
    // ① canon 里那条主张**保持原样**（不许被归一成猜出来的「海盟」——那会把候选洗成事实）
    assert.equal(canon.bookEntities.find((b) => b.name === '主角')?.parent, '海',
        '模型写的是「海」就记「海」——不许替它改写成名册里的候选名');
    // ② 落账：归属空着（一个字的猜测都不写）
    const world = worldOf(r.setting);
    const seed = seedBookEntities(world);
    const zhu = world.entities.find((e) => e.name === '主角');
    const zhi = world.entities.find((e) => e.name === '支队');
    assert.ok(zhu && zhi, `两个名号都要入账：${JSON.stringify(world.entities)}`);
    assert.equal(zhu.parent, undefined, '解析不出上级 ⇒ 归属空着（旧实现写成「海盟」）');
    assert.equal(zhi.parent, undefined, '解析不出上级 ⇒ 势力**独立**入账');
    assert.equal(world.entities.find((e) => e.name === '海盟')?.branches, undefined,
        '独立势力不许被折进「海盟.branches」（旧实现 folded=1）');
    assert.equal(seed.folded, 0, '一条都不许折叠');
    assert.equal(seed.parentDemoted, 1, '弃归属要留痕');
    // ③ 候选照旧如实上报（诊断里说清"仅候选"）
    assert.ok(seed.warnings.some((w) => /仅候选/.test(w) && /海盟/.test(w)),
        `候选必须可观察：${JSON.stringify(seed.warnings)}`);

    // 正向对照：**已确认别名**写的上级照旧归一（不是"一律不解析"）
    const aliasText = '【主角】主角效忠海盟。海盟别称蓝潮会。';
    const alias = await runSmall({
        text: aliasText, blocks: blocksOf([['w1', aliasText]]),
        payload: {
            bookEntities: [
                { name: '海盟', kind: 'faction', aliases: ['蓝潮会'], ev: { s: 'w1', q: '海盟别称蓝潮会。' } },
                { name: '主角', kind: 'character', parent: '蓝潮会', ev: { s: 'w1', q: aliasText } },
            ],
        },
    });
    const w2 = worldOf(alias.r.setting);
    seedBookEntities(w2);
    assert.equal(w2.entities.find((e) => e.name === '主角')?.parent, '海盟', '已确认别名写的上级要归到正名');
});

// ══════════════════════════════════════════════════════════════════════════════
// ② 冲突墓碑：第三条相同行不许把摘掉的类别/归属/属性装回来（含顺序排列与真实跨块流程）
// ══════════════════════════════════════════════════════════════════════════════
const TRIPLE_TEXT = '青衣是旅人，也是组织名称。青衣属于甲门或乙门，是旅人或城主。甲门、乙门。';
const TRIPLE_ROWS = [
    { name: '青衣', kind: 'character', parent: '甲门', fields: { 身份: '旅人' }, ev: { s: 'w1', q: TRIPLE_TEXT } },
    { name: '青衣', kind: 'faction', parent: '乙门', fields: { 身份: '城主' }, ev: { s: 'w1', q: TRIPLE_TEXT } },
    { name: '青衣', kind: 'character', parent: '甲门', fields: { 身份: '旅人' }, ev: { s: 'w1', q: TRIPLE_TEXT } },
];

test('三行合并：类别/归属冲突仍待核对，描述属性保留双方且重复去重', async () => {
    for (const perm of permutations(TRIPLE_ROWS)) {
        const label = perm.map((x) => `${x.kind}/${x.parent}/${x.fields.身份}`).join(' → ');
        const { r } = await runSmall({
            text: TRIPLE_TEXT, blocks: blocksOf([['w1', TRIPLE_TEXT]]),
            payload: { bookEntities: perm.map((x) => ({ name: x.name, kind: x.kind, parent: x.parent, fields: x.fields, ev: x.ev })) },
        });
        const rows = r.setting.frozen.canon.bookEntities;
        assert.equal(rows.length, 1, `${label}：同名只留一条`);
        assert.equal(rows[0].kind, undefined, label);
        assert.equal(rows[0].parent, undefined, label);
        assert.deepEqual(rows[0].fields.身份.split('\n').sort(), ['城主', '旅人'], label);
        assert.ok(/冲突/.test(r.errors.join('|')), `${label}：矛盾必须留痕`);
        // 跨阶段：净化后的条目再进合并层，墓碑仍在（值不会被"缺什么补什么"重新填上）
        assert.deepEqual(dedupeRoster(rows, { conflicts: [] })[0], rows[0], `${label}：跨阶段保留属性，类别/归属不复活`);
        // 墓碑**不落账**：序列化（世界/缓存/快照走的那条路）之后仍是干净形状
        assert.deepEqual(JSON.parse(JSON.stringify(rows)), rows, `${label}：属性保留，墓碑不进持久层`);
        // 落账：类别未确认 ⇒ 不入账、可观察（不许默认角色）
        const world = worldOf(r.setting);
        const seed = seedBookEntities(world);
        assert.equal(world.entities.length, 0, `${label}：未确认类别不入账`);
        assert.equal(seed.pendingKind, 1, `${label}：待核对候选要可观察`);
    }
    // 纯合并层同一组（复审的 tripleDedupe 载荷）：直接喂三行也必须只留名号
    const dc = [];
    const out = dedupeRoster(TRIPLE_ROWS.map(({ ev, ...rest }) => rest), { conflicts: dc });
    assert.deepEqual(out, [{ name: '青衣', fields: { 身份: '旅人\n城主' } }], '描述属性保留，类别和归属不自动裁决');
    assert.equal(dc.length, 2, `仅类别与归属冲突留待核对：${JSON.stringify(dc)}`);
});

test('复查二轮②：真实跨块抽取→合并→落账——第三块重复第一块也不许复活矛盾值', async () => {
    const A_QUOTE = '青衣是角色，属于甲门。';
    const B_QUOTE = '青衣是势力，属于乙门。';
    // 分块纪律（与既有大书判据同一把尺子）：A 的原话在段首（第一块看得到），B/C 的原话在段尾
    //   （各自落在下一块里）——这样每一块都只交自己那一段的主张，且原话都在**本块**内可核。
    const A_TEXT = `【甲】${A_QUOTE}\n${filler('甲块线', 800)}`;
    const B_TEXT = `【乙】${filler('乙块线', 800)}\n${B_QUOTE}`;
    const C_TEXT = `【丙】${filler('丙块线', 800)}\n${A_QUOTE}`;
    const text = `${A_TEXT}\n${B_TEXT}\n${C_TEXT}`;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '甲条', text: A_TEXT },
        { sourceId: 'src-b', title: '乙条', text: B_TEXT },
        { sourceId: 'src-c', title: '丙条', text: C_TEXT },
    ];
    const extract = async (prompt) => {
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });   // 属性遍：不参与本组
        const chunk = chunkOf(prompt);
        if (chunk.includes('甲块线')) {
            return JSON.stringify({ bookEntities: [{ name: '青衣', kind: 'character', parent: '甲门', fields: { 身份: '旅人' }, ev: { s: 'src-a', q: A_QUOTE } }] });
        }
        if (chunk.includes('乙块线')) {
            return JSON.stringify({ bookEntities: [{ name: '青衣', kind: 'faction', parent: '乙门', fields: { 身份: '城主' }, ev: { s: 'src-b', q: B_QUOTE } }] });
        }
        // 第三块：**重复第一块**那一行（同一类别/归属/属性）——墓碑必须挡住它
        return JSON.stringify({ bookEntities: [{ name: '青衣', kind: 'character', parent: '甲门', fields: { 身份: '旅人' }, ev: { s: 'src-c', q: A_QUOTE } }] });
    };
    const records = [];
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks, onEvidence: (x) => records.push(x) });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const rows = r.setting.frozen.canon.bookEntities;
    assert.equal(rows.length, 1, `同名只留一条：${JSON.stringify(rows)}`);
    assert.deepEqual(rows[0], { name: '青衣', fields: { 身份: '旅人\n城主' } }, '跨块保留描述属性，类别和归属待核对');
    assert.ok(records.some((x) => /冲突/.test(String(x.why))), `冲突要留诊断：${JSON.stringify(records)}`);
    const world = worldOf(r.setting);
    const seed = seedBookEntities(world);
    assert.equal(world.entities.length, 0, '类别未确认 ⇒ 不落成角色');
    assert.equal(seed.pendingKind, 1, '待核对候选要可观察');
    assert.equal(seed.parentVerified || 0, 0, '一条归属都不许写');
});

// ══════════════════════════════════════════════════════════════════════════════
// ③ 组正名只看**本组自己的正名**（反向顺序的跨类别别名组不许被吞）
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮③：正名取"本组自己的正名"——[乙location, 甲char(alias乙)] 两个身份都要留住', () => {
    // 复审原载荷（reverse）
    const out = dedupeRoster([{ name: '乙', kind: 'location' }, { name: '甲', kind: 'character', aliases: ['乙'] }], { conflicts: [] });
    assert.equal(out.length, 2, `两个身份都要留住：${JSON.stringify(out)}`);
    assert.equal(out.find((x) => x.name === '乙')?.kind, 'location', '乙（本组正名）不许被降成别名');
    assert.equal(out.find((x) => x.name === '甲')?.kind, 'character', '甲（本组正名）不许被吞');
    assert.equal(out.filter((x) => x.name === '乙').length, 1, '不许产出两条同名的乙（旧实现实测两条都叫乙）');
    // 正序（上一轮已锁）：条数与正名都不许变
    const fwd = dedupeRoster([{ name: '甲', kind: 'character', aliases: ['乙'] }, { name: '乙', kind: 'location' }], { conflicts: [] });
    assert.deepEqual(fwd.map((x) => x.name).sort(), ['乙', '甲'], '顺序颠倒不改变身份集合');
});

test('复查二轮③：跨块抽取→落账——反向两条不许在种账时塌成一条', async () => {
    const A_QUOTE = '乙是地名。';
    const B_QUOTE = '甲是角色，别称乙。';
    const A_TEXT = `【乙】${A_QUOTE}\n${filler('乙线', 800)}`;
    const B_TEXT = `【甲】${filler('甲线', 800)}\n${B_QUOTE}`;
    const text = `${A_TEXT}\n${B_TEXT}`;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '乙条', text: A_TEXT },
        { sourceId: 'src-b', title: '甲条', text: B_TEXT },
    ];
    const extract = async (prompt) => {
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });
        const chunk = chunkOf(prompt);
        if (chunk.includes('乙线')) {
            return JSON.stringify({ bookEntities: [{ name: '乙', kind: 'location', ev: { s: 'src-a', q: A_QUOTE } }] });
        }
        if (chunk.includes('甲线')) {
            return JSON.stringify({ bookEntities: [{ name: '甲', kind: 'character', aliases: ['乙'], ev: { s: 'src-b', q: B_QUOTE } }] });
        }
        return JSON.stringify({ bookEntities: [] });
    };
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const rows = r.setting.frozen.canon.bookEntities;
    const names = rows.map((x) => x.name).sort();
    assert.deepEqual(names, ['乙', '甲'], `两个身份都要在册：${JSON.stringify(rows)}`);
    assert.equal(rows.find((x) => x.name === '乙')?.kind, 'location');
    assert.equal(rows.find((x) => x.name === '甲')?.kind, 'character');
    assert.equal(rows.filter((x) => x.name === '乙').length, 1, '不许出现两条同名的乙');
    const world = worldOf(r.setting);
    seedBookEntities(world);
    assert.ok(world.entities.some((e) => e.name === '甲' && e.kind === 'character'), '甲照常落入实体账（不许被跳过）');
    assert.equal(world.entities.filter((e) => e.name === '乙').length, 0, '乙是地名：不入实体池（既有口径）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ④ 一把尺子：标签 / 归属 / 查书 / 关系端点（正名优先 + 别名档并集后判唯一）
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮④：共用身份解析器——唯一正名压过别人的别名；同档并集后多命中即未定', () => {
    const ents = [
        { id: 'a', name: '小娥', kind: 'character' },
        { id: 'b', name: '白小娥', kind: 'character', aliases: ['小娥'] },
    ];
    assert.equal(resolveEntityIdentityWithCanon(ents, [], '小娥').id, 'a', '唯一正名压过别人的别名（leg89 口径）');
    assert.equal(resolveEntityIdentityPreferred(ents, '小娥').id, 'a', '无兜底形态同一结论');
    // 实体别名档 ∪ 名册兜底别名档：**先并再判唯一**（旧实现实体别名先命中就直接返回）
    const mixed = resolveEntityIdentityWithCanon(
        [{ id: 'a', name: '甲', aliases: ['先生'] }, { id: 'b', name: '乙' }],
        [{ name: '乙', aliases: ['先生'] }],
        '先生',
    );
    assert.equal(mixed.status, 'ambiguous', `两个来源的同档别名撞车 ⇒ 未定：${JSON.stringify(mixed)}`);
    // 名册正名在账上没有这个人 ⇒ 旧口径：归不上（不许把它当别人的别名认下来）
    assert.equal(resolveEntityIdentityWithCanon([], [{ name: '白小娥', aliases: ['小娥'] }, { name: '小娥' }], '小娥').status, 'unresolved');
});

test('复查二轮④：同一个名字在标签/关系/查书三处结论必须一致', () => {
    const entities = [
        { id: 'a', name: '小娥', kind: 'character' },
        { id: 'b', name: '白小娥', kind: 'character', aliases: ['小娥'] },
        { id: 'c', name: '甲', kind: 'character' },
    ];
    // ① 标签：唯一正名 ⇒ a（旧实现这条是对的）
    const tag = extractTags('【行动】小娥｜回话', { entities });
    assert.equal(tag.actions[0]?.actorId, 'a');
    // ② 关系端点：与标签**同一结论**（旧实现走"只认正名 ∪ 别名"的合体索引 ⇒ 判成歧义、丢掉这条边）
    const world = { context: { tension: 0.5, positions: ['未明'] }, entities, weights: {} };
    const rel = seedBookRelations(world, { edges: [{ from: '小娥', to: '甲', type: '盟友' }] });
    assert.equal(rel.seeded, 1, `关系端点要与标签同结论：${rel.dropped.join('|')}`);
    // ③ 查书回填：与标签**同一结论**（旧实现合并索引命中两个 ⇒ 丢弃 ⇒ 永远 pending）
    const looked = applyLookup({
        ssot: { entities: [{ ...entities[0] }, { ...entities[1] }, { ...entities[2] }], meta: {} },
        ids: ['a'], byName: { 小娥: { 实力: 'T9' } }, sources: { a: ['条目甲'] }, tick: 1,
    });
    assert.equal(looked.ssot.entities.find((e) => e.id === 'a')['实力'], 'T9',
        `查书回填要与标签同结论：${JSON.stringify(looked.stats)}`);
    assert.equal(looked.stats.ok, 1);
});

test('复查二轮④：混合来源别名（实体别名 vs 旧世界名册别名）⇒ 未定，不选先到者', () => {
    // 复审原载荷（mixedTag）：账上「甲」的别名「先生」与名册里「乙」的别名「先生」
    const mixed = extractTags('【行动】先生｜修炼', {
        entities: [{ id: 'a', name: '甲', aliases: ['先生'] }, { id: 'b', name: '乙' }],
        canon: [{ name: '乙', aliases: ['先生'] }],
    });
    assert.equal(mixed.actions.length, 0, `跨来源同档撞车 ⇒ 未定（旧实现归给了甲）：${JSON.stringify(mixed.actions)}`);
    assert.deepEqual(mixed.unresolved, [{ name: '先生', n: 1 }], '未定要如实报数');
    // 旧世界兼容：账上实体没有 aliases、别名只在名册里 ⇒ 仍要认得出
    const legacy = extractTags('【行动】水手月亮｜变身', {
        entities: [{ id: 'a', name: '月野兔' }],
        canon: [{ name: '月野兔', aliases: ['水手月亮'] }],
    });
    assert.equal(legacy.actions[0]?.actorId, 'a', '旧账只有名册别名时仍要认得出');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑤ 概念刻度：每个非空 `注` 也是照抄原文的取值（档位有效 ≠ 注可以编）
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮⑤：有效档位 + 编造的注 ⇒ 只丢注；注必须有它自己那份出处', async () => {
    const text = '【战力】T1 感气境：初入门径。T2 筑基境：气贯全身。';
    const { r } = await runSmall({
        text, blocks: blocksOf([['w1', text]]),
        payload: {
            ev: { s: 'w1', q: 'T1 感气境：初入门径。T2 筑基境：气贯全身。' },
            刻度: [{
                名: '修炼体系总纲',   // ★语义标签：不在原文里也允许（文件头纪律②）
                档位: ['T1|感气境', 'T2|编造修炼注释'],
                子表: [{ 名: '小境', 档位: ['T1|初入门径', 'T2|凭空捏造'] }],
            }],
        },
    });
    const table = r.setting.frozen.canon.刻度?.[0];
    assert.ok(table, `有出处的概念表要收：${JSON.stringify(r.errors)}`);
    assert.equal(table.名, '修炼体系总纲', '表名是语义标签，不要求字面出现在原文里');
    assert.deepEqual(table.档位, [{ 档: 'T1', 注: '感气境' }, { 档: 'T2' }],
        `编造的注要丢、有效档位要留：${JSON.stringify(table.档位)}`);
    assert.deepEqual(table.子表?.[0]?.档位, [{ 档: 'T1', 注: '初入门径' }, { 档: 'T2' }],
        `子档的注同一把尺子：${JSON.stringify(table.子表)}`);
    const errs = r.errors.join('|');
    assert.match(errs, /编造修炼注释/, `编造的注要如实留痕：${errs}`);
    assert.match(errs, /凭空捏造/, `子档编造的注也要留痕：${errs}`);
    // 正向对照：注真在所引原话里 ⇒ 原样保留
    const good = await runSmall({
        text, blocks: blocksOf([['w1', text]]),
        payload: { ev: { s: 'w1', q: 'T1 感气境：初入门径。' }, 刻度: [{ 名: '战力', 档位: ['T1|感气境'] }] },
    });
    assert.deepEqual(good.r.setting.frozen.canon.刻度?.[0]?.档位, [{ 档: 'T1', 注: '感气境' }], '有出处的注照旧保留');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ 独立事实的逐项出处：一句话设定 / 张力两格 / 环境四档（单发与大书分块都要）
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮⑥：society/techOrMagic/situation 与张力/环境各格可以各自带出处（单发）', async () => {
    const A = '诸国林立。';
    const B = '法术依靠灵气。';
    const C = '大势将变。';
    const text = `${A}\n${B}\n${C}`;
    const blocks = blocksOf([['w1', A], ['w2', B], ['w3', C]]);
    const { r } = await runSmall({
        text, blocks,
        payload: {
            society: { 文: A, ev: { s: 'w1', q: A } },
            techOrMagic: { 文: B, ev: { s: 'w2', q: B } },
            situation: { 文: C, ev: { s: 'w3', q: C } },
            tension: { polarity: { 文: '诸国', ev: { s: 'w1', q: A } }, direction: { 文: '将变', ev: { s: 'w3', q: C } } },
            env: { 民生度: { 文: '富足', ev: { s: 'w1', q: A } }, 动乱度: { 文: '大乱', ev: { s: 'w3', q: C } } },
        },
    });
    const canon = r.setting.frozen.canon;
    assert.equal(canon.society, A, `有真出处的 society 必须收（旧实现当"非字符串"丢）：${JSON.stringify(r.errors)}`);
    assert.equal(canon.techOrMagic, B, '有真出处的 techOrMagic 必须收');
    assert.equal(canon.situation, C, '有真出处的 situation 必须收');
    assert.equal(r.setting.dynamic.tension.polarity, '诸国', '张力极可以自带出处');
    assert.equal(r.setting.dynamic.tension.direction, '将变', '张力方向可以另用一条出处');
    assert.equal(r.setting.dynamic.env['民生度'], '富足', '环境档位可以自带出处');
    assert.equal(r.setting.dynamic.env['动乱度'], '大乱', '另一格可以用另一条出处');
    // 落账形状不变：仍是字符串/档位词（旧持久 schema 一个字不改）
    assert.equal(typeof canon.society, 'string');
    assert.equal(typeof r.setting.dynamic.env['民生度'], 'string');
    assert.equal(Object.prototype.hasOwnProperty.call(canon.society, 'ev'), false);
});

test('复查二轮⑥：错误/缺失的出处只拒收对应那一项，不牵连别的项', async () => {
    const A = '诸国林立。';
    const B = '法术依靠灵气。';
    const text = `${A}\n${B}`;
    const blocks = blocksOf([['w1', A], ['w2', B]]);
    const wrong = await runSmall({
        text, blocks,
        payload: {
            society: { 文: A, ev: { s: 'w2', q: A } },          // 编号指向 w2，而原话是 w1 的 ⇒ 这一项拒收
            techOrMagic: { 文: B, ev: { s: 'w2', q: B } },      // 正确 ⇒ 照收
        },
    });
    assert.equal(wrong.r.setting.frozen.canon.society, '', '出处对不上的那一项拒收');
    assert.equal(wrong.r.setting.frozen.canon.techOrMagic, B, '同一响应里别的项不受牵连');
    const missing = await runSmall({
        text, blocks,
        payload: {
            ev: { s: 'w2', q: B },                               // 顶层共用出处（旧口径的兜底）
            society: { 文: A },                                  // 自己没有 ev ⇒ 退回顶层出处，而 A 不在 B 里 ⇒ 这一项拒收
            techOrMagic: B,                                      // 字符串 + 顶层出处 ⇒ 收
        },
    });
    assert.equal(missing.r.setting.frozen.canon.society, '', '与共用出处对不上的项拒收');
    assert.equal(missing.r.setting.frozen.canon.techOrMagic, B, '字符串 + 顶层 ev 的旧口径仍要收');
});

test('复查二轮⑥：大书分块流程里，逐项出处按**本块作用域**核（不许借没见过的块）', async () => {
    const A = '诸国林立。';
    const B = '法术依靠灵气。';
    const C = '大势将变。';
    const A_TEXT = `${A}\n${filler('甲线', 700)}`;
    const B_TEXT = `${B}\n${filler('乙线', 700)}`;
    const C_TEXT = `${C}\n${filler('丙线', 700)}`;
    const text = `${A_TEXT}\n${B_TEXT}\n${C_TEXT}`;
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '甲条', text: A_TEXT },
        { sourceId: 'src-b', title: '乙条', text: B_TEXT },
        { sourceId: 'src-c', title: '丙条', text: C_TEXT },
    ];
    const extract = async (prompt) => {
        if (!prompt.includes('"bookEntities"')) return JSON.stringify({ entities: [] });
        const chunk = chunkOf(prompt);
        if (!chunk.includes('甲线')) return JSON.stringify({ bookEntities: [] });   // 只有含甲线的这一块说话
        assert.equal(chunk.includes('丙线'), false, '丙线不该与甲线同块（本组是分块判据）');
        return JSON.stringify({
            bookEntities: [],
            society: { 文: A, ev: { s: 'src-a', q: A } },
            techOrMagic: { 文: B, ev: { s: 'src-b', q: B } },
            situation: { 文: C, ev: { s: 'src-c', q: C } },     // ★丙条在**别的块**里 ⇒ 本块拒收
            env: { 民生度: { 文: '富足', ev: { s: 'src-a', q: A } }, 动乱度: { 文: '大乱', ev: { s: 'src-b', q: B } } },
        });
    };
    const r = await extractWorldSetting({ sourceText: text, extract, allowedSources: blocks });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const canon = r.setting.frozen.canon;
    assert.equal(canon.society, A, `本块里真有出处的要收：${JSON.stringify(r.errors)}`);
    assert.equal(canon.techOrMagic, B, '同一块里另一条来源的独立事实也要收');
    assert.equal(canon.situation, '', '引了**别块**的来源 ⇒ 这一项拒收（不许借没见过的材料）');
    assert.equal(r.setting.dynamic.env['民生度'], '富足');
    assert.equal(r.setting.dynamic.env['动乱度'], '大乱');
    assert.match(r.errors.join('|'), /不在本次展示的材料内|不在本次展示的片段内/, '拒收要留原因');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑦ 关系边：新账只留语义端点/类型；缓存/世界/快照里不许有原始凭证
// ══════════════════════════════════════════════════════════════════════════════
const REL_TEXT = '甲和乙是盟友。';
const REL_PAYLOAD = {
    bookEntities: [
        { name: '甲', kind: 'character', ev: { s: 'w1', q: REL_TEXT } },
        { name: '乙', kind: 'character', ev: { s: 'w1', q: REL_TEXT } },
    ],
    relations: [{ from: '甲', to: '乙', type: '盟友', ev: { s: 'w1', q: REL_TEXT } }],
};

test('复查二轮⑦：抽取→缓存→落账整条链上都没有原话/来源编号（旧账只读兼容）', async () => {
    const text = REL_TEXT;
    const blocks = blocksOf([['w1', text]]);
    const cache = createCache();
    const r = await extractWorldSetting({
        sourceText: text, extract: fixed(REL_PAYLOAD), allowedSources: blocks, cache, extractedAt: '2026-10-03T00:00:00.000Z',
    });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    const canon = r.setting.frozen.canon;
    assert.deepEqual(canon.relations, [{ from: '甲', to: '乙', type: '盟友' }],
        `新账关系边只留语义端点/类型（旧实现把 quote 一起写进 canon）：${JSON.stringify(canon.relations)}`);
    // 世界设置整体（会被持久化的那份）里一个字都不许出现
    const dumped = JSON.stringify(r.setting);
    assert.equal(dumped.includes(REL_TEXT), false, 'setting 里不许出现那句原话');
    for (const k of ['"quote"', '"ev"', '"sourceId"', '_swVerified']) {
        assert.equal(dumped.includes(k), false, `setting 里不许出现原始凭证键 ${k}`);
    }
    // 缓存信封里的 canon 同样干净（缓存 = 会被复用/落盘的那份抽取产物）
    const hit = cache.get(r.fingerprint);
    const cachedCanon = hit?.canon?.canon;                    // 缓存信封：entry.canon = {canon, tension, env}
    assert.ok(cachedCanon?.relations, `缓存要有这份产物：${JSON.stringify(hit)?.slice(0, 200)}`);
    assert.deepEqual(cachedCanon.relations, [{ from: '甲', to: '乙', type: '盟友' }], '缓存里也不许有原话');
    assert.equal(JSON.stringify(cachedCanon).includes(REL_TEXT), false, '缓存 canon 里不许出现原话');
    // 缓存复用那一次也要是同一形状
    const again = await extractWorldSetting({ sourceText: text, extract: fixed(REL_PAYLOAD), allowedSources: blocks, cache });
    assert.equal(again.cached, true);
    assert.deepEqual(again.setting.frozen.canon.relations, [{ from: '甲', to: '乙', type: '盟友' }]);
    // 落账：名号 → 实体 id，边上不带出处章
    const world = worldOf(r.setting);
    seedBookEntities(world);
    const seeded = seedBookRelations(world);
    assert.equal(seeded.seeded, 1, seeded.dropped.join('|'));
    assert.equal(world.relations[0].quote, undefined, '账上的边不许挂原话');
    assert.equal(Object.prototype.hasOwnProperty.call(world.relations[0], 'cause'), false, '书里的边没有 cause（leg141 口径）');
    // 契约：新形状（无 quote）必须过 SSOT schema
    const v = validate(world, ssotSchema);
    assert.equal(v.ok, true, `新形状必须过契约：${v.errors.join('; ')}`);
    // 快照边界：整份世界进快照，也不许夹带那句原话（快照就是会被写盘/回滚的那份）
    const snap = makeSnapshot({ world, id: 's1', tick: 0, kind: 'full', reason: '判据' });
    const snapDump = JSON.stringify(snap);
    assert.equal(snapDump.includes(REL_TEXT), false, '快照里不许出现那句原话');
    assert.equal(/"quote"|"ev"|"sourceId"/.test(snapDump), false, '快照里不许出现原始凭证键');
    // 旧账（带 quote 的世界）仍然合法、仍然读得出来（只读兼容）
    const legacy = worldOf(r.setting, { entities: [] });
    legacy.context.setting.frozen.canon.relations = [{ from: '甲', to: '乙', type: '盟友', quote: REL_TEXT }];
    legacy.entities = [
        { id: 'e1', kind: 'character', name: '甲', location: '未明' },
        { id: 'e2', kind: 'character', name: '乙', location: '未明' },
    ];
    const legacySeed = seedBookRelations(legacy);
    assert.equal(legacySeed.seeded, 1, `旧账照旧读得出来（只是不再写新凭证）：${legacySeed.dropped.join('|')}`);
    assert.equal(validate(legacy, ssotSchema).ok, true, '旧账（带 quote）不许变非法');
});

test('复查二轮⑦：关系边的形状契约是显式的——未核实的边不许自动当已核实收下', () => {
    assert.equal(classifyBookEdge({ from: '甲', to: '乙', type: '盟友' }), 'verified');
    assert.equal(classifyBookEdge({ from: '甲', to: '乙', type: '盟友', quote: '书里的话' }), 'legacy');
    assert.equal(classifyBookEdge({ from: '甲', to: '乙', type: '盟友', ev: { s: 'S1' } }), 'invalid',
        '只有来源编号、没有可核原话 ⇒ 未核实');
    assert.equal(classifyBookEdge({ from: '甲', to: '', type: '盟友' }), 'invalid');
    assert.equal(classifyBookEdge({ from: '甲', to: '甲', type: '盟友' }), 'invalid');
    const world = {
        context: { tension: 0.5, positions: ['未明'] },
        entities: [
            { id: 'e1', kind: 'character', name: '甲', location: '未明' },
            { id: 'e2', kind: 'character', name: '乙', location: '未明' },
        ],
        weights: {},
    };
    const unverified = seedBookRelations(world, { edges: [{ from: '甲', to: '乙', type: '盟友', ev: { s: 'S1' } }] });
    assert.equal(unverified.seeded, 0, '未核实的边不许落账');
    assert.ok(unverified.dropped.some((d) => /未核实/.test(d)), `要留痕：${JSON.stringify(unverified.dropped)}`);
    assert.equal(seedBookRelations(world, { edges: [{ from: '甲', to: '乙', type: '盟友', quote: '书里的话' }] }).seeded, 1,
        '旧账形状（带原话）只读兼容照旧收');
    assert.equal(seedBookRelations(world, { edges: [{ from: '甲', to: '乙', type: '盟友' }] }).seeded, 0,
        '同一条边已经种过 ⇒ 幂等（不发新号）');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑧ 作用域：被裁过的一小段必须**逐字**核（不许扩回整行、不许首次匹配）
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮⑧：spanText 只展示了「甲」⇒ 不许引同一行的「乙有秘密。」', () => {
    const frozen = freezeAllowedSources([{ sourceId: 'a', text: '甲。乙有秘密。' }]);
    // 复审原载荷（clipped）
    const clipped = verifyQuote(frozen, { ev: { s: 'S1', q: '乙有秘密。' }, spanText: '甲' });
    assert.equal(clipped.ok, false, `只展示了「甲」⇒ 同行的另一半不算展示过：${JSON.stringify(clipped)}`);
    assert.match(String(clipped.why), /片段/);
    // 正向：真展示了那半句 ⇒ 照收
    assert.equal(verifyQuote(frozen, { ev: { s: 'S1', q: '乙有秘密。' }, spanText: '乙有秘密。' }).ok, true);
    // 重复对齐**保守取交集**：同一小段在两块里各有一份 ⇒ 交不出共同片段 ⇒ 一律拒收（不许首次匹配）
    const dup = freezeAllowedSources([
        { sourceId: 'a', text: '甲。乙有秘密。' },
        { sourceId: 'b', text: '甲。丙有隐情。' },
    ]);
    assert.equal(verifyQuote(dup, { ev: { s: 'S1', q: '甲' }, spanText: '甲' }).ok, false,
        '同一段文字落在两处不同来源 ⇒ 本次不认（旧的首次匹配会放行）');
    // 作用域算不出来（材料与允许来源对不上）⇒ 拒收，不许静默退回"块内存在性"
    assert.equal(verifyQuote(dup, { ev: { s: 'S1', q: '乙有秘密。' }, spanText: '完全不相干的材料' }).ok, false);
});

test('复查二轮⑧：真实分块流程里，孩子只见了第一行 ⇒ 同块第二行的原话核不过', () => {
    const lineA = '甲。';
    const lineB = '乙有秘密。';
    const text = `${lineA}\n${lineB}`;
    const frozen = freezeAllowedSources([{ sourceId: 'a', text }]);
    const rows = materialRowsOf(text);
    const first = scopeForRows(frozen, { text, rows, indexes: [0] });          // 本次只展示了第一行
    const second = scopeForRows(frozen, { text, rows, indexes: [1] });
    assert.equal(verifyQuote(frozen, { ev: { s: 'S1', q: lineB }, scope: first, cls: 'kind' }).ok, false,
        '只见第一行的调用不许引第二行的原话');
    assert.equal(verifyQuote(frozen, { ev: { s: 'S1', q: lineB }, scope: second, cls: 'kind' }).ok, true,
        '见了第二行的调用照旧能引');
});

// ══════════════════════════════════════════════════════════════════════════════
// Minor：拆半递归必须留住**模式**（设定遍/属性遍的提示词）与子块自己的来源清单
// ══════════════════════════════════════════════════════════════════════════════
test('复查二轮 Minor：设定遍的块失败拆半后，子块仍是设定遍提示词 + 自己的来源清单', async () => {
    const MARK_A1 = '甲角前半记号『设定甲』';
    const MARK_A2 = '甲角后半记号『设定甲二』';
    const MARK_B = '乙角独有记号『设定乙』';
    // 第一块 = 甲半（含两条记号）；第二块从乙半开始 ⇒ 父块的来源清单是 S1+S2，而前半子块只见 S1。
    const rowsA = [MARK_A1, ...Array.from({ length: 1199 }, (_, i) => `甲线填充${i}：把书撑过拆半下限。`), MARK_A2];
    const rowsB = [...Array.from({ length: 700 }, (_, i) => `乙线填充${i}：把书撑过拆半下限。`), MARK_B];
    const rowsC = Array.from({ length: 900 }, (_, i) => `丙线填充${i}：第三块只为把书撑过大书下限。`);
    const textA = rowsA.join('\n');
    const textB = rowsB.join('\n');
    const textC = rowsC.join('\n');
    const text = [textA, textB, textC].join('\n');
    assert.ok(Array.from(text).length > 30000, '这一组要真的进大书分块路径');
    const blocks = [
        { sourceId: 'src-a', title: '甲半', text: textA },
        { sourceId: 'src-b', title: '乙半', text: textB },
        { sourceId: 'src-c', title: '丙半', text: textC },
    ];
    const prompts = [];
    let failedOnce = false;
    const extract = async (prompt) => {
        prompts.push(prompt);
        const chunk = chunkOf(prompt);
        // 只让"含整段甲半（两条记号）"的那一次失败 —— 非 JSON 会走拆半（不是超时/传输错）
        if (!failedOnce && chunk.includes(MARK_A1) && chunk.includes(MARK_A2)) { failedOnce = true; return '这不是 JSON'; }
        return JSON.stringify(chunk.includes(MARK_A1)
            ? { society: { 文: MARK_A1, ev: { s: 'S1', q: MARK_A1 } } } : {});
    };
    const r = await extractWorldSetting({
        sourceText: text, extract, allowedSources: blocks, evidencePolicy: 'strict', skipRoster: true,
    });
    assert.equal(r.ok, true, (r.errors || []).join('；'));
    assert.equal(failedOnce, true, '拆半那条路真的跑了');
    // 父块：甲半整段 + 乙半的开头几行 ⇒ 来源清单 S1+S2（S2 有交集）
    const parent = prompts.find((p) => chunkOf(p).includes(MARK_A1) && chunkOf(p).includes(MARK_A2));
    assert.ok(parent, '父块那次调用必须真的发生过（它是失败的那一次）');
    assert.match(parent, /S1 = 甲半/);
    assert.match(parent, /S2 = 乙半/);
    // 前半子块：只含甲半的开头 ⇒ 模式不变（仍是设定遍）、来源清单只列 S1（自己见到的那条）
    const childA = prompts.find((p) => p !== parent && chunkOf(p).includes(MARK_A1) && !chunkOf(p).includes(MARK_A2));
    assert.ok(childA, `拆半后的前半子块必须真的发过：${prompts.length} 次调用`);
    assert.match(childA, /本遍只抽"设定"/, '子块必须还是**设定遍**的提示词（旧实现把 buildPrompt 丢了，退回名册遍）');
    assert.equal(childA.includes('"bookEntities"'), false, '子块不许出现名册遍的形状');
    assert.match(childA, /S1 = 甲半/, '子块要列自己见到的那条来源');
    assert.equal(/S2 = 乙半/.test(childA), false, '子块不许再列父块见过、而自己没见的来源（旧实现闭包了父块作用域）');
});

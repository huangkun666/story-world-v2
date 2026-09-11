// story-world-v2/test/seed-full.test.js
// K43（full-roster-lens-spec C1/C7/C8 拍板）：全量棋盘入账 + 势力净化折叠 + 初始权重预填。
// 判据 A-1/A-2 的测试面：无席位截断 / location 不入池 / parent 折叠进 branches（链顶解析）/
// 弃关系防御（缺失/环/目标非势力）/ character parent 解析 / 幂等重跑 / 权重全覆盖与公式一致。
// leg25 c 追加（用户令「删」四维浮点）：本文件同时是"入账**不预填任何数值**"的锁面——账上连 `attrs` 键
//   都不许有（旧法按 kind 预填四维默认值 0.15/0.25），名册里的内容也不许流进实体；形状必须过 schema。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedBookEntities, powerFromNameContext, sanitizeBookFields, verifyClaimedParent, buildOrgRosterMap, factionScaleFromEntry } from '../src/abstract.js';
import { computeWeight } from '../src/weight.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

function mkWorld(bookEntities, { tension = 0.5, entities = [], weights = {}, positions = ['中央'] } = {}) {
    return {
        context: { tension, positions, setting: { frozen: { canon: { bookEntities } } } },
        entities: [...entities],
        weights: { ...weights },
    };
}

test('leg21: 名册所在优先入账——书内明述的 location 随实体，无则落位置集首个/中立兜底', () => {
    const book = [
        { name: '昆仑道宫', kind: 'faction', location: '昆仑山' },
        { name: '散修甲', kind: 'character' },
    ];
    // leg25 D 组：名册所在必须 ∈ 位置集，否则落兜底词——所以夹具的位置集要含那个地名
    //（真实链路上位置集由 web 侧 derivePositions 按同一本书的地名建好，不会误杀）。
    const w = mkWorld(book, { positions: ['中央', '昆仑山'] });
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 2);
    assert.equal(w.entities.find((e) => e.name === '昆仑道宫').location, '昆仑山', '名册所在优先');
    assert.equal(w.entities.find((e) => e.name === '散修甲').location, '中央', '无所在 → 位置集首个（测试夹具自设）');
    const w2 = mkWorld(book, { positions: ['中央', '昆仑山'] });
    w2.context.positions = [];
    const r2 = seedBookEntities(w2);
    assert.equal(r2.seeded, 2);
    assert.equal(w2.entities.find((e) => e.name === '散修甲').location, '未明', '无位置集 → 中立词「未明」');
});

test('K43: 全量入账无席位截断——角色+独立势力全部入账，location 不入池', () => {
    const book = [
        { name: '人族', kind: 'faction' }, { name: '妖族', kind: 'faction' },
        { name: '中天神洲', kind: 'location' }, { name: '十万大山', kind: 'location' },
        { name: '虞昭华', kind: 'character' }, { name: '秦红袖', kind: 'character' },
        { name: '龙素心', kind: 'character' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 5);                       // 2 势力 + 3 角色
    assert.equal(r.skippedLocation, 2);
    assert.equal(r.folded, 0);
    assert.equal(r.warnings.length, 0);
    assert.equal(w.entities.length, 5);
    assert.ok(!w.entities.some((e) => e.name === '中天神洲' || e.name === '十万大山'));
    assert.deepEqual(w.entities.map((e) => e.kind).sort(), ['character', 'character', 'character', 'faction', 'faction']);
});

test('K43: 子势力折叠——parent 名号不独立入账，归并进链顶实体 branches', () => {
    const book = [
        { name: '妖族', kind: 'faction' },
        { name: '万妖盟', kind: 'faction', parent: '妖族' },
        { name: '妖师宫', kind: 'faction', parent: '万妖盟' },   // 深链：解析到顶=妖族
        { name: '青丘国', kind: 'faction', parent: '妖族' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 1);                        // 只有链顶 妖族 独立入账
    assert.equal(r.folded, 3);
    const top = w.entities.find((e) => e.name === '妖族');
    assert.ok(top);
    assert.deepEqual([...top.branches].sort(), ['万妖盟', '妖师宫', '青丘国'].sort());   // 子名号全部平铺挂账
    assert.equal(w.entities.length, 1);
});

test('K43: 折叠防御——parent 缺失/自指/成环/目标非势力 → 弃关系+警告，名号仍独立入账', () => {
    const book = [
        { name: '大虞', kind: 'faction' },
        { name: '孤军', kind: 'faction', parent: '不存在的上级' },   // 缺失
        { name: '自指宗', kind: 'faction', parent: '自指宗' },       // 自指
        { name: '甲盟', kind: 'faction', parent: '乙盟' },           // 环（互为父）
        { name: '乙盟', kind: 'faction', parent: '甲盟' },
        { name: '挂名帮', kind: 'faction', parent: '虞昭华' },       // 目标非势力（是角色）
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(r.folded, 0);
    // 6 个势力全部独立入账（5 个防御弃关系 + 大虞），警告 5 条
    assert.equal(w.entities.length, 6);
    assert.equal(r.warnings.length, 5);
    for (const e of w.entities) assert.equal(e.branches, undefined);
});

test('K43: 角色 parent 解析——合法所属写实体.parent；非法弃关系+警告，角色照常入账', () => {
    const book = [
        { name: '万法阁', kind: 'faction' },
        { name: '清玄真人', kind: 'character', parent: '万法阁' },
        { name: '散修甲', kind: 'character', parent: '不存在的门派' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(w.entities.length, 3);
    const cleric = w.entities.find((e) => e.name === '清玄真人');
    assert.equal(cleric.parent, '万法阁');
    assert.equal(w.entities.find((e) => e.name === '散修甲').parent, undefined);
    assert.equal(r.warnings.length, 1);
});

// ============ 第二十五棒 e：照 v1 把「势力↔角色」在初始化就建好（用户实机：parent 0/623）============
// 设计依据（八本真实世界书泛用性审计 + 细案 docs/spec-parent-affiliation.md §2/§4）：
//   模型负责**语义判别**（哪行是花名册），结构负责**验伪**（书里有没有这条关系的书面依据）。
//   三态语义：有正面证据→认；有花名册但列不出该名号→**反驳**（弃关系）；根本没有花名册→**未验证**（落账但如实标注）。
//   ——最后一态是硬规矩要求的：**绝不用空值反推"没有"**。

test('leg25 e：角色「所属」从成员行落到 parent（真书形态：势力条目正文列成员行）', () => {
    const book = [
        {
            name: '混乱之地·万妖盟',
            kind: 'faction',
            key: ['万妖盟', '十万大山'],
            content: '混乱之地·万妖盟\n- 吞天妖王 (男, T8大乘中期): 现任盟主(饕餮蛟龙混血)。\n- 混元妖圣 (男, T9渡劫初期): 前任盟主。',
            fields: { 规模: '万妖之众' },
        },
        { name: '吞天妖王', kind: 'character', fields: { 所属: '混乱之地·万妖盟', 实力: 'T8大乘中期' } },
        { name: '混元妖圣', kind: 'character', fields: { 所属: '混乱之地·万妖盟', 实力: 'T9渡劫初期' } },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    const yao = w.entities.find((e) => e.name === '吞天妖王');
    assert.equal(yao.parent, '混乱之地·万妖盟', '★所属写进实体.parent（v1 的 affiliation 效果）');
    assert.equal(yao['实力'], 'T8大乘中期', '★档位原话照抄成文本（引擎不换算成数）');
    assert.equal(yao.parentSourceFrom, 'member-line', '证据来源可审计：命中该组织的成员行');
    assert.equal(w.entities.find((e) => e.name === '混元妖圣').parent, '混乱之地·万妖盟');
    assert.equal(w.entities.find((e) => e.name === '混乱之地·万妖盟')['规模'], '万妖之众', '势力规模原话照抄（≠角色档位）');
    assert.equal(r.parentVerified, 2);
    assert.equal(r.fieldsAttached >= 3, true, `字段落账计数可见：${r.fieldsAttached}`);
});

test('leg25 e 变异锁：模型声称的所属若被书里证据**反驳**（有花名册却列不出他）→ 弃关系 + 警告', () => {
    const book = [
        { name: '昆仑道宫', kind: 'faction', content: '- 清玄真人 (男, T7合体中期): 掌教。', key: ['昆仑道宫'] },
        { name: '清玄真人', kind: 'character' },
        // 模型编的：他并不在这份花名册里
        { name: '散修甲', kind: 'character', parent: '昆仑道宫' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    assert.equal(w.entities.find((e) => e.name === '清玄真人').parent, '昆仑道宫', '花名册里有的照常认');
    assert.equal(w.entities.find((e) => e.name === '散修甲').parent, undefined, '★被反驳的归属必须弃掉（不许错填）');
    assert.equal(r.parentDemoted, 1);
    assert.ok(r.warnings.some((x) => /被书里证据反驳/.test(x)), `弃关系要留痕：${r.warnings.join('|')}`);
});

test('leg25 e：组织条目**没有花名册**时不许反推"不属于"——落账但如实标成未验证', () => {
    const book = [
        { name: '万法阁', kind: 'faction' },                       // 光杆条目：无成员行、无 key
        { name: '清玄真人', kind: 'character', parent: '万法阁' },
    ];
    const w = mkWorld(book);
    const r = seedBookEntities(w);
    const e = w.entities.find((x) => x.name === '清玄真人');
    assert.equal(e.parent, '万法阁', '无册 ≠ 不存在（硬规矩：不许用空值反推）');
    assert.equal(e.parentSource, '模型抽取(未验证)', '但要如实标注"未验证"，不冒充书里明述');
    assert.equal(e.parentSourceFrom, 'unverifiable');
    assert.equal(r.parentDemoted ?? 0, 0, '这一态不弃关系');
});

test('leg25 e：属性只收文本——数字/数组/空串一律不收（书里的说法不许换算成数）', () => {
    const book = [
        { name: '甲', kind: 'character', fields: { 实力: 123, 身份: '', 定位: ['一方诸侯'], 所属: '  乙  ' } },
    ];
    const w = mkWorld(book);
    seedBookEntities(w);
    const e = w.entities.find((x) => x.name === '甲');
    assert.equal(e['实力'], undefined, '数字不进账（实力只能是书里的文本原话）');
    assert.equal(e['身份'], undefined, '空串不入账');
    assert.equal(e['定位'], undefined, '数组不入账');
});

test('leg25 e：零 token 档位兜底 powerFromNameContext——只认紧贴名号的标签、词表用本书自己的档位名', () => {
    const text = '名录：\n- 吞天妖王 (男, T8大乘中期): 现任盟主。\n- 清玄真人 (男, 合体中期): 掌教。\n- 路人甲（无标签）。';
    assert.equal(powerFromNameContext(text, '吞天妖王', []), 'T8大乘中期', 'T 系标签自带识别');
    assert.equal(powerFromNameContext(text, '清玄真人', ['大乘', '合体', '金丹']), '合体中期', '词表命中本书档位名');
    assert.equal(powerFromNameContext(text, '清玄真人', []), '', '词表为空且非 T 系 → 不认（绝不猜）');
    assert.equal(powerFromNameContext(text, '路人甲', ['合体']), '', '没有标签就空着');
});

test('leg25 e 变异锁①：验伪闸真的在**分辨**——同一份书里，有证据的进、被反驳的挡', () => {
    // 这份夹具只用**真导出函数**（不许自带被测逻辑的复制品——否则摘掉闸测试照样绿，等于没测）。
    const entry = { name: '混乱之地·万妖盟', comment: '混乱之地·万妖盟', key: ['万妖盟'], content: '- 吞天妖王 (男, T8大乘中期): 现任盟主。' };
    const map = buildOrgRosterMap([entry]);
    assert.equal(map.get('混乱之地·万妖盟').has('吞天妖王'), true, '成员行确实被索引到');
    assert.equal(map.get('混乱之地·万妖盟').has('清玄真人'), false, '不在花名册的人不在索引里');
    // 有册：在册 → 认；不在册 → **反驳**（这是弃关系的唯一合法理由）
    assert.equal(verifyClaimedParent({ name: '吞天妖王', claimed: '混乱之地·万妖盟', orgRosterMap: map, memberEntry: entry }), 'member-line');
    assert.equal(verifyClaimedParent({ name: '清玄真人', claimed: '混乱之地·万妖盟', orgRosterMap: map, memberEntry: entry }), 'refuted');
    // 无册：既不是认也不是反驳 → 未验证（硬规矩：不许用空值反推）
    assert.equal(verifyClaimedParent({ name: '清玄真人', claimed: '光杆门派', orgRosterMap: map, memberEntry: { name: '光杆门派', comment: '光杆门派', content: '' } }), 'unverifiable');
    // 书标签声明的上级：标签本身就是书的明述 → 'tag'（不因无花名册被反驳）
    assert.equal(verifyClaimedParent({ name: '界渊长城', claimed: '渡虚帝', orgRosterMap: map, memberEntry: { name: '渡虚帝', comment: '渡虚帝' }, bookDeclared: true }), 'tag');
});

test('leg25 e：势力「规模」零 token 兜底——照抄书自己的势力标签/底蕴行，绝不引擎自造', () => {
    // 真书形态（实测用户书 96 个势力条目里 48 个是这种）：`[势力: 万妖盟 (混乱绞肉机/妖修大本营)]`
    assert.equal(factionScaleFromEntry('[势力: 万妖盟 (混乱绞肉机/妖修大本营)]\n- 吞天妖王 (男, T8大乘中期): 盟主。', '万妖盟'), '混乱绞肉机/妖修大本营');
    // 另一种形态：标签行
    assert.equal(factionScaleFromEntry('核心底蕴: 居西极贺洲西极昆仑山玉虚秘境，正道仙门魁首。', '昆仑道宫'), '居西极贺洲西极昆仑山玉虚秘境，正道仙门魁首');
    assert.equal(factionScaleFromEntry('（这条目什么标签都没有，只有成员行）\n- 甲 (男, T1感气境): …', '某门'), '', '取不到就留空——绝不编');
});

test('leg25 e 契约锁：照书抄的字段与关联落到实体上后**仍过 schema**（新键必须登记，否则校验拒收）', () => {
    // 今天踩过：`fieldSource`/`parentSource`/`parentSourceFrom` 一开始没登记 ⇒ validate 报「未知字段」。
    //   这条锁把它钉死——以后再加来源键，必须同步登记契约（"删字段只删一半最危险"的同款纪律）。
    const book = [
        { name: '混乱之地·万妖盟', kind: 'faction', content: '- 吞天妖王 (男, T8大乘中期): 盟主。', fields: { 规模: '混乱绞肉机', 性质: '妖修大本营' } },
        { name: '吞天妖王', kind: 'character', fields: { 所属: '混乱之地·万妖盟', 实力: 'T8大乘中期', 身份: '现任盟主' } },
    ];
    const w = mkWorld(book);
    seedBookEntities(w);
    for (const e of w.entities) {
        const v = validate(e, ssotSchema.props.entities.items);
        assert.deepEqual(v.errors, [], `${e.name}: ${v.errors.join('; ')}`);
    }
    const yao = w.entities.find((e) => e.name === '吞天妖王');
    assert.equal(yao.parent, '混乱之地·万妖盟');
    // 更强的路先接住：角色自己条目里的 `所属`（模型抽取）**过了验伪闸** ⇒ 来源记「模型抽取」而非「结构推导」
    //   （明述优先：自己条目明述 > 从别人条目结构推）。来源分账正是为了让这个区别可见。
    assert.equal(yao.parentSource, '模型抽取');
    assert.equal(yao.parentSourceFrom, 'member-line', '证据类型：该组织成员行里确实列了他');
    assert.equal(yao.fieldSource['实力'], '书里原话');
});

test('K43: 初始分量预填——weights 全覆盖且与 computeWeight 同口径（context.tension）', () => {
    const book = [
        { name: '万法阁', kind: 'faction' },
        { name: '虞昭华', kind: 'character' },
    ];
    const w = mkWorld(book, { tension: 0.7 });
    seedBookEntities(w);
    assert.equal(Object.keys(w.weights).length, 2);
    for (const e of w.entities) {
        // leg25 c：实体账上已无 `attrs`（四维浮点整条删除），公式也不再吃属性 ⇒ 直接传空对象同值；
        //   本条的意图（预填分量与 computeWeight 同口径、吃 context.tension）一字不改。
        assert.equal(w.weights[e.id], computeWeight({}, e.kind, 0.7));
        // 张力 0.7 真的进了式子：envFactor = 1 + 0.2×(0.7−0.5) = 1.04 ⇒ 势力 0.85×1.04 = 0.884；
        //   人物 1.0×1.04 = 1.04 → 被 clamp01 截平回 1（人物层基础分贴着上界，见 weight.test 登记）。
        const expect = e.kind === 'faction' ? 0.85 * 1.04 : 1;
        assert.ok(Math.abs(w.weights[e.id] - expect) < 1e-9, `${e.kind} 预填吃张力（期望 ${expect}，实际 ${w.weights[e.id]}）`);
    }
});

test('K43: 幂等重跑与已有实体——重跑零新增；同名（含 retired）不重建；branches 合并去重', () => {
    const book = [
        { name: '青龙会', kind: 'faction' },
        { name: '盐帮', kind: 'faction', parent: '青龙会' },
        { name: '白小娥', kind: 'character' },
    ];
    const w = mkWorld(book);
    seedBookEntities(w);
    const first = {
        entities: w.entities.length,
        branches: w.entities.find((e) => e.name === '青龙会').branches.length,
        weights: Object.keys(w.weights).length,
    };
    const r2 = seedBookEntities(w);
    assert.equal(r2.seeded, 0);
    assert.equal(w.entities.length, first.entities);
    assert.equal(w.entities.find((e) => e.name === '青龙会').branches.length, first.branches);
    assert.equal(Object.keys(w.weights).length, first.weights);

    // 已 retired 的同名不重建（青龙会 入账 + 盐帮 折叠；白小娥 已在册跳过）
    // leg25 c：既有实体夹具也不带 `attrs`（账上不该有那个键——引擎既不读也不写）
    const w2 = mkWorld(book, { entities: [{ id: 'e_old', kind: 'character', name: '白小娥', location: '中央', status: 'retired', lastActiveTick: 0 }] });
    const r3 = seedBookEntities(w2);
    assert.equal(r3.seeded, 1);
    assert.equal(w2.entities.length, 2);
});

test('K43: 空书名录与 shape 防御', () => {
    const w = mkWorld([]);
    const r = seedBookEntities(w);
    assert.deepEqual(r, { seeded: 0, folded: 0, skippedLocation: 0, warnings: [] });
    assert.equal(w.entities.length, 0);

    const w2 = mkWorld([{ name: '老角色', kind: 'character' }], { entities: [{ id: 'e_1', kind: 'character', name: '老角色', location: '中央' }] });
    const r2 = seedBookEntities(w2);
    assert.equal(r2.seeded, 0);
    assert.equal(w2.entities.length, 1);
    assert.equal(w2.weights['e_1'], computeWeight({}, 'character', 0.5));   // 既有实体也完成预填
});

test('leg25 c：入账**不预填任何数值**（空着就是空着）——账面没有四维键，分数只有层基线；形状过 schema', () => {
    const book = [
        // 名册条目只留身份（name/kind/parent/location）——`attrs`/`evidence` 已从 canon.bookEntities 形状里
        //   整条删除（schema additional:false ⇒ 带它们的名册条目当场校验不过），故夹具不再摆这两个键。
        //   `race` 仍是形状内的合法可选键：本条的意图是"名册里的东西**不自动流进实体**"，故留着当探针用。
        { name: '万法阁', kind: 'faction', race: '人族' },
        { name: '白小娥', kind: 'character' },
    ];
    const w = {
        version: 1,
        context: { world: '大荒', tension: 0.5, positions: ['中央'], setting: { frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: book } }, dynamic: { tension: { polarity: '正邪', direction: '', intensity: 0.5 }, env: {} } } },
        entities: [],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        milestones: [],
        meta: { tick: 0, simLog: [] },
    };
    const r = seedBookEntities(w);
    assert.equal(r.seeded, 2);
    const f = w.entities.find((e) => e.name === '万法阁');
    assert.equal(f.race, undefined, 'race 不再从名册带进实体');
    // leg25 c：不是"填空对象"，是**根本没有这个键**（旧法：势力预填 0.25 四键 / 人物预填 0.15 四键）
    assert.equal('attrs' in f, false, '势力账面上连 attrs 键都不该有（空格不是 0.25）');
    assert.deepEqual(Object.keys(f).sort(), ['id', 'kind', 'location', 'name'], `入账形状只剩身份+位置（实际 ${JSON.stringify(f)}）`);
    const c = w.entities.find((e) => e.name === '白小娥');
    assert.equal('attrs' in c, false, '角色账面同样没有该键');
    assert.equal(Object.keys(c).some((k) => /hardPower|office|network|intel|兵力|权位|人脉|耳目/.test(k)), false, '四维一个都不许有（含改名的）');
    // 分数只剩层基线一个输入：人物 1.0（0.85 是势力层，见 weight.test 重基线）——
    //   旧法此处是"中立 floor 0.5 / 势力 0.75"，那是属性缺键取中立的产物，已随公式删除。
    assert.ok(Math.abs(w.weights[c.id] - 1.0) < 1e-9, `人物基础分=层基线 1.0（实际 ${w.weights[c.id]}）`);
    assert.ok(Math.abs(w.weights[f.id] - 0.85) < 1e-9, `势力基础分=层基线 0.85（实际 ${w.weights[f.id]}）`);
    const checked = validate(w, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));
});
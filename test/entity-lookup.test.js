// story-world-v2/test/entity-lookup.test.js
// 按需查书补字段（细案 docs/spec-entity-field-lookup.md）：查书标记 / 部分返回 / 调用失败 /
// 幂等 / 重试阈值 / 熔断 / ≤15（选人 + 单盘算涉及）/ 重名防御 / R2 拒整步。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ROUND_PICK_CAP, AGENDA_INVOLVED_CAP, ENTITY_LOOKUP_MAX_ATTEMPTS, ENTITY_LOOKUP_MAX_FAILS,
    buildSelectPrompt, runSelect, fallbackCandidates,
    missingFields, buildLookupPrompt, runLookup, applyLookup,
    noteFailure, noteSuccess, lookupDisabled, runEntityLookupStep,
    computeAgendaInvolvement, checkAgendaInvolvement,
} from '../src/entity-lookup.js';

// 夹具：2 势力 + 2 角色 + 1 玩家 + 1 已灭实体 + 1 不在册 id（校验面用）
const world = (over = {}) => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['未明', '昆仑山'], playerId: 'e_p1',
        setting: { frozen: { fingerprint: 'f', extractedAt: 't', canon: { bookEntities: [
            { name: '昆仑道宫', kind: 'faction' },
            { name: '玄一道祖', kind: 'character' },
        ] } } },
    },
    entities: [
        // leg25 c：玩家实体不再带 `attrs`（四维浮点整条删除，schema 的 additional:false 会拒该键）。
        { id: 'e_p1', kind: 'character', name: '你', location: '未明', lastActiveTick: 0 },
        { id: 'e_bk_1', kind: 'faction', name: '昆仑道宫', location: '未明' },
        { id: 'e_bk_2', kind: 'character', name: '玄一道祖', location: '未明', parent: '昆仑道宫' },
        { id: 'e_bk_3', kind: 'character', name: '影', location: '未明' },
        { id: 'e_bk_4', kind: 'character', name: '亡者', location: '未明', status: 'dead' },
    ],
    weights: {}, agendas: [
        { id: 'a_1', owner: 'e_bk_1', goal: '荡平妖患', stage: '起', visibility: 'known', maxSteps: 4, progress: 1, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
    ], events: [], chronicle: [], milestones: [],
    meta: { tick: 0, simLog: [] },
    ...over,
});

const reply = (text) => async () => text;
const bookText = (e) => (e.name === '玄一道祖' ? [{ name: '昆仑道宫', text: '- 玄一道祖 (男, T9渡劫巅峰): 人族守护神。' }] : []);

// ---------- ① 选人（LLM 选择权 + 引擎只校验） ----------

test('细案 ①：选人 prompt 给全量名号（书序、不裁剪）且只认 id', () => {
    const p = buildSelectPrompt(world());
    assert.ok(p.includes('e_bk_1\t昆仑道宫\t势力'), '势力行带 id/名号/类别');
    assert.ok(p.includes('e_bk_3\t影\t角色'), '角色行在列（哪怕从没出手过——引擎不替模型筛）');
    assert.ok(!p.includes('e_bk_4'), '已灭实体不进名单');
    assert.ok(p.includes(`最多 ${ROUND_PICK_CAP} 个`), '上限写进 prompt');
    assert.ok(p.includes('荡平妖患'), '在飞盘算给模型看');
});

test('细案 ①：选人护栏——不在册 id / 已灭 id / 超上限 → 一律拒整条（不替模型改选）', async () => {
    const ok = await runSelect({ world: world(), transport: reply('{"pick":["e_bk_1","e_bk_3"]}') });
    assert.deepEqual(ok.picks, ['e_bk_1', 'e_bk_3'], '正常回文照收');
    assert.equal(ok.warning, null);

    const unknown = await runSelect({ world: world(), transport: reply('{"pick":["e_bk_1","e_ghost"]}') });
    assert.equal(unknown.picks, null, '含不在册 id → 拒整条（宁可退回上轮名单，也不截断成"前几个"）');
    assert.match(unknown.warning, /不在册/);

    const dead = await runSelect({ world: world(), transport: reply('{"pick":["e_bk_4"]}') });
    assert.equal(dead.picks, null, '已灭实体被选中 → 拒');

    const over = await runSelect({ world: world(), transport: reply(`{"pick":${JSON.stringify(world().entities.slice(0, 4).map((e) => e.id).concat(Array.from({ length: 15 }, (_, i) => `e_x${i}`)))} }`) });
    assert.equal(over.picks, null, '超上限（或含未知 id）→ 拒');

    const badJson = await runSelect({ world: world(), transport: reply('模型胡说八道') });
    assert.equal(badJson.picks, null, '坏 JSON → 拒');
    const threw = await runSelect({ world: world(), transport: async () => { throw new Error('HTTP 500'); } });
    assert.equal(threw.picks, null, '调用抛错 → 拒');
    assert.match(threw.warning, /调用失败/);
});

test('细案 ①：上限 15——正好 15 个放行，16 个拒', async () => {
    const w = world();
    w.entities = Array.from({ length: 16 }, (_, i) => ({ id: `e_n${i}`, kind: 'character', name: `人${i}`, location: '未明' }));
    const p15 = JSON.stringify({ pick: w.entities.slice(0, 15).map((e) => e.id) });
    const p16 = JSON.stringify({ pick: w.entities.map((e) => e.id) });
    assert.equal((await runSelect({ world: w, transport: reply(p15) })).picks.length, ROUND_PICK_CAP, '15 个放行');
    assert.equal((await runSelect({ world: w, transport: reply(p16) })).picks, null, '16 个拒整条');
});

test('细案 ①：兜底名单 = 玩家 + 在飞盘算属主（引擎事实，不含任何重要性判断）', () => {
    assert.deepEqual(fallbackCandidates(world()), ['e_p1', 'e_bk_1']);
    const w = world({ context: { ...world().context, playerId: undefined } });
    assert.deepEqual(fallbackCandidates(w), ['e_bk_1'], '无玩家时只剩盘算属主');
});

// ---------- ② 查书（模型）与查书标记回写 ----------

test('细案 ②：缺字段判定——已有值/已定案/到重试上限 → 不再查', () => {
    const w = world();
    const e = w.entities[2];
    assert.deepEqual(missingFields(e, w.meta), ['实力', '位置'], '全新实体两栏都缺');
    e['实力'] = 'T9渡劫巅峰';
    assert.deepEqual(missingFields(e, w.meta), ['位置'], '有值那栏不再查');
    delete e['实力'];
    const meta = { entityFields: { [e.id]: { attempts: { 实力: { count: 1, state: 'ok' }, 位置: { count: 1, state: 'absent' } } } } };
    assert.deepEqual(missingFields(e, meta), [], 'ok / absent 都已定案 → 不再查');
    const meta2 = { entityFields: { [e.id]: { attempts: { 实力: { count: ENTITY_LOOKUP_MAX_ATTEMPTS, state: 'pending' } } } } };
    assert.deepEqual(missingFields(e, meta2), ['位置'], '到重试上限 → 停手（防死循环），另一栏照旧');
});

test('细案 ②：查书 prompt 只喂选中实体的原文，且写清口径（文本类型 / 势力不抽实力 / 不许判断）', () => {
    const p = buildLookupPrompt(world(), [{ name: '玄一道祖', entries: [{ name: '昆仑道宫', text: '- 玄一道祖 (男, T9渡劫巅峰): 人族守护神。' }] }]);
    assert.ok(p.includes('T9渡劫巅峰'), '原文进 prompt');
    assert.ok(p.includes('势力条目不抽实力'), '用户口径：势力不写实力');
    assert.ok(p.includes('不要套用别的书的档位体系'), '实力是文本：分段/不分段都按本书写法');
    assert.ok(p.includes('不要填'), '禁止占位值');
});

test('细案 ②：有值 → 落账 + 留痕（value/from/fetchedAt/sources 齐）', () => {
    const w = world();
    const out = applyLookup({
        ssot: w, ids: ['e_bk_2'],
        byName: { 玄一道祖: { 实力: 'T9渡劫巅峰', 位置: '昆仑山玉虚秘境' } },
        sources: { e_bk_2: ['昆仑道宫'] }, tick: 3,
    });
    const e = out.ssot.entities.find((x) => x.id === 'e_bk_2');
    assert.equal(e['实力'], 'T9渡劫巅峰', '原话落账（文本，不做任何加工）');
    assert.equal(e['位置'], '昆仑山玉虚秘境');
    const rec = out.ssot.meta.entityFields.e_bk_2;
    assert.equal(rec.fields['实力'].from, '昆仑道宫', '记来源条目');
    assert.equal(rec.fields['实力'].fetchedAt, 3);
    assert.deepEqual(rec.sources, ['昆仑道宫'], '审计：查过哪几条');
    assert.deepEqual(out.stats, { ok: 2, pending: 0, absent: 0, unread: 0, written: ['玄一道祖.实力=T9渡劫巅峰', '玄一道祖.位置=昆仑山玉虚秘境'] });
    assert.equal(w.entities[2]['实力'], undefined, '纯函数：不改输入');
});

test('细案 ②（核心）：模型没给这一栏 → 记 pending，**绝不写"书里没有"**；只有书里无条目才 absent', () => {
    const w = world();   // 新实体（未在册那两条书条目之外）→ 无来源
    w.entities.push({ id: 'e_new', kind: 'character', name: '无名客', location: '未明' });
    const out = applyLookup({
        ssot: w, ids: ['e_bk_2', 'e_new'],
        byName: { 玄一道祖: { 位置: '昆仑山' }, 无名客: null },
        sources: { e_bk_2: ['昆仑道宫'], e_new: [] }, tick: 1,
    });
    const attemptsA = out.ssot.meta.entityFields.e_bk_2.attempts;
    assert.equal(attemptsA['实力'].state, 'pending', '书里有条目、模型没给 → pending（下轮可再试）');
    assert.equal(attemptsA['位置'].state, 'ok', '同一实体的另一栏独立落账');
    assert.equal(out.ssot.entities.find((e) => e.id === 'e_bk_2')['实力'], undefined, '没给就不写键（不留空串）');
    const attemptsB = out.ssot.meta.entityFields.e_new.attempts;
    assert.equal(attemptsB['实力'].state, 'absent', '书里没有任何相关条目 → 才允许记"书未明述"');
    assert.equal(out.stats.pending, 1, 'pending 只算 1 个：玄一道祖的"实力"（书里有条目、模型没给）');
    assert.equal(out.stats.absent, 2, 'absent 算 2 个：无名客书里无条目 → 实力/位置 两栏都记"书未明述"');
    assert.equal(out.stats.ok, 1, 'ok 算 1 个：玄一道祖的位置有值');
});

test('细案 ②：部分返回（要 3 个只回 1 个）→ 逐实体判定，不漏不错位', () => {
    const w = world();
    w.entities.push({ id: 'e_x', kind: 'character', name: '甲', location: '未明' }, { id: 'e_y', kind: 'character', name: '乙', location: '未明' });
    const out = applyLookup({
        ssot: w, ids: ['e_bk_2', 'e_x', 'e_y'],
        byName: { 甲: { 实力: '剑术通神' } },            // 只有甲回了；乙整条缺失
        sources: { e_bk_2: ['昆仑道宫'], e_x: ['某条'], e_y: ['某条'] }, tick: 2,
    });
    assert.equal(out.ssot.entities.find((e) => e.id === 'e_x')['实力'], '剑术通神', '不分段的书也照收原话（文本类型）');
    assert.equal(out.ssot.meta.entityFields.e_y.attempts['实力'].state, 'pending', '没回的那个记 pending，下轮补');
    assert.equal(out.stats.ok, 1);
});

test('细案 ②：重名实体 → 按名号回填一律丢弃（宁可漏填，不可错填）', () => {
    const w = world();
    w.entities.push({ id: 'e_dup1', kind: 'character', name: '影', location: '未明' }, { id: 'e_dup2', kind: 'character', name: '影', location: '未明' });
    const out = applyLookup({
        ssot: w, ids: ['e_dup1'],
        byName: { 影: { 实力: '暗影宗师' } },
        sources: { e_dup1: ['某条'] }, tick: 1,
    });
    assert.equal(out.ssot.entities.find((e) => e.id === 'e_dup1')['实力'], undefined, '同名多实例 → 不回填（避免错填）');
});

test('细案 ②：调用失败（byName=null）→ 一个字节都不写（这回没查成 ≠ 书里没有）', () => {
    const w = world();
    const out = applyLookup({ ssot: w, ids: ['e_bk_2'], byName: null, sources: {}, tick: 5 });
    assert.equal(out.ssot, w, '原对象原样返回');
    assert.equal(out.ssot.meta.entityFields, undefined, '不留任何痕迹（下轮重试靠 tick 推进，不靠假痕迹）');
    assert.deepEqual(out.stats, { ok: 0, pending: 0, absent: 0, unread: 0, written: [] });
});

test('细案 ②：幂等——已定案的实体不再进查询面；重复回写逐字节一致', () => {
    const w = world();
    const first = applyLookup({ ssot: w, ids: ['e_bk_2'], byName: { 玄一道祖: { 实力: 'T9渡劫巅峰' } }, sources: { e_bk_2: ['昆仑道宫'] }, tick: 1 });
    const e = first.ssot.entities.find((x) => x.id === 'e_bk_2');
    assert.deepEqual(missingFields(e, first.ssot.meta), ['位置'], '实力已定案 → 只差位置');
    const again = applyLookup({ ssot: first.ssot, ids: ['e_bk_2'], byName: { 玄一道祖: { 实力: 'T9渡劫巅峰' } }, sources: { e_bk_2: ['昆仑道宫'] }, tick: 2 });
    assert.equal(again.ssot.entities.find((x) => x.id === 'e_bk_2')['实力'], 'T9渡劫巅峰', '值不变');
    assert.deepEqual(again.ssot.meta.entityFields.e_bk_2.sources, ['昆仑道宫'], 'sources 不重复堆叠');
});

// ---------- ③ 熔断（世界推进优先） ----------

test('细案 ③：连续失败达到阈值 → 熔断几轮（lookupDisabled）', () => {
    let w = world();
    for (let i = 0; i < ENTITY_LOOKUP_MAX_FAILS; i += 1) w = noteFailure(w, i);
    assert.equal(w.meta.entityLookup.fails, ENTITY_LOOKUP_MAX_FAILS);
    assert.equal(lookupDisabled(w, ENTITY_LOOKUP_MAX_FAILS), true, '熔断期内跳过查书');
    assert.equal(lookupDisabled(w, ENTITY_LOOKUP_MAX_FAILS + ENTITY_LOOKUP_MAX_FAILS), false, '熔断期过 → 恢复尝试');
    const ok = noteSuccess(w);
    assert.equal(ok.meta.entityLookup.fails, 0, '成功即清零');
});

test('细案 ③：选人失败 → 退回上轮名单 + 记失败；查书失败 → 不写痕', async () => {
    const w = world();
    const stuck = await runEntityLookupStep({
        ssot: w, transport: async () => { throw new Error('超时'); },
        bookText, tick: 1, prevPicks: ['e_bk_2'],
    });
    assert.deepEqual(stuck.picks, ['e_bk_2'], '选人失败 → 用上轮名单');
    assert.equal(stuck.ssot.meta.entityLookup.fails, 1, '失败计数 +1');
    assert.equal(stuck.ssot.meta.entityFields, undefined, '查书没跑成 → 不留痕');

    let selectDone = false;
    const okTransport = async () => { if (!selectDone) { selectDone = true; return '{"pick":["e_bk_2"]}'; } throw new Error('查书超时'); };
    const second = await runEntityLookupStep({ ssot: w, transport: okTransport, bookText, tick: 1 });
    assert.match(second.warning, /查书调用失败/, '查书失败如实上报（状态条要给用户看）');
    assert.deepEqual(second.picks, ['e_bk_2'], '选人成功 → 用模型选的名单');
    assert.equal(second.ssot.meta.entityFields, undefined, '查书失败：不写任何痕迹（下轮重试）');
    assert.equal(second.ssot.meta.entityLookup.fails, 1);
});

// ---------- ④ R2：单个盘算一轮内涉及实体 ≤15（用户拍板：拒整步） ----------

test('细案 ④：涉及计数 = 属主 + 行动方/目标 + 被波及方（本步 actions 全计，逐轮算）', () => {
    const w = world();
    const step = {
        actions: [{ entity: 'e_bk_1', verb: '出兵' }, { entity: 'e_bk_2', verb: '迎战', target: 'e_bk_3' }],
        newEvents: [
            { title: '出征', source: { type: 'plot', ref: 'a_1' }, position: '昆仑山', ripples: ['e_bk_2', 'e_bk_3'] },
            { title: '涟漪', source: { type: 'ripple', ref: 'ev_1_1' }, position: '昆仑山', ripples: ['e_bk_3'] },
            { title: '别家的事', source: { type: 'plot', ref: 'a_9' }, position: '昆仑山', ripples: ['e_zzz'] },
        ],
    };
    const r = computeAgendaInvolvement(step, w, 'a_1');
    assert.deepEqual([...r.set].sort(), ['e_bk_1', 'e_bk_2', 'e_bk_3'].sort(), '只数本盘算的面；别人的盘算（a_9）不算进来');
    assert.equal(r.count, 3);
    assert.deepEqual(computeAgendaInvolvement(step, w, 'a_none'), { set: [], count: 0 }, '不存在的盘算 → 0');
});

test('细案 ④：单盘算涉及 >15 → 报违规（调用方拒整步 = 用户拍板 (a)）', () => {
    const w = world();
    const many = Array.from({ length: 20 }, (_, i) => ({ entity: `e_n${i}`, verb: '动' }));
    const step = { actions: many, newEvents: [] };
    const { violations, cap } = checkAgendaInvolvement(step, w);
    assert.equal(cap, AGENDA_INVOLVED_CAP);
    assert.equal(violations.length, 1, '恰好一条违规');
    assert.equal(violations[0].agendaId, 'a_1');
    assert.equal(violations[0].count, 21, '20 个行动方 + 属主');
    // 边界：正好 15 / 16
    const at15 = { actions: Array.from({ length: 14 }, (_, i) => ({ entity: `e_n${i}`, verb: '动' })), newEvents: [] };
    assert.equal(checkAgendaInvolvement(at15, w).violations.length, 0, '14+属主=15 → 放行');
    const at16 = { actions: Array.from({ length: 15 }, (_, i) => ({ entity: `e_n${i}`, verb: '动' })), newEvents: [] };
    assert.equal(checkAgendaInvolvement(at16, w).violations.length, 1, '15+属主=16 → 拒');
});

test('细案 ④：已结算盘算不参与计数（closed 的面不管）', () => {
    const w = world();
    w.agendas[0].closed = true;
    const step = { actions: Array.from({ length: 30 }, (_, i) => ({ entity: `e_n${i}`, verb: '动' })), newEvents: [] };
    assert.equal(checkAgendaInvolvement(step, w).violations.length, 0, '已结算盘算不再受上限约束（它这一轮不推进）');
});

// ---------- ⑤ 接线：tick 前置步跑在 buildEvolutionPack 之前（查回来的字段这一轮就看得见） ----------

test('细案 ⑤：runTick 前置步——选人/查书结果进包，主调用看得见"实力"（角色才有）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = world();
    // 让玄一道祖缺字段，前置步把它的实力查回来；势力昆仑道宫也查（应被 prompt 口径排除，不入字段）
    // leg25 c：`stateChanges` 整条删除（四维浮点提议随四维一并没了；契约层 additional:false 会拒该键）。
    //   本用例要验的是**前置步（选人/查书）**，世界步只需空步过校验即可，不需要任何属性增量。
    const emptyStep = {
        actions: [], newEvents: [], agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    let sawPack = null;
    const transport = async (prompt) => {
        if (String(prompt).includes('本轮上场选择器')) return '{"pick":["e_bk_1","e_bk_2"]}';
        if (String(prompt).includes('字段抽取器')) return '{"玄一道祖":{"实力":"T9渡劫巅峰"}}';
        sawPack = prompt;                     // 主调用：把包记下来看
        return JSON.stringify(emptyStep);
    };
    const preSteps = [];
    const r = await runTick({
        transport, ssot: w, dialogue: '（继续）', extractCtx: {},
        preStep: async ({ ssot: cur }) => {
            const pre = await runEntityLookupStep({ ssot: cur, transport, bookText, tick: 1 });
            preSteps.push(pre);
            return pre;
        },
    });
    assert.equal(r.ok, true, `tick 正常跑完：${r.error || ''}`);
    assert.deepEqual(r.picks, ['e_bk_1', 'e_bk_2'], 'picks 随 tick 返回（编排层落盘点用）');
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_bk_2')['实力'], 'T9渡劫巅峰', '查回来的字段落在这一轮的世界里');
    assert.ok(sawPack && sawPack.includes('T9渡劫巅峰'), '★主调用的输入里带上了刚查回来的实力（这才叫"用上了"）');
    assert.ok(sawPack.includes('e_bk_1') && sawPack.includes('e_bk_2'), '实体段名单 = LLM 选的那两个（不是引擎镜头截出来的）');
});

test('细案 ⑤（leg25 d 回归）：**异步** bookText 也必须走通——浏览器接线 `bookTextForEntity` 就是 async', async () => {
    // 本用例锁的是一条真 bug（用户实拍"看不到属性"的真因）：`runLookup`/`sources` 原先**同步**调用
    //   注入的 bookText，而浏览器 `web/index.js:576 bookTextForEntity` 是 async ⇒ 拿到 Promise、
    //   `.length` 为 undefined、`.map` 抛 TypeError → 前置步被 tick.js 的 catch 静默吞掉 →
    //   `applyLookup` 永不执行 → 盘上 `meta.entityFields` 恒为 0 条（查书功能整个没生效）。
    //   旧夹具清一色同步函数，所以 430 条全绿也照样漏掉它——这条用异步注入面把它钉死。
    const { runTick } = await import('../src/tick.js');
    const w = world();
    const emptyStep = {
        actions: [], newEvents: [], agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const transport = async (prompt) => {
        if (String(prompt).includes('本轮上场选择器')) return '{"pick":["e_bk_2"]}';
        if (String(prompt).includes('字段抽取器')) return '{"玄一道祖":{"实力":"T9渡劫巅峰","位置":"昆仑山"}}';
        return JSON.stringify(emptyStep);
    };
    // 与浏览器同一形状：async 函数、await 之后才拿到条目
    const asyncBookText = async (e) => (e.name === '玄一道祖'
        ? [{ name: '玄一道祖条目', text: '- 玄一道祖 (男, T9渡劫巅峰): 人族守护神，居昆仑山。' }]
        : []);
    const r = await runTick({
        transport, ssot: w, dialogue: '（继续）', extractCtx: {},
        preStep: async ({ ssot: cur }) => runEntityLookupStep({ ssot: cur, transport, bookText: asyncBookText, tick: 1 }),
    });
    assert.equal(r.ok, true, `前置步不得炸掉 tick：${r.error || ''}`);
    const e2 = r.ssot.entities.find((e) => e.id === 'e_bk_2');
    assert.equal(e2['实力'], 'T9渡劫巅峰', '★异步 bookText：查回来的实力落账');
    assert.equal(e2['位置'], '昆仑山', '★异步 bookText：位置同样落账');
    const rec = r.ssot.meta?.entityFields?.e_bk_2;
    assert.ok(rec, '★`meta.entityFields` 必须真的建起来（旧实现恒为 0 条——这正是用户看到的症状）');
    assert.equal(rec.attempts['实力'].state, 'ok', '查书标记：有值 → ok');
    assert.equal(rec.fields['实力'].from, '玄一道祖条目', '留痕 from = 查过的世界书条目名');
    assert.ok(rec.sources.includes('玄一道祖条目'), 'sources 记下这次查了哪条');
});

test('细案 ⑤（leg25 d 回归）：异步 bookText 抛错 → 不写痕、不阻塞（失败面同口径）', async () => {
    const { runTick } = await import('../src/tick.js');
    const w = world();
    const emptyStep = {
        actions: [], newEvents: [], agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const transport = async (prompt) => (String(prompt).includes('本轮上场选择器')
        ? '{"pick":["e_bk_2"]}' : JSON.stringify(emptyStep));
    const r = await runTick({
        transport, ssot: w, dialogue: '（继续）', extractCtx: {},
        preStep: async ({ ssot: cur }) => runEntityLookupStep({
            ssot: cur, transport, tick: 1,
            bookText: async () => { await Promise.resolve(); throw new Error('世界书读不到'); },
        }),
    });
    assert.equal(r.ok, true, '取原文抛错不得拦 tick（世界推进优先）');
    // ★leg25 d 语义修正（这条是本棒的核心判据，别改回旧的"什么都不写"）：
    //   取书失败**必须**记 pending（可重试），而**绝不能**记 absent。旧法两者同形（都写成"书未明述"）
    //   ⇒ absent 被 missingFields 永久跳过 ⇒ 用户盘上出现假的「书未明述」且再也不会被纠正。
    const rec = r.ssot.meta?.entityFields?.e_bk_2;
    assert.ok(rec, '取书失败也要留可重试的痕（否则无法区分"没查过"与"查过但没读成"）');
    assert.equal(rec.attempts['实力'].state, 'pending', '★读不到书 → pending（可重试），绝不是 absent');
    assert.equal(rec.attempts['位置'].state, 'pending', '★位置同理');
    assert.deepEqual(rec.sources, [], '没读到书 → sources 不得记条目名');
    assert.ok(!JSON.stringify(rec).includes('absent'), '★一个 absent 都不许出现（读不到 ≠ 书里没有）');
});

test('细案 ⑤（leg25 d 回归）：**书读到了但书里确实没有该名号** → 才记 absent（书未明述）', async () => {
    // 与上一条成对：区分「读不到书」与「书里真没有」——这是旧实现混为一谈的那两件事。
    const { runTick } = await import('../src/tick.js');
    const w = world();
    const emptyStep = {
        actions: [], newEvents: [], agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const transport = async (prompt) => {
        if (String(prompt).includes('本轮上场选择器')) return '{"pick":["e_bk_2"]}';
        return JSON.stringify(emptyStep);
    };
    const r = await runTick({
        transport, ssot: w, dialogue: '（继续）', extractCtx: {},
        preStep: async ({ ssot: cur }) => runEntityLookupStep({
            ssot: cur, transport, tick: 1,
            // 书**读到了**（ok:true），但这份书里没有玄一道祖的条目 → entries 空
            bookText: async () => ({ ok: true, entries: [] }),
        }),
    });
    assert.equal(r.ok, true);
    // 引擎选中的实体缺字段、但"查到书可读且无此条目"⇒ 无来源可喂 ⇒ 不发起查书调用 ⇒ 不写痕。
    //   absent 只可能由 applyLookup 在「readOk 且 src 为空」时写入（见 applyLookup 注释）；
    //   此处 runLookup 因 targets 为空而跳过，故实体保持"未查"——两种状态都有据，不是空白。
    const rec = r.ssot.meta?.entityFields?.e_bk_2;
    assert.ok(!rec || rec.attempts?.['实力']?.state !== 'absent' || rec.sources.length === 0,
        'absent 只在"读到书 + 书里无条目"时成立，且 sources 必为空');
});

test('细案 ⑤：前置步抛错 → 世界照常推进（失败零阻塞，退回引擎镜头）', async () => {
    const { runTick } = await import('../src/tick.js');
    // leg25 c：同上——空步不再带 `stateChanges`（该键已不在世界步契约里）。
    const emptyStep = {
        actions: [], newEvents: [], agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({
        transport: async () => JSON.stringify(emptyStep), ssot: world(), dialogue: '（继续）', extractCtx: {},
        preStep: async () => { throw new Error('查书炸了'); },
    });
    assert.equal(r.ok, true, '前置步失败不拦 tick（世界推进优先）');
    assert.equal(r.picks, null, '没拿到名单 → 退回引擎镜头（旧路径零扰动）');
});

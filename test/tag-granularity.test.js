// story-world-v2/test/tag-granularity.test.js
// ★★★细案 `docs/spec-tag-granularity.md` 的判据（第一段：**解析器**）。
// 口径来源（用户 2026-09-24 逐条口述，见细案 §0.1）：
//   · 「要给聊天llm看到实体（势力，角色）都有哪些属性字段」⇒ 格名表 = `CHANGE_FIELDS`
//   · 「颗粒度一定要对齐插件里的事件，方便让插件直接注册成事件」⇒ 三格各落到哪，见细案 §2.3
//   · 「时间落账没必要带源」「不要从起点抽」⇒ `【此刻】`只逐字照抄，不做算术、不带源
// ★每条判据都写清"它防的是什么病"（本仓规矩：判据锁**还对不对**，不只锁"在不在"）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, hasTagFacts, tagReadoutLine, CHANGE_FIELDS, TAG_FIELD_SEP } from '../src/tag-extract.js';
import { registerDialogueFacts, DIALOGUE_EVENT_BASE, DIALOGUE_UPDATE_CAP, settleTick } from '../src/settle.js';
import { buildEvolutionPack } from '../src/pack.js';
import { runTick } from '../src/tick.js';

const F = (lines) => ['```tags', ...lines, '```'].join('\n');

const ENTITIES = [
    { id: 'e_xue', kind: 'character', name: '薛铁衣', aliases: ['铁衣'] },
    { id: 'e_xiao', kind: 'character', name: '白小娥', aliases: ['小娥'] },
    { id: 'e_p1', kind: 'character', name: '黄坤', aliases: ['坤哥'] },
    { id: 'e_men', kind: 'faction', name: '天门', aliases: [] },
];
const LOCATIONS = ['未明', '忘川渡口', '江州城'];
const CTX = { entities: ENTITIES, locations: LOCATIONS, playerId: 'e_p1', maxActions: 12 };

// ── ① 【此刻】：时间点，逐字照抄 ────────────────────────────────────────────────
test('G1：【此刻】逐字收下（一个时间点），不做算术、不带源', () => {
    const f = extractTags(F(['【此刻】复苏历三年 三月初七 卯时']), CTX);
    assert.equal(f.at, '复苏历三年 三月初七 卯时', '★（值逐字保留：去首尾空白，不改字）');
    // ★防的病：把"三日后"这种**相对时长**塞进"此刻"（用户当场抓出来的草案错法）
    assert.notEqual(f.at, undefined, '【此刻】必须被收下——它是"现在是什么时候"，不是"过了多久"');
});

test('G2：【此刻】出现多次 ⇒ 先到先得（点不是一个可以累加的量）', () => {
    const f = extractTags(F(['【此刻】三月初七', '【此刻】三月初八']), CTX);
    assert.equal(f.at, '三月初七', '★先到先得，确定性（与名号解析同一口径：不随机、不取最后）');
});

test('G3：【此刻】与【时长】是两格，互不覆盖', () => {
    const f = extractTags(F(['【此刻】三月初七', '【时长】三日后']), CTX);
    assert.equal(f.at, '三月初七');
    assert.equal(f.elapsed, '三日后', '★相对时长仍走原来那一格（leg115 的 elapsed 通路一个字不改）');
});

// ── ② 【变化】：谁｜哪一格｜变成什么（格名对齐实体账） ────────────────────────────
test('G4：【变化】三格收下——谁归一、格在册、值逐字照抄', () => {
    const f = extractTags(F(['【变化】薛铁衣｜实力｜踏入元婴']), CTX);
    assert.equal(f.changes.length, 1);
    assert.deepEqual(
        { entityId: f.changes[0].entityId, field: f.changes[0].field, value: f.changes[0].value },
        { entityId: 'e_xue', field: '实力', value: '踏入元婴' },
        '★值必须**照抄**（写「踏入元婴」就不是 9999——不许把词换算成数）',
    );
});

test('G5：别名归一（写"铁衣"也认得出是谁）', () => {
    const f = extractTags(F(['【变化】铁衣｜身份｜江州话事人']), CTX);
    assert.equal(f.changes.length, 1);
    assert.equal(f.changes[0].entityId, 'e_xue');
});

test('G6：★格名不在册 ⇒ 丢掉 + 留痕（不许静默）', () => {
    const f = extractTags(F(['【变化】薛铁衣｜修为｜金丹']), CTX);
    assert.equal(f.changes.length, 0, '★没在名单上的格一个都不许落（名单 = 实体账真有的那些格）');
    assert.equal(f.changesBad.length, 1, '★丢了什么必须能被看见（本仓最怕静默）');
    assert.equal(f.changesBad[0].why, 'field');
});

test('G7：★势力与角色的格不通用（角色的格写到势力身上 ⇒ 丢 + 留痕）', () => {
    const f = extractTags(F(['【变化】天门｜实力｜高手如云']), CTX);
    assert.equal(f.changes.length, 0, '★`实力`是角色的格；势力写它 = 形状不合（细则 §2.1 那两行名单）');
    assert.equal(f.changesBad[0].why, 'kind');
    const ok = extractTags(F(['【变化】天门｜性质｜正道仙门魁首']), CTX);
    assert.equal(ok.changes.length, 1, '势力自己的格照常收');
});

test('G8：★主语归不上 ⇒ 丢 + 留痕，且**不造人**（宁缺勿造）', () => {
    const f = extractTags(F(['【变化】张三｜实力｜化神']), CTX);
    assert.equal(f.changes.length, 0);
    assert.equal(f.changesBad[0].why, 'who');
    assert.ok(f.unresolved.some((u) => u.name === '张三'), '归不上的名字进 unresolved（与行动那条同一条口径）');
});

test('G9：格名清单是**真源导出**（面板/校验/落账共用一把尺子）', () => {
    for (const k of ['实力', '身份', '定位', '所属', '性质', '倾向', '规模']) {
        assert.ok(CHANGE_FIELDS.includes(k), `★格名表必须含「${k}」（它抄自 ssot.schema.js 里实体账真有的那些文本格）`);
    }
});

// ── ③ 【承诺】：谁｜许了什么｜对谁（不是动手，但发生了） ──────────────────────────
test('G10：【承诺】三格收下——两端都归一', () => {
    const f = extractTags(F(['【承诺】黄坤｜护送白小娥回江州｜白小娥']), CTX);
    assert.equal(f.promises.length, 1);
    assert.deepEqual(
        { entityId: f.promises[0].entityId, what: f.promises[0].what, toId: f.promises[0].toId },
        { entityId: 'e_p1', what: '护送白小娥回江州', toId: 'e_xiao' },
        '★承诺是"让世界记住我的事"那一格：主语、内容、对象都要在',
    );
});

test('G11：对象那一格可以没有（不知道对谁许的）', () => {
    const f = extractTags(F(['【承诺】黄坤｜三年之内必回大荒']), CTX);
    assert.equal(f.promises.length, 1);
    assert.equal(f.promises[0].toId, null);
    assert.equal(f.promises[0].toText, null);
});

test('G12：★主语归不上 ⇒ 丢 + 留痕（没有主的承诺挂不到任何人身上）', () => {
    const f = extractTags(F(['【承诺】路人甲｜欠你一条命｜黄坤']), CTX);
    assert.equal(f.promises.length, 0);
    assert.equal(f.promisesBad[0].why, 'who');
});

// ── ④ 块边界：新格与老格同一条围栏口径 ─────────────────────────────────────────
test('G13：★★块外的【变化】/【承诺】一个都不认（leg93 那条边界对新格同样成立）', () => {
    const text = ['他在心里默念【变化】薛铁衣｜实力｜天下第一。', F(['【行动】薛铁衣｜迎战｜黄坤'])].join('\n');
    const f = extractTags(text, CTX);
    assert.equal(f.changes.length, 0, '★正文里**解说格式**的那一行不许被当成真变更（leg93 病①的同款）');
    assert.equal(f.promises.length, 0);
    assert.equal(f.actions.length, 1, '块里的行动照常收（边界只挡块外）');
});

test('G14：形状不合的行进 malformed（不许静默吃下去）', () => {
    const f = extractTags(F(['【变化】薛铁衣｜实力', '【承诺】']), CTX);
    assert.equal(f.changes.length, 0);
    assert.equal(f.promises.length, 0);
    assert.ok(f.malformed.length >= 2, '★形状不合必须留痕（两条都该被看见）');
});

// ── ⑤ 出包与出声：新料要能被看见 ─────────────────────────────────────────────
test('G15：hasTagFacts —— 只有新格时也必须算"有料"（否则整轮不进包）', () => {
    assert.equal(hasTagFacts(extractTags(F(['【此刻】三月初七']), CTX)), true);
    assert.equal(hasTagFacts(extractTags(F(['【承诺】黄坤｜必回大荒']), CTX)), true);
    assert.equal(hasTagFacts(extractTags(F(['【变化】黄坤｜实力｜踏入元婴']), CTX)), true);
});

test('G16：读数行把"变化／承诺"报出来（玩家可见，零引擎术语）', () => {
    const line = tagReadoutLine(extractTags(F(['【变化】黄坤｜实力｜踏入元婴', '【承诺】黄坤｜护送白小娥回江州｜白小娥']), CTX));
    assert.ok(/变化\s*1/.test(line), `★读数行必须报变化条数（实际：${line}）`);
    assert.ok(/承诺\s*1/.test(line), `★读数行必须报承诺条数（实际：${line}）`);
});

// ── ⑥ 落账：三族标签 → dialogue 型事件 ＋ 【变化】落格（细案 §2.3 / §2.7）────────────────

const mkWorld = () => ({
    version: 1,
    context: { world: '测试', positions: ['未明', '忘川渡口', '江州城'], playerId: 'e_p1' },
    entities: [
        { id: 'e_xue', kind: 'character', name: '薛铁衣', location: '忘川渡口', status: 'active' },
        { id: 'e_p1', kind: 'character', name: '黄坤', location: '忘川渡口', status: 'active' },
        { id: 'e_men', kind: 'faction', name: '天门', location: '江州城', status: 'active' },
    ],
    weights: {}, agendas: [], events: [], milestones: [], chronicle: [],
    meta: { tick: 7, simLog: [], warnings: [], entityFields: {} },
});
const tagIt = (lines) => F(lines);
const reg = (world, lines, tick = 7) => {
    const prose = tagIt(lines);
    return { prose, facts: extractTags(prose, CTX), stats: null, world };
};

test('G17：三条标签注册成 dialogue 型事件 ＋ 编年行——**发号走预留段，不与世界步撞号**', () => {
    const w = mkWorld();
    const prose = tagIt(['【行动】薛铁衣｜迎战｜黄坤']);
    const st = registerDialogueFacts(w, { facts: extractTags(prose, CTX), dialogue: prose, tick: 7 });
    assert.equal(st.events, 1, '一条行动 = 一条事件');
    assert.equal(w.events.length, 1);
    assert.equal(w.events[0].source.type, 'dialogue', '★源的型叫 dialogue（"源就是正文本身"）');
    assert.equal(w.events[0].id, `ev_7_${DIALOGUE_EVENT_BASE}`, '★世界步那批是 ev_7_1..n，我走 500+ ⇒ 永不撞号');
    assert.equal(w.events[0].closed, false, '★开着：世界模型下一轮才看得见它、才能拿它当因');
    assert.deepEqual(w.events[0].ripples, ['e_xue', 'e_p1'], '★波及 = 主语 + 对象（照抄 id）');
    assert.equal(w.chronicle.length, 1);
    assert.equal(w.chronicle[0].eventRef, w.events[0].id, '★编年行挂回事件（链视图/检索层要它）');
});

test('G18：★★【变化】落格——值逐字落上、原值与因同时留痕（照 applyEntityUpdates 同一形状）', () => {
    const w = mkWorld();
    const prose = tagIt(['【变化】薛铁衣｜实力｜踏入元婴']);
    const st = registerDialogueFacts(w, { facts: extractTags(prose, CTX), dialogue: prose, tick: 7 });
    assert.equal(st.updates, 1);
    const ent = w.entities.find((e) => e.id === 'e_xue');
    assert.equal(ent.实力, '踏入元婴', '★值**逐字**落格（不是 9999：宁可文本，不做换算）');
    const rec = w.meta.entityFields.e_xue.fields.实力;
    assert.equal(rec.value, '踏入元婴');
    assert.equal(rec.prev, undefined, '★原值如实留痕（这一格原来没有值 ⇒ undefined，不许编一个默认值）');
    assert.equal(rec.cause, w.events[0].id, '★必带因：因就是同轮注册的那条事件');
    assert.equal(rec.tick, 7);
    assert.equal(w.events[0].proseQuote, '【变化】薛铁衣｜实力｜踏入元婴', '★逐字回执（正文里那句原话）');
});

// ── ★★★leg199：那一格的**值口径**（用户实机报的病，两轮更正）──────────────────
//   病（用户第一轮原话）：「**正文标签里给一个角色修改实力字段，但是不是写从筑基到金丹这样修改，
//   而是写获取了资源然后大幅提升了当前实力**」——模型把**过程**当值写进第三格，
//   而"值必须在正文里找得到"那道机械校验**拦不住它**（那句话确实在正文里）⇒
//   账上「实力」那一格从此是一句**没有内容的空话**。
//   ★★第二轮更正（逐字）：「**实力按道理来说如果有境界那么应该是境界的变化，
//   而不是一句抽象的实力大增**」——只讲"状态 vs 过程"**不够**：模型可以不写过程、改写成
//   「实力大增」这种**抽象的变强总结**，那一格照样说不出他什么水平。
//   ⇒ 治法（`web/inject.js` 的 `tagSpecText()` 第 7 条）两层：
//     ① 第三格是**变完之后那一格的值**（新状态），不是**过程**；
//     ② ★**变强/突破时要写书里那套档位的名字**（境界/等级/品阶/军阶…），**不许**写抽象的变强总结；
//     并把示例从过程式的「踏入元婴」改成状态式的「元婴期」。
//   ★★为什么这两条只能靠规范：引擎侧**判不出**"金丹"与"实力大增"哪个是档位名——
//     那是"用词表判语义"，`ANCHOR.md` §4.8 明禁。所以下面这一条判据**如实锁住这个代价**。
test('G18b（leg199）：★「实力」那一格要落的是**新状态**——写成过程就是一句空话（两档都咬）', () => {
    // ① 对：正文点出了新状态 ⇒ 落格，且那一格读出来是**一个状态**
    const good = mkWorld();
    const goodProse = tagIt(['【变化】薛铁衣｜实力｜元婴期']);
    const stGood = registerDialogueFacts(good, { facts: extractTags(goodProse, CTX), dialogue: goodProse, tick: 7 });
    assert.equal(stGood.updates, 1);
    assert.equal(good.entities.find((e) => e.id === 'e_xue').实力, '元婴期',
        '★戏里点出的新状态照抄落格（这一格从此能被别的机制当值读）');
    // ② 错（这一档是本判据存在的理由）：过程句同样"在正文里找得到" ⇒ 机械校验放行 ⇒ 它真会落格。
    //    所以这一条**只能靠规范那一句话拦**（红线：不许用词表判语义）——规范判据与它是一对。
    const bad = mkWorld();
    const badProse = tagIt(['【变化】薛铁衣｜实力｜获取了资源然后大幅提升了当前实力']);
    const stBad = registerDialogueFacts(bad, { facts: extractTags(badProse, CTX), dialogue: badProse, tick: 7 });
    assert.equal(stBad.updates, 1,
        '★如实锁住代价：引擎**拦不住**过程句（"值在正文里找得到"这条机械判据对它无效）——'
        + '这正是第 7 条那句话必须写进规范的理由');
    assert.match(bad.entities.find((e) => e.id === 'e_xue').实力, /大幅提升/,
        '★它落进去就是一句没有内容的空话（判据把病照出来，防下一棒以为引擎已经兜住了）');
});

// ── ★★★leg199 补（用户第二次更正）：**有境界的书，要落的是境界那一档**────────────────
//   用户逐字：「**实力按道理来说如果有境界那么应该是境界的变化，而不是一句抽象的实力大增**」。
//   ★这一条与 G18b 是**两件事**：G18b 管"别写过程"，这一条管"**别写成抽象的变强总结**"——
//     后者更隐蔽：它看着像个状态（"实力大增"是完成态），其实**说不出他什么水平**。
//   ★★本判据锁的是"**照抄书里那一档**"这件事在引擎侧真的成立（值逐字落格、能被当值读），
//     而"模型会不会这么写"只能靠规范那一句话（引擎判不出档位名——红线 §4.8）。
test('G18c（leg199）：★有境界的书——突破要落**书里那一档的名字**（筑基 → 金丹）', () => {
    // 账上开局是「筑基期」，正文写他突破到金丹
    const w = mkWorld();
    w.entities.find((e) => e.id === 'e_xue').实力 = '筑基期';
    const prose = tagIt(['【变化】薛铁衣｜实力｜金丹期']);
    const st = registerDialogueFacts(w, { facts: extractTags(prose, CTX), dialogue: prose, tick: 7 });
    assert.equal(st.updates, 1, '★档位名照抄 ⇒ 落格');
    const ent = w.entities.find((e) => e.id === 'e_xue');
    assert.equal(ent.实力, '金丹期', '★★那一格现在是**书里那一档的名字**（能被别的机制当值读、能比大小）');
    const rec = w.meta.entityFields.e_xue.fields.实力;
    assert.equal(rec.prev, '筑基期', '★原值一起留痕 ⇒ 这一格**自己就说得清"从哪一档到哪一档"**');
    // ★反面：抽象的变强总结同样会落格（引擎拦不住）——所以它**必须**被规范那一句话挡在门外。
    const w2 = mkWorld();
    w2.entities.find((e) => e.id === 'e_xue').实力 = '筑基期';
    const prose2 = tagIt(['【变化】薛铁衣｜实力｜实力大增']);
    const st2 = registerDialogueFacts(w2, { facts: extractTags(prose2, CTX), dialogue: prose2, tick: 7 });
    assert.equal(st2.updates, 1, '★如实锁住代价：抽象总结照旧落格（引擎判不出它是不是档位名）');
    assert.equal(w2.entities.find((e) => e.id === 'e_xue').实力, '实力大增',
        '★它落进去，这一格从此说不出他什么水平——判据把病照出来');
});

test('G19：★★值必须在正文里找得到——找不到的（换算/编出来的）一律不收', () => {
    const w = mkWorld();
    // ★这一条是"不许把词换算成数"唯一能做成的**机械**判据：
    //   值连正文里都没有 ⇒ 一定不是照抄来的。
    const st = registerDialogueFacts(w, {
        facts: { changes: [{ entityId: 'e_xue', field: '实力', value: '9999', raw: '【变化】薛铁衣｜实力｜9999' }] },
        dialogue: '他只是站着，什么也没说。',
        tick: 7,
    });
    assert.equal(st.updates, 0, '★值在正文里找不到 ⇒ 不落格');
    assert.equal(st.dropped, 1, '★丢了什么必须能被看见（不许静默）');
    assert.equal(w.entities.find((e) => e.id === 'e_xue').实力, undefined, '账上一个字节都没动');
    assert.equal(w.events.length, 0, '★也不给它注册事件：不许"记了事实却没落格"（账与自己说的话要一致）');
});

// ★★★leg136（用户令「不要搞那么多闸了」）：**这一则随 `DIALOGUE_UPDATE_CAP` 作废而重造**。
//   旧前提「超过每轮上限的整条不进」**已不成立**（上限撤了）——照 leg135 §2.4 那条纪律，
//   夹具必须同批改，否则这一则会**静默失去意义**。
//   新前提（拆成两半，各咬一件事）：
//     ① **同轮同实体同格仍然只落一次**（那条去重**不是**配额，照旧在）；
//     ② **不再有"每轮几个格"的上限** ⇒ 8 个**不同的格**一个都不许少。
test('G20：★同轮同实体同格只落一次（去重照旧）；每轮格数**不再有上限**（原配额已作废）', () => {
    // ① 去重：同一实体、同一格、连着来 8 条 ⇒ 只落第 1 条
    const w = mkWorld();
    const dup = {
        changes: Array.from({ length: 8 }, (_, i) => ({
            entityId: 'e_xue', field: '身份', value: `第${i}个身份`, raw: `【变化】薛铁衣｜身份｜第${i}个身份`,
        })),
    };
    const proseDup = dup.changes.map((c) => c.raw).join('\n');
    const st = registerDialogueFacts(w, { facts: dup, dialogue: proseDup, tick: 7 });
    assert.equal(st.updates, 1, '★同一实体同一格一轮只落一次（后面的都是"同一格"，全丢）');
    assert.ok(st.dropped >= 1);
    assert.equal(DIALOGUE_UPDATE_CAP, Infinity, '常量本身如实标着"已作废"');

    // ② 不封顶：8 个**不同的格** ⇒ 8 个全落（旧口径下只会落 6 个、静默丢 2 个）
    //   ★格名要过"类别"校验（角色的格 ≠ 势力的格），故按类别配：
    //     e_xue 四个角色格 · e_men 三个势力格 · e_p1 一个角色格 = 8
    const w2 = mkWorld();
    const pairs = [['e_xue', '身份'], ['e_xue', '所属'], ['e_xue', '定位'], ['e_xue', '实力'],
        ['e_men', '性质'], ['e_men', '倾向'], ['e_men', '规模'], ['e_p1', '身份']];
    const nameOf = { e_xue: '薛铁衣', e_men: '天门', e_p1: '黄坤' };
    const many = {
        changes: pairs.map(([id, f], i) => ({ entityId: id, field: f, value: `值${i}`, raw: `【变化】${nameOf[id]}｜${f}｜值${i}` })),
    };
    const proseMany = many.changes.map((c) => c.raw).join('\n');
    const st2 = registerDialogueFacts(w2, { facts: many, dialogue: proseMany, tick: 7 });
    assert.equal(st2.updates, 8, '★8 个不同的格 ⇒ 8 个全落（"一轮里改了几个格"是戏里真发生的事，引擎不替它定上限）');
    assert.equal(st2.capped, 0, '★一条都没被配额吃掉');
});

// ── ⑥b ★★★leg159（用户令「立项治：值没变就不落账」）：**跨轮空转** ──────────────────
// 病（leg158 在用户那份真账上量到的，见交接 §3.1①）：正文里同一句
//   `【变化】黄坤｜身份｜确立江州实际掌控者地位` 在第 1/2/3 轮各出现一次
//   ⇒ 落成 **三件同名事件**（`ev_1_500`/`ev_2_500`/`ev_3_501`），而账上那格**从第 1 轮起就是它**。
//   ★代价不止"多两行"：「万子明」入局正是因它而生的，`ch_3_ev_9` 也是沿着这条空转事件长出来的。
// 根因：`registerDialogueFacts` 只在**同一轮内**去重（`wrote` 表，键＝`实体|格`）——跨轮没有任何一道。
// 口径（用户原话「**值没变就不落账**」）：**该实体该格的值已经等于新值（逐字比，比之前去掉首尾空白）
//   ⇒ 不落事件、不写编年、不进 `wrote`**，只在读数里记一格 `noop`。
//   ★与红线 2（"空着就是空着"）不冲突：这一条**不改任何值**，只是不落一件没发生的事。
//   ★★不许在渲染层打补丁：那会让"账上是三条、面板上两条"——正是本仓最忌的"两个真相"。
const CHG = (who, field, value) => `【变化】${who}｜${field}｜${value}`;
const factsOf = (lines) => extractTags(tagIt(lines), CTX);
// 一轮 = 一条正文＋同一条正文里那几条【变化】；`tick` 逐轮加一（与 `runTick` 的 `meta.tick + 1` 同口径）
const turn = (world, lines, tick) => registerDialogueFacts(world, { facts: factsOf(lines), dialogue: tagIt(lines), tick });

test('G29：★★★同一处变化连着三轮重复落账 ⇒ 只留第一件（跨轮空转不许再落账）', () => {
    const w = mkWorld();
    const line = CHG('黄坤', '身份', '确立江州实际掌控者地位');   // ★真账里那一句的逐字形状
    const s1 = turn(w, [line], 1);
    assert.equal(s1.updates, 1, '★第 1 轮：账上那格原来是空的 ⇒ 这是**真变化**，照落');
    assert.equal(s1.events, 1, '★第一件事件照旧（这一条不许"顺手把第一次也吞了"）');
    assert.equal(s1.noop, 0, '★第一轮不是空转');
    const s2 = turn(w, [line], 2);
    const s3 = turn(w, [line], 3);
    assert.equal(s2.updates + s3.updates, 0, '★第 2/3 轮：格上已经是这句话 ⇒ 一个格都不许再落');
    assert.equal(s2.events + s3.events, 0, '★★★病根就在这一格：原来这里落成第 2、第 3 件同名事件');
    assert.equal(s2.noop, 1, '★空转要留痕（读数行靠它说"模型重复说了几遍"）');
    assert.equal(s3.noop, 1);
    assert.equal(w.events.length, 1, `★账上只留第 1 轮那一件（实际 ${w.events.length} 件）`);
    assert.equal(w.chronicle.length, 1, '★编年也不许长出第二行（它是"往下长"的入口：真账里 `ch_3_ev_9` 就是从这条空转事件长出来的）');
    assert.equal((w.meta.entityFields.e_p1.fields.身份 || {}).tick, 1, '★留痕仍是第 1 轮的因，不许被后两轮改写');
});

test('G30：★★值**真变了** ⇒ 照旧落账（反向自证：防"一律不落"）', () => {
    const w = mkWorld();
    turn(w, [CHG('黄坤', '身份', '江州话事人')], 1);
    turn(w, [CHG('黄坤', '身份', '江州话事人')], 2);          // 空转那一轮（本条判据的对照项）
    const s3 = turn(w, [CHG('黄坤', '身份', '大虞江州牧')], 3);
    assert.equal(s3.updates, 1, '★值变了就是真变化 ⇒ 必须落（"一律不落"会把真事吃掉）');
    assert.equal(s3.noop, 0, '★这一轮不是空转');
    assert.equal(w.entities.find((e) => e.id === 'e_p1').身份, '大虞江州牧', '★格上是新值');
    assert.equal(w.events.length, 2, '★两件事件：第 1 轮那件 ＋ 第 3 轮那件（第 2 轮是空转，不落）');
});

test('G31：★★跨轮空转的计数与账上真落下的件数**对得上**（读数行不许是一笔糊涂账）', () => {
    // ★这条防的是"读数说空转了 2 次，账上却多了 3 件"——本仓最忌的"一个数两把尺子"。
    const w = mkWorld();
    const line = CHG('黄坤', '身份', '江州话事人');
    let noop = 0, updates = 0, changes = 0;
    for (let i = 1; i <= 4; i += 1) {
        const s = turn(w, [line], i);
        noop += s.noop; updates += s.updates; changes += 1;
    }
    assert.equal(noop, 3, '★4 轮里 3 轮是空转');
    assert.equal(updates, 1, '★真落下的只有第 1 轮那一次');
    assert.equal(noop + updates, changes, '★★空转 ＋ 真落 = 正文里那几条【变化】一条不差（这条等式就是"读数不许是糊涂账"）');
    assert.equal(w.events.length, 1, '★账上事件数 = updates 那一支');
    assert.equal(w.chronicle.length, 1, '★编年行数同样对得上');
});

test('G21：★玩家格**可以**由这条路落（红线 1 禁的是世界步替玩家写，不是禁戏里的既成事实）', () => {
    const w = mkWorld();
    const prose = tagIt(['【变化】黄坤｜身份｜江州话事人']);
    const st = registerDialogueFacts(w, { facts: extractTags(prose, CTX), dialogue: prose, tick: 7 });
    assert.equal(st.updates, 1);
    assert.equal(w.entities.find((e) => e.id === 'e_p1').身份, '江州话事人');
});

test('G22：【承诺】→ 事件（两端进波及名单）——"让世界记住我的事"那一格', () => {
    const w = mkWorld();
    const prose = tagIt(['【承诺】黄坤｜护送薛铁衣回江州｜薛铁衣']);
    const st = registerDialogueFacts(w, { facts: extractTags(prose, CTX), dialogue: prose, tick: 7 });
    assert.equal(st.events, 1);
    assert.deepEqual(w.events[0].ripples, ['e_p1', 'e_xue']);
    assert.match(w.events[0].title, /许下/);
});

test('G23：★时间走**两格**：`【此刻】`→事件与编年行的 `timeMark`（逐字、不带源）', () => {
    const w = mkWorld();
    const prose = tagIt(['【此刻】复苏历三年 三月初七 卯时', '【行动】薛铁衣｜迎战｜黄坤']);
    registerDialogueFacts(w, { facts: extractTags(prose, CTX), dialogue: prose, tick: 7 });
    assert.equal(w.events[0].timeMark, '复苏历三年 三月初七 卯时');
    assert.equal(w.chronicle[0].timeMark, '复苏历三年 三月初七 卯时');
    assert.equal(Object.keys(w.events[0]).includes('timeSource'), false, '★不带源（用户裁定）');
});

test('G24：★★零扰动——没有三族料 ⇒ 账上一个字节都不碰（不建键、不推空数组）', () => {
    const w = mkWorld();
    const before = JSON.stringify(w);
    const st = registerDialogueFacts(w, { facts: null, dialogue: '没有标签的正文', tick: 7 });
    assert.deepEqual(st, { events: 0, updates: 0, noop: 0, dropped: 0, capped: 0 });
    assert.equal(JSON.stringify(w), before, '★一个字节都不许动（老聊天/关着开关的世界逐字节不变）');
});

// ── ⑦ 接线：真跑一次 tick（本仓规矩：纯函数绿 ≠ 实机接线绿）──────────────────────────
test('G25：★★真跑 runTick——标签里的行动与变化**真的落进账**（接线端到端）', async () => {
    const w = mkWorld();
    const dialogue = tagIt(['【此刻】复苏历三年 三月初七', '【行动】薛铁衣｜迎战｜黄坤', '【变化】薛铁衣｜实力｜踏入元婴']);
    const STEP = {
        actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    };
    const r = await runTick({
        transport: async () => ({ text: JSON.stringify(STEP) }),
        ssot: w, dialogue, extractCtx: {}, recall: false,
    });
    assert.equal(r.ok, true, `tick 应当跑通（实际：${r.error || ''}）`);
    const dlg = (r.ssot.events || []).filter((e) => e.source?.type === 'dialogue');
    assert.equal(dlg.length, 2, '行动 1 条 + 变化 1 条 = 两条 dialogue 事件（★注册发生在出包之前）');
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_xue').实力, '踏入元婴', '★格真的落上了（不只是纯函数里成立）');
    assert.equal(r.dialogueStats.events, 2, '★读数随 tick 返回（编排层据此出声）');
    assert.equal(r.dialogueStats.updates, 1);
    assert.equal(dlg[0].timeMark, '复苏历三年 三月初七', '★时间点随事件落账（逐字、不带源）');
    // ★★轮次对齐（本笔实施时当场避开的一个坑）：注册发生在 settle **之前**，而落账轮次是 `meta.tick + 1`
    //   —— 取错就会让同一轮的东西被记到两个轮次上（检索、时间印记、门控三处全错位）。
    assert.ok(dlg[0].id.startsWith('ev_8_'), `★必须与世界步同轮次（实际 ${dlg[0].id}）`);
    assert.ok(r.ssot.chronicle.some((c) => c.id === 'ch_8_dlg_1'), '★编年行同轮次');
    assert.equal(r.ssot.meta.entityFields.e_xue.fields.实力.tick, 8, '★留痕里的轮次也是 8');
});

// ── ⑦b ★★★leg137：**世界侧事件的时间——由模型自己写** ──────────────────────────────
// 用户两条令（第二条把第一版打回了）：
//   ① 「既然这次有了时间，就每次把提取到的时间当作事件的时间」⇒ ★第一版做成"引擎顺延账上最后一个
//      已知时间点"，被用户当场打回：「**要不然所有事件都是同一时刻发生的了**」
//      ——一轮能起十几件事（真账设 `每轮事件=12`），拿一个时刻盖满全场就是**把时间抹平**。
//   ② 「**只要告诉时间流逝的长度和起始，事件的时间字段就由 llm 自己写**」⇒ 定稿：
//      **引擎递尺子**（包里那一栏 `时间`：上一件事的此刻 ＋ 此后又过了）**＋ 模型给每件事写 `at`**。
// ★下面三条是一组，缺一条这一改就散：
//   ① 模型写了 ⇒ **逐字落账**（事件与编年行两处都要，否则检索层拿不到）；
//   ② 模型没写 ⇒ ★**一格都不许造**（尤其不许再"顺延"——那是被用户打回的那一版）；
//   ③ 尺子那一栏：**两格分开摆**（时间点 vs 相对量），★没有就整栏不出现。

const TIME_STEP = (withEvent) => ({
    actions: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    newEvents: withEvent
        ? [{ title: '守将允诺通关', source: { type: 'state' }, position: '忘川渡口', ripples: ['e_xue'], at: '复苏历三年 三月十五' }]
        : [],
});

test('★★★leg137①：模型给的那一格时间**逐字落账**——事件与编年行两处都写（检索层读的是编年）', async () => {
    const w = mkWorld();
    // ★正文那一轮也带【此刻】⇒ 账上"最后一个已知时间点"是有的（但**它不该被顺延给世界侧**）
    const dialogue = tagIt(['【此刻】复苏历三年 三月初七 卯时', '【行动】薛铁衣｜迎战｜黄坤']);
    const r = await runTick({
        transport: async () => ({ text: JSON.stringify(TIME_STEP(true)) }),
        ssot: w, dialogue, extractCtx: {}, recall: false,
    });
    assert.equal(r.ok, true, `tick 应当跑通（实际：${r.error || ''}）`);
    const worldEv = (r.ssot.events || []).find((e) => e.source?.type === 'state');
    assert.ok(worldEv, '★世界侧事件应当落账（本条判据的前提）');
    assert.equal(worldEv.timeMark, '复苏历三年 三月十五',
        '★★模型写的那一格**逐字**落账（引擎不校验、不换算、不改字）');
    assert.notEqual(worldEv.timeMark, '复苏历三年 三月初七 卯时',
        '★★★**不许顺延**——正文那一轮的此刻是"三月初七"，模型给这件事写的是"三月十五"；'
        + '拿前者盖上去就是被用户打回的那一版（把一轮里所有事件压成同一时刻）');
    // ★编年行那一处也要有：**往事检索真正读的是编年**（只写事件 ⇒ 检索层仍拿不到时间，等于没做）
    const row = (r.ssot.chronicle || []).find((c) => c.eventRef === worldEv.id);
    assert.ok(row, '★世界侧事件对应的编年行应当在（链视图/检索层要它）');
    assert.equal(row.timeMark, '复苏历三年 三月十五', '★编年行与事件**同一个时间点**（两处必须一致）');
    // ★聊天侧那条路一个字没动：它仍然是【此刻】抄来的
    const dlgEv = (r.ssot.events || []).find((e) => e.source?.type === 'dialogue');
    assert.equal(dlgEv.timeMark, '复苏历三年 三月初七 卯时', '★聊天侧照旧走【此刻】（leg123 那条路不动）');
});

test('★★★leg137②：模型**没写** ⇒ 一格都不许造（红线 2：空着就是空着；★更不许"顺延"）', async () => {
    // ★这条正是用户打回第一版的那个病：引擎拿账上最后一个时刻盖满本轮所有事件。
    //   ⇒ 现在必须**什么都不写**，哪怕账上明明有已知时间点。
    const w = mkWorld();
    const dialogue = tagIt(['【此刻】复苏历三年 三月初七 卯时', '【行动】薛铁衣｜迎战｜黄坤']);
    const step = TIME_STEP(true);
    delete step.newEvents[0].at;                  // ★模型这一件没写时间
    const r = await runTick({
        transport: async () => ({ text: JSON.stringify(step) }),
        ssot: w, dialogue, extractCtx: {}, recall: false,
    });
    assert.equal(r.ok, true, `tick 应当跑通（实际：${r.error || ''}）`);
    const worldEv = (r.ssot.events || []).find((e) => e.source?.type === 'state');
    assert.ok(worldEv, '★世界侧事件照常落账（没有时间不等于不落账）');
    assert.equal(worldEv.timeMark, undefined,
        '★★账上**明明有**已知时间点（三月初七），但模型没给这一件写 ⇒ **一格都不许造**'
        + '（"顺延"就是把一轮压成一个时刻，用户已打回）');
    const row = (r.ssot.chronicle || []).find((c) => c.eventRef === worldEv.id);
    assert.equal(row.timeMark, undefined, '★编年行同样不许造');
    // ★对照：同一轮里聊天侧那条**仍然有时间**（它有自己的来源：正文的【此刻】）
    const dlgEv = (r.ssot.events || []).find((e) => e.source?.type === 'dialogue');
    assert.equal(dlgEv.timeMark, '复苏历三年 三月初七 卯时',
        '★两条路各有各的来源，不许互相顶替（聊天侧照旧、世界侧空着）');
});

test('★★★leg137③：尺子那一栏——**两格分开摆**、**只摆原话**、没有就整栏不出现', () => {
    // ★这一栏是"让模型写得出 at"的前提（用户令②："告诉时间流逝的长度和起始"）。
    const mk = (chronicle, elapsed) => ({
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '中央' }],
        agendas: [], events: [], weights: {}, chronicle,
        context: { world: '测试界', positions: ['中央'] }, meta: { tick: 5 },
    });
    // ① 两样都有 ⇒ 两格分开摆（★不许合成一句——合成就把"三月后以谁为基准"那个歧义带回来了）
    const p1 = buildEvolutionPack(mk([{ tick: 1, text: '事件「甲事」——由世界处境而生，事发 中央', timeMark: '复苏历三年 八月中' }]), null,
        { turnFacts: { elapsed: '三月后' } }).pack;
    assert.ok(p1.时间, '★有料 ⇒ 这一栏在');
    assert.equal(p1.时间.此刻, '复苏历三年 八月中', '★"上一件事发生在什么时候"（时间点）');
    assert.equal(p1.时间.此后又过了, '三月后', '★"此后又过了多久"（相对量，**照抄原话不换算**）');
    assert.equal(Object.keys(p1.时间).length, 2, '★只这两格（多一格就是新造字段）');
    // ② 只有时间点 ⇒ 那一栏照在，另一格**不出现**（不许填空值占位）
    const p2 = buildEvolutionPack(mk([{ tick: 1, text: '事件「甲事」——由世界处境而生，事发 中央', timeMark: '复苏历三年 八月中' }]), null, {}).pack;
    assert.equal(p2.时间.此刻, '复苏历三年 八月中');
    assert.equal('此后又过了' in p2.时间, false, '★没有时长 ⇒ 那一格不出现（红线 2）');
    // ③ 两样都没有 ⇒ **整栏不出现**（空着就是空着）
    const p3 = buildEvolutionPack(mk([{ tick: 1, text: '事件「甲事」——由世界处境而生，事发 中央' }]), null, {}).pack;
    assert.equal('时间' in p3, false, '★★账上没有任何时间、正文也没写时长 ⇒ 这一栏**根本不挂**');
});

// ── ⑧ 结构三条：先正文、后世界（细案 §2.6；用户原话「有冲突就说明本来就错了」）────────────
import { gateWorldStep } from '../src/gate.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';

const SEVEN = () => ({
    actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});
const dlgEvent = (sub, target, kind = 'action') => ({
    id: `ev_10_${DIALOGUE_EVENT_BASE}`, title: '正文里的事', source: { type: 'dialogue' },
    dialogueKind: kind, ripples: [sub, target].filter(Boolean), links: { up: [], down: [] }, closed: false,
});

// ★★★leg159 接线：**空转那一件要在读数行里出声**（不然玩家会把它读成"插件又漏记了"）。
//   与 G31 的分工：G31 锁的是**引擎账**对得上（纯函数），这一条锁的是**玩家看得见的那行字**
//   ——真跑 `runTick` 两轮：第 1 轮真落，第 2 轮同一句话（空转）。
test('G32：★★真跑 runTick——跨轮空转那一件在读数行里说清（且与"丢"分开报）', async () => {
    const w = mkWorld();
    const line = CHG('黄坤', '身份', '确立江州实际掌控者地位');
    const STEP0 = { actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] };
    const run = (dialogue) => runTick({ transport: async () => ({ text: JSON.stringify(STEP0) }), ssot: w, dialogue, extractCtx: {}, recall: false });
    // 第 1 轮：账上原来没有这一格 ⇒ 真落一件
    const r1 = await run(tagIt([line]));
    assert.equal(r1.ok, true, `第 1 轮应当跑通（实际：${r1.error || ''}）`);
    assert.equal(r1.dialogueStats.updates, 1, '★前提：第 1 轮真落了');
    assert.equal(r1.dialogueStats.noop, 0);
    // 第 2 轮：同一句话又来一遍 ⇒ 空转，账上一件不多（★账接着第 1 轮那份跑，不是新开一局）
    const r2 = await runTick({
        transport: async () => ({ text: JSON.stringify(STEP0) }), ssot: r1.ssot, dialogue: tagIt([line]), extractCtx: {}, recall: false,
    });
    assert.equal(r2.ok, true, `第 2 轮应当跑通（实际：${r2.error || ''}）`);
    assert.equal(r2.dialogueStats.events, 0, '★第 2 轮一件都不落');
    assert.equal(r2.dialogueStats.noop, 1, '★空转记账：1 件');
    assert.equal((r2.ssot.events || []).filter((e) => e.source?.type === 'dialogue').length, 1,
        `★账上那条路只有第 1 轮那一件（实际 ${(r2.ssot.events || []).filter((e) => e.source?.type === 'dialogue').length} 件）`);
    // 读数行：**"没变化"与"丢"是两笔**——混成一句会让玩家以为插件漏记了
    assert.ok(/没变化/.test(r2.tagReadout), `★读数行必须说清"这几件没变化、所以没落账"（实际：${r2.tagReadout}）`);
    assert.ok(/没落账/.test(r2.tagReadout), '★而且要说"没落账"——它是**如实**，不是"丢了"');
    assert.equal(/丢/.test(r2.tagReadout), false, '★★一个"丢"字都不许有：它不是丢（丢＝那条没法用），是本来就没发生新事');
});

test('G26：★★门控不再与提示词打架——被正文点到的人获得"应答资格"', () => {
    const w = mkWorld();
    w.meta.tick = 10;
    // ★让黄坤成为"久未出手、手上无盘算、没人点名"的静默者；★排第三，避开"世界序首个实体保送"
    w.entities = [
        { id: 'e_men', kind: 'faction', name: '天门', location: '江州城', status: 'active' },
        { id: 'e_xue', kind: 'character', name: '薛铁衣', location: '忘川渡口', status: 'active' },
        { id: 'e_p1', kind: 'character', name: '黄坤', location: '忘川渡口', status: 'active' },
    ];
    const step = { ...SEVEN(), actions: [{ entity: 'e_p1', verb: '应战' }] };
    const before = gateWorldStep(step, w, null, null);
    assert.equal(before.step.actions.length, 0, '★没人点到他 ⇒ 他静默，提议被丢（旧行为）');
    w.events = [dlgEvent('e_xue', 'e_p1')];            // 正文里：薛铁衣迎战黄坤
    const after = gateWorldStep(step, w, null, null);
    assert.equal(after.step.actions.length, 1, '★被正文点到 ⇒ 他这一轮该有反应（提示词第 8 条那句话终于被门认了）');
    assert.ok(after.lifted.includes('e_p1'), '★他是被"点名"解除静默的（不是碰巧活跃）');
});

test('G27：★★世界步不许再让"本轮正文里已经出过手的人"出手（丢 + 留痕）', () => {
    const w = mkWorld();
    w.meta.tick = 10;
    w.events = [dlgEvent('e_xue', 'e_p1')];
    const step = { ...SEVEN(), actions: [{ entity: 'e_xue', verb: '再补一刀' }, { entity: 'e_men', verb: '观望' }] };
    const r = dropInvalidProposals(step, w);
    assert.equal(r.step.actions.length, 1, '★只有没出过手的那个留下（同一轮不许被模拟两遍）');
    assert.equal(r.step.actions[0].entity, 'e_men');
    assert.ok(r.dropped.some((d) => d.family === 'actions' && /已经出过手/.test(d.reason)), '★丢了什么要报出来');
});

test('G28：★★"改过格的人不算出过手"＋"本轮已改定的格不许再改"（两条分开）', () => {
    const w = mkWorld();
    w.meta.tick = 10;
    w.events = [dlgEvent('e_xue', null, 'change')];    // 正文只是**改了他的格**，他没动手
    w.meta.entityFields = {
        e_xue: { fields: { 实力: { value: '踏入元婴', prev: undefined, cause: `ev_10_${DIALOGUE_EVENT_BASE}`, causeType: 'event', tick: 10, source: '变更' } } },
    };
    const step = {
        ...SEVEN(),
        actions: [{ entity: 'e_xue', verb: '再战' }],                       // ★他可以被世界模型调动（没出过手）
        entityUpdates: [
            { entity: 'e_xue', field: '实力', value: '更强', cause: { type: 'event', ref: `ev_10_${DIALOGUE_EVENT_BASE}` } },   // ★撞车 ⇒ 丢
            { entity: 'e_xue', field: '身份', value: '客卿', cause: { type: 'event', ref: `ev_10_${DIALOGUE_EVENT_BASE}` } },   // 另一格 ⇒ 留
        ],
    };
    const r = dropInvalidProposals(step, w);
    assert.equal(r.step.actions.length, 1, '★"被改过格" ≠ "出过手"：他仍可被世界模型调动');
    assert.equal(r.step.entityUpdates.length, 1, '★撞车的那一格丢掉');
    assert.equal(r.step.entityUpdates[0].field, '身份');
    assert.ok(r.dropped.some((d) => d.family === 'entityUpdates' && /已由正文落定/.test(d.reason)));
});


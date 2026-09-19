// story-world-v2/test/ref-rules.test.js
// ★★★leg67（甲案 · 用户 2026-09-18 拍板「所以我才想要优化项目结构，交接给下一任做吧」）：
//   **引用完整性单一主人**的判据——细案 `docs/plan-structure-optimization.md` §2.3 的 M1–M4 四条。
//
// 这一棒治的病（细案 §1.3：leg66 两天三条 bug 同一个根）：
//   「**这个号在此时此地能不能这么用**」原先散在**五处**手写（`check-step` / `sanitize-step` /
//   `settle` / `schemas/world-step.schema.js` / `prompts.js`+`gate.js` 的注释），每处都能各自说话。
//   ★本仓**实测到两处已经长歪**（不是理论担忧）：
//     · `newEntities.source.type==='entity'` 引**已灭**实体 ⇒ `check-step` **拒整步**、
//       `sanitize-step` **只丢那一条**（同一份输入、两种后果）。
//     · 已了结事件的文案两处已各自漂移（"已经了结" vs "已了结"）。
//   ⇒ 收口后：**判据只有一处实现**，四个消费口都必须问它（M1/M2 锁着）。
//
// ★本文件的判据形态纪律（照 leg61/leg64 的同一把尺）：夹具全是**自造记号**
//   （`e_a`/`ev_2_1`/`甲`…），不抄大荒/三国/实教的任何原话——"换一本书照样成立"这条锁才算锁住了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    judgeRef, renderVerdict, REF_POINTS, REF_RULES, SOURCE_TYPES,
    resolveRefTarget, findFateEventSource, captureOpenCauseState, newEventIdsOf, eventOrdinal,
} from '../src/ref-rules.js';
import { checkWorldStep } from '../src/check-step.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { settleTick } from '../src/settle.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';

const ROOT = new URL('..', import.meta.url);

// ═══════════════ 夹具：一份最小账（每个源型都有"合法/不存在/已了结"三种靶子） ═══════════════
const world = () => ({
    version: 1,
    context: {
        world: 'W', tension: 0.5, playerId: 'e_you', positions: ['甲地'],
        setting: { frozen: { canon: { bookEntities: [{ name: '书里有' }] } } },
    },
    entities: [
        { id: 'e_a', name: '甲', kind: 'character', status: 'active' },
        { id: 'e_b', name: '乙', kind: 'character', status: 'active' },
        { id: 'e_dead', name: '丙', kind: 'character', status: 'dead' },
        { id: 'e_you', name: '你', kind: 'character', status: 'active' },
    ],
    agendas: [
        { id: 'a_open', owner: 'e_a', goal: '在办的事', closed: false },
        { id: 'a_closed', owner: 'e_a', goal: '办完的事', closed: true, closedAt: 3 },
    ],
    events: [
        { id: 'ev_2_1', title: '开着的一件事', closed: false, ripples: ['e_a'] },
        { id: 'ev_2_2', title: '已经办完的一件事', closed: true, closedAt: 2, ripples: ['e_a'] },
    ],
    milestones: [{ ids: ['ev_1_9'] }],
    chronicle: [], weights: {},
    meta: { tick: 2, dialogueBook: { 白小娥: 3 } },
});

const emptyStep = (over = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [], newAgendas: [],
    agendaCancels: [], newEntities: [], entityFates: [], ...over,
});

/** 判官的直接调用口（夹具里 bookNames/booked 是"账推出来的"，与两个消费口同源）。 */
const ask = (point, source, w = world(), extra = {}) => judgeRef(point, source, {
    world: w, step: emptyStep(), bookNames: new Set(['书里有']), booked: new Set(['白小娥']), ...extra,
});

// ═══════════════ ① 判据表自检：结构完整、每个源型都有判据 ═══════════════
test('★leg67 判据表：引用点齐备，且每个源型都有判据（表里没有"漏掉的那一格"）', () => {
    // 前五个 = 细案 §2.2 点名的五个引用点；第六个 = M2b 源码锁当场照出来的漏网（取消通道）。
    assert.deepEqual([...REF_POINTS], [
        'newAgendas.source', 'newEntities.source', 'entityFates.source', 'newEvents.source',
        'entityFates.entity', 'entityUpdates.entity', 'newEntities.entity',
        'actions.entity', 'newAgendas.entity', 'newEvents.ripples',
        'agendaAdvances.agendaId', 'agendaCancels.agendaId', 'entityUpdates.cause',
        // ★leg95：模型收场通道（`eventClosures`）——治种子链"永远闭不了"那道结构死锁。
        //   它与 `entityUpdates.cause` **正相反**：那个要求"因必须还没了结"，这个要求"只能收还没收场的"。
        'eventClosures.event',
    ]);
    for (const p of REF_POINTS) {
        const types = SOURCE_TYPES[p];
        assert.ok(types.length >= 1, `${p} 至少要认一种源型`);
        for (const t of types) {
            assert.equal(typeof REF_RULES[p][t], 'function', `${p}.${t} 必须是判据函数`);
        }
    }
    // 未知引用点**必须响亮地炸**（不许静默返回"合法"——那会让"漏问一处"看起来像通过）
    assert.throws(() => judgeRef('nope.source', { type: 'event', ref: 'x' }, { world: world() }), /未知引用点/);
});

test('★leg67 判据表 ⇄ 契约层：源码里写死的 enum 必须与判据表认的源型**逐字相同**', () => {
    // 这条锁的是"模型看到的法律"与"引擎执行的法律"不许是两套（细案 §2.1 的"契约"那一处）。
    // ★取法必须**取那个字段自己的 source 块**：整份 schema 里 enum 不止一处
    //   （`visibility`/`kind`/`verdict` 都有），按"第一处 enum"取会取错——本棒第一版就是这么错的。
    const schema = readFileSync(new URL('../src/schemas/world-step.schema.js', import.meta.url), 'utf8');
    // ★正则对空白宽松（源码里各字段块的缩进不统一：`newEntities` 那条的换行与别处不同）
    const ENUM_RE = /type:\s*\{\s*kind:\s*'string',\s*enum:\s*\[([^\]]+)\]/;
    const enumsOfSource = (propName) => {
        const at = schema.indexOf(`\n        ${propName}: {`);
        assert.ok(at > 0, `契约里找不到顶层的 ${propName}`);
        // 该字段块里 `source` 块距字段头最远约 1.9k 字符（`newEntities` 是四型最长的那个）
        //   ⇒ 窗口必须给够：本棒第一版用 2000，**刚好差一点**（`source.type` 那行落在窗口外）
        //     ——那种失败长得像"正则写错了"，实际是窗口太窄。故这里给 6000 并把边界写成断言。
        const seg = schema.slice(at, at + 6000);
        const sAt = seg.indexOf('source: {');
        assert.ok(sAt >= 0, `${propName} 里找不到 source 块`);
        const srcSeg = seg.slice(sAt);
        assert.ok(srcSeg.includes('enum:'),
            `${propName} 的 source 块里没有 enum（窗口 ${6000} 是否太窄？source 距字段头 ${sAt} 字符）`);
        const m = ENUM_RE.exec(srcSeg);
        assert.ok(m, `${propName}.source.type 的 enum 没找到`);
        return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
    };
    const enumsOfCause = () => {
        const at = schema.indexOf('\n        entityUpdates: {');
        assert.ok(at > 0, '契约里找不到 entityUpdates');
        const seg = schema.slice(at, at + 6000);
        const cAt = seg.indexOf('cause: {');
        assert.ok(cAt >= 0, 'entityUpdates 里找不到 cause 块');
        const m = ENUM_RE.exec(seg.slice(cAt));
        assert.ok(m, 'entityUpdates.cause.type 的 enum 没找到');
        return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).sort();
    };
    assert.deepEqual(enumsOfSource('newAgendas'), [...SOURCE_TYPES['newAgendas.source']].sort(), 'newAgendas 源型');
    assert.deepEqual(enumsOfSource('newEntities'), [...SOURCE_TYPES['newEntities.source']].sort(), 'newEntities 源型');
    assert.deepEqual(enumsOfSource('entityFates'), [...SOURCE_TYPES['entityFates.source']].sort(), 'entityFates 源型');
    assert.deepEqual(enumsOfSource('newEvents'), [...SOURCE_TYPES['newEvents.source']].sort(), 'newEvents 源型');
    assert.deepEqual(enumsOfCause(), [...SOURCE_TYPES['entityUpdates.cause']].sort(), 'entityUpdates 因型');
});

// ═══════════════ ② M1：四个消费口结论**逐字一致** ═══════════════
// 喂同一组引用给"校验面（checkWorldStep）"与"净化面（dropInvalidProposals）"，
// 两边的**判据 code** 必须一致 ⇒ 同一个号不可能"这边拒整步、那边只丢一条"。
// ★夹具组数 = **52 组**（M1_CASES 的长度；断言它，免得日后删夹具把覆盖悄悄削薄）。
const M1_CASES = [
    // [引用点, 源, 期望判据 code（null = 合法）]
    ['newAgendas.source', { type: 'event', ref: 'ev_2_1' }, null],
    ['newAgendas.source', { type: 'event', ref: 'ev_2_2' }, 'event-closed-agenda'],
    ['newAgendas.source', { type: 'event', ref: 'ev_nope' }, 'event-missing'],
    ['newAgendas.source', { type: 'parent', ref: 'a_open' }, null],
    ['newAgendas.source', { type: 'parent', ref: 'a_closed' }, 'parent-agenda-closed'],
    ['newAgendas.source', { type: 'parent', ref: 'a_nope' }, 'parent-agenda-missing'],
    ['newAgendas.source', { type: 'state' }, null],
    ['newAgendas.source', { type: 'state', ref: 'x' }, 'state-source-has-ref'],
    ['newEntities.source', { type: 'event', ref: 'ev_2_1' }, null],
    ['newEntities.source', { type: 'event', ref: 'ev_2_2' }, 'event-closed-entity'],
    ['newEntities.source', { type: 'event', ref: 'ev_nope' }, 'event-missing'],
    ['newEntities.source', { type: 'book', ref: '书里有' }, null],
    ['newEntities.source', { type: 'book', ref: '书里没有' }, 'book-source-missing'],
    ['newEntities.source', { type: 'dialogueFact', ref: '白小娥' }, null],
    ['newEntities.source', { type: 'dialogueFact', ref: '甲' }, 'dialogue-fact-already-in-ledger'],
    ['newEntities.source', { type: 'dialogueFact', ref: '没人提过' }, 'dialogue-fact-missing'],
    ['newEntities.source', { type: 'entity', ref: 'e_a' }, null],
    ['newEntities.source', { type: 'entity', ref: 'e_dead' }, 'entity-source-dead'],
    ['newEntities.source', { type: 'entity', ref: 'e_nope' }, 'entity-source-missing'],
    ['entityFates.source', { type: 'event', ref: 'ev_2_1' }, null],
    ['entityFates.source', { type: 'event', ref: 'ev_1_9' }, null],          // ★归档入纪者亦可
    ['entityFates.source', { type: 'event', ref: 'ev_nope' }, 'fate-event-missing'],
    ['entityFates.source', { type: 'agenda', ref: 'a_open' }, null],
    ['entityFates.source', { type: 'agenda', ref: 'a_nope' }, 'agenda-source-missing'],
    ['newEvents.source', { type: 'ripple', ref: 'ev_2_1' }, null],
    ['newEvents.source', { type: 'ripple', ref: 'ev_nope' }, 'ripple-event-missing'],
    ['newEvents.source', { type: 'plot', ref: 'a_open' }, null],
    ['newEvents.source', { type: 'plot', ref: 'a_nope' }, 'plot-agenda-missing'],
    ['newEvents.source', { type: 'state' }, null],
    ['entityUpdates.cause', { type: 'event', ref: 'ev_2_1' }, null],
    ['entityUpdates.cause', { type: 'event', ref: 'ev_2_2' }, 'cause-closed-before-batch'],
    ['entityUpdates.cause', { type: 'event', ref: 'ev_nope' }, 'cause-event-missing'],
    ['entityUpdates.cause', { type: 'agenda', ref: 'a_open' }, null],
    ['entityUpdates.cause', { type: 'agenda', ref: 'a_closed' }, 'cause-agenda-settled'],
    ['entityUpdates.cause', { type: 'agenda', ref: 'a_nope' }, 'cause-agenda-missing'],
    // ★leg67 甲-余：新收进的五个"存在性"引用点（在册 / 不在册各一组）
    ['actions.entity', { type: 'id', ref: 'e_a' }, null],
    ['actions.entity', { type: 'id', ref: 'e_nope' }, 'actor-entity-missing'],
    ['newAgendas.entity', { type: 'id', ref: 'e_a' }, null],
    ['newAgendas.entity', { type: 'id', ref: 'e_nope' }, 'owner-entity-missing'],
    ['newEntities.entity', { type: 'id', ref: 'e_a' }, null],
    ['newEntities.entity', { type: 'id', ref: 'e_nope' }, 'proposer-entity-missing'],
    ['entityFates.entity', { type: 'id', ref: 'e_a' }, null],
    ['entityFates.entity', { type: 'id', ref: 'e_nope' }, 'fate-entity-missing'],
    ['entityUpdates.entity', { type: 'id', ref: 'e_a' }, null],
    ['entityUpdates.entity', { type: 'id', ref: 'e_nope' }, 'update-entity-missing'],
    ['newEvents.ripples', { type: 'item', ref: 'e_a' }, null],
    ['newEvents.ripples', { type: 'item', ref: 'e_nope' }, 'ripple-entity-missing'],
    ['agendaAdvances.agendaId', { type: 'id', ref: 'a_open' }, null],
    ['agendaAdvances.agendaId', { type: 'id', ref: 'a_nope' }, 'advance-agenda-missing'],
    ['agendaCancels.agendaId', { type: 'id', ref: 'a_open' }, null],
    ['agendaCancels.agendaId', { type: 'id', ref: 'a_closed' }, 'cancel-agenda-closed'],
    ['agendaCancels.agendaId', { type: 'id', ref: 'a_nope' }, 'cancel-agenda-missing'],
    // ★leg95：收场通道三格——开着的能收、已收过的不许重收、不在册的不许收
    ['eventClosures.event', { type: 'id', ref: 'ev_2_1' }, null],
    ['eventClosures.event', { type: 'id', ref: 'ev_2_2' }, 'closure-event-closed'],
    ['eventClosures.event', { type: 'id', ref: 'ev_nope' }, 'closure-event-missing'],
];

/** 把一条引用包装成"只在那一格用"的世界步（其余组留空 ⇒ 别的闸不会插嘴）。 */
function stepFor(point, source, w) {
    const owner = 'e_a';
    const ref = source?.ref;
    if (point === 'newAgendas.source') return emptyStep({ newAgendas: [{ entity: owner, goal: 'g', visibility: 'known', source }] });
    if (point === 'newEntities.source') return emptyStep({ newEntities: [{ name: '新人', source }] });
    if (point === 'entityFates.source') return emptyStep({ entityFates: [{ entity: 'e_a', verdict: 'dead', source }] });
    if (point === 'newEvents.source') return emptyStep({ newEvents: [{ title: 't', position: '甲地', source }] });
    if (point === 'entityUpdates.cause') {
        void w;
        return emptyStep({ entityUpdates: [{ entity: 'e_a', field: '实力', value: 'X', cause: source }] });
    }
    // ★leg67 甲-余 新收进的五格：引用不是一个 `{type,ref}` 源，而是**直接一个号**
    if (point === 'actions.entity') return emptyStep({ actions: [{ entity: ref, verb: '走' }] });
    if (point === 'newAgendas.entity') return emptyStep({ newAgendas: [{ entity: ref, goal: 'g', visibility: 'known', source: { type: 'state' } }] });
    if (point === 'newEntities.entity') return emptyStep({ newEntities: [{ name: '新人', entity: ref, source: { type: 'book', ref: '书里有' } }] });
    if (point === 'entityFates.entity') return emptyStep({ entityFates: [{ entity: ref, verdict: 'dead', source: { type: 'event', ref: 'ev_2_1' } }] });
    if (point === 'entityUpdates.entity') return emptyStep({ entityUpdates: [{ entity: ref, field: '实力', value: 'X', cause: { type: 'event', ref: 'ev_2_1' } }] });
    if (point === 'newEvents.ripples') return emptyStep({ newEvents: [{ title: 't', position: '甲地', source: { type: 'state' }, ripples: [ref] }] });
    if (point === 'agendaAdvances.agendaId') return emptyStep({ agendaAdvances: [{ agendaId: ref, step: '推一步' }] });
    if (point === 'agendaCancels.agendaId') return emptyStep({ agendaCancels: [{ agendaId: ref }] });
    if (point === 'eventClosures.event') return emptyStep({ eventClosures: [{ event: ref, why: '这一段过去了' }] });
    throw new Error(`未覆盖的引用点 ${point}`);
}

test('★leg67 M1：同一组引用喂两个消费口，**结论必须一致**（判据只有一个主人）', () => {
    assert.equal(M1_CASES.length, 55, 'M1 夹具组数（改动它要有意识，别把覆盖悄悄削薄）');
    for (const [point, source, expect] of M1_CASES) {
        const w = world();
        // ① 判官直答
        const direct = ask(point, source, w);
        assert.equal(direct ? direct.code : null, expect,
            `判官直答不一致：${point} ${JSON.stringify(source)} ⇒ ${direct ? direct.code : '合法'}`);

        // ② 校验面（checkWorldStep）：整步拒 vs 放行
        const r = checkWorldStep(stepFor(point, source, w), w);
        const byCheck = !r.ok;
        assert.equal(byCheck, expect !== null,
            `校验面结论与判官不一致：${point} ${JSON.stringify(source)} ⇒ ok=${r.ok} errors=${JSON.stringify(r.errors)}`);

        // ③ 净化面（dropInvalidProposals）：丢那一条 vs 留
        const { dropped } = dropInvalidProposals(stepFor(point, source, world()), world());
        const droppedThisFamily = dropped.filter((d) => d.family === familyOf(point));
        assert.equal(droppedThisFamily.length > 0, expect !== null,
            `净化面结论与判官不一致：${point} ${JSON.stringify(source)} ⇒ dropped=${JSON.stringify(dropped)}`);
    }
});

function familyOf(point) {
    if (point === 'entityUpdates.cause') return 'entityUpdates';
    return point.split('.')[0];
}

test('★leg67 M1b：**判据 code 只有一个来源**——判官与表是同一份对象（不许在消费口重算）', () => {
    for (const [point, source, expect] of M1_CASES) {
        if (expect === null) continue;
        const v = ask(point, source);
        assert.ok(v, `期望不合法，判官却放行：${point} ${JSON.stringify(source)}`);
        assert.equal(v.code, expect);
        // 文案必须由表里的那条给出（不是消费口现编的一句）
        assert.equal(renderVerdict(v), renderVerdict({ ...v }), '文案必须可复现（纯函数）');
    }
});

// ═══════════════ ③ M2：源码锁——判据不许回潮到消费口 ═══════════════
// ★锁的**准确形状**（这一点必须写清楚，否则下一棒会以为"注释里也不许提"）：
//   咬的是**生产语句**——即"在消费口里对某个引用的状态下判词并给出理由"的那种代码。
//   注释里讲解口径**是允许的、而且鼓励**（本仓的留档纪律）。
//   故判据 = 消费口必须**问** `ref-rules.js`（import + 调用），且不许再出现
//   **本文件自己手写的"存在性/开闭"裁决字符串**（下面这两组正则）。
const CONSUMERS = ['check-step.js', 'sanitize-step.js', 'settle.js'];

test('★leg67 M2：三个消费口都必须**问**单一主人（import + 真的调用它）', () => {
    for (const f of CONSUMERS) {
        const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
        assert.match(src, /from '\.\/ref-rules\.js'/, `${f} 必须 import ref-rules.js`);
        assert.match(src, /judgeRef\s*\(/, `${f} 必须真的调用 judgeRef`);
    }
});

test('★leg67 M2b：消费口里**不许再手写**已收口的判词（判词只许住在 ref-rules.js）', () => {
    // 锁的**准确形状**（写清楚，免得下一棒以为它万能，也免得它变成同义反复）：
    //   · 它咬的是**生产语句里的判词成语**——即收口前那些在消费口里手写、如今已搬进判据表的**说法**。
    //   · 它**不**咬"消费口把表渲染出来"（那是本棒的正解：`errors.push(\`…: ${v}\`)` 里当然会出现表的话）。
    //   · 它**不**咬形状类/身份类校验（那些判词不在表里，本就不归甲案管）。
    //   ★为什么用"成语清单"而不是"表里所有片段"：本棒实测过——用表里的片段扫会**误伤正当渲染**
    //     （表里那 13 个引用点一加，`未知实体 "` 这类通用片段就同时出现在表与渲染行里）。
    // ★片段口径（本棒实测定的）：按插值位切开后**不 trim**、只留 **≥8 字符**的固定片段。
    //   为什么：`…（当前 ref="` 后面紧跟插值，切出来的尾巴是 `"）` 这种 2 字符残渣——
    //   拿它当判词会误伤任何一句带右括号的话。而 ≥8 字符的片段（如
    //   `event 源必须引已存在未决事件（当前 ref="`）只可能来自判据表本身。
    //   ⇒ 凡是被收进表的说法，就不许在消费口再手写一遍。
    const tableFragments = new Set();
    for (const point of REF_POINTS) {
        for (const fn of Object.values(REF_RULES[point])) {
            const v = fn({ ref: '\u0000R', world: noneWorld(), step: { newEvents: [] } });
            if (!v || typeof v.message !== 'function') continue;
            const rendered = String(v.message({ ref: '\u0000R', id: '\u0000R', label: '\u0000L' }));
            for (const frag of rendered.split(/\u0000[RL]/)) {
                if (frag.length >= 8) tableFragments.add(frag);
            }
        }
    }
    assert.ok(tableFragments.size >= 12,
        `判据表只收到 ${tableFragments.size} 个固定片段（≥8 字符）——表是不是被改空了？`);
    for (const f of CONSUMERS) {
        const lines = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
            const code = line.trim();
            if (!code || code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
            for (const idiom of tableFragments) {
                assert.ok(!line.includes(idiom),
                    `★leg67 M2b：${f}:${i + 1} 又手写了已收口的判词（判词只许住在 ref-rules.js）：\n`
                    + `  判词：「${idiom}」\n  原行：${code}`);
            }
        });
    }
});

test('★leg67 M2b-2：锁的**机制**在（消费口必须真的把表的判据调出来，而不是自己造一句）', () => {
    // 上面那条是"黑名单"（防回潮）；本条是"白名单"（证明回路真的接上了）。
    //   两条缺一不可：只有黑名单 ⇒ 有人把判据表整个绕过、改写一套新话也照样"不命中"。
    const RENDER_CALL = /(?:verdictOf|dropVerdictOf|renderVerdict)\s*\(/;
    for (const f of CONSUMERS) {
        const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
        const hits = (src.match(new RegExp(RENDER_CALL, 'g')) || []).length;
        assert.ok(hits >= 1, `${f} 必须至少有一处"把判据渲染出来"的调用（实收 ${hits}）`);
    }
    // ★净化器还必须用**布尔口**（它有几处自己措辞、只借判据）——证明 `askRef` 真的在用
    const san = readFileSync(new URL('../src/sanitize-step.js', import.meta.url), 'utf8');
    assert.match(san, /askRef\s*\(/, 'sanitize-step 必须用布尔口 askRef（判据同源、排版各就各位）');
});

/** 一个"什么都没有"的账（把每格判据都逼到"不合法"那一侧，好把文案取全）。 */
function noneWorld() {
    return { version: 1, context: {}, entities: [], agendas: [], events: [], milestones: [], chronicle: [], meta: { tick: 0 } };
}

test('★leg67 M2c：判据的**判定时点**也只许有一处（快照住在 ref-rules.js）', () => {
    const settle = readFileSync(new URL('../src/settle.js', import.meta.url), 'utf8');
    const refRules = readFileSync(new URL('../src/ref-rules.js', import.meta.url), 'utf8');
    assert.match(refRules, /export function captureOpenCauseState/, '快照必须由 ref-rules 提供');
    assert.match(settle, /captureOpenCauseState/, 'settle 必须**用它**（不许再自己抓一份）');
    assert.ok(!/function captureOpenCauseState/.test(settle), 'settle 里不许再留一份快照实现（两把尺子）');
});

// ═══════════════ ④ M3：每一条"不合法"都必须**带出路** ═══════════════
// ★这条是 leg64（报错把人领错方向）与 leg66（报错把人领进死胡同）两次实机教训的直接产物：
//   出路漏一条，模型就反复换号重试，每试一次**白烧一轮**。
test('★leg67 M3：每条判据的文案都**给出往哪走**（含号、含事、含可执行的下一步）', () => {
    // 逐条判据：必须含"让模型能照做"的指示词之一（不是"你错了"，而是"你该这么改"）
    //   ★"整条删掉"也算一条正当出路——leg66 §2.5 的教训是"把合法心愿说成不可能"，
    //     而"这条本来就不该写 ⇒ 删掉它"是**真出路**（不是打发）。
    const ACTIONABLE = /(?:请|应|必须|改用|改引|换成|换成|先接|用 newEvents|不许|只认|只有|照抄|走|删掉|出路)/;
    const offenders = [];
    for (const [point, source] of M1_CASES.map(([p, s]) => [p, s])) {
        const v = ask(point, source);
        if (!v) continue;
        const text = renderVerdict(v);
        if (!text.length) offenders.push(`${v.code}: 没有文案`);
        else if (!ACTIONABLE.test(text)) offenders.push(`${v.code}: ${text}`);
    }
    assert.deepEqual(offenders, [], `★这些判据的文案没给出路（模型会反复重试）：\n${offenders.join('\n')}`);
});

test('★★leg67 M3b（leg66 第二条裁定的原件）：已了结事件的报错必须**指名到号 + 给出拾遗那条路**', () => {
    // 用户实机原文（leg66 §2.5）：模型把 `closedRoots` 里的旧事写进了 `newAgendas`（源型给成 event），
    //   旧文案只给"换未决事件 / 改成 state"两条 —— **两条都把模型合法的心愿说成不可能**。
    const v = ask('newAgendas.source', { type: 'event', ref: 'ev_2_2' });
    assert.ok(v, '已了结的事件必须判不合法（这条闸一个字不放宽）');
    const text = renderVerdict(v);
    assert.match(text, /ev_2_2/, '★必须**指名到号**（不许只说"那件事"）');
    assert.match(text, /已经办完的一件事/, '★必须**指名到事**（把标题带上，模型才认得出是哪件）');
    assert.match(text, /ripple/, '★必须给出「先接旧事」那条路（newEvents + ripple）');
    assert.match(text, /closedRoots|拾遗/, '★必须指出那个号在输入的**拾遗**那一栏里');
    assert.ok(!/不存在|没有这个号/.test(text), '★**不许把"已了结"说成"不存在"**（leg32i/leg64 同一条纪律）');
    assert.match(text, /已经了结/, '★必须如实说是"已经了结"');
});

test('★leg67 M3c：`entityUpdates.cause` 的"不存在"与"已了结"必须**分成两句**（leg66 第一件裁定的原件）', () => {
    const missing = renderVerdict(ask('entityUpdates.cause', { type: 'event', ref: 'ev_nope' }));
    const closed = renderVerdict(ask('entityUpdates.cause', { type: 'event', ref: 'ev_2_2' }));
    assert.notEqual(missing, closed, '★两种情况必须是两句不同的话（合并成"不在账或已了结"会把读者引向"抄错号"）');
    assert.match(missing, /ev_nope/);
    assert.match(closed, /已了结/);
    assert.ok(!/不在账/.test(closed), '★"已了结"那句不许含"不在账"（它明明在账上——真账 ev_5_3 的教训）');
});

// ═══════════════ ★leg100：收场那条出路必须**指对栏**（真机取证） ═══════════════
// 起因（用户实机那两条报错，原件逐字留档）：
//   `$.eventClosures[0].event: 事件「ev_6_4」（老兵肉弹在长城防线自爆）**已经了结**——
//    收场是一次性的，**把这一项删掉**（它不在输入那份"还没结束的事"里，换一件还没收场的）`
// 取证（`F:/deepseek/tmp/prototypes/leg100-closure-leak.mjs`，调产品那一口建包，不手抄口径）：
//   那两个号**确实不在** `pendingEvents`（72 条，引擎没喂错料），**却在** `recentClosedEvents`
//   （最后 8 条已了结，`pack.js:813`）——而那段在 `trimmed=null` 时是 `{id,title,source}`、
//   真被裁时（`pack.js:1020`）**只剩 `{id}`** ⇒ 一串没有标题的号，读起来正是一份"还能收的事"的候选池，
//   两个被拒的号恰好是那份尾巴的**头两条**。
// ★为什么这条判据必须存在（而不是"我看过文案没问题"）：收场走的是**整步拒**（`check-step` 拒整步、
//   净化器不替模型摘这一项）⇒ 画不出"往哪走"就等于**白烧一轮**（`ref-rules.js:524` 那条自律的原话）。
//   旧文案只指了 `pendingEvents` 那一栏，而模型是从**另一栏**抄的号 ⇒ 它照旧话去错的那栏里找、找不到。
// ★量词选择（leg98 §8.8 那一族）：这里咬的是**"那个号在输入里的住处有没有被点出来"**，
//   不是"文案好不好听" ⇒ 断言必须**同时**咬住两栏的名字，缺一栏就是回到了旧病。
test('★leg100：收场被拒时，出路必须点出**那个号在输入里的住处**（recentClosedEvents 是归档，不许从那取号）', () => {
    const v = ask('eventClosures.event', { type: 'id', ref: 'ev_2_2' });
    assert.ok(v, '前置：已了结的事必须判不合法（这条闸一个字不放宽）');
    assert.equal(v.code, 'closure-event-closed', '前置：走的必须是"已收场"那一支（不是"不在册"）');
    const text = renderVerdict(v);

    // ① 老底子照旧：指名到号 + 到事 + 一次性 + 可执行的下一步
    assert.match(text, /ev_2_2/, '★必须**指名到号**');
    assert.match(text, /已经办完的一件事/, '★必须**指名到事**（把标题带上，模型才认得出是哪件）');
    assert.match(text, /收场是一次性的/, '★"一次性"这条语义不许被这次改写吃掉');
    assert.match(text, /删掉/, '★可执行的下一步（M3 的 actionable 面不许丢）');

    // ② 本笔的正面：**两栏的名字都得点到**
    assert.match(text, /recentClosedEvents/, '★★必须点出这个号**住在哪一栏**（最近了结的事：那是归档）');
    assert.match(text, /pendingEvents/, '★★必须点名"要收场只认哪一栏"（还没结束的事）');
    assert.match(text, /不许从那一段取号|不许从那.*取号/, '★★必须把"不许从归档里取号"这句禁令说出来（这是本笔的正面）');

    // ③ 反面：不许把它说成"不存在"（leg32i/leg64 那条纪律），也不许说成"你错了"就完事
    assert.ok(!/不存在|没有这个号/.test(text), '★不许把"已了结"说成"不存在"');
    assert.ok(/不许|只认/.test(text), '★禁令面必须在（不只是描述现状）');
});

// ═══════════════ ⑤ M4：行为零变化 —— 真账锁 ═══════════════
// ★用仓库自带的**真账夹具**（不是自造小账）跑一遍四个消费口，确认收口前能过的、现在照样过。
const FIXTURES = ['golden-world.min.json', 'live-world.json', 'tree-world.json', 'gated-world.json'];

test('★leg67 M4a：仓库自带真账夹具喂四个消费口 ⇒ 不抛错、结论自洽（收口没砸既有行为）', () => {
    for (const f of FIXTURES) {
        const w = JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
        const step = emptyStep();
        assert.doesNotThrow(() => checkWorldStep(step, w), `${f} 校验面抛错`);
        assert.doesNotThrow(() => dropInvalidProposals(step, w), `${f} 净化面抛错`);
        assert.doesNotThrow(() => captureOpenCauseState(w), `${f} 快照抛错`);
        // 空步必须**合法**（收口不许把"什么都不提议"判成非法）
        const r = checkWorldStep(step, w);
        assert.equal(r.ok, true, `${f} 空步被拒：${JSON.stringify(r.errors)}`);
    }
});

test('★leg67 M4b：快照口径 = "进入批次那一刻"（leg66 的治法**不许回潮**）', () => {
    // 构造 leg66 真账那个形状：一件事进来时**开着**，同一批里被引擎自己关掉。
    const w = world();
    for (const ev of w.events) if (ev.id === 'ev_2_1') ev.closed = false;
    const before = captureOpenCauseState(w);
    assert.equal(before.openEvents.has('ev_2_1'), true, '进来时它是开着的');
    // 结算尾声把它关掉（模拟 closeEvents）
    w.events.find((e) => e.id === 'ev_2_1').closed = true;
    w.events.find((e) => e.id === 'ev_2_1').closedAt = 3;
    // ★判据必须读**快照** ⇒ 仍然认它
    const v = ask('entityUpdates.cause', { type: 'event', ref: 'ev_2_1' }, w, { entry: before });
    assert.equal(v, null, '同一批次内被本轮关掉的因 ⇒ **照旧认**（引擎自己的收尾不许否掉刚放行的变更）');
    // ★真·旧事（进来时就已经关着）⇒ 照旧拒，且报错说清"在第几轮了结"
    const vOld = ask('entityUpdates.cause', { type: 'event', ref: 'ev_2_2' }, w, { entry: before });
    assert.ok(vOld, '真·旧事必须照旧拒（这条闸一个字不放宽）');
    assert.match(renderVerdict(vOld), /第 2 轮/, '必须说清"在第几轮了结"');
});

// ═══════════════ ⑦ 净化面新增的三格：必须**丢掉**（不是放行） ═══════════════
// ★leg67：收口前净化器对这三格**根本不判**（`book` / `dialogueFact` / `newEvents.source`），
//   于是同一个引用在"校验面拒整步、净化面照收"两边说法不同（细案 §1.3 那类病）。
//   补上之后**要确认它真的会丢**——只是"不抛错"不算数（那正是收口前的样子）。
test('★leg67 M1c：净化面新补的三格必须真的**丢掉那条提案**（不是放行）', () => {
    const cases = [
        ['newEntities 的 book 源未命中书名录', emptyStep({ newEntities: [{ name: '新人', source: { type: 'book', ref: '书里没有' } }] }), 'newEntities'],
        ['newEntities 的 dialogueFact 未命中依据册', emptyStep({ newEntities: [{ name: '新人', source: { type: 'dialogueFact', ref: '没人提过' } }] }), 'newEntities'],
        ['newEntities 的 dialogueFact 指向账上已有的人', emptyStep({ newEntities: [{ name: '新人', source: { type: 'dialogueFact', ref: '甲' } }] }), 'newEntities'],
        ['newEntities 的 entity 源引已灭者', emptyStep({ newEntities: [{ name: '新人', source: { type: 'entity', ref: 'e_dead' } }] }), 'newEntities'],
        ['newEvents 的 ripple 源不在账', emptyStep({ newEvents: [{ title: 't', position: '甲地', source: { type: 'ripple', ref: 'ev_nope' } }] }), 'newEvents'],
        ['newEvents 的 plot 源不在账', emptyStep({ newEvents: [{ title: 't', position: '甲地', source: { type: 'plot', ref: 'a_nope' } }] }), 'newEvents'],
    ];
    for (const [name, step, family] of cases) {
        const { step: out, dropped } = dropInvalidProposals(step, world());
        assert.equal(out[family].length, 0, `${name}：那条提案必须被丢掉（实际留下了 ${out[family].length} 条）`);
        assert.ok(dropped.some((d) => d.family === family && d.reason),
            `${name}：丢掉必须**留痕**（不许静默：丢弃也要能被看见、被计数）`);
    }
    // ★反向守门：合法的照旧**不许丢**（别把这三格做成"一律丢"）
    const ok = emptyStep({
        newEntities: [
            { name: '新人甲', source: { type: 'book', ref: '书里有' } },
            { name: '新人乙', source: { type: 'dialogueFact', ref: '白小娥' } },
            { name: '新人丙', source: { type: 'entity', ref: 'e_a' } },
        ],
        newEvents: [{ title: 't', position: '甲地', source: { type: 'ripple', ref: 'ev_2_1' } }],
    });
    const r = dropInvalidProposals(ok, world());
    assert.equal(r.step.newEntities.length, 3, '合法的入局提案不许被丢');
    assert.equal(r.step.newEvents.length, 1, '合法的 ripple 事件不许被丢');
    assert.deepEqual(r.dropped, [], `不许丢任何东西，实际丢了：${JSON.stringify(r.dropped)}`);
});

// ═══════════════ ⑥ id 解析：发号与按位次解析是**同一处** ═══════════════
test('★leg67 id 解析：发号规矩与按位次解析同住一处，且世界账优先', () => {
    assert.deepEqual(newEventIdsOf({ newEvents: [{}, {}, {}] }, 7), ['ev_7_1', 'ev_7_2', 'ev_7_3']);
    assert.equal(eventOrdinal('ev_9_3'), 3);
    assert.equal(eventOrdinal('e_a'), null);
    assert.equal(eventOrdinal('ev_x_1'), null);

    const w = world();
    const step = { newEvents: [{ title: '本轮第一件' }, { title: '本轮第二件' }] };
    // ① 世界账优先
    assert.equal(resolveRefTarget(w, 'ev_2_1', { step, includeSameRound: true }).target.title, '开着的一件事');
    // ② 账上没有 ⇒ 按位次落到本轮那批（模型写错轮号也能对上）
    const hit = resolveRefTarget(w, 'ev_9_2', { step, includeSameRound: true });
    assert.equal(hit.viaSameRound, true);
    assert.equal(hit.target.title, '本轮第二件');
    // ③ 不在本轮范围内的位次 ⇒ 不存在
    assert.equal(resolveRefTarget(w, 'ev_9_5', { step, includeSameRound: true }).target, null);
    // ④ 归档入纪只在**要求**它的那一格算数（覆灭），其余一律不算
    assert.equal(findFateEventSource(w, 'ev_1_9').archived, true);
    assert.equal(resolveRefTarget(w, 'ev_1_9', { step, includeSameRound: true }).target, null);
});

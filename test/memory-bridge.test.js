// story-world-v2/test/memory-bridge.test.js
// leg26 b：记忆投递（引擎事实 → yuzuki-Memory 记忆插件）。
//   本文件锁的判据（对抗式：不问"我以为对的地方"，只问"哪里会出错"）：
//   M1 投的是**引擎原话**：事件文本 = 编年/账上的 title，一个字的意译都没有
//   M2 **不投引擎内码**：`ev_143_2`/`a_12_1`/`e_bk_7` 绝不出现在任何值里
//   M3 两种形状：当下表**恰好一条**（覆盖）；发生表**分档如实**（已了结/未结/已归卷）
//   M4 有界：发生表 ≤ 尾巴条数（**逐条与成段共享同一份预算**）
//   M5 缺数据不造：没标题的事件不投；没 span 的里程碑不投；空账也有一张"（无）"的状态表
//   M6 store 缺失/抛错 ⇒ **绝不抛**（世界推进优先），返回值如实报告
//   M7 回传的是**本次**（自证面不许拿上一次的冒充）
//   M8 状态记录 id 固定（覆盖写，不靠 id 区分轮次）
//   M9 web 层**只清我方前缀**的陈旧记录，非 `sw2_` 的一个字不动
//   M10 逻辑表名 → 插件内置表 id 的映射（错落点=详情视图空白，只有肉眼能看见）
//   M11 写存储后必须派发 `yzm-memory-state-updated`（插件据此重读并重绘）
//   M12 插件已有同名内置表时，表定义必须被我方**覆盖**
// ★leg30 新增（用户实机"乱"的三刀，见 `memory-semantic.test.js` 与 M13/M14/M15/M16）：
//   一字段一义（位置=地点、波及名单=人名格）、前史不两投、行随数据取舍、排序可讲清。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildMemoryPayload, pushToMemory,
    MEMORY_TABLE_STATE, MEMORY_TABLE_EVENTS,
    STATE_COLUMNS, EVENT_COLUMNS,
    MEMORY_EVENT_TAIL,
} from '../src/memory-bridge.js';
import { PLUGIN_TABLE_STATE, PLUGIN_TABLE_EVENTS, LEGACY_TABLE_IDS, DISPLAY_NAME_STATE, DISPLAY_NAME_EVENTS } from '../src/memory-bridge.js';
import { memoryStore, SW2_RECORD_PREFIX, TABLE_ID_ALIAS } from '../web/index.js';

// 夹具同时覆盖四条路：已了结（plot 源 / state 源）、在飞（ripple 源）、成段（里程碑）、
//   "账上有地点"与"账上没有名字的人"（e3 的 location 是占位 `未明`，不许当人名用）。
const world = () => ({
    version: 1,
    context: {
        world: '大荒',
        tension: 0.5,
        positions: ['临渊城', '忘川'],
        setting: { dynamic: { tension: { polarity: '宗门/朝廷', intensity: 0.5 }, env: { 民生度: '艰难', 动乱度: '动荡' } } },
    },
    entities: [
        { id: 'e1', kind: 'faction', name: '大虞', location: '临渊城' },
        { id: 'e2', kind: 'character', name: '薛铁衣', location: '忘川' },
        { id: 'e3', kind: 'character', name: '黄坤', location: '未明' },
    ],
    weights: {},
    agendas: [
        { id: 'a_12_1', owner: 'e1', goal: '夺大盘谷阵眼', stage: '集兵', visibility: 'known', maxSteps: 4, progress: 2, memory: { promises: [], done: [], blocked: [], turnsAlive: 1 } },
        { id: 'a_12_2', owner: 'e2', goal: '暗查洗煞阵', stage: '潜伏', visibility: 'concealed', maxSteps: 3, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
    ],
    events: [
        { id: 'ev_10_1', title: '北山隘口被袭', source: { type: 'state' }, position: '临渊城', ripples: ['e2'], links: { up: [], down: [] }, closed: true, closedAt: 14 },
        { id: 'ev_12_1', title: '大盘谷阵眼易主', source: { type: 'plot', ref: 'a_12_1' }, position: '临渊城', ripples: ['e1', 'e3'], links: { up: [], down: [] }, closed: true, closedAt: 16 },
        { id: 'ev_16_1', title: '余波：坊市封路', source: { type: 'ripple', ref: 'ev_12_1' }, position: '临渊城', ripples: [], links: { up: ['ev_12_1'], down: [] }, closed: false },   // 在飞
        { id: 'ev_pump_20_1', title: '天下安稳：已 12 轮无新事上桌', source: { type: 'state' }, position: '临渊城', ripples: [], links: { up: [], down: [] }, closed: true, closedAt: 23 },
    ],
    chronicle: [],
    // 成段档的素材：引擎把"闭环满热窗且整链结清"的旧事件按出生段压成里程碑（见 settle.js archiveClosedEvents）
    milestones: [{ id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 3 }, titles: ['发兵催战', '坊市封路'], ids: ['ev_1_1', 'ev_2_1', 'ev_3_1'] }],
    meta: { tick: 21, simLog: [] },
});

test('M1/M2：投的是引擎原话，且**值里**不含任何引擎内码', () => {
    const recs = buildMemoryPayload(world());
    const all = JSON.stringify(recs);
    // 事由/标题逐字在（一个字的意译都没有）
    assert.ok(all.includes('北山隘口被袭'));
    assert.ok(all.includes('大盘谷阵眼易主'));
    assert.ok(all.includes('天下安稳：已 12 轮无新事上桌'));
    assert.ok(all.includes('夺大盘谷阵眼'));
    // ★内码不许进**值**（记录 id 是插件的记录主键，必须唯一，不算"投给模型看的内容"）
    const valuesOnly = JSON.stringify(Object.values(recs).flat().map((r) => r.values));
    for (const code of ['ev_10_1', 'ev_12_1', 'ev_16_1', 'ev_pump_20_1', 'a_12_1', 'e1', 'e2', 'e3', 'm_10']) {
        assert.ok(!valuesOnly.includes(code), `★引擎内码泄漏到投出去的值里：${code}`);
    }
    // 记录 id 唯一（否则并进插件状态时会互相覆盖）
    const ids = Object.values(recs).flat().map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, '记录 id 必须唯一');
    // ★leg30 一字段一义：`物品位置` 装**地点**（账上 event.position，案发地在临渊城；"临渊"正是水名），
    //   人名归**人形图标**的 `持有者` 格（旧版把人名写进位置格 ⇒ 用户实机一眼看出"大虞、你"是矛盾）。
    const evRow = recs[MEMORY_TABLE_EVENTS].find((r) => r.values.物品名称 === '大盘谷阵眼易主');
    assert.equal(evRow.values.物品位置, '临渊城', '★位置列必须是账上的地点（事件 position），不是人名');
    assert.equal(evRow.values.持有者, '大虞、黄坤', '★波及名单翻成人话后进"持有者"格（人形图标）');
    // 来路是人话（不是 source.type 的英文）
    assert.equal(evRow.values.物品描述, '谋划「夺大盘谷阵眼」推进');
});

test('M3：当下表恰好一条（覆盖）；发生表**分档如实**（已了结 / 未结 / 已归卷）', () => {
    const recs = buildMemoryPayload(world());
    assert.equal(recs[MEMORY_TABLE_STATE].length, 1, '当下表一表一条（每轮覆盖，不是追加）');
    const titles = recs[MEMORY_TABLE_EVENTS].map((r) => r.values.物品名称);
    assert.ok(titles.includes('北山隘口被袭') && titles.includes('大盘谷阵眼易主') && titles.includes('天下安稳：已 12 轮无新事上桌'));
    assert.ok(titles.includes('第 1–10 轮 · 前史'), '★成段档（前史）在**同一张表**里（不再是第三张表）');
    // ★leg27 h 口径（用户「**事件要落地才成事件**」+ 实机「记忆插件也没有记录事件」）：不混口径、分档如实。
    // ★leg30：分档落在**状态**列上（`状态` 是插件的特殊格，正好装"了结没"），`轮次` 列只报时间。
    const byTitle = new Map(recs[MEMORY_TABLE_EVENTS].map((r) => [r.values.物品名称, r.values]));
    assert.equal(byTitle.get('北山隘口被袭').状态, '已了结');
    assert.equal(byTitle.get('大盘谷阵眼易主').状态, '已了结');
    assert.equal(byTitle.get('余波：坊市封路').状态, '未结', '★在飞事件要**看得见**且如实标"未结"（这正是"插件里什么都没有"那一刀）');
    assert.equal(byTitle.get('第 1–10 轮 · 前史').状态, '已归卷');
    // 轮次列只写时间：逐条=闭环轮（旧版写的是"未结 · 第 N 轮起"，把状态和时间挤在一格）
    assert.equal(byTitle.get('大盘谷阵眼易主').轮次, '第 16 轮');
    assert.equal(byTitle.get('余波：坊市封路').轮次, '第 16 轮起');
    assert.equal(byTitle.get('第 1–10 轮 · 前史').轮次, '第 1–10 轮', '★成段的轮次写整段范围（与逐条一眼可分）');
    // 在飞那档的记录 id 必须与已了结**分键空间**（否则同名 id 会把落地的那条覆盖掉）
    const ids = recs[MEMORY_TABLE_EVENTS].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, '记录 id 必须唯一（插件按 id 合并，重复即覆盖）');
    assert.ok(ids.some((id) => id.startsWith('sw2_ev_open_')), '在飞档要用 sw2_ev_open_ 前缀（与 sw2_ev_ 分键空间）');
    assert.ok(ids.some((id) => id.startsWith('sw2_ev_span_')), '成段档要用 sw2_ev_span_ 前缀（同上）');
    // 当下表的内容
    const st = recs[MEMORY_TABLE_STATE][0].values;
    assert.match(st.类型, /^当前 · 第 21 轮$/, '★"当下"的轮次要带标记（旧版写"第 21 轮"，与史卷纪要卡混脸）');
    assert.ok(st.详细说明.includes('余波：坊市封路'), '在飞事件**照旧**在当下表的"未了结之事"里（两处都能看见，不矛盾）');
    assert.ok(st.详细说明.includes('第 16 轮起'), '★未了结之事要带出生轮（否则读不出"这件事多久没了结"）');
    assert.ok(st.详细说明.includes('夺大盘谷阵眼'), '在办盘算在当下表里');
    assert.ok(st.详细说明.includes('民生度：艰难 · 动乱度：动荡 · 天时：未定 · 张力推手：未定'), '参数档位照抄原话（未定的照实写未定）');
    // ★leg29 用户口径修正：「为什么把地图放进去了，世界设定不用管，聊天 llm 知道，应该只要记录世界发生了什么就好了」
    //   ⇒ 位置面从这张表**整条去掉**（位置与设定都在世界设定里，聊天 LLM 看得到，不必再抄一份）。
    assert.equal(st.影响范围, undefined, '★位置面必须不在当下表里（用户明确说不要"地图"）');
    assert.ok(!JSON.stringify(st).includes('各归何处'), '★"各归何处"不许再出现在当下表的值里');
    // 值域闭包：每条记录的 values 键必须 ⊆ 该表列定义（防写出插件不认的列）
    const cols = { [MEMORY_TABLE_STATE]: STATE_COLUMNS, [MEMORY_TABLE_EVENTS]: EVENT_COLUMNS };
    for (const [table, list] of Object.entries(recs)) {
        for (const rec of list) {
            for (const k of Object.keys(rec.values)) assert.ok(cols[table].includes(k), `${table} 出现列定义外的键：${k}`);
        }
    }
});

test('M4：有界——发生表 ≤ 尾巴条数（逐条与成段**共享**同一份预算）', () => {
    const w = world();
    for (let i = 0; i < 65; i += 1) {
        w.events.push({ id: `ev_${100 + i}_1`, title: `第${i}件事`, source: { type: 'state' }, position: '临渊城', ripples: [], links: { up: [], down: [] }, closed: true, closedAt: 100 + i });
    }
    for (let i = 0; i < 50; i += 1) {
        w.milestones.push({ id: `m_${(i + 2) * 10}`, span: { from: (i + 1) * 10 + 1, to: (i + 2) * 10 }, counts: { events: 1 }, titles: [`段${i}`], ids: [] });
    }
    const recs = buildMemoryPayload(w);
    assert.ok(recs[MEMORY_TABLE_EVENTS].length <= MEMORY_EVENT_TAIL, `发生表 ${recs[MEMORY_TABLE_EVENTS].length} ≤ ${MEMORY_EVENT_TAIL}`);
    // ★leg30：预算**只有一份**（旧版是"逐条 ≤60 且 成段 ≤12"，同一批事件最多占两个预算、总行数可到 72）
    assert.equal(recs[MEMORY_TABLE_EVENTS].length, MEMORY_EVENT_TAIL, '塞满时恰好等于预算（不多不少）');
    assert.deepEqual(Object.keys(recs).sort(), [MEMORY_TABLE_EVENTS, MEMORY_TABLE_STATE].sort(), '★只有两种形状（前史不再占第三张表）');
});

test('M5：缺数据不造——没标题的事件不投、没 span 的里程碑不投、**没值的格子整行不出现**', () => {
    const w = world();
    w.events.push({ id: 'ev_99_1', title: '   ', source: { type: 'state' }, position: '临渊城', ripples: [], closed: true, closedAt: 99 });
    w.milestones.push({ id: 'm_bad', counts: { events: 2 }, titles: ['无段'], ids: [] });
    // 账上没有地点的事件（position 是空串）——位置格必须**整个键不出现**，不许写 `—` 充数
    w.events.push({ id: 'ev_98_1', title: '不知何处起的事', source: { type: 'state' }, position: '', ripples: [], closed: true, closedAt: 98 });
    const recs = buildMemoryPayload(w);
    assert.ok(!recs[MEMORY_TABLE_EVENTS].some((r) => !r.values.物品名称), '空标题不投（宁缺勿造）');
    assert.ok(!recs[MEMORY_TABLE_EVENTS].some((r) => String(r.values.轮次 || '').includes('?')), '查不出轮次的事件不许投"第 ? 轮"');
    assert.ok(!recs[MEMORY_TABLE_EVENTS].some((r) => String(r.values.物品名称).includes('无段')), '没 span 的里程碑不投');
    const noPlace = recs[MEMORY_TABLE_EVENTS].find((r) => r.values.物品名称 === '不知何处起的事');
    assert.equal(noPlace.values.物品位置, undefined, '★没地点 ⇒ 位置格整个不出现（不是 `—`、不是空串）');
    assert.equal(noPlace.values.持有者, undefined, '★没人被波及 ⇒ 持有者格也不出现');

    const empty = { version: 1, context: { world: '', tension: 0.5, positions: [] }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    const recs2 = buildMemoryPayload(empty);
    assert.equal(recs2[MEMORY_TABLE_STATE].length, 1, '空账也有当下表（"现在什么都没有"本身是事实）');
    assert.ok(recs2[MEMORY_TABLE_STATE][0].values.详细说明.includes('在办之事：（无）'), '空账的在办之事照实写（无）');
    assert.equal(recs2[MEMORY_TABLE_STATE][0].values.设定名, '（未名世界）');
    assert.deepEqual(recs2[MEMORY_TABLE_EVENTS], []);
});

test('M6：落库——store 缺失/抛错都不抛（世界推进优先）；正常路径把表定义与记录一起交出去', () => {
    const recs = buildMemoryPayload(world());

    const noStore = pushToMemory(recs, {});
    assert.equal(noStore.ok, false);
    assert.equal(noStore.reason, 'no-store');

    const boom = pushToMemory(recs, { store: { writeRecords() { throw new Error('storage full'); } } });
    assert.equal(boom.ok, false);
    assert.equal(boom.reason, 'storage full', '★失败被吃掉并如实报告（绝不让世界推进炸在这里）');

    let got = null;
    const ok = pushToMemory(recs, { store: { writeRecords(r, meta) { got = { r, meta }; } }, now: 1700000000000 });
    assert.equal(ok.ok, true);
    assert.ok(ok.written > 0);
    assert.equal(got.meta.now, 1700000000000);
    const ids = got.meta.tables.map((t) => t.id);
    // ★leg29（用户拍板「对齐插件内置表形状」）：表 id 改用**插件内置 id**（否则插件详情视图是空 div）
    // ★leg30：★从三张表收敛成**两个插件 id**——"前史"不再是表，它是发生表里成段的行。
    assert.deepEqual(ids, [PLUGIN_TABLE_STATE, PLUGIN_TABLE_EVENTS], '表定义用插件内置 id 交出去（渲染器据此选视图）');
    assert.ok(got.meta.tables.every((t) => t.name && t.name !== t.id), 'name 用注明归属的显示名（侧栏显示的就是它）');
    assert.ok(got.meta.tables.every((t) => Array.isArray(t.columns) && t.columns.length), '每张表都带列定义');
    assert.equal(got.r[MEMORY_TABLE_STATE][0].hidden, false);
});

// ★leg27 h：投递**自证面**（用户两次靠肉眼发现记忆没生效 ⇒ 这功能此前没有任何可查的痕迹）。
//   判据只认一件事：**报出来的必须是刚投进去的那一轮**，而不是"上一次的残留"。
test('M7：投递结果要如实回传（第几轮 / 各表几条）——自证面不许拿上一次的冒充本次', () => {
    const recs = buildMemoryPayload(world());   // 夹具 tick=21
    const r = pushToMemory(recs, { store: { writeRecords() {} }, now: 1 });
    assert.equal(r.ok, true);
    // ★leg30：`类型` 列现在是 `当前 · 第 21 轮` ⇒ 回传前必须摘掉「当前 ·」（自证面的话术照旧是"第 N 轮"）
    assert.equal(r.tick, '第 21 轮', '★回传的必须是**本次**投出的轮次（面板/状态栏据此自证）');
    assert.equal(r.counts[MEMORY_TABLE_STATE], 1, '当下表条数如实回传');
    assert.equal(r.counts[MEMORY_TABLE_EVENTS], recs[MEMORY_TABLE_EVENTS].length, '发生表条数如实回传（含在飞与成段）');
    assert.equal(r.table, MEMORY_TABLE_STATE, '回传投到哪张表（人话可读）');
    // 失败面：不许报成 ok（否则自证面变成假绿——正是这一棒吃亏的地方）
    const bad = pushToMemory(recs, { store: { writeRecords() { throw new Error('boom'); } } });
    assert.equal(bad.ok, false);
    assert.equal(bad.tick, undefined, '失败时不许带轮次（否则界面可能报"已投"）');
});

// ★leg29（用户实机「投递是投递了但是看不到内容 / **为什么多出三个来**」查证时抓出的两个真缺陷）
//   病根都在"合并口径"上：状态表**每轮换一个新 id** ⇒ 插件里越堆越多（真账实测 sw2_state_0/_10/_11 三条
//   并存），而本表的契约恰恰是"一表一条、每轮覆盖"；旧记录退役后**永远清不掉**。
//   判据两条：①**记录 id 固定**（覆盖写，不是靠 id 区分轮次）②web 层写入时**只清我方、不碰别人**。
test('M8：状态表记录 id 固定（每轮覆盖同一条）——不许用"轮次"当 id 越堆越多', () => {
    const w = world();
    const a = buildMemoryPayload(w)[MEMORY_TABLE_STATE][0];
    const b = buildMemoryPayload({ ...w, meta: { ...w.meta, tick: 22 } })[MEMORY_TABLE_STATE][0];
    assert.equal(a.id, b.id, '★两轮的状态记录 id 必须相同（否则插件按 id 合并 ⇒ 每轮新增一条、旧轮次永远留着）');
    assert.equal(a.id, 'sw2_state', '固定 id 就叫 sw2_state');
    assert.ok(a.id.startsWith(SW2_RECORD_PREFIX), '记录 id 必须落在 sw2_ 命名空间内（web 层据此清理，见 M9）');
    assert.equal(a.values.类型, '当前 · 第 21 轮');
    assert.equal(b.values.类型, '当前 · 第 22 轮', '轮次照样如实更新（覆盖的是同一条记录的内容）');
});

test('M9：web 层写入——**只清我方前缀的陈旧记录**，非 sw2_ 的记录一律原样留着', () => {
    const saved = [];
    const fake = {
        VariableInjector: { createDefaultState: () => ({ tables: [], records: {}, activeRecordIds: {} }) },
        Storage: {
            // 模拟"插件里已经有东西"：用户自己的表 + 上一轮我方的表 + 历史遗留的记录
            loadState: () => ({
                // ★leg29：还带着**旧的自定义表定义**（三张逻辑表改用插件内置 id 之前的遗骸）
                tables: [
                    { id: '角色档案', name: '角色档案', columns: ['角色名'], hidden: false },
                    { id: MEMORY_TABLE_STATE, name: MEMORY_TABLE_STATE, columns: ['轮次'], hidden: false },
                    { id: MEMORY_TABLE_EVENTS, name: MEMORY_TABLE_EVENTS, columns: ['轮次', '事'], hidden: false },
                ],
                records: {
                    角色档案: [{ id: 'user_1', hidden: false, values: { 角色名: '我自己填的' } }],
                    [PLUGIN_TABLE_EVENTS]: [
                        { id: 'sw2_ev_ev_1_1', hidden: false, values: { 物品名称: '旧事', 物品描述: '由处境而起', 物品位置: '—', 轮次: '第 1 轮' } },
                        // ★leg30：旧命名的"史卷纪要"记录（同一张插件表里的兄弟记录，旧前缀 `sw2_ms_` 是我方前缀，
                        //   本次不再投出 ⇒ 必须被清掉，否则用户侧栏里会永远留着两张重复的前史卡）
                        { id: 'sw2_ms_m_10', hidden: false, values: { 设定名: '第 1–10 轮', 类型: '大事 3 件' } },
                        { id: '手工加的', hidden: false, values: { 物品名称: '我自己加的', 物品描述: '', 物品位置: '', 轮次: '手' } },
                    ],
                    [PLUGIN_TABLE_STATE]: [{ id: 'sw2_state_11', hidden: false, values: { 设定名: '旧状态', 类型: '第 11 轮' } }],
                },
                activeRecordIds: {},
            }),
            saveState: (next) => { saved.push(JSON.parse(JSON.stringify(next))); },
        },
    };
    const records = buildMemoryPayload(world());
    const store = memoryStore(fake);
    assert.ok(store, '有注入的假插件时适配器必须建起来');
    store.writeRecords(records, { tables: [], now: 1 });

    const afterState = saved.at(-1);
    const after = afterState.records;
    const evIds = after[PLUGIN_TABLE_EVENTS].map((r) => r.id);
    assert.ok(!evIds.includes('sw2_ev_ev_1_1'), '★我方陈旧记录（本次没投的 sw2_ 记录）要被清掉');
    assert.ok(!evIds.includes('sw2_ms_m_10'), '★旧命名"史卷纪要"记录（sw2_ms_）也要被清掉——它已并入发生表');
    assert.ok(evIds.includes('手工加的'), '★非 sw2_ 前缀的记录**一个字都不许动**（leg27 g 覆盖用户数据的教训）');
    assert.ok(evIds.some((id) => id.startsWith('sw2_ev_')), '本次投出的事件记录要在');
    assert.ok(evIds.includes('sw2_ev_span_m_10'), '本次投出的成段记录要在（它落在同一张插件表里）');
    const stIds = after[PLUGIN_TABLE_STATE].map((r) => r.id);
    assert.ok(!stIds.includes('sw2_state_11'), '★历史遗留的 sw2_state_11 要清掉（它是我方旧命名的残骸）');
    // ★leg30 设计使然：当下表**只剩那一条**（旧版这里还有里程碑的兄弟记录）
    assert.deepEqual(stIds, ['sw2_state'], '当下表清完只剩那一条固定 id（前史已不在 this 表）');
    assert.equal(after['角色档案'][0].values.角色名, '我自己填的', '用户自己的表与记录原样保留');
    // ★leg29：**旧的自定义表定义也要清掉**——不然插件会永远保留它们（`normalizeState` 只保留"表定义还在"的
    //   记录键），侧栏里挂三张**永远不会再更新**的空表，正是用户问的"为什么多出三个来"。
    const tableIds = afterState.tables.map((t) => t.id);
    for (const legacy of LEGACY_TABLE_IDS) {
        assert.ok(!tableIds.includes(legacy), `★旧自定义表「${legacy}」的表定义必须被清掉（否则永远赖在侧栏）`);
        assert.equal(after[legacy], undefined, `★旧自定义表「${legacy}」的记录键一并送走`);
    }
    assert.ok(tableIds.includes('角色档案'), '★只删我们自己创建的那三个 id，别人的表一个字不动');
    // 注：本条只验"清"；**表定义覆盖**归 M12（本用例的假 store 传 `tables: []`，没有定义可覆盖）。
});

// ★leg29：**写完必须通知插件**（用户实机「投递是投递了但是看不到内容」的最后一环）。
//   根因：插件窗口从**它自己的内存缓存**（`memory-window.js` 的 `memoryState`）渲染，而我们绕过它的 UI
//   直接写存储 ⇒ 它不知道 ⇒ 用户看到的是旧快照（自检说记录都在、插件里却还是旧的）。
//   插件官方留了通道：`window.addEventListener('yzm-memory-state-updated', reloadStateFromStorage)`。
//   判据：写入后**恰好派发一次**这个事件，且 detail 标明来源。
test('M11：写存储后必须派发 `yzm-memory-state-updated`（插件据此重读存储并重绘）', () => {
    const events = [];
    const timers = [];
    const saved = [];
    const origWindow = globalThis.window;
    const origCustom = globalThis.CustomEvent;
    // 假环境：①接住派发 ②接住定时器 ③让"表名校正"能读到一个被插件改回去的状态并写回
    const metaState = {
        tables: [
            { id: PLUGIN_TABLE_STATE, name: '世界设定', columns: ['设定名', '类型', '详细说明'], hidden: false },
            { id: PLUGIN_TABLE_EVENTS, name: '物品追踪', columns: ['物品名称', '物品描述', '物品位置', '轮次'], hidden: false },
        ], records: {}, activeRecordIds: {},
    };
    globalThis.window = {
        dispatchEvent: (e) => { events.push(e); return true; },
        setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
        SillyTavern: { getContext: () => ({ chatMetadata: { yuzukiMemory: metaState } }) },
        YuzukiMemory: { Storage: { saveState: (n, _f, _s, o) => saved.push({ n: JSON.parse(JSON.stringify(n)), o }) } },
    };
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    try {
        const store = memoryStore({
            VariableInjector: { createDefaultState: () => ({ tables: [], records: {}, activeRecordIds: {} }) },
            Storage: { loadState: () => ({ tables: [], records: {}, activeRecordIds: {} }), saveState: () => {} },
        });
        const tables = [
            { id: PLUGIN_TABLE_STATE, name: DISPLAY_NAME_STATE, icon: 'world', columns: STATE_COLUMNS, hidden: false },
            { id: PLUGIN_TABLE_EVENTS, name: DISPLAY_NAME_EVENTS, icon: 'item', columns: EVENT_COLUMNS, hidden: false },
        ];
        store.writeRecords(buildMemoryPayload(world()), { tables, now: 1 });

        // ① 立刻派发一次（窗口开着时插件据此重绘）
        assert.equal(events.length, 1, '★写入后必须立刻派发一次');
        assert.equal(events[0].type, 'yzm-memory-state-updated', '事件名必须是插件监听的那个');
        assert.equal(events[0].detail?.source, 'story-world-v2', 'detail 标明来源（便于插件侧排查）');
        // ② 两次延迟安排：重发事件（监听没绑上时兜底）+ 表名校正（插件回写会盖掉我们的表名）
        assert.equal(timers.length, 2, '★必须安排两次延迟：事件重发 + 表名校正');
        const [first, second] = timers.slice().sort((a, b) => a.ms - b.ms);
        assert.ok(first.ms > 0 && second.ms > first.ms, '两个延迟都要 > 0，且校正应在重发之后');
        // 重发那次：再派发同一个事件（不改状态）
        saved.length = 0;
        first.fn();
        assert.equal(events.length, 2, '延迟那次要真派发同一个事件');
        assert.equal(events[1].type, 'yzm-memory-state-updated');
        assert.equal(saved.length, 0, '事件重发不许写状态（只管叫人刷新）');
        // 校正那次：把被插件改回去的表名改回我们的，并且**只改名、不动记录**
        second.fn();
        assert.equal(saved.length, 1, '★校正必须真写回一次（否则名字白校正）');
        assert.equal(saved[0].n.tables.find((t) => t.id === PLUGIN_TABLE_STATE).name, DISPLAY_NAME_STATE, '状态表名要校正回我们的');
        assert.equal(saved[0].n.tables.find((t) => t.id === PLUGIN_TABLE_EVENTS).name, DISPLAY_NAME_EVENTS, '事件表名要校正回我们的');
        assert.deepEqual(saved[0].n.records, metaState.records, '★校正**只许改表名**，记录一个字不动');
        // 幂等：名字已经对了就不再写（防"每次投递都多写一次"）
        saved.length = 0;
        second.fn();
        assert.equal(saved.length, 0, '名字已经对时不许再写（校正必须是幂等的）');
    } finally {
        if (origWindow === undefined) delete globalThis.window; else globalThis.window = origWindow;
        if (origCustom === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = origCustom;
    }
});


// ★leg29：**逻辑表 → 插件表 id** 的映射锁（用户拍板「对齐插件内置表形状」的那一刀落点）。
//   为什么必须锁：映射错了的后果不是"报错"，而是**记录落进插件不认的表 ⇒ 详情视图又是空的**，
//   而且这条错误只会在实机肉眼可见——正是那一棒吃亏的地方。
test('M10：逻辑表名 → 插件内置表 id 的映射（世界状态→world_setting；世界大事→item_tracking）', () => {
    assert.equal(TABLE_ID_ALIAS[MEMORY_TABLE_STATE], PLUGIN_TABLE_STATE);
    assert.equal(TABLE_ID_ALIAS[MEMORY_TABLE_EVENTS], PLUGIN_TABLE_EVENTS);
    assert.deepEqual(Object.keys(TABLE_ID_ALIAS).sort(), [MEMORY_TABLE_EVENTS, MEMORY_TABLE_STATE].sort(),
        '★leg30：只有两张逻辑表（"史卷纪要"已并入世界大事，不许再回来）');
    // 表定义也必须用插件 id（name 才是人话表名）——与映射同源，防"映射改了、表定义忘了改"
    const sent = [];
    pushToMemory(buildMemoryPayload(world()), { store: { writeRecords(r, meta) { sent.push(meta); } } });
    const byId = new Map(sent[0].tables.map((t) => [t.id, t]));
    assert.ok(byId.has(PLUGIN_TABLE_STATE) && byId.has(PLUGIN_TABLE_EVENTS), '交出去的表定义用插件 id');
    // ★leg29（用户拍板「改表名注明归属」）：id 决定渲染器，**name 决定侧栏怎么读** ⇒ 必须注明这是我们的表，
    //   否则侧栏只写插件的默认名（"世界设定"/"物品追踪"），用户得点进去才知道装的是谁。
    assert.equal(byId.get(PLUGIN_TABLE_STATE).name, DISPLAY_NAME_STATE, 'world_setting 这张表的显示名要注明归属');
    assert.equal(byId.get(PLUGIN_TABLE_EVENTS).name, DISPLAY_NAME_EVENTS, 'item_tracking 这张表的显示名要注明归属');
    assert.ok(DISPLAY_NAME_STATE.includes(MEMORY_TABLE_STATE) && DISPLAY_NAME_EVENTS.includes(MEMORY_TABLE_EVENTS),
        '显示名里要含我们自己的逻辑名（用户一眼认得出）');
    assert.deepEqual(sent[0].tables.map((t) => t.id), [PLUGIN_TABLE_STATE, PLUGIN_TABLE_EVENTS], '只交两张表的定义');
});

// ★leg29：**同 id 必须覆盖**（用户实机复演抓到的真缺陷）——插件里原本就有 `world_setting`/`item_tracking`
//   两张内置表（带它自己的列定义），若"已存在就跳过"，我们给的列与显示名**一个字都进不去**
//   （复演里那两张表还是插件原列、侧栏还是"世界设定/物品追踪"）。口径：这两个槽位归我们管。
test('M12：插件已有同名内置表时，表定义必须被我方**覆盖**（列与显示名以我方为准）', () => {
    const saved = [];
    const pluginBuiltIn = {
        tables: [
            { id: PLUGIN_TABLE_STATE, name: '世界设定', icon: 'world', columns: ['设定名', '类型', '详细说明', '影响范围'], hidden: false },
            { id: PLUGIN_TABLE_EVENTS, name: '物品追踪', icon: 'item', columns: ['物品名称', '物品描述', '物品位置', '持有者', '状态', '备注'], hidden: false },
        ],
        records: {}, activeRecordIds: {},
    };
    const store = memoryStore({
        VariableInjector: { createDefaultState: () => ({ tables: [], records: {}, activeRecordIds: {} }) },
        Storage: { loadState: () => JSON.parse(JSON.stringify(pluginBuiltIn)), saveState: (n) => saved.push(JSON.parse(JSON.stringify(n))) },
    });
    store.writeRecords(buildMemoryPayload(world()), {
        tables: [
            { id: PLUGIN_TABLE_STATE, name: DISPLAY_NAME_STATE, icon: 'world', columns: STATE_COLUMNS, hidden: false },
            { id: PLUGIN_TABLE_EVENTS, name: DISPLAY_NAME_EVENTS, icon: 'item', columns: EVENT_COLUMNS, hidden: false },
        ], now: 1,
    });
    const after = saved.at(-1).tables;
    const it = after.find((t) => t.id === PLUGIN_TABLE_EVENTS);
    const ws = after.find((t) => t.id === PLUGIN_TABLE_STATE);
    assert.equal(it.name, DISPLAY_NAME_EVENTS, '★事件表显示名必须以我方为准（不许留插件的"物品追踪"）');
    assert.deepEqual(it.columns, EVENT_COLUMNS, '★事件表列必须以我方为准（否则详情视图读不到我们的列）');
    assert.equal(ws.name, DISPLAY_NAME_STATE, '★状态表显示名必须以我方为准');
    assert.deepEqual(ws.columns, STATE_COLUMNS, '★状态表列必须以我方为准');
    assert.equal(after.filter((t) => t.id === PLUGIN_TABLE_EVENTS).length, 1, '覆盖不是追加（不许出现两张同 id 的表）');
});

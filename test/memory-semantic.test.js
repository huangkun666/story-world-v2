// story-world-v2/test/memory-semantic.test.js
// ★leg30：**语义判据**（用户 2026-09-12 两张截图逼出来的"很乱"）。
//
// 为什么单开一个文件：本仓 leg29 那一棒把"表形状"对齐了插件，但那条判据只锁**列名与条数**——
//   列名对、条数对 ⇒ **538/538 全绿**，而插件里每一格都在说它不该说的话（位置列装人名、
//   每张卡挂一个假标签"未标记"、前史与发生同一批事件投两遍）。**列名不是语义**，
//   所以这类病在旧判据里**结构上不可能红**。这个文件补的就是那一层。
//
// 锁五条：
//   S1 **位置列只许是地点**——账上 `event.position`；**不许出现任何实体名**（用户实机看到"大虞、你"）
//   S2 **波及名单只许是账上真有的实体名**，且不许串到位置列去
//   S3 **前史不许两投**——同一次发生要么逐条、要么成段，绝不同时（旧设计投两张表 = 同一批事件两遍）
//   S4 **排序键不许投出去**——内部用的 `at` 只用来排序，值里不许残留
//   S5 **自检要报得出语义病**——只读自检必须能指出"位置列里有人名"（否则下一棒又只能靠肉眼）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryPayload, MEMORY_TABLE_STATE, MEMORY_TABLE_EVENTS, PLUGIN_TABLE_EVENTS } from '../src/memory-bridge.js';
import { memoryStoreReport, memoryStoreCheckLine } from '../web/index.js';

// 夹具刻意含一处"人名与地名同名"的危险形状：`大虞` 既是势力名、又是**玩家所在地**（真账里正是这样，
//   用户截图里"世界状态说你在大虞"与"世界大事的波及名单里有大虞"就是这么来的）。
//   本判据必须**不误报**这种情况（位置列写"大虞"是合法的：账上 position 就是它），
//   同时**必须抓得住**"把波及名单整串写进位置列"那种真病。
const world = () => ({
    version: 1,
    context: { world: '大荒', tension: 0.5, positions: ['临渊城', '大虞'], setting: { dynamic: { env: {} } } },
    entities: [
        { id: 'e1', kind: 'faction', name: '大虞', location: '临渊城' },
        { id: 'e2', kind: 'character', name: '薛铁衣', location: '忘川' },
        { id: 'e3', kind: 'character', name: '黄坤' },                 // 账上没有位置的人（旧版会被当"位置"乱用）
    ],
    weights: {},
    agendas: [{ id: 'a_1_1', owner: 'e1', goal: '夺大盘谷阵眼', visibility: 'known', maxSteps: 4, progress: 1 }],
    events: [
        { id: 'ev_9_1', title: '大虞设宴交接地契', source: { type: 'plot', ref: 'a_1_1' }, position: '大虞', ripples: ['e1', 'e3'], links: { up: [], down: [] }, closed: true, closedAt: 9 },
        { id: 'ev_11_1', title: '西极道上失期', source: { type: 'state' }, position: '西极昆仑山', ripples: [], links: { up: [], down: [] }, closed: true, closedAt: 11 },
    ],
    chronicle: [],
    milestones: [{ id: 'm_10', span: { from: 1, to: 10 }, counts: { events: 2 }, titles: ['发兵催战'], ids: ['ev_1_1', 'ev_2_1'] }],
    meta: { tick: 11, simLog: [] },
});

test('S1：位置列只许是地点——不许把实体名当位置（用户实机看到的「大虞、你」那一刀）', () => {
    const recs = buildMemoryPayload(world());
    const entityNames = new Set(world().entities.map((e) => e.name));
    const rows = recs[MEMORY_TABLE_EVENTS];
    // 前置：夹具里那个人名与地名同名的情况**真的存在**（否则下面的"不误报"是空话）
    assert.ok(entityNames.has('大虞'), '前置：夹具里 `大虞` 既是名字也是地点');
    assert.equal(rows.find((r) => r.values.物品名称 === '大虞设宴交接地契').values.物品位置, '大虞',
        '前置：位置列写账上的 `position`（哪怕它与某个实体同名，那是账本的事实）');
    for (const r of rows) {
        const where = r.values.物品位置;
        if (where === undefined) continue;                       // 没地点 ⇒ 整个键不出现（M5）
        // ★真病：**整串**人名（`大虞、黄坤` 这种"波及名单"）被写进位置列 —— 逗号分隔 + 每个片段都是实体名。
        //   逐个片段都查：单独一个同名地点合法，一**串**人名就是错位。
        const parts = String(where).split('、').map((s) => s.trim()).filter(Boolean);
        if (parts.length > 1) {
            assert.ok(!parts.every((p) => entityNames.has(p)),
                `★位置列装的是波及名单（${where}）——人名该在"持有者"格`);
        }
        assert.ok(!/^(未明|不详|未知|—|-)$/.test(String(where).trim()) || String(where).trim() === '未明',
            `位置列的占位符不许再用 \`—\` 充数，实际：${where}`);
    }
    // 波及名单必须出现在**人名格**里，且都是账上真有的名字
    const r1 = rows.find((r) => r.values.物品名称 === '大虞设宴交接地契');
    assert.equal(r1.values.持有者, '大虞、黄坤', '★波及名单进"持有者"格（插件的 人形图标 那一格）');
});

test('S2：持有者格只装账上真有的实体名（不许出现引擎 id、不许出现地点）', () => {
    const recs = buildMemoryPayload(world());
    const w = world();
    const names = new Set(w.entities.map((e) => e.name));
    const ids = new Set(w.entities.map((e) => e.id));
    for (const r of recs[MEMORY_TABLE_EVENTS]) {
        const holders = r.values.持有者;
        if (holders === undefined) continue;
        for (const part of String(holders).split('、').map((s) => s.trim()).filter(Boolean)) {
            assert.ok(!ids.has(part), `★引擎内码漏进了人名格：${part}`);
            assert.ok(names.has(part), `人名格里出现了账上没有的名字：${part}`);
        }
    }
});

test('S3：前史不许两投——同一次发生要么逐条、要么成段，绝不同时', () => {
    const recs = buildMemoryPayload(world());
    const log = recs[MEMORY_TABLE_EVENTS];
    // ① 只有**两张逻辑表**（"史卷纪要"若回来，这条会红）
    assert.deepEqual(Object.keys(recs).sort(), [MEMORY_TABLE_EVENTS, MEMORY_TABLE_STATE].sort());
    // ② 成段行里不许出现"同时也在逐条行里"的标题（同一批事件投两遍 = 旧设计的病）
    const perEventTitles = new Set(log.filter((r) => !String(r.values.轮次 || '').includes('–')).map((r) => r.values.物品名称));
    const spanRows = log.filter((r) => String(r.values.轮次 || '').includes('–'));
    assert.ok(spanRows.length >= 1, '前置：夹具里真有一段前史');
    for (const span of spanRows) {
        for (const part of String(span.values.物品描述 || '').split('：').slice(1).join('：').split('、').map((s) => s.trim()).filter(Boolean)) {
            assert.ok(!perEventTitles.has(part), `★「${part}」既逐条投了一遍、又被前史段收了一遍（同一件事两投）`);
        }
    }
    // ③ 记录 id 唯一（插件按 id 合并；同名 id = 后者覆盖前者）
    const ids = Object.values(recs).flat().map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, '记录 id 必须唯一');
});

test('S4：排序键不许投出去——值里不许残留内部字段', () => {
    const recs = buildMemoryPayload(world());
    for (const [table, list] of Object.entries(recs)) {
        for (const r of list) {
            assert.deepEqual(Object.keys(r).sort(), ['hidden', 'id', 'values'], `${table} 的记录多带了字段（插件只认 id/hidden/values）`);
        }
    }
});

test('S5：只读自检要报得出语义病——"位置列里有人名"不许再靠肉眼发现', () => {
    // 直接用**注入的假插件**（`YM.Storage.loadState`）——自检是只读的，不需要真存储，
    //   也不需要真浏览器：这正是它当初该有的形状（不能真跑的判据 = 交回给肉眼）。
    const mk = (records) => ({
        Storage: { loadState: () => ({ tables: [], records, activeRecordIds: {} }) },
    });
    // ① 干净账：自检必须说"无异常"
    const clean = buildMemoryPayload(world());
    const okReport = memoryStoreReport(mk({
        character_profile: [{ id: 'u1', hidden: false, values: { 姓名: '薛铁衣' } }],
        [PLUGIN_TABLE_EVENTS]: clean[MEMORY_TABLE_EVENTS],
    }));
    assert.equal(okReport.语义自检, '无异常（位置列没混进人名、记录 id 不重复）', `干净账不该报异常，实际：${JSON.stringify(okReport.语义自检)}`);
    // ② 脏账（模拟旧代码投出去的样子）：位置列装着**角色档案里那个人**的名字 ⇒ 自检必须点名
    const dirtyYm = mk({
        character_profile: [{ id: 'u1', hidden: false, values: { 姓名: '薛铁衣' } }],
        [PLUGIN_TABLE_EVENTS]: [{ id: 'sw2_ev_ev_9_1', hidden: false, values: { 物品名称: '大虞设宴交接地契', 物品位置: '薛铁衣、大虞' } }],
    });
    const dirty = memoryStoreReport(dirtyYm);
    assert.ok(Array.isArray(dirty.语义自检) && dirty.语义自检.length, `★自检必须报出"位置列里有人名"，实际：${JSON.stringify(dirty.语义自检)}`);
    assert.ok(String(dirty.语义自检.join('')).includes('薛铁衣'), '报告里要点名那个被错放的人');
    // ③ 自检行（每次投递打一行的那条）也要带出语义异常
    const line = memoryStoreCheckLine(dirtyYm);
    assert.ok(typeof line === 'string' && line.includes('记忆自检'), '自检行必须打得出来');
    assert.ok(line.includes('薛铁衣'), `★自检行必须带出语义异常，实际：${line}`);
});

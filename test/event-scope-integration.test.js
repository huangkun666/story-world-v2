import test from 'node:test';
import assert from 'node:assert/strict';
import { runTick, emptyStep } from '../src/tick.js';
import { buildEvolutionPack, trimPack, packTextOf, TOKEN_RATIO } from '../src/pack.js';
import { buildPanorama, archivedEventsOf } from '../src/panorama.js';
import { buildStoryReader, renderStoryReaderHtml } from '../src/story-reader.js';
import { renderBoardHtml } from '../src/render.js';
import { hotAccountShape, loadHotAccount, buildExportBundle, verifyImportBundle } from '../src/storage.js';
import { makeSnapshot, diffWorld, restoreFrom } from '../src/snapshot.js';
import { recallLedger, RECALL_MODES } from '../src/ledger-recall.js';
import { MAIN_PROMPT, OUTPUT_TEMPLATE } from '../src/prompts.js';
import { buildInjections } from '../web/inject.js';
import { prepareWorldInput } from '../src/world-input.js';
import { mergedMainHtml } from '../web/page-compose.js';

const scope = () => [{ kind: 'text', text: '全体学生' }];
const announcement = () => ({ id: 'ev_1_500', title: '学校公开OAA规则', eventProtocol: 4,
  source: { type: 'dialogue' }, producer: 'chat', recordType: 'result', dialogueKind: 'result',
  category: '公示', affected: scope(), audience: scope(), closed: true, closedAt: 1,
  timeMark: '08:15', position: '体育馆', links: { up: [], down: [] } });
const condition = () => ({ id: 'cond_1_1', eventRef: 'ev_1_500', statement: '学生可查阅OAA评级',
  scope: scope(), state: 'active', changes: [{ state: 'active', eventRef: 'ev_1_500', tick: 1 }] });
const world = () => ({ version: 1, context: { world: '校园', tension: 0.5, positions: ['体育馆'], playerId: 'e_p' },
  entities: [{ id: 'e_p', name: '黄坤', kind: 'character', location: '体育馆' },
    { id: 'e_a', name: '一之濑帆波', kind: 'character', location: '体育馆' }],
  weights: {}, agendas: [], events: [announcement()], conditions: [condition()], chronicle: [],
  milestones: [], meta: { tick: 1, simLog: [] } });
const tags = lines => ['```tags', ...lines, '```'].join('\n');

test('校园公告经真实runTick只记录一次完整范围，实际行动独立保护', async () => {
  const w = world(); w.events = []; delete w.conditions; w.meta.tick = 0;
  const r = await runTick({ ssot: w, dialogue: tags(['【协议】4', '【此刻】08:15', '【场景：体育馆】',
    '【事件】E1｜学校公开OAA规则｜已完成', '【类别】E1｜公示',
    '【影响范围】E1｜原文｜全体学生', '【公开范围】E1｜原文｜全体学生',
    '【持续条件】C1｜E1｜学生可查阅OAA评级｜有效', '【条件范围】C1｜原文｜全体学生',
    '【行动】黄坤｜查阅应用得知评级规则']), transport: async () => ({ text: JSON.stringify(emptyStep()) }) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.dialogueStats.resultEvents.length, 1);
  assert.deepEqual(r.pack.pack.turnFacts.events[0].affected, scope());
  assert.deepEqual(r.pack.pack.turnFacts.events[0].audience, scope());
  assert.deepEqual(r.pack.pack.turnFacts.actedIds, ['e_p']);
  assert.deepEqual(r.ssot.meta.turnProtection.participantIds, [], '群体原文不扩写为已确认人物');
  assert.equal(r.pack.text.split('学校公开OAA规则').length - 1, 1);
  assert.equal(r.pack.pack.conditions.length, 1);
  assert.equal(r.pack.pack.conditions[0].statement, '学生可查阅OAA评级');
});

test('规则原因归档后仍提供完整现行条件，旧公告不重复进聊天', () => {
  const w = world(); const old = w.events.pop();
  w.milestones = [{ id: 'm_25', ids: [old.id], titles: [old.title], rows: [old] }];
  const before = JSON.stringify(w);
  const built = buildEvolutionPack(w, null);
  assert.equal(built.pack.conditions[0].eventRef, old.id);
  assert.equal(built.pack.conditions[0].statement, '学生可查阅OAA评级');
  assert.equal(JSON.stringify(w), before);
});

test('同轮未决事件的输入保留范围与本事件时间，缺范围不造值', () => {
  const w = world(); w.events[0].closed = false;
  w.events.push({ id: 'ev_1_2', title: '普通旧事', source: { type: 'state' }, closed: false });
  const built = buildEvolutionPack(w, null);
  const item = built.pack.pendingEvents.find(e => e.id === 'ev_1_500');
  assert.deepEqual(item.affected, scope()); assert.deepEqual(item.audience, scope());
  assert.equal(item.timeMark, '08:15');
  assert.equal(Object.hasOwn(built.pack.pendingEvents.find(e => e.id === 'ev_1_2'), 'affected'), false);
});

test('热账、带验签导入和增量快照保留范围、条件与原因历史', async () => {
  const w = world();
  assert.deepEqual(loadHotAccount(JSON.parse(JSON.stringify(hotAccountShape(w)))), w);
  const exported = await buildExportBundle(w);
  const imported = await verifyImportBundle(exported.json);
  assert.equal(imported.ok, true); assert.deepEqual(imported.world, w);
  const next = structuredClone(w); next.conditions[0].state = 'ended';
  next.conditions[0].endCause = 'ev_2_1';
  next.conditions[0].changes.push({ state: 'ended', eventRef: 'ev_2_1', tick: 2 });
  const full = makeSnapshot({ world: w, id: 'snap1', tick: 1, kind: 'full' });
  const delta = makeSnapshot({ world: next, id: 'snap2', tick: 2, kind: 'delta', anchorId: 'snap1', delta: diffWorld(w, next).delta });
  const restored = restoreFrom({ snapshots: [full, delta], targetId: 'snap2' });
  assert.equal(restored.ok, true, restored.error); assert.deepEqual(restored.world, next);
});

test('范围详情在全景、归档和故事阅读中保留，条件可在现有页面查看', () => {
  const w = world();
  assert.deepEqual(buildPanorama(w).threads[0].events[0].affected, scope());
  const chapter = buildStoryReader(w).recent[0]?.chapters.find(c => c.kind === 'event');
  assert.deepEqual(chapter?.affected, scope());
  assert.match(renderStoryReaderHtml(w), /影响.*全体学生/);
  assert.match(renderStoryReaderHtml(w), /公开.*全体学生/);
  assert.match(renderBoardHtml(w).feed, /学生可查阅OAA评级/);
  assert.match(mergedMainHtml({ panorama: renderStoryReaderHtml(w), board: renderBoardHtml(w) }), /data-current-conditions/);
  w.milestones = [{ id: 'm_25', ids: ['ev_1_500'], rows: w.events }]; w.events = [];
  assert.deepEqual(archivedEventsOf(w)[0].affected, scope());
  assert.deepEqual(archivedEventsOf(w)[0].audience, scope());
  assert.equal(archivedEventsOf(w)[0].timeMark, '08:15');
});

test('召回结果整条保留类别与范围，按原来源过滤', () => {
  const w = world();
  w.events[0].producer = 'world'; w.events[0].source = { type: 'state' };
  w.chronicle.push({ id: 'ch1', tick: 1, text: '学校公开OAA规则', eventRef: 'ev_1_500', kind: 'state' });
  const r = recallLedger(w, { modes: [RECALL_MODES.RECENT], maxChars: 5000, audience: 'chat' });
  assert.match(r.items[0].text, /影响.*全体学生/);
  assert.match(r.items[0].text, /公开.*全体学生/);
  w.events[0].producer = 'chat'; w.events[0].source = { type: 'dialogue' };
  assert.equal(recallLedger(w, { modes: [RECALL_MODES.RECENT], audience: 'chat' }).items.length, 0);
});

test('重提已归档公告只引用旧事实，不新建事件且世界输入只递一次正文', async () => {
  const w = world(); const e = w.events.pop();
  w.milestones = [{ id: 'm_25', ids: [e.id], titles: [e.title], rows: [e] }];
  const r = await runTick({ ssot: w, dialogue: tags(['【协议】4', `【引用】${e.id}`]),
    transport: async () => ({ text: JSON.stringify(emptyStep()) }) });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.dialogueStats.events, 0);
  assert.equal(r.pack.pack.turnFacts.references[0].id, e.id);
  assert.deepEqual(r.pack.pack.turnFacts.references[0].audience, scope());
  assert.equal(r.pack.text.split(e.title).length - 1, 1);
});

test('当前条件按明确新成员关系匹配，原公告历史确认部分不回填', () => {
  const w = world(); w.entities.push({ id: 'e_school', name: '学生会', kind: 'faction', branches: ['二年级'], location: '体育馆' });
  w.entities[1].parent = '二年级';
  const members = [{ kind: 'members', text: '学生会成员', ref: 'e_school' }];
  w.events[0].affected = [{ ...members[0], resolution: { knownIds: ['e_a'], asOfTick: 1 } }];
  w.conditions[0].scope = members;
  w.entities.push({ id: 'e_new', name: '新成员', kind: 'character', parent: '学生会', location: '体育馆' });
  const before = JSON.stringify(w);
  const built = buildEvolutionPack(w, null);
  assert.deepEqual(new Set(built.pack.conditions[0].scope[0].resolution.knownIds), new Set(['e_a', 'e_new']));
  assert.deepEqual(w.events[0].affected[0].resolution.knownIds, ['e_a']);
  assert.equal(JSON.stringify(w), before);
  const injection = buildInjections(w).tags;
  assert.match(injection, /学生可查阅OAA评级/);
  assert.match(injection, /新成员/);
  assert.equal(injection.includes(w.events[0].title), false, '当前条件不复述聊天公告');
});

test('已结束条件不作为当前规则注入，但明确终止留下可召回的历史', () => {
  const w = world(); w.conditions[0].state = 'ended'; w.conditions[0].endCause = 'ev_2_1';
  w.conditions[0].changes.push({ state: 'ended', eventRef: 'ev_2_1', tick: 2 });
  w.events.push({ id: 'ev_2_1', title: '学校撤销原评级规则', source: { type: 'state' }, producer: 'world', closed: true });
  w.chronicle.push({ id: 'ch2', tick: 2, text: '持续条件「学生可查阅OAA评级」：已结束', eventRef: 'ev_2_1', producer: 'world', recordType: 'state' });
  assert.equal(buildEvolutionPack(w, null).pack.conditions, undefined);
  assert.equal(buildInjections(w).tags.includes('学生可查阅OAA评级'), false);
  assert.match(recallLedger(w, { modes: [RECALL_MODES.BY_KEYWORD], text: '评级', audience: 'chat' }).items[0].text, /已结束/);
});

test('整包裁剪只移除完整条件并留痕，不截断条文', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...condition(), id: `cond_${i}`, statement: `规则${i}`.repeat(100) }));
  const pack = { conditions: rows.slice(), entities: [], pendingEvents: [], agendas: [], recentClosedEvents: [],
    closedAgendas: [], idleFaces: [], openRoots: [], threads: [], closedRoots: [] };
  const cut = trimPack(pack, 300);
  assert.ok((pack.conditions || []).length < rows.length);
  for (const c of pack.conditions || []) assert.deepEqual(c, rows.find(r => r.id === c.id));
  assert.ok(cut.some(c => c.startsWith('conditions')));
  assert.ok(Math.ceil(packTextOf(pack).length / TOKEN_RATIO) <= 300);
});

test('同轮范围只从本轮事实提供，事件栏目仅引用且不改原账', () => {
  for (const closed of [false, true]) {
    const w = world(); delete w.conditions;
    w.events[0].closed = closed;
    w.events[0].affected = [{ kind: 'text', text: '本轮独有适用范围' }];
    const before = structuredClone(w);
    const facts = { events: [structuredClone(w.events[0])] };
    const projected = prepareWorldInput(w, facts);
    const built = buildEvolutionPack(projected.world, null, { turnFacts: facts });
    assert.equal(built.text.split('本轮独有适用范围').length - 1, 1);
    assert.deepEqual(w, before);
  }
});

test('预算不足时新版事件保留完整范围或整项移除留痕，旧事件仍可降级', () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ ...announcement(), id: `ev_1_${i + 1}`,
    title: `公告${i}`, affected: [{ kind: 'text', text: '完整适用范围'.repeat(100) }] }));
  const legacy = { id: 'ev_0_1', title: '旧事件', source: { type: 'state' }, position: '体育馆' };
  const pack = { entities: [], pendingEvents: [...rows, legacy], recentClosedEvents: rows.map(e => ({ ...e, closed: true })),
    agendas: [], closedAgendas: [], idleFaces: [], openRoots: [], threads: [], closedRoots: [] };
  const cut = trimPack(pack, 400);
  for (const key of ['pendingEvents', 'recentClosedEvents']) {
    for (const row of rows) {
      const kept = pack[key].find(e => e.id === row.id);
      if (kept) assert.deepEqual(kept.affected, row.affected);
      else assert.ok(cut.includes(`${key}.${row.id}`));
    }
  }
  assert.deepEqual(pack.pendingEvents.find(e => e.id === legacy.id), { id: legacy.id, title: legacy.title });
  assert.ok(Math.ceil(packTextOf(pack).length / TOKEN_RATIO) <= 400);
});

test('世界输出规范采用范围与条件，获知不要求知识表', () => {
  const template = JSON.parse(OUTPUT_TEMPLATE);
  assert.equal(template.eventProtocol, 4);
  assert.equal(typeof template.newEvents[0].pending, 'boolean');
  assert.ok(template.newEvents[0].affected);
  assert.equal(Object.hasOwn(template.newEvents[0], 'ripples'), false);
  assert.match(MAIN_PROMPT, /conditionUpdates/);
  assert.match(MAIN_PROMPT, /获知途径/);
  assert.doesNotMatch(MAIN_PROMPT, /"informed"|informationUpdates/);
});

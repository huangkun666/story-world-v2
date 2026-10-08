import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, hasTagFacts, tagReadoutLine } from '../src/tag-extract.js';
import { registerDialogueFacts, settleTick } from '../src/settle.js';
import { runTick, emptyStep } from '../src/tick.js';
import { rotateChronicle, volumeToChronicleRows } from '../src/storage.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { expandChain } from '../src/chain.js';
import { forestOf, parentOfEvent } from '../src/lines.js';

const world = () => ({ version: 1, context: { world: '校园', tension: 0.5, positions: ['礼堂'], playerId: 'e_p' },
  entities: [{ id: 'e_p', name: '黄坤', kind: 'character', location: '礼堂' }, { id: 'e_a', name: '甲', kind: 'character', location: '礼堂' }],
  weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] } });
const tags = (lines) => ['```tags', ...lines, '```'].join('\n');
const parse = (w, lines) => extractTags(tags(lines), { entities: w.entities, locations: w.context.positions, playerId: 'e_p' });
const register = (w, lines, tick = 1) => registerDialogueFacts(w, { facts: parse(w, lines), tick });

test('v3 result parses exact grouping, scene, time and unknown participant names', () => {
  const w = world();
  const f = parse(w, ['【协议】3', '【场景：礼堂】', '【此刻】午后', '【事件】E1｜取得身份与许可｜黄坤、来客｜已完成｜ev_0_1、ev_0_2', '【变化】黄坤｜身份｜特权学生｜E1', '【承诺】黄坤｜保护来客｜来客｜E1']);
  assert.equal(f.protocol, 3);
  assert.equal(f.events.length, 1);
  assert.deepEqual(f.events[0], { localId: 'E1', title: '取得身份与许可', participantIds: ['e_p'], participantNames: ['来客'], pending: false, location: '礼堂', causeIds: ['ev_0_1', 'ev_0_2'] });
  assert.equal(f.at, '午后');
  assert.equal(f.changes[0].value, '特权学生');
  assert.equal(f.changes[0].eventLocalId, 'E1');
  assert.equal(f.promises[0].eventLocalId, 'E1');
  assert.equal(hasTagFacts(parse(w, ['【协议】3', '【事件】E1｜边境条件改变｜来客｜未决'])), true);
});

test('ordinary legacy greetings produce protection without events or chronicle', () => {
  const w = world();
  const st = register(w, ['【行动】甲｜问候｜黄坤', '【行动】黄坤｜回应']);
  assert.equal(st.events, 0);
  assert.deepEqual(st.actedIds, ['e_a', 'e_p']);
  assert.deepEqual(st.resultEvents, []);
  assert.deepEqual(st.changedFields, []);
  assert.deepEqual(w.events, []);
  assert.deepEqual(w.chronicle, []);
});

test('action display cap cannot remove protection for a known actor or later player action', () => {
  const w = world();
  w.entities.push({ id: 'e_b', name: '乙', kind: 'character', location: '礼堂' });
  const f = extractTags(tags(['【行动】甲｜问候', '【行动】乙｜列席', '【行动】黄坤｜回应', '【行动】黄坤｜离开']),
    { entities: w.entities, locations: ['礼堂'], playerId: 'e_p', maxActions: 1 });
  assert.equal(f.actions.length, 1, '保留既有解析显示封顶');
  const st = registerDialogueFacts(w, { facts: f, tick: 1 });
  assert.deepEqual(st.actedIds, ['e_a', 'e_b', 'e_p']);
  assert.equal(st.events, 0);
});

test('readout does not claim ordinary unresolved action prose entered the world input', () => {
  const f = parse(world(), ['【行动】来客｜问候']);
  const line = tagReadoutLine(f);
  assert.ok(line.includes('不在名册'));
  assert.equal(line.includes('已递给世界模型'), false);
});

test('association may precede its result line and independent v3 facts keep separate results', () => {
  const w = world();
  const st = register(w, ['【协议】3', '【变化】黄坤｜身份｜特权学生｜E1',
    '【事件】E1｜身份确立｜黄坤｜已完成', '【承诺】甲｜日后交付凭证｜黄坤']);
  assert.equal(st.events, 2);
  assert.equal(w.meta.entityFields.e_p.fields.身份.cause, st.resultEvents[0].id);
  assert.equal(st.resultEvents[0].closed, true);
  assert.equal(st.resultEvents[1].closed, false);
});

test('multiple changes and a promise attach to one explicit result and preserve source', () => {
  const w = world();
  const st = register(w, ['【协议】3', '【此刻】午后', '【事件】E1｜身份及许可确立｜黄坤、甲、来客｜已完成', '【变化】黄坤｜身份｜特权学生｜E1', '【变化】黄坤｜定位｜获准自由出入｜E1', '【承诺】甲｜提供凭证｜黄坤｜E1']);
  assert.equal(st.events, 1);
  assert.equal(st.updates, 2);
  assert.equal(w.chronicle.length, 1);
  assert.equal(w.events[0].closed, true);
  assert.equal(w.events[0].closedAt, 1);
  assert.equal(w.events[0].dialogueKind, 'result');
  assert.equal(w.events[0].producer, 'chat');
  assert.equal(w.events[0].recordType, 'result');
  assert.deepEqual(w.events[0].participantNames, ['来客']);
  assert.equal(Object.hasOwn(w.events[0], 'position'), false);
  assert.deepEqual(st.resultEvents, w.events);
  assert.deepEqual(st.changedFields, [{ entityId: 'e_p', field: '身份' }, { entityId: 'e_p', field: '定位' }]);
  assert.equal(w.meta.entityFields.e_p.fields.身份.cause, w.events[0].id);
  assert.equal(w.meta.entityFields.e_p.fields.定位.cause, w.events[0].id);
  assert.deepEqual(st.actedIds, ['e_a']);
  assert.equal(w.chronicle[0].producer, 'chat');
  assert.equal(w.chronicle[0].recordType, 'result');
  assert.equal(validate(w, ssotSchema).ok, true, validate(w, ssotSchema).errors.join('; '));
});

test('legacy changes are closed, promises pending, unchanged values do not add results', () => {
  const w = world();
  const st = register(w, ['【变化】黄坤｜身份｜特权学生', '【承诺】甲｜封锁消息｜黄坤']);
  assert.equal(st.events, 2);
  assert.equal(w.events[0].closed, true);
  assert.equal(w.events[1].closed, false);
  const again = register(w, ['【变化】黄坤｜身份｜特权学生'], 2);
  assert.equal(again.events, 0);
  assert.equal(again.noop, 1);
});

test('explicit pending result accepts known closed and archived causes without invented references', () => {
  const w = world();
  w.events.push({ id: 'ev_0_1', title: '旧结果', source: { type: 'state' }, closed: true, links: { up: [], down: [] } });
  w.milestones.push({ id: 'm_10', ids: ['ev_0_2'] });
  const st = register(w, ['【协议】3', '【场景：礼堂】', '【事件】E1｜仍需兑现的约定｜甲｜未决｜ev_0_1、ev_0_2、ev_missing']);
  assert.equal(st.resultEvents[0].closed, false);
  assert.deepEqual(st.resultEvents[0].links.up, ['ev_0_1', 'ev_0_2']);
  assert.equal(st.resultEvents[0].position, '礼堂');
  assert.ok(st.rejected.some(r => r.why === 'cause' && r.ref === 'ev_missing'));
  assert.ok(w.events[0].links.down.includes(st.resultEvents[0].id));
});

test('malformed results and missing associations are reported and cannot silently become separate changes', () => {
  const w = world();
  const f = parse(w, ['【协议】3', '【事件】E1｜许可确立｜黄坤｜已完成', '【事件】E1｜重复编号｜甲｜未决', '【事件】E2｜坏状态｜甲｜进行中', '【变化】黄坤｜身份｜学生｜E9', '【承诺】甲｜守约｜黄坤｜E9']);
  assert.equal(f.events.length, 1);
  assert.equal(f.eventsBad.length, 2);
  const st = registerDialogueFacts(w, { facts: f, tick: 1 });
  assert.equal(st.updates, 0);
  assert.equal(w.entities[0].身份, undefined);
  assert.equal(st.events, 1);
  assert.equal(st.rejected.filter(r => r.why === 'eventLocalId').length, 2);
});

test('v3 intent with missing, unsupported or conflicting protocol never falls back to legacy field values', () => {
  for (const headers of [[], ['【协议】5'], ['【协议】3', '【协议】4'], ['【协议】4', '【协议】3']]) {
    const w = world();
    const f = parse(w, [...headers, '【变化】黄坤｜身份｜学生｜E1', '【承诺】甲｜守约｜黄坤｜E1', '【事件】E1｜身份确立｜黄坤｜已完成']);
    const st = registerDialogueFacts(w, { facts: f, tick: 1 });
    assert.equal(w.entities[0].身份, undefined, `must not write legacy value for ${headers}`);
    assert.equal(st.events, 0);
    assert.equal(f.changes.length, 0);
    assert.equal(f.promises.length, 0);
    assert.ok(f.eventsBad.some(r => r.why === 'protocol'));
    assert.ok(f.changesBad.some(r => r.why === 'protocol'));
    assert.ok(f.promisesBad.some(r => r.why === 'protocol'));
    assert.ok(st.rejected.some(r => r.why === 'protocol'));
  }
  const legacy = world();
  register(legacy, ['【变化】黄坤｜身份｜值中｜原有分隔']);
  assert.equal(legacy.entities[0].身份, '值中｜原有分隔', 'genuine legacy value separator behavior stays compatible');
});

test('v3 results still honor tag fence and JSON escaped fence restoration', () => {
  const w = world();
  assert.deepEqual(extractTags('【协议】3\n【事件】E1｜结果｜甲｜已完成', { entities: w.entities }).events, []);
  const f = extractTags(JSON.stringify({ tags: tags(['【协议】3', '【事件】E1｜结果｜甲｜已完成']) }), { entities: w.entities });
  assert.equal(f.restored, true);
  assert.equal(f.events.length, 1);
});

test('runTick supplies compact results and protections without ordinary action prose', async () => {
  const w = world();
  const r = await runTick({ ssot: w, dialogue: tags(['【协议】3', '【行动】黄坤｜递交证明', '【行动】甲｜问候', '【事件】E1｜身份许可确立｜黄坤、甲｜已完成', '【变化】黄坤｜身份｜特权学生｜E1']), transport: async () => ({ text: JSON.stringify(emptyStep()) }) });
  assert.equal(r.ok, true, r.error);
  const tf = r.pack.pack.turnFacts;
  assert.equal(tf.events.length, 1);
  assert.equal(tf.events[0].title, '身份许可确立');
  assert.deepEqual(tf.actedIds, ['e_a', 'e_p']);
  assert.deepEqual(tf.changedFields, [{ entityId: 'e_p', field: '身份' }]);
  assert.equal(JSON.stringify(tf).includes('问候'), false);
  assert.equal(JSON.stringify(tf).includes('递交证明'), false);
  assert.deepEqual(r.ssot.meta.turnProtection, { tick: 1, actedIds: ['e_a', 'e_p'], changedFields: tf.changedFields, participantIds: ['e_p', 'e_a'] });
});

test('archive and cold volume retain producer and record type for explicit results', () => {
  const w = world();
  register(w, ['【协议】3', '【此刻】午后', '【事件】E1｜许可确立｜黄坤、来客｜已完成']);
  w.meta.tick = 25;
  const r = settleTick({ ssot: w, step: emptyStep() });
  assert.equal(r.ok, true, r.stage.warnings.join('; '));
  const archived = r.ssot.milestones.flatMap(m => m.rows || []).find(e => e.id === 'ev_1_500');
  assert.equal(archived.producer, 'chat');
  assert.equal(archived.recordType, 'result');
  assert.equal(archived.dialogueKind, 'result');
  assert.deepEqual(archived.participantNames, ['来客']);
  assert.equal(archived.timeMark, '午后');
  assert.equal(validate(r.ssot, ssotSchema).ok, true, validate(r.ssot, ssotSchema).errors.join('; '));
  r.ssot.chronicle.push({ id: 'ch_27', tick: 27, text: '下一轮' });
  const { volume } = rotateChronicle(r.ssot, { limits: { ticks: 0, bytes: Infinity } });
  const cold = volume.rows.find(row => row.eventRef === 'ev_1_500');
  assert.equal(cold.producer, 'chat');
  assert.equal(cold.recordType, 'result');
  const rendered = volumeToChronicleRows(volume).find(row => row.eventRef === 'ev_1_500');
  assert.equal(rendered.producer, 'chat');
  assert.equal(rendered.recordType, 'result');
});

test('explicit dialogue causal links trace upward and downward and join the parent story tree', () => {
  const w = world();
  w.events.push({ id: 'ev_0_1', title: '资格审核通过', source: { type: 'state' }, producer: 'world', closed: true, links: { up: [], down: [] } });
  const { resultEvents: [child] } = register(w, ['【协议】3', '【事件】E1｜许可确立｜黄坤｜已完成｜ev_0_1']);
  assert.deepEqual(child.source, { type: 'dialogue' });
  assert.equal(child.producer, 'chat');
  assert.deepEqual(expandChain(w, child.id).up.map(n => n.id).filter(Boolean), ['ev_0_1']);
  assert.equal(expandChain(w, child.id).up.some(n => n.kind === 'gap'), false);
  assert.deepEqual(expandChain(w, 'ev_0_1').down.map(n => n.id), [child.id]);
  assert.equal(parentOfEvent(child), 'ev_0_1');
  assert.equal(forestOf(w).trees.length, 1);
  assert.deepEqual(forestOf(w).trees[0].ids.sort(), ['ev_0_1', child.id].sort());
});

test('multiple dialogue causes remain visible without inventing rings across converging branches', () => {
  const w = world();
  w.events.push({ id: 'ev_1_1', title: '资格通过', source: { type: 'state' }, closed: true, links: { up: [], down: [] } },
    { id: 'ev_2_1', title: '资源到位', source: { type: 'ripple', ref: 'ev_1_1' }, closed: true, links: { up: ['ev_1_1'], down: [] } });
  const { resultEvents: [child] } = register(w, ['【协议】3', '【事件】E1｜许可确立｜黄坤｜已完成｜ev_1_1、ev_2_1'], 3);
  const up = expandChain(w, child.id).up;
  assert.deepEqual(new Set(up.map(n => n.id).filter(Boolean)), new Set(['ev_1_1', 'ev_2_1']));
  assert.deepEqual(up.map(n => n.id).filter(Boolean), ['ev_1_1', 'ev_2_1'], 'shared ancestors precede their descendants');
  assert.equal(up.some(n => n.kind === 'gap'), false);
  const down = expandChain(w, 'ev_1_1').down;
  const descendants = down.flatMap(n => [n, ...(n.children || [])]);
  assert.equal(descendants.filter(n => n.id === child.id).length, 2, 'both valid causal paths are visible');
  assert.equal(descendants.some(n => n.ring), false, 'a shared descendant across distinct paths is not a cycle');
  assert.equal(parentOfEvent(child), 'ev_1_1', 'first declared causal parent determines single-tree placement');
  assert.equal(forestOf(w).trees.length, 1);
  assert.deepEqual(forestOf(w).trees[0].joins, [child.id]);
});

test('archived dialogue results retain causal chain and single-parent forest placement', () => {
  const w = world();
  w.events.push({ id: 'ev_1_1', title: '资格通过', source: { type: 'state' }, producer: 'world', closed: true, closedAt: 1, links: { up: [], down: [] } });
  const { resultEvents: [child] } = register(w, ['【协议】3', '【事件】E1｜许可确立｜黄坤｜已完成｜ev_1_1'], 2);
  w.meta.tick = 25;
  const r = settleTick({ ssot: w, step: emptyStep() });
  assert.equal(r.ok, true, r.stage.warnings.join('; '));
  assert.equal(r.ssot.events.length, 0);
  assert.deepEqual(expandChain(r.ssot, child.id).up.map(n => n.id).filter(Boolean), ['ev_1_1']);
  assert.deepEqual(expandChain(r.ssot, 'ev_1_1').down.map(n => n.id), [child.id]);
  assert.equal(forestOf(r.ssot).trees.length, 1);
  const archivedChild = r.ssot.milestones.flatMap(m => m.rows).find(e => e.id === child.id);
  assert.deepEqual(archivedChild.source, { type: 'dialogue' });
  assert.equal(archivedChild.producer, 'chat');
});

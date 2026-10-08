import test from 'node:test';
import assert from 'node:assert/strict';
import * as snapshots from '../src/snapshot.js';
import { renderSnapshotsHtml } from '../src/render.js';

const world = () => ({ meta: { tick: 5 }, entities: [{ id: 'p', name: '甲', location: '大营' }], events: [], agendas: [], conditions: [] });
const preview = rows => snapshots.previewSnapshots(rows);

test('同轮不同状态只显示差异数量，增量仍自动还原原世界', () => {
    const a = world(), b = structuredClone(a);
    b.entities[0].location = '渡口';
    b.events.push({ id: 'e', title: '渡口禁行规定发布', closed: true });
    const first = snapshots.planStep({ world: a, seq: 15, tick: 5, reason: '落账' });
    const next = snapshots.planStep({ world: b, seq: 16, tick: 5, reason: '落账', prevAnchorWorld: a, prevAnchorId: first.snapshot.id, anchorSeq: 16 });
    const rows = [next.snapshot, first.snapshot], before = JSON.stringify(rows);
    const out = preview(rows), changed = out.find(r => r.id === next.snapshot.id);
    assert.equal(changed.preview.diffCount, 2);
    assert.deepEqual(snapshots.restoreFrom({ snapshots: rows, targetId: next.snapshot.id }).world, b);
    assert.equal(JSON.stringify(rows), before, '旧快照不改写');
    const html = renderSnapshotsHtml(b, { config: { snapshots: { list: out } } });
    assert.match(html, /差异 2 处/);
    assert.doesNotMatch(html, /渡口禁行规定发布|大营|增量|完整|锚点|查看变化/);
    assert.match(html, /第 2 次保存.*最新/);
});

test('首份、同内容及断链都如实显示，不能把缺失基准当成没有变化', () => {
    const a = world();
    const rows = [
        snapshots.makeSnapshot({ world: a, id: 's1', tick: 5, reason: '落账', kind: 'full' }),
        snapshots.makeSnapshot({ world: structuredClone(a), id: 's2', tick: 5, reason: '落账', kind: 'full' }),
        snapshots.makeSnapshot({ id: 's3', tick: 5, reason: '落账', kind: 'delta', anchorId: 'missing', delta: { set: {}, del: {} } }),
    ];
    const out = preview(rows);
    assert.equal(out.length, 2, '相同完整世界只显示一次，坏链仍单独说明');
    assert.equal(out[0].id, 's2');
    assert.equal(out[0].preview.diffCount, null);
    assert.equal(out[1].preview.readable, false);
    assert.match(out[1].preview.error, /锚|不存在/);
    const html = renderSnapshotsHtml(a, { config: { snapshots: { list: out } } });
    assert.match(html, /无法读取/);
    assert.match(html, /disabled/);
});

test('盘算、持续条件和人物属性只计数量，不输出内容清单', () => {
    const a = world(), b = structuredClone(a);
    a.agendas.push({ id: 'a', goal: '修复渡桥', stage: '筹备' });
    b.agendas.push({ id: 'a', goal: '修复渡桥', stage: '施工' });
    b.entities[0].身份 = '渡口守卫';
    b.conditions.push({ id: 'c', statement: '大桥禁止通行', state: 'active' });
    const out = preview([a, b].map((w, i) => snapshots.makeSnapshot({ world: w, id: 's' + (i + 1), tick: 5, kind: 'full' })));
    assert.equal(out[1].preview.diffCount, 3);
    const html = renderSnapshotsHtml(b, { config: { snapshots: { list: out } } });
    assert.doesNotMatch(html, /修复渡桥|渡口守卫|大桥禁止通行/);
});

test('跳过断链时明确比较的是哪一份，缺失完整内容不能冒充可恢复', () => {
    const a = world(), b = structuredClone(a);
    b.entities[0].location = '北城';
    const rows = [
        snapshots.makeSnapshot({ world: a, id: 's1', kind: 'full' }),
        snapshots.makeSnapshot({ id: 's2', kind: 'delta', anchorId: 'missing', delta: { set: {}, del: {} } }),
        snapshots.makeSnapshot({ world: b, id: 's3', kind: 'full' }),
        { id: 's4', kind: 'full' },
    ];
    const out = preview(rows);
    assert.equal(out[2].preview.comparedTo, 's1');
    assert.equal(out[2].preview.diffCount, 1);
    assert.equal(out[3].preview.readable, false);
});

test('相同 full 与 delta 合并一行，保留真实当前目标且不改底层锚点', () => {
    const a = world(), b = structuredClone(a);
    b.entities[0].location = '南城';
    const rows = [
        snapshots.makeSnapshot({ world: a, id: 's1', kind: 'full', tick: 5 }),
        snapshots.makeSnapshot({ id: 's2', kind: 'delta', anchorId: 's1', delta: snapshots.diffWorld(a, b).delta, tick: 5 }),
        snapshots.makeSnapshot({ world: b, id: 's3', kind: 'full', tick: 5 }),
    ];
    rows[1].current = true;
    const original = JSON.stringify(rows), out = preview(rows);
    assert.deepEqual(out.map(r => r.id), ['s1', 's2']);
    assert.equal(out[1].current, true);
    assert.deepEqual(snapshots.restoreFrom({ snapshots: rows, targetId: out[1].id }).world, b);
    assert.equal(JSON.stringify(rows), original);
    const html = renderSnapshotsHtml(b, { config: { snapshots: { list: out } } });
    assert.equal((html.match(/data-action="snapshot-restore"/g) || []).length, 2);
    assert.doesNotMatch(html, /data-snap="s3"|增量|完整/);
});

test('非相邻相同状态也合并，对象键顺序不构成新回档结果', () => {
    const a = world(), b = structuredClone(a);
    b.entities[0].location = '北城';
    const reordered = { conditions: [], events: [], agendas: [], entities: a.entities, meta: a.meta };
    const out = preview([a, b, reordered].map((w, i) => snapshots.makeSnapshot({ world: w, id: 's' + (i + 1), kind: 'full', tick: 5 })));
    assert.deepEqual(out.map(r => r.id), ['s2', 's3']);
    assert.equal(out[1].preview.diffCount, 1);
});

test('世界相同但恢复历史 known 不同时保留选择，大差异数量不被阈值截断', () => {
    const a = world(), b = structuredClone(a);
    const rows = [a, b].map((w, i) => snapshots.makeSnapshot({ world: w, id: 's' + (i + 1), kind: 'full', tick: 5 }));
    rows[0].memoryHistory = { known: {} };
    rows[1].memoryHistory = { known: { ch1: '校验值' } };
    assert.equal(preview(rows).length, 2);
    assert.equal(preview(rows)[1].preview.diffCount, 1);
    a.extra = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => ['k' + i, 0]));
    b.extra = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => ['k' + i, 1]));
    const many = preview([a, b].map((w, i) => snapshots.makeSnapshot({ world: w, id: 's' + (i + 1), kind: 'full' })));
    assert.equal(many[1].preview.diffCount, 5001);
});

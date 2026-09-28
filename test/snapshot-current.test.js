// story-world-v2/test/snapshot-current.test.js
// ★★leg108（B6）：**"盘上现在这份是哪一份"必须标出来，而且不许标错。**
//
// 病（`STATE.md` §3 ④ 登记的 B6）：快照页只列"每一步"，**不标哪一份对应盘上现在这份账**
//   ⇒ 玩家看不出自己站在链上的哪一格，也看不出点哪一枚「回到此步」其实是空操作。
//
// ★★为什么不能拿"最新那份"当"当前"（本棒实测证伪，这是本笔最该带走的一条）：
//   恢复快照时会**先给当前状态拍一份"恢复前自保"**（防恢复错了回不来）⇒ 恢复完成之后
//   **最新那份是恢复前的旧状态**，而盘上装的是被恢复回来的那一份 ⇒ 拿"最新"当"当前"，
//   会把玩家指到**正好相反**的一行。⇒ 标记必须在**确知的时刻**记下来（刚拍成 / 刚恢复完）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderSnapshotsHtml } from '../src/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 一份最小快照清单（形状照 `web/idb-backend.js` 的 `list()` 产物）。 */
const snapList = (ids, currentId = null) => ({
    list: ids.map((id, i) => ({
        id, kind: i === 0 ? 'full' : 'delta', bytes: 1024,
        at: `2026-09-22T10:0${i}:00.000Z`, tick: i + 1, reason: '落账',
        current: id === currentId,
    })),
    text: '快照 3 份',
});

test('leg108 · ★快照页标出"盘上现在这份"，且只标那一份', () => {
    const html = renderSnapshotsHtml({}, { config: { snapshots: snapList(['s1', 's2', 's3'], 's2') } });
    assert.equal((html.match(/← 盘上现在这份/g) || []).length, 1, '★只许标一份（标多了等于没标）');
    // ★标的那一行必须是 s2 那一行——按行切开找，不用"整页包含"糊过去
    const rows = html.split('<div class="sw2-row"').filter((r) => r.includes('data-snap='));
    const marked = rows.filter((r) => r.includes('← 盘上现在这份'));
    assert.equal(marked.length, 1);
    assert.match(marked[0], /data-snap="s2"/, '★标错行比不标更坏——必须是"确知的那一份"');
});

test('leg108 · ★反向对照：没人打标时一处都不许出现（防"按最新那份标"混过去）', () => {
    // 为什么必须有：若实现写成"取序号最大的那份标上"，上面那条**照样绿**（s2 恰好在中间，
    //   换个夹具就露馅）。这条把它钉死：一份都没打标 ⇒ 页面上一个字都不许有。
    const html = renderSnapshotsHtml({}, { config: { snapshots: snapList(['s1', 's2', 's3'], null) } });
    assert.ok(!html.includes('盘上现在这份'), '★没人打标 ⇒ 不许自己猜一个（猜错比不标更坏）');
    assert.match(html, /data-snap="s3"/, '前置：清单本身照常画出来（否则上面那条是空绿）');
});

test('leg108 · ★接线两条：拍成一份之后打标 · 恢复之后打标（且不许把"自保那份"当当前）', () => {
    const store = read('web/snapshot-store.js');
    // ① 刚拍成一份 ⇒ 紧跟着打标（那一份就是刚写进盘的那份账）
    assert.match(store, /await snapshotStore\(freshCtx\)\.put\(p\.snapshot\);[\s\S]{0,700}?await markCurrentSnapshot\(p\.snapshot\.id\)/,
        '★拍完必须打标（否则"盘上这份"永远标不出来）');
    // ② 恢复完 ⇒ 标打在**被恢复的那一份**上
    assert.match(store, /await markCurrentSnapshot\(String\(targetId\)\)/,
        '★恢复后必须把标打在**被恢复的那一份**上（不是那份"恢复前自保"）');
    // ③ ★反向对照（咬的正是本笔实测证伪的那个偷懒办法）：打标函数**只改标记**，
    //    不许出现任何"谁最新"的推断——它的输入永远是**调用方确知的 id**。
    const at = store.indexOf('export async function markCurrentSnapshot');
    assert.ok(at > 0, '前置：打标函数必须在生产源码里');
    const body = store.slice(at, at + 1500);
    assert.ok(body.includes('String(m.id) === String(id)'), '★标记的判据只能是"id 相等"（不许按序号猜）');
    assert.ok(!/Math\.max|\.sort\(/.test(body), '★不许在打标里做"谁最新"的推断（恢复之后最新那份是旧状态）');
});

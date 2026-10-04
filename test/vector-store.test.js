// story-world-v2/test/vector-store.test.js
// ★★★leg152：**向量索引的存储与恢复**（细案 `docs/spec-memory-engine.md` §6②：索引只能是加速层）。
//
// ★这一族钉的是**会花钱的那件事**：
//   水位线（"哪些事已经嵌过了"）**必须与向量一起持久**。丢了它 ⇒ 每轮重新嵌一遍
//   ⇒ 那就不是"加速层"，是一台**每轮都在烧钱的机器**。而"它丢了会怎样"这件事**必须测得出来**。
//
// ★四条不变量：
//   ① 形状对不上（版本/模型号/维度变了）⇒ **视为没有**（不是"凑合读"——向量错模型就是垃圾）；
//   ② 恢复出来的水位线**必须只增不减**（把旧的覆盖回新的＝重嵌，那是花钱的 bug）；
//   ③ 写进去再读出来**逐位相同**（浮点数组不许被序列化悄悄改形）；
//   ④ 一个字节都没嵌过 ⇒ **不写盘**（零扰动：不动玩家的聊天文件）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    VECTOR_STORE_KIND, emptyStore, harnessOf, encodeStore, decodeStore, mergeStores, embeddedIdsOf, storeStatsOf,
} from '../src/vector-store.js';

const SIG = { model: 'qwen-x', dims: 3 };

test('S1：空索引的形状（一个字节都没嵌过 ⇒ 空着就是空着）', () => {
    const s = emptyStore();
    assert.equal(s.kind, VECTOR_STORE_KIND);
    assert.deepEqual(s.ids, []);
    assert.deepEqual(s.tickByIndex, []);
    assert.deepEqual(s.vecs, []);
    assert.deepEqual(embeddedIdsOf(s), []);
    assert.deepEqual(storeStatsOf(s), { count: 0, dims: null, model: '' });
    // ★签名里的模型号/维度要落进形状（恢复时靠它判"是不是同一片索引"）
    const sig = emptyStore({ model: 'qwen-x', dims: 3 });
    assert.equal(sig.model, 'qwen-x');
    assert.equal(sig.dims, 3);
});

test('S2：写进去再读出来**逐位相同**（浮点不许被序列化改形）', () => {
    const h = harnessOf(SIG);
    h.putMany([
        { id: 'ev_10_1', tick: 10, text: '甲' },
        { id: 'ev_40_2', tick: 40, text: '乙' },
    ], [[0.1, -0.2, 0.3], [1, 0, -1]]);
    const s = h.store();
    assert.deepEqual(embeddedIdsOf(s), ['ev_10_1', 'ev_40_2']);
    const round = decodeStore(encodeStore(s), SIG);
    assert.deepEqual(round.vecs, s.vecs, '★序列化往返必须逐位相同');
    assert.deepEqual(round.ids, s.ids);
    assert.deepEqual(round.tickByIndex, s.tickByIndex);
});

test('S3：恢复时形状对不上 ⇒ 视为**没有**（换模型号/换维度/换版本都算）', () => {
    const h = harnessOf(SIG);
    h.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }], [[1, 0, 0]]);
    const good = encodeStore(h.store());
    assert.equal(decodeStore(good, SIG).ids.length, 1, '原样读得回来');
    assert.deepEqual(decodeStore(good, { model: '别的模型', dims: 3 }).ids, [], '★换了模型号 ⇒ 老向量一律不认');
    assert.deepEqual(decodeStore(good, { model: 'qwen-x', dims: 4 }).ids, [], '★换了维度 ⇒ 不认');
    assert.deepEqual(decodeStore({ ...good, v: 99 }, SIG).ids, [], '★换了版本 ⇒ 不认');
    assert.deepEqual(decodeStore({ ...good, kind: '别的' }, SIG).ids, [], '★kind 不对 ⇒ 不认');
    assert.deepEqual(decodeStore(null, SIG).ids, [], '没有 ⇒ 空（不抛）');
});

test('S4：★水位线只增不减——"合并"两个索引时不许把已嵌过的弄丢（丢了＝重嵌＝花钱）', () => {
    const a = harnessOf(SIG);
    a.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }, { id: 'ev_2_1', tick: 2, text: '乙' }], [[1, 0, 0], [0, 1, 0]]);
    const b = harnessOf(SIG);
    b.putMany([{ id: 'ev_2_1', tick: 2, text: '乙（重复）' }, { id: 'ev_3_1', tick: 3, text: '丙' }], [[9, 9, 9], [0, 0, 1]]);
    const m = mergeStores(a.store(), b.store());
    assert.deepEqual(embeddedIdsOf(m), ['ev_1_1', 'ev_2_1', 'ev_3_1'], '并集，不丢');
    // 同一个 id 两边都有 ⇒ 以**先来的那份**为准（不许被后写的覆盖成另一条向量）
    assert.deepEqual(m.vecs[m.ids.indexOf('ev_2_1')], [0, 1, 0]);
    // ★这条就是防"重嵌"的：合并之后，已嵌集合必须是两边的并集
    const before = new Set([...embeddedIdsOf(a.store()), ...embeddedIdsOf(b.store())]);
    assert.deepEqual([...embeddedIdsOf(m)].sort(), [...before].sort(), '★合并后已嵌集合 ⊇ 两边之和');
});

test('S5：一个字节都没嵌过 ⇒ **不写盘**（零扰动）', () => {
    const h = harnessOf(SIG);
    assert.equal(h.persist(), false, '空索引不必落盘');
    h.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }], [[1, 0, 0]]);
    assert.equal(h.persist(), true, '真有东西 ⇒ 落盘');
    // 幂等：同一份内容再存一次不必重写
    assert.equal(h.persist(), false, '★内容没变 ⇒ 不重复写（写盘是整份重写，能省就省）');
});

test('S6：条数对不上就**整批不写**（错位比缺一条更坏）', () => {
    const h = harnessOf(SIG);
    const wrote = h.putMany([{ id: 'ev_1_1', tick: 1, text: '甲' }, { id: 'ev_2_1', tick: 2, text: '乙' }], [[1, 0, 0]]);
    assert.equal(wrote, 0, '向量少一条 ⇒ 一条都不写');
    assert.deepEqual(embeddedIdsOf(h.store()), []);
});

test('S7：没有轮次的事**不进索引**（它进不了时间轴，也不该占水位线）', () => {
    const h = harnessOf(SIG);
    const n = h.putMany([{ id: 'ev_x', tick: null, text: '不知道第几轮' }], [[1, 0, 0]]);
    assert.equal(n, 0);
    assert.deepEqual(embeddedIdsOf(h.store()), []);
});

// story-world-v2/test/fingerprint.test.js
// K26/设定大势层：书指纹缓存（细案 §3.2③ → A-3）——FNV-1a（v1 算法原样搬）+ LRU 有界 + 版本戳 + 深拷贝。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookFingerprint, createCache } from '../src/fingerprint.js';

test('K26/A-3：FNV-1a 标准向量锁（v1 算法逐位同源）', () => {
    // 官方 FNV-1a 32 位测试向量：""→0x811c9dc5、"a"→0xe40c292c、"foobar"→0xbf9cf968
    assert.equal(bookFingerprint(''), `fnv1a_${0x811c9dc5.toString(36)}_0`);
    assert.equal(bookFingerprint('a'), `fnv1a_${0xe40c292c.toString(36)}_1`);
    assert.equal(bookFingerprint('foobar'), `fnv1a_${0xbf9cf968.toString(36)}_6`);
});

test('K26/A-3：同文本指纹确定，书内容一变指纹即变（自动失效重抽的依据）', () => {
    const t = '灵脉有主，大荒无王。';
    assert.equal(bookFingerprint(t), bookFingerprint(t));
    assert.notEqual(bookFingerprint(t), bookFingerprint(t + '。'));
    assert.notEqual(bookFingerprint(t), bookFingerprint(t.slice(0, -1)));
});

test('K26/A-3：同指纹命中——只存一份、两次读取返回等值（深拷贝，缓存本体不被下游改动）', () => {
    const cache = createCache();
    const canon = { powerScale: [{ level: '筑基', note: 'x' }], rules: ['灵脉有主'], society: 's', techOrMagic: 'm', historyNotes: [] };
    cache.set(bookFingerprint('书'), canon, '2026-09-07T00:00:00Z');
    const a = cache.get(bookFingerprint('书'));
    const b = cache.get(bookFingerprint('书'));
    assert.deepEqual(a.canon, canon);
    assert.deepEqual(a, b);
    // 改命中返回物 → 缓存本体不变（深拷贝保护）
    a.canon.rules.push('被污染');
    assert.deepEqual(cache.get(bookFingerprint('书')).canon, canon);
    assert.equal(cache.size(), 1);
});

test('K26/A-3：指纹变 → 缓存不命中；旧指纹条目仍可读（多书共存）', () => {
    const cache = createCache();
    const canon = { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] };
    cache.set(bookFingerprint('书一'), canon, 't1');
    cache.set(bookFingerprint('书二'), canon, 't2');
    assert.equal(cache.get(bookFingerprint('书一')).fingerprint, bookFingerprint('书一'));
    assert.equal(cache.get(bookFingerprint('书二')).fingerprint, bookFingerprint('书二'));
    assert.equal(cache.get(bookFingerprint('书三')), null);
});

test('K26/A-3：LRU 有界——超上限按 extractedAt 淘汰最旧', () => {
    const cache = createCache();
    const canon = { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] };
    for (let i = 1; i <= 6; i += 1) cache.set(bookFingerprint(`书${i}`), canon, `2026-09-07T00:0${i}:00Z`);
    assert.equal(cache.size(), 5);
    assert.equal(cache.get(bookFingerprint('书1')), null, '最旧的应被淘汰');
    assert.ok(cache.keys().includes(bookFingerprint('书6')));
});

test('K26/A-3：版本戳不匹配视为未命中（形状演进自动失效）', () => {
    const fp = bookFingerprint('书');
    const stale = createCache({ [fp]: { cacheVersion: 0, fingerprint: fp, extractedAt: 't', canon: {} } });
    assert.equal(stale.get(fp), null, '异版本条目应视为未命中');
    stale.set(fp, { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] }, 't2');
    assert.ok(stale.get(fp), 'set 覆盖后恢复正常形态');
});
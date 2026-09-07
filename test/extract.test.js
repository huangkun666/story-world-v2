// story-world-v2/test/extract.test.js
// 落子提取实测：活档黄金样本 17 则（15 动作回合 + 2 OOC 指令回合）。
// 闸门：样本黄金测试通过才进 S4（切片 §3.1）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractMove } from '../src/extract.js';

const FIX = JSON.parse(readFileSync(new URL('./fixtures/extract-samples.json', import.meta.url), 'utf8'));
const CTX = FIX.context;

for (const s of FIX.samples) {
    test(`提取样本 ${s.id}：${s.dialogue.slice(0, 20)}…`, () => {
        const got = extractMove(s.dialogue, CTX);
        assert.equal(got.verb, s.expected.verb, `verb 应为 ${s.expected.verb}`);
        assert.equal(got.object, s.expected.object, `object 应为 ${s.expected.object}`);
        assert.equal(got.location, s.expected.location, `location 应为 ${s.expected.location}`);
        assert.equal(got.attempt, s.expected.attempt, 'attempt 语义');
    });
}

test('提取样本 ooc：OOC 内容被滤除并记为 dropped', () => {
    const s = FIX.samples.find((x) => x.id === 'ooc1');
    const got = extractMove(s.dialogue, CTX);
    assert.ok(got.dropped.length >= 1, 'dropped 非空');
    assert.ok(got.note.includes('继续'));
});

test('对象解析：玩家自称不作对象（黄坤 排除在外）', () => {
    const got = extractMove('我黄坤不是乘人之危的人', CTX);
    assert.equal(got.object, null);
    assert.equal(got.verb, null); // 无动作词 → 诚实未提取
});

test('位置规则：名单命中返回位置（对话侧示例）', () => {
    const got = extractMove('我们沿商路北上', CTX);
    assert.equal(got.location, '商路');
});
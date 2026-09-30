// story-world-v2/test/cancel.test.js
// K22 验收（因果链细案 §3.5 → A-5；C3 拍板落地）：取消通道——模型提议放弃（带理由）→ 引擎无条件裁决：
// closed + memory.blocked 记"放弃" + 编年措辞精确 + 在飞子断链转独立（不悬挂已死之父）+ plot 源事件联闭；
// 取消先于推进（同 tick 被取消者推进被拦截）；静默滤除已由 K18 契约面覆盖（worldstep.test）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const TREE = JSON.parse(readFileSync(new URL('./fixtures/tree-world.json', import.meta.url), 'utf8'));
import { readFileSync } from 'node:fs';

// leg25 c：`stateChanges`（模型提议的属性增量）随四维浮点从世界步契约整条删除——夹具步不再拼它
//   （拼了即"未知字段"整步被拒，世界如实不动，本文件全部用例会当场变红）。
const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
const adv = (id) => ({ agendaId: id, step: '推进', stage: '中' });

test('K22/A-5 取消裁决：closed + blocked 记"放弃" + 编年措辞精确；plot 源事件联闭；同 tick 推进被拦截', () => {
    const r = settleTick({ ssot: TREE, step: step({
        newEvents: [{ title: '粮道火光', source: { type: 'plot', ref: 'a_son1' }, position: '粮道', ripples: ['e_court'] }],
        agendaAdvances: [adv('a_son1')],                     // 同 tick 提议推进被取消者 → 拦截（取消先于推进）
        agendaCancels: [{ agendaId: 'a_son1', reason: '粮道已绝，强运无益' }],
    }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const son = w.agendas.find((a) => a.id === 'a_son1');
    assert.equal(son.closed, true, '取消即终结');
    assert.ok(son.memory.blocked.some((b) => b.includes('放弃') && b.includes('粮道已绝')), 'blocked 记"放弃"（回查留痕）');
    assert.equal(son.progress, 1, '推进被拦截（同 tick 先取消后推进——world 不重唱）');
    assert.ok(w.chronicle.some((c) => c.text.includes('盘算「粮草调度」取消') && c.text.includes('粮道已绝')), '取消编年措辞精确');
    assert.ok(r.stage.warnings.some((x) => x.includes('盘算推进被拒')), '被取消者推进拦截警告');
    const ev = w.events.find((e) => e.title === '粮道火光');
    assert.ok(ev.closed && ev.closedAt === 1, 'plot 源事件联闭（取消 = 终结产果路径）');
    assert.ok(!w.chronicle.some((c) => c.text.includes('达成') || c.text.includes('败露')), '取消是独立结局（非达成/败露）');
});

test('K22/A-5 托孤：有在飞子的父被取消 → 诸子断链转独立（不悬挂已死之父）', () => {
    const r = settleTick({ ssot: TREE, step: step({ agendaCancels: [{ agendaId: 'a_root', reason: '大业暂缓' }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const root = w.agendas.find((a) => a.id === 'a_root');
    assert.equal(root.closed, true);
    const sons = w.agendas.filter((a) => a.id === 'a_son1' || a.id === 'a_son2');
    for (const s of sons) assert.equal(s.parentId, undefined, `${s.id} 断父链转独立`);
    assert.ok(w.chronicle.some((c) => c.text.includes('取消后遗留子盘算 2 项转独立')), '托孤编年');
    // 子盘算不因父取消而终结（独立续跑）
    const r2 = settleTick({ ssot: w, step: step({ agendaAdvances: [adv('a_son1')] }) });
    assert.equal(r2.ok, true);
    assert.equal(r2.ssot.agendas.find((a) => a.id === 'a_son1').closed, undefined, '子照常推进（未满步未终结）');
});

test('K22：取消不兑现；取消后世界过 SSOT schema；确定性', () => {
    // 取消 a_son1（a_root 之子）→ 无"兑现"编年（兑现仅达成态）
    const r = settleTick({ ssot: TREE, step: step({ agendaCancels: [{ agendaId: 'a_son1', reason: '中道弃' }] }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    assert.ok(!w.chronicle.some((c) => c.text.includes('兑现')), '取消不兑现（达成才兑现）');
    const vr = validate(w, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
    // 确定性
    const a = settleTick({ ssot: TREE, step: step({ agendaCancels: [{ agendaId: 'a_son1', reason: 'x' }] }) });
    const b = settleTick({ ssot: TREE, step: step({ agendaCancels: [{ agendaId: 'a_son1', reason: 'x' }] }) });
    assert.equal(JSON.stringify(a.ssot), JSON.stringify(b.ssot));
});
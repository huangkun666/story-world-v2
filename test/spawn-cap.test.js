// story-world-v2/test/spawn-cap.test.js
// K45（full-roster-lens-spec C3/C7）：newEntities 无池顶 + parent 从属校验（防御弃关系，提示词约束为主）+
// 无超席强制后的闲置退休仍工作。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { seedBookEntities } from '../src/abstract.js';

function zeroStep(extra = {}) {
    // leg25 c：`stateChanges` 已随四维浮点从世界步契约删除——夹具步不再拼它。
    return {
        actions: [], newEvents: [], agendaAdvances: [],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
        ...extra,
    };
}

function baseWorld(extra = {}) {
    return {
        version: 1,
        context: { world: '测试界', tension: 0.5, positions: ['临渊城', '大营'] },
        entities: [
            { id: 'e_bk_1', kind: 'faction', name: '万法阁', location: '临渊城' },
            { id: 'e_bk_2', kind: 'character', name: '清玄真人', location: '临渊城' },
        ],
        weights: { e_bk_1: 0.9, e_bk_2: 0.6 },
        agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 0, simLog: [] },
        ...extra,
    };
}

const born = (w) => w.entities.filter((e) => e.id.startsWith('e_1_') || e.id.startsWith('e_2_'));

test('K45: newEntities 带 parent=在册势力 → 实体.parent 落地', () => {
    const w = baseWorld();
    w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    const r = settleTick({
        ssot: w,
        step: zeroStep({ newEntities: [{ name: '新弟子', kind: 'character', location: '大营', entity: 'e_bk_1', parent: '万法阁', source: { type: 'event', ref: 'ev_a' } }] }),
    });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const ent = r.ssot.entities.find((e) => e.name === '新弟子');
    assert.ok(ent, '入账');
    assert.equal(ent.parent, '万法阁');
    assert.ok(!r.stage.warnings.some((x) => x.includes('从属')));
});

test('K45: parent 防御——不在册/非势力/已灭 一律弃关系+警告，入局照常', () => {
    const cases = [
        { parent: '不存在的门派', note: '不在册' },
        { parent: '清玄真人', note: '目标是角色非势力' },
        { parent: '万法阁', note: '已灭', deadSetup: true },
    ];
    for (const c of cases) {
        const w = baseWorld(c.deadSetup ? { entities: [{ ...baseWorld().entities[0], status: 'dead' }, ...baseWorld().entities.slice(1)] } : {});
        w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
        const r = settleTick({
            ssot: w,
            step: zeroStep({ newEntities: [{ name: `新人${c.note}`, kind: 'character', location: '大营', entity: 'e_bk_1', parent: c.parent, source: { type: 'event', ref: 'ev_a' } }] }),
        });
        assert.equal(r.ok, true, `${c.note}: ${r.stage.warnings.join('; ')}`);
        const ent = r.ssot.entities.find((e) => e.name === `新人${c.note}`);
        assert.ok(ent, `${c.note}: 入局照常`);
        assert.equal(ent.parent, undefined, `${c.note}: 弃关系`);
        assert.ok(r.stage.warnings.some((x) => x.includes('弃关系')), `${c.note}: 有警告`);
    }
});

test('K45: 无池顶——批次 300 实体全量 seed 后仍可自由入局（seed 全量 + settle 无拒）', () => {
    const book = [];
    for (let i = 0; i < 300; i += 1) book.push({ name: `名号${i}`, kind: i % 3 === 0 ? 'faction' : 'character' });
    const w = baseWorld();
    w.context.setting = { frozen: { canon: { bookEntities: book } }, dynamic: { tension: { polarity: '正邪', direction: '', intensity: 0.5 }, env: {} } };
    const rSeed = seedBookEntities(w);
    assert.equal(rSeed.seeded, 300);                       // 300 全量（2 基础名已在册不计）
    assert.equal(w.entities.length, 302);
    assert.equal(new Set(w.entities.map((e) => e.id)).size, 302, 'id 全部唯一（K45 防冲突）');
    assert.equal(Object.keys(w.weights).length, 302, '分量缓存全覆盖（值来自中立 floor——账面不预填数值）');
    // 既有夹具里的 e_bk_* 是手摆的旧形态；新 seed 出来的名号 id 顺延（e_bk_3 起）——只查新增的那些
    for (const e of w.entities.filter((x) => x.id.startsWith('e_bk_') && Number(x.id.slice(5)) > 2)) {
        // leg25 c：名册入账**根本不落 attrs**（键都不存在，不是空对象）——四维浮点已整条删除。
        assert.equal(e.attrs, undefined, `leg25 c：名册入账不落数值属性（${e.name}）`);
    }
    w.events = [{ id: 'ev_a', title: '甲事', source: { type: 'state' }, position: '大营', ripples: [], closed: false }];
    w.entities.find((e) => e.id === 'e_bk_2').lastActiveTick = 0;   // leg24 片3：提议方须"刚出过手"才不算结构静默
    const r = settleTick({
        ssot: w,
        step: zeroStep({ newEntities: [{ name: '第303个', kind: 'character', location: '大营', entity: 'e_bk_2', source: { type: 'event', ref: 'ev_a' } }] }),
    });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(r.ssot.entities.some((e) => e.name === '第303个'), '303 号照常入局');
});
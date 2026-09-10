// story-world-v2/test/player-wiring.test.js
// leg25 检察官审计处置（B 组）：**玩家棋子接线**回归锁。
// 审计发现：`context.playerId` 生产路径从不产生（只有 test/ 与 demo/ 赋过值）→
//   ①check-step 五条"模型禁写玩家"守卫恒假；②streams 走无玩家分支（掩码永不生效）；
//   ③settle 影响通道整体失效；④extractCtx 为空 → dialogueFact 入局永不合法。
// 本文件锁：建世界必须真的给世界一枚玩家棋子，且开档描述只在第一次用来解析。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { checkWorldStep } from '../src/check-step.js';
import { renderStreams } from '../src/streams.js';
import { attachPlayerPiece, namePlayerPiece } from '../web/index.js';

const world = (over = {}) => ({
    version: 1,
    context: { world: '大荒', tension: 0.5, positions: ['未明'] },
    entities: [],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    meta: { tick: 0, simLog: [] },
    ...over,
});

test('B-1 建世界必建玩家棋子：playerId 落账 + 实体入册 + schema 通过', () => {
    const w = world();
    const r = attachPlayerPiece(w);
    assert.equal(r.created, true);
    assert.equal(w.context.playerId, r.playerId, 'context.playerId 必须指向棋子');
    const p = w.entities.find((e) => e.id === r.playerId);
    assert.ok(p, '棋子实体在册');
    assert.equal(p.kind, 'character');
    assert.deepEqual(p.attrs, {}, '开局四维空着（空着就是空着）');
    assert.equal(p.location, '未明', '位置取位置集首项');
    assert.equal(typeof p.lastActiveTick, 'number', '头几轮不静默（与 spawnEntities 同口径）');
    const v = validate(w, ssotSchema);
    assert.equal(v.ok, true, v.errors.join('; '));
});

test('B-2 给定姓名且名册已有同名者：复用那条账，不新建（不劈成两个实体）', () => {
    const w = world({ entities: [{ id: 'e_bk_7', kind: 'faction', name: '大虞', location: '未明', attrs: {} }, { id: 'e_bk_9', kind: 'character', name: '黄坤', location: '未明', attrs: {} }] });
    const r = attachPlayerPiece(w, '黄坤');
    assert.equal(r.reused, true);
    assert.equal(w.context.playerId, 'e_bk_9');
    assert.equal(w.entities.length, 2, '没有多出一条');
});

test('B-3 id 防冲突：已有 e_p1/e_p2 → 新建 e_p3（重开世界不撞 id）', () => {
    const w = world({ entities: [{ id: 'e_p1', kind: 'character', name: '旧你', location: '未明', attrs: {} }, { id: 'e_p2', kind: 'character', name: '旧你2', location: '未明', attrs: {} }] });
    const r = attachPlayerPiece(w);
    assert.equal(r.playerId, 'e_p3');
});

test('B-4 改名：id 不变（盘算/事件引用不断）；同名他人则把棋子并过去、空棋子不留', () => {
    const w = world();
    const r = attachPlayerPiece(w);
    namePlayerPiece(w, '黄坤');
    const p = w.entities.find((e) => e.id === r.playerId);
    assert.equal(p.name, '黄坤', '改名生效');
    assert.equal(w.context.playerId, r.playerId, 'id 不变');

    const w2 = world({ entities: [{ id: 'e_bk_3', kind: 'character', name: '黄坤', location: '未明', attrs: {} }] });
    const r2 = attachPlayerPiece(w2);              // 先建占位棋子 e_p1
    namePlayerPiece(w2, '黄坤');                    // 书里已有黄坤 → 合并
    assert.equal(w2.context.playerId, 'e_bk_3', '棋子指到书里那条账');
    assert.equal(w2.entities.some((e) => e.id === r2.playerId), false, '空占位棋子被清掉，不留重复名');
    assert.equal(w2.entities.filter((e) => e.name === '黄坤').length, 1, '同名只有一个');
});

test('B-5 改名空值/无玩家：原样返回（防御，不改一字）', () => {
    const w = world();
    attachPlayerPiece(w);
    const before = JSON.stringify(w);
    assert.deepEqual(namePlayerPiece(w, '   '), { renamed: false });
    assert.equal(JSON.stringify(w), before, '空名不动世界');
    const w2 = world();
    assert.deepEqual(namePlayerPiece(w2, '黄坤'), { renamed: false }, '无 playerId 不动');
});

test('B-6 接线后的真实效果：五条"禁写玩家"守卫不再恒假 + 注入侧不再走"无玩家"分支', () => {
    const w = world({ entities: [{ id: 'e_x', kind: 'faction', name: '万法阁', location: '未明', attrs: {} }] });
    const r = attachPlayerPiece(w);
    const step = (over) => ({
        actions: [], newEvents: [], agendaAdvances: [], stateChanges: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [], ...over,
    });
    // ① 模型写玩家的行动 → 拒（旧法因 playerId 缺失而放行）
    const a = checkWorldStep(step({ actions: [{ entity: r.playerId, verb: '出手' }] }), w);
    assert.equal(a.ok, false);
    assert.ok(a.errors.some((e) => e.includes('模型禁写玩家')), a.errors.join('; '));
    // ② 模型改玩家的属性 → 拒
    const b = checkWorldStep(step({ stateChanges: [{ entity: r.playerId, attr: 'intel', delta: 0.1 }] }), w);
    assert.equal(b.ok, false);
    assert.ok(b.errors.some((e) => e.includes('模型禁写玩家')), b.errors.join('; '));
    // ③ 覆灭玩家 → 拒
    const c = checkWorldStep(step({ entityFates: [{ entity: r.playerId, verdict: 'dead', source: { type: 'event', ref: 'ev_1' } }] }), w);
    assert.equal(c.ok, false);
    assert.ok(c.errors.some((e) => e.includes('玩家不可灭') || e.includes('模型禁写玩家')), c.errors.join('; '));
    // ④ 注入侧走"有玩家"分支：掩码口径生效（不再整段降级全见）
    const stage = { chronicle: [{ id: 'ch_1', tick: 1, text: '某地生变', eventRef: 'ev_1' }], warnings: [] };
    const w3 = { ...w, events: [{ id: 'ev_1', title: '某地生变', source: { type: 'state' }, position: '未明', ripples: [], closed: false }] };
    const streams = renderStreams(w3, stage, null);
    assert.equal(typeof streams.injection, 'string');
    assert.ok(streams.injection.includes('某地生变'), '有玩家世界：事件按掩码判定后仍可见（此前是"无玩家→全见"的降级分支）');
});

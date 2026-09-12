// story-world-v2/test/position-normalize.test.js
// leg33：「（推）」位置注解不得拒整步 —— 引擎自己打在实体表 location 列上的标记，被模型抄回来时会被误判。
//
// 病根（真机实测，同一输入间歇复现）：leg31 把"这个位置是引擎按结构推断的"标进 `pack.js` 的实体行
//   （`北俱荒洲（推）`，字段 `locationNote`），表读法在 `ENTITY_TABLE_LEGEND` 里也讲了这个标记；
//   但**没有任何地方把模型抄回来的那串剥掉** ⇒ 模型写 `newEvents[].position: " 北俱荒洲（推）"` ⇒
//   位置闸认不出 ⇒ **拒整步**（实测原文：`$.newEvents[2].position: " 北俱荒洲（推）" 不在世界位置集`）。
//
// 判据三层（缺一不可）：
//   ① 注解剥掉（newEvents / actions / newEntities 三处都算），该步**照常落账**、坐标写**干净地名**；
//   ② ★**判据强度不许被削弱**：剥掉之后仍不在集内的，照旧**拒整步**（真·编了个地名）；
//   ③ 与 `pack.js` 的 `locationNote` **同源**：给一个"引擎真会打标"的位置（结构推导来源）做端到端，
//      不靠手写字面量自证 —— 改注解形状时这条必须先红。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick, normalizePosition } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { buildEvolutionPack } from '../src/pack.js';

function baseWorld() {
    return {
        version: 1,
        // ★位置集里是**干净**地名（引擎的位置集从不带注解）
        context: { world: '临渊城', tension: 0.5, positions: ['临渊城', '大营', '北俱荒洲'] },
        entities: [
            { id: 'e_merchant', kind: 'character', name: '商贾', location: '临渊城' },
            { id: 'e_du', kind: 'faction', name: '大虞', location: '临渊城' },
            // ★这一条的位置来源标成"结构推导" ⇒ 出包时引擎会给它打「（推）」（见 pack.js entityRow）
            { id: 'e_far', kind: 'character', name: '远客', location: '北俱荒洲' },
        ],
        weights: { e_merchant: 0.4, e_du: 0.8, e_far: 0.5 },
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 0, entityFields: { e_far: { 位置来源: '结构推导', 位置来源自: '大虞' } } },
    };
}
const step = (more = {}) => ({
    actions: [], newEvents: [], agendaAdvances: [],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...more,
});

test('leg33·§③ 同源自证：引擎真会给"结构推导"的位置打「（推）」——判据不许靠手写字面量', () => {
    const w = baseWorld();
    const { pack } = buildEvolutionPack(w, null);
    const row = (pack.entities || []).find((e) => e.id === 'e_far');
    assert.ok(row, '夹具实体必须进得了包');
    assert.equal(row.location, '北俱荒洲', '位置本体是干净地名');
    assert.equal(row.locationNote, '（推）', `★引擎真会打这个标（pack.js entityRow）；本测试的整个前提就是它——实际 ${row.locationNote}`);
});

test('leg33·① 模型把「（推）」抄进 newEvents[].position ⇒ 剥掉注解、**照常落账**（不许拒整步）', () => {
    const w = baseWorld();
    const s = step({
        newEvents: [{ title: '北山异动', source: { type: 'state' }, position: '北俱荒洲（推）', ripples: ['e_far'] }],
    });
    const r0 = checkWorldStep(s, w);
    assert.equal(r0.ok, true, `注解不是编地名，不许拒整步：${r0.errors.join('; ')}`);
    // ★就地归一：下游 settle 读到的是剥过的值
    assert.equal(s.newEvents[0].position, '北俱荒洲', '校验期就地归一（下游落账读到干净地名）');
    const r = settleTick({ ssot: w, step: s });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const ev = r.ssot.events.find((e) => e.title === '北山异动');
    assert.ok(ev, '事件照常落账');
    assert.equal(ev.position, '北俱荒洲', `账上写干净地名，实际「${ev.position}」`);
});

test('leg33·① actions[].position 与 newEntities[].location 同一趟归一（三处一起管）', () => {
    const w = baseWorld();
    w.entities.find((e) => e.id === 'e_far').lastActiveTick = 0;
    const s = step({
        actions: [{ entity: 'e_far', verb: '远眺', position: '北俱荒洲（推）' }],
        newEntities: [{ name: '随从', kind: 'character', location: '北俱荒洲（推）', entity: 'e_far', source: { type: 'entity', ref: 'e_du' } }],
    });
    const r0 = checkWorldStep(s, w);
    assert.equal(r0.ok, true, `actions/newEntities 带注解都不该拒整步：${r0.errors.join('; ')}`);
    assert.equal(s.actions[0].position, '北俱荒洲', 'actions 就地归一');
    const r = settleTick({ ssot: w, step: s });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const c = r.ssot.entities.find((e) => e.name === '随从');
    assert.ok(c, '人照常入局');
    assert.equal(c.location, '北俱荒洲', `入局坐标写干净地名（不是「未明」、更不是带注解的），实际「${c.location}」`);
});

test('leg33·② 判据强度不变：剥掉注解后**仍在集外**的，照旧拒整步（真·编了个地名）', () => {
    const w = baseWorld();
    // ① 纯编的假地名 —— 照旧拒
    const r1 = checkWorldStep(step({
        newEvents: [{ title: '奇事', source: { type: 'state' }, position: '不存在的地方', ripples: ['e_far'] }],
    }), w);
    assert.ok(!r1.ok && r1.errors.some((e) => e.includes('不在世界位置集')), '编地名必须仍被拒（本改动只剥引擎注解，不放松判据）');
    // ② ★最阴的一路：拿注解去"伪装"一个集外地名 —— 剥完还是集外 ⇒ 仍拒
    const r2 = checkWorldStep(step({
        newEvents: [{ title: '奇事', source: { type: 'state' }, position: '不存在的地方（推）', ripples: ['e_far'] }],
    }), w);
    assert.ok(!r2.ok && r2.errors.some((e) => e.includes('不在世界位置集')), '★注解不许成为"编地名"的免死牌');
});

test('leg33·normalizePosition 本体：只剥尾部注解、只 trim，不做任何替换或猜测', () => {
    assert.equal(normalizePosition('北俱荒洲（推）'), '北俱荒洲');
    assert.equal(normalizePosition('  北俱荒洲（推）  '), '北俱荒洲', '顺带吃掉前后空白');
    assert.equal(normalizePosition('北俱荒洲'), '北俱荒洲', '没注解的原样');
    assert.equal(normalizePosition('（推）'), '', '整个值就是注解 ⇒ 剥完为空 ⇒ 下游按"不在集内"处理');
    // ★只剥**尾部**：位置名里真含这三个字的假想情况不许被动（宁可漏剥，不可乱剥）
    assert.equal(normalizePosition('（推）城'), '（推）城');
    assert.equal(normalizePosition(undefined), undefined);
    assert.equal(normalizePosition(null), null);
    assert.equal(normalizePosition(42), 42, '非字符串原样返回（让下游照常判"不在集内"）');
});

// story-world-v2/test/shade.test.js
// K21 验收（因果链细案 §3.4 → A-4；拍板 C2/ANCHOR §6 原文）：暗处渲染——concealed 盘算的
// 推进/委派创建/兑现 三类编年不留痕（数据照写：memory/父链属账）；事件条目、终结三态、拆环、源结清联闭
// 上桌不变；观棋数据窗口（格局行）全局可见不变；注入掩码语义不减（K10 不冲突）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTick } from '../src/settle.js';
import { renderStreams } from '../src/streams.js';

// 双实体世界：e_x 开 known 盘算 + concealed 盘算各一；e_y 收委派（concealed 子样本）
// leg24 片3：静默判据=结构三条件——e_y 要能主动提议（收委派/自开暗线），得让它"刚出过手"
//   （lastActiveTick）；否则它无在办盘算 + 久未出手 → 结构静默 → 提议被门控滤掉（那不是本文件的考点）。
const W = () => ({
    version: 1,
    context: { world: '边地', tension: 0.5, positions: ['边城', '大营'] },
    entities: [
        { id: 'e_x', kind: 'faction', name: '边军', location: '边城', lastActiveTick: 0 },
        { id: 'e_y', kind: 'character', name: '细作', location: '大营', lastActiveTick: 0 },
    ],
    weights: { e_x: 0.9, e_y: 0.5 },
    agendas: [
        { id: 'a_k', owner: 'e_x', goal: '明修栈道', stage: '谋划', visibility: 'known', maxSteps: 4, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
        { id: 'a_c', owner: 'e_x', goal: '暗渡陈仓', stage: '潜伏', visibility: 'concealed', maxSteps: 2, progress: 0, memory: { promises: [], done: [], blocked: [], turnsAlive: 0 } },
    ],
    events: [],
    chronicle: [],
    meta: { tick: 0 },
});

// leg25 c：`stateChanges` 已随四维浮点从世界步契约删除；实体 `attrs` 同（四维不存在了）。
const empty = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });
const step = (extra) => ({ ...empty(), ...extra });
const adv = (id, s) => ({ agendaId: id, step: s, stage: '中' });
const na = (entity, goal, source) => ({ entity, goal, visibility: 'concealed', source });

test('K21/A-4：concealed 推进不留痕（known 照常）；memory.done 数据照写', () => {
    const r = settleTick({ ssot: W(), step: step({
        agendaAdvances: [adv('a_k', '开工'), adv('a_c', '深夜出营')],
    }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const advs = w.chronicle.filter((c) => c.text.includes('推进'));
    assert.equal(advs.length, 1, '仅 known 推进入动态流');
    assert.ok(advs[0].text.includes('明修栈道') && !advs[0].text.includes('暗渡陈仓'), '措辞保真');
    assert.ok(w.agendas.find((a) => a.id === 'a_c').memory.done.some((d) => d.includes('深夜出营')), 'concealed memory.done 照写（数据属账）');
    assert.ok(w.agendas.find((a) => a.id === 'a_k').memory.done.some((d) => d.includes('开工')), 'known 照写');
});

test('K21/A-4：concealed 委派不留痕（父 promises 照写）；concealed 终结上桌（露出水面照常）', () => {
    const r = settleTick({ ssot: W(), step: step({
        agendaAdvances: [adv('a_c', '准备就绪')],
        newAgendas: [na('e_y', '潜入北关', { type: 'parent', ref: 'a_c' })],
    }) });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const child = w.agendas.find((a) => a.goal === '潜入北关');
    assert.ok(child, '子落账');
    assert.ok(w.agendas.find((a) => a.id === 'a_c').memory.promises.includes(child.id), '父 promises 照写');
    assert.ok(!w.chronicle.some((c) => c.text.includes('委派')), 'concealed 委派编年抑制');
    assert.ok(!w.chronicle.some((c) => c.text.includes('潜入北关')), '子目标不上桌');
    // 再推 a_c 一步 → 满步（2/2）→ 终结上桌（concealed 也露脸于结局）
    const r2 = settleTick({ ssot: w, step: step({ agendaAdvances: [adv('a_c', '最后一着')] }) });
    assert.equal(r2.ok, true);
    assert.ok(r2.ssot.chronicle.some((c) => c.text.includes('暗渡陈仓') && c.text.includes('满步结算')), 'concealed 终结上桌（终结即露出水面）');
});

test('K21/A-4：concealed 子达成不兑现落痕（父 done 照写）；事件上桌不变', () => {
    // 连续两 tick 推 a_k（known）到满步 → 兑现正常；再造 concealed 子达成 → 兑现编年抑制
    const w0 = W();
    let r = settleTick({ ssot: w0, step: step({ newAgendas: [na('e_y', '暗线兑付', { type: 'parent', ref: 'a_k' })] }) });
    const w1 = r.ssot;
    const son = w1.agendas.find((a) => a.goal === '暗线兑付');   // progress 0 maxSteps 缺省 4 → 需 4 步
    assert.ok(son && son.visibility === 'concealed');
    r = settleTick({ ssot: w1, step: step({ agendaAdvances: [adv('a_k', '掩护'), adv(son.id, '第 1 步')] }) });
    r = settleTick({ ssot: r.ssot, step: step({ agendaAdvances: [adv(son.id, '第 2 步')] }) });
    r = settleTick({ ssot: r.ssot, step: step({ agendaAdvances: [adv(son.id, '第 3 步')] }) });
    r = settleTick({ ssot: r.ssot, step: step({
        agendaAdvances: [adv(son.id, '第 4 步')],
        newEvents: [{ title: '北关灯火如常', source: { type: 'plot', ref: son.id }, position: '大营', ripples: ['e_y'] }],
    }) });
    const w5 = r.ssot;
    assert.ok(w5.agendas.find((a) => a.id === son.id).closed, 'concealed 子满步达成');
    assert.ok(w5.agendas.find((a) => a.id === 'a_k').memory.done.some((d) => d.includes('兑现')), '父 done 照写兑现');
    assert.ok(!w5.chronicle.some((c) => c.text.includes('兑现')), 'concealed 兑现编年抑制');
    assert.ok(w5.chronicle.some((c) => c.text.includes('暗线兑付') && c.text.includes('满步结算')), '终结上桌（含子目标——终结即水面）');
    assert.ok(w5.chronicle.some((c) => c.text.includes('事件「北关灯火如常」')), '事件上桌（事件即露出水面）');
    assert.ok(!w5.chronicle.some((c) => c.text.includes('推进：第 1 步')), 'concealed 推进全程无痕');
});

test('K21/A-4：观棋数据窗口全局可见不变（格局行含 concealed）；注入侧零改动（掩码语义不冲突）', () => {
    const r = settleTick({ ssot: W(), step: step({ agendaAdvances: [adv('a_c', '暗动')] }) });
    assert.equal(r.ok, true);
    const obs = renderStreams(r.ssot, r.stage, null).observer.join('\n');
    assert.ok(obs.includes('暗渡陈仓'), '格局行列出全部在飞盘算（含 concealed——数据窗口全局可见，ANCHOR §6 拍板）');
    assert.ok(obs.includes('明修栈道'), 'known 照列');
    const inj = renderStreams(r.ssot, r.stage, null).injection;
    assert.equal(inj, null, '无玩家世界注入降级全见语义不动（P-E）；本世界无事件条目 → 无注入文本');
});
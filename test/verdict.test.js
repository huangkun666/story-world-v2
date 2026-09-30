// story-world-v2/test/verdict.test.js
// K15 验收（盘算树细案 §3.4/§4 K15 → A-6）：盘算**满步终局**——结清 / 变形（有在飞子 → 诸子断链转独立）；
// 判序 = 变形优先 → 结清；兑现落痕仅结清态；模型无直接终结通道。
//
// ===================== leg25 f 修订（用户拍板「X1 认账简化」） =====================
// 原三态（达成 / 败露 / 变形）→ **两态（结清 / 变形）**。为什么删掉「败露」而不是另立判据：
//   ①它的判据吃 `hurtWindow`（近 2 tick 负向 δ），而该字段随四维属性失去写入方
//     ⇒ `|0| >= 0.05` 恒假 ⇒ **分支永不可达**、`VERDICT_HURT_THRESHOLD` 成死参数（两件事都已删）；
//   ②引擎手上**没有任何"计划被打崩/落空"的客观输入**：`agenda` 不落 `source`（只在出生时用于编年措辞）、
//     父终结时 `parentId` 被 delete、`memory.done` 只记"做过什么"；
//     实测 50 tick 合成跑：满步盘算 `memory.done=3`，"起手未动"**0 例**。
//   ③所以不是"判据没写好"，是**输入不存在** ⇒ 与其新造一个数字（触碰「宁缺勿造」），不如把结论收回
//     引擎职权边界内：措辞由「达成」（= 对世界下判断"这事办成了"）改为「**结清**」（= 账房期满收摊）。
//   "未竟而终"由既有通道承担：模型提议取消（K22：提议 + 理由 + 引擎裁决 + 托孤 + 联闭）。
// 依据全文：`docs/spec-failure-verdict-and-visibility.md` §2。
// 本文件同时锁住：**已死机制不许回潮**（无「败露」字样、无 `hurtWindow` 字段、无阈值常量）。
// ================================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { settleTick, migrateLegacyAttrs } from '../src/settle.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import * as settleMod from '../src/settle.js';

const TREE = JSON.parse(readFileSync(new URL('./fixtures/tree-world.json', import.meta.url), 'utf8'));

const na = (entity, goal, source, extra = {}) => ({ entity, goal, visibility: 'known', source, ...extra });
// 推 a_son1（progress 1 → maxSteps 3）两步 → 满步
const pushSon = (extra = {}) => ({
    actions: [], newEvents: [],
    agendaAdvances: [
        { agendaId: 'a_son1', step: '粮道探明', stage: '就绪' },
        { agendaId: 'a_son1', step: '押运启程', stage: '上路' },
    ],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
    ...extra,
});
const emptyStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

test('leg25 f/A-6 结清：无子满步 → 「结清」编年（期满收摊，不下"办成了"的判断）+ 兑现落痕保留', () => {
    const r = settleTick({ ssot: TREE, step: pushSon() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const w = r.ssot;
    const fin = w.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('结清'), `措辞应为「结清」：${fin.text}`);
    assert.ok(fin.text.includes('期满收摊'), '结清要说明是"期满"，不是"胜利"');
    assert.ok(!fin.text.includes('达成'), '★引擎不再宣称「达成」——它无权对世界下这个判断');
    assert.ok(!fin.text.includes('败露') && !fin.text.includes('变形'), '措辞精确区分');
    assert.ok(w.agendas.find((a) => a.id === 'a_root').memory.done.some((d) => d.includes('粮草调度')), '结清态兑现');
});

test('leg25 f 判序：变形优先——有在飞子必先断链托孤（子不悬挂死父）', () => {
    const step = pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })] });
    const r = settleTick({ ssot: TREE, step });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    const fin = r.ssot.chronicle.find((c) => c.id === 'ch_1_fin_a_son1');
    assert.ok(fin.text.includes('变形'), fin.text);
    assert.ok(!fin.text.includes('结清'), '有子 ⇒ 变形，不走结清');
});

test('leg25 f ★已死机制不许回潮：无「败露」结局、无 hurtWindow 字段、无阈值常量', () => {
    // 这一条是**防复活锁**：删掉的东西必须真的不在了，而不是"改了个名字继续活着"。
    const r = settleTick({ ssot: TREE, step: pushSon() });
    assert.equal(r.ok, true, r.stage.warnings.join('; '));
    assert.ok(!r.ssot.chronicle.some((c) => c.text.includes('败露')), '★全账无「败露」字样（分支已删，不是不可达）');
    assert.ok(r.ssot.entities.every((e) => e.hurtWindow === undefined), '★引擎不产生 hurtWindow');
    assert.equal(settleMod.VERDICT_HURT_THRESHOLD, undefined, '★死参数 VERDICT_HURT_THRESHOLD 已删除（不是留着不用）');
    // 旧账遗留的 hurtWindow 由载入期迁移无条件摘除（见下一则）
    let w = structuredClone(TREE);
    for (let i = 0; i < 3; i++) w = settleTick({ ssot: w, step: emptyStep() }).ssot;
    assert.ok(w.entities.every((e) => e.hurtWindow === undefined), '干净世界多轮后依然没有窗口');
});

test('leg25 f 旧账迁移：hurtWindow 无条件摘除——含"只有 hurtWindow、没有 attrs"那种账（治"删一半"）', () => {
    // 为什么单列这一条：旧迁移函数在"没有 attrs"时会**提前原样返回**，
    //   于是"只残留 hurtWindow"的账会带着该字段过 schema（`additional:false` ⇒ 直接校验不过）——
    //   这正是台账里 `attrs 只删了一半` 那个老洞的同款。现两处摘除都是**无条件**的。
    const w0 = structuredClone(TREE);
    w0.meta.attrsRemovedAt = 2;                                             // 模拟"attrs 早已迁过"的老账
    w0.entities.find((e) => e.id === 'e_court').hurtWindow = [-0.06, 0];    // 只剩 hurtWindow 残留
    const w1 = migrateLegacyAttrs(w0);
    assert.equal(w1.entities.find((e) => e.id === 'e_court').hurtWindow, undefined,
        '★即使 attrs 已迁过（meta 闸在位），hurtWindow 也必须被摘掉（不做提前退出）');
    const vr = validate(w1, ssotSchema);
    assert.equal(vr.ok, true, `★摘除后必须过 schema（残留会让 additional:false 直接拒）：${vr.errors.join('; ')}`);
    // 幂等：再迁一次逐字节不变
    const w2 = migrateLegacyAttrs(w1);
    assert.equal(JSON.stringify(w2), JSON.stringify(w1), '迁移幂等（无可摘即不改一字）');
    // attrs 与 hurtWindow 同时残留时，两者一起摘、attrs 留档
    const w3 = structuredClone(TREE);
    w3.entities.find((e) => e.id === 'e_court').attrs = { hardPower: 0.5 };
    w3.entities.find((e) => e.id === 'e_court').hurtWindow = [0, 0];
    const w4 = migrateLegacyAttrs(w3);
    assert.equal(w4.entities.find((e) => e.id === 'e_court').hurtWindow, undefined, 'hurtWindow 摘除');
    assert.equal(w4.entities.find((e) => e.id === 'e_court').attrs, undefined, 'attrs 摘除');
    assert.deepEqual(w4.meta.legacyAttrsPurged.e_court, { hardPower: 0.5 }, 'attrs 旧值留档（不许无声消失）');
});

test('leg25 f：两态结算后世界过 SSOT schema；结清是唯一无子结局', () => {
    const r = settleTick({ ssot: TREE, step: pushSon() });
    const vr = validate(r.ssot, ssotSchema);
    assert.equal(vr.ok, true, vr.errors.join('; '));
    const w2 = settleTick({ ssot: TREE, step: pushSon({ newAgendas: [na('e_lead', '分粮', { type: 'parent', ref: 'a_son1' })] }) });
    const vr2 = validate(w2.ssot, ssotSchema);
    assert.equal(vr2.ok, true, vr2.errors.join('; '));
    assert.ok(r.ssot.chronicle.some((c) => c.text.includes('结清')), '无子终结 → 结清');
    assert.ok(w2.ssot.chronicle.some((c) => c.text.includes('变形')), '有子终结 → 变形');
});

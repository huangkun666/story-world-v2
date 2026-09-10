// story-world-v2/test/prompts.test.js
// 契约层·主调用 prompt 锁（第十三棒起）：模板/铁律的关键语义是给模型看的契约——
// 回退即回归，用断言钉死（v2-ripples-1：ripples=实体 id 显式化）。
// leg24 检察官审计处置 H 组（v2-agenda-t1-5）：版本锁升位 + "分量"退场锁（片3）。
// leg25 c（单维删除）：**attrs 相关锁整条撤除**——四维浮点（兵力/权位/人脉/耳目）已随用户令删除，
//   模板里不再有 `attrs` 这一项（连同"省略=这一维空着"那句一起消失），所以没有可锁的东西了。
//   为什么不是"换名续用"：那正是本次要治的病（拿精确外壳装模糊内容）；该删就删，锁也一起删。
//   保留的锁改成"七组形状"——stateChanges 与 attrs 去掉后，世界步=七组，这个数字本身就是契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_PROMPT, MAIN_PROMPT_V, OUTPUT_TEMPLATE, assembleMainPrompt } from '../src/prompts.js';

test('契约锁：主调用模板版本与铁律语义（v2-agenda-t1-5：分量退场 + leg25 c 七组形状）', () => {
    assert.equal(MAIN_PROMPT_V, 'v2-agenda-t1-5');
    // H1（leg24 片3 起那个数已退场、且不随行入包 P3）：提示词不再拿分量说"谁值得动"
    assert.ok(!MAIN_PROMPT.includes('分量'), '提示词对模型不再提"分量"（模型看不到它——P3）');
    assert.ok(!MAIN_PROMPT.includes('分量与盘算决定谁值得动'), '旧铁律 5 措辞不得回潮');
    assert.ok(!MAIN_PROMPT.includes('实体/分量/盘算'), '输入清单不再含分量');
    assert.ok(MAIN_PROMPT.includes('谁值得动由你在名单内决定'), '铁律 5 改结构事实口径（在办的事/刚出过手/被点名）');
    assert.ok(MAIN_PROMPT.includes('手上有在办的事、刚出过手、被点名的那几位优先'));
    assert.ok(MAIN_PROMPT.includes('引擎只做门控与拦矛盾'));
    // leg25 c：四维浮点退出契约面——模板/铁律/字段说明里不得再出现任何一个旧属性名或 attrs 键
    assert.ok(!MAIN_PROMPT.includes('attrs'), 'attrs 已随四维一起退出提示词（该删就删，不换名续用）');
    assert.ok(!/stateChanges/.test(MAIN_PROMPT), 'stateChanges 整条已删（它改的就是那四个数）');
    for (const term of ['hardPower', 'office', 'network', 'intel']) {
        assert.ok(!MAIN_PROMPT.includes(term), `旧属性名「${term}」不得回潮（手拍值让"编的"像"算的"，design-core-leg23 §4①）`);
    }
    // 七组形状（actions/newEvents/agendaAdvances/newAgendas/agendaCancels/newEntities/entityFates）
    assert.ok(MAIN_PROMPT.includes('七组：actions / newEvents / agendaAdvances / newAgendas / agendaCancels / newEntities / entityFates'),
        '世界步=七组的形状声明在模板里');
    // K45：newEntities parent 形态纪律在字段说明
    assert.ok(MAIN_PROMPT.includes('parent=所属势力名（可省'), 'K45 parent 说明在模板');
    assert.ok(!MAIN_PROMPT.includes('席位上限全归引擎'), '席位上限措辞已废（K45）');
    // 铁律 4（leg25 c 改写）：引用必须真实存在——不再提 stateChanges
    assert.ok(MAIN_PROMPT.includes('actions 的 entity、agendaAdvances 的 agendaId 必须引用输入中存在的 id'),
        '铁律 4 只提 actions/agendaAdvances 两条引用纪律（stateChanges 已删）');
    // 铁律 8：ripples 只收实体 id，事件引用走 source.type=ripple + ref
    assert.ok(MAIN_PROMPT.includes('newEvents[].ripples 只收被波及的**实体 id**'));
    assert.ok(MAIN_PROMPT.includes('绝对不是事件引用'));
    // 字段说明同步
    assert.ok(MAIN_PROMPT.includes('newEvents[].ripples=被波及的**实体 id 列表**'));
    // 模板示例仍是实体 id（防止示例被改成事件 id 而语义漂移）
    assert.ok(OUTPUT_TEMPLATE.includes('"ripples": ["e_dayu", "e_xie"]'));
    // K37：newEntities/entityFates 形状与提议权语义进模板
    assert.ok(OUTPUT_TEMPLATE.includes('"newEntities"') && OUTPUT_TEMPLATE.includes('"entityFates"'));
    assert.ok(MAIN_PROMPT.includes('可以提议新实体入局') && MAIN_PROMPT.includes('覆灭与否全归引擎复核'));
    // 模板实体示例里不再有 attrs 键（leg25 c：入局数值面整条删）
    assert.ok(!OUTPUT_TEMPLATE.includes('"attrs"'), 'OUTPUT_TEMPLATE 不再示范 attrs（入局数值面已删）');
    assert.ok(!OUTPUT_TEMPLATE.includes('"stateChanges"'), 'OUTPUT_TEMPLATE 不再示范 stateChanges');
    assert.ok(MAIN_PROMPT.includes('dialogueBook=对话依据册'), '依据册段说明在模板（K38 补差包 C 条）');
    // init 路径可用
    assert.ok(assembleMainPrompt({ text: '测试输入' }).includes('测试输入'));
});

test('契约锁：源头语义句共存（plot/state/ripple 三源 + 无源之物不存在）', () => {
    assert.ok(MAIN_PROMPT.includes('事件必须有源'));
    assert.ok(MAIN_PROMPT.includes('无源之物不存在'));
});

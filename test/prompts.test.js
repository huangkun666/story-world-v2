// story-world-v2/test/prompts.test.js
// 契约层·主调用 prompt 锁（第十三棒起）：模板/铁律的关键语义是给模型看的契约——
// 回退即回归，用断言钉死（v2-ripples-1：ripples=实体 id 显式化）。
// leg24 检察官审计处置 H 组（v2-agenda-t1-5）：版本锁升位 + "分量"退场锁（片3）+ attrs 省略=空着锁（片2）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_PROMPT, MAIN_PROMPT_V, OUTPUT_TEMPLATE, assembleMainPrompt } from '../src/prompts.js';

test('契约锁：主调用模板版本与铁律语义（v2-agenda-t1-5：分量退场 + attrs 省略=空着）', () => {
    assert.equal(MAIN_PROMPT_V, 'v2-agenda-t1-5');
    // H1（leg24 片3 起那个数已退场、且不随行入包 P3）：提示词不再拿分量说"谁值得动"
    assert.ok(!MAIN_PROMPT.includes('分量'), '提示词对模型不再提"分量"（模型看不到它——P3）');
    assert.ok(!MAIN_PROMPT.includes('分量与盘算决定谁值得动'), '旧铁律 5 措辞不得回潮');
    assert.ok(!MAIN_PROMPT.includes('实体/分量/盘算'), '输入清单不再含分量');
    assert.ok(MAIN_PROMPT.includes('谁值得动由你在名单内决定'), '铁律 5 改结构事实口径（在办的事/刚出过手/被点名）');
    assert.ok(MAIN_PROMPT.includes('手上有在办的事、刚出过手、被点名的那几位优先'));
    assert.ok(MAIN_PROMPT.includes('引擎只做门控与拦矛盾'));
    // H2（leg24 片2 删预填）：attrs 省略=这一维空着，不再是"引擎给默认值"
    assert.ok(MAIN_PROMPT.includes('attrs=初始属性（可省；数值限定 0..1'), 'attrs 说明在模板（K38 补差包 D 条）');
    assert.ok(MAIN_PROMPT.includes('省略=这一维空着（没有据）——只有你提议才会落账'), 'attrs 省略=空着（无默认值承诺）');
    assert.ok(!MAIN_PROMPT.includes('省略=引擎按势力/角色给默认值'), '旧"引擎给默认值"承诺不得回潮');
    // K45：newEntities parent 形态纪律在字段说明
    assert.ok(MAIN_PROMPT.includes('parent=所属势力名（可省'), 'K45 parent 说明在模板');
    assert.ok(!MAIN_PROMPT.includes('席位上限全归引擎'), '席位上限措辞已废（K45）');
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
    // K38：入局 attrs（可省、0..1、省略=空着）+ pack 依据册段（dialogueBook）语义进模板
    assert.ok(OUTPUT_TEMPLATE.includes('"attrs": { "network": 0.2, "intel": 0.1 }'));
    assert.ok(MAIN_PROMPT.includes('dialogueBook=对话依据册'), '依据册段说明在模板（K38 补差包 C 条）');
    // init 路径可用
    assert.ok(assembleMainPrompt({ text: '测试输入' }).includes('测试输入'));
});

test('契约锁：源头语义句共存（plot/state/ripple 三源 + 无源之物不存在）', () => {
    assert.ok(MAIN_PROMPT.includes('事件必须有源'));
    assert.ok(MAIN_PROMPT.includes('无源之物不存在'));
});

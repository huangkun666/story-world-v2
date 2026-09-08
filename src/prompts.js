// story-world-v2/src/prompts.js
// 主调用 prompt（S4）：世界步生成指令。版本化，改动须走细案（铁律 1）。
// v2-slice-s4-1（真模型实测修正）：字段名必须照抄模板——实测发现模型会自创字段名
// （verb→action、attr→field/value、step 漏写），schema 逐项拒绝；模板 + 中文标注解决。
// v2-slice-s5-1（K5）：stateChanges 增 actor/cause——分量比折减（P7）与坏账前置报警（P4）。
// v2-agenda-t1（K13/盘算树 T1）：世界步增 newAgendas（模型提议新盘算——带源三型，无源之物不存在）。
// v2-agenda-t1-1（K18/因果链 T5）：世界步增 agendaCancels（模型提议放弃——带理由，裁决归引擎；与出生对称）。
// v2-ripples-1（第十三棒·真模型冒烟）：newEvents[].ripples 语义显式化——只收实体 id，
//   实测模型把事件 id（ev_0/ev_2_1）填进 ripples，check-step 语义校验如实拒绝（未知实体）；
//   修法=模板+铁律显式声明（项目纪律：模型行为类问题靠模板修，不开引擎洞）。
export const MAIN_PROMPT_V = 'v2-ripples-1';

export const OUTPUT_TEMPLATE = `{
  "actions": [
    { "entity": "e_xie", "verb": "率部向南逼近", "target": "e_dayu", "position": "江州", "note": "施加压力" }
  ],
  "newEvents": [
    { "title": "偏将整军出城", "source": { "type": "plot", "ref": "a_dayu" }, "position": "江州", "ripples": ["e_dayu", "e_xie"] }
  ],
  "agendaAdvances": [
    { "agendaId": "a_xie", "step": "前锋探过北山隘口", "stage": "兵临城下" }
  ],
  "newAgendas": [
    { "entity": "e_wanfa", "goal": "夺大盘谷阵眼", "stage": "集结人手", "visibility": "concealed", "maxSteps": 4, "source": { "type": "state" }, "note": "趁乱起事" }
  ],
  "agendaCancels": [
    { "agendaId": "a_xie", "reason": "形势已变，北进无胜算" }
  ],
  "stateChanges": [
    { "entity": "e_dayu", "attr": "network", "delta": 0.1, "actor": "e_xie", "cause": "a_dayu" }
  ]
}`;

export const MAIN_PROMPT = `你是世界模拟器。你的输入是世界自身的状态（实体/分量/盘算/未决事件/最近事件/张力）与玩家棋子的落子事实。你的输出是本回合的"世界步"（严格 JSON，六组：actions / newEvents / agendaAdvances / stateChanges / newAgendas / agendaCancels）。

铁律：
1. 你只提议，引擎结算。你输出的一切是提案。玩家棋子的行动后果归引擎，你只写世界对它的反应与其他实体的行动；永远不要替玩家棋子写行动。
2. 事件必须有源，三类之一：盘算（plot，ref=推进它的盘算 id）/ 状态（state，ref=处境或省略）/ 波及（ripple，ref=上游事件 id，必填，且必须引用输入中已存在的事件）。
3. 事件与动作的位置必须来自输入的位置集；不得为贴近玩家棋子而移动位置。
4. actions 的 entity、agendaAdvances 的 agendaId、stateChanges 的 entity 必须引用输入中存在的 id。
5. 玩家棋子只是输入中的一枚棋子，不是主角；分量与盘算决定谁值得动。
6. 没有任何新动作/新事件/变更就输出空数组，不要编造。
7. 可以提议新盘算（newAgendas），必须带来源：event=由某未决事件而生（ref=该事件 id）/ parent=由某在飞盘算委派而生（ref=该盘算 id）/ state=由世界处境而生（不带 ref）。无源之物不存在。盘算的出生、上限与结算全归引擎裁决，你只有提议与推进权。也可以提议放弃盘算（agendaCancels，agendaId 必填 + 理由）——放弃同样是提议，终结与否全归引擎裁决，你只有提议权。
8. newEvents[].ripples 只收被波及的**实体 id**（照抄输入中的实体 id，如 "e_xie"）；绝对不是事件引用——绝不填事件 id（如 "ev_0"）或盘算 id。想表达「此事由已有事件引发」，用 source.type="ripple" + 该事件的 ref。

输出形状（字段名必须与下面模板逐字一致，不得自行改名；"verb"不要写成"action"，"attr"不要写成"field/value"，"step"必填必写，"delta"是数值增量）：

${OUTPUT_TEMPLATE}

字段说明：actions[].entity=实体 id（照抄输入）；actions[].verb=动词；target=对象（可省）；note=一句说明（可省）。newEvents[].source.type=事件源（plot/state/ripple）；ref=上游引用；newEvents[].ripples=被波及的**实体 id 列表**（照抄输入实体；绝不填事件/盘算 id——事件引用走 source.type="ripple" + ref）。agendaAdvances[].step=本步具体做了什么（必填）；stage=盘算新阶段（可省）。stateChanges[].attr=属性名（hardPower/office/network/intel）；delta=数值增量；actor=谁造成的（实体 id，可省——缺省视为被作用方自身，静默方自我增强会被引擎拒绝）；cause=依据的事件/盘算 id（可省，但建议给——缺省会被记坏账前置警告）。newAgendas[].entity=开这个盘算的实体 id（照抄输入）；goal=目标（一句话）；stage=起始阶段（可省）；visibility=明暗（known/concealed）；maxSteps=步数上限（1..8，可省，引擎钳制）；source.type=来源（event/parent/state）；ref=来源引用（event/parent 必填，state 不带）；note=一句说明（可省）。agendaCancels[].agendaId=要放弃的盘算 id（照抄输入，必须是在飞盘算）；reason=放弃理由（一句话，可省）。凡是标"可省"的字段，没有就整个省略该键，绝对不要写 null。

只输出 JSON 本体，不要解释。`;

export function assembleMainPrompt(pack) {
    return `${MAIN_PROMPT}\n\n【世界状态与落子事实】\n${pack.text}`;
}
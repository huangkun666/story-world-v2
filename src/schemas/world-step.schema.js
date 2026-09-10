// story-world-v2/src/schemas/world-step.schema.js
// 世界步输出 Schema（提案形状）：一次主 LLM 调用的结构化输出（ANCHOR §3②）。
// = 实体动作 / 新事件（带因果）/ Agenda 推进 / 状态变更
// 提案标注：S3 落子契约实测后可能联动调整（来源/位置语义），届时按流程过细案。

export const worldStepSchema = {
    kind: 'object',
    additional: false,
    required: ['actions', 'newEvents', 'agendaAdvances', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates'],
    props: {
        agendaCancels: {   // K18/因果链 T5：模型提议放弃盘算（带理由——提议权，裁决归引擎；与出生对称）
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['agendaId'],
                props: {
                    agendaId: { kind: 'string', minLength: 1 },
                    reason: { kind: 'string' },
                },
            },
        },
        newAgendas: {   // K13/盘算树 T1：模型提议新盘算（带源三型——无源之物不存在；生与死归引擎）
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['entity', 'goal', 'visibility', 'source'],
                props: {
                    entity: { kind: 'string', minLength: 1 },
                    goal: { kind: 'string', minLength: 1 },
                    stage: { kind: 'string' },
                    visibility: { kind: 'string', enum: ['known', 'concealed'] },
                    maxSteps: { kind: 'number', int: true, min: 1, max: 8 },
                    source: {
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['event', 'parent', 'state'] },
                            ref: { kind: 'string' },
                        },
                    },
                    note: { kind: 'string' },
                },
            },
        },
        newEntities: {   // K37/实体治理（§3.7 生通道②）：模型提议新实体入局——带源三型（book/event/dialogueFact）；出生/单轮上限/从属校验全归引擎（K45：席位上限已废）
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['name', 'location', 'source'],
                props: {
                    name: { kind: 'string', minLength: 1 },
                    kind: { kind: 'string', enum: ['faction', 'character'] },
                    location: { kind: 'string', minLength: 1 },
                    entity: { kind: 'string', minLength: 1 },   // 提议者实体 id（静默判定用；dialogueFact 源可填观察者）
                    parent: { kind: 'string', minLength: 1 },   // K45/C7：所属势力名（可省——书/对话中已知的门派或势力；引擎校验目标在册且为势力，不满足弃关系）
                    // leg25 c：入局 `attrs`（四维浮点提议）**整条删除**——四维已不存在（见 ssot.schema 注释）。
                    source: {
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['book', 'event', 'dialogueFact'] },
                            ref: { kind: 'string' },
                        },
                    },
                },
            },
        },
        entityFates: {   // K37/实体治理（§3.7 灭）：模型提议覆灭——与 agendaCancels 同构，真实落账复核归引擎
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['entity', 'verdict', 'source'],
                props: {
                    entity: { kind: 'string', minLength: 1 },
                    verdict: { kind: 'string', enum: ['dead'] },
                    source: {
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['event', 'agenda'] },
                            ref: { kind: 'string' },
                        },
                    },
                    reason: { kind: 'string' },
                },
            },
        },
        actions: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['entity', 'verb'],
                props: {
                    entity: { kind: 'string', minLength: 1 },
                    verb: { kind: 'string', minLength: 1 },
                    target: { kind: 'string' },
                    position: { kind: 'string' },
                    note: { kind: 'string' },
                },
            },
        },
        newEvents: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['title', 'source', 'position'],
                props: {
                    title: { kind: 'string', minLength: 1 },
                    source: {
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['plot', 'state', 'ripple'] },
                            ref: { kind: 'string' },
                        },
                    },
                    position: { kind: 'string', minLength: 1 },
                    ripples: { kind: 'array', items: { kind: 'string' } },
                },
            },
        },
        agendaAdvances: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['agendaId', 'step'],
                props: {
                    agendaId: { kind: 'string', minLength: 1 },
                    step: { kind: 'string', minLength: 1 },
                    stage: { kind: 'string' },
                    note: { kind: 'string' },
                },
            },
        },
        // leg25 c（用户令「删」）：`stateChanges`（模型提议的属性增量：{entity, attr, delta, actor, cause}）
        //   **整条删除**——它改的就是四维浮点（兵力/权位/人脉/耳目），而四维已不存在
        //   （没法精确表示；手拍值让"编的"看起来像"算的"，design-core-leg23 §4 第 1 条）。
        //   连带影响如实登记：盘算"败露"判据原吃 hurtWindow（近 2 tick 负向 δ，来源就是这里），
        //   负向 δ 一起消失 ⇒ 败露分支失去输入（详见 settle.js adjudicate 注释）。
        //   要恢复"败露"须另立**不依赖假精度**的判据（待拍板，未擅自发明）。
    },
};
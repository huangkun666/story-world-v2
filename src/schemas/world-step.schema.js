// story-world-v2/src/schemas/world-step.schema.js
// 世界步输出 Schema（提案形状）：一次主 LLM 调用的结构化输出（ANCHOR §3②）。
// = 实体动作 / 新事件（带因果）/ Agenda 推进 / 状态变更
// 提案标注：S3 落子契约实测后可能联动调整（来源/位置语义），届时按流程过细案。

export const worldStepSchema = {
    kind: 'object',
    additional: false,
    required: ['actions', 'newEvents', 'agendaAdvances', 'stateChanges', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates'],
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
        newEntities: {   // K37/实体治理（§3.7 生通道②）：模型提议新实体入局——带源三型（book/event/dialogueFact）；出生/席位/上限全归引擎
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
                    attrs: { kind: 'numRecord' },   // K38 补差包 D 条：入局可选属性提议（引擎 [0,1] 钳制；缺省按 kind 兜底）
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
        stateChanges: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['entity', 'attr', 'delta'],
                props: {
                    entity: { kind: 'string', minLength: 1 },
                    attr: { kind: 'string', minLength: 1 },
                    delta: { kind: 'number' },
                    actor: { kind: 'string' },   // K5/P7 构件：谁造成的（缺省=被作用方自身；静默方自我增强被拒）
                    cause: { kind: 'string' },   // K5/P4：依据的事件/盘算 id（缺省记坏账前置警告）
                },
            },
        },
    },
};
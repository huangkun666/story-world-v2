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
                    // ★leg32e（小说家条款 §3.2 第一片）：源型增 `entity` = **由在册实体牵出**（ref=那个实体 id）。
                    //   为什么加：旧三型（book/event/dialogueFact）都要求"书上写过 / 有事件 / 对话里点过名"
                    //   ⇒ **书上没写的人永远进不来**。真账实测 38 轮只有 4 个属主、614 人从未出场，
                    //   模型只能在同一批名字里翻来覆去（用户：「只有将创作权交在 llm 手里才能活起来」）。
                    //   ★这不放开"编事实"：牵出者必须**在册且未灭**（`check-step.js` 硬闸），
                    //   名字非空不重名、位置仍须 ∈ 位置集、每轮新生仍 ≤ ENTITY_BIRTH_PER_TICK。
                    source: {
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['book', 'event', 'dialogueFact', 'entity'] },
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
        //   ✅ leg25 f 收口：它的连带后果（盘算"败露"判据失去 hurtWindow 输入）已按用户拍板处置——
        //   删掉败露支与 `VERDICT_HURT_THRESHOLD`、满步终局措辞改「结清」，**不新造判据**
        //   （引擎没有任何"计划被打回"的客观输入）。详见 `docs/spec-failure-verdict-and-visibility.md` §2。
    },
};
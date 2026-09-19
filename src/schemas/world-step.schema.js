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
        newEntities: {   // K37/实体治理（§3.7 生通道②）：模型提议新实体入局——带源四型（book/event/dialogueFact/entity）；出生/单轮上限/从属校验全归引擎（K45：席位上限已废）
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                // ★leg33c：`location` 从 required 里**拿掉**（用户拍板「位置变成自由文本，位置集干脆删了」）。
                //   为什么：① 位置早就不参与机制（定案「只做呈现」），没有理由强制模型为每个新人编一个地名；
                //   ② 真账 canon 有 **134** 个地点条目、旧 `derivePositions` 只收 59 ⇒ 模型写书里真有的地名
                //      也可能"不在集内"，强制它填 = 逼它编 ⇒ 与"空着就是空着"（§2 第 2 条）冲突。
                //   口径：**给了就照收**（集外也收，只留痕）；**没给就落「未明」**（`settle.js` spawnEntities）。
                required: ['name', 'source'],
                props: {
                    name: { kind: 'string', minLength: 1 },
                    kind: { kind: 'string', enum: ['faction', 'character'] },
                    location: { kind: 'string', minLength: 1 },   // 可省：驻点（自由文本；给了照收，没给落「未明」）
                    entity: { kind: 'string', minLength: 1 },   // 提议者实体 id（静默判定用；dialogueFact 源可填观察者）
                    parent: { kind: 'string', minLength: 1 },   // K45/C7：所属势力名（可省——书/对话中已知的门派或势力；引擎校验目标在册且为势力，不满足弃关系）
                    // leg25 c：入局 `attrs`（四维浮点提议）**整条删除**——四维已不存在（见 ssot.schema 注释）。
                    // ★leg32e（小说家条款 §3.2 第一片）：源型增 `entity` = **由在册实体牵出**（ref=那个实体 id）。
                    //   为什么加：旧三型（book/event/dialogueFact）都要求"书上写过 / 有事件 / 对话里点过名"
                    //   ⇒ **书上没写的人永远进不来**。真账实测 38 轮只有 4 个属主、614 人从未出场，
                    //   模型只能在同一批名字里翻来覆去（用户：「只有将创作权交在 llm 手里才能活起来」）。
                    //   ★这不放开"编事实"：牵出者必须**在册且未灭**（`check-step.js` 硬闸），名字非空不重名，
                    //   每轮新生仍 ≤ ENTITY_BIRTH_PER_TICK。
                    //   ⚠（leg33c 更正）旧注释这里写"位置仍须 ∈ 位置集"——**该判据已废**，位置改自由文本。
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
        // ★leg34（小说家条款 §6 实施）：**实体字段写回**——用户 ⑤「我认为 llm 有权决定任何字段，实力是可以增长的，
        //   性情是可以大变的，就连死亡在一个有复活的世界都可以改变」。
        //   ★**可选组**（不在顶层 required 里）：与既有七组不同，它缺席时世界照常推进（引擎视作"本轮没有变更提议"）。
        //     为什么可选：①七个必填组的理由是"省键 = 形状不合法"（leg32 实测整步被拒），而这两组缺席**没有等价危害**；
        //     ②既有 ~110 处夹具与历史快照都只有七组，强行必填会一次性砸掉且**无收益**。
        //   ★形状与 `entityFates` 同构：**模型只有提议权**，复核与落账归引擎（`settle.js` applyEntityUpdates）。
        entityUpdates: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['entity', 'field', 'value', 'cause'],
                props: {
                    entity: { kind: 'string', minLength: 1 },   // 照抄输入实体 id
                    field: { kind: 'string', minLength: 1 },    // 字段名（黑名单见 check-step：id/name/kind 不可改）
                    value: { kind: 'string', minLength: 1 },    // ★文本，不许增量数值（四维被删的原因）
                    // ★`cause` = 「因果变更」与「模型随口改」的**唯一分界**（细案 §6.2 约束 1/3）：
                    //   必须指向账上真实存在、**且未闭环**的事件或盘算。
                    cause: {
                        kind: 'object',
                        additional: false,
                        required: ['type', 'ref'],
                        props: {
                            type: { kind: 'string', enum: ['event', 'agenda'] },
                            ref: { kind: 'string', minLength: 1 },
                        },
                    },
                    note: { kind: 'string' },                   // 为什么这次事件让它变了
                },
            },
        },
        // ★★★leg64 第四轮（用户令「做吧」）：**按需查表**——模型点名要某几张刻度表（`刻度目录` 里
        //   逐字给过表名）。这是补上"目录让它知道有这张尺、却没有入口拿到它"那个缺口（见 `pack.js`
        //   的 `buildScaleOnDemand` 头注；本仓最忌"提示词替机制承诺一个它做不到的事"）。
        //   ★形状 = **字符串数组**（表名，照抄目录），不是对象数组：点名的键只有"表名"一个，
        //     而表名是模型手里唯一有的标识（它没有 id 可抄）。
        //   ★**可选组**（与 `entityUpdates` 同一条口径）：缺席 = 本轮没要点表，**不是形状错误**。
        //     为什么可选：①既有 ~110 处夹具与历史快照只有七/八组，强行必填会一次性砸掉且无收益；
        //     ②"忘了要表"与"忘了推进世界"代价完全不同——前者只是这一轮少看一张尺。
        //   ★复核归引擎（`check-step`）：**对不上账上任何一张表的表名一律拒**（无源之物不入局，
        //     模型编一个表名 ⇒ 引擎不许替它造一张出来）；每轮 ≤ `SCALE_ONDEMAND_TOP` 张。
        lookupScales: {
            kind: 'array',
            items: { kind: 'string', minLength: 1 },
        },
        // ★★★leg95（用户令「让 llm 来决定何时结束」+「引入机械就一定要避免让代码去理解语义」）：
        //   **模型判"这一段讲完了"的通道**——与 `agendaCancels` 同构（提议权归模型、落账归引擎），
        //   但引擎那一侧**只做机械审计、不判语义**：号在册 ∧ 还没收场 ∧ 同批不重复 ∧ 每轮配额。
        //   ★它治的是那道**结构死锁**：种子的"链头已了结"永远为 false（`settle.js` 的 chainSettled 旧法）
        //     ⇒ 种子底下长出来的每一环永远闭不了（真账 A 局 16 条 / B 局 44 条，推 40 轮只增不减）。
        //     模型点名链头收场 ⇒ 底下那串当场过门 ⇒ 引擎的老规则自己一层层扫干净。
        //     **真账回测**（`demo/measure-leg95-close-live.js`，问法「讲完了没有」）：B 局只点 9 件 ⇒ 连带解开 21 件。
        //   ★形状：**对象数组 `{event, why}`**（照 `entityUpdates` 那一族的写法）。
        //     ⚠一处当场踩到的坑（留档）：**本仓的 `schema.js` 没有 `anyOf`**（只有 object/array/string/
        //     number/boolean/numRecord/strRecord/any 八种）——第一版想写成"字符串或对象都收"，那是**凭空写契约**，
        //     校验器根本不认。⇒ 定稿单一形状：`event` 必填、`why` 可省（引擎对裸字符串仍做防御性兼容，
        //     但**契约只承诺这一种**）。
        //   ★**可选组**（与 `entityUpdates` / `lookupScales` 同一条口径）：缺席 = 本轮不提议，**不是形状错误**
        //     ——既有 ~110 处夹具与历史快照都没有这一组，强行必填会一次性砸掉且无收益。
        //   ★每次 ≤ `EVENT_CLOSE_CAP`（8）：超出的**顺延下一轮**（引擎给警告，不整步拒——配额不是形状）。
        eventClosures: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['event'],
                props: {
                    event: { kind: 'string', minLength: 1 },   // 照抄输入里未决事件的 id
                    why: { kind: 'string' },                   // 一句话：为什么这一段已经讲完了（进编年）
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
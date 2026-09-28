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
        // ★★★leg120（A3 关系网，细案 `docs/spec-relationship-network.md`）：**模型提议"关系变更"**。
        //   病：账上九张表**没有一张**记"谁跟谁是什么关系"——最像关系的只有 `parent`（单向从属、照书办，
        //   角色与角色之间一条都不连）与 `ripples`（共现，不是关系）。而它是 leg24 **有意删的**
        //   （`abstract.js:607` 删除位，理由"产出全属书的副本"）——**那条理由只对了一半**：
        //   不抄**静态**关系是对的，但**玩出来的关系不是书的副本**（书里没有、账上也没有，无处可查）。
        //   ★★**"必带因"是本机制的结构脊梁**（细案 §2.3）：每条边必须指得出账上真有的那件事 ⇒
        //     ① 书里的静态关系**指不出账上的事** ⇒ **结构上写不进这张表**（leg24 的决定被形状保住，不靠自律）；
        //     ② 指不到就**不落账**，不许编默认因、不许把 tick 填 0 冒充（leg118 刚踩过这个坑）；
        //     ③ **它顺带就是额度**——关系不能凭空长，产率被世界的因果产量天然卡住
        //        （用户 2026-09-23 拍板：**不另设上限**；本仓为"没量过的上限当家"流过血，见 `entityUpdates ≤3`）。
        //   ★`type` 是**模型的原话**（自由文本，**提示词不给菜单**——给了菜单就是用词表判语义，§4.8 禁用清单）。
        //   ★**可选组**（与 `entityUpdates`/`lookupScales`/`eventClosures` 同一条口径）：缺席 = 本轮不提议，
        //     **不是形状错误**——既有 ~110 处夹具与历史快照都没有这一组，强行必填会一次性砸掉且无收益。
        //   ★复核与落账归引擎（`check-step` 判两端在册 + 因在账；`settle` 发号 `rel_<轮次>_<第几条>` 并盖 tick）。
        relationUpdates: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['from', 'to', 'type', 'cause'],
                props: {
                    from: { kind: 'string', minLength: 1 },   // 照抄输入实体 id（谁）
                    to: { kind: 'string', minLength: 1 },     // 照抄输入实体 id（对谁）
                    type: { kind: 'string', minLength: 1 },   // ★模型的原话（"结下死仇"/"欠他一条命"）——不预设词表
                    // ★`cause` = 「玩出来的关系」与「抄书/随口编」的**唯一分界**（与 `entityUpdates.cause` 同格）：
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
                    note: { kind: 'string' },                 // 一句话：这次事件让它怎么变了
                },
            },
        },
        // ★★★leg120（A3）：**了结一条边**（人情还了 / 仇解了）——与 `agendaCancels`/`eventClosures` 同构。
        //   ★**必须引引擎发的 `id`，不许靠 `type` 文本认边**：`type` 是模型的原话，它这轮写"死仇"、
        //     下轮写"深仇"，引擎**不许去猜这是不是同一条边**（leg95 定过：引擎负责"这单结没结清"、
        //     模型负责"这故事还要不要往下讲"，两个角色不许互相替）。
        //   ★**只认已落账的边**（照 `entityFates` 那条"覆灭要尘埃落定"的口径，**不享用同轮按位次解析**）
        //     ⇒ 本轮刚建的边本轮不能了结——省掉整套同轮引用解析，且语义更对（见细案 §7 的更正一节）。
        //   ★**可选组**：缺席 = 本轮不了结任何关系，**不是形状错误**。
        relationClosures: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['id'],
                props: {
                    id: { kind: 'string', minLength: 1 },     // 照抄输入里那条边的 id（引擎发的 rel_<轮次>_<第几条>）
                    why: { kind: 'string' },                  // 一句话：为什么这条关系不再算数了（进编年）
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
        // ★★★leg128（用户令「把整个链路打通，包含多因点」· 设计 `docs/spec-context-master.md` §4.3）：
        //   **点名要一条"故事线"的经过**——与 `lookupScales` **同构、同一条生命周期**
        //   （点名 → 净化 → 下一轮整取 → 用完即消失，不跨轮囤积）。
        //   写法：照抄输入里「故事线」那一栏**行首那个根 id**（`ev_<轮>_<位次>`）。
        //   ★复核归引擎（`check-step.js` 那道净化）：**只收这一轮真递出去的那一批线里的根**——
        //     编的、或者不在本栏里的，一律拒（"无源之物不入局"那条红线的通道版）。
        //   ★它换来什么：那一栏是**地图**（一行一条：头 → N 件 → 尾），点到哪一条，
        //     下一轮就把**那一条的经过**（逐件、按因果序、账上原文，太长则头尾各留并如实记"略"）递进来。
        lookupLines: {
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
                    // ★★★leg128（用户令「把整个链路打通，包含多因点」· 设计 `docs/spec-context-master.md`）：
                    //   **多因**——这件事是哪几件**共同**促成的（除主因之外的那几条）。
                    //   病（**结构上的**，不是实现上的）：`source` 是**单个对象**（`additional:false`）
                    //     ⇒ "好几件因促成一件新事"**根本写不出来**：账上只留得下其中一条，
                    //     另外几条只活在标题那句话里 ⇒ 读的时候也认不出来（"猜出来的结构不算结构"）。
                    //   落法（★两个指针**分工**，各管一件事；承重墙③"边永远单亲"不破）：
                    //     · `source`   ＝ **来路**，**永远单亲** ⇒ 管"划分"（这件事属于哪条线）；
                    //     · `links.up` ＝ **合流**，**可以多条** ⇒ 管"多因"。
                    //   引擎落账时把这里这几条并进 `links.up`（与 ripple 主因**同一张合流表**；
                    //     ★`plot` 型的主因是盘算、不进那张表——既有口径，不动它），
                    //     见 `settle.js` 的 `hangEvents`
                    //     ⇒ **多因点 = `links.up` 长度 ≥ 2 的节点**：可判、可查、**不参与划分**（森林照样互不相交）。
                    //   ★口径三条：① **可选**（缺席＝这一件只有一条因，最常见的那一支）；
                    //     ② 只收**账上真有的**事件 id（**本轮新建的也算**，走"按位次解析"那条老路）；
                    //     ③ ★**对不上的那条因丢掉它、不丢整步**——它是附加信息，不是承重信息
                    //        （"一条写歪陪葬整轮"是本仓花过代价的坑，见 `sanitize-step.js` 头注）。
                    alsoCausedBy: { kind: 'array', items: { kind: 'string', minLength: 1 } },
                    // ★★★leg137（用户令：「**只要告诉时间流逝的长度和起始，事件的时间字段就由 llm 自己写**
                    //   要不然所有事件都是同一时刻发生的了**」）：**这一件事发生在什么时候**。
                    //   病（用户当场指出、账上可证）：一轮里能起十几件事（真账设 `每轮事件=12`），
                    //     而这一格不存在 ⇒ 引擎只能拿**一个时刻盖满全场** ⇒ 那十几件事在账上
                    //     **变成同时发生的**——时间被抹平了。
                    //   治法：把"什么时候"这一格**交给写事的人**。引擎只把尺子递过去
                    //     （账上最后一个已知时间点 ＋ 这一轮的时长，见包里那一栏），**不替它猜**。
                    //   ★口径三条（与聊天侧 `【此刻】` → `timeMark` **同一条**，一个字不改）：
                    //     ① **逐字照抄**：引擎不校验、不解析、不比较、不推算（红线 §2.2 第 1 条：
                    //        不许把书里的词换算成数——时间也归这条管）；
                    //     ② **可省**：写不出（这一局没有时间轴、或这一件事说不清什么时候）⇒ **不写**，
                    //        那一格就不出现（红线 2：空着就是空着，**绝不填占位值冒充**）；
                    //     ③ ★**对不上不丢整步**：它是附加信息，不是承重信息（同 `alsoCausedBy` 那条口径）。
                    at: { kind: 'string', minLength: 1 },
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
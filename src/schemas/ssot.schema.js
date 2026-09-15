// story-world-v2/src/schemas/ssot.schema.js
// SSOT（世界状态）JSON Schema —— 一份 JSON：实体 + 分量缓存 + Agenda 池 + 事件链（ANCHOR §3①）。
// 形状规则对应 ANCHOR §4.2（事件源三类）/§4.5（盘算三必须）。语义校验（位置 ∈ 世界状态等）归引擎。

export const ssotSchema = {
    kind: 'object',
    additional: false,
    required: ['version', 'context', 'entities', 'weights', 'agendas', 'events', 'chronicle', 'meta'],
    props: {
        version: { kind: 'number', int: true, min: 1 },
        context: {
            kind: 'object',
            additional: false,
            required: ['world', 'tension', 'positions'],
            props: {
                world: { kind: 'string', minLength: 1 },
                tension: { kind: 'number' },               // 静态张力常量（切片）；已并入 setting.dynamic.tension.intensity（大势层细案 §3.7 兼容保留）
                positions: { kind: 'array', minItems: 1, items: { kind: 'string', minLength: 1 } },
                playerId: { kind: 'string', minLength: 1 },   // K8：玩家棋子标注（可选；缺省=旁观世界合法形态）
                setting: {   // K24/大势层：设定池（全可选——旧世界缺省合法，A-1 兼容断言；细案 §3.1/§3.3）
                    kind: 'object',
                    additional: false,
                    props: {
                        frozen: {   // 冻结层：世界书提取产物（书指纹不变不重抽，K26；引擎只读）
                            kind: 'object',
                            additional: false,
                            required: ['fingerprint', 'extractedAt', 'canon'],
                            props: {
                                fingerprint: { kind: 'string', minLength: 1 },
                                extractedAt: { kind: 'string', minLength: 1 },
                                canon: {   // 形状 = v1 abstractCanon 五件套（附录 A；无数量/长度约束，2026-08-28 口径）
                                    kind: 'object',
                                    additional: false,
                                    required: ['powerScale', 'rules', 'society', 'techOrMagic', 'historyNotes'],
                                    props: {
                                        powerScale: {
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['level', 'note'],
                                                props: {
                                                    level: { kind: 'string' },   // 档位名（原文）
                                                    note: { kind: 'string' },    // 该档意味着什么（原文/极简）
                                                },
                                            },
                                        },
                                        rules: { kind: 'array', items: { kind: 'string' } },
                                        society: { kind: 'string' },
                                        techOrMagic: { kind: 'string' },
                                        historyNotes: { kind: 'array', items: { kind: 'string' } },
                                        situation: { kind: 'string' },   // leg20 世情路径：当前天下大势一句（原文措辞；可选=旧世界零扰动）
                                        bookEntities: {   // K37 书名录（生通道①：书内名号实体，可选=旧世界零扰动）；第十九棒：kind 增 location（地名不入池）+ parent（书中明述的上级/所属，从属方单存）
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['name'],
                                                props: {
                                                    name: { kind: 'string', minLength: 1 },
                                                    // ★leg25 g：**别名**（书里对同一实体的其他叫法）。
                                                    //   为什么必须有这个键：实体页/归属按 `name` 精确查册，而书里同一个势力
                                                    //   常有多个叫法（条目名 `人族皇朝`、key 里的 `大虞`/`大虞皇朝`）——
                                                    //   模型分块抽取时**每块只能看到自己那块**，跨块的别名无从归一，
                                                    //   块间合并又只按 `name` 判重（`abstract.js` 的 bookNames/mergeCleaned）
                                                    //   ⇒ 同一个势力被收成多条、各自都没成员（真账 152 个势力里 108 个空壳）。
                                                    //   有了 aliases，块间合并就能按"名字 ∪ 别名"判重 ⇒ 别名不再长成新实体。
                                                    //   纪律：**照抄书里的叫法**（不换算、不发明）；可省（旧世界零扰动）。
                                                    aliases: { kind: 'array', items: { kind: 'string', minLength: 1 } },
                                                    kind: { kind: 'string', enum: ['faction', 'character', 'location'] },
                                                    parent: { kind: 'string', minLength: 1 },
                                                    location: { kind: 'string', minLength: 1 },   // leg21 补形状（此前 sanitizeCanon/关系轮已写、实体页已用，形状层漏登记 → 名册一律校验不过）；书中明述的所在/驻地
                                                    race: { kind: 'string', minLength: 1 },   // leg20：种族归属标签（书级出处校验后保留；可选）
                                                    // leg25 c：书名录条目的 `attrs` / `evidence`（leg20 的"从书里抄四维数值+原文依据"）
                                                    //   **整条删除**。书里这一维到底写没写数值，已无人判读——"四维不存在"了，
                                                    //   连"书里明写这一维"这个判据本身也失去了对象（见 settle.js 迁移注释）。
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                        dynamic: {   // 演化层：引擎小步推、事件可改、模型不可改（K27/K29）
                            kind: 'object',
                            additional: false,
                            required: ['tension'],
                            props: {
                                tension: {   // 结构性张力三件（极/方向/强度；ANCHOR §4.6①）
                                    kind: 'object',
                                    additional: false,
                                    required: ['polarity', 'intensity'],
                                    props: {
                                        polarity: { kind: 'string', minLength: 1 },   // 极（原文溯源；无主=大势未聚的合法态，表示法 K29 曲线定）
                                        direction: { kind: 'string' },   // 当前方向（谁压谁；缺省/空串=僵持）
                                        intensity: { kind: 'number', min: 0, max: 1 },   // 强度 0..1（引擎确定性计算，模型不拍）
                                    },
                                },
                                env: { kind: 'strRecord' },   // leg26：世界参数**档位原话**（民生度/动乱度/天时/张力推手 → 档位词）；玩家可选、引擎照抄、不读不做判断。旧账里的数值由载入净化丢弃
                                derivedFrom: { kind: 'array', items: { kind: 'string' } },   // 派生源引用（书条目/事件 id/浪尖盘算 id）
                            },
                        },
                    },
                },
            },
        },
        entities: {
            kind: 'array',
            minItems: 1,
            items: {
                kind: 'object',
                // ★★leg34（用户拍板「可以。那就按你说的来」⇒ 丙′ 案）：**实体放开额外字段**（原为 `additional: false`）。
                //   为什么必须放（**不是图省事**）：剧情要改的东西**根本不在下面那张表里**——
                //     世界上真正会变的是「称号 / 性情 / 心境 / 伤势 / 归属」这类，而表里的 19 个键是
                //     **"从书里抽出来时恰好有哪些栏"**。拿抽取清单当**创作边界**，等于用"抄书抄到哪"限制"故事怎么长"。
                //   ★代价与边界（三条，缺一条这次改动就是错的）：
                //     ①**已知字段仍然强校验**——`schema.js:23` 先查 `props[k]`，命中就走子 schema
                //       （`kind` 枚举、`status` 枚举、`lastActiveTick` 整数…**一个都没松**）；`additional` 只管"未知键"。
                //     ②**谁能写**仍由 `check-step` 的 `ENTITY_IMMUTABLE_FIELDS` 管（7 个禁写：主键/类型/身份锚/
                //       生死（有专用通道）/引擎簿记/出处发票）⇒ 这条放开**不等于**"模型想写什么都行"。
                //     ③**出处不因此失控**：模型写值 ⇒ 引擎在 `meta.entityFields` 追加变更记录（含原值），
                //       而 `fieldSource` 那类发票仍由引擎写 ⇒ "原话不会丢"是机械保证，不靠模型守约。
                //   ★★但放开"未知键"会把**已删除的旧字段**一起放回来（本棒实测：`attrs` 那 3 条用例当场红）——
                //     而 leg25 c 立的规矩是"**删字段只删一半最危险**：引擎不写、契约仍收 = 看起来删了其实没有"。
                //     ⇒ 故配一份**显式拒收名单**（已退休字段）：`additional` 管"没见过的键"，这份管"见过但已废的键"。
                //       `attrs`（四维浮点：兵力/权位/人脉/耳目，用户令「删」）——手拍值让"编的"看起来像"算的"。
                additional: true,
                denied: ['attrs'],
                required: ['id', 'kind', 'name', 'location'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    kind: { kind: 'string', enum: ['faction', 'character'] },
                    name: { kind: 'string', minLength: 1 },
                    location: { kind: 'string', minLength: 1 },   // 驻点必须 ∈ context.positions（引擎校验 §3.2）
                    // leg25 c（用户令「删」）：实体 `attrs`（四维浮点：兵力/权位/人脉/耳目）**整条删除**。
                    //   为什么：这几个概念**没法精确表示**（书里没刻度、现实里也没有），压成 0–1 是拿精确外壳
                    //   装模糊内容；且手拍值让"编的"看起来像"算的"（design-core-leg23 §4 第 1 条）。
                    //   书里的说法一律**照抄成文本**（实体 `实力` = 「T9渡劫巅峰」，据书；见 spec-entity-field-lookup），
                    //   引擎不换算、不进公式、不排序、不比较。
                    //   ⚠️ 旧账残留：`migrateLegacyAttrs` 在 loadWorld 时一次性摘除；引擎各处的 `e.attrs?.x` 守卫
                    //   本就吃掉"字段不存在"，且校验本身不读它 ⇒ 不会因残留而拒。本键**不再接受**，防无声复活
                    //   （实测教训：删字段只删一半最危险——引擎不写、契约仍收，看起来删了其实没有）。
                    race: { kind: 'string', minLength: 1 },   // leg20：种族标签（抽象带入；可选=旧世界零扰动）
                    lastActiveTick: { kind: 'number', int: true, min: 0 },   // K3 静止衰减记账（活跃落账方记当前 tick）
                    // leg25 f（用户拍板「X1 认账简化」）：`hurtWindow` 键**已删除**。
                    //   它是 K15「败露」判据的输入（近 2 tick 负向 δ），而该判据随四维属性失去来源
                    //   （字段全仓无写入方、真账 563 实体里 0 个有它）⇒ 判据不可达、键成死字段。
                    //   与其留着让人以为还有"伤害窗口"，不如连键一起摘掉（旧账残留由
                    //   `migrateLegacyAttrs` 在载入时无条件摘除，见 settle.js）。
                    //   依据：`docs/spec-failure-verdict-and-visibility.md` §2。
                    status: { kind: 'string', enum: ['active', 'retired', 'dead'] },   // K37/实体治理 §3.7 状态契约（可选=缺省 active；旧世界零扰动）；dead=终局不复归；retired=可复归
                    parent: { kind: 'string', minLength: 1 },   // 第十九棒/C7：从属方单存——character→所属势力/分支名，faction→上级势力名（书中明述；可选=旧世界零扰动）
                    branches: { kind: 'array', items: { kind: 'string', minLength: 1 } },   // 第十九棒/C8：势力实体分支表（子势力名号平铺；可选=旧世界零扰动）
                    organs: { kind: 'array', items: { kind: 'string', minLength: 1 } },     // leg23：势力实体名下机构/部门（书里明述、但不作为独立棋手入池的名号；可选=旧世界零扰动）
                    // 细案 spec-entity-field-lookup（用户 2026-09-11 批准）：**按需查书补字段**的落点。
                    //   实力 = **文本**（不是分档枚举）：分段境界的书抄档位原话（T9渡劫巅峰），不分段的书抄它
                    //     自己的写法（剑术通神/三万铁骑）；只有**角色**有这一栏（势力不写实力——用户拍板，
                    //     势力的实力在面板上用麾下成员派生显示）。引擎**不读**它：不进分量/掩码/裁定/镜头。
                    //   可选键（旧世界零扰动）；键名用中文与 v1 字段/界面标签一致（账本已有中文键先例 ENV_KEYS）。
                    实力: { kind: 'string', minLength: 1 },
                    //   位置沿用既有英文键 location（账本里已有，不改旧名）：查书补的是"书里明述的所在"。
                    // 第二十五棒 e（用户令「按 v1 那样把所有的东西都初步建立好」）：照书抄的属性与关联的**来源留痕**。
                    //   与查书那条路的 `meta.entityFields[id].位置来源` 同性质（来源分账 + 外显「（推）」），
                    //   但这里挂在实体上——因为它是**初始化就定下来**的账，不随查书步骤改写。
                    //   引擎**不读**它们（不进分量/掩码/裁定/镜头）；只有渲染层/pack 用来标来源。
                    fieldSource: { kind: 'object', additional: true, props: {} },   // 字段名 → '书里原话'（逐字段）
                    parentSource: { kind: 'string', minLength: 1 },                 // 归属来源：照书办 / 模型抽取 / 模型抽取(未验证) / 结构推导
                    parentSourceFrom: { kind: 'string', minLength: 1 },             // 证据类型：member-line / key-list / explicit / tag / unverifiable / 成员行@XX
                    规模: { kind: 'string', minLength: 1 },   // 势力自己的规模/性质**原话**（书的势力标签/底蕴行；≠ 角色档位）
                    性质: { kind: 'string', minLength: 1 },   // 势力性质原话（如「正道仙门魁首」）——文本，引擎不读
                    倾向: { kind: 'string', minLength: 1 },   // 势力倾向原话——文本，引擎不读
                    身份: { kind: 'string', minLength: 1 },   // 书里明述的身份（如「现任盟主」）——文本原话，引擎不读
                    定位: { kind: 'string', minLength: 1 },   // 书里明述的角色定位——文本原话，引擎不读
                },
            },
        },
        weights: { kind: 'numRecord' },   // 分量缓存（切片期常量占位）
        agendas: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['id', 'owner', 'goal', 'stage', 'visibility', 'maxSteps', 'progress', 'memory'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    owner: { kind: 'string', minLength: 1 },                       // 必须有主（§4.5）
                    goal: { kind: 'string', minLength: 1 },
                    stage: { kind: 'string', minLength: 1 },
                    visibility: { kind: 'string', enum: ['known', 'concealed'] },  // 暗处可以有人（§3④）
                    parentId: { kind: 'string', minLength: 1 },   // K13/盘算树：父盘算 id（可选——顶层盘算无父；深链合法）
                    // ★leg29（N3 落地）：**出生理由落账**。此前 `newAgendas[].source` 只在出生时被校验，
                    //   落账时只留 `parentId`（event/state 两种源当场丢弃）⇒ 引擎事后说不清一条盘算怎么来的。
                    //   形状与**事件源同构**（三型 plot/state/ripple 的亲戚：event/parent/state），可选=旧世界零扰动。
                    source: {
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['event', 'parent', 'state'] },   // 与 world-step 的 newAgendas[].source.type 同枚举
                            ref: { kind: 'string', minLength: 1 },     // event=未决事件 id；parent=盘算 id；state 不带
                        },
                    },
                    branch: { kind: 'string', minLength: 1 },   // 第十九棒/C8：分支身份链（子势力名；owner 仍是父实体；可选=旧世界零扰动）
                    maxSteps: { kind: 'number', int: true, min: 1 },                // 必须能在世界时间里结算（§4.5）
                    progress: { kind: 'number', int: true, min: 0 },
                    closed: { kind: 'boolean' },    // 满步强制结算后置真（S5，终结产果 §4.4④）
                    memory: {
                        kind: 'object',
                        additional: false,
                        required: ['promises', 'done', 'blocked', 'turnsAlive'],
                        props: {
                            promises: { kind: 'array', items: { kind: 'string' } },
                            done: { kind: 'array', items: { kind: 'string' } },
                            blocked: { kind: 'array', items: { kind: 'string' } },
                            turnsAlive: { kind: 'number', int: true, min: 0 },
                        },
                    },
                },
            },
        },
        events: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['id', 'title', 'source', 'position'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    title: { kind: 'string', minLength: 1 },
                    source: {                                                      // 无源事件引擎拒绝（§4.2）
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            type: { kind: 'string', enum: ['plot', 'state', 'ripple'] },
                            ref: { kind: 'string' },    // ripple→上游事件 id；plot/state→出处（可选）
                        },
                    },
                    position: { kind: 'string', minLength: 1 },
                    ripples: { kind: 'array', items: { kind: 'string' } },
                    links: {
                        kind: 'object',
                        additional: false,
                        props: {
                            up: { kind: 'array', items: { kind: 'string' } },
                            down: { kind: 'array', items: { kind: 'string' } },
                        },
                    },
                    closed: { kind: 'boolean' },
                    closedAt: { kind: 'number', int: true, min: 0 },   // K18/因果链 T1/T3：闭环落账 tick（源结清/链尾结清时写；归档判龄用；历史闭环无此字段视为可直接归档）
                },
            },
        },
        milestones: {   // K18/因果链 T3：温层里程碑（可选——缺省=旧世界合法形态；引擎结构摘要，链上节点，ids 保回溯）
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['id', 'span', 'counts', 'titles', 'ids', 'links'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    span: {
                        kind: 'object',
                        additional: false,
                        required: ['from', 'to'],
                        props: {
                            from: { kind: 'number', int: true, min: 0 },
                            to: { kind: 'number', int: true, min: 0 },
                        },
                    },
                    counts: { kind: 'numRecord' },
                    titles: { kind: 'array', items: { kind: 'string' } },
                    ids: { kind: 'array', items: { kind: 'string' } },
                    links: {
                        kind: 'object',
                        additional: false,
                        props: {
                            up: { kind: 'array', items: { kind: 'string' } },
                            down: { kind: 'array', items: { kind: 'string' } },
                        },
                    },
                },
            },
        },
        chronicle: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['id', 'tick', 'text'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    tick: { kind: 'number', int: true, min: 0 },
                    text: { kind: 'string', minLength: 1 },   // 编年 = 可见的因果链（§3⑤）
                    kind: { kind: 'string', enum: ['scheme', 'major', 'ripple', 'shade', 'state'] },   // K39/链视图细案 §3.1：编年行类型章（五筛用；可选=旧行零扰动）
                    eventRef: { kind: 'string' },
                    chainRef: { kind: 'string' },   // 第十五棒补（K39 修正后拍板）：闭环/涟漪平息行的链目标事件 id——纯链入口数据，注入面（streams 只读 eventRef）语义分离；可选=旧行零扰动
                },
            },
        },
        meta: {
            kind: 'object',
            additional: false,
            required: ['tick'],
            props: {
                tick: { kind: 'number', int: true, min: 0 },
                dialogueBook: {   // K37/实体治理 §3.7 对话依据册：{ 对象名: {count, lastTick} }（可选；动态键 map——引擎记账保证内层形状，schema 只查整体为对象）
                    kind: 'object',
                    additional: true,
                    props: {},
                },
                // leg25 c：`playerParse`（K32 溯源账）**整条删除**——它记的是"哪些 attrs 键由解析注入"，
                //   而玩家四维注入与解析两个模块（player-inject/player-setup）已随四维一并删除。
                // leg25 c（旧账清理·迁移留档）：migrateLegacyAttrs 一次性摘除 `entity.attrs` 时写这两个字段。
                //   legacyAttrsPurged = { [entityId]: { [attr]: 删掉的值 } }（那些数曾经摆在面板上冒充客观，
                //     摘掉时不许无声消失——留档给审计）；形状为动态键 map（内层由迁移函数保证）。
                //   attrsRemovedAt    = 一次性标记（当时 tick）；幂等闸——有此键即不再重扫。
                // ⚠️ 实测补漏（子代理报回，2026-09-11）：本块原先只声明了 leg24 的 legacyAttrsMigratedAt，
                //   而迁移函数已改用 attrsRemovedAt ⇒ 迁移产出的世界**过不了自家 schema**（additional:false）。
                //   两个键一起留着：旧世界可能已带 legacyAttrsMigratedAt（leg24 那版写下的），删它会打破旧账。
                legacyAttrsPurged: { kind: 'object', additional: true, props: {} },
                legacyAttrsMigratedAt: { kind: 'number' },
                attrsRemovedAt: { kind: 'number' },
                // 细案 spec-entity-field-lookup §2：按需查书的**查书标记留痕**（有值 / 未查 / 未加载到 / 书未明述）。
                //   entityFields = { [entityId]: { fields, attempts, sources } }
                //     fields[字段]   = { value, from（查过的书条目名）, fetchedAt }        —— 只记**真落账**的值
                //     attempts[字段] = { count, lastTriedAt, state: 'ok'|'pending'|'absent' }
                //       ★ pending = "模型没给这一栏"（可能只是漏抽）——**绝不用空值反推"书里没有"**；
                //         absent 只在**引擎**确认"书里没有任何相关条目"时才允许记。
                //     sources        = 查过哪几条世界书条目（审计用；防"无声地查了个寂寞"）
                //   entityLookup = { fails, lastFailAt, disabledUntil } —— 连续失败熔断（世界推进优先）
                //   形状为动态键 map（内层由 entity-lookup.js 保证，schema 只查整体对象——同 legacyAttrsPurged 口径）。
                entityFields: { kind: 'object', additional: true, props: {} },
                entityLookup: {
                    kind: 'object',
                    additional: false,
                    props: {
                        fails: { kind: 'number', int: true, min: 0 },
                        lastFailAt: { kind: 'number', int: true, min: 0 },
                        disabledUntil: { kind: 'number', int: true, min: 0 },
                    },
                },
                simLog: {   // 逐轮模拟台账（长跑防线细案 §2.5 四字段 + 警告）
                    kind: 'array',
                    items: {
                        kind: 'object',
                        additional: false,
                        required: ['tick'],
                        props: {
                            tick: { kind: 'number', int: true, min: 0 },
                            packTokens: { kind: 'number', int: true, min: 0 },
                            ssotBytes: { kind: 'number', int: true, min: 0 },
                            events: { kind: 'number', int: true, min: 0 },
                            chronicle: { kind: 'number', int: true, min: 0 },
                            calls: { kind: 'number', int: true, min: 0 },
                            warnings: { kind: 'array', items: { kind: 'string' } },
                            proposals: { kind: 'number', int: true, min: 0 },   // K38 观测台：本 tick 提议条数（拒签率分母；可选=旧账零扰动）
                            rejected: { kind: 'number', int: true, min: 0 },    // K38 观测台：本 tick 拒签条数（静默滤除+裁定拒；分子）
                            silent: { kind: 'array', items: { kind: 'string' } },        // K2 门控审计：静默方
                            lifted: { kind: 'array', items: { kind: 'string' } },        // K2 门控审计：触发例外应答方
                            silentDropped: { kind: 'numRecord' },                        // K2 门控审计：id → 滤除条数
                            playerAffected: {   // K9 审计：影响通道条目（引擎独占写玩家，模型不可写）
                                kind: 'array',
                                items: {
                                    kind: 'object',
                                    additional: false,
                                    // leg24 片3：`ratio` 由必填改**可选**——它记的是"分量比折减系数"，
                                    //   那个数已随"引擎不裁胜负"退场；旧账里的历史条目仍有该键（照旧合法=零扰动）。
                                    required: ['tick', 'source', 'attr', 'delta'],
                                    props: {
                                        tick: { kind: 'number', int: true, min: 0 },
                                        source: { kind: 'string', minLength: 1 },
                                        attr: { kind: 'string', minLength: 1 },
                                        delta: { kind: 'number' },
                                        ratio: { kind: 'number' },   // 旧账遗留（新条目不再写）
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
};
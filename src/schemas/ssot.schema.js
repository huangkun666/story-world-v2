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
                                                    kind: { kind: 'string', enum: ['faction', 'character', 'location'] },
                                                    parent: { kind: 'string', minLength: 1 },
                                                    location: { kind: 'string', minLength: 1 },   // leg21 补形状（此前 sanitizeCanon/关系轮已写、实体页已用，形状层漏登记 → 名册一律校验不过）；书中明述的所在/驻地
                                                    race: { kind: 'string', minLength: 1 },   // leg20：种族归属标签（书级出处校验后保留；可选）
                                                    attrs: { kind: 'numRecord' },            // leg20：四维属性（净化钳制 [0,1]；可选）
                                                    evidence: { kind: 'string', minLength: 1 },   // leg20：属性原文依据短句（随 attrs 保留；可选）
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
                                env: { kind: 'numRecord' },   // 环境量键值（引擎推演域；越阈值→状态驱动事件，K27 熵泵）
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
                additional: false,
                required: ['id', 'kind', 'name', 'location'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    kind: { kind: 'string', enum: ['faction', 'character'] },
                    name: { kind: 'string', minLength: 1 },
                    location: { kind: 'string', minLength: 1 },   // 驻点必须 ∈ context.positions（引擎校验 §3.2）
                    // leg24 片2（账本换血）：attrs 由**必填改可选**——账面无数是合法状态（"空着就是空着"）。
                    //   引擎不再预填默认值；键只在模型提议（settle 钳制落账）后才存在。
                    attrs: { kind: 'numRecord' },                 // 硬实力/职权/人脉/情报（有据才在账；分量公式无数时取中立 floor）
                    race: { kind: 'string', minLength: 1 },   // leg20：种族标签（抽象带入；可选=旧世界零扰动）
                    lastActiveTick: { kind: 'number', int: true, min: 0 },   // K3 静止衰减记账（活跃落账方记当前 tick）
                    hurtWindow: { kind: 'array', minItems: 2, maxItems: 2, items: { kind: 'number' } },   // K15：近 2 tick 负向 δ 窗口 [本 tick, 上一 tick]（三态判据用；惰性写——全 0 删字段）
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
                playerParse: {   // K32 溯源账：由解析注入的 attrs 键（force 重解析只覆盖此集的键；手填键永不触碰）
                    kind: 'object',
                    additional: false,
                    required: ['injected'],
                    props: {
                        injected: { kind: 'array', items: { kind: 'string' } },
                    },
                },
                // leg24 片4（旧账清理·迁移留档）：migrateLegacyAttrs 一次性的两个 meta 字段。
                //   legacyAttrsPurged      = { [entityId]: { [attr]: 删掉的值 } }（被批掉的假数不许无声消失）
                //   legacyAttrsMigratedAt  = 一次性标记（当时 tick）；幂等闸——有此键即不再重扫。
                // 形状：动态键 map（内层形状由迁移函数保证，schema 只查整体为对象——同 dialogueBook 口径）；
                //   两个字段都可选（旧世界零扰动）。
                legacyAttrsPurged: { kind: 'object', additional: true, props: {} },
                legacyAttrsMigratedAt: { kind: 'number' },
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
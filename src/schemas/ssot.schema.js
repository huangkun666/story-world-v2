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
                                        bookEntities: {   // K37 书名录（生通道①：书内名号实体，可选=旧世界零扰动）
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['name'],
                                                props: {
                                                    name: { kind: 'string', minLength: 1 },
                                                    kind: { kind: 'string', enum: ['faction', 'character'] },
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
                required: ['id', 'kind', 'name', 'location', 'attrs'],
                props: {
                    id: { kind: 'string', minLength: 1 },
                    kind: { kind: 'string', enum: ['faction', 'character'] },
                    name: { kind: 'string', minLength: 1 },
                    location: { kind: 'string', minLength: 1 },   // 驻点必须 ∈ context.positions（引擎校验 §3.2）
                    attrs: { kind: 'numRecord' },                 // 硬实力/职权/人脉/情报（分量公式后续）
                    lastActiveTick: { kind: 'number', int: true, min: 0 },   // K3 静止衰减记账（活跃落账方记当前 tick）
                    hurtWindow: { kind: 'array', minItems: 2, maxItems: 2, items: { kind: 'number' } },   // K15：近 2 tick 负向 δ 窗口 [本 tick, 上一 tick]（三态判据用；惰性写——全 0 删字段）
                    status: { kind: 'string', enum: ['active', 'retired', 'dead'] },   // K37/实体治理 §3.7 状态契约（可选=缺省 active；旧世界零扰动）；dead=终局不复归；retired=可复归
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
                                    required: ['tick', 'source', 'attr', 'delta', 'ratio'],
                                    props: {
                                        tick: { kind: 'number', int: true, min: 0 },
                                        source: { kind: 'string', minLength: 1 },
                                        attr: { kind: 'string', minLength: 1 },
                                        delta: { kind: 'number' },
                                        ratio: { kind: 'number' },
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
// story-world-v2/src/schemas/ssot.schema.js
// SSOT（世界状态）JSON Schema —— 一份 JSON：实体 + 分量缓存 + Agenda 池 + 事件链（ANCHOR §3①）。
// 形状规则对应 ANCHOR §4.2（事件源三类）/§4.5（盘算三必须）。语义校验（位置 ∈ 世界状态等）归引擎。

import {geographySchema} from './geography.schema.js';

export const ssotSchema = {
    kind: 'object',
    additional: false,
    required: ['version', 'context', 'entities', 'weights', 'agendas', 'events', 'chronicle', 'meta'],
    props: {
        version: { kind: 'number', int: true, min: 1 },
        // ★★leg155：**卷号计数器**——`rotateChronicle`（`src/storage.js`）每次把编年的旧段落成卷时，
        //   都会在被留下的那份世界上写 `nextVolume = 本卷号 + 1`；而那一份**就是热账**。
        //   ★为什么以前没人发现：**它只在长局里出现**——编年没到轮转那一步（跨度/字节两条线都没过）
        //     就一个字都不写 ⇒ 四份真账（最长那份 tick 59）一份都没照到它。
        //     本笔拿 leg153 那份 400 轮长账跑真机验收时才浮出来（那一刻账上已经 249 卷）。
        //   ⚠**如实登记一处不对劲**（本笔只登记、不动流程）：同一个数目前**有两个家**——
        //     ① 世界里这一格（本格）；② `hotAccountShape` 又把它挂到热账**外层**（`storage.js:36`，
        //     那里的注释本意正是"挂世界之外、不混进 SSOT schema"）。而 `rotateChronicle` 写的是世界内那一份，
        //     于是 `hotAccountShape` 存的 `world` 里**照样带着它**（`applied` 就是从它来的）。
        //   ⇒ 要不要收成一处（把世界面那一份剥掉）**属另一件活**，归用户拍板：那一格是"卷号不回头覆盖"
        //     的凭据（E1 那次修复的落点），动它前先想清楚卷库写失败那条路（`planChronicleRotation` 的
        //     `hot`/`applied` 分工，见 `storage.js:109`）。
        nextVolume: { kind: 'number', int: true, min: 1 },   // 可选（没轮转过的账没有这一格）
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
                                // ★leg60（交接第 3 件）：**编译完整性读数**——"书里有多少条设定类条目 /
                                //   本次编译覆盖了多少 / 声明面读了多少、漏了多少"。全是数字与计数（无散文），
                                //   落账的目的是"以后哪个体系没抽出来，不用再靠翻磁盘对账"。
                                //   可选键（旧世界零扰动：老账没有这个键照样过校验）。
                                compile: {
                                    kind: 'object',
                                    additional: false,
                                    props: {
                                        entries: { kind: 'number' },
                                        enabled: { kind: 'number' },
                                        disabled: { kind: 'number' },
                                        disabledChars: { kind: 'number' },
                                        shells: { kind: 'number' },
                                        constShells: { kind: 'number' },
                                        declared: { kind: 'number' },
                                        declaredChars: { kind: 'number' },
                                        picked: { kind: 'number' },
                                        pickedChars: { kind: 'number' },
                                        declaredDropped: { kind: 'number' },
                                        skipped: { kind: 'number' },
                                        skippedChars: { kind: 'number' },
                                        titleNames: { kind: 'number' },
                                        settingTitles: { kind: 'number' },
                                        settingCompiled: { kind: 'number' },
                                    },
                                },
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
                                                    // ★★leg155：**`axis` = 旧账遗留（引擎已经不再写它）**。
                                                    //   真相（本笔在四份真账上逐条数出来的）：账上 463 条 `axis`
                                                    //   **全是空串**（三国 93 · 实教 31 · 大荒z-09-29 339，有值 0 条）——
                                                    //   根因是 `mergeSameTierEntries` 把内部去重键漏进了产出，本笔已在
                                                    //   产出那一侧堵掉（那条路走 `scalesToFlat`）。
                                                    //   为什么还在这里登记：**老账里已经躺着的那一批不许因为"引擎不再写"
                                                    //     就变得不合法**（照 `ratio` 那格的先例：`旧账遗留（新条目不再写）`）。
                                                    //   ★它与"档位去重键 `axis`"同名不同命：这里只保证"是字符串"，
                                                    //     引擎既不读它、也不拿它做判断（红线一：不换算、不进公式）。
                                                    axis: { kind: 'string' },
                                                },
                                            },
                                        },
                                        // ★★leg60：**维度与刻度**（"书里的尺子"）——照抄原文，引擎不换算、不进公式。
                                        //   来源：三国 `[mvu_update]变量更新规则` 的 `属性.${勇武|韬略|内政|统御|气度|健康}: range: -100~100`
                                        //   与 `演义战力体系` 的 `核心属性: 勇武/统御 各 0-100`。
                                        //   可选键（旧世界零扰动：老账没有这个键照样过校验）。
                                        //   `range` 缺省不写（原文没给范围就是没给，不落占位值）。
                                        dims: {
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['name'],
                                                props: {
                                                    name: { kind: 'string', minLength: 1 },    // 维度名（原文）
                                                    range: { kind: 'string', minLength: 1 },   // 取值范围（原文，如 -100~100）
                                                },
                                            },
                                        },
                                        // ★★★leg62（用户令「粒度不要太细了，换成概念表怎么样」）：**刻度 · 概念表**。
                                        //   病（用户截图 · 实教账实测）：`powerScale` 与 `dims` 把
                                        //   "制度规则 / 强度刻度 / 基础属性 / 合成分 / 公式"**平铺进了同一个框**——
                                        //   面板上「力量谱系（5 档）」把 `S~E级`（一把尺）与 `A班~D班`（班级分配制度）
                                        //   摆在一起；「维度与刻度（14 项）」把 5 个基础属性、5 个合成分、2 个公式
                                        //   混成一栏。⇒ 三处错位同一个根：**值没有"它是什么类"的字段**。
                                        //   形状（**表头承载标签，条目不再逐条挂标签** —— 这是"粗粒度"的落点）：
                                        //     `[{ 名, 用途, 档位: [{档,注}], 子表: [{名,档位}], 维度: [{名,范围}] }]`
                                        //   为什么不是给每条档位挂 `axis/usage/kind`（交接 §3.2 的原提案）：
                                        //     ① 大荒 103 档 ⇒ 要挂 309 个字段（细）；概念表只要 51 个表头；
                                        //     ② 机械判据实测分不出条目级的轴（实教 5 档只聚成 1 族；
                                        //        三国 `T0级_天下无双`/`T0级_绝世奇才`/`T0级_王佐之才` 是**三个不同轴、同一记号前缀**）。
                                        //   纪律（三条都实测过，见 docs/measure-leg62-scales-concept-table.md）：
                                        //     ① `档`/`注` **照抄原文**（档位名逐字必中：两次真机实测 0 条落空）；
                                        //     ② `名` = 这把尺叫什么（**允许是描述性标题** —— 实测 2/26 不在原文，
                                        //        因为原文没给标题；硬要求逐字会把"这把尺叫什么"逼成捡词，反而丢信息）；
                                        //     ③ `用途` = **自由文字**（"分级/资源分配/换算/入阶条件…"）——
                                        //        实测三个枚举**盖不住**（大荒还出现"叙事尺度/资质潜力/入阶条件"），
                                        //        故不设枚举，改由一道纯函数闸兜底（同一用途名下不许混形态不同的档位）。
                                        //   可选键 ⇒ 旧世界零扰动（老账没这个键照样过校验）；
                                        //   老账的 `powerScale`/`dims` 由纯函数 `deriveScales` **推导**出概念表给面板用（零迁移）。
                                        //   ★与 `tierKeyOf`/`tierAxisOf` 的 `axis` **不是一回事**：那是 leg61 的**档位去重键**。
                                        刻度: {
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['名'],
                                                props: {
                                                    名: { kind: 'string', minLength: 1 },     // 这把尺叫什么（原文表头；允许描述性标题）
                                                    // ★★★leg63（用户现场拍板：「66 张表平铺在面板上，读不完、不成体系」）：
                                                    //   **这张尺出自原文哪一条条目**（原文题名逐字；可选，缺省不写）。
                                                    //   为什么需要它（本棒实测，别当装饰）：
                                                    //     ① 大荒真账 **66 张表全是平级兄弟**，面板照实画就是一堵墙
                                                    //        ——leg62 把"标签从条目挪到表头"（粒度粗了一档），但**表与表之间仍无层级**；
                                                    //     ② 书自己的结构是 **235 条平级条目**（`【小宅仙】`/`【小御仙】` 是两条），
                                                    //        所以"上溯节标题"这条路**不存在**（实测 66 张里 53 张上溯不到标题）；
                                                    //     ③ 但**表名是原文题名**（实测 55/66 逐字在原文里）⇒ 模型读原文时
                                                    //        本来就知道这张表出自哪一条 ⇒ 让它顺手交出来，是最省的一条。
                                                    //   ★与 `resolveScales` 旧账兜底的分工：新账读这一格；老账没有它，
                                                    //     面板退回"不分节"（零迁移零重抽，与 `刻度` 键同一条纪律）。
                                                    //   ★闸门口径：**不过出处闸**（与 `名` 同尺——题名是"书名录"那份材料，
                                                    //     块内文本不一定含它；硬卡会把"这张表出自哪"逼成编造）。
                                                    源: { kind: 'string', minLength: 1 },
                                                    用途: { kind: 'string', minLength: 1 },   // 用来干什么（自由文字；缺省不写）
                                                    档位: {
                                                        kind: 'array',
                                                        items: {
                                                            kind: 'object',
                                                            additional: false,
                                                            required: ['档'],
                                                            props: {
                                                                档: { kind: 'string', minLength: 1 },   // 档位名（原文逐字）
                                                                注: { kind: 'string', minLength: 1 },   // 该档意味着什么（原文措辞；原文没写就不写）
                                                            },
                                                        },
                                                    },
                                                    // 对"大境界"的细分（初期/中期/后期/巅峰）——用户拍「当子表」，不另立一张表。
                                                    子表: {
                                                        kind: 'array',
                                                        items: {
                                                            kind: 'object',
                                                            additional: false,
                                                            required: ['名'],
                                                            props: {
                                                                名: { kind: 'string', minLength: 1 },
                                                                档位: {
                                                                    kind: 'array',
                                                                    items: {
                                                                        kind: 'object',
                                                                        additional: false,
                                                                        required: ['档'],
                                                                        props: {
                                                                            档: { kind: 'string', minLength: 1 },
                                                                            注: { kind: 'string', minLength: 1 },
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                    // 维度那一半：某些刻度**自身就是一把尺**（实教 `S~E级` 下有
                                                    // `学力/智力/判断力/体育/团队` 五个维度都用它）⇒ 挂在同一张概念表上。
                                                    维度: {
                                                        kind: 'array',
                                                        items: {
                                                            kind: 'object',
                                                            additional: false,
                                                            required: ['名'],
                                                            props: {
                                                                名: { kind: 'string', minLength: 1 },
                                                                范围: { kind: 'string', minLength: 1 },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        rules: { kind: 'array', items: { kind: 'string' } },
                                        // ★★leg155：**法则类别表**（`{法则原文: 类别}`）——`pruneJunkRules` 的产出，
                                        //   三个入口共用它（收账 `sanitizeCanon` / 并集 `mergeCanonChunks` /
                                        //   载入期清旧账 `migrateStyleRulesFromCanon`），面板与进包都读它。
                                        //   ★漏登记的后果（本笔逐族查出来的）：**只要账上有过这一格，整份账就违纪**——
                                        //     三份真账都中（三国 1 · 实教 1 · 大荒z-09-29 1 条违约）。
                                        //   ★值一定是**非空字符串**（写入口按 `RULE_CLASSES` 挡过一道）⇒ 用 `strRecord`，
                                        //     这一格同时还能挡住"值被写成对象/空串"这类形状漂移。
                                        //   可选键（旧世界零扰动：老账没有这一格照样过校验，`leg64` 的零迁移锁）。
                                        ruleKinds: { kind: 'strRecord' },
                                        society: { kind: 'string' },
                                        techOrMagic: { kind: 'string' },
                                        historyNotes: { kind: 'array', items: { kind: 'string' } },
                                        geography: geographySchema,
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
                                                    // ★★leg155：**归属的来源发票**——与 `entities` 那一块的两格同名、同义，
                                                    //   而那一块登记过、这一块**没有** ⇒ 名册里只要有一条带来源，整份账就违约。
                                                    //   谁写的：`computeContainmentParents` 那一支（势力树甲类边 →"名字包含"）
                                                    //     与名册落账那几处（`照书办` / `模型抽取` / `模型抽取(未验证)` / `结构推导`）。
                                                    //   为什么不能只留 `parent`：这两格是"这条归属是**书里写的**还是**引擎推的**"
                                                    //     的**来源分账**，面板据此标「（推）」（红线二：不许拿空值反推"书里没有"）。
                                                    //   真账实测：大荒z-59 6 对 · 大荒z-09-29 2 对。两格都可选（旧账零扰动）。
                                                    parentSource: { kind: 'string', minLength: 1 },
                                                    parentSourceFrom: { kind: 'string', minLength: 1 },
                                                    location: { kind: 'string', minLength: 1 },   // leg21 补形状（此前 sanitizeCanon/关系轮已写、实体页已用，形状层漏登记 → 名册一律校验不过）；书中明述的所在/驻地
                                                    race: { kind: 'string', minLength: 1 },   // leg20：种族归属标签（书级出处校验后保留；可选）
                                                    // ★★★leg60（用户真账实测抓出）：**`fields` 漏登记**——`additional:false` 之下，
                                                    //   凡是带 `fields` 的名册条目**一律校验不过**。
                                                    //   根因（不是本棒引入的，是本棒让它显形的）：**leg25 e** 把"照书抄属性"加回了
                                                    //   提示词与净化层（`sanitizeBookFields` 的白名单），**契约层却忘了登记这个键**
                                                    //   ——上面那条 leg25 c 的注释删掉了 `attrs/evidence`，而新加的 `fields` 没补上。
                                                    //   为什么以前没人发现：三国旧账只有 43% 条目带属性（≈55 条），
                                                    //   而本棒把"属性真的抽出来"做成常态 ⇒ 三国新账 **323 条**条目踩这一格。
                                                    //   键表 = `sanitizeBookFields` 的白名单（按 kind 分：character 收前四项，faction 收后三项；
                                                    //   那个"按 kind 分"的判据在代码里，契约层只登记键的形状）。
                                                    fields: {
                                                        kind: 'object',
                                                        // ★★leg61：`additional:false → true`（**键开放**）。
                                                        //   旧口径把属性空间锁死在这七个键上（见下方 props 的注释），
                                                        //   而"该收哪些属性"每个作者写得都不一样 ⇒ 拿一张七键表当闸，
                                                        //   等于用一本书的字段名判另一本书（用户令：「很多抽不出来」）。
                                                        //   新闸在**净化层**：`sanitizeBookFields` 的表外键要求
                                                        //   **值能在本书原文里逐字找到**（`fieldEvidenceOf`），找不到即丢并留痕。
                                                        //   契约层只登记形状（string）——判据只有一处，别在两处各写一份。
                                                        additional: true,
                                                        props: {
                                                            所属: { kind: 'string', minLength: 1 },   // character：所属势力（原文）
                                                            身份: { kind: 'string', minLength: 1 },   // character：身份（原文）
                                                            定位: { kind: 'string', minLength: 1 },   // character：定位（原文）
                                                            实力: { kind: 'string', minLength: 1 },   // character：档位标签原话（文本，引擎不换算）
                                                            性质: { kind: 'string', minLength: 1 },   // faction：性质（原文）
                                                            倾向: { kind: 'string', minLength: 1 },   // faction：倾向（原文）
                                                            规模: { kind: 'string', minLength: 1 },   // faction：规模/实力原话（≠ 角色档位）
                                                        },
                                                    },
                                                    // leg25 c：书名录条目的 `attrs` / `evidence`（leg20 的"从书里抄四维数值+原文依据"）
                                                    //   **整条删除**。书里这一维到底写没写数值，已无人判读——"四维不存在"了，
                                                    //   连"书里明写这一维"这个判据本身也失去了对象（见 settle.js 迁移注释）。
                                                },
                                            },
                                        },
                                        // ★★leg61：**属性+设定遍**的产出（`buildSettingPrompt`）。
                                        //   与 `bookEntities` 同构，但**每一条都带 fields**（没属性的条目不收，那一遍不是名册）。
                                        //   用途与分工：`bookEntities` 负责"名号一个不许漏"（瘦提示词、产量优先），
                                        //   本键负责"属性逐字照抄"（键开放、**值必须有原文出处**）。
                                        //   下游：`extractWorldSetting` 把它**并入名册**（同名归并 / 绝不新造实体）。
                                        //   可选键 ⇒ 旧世界零扰动（老账没有这个键照样过校验）。
                                        settings: {
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['name', 'fields'],
                                                props: {
                                                    name: { kind: 'string', minLength: 1 },
                                                    kind: { kind: 'string', enum: ['faction', 'character', 'location'] },
                                                    parent: { kind: 'string', minLength: 1 },
                                                    fields: { kind: 'object', additional: true, props: {} },
                                                },
                                            },
                                        },
                                        // ★★★leg141（用户令「**把抽象阶段的关系网抽象做出来，我才发现初始化的时候都没有关系网**」）：
                                        //   **书里的关系网** —— 抽取阶段的产出，两端用**名号**写（那时还没有实体 id）。
                                        //   ★它是**抽取产物**，不是账上的网：落账时 `seedBookRelations` 把名号解析成实体 id，
                                        //     写进 `ssot.relations`（顶层第 10 张表）——**那张表才是"关系网"唯一的家**，
                                        //     玩家与模型都只看它。本键与 `bookEntities` 同性质（`canon` 是"书抽出来的那份"，
                                        //     冻结、可重入重种），**不是**按出处劈出来的第二个家。
                                        //   ★**每条都必须带 `quote`**（书里那句原话）：抽取那一刻由引擎逐字核过
                                        //     "这句真在书文里"（`sanitizeBookRelations`，与名册/设定面**同一把尺子**），
                                        //     **核完即弃**——落账时只留边本身，不留那句原话（账上不记出处，见顶层 `relations` 那一段）。
                                        //   ★★★Task 3 复查第二轮（task-3-fixes-review.md ⑦）：**新账不带 `quote`**——
                                        //     上一条"核完即弃"当年只写在注释里，实现却把 `quote` 一起写进了 canon
                                        //     （复审在 `setting.frozen.canon.relations` 上逐字读到了原话）。
                                        //     现在契约分两种形状，判据在 `abstract.js` 的 `classifyBookEdge`：
                                        //       · 新账 `{from,to,type}`（已核过，凭证不落账）⇒ `quote` 可省；
                                        //       · 旧账挂着 `quote`（当年核过的形状）⇒ **照旧合法**（只读兼容，老世界零扰动）。
                                        //     ⇒ 契约**只放宽为"quote 可选"**，没有让任何旧数据变非法，也没有新增键。
                                        //   ★可选键 ⇒ 旧世界零扰动（老账没有这个键照样过校验）。
                                        relations: {
                                            kind: 'array',
                                            items: {
                                                kind: 'object',
                                                additional: false,
                                                required: ['from', 'to', 'type'],
                                                props: {
                                                    from: { kind: 'string', minLength: 1 },   // 谁（**名号**，落账时才解析成 id）
                                                    to: { kind: 'string', minLength: 1 },     // 对谁（名号）
                                                    type: { kind: 'string', minLength: 1 },   // ★书里的原话措辞（自由文本，不预设词表）
                                                    quote: { kind: 'string', minLength: 1 },  // ★旧账才有：书里那句原话（新账核完不落账）
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
                    // ★★★Task 3：**实体别名**（可选=旧世界零扰动）。设计 §6.3：不同名字的同一实体在
                    //   名册到实体账的转换中**保留全部已确认叫法**，搜索与实体解析用同一份身份信息。
                    //   写方只有一处：`seedBookEntities` 的 `mergeEntityAliases`（正名去重、幂等、只加不删）。
                    //   读方：`tag-extract` 的解析器（③ 别名档）、`entity-lookup` 的名号对齐、
                    //   `seedBookRelations` 的端点解析（同一个 `entity-identity.js`）。
                    //   旧账没有这一格 ⇒ 解析只按正名（逐字节旧行为）。
                    aliases: { kind: 'array', items: { kind: 'string', minLength: 1 } },
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
                    parentSource: { kind: 'string', minLength: 1 },                 // 归属来源：照书办 / 模型抽取（历史值：模型抽取(未验证) / 结构推导 / 名字包含 仍可读）
                    // ★★★Task 3：**证据类型枚举口径更新**（设计 §6.2：成员行/关键词名单只作定位，不建立也不否定关系）。
                    //   新账只写：`model-claim`（模型主张，本次抽取已在严格道核过来源与原话）/ `explicit`
                    //   （作者在自己条目正文里明写）/ `tag`（书标签声明，照书办）/ `unverifiable`（历史遗留）。
                    //   历史值 `member-line` / `key-list` / `成员行@XX` / `名字包含@XX` **仍合法**——
                    //   旧账与快照不重建，面板照旧显示它们的出处（自由字符串，不受枚举限制）。
                    parentSourceFrom: { kind: 'string', minLength: 1 },
                    规模: { kind: 'string', minLength: 1 },   // 势力自己的规模/性质**原话**（书的势力标签/底蕴行；≠ 角色档位）
                    性质: { kind: 'string', minLength: 1 },   // 势力性质原话（如「正道仙门魁首」）——文本，引擎不读
                    倾向: { kind: 'string', minLength: 1 },   // 势力倾向原话——文本，引擎不读
                    身份: { kind: 'string', minLength: 1 },   // 书里明述的身份（如「现任盟主」）——文本原话，引擎不读
                    定位: { kind: 'string', minLength: 1 },   // 书里明述的角色定位——文本原话，引擎不读
                    // ★★leg61：**`所属` 落账**（此前是"抽出来了却一个都不落地"的那一格，缺登记只是它的第二重病）。
                    //   与 `parent` 的分工写死在这里，两边都不许混：
                    //     · `所属` = **书里的原话**（含「司徒王允府」这类不是势力的写法）——不参与势力树、不参与折叠；
                    //     · `parent` = 引擎按证据梳理出的归属（带 `parentSource` 发票）——势力树与折叠读它。
                    //   真账实测（leg61 三本账）：名册带 `所属` 233/482/141 条 ⇒ 旧口径实体账上 **0/0/0**。
                    所属: { kind: 'string', minLength: 1 },
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
                required: ['id', 'title', 'source'],
                // 用户要求「位置改成可选」：leg155 先放宽历史账，leg190 同步放宽新事件提议。
                // 不知道发生在哪里就省略，不补玩家驻地或「未明」；写了仍须为非空文本。
                // 回归见 test/schema.test.js 与 test/optional-event-position.test.js。
                props: {
                    id: { kind: 'string', minLength: 1 },
                    title: { kind: 'string', minLength: 1 },
                    // ★★★leg123：**正文里那句原话**（`dialogue` 型事件专用；引擎从标签行**逐字**抄进来）。
                    //   ★它是"**值必须在正文里找得到**"这条闸的凭据：一个值要是连正文里都找不到，
                    //     那它就是模型换算/编出来的 ⇒ 不收（细案 §2.7 第 ③ 条；★词表判语义是红线禁的，
                    //     所以"照抄"只能靠这条**机械**的核对来做）。
                    //   ★老事件没有这一格 ⇒ 空着（零迁移）。★归档副本只拷五格 ⇒ 它不入档（已知边界，见编年行那处注）。
                    proseQuote: { kind: 'string', minLength: 1 },
                    // ★★★leg123：`dialogue` 型事件的**族**（引擎从标签那一族写上，模型写不出——它不在 world-step 契约里）。
                    //   用处：① 门控"谁被正文点到"用 `ripples`；② 净化器"谁本轮已经出过手"只看 `action`/`promise`
                    //   （**改过格的人不算出过手**——他可能只是被写了一句"他受伤了"）；③ "已改定的格"靠 `meta` 留痕。
                    dialogueKind: { kind: 'string', enum: ['action', 'change', 'promise'] },
                    source: {                                                      // 无源事件引擎拒绝（§4.2）
                        kind: 'object',
                        additional: false,
                        required: ['type'],
                        props: {
                            // ★★leg60（用户真账实测抓出）：枚举补 `seed` —— 起根种下的"世界源起的根"是**第四型**，
                            //   而这里只登记了 plot/state/ripple ⇒ **每一条起根事件都违约**。
                            //   （`seedRoots.js` 头部明写"★与 state/plot/ripple 并列的第四型：世界源起的根"，
                            //     契约层漏跟。为什么以前没显形：真账三国旧账只种出 **1 条**根，本棒起出 **7 条**。）
                            // ★★★leg123（细案 `docs/spec-tag-granularity.md`）：**枚举增一型 `dialogue`**——
                            //   正文那一侧给的行动/变化/承诺，由**引擎**注册成这一类事件（落账权仍在引擎手里）。
                            //   ★★关键形状：**它只登记在账本契约里，不登记在 `world-step.schema.js`** ⇒
                            //     世界模型**结构上写不出**这一类事件（它那七组里没有这一型，校验层也会拒）——
                            //     这就是"聊天侧的既成事实"与"世界的提议"分得开的保证。
                            type: { kind: 'string', enum: ['plot', 'state', 'ripple', 'seed', 'dialogue'] },
                            ref: { kind: 'string' },    // ripple→上游事件 id；plot/state→出处（可选）；seed 无 ref
                        },
                    },
                    // ★★leg60：起根事件的出处（书里那句话 + 为什么算"正在发生"）——`applySeedRoots` 一直在写，
                    //   契约层同样漏登记。四栏全可选（旧账零扰动）。
                    seedFrom: {
                        kind: 'object',
                        additional: false,
                        props: {
                            quote: { kind: 'string' },
                            why: { kind: 'string' },
                            fingerprint: { kind: 'string' },
                            at: { kind: 'string' },
                            tick: { kind: 'number', int: true, min: 0 },
                        },
                    },
                    position: { kind: 'string', minLength: 1 },
                    // ★★★leg123：**这一件事发生在"戏里的什么时候"**——由 `【此刻】` **逐字照抄**进来。
                    //   ★它**不带源**（用户 2026-09-24 裁定：「这东西本来就没权威」）：引擎不校验、不解析、
                    //     不比较、不推算；老账没有这一格 ⇒ 空着（零迁移，红线 2）。
                    //   ★★★leg137：**两个来源都写这一格**，而且**都不许由引擎替它猜**：
                    //     · **聊天侧**（`dialogue` 型）＝ 正文 `【此刻】`（leg123 起就是这么做的）；
                    //     · **世界侧**（`plot`/`state`/`ripple`）＝ 世界步的 `newEvents[].at`
                    //       （用户令：「**只要告诉时间流逝的长度和起始，事件的时间字段就由 llm 自己写**，
                    //        要不然所有事件都是同一时刻发生的了」）。
                    //   ⚠**本笔第一版写的是"顺延"**（引擎拿账上最后一个时刻盖满本轮所有事件）——
                    //     被用户当场打回：一轮能起十几件事（真账设 `每轮事件=12`），那样就是**把时间抹平**。
                    //     ⇒ **引擎不再顺延**：模型没写 `at` ⇒ 那一件事就是没有时间（红线 2：空着就是空着）。
                    timeMark: { kind: 'string', minLength: 1 },
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
                    // ★★leg95（用户令「让 llm 来决定何时结束」+「机械不许替模型判语义」）：**收场留痕两格**——
                    //   这两格是"账目合上了"与"真的讲完了"分开记的**唯一凭据**（此前一个 `closed` 布尔背三种语义，
                    //   下游分不清对面是哪一种，面板因此把"账目状态"当事实印出来——用户截图那句「还开着」的病根）。
                    //   `closedBy`：'model' = 模型判"这一段讲完了"（`eventClosures` 通道）；缺格 = 引擎机械扫的
                    //   （源结清/链尾结清/取消联闭——机械清扫是"账目的事"，不声称任何语义）。
                    //   `closedWhy`：模型给出的一句话理由（机械清扫不写这格——它没有理由，只有判据）。
                    //   两格都可选（旧账零扰动；`additional:false` 下不加这两格会**判据当场红**）。
                    closedBy: { kind: 'string', enum: ['model'] },
                    closedWhy: { kind: 'string', minLength: 1 },
                },
            },
        },
        // ★★★leg120（A3 关系网，细案 `docs/spec-relationship-network.md`）：**账上第 10 张表**——
        //   "谁跟谁是什么关系"（谁跟谁结了仇、谁欠了谁、谁叛了谁）。
        //   为什么它必须进账：**书里没有、账上也没有 ⇒ 没有任何地方可查**（`leg109b` §1.2）。
        //   ★**可选表**（不在 `required` 里，照 `milestones` 先例）：缺省 = 旧世界合法形态
        //     ⇒ **旧账一个字节不用迁**（本仓的零迁移纪律）。
        //   ★**一行 = 一条有向边**。
        //   ★**类型 `type` 是自由文本**：不许把它换算成数、不许排序、不许进任何公式
        //     （红线 §2.2 第 1 条；四维浮点就是这么被整体删掉的，别让"关系强度"把它请回来）。
        //   ★`endedTick`/`endedWhy` 由引擎在"了结"时**往后盖**——**只增不改**：边的来路
        //     （from/to/type/cause/tick）一个字都不许被改写，只许因果地长向未来。
        //   ★★★leg141（用户当场推翻 leg120 那半句，**他是对的**）：「**肯定会有矛盾那他妈是因为模拟啊？？
        //     书里关系的权威肯定能推翻要不然你模拟什么啊**」＋「**回滚都有快照了还要多此一举？？**」
        //     ⇒ **`cause` 从 `required` 里拿掉**。旧口径（"必带因"当整张表的脊梁）错在哪，逐条留档：
        //       · **它把"矛盾"当故障防** —— 而矛盾是模拟的**产物**：账本从书出发，然后必须走远。
        //         拿"书里原来写的是什么"去保护书的权威，等于把模拟的目的（推翻它）掐掉。
        //       · **回滚不靠这张表** —— 回滚归**快照**管（`web/snapshot-store.js`），
        //         让账本再背一份"书里原来是什么"是第二个家。
        //       · **它把同一张网按出处劈成两半** —— 玩家要的是"现在谁跟谁是什么关系"，
        //         不是"这条是谁给的"。**一条信息只许住在它该住的那一格。**
        //     ⇒ **初始化种下的边（书里就是这么写的）没有账上的因，这是合法形态**：
        //       它的来路就是"书里写着"，而书随时可查（本仓那条老规矩）。
        //     ★★**"必带因"这条闸没有消失，它搬到了它真正该在的地方**：
        //       **玩的过程里模型提议新边时**，仍然必须带一个指得到账上真事的因
        //       —— `src/schemas/world-step.schema.js`（`required: [... 'cause']`，**未动**）
        //       ＋ `src/check-step.js` 那句逐字的「必须带因（无因之变＝随口编的关系，不是玩出来的）」（**未动**）。
        //       那才是编造风险真正所在的地方：**开局的书是给定的，玩到一半冒出来的边才要交代来路。**
        //     ★判据 `test/relations.test.js` 的 R1/R2 咬的**正是 world-step 那一侧** ⇒ 本笔**一条承重判据都不用改**。
        relations: {
            kind: 'array',
            items: {
                kind: 'object',
                additional: false,
                required: ['id', 'from', 'to', 'type', 'tick'],
                props: {
                    id: { kind: 'string', minLength: 1 },     // 引擎发号：rel_<轮次>_<第几条>（开局那批恒 rel_0_*）
                    from: { kind: 'string', minLength: 1 },   // 谁（实体 id，不是名字）
                    to: { kind: 'string', minLength: 1 },     // 对谁（实体 id）
                    type: { kind: 'string', minLength: 1 },   // ★模型/书里的原话（自由文本，不预设封闭词表）
                    cause: {                                  // ★可选（leg141）：开局种下的边没有这一格
                        kind: 'object',
                        additional: false,
                        required: ['type', 'ref'],
                        props: {
                            type: { kind: 'string', enum: ['event', 'agenda'] },
                            ref: { kind: 'string', minLength: 1 },
                        },
                    },
                    tick: { kind: 'number', int: true, min: 0 },        // 落账那一轮（引擎盖；开局那批恒 0）
                    note: { kind: 'string' },
                    endedTick: { kind: 'number', int: true, min: 0 },   // 可选：从哪一轮起不再算数
                    endedWhy: { kind: 'string', minLength: 1 },         // 可选：为什么了结
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
                    // ★★★leg111（用户令「你就把进大事纪的事件来路保留就好了，和其他没进的事件一样」）：
                    //   **纪内逐事件的来路**——归档时随事件对象一起丢掉的那部分，现在原样留档。
                    //   病（用户实机看着链视图问「进了大事纪的事件的链条好像只会保存开头还有事纪，不再是具体的事件了」）：
                    //     归档只 `push(ev.title)` + `push(ev.id)` ⇒ 事件对象的 `source.ref` 随之消失 ⇒
                    //     **段内"哪件事引发了哪件事"整段查不到**（真账 4 个纪共 63 条已归档事件全无来路）。
                    //   口径（照用户原话"和其他没进的事件一样"）：**事件契约那五格照抄**（id/title/source/position/ripples）
                    //     ⇒ 链视图拿到的形状与热池事件**完全同形**，不必分两套渲染。
                    //   ★可选（旧账没有这格 = 合法形态，零扰动）；`closed` 不存（归档时链条已收口，见 `archiveClosedEvents`）。
                    //   ★★★`links` 现在**存了**（本次修，真模型 60 轮长跑实跑抓出来的病）：此前归档只抄五格
                    //     ⇒ 那件事的**多因**一进档就没了 ⇒ `lines.js` 的 `causeCountOf` 读不到第二条因
                    //     ⇒ `causes` 恒为 1 ⇒ **`·合流N` 一归档就消失**（实测：热账多因点峰值 3、末段掉回 1）。
                    //     ★口径收窄：**只挂"合流表里除主因外还有别的因"那一种**（绝大多数事件不挂）
                    //       ⇒ 单因事件的行形状一字不动；也**不是**把 `source` 抄第二遍。
                    //     ★`links.down` 仍不存（归档时已无下游，见 `settle.js` 归档段）。
                    rows: {
                        kind: 'array',
                        items: {
                            kind: 'object',
                            additional: false,
                            required: ['id', 'title'],
                            props: {
                                id: { kind: 'string', minLength: 1 },
                                title: { kind: 'string' },
                                source: {
                                    kind: 'object',
                                    additional: false,
                                    required: ['type'],
                                    props: {
                                        // ★★★leg123：归档副本的源枚举同样要收 `dialogue`（否则一条 dialogue 事件
                                        //   一入档就违约）。★如实登记一处**已知边界**：归档副本只拷**事件那五格**
                                        //   （id/title/source/position/ripples，见 `settle.js` 归档口径），
                                        //   故 `timeMark` **不入档**——时间点仍在那条事件对应的**编年行**上（行入卷时整行带走）。
                                        //   要把 `timeMark` 也带进档 = 动归档口径与它那条判据，属另一笔。
                                        type: { kind: 'string', enum: ['plot', 'state', 'ripple', 'seed', 'dialogue'] },
                                        ref: { kind: 'string' },
                                    },
                                },
                                position: { kind: 'string' },
                                ripples: { kind: 'array', items: { kind: 'string' } },
                                // ★多因（`up` ≥ 2，或"主因之外还有别的因"）——立线时算"多因点"要用它。
                                //   可选：单因事件不挂（旧账与旧行形状零扰动）。
                                links: {
                                    kind: 'object',
                                    additional: false,
                                    props: { up: { kind: 'array', items: { kind: 'string' } } },
                                },
                            },
                        },
                    },
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
                    // ★★★leg115：**这一轮的"此后又过了多久"**——正文里【时长】写的原话（「三天」「一炷香」），
                    //   逐字照抄、**不做任何累加换算**（红线：不许把词换算成数）。
                    //   为什么非记不可（用户原话：「**聊天llm是不知道什么时候世界发生了什么事懂吗？**」）：
                    //     账上原本 **零时间字段**（`simLog` 只有 tick/体积/计数）⇒ 往事只带「第 N 轮」这个
                    //     **引擎轮次**，而"故事里过了多久"在账上**一个字节都不留**；
                    //     而 `elapsed` 是**账外的料**（`pack.js:1014` 原文：「引擎一个字都不解析它」）
                    //     ⇒ 写正文的人自己写的时长，下一轮**没地方找**。
                    //   ⇒ 记在这里 = 往事与"什么时候"绑在同一行上，检索层一取就带出来（`ledger-recall.js`）。
                    //   可选格：旧行没有它照样合法（零扰动）；没有就是没有，**不许填占位值**（红线 2）。
                    elapsed: { kind: 'string', minLength: 1 },
                    // ★★★leg123：编年行的**时间点**（`【此刻】`照抄）——与上面那格 `elapsed`（此后又过了多久）
                    //   **两格分开**：`elapsed` 答"过了多久"、`timeMark` 答"那时是什么时候"（细案 §2.2 规则 3/4）。
                    //   ★不带源、不推算；老账没有这一格 ⇒ 空着（零迁移）。
                    timeMark: { kind: 'string', minLength: 1 },
                },
            },
        },
        meta: {
            kind: 'object',
            additional: false,
            required: ['tick'],
            props: {
                tick: { kind: 'number', int: true, min: 0 },
                // ★★leg60（用户真账实测抓出）：**起根的指纹记录**——`seedRoots.js` 从 leg40 起一直在写它
                //   （幂等闸 + 逐块读数），而契约层漏登记 ⇒ 只要种过根，整份文档就违纪。
                //   为什么以前没显形：三国旧账只种出 1 条根（本棒 7 条）。四栏全可选（旧账零扰动）。
                seedRoots: {
                    kind: 'object',
                    additional: true,        // 逐块读数（chunks/dropped/skippedParties）由引擎记账保证，这里只查"是对象"
                    props: {},
                },
                dialogueBook: {   // K37/实体治理 §3.7 对话依据册：{ 对象名: {count, lastTick} }（可选；动态键 map——引擎记账保证内层形状，schema 只查整体为对象）
                    kind: 'object',
                    additional: true,
                    props: {},
                },
                // ★★★leg89：**这一轮世界发生了什么**（给聊天模型注入用）——`runTick` 结算后写，
                //   下一轮 `web/inject.js` 的③段读它注入聊天上下文（开关默认关）。
                //   ★形状：编年条目拼成的**一句文本**（`◆ [第N轮] …；◆ …`），不是结构。
                //   ★为什么登记在这里（本笔实测代价）：漏登记 ⇒ `test/backdrop-smoke.test.js` 的
                //     "非预期警告"当场红（`$.meta.lastInjection: 未知字段`）——**这正是判据该干的活**：
                //     契约层不许有"引擎偷偷多写的字段"。
                lastInjection: { kind: 'string', minLength: 1 },   // 可选（没有新事发生 ⇒ 键不出现）
                // ★★★leg151：**"这些线的经过已经递过了"的记性**（引擎预取那条路的账）。
                //   为什么非记不可：正在走的线会**连着很多轮都在动**（实测一条线可以走 61～65 轮），
                //   不记的话它每轮都占满预取上界 ⇒ **别人的线永远轮不到**（饿死）。
                //   ★口径：**记的是"包里真摆出去的那批"**，且**只在真递出去时才写** ⇒
                //     取不到料的世界（没线可立 / 老账）**逐字节不变**（旧账零扰动）。
                //   ★为什么在契约里登记（本仓血的教训，见上面 `lastInjection` 那条）：
                //     本块 `additional:false` ⇒ 漏登记就是"引擎偷偷多写字段"，旧账当场过不了自家 schema。
                linesShown: { kind: 'array', items: { kind: 'string' } },
                // ★★★leg163：**"模型点名要了什么料"那两格** —— 与上面 `lastInjection`/`linesShown` 同一条病：
                //   `meta` 这块是 `additional:false` ⇒ **引擎真写的键，尺子上必须有登记**，漏一个整份账就违纪。
                //   ★这一条是**先证红**验出来的（本笔，跑生产校验器）：一份只有 `tick` 的最小账，
                //     meta 层 ✔ 过；写进 `lineRequests` 或 `scaleRequests` 之后当场变成
                //     `$.meta.lineRequests: 未知字段` / `$.meta.scaleRequests: 未知字段`。
                //   ★为什么这么久没显形：这两个键**只在模型真点过名的那一局**才出现，
                //     而真账里从没点过（`lookupLines` 三趟真跑 150 轮一次没用过）⇒ 四份真账逐份全过、看不出病。
                //   ★两格的来路不同，分开记：
                //     · `lineRequests` —— `check-step.js` **现在仍在写**（leg128 那条"点名要一条故事线的经过"，
                //       活着的通道）⇒ 这一格是**真的在用的登记**。
                //     · `scaleRequests` —— 写它的那条通道（leg64 按需查表）**leg163 整族撤走**了
                //       （用户令「既然是全塞了就不需要点名表了所以删了这个功能即可」）。
                //       本版引擎**一个字都不写它**；登记它是照 `recalled`/`legacyAttrsMigratedAt` 的先例：
                //       **老账里已经躺着的那一批不许因此变得不合法**（删登记＝把旧账判死）。
                lineRequests: { kind: 'array', items: { kind: 'string' } },
                scaleRequests: { kind: 'array', items: { kind: 'string' } },
                // ★★leg155：**载入期清旧账的留痕**（leg74 立 · leg75 推广）——`migrateStyleRulesFromCanon`
                //   把"不算世界"的那几类从法则账里摘掉时写下（`styleRulesPurged` = 摘掉的原话，
                //   `styleRulesPurgedAt` = 时点）。照 `legacyAttrsPurged` 的先例：**摘掉的东西不许无声消失**。
                //   ★漏登记的后果（本笔逐族查出来的）：**只要账上真摘过一次，整份账就违纪**——
                //     实教那份中 2 条（而这份账正是被载入期清理过的）。
                //   ★为什么漏了这么久没显形：这一段**只在载入期**写，而校验不在生产路上跑。
                //   两格都可选（旧世界零扰动：没摘过的账没有它们）。
                styleRulesPurged: { kind: 'array', items: { kind: 'string' } },
                styleRulesPurgedAt: { kind: 'number' },
                // ★★leg155：**旧版引擎的检索读数残留**（`{tick, ok, chunks, sources, queryChars, reason}`）——
                //   记的是"这一轮从世界书里检索到几段"，而那条路**整条拆掉了**（leg122，用户令「所以才需要拆」：
                //   `pack.recalled` 与提示词里那两处都不在了，本版引擎**一个字都不写它**）。
                //   ★为什么还在这里登记：**老账里已经躺着的那一批不许因此变得不合法**
                //     （照 `legacyAttrsMigratedAt` 那两格的先例："删它会打破旧账"）。
                //   ★形状只查"是对象"：它由旧版引擎记账保证，本版不再产出、也不再有消费者。
                recalled: { kind: 'object', additional: true, props: {} },
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
                            // ★★★leg114：**裁之前**那一份有多大（可选格——只在"包真被裁过"的那一轮才写，
                            //   没裁的轮次一个字不写 ⇒ 旧账与"引擎零漂移"那条硬读数都不受扰动）。
                            //   为什么必须另立一格：`packTokens` 量的是**裁完之后**的包（`pack.js` 先裁后量）
                            //   ⇒ 包一旦撑满，它就贴着预算顶、"看着刚好合适"，**答不出"预算该填多少"**。
                            //   这一格才是那个依据（面板拿它跟 `packTokens` 一比就知道裁掉了多少）。
                            packTokensBeforeTrim: { kind: 'number', int: true, min: 0 },
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

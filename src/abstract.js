// story-world-v2/src/abstract.js
// 抽象管线执行器（K31/双流 UI，编排层；细案 §3.4/§4 K31 → A-6/A-7；第十八棒 v1 范本对照修正）。
// 书源文本 → 书指纹（K26，FNV-1a）→ 缓存命中 = 零抽取调用 / 书变自动失效 / force 绕过强制重抽
// → LLM 抽取（只提取不创作、无数量约束取全、原文措辞不润色）→ 净化（形状合法为止）
// → 落 context.setting（frozen 五件套 + bookEntities 书名录 + dynamic 初值）。
// 第十八棒修正（v1 范本实读 director.js/abstract.js）：**大书分段多调用，绝不单次硬吃全量**——
//   - 设定五件套：头 CANON_SRC_CHAR 单发（v1 拍板 30000，80k 段曾连续空回复，16k-30k 历史稳定）；
//   - 书名录：全条目分块多次调用（块失败→对半拆递归深度≤4/单条兜底→保底重试一次→跳过降级，
//     块间合并去重，全书级出处判定=原文没出现的名号弃（纯编造才丢））；
//   - 小书（≤3 万字符）保持单发——行为与既有版本零差异（测试基线不动）。
// v1 教训（adapter.js L19）：人名藏在条目深处，头 400 字截断会砍掉名字密集段——大书分块必须全量覆盖。
// 职责链（红线 4 同构）：LLM 只提取不创作（上游提议）；引擎只做确定性净化与落账（引擎钳制）。
// 纪律：
//   - dynamic.tension.intensity 不许模型拍（K29 引擎确定性计算）——净化时丢弃模型侧 intensity；
//   - env 初值键表白名单（报批二批 #3 定案四键）+ [0,1] 钳制；缺省 = 基线 0.5（提案）；
//   - 空 canon 合法（K24 口径：无数量约束，防编造靠纪律不靠量制）。
// leg20（用户令）：恢复世情路径（canon.situation=当前天下大势一句，原文措辞；v1 有，K38 重写丢失）。
// ============================================================================================
// leg24（第二十四棒·片1「停抄书」，用户拍板，落地 design-core-leg23 §4 片1）：**抽取不再抄书**。
//   砍掉：①关系轮（问每条的上级/所在/种族）②属性轮（问四维数值）——它们的共同作用只是"把书抄进账本"，
//         而**书随时可查**（design-core §2.5：账本是玩出来的，不是书的副本）。
//   保留：①设定五件套（力量谱系=查数值时照表取的原料、法则、社会格局、力量体系、史略）
//         ②世情句 situation ③**名号 + 类别**（身份是账本主键，design-core §2.3 第 1 项）
//         ④照书办（书用标签声明的结构，零模型调用、可复现——不是"抄书"，是读作者亲笔写的声明）
//         ⑤环境初值（design-core §3.3 唯一保留的数值：熵泵要有真起点，否则四键 0.5 前期世界太平）
//   为什么砍（用户定的三条）：引擎**不裁胜负**→ 四维数值没有使用者；**能力不在战力维度上**（神通/法宝/免疫），
//         硬填就得堆规则＝旧项目 130 条边界老病；**空着就是空着**（不许拿默认值/估值冒充客观）。
//   账本里不再有 attrs/race/evidence 的**来源**：位置与归属改为"用到时查书"（片2 接线；本片先停止生产，
//         不再拿模型读出来的值往册里塞）；实体的四维数值改由 LLM 每轮提议 + 引擎钳制（settle 既有通道不动）。
//   牵连面（交接 §4 已摸）：bookEntities 被 check-step/abstract/render/web/schema 5 处读；本片动 abstract/render/web 3 处。
//   实测（片1 完工核验）：同一段书 → 名册轮 1 次调用（原 1 + 关系批 + 属性批）；名册可选字段残留 0；
//     照书办照旧生效（<上界势力_蟠桃园> 被判 location 的名号改判 faction、<X帝麾下_Y> 的上级照抄）；
//     seed 入账 schema PASS；「渡虚帝.Organs=界渊长城/须弥界域」照旧出名。
// ============================================================================================
import { bookFingerprint } from './fingerprint.js';
import { PARAM_GEARS, PARAM_KEYS, normalizeParam } from './params.js';
// leg24 片2：不再从 settle 借 ENTITY_ATTR_DEFAULT（该常量已删）——名册入账不预填数值
import { computeWeight } from './weight.js';

// leg26：`ENV_INIT_BASELINE`（0.5 基线）**已删除**——档位没有"基线值"，未定就是未定（空着就是空着）。
export const TENSION_INIT_BASELINE = 0.5;  // 提案：无旧 tension 数字时的强度初值（随长跑校准批）

// 第十八棒（v1 拍板值同款 · 提案态，随报批）：
export const CANON_SRC_CHAR = 30000;       // 设定五件套抽取：书文前 3 万字符单发（v1 实测 16k-30k 稳定）
export const ROSTER_CHUNK_CHAR = 60000;    // 书名录分块尺寸（字符级累计；v1 参数翻烧饼史终值）
export const ROSTER_CHUNK_DEPTH = 4;       // 块失败对半拆递归深度上限（v1 同款；条目数 ≤1 时不再拆）
// leg24 片1：ATTRS_BATCH_MAX / ROUND_BATCH_CHAR 随属性轮、关系轮一并删除（两轮已砍——书随时可查，不抄）

// ★leg60：**五件套 + 世情的形状：一处定义，两处用**。
//   为什么必须共用（本仓吃过多次的洞）：两处各写一份 JSON 形状 ⇒ 改一处忘一处 ⇒
//   模型按新形状交、净化层按旧形状收（或者反过来），字段静默消失且没有任何报错。
//   现在：`buildAbstractPrompt`（留档 / `demo/diag-init-extract.js` 度量用）与
//   `buildRosterPrompt`（leg60 起 = 每块的**合并提示词**，大小书共用）共用这一份。
const CANON_SHAPE = {
    powerScale: [{ level: '档位名（原文）', note: '该档意味着什么（原文措辞）' }],
    // ★★leg60（交接第 2 件）：**维度与刻度**——"书里的量纲"，原样照抄，引擎不换算、不进公式。
    //   为什么要单列一项（真账实证）：三国那本 `[mvu_update]变量更新规则` 写着
    //   `主角状态.属性.{勇武|韬略|内政|统御|气度|健康}: range: -100~100`，`演义战力体系` 写着
    //   `核心属性: 勇武/统御 各 0-100`——**这两条就是"尺子"**。旧口径下它们只落在 `render.js` 的设置页，
    //   **模型一个字看不到** ⇒ 模型写实力/属性时没有书里的尺子可依（真账 85 实体里 `实力` 0 条）。
    //   现在：维度/范围/档位合成"刻度"块进每轮包当锚（见 `pack.js` 的 `buildScaleAnchor`）。
    dims: [{ name: '属性/维度名（原文）', range: '该维度的取值范围（原文，如 -100~100 / 0-100）' }],
    rules: ['法则1（原文）'],
    society: '社会与制度格局（原文）',
    techOrMagic: '力量/生态体系（原文）',
    historyNotes: ['历史要点1（原文）'],
    situation: '当前世情：天下大势/各方态势一句（原文措辞 ≤80字；原文无全局局势则省）',
};
const TENSION_SHAPE = { polarity: '两股劲的名字（原文）', direction: '当前方向：谁压谁（原文措辞，可省）' };
const ENV_SHAPE = { 民生度: '崩溃|艰难|尚可|富足（四选一，原文能判才填）', 动乱度: '太平|小乱|动荡|大乱', 天时: '大灾|失调|平常|风调雨顺', 张力推手: '沉寂|平缓|暗涌|紧绷' };

export function buildAbstractPrompt(sourceText) {
    return [
        '你是世界设定的抽取器。只提取不创作：只从给定的设定原文里提取事实，不创作、不润色、不补全、不重排。',
        '原文没有提到的字段一律省略；档位名、法令、人名、措辞必须来自原文；数量没有任何限制，取全不取量。',
        '输出严格 JSON，形状如下（可省字段不写 null；intensity 不许输出——它由引擎计算）：',
        JSON.stringify(
            {
                ...CANON_SHAPE,
                bookEntities: [{ name: '势力/角色/地名的名号（原文名）', kind: 'faction|character|location（可省）' }],   // K37 书名录 + 第十九棒：只收原文名，不收泛指称呼；地名（洲/山/谷等）标 location
                                                                                                                          // leg24 片1：**停抄书**——上级/所在/种族/四维属性都不再抽（书随时可查；引擎不裁胜负，数值没有使用者）
                                                                                                                          //             身份（名号+类别）是账本主键，照旧；书用标签声明的结构走照书办（零模型调用）
                tension: TENSION_SHAPE,
                env: ENV_SHAPE,
            },
            null,
            2,
        ),
        '———— 设定原文如下 ————',
        sourceText,
    ].join('\n');
}

// leg21（用户令「把之前的问题修了」）：名册轮专用提示词——瘦身。
// 背景（数据实证）：leg20 把 attrs/依据/race 塞进名册轮后，同书名册 504→106——
// 每名号输出膨胀 3-4 倍超 16384 输出预算（思考型模型 reasoning 还占盘）→ JSON 截断 → 拆半降级。
// K49（词档细案 §2.1）**再瘦身到最轻形态 {name, kind}**：可选字段在名册规模压力下最易被模型省略。
// leg24 片1（停抄书）：**隶属/所在/种族从此不再抽**——原 K49 关系轮已删；本轮的职责锁定为
//   **名号 + 类别**（账本主键 design-core §2.3 第 1 项），纪律 3 的措辞随之改为"本轮只负责名号与类别"。
// ★★★leg60：**`buildRosterPrompt` 不再是"名册轮"的提示词——它是「每块的合并提示词」，大小书共用。**
//   名字保留，因为它在演示/度量脚本与历史文档里被引用；**语义以这段注释为准**：
//   leg60 起它一次抽完"这一块里有的所有东西"（设定五件套 + 世情 + 名册 + 张力 + 环境档位）。
//   为什么合（病根，两处实证）：
//     ① 大书旧口径"五件套读头 3 万 + 名册读全"= **同一本书喂两遍**（一遍读全、一遍只读开头 15%）
//        ⇒ 真档位表在窗口外，模型照抄了【声誉】十级当力量谱系（真账逐字：`里闾称善…遗臭斧钺`）；
//     ② 小书那条路用的是**只问名号**的旧提示词 ⇒ 四本 ≤3 万的真书 **canon 恒空**（实测复现）。
//   ⇒ 一份提示词、一条路、不同块数：小书 1 块 · 三国 4 块 · 大荒 5 块 · re0 2 块。
export function buildRosterPrompt(sourceText, declared = []) {
    const lines = [
        '你是世界设定的抽取器。只提取不创作：只从给定的设定原文里提取事实与名号及其属性，不创作、不润色、不补全、不重排。',
        '原文没有提到的字段一律省略；档位名、法令、人名、措辞必须来自原文；数量没有任何限制，取全不取量。',
        '★**这一段（本块）里有什么就抽什么**：力量谱系 / 法则 / 社会格局 / 力量体系 / 史略 / 世情，与名册（名号 + 类别 + 属性原话）**在同一份 JSON 里一起交**；原文没有的那一项就省略。',
        '（intensity 不许输出——它由引擎计算；原文没有的字段一律省略，不许补全）',
        '输出严格 JSON（形状如下；可省字段不写 null）：',
        JSON.stringify(
            {
                ...CANON_SHAPE,
                bookEntities: [
                    { name: '势力/角色/地名的名号（原文名）', aliases: ['同一实体的其他叫法（原文名，可省）'], kind: 'faction|character|location（可省）' },
                    // ★leg60：三个形态**都带 `aliases`**——旧模板只在第一形态写了它，于是模型按形状办事、
                    //   角色/势力（绝大多数条目）从不交别名 ⇒ 即使净化层收得下，也没有输入可收。
                    //   （真账症状见 sanitizeAliases 头部注释：曹操/曹孟德 各一条、152 势力里 108 个空壳。）
                    { name: '角色名', aliases: ['该角色的字/号/小名/别称（原文名，可省）'], kind: 'character', fields: { 所属: '所属势力名（原文）', 身份: '身份（原文）', 定位: '定位（原文）', 实力: '紧贴名号的档位标签原话（原文）' } },
                    { name: '势力名', aliases: ['同一势力的其他叫法（原文名，可省）'], kind: 'faction', fields: { 性质: '性质（原文）', 倾向: '倾向（原文）', 规模: '实力/规模原话（原文）' } },
                ],
                tension: TENSION_SHAPE,
                env: ENV_SHAPE,
            },
            null,
            2,
        ),
        '纪律：',
        '1. 只收原文名，不收泛指称呼；地名（洲/山/谷/城等）标 location。',
        '2. 纯种族的群体名号（如 人族、妖族、鬼族、魔族、灵族、仙族、神族等）不算势力——不要给它们标 faction；只有书中明述的组织（如某族的宗族、门派、联盟、国度）才是势力。',
        '3. **所属（角色的所属势力）= 必抄项**：本书的常见写法是「组织条目的正文里列出成员行」（如 `- 吞天妖王 (男, T8大乘中期): 现任盟主`）——',
        '   读到这种行时，该角色名的 `所属` 必须填**该组织条目的名字**（原文名，逐字），哪怕这一行只有标签也要抄。',
        '   另有「所属势力/隶属/上级/势力=」这类**显式写法**时，同样照抄。原文没写所属就留空——**不许推测、不许按常识分配**。',
        '4. **实力（角色的档位）= 必抄项**：名字后紧贴的括号或冒号里的**实力/境界/军阶标签照抄原话**（如 `T8大乘中期`/`化神巅峰`/`偏将军`/`中忍`），以本书实际写法为准，**不许套用别的书的档位体系、不许自己下判断词**；原文确实没写才留空。',
        '   势力的「规模」= 原文写明的规模/兵力/底蕴原话（如「五万大军，据许都」）；**势力的实力不写角色的档位**（那是两回事）。',
        '5. 身份/定位/性质/倾向/规模 各 **≤20 字**，没有就留空字符串，绝不写长句（输出太长会被截断导致整块作废）。',
        '6. 名号来自原文的**都要列**（宁可多不可漏——要的是完整登记册）；属性不确定的也列，字段留空即可。',
        // ★leg25 g（用户点单「治碎块只能尽量做提示词约束吧？」）：
        //   实测病根（真账 699 名号）：书里**一个条目**被抽成了**多个独立势力**——
        //   书条目 `人族皇朝`（key 明写 `大虞`/`大虞皇朝`）被抽成 `大虞` + `大虞皇朝` + `大虞边境三十六凡俗小国`
        //   三个各自独立的 faction，**每个都没有成员** ⇒ 账上 152 个势力里 108 个是空壳。
        //   ⇒ 这三条是"一个实体只出一条 + 别名不单列 + 种族名不算势力（规则 2 的强制版）"。
        //   ★能治什么、不能治什么（**实测**，别信直觉）：
        //     原以为"同一块内的别名提示词能治"——**不成立**。实测大荒书 266819 字符 / 上限 60000 ⇒ **切 5 块**，
        //     而「大虞」字样横跨第 1/2/3/5 块、定义它的那个条目 `【人族皇朝】` **只落在第 1 块** ⇒
        //     第 2/3/5 块的模型看不到"大虞是谁的别名"，照样会把 `大虞` 单出一条。
        //     ⇒ 提示词只能做**块内**的收敛（一个实体别在同一块里出多条）+ **把别名交出来**（`aliases`）；
        //       **跨块的归一必须由引擎在块间合并时按"名字 ∪ 别名"做**（见下面的 `bookNames` 与 `mergeCleaned`）。
        '7. **一个实体只出一条**。书里对同一个势力的不同叫法（条目名与它的别名、带前缀的写法，如 `人族皇朝`/`大虞`/`大虞皇朝`）',
        '   **是同一个实体，只许出一条**，用**书里最完整、最正式的那个名字**；不许把同一个东西拆成多条、每条都标 faction。',
        '   同一个条目里写明了"谁是谁的别名/旧称/别称"时，**把这些别的叫法放进该条的 `aliases` 数组**（照抄原文，不要自己发明叫法）。',
        '   ★**`aliases` 对三个形态都适用**（角色/势力/地名都要交）：同一实体的**字、号、小名、本称、旧称、别称、简称**',
        '   一律算它的其他叫法，照抄原文原字。**不交别名，引擎就合不了重**——同一个人的两个叫法会在册上长成两条。',
        '   ⚠ 这一段原文里若**只**出现了某个叫法、而没有它所属条目的定义（比如正文里顺带提到一个势力名），',
        '   那就**按这个名字出一条**并把你知道的别名写进 `aliases` —— 引擎会按"名字 + 别名"把跨段的重复合到一起。',
        '8. **规则 2 是硬性要求**：纯种族/族群的群体名（人族、妖族、鬼族、魔族、灵族、仙族、神族、半妖、龙族、兽族、巫族等）',
        '   **一个都不许标 faction**，也不要为它们单独出一条——它们不是组织。',
        '   只有原文里**确有**一个具体组织（某族里的宗族、门派、联盟、国度、军团）才出 faction 条目，且用那个组织的名号。',
        '   违反第 2、7、8 条 = 这一轮作废，请自己检查后重新输出（宁缺勿造：多列一条假的比漏一条更糟）。',
    ];
    // leg23 照书办①：书本段已用标签声明过的名号（如「<上界势力_蟠桃园>」）——清单给全，模型漏了也不丢。
    // 名号逐字取自原文；此处只作召回提示，类别仍按书标签在引擎侧定（不靠模型改判）。
    if (declared.length) {
        lines.push(
            '9. 本段原文里被标签直接标出来的名号（如上界势力_／幽冥势力_／某帝麾下_ 后的名字）一个都不能漏，必须全部出现在输出里：',
            declared.map((d) => d.name).join('、'),
        );
    }
    lines.push('———— 设定原文如下 ————', sourceText);
    return lines.join('\n');
}

/**
 * ★★leg61：**属性+设定遍**（第二遍）——名册遍（`buildRosterPrompt`）的搭档。
 *
 * 为什么要把一份提示词拆成两份（实测，不是推理；装置 `F:\deepseek\tmp\leg61-live-roster-ab.js`）：
 *   同一本书、同一批 5 块、同一个模型，两个口径的**输出总量几乎相同**（77.6k vs 71k 字符），
 *   但**每个名号的成本差 3.3 倍**（现在生产口径 ~188 字符/名号 vs 只报名号 ~57 字符/名号）：
 *     · 只报名号：去重 **1022** 个名号；
 *     · 七样一起问（现状）：去重 **364** 个。
 *   ⇒ 名册的产量不是被"输出装不下"卡住的（预算还有 4,000 token 余量），而是被**每个条目要写多少字段**摊薄的。
 *   而名册与属性**都不是可省的**（用户令：「我要的是模拟的必要属性，实力，归属等等」）
 *   ⇒ 唯一的出路是**给名册一份只干一件事的提示词**（leg60 之前那份"名册轮"正是如此，它交 239~308 个/块）。
 *
 * 为什么第二遍**不要名号**：`bookEntities` 从形状里去掉 ⇒ 输出全花在内容上；
 *   属性仍按 kind 分（角色/势力），键**开放**（见 `sanitizeBookFields`：键可自由命名，**值必须有原文出处**）。
 */
export function buildSettingPrompt(sourceText, declared = []) {
    const lines = [
        '你是世界设定的抽取器。只提取不创作：只从给定的设定原文里提取事实与属性原话，不创作、不润色、不补全、不重排。',
        '原文没有提到的字段一律省略；档位名、法令、措辞必须来自原文；数量没有任何限制，取全不取量。',
        '★**本遍只干两件事**（名号已经由另一遍收过了，这一遍**不要**再列名册）：',
        '  ① 设定：力量谱系 / 法则 / 社会格局 / 力量体系 / 史略 / 世情 / 维度与量表；',
        '  ② 属性：本节原文里**明写了属性的人与势力**，把属性原话抄下来。',
        '★★**属性的键你可以按本书自己的写法起名**（如 所属/身份/实力/境界/体质/兵力/性质/倾向/规模/领地/寿元…），',
        '   但有一条铁律：**值必须是本节原文里能逐字找到的原话**——原文没写这一项就不写这个键，**一个字都不许推测**。',
        '输出严格 JSON（形状如下；可省字段不写 null）。**形状里没有名册那一项**——名号由另一遍负责收，本遍一个字都不要列名：',
        JSON.stringify(
            {
                ...CANON_SHAPE,
                entities: [
                    { name: '角色名（原文名）', kind: 'character', fields: { 所属: '所属势力名（原文）', 身份: '身份/官职（原文）', 实力: '紧贴名号的档位或数值原话（原文，如 勇武99/统御95）', '其他属性名（按本书写法）': '该属性的原文原话' } },
                    { name: '势力名（原文名）', kind: 'faction', fields: { 性质: '性质（原文）', 倾向: '倾向（原文）', 规模: '规模/兵力原话（原文）' } },
                ],
                tension: TENSION_SHAPE,
                env: ENV_SHAPE,
            },
            null,
            2,
        ),
        '纪律：',
        '1. 属性值**逐字照抄**：紧贴名号的括号/冒号里的档位、数值、官职、规模都算；不允许改写、不允许概括成一句话。',
        '2. 原文写了数值就抄数值（`勇武99`），写了档位就抄档位（`T8破妄`）——**不许把档位换算成数、也不许把数换算成档位**。',
        '3. 一个人**只出一条**（同名合并）；同一个人的属性写在同一个 `fields` 里，**别拆成多条**。',
        '4. 势力的「规模」= 原文写明的兵力/规模/底蕴原话；**势力的实力不写角色的档位**（那是两回事）。',
        '5. 每个属性值 ≤ 40 字，**不要写解释**（输出太长会被截断导致整块作废）。',
        '6. 原文没写属性的人**根本不要列**——本遍不是名册，宁可少一个人，也不许编一个字段。',
    ];
    if (declared.length) {
        lines.push(
            '7. 以下名号在本段里出现过，若原文给了他们的属性，请一并抄下来：',
            declared.map((d) => d.name).join('、'),
        );
    }
    lines.push('———— 设定原文如下 ————', sourceText);
    return lines.join('\n');
}

/**
 * ★★leg61：**只问属性**（属性遍的第 2..N 块用这一份）。
 *
 * 为什么需要第二个变体（踩坑留档，改这里之前先读）：
 *   属性遍原本一块一份提示词（既问设定又问属性）+ 一条"本块交了设定就收兵"的止损判据。
 *   实测结果是**属性一个都没进来**——因为止损把整遍关掉了，而**设定与属性在同一遍里**：
 *   书里法则/档位表常常集中在头一两块 ⇒ 那一块之后每一块都被止损跳过，属性跟着一起没。
 *   而且"止损"这个动作本身就把两个不同粒度的问题捆在了一起：
 *     · 设定 = 全书级的一两句/几张表 ⇒ **问一块就够**（块间本来就是并集去重）；
 *     · 属性 = 每人一条、散在各块（三国 340 人横跨 1~7 块）⇒ **必须每块都问**。
 *   ⇒ 定稿：**第一块问"设定 + 属性"，其后每块只问属性**。调用数与"每块都问"完全相同，
 *     省下的只是"重复问设定"那份输出，而属性一块不落（`present` 里也就不再需要 'setting' 那条判据）。
 */
export function buildAttrsOnlyPrompt(sourceText, declared = []) {
    const lines = [
        '你是世界属性的抽取器。只提取不创作：只从给定的设定原文里提取属性原话，不创作、不润色、不补全、不重排。',
        '原文没有提到的字段一律省略；属性值必须来自原文；数量没有任何限制，取全不取量。',
        '★**本遍只干一件事**：把本节原文里**明写了属性的人与势力**，连同属性原话抄下来。',
        '★设定（力量谱系/法则/社会格局/史略）**本遍不要**——那些已经由前面几遍收过了，重复输出只会挤掉属性。',
        '★★**属性的键你可以按本书自己的写法起名**（如 所属/身份/实力/境界/体质/兵力/性质/倾向/规模/领地/寿元…），',
        '   但有一条铁律：**值必须是本节原文里能逐字找到的原话**——原文没写这一项就不写这个键，**一个字都不许推测**。',
        '输出严格 JSON（形状如下；可省字段不写 null）。**形状里没有名册那一项**——名号由另一遍负责收：',
        JSON.stringify(
            {
                entities: [
                    { name: '角色名（原文名）', kind: 'character', fields: { 所属: '所属势力名（原文）', 身份: '身份/官职（原文）', 实力: '紧贴名号的档位或数值原话（原文）', '其他属性名（按本书写法）': '该属性的原文原话' } },
                    { name: '势力名（原文名）', kind: 'faction', fields: { 性质: '性质（原文）', 倾向: '倾向（原文）', 规模: '规模/兵力原话（原文）' } },
                ],
            },
            null,
            2,
        ),
        '纪律：',
        '1. 属性值**逐字照抄**：紧贴名号的括号/冒号里的档位、数值、官职、规模都算；不许改写、不许概括成一句话。',
        '2. 原文写了数值就抄数值（`勇武99`），写了档位就抄档位（`T8破妄`）——**不许换算**。',
        '3. 一个人**只出一条**（同名合并）；同一人的属性写在同一个 `fields` 里，**别拆成多条**。',
        '4. 原文没写属性的人**根本不要列**——宁可少一个人，也不许编一个字段。',
    ];
    if (declared.length) {
        lines.push(
            '5. 以下名号在本段里出现过，若原文给了他们的属性，请一并抄下来：',
            declared.map((d) => d.name).join('、'),
        );
    }
    lines.push('———— 设定原文如下 ————', sourceText);
    return lines.join('\n');
}

// ============ leg23 照书办（书自己声明的结构） ============
// 实证（leg22 §3.5 + leg23 复核）：书用标签直接声明了结构——`<上界势力_蟠桃园>`（类别）、
// `<渡虚帝麾下_界渊长城>`（类别 + 上级）；而**逐名号问模型这条路只成 3%**、名册把 7 个
// 标签声明为势力的名号判成了地名、3 个连册都没进（导出 (5) 精确账：27 条声明 → 对 17 / 错 7 / 缺 3）。
// 口径（第二十三棒用户拍板「照书办」）：**书标了是势力，就按势力入账**——标签权威高于"名字像不像地名"的猜测；
// 书把上级写进标签的，**直接照抄该边**（零模型调用、可复现）。
// 判据是**形态**不是词表：类型标签＝`<…势力_名号>`，上级标签＝`<…帝麾下_名号>`——`势力`/`麾下` 是书自己的
// 体例用字（实测 27 条全中、脚手架标签零误收），不是我们预先列的组织词清单；生造前缀（如「混沌势力_」）
// 同样认出。词表代价记录在返回值 usesLabelTerms（留钩子：本步恒为空，一旦有人加词表即显形）。
const STRUCTURE_TAG_LINE = /^<([^<>\n]{2,60})>/;

// 从一行文本里取「笔者的结构声明」；非声明返回 null（脚本/宏标签、普通正文一律不认）。
function structureTagOf(line) {
    const m = STRUCTURE_TAG_LINE.exec(String(line ?? '').trim());
    if (!m) return null;
    const parts = m[1].split('_');
    if (parts.length >= 2 && /势力$/.test(parts[0])) {
        return { name: parts[parts.length - 1].trim(), kind: 'faction' };            // <上界势力_第十六重天_凤鸣天阙>
    }
    if (parts.length >= 2 && parts[0].includes('麾下')) {
        const boss = parts[0].split('麾下')[0].trim();
        return {
            name: parts[parts.length - 1].trim(),
            kind: 'faction',
            parent: boss || undefined,                                               // <渡虚帝麾下_界渊长城>
        };
    }
    return null;
}

/**
 * 照书办：扫全书的「结构声明」（纯函数、零 LLM、逐字节可复现）。
 * 返回 {declares, usesLabelTerms}——declares 按书序去重（首个声明为准），同名补缺 parent。
 */
export function scanBookDeclarations(src) {
    const declares = [];
    const byName = new Map();
    for (const raw of String(src ?? '').split('\n')) {
        const d = structureTagOf(raw);
        if (!d || !d.name) continue;
        const hit = byName.get(d.name);
        if (hit) {
            if (d.parent && !hit.parent) hit.parent = d.parent;   // 同名声明的补缺（不覆盖已有）
            continue;
        }
        const item = { name: d.name, kind: d.kind };
        if (d.parent) item.parent = d.parent;
        byName.set(d.name, item);
        declares.push(item);
    }
    return { declares, usesLabelTerms: [] };
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★★leg58：**体系条目优先取样**——修「五件套只读书列表开头」的取样病灶。
//
// ── 病（真账实证，见 `docs/measure-leg58-canon-sampling.md`）───────────────────────────────
//   `canonSrc = 全书前 CANON_SRC_CHAR(30000) 字符`。三国那本：启用 264 条、
//   而窗口只覆盖**前 12 条**（列表开头是《备用审查》《音乐》《演义说书》这类工具条目）。
//   那 12 条里唯一的"成等级表"是题名就叫【声誉】的那条 ⇒ 模型被问 `powerScale`，
//   **照抄了声誉十级**（清名/恶名各五级），而真正的战力体系（T0_天下无双 / 勇武·统御）
//   在窗口**之外**，模型**从未见过它**。★**模型没抽错——是取样错**。
//
// ── 修法（泛用，零新增数字）──────────────────────────────────────────────────────────
//   不按"这本书叫什么"挑，按**形态**挑：**体系条目长得像"字段：值 的清单"**——
//   `范围: 0-100` · `T0级_天下无双:` · `属性联动机制:` · `核心属性:`。
//   正文条目（人物档案、事件记录）不长这样。⇒ 在**窗口内**（`CANON_SRC_CHAR`）优先装
//   「清单形态」的条目，余量再按书序填。★**总量恒等于 `CANON_SRC_CHAR`**（`abstract-chunk.test.js`
//   锁着"五件套段 = 头 3 万字符"）⇒ 本函数只改**挑哪 3 万**，不改**多少 3 万**。
//   ★**零 LLM、纯函数、逐字节可复现**——与同文件的 `scanBookDeclarations` 同一条手法。
//
// ── 为什么不在提示词里让模型"自己去找体系条目"────────────────────────────────────────
//   模型看不见窗口外的东西，问它也没用（它只能照抄给它看的）。**取样发生在模型之前**，
//   所以这一刀必须切在取样上。
const ENTRY_START_RE = /^【[^】]*】/;                       // `init-source.js` 的条目边界：`【题名】正文`
const FIELD_LINE_RE = /^\s*[^\s:：]{1,24}\s*[:：]\s*\S/;      // `核心属性:` / `范围: 0-100`
const RANGE_RE = /[-−–~至]\s*\d/;                            // `0-100` / `95-99` / `1~5`
// 标题里的"分类/体系"词（**是结构词，不是题材词**——换任何书都成立；不写演义/战力这类本书专名）
const TITLE_MARK_RE = /(体系|系统|规则|设定|总纲|机制|属性|数值|档位|等级|品级|境界|谱系|世界观)/;

/** 把一个条目块切出「题名 + 首段」（判形态只看开头——正文条目往往后面也长得像正文）。 */
function entryShapeOf(block) {
    const text = String(block || '');
    const m = ENTRY_START_RE.exec(text);
    const title = m ? text.slice(0, m[0].length) : '';
    const body = m ? text.slice(m[0].length) : text;
    return { title, head: body.split('\n').slice(0, 6).join('\n'), len: text.length };
}

/**
 * 「体系条目」形态分（**越高越像"定义世界怎么运转"的条目**）。0 = 不像。
 * ★口径是"清单形态 + 分类词"，两条都**与题材无关**：换一本书、换一套体系名，判据照旧成立。
 */
export function systemEntryScore(block) {
    const { title, head } = entryShapeOf(block);
    let score = 0;
    // ① 标题带分类词（最强信号：作者就是这么标"这是设定"的）
    if (TITLE_MARK_RE.test(title)) score += 4;
    // ② 正文开头是"字段：值"清单
    const fieldLines = head.split('\n').filter((l) => FIELD_LINE_RE.test(l)).length;
    if (fieldLines >= 4) score += 3;
    else if (fieldLines >= 2) score += 1;
    // ③ 出现数值区间（`勇武 0-100` 这种"定标"的形态）
    if (RANGE_RE.test(head)) score += 2;
    // ④ 同一段里"短标签行"密集（`勇气:` `范围:` …）——体系条目的骨架
    const shortLabels = head.split('\n').filter((l) => /^\s*[^\s:：]{1,12}\s*[:：]\s*$/.test(l)).length;
    if (shortLabels >= 2) score += 1;
    return score;
}

/**
 * ★★★leg58：**一个"已量过、未接线"的候选** —— 用之前先读 `docs/measure-leg58-canon-sampling.md`。
 *
 * 它想修的病（真账实证）：`canonSrc = 全书前 CANON_SRC_CHAR` ⇒ 三国那本启用 264 条里只覆盖 12–13 条，
 *   而那 13 条里唯一的等级表是【声誉】⇒ 模型被问 `powerScale` 就照抄了声誉十级，
 *   真正的战力体系（T0_天下无双 / 勇武·统御）**在窗口外**。★**模型没错，是取样错。**
 *
 * ★但它**没解决问题**（我接上去之前先出了数，出数把它否掉了，故**接线已撤**）：
 *   ① **根因不在取样，在"条目被禁用"**：`演义战力体系` 是 `disable=true` ⇒ 输入集合里根本没它，
 *      任何"挑得更准"的策略都变不出来（`composeInitSource` 在本棒实测收 264 条，里面无它）；
 *   ② **形态判据分不开「分类定义」与「分类的实例」**：人物档案的 `基本信息:/姓名:`
 *      与体系条目的 `核心属性:/范围:` **同形**（都是"字段:值"清单）⇒ 本函数在真书上
 *      挑出的是**人物档案**，不是体系条目；
 *   ③ 启用集合里 264 条有 **220 条是 JS 脚本条目**（`<%_`，题面却叫"演义说书/正史记载"）——
 *      它们在题名与正文两层都伪装成"体系"。
 *
 * ⇒ **接它的前置条件**：先让体系条目进入输入集（在 ST 里启用），**那时才第一次有正样本**
 *   可以校准判据。在那之前接它，只是把一条**没过验证的 heuristic** 装上生产。
 *
 * 设计（留着，别推翻）：在窗口内**优先装体系条目**、余量按书序，**总量恒 = `CANON_SRC_CHAR`**
 *   （`abstract-chunk.test.js` 锁着"五件套段 = 头 3 万字符"——它锁的是**多少**，本函数只改**挑哪**）；
 *   判据用**形态**不用题材词（换任何书都成立）；**零 LLM、纯函数、逐字节可复现**（同 `scanBookDeclarations`）。
 */
export function pickCanonSource(src, budget = CANON_SRC_CHAR) {
    const text = String(src ?? '');
    // 按 `【题名】` 行首切块（切不出来 ⇒ 整段当一块，行为与旧版一致）
    const blocks = [];
    let cur = null;
    for (const line of text.split('\n')) {
        if (ENTRY_START_RE.test(line)) { if (cur !== null) blocks.push(cur.join('\n')); cur = [line]; }
        else if (cur !== null) cur.push(line);
        else cur = [line];
    }
    if (cur !== null) blocks.push(cur.join('\n'));

    const scored = blocks.map((b, i) => ({ b, i, s: systemEntryScore(b) }));
    // 体系条目（分高者先），其余按书序 —— 稳定排序，逐字节可复现
    const ranked = scored.filter((x) => x.s > 0).sort((a, b) => (b.s - a.s) || (a.i - b.i));
    const rest = scored.filter((x) => x.s === 0);

    const chosen = new Set();
    const picked = [];
    let used = 0;
    const take = (x, { force = false } = {}) => {
        const len = x.b.length + (used ? 1 : 0);            // 拼接用的换行也算
        if (!force && used + len > budget) return false;
        chosen.add(x.i); used += len;
        if (x.s > 0) picked.push(entryShapeOf(x.b).title || `(第 ${x.i + 1} 块)`);
        return true;
    };
    for (const x of ranked) take(x);                       // ① 体系条目优先
    for (const x of rest) { if (used >= budget) break; take(x); }   // ② 余量按书序
    // 兜底：一条都没装下（单个巨块 > budget）⇒ 退回"头 budget 字符"，与旧版逐字节一致
    if (!used) return { text: Array.from(text).slice(0, budget).join(''), picked: [], pickedChars: budget, scanned: blocks.length, total: text.length };

    // 按**书序**还原（模型看到的顺序仍与书一致——不乱序，免得影响它对"先说什么"的判断）
    const out = blocks.filter((_, i) => chosen.has(i)).join('\n');
    return { text: out, picked, pickedChars: out.length, scanned: blocks.length, total: text.length };
}

// leg24 片1 删除位（原 leg21 属性轮 prompt `buildAttrsPrompt`）：四维数值不再从书里抄——书随时可查，
// 数值由 LLM 每轮提议（主调用既有通道），引擎不裁胜负也就不需要它。整个函数已删（不是停用）。



// leg24 片1 删除位（原 K49 关系轮 prompt `buildRelationPrompt`）：隶属/所在/种族不再从书里抄。
// 书里真写着的结构走「照书办」（零模型调用）；位置与归属按 design-core §2.3 改为用得着时查书（片2）。
// 整个函数已删（不是停用）。

// leg24 片1 删除位（原 leg20 `sanitizeEntityAttrs`）：不再净化书抽来的四维属性/原文依据。
// 账本里若还有旧世界的 attrs（旧账字段保留、schema 不动），本轮一概不读、不写、不覆盖。

// 第二十五棒实机修正：上级名号净化（模型常把书里的层级路径**照抄**成 `/太素帝`、`／太素帝`、`- 太素帝`）。
//   实况（用户真实世界书 + 账本）：9 条带上级的势力全部是 `/X帝` 形态 → 名册索引按原名查不到 →
//   `seedBookEntities` 判"上级不在册" → 弃隶属（界面 623 行「归属空着」）。去前导符号后 9/9 都在册。
//   纪律：只剥**前导层级符号/空白**，不改名字本体（书里写的是什么名，账上就必须是什么名）。
export function normalizeParentName(raw) {
    return String(raw ?? '').trim().replace(/^[/／\\>·>\-—–\s]+/, '').trim();
}

/**
 * ★★leg61：**势力树的甲类边**（纯函数 · 零 token · 零词表）——"名字里就写着它的上级"。
 *
 * 判据（三步，全部机械可复核）：
 *   ① `parent.name` 是 `child.name` 的**连续子串**，且**严格更长**（`曹魏远征军` ⊂ 不含 `曹魏军`… 反例见下）
 *      ⇒ 与**同类别**（都 `kind === 'faction'`）的在册条目比对；
 *   ② 命中**多条**（`曹魏` 与 `曹魏军` 都包含于 `曹魏远征军`）⇒ 取**最长的那条**当直接上级
 *      （于是 `曹魏远征军 → 曹魏军 → 曹魏` 自然成链，不需要额外做链顶解析）；
 *   ③ 命中**多条且等长**（真歧义，如同时存在 `曹魏军` 与 `曹魏部`）⇒ **不连**，进 warnings。
 *
 * ★为什么这条判据值得信（与"同段共现"那条被否掉的判据对比，两者差别是本函数存在的全部理由）：
 *   · 名字包含 = **书自己起的名字里写着归属**（作者给它起名时就把上级带上了）；
 *   · 同段共现 = 只是"这两句话在附近"，实测抓到的全是"诸葛亮是琅琊诸葛氏的人""两军交战"
 *     甚至"万法阁叛徒 ⇒ 万法阁 ∈ 天机阁"（三国 91 处 / 大荒 217 处全不可用）。
 * ⇒ 宁可只连少数几条**名字本身就写明**的边，也不连一堆"看着像"的边（宁缺勿造）。
 *
 * @returns `{links: [{child, parent, names}], warnings: string[]}`
 */
export function linkContainedFactions(entities = [], byName = new Map()) {
    const links = [];
    const warnings = [];
    const facs = (Array.isArray(entities) ? entities : []).filter((e) => e && e.kind === 'faction' && typeof e.name === 'string' && e.name.trim());
    for (const child of facs) {
        const cn = String(child.name).trim();
        // ⚠长度方向：**候选(父)必须更短**——`cn.includes(pn)` 与 `pn.length < cn.length` 是**一对**，
        //   第一版把长度写成 `>`（读起来像"更长的那个是父"）⇒ 一条边都连不出来（实测当场抓到：三国 0 条）。
        const cands = facs.filter((p) => {
            const pn = String(p.name).trim();
            return p !== child && pn.length < cn.length && cn.includes(pn) && byName.get(pn);
        });
        if (!cands.length) continue;
        const maxLen = Math.max(...cands.map((p) => String(p.name).trim().length));
        const top = cands.filter((p) => String(p.name).trim().length === maxLen);
        if (top.length > 1) {
            warnings.push(`势力树: 「${cn}」可能属于 ${top.map((p) => `「${p.name}」`).join('/')}（名字包含并列）——不硬选，保持平级`);
            continue;
        }
        links.push({ child, parent: top[0], names: [String(top[0].name).trim()] });
    }
    return { links, warnings };
}

/**
 * ★★leg61：**势力树的落点解析**（纯函数）——把"名字里写着上级"的边，解析成**链顶名**。
 *
 * 与 `linkContainedFactions` 的分工（两者都要，别合并）：
 *   · `linkContainedFactions` 只回答"**谁包含谁**"（直接父，用于展示与留痕）；
 *   · 本函数回答"**这条边该把 parent 写成谁**"——沿已解析的祖先链上溯到**链顶**
 *     （与 `resolveSeedTarget` 同一口径：势力链顶 / 在册角色）。
 *
 * ★为什么必须一次解析到链顶（实测抓出的不一致）：甲类边是"先天的"（从名字就能看出来），
 *   它可能与书里声明的上级链**接在一起**。若只写直接父，就会出现**同一棵树两套答案**：
 *   势力树上是 `昆仑道宫 ∈ 昆仑`，而角色的归属仍写成 `昆仑道宫`（`resolveSeedTarget` 上溯时
 *   看不到"后来才写上的"那条边）。真机端到端判据实测：改前 `玄一道祖.parent = 昆仑道宫`，改后 = `昆仑`。
 *
 * @returns `Map<childName, {parent: 链顶名, parentSource: '名字包含'|'照书办', parentSourceFrom: 证据}>`
 */
export function computeContainmentParents(book = []) {
    const items = (Array.isArray(book) ? book : []).filter((b) => b && typeof b.name === 'string' && b.name.trim());
    const byName = new Map(items.map((b) => [b.name, b]));
    const resolved = new Map();
    const { links } = linkContainedFactions(items.filter((b) => b.kind === 'faction'), byName);
    for (const { child, parent } of links) {
        // 沿"已解析的祖先链"上溯：甲类边是一批一批定的，顺序不定 ⇒ 用已解析的那条当参照，
        //   遇到还没解析的就退回**直接父**（下次再来也不会错，只是浅一层）。
        let cur = parent;
        const guard = new Set();
        while (cur && !guard.has(cur.name)) {
            guard.add(cur.name);
            const anc = resolved.get(cur.name);
            if (!anc) break;
            const next = byName.get(anc.parent);
            if (!next || next === cur) break;
            cur = next;
        }
        resolved.set(child.name, {
            parent: cur.name,
            parentSource: parent.parent ? '照书办' : '名字包含',   // 直接父本身有书里声明的上级 ⇒ 这条边的来路是"书"
            parentSourceFrom: `名字包含@${parent.name}`,
        });
    }
    return resolved;
}

// 照书抄的属性字段键表（第二十五棒 e 引入；**leg61 起由"白名单"改为"常用键"**）。
//   character：所属（= 所属势力，兼作 parent 的兜底来源）/ 身份 / 定位 / 实力（档位原话）
//   faction  ：性质 / 倾向 / 规模（势力自己的规模原话——**不是**角色档位）
// ★★leg61（用户令「我要的是模拟的必要属性，实力，归属等等，但是现在就是有很多抽不出来」）：
//   **这张表不再是闸门**。旧口径下不在表里的键一律不收（模型交了"体质/境界/兵力/宗门/寿命"全丢），
//   而"该收哪些属性"这件事**每个作者写得都不一样** —— 拿一张七键表当闸，等于用一本书的字段名判另一本书。
//   新口径：**键开放，闸门换成"出处"**（见 `BOOK_FIELD_EVIDENCE` 与 `sanitizeBookFields`）：
//     · 本书常用键（下表）：沿用 ≤`BOOK_FIELD_MAX` 字的旧上限；
//     · 表外新键：收，但**值必须在本书原文里找得到**，且 ≤`BOOK_FIELD_MAX_OPEN` 字。
//   ⇒ 判据从"我认这个键名"变成"书里说没说这句话"——后者与题材无关（换任何书都成立）。
export const BOOK_FIELD_KEYS = {
    character: ['所属', '身份', '定位', '实力'],
    faction: ['性质', '倾向', '规模'],
    location: [],
};
export const BOOK_FIELD_MAX = 30;          // 常用键的旧上限（不改，保持既有账面形态）
export const BOOK_FIELD_MAX_OPEN = 60;     // leg61 表外键：能装一句话，但仍不许写成散文
// ★leg61：**`定位` 的上限单独放宽**（实测依据）：真机验收里 `定位` 有 211/339 条，其中不少是
//   `定位: 金刚霸体，憨厚神力`（26 字）/`定位: 圣心悟性机关天才` 这种"体质+性情"的组合原话——
//   30 字会把长的那一批从中间砍掉，而这一栏恰恰是模型最没处放、最常被塞东西的一格。
//   ★放宽上限**不解决"串栏"**（那是提示词口径的事）；它只保证"不因为截断而丢原文"。
export const BOOK_FIELD_MAX_WIDE = 60;
const WIDE_FIELD_KEYS = new Set(['定位', '身份']);   // 这两个键真书里常写成一句话
export const BOOK_FIELD_TOP = 24;          // leg61：每条实体的属性项数上限（防模型灌一长串撑裂账本）
export const BOOK_FIELD_EVIDENCE = true;   // leg61：出处闸总开关（判据要能单独测，故做成常量）

// 键名形态闸（leg61）：只收**像属性名的短键**——排除模型把整句话当键、或把 `{}`/`<>` 这类占位符当键
//   （占位符那一条与 §D 的 `<user>` 同族：它真的在原文里，所以出处闸抓不住它）。
const FIELD_KEY_RE = /^[\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_·\-]{0,9}$/;

/**
 * 出处闸（leg61）：值能不能在本书原文里找回它自己。
 * ★这不是"格式校验"——它是"只提取不创作"这条不可违的**可判等化**：
 *   模型可以自由命名新属性（键开放），但**值必须来自这本书**；对不上 ⇒ 标「（推）」，绝不静默丢。
 * 判据三步（全部纯函数、零词表、零模型）：
 *   ① 整串出现 ⇒ 原文；
 *   ② 原文里有 `维度 + 数值` 这种连续片段（`勇武99` / `内功105`）⇒ 数值出现即算原文；
 *   ③ 其余 ⇒ 推断（`source:'模型推断'`，显示时带「（推）」，与 `parentSource` 的既有口径同尺）。
 */
export function fieldEvidenceOf(value, sourceText) {
    const v = String(value ?? '').trim();
    const src = String(sourceText ?? '');
    if (!v) return 'inferred';
    if (!src) return 'inferred';                       // 没给原文 ⇒ 一律按推断处理（不许默默当原文）
    if (src.includes(v)) return 'verbatim';
    const nums = v.match(/\d+(?:\.\d+)?/g);
    if (nums && nums.length) {
        const parts = v.split(/[\s/|·、,，]+/).map((s) => s.trim()).filter(Boolean);
        let hit = 0;
        for (const p of parts) {
            if (p.length < 2) continue;
            if (src.includes(p)) { hit += 1; continue; }
            const stem = p.replace(/\d+(?:\.\d+)?/g, '').trim();
            const num = p.match(/\d+(?:\.\d+)?/);
            if (stem && num) {
                const re = new RegExp(`${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：]?\\s*${num[0]}`);
                if (re.test(src)) { hit += 1; continue; }
            }
        }
        if (hit > 0 && hit >= Math.ceil(parts.length / 2)) return 'verbatim';
    }
    return 'inferred';
}

// ★★leg60（用户令「把抽象这件事做好了，泛用化设计」）：**别名通道修活**——本棒最贵的一处。
//   病灶（两条实证，不是推理）：
//     ① 夹具 `test/fixtures/extract-samples.json:6` 录着**真模型输出** `{name:'白小娥',aliases:['小娥']}`
//        ⇒ 模型**一直在交别名**；
//     ② `ssot.schema.js:69` 登记了 `aliases` 这个**契约键**，`dedupeRoster` 整条并查集（leg25 g）
//        就是靠"名字 ∪ 别名"做跨块归一的。
//   而 `sanitizeCanon` 的名册项**只收 `{name, kind}`** ⇒ 别名在**净化层被静默丢弃**（无声、无 error、无 warning）
//     ⇒ leg25 g 那整套"跨块归一"**从 leg24 片1 起一次都没生效过**。
//   ★这是本仓反复登记过的"**删字段只删一半**"（同款留档见 `settle.js:112`：attrs/hurtWindow 两处摘除）。
//     判据为什么没咬到：`test/roster-merge.test.js` 全程**直接喂 `dedupeRoster`** 手工对象
//     ⇒ 锁住了**机制**，没锁住**接线**（"给了就合对"全绿，而"根本没给"没人锁）。
//   症状（真账，两本各一条）：三国 85 实体里 `曹操` 与 `曹孟德` 各占一条、`大汉/汉室/东汉` 三条并列；
//     大荒 152 个势力里 108 个空壳——**正是 leg25 g 当初要治的病**：治了，线没接上。
//   纪律与 `sanitizeBookFields` 同尺：只收字符串 · trim · 空串丢 · 与正名相同者丢 · 去重 ·
//     每项 ≤ BOOK_ALIAS_CHAR · 每条 ≤ BOOK_ALIAS_MAX（防模型灌一长串撑裂账本）。
export const BOOK_ALIAS_MAX = 8;
export const BOOK_ALIAS_CHAR = 30;
// ★leg60：维度/刻度每项的长度上限（与 `BOOK_FIELD_MAX` 同尺——防模型把"取值范围"写成一段散文）
export const BOOK_DIM_MAX = 30;
export function sanitizeAliases(rawAliases, name) {
    if (!Array.isArray(rawAliases)) return null;
    const self = String(name ?? '').trim();
    const out = [];
    for (const a of rawAliases) {
        if (typeof a !== 'string') continue;            // 数字/对象不是"叫法"
        const s = a.trim();
        if (!s || s === self || out.includes(s)) continue;
        out.push(s.length > BOOK_ALIAS_CHAR ? s.slice(0, BOOK_ALIAS_CHAR) : s);
        if (out.length >= BOOK_ALIAS_MAX) break;
    }
    return out.length ? out : null;
}

/**
 * 属性净化（leg61 改口径：**键开放 · 值过出处闸**）。
 *   旧口径（第二十五棒 e）：只收 `BOOK_FIELD_KEYS` 白名单里的键，别的键一律丢。
 *   新口径：常用键照旧；**表外键也收**，但要过 `fieldEvidenceOf`（值必须能在本书原文里找到）。
 * 纪律：只收字符串（数值/对象不是"属性原话"，引擎不换算）· trim · 空串丢 · 与正名相同的丢 ·
 *   键过名号形态闸 · 每条实体 ≤ `BOOK_FIELD_TOP` 项 · 超长截断（截断留痕由调用方汇总）。
 * 返回 `{ fields, inferred, unknown, truncated }`；`inferred` = 值对不上原文的键名（调用方标「（推）」并留痕）。
 */
export function sanitizeBookFields(rawFields, kind, { sourceText = '' } = {}) {
    const allow = BOOK_FIELD_KEYS[kind] || [];
    if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return null;
    const out = {};
    const known = new Set(allow);
    const inferred = [];
    const unknown = [];
    let truncated = 0;
    const addKey = (key, val, { isKnown }) => {
        if (typeof val !== 'string') return;               // 非字符串（数字/数组/对象）一律不收——不许把档位换算成数
        const v = val.trim();
        if (!v || v === key) return;
        if (isKnown) {
            // 常用键：`定位`/`身份` 走宽档（真书里常是一句话），其余保持旧上限 30
            const cap = WIDE_FIELD_KEYS.has(key) ? BOOK_FIELD_MAX_WIDE : BOOK_FIELD_MAX;
            out[key] = v.length > cap ? v.slice(0, cap) : v;
            if (v.length > cap) truncated += 1;
            return;
        }
        if (!FIELD_KEY_RE.test(key)) return;               // 键名形态闸（挡占位符与整句话当键）
        if (BOOK_FIELD_EVIDENCE && fieldEvidenceOf(v, sourceText) !== 'verbatim') {
            inferred.push(key);
            return;                                        // 表外键 + 值对不上原文 ⇒ 不收（不许靠一条新键偷偷创作）
        }
        out[key] = v.length > BOOK_FIELD_MAX_OPEN ? v.slice(0, BOOK_FIELD_MAX_OPEN) : v;
        if (v.length > BOOK_FIELD_MAX_OPEN) truncated += 1;
        unknown.push(key);
    };
    for (const k of allow) addKey(k, rawFields[k], { isKnown: true });              // 常用键优先（顺序稳定）
    for (const k of Object.keys(rawFields)) {
        if (known.has(k)) continue;
        if (Object.keys(out).length >= BOOK_FIELD_TOP) break;
        addKey(k, rawFields[k], { isKnown: false });
    }
    // 所属要过同一把尺（书里的层级路径 `/太素帝` 在此收口）
    if (out['所属']) {
        const p = normalizeParentName(out['所属']);
        if (p) out['所属'] = p; else delete out['所属'];
    }
    if (!Object.keys(out).length) return { fields: null, inferred, unknown, truncated };
    return { fields: out, inferred, unknown, truncated };
}

// leg23 照书办②：书声明的名号**强制并册** + 照标签定类别 + 照标签落上级（一处定义，大书/小书共用）。
// 语义：缺失 → 补入册（书声明过的名号不许丢）；已在册但类别与书标签不符 → 照书改判；
//       parent 仅在名册尚无该键时写入（first-wins——书正文/模型读到的明述优先，标签只补缺）。
// 就地修改 bookEntities（调用方持克隆态），返回 {bookEntities, added, fixed}。
export function applyDeclaredToRoster(bookEntities, declared) {
    const list = bookEntities || [];
    let added = 0;
    let fixed = 0;
    for (const d of declared) {
        const parent = normalizeParentName(d.parent);
        const mine = list.find((b) => b.name === d.name);
        if (!mine) {
            const item = { name: d.name };
            // ★leg60：kind **只在书真给了类别时才写**——题名面（"题名即名册"，见 init-source 的
            //   `deriveTitleRoster`）剥出来的名号**判不出类别**，写一个 `undefined` 进册会让
            //   `ssot.schema` 的 enum 校验面对一个"有键无值"的字段（本仓"键在值为空"那条口径的反面）。
            //   不写 = 下游按既有缺省（character）走，与 `sanitizeCanon` 的缺省口径一致。
            if (d.kind) item.kind = d.kind;
            if (parent) item.parent = parent;
            list.push(item);
            added += 1;
            continue;
        }
        if (d.kind && mine.kind !== d.kind) { mine.kind = d.kind; fixed += 1; }
        if (parent && !mine.parent) mine.parent = parent;
    }
    return { bookEntities: list, added, fixed };
}

async function callOnceWithDeclared(extract, text, declared) {
    return callOnce(extract, text, (t) => buildRosterPrompt(t, declared));
}

// 净化：形状合法为止（逐项取好弃坏，errors 记录坏项）；硬失败仅"输出非对象"。
// ★leg60：把"照书办"的两路声明合起来——① 正文里的结构标签（带类别/上级）② **题名面**
//   （`init-source.deriveTitleRoster` 剥出来的名号，零 token；不带类别）。
//   为什么题名面也算"照书办"：书名本身就是书的一部分——**作者把 cast 写在题名里**
//   （三国 `控制器_张辽`×187 / `张辽正史`×184 / `甄宓人设控制`×32），而模型只抽到 127 条。
//   纪律：标签先（它带类别与上级），题名面只补缺、**绝不改判已有条目的类别**。
function mergeDeclared(tags = [], titled = []) {
    const out = [...tags];
    const seen = new Set(tags.map((d) => d.name));
    for (const d of (Array.isArray(titled) ? titled : [])) {
        const n = String(d?.name ?? '').trim();
        if (!n || seen.has(n)) continue;
        seen.add(n);
        out.push({ name: n });
    }
    return out;
}

export function sanitizeCanon(raw, { sourceText = '' } = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['抽取输出非对象（真形状净化：不可靠即拒绝）'] };
    }
    const errors = [];
    const canon = { powerScale: [], dims: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: [], settings: [] };
    // ★leg61：`present` = **模型这一块真的交了哪几项**（"设定" / "属性"）。
    //   为什么必须有它：净化层把 canon 每一项都**预置成空值**（空数组/空串），于是"有没有值"与
    //   "有没有这个键"在下游分不开——`present` 就是那条分界线（属性遍的止损判据读它）。
    const present = [];

    if (Array.isArray(raw.powerScale)) {
        for (const it of raw.powerScale) {
            if (!it || typeof it !== 'object') { errors.push('powerScale 含非对象项（已弃）'); continue; }
            const level = String(it.level ?? '').trim();
            const note = String(it.note ?? '').trim();
            if (!level || !note) { errors.push('powerScale 项缺 level/note（已弃）'); continue; }
            canon.powerScale.push({ level, note });
        }
    } else if (raw.powerScale !== undefined) errors.push('powerScale 非数组（已弃）');

    // ★leg60：维度与刻度（`[{name, range}]`）——**照抄原文**，同名去重，逐项 ≤ BOOK_DIM_MAX 字。
    //   纪律与 `sanitizeBookFields` 同尺：只收字符串（数值/对象不是"维度名"）· trim · 空串丢 ·
    //   `range` 原文没写就**不写这个键**（"键在值为空"那条口径的反面：没有就是没有，不落占位）。
    if (raw.dims === undefined) {
        // 省略合法（本书没有成文的维度/刻度）
    } else if (Array.isArray(raw.dims)) {
        const seenDim = new Set();
        for (const it of raw.dims) {
            if (!it || typeof it !== 'object') { errors.push('dims 含非对象项（已弃）'); continue; }
            const name = String(it.name ?? '').trim();
            if (!name) { errors.push('dims 项缺 name（已弃）'); continue; }
            if (seenDim.has(name)) continue;
            seenDim.add(name);
            const range = String(it.range ?? '').trim();
            const item = { name: name.length > BOOK_DIM_MAX ? name.slice(0, BOOK_DIM_MAX) : name };
            if (range) item.range = range.length > BOOK_DIM_MAX ? range.slice(0, BOOK_DIM_MAX) : range;
            canon.dims.push(item);
        }
    } else errors.push('dims 非数组（已弃）');

    if (Array.isArray(raw.rules)) {
        for (const r of raw.rules) { const s = String(r ?? '').trim(); if (s) canon.rules.push(s); }
    } else if (raw.rules !== undefined) errors.push('rules 非数组（已弃）');

    if (typeof raw.society === 'string') canon.society = raw.society.trim();
    else if (raw.society !== undefined) errors.push('society 非字符串（已置空）');

    if (typeof raw.techOrMagic === 'string') canon.techOrMagic = raw.techOrMagic.trim();
    else if (raw.techOrMagic !== undefined) errors.push('techOrMagic 非字符串（已置空）');

    if (Array.isArray(raw.historyNotes)) {
        for (const h of raw.historyNotes) { const s = String(h ?? '').trim(); if (s) canon.historyNotes.push(s); }
    } else if (raw.historyNotes !== undefined) errors.push('historyNotes 非数组（已弃）');

    // leg20 世情路径恢复（v1 有局势抽象，v2 断于 K38 重写）：situation=当前天下大势一句（原文措辞）
    if (raw.situation === undefined) {
        // 省略合法（原文无全局局势可引）
    } else if (typeof raw.situation === 'string') {
        const sit = raw.situation.trim();
        canon.situation = sit.slice(0, 200);
        if (sit.length > 200) errors.push('situation 超 200 字（已截断到防御上限）');
    } else {
        errors.push('situation 非字符串（已置空）');
    }

    // K37 书名录：只提取不创作——name 原文名去重；kind 枚举净化（非法/缺省=character）
    // 第十九棒：kind 三值（location=地名不入实体池，canon 保留备位置机制）；parent 净化（书中明述才填，字符串）
    // leg24 片1（停抄书）：抽取输出**只收 name/kind/parent**——parent 仅存于「照书办」（书标签声明的上级，
    //        applyDeclaredToRoster 照抄进来），模型侧不再抽上级；attrs/race/location/evidence 一概不读
    //        （旧账里可能还有这些字段：schema 保留、引擎不读不写不覆盖，旧世界零扰动）。
    // 第二十五棒实机修正（用户："归属也没回写"）：parent 必须过 normalizeParentName——
    //   实况：模型把书里的层级路径写成 `/太素帝`（带前导斜杠），9 条真归属因此全部对不上册、
    //   `seedBookEntities` 判"上级不在册 → 弃隶属"，界面 623 行「归属空着」。去斜杠后 9/9 名号都在册。
    if (Array.isArray(raw.bookEntities)) {
        const seen = new Set();
        const byName = new Map();
        for (const it of raw.bookEntities) {
            if (!it || typeof it !== 'object') { errors.push('bookEntities 含非对象项（已弃）'); continue; }
            const name = String(it.name ?? '').trim();
            if (!name) { errors.push('bookEntities 项缺 name（已弃）'); continue; }
            // ★leg60：同名重复不再"整条丢"——**别名并进已收的那条**（"缺什么补什么"同款）。
            //   旧法只 `continue`：模型在同一块里把 `曹操` 出两次、别名各带一半（孟德 / 阿瞒）时，
            //   第二条被整条丢弃 ⇒ 半个别名表消失（而别名正是跨块归一的唯一输入）。
            if (seen.has(name)) {
                const kept = byName.get(name);
                const more = sanitizeAliases(it.aliases, name);
                if (kept && more) {
                    const merged = [...(kept.aliases || [])];
                    for (const a of more) if (!merged.includes(a) && merged.length < BOOK_ALIAS_MAX) merged.push(a);
                    if (merged.length) kept.aliases = merged;
                }
                continue;
            }
            seen.add(name);
            const kind = it.kind === 'faction' ? 'faction' : it.kind === 'location' ? 'location' : 'character';
            const parent = normalizeParentName(it.parent);
            const item = { name, kind };
            // ★leg60 别名通道（见 sanitizeAliases 头部注释：这一行此前缺失 ⇒ 跨块归一从未生效）
            const aliases = sanitizeAliases(it.aliases, name);
            if (aliases) item.aliases = aliases;
            if (parent) item.parent = parent;
            // 第二十五棒 e（用户令「按 v1 那样把所有的东西都初步建立好」）：**照书抄属性**回到初始化。
            //   v1 的名册层就抽 affiliation（所属）/ power（紧贴名号的档位原话），v2 的 leg24「停抄书」把它们
            //   一起砍了、替代通道（用到时查书）只接回实力/位置 ⇒ 归属永远 0/623（真账实测）。
            //   纪律：**照抄成文本**（实力=「T9渡劫巅峰」这类原话，引擎不换算、不进公式——START-HERE §2 第 1 条）；
            //   字段按 kind 白名单收，逐项 trim + 上限 30 字符（防模型写长句撑裂账本）。
            // ★★leg61：白名单 → **键开放 + 出处闸**（见 `sanitizeBookFields` 头注）。
            //   判据：`inferred`（值对不上原文的表外键）**丢弃并留痕**——留痕而不是静默，
            //   所以这里把每个被丢的键写进 `errors`（会汇总进 `setting.frozen.errors`）。
            const f = sanitizeBookFields(it.fields, kind, { sourceText });
            if (f) {
                if (f.fields) item.fields = f.fields;
                if (f.inferred.length) errors.push(`「${name}」的属性 ${f.inferred.join('/')}：值在原文里找不到 ⇒ 已丢（键开放但值必须有出处）`);
                if (f.unknown.length) errors.push(`「${name}」带表外属性 ${f.unknown.join('/')}（值有原文出处，已收）`);
            }
            canon.bookEntities.push(item);
            byName.set(name, item);          // ★leg60：同名再出现时用于并别名（见上方注释）
        }
    } else if (raw.bookEntities !== undefined) errors.push('bookEntities 非数组（已弃）');

    // ★leg61：**属性+设定遍**交的条目（`entities`，键开放、值过出处闸）——形状与名册条目同构，多了 fields。
    //   为什么不复用 `bookEntities`：那一遍的职责是"名号一个不许漏"，这一遍是"属性逐字照抄"；
    //   分成两个键 ⇒ ①名册的产量不被属性摊薄 ②合并端能分别记账（哪一遍交的、交了多少）。
    //   下游（`extractWorldSetting`）把它**并入名册**：同名归并、**绝不新造实体**。
    const rawEnts = Array.isArray(raw.entities) ? raw.entities : (raw.entities !== undefined ? (errors.push('entities 非数组（已弃）'), []) : []);
    for (const it of rawEnts) {
        if (!it || typeof it !== 'object') { errors.push('entities 含非对象项（已弃）'); continue; }
        const name = String(it.name ?? '').trim();
        if (!name) { errors.push('entities 项缺 name（已弃）'); continue; }
        const kind = it.kind === 'faction' ? 'faction' : it.kind === 'location' ? 'location' : 'character';
        const item = { name, kind };
        const parent = normalizeParentName(it.parent);
        if (parent) item.parent = parent;
        const f = sanitizeBookFields(it.fields, kind, { sourceText });
        if (f) {
            if (f.fields) item.fields = f.fields;
            if (f.inferred.length) errors.push(`「${name}」（属性遍）的属性 ${f.inferred.join('/')}：值在原文里找不到 ⇒ 已丢`);
        }
        if (item.fields && Object.keys(item.fields).length) canon.settings.push(item);   // 没属性的条目不收：这一遍不是名册（见 buildSettingPrompt 纪律 6）
    }

    // 张力三件：极/方向取原文措辞；模型侧 intensity 一律丢弃（引擎算，K29）
    const tension = {
        polarity: String(raw?.tension?.polarity ?? '').trim(),
        direction: String(raw?.tension?.direction ?? '').trim(),
    };
    if (raw?.tension?.intensity !== undefined) errors.push('tension.intensity 由引擎计算，模型输出已丢弃');

    // 世界参数档位（leg26 改口径：**数值 → 档位原话**）。
    //   为什么改（用户令「删掉没用的功能，改个定义就好了」）：原来抽的是四个 0~1 的数（`dynamic.env`），
    //     而引擎没有任何判据读它们（片3 后门控/镜头/裁定/退休/波及全换结构判据）——**那四个数没有消费者**，
    //     却是引擎自己按锯齿推出来的"世界气压"，还驱动越阈落写死的事件台词 ⇒ 违反"引擎不发明事实"。
    //   现在：值只能是 `PARAM_GEARS` 里的**档位词**（白名单验伪）；**书里给了才落账**（空着就是空着）；
    //     玩家可在「参数」页自行改档（引擎照抄，不换算、不进公式）。
    const env = {};
    for (const key of PARAM_KEYS) {
        const v = raw?.env?.[key];
        if (v === undefined) continue;                       // 书未明述 → 不写键（绝不落占位值）
        const norm = normalizeParam(key, v);                 // 只认本表档位词
        if (norm) env[key] = norm;
        else errors.push(`env.${key} 不是本书档位词（已弃该键，账面留空；合法档位：${PARAM_GEARS[key].join('/')}）`);
    }
    // leg24 片5（留痕收口）：净化层的坏项（非法 env/坏 bookEntities 项等）**上报到调用方的 errors**——
    // 旧法只在 callOnce 内部消化，`ok` 时静默丢弃：账面上少了东西却没有任何提示（"每条变更留痕"的反面）。
    // ★leg61：登记"模型真的交了哪几项"（见 `present` 的声明处：净化层预置空值 ⇒ 下游分不开有无）
    for (const k of ['powerScale', 'dims', 'rules', 'society', 'techOrMagic', 'historyNotes', 'situation']) {
        if (raw[k] !== undefined) present.push('setting');
    }
    if (raw.entities !== undefined) present.push('attributes');
    if (Array.isArray(raw.bookEntities)) present.push('roster');
    const shapeWarnings = errors.slice();
    return { ok: true, canon, tension, env, errors, shapeWarnings, present };
}

// ★leg60（交接第 3 件）：`compile` = **编译完整性读数**（来自 `init-source` 的声明面探测与自检）。
//   为什么要落进账本、而不是只打一行控制台：这是**用户口径**里那句"以后哪个体系没抽出来，
//   不用再靠翻磁盘对账"——读数必须跟账走（换聊天、换机器都还在），否则下一个人又得回磁盘翻书。
//   全部是**数字与短题名**（形态固定、无散文）⇒ 不违反"账里不存原值"那条纪律（这里存的是**覆盖率**，不是原文）。
export function assembleSetting({ canon, tension, env, legacyTension, fingerprint, extractedAt, compile = null }) {
    return {
        frozen: { fingerprint, extractedAt, canon, ...(compile ? { compile } : {}) },
        dynamic: {
            tension: {
                // 极性必填（K24 schema：≥1 字符）；书里没有可引的极时，落引擎状态词「未聚」
                //（= 大势未聚的合法状态，ANCHOR §4.5；状态词非模型创作）
                polarity: String(tension.polarity || '').trim() || '未聚',
                direction: String(tension.direction || '').trim(), // 可省=僵持（K24 形状口径）
                intensity:
                    typeof legacyTension === 'number' && Number.isFinite(legacyTension)
                        ? Math.min(1, Math.max(0, legacyTension))
                        : TENSION_INIT_BASELINE,
            },
            env,
            derivedFrom: [],
        },
    };
}

// ★leg60：`EMPTY_CANON` 已删（零引用）——它唯一的用处是"五件套轮失败时降级空 canon"，
//   而 leg60 起设定与名册在**同一批调用**里同生共死，那个"降级空 canon"的失败面不存在了；
//   块间合并的空态由 `mergeCanonChunks([])` 直接给出（同一个形状，一处定义）。

// 单发小包装：prompt → 调用 → JSON 解析 → 净化；失败返回 {callError}
// buildPrompt 可传函数(t)→prompt（leg23：名册轮按块带书声明清单，故需闭包而非固定函数）
// ★★leg61：**瞬时失败重试**（用户真机实测：10 次调用里 2 次被网关 524 掐断，靠重试救回）。
//   为什么必须与"超时"分开（这是本处的全部理由，改它之前先读这三句）：
//     · `sw2Timeout`（我们自己的 AbortController 到点）= **超时 = 止损**，旧法已定"不重试"（见 tryRosterChunk 头注）；
//     · 而 524 / fetch failed / socket hang up 是**网关或链路**在 300 秒前把请求掐了，模型那边什么都不知道
//       ⇒ 这种错误重试**有救**，且不重试就是白丢一块（真账实证：块 3/块 4 各丢一次）。
//   重试次数有界（`EXTRACT_RETRY_TIMES`），且只对"瞬时"那一类重试，不放大 401/403 这类配置错的代价。
export const EXTRACT_RETRY_TIMES = 2;
export const EXTRACT_RETRY_WAIT_MS = 3000;
// 瞬时错判据（形态判据，不是"看心情"）：网关 5xx/524/522 · 链路断 · 无响应。
//   ★反向判据同样重要：401/403/404/429 与"超时"一律不重试（前三个是配置错、429 是限流、超时是止损）。
export function isTransientCallError(err) {
    if (!err) return false;
    if (err.sw2Timeout === true) return false;                       // 超时 = 止损，不重试
    const s = `${err.message || err}`;
    if (/\b(401|403|404|429)\b/.test(s)) return false;               // 配置错 / 限流：重试只会白烧
    if (/sw2Timeout|abort/i.test(s)) return false;
    return /\b(522|523|524|500|502|503|504)\b/.test(s) || /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|network/i.test(s);
}
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function callOnce(extract, text, buildPrompt = buildAbstractPrompt) {
    let rawText;
    let lastErr = null;
    for (let attempt = 1; attempt <= EXTRACT_RETRY_TIMES; attempt += 1) {
        try {
            rawText = await extract(buildPrompt(text));
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            // leg27：**超时与瞬时错必须分开**（旧法一律并成一句"抽取调用失败"⇒ 白烧 62 分钟/块，见 transport-http 文件头）
            //   `timeout: true` 是给 `tryRosterChunk` 的判据：超时不许对半拆、不许重试。
            if (attempt < EXTRACT_RETRY_TIMES && isTransientCallError(err)) {
                await sleep(EXTRACT_RETRY_WAIT_MS * attempt);
                continue;
            }
            break;
        }
    }
    if (lastErr) {
        return {
            callError: `抽取调用失败${EXTRACT_RETRY_TIMES > 1 ? `（已试 ${EXTRACT_RETRY_TIMES} 次）` : ''}: ${lastErr?.message || lastErr}`,
            timeout: lastErr?.sw2Timeout === true,
        };
    }
    if (typeof rawText !== 'string' || !rawText.trim()) return { callError: '抽取输出为空' };
    let raw;
    try {
        raw = JSON.parse(rawText.trim());
    } catch {
        return { callError: '抽取输出非法 JSON（真形状净化：不可靠即拒绝）' };
    }
    const cleaned = sanitizeCanon(raw, { sourceText: text });     // ★leg61：出处闸要用本块的原文
    if (!cleaned.ok) return { callError: cleaned.errors.join('; ') };
    return { cleaned, shapeWarnings: cleaned.shapeWarnings || [] };   // 净化坏项上报（leg24 片5 留痕收口）
}

// 行级分块：按累计字符 ≤ maxChar 切块（保行完整；超长单行自成一块）
export function chunkRows(rows, maxChar) {    const chunks = [];
    let cur = [];
    let curLen = 0;
    for (const r of rows) {
        const len = Array.from(r).length;
        if (cur.length && curLen + len > maxChar) {
            chunks.push(cur.join('\n'));
            cur = [];
            curLen = 0;
        }
        cur.push(r);
        curLen += len;
    }
    if (cur.length) chunks.push(cur.join('\n'));
    return chunks;
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27（用户令「二十多分钟很慢，**我也看不到日志不知道抽得怎么样**，你做吧」）：**抽取过程可见**。
// 病（读真码确认，不是感觉）：抽取期间**一行进度都没有**——`web/index.js` 只在开头写一句状态栏，
//   `diagExtract` 只在调用**返回之后**才出声，`logInitDiagnostics` 只在**整件事结束**才出声
//   ⇒ 6 次调用是个黑盒，"正在跑"与"已经卡死"在界面上**完全同形**（用户实机等 20+ 分钟无从判断）。
// 治法（分层纪律）：编排层**只上报事实**，不碰显示——显示端由调用方注入（浏览器传 DOM/console，
//   测试传数组），与 `autoComposeSource` 提成导出函数同一条治法（"接线必须有测试"）。
// 上报契约（`onProgress(event)`，事件是**事实**不是文案）：
//   { step:'canon'|'chunk', phase:'start'|'finish', index, count, chars, ms, ok, error? }
//   - `chars` = 该步真实输入字符数（回答"这块到底多大"）
//   - `ms`    = 该步真实耗时（回答"慢在哪块"，是本次改动的核心证据）
//   - `ok=false` 必带 `error`（回答"失败的是哪块、为什么"）
// 纪律：上报函数**抛错不许影响抽取**（观测面绝不能成为故障点）；返回串里附 `timing` 供诊断复述。
function makeProgressLog(onProgress) {
    const events = [];
    let last = null;
    const report = (ev) => {
        events.push(ev);   // ★本地留档（返回值里的 timing.steps 就是它——诊断/界面都能复述"这次多少段"）
        try { if (typeof onProgress === 'function') onProgress(ev); } catch (_) {}
        return ev;
    };
    return {
        events,
        start(step, index, count, chars) {
            last = Date.now();
            return report({ step, phase: 'start', index, count, chars: Number(chars) || 0 });
        },
        finish(step, index, count, chars, ok, error) {
            const ev = {
                step, phase: 'finish', index, count, chars: Number(chars) || 0,
                ms: last == null ? null : Date.now() - last, ok: ok !== false,
            };
            if (error) ev.error = String(error);
            last = null;
            return report(ev);
        },
    };
}

// 诊断/ UI 用的一行摘要（纯函数 · 零副作用）：把 progress 事件串成人看的实施清单。
// ★leg60 改口：**一段里同时抽设定与名册**了（旧文案把 'chunk' 段叫"名册第 x/N 块"——那句话现在是假的：
//   块里既出设定也出名册）。'canon' 这个段名保留识别（旧账/旧事件串仍可读），但新跑不会再产生它。
export function describeProgress(events) {
    return (Array.isArray(events) ? events : []).filter((e) => e && e.phase === 'finish').map((e) => {
        const label = e.step === 'canon' ? '设定与名册' : `第 ${e.index}/${e.count} 块（设定与名册）`;
        if (!e.ok) return `${label}：失败（${e.chars} 字符，${Math.round((e.ms || 0) / 1000)}s）——${e.error || '未知原因'}`;
        return `${label}：${e.chars} 字符，${((e.ms || 0) / 1000).toFixed(1)}s`;
    });
}

// ★leg25 g：书名录的**去重键 = 名字 ∪ 别名**（唯一一份实现，两个调用点共用——别复制，本仓吃过"两份复制品漂移"的亏）。
//   为什么必须带别名：实体/归属都按 `name` 精确查册，书里同一个势力常有多个叫法（条目名 `人族皇朝`、
//   key 里的 `大虞`/`大虞皇朝`）；模型分块抽取时只看得到自己那块，**跨块的别名无从归一**，
//   旧法又只按 `name` 判重 ⇒ 同一个势力被收成多条、各自都没成员（真账 152 个势力里 108 个空壳）。
//   纪律：名字与别名都**照抄书里的叫法**（不换算、不发明）；只做去重与拼字段，不生产新名号。
const rosterNorm = (v) => String(v ?? '').trim();
function rosterNamesOf(e) {
    const out = [];
    const push = (v) => { const s = rosterNorm(v); if (s && !out.includes(s)) out.push(s); };
    push(e?.name);
    for (const a of Array.isArray(e?.aliases) ? e.aliases : []) push(a);
    return out;
}
// 已收下的条目吸收一个新条目的信息：**一切按"缺什么补什么"，绝不覆盖已有**（明述优先、书序/正名优先）。
function absorbInto(kept, e) {
    if (!kept.kind && e.kind) kept.kind = e.kind;
    if (!kept.parent && e.parent) kept.parent = e.parent;
    if (!kept.location && e.location) kept.location = e.location;
    if (!kept.race && e.race) kept.race = e.race;
    if (e.fields && typeof e.fields === 'object') {
        kept.fields = { ...(e.fields || {}), ...(kept.fields || {}) };   // 已有键优先
    }
}
// ★导出是为了**能被真测**（与 autoComposeSource / bookEntriesForInherit 同一治法）：
//   跨块合并是"接线类"逻辑，只有真跑才能证明它把同义异名合掉了——否则又是"测试全绿而实机没合"。
//
// ★口径（**故意保持最简**）：
//   把每条条目的 `name` 与它的 `aliases` 看成同一实体的多个叫法 → **并查集合并**（同组 = 同一实体）；
//   每组取**最先出现**的那个叫法当 `name`，组内其余叫法全进 `aliases`；字段"缺什么补什么"，绝不覆盖。
//
// ★为什么是并查集而不是"逐个查表合并"（**对抗式自查当场抓出的真 bug**）：
//   旧写法是"来一条、找它有没有和已收下的撞名"，只能合**直连**的一对。实测真模型输出是这样的**链**：
//     `人族皇朝 ← [大虞、大虞皇朝]` 与 `大虞皇朝 ← [大虞]`（两块各出一条，共享 `大虞`）
//   ⇒ 旧法把第一条收下、第二条"没撞上已收的名字"又收下 ⇒ **留下 2 条，碎片没治好**（目的本身没达成）。
//   并查集是机械的：只要两个叫法出现在同一条里，它们就同组；组与组还会**传递合并**（A→B→C 也是 1 条）。
//
// 为什么砍掉"复杂裁决"（如实留档，别再加回去）：
//   为了让"书里更正式的那个名字"胜出，我曾加一套排序裁决（书里真有 `【名】` 条目 > 不是长名截断 >
//   被指认次数 > 名字长度 > 书序）。**四层规则，每层都在修上一层的洞**，且当场出真 bug：
//   `isTruncation` 写宽了一点 ⇒ `【名号10】` 里的"名号1"被判成截断 ⇒ `名号1000..1999` 排到队尾、
//   反而先被收下，再把真正的 `名号0..999` 当别名吃掉（既有书序锁当场红）。故整组裁掉。
//   代价（如实登记 G4）：正名可能落到一个较短叫法上（如 `大虞皇朝` 而不是 `人族皇朝`）；
//   **但所有叫法都保留在 aliases 里**，按名字或别名查册都能命中 ⇒ 对下游（归属/位置/展示）无影响。
export function dedupeRoster(entities = []) {
    // ① 只留有名字的条目（顺手去掉"名字/别名里的空白与非法项"——别名表里的 ""/null/数字一律不进来）
    const items = [];
    for (const e of entities) {
        if (!e || !rosterNorm(e.name)) continue;
        const aliases = [];
        for (const a of (Array.isArray(e.aliases) ? e.aliases : [])) {
            if (typeof a !== 'string') continue;              // 非字符串不是叫法
            const s = rosterNorm(a);
            if (s && s !== rosterNorm(e.name) && !aliases.includes(s)) aliases.push(s);
        }
        items.push({ e, name: rosterNorm(e.name), aliases });
    }
    // ② 并查集：把"同一条里出现过的叫法"全并到一组（父指针 + 路径压缩）
    const parent = new Map();
    const find = (x) => {
        let r = x;
        while (parent.get(r) !== r) r = parent.get(r);
        while (parent.get(x) !== r) { const nx = parent.get(x); parent.set(x, r); x = nx; }
        return r;
    };
    const union = (a, b) => {
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
        const ra = find(a); const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    };
    for (const it of items) {
        if (!parent.has(it.name)) parent.set(it.name, it.name);
        for (const a of it.aliases) union(it.name, a);
    }
    // ③ 分组：组内叫做法的**首次出现顺序**决定谁当 name（先见到的当正名）
    const order = new Map();                                  // 叫法 → 首次出现序号
    let seq = 0;
    for (const it of items) {
        for (const n of [it.name, ...it.aliases]) if (!order.has(n)) order.set(n, seq++);
    }
    const groups = new Map();                                 // 根 → [叫法…]
    for (const n of order.keys()) {
        const r = find(n);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(n);
    }
    // ④ 每组产出**一条**：name = 组内最先出现的叫法；其余叫法进 aliases；字段按书序"缺什么补什么"
    const out = [];
    for (const members of groups.values()) {
        members.sort((a, b) => order.get(a) - order.get(b));
        const inGroup = new Set(members);                     // 本组叫法（含链上的中间叫法）
        const primary = members[0];
        const kept = { name: primary };
        if (members.length > 1) kept.aliases = members.slice(1);
        for (const it of items) {
            // 只要这条条目的任何一个叫法落进本组，它就是本组成员 ⇒ 字段并入
            if (!inGroup.has(it.name) && !it.aliases.some((a) => inGroup.has(a))) continue;
            absorbInto(kept, it.e);
        }
        out.push(kept);
    }
    // ⑤ 组间按"该组最先出现的叫法"排回书序（保持确定性，仍是书序）
    out.sort((a, b) => order.get(a.name) - order.get(b.name));
    return out;
}

// 拆半递归（v1 tryChunk 同款精神）：块首试无效 → 对半拆（保内容，不空等重试）→ 拆不动保底重试一次 → 仍无效跳过降级。
// 返回 cleaned | null；两半合并走 mergeCanonChunks（leg60 起：**五件套与名册一起合**——旧法只并 bookEntities，
// 拆半会让"设定"那半边静默消失，而设定正是这一棒要抽的东西）。
// leg27 改（用户令「二十多分钟很慢，你做吧」）：**超时不再走拆半/重试，直接止损跳过**。
//   为什么必须有这条分支（实测真书算出来的，不是修辞）：拆半拆小的是**输入**，而超时主因是**生成时间**
//     （每次输出预算 16,384 tokens 固定，reasoning 还占盘）⇒ 对半拆等于"用两倍时间再赌一次"：
//     旧法单块最坏 1(原) + 2 + 4 + 8 + 16(拆到 depth=4) + 1(保底重试) = **31 次调用 × 120 秒 ≈ 62 分钟**，
//     而这 62 分钟之后**结果还是跳过**——纯烧时间不长数据。现在：一次 300 秒超时即跳过，把时间还给其余块。
//   "拆半"的原始理由（v1）仍然成立、仍然保留：那是治**输出被截断/网关空回复**（瞬时错，重试有救）。
// ★★leg60：**块间合并（纯函数 · 零模型 · 绝不摘要）**——大书"一遍抽完"的另一半。
//   口径（用户拍的，不是提案）：
//     · `powerScale`/`rules`/`historyNotes` ⇒ **并集去重**（同一本书的档位表可能分几处写，一条都不许丢）；
//     · `society`/`techOrMagic`/`situation` 这种"一句话"⇒ **取信息量最大的那块**（最长者胜，并列取先出现）；
//     · ★**绝不合成一句**——把两块的句子合成一句 = 让模型做摘要 = 创作，违背"只提取不创作"。
//       宁可只留一块的原话，也不许出现一句书里没有的话。
//     · `bookEntities` ⇒ **原样全堆**（跨块归一是 `dedupeRoster` 的职责，只做一次；这里不去重，
//       否则"先到先得"会把后出现的正名当重复丢掉——leg25 g 的教训）。
//     · `tension`/`env` ⇒ **首块为准**（首块 = 旧窗口头 3 万所在的那块 ⇒ 与旧行为连续；
//       env 是四个档位词，不是越长越对，所以这里不用"最长者胜"）。
//   为什么单独成函数、还导出：块间合并是一条**可以脱离模型复核**的纯函数（判据直接喂它）。
export function mergeCanonChunks(parts = []) {
    const list = (Array.isArray(parts) ? parts : []).filter((p) => p && typeof p === 'object');
    const powerScale = [];
    const dims = [];
    const rules = [];
    const historyNotes = [];
    const bookEntities = [];
    const settings = [];                    // ★leg61：属性+设定遍的条目（同名归并、不新造实体；见 sanitizeCanon）
    const seenPs = new Set();
    const seenDim = new Map();          // name → 已收的那条（range 缺什么补什么，同实体不重复）
    const seenRule = new Set();
    const seenHist = new Set();
    let society = '';
    let techOrMagic = '';
    let situation = '';
    for (const p of list) {
        const c = p.canon && typeof p.canon === 'object' ? p.canon : {};
        for (const it of (Array.isArray(c.powerScale) ? c.powerScale : [])) {
            const level = String(it?.level ?? '').trim();
            const note = String(it?.note ?? '').trim();
            if (!level || !note || seenPs.has(level)) continue;
            seenPs.add(level);
            powerScale.push({ level, note });
        }
        // ★leg60：维度并集（同名去重；后块只补 `range` 的空缺，绝不覆盖已有原话）
        for (const it of (Array.isArray(c.dims) ? c.dims : [])) {
            const name = String(it?.name ?? '').trim();
            if (!name) continue;
            const range = String(it?.range ?? '').trim();
            if (!seenDim.has(name)) {
                const item = { name };
                if (range) item.range = range;
                seenDim.set(name, item);
                dims.push(item);
            } else if (range && !seenDim.get(name).range) {
                seenDim.get(name).range = range;
            }
        }
        for (const r of (Array.isArray(c.rules) ? c.rules : [])) {
            const s = String(r ?? '').trim();
            if (!s || seenRule.has(s)) continue;
            seenRule.add(s);
            rules.push(s);
        }
        for (const h of (Array.isArray(c.historyNotes) ? c.historyNotes : [])) {
            const s = String(h ?? '').trim();
            if (!s || seenHist.has(s)) continue;
            seenHist.add(s);
            historyNotes.push(s);
        }
        const soc = String(c.society ?? '').trim();
        if (soc.length > society.length) society = soc;                 // 信息量最大那块（最长者胜）
        const tom = String(c.techOrMagic ?? '').trim();
        if (tom.length > techOrMagic.length) techOrMagic = tom;
        const sit = String(c.situation ?? '').trim();
        if (sit.length > situation.length) situation = sit;
        for (const b of (Array.isArray(c.bookEntities) ? c.bookEntities : [])) bookEntities.push(b);
        // ★leg61：属性遍条目按"名 + fields"并集去重（同一人在多块出现 ⇒ 合字段，不重复计）
        for (const b of (Array.isArray(c.settings) ? c.settings : [])) {
            const nm = String(b?.name ?? '').trim();
            if (!nm) continue;
            const prev = settings.find((x) => x.name === nm);
            if (!prev) { settings.push(b); continue; }
            prev.fields = { ...(b.fields || {}), ...(prev.fields || {}) };   // 已有键优先（先出现的那块的原话）
        }
    }
    const first = list[0] || {};
    return {
        canon: { powerScale, dims, rules, society, techOrMagic, historyNotes, situation, bookEntities, settings },
        tension: first.tension || { polarity: '', direction: '' },
        env: first.env || {},
    };
}

function mergeCleaned(a, b) {
    if (!a) return b;
    if (!b) return a;
    return mergeCanonChunks([a, b]);
}

// leg24 片1 删除位（原 leg20/leg21 `validateRosterDetails`）：属性/种族/所在的"书级出处校验"整块删除——
// 它守的是"从书里抄出来的字段别抄错"，而这些字段已不再抄。名号级的全书出处判定仍在 extractWorldSetting
// （纯编造的名号照旧丢：那守的是"账本不发明事实"，与抄不抄书无关）。

// onProgress（leg27 新增）：注入式进度上报——编排层不许 console 硬编码（测试注入"fake ctx 真跑"同治法）。
//   上报时机：**每块开始**（"正在抽第 x/N 块"）+ **每块结束**（耗时/结果/错误）。失败细节进 `progressLog`。
async function tryRosterChunk(extract, text, depth, probeState, { declared = [], onProgress = null, progressLog = null, buildPrompt = null, stopWhen = null } = {}) {
    const rosterPrompt = buildPrompt || ((t) => buildRosterPrompt(t, declared));   // leg23：本块内按书声明给召回清单
    const r = await callOnce(extract, text, rosterPrompt);        // leg21：名册轮专用瘦身 prompt
    // ★leg61：`stopWhen(cleaned)` —— **已收够就止损**（属性遍专用：与名册遍共用 ROSTER_CHUNK_DEPTH 语义）。
    //   为什么需要：属性遍要连跑 5~7 块，而设定/档位表常常在头两块就抽全了；
    //   不给止损就等于"用 4 次多余调用去问一块已经没有新东西的书文"，而 524 超时正随调用数放大。
    //   判据由调用方注入（形态判据，不是"看心情"）：见 extractWorldSetting 里那条。
    if (!r.callError) return stopWhen && stopWhen(r.cleaned) ? { cleaned: null, satisficed: true } : { cleaned: r.cleaned };
    probeState.failures += 1;
    // ★leg27：**超时 = 止损**（不拆半、不重试）——理由见上方注释；失败如实进 progressLog，供界面显形。
    if (r.timeout) {
        if (progressLog) progressLog.push({ step: `chunk@depth${depth}`, kind: 'timeout', chars: Array.from(text).length, error: r.callError });
        return { cleaned: null };
    }
    if (depth < ROSTER_CHUNK_DEPTH) {
        const lines = text.split('\n').filter(Boolean);
        if (lines.length > 1) {
            const mid = Math.ceil(lines.length / 2);
            const halfA = await tryRosterChunk(extract, lines.slice(0, mid).join('\n'), depth + 1, probeState, { declared, onProgress, progressLog });
            if (halfA.aborted) return halfA;
            const halfB = await tryRosterChunk(extract, lines.slice(mid).join('\n'), depth + 1, probeState, { declared, onProgress, progressLog });
            if (halfB.aborted) return halfB;
            return { cleaned: mergeCleaned(halfA.cleaned, halfB.cleaned) };
        }
    }
    // 拆不动（单条/深度到底）→ 保底重试一次（v1 同款）
    const retry = await callOnce(extract, text, rosterPrompt);
    if (!retry.callError) return { cleaned: retry.cleaned };
    probeState.failures += 1;
    if (progressLog) {
        progressLog.push({
            step: `chunk@depth${depth}`, kind: retry.timeout ? 'timeout' : 'error',
            chars: Array.from(text).length, error: retry.callError,
        });
    }
    return { cleaned: null };
}

// leg24 片1 删除位（原 leg21 属性轮 `runAttrsRound` + K49 关系轮 `runRelationRound` + 两轮共用的
// 批切分 `batchRowsByName` / 名号行邻域匹配 `nameInRow`）：**整条"抽书"流水线删除**（不是停用）。
// 四维数值的正当来源改为主调用里 LLM 的逐轮提议 + 引擎钳制（settle 既有通道，本片不动）；
// 隶属/所在改走「照书办」（书标签声明）+ 用得着时查书（片2）。
// 留档：两条路线都实测过并各自有硬数据——属性轮=leg21 拆轮（名册 504→106 的回归修法）、
// 关系轮=K49（真机势力→势力 parent 仅 3%）；它们的产出全属"书的副本"，故一并退场。

// 执行器：{sourceText, extract, cache?, force?, extractedAt?, legacyTension?, extraDeclared?, compileInfo?}
//   → {ok, setting, cached, fingerprint, errors}
// ★leg60 `extraDeclared`：**题名面**（`init-source.deriveTitleRoster` 剥出来的名号：零 token、纯函数）。
//   它走"照书办"同一条通道——强制并册（模型漏了也不丢）+ 参与全书级出处判定（**题名也是这本书的一部分**）。
// ★leg60 `compileInfo`：**编译完整性读数**（声明面探测结果）——落进 `setting.frozen.compile`（见 assembleSetting）。
// 第十八棒：小书（≤ CANON_SRC_CHAR）单发全量；大书=**全条目分块多调用、一遍抽完**
//   （leg60 起五件套与名册在同一批块里同生共死——旧法"五件套只读头 3 万"那一次已整条删除）。
export async function extractWorldSetting({ sourceText, extract, cache, force = false, extractedAt, legacyTension, onProgress = null, extraDeclared = [], compileInfo = null }) {
    const titled = (Array.isArray(extraDeclared) ? extraDeclared : [])
        .map((d) => ({ name: String(d?.name ?? '').trim() }))
        .filter((d) => d.name);
    const titledNames = new Set(titled.map((d) => d.name));
    const src = String(sourceText ?? '');
    const fp = bookFingerprint(src);
    const stamp = extractedAt || new Date().toISOString();
    const progress = makeProgressLog(onProgress);   // leg27：进度/耗时上报（编排层只报事实，显示端注入）
    const t0 = Date.now();
    // leg27：把"这次到底干了多久/几次调用/每步多大"打包进返回值（诊断面可复述，不靠猜）
    const timingOf = (mode, calls, srcChars) => ({ mode, srcChars, calls, ms: Date.now() - t0, steps: progress.events });

    if (!force && cache) {
        const hit = cache.get(fp);
        if (hit && hit.canon && typeof hit.canon === 'object' && !Array.isArray(hit.canon)) {
            const v = hit.canon;
            return {
                ok: true,
                cached: true,
                fingerprint: fp,
                setting: assembleSetting({ canon: v.canon, tension: v.tension || { polarity: '', direction: '' }, env: v.env || {}, legacyTension, fingerprint: fp, extractedAt: hit.extractedAt }),
            };
        }
    }

    if (typeof extract !== 'function') return { ok: false, errors: ['未提供抽取调用（extract 注入缺失）'] };
    const errors = [];
    const srcLen = Array.from(src).length;

    // 小书：单发全量（现语义零变化）；空/失败自动重试一次（v1 教训：网关对长输入偶发空回复，director 注释实证）
    if (srcLen <= CANON_SRC_CHAR) {
        // leg23 照书办：小书同过声明扫描（同书同口径——不因书短就换规矩）
        const { declares: smallDeclared, usesLabelTerms: smallTerms } = scanBookDeclarations(src);
        if (smallTerms.length) errors.push('照书办: 检测到词表判据参与声明扫描（应为形态判据，请核查）');
        progress.start('canon', 1, 1, srcLen);
        const r = await callOnceWithDeclared(extract, src, smallDeclared)
            .then((first) => (first.callError ? callOnceWithDeclared(extract, src, smallDeclared) : first));   // 空/失败重试一次（v1 瞬时网关教训）
        progress.finish('canon', 1, 1, srcLen, !r.callError, r.callError);
        if (r.callError) {
            return {
                ok: false,
                errors: [`抽取失败（已重试一次）：${r.callError}——可再点重试；反复出现请检查模型通道或换小源验证`],
                timing: { mode: 'small', srcChars: srcLen, ms: null, steps: progress.events },
                progress: progress.events,
            };
        }
        errors.push(...(r.shapeWarnings || []));   // leg24 片5：净化坏项上报（如 env 非法值弃键）
        const applied = applyDeclaredToRoster(r.cleaned.canon.bookEntities, mergeDeclared(smallDeclared, titled));
        if (smallDeclared.length || titled.length) {
            errors.push(`照书办: 声明面 ${smallDeclared.length + titled.length} 个名号（标签 ${smallDeclared.length} / 题名 ${titled.length}；补入册 ${applied.added} / 改判类别 ${applied.fixed}）`);
        }
        const setting = assembleSetting({ canon: r.cleaned.canon, tension: r.cleaned.tension, env: r.cleaned.env, legacyTension, fingerprint: fp, extractedAt: stamp, compile: compileInfo });
        if (cache) cache.set(fp, { canon: r.cleaned.canon, tension: r.cleaned.tension, env: r.cleaned.env }, stamp);
        return {
            ok: true, cached: false, fingerprint: fp, setting, errors,
            timing: timingOf('small', progress.events.filter((e) => e.phase === 'finish').length, srcLen),
        };
    }

    // ★★★leg60（用户令「把抽象这件事做好了，泛用化设计」）：**大书不再"五件套读头 3 万 + 名册读全"**。
    //   旧口径把**同一本书喂了两遍**：名册轮读全（`ROSTER_CHUNK_CHAR`=60000/块），五件套轮只读开头
    //   （`Array.from(src).slice(0, CANON_SRC_CHAR)`）——一遍读全、一遍只读头 15%。
    //   真账代价（三国那本）：真正的档位表 `演义战力体系`（`T0级_天下无双 数值标定 勇武100`…）在窗口外，
    //   模型从没见过 ⇒ 它照着窗口里唯一那张表（【声誉】清名五级+恶名五级）填了 `powerScale`
    //   （真账逐字：`里闾称善…遗臭斧钺`）。**不是模型错，是取样错。**
    //   现在：**同一批块、一遍抽完**——块里有什么就抽什么（这一块的名号 + 档位表/法则/体系/史略 + 属性原话）。
    //   ★块数与名册轮**逐字相同**（同一把 60000 的尺子）：不新增机制，总输入反而更小
    //     （旧法 30000 + 198063 = 228063 字 → 新法 198063 字）。三国 4 块 · 大荒 5 块 · re0 2 块。
    //   ★★同时取消**大小书的分叉**：小书那条路（`srcLen <= CANON_SRC_CHAR`）此前用的是"只问名号"的
    //     提示词 ⇒ 四本 ≤3 万的真书（Eldoria 4168 / Global 438 / 实教 9158 / 综漫 14557）**canon 恒空**
    //     （`powerScale`/`rules`/`society` 一个值都没有，实测复现）。同一件事两个尺寸两条路，就是这个洞的根。
    //     现在**大小书共用同一份合并提示词**，小书 = 1 块（调用次数不变）。
    //   ★块间合并的纪律（用户口径）：`powerScale`/`rules`/`historyNotes` **并集去重**；
    //     `society`/`techOrMagic`/`situation` 这种"一句话"取**信息量最大的那块**——**绝不合成一句**
    //     （合成 = 让模型做摘要 = 创作，违背"只提取不创作"）。见 `mergeCanonChunks`。
    // ★★★leg58 留档（"挑得更准的取样"这条路已量过、已否，别再走回来）：
    //   本棒做了 `pickCanonSource`（体系条目优先），接上去之前先出了数，结果是**它没解决问题**
    //   （`docs/measure-leg58-canon-sampling.md`）：
    //     · 三国启用 264 条里 `演义战力体系` 是 `disable=true` ⇒ **根本不在输入集合里**，
    //       任何"挑得更准"的取样都变不出这条（★这条正是 leg60 要治的真病：见 init-source 的禁用仓储问题）；
    //     · 剩下的体系类信号**挑不出真体系条目**：264 条里 220 条是 JS 脚本，人物档案（`基本信息: / 姓名:`）
    //       长得和体系条目一样（都是"字段:值"清单）⇒ 形态判据分不开「分类定义」与「分类的实例」。
    //   ⇒ leg60 起 `canonSrc`/`slice` 整条退场（换成"读全"），`pickCanonSource` 仍在文件里当**已量过、未接线**的候选。
    const rawCanons = [];   // 每块的净化结果（含五件套 + 该块名号）：块收齐后由 mergeCanonChunks 纯函数合并
    // 书名录：全条目分块多调用（全量覆盖，v1 教训：人名藏在条目深处，不许头截断）
    const rows = src.split('\n').map((s) => s.trim()).filter(Boolean);
    const chunks = chunkRows(rows, ROSTER_CHUNK_CHAR);
    // leg23 照书办①：先把书本段「结构声明」扫出来（纯函数零调用）——按块给召回清单，块后再强制并册
    // ★leg60：再并上**题名面**（零 token 的 cast：作者把名册写在题名里，模型在 JS 里捞不全）。
    const { declares: tagDeclared, usesLabelTerms } = scanBookDeclarations(src);
    if (usesLabelTerms.length) errors.push('照书办: 检测到词表判据参与声明扫描（应为形态判据，请核查）');
    const declared = mergeDeclared(tagDeclared, titled);
    if (titled.length) errors.push(`照书办: 题名面 ${titled.length} 个名号（零调用；名称取自本书题名，类别留给正文/模型判）`);
    // ★leg25 g：各块抽到的名号**先原样堆在一起**（`rawBookNames`），
    //   等块全部跑完再**一次性**去重——不能在循环里就去重：那时后面块的别名还没出现，
    //   先到先得会把"正名条目"当重复丢掉（块顺序只是书序，不代表哪个是正名）。
    const rawBookNames = [];
    const probeState = { failures: 0 };
    let okChunks = 0;
    const failLog = [];                     // leg27：失败明细（给界面显形用，不是只报一个数字）
    let settingChunks = 0;                  // leg61：属性+设定遍成功的块数
    let settingEarlyStop = 0;               // leg61：属性遍"已收够就止损"跳过的块数
    const rawSettingEnts = [];              // leg61：属性遍交的 {name, kind, fields} —— 并入名册（不新造实体）
    // ★★★leg61：**同一批块、跑两遍**——名册一遍（只报名号），属性+设定一遍（不问名号）。
    //   口径与代价（实测见 `buildSettingPrompt` 头注）：调用数从 每块 1 次 → 每块 2 次，
    //   换来名册产量 ~2.8 倍（大荒去重 364 → 1022）与"属性不再和名册抢输出"。
    //   ★`declared`（书标签 + 题名面）只喂名册遍：那一遍才是"一个名号都不许漏"的责任方。
    for (const [ci, chunk] of chunks.entries()) {
        const chunkChars = Array.from(chunk).length;
        progress.start('chunk', ci + 1, chunks.length, chunkChars);   // ★"正在抽第 x/N 块"——进入即出声
        const { cleaned } = await tryRosterChunk(extract, chunk, 0, probeState, { declared, onProgress, progressLog: failLog });
        if (!cleaned) {
            // ★leg27（F3 失败显形）：旧法只说"块抽取失败"——**丢了多少、丢的是哪块、为什么**全不说，
            //   而块级失败是**静默丢数据**（真账实测「大虞」横跨第 1/2/3/5 块，丢一块就缺一批实体）。
            //   现在：块号 + 字符数 + 原因一并上报，errors 里也带块号（界面/诊断都能指认）。
            const last = failLog[failLog.length - 1];
            const why = last?.kind === 'timeout' ? '调用超时（已止损跳过，不再拆半/重试）' : (last?.error || '未知原因');
            progress.finish('chunk', ci + 1, chunks.length, chunkChars, false, why);
            // ★leg60：文案改口——这一块丢的**不只是名号**，还有这一块的设定（档位表/体系/史略）
            errors.push(`第 ${ci + 1}/${chunks.length} 块抽取失败（${chunkChars} 字符，已跳过降级，其余块照常）：${why}——该块的名号与设定本次缺失，网络/模型恢复后「重新抽取」可补回`);
            continue;
        }
        okChunks += 1;
        progress.finish('chunk', ci + 1, chunks.length, chunkChars, true);
        errors.push(...(cleaned.shapeWarnings || []));   // leg24 片5：块级净化坏项上报（如 env 非法值弃键）
        rawCanons.push(cleaned);                          // ★leg60：五件套也在块里（见上方 leg60 头注）
        for (const b of cleaned.canon.bookEntities) rawBookNames.push(b);
    }
    // ★★★leg61 第二遍：**属性 + 设定**（不问名号）。
    //   ★定稿形态（踩过两次坑之后，见 `buildAttrsOnlyPrompt` 头注）：
    //     **第一块问"设定 + 属性"，其后每块只问属性**——设定只值得问一块（块间并集去重），
    //     属性必须每块都问（三国 340 人横跨 1~7 块）。调用数与"每块都问"完全相同。
    for (const [ci, chunk] of chunks.entries()) {
        const chunkChars = Array.from(chunk).length;
        const first = ci === 0;
        progress.start('canon', ci + 1, chunks.length, chunkChars);
        const r2 = await tryRosterChunk(extract, chunk, 0, probeState, {
            declared, onProgress, progressLog: failLog,
            buildPrompt: first ? (t) => buildSettingPrompt(t, declared) : (t) => buildAttrsOnlyPrompt(t, declared),
        });
        if (!r2.cleaned) {
            const last = failLog[failLog.length - 1];
            const why = last?.kind === 'timeout' ? '调用超时（已止损跳过）' : (last?.error || '未知原因');
            progress.finish('canon', ci + 1, chunks.length, chunkChars, false, why);
            errors.push(`第 ${ci + 1}/${chunks.length} 块**属性+设定遍**失败（${chunkChars} 字符，名册遍不受影响）：${why}`);
            continue;
        }
        settingChunks += 1;
        progress.finish('canon', ci + 1, chunks.length, chunkChars, true);
        errors.push(...(r2.cleaned.shapeWarnings || []));
        // ★leg61：属性遍交的条目**并入名册**（同名归并、不新造实体）——它们的 fields 正是这一遍的产出。
        for (const b of (r2.cleaned.canon.settings || [])) rawSettingEnts.push(b);
        rawCanons.push(r2.cleaned);
    }
    if (settingChunks || settingEarlyStop) {
        errors.push(`属性+设定遍：成功 ${settingChunks} 块${settingEarlyStop ? ` · 已收够止损跳过 ${settingEarlyStop} 块` : ''}`);
    }
    // ★leg60：块收齐后合并设定（**纯函数、绝不摘要**）——并集去重 + 一句话取信息量最大那块。
    //   首块优先的只有 `tension`/`env`（张力与四个环境档位）：首块 = 旧窗口（头 3 万）所在的那块
    //   ⇒ 与旧行为连续（旧法只问头 3 万，env 的档位词只在那一轮定下来）。
    const canonBase = mergeCanonChunks(rawCanons);
    // ★leg25 g：块收齐后**一次性**按「名字 ∪ 别名」去重。
    //   三件事同时做：①同一实体的别名不再长成第二条（治碎块）；
    //   ②块之间的碰撞由"自带别名者胜"裁决（不是先到先得——块顺序只是书序）；
    //   ③拼字段（kind/parent/location/fields/aliases）一律"缺什么补什么"。
    const bookNames = dedupeRoster([...rawBookNames, ...rawSettingEnts]);
    if (rawSettingEnts.length) {
        errors.push(`属性+设定遍：带属性的条目 ${rawSettingEnts.length} 条（已并入名册；重名按"缺什么补什么"合，不新造实体）`);
    }

    // leg23 照书办②：书声明的名号**强制并册**（模型漏了也不丢）+ 照标签定类别、照标签落上级。
    // 类别覆盖只认「书声明的势力」——修正实证的 7 例误判（蟠桃园/瑶池/太昊仙洲…被判 location）；
    // 上级只在名册尚无该键时写入（first-wins：模型/书正文的明述优先，标签只补缺）。
    const applied = applyDeclaredToRoster(bookNames, declared);
    const declaredAdded = applied.added;
    const declaredFixed = applied.fixed;
    if (declared.length) {
        errors.push(`照书办: 声明面 ${declared.length} 个名号（标签 ${tagDeclared.length} / 题名 ${titled.length}；补入册 ${declaredAdded} / 改判类别 ${declaredFixed}）`);
    }

    // 全书级出处判定（v1 同款：块级只洗结构，出处全书级判一次；纯编造才丢）
    // ★leg60：**"全书"要把题名面算进去**——书的正文明面上没提到某个名号、而**它就是一条条目的题名**时，
    //   它仍然是"书里有据"的（三国实测：`控制器_张辽`/`张辽正史` 里的 `张辽` 正是以此入册的）。
    //   这不是放宽：能进 `titledNames` 的名字，判据是"**它被作者当名字用过**（是某条条目的 key）"。
    const before = bookNames.length;
    const finalNames = bookNames.filter((b) => src.includes(b.name) || titledNames.has(b.name));
    if (finalNames.length < before) {
        errors.push(`书名录全书级出处校验：${before - finalNames.length} 个名号原文未出现（疑似编造，已弃）`);
    }

    // leg24 片1（停抄书）：关系轮/属性轮/出处细节校验三处调用点一并删除——名册定稿即为交付态。
    const canon = { ...canonBase.canon, bookEntities: finalNames };
    // ★leg60：大小书合并后**没有"设定轮"这个独立失败面**了——设定与名册同一批调用同生共死，
    //   所以判据从「canonR 失败 ∧ 一块都没成 ∧ 一个名号都没有」收成「一块都没成 ∧ 一个名号都没有」。
    if (okChunks === 0 && !finalNames.length) {
        return {
            ok: false,
            errors: ['设定与书名录抽取全部失败（世界未动，可重试）'],
            timing: timingOf('big', progress.events.filter((e) => e.phase === 'finish').length, srcLen),
        };
    }
    const setting = assembleSetting({ canon, tension: canonBase.tension, env: canonBase.env, legacyTension, fingerprint: fp, extractedAt: stamp, compile: compileInfo });
    if (cache) cache.set(fp, { canon, tension: canonBase.tension, env: canonBase.env }, stamp);
    return {
        ok: true, cached: false, fingerprint: fp, setting, errors,
        timing: timingOf('big', progress.events.filter((e) => e.phase === 'finish').length, srcLen),
    };
}

// 落账到世界（不可变）：context.setting 整体替换；旧 context.tension 保留（兼容口径 K24 §3.7）
export function applySettingToSsot(ssot, setting) {
    return { ...ssot, context: { ...(ssot.context || {}), setting } };
}

// K37 生通道①（细案 §3.7 → A-10）：书名录初始化——frozen.canon.bookEntities 未在账实体幂等入账
// （出处=书内条目，只提取不创作；kind 缺省 character；location 取位置集首个）；
// K38（敲定稿 D 条）：attrs 按 kind 缺省兜底（与 newEntities 入口同口径——入局即有值，不再哑巴）；
// 第十九棒/K43（full-roster-lens-spec C1/C7/C8 拍板）：**全量棋盘**
//   - 无席位截断：角色整量入账 + 独立势力整量入账（location 类地名不入实体池——canon 保留备位置机制）；
//   - 势力净化折叠：书中明述隶属（parent）的势力名号不独立入账，归并进链顶势力实体的 branches 分支表
//     （平铺直属名，深链解析到顶；parent 缺失/自指/成环/目标非势力 → 弃关系+警告，名号仍独立入账）；
//   - 关联字段（C7）：character 带 parent（所属势力/分支名）单存；势力侧成员=派生反查；
//   - 初始分量预填：以 context.tension 口径（与 settle 首轮同源）为全部实体预填 world.weights——t1 门控就有真分量。
// leg24 片2（账本换血）：名册实体入账**不再预填四维**——`buildSeedAttrs` 已删。
// 旧法按 kind 预填（character 0.15 / faction 0.25），实测导致 75.2% 实体四维全默认（导出 (5)：453/602）：
//   那些数是我们替他填的，看起来却像客观数据。现法：attrs 空着（schema 已由必填改可选），
//   真值只从模型提议来；分量公式在"账面无数"时按中立值取中性 floor（weight.js NEUTRAL_ATTR）。

// 沿 parent 链上溯到落账目标：势力链顶（无 parent 的势力）或**在册角色**（书里明述的统治者/管辖者）。
// leg23：新增角色终点——大荒书用「<X帝麾下_Y>」把上级直接写成**帝（角色）**，旧口径（只认势力）导致
// 这 9 条现成的关系全部弃置（改动前 108 个势力只有 1 个有下属分支表）；线宽：角色成终点但**不参与折叠**
// （不新建实体、不改分量），只在实体页显示归属。
// 返回 {name, kind} | null（链上成环 / 目标缺失 → null）
function resolveSeedTarget(name, idx) {
    const seen = new Set();
    let cur = name;
    while (cur && idx.has(cur) && idx.get(cur).kind === 'faction' && idx.get(cur).parent) {
        if (seen.has(cur)) return null;         // 环
        seen.add(cur);
        cur = idx.get(cur).parent;
    }
    if (!cur || !idx.has(cur)) return null;                        // 缺失
    const kind = idx.get(cur).kind;
    if (kind === 'faction' || kind === 'character') return { name: cur, kind };   // leg23：角色=统治者终点
    return null;                                                   // 地名等不可作上级
}

// ============ 第二十五棒 e：势力↔角色关联（照 v1 把关系在初始化就建好）============
// 缘起（用户实机）：真账 `parent` 0/623、`pack.membersOf` 反查 0/128 势力 ⇒ 面板「隶属 X」「麾下：」永不显示。
//   根因不是坏，是 leg24「停抄书」把上级连同属性一起砍了，而替代通道只接回实力/位置。
// 泛用性（八本真实世界书审计，见 docs/spec-parent-affiliation.md §2）：
//   「成员行」形态在 7/8 本里存在（**是形态不是词表**）⇒ 可作结构依据；但**语义随书而变**
//   （三国书里「名号(」多是正文对话、实教的 key 名单是剧集标题）⇒ 单靠形态判不出"谁属于谁"。
//   ⇒ 设计取舍：**模型负责语义判别**（读得懂哪行是花名册），**结构负责验伪**（书里有没有这条关系的书面依据），
//     两者缺一都会出事：纯结构会收进「散修→散修」「虞昭华→人族皇朝」（实测假关系），纯模型会编。
export const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;

export function orgNamesOf(entry) {
    const out = [];
    const push = (v) => { const s = String(v ?? '').trim(); if (s && !out.includes(s)) out.push(s); };
    push(entry?.comment);
    const keys = Array.isArray(entry?.key) ? entry.key : [entry?.key];
    for (const k of keys) push(k);
    return out;
}

export function rosterOfOrg(entry) {
    const text = String(entry?.content ?? '');
    MEMBER_LINE.lastIndex = 0;
    const out = new Set();
    for (const m of text.matchAll(MEMBER_LINE)) out.add(m[1].trim());
    return out;
}

// 反查索引：组织名/其别名 → 该组织正文成员行里列出的名号集合。
//   别名也算组织名：大荒书的条目 `混乱之地·万妖盟`，其 key 里就带「万妖盟」——模型写哪个都该认。
export function buildOrgRosterMap(entries = []) {
    const m = new Map();
    for (const e of entries) {
        if (!e || typeof e !== 'object') continue;
        const roster = rosterOfOrg(e);
        if (!roster.size) continue;
        for (const n of orgNamesOf(e)) {
            if (!m.has(n)) m.set(n, new Set());
            const set = m.get(n);
            for (const x of roster) set.add(x);
        }
    }
    return m;
}

/**
 * verifyClaimedParent({...}) → 'member-line' | 'key-list' | 'explicit' | 'tag' | 'unverifiable' | 'refuted'
 * **确定性验伪**（细案 docs/spec-parent-affiliation.md §4）——三态语义，别退化成两态：
 *   · 正面证据 → 认：'member-line'（本组织正文成员行列出该名号）/ 'key-list'（在该条目 key 名单里）/ 'explicit'（自己条目显式所属）
 *   · **有册且该名号不在册 → 'refuted'**：这是唯一允许**弃关系**的情形（模型编的 / 张冠李戴）；
 *   · **该组织条目根本没有花名册 → 'unverifiable'**：无册**不能反推"不存在"**（硬规矩第 2 条：绝不用空值反推），
 *     只能算"未验证"——照样落账，但如实标成模型推断，面板/pack 上可区分。
 *   ★为什么必须留 'unverifiable'：实测有些势力条目就是光杆（无成员行、无 key），若一律弃关系，
 *     等于用"条目里没花名册"反推"该角色不属于它"，会把真关系误杀（本仓纪律：宁可漏填不可错填，但也不许凭空否定）。
 */
export function verifyClaimedParent({ name = '', claimed = '', orgRosterMap = new Map(), memberEntry = null, ownEntry = null, subOfTarget = false, bookDeclared = false } = {}) {
    const nm = String(name).trim();
    const c = String(claimed).trim();
    if (!nm || !c) return null;
    if (subOfTarget) return 'member-line';                         // 目标条目名本身含该名号（子串归属，条目名即证据）
    // 名号归一（实测必需的第二个出口）：书条目名是复合名（`混乱之地·万妖盟`），而模型/名册可能只写短名（`万妖盟`）
    //   ⇒ 精确查不到时按"一个是另一个的子串"再找一次（取最长者，宁少不错）。
    let roster = orgRosterMap.get(c);
    if (!roster) {
        const cands = [...orgRosterMap.keys()].filter((k) => k.includes(c) || c.includes(k)).sort((a, b) => b.length - a.length);
        if (cands.length) roster = orgRosterMap.get(cands[0]);
    }
    if (roster?.has(nm)) return 'member-line';
    const keys = Array.isArray(memberEntry?.key) ? memberEntry.key : [memberEntry?.key];
    if (keys.map((k) => String(k ?? '').trim()).includes(nm)) return 'key-list';
    const text = String(ownEntry?.content ?? '');
    const re = new RegExp(`(?:所属势力|所属|隶属|从属|势力)\\s*[:：=]\\s*-?\\s*([^\\n，。；;]{1,24})`, 'g');
    for (const m of text.matchAll(re)) if (m[1].includes(c)) return 'explicit';
    if (bookDeclared) return 'tag';                                // 书标签直接声明（照书办）——标签本身就是书的明述
    const hasRoster = Boolean(roster?.size) || keys.some((k) => String(k ?? '').trim());
    return hasRoster ? 'refuted' : 'unverifiable';                 // 有册不在册 = 反驳；无册 = 只能算未验证
}

// 零 token 兜底：模型没给所属时，从"组织条目的成员行/别名"反推（只对在册实体生效）。
export function deriveParentFromOrgEntries({ entities = [], candidateEntries = [], orgRosterMap = null, orgOf = () => null } = {}) {
    const rosterNames = new Map((entities || []).filter((e) => e?.name).map((e) => [String(e.name).trim(), e]));
    const direct = orgRosterMap || buildOrgRosterMap(candidateEntries);
    const out = { filled: 0, byName: new Map(), warnings: [] };
    for (const [org, members] of direct) {
        for (const nm of members) {
            const ent = rosterNames.get(nm);
            if (!ent || ent.kind !== 'character') continue;          // 只给在册角色挂
            if (ent.parent) continue;                                // 明述优先：已有不覆盖
            const target = orgOf(org);
            if (!target || target.kind !== 'faction') {              // 归属目标不是势力 ⇒ 弃（泛称/标题不得当势力）
                if (out.warnings.length < 5) out.warnings.push(`结构推导: 「${nm}」的疑似所属「${org}」不是势力条目——不写`);
                continue;
            }
            if (!out.byName.has(nm)) { out.byName.set(nm, org); out.filled += 1; }
        }
    }
    return out;
}

// v1 的零 token 档位兜底（`plugins/story-world/src/director.js:127` 同款口径）：只认「紧贴名号的括号/冒号」里的标签。
//   校验词来自**本书自己的** powerScale 档位名（不是外挂词表）；T 系标签（T8大乘中期）自带格式识别。
//   纪律：定位不到就返回空串（**绝不猜**）——调用方回退模型抽取结果。
export function powerFromNameContext(fullText, name, tierWords = []) {
    const target = String(name ?? '').replace(/^(?:undefined|null|NaN)\s+/i, '').trim();
    if (!target || !fullText) return '';
    const words = (Array.isArray(tierWords) ? tierWords : []).filter((w) => w && String(w).length >= 2).map(String).sort((a, b) => b.length - a.length);
    const isTag = (s) => {
        const t = String(s || '').trim();
        if (/^T\d+/.test(t)) return t;                            // A) T 系标签（大荒格式）
        for (const w of words) if (t.includes(w)) return t;        // B) 本书自己的力量标尺词（词表只做校验）
        return '';
    };
    let idx = fullText.indexOf(target);
    while (idx >= 0) {
        const after = fullText.slice(idx + target.length, idx + target.length + 80);
        // 必须紧跟名字（允许紧贴空白）：括号形/冒号形；**不得跳过中间文字**去抓后面的括号（v1 原注释口径）
        const m = after.match(/^[ \t\u3000]*[（(]\s*(?:男|女|雄|雌|公|母)?\s*[,，、]?\s*([^）)；;。]{1,24})\s*[）)]/);
        if (m) { const tag = isTag(m[1]); if (tag) return tag.slice(0, 30); }
        const m2 = after.match(/^[ \t\u3000]*[：:]\s*([^，。；;、\s]{1,24})/);
        if (m2) { const tag = isTag(m2[1]); if (tag) return tag.slice(0, 30); }
        idx = fullText.indexOf(target, idx + target.length);
    }
    return '';
}

// 势力「底蕴/规模」的零 token 提取（第二十五棒 e）：书里势力的性质与规模**有固定书面形态**——
//   实测用户书 96 个势力条目里 48 个是 `[势力: 万妖盟 (混乱绞肉机/妖修大本营)]` 这种势力标签，
//   74 个带 `核心底蕴/底蕴/规模/兵力/势力:` 标签行 ⇒ 可直接照抄原话，**不需要模型、也不许引擎自造**。
//   形态判据（不是词表）：`[势力: 名号 (原话)]` 与 `标签: 原话`。取不到就留空（绝不编）。
export function factionScaleFromEntry(content, name) {
    const text = String(content ?? '');
    const nm = String(name ?? '').trim();
    // ①势力标签形态：`[势力: 名号 (原话)]`——名号后可带别名（`幽都/枉死城`），故用"名号在括号前"松匹配
    if (nm) {
        // 注意捕获组序号：`[^\]（(\n]` 那层是第 2 组，原话是第 3 组
        const m = /\[\s*势力\s*[:：][^\]（(\n]{0,40}?[（(]([^）)]{2,40})[）)]/.exec(text);
        if (m) return m[1].trim().slice(0, BOOK_FIELD_MAX);
    }
    // ②标签行形态：`核心底蕴/底蕴/规模/兵力:` 后的原话（截到句读）
    const m2 = /(?:核心底蕴|底蕴|规模|兵力)\s*[:：]\s*([^\n。；;]{2,40})/.exec(text);
    if (m2) return m2[1].trim().slice(0, BOOK_FIELD_MAX);
    return '';
}

/**
 * seedBookEntities(ssot, { entries }) → { seeded, folded, skippedLocation, warnings, fieldsAttached?, parentVerified?, parentDemoted? }
 * 名册 → 实体账（幂等：已在册的按名号跳过，**不重建、不覆盖**——这条有测试锁）。
 *
 * `entries`（可选，第二十五棒 e 追加）：**真书条目**（`{ comment/name, content, key }`）——
 *   为什么需要它：名册条目 `canon.bookEntities` **不带正文**（它只是名号表），而零 token 兜底
 *   （成员行反推归属 / 紧贴名号的档位标签 / 势力规模原话）**必须读正文**才跑得动。
 *   ⇒ 初始化链路与**存量世界补齐**共用这一条路径：传了 entries 就有兜底，不传则只有模型抽来的字段。
 *   纯函数纪律：只读 entries，不改它；调用方传入自己的副本。
 */
export function seedBookEntities(ssot, { entries = null } = {}) {
    const rawEntries = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
    const contentOfBookName = new Map();
    const keyOfBookName = new Map();
    for (const e of rawEntries) {
        const nm = String(e.comment ?? e.name ?? '').trim();
        if (!nm) continue;
        if (!contentOfBookName.has(nm)) {
            contentOfBookName.set(nm, String(e.content ?? ''));
            keyOfBookName.set(nm, e.key);
        }
    }
    // ★名号归一（实测逼出，第二十五棒 e）：模型抽的名号常是**短名**，而书条目名是**复合名**——
    //   实测：canon `万妖盟` ↔ 书条目 `混乱之地·万妖盟`；`幽都` ↔ `鬼族幽都`；`大虞` ↔ `人族皇朝`。
    //   旧法精确查 ⇒ 正文取不到（contentLen=0）⇒ 花名册建不起来 ⇒ 这 12 个组织**一个成员都挂不上**（真账实测丢 60 条归属）。
    //   口径：精确优先；查不到时按"一个是另一个的子串"取**最长**候选（宁少不错）。
    const bookNameAlias = (key) => {
        const k = String(key ?? '').trim();
        if (!k || contentOfBookName.has(k)) return k;
        let best = null;
        for (const nm of contentOfBookName.keys()) {
            if (nm.length < 2) continue;
            if (!(nm.includes(k) || k.includes(nm))) continue;
            if (!best || nm.length > best.length) best = nm;
        }
        return best || k;
    };
    const book = ssot.context?.setting?.frozen?.canon?.bookEntities || [];
    if (!book.length) return { seeded: 0, folded: 0, skippedLocation: 0, warnings: [] };
    const positions = ssot.context?.positions || [];
    const home = positions[0] || '未明';    // leg21：兜底位置改中立词「未明」——旧提案词「中央」无含义（数据实证：名册 0 带 location → 全员落占位）
    const warnings = [];

    // 名册索引（sanitize 已按 name 去重）
    const idx = new Map(book.map((b) => [b.name, b]));
    // ★★leg61：**势力树甲类边要在建索引之前定下来**（这里就是那一处——位置不是随手放的）。
    //   为什么必须这么早：`idx` 里的条目对象**就是**后面写进账的那批对象，`resolveSeedTarget` 沿
    //   `idx.get(name).parent` 上溯求链顶。甲类边若晚一步写，就会出现"势力树上是
    //   `昆仑道宫 ∈ 昆仑`，而角色的归属仍指向 `昆仑道宫`"——**同一棵树两套答案**（本仓最贵的那类病）。
    //   实测（端到端判据抓出）：改前 `玄一道祖.parent = 昆仑道宫`，改后 = `昆仑`。
    const containmentLinks = computeContainmentParents(book);
    for (const [childName, edge] of containmentLinks) {
        const item = idx.get(childName);
        if (!item || item.parent) continue;        // 明述优先：书里/模型已经给了上级的一律不动
        item.parent = edge.parent;
        item.parentSource = '名字包含';
        item.parentSourceFrom = `名字包含@${edge.parent}`;
    }
    const byName = new Map();                   // 已入账实体名 → 实体
    for (const e of ssot.entities || []) byName.set(e.name, e);

    let seeded = 0;
    let folded = 0;
    let skippedLocation = 0;
    let fieldsAttached = 0;
    let parentVerified = 0;
    let parentDemoted = 0;      // 验伪不过被弃的"所属"（模型编的 / 不是势力条目 / 书里找不到证据）
    // 名号归一尺（第二十五棒 e 实测逼出）：canon 名册会**合并同名**，只留第一个名字——
    //   实测用户书：条目名 `混乱之地·万妖盟`，而 canon 里是 `万妖盟`（词表前缀 `混乱之地·` 在 canon 侧不存在）。
    //   ⇒ 按书条目名精确查 canon 会查不到 ⇒ 该条目的势力身份丢失、整个花名册被跳过（吞天妖王/混元妖圣 5 人因此漏掉）。
    //   口径：**双向子串匹配**，取最长者（宁少不错）；歧义/无匹配返回 null。
    const canonNames = [...idx.keys()];
    const resolveCanonName = (entryName) => {
        const n = String(entryName ?? '').trim();
        if (!n) return null;
        if (idx.has(n)) return n;
        let best = null;
        for (const c of canonNames) {
            if (c.length < 2) continue;
            if (!(n.includes(c) || c.includes(n))) continue;
            // 一律取最长（宁少不错）；**并列时优先 kind=faction**——实测 `人族皇朝`（真势力条目）的候选里有
            //   `人族`（模型也抽了它、标成 faction），不多这一档就会把归属指向泛称、成员全挂不上。
            if (!best || c.length > best.length || (c.length === best.length && idx.get(best)?.kind !== 'faction' && idx.get(c)?.kind === 'faction')) best = c;
        }
        return best;
    };
    // 组织成员行反查索引（零 token）：用于**验伪**模型给的所属，也用于**兜底推导**。
    //   建索引的来源只有一处：书条目里被判为 **kind=faction** 的名号 + 其正文成员行。
    //   ★为什么必须限定 kind=faction：实测把"小节标题/泛称"当节点会推出「散修→散修」「虞昭华→人族皇朝」（假关系）。
    const orgRosterMap = new Map();
    const contentFor = (b) => (typeof b?.content === 'string' && b.content ? b.content : (contentOfBookName.get(bookNameAlias(b?.name)) ?? ''));
    for (const b of book) {
        const canonName = resolveCanonName(b.name);
        const canonItem = canonName ? idx.get(canonName) : null;
        const isFaction = canonItem ? canonItem.kind === 'faction' : b.kind === 'faction';
        if (!isFaction) continue;
        const m = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
        const set = new Set();
        for (const mm of contentFor(b).matchAll(m)) set.add(mm[1].trim());
        if (!set.size) continue;
        // 登记在**书条目名**（复合名）与 **canon 名**（短名）两个键下——模型写哪个都该认。
        for (const key of [b.name, canonName].filter(Boolean)) {
            if (!orgRosterMap.has(key)) orgRosterMap.set(key, new Set());
            const bucket = orgRosterMap.get(key);
            for (const x of set) bucket.add(x);
        }
    }
    // ★leg25 g（P3，用户 2026-09-11 定论「虞昭华是大虞的」逼出的缺口）：
    //   **书条目的 `key` 里明写着的势力名，也算那个势力的别名**——上面那圈只认"条目名"，
    //   于是「canon 势力名」与「书条目名」**毫无字面关系**的条目就整条接不上。
    //   实测（用户真账）：canon 势力 `大虞`，书条目却叫 `人族皇朝`（key 第一项就是 `大虞`，正文「代表人物:」下写着
    //   `- 虞昭华（女，T8大乘中期）：大虞女帝。…`）⇒ `resolveCanonName('人族皇朝')` 双向子串都匹配不上（"人名+朝代" vs "朝代"）
    //   ⇒ 正文取不到 ⇒ 成员行进不了名册 ⇒ `虞昭华 → 大虞` 挂不上。同款还有 `瑶池圣地` ↔ 书条目 `隐世圣地·瑶池`。
    //   实测影响面（真账）：canon 势力 152 个里 80 个靠这条才拿到成员行，但**真正会新写入的只有 8 条**
    //   （虞昭华/秦红袖/沈天君→大虞，瑶池圣母/灭情师太/蟠桃树灵·夭夭/青鸟/叶清璇→瑶池圣地）——
    //   其余角色要么不在册、要么账上原有归属（明述优先，不覆盖）。
    //   ★为什么必须**严格收窄**（多书实测教训，见 demo/measure-leg25g-p3-genericity.js）：
    //     凡是"任意条目 key 命中任意势力名当关系"的写法都会炸——三国 735 条（`if→貂蝉`）、大荒 10087 条、
    //     自指 225 条。那类书里 key 是**任意关键词表**，不是别名。所以这里三道闸缺一不可：
    //       ① 出发点只能是 **canon 里 kind=faction 的条目**（不是"书上任意一个名字"）；
    //       ② 只认**精确等于**该势力名的 key（不做子串/模糊）；
    //       ③ 该 key 名在那个书条目下**必须本身像花名册**（≥2 条成员行，与 audit-design-candidates 同一形态判据），
    //          否则"提到它的设定段落"会被当名册（实测：`人族` 会靠 `[寿元]` 拿到一堆散文碎片）。
    {
        const MIN_ROSTER_ROWS = 2;
        for (const b of book) {
            if (b.kind !== 'faction') continue;
            const bn = String(b.name ?? '').trim();
            if (bn.length < 2) continue;
            for (const e of rawEntries) {
                const en = String(e.comment ?? e.name ?? '').trim();
                if (!en || en === bn) continue;                        // 同名那条上面那圈已经处理过
                const keys = Array.isArray(e.key) ? e.key : [e.key];
                if (!keys.some((k) => String(k ?? '').trim() === bn)) continue;   // ② 精确命中
                const text = String(e.content ?? '');
                MEMBER_LINE.lastIndex = 0;
                const rows = [...text.matchAll(MEMBER_LINE)].map((m) => m[1].trim());   // ③ 像花名册
                if (rows.length < MIN_ROSTER_ROWS) continue;
                if (!orgRosterMap.has(bn)) orgRosterMap.set(bn, new Set());
                const bucket = orgRosterMap.get(bn);
                for (const x of rows) bucket.add(x);
            }
        }
    }
    const orgOf = (name) => {
        const b = idx.get(String(name ?? '').trim());
        return b ? { name: b.name, kind: b.kind } : null;
    };
    const pushEntity = (b) => {
        if (byName.has(b.name)) return null;    // 已有（含 retired）不重建；dead 不回魂
        let n = seeded + 1;
        while ((ssot.entities || []).some((e) => e.id === `e_bk_${n}`)) n += 1;   // K45：id 防冲突（重 seed/force 场景既有 e_bk_N）
        const entKind = b.kind === 'faction' ? 'faction' : 'character';
        const ent = {
            id: `e_bk_${n}`,
            kind: entKind,
            name: b.name,
            // leg21：名册带出的所在优先；leg24 片1 起新抽取不再产 location（旧账仍读=零扰动）。
            // leg25 D 组（位置集从书里建）：带出的所在必须 ∈ 位置集——否则落 home。
            //   为什么必须守这条：`check-step` 校验实体位置 ∈ 位置集，位置不在集内会让**整步被拒**
            //   （世界停摆）。位置集此时已由 derivePositions（web 侧）按同一本书的地名建好=不误杀。
            location: (b.location && positions.includes(b.location)) ? b.location : home,
            // 身份 + 类别入账（design-core §2.3 第 1 项）
            // leg25 c：**`attrs: {}` 整条删除**——四维浮点不存在了，账上连空键都不该有
            //   （书里的说法走实体 `实力` 文本态，见 spec-entity-field-lookup）。
        };
        // 第二十五棒 e：**照书抄的属性落到实体账**（v1 初始化就有的效果）。
        //   纪律：只落**文本原话**（实力=「T9渡劫巅峰」这类档位原话，**引擎不换算、不进任何公式**——START-HERE §2）；
        //   只填空位（已有值不覆盖，明述优先）；来源分账 `fieldSource`（面板/pack 用来标「（书）」）。
        const f = b.fields || {};
        const setIfEmpty = (key, val) => {
            if (typeof val !== 'string' || !val.trim()) return false;
            if (typeof ent[key] === 'string' && ent[key].trim()) return false;
            ent[key] = val.trim();
            fieldsAttached += 1;
            return true;
        };
        if (ent.kind === 'character') {
            setIfEmpty('实力', f['实力']);
            setIfEmpty('身份', f['身份']);
            setIfEmpty('定位', f['定位']);
            // ★★leg61（用户令「我要的是模拟的必要属性，实力，归属等等，但是现在就是有很多抽不出来」）：
            //   **`所属` 落账**——此前这里是全仓唯一一处"抽出来了却一个都不落地"的字段：
            //   真账实测（三本）：名册带 `所属` 233 / 482 / 141 条，实体账上 **0 / 0 / 0**。
            //   为什么以前没被发现：它在中途被 `verifyClaimedParent` 用了一次（当 `parent` 的来源），
            //   看着"有人用"，而**实体自身的那一格从来没写过**（上面这份名单里没有它）。
            //   两格的分工（别混）：`parent` = 引擎梳理出的归属（带 parentSource 发票、参与势力树与折叠）；
            //   `所属` = **书里的原话**（作者怎么写就怎么存，含「司徒王允府」这类不是势力的写法）。二者可以不一致。
            setIfEmpty('所属', f['所属']);
        } else if (ent.kind === 'faction') {
            setIfEmpty('规模', f['规模']);
            setIfEmpty('性质', f['性质']);
            setIfEmpty('倾向', f['倾向']);
        }
        // ★leg61：**键开放**——名册里带的其余属性（键可自由命名，值已过出处闸）一律落账，不再按 kind 挑。
        //   旧口径只抄上面那七个键，模型交的"境界/体质/兵力/领地/寿元"全丢（这正是"很多抽不出来"的来路）。
        for (const k of Object.keys(f)) {
            if (k === '所属' && ent.kind !== 'character') { setIfEmpty(k, f[k]); continue; }
            setIfEmpty(k, f[k]);
        }
        if (Object.keys(f).length) {
            ent.fieldSource = ent.fieldSource || {};
            for (const k of Object.keys(f)) ent.fieldSource[k] = '书里原话';
        }
        (ssot.entities = ssot.entities || []).push(ent);
        byName.set(b.name, ent);
        seeded += 1;
        return ent;
    };

    // 第一遍：独立势力（无 parent）整量入账（书序）
    const foldedNames = [];
    for (const b of book) {
        if (b.kind === 'location') { skippedLocation += 1; continue; }       // 地名不入池
        if (b.kind !== 'faction') continue;
        if (b.parent) { foldedNames.push(b); continue; }                     // 有隶属=第二遍折叠
        pushEntity(b);
    }
    // 第二遍：子势力折叠（parent 链解析到顶 → 挂链顶实体 branches）；leg23：上级为角色时独立入账 + 记为名下机构
    // leg24 片1（核验抓到的判词失真修正）：resolveSeedTarget 返回 null 有**两种**原因——上级名号在册但类别
    //   不可作上级（地名），或上级名号**根本不在册**（书里没写它、模型也没抽到）。旧文案一律说成
    //   "未明述为独立势力"，第二类情况下这句话对不上事实（如实测：界渊长城的上级「渡虚帝」压根不在册）。
    //   现按原因分措辞：账本要诚实，警告也不许替他物编个出处。
    const organs = [];                       // {owner 名号, name 名号}：书里明述归某势力/某统治者管，但不作为独立棋手
    // 书标签声明的上级（照书办：`<X帝麾下_名号>` 形态）——**标签本身就是书的明述**，用它作正面证据。
    //   候选集逐字取自书本段正文（形态判据，无词表）；模型抽出的声称必须与声明同名才算命中。
    // ★leg25 g（P2）：这一段原本在第三遍（角色那一遍）才算，本棒起**提前到子势力折叠之前**——
    //   因为子势力那条路（下面 `target.kind === 'character'`）现在也要判"是不是照书办"。
    const declaredParent = new Map();
    {
        const srcText = ssot.context?.setting?.frozen?.canon?.sourceText;
        const declared = typeof srcText === 'string' && srcText ? scanBookDeclarations(srcText).declares : [];
        for (const d of declared) if (d.parent) declaredParent.set(d.name, d.parent);
    }
    const missWords = (self, parent) => (idx.has(parent)
        ? `书名录: 「${self}」的上级「${parent}」是地名——弃隶属（名号照常入账）`
        : `书名录: 「${self}」的上级「${parent}」不在册（书里没有它的条目）——隶属空着，名号照常入账`);
    for (const b of foldedNames) {
        const target = resolveSeedTarget(b.parent, idx);
        if (!target) {
            warnings.push(missWords(b.name, b.parent));
            pushEntity(b);
            continue;
        }
        if (target.kind === 'character') {
            // leg23：上级是在册角色（统治者/管辖者）——不折叠（不新建实体、不动分量），按独立势力入账 + 记名下机构
            const ent = pushEntity(b);
            if (ent) {
                ent.parent = target.name;
                // ★leg25 g（P2）：**补上漏打的来源**。旧法只设了 `parent`，没设 `parentSource`/`parentSourceFrom`
                //   ⇒ 账上 9 条 `parentSource === undefined`（实测全是 faction→character，即"子势力→皇帝角色"：
                //   太昊仙洲/无念禅境→太素帝、大荒战界→噬天帝、须弥界域/界渊长城→渡虚帝…）。
                //   为什么不能只留 parent：`parentSource` 是"这条归属是书里写的还是引擎推的"的**来源分账**，
                //   面板与 pack 靠它标「（推）」（`render.js` parentDerived）。来源空着 = 让读者分不清明述与推断。
                //   来源判定与第三遍 `setParent` 同口径：书标签声明优先（照书办），否则记为模型抽取。
                const tagged = String(declaredParent.get(ent.name) ?? '') === String(target.name);
                ent.parentSource = tagged ? '照书办' : '模型抽取';
                ent.parentSourceFrom = tagged ? 'tag' : 'sub-faction-role';
                organs.push({ owner: target.name, name: b.name });
            }
            continue;
        }
        const topEntity = byName.get(target.name);
        if (!topEntity) {
            warnings.push(missWords(b.name, b.parent));
            pushEntity(b);
            continue;
        }
        if (!topEntity.branches) topEntity.branches = [];
        if (!topEntity.branches.includes(b.name)) topEntity.branches.push(b.name);
        folded += 1;
    }
    // ★leg25 g（P2 补完）：**给老账回填漏打的来源**（幂等；与 leg25 e「名册落账做成可重入」同一治法）。
    //   为什么必须单列这一步：上面第二遍只在 `pushEntity` **真的新建了实体**时才打来源；
    //   而老世界的实体**早就入账了**（`pushEntity` 对已存在的名号直接返回 null）⇒ 光改新建那条路，
    //   老账上那 9 条永远补不上（真账实测：改完仍是 `缺来源 9`）。这一刀挂在加载期收口里，打开面板即补齐。
    //   来源判法与第二遍同口径（书标签声明优先），证据类型写清这条路的名字便于审计。
    {
        const srcText = ssot.context?.setting?.frozen?.canon?.sourceText;
        for (const e of ssot.entities || []) {
            if (!e?.parent || e.parentSource) continue;              // 只补空位（已有来源不动）
            const target = resolveSeedTarget(e.parent, idx);
            const parentItem = target?.kind === 'character' ? target : idx.get(String(e.parent).trim());
            if (parentItem?.kind !== 'character') continue;          // 只认"上级是统治者"这一类
            const tagged = String(declaredParent.get(e.name) ?? '') === String(e.parent);
            e.parentSource = tagged ? '照书办' : '模型抽取';
            e.parentSourceFrom = tagged ? 'tag' : 'sub-faction-role';
            parentVerified += 1;
        }
    }
    // ★★leg61：**势力树甲类边**（用户令「势力树呢，总是会有一个部门成为一个势力的情况」）。
    //
    // 病（真账实测）：势力→势力 parent **0/57**（三国）· 0/65（大荒）⇒ 9 个"曹/魏"全是平级兄弟。
    //   「部门被当成势力」里有一族**名字里就带着所属**，本来可以零成本连上：
    //     `曹魏 ⊃ 曹魏军 / 曹魏西线军 / 曹魏远征军` · `蜀汉 ⊃ 蜀汉军 / 蜀汉南征军` · `天庭 ⊃ 天庭百官`。
    //   它们不是猜的——**子名的字符串里就写着父名**，且两端都是这本书自己抽出来的条目。
    //
    // 位置很要紧（这一处放在**第三遍之前**，不是随手放的）：
    //   ① 势力的入账在第一/二遍 ⇒ 走到这里时 `byName` 里势力已经齐了；
    //   ② 第二遍的折叠只处理"册里带 `parent` 的势力"（`foldedNames`）——**甲类边是在它之后才定下来的**
    //      ⇒ 这里写上的 `parent` **不会**被折进 `branches`，实体照旧独立保留（那正是我们要的：
    //      面板要能看见"曹魏军属于曹魏"，而不是把它从账上抹掉）。
    //   ③ 必须在第三遍（角色）之前：角色的 `setParent` 会用 `resolveSeedTarget` 上溯到链顶，
    //      势力这层先连好，角色的归属才会聚到同一个链顶（否则又是"关羽在刘备军、张飞在蜀汉"那种分裂）。
    {
        const { links, warnings: linkWarnings } = linkContainedFactions(ssot.entities || [], byName);
        for (const { child, parent, names } of links) {
            if (child.parent) continue;                      // 明述优先：已有上级（书里写的/模型抽的）一律不动
            // 成环防线：沿父链上溯，撞到自己就不连（上界给足 = 势力数 + 2）
            let cur = parent; let hoop = 0; let cyclic = false;
            while (cur && hoop < (ssot.entities || []).length + 2) {
                if (cur === child) { cyclic = true; break; }
                cur = byName.get(String(cur.parent || '')) || null;
                hoop += 1;
            }
            if (cyclic) { warnings.push(`势力树: 「${child.name}」→「${parent.name}」会成环——不连（保持平级）`); continue; }
            child.parent = parent.name;
            child.parentSource = '名字包含';
            child.parentSourceFrom = `名字包含@${names.join('/')}`;
            parentVerified += 1;
        }
        for (const w of linkWarnings) warnings.push(w);
    }
    // 第三遍：角色整量入账 + parent（所属势力）解析
    // leg23 修正：**册里明述为势力的上级一律认**——旧口径要求"上级实体此刻已在账"，而势力的入账在第一/二遍，
    // 角色却排在第三遍之前判断，导致「龙骧 → 镇海先锋营」这类真关系被误判成"未明述为势力"而丢弃（实测 20 条警告之根）。
    // 现在：上级在册 → 直接认（链顶解析得到则写链顶名，否则写上级本身，其自身实体会在账上指到链顶）；只有**不在册**才留痕。
    // 所属落账的唯一出口（先验伪，再决定认不认）。
    //   弃关系的条件**只有一个**：正面证据全无 **且** 该组织确有花名册却列不出该名号（=被反驳）。
    //   ——无册不等于不存在（硬规矩：绝不用空值反推"没有"），只能落账并如实标成未验证。
    const setParent = (ent, claimed, srcTag, ownEntry) => {
        const c = normalizeParentName(claimed);
        if (!c) return false;
        // 名号归一后再查册：模型写短名（`万妖盟`）而册上是复合名时，绑到 canon 那**同一项**（否则 kind 查不到 ⇒ 关系白丢）
        const canonName = resolveCanonName(c);
        const inRoster = canonName ? idx.get(canonName) : null;
        if (!inRoster || inRoster.kind !== 'faction') {
            parentDemoted += 1;
            warnings.push(`书名录: 「${ent.name}」的所属「${c}」不在册或不是势力——隶属空着（角色照常入账）`);
            return false;
        }
        const tagged = String(declaredParent.get(ent.name) ?? '') === c;
        const evidence = verifyClaimedParent({
            name: ent.name,
            claimed: c,
            orgRosterMap,
            ownEntry,
            memberEntry: inRoster,
            subOfTarget: String(inRoster.name).includes(String(ent.name)),
            bookDeclared: tagged,
        });
        if (evidence === 'refuted') {
            parentDemoted += 1;
            warnings.push(`书名录: 「${ent.name}」的所属「${c}」被书里证据反驳（该组织有花名册但列不出此名号）——弃关系（角色照常入账）`);
            return false;
        }
        const target = resolveSeedTarget(c, idx);
        ent.parent = target?.kind === 'faction' ? target.name : c;
        ent.parentSource = tagged ? '照书办' : (evidence === 'unverifiable' ? '模型抽取(未验证)' : srcTag);
        ent.parentSourceFrom = evidence;
        parentVerified += 1;
        return true;
    };
    for (const b of book) {
        if (b.kind !== 'character') continue;
        const ent = pushEntity(b);
        if (!ent) continue;
        if (ent.parent) continue;                       // 明述优先：已有不覆盖
        // ①模型抽的 `parent`（同一条关系，两种写法都收）
        if (b.parent && setParent(ent, b.parent, '模型抽取', b)) continue;
        // ②模型抽的 fields.所属（v1 的 affiliation 口径——显式"所属势力：X"写法也走这里）
        const own = b.fields?.['所属'];
        if (own && own !== b.parent) setParent(ent, own, '模型抽取', b);
    }
    // 实体名 → **真书原文**（自己的条目 + 提到它的组织条目）——零 token 档位兜底与"显式所属"验伪共用这一份。
    //   为什么要拼「提到它的组织条目」：大荒/三国这类书里，角色的档位与所属**只写在势力条目的成员行上**，
    //   它自己没有条目——v1 的 `fillPowerFromBook` 正是扫全书的紧贴标签，这里等价但不重复扫。
    const textOfName = new Map();
    const addText = (nm, text) => {
        const k = String(nm ?? '').trim();
        if (!k || !text) return;
        textOfName.set(k, textOfName.has(k) ? `${textOfName.get(k)}\n${text}` : text);
    };
    for (const b of book) {
        const content = contentFor(b);
        if (!content) continue;
        addText(b.name, content);
        for (const nm of rosterOfOrg({ content })) addText(nm, content);
    }
    const tierWords = (ssot.context?.setting?.frozen?.canon?.powerScale || []).map((p) => String(p?.level ?? '')).filter(Boolean);

    // 第四遍（第二十五棒 e）：**结构兜底**——模型没给、但组织条目的成员行里确实列了该名号 ⇒ 补上（零 token）。
    //   只对**在册角色**、**只填空位**、且**归属目标必须是 kind=faction 的条目**（泛称/标题不得当势力）。
    //   ①关联优先：模型/验伪没定下来的，从成员行反推（来源标「结构推导」，面板与 pack 标「（推）」）。
    {
        const derived = deriveParentFromOrgEntries({
            entities: ssot.entities || [],
            candidateEntries: book.filter((b) => b.kind === 'faction'),
            orgRosterMap,
            orgOf,
        });
        for (const [nm, org] of derived.byName) {
            const ent = byName.get(nm);
            if (!ent || ent.parent) continue;            // 与模型那条路同口径：势力自己还有上级时，成员指向**链顶**（`resolveSeedTarget` 上溯；
            //   上级是角色＝统治者时也认——leg23 口径）。这样"瑶池（隶阐教）的成员"不会与"阐教成员"分裂成两个节点。
            const viaCanon = resolveCanonName(org);
            const target = resolveSeedTarget(viaCanon || org, idx);
            const top = target?.kind === 'faction' ? target.name : (viaCanon || org);
            ent.parent = top;
            ent.parentSource = '结构推导';
            ent.parentSourceFrom = `成员行@${org}`;
            parentVerified += 1;
        }
        for (const w of derived.warnings) warnings.push(w);
    }
    // ⑤零 token 档位兜底（v1 `fillPowerFromBook` 同口径）：模型漏了、但书里紧贴名号的标签写得明明白白 ⇒ 补上。
    //   只填空位；只认紧贴名号的括号/冒号标签；校验词来自**本书自己的** powerScale（不是外挂词表）。
    {
        for (const e of ssot.entities || []) {
            if (e.kind !== 'character' || (typeof e['实力'] === 'string' && e['实力'].trim())) continue;
            const src = textOfName.get(e.name);
            if (!src) continue;
            const tag = powerFromNameContext(src, e.name, tierWords);
            if (!tag) continue;
            e['实力'] = tag;
            e.fieldSource = { ...(e.fieldSource || {}), 实力: '书里原话' };
            fieldsAttached += 1;
        }
        // 势力「规模/性质」同款兜底（`[势力: X (原话)]` / `核心底蕴: 原话`）——势力不写角色档位，只抄它自己的原话。
        const entryTextOf = new Map(book.map((b) => [String(b.name).trim(), contentFor(b)]));
        for (const e of ssot.entities || []) {
            if (e.kind !== 'faction' || (typeof e['规模'] === 'string' && e['规模'].trim())) continue;
            const src = entryTextOf.get(e.name) || textOfName.get(e.name);
            if (!src) continue;
            const scale = factionScaleFromEntry(src, e.name);
            if (!scale) continue;
            e['规模'] = scale;
            e.fieldSource = { ...(e.fieldSource || {}), 规模: '书里原话' };
            fieldsAttached += 1;
        }
    }
    // ★★leg61：**势力树甲类边已在建索引之前连好**（见 `idx` 上方那一处的长注释：
    //   位置不是随手放的——晚一步写就会出现"同一棵树两套答案"）。这里不重复一趟。
    // 名下机构落账（leg23）：写回名义势力的 organs（如 渡虚帝.organs = [界渊长城, 须弥界域]）
    let organsAttached = 0;
    for (const { owner, name: n } of organs) {
        const ent = byName.get(owner);
        if (!ent) continue;
        if (!ent.organs) ent.organs = [];
        if (!ent.organs.includes(n)) { ent.organs.push(n); organsAttached += 1; }
    }
    // 第四遍：初始分量预填（与 settle 首轮同口径：context.tension ?? 0.5）
    const tension = ssot.context?.tension ?? 0.5;
    for (const e of ssot.entities || []) {
        ssot.weights = ssot.weights || {};
        if (ssot.weights[e.id] === undefined) ssot.weights[e.id] = computeWeight(e.attrs, e.kind, tension);
    }
    // leg23：organsAttached 仅在真正附着机构时出现（返回形状对既有调用方保持稳定）
    const out = { seeded, folded, skippedLocation, warnings };
    if (organsAttached) out.organsAttached = organsAttached;
    // 第二十五棒 e：照书抄的字段与关联落账计数（面板/台账用它说明"建世界时建好了多少"）
    if (fieldsAttached) out.fieldsAttached = fieldsAttached;
    if (parentVerified) out.parentVerified = parentVerified;
    if (parentDemoted) out.parentDemoted = parentDemoted;
    return out;
}

// ============ leg21 增量抽象（docs/incremental-refine-spec.md）：清除演化层 / 名册→实体补缺 / 单实体补抽 ============

// 清除演化层（纯函数，不可变）：intensity 回基线、参数档位清空、derivedFrom 清空；polarity/direction 保留
//（它们是书抽的设定面，不属演化）；frozen 一概不动。不触发任何抽取调用。
// leg26：`env` 不再回"四键 0.5 基线"——**清空**（玩家可在参数页重定；空着就是空着）。
export function resetDynamicLayer(setting) {
    const dyn = setting?.dynamic || {};
    const t = dyn.tension || {};
    return {
        ...setting,
        dynamic: {
            tension: {
                polarity: String(t.polarity || '').trim() || '未聚',
                direction: String(t.direction || '').trim(),
                intensity: TENSION_INIT_BASELINE,
            },
            env: {},
            derivedFrom: [],
        },
    };
}

// leg24 片1 删除位（原 leg21 `applyRosterAttrs` + `refineEntityAttrs` 单实体补抽）：整条"按需抄书"入口删除。
// 它们的存在前提是"名册里存着从书里抄来的属性"，而这条前提已随属性轮一并退场；
// 「补抽属性/隶属」按钮同批从界面下掉（design-core §4 砍掉清单第 6 项：书变自动发现，不需要玩家点）。
// 清除演化层（resetDynamicLayer）**保留**——它管的是引擎自己算的演化层（张力强度/环境量），不是抄书。
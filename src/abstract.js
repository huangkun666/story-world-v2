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
import { ENV_KEYS } from './entropy.js';
// leg24 片2：不再从 settle 借 ENTITY_ATTR_DEFAULT（该常量已删）——名册入账不预填数值
import { computeWeight } from './weight.js';

export const ENV_INIT_BASELINE = 0.5;      // 提案：抽取缺省环境量初值（patchDynamic 新键基线口径）
export const TENSION_INIT_BASELINE = 0.5;  // 提案：无旧 tension 数字时的强度初值（随长跑校准批）

// 第十八棒（v1 拍板值同款 · 提案态，随报批）：
export const CANON_SRC_CHAR = 30000;       // 设定五件套抽取：书文前 3 万字符单发（v1 实测 16k-30k 稳定）
export const ROSTER_CHUNK_CHAR = 60000;    // 书名录分块尺寸（字符级累计；v1 参数翻烧饼史终值）
export const ROSTER_CHUNK_DEPTH = 4;       // 块失败对半拆递归深度上限（v1 同款；条目数 ≤1 时不再拆）
// leg24 片1：ATTRS_BATCH_MAX / ROUND_BATCH_CHAR 随属性轮、关系轮一并删除（两轮已砍——书随时可查，不抄）

export function buildAbstractPrompt(sourceText) {
    return [
        '你是世界设定的抽取器。只提取不创作：只从给定的设定原文里提取事实，不创作、不润色、不补全、不重排。',
        '原文没有提到的字段一律省略；档位名、法令、人名、措辞必须来自原文；数量没有任何限制，取全不取量。',
        '输出严格 JSON，形状如下（可省字段不写 null；intensity 不许输出——它由引擎计算）：',
        JSON.stringify(
            {
                powerScale: [{ level: '档位名（原文）', note: '该档意味着什么（原文措辞）' }],
                rules: ['法则1（原文）'],
                society: '社会与制度格局（原文）',
                techOrMagic: '力量/生态体系（原文）',
                historyNotes: ['历史要点1（原文）'],
                situation: '当前世情：天下大势/各方态势一句（原文措辞 ≤80字；原文无全局局势则省）',
                bookEntities: [{ name: '势力/角色/地名的名号（原文名）', kind: 'faction|character|location（可省）' }],   // K37 书名录 + 第十九棒：只收原文名，不收泛指称呼；地名（洲/山/谷等）标 location
                                                                                                                          // leg24 片1：**停抄书**——上级/所在/种族/四维属性都不再抽（书随时可查；引擎不裁胜负，数值没有使用者）
                                                                                                                          //             身份（名号+类别）是账本主键，照旧；书用标签声明的结构走照书办（零模型调用）
                tension: { polarity: '两股劲的名字（原文）', direction: '当前方向：谁压谁（原文措辞，可省）' },
                env: { 民生度: 0.5, 动乱度: 0.5, 天时: 0.5, 张力推手: 0.5 },
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
export function buildRosterPrompt(sourceText, declared = []) {
    const lines = [
        '你是世界设定的名册抽取器。只提取不创作：只从给定原文里提取名号，不创作、不润色、不补全、不重排。',
        '输出严格 JSON（只输出 bookEntities 一组，形状如下；可省字段不写 null）：',
        JSON.stringify({ bookEntities: [{ name: '势力/角色/地名的名号（原文名）', kind: 'faction|character|location（可省）' }] }, null, 2),
        '纪律：',
        '1. 只收原文名，不收泛指称呼；地名（洲/山/谷/城等）标 location。',
        '2. 纯种族的群体名号（如 人族、妖族、鬼族、魔族、灵族、仙族、神族等）不算势力——不要给它们标 faction；只有书中明述的组织（如某族的宗族、门派、联盟、国度）才是势力。',
        '3. 本轮只负责名号与类别，别的一律不要输出（上级、所在、种族、属性都不问）。',
    ];
    // leg23 照书办①：书本段已用标签声明过的名号（如「<上界势力_蟠桃园>」）——清单给全，模型漏了也不丢。
    // 名号逐字取自原文；此处只作召回提示，类别仍按书标签在引擎侧定（不靠模型改判）。
    if (declared.length) {
        lines.push(
            '4. 本段原文里被标签直接标出来的名号（如上界势力_／幽冥势力_／某帝麾下_ 后的名字）一个都不能漏，必须全部出现在输出里：',
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
            const item = { name: d.name, kind: d.kind };
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
export function sanitizeCanon(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['抽取输出非对象（真形状净化：不可靠即拒绝）'] };
    }
    const errors = [];
    const canon = { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: [] };

    if (Array.isArray(raw.powerScale)) {
        for (const it of raw.powerScale) {
            if (!it || typeof it !== 'object') { errors.push('powerScale 含非对象项（已弃）'); continue; }
            const level = String(it.level ?? '').trim();
            const note = String(it.note ?? '').trim();
            if (!level || !note) { errors.push('powerScale 项缺 level/note（已弃）'); continue; }
            canon.powerScale.push({ level, note });
        }
    } else if (raw.powerScale !== undefined) errors.push('powerScale 非数组（已弃）');

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
        for (const it of raw.bookEntities) {
            if (!it || typeof it !== 'object') { errors.push('bookEntities 含非对象项（已弃）'); continue; }
            const name = String(it.name ?? '').trim();
            if (!name) { errors.push('bookEntities 项缺 name（已弃）'); continue; }
            if (seen.has(name)) continue;
            seen.add(name);
            const kind = it.kind === 'faction' ? 'faction' : it.kind === 'location' ? 'location' : 'character';
            const parent = normalizeParentName(it.parent);
            canon.bookEntities.push(parent ? { name, kind, parent } : { name, kind });
        }
    } else if (raw.bookEntities !== undefined) errors.push('bookEntities 非数组（已弃）');

    // 张力三件：极/方向取原文措辞；模型侧 intensity 一律丢弃（引擎算，K29）
    const tension = {
        polarity: String(raw?.tension?.polarity ?? '').trim(),
        direction: String(raw?.tension?.direction ?? '').trim(),
    };
    if (raw?.tension?.intensity !== undefined) errors.push('tension.intensity 由引擎计算，模型输出已丢弃');

    // 环境量初值（leg24 片5 口径修正）：**书里给了才落账**——键表白名单 + [0,1] 钳制；
    //   书没给的键**不入 env**（空着就是空着）；熵泵/掩码按基线 0.5 使用（不落账面），界面显示「（书未明述）」。
    //   旧法把缺失键一律写成 0.5 落账 → "四键 0.50"看起来像书的原值（用户实机反馈过），正是默认值冒充客观。
    const env = {};
    for (const key of ENV_KEYS) {
        const v = raw?.env?.[key];
        if (typeof v === 'number' && Number.isFinite(v)) env[key] = Math.min(1, Math.max(0, v));
        else if (v !== undefined) errors.push(`env.${key} 非有限数（已弃该键，账面留空）`);
        // v === undefined：书未明述 → 不写键（旧法落基线 0.5）
    }
    // leg24 片5（留痕收口）：净化层的坏项（非法 env/坏 bookEntities 项等）**上报到调用方的 errors**——
    // 旧法只在 callOnce 内部消化，`ok` 时静默丢弃：账面上少了东西却没有任何提示（"每条变更留痕"的反面）。
    const shapeWarnings = errors.slice();
    return { ok: true, canon, tension, env, errors, shapeWarnings };
}

export function assembleSetting({ canon, tension, env, legacyTension, fingerprint, extractedAt }) {
    return {
        frozen: { fingerprint, extractedAt, canon },
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

const EMPTY_CANON = () => ({ powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: [] });

// 单发小包装：prompt → 调用 → JSON 解析 → 净化；失败返回 {callError}
// buildPrompt 可传函数(t)→prompt（leg23：名册轮按块带书声明清单，故需闭包而非固定函数）
async function callOnce(extract, text, buildPrompt = buildAbstractPrompt) {
    let rawText;
    try {
        rawText = await extract(buildPrompt(text));
    } catch (err) {
        return { callError: `抽取调用失败: ${err?.message || err}` };
    }
    if (typeof rawText !== 'string' || !rawText.trim()) return { callError: '抽取输出为空' };
    let raw;
    try {
        raw = JSON.parse(rawText.trim());
    } catch {
        return { callError: '抽取输出非法 JSON（真形状净化：不可靠即拒绝）' };
    }
    const cleaned = sanitizeCanon(raw);
    if (!cleaned.ok) return { callError: cleaned.errors.join('; ') };
    return { cleaned, shapeWarnings: cleaned.shapeWarnings || [] };   // 净化坏项上报（leg24 片5 留痕收口）
}

// 行级分块：按累计字符 ≤ maxChar 切块（保行完整；超长单行自成一块）
export function chunkRows(rows, maxChar) {
    const chunks = [];
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

// 拆半递归（v1 tryChunk 同款精神）：块首试无效 → 对半拆（保内容，不空等重试）→ 拆不动保底重试一次 → 仍无效跳过降级。
// 返回 cleaned | null；两半合并只取 bookEntities 并集（块级只收书名录，v1 同款）。
function mergeCleaned(a, b) {
    if (!a) return b;
    if (!b) return a;
    const seen = new Set(a.canon.bookEntities.map((x) => x.name));
    const bookEntities = [...a.canon.bookEntities];
    for (const x of b.canon.bookEntities) {
        if (seen.has(x.name)) continue;
        seen.add(x.name);
        bookEntities.push(x);
    }
    return { canon: { ...a.canon, bookEntities }, tension: a.tension, env: a.env };
}

// leg24 片1 删除位（原 leg20/leg21 `validateRosterDetails`）：属性/种族/所在的"书级出处校验"整块删除——
// 它守的是"从书里抄出来的字段别抄错"，而这些字段已不再抄。名号级的全书出处判定仍在 extractWorldSetting
// （纯编造的名号照旧丢：那守的是"账本不发明事实"，与抄不抄书无关）。

async function tryRosterChunk(extract, text, depth, probeState, declared = []) {
    const rosterPrompt = (t) => buildRosterPrompt(t, declared);   // leg23：本块内按书声明给召回清单
    const r = await callOnce(extract, text, rosterPrompt);        // leg21：名册轮专用瘦身 prompt
    if (!r.callError) return { cleaned: r.cleaned };
    probeState.failures += 1;
    if (depth < ROSTER_CHUNK_DEPTH) {
        const lines = text.split('\n').filter(Boolean);
        if (lines.length > 1) {
            const mid = Math.ceil(lines.length / 2);
            const halfA = await tryRosterChunk(extract, lines.slice(0, mid).join('\n'), depth + 1, probeState, declared);
            if (halfA.aborted) return halfA;
            const halfB = await tryRosterChunk(extract, lines.slice(mid).join('\n'), depth + 1, probeState, declared);
            if (halfB.aborted) return halfB;
            return { cleaned: mergeCleaned(halfA.cleaned, halfB.cleaned) };
        }
    }
    // 拆不动（单条/深度到底）→ 保底重试一次（v1 同款）
    const retry = await callOnce(extract, text, rosterPrompt);
    if (!retry.callError) return { cleaned: retry.cleaned };
    probeState.failures += 1;
    return { cleaned: null };
}

// leg24 片1 删除位（原 leg21 属性轮 `runAttrsRound` + K49 关系轮 `runRelationRound` + 两轮共用的
// 批切分 `batchRowsByName` / 名号行邻域匹配 `nameInRow`）：**整条"抽书"流水线删除**（不是停用）。
// 四维数值的正当来源改为主调用里 LLM 的逐轮提议 + 引擎钳制（settle 既有通道，本片不动）；
// 隶属/所在改走「照书办」（书标签声明）+ 用得着时查书（片2）。
// 留档：两条路线都实测过并各自有硬数据——属性轮=leg21 拆轮（名册 504→106 的回归修法）、
// 关系轮=K49（真机势力→势力 parent 仅 3%）；它们的产出全属"书的副本"，故一并退场。

// 执行器：{sourceText, extract, cache?, force?, extractedAt?, legacyTension?} → {ok, setting, cached, fingerprint, errors}
// 第十八棒：小书（≤ CANON_SRC_CHAR）单发全量（与历史行为零差异）；大书分段多调用——
// 五件套=头 CANON_SRC_CHAR 单发；书名录=全条目分块多调用（拆半自适应 + 降级 + 全书级出处校验）。
export async function extractWorldSetting({ sourceText, extract, cache, force = false, extractedAt, legacyTension }) {
    const src = String(sourceText ?? '');
    const fp = bookFingerprint(src);
    const stamp = extractedAt || new Date().toISOString();

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
        const r = await callOnceWithDeclared(extract, src, smallDeclared)
            .then((first) => (first.callError ? callOnceWithDeclared(extract, src, smallDeclared) : first));   // 空/失败重试一次（v1 瞬时网关教训）
        if (r.callError) return { ok: false, errors: [`抽取失败（已重试一次）：${r.callError}——可再点重试；反复出现请检查模型通道或换小源验证`] };
        errors.push(...(r.shapeWarnings || []));   // leg24 片5：净化坏项上报（如 env 非法值弃键）
        const applied = applyDeclaredToRoster(r.cleaned.canon.bookEntities, smallDeclared);
        if (smallDeclared.length) {
            errors.push(`照书办: 本书标签声明 ${smallDeclared.length} 个名号（补入册 ${applied.added} / 改判类别 ${applied.fixed}）`);
        }
        const setting = assembleSetting({ canon: r.cleaned.canon, tension: r.cleaned.tension, env: r.cleaned.env, legacyTension, fingerprint: fp, extractedAt: stamp });
        if (cache) cache.set(fp, { canon: r.cleaned.canon, tension: r.cleaned.tension, env: r.cleaned.env }, stamp);
        return { ok: true, cached: false, fingerprint: fp, setting, errors };
    }

    // 大书：五件套=头 CANON_SRC_CHAR 单发（失败降级=空 canon，不阻塞书名录）；空/失败自动重试一次
    const canonSrc = Array.from(src).slice(0, CANON_SRC_CHAR).join('');
    let canonR = await callOnce(extract, canonSrc);
    if (canonR.callError) canonR = await callOnce(extract, canonSrc);
    if (canonR.callError) {
        errors.push(`设定五件套抽取失败（已降级空 canon）：${canonR.callError}`);
    }
    errors.push(...(canonR.shapeWarnings || []));   // leg24 片5：净化坏项上报（如 env 非法值弃键）
    const canonBase = canonR.cleaned ?? { canon: EMPTY_CANON(), tension: { polarity: '', direction: '' }, env: {} };

    // 书名录：全条目分块多调用（全量覆盖，v1 教训：人名藏在条目深处，不许头截断）
    const rows = src.split('\n').map((s) => s.trim()).filter(Boolean);
    const chunks = chunkRows(rows, ROSTER_CHUNK_CHAR);
    // leg23 照书办①：先把书本段「结构声明」扫出来（纯函数零调用）——按块给召回清单，块后再强制并册
    const { declares: declared, usesLabelTerms } = scanBookDeclarations(src);
    if (usesLabelTerms.length) errors.push('照书办: 检测到词表判据参与声明扫描（应为形态判据，请核查）');
    const bookSeen = new Set();
    const bookNames = [];
    for (const b of canonBase.canon.bookEntities) {   // 头 30k 内名号先入（书序优先）
        if (bookSeen.has(b.name)) continue;
        bookSeen.add(b.name);
        bookNames.push(b);
    }
    const probeState = { failures: 0 };
    let okChunks = 0;
    for (const chunk of chunks) {
        const { cleaned } = await tryRosterChunk(extract, chunk, 0, probeState, declared);
        if (!cleaned) {
            errors.push('书名录块抽取失败（已跳过降级，其余块照常；网络恢复后「重新抽取」可补回）');
            continue;
        }
        okChunks += 1;
        for (const b of cleaned.canon.bookEntities) {
            if (bookSeen.has(b.name)) continue;
            bookSeen.add(b.name);
            bookNames.push(b);
        }
    }

    // leg23 照书办②：书声明的名号**强制并册**（模型漏了也不丢）+ 照标签定类别、照标签落上级。
    // 类别覆盖只认「书声明的势力」——修正实证的 7 例误判（蟠桃园/瑶池/太昊仙洲…被判 location）；
    // 上级只在名册尚无该键时写入（first-wins：模型/书正文的明述优先，标签只补缺）。
    const applied = applyDeclaredToRoster(bookNames, declared);
    const declaredAdded = applied.added;
    const declaredFixed = applied.fixed;
    if (declared.length) {
        errors.push(`照书办: 书本段标签声明 ${declared.length} 个名号（补入册 ${declaredAdded} / 改判类别 ${declaredFixed}）`);
    }

    // 全书级出处判定（v1 同款：块级只洗结构，出处全书级判一次；纯编造才丢）
    const before = bookNames.length;
    const finalNames = bookNames.filter((b) => src.includes(b.name));
    if (finalNames.length < before) {
        errors.push(`书名录全书级出处校验：${before - finalNames.length} 个名号原文未出现（疑似编造，已弃）`);
    }

    // leg24 片1（停抄书）：关系轮/属性轮/出处细节校验三处调用点一并删除——名册定稿即为交付态。
    const canon = { ...canonBase.canon, bookEntities: finalNames };
    if (canonR.callError && okChunks === 0 && !finalNames.length) {
        return { ok: false, errors: ['设定与书名录抽取全部失败（世界未动，可重试）'] };
    }
    const setting = assembleSetting({ canon, tension: canonBase.tension, env: canonBase.env, legacyTension, fingerprint: fp, extractedAt: stamp });
    if (cache) cache.set(fp, { canon, tension: canonBase.tension, env: canonBase.env }, stamp);
    return { ok: true, cached: false, fingerprint: fp, setting, errors };
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

export function seedBookEntities(ssot) {
    const book = ssot.context?.setting?.frozen?.canon?.bookEntities || [];
    if (!book.length) return { seeded: 0, folded: 0, skippedLocation: 0, warnings: [] };
    const positions = ssot.context?.positions || [];
    const home = positions[0] || '未明';    // leg21：兜底位置改中立词「未明」——旧提案词「中央」无含义（数据实证：名册 0 带 location → 全员落占位）
    const warnings = [];

    // 名册索引（sanitize 已按 name 去重）
    const idx = new Map(book.map((b) => [b.name, b]));
    const byName = new Map();                   // 已入账实体名 → 实体
    for (const e of ssot.entities || []) byName.set(e.name, e);

    let seeded = 0;
    let folded = 0;
    let skippedLocation = 0;
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
            if (ent) { ent.parent = target.name; organs.push({ owner: target.name, name: b.name }); }
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
    // 第三遍：角色整量入账 + parent（所属势力）解析
    // leg23 修正：**册里明述为势力的上级一律认**——旧口径要求"上级实体此刻已在账"，而势力的入账在第一/二遍，
    // 角色却排在第三遍之前判断，导致「龙骧 → 镇海先锋营」这类真关系被误判成"未明述为势力"而丢弃（实测 20 条警告之根）。
    // 现在：上级在册 → 直接认（链顶解析得到则写链顶名，否则写上级本身，其自身实体会在账上指到链顶）；只有**不在册**才留痕。
    for (const b of book) {
        if (b.kind !== 'character') continue;
        const ent = pushEntity(b);
        if (!ent) continue;
        if (!b.parent) continue;
        const inRoster = idx.get(b.parent);
        if (inRoster && inRoster.kind === 'faction') {
            const target = resolveSeedTarget(b.parent, idx);
            ent.parent = target?.kind === 'faction' ? target.name : b.parent;
        } else {
            warnings.push(`书名录: 「${b.name}」的所属「${b.parent}」不在册或不是势力——隶属空着（角色照常入账）`);
        }
    }
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
    return out;
}

// ============ leg21 增量抽象（docs/incremental-refine-spec.md）：清除演化层 / 名册→实体补缺 / 单实体补抽 ============

// 清除演化层（纯函数，不可变）：intensity/env 回基线、derivedFrom 清空；polarity/direction 保留
//（它们是书抽的设定面，不属演化）；frozen 一概不动。不触发任何抽取调用。
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
            env: Object.fromEntries(ENV_KEYS.map((k) => [k, ENV_INIT_BASELINE])),
            derivedFrom: [],
        },
    };
}

// leg24 片1 删除位（原 leg21 `applyRosterAttrs` + `refineEntityAttrs` 单实体补抽）：整条"按需抄书"入口删除。
// 它们的存在前提是"名册里存着从书里抄来的属性"，而这条前提已随属性轮一并退场；
// 「补抽属性/隶属」按钮同批从界面下掉（design-core §4 砍掉清单第 6 项：书变自动发现，不需要玩家点）。
// 清除演化层（resetDynamicLayer）**保留**——它管的是引擎自己算的演化层（张力强度/环境量），不是抄书。
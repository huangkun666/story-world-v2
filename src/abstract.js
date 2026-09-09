// story-world-v2/src/abstract.js
// 抽象管线执行器（K31/双流 UI，编排层；细案 §3.4/§4 K31 → A-6/A-7）。
// 书源文本 → 书指纹（K26，FNV-1a）→ 缓存命中 = 零抽取调用 / 书变自动失效 / force 绕过强制重抽
// → 一次 LLM 小调用抽取（只提取不创作、无数量约束取全、原文措辞不润色）
// → 净化（形状合法为止）→ 落 context.setting（frozen 五件套 + bookEntities 书名录 + dynamic 初值）。
// 职责链（红线 4 同构）：LLM 只提取不创作（上游提议）；引擎只做确定性净化与落账（引擎钳制）。
// K37：书名录段（生通道①，§3.7）+ seedBookEntities 幂等入账（席位按书序优先，POOL_CAP 提案值）。
// 纪律：
//   - dynamic.tension.intensity 不许模型拍（K29 引擎确定性计算）——净化时丢弃模型侧 intensity；
//   - env 初值键表白名单（报批二批 #3 定案四键）+ [0,1] 钳制；缺省 = 基线 0.5（提案）；
//   - 空 canon 合法（K24 口径：无数量约束，防编造靠纪律不靠量制）。
import { bookFingerprint } from './fingerprint.js';
import { ENV_KEYS } from './entropy.js';
import { POOL_CAP, ENTITY_ATTR_DEFAULT, INBORN_ATTR_KEYS } from './settle.js';

export const ENV_INIT_BASELINE = 0.5;      // 提案：抽取缺省环境量初值（patchDynamic 新键基线口径）
export const TENSION_INIT_BASELINE = 0.5;  // 提案：无旧 tension 数字时的强度初值（随长跑校准批）

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
                bookEntities: [{ name: '势力或角色的名号（原文名）', kind: 'faction|character（可省）' }],   // K37 书名录：书里明确存在的名号实体，只收原文名，不收泛指称呼
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

// 净化：形状合法为止（逐项取好弃坏，errors 记录坏项）；硬失败仅"输出非对象"。
export function sanitizeCanon(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, errors: ['抽取输出非对象（真形状净化：不可靠即拒绝）'] };
    }
    const errors = [];
    const canon = { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], bookEntities: [] };

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

    // K37 书名录：只提取不创作——name 原文名去重；kind 枚举净化（非法/缺省=character）；见字收、取全不取量
    if (Array.isArray(raw.bookEntities)) {
        const seen = new Set();
        for (const it of raw.bookEntities) {
            if (!it || typeof it !== 'object') { errors.push('bookEntities 含非对象项（已弃）'); continue; }
            const name = String(it.name ?? '').trim();
            if (!name) { errors.push('bookEntities 项缺 name（已弃）'); continue; }
            if (seen.has(name)) continue;
            seen.add(name);
            canon.bookEntities.push({ name, kind: it.kind === 'faction' ? 'faction' : it.kind === 'character' ? 'character' : 'character' });
        }
    } else if (raw.bookEntities !== undefined) errors.push('bookEntities 非数组（已弃）');

    // 张力三件：极/方向取原文措辞；模型侧 intensity 一律丢弃（引擎算，K29）
    const tension = {
        polarity: String(raw?.tension?.polarity ?? '').trim(),
        direction: String(raw?.tension?.direction ?? '').trim(),
    };
    if (raw?.tension?.intensity !== undefined) errors.push('tension.intensity 由引擎计算，模型输出已丢弃');

    // 环境量初值：键表白名单 + [0,1] 钳制；非法/缺省 → 基线
    const env = {};
    for (const key of ENV_KEYS) {
        const v = raw?.env?.[key];
        if (typeof v === 'number' && Number.isFinite(v)) env[key] = Math.min(1, Math.max(0, v));
        else if (v !== undefined) { errors.push(`env.${key} 非有限数（已落基线）`); env[key] = ENV_INIT_BASELINE; }
        else env[key] = ENV_INIT_BASELINE;
    }
    return { ok: true, canon, tension, env, errors };
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

// 执行器：{sourceText, extract, cache?, force?, extractedAt?, legacyTension?} → {ok, setting, cached, fingerprint, errors}
export async function extractWorldSetting({ sourceText, extract, cache, force = false, extractedAt, legacyTension }) {
    const fp = bookFingerprint(sourceText);
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
    let rawText;
    try {
        rawText = await extract(buildAbstractPrompt(sourceText));
    } catch (err) {
        return { ok: false, errors: [`抽取调用失败: ${err?.message || err}`] };
    }
    if (typeof rawText !== 'string' || !rawText.trim()) return { ok: false, errors: ['抽取输出为空'] };
    let raw;
    try {
        raw = JSON.parse(rawText.trim());
    } catch {
        return { ok: false, errors: ['抽取输出非法 JSON（真形状净化：不可靠即拒绝）'] };
    }
    const cleaned = sanitizeCanon(raw);
    if (!cleaned.ok) return { ok: false, errors: cleaned.errors };

    const setting = assembleSetting({ canon: cleaned.canon, tension: cleaned.tension, env: cleaned.env, legacyTension, fingerprint: fp, extractedAt: stamp });
    if (cache) cache.set(fp, { canon: cleaned.canon, tension: cleaned.tension, env: cleaned.env }, stamp);
    return { ok: true, cached: false, fingerprint: fp, setting };
}

// 落账到世界（不可变）：context.setting 整体替换；旧 context.tension 保留（兼容口径 K24 §3.7）
export function applySettingToSsot(ssot, setting) {
    return { ...ssot, context: { ...(ssot.context || {}), setting } };
}

// K37 生通道①（细案 §3.7 → A-10）：书名录初始化——frozen.canon.bookEntities 未在账实体幂等入账
// （出处=书内条目，只提取不创作；kind 缺省 character；location 取位置集首个）；
// K38（敲定稿 D 条）：attrs 按 kind 缺省兜底（与 newEntities 入口同口径——入局即有值，不再哑巴）；
// 席位按书序优先入到 POOL_CAP 满（剩余留名录，供 book 源 newEntities 提议继续入局）；dead 同名不回魂。
const buildSeedAttrs = (kind) => {
    const v = ENTITY_ATTR_DEFAULT[kind] ?? ENTITY_ATTR_DEFAULT.character;
    return Object.fromEntries(INBORN_ATTR_KEYS.map((k) => [k, v]));
};
export function seedBookEntities(ssot) {
    const book = ssot.context?.setting?.frozen?.canon?.bookEntities || [];
    if (!book.length) return { seeded: 0 };
    const positions = ssot.context?.positions || [];
    const home = positions[0] || '未知';
    let seeded = 0;
    for (const b of book) {
        const active = (ssot.entities || []).filter((e) => !e.status || e.status === 'active').length;
        if (active >= POOL_CAP) break;
        const name = String(b?.name || '').trim();
        if (!name) continue;
        if ((ssot.entities || []).some((e) => e.name === name)) continue;   // 已有（含 retired）不重建；dead 不回魂
        (ssot.entities = ssot.entities || []).push({
            id: `e_bk_${seeded + 1}`,
            kind: b.kind === 'faction' ? 'faction' : 'character',
            name,
            location: home,
            attrs: buildSeedAttrs(b.kind === 'faction' ? 'faction' : 'character'),
        });
        seeded += 1;
    }
    return { seeded };
}
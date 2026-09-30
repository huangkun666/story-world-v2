// story-world-v2/demo/measure-leg25h-alias-ab.js · 真模型 A/B（只读；不打印密钥）
// 问：新提示词（要求交出 `aliases`）在老模型行为上到底减不减碎片？
// 做法：拿**同一块真书文本**，分别用
//   ①旧提示词（从上一个提交 4289db3 取出，非手写近似）
//   ②新提示词（当前工作区）
// 各跑一次名册抽取，逐项数：
//   · 产出条目数 / 含别名的条目数 / 别名总个数
//   · **碎片名是否还在**（大虞 / 大虞皇朝 / 大虞边境三十六凡俗小国 / 人族 / 妖族 / 鬼族 / 魔族 / 灵族 / 半妖 / 龙族）
// 分两块跑（块的切法用生产同款 chunkRows）：
//   · 块A = 含 `【人族皇朝】` 定义的那一块  → 看"定义了别名的那块"模型交不交 aliases
//   · 块B = 只提到「大虞」、没有该条目的另一块 → 看"没有定义的那块"模型会不会照旧单出一条
// 跑法：SWV2_OLDPROMPT=<旧abstract.js路径> node demo/measure-leg25h-alias-ab.js <块A文件> <块B文件>
import { readFileSync } from 'node:fs';
import { loadStPresetConfig } from '../src/st-preset.js';
import { createHttpTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-http.js';
import { buildRosterPrompt, dedupeRoster } from '../src/abstract.js';

const cfg = loadStPresetConfig();
if (!cfg) { console.log('❌ 预设读取失败（loadStPresetConfig 返回空）'); process.exit(1); }
const oldMod = await import(new URL(`file:///${String(process.env.SWV2_OLDPROMPT).replace(/\\/g, '/')}`).href);
const oldPrompt = oldMod.buildRosterPrompt;

const transport = createHttpTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, maxTokens: EXTRACTION_MAX_TOKENS });

const FRAGMENTS = ['大虞', '大虞皇朝', '大虞边境三十六凡俗小国', '人族', '妖族', '鬼族', '魔族', '灵族', '半妖', '龙族', '天庭', '万法', '无间'];
const parse = (text) => {
    try {
        const m = /\{[\s\S]*\}/.exec(String(text));
        if (!m) return null;
        return JSON.parse(m[0]);
    } catch (e) { return { __parseError: String(e.message), __raw: String(text).slice(0, 400) }; }
};

async function runOne(label, promptFn, chunkText, model) {
    const prompt = promptFn(chunkText);
    const t0 = Date.now();
    let out = '';
    try { out = await transport(prompt); } catch (e) { return { label, error: String(e?.message || e) }; }
    const ms = Date.now() - t0;
    const j = parse(out);
    const ents = Array.isArray(j?.bookEntities) ? j.bookEntities : [];
    const withAlias = ents.filter((e) => Array.isArray(e.aliases) && e.aliases.length);
    const aliasCount = withAlias.reduce((s, e) => s + e.aliases.length, 0);
    const frag = ents.filter((e) => FRAGMENTS.includes(String(e.name).trim())).map((e) => e.name);
    return {
        label, model, ms, bytes: String(out).length,
        total: ents.length, withAlias: withAlias.length, aliasCount, frag,
        entities: ents,          // ★留给"拼块合并"那一步用（上面只数了数，这里留原文条目）
        aliasSamples: withAlias.slice(0, 6).map((e) => `${e.name} ← [${e.aliases.join('、')}]`),
        fragSamples: ents.filter((e) => FRAGMENTS.includes(String(e.name).trim())).slice(0, 8).map((e) => `${e.name}(${e.kind || '无kind'})`),
        parseError: j?.__parseError || null,
        rawHead: j?.__parseError ? j.__raw : null,
    };
}

const chunks = process.argv.slice(2).map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
console.log(`模型 = ${cfg.model}（密钥不打印）· 抽取预算 ${EXTRACTION_MAX_TOKENS} tokens`);
console.log(`旧提示词来源 = ${process.env.SWV2_OLDPROMPT}\n`);

const results = [];
for (const c of chunks) {
    const name = c.file.split(/[\\/]/).pop();
    console.log('='.repeat(78));
    console.log(`块 ${name}：${Array.from(c.text).length} 字符`);
    const hasEntry = /【人族皇朝】/.test(c.text);
    console.log(`  含【人族皇朝】定义？ ${hasEntry ? '★是（看模型交不交 aliases）' : '否（看会不会单出一条碎片）'}`);
    for (const [tag, fn] of [['旧提示词', oldPrompt], ['新提示词', buildRosterPrompt]]) {
        if (process.env.SWV2_ONLY && tag !== process.env.SWV2_ONLY) continue;   // 只跑一侧（省调用）
        const r = await runOne(tag, fn, c.text, cfg.model);
        results.push({ chunk: name, ...r });
        if (r.error) { console.log(`  [${tag}] ❌ ${r.error}`); continue; }
        if (r.parseError) { console.log(`  [${tag}] ⚠ JSON 解析失败：${r.parseError}｜原文头 ${JSON.stringify(r.rawHead?.slice(0, 120))}`); continue; }
        console.log(`  [${tag}] ${r.ms}ms · 输出 ${r.bytes} 字节 · 条目 ${r.total} · 带别名条目 ${r.withAlias} · 别名共 ${r.aliasCount} · **碎片名 ${r.frag.length}**${r.frag.length ? `：${JSON.stringify(r.frag)}` : ''}`);
        for (const s of r.aliasSamples) console.log(`        ${s}`);
    }
}

console.log('\n' + '='.repeat(78));
console.log('★汇总');
for (const r of results) {
    if (r.error) { console.log(`  ${r.chunk} ${r.label}：❌ ${r.error}`); continue; }
    console.log(`  ${r.chunk} ${r.label}：条目 ${r.total} · 别名条目 ${r.withAlias} · 别名 ${r.aliasCount} · 碎片 ${r.frag.length}`);
}

// ★缺失的一环：上面每块是**单独**跑的，还没证明"拼块"那一步真会把同义异名合掉。
//   拿各块实际产出的条目做一次**全局去重**（生产同款 `dedupeRoster`），数合并前后差多少。
//   ★踩过的坑（留档）：第一版把**旧提示词与新提示词的产出混在一起**去重 ⇒ 旧的没有 aliases、
//     新的声明了，于是"谁赢了"变成抛硬币（实测出现 `大虞皇朝 ← [人族皇朝、大虞]` 这种反过来的结果）。
//     合并只能对**同一套提示词的产出**做——那才是生产里真实发生的事。
const collected = results.filter((r) => r.entities && r.label === (process.env.SWV2_ONLY || '新提示词')).flatMap((r) => r.entities);
if (collected.length) {
    const merged = dedupeRoster(collected);
    const softMatch = (a, b) => a === b || a.includes(b) || b.includes(a);
    const fragNow = merged.filter((m) => FRAGMENTS.some((f) => softMatch(String(m.name).trim(), f))).map((m) => m.name);
    console.log('\n★拼块合并实测（生产同款 dedupeRoster，对各块真实产出做全局去重）');
    console.log(`  合并前 ${collected.length} 条 → 合并后 ${merged.length} 条（合掉 ${collected.length - merged.length} 条）`);
    console.log(`  合并后仍带碎片名的条目 = ${fragNow.length}：${JSON.stringify(fragNow)}`);
    // 关键个案：大虞 系
    const dy = merged.filter((m) => String(m.name).includes('大虞') || (m.aliases || []).some((a) => String(a).includes('大虞')));
    console.log(`  与大虞有关的条目剩 ${dy.length} 条：`);
    for (const m of dy) console.log(`      ${m.name}${m.aliases?.length ? ` ← [${m.aliases.join('、')}]` : ''}（${m.kind || '无kind'}）`);
}

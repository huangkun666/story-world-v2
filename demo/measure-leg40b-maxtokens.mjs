// 只读实测 v2：走**插件自己的 createHttpTransport**（已验证能通），用捕获式 fetchImpl 拿原始响应。
// 问的仍是同一件事：主调用受不受 max_tokens 限制（输出用量 / finish_reason / 条数）。
import { readFileSync, writeFileSync } from 'node:fs';
import { buildEvolutionPack } from '../src/pack.js';
import { assembleMainPrompt } from '../src/prompts.js';
import { resolveWorldTransport, loadStPresetConfig } from '../src/st-preset.js';
import { createHttpTransport } from '../src/transport-http.js';

const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD = `${ST_DATA}/chats/大荒z1/大荒z - 2026-09-14@16h54m07s001ms.jsonl`;
const world = (() => {
    const raw = readFileSync(WORLD, 'utf8');
    const nl = raw.indexOf('\n');
    return JSON.parse(nl < 0 ? raw : raw.slice(0, nl)).chat_metadata.story_world_v2.world;
})();
const pack = buildEvolutionPack(world, null).pack;
const prompt = assembleMainPrompt(pack);
const cfg = loadStPresetConfig();   // ★必须用它：`resolveWorldTransport()` **故意不暴露 apiKey**（只给 transport）
if (!cfg) { console.error('✗ 读不到 ST 预设（loadStPresetConfig 返回 null）'); process.exit(1); }
const tok = (s) => Math.round(Array.from(String(s)).length / 1.6);

console.log(`世界 tick ${world.meta?.tick} · 实体 ${(world.entities || []).length} · 线头 ${(pack.openRoots || []).length} · 线捆 ${(pack.threads || []).length}`);
console.log(`入参 ${Array.from(prompt).length} 字符 ≈ ${tok(prompt)} token`);
console.log('');

const seen = [];
async function run(maxTokens) {
    const capture = async (url, opts) => {
        const req = JSON.parse(opts.body);
        const res = await fetch(url, opts);
        const raw = await res.text();
        seen.push({ url: String(url), model: req.model, reqKeys: Object.keys(req), max_tokens: req.max_tokens, status: res.status, raw });
        return { ok: res.ok, status: res.status, text: async () => raw, json: async () => JSON.parse(raw) };
    };
    const transport = createHttpTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, fetchImpl: capture, maxTokens });
    const t0 = Date.now();
    let out = ''; let err = null;
    try { out = String(await transport(prompt)); } catch (e) { err = String(e?.message || e); }
    const rec = seen.at(-1) || {};
    let body = null; try { body = JSON.parse(rec.raw); } catch (_) {}
    const msg = body?.choices?.[0]?.message || {};
    const reasoning = String(msg.reasoning_content ?? msg.reasoning ?? '');
    const text = String(msg.content ?? out ?? '');
    let parsed = null; try { parsed = JSON.parse(text); } catch (_) {}
    return {
        maxTokens, ms: Date.now() - t0, status: rec.status, reqKeys: rec.reqKeys, sentMaxTokens: rec.max_tokens,
        finish: body?.choices?.[0]?.finish_reason ?? null,
        usage: body?.usage ?? null,
        outChars: Array.from(text).length, outTokEst: tok(text), reasonChars: Array.from(reasoning).length,
        err, rawHead: String(rec.raw || '').slice(0, 300),
        counts: parsed ? Object.fromEntries(['newEvents', 'newAgendas', 'actions', 'agendaAdvances', 'newEntities', 'entityUpdates'].map((k) => [k, (parsed[k] || []).length])) : null,
        text,
    };
}

const arms = [];
for (const mt of [16384, 32768]) {
    console.log(`── max_tokens=${mt} ──`);
    const r = await run(mt);
    arms.push(r);
    console.log(`  请求体键=${JSON.stringify(r.reqKeys)} · 实发 max_tokens=${r.sentMaxTokens} · HTTP ${r.status} · ${(r.ms / 1000).toFixed(1)}s`);
    if (r.err) console.log(`  ✗ ${r.err}`);
    console.log(`  finish_reason=${r.finish} · usage=${JSON.stringify(r.usage)}`);
    console.log(`  输出 ${r.outChars} 字符 ≈ ${r.outTokEst} token（reasoning ${r.reasonChars} 字符）`);
    console.log(`  条数=${JSON.stringify(r.counts)}`);
    if (!r.counts) console.log(`  响应头 300 字：${r.rawHead.replace(/\s+/g, ' ')}`);
    console.log('');
}

const [a, b] = arms;
console.log('══ 收口 ══');
console.log(`  输出 ≈ ${a.outTokEst} / ${b.outTokEst} token ⇒ 占各自上限 ${(100 * a.outTokEst / 16384).toFixed(1)}% / ${(100 * b.outTokEst / 32768).toFixed(1)}%`);
console.log(`  finish_reason：${a.finish} / ${b.finish}`);
if (a.counts && b.counts) {
    console.log(`  新事件 ${a.counts.newEvents} vs ${b.counts.newEvents} · 新线 ${a.counts.newAgendas} vs ${b.counts.newAgendas}`);
    console.log(`  ⇒ ${JSON.stringify(a.counts) === JSON.stringify(b.counts) ? '★两档条数相同 ⇒ 与 max_tokens 无关（模型自己的选择）' : '两档不同 ⇒ 预算可能真在起作用'}`);
}
writeFileSync('F:/deepseek/tmp/leg40b-maxtokens.json', JSON.stringify(arms.map(({ text, ...rest }) => ({ ...rest, textHead: String(text).slice(0, 600) })), null, 2));
console.log('\n出数：F:/deepseek/tmp/leg40b-maxtokens.json');

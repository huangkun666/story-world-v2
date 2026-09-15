// story-world-v2/demo/seed-roots-migrate.js
// leg40 · **一次性移植**：给一个已经开好的世界补种"世界源起的根"（用户拍板版）。
//
// 用户拍板的那一版做了什么（与本棒前半段的三点差别）：
//   ① **不是载入期偷偷跑**：这是一条**显式命令**（备份 → 起根 → 写后逐项自证），不做自动移植；
//   ② **分块覆盖全书**（不再只截前 3 万字）：按行分块（`--chunk-chars`，缺省 60000，与名册抽取同一量级），
//      逐块问"书里正在发生的事"——真账那本 305,590 字符 ⇒ 老策略只看了 10%；
//   ③ **带候选池**：把账上"还没上过台的人"（从没被事件点过名的实体名）递给模型，要求当事人从名单里挑
//      ⇒ 种子自带"谁"，且天生不与那场大乱的人重叠。
//
// ★★安全（写的是用户数据，照 leg35 立的那一套）：
//   · 缺省 **dry-run**：只跑抽取 + 净化 + 打印将要落账的事件，**一个字节都不写**；
//   · `--install` 才写入，且**先备份两份**（真账 + 不动向量库），写入后**逐项自证**（行数/其余行逐字节/首行回读）。
//
// 用法：
//   node demo/seed-roots-migrate.js                      # 干跑（只打印）
//   node demo/seed-roots-migrate.js --install            # 写入（先备份、写后自证）
//   node demo/seed-roots-migrate.js --chunk-chars 40000 --max-per-chunk 3 --install
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { seedRootsChunked, buildSeedRootsPrompt, SEED_ROOTS_MAX } from '../src/seed-roots.js';
import { computeOpenRoots } from '../src/pack.js';

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const WORLD_PATH = argVal('--world', `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`);
const BOOK_PATH = argVal('--book', `${ST_DATA}/worlds/大荒-姬元真.json`);
const CHUNK_CHARS = Math.max(5000, parseInt(argVal('--chunk-chars', '60000'), 10) || 60000);
const MAX_PER_CHUNK = Math.max(1, parseInt(argVal('--max-per-chunk', '4'), 10) || 4);
const CAND_TOP = Math.max(0, parseInt(argVal('--candidates', '60'), 10) || 60);
const INSTALL = hasFlag('--install');
const line = (s) => console.log(s);

// ---------- 读账（只读） ----------
const raw = readFileSync(WORLD_PATH, 'utf8');
const nl = raw.indexOf('\n');
const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
const world = header?.chat_metadata?.story_world_v2?.world;
if (!world) { console.error('✗ 真账里没有 story_world_v2.world'); process.exit(1); }

// ---------- 候选池：账上"还没上过台的人"（机械：从没被任何事件点名过的 active 实体名） ----------
const named = new Set();
for (const e of world.events || []) for (const r of e.ripples || []) named.add(r);
const candidates = (world.entities || [])
    .filter((e) => (e.status || 'active') === 'active' && !named.has(e.id) && e.id !== world.context?.playerId)
    .filter((e) => typeof e.name === 'string' && e.name.length >= 2 && e.name.length <= 12)
    .map((e) => e.name);
const candUse = candidates.slice(0, CAND_TOP);

// ---------- 分块（按行，与名册抽取同一治法） ----------
const book = JSON.parse(readFileSync(BOOK_PATH, 'utf8'));
const entries = book.entries && !Array.isArray(book.entries) ? Object.values(book.entries) : (book.entries || []);
const bookText = entries.map((e) => `## ${String(e?.comment || e?.key?.[0] || '').trim()}\n${String(e?.content ?? '')}`).join('\n\n');
const rows = bookText.split('\n').map((s) => s.trim()).filter(Boolean);
const chunks = [];
{
    let cur = []; let len = 0;
    for (const r of rows) {
        const l = Array.from(r).length;
        if (cur.length && len + l > CHUNK_CHARS) { chunks.push(cur.join('\n')); cur = []; len = 0; }
        cur.push(r); len += l;
    }
    if (cur.length) chunks.push(cur.join('\n'));
}

line('═══ leg40 · 世界源起根 · 一次性移植 ═══');
line(`真账：${WORLD_PATH}`);
line(`起点：tick ${world.meta?.tick} · 实体 ${(world.entities || []).length} · 未决事件 ${(world.events || []).filter((e) => !e.closed).length} · **线头 ${computeOpenRoots(world).length}**`);
line(`书：${BOOK_PATH} · ${entries.length} 条 / ${bookText.length} 字符 ⇒ **分块 ${chunks.length} 块**（每块 ≤ ${CHUNK_CHARS} 字符；老策略只看前 30,000 字符 = ${(100 * 30000 / bookText.length).toFixed(1)}%）`);
line(`候选池：账上从没被点过名的实体 ${candidates.length} 个 ⇒ 递 ${candUse.length} 个（${candUse.slice(0, 8).join('、')}…）`);
line(`模式：**${INSTALL ? '写入（--install：先备份、写后自证）' : '干跑（不写一个字节）'}**`);

const { resolveWorldTransport } = await import('../src/st-preset.js');
const resolved = resolveWorldTransport();
if (!resolved) { console.error('✗ 未找到模型配置'); process.exit(1); }
line(`真模型：${resolved.model}`);
line('');

// ---------- 起根（在**内存副本**上做；只有 --install 才落盘） ----------
const draft = structuredClone(world);
const t0 = Date.now();
const res = await seedRootsChunked({
    ssot: draft, chunks, extract: resolved.transport, candidates: candUse,
    fingerprint: `leg40-chunked:${bookText.length}:${CHUNK_CHARS}`, at: new Date().toISOString(), maxPerChunk: MAX_PER_CHUNK,
    onProgress: (e) => line(`   块 ${e.index}/${e.count} · ${e.chars} 字符 · ${e.ok ? `得 ${e.got} 条` : `✗ ${e.error}`}`),
});
line('');
line(`起根：ok=${res.ok} · 种下 **${res.seeded ?? 0}** 条 · 用时 ${Math.round((Date.now() - t0) / 1000)}s${res.skipped ? `（跳过：${res.reason}）` : ''}`);
if (res.errors?.length) line(`错误：${res.errors.slice(0, 4).join(' | ')}`);
if (res.warnings?.length) line(`净化剔除 ${res.warnings.length} 条（前 4：${res.warnings.slice(0, 4).join(' | ')}）`);
if (res.skippedParties?.length) line(`当事人对不上被丢的名字（前 8）：${res.skippedParties.slice(0, 8).join('、')}`);
line('');
line('将落到账上的根：');
for (const id of res.ids || []) {
    const e = draft.events.find((x) => x.id === id);
    const people = (e.ripples || []).map((r) => draft.entities.find((x) => x.id === r)?.name || r);
    line(`   ${id} @${String(e.position || '未载').padEnd(12)} 人=[${people.join('、')}] 「${e.title}」`);
    line(`        书里原话：「${String(e.seedFrom?.quote).slice(0, 52)}」`);
}

// ---------- 写入（--install）----------
if (INSTALL && res.ok && res.seeded) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bak = `${WORLD_PATH}.bak-leg40-${stamp}`;
    copyFileSync(WORLD_PATH, bak);
    line('');
    line(`已备份：${bak}`);

    // 只改 world 那一格：把 header 里的 world 换成 draft 的**纯 JSON 形状**，其余键逐字节不变
    const headerLine = raw.slice(0, nl);
    const rest = raw.slice(nl);                       // 从换行开始（含后续所有行，逐字节保留）
    const newHeader = JSON.parse(headerLine);
    newHeader.chat_metadata.story_world_v2.world = draft;
    const newHeaderLine = JSON.stringify(newHeader);
    const out = newHeaderLine + rest;
    writeFileSync(WORLD_PATH, out, 'utf8');

    // ★写后逐项自证（三道，照 leg35 立的规矩）
    const after = readFileSync(WORLD_PATH, 'utf8');
    const aNl = after.indexOf('\n');
    const afterHeader = JSON.parse(after.slice(0, aNl));
    const w2 = afterHeader.chat_metadata.story_world_v2.world;
    const lineCount = (s) => s.split('\n').length;
    const proof = {
        行数不变: lineCount(out) === lineCount(raw) ? '✔' : `✘（${lineCount(raw)} → ${lineCount(out)}）`,
        其余行逐字节不变: after.slice(aNl) === rest ? '✔' : '✘',
        首行回读等于所写: after.slice(0, aNl) === newHeaderLine ? '✔' : '✘',
        事件数: `${(world.events || []).length} → ${(w2.events || []).length}（+${(w2.events || []).length - (world.events || []).length}）`,
        新根都在: (res.ids || []).every((id) => w2.events.some((e) => e.id === id)) ? '✔' : '✘',
        指纹已写: w2.meta?.seedRoots?.ids?.length ? `✔（${w2.meta.seedRoots.ids.length} 条）` : '✘',
        tick未动: w2.meta?.tick === world.meta?.tick ? '✔' : `✘（${world.meta?.tick} → ${w2.meta?.tick}）`,
        实体数未动: (w2.entities || []).length === (world.entities || []).length ? '✔' : '✘',
    };
    line('写后自证：');
    for (const [k, v] of Object.entries(proof)) line(`   ${k}：${v}`);
    const bad = Object.values(proof).some((v) => String(v).startsWith('✘'));
    line(bad ? '✘ 有自证项失败——请用备份回滚（备份路径见上）' : '✔ 全部自证通过');
} else if (!INSTALL) {
    line('');
    line('（干跑：什么都没写。要写入加 `--install`。）');
}
void buildSeedRootsPrompt; void SEED_ROOTS_MAX;

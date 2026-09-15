// story-world-v2/demo/measure-leg35-recall-live.js
// leg35 · 交接 §7 A 档实机闭环自验：**检索注入到底成没成**（V-1/V-2/V-3/V-5）。
//
// 为什么必须单开一个装置（而不是跑既有用例）：
//   leg34 的 41 条新用例**全部喂的是假检索器**（`recallWorldBook({store: 假})`）⇒ 它们只能证明
//   "接线是通的"，**证明不了生产上检索得到东西**。本装置走**真向量库 + 真 embedding**，
//   这就是交接 §5 那句"实机第一件要验的事"。
//
// ★★本装置的核心纪律：**照生产那条路逐字复刻**，不许自己发明一套更宽松的检索。
//   复刻对象（逐行读过的真源，不是猜的）：
//     · `yuzuki-Memory/config/vector-store.js:489-633` 的 `search(query, allowedBookIds)`
//     · `yuzuki-Memory/config/request-probe.js:219-280` 的 `getVectorInjectionText(body)`
//   生产口径（全部照抄，一个字不改）：
//     ① 开关：`plugin_settings.injectVectorMemory === true`（真值：true）
//     ② 书：`chatMetadata.yzm_memory_active_vector_books`（**不传 allowedBookIds** ⇒ 库里就是它）
//     ③ 维度：书的向量维度必须 == query 维度，不等 ⇒ **整本跳过**（vector-store.js:535）
//     ④ 空书：`getBookVectorDimension` 为 0 ⇒ **整本跳过**（未向量化的书根本进不了检索）
//     ⑤ 打分：`cosine(query, chunk) + searchEntityBoost(query, chunk)`（实体加权）
//     ⑥ 门槛：`settings.threshold`（真值 0.3）；条数 `settings.recallLimit`（真值 6）
//     ⑦ query 截断：`slice(-6000)`（**取尾部**，不是头部）
//
// 用法：
//   node demo/measure-leg35-recall-live.js                    # 只跑诊断（零模型成本，只花一次 embedding）
//   node demo/measure-leg35-recall-live.js --live --ticks 6   # 诊断 + 真模型跑 6 轮（看 entityUpdates/复活）
//   node demo/measure-leg35-recall-live.js --out F:/deepseek/tmp/leg35-x.json
//   可选：--world <聊天文件>
//
// ★真账**只读**：本装置只 `readFileSync` 聊天文件，从不写回；一切推进跑在 `structuredClone` 的副本上。
import { readFileSync, writeFileSync } from 'node:fs';
import { collectRecallQuery, recallWorldBook, recallTextOf, browserVectorStore } from '../src/recall.js';
import { runTick } from '../src/tick.js';
import { buildEvolutionPack } from '../src/pack.js';

// ---------------- 参数 ----------------
const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const DEFAULT_WORLD = `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`;
const WORLD_PATH = argVal('--world', DEFAULT_WORLD);
const SETTINGS_PATH = argVal('--settings', `${ST_DATA}/settings.json`);
const LIBRARY_PATH = argVal('--library', `${ST_DATA}/worlds/Yuzuki_Memory_Vector_Library.json`);
const TICKS = Math.max(1, parseInt(argVal('--ticks', '6'), 10) || 6);
const OUT_PATH = argVal('--out', '');
const LIVE = hasFlag('--live');
// ★★`--install`：**动数据**（把《大荒-姬元真》接进向量库 + 绑到本会话）。只在用户点头后跑；
//   动手前**两份文件各留一个备份**，且**书 id 与条目结构之外一个字节不加**。
const INSTALL = hasFlag('--install');
const WORLDBOOK_PATH = argVal('--worldbook', `${ST_DATA}/worlds/大荒-姬元真.json`);
const BACKUP_SUFFIX = `.bak-leg35-${new Date().toISOString().replace(/[:.]/g, '-')}`;

// ---------------- 读真账（与既有装置同一条约定：首行是热账） ----------------
function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    return { world: box.world, chatMeta: header?.chat_metadata || {} };
}

// ---------------- 真设置（照 embedding-client.js / vector-store.js 的取值路径） ----------------
function loadRealSettings() {
    const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const ym = s?.extension_settings?.yuzukiMemory || {};
    const embRaw = ym['yzm_memory_global_embedding_api_settings'] || {};
    const plugin = ym['yzm_memory_global_plugin_settings'] || {};
    const rerankRaw = ym['yzm_memory_global_rerank_api_settings'] || {};
    const PROVIDER_DEFAULT_URL = {
        siliconflow: 'https://api.siliconflow.cn/v1',
        openai: 'https://api.openai.com/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta',
        compatible: '',
    };
    const provider = embRaw.provider || 'siliconflow';
    const settings = {
        enabled: true,
        provider,
        baseUrl: String(embRaw.baseUrl || embRaw.apiUrl || PROVIDER_DEFAULT_URL[provider] || '').trim(),
        apiKey: String(embRaw.apiKey || '').trim(),
        model: String(embRaw.model || '').trim(),
        threshold: Number.isFinite(parseFloat(embRaw.threshold)) ? parseFloat(embRaw.threshold) : 0.3,
        recallLimit: Number.parseInt(embRaw.recallLimit, 10) || 6,
        contextDepth: Number.parseInt(embRaw.contextDepth, 10) || 0,
    };
    return { settings, plugin, rerank: { enabled: rerankRaw.enabled === true, model: rerankRaw.model || '' } };
}

// ---------------- 复刻 embedding-client.js 的 URL 解析 + embed() ----------------
function resolveEmbeddingUrl(settings) {
    let url = String(settings.baseUrl || '').trim().replace(/0\.0\.0\.0/g, '127.0.0.1').replace(/\/+$/, '');
    if (!url) throw new Error('embedding baseUrl 为空');
    if (url.endsWith('/embeddings')) return url;
    if (url.includes('googleapis.com') && url.includes('/openai')) return `${url}/embeddings`;
    if (!url.endsWith('/v1')) url += '/v1';
    return `${url}/embeddings`;
}

function parseVectorResponse(data, isBatch) {
    if (data?.data && Array.isArray(data.data)) {
        const vectors = data.data.map((item) => item?.embedding).filter(Array.isArray);
        if (vectors.length) return isBatch ? vectors : vectors[0];
    }
    const geminiVector = data?.embedding?.values || data?.embedding;
    if (Array.isArray(geminiVector)) return geminiVector;
    if (Array.isArray(data?.embeddings)) {
        const vectors = data.embeddings.map((item) => item?.values || item?.embedding || item).filter(Array.isArray);
        if (vectors.length) return isBatch ? vectors : vectors[0];
    }
    throw new Error('Embedding API 返回格式不正确');
}

async function embed(input, settings) {
    const items = Array.isArray(input) ? input.map((x) => String(x ?? '')).filter((x) => x.trim()) : [String(input ?? '')];
    const isBatch = Array.isArray(input);
    const url = resolveEmbeddingUrl(settings);
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: settings.model, input: isBatch ? items : items[0] }),
    });
    const text = await resp.text().catch(() => '');
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} ${String(text).slice(0, 200)}`.trim());
    return parseVectorResponse(JSON.parse(text), isBatch);
}

// ---------------- 复刻 vector-store.js 的取库与打分 ----------------
function loadLibrary() {
    const book = JSON.parse(readFileSync(LIBRARY_PATH, 'utf8'));
    const ent = book?.entries || {};
    const first = ent[Object.keys(ent)[0]] || ent[0];
    const content = first?.content || '';
    const parsed = content ? JSON.parse(content) : {};
    return parsed.library || parsed;
}

function bookDimension(book) {
    const v = (book?.vectors || []).find((x) => Array.isArray(x) && x.length);
    return v ? v.length : 0;
}

function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
    let dot = 0; let na = 0; let nb = 0;
    for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 逐字复刻 vector-store.js:471-487 的实体加权
const BOOST_PATTERN = /(?:姓名|名字|角色|Name|地点|位置|场景|Location|Place|物品|道具|装备|Item|Object|组织|势力|Organization|Group|设定|概念|Concept)[:：]\s*([^\s\n，,。.;；]+)/ig;
function searchEntityBoost(query, text) {
    const source = String(text || '');
    const re = new RegExp(BOOST_PATTERN.source, BOOST_PATTERN.flags);
    const found = [];
    let m;
    while ((m = re.exec(source))) {
        const entity = String(m[1] || '').trim();
        if (entity && String(query).includes(entity)) found.push(entity);
    }
    return found.length ? Math.min(0.2, found.length * 0.05) : 0;
}

/** 生产 faithful 检索：**完全照 vector-store.js:489-633**（rerank 关闭时那条分支）。 */
async function productionSearch({ query, library, activeBooks, settings, rerank, queryVector }) {
    const out = { skipped: null, queryDim: queryVector?.length || 0, matchedBooks: [], mismatched: [], empty: [], all: [], passed: [] };
    if (out.queryDim === 0) { out.skipped = '查询向量维度为空'; return out; }
    const ids = activeBooks;
    for (const id of ids) {
        const book = library[id];
        if (!book) continue;
        const dim = bookDimension(book);
        if (!dim) { out.empty.push(book.name || id); continue; }
        if (dim !== out.queryDim) { out.mismatched.push(`${book.name || id}: ${dim} != ${out.queryDim}`); continue; }
        out.matchedBooks.push(id);
    }
    if (!out.matchedBooks.length) { out.skipped = '绑定向量书维度均与当前 Embedding API 不匹配'; return out; }
    const targetCount = Math.max(1, settings.recallLimit || 6);
    const recallCount = rerank.enabled ? targetCount * 2 : targetCount;
    const initialThreshold = rerank.enabled ? 0.1 : settings.threshold;
    for (const id of out.matchedBooks) {
        const book = library[id];
        (book.chunks || []).forEach((chunk, i) => {
            const vec = book.vectors?.[i];
            if (!book.vectorized?.[i] || !Array.isArray(vec)) return;
            const cos = cosine(queryVector, vec);
            const boost = searchEntityBoost(query, chunk);
            const score = cos + boost;
            out.all.push({ book: book.name, idx: i + 1, text: chunk, cos, boost, score, pass: score >= initialThreshold });
        });
    }
    out.passed = out.all.filter((x) => x.pass).sort((a, b) => b.score - a.score).slice(0, recallCount).slice(0, targetCount);
    return out;
}

// ---------------- 内容面判据：命中的是不是"世界书正文" ----------------
// 机械可核，零判断：把账上真有的字拿去命中的片段里数。数不出来就是数不出来。
function contentProbe(world, text) {
    const entities = (world.entities || []).filter((e) => e.name && e.name.length >= 2);
    const hitEntities = [...new Set(entities.map((e) => e.name).filter((n) => text.includes(n)))];
    const openEvents = (world.events || []).filter((e) => !e.closed);
    const evTitles = openEvents.map((e) => String(e.title || '')).filter((t) => t.length >= 5);
    const hitTitles = evTitles.filter((t) => text.includes(t.slice(0, 6)));
    // 世界书正文的机械特征：《大荒-姬元真.json》里出现的地名/设定词（账上 context.positions 是真实地名表）
    const positions = (world.context?.positions || []).map((p) => String(p).replace(/（推）$/, '').trim()).filter((p) => p.length >= 2);
    const hitPositions = [...new Set(positions.filter((p) => text.includes(p)))];
    return {
        entityNamesInChunk: hitEntities,
        entityNameCount: hitEntities.length,
        eventTitleHeadsInChunk: hitTitles.length,
        bookPlaceNamesInChunk: hitPositions,
        bookPlaceNameCount: hitPositions.length,
    };
}

// ---------------- V-4 判据：模型有没有把"检索回来的旧事"当成"新发生的事" ----------------
// ★为什么必须有这条尺子：`recallTextOf` 注入的原文**自带日期**（如 `19021年05月05日`）而账上
//   **一点时间信息都没有**（`meta` 只有 tick）⇒ 模型没有任何机械手段知道那是 59 轮前的事。
//   判据＝新生事件标题与召回原文的**汉字极大公共子串**长度 ≥ 阈值 ⇒ 判"把书里/总结里的旧事当新事写"。
//   （与 leg32/leg33 那条"内容面判据"不同：这条**不拿背景词充数**——只比事件标题，且要求连续长片段。）
function hanOnly(s) { return String(s || '').replace(/[^\u4e00-\u9fff]/g, ''); }

function longestCommonSubstring(a, b) {
    const s1 = hanOnly(a); const s2 = hanOnly(b);
    if (!s1 || !s2) return 0;
    let best = 0;
    let prev = new Array(s2.length + 1).fill(0);
    for (let i = 1; i <= s1.length; i += 1) {
        const cur = new Array(s2.length + 1).fill(0);
        for (let j = 1; j <= s2.length; j += 1) {
            if (s1[i - 1] === s2[j - 1]) {
                cur[j] = prev[j - 1] + 1;
                if (cur[j] > best) best = cur[j];
            }
        }
        prev = cur;
    }
    return best;
}

function v4Overlap(newTexts, recalledTexts, minLen = 6) {
    const rows = [];
    for (const t of newTexts) {
        let top = 0; let src = '';
        for (const r of recalledTexts) {
            const L = longestCommonSubstring(t, r);
            if (L > top) { top = L; src = String(r).slice(0, 40).replace(/\n/g, ' '); }
        }
        rows.push({ text: String(t), lcs: top, over: top >= minLen, from: top >= minLen ? src : '' });
    }
    return { minLen, rows, overCount: rows.filter((r) => r.over).length };
}

// ---------------- ★V-2 的真正修复：把《大荒-姬元真》接进检索（分块 → 向量化 → 绑会话） ----------------
//   为什么要分块：库里那本「大荒」是**把库自己的导出 JSON 当成一本书导进去的**（2 段，第 2 段 301,908 字符
//   开头就是 `{ "version": 1, "exportedAt": …`）⇒ 就算向量化也是一个 30 万字符的巨块、不可检索。
//   正确切法：**按世界书的条目切**（235 条，每条天然是一个语义单元），并给每块加一行**出处抬头**
//   （`[世界书·<comment>]`，comment 为空时退回 `key`）——这样模型看到命中片段时知道自己读的是书里哪一节。
//   ★只保留正文非空的条目；每块上限 `MAX_CHUNK_CHARS`，超长按换行/句读再切（不硬切汉字串）。
const MAX_CHUNK_CHARS = 1200;

// ★不进检索的东西（干跑时量出来的真问题，不是猜的）：
//   ① 插件自己的分块分隔符 `===`：`setBookChunks()` 会按它*再切一次* ⇒ 留在块里等于埋一个将来会炸的雷
//      （6 条条目含它，都在 EJS 脚本里）
//   ② **模板工程条目**（`<%_ … %>` / `getvar(` / `<status_current_variables>` 这类）——那是 EJS/MVU 的
//      **代码**，不是世界设定。把它们向量化只会往检索里灌代码噪声（`[ejs]小宅仙`、`[mvu_update]变量更新规则` 等）
const SCRIPT_MARKERS = ['<%', '%>', 'getvar(', 'setvar(', 'status_current_variables', 'variables.', '<%-', 'mvu_'];
function looksLikeTemplate(text) {
    const s = String(text || '');
    let hits = 0;
    for (const m of SCRIPT_MARKERS) { const i = s.indexOf(m); if (i >= 0) hits += 1; }
    return hits >= 3;                                  // 三个以上标记 ⇒ 判为模板代码（世界设定里不会这么密）
}
function sanitizeChunk(text) {
    return String(text || '').replace(/={3,}/g, '──');   // 别让插件按 === 二次切块
}

function splitLong(text, max = MAX_CHUNK_CHARS) {
    const src = String(text || '').trim();
    if (src.length <= max) return [src];
    const out = [];
    let buf = '';
    const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
    for (const piece of src.split(/(?<=[。！？；\n])/)) {
        if ((buf + piece).length > max && buf) flush();
        if (piece.length > max) {                       // 单句超长：按硬长度兜底切（不产生空块）
            for (let i = 0; i < piece.length; i += max) { const seg = piece.slice(i, i + max); if (seg.trim()) out.push(seg.trim()); }
            continue;
        }
        buf += piece;
    }
    flush();
    return out.length ? out : [src.slice(0, max)];
}

export function worldBookChunks(worldbookPath) {
    const wb = JSON.parse(readFileSync(worldbookPath, 'utf8').trim());
    const ks = Object.keys(wb.entries || {});
    const chunks = [];
    const skipped = [];
    const templates = [];
    for (const k of ks) {
        const e = wb.entries[k] || {};
        const body = String(e.content || '').trim();
        if (!body) { skipped.push(String(e.comment || k)); continue; }      // 空条目：不产生空块
        if (looksLikeTemplate(body)) { templates.push(String(e.comment || k)); continue; }   // 模板代码：不进检索
        const title = String(e.comment || '').trim() || String(e.key || '').trim() || `条目 ${k}`;
        const keys = String(e.key || '').trim();
        const head = `[世界书·${title}]${keys && keys !== title ? `（检索词：${keys.slice(0, 80)}）` : ''}`;
        for (const part of splitLong(body)) chunks.push(sanitizeChunk(`${head}\n${part}`));
    }
    return { chunks, entryCount: ks.length, skipped, templates };
}

/** 批量 embedding（按 API 批量上限切；失败了**整批不留半截**）。 */
async function embedAll(texts, settings, batchSize = 10) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const vs = await embed(batch, settings);       // embed([...]) 走 isBatch 分支
        const list = Array.isArray(vs[0]) ? vs : [vs];
        if (list.length !== batch.length) throw new Error(`批量返回条数不符：${list.length} != ${batch.length}`);
        vectors.push(...list);
        if ((i / batchSize) % 5 === 0) line(`   已向量化 ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
    }
    return vectors;
}

// ---------------- 主流程 ----------------
const line = (s) => console.log(s);
const { world: realWorld, chatMeta } = loadRealWorld(WORLD_PATH);
const { settings: embSettings, plugin, rerank } = loadRealSettings();
const library = loadLibrary();
const activeBooks = Array.isArray(chatMeta.yzm_memory_active_vector_books) ? chatMeta.yzm_memory_active_vector_books : [];

// ── ★V-2 的真正修复：接世界书进检索（`--install`；动数据，动手前先备份） ──
if (INSTALL) {
    line('═══ 接入世界书到检索（--install）═══');
    const wb = worldBookChunks(WORLDBOOK_PATH);
    line(`世界书：${WORLDBOOK_PATH}`);
    line(`  条目 ${wb.entryCount} 条 ⇒ 正文非空、切成 **${wb.chunks.length}** 块（空条目跳过 ${wb.skipped.length} 条：${JSON.stringify(wb.skipped.slice(0, 5))}；★**模板工程条目剔除 ${wb.templates.length} 条**：${JSON.stringify(wb.templates.slice(0, 6))}）`);
    const lens = wb.chunks.map((c) => c.length);
    line(`  块长：min ${Math.min(...lens)} · 中位 ${lens.slice().sort((a, b) => a - b)[Math.floor(lens.length / 2)]} · max ${Math.max(...lens)} · 总 ${lens.reduce((a, b) => a + b, 0)} 字符`);
    line(`  样例块头两行：\n    ${wb.chunks[0].split('\n').slice(0, 2).join('\n    ')}`);

    // 形状自检（写之前先机械核一遍，别把坏数据写进你的库）
    const libRootProbe = JSON.parse(readFileSync(LIBRARY_PATH, 'utf8').trim());
    const entKeyProbe = Object.keys(libRootProbe.entries)[0];
    const innerProbe = JSON.parse(libRootProbe.entries[entKeyProbe].content);
    const LProbe = innerProbe.library || innerProbe;
    line(`  写前自检：库根 ${Object.keys(innerProbe).join(',')} · 现有书 ${Object.keys(LProbe).length} 本 · 目标槽存在=${'yzm_book_1788626883319_mysq9xk' in LProbe}`);
    line(`  写前自检：块内不含分隔符 ===（会被插件二次切块）= ${wb.chunks.some((c) => c.includes('==='))} · 空块 ${wb.chunks.filter((c) => !c.trim()).length} 个`);

    if (hasFlag('--dry-run')) { line('  （--dry-run：只自检，不备份、不调 API、不写盘）'); process.exit(0); }

    // 备份（两份都备；文件名带时间戳，绝不覆盖）
    const libBak = LIBRARY_PATH + BACKUP_SUFFIX;
    const chatBak = WORLD_PATH + BACKUP_SUFFIX;
    writeFileSync(libBak, readFileSync(LIBRARY_PATH));
    writeFileSync(chatBak, readFileSync(WORLD_PATH));
    line(`  备份：\n    ${libBak}\n    ${chatBak}`);

    line('  开始向量化（真 embedding，批量 10）…');
    const started = Date.now();
    const vectors = await embedAll(wb.chunks, embSettings, 10);
    line(`  ✔ 向量化完成：${vectors.length} 条 · 维度 ${vectors[0]?.length} · 耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

    // ★只动这一个书对象与条目结构，别处一个字节不加（库里那本「大荒」本来就是给这本书留的槽）
    const libRoot = JSON.parse(readFileSync(LIBRARY_PATH, 'utf8').trim());
    const entKey = Object.keys(libRoot.entries)[0];
    const inner = JSON.parse(libRoot.entries[entKey].content);
    const L = inner.library || inner;
    const libId = 'yzm_book_1788626883319_mysq9xk';       // 已存在的「大荒」槽
    const prev = L[libId] || {};
    L[libId] = {
        ...prev,
        name: '大荒-姬元真',
        chunks: wb.chunks,
        vectors,
        vectorized: wb.chunks.map(() => true),
        updateTime: Date.now(),
    };
    libRoot.entries[entKey].content = JSON.stringify(inner.library ? inner : { library: L });
    writeFileSync(LIBRARY_PATH, JSON.stringify(libRoot), 'utf8');
    line(`  ✔ 向量库已写入（书 id ${libId} · name 大荒-姬元真）`);

    // 绑到本会话（追加，不去重别的书）
    // ★★真账是**用户的聊天记录**，写坏不可逆 ⇒ 写完必须逐项自证：行数不变、其余行逐字节不变、首行 JSON 回读等于所写
    const rawBefore = readFileSync(WORLD_PATH, 'utf8').split('\n');
    const lines = rawBefore.slice();
    const header = JSON.parse(lines[0]);
    header.chat_metadata = header.chat_metadata || {};
    const cur = Array.isArray(header.chat_metadata.yzm_memory_active_vector_books) ? header.chat_metadata.yzm_memory_active_vector_books : [];
    header.chat_metadata.yzm_memory_active_vector_books = cur.includes(libId) ? cur : [...cur, libId];
    lines[0] = JSON.stringify(header);
    writeFileSync(WORLD_PATH, lines.join('\n'), 'utf8');
    const after = readFileSync(WORLD_PATH, 'utf8').split('\n');
    const tailSame = after.length === rawBefore.length && after.slice(1).every((l, i) => l === rawBefore[i + 1]);
    const headOk = JSON.stringify(JSON.parse(after[0])) === JSON.stringify(header);
    line(`  ✔ 会话绑定已更新：${JSON.stringify(header.chat_metadata.yzm_memory_active_vector_books)}`);
    line(`  ★写后自证：行数 ${rawBefore.length} → ${after.length} ${after.length === rawBefore.length ? '✔' : '✗'} · 其余行逐字节未变 ${tailSame ? '✔' : '✗'} · 首行回读等于所写 ${headOk ? '✔' : '✗'}`);
    if (!tailSame || !headOk) { line('  ✗✗ 自证没过 —— 立刻用备份还原，别继续。'); process.exit(2); }
    line('  现在重跑诊断（不带 --install）看命中是不是变成了世界书正文。');
    process.exit(0);
}

line('═══ leg35 · 检索注入实机闭环自验 ═══');
line(`真账（只读）：${WORLD_PATH}`);
line(`起点：tick ${realWorld.meta?.tick ?? 0} · 实体 ${(realWorld.entities || []).length} · 在飞盘算 ${(realWorld.agendas || []).filter((a) => !a.closed).length} · 未决事件 ${(realWorld.events || []).filter((e) => !e.closed).length}`);
line('');
line('── 环境（生产真值） ──');
line(`injectVectorMemory = ${JSON.stringify(plugin.injectVectorMemory)}  ${plugin.injectVectorMemory === true ? '✔ 开' : '✗ 关（检索必然返空）'}`);
line(`embedding：provider=${embSettings.provider} · model=${embSettings.model} · 维度见下 · apiKey=${embSettings.apiKey ? '在' : '缺'}`);
line(`检索门槛 threshold=${embSettings.threshold} · 条数 recallLimit=${embSettings.recallLimit} · rerank=${rerank.enabled}`);
line(`本会话绑定的向量书（yzm_memory_active_vector_books）：${JSON.stringify(activeBooks)}`);
line('库里的书：');
for (const [id, b] of Object.entries(library)) {
    const dim = bookDimension(b);
    const vecd = (b.vectorized || []).filter(Boolean).length;
    line(`   ${b.name || id} ｜ chunks ${(b.chunks || []).length} · 已向量化 ${vecd} · 维度 ${dim || '（无向量）'} ${activeBooks.includes(id) ? '★本会话绑定' : '（未绑定）'}`);
}
line('');

// ── V-1/V-2：真 query（`collectRecallQuery`，与生产同一个函数）→ 真 embedding → 生产 faithful 检索 ──
const query = collectRecallQuery(realWorld, { picks: null });
line('── V-1/V-2：真查一次 ──');
line(`collectRecallQuery 出的 query：${query.length} 字符（生产会 slice(-6000)）`);
line(`  原文前 300 字：${query.slice(0, 300)}`);
line('');

let diag = { query, queryChars: query.length, env: { activeBooks, plugin, embedModel: embSettings.model, threshold: embSettings.threshold, recallLimit: embSettings.recallLimit, rerank } };
try {
    const qv = await embed(query.slice(-6000), embSettings);
    line(`✔ embedding 调用成功：query 维度 = ${qv.length}`);
    diag.queryDim = qv.length;
    const s = await productionSearch({ query, library, activeBooks, settings: embSettings, rerank, queryVector: qv });
    diag.search = { matchedBooks: s.matchedBooks, mismatched: s.mismatched, empty: s.empty, skipped: s.skipped };
    line(`书的准入判定：命中维度 ${s.matchedBooks.length} 本 · 维度不符 ${JSON.stringify(s.mismatched)} · 无向量 ${JSON.stringify(s.empty)}`);
    if (s.skipped) line(`★检索整条被跳过：${s.skipped}`);
    line(`候选 ${s.all.length} 段 · 过门槛（≥${embSettings.threshold}）${s.passed.length} 段`);
    line('');
    line('逐段读数（cos / 实体加权 / 总分 / 过没过门槛）：');
    for (const x of s.all) line(`   ${x.book} #${x.idx}  cos=${x.cos.toFixed(4)} boost=${x.boost.toFixed(2)} 总=${x.score.toFixed(4)} ${x.pass ? '✔过' : '✗未过'}`);
    line('');
    const chunks = s.passed.map((x) => ({ text: String(x.text), source: `${x.book} #${x.idx}`, score: x.score }));
    diag.hits = chunks.map((c) => ({ source: c.source, score: Number(c.score.toFixed(4)), chars: c.text.length, probe: contentProbe(realWorld, c.text), head: c.text.slice(0, 400) }));
    if (!chunks.length) {
        line('★★结论 V-1/V-2：**检索真跑了，但一段都没过门槛 ⇒ 注入面是空的。**');
        const best = [...s.all].sort((a, b) => b.score - a.score)[0];
        if (best) line(`   最高分的一段是 ${best.book} #${best.idx}（${best.score.toFixed(4)}）——离门槛 ${embSettings.threshold} 差 ${(embSettings.threshold - best.score).toFixed(4)}`);
    } else {
        line(`★结论 V-1：检索**真跑了**，过门槛 ${chunks.length} 段。`);
        const merged = chunks.map((c) => c.text).join('\n');
        const cp = contentProbe(realWorld, merged);
        diag.mergedProbe = cp;
        line(`★结论 V-2：命中的是不是世界书正文？——账上 ${(realWorld.entities || []).length} 个实体名里，命中片段里出现了 ${cp.entityNameCount} 个：${JSON.stringify(cp.entityNamesInChunk.slice(0, 20))}`);
        line(`   账上地名表里出现在片段里的：${cp.bookPlaceNameCount} 个 ${JSON.stringify(cp.bookPlaceNamesInChunk.slice(0, 20))}`);
        line(`   逐段来源：${JSON.stringify(chunks.map((c) => c.source))}`);
        line('');
        line('命中片段原文（逐字，前 500 字）：');
        for (const c of chunks) { line(`   〔${c.source}〕score=${c.score.toFixed(4)}`); line(`   ${String(c.text).slice(0, 500).replace(/\n/g, ' ⏎ ')}`); line(''); }
    }
} catch (err) {
    line(`✗ embedding 调用失败：${err?.message || err}`);
    diag.embedError = String(err?.message || err);
}

// ── 自证面：Node 侧 `browserVectorStore()` 必然是 null（说明生产注入点只在浏览器） ──
line('── 接线自证 ──');
line(`Node 侧 browserVectorStore() = ${JSON.stringify(browserVectorStore())} ⇒ 生产注入点只在浏览器（Node 里必须靠 recallStore 注入，这正是 runTick 留那个参数的理由）`);
line('');

// ── V-3/V-5：真模型多轮（entityUpdates 会不会被用 / 复活走不走得通） ──
if (LIVE) {
    const { resolveWorldTransport } = await import('../src/st-preset.js');
    const resolved = resolveWorldTransport();
    if (!resolved) { console.error('✗ 未找到模型配置（env 未设、酒馆预设也没读到）'); process.exit(1); }
    line(`── V-3/V-5：真模型 ${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · 模型 ${resolved.model} · ${TICKS} 轮 ──`);

    // ★真检索器接到 `runTick` 的 `recallStore` 注入点上——**这才是生产那条路**（不伪造）。
    const apiKey = embSettings.apiKey;
    const realStore = {
        async search(q, allowed = null) {
            const qv2 = await embed(String(q || '').slice(-6000), embSettings);
            const s2 = await productionSearch({
                query: String(q || ''), library,
                activeBooks: Array.isArray(allowed) && allowed.length ? allowed : activeBooks,
                settings: embSettings, rerank, queryVector: qv2,
            });
            return s2.passed.map((x) => ({ text: String(x.text), score: x.score, source: `${x.book} #${x.idx}` }));
        },
    };
    // ★把每一轮真检索回来的原文留档（V-4 的对照池 + "这一轮注入面到底给了模型什么"的原始证据）
    const realStoreLog = [];
    const rawSearch = realStore.search.bind(realStore);
    realStore.search = async (q, allowed) => { const hits = await rawSearch(q, allowed); realStoreLog.push({ q: String(q || '').slice(0, 200), hits }); return hits; };
    void apiKey;

    // ★原始输出留档：`runMainCall` 只回 `{ok,step,errors}`，被拒的步**拿不到原文**
    //   ⇒ 包一层 transport 记原始 JSON（这是判"模型提没提 entityUpdates"的唯一诚实来源）
    const rawLog = [];
    const wrapped = async (prompt) => {
        const promptText = typeof prompt === 'string' ? prompt : (prompt?.text || JSON.stringify(prompt || ''));
        const r = await resolved.transport(prompt);
        const text = typeof r === 'string' ? r : r?.text;
        rawLog.push({
            promptChars: promptText.length,
            prompt,
            // ★机械自证：注入的那一段原文到底有没有进**提示词**（这是"当轮可见"唯一的硬证据）
            recallTextInPrompt: /【世界书·按本回合上下文检索到的原文片段】/.test(promptText),
            raw: String(text || ''),
        });
        return r;
    };

    let world = structuredClone(realWorld);
    const ticks = [];
    // ★召回原文留档（每轮的）：V-4 要拿新生标题跟它比；同时留"当年那批旧事"的标题池
    const recalledPool = [];
    for (let t = 1; t <= TICKS; t += 1) {
        const before = world;
        const beforeIds = { ev: new Set((before.events || []).map((x) => x.id)), ag: new Set((before.agendas || []).map((x) => x.id)) };
        const beforeTick = before.meta?.tick ?? 0;
        const recalledTextBefore = before.meta?.recalledText;
        const r = await runTick({ transport: wrapped, ssot: world, dialogue: '', extractCtx: {}, calls: 1, recallStore: realStore });
        const raw = rawLog[rawLog.length - 1];
        let step = null;
        try { step = JSON.parse(raw.raw.trim()); } catch { /* 非法 JSON：如实记 */ }
        const rec = world.meta?.recalled;
        const row = {
            t, ok: r.ok,
            tickBefore: beforeTick,
            error: r.ok ? null : String(r.error).slice(0, 300),
            recalled: rec ? { ok: rec.ok, chunks: rec.chunks, sources: rec.sources, queryChars: rec.queryChars, reason: rec.reason } : null,
            promptChars: raw.promptChars,
            // ★注入面真的进提示词了吗（机械可核：提示词里有没有那段标记）
            recallTextInPrompt: raw.recallTextInPrompt,
            recalledTextHead: (String(raw.prompt || '').match(/【世界书·按本回合上下文检索到的原文片段】[\s\S]{0,200}/) || [''])[0].replace(/\n/g, ' ⏎ '),
            proposed: step ? {
                actions: (step.actions || []).length,
                newEvents: (step.newEvents || []).length,
                newAgendas: (step.newAgendas || []).length,
                newEntities: (step.newEntities || []).length,
                entityUpdates: (step.entityUpdates || []).length,
                entityFates: (step.entityFates || []).length,
                raw: JSON.stringify(step.entityUpdates || null),
            } : null,
            warnings: r.ok ? (r.stage?.warnings || []).slice(0, 5) : null,
        };
        if (r.ok) {
            world = r.ssot;
            row.tickAfter = world.meta?.tick ?? 0;
            row.bornEvents = (world.events || []).filter((e) => !beforeIds.ev.has(e.id)).map((e) => e.title);
            row.bornAgendas = (world.agendas || []).filter((a) => !beforeIds.ag.has(a.id)).map((a) => a.goal);
            row.fieldsTouched = world.meta?.entityFields
                ? Object.entries(world.meta.entityFields).filter(([, v]) => (v?.fields && Object.values(v.fields).some((f) => f?.source === '变更'))).map(([k]) => k)
                : [];
            row.recalledTextInPack = !!world.meta?.recalledText;
        }
        ticks.push(row);
        line(`第 ${t} 轮：${r.ok ? '✔' : '✗'} recalled=${JSON.stringify(row.recalled)} 提议(entityUpdates=${row.proposed?.entityUpdates ?? '-'} events=${row.proposed?.newEvents ?? '-'} agendas=${row.proposed?.newAgendas ?? '-'}) ${r.ok ? '' : `错误 ${row.error}`}`);
        if (row.proposed && row.proposed.entityUpdates) line(`   ★entityUpdates 原样：${row.proposed.raw.slice(0, 400)}`);
        if (row.fieldsTouched?.length) line(`   ★账上被改过的实体：${JSON.stringify(row.fieldsTouched)}`);
        const lastSearch = realStoreLog[realStoreLog.length - 1];
        if (lastSearch) {
            row.recallHits = lastSearch.hits.map((h) => ({ source: h.source, score: Number(Number(h.score).toFixed(4)), chars: h.text.length, head: h.text.slice(0, 120) }));
            row.recallHitTexts = lastSearch.hits.map((h) => h.text);
            recalledPool.push(...lastSearch.hits.map((h) => h.text));
            line(`   注入面：${lastSearch.hits.length} 段 · ${JSON.stringify(row.recallHits.map((h) => `${h.source}(score ${h.score})`))}`);
        }
    }
    line('');
    // ★V-4：把**本轮新生的事件标题与盘算目标**拿去跟"召回回来的那批旧事"比
    const bornTexts = ticks.flatMap((x) => [...(x.bornEvents || []), ...(x.bornAgendas || [])]);
    const v4 = v4Overlap(bornTexts, recalledPool, 6);
    line('── V-4：模型有没有把召回回来的旧事当成新发生的事 ──');
    line(`判据：新生标题/目标 与 召回原文 的**汉字极大公共子串** ≥ 6 字 ⇒ 判「旧事当新事写」`);
    line(`新生文本 ${v4.rows.length} 条 · 判为"照搬旧事"的 **${v4.overCount}** 条`);
    for (const r of v4.rows) line(`   ${r.over ? '★' : '·'} LCS=${r.lcs} 「${r.text}」${r.over ? ` ← 与召回片段重合：${r.from}…` : ''}`);
    diag.v4 = v4;
    const usedU = ticks.filter((x) => (x.proposed?.entityUpdates || 0) > 0).length;
    const recalledTicks = ticks.filter((x) => x.recalled?.chunks > 0).length;
    line('── 收口读数 ──');
    line(`V-1 检索真跑了：${ticks.length} 轮里 meta.recalled 有读数 ${ticks.filter((x) => x.recalled).length} 轮 · 命中 ≥1 段 ${recalledTicks} 轮 · ${JSON.stringify(ticks.map((x) => x.recalled?.reason || `命中${x.recalled?.chunks}`))}`);
    line(`V-3 模型会不会用 entityUpdates：提出 ${usedU}/${ticks.length} 轮`);
    line(`V-5 带因复活：${ticks.some((x) => /status/.test(x.proposed?.raw || '')) ? '★有轮次提到 status（看上面原样）' : '本轮全程没提 status（没机会，不是被拒）'}`);
    diag.live = { model: resolved.model, source: resolved.source, ticks };
}

// ---------------- 出数留档（写到仓库外，别当仓库文件） ----------------
if (OUT_PATH) { writeFileSync(OUT_PATH, JSON.stringify(diag, null, 2)); line(`\n出数已留档：${OUT_PATH}（★仓库外，不属于仓库）`); }

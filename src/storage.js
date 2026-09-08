// story-world-v2/src/storage.js
// K35 存储层（编排层）：热账（chat metadata）+ 冷档轮转（IndexedDB 卷）+ 导出/导入（SHA-256 验签）。
// 验收 A-9：编年超阈值 → 前置段离热账入卷（store 注入面，浏览器=IndexedDB 适配，测试=内存 mock）；
//   里程碑与因果指针留在热态（红线 2：割断的是账本里的冗余，不是链条）；
//   阅卷加载还原；导出/导入往返一致。
// 纪律：本模块为纯函数 + 存储接口契约（零 DOM、零 indexedDB 直接依赖、零 Node 内建——browser-compat 扫描面）；
//   crypto 走双端全局 webcrypto（globalThis.crypto.subtle），惰性调用 + 守卫；
//   冷档阈值数字为提案态（PROPOSED_LIMITS，铁律 2：报批前不视为定案，调用方显式传参覆盖）。

// ---------- 提案数字（铁律 2：提案态，标注待报批；细案 §3.6/§6） ----------
export const PROPOSED_LIMITS = Object.freeze({
    ticks: 500,   // 编年热卷 tick 跨度阈值（提案）
    bytes: 5 * 1024 * 1024, // 编年热卷字节阈值（提案）
});

// ---------- 热账：chat metadata 形状（每聊天一份） ----------
export const HOT_FORMAT = 'story-world-v2-hot';
export const HOT_VERSION = 1;

export function hotAccountShape(ssot) {
    return {
        format: HOT_FORMAT,
        version: HOT_VERSION,
        savedAt: new Date().toISOString(),
        world: ssot,
    };
}

export function loadHotAccount(meta) {
    if (!meta || typeof meta !== 'object') return null;
    if (meta.format !== HOT_FORMAT || meta.version !== HOT_VERSION) return null;
    if (!meta.world || typeof meta.world !== 'object') return null;
    return meta.world;
}

// ---------- 冷档轮转（纯函数；store = {list, put, get} 注入面） ----------

function chronTick(c) { return Number.isFinite(c?.tick) ? c.tick : 0; }
function chronBytes(rows) { return JSON.stringify(rows).length; }

function splitOffOldest(rows, { ticks, bytes }) {
    // 从最旧（tick 小）一侧剥离入卷：卷 = rows[0..k)，热账 = rows[k..)。
    // 剥离条件：热账 tick 跨度 ≤ ticks 且字节 ≤ bytes；保底热账至少留一行。
    let k = 0;
    for (; k < rows.length - 1; k += 1) {
        const rest = rows.slice(k);
        const span = chronTick(rest[rest.length - 1]) - chronTick(rest[0]);
        if (span <= ticks && chronBytes(rest) <= bytes) break;
    }
    return k;
}

/**
 * rotateChronicle(world, { limits, store, volumeSeq, volumeCount, now })
 * → { hot, volume|null }：
 *   hot      = 剥离前置段后的新世界（milestones/events 原引用不动=断链防线）
 *   volume   = 入卷段 {id, info, rows}（rows 与热账完全无共享）
 * 不改写入参 world（纯函数）；limits 缺省提案值（待报批）。
 */
export function rotateChronicle(world, { limits = PROPOSED_LIMITS, volumeSeq = 1, now = new Date().toISOString().slice(0, 10) } = {}) {
    const rows = Array.isArray(world.chronicle) ? world.chronicle : [];
    if (rows.length === 0) return { hot: world, volume: null };
    const sorted = [...rows].sort((a, b) => chronTick(a) - chronTick(b));
    const span = chronTick(sorted[sorted.length - 1]) - chronTick(sorted[0]);
    const bytes = chronBytes(sorted);
    if (span <= limits.ticks && bytes <= limits.bytes) return { hot: world, volume: null };

    const volLen = splitOffOldest(sorted, limits);
    const volRows = sorted.slice(0, volLen); // 卷行 = 最旧的前置段（tick 小的一侧）
    if (volRows.length === 0) return { hot: world, volume: null };

    const volSet = new Set(volRows);
    const hotRows = rows.filter((r) => !volSet.has(r)); // 保持原数组顺序，零扰动可见面
    const hot = { ...world, chronicle: hotRows };
    const volRowsCopy = volRows.map((r) => ({ ...r }));
    const fromTick = chronTick(volRowsCopy[0]);
    const toTick = chronTick(volRowsCopy[volRowsCopy.length - 1]);
    const volume = {
        id: `卷${volumeSeq}`,
        info: `第 ${fromTick}–${toTick} 轮 · ${(chronBytes(volRowsCopy) / 1024).toFixed(1)}KB · 收在插件本地 · ${now} 入卷`,
        rows: volRowsCopy,
        fromTick,
        toTick,
        bytes: chronBytes(volRowsCopy),
        archivedAt: now,
    };
    return { hot, volume };
}

// ---------- 阅卷还原：卷段 → 编年渲染行（复用 render 的编年行形状） ----------
export function volumeToChronicleRows(volume) {
    if (!volume || !Array.isArray(volume.rows)) return [];
    return volume.rows.map((r) => ({ tick: chronTick(r), text: r.text ?? '', eventRef: r.eventRef ?? '' }));
}

// ---------- 导出/导入（整聊天，SHA-256 验签） ----------
export const EXPORT_FORMAT = 'story-world-v2-export';
export const EXPORT_VERSION = 1;

async function sha256hex(text) {
    if (typeof globalThis?.crypto?.subtle === 'undefined') {
        throw new Error('环境不支持 webcrypto（SHA-256 不可用）');
    }
    const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * buildExportBundle(world, volumes, { chatId, exportedAt } = {})
 * → { json, digest }：json = 完整导出（含 world + volumes + 摘要）；
 *   digest = SHA-256(json 去除 digest 字段后的正文)。
 */
export async function buildExportBundle(world, volumes = [], { chatId = '', exportedAt = new Date().toISOString() } = {}) {
    const body = {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt,
        chatId,
        world,
        volumes,
    };
    const payload = JSON.stringify(body);
    const digest = await sha256hex(payload);
    return { json: JSON.stringify({ ...body, digest }), digest };
}

/**
 * verifyImportBundle(json) → {ok, world, volumes, error?}：
 * 形状校验（format/version/world/volumes）+ SHA-256 摘要比对，往返一致才算过。
 */
export async function verifyImportBundle(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, world: null, volumes: [], error: '不是合法 JSON' };
    }
    if (!parsed || parsed.format !== EXPORT_FORMAT || parsed.version !== EXPORT_VERSION) {
        return { ok: false, world: null, volumes: [], error: '导出格式不识别' };
    }
    if (!parsed.world || typeof parsed.world !== 'object') {
        return { ok: false, world: null, volumes: [], error: '缺少世界数据' };
    }
    if (!Array.isArray(parsed.volumes)) {
        return { ok: false, world: null, volumes: [], error: '卷数据形状不符' };
    }
    const { digest, ...body } = parsed;
    if (typeof digest !== 'string' || digest.length !== 64) {
        return { ok: false, world: null, volumes: [], error: '缺少验签摘要' };
    }
    const re = await sha256hex(JSON.stringify(body));
    if (re !== digest) {
        return { ok: false, world: null, volumes: [], error: '摘要不符：文件被改动或损坏' };
    }
    return { ok: true, world: parsed.world, volumes: parsed.volumes, error: null };
}
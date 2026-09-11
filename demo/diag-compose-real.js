// story-world-v2/demo/diag-compose-real.js
// 只读：用**真 autoComposeSource + 真 collectWorldInfoEntries** 复现"499526 字符 / 424 条"，
//   并打印合订源由哪些条目组成（按来源分账）——不猜，让真函数自己说。
import { readFileSync } from 'node:fs';
import { characterBookEntries } from '../web/index.js';

function cardFromPng(file) {
    const buf = readFileSync(file);
    let off = 8, card = null;
    while (off + 12 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'tEXt') { const z = data.indexOf(0); if (data.toString('latin1', 0, z) === 'chara') card = JSON.parse(Buffer.from(data.subarray(z + 1).toString('latin1'), 'base64').toString('utf8')); }
        off += 12 + len; if (type === 'IEND') break;
    }
    return card;
}
const card = cardFromPng(process.argv[2]);
const worldJson = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const worldEntries = Array.isArray(worldJson.entries) ? worldJson.entries : Object.values(worldJson.entries || {});

// 复刻 ST 侧形状：loadWorldInfo 返回 { entries: {...} }（对象而非数组），卡挂 data.extensions.world
const ctx = {
    characterId: 0,
    characters: [{ ...card, data: { ...(card.data || {}), extensions: { world: '大荒-姬元真' } } }],
    extensionSettings: { world_info: { globalSelect: [] } },
    chatMetadata: {},
    loadWorldInfo: async (name) => (name === '大荒-姬元真' ? { entries: worldEntries } : null),
    renderExtensionTemplateAsync: async () => '',
    eventSource: { on() {}, off() {} }, eventTypes: {},
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, SillyTavern: { getContext: () => ctx } };
globalThis.document = { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };

const mod = await import(`../web/index.js?diagcompose${Date.now()}`);
const src = await mod.autoComposeSource();
console.log('=== 真 autoComposeSource 结果 ===');
console.log(`ok=${src.ok} usedChars=${src.usedChars} entryCount=${src.entryCount} pieceCount=${src.pieceCount} truncated=${src.truncated}`);
console.log(`worldSources（逐本挂载世界）= ${JSON.stringify(src.sourceDiag?.worldSources)}`);
console.log(`charBook 条目数 = ${(card.character_book?.entries || card.data?.character_book?.entries || []).length}`);
console.log(`worldInfoEntries（collectWorldInfoEntries 收上来的）= ${src.worldInfoEntries?.length}`);

// 分账：这些条目分别来自"世界信息文件"还是"卡内置书"
const fromWorld = new Set(worldEntries.map((e) => String(e.content ?? '').trim()).filter(Boolean));
const fromCard = new Set(characterBookEntries(card).map((e) => String(e.content ?? '').trim()).filter(Boolean));
let both = 0, onlyWorld = 0, onlyCard = 0, neither = 0;
for (const e of src.worldInfoEntries || []) {
    const c = String(e?.content ?? '').trim();
    const inW = fromWorld.has(c), inC = fromCard.has(c);
    if (inW && inC) both += 1; else if (inW) onlyWorld += 1; else if (inC) onlyCard += 1; else neither += 1;
}
console.log(`\n=== 条目来源分账（共 ${src.worldInfoEntries?.length}）===`);
console.log(`  两本书都有（重复）= ${both}｜只世界信息文件 = ${onlyWorld}｜只卡内置 = ${onlyCard}｜都不匹配 = ${neither}`);
console.log(`  世界信息文件条目 = ${fromWorld.size}｜卡内置条目 = ${fromCard.size}`);

// ⑦ composeInitSource 内部到底看到多少条（两路各多少、去重掉多少）
const { composeInitSource } = await import('../src/init-source.js');
const cardRaw = card?.character_book?.entries || card?.data?.character_book?.entries || [];
console.log(`\n=== composeInitSource 内部 ===`);
console.log(`  传入 worldInfoEntries = ${src.worldInfoEntries?.length} 条`);
console.log(`  卡内置 character_book.entries = ${cardRaw.length} 条`);
const r2 = composeInitSource({ character: card, worldInfoEntries: src.worldInfoEntries });
console.log(`  → entryCount=${r2.entryCount} usedChars=${r2.usedChars} truncated=${r2.truncated}`);
// 逐行核对：两路内容集合的交集/差集（按 normalizeEntry 的 line 形态）
const lineOf = (e) => {
    const key = String(e?.key ?? (Array.isArray(e?.keys) ? e.keys[0] : undefined) ?? e?.uid ?? e?.name ?? e?.comment ?? '');
    const content = String(e?.content ?? '').trim();
    return content ? `【${key}】${content}` : null;
};
const A = new Set((src.worldInfoEntries || []).map(lineOf).filter(Boolean));
const B = new Set(cardRaw.map((e) => lineOf({ key: undefined, keys: e.keys, uid: e.id, comment: e.comment, content: e.content })).filter(Boolean));
console.log(`  ① 世界书侧唯一行 = ${A.size}｜② 卡内置侧唯一行 = ${B.size}｜交集 = ${[...A].filter((l) => B.has(l)).length}`);
console.log(`  ① 样例：${[...A].slice(0, 2).map((l) => l.slice(0, 40)).join(' | ')}`);
console.log(`  ② 样例：${[...B].slice(0, 2).map((l) => l.slice(0, 40)).join(' | ')}`);

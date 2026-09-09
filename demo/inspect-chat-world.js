// story-world-v2/demo/inspect-chat-world.js
// 第十九棒：实机热账检视——读 ST 聊天 jsonl 首行（元数据头）里的 story_world_v2 热账，
// 打印取数实证摘要（指纹/五件套尺寸/张力原文/实体清单），用于「实机跑出什么世界」的磁盘侧核验。
// 纯只读（readFileSync），不写聊天文件。
// 用法：
//   node demo/inspect-chat-world.js <聊天文件路径>   # 检视单聊天
//   node demo/inspect-chat-world.js --scan           # 扫描默认 chats 目录，列出所有非空热账摘要
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CHATS = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/chats';
const DEFAULT_GROUP_CHATS = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/group-chats';

function parseHeaderLine(line) {
    try {
        return JSON.parse(line);
    } catch (e) {
        return null;
    }
}

function summarize(w, file) {
    const s = w.context?.setting;
    const c = s?.frozen?.canon;
    const t = s?.dynamic?.tension;
    return {
        file,
        tick: w.meta?.tick,
        world: w.context?.world,
        fingerprint: s?.frozen?.fingerprint,
        polarity: t?.polarity,
        direction: t?.direction,
        canon: c ? { powerScale: c.powerScale?.length, rules: c.rules?.length, historyNotes: c.historyNotes?.length, bookEntities: c.bookEntities?.length, society: String(c.society ?? '').slice(0, 30) } : null,
        entities: w.entities?.length,
        names: (w.entities || []).slice(0, 12).map((e) => `${e.name}[${e.kind}]`).join(', '),
        simLog: w.meta?.simLog?.length,
    };
}

function inspectFile(file, verbose) {
    let header;
    try {
        const raw = readFileSync(file, 'utf8');
        const nl = raw.indexOf('\n');
        const firstLine = nl < 0 ? raw : raw.slice(0, nl);
        header = parseHeaderLine(firstLine);
        if (verbose) console.log(`[${file}] header len=${firstLine.length}`);
    } catch (e) {
        if (verbose) console.log(`[${file}] READ FAIL: ${e.message}`);
        return null;
    }
    const w = header?.chat_metadata?.story_world_v2;
    if (!w || typeof w !== 'object') return null;
    if (w.meta === undefined && w.entities === undefined && w.context === undefined) return null; // 空残留 {}（K35 时代旧账）
    return summarize(w, file);
}

if (process.argv[2] === '--scan') {
    for (const [label, dir] of [['chats', DEFAULT_CHATS], ['group-chats', DEFAULT_GROUP_CHATS]]) {
        if (!existsSync(dir)) { console.log(`[${label}] dir missing:`, dir); continue; }
        for (const charDir of readdirSync(dir)) {
            const d = join(dir, charDir);
            let files = [];
            try { files = readdirSync(d).filter((f) => f.endsWith('.jsonl')); } catch (_) { continue; }
            for (const f of files) {
                const sum = inspectFile(join(d, f), false);
                if (sum) console.log(JSON.stringify(sum, null, 1));
            }
        }
    }
    console.log('--scan done');
    process.exit(0);
}

if (process.argv[2] === '--export') {
    const f = process.argv[3];
    let obj;
    try { obj = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.log('EXPORT READ/PARSE FAIL:', e.message); process.exit(0); }
    const w = obj?.world ?? obj; // K35 导出包 {world, volumes, sha256} 或裸 SSOT
    const sum = summarize(w, f);
    console.log(JSON.stringify(sum, null, 1));
    process.exit(0);
}

const file = process.argv[2] || join(DEFAULT_CHATS, '大荒z', '大荒z - 2026-09-01@00h37m41s559ms.jsonl');
const sum = inspectFile(file, true);
if (!sum) { console.log('NO non-empty hot world in:', file); process.exit(0); }
console.log(JSON.stringify(sum, null, 1));
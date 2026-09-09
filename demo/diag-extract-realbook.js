// story-world-v2/demo/diag-extract-realbook.js · 第十八棒诊断
// 用卡上挂的真世界书（大荒-姬元真.json）前 150 条跑抽取，展示"真书产出的抽象"。
// 密钥仅本机读取不打印；调用走酒馆预设 + 抽取预算 16384。
import { readFileSync } from 'node:fs';
import { loadStPresetConfig } from '../src/st-preset.js';
import { createHttpTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-http.js';
import { extractWorldSetting } from '../src/abstract.js';

const cfg = loadStPresetConfig();
if (!cfg) { console.log('❌ 预设读取失败'); process.exit(1); }

const wb = JSON.parse(readFileSync('F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/worlds/大荒-姬元真.json', 'utf8'));
const entries = Object.values(wb.entries || {});
console.log(`世界书条目总数：${entries.length}`);
const lines = [];
for (const e of entries) {
    if (e?.disable === true || e?.enabled === false) continue;
    const key = String(e.comment || (Array.isArray(e.key) ? e.key[0] : e.key || '') || e.uid || '');
    const content = String(e.content || '').trim();
    if (!content) continue;
    const line = `【${key}】${content}`;
    if (lines.join('\n').length + line.length > 60000) break;
    lines.push(line);
}
const src = lines.join('\n');
console.log(`抽取源：前 ${lines.length} 条 / ${Array.from(src).length} 字符\n`);

const transport = createHttpTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, maxTokens: EXTRACTION_MAX_TOKENS });
const r = await extractWorldSetting({ sourceText: src, extract: async (p) => (await transport(p)), cache: null, extractedAt: '2026-09-09T00:00:00.000Z' });
if (!r.ok) { console.log('❌ 抽取失败：', r.errors); process.exit(1); }
const c = r.setting.frozen.canon;
console.log(`五件套：标尺 ${c.powerScale.length} 档 · 法则 ${c.rules.length} 条 · 历史 ${c.historyNotes.length} 条 · 书名录 ${c.bookEntities.length} 个`);
console.log('标尺样本：', c.powerScale.slice(0, 5).map((x) => `${x.level}（${x.note.slice(0, 24)}）`).join(' / '));
console.log('法则样本：', c.rules.slice(0, 3).join(' ｜ '));
console.log('社会格局：', c.society.slice(0, 120));
console.log('力量体系：', c.techOrMagic.slice(0, 120));
console.log('书名录前 15：', c.bookEntities.slice(0, 15).map((b) => b.name).join('、'));
console.log('张力：', JSON.stringify(r.setting.dynamic.tension));
console.log('警告：', r.errors.length ? r.errors.slice(0, 3) : '无');
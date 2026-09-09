// story-world-v2/demo/diag-init-extract.js（第二轮：max_tokens / 大输入假设验证）
// 结论暂记：通道通、思考型模型（reasoning_content 在）、抽取统一 max_tokens=4096——怀疑
// 思考+输出共享预算，大书抽取时内容被吃空/截断。本轮分别试 大输入 × max_tokens 两档，
// 并打印 finish_reason（length=截断实锤）。
import { loadStPresetConfig } from '../src/st-preset.js';
import { buildAbstractPrompt } from '../src/abstract.js';

const cfg = loadStPresetConfig();
if (!cfg) { console.log('❌ 预设读取失败'); process.exit(1); }
const base = cfg.baseUrl.replace(/\/+$/, '');
const endpoint = `${/\/v1$/.test(base) ? base : `${base}/v1`}/chat/completions`;
console.log(`预设：${cfg.presetName} | model：${cfg.model} | endpoint：${endpoint}\n`);

const makeBook = (n, lineLen) => Array.from({ length: n }, (_, i) => `【k${i}】名号${i}${'字'.repeat(lineLen)}`).join('\n');
const cases = [
    { label: 'big-63k @4096', text: makeBook(300, 200), maxTokens: 4096 },
    { label: 'big-63k @16384', text: makeBook(300, 200), maxTokens: 16384 },
    { label: 'huge-105k @16384', text: makeBook(500, 200), maxTokens: 16384 },
    { label: 'rosterBig-1530条 @4096', text: makeBook(1530, 10), maxTokens: 4096 },
    { label: 'rosterBig-1530条 @16384', text: makeBook(1530, 10), maxTokens: 16384 },
];

for (const { label, text, maxTokens } of cases) {
    const prompt = buildAbstractPrompt(text);
    const t0 = Date.now();
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, response_format: { type: 'json_object' }, max_tokens: maxTokens }),
            signal: AbortSignal.timeout(180000),
        });
        const ms = Date.now() - t0;
        const body = await res.text();
        let data = null;
        try { data = JSON.parse(body); } catch { /* ignore */ }
        const ch = data?.choices?.[0];
        const content = ch?.message?.content;
        const reasoning = ch?.message?.reasoning_content;
        const contentLen = typeof content === 'string' ? content.length : (Array.isArray(content) ? `array[${content.length}]` : String(content));
        console.log(`[${label}] 输入 ${Array.from(text).length} 字符 | HTTP ${res.status} | ${ms}ms | finish=${ch?.finish_reason ?? '?'} | reasoning=${typeof reasoning === 'string' ? reasoning.length : '?'} | content=${contentLen}`);
        if (typeof content === 'string' && content.trim()) console.log('  content 前 120：', content.trim().replace(/\s+/g, ' ').slice(0, 120));
        if ((typeof content === 'string' && !content.trim()) || content === null) console.log('  ⚠ content 为空——实锤（reasoning 吃预算 / 截断）');
    } catch (err) {
        console.log(`[${label}] 抛错：${err?.name || ''} ${err?.message || err}`);
    }
}
console.log('\n验证完毕');
// story-world-v2/src/worldstep.js
// 主调用管线（S4）：组装 prompt → transport（注入式，真实 HTTP 接线留 S6/ST 环境）→ JSON 解析
// → 真 schema + 语义校验。产出 {ok, step, errors}。
import { assembleMainPrompt } from './prompts.js';
import { checkWorldStep } from './check-step.js';

export async function runMainCall({ transport, ssot, pack }) {
    const prompt = assembleMainPrompt(pack);
    let raw;
    try {
        const resp = await transport(prompt);
        raw = typeof resp === 'string' ? resp : resp?.text;
    } catch (err) {
        return { ok: false, step: null, errors: [`传输失败: ${err?.message || err}`] };
    }
    if (typeof raw !== 'string' || !raw.trim()) {
        return { ok: false, step: null, errors: ['主调用返回空'] };
    }
    let step;
    try {
        step = JSON.parse(raw.trim());
    } catch {
        return { ok: false, step: null, errors: ['主调用返回非法 JSON（真 schema 强制：形状不可靠即拒绝）'] };
    }
    const checked = checkWorldStep(step, ssot);
    return { ok: checked.ok, step: checked.ok ? step : null, errors: checked.errors };
}
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
        // 第十三棒·真模型冒烟补诊断：预览前 120 字带回现场（肉眼定位围栏/截断/前后缀；铁律 8 数据说话）
        const trimmed = raw.trim();
        const preview = trimmed.slice(0, 120).replace(/\s+/g, ' ');
        console.warn('[story-world-v2] 主调用非法 JSON，原始输出：', trimmed);
        return {
            ok: false, step: null,
            errors: [`主调用返回非法 JSON（真 schema 强制：形状不可靠即拒绝）· 原始输出预览：${preview}${trimmed.length > 120 ? '…' : ''}`],
        };
    }
    const checked = checkWorldStep(step, ssot);
    // ★★★本次修（真模型 60 轮长跑实跑抓出来的病）：**校验被拒的那一步也要带出去**。
    //   病：校验不过 ⇒ `step: null` ⇒ 上层 `runTick` 只能**整轮放弃**（调用白花、tick 不推进、还没有自愈）。
    //     而下游 `settleWithHealing` 那条自愈**本来就能治这种步**（② 丢掉写歪的那几条 → 重校验 → 结算；
    //     leg187 实在不行则失败、不推进）——它够不着，只因为**这扇门把步扔了**。
    //   ⇒ 多带一格 `rawStep`（**原样、未净化、未采纳**），让上层拿得着它去自愈。
    //   ★纪律：`step` 这一格**语义一字不改**（不过校验就还是 null）——免得有人误当"它已经合法了"；
    //     谁要用 `rawStep`，谁就得自己对它负责（本仓只有 `runTick` 那条自愈路用它）。
    return { ok: checked.ok, step: checked.ok ? step : null, rawStep: step, errors: checked.errors };
}

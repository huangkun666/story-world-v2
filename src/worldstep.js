// story-world-v2/src/worldstep.js
// 主调用管线（S4）：组装 prompt → transport（注入式，真实 HTTP 接线留 S6/ST 环境）→ JSON 解析
// → 真 schema + 语义校验。产出 {ok, step, errors}。
import { assembleMainPrompt } from './prompts.js';
import { checkWorldStep } from './check-step.js';
// ★★★2026-10-09：瞬时错判据**全仓只有一份**（`abstract.js` 的 `isTransientCallError`，抽取侧重试用它）
//   ——主调用这条重试路**直接复用它**，不新立第二套口径（本仓最贵的病是"同一件事两处口径"）。
import { isTransientCallError } from './abstract.js';

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★★2026-10-09（用户实机报障 · 手机上一局里连续两轮报废）：**主调用这条路径没有"再问一次"**。
//
// 现场（用户导出的调试报告）：一个 tick 三次调用——前两次小的（683 / 1281 字符）都 `stop` 成功，
//   第三次主调用（21.5k 字符）拿到 **HTTP 200 + `finish_reason: "error"` + usage 全 0**
//   ⇒ 这里判空 ⇒「主调用返回空」⇒ **整轮报废、tick 不推进**，状态条那句
//   「（世界原样未动，可重试）」把重试这件事**推给玩家手动点**。
//   ★同一个 tick 的前后两次调用都好好的、上一次主调用还成功过 ⇒ 这是**一次性的上游失败**，
//     原样再问一次大概率就过了 —— 而**抽取侧早就有这条**（`abstract.js` 的"空/失败自动重试一次"，
//     第十八棒立、leg27 把超时从里面摘出去）。主调用一直没有 ⇒ 两条路的处置不一致。
//
// 口径（与抽取侧同一条，不新立第二套）：
//   · **空回复**（一个字都没生成）⇒ 原样再问一次；
//   · **上游报错**（`sw2CallFailure.type === 'provider'`，见 `transport-http.js` 的 200 分支）⇒ 同样再问一次；
//   · **超时 / 截断 / 用户取消 / 配置错（401·403·404·429）** ⇒ **一次都不重试**（止损：重试只是把同一个
//     失败重演一遍——leg27/leg61 为此白烧过 62 分钟/块与 2.5 小时，那两条注释还在 `transport-http.js` 里）；
//   · **内容坏（非法 JSON）** ⇒ 不归这条管（它是模型写出来的东西，处置在结算那条自愈路上，见 `tick.js`）；
//   · **只重试一次**，不循环（钱与挂钟时间都是玩家的）。`attempts` 如实带出去，供记账用。
/** 一次尝试的结果：`{text}` 或 `{failure, retryable}`（retryable = 值不值得原样再问一次）。 */
async function attemptMainCall(transport, prompt) {
    try {
        const resp = await transport(prompt);
        const raw = typeof resp === 'string' ? resp : resp?.text;
        if (typeof raw !== 'string' || !raw.trim()) return { failure: '主调用返回空', retryable: true };
        return { text: raw };
    } catch (err) {
        const provider = err?.sw2CallFailure?.type === 'provider';
        return {
            // 上游报错那句已经是人话（含服务端原话），不再套"传输失败"——**说清是哪一步不对**是本仓 A-3 的措辞纪律
            failure: provider ? String(err?.message || err) : `传输失败: ${err?.message || err}`,
            retryable: provider || isTransientCallError(err),
        };
    }
}

export async function runMainCall({ transport, ssot, pack, retryOnce = true }) {
    const prompt = assembleMainPrompt(pack);
    let outcome = await attemptMainCall(transport, prompt);
    let attempts = 1;
    if (outcome.failure && retryOnce && outcome.retryable) {
        attempts = 2;
        outcome = await attemptMainCall(transport, prompt);
    }
    if (outcome.failure) return { ok: false, step: null, errors: [outcome.failure], attempts };
    const raw = outcome.text;
    let step;
    try {
        step = JSON.parse(raw.trim());
    } catch {
        // 第十三棒·真模型冒烟补诊断：预览前 120 字带回现场（肉眼定位围栏/截断/前后缀；铁律 8 数据说话）
        const trimmed = raw.trim();
        const preview = trimmed.slice(0, 120).replace(/\s+/g, ' ');
        console.warn('[story-world-v2] 主调用非法 JSON，原始输出：', trimmed);
        return {
            ok: false, step: null, attempts,
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
    return { ok: checked.ok, step: checked.ok ? step : null, rawStep: step, errors: checked.errors, attempts };
}

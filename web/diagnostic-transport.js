// story-world-v2/web/diagnostic-transport.js
import { diagnostics } from '../src/diagnostics.js';
let details = () => false;
export function setDiagnosticDetails(fn) { details = typeof fn === 'function' ? fn : () => false; }
/** 当前是否允许带明细（`debugDetails`）。抽依据记录用它决定带不带原话。 */
export function diagnosticDetails() { return details() === true; }
export function diagExtract(resolved) {
    return async prompt => {
        const start = Date.now(), inputChars = String(prompt || '').length;
        try {
            const res = await resolved.transport(prompt);
            const text = typeof res === 'string' ? res : typeof res?.text === 'string' ? res.text : '';
            diagnostics.record('模型', text.trim() ? 'info' : 'warn', text.trim() ? '调用完成' : '空响应', {
                model: resolved.model, ms: Date.now() - start, inputChars, outputChars: text.length,
                ...(details() ? { prompt, response: text } : {}),
            });
            return text;
        } catch (err) { diagnostics.record('模型', 'error', String(err.message || err), { model: resolved.model, ms: Date.now() - start, inputChars }); throw err; }
    };
}
/** HTTP 成功不等于演算成功：校验/结算拒因与部分降级也进入插件调试台。 */
export function diagTickOutcome(result, previousTick) {
    if (result?.pack?.inputStats) {
        diagnostics.record('世界输入', 'info', '本轮世界输入组成', {
            tick: result.ssot?.meta?.tick ?? previousTick,
            ...result.pack.inputStats,
        });
    }
    if (!result || (result.ok && !result.healed?.used)) return;
    diagnostics.record('演算', result.ok ? 'warn' : 'error',
        result.ok ? '部分提议未落账，合法提议已结算' : '演算失败，轮数未推进', {
            tick: result.ok ? result.ssot?.meta?.tick : previousTick,
            error: result.error,
            dropped: result.healed?.dropped || [],
            errors: result.healed?.errors || [],
            warnings: result.stage?.warnings || [],
        });
}
/** 放在逐条依据之后，避免几百条属性警告把全局设定结果挤出调试台。 */
export function diagSettingOutcome(result) {
    if (!result) return;
    const report = result.settingReport;
    let message = '设定抽取完成';
    if (!result.ok) message = report?.returned?.total > 0 ? '设定抽取失败：返回的设定未能落账' : '设定抽取失败';
    else if (report?.empty) message = report.cached ? '缓存中没有全局设定' : '未抽到全局设定：模型未返回设定项';
    else if (report?.cached) message = '设定从缓存载入';
    else if (report?.reasons?.length) message = '设定已抽取，部分设定未通过核验';
    diagnostics.record('设定抽取', !result.ok ? 'error' : report?.empty || report?.reasons?.length ? 'warn' : 'info', message, {
        ...report,
        ...(!result.ok ? { errors: (result.errors || []).slice(-6) } : {}),
    });
}
/**
 * ★★★Task 3：**抽取依据**记录的唯一接收入口（`extractWorldSetting({ onEvidence })` 接到这里）。
 *
 * 口径（Codex 决议，与既有调试面同一条纪律）：
 *   · 走**既有** `diagnostics.record`（环形 200 条 + 递归脱敏 + 截断），模块名 `抽取依据`；
 *   · **计数/来源编号/原因恒记**（查账时"哪条被拒、为什么"永远查得到）；
 *   · **原话只在 `debugDetails` 为真时带**——与 `diagExtract` 的 `prompt/response` 同一道门，
 *     不给世界账/快照/关系边加任何常驻出处章。
 */
export function diagEvidence(rec) {
    if (!rec || typeof rec !== 'object') return;
    const withQuote = details();
    // ★★★leg197：`unverified`（给了出处、对不上，★**照收**）与 `drop`（非出处原因的丢弃）都记 `warn`——
    //   它们是维护者该看见的两类事；`keep`/`pending` 记 `info`。
    const level = (rec.action === 'drop' || rec.action === 'unverified') ? 'warn' : 'info';
    diagnostics.record('抽取依据', level, String(rec.why || rec.action || '记录'), {
        class: rec.class, subject: rec.subject, action: rec.action, ref: rec.ref,
        ...(withQuote ? { quote: rec.quote } : {}),
    });
}

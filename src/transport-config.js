// story-world-v2/src/transport-config.js
// 传输配置解析（K30，编排层·浏览器适配套）：设置对象 → 传输配置。
// 链：settings（extension_settings，浏览器侧持有）→ null（面板报"未配置"）。
// Node 侧链（env → 酒馆预设）保持 st-preset.resolveWorldTransport 不变——两链互不干扰。
// 密钥纪律：settings 为运行时读取（用户本机输入），不落日志、不打印、不进代码。
import { createHttpTransport, EXTRACTION_MAX_TOKENS, EXTRACTION_TIMEOUT_MS } from './transport-http.js';

// 第十八棒：抽取预算透传（init-world/force-abstract 用 EXTRACTION_MAX_TOKENS）。
// 审计修复 E3：主调用缺省同步改为 16384（同模型同通道同一份 finish=length 实证）——
//   本行注释旧口径「主调用保持 4096」已随修复作废。
// ★leg62：抽取侧独立抬到 **32,768**（主调用仍 16384）——"两侧同值"的前提（输出量同量级）
//   被设定面的概念表打破；依据与实测见 `transport-http.js` 的 EXTRACTION_MAX_TOKENS 注释。
export { EXTRACTION_MAX_TOKENS };

// leg27：`extraction` 选项 = 抽取侧专用档（独立超时，不再蹭主调用的 120 s）。
//   用法：`resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true })`
//   为什么必须显式给（而不是自动判断）：同一份 settings 也用于主调用（演算），超时口径不同 ⇒
//   由**调用点**声明意图，不在配置解析里猜（免得把主调用也悄悄改成 5 分钟）。
export function resolveBrowserTransport(settings, { maxTokens, extraction = false } = {}) {
    const s = settings || {};
    if (!s.baseUrl || !s.apiKey || !s.model) return null;
    return {
        transport: createHttpTransport({
            baseUrl: s.baseUrl,
            apiKey: s.apiKey,
            model: s.model,
            ...(maxTokens ? { maxTokens } : {}),
            ...(extraction ? { timeoutMs: EXTRACTION_TIMEOUT_MS } : {}),
            ...(s.fetchImpl ? { fetchImpl: s.fetchImpl } : {}), // 测试注入通道
        }),
        source: 'settings',
        baseUrl: s.baseUrl,
        model: s.model,
    };
}
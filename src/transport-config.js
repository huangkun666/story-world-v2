// story-world-v2/src/transport-config.js
// 传输配置解析（K30，编排层·浏览器适配套）：设置对象 → 传输配置。
// 链：settings（extension_settings，浏览器侧持有）→ null（面板报"未配置"）。
// Node 侧链（env → 酒馆预设）保持 st-preset.resolveWorldTransport 不变——两链互不干扰。
// 密钥纪律：settings 为运行时读取（用户本机输入），不落日志、不打印、不进代码。
import { createHttpTransport, EXTRACTION_MAX_TOKENS, PROPOSED_CALL_LIMITS } from './transport-http.js';

// 第十八棒：抽取预算透传（init-world/force-abstract 用 16384）。
// 审计修复 E3：主调用缺省同步改为 16384（同模型同通道同一份 finish=length 实证）——
//   两侧不再分档；本行注释旧口径「主调用保持 4096」已随修复作废。
export { EXTRACTION_MAX_TOKENS };

export function resolveBrowserTransport(settings, { maxTokens } = {}) {
    const s = settings || {};
    if (!s.baseUrl || !s.apiKey || !s.model) return null;
    return {
        transport: createHttpTransport({
            baseUrl: s.baseUrl,
            apiKey: s.apiKey,
            model: s.model,
            ...(maxTokens ? { maxTokens } : {}),
            ...(s.fetchImpl ? { fetchImpl: s.fetchImpl } : {}), // 测试注入通道
        }),
        source: 'settings',
        baseUrl: s.baseUrl,
        model: s.model,
    };
}
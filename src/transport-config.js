// story-world-v2/src/transport-config.js
// 传输配置解析（K30，编排层·浏览器适配套）：设置对象 → 传输配置。
// 链：settings（extension_settings，浏览器侧持有）→ null（面板报"未配置"）。
// Node 侧链（env → 酒馆预设）保持 st-preset.resolveWorldTransport 不变——两链互不干扰。
// 密钥纪律：settings 为运行时读取（用户本机输入），不落日志、不打印、不进代码。
import { createHttpTransport } from './transport-http.js';

export function resolveBrowserTransport(settings) {
    const s = settings || {};
    if (!s.baseUrl || !s.apiKey || !s.model) return null;
    return {
        transport: createHttpTransport({
            baseUrl: s.baseUrl,
            apiKey: s.apiKey,
            model: s.model,
            ...(s.fetchImpl ? { fetchImpl: s.fetchImpl } : {}), // 测试注入通道
        }),
        source: 'settings',
        baseUrl: s.baseUrl,
        model: s.model,
    };
}
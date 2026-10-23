import {buildPresetRequest} from './prompt-presets.js';
// story-world-v2/src/transport-config.js
// 传输配置解析（K30，编排层·浏览器适配套）：设置对象 → 传输配置。
// 链：settings（extension_settings，浏览器侧持有）→ null（面板报"未配置"）。
// Node 侧链（env → 酒馆预设）保持 st-preset.resolveWorldTransport 不变——两链互不干扰。
// 密钥纪律：settings 为运行时读取（用户本机输入），不落日志、不打印、不进代码。
import { createHttpTransport, EXTRACTION_MAX_TOKENS, EXTRACTION_TIMEOUT_MS } from './transport-http.js';
import { createHostRelayTransport } from './host-relay.js';
import { createProtocolTransport, PROTOCOLS } from './protocol-sdk.js';

// ＝＝＝ 2026-10-16（用户令「把api协议的活做了，要解决opencode go连接不了的问题」）＝＝＝
// 这一段新增三样设置，**缺省时既有行为逐字不变**（没填过 = 对话补全 + 直连，与从前一模一样）：
//   · `protocol`         'chat'（缺省）| 'anthropic' | 'responses'
//   · `extraHeaders`     用户自己填的请求头（每行一条「名称: 值」，如 `x-opencode-session`）
//   · `relayThroughHost` 真 ⇒ 请求经**宿主（酒馆）后端**发出，绕开浏览器跨域（见 host-relay.js 的实测依据）
/** 协议名归一：只认这三种；别的（含空、含大小写混杂）一律回缺省 `chat`——**不猜**。 */
export function normalizeProtocol(raw) {
    const v = String(raw ?? '').trim().toLowerCase();
    return PROTOCOLS.includes(v) ? v : 'chat';
}

/**
 * 解析「自定义请求头」那一格（每行一条「名称: 值」；`#` 开头的行当注释）。
 * ★校验两条，缺一不可：① 名称必须是合法 HTTP 头名（token 字符）；
 *   ② 值里不许有 CR/LF（否则就是**头注入**：用户填的一行能变出第二个头）。
 * ★非法行**整行丢掉**并把原文交给调用方（面板如实报"这几行没受理"），不猜、不静默改写。
 * @returns {{headers: Array<[string,string]>, rejected: string[]}}
 */
export function parseExtraHeaders(text) {
    const headers = [], rejected = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const raw = line.trim();
        if (!raw || raw.startsWith('#')) continue;
        const at = raw.indexOf(':');
        if (at <= 0) { rejected.push(raw); continue; }
        const name = raw.slice(0, at).trim();
        const value = raw.slice(at + 1).trim();
        if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(name) || /[\r\n]/.test(value)) { rejected.push(raw); continue; }
        headers.push([name, value]);
    }
    return { headers, rejected };
}

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
// ★★★leg87（用户令「改也改不了是死的不会根据模型变化」）：新增 **`limits`** 形参——主调用的
//   `timeoutMs`/`maxTokens` 从此**由调用点从设置现取**（`web/index.js` 的 `advanceTick`）。
//   ★它**绝不覆盖抽取档**（`extraction: true` 那条路的超时/输出上限是 leg62 实测定的：
//     超时 300 s、输出 32768 —— 见 `transport-http.js` 的 leg62 注释），两条路各自独立。
//   ★缺省仍是"不传"⇒ `createHttpTransport` 用 `PROPOSED_CALL_LIMITS`（**未填时行为逐字节不变**）。
export function resolveBrowserTransport(settings, { maxTokens, extraction = false, limits = null, extractionLimits = null, responseFormat = null, reasoningEffort = null, stream = null, presetPurpose = null, getPresetSettings = null } = {}) {
    const s = settings || {};
    if (!s.baseUrl || !s.apiKey || !s.model) return null;
    const withPreset = transport => presetPurpose === null ? transport : async(prompt,options={}) => {
        const prepared=buildPresetRequest(getPresetSettings?getPresetSettings():s,presetPurpose,prompt);
        return transport(prompt,{...options,...(prepared.messages===undefined?{}:{messages:prepared.messages})});
    };
    const lim = limits && typeof limits === 'object' ? limits : {};
    // 优先级：抽取档（extraction）> 显式 `limits`（主调用现读）> 传输层出厂缺省。
    const maxTokensFinal = extraction ? (extractionLimits?.maxTokens ?? maxTokens ?? EXTRACTION_MAX_TOKENS) : (lim.maxTokens ?? maxTokens);
    const timeoutMsFinal = extraction ? (extractionLimits?.timeoutMs ?? EXTRACTION_TIMEOUT_MS) : lim.timeoutMs;
    // ＝＝＝ 2026-10-16 新增那三样（缺省时下面三个分支的结果与从前**逐字相同**）＝＝＝
    const protocol = normalizeProtocol(s.protocol);
    const relay = s.relayThroughHost === true || s.relayThroughHost === '1' || s.relayThroughHost === 'true';
    const parsed = parseExtraHeaders(s.extraHeaders);
    const shared = {
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model,
        headers: parsed.headers,
        temperature: 0.7,
        extraction,
        ...(maxTokensFinal ? { maxTokens: maxTokensFinal } : {}),
        ...(timeoutMsFinal ? { timeoutMs: timeoutMsFinal } : {}),
        ...(typeof stream === 'boolean' ? { stream } : {}),
    };
    // ① 经宿主转发（浏览器跨域被挡的网关走这条）：宿主那条通道按 `/chat/completions` 拼地址 ⇒ **只支持对话补全**。
    if (relay) {
        return {
            transport: withPreset(createHostRelayTransport({ ...shared, ...(responseFormat ? {responseFormat} : {}), retryCsrf: s.creationStrictDispatch !== true, ...(s.fetchImpl ? { send: s.fetchImpl } : {}) })),
            source: 'settings', baseUrl: s.baseUrl, model: s.model, protocol: 'chat', relay: true,
            ...(protocol === 'chat' ? {} : { notice: '宿主转发只走对话补全，接口类型已按对话补全处理' }),
        };
    }
    // ② 对话补全之外的两种形状（走随包开源多协议层；浏览器跨域允许的网关）。
    if (protocol !== 'chat') {
        return {
            transport: withPreset(createProtocolTransport({ ...shared, protocol, ...(s.fetchImpl ? { fetchImpl: s.fetchImpl } : {}) })),
            source: 'settings', baseUrl: s.baseUrl, model: s.model, protocol, relay: false,
        };
    }
    // ③ 对话补全 + 直连 = **既有那条路，一个字不改**。
    return {
        transport: withPreset(createHttpTransport({
            headers: parsed.headers,
            baseUrl: s.baseUrl,
            apiKey: s.apiKey,
            model: s.model,
            ...(reasoningEffort?{reasoningEffort}:{}),
            ...(typeof stream==='boolean'?{stream}:{}),
            extraction, // Diagnostic guidance follows the call context; request and budgets are unchanged.
            ...(responseFormat ? { responseFormat } : {}), // Source extraction only; default request stays json_object.
            ...(maxTokensFinal ? { maxTokens: maxTokensFinal } : {}),
            ...(timeoutMsFinal ? { timeoutMs: timeoutMsFinal } : {}),
            ...(s.fetchImpl ? { fetchImpl: s.fetchImpl } : {}), // 测试注入通道
        })),
        source: 'settings',
        baseUrl: s.baseUrl,
        model: s.model,
        protocol: 'chat',
        relay: false,
    };
}

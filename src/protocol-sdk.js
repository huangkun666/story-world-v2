// story-world-v2/src/protocol-sdk.js
//
// ★★★用户令（2026-10-16）：「**多协议没有开源代码吗？有直接用就行**」＋「**就按这个开源代码的来**」。
//
// ＝＝＝ 这条路是什么 ＝＝＝
//   用**已随包**的开源多协议层（Vercel AI SDK，Apache-2.0；出处与哈希见 `vendor/api-protocol/manifest.json`）
//   去说**对话补全之外**那两种"模型语言"：
//     · `anthropic` —— Anthropic 消息（`/messages`：system 单独、`max_tokens` 必填、取文本在 `content[].text`）
//     · `responses` —— OpenAI 响应式（`/responses`：输入叫 `input`、取文本在 `output[].content[].text`）
//   它把请求体、响应体、用量字段、结束原因与错误**归一成同一种东西**，我们只认那一份归一结果。
//
// ＝＝＝ 与既有传输层的关系（★这是本笔最要紧的一条）＝＝＝
//   **对话补全那条路一个字都没改**（`src/transport-http.js` 的 `createHttpTransport`）——
//   它是本仓最承重的一段（leg139 的"绝不走页面那个 fetch"、200 里带 error 的判据、
//   截断/过滤/未知请求的既有语义）。本模块只**新增**另外两种形状，**不替换**它。
//   两条路共用的只有一样：**解释一份回执的判据**（`interpretChatCompletion`）与**发送通道**（`pickSender`）。
//
// ＝＝＝ 三条硬边界（都在判据里锁着）＝＝＝
//   ① **绝不走页面那个 fetch**（leg139，用户原话"这个通道绝对不能有"）：SDK 允许注入发送器
//      （provider 设置的 `fetch`），我们注入的就是本仓那一套（浏览器 XHR / Node 原生 fetch）。
//   ② **不自动重发**：SDK 的 `maxRetries` 缺省是 **2**（实测：缺省打 3 次请求、显式 0 只打 1 次），
//      与"未知请求不自动重发、不重复付费"冲突 ⇒ 本模块**一律显式传 0**，判据钉住。
//   ③ **超时/取消的语义与直连对齐**：超时=止损（`sw2Timeout`，编排层不重试）、取消=用户中止。
//
// ＝＝＝ 已知边界（如实记，不假装没有）＝＝＝
//   · 这两种形状**没有** `response_format: json_object` 这种"强制 JSON"开关（对话补全才有）⇒
//     回执是不是合法 JSON 由提示词保证，本模块不做二次约束。用这两种协议的玩家按此预期。
//   · 开源层对回执**校验很严**（实测：`responses` 少一个 `id`/`annotations` 就抛类型错）⇒
//     形状不规范的第三方网关会**报错**，不是"凑合读"。
//   · 浏览器里 `globalThis.fetch` 是**别人可能补过的那个**（leg139）⇒ 缺省发送器必须是下面的
//     `xhrResponseFetch`（XHR ＋ 真 `Response`），**绝不能**图省事直接用 `globalThis.fetch`。
import { interpretChatCompletion, sanitizeModelErrorMessage } from './transport-http.js';

/** 协议名（设置里那一格的值）。缺省 `chat` 表示走既有直连，不到本模块来。 */
export const PROTOCOLS = Object.freeze(['chat', 'anthropic', 'responses']);

/** 随包多协议层的地址（与 `web/` 下的模块同一个相对口径；浏览器与 Node 都能取到）。 */
const SDK_URL = '../vendor/api-protocol/index.js';
let sdkPromise = null;
/** 懒加载：只有真选了这两种协议才把这 1.1 MB 的随包文件读进来（对话补全那条路永不加载）。 */
export function loadProtocolSdk() {
    if (!sdkPromise) sdkPromise = import(SDK_URL);
    return sdkPromise;
}

/**
 * 浏览器里那条"能喂给 SDK"的发送器：SDK 要的是**标准 `Response`**，
 * 而本仓既有的 `xhrSender` 给的是同形的鸭子对象（没有 `body` 流）⇒ 这里包一层。
 * ★它**只在这里**存在，不动 `transport-http.js` 的发送通道（那条路上的一切判据照旧）。
 */
function responseFromDuck(res) {
    const headers = {};
    for (const name of ['content-type', 'x-request-id']) {
        const v = res?.headers?.get?.(name);
        if (v) headers[name] = v;
    }
    return { status: Number(res?.status) || 0, headers };
}

/**
 * 浏览器里那条"能喂给 SDK"的发送器。
 *
 * ★★为什么非有不可（这不是优化，是 leg139 的硬要求）：SDK 的 provider 设置里 `fetch` 缺省取
 *   `globalThis.fetch`——在页面里那就是**被别人补过的那个 fetch**（用户原话"这个通道绝对不能有"：
 *   实测有扩展会按地址匹配、把用户聊天正文的记忆当成一条 system 消息塞进请求体）。
 *   所以浏览器里**必须**把它换成我们自己的 XHR，并返回 SDK 要的**标准 `Response`**。
 *
 * ★它同时解决第二件事：**真流式**。XHR 在 `readyState>=2`（响应头到了）就 resolve，
 *   正文由 `onprogress` 一段段喂进 ReadableStream ⇒ 抽取那一路的"持续输出续期"照旧成立，
 *   不是等整份回来才交给 SDK。
 *
 * ★形状与 `transport-http.js` 的 `xhrSender` 对齐：网络层失败给**人话**并带 `network` 字样、
 *   中止抛 `AbortError`（reason 不参与，见那边 leg93d 那段）、超时带 `sw2Timeout`。
 * @returns {Promise<Response>}
 */
export function xhrResponseFetch(url, init = {}) {
    return new Promise((resolve, reject) => {
        const signal = init.signal;
        const encoder = new TextEncoder();
        let xhr;
        try { xhr = new XMLHttpRequest(); } catch (err) { reject(err); return; }
        let settled = false, closed = false, sent = 0, controller = null, onAbort = null;
        const abortErr = () => (typeof DOMException === 'function'
            ? new DOMException('signal is aborted without reason', 'AbortError')
            : Object.assign(new Error('signal is aborted without reason'), { name: 'AbortError' }));
        const stream = new ReadableStream({
            start(c) { controller = c; },
            cancel() { closed = true; try { xhr.abort(); } catch (_) {} },
        });
        const detach = () => { if (signal && onAbort) { try { signal.removeEventListener('abort', onAbort); } catch (_) {} } };
        const headers = () => {
            const out = {};
            for (const name of ['content-type', 'x-request-id']) {
                try { const v = xhr.getResponseHeader(name); if (v) out[name] = v; } catch (_) {}
            }
            return out;
        };
        const push = () => {
            if (closed || !controller) return;
            const text = String(xhr.responseText ?? '');
            const delta = text.slice(sent);
            sent = text.length;
            if (delta) { try { controller.enqueue(encoder.encode(delta)); } catch (_) {} }
        };
        const fail = (err) => {
            if (closed) return;
            closed = true; detach();
            try { controller?.error(err); } catch (_) {}
            if (!settled) { settled = true; reject(err); }
        };
        const closeBody = () => { if (closed) return; closed = true; detach(); try { controller?.close(); } catch (_) {} };
        const settle = () => {
            if (settled) return;
            const status = Number(xhr.status);
            // `Response` 的 status 只接受 200–599；XHR 的 0（网络层没拿到响应）不能塞进去。
            if (!(status >= 200 && status <= 599)) { fail(new Error('连不上模型服务（network error）')); return; }
            settled = true;
            resolve(new Response(stream, { status, headers: headers() }));
        };
        xhr.onreadystatechange = () => { if (xhr.readyState >= 2) settle(); };
        xhr.onprogress = () => push();
        xhr.onload = () => { settle(); push(); closeBody(); };
        xhr.onerror = () => fail(new Error('连不上模型服务（network error）'));
        xhr.ontimeout = () => fail(Object.assign(new Error('模型请求等待超时'), { sw2Timeout: true }));
        xhr.onabort = () => fail(abortErr());
        onAbort = () => { try { xhr.abort(); } catch (_) {} fail(abortErr()); };
        try {
            xhr.open(String(init.method || 'GET'), url, true);
            for (const [k, v] of Object.entries(init.headers || {})) { try { xhr.setRequestHeader(k, String(v)); } catch (_) {} }
        } catch (err) { fail(err); return; }
        if (signal) {
            if (signal.aborted) { onAbort(); return; }
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch (_) {}
        }
        try { xhr.send(init.body ?? null); } catch (err) { fail(err); }
    });
}

/** 缺省发送器：浏览器走我们自己的 XHR（leg139），Node 侧（判据／demo）走原生 fetch。 */
function defaultProtocolSender() {
    return typeof globalThis.XMLHttpRequest === 'function' ? xhrResponseFetch : globalThis.fetch;
}

/**
 * 建「按协议直连」的传输。契约与 `createHttpTransport` 返回的那一个同形。
 *
 * @param {object} opts
 *   · `protocol` 'anthropic' | 'responses'（'chat' 由既有直连负责）
 *   · `baseUrl` / `apiKey` / `model` / `headers`（`[[名称,值],…]`，如 `x-opencode-session`）
 *   · `fetchImpl` 判据注入的发送器（要能返回**真 `Response`**）；缺省见 `defaultProtocolSender`
 *   · `timeoutMs` / `maxTokens` / `temperature` / `extraction`
 */
export function createProtocolTransport({
    protocol, baseUrl, apiKey, model, headers = [], temperature = 0.7,
    timeoutMs = 120_000, maxTokens = 32768, extraction = false, stream = true,
    fetchImpl = null, onDiagnostic = null,
} = {}) {
    if (!PROTOCOLS.includes(protocol) || protocol === 'chat') throw new Error(`这个协议不走这里：${protocol}`);
    // ★发送器在**建传输那一刻**定下来（与既有传输同一条口径）——**绝不**在浏览器里用页面那个 fetch。
    const send = typeof fetchImpl === 'function' ? fetchImpl : defaultProtocolSender();
    const headerObject = Object.fromEntries(headers.filter(([k]) => typeof k === 'string' && k.trim()).map(([k, v]) => [k.trim(), String(v ?? '')]));
    return async function protocolTransport(prompt, { signal = null, onReceipt = null, messages = undefined } = {}) {
        if (typeof send !== 'function') throw new Error('没有可用的发送通道（这个环境里没有 fetch）');
        const sdk = await loadProtocolSdk();
        const interpret = (data, context) => { onReceipt?.({completion:data}); return interpretChatCompletion(data,context); };
        const controller = new AbortController();
        const started = Date.now();
        const cancel = () => controller.abort(Object.assign(new Error('用户已中止抽取'), { sw2Cancelled: true }));
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
        let timer;
        const armWait = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error(`模型超时（${timeoutMs}ms）`)), timeoutMs); };
        armWait();
        try {
            const provider = protocol === 'anthropic'
                ? sdk.createAnthropic({ apiKey, baseURL: baseUrl, headers: headerObject, fetch: send })
                : sdk.createOpenAI({ apiKey, baseURL: baseUrl, headers: headerObject, fetch: send });
            const target = protocol === 'anthropic' ? provider(model) : provider.responses(model);
            const common = {
                model: target, ...(messages === undefined ? {prompt} : {messages,allowSystemInMessages:true}), abortSignal: controller.signal,
                // ★②：绝不自动重发（SDK 缺省 2 ⇒ 实测会打 3 次请求）。
                maxRetries: 0,
                ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
                ...(Number.isFinite(temperature) ? { temperature } : {}),
            };
            if (extraction && stream !== false) {
                const r = sdk.streamText(common);
                let text = '';
                for await (const chunk of r.textStream) { text += chunk; armWait(); }   // 有输出就续期（与既有口径同义）
                const [usage, finishReason] = await Promise.all([r.usage, r.finishReason]);
                onDiagnostic?.({ stage: 'protocol-usage', protocol, usage, finishReason, ms: Date.now() - started });
                // ★流式那一路同样过**同一套判据**（截断/过滤/服务端报错都不许因为"走的是流"而漏掉）。
                return interpret({
                    choices: [{ index: 0, message: { content: text }, finish_reason: finishReason === 'length' ? 'length' : finishReason }],
                    ...(usage ? { usage } : {}),
                }, { model, apiKey });
            }
            const r = await sdk.generateText(common);
            onDiagnostic?.({ stage: 'protocol-usage', protocol, usage: r.usage, finishReason: r.finishReason, ms: Date.now() - started });
            // ★与直连共用同一套判据：截断、过滤、服务端报错、空正文，都在那一处。
            return interpret({
                choices: [{ index: 0, message: { content: r.text }, finish_reason: r.finishReason === 'length' ? 'length' : r.finishReason }],
                ...(r.usage ? { usage: r.usage } : {}),
            }, { model, apiKey });
        } catch (err) {
            if (signal?.aborted) throw Object.assign(new Error('用户已中止抽取'), { name: 'AbortError', sw2Cancelled: true, sw2CallFailure: { type: 'cancelled' } });
            if (controller.signal.aborted || err?.sw2Timeout) {
                const e = new Error(`模型超时（${timeoutMs}ms）——${extraction ? '这一轮没等到模型回话' : '这一轮没等到模型回话'}，已中止；可在参数页把「单轮超时」调大`);
                e.name = 'Sw2TimeoutError';
                e.cause = err;
                e.sw2CallFailure = { type: 'timeout', timeoutMs };
                e.sw2Timeout = true;
                throw e;
            }
            // SDK 的 API 错误 → 本仓的 `sw2CallFailure`（重试判据与人话文案都吃这一份）。
            const isApi = err instanceof sdk.APICallError;
            if (isApi) {
                const bodySnippet = String(err.responseBody ?? '').slice(0, 240);
                let code = '';
                try { const parsed = JSON.parse(bodySnippet); code = String(parsed?.error?.code ?? parsed?.error?.type ?? parsed?.type ?? '').trim(); } catch { /* 不是 JSON ⇒ 不猜 */ }
                const said = sanitizeModelErrorMessage(err.message ?? '', apiKey);
                const mapped = new Error(`模型服务报错（HTTP ${err.statusCode}）${said ? `：${said}` : ''}`);
                mapped.status = err.statusCode ?? null;
                mapped.bodySnippet = bodySnippet;
                mapped.sw2CallFailure = { type: 'http', status: err.statusCode ?? null, bodySnippet, ...(code ? { code } : {}), ...(said ? { message: said } : {}) };
                // 与直连同一条口径：上下文超限是"别重试"，不是瞬时错。
                mapped.sw2ContextLength = ['context_length_exceeded', 'max_context_length_exceeded'].includes(code);
                throw mapped;
            }
            // 网络层失败（连不上 / 被挡）：与直连**同一句人话、同一个类型**——`isTransientCallError` 认这一类，
            //   编排层的"链路断要重试"那条既有口径才不会因为换了协议而失配。
            const said = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
            if (/network error|Failed to fetch|NetworkError/i.test(said)) {
                const e = new Error('连不上模型服务（network error）');
                e.cause = err;
                e.sw2CallFailure = { type: 'network' };
                throw e;
            }
            throw err;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        }
    };
}

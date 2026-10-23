// story-world-v2/src/host-relay.js
//
// ★★★用户令（2026-10-16）：「**把api协议的活做了，要解决opencode go连接不了的问题**」＋选定「走酒馆后端转发」。
//
// ＝＝＝ 为什么必须有这条路（本机实测的形状，不是推测）＝＝＝
//   opencode go 的生成端点**不给浏览器跨域**：对
//     `…/inference/go/v1/chat/completions`、`…/openai/v1/chat/completions`、
//     `…/anthropic/v1/messages`、`…/openai/v1/responses`
//   发浏览器的跨域预检（OPTIONS）**一律 404 且不带任何跨域响应头**；只有 `GET …/go/v1/models` 带
//   `Access-Control-Allow-Origin: *`。浏览器对带 `Authorization` 的 POST **必先发预检**，
//   预检被挡 ⇒ **POST 根本没发出去**，页面只能收到"连不上"。
//   ⇒ 插件侧无论加多少请求头、换哪种协议都绕不过这一关；**唯一可行是让请求从宿主服务器发出**。
//
// ＝＝＝ 宿主这条通道是什么（本机酒馆 1.18.0 实读源码，逐处核过）＝＝＝
//   · 路由：`/api/backends/chat-completions/generate`（`src/server-startup.js` 挂载）。
//   · 形状：`chat_completion_source:'custom'` 时
//       `apiUrl = request.body.custom_url`，最终地址 = `${apiUrl}/chat/completions`
//       （`src/endpoints/backends/chat-completions.js` 的 CUSTOM 分支与末尾那句 endpointUrl）；
//       请求头 = `Content-Type` + `Authorization: Bearer <该来源的密钥>` + **`custom_include_headers` 合并进来的头**
//       （合并在后 ⇒ 我们传的头能覆盖 Authorization）；请求体可经 `custom_include_body` 合并额外字段。
//   · 密钥：`custom` 来源的密钥从酒馆自己的密钥库取；**但它允许为空**
//       （那句"缺密钥就 400"的判断把 `custom` 排除在外）⇒ 我们**不依赖酒馆存过密钥**，
//       而是把用户填的密钥放进 `custom_include_headers` 的 `Authorization` 里带过去。
//   · CSRF：酒馆对 `/api/**` 的 POST 要 `x-csrf-token`（`src/server-main.js`），
//       令牌从 `GET /csrf-token` 取（同一会话、同一 origin）。
//   · 回执：非流式时酒馆把**上游的 JSON 原样**转回；流式时把上游 SSE **原样转发**。
//     ⇒ 解析可以用与直连**同一套**解释器（`interpretChatCompletion` / `parseCompletionEventStream`）。
//
// ＝＝＝ 边界（守死，不许悄悄放宽）＝＝＝
//   ① 只走**对话补全**这一种形状：宿主这条通道按 `/chat/completions` 拼地址，别的形状（Anthropic 消息／
//      OpenAI 响应式）它拼不出来 —— 那两种走 `src/protocol-sdk.js` 的直连（浏览器跨域允许的网关）。
//   ② 发送通道仍是 `pickSender()`（浏览器 XHR、Node 原生 fetch）——**leg139 那条"绝不走页面那个 fetch"
//      的保护照旧**（别的扩展会往请求体里塞它自己的记忆）。
//   ③ 密钥只经内存：不进日志、不进设置以外的任何地方；宿主那句 `console.debug` 打的是请求体，
//      而密钥在请求头里 ⇒ 不会被它打出来。
//   ④ 超时／取消的语义与直连**逐条对齐**（超时=止损不重试、取消=用户中止、未知不自动重发）。
import { readCompletionData, createCompletionProgress } from './transport-sse.js';
import { interpretChatCompletion, normalizeBase, sanitizeModelErrorMessage, pickSender } from './transport-http.js';

/** 宿主转发端点（与酒馆源码里挂载的那一条一致）。 */
export const HOST_RELAY_ENDPOINT = '/api/backends/chat-completions/generate';
/** 取 CSRF 令牌（酒馆自带，同一会话同一 origin）。 */
export const HOST_CSRF_ENDPOINT = '/csrf-token';

/**
 * 把「名称: 值」若干行变成 YAML（酒馆用 `yaml.parse` 读 `custom_include_headers` / `custom_include_body`）。
 * ★值一律用 **JSON 双引号字符串**——JSON 的字符串字面量是合法的 YAML 双引号标量。
 *   ★为什么非引不可（**本机拿酒馆自己的 `mergeObjectWithYaml` 实测过，理由与我原来的说法不完全一样**）：
 *     · 裸值里的 ` #` 会**起注释**⇒ 值被截断（实测 `x-a: ok # 说明` 读出来只剩 `ok`）；
 *     · 裸值长得像数字／布尔／流集合时会被**读成别的类型**（实测 `x-a: [1, 2]` 读出来是数组，不是字符串）；
 *     · 而 YAML 一旦解析失败，酒馆**静默什么都不合并**（实测：坏 YAML 进来，那个对象一个键都不多）
 *       ⇒ 那会变成"看起来发出去了、其实一个头都没带"，正是 opencode go 回 400 的形状。
 *     ★当场纠正我自己一处旧说法：**冒号后面不跟空格时，裸值照旧是一个普通标量**
 *       （实测 `x-opencode-session: sw2-1:extra` 读得一字不差）⇒ "含冒号就会被读错"是错的，别照抄。
 * ★键名不引号：HTTP 头名与 `response_format` 这类键都是安全标量。
 * @param {Array<[string, unknown]>} entries
 * @returns {string} 每个键一行；空数组 ⇒ 空串（酒馆对空串直接跳过，不报错）
 */
export function toYamlMergeLines(entries = []) {
    return entries
        .filter(([k]) => typeof k === 'string' && k.trim())
        .map(([k, v]) => `${k.trim()}: ${JSON.stringify(v ?? '')}`)
        .join('\n');
}

/**
 * 建「经宿主转发」的传输。
 *
 * 契约与 `createHttpTransport` 返回的那一个**逐条同形**：
 *   `async (prompt, { signal }) => string`，失败时抛的错带 `sw2CallFailure` / `sw2Timeout` / `sw2Cancelled`。
 *
 * @param {object} opts
 *   · `baseUrl` 用户填的服务地址（会被 `normalizeBase` 补 `/v1`，宿主再往后接 `/chat/completions`）
 *   · `apiKey`  用户填的密钥（只经内存）
 *   · `model`   模型号
 *   · `headers` 额外请求头 `[[名称, 值], …]`（用户自己填，如 `x-opencode-session`）
 *   · `send`    发送器（缺省 `pickSender()`；判据注入假发送器走这条）
 *   · `csrfUrl` 取令牌的地址（判据可覆盖；缺省同源 `/csrf-token`）
 */
export function createHostRelayTransport({
    baseUrl, apiKey, model, headers = [], temperature = 0.7,
    timeoutMs = 120_000, maxTokens = 32768, extraction = false, stream = true,
    responseFormat = undefined, retryCsrf = true, send = null, csrfUrl = HOST_CSRF_ENDPOINT, relayUrl = HOST_RELAY_ENDPOINT,
    onDiagnostic = null,
} = {}) {
    // ★★★2026-10-16 实测抓出来的第二处：**转发那条路原来不带 JSON 模式**。
    //   直连那条（`createHttpTransport`）的缺省是 `response_format: {type:'json_object'}`——引擎按 JSON 解析回执，
    //   而转发原来只在调用方**显式给了** responseFormat 时才带 ⇒ 走转发时模型可以吐大白话 ⇒ 世界层报"非法 JSON"。
    //   ⇒ 口径对齐：**不传（undefined）＝按直连的缺省走 JSON 模式**；**显式 null＝这次不要**（探针就走这条）。
    const effectiveResponseFormat = responseFormat === undefined ? { type: 'json_object' } : responseFormat;
    // CSRF 令牌**按会话取一次就够**；被拒（403）时作废重取一次再试（酒馆重启/换会话会换令牌）。
    let csrfToken = null;
    // ★发送器在**建传输那一刻**定下来（显式注入的优先，判据走这条；缺省 = `pickSender()`）——
    //   与 `createHttpTransport` 同一条口径：浏览器 XHR、Node 原生 fetch，leg139 的保护照旧。
    const sendOnce = typeof send === 'function' ? send : pickSender();
    return async function relayTransport(prompt, { signal = null, onReceipt = null, messages = undefined } = {}) {
        if (typeof sendOnce !== 'function') throw new Error('没有可用的发送通道（这个环境里 fetch 与 XMLHttpRequest 都没有）');
        const controller = new AbortController();
        const started = Date.now();
        const cancel = () => controller.abort(Object.assign(new Error('用户已中止抽取'), { sw2Cancelled: true }));
        if (signal?.aborted) cancel();
        else signal?.addEventListener('abort', cancel, { once: true });
        let timer;
        const armWait = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error(`模型超时（${timeoutMs}ms）`)), timeoutMs); };
        armWait();
        const consume = extraction ? createCompletionProgress() : null;
        let receivedChars = 0;
        const onResponseProgress = (update) => {
            if (!consume || typeof update?.text !== 'string') return;
            const delta = update.text.slice(receivedChars);
            receivedChars = update.text.length;
            if (consume(delta)) armWait();
        };
        const fetchToken = async () => {
            const res = await sendOnce(csrfUrl, { method: 'GET', headers: {}, signal: controller.signal });
            if (!res?.ok) throw Object.assign(new Error('取不到宿主令牌'), { sw2CallFailure: { type: 'http', status: res?.status ?? null, bodySnippet: '' } });
            const body = JSON.parse(String(await res.text() ?? ''));
            const token = String(body?.token ?? '').trim();
            if (!token) throw Object.assign(new Error('宿主没有给出令牌'), { sw2CallFailure: { type: 'http', status: res?.status ?? null, bodySnippet: '' } });
            return token;
        };
        const buildBody = () => {
            // 密钥与用户自定义头一起放进 `custom_include_headers`：酒馆把它合并到请求头里（在后 ⇒ 覆盖默认的 Authorization）。
            const headEntries = [['Authorization', `Bearer ${apiKey}`], ...headers];
            const bodyEntries = effectiveResponseFormat ? [['response_format', effectiveResponseFormat]] : [];
            return {
                chat_completion_source: 'custom',
                custom_url: normalizeBase(baseUrl),
                custom_include_headers: toYamlMergeLines(headEntries),
                ...(bodyEntries.length ? { custom_include_body: toYamlMergeLines(bodyEntries) } : {}),
                model,
                messages: messages ?? [{ role: 'user', content: prompt }],
                temperature,
                ...(maxTokens ? { max_tokens: maxTokens } : {}),
                ...(extraction ? { stream: stream !== false } : {}),
            };
        };
        const post = async (token) => sendOnce(relayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify(buildBody()),
            signal: controller.signal,
            ...(extraction ? { onResponseProgress } : {}),
        });
        try {
            if (!csrfToken) csrfToken = await fetchToken();
            let res = await post(csrfToken);
            if (retryCsrf && res?.status === 403) { csrfToken = await fetchToken(); res = await post(csrfToken); }
            onDiagnostic?.({ stage: 'relay-response', status: res?.status ?? null, ms: Date.now() - started });
            if (!res?.ok) {
                const body = String(await res.text() ?? '');
                const snippet = body.slice(0, 240);
                // 宿主自己失败时给的是 `{error:{message}}`；把那一句原样带给用户，别只说"HTTP 502"。
                let said = '';
                try {
                    const parsed = JSON.parse(body);
                    said = String(parsed?.error?.message ?? parsed?.message ?? '').trim();
                } catch { /* 不是 JSON ⇒ 只留 snippet */ }
                const err = new Error(`宿主转发失败（HTTP ${res?.status ?? '?'}）${said ? `：${sanitizeModelErrorMessage(said, apiKey)}` : ''}`);
                err.status = res?.status ?? null;
                err.bodySnippet = snippet;
                err.sw2CallFailure = { type: 'http', status: res?.status ?? null, bodySnippet: snippet, ...(said ? { message: sanitizeModelErrorMessage(said, apiKey) } : {}) };
                throw err;
            }
            const data = await readCompletionData(res,onResponseProgress,{signal:controller.signal,onReceipt});
            return interpretChatCompletion(data, { model, apiKey });
        } catch (err) {
            if (String(err?.message) === '连不上模型服务（network error）') err.sw2CallFailure = { type: 'network' };
            if (signal?.aborted) throw Object.assign(new Error('用户已中止抽取'), { name: 'AbortError', sw2Cancelled: true, sw2CallFailure: { type: 'cancelled' } });
            if (controller.signal.aborted || err?.sw2Timeout) {
                const e = new Error(`模型超时（${timeoutMs}ms）——${extraction ? '等待模型新输出超时' : '这一轮没等到模型回话'}，已中止；可在参数页把「单轮超时」调大`);
                e.name = 'Sw2TimeoutError';
                e.cause = err;
                e.sw2CallFailure = { type: 'timeout', timeoutMs };
                e.sw2Timeout = true;
                throw e;
            }
            throw err;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        }
    };
}

/**
 * ★★★2026-10-16 实测抓出来的第一处（**用户看到的那一条**）：「测试连通」原来走的是 `probeModel`，
 *   而它**只认直连**——浏览器直接 POST 到网关 ⇒ 跨域被挡的网关（如 opencode go）**永远显示"连不上"**，
 *   哪怕「走酒馆后端转发」已经勾上（世界推进那条路其实是通的）。
 *   ⇒ 补这一口：**结论形状与 `probeModel` 逐字同形**（`{ok,ms,status,reply,error}`），只是请求经宿主发出。
 *   ★探针**故意不带 JSON 模式**（`responseFormat: null`）——与直连那条 probeModel 同一条口径：
 *     不是所有模型都支持 JSON 模式，探测不该因为"不支持 JSON 模式"判失败。
 *   ★★★2026-10-16 用户复测当场撞出来的第三条：「注意：连不通（经酒馆后端）：**模型输出被截断，未能完整返回本次内容**」。
 *     那不是连不上——探针只给 `max_tokens: 16`，推理型模型（如 `step-5-preview`）这点额度还没吐出正文就到顶了，
 *     服务端回 `finish_reason:'length'`，而转发那条路把截断当**失败**抛出来。
 *     **探针的职责是"地址通不通 · 密钥对不对 · 模型号认不认"三样**；被小额度截断恰恰证明这三样**全对**
 *     （端点收下了、凭据认了、模型也在生成）⇒ **截断算通**，并在结论里如实标一句"被小额度截断"。
 *     （直连那条 `probeModel` 本来就不看 `finish_reason`，两条探针的口径由此对齐。）
 * @returns {Promise<{ok:boolean, ms:number, status:number|null, reply:string, error:string|null, truncated?:boolean}>}
 */
export async function probeModelViaRelay({ baseUrl, apiKey, model, headers = [], timeoutMs = 30000, maxTokens = 16, send = null } = {}) {
    const out = { ok: false, ms: 0, status: null, reply: '', error: null, truncated: false };
    if (!String(baseUrl || '').trim()) { out.error = '还没填「服务地址」'; return out; }
    if (!String(model || '').trim()) { out.error = '还没填「世界模型」'; return out; }
    const transport = createHostRelayTransport({ baseUrl, apiKey, model, headers, maxTokens, timeoutMs, responseFormat: null, ...(typeof send === 'function' ? { send } : {}) });
    const t0 = Date.now();
    try {
        out.reply = String(await transport('ping') ?? '');
        out.ms = Date.now() - t0;
        out.ok = true;
        return out;
    } catch (err) {
        out.ms = Date.now() - t0;
        out.status = err?.status ?? null;
        // ★截断 ⇒ **算通**（见上面那段）：三样都验过了，只是我们给的钱太少。
        if (err?.sw2Truncated) {
            out.ok = true;
            out.truncated = true;
            out.reply = '';
            return out;
        }
        out.error = err?.sw2Timeout
            ? `等超时了（${timeoutMs}ms）——地址通但模型没回话`
            : String(err?.message || err);
        return out;
    }
}

// story-world-v2/src/transport-http.js
// 主调用 HTTP 传输（S6 接线）：OpenAI 兼容 chat/completions，零依赖（Node 24 原生 fetch）。
// base 归一化：末尾去斜杠；无 /v1 自动补（gcli.ggchan.dev 网关与 deepseek 均兼容 /v1 路径）。
// 配置源：env（ST_OPENAI_BASE / ST_OPENAI_KEY / ST_WORLD_MODEL 或 OPENAI_*）→ 酒馆预设（st-preset.js）。
// 测试注入假 fetchImpl。

export function normalizeBase(base) {
    let b = String(base).trim().replace(/\/+$/, '');
    if (!/\/v1$/.test(b)) b = `${b}/v1`;
    return b;
}

export function createHttpTransport({ baseUrl, apiKey, model, temperature = 0.7, fetchImpl = fetch }) {
    const endpoint = `${normalizeBase(baseUrl)}/chat/completions`;
    return async (prompt) => {
        const res = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature,
                response_format: { type: 'json_object' },
            }),
        });
        if (!res.ok) {
            const snippet = (await res.text()).slice(0, 240);
            const err = new Error(`HTTP ${res.status}`);
            err.status = res.status;
            err.bodySnippet = snippet;
            throw err;
        }
        const data = await res.json();
        return data?.choices?.[0]?.message?.content ?? '';
    };
}

export function createEnvTransport(env) {
    // 浏览器安全守卫（K30）：无参调用在浏览器（无 process）不抛 —— 缺 env 视为空配置
    const e = env ?? (typeof process !== 'undefined' ? process.env : {});
    const base = e.ST_OPENAI_BASE || e.OPENAI_BASE_URL;
    const key = e.ST_OPENAI_KEY || e.OPENAI_API_KEY;
    const model = e.ST_WORLD_MODEL || e.OPENAI_MODEL;
    if (!base || !key || !model) return null;
    return createHttpTransport({ baseUrl: base, apiKey: key, model });
}
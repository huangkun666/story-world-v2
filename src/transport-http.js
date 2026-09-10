// story-world-v2/src/transport-http.js
// 主调用 HTTP 传输（S6 接线）：OpenAI 兼容 chat/completions，零依赖（Node 24 原生 fetch）。
// base 归一化：末尾去斜杠；无 /v1 自动补（gcli.ggchan.dev 网关与 deepseek 均兼容 /v1 路径）。
// 配置源：env（ST_OPENAI_BASE / ST_OPENAI_KEY / ST_WORLD_MODEL 或 OPENAI_*）→ 酒馆预设（st-preset.js）。
// 测试注入假 fetchImpl。
// K36 异步可靠性（细案 §3.3 → A-5）：主调用超时（AbortController）+ max_tokens 上限，
//   两个数字为提案态（铁律 2，标注待报批；随 K36 报批批/长跑回填定案），参数化可覆盖、测试用小值。

export function normalizeBase(base) {
    let b = String(base).trim().replace(/\/+$/, '');
    if (!/\/v1$/.test(b)) b = `${b}/v1`;
    return b;
}

// 提案数字（铁律 2：提案态，标注待报批；细案 §3.3/§6）
// 审计修复 E3：maxTokens 4096 → 16384——第十九棒用户拍板「主调用 max_tokens 4096→16384 随幅改」
// （全量棋盘镜头 30k 定案连带；docs/decision-index.md:70 / docs/full-roster-lens-spec.md §42·§98·§102 /
//  docs/ratification-batch-k38-2026-09-09.md #2 三处定案），代码此前漏改，抽取侧早已 16384。
export const PROPOSED_CALL_LIMITS = Object.freeze({
    timeoutMs: 120_000, // 主调用超时（提案）
    maxTokens: 16384,   // 单轮演算输出上限（定案 16384：与抽取侧同值，见 EXTRACTION_MAX_TOKENS）
});

// 第十八棒：抽取调用独立输出上限（审计修复 E3：**与主调用同值 16384**——两侧本就同模型同通道，
// 同一份预算实证，此前主调用 4096 是漏改；抽取侧保留独立常量只为「哪一侧用了它」可读）。
// 诊断实证（demo/diag-init-extract.js）：
// 思考型模型（reasoning_content）推理与输出共享预算，63k 输入 @4096 → finish=length 截断（推理 4024 吃光）；
// 同输入 @16384 → finish=stop 完整。v1「80k 段连续空回复」同源（预算饿死，非网关）——两侧统一提额。
export const EXTRACTION_MAX_TOKENS = PROPOSED_CALL_LIMITS.maxTokens;

export function createHttpTransport({ baseUrl, apiKey, model, temperature = 0.7, fetchImpl = fetch, timeoutMs = PROPOSED_CALL_LIMITS.timeoutMs, maxTokens = PROPOSED_CALL_LIMITS.maxTokens }) {
    const endpoint = `${normalizeBase(baseUrl)}/chat/completions`;
    return async (prompt) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error(`主调用超时（${timeoutMs}ms，提案）`)), timeoutMs);
        try {
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
                    ...(maxTokens ? { max_tokens: maxTokens } : {}),
                }),
                signal: controller.signal,
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
        } finally {
            clearTimeout(timer);
        }
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
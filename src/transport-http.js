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

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27（用户令「二十多分钟很慢，你做吧」）：**抽取侧独立超时** + **超时如实标记**。
//   病（用户实机 2026-09-11 原始症状）：初始化抽取跑了 20+ 分钟、状态栏一行不动、不知抽到哪。
//   根因（读真码 + 实测真书，见 leg27 交接）：
//     ①抽取每次调用的输入是**贴满上限的块**——真账**实测** 大荒-姬元真.json = 235 条 / 265,866 字符
//       ⇒ 60,000 字符/块 ⇒ 5 块，实到块大小 [59215, 58673, 59892, 58902, 30344]（全贴 97% 上限）；
//     ②输出预算 16,384 tokens **且 reasoning 与输出共享该预算**（上方断实证），模型是推理型
//       （用户现场 gemini-3.1-pro-preview）⇒ 单次调用是**分钟级**，不是秒级；
//     ③旧法把"超时"与"网关偶发空回复"**当成同一种可重试的瞬时错**：超时 → `tryRosterChunk` 对半拆
//       （每半再各 2 分钟）→ 拆 4 层 → 保底重试 → 全失败才降级 ⇒ 单块最坏 31 次调用 × 120 秒 = **62 分钟**。
//       ★对半拆治不了超时：拆小的是**输入**，而超时主因是**生成时间**（输出预算仍 16,384/次）。
//   ⇒ 两处改：①抽取侧超时独立给足（不再蹭主调用的 120 s）；②超时**如实标记** `sw2Timeout`，
//            让编排层能把它与瞬时错分开（`abstract.js` 对超时不再拆半、不再重试）。
//   数字（**提案态**，铁律 2，随长跑曲线定案）：300,000 ms = 5 分钟/次。
//     依据：单块 ≈ 59k 字符输入 + ≤16,384 tokens 输出（reasoning 占盘）⇒ 分钟级，给 2.5 倍余量；
//     同时它**不是无上限**——天花板 = 300 s（旧法最坏 62 分钟/块 ⇒ 现在最坏 5 分钟/块即止损跳过）。
export const EXTRACTION_TIMEOUT_MS = 300_000;

// 超时标记：给调用方一个**可判**的形态（不是靠猜错误文案）。
//   ⚠ leg27 澄清我此前一个**误判**（留档防复发）：我一度怀疑 `abort(reason)` 传 non-cloneable 会抛
//   ⇒ 超时根本没生效。**实测证伪**（本机真跑）：`abort(new Error('…'))` 正常返回、
//   `signal.aborted=true`、挂住的 fetch 在 528 ms 被中断 ⇒ **超时是生效的**，别再修这一处。
function markTimeout(err) {
    try { err.sw2Timeout = true; } catch (_) {}
    return err;
}

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
        } catch (err) {
            // leg27：超时**如实标识**（判据 = 本控制器自己发出过中止 ⇒ fetch 因我们超时而拒）
            //   ⇒ 编排层据此把它与"网关偶发空回复"分开：**超时不重试、不拆半**（拆了也白拆，见文件头）。
            if (controller.signal.aborted) throw markTimeout(err);
            throw err;
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
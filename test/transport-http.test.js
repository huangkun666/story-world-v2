// story-world-v2/test/transport-http.test.js
// HTTP 传输单测（注入假 fetch，不联网）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport, createEnvTransport, PROPOSED_CALL_LIMITS, EXTRACTION_MAX_TOKENS, EXTRACTION_TIMEOUT_MS } from '../src/transport-http.js';

test('HTTP 传输：请求形状正确（URL/鉴权/payload）且透传内容', async () => {
    let captured;
    const fakeFetch = async (url, opts) => {
        captured = { url, opts };
        return { ok: true, json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) };
    };
    const transport = createHttpTransport({ baseUrl: 'https://api.test/v1', apiKey: 'k-secret', model: 'm-9', fetchImpl: fakeFetch });
    const text = await transport('请你输出 JSON');
    assert.equal(text, '{"a":1}');
    assert.ok(captured.url.endsWith('/chat/completions'));
    assert.equal(captured.opts.headers.Authorization, 'Bearer k-secret');
    const body = JSON.parse(captured.opts.body);
    assert.equal(body.model, 'm-9');
    assert.equal(body.messages[0].content, '请你输出 JSON');
    assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('HTTP 传输：非 2xx 抛错（带状态码与响应体）；无 choices 返回空串', async () => {
    const fail = async () => ({ ok: false, status: 429, text: async () => '{"error":"限流"}', json: async () => ({}) });
    const t1 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: fail });
    await assert.rejects(() => t1('x'), (err) => err.message === 'HTTP 429' && err.status === 429 && err.bodySnippet.includes('限流'));

    const empty = async () => ({ ok: true, text: async () => '{}', json: async () => ({}) });
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: empty });
    assert.equal(await t2('x'), '');
});

test('HTTP 传输：base 归一化（无 /v1 自动补；有则保留）', async () => {
    const ok = async () => ({ ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) });
    let url1, url2;
    await createHttpTransport({ baseUrl: 'https://gw.example', apiKey: 'k', model: 'm', fetchImpl: async (u) => { url1 = u; return ok(); } })('p');
    await createHttpTransport({ baseUrl: 'https://gw.example/v1', apiKey: 'k', model: 'm', fetchImpl: async (u) => { url2 = u; return ok(); } })('p');
    assert.ok(url1.endsWith('/v1/chat/completions'), url1);
    assert.ok(url2.endsWith('/v1/chat/completions'), url2);
});

test('K36/A-5 超时防线：超时（AbortController）→ 竞态中止并抛错；正常路径零误伤', async () => {
    // 永不 resolve 的假 fetch：只有信号中止才能让它结束
    const hang = (url, opts) => new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(opts.signal.reason || new Error('aborted')));
    });
    const t = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: hang, timeoutMs: 30 });
    await assert.rejects(() => t('x'), /超时/);

    // 正常路径：未超时完整返回
    const ok = async () => ({ ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: '{"a":1}' } }] }) });
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: ok, timeoutMs: 1000 });
    assert.equal(await t2('x'), '{"a":1}');
});

test('K36/A-5 max_tokens 上限：默认带定案值 16384；显式传参可覆盖/关闭', async () => {
    let bodies = [];
    const capture = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    const t1 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture });
    await t1('p');
    assert.equal(bodies[0].max_tokens, 16384); // 审计修复 E3：4096 → 16384（三处定案文档：decision-index:70 / full-roster-lens-spec / ratification-batch-k38 #2）
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: 2048 });
    await t2('p');
    assert.equal(bodies[1].max_tokens, 2048);
    const t3 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: 0 });
    await t3('p');
    assert.equal(bodies[2].max_tokens, undefined); // 0=不写
});

// ★★leg62（用户令「嗯嗯预算还是增大的好」）：本锁**换过口径**，改之前先读这段。
//   旧口径（E3，本笔之前）=「主调用与抽取调用**同预算**，两侧统一到 16384」。
//   该前提是"两侧输出量同量级"；leg62 的设定面（概念表）输出量是名册侧的几倍，**前提不成立** ⇒ 拆开取值。
//   判据落成三条**新的、可判等的**事（不是把数字改大就完）：
//     ① 主调用默认**不动**（它没被本笔牵连，谁改它谁举证）；
//     ② 抽取侧**必须更大**——依据是真机实测（`F:/deepseek/tmp/leg62-live-budget.js`）：
//        同一本大荒 @16384 → `finish_reason=length`（JSON 写一半断死）；@32768 → `stop`、完整解析；
//     ③ ★**驱动这条判据的机理必须成立**：抬预算的理由是"推理与输出共享预算"，
//        而三次成功调用的 completion 只有 5,521 / 5,184（**远低于 16,384**）——
//        即"截断不是因为输出装不下"。⇒ 本锁**同时断言"实测输出远低于预算"这件事**，
//        防的下一手是：有人看到"16k 就够写了"又把预算降回去（那会让推理重新饿死）。
test('★leg62 抽取预算独立抬到 32,768（真机 finish=length→stop）：主调用不动、抽取侧更大', async () => {
    assert.equal(PROPOSED_CALL_LIMITS.maxTokens, 16384, '主调用默认不动（本笔没牵连它）');
    assert.equal(EXTRACTION_MAX_TOKENS, 32768, '★抽取侧 32,768：@16384 实测 finish_reason=length 截断，@32768 stop');
    assert.ok(EXTRACTION_MAX_TOKENS > PROPOSED_CALL_LIMITS.maxTokens, '抽取侧必须比主调用大（leg62 拆档的依据）');
    // ★真机实测的 completion 峰值（leg62 三次成功调用：5,521 / 5,184）远低于旧预算 16,384
    const MEASURED_PEAK_COMPLETION = 5521;
    assert.ok(MEASURED_PEAK_COMPLETION < PROPOSED_CALL_LIMITS.maxTokens,
        '实测正文远低于旧预算 ⇒ 截断的真因是推理吃预算，不是输出装不下（别据此把预算降回 16k）');

    const seen = [];
    const capture = async (url, opts) => { seen.push(JSON.parse(opts.body).max_tokens); return { ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    await createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture })('主调用');
    await createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: EXTRACTION_MAX_TOKENS })('抽取调用');
    assert.deepEqual(seen, [16384, 32768], '两次真实请求体各自带上自己的预算（拆档不再同值）');
});

test('HTTP 传输：env 齐备时可用，缺配置返回 null', () => {
    const full = createEnvTransport({ ST_OPENAI_BASE: 'https://x/v1', ST_OPENAI_KEY: 'k', ST_WORLD_MODEL: 'm' });
    assert.equal(typeof full, 'function');
    assert.equal(createEnvTransport({}), null);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27（用户令「二十多分钟很慢，你做吧」）：**超时必须如实标记** + **抽取侧独立超时**。
// 为什么要这条锁：编排层要靠 `err.sw2Timeout` 才能把"超时"与"网关偶发空回复"分开——
//   分不开的代价是实测算出来的 **62 分钟/块**（超时→对半拆 4 层→保底重试→仍跳过）。
//   所以"标记有没有真的贴上"是 F2 的地基，必须锁死；同时**非超时的错不许被误标**（否则瞬时错也会被跳过不重试）。
test('★leg27：超时错误被如实标记 sw2Timeout（编排层分治的地基）', async () => {
    const hang = (url, opts) => new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(opts.signal.reason || new Error('aborted')));
    });
    const t = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: hang, timeoutMs: 20 });
    let caught = null;
    try { await t('x'); } catch (err) { caught = err; }
    assert.ok(caught, '超时必须抛错（不静默）');
    assert.equal(caught.sw2Timeout, true, '★超时被标记（没有这个标记，编排层就只能一律重试 ⇒ 62 分钟/块归来）');
    assert.match(String(caught.message), /超时/, '人读也看得出是超时');
});

test('★leg27：非超时的错**不许**被误标（HTTP 错仍走瞬时错重试路）', async () => {
    const httpErr = async () => ({ ok: false, status: 502, text: async () => 'bad gateway', json: async () => ({}) });
    const t = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: httpErr, timeoutMs: 1000 });
    let caught = null;
    try { await t('x'); } catch (err) { caught = err; }
    assert.equal(caught.status, 502, 'HTTP 状态如实带出');
    assert.notEqual(caught.sw2Timeout, true, '★HTTP 错不许标成超时（否则瞬时错会被"止损跳过"，白丢数据）');
});

test('★leg27：抽取侧超时 = 独立提案值 300_000 ms（主调用仍 120_000，两侧不互相带偏）', () => {
    assert.equal(EXTRACTION_TIMEOUT_MS, 300_000, '抽取超时 5 分钟（提案态，随长跑曲线定案）');
    assert.equal(PROPOSED_CALL_LIMITS.timeoutMs, 120_000, '主调用超时未被动过（仍是 120 s 提案）');
    assert.ok(EXTRACTION_TIMEOUT_MS > PROPOSED_CALL_LIMITS.timeoutMs, '抽取侧必须更宽：单块 ~59k 字符 + ≤16,384 tokens 输出（reasoning 占盘）是分钟级');
});
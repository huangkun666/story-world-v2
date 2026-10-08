// story-world-v2/test/transport-http.test.js
// HTTP 传输单测（注入假 fetch，不联网）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport, createEnvTransport, PROPOSED_CALL_LIMITS, EXTRACTION_MAX_TOKENS, EXTRACTION_TIMEOUT_MS } from '../src/transport-http.js';
import { isTransientCallError } from '../src/abstract.js';

for (const content of ['', '{"society":', '{"society":"city","bookEntities":[]}']) {
    test(`HTTP length throws a typed truncation error for ${JSON.stringify(content)}`, async () => {
        const transport = createHttpTransport({
            baseUrl: 'https://fake.invalid', apiKey: 'fake', model: 'fake',
            fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [
                { finish_reason: 'length', message: { content } },
            ] }) }),
        });
        await assert.rejects(transport('fixture'), err => {
            assert.equal(err.name, 'Sw2TruncationError');
            assert.equal(err.sw2Truncated, true);
            assert.deepEqual(err.sw2CallFailure, { type: 'truncation', finishReason: 'length' });
            assert.match(err.message, /截断/);
            assert.equal(isTransientCallError(err), false);
            return true;
        });
    });
}

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

// ★★★leg93d（交接 §5.1 登记了两棒的那一行 · 真因修）：超时那句人话**必须真的到得了用户眼前**。
//   病：真浏览器里 fetch 被中止时抛的是**它自己的** DOMException（`signal is aborted without reason`），
//   **不带**我们 `abort(reason)` 传进去的 reason ⇒ 那句英文一路被包成 `传输失败: …`
//   （`worldstep.js:14`）印到状态条上（`async-tick.js:43`）：「⚠ 演算失败：传输失败:
//   signal is aborted without reason」——**看得出失败、看不出为什么**（用户为这句查了两棒）。
//   ★★为什么上面那条老判据一直是绿的（**空绿的第二个实例**，形状与 leg89 那次一模一样）：
//     它的假 fetch 写的是 `reject(opts.signal.reason)` —— **把 reason 直接传了出来**，
//     于是 `/超时/` 过得去；而**真 fetch 不这么干**。⇒ 本条的假 fetch 照**真浏览器语义**写。
test('★★★leg93d：真浏览器语义下超时也要抛**人话**（不是 DOMException 那句英文）', async () => {
    // 照真 fetch：被中止 ⇒ 抛 DOMException，**reason 不参与**
    const realFetchShape = (url, opts) => new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('signal is aborted without reason', 'AbortError'));
        });
    });
    const t = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: realFetchShape, timeoutMs: 30 });
    let seen = null;
    try { await t('x'); } catch (e) { seen = e; }
    assert.ok(seen, '必须抛错（不许静默返回空）');
    // ① 玩家可见的那一句必须是**人话**，且**说得出是多少毫秒**（超时是我们自己发的信号，我们知道）
    assert.match(String(seen.message), /超时/, `★状态条上要能读懂：${seen.message}`);
    assert.match(String(seen.message), /30ms/, '★人话里要带真实的超时值（从我们自己的 timeoutMs 来）');
    assert.ok(!/signal is aborted without reason/.test(String(seen.message)),
        '★★不许把那句英文原样抛出去（这就是用户在控制台里看到、又查不出所以然的那一行）');
    // ② 超时的**标志位与止损语义一个都不许丢**（`abstract.js` 靠它判"不重试、不拆半"）
    assert.equal(seen.sw2Timeout, true, '★sw2Timeout 必须还在（丢了就会被当成可重试的瞬时错 ⇒ 又等满一个超时）');
    assert.equal(seen.cause?.name, 'AbortError', '★原异常挂在 cause 上（要复盘仍拿得到名与栈）');
    // ③ 与"网关偶发空回复"仍分得开：瞬时错判据不许把这条超时算进去
    assert.equal(isTransientCallError(seen), false, '★超时=止损：不许被判成可重试的瞬时错');
});

// ★leg93d 反面：**没有**我们的标志位、message 里也没有 abort 字样的普通错，不许被误当成超时
test('leg93d 反面：普通失败不许被误判成超时（标志位与文案都不认它）', () => {
    assert.equal(isTransientCallError({ message: 'HTTP 500' }), true, '500 仍是可重试的瞬时错');
    assert.equal(isTransientCallError({ message: 'HTTP 401' }), false, '配置错不重试');
    assert.equal(isTransientCallError({ message: '主调用超时（30000ms）——这一轮没等到模型回话，已中止', sw2Timeout: true }), false,
        '★带标志的人话超时同样不重试（新文案里没有 abort 字样，靠的是标志位）');});


test('K36/A-5 max_tokens 上限：默认带定案值 32768；显式传参可覆盖/关闭', async () => {
    let bodies = [];
    const capture = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    const t1 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture });
    await t1('p');
    assert.equal(bodies[0].max_tokens, 32768); // ★leg157：16,384 → 32,768（用户令「没有就默认32768」；理由与真机证据见 transport-http.js 常量那段）
    const t2 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: 2048 });
    await t2('p');
    assert.equal(bodies[1].max_tokens, 2048);
    const t3 = createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: 0 });
    await t3('p');
    assert.equal(bodies[2].max_tokens, undefined); // 0=不写
});

// ★★leg62（用户令「嗯嗯预算还是增大的好」）：本锁**换过口径**，改之前先读这段。
//   旧口径（E3，leg62 之前）=「主调用与抽取调用**同预算**，两侧统一到 16384」。
//   该前提是"两侧输出量同量级"；leg62 的设定面（概念表）输出量是名册侧的几倍，**前提不成立** ⇒ 拆开取值。
//   ★★★leg157 再换一次（用户令「**能直接读的话那就直接读呗，没有就默认32768就这样**」）：
//   **两侧现在同值 32,768**。依据是真机证据（社区用户用 `deepseek/deepseek-v4.1-flash-fast` 跑到第 11 轮起，
//   主调用在 16,384 上**稳定失败**，两种报错交替：「主调用返回空」与「主调用返回非法 JSON」——
//   DeepSeek 官方两张文档把这两句指到**同一根因**：`max_tokens` 是"生成的总量"、
//   `reasoning_tokens` 算在里面，而它的思考模式**默认开着**、思考模式的服务端缺省是 64K）。
//   判据落成三条**新的、可判等的**事（不是把数字改大就完）：
//     ① **两侧都 ≥ 32,768**——谁也不许被降回去（降回去 = 让推理重新饿死，正是第 11 轮那个病）；
//     ② **抽取侧不许比主调用小**——★口径从 leg62 的"必须更大"放宽成"不小于"，**不是**"随便"：
//        32,768 是两笔实测共同的落点（leg62 的截断臂：@16,384 `finish_reason=length`、@32,768 `stop`）；
//     ③ ★**驱动这条判据的机理仍然成立**：抬预算的理由是"推理与输出共享预算"，
//        而实测正文只有 5,521 / 5,184（**远低于**任何一档预算）——即"截断不是因为输出装不下"。
//        ⇒ 本锁**同时断言"实测输出远低于预算"这件事**，防的下一手是：
//        有人看到"16k 就够写了"又把预算降回去（那会让推理重新饿死）。
test('★leg62 + leg157 两侧预算：都抬到 32,768（真机 finish=length→stop）；抽取侧不小于主调用', async () => {
    assert.equal(PROPOSED_CALL_LIMITS.maxTokens, 32768, '★主调用 leg157 抬到 32,768（16,384 上真机稳定失败：思考吃光预算 ⇒ 空回复 / 非法 JSON）');
    assert.equal(EXTRACTION_MAX_TOKENS, 32768, '★抽取侧 32,768：@16384 实测 finish_reason=length 截断，@32768 stop');
    assert.ok(EXTRACTION_MAX_TOKENS >= PROPOSED_CALL_LIMITS.maxTokens, '抽取侧不许比主调用小（leg157 起两侧同档）');
    // ★真机实测的 completion 峰值（leg62 三次成功调用：5,521 / 5,184）远低于任何一档预算
    const MEASURED_PEAK_COMPLETION = 5521;
    assert.ok(MEASURED_PEAK_COMPLETION < PROPOSED_CALL_LIMITS.maxTokens,
        '实测正文远低于预算 ⇒ 截断的真因是推理吃预算，不是输出装不下（别据此把预算降回 16k）');

    const seen = [];
    const capture = async (url, opts) => { seen.push(JSON.parse(opts.body).max_tokens); return { ok: true, text: async () => '', json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; };
    await createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture })('主调用');
    await createHttpTransport({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', fetchImpl: capture, maxTokens: EXTRACTION_MAX_TOKENS })('抽取调用');
    assert.deepEqual(seen, [32768, 32768], '两次真实请求体各自带上自己的预算（leg157 起两侧同档，但仍是两个独立传参口）');
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

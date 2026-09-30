// story-world-v2/test/transport-channel.test.js
// ★★★本次（用户令「**这个通道绝对不能有**」）：**模型调用走哪条路**必须被锁住。
//
// 病（亲手查实，全链证据在交接里）：别的扩展（本机实测 `yuzuki-Memory`）把页面的 `window.fetch`
//   换成了自己的函数，并按"地址里有没有 `/v1/chat/completions`"决定要不要动这个请求体——
//   它拿**你聊天里最后两条正文**去它绑定的记忆库检索，把命中的记忆**当成一条 system 消息塞进请求体**。
//   而我们原来的写法是 `fetchImpl = fetch`（缺省参数在**调用那一刻**求值）⇒ 我们的抽取/起根/演算
//   提示词里**悄悄多了一段用户正文的记忆**。真账后果：设定面多出一条书里没有的 `玉爪儿`；
//   起根 6 条里 2 条的"书里原话"其实是记忆库的句子。
//   ★它**不在我们仓里**（是别人的补丁），所以"搜代码"永远搜不到它——只有"锁住我们走哪条路"才咬得住。
//
// 本文件锁四件事：
//   ① **浏览器里不走页面的 fetch**：页面的 fetch 被换过时，我们的请求一个字节都不经过它，
//      发出去的请求体里**只有我们自己写的那一条消息**；
//   ② ★**先证红**：同一个假补丁，只要显式把它当发送器（= 旧缺省行为），请求体里**真的会多出一条**——
//      证明①咬的是真东西，不是空绿；
//   ③ **两条路表现同形**：XHR 那条路上的超时/HTTP 错/空回复，与 fetch 那条路逐项一致
//      （超时必须是**人话** + `sw2Timeout` + `cause.name='AbortError'`，且不被判成可重试的瞬时错）；
//   ④ **Node 侧零扰动**：没有 `XMLHttpRequest` 的环境（demo / scripts / 判据）仍走原生 fetch。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpTransport, pageFetchLooksPatched } from '../src/transport-http.js';
import { isTransientCallError } from '../src/abstract.js';

// ---------- 假件 ----------

/** 照本机实测那个补丁的形状写：解析请求体 → 往 messages 里插一条"外来记忆" → 再发出去。 */
function makePatchedFetch() {
    const calls = [];
    const patched = async (url, init) => {
        const body = JSON.parse(init.body);
        body.messages.splice(1, 0, { role: 'system', name: 'SYSTEM (向量化)', content: '【外来的记忆】玉爪儿是灵兽' });
        calls.push({ url, body: JSON.stringify(body) });
        return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }) };
    };
    return { patched, calls };
}

/** 假 XHR：够本文件用（open/setRequestHeader/send/abort + 四个回调）。`plan` 决定这次怎么回。 */
function makeFakeXHR(plan = () => ({ status: 200, text: '' })) {
    const calls = [];
    class FakeXHR {
        constructor() { this.headers = {}; this.status = 0; this.responseText = ''; this.aborted = false; calls.push(this); }
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader(k, v) { this.headers[k] = v; }
        send(body) {
            this.body = body;
            const p = plan(this) || {};
            setTimeout(() => {
                if (this.aborted || p.hang) return;             // 挂住：只有 abort 能让它结束
                if (p.networkError) { this.onerror?.(); return; }
                this.status = p.status ?? 200;
                this.responseText = p.text ?? '';
                this.onload?.();
            }, 0);
        }
        abort() { this.aborted = true; this.onabort?.(); }
    }
    return { FakeXHR, calls };
}

/** 临时把"浏览器现场"装上（XMLHttpRequest / fetch），跑完原样还回去。 */
async function inFakeBrowser({ xhr, fetchImpl }, fn) {
    const hadXhr = Object.prototype.hasOwnProperty.call(globalThis, 'XMLHttpRequest');
    const prevXhr = globalThis.XMLHttpRequest;
    const prevFetch = globalThis.fetch;
    globalThis.XMLHttpRequest = xhr;
    if (fetchImpl) globalThis.fetch = fetchImpl;
    try { return await fn(); } finally {
        if (hadXhr) globalThis.XMLHttpRequest = prevXhr; else delete globalThis.XMLHttpRequest;
        globalThis.fetch = prevFetch;
    }
}

const base = { baseUrl: 'https://gw.example', apiKey: 'k-secret', model: 'm-9' };

// ---------- ① 浏览器里不走页面的 fetch ----------

test('★①页面的 fetch 被别的扩展换过时：我们的请求不经它，请求体里只有我们自己那一条消息', async () => {
    const { patched, calls: patchedCalls } = makePatchedFetch();
    const { FakeXHR, calls: xhrCalls } = makeFakeXHR(() => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }) }));
    await inFakeBrowser({ xhr: FakeXHR, fetchImpl: patched }, async () => {
        const transport = createHttpTransport({ ...base });          // ★不给 fetchImpl —— 走缺省
        assert.equal(await transport('我们的提示词'), '{"a":1}');
    });
    assert.equal(patchedCalls.length, 0, '★★★那个被换过的 fetch **一次都不许被调用**（这就是"通道"本身）');
    assert.equal(xhrCalls.length, 1, '走的是 XMLHttpRequest（别人的补丁碰不到它）');
    const sent = JSON.parse(xhrCalls[0].body);
    assert.equal(sent.messages.length, 1, '★★请求体里只有我们写的那一条消息（没有被塞进外来记忆）');
    assert.equal(sent.messages[0].content, '我们的提示词');
    assert.equal(sent.messages[0].role, 'user');
    assert.equal(xhrCalls[0].url, 'https://gw.example/v1/chat/completions', '地址口径不变（/v1 自动补）');
    assert.equal(xhrCalls[0].headers.Authorization, 'Bearer k-secret');
    assert.equal(sent.model, 'm-9');
    assert.deepEqual(sent.response_format, { type: 'json_object' });
});

test('★②先证红：同一个假补丁，显式当发送器用（= 旧缺省写法）⇒ 请求体里真的多出一条外来消息', async () => {
    const { patched, calls } = makePatchedFetch();
    const transport = createHttpTransport({ ...base, fetchImpl: patched });   // 旧写法等价于这条
    await transport('我们的提示词');
    assert.equal(calls.length, 1, '旧写法下请求确实走了那个被换过的 fetch');
    const sent = JSON.parse(calls[0].body);
    assert.equal(sent.messages.length, 2, '★★这就是当年漏的那一条：多出来的 system 消息（外来记忆）');
    assert.match(sent.messages[1].content, /外来的记忆/, '多出来的那条装的是别人的记忆');
    // 对照：新写法（缺省）在同一个假补丁下**一条都不多**——见上一条判据
});

// ---------- ③ 两条路表现同形 ----------

test('★③XHR 路：非 2xx 抛错（带状态码与响应体），无 choices 返回空串', async () => {
    const err = makeFakeXHR(() => ({ status: 429, text: '{"error":"限流"}' }));
    await inFakeBrowser({ xhr: err.FakeXHR }, async () => {
        const t = createHttpTransport({ ...base });
        await assert.rejects(() => t('x'), (e) => e.message === 'HTTP 429' && e.status === 429 && e.bodySnippet.includes('限流'));
    });
    const empty = makeFakeXHR(() => ({ status: 200, text: '{}' }));
    await inFakeBrowser({ xhr: empty.FakeXHR }, async () => {
        assert.equal(await createHttpTransport({ ...base })('x'), '');
    });
});

test('★③XHR 路：超时也是**人话** + sw2Timeout + cause 名（与 fetch 路同形，不许又出那句英文）', async () => {
    const hang = makeFakeXHR(() => ({ hang: true }));                 // 永不回应：只有 abort 能让它结束
    await inFakeBrowser({ xhr: hang.FakeXHR }, async () => {
        const t = createHttpTransport({ ...base, timeoutMs: 30 });
        let seen = null;
        try { await t('x'); } catch (e) { seen = e; }
        assert.ok(seen, '必须抛错（不许静默返回空）');
        assert.match(String(seen.message), /超时/, `★状态条上要能读懂：${seen.message}`);
        assert.match(String(seen.message), /30ms/, '★人话里带真实的超时值');
        assert.ok(!/signal is aborted without reason/.test(String(seen.message)), '★不许把那句英文抛出去');
        assert.equal(seen.sw2Timeout, true, '★超时标志必须在（丢了就会被当成可重试的瞬时错 ⇒ 又等满一个超时）');
        assert.equal(seen.cause?.name, 'AbortError', '★原异常挂在 cause 上（照真 fetch 被中止时的形状）');
        assert.equal(isTransientCallError(seen), false, '★超时=止损，不许被判成可重试');
    });
});

test('★③XHR 路：连不上（网络层失败）要判成可重试的瞬时错，且说人话', async () => {
    const dead = makeFakeXHR(() => ({ networkError: true }));
    await inFakeBrowser({ xhr: dead.FakeXHR }, async () => {
        const t = createHttpTransport({ ...base });
        let seen = null;
        try { await t('x'); } catch (e) { seen = e; }
        assert.ok(seen, '连不上必须抛错');
        assert.match(String(seen.message), /连不上模型服务/, '人话（不是 "Failed to fetch"）');
        assert.notEqual(seen.sw2Timeout, true, '网络失败不是超时（不许打超时标志）');
        assert.equal(isTransientCallError(seen), true, '★链路断是可重试的瞬时错（与 abstract.js 那条既有口径一致）');
    });
});

test('★③XHR 路：max_tokens 规则与 fetch 路一致（默认 32768 / 可覆盖 / 0=不写）', async () => {
    const bodies = [];
    const cap = makeFakeXHR((x) => { bodies.push(JSON.parse(x.body)); return { status: 200, text: '{"choices":[{"message":{"content":"x"}}]}' }; });
    await inFakeBrowser({ xhr: cap.FakeXHR }, async () => {
        await createHttpTransport({ ...base })('p');
        await createHttpTransport({ ...base, maxTokens: 2048 })('p');
        await createHttpTransport({ ...base, maxTokens: 0 })('p');
    });
    assert.equal(bodies[0].max_tokens, 32768);   // ★leg157：与 `PROPOSED_CALL_LIMITS` 同源（16,384 → 32,768）
    assert.equal(bodies[1].max_tokens, 2048);
    assert.equal(bodies[2].max_tokens, undefined, '0=不写这一格');
});

// ---------- ④ Node 侧零扰动 ----------

test('★④没有 XMLHttpRequest 的环境（demo/scripts/判据）仍走原生 fetch', async () => {
    const hadXhr = Object.prototype.hasOwnProperty.call(globalThis, 'XMLHttpRequest');
    const prevXhr = globalThis.XMLHttpRequest;
    delete globalThis.XMLHttpRequest;
    try {
        let called = 0;
        const prevFetch = globalThis.fetch;
        globalThis.fetch = async () => { called += 1; return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
        try {
            assert.equal(await createHttpTransport({ ...base })('p'), 'ok');
        } finally { globalThis.fetch = prevFetch; }
        assert.equal(called, 1, 'Node 侧仍走原生 fetch（那边没有补丁这回事）');
    } finally {
        if (hadXhr) globalThis.XMLHttpRequest = prevXhr; else delete globalThis.XMLHttpRequest;
    }
});

// ---------- 通道自证：页面的 fetch 有没有被换过 ----------

test('★通道自证：只在浏览器里回答；原生 fetch 判"没被换"，被 JS 包一层判"被换"，没有 window 判"不知道"', () => {
    const prevFetch = globalThis.fetch;
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prevWindow = globalThis.window;
    try {
        assert.equal(pageFetchLooksPatched(), null, '★Node 侧 ⇒ null（"不适用"，不猜——Node 的 fetch 本来就是 JS 实现）');
        // 装一个"浏览器现场"：window 指回 globalThis（浏览器里 window === globalThis）
        globalThis.window = globalThis;
        // 拿一个**真的原生函数**冒充原生 fetch（Node 的 fetch/setTimeout 都是 JS 实现，
        // 打印出来不带 [native code]；浏览器里 window.fetch 是原生实现，带）
        globalThis.fetch = Math.max;
        assert.equal(pageFetchLooksPatched(), false, '原生形状（打印出来带 [native code]）⇒ 没被换过');
        globalThis.fetch = async function (...args) { return prevFetch.apply(this, args); };
        assert.equal(pageFetchLooksPatched(), true, '★被 JS 包了一层 ⇒ 如实判"被换过"（本机那个补丁就是这个形状）');
        delete globalThis.fetch;
        assert.equal(pageFetchLooksPatched(), null, '★连 fetch 都没有 ⇒ null（"不知道"，不猜）');
    } finally {
        globalThis.fetch = prevFetch;
        if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
    }
});

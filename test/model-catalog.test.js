// story-world-v2/test/model-catalog.test.js
//
// ★★★用户令（2026-09-27）：「**把获取模型列表（点击某一项自动填入模型id）和测试是否连通做一下**（设置那一页的）」。
//
// 这一份咬的是**取数那一半**（纯函数 ＋ 可注入 sender ⇒ Node 里真跑，不需要浏览器、不花真钱）：
//   · `modelsEndpoint` / `humanHttpError` / `listModels` / `probeModel`（全在 `src/transport-http.js`）。
// ★接线那一半（两枚按钮 ＋ 动作总线 ＋ 列表点一下填进输入框）在 `test/model-channel.test.js`。
//
// 口径纪律（本仓既有，逐条咬住）：
//   ① **地址只有一把尺**：`/models` 与 `/chat/completions` 必须同一个 `normalizeBase`——
//      不新立第二条地址口径（"同一件事两处口径"是本仓最贵的病）。
//   ② **失败要说人话**：页面上要印给玩家看 ⇒ 不许把 `HTTP 401` 原样扔出去就完事。
//   ③ **不改任何配置**：这两件事都只读回来一张清单 / 一句结论，填不填由玩家点。
//   ④ **探测不许带 `response_format`**：那不是所有模型都支持，带上会让"能连通的模型"被误判成不通。

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeBase, modelsEndpoint, humanHttpError, listModels, probeModel } from '../src/transport-http.js';

/** 假 sender：形状与真 fetch / `xhrSender` 一致（`{ok, status, text(), json()}`），并记下收到的请求。 */
function fakeSender(reply) {
    const seen = [];
    const send = async (url, init = {}) => {
        seen.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body ?? null });
        const r = typeof reply === 'function' ? reply(url, init) : reply;
        if (r instanceof Error) throw r;
        const text = typeof r?.text === 'string' ? r.text : JSON.stringify(r?.json ?? {});
        return {
            ok: r?.status >= 200 && r?.status < 300,
            status: r?.status ?? 200,
            text: async () => text,
            json: async () => JSON.parse(text),
        };
    };
    send.seen = seen;
    return send;
}

// ─────────── ① 地址只有一把尺 ───────────

test('★地址口径：`/models` 与 `/chat/completions` 同一个 `normalizeBase`（缺 /v1 自动补、末尾斜杠去掉）', () => {
    assert.equal(modelsEndpoint('https://a.example'), 'https://a.example/v1/models');
    assert.equal(modelsEndpoint('https://a.example/'), 'https://a.example/v1/models');
    assert.equal(modelsEndpoint('https://a.example/v1'), 'https://a.example/v1/models');
    assert.equal(modelsEndpoint('https://a.example/v1/'), 'https://a.example/v1/models');
    // ★咬住"同源"：`/models` 必须**逐字等于** base ＋ '/models'
    for (const b of ['https://a.example', 'https://a.example/v1/', 'http://127.0.0.1:8080/api']) {
        assert.equal(modelsEndpoint(b), `${normalizeBase(b)}/models`, `★${b} 那条不许另立地址口径`);
    }
});

test('`humanHttpError`：四种常见错各给一句人话（不印裸状态码了事）', () => {
    assert.match(humanHttpError(401), /密钥/);
    assert.match(humanHttpError(403), /密钥/);
    assert.match(humanHttpError(404), /地址/);
    assert.match(humanHttpError(429), /限流|频繁/);
    assert.match(humanHttpError(400), /模型/);
    assert.match(humanHttpError(503), /服务端/);
    // 拿不准的**必须带原始状态码**（不猜原因）
    assert.match(humanHttpError(418), /418/);
    // 服务端原话要带上（排障就靠它）
    assert.match(humanHttpError(401, 'invalid api key'), /invalid api key/);
});

// ─────────── ② 拉模型列表 ───────────

test('★`listModels` 真跑：OpenAI 兼容形状 `{data:[{id}]}` → 取出清单，且**不改任何配置**', async () => {
    const send = fakeSender({ status: 200, json: { data: [{ id: 'm-a' }, { id: 'm-b' }, { id: 'm-c' }] } });
    const opts = { baseUrl: 'https://a.example', apiKey: 'sk-x' };
    const before = JSON.stringify(opts);
    const r = await listModels({ ...opts, fetchImpl: send });
    assert.equal(r.ok, true);
    assert.deepEqual(r.models, ['m-a', 'm-b', 'm-c']);
    assert.equal(r.status, 200);
    assert.equal(r.error, null);
    assert.equal(JSON.stringify(opts), before, '★不许改调用方给的那份配置（填不填由玩家点）');
    // 请求形状：GET ＋ Bearer ＋ 打到 /v1/models
    assert.equal(send.seen.length, 1);
    assert.equal(send.seen[0].url, 'https://a.example/v1/models');
    assert.equal(send.seen[0].method, 'GET');
    assert.equal(send.seen[0].headers.Authorization, 'Bearer sk-x');
});

test('`listModels`：也认裸数组（有些网关不给 `{data:…}` 那一层）', async () => {
    const send = fakeSender({ status: 200, json: [{ id: 'only' }] });
    const r = await listModels({ baseUrl: 'https://a.example', apiKey: 'k', fetchImpl: send });
    assert.equal(r.ok, true);
    assert.deepEqual(r.models, ['only']);
});

test('`listModels` 四类失败都**如实出声**（不是静默返回空清单）', async () => {
    const cases = [
        [{ status: 401, text: '{"error":"invalid api key"}' }, /密钥/],
        [{ status: 404, text: 'not found' }, /地址/],
        [{ status: 200, text: '<html>oops</html>' }, /不是 JSON/],
        [{ status: 200, json: { data: [] } }, /一个模型名都没有/],
    ];
    for (const [reply, re] of cases) {
        const r = await listModels({ baseUrl: 'https://a.example', apiKey: 'k', fetchImpl: fakeSender(reply) });
        assert.equal(r.ok, false);
        assert.deepEqual(r.models, []);
        assert.match(r.error, re, `★这一类必须给对应的人话：${JSON.stringify(reply)}`);
    }
});

test('`listModels`：连不上 ⇒ 人话（带"连不上"三个字）', async () => {
    const r = await listModels({ baseUrl: 'https://a.example', apiKey: 'k', fetchImpl: fakeSender(new Error('连不上模型服务（network error）')) });
    assert.equal(r.ok, false);
    assert.match(r.error, /连不上/);
});

test('`listModels`：地址没填 ⇒ **一次请求都不发**（不拿空地址去撞）', async () => {
    const send = fakeSender({ status: 200, json: { data: [{ id: 'x' }] } });
    const r = await listModels({ baseUrl: '   ', apiKey: 'k', fetchImpl: send });
    assert.equal(r.ok, false);
    assert.match(r.error, /服务地址/);
    assert.equal(send.seen.length, 0, '★空地址不许发请求');
});

// ─────────── ③ 测连通 ───────────

test('★★`probeModel` 真跑：一次验三样（地址/密钥/模型号），报出耗时与回话', async () => {
    const send = fakeSender({ status: 200, json: { choices: [{ message: { content: 'pong' } }] } });
    const r = await probeModel({ baseUrl: 'https://a.example', apiKey: 'sk-x', model: 'm-a', fetchImpl: send });
    assert.equal(r.ok, true);
    assert.equal(r.reply, 'pong');
    assert.equal(r.status, 200);
    assert.ok(Number.isFinite(r.ms) && r.ms >= 0, '★必须报出耗时');
    const req = send.seen[0];
    assert.equal(req.url, 'https://a.example/v1/chat/completions');
    assert.equal(req.method, 'POST');
    const body = JSON.parse(req.body);
    assert.equal(body.model, 'm-a');
    assert.equal(body.messages[0].content, 'ping');
    assert.ok(body.max_tokens > 0 && body.max_tokens <= 32, '★探测要小（别拿真预算去测）');
});

test('★★`probeModel` **不许带 `response_format`**（带了会把"能连通的模型"误判成不通）', async () => {
    const send = fakeSender({ status: 200, json: { choices: [{ message: { content: '' } }] } });
    await probeModel({ baseUrl: 'https://a.example', apiKey: 'k', model: 'm', fetchImpl: send });
    const body = JSON.parse(send.seen[0].body);
    assert.equal(body.response_format, undefined, '★探测不带 JSON 模式（正式调用那一侧才带）');
});

test('`probeModel`：模型号不认识 / 密钥不对 / 连不上 ⇒ 各自的人话', async () => {
    const mk = (reply) => probeModel({ baseUrl: 'https://a.example', apiKey: 'k', model: 'm', fetchImpl: fakeSender(reply) });
    assert.match((await mk({ status: 400, text: '{"error":"model not found"}' })).error, /模型/);
    assert.match((await mk({ status: 401, text: 'nope' })).error, /密钥/);
    assert.match((await mk(new Error('连不上模型服务（network error）'))).error, /连不上/);
    // 失败也要报耗时（玩家据此判断"是秒回还是卡到超时"）
    assert.ok(Number.isFinite((await mk({ status: 500, text: 'boom' })).ms));
});

test('`probeModel`：地址或模型号没填 ⇒ **一次请求都不发**', async () => {
    const send = fakeSender({ status: 200, json: { choices: [{ message: { content: '' } }] } });
    assert.match((await probeModel({ baseUrl: '', apiKey: 'k', model: 'm', fetchImpl: send })).error, /服务地址/);
    assert.match((await probeModel({ baseUrl: 'https://a.example', apiKey: 'k', model: '  ', fetchImpl: send })).error, /世界模型/);
    assert.equal(send.seen.length, 0);
});

test('`probeModel`：回话是空的**也算通**（模型没话说 ≠ 连不上）', async () => {
    const send = fakeSender({ status: 200, json: { choices: [{ message: { content: '' } }] } });
    const r = await probeModel({ baseUrl: 'https://a.example', apiKey: 'k', model: 'm', fetchImpl: send });
    assert.equal(r.ok, true);
    assert.equal(r.reply, '');
});

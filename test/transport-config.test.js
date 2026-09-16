// story-world-v2/test/transport-config.test.js
// K30：设置→传输配置解析（浏览器适配套）。不联网：注入假 fetch。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveBrowserTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-config.js';
import { createEnvTransport } from '../src/transport-http.js';

test('K30 设置链：设置齐备 → 传输可用（source=settings，base 归一化 +v1）', async () => {
    let captured;
    const r = resolveBrowserTransport({
        baseUrl: 'https://gw.example',
        apiKey: 'k-settings',
        model: 'm-9',
        fetchImpl: async (url, opts) => {
            captured = { url, opts };
            return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":1}' } }] }) };
        },
    });
    assert.equal(r.source, 'settings');
    assert.equal(r.baseUrl, 'https://gw.example');
    assert.equal(r.model, 'm-9');
    const text = await r.transport('请输出 JSON');
    assert.equal(text, '{"ok":1}');
    assert.ok(captured.url.endsWith('/v1/chat/completions'), captured.url);
    assert.equal(captured.opts.headers.Authorization, 'Bearer k-settings');
});

test('K30 设置链：缺任一字段 → null（不建传输、不抛）', () => {
    assert.equal(resolveBrowserTransport({}), null);
    assert.equal(resolveBrowserTransport({ baseUrl: 'https://x', apiKey: 'k' }), null);
    assert.equal(resolveBrowserTransport({ baseUrl: 'https://x', model: 'm' }), null);
    assert.equal(resolveBrowserTransport({ apiKey: 'k', model: 'm' }), null);
    assert.equal(resolveBrowserTransport(null), null);
    assert.equal(resolveBrowserTransport(undefined), null);
});

// ★leg62：抽取预算独立抬到 32,768（**不再与主调用同值**）——本锁原口径是"两侧统一 16384"，
//   那个前提（两侧输出量同量级）已被 leg62 的设定面打破，详见 transport-http.test.js 那条长注释。
test('第十八棒 + E3 + leg62：抽取预算透传——maxTokens 参数进请求体；主调用默认仍 16384', async () => {
    let captured;
    const opts = { baseUrl: 'https://gw.example', apiKey: 'k', model: 'm', fetchImpl: async (url, o) => { captured = o; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; } };
    assert.equal(EXTRACTION_MAX_TOKENS, 32768, '★抽取预算 32,768（leg62：@16384 实测 finish_reason=length 截断）');
    await resolveBrowserTransport(opts, { maxTokens: EXTRACTION_MAX_TOKENS }).transport('p');
    assert.equal(captured.body.includes('"max_tokens":32768'), true, '抽取预算透传进请求体');
    await resolveBrowserTransport(opts).transport('p');
    assert.equal(JSON.parse(captured.body).max_tokens, 16384, '主调用默认**不动**：仍是 16384（leg62 没牵连它）');
});

test('K30 浏览器安全守卫：createEnvTransport 无参调用不抛（浏览器无 process）', () => {
    assert.doesNotThrow(() => createEnvTransport());
    assert.equal(createEnvTransport({}), null);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27：抽取档必须**显式声明**才生效（extraction: true）——同一份 settings 也用于主调用（演算），
//   不许在配置解析里悄悄把主调用也改成 5 分钟。
// 判据（两条都是**结构**的，不是字面的）：
//   ①抽取档只改超时预算，**请求体形状逐字节不变**（同模型同通道，超时不是给模型的参数）；
//   ②抽取档真的多活了——用"永挂 fetch + 短超时档"不可行（档位值写死在档里）⇒
//     用**同一份 settings 走两个档，分别撞一次真实超时**：主调用档必然在 120 s 前中止，抽取档要到 300 s
//     ⇒ 单测不可能等 300 s。故改用**可观测差异**：抽取档的传输在 120 s 时**尚未**中止。
//   实现：把 hang 的 fetch 做成"120 s 处自杀"的探针不可行（单测不许等 2 分钟）⇒
//     诚实做法：只锁"契约存在 + 请求体不变"，**并把"抽取档确实传到了 timeoutMs"交给 transport-http
//     的 EXTRACTION_TIMEOUT_MS 锁（那条已直接断言 300_000）**。这里不写假判据。
//   ★★leg62 修正（改这条之前先读）：原文写的是"抽取档**请求体逐字节不变**"——那个前提只在
//     "两侧同预算"时成立，而 leg62 把抽取侧抬到 32,768（主调用仍 16,384）⇒ `max_tokens` **本来就在请求体里**
//     ⇒ `captured.body` 必然不同，旧判据当场变红（这正是它该做的事：口径变了，锁必须跟着换）。
//     新判据把 `max_tokens` **控制住**（两条都显式传同一个值），再断言其余字段逐字节相同——
//     锁的仍是 leg27 那条真事："抽取档**只**改超时预算，不夹带别的改动"。
test('★leg27 + leg62：抽取档只改超时预算（**同一预算下**请求体逐字节不变），主调用档不受带偏', async () => {
    let captured = null;
    const opts = {
        baseUrl: 'https://gw.example', apiKey: 'k', model: 'm',
        fetchImpl: async (url, o) => { captured = o; return { ok: true, json: async () => ({ choices: [{ message: { content: 'x' } }] }) }; },
    };
    // 控制变量：两条都用**同一个显式预算**（否则比的是预算差异，不是"抽取档夹带私货"）
    const BUDGET = 16384;
    await resolveBrowserTransport(opts, { maxTokens: BUDGET }).transport('p');
    const mainBody = captured.body;
    captured = null;
    await resolveBrowserTransport(opts, { maxTokens: BUDGET, extraction: true }).transport('p');
    assert.equal(captured.body, mainBody, '同一预算下：抽取档只改超时预算，**不改请求体形状**（同模型同通道）');
    // ★反面对照（自证判据不是恒真）：真换了预算时，请求体**必须**跟着变——否则说明 max_tokens 根本没接线
    captured = null;
    await resolveBrowserTransport(opts, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true }).transport('p');
    assert.notEqual(captured.body, mainBody, '换预算必须反映进请求体（防"锁恒真"：接线断了这条会绿）');
    assert.equal(JSON.parse(captured.body).max_tokens, EXTRACTION_MAX_TOKENS, '抽取档预算如实进请求体');
    // 对照：两个档都必须建出可用传输（extraction 选项不认识时不许把它变成 null）
    assert.ok(resolveBrowserTransport(opts, { extraction: true }), 'extraction 选项不许破坏配置解析');
});

// 上面那条只能锁"档位存在"，锁不住"**接线真的用上了这个档**"——本仓血的教训（leg25 f：机制建好了、
// 接线从没生效、测试全绿）。故这里直接读**生产接线点**（`web/index.js` 的 init-world）锁住它。
test('★leg27：生产接线真的传了 extraction:true（防"档建好了、接线从没生效"）', () => {
    const web = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const call = web.match(/resolveBrowserTransport\([^)]*\)/g) || [];
    const extractCall = call.find((c) => c.includes('EXTRACTION_MAX_TOKENS'));
    assert.ok(extractCall, 'init-world 必须调 resolveBrowserTransport（抽取接线在位）');
    assert.match(extractCall, /extraction:\s*true/, '★抽取接线必须显式声明 extraction:true（否则超时仍蹭主调用的 120 s ⇒ 62 分钟/块归来）');
});
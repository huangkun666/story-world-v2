// story-world-v2/test/embed-channel.test.js
// ★★★leg152：**嵌入通道那一族**（接线层：设置读取 · 启用判据 · 读数行 · 每轮旁路）。
//
// ★这一族的病都是"安静地不干活"或"安静地花钱"，所以判据咬的是**状态与话**：
//   ① 没配齐 ⇒ 整层不启用（不是"用一半"，更不是拿空地址去打）；
//   ② ★"没相关"与"没索引"必须分得开（读数行四种状态各有各的话）；
//   ③ 旁路**同一时刻只跑一个**（不然两个回合撞在一起会重复嵌同一批）；
//   ④ 旁路失败**只报一句**、绝不改世界（加速层的本分）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readEmbedConfig, embedEnabled, embedReadoutLine, createEmbedChannelHub, EMBED_INPUTS, EMBED_DEFAULTS } from '../web/embed-channel.js';
import { renderSettingsHtml } from '../src/render.js';

test('C1：★读设置：没有的格一律留空（绝不替玩家编一个地址或模型号）', () => {
    const c = readEmbedConfig({});
    assert.deepEqual(c, { enabled: false, baseUrl: '', apiKey: '', model: '', dims: null, rowsPerRequest: null });
    assert.equal(embedEnabled(c), false, '三样都不齐 ⇒ 不启用');
    // ★`Number(null) === 0` 那个坑：空格子不许变成 0
    const c2 = readEmbedConfig({ embedDims: '', embedRowsPerRequest: null });
    assert.equal(c2.dims, null);
    assert.equal(c2.rowsPerRequest, null);
    // 填了才认
    const c3 = readEmbedConfig({ embedEnabled: true, embedBaseUrl: ' https://x/v1 ', embedApiKey: ' k ', embedModel: ' m ', embedDims: '1024', embedRowsPerRequest: '20' });
    assert.deepEqual(c3, { enabled: true, baseUrl: 'https://x/v1', apiKey: 'k', model: 'm', dims: 1024, rowsPerRequest: 20 });
    assert.equal(embedEnabled(c3), true);
    // 缺一样就不启用（"用一半"比"不用"更坏：它会拿半个配置去打真服务）
    assert.equal(embedEnabled({ ...c3, apiKey: '' }), false);
    assert.equal(embedEnabled({ ...c3, model: '' }), false);
    assert.equal(embedEnabled({ ...c3, baseUrl: '' }), false);
});

test('C2：★★读数行——"没配" / "还没嵌过" / "嵌过但欠账" / "上一轮失败" 四种话各不相同', () => {
    const off = embedReadoutLine({ enabled: false });
    assert.match(off, /没配/);
    assert.match(off, /世界照常跑/, '要说清"不启用不影响世界"（否则玩家以为坏了）');

    const none = embedReadoutLine({ enabled: true, count: 0, pending: 0 });
    assert.match(none, /还没嵌过/);
    assert.match(none, /滑出/, '要说清什么时候才会开始嵌（不是"坏了"）');

    const some = embedReadoutLine({ enabled: true, count: 73, pending: 12, dims: 1024, rowsPerRequest: 20, lastEmbedded: 3 });
    assert.match(some, /已嵌 73 件/);
    assert.match(some, /还欠 12 件/);
    assert.match(some, /1024 维/);
    assert.match(some, /一批 20 行/);
    assert.match(some, /上一轮补了 3 件/);

    const bad = embedReadoutLine({ enabled: true, count: 5, pending: 2, failed: 1, failureNote: 'HTTP 429' });
    assert.match(bad, /注意：上一轮失败：HTTP 429/, '★失败必须带原因（不许只说"失败"）');
});

test('C3：★旁路同一时刻只跑一个（两个回合撞在一起不许重复嵌同一批）', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    const hub = createEmbedChannelHub({
        getSettings: () => ({ embedEnabled: true, embedBaseUrl: 'https://x/v1', embedApiKey: 'k', embedModel: 'm' }),
        embedClientFactory: () => ({ embed: async () => [[1]] }),
        stepEmbedFor: async () => {
            calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 10));
            inFlight -= 1;
            return { embedded: 1, pending: 0, blockedWorld: false };
        },
        getStats: () => ({ count: 1, pending: 0 }),
    });
    const [a, b] = await Promise.all([hub.stepForTick({ world: {} }), hub.stepForTick({ world: {} })]);
    assert.equal(calls, 1, '★只许跑一个');
    assert.equal(maxInFlight, 1);
    assert.equal(a.embedded, 1);
    assert.deepEqual(b, { skipped: 'busy' }, '第二个该如实说"忙"（不是静默丢掉）');
});

test('C4：★没配齐 ⇒ 旁路静默返回（不报错：没配是正常状态）', async () => {
    const statuses = [];
    const hub = createEmbedChannelHub({
        getSettings: () => ({}),
        stepEmbedFor: async () => { throw new Error('不该被调到'); },
        getStats: () => ({}),
        onStatus: (m) => statuses.push(String(m)),
    });
    const r = await hub.stepForTick({ world: {} });
    assert.deepEqual(r, { skipped: 'disabled' });
    assert.deepEqual(statuses, [], '★没配不是错，不许刷状态条');
    assert.equal(hub.enabled(), false);
});

test('C5：★旁路出错 ⇒ 只报一句、绝不抛（加速层不许影响世界）', async () => {
    const statuses = [];
    const hub = createEmbedChannelHub({
        getSettings: () => ({ embedEnabled: true, embedBaseUrl: 'https://x/v1', embedApiKey: 'k', embedModel: 'm' }),
        embedClientFactory: () => ({ embed: async () => { throw new Error('ECONNRESET'); } }),
        stepEmbedFor: async () => { throw new Error('补嵌炸了'); },
        getStats: () => ({ count: 0, pending: 3 }),
        onStatus: (m) => statuses.push(String(m)),
    });
    const r = await hub.stepForTick({ world: {} });     // ★不抛
    assert.equal(r.blockedWorld, false);
    assert.match(statuses.join(''), /向量补嵌出错.*补嵌炸了/);
    assert.match(hub.line(), /上一轮失败：补嵌炸了/, '读数行也要带上原因');
});

test('C6：★体检走注入的那一口（本模块自己不认 HTTP）；没配齐时只给一句人话', async () => {
    // ★★★leg172：「量容量」那一半已随按钮/动作/函数整条撤掉（用户令：「没见过要用户来量一批几行的」）
    //   ⇒ 这条判据只留体检那一口；★并反向锁住"手动量容量那条路"不许回潮。
    const seen = [];
    const hub = createEmbedChannelHub({
        getSettings: () => ({ embedEnabled: true, embedBaseUrl: 'https://x/v1', embedApiKey: 'k', embedModel: 'm', embedDims: '1024' }),
        probeChannel: async (cfg) => { seen.push(['probe', cfg.baseUrl, cfg.dimensions]); return { ok: true, ms: 12, dims: 1024 }; },
        embedClientFactory: () => ({ embed: async () => [[1]] }),
        stepEmbedFor: async () => ({ embedded: 0 }),
        getStats: () => ({}),
    });
    const p = await hub.probe();
    assert.equal(p.ok, true);
    assert.deepEqual(seen[0], ['probe', 'https://x/v1', 1024]);
    assert.match(hub.line(), /1024 维/, '体检量到的维度要落进读数行');
    assert.equal(hub.measureCapacity, undefined, '★手动量容量那一口必须撤掉（不许回潮）');
    // 没配齐时那颗按钮只给一句人话（不许去打网络）
    const off = createEmbedChannelHub({ getSettings: () => ({}), getStats: () => ({}) });
    assert.match((await off.probe()).error, /先填齐/);
});

test('C7：设置格的 id 与出厂缺省是**导出常量**（改名字要两处一起改，判据在此咬住）', () => {
    assert.equal(EMBED_INPUTS.baseUrl, 'sw2_emb_base');
    assert.equal(EMBED_INPUTS.apiKey, 'sw2_emb_key');
    assert.equal(EMBED_INPUTS.model, 'sw2_emb_model');
    assert.ok(EMBED_DEFAULTS.model, '出厂模型号要有值（玩家可以改）');
    assert.ok(EMBED_DEFAULTS.baseUrl.startsWith('https://'));
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ★★★leg172（用户令：「**现在需要给记忆通道也添加一个获取模型列表**，还有把这个
//   **量一批几行的按钮去掉吧**，我用过这么多记忆插件没见过要用户来量一批几行的」）。
//   沿世界模型通道那套交互：用**记忆通道自己的地址与密钥**打 `/models`，点一项**只写 embedModel**，
//   手动输入照旧；取列表**不要求先填模型号**；两条通道的清单各自独立、互不覆盖。
// ═══════════════════════════════════════════════════════════════════════════════════

/** 假 sender（形状与真 fetch / `xhrSender` 一致，照 `test/model-channel.test.js` 那一份）。 */
function fakeSender(reply) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init });
        const text = typeof reply?.text === 'string' ? reply.text : JSON.stringify(reply?.json ?? {});
        return { ok: reply?.status ? reply.status < 300 : true, status: reply?.status ?? 200, text: async () => text, json: async () => JSON.parse(text) };
    };
    fn.calls = calls;
    return fn;
}

/** 搭一台记忆通道 hub（假窗口／假设置／假状态条／假写盘）。★模型号出厂留空（"先取列表再挑"是主路）。 */
function harness({ reply, settings = {} } = {}) {
    const seen = { wrote: [], status: [] };
    const store = { embedBaseUrl: 'https://embed.example/v1', embedApiKey: 'emb-key', ...settings };
    const nodes = {
        '#sw2_emb_models': { innerHTML: '' },
        '#sw2_emb_probe': { innerHTML: '' },
        '#sw2_emb_model': { value: String(store.embedModel || '') },
    };
    const sender = reply ? fakeSender(reply) : null;
    const hub = createEmbedChannelHub({
        getSettings: () => store,
        getWin: () => ({ querySelector: (sel) => nodes[sel] || null }),
        writeSetting: (k, v) => { seen.wrote.push([k, v]); store[k] = v; },
        setStatus: (l) => seen.status.push(String(l)),
        fetchImpl: sender,
        stepEmbedFor: async () => ({ embedded: 0 }),
        getStats: () => ({}),
    });
    return { hub, seen, nodes, store, sender };
}

test('连接测试即时显示等待与成功，重绘保留结果，重复点击只发一次请求', async () => {
    const probeNode = { innerHTML: '' }, statuses = [];
    let resolve, calls = 0;
    const hub = createEmbedChannelHub({
        getSettings: () => ({ embedBaseUrl: 'https://embed.example/v1', embedApiKey: 'secret', embedModel: 'embed-a' }),
        getWin: () => ({ querySelector: (s) => s === '#sw2_emb_probe' ? probeNode : null }),
        setStatus: (s) => statuses.push(s),
        probeChannel: () => { calls++; return new Promise((r) => { resolve = r; }); },
    });
    const first = hub.probe();
    assert.match(probeNode.innerHTML, /正在测试/, '点下去马上看见等待状态');
    const second = hub.probe();
    assert.equal(calls, 1, '等待时重复点击不重复请求');
    resolve({ ok: true, dims: 1024, ms: 120 });
    await Promise.all([first, second]);
    assert.match(probeNode.innerHTML, /连通.*embed-a.*1024 维/);
    assert.match(hub.renderState().embedProbe.line, /1024 维/);
    assert.match(statuses.at(-1), /连通/);
    assert.ok(!probeNode.innerHTML.includes('secret'));
});

test('连接测试缺配置与请求异常都显示原因并允许再次测试', async () => {
    const node = { innerHTML: '' }, settings = {};
    let calls = 0;
    const hub = createEmbedChannelHub({
        getSettings: () => settings,
        getWin: () => ({ querySelector: (s) => s === '#sw2_emb_probe' ? node : null }),
        probeChannel: async () => { calls++; throw new Error('服务暂时不可用'); },
    });
    assert.equal((await hub.probe()).ok, false);
    assert.match(node.innerHTML, /先填齐/);
    assert.equal(calls, 0);
    Object.assign(settings, { embedBaseUrl: 'https://embed.example/v1', embedApiKey: 'key', embedModel: 'embed-a' });
    assert.equal((await hub.probe()).ok, false);
    assert.match(node.innerHTML, /服务暂时不可用/);
    await hub.probe();
    assert.equal(calls, 2, '失败后不留下忙状态');
});

test('C8：★★★取记忆通道的模型列表——GET 发往**记忆地址**、带**记忆密钥**；模型号空着也照取', async () => {
    const { hub, seen, nodes, sender } = harness({ reply: { status: 200, json: { data: [{ id: 'embed-a' }, { id: 'embed-b' }] } } });
    assert.equal(hub.enabled(), false, '前置：模型号空着 ⇒ 这一族还没"启用"（但取列表**不该**被它挡住）');
    const r = await hub.listModelsAction();
    assert.equal(r.ok, true);
    assert.equal(sender.calls.length, 1, '★只发一次');
    assert.equal(sender.calls[0].url, 'https://embed.example/v1/models', '★★★必须发往**记忆通道自己的**地址');
    assert.equal(sender.calls[0].init.method, 'GET');
    assert.equal(String(sender.calls[0].init.headers.Authorization), 'Bearer emb-key',
        '★★必须用**记忆通道自己的**密钥（借用世界模型那把 = 两条通道串线）');
    assert.deepEqual(hub.renderState().embedCatalog.models, ['embed-a', 'embed-b']);
    assert.match(hub.renderState().embedCatalog.note, /取到 2 个模型/);
    assert.match(nodes['#sw2_emb_models'].innerHTML, /data-action="pick-embed-model" data-model="embed-b"/,
        '★清单必须**真的画进那一块**（不是只改了内存里的状态）');
    assert.equal(seen.wrote.length, 0, '★取列表**一个字都不写进设置**（填不填由玩家点）');
    assert.match(seen.status[0], /正在取/);
});

test('C9：★取列表失败 ⇒ 印**人话并带原因**，且**不碰**已填的模型号', async () => {
    const { hub, seen, nodes } = harness({ reply: { status: 401, text: '{"error":"bad key"}' }, settings: { embedModel: 'keep-me' } });
    const r = await hub.listModelsAction();
    assert.equal(r.ok, false);
    assert.equal(hub.renderState().embedCatalog.models.length, 0);
    assert.match(hub.renderState().embedCatalog.note, /取不到模型列表/);
    assert.match(hub.renderState().embedCatalog.note, /密钥/, '★原因要印出来（不许只说"取不到"）');
    assert.match(nodes['#sw2_emb_probe'].innerHTML, /密钥/, '★那句人话要真的印到页上');
    assert.match(seen.status.at(-1), /取不到模型列表/);
    assert.deepEqual(seen.wrote, [], '★★失败不许写任何设置（已填的模型号原样留着）');
    assert.equal(nodes['#sw2_emb_model'].value, 'keep-me');
});

test('C10：★★点清单里某一项 ⇒ **只写 embedModel** ＋ 就地换掉那个输入框（不重画整页）', () => {
    const { hub, seen, nodes, store } = harness({ settings: { embedModel: 'old-model' } });
    const r = hub.pickModelAction('embed-b');
    assert.equal(r.ok, true);
    assert.deepEqual(seen.wrote, [['embedModel', 'embed-b']],
        '★★只写 embedModel 这一格（不许顺手写世界模型 / 维度 / 批量）');
    assert.equal(nodes['#sw2_emb_model'].value, 'embed-b', '★输入框必须**当场**变（不许等重画）');
    assert.match(seen.status.at(-1), /已填入向量模型：embed-b/);
    assert.equal(store.model, undefined, '★世界模型那一格一个字没动');
    // 空名 ⇒ 拒绝（不猜、不写）
    const before = seen.wrote.length;
    assert.equal(hub.pickModelAction('   ').ok, false);
    assert.equal(seen.wrote.length, before, '★空名不许写盘');
});

test('C11：★清单高亮跟着当前模型号走；整页重画（经 renderCfg 注入的那一格）之后清单仍在', async () => {
    const { hub, nodes } = harness({ reply: { status: 200, json: { data: [{ id: 'embed-a' }] } }, settings: { embedModel: 'embed-a' } });
    await hub.listModelsAction();
    assert.match(nodes['#sw2_emb_models'].innerHTML, /sw2-model-cur[^>]*>embed-a</, '★当前那一个要高亮');
    assert.match(nodes['#sw2_emb_probe'].innerHTML, /取到 1 个模型/);
    // ★整页重画那一路：渲染层不持状态，清单由 `renderCfg()` 摊进 config ⇒ 重画后照样画出来
    const html = renderSettingsHtml({ chronicle: [] }, { config: { ...hub.renderState(), embedModel: 'embed-a' } });
    assert.match(html, /data-action="pick-embed-model" data-model="embed-a"/,
        '★整页重画之后清单仍要画出来（状态住在 hub 里，不在 DOM 里）');
});

test('C12：★模型名带引号/尖括号 ⇒ 文本与属性都要转义（不许掐断 markup）', async () => {
    const { hub, nodes } = harness({ reply: { status: 200, json: { data: [{ id: 'a"b<c>' }] } } });
    await hub.listModelsAction();
    const html = nodes['#sw2_emb_models'].innerHTML;
    assert.ok(!/data-model="a"b/.test(html), '★裸引号不许进属性（会掐断 markup）');
    assert.match(html, /a&quot;b&lt;c&gt;/, '★文本里的尖括号要转义（照既有规则）');
    assert.match(html, /data-action="pick-embed-model"/);
});

test('C13：★★设置页：记忆通道卡那两颗按钮换成「获取模型列表」＋「测试连通」；"量一批几行"整条撤掉', () => {
    const html = renderSettingsHtml({ chronicle: [] }, { config: { embedBaseUrl: 'https://embed.example/v1', embedApiKey: 'k', embedModel: 'embed-a' } });
    assert.match(html, /data-action="list-embed-models"/, '★「获取模型列表」那枚按钮必须在记忆通道卡上');
    assert.match(html, /data-action="probe-embed"/, '★「测试连通」照旧');
    assert.ok(!/data-action="measure-embed-rows"/.test(html),
        '★★手动量容量的入口必须撤掉（用户令：没见过要用户来量一批几行的）');
    assert.ok(!html.includes('量一批几行'), '★按钮的字面量也不许留在玩家眼前');
    assert.match(html, /id="sw2_emb_models"/, '★清单容器必须在（否则接线层无处可画）');
    assert.match(html, /id="sw2_emb_probe"/, '★结论行容器必须在');
});

test('C14：★★★真装配（`createEmbedWiring`）：三枚动作真有人接、取列表走记忆地址、点选只写 embedModel', async () => {
    const { createEmbedWiring } = await import('../web/settings-channels.js');
    const store = { embedBaseUrl: 'https://embed.example/v1', embedApiKey: 'emb-key', baseUrl: 'https://world.example/v1', apiKey: 'world-key', model: 'world-model' };
    const seen = { wrote: [], status: [] };
    const nodes = { '#sw2_emb_models': { innerHTML: '' }, '#sw2_emb_probe': { innerHTML: '' }, '#sw2_emb_model': { value: '' } };
    const sender = fakeSender({ status: 200, json: { data: [{ id: 'embed-a' }] } });
    const wiring = createEmbedWiring({
        indexStore: { load: async () => null, save: async () => {} },
        getSettings: () => store,
        writeSetting: (k, v) => { seen.wrote.push([k, v]); store[k] = v; },
        getWin: () => ({ querySelector: (sel) => nodes[sel] || null }),
        onStatus: (m) => seen.status.push(String(m)),
        channelDeps: { fetchImpl: sender },
    });
    assert.equal(typeof wiring.actions['list-embed-models'], 'function', '★「获取模型列表」必须真有人接');
    assert.equal(typeof wiring.actions['pick-embed-model'], 'function', '★点清单必须真有人接');
    assert.equal(typeof wiring.actions['probe-embed'], 'function', '★「测试连通」照旧');
    assert.equal(wiring.actions['measure-embed-rows'], undefined, '★手动量容量那条动作必须撤掉（画了没人接 = 死动作）');
    const r = await wiring.actions['list-embed-models']();
    assert.equal(r.ok, true);
    assert.equal(sender.calls[0].url, 'https://embed.example/v1/models', '★真装配这一路也必须发往记忆地址');
    assert.equal(nodes['#sw2_emb_model'].value, '', '★取列表不许替玩家选模型');
    const p = wiring.actions['pick-embed-model']({ model: 'embed-a' });
    assert.equal(p.ok, true);
    assert.deepEqual(seen.wrote, [['embedModel', 'embed-a']], '★★点选只写 embedModel（世界模型那一格原样）');
    assert.equal(nodes['#sw2_emb_model'].value, 'embed-a');
});

test('C15：★接线层把记忆通道 hub 的渲染态摊进 `renderCfg()`（否则整页重画会把清单吞掉）', () => {
    const index = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    assert.match(index, /embedChannel\?\.renderState\?\.\(\)/,
        '★renderCfg 必须把 hub 那一格摊进 config（渲染层不持状态 ⇒ 重画后清单还在）');
});

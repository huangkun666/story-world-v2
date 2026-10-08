// story-world-v2/test/model-channel.test.js
//
// ★★★用户令（2026-09-27）：「**把获取模型列表（点击某一项自动填入模型id）和测试是否连通做一下**（设置那一页的）」。
//
// 这一份咬**接线那一半**（`web/model-channel.js` ＋ `src/render.js` 的设置页）——
// 取数那一半在 `test/model-catalog.test.js`（纯函数，已在那边真跑过）。
//
// 本仓纪律（逐条咬住）：
//   ① **接线必须有测试**：要真 ctx 的接线，要么提成可导出函数真跑，要么写注入 fake 的测试
//      ⇒ 这里走"注入 fake"那条（假 sender / 假设置 / 假状态条 / 假重画）。
//   ② **画了按钮就必须有人接**：三枚新动作必须真的在 `window.__sw2Actions` 上注册
//      （设置页的例外白名单只有 `advance-world` 一个 ⇒ 新按钮不许走纯 DOM 属性那条捷径）。
//   ③ **渲染层不持状态**：清单与结论住在 hub 里，由 `renderCfg()` 摊进 config。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModelChannelHub, sw2NormalizeNumericSetting, extractChunkCharsOf, SETTINGS_INPUTS } from '../web/model-channel.js';
import { SETTING_CHUNK_CHAR } from '../src/abstract-limits.js';
import { renderSettingsHtml } from '../src/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** 假 sender（形状与真 fetch / `xhrSender` 一致）。 */
const fakeSender = (reply) => async () => {
    const text = typeof reply?.text === 'string' ? reply.text : JSON.stringify(reply?.json ?? {});
    return { ok: reply?.status >= 200 && reply?.status < 300, status: reply?.status ?? 200, text: async () => text, json: async () => JSON.parse(text) };
};

/** 搭一台带假依赖的 hub，并记下它都干了什么。★假窗口要能 `querySelector` 到那三个节点。 */
function harness({ reply, settings = { baseUrl: 'https://a.example', apiKey: 'sk-x', model: 'm-a' } } = {}) {
    const seen = { wrote: [], status: [] };
    const nodes = {
        '#sw2_models': { innerHTML: '' },
        '#sw2_probe': { innerHTML: '' },
        '#sw2_model': { value: 'm-a' },
    };
    const win = { querySelector: (sel) => nodes[sel] || null };
    const hub = createModelChannelHub({
        getWin: () => win,
        getSettings: () => settings,
        writeSetting: (k, v) => seen.wrote.push([k, v]),
        setStatus: (l) => seen.status.push(l),
        fetchImpl: reply ? fakeSender(reply) : null,
    });
    return { hub, seen, nodes };
}

// ─────────── ① 三枚动作真的进了总线（画了按钮就必须有人接） ───────────

test('★★三枚新动作**真的注册进动作总线**（设置页的例外白名单只有 advance-world 一个）', () => {
    // ★★★leg152：这一族的**注册与装配**曾搬进 `web/settings-channels.js`；★leg156 随记忆层
    //   整族撤走而**回到 `web/index.js`**（用户令：稳定版不带没验过的功能）。
    //   ⇒ 判据指回本家，且**两头都咬**：这里必须真注册、别处不许留第二份。
    //   ★★口径（本仓第 N 次复发的那条）：**按"整行原文"咬、不用正则**——本判据自己那行
    //     源码里就写着 `'pick-model':\s*\(\)\s*=>` 这个**字面**，用正则去扫会**扫到自己**、
    //     报出一条假红（"词面代替语义"，`test/pack-fit.test.js` 与 `entity-window.test.js` 都留过档）。
    const index = read('web/index.js');
    const lines = index.split('\n').map((l) => l.trim());
    const wire = {
        'list-models': `'list-models': () => modelChannel.listModelsAction(),`,
        'probe-model': `'probe-model': () => modelChannel.probeModelAction(),`,
        'pick-model': `'pick-model': (payload) => modelChannel.pickModelAction(payload?.model),`,
    };
    for (const [a, exact] of Object.entries(wire)) {
        assert.ok(lines.includes(exact), `★「${a}」必须真的注册（否则那枚按钮画了没人接）：应有整行 ${exact}`);
        assert.ok(!new RegExp(`bus\\['${a}'\\]\\s*=`).test(index), `★不许两处各写一份：「${a}」`);
    }
    assert.match(index, /createModelChannelHub\(\{/, '★必须真的装配了（不是只写几个空壳动作）');
    assert.match(index, /Object\.assign\(bus,\s*\{/, '★注册出来的动作必须真进总线');
    // ★搬家的两头都要咬：老地方不许留第二份
    assert.ok(!/function bindSettingsForm\(/.test(index), '★设置表单那一族必须真的搬走（web/index.js 里不许留第二份）');
});

test('★hub 的渲染态经 `renderCfg()` 注入（渲染层不持状态）', () => {
    const index = read('web/index.js');
    assert.match(index, /modelChannel\?\.renderState\?\.\(\)/, '★renderCfg 必须把 hub 那两格摊进 config');
});

// ─────────── ② 拉模型列表 ───────────

test('★★`listModelsAction`：取到清单 ⇒ **只原地换那一块**；**一个字都不写进设置**', async () => {
    const { hub, seen, nodes } = harness({ reply: { status: 200, json: { data: [{ id: 'm-a' }, { id: 'm-b' }] } } });
    const r = await hub.listModelsAction();
    assert.equal(r.ok, true);
    assert.deepEqual(hub.renderState().modelCatalog.models, ['m-a', 'm-b']);
    assert.match(hub.renderState().modelCatalog.note, /取到 2 个模型/);
    assert.match(nodes['#sw2_models'].innerHTML, /data-action="pick-model" data-model="m-b"/,
        '★清单必须**真的画进了那一块**（不是只改了内存里的状态）');
    assert.equal(seen.wrote.length, 0, '★取列表**不许写任何设置**（填不填由玩家点）');
    assert.match(seen.status[0], /正在取/);
});

test('`listModelsAction`：失败 ⇒ 那一格印**人话**（不是静默空清单）', async () => {
    const { hub, seen, nodes } = harness({ reply: { status: 401, text: '{"error":"bad key"}' } });
    const r = await hub.listModelsAction();
    assert.equal(r.ok, false);
    assert.equal(hub.renderState().modelCatalog.models.length, 0);
    assert.match(hub.renderState().modelCatalog.note, /密钥/);
    assert.match(nodes['#sw2_probe'].innerHTML, /密钥/, '★那句人话要真的印到页上');
    assert.match(seen.status.at(-1), /取不到模型列表/);
});

test('★★★不许重画整页（实机"点了要等几秒"的根因就在这儿）', () => {
    // 病（用户 2026-09-27 实机报「点了模型不是没换，是换的很慢要延迟几秒」）：
    //   点按钮 ⇒ **焦点留在按钮上** ⇒ `playerIsTouchingParams()` 为真 ⇒ `refreshSections` 的
    //   "押后"闸把整页重绘推到**失焦之后**才补 ⇒ 手感就是"点了没反应 / 几秒后才变"。
    // ★本仓自己记过这个坑（`web/index.js:404-407`）：注入开关试过"给自己发重绘通行证"，实机没解决；
    //   走通的正解是"**不重画整页，只原地改那一块自己的 DOM**"。⇒ 这条判据把它钉死。
    const hub = read('web/model-channel.js');
    const index = read('web/index.js');
    // ★口径要窄（本仓老毛病：**词面代替语义**——第一版这条判据连我自己写的留档注释都算了进去，当场假红）：
    //   去掉注释再找**调用**，且找的是"真的调了一次"那个形状。
    const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/refreshSections\s*\(/.test(codeOnly(hub)),
        '★★新家**不许**调 `refreshSections`（那就是重画整页，会被押后闸推到失焦之后）');
    //   ★第二版又假红一次（同一个病）：`/refreshSettings/` 咬到了 `refreshSettingsHints`（另一个函数，
    //     名字里含这个子串）⇒ 定稿咬**那个依赖键本身**（`refreshSettings:`）。
    assert.ok(!/refreshSettings\s*:/.test(codeOnly(index)),
        '★接线层也不许再给 hub 递"重画"那一口（递了就等于留着那条慢路）');
    assert.match(hub, /function paint\(\)/, '★必须有"只换那两块"的那一口');
    assert.match(codeOnly(hub), /querySelector\('#sw2_models'\)/, '★清单那块按 id 找');
    assert.match(codeOnly(hub), /querySelector\('#sw2_probe'\)/, '★结论那块按 id 找');
});

test('★★`pickModelAction`：**就地写进输入框**（不重画 ⇒ 点一下立刻见效）', () => {
    const { hub, seen, nodes } = harness();
    const r = hub.pickModelAction('gemini-3.1-pro-preview');
    assert.equal(r.ok, true);
    assert.equal(nodes['#sw2_model'].value, 'gemini-3.1-pro-preview', '★★输入框必须**当场**变成点的那一个');
    assert.deepEqual(seen.wrote, [['model', 'gemini-3.1-pro-preview']], '★写的必须是 model 那一格');
    assert.match(seen.status.at(-1), /已填入世界模型：gemini-3\.1-pro-preview/);
});

test('★★★leg157：点一个**自己报了输出上限**的模型 ⇒ 顺手把「单轮输出上限」填好；报不到 ⇒ 一个字都不写', async () => {
    // 用户令（逐字）：「**能直接读的话那就直接读呗，没有就默认32768就这样**」。
    //   ⇒ 两条口径一条都不许少：① 报了 → 用**它报的那个数**（不是我猜的）；② 没报 → **一个字都不写**
    //   （那一格回出厂值），并且**如实说清是哪一种**（本仓最忌"没填"与"读了但没报"长得一样）。
    const { hub, seen, nodes } = harness({
        reply: { status: 200, json: { data: [{ id: 'm-a', max_output_tokens: 65536 }, { id: 'm-b' }] } },
    });
    nodes['#sw2_call_tokens'] = { value: '32768' };      // 那个框在生产里是在的（按 id 找）
    await hub.listModelsAction();
    assert.match(hub.renderState().modelCatalog.note, /其中 1 个自己报了输出上限/, '★读到了几个要在面板上说清');

    // ① 报了 ⇒ 模型名与输出上限**一起**写下去，框也当场换掉
    const r1 = hub.pickModelAction('m-a');
    assert.deepEqual(seen.wrote.slice(-2), [['model', 'm-a'], ['callMaxTokens', 65536]],
        '★★声明的输出上限必须**真写进设置**（不然"读了"等于没读）');
    assert.equal(nodes['#sw2_call_tokens'].value, '65536', '★那个框要**当场**变（不许等重画）');
    assert.match(seen.status.at(-1), /65536/, '★状态条要说清按什么填的');
    assert.equal(r1.maxTokens, 65536);

    // ② 没报 ⇒ **只写模型名**，那一格一个字都不许动
    const before = seen.wrote.length;
    const r2 = hub.pickModelAction('m-b');
    assert.deepEqual(seen.wrote.slice(before), [['model', 'm-b']], '★没报 ⇒ 只写模型名（不猜、不填默认值）');
    assert.equal(nodes['#sw2_call_tokens'].value, '65536', '★那一格保持原样（没被回写）');
    assert.equal(r2.maxTokens, null);
    assert.match(seen.status.at(-1), /没报输出上限/, '★要说清"它没报"，不许静默');

    // ③ 声明值越界（超出那一格能填的范围）⇒ 也不写，且与"没报"分开说
    const { hub: h2, seen: s2 } = harness({ reply: { status: 200, json: { data: [{ id: 'm-z', max_output_tokens: 999999 }] } } });
    await h2.listModelsAction();
    h2.pickModelAction('m-z');
    assert.deepEqual(s2.wrote, [['model', 'm-z']], '★越界的声明值不许写进去（归一那一步拦）');
    assert.match(s2.status.at(-1), /超出/, '★"超出范围"与"没报"是两件事，分开说');
});

// ─────────── ③ 测试连通 ───────────


test('★★`probeModelAction`：成功结论在实际渲染结果中说明正式抽取 JSON 参数未验证', async () => {
    const { hub, seen, nodes } = harness({ reply: { status: 200, json: { choices: [{ message: { content: 'pong!!' } }] } } });
    const r = await hub.probeModelAction();
    assert.equal(r.ok, true);
    const line = hub.renderState().modelProbe.line;
    assert.equal(hub.renderState().modelProbe.ok, true);
    // ★★★leg166：这一条原来咬 `/✓ 通/`——那一枚 ✓ 是**玩家可见的 emoji**，
    //   本笔按用户令「emoji 不要了」（leg165 的"全清"口径）把它从产出里撤掉了。
    //   ★口径**一个字没放宽**：仍是"结论行要报出通了 ＋ 哪个模型 ＋ 耗时"三件事，只是不再靠一枚对勾说"通了"
    //     （"通了"由这一行自己的存在 ＋ `modelProbe.ok` 说；见下面那三条断言）。
    assert.match(line, /通/);
    assert.match(line, /m-a/, '★要报出测的是哪个模型');
    assert.match(line, /秒/, '★要报出耗时');
    assert.match(line, /正式抽取.*JSON 参数.*未验证/, '★成功行须限定最小请求没有验证正式抽取参数');
    assert.match(nodes['#sw2_probe'].innerHTML, /通.*m-a.*秒.*正式抽取.*JSON 参数.*未验证/,
        '★生产 hub 的成功结果必须把限定显示在实际渲染区域，而不是仅写在按钮 title');
    assert.ok(!/回了几个字/.test(line), '★★不写模型返回文本长度（那是内部噪声）');
    assert.match(seen.status.at(-1), /连通/);
});

test('`probeModelAction`：不通 ⇒ 那一行是人话，且**状态条也出声**（不静默）', async () => {
    const { hub, seen } = harness({ reply: { status: 404, text: 'not found' } });
    const r = await hub.probeModelAction();
    assert.equal(r.ok, false);
    assert.equal(hub.renderState().modelProbe.ok, false);
    assert.match(hub.renderState().modelProbe.line, /地址/);
    assert.match(seen.status.at(-1), /连不通/);
});

// ─────────── ④ 点一下填进去 ───────────

test('★★`pickModelAction`：空名 ⇒ 拒绝（不猜、不写）', () => {
    const { hub, seen } = harness();
    const bad = hub.pickModelAction('   ');
    assert.equal(bad.ok, false);
    assert.equal(seen.wrote.length, 0, '★空名不许写盘');
});

// ─────────── ⑤ 渲染面（设置页真的画了这三样） ───────────

const CONFIG = { baseUrl: 'https://a.example', apiKey: 'sk', model: 'm-a' };

test('★★设置页：两枚按钮 ＋ 清单 ＋ 结论行（清单没取到时**整块不画**）', () => {
    const empty = renderSettingsHtml({ chronicle: [] }, { config: CONFIG });
    assert.match(empty, /data-action="list-models"/, '★「获取模型列表」那枚按钮必须在');
    assert.match(empty, /data-action="probe-model"/, '★「测试连通」那枚按钮必须在');
    assert.match(empty, /id="sw2_model"/, '★模型那一格照旧在（按钮是加在它旁边的）');
    assert.ok(!/data-action="pick-model"/.test(empty), '★没取到清单 ⇒ 一个模型项都不画（空着就是空着）');

    // ★★★leg166：两个夹具字符串里的 ✓ 撤掉（它们是**玩家可见的 emoji**，用户令「emoji 不要了」）。
    //   ★下面那条断言跟着改成咬**结论行正文**（`通 · m-a · 1.2 秒`）——它要证的事一个字没变：
    //     "结论行真的印到了渲染面上"，只是不再靠一枚对勾当锚点。
    const full = renderSettingsHtml({ chronicle: [] }, {
        config: { ...CONFIG, modelCatalog: { models: ['m-a', 'm-b'], note: '取到 2 个模型' }, modelProbe: { ok: true, line: '通 · m-a · 1.2 秒' } },
    });
    assert.match(full, /data-action="pick-model" data-model="m-a"/, '★清单里每一项都要能点（键名在 data-model 上）');
    assert.match(full, /data-action="pick-model" data-model="m-b"/);
    assert.match(full, /sw2-model-cur[^>]*>m-a</, '★当前那一个要高亮（玩家一眼看出现在用的是哪个）');
    assert.match(full, /通 · m-a · 1\.2 秒/, '★结论行要印出来');
    // ★口径要**窄**：设置页别处本来就有"字"（注入读数那句"注入了多少字"）⇒ 不许拿一个裸 `字` 去扫全页
    //   （本仓老毛病：词面代替语义）。咬的是**"回了几个字"这个形状**。
    assert.ok(!/回了\s*[\d,]+\s*个字/.test(full), '★渲染面上不许出现"回了几个字"');
});

test('★模型名带引号/尖括号 ⇒ 属性里**转义掉**（不许把 markup 掐断）', () => {
    const html = renderSettingsHtml({ chronicle: [] }, { config: { ...CONFIG, modelCatalog: { models: ['a"b<c>'] } } });
    assert.ok(!/data-model="a"b/.test(html), '★裸引号不许进属性（会掐断 markup）');
    assert.match(html, /data-action="pick-model"/);
});

// ─────────── ⑥ 那一族的旧行为一个字没丢（搬家的反向自证） ───────────

test('★搬走的那一族：数字校验口照旧（合法 ⇒ 整数；非法/越界 ⇒ null，绝不写 NaN）', () => {
    assert.equal(sw2NormalizeNumericSetting('callTimeoutSec', '120'), 120);
    assert.equal(sw2NormalizeNumericSetting('callTimeoutSec', ''), null);
    assert.equal(sw2NormalizeNumericSetting('callTimeoutSec', '-5'), null);
    assert.equal(sw2NormalizeNumericSetting('callTimeoutSec', '3.5'), null);
    assert.equal(sw2NormalizeNumericSetting('callTimeoutSec', '中文'), null);
    assert.equal(sw2NormalizeNumericSetting('callTimeoutSec', '601'), null, '★越界要拦');
    assert.equal(sw2NormalizeNumericSetting('没有这个键', '1'), null);
    assert.equal(SETTINGS_INPUTS.model, 'sw2_model', '★按 id 找键那张表照旧');
});

test('★`bindSettingsForm` 幂等：挂两次只挂一次（`dataset` 那道闩还在）', () => {
    let binds = 0;
    const fakeWin = { dataset: {}, addEventListener: () => { binds += 1; } };
    const hub = createModelChannelHub({ getWin: () => fakeWin });
    hub.bindSettingsForm();
    const after1 = binds;
    hub.bindSettingsForm();
    assert.ok(after1 >= 3, `★第一次要真的挂上（input/change/wheel 三条，实测 ${after1}）`);
    assert.equal(binds, after1, '★第二次必须早退（否则同一个窗口上会叠两份委托）');
});

// 真实表单委托配合可控的窗口和设置；只派发 input/change，不直接调用归一函数。
function settingsForm(key, initial) {
    const handlers = new Map();
    const settings = { [key]: initial };
    const writes = [];
    const statuses = [];
    const win = { dataset: {}, addEventListener: (type, fn) => handlers.set(type, fn) };
    const hub = createModelChannelHub({
        getWin: () => win, getSettings: () => settings,
        writeSetting: (k, value) => { writes.push([k, value]); settings[k] = value; },
        setStatus: line => statuses.push(line),
    });
    hub.bindSettingsForm();
    const submit = (type, value) => {
        assert.equal(typeof handlers.get(type), 'function', `真实 ${type} 委托必须已注册`);
        handlers.get(type)({ target: { value, getAttribute: name => name === 'data-settings' ? key : null } });
    };
    return { settings, writes, statuses, submit };
}

test('往事注入多少字通过真实表单委托保存现值，拒绝非法值且保留原值', () => {
    const key = 'retrievalMaxChars';
    const form = settingsForm(key, 1600);
    for (const type of ['input', 'change']) {
        for (const raw of ['1', '2700', '20000']) {
            const before = form.writes.length;
            form.submit(type, raw);
            assert.deepEqual(form.writes.at(-1), [key, Number(raw)], `${type} 应保存 ${raw}`);
            assert.equal(form.writes.length, before + 1);
            assert.equal(form.settings[key], Number(raw));
        }
        const kept = form.settings[key];
        const count = form.writes.length;
        for (const raw of ['', '0', '-1', '20001', '1.5', 'NaN']) {
            form.submit(type, raw);
            assert.equal(form.writes.length, count, `${type} 不应保存 ${raw}`);
            assert.equal(form.settings[key], kept);
            assert.match(form.statuses.at(-1), /往事注入多少字.*1–20000.*整数.*没有写入/);
        }
    }
});

test('相似度阈值通过真实表单委托保存小数，非法值提示小数范围且保留原值', () => {
    const key = 'retrievalMinScore';
    const form = settingsForm(key, 0.1);
    for (const type of ['input', 'change']) {
        for (const [raw, expected] of [['0', 0], ['0.31', 0.31], ['1', 1], ['0.314', 0.31]]) {
            const before = form.writes.length;
            form.submit(type, raw);
            assert.deepEqual(form.writes.at(-1), [key, expected], `${type} 应保存 ${raw}`);
            assert.equal(form.writes.length, before + 1);
            assert.equal(form.settings[key], expected);
        }
        const kept = form.settings[key];
        const count = form.writes.length;
        for (const raw of ['', '-0.01', '1.01', 'NaN']) {
            form.submit(type, raw);
            assert.equal(form.writes.length, count, `${type} 不应保存 ${raw}`);
            assert.equal(form.settings[key], kept);
            assert.match(form.statuses.at(-1), /相似度阈值.*0–1.*小数.*没有写入/);
            assert.ok(!form.statuses.at(-1).includes('整数'));
        }
    }
});

test('抽取每块字符数使用 Task 1 归一化默认值，并通过真实表单持久化安全正整数', () => {
    assert.equal(extractChunkCharsOf({}), SETTING_CHUNK_CHAR);
    assert.equal(sw2NormalizeNumericSetting('extractChunkChars', '10000'), 10000);
    assert.equal(sw2NormalizeNumericSetting('extractChunkChars', '1.5'), null);
    assert.equal(sw2NormalizeNumericSetting('extractChunkChars', '9007199254740992'), null);

    const form = settingsForm('extractChunkChars', SETTING_CHUNK_CHAR);
    for (const type of ['input', 'change']) {
        const before = form.writes.length;
        form.submit(type, '12000');
        assert.deepEqual(form.writes.at(-1), ['extractChunkChars', 12000]);
        assert.equal(form.writes.length, before + 1);
        assert.equal(form.settings.extractChunkChars, 12000);

        const kept = form.settings.extractChunkChars;
        const count = form.writes.length;
        for (const raw of ['', '0', '-1', '1.5', '9007199254740992']) {
            form.submit(type, raw);
            assert.equal(form.writes.length, count, `${type} 不应保存 ${raw}`);
            assert.equal(form.settings.extractChunkChars, kept);
            assert.match(form.statuses.at(-1), /抽取每块字符数.*整数.*没有写入/);
        }
    }
});

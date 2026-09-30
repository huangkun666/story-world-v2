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

import { createModelChannelHub, sw2NormalizeNumericSetting, SETTINGS_INPUTS } from '../web/model-channel.js';
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

// ─────────── ③ 测试连通 ───────────

test('★★`probeModelAction`：通了 ⇒ 结论行只有「通 · 模型 · 秒」——**不写"模型回了几个字"**（用户当场裁的）', async () => {
    const { hub, seen } = harness({ reply: { status: 200, json: { choices: [{ message: { content: 'pong!!' } }] } } });
    const r = await hub.probeModelAction();
    assert.equal(r.ok, true);
    const line = hub.renderState().modelProbe.line;
    assert.equal(hub.renderState().modelProbe.ok, true);
    assert.match(line, /✓ 通/);
    assert.match(line, /m-a/, '★要报出测的是哪个模型');
    assert.match(line, /秒/, '★要报出耗时');
    assert.ok(!/字/.test(line), '★★用户 2026-09-27 当场裁的：**不写"回了几个字"**（那是内部噪声）');
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

    const full = renderSettingsHtml({ chronicle: [] }, {
        config: { ...CONFIG, modelCatalog: { models: ['m-a', 'm-b'], note: '✓ 取到 2 个模型' }, modelProbe: { ok: true, line: '✓ 通 · m-a · 1.2 秒' } },
    });
    assert.match(full, /data-action="pick-model" data-model="m-a"/, '★清单里每一项都要能点（键名在 data-model 上）');
    assert.match(full, /data-action="pick-model" data-model="m-b"/);
    assert.match(full, /sw2-model-cur[^>]*>m-a</, '★当前那一个要高亮（玩家一眼看出现在用的是哪个）');
    assert.match(full, /✓ 通 · m-a · 1\.2 秒/, '★结论行要印出来');
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

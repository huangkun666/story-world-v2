// story-world-v2/test/web-volume-popup-layout.test.js
// ★★★leg104（A4）：**「旧卷展开住浮层」这一族的判据**。
//
// 病（体检捋出来的 A4，源码可证）：
//   旧 `bus['read-volume']` 把渲染好的卷段 `insertAdjacentHTML('afterbegin')` 到 `#sw2_view_chronicle`，
//   而编年页**每轮都会整块重绘**（`refreshWorld` / `refreshSections`）⇒ 展开的旧卷**被无声吞掉**；
//   而且展开之后**没有收起口**（只能刷新页面）。★同一形状的病本仓已经治过：`leg93c` 把链视图
//   从"插进页签"改成"挂 `document.body` 的浮层"，理由一模一样（只读的东西不该住进每轮重绘的活页面里）。
//
// ★★这一族的判据**跨三处同锁**（漏一处就是"浮层没接上 / 按钮是死的 / 病根还在"）：
//   ① 新模块（行为：喂假 document 真跑，★打产品真入口 `openVolumePopup` / `closeVolumePopup`）；
//   ② 渲染层产物（头里那枚「收起」真的在 ⇒ 否则浮层里没有关闭口）；
//   ③ 接线层（`bus['read-volume']` 真的改走浮层，且**反面**：不许再往编年页插）。
//
// 形态纪律（照 `world-replace-layout.test.js` 同一把尺）：剥注释后判源码；每条带前置/反向自证。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { VOLUME_MASK_ID, openVolumePopup, closeVolumePopup } from '../web/volume-popup.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
        .join('\n');
}

function bodyOfIn(src, sig, stops = ['\n    bus[', '\n    // ----------']) {
    const at = src.indexOf(sig);
    if (at < 0) return '';
    let end = src.length;
    for (const s of stops) {
        const i = src.indexOf(s, at + sig.length);
        if (i > 0 && i < end) end = i;
    }
    return src.slice(at, end);
}

const INDEX_CODE = stripComments(read('web/index.js'));

/** 假 document：够这族用（createElement / body / getElementById / keydown 记账 / remove）。 */
function makeFakeDoc() {
    const doc = {
        body: null,
        _keydown: [],
        createElement(tag) {
            const node = {
                tagName: tag, className: '', id: '', innerHTML: '', children: [], _on: {},
                appendChild(c) { c._parent = this; this.children.push(c); return c; },
                addEventListener(t, fn) { (this._on[t] = this._on[t] || []).push(fn); },
                fire(t, ev) { for (const fn of (this._on[t] || [])) fn(ev); },
                remove() {
                    if (this._parent) this._parent.children = this._parent.children.filter((x) => x !== this);
                    this._parent = null;
                    this._removed = true;
                },
            };
            return node;
        },
        getElementById(id) { return findById(doc.body, id); },
        addEventListener(t, fn, capture) { if (t === 'keydown') doc._keydown.push({ fn, capture }); },
        removeEventListener(t, fn) { if (t === 'keydown') doc._keydown = doc._keydown.filter((x) => x.fn !== fn); },
    };
    doc.body = doc.createElement('body');
    return doc;
}
function findById(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of node.children || []) { const r = findById(c, id); if (r) return r; }
    return null;
}

// ---------- ① 新家在盘上（零 import 的真叶子）＋ 接线层只 import 它 ----------
test('★leg104·VP①：`web/volume-popup.js` 在盘上、零 import、顶层零 DOM；接线层不定义、不 re-export', () => {
    assert.ok(existsSync(new URL('web/volume-popup.js', ROOT)), '★新模块必须在盘上');
    const vpCode = stripComments(read('web/volume-popup.js'));
    for (const n of ['openVolumePopup', 'closeVolumePopup']) {
        assert.match(vpCode, new RegExp(`export\\s+function\\s+${n}\\b`), `★\`${n}\` 必须在新家导出`);
        assert.ok(!new RegExp(`function\\s+${n}\\b`).test(INDEX_CODE), `★\`${n}\` 不许还在 \`web/index.js\` 里定义`);
    }
    const imports = [...vpCode.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0]);
    assert.equal(imports.length, 0, `★新家必须零 import（Node 侧可直接导入）；实际 ${imports.length} 条：${imports.join(' | ')}`);
    assert.ok(!/^\s*export\s*\{[^}]*\}\s*from\s/m.test(INDEX_CODE), '★接线层不许 re-export');
    assert.match(INDEX_CODE, /import\s*\{[^}]*openVolumePopup[^}]*\}\s*from\s*'\.\/volume-popup\.js'/,
        '★接线层必须从新家 import（消费者改指向新家）');
    // ★前置：本文件能 import 进来这件事本身就是"顶层零 DOM"的自证（Node 侧没有 document）
    assert.equal(typeof document, 'undefined', '前置：Node 侧本来就没有 document（所以"顶层零 DOM"这条才有意义）');
    assert.equal(VOLUME_MASK_ID, 'sw2_volume_mask', '★容器 id 一处定义（判据与接线层都从这里取）');
});

// ---------- ② 行为：开 / 收 / 重绘碰不到它（打产品真入口）----------
test('★★leg104·VP②：浮层挂在 `document.body` 上；★面板重绘碰不到它；收起 / 点空白 / ESC 三条路都收得掉', () => {
    const doc = makeFakeDoc();
    // 面板那个"每轮整块重绘"的页面先摆上（模拟编年页）
    const page = doc.createElement('div');
    page.id = 'sw2_view_chronicle';
    page.innerHTML = '旧内容';
    doc.body.appendChild(page);

    const html = '<div class="sw2-cv"><button data-action="volume-close">收起</button><div id="sw2_volume_read">卷一 的正文</div></div>';
    const mask = openVolumePopup(html, doc);
    assert.ok(mask, '★必须开出浮层（假 document 齐备）');
    assert.equal(doc.getElementById(VOLUME_MASK_ID), mask, '★容器 id 对得上（收起那条路按 id 找它）');
    assert.equal(mask._parent, doc.body, '★★必须挂 `document.body`（不在面板窗口里 ⇒ 面板关着也能看、重绘也碰不到）');
    assert.match(mask.className, /sw2-cv-mask/, '★复用链浮层那套壳（同一类东西同一种长相）');
    assert.ok(String(mask.children[0]?.innerHTML || '').includes('sw2_volume_read'), '★渲染产物原样进了壳里');

    // ★它治的那个病：面板把编年页**整块重绘**掉 ⇒ 浮层照旧在、内容照旧在
    page.innerHTML = '重绘之后的全新内容';
    assert.equal(doc.getElementById(VOLUME_MASK_ID), mask, '★★面板重绘**碰不到**浮层（这正是 A4 的病根所在）');
    assert.ok(String(mask.children[0]?.innerHTML || '').includes('卷一 的正文'), '★展开的卷段还在（旧实现这里已经没了）');

    // ★一次只留一层（开第二次 ⇒ 旧的先收）
    const mask2 = openVolumePopup(html, doc);
    assert.notEqual(mask2, mask, '前置：第二次开的是新的一层');
    assert.equal(doc.getElementById(VOLUME_MASK_ID), mask2, '★同一 id 只留一层');
    assert.ok(mask._removed, '★★旧的被收掉了（两个浮层各挂一条 ESC，叠着按一下会散架）');

    // ⓵ 头里那枚「收起」（浮层自己的委托：它挂在 body 上，走不到面板那条总线）
    mask2.fire('click', { target: { closest: (sel) => (sel === '[data-action="volume-close"]' ? {} : null) } });
    assert.equal(closeVolumePopup(doc), false, '★收掉之后再收 ⇒ 如实返回 false（不假装做了事）');
    assert.ok(!doc.getElementById(VOLUME_MASK_ID), '★那枚按钮真的收掉了它');

    // ⓶ 点空白（target 就是遮罩本身）
    const m3 = openVolumePopup(html, doc);
    m3.fire('click', { target: m3 });
    assert.ok(!doc.getElementById(VOLUME_MASK_ID), '★点空白也收得掉');

    // ⓷ ESC：收得掉 + `stopPropagation`（不许顺带把整个面板关掉）+ 监听随浮层摘掉
    openVolumePopup(html, doc);
    assert.equal(doc._keydown.length, 1, '前置：ESC 监听挂在 document 上（捕获阶段）');
    assert.equal(doc._keydown[0].capture, true, '★捕获阶段（与链浮层同一条纪律）');
    const esc = { key: 'Escape', stopped: false, stopPropagation() { this.stopped = true; }, preventDefault() {} };
    doc._keydown[0].fn(esc);
    assert.ok(esc.stopped, '★★必须 `stopPropagation`（否则面板那条"ESC 关整个窗口"会跟着一起触发）');
    assert.ok(!doc.getElementById(VOLUME_MASK_ID), '★ESC 收得掉');
    assert.equal(doc._keydown.length, 0, '★★ESC 监听必须随浮层一起摘掉（别在 document 上留一条）');

    // ★没有可用的 document（Node 里没喂）⇒ 不抛、如实返回 null
    assert.equal(openVolumePopup(html, null), null, '★问不到文档 ⇒ 什么都别做（绝不抛）');
    assert.equal(closeVolumePopup(null), false, '★同上：没得收 ⇒ 如实 false');
});

// ---------- ③ ★接线层那一头：改走浮层，且**不许**再往编年页插 ----------
test("★★leg104·VP③：`bus['read-volume']` 真的改走浮层（反面：不许再 `insertAdjacentHTML` 进编年页）", () => {
    const body = bodyOfIn(INDEX_CODE, "bus['read-volume'] = async (payload) => {");
    assert.ok(body.length > 200, '前置：切到了 read-volume 的真函数体');
    assert.match(body, /openVolumePopup\(renderVolumeReadHtml\(/, '★★必须**真的调** `openVolumePopup(`（否则旧卷照旧没地方住）');
    // ★反面锁（这条才是病根）：不许再有"往编年页插"这件事
    assert.ok(!body.includes('insertAdjacentHTML'), '★★不许再 `insertAdjacentHTML`（旧实现就是这么把展开的旧卷插进每轮重绘的编年页的）');
    assert.ok(!body.includes('sw2_view_chronicle'), '★★不许再点名 `#sw2_view_chronicle`（旧卷的住法与该页无关）');
    // ★链浮层开着时先收掉（一次只留一层）
    assert.match(body, /bus\['chain-close'\]\?\.\(\)/, '★链浮层若开着先收掉（一次只留一层，ESC 才不含糊）');
    // ★总线上的点名（浮层那枚「收起」的备用入口，与 `chain-close` 同款）
    assert.match(INDEX_CODE, /bus\['volume-close'\]\s*=\s*\(\)\s*=>\s*closeVolumePopup\(\)/,
        '★总线必须有 `volume-close` 点名（与链浮层的 `chain-close` 同款）');
    // ★反向自证：把产品里那一支拆掉 ⇒ 上面那条必须立不住
    const broken = body.replace(/openVolumePopup\(/g, 'renderVolumeReadHtml(');
    assert.ok(!/openVolumePopup\(/.test(broken), '★反向自证：拆掉之后"必须调 openVolumePopup"找不到对象 ⇒ 那条会当场红');
});

// ---------- ④ ★跨文件同锁：浮层里那枚「收起」必须真的由渲染层产出 ----------
test('★leg104·VP④：渲染层的旧卷产物必须带「收起」按钮（否则浮层里没有关闭口，只能点空白）', () => {
    const src = read('src/render.js');
    const at = src.indexOf('export function renderVolumeReadHtml(');
    assert.ok(at > 0, '前置：渲染层有 renderVolumeReadHtml');
    const bodySrc = src.slice(at, at + 1400);
    assert.match(bodySrc, /data-action="volume-close"/, '★★产物必须带 `data-action="volume-close"`（浮层自己那条委托认它）');
    assert.match(bodySrc, /sw2-cv-head/, '★头要照链浮层那套壳（`sw2-cv-head`）：同一类东西同一种长相');
    assert.match(bodySrc, /id="sw2_volume_read"/, '★卷段那一块的 id 保留（判据与人工排障都靠它认）');
});
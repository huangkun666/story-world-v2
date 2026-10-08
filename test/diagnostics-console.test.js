// story-world-v2/test/diagnostics-console.test.js
//
// ★调试台（细案 Task 3）的判据：`src/diagnostics.js`（有界内存记录器）＋ `web/debug-console.js`（面板片段与委托控制器）。
//
// 面（用户 2026-10-03 批准的细案 Task 3，与本文件一一对应）：
//   · 记录器：递归脱敏（键名 ＋ 嵌在文本里的 Authorization/Bearer ＋ URL 查询密钥 ＋ URL userinfo）、
//     容量有界（只留最近 N 条）、模块/级别筛选、读出去的是克隆（改不动仓里的账）、
//     `report(summary)` 是 JSON 字符串且**一个密钥都不许漏**；
//     ★`usageTokens` / `totalTokens` 这类**用量计数不是密钥**，一律保留；
//   · 面板：摘要事实 ＋ 模块/级别两个下拉 ＋ 详细数据勾选框 ＋ 刷新/复制/下载/清空四枚按钮；
//     一切进 HTML 的文本一律转义；委托监听只挂一次；`sync()` 只重画
//     `[data-debug-records]` / `[data-debug-summary]`（下拉与焦点不动）。
//
// 纪律：零依赖、模块顶层零 DOM（本文件在 `node --test` 里直接 import 就是在证这件事）；
//   完整模型文本**没有任何自动采集口**——记录器不碰 `console`、不挂全局钩子、不截获别人的日志。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createDiagnostics, diagnostics, redact } from '../src/diagnostics.js';
import { renderDebugConsole, bindDebugConsole } from '../web/debug-console.js';

const ROOT = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/** 剥注释（与 `test/web-scroll-keep-layout.test.js` 同一把尺；字符串里的 `//` 不许被剥）。 */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
        .join('\n');
}

const keysOf = (o) => Object.keys(o).sort();

/** 一枚只存在于本判据里的假密钥（任何产物里都不许出现这一串）。 */
const SECRET = 'sk-live-9f3a2b7c1d4e5f60';

// ---------- ① 形状与容量：只留最近 limit 条 ----------
test('诊断①：记录形状 {time,module,level,message,data}；容量只留最近 limit 条，缺省 200', () => {
    const d = createDiagnostics({ limit: 3 });
    for (let i = 1; i <= 5; i += 1) d.record('net', 'info', `第${i}条`);
    const snap = d.snapshot();
    assert.equal(snap.length, 3, '超界丢最旧（有界内存）');
    assert.deepEqual(snap.map((r) => r.message), ['第3条', '第4条', '第5条'], '留下的必须是最近那几条，且按时间先后排');
    assert.deepEqual(keysOf(snap[0]), ['data', 'level', 'message', 'module', 'time'], '记录只有细案定的那五个字段');
    assert.equal(snap[0].module, 'net');
    assert.equal(snap[0].level, 'info');
    assert.equal(snap[0].data, null, '没喂 data ⇒ null（空着就是空着，不拿 {} 冒充）');
    assert.equal(typeof snap[0].time, 'number');
    assert.ok(snap[0].time > 0, 'time 是能读的数（面板要按它印时刻）');

    const big = createDiagnostics();
    for (let i = 0; i < 230; i += 1) big.record('m', 'info', `x${i}`);
    assert.equal(big.snapshot().length, 200, '缺省上限 200');
    assert.equal(big.limit, 200);
    assert.equal(big.size(), 200);
    assert.equal(diagnostics.limit, 200, '导出的单例就是缺省那一只');
});

test('诊断②：limit 非法/越界一律夹回可用范围（不许出现 0 条或无限条）', () => {
    assert.equal(createDiagnostics({ limit: 0 }).limit, 200, '0 不是"一条不留"⇒ 落回缺省');
    assert.equal(createDiagnostics({ limit: -5 }).limit, 200);
    assert.equal(createDiagnostics({ limit: NaN }).limit, 200);
    assert.equal(createDiagnostics({ limit: 'abc' }).limit, 200);
    assert.equal(createDiagnostics({ limit: 1e9 }).limit, 5000, '上界封顶（有界内存的硬保证）');
    assert.equal(createDiagnostics({ limit: 2.7 }).limit, 2, '小数向下取整');
});

// ---------- ② 筛选：模块 × 级别 ----------
test('诊断③：按模块与级别筛选（空串=全部），两个条件是"并且"', () => {
    const d = createDiagnostics();
    d.record('net', 'warn', 'A');
    d.record('store', 'error', 'B');
    d.record('net', 'info', 'C');
    d.record('net', 'warn', 'D');
    assert.equal(d.snapshot().length, 4, '缺省全给');
    assert.equal(d.snapshot({}).length, 4, '空选项对象同上');
    assert.deepEqual(d.snapshot({ module: 'net' }).map((r) => r.message), ['A', 'C', 'D']);
    assert.deepEqual(d.snapshot({ level: 'warn' }).map((r) => r.message), ['A', 'D']);
    assert.deepEqual(d.snapshot({ module: 'net', level: 'warn' }).map((r) => r.message), ['A', 'D']);
    assert.deepEqual(d.snapshot({ module: '', level: '' }), d.snapshot(), '空串=全部');
    assert.deepEqual(d.snapshot({ module: 'store', level: 'warn' }), [], '模块对上、级别对不上 ⇒ 空');
    assert.deepEqual(d.snapshot({ module: '不存在' }), []);
    assert.deepEqual(d.snapshot({ module: null, level: undefined }).length, 4, '空值当"全部"，不当字面量');
});

test('诊断④：级别只认 info/warn/error；大小写与别名归一，字典外的落到 info', () => {
    const d = createDiagnostics();
    d.record('m', 'WARN', 'a');
    d.record('m', 'info', 'b');
    d.record('m', 'error', 'c');
    d.record('m', 'fatal', 'd');
    d.record('m', 'debug', 'e');
    assert.deepEqual(d.snapshot().map((r) => r.level), ['warn', 'info', 'error', 'error', 'info']);
    assert.equal(d.snapshot({ level: 'error' }).length, 2);
});

// ---------- ③ 克隆：账里账外不许共享引用 ----------
test('诊断⑤：喂进去的、读出去的，都是克隆——改哪一头都动不了仓', () => {
    const d = createDiagnostics();
    const data = { nested: { list: [1, 2] }, text: '原文' };
    const input = { data };
    d.record('m', 'info', 'x', data);
    data.nested.list.push(3);
    data.text = '改过了';
    assert.equal(input.data.text, '改过了', '前置：判据确实在改那个对象');

    const a = d.snapshot();
    assert.equal(a[0].data.nested.list.length, 2, '喂进去之后再改，账里不许跟着变');
    assert.equal(a[0].data.text, '原文');
    assert.notEqual(a[0].data, data, '账里那份不是原对象');

    a[0].data.nested.list.push(99);
    a[0].message = '篡改';
    a[0].data = null;
    const b = d.snapshot();
    assert.equal(b[0].data.nested.list.length, 2, '改读出去的那一份，不许回写仓里');
    assert.equal(b[0].message, 'x');
    assert.notEqual(d.snapshot()[0], d.snapshot()[0], '每次读都是新的一份记录');
    assert.notEqual(d.snapshot()[0].data, d.snapshot()[0].data, '嵌套那一层也不许共享引用');
});

// ---------- ④ 不安全的值：循环/函数/Symbol/Error/DOM/超深 ----------
test('诊断⑥：循环引用、函数、Symbol、Error、DOM 节点、大整数、超深结构都接得住（record 不许抛）', () => {
    const d = createDiagnostics();
    const cyc = { name: '环' };
    cyc.self = cyc;
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: { j: 1 } } } } } } } } } };
    assert.doesNotThrow(() => {
        d.record('m', 'info', '循环', cyc);
        d.record('m', 'info', '杂项', {
            fn() {}, sym: Symbol('s'), big: 10n, nan: NaN, inf: Infinity,
            err: new Error('炸了'), el: { nodeType: 1, tagName: 'DIV' }, undef: undefined,
        });
        d.record('m', 'info', '超深', deep);
        d.record(null, undefined, { toString() { return '对象消息'; } }, undefined);
        d.record('m', 'info', '数组里的环', [cyc]);
    });
    const [c, misc, dp, odd, arr] = d.snapshot();
    assert.equal(c.data.self, '[循环引用]', '环有名字，不是抛出去');
    assert.equal(c.data.name, '环', '环的上一圈照常给');
    assert.equal(misc.data.fn, '[函数]');
    assert.equal(misc.data.sym, '[符号]');
    assert.equal(misc.data.big, '10', '大整数转字符串（JSON 里也不许炸）');
    assert.equal(misc.data.err.message, '炸了', 'Error 摊成可读对象');
    assert.equal(typeof misc.data.err.name, 'string');
    assert.equal(misc.data.el, '[DOM 节点]');
    assert.equal(misc.data.undef, null, 'undefined 记 null（JSON 语义）');
    assert.ok(JSON.stringify(dp).includes('[层级过深]'), '超深结构截断并如实标注');
    assert.equal(odd.module, '(未知)');
    assert.equal(odd.level, 'info');
    assert.equal(typeof odd.message, 'string');
    assert.ok(odd.message.length > 0, '非字符串消息也要变成一行字');
    assert.equal(odd.data, null, 'data 显式给 undefined ⇒ null');
    assert.equal(arr.data[0].self, '[循环引用]', '藏在数组里的环同样接住');
});

test('诊断⑦：消息与长文本有上限（有界内存；完整模型文本不许无声灌进来）', () => {
    const d = createDiagnostics();
    d.record('m', 'info', 'x'.repeat(5000), { text: 'y'.repeat(5000) });
    const [r] = d.snapshot();
    assert.ok(r.message.length < 600, `消息被截断（实际 ${r.message.length}）`);
    assert.match(r.message, /…$/, '截断留痕，不许假装是全文');
    assert.ok(r.data.text.length < 1200, `载荷里的长字符串同样截断（实际 ${r.data.text.length}）`);
    assert.match(r.data.text, /…$/);
});

// ---------- ⑤ 脱敏：递归 + 文本 + URL，但用量计数不脱 ----------
test('诊断⑧：密钥递归脱敏；★usageTokens/totalTokens 这类用量计数保留', () => {
    const d = createDiagnostics();
    d.record('net', 'warn', `请求头 Authorization: Bearer ${SECRET}`, {
        apiKey: SECRET,
        embedApiKey: SECRET,
        key: SECRET,
        authorization: `Bearer ${SECRET}`,
        password: SECRET,
        token: SECRET,
        secret: SECRET,
        nested: { list: [{ api_key: SECRET }] },
        usageTokens: 812,
        totalTokens: 1024,
        usage_tokens: 33,
        maxTokens: 8000,
        url: `https://api.example.com/v1/embed?api_key=${SECRET}&model=bge`,
        header: `x-api-key: ${SECRET}`,
        userinfo: `https://user:${SECRET}@api.example.com/x`,
        note: `token=${SECRET}`,
    });
    const rec = d.snapshot()[0];
    const flat = JSON.stringify(rec);
    assert.ok(!flat.includes(SECRET), `一个密钥都不许漏：${flat}`);

    assert.equal(rec.data.apiKey, '[已脱敏]');
    assert.equal(rec.data.embedApiKey, '[已脱敏]');
    assert.equal(rec.data.key, '[已脱敏]');
    assert.equal(rec.data.authorization, '[已脱敏]', '键名是密钥 ⇒ 整条值换掉');
    assert.equal(rec.data.password, '[已脱敏]');
    assert.equal(rec.data.token, '[已脱敏]');
    assert.equal(rec.data.secret, '[已脱敏]');
    assert.equal(rec.data.nested.list[0].api_key, '[已脱敏]', '嵌套数组里也要脱');

    assert.equal(rec.data.usageTokens, 812, '★用量计数不是密钥（usageTokens 不许脱敏）');
    assert.equal(rec.data.totalTokens, 1024, '★totalTokens 同上');
    assert.equal(rec.data.usage_tokens, 33, '下划线写法同样保留');
    assert.equal(rec.data.maxTokens, 8000, '上限类配置同样不是密钥');

    assert.equal(rec.data.url, 'https://api.example.com/v1/embed?api_key=[已脱敏]&model=bge',
        'URL 里的密钥换掉，别的参数一个字不许动');
    assert.equal(rec.data.header, 'x-api-key: [已脱敏]', '嵌在文本里的 x-api-key 头');
    assert.equal(rec.data.userinfo, 'https://user:[已脱敏]@api.example.com/x', 'URL userinfo 的密码段');
    assert.equal(rec.data.note, 'token=[已脱敏]');
    assert.equal(rec.message, '请求头 Authorization: Bearer [已脱敏]', '消息里的 Authorization/Bearer 保形替换');
});

test('诊断⑨：redact 是单独可用的同一把尺（渲染层复用），循环不抛', () => {
    const cyc = {};
    cyc.me = cyc;
    const out = redact({ a: { token: 'x' }, usageTokens: 3, cyc });
    assert.equal(out.a.token, '[已脱敏]');
    assert.equal(out.usageTokens, 3);
    assert.equal(out.cyc.me, '[循环引用]');
    assert.equal(redact(null), null);
    assert.equal(redact('Authorization: Bearer abcdefgh'), 'Authorization: Bearer [已脱敏]');
});

// ---------- ⑥ report / clear ----------
test('诊断⑩：report 是 JSON 字符串（带摘要），随容量走，且一个密钥都不许漏', () => {
    const d = createDiagnostics({ limit: 5 });
    d.record('net', 'error', '调用失败', { password: SECRET, httpStatus: 401, usageTokens: 12 });
    for (let i = 0; i < 9; i += 1) d.record('store', 'info', `第${i}条`);
    const text = d.report({ build: 'leg177', embedApiKey: SECRET, totalTokens: 99, tick: 12 });
    assert.equal(typeof text, 'string');
    assert.ok(!text.includes(SECRET), '报告里不许出现密钥（摘要那一头也要递归脱敏）');
    const doc = JSON.parse(text);
    assert.ok(Array.isArray(doc.records));
    assert.equal(doc.records.length, 5, '报告跟着容量上限走');
    assert.equal(doc.count, 5);
    assert.equal(doc.summary.build, 'leg177');
    assert.equal(doc.summary.embedApiKey, '[已脱敏]', '摘要里的密钥同样脱');
    assert.equal(doc.summary.totalTokens, 99, '摘要里的用量计数保留');
    assert.equal(doc.summary.tick, 12);
    assert.equal(typeof doc.generatedAt, 'string');
    assert.ok(doc.generatedAt.includes('T'), '报告带生成时刻（人读的）');
    assert.ok(!JSON.stringify(doc.records).includes('调用失败'), '最旧那条已被容量挤掉（报告不许偷偷超界）');
    assert.equal(doc.records[doc.records.length - 1].message, '第8条', '留下的是最近那几条');
    assert.ok(JSON.stringify(d.report({})).length > 0, '不喂摘要照样出报告');
});

test('诊断⑪：clear 清空（返回清掉几条），之后从头再记', () => {
    const d = createDiagnostics();
    d.record('m', 'info', 'a');
    d.record('m', 'warn', 'b');
    assert.equal(d.clear(), 2);
    assert.deepEqual(d.snapshot(), []);
    assert.equal(d.size(), 0);
    d.record('m', 'error', 'c');
    assert.deepEqual(d.snapshot().map((r) => r.level), ['error']);
    assert.equal(d.clear(), 1);
});

// ---------- ⑦ 模块卫生：顶层零 DOM、零 console 截获 ----------
test('诊断⑫：顶层零 DOM/零 console/零全局钩子（完整模型文本没有自动采集口），单例四件套齐全', () => {
    const src = stripComments(read('src/diagnostics.js'));
    assert.ok(!/\bdocument\b/.test(src), '记录器不许碰 DOM');
    assert.ok(!/\bwindow\b/.test(src), '记录器不许碰 window');
    assert.ok(!/\bconsole\s*\./.test(src), '不许碰 console（更不许截获别人的 console）');
    assert.ok(!/\bglobalThis\b/.test(src), '不许挂全局钩子');
    assert.ok(!/^\s*import\s/m.test(src), '零 import 的真叶子（Node 直接 import 就能跑）');
    assert.ok(!/from\s+['"]node:/.test(src), '浏览器面不许出现 Node 内建');
    for (const name of ['record', 'snapshot', 'clear', 'report']) {
        assert.equal(typeof diagnostics[name], 'function', `单例必须有 ${name}()`);
    }
    assert.equal(typeof createDiagnostics, 'function');
    assert.equal(typeof redact, 'function');
});

// ══════════════════ 面板：`web/debug-console.js` ══════════════════

/** 一条假记录（面板只认这五个字段）。 */
const rec = (over = {}) => ({ time: 1760000000000, module: 'net', level: 'info', message: '一条', data: null, ...over });

/** 按钮目标：真 DOM 里 `closest` 找得到带 data-debug-action 的那一枚。 */
const actionTarget = (action) => ({
    id: '',
    closest: (sel) => (sel === '[data-debug-action]' ? { getAttribute: () => action } : null),
});

/**
 * 假窗口（照 `test/setting-reader.test.js` 那把小尺）：只做本族真用到的那几件事——
 * 委托监听、`querySelector`、被重画的那两格，以及**每格被写了几次**（用来证 sync 没碰下拉与勾选框）。
 */
function fakeWin({ module = '', level = '', details = false, clipboard = undefined, document: doc = null, Blob: BlobCtor = null, URL: urlLike = null } = {}) {
    const node = (id, extra = {}) => ({
        id,
        _html: '',
        _writes: 0,
        textContent: '',
        focused: 0,
        value: extra.value ?? '',
        checked: !!extra.checked,
        focus() { this.focused += 1; },
        contains: () => true,
        closest: () => null,
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = String(v); this._writes += 1; },
    });
    const moduleSel = node('sw2_debug_module', { value: module });
    const levelSel = node('sw2_debug_level', { value: level });
    const detailsBox = node('sw2_debug_details', { checked: details });
    const recordsBox = node('records');
    const summaryBox = node('summary');
    const result = node('result');
    const parts = {
        '#sw2_debug_module': moduleSel,
        '#sw2_debug_level': levelSel,
        '#sw2_debug_details': detailsBox,
        '[data-debug-records]': recordsBox,
        '[data-debug-summary]': summaryBox,
        '[data-debug-result]': result,
    };
    const root = { querySelector: (sel) => parts[sel] || null, contains: () => true };
    const handlers = new Map();
    const added = [];
    const win = {
        navigator: clipboard === undefined ? {} : { clipboard },
        document: doc,
        Blob: BlobCtor,
        URL: urlLike,
        addEventListener(type, fn) { added.push(type); if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); },
        removeEventListener(type, fn) {
            const list2 = handlers.get(type) || [];
            const at = list2.indexOf(fn);
            if (at >= 0) list2.splice(at, 1);
        },
        querySelector: (sel) => (sel === '[data-debug-console]' ? root : (parts[sel] || null)),
    };
    const emit = (type, target, extra = {}) => (handlers.get(type) || []).map((fn) => fn({ type, target, ...extra }))[0];
    return { win, root, moduleSel, levelSel, detailsBox, recordsBox, summaryBox, result, handlers, added, emit };
}

test('调试台实时显示新增错误，保留筛选与详情，解绑后停止刷新', async () => {
    diagnostics.clear();
    const f = fakeWin({ level: 'error', details: true });
    const api = bindDebugConsole(f.win, { getSnapshot: filters => diagnostics.snapshot(filters), getSummary: () => ({}) });
    diagnostics.record('页面异常', 'error', '实时错误', { line: 42 });
    diagnostics.record('状态', 'info', '有用操作');
    await Promise.resolve();
    assert.match(f.recordsBox.innerHTML, /实时错误/);
    assert.doesNotMatch(f.recordsBox.innerHTML, /有用操作/);
    assert.equal(f.levelSel.value, 'error');
    assert.equal(f.detailsBox.checked, true);
    assert.equal(f.levelSel.focused, 0);
    api.dispose();
    const previous = f.recordsBox.innerHTML;
    diagnostics.record('页面异常', 'error', '已解绑');
    await Promise.resolve();
    assert.equal(f.recordsBox.innerHTML, previous);
    diagnostics.clear();
});

test('调试台①：渲染片段——摘要事实、模块/级别下拉、详情勾选框、四枚按钮（固定 id + 中文标签）', () => {
    const html = renderDebugConsole({
        summary: { build: 'leg177', tick: 12, vectorEnabled: false },
        records: [rec({ module: 'net', level: 'warn', message: '外部调用超时' })],
        details: false,
    });
    assert.ok(html.trim().startsWith('<div class="sw2-debug-console"'), '一片可整块插进设置页的片段');
    assert.match(html, /id="sw2_debug_module"/);
    assert.match(html, /id="sw2_debug_level"/);
    assert.match(html, /id="sw2_debug_details"/);
    for (const action of ['refresh', 'copy', 'download', 'clear']) {
        assert.ok(html.includes(`data-debug-action="${action}"`), `缺 data-debug-action="${action}" 那一枚`);
    }
    for (const label of ['刷新', '复制报告', '下载报告', '清空', '全部模块', '全部级别', '信息', '警告', '错误', '详细数据']) {
        assert.ok(html.includes(label), `缺中文标签「${label}」`);
    }
    assert.match(html, /data-debug-summary/);
    assert.match(html, /data-debug-records/);
    assert.match(html, /data-debug-result/);
    assert.match(html, /sw2-debug-entry/, '每行一个 sw2-debug-entry（root 那边照类名配 CSS）');
    assert.ok(html.includes('当前构建') && html.includes('leg177'), '摘要事实：当前构建');
    assert.ok(html.includes('轮次') && html.includes('12'), '摘要事实：轮次');
    assert.ok(html.includes('向量开关') && html.includes('关闭'), '摘要事实：向量开关（布尔按人话印）');
    assert.ok(html.includes('本次显示') && html.includes('1 条'), '摘要事实：本次显示几条');
    assert.ok(!/id="sw2_debug_details"[^>]*checked/.test(html), '缺省不勾详细数据（详细调试要用户明确打开）');
    assert.ok(/id="sw2_debug_details"[^>]*checked/.test(renderDebugConsole({ details: true })), '打开时勾上');
});

test('调试台②：模块下拉只列记录里真出现过的模块；级别三档 + 全部', () => {
    const html = renderDebugConsole({ records: [rec({ module: 'net', level: 'warn' }), rec({ module: 'store' }), rec({ module: 'net', level: 'error' })] });
    const moduleBlock = html.slice(html.indexOf('id="sw2_debug_module"'), html.indexOf('id="sw2_debug_level"'));
    assert.ok(moduleBlock.includes('value=""'), '有一档"全部模块"');
    assert.equal((moduleBlock.match(/value="net"/g) || []).length, 1, '同一个模块只列一次');
    assert.ok(moduleBlock.includes('value="store"'));
    const levelBlock = html.slice(html.indexOf('id="sw2_debug_level"'), html.indexOf('id="sw2_debug_details"'));
    for (const value of ['value=""', 'value="info"', 'value="warn"', 'value="error"']) {
        assert.ok(levelBlock.includes(value), `级别下拉缺 ${value || '(全部)'}`);
    }
});

test('调试台③：恶意字符串一律转义（消息/模块/数据/摘要都不许拼成真 HTML）', () => {
    const html = renderDebugConsole({
        summary: { '<script>alert(2)</script>': '<b>摘要</b>' },
        records: [rec({
            module: '<svg onload=alert(3)>',
            level: 'error',
            message: `<script>alert("x")</script> <img src=x onerror="alert(1)">`,
            data: { '<b>键</b>': '<i>值</i>' },
        })],
        details: true,
    });
    assert.ok(!/<script/i.test(html), '不许出现真的 script 标签');
    assert.ok(!/<img/i.test(html), '不许出现真的 img 标签');
    assert.ok(!/<svg/i.test(html), '不许出现真的 svg 标签');
    assert.ok(html.includes('&lt;script&gt;'), '尖括号要转义');
    assert.ok(html.includes('&lt;img src=x'), '属性里的引号同样要转义');
    assert.ok(html.includes('&lt;b&gt;键&lt;/b&gt;'), '数据载荷（JSON）同样走转义');
    assert.ok(html.includes('&lt;i&gt;值&lt;/i&gt;'));
    assert.ok(html.includes('&lt;script&gt;alert(2)&lt;/script&gt;'), '摘要的键名也要转义');
});

test('调试台④：详细载荷只在明确打开时才画；缺省只留一行"含数据"提示', () => {
    const withData = rec({ level: 'warn', message: '外部调用', data: { requestMs: 320, url: 'https://example.com/x' } });
    const without = rec({ module: 'store', message: '没有载荷' });
    const off = renderDebugConsole({ records: [withData, without], details: false });
    assert.ok(!off.includes('requestMs'), '缺省态不许把详细载荷拼进 HTML');
    assert.ok(!off.includes('example.com'), '同上（连值都不许露）');
    assert.match(off, /含数据/, '只留一行提示告诉玩家"这里有数据，勾上才展开"');
    const on = renderDebugConsole({ records: [withData, without], details: true });
    assert.match(on, /<details class="sw2-debug-details"/, '勾上之后才有展开那一格');
    assert.ok(on.includes('requestMs') && on.includes('320'), '展开里是那条载荷');
    assert.equal((on.match(/<details class="sw2-debug-details"/g) || []).length, 1, '没有载荷的行不许长出一格空的展开');
});

test('调试台⑤：委托监听只挂一次；sync 只重画两格（下拉/勾选框/焦点一动不动）', async () => {
    const f = fakeWin({ module: 'net', level: 'warn' });
    const asked = [];
    let detailsSeen = null;
    const api = bindDebugConsole(f.win, {
        getSnapshot: (filters) => {
            asked.push({ ...filters });
            return [rec({ module: filters.module || 'net', level: filters.level || 'warn', message: '一条', data: { requestMs: 320 } })];
        },
        getSummary: () => ({ build: 'leg177' }),
        onDetails: (v) => { detailsSeen = v; },
    });
    assert.ok(api && typeof api.sync === 'function', '返回 {sync()}');
    assert.deepEqual(f.added.slice().sort(), ['change', 'click'], '只挂 click/change 两种委托（不截获 console、不挂别的钩子）');
    assert.equal(f.added.length, 2, '每种只挂一次');

    api.sync();
    assert.deepEqual(asked[asked.length - 1], { module: 'net', level: 'warn' }, 'sync 按当下两个下拉的值取快照');
    assert.ok(f.recordsBox.innerHTML.includes('一条'));
    assert.ok(f.summaryBox.innerHTML.includes('当前构建') && f.summaryBox.innerHTML.includes('leg177'));
    assert.ok(f.recordsBox._writes >= 1 && f.summaryBox._writes >= 1, '两格确实被更新');
    assert.equal(f.moduleSel._writes, 0, '模块下拉一个字都不许重画（重建就把玩家的选择吞了）');
    assert.equal(f.levelSel._writes, 0, '级别下拉同上');
    assert.equal(f.detailsBox._writes, 0, '详情勾选框同上');

    // 同一个窗口再绑一次：还是同一只 api，且不再挂监听；依赖以最新那次为准
    const again = bindDebugConsole(f.win, {
        getSnapshot: (filters) => {
            asked.push({ ...filters });
            return [rec({ module: filters.module, level: filters.level, message: '改后', data: { requestMs: 320 } })];
        },
        getSummary: () => ({ build: 'leg177' }),
        onDetails: (v) => { detailsSeen = v; },
    });
    assert.equal(again, api, '同一个窗口只绑一次');
    assert.equal(f.added.length, 2, '重复绑定不许再挂一遍（否则一次点击触发两次）');

    f.moduleSel.value = 'store';
    f.levelSel.value = 'error';
    await f.emit('change', f.moduleSel);
    assert.deepEqual(asked[asked.length - 1], { module: 'store', level: 'error' }, '筛选变了要按新值取账');
    assert.ok(f.recordsBox.innerHTML.includes('改后'), '新依赖立刻生效');
    assert.equal(f.moduleSel._writes, 0, 'sync 不许重建下拉');

    f.detailsBox.checked = true;
    await f.emit('change', f.detailsBox);
    assert.equal(detailsSeen, true, '勾选详情要交给调用方落根设置');
    assert.ok(f.recordsBox.innerHTML.includes('requestMs'), '勾上之后行里才展开载荷');
    assert.equal(f.detailsBox._writes, 0);
    assert.equal(f.moduleSel.focused + f.levelSel.focused + f.detailsBox.focused, 0, 'sync 不许抢焦点');
});

test('调试台⑥：依赖抛错、面板未渲染、没有窗口，都不许带崩（sync 如实返回）', () => {
    assert.equal(bindDebugConsole(null, {}), null, '没有窗口 ⇒ null（Node 里也安全）');
    const f = fakeWin();
    const api = bindDebugConsole(f.win, {
        getSnapshot: () => { throw new Error('取不动'); },
        getSummary: () => { throw new Error('也取不动'); },
    });
    assert.doesNotThrow(() => api.sync());
    assert.ok(f.recordsBox.innerHTML.includes('暂无日志'), '取不到账 ⇒ 空态（不是半张面板）');
    assert.ok(f.summaryBox.innerHTML.includes('本次显示'), '摘要那格照样有"本次显示 0 条"');

    const bare = fakeWin();
    bare.win.querySelector = () => null;
    const api2 = bindDebugConsole(bare.win, { getSnapshot: () => [] });
    assert.equal(api2.sync(), false, '面板还没渲染 ⇒ sync 如实返回 false（不假装做了事）');
});

test('调试台⑦：复制/下载走的都是 diagnostics.report(摘要)，清空走 diagnostics.clear()', async () => {
    diagnostics.clear();
    diagnostics.record('net', 'error', '按钮前的一条', { password: SECRET });
    let copied = null;
    let created = null;
    let revoked = null;
    let clicks = 0;
    const anchor = { href: '', download: '', click() { clicks += 1; }, remove() {} };
    const f = fakeWin({
        clipboard: { writeText: (text) => { copied = text; return Promise.resolve(); } },
        Blob: function Blob(parts, opts) { this.parts = parts; this.type = opts && opts.type; },
        URL: { createObjectURL: (blob) => { created = blob; return 'blob:sw2-debug-1'; }, revokeObjectURL: (url) => { revoked = url; } },
        document: { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } },
    });
    const api = bindDebugConsole(f.win, {
        getSnapshot: () => diagnostics.snapshot(),
        getSummary: () => ({ build: 'leg177', embedApiKey: SECRET, usageTokens: 7 }),
        onDetails: () => {},
    });
    api.sync();

    await f.emit('click', actionTarget('copy'));
    const report = JSON.parse(copied);
    assert.equal(report.summary.build, 'leg177');
    assert.equal(report.summary.usageTokens, 7, '用量计数保留');
    assert.ok(!copied.includes(SECRET), '复制出去的报告不许带密钥');
    assert.ok(report.records.some((r) => r.message === '按钮前的一条'));
    assert.match(f.result.textContent, /已复制/, '结果要写在面板里那行字上');

    await f.emit('click', actionTarget('download'));
    assert.ok(created && created.type === 'application/json', '报告走 Blob（JSON）');
    await new Promise(resolve => setTimeout(resolve, 1100)); // 下载处理器获得 Blob 后再释放
    assert.equal(revoked, 'blob:sw2-debug-1', '★用完必须 revoke（不许一直挂着 URL）');
    assert.equal(clicks, 1, '触发一次下载');
    assert.ok(/^story-world-v2-debug-.*\.json$/.test(anchor.download), `下载文件名要可认：${anchor.download}`);
    assert.match(f.result.textContent, /已下载/);

    await f.emit('click', actionTarget('refresh'));
    assert.match(f.result.textContent, /刷新/);

    await f.emit('click', actionTarget('clear'));
    assert.equal(diagnostics.size(), 0, '清空走的是单例 diagnostics.clear()');
    assert.match(f.result.textContent, /清空/);
    assert.ok(f.recordsBox.innerHTML.includes('暂无日志'), '清完当场重画空态');

    // 与面板无关的点击不许被当成动作
    await f.emit('click', { id: 'other', closest: () => null });
    assert.match(f.result.textContent, /清空/, '闲杂点击不许改结果那行字');
});

test('调试台⑧：剪贴板不可用（没有 API / 被拒）时给一行内联结果，绝不抛', async () => {
    const deps = () => ({ getSnapshot: () => [rec()], getSummary: () => ({ build: 'x' }), onDetails: () => {} });
    const noClip = fakeWin();
    bindDebugConsole(noClip.win, deps());
    await noClip.emit('click', actionTarget('copy'));
    assert.match(noClip.result.textContent, /复制失败/, '没有剪贴板 ⇒ 老实说复制失败');
    assert.ok(noClip.result.textContent.includes('下载报告'), '并告诉玩家还有哪条路可走');

    const denied = fakeWin({ clipboard: { writeText: () => Promise.reject(new Error('权限被拒')) } });
    bindDebugConsole(denied.win, deps());
    await denied.emit('click', actionTarget('copy'));
    assert.match(denied.result.textContent, /复制失败/, '被拒同样落在那一行字上（不是抛出去）');
});

test('调试台⑨：下载环境缺件（没有 Blob/URL/document）⇒ 一行中文结果', async () => {
    const f = fakeWin();
    bindDebugConsole(f.win, { getSnapshot: () => [rec()], getSummary: () => ({}), onDetails: () => {} });
    await f.emit('click', actionTarget('download'));
    assert.match(f.result.textContent, /不支持下载|改用/, '缺件时如实出声，并指向复制那条路');
});

test('调试台⑩：顶层零 DOM、零 console 截获；Node 里 import 就能渲染与绑定', async () => {
    const src = stripComments(read('web/debug-console.js'));
    assert.ok(!/^\s*(document|window)\./m.test(src), '模块顶层不许碰 DOM（一律在函数体里现取）');
    assert.ok(!/console\s*\.\w+\s*=/.test(src), '★不许截获 console（别人的 console 更不许）');
    assert.ok(!/from\s+['"]node:/.test(src), '浏览器面不许出现 Node 内建');
    const mod = await import('../web/debug-console.js');
    assert.equal(typeof mod.renderDebugConsole, 'function');
    assert.equal(typeof mod.bindDebugConsole, 'function');
    assert.ok(mod.renderDebugConsole().includes('sw2-debug-console'), '不喂参数也要能渲染出壳');
    assert.equal(typeof globalThis.document, 'undefined', '这条判据跑在 Node 里：没有 DOM 也能 import');
});

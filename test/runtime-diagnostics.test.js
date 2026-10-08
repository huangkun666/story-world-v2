import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnostics, createDiagnostics } from '../src/diagnostics.js';
import { setStatus, reportWinError } from '../web/status-bar.js';

test('中性界面状态可以显示但不进入调试记录，有用操作仍保留', () => {
    diagnostics.clear();
    setStatus('观棋窗口已收起', { diagnostic: false });
    assert.equal(diagnostics.size(), 0);
    setStatus('世界已保存');
    assert.equal(diagnostics.snapshot()[0].message, '世界已保存');
});

test('页面其他来源的错误不进入插件调试台，本插件保留文件行列', () => {
    diagnostics.clear();
    const old = console.warn;
    console.warn = () => {};
    try {
        reportWinError({ message: '宿主坏了', filename: 'https://example.invalid/host.js', error: new Error('宿主坏了') });
        assert.equal(diagnostics.size(), 0);
        reportWinError({ message: '插件坏了', filename: new URL('../web/index.js', import.meta.url).href, lineno: 12, colno: 4, error: new Error('插件坏了') });
    }
    finally { console.warn = old; }
    const rows = diagnostics.snapshot();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 'error');
    assert.equal(rows[0].module, '插件异常');
    assert.equal(rows[0].data.filename, new URL('../web/index.js', import.meta.url).href);
    assert.equal(rows[0].data.line, 12);
    assert.ok(rows[0].data.error.stack);
});

test('诊断订阅收到记录与清空，坏监听不影响日志，取消后不再收到', () => {
    const d = createDiagnostics(), seen = [];
    const stop = d.subscribe(() => seen.push(d.size()));
    d.subscribe(() => { throw new Error('坏监听'); });
    d.record('保存', 'error', '失败');
    d.clear();
    stop();
    d.record('保存', 'info', '恢复');
    assert.deepEqual(seen, [1, 0]);
    assert.equal(d.size(), 1);
});

function runtimeHost() {
    const listeners = new Map(), calls = [];
    const host = {
        console: {
            warn(...args) { calls.push({ self: this, args }); return 'warn-result'; },
            error(...args) { calls.push({ self: this, args }); return 'error-result'; },
            log() {},
        },
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    };
    return { host, calls, listeners };
}

test('只采插件控制台，截图里的宿主警告被排除，保留原调用与脱敏', async () => {
    const { installRuntimeDiagnostics } = await import('../web/runtime-diagnostics.js');
    const d = createDiagnostics(), f = runtimeHost(), oldWarn = f.host.console.warn;
    const hook = installRuntimeDiagnostics(f.host, { recorder: d });
    assert.equal(installRuntimeDiagnostics(f.host, { recorder: d }), hook);
    const payload = { apiKey: 'sk-secret', prompt: '不应采集的完整提示词', response: '不应采集的完整回复', status: 503 };
    assert.equal(f.host.console.warn('[story-world-v2] 服务异常', payload), 'warn-result');
    const error = new Error('调用失败');
    error.stack = `Error: 调用失败\n    at ${new URL('../src/transport-http.js', import.meta.url).href}:10:2`;
    f.host.console.error(error);
    f.host.console.warn('Settings not ready, scheduling another save');
    f.host.console.warn('[DEPRECATED] MacrosParser.registerMacro is deprecated');
    const foreign = new Error('其他扩展错误');
    foreign.stack = 'Error: 其他扩展错误\n    at https://example.invalid/host.js:4:2';
    f.host.console.error(foreign);
    f.host.console.log('普通输出');
    assert.equal(f.calls[0].self, f.host.console);
    assert.equal(f.calls[0].args[1], payload);
    const rows = d.snapshot();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.level), ['warn', 'error']);
    assert.ok(rows[1].data.args[0].stack);
    const report = d.report();
    assert.doesNotMatch(report, /sk-secret|不应采集/);
    assert.match(report, /503/);
    hook.dispose();
    assert.equal(f.host.console.warn, oldWarn);
    assert.equal(f.listeners.size, 0);
});

test('只采插件资源，页面图片失败不入台，普通异常不重复，卸载不留监听', async () => {
    const { installRuntimeDiagnostics } = await import('../web/runtime-diagnostics.js');
    const d = createDiagnostics(), f = runtimeHost();
    const hook = installRuntimeDiagnostics(f.host, { recorder: d });
    f.listeners.get('error')({ target: { tagName: 'SCRIPT', src: 'https://example.invalid/broken.js' } });
    f.listeners.get('error')({ target: { tagName: 'IMG', src: 'http://127.0.0.1:8000/' } });
    f.listeners.get('error')({ target: { tagName: 'SCRIPT', src: new URL('../web/broken.js', import.meta.url).href } });
    f.listeners.get('error')({ message: '已经由异常监听处理', target: f.host });
    const rows = d.snapshot();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].level, 'error');
    assert.match(rows[0].data.url, /broken\.js/);
    hook.dispose();
    assert.equal(f.listeners.size, 0);
});

test('全局异常已经结构化记录后，控制台转发不重复计数', async () => {
    const { installRuntimeDiagnostics } = await import('../web/runtime-diagnostics.js');
    const f = runtimeHost(), oldWarn = console.warn, oldError = console.error;
    console.warn = () => {};
    console.error = () => {};
    f.host.console = console;
    const hook = installRuntimeDiagnostics(f.host);
    diagnostics.clear();
    try {
        reportWinError({ filename: new URL('../web/status-bar.js', import.meta.url).href, message: '本插件出错', error: new Error('本插件出错') });
        reportWinError({ filename: 'https://example.invalid/host.js', message: '宿主出错', error: new Error('宿主出错') });
        assert.equal(diagnostics.size(), 1);
        assert.deepEqual(diagnostics.snapshot().map(r => r.module), ['插件异常']);
    } finally { hook.dispose(); console.warn = oldWarn; console.error = oldError; diagnostics.clear(); }
});

test('宿主错误的后续调用帧出现插件也不归为插件，未知来源不自动采集', async () => {
    const { installRuntimeDiagnostics } = await import('../web/runtime-diagnostics.js');
    const d = createDiagnostics(), f = runtimeHost(), hook = installRuntimeDiagnostics(f.host, { recorder: d });
    const error = new Error('宿主错误');
    error.stack = `Error: 宿主错误\n    at https://example.invalid/host.js:3:1\n    at ${new URL('../web/index.js', import.meta.url).href}:12:3`;
    f.host.console.error(error);
    assert.equal(d.size(), 0);
    diagnostics.clear();
    reportWinError({ reason: error });
    reportWinError({ message: '来源未知' });
    assert.equal(diagnostics.size(), 0);
    error.stack = `host@https://example.invalid/host.js:3:1\ncaller@${new URL('../web/index.js', import.meta.url).href}:12:3`;
    f.host.console.error(error);
    assert.equal(d.size(), 0, 'Firefox 的首帧同样必须属于插件');
    for (const first of ['at throwError (data:text/javascript,throw%20Error():1:1)', 'at eval (<anonymous>:1:1)', 'run@blob:https://example.invalid/module:1:1']) {
        error.stack = `Error: 非插件来源\n    ${first}\n    at ${new URL('../web/index.js', import.meta.url).href}:12:3`;
        f.host.console.error(error);
        reportWinError({ reason: error });
        assert.equal(d.size(), 0, '不能跳过未知首帧再把插件调用者当错误源');
        assert.equal(diagnostics.size(), 0);
    }
    hook.dispose();
});

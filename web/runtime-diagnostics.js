// 本插件诊断适配层：保留控制台原行为，仅采集有明确本插件来源的记录。
import { diagnostics } from '../src/diagnostics.js';

const installed = new WeakMap();
const SELF_BASE = new URL('../', import.meta.url).href;
// ★★2026-10-08（发布 1.1.2 时被**仓外导出件的判据**咬出来，见 `docs/session-handoff-2026-10-08-leg209-publish-112.md`）：
//   原先这一行是从**所在目录名**现算前缀（`…pathname.split('/').at(-1)`）⇒ 导出件目录叫 `out`、
//   算出来是 `[out]`，于是**本插件自己那 100 处日志一条都认不出**（`test/runtime-diagnostics.test.js`
//   在导出件里 2 行变 1 行）。而产品日志写的是**字面量** `[story-world-v2]`（如 `src/worldstep.js:26`）
//   ⇒ 同一个事实两处写法。定稿：**认产品那一份字面量**（真机安装目录名本就是 `story-world-v2`，
//   行为逐字节不变；改名的目录也不再静默失效）。
const LOG_PREFIX = '[story-world-v2]';
export function isPluginUrl(value) {
    try { return new URL(String(value)).href.startsWith(SELF_BASE); } catch (_) { return false; }
}
export function isPluginError(event) {
    try {
        if (event?.filename) return isPluginUrl(event.filename);
        const stack = String(event?.error?.stack || event?.reason?.stack || '');
        // 只看第一个来源，不能把宿主异常的后续插件调用者误当成错误源。
        const source = stack.split('\n').find(line => /^\s*(?:at\s|[^@\n]*@)/.test(line));
        const url = source?.match(/(?:https?|file):\/\/[^\s)]+/)?.[0]?.replace(/:\d+(?::\d+)?$/, '');
        return isPluginUrl(url);
    } catch (_) { return false; }
}
let muted = 0;
export function withoutConsoleCapture(fn) {
    muted++;
    try { return fn(); } finally { muted--; }
}

// 不从控制台对象采集整份模型输入、回复或世界；其余字段仍由记录器脱敏。
function diagnosticValue(value, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
    if (depth >= 3) return '[对象已省略]';
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 12).map(v => diagnosticValue(v, depth + 1, seen));
    const out = {};
    for (const key of Object.keys(value).slice(0, 24)) {
        if (/^(?:prompt|response|body|messages|world|ssot)$/i.test(key)) continue;
        try { out[key] = diagnosticValue(value[key], depth + 1, seen); } catch (_) {}
    }
    return out;
}

export function installRuntimeDiagnostics(host, { recorder = diagnostics } = {}) {
    if (!host || typeof host.addEventListener !== 'function') return null;
    if (installed.has(host)) return installed.get(host);
    const consoleHost = host.console, wrappers = [];
    for (const level of ['warn', 'error']) {
        const original = consoleHost?.[level];
        if (typeof original !== 'function') continue;
        const wrapped = function (...args) {
            const own = (typeof args[0] === 'string' && args[0].startsWith(LOG_PREFIX))
                || args.some(error => isPluginError({ error }));
            if (!muted && own) {
                withoutConsoleCapture(() => {
                    try {
                        const values = args.slice(0, 12).map(v => diagnosticValue(v));
                        const text = values.map(v => typeof v === 'string' ? v : v?.message || '').filter(Boolean).join(' · ') || `console.${level}`;
                        recorder.record('插件控制台', level, text, { args: values });
                    } catch (_) {}
                });
            }
            return Reflect.apply(original, this, args);
        };
        try { consoleHost[level] = wrapped; wrappers.push({ level, original, wrapped }); } catch (_) {}
    }
    const onResourceError = event => {
        try {
            if (event?.message) return; // 普通异常由 reportWinError 处理，避免重复。
            const target = event?.target, url = target?.src || target?.href;
            if (!url) return;
            if (!isPluginUrl(url)) return;
            recorder.record('插件资源', 'error', '资源加载失败', { tag: target.tagName, url: String(url) });
        } catch (_) {}
    };
    host.addEventListener('error', onResourceError, true);
    const api = {
        dispose() {
            for (const { level, original, wrapped } of wrappers) {
                try { if (consoleHost[level] === wrapped) consoleHost[level] = original; } catch (_) {}
            }
            host.removeEventListener?.('error', onResourceError, true);
            installed.delete(host);
        },
    };
    installed.set(host, api);
    return api;
}

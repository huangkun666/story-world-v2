// One abstraction task owns cancellation, staged cache and terminal diagnostics.
// Cancellation races preparation/model waits; final saves must finish rollback first.
import { createWorldWriteGuard } from './world-write-guard.js';
import { diagExtract } from './diagnostic-transport.js';

export const extractionCancelled = () => Object.assign(new Error('用户已中止抽取'), { sw2Cancelled: true });

export function createExtractionTaskHub({ getScope, getWorld, cache, setStatus, getRoot = () => null }) {
    let active = null;
    const sameScope = task => JSON.stringify(getScope()) === task.scope;
    function syncButtons() {
        const root = getRoot();
        for (const b of root?.querySelectorAll?.('[data-action="cancel-extraction"]') || []) {
            b.disabled = !active || active.signal.aborted || active.committed;
            b.setAttribute?.('aria-disabled', String(b.disabled));
        }
    }
    function cancel({ chatChanged = false } = {}) {
        if (!active || active.committed) return;
        active.chatChanged ||= chatChanged;
        active.controller.abort();
        syncButtons();
        if (!chatChanged && sameScope(active)) setStatus('正在中止抽取 · 已发请求可能仍在服务端运行，结果将丢弃…');
    }
    async function run(action, label, handler) {
        if (active) { setStatus(`⏳ 上一次还在跑（${active.label}）——这一下没有重复发`); return; }
        const controller = new AbortController(), started = Date.now(), pendingCache = new Map();
        const task = { action, label, controller, signal: controller.signal, scope: JSON.stringify(getScope()),
            result: null, diagnostic: null, progress: null, committed: false,
            assertCurrent() {
                if (active !== task || task.signal.aborted || !sameScope(task)) throw extractionCancelled();
            },
            setStatus(text, options) {
                if (!task.result && /^注意：|^已取消/.test(text)) task.result = { ok: false, errors: [text] };
                if (active === task && !task.signal.aborted && sameScope(task)) setStatus(text, options);
            },
            configure(resolved, configuration) { task.configuration = { resolved, configuration }; },
            async wait(promise) {
                task.assertCurrent();
                let abort;
                try {
                    const value = await Promise.race([promise, new Promise((_, reject) => {
                        abort = () => reject(extractionCancelled()); task.signal.addEventListener('abort', abort, { once: true });
                    })]);
                    task.assertCurrent(); return value;
                } finally { if (abort) task.signal.removeEventListener('abort', abort); }
            },
            cache: { get: (...args) => { task.assertCurrent(); return cache?.get(...args); },
                set: (...args) => { task.assertCurrent(); pendingCache.set(args[0], args); } },
            extract(resolved, src, { chunkChars, concurrency }) {
                task.assertCurrent();
                task.diagnostic = diagExtract(resolved, { task: action, sourceChars: Array.from(src.text || '').length, chunkChars, concurrency, signal: task.signal });
                return task.diagnostic;
            },
            async commit(candidate, save) {
                task.assertCurrent(); task.guard.prepare(candidate);
                // Never race this wait: the host may have acknowledged a candidate
                // and its compensating save must settle before the next task starts.
                try { await save(candidate, task.guard); }
                catch (error) { task.commitError = error; throw error; }
                task.assertCurrent();
                for (const args of pendingCache.values()) cache?.set(...args);
                task.committed = true;
                syncButtons();
                return { ok: true };
            },
        };
        const world = getWorld();
        const worldGuard = createWorldWriteGuard({ world, getWorld, getScope });
        task.guard = Object.fromEntries(['assertCurrent', 'checkScope', 'validateInput', 'prepare'].map(key => [key, (...args) => {
            task.assertCurrent(); return worldGuard[key](...args);
        }]));
        active = task; syncButtons();
        try {
            await handler(task);
        } catch (err) {
            task.result = { ...task.result, ok: false, cancelled: Boolean(err?.sw2Cancelled || task.signal.aborted),
                errors: [...(task.result?.errors || []), String(err?.message || err)], callFailure: err?.sw2CallFailure || task.result?.callFailure };
            if (task.committed) task.result.warnings = [...(task.result.warnings || []), `世界已保存，但界面刷新失败：${err?.message || err}`];
            if (sameScope(task) && !task.signal.aborted) {
                setStatus(task.committed ? `注意：世界已保存，但界面刷新失败：${err?.message || err}——请重新打开面板`
                    : `注意：${label}失败：${err?.message || err}——世界未动，可再点重试`);
            }
        } finally {
            task.progress?.stop(); pendingCache.clear();
            if (!task.diagnostic && task.configuration) {
                const { resolved, configuration } = task.configuration;
                task.diagnostic = diagExtract(resolved, { ...configuration, task: action, sourceChars: null, signal: task.signal });
            }
            const result = { ...task.result, ok: Boolean(task.committed || task.result?.ok && action === 'extract-scales'), cancelled: !task.committed && (task.signal.aborted || task.result?.cancelled) };
            if (result.cancelled) result.ok = false;
            const stats = task.diagnostic?.stats() || {};
            result.timing = { ...result.timing, ...stats, ms: Date.now() - started };
            result.warnings = [...(result.warnings || []), ...(result.errors || []).filter(error => /超长原文行/.test(error))];
            task.diagnostic?.finish(result);
            if (task.signal.aborted && sameScope(task) && !task.chatChanged) {
                if (task.commitError && !task.commitError.sw2Cancelled) setStatus(`注意：抽取已中止，原账保存状态未确认：${task.commitError.message || task.commitError}`);
                else setStatus('抽取已中止 · 世界与抽取缓存未动，可重新运行');
            }
            if (active === task) active = null;
            syncButtons();
        }
    }
    return { run, cancel, syncButtons, scopeChanged: () => { if (active && !sameScope(active)) cancel({ chatChanged: true }); }, busy: () => Boolean(active) };
}

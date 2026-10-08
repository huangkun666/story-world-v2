function extractionProgressText(events, elapsedMs) {
    const fin = (events || []).filter((e) => e && e.phase === 'finish');
    const done = fin.filter((e) => e.ok).length;
    const spent = Number.isFinite(elapsedMs) ? elapsedMs : fin.reduce((n, e) => n + (Number(e.ms) || 0), 0);
    const mins = Math.floor(spent / 60000);
    const secs = Math.floor((spent % 60000) / 1000);
    const cost = mins ? `${mins} 分 ${String(secs).padStart(2, '0')} 秒` : `${secs} 秒`;
    const cur = (events || []).filter((e) => e && e.phase === 'start').slice(-1)[0] || null;
    if (cur && (cur.step === 'chunk' || cur.step === 'attrs')) {
        const what = cur.step === 'chunk' ? '名册' : '属性';
        return `⏳ 抽取中 · ${what}第 ${cur.index}/${cur.count} 块（${cur.chars} 字符）· 已 ${done} 段 · 已花 ${cost}`;
    }
    return `⏳ 抽取中 · 设定（${cur ? cur.chars : '—'} 字符）· 已花 ${cost}`;
}
/**
 * 抽取进度处理器（leg27 F1/F1b）——导出以便**真测**（注入假计时器验"读秒在跳"）。
 * 心跳口径：每 `intervalMs` 按**真实已花时间**重写一次状态栏；每 `heartbeatMs` 在控制台留一行"仍在跑"
 * （"看不见在动"与"已经死了"在界面上完全同形——这是用户实机两次反馈逼出来的）。
 */
export function extractionProgressHandler(events, { setText = () => {}, intervalMs = 1000, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, log = (m) => console.info(m), heartbeatMs = 30000 } = {}) {
    let timer = null;
    let startedAt = null;
    let lastText = null;
    let heartbeatAt = null;
    const render = (elapsedOverride, diagnostic = true) => {
        const elapsed = Number.isFinite(elapsedOverride) ? elapsedOverride : (startedAt == null ? null : now() - startedAt);
        const text = extractionProgressText(events, elapsed);
        lastText = text;
        try { setText(text, { diagnostic }); } catch (_) {}
        return text;
    };
    const tick = () => {
        try {
            render(undefined, false);
            if (heartbeatAt == null || now() - heartbeatAt >= heartbeatMs) {
                heartbeatAt = now();
                const cur = (events || []).filter((e) => e && e.phase === 'start').slice(-1)[0] || null;
                const done = (events || []).filter((e) => e && e.phase === 'finish' && e.ok).length;
                const label = cur ? (cur.step === 'canon' ? '设定与名册' : `第 ${cur.index}/${cur.count} 块（${cur.step === 'attrs' ? '属性' : '设定与名册'}）`) : '（准备中）';
                try {
                    log(`[story-world-v2] 抽取仍在跑：${label} · 已 ${done} 段 · 已花 ${Math.round((startedAt == null ? 0 : now() - startedAt) / 1000)} 秒（这一段还没返回属正常，单块是分钟级）`);
                } catch (_) {}
            }
        } catch (_) {}
    };
    const stop = () => {
        if (timer == null) return;
        try { clearTimer(timer); } catch (_) {}
        timer = null;
    };
    return {
        onEvent: (ev) => {
            try {
                const label = ev.step === 'canon' ? '设定与名册' : `第 ${ev.index}/${ev.count} 块（${ev.step === 'attrs' ? '属性' : '设定与名册'}）`;
                if (ev.phase === 'start') {
                    if (startedAt == null) {
                        startedAt = now();
                        timer = setTimer(tick, intervalMs);      // ★心跳：让"它没死"每秒都看得见
                        if (typeof timer?.unref === 'function') timer.unref();   // Node 侧别把进程吊住
                    }
                    console.info(`[story-world-v2] 抽取调用：${label} 开始（输入 ${ev.chars} 字符）`);
                    render(0);                                    // 立刻出一次（别等 1 秒）
                } else {
                    console.info(`[story-world-v2] 抽取调用：${label} ${ev.ok ? '完成' : '失败'}（${ev.chars} 字符 · ${((ev.ms || 0) / 1000).toFixed(1)}s${ev.ok ? '' : ` · ${ev.error}`}）`);
                    render();
                }
            } catch (_) { /* 进度上报绝不影响抽取 */ }
        },
        stop,
        _state: () => ({ running: timer != null, lastText }),   // 供判据观测（"读秒在跳"必须可验）
    };
}

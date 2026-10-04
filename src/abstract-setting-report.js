// 抽取过程读数：不保存原文、不进入世界账或抽取缓存。
const listKeys = ['刻度', 'powerScale', 'dims', 'rules', 'historyNotes'];
const scalarKeys = ['society', 'techOrMagic', 'situation'];
export function settingTextOf(item) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        return String(item.文 ?? item.原文 ?? item.text ?? item.note ?? item.level ?? item.档 ?? item.rule ?? item.法则 ?? '').trim();
    }
    return String(item ?? '').trim();
}

export function settingCounts(canon = {}, tension = {}, env = {}) {
    const counts = {};
    for (const key of listKeys) {
        const value = canon[key];
        counts[key] = Array.isArray(value) ? value.length : value ? 1 : 0;
    }
    for (const key of scalarKeys) counts[key] = settingTextOf(canon[key]) ? 1 : 0;
    counts.tension = ['polarity', 'direction'].filter(key => settingTextOf(tension?.[key])).length;
    counts.env = ['民生度', '动乱度', '天时', '张力推手'].filter(key => settingTextOf(env?.[key])).length;
    counts.total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (counts.刻度) counts.total -= counts.powerScale + counts.dims; // 此时两列是派生视图。
    return counts;
}

export function settingReportOf({ reports = [], canon, tension, env, cached = false }) {
    const returned = settingCounts();
    const reasons = new Map();
    for (const report of reports) {
        for (const key of Object.keys(returned)) returned[key] += report.returned[key] || 0;
        for (const reason of report.reasons) reasons.set(reason, (reasons.get(reason) || 0) + 1);
    }
    const kept = settingCounts(canon, tension, env);
    return {
        cached, calls: reports.length, returned: cached ? null : returned, kept, empty: kept.total === 0,
        derivedViews: kept.刻度 ? ['powerScale', 'dims'] : [],
        reasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([reason, count]) => ({ reason, count })),
    };
}

export function captureSettingReport(raw, cleaned, records = []) {
    const reasons = records.filter(r => ['setting', 'tension', 'env'].includes(r.class) && r.action === 'drop')
        .map(r => String(r.why || '设定核验未通过'));
    // 刻度净化还使用 errors，不通过逐条 evidence 回调；不能漏掉这条诊断路径。
    reasons.push(...(cleaned.errors || []).filter(s => /^(刻度|rules\b|society\b|techOrMagic\b|historyNotes\b|situation\b|tension\b|env\b)/.test(s)));
    return { returned: settingCounts(raw, raw.tension, raw.env), reasons };
}

/** 严格模式的模板必须展示净化层真正要求的出处；旧模板由调用方原样保留。 */
export function settingEvidenceShape(shape, ev) {
    const quoted = 文 => ({ 文, ev });
    const table = item => ({ ...item, ...(item.子表 ? { 子表: item.子表.map(table) } : {}), ev });
    const out = { ...shape };
    if (out.刻度) out.刻度 = out.刻度.map(table);
    for (const key of ['rules', 'historyNotes']) if (out[key]) out[key] = out[key].map(quoted);
    for (const key of scalarKeys) if (out[key]) out[key] = quoted(out[key]);
    for (const key of ['tension', 'env']) if (out[key]) out[key] = Object.fromEntries(Object.entries(out[key]).map(([k, v]) => [k, quoted(v)]));
    return out;
}

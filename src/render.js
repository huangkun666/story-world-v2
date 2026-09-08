// story-world-v2/src/render.js
// 渲染核心纯函数（K33/K34，渲染层；细案 A-1/A-2/A-3/A-6）：
//   SSOT → HTML 片段（六页签全量）。窗口只渲染引擎产物、零发明状态；
//   同输入 → 输出逐字节一致（纯函数锁）；引擎 id 只进 title/data-ref 悬停；
//   全边界 escapeHtml（XSS 防线）。
// 玩家语言词典（A-3 黑名单以共识样例 v3 为准——"盘算/谋划"为玩家通词放行）：
//   禁：分量/熵泵/里程碑/上溯/波及/指纹/派生源/强度参数名/hardPower…/tick/裸 id。
import { BANDS, ENV_KEYS } from './entropy.js';

export const LABELS = {
    attr: { hardPower: '兵力', office: '权位', network: '人脉', intel: '耳目' },
    env: { 民生度: '民生', 动乱度: '乱象', 天时: '天时', 张力推手: '时局' },
    kind: { faction: '势力', character: '角色' },
    visibility: { known: '明', concealed: '暗' },
    status: { active: '活跃', retired: '背景', dead: '已灭' },
};

// 渲染产物黑名单（引擎术语不得出现在玩家视线）
export const BLACKLIST = [
    '分量', '熵泵', '里程碑', '上溯', '波及',
    'fingerprint', 'derivedFrom', 'intensity', 'polarity', 'direction', 'tension',
    'hardPower', 'office', 'network', 'intel', 'visibility', 'concealed',
    'schema', 'ssot', 'worldstep', 'agenda', 'chronicle', 'milestone', 'tick',
];

export function escapeHtml(s) {
    return String(s ?? '')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export const fmtTick = (n) => `第${n}轮`;
export const fmtPct = (n) => `${Math.round((n ?? 0) * 100)}`;

export function entityLabel(world, id) {
    if (id === world.context?.playerId) return '你';
    const e = world.entities.find((x) => x.id === id);
    return e ? e.name || id : id;
}

export function kindLabel(entity, world) {
    if (entity.id === world.context?.playerId) return '你的棋子';
    return LABELS.kind[entity.kind] || '实体';
}

// 环境键带态：danger（越阈）/ recover（回缓）/ normal——用引擎定案带值（BANDS/报批 #4-7）
export function envBand(key, value) {
    const b = BANDS[key];
    if (!b) return { state: 'normal', word: '' };
    if (b.dir < 0 ? value <= b.at : value >= b.at) return { state: 'danger', word: b.kind };
    if (b.dir < 0 ? value <= b.rec : value >= b.rec) return { state: 'recover', word: '' };
    return { state: 'normal', word: '' };
}

function msIdTick(id) {
    const m = /m_(\d+)/.exec(String(id || ''));
    return m ? Number(m[1]) : 0;
}

// 浪尖项契约 浪尖:<id>@<tick>（K29 补遗）→ 盘算目标+轮（引擎 id 不透传）
function tideLabel(world, item) {
    const m = /浪尖:(\w+)@(\d+)/.exec(String(item || ''));
    if (!m) return escapeHtml(String(item));
    const a = (world.agendas || []).find((x) => x.id === m[1]);
    return a ? `${escapeHtml(a.goal)}（第${Number(m[2]) + 1}轮）` : escapeHtml(String(item));
}

const dotSteps = (progress, maxSteps) => {
    const n = Math.max(0, maxSteps || 0);
    let s = '';
    for (let i = 0; i < n; i += 1) s += `<span class="sw2-dotstep${i < progress ? ' on' : ''}"></span>`;
    return s;
};

// ============ 观棋页 ============

export function renderDigestHtml(world) {
    const dyn = world.context?.setting?.dynamic;
    const pol = dyn?.tension?.polarity;
    const dir = dyn?.tension?.direction;
    const inten = dyn?.tension?.intensity;
    const env = dyn?.env || {};
    const envs = ENV_KEYS.map((k) => ({ k, ...envBand(k, env[k] ?? 0.5) }));
    const dangerList = envs.filter((x) => x.state === 'danger').map((x) => `${LABELS.env[x.k]}·${x.word}`);

    const active = (world.agendas || []).filter((a) => !a.closed);
    const hidden = active.filter((a) => a.visibility === 'concealed').length;

    const main = pol
        ? `${escapeHtml(pol)}${dir ? `，${escapeHtml(dir)}` : '，两下僵持'} · 强度${fmtPct(inten)}`
        : '大势未聚，各方各走各的路';
    const sub = dangerList.length || active.length
        ? `${dangerList.length ? escapeHtml(dangerList.join('、')) + '。' : ''}各方正谋划 ${active.length} 件事${hidden ? `，其中 ${hidden} 件在暗处` : ''}。`
        : '眼下没有在办的谋划，也没有越界的处境。';
    return `<div class="sw2-digest"><div class="sw2-digest-line">${main}</div><div class="sw2-digest-sub">${sub}</div></div>`;
}

export function renderInfoBandHtml(world) {
    const dyn = world.context?.setting?.dynamic;
    const env = dyn?.env || {};
    const envRows = ENV_KEYS.map((k) => {
        const v = env[k] ?? 0.5;
        const band = envBand(k, v);
        return `<div class="sw2-env-row${band.state === 'danger' ? ' sw2-danger' : ''}">`
            + `<span class="sw2-env-name">${LABELS.env[k]}</span>`
            + `<span class="sw2-env-bar"><i style="width:${Math.round(v * 100)}%;background:${band.state === 'danger' ? 'var(--sw2-red)' : band.state === 'recover' ? 'var(--sw2-green)' : 'var(--sw2-amber)'}"></i></span>`
            + `<span class="sw2-env-val">${v.toFixed(2)}</span></div>`;
    });
    const t = dyn?.tension || {};
    const tides = (dyn?.derivedFrom || []).slice(-3).reverse().map((x) => tideLabel(world, x));
    const counts = {
        active: (world.agendas || []).filter((a) => !a.closed).length,
        hidden: (world.agendas || []).filter((a) => !a.closed && a.visibility === 'concealed').length,
        top: (world.agendas || []).filter((a) => !a.closed && !a.parentId).length,
    };
    return `<div class="sw2-infoband">`
        + `<div class="sw2-band-block"><div class="sw2-band-label">世情 · 四键</div><div class="sw2-env">${envRows.join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">大势 · 结构性张力</div>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')} <span class="sw2-int">${fmtPct(t.intensity)}</span></div>`
        + `<div class="sw2-clash-sub">${escapeHtml(t.direction ? t.direction + '（原文方向）' : '僵持（无明确方向）')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">浪尖 · 刚收尾的大动作</div><div class="sw2-tides">${tides.map((x) => `<div class="sw2-tide">${x}</div>`).join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">盘算</div>`
        + `<div class="sw2-big-num">${counts.active}<small>/15</small></div>`
        + `<div class="sw2-num-sub">${counts.hidden ? `${counts.hidden} 件在暗处 · ` : ''}顶层 ${counts.top}/5</div></div>`
        + `</div>`;
}

export function renderAgendaStripHtml(world) {
    const active = (world.agendas || []).filter((a) => !a.closed);
    const cards = active.map((a) => `<div class="sw2-agenda-card${a.visibility === 'concealed' ? ' sw2-agenda-hidden' : ''}">`
        + `<div class="sw2-ahead"><span class="sw2-aowner">${escapeHtml(entityLabel(world, a.owner))}</span>`
        + `<span class="sw2-visible ${a.visibility === 'concealed' ? 'v-hidden' : 'v-known'}">${LABELS.visibility[a.visibility] || '明'}</span></div>`
        + `<div class="sw2-agoal">${escapeHtml(a.goal)}</div>`
        + `<div class="sw2-astage">${escapeHtml(a.stage || '谋划中')}`
        + `<span class="sw2-aprog">${dotSteps(a.progress ?? 0, a.maxSteps)}</span>`
        + `<span class="sw2-asteps">${a.progress ?? 0}/${a.maxSteps ?? 0}</span></div></div>`);
    if (!cards.length) {
        cards.push('<div class="sw2-agenda-empty">眼下没有在办的谋划。</div>');
    }
    return `<div class="sw2-agenda-strip"><div class="sw2-col-head">各方盘算 · 总览</div><div class="sw2-agenda-cards">${cards.join('')}</div></div>`;
}

export function renderFeedHtml(world, { limit = 8 } = {}) {
    const chronicle = world.chronicle || [];
    const rows = chronicle.slice(-limit).reverse().map((c, i) => {
        const latest = i === 0 && c.tick === world.meta?.tick;
        return `<div class="sw2-entry${latest ? ' sw2-latest' : ''}">${latest ? '<span class="sw2-now">最新</span>' : ''}`
            + `<div class="sw2-ctext">${escapeHtml(c.text)}</div>`
            + `<div class="sw2-cmeta"><span class="sw2-round">${fmtTick(c.tick)}</span>`
            + (c.eventRef ? `<span class="sw2-ref" title="${escapeHtml(c.eventRef)}">？</span>` : '')
            + `</div></div>`;
    });
    let note = '';
    const ms = world.milestones || [];
    if (ms.length) {
        const last = ms.reduce((a, b) => (msIdTick(b.id) > msIdTick(a.id) ? b : a));
        const titles = Array.isArray(last.titles) ? last.titles : (last.title ? [last.title] : []);
        note = `<div class="sw2-milestone-strip">⚑ 更早的 <b>第 1–${msIdTick(last.id)} 轮</b>已收进大事纪「${escapeHtml(titles.slice(0, 3).join('、'))}」<span class="sw2-goto" data-view="archive">去翻旧账 →</span></div>`;
    }
    return `<div class="sw2-col-head">动态流 · 最新在上</div><div class="sw2-feed">${rows.join('')}${note}</div>`;
}

export function renderSideHtml(world) {
    const playerId = world.context?.playerId;
    const weights = world.weights || {};
    const cards = world.entities
        .filter((e) => !e.status || e.status === 'active')
        .map((e) => {
            const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
            return `<div class="sw2-entity${e.id === playerId ? ' sw2-player' : ''}">`
                + `<div class="sw2-entity-head"><span class="sw2-entity-name">${escapeHtml(e.name)}</span>`
                + `<span class="sw2-entity-kind">${kindLabel(e, world)}</span>`
                + `<span class="sw2-entity-loc">${escapeHtml(e.location || '')}</span></div>`
                + `<div class="sw2-weight-row"><span class="sw2-wlabel">影响力</span>`
                + `<span class="sw2-wbar"><i style="width:${fmtPct(weights[e.id])}%"></i></span>`
                + `<span class="sw2-wval">${fmtPct(weights[e.id])}</span></div>`
                + (agenda
                    ? `<div class="sw2-agenda"><b>${escapeHtml(agenda.goal)}</b>${agenda.visibility === 'concealed' ? ' <span class="sw2-visible v-hidden">暗</span>' : ''}</div>`
                    : `<div class="sw2-agenda">${e.id === playerId ? '眼下没有在办的盘算——你的每一步从对话里来。' : '眼下没有在办的盘算。'}</div>`)
                + `<div class="sw2-stage"><span class="sw2-stagetext">${agenda ? `${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}` : (typeof e.lastActiveTick === 'number' ? `最近活跃：${fmtTick(e.lastActiveTick)}` : '')}</span></div>`
                + (e.id === playerId ? '<div class="sw2-note">被大局牵动会伤筋动骨；硬碰大势力会被折减。</div>' : '')
                + `</div>`;
        });
    return `<div class="sw2-col-head">位置与动作 · 速览</div><div class="sw2-side">${cards.join('')}</div>`;
}

export function renderBoardHtml(world, opts = {}) {
    return {
        digest: renderDigestHtml(world),
        infoband: renderInfoBandHtml(world),
        agendaStrip: renderAgendaStripHtml(world),
        feed: renderFeedHtml(world, opts),
        side: renderSideHtml(world),
    };
}

// ============ 编年页 ============

export function renderChronicleHtml(world, { oldVolumes = [] } = {}) {
    const rows = (world.chronicle || []).map((c) => `<div class="sw2-ch-line${c.eventRef ? ' sw2-ch-event' : ''}">`
        + `<span class="sw2-ch-round">${c.tick}</span>`
        + `<span class="sw2-ch-text">${escapeHtml(c.text)}</span>`
        + (c.eventRef ? `<span class="sw2-ref" title="${escapeHtml(c.eventRef)}">？</span>` : '')
        + `</div>`);
    const notes = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        return `<div class="sw2-ch-roll">⚑ 第 1–${msIdTick(m.id)} 轮已收进大事纪「${escapeHtml(titles.join('、'))}」</div>`;
    });
    const volumes = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    const volBlock = volumes.length
        ? `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volumes.join('')}</div>` : '';
    return `<div class="sw2-col-head">编年 · 史卷</div><div class="sw2-chronicle">${rows.join('')}${notes.join('')}</div>${volBlock}`;
}

// ============ 大事纪·旧卷页 ============

export function renderArchiveHtml(world, { oldVolumes = [] } = {}) {
    const msCards = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        const ids = Array.isArray(m.ids) ? m.ids : [];
        return `<div class="sw2-milestone"><div class="sw2-milestone-head">`
            + `<span class="sw2-milestone-id">${escapeHtml(m.id)}</span>`
            + `<span class="sw2-mspan">第 1–${msIdTick(m.id)} 轮 · ${m.counts ?? 0} 件事</span></div>`
            + `<h5>${escapeHtml(titles.slice(0, 4).join('、'))}</h5>`
            + (ids.length
                ? `<details><summary>展开这一纪的条目</summary><div class="sw2-rawids">${escapeHtml(ids.join(' · '))}</div></details>` : '')
            + `</div>`;
    });
    const volRows = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    return `<div class="sw2-arch-grid">${msCards.join('')}</div>`
        + `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volRows.join('') || '<div class="sw2-cold-row" style="color:var(--sw2-text-faint)">尚未入卷——编年仍在热账。</div>'}</div>`;
}

// ============ 角色与势力页 ============

export function renderEntitiesHtml(world) {
    const attrs = (e) => Object.entries(LABELS.attr).map(([k, label]) => {
        const v = e.attrs?.[k];
        return v == null ? '' : `<span class="sw2-eattr">${label}<b>${v}</b></span>`;
    }).filter(Boolean).join('');
    const rows = (world.entities || []).map((e) => {
        const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
        const status = e.status && e.status !== 'active' ? `<span class="sw2-visible ${e.status === 'dead' ? 'v-hidden' : 'v-known'}">${LABELS.status[e.status]}</span>` : '';
        return `<div class="sw2-entity-row${e.id === world.context?.playerId ? ' sw2-player' : ''}">`
            + `<div class="sw2-ename">${escapeHtml(e.name)}<small>${kindLabel(e, world)}</small></div>`
            + `<div class="sw2-eloc">${escapeHtml(e.location || '')}</div>`
            + `<div class="sw2-eweight"><span class="sw2-wbar"><i style="width:${fmtPct(world.weights?.[e.id])}%"></i></span><span class="sw2-wval">${fmtPct(world.weights?.[e.id])}</span></div>`
            + `<div class="sw2-eattrs">${attrs(e)}</div>`
            + `<div class="sw2-eagenda">${agenda ? `<b>${escapeHtml(agenda.goal)}</b> ${agenda.visibility === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : ''}<br>${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}` : (e.id === world.context?.playerId ? '你的每一步从对话里来。' : '眼下没有在办的盘算。')}${status}</div>`
            + `<div class="sw2-eactive">最近活跃<br>${typeof e.lastActiveTick === 'number' ? fmtTick(e.lastActiveTick) : '—'}</div>`
            + `</div>`;
    });
    return `<div class="sw2-list-head">全部角色与势力（${rows.length} 位 · 席位上限 32）</div><div class="sw2-entity-list">${rows.join('')}</div>`;
}

// ============ 设定档案页（A-6：展示与 setting.frozen 逐字段一致） ============

export function renderSettingHtml(world) {
    const dyn = world.context?.setting?.dynamic;
    const frozen = world.context?.setting?.frozen;
    const env = dyn?.env || {};
    const t = dyn?.tension || {};
    if (!frozen) {
        return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定</div>`
            + `<div class="sw2-sv-sub">尚未抽取——设定池未就绪。</div></div>`
            + `<div class="sw2-sv-cards"><span class="sw2-sv-chip stale">未抽取</span>`
            + `<button class="sw2-btn sw2-danger" data-action="force-abstract">↻ 重新抽取设定</button></div></div>`;
    }
    const envRows = ENV_KEYS.map((k) => {
        const v = env[k] ?? 0.5;
        const band = envBand(k, v);
        return `<div class="sw2-env-row${band.state === 'danger' ? ' sw2-danger' : ''}"><span class="sw2-env-name">${LABELS.env[k]}</span>`
            + `<span class="sw2-env-bar"><i style="width:${Math.round(v * 100)}%;background:${band.state === 'danger' ? 'var(--sw2-red)' : 'var(--sw2-amber)'}"></i></span>`
            + `<span class="sw2-env-val">${v.toFixed(2)}</span></div>`;
    }).join('');
    const tides = (dyn?.derivedFrom || []).slice(-5).reverse().map((x) => tideLabel(world, x)).join('<br>');
    const canon = frozen.canon || {};
    const scaleRows = (canon.powerScale || []).map((p) => `<div class="sw2-sv-row"><b>${escapeHtml(p.level)}</b><span>${escapeHtml(p.note)}</span></div>`).join('');
    const ruleRows = (canon.rules || []).map((r) => `<div class="sw2-sv-row"><b>法则</b><span>${escapeHtml(r)}</span></div>`).join('');
    const histRows = (canon.historyNotes || []).map((h, i) => `<div class="sw2-sv-hist"><span class="sw2-hist-tick">第 ${i + 1} 条</span><span>${escapeHtml(h)}</span></div>`).join('');
    const envTitle = (dyn?.derivedFrom || []).length ? `浪尖（派生源）：${tides}` : '浪尖：暂无';

    return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定 · ${escapeHtml(world.context?.world || '')}</div>`
        + `<div class="sw2-sv-sub">书指纹 ${escapeHtml(frozen.fingerprint)} · 抽取于 ${escapeHtml(frozen.extractedAt)} · 全部条目取自原文，未增写一句（只提取不创作）</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ok">✓ 已冻结 · 设定未变不重抽</span>`
        + `<button class="sw2-btn sw2-danger" data-action="force-abstract">↻ 重新抽取设定</button></div></div>`
        + `<div class="sw2-sv-grid">`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>大势现状（演变层 · 引擎算 · 每轮随动）</h4>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')} <span class="sw2-int">${fmtPct(t.intensity)}</span></div>`
        + `<div class="sw2-env">${envRows}</div>`
        + `<div style="margin-top:8px;font-size:12px;color:var(--sw2-text-faint)">${envTitle}</div></div>`
        + `<div class="sw2-set-card"><h4>力量谱系（${(canon.powerScale || []).length} 档 · 取全）</h4>${scaleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>法则（${(canon.rules || []).length} 条）</h4>${ruleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>社会格局 · 力量体系</h4><p class="sw2-sv-para">${escapeHtml(canon.society || '（无）')}</p><p class="sw2-sv-para">${escapeHtml(canon.techOrMagic || '（无）')}</p></div>`
        + `<div class="sw2-set-card"><h4>史略（${(canon.historyNotes || []).length} 条）</h4>${histRows || '<div class="sw2-sv-hist"><span>（无）</span></div>'}</div>`
        + `</div>`;
}

// ============ 设置页 ============

export function renderSettingsHtml(world, { config = {} } = {}) {
    const cfg = config || {};
    const envText = JSON.stringify({ 民生度: 0.5, 动乱度: 0.5, 天时: 0.5, 张力推手: 0.5 });
    void envText;
    return `<div class="sw2-settings">`
        + `<div class="sw2-set-card"><h4>世界设定（书的来源）</h4>`
        + `<div class="sw2-source-line"><span class="sw2-source-tag">来源：角色卡描述</span>`
        + `<span class="sw2-source-note">自动读取卡片全文 · 设定没变就不重复抽取（书指纹）</span>`
        + `<details class="sw2-source-alt"><summary>换源 &#9662;（一般不用）</summary>`
        + `<div class="sw2-source-alt-body"><span data-action="source-pick" data-source="worldinfo">SillyTavern 世界信息（合订）</span>`
        + `<span data-action="source-pick" data-source="paste">手动粘贴文本</span></div></details></div>`
        + `<div class="sw2-hint" style="margin-top:10px">设定全文（力量谱系/法则/社会格局/力量体系/史略 + 大势现状）在「设定」页阅览，「重新抽取」也在那里。</div></div>`
        + `<div class="sw2-set-card"><h4>你的开档描述</h4>`
        + `<div class="sw2-field"><label>写一段"你是谁"（自然语言 · ≤2000 字提案）</label>`
        + `<textarea id="sw2_player_desc" data-action="player-desc">${escapeHtml(cfg.playerDesc || '')}</textarea>`
        + `<div class="sw2-hint">世界从中摘你的底子（兵力/权位/人脉/耳目）；摘不出的落定案默认；你手填过的一律不动。</div></div></div>`
        + `<div class="sw2-set-card"><h4>模型通道</h4>`
        + `<div class="sw2-field"><label>服务地址</label><input class="sw2-input" id="sw2_base" value="${escapeHtml(cfg.baseUrl || '')}"></div>`
        + `<div class="sw2-field"><label>密钥</label><input class="sw2-input sw2-key-mask" id="sw2_key" value="${escapeHtml(cfg.apiKey ? '••••••••••••••••••••' : '')}"><div class="sw2-hint">本机读取 · 不落库 · 不打印</div></div>`
        + `<div class="sw2-field"><label>世界模型</label><input class="sw2-input" id="sw2_model" value="${escapeHtml(cfg.model || '')}"></div>` 
        + `<div class="sw2-field"><label>单轮演算上限（提案：120 秒 / 4096 字）</label><input class="sw2-input" id="sw2_limits" value="120s · 4096"></div></div>`
        + `<div class="sw2-set-card"><h4>操作</h4><div class="sw2-actions">`
        + `<button class="sw2-btn sw2-primary" data-action="init-world">✨ 开始新世界</button>`
        + `<button class="sw2-btn" data-action="advance-world">▶ 手动推进一步</button>`
        + `<button class="sw2-btn sw2-danger" data-action="force-abstract">↻ 重新抽取设定</button></div>`
        + `<div class="sw2-hint" style="margin-top:10px">每轮对话后世界自动推进；此按钮是手动补推。<br>「重新抽取」会忽略缓存强行重抽设定，并重读你的开档描述。<br>演算失败时世界原样不动，状态条会报错，可重试。</div></div>`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>旧卷与存储</h4>`
        + `<div class="sw2-cold-mgmt"><div class="sw2-row"><span>编年体积 · 当前</span><b>${(world.chronicle || []).length ? `${(JSON.stringify(world.chronicle).length / 1024).toFixed(1)}KB` : '0KB'}</b><em>每 100 轮约 21.7KB（实测）</em></div>`
        + `<div class="sw2-row"><span>自动入卷阈值</span><b class="sw2-thr">500 轮 或 5MB</b><em>提案态 · 随本阶段报批</em></div>`
        + `<div class="sw2-row"><span>入卷去处</span><b>插件本地 · 可导出可导入</b><em>割断的是旧账，不是来龙去脉</em></div></div></div>`
        + `</div>`;
}

// ============ 六页签全集入口（K34 接线用；同输入逐字节一致 A-2 锁） ============

export function renderAll(world, { config = {}, oldVolumes = [] } = {}) {
    return {
        board: renderBoardHtml(world),
        chronicle: renderChronicleHtml(world, { oldVolumes }),
        archive: renderArchiveHtml(world, { oldVolumes }),
        entities: renderEntitiesHtml(world),
        setting: renderSettingHtml(world),
        settings: renderSettingsHtml(world, { config }),
        header: {
            world: world.context?.world ?? '',
            tick: fmtTick(world.meta?.tick ?? 0),
        },
    };
}
// story-world-v2/src/render.js
// 渲染核心纯函数（K33/K34，渲染层；细案 A-1/A-2/A-3/A-6）：
//   SSOT → HTML 片段（六页签全量）。窗口只渲染引擎产物、零发明状态；
//   同输入 → 输出逐字节一致（纯函数锁）；引擎 id 只进 title/data-ref 悬停；
//   全边界 escapeHtml（XSS 防线）。
// 玩家语言词典（A-3 黑名单以共识样例 v3 为准——"盘算/谋划"为玩家通词放行）：
//   禁：分量/熵泵/里程碑/上溯/波及/指纹/派生源/强度参数名/hardPower…/tick/裸 id。
import { BANDS, ENV_KEYS } from './entropy.js';
import { lensList, membersOf } from './pack.js';   // K46：镜头名单（引擎层同口径）与麾下成员派生——渲染只读复用
import { TENSION_WINDOW, recentEventCount } from './setting.js';   // A1b：张力行改说可验证事实（近 N 轮事件数），与公式共用同一口径

// 面板构建号（自证用）：用户实机常遇到"改了代码但页面还是旧的"（浏览器缓存 web/index.js）。
//   这个号随每次功能落地递增，渲染进面板页脚——Ctrl+F5 后一眼就能判断载的是哪一版。
//   判据（第二十五棒）：`有值/未查/未加载到/书未明述` 查书标记 + 位置列去重 = 本轮；
//   上一版是"查书标记（缺未查）+ 位置未明徽章重复"。
//   第二十五棒 b 追加（A1b）：张力行不再写「烈度带词 + 百分比」，改「近 N 轮事件 N 件」；
//   麾下成员序由分量序改**名号序**（A1）。← 看到 `+a1b` 后缀即已载入这两条。
//   第二十五棒 d 追加：查书前置步的异步 bookText 修通 + **取书路径改 ST 官方指针**
//   （`data.extensions.world`，旧法读 `character.world` 恒空 ⇒ 取书 0 条 ⇒ 假「书未明述」）
//   + 未查态 title 属性截断修复 + **查书补全三件套**（批量补全/单实体重查/选人可见）。
export const PANEL_BUILD = 'leg25d-lookup-batch';

export const LABELS = {    env: { 民生度: '民生', 动乱度: '乱象', 天时: '天时', 张力推手: '时局' },
    kind: { faction: '势力', character: '角色' },
    visibility: { known: '明', concealed: '暗' },
    status: { active: '活跃', retired: '背景', dead: '已灭' },
};

// leg25 c（用户令「删」）：`LABELS.attr` 与 `ATTR_HINTS` **整条删除**——四维浮点（兵力/权位/人脉/耳目）
//   不存在了：它们没法精确表示（书里没刻度、现实里也没有），压成 0–1 就是拿精确的外壳装模糊的内容，
//   而且手拍值让"编的"看起来像"算的"（design-core-leg23 §4 第 1 条）。
//   书里的说法一律**照抄成文本**显示（实体 `实力` = 「T9渡劫巅峰」，据书；见 spec-entity-field-lookup）。
//   面板从此不再有「有据 n/4 / 数值无据」这类说法——那些数没有了，"有几维有据"自然无从谈起。

// K41/链视图细案 §3.1（A-16）：编年五筛（chips 玩家词面 ↔ kind 契约 token）
export const CHRONICLE_FILTERS = Object.freeze([
    { token: 'scheme', label: '谋划' },
    { token: 'major', label: '大事' },
    { token: 'ripple', label: '牵动' },
    { token: 'shade', label: '暗处' },
    { token: 'state', label: '时局' },
]);

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
    const env = dyn?.env || {};
    const envs = ENV_KEYS.map((k) => ({ k, ...envBand(k, env[k] ?? 0.5) }));
    const dangerList = envs.filter((x) => x.state === 'danger').map((x) => `${LABELS.env[x.k]}·${x.word}`);

    const active = (world.agendas || []).filter((a) => !a.closed);
    const hidden = active.filter((a) => a.visibility === 'concealed').length;

    // leg20 世情路径恢复：抽象书级 situation 为时局句主句（原文措辞），拼装句降为无世情时的回退
    // leg21（用户指认）：时局句只领世情——张力（极/方向/强度）归「张力 · 结构性三件套」行，不再混进主句
    const sit = world.context?.setting?.frozen?.canon?.situation;
    const main = sit
        ? escapeHtml(sit)
        : '大势未聚，各方各走各的路';
    const sub = dangerList.length || active.length
        ? `${dangerList.length ? escapeHtml(dangerList.join('、')) + '。' : ''}各方正谋划 ${active.length} 件事${hidden ? `，其中 ${hidden} 件在暗处` : ''}。`
        : '眼下没有在办的谋划，也没有越界的处境。';
    return `<div class="sw2-digest"><div class="sw2-digest-line">${main}</div><div class="sw2-digest-sub">${sub}</div></div>`;
}

// 环境量一行（信息带/设定页共用；leg24 片5）：**书里没给的键不冒充数字**——显示「书未明述」+ 空心条。
// 熵泵照旧按基线推进（引擎内部值，不落账面），所以读数仍可读，只是标明来源。
export function envRowHtml(k, env) {
    const raw = env?.[k];
    if (typeof raw !== 'number') {
        return `<div class="sw2-env-row sw2-nodata"><span class="sw2-env-name">${LABELS.env[k]}</span>`
            + `<span class="sw2-env-bar sw2-env-unknown"></span>`
            + `<span class="sw2-env-val">书未明述<small class="sw2-nodata-tag">无据</small></span></div>`;
    }
    const band = envBand(k, raw);
    return `<div class="sw2-env-row${band.state === 'danger' ? ' sw2-danger' : ''}">`
        + `<span class="sw2-env-name">${LABELS.env[k]}</span>`
        + `<span class="sw2-env-bar"><i style="width:${Math.round(raw * 100)}%;background:${band.state === 'danger' ? 'var(--sw2-red)' : band.state === 'recover' ? 'var(--sw2-green)' : 'var(--sw2-amber)'}"></i></span>`
        + `<span class="sw2-env-val">${raw.toFixed(2)}</span></div>`;
}

export function renderInfoBandHtml(world) {
    const dyn = world.context?.setting?.dynamic;
    const env = dyn?.env || {};
    const pre = !world.meta || world.meta.tick === 0;   // leg21：未演化态诚实标注（基线值非事实值）
    const baselineHint = pre ? ' <span class="sw2-baseline-hint">基线值 · 首轮后随世界演化</span>' : '';
    // leg24 片5：环境四键**只在书里给过值时才落账面**；没给的显示「书未明述（无据）」
    const envRows = ENV_KEYS.map((k) => envRowHtml(k, env));
    const t = dyn?.tension || {};
    const tides = (dyn?.derivedFrom || []).slice(-3).reverse().map((x) => tideLabel(world, x));
    const counts = {
        active: (world.agendas || []).filter((a) => !a.closed).length,
        hidden: (world.agendas || []).filter((a) => !a.closed && a.visibility === 'concealed').length,
        top: (world.agendas || []).filter((a) => !a.closed && !a.parentId).length,
    };
    // K46（细案 C4）+ leg21（用户指认）：大势行 = 真·天下大势一句（世情句领；无世情=未聚——张力不再混入）；
    // 张力行 = 结构性张力三件套独立成行（极/方向/强度带词全部归此行）
    // leg25 b（A1b）：原为「低/中/高烈度 + 百分比」。实测 rival 腿恒为满值 ⇒ 那个 % 实际只反映**事件密度**，
    //   而「烈度」这个词在暗示"引擎判断了天下张力"——它没做到。改为直说可验证的事实：近 10 轮事件几件。
    //   强度数字仍在（setting 页摆原值，且照旧喂模型），只是不再用带词包装它。
    const recentEvents = recentEventCount(world);
    const sit = world.context?.setting?.frozen?.canon?.situation;   // leg20：世情句领大势行（原文措辞）
    const trend = [
        sit ? `${escapeHtml(sit)}。` : '大势未聚（无主张力）。',
        tides.length ? `浪尖：${escapeHtml(tides.slice(0, 2).join('、'))}` : '',
    ].join('');
    return `<div class="sw2-infoband">`
        + `<div class="sw2-band-block"><div class="sw2-band-label">世情 · 四键${baselineHint}</div><div class="sw2-env">${envRows.join('')}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">大势</div><div class="sw2-trend">${trend}</div></div>`
        + `<div class="sw2-band-block"><div class="sw2-band-label">张力 · 结构性三件套</div>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')}<small class="sw2-quiet-note">近${TENSION_WINDOW}轮事件 ${recentEvents} 件</small></div>`
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
    // K38（敲定稿 I 条）：拒签可见——最近一轮的裁定/校验拒绝在动态流顶部露头（世界的重力，应当众；
    // 双面无痕的静默滤除仍不可见；钳制行保留显示但不占拒签计数——口径见 settle rejected 计算）
    const last = (world.meta?.simLog || []).slice(-1)[0];
    const verdicts = (last?.warnings || []).filter((w) => (
        w.startsWith('裁定:') || w.startsWith('校验拒绝:')
    ));
    const verdictBlock = verdicts.length
        ? `<div class="sw2-verdict"><span class="sw2-verdict-tag">⚖ 本轮裁定 ${verdicts.length} 条</span>${escapeHtml(verdicts[0])}</div>`
        : '';
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
    return `<div class="sw2-col-head">动态流 · 最新在上</div>${verdictBlock}<div class="sw2-feed">${rows.join('')}${note}</div>`;
}

export function renderSideHtml(world) {
    const playerId = world.context?.playerId;
    const cards = world.entities
        .filter((e) => !e.status || e.status === 'active')
        .map((e) => {
            const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
            // leg24 片5：撤掉「影响力」分数条（那个数引擎已不消费）；改显示可查的事实——在办/位置/隶属。
            // leg25 c：「有据 n/4」整条删除（四维不存在）；这一行只留结构性事实。
            return `<div class="sw2-entity${e.id === playerId ? ' sw2-player' : ''}">`
                + `<div class="sw2-entity-head"><span class="sw2-entity-name">${escapeHtml(e.name)}</span>`
                + `<span class="sw2-entity-kind">${kindLabel(e, world)}</span>`
                + `<span class="sw2-entity-loc">${escapeHtml(e.location || '未明')}</span></div>`
                + `<div class="sw2-fact-row">`
                + `<span class="sw2-ev-mark${agenda ? '' : ' nodata'}">${agenda ? '在办' : '无在办'}</span>`
                + (e.parent ? `<span class="sw2-ev-mark">隶属 ${escapeHtml(e.parent)}</span>` : '')
                + `</div>`
                + (agenda
                    ? `<div class="sw2-agenda"><b>${escapeHtml(agenda.goal)}</b>${agenda.visibility === 'concealed' ? ' <span class="sw2-visible v-hidden">暗</span>' : ''}</div>`
                    : `<div class="sw2-agenda">${e.id === playerId ? '眼下没有在办的盘算——你的每一步从对话里来。' : '眼下没有在办的盘算。'}</div>`)
                + `<div class="sw2-stage"><span class="sw2-stagetext">${agenda ? `${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}` : (typeof e.lastActiveTick === 'number' ? `最近活跃：${fmtTick(e.lastActiveTick)}` : '')}</span></div>`
                + (e.id === playerId ? '<div class="sw2-note">被大局牵动会伤筋动骨；账上没有的数就是没有据。</div>' : '')
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

export function renderChronicleHtml(world, { oldVolumes = [], filter = null } = {}) {
    // K41 五筛（A-16②）：行选择 = 无 kind 旧账恒显示（不藏）∪ kind ∈ filter；filter=null 全选
    // 闭环/涟漪平息行链目标（第十五棒）：chainRef 优先（新行盖章）→ eventRef（事件行）→
    // 否则按行 id 解析历史闭环行（ch_<tick>_evc[2]_<evId>——行 id 内嵌事件 id；与 msIdTick 同款
    // id 解析纪律：引擎 id 只进 data/title 悬停 A-3 豁免；旧账不篡改=渲染只读派生，不写回账本）
    const chainTarget = (c) => c.chainRef || c.eventRef || (/^ch_\d+_evc2?_(ev_.+)$/.exec(String(c.id || '')) || [])[1] || '';
    const rows = (world.chronicle || []).map((c) => {
        if (filter != null && c.kind && !filter.has(c.kind)) return '';
        const target = chainTarget(c);
        return `<div class="sw2-ch-line${target ? ' sw2-ch-event' : ''}">`
            + `<span class="sw2-ch-round">${c.tick}</span>`
            + `<span class="sw2-ch-text">${escapeHtml(c.text)}</span>`
            + (target ? `<button class="sw2-chainbtn" data-action="open-chain" data-chain="${escapeHtml(target)}" title="${escapeHtml(target)}">链</button>` : '')
            + `</div>`;
    }).filter(Boolean);
    const legacyCount = (world.chronicle || []).filter((c) => !c.kind).length;
    const chip = (token, label, on) => `<span class="sw2-fchip${on ? ' on' : ''}" data-action="set-filter" data-filter="${token}">${label}</span>`;
    const chips = [chip('all', '全部', filter == null)]
        .concat(CHRONICLE_FILTERS.map((f) => chip(f.token, f.label, filter != null && filter.has(f.token))))
        .join('');
    const legacyNote = filter != null && legacyCount > 0
        ? `<em class="sw2-legacy-note">另有 ${legacyCount} 条旧账未分类，任何筛选下始终显示</em>` : '';
    const notes = (world.milestones || []).map((m) => {
        const titles = Array.isArray(m.titles) ? m.titles : (m.title ? [m.title] : []);
        return `<div class="sw2-ch-roll">⚑ 第 1–${msIdTick(m.id)} 轮已收进大事纪「${escapeHtml(titles.join('、'))}」</div>`;
    });
    const volumes = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    const volBlock = volumes.length
        ? `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volumes.join('')}</div>` : '';
    return `<div class="sw2-col-head">编年 · 史卷</div>`
        + `<div class="sw2-ch-filter">${chips}${legacyNote}</div>`
        + `<div class="sw2-chronicle">${rows.join('')}${notes.join('')}</div>${volBlock}`;
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
                ? `<details><summary>展开这一纪的条目</summary><div class="sw2-rawids">${ids.map((id) => `<span class="sw2-rawid">${escapeHtml(id)}<button class="sw2-chainbtn" data-action="open-chain" data-chain="${escapeHtml(id)}" title="${escapeHtml(id)}">链</button></span>`).join(' · ')}</div></details>` : '')
            + `</div>`;
    });
    const volRows = oldVolumes.map((v) => `<div class="sw2-cold-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<span class="sw2-volinfo">${escapeHtml(v.info)}</span><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></div>`);
    return `<div class="sw2-arch-grid">${msCards.join('')}</div>`
        + `<div class="sw2-cold"><h4>旧卷（早于大事纪的编年原文 · 按需阅卷）</h4>${volRows.join('') || '<div class="sw2-cold-row" style="color:var(--sw2-text-faint)">尚未入卷——编年仍在热账。</div>'}</div>`;
}

// ============ 角色与势力页 ============

// 行内查书按钮（leg25 d）：有已定案的栏 → 同时给「重查」；否则只给「查」。
//   口径：查 = forceFields null（只补没定案的）；重查 = forceFields 'absent'（连「书未明述」推倒重来）。
function lookupButtons(e, lookupState) {
    const settled = ['实力', '位置'].some((f) => ['ok', 'absent'].includes(lookupState(f)));
    const ask = `<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="${escapeHtml(e.id)}" title="只补还没定案的栏（已查到的原话不动）">查</button>`;
    const again = settled
        ? `<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="${escapeHtml(e.id)}" data-force="absent" title="连「书未明述」也推倒重查——旧版取书 bug 误标的假「书未明述」靠这个清掉">重查</button>`
        : '';
    return `${ask}${again}`;
}

export function renderEntitiesHtml(world, { config = null } = {}) {
    // K46：镜头名单（pack 引擎层同口径）+ 麾下成员派生——全册展示、镜头徽、分支/隶属
    const lens = new Set(lensList(world).map((x) => x.e.id));
    // leg24 片1（停抄书）：行内「补抽」与头部「补抽未抽属性/隶属」两枚按钮下掉——
    // 它们是"按需从书里抄属性/隶属"的入口（leg21/K49），而这条流水线已整条删除。
    // 名册权威只用于身份（名字+类别）与照书办的结构声明，不再作为按钮候选口径。
    // leg24 片5（界面）：①**撤掉分量条**——那个 0-1 的数引擎已不再消费（用户拍板删），显示它等于把
    //   废数当客观给玩家看（旧法：条 + 数字）；②改成「据/无据」标记——账上真有的才算有据（设计硬规矩一）；
    //   ③属性**只有模型提议过才显示**（空着就是空着，不摆一排 0.5 冒充数据）。
    // leg25 c（用户令「删」）：四维属性 chip（含第十三棒的双通道无障碍写法）**整段删除**——
    //   那些数不存在了，面板上再也没有可渲染的属性列。同一行位置改由查书标记（实力/位置）承担，
    //   书里的说法照抄成文本显示（不再是 0–1 的数）。
    const rows = (world.entities || []).map((e) => {
        const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
        const status = e.status && e.status !== 'active' ? `<span class="sw2-visible ${e.status === 'dead' ? 'v-hidden' : 'v-known'}">${LABELS.status[e.status]}</span>` : '';
        const lensBadge = lens.has(e.id) && (!e.status || e.status === 'active') ? '<span class="sw2-visible v-known">在场</span>' : '';
        // leg23：势力挂到统治者/上级时用「上级」措辞（角色仍是「隶属」）；名下机构/部门单列一行
        const affil = e.parent ? `<div class="sw2-eaffil">${e.kind === 'faction' ? '上级' : '隶属'}：${escapeHtml(e.parent)}</div>` : '';
        const branch = e.kind === 'faction' && e.branches?.length
            ? `<div class="sw2-eaffil">分支：${escapeHtml(e.branches.join('、'))}</div>` : '';
        // leg23：名下机构/部门（书里明述归它管）——势力与统治者（角色）都可能有；旧世界无此字段则零扰动
        const organ = e.organs?.length
            ? `<div class="sw2-eaffil">机构：${escapeHtml(e.organs.join('、'))}</div>` : '';
        const crew = e.kind === 'faction' ? membersOf(world, e) : null;
        // 细案（用户拍板）：**势力不写实力字段**——势力的实力由麾下成员派生显示
        //   （成员各自账上的「实力」原话；没有的不显示，绝不替它算个总档）
        const crewPower = crew
            ? crew.map((n) => {
                const m = (world.entities || []).find((x) => x.name === n);
                return typeof m?.['实力'] === 'string' && m['实力'].trim() ? `${n}（${m['实力']}）` : null;
            }).filter(Boolean)
            : [];
        const crewHtml = crew ? `<div class="sw2-eaffil">麾下：${escapeHtml(crew.join('、'))}</div>` : '';
        // 势力实力＝麾下成员派生显示（用户拍板：势力不写实力字段；没有成员档位就整条不显示，绝不替它算）
        const crewPowerHtml = crewPower.length ? `<div class="sw2-eaffil">麾下实力：${escapeHtml(crewPower.join('、'))}</div>` : '';
        // leg25 c：`dims`（账上有几维数值）**删除**——四维不存在，"有据 n/4"无从谈起。
        //   这一行原来是"据/无据"徽章的来源；现在只剩位置/归属/在办这些**结构性事实**。
        // 细案 spec-entity-field-lookup（用户 2026-09-11）：按需查书补的字段显示**查书标记**——
        //   ①有值=原文原话（角色才有实力）②**未查**=还没轮到查它（新世界的常态，**必须显示**，
        //   否则整栏空白，用户会以为"看不到属性"就是这个插件的全部）③未加载到=查过但模型没给
        //   （可能只是漏抽，下轮再补）④书未明述=引擎确认书里没有相关条目。
        //   ★第二十五棒修正（用户实拍："根本看不到属性"）：旧版只做了 ③④ 两态标签，**②直接空白** = bug。
        const rec = world.meta?.entityFields?.[e.id];
        const lookupState = (f) => rec?.attempts?.[f]?.state ?? 'none';
        const lookupChip = (f, label) => {
            const st = lookupState(f);
            if (st === 'pending') return `<span class="sw2-eattr nodata">${label}<b>未加载到</b></span>`;
            if (st === 'absent') return `<span class="sw2-eattr nodata">${label}<b>书未明述</b></span>`;
            // leg25 d 修（子代理报回、实测确认）：title 属性里原先写了裸双引号（`"未加载到"`），
            //   属性值被就地截断 → 悬停只显示前半句（且残余文字漏成游离文本）。改用「」，
            //   escapeHtml 不转义半角引号，凡是进属性的文案都不许带裸 `"`。
            if (st === 'none') return `<span class="sw2-eattr nodata" title="${escapeHtml(label)}：还没轮到查它（轮到时会按需去世界书取原话；查过之后这里会写「未加载到」或「书未明述」）">${label}<b>未查</b></span>`;
            return '';
        };
        const powerChip = (e.kind === 'character' && typeof e['实力'] === 'string' && e['实力'].trim())
            ? `<span class="sw2-eattr" title="实力：书里明述的原话（角色字段；势力不写实力）"><span class="sw2-visually-hidden">实力：书里明述的原话。</span>实力<b>${escapeHtml(e['实力'])}</b></span>`
            : (e.kind === 'character' ? lookupChip('实力', '实力') : '');   // 势力不显示实力栏（用户拍板）
        // 位置的查书标记标签只在**角色**行给（势力行不摆实力/位置两栏，避免把"势力的实力"又摆回来）
        const posChip = e.kind === 'character' ? lookupChip('位置', '位置') : '';
        const marks = [
            agenda ? '<span class="sw2-ev-mark">在办</span>' : '',
            // 第二十五棒修正（用户实拍："第一个未明是位置未明，后面还有一个位置未明是不是多了"）：
            //   位置这一列负责说"在哪"（没载到写「未载」），**查书标记标签统一收到属性区**（posChip），
            //   这里不再重复打徽章——同一事实只说一遍。
            !e.parent && !(e.organs?.length) && !(e.branches?.length) ? '<span class="sw2-ev-mark nodata">归属空着</span>' : '',
        ].join('');
        return `<div class="sw2-entity-row${e.id === world.context?.playerId ? ' sw2-player' : ''}">`
            + `<div class="sw2-ename">${escapeHtml(e.name)}<small>${kindLabel(e, world)}</small>${lensBadge}</div>`
            + `<div class="sw2-eloc">${
                (e.location && e.location !== '未明')
                    ? escapeHtml(e.location)
                    : (lookupState('位置') === 'absent' ? '书未明述' : '未载')   // 未查过与查过没给，都是"没载到"
            }</div>`
            + `<div class="sw2-ecert">${marks}</div>`
            + `<div class="sw2-eattrs">${[powerChip, posChip].filter(Boolean).join('') || '<span class="sw2-nodata-text">实力/位置未查（轮到时会按需去世界书取原话）</span>'}</div>`
            + `<div class="sw2-eagenda">${agenda ? `<b>${escapeHtml(agenda.goal)}</b> ${agenda.visibility === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : ''}<br>${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}` : (e.id === world.context?.playerId ? '你的每一步从对话里来。' : '眼下没有在办的盘算。')}${status}${affil}${branch}${organ}${crewHtml}${crewPowerHtml}</div>`
            + `<div class="sw2-eactive">最近活跃<br>${typeof e.lastActiveTick === 'number' ? fmtTick(e.lastActiveTick) : '—'}</div>`
            // leg25 d：行内两个入口（细案 §6）。**未查过**只需「查」（补缺）；**已定案**（含被旧 bug
            //   误标的「书未明述」）给「重查」——它走 force 覆盖，否则 absent 是永久闸、永远查不动。
            + `<div class="sw2-elookup">${lookupButtons(e, lookupState)}</div>`
            + `</div>`;
    });
    const allEnts = world.entities || [];
    const quiet = allEnts.filter((e) => e.status && e.status !== 'active').length;   // 退休/已灭（镜外另计）
    // leg25 c：原「其中 N 位账面无数」随四维一起删除——没有数值维度了，"账面无数"这个说法失去所指。
    // leg25 d（细案 spec-lookup-batch-refresh §6）：批量补全入口 + 进度（进度由 config 注入，
    //   渲染层不持任务状态——面板零第二份状态纪律）。
    const task = config?.lookupTask || null;
    const batchBtn = task
        ? `<button class="sw2-btn" data-action="lookup-batch-all" title="再点一次可停；已查到的都留账">■ 停止补全 ${task.cursor}/${task.total}</button>`
        : `<button class="sw2-btn" data-action="lookup-batch-all" title="把全册在册实体的实力/位置按需查一遍（借世界推进分批跑，不阻塞推进；再点一次可停）">⬇ 补全全册实力/位置</button>`;
    const batchHint = task
        ? `<span class="sw2-hint">补全中 ${task.cursor}/${task.total}（成功 ${task.success} · 未加载到 ${task.pending} · 书未明述 ${task.absent} · 失败 ${task.failed}）——随世界推进分批跑</span>`
        : '';
    return `<div class="sw2-list-head">全部角色与势力（全册 ${allEnts.length} · 本轮镜头 ${lens.size}）${quiet ? ` <small class="sw2-quiet-note">另 ${quiet} 位退休/已灭</small>` : ''}<small class="sw2-quiet-note" title="面板构建号：改了代码但页面还是旧的时（浏览器缓存），拿这个对照">构建 ${PANEL_BUILD}</small></div>`
        + `<div class="sw2-list-tools" style="margin:6px 0 8px">${batchBtn}${batchHint}</div>`
        + `<div class="sw2-entity-list">${rows.join('')}</div>`
        + `<div class="sw2-hint">账上只记查到的与玩出来的东西：<b>有值</b>=书里原话；<b>未加载到</b>=查过书但这轮模型没抽出来（下轮再补，不代表书里没有）；<b>书未明述</b>=书里确实没写。每行的<b>查</b>=只补没定的栏，<b>重查</b>=连「书未明述」也推倒重查（旧版误标的假「书未明述」靠它清掉）。</div>`;
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
            + `<div class="sw2-sv-cards"><span class="sw2-sv-chip stale">未抽取</span></div></div>`;
    }
    const envRows = ENV_KEYS.map((k) => envRowHtml(k, env)).join('');
    const tides = (dyn?.derivedFrom || []).slice(-5).reverse().map((x) => tideLabel(world, x)).join('<br>');
    const canon = frozen.canon || {};
    const scaleRows = (canon.powerScale || []).map((p) => `<div class="sw2-sv-row"><b>${escapeHtml(p.level)}</b><span>${escapeHtml(p.note)}</span></div>`).join('');
    const ruleRows = (canon.rules || []).map((r) => `<div class="sw2-sv-row"><b>法则</b><span>${escapeHtml(r)}</span></div>`).join('');
    const histRows = (canon.historyNotes || []).map((h, i) => `<div class="sw2-sv-hist"><span class="sw2-hist-tick">第 ${i + 1} 条</span><span>${escapeHtml(h)}</span></div>`).join('');
    const envTitle = (dyn?.derivedFrom || []).length ? `浪尖（派生源）：${tides}` : '浪尖：暂无';

    return `<div class="sw2-sv-head"><div><div class="sw2-sv-title">世界设定 · ${escapeHtml(world.context?.world || '')}</div>`
        + `<div class="sw2-sv-sub">书指纹 ${escapeHtml(frozen.fingerprint)} · 抽取于 ${escapeHtml(frozen.extractedAt)} · 全部条目取自原文，未增写一句（只提取不创作）</div></div>`
        + `<div class="sw2-sv-cards"><span class="sw2-sv-chip ok">✓ 已冻结 · 设定未变不重抽</span></div></div>`
        + `<div class="sw2-sv-grid">`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>张力现状（演变层 · 引擎算 · 每轮随动）</h4>`
        + `<div class="sw2-clash-main">${escapeHtml(t.polarity || '未聚')} <span class="sw2-int">${fmtPct(t.intensity)}</span></div>`
        + `<div class="sw2-clash-sub">${escapeHtml(t.direction ? t.direction + '（原文方向）' : '僵持（无明确方向）')} · 近${TENSION_WINDOW}轮事件 ${recentEventCount(world)} 件</div>`
        + `<div style="margin-top:6px;font-size:12px;color:var(--sw2-text-faint)">上面这个数是引擎每轮重算的读数（惯性平滑，0–1）。<b>它目前主要由"近${TENSION_WINDOW}轮事件数"驱动</b>——公式里的"两强对峙度"一项实测恒为满值（势力四维普遍为空时会全体同值），所以它并不表示"引擎判断了天下张力"。</div>`
        + `<div class="sw2-env">${envRows}</div>`
        + `<div style="margin-top:8px;font-size:12px;color:var(--sw2-text-faint)">${envTitle}</div>`
        + `<div style="margin-top:10px"><button class="sw2-btn" data-action="clear-evolution">清除演化层（回基线）</button><span class="sw2-hint">只清张力强度/环境量/浪尖——设定与极性方向不动，不触发抽取调用。</span></div></div>`
        + `<div class="sw2-set-card"><h4>力量谱系（${(canon.powerScale || []).length} 档 · 取全）</h4>${scaleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>法则（${(canon.rules || []).length} 条）</h4>${ruleRows || '<div class="sw2-sv-row"><span>（无）</span></div>'}</div>`
        + `<div class="sw2-set-card"><h4>社会格局 · 力量体系</h4><p class="sw2-sv-para">${escapeHtml(canon.society || '（无）')}</p><p class="sw2-sv-para">${escapeHtml(canon.techOrMagic || '（无）')}</p></div>`
        + `<div class="sw2-set-card"><h4>史略（${(canon.historyNotes || []).length} 条）</h4>${histRows || '<div class="sw2-sv-hist"><span>（无）</span></div>'}</div>`
        + `</div>`;
}

// ============ 设置页 ============

export function renderSettingsHtml(world, { config = {}, oldVolumes = [] } = {}) {
    const cfg = config || {};
    const envText = JSON.stringify({ 民生度: 0.5, 动乱度: 0.5, 天时: 0.5, 张力推手: 0.5 });
    void envText;
    return `<div class="sw2-settings">`
        + `<div class="sw2-set-card"><h4>世界设定（书的来源）</h4>`
        + `<div class="sw2-source-line"><span class="sw2-source-tag">来源：角色卡 + 世界信息（自动合订）</span>`
        + `<span class="sw2-source-note">自动读取：卡四件套 + 世界信息/卡内置世界书（世界书全量摄入，大书分块多次抽取）；抽取只拿三样——设定五件套 · 世情句 · 名号与类别（书里的上级/所在/属性不抄，用到时现查）</span></div>`
        + `<div class="sw2-hint" style="margin-top:10px">设定全文（力量谱系/法则/社会格局/力量体系/史略 + 张力现状）在「设定」页阅览；书变了会自动重新识别（书指纹），不用手动重抽。</div></div>`
        + `<div class="sw2-set-card"><h4>你的开档描述</h4>`
        + `<div class="sw2-field"><label>写一段"你是谁"（自然语言 · ≤2000 字提案）</label>`
        + `<textarea id="sw2_player_desc" data-action="player-desc">${escapeHtml(cfg.playerDesc || '')}</textarea>`
        + `<div class="sw2-hint">世界从中摘你的底子（兵力/权位/人脉/耳目）；解析不出的维度就空着，由世界提议；你手填过的一律不动。</div></div></div>`
        + `<div class="sw2-set-card"><h4>模型通道</h4>`
        + `<div class="sw2-field"><label>服务地址</label><input class="sw2-input" id="sw2_base" value="${escapeHtml(cfg.baseUrl || '')}"></div>`
        + `<div class="sw2-field"><label>密钥</label><input class="sw2-input sw2-key-mask" id="sw2_key" value="${escapeHtml(cfg.apiKey ? '••••••••••••••••••••' : '')}"><div class="sw2-hint">本机读取 · 不落库 · 不打印</div></div>`
        + `<div class="sw2-field"><label>世界模型</label><input class="sw2-input" id="sw2_model" value="${escapeHtml(cfg.model || '')}"></div>` 
        + `<div class="sw2-field"><label>单轮演算上限（提案：120 秒 / 4096 字）</label><input class="sw2-input" id="sw2_limits" value="120s · 4096" readonly title="提案值展示 · 随 K38 报批联动后生效"><div class="sw2-hint">提案态：报批前不视为定案，此处仅展示。</div></div></div>`
        + `<div class="sw2-set-card"><h4>操作</h4><div class="sw2-actions">`
        + `<button class="sw2-btn sw2-primary" data-action="init-world">✨ 开始新世界</button>`
        + `<button class="sw2-btn" data-action="advance-world">▶ 手动推进一步</button></div>`
        + `<div class="sw2-hint" style="margin-top:10px">每轮对话后世界自动推进；此按钮是手动补推。<br>设定不用手动重抽：书变了（书指纹变化）自动重新识别，已定的设定不会自己飘。<br>演算失败时世界原样不动，状态条会报错，可重试。</div></div>`
        + `<div class="sw2-set-card" style="grid-column:1/-1"><h4>旧卷与存储</h4>`
        + `<div class="sw2-cold-mgmt"><div class="sw2-row"><span>编年体积 · 当前</span><b>${(world.chronicle || []).length ? `${(JSON.stringify(world.chronicle).length / 1024).toFixed(1)}KB` : '0KB'}</b><em>每 100 轮约 21.7KB（实测）</em></div>`
        + `<div class="sw2-row"><span>自动入卷阈值</span><b class="sw2-thr">${cfg.limitsTicks ?? '500'} 轮 或 ${cfg.limitsBytesMB ?? '5'}MB</b><em>提案态 · 随本阶段报批</em></div>`
        + `<div class="sw2-row"><span>入卷去处</span><b>插件本地 · 可导出可导入</b><em>割断的是旧账，不是来龙去脉</em></div>`
        + `${renderVolumeListHtml(oldVolumes)}<div class="sw2-actions" style="margin-top:8px">`
        + `<button class="sw2-btn" data-action="export-world">⬇ 导出整聊天</button>`
        + `<button class="sw2-btn" data-action="import-world">⬆ 导入恢复</button></div></div>`
        + `</div>`;
}

// K35：旧卷清单（设置页/旧卷页共用行渲染；阅卷=还原前置段回编年视图）
export function renderVolumeListHtml(oldVolumes = []) {
    if (!oldVolumes.length) return `<div class="sw2-row"><span>入卷清单</span><b>尚未入卷——编年仍在热账</b><em></em></div>`;
    const rows = oldVolumes.map((v) => `<div class="sw2-row"><span class="sw2-vol">${escapeHtml(v.id)}</span>`
        + `<b>${escapeHtml(v.info)}</b><em><span class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷</span></em></div>`).join('');
    return `<div class="sw2-row" style="display:block"><span>入卷清单</span>${rows}</div>`;
}

// K35：阅卷还原视图——卷段行（storage.volumeToChronicleRows 产物）→ 编年行 HTML（A-3：引擎 id 只进悬停）
export function renderVolumeReadHtml(volumeId, rows = []) {
    const line = (r) => `<div class="sw2-ch-line${r.eventRef ? ' sw2-ch-event' : ''}">`
        + `<span class="sw2-ch-round">${escapeHtml(r.tick)}</span>`
        + `<span class="sw2-ch-text">${escapeHtml(r.text)}</span>`
        + (r.eventRef ? `<span class="sw2-ref" title="${escapeHtml(r.eventRef)}">？</span>` : '')
        + `</div>`;
    const body = rows.length ? rows.map(line).join('') : '<div class="sw2-ch-line"><span class="sw2-ch-text">（空卷）</span></div>';
    return `<div class="sw2-chronicle" id="sw2_volume_read" data-volume="${escapeHtml(volumeId)}">${body}</div>`;
}

// ============ K41 链视图（细案 §3.2/§3.3 → A-15 渲染面；珠链形态=chain-view-mockup.html v3 沙漏） ============
// 纯函数、零创作：把 chain.js 展开器的节点链渲染成珠链 HTML——id → 玩家名/措辞全在本层；
// 引擎 id 只进悬停 title 与「展开条目」管理区（A-3 豁免口径）；阅卷按钮按纪 span ∩ 卷 fromTick/toTick 装配。

function cvVols(volumes, span) {
    return (volumes || []).filter((v) => {
        const f = Number.isFinite(v.fromTick) ? v.fromTick : -Infinity;
        const t = Number.isFinite(v.toTick) ? v.toTick : Infinity;
        return t >= (span?.from ?? 0) && f <= (span?.to ?? Infinity);
    });
}
const cvOpenBtns = (vols) => (vols.length
    ? `<span class="sw2-cv-vols">${vols.map((v) => `<button class="sw2-volact" data-action="read-volume" data-vol="${escapeHtml(v.id)}">阅卷 · ${escapeHtml(v.id)}</button>`).join('')}</span>`
    : '');
const cvVerdict = (a) => {
    if (!a.closed) return '<span class="sw2-cv-verdict open">在办</span>';
    return (a.blockedTail || '').startsWith('放弃')
        ? '<span class="sw2-cv-verdict stop">已终止</span>'
        : '<span class="sw2-cv-verdict done">已了结</span>';
};
const cvVb = (v) => (v === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : '<span class="sw2-visible v-known">明</span>');
const cvDots = (p, m) => {
    const s = [];
    for (let i = 0; i < m; i += 1) s.push(`<i class="${i < p ? 'on' : ''}"></i>`);
    return `<span class="sw2-cv-dots">${s.join('')}</span>`;
};
const cvChip = (x) => `<span class="sw2-cv-chip${x.visibility === 'concealed' ? ' dark' : ''}">${escapeHtml(x.goal)}${x.visibility === 'concealed' ? '（暗）' : ''} · ${x.closed ? '已了结' : '在办'} ${x.progress ?? 0}/${x.maxSteps ?? 0}</span>`;
const cvSrcPhrase = (n) => {
    if (!n) return '由世界处境而生';
    if (n.kind === 'event') return `沿「${n.title}」而来`;
    if (n.kind === 'agenda') return `由盘算「${n.goal}」而生`;
    if (n.kind === 'milestone') return '源头已入大事纪';
    if (n.kind === 'gap') return '沿「旧事」而来（已无从检索）';
    if (n.kind === 'terminal') return '纪之源头已不可查';
    return '由世界处境而生';
};

function cvUpBeads(world, nodes, volumes) {
    return (nodes || []).map((n, i) => {
        if (n.kind === 'event') {
            const src = cvSrcPhrase(nodes[i - 1]);   // 更远一侧 = 本事件的来路
            return `<div class="sw2-cv-bead ev"><span class="sw2-cv-bk">事</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.title)}<span class="sw2-cv-src">事件 · ${fmtTick(n.born)} · ${n.closed ? '已了结' : '未了结'}</span></div>`
                + `<div class="sw2-cv-meta">${src}</div></div></div>`;
        }
        if (n.kind === 'agenda') {
            return `<div class="sw2-cv-bead ag${n.visibility === 'concealed' ? ' dark' : ''}"><span class="sw2-cv-bk">谋</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.goal)}${cvVb(n.visibility)}${cvVerdict(n)}<span class="sw2-cv-src">谋划 · ${escapeHtml(entityLabel(world, n.owner))} · 阶段 ${escapeHtml(n.stage)}</span></div>`
                + `<div class="sw2-cv-meta">${cvDots(n.progress, n.maxSteps)} ${n.progress}/${n.maxSteps}</div>`
                + (n.doneTail ? `<div class="sw2-cv-meta dim">最近一步：${escapeHtml(n.doneTail)}</div>` : '')
                + (n.blockedTail ? `<div class="sw2-cv-meta dim blk">受阻：${escapeHtml(n.blockedTail)}</div>` : '')
                + (n.parents.length ? `<div class="sw2-cv-meta">委派自上：${n.parents.map(cvChip).join('')}</div>` : '')
                + (n.children.length ? `<div class="sw2-cv-meta">下沿子谋划：${n.children.map(cvChip).join('')}</div>` : '')
                + (n.fruits.length ? `<details class="sw2-cv-roll"><summary>产果 · ${n.fruits.length} 件（由本谋划生的事件）</summary><div class="sw2-cv-in">${n.fruits.map((f) => `${escapeHtml(f.title)}（${fmtTick(f.born)}${f.closed ? ' · 已了结' : ''}）`).join(' · ')}</div></details>` : '')
                + `</div></div>`;
        }
        if (n.kind === 'milestone') {
            return `<div class="sw2-cv-bead ms"><span class="sw2-cv-bk">纪</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">大事纪<span class="sw2-cv-src">第 ${n.span.from}–${n.span.to} 轮 · ${n.counts.events ?? 0} 件事</span></div>`
                + `<div class="sw2-cv-meta">“${(n.titles || []).slice(0, 3).map(escapeHtml).join(' · ')}”</div>`
                + ((n.ids || []).length ? `<details class="sw2-cv-roll"><summary>展开这一纪的条目（管理细节）</summary><div class="sw2-cv-in">${escapeHtml(n.ids.join(' · '))}</div></details>` : '')
                + cvOpenBtns(cvVols(volumes, n.span))
                + ((n.parents || []).length ? `<div class="sw2-cv-nest">${cvUpBeads(world, n.parents, volumes)}</div>` : '')
                + `</div></div>`;
        }
        if (n.kind === 'state-root') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">由世界处境而生<span class="sw2-cv-src">终节点 · 不再更上</span></div>`
                + `<div class="sw2-cv-meta">处境是事件的起点——账上没有比它更早的来路。</div></div></div>`;
        }
        if (n.kind === 'gap') {
            return `<div class="sw2-cv-bead gap"><span class="sw2-cv-bk">旧</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${n.reason === 'ring' ? '环防' : '沿「旧事」而来'}<span class="sw2-cv-src">${n.reason === 'ring' ? '至此为止' : '已无从检索'}</span></div>`
                + `<div class="sw2-cv-meta">${n.reason === 'ring' ? '引用成环，链在此剪断（账不可信处的如实标注）。' : '引用的上游既不在热账也不在任何大事纪——正直展示，不猜内容。'}</div></div></div>`;
        }
        if (n.kind === 'terminal') {
            return `<div class="sw2-cv-bead term"><span class="sw2-cv-bk">源</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">纪之源头已不可查（旧账）<span class="sw2-cv-src">最老的大纪</span></div>`
                + `<div class="sw2-cv-meta">最老的纪没有记录更早的来路——如实显示，不猜不编。</div></div></div>`;
        }
        return '';
    }).join('');
}

function cvDownTree(world, nodes, volumes) {
    const bead = (n) => {
        if (n.kind === 'event') {
            return `<div class="sw2-cv-branch"><div class="sw2-cv-bead ev"><span class="sw2-cv-bk">事</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">${escapeHtml(n.title)}<span class="sw2-cv-src">事件 · ${fmtTick(n.born)} · ${n.closed ? '已了结' : '未了结'}${n.ring ? '（环防）' : ''}</span></div></div></div>`
                + ((n.children || []).length ? `<div class="sw2-cv-nest">${n.children.map(bead).join('')}</div>` : '')
                + `</div>`;
        }
        if (n.kind === 'leaf-note') {
            return `<div class="sw2-cv-branch"><div class="sw2-cv-bead leaf"><span class="sw2-cv-bk">卷</span><div class="sw2-cv-bt">`
                + `<div class="sw2-cv-nm">另有后续在旧卷<span class="sw2-cv-src">第 ${n.span.from}–${n.span.to} 轮 · 已随段入卷</span></div>`
                + `<div class="sw2-cv-meta">这一支的后续牵动已随段入卷——阅卷看全文。${cvOpenBtns(cvVols(volumes, n.span))}</div></div></div></div>`;
        }
        return '';
    };
    return `<div class="sw2-cv-col">牵动 · 下沿（▼ 向未来）</div><div class="sw2-cv-tree">${(nodes || []).map(bead).join('')}</div>`;
}

export function renderChainViewHtml(chain, { world, volumes = [] } = {}) {
    if (!chain || !chain.ok) {
        return `<div class="sw2-cv" id="sw2_chain_view"><div class="sw2-cv-head"><div class="sw2-cv-t">事件链</div>`
            + `<button class="sw2-btn sw2-cv-close" data-action="chain-close">收起</button></div>`
            + `<div class="sw2-cv-def">没有这条事件（已无从检索）。</div></div>`;
    }
    const root = chain.root;
    const isMs = root.kind === 'milestone';
    const nearSrc = (chain.up || []).at(-1);
    const up = isMs ? (root.parents || []) : (chain.up || []);
    const hero = isMs
        ? `<div class="sw2-cv-hero"><span class="sw2-cv-hx">纪</span><div><div class="sw2-cv-hn">大事纪 · 第 ${root.span.from}–${root.span.to} 轮 · ${root.counts.events ?? 0} 件事</div>`
            + `<div class="sw2-cv-hm">“${(root.titles || []).slice(0, 3).map(escapeHtml).join(' · ')}”${cvOpenBtns(cvVols(volumes, root.span))}</div></div></div>`
        : `<div class="sw2-cv-hero"><span class="sw2-cv-hx">事</span><div><div class="sw2-cv-hn">“${escapeHtml(root.title)}”</div>`
            + `<div class="sw2-cv-hm"><span><b>源自</b>：${cvSrcPhrase(nearSrc)}</span><span><b>事发</b>：${escapeHtml(root.position)}</span>`
            + `<span><b>${fmtTick(root.born)}</b> · ${root.closed ? '已了结' : '未了结'}</span></div></div></div>`;
    return `<div class="sw2-cv" id="sw2_chain_view">`
        + `<div class="sw2-cv-head"><div class="sw2-cv-t">${isMs ? '大事纪的来去' : `事件「${escapeHtml(root.title)}」的来去`}</div>`
        + `<button class="sw2-btn sw2-cv-close" data-action="chain-close">收起</button></div>`
        + `<div class="sw2-cv-col">来路 · 上承（▲ 向更早）</div><div class="sw2-cv-rail">${cvUpBeads(world, up, volumes)}</div>`
        + `<div class="sw2-cv-axis"></div>${hero}<div class="sw2-cv-axis"></div>`
        + cvDownTree(world, chain.down || [], volumes)
        + `<div class="sw2-cv-foot">全部为一手事实拼句：来路/牵动取自账本指针与落账文本，引擎不新编一字。</div>`
        + `</div>`;
}

// ============ 六页签全集入口（K34 接线用；同输入逐字节一致 A-2 锁） ============

export function renderAll(world, { config = {}, oldVolumes = [], view = {} } = {}) {
    return {
        board: renderBoardHtml(world),
        chronicle: renderChronicleHtml(world, { oldVolumes, filter: view.chronicleFilter ?? null }),
        archive: renderArchiveHtml(world, { oldVolumes }),
        entities: renderEntitiesHtml(world, { config }),
        setting: renderSettingHtml(world),
        settings: renderSettingsHtml(world, { config, oldVolumes }),
        header: {
            world: world.context?.world ?? '',
            tick: fmtTick(world.meta?.tick ?? 0),
        },
    };
}
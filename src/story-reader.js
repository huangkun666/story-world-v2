// Reading projections only: grouping and viewing windows remain in panorama.js.
import { buildPanorama, archivedEventsOf, bornTick, stripEngine, resolveIds } from './panorama.js';
import { escapeHtml as esc } from './render-base.js';

const tickValue = value => value == null || value === '' || typeof value === 'boolean' ? null
    : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const stateLabel = story => !story.live ? '已收场' : story.growing ? '还在往下长' : '挂着没了结';
const tickLabel = tick => tick == null ? '轮次在账上没记' : `第 ${tick} 轮`;
const fieldKeys = ['所属', '身份', '定位', '实力', '性质', '倾向', '规模'];

// 只折叠记录器生成的两种来路说明；其他经过话保留在正文。
const LINK_FORMS = [
    { form: /^因事而生[:：]/, summary: '相关打算' },
    { form: /^由处境而生[:：]/, summary: '来路' },
];
const linkSummary = text => LINK_FORMS.find(({ form }) => form.test(String(text ?? '').trim()))?.summary || '';
const MISSING_CAUSE = '来路在账上没记';
const timeOf = record => typeof record?.timeMark === 'string' ? record.timeMark.trim() : '';
// 同轮先读进展，再读收场；各类记录内部及跨轮次的顺序保持不变。
function readingOrder(chapters) {
    const out = [];
    for (let at = 0; at < chapters.length;) {
        const round = chapters[at].tick ?? null;
        let end = at;
        while (end < chapters.length && (chapters[end].tick ?? null) === round) end += 1;
        const group = chapters.slice(at, end);
        out.push(...group.filter(chapter => chapter.kind !== 'closure'), ...group.filter(chapter => chapter.kind === 'closure'));
        at = end;
    }
    return out;
}

export function buildStoryReader(world, opts = {}) {
    const { threads, stats } = buildPanorama(world, opts);
    const pool = [...(world?.events || []), ...archivedEventsOf(world)];
    const rawEvents = new Map(pool.map(event => [String(event.id), event]));
    const names = new Map(pool.filter(event => event.title).map(event => [String(event.id), String(event.title)]));
    for (const entity of world?.entities || []) if (entity.name) names.set(String(entity.id), String(entity.name));
    for (const agenda of world?.agendas || []) if (agenda.goal) names.set(String(agenda.id), String(agenda.goal));
    const clean = text => stripEngine(resolveIds(text, names))
        .replace(/\b(?:ev_seed_\d+|ev_\d+(?:_\d+)?|e_bk_\d+|e_p\d+|e_\d+_\d+|a_\d+_\d+|m_\d+|ch_\d[\w]*)\b/g, '').trim();
    const eventTimes = new Map(pool.filter(timeOf).map(event => [String(event.id), timeOf(event)]));
    const traceKey = (eventId, tick, text) => JSON.stringify([String(eventId ?? ''), tickValue(tick), clean(text)]);
    const traceTimes = new Map((world?.chronicle || []).filter(timeOf).map(row => [traceKey(row.eventRef, row.tick, row.text), timeOf(row)]));
    const recent = threads.map(thread => {
        const eventIds = new Set(thread.events.map(event => String(event.id)));
        const agendaIds = new Set(thread.events.map(event => rawEvents.get(String(event.id))?.source).filter(source => source?.type === 'plot').map(source => source.ref));
        const agendas = (world?.agendas || []).filter(agenda => agendaIds.has(agenda.id) || (agenda.source?.type === 'event' && eventIds.has(String(agenda.source.ref))));
        const chapters = [];
        const add = (kind, tick, title, text = '', extra = {}) => {
            const item = { kind, tick: tickValue(tick), title: clean(title), text: clean(text), ...extra };
            if (item.title || item.text) chapters.push(item);
        };
        for (const event of thread.events) {
            const raw = rawEvents.get(String(event.id));
            // 只认这件事自己的时间或出生记录；不沿用同轮别件事的时刻。
            const birth = (world?.chronicle || []).find(row => String(row.eventRef) === String(event.id) && timeOf(row)
                && (String(row.text).trim() === raw?.title || String(row.text).startsWith(`事件「${raw?.title}」`)));
            // panorama's legacy tick fallback is 0; absent source dates stay absent here.
            const why = clean(event.why);
            add('event', bornTick(event.id) ?? tickValue(raw?.tick), event.title, event.why,
                { position: event.position || '', people: event.ripples, eventId: String(event.id), causeMissing: !why || why === MISSING_CAUSE, timeMark: eventTimes.get(String(event.id)) || timeOf(birth) });
            const explicit = (world?.chronicle || []).filter(row => row.eventRef === event.id && !/^事件「/.test(String(row.text)));
            const traces = [...event.traces, ...explicit];
            for (const trace of traces) if (clean(trace.text) !== clean(event.title)) add('trace', trace.tick, '', trace.text, { eventId: String(event.id), link: linkSummary(trace.text), timeMark: timeOf(trace) || traceTimes.get(traceKey(event.id, trace.tick, trace.text)) || traceTimes.get(traceKey('', trace.tick, trace.text)) || '' });
            if (event.closed && (event.closedAt != null || event.closedWhy)) add('closure', event.closedAt, '收场', event.closedWhy || '', { eventId: String(event.id), eventTitle: event.title });
        }
        for (const agenda of agendas) {
            for (const [kind, lines] of [['step', agenda.memory?.done], ['turn', agenda.memory?.blocked]]) {
                for (const line of lines || []) {
                    const raw = String(line); const stamp = /^t(\d+)[:：]\s*/.exec(raw);
                    add(kind, stamp ? Number(stamp[1]) : null, '', raw.replace(/^t\d+[:：]\s*/, ''), { actor: names.get(String(agenda.owner)) || '' });
                }
            }
        }
        // The same sentence can occur in both memories and the chronicle; show it once.
        const unique = chapters.filter((chapter, index) => !chapters.slice(0, index).some(previous =>
            chapter.kind !== 'event' && previous.tick === chapter.tick && (previous.text || previous.title) === (chapter.text || chapter.title)));
        unique.sort((a, b) => (a.tick ?? Infinity) - (b.tick ?? Infinity));
        // 展示顺序独立于首页的最新变化选择。
        const ordered = readingOrder(unique);
        const priority = { event: 1, step: 2, turn: 2, trace: 3, closure: 4 };
        const candidates = unique.filter(chapter => chapter.kind !== 'closure' || chapter.text);
        const dated = candidates.filter(chapter => chapter.tick != null).sort((a, b) => b.tick - a.tick || priority[b.kind] - priority[a.kind]);
        const change = dated[0] || candidates.at(-1) || { text: '', title: '', tick: null };
        const name = clean(thread.kicker?.goal) || clean(thread.name);
        const search = [name, thread.actor, ...thread.actors, ...thread.places, ...unique.flatMap(chapter => [chapter.title, chapter.text, chapter.actor, chapter.position, chapter.timeMark])].filter(Boolean).join(' ');
        return { ...thread, name, chapters: ordered, progressTick: change.tick, change: { ...change, text: change.kind === 'event' ? change.title : change.text || change.title }, search };
    }).sort((a, b) => (b.progressTick ?? -Infinity) - (a.progressTick ?? -Infinity) || String(a.id).localeCompare(String(b.id)));
    const contexts = [];
    for (const entity of world?.entities || []) {
        if (!entity.id || !entity.name) continue;
        const fields = { ...Object.fromEntries(fieldKeys.filter(key => entity[key] != null && entity[key] !== '').map(key => [key, entity[key]])), ...(entity.fields || {}) };
        contexts.push({ key: String(entity.id), name: String(entity.name), kind: entity.kind === 'faction' ? '势力' : entity.kind === 'location' ? '地点' : '人物',
            fields: Object.entries(fields).filter(([, value]) => typeof value === 'string' && value).map(([key, value]) => [key, clean(value)]),
            location: entity.location && entity.location !== '未明' ? String(entity.location) : '',
            stories: recent.filter(story => story.actors.includes(entity.name) || story.actor === entity.name || story.chapters.some(chapter => chapter.actor === entity.name)) });
    }
    const places = new Set([...(world?.context?.positions || []), ...recent.flatMap(story => story.places), ...contexts.map(context => context.location)].filter(place => typeof place === 'string' && place && place !== '未明'));
    for (const place of places) contexts.push({ key: `loc:${place}`, name: place, kind: '地点', fields: [], location: '', stories: recent.filter(story => story.places.includes(place)) });
    return { recent, contexts, stats, background: clean(world?.context?.setting?.frozen?.canon?.situation || ''), world: String(world?.context?.world || ''), tick: tickValue(world?.meta?.tick) };
}

const contextButton = context => `<button type="button" class="sw2-story-mention" data-story-kind="${esc(context.kind)}" data-story-context="${esc(context.key)}">${esc(context.name)}</button>`;
function mentionRenderer(contexts) {
    const byName = new Map();
    for (const context of contexts) if (!byName.has(context.name)) byName.set(context.name, context);
    const names = [...byName.keys()].sort((a, b) => b.length - a.length);
    if (!names.length) return text => esc(text);
    const pattern = new RegExp(names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    return (text, interactive = false) => {
        const value = String(text ?? ''); let html = '', from = 0;
        for (const match of value.matchAll(pattern)) {
            const context = byName.get(match[0]);
            html += esc(value.slice(from, match.index)) + (interactive ? contextButton(context)
                : `<span class="sw2-story-mention" data-story-kind="${esc(context.kind)}">${esc(match[0])}</span>`);
            from = match.index + match[0].length;
        }
        return html + esc(value.slice(from));
    };
}
/** 默认折起，展开显示原文；控制器按记录身份恢复展开状态。 */
const traceDetails = (key, summary, text, mention) => `<details class="sw2-story-trace" data-pan-key="${esc(key)}"><summary>${esc(summary)}</summary><p>${mention(text, true)}</p></details>`;
function chapterSection(chapter, chapterIndex, prefix, storyKey, mention, previousActor) {
    const parts = [];
    const recordKey = JSON.stringify([storyKey, chapter.kind, chapter.eventId, chapter.actor, chapter.tick, chapter.title, chapter.text]);
    if (chapter.kind === 'closure') {
        // 单件事收场以后，同一条故事仍可能继续。
        parts.push('<p class="sw2-story-closure-mark">单件事收场</p>');
        if (chapter.text) parts.push(`<p>${mention(chapter.text, true)}</p>`);
        if (chapter.eventTitle) parts.push(traceDetails(`${recordKey}-event`, '对应的事', chapter.eventTitle, mention));
    } else {
        if (chapter.title) parts.push(`<h2>${mention(chapter.title, true)}</h2>`);
        if (chapter.timeMark) parts.push(`<p class="sw2-story-chapter-time" data-story-time>时间：${esc(chapter.timeMark)}</p>`);
        if (chapter.kind === 'event') {
            if (chapter.text && !chapter.causeMissing) parts.push(traceDetails(`${recordKey}-origin`, '来路', chapter.text, mention));
            else parts.push(`<p class="sw2-story-chapter-note">${esc(MISSING_CAUSE)}</p>`);
        } else if (chapter.text && chapter.link) parts.push(traceDetails(`${recordKey}-link`, chapter.link, chapter.text, mention));
        else if (chapter.text) parts.push(`<p>${mention(chapter.text, true)}</p>`);
        if (chapter.actor && chapter.actor !== previousActor) parts.push(`<p class="sw2-story-caption">${mention(chapter.actor, true)}的经过</p>`);
    }
    const where = [chapter.position, chapter.people?.length ? chapter.people.join('、') : ''].filter(Boolean);
    if (where.length) parts.push(`<p class="sw2-story-chapter-where">${where.map(text => mention(text, true)).join(' · ')}</p>`);
    return `<section class="sw2-story-chapter" id="${prefix}-chapter-${chapterIndex}"${chapter.kind === 'closure' ? ' data-story-closure' : ''}>${parts.join('')}</section>`;
}
function storyArticle(story, index, contexts, mention) {
    const prefix = `sw2-story-${index}`, storyKey = `story-${story.id}`;
    const latestIndex = Math.max(0, story.chapters.findIndex(chapter => chapter.kind === story.change.kind && chapter.tick === story.change.tick && (chapter.kind === 'event' ? chapter.title : chapter.text || chapter.title) === story.change.text));
    const first = `${prefix}-chapter-0`, last = `${prefix}-chapter-${latestIndex}`;
    const people = contexts.filter(context => context.kind !== '地点' && context.stories.includes(story));
    const places = contexts.filter(context => context.key.startsWith('loc:') && story.places.includes(context.name));
    // 轮次只在左侧显示一次；未记轮次的记录仍单独放在最后。
    const rounds = [];
    for (const [chapterIndex, chapter] of story.chapters.entries()) {
        const round = chapter.tick ?? null;
        const previous = rounds[rounds.length - 1];
        if (previous && previous.round === round) previous.items.push([chapterIndex, chapter]);
        else rounds.push({ round, items: [[chapterIndex, chapter]] });
    }
    let previousActor = '';
    const chapters = rounds.map(round => '<section class="sw2-story-round">'
        + `<h3 class="sw2-story-round-head" data-story-round-head="${round.round ?? ''}">${esc(tickLabel(round.round))}</h3>`
        + '<div class="sw2-story-round-body">'
        + round.items.map(([chapterIndex, chapter]) => {
            const html = chapterSection(chapter, chapterIndex, prefix, storyKey, mention, previousActor);
            previousActor = chapter.actor || '';
            return html;
        }).join('')
        + '</div></section>').join('');
    return `<article data-story-detail data-story-id="${esc(story.id)}" hidden>`
        + '<button type="button" data-story-back>← 返回近况</button>'
        + `<h1 class="sw2-story-title">${mention(story.name, true)}</h1>`
        + `<div class="sw2-story-detail-meta"><span>${esc(stateLabel(story))}</span><span>${story.count} 件事</span><span>最近记录：${esc(tickLabel(story.progressTick))}</span></div>`
        + (people.length || places.length ? `<div class="sw2-story-context-links"><span>人物与地点</span>${[...people, ...places].map(contextButton).join('')}</div>` : '')
        + `<div class="sw2-story-jumps"><button type="button" data-story-jump="${first}">起头</button><button type="button" data-story-jump="${last}">最新进展</button></div>`
        + chapters
        + '<p class="sw2-story-source">来路、经过与收场取自已有记录。更早的旧事可在「大事纪·旧卷」查看。</p></article>';
}

export function renderStoryReaderHtml(world, opts = {}) {
    const model = buildStoryReader(world, opts);
    const { recent, contexts, stats } = model;
    const mention = mentionRenderer(contexts);
    const groups = new Map();
    for (const story of recent) { const key = story.progressTick ?? ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(story); }
    const rows = [...groups].map(([tick, stories]) => '<div data-story-group data-story-round-group>'
        + `<div data-story-round="${tick}">${tick === '' ? '轮次未记' : `第 ${tick} 轮的进展`}</div>`
        + stories.map(story => `<button type="button" data-story-row data-story-open="${esc(story.id)}" data-story-id="${esc(story.id)}" data-story-live="${story.live}" data-story-tick="${story.progressTick ?? ''}" data-story-search="${esc(story.search)}">`
            + `<span class="sw2-story-row-main"><span class="sw2-story-change">${mention(story.change.text)}</span><span class="sw2-story-row-meta"><span>${mention(story.name)}</span>${story.places.length ? `<span>${mention(story.places.join(' · '))}</span>` : ''}</span></span>`
            + `<span class="sw2-story-state">${stateLabel(story)}</span><span class="sw2-story-arrow" aria-hidden="true">›</span></button>`).join('') + '</div>').join('');
    const emptyText = stats.windowFrom != null && stats.eventsAll ? `最近 ${stats.panelTurns} 轮里没有留下可读的故事。更早的旧事可在「大事纪·旧卷」查看。` : '这本账还没有留下可读的故事。';
    return `<div class="sw2-story-app" data-story-app data-pan-world="${esc(model.world)}">`
        + `<nav class="sw2-story-nav" data-story-nav aria-label="世界阅读"><button type="button" data-story-home aria-current="page">世界近况</button><span class="sw2-story-world">${esc(model.world)}</span>`
        + `<button type="button" data-story-world>查世界</button>${model.tick != null ? `<span>${tickLabel(model.tick)}</span>` : ''}</nav>`
        + '<div class="sw2-merged-main sw2-story-scroll"><section data-story-home-panel>'
        + '<header class="sw2-story-home-head"><h1>最近，世界发生了什么</h1>'
        + `<p class="sw2-story-intro">${recent.length} 段故事 · 先看变化，再展开感兴趣的故事。</p></header>`
        + (model.background ? `<details data-story-background><summary>世界背景</summary><p>${mention(model.background)}</p></details>` : '')
        + '<div class="sw2-story-tools"><div class="sw2-story-views" role="tablist" aria-label="故事范围"><button type="button" role="tab" data-story-view="recent" aria-selected="true">最近发生</button><button type="button" role="tab" data-story-view="unresolved" aria-selected="false">仍未结束</button></div><button type="button" data-story-search-toggle aria-expanded="false">⌕ 搜索故事</button></div>'
        + '<div data-story-search-box hidden><input type="search" data-story-search-input aria-label="搜索人物、地点或故事" placeholder="人物、地点或故事中的词语"><button type="button" data-story-clear hidden>清空</button></div><span data-story-results role="status" aria-live="polite"></span>'
        + `<div data-story-list>${rows}</div>`
        + (!recent.length ? `<p data-story-empty>${esc(emptyText)}</p>` : '')
        + '<p data-story-no-results hidden></p><p class="sw2-story-source">每条故事只列一次，按最近一次有轮次记录的进展排列。</p></section>'
        + recent.map((story, index) => storyArticle(story, index, contexts, mention)).join('') + '</div>'
        + '<aside class="sw2-story-drawer" data-story-drawer hidden role="dialog" aria-label="人物与地点"><div class="sw2-story-drawer-head"><span>人物与地点</span><button type="button" data-story-close-context aria-label="关闭人物与地点">关闭 ×</button></div>'
        + '<section data-story-world-panel hidden><h2>查世界</h2><details class="sw2-story-world-facts" data-pan-key="story-world-facts"><summary>世界现状、各方打算与地图</summary><!-- STORY_WORLD_ATTACH --></details><h3>查人物与地点</h3><input type="search" data-story-world-input aria-label="搜索世界名册" placeholder="输入人物、势力或地点"><div class="sw2-story-world-index">'
        + contexts.map(context => `<button type="button" data-story-world-entry data-story-context="${esc(context.key)}"><span>${esc(context.name)}</span><small>${context.kind}</small></button>`).join('') + '</div><p data-story-world-empty hidden>没有找到匹配的名号或地点。</p></section>'
        + contexts.map(context => `<section data-story-context-panel data-story-context-id="${esc(context.key)}" hidden><button type="button" data-story-world>← 查世界</button><h2>${esc(context.name)}</h2><p class="sw2-story-caption">${context.kind}</p>`
            + (context.location ? `<p>所在：${esc(context.location)}</p>` : '')
            + (context.fields.length ? `<dl>${context.fields.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>` : '')
            + `<h3>相关故事${context.stories.length ? '' : ' · 这个阅读窗口内没有记录'}</h3>`
            + context.stories.map(story => `<button type="button" data-story-open="${esc(story.id)}">${esc(story.name)}</button>`).join('') + '</section>').join('')
        + '</aside></div>';
}

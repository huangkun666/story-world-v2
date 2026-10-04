import { buildMapData } from './geography.js';
import { escapeHtml } from './render-base.js';
import { buildStoryReader } from './story-reader.js';
import { archivedEventsOf } from './panorama.js';
const esc = escapeHtml;
const labels = { within: '包含', adjacent: '相邻', passage: '通道' };
const storyHtml = story => `<details class="sw2-map-record"><summary>${esc(story.name)}</summary>${story.chapters.map(chapter => `<article><h5>${esc(chapter.title || '经过')}</h5><p>${chapter.tick == null ? '轮次未载' : `第 ${esc(chapter.tick)} 轮`}${chapter.timeMark ? ` · ${esc(chapter.timeMark)}` : ''}${chapter.kind === 'event' ? ` · 事发地点：${esc(chapter.position || '位置未载')}` : ''}</p><p>${esc(chapter.text || '')}</p></article>`).join('')}</details>`;
const placeButton = (p) => `<button type="button" class="sw2-btn" data-map-action="place" data-place="${esc(p.id)}">${esc(p.name)}${p.qualifier ? ` · ${esc(p.qualifier)}` : ''}</button>`;
const changeHtml = (change) => change ? `<p>${change.tick !== undefined ? `第 ${esc(change.tick)} 轮 · ` : ''}${change.prev !== undefined ? `此前：${esc(change.prev)} · ` : ''}${change.cause !== undefined ? `原因：${esc(change.cause)}` : '原因未载'}</p>` : '';
const entityHtml = (e, world) => `<details class="sw2-map-record"><summary>${esc(e.name)}${e.id === world?.context?.playerId ? ' · 你' : ''} · ${esc(e.locationSource || '来源未载')}</summary><p>账上位置：${esc(e.locationText || '位置未载')} · ${esc(e.status === 'ambiguous' ? '地点有歧义' : e.locationSource || '来源未载')}</p>${e.locationSourceFrom ? `<p>${esc(e.locationSourceFrom)}</p>` : ''}${changeHtml(e.locationChange)}<p>${esc(e.kind === 'faction' ? '势力' : '角色')} · ${esc(e.实力 || '')}</p></details>`;
const eventHtml = (e) => `<details class="sw2-map-record"><summary>${esc(e.title || '事件')}</summary><p>事发地点：${esc(e.locationText || e.position || '位置未载')} · ${esc(e.status === 'ambiguous' ? '地点有歧义' : '账上事件')}</p><p>${esc(e.description || e.detail || e.summary || '')}</p></details>`;
export function renderMapHtml(world, { placeId = '', query = '' } = {}) {
    const events = new Map(archivedEventsOf(world).map(e => [e.id, e]));
    for (const event of world?.events || []) events.set(event.id, event);
    const data = buildMapData({ ...world, events: [...events.values()] }); const places = data.places; const byId = new Map(places.map(p => [p.id, p]));
    // Canonical recorded stories; event location alone associates them with a place.
    const stories = buildStoryReader(world, { panelTurns: Number.MAX_SAFE_INTEGER }).recent;
    const storiesFor = observations => {
        const ids = new Set(observations.map(e => String(e.id)));
        return stories.filter(story => story.chapters.some(chapter => chapter.eventId && ids.has(chapter.eventId)));
    };
    const needle = query.trim().toLocaleLowerCase(); const matches = (values) => !needle || values.some(v => String(v || '').toLocaleLowerCase().includes(needle));
    const shown = places.filter(p => matches([p.name, ...(p.aliases || []), ...(p.entities || []).map(e => e.name), ...(p.events || []).map(e => e.title), ...storiesFor(p.events || []).map(story => story.search)]));
    const selected = shown.find(p => p.id === placeId) || shown[0];
    const relevant = selected ? data.links.filter(l => l.from === selected.id || l.to === selected.id) : [];
    const related = (ids) => (ids || []).map(id => byId.get(id)).filter(Boolean).map(placeButton).join(' ') || '关系未载';
    const relations = relevant.map(l => {
        const target = byId.get(l.from === selected.id ? l.to : l.from);
        return `<li>${esc(l.type === 'within' ? (l.from === selected.id ? '位于其中' : '包含下层') : labels[l.type] || l.type)}：${target ? placeButton(target) : ''}${l.type === 'passage' ? ` · ${esc(l.via || '通道名称未载')} · ${l.direction === 'both' ? '双向' : l.direction === 'forward' ? `${esc(byId.get(l.from)?.name || '')} → ${esc(byId.get(l.to)?.name || '')}` : '方向未载'}${l.condition ? ` · ${esc(l.condition)}` : ''}` : ''}</li>`;
    }).join('');
    // Layout positions are for reading only; every SVG line corresponds to a recorded relation.
    const neighbors = [...new Set(relevant.map(l => l.from === selected?.id ? l.to : l.from))];
    const height = Math.max(80, neighbors.length * 55 + 20);
    const graph = relevant.length ? `<svg class="sw2-map-graph" viewBox="0 0 500 ${height}" role="img" aria-label="已记录的地点关系">${relevant.map(l => { const id = l.from === selected.id ? l.to : l.from; const y = 30 + neighbors.indexOf(id) * 55; return `<line x1="110" y1="${height / 2}" x2="320" y2="${y}" class="sw2-map-edge-${esc(l.type)}"><title>${esc(labels[l.type])} · ${esc(l.direction || '方向未载')}</title></line>`; }).join('')}<text x="5" y="${height / 2 - 8}">${esc(selected.name)}</text>${neighbors.map((id, i) => `<text x="325" y="${30 + i * 55}">${esc(byId.get(id)?.name || '')}</text>`).join('')}</svg>` : '<p>关系未载</p>';
    const unEntities = data.unlocated.entities.filter(e => matches([e.name, e.locationText])); const unEvents = data.unlocated.events.filter(e => matches([e.title, e.description]));
    const selectedEntities = (selected?.entities || []).filter(e => matches([e.name, selected.name, ...(selected.aliases || [])]));
    const selectedEvents = (selected?.events || []).filter(e => matches([e.title, e.description, selected.name, ...(selected.aliases || [])]));
    const selectedStories = storiesFor(selected?.events || []).filter(story => matches([story.search, selected?.name, ...(selected?.aliases || [])]));
    const unlocatedStories = storiesFor(data.unlocated.events).filter(story => matches([story.search]));
    return `<header class="sw2-map-head"><h2 id="sw2_map_title">地图</h2><button type="button" class="sw2-btn" data-map-action="extract">${data.generated ? '重抽地图' : '补抽地图'}</button><button type="button" class="sw2-btn" data-map-action="refresh">刷新</button><button type="button" class="sw2-btn" data-map-action="close">关闭</button></header>`
        + `<label class="sw2-map-search">搜索地点、别名、人物或事件 <input data-map-search type="search" value="${esc(query)}"></label><p class="sw2-map-status">${!data.generated ? '地图未生成' : !data.links.length ? '本次未提取到关系' : `${data.places.length} 处 · ${data.links.length} 条关系`} · 排版位置不表示方向或路程</p>`
        + `<div class="sw2-map-columns"><nav aria-label="地图区域"><h3>区域与地点</h3>${shown.map(placeButton).join(' ') || '<p>没有匹配的地点</p>'}</nav><section><h3>${esc(selected?.name || '地点详情')}${selected?.qualifier ? ` · ${esc(selected.qualifier)}` : ''}${selected?.observed ? ' · 关系未载' : ''}</h3><p>上层：${related(selected?.parents)}</p><p>下层：${related(selected?.children)}</p>${graph}<ul>${relations}</ul><h4>账上人物与势力</h4>${selectedEntities.map(e => entityHtml(e, world)).join('') || '<p>位置记录未载</p>'}<h4>相关事件</h4>${selectedEvents.map(eventHtml).join('') || '<p>事件记录未载</p>'}<h4>相关故事与经过</h4>${selectedStories.map(storyHtml).join('') || '<p>故事记录未载</p>'}</section><section class="sw2-map-unlocated"><h3>位置未载或有歧义</h3><p>未载不代表在别处，仍可查看和活动。</p>${unEntities.map(e => entityHtml(e, world)).join('')}${unEvents.map(eventHtml).join('')}${unlocatedStories.map(storyHtml).join('')}</section></div>`;
}

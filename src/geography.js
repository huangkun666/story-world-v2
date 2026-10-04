// Pure read projections: source geography and free-text observations stay separate.
import { GEOGRAPHY_VERSION } from './schemas/geography.schema.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const clone = value => structuredClone(value);
const rows = value => Array.isArray(value) ? value : [];
const geographyOf = world => world?.context?.setting?.frozen?.canon?.geography;

export function resolvePlace(geography, value) {
    const key = text(value), places = rows(geography?.places);
    const result = candidates => ({ status: candidates.length === 1 ? 'matched' : candidates.length ? 'ambiguous' : 'unmapped',
        place: candidates.length === 1 ? clone(candidates[0]) : null, candidates: clone(candidates) });
    if (!key) return result([]);
    const ids = places.filter(p => p.id === key);
    if (ids.length) return result(ids);
    // Every confirmed exact name or alias remains a possible identity.
    return result(places.filter(p => p.name === key || rows(p.aliases).includes(key)));
}

function position(geography, value) {
    const locationText = text(value), resolved = resolvePlace(geography, locationText);
    // Only the known historical default is special, and only after confirmed identity lookup.
    return { locationText, placeId: resolved.place?.id ?? null, status: resolved.status,
        candidates: resolved.candidates.map(p => p.id),
        missing: !locationText || (locationText === '未明' && resolved.status === 'unmapped') };
}

function provenance(world, entity) {
    const rec = world?.meta?.entityFields?.[entity.id] || {}, change = rec.fields?.location;
    if (change?.source === '变更' && text(change.value) === text(entity.location)) {
        const locationChange = {};
        for (const key of ['prev', 'cause', 'causeType', 'tick']) if (change[key] !== undefined) locationChange[key] = clone(change[key]);
        return { locationSource: '动态更新', locationChange };
    }
    return { locationSource: text(rec.位置来源) || '来源未载',
        ...(rec.位置来源自 ? {locationSourceFrom: clone(rec.位置来源自)} : {}) };
}

function ancestorsOf(id, byId) {
    const found = new Set(), pending = [...(byId.get(id)?.parents || [])];
    while (pending.length) {
        const parent = pending.shift();
        if (parent === id || found.has(parent) || !byId.has(parent)) continue;
        found.add(parent); pending.push(...byId.get(parent).parents);
    }
    return [...found];
}

export function buildMapData(world) {
    const geography = geographyOf(world), generated = Boolean(geography);
    const places = rows(geography?.places).filter(p => p && text(p.id) && text(p.name)).map(p => ({
        ...clone(p), observed: false, parents: [], children: [], ancestors: [], entities: [], events: [],
    }));
    const byId = new Map(places.map(p => [p.id, p]));
    const links = rows(geography?.links).filter(l => l && l.from !== l.to && byId.has(l.from) && byId.has(l.to)
        && ['within', 'adjacent', 'passage'].includes(l.type)).map(clone);
    for (const link of links) if (link.type === 'within') {
        const child = byId.get(link.from), parent = byId.get(link.to);
        if (!child.parents.includes(parent.id)) child.parents.push(parent.id);
        if (!parent.children.includes(child.id)) parent.children.push(child.id);
    }
    for (const place of places) place.ancestors = ancestorsOf(place.id, byId);
    const unlocated = {entities: [], events: []}, observed = new Map();
    function add(kind, item, value, source = {}) {
        const pos = position(geography, value), observation = {...clone(item), ...pos, ...source};
        if (pos.status === 'matched' && byId.has(pos.placeId)) byId.get(pos.placeId)[kind].push(observation);
        else if (!pos.missing && pos.status === 'unmapped') {
            if (!observed.has(pos.locationText)) {
                // UI-only IDs cannot be confused with engine-issued source identities.
                const place = {id: `observed:${encodeURIComponent(pos.locationText)}`, name: pos.locationText,
                    observed: true, parents: [], children: [], ancestors: [], entities: [], events: []};
                observed.set(pos.locationText, place); places.push(place);
            }
            observed.get(pos.locationText)[kind].push(observation);
        } else unlocated[kind].push(observation);
    }
    for (const entity of rows(world?.entities)) add('entities', entity, entity.location, provenance(world, entity));
    for (const event of rows(world?.events)) add('events', event, event.position);
    return {generated, places, links, unlocated};
}

export function geographyPack(world, {moveFact = null} = {}) {
    const geography = geographyOf(world);
    if (!rows(geography?.places).length) return undefined;
    const map = buildMapData(world);
    const facts = map.places.filter(p => !p.observed).map(p => {
        const row = {id: p.id, name: p.name};
        for (const key of ['aliases', 'qualifier']) if (p[key] !== undefined) row[key] = clone(p[key]);
        return row;
    });
    const entityRows = rows(world?.entities).map(e => ({id: e.id, ...position(geography, e.location), ...provenance(world, e)}));
    const eventRows = rows(world?.events).filter(e => !e.closed).map(e => ({id: e.id, ...position(geography, e.position)}));
    const positions = {entities: entityRows, events: eventRows};
    const moveLocation = text(moveFact?.location) || text(moveFact?.position);
    if (moveLocation) positions.move = position(geography, moveLocation);
    const relevant = new Set(), byId = new Map(map.places.filter(p => !p.observed).map(p => [p.id, p]));
    for (const observation of [...entityRows, ...eventRows, ...(positions.move ? [positions.move] : [])]) {
        if (!observation.placeId) continue;
        relevant.add(observation.placeId);
        for (const id of byId.get(observation.placeId)?.ancestors || []) relevant.add(id);
    }
    const links = map.links.map(link => {
        const fact = {};
        for (const key of ['from', 'to', 'type', 'via', 'direction', 'condition']) {
            if (link[key] !== undefined) fact[key] = clone(link[key]);
        }
        return fact;
    });
    return {version: GEOGRAPHY_VERSION, places: facts, links, positions, relevantPlaceIds: [...relevant]};
}

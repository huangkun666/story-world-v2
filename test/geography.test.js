import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlace, buildMapData, geographyPack } from '../src/geography.js';
import { geographySchema, GEOGRAPHY_VERSION } from '../src/schemas/geography.schema.js';
import { validate } from '../src/schema.js';

const geography = () => ({ version: 1, places: [
    { id: 'region', name: '星区' }, { id: 'city', name: '城', aliases: ['城邦'] },
    { id: 'hall', name: '大厅', aliases: ['正厅'] }, { id: 'other', name: '别域' },
    { id: 'north', name: '关口', qualifier: '北部' }, { id: 'south', name: '关口', qualifier: '南部' },
], links: [
    { from: 'hall', to: 'city', type: 'within' }, { from: 'city', to: 'region', type: 'within' },
    { from: 'hall', to: 'other', type: 'within' }, { from: 'hall', to: 'north', type: 'adjacent' },
    { from: 'north', to: 'south', type: 'passage', via: '门', condition: '持令可过' },
] });
const world = (g = geography()) => ({ context: { setting: { frozen: { canon: { ...(g ? { geography: g } : {}) } } } },
    entities: [{ id: 'a', name: '甲', location: '正厅' }, { id: 'b', name: '乙', location: '城邦' },
        { id: 'c', name: '丙', location: '荒野' }, { id: 'd', name: '丁', location: '关口' },
        { id: 'e', name: '戊', location: '未明' }, { id: 'f', name: '己' }],
    events: [{ id: 'ev', title: '门变', position: '关口', ripples: ['a'] }, { id: 'none', title: '传闻' }],
    meta: { entityFields: { a: { 位置来源: '结构推导', 位置来源自: '组织' },
        b: { 位置来源: '书里原话', fields: { location: { source: '变更', value: '城邦', cause: 'ev', tick: 3 } } } } },
});

test('confirmed aliases resolve exactly, ambiguous short names retain candidates, IDs are accepted', () => {
    const g = geography();
    assert.equal(resolvePlace(g, '正厅').place.id, 'hall');
    assert.equal(resolvePlace(g, ' hall ').place.id, 'hall');
    assert.equal(resolvePlace(g, '大厅里面').status, 'unmapped');
    assert.equal(resolvePlace(g, '关口').status, 'ambiguous');
    assert.deepEqual(resolvePlace(g, '关口').candidates.map(p => p.id), ['north', 'south']);
    assert.equal(resolvePlace(g, null).place, null);
});
test('three-level and multiple containment stays a graph, adjacency does not become passage', () => {
    const data = buildMapData(world());
    const hall = data.places.find(p => p.id === 'hall');
    assert.deepEqual(hall.parents, ['city', 'other']);
    assert.deepEqual(new Set(hall.ancestors), new Set(['city', 'region', 'other']));
    assert.deepEqual(data.places.find(p => p.id === 'city').children, ['hall']);
    assert.equal(data.links.filter(l => l.type === 'passage').length, 1);
    assert.equal(data.links.find(l => l.type === 'passage').direction, undefined);
    assert.equal(data.links.find(l => l.type === 'passage').condition, '持令可过');
});
test('observations distinguish position sources and never move rippled people into event sites', () => {
    const data = buildMapData(world());
    const a = data.places.find(p => p.id === 'hall').entities[0];
    assert.equal(a.locationSource, '结构推导');
    assert.equal(a.locationSourceFrom, '组织');
    assert.equal(data.places.find(p => p.id === 'city').entities[0].locationSource, '动态更新');
    assert.equal(data.unlocated.events.length, 2);
    assert.equal(data.unlocated.entities.find(e => e.id === 'd').status, 'ambiguous');
    assert.equal(data.places.find(p => p.name === '荒野').entities[0].locationSource, '来源未载');
    assert.ok(data.unlocated.entities.some(e => e.id === 'e'));
    assert.ok(data.unlocated.entities.some(e => e.id === 'f'));
});
test('missing map still displays observed free text, but adds no evolution geography block', () => {
    const w = world(null), data = buildMapData(w);
    assert.equal(data.generated, false);
    assert.ok(data.places.some(p => p.name === '正厅' && p.observed));
    assert.equal(data.links.length, 0);
    assert.equal(geographyPack(w), undefined);
    assert.equal(geographyPack(world({version: 1, places: [], links: []})), undefined);
});
test('a confirmed place named like historical default resolves before default handling', () => {
    const w = world({ version: 1, places: [{id: 'real', name: '未明'}], links: [] });
    assert.equal(buildMapData(w).places.find(p => p.id === 'real').entities[0].id, 'e');
});
test('pack is compact, retains direction and source, includes action site without assigning actors', () => {
    const w = world(), pack = geographyPack(w, { moveFact: { actor: 'f', position: '正厅' } });
    assert.equal(pack.positions.move.placeId, 'hall');
    assert.equal(pack.positions.entities.find(e => e.id === 'f').placeId, null);
    assert.equal(pack.positions.entities.find(e => e.id === 'b').locationSource, '动态更新');
    assert.ok(pack.relevantPlaceIds.includes('region'));
    assert.equal(pack.links.find(l => l.type === 'passage').direction, undefined);
    assert.equal(pack.places.some(p => p.observed), false);
});
test('queries leave frozen data untouched and output cannot mutate it', () => {
    const w = world(), before = structuredClone(w);
    const data = buildMapData(w), pack = geographyPack(w);
    data.places[1].aliases.push('伪名');
    data.places.find(p => p.id === 'hall').entities[0].name = '改名';
    pack.links[0].to = 'false';
    assert.deepEqual(w, before);
});
test('containment traversal survives malformed cycles and missing endpoints without inventing facts', () => {
    const g = geography(); g.links.push({from:'region',to:'hall',type:'within'}, {from:'hall',to:'missing',type:'within'});
    const data = buildMapData(world(g));
    assert.ok(!data.places.find(p => p.id === 'hall').ancestors.includes('hall'));
    assert.ok(!data.links.some(l => l.to === 'missing'));
});
test('schema exposes only the frozen geographical contract', () => {
    assert.equal(GEOGRAPHY_VERSION, 1);
    assert.deepEqual(geographySchema.required, ['version', 'places', 'links']);
    assert.deepEqual(geographySchema.props.links.items.props.type.enum, ['within', 'adjacent', 'passage']);
    assert.equal(geographySchema.props.links.items.props.direction.enum.includes('both'), true);
    assert.equal(geographySchema.props.places.items.props.entities, undefined);
    assert.equal(validate(geography(), geographySchema).ok, true);
    assert.equal(validate({...geography(), version: 2}, geographySchema).ok, false);
    assert.equal(validate({...geography(), quotes: ['not persisted']}, geographySchema).ok, false);
});
test('canonical names and confirmed aliases union candidates instead of choosing an identity', () => {
    const g = {places: [{id:'a',name:'甲',aliases:['共称']},{id:'b',name:'共称',aliases:['甲','同称']},
        {id:'c',name:'丙',aliases:['同称']}]};
    assert.equal(resolvePlace(g, '甲').status, 'ambiguous');
    assert.deepEqual(resolvePlace(g, '甲').candidates.map(p => p.id), ['a', 'b']);
    assert.equal(resolvePlace(g, '共称').status, 'ambiguous');
    assert.equal(resolvePlace(g, '同称').status, 'ambiguous');
    assert.equal(resolvePlace(g, 'a').place.id, 'a');
});
test('name-alias ambiguity stays unlocated in map and pack without mutating source', () => {
    const w = world({version:1, places:[{id:'a',name:'Gate'},{id:'b',name:'Another Gate',aliases:['Gate']}],links:[]});
    w.entities = [{id:'person',name:'Traveler',location:'Gate'}];
    w.events = [{id:'event',title:'Meeting',position:'Gate'}];
    const before = structuredClone(w), map = buildMapData(w), pack = geographyPack(w);
    assert.equal(map.unlocated.entities[0].status, 'ambiguous');
    assert.equal(map.unlocated.events[0].status, 'ambiguous');
    assert.ok(map.places.every(p => p.entities.length === 0 && p.events.length === 0));
    assert.equal(pack.positions.entities[0].placeId, null);
    assert.equal(pack.positions.events[0].placeId, null);
    assert.deepEqual(pack.relevantPlaceIds, []);
    map.unlocated.entities[0].candidates.push('invented');
    assert.deepEqual(w, before);
});
test('real tick move location enters facts; stale change and closed event do not claim current positions', () => {
    const w = world(); w.meta.entityFields.b.fields.location.value = '旧地'; w.events[0].closed = true;
    const pack = geographyPack(w, {moveFact: {location: '正厅'}});
    assert.equal(pack.positions.move.placeId, 'hall');
    assert.equal(pack.positions.entities.find(e => e.id === 'b').locationSource, '书里原话');
    assert.ok(!pack.positions.events.some(e => e.id === 'ev'));
});
test('known forward and both passage directions are preserved without reverse edges', () => {
    const g = geography(); g.links.push({from:'city',to:'other',type:'passage',direction:'forward'},
        {from:'other',to:'south',type:'passage',direction:'both'});
    const data = buildMapData(world(g));
    assert.equal(data.links.find(l => l.from === 'city' && l.type === 'passage').direction, 'forward');
    assert.equal(data.links.find(l => l.from === 'other' && l.type === 'passage').direction, 'both');
    assert.equal(data.links.some(l => l.from === 'other' && l.to === 'city'), false);
});
test('compact facts exclude extraction evidence and view projections', () => {
    const g = geography(); g.places[0].ev = {q:'original quotation'}; g.links[0].source = 'private-source';
    const pack = geographyPack(world(g));
    assert.equal(pack.places[0].ev, undefined);
    assert.equal(pack.places[0].children, undefined);
    assert.equal(pack.links[0].source, undefined);
});

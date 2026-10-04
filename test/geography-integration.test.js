import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildEvolutionPack} from '../src/pack.js';
import {runTick, emptyStep} from '../src/tick.js';
import {validate} from '../src/schema.js';
import {ssotSchema} from '../src/schemas/ssot.schema.js';
import {MAIN_PROMPT} from '../src/prompts.js';
import {derivePositions} from '../web/index.js';
import {buildExportBundle,verifyImportBundle} from '../src/storage.js';
import {diffWorld,makeSnapshot,restoreFrom} from '../src/snapshot.js';

const geography = () => ({version:1, places:[{id:'p_a',name:'甲城'},{id:'p_b',name:'乙洲'},{id:'p_c',name:'丙关'}],
    links:[{from:'p_a',to:'p_b',type:'within'},{from:'p_a',to:'p_c',type:'passage',via:'旧驿道'}]});
const world = () => ({version:1,context:{world:'地图测试',tension:0.5,positions:['甲城'],setting:{frozen:{fingerprint:'test',extractedAt:'2026-10-04',canon:{powerScale:[],rules:[],society:'',techOrMagic:'',historyNotes:[],geography:geography()}}}},
    entities:[{id:'e_a',kind:'character',name:'甲',location:'甲城',lastActiveTick:0}],weights:{},agendas:[],events:[],chronicle:[],meta:{tick:0,simLog:[]}});

test('initial location reference table also includes source-confirmed map places',()=>{
    const setting=world().context.setting, before=structuredClone(setting);
    assert.deepEqual(derivePositions(setting),['未明','甲城','乙洲','丙关']);
    assert.deepEqual(setting,before);
});
test('map and stable place IDs survive signed export and snapshot restoration',async()=>{
    const w=world(), exported=await buildExportBundle(w);
    const imported=await verifyImportBundle(exported.json);
    assert.equal(imported.ok,true);assert.deepEqual(imported.world,w);
    const old=structuredClone(w);delete old.context.setting.frozen.canon.geography;
    const delta=diffWorld(old,w).delta;
    const snapshots=[makeSnapshot({world:old,id:'s0',tick:0,kind:'full'}),
        makeSnapshot({world:w,id:'s1',tick:0,kind:'delta',anchorId:'s0',delta})];
    const restored=restoreFrom({snapshots,targetId:'s1'});
    assert.equal(restored.ok,true);assert.deepEqual(restored.world.context.setting.frozen.canon.geography,geography());
    assert.equal(restoreFrom({snapshots,targetId:'s0'}).world.context.setting.frozen.canon.geography,undefined);
});

test('SSOT accepts optional geography and rejects invalid direction/version',()=>{
    assert.equal(validate(world(),ssotSchema).ok,true);
    const bad=world(); bad.context.setting.frozen.canon.geography.links[1].direction='instant';
    assert.equal(validate(bad,ssotSchema).ok,false);
    const old=world();delete old.context.setting.frozen.canon.geography;
    assert.equal(validate(old,ssotSchema).ok,true);
});
test('main evolution pack includes actual relationships without mutating the account',()=>{
    const w=world(), before=structuredClone(w), result=buildEvolutionPack(w,null), pack=result.pack;
    assert.equal(pack.geography.links.find(r=>r.type==='passage').via,'旧驿道');
    assert.equal(pack.geography.links.find(r=>r.type==='passage').direction,undefined);
    const sent=JSON.parse(result.text);
    assert.equal(sent.geography.positions.entities[0].placeId,'p_a');
    assert.equal(sent.geography.positions.entities[0].locationSource,pack.geography.positions.entities[0].locationSource);
    assert.deepEqual(w,before);
    delete w.context.setting.frozen.canon.geography;
    assert.equal(Object.hasOwn(buildEvolutionPack(w,null).pack,'geography'),false);
});
test('runTick delivers geography before its single main call and preserves omitted event position',async()=>{
    let calls=0, input='';
    const w=world(), before=structuredClone(w);
    const step={...emptyStep(),newEvents:[{title:'甲收到传闻',source:{type:'state'},ripples:['e_a']}]};
    const r=await runTick({ssot:w,dialogue:'',transport:async p=>{calls++;input=JSON.stringify(p);return JSON.stringify(step);}});
    assert.equal(r.ok,true,r.error);assert.equal(calls,1);
    assert.match(input,/geography/);assert.match(input,/旧驿道/);
    assert.equal(r.ssot.events[0].position,undefined);assert.equal(r.ssot.entities[0].location,'甲城');
    assert.deepEqual(w,before);
});
test('map budget cannot discard existing core content to make room for distant geography',()=>{
    const w=world(), plain=structuredClone(w);delete plain.context.setting.frozen.canon.geography;
    const base=buildEvolutionPack(plain,null);
    for(let i=0;i<90;i++)w.context.setting.frozen.canon.geography.places.push({id:`p_far${i}`,name:`远处${i}${'很长的地点名称'.repeat(5)}`});
    const r=buildEvolutionPack(w,null,{lim:{包预算:base.estTokens+160}});
    assert.deepEqual(r.pack.entities,base.pack.entities);
    assert.deepEqual(r.pack.pendingEvents,base.pack.pendingEvents);
    assert.ok(r.estTokens<=base.estTokens+160);
    assert.ok(r.pack.geography?.coverage.omittedPlaces>0);
    if(r.pack.geography.places.some(p=>p.id==='p_a')){
        assert.ok(r.pack.geography.places.some(p=>p.id==='p_b'));
        assert.ok(r.pack.geography.links.some(l=>l.from==='p_a'&&l.to==='p_b'));
    }
});
test('prompt distinguishes geographic facts from scene presence and missing roads',()=>{
    assert.match(MAIN_PROMPT,/geography/);
    assert.match(MAIN_PROMPT,/共同上层/);
    assert.match(MAIN_PROMPT,/未记录.*不代表/);
});

const wiring=()=>import('../web/geography-wiring.js').catch(()=>({}));
const source=()=>({ok:true,text:'甲城在乙洲内。',allowedBlocks:[{id:'a',text:'甲城在乙洲内。'}]});
test('backfill updates only geography and rejects a world advanced during the call',async()=>{
    const {createGeographyHub}=await wiring();assert.equal(typeof createGeographyHub,'function');
    let current=world(), saves=0, trigger;
    const hub=createGeographyHub({getWorld:()=>current,getIdentity:()=> 'chat-a',getSource:async()=>source(),
        extract:async()=>{await new Promise(resolve=>trigger=resolve);return JSON.stringify({});},
        extractMap:async()=>{await new Promise(resolve=>trigger=resolve);return {ok:true,geography:geography(),errors:[],calls:1};},
        persist:async()=>{saves++;return {ok:true};}});
    const promise=hub.backfill();while(!trigger)await new Promise(r=>setImmediate(r));current.meta.tick++;trigger();
    const r=await promise;assert.equal(r.ok,false);assert.equal(saves,0);
});
test('backfill preserves entities/events and guards source changes, identity switches and failures',async()=>{
    const {createGeographyHub}=await wiring();assert.equal(typeof createGeographyHub,'function');
    let current=world(),identity='a',src=source(),written=null;
    const run=async(change,result={ok:true,geography:geography(),errors:[],calls:1})=>{
        const before=structuredClone(current);written=null;
        const hub=createGeographyHub({getWorld:()=>current,getIdentity:()=>identity,getSource:async()=>src,
            extractMap:async()=>{change?.();return result;},extract:async()=>'',persist:async next=>{written=next;current=next;return {ok:true};}});
        const r=await hub.backfill();return {r,before};
    };
    const good=await run();assert.equal(good.r.ok,true);assert.deepEqual(written.entities,good.before.entities);assert.deepEqual(written.events,good.before.events);
    assert.equal((await run(()=>identity='b')).r.ok,false);assert.equal(written,null);
    assert.equal((await run(()=>src={...source(),text:'来源变了'})).r.ok,false);assert.equal(written,null);
    assert.equal((await run(null,{ok:false,errors:['failed'],calls:1})).r.ok,false);assert.equal(written,null);
});
test('setting-only re-extraction keeps geography only for the same source fingerprint',async()=>{
    const {retainGeography}=await wiring(), previous=world().context.setting;
    const next=structuredClone(previous);delete next.frozen.canon.geography;
    retainGeography(previous,next);
    assert.deepEqual(next.frozen.canon.geography,previous.frozen.canon.geography);
    next.frozen.canon.geography.places[0].name='changed';
    assert.equal(previous.frozen.canon.geography.places[0].name,'甲城');
    delete next.frozen.canon.geography;next.frozen.fingerprint='different';retainGeography(previous,next);
    assert.equal(next.frozen.canon.geography,undefined);
});

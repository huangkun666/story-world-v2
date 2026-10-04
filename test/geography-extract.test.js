import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeAllowedSources, scopeForText } from '../src/abstract-evidence.js';
import { extractWorldSetting, sanitizeCanon, mergeCanonChunks } from '../src/abstract.js';
const api = await import('../src/geography-extract.js').catch(() => ({}));
const text = 'Alpha contains Beta. Beta is also called B. Alpha touches Gamma.';
const frozen = freezeAllowedSources([{ id: 'book', text }]);
const evidence = { frozen, scope: scopeForText(frozen, text), records: [] };
const ev = { s: 'S1', q: text };
const raw = () => ({ places: [{ key: 'a', name: 'Alpha', ev }, { key: 'b', name: 'Beta', aliases: ['B'], ev }], links: [{ from: 'b', to: 'a', type: 'within', ev }] });

test('geography checks source and scope, strips proof, keeps citation failures and still rejects bad shapes（★leg197：出处不再丢，照收）', () => {
  assert.equal(typeof api.sanitizeGeography, 'function');
  const input = raw(); input.places.push({key: 'bad', name: 'Invented', ev: { s: 'S2', q: text }});
  input.links.push({from:'a',to:'bad',type:'passage',ev});
  const result = api.sanitizeGeography(input, {sourceText:text,evidence});
  // ★leg197：`S2` 不在本次用料里也不再丢这个地点/这条边——出处核不过只记诊断，形状合法的照收。
  assert.equal(result.geography.places.length,3); assert.equal(result.geography.links.length,2);
  assert.equal(result.dropped.length,0); assert.ok(result.warnings.some(w=>/出处核不过/.test(w)));
  assert.ok(!JSON.stringify(result.geography).includes('"ev"'));
  assert.ok(!JSON.stringify(result.geography).includes(text));
  // ★leg197：没给证据面 / 作用域对不上 ⇒ 同样只记账照收（旧法两处都返回 0 个地点）。
  assert.equal(api.sanitizeGeography(raw(),{sourceText:text}).geography.places.length,2);
  assert.equal(api.sanitizeGeography(raw(),{sourceText:'Alpha',evidence:{frozen}}).geography.places.length,2);
  // 形状类仍照旧拦（它不是"找不到原文"）：缺 name 的地点一律不收。
  const badShape = api.sanitizeGeography({places:[{key:'x'}],links:[]},{sourceText:text,evidence});
  assert.equal(badShape.geography.places.length,0); assert.ok(badShape.dropped.length);
});

test('merge remaps chunk ids and removes every edge inside a containment cycle', () => {
  assert.equal(typeof api.mergeGeography, 'function');
  const a = {version:1,places:[{id:'p_1',name:'Alpha'},{id:'p_2',name:'Beta',qualifier:'Centre'}],links:[{from:'p_2',to:'p_1',type:'within'}]};
  const b = {version:1,places:[{id:'p_1',name:'Beta',qualifier:'Centre'},{id:'p_2',name:'Gamma'}],links:[{from:'p_1',to:'p_2',type:'passage'}]};
  const result=api.mergeGeography([a,b]);
  assert.equal(result.places.length,3);
  const names=new Map(result.places.map(p=>[p.id,p.name]));
  assert.deepEqual(result.links.map(l=>[names.get(l.from),names.get(l.to)]),[['Beta','Alpha'],['Beta','Gamma']]);
  const cycle=api.mergeGeography([{...a,links:[...a.links,{from:'p_1',to:'p_2',type:'within'},{from:'p_1',to:'p_2',type:'adjacent'}]}]);
  assert.deepEqual(cycle.links.map(l=>l.type),['adjacent']);
  const same=api.mergeGeography([{version:1,places:[{id:'x',name:'Gate'},{id:'y',name:'Gate'}],links:[]}]);
  assert.equal(same.places.length,2);
  const ambiguous=api.mergeGeography([{version:1,places:[{id:'x',name:'Gate'},{id:'y',name:'Gate'}],links:[]}],{previous:{version:1,places:[{id:'p_99',name:'Gate'}],links:[]}});
  assert.ok(ambiguous.places.every(p=>p.id!=='p_99'));
});

test('canon and real world extraction carry optional geography without added calls', async () => {
  const response={society:'Alpha contains Beta.',bookEntities:[{name:'Alpha',kind:'location',ev}],geography:raw()};
  const cleaned=sanitizeCanon(response,{sourceText:text,evidence});
  assert.equal(cleaned.canon.geography?.places.length,2);
  assert.equal(mergeCanonChunks([cleaned]).canon.geography?.links.length,1);
  let calls=0;
  const result=await extractWorldSetting({sourceText:text,allowedSources:[{id:'book',text}],extract:async prompt=>{calls++;assert.match(JSON.stringify(prompt),/geography/);return JSON.stringify({...response,society:{text:'Alpha contains Beta.',ev}});}});
  assert.equal(result.ok,true);assert.equal(calls,1);
  assert.equal(result.setting.frozen.canon.geography.places.length,2);
  assert.ok(!JSON.stringify(result.setting).includes('"ev"'));
  assert.equal(Object.hasOwn(sanitizeCanon({society:'unchanged'}).canon,'geography'),false);
});

test('backfill uses string transport, refuses empty output but keeps uncited places（★leg197：出处不再丢，照收）', async () => {
  assert.equal(typeof api.extractGeography,'function');
  const args={sourceText:text,allowedSources:[{id:'book',text}]};
  const result=await api.extractGeography({...args,extract:async()=>JSON.stringify({geography:raw()})});
  assert.equal(result.ok,true);assert.equal(result.calls,1);assert.equal(result.geography.links.length,1);
  assert.equal((await api.extractGeography({...args,extract:async()=>''})).ok,false);
  // ★leg197：没有出处的那个地名照收（旧法核不过 ⇒ places 为空 ⇒ ok=false），只留一条诊断。
  const uncited=await api.extractGeography({...args,extract:async()=>JSON.stringify({geography:{places:[{key:'x',name:'Alpha'}],links:[]}})});
  assert.equal(uncited.ok,true);assert.equal(uncited.geography.places.length,1);
  assert.ok(uncited.errors.some(e=>/出处核不过/.test(e)));
});

test('source-confirmed qualifiers distinguish same names across chunks and previous ids', () => {
  const a={version:1,places:[{id:'p_1',name:'Gate',qualifier:'North'}],links:[]};
  const b={version:1,places:[{id:'p_1',name:'Gate',qualifier:'South'}],links:[]};
  const result=api.mergeGeography([a,b],{previous:{version:1,places:[{id:'p_99',name:'Gate',qualifier:'North'}],links:[]}});
  assert.equal(result.places.length,2);assert.equal(result.places[0].id,'p_99');
  assert.deepEqual(result.places.map(p=>p.qualifier),['North','South']);
});

test('old complete extraction cache cannot skip map request but fresh optional absence can cache', async () => {
  let stored={canon:{canon:{society:'old'},tension:{},env:{}},extractedAt:'old'},calls=0;
  const cache={get:()=>stored,set:(_fp,canon,extractedAt)=>{stored={canon,extractedAt};}};
  const args={sourceText:text,cache,extract:async()=>{calls++;return JSON.stringify({society:'fresh'});}};
  const first=await extractWorldSetting(args); assert.equal(first.cached,false);assert.equal(calls,1);
  const second=await extractWorldSetting(args);assert.equal(second.cached,true);assert.equal(calls,1);
});

test('uncited geography no longer erases legitimate setting or roster, and exceptions cannot leak credentials（★leg197：出处不再丢，照收）', async () => {
  const result=await extractWorldSetting({sourceText:text,allowedSources:[{id:'book',text}],extract:async()=>JSON.stringify({society:{text:'Alpha contains Beta.',ev},bookEntities:[{name:'Alpha',kind:'location',ev}],geography:{places:[{key:'x',name:'secret',ev:{s:'unknown',q:'token-secret'}}],links:[]}})});
  assert.equal(result.ok,true);assert.equal(result.setting.frozen.canon.society,'Alpha contains Beta.');
  assert.equal(result.setting.frozen.canon.bookEntities.length,1);
  // ★leg197：出处核不过的地点照收（旧法 `Object.hasOwn(canon,'geography')===false`，整份地图被抹掉）。
  assert.equal(result.setting.frozen.canon.geography.places.length,1);
  assert.equal(result.setting.frozen.canon.geography.places[0].name,'secret');
  // 凭证照旧不落账：核不过的那条原话一个字都不许进世界账（诊断面另受门控）。
  assert.equal(JSON.stringify(result.setting.frozen.canon.geography).includes('"ev"'),false);
  assert.equal(JSON.stringify(result.setting).includes('token-secret'),false);
  const backfill=await api.extractGeography({sourceText:text,allowedSources:[{id:'book',text}],extract:async()=>{throw new Error('Bearer token-secret');}});
  assert.equal(backfill.ok,false);assert.ok(!JSON.stringify(backfill).includes('token-secret'));
});

test('setting-only cache is not a complete map extraction result', async () => {
  let stored=null,calls=0;
  const cache={get:()=>stored,set:(_fp,canon,extractedAt)=>{stored={canon,extractedAt};}};
  const args={sourceText:text,cache,extract:async()=>{calls++;return JSON.stringify({society:'legitimate'});}};
  await extractWorldSetting({...args,skipRoster:true});
  const result=await extractWorldSetting(args);assert.equal(result.cached,false);assert.equal(calls,2);
});

test('real large-book extraction remaps geography while retaining its baseline call count', async () => {
  const texts=['Alpha contains Beta of Centre.','Beta of Centre touches Gamma.'].map(s=>'f'.repeat(29000)+s);
  const sourceText=texts.join('\n'),allowedSources=texts.map((t,i)=>({id:'b'+i,text:t}));
  const run=async include=>{let calls=0;const result=await extractWorldSetting({sourceText,allowedSources,extract:async prompt=>{
    calls++;const second=prompt.includes('S2 ='),s=second?'S2':'S1',q=second?'Beta of Centre touches Gamma.':'Alpha contains Beta of Centre.',proof={s,q};
    const response={society:{text:q,ev:proof},bookEntities:[],entities:[]};
    if(include&&prompt.includes('"geography"'))response.geography={places:[{key:'x',name:second?'Beta':'Alpha',...(second?{qualifier:'Centre'}:{}),ev:proof},{key:'y',name:second?'Gamma':'Beta',...(!second?{qualifier:'Centre'}:{}),ev:proof}],links:[{from:'y',to:'x',type:second?'adjacent':'within',ev:proof}]};
    return JSON.stringify(response);
  }});return {result,calls};};
  const baseline=await run(false),mapped=await run(true);
  assert.equal(mapped.result.ok,true);assert.equal(mapped.calls,baseline.calls);
  const geo=mapped.result.setting.frozen.canon.geography;
  assert.equal(geo.places.length,3);assert.equal(geo.links.length,2);
});

test('unverified quotation no longer removes names, aliases, qualifiers or passage text——只记诊断（★leg197：出处不再丢，照收）', () => {
  const source='Gate stands within North. North Gate is also called Entrance. Gate leads to North via Tunnel when open.';
  const f=freezeAllowedSources([{id:'source',text:source}]);
  const proof={s:'S1',q:source};
  const input={places:[
    {key:'g',name:'Gate',aliases:['Entrance','TotallyInventedAlias'],qualifier:'UnmentionedIdentity',ev:proof},
    {key:'n',name:'North',qualifier:'North Gate',ev:proof},
    {key:'i',name:'InventedPlace',ev:proof},
  ],links:[{from:'g',to:'n',type:'passage',via:'ImaginaryRoad',condition:'ImaginaryCondition',ev:proof}]};
  const result=api.sanitizeGeography(input,{sourceText:source,evidence:{frozen:f,scope:scopeForText(f,source)}});
  // ★leg197：`literal()`（名称/别名/身份说明/通道名要在所引原话里逐字出现）整条撤了 ⇒ 三个地点全收。
  assert.equal(result.geography.places.length,3);
  const gate=result.geography.places.find(p=>p.name==='Gate');
  assert.deepEqual(gate.aliases,['Entrance','TotallyInventedAlias']);
  assert.equal(gate.qualifier,'UnmentionedIdentity');
  assert.equal(result.geography.places.find(p=>p.name==='North').qualifier,'North Gate');
  // ★leg197：`via`/`condition` 同样不再要求出现在所引原话里。
  assert.deepEqual(Object.keys(result.geography.links[0]).sort(),['condition','from','to','type','via']);
  assert.equal(result.geography.links[0].via,'ImaginaryRoad');
  assert.equal(result.geography.links[0].condition,'ImaginaryCondition');
  // ★leg197：一条都不因出处被丢（`dropped` 只留给形状类）。
  assert.equal(result.dropped.length,0);
  const valid=api.sanitizeGeography({...input,links:[{from:'g',to:'n',type:'passage',via:'Tunnel',condition:'when open',ev:proof}]},{sourceText:source,evidence:{frozen:f,scope:scopeForText(f,source)}});
  assert.equal(valid.geography.links[0].via,'Tunnel');assert.equal(valid.geography.links[0].condition,'when open');
});

test('unqualified homonyms in separate chunks stay separate and do not steal previous ids', () => {
  const part=parent=>({version:1,places:[{id:'p_1',name:'Gate'},{id:'p_2',name:parent}],links:[{from:'p_1',to:'p_2',type:'within'}]});
  const geo=api.mergeGeography([part('North'),part('South')],{previous:{version:1,places:[{id:'p_99',name:'Gate'}],links:[]}});
  const gates=geo.places.filter(p=>p.name==='Gate');
  assert.equal(gates.length,2);assert.ok(gates.every(p=>p.id!=='p_99'));
  const names=new Map(geo.places.map(p=>[p.id,p.name]));
  assert.deepEqual(geo.links.map(l=>names.get(l.to)),['North','South']);
  assert.notEqual(geo.links[0].from,geo.links[1].from);
  assert.equal(api.mergeGeography([part('North')],{previous:{version:1,places:[{id:'p_99',name:'Gate'}],links:[]}}).places[0].id,'p_99');
});

test('geography and world extraction share one exported chunk-size source', async () => {
  const fs=await import('node:fs');
  const limits=await import('../src/abstract-limits.js').catch(()=>({}));
  const world=await import('../src/abstract.js');
  assert.equal(typeof limits.SETTING_CHUNK_CHAR,'number');
  assert.equal(world.SETTING_CHUNK_CHAR,limits.SETTING_CHUNK_CHAR);
  assert.match(fs.readFileSync(new URL('../src/geography-extract.js',import.meta.url),'utf8'),/import.*SETTING_CHUNK_CHAR.*abstract-limits/);
});

test('backfill transport or malformed later block cannot replace a complete previous map with a subset', async () => {
  const blocks=[{id:'north',text:'x'.repeat(29990)+'Gate stands within North.'},{id:'south',text:'South contains Plaza.'}];
  const previous={version:1,places:[{id:'p_99',name:'South'}],links:[]},before=JSON.stringify(previous);
  for(const failure of ['throw','bad-json','bad-shape']){
    let calls=0;
    const result=await api.extractGeography({sourceText:blocks.map(b=>b.text).join('\n'),allowedSources:blocks,previous,extract:async()=>{
      calls++;
      if(calls===2){if(failure==='throw')throw new Error('secret');if(failure==='bad-json')return '{';return JSON.stringify({geography:{places:'bad',links:[]}});}
      return JSON.stringify({geography:{places:[{key:'g',name:'Gate',ev:{s:'S1',q:'Gate stands within North.'}}],links:[]}});
    }});
    assert.equal(calls,2);assert.equal(result.ok,false,failure);assert.equal(result.geography,null);
    assert.equal(JSON.stringify(previous),before);assert.ok(result.errors.length);
  }
});

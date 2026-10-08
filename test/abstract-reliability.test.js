import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorldSetting } from '../src/abstract.js';
import { createHttpTransport } from '../src/transport-http.js';
import { createCache } from '../src/fp-hash.js';
import { normalizeExtractChunkChars, SETTING_CHUNK_CHAR } from '../src/abstract-limits.js';
import { diagExtract } from '../web/diagnostic-transport.js';
import { diagnostics } from '../src/diagnostics.js';
const good = JSON.stringify({society:'城邦',bookEntities:[]});
test('request rejection stops the book and counts actual calls', async () => {
 let calls = 0;
 const r = await extractWorldSetting({sourceText: Array.from({length:40},()=> 'x'.repeat(1000)).join('\n'), concurrency:1, extract:async()=> {calls++; throw Object.assign(new Error('HTTP 401'),{status:401});}});
 assert.equal(r.ok,false); assert.equal(calls,1); assert.equal(r.timing.calls,1);
});
test('chunk normalization, small source chunks, cache changes and whole oversized rows', async () => {
 assert.equal(normalizeExtractChunkChars('12'),12);
 for(const raw of [0,-1,1.2,'',null,{},Number.MAX_SAFE_INTEGER+1]) assert.equal(normalizeExtractChunkChars(raw),SETTING_CHUNK_CHAR);
 let calls=0; const cache=createCache(); const prompts=[];
 const options={sourceText:'aaa\nbbb\n'+'z'.repeat(30),chunkChars:5,skipRoster:true,cache,extract:async p=>{calls++;prompts.push(p);return good;}};
 const first=await extractWorldSetting(options);
 assert.equal(first.ok,true); assert.equal(calls,3); assert.equal(first.timing.chunkChars,5);
 assert.ok(prompts.some(p=>p.includes('z'.repeat(30)))); assert.ok(first.errors.some(e=>e.includes('超长原文行')));
 assert.equal((await extractWorldSetting(options)).cached,true); assert.equal(calls,3);
 await extractWorldSetting({...options,chunkChars:100}); assert.equal(calls,4);
});
test('cancelled extraction does not cache and next independent invocation works', async () => {
 const cache=createCache(); const c=new AbortController(); let calls=0;
 const result=extractWorldSetting({sourceText:'aaa\nbbb\nccc',chunkChars:3,skipRoster:true,concurrency:2,cache,signal:c.signal,extract:async()=>{calls++;c.abort();return good;}});
 const r=await result; assert.equal(r.cancelled,true); assert.equal(r.ok,false); assert.equal(cache.size(),0); assert.equal(calls,1); assert.equal(r.timing.calls,calls); assert.equal(r.timing.peakConcurrency,1);
 const next=await extractWorldSetting({sourceText:'aaa',skipRoster:true,cache,extract:async()=>good}); assert.equal(next.ok,true);
});
test('small timeout is single call and 429 ends parallel queue without fictitious requests',async()=>{
 for(const err of [Object.assign(new Error('timeout'),{sw2Timeout:true}),Object.assign(new Error('HTTP 429'),{status:429})]) {
  let calls=0; const r=await extractWorldSetting({sourceText:'aaa',extract:async()=>{calls++;throw err;}});
  assert.equal(calls,1);assert.equal(r.timing.calls,1);assert.equal(r.ok,false);
 }
 let calls=0;const r=await extractWorldSetting({sourceText:Array.from({length:20},()=> 'aaa').join('\n'),chunkChars:3,concurrency:2,extract:async()=>{calls++;throw Object.assign(new Error('HTTP 429'),{status:429});}});
 assert.ok(calls<=2);assert.equal(r.timing.calls,calls);assert.equal(r.ok,false);
});
test('diagnostic extraction preserves signal, stats and terminal configuration',async()=>{
 diagnostics.clear();const c=new AbortController(); let received;
 const extract=diagExtract({model:'fake',transport:async(p,o)=>{received=o.signal;return good;}},{task:'setting',sourceChars:42,chunkChars:10,concurrency:2,signal:c.signal});
 assert.equal(await extract('prompt'),good);assert.equal(received,c.signal);assert.equal(extract.stats().calls,1);
 extract.finish({ok:false,errors:['HTTP 401'],callFailure:{status:401}});
 const rows=diagnostics.snapshot();const terminal=rows.find(r=>r.message==='抽取失败');
 assert.ok(terminal); assert.equal(terminal.data?.chunkChars ?? terminal.payload?.chunkChars,10);
});
test('external abort ends even an uncooperative sender', async () => {
 const c = new AbortController();
 const transport = createHttpTransport({baseUrl:'https://fake.invalid',apiKey:'fake',model:'fake',timeoutMs:500,fetchImpl:()=>new Promise(()=>{})});
 const p = transport('fake',{signal:c.signal}); c.abort();
 await assert.rejects(p,e=>e.sw2Cancelled===true && !e.sw2Timeout);
});
test('cancellation interrupts retry wait and pre-aborted cache access',async()=>{
 const c=new AbortController(); let calls=0;
 const work=extractWorldSetting({sourceText:'aaa',signal:c.signal,extract:async()=>{calls++;setTimeout(()=>c.abort(),10);throw new Error('HTTP 503');}});
 const r=await work; assert.equal(r.cancelled,true);assert.equal(calls,1);
 const result=await extractWorldSetting({sourceText:'aaa',signal:c.signal,cache:{get:()=>{throw new Error('must not read');}},extract:async()=>good});
 assert.equal(result.cancelled,true);assert.equal(result.timing.calls,0);
});
test('HTTP refusal details and filter failures remain distinct',async()=>{
 const make=fetchImpl=>createHttpTransport({baseUrl:'https://fake.invalid',apiKey:'fake',model:'fake',fetchImpl});
 const rejected=make(async()=>({ok:false,status:400,text:async()=>JSON.stringify({error:{code:'context_length_exceeded',message:'too big'}})}));
 await assert.rejects(rejected('fake'),e=>e.sw2ContextLength && e.sw2CallFailure.status===400 && e.sw2CallFailure.refusal==='too big');
 const filtered=make(async()=>({ok:true,status:200,json:async()=>({choices:[{finish_reason:'content_filter',message:{content:''}}]})}));
 await assert.rejects(filtered('fake'),e=>e.sw2CallFailure.type==='filter');
});

for (const content of ['', '{"society":', good]) {
 test(`explicitly truncated content cannot become a successful extraction or cache: ${JSON.stringify(content)}`, async () => {
  const cache=createCache(); let calls=0;
  const transport=createHttpTransport({baseUrl:'https://fake.invalid',apiKey:'fake',model:'fake',fetchImpl:async()=>{
   calls++; return {ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content}}]})};
  }});
  const r=await extractWorldSetting({sourceText:'aaa',skipRoster:true,cache,extract:transport});
  assert.equal(r.ok,false); assert.equal(cache.size(),0);
  assert.equal(calls,2,'existing small content-failure retry remains bounded');
  assert.equal(r.timing.calls,calls); assert.match(r.errors.join('\n'),/截断/);
 });
}

import {WORLD_RETRIEVAL_TOP_DEFAULT,WORLD_RETRIEVAL_DEPTH_DEFAULT,WORLD_RETRIEVAL_MIN_SCORE_DEFAULT} from '../src/runtime-settings.js';
// Fixed-version derived indexes. Formal facts always come back from the journal.
import { MultiDirectedGraph, bfsFromNode, create, insert, remove, save, load, search, createMandarinTokenizer } from '../vendor/world-memory.js';
import { sha256Hex } from '../src/browser-capabilities.js';
import {worldSourceEvidence,isChatHistoryRecord} from '../src/source-records.js';
import {eventEntityIds,EVENT_PROTOCOL} from '../src/event-contract.js';

const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const formalSource=new Set(['event','parent','ripple','plot','entity','agenda','condition']);
const keyOf=p=>canonical([p.world_id,p.branch_id,p.revision]);
function checkPointer(p) {
 if(!p||!['world_id','branch_id'].every(k=>typeof p[k]==='string'&&p[k])||!Number.isSafeInteger(p.revision)||p.revision<0)throw Error('缺少固定正式世界版本');
}
function references(row) {
 const pairs=[];
 const add=(id,type)=>{if(typeof id==='string'&&id)pairs.push([id,type])};
 if(formalSource.has(row.source?.type))add(row.source.ref,row.source.type==='parent'?'parent':'cause');
 if(formalSource.has(row.cause?.type))add(row.cause.ref,'cause');
 add(row.parentId,'parent');add(row.eventRef,'cause');add(row.owner,'owner');
 for(const id of [...(Array.isArray(row.causeIds)?row.causeIds:[]),...(Array.isArray(row.links?.up)?row.links.up:[])])add(id,'cause');
 for(const id of Array.isArray(row.ripples)?row.ripples:[])add(id,'participant');
 for(const group of [row.participantIds,row.participants])if(Array.isArray(group))for(const item of group)add(typeof item==='string'?item:item?.id,'participant');
 if(row.record_kind==='event'&&row.eventProtocol===EVENT_PROTOCOL)for(const id of eventEntityIds(row))add(id,'participant');
 if(row.record_kind==='relation'){add(row.from??row.from_id,'from');add(row.to??row.to_id,'to')}
 return [...new Map(pairs.map(pair=>[canonical(pair),pair])).values()];
}
const finiteVector=v=>Array.isArray(v)&&v.length>0&&v.every(n=>typeof n==='number'&&Number.isFinite(n));
const sharedVectors=new WeakMap();
let requestSequence=0;
const requestId=()=>`${Date.now()}:${++requestSequence}:${globalThis.crypto?.randomUUID?.()??Math.random()}`;
const invalidVector=message=>Object.assign(Error(message),{outcome:'received-invalid'});
export function createWorldMemory({journal,embedder=null,embeddingIdentity=null,cacheSize=2}={}) {
 if(!journal||typeof journal.getRecords!=='function')throw Error('缺少正式世界账');
 if(embedder&&(embeddingIdentity==null||!String(typeof embeddingIdentity==='string'?embeddingIdentity:canonical(embeddingIdentity)).trim()))throw Error('向量渠道身份必须明确');
 if(!Number.isSafeInteger(cacheSize)||cacheSize<1)throw Error('索引缓存数量无效');
 const identity=embedder?(typeof embeddingIdentity==='string'?embeddingIdentity:canonical(embeddingIdentity)):'fulltext-v1';
 const cache=new Map(),pending=new Map(),maintenance=new Map(),controllers=new Set();
 const owner=journal.db??journal;
 if(!sharedVectors.has(owner))sharedVectors.set(owner,{pending:new Map(),local:new Map(),unknown:new Set()});
 const shared=sharedVectors.get(owner),localVectors=shared.local;
 let generation=0,last=null, advancing=Promise.resolve();
 async function cachedVector(hash) {
  const key=canonical([identity,hash]);
  const row=journal.db?.vectors?await journal.db.vectors.get([identity,hash]):localVectors.get(key);
  if(row){if(!finiteVector(row.vector))throw Error('向量缓存包含非法数据');return row.vector}
  return null;
 }
 async function saveVector(hash,value) {
  if(!finiteVector(value))throw Error('向量响应必须是有限数值数组');
  const saved={identity,hash,vector:[...value]};
  if(journal.db?.vectors)await journal.db.vectors.put(saved);else localVectors.set(canonical([identity,hash]),saved);
  return saved.vector;
 }
 // Install the hash promises before the first cache read. Queries and maintenance
 // can then share one paid request even when both initially observe a cache miss.
 async function vectorsFor(texts,pointer,{signal}={}) {
  const entries=[...new Map(texts.map(text=>[sha256Hex(text),text])).entries()],owned=[],waits=new Map();
  for(const [hash,text]of entries){const key=canonical([identity,hash]);let promise=shared.pending.get(key);
   if(!promise){let resolve,reject;promise=new Promise((yes,no)=>{resolve=yes;reject=no});promise.catch(()=>{});shared.pending.set(key,promise);owned.push({hash,text,key,promise,resolve,reject})}waits.set(hash,promise);
  }
  if(owned.length){const id=requestId(),posted=new Set(),completed=new Set();let reserved=[];
   const settle=async(hashes,status)=>{if(hashes.length&&typeof journal.settleIndexVectors==='function'){const result=await journal.settleIndexVectors(pointer,{embeddingIdentity:identity,requestId:id,hashes,status});if(status==='posted'&&result.settled.length!==hashes.length){const error=Error('向量请求已由新维护接管');error.outcome='cancelled';throw error}}};
   try {
    const missing=[];
    for(const item of owned){const value=await cachedVector(item.hash);if(value){completed.add(item.hash);item.resolve(value)}else missing.push(item)}
    if(signal?.aborted){const error=Error('向量维护已停止');error.outcome='cancelled';throw error}
    let allowed=missing.map(item=>item.hash),blocked=[];
    if(typeof journal.reserveIndexVectors==='function'){
     const claim=await journal.reserveIndexVectors(pointer,{embeddingIdentity:identity,requestId:id,hashes:allowed});allowed=claim.allowed;blocked=claim.blocked;
     for(const hash of claim.cached??[]){const item=missing.find(item=>item.hash===hash);if(!item)throw Error('向量缓存回执身份不匹配');const value=await cachedVector(hash);if(!value)throw Error('向量缓存回取缺失');completed.add(hash);item.resolve(value)}
    }
    else {blocked=allowed.filter(hash=>shared.unknown.has(canonical([identity,hash])));allowed=allowed.filter(hash=>!blocked.includes(hash));}
    reserved=allowed;
    for(const item of missing.filter(item=>blocked.includes(item.hash))){const error=Error('此前向量请求结果尚未确认');error.outcome='unknown';item.reject(error)}
    const sendItems=missing.filter(item=>allowed.includes(item.hash)),byHash=new Map(sendItems.map(item=>[item.hash,item]));
    let dimensions=null;
    for(const item of owned)if(completed.has(item.hash)){const value=await cachedVector(item.hash);if(dimensions!==null&&value.length!==dimensions)throw invalidVector('向量维度与同版索引不一致');dimensions=value.length}
    const options={signal,
     onPosted:async({texts:batch})=>{if(signal?.aborted){const error=Error('向量维护已停止');error.outcome='cancelled';throw error}const hashes=batch.map(sha256Hex);await settle(hashes,'posted');for(const hash of hashes)posted.add(hash)},
     onRejected:async({texts:batch,error})=>{const hashes=batch.map(sha256Hex);await settle(hashes,error?.batchTooBig?'reserved':'rejected');for(const hash of hashes)posted.delete(hash)},
     onBatch:async({texts:batch,vectors})=>{
      if(!Array.isArray(vectors)||vectors.length!==batch.length||vectors.some(v=>!finiteVector(v)))throw invalidVector('向量响应数量或数值无效');
      const expected=dimensions??vectors[0]?.length;if(vectors.some(value=>value.length!==expected))throw invalidVector('向量维度与同版索引不一致');dimensions=expected;
      const hashes=batch.map(sha256Hex);
      for(let i=0;i<batch.length;i++){const item=byHash.get(hashes[i]);if(!item)throw Error('向量批次身份不匹配');const saved=await saveVector(item.hash,vectors[i]);completed.add(item.hash);item.resolve(saved)}
      await settle(hashes,'done');for(const hash of hashes)posted.delete(hash);

     }};
    if(sendItems.length){const input=sendItems.map(item=>item.text);let result;
     if(!embedder?.supportsBatchLifecycle)await options.onPosted({texts:input});
     if(typeof embedder==='function'){result=[];for(const text of input){if(signal?.aborted){const error=Error('向量维护已停止');error.outcome='cancelled';throw error}result.push(await embedder(text))}}
     else if(typeof embedder?.embed==='function')result=await embedder.embed(input,options);
     else throw Error('向量客户端无效');
     if(!Array.isArray(result)||result.length!==input.length)throw invalidVector('向量响应数量不匹配');
     const outstanding=sendItems.filter(item=>!completed.has(item.hash));
     if(outstanding.length)await options.onBatch({texts:outstanding.map(item=>item.text),vectors:outstanding.map(item=>result[sendItems.indexOf(item)])});
    }
   } catch(error){
    const unknown=error?.outcome==='unknown'||posted.size>0&&!['rejected','received-invalid'].includes(error?.outcome);
    const pendingPosted=[...posted].filter(hash=>!completed.has(hash));
    await settle(pendingPosted,unknown?'unknown':'rejected').catch(()=>{});
    if(unknown)for(const hash of pendingPosted)shared.unknown.add(canonical([identity,hash]));
    await settle(reserved.filter(hash=>!posted.has(hash)&&!completed.has(hash)),'cancelled').catch(()=>{});
    const verdict=unknown?Object.assign(Error(String(error?.message??error)),{outcome:'unknown'}):error;
    for(const item of owned)if(!completed.has(item.hash))item.reject(verdict);
   } finally {for(const item of owned)if(shared.pending.get(item.key)===item.promise)shared.pending.delete(item.key);}
  }
  return Promise.all(texts.map(text=>waits.get(sha256Hex(text))));
 }
 async function mark(pointer,status,error=null,runId=null) {
  if(typeof journal.completeIndex==='function')await journal.completeIndex(pointer,{identity:keyOf(pointer),status,error,runId});
 }
 function remember(key,value){cache.delete(key);cache.set(key,value);while(cache.size>cacheSize)cache.delete(cache.keys().next().value)}
 async function build(pointer,token) {
  const rows=await journal.getRecords(pointer),records=new Map(),graph=new MultiDirectedGraph();
  for(const row of rows){
   if(typeof row.id!=='string'||!row.id||records.has(row.id))throw Error('正式 ID 缺失或发生类型冲突');
   records.set(row.id,structuredClone(row));graph.addNode(row.id,{record_kind:row.record_kind});
  }
  const unresolved=[];
  function edge(from,to,type){const id=canonical([from,to,type]);if(from!==to&&!graph.hasEdge(id))graph.addDirectedEdgeWithKey(id,from,to,{type})}
  for(const row of rows)for(const [target,type]of references(row)){
   if(!records.has(target)){unresolved.push({source_id:row.id,target_id:target,type});continue}
   edge(row.id,target,type);
   if(['owner','participant','from','to'].includes(type))edge(target,row.id,'related-'+type);
  }
  let dimensions=null,vectors=new Map(),failure=null;
  if(embedder)try {
   for(const row of rows){const value=await cachedVector(sha256Hex(canonical(worldSourceEvidence(row))));if(!value)continue;if(dimensions!==null&&value.length!==dimensions)throw Error('向量维度与同版索引不一致');dimensions=value.length;vectors.set(row.id,value)}
  } catch(error){failure=String(error.message);vectors.clear();dimensions=null}
  const index=await create({schema:{text:'string',chatHistory:'boolean'},components:{tokenizer:createMandarinTokenizer()}});
  const vectorIndex=dimensions?await create({schema:{text:'string',chatHistory:'boolean',embedding:'vector['+dimensions+']'},components:{tokenizer:createMandarinTokenizer()}}):null;
  for(const row of rows){const text=canonical(worldSourceEvidence(row)).toLowerCase();await insert(index,{id:row.id,text,chatHistory:isChatHistoryRecord(row)});if(vectors.has(row.id))await insert(vectorIndex,{id:row.id,text,chatHistory:isChatHistoryRecord(row),embedding:vectors.get(row.id)})}
  const result={pointer:structuredClone(pointer),index,vectorIndex,graph,records,dimensions,unresolved,failure,vectorCount:vectors.size,vectors,dirty:new Set(rows.filter(row=>!vectors.has(row.id)).map(row=>row.id)),readers:0,waiters:[],exposed:false};
  result.dependents=new Map();for(const row of rows)for(const [target]of references(row)){if(!result.dependents.has(target))result.dependents.set(target,new Set());result.dependents.get(target).add(row.id)}
  // A stale build may finish its fixed read, but cannot replace the current cache.
  if(token!==generation)return result;
  remember(keyOf(pointer),result);
  return result;
 }
 async function advance(pointer,token) {
  const previous=[...cache.values()].filter(v=>v.pointer.world_id===pointer.world_id&&v.pointer.branch_id===pointer.branch_id&&v.pointer.revision<pointer.revision).sort((a,b)=>b.pointer.revision-a.pointer.revision)[0];
  if(!previous||typeof journal.getRecordChanges!=='function')return build(pointer,token);
  const delta=await journal.getRecordChanges(pointer,{after_revision:previous.pointer.revision});
  if(delta.source_changed)return build(pointer,token);
  const changes=new Map((delta.changes??[]).filter(c=>c.kind!=='chronicle').map(c=>[c.id,c]));
  const ids=[...changes].filter(([,c])=>c.after!=null).map(([id])=>id),rows=ids.length?await journal.getRecords(pointer,ids):[];
  if(rows.length!==ids.length||new Set(rows.map(r=>r.id)).size!==ids.length||rows.some(r=>!ids.includes(r.id)))throw Error('正式记录回取身份不匹配');
  previous.retiring=true;cache.delete(keyOf(previous.pointer));
  while(previous.readers)await new Promise(resolve=>previous.waiters.push(resolve));
  let b=previous;
  if(b.exposed){const index=await create({schema:{text:'string',chatHistory:'boolean'},components:{tokenizer:createMandarinTokenizer()}});await load(index,structuredClone(await save(b.index)));let vectorIndex=null;if(b.vectorIndex){vectorIndex=await create({schema:{text:'string',chatHistory:'boolean',embedding:'vector['+b.dimensions+']'},components:{tokenizer:createMandarinTokenizer()}});await load(vectorIndex,structuredClone(await save(b.vectorIndex)))}b={...b,index,vectorIndex,graph:b.graph.copy(),records:new Map(b.records),vectors:new Map(b.vectors),dirty:new Set(b.dirty),dependents:new Map([...b.dependents].map(([id,set])=>[id,new Set(set)])),waiters:[],readers:0,exposed:false}}
  const affected=new Set(changes.keys());for(const id of changes.keys())for(const source of b.dependents.get(id)??[])affected.add(source);
  const edgeKey=(from,to,type)=>canonical([from,to,type]);
  for(const id of affected){const row=b.records.get(id);if(!row)continue;for(const [target,type]of references(row)){for(const key of [edgeKey(id,target,type),edgeKey(target,id,'related-'+type)])if(b.graph.hasEdge(key))b.graph.dropEdge(key);if(changes.has(id))b.dependents.get(target)?.delete(id)}}
  for(const id of changes.keys()){if(b.records.has(id))await remove(b.index,id);if(b.vectors.has(id)){await remove(b.vectorIndex,id);b.vectors.delete(id)}b.records.delete(id);b.dirty.delete(id);if(b.graph.hasNode(id))b.graph.dropNode(id)}
  for(const row of rows){b.records.set(row.id,structuredClone(row));b.graph.addNode(row.id,{record_kind:row.record_kind});await insert(b.index,{id:row.id,text:canonical(worldSourceEvidence(row)).toLowerCase(),chatHistory:isChatHistoryRecord(row)});b.dirty.add(row.id);for(const [target]of references(row)){if(!b.dependents.has(target))b.dependents.set(target,new Set());b.dependents.get(target).add(row.id)}}
  b.unresolved=b.unresolved.filter(r=>!affected.has(r.source_id));
  function edge(from,to,type){const key=edgeKey(from,to,type);if(from!==to&&!b.graph.hasEdge(key))b.graph.addDirectedEdgeWithKey(key,from,to,{type})}
  for(const id of affected){const row=b.records.get(id);if(!row)continue;for(const [target,type]of references(row)){if(!b.records.has(target)){b.unresolved.push({source_id:id,target_id:target,type});continue}edge(id,target,type);if(['owner','participant','from','to'].includes(type))edge(target,id,'related-'+type)}}
  if(b.exposed)remember(keyOf(previous.pointer),previous);b.pointer=structuredClone(pointer);b.retiring=false;b.vectorCount=b.vectors.size;
  if(token===generation)remember(keyOf(pointer),b);return b;
 }
 async function ensureIndex(pointer,expose=false) {
  checkPointer(pointer);const key=keyOf(pointer);
  if(cache.has(key)){const item=cache.get(key);remember(key,item);if(expose)item.exposed=true;return item}
  if(pending.has(key)){const value=await pending.get(key);if(expose)value.exposed=true;return value}
  const token=generation,job=advancing.then(()=>advance(structuredClone(pointer),token)).then(value=>{if(expose)value.exposed=true;return value}).finally(()=>{if(pending.get(key)===job)pending.delete(key)});
  advancing=job.catch(()=>{});pending.set(key,job);return job;
 }
 function releaseLease(built){built.readers--;if(!built.readers)for(const resolve of built.waiters.splice(0))resolve()}
 async function leaseIndex(pointer){
  while(true){const built=await ensureIndex(pointer);if(built.retiring||keyOf(built.pointer)!==keyOf(pointer))continue;built.readers++;return built;}
 }
 function maintain(pointer,{signal}={}) {
  try {checkPointer(pointer);pointer=structuredClone(pointer)}catch(error){return Promise.resolve({status:'failed',error:String(error?.message??error)})}const key=keyOf(pointer);
  if(maintenance.has(key))return maintenance.get(key);
  const token=generation,runId=requestId(),controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  controllers.add(controller);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let leased=null;
  const job=(async()=>{
   await Promise.resolve();
   try {
    if(!embedder)return {status:'disabled',pointer};
    if(controller.signal.aborted)return {status:'cancelled',pointer};
    if(typeof journal.beginIndexMaintenance==='function')await journal.beginIndexMaintenance(pointer,{embeddingIdentity:identity,runId});
    const built=await leaseIndex(pointer);leased=built;const dirty=[...built.dirty],texts=dirty.map(id=>canonical(worldSourceEvidence(built.records.get(id))));
    // Detached hash inputs need no index lease while waiting on the provider.
     releaseLease(built);leased=null;
     const values=await vectorsFor(texts,pointer,{signal:controller.signal});
    if(values.some(value=>value.length!==values[0]?.length))throw Error('向量维度与同版索引不一致');
    if(token!==generation||controller.signal.aborted)return {status:'cancelled',pointer};
    if(cache.get(key)!==built||built.retiring||keyOf(built.pointer)!==key){await mark(pointer,'done',null,runId);return {status:'done',pointer,count:values.length};}
     built.readers++;leased=built;
     for(let i=0;i<dirty.length;i++){const id=dirty[i],value=values[i];if(built.dimensions!==null&&value.length!==built.dimensions)throw Error('向量维度与同版索引不一致');if(!built.vectorIndex){built.dimensions=value.length;built.vectorIndex=await create({schema:{text:'string',chatHistory:'boolean',embedding:'vector['+value.length+']'},components:{tokenizer:createMandarinTokenizer()}})}if(built.vectors.has(id))await remove(built.vectorIndex,id);await insert(built.vectorIndex,{id,text:texts[i].toLowerCase(),chatHistory:isChatHistoryRecord(built.records.get(id)),embedding:value});built.vectors.set(id,value);built.dirty.delete(id)}built.vectorCount=built.vectors.size;built.failure=null;await mark(pointer,'done',null,runId);return {status:'done',pointer,count:values.length};
   } catch(error){const status=error?.outcome==='unknown'?'unknown':controller.signal.aborted?'cancelled':'failed';if(token===generation){await mark(pointer,status,String(error?.message??error),runId).catch(()=>{})}return {status,pointer,error:String(error?.message??error)};
   } finally {if(leased)releaseLease(leased);controllers.delete(controller);signal?.removeEventListener('abort',abort);if(maintenance.get(key)===job)maintenance.delete(key);}
  })();maintenance.set(key,job);return job;
 }
 async function recall(pointer,{query='',referenceIds=[],purpose='world',excludeSettings=false,maxRecords=WORLD_RETRIEVAL_TOP_DEFAULT,maxDepth=WORLD_RETRIEVAL_DEPTH_DEFAULT,similarity=WORLD_RETRIEVAL_MIN_SCORE_DEFAULT}={}, {signal}={}) {
  checkPointer(pointer);
  if(purpose!=='world')throw Error('chat 用途必须经过正式观察与知情投影');
  if(typeof query!=='string'||!Array.isArray(referenceIds)||referenceIds.some(id=>typeof id!=='string'||!id))throw Error('检索查询或引用无效');
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1||!Number.isSafeInteger(maxDepth)||maxDepth<0||typeof similarity!=='number'||!Number.isFinite(similarity)||similarity<0||similarity>1)throw Error('检索预算无效');
  pointer=structuredClone(pointer);let built=await leaseIndex(pointer),leased=true;try {
  let failure=built.failure,response={hits:[]},mode='fulltext-graph';
  const term=query.trim().toLowerCase(),filter=excludeSettings?{where:{chatHistory:true}}:{};
  const allowed=row=>!excludeSettings||isChatHistoryRecord(row);
  if(term) {
   response=await search(built.index,{term,properties:['text'],limit:maxRecords,tolerance:0,threshold:0,...filter});
   if(embedder&&built.dimensions&&!failure){
     releaseLease(built);leased=false;
     try {
      const [value]=await vectorsFor([term],pointer,{signal});
      if(signal?.aborted)throw Object.assign(Error('检索已取消'),{name:'AbortError'});
      built=await leaseIndex(pointer);leased=true;
      if(value.length!==built.dimensions)throw Error('查询向量维度与索引不一致');
      const semantic=await search(built.vectorIndex,{mode:'hybrid',term,properties:['text'],limit:maxRecords,vector:{value,property:'embedding'},similarity,...filter});
      response={hits:[...new Map([...semantic.hits,...response.hits].map(hit=>[hit.id,hit])).values()].slice(0,maxRecords)};mode='hybrid-graph';
     } catch(error){if(signal?.aborted)throw Object.assign(Error('检索已取消'),{name:'AbortError'});failure=String(error.message)}
     finally {if(!signal?.aborted&&!leased){built=await leaseIndex(pointer);leased=true}}
    }
  }
  const hits=response.hits.map(hit=>({id:hit.id,score:hit.score}));
  if(!hits.length)mode=referenceIds.length?'references':mode;
  const selected=new Set(),missing=[];
  // Explicit references are retained ahead of optional semantic candidates.
  for(const id of referenceIds){if(built.records.has(id)){if(allowed(built.records.get(id)))selected.add(id)}else missing.push(id)}
  // Keep ranked matches before expanding neighbors: a busy first entity must not erase
  // an already matched original source or old cause later in the ranking.
  for(const hit of hits)if(selected.size<maxRecords&&built.records.has(hit.id)&&allowed(built.records.get(hit.id)))selected.add(hit.id);
  const seeds=[...selected];
  for(const id of seeds){
   if(!built.graph.hasNode(id))continue;
   bfsFromNode(built.graph,id,(node,attr,depth)=>{
    if((selected.size<maxRecords||selected.has(node))&&allowed(built.records.get(node)))selected.add(node);
    return depth>=maxDepth||selected.size>=maxRecords;
   },{mode:'outbound'});
  }
  const ids=[...selected];
  const records=await journal.getRecords(pointer,ids);
  if(records.length!==ids.length||new Set(records.map(r=>r.id)).size!==ids.length||records.some(r=>!selected.has(r.id)))throw Error('正式记录回取身份不匹配');
  // Dependencies of returned records belong to this recall; unrelated broken rows do not.
  for(const ref of built.unresolved)if(selected.has(ref.source_id)&&!missing.includes(ref.target_id))missing.push(ref.target_id);
  const limited=missing.length>0,vectorUnavailable=!!embedder&&(!!failure||built.vectorCount<built.records.size);
  last={world_id:pointer.world_id,branch_id:pointer.branch_id,revision:pointer.revision,mode,limited,vector_unavailable:vectorUnavailable,...(vectorUnavailable?{vector_reason:failure??'当前版本的部分资料尚无可用向量'}:{}),hits:structuredClone(hits),unresolved:missing};
  return {...last,records};
  }finally{if(leased)releaseLease(built)}
 }
 return {ensureIndex:pointer=>ensureIndex(pointer,true),maintain,search:recall,async rebuild(pointer){checkPointer(pointer);cache.delete(keyOf(pointer));return ensureIndex(pointer)},
  invalidate(){generation++;advancing=Promise.resolve();for(const controller of controllers)controller.abort();cache.clear();pending.clear();maintenance.clear()},diagnostics(){return {cacheEntries:cache.size,pending:pending.size,maintenance:maintenance.size,identity,last:structuredClone(last)}}};
}

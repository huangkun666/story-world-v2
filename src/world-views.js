// 世界浏览只读投影：正式 ID、完整原文和明述方位；不修改世界账。
import {buildMapData} from './geography.js';
import {eventEntityIds,EVENT_PROTOCOL} from './event-contract.js';
const rows=v=>Array.isArray(v)?v:[];
const copy=v=>structuredClone(v);
const birth=r=>Number.isFinite(r?.tick)?r.tick:(/^ev_(\d+)_/.exec(String(r?.id))?.[1]===undefined?null:Number(/^ev_(\d+)_/.exec(String(r.id))[1]));
export const BEARING_LABELS={north:'北',northeast:'东北',east:'东',southeast:'东南',south:'南',southwest:'西南',west:'西',northwest:'西北'};
const vectors={north:[0,-1],northeast:[1,-1],east:[1,0],southeast:[1,1],south:[0,1],southwest:[-1,1],west:[-1,0],northwest:[-1,-1]};
export function buildWorldViews(world,{oldVolumes=[]}={}){
 const w=copy(world||{}),tick=w.meta?.tick??0,events=new Map(),chronicle=new Map();
 for(const ms of rows(w.milestones))for(const r of rows(ms.rows))if(r?.id&&(birth(r)==null||birth(r)<=tick))events.set(String(r.id),{...r,archived:true});
 // 极旧存档只留标题与引用；恢复可浏览身份，不伪造原文或地点。
 for(const ms of rows(w.milestones))for(const [i,id]of rows(ms.ids).entries())if(id&&!events.has(String(id))&&(birth({id})==null||birth({id})<=tick))events.set(String(id),{id:String(id),...(typeof ms.titles?.[i]==='string'?{title:ms.titles[i]}:{}),archived:true,legacySummary:true});
 for(const r of rows(w.events))if(r?.id&&(birth(r)==null||birth(r)<=tick))events.set(String(r.id),r);
 for(const r of [...oldVolumes.flatMap(v=>rows(v?.rows)),...rows(w.chronicle)])if(r?.id&&(!Number.isFinite(r.tick)||r.tick<=tick))chronicle.set(String(r.id),copy(r));
 for(const e of events.values())e.chronicle=[...chronicle.values()].filter(c=>c.eventRef===e.id||c.chainRef===e.id);
 const geography=copy(w.context?.setting?.frozen?.canon?.geography||{version:1,places:[],links:[]});
 geography.places=rows(geography.places);geography.links=rows(geography.links);
 for(const r of [...rows(w.meta?.sourcePublication?.records),...rows(w.meta?.sourcePublication?.updates).flatMap(u=>rows(u.records))])if(r.record_kind==='location'&&r.id&&r.name){
  let place=geography.places.find(p=>p.id===r.id);if(!place){place={id:r.id,name:r.name,aliases:rows(r.aliases)};geography.places.push(place);}
  place.sourceRecord=copy(r);
  // Source details belong to the read-only view; keep older fields when a later adopted map is partial.
  if(r.fields&&typeof r.fields==='object'&&!Array.isArray(r.fields)&&Object.keys(r.fields).length)place.sourceFields={...(place.sourceFields??{}),...copy(r.fields)};
 }
 for(const name of rows(w.context?.positions))if(typeof name==='string'&&name!=='未明'&&!geography.places.some(p=>p.name===name||rows(p.aliases).includes(name)))geography.places.push({id:'declared:'+encodeURIComponent(name),name});
 w.context??={};w.context.setting??={};w.context.setting.frozen??={};w.context.setting.frozen.canon??={};w.context.setting.frozen.canon.geography=geography;
 const map=buildMapData({...w,events:[...events.values()]});
 const ids=new Set(map.places.map(p=>p.id));
 // 在旧数据投影也只接受明确的结构字段，通道方向不会被当成东南西北。
 const links=geography.links.filter(l=>l&&(l.from!==l.to||l.type==='within')&&ids.has(l.from)&&ids.has(l.to)&&(['within','adjacent','passage'].includes(l.type)||(l.type==='bearing'&&vectors[l.bearing]))).map(copy);
 const entities=rows(w.entities),agendas=rows(w.agendas),conditions=rows(w.conditions);
 const relations=rows(w.relations).filter(r=>!Number.isFinite(r.tick)||r.tick<=tick).map(r=>({...r,ended:Number.isFinite(r.endedTick)&&r.endedTick<=tick}));
 const causalNodes=[],causalEdges=[],known=new Set();
 for(const [kind,list]of [['entity',entities],['agenda',agendas],['event',[...events.values()]],['condition',conditions]]){
  for(const raw of list){if(!raw?.id)continue;const id=kind+':'+raw.id;known.add(id);causalNodes.push({id,recordId:raw.id,kind,label:raw.name||raw.title||raw.goal||raw.statement||raw.id,raw});}
 }
 const seen=new Set();const add=(from,to,label)=>{const key=JSON.stringify([from,to,label]);if(from!==to&&known.has(from)&&known.has(to)&&!seen.has(key)){seen.add(key);causalEdges.push({id:'causal:'+encodeURIComponent(key),from,to,label});}};
 for(const e of events.values()){
  if(e.source?.ref)add((e.source.type==='plot'?'agenda:':'event:')+e.source.ref,'event:'+e.id,'引发');
  for(const up of rows(e.links?.up))if(e.source?.type==='plot'||up!==e.source?.ref)add('event:'+up,'event:'+e.id,'前因');
  // 只附正式引用，公开范围不等于受影响者，参与连线不冒充因果。
  for(const ref of eventEntityIds(e,w)){
   if(e.eventProtocol===EVENT_PROTOCOL){
    if(rows(e.actors).some(a=>a.ref===ref))add('entity:'+ref,'event:'+e.id,'当事人');
    if(rows(e.affected).some(scope=>rows(scope.resolution?.knownIds).includes(ref)))add('event:'+e.id,'entity:'+ref,'影响');
   }else add('event:'+e.id,'entity:'+ref,'涉及');
  }

 }
 for(const a of agendas){
  add('entity:'+a.owner,'agenda:'+a.id,'持有');
  if(a.parentId)add('agenda:'+a.parentId,'agenda:'+a.id,'派生');
  if(a.source?.ref)add((a.source.type==='parent'?'agenda:':'event:')+a.source.ref,'agenda:'+a.id,'起因');
 }
 for(const c of conditions){add('event:'+c.eventRef,'condition:'+c.id,'形成');if(c.supersedes)add('condition:'+c.supersedes,'condition:'+c.id,'替代');if(c.endCause)add('event:'+c.endCause,'condition:'+c.id,'结束');}
 return {tick,worldName:w.context.world||'世界',places:map.places,links,unlocated:map.unlocated,entities,events:[...events.values()],agendas,conditions,relations,causalNodes,causalEdges,chronicle:[...chronicle.values()]};
}
function axisRanks(ids,links,axis){
 const parents=new Map(ids.map(id=>[id,id]));
 const find=id=>{let p=id;while(parents.get(p)!==p)p=parents.get(p);return p;};
 for(const l of links)if(vectors[l.bearing][axis]===0)parents.set(find(l.from),find(l.to));
 const vertices=[...new Set(ids.map(find))],edges=new Map(vertices.map(id=>[id,new Set()])),degree=new Map(vertices.map(id=>[id,0])),rank=new Map(vertices.map(id=>[id,0]));
 for(const l of links){
  const d=vectors[l.bearing][axis];if(!d)continue;
  const low=find(d>0?l.to:l.from),high=find(d>0?l.from:l.to);
  if(low===high)return null;
  if(!edges.get(low).has(high)){edges.get(low).add(high);degree.set(high,degree.get(high)+1);}
 }
 const ready=vertices.filter(id=>degree.get(id)===0);let visited=0;
 while(ready.length){const id=ready.shift();visited++;for(const to of edges.get(id)){rank.set(to,Math.max(rank.get(to),rank.get(id)+1));degree.set(to,degree.get(to)-1);if(!degree.get(to))ready.push(to);}}
 if(visited!==vertices.length)return null;
 return new Map(ids.map(id=>[id,rank.get(find(id))]));
}
export function layoutWorldPlaces(places,allLinks){
 const byId=new Map(places.map(p=>[p.id,p])),links=allLinks.filter(l=>l.type==='bearing'&&vectors[l.bearing]&&byId.has(l.from)&&byId.has(l.to)&&l.from!==l.to);
 const neighbors=new Map();for(const l of links){for(const [a,b]of [[l.from,l.to],[l.to,l.from]]){if(!neighbors.has(a))neighbors.set(a,new Set());neighbors.get(a).add(b);}}
 const visited=new Set(),points=[],warnings=[];let offset=0,group=0;
 for(const start of neighbors.keys()){
  if(visited.has(start))continue;
  const ids=[],pending=[start];while(pending.length){const id=pending.shift();if(visited.has(id))continue;visited.add(id);ids.push(id);pending.push(...neighbors.get(id));}
  const set=new Set(ids),local=links.filter(l=>set.has(l.from)&&set.has(l.to)),xs=axisRanks(ids,local,0),ys=axisRanks(ids,local,1);group++;
  if(!xs||!ys){warnings.push('方位记录有矛盾：'+ids.map(id=>byId.get(id).name).join('、'));continue;}
  const cohorts=new Map(),slots=new Map();
  for(const id of ids){const key=xs.get(id)+','+ys.get(id);cohorts.set(key,(cohorts.get(key)||0)+1);}
  const rowStep=Math.max(235,Math.max(...cohorts.values())*76+150);
  for(const id of ids){const key=xs.get(id)+','+ys.get(id),slot=slots.get(key)||0;slots.set(key,slot+1);
   const facts=local.filter(l=>l.from===id).map(l=>byId.get(l.to).name+'以'+BEARING_LABELS[l.bearing]);
   points.push({...byId.get(id),x:offset+150+xs.get(id)*280,y:105+ys.get(id)*rowStep,cohortIndex:slot,cohortSize:cohorts.get(key),group,directionText:facts.join('、')||'本组方位参照'});
  }
  offset+=Math.max(...ids.map(id=>xs.get(id)))*280+480;
 }
 const placed=new Set(points.map(p=>p.id)),maxX=Math.max(800,...points.map(p=>p.x+180)),maxY=Math.max(600,...points.map(p=>p.y+210+(p.cohortSize-1)*76));
 return {points,unknown:places.filter(p=>!placed.has(p.id)),warnings,box:{x:0,y:0,w:maxX,h:maxY},groups:group};
}

// 确定性阅读布局。因果只用非人物记录分层，人物作为旁注；循环同层列出。
export function layoutWorldNetwork(nodes,edges,{causal=false,focusId=null,compact=false}={}){
 const byId=new Map(nodes.map(n=>[n.id,n])),points=[];
 const put=(n,x,y)=>points.push({...n,x,y});
 if(compact&&focusId&&byId.has(focusId)){put(byId.get(focusId),200,100);nodes.filter(n=>n.id!==focusId).forEach((n,i)=>put(n,200,250+i*150));}
 else if(focusId&&byId.has(focusId)){
  const center=byId.get(focusId),others=nodes.filter(n=>n.id!==focusId);
  const left=[],right=[];
  for(const n of others){const incoming=edges.some(e=>e.from===n.id&&e.to===focusId),outgoing=edges.some(e=>e.from===focusId&&e.to===n.id);let side=incoming&&!outgoing?left:outgoing&&!incoming?right:left.length<=right.length?left:right;if(side.length>(side===left?right:left).length)side=side===left?right:left;side.push(n);}
  put(center,450,110+(Math.max(left.length,right.length,1)-1)*56);
  for(const [col,list]of [[0,left],[2,right]])list.forEach((n,i)=>put(n,150+col*300,110+i*112));
 }else if(causal){
  const body=nodes.filter(n=>n.kind!=='entity'),adj=new Map(body.map(n=>[n.id,[]])),rev=new Map(body.map(n=>[n.id,[]]));
  for(const e of edges)if(adj.has(e.from)&&adj.has(e.to)){adj.get(e.from).push(e.to);rev.get(e.to).push(e.from);}
  // 迭代的强连通分组，不靠递归深度；同一个循环不会丢记录。
  const seen=new Set(),order=[];
  for(const n of body){if(seen.has(n.id))continue;seen.add(n.id);const stack=[[n.id,0]];
   while(stack.length){const frame=stack.at(-1),list=adj.get(frame[0]);if(frame[1]<list.length){const to=list[frame[1]++];if(!seen.has(to)){seen.add(to);stack.push([to,0]);}}else{order.push(frame[0]);stack.pop();}}
  }
  const component=new Map();let count=0;
  for(const start of order.reverse()){if(component.has(start))continue;const pending=[start];component.set(start,count);
   for(let i=0;i<pending.length;i++)for(const to of rev.get(pending[i]))if(!component.has(to)){component.set(to,count);pending.push(to);}count++;
  }
  const next=Array.from({length:count},()=>new Set()),degree=Array(count).fill(0),rank=Array(count).fill(0);
  for(const e of edges){const a=component.get(e.from),b=component.get(e.to);if(a!==undefined&&b!==undefined&&a!==b&&!next[a].has(b)){next[a].add(b);degree[b]++;}}
  const ready=degree.flatMap((v,i)=>v===0?[i]:[]);for(let i=0;i<ready.length;i++)for(const to of next[ready[i]]){rank[to]=Math.max(rank[to],rank[ready[i]]+1);if(--degree[to]===0)ready.push(to);}
  const columns=new Map();for(const n of body){const col=rank[component.get(n.id)]??0;if(!columns.has(col))columns.set(col,[]);columns.get(col).push(n);}
  // 邻列重心排序减小交叉，固定输入时坐标保持一致。
  const indices=new Map();const index=()=>{for(const list of columns.values())list.forEach((n,i)=>indices.set(n.id,i));};index();
  for(let pass=0;pass<2;pass++)for(const [col,list]of [...columns].sort((a,b)=>a[0]-b[0])){
   const score=n=>{const neighbors=[...rev.get(n.id),...adj.get(n.id)].filter(id=>(rank[component.get(id)]??0)!==col);return neighbors.length?neighbors.reduce((v,id)=>v+(indices.get(id)??0),0)/neighbors.length:indices.get(n.id);};
   const scores=new Map(list.map(n=>[n.id,score(n)]));list.sort((a,b)=>scores.get(a.id)-scores.get(b.id)||indices.get(a.id)-indices.get(b.id));index();
  }
  for(const [col,list]of columns)list.forEach((n,i)=>put(n,150+col*320,110+i*150));
  const maxRows=Math.max(1,...[...columns.values()].map(list=>list.length)),entityRows=new Map(),located=new Map(points.map(p=>[p.id,p]));
  for(const n of nodes.filter(n=>n.kind==='entity')){const near=edges.filter(e=>e.from===n.id||e.to===n.id).map(e=>located.get(e.from===n.id?e.to:e.from)).filter(Boolean),x=near.length?Math.min(...near.map(p=>p.x)):150,row=entityRows.get(x)||0;entityRows.set(x,row+1);put(n,x,110+(maxRows+row)*150);}
 }else{
  const columns=Math.min(8,Math.max(1,Math.ceil(Math.sqrt(nodes.length))));nodes.forEach((n,i)=>put(n,150+(i%columns)*300,110+Math.floor(i/columns)*150));
 }
 const w=Math.max(compact?400:600,...points.map(p=>p.x+155)),h=Math.max(350,...points.map(p=>p.y+90));
 return {points,box:{x:0,y:0,w,h}};
}

// Read-only G6 projection. Layout and rendering are owned by the runtime.
import {BEARING_LABELS} from '../src/world-views.js';
const rows=value=>Array.isArray(value)?value:[];
const placeLinkLabel=l=>l.via||(l.type==='bearing'?(Object.hasOwn(BEARING_LABELS,l.bearing)?'方位：'+BEARING_LABELS[l.bearing]:'方位'):({within:'包含',adjacent:'相邻',passage:'通道'})[l.type]||'');
// JSON records only: omit callbacks rather than retaining mutable source references.
const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const coords=p=>Object.fromEntries(['x','y','z'].filter(k=>Number.isFinite(p[k])).map(k=>[k,p[k]]));
const printable=value=>typeof value==='object'?JSON.stringify(value):String(value);
function canonicalRecord(value){
 if(Array.isArray(value))return value.map(canonicalRecord);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalRecord(value[key])]));
 return value;
}
function placeLinkId(link,occurrences){
 // Preserve from as the decoded array's first item for map click navigation.
 // Formal ID comes first in identity; full evidence distinguishes conflicting records.
 const record=canonicalRecord(copy(link)),identity=[link.from,link.to,link.id!=null?['id',link.id]:['record'],record];
 const key=JSON.stringify(identity),occurrence=occurrences.get(key)||0;occurrences.set(key,occurrence+1);
 return 'place-link:'+encodeURIComponent(JSON.stringify([...identity,occurrence]));
}
function recordNode(p){
 const raw=p.raw||p,kind=p.kind||'entity',recordId=p.recordId??raw.id??String(p.id).slice(kind.length+1);
 const detail=['at','timeMark','position','location'].filter(k=>raw[k]!==undefined&&raw[k]!==null&&raw[k]!=='').map(k=>(k==='position'||k==='location'?'位置：':'')+printable(raw[k])).join(' · ');
 return {id:p.id,data:{kind,label:p.label||raw.name||raw.title||raw.goal||raw.statement||recordId,detail,recordId,raw:copy(raw)},style:coords(p)};
}
function relationEdge(raw){return {id:'relation:'+raw.id,source:'entity:'+raw.from,target:'entity:'+raw.to,data:{...copy(raw),label:raw.type||'',recordId:raw.id,ended:!!raw.ended,raw:copy(raw)}};}
function cycles(nodes,edges){
 const adj=new Map(nodes.map(n=>[n.id,[]])),rev=new Map(nodes.map(n=>[n.id,[]]));
 for(const e of edges){adj.get(e.source).push(e.target);rev.get(e.target).push(e.source);}
 const seen=new Set(),order=[];
 for(const n of nodes){if(seen.has(n.id))continue;seen.add(n.id);const stack=[[n.id,0]];
  while(stack.length){const frame=stack.at(-1),next=adj.get(frame[0]);if(frame[1]<next.length){const to=next[frame[1]++];if(!seen.has(to)){seen.add(to);stack.push([to,0]);}}else{order.push(frame[0]);stack.pop();}}
 }
 const visited=new Set(),combos=[],byId=new Map(nodes.map(n=>[n.id,n]));
 for(const start of order.reverse()){if(visited.has(start))continue;const ids=[start];visited.add(start);for(let i=0;i<ids.length;i++)for(const to of rev.get(ids[i]))if(!visited.has(to)){visited.add(to);ids.push(to);}
  if(ids.length<2&&!adj.get(start).includes(start))continue;ids.sort();const id='cycle:'+encodeURIComponent(JSON.stringify(ids));
  combos.push({id,data:{kind:'cycle',label:'循环 · '+ids.length+' 条记录',nodeIds:[...ids]}});for(const nodeId of ids)byId.get(nodeId).combo=id;
 }
 return combos;
}
const graphState=s=>Object.fromEntries(['view','placePath','onlyRelated','focus','relationFocusId','relationPlaceId','causalFocusId','relPage','showEnded','kind','group','dimensions','dimension','relationDimensions','narrow'].map(k=>[k,s[k]??null]));
// The browser owns an immutable session projection; reuse it until navigation or revision changes.
export function createAtlasGraphProjector(){
 let world=null,graph=null,key=null,data=null;
 return (d,s,g)=>{const next=JSON.stringify(graphState(s));if(d!==world||g!==graph||next!==key){data=buildAtlasGraphData(d,s,g);world=d;graph=g;key=next;}return data;};
}
export function buildAtlasGraphData(d={},s={},g={}){
 const mode=['world','relations','causal'].includes(s.view)?s.view:'causal';let nodes=[],edges=[],combos=[],layout={type:mode==='relations'?'force':mode==='causal'?'causal':'preset'};
 if(mode==='world'){
  nodes=rows(g.points).map(p=>{const childCount=rows(d.links).filter(l=>l.type==='within'&&l.to===p.id&&l.from!==p.id).length;
   // Place data never exposes resident counts; formal records remain in the detail panel.
   const raw=Object.fromEntries(Object.entries(p).filter(([key])=>key!=='entities'));
   return {id:'place:'+p.id,data:{kind:'place',label:p.name,recordId:p.id,detail:'已记录 '+rows(p.events).length+' 个事件'+(childCount?' · '+childCount+' 个下级地点':''),directionText:p.directionText||'',raw:copy(raw)},style:coords(p)};
  });
  const visibleIds=new Set(nodes.map(n=>n.id)),linkOccurrences=new Map();
  edges=rows(g.edges).filter(l=>visibleIds.has('place:'+l.from)&&visibleIds.has('place:'+l.to)).map(l=>({id:placeLinkId(l,linkOccurrences),source:'place:'+l.from,target:'place:'+l.to,data:{...copy(l),label:placeLinkLabel(l),raw:copy(l)}}));
 }else{
  nodes=rows(g.points).filter(p=>mode!=='causal'||p.kind!=='entity').map(recordNode);const ids=new Set(nodes.map(n=>n.id));
  edges=rows(g.edges).filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>({id:e.id,source:e.from,target:e.to,data:{...copy(e),label:e.label||'',recordId:e.raw?.id??e.recordId,ended:e.ended,raw:copy(e.raw)}}));
  if(mode==='causal'){combos=cycles(nodes,edges);layout.cycleIds=combos.map(c=>c.id);}
 }
 const focusIds=[g.focusId,g.layoutFocusId,s.causalFocusId,s.relationFocusId?'relation:'+s.relationFocusId:null].filter((id,i,a)=>id&&a.indexOf(id)===i);
 const state=graphState(s);
 // Selection affects styles in the runtime, never the projection's structural identity.
 const signature=JSON.stringify({state,nodes:nodes.map(n=>[n.id,n.combo||null,n.data]),edges:edges.map(e=>[e.id,e.source,e.target,e.data]),combos,layout});
 return {nodes,edges,combos,layout,signature,focusIds,mode};
}

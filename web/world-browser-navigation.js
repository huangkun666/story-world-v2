// 图谱的只读导航：点击查看与显式进入、定位分开。
const rows=v=>Array.isArray(v)?v:[];
export function worldPlaceHierarchy(d,path=[]){
 const ids=new Set(d.places.map(p=>p.id)),parents=Object.fromEntries(d.places.map(p=>[p.id,[]])),children=Object.fromEntries(d.places.map(p=>[p.id,[]]));
 const links=d.links.filter(l=>l.type==='within'&&ids.has(l.from)&&ids.has(l.to));
 for(const l of links){if(!parents[l.from].includes(l.to))parents[l.from].push(l.to);if(!children[l.to].includes(l.from))children[l.to].push(l.from);}
 const hasHierarchy=!!links.length,roots=d.places.filter(p=>!parents[p.id].length&&children[p.id].length),reachable=new Set(roots.map(p=>p.id)),queue=[...reachable];
 for(let i=0;i<queue.length;i++)for(const id of children[queue[i]])if(!reachable.has(id)){reachable.add(id);queue.push(id);}
 const unassigned=hasHierarchy?d.places.filter(p=>!reachable.has(p.id)):[];
 const color=new Map(),warnings=[];let cycle=false;
 for(const p of d.places){if(color.has(p.id))continue;const stack=[[p.id,0]];color.set(p.id,1);
 while(stack.length){const f=stack.at(-1),next=children[f[0]];if(f[1]>=next.length){color.set(f[0],2);stack.pop();continue;}const id=next[f[1]++];if(color.get(id)===1)cycle=true;else if(!color.has(id)){color.set(id,1);stack.push([id,0]);}}}
 if(cycle)warnings.push('包含记录有循环；重复进入已停止，相关地点仍可从其他地点列表查看。');
 const placePath=[];
 if(hasHierarchy)for(const id of rows(path)){if(!ids.has(id)||!placePath.length&&!roots.some(p=>p.id===id)&&!unassigned.some(p=>p.id===id)||placePath.includes(id)||placePath.length&&!children[placePath.at(-1)].includes(id))break;placePath.push(id);}
 const visiblePlaces=hasHierarchy?(placePath.length?d.places.filter(p=>children[placePath.at(-1)].includes(p.id)):[...roots,...unassigned]):d.places;
 return {hasHierarchy,parents,children,roots,unassigned,placePath,visiblePlaces,warnings};
}
export function worldRelationGroups(d,showEnded=false){
 const byId=new Map(d.entities.map(e=>[e.id,e])),rels=d.relations.filter(r=>(showEnded||!r.ended)&&byId.has(r.from)&&byId.has(r.to)),adj=new Map(d.entities.map(e=>[e.id,new Set()]));
 for(const r of rels){adj.get(r.from).add(r.to);adj.get(r.to).add(r.from);}
 const seen=new Set(),groups=[],isolates=[];
 for(const e of d.entities){if(seen.has(e.id))continue;if(!adj.get(e.id).size){seen.add(e.id);isolates.push(e);continue;}
 const memberIds=[e.id];seen.add(e.id);for(let i=0;i<memberIds.length;i++)for(const id of adj.get(memberIds[i]))if(!seen.has(id)){seen.add(id);memberIds.push(id);}
 const set=new Set(memberIds),relations=rels.filter(r=>set.has(r.from)&&set.has(r.to)),members=memberIds.map(id=>byId.get(id));
 groups.push({id:'relation-group:'+encodeURIComponent([...memberIds].sort()[0]),memberIds,members,memberCount:members.length,relationCount:relations.length,relations,label:members.map(e=>e.name).slice(0,3).join('、')});}
 return {groups,isolates,relations:rels};
}
export function worldRelationCenter(d,s,relations){
 const place=d.places.find(p=>p.id===s.relationPlaceId),residentIds=new Set(rows(place?.entities).map(e=>e.id)),candidates=place?d.entities.filter(e=>residentIds.has(e.id)):d.entities;
 const requested=s.focus,degree=new Map(d.entities.map(e=>[e.id,0]));
 for(const r of relations){degree.set(r.from,(degree.get(r.from)||0)+1);degree.set(r.to,(degree.get(r.to)||0)+1);}
 return candidates.find(e=>e.id===requested)||[...candidates].sort((a,b)=>degree.get(b.id)-degree.get(a.id))[0]||null;
}
function recordExists(d,id){const [kind,...tail]=String(id||'').split(':'),key=tail.join(':');const list=({place:d.places,entity:d.entities,event:d.events,agenda:d.agendas,condition:d.conditions,relation:d.relations,chronicle:d.chronicle})[kind];return rows(list).some(r=>r.id===key);}
export function validateWorldBrowserState(d,s){
 const placePath=worldPlaceHierarchy(d,s.placePath).placePath,rel=worldRelationGroups(d,s.showEnded),center=worldRelationCenter(d,s,rel.relations)?.id;
 const edgeExists=id=>d.causalEdges.some(e=>e.id===id)||d.relations.some(r=>'relation:'+r.id===id);
 return {...s,onlyRelated:s.onlyRelated!==false,placePath,focus:d.entities.some(e=>e.id===s.focus)?s.focus:null,relationFocusId:d.relations.some(r=>r.id===s.relationFocusId)?s.relationFocusId:null,
 relationPlaceId:d.places.some(p=>p.id===s.relationPlaceId)?s.relationPlaceId:null,relationGroupId:null,selected:edgeExists(s.selectedEdgeId)?(s.selectedEdgeId.startsWith('relation:')?s.selectedEdgeId:null):recordExists(d,s.selected)?s.selected:null,selectedEdgeId:edgeExists(s.selectedEdgeId)?s.selectedEdgeId:null,
 causalFocusId:recordExists(d,s.causalFocusId)?s.causalFocusId:null,group:['auto','all','selected'].includes(s.group)||d.events.some(e=>'event:'+e.id===s.group)?s.group:'auto',
 relPage:Number.isSafeInteger(s.relPage)?Math.max(0,Math.min(s.relPage,Math.max(0,Math.ceil(new Set(rel.relations.filter(r=>r.from===center||r.to===center).flatMap(r=>[r.from,r.to]).filter(id=>id!==center)).size/(s.narrow?2:6))-1))):0,
 expanded:d.places.some(p=>p.id===s.expanded)?s.expanded:null};
}
function locatePlace(d,path,id){
 const h=worldPlaceHierarchy(d,path);if(h.visiblePlaces.some(p=>p.id===id))return h.placePath;
 const index=h.placePath.indexOf(id);if(index>=0)return h.placePath.slice(0,index);
 // 从目标向上找显式路径；循环和无上层的地点直接作为独立入口。
 const queue=[[id]],seen=new Set([id]),roots=new Set(h.roots.map(p=>p.id));
 for(let i=0;i<queue.length;i++){const chain=queue[i],current=chain[0];if(roots.has(current))return chain.slice(0,-1);
 for(const parent of h.parents[current]||[])if(!seen.has(parent)){seen.add(parent);queue.push([parent,...chain]);}}
 return [];
}
export function navigateWorldBrowser(d,s,action){
 const next={...s,relationGroupId:null,placePath:[...rows(s.placePath)]},id=action.id||s.selected;
 if(['focus','enter','level','relations-all'].includes(action.type)){next.selected=null;next.selectedEdgeId=null;}
 if(action.type==='select'){
  next.selected=s.selected===action.id?null:action.id;next.selectedEdgeId=null;next.searchResultsOpen=false;
  if(next.selected?.startsWith('entity:')&&recordExists(d,next.selected)){next.view='relations';next.focus=next.selected.slice(7);next.relationFocusId=null;next.relationPlaceId=null;next.onlyRelated=true;next.relPage=0;}
  return next;
 }
 if(action.type==='edge'){next.selectedEdgeId=s.selectedEdgeId===action.id?null:action.id;next.selected=next.selectedEdgeId?.startsWith('relation:')?next.selectedEdgeId:null;return next;}
 if(action.type==='dismiss'){next.selected=null;next.selectedEdgeId=null;return next;}
 if(action.type==='level'){next.placePath=next.placePath.slice(0,Math.max(0,action.depth));next.expanded=null;return next;}
 if(action.type==='enter'){next.view='world';const h=worldPlaceHierarchy(d,next.placePath);if(d.places.some(p=>p.id===action.id)&&(!h.children[action.id].length||!h.placePath.includes(action.id))){const parentPath=locatePlace(d,h.placePath,action.id);next.placePath=h.children[action.id].length?[...parentPath,action.id]:parentPath;if(!h.children[action.id].length)next.selected='place:'+action.id;next.expanded=null;}return next;}
 if(action.type==='relations-all'){next.view='relations';next.onlyRelated=false;next.focus=null;next.relationFocusId=null;next.relationPlaceId=null;next.relPage=0;return next;}
 if(action.type==='relations-place'){const place=d.places.find(p=>p.id===action.id);if(place){next.view='relations';next.relationPlaceId=place.id;next.relationResidentsOpen=true;next.relationFocusId=null;next.selected='place:'+place.id;next.selectedEdgeId=null;next.onlyRelated=true;next.focus=null;next.relPage=0;}return next;}
 if(action.type==='view'||action.type==='scene'){if(action.type==='view'&&['world','relations','causal'].includes(action.id)){next.view=action.id;if(action.id==='relations')next.relationPlaceId=null;if(action.id==='causal')next.group=s.group||'all';}if(action.type==='scene'&&['2d','3d'].includes(action.id))next.scene=action.id;next.selected=null;next.selectedEdgeId=null;next.expanded=null;return next;}
 if(action.type==='focus'||action.type==='locate'){
 const target=action.type==='focus'&&action.id&&recordExists(d,'entity:'+action.id)?'entity:'+action.id:id;
 if(target?.startsWith('entity:')&&recordExists(d,target)){next.view='relations';next.focus=target.slice(7);next.relationFocusId=null;next.relationPlaceId=null;next.onlyRelated=true;next.relPage=0;}
 else if(target?.startsWith('relation:')&&recordExists(d,target)){const r=d.relations.find(r=>'relation:'+r.id===target);next.view='relations';next.relationFocusId=r.id;next.relationPlaceId=null;next.onlyRelated=true;next.showEnded||=r.ended;next.relPage=0;}
 else if(action.type==='locate'&&target?.startsWith('place:')&&recordExists(d,target)){next.view='world';next.placePath=locatePlace(d,next.placePath,target.slice(6));next.selected=target;next.selectedEdgeId=null;}
 else if(action.type==='locate'&&target&&['event','agenda','condition'].some(k=>target.startsWith(k+':'))){next.view='causal';next.group='selected';next.kind='all';next.causalFocusId=target;next.selected=target;}
 else if(action.type==='focus'){next.view='relations';next.onlyRelated=true;next.relPage=0;}
 return next;}
 return next;
}

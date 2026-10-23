// 世界浏览纯渲染：完整原文与原字段只转义，图上短名不改账本。
import {escapeHtml as esc} from '../src/render-base.js';
import {layoutWorldPlaces,layoutWorldNetwork,BEARING_LABELS} from '../src/world-views.js';
import {worldPlaceHierarchy,worldRelationGroups,worldRelationCenter,navigateWorldBrowser,validateWorldBrowserState} from './world-browser-navigation.js';
export {navigateWorldBrowser,validateWorldBrowserState};
const rows=v=>Array.isArray(v)?v:[];
const short=s=>{const a=[...String(s||'')];return a.length>16?a.slice(0,15).join('')+'…':a.join('');};
const names={entity:'实体',event:'事件',agenda:'盘算',condition:'持续条件',relation:'关系',place:'地点',chronicle:'编年原文'};
const rect=(x,y,w,h,cls='')=>'<rect class="'+cls+'" x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="9"></rect>';
const text=(x,y,t,cls='')=>'<text class="'+cls+'" x="'+x+'" y="'+y+'" text-anchor="middle">'+esc(t)+'</text>';
const node=(id,label,body,cls='')=>'<g class="wb-node '+cls+'" data-wb-select="'+esc(id)+'" tabindex="0" role="button" aria-label="'+esc(label)+'">'+body+'<title>'+esc(label)+'</title></g>';
const pick=(id,label)=>'<button type="button" class="wb-pick" data-wb-select="'+esc(id)+'">'+esc(label)+'</button>';
const button=(action,label)=>'<button type="button" data-wb-action="'+action+'">'+label+'</button>';
export function worldBrowserRecords(d){return [['place',d.places],['entity',d.entities],['event',d.events],['agenda',d.agendas],['condition',d.conditions],['relation',d.relations],['chronicle',d.chronicle]].flatMap(([kind,list])=>list.map(raw=>({id:kind+':'+raw.id,kind,label:kind==='chronicle'?(Number.isFinite(raw.tick)?'第 '+raw.tick+' 轮 · ':'')+short(raw.text||raw.id):raw.name||raw.title||raw.goal||raw.statement||raw.type||raw.id,raw})));}
// A session owns a fixed read-only projection; ordinary selection does not change its geometry.
export function createWorldBrowserGraphCache(){
 let data=null,key=null,graph=null;
 const read=(d,s)=>{const next=JSON.stringify([s.view,s.placePath,s.mapCollapsed,s.mapOtherOpen,s.onlyRelated,s.focus,s.relationFocusId,s.relationPlaceId,s.causalFocusId,s.relPage,s.showEnded,s.kind,s.group,s.narrow,s.group==='selected'?s.selected:null]);if(d!==data||next!==key){graph=worldBrowserGraph(d,s);data=d;key=next;}return graph;};
 read.clear=()=>{data=key=graph=null;};return read;
}
export function worldBrowserGraph(d,s){
 if(s.view==='world'){
  const h=worldPlaceHierarchy(d,s.placePath);if(s.mapCollapsed&&h.hasHierarchy&&!h.placePath.length&&!s.mapOtherOpen)h.visiblePlaces=h.roots;const ids=new Set(h.visiblePlaces.map(p=>p.id)),edges=d.links.filter(l=>ids.has(l.from)&&ids.has(l.to));
  const g=layoutWorldPlaces(h.visiblePlaces,edges);
  if(!g.points.length&&!g.warnings.length&&h.visiblePlaces.length){const placed=layoutWorldNetwork(h.visiblePlaces.map(raw=>({...raw,kind:'place',raw})),[]);return {...g,...h,...placed,warnings:[...h.warnings,...g.warnings],points:placed.points.map(p=>({...p,directionText:'方位未载'})),unknown:[],edges,schematic:true};}
  return {...g,...h,warnings:[...h.warnings,...g.warnings],edges};
 }
 if(s.view==='relations'){
  const summary=worldRelationGroups(d,s.showEnded),pageSize=s.narrow?2:6,relationPlace=d.places.find(p=>p.id===s.relationPlaceId),residentIds=new Set(rows(relationPlace?.entities).map(e=>e.id)),residents=relationPlace?d.entities.filter(e=>residentIds.has(e.id)):[];
  let rels=summary.relations,entities=d.entities,focusId=null,totalRelated=0,page=0;
  const exact=rels.find(r=>r.id===s.relationFocusId);
  if(exact){rels=[exact];entities=entities.filter(e=>e.id===exact.from||e.id===exact.to);}
  else if(s.onlyRelated!==false){
   const center=worldRelationCenter(d,s,rels);
   if(center){focusId='entity:'+center.id;rels=rels.filter(r=>r.from===center.id||r.to===center.id);
    const neighbors=[...new Set(rels.flatMap(r=>[r.from,r.to]))].filter(id=>id!==center.id);totalRelated=neighbors.length;
    page=Number.isSafeInteger(s.relPage)?Math.max(0,Math.min(s.relPage,Math.max(0,Math.ceil(totalRelated/pageSize)-1))):0;const shown=new Set(neighbors.slice(page*pageSize,page*pageSize+pageSize));
    rels=rels.filter(r=>shown.has(r.from)||shown.has(r.to));entities=entities.filter(e=>e.id===center.id||shown.has(e.id));
   }else{entities=[];rels=[];}
  }
  const nodes=entities.map(raw=>({id:'entity:'+raw.id,label:raw.name,kind:'entity',raw})),edges=rels.map(raw=>({id:'relation:'+raw.id,from:'entity:'+raw.from,to:'entity:'+raw.to,label:raw.type,raw,ended:raw.ended}));
  const layoutFocusId=focusId||(exact?'entity:'+exact.from:null);return {...layoutWorldNetwork(nodes,edges,{focusId:layoutFocusId,compact:s.narrow}),...summary,edges,focusId,layoutFocusId,totalRelated,pageSize,relPage:page,residents,relationPlace};
 }
 const body=d.causalNodes.filter(n=>n.kind!=='entity'),adj=new Map(body.map(n=>[n.id,new Set()]));
 for(const e of d.causalEdges)if(adj.has(e.from)&&adj.has(e.to)){adj.get(e.from).add(e.to);adj.get(e.to).add(e.from);}
 const related=new Set(body.filter(n=>n.kind==='event').map(n=>n.id)),pending=[...related];
 for(let i=0;i<pending.length;i++)for(const id of adj.get(pending[i])||[])if(!related.has(id)){related.add(id);pending.push(id);}
 const visited=new Set(),groups=[];
 for(const n of body.filter(n=>n.kind==='event')){if(visited.has(n.id))continue;const ids=new Set([n.id]),queue=[n.id];visited.add(n.id);
  for(let i=0;i<queue.length;i++)for(const id of adj.get(queue[i])||[])if(!visited.has(id)){visited.add(id);ids.add(id);queue.push(id);}
  const events=body.filter(p=>p.kind==='event'&&ids.has(p.id)),tick=n=>n.raw.tick??Number(/^ev_(\d+)_/.exec(n.recordId)?.[1])??0,last=[...events].sort((a,b)=>tick(b)-tick(a))[0];
  groups.push({id:events.map(e=>e.id).sort()[0],label:last.label,eventCount:events.length,lastTick:tick(last),nodeIds:[...ids]});
 }
 groups.sort((a,b)=>(b.lastTick||0)-(a.lastTick||0)||b.eventCount-a.eventCount||a.id.localeCompare(b.id));
 let group=null;if(s.group&&s.group!=='all')group=groups.find(g=>g.id===s.group)||(s.group==='selected'?groups.find(g=>g.nodeIds.includes(s.causalFocusId||s.selected)):null)||groups[0];
 const scope=group?new Set(group.nodeIds):related,nodes=body.filter(n=>scope.has(n.id)&&(!s.kind||s.kind==='all'||n.kind===s.kind)),ids=new Set(nodes.map(n=>n.id)),edges=d.causalEdges.filter(e=>ids.has(e.from)&&ids.has(e.to));
 return {...layoutWorldNetwork(nodes,edges,{causal:true}),edges,groups,groupId:group?.id||'all'};
}
function selectedPlace(d,s){
 if(s.selected?.startsWith('place:'))return s.selected.slice(6);
 const [kind,...parts]=String(s.selected||'').split(':'),id=parts.join(':');
 return d.places.find(p=>rows(p[kind==='entity'?'entities':'events']).some(r=>r.id===id))?.id;
}
function svgWorld(d,s,g){
 const pos=new Map(g.points.map(p=>[p.id,p])),sel=selectedPlace(d,s);let h='';
 for(const l of g.edges){const a=pos.get(l.from),b=pos.get(l.to);if(!a||!b||l.type==='bearing')continue;
  h+='<line class="wb-geoline" x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'"><title>'+esc(l.via||({within:'包含',adjacent:'相邻',passage:'通道'})[l.type])+'</title></line>';
  if(l.type==='passage'&&l.direction==='forward')h+='<path d="M'+a.x+' '+a.y+' L'+b.x+' '+b.y+'" class="wb-geoline" marker-end="url(#wb-arrow)"></path>';
  if(l.via)h+=text((a.x+b.x)/2,(a.y+b.y)/2-8,short(l.via),'wb-line-label');
 }
 const anchors=new Set();
 for(const p of g.points){
  const stacked=p.cohortSize>1,offset=stacked?p.cohortIndex*76:0,key=p.x+','+p.y;
  if(stacked&&!anchors.has(key)){anchors.add(key);const active=g.points.some(q=>q.x===p.x&&q.y===p.y&&sel===q.id);h+='<g class="wb-place '+(active?'selected':'')+'" transform="translate('+p.x+','+p.y+')"><circle class="wb-halo" r="47"></circle><circle class="wb-ring" r="19"></circle><circle class="wb-marker" r="12"></circle>'+text(0,-30,'同层地点，彼此方位未载','wb-dir')+'</g>';}
  h+='<g class="wb-place '+(sel===p.id?'selected':'')+'" data-wb-select="place:'+esc(p.id)+'" tabindex="0" role="button" aria-label="'+esc(p.name+' '+p.directionText)+'" transform="translate('+p.x+','+(p.y+offset)+')">'+(stacked?'': '<circle class="wb-halo" r="47"></circle><circle class="wb-ring" r="19"></circle><circle class="wb-marker" r="12"></circle>')+text(0,35,short(p.name),'wb-name')+text(0,51,short(p.directionText),'wb-dir')+'<title>'+esc(p.name+' · '+p.directionText)+'</title></g>';
  const expanded=s.expanded===p.id;
  h+='<g class="wb-count '+(sel===p.id?'selected':'')+'" data-wb-expand="'+esc(p.id)+'" aria-expanded="'+expanded+'" tabindex="0" role="button" aria-label="'+esc(p.name)+'：'+p.events.length+' 个事件，'+(expanded?'收起':'展开')+'明细" transform="translate('+p.x+','+(p.y+76+offset)+')">'+rect(-77,-16,154,32)+text(0,4,'已记录 '+p.events.length+' 个事件 '+(expanded?'▾':'▸'))+'</g>';
  if(expanded){
   const records=p.events.map(r=>({id:'event:'+r.id,label:r.title}));
   h+='<g class="wb-place-details">'+rect(p.x-115,p.y+99+offset,230,records.length*28+12,'wb-details-bg');
   records.forEach((r,i)=>{h+=node(r.id,r.label,rect(p.x-106,p.y+106+offset+i*28,212,24)+text(p.x,p.y+122+offset+i*28,short(r.label)),'wb-inline');});h+='</g>';
  }
 }
 if(!g.points.length)h+=text(400,210,g.hasHierarchy&&g.placePath.length&&!g.visiblePlaces.length?'暂无下级地点':'尚无明确方位记录','wb-empty-svg')+text(400,240,g.hasHierarchy&&g.placePath.length&&!g.visiblePlaces.length?'可通过上方层级返回':'地点可在列表中查看','wb-dir');
 if(!g.schematic&&g.points.length)h+='<g class="wb-compass" transform="translate('+(g.box.w-65)+',70)"><circle r="32"></circle>'+text(0,-13,'北')+text(0,24,'南')+text(-21,4,'西')+text(21,4,'东')+'</g>';return h;
}
function svgNetwork(d,s,g){
 const pos=new Map(g.points.map(p=>[p.id,p])),groups=new Map();let h='';
 for(const e of g.edges){if(!pos.has(e.from)||!pos.has(e.to))continue;const k=[e.from,e.to].sort().join('|');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
 for(const list of groups.values())list.forEach((e,i)=>{
  const a=pos.get(e.from),b=pos.get(e.to),off=(i-(list.length-1)/2)*48*(e.from<e.to?1:-1),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
  const reach=Math.min(115/Math.max(.001,Math.abs(dx/len)),48/Math.max(.001,Math.abs(dy/len))),sx=a.x+dx/len*reach,sy=a.y+dy/len*reach,ex=b.x-dx/len*reach,ey=b.y-dy/len*reach;
  const mx=(sx+ex)/2-dy/len*off,my=(sy+ey)/2+dx/len*off,id=e.id,selected=s.selectedEdgeId===id,near=s.selected===e.from||s.selected===e.to;
  const side=i%2?-1:1,compact=s.narrow&&(g.focusId||g.layoutFocusId),path=compact?'M'+(a.x+side*115)+' '+a.y+' Q'+(a.x+side*195)+' '+((a.y+b.y)/2)+' '+(b.x+side*115)+' '+b.y:'M'+sx+' '+sy+' Q'+mx+' '+my+' '+ex+' '+ey;
  h+='<path class="wb-edge '+(e.ended?'ended ':'')+(selected||near?'selected ':s.selected?'dim ':'')+'" d="'+path+'" marker-end="url(#wb-arrow)"><title>'+esc(a.label+' → '+e.label+' → '+b.label)+'</title></path><path class="wb-edge-hit" d="'+path+'" data-wb-edge="'+esc(id)+'" tabindex="0" role="button" aria-label="'+esc(a.label+' → '+e.label+' → '+b.label)+'"></path>';
  if(s.edgeLabels||selected||near){const lx=(sx+ex)/2-dy/len*off/2,ly=(sy+ey)/2+dx/len*off/2,w=Math.max(62,[...e.label].length*12+16);
   h+=node(id,e.label,rect(lx-w/2,ly-14,w,28)+text(lx,ly+4,e.label)+(e.ended?text(lx,ly+29,'已结束','wb-ended'):''),'wb-edge-label '+(selected?'selected':'')).replace('data-wb-select=', 'data-wb-edge=');}
 });
 for(const p of g.points){
  const r=p.raw,person=p.kind==='entity'&&r.kind!=='faction',selected=s.selected===p.id,shape=person?'<ellipse cx="'+p.x+'" cy="'+p.y+'" rx="115" ry="48"></ellipse>':rect(p.x-115,p.y-48,230,96),chars=[...String(p.label||'')],lines=chars.length>14?[chars.slice(0,14).join(''),chars.slice(14,27).join('')+(chars.length>27?'…':'')]:[chars.join('')];
  h+=node(p.id,p.label,shape+text(p.x,p.y-30,p.kind==='entity'?(person?'角色':'势力'):names[p.kind],'wb-kind')+lines.map((line,i)=>text(p.x,p.y+(lines.length>1?-7:2)+i*19,line,'wb-name')).join('')+text(p.x,p.y+34,short(r.身份||r.location||r.state||r.id),'wb-dir'),'wb-network-node '+(person?'person ':'')+(selected?'selected':''));
 }return h;
}
const locateButton=(id)=>'<button type="button" class="wb-pick" data-wb-locate="'+esc(id)+'">定位到图中</button>';
function edgeRecord(d,id){return d.causalEdges.find(e=>e.id===id)||d.relations.filter(r=>'relation:'+r.id===id).map(raw=>({id,from:'entity:'+raw.from,to:'entity:'+raw.to,label:raw.type,raw}))[0];}
function inspect(d,s){
 const edge=edgeRecord(d,s.selectedEdgeId);if(edge&&!edge.raw){const records=worldBrowserRecords(d),label=id=>records.find(r=>r.id===id)?.label||id;return '<div class="wb-eyebrow">连线</div><h2>'+esc(edge.label)+'</h2>'+pick(edge.from,label(edge.from))+'<p> → '+esc(edge.label)+' → </p>'+pick(edge.to,label(edge.to))+'<details class="wb-raw"><summary>原始字段</summary><pre>'+esc(JSON.stringify(edge,null,2))+'</pre></details>';}

 const records=worldBrowserRecords(d),rec=records.find(r=>r.id===(edge?.raw?'relation:'+edge.raw.id:s.selected));if(!rec)return '<p class="wb-muted">选择地点、实体或连线查看完整记录。</p>';
 const r=rec.raw;let h='<div class="wb-eyebrow">'+esc(names[rec.kind])+'</div><h2>'+esc(rec.label)+'</h2><p class="wb-muted">'+esc(r.id)+'</p>';
 if(['place','event','agenda','condition'].includes(rec.kind))h+=locateButton(rec.id);
 if(rec.kind==='place'){
  h+='<button type="button" class="wb-pick" data-wb-enter="'+esc(r.id)+'">进入此地</button>';
  const fields=Object.entries(r.sourceFields??{});if(fields.length)h+='<h3>原稿记载</h3>'+fields.map(([key,value])=>'<p class="wb-prose"><strong>'+esc(key)+'</strong>：'+esc(value)+'</p>').join('');
  const bearings=d.links.filter(l=>l.type==='bearing'&&l.from===r.id);
  h+='<p>'+(bearings.map(l=>esc((d.places.find(p=>p.id===l.to)?.name||l.to)+'以'+BEARING_LABELS[l.bearing])).join('、')||'方位未载或本组参照')+'</p>';
  h+='<h3>相关事件（已记录 '+r.events.length+' 个事件）</h3>'+(r.events.map(e=>pick('event:'+e.id,e.title+(e.archived?' · 已归档':''))).join('')||'<p class="wb-muted">事件记录未载</p>');
  h+='<h3>地点记录</h3>'+d.links.filter(l=>l.from===r.id||l.to===r.id).map(l=>{const other=l.from===r.id?l.to:l.from;return '<p>'+esc(l.type==='bearing'?'方位':l.via||({within:'包含',adjacent:'相邻',passage:'通道'})[l.type])+'：'+pick('place:'+other,d.places.find(p=>p.id===other)?.name||other)+(l.type==='passage'?esc(' · '+(l.direction==='both'?'双向':l.direction==='forward'?(d.places.find(p=>p.id===l.from)?.name||l.from)+' → '+(d.places.find(p=>p.id===l.to)?.name||l.to):'方向未载')):'')+(l.condition?esc(' · '+l.condition):'')+'</p>';}).join('');
 }else{



  const prose=rec.kind==='chronicle'?r.text:r.description||r.detail||r.summary||r.goal||r.statement||r.note;if(prose)h+='<h3>记录原文</h3><p class="wb-prose">'+esc(prose)+'</p>';
  if(rec.kind==='agenda'){const owner=d.entities.find(e=>e.id===r.owner);h+='<h3>持有者</h3>'+(owner?pick('entity:'+owner.id,owner.name):'<p>'+esc(r.owner||'未载')+'</p>');}
  if(rec.kind==='event'){if(rows(r.actors).length)h+='<h3>当事人</h3>'+rows(r.actors).map(a=>{const entity=d.entities.find(e=>e.id===a.ref);return entity?pick('entity:'+entity.id,a.name||entity.name):'<p>'+esc(a.name||a.ref||'姓名未载')+(a.ref?' · '+esc(a.ref):'')+'</p>';}).join('');const formal=d.causalEdges.filter(e=>(e.to===rec.id&&e.from.startsWith('entity:'))||(e.from===rec.id&&e.to.startsWith('entity:')));if(formal.length)h+='<h3>明确参与实体</h3>'+formal.map(e=>{const id=e.from===rec.id?e.to:e.from;return pick(id,e.label+' · '+(records.find(r=>r.id===id)?.label||id));}).join('');}
  if(rec.kind==='relation'){const label=id=>d.entities.find(e=>e.id===id)?.name||id;h+='<div class="wb-relation-route"><div><span>起点</span>'+pick('entity:'+r.from,label(r.from))+'</div><span class="wb-relation-arrow" aria-label="指向">→</span><div><span>终点</span>'+pick('entity:'+r.to,label(r.to))+'</div></div><p class="wb-relation-type">关系：'+esc(r.type)+'</p><p>第 '+esc(r.tick)+' 轮'+(r.ended?' · 第 '+esc(r.endedTick)+' 轮结束：'+esc(r.endedWhy||'原因未载'):'')+'</p>';}
  if(rec.kind==='chronicle'){
   if(r.timeMark||r.elapsed)h+='<p>'+esc([r.timeMark,r.elapsed&&'此后又过了：'+r.elapsed].filter(Boolean).join(' · '))+'</p>';
   const ref=r.eventRef||r.chainRef;if(ref){const event=d.events.find(e=>e.id===ref);h+=event?'<h3>关联事件</h3>'+pick('event:'+ref,event.title||event.id):'<p class="wb-muted">关联事件记录未载：'+esc(ref)+'</p>';}
  }
  if(r.archived)h+='<p class="wb-muted">'+(r.legacySummary?'此旧档仅留下标题与引用，事件原文未载。':'已归档 · 完整记录')+'</p>';
  const place=d.places.find(p=>rows(p[rec.kind==='entity'?'entities':'events']).some(e=>e.id===r.id));
  if(place)h+='<h3>所在地点</h3>'+pick('place:'+place.id,place.name);else if(r.location||r.position)h+='<p>位置：'+esc(r.location||r.position)+' · 地点身份尚未确认</p>';
  if(r.chronicle?.length)h+='<h3>完整经过</h3>'+r.chronicle.map(c=>'<article><p class="wb-muted">第 '+esc(c.tick)+' 轮'+(c.timeMark?' · '+esc(c.timeMark):'')+'</p><p class="wb-prose">'+esc(c.text)+'</p></article>').join('');
  const related=d.relations.filter(e=>e.from===r.id||e.to===r.id);if(rec.kind==='entity'&&related.length)h+='<h3>关系</h3>'+related.map(e=>pick('relation:'+e.id,(d.entities.find(n=>n.id===e.from)?.name||e.from)+' → '+e.type+' → '+(d.entities.find(n=>n.id===e.to)?.name||e.to)+(e.ended?' · 已结束':''))).join('');
  const source=r.cause||r.source;if(source?.ref){const type=['agenda','plot','parent'].includes(source.type)?'agenda':'event',id=type+':'+source.ref;h+='<h3>来路</h3>'+pick(id,records.find(n=>n.id===id)?.label||source.ref);}
  const edges=d.causalEdges.filter(e=>e.from===rec.id||e.to===rec.id);if(edges.length)h+='<h3>关联记录</h3>'+edges.map(e=>{const id=e.from===rec.id?e.to:e.from;return pick(id,e.label+' · '+(d.causalNodes.find(n=>n.id===id)?.label||id));}).join('');
 }
 return h+'<details class="wb-raw"><summary>原始字段</summary><pre>'+esc(JSON.stringify(r,null,2))+'</pre></details>';
}
export function renderWorldBrowser(d,s,history={},projection=null){

 const g=d?(projection||worldBrowserGraph(d,s)):null,entityLabels=new Map(d?d.entities.map(n=>['entity:'+n.id,n.name]):[]);
 let options='<label>历史 <select data-wb-version aria-label="选择历史"><option value="current"'+(s.version==='current'?' selected':'')+'>当前世界</option>'+rows(history.list).map(v=>'<option value="'+esc(v.id)+'"'+(s.version===v.id?' selected':'')+'>'+esc(v.label)+'</option>').join('')+(history.service?'<option value="service"'+(s.version!=='current'?' selected':'')+'>指定版本</option>':'')+'</select></label>';
 if(history.service)options+='<input type="number" min="0" max="'+history.maxRevision+'" value="'+(s.version==='current'?history.maxRevision:esc(s.version))+'" data-wb-revision aria-label="历史版本号">'+button('history','查看');
 if(s.view==='relations'&&d){options+='<label><input type="checkbox" data-wb-ended '+(s.showEnded?'checked':'')+'>包含已结束关系</label>';
 if(s.g6&&g.edges.length>1)options+='<label>逐条查看关系<select data-wb-edge-select aria-label="选择关系"><option value="">选择关系</option>'+g.edges.map(e=>'<option value="'+esc(e.id)+'"'+(s.selectedEdgeId===e.id?' selected':'')+'>'+esc((entityLabels.get(e.from)||e.from)+' → '+e.label+' → '+(entityLabels.get(e.to)||e.to))+'</option>').join('')+'</select></label>';}
 if(s.view==='causal'&&d)options+='<label>记录类型<select data-wb-kind aria-label="关联记录类型">'+[['all','全部来路'],['agenda','盘算'],['event','事件'],['condition','持续条件']].map(([v,t])=>'<option value="'+v+'"'+(s.kind===v?' selected':'')+'>'+t+'</option>').join('')+'</select></label>';
 if(d&&s.view!=='world'&&(s.view!=='relations'||s.scene!=='3d'))options+='<label><input type="checkbox" data-wb-labels '+(s.edgeLabels?'checked':'')+'>显示连线说明</label>';
 if(d&&s.view==='relations'&&s.scene==='3d')options+='<label><input type="checkbox" data-wb-three-labels '+(s.threeLabels!==false?'checked':'')+'>显示 3D 名称</label>';
 options+=button('refresh','刷新记录')+(d?button('read','恢复阅读比例'):'')+(s.canExtract&&s.version==='current'?'<button type="button" data-action="extract-map">补抽地图</button>':'');
 let h='<header class="wb-header"><div><h1>世界图谱</h1><p>'+(d?esc(d.worldName)+' · 第 '+d.tick+' 轮':'读取世界记录')+'</p></div><div class="wb-header-actions"><details class="wb-options"><summary aria-label="图谱选项">选项</summary><div class="wb-options-menu">'+options+'</div></details>'+(s.embedded?'':button('close','关闭'))+'</div></header><nav class="wb-tabs" aria-label="图谱视图">';
 h+=[['world','世界地图'],['relations','实体关系'],['causal','事件来路']].map(([v,t])=>'<button type="button" data-wb-view="'+v+'" aria-pressed="'+(s.view===v)+'">'+t+'</button>').join('')+'</nav>';
 if(!d)return h+'<p class="wb-load" role="status">'+esc(s.error||'正在读取完整记录…')+'</p>';
 const q=String(s.query||''),matched=q?worldBrowserRecords(d).filter(r=>r.kind!=='chronicle'&&JSON.stringify(r.raw).toLocaleLowerCase().includes(q.toLocaleLowerCase())):[];
 h+='<div class="wb-toolbar"><div class="wb-search-control"><input type="search" data-wb-search aria-label="搜索地点、人物、势力、事件或关系" placeholder="搜索地点、人物、势力、事件或关系" value="'+esc(q)+'">';
 if(q&&s.searchResultsOpen!==false)h+='<div class="wb-results" aria-live="polite">'+(matched.map(r=>pick(r.id,names[r.kind]+' · '+r.label)).join('')||'<p>没有匹配记录</p>')+'</div>';
 h+='</div>';
 if(s.view==='relations'){

  h+='<select data-wb-focus aria-label="关系中心">'+ '<option value=""'+(s.onlyRelated===false?' selected':'')+'>全局 · '+d.entities.length+' 个实体</option>'+d.entities.map(e=>'<option value="'+esc(e.id)+'"'+(s.onlyRelated!==false&&(g.focusId||g.layoutFocusId)==='entity:'+e.id?' selected':'')+'>'+esc(e.name+' · '+e.id+(e.身份?' · '+e.身份:''))+'</option>').join('')+'</select>';

 }
 if(s.g6&&s.view==='relations')h+='<div class="wb-scene-switch" aria-label="关系图维度"><button type="button" data-wb-scene="2d" aria-pressed="'+(s.scene!=='3d')+'">2D</button><button type="button" data-wb-scene="3d" aria-pressed="'+(s.scene==='3d')+'">3D</button></div>';

 if(s.view==='causal')h+='<select data-wb-group aria-label="事件来路">'+ '<option value="all"'+(g.groupId==='all'?' selected':'')+'>全局 · '+d.events.length+' 个事件</option>'+g.groups.map(group=>'<option value="'+esc(group.id)+'"'+(g.groupId===group.id?' selected':'')+'>'+esc(group.label)+' · '+group.eventCount+' 个事件</option>').join('')+'</select>';
 h+='</div>';
 if(s.view==='world'&&g.hasHierarchy)h+='<nav class="wb-breadcrumbs" aria-label="地点层级"><button type="button" data-wb-level="0">上层地点</button>'+g.placePath.map((id,i)=>'<span> › </span><button type="button" data-wb-level="'+(i+1)+'">'+esc(d.places.find(p=>p.id===id)?.name||id)+'</button>').join('')+(g.placePath.length?'<button type="button" data-wb-level="'+(g.placePath.length-1)+'">返回上层</button>':'')+'</nav>';

 const selectedRecord=worldBrowserRecords(d).find(r=>r.id===s.selected),selectedEdge=edgeRecord(d,s.selectedEdgeId),hasInspector=!!selectedRecord||!!selectedEdge;
 const current=s.view==='world'?'当前位置：'+(g.placePath.length?g.placePath.map(id=>d.places.find(p=>p.id===id)?.name||id).join(' › '):'世界地图 · 上层地点'):s.view==='relations'?s.onlyRelated===false?'实体关系：全局 · '+g.points.length+' 个实体 · '+g.edges.length+' 条关系':'关系中心：'+(d.entities.find(e=>'entity:'+e.id===(g.focusId||g.layoutFocusId))?.name||'暂无实体'):'事件来路：'+(g.groupId==='all'?'全局 · '+d.events.length+' 个事件':g.groups.find(chain=>chain.id===g.groupId)?.label||'暂无事件');
 h+='<div class="wb-selection-status" role="status"><span title="'+esc(current)+'">'+esc(current)+'</span><span title="'+esc(selectedEdge?.label||selectedRecord?.label||'')+'">'+(hasInspector?'已选中：'+esc(selectedEdge?.label||selectedRecord?.label):'点击名称查看详情')+'</span></div>';
 h+='<main class="wb-main '+(hasInspector?'has-inspector':'')+'"><section class="wb-canvas"><div class="wb-caption">'+(s.view==='world'?(g.schematic?'地点示意 · 方位未载':'方位示意 · 不表示距离'):s.view==='causal'?'从左到右看事件来路 · 蓝：事件 · 紫：盘算 · 黄：持续条件':s.scene==='3d'?'拖动旋转查看关系 · 选择关系可逐条阅读':'箭头表示关系方向 · 点击节点看连线说明')+'</div><div class="wb-graph-host" data-status="loading"><div class="wb-g6-layer" tabindex="0" role="group" aria-label="可拖动缩放的世界图谱"></div><p class="wb-graph-error" role="status" hidden></p><svg class="wb-svg" tabindex="0" role="group" aria-label="可拖动缩放的世界图谱" viewBox="'+g.box.x+' '+g.box.y+' '+g.box.w+' '+g.box.h+'"><defs><radialGradient id="wb-glow"><stop offset="0%" stop-color="#8be5c8" stop-opacity=".45"></stop><stop offset="45%" stop-color="#66dbb0" stop-opacity=".2"></stop><stop offset="100%" stop-color="#66dbb0" stop-opacity="0"></stop></radialGradient><marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10z" fill="#8fa9b9"></path></marker></defs>'+(s.g6?'':s.view==='world'?svgWorld(d,s,g):svgNetwork(d,s,g))+'</svg></div>';
  if(g.relationPlace)h+='<details class="wb-place-residents wb-other-places" data-wb-residents'+(s.relationResidentsOpen?' open':'')+'><summary>'+esc(g.relationPlace.name)+' · 此地实体（'+g.residents.length+'）</summary>'+g.residents.map(e=>pick('entity:'+e.id,e.name+' · '+e.id)).join('')+'</details>';
 if(s.view==='causal'&&!g.points.length)h+='<div class="wb-empty-status" role="status"><p>'+(d.events.length?'此筛选下暂无关联记录':'尚无事件记录')+'</p><p>'+(d.events.length?'切换为「全部来路」查看事件':'人物与势力可在「实体关系」查看')+'</p></div>';
 if(s.view==='world'&&g.unassigned?.length)h+='<details class="wb-other-places" data-wb-map-others'+(s.mapOtherOpen?' open':'')+'><summary>其他地点（未归入上层或包含循环 · '+g.unassigned.length+'）</summary>'+g.unassigned.map(p=>pick('place:'+p.id,p.name+' · '+p.id)).join('')+'</details>';
 if(s.view==='world'&&(g.unknown.length||d.unlocated.events.length))h+='<details class="wb-unknown"'+(!g.points.length?' open':'')+'><summary>方位未载（'+g.unknown.length+'）</summary><div>'+g.unknown.map(p=>pick('place:'+p.id,p.name)).join('')+(d.unlocated.events.length?'<h4>事件地点未载或有歧义</h4>'+d.unlocated.events.map(e=>pick('event:'+e.id,e.title)).join(''):'')+'</div></details>';
 if(s.view==='relations'&&g.focusId&&g.totalRelated>g.pageSize)h+='<div class="wb-pages">'+button('relation-prev','‹')+'<span>'+((g.relPage*g.pageSize)+1)+'–'+Math.min((g.relPage+1)*g.pageSize,g.totalRelated)+' / '+g.totalRelated+' 个关联实体</span>'+button('relation-next','›')+'</div>';
 h+='<div class="wb-zoom">'+button('zoom-in','＋')+button('zoom-out','－')+button('fit','重置视野')+'</div>';
 return h+'</section>'+(hasInspector?'<aside class="wb-inspector" aria-label="完整记录">'+button('dismiss','关闭详情')+inspect(d,s)+'</aside>':'')+'</main><footer class="wb-footer">'+(s.scene==='3d'&&s.view==='relations'?'拖动旋转 · 滚轮或双指缩放':'拖动平移 · 滚轮或双指缩放')+' · 点击记录查看详情'+(s.version!=='current'?' · 正在只读查看历史':'')+'</footer>';
}

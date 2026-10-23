// 3d-force-graph html-nodes pattern: local bundle + screen-sized CSS2D labels.
// https://github.com/vasturiano/3d-force-graph/tree/master/example/html-nodes
import {createAtlasGraphProjector} from './world-atlas-g6-data.js';

// Hit the rendered path in screen pixels, independently of the thin tube's mesh.
// The pinned force-graph runtime exposes its actual Bezier curve on each link.
const screenPath=(link,project)=>(link.__curve?.getPoints(40)||[link.source,link.target]).map(project);
export function nearestThreeEdge(links,project,point,radius=10){
 if(!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return null;
 let nearest=null,best=radius*radius;
 for(const link of links){
  const path=screenPath(link,project);
  if(path.length<2||path.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))continue;
  // Keep node targets ahead of nearby relationships.
  if([path[0],path.at(-1)].some(p=>Math.hypot(point.x-p.x,point.y-p.y)<14))continue;
  for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i],dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
   const t=len?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/len)):0;
   const dist=(point.x-a.x-t*dx)**2+(point.y-a.y-t*dy)**2;
   if(dist<best){best=dist;nearest=link;}
  }
 }
 return nearest;
}

const loadDefault=()=>import('../vendor/atlas-g6/three.js');
export function createThreeAtlasRenderer({container,onNode=()=>{},onEdge=()=>{},onClear=()=>{},loadEngine=loadDefault,positionCache=null}){
 let graph=null,model=null,signature=null,disposed=false,revision=0,ready=false,renderCount=0,queue=Promise.resolve(),selected=null,selectedEdgeId=null,error='',settle=null;
 const project=createAtlasGraphProjector(),labelSizes=new Map(),labelVisibility=new Map();let lastLabelKey=null,lastOverlayKey=null,lastStyleKey=null,highlightedLinks=new Set(),selectedLabel=null,relatedLabels=new Set();
 const labels=new Map(),labelObjects=new Map();let hovered=null,showLabels=true,hoverTip=null,pointerInside=true;
 const status=value=>container.parentElement?.setAttribute('data-status',value);
 const size=()=>({width:container.clientWidth||800,height:container.clientHeight||600});
 // One plain-text tooltip per hovered node: names stay readable when the
 // always-on labels are off, and when a label is pushed out of view.
 function ensureHoverTip(){
  if(hoverTip)return hoverTip;
  const el=container.ownerDocument.createElement('div');el.className='wb-three-hover-name';el.setAttribute('role','tooltip');el.setAttribute('aria-hidden','true');
  Object.assign(el.style,{position:'absolute',left:'0',top:'0',display:'none',pointerEvents:'none',zIndex:'6',maxWidth:'180px',padding:'3px 8px',border:'1px solid #607b8e',borderRadius:'6px',background:'#14202be8',color:'#d9e6ee',font:'14px/20px system-ui,sans-serif',whiteSpace:'normal',overflowWrap:'anywhere'});
  container.appendChild?.(el);hoverTip=el;return el;
 }
 function hideHoverTip(){if(hoverTip){hoverTip.style.display='none';hoverTip.setAttribute('aria-hidden','true');}}
 function showHoverTip(n,viewport){
  const el=ensureHoverTip(),p=graph.graph2ScreenCoords(n.x,n.y,n.z),text=String(n.data?.label??n.id??'');
  el.textContent=text;el.setAttribute('aria-hidden','false');el.style.display='block';
  const w=el.offsetWidth||el.getBoundingClientRect?.().width||Math.min(180,Math.max(48,text.length*9+16)),h=el.offsetHeight||el.getBoundingClientRect?.().height||26;
  el.style.left=Math.max(6,Math.min(viewport.width-w-6,p.x-w/2))+'px';
  el.style.top=Math.max(36,Math.min(viewport.height-h-6,p.y-h/2-18))+'px';
 }
 // 3d-force-graph does not always emit onNodeHover(null) when the pointer leaves
 // the canvas, so a native pointerleave hides the tooltip at once and later render
 // frames cannot resurrect it; pointerenter restores the retained hovered node.
 const leaveGraph=()=>{pointerInside=false;hideHoverTip();};
 const enterGraph=()=>{pointerInside=true;arrangeLabels();};
 const bindGraphPointer=()=>{container.addEventListener?.('pointerenter',enterGraph);container.addEventListener?.('pointerleave',leaveGraph);};
 const cameraKey=()=>{const p=graph.cameraPosition(),t=graph.controls().target,v=size();return [p.x,p.y,p.z,t.x,t.y,t.z,v.width,v.height];};
 function arrangeLabels(){
  if(!graph)return;
  const data=graph.graphData(),target=graph.controls().target,camera=graph.cameraPosition(),viewport=size(),placed=[];
  const key=JSON.stringify([...cameraKey(),signature,selected,hovered,showLabels,pointerInside]);if(ready&&key===lastLabelKey)return;lastLabelKey=ready?key:null;
  // Finish all DOM measurements before changing any label visibility.
  const candidates=data.nodes.map(n=>{const el=labels.get(n.id);let metrics=labelSizes.get(n.id);if(el&&!metrics){const width=el.offsetWidth||el.getBoundingClientRect?.().width,height=el.offsetHeight||el.getBoundingClientRect?.().height;metrics={w:width||100,h:height||28};if(width&&height)labelSizes.set(n.id,metrics);}return {n,el,...metrics,distance:Math.hypot(n.x-camera.x,n.y-camera.y,n.z-camera.z)};}).filter(r=>r.el);
  candidates.sort((a,b)=>(b.n.id===selected)-(a.n.id===selected)||(b.n.id===hovered)-(a.n.id===hovered)||(b.n.id===model?.focusIds?.[0])-(a.n.id===model?.focusIds?.[0])||a.distance-b.distance||a.n.id.localeCompare(b.n.id));
  let hoveredLabelVisible=false;
  const changes=[];for(const {n,el,w,h}of candidates){
   const p=graph.graph2ScreenCoords(n.x,n.y,n.z);
   const facing=(n.x-camera.x)*(target.x-camera.x)+(n.y-camera.y)*(target.y-camera.y)+(n.z-camera.z)*(target.z-camera.z);
   const box={left:p.x-w/2-5,right:p.x+w/2+5,top:p.y-h/2-4,bottom:p.y+h/2+4};
   const visible=showLabels&&facing>0&&box.left>=6&&box.right<=viewport.width-6&&box.top>=36&&box.bottom<=viewport.height-58&&!placed.some(b=>box.left<b.right&&b.left<box.right&&box.top<b.bottom&&b.top<box.bottom);
   if(n.id===hovered&&visible)hoveredLabelVisible=true;
   if(labelVisibility.get(n.id)!==visible){changes.push({id:n.id,el,visible});labelVisibility.set(n.id,visible);}if(visible)placed.push(box);
  }
  for(const {el,visible}of changes){el.style.visibility=visible?'visible':'hidden';el.style.pointerEvents=visible?'auto':'none';el.setAttribute('aria-hidden',String(!visible));el.tabIndex=visible?0:-1;}
  const node=pointerInside&&hovered?data.nodes.find(n=>n.id===hovered):null;
  if(node&&!hoveredLabelVisible)showHoverTip(node,viewport);else hideHoverTip();
 }
 function fitGraph(){
  graph.controls().maxDistance=12000;graph.zoomToFit(0,70);
  const viewport=size(),target=graph.controls().target;
  // Fit the projected labels as well as spheres, including depth in a narrow viewport.
  for(let step=0;step<6;step++){
   graph.camera?.().updateMatrixWorld?.();let ratio=1;
   for(const n of graph.graphData().nodes){
    const p=graph.graph2ScreenCoords(n.x,n.y,n.z),el=labels.get(n.id),w=el?.offsetWidth||100,h=el?.offsetHeight||28;
    ratio=Math.max(ratio,Math.abs(p.x-viewport.width/2)/Math.max(20,viewport.width/2-w/2-24),Math.abs(p.y-viewport.height/2)/Math.max(20,viewport.height/2-h/2-72));
   }
   if(ratio<=1)break;
   const p=graph.cameraPosition(),factor=ratio*1.05;
   graph.cameraPosition({x:target.x+(p.x-target.x)*factor,y:target.y+(p.y-target.y)*factor,z:target.z+(p.z-target.z)*factor},{x:target.x,y:target.y,z:target.z},0);
  }
  arrangeLabels();
 }
 // Changing the width accessor clears every mesh in the pinned engine. Color refresh
 // also updates the existing links and arrows, reading the stable width accessor.
 function styles(){
  const key=JSON.stringify([signature,selected,selectedEdgeId]);if(key===lastStyleKey)return;lastStyleKey=key;
  const links=highlightedLinks=new Set((model?.edges||[]).filter(e=>e.id===selectedEdgeId||e.source===selected||e.target===selected).map(e=>e.id)),edge=model?.edges.find(e=>e.id===selectedEdgeId),endpoints=new Set(edge?[edge.source,edge.target]:[]);
  for(const id of new Set([selectedLabel,selected,...relatedLabels,...endpoints])){const el=labels.get(id);if(!el)continue;el.classList.toggle('is-selected',id===selected);el.classList.toggle('is-related',endpoints.has(id));el.setAttribute('aria-pressed',String(id===selected));}selectedLabel=selected;relatedLabels=endpoints;
  graph.nodeColor(n=>n.id===selected||endpoints.has(n.id)?'#bdf4e0':n.data.raw?.kind==='faction'?'#78a2d2':'#72bca7')
   .linkColor(e=>links.has(e.id)?'#a0dccc':'#657f90');
 }
 function edgeAt(event){
  if(!graph||!ready||!Number.isFinite(event?.clientX)||!Number.isFinite(event?.clientY))return null;
  const rect=container.getBoundingClientRect(),point={x:event.clientX-rect.left,y:event.clientY-rect.top};
  const camera=graph.cameraPosition(),target=graph.controls().target;
  const project=p=>{
   const facing=(p.x-camera.x)*(target.x-camera.x)+(p.y-camera.y)*(target.y-camera.y)+(p.z-camera.z)*(target.z-camera.z);
   return facing>0?graph.graph2ScreenCoords(p.x,p.y,p.z):null;
  };
  return nearestThreeEdge(graph.graphData().links,project,point,event.pointerType==='touch'?14:10);
 }
 function cleanup(){container.removeEventListener?.('pointerenter',enterGraph);container.removeEventListener?.('pointerleave',leaveGraph);pointerInside=true;settle?.(false);settle=null;graph?._destructor();graph=null;for(const obj of labelObjects.values())obj.removeFromParent?.();labelObjects.clear();for(const el of labels.values())el.remove?.();labels.clear();hoverTip?.remove?.();hoverTip=null;container.replaceChildren?.();}
 async function update(d,s,g,{reset=false,projection=null}={}){
  const token=++revision,data=projection||project(d,s,g);
  queue=queue.catch(()=>{}).then(async()=>{
   if(disposed||token!==revision)return false;
   try{
    showLabels=s.threeLabels!==false;
    if(!graph){status('loading');bindGraphPointer();const {ForceGraph3D,CSS2DRenderer,CSS2DObject}=await loadEngine();
     if(disposed||token!==revision)return false;
     const overlay=new CSS2DRenderer();if(overlay.render){const render=overlay.render.bind(overlay);overlay.render=(scene,camera)=>{const key=graph&&JSON.stringify(cameraKey());if(ready&&key===lastOverlayKey)return;render(scene,camera);lastOverlayKey=ready?key:null;lastLabelKey=null;arrangeLabels();};}overlay.domElement.style.position='absolute';overlay.domElement.style.inset='0';overlay.domElement.style.pointerEvents='none';
     graph=new ForceGraph3D(container,{controlType:'orbit',extraRenderers:[overlay]});
     graph.width(size().width).height(size().height).backgroundColor('#16232c').showNavInfo(false)
      .enableNodeDrag(false).nodeRelSize(7).nodeVal(1).nodeOpacity(1).nodeResolution(16).nodeLabel(()=>null).linkLabel(()=>null)
      .linkOpacity(.65).linkWidth(e=>highlightedLinks.has(e.id)?2.4:1).linkDirectionalArrowLength(e=>highlightedLinks.has(e.id)?9:6).linkDirectionalArrowRelPos(1).linkCurvature(e=>e.curvature).linkDirectionalArrowColor(e=>highlightedLinks.has(e.id)?'#a0dccc':'#657f90')
      .warmupTicks(150).cooldownTicks(0).nodeThreeObject(n=>{
       const el=container.ownerDocument.createElement('button');el.type='button';el.className='wb-three-label';el.dataset.atlasNode=n.id;el.textContent=n.data.label;el.title=n.data.label;
       el.style.pointerEvents='auto';el.setAttribute('aria-label','查看 '+n.data.label);el.setAttribute('aria-pressed','false');
       // Labels are accessible selection targets. Let drag events reach orbit controls.
       let start=null,moved=false;el.addEventListener('pointerdown',e=>{start=[e.clientX,e.clientY];moved=false;});
       el.addEventListener('pointermove',e=>{if(start&&Math.hypot(e.clientX-start[0],e.clientY-start[1])>5)moved=true;});
       el.addEventListener('click',e=>{e.stopPropagation();if(!disposed&&!moved)onNode(n.id);start=null;});
       const obj=new CSS2DObject(el);labels.set(n.id,el);labelObjects.set(n.id,obj);return obj;
      }).nodeThreeObjectExtend(true)
      .onNodeClick((n,e)=>{if(!disposed&&!e?.target?.closest?.('.wb-three-label'))onNode(n.id);}).onLinkClick((link,e)=>{if(!disposed&&!e?.target?.closest?.('.wb-three-label'))onEdge((edgeAt(e)||link).id);}).onBackgroundClick(e=>{if(!disposed&&!e?.target?.closest?.('.wb-three-label')){const link=edgeAt(e);link?onEdge(link.id):onClear();}});
     graph.onNodeHover?.(n=>{hovered=n?.id||null;arrangeLabels();});
     graph.d3Force('link')?.distance(115);graph.d3Force('charge')?.strength(-170);
     const controls=graph.controls();controls.enableDamping=false;controls.minDistance=80;controls.maxDistance=12000;
    }
    const structural=signature!==data.signature,viewport=size();graph.width(viewport.width).height(viewport.height);
    if(structural){
     for(const obj of labelObjects.values())obj.removeFromParent?.();labelObjects.clear();for(const el of labels.values())el.remove?.();labels.clear();labelSizes.clear();labelVisibility.clear();lastLabelKey=lastOverlayKey=lastStyleKey=null;hovered=null;model=data;ready=false;
     const pairs=new Map();for(const e of data.edges){const key=[e.source,e.target].sort().join('|'),list=pairs.get(key)||[];list.push(e);pairs.set(key,list);}
     const focus=data.focusIds.find(id=>data.nodes.some(n=>n.id===id))||(s.onlyRelated!==false?data.nodes[0]?.id:null),neighbors=data.nodes.filter(n=>n.id!==focus);
     const cached=positionCache?.read(data),reuse=cached?.size===data.nodes.length&&data.nodes.every(n=>['x','y','z'].every(k=>Number.isFinite(cached.get(n.id)?.[k])));
     const nodes=data.nodes.map((n,i)=>{
      if(reuse){const p=cached.get(n.id);return {...n,...p,...(focus?{fx:p.x,fy:p.y,fz:p.z}:{})};}
      if(focus){const index=neighbors.findIndex(p=>p.id===n.id),angle=index*2*Math.PI/Math.max(1,neighbors.length)-Math.PI/2,position=n.id===focus?{x:0,y:0,z:0}:{x:Math.cos(angle)*155,y:Math.sin(angle)*130,z:neighbors.length>2?(index%2?35:-35):0};return {...n,...position,fx:position.x,fy:position.y,fz:position.z};}
      const angle=i*2.399963229728653;return {...n,x:i===0?0:Math.cos(angle)*120,y:i===0?0:Math.sin(angle)*100,z:i===0?0:(i%3-1)*60};
     });
     const links=data.edges.map(e=>{const list=pairs.get([e.source,e.target].sort().join('|')),i=list.indexOf(e);return {...e,curvature:(i-(list.length-1)/2)*.25*(e.source<=e.target?1:-1)};});
     const settled=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{settle=null;reject(new Error('三维布局未完成'));},10000);
      graph.warmupTicks(reuse?0:150);settle=value=>{clearTimeout(timer);resolve(value);};graph.onEngineStop(()=>{if(labels.size!==nodes.length)return;settle?.(true);settle=null;});graph.graphData({nodes,links});
     });
     if(!settled||disposed||token!==revision)return false;
     positionCache?.write(data,graph.graphData().nodes);signature=data.signature;renderCount++;
    }
    model=data;selected=s.selected||null;selectedEdgeId=s.selectedEdgeId||null;styles();
    if(structural||reset)fitGraph();
    lastLabelKey=lastOverlayKey=null;ready=true;arrangeLabels();error='';status('ready');return true;
   }catch(e){if(disposed||token!==revision)return false;ready=false;error=String(e?.message||e);positionCache?.clear?.();cleanup();signature=null;status('error');throw e;}
  });return queue;
 }
 const perform=fn=>{queue=queue.catch(()=>{}).then(()=>!disposed&&graph&&ready?fn(graph):false);return queue;};
 return {update,fit:()=>perform(()=>fitGraph()),
  read:(ids=[])=>perform(g=>{const n=g.graphData().nodes.find(n=>ids.includes(n.id));if(!n)return fitGraph();const p=g.cameraPosition(),v={x:p.x-n.x,y:p.y-n.y,z:p.z-n.z},scale=200/(Math.hypot(v.x,v.y,v.z)||1);g.cameraPosition({x:n.x+v.x*scale,y:n.y+v.y*scale,z:n.z+v.z*scale},n,0);}),
  zoom:factor=>perform(g=>{const target=g.controls().target,p=g.cameraPosition();g.cameraPosition({x:target.x+(p.x-target.x)/factor,y:target.y+(p.y-target.y)/factor,z:target.z+(p.z-target.z)/factor},{x:target.x,y:target.y,z:target.z},0);}),
  resize:()=>perform(g=>{const s=size();g.width(s.width).height(s.height);}),
  destroy(){if(disposed)return;disposed=true;revision++;ready=false;cleanup();status('closed');},
  get isReady(){return ready;},
  get ready(){return queue;},
  get state(){const p=graph?.cameraPosition(),target=graph?.controls()?.target;return {ready,mode:'relations',dimensions:'3d',signature,renderCount,error,zoom:p&&target?1/Math.hypot(p.x-target.x,p.y-target.y,p.z-target.z):null,position:p?[p.x,p.y,p.z,target.x,target.y,target.z]:null,
   nodes:graph?.graphData().nodes.map(n=>{const c=graph.graph2ScreenCoords(n.x,n.y,n.z);return {id:n.id,kind:n.data.kind,label:n.data.label,detail:'',x:n.x,y:n.y,z:n.z,size:14,screen:[c.x,c.y],selected:n.id===selected};})||[],
   edges:graph?.graphData().links.map(e=>{const a=typeof e.source==='object'?e.source:null,b=typeof e.target==='object'?e.target:null,path=a&&b?screenPath(e,p=>graph.graph2ScreenCoords(p.x,p.y,p.z)):[],c=path.length===2?{x:(path[0].x+path[1].x)/2,y:(path[0].y+path[1].y)/2}:path[Math.floor(path.length/2)];return {id:e.id,source:a?.id||e.source,target:b?.id||e.target,label:e.data.label,screen:c?[c.x,c.y]:null,screenPath:path.map(p=>[p.x,p.y])};})||[]};}
 };
}

// G6 lifecycle for read-only atlas views. Selection never reruns layout.
import {createThreeAtlasRenderer} from './world-atlas-three.js';
import {createAtlasGraphProjector} from './world-atlas-g6-data.js';
import {RELATION_CARD,layoutRelationCards} from './world-atlas-layout.js';
import {createRelationLayout} from './world-atlas-elk.js';
import {createThreePositionCache} from './world-atlas-three-perf.js';
const loadCore=()=>import('../vendor/atlas-g6/index.js');
const loadThree=()=>import('../vendor/atlas-g6/three.js');
const colors={place:'#203b48',entity:'#25483f',event:'#273f5a',agenda:'#493857',condition:'#51452b'};
const title=n=>n.data.kind==='entity'?n.data.label:[n.data.label,n.data.detail].filter(Boolean).join('\n');
const nodeSize=model=>model.mode==='world'?[24,24]:model.mode==='relations'?[RELATION_CARD.width,RELATION_CARD.height]:[220,90];
function layoutFor(model){
 // Relations use validated preset rectangles; a force solver cannot guarantee their separation.
 if(model.mode==='relations')return undefined;
 if(model.layout.type==='causal'&&!model.layout.cycleIds?.length)return {type:'dagre',rankdir:'LR',nodesep:45,ranksep:100};
 return undefined;
}
function formatData(model){
 const parallel=new Map();for(const e of model.edges){const key=[e.source,e.target].sort().join('|');const list=parallel.get(key)||[];list.push(e);parallel.set(key,list);}
 return {nodes:model.nodes.map(n=>({...n,type:model.mode==='world'?'circle':'rect',style:{...n.style,size:nodeSize(model),radius:8,fill:n.data.raw?.kind==='faction'?'#30435b':colors[n.data.kind]||colors.entity,stroke:'#739baa',lineWidth:1.4,shadowBlur:0,shadowColor:'transparent',opacity:1,labelText:title(n),labelFill:'#e2edf4',labelFontSize:model.mode==='relations'?16:14,labelFontFamily:'system-ui, sans-serif',labelLineHeight:21,labelWordWrap:true,labelMaxWidth:model.mode==='relations'?RELATION_CARD.width-16:198,labelMaxLines:model.mode==='relations'?2:3,labelPlacement:model.mode==='world'?'bottom':'center',...(model.mode==='world'?{fill:'#1d2d3a',halo:true,haloStroke:'#7cbaa7',haloLineWidth:14,haloStrokeOpacity:.2}: {})}})),
 edges:model.edges.map(e=>{const list=parallel.get([e.source,e.target].sort().join('|')),index=list.indexOf(e),offset=(index-(list.length-1)/2)*38*(e.source<=e.target?1:-1);return {...e,type:model.mode==='causal'?'cubic-horizontal':'quadratic',style:{...e.style,stroke:'#7897a8',lineWidth:1.6,opacity:1,startArrow:model.mode==='world'&&e.data.type==='passage'&&e.data.direction==='both',endArrow:model.mode!=='world'||e.data.type==='passage'&&['forward','both'].includes(e.data.direction),endArrowSize:7,curveOffset:offset,labelText:model.mode==='world'?e.data.label:'',labelFill:'#d3e9e1',labelFontSize:12,labelFontFamily:'system-ui, sans-serif',labelAutoRotate:false,labelBackground:true,labelBackgroundFill:'#142b35',labelBackgroundRadius:5,labelPadding:5,...(e.data.ended?{lineDash:[6,5]}:{})}};}),
 combos:model.combos.map(c=>({...c,type:'rect',style:{padding:25,radius:15,fill:'#294557',fillOpacity:.16,stroke:'#688aa1',lineDash:c.data.kind==='cycle'?[5,5]:undefined,labelText:c.data.label,labelFill:'#c3dbe8',labelFontSize:13,labelPlacement:'top'}}))};
}
export function createAtlasRenderer({container,onNode=()=>{},onEdge=()=>{},onError=()=>{},onClear=()=>{},loadG6=loadCore,load3D=loadThree,relationLayout=createRelationLayout(),threePositionCache=createThreePositionCache()}){
 let threeRenderer=null,graph=null,model=null,signature=null,dimension='2d',disposed=false,revision=0,queue=Promise.resolve(),ready=false,renderCount=0,lastError='',viewport={width:0,height:0},saved2DCamera=null;
 let layoutWorld=null,pendingLayoutSignature=null;
 const project=createAtlasGraphProjector();let selectionKey=null,nodeStyles=new Map(),edgeStyles=new Map(),nodeById=new Map(),incident=new Map();
 const sameStyle=(prior,next)=>prior&&Object.keys(next).every(k=>prior[k]===next[k]);
 const status=value=>{container.parentElement?.setAttribute('data-status',value);};
 const cameraOf=g=>({zoom:g.getZoom(),position:g.getPosition()});
 async function restoreCamera(g,camera){
  await g.zoomTo(camera.zoom,false);
  // getPosition is in canvas units; translateBy takes viewport pixels. Absolute translateTo uses a different origin.
  const current=g.getPosition();await g.translateBy(camera.position.map((value,i)=>(value-current[i])*camera.zoom),false);
 }
 async function styleSelection(s,data,{structural=false,restoreSize=false}={}){
  const key=JSON.stringify([s.selected??null,s.selectedEdgeId??null,!!s.edgeLabels]);if(!structural&&key===selectionKey)return;
  const selectedEdges=new Set();for(const e of incident.get(s.selected)||[])selectedEdges.add(e.id);
  if(s.selectedEdgeId)selectedEdges.add(s.selectedEdgeId);
  if(data.mode==='causal'&&s.selected){
   const seen=new Set([s.selected]),pending=[s.selected];for(const e of data.edges)if(e.id===s.selectedEdgeId)for(const id of [e.source,e.target])if(!seen.has(id)){seen.add(id);pending.push(id);}
   for(let i=0;i<pending.length;i++)for(const e of incident.get(pending[i])||[]){selectedEdges.add(e.id);for(const id of [e.source,e.target])if(!seen.has(id)){seen.add(id);pending.push(id);}}
  }
  const active=!!s.selected||!!s.selectedEdgeId,nodes=[],edges=[];
  // Send complete styles for changed records, so old outlines and glows still clear.
  for(const n of data.nodes){const style={stroke:n.id===s.selected?'#bbffe1':'#739baa',lineWidth:n.id===s.selected?3:1.4,shadowBlur:n.id===s.selected?8:0,shadowColor:n.id===s.selected?'#6fd8b54d':'transparent',opacity:1};if(!sameStyle(nodeStyles.get(n.id),style)){nodes.push({id:n.id,style});nodeStyles.set(n.id,style);}}
  for(const e of data.edges){const near=selectedEdges.has(e.id),style={labelText:e.id===s.selectedEdgeId?[(nodeById.get(e.source)?.data.label||e.source),e.data.label,(nodeById.get(e.target)?.data.label||e.target)].join(' → '):data.mode==='world'||s.edgeLabels||near?e.data.label:'',stroke:near?'#a5efcf':'#7897a8',lineWidth:near?2.7:1.6,opacity:active&&!near?.22:1};if(!sameStyle(edgeStyles.get(e.id),style)){edges.push({id:e.id,style});edgeStyles.set(e.id,style);}}
  if(nodes.length)graph.updateNodeData?.(nodes);if(edges.length)graph.updateEdgeData?.(edges);
  if(restoreSize||nodes.length||edges.length)await graph.draw();selectionKey=key;
 }
 async function update(d,s,g,{reset=false}={}){
  const token=++revision,data=project(d,s,g),nextDimension=s.view==='relations'&&s.scene==='3d'?'3d':'2d',nextSignature=data.signature+'|'+nextDimension;
  if(d!==layoutWorld){threePositionCache.clear();relationLayout.clear?.();layoutWorld=d;}
  if(data.mode!=='relations'||nextDimension==='3d'||g.layoutFocusId||pendingLayoutSignature&&pendingLayoutSignature!==data.signature)relationLayout.cancelPending?.();
  if(nextDimension!=='3d'&&threeRenderer){threeRenderer.destroy();threeRenderer=null;}
  queue=queue.catch(()=>{}).then(async()=>{
   if(disposed||token!==revision)return false;
   try{
    if(nextDimension==='3d'){
     if(dimension!=='3d'){if(graph&&model?.mode==='relations')saved2DCamera={signature,...cameraOf(graph)};graph?.destroy();graph=null;signature=null;dimension='3d';}
     threeRenderer??=createThreeAtlasRenderer({container,onNode,onEdge,onClear,loadEngine:load3D,positionCache:threePositionCache});
     const result=await threeRenderer.update(d,s,g,{reset,projection:data});
     if(result){const note=container.parentElement?.querySelector?.('.wb-graph-error');if(note)note.hidden=true;}
     return result;
    }
    const structural=signature!==nextSignature,hasSavedCamera=dimension==='3d'&&saved2DCamera?.signature===nextSignature;
    if(!graph||dimension!==nextDimension){
     ready=false;status('loading');const core=await loadG6();
     if(disposed||token!==revision)return false;
     graph?.destroy();graph=null;
     graph=new core.Graph({container,width:container.clientWidth||800,height:container.clientHeight||600,animation:false,autoResize:false,padding:45,zoomRange:[.15,3],
      behaviors:['drag-canvas','zoom-canvas',{type:'zoom-canvas',key:'atlas-pinch',trigger:['pinch']}],
      node:{},
      edge:{state:{selected:{opacity:1},dim:{opacity:.22},default:{opacity:1}}}});
     graph.on('canvas:click',()=>{if(!disposed)onClear();});
     graph.on('node:click',e=>{if(!disposed)onNode(e.target.id);});graph.on('edge:click',e=>{if(!disposed)onEdge(e.target.id);});
     dimension=nextDimension;viewport={width:container.clientWidth||800,height:container.clientHeight||600};
    }
    const width=container.clientWidth||800,height=container.clientHeight||600,resized=viewport.width!==width||viewport.height!==height;if(resized){const camera=data.mode==='relations'&&!structural?cameraOf(graph):null;await graph.setSize(width,height);if(camera)await restoreCamera(graph,camera);viewport={width,height};}
    if(structural){selectionKey=null;nodeById=new Map(data.nodes.map(n=>[n.id,n]));incident=new Map(data.nodes.map(n=>[n.id,[]]));for(const e of data.edges){incident.get(e.source)?.push(e);if(e.target!==e.source)incident.get(e.target)?.push(e);}graph.setOptions?.({padding:data.mode==='world'?[120,45,60,45]:45});graph.setLayout?.(layoutFor(data));const formatted=formatData(data);nodeStyles=new Map(formatted.nodes.map(n=>[n.id,n.style]));edgeStyles=new Map(formatted.edges.map(e=>[e.id,e.style]));if(data.mode==='relations'){if(g.layoutFocusId)formatted.nodes=layoutRelationCards(formatted.nodes,formatted.edges,{focus:true,narrow:!!s.narrow});else{pendingLayoutSignature=data.signature;formatted.nodes=await relationLayout.place(formatted.nodes,formatted.edges,{narrow:!!s.narrow,aspectRatio:width/height});pendingLayoutSignature=null;if(disposed||token!==revision)return false;}}graph.setData(formatted);await graph.render();if(data.mode==='causal')graph.updateNodeData?.(data.nodes.map(n=>({id:n.id,style:{size:nodeSize(data)}})));renderCount++;}
    if(disposed||token!==revision)return false;
    model=data;signature=nextSignature;await styleSelection(s,data,{structural,restoreSize:structural&&data.mode==='causal'});
    if(disposed||token!==revision)return false;
    if(structural||reset||resized&&data.mode!=='relations'){if(hasSavedCamera&&graph.translateBy){await restoreCamera(graph,saved2DCamera);}else{await graph.fitView({when:'always',direction:'both'},false);if(data.mode==='causal'&&graph.getZoom()<.85){await graph.zoomTo(.85,false);await graph.fitCenter?.(false);}if(data.mode==='relations'&&graph.getZoom()<.75){await graph.zoomTo(.75,false);await graph.fitCenter?.(false);}if(graph.getZoom()>1)await graph.zoomTo(1,false);}}
    ready=true;lastError='';const note=container.parentElement?.querySelector?.('.wb-graph-error');if(note)note.hidden=true;status('ready');return true;
   }catch(error){if(disposed||token!==revision)return false;ready=false;lastError=String(error?.message||error);graph?.destroy();graph=null;signature=null;status('error');onError(lastError);return false;}
  });return queue;
 }
 const perform=fn=>{queue=queue.catch(()=>{}).then(()=>!disposed&&graph&&ready?fn(graph):false);return queue;};
 return {update,fit:()=>threeRenderer?threeRenderer.fit():perform(g=>g.fitView({when:'always',direction:'both'},false)),
  read:(ids=[])=>threeRenderer?threeRenderer.read(ids):perform(async g=>{const valid=ids.filter(id=>model.nodes.some(n=>n.id===id)||model.edges.some(e=>e.id===id));if(valid.length)await g.focusElement(valid,false);else await g.fitCenter?.(false);if(dimension==='2d')await g.zoomTo(1,false);}),
  zoom:factor=>threeRenderer?threeRenderer.zoom(factor):perform(g=>g.zoomTo(Math.max(.15,Math.min(3,g.getZoom()*factor)),false)),
  resize:()=>threeRenderer?threeRenderer.resize():perform(async g=>{const width=container.clientWidth||800,height=container.clientHeight||600;const camera=model?.mode==='relations'?cameraOf(g):null;await g.setSize(width,height);if(camera)await restoreCamera(g,camera);else await g.fitView({when:'always',direction:'both'},false);viewport={width,height};}),
  destroy(){if(disposed)return;disposed=true;revision++;ready=false;relationLayout.destroy();threePositionCache.clear();layoutWorld=null;pendingLayoutSignature=null;threeRenderer?.destroy();threeRenderer=null;graph?.destroy();graph=null;status('closed');},
  get isReady(){return threeRenderer?threeRenderer.isReady:ready;},
  get ready(){return queue.then(()=>threeRenderer?.ready);},
  get state(){if(threeRenderer)return threeRenderer.state;return {ready,mode:model?.mode,dimensions:dimension,signature,renderCount,error:lastError,zoom:graph?.getZoom?.()??null,position:graph?.getPosition?.()??null,edges:graph?.getEdgeData?.().map(e=>({id:e.id,source:e.source,target:e.target,label:e.data?.label,screen:graph.getViewportByCanvas?.(graph.getElementRenderBounds?.(e.id)?.center||[0,0,0])}))||[],nodes:graph?.getNodeData?.().map(n=>({id:n.id,kind:n.data?.kind,label:n.data?.label,detail:n.data?.detail,x:n.style?.x,y:n.style?.y,z:n.style?.z,combo:n.combo,size:n.style?.size,renderStyle:Object.fromEntries(['stroke','lineWidth','shadowBlur','opacity','labelFontSize','fill'].map(k=>[k,graph.getElementRenderStyle?.(n.id)?.[k]])),screen:Number.isFinite(n.style?.x)?graph.getViewportByCanvas?.([n.style.x,n.style.y,n.style.z||0]):null}))||[]};}};
}

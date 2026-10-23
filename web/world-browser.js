// 图谱弹窗只管理浏览状态；正式世界指针和写入方由原宿主管理。
import {createAtlasRenderer} from './world-atlas-g6.js';
import {createWorldBrowserSession} from './world-browser-data.js';
import {renderWorldBrowser,createWorldBrowserGraphCache,navigateWorldBrowser,validateWorldBrowserState} from './world-browser-render.js';
export function createWorldBrowser({source,doc=null,canExtract=false}){
 const documentOf=()=>doc||globalThis.document;let mask=null,box=null,trigger=null,view=null,moved=false,composing=false;
 const initial=()=>({view:'world',mapCollapsed:true,mapOtherOpen:false,selected:null,selectedEdgeId:null,placePath:[],relationGroupId:null,relationPlaceId:null,relationResidentsOpen:false,scene:'2d',relationFocusId:null,causalFocusId:null,expanded:null,query:'',searchResultsOpen:true,showEnded:false,onlyRelated:false,kind:'all',group:'all',focus:null,relPage:0,edgeLabels:false,threeLabels:true,narrow:(documentOf()?.defaultView?.innerWidth??1280)<620});
 let ui=initial(),embedded=false,lastIdentity=null,wantedVersion='current',readMode=true,canvasSize=null,atlas=null,atlasReset=true;
 const graphOf=createWorldBrowserGraphCache();
 const bindings=[];
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);bindings.push(()=>target.removeEventListener(type,fn,options));};
 const session=createWorldBrowserSession({...source,onChange:()=>{view=null;const d=session.state.data;if(d)ui=validateWorldBrowserState(d,ui);draw();}});
 const graph=()=>box?.querySelector('.wb-svg');
 const apply=()=>{if(view&&graph())graph().setAttribute('viewBox',[view.x,view.y,view.w,view.h].join(' '));};
 function fit(){if(atlas?.isReady){atlas.fit();return;}const d=session.state.data;if(!d)return;readMode=false;view={...graphOf(d,ui).box};apply();}
 function readFit(centerSelected=false){
  if(atlas?.isReady){const g=graphOf(session.state.data,ui);atlas.read(centerSelected?[ui.selected,ui.selectedEdgeId].filter(Boolean):[g.focusId,g.layoutFocusId].filter(Boolean));return;}
  const d=session.state.data,svg=graph();if(!d||!svg)return;readMode=true;const g=graphOf(d,ui),r=svg.getBoundingClientRect();if(!r.width||!r.height)return;
  const scale=Math.min(1.1,Math.max(.9,Math.min(r.width/g.box.w,r.height/g.box.h))),w=r.width/scale,h=r.height/scale;
  const id=centerSelected?ui.selected?.replace(/^place:/,''):(ui.narrow?null:g.focusId),p=g.points.find(p=>p.id===id)||(centerSelected?g.points.find(p=>p.id===g.focusId):null);
  view={x:p?p.x-w/2:g.box.w<=w?(g.box.w-w)/2:0,y:p?p.y-h/2:g.box.h<=h?(g.box.h-h)/2:0,w,h};canvasSize={w:r.width,h:r.height};apply();
 }
 function focusSelection(){readFit(true);}
 function renderContents(html){
  const saved=box.querySelector('.wb-graph-host');if(!saved){box.innerHTML=html;return;}
  const next=documentOf().createElement('div');next.innerHTML=html;const main=box.querySelector('.wb-main'),freshMain=next.querySelector('.wb-main'),canvas=main?.querySelector('.wb-canvas'),freshCanvas=freshMain?.querySelector('.wb-canvas'),fresh=freshCanvas?.querySelector('.wb-graph-host');
  if(!main||!fresh||!canvas){box.innerHTML=html;return;}
  // Keep the live canvas connected while controls and the inspector change.
  saved.querySelector('.wb-svg')?.replaceWith(fresh.querySelector('.wb-svg'));
  for(const child of [...canvas.children])if(child!==saved)child.remove();let after=false;
  for(const child of [...freshCanvas.children]){if(child===fresh){after=true;continue;}after?canvas.appendChild(child):canvas.insertBefore(child,saved);}
  canvas.className=freshCanvas.className;main.className=freshMain.className;
  for(const child of [...main.children])if(child!==canvas)child.remove();for(const child of [...freshMain.children])if(child!==freshCanvas)main.appendChild(child);
  for(const child of [...box.children])if(child!==main)child.remove();after=false;
  for(const child of [...next.children]){if(child===freshMain){after=true;continue;}after?box.appendChild(child):box.insertBefore(child,main);}
 }
 function draw(){
  if(!box)return;const narrow=(documentOf()?.defaultView?.innerWidth??1280)<620;if(ui.narrow!==narrow){ui.narrow=narrow;ui.relPage=0;view=null;readMode=true;}const s=session.state;if(s.data&&ui.view==='relations'&&ui.onlyRelated){const focus=graphOf(s.data,ui).focusId;if(focus)ui.focus=focus.slice(7);}
  const projection=s.data?graphOf(s.data,ui):null;
  renderContents(renderWorldBrowser(s.data,{...ui,g6:true,embedded,canExtract,version:s.version,error:s.error},s.history||{},projection));
  const freshHost=box.querySelector('.wb-graph-host');
  if(s.data&&freshHost){
   const host=freshHost;
   if(!atlas)atlas=createAtlasRenderer({container:host.querySelector('.wb-g6-layer'),onNode:id=>select(id),onClear:()=>navigate({type:'dismiss'},false),onEdge:id=>{if(id.startsWith('place-link:')){try{select('place:'+JSON.parse(decodeURIComponent(id.slice(11)))[0]);}catch{}}else navigate({type:'edge',id},false);},onError:error=>{if(!box||!host.isConnected)return;const current=session.state;if(!current.data)return;const note=host.querySelector('.wb-graph-error');if(note){note.hidden=false;note.textContent='图谱加载失败：'+error+'。请刷新页面后重试，记录仍可从搜索查看。';}const fallback=documentOf().createElement('div');fallback.innerHTML=renderWorldBrowser(current.data,{...ui,g6:false,version:current.version},current.history||{},graphOf(current.data,ui));host.querySelector('.wb-svg')?.replaceWith(fallback.querySelector('.wb-svg'));}});
   atlas.update(s.data,ui,projection,{reset:atlasReset});atlasReset=false;
   const r=host.getBoundingClientRect();canvasSize={w:r.width,h:r.height};
  }else{atlas?.destroy();atlas=null;atlasReset=true;}

  if(s.data&&graph()&&!atlas){const r=graph().getBoundingClientRect();if(!view||canvasSize?.w!==r.width||canvasSize?.h!==r.height){if(readMode)readFit();else fit();}else apply();canvasSize={w:r.width,h:r.height};bindGestures();}
 }
 function close(){
  if(!box)return false;const d=documentOf(),inline=embedded,oldBox=box;
  atlas?.destroy();atlas=null;atlasReset=true;canvasSize=null;graphOf.clear();
  for(const release of bindings.splice(0))release();
  if(inline){oldBox.innerHTML='';oldBox.classList.remove('wb-page');}
  else mask.remove();
  mask=box=null;session.close();embedded=false;
  if(!inline)(trigger?.isConnected?trigger:d.querySelector('[data-action="open-world-browser"]'))?.focus?.();return true;
 }
 function select(id){if(!session.checkScope()){close();return;}ui=navigateWorldBrowser(session.state.data,ui,{type:id.startsWith('relation:')?'edge':'select',id});draw();}
 function navigate(action,reset=true){const id=action.type==='enter'?action.id:action.type==='locate'&&action.id?.startsWith('place:')?action.id.slice(6):null;const d=session.state.data;if(id&&d&&graphOf(d,{...ui,view:'world',placePath:[]}).unassigned?.some(p=>p.id===id))ui.mapOtherOpen=true;if(!session.checkScope()){close();return;}ui=navigateWorldBrowser(session.state.data,ui,action);if(reset){view=null;readMode=true;atlasReset=true;}draw();if(action.type==='locate'||action.type==='focus')focusSelection();}
 function dispatch(target){
  if(target.matches('select,input'))return;
  const data=target.dataset;
  if(data.wbScene){navigate({type:'scene',id:data.wbScene});return;}
  if(data.wbSelect!==undefined){select(data.wbSelect);return;}
  if(data.wbEdge!==undefined){navigate({type:'edge',id:data.wbEdge},false);return;}
  if(data.wbEnter!==undefined){navigate({type:'enter',id:data.wbEnter});return;}
  if(data.wbLevel!==undefined){navigate({type:'level',depth:Number(data.wbLevel)});return;}
  if(data.wbLocate!==undefined){navigate({type:'locate',id:data.wbLocate});return;}
  if(data.wbFocus!==undefined){navigate({type:'focus',id:data.wbFocus});return;}
  if(data.wbExpand!==undefined){ui.expanded=ui.expanded===data.wbExpand?null:data.wbExpand;ui.selected='place:'+data.wbExpand;draw();box.querySelector('[data-wb-expand="'+CSS.escape(data.wbExpand)+'"]')?.focus({preventScroll:true});return;}
  if(data.wbView){navigate({type:'view',id:data.wbView});return;}
  if(data.wbRelationsPlace){navigate({type:'relations-place',id:data.wbRelationsPlace});return;}
  switch(data.wbAction){
   case 'close':close();break;
   case 'refresh':atlasReset=true;ui=initial();wantedVersion='current';view=null;session.open();break;
   case 'fit':fit();break;
   case 'read':readFit();break;
   case 'dismiss':navigate({type:'dismiss'},false);break;
   case 'relation-prev':ui.relPage=Math.max(0,ui.relPage-1);ui.selected=null;ui.selectedEdgeId=null;atlasReset=true;view=null;draw();break;
   case 'relation-next':ui.relPage=Math.min(Math.max(0,Math.ceil(graphOf(session.state.data,ui).totalRelated/graphOf(session.state.data,ui).pageSize)-1),ui.relPage+1);ui.selected=null;ui.selectedEdgeId=null;atlasReset=true;view=null;draw();break;
   case 'zoom-in':zoom(1.25);break;
   case 'zoom-out':zoom(.8);break;
   case 'history':ui.selected=null;ui.selectedEdgeId=null;ui.expanded=null;view=null;session.read(wantedVersion=box.querySelector('[data-wb-revision]').value);break;
  }
 }
 function onKey(e){
  if(!box)return;if(!embedded&&e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return;}
  const target=e.target.closest?.('[data-wb-select],[data-wb-edge],[data-wb-expand],[data-wb-enter],[data-wb-level],[data-wb-locate],[data-wb-focus]');
  if(target&&!target.matches('select,input')&&['Enter',' '].includes(e.key)){e.preventDefault();dispatch(target);return;}
  if(!embedded&&e.key==='Tab'){
   const items=[...box.querySelectorAll('button,input,select,summary,[tabindex="0"]')].filter(n=>n.getClientRects().length),first=items[0],last=items.at(-1),active=documentOf().activeElement;
   if(e.shiftKey&&(active===first||active===box)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&active===last){e.preventDefault();first?.focus();}return;
  }
  if(e.target.closest?.('.wb-g6-layer')&&atlas?.isReady){if(e.key==='Home')fit();else if(e.key==='+'||e.key==='=')zoom(1.25);else if(e.key==='-')zoom(.8);else return;e.preventDefault();return;}
  if(!e.target.closest?.('.wb-svg')||!view)return;
  if(e.key==='Home')fit();else if(e.key==='+'||e.key==='=')zoom(1.25);else if(e.key==='-')zoom(.8);
  else if(e.key==='ArrowLeft')view.x-=view.w*.08;else if(e.key==='ArrowRight')view.x+=view.w*.08;else if(e.key==='ArrowUp')view.y-=view.h*.08;else if(e.key==='ArrowDown')view.y+=view.h*.08;else return;
  e.preventDefault();apply();
 }
 function zoom(factor,point=null){
  if(atlas?.isReady){atlas.zoom(factor);return;}
  if(!view)return;readMode=false;const old={...view},base=graphOf(session.state.data,ui).box;
  const w=Math.max(160,Math.min(base.w*5,old.w/factor)),ratio=w/old.w,c=point||{x:old.x+old.w/2,y:old.y+old.h/2};
  view={x:c.x-(c.x-old.x)*ratio,y:c.y-(c.y-old.y)*ratio,w,h:old.h*ratio};apply();
 }
 function bindGestures(){
  const svg=graph(),pointers=new Map();let pan=null,pinch=null;
  const toWorld=(x,y,matrix=svg.getScreenCTM().inverse())=>{const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(matrix);};
  const start=p=>{const matrix=svg.getScreenCTM().inverse();pan={matrix,screen:p,point:toWorld(p.x,p.y,matrix),view:{...view}};};
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.001),toWorld(e.clientX,e.clientY));},{passive:false});
  svg.addEventListener('pointerdown',e=>{
   if(!pointers.size)moved=false;const p={x:e.clientX,y:e.clientY};pointers.set(e.pointerId,p);start(p);
   if(!e.target.closest('[data-wb-select],[data-wb-edge],[data-wb-expand],[data-wb-enter],[data-wb-level],[data-wb-locate],[data-wb-focus]'))svg.setPointerCapture(e.pointerId);
   if(pointers.size===2){const[a,b]=[...pointers.values()],matrix=svg.getScreenCTM().inverse();pinch={view:{...view},matrix,distance:Math.hypot(a.x-b.x,a.y-b.y),center:toWorld((a.x+b.x)/2,(a.y+b.y)/2,matrix)};}
  });
  svg.addEventListener('pointermove',e=>{
   if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pointers.size===2&&pinch){const[a,b]=[...pointers.values()];view={...pinch.view};zoom(Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),pinch.center);const ratio=view.w/pinch.view.w,c=toWorld((a.x+b.x)/2,(a.y+b.y)/2,pinch.matrix);view.x-=(c.x-pinch.center.x)*ratio;view.y-=(c.y-pinch.center.y)*ratio;apply();moved=true;return;}
   if(pan){const p=toWorld(e.clientX,e.clientY,pan.matrix),dx=p.x-pan.point.x,dy=p.y-pan.point.y;if(!moved&&Math.hypot(e.clientX-pan.screen.x,e.clientY-pan.screen.y)<=4)return;moved=true;view.x=pan.view.x-dx;view.y=pan.view.y-dy;apply();}
  });
  const release=e=>{pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;if(pointers.size===1)start([...pointers.values()][0]);else pan=null;};
  svg.addEventListener('pointerup',release);svg.addEventListener('pointercancel',release);
 }
 function ensureStyle(){
  const d=documentOf();let link=d.getElementById('sw2-world-browser-css');if(link?.sheet)return Promise.resolve();
  const existing=!!link;if(!link){link=d.createElement('link');link.id='sw2-world-browser-css';link.rel='stylesheet';link.href=new URL('./world-browser.css?build=leg222-world-atlas-balance',import.meta.url).href;}
  const ready=new Promise(resolve=>{link.addEventListener('load',resolve,{once:true});link.addEventListener('error',resolve,{once:true});});
  if(!existing)d.head.appendChild(link);return ready;
 }
 function bindControls(){
  const container=mask||box;
  listen(container,'click',e=>{if(mask&&e.target===mask){close();return;}const t=e.target.closest('[data-wb-action],[data-wb-scene],[data-wb-view],[data-wb-select],[data-wb-edge],[data-wb-expand],[data-wb-enter],[data-wb-level],[data-wb-locate],[data-wb-focus],[data-wb-relations-place]');if(!t){if(!moved&&e.target.closest('.wb-svg'))navigate({type:'dismiss'},false);moved=false;return;}if(moved&&t.closest('.wb-svg')){moved=false;return;}moved=false;dispatch(t);});
  const search=e=>{if(!e.target.matches('[data-wb-search]'))return;ui.query=e.target.value;ui.searchResultsOpen=true;const pos=e.target.selectionStart;draw();const input=box.querySelector('[data-wb-search]');input.focus();input.setSelectionRange(pos,pos);};
  listen(container,'toggle',e=>{if(box?.contains(e.target)&&e.target.matches('[data-wb-map-others]')&&ui.mapOtherOpen!==e.target.open){ui.mapOtherOpen=e.target.open;view=null;atlasReset=true;draw();return;}if(box?.contains(e.target)&&e.target.matches('[data-wb-residents]'))ui.relationResidentsOpen=e.target.open;},true);
  listen(container,'compositionstart',e=>{if(e.target.matches('[data-wb-search]'))composing=true;});
  listen(container,'compositionend',e=>{composing=false;search(e);});
  listen(container,'input',e=>{if(!composing&&!e.isComposing)search(e);});
  listen(container,'change',e=>{
   if(e.target.matches('[data-wb-edge-select]')){navigate(e.target.value?{type:'edge',id:e.target.value}:{type:'dismiss'},false);return;}
   if(e.target.matches('[data-wb-version]')){if(e.target.value==='service')return;ui.selected=null;ui.selectedEdgeId=null;ui.expanded=null;view=null;session.read(wantedVersion=e.target.value);}
   if(e.target.matches('[data-wb-ended]')){ui.showEnded=e.target.checked;ui.relPage=0;view=null;draw();}
   if(e.target.matches('[data-wb-focus]')){navigate(e.target.value?{type:'focus',id:e.target.value}:{type:'relations-all'});}
   if(e.target.matches('[data-wb-group]')){ui.group=e.target.value;ui.causalFocusId=null;ui.selected=null;ui.selectedEdgeId=null;ui.kind='all';view=null;readMode=true;draw();}
   if(e.target.matches('[data-wb-labels]')){ui.edgeLabels=e.target.checked;draw();}
   if(e.target.matches('[data-wb-three-labels]')){ui.threeLabels=e.target.checked;draw();}
   if(e.target.matches('[data-wb-kind]')){ui.kind=e.target.value;view=null;draw();}
  });
  listen(embedded?box:documentOf(),'keydown',onKey,!embedded);
  if(documentOf().defaultView)listen(documentOf().defaultView,'resize',()=>{if(box)draw();});
 }
 function syncIdentity(){
  const identity=source.getIdentity?.()??source.getScope();
  if(identity!==lastIdentity){ui=initial();wantedVersion='current';view=null;lastIdentity=identity;}
 }
 async function mount(host,{refresh=false}={}){
  if(!host)return null;const same=box===host&&embedded;
  if(same&&!refresh&&session.checkScope())return host;
  if(!same){close();await ensureStyle();box=host;embedded=true;composing=false;box.classList.add('wb-page');box.tabIndex=-1;box.setAttribute('role','region');box.setAttribute('aria-label','世界图谱');bindControls();}
  syncIdentity();await session.open(wantedVersion);return host;
 }
 async function open(){
  const d=documentOf();if(!d?.body)return null;if(mask){box.focus();return mask;}
  close();await ensureStyle();trigger=d.activeElement;ui=initial();wantedVersion='current';view=null;embedded=false;composing=false;
  mask=d.createElement('div');mask.id='sw2_world_browser_mask';box=d.createElement('div');box.className='wb-box';box.tabIndex=-1;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','世界图谱');mask.appendChild(box);d.body.appendChild(mask);bindControls();
  await session.open();box?.focus();return mask;
 }
 return {open,mount,unmount:close,close,refresh:()=>{if(box){syncIdentity();view=null;return session.open(wantedVersion);}},
  invalidate:close,checkScope:()=>{if(box&&!session.checkScope())close();},
  get state(){return {...session.state,...ui,atlas:atlas?.state};},get ready(){return atlas?.ready||Promise.resolve();}};
}

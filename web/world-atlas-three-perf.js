
// Reuse static GPU output without stopping the native input/hover loop.
export function filterStaticThreeFrames(renderer,readState){
 if(typeof renderer?.render!=='function')return ()=>{};
 const native=renderer.render,canvas=renderer.domElement;let previous=null,active=true,updates=null,prior=null,finished=null;
 const invalidate=()=>{previous=null;};
 function render(scene,camera,...rest){
  if(!active)return native.call(this,scene,camera,...rest);
  // The native Group joins the scene asynchronously. Until its completion
  // callback is available, keep rendering rather than cache an uncertain frame.
  if(!updates){
   const group=scene?.children?.find(child=>typeof child.onFinishUpdate==='function'&&typeof child.graphData==='function');
   if(!group)return native.call(this,scene,camera,...rest);
   updates=group;prior=group.onFinishUpdate();
   finished=function(...args){try{return prior?.apply(this,args);}finally{if(active)invalidate();}};
   group.onFinishUpdate(finished);
  }
  const state=readState(),p=camera.position,q=camera.quaternion;
  const frame=[scene,p.x,p.y,p.z,q.x,q.y,q.z,q.w,canvas?.width,canvas?.height,...camera.projectionMatrix.elements,state.ready,state.signature,state.styleKey];
  if(state.ready&&previous&&frame.every((value,i)=>value===previous[i]))return;
  const result=native.call(this,scene,camera,...rest);previous=frame;return result;
 }
 renderer.render=render;
 canvas?.addEventListener?.('webglcontextlost',invalidate);
 canvas?.addEventListener?.('webglcontextrestored',invalidate);
 return ()=>{
  if(!active)return;active=false;previous=null;readState=null;
  if(updates?.onFinishUpdate()===finished)updates.onFinishUpdate(prior);
  updates=null;
  canvas?.removeEventListener?.('webglcontextlost',invalidate);
  canvas?.removeEventListener?.('webglcontextrestored',invalidate);
  if(renderer.render===render)renderer.render=native;
 };
}

// One coordinate set per atlas session; weak keys retain no graph or formal text.
export function createThreePositionCache(){
 let keys=new WeakMap(),serial=0,cached=null;
 const clear=()=>{keys=new WeakMap();serial=0;cached=null;};
 return {
  read(model){return cached&&cached.key===keys.get(model)?cached.positions:null;},
  write(model,nodes){
   const positions=new Map();
   for(const n of nodes){
    if(typeof n.id!=='string'||positions.has(n.id)||!['x','y','z'].every(k=>Number.isFinite(n[k]))){clear();return false;}
    positions.set(n.id,{x:n.x,y:n.y,z:n.z});
   }
   if(!keys.has(model))keys.set(model,++serial);
   cached={key:keys.get(model),positions};return true;
  },
  clear,
 };
}

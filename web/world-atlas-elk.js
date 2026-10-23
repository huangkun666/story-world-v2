// ELK owns global relation placement. Only topology and fixed card dimensions enter the local worker.
import {RELATION_CARD} from './world-atlas-layout.js';
const loadCore=()=>import('../vendor/atlas-elk/index.js');
const workerURL=new URL('../vendor/atlas-elk/elk-worker.min.js',import.meta.url);
const compare=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
const abort=()=>Object.assign(new Error('布局计算已取消'),{name:'AbortError'});
export function createRelationLayout({loadELK=loadCore,createWorker=()=>new Worker(workerURL)}={}){
 let closed=false,active=null,cache=null;
 const cancelPending=()=>{if(active){const job=active;active=null;job.reject(abort());job.stop();}};
 function clear(){cancelPending();cache=null;}
 async function place(nodes,edges,{narrow=false,aspectRatio=1}={}){
  if(closed)throw abort();
  const children=nodes.map(n=>({id:n.id,width:RELATION_CARD.width,height:RELATION_CARD.height})).sort(compare);
  const links=edges.map(e=>({id:e.id,sources:[e.source],targets:[e.target]})).sort(compare);
  const key=JSON.stringify([narrow,children.map(n=>n.id),links]);
  const apply=positions=>nodes.map(n=>({...n,style:{...n.style,...positions.get(n.id)}}));
  if(cache?.key===key)return apply(cache.positions);
  if(active?.key===key)return apply(await active.promise);
  cancelPending();
  let worker=null,stopped=false,reject;
  const failure=new Promise((_,r)=>reject=r);
  const job={key,reject,stop(){if(!stopped){stopped=true;worker?.terminate();}},promise:null};
  active=job;
  const work=(async()=>{
   const {default:ELK}=await loadELK();
   if(closed||active!==job)throw abort();
   worker=createWorker();
   worker.addEventListener?.('error',e=>reject(new Error(e.message||'本地布局 Worker 运行失败')));
   worker.addEventListener?.('messageerror',()=>reject(new Error('本地布局 Worker 返回了无法读取的结果')));
   const engine=new ELK({workerFactory:()=>worker,algorithms:['layered']});
   const placed=await engine.layout({id:'root',layoutOptions:{
    'elk.algorithm':'layered','elk.direction':'RIGHT','elk.spacing.nodeNode':String(RELATION_CARD.padding*2),
    'elk.layered.spacing.nodeNodeBetweenLayers':'48','elk.spacing.componentComponent':'40',
    'elk.separateConnectedComponents':'true','elk.aspectRatio':String(Number.isFinite(aspectRatio)&&aspectRatio>0?aspectRatio:1)
   },children,edges:links});
   if(closed||active!==job)throw abort();
   const positions=new Map();
   for(const n of placed.children||[]){
    if(positions.has(n.id)||!Number.isFinite(n.x)||!Number.isFinite(n.y))throw new Error('布局返回了无效坐标或重复身份');
    positions.set(n.id,{x:Math.round(n.x+RELATION_CARD.width/2),y:Math.round(n.y+RELATION_CARD.height/2)});
   }
   if(positions.size!==nodes.length||nodes.some(n=>!positions.has(n.id)))throw new Error('布局结果与完整实体身份不一致');
   cache={key,positions};return positions;
  })();
  job.promise=Promise.race([work,failure]).finally(()=>{job.stop();if(active===job)active=null;});
  return apply(await job.promise);
 }
 return {place,cancelPending,clear,destroy(){closed=true;clear();}};
}

function extractionProgressText(events,elapsedMs){
 const fin=(events||[]).filter(e=>e?.phase==='finish'),done=fin.filter(e=>e.ok).length;
 const spent=Number.isFinite(elapsedMs)?elapsedMs:fin.reduce((n,e)=>n+(Number(e.ms)||0),0);
 const mins=Math.floor(spent/60000),secs=Math.floor((spent%60000)/1000),cost=mins?mins+' 分 '+String(secs).padStart(2,'0')+' 秒':secs+' 秒';
 const cur=(events||[]).filter(e=>e?.phase==='start').at(-1);
 if(cur&&(cur.step==='chunk'||cur.step==='attrs'))return '⏳ 抽取中 · '+(cur.step==='chunk'?'名册':'属性')+'第 '+cur.index+'/'+cur.count+' 块（'+cur.chars+' 字符）· 已 '+done+' 段 · 已花 '+cost;
 return '⏳ 抽取中 · 设定（'+(cur?cur.chars:'—')+' 字符）· 已花 '+cost;
}
/** Legacy clock is UI-only: no periodic diagnostics or console heartbeat. */
export function extractionProgressHandler(events,{setText=()=>{},intervalMs=1000,now=()=>Date.now(),setTimer=setInterval,clearTimer=clearInterval}={}){
 let timer=null,startedAt=null,lastText=null;
 const render=()=>{lastText=extractionProgressText(events,startedAt===null?null:now()-startedAt);try{setText(lastText,{diagnostic:false});}catch{};return lastText;};
 const stop=()=>{if(timer!==null){try{clearTimer(timer);}catch{}timer=null;}};
 return {onEvent:ev=>{try{if(ev.phase==='start'&&startedAt===null){startedAt=now();timer=setTimer(render,intervalMs);timer?.unref?.();}render();}catch{}},stop,_state:()=>({running:timer!==null,lastText})};
}

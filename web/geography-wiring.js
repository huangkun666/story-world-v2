// 用户触发的地图补抽：仍是同一份世界、来源和进度才写回。
import {extractGeography} from '../src/geography-extract.js';

export function retainGeography(previous, next) {
    if(previous?.frozen?.fingerprint === next?.frozen?.fingerprint
        && previous?.frozen?.canon?.geography && next?.frozen?.canon
        && !next.frozen.canon.geography) next.frozen.canon.geography=structuredClone(previous.frozen.canon.geography);
    return next;
}

export function createGeographyHub({getWorld,getIdentity,getSource,extract,persist,setStatus=()=>{},extractMap=extractGeography}) {
    let running=false;
    const sourceStamp=src=>JSON.stringify([src?.text,src?.allowedBlocks||[]]);
    async function backfill() {
        if(running)return {ok:false,reason:'地图补抽正在进行'};
        const world=getWorld();
        if(!world?.context?.setting?.frozen?.canon){setStatus('当前世界还没有抽取的设定源');return {ok:false,reason:'没有世界设定'};}
        const identity=getIdentity(), stamp=JSON.stringify(world);
        running=true;
        try {
            setStatus('正在读取地图来源…');
            const src=await getSource();
            if(!src?.ok)throw new Error(src?.reason||'地图来源不可用');
            const unchanged=()=>getIdentity()===identity&&JSON.stringify(getWorld())===stamp;
            if(!unchanged())return {ok:false,reason:'世界已变化，地图未写回'};
            setStatus('正在补抽地图…');
            const result=await extractMap({sourceText:src.text,allowedSources:src.allowedBlocks,extract,
                previous:world.context.setting.frozen.canon.geography});
            if(!result.ok)throw new Error((result.errors||[]).join('；')||'地图抽取失败');
            const freshSource=await getSource();
            if(!freshSource?.ok||sourceStamp(freshSource)!==sourceStamp(src)||!unchanged()){
                setStatus('聊天、来源或世界进度已变化，地图未写回');
                return {ok:false,reason:'地图结果已过期'};
            }
            const next=structuredClone(world);
            next.context.setting.frozen.canon.geography=result.geography;
            next.context.positions=[...new Set([...(next.context.positions||[]),...(result.geography.places||[]).map(p=>p.name)])];
            const flushed=await persist(next);
            if(flushed?.ok===false){setStatus('地图已更新，但保存未完成');return {ok:false,reason:flushed.reason||'保存失败',updated:true};}
            setStatus(`地图已更新：${result.geography.places.length} 个地点 · ${result.geography.links.length} 条关系`
                + (result.errors?.length ? ` · 警告 ${result.errors.length} 项` : ''));
            return {ok:true,geography:result.geography,calls:result.calls};
        } catch(err) {
            setStatus(`地图补抽失败：${err?.message||err}`);
            return {ok:false,reason:String(err?.message||err)};
        } finally {running=false;}
    }
    return {backfill};
}

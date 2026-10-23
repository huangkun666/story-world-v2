import {createChatContextCursor} from './chat-context-cursor.js';
import { createServiceObservation } from './service-observation.js';

// 服务模式的动态正文只取固定版本观察；模板独立于全局名册和世界账。
export function createServiceInjector({ getCtx, isActive, getState, getQuery, getRelevanceText = getQuery, getMaxChars, getStateMaxChars = () => 0, getSearchOptions = () => null, isOn, getTags, setStatus }) {
    let runs=0,last=null;
    // ★★★本次（**注入内容预览**）：**上一次真写出去的三段正文**（参数页"看看会注进去什么"读它）。
    //   ★记的必须是**真的递进 `output.write` 的那几个字符串**（见下面 `apply()` 与 `clear()`）；
    //     另拼一份 = 第二份真相（预览说 A、真注进去是 B）——本仓最忌的形状。
    //   ★`at` = 那一次写出去的时刻（撤空那一次也记 ⇒ 面板据"三段都空"显示"未注入"）。
    let lastTexts=null;
    const textStamp=()=>{try{return new Date().toISOString()}catch(_){return null}};
    const recordTexts=(tags,scene,ledger)=>{lastTexts={tags:String(tags??''),scene:String(scene??''),ledger:String(ledger??''),at:textStamp(),path:'service'}};
    let afterRevision=null;
    const cursor=createChatContextCursor({getCtx,getState,onStatus:setStatus});
    const observation=createServiceObservation({getState,getQuery,getMaxChars,getSearchOptions,
        getContextOptions:()=>({include_current_state:!!isOn('injectSceneState'),relevance_text:getRelevanceText(),movement_after_revision:afterRevision}),
        getStateMaxChars:()=>isOn('injectSceneState')?getStateMaxChars():0,
        onReady:()=>apply(),onStatus:r=>setStatus?.(r.error)});
    function api(){
        const ctx=getCtx(),fn=ctx?.setExtensionPrompt;
        const types=ctx?.extension_prompt_types??ctx?.extensionPromptTypes;
        return typeof fn==='function'?{write:fn.bind(ctx),position:types?.IN_PROMPT??0}:null;
    }
    function apply(){
        const output=api();if(!output)return {ok:false};
        const tags=isOn('injectTagSpec')?getTags():'';
        const receipt=observation.read();
        const full=getState()?.client?.supportsFullCurrentState===true;
        const text=isOn('injectLedgerRecall')?(receipt?.text??''):'';
        const local=getState()?.client?.supportsSceneState===true;
        const sceneOn=local&&isOn('injectSceneState');
        const stateText=sceneOn?(receipt?.state_text??''):'';
        const movementText=sceneOn&&full?(receipt?.movement_text??''):'';
        const movementNotice=sceneOn&&full?(receipt?.movement_notice??''):'';
        // 属性差异与本批动向分别成立；没有属性变化不等于没有动向。
        const scene=[stateText,movementText,movementNotice].filter(Boolean).join('\n\n');
        output.write('sw2_tags',tags,output.position,0,false,0);
        output.write('sw2_world',scene,output.position,0,false,0);
        output.write('sw2_ledger',text,output.position,0,false,0);
        // ★★★本次：把**刚刚真写出去的那三段**记下来（与上面三行同一个来源 ⇒ 预览不会另说一套）。
        recordTexts(tags,scene,text);
        if(full&&receipt)Object.assign(lastTexts,{world_id:receipt.world_id,branch_id:receipt.branch_id,revision:receipt.revision,
            movement_range:receipt.movement_range??null,movement_omitted:sceneOn?structuredClone(receipt.movement_omitted??[]):[],history_omitted:structuredClone(receipt.omitted??[])});
        runs++;last={count:runs,status:tags.length+text.length+scene.length?'ok':'empty',tagsBytes:tags.length,rosterBytes:0,roster:false,
            tideBytes:0,ledgerOn:!!isOn('injectLedgerRecall'),divergenceBytes:0,recalledBytes:text.length,
            ...(local?{sceneOn,stateBytes:stateText.length,
                ...(full?{movementBytes:movementText.length,movementOmitted:sceneOn?(receipt?.movement_omitted??[]).length:0,movementLimited:sceneOn&&!!receipt?.movement_limited}:{}),stateLimited:!!receipt?.state_limited,stateReason:receipt?.state_reason??null,stateOmitted:(receipt?.state_omitted??[]).length}:{}),
            recall:receipt?{source:local?'local':'service',bytes:text.length,mode:receipt.memory?.mode??null,reason:receipt.memory?.reason??null,limited:!!receipt.limited,revision:receipt.revision,omitted:(receipt.omitted??[]).length}:null,totalBytes:tags.length+text.length+scene.length};
        return {ok:true,tagsChars:tags.length,worldChars:scene.length,ledgerChars:text.length,facts:last};
    }
    async function prepare({forGeneration=false}={}){
        if(forGeneration)cursor.invalidate();
        apply();
        if(!isOn('injectLedgerRecall')&&!(getState()?.client?.supportsSceneState&&isOn('injectSceneState'))){observation.invalidate();return apply()}
        const initial=getState(), pinned=initial?{scope:initial.scope,client:initial.client,...initial.pointer}:null;
        const full=initial?.client?.supportsFullCurrentState===true;
        if(full){
            afterRevision=await cursor.readAfterRevision();
            const now=getState();
            if(!pinned||now?.scope!==pinned.scope||now?.client!==pinned.client||now?.pointer?.world_id!==pinned.world_id
                ||now?.pointer?.branch_id!==pinned.branch_id||now?.pointer?.revision!==pinned.revision){
                apply();if(forGeneration)throw Error('当前世界版本已改变，请重试聊天生成');return {ok:false};
            }
        }
        let receipt=await observation.prefetch();
        const latest=getState();
        if(!full&&!receipt&&isActive()&&pinned&&latest?.scope===pinned.scope&&latest.client===pinned.client
            &&latest.pointer?.world_id===pinned.world_id&&latest.pointer?.branch_id===pinned.branch_id
            &&latest.pointer?.revision!==pinned.revision)receipt=await observation.prefetch();
        if(receipt?.state_limited)setStatus?.(receipt.state_reason==='state-evidence-unavailable'?'部分当前状态的观察依据读取失败':`当前状态字数不足：${(receipt.state_omitted??[]).length} 条未装入，请增加状态字数`);
        if(full&&receipt?.movement_notice)setStatus?.(receipt.movement_notice);
        if(full&&receipt?.history_notice)setStatus?.(receipt.history_notice);
        const result=isActive()?apply():{ok:false};
        if(full&&forGeneration){
            const written=observation.read();
            if(!written&&(isOn('injectSceneState')||(isOn('injectLedgerRecall')&&getQuery().trim())))throw Error('当前世界状态未完整读到，请重试聊天生成');
            if(written&&result.ok&&isOn('injectSceneState')&&written.movement_range)cursor.notePrepared(written);
        }
        return result;
    }
    function clear(){
        observation.invalidate();cursor.invalidate();last=null;
        const output=api();if(output){for(const key of ['sw2_tags','sw2_world','sw2_ledger'])output.write(key,'',output.position,0,false,0);recordTexts('','','')}
    }
    const ctx=getCtx(),events=ctx?.eventTypes??ctx?.event_types;
    const before=events?.GENERATION_AFTER_COMMANDS;
    if(ctx?.eventSource?.on && before)ctx.eventSource.on(before,()=>isActive()?prepare({forGeneration:true}):undefined);
    return {apply,prepare,prefetchVectors:prepare,clear,clearVectors:clear,
        _facts:()=>last,_last:()=>last?'聊天观察已核对':'',
        // ★★★本次：**上一次真写出去的三段正文**（纯读；旧路 `web/inject.js` 的 `_texts()` 会取更晚的那一份）。
        //   ★没写过 ⇒ 与旧路**同一个形状**（三段空串 + `at`/`path` 为 null）：调用方不必分两种形状判。
        _texts:()=>lastTexts||{tags:'',scene:'',ledger:'',at:null,path:null}};
}

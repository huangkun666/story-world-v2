import { WorldServiceClient } from './service-client.js';
import { TransferServiceClient } from './transfer-client.js';
import { SourceServiceClient } from './source-client.js';
import { createServiceSession, createWorldQueueRouter } from './service-session.js';
import { RULES_FINGERPRINT } from './service-contract.js';
import { persistServiceMetadata } from './hot-ledger.js';

export function createServiceHost({getCtx,onWorld=()=>{},onStatus=()=>{},onOutcome=()=>{},fetch=globalThis.fetch,persist=null,getBusy=()=>false}) {
    let current=null,identity=null,transfer=null,source=null;
    const settings=()=>getCtx()?.extensionSettings?.story_world_v2??{};
    const connection=()=>{try{return new URL(settings().serviceUrl).href.replace(/\/$/,'')}catch{return ''}};
    function client(){
        const s=settings(),key=JSON.stringify([s.serviceUrl,s.servicePairingToken]);
        if(key!==identity){current=new WorldServiceClient(s.serviceUrl,s.servicePairingToken,{fetch});identity=key;transfer=null;source=null}
        return current;
    }
    const session=createServiceSession({getCtx,getClient:client,getConnectionId:connection,rulesFingerprint:RULES_FINGERPRINT,
        persist:persist??((ctx,options)=>persistServiceMetadata(ctx,'story_world_v2_service',getCtx,options)),onWorld,onStatus,onOutcome});
    return {session,client,connectionId:connection,
        transferClient(){client();return transfer??=new TransferServiceClient(settings().serviceUrl,settings().servicePairingToken,{fetch})},
        sourceClient(){client();return source??=new SourceServiceClient(settings().serviceUrl,settings().servicePairingToken,{fetch})},
        routeQueue:legacy=>{const router=createWorldQueueRouter(legacy,session);return {...router,advance:(...args)=>getBusy()?{ok:false,skipped:'transfer-busy'}:router.advance(...args),get busy(){return getBusy()||router.busy},get cancellable(){return router.cancellable}}},
        config(){return {url:settings().serviceUrl??'',active:session.active,pointer:session.readState()?.pointer??null,operation:session.readout()}},
        guardLegacyAction(action){return (...args)=>{
            if(session.active || getBusy()){const error='此世界由服务保存，此项旧账操作尚未接入；世界未修改';onStatus(error);return {ok:false,error}}
            return action(...args);
        }},
        configure({url,pairingToken}){
            if(session.busy || getBusy())throw new Error('请先核对或停止当前推进，再修改连接');
            new WorldServiceClient(url,pairingToken,{fetch});
            const ctx=getCtx();if(!ctx?.extensionSettings)throw new Error('宿主没有插件设置保存接口');
            ctx.extensionSettings.story_world_v2??={};
            Object.assign(ctx.extensionSettings.story_world_v2,{serviceUrl:url,servicePairingToken:pairingToken});
            session.invalidate();ctx.saveSettingsDebounced?.();return {ok:true};
        },
    };
}

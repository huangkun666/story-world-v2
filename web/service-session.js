import { chatScope } from './message-consumption.js';
import { validateMessageReference } from '../src/chat-consumption.js';

export const SERVICE_META_KEY = 'story_world_v2_service';
const copy = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v==='object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
const validPointer = p => p && ['world_id','branch_id'].every(k=>typeof p[k]==='string' && p[k])
    && Number.isSafeInteger(p.revision) && p.revision>=0;
const phaseText = { queued:'准备推进', prepare:'准备世界事务', retrieve:'检索历史', pack:'整理本轮资料',
    model:'等待世界推演', settle:'核对提议', save:'保存候选', commit:'提交世界', committed:'已提交',
    cancelled:'已停止', failed:'本轮失败，请核对诊断', 'model-unknown':'模型结果尚未确认，请核对原请求',
    'retrieval-limited':'背景资料未完整读取，可继续原推进' };

import {isConfirmedFailedOperation} from './operation-status.js';
const waiting = pending => !!pending && pending.delivery!=='failed';
function operationFailureText(result){
    const timeout=result.errors?.find(e=>e.type==='Sw2TimeoutError'&&/^模型等待 \d+(?:\.\d+)? 秒后超时/.test(e.message??''));
    const seconds=timeout?.message.match(/^模型等待 (\d+(?:\.\d+)?) 秒后超时/)?.[1];
    return seconds?'模型等待 '+seconds+' 秒后超时，响应尚未确认；本轮已停止，原世界未改，不会自动重发':phaseText.failed;
}

// 宿主只保存指针与原操作；服务提交完成之前不能冒充新世界，也不调用旧账保存。
export function createServiceSession({ getCtx, getClient, getConnectionId, rulesFingerprint, persist,
    onWorld=()=>{}, onStatus=()=>{}, onStateChange=()=>{}, onOutcome=()=>{}, makeOperationId=()=>globalThis.crypto.randomUUID(), metaKey=SERVICE_META_KEY }) {
    if (typeof rulesFingerprint!=='string' || !rulesFingerprint) throw new Error('缺少插件规则源码指纹');
    let epoch=0, running=false, cache=null, last=null, sending=null, terminal=null, accepting=null, runDone=Promise.resolve();
    const notifyState=()=>{try{onStateChange()}catch{/* UI does not affect durable execution. */}};
    const binding = () => getCtx()?.chatMetadata?.[metaKey] ?? null;
    const signature = () => JSON.stringify([chatScope(getCtx()),getConnectionId(),binding()?.pointer]);
    const active = () => !!binding();
    // Only an explicit click may continue an unsent operation parked at background retrieval.
    const pendingBackground = () => {
        const state=binding(),pending=state?.pending,row=last;
        return waiting(pending)&&row?.status==='started'&&row.phase==='retrieval-limited'&&!row.call&&row.proposal==null
            &&row.operation_id===pending.input.operation_id&&row.world_id===state.pointer.world_id&&row.branch_id===state.pointer.branch_id
            &&row.expected_revision===pending.input.expected_revision;
    };
    function capture() {
        const ctx=getCtx(), state=binding(), connection=getConnectionId(), client=getClient();
        if (!validPointer(state?.pointer) || state.connection_id!==connection) throw new Error('服务世界连接已改变，请核对原服务');
        return {ctx,state:copy(state),scope:chatScope(ctx),connection,client,epoch};
    }
    function check(c) {
        if (c.epoch!==epoch || c.scope!==chatScope(getCtx()) || c.connection!==getConnectionId() || c.client!==getClient()
            || JSON.stringify(binding())!==JSON.stringify(c.state)) throw new Error('聊天或服务世界已改变，旧结果未应用');
    }
    async function write(c,next,options={}) {
        check(c);
        const previous=c.ctx.chatMetadata[metaKey];
        c.ctx.chatMetadata[metaKey]=copy(next);notifyState();
        try { await persist(c.ctx,options); }
        catch(error) {
            if (JSON.stringify(c.ctx.chatMetadata[metaKey])===JSON.stringify(next)) c.ctx.chatMetadata[metaKey]=previous;
            throw error;
        }
        // 保存等待期间可能已换聊天；只回到原 ctx，禁止写新聊天。
        c.state=copy(next); check(c);notifyState();
    }
    function worldResult(result,pointer,revision) {
        if (result?.world_id!==pointer.world_id || result.branch_id!==pointer.branch_id || result.revision!==revision
            || !result.world || typeof result.world!=='object' || Array.isArray(result.world)) throw new Error('世界身份或版本不匹配');
        return result.world;
    }
    function display(c,world,recordView=null) { check(c); cache={key:signature(),client:c.client,world:copy(world),recordView:copy(recordView)}; onWorld(copy(world)); }
    const currentWorld=(client,p,options,full=false)=>(!full&&typeof client.getWorkingWorld==='function'?client.getWorkingWorld(p,options):client.getWorld(p,options));
    function failure(error,uncertain=false) {
        const result={ok:false,error:String(error?.message??error),...(uncertain?{uncertain:true}:{})};
        onStatus(result.error); onOutcome(result); return result;
    }
    const owner = c => JSON.stringify([c.epoch,c.scope,c.connection,c.state.pending?.input.operation_id]);
    const currentOwner = c => c.epoch===epoch && c.scope===chatScope(getCtx()) && c.connection===getConnectionId() && c.client===getClient();
    async function accept(c,result) {
        if (!['committed','cancelled'].includes(result?.status) && !isConfirmedFailedOperation(result)) return acceptResult(c,result);
        const key=owner(c);
        if (terminal?.key===key && currentOwner(c)) return terminal.outcome;
        if (accepting?.key===key && currentOwner(c)) {
            const outcome=await accepting.promise;
            if(!outcome.failed || !['committed','cancelled'].includes(result?.status))return outcome;
            return accept(c,result);
        }
        // A failed response may later be cancelled or explicitly settled under the same ID.
        // Only delivery may have changed; never adopt a different chat, pointer or input.
        const state=binding();
        if(currentOwner(c) && c.state.pending && state?.pending
            && canonical({...state,pending:{...state.pending,delivery:c.state.pending.delivery}})===canonical(c.state))c.state=copy(state);
        const job={key,promise:null};accepting=job;
        job.promise=acceptResult(c,result).then(outcome=>{
            if (!outcome.pending && !outcome.failed && currentOwner(c)) terminal={key,outcome};
            return outcome;
        }).finally(()=>{if(accepting===job)accepting=null});
        return job.promise;
    }
    async function acceptResult(c,result) {
        check(c);
        const pending=c.state.pending, p=c.state.pointer;
        if (!pending || result?.operation_id!==pending.input.operation_id || result.world_id!==p.world_id
            || result.branch_id!==p.branch_id || result.expected_revision!==pending.input.expected_revision) throw new Error('推进回执身份不匹配');
        last=copy(result); onStatus(phaseText[result.phase]??'正在核对本轮结果');
        if (result.status==='committed') {
            const r=result.receipt;
            if (!r || r.operation_id!==result.operation_id || r.world_id!==p.world_id || r.branch_id!==p.branch_id
                || r.revision!==pending.input.expected_revision+1) throw new Error('提交回执版本不匹配');
            const snapshot=await currentWorld(c.client,p,{revision:r.revision}); check(c);
            const world=worldResult(snapshot,p,r.revision);
            await write(c,{...c.state,pointer:{...p,revision:r.revision},pending:null});
            display(c,world,snapshot.record_view);
            const outcome={ok:true,tick:world.meta?.tick,committed:true,messageRef:pending.input.message_ref??null};
            onOutcome(outcome); return outcome;
        }
        if (result.status==='cancelled') {
            await write(c,{...c.state,pending:null});
            const outcome={ok:false,cancelled:true}; onOutcome(outcome); return outcome;
        }
        if (isConfirmedFailedOperation(result)) {
            if(pending.delivery!=='failed') await write(c,{...c.state,pending:{...pending,delivery:'failed'}});
            const message=operationFailureText(result);onStatus(message);
            const outcome={ok:false,failed:true,error:message};onOutcome(outcome);return outcome;
        }
        if(pending.delivery==='failed') await write(c,{...c.state,pending:{...pending,delivery:'sending'}});
        return {ok:false,pending:true,phase:result.phase,operation:copy(result)};
    }
    async function query(c) {
        if (!c.state.pending) return {ok:true,idle:true};
        return accept(c,await c.client.getOperation(c.state.pointer,c.state.pending.input.operation_id));
    }
    function beginRun(){
        const generation=epoch;running=true;notifyState();let finish;const done=new Promise(resolve=>{finish=resolve});runDone=done;
        return ()=>{finish();if(generation===epoch&&runDone===done){running=false;notifyState()}};
    }
    async function guarded(fn) {
        if (running) return {ok:false,skipped:'busy'};
        const finish=beginRun(),generation=epoch;
        try { return await fn(); } catch(error) { return generation===epoch?failure(error,!!binding()?.pending):{ok:false,stale:true}; }
        finally { if(generation===epoch)sending=null;finish(); }
    }
    const hub={
        get active(){return active()}, get busy(){return running || waiting(binding()?.pending)}, get advancing(){return running && waiting(binding()?.pending)}, get cancellable(){return waiting(binding()?.pending) && !sending?.cancelled},
        // ★界面要知道"这一轮是真在跑，还是挂在那儿没人管"：`busy` 把两者混在一起（有未决就算忙），
        //   所以另给一个只说"此刻真在跑"的读数。只读一个布尔，不参与任何提交／落账判断。
        get running(){return running},
        get resumable(){return !running&&pendingBackground()},
        readWorld(){if(!cache)return null;try{return cache.key===signature() && cache.client===getClient() && binding()?.connection_id===getConnectionId()?copy(cache.world):null}catch{return null}},
        readState(){
            if (!active()) return null;
            try { const c=capture(); return {scope:c.scope,pointer:copy(c.state.pointer),client:c.client,...(cache?.key===signature()&&cache.client===c.client&&cache.recordView?{record_view:copy(cache.recordView)}:{})}; } catch { return null; }
        },
        readout(){return last?copy(last):null},
        async attach(pointer, {expectedWorld, validate=()=>{}}={}) {
            if (running || waiting(binding()?.pending)) throw new Error('请先核对或停止当前推进');
            if (!validPointer(pointer)) throw new Error('世界指针无效');
            validate();
            const finish=beginRun();
            try {
            const ctx=getCtx(),scope=chatScope(ctx),generation=epoch,connection=getConnectionId(),client=getClient(),initial=JSON.stringify(binding());
            await client.connect({rulesFingerprint});validate();
            const response=await currentWorld(client,pointer,{revision:pointer.revision},expectedWorld!==undefined);validate();
            const world=worldResult(response,pointer,pointer.revision);
            if(expectedWorld!==undefined && canonical(world)!==canonical(expectedWorld))throw new Error('服务世界与迁移预览不一致');
            if (scope!==chatScope(getCtx()) || generation!==epoch || connection!==getConnectionId() || client!==getClient() || initial!==JSON.stringify(binding())) throw new Error('聊天或连接已改变，未采用服务世界');
            validate();ctx.chatMetadata??={};
            const before=ctx.chatMetadata[metaKey];
            const next={connection_id:connection,pointer:copy(pointer),pending:null};
            ctx.chatMetadata[metaKey]=next;
            try { await persist(ctx); } catch(error){if(JSON.stringify(ctx.chatMetadata[metaKey])===JSON.stringify(next)){if(before===undefined)delete ctx.chatMetadata[metaKey];else ctx.chatMetadata[metaKey]=before}throw error;}
            validate({committed:true});
            const c={ctx,state:copy(next),scope,connection,client,epoch:generation}; check(c); display(c,world,response.record_view);
            return {ok:true,pointer:copy(pointer)};
            } finally {finish()}
        },
        async detach({validate=()=>{}}={}) {
            if(running || waiting(binding()?.pending))throw new Error('请先核对或停止当前推进');
            validate();const c=capture(),before=copy(c.state),finish=beginRun();
            try {
                check(c);validate();delete c.ctx.chatMetadata[metaKey];
                // ★把"用户明确返回旧账"这件事交给持久层落库（只写在聊天文件里的话，宿主保存失败就会被自动拉回）。
                try {await persist(c.ctx,{detached:true})} catch(error){if(c.ctx.chatMetadata[metaKey]===undefined)c.ctx.chatMetadata[metaKey]=before;throw error}
                c.state=null;check(c);validate({committed:true});hub.invalidate();
                return {ok:true,detached:true,pointer:copy(before.pointer)};
            } finally {finish()}
        },
        async load(){
            const generation=epoch,scope=chatScope(getCtx());
            while(running){await runDone;if(generation!==epoch || scope!==chatScope(getCtx()))return {ok:false,stale:true}}
            return guarded(async()=>{
            cache=null; const c=capture(); await c.client.connect({rulesFingerprint});check(c);
            const response=await currentWorld(c.client,c.state.pointer,{revision:c.state.pointer.revision});check(c);
            display(c,worldResult(response,c.state.pointer,c.state.pointer.revision),response.record_view);
            return c.state.pending?query(c):{ok:true};
        })},
        advance(dialogue='',options={}){return guarded(async()=>{
            const c=capture();
            if (waiting(c.state.pending)) {
                if(options.manual===true&&pendingBackground())return accept(c,await c.client.startTurn(c.state.pointer,copy(c.state.pending.input)));
                return query(c);
            }
            if (c.state.pending && options.manual!==true && (!options.messageRef || canonical(options.messageRef)===canonical(c.state.pending.input.message_ref??null))) return {ok:false,skipped:'failed-message'};
            if (!hub.readWorld()) throw new Error('请先载入并核对服务世界');
            options.validate?.();validateMessageReference(options.messageRef);
            const input={operation_id:makeOperationId(),expected_revision:c.state.pointer.revision,dialogue:String(dialogue??''),allow_limited:false,
                ...(options.messageRef?{message_ref:copy(options.messageRef)}:{})};
            if (typeof input.operation_id!=='string' || !input.operation_id) throw new Error('推进编号无效');
            sending={c,posted:false,cancelled:false};
            const task=sending;
            await write(c,{...c.state,pending:{input,delivery:'prepared'}}, {messages:!!options.saveMessages});
            try { options.validate?.(); }
            catch(error) { await write(c,{...c.state,pending:null});throw error; }
            const stopBeforePost=async()=>{
                if(!task.cancelled)return null;
                await write(c,{...c.state,pending:null});
                const outcome={ok:false,cancelled:true};onOutcome(outcome);return outcome;
            };
            let stopped=await stopBeforePost();if(stopped)return stopped;
            await write(c,{...c.state,pending:{input,delivery:'sending'}});
            stopped=await stopBeforePost();if(stopped)return stopped;
            task.posted=true;
            const result=await c.client.startTurn(c.state.pointer,input);
            return accept(c,result);
        })},
        reconcile(){return guarded(async()=>query(capture()))},
        reprocess(run){return guarded(async()=>{
            const c=capture();if(!c.state.pending)throw new Error('没有待核对操作');
            terminal=null;accepting=null;
            await write(c,{...c.state,pending:{...c.state.pending,delivery:'sending'}});
            return accept(c,await run(copy(c.state.pointer),c.state.pending.input.operation_id));
        })},
        continueLimited(){return guarded(async()=>{
            const c=capture();if(!c.state.pending) throw new Error('没有等待确认的推进');
            return accept(c,await c.client.continueLimited(c.state.pointer,c.state.pending.input.operation_id));
        })},
        async cancel(){
            const generation=epoch;
            if(sending && currentOwner(sending.c) && !sending.posted){sending.cancelled=true;notifyState();return {ok:false,pending:true,cancelling:true}}
            try {
                const c=capture(); if(!waiting(c.state.pending))return {ok:true,idle:true};
                if(c.state.pending.delivery==='prepared'){
                    await write(c,{...c.state,pending:null});const outcome={ok:false,cancelled:true};onOutcome(outcome);return outcome;
                }
                let result;
                try { result=await c.client.cancel(c.state.pointer,c.state.pending.input.operation_id); }
                catch { result=await c.client.getOperation(c.state.pointer,c.state.pending.input.operation_id); }
                return await accept(c,result);
            } catch(error){return generation===epoch?failure(error,true):{ok:false,stale:true}}
        },
        invalidate(){epoch++;running=false;sending=null;runDone=Promise.resolve();cache=null;last=null;terminal=null;accepting=null;notifyState()},
    };
    return hub;
}

export function createWorldQueueRouter(legacy,service) {
    const queue=()=>service.active?service:legacy;
    return {advance:(...args)=>queue().advance(...args),cancel:()=>queue().cancel(),
        invalidate(){legacy.invalidate();service.invalidate()},
        get busy(){return queue().busy},get advancing(){return queue().advancing ?? queue().busy},get cancellable(){return queue().cancellable},get resumable(){return queue().resumable===true}};
}

import {buildPresetRequest} from '../src/prompt-presets.js';
import {modelRequestSummary} from './model-request-summary.js';
import { resolveBrowserTransport } from '../src/transport-config.js';
import { extractionCallLimits } from '../src/runtime-settings.js';
import { pickSender, sanitizeModelErrorMessage } from '../src/transport-http.js';
import { readCompletionResponse, createCompletionProgress } from '../src/transport-sse.js';
import { creationError } from '../src/creation-task.js';

// Request construction and completion parsing remain in the established transport.
// This boundary records one actual dispatch and one normalized receipt, never credentials.
export function createCreationModel(getSettings,{getPresetSettings=null}={}) {
 return async function call(request, { signal, onDispatch, onLateReceipt = async () => {}, onProgress = () => {} } = {}) {
  const clock=()=>globalThis.performance?.now?.()??Date.now(),started=clock(),elapsed=()=>Math.max(0,clock()-started);
  const timing={send_at_ms:null,response_at_ms:null,headers_at_ms:null,first_wire_at_ms:null,last_wire_at_ms:null,first_effective_output_at_ms:null,last_effective_output_at_ms:null};
  let dispatchStarted=null,dispatchFinished=null,observedChars=0;const effectiveOutput=createCompletionProgress();
  const timingReceipt=()=>{const end=elapsed(),round=value=>value===null?null:Math.round(value*1000)/1000;return Object.fromEntries(Object.entries({...timing,total_ms:end,dispatch_wait_ms:dispatchStarted===null?0:(dispatchFinished??end)-dispatchStarted,since_last_effective_output_ms:timing.last_effective_output_at_ms===null?null:end-timing.last_effective_output_at_ms}).map(([key,value])=>[key,round(value)]))};
  const settings = typeof getSettings === 'function' ? getSettings() : getSettings;
  let sent=false, wire=null, completion=null, status=null, contentType='', dispatched=false, settled=false;
  const controller=new AbortController();
  const cancel=()=>controller.abort(); if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const secret=String(settings?.apiKey??'');
  const redact=value=>secret?String(value).split(secret).join('[redacted]'):String(value);
  const progress=update=>{
   if(typeof update?.text==='string'){
    wire=update.text;const delta=wire.slice(observedChars);
    if(delta.length){observedChars=wire.length;const at=elapsed();timing.first_wire_at_ms??=at;timing.last_wire_at_ms=at;if(effectiveOutput(delta)){timing.first_effective_output_at_ms??=at;timing.last_effective_output_at_ms=at}}
    onProgress({phase:'receiving',received_chars:wire.length});
   }
  };
  try {
   const prepared=buildPresetRequest(getPresetSettings?getPresetSettings():settings,'abstract',request.prompt);
   const send=typeof settings?.fetchImpl==='function'?settings.fetchImpl:pickSender();
   const fetchImpl=async(url,init={})=>{
    if(String(init.method??'GET').toUpperCase()!=='POST')return send(url,init);
    if(dispatched)throw creationError('duplicate-dispatch','同一次模型请求不能重复发送');
    const summary=modelRequestSummary(JSON.parse(init.body));
    // Only memory holds auth/custom headers and the external URL.
    dispatchStarted=elapsed();try{await onDispatch?.({request:structuredClone(summary),route:resolved.relay?'host':'direct',...(prepared.preset?{preset:prepared.preset}:{})})}finally{dispatchFinished=elapsed()}
    if(controller.signal.aborted||init.signal?.aborted)throw creationError('cancelled-before-send','已在发送前停止');
    dispatched=true;sent=true;timing.send_at_ms=elapsed();
    const response=await send(url,{...init,onResponseProgress:update=>{progress(update);init.onResponseProgress?.(update);}});
    timing.response_at_ms=elapsed();
    // XHR-shaped senders resolve only after the body, so their true header arrival is not observed here.
    if(response.body?.getReader)timing.headers_at_ms=timing.response_at_ms;status=response.status;contentType=response.headers?.get?.('content-type')??'';
    const headers={'content-type':contentType}, update=value=>{progress(value);init.onResponseProgress?.(value);};
    if(settled){
     wire=await readCompletionResponse(response,update);
     await onLateReceipt({wire:redact(wire),http_status:status,content_type:contentType,usage:null});
     return new Response(wire,{status:response.status,headers});
    }
    if(response.body?.getReader){
     const reader=response.body.getReader(),decoder=new TextDecoder();wire='';
     const body=new ReadableStream({
      async pull(out){try{const part=await reader.read();if(part.done){wire+=decoder.decode();out.close();try{reader.releaseLock()}catch{};return;}
       const text=decoder.decode(part.value,{stream:true});wire+=text;update({text:wire,status,loaded:wire.length});out.enqueue(part.value);
      }catch(error){error.sw2CallFailure??={type:'stream-incomplete'};out.error(error);}},
      cancel:reason=>reader.cancel(reason)
     });
     return new Response(body,{status:response.status,headers});
    }
    wire=await response.text();update({text:wire,status,loaded:wire.length});
    return new Response(wire,{status:response.status,headers});
   };
   const limits=extractionCallLimits(settings);
   const resolved=resolveBrowserTransport({...settings,fetchImpl,creationStrictDispatch:true},{
    extraction:true,responseFormat:request.response_format,
    extractionLimits:{...limits,maxTokens:request.options.source_max_tokens??limits.maxTokens},
    stream:request.options.source_stream!==false
   });
   if(!resolved)throw creationError('model-unconfigured','模型通道尚未配置');
   if(resolved.relay&&resolved.notice)throw Object.assign(creationError('relay-protocol-unsupported','宿主转发仅支持 Chat Completions（对话补全）；当前所选接口类型不能经此通道发送，请核对接口类型或转发设置'),{sw2CallFailure:{type:'not-sent'}});
   const text=await resolved.transport(request.prompt,{signal:controller.signal,...(prepared.messages===undefined?{}:{messages:prepared.messages}),onReceipt:value=>{completion=value.completion;if(timing.first_effective_output_at_ms===null&&typeof completion?.choices?.[0]?.message?.content==='string'&&completion.choices[0].message.content.trim()){const at=timing.last_wire_at_ms??elapsed();timing.first_effective_output_at_ms=at;timing.last_effective_output_at_ms=at}if(settled)void onLateReceipt({wire:wire===null?null:redact(wire),http_status:status,content_type:contentType,usage:completion?.usage??null,text:redact(completion?.choices?.[0]?.message?.content??''),finish_reason:completion?.choices?.[0]?.finish_reason??null}).catch(()=>{});if(value.wire!==undefined&&value.wire!==null)wire=value.wire;}});
   const finish=completion?.choices?.[0]?.finish_reason;
   if(finish!=='stop')throw Object.assign(Error('模型未返回正常结束标记'),{sw2CallFailure:{type:'stream-incomplete'}});
   if(!String(text).trim())throw Object.assign(Error('模型未返回正文'),{sw2CallFailure:{type:'empty'}});
   return {ok:true,sent,timings:timingReceipt(),text:redact(text),wire:wire===null?null:redact(wire),usage:completion?.usage??null,finish_reason:finish,http_status:status,content_type:contentType};
  } catch(error) {
   const type=error?.sw2CallFailure?.type??(sent?(status===null?'network':'protocol'):'not-sent');
   const unknown=sent&&(['network','timeout','cancelled','stream-incomplete'].includes(type)||signal?.aborted===true);
   return {ok:false,sent,unknown,timings:timingReceipt(),text:redact(completion?.choices?.[0]?.message?.content??''),wire:wire===null?null:redact(wire),
    usage:completion?.usage??null,finish_reason:completion?.choices?.[0]?.finish_reason??null,http_status:status,content_type:contentType,
    failure:{type,context_rejected:error.sw2ContextLength===true,message:sanitizeModelErrorMessage(error?.message,secret)}};
  } finally {settled=true;signal?.removeEventListener('abort',cancel);}
 };
}

import {buildPresetRequest} from '../src/prompt-presets.js';
import {modelRequestSummary} from './model-request-summary.js';
import {createSourceGenerationWatch} from '../src/source-generation-watch.js';
import {safeCallFailureText} from './local-source-client.js';
import {extractionCallLimits} from '../src/runtime-settings.js';
import {sourceExtractionResponseFormat} from '../src/source-records.js';
import {resolveBrowserTransport} from '../src/transport-config.js';
import {pickSender,sanitizeModelErrorMessage} from '../src/transport-http.js';
import {diagnostics} from '../src/diagnostics.js';
import {parseCompletionResponse,readCompletionResponse,createCompletionProgress} from '../src/transport-sse.js';
import {parseModelJson} from '../src/model-json.js';
function safeError(error,settings) {
 const name=['Error','TypeError','ReferenceError','SyntaxError','RangeError','InvalidStateError','SecurityError','NetworkError'].includes(error?.name)?error.name:'Error';
 return name+'：'+sanitizeModelErrorMessage(error?.message,settings?.apiKey);
}
// Use the same sender as the established channel; never require page fetch when XHR is available.
export function createBrowserModel(settings,{extraction=false,presetPurpose=null}={}) {
 return async(prompt,{signal,source_id,source_ids,response_format,source_max_tokens,source_generation_watch,source_reasoning_effort,source_stream,onSourceProgress,onPosted,onDispatch,scope=diagnostics.getScope()}={})=>{
  const recorder=diagnostics.forScope(scope);
  // Staged extraction passes its own scoped response_format. Legacy source extraction keeps the
  // existing source schema fallback; main and legacy calls stay on the previous json_object mode.
  const protocolIds=Array.isArray(source_ids)&&source_ids.length?source_ids
   :(typeof source_id==='string'&&source_id.trim()?[source_id]:null);
  const responseFormat=response_format??(extraction&&protocolIds?sourceExtractionResponseFormat(protocolIds):null);
  const watch=source_generation_watch?createSourceGenerationWatch(prompt):null;
  const generationController=watch?new AbortController():null;
  const forwardCancel=()=>generationController?.abort();
  if(generationController){if(signal?.aborted)forwardCancel();else signal?.addEventListener('abort',forwardCancel,{once:true});}
  const callSignal=generationController?.signal??signal;
  let usage=null,data=null,wire=null,partialWire=null,transportStarted=false,dispatched=false,stage='准备请求';const started=Date.now();
  const consume=extraction?createCompletionProgress():null;let progressChars=0,receiving=false;
  try {
   const prepared=presetPurpose?buildPresetRequest(settings,presetPurpose,prompt):{messages:undefined,preset:null};
   const send=typeof settings?.fetchImpl==='function'?settings.fetchImpl:pickSender();
   const fetchImpl=async(url,init)=>{
    // Relay control requests (for example CSRF GET) are never model responses.
    if(String(init.method??'GET').toUpperCase()!=='POST')return send(url,init);
    const progress=update=>{if(typeof update?.text==='string'){partialWire=update.text;stage='接收模型响应';const delta=update.text.slice(progressChars);progressChars=update.text.length;if(consume?.(delta)&&!receiving){receiving=true;try{onSourceProgress?.({phase:'receiving'});}catch{}}if(watch?.update(update.text))generationController.abort()}init.onResponseProgress?.(update)};
    await onDispatch?.({request:modelRequestSummary(JSON.parse(init.body)),route:resolved.relay?'host':'direct',...(prepared.preset?{preset:prepared.preset}:{})});
    if(callSignal?.aborted||init.signal?.aborted)throw Object.assign(Error('已在发送前停止'),{sw2Cancelled:true});
    dispatched=true;stage='发送请求';const response=await send(url,extraction?{...init,onResponseProgress:progress}:init);stage='读取响应';
    wire=await readCompletionResponse(response,progress,{signal:init.signal});
    if(response.ok){stage='解析响应';try{data=parseCompletionResponse(wire,{contentType:response.headers?.get?.('content-type')??''});usage=data?.usage??null;}catch(error){if(error.sw2Completion){data=error.sw2Completion;usage=data.usage??null;}throw error;}}
    return {ok:response.ok,status:response.status,headers:response.headers,text:async()=>wire,json:async()=>{stage='解析响应';return data??JSON.parse(wire)}};
   };
   const limits={...(Number(settings?.callMaxTokens)>0?{maxTokens:Number(settings.callMaxTokens)}:{}),...(Number(settings?.callTimeoutSec)>0?{timeoutMs:Number(settings.callTimeoutSec)*1000}:{})};
   const resolved=resolveBrowserTransport({...settings,fetchImpl},{extraction,limits,...(extraction&&typeof source_stream==='boolean'?{stream:source_stream}:{}),...(extraction&&/^gemini-3/i.test(settings?.model??'')&&source_reasoning_effort?{reasoningEffort:source_reasoning_effort}:{}),...(responseFormat?{responseFormat}:{}),...(extraction?{extractionLimits:{...extractionCallLimits(settings),...(Number(source_max_tokens)>0?{maxTokens:Number(source_max_tokens)}:{})}}:{})});
   if(!resolved)throw Error('模型通道未配置，请填写已有模型 API 设置');
   // Persist dispatch intent before invoking the transport. A failed marker blocks dispatch.
   await onPosted?.();
   transportStarted=true;
   const text=await resolved.transport(prompt,{signal:callSignal,...(prepared.messages===undefined?{}:{messages:prepared.messages})});
   if(extraction&&resolved.protocol==='chat'&&data?.choices?.[0]?.finish_reason!=='stop')throw Object.assign(Error('完整响应缺少正常结束标志'),{sw2CallFailure:{type:'stream-incomplete'}});
   if(extraction){stage='校验抽象结果';if(!String(text).trim())throw Object.assign(Error('模型返回为空，本次没有抽象结果'),{sw2CallFailure:{type:'empty'}});try{parseModelJson(text)}catch{throw Object.assign(Error('模型返回的抽象 JSON 不完整或格式不正确'),{sw2CallFailure:{type:'invalid-json'}})}}
   return {text,usage,provider_response:wire};
  }catch(error){
   if(!dispatched)error.sw2RequestNotSent=true;
   if(watch?.failure){error.sw2CallFailure=watch.failure;data={choices:[{message:{content:watch.text},finish_reason:null}]};}

   if(!error.sw2CallFailure&&!error.sw2Cancelled&&!signal?.aborted&&!String(error.message).includes('模型通道未配置')){
    const network=String(error.message)==='连不上模型服务（network error）';
    error.sw2CallFailure={type:network?'network':'internal',stage,safeMessage:safeError(error,settings)};
   }
   recorder.record('模型','error','模型调用失败',{stage,type:error.sw2CallFailure?.type??'configuration',exception:safeError(error,settings),ms:Date.now()-started,inputChars:String(prompt).length,receivedChars:(wire??partialWire)?.length??0,outputChars:data?.choices?.[0]?.message?.content?.length??null,finishReason:data?.choices?.[0]?.finish_reason??null,usage});
   if(wire!==null||partialWire!==null)return {text:data?.choices?.[0]?.message?.content??wire??'',usage,provider_response:wire??partialWire,unconfirmed:['timeout','cancelled','network','stream-incomplete'].includes(error.sw2CallFailure?.type),failure:{type:error.sw2CallFailure?.type??'protocol',message:watch?.failure?.message??safeCallFailureText(error)}};
   // Once transport starts, missing response evidence remains unknown.
   throw error;
  }finally{signal?.removeEventListener?.('abort',forwardCancel);}

 };
}

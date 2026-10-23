// One complete OpenAI-compatible SSE response. Raw events remain in the caller receipt.
// Reasoning is not extraction output; incomplete streams are never treated as success.
export function parseCompletionEventStream(wire) {
 let content='',refusal='',finish=null,usage=null,error=null,eventType='',lines=[],done=false;
 const snapshot=()=>({choices:[{index:0,message:{content,...(refusal?{refusal}:{})},finish_reason:finish}],...(usage?{usage}:{}),...(error?{error}:{})});
 const incomplete=message=>Object.assign(new Error(message),{sw2CallFailure:{type:"stream-incomplete"},sw2Completion:snapshot()});
 function event() {
  if(!lines.length){eventType='';return}
  const payload=lines.join('\n');lines=[];
  if(payload==='[DONE]'){done=true;eventType='';return}
  if(done)throw incomplete("模型流在终止标记后仍有数据，不能确认完整结果");
  let data;try{data=JSON.parse(payload)}catch{throw incomplete("模型流式响应格式不完整")}
  if(!data||typeof data!=="object"||Array.isArray(data))throw incomplete("模型流式响应形状不完整");
  if(data.error)error=data.error;
  else if(eventType==="error")error={message:typeof data.message==="string"?data.message:"模型流式服务报错"};
  if(data.usage&&typeof data.usage==="object")usage=data.usage;
  if(data.choices!==undefined&&!Array.isArray(data.choices))throw incomplete("模型流式响应 choices 形状不完整");
  for(const choice of data.choices??[]) {
   if(!choice||typeof choice!=="object")throw incomplete("模型流式响应 choice 形状不完整");
   if(choice.index!==undefined&&choice.index!==0)continue;
   if(typeof choice.delta?.refusal==="string")refusal+=choice.delta.refusal;
   if(typeof choice.message?.refusal==="string")refusal=choice.message.refusal;
   if(typeof choice.delta?.content==="string")content+=choice.delta.content;
   else if(typeof choice.message?.content==="string")content=choice.message.content;
   if(typeof choice.finish_reason==="string"&&choice.finish_reason)finish=choice.finish_reason;
  }
  eventType='';
 }
 const text=String(wire).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 for(const line of (text+'\n').split('\n')) {
  if(!line){event();continue}
  if(line.startsWith(':'))continue;
  const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon);
  let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1);
  if(field==='data')lines.push(value);else if(field==='event')eventType=value;
 }
 if(!error&&(!finish||!done))throw incomplete("模型响应中途断开，缺少完整结束原因或终止标记");
 return snapshot();
}


// Track actual generated text, not gateway heartbeat traffic.
export function createCompletionProgress() {
 let pending='';
 return chunk=>{
  pending+=String(chunk);let active=false,match;
  while((match=/\r?\n\r?\n/.exec(pending))){
   const event=pending.slice(0,match.index);pending=pending.slice(match.index+match[0].length);
   const payload=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
   if(!payload||payload==='[DONE]')continue;
   try{const data=JSON.parse(payload),choices=Array.isArray(data.choices)?data.choices:[];
    for(const choice of choices){if(choice?.index!==undefined&&choice.index!==0)continue;
     const delta=choice?.delta??choice?.message;
     if(['content','reasoning_content','reasoning'].some(key=>typeof delta?.[key]==='string'&&delta[key].trim()))active=true;
    }
   }catch{/* Completion validation handles malformed events; they do not extend the wait. */}
  }
  return active;
 };
}
export async function readCompletionResponse(response,onProgress,{signal}={}) {
 if(!response.body?.getReader)return response.text();
 const reader=response.body.getReader(),decoder=new TextDecoder();let text='';
 const abort=()=>{Promise.resolve(reader.cancel()).catch(()=>{})};
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 try{while(true){const part=await reader.read();if(part.done)break;text+=decoder.decode(part.value,{stream:true});onProgress?.({text,loaded:text.length,status:response.status})}text+=decoder.decode();return text}
 finally{signal?.removeEventListener('abort',abort);try{reader.releaseLock()}catch{}}
}

// The wire framing is authoritative when proxies omit or mislabel Content-Type.
// A JSON-looking body still goes through strict JSON parsing.
export function isCompletionEventStream(wire,contentType=''){
 const text=String(wire).trimStart();
 if(/^[{["]/.test(text))return false;
 return /text\/event-stream/i.test(String(contentType))||/^(?::|(?:data|event|id|retry):)/.test(text);
}
export function parseCompletionResponse(wire,{contentType=''}={}){
 const text=String(wire).replace(/^\uFEFF/,'');
 return isCompletionEventStream(text,contentType)?parseCompletionEventStream(text):JSON.parse(text);
}
export async function readCompletionData(response,onProgress,options={}){
 let wire=null;try{
  const data=typeof response.text!=='function'&&!response.body?.getReader?await response.json():parseCompletionResponse(wire=await readCompletionResponse(response,onProgress,options),{contentType:response.headers?.get?.('content-type')??''});
  options.onReceipt?.({wire,completion:data});return data;
 }catch(error){options.onReceipt?.({wire,completion:error.sw2Completion??null});throw error;}
}

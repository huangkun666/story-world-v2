// One schema is used by the API and the model-readable contract. No provider enforcement assumed.
import {canonicalSourceJson} from './source-records.js';
import {sha256Hex} from './browser-capabilities.js';
export function responseContractPrompt(prompt,format,{previous=null,example=null}={}){
    const schema=format?.json_schema?.schema;
    if(!schema)throw Error('抽象响应缺少同源契约');
    const lines=['严格返回一个完整JSON对象，不加代码围栏。下面是与你收到的接口schema同源的响应契约；即使接口没有强制schema，也必须遵守所有required、字段结构、枚举和类型约定。',
        'RESPONSE_CONTRACT_JSON:',JSON.stringify(schema)];
    if(example)lines.push('结构示例仅说明外形；空数组只适用于原文确实没有相应记载，必须完整处理本次来源和负责的记载。','RESPONSE_SHAPE_EXAMPLE_JSON:',JSON.stringify(example));
    if(previous){
        lines.push('上次已收到完整回执，但未通过校验。本次是针对下列具体错误的纠正，保留先前记录内容和已有元数据，返回符合完整契约的新对象；禁止忽略错误原样重发，禁止猜造事实或默认补complete。',
            'VALIDATION_CORRECTION_JSON:',JSON.stringify({attempt_id:previous.attempt_id,error:previous.error,response:previous.response}));
    }
    return lines.join('\n')+'\n'+prompt;
}
export function correctionReceipt(row,call){
    const block=row.staged.blocks[call.call_id],attempt=row.execution.attempts.find(a=>a.attempt_id===block?.attempt_ids?.at(-1));
    if(block?.status!=='failed'||block.error?.stage!=='validation'||attempt?.response==null||attempt.unconfirmed)return null;
    return {attempt_id:attempt.attempt_id,error:block.error.message,response:attempt.response};
}
export function responseContractHash(format){return sha256Hex(canonicalSourceJson(format));}

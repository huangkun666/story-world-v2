import {sha256Hex} from '../src/browser-capabilities.js';
import { ServiceError, WorldServiceClient } from './service-client.js';
export const TRANSFER_FORMAT='story-world-v2-transfer';
export async function rawPayloadDigest(raw){
 if(typeof raw!=='string')throw new ServiceError('传输正文必须是原始字符串');
 return sha256Hex(raw);
}
export async function createTransferBundle(payload){const raw=typeof payload==='string'?payload:JSON.stringify(payload);return {format:TRANSFER_FORMAT,version:1,payload:raw,digest:await rawPayloadDigest(raw)}}
export async function verifyTransferBundle(bundle){
 if(!bundle || Object.keys(bundle).sort().join(',')!=='digest,format,payload,version' || bundle.format!==TRANSFER_FORMAT || bundle.version!==1 || await rawPayloadDigest(bundle.payload)!==bundle.digest)throw new ServiceError('传输文件格式或原始正文摘要不符');
 const payload=JSON.parse(bundle.payload);if(!payload || !['legacy','service'].includes(payload.kind))throw new ServiceError('传输文件用途不符');return payload;
}
export function verifyImportReceipt(result,input,revision){
 const match=row=>row && ['operation_id','world_id','branch_id'].every(k=>row[k]===input[k]) && row.revision===revision;
 if(result?.status!=='committed' || result.bundle_digest!==input.bundle.digest || !match(result) || !match(result.receipt))throw new ServiceError('迁移回执身份、正文摘要或固定版本不匹配');return result;
}
export class TransferServiceClient{
 #base;#token;#fetch;
 constructor(url,token,{fetch=globalThis.fetch}={}){new WorldServiceClient(url,token,{fetch});this.#base=new URL(url).href.replace(/\/$/,'');this.#token=token;this.#fetch=fetch}
 async #request(path,{method='GET',body}={}){const response=await this.#fetch(this.#base+'/v1'+path,{method,headers:{Authorization:'Bearer '+this.#token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw new ServiceError('迁移服务请求失败（'+response.status+'）',response.status);try{return await response.json()}catch{throw new ServiceError('迁移响应尚未确认',null,true)}}
 async preview(bundle){await verifyTransferBundle(bundle);const r=await this.#request('/transfers/preview',{method:'POST',body:{bundle}});if(r.bundle_digest!==bundle.digest || !Number.isSafeInteger(r.revision) || r.revision<0 || !r.world || !r.report || !Array.isArray(r.report.errors))throw new ServiceError('迁移预览正文或版本不匹配');return r}
 async import(input,{revision}={}){await verifyTransferBundle(input.bundle);try{return verifyImportReceipt(await this.#request('/transfers/imports',{method:'POST',body:input}),input,revision)}catch(error){if(error instanceof ServiceError && !error.uncertain)throw error;try{return await this.getImport(input,{revision})}catch{throw new ServiceError('迁移尚未确认，请核对原编号；不会新建迁移',null,true)}}}
 async getImport(input,{revision}={}){return verifyImportReceipt(await this.#request('/transfers/imports/'+encodeURIComponent(input.operation_id)),input,revision)}
 async export(pointer){if(!Number.isSafeInteger(pointer?.revision)||pointer.revision<0)throw new ServiceError('服务导出版本无效');const b=await this.#request('/worlds/'+encodeURIComponent(pointer.world_id)+'/branches/'+encodeURIComponent(pointer.branch_id)+'/export?revision='+pointer.revision);const p=await verifyTransferBundle(b);if(p.kind!=='service'||['world_id','branch_id','revision'].some(k=>p[k]!==pointer[k]))throw new ServiceError('服务备份身份或版本不匹配');return b}
}

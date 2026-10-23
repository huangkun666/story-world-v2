import {initialEventEvidenceId,initialRecordText} from './source-initial-state.js';
// One accepted draft -> one immutable publication. No model calls and no semantic reconciliation.
import {sha256Hex} from './browser-capabilities.js';
import {canonicalSourceJson,validateSourceRecords} from './source-records.js';
import {validateConfirmedFieldTable} from './source-field-table.js';
import {SOURCE_WORKSPACE_PROTOCOL,workspaceTaskCalls,workspaceFieldCoverage,assembleWorkspaceDraft,workspaceFormalProjection} from './source-workspace.js';

const clone=v=>structuredClone(v),digest=v=>sha256Hex(canonicalSourceJson(v));
export const isFinalizedPublication=p=>p?.protocol===SOURCE_WORKSPACE_PROTOCOL;
export function currentWorkspaceResult(row){
    const ws=row.staged?.workspace,r=ws?.result;
    if(row.status==='cancelled'||!['complete','publication_failed'].includes(row.staged?.finalization?.status)||!r||ws.pending_request||r.workspace_revision!==ws.revision||workspaceFieldCoverage(row).length)throw Error('定稿版本尚未完整或已改变，不能发布');
    const calls=workspaceTaskCalls(row).map(c=>row.staged.plan.calls.find(old=>old.call_id===c.call_id));
    if(calls.some(c=>!c)||canonicalSourceJson(assembleWorkspaceDraft(row,calls))!==canonicalSourceJson(workspaceFormalProjection(row,r).result))throw Error('定稿结果与当前任务回执不一致');
    return workspaceFormalProjection(row,r).result;
}
export function finalizedRecords(result,table,{geography=[]}={}){
    table=validateConfirmedFieldTable(table);const records=[],registrationOnly=result.registration_only===true;
    for(const e of result.current.entities){
        const fields={};for(const f of e.fields){const def=f.field_id==='@location'?{name:'location'}:table.fields.find(d=>d.id===f.field_id&&(registrationOnly||d.kinds.includes(e.kind)&&d.enabled!==false));if(!def)throw Error('定稿字段未获本次确认许可');Object.defineProperty(fields,def.name,{value:f.value,enumerable:true});}
        records.push({record_kind:e.kind==='location'?'location':'entity',id:e.id,name:e.name,...(e.kind==='location'?{}:{kind:e.kind}),...(e.aliases.length?{aliases:clone(e.aliases)}:{}),...(Object.keys(fields).length?{fields}:{})});
    }
    for(const r of result.current.relations)records.push({record_kind:'relation',id:r.id,from_id:r.from_id,to_id:r.to_id,text:r.kind,fact_type:'current'});
    records.push(...clone(result.settings??[]),...clone(geography));return registrationOnly?records:validateSourceRecords(records,{published:true});
}
export function validateWorkspacePublicationDraft(row,value){
    const projected=workspaceFormalProjection(row,value),table=validateConfirmedFieldTable(row.staged.workspace.foundation.field_table);
    const records=finalizedRecords(projected.result,table,{geography:projected.geography});
    return {...projected,table,records};
}
export function workspacePublication(row,receipt){
    const {result,geography,table,records}=validateWorkspacePublicationDraft(row,currentWorkspaceResult(row));
    const sources=row.entries.map(e=>({...clone(e),content_hash:row.items.find(i=>i.source_id===e.source_id).content_hash,task_id:row.import_id}));
    const publication={...receipt,protocol:SOURCE_WORKSPACE_PROTOCOL,extractor_key:row.extractor_key,field_table:table,finalized:result,records,sources,geography};
    publication.finalized_digest=digest({finalized:result,field_table:table,records});return publication;
}
export function validateFinalizedPublication(p){
    if(!isFinalizedPublication(p)||p.finalized?.protocol!==SOURCE_WORKSPACE_PROTOCOL||p.finalized_digest!==digest({finalized:p.finalized,field_table:p.field_table,records:p.records}))throw Error('固定定稿包内容校验失败');
    if(canonicalSourceJson(finalizedRecords(p.finalized,p.field_table,{geography:p.geography??[]}))!==canonicalSourceJson(p.records))throw Error('定稿包与正式投影不一致');
    if(p.ab_protocol==='source-ab-v1'&&canonicalSourceJson(p.ab_initial)!==canonicalSourceJson({version:1,events:(p.finalized.events??[]).filter(r=>r.status==='ongoing'),plans:(p.finalized.plans??[]).filter(r=>r.status==='pending')}))throw Error('AB initial state does not match the fixed publication');
    return p;
}
export function freezeInitialState(world){
    if(!isFinalizedPublication(world.meta?.sourcePublication))return;
    const value={version:1,entities:clone(world.entities),relations:clone(world.relations??[])};
    world.meta.sourcePublication.conversion.initial_state={...value,digest:digest(value)};
}
export function frozenInitialState(world){
    const s=world.meta?.sourcePublication?.conversion?.initial_state;
    if(!s||s.version!==1||!Array.isArray(s.entities)||!Array.isArray(s.relations))return null;
    const {digest:expected,...value}=s;return expected===digest(value)?s:null;
}
export function finalizedEvidenceRecords(publication){
    const f=publication.finalized,claims=new Map((f.provenance?.claims??[]).map(c=>[c.id,c])),out=[],isAB=publication.ab_protocol==='source-ab-v1';
    const participants=r=>[...new Set((r.claim_ids??[]).flatMap(id=>{const c=claims.get(id);return c?[c.subject_id,c.object_id].filter(Boolean):[];}))];
    for(const [key,kind]of [['history','source-history'],['plans','source-plan'],['ambiguities','source-ambiguity']])for(const r of f[key]??[]){
        const recordKind=isAB&&key==='plans'&&r.status!=='pending'?'source-context':kind;
        const text=(key==='ambiguities'?r.summary+'；'+r.alternatives.map(a=>a.value).join('／')+'（原文未定）':isAB?initialRecordText(r,{plan:key==='plans'}):r.text)
            +(isAB&&key==='plans'&&r.status==='unknown'?'（是否完成未明）':'');
        out.push({id:kind+':'+digest([publication.library_id,publication.version,r.id]),record_kind:recordKind,text,story_time:r.story_time??null,participantIds:publication.ab_protocol==='source-ab-v1'?[...new Set([r.subject_id,...(r.participant_ids??[]),...(key==='ambiguities'?participants(r):[])].filter(Boolean))]:participants(r),claim_ids:clone(r.claim_ids??[]),...(isAB?{source_record_id:r.id,...(r.status!==undefined?{status:r.status}:{}),source_refs:clone(r.source_refs??[]),sources:clone(r.sources??[]),time_basis:r.time_basis??null,qualifiers:r.qualifiers??null,...(Object.hasOwn(r,'location_id')?{location_id:r.location_id}:{})}:{})});
    }
    const sourceEvents=[...(publication.ab_initial?.events??[]),...(isAB?(f.events??[]).filter(r=>r.status==='unknown'):[])];
    for(const r of sourceEvents)out.push({id:initialEventEvidenceId(publication,r.id),record_kind:'source-context',text:initialRecordText(r)+(isAB&&r.status==='unknown'?'（事件状态未明）':''),...(isAB?{source_record_id:r.id,status:r.status}:{}),story_time:r.story_time??null,participantIds:[...(r.participant_ids??[])],claim_ids:clone(r.claim_ids??[]),source_refs:clone(r.source_refs??[]),sources:clone(r.sources??[]),location_id:r.location_id??null,time_basis:r.time_basis??null,qualifiers:r.qualifiers??null});
    // Locations stay locations. Facts outside the entity relation ledger still reach readers.
    const entityIds=new Set((publication.records??[]).filter(r=>r.record_kind==='entity').map(r=>r.id));
    const names=new Map((publication.records??[]).filter(r=>['entity','location'].includes(r.record_kind)).map(r=>[r.id,r.name]));
    for(const r of f.current?.relations??[]){
        if(entityIds.has(r.from_id)&&entityIds.has(r.to_id))continue;
        const state=r.state==='ended'?'（已结束）':r.state==='active'?'（当时有效）':'';
        out.push({id:'source-relation:'+digest([publication.library_id,publication.version,r.id]),record_kind:'source-context',text:'原文开局关系：'+(names.get(r.from_id)??r.from_id)+' → '+(names.get(r.to_id)??r.to_id)+'：'+r.kind+state,participantIds:[r.from_id,r.to_id].filter(id=>entityIds.has(id)),claim_ids:clone(r.claim_ids??[])});
    }
    for(const entity of f.current?.entities??[])if(entity.kind==='location')for(const field of entity.fields??[]){
        const name=field.field_id==='@location'?'位置':publication.field_table?.fields?.find(d=>d.id===field.field_id)?.name??field.field_id;
        out.push({id:'source-place-field:'+digest([publication.library_id,publication.version,entity.id,field.id]),record_kind:'source-context',text:'原文开局地点资料：'+entity.name+'；'+name+'：'+field.value,participantIds:[],claim_ids:clone(field.claim_ids??[])});
    }
    const labels={rules:'世界规则',historyNotes:'原文历史',society:'社会制度',techOrMagic:'技术与力量体系',situation:'原文局势'};
    for(const s of f.settings??[])for(const [key,value]of Object.entries(s.data??{}))if(labels[key]){
        const values=Array.isArray(value)?value:[value];for(const [i,text]of values.entries())if(typeof text==='string'&&text.trim())out.push({id:'source-setting:'+digest([publication.library_id,publication.version,s.id,key,i]),record_kind:key==='historyNotes'?'source-history':'source-context',text:labels[key]+'：'+text,participantIds:[]});
    }
    return out;
}

// Export only the selected task. Full receipts stay full; credential redaction has no length cap.
import {sourceRequestCounts} from './source-request-counts.js';
const secret=/^(?:api[_-]?key|authorization|proxy[_-]?authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|password|secret|servicePairingToken)$/i;
export function redactTaskDiagnostics(value){
    if(typeof value==='string')return value.replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]').replace(/((?:"?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)"?)\s*[:=]\s*)("(?:\\.|[^"\\])*"|'[^']*'|[^\s,}&]+)/gi,'$1"[REDACTED]"');
    if(Array.isArray(value))return value.map(redactTaskDiagnostics);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,secret.test(k)?'[REDACTED]':redactTaskDiagnostics(v)]));
    return value;
}
const pick=(v,keys)=>Object.fromEntries(keys.filter(k=>v?.[k]!==undefined).map(k=>[k,v[k]]));
export function sourceTaskDiagnostics(row){
    const staged=row.staged,plan=staged?.plan,bootstrap=staged?.bootstrap?.plan;
    const calls=[...(bootstrap?.calls??[]),...(plan?.calls??[])];
    return redactTaskDiagnostics({library_id:row.library_id,import_id:row.import_id,status:row.status,protocol:staged?.protocol??null,delivery_version:staged?.delivery_version??null,
        stage_status:staged?.status,workspace_revision:staged?.workspace?.revision,phase_plan:{current:plan?.calls?.filter(c=>!c.workspace_batch).length??0,bootstrap:bootstrap?.calls?.length??0,final_upper_bound:false},actual_requests:sourceRequestCounts(row),batch_config:row.batch_config,
        field_review:staged?.field_review??null,failure:staged?.failure,capacity:staged?.capacity,blockers:staged?.workspace?.blockers,plan_revisions:staged?.plan_revisions??[],
        sources:row.items.map(i=>pick(i,['source_id','content_hash','status'])),
        calls:calls.map(c=>({...pick(c,['call_id','stage','scope','task_key','dependency_hash','workspace_revision','chunk_ids','chars','collection_revision','workspace_batch','bootstrap_supplement','bootstrap_hint_ids','prior_call_ids']),...(c.children?{children:c.children.map(child=>pick(child,['call_id','task_key','dependency_hash']))}:{}),checkpoint:pick(staged.blocks?.[c.call_id],['status','attempt_count','attempt_ids','error','batch_receipt_id','context_rejected','authorized_correction','correction_history','revalidated_receipts'])})),
        attempts:(row.execution?.attempts??[]).map(a=>pick(a,['attempt_id','call_id','stage','scope','outcome','started_at','model_invoked_at','posted_at','received_at','input_chars','contract_chars','contract_hash','response_chars','corrects_attempt_id','correction_request_id','transport_mode','request','response','provider_response','usage','error','failure','unconfirmed','superseded','completed_units']))});
}

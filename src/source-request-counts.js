// Durable attempt records, rather than plan size, describe paid transport activity.
export function sourceRequestCounts(row){
    const attempts=row.execution?.attempts??[],byCall=new Map();
    for(const a of attempts)byCall.set(a.call_id??a.batch_id??a.source_id,(byCall.get(a.call_id??a.batch_id??a.source_id)??0)+1);
    return {claimed:attempts.length,invoked:attempts.filter(a=>a.model_invoked_at!=null).length,posted:attempts.filter(a=>a.posted_at!=null).length,
        received:attempts.filter(a=>a.response!=null).length,succeeded:attempts.filter(a=>a.outcome==='succeeded').length,
        retries:[...byCall.values()].reduce((n,c)=>n+Math.max(0,c-1),0),unknown:attempts.filter(a=>a.outcome==='unknown'||a.unconfirmed).length,
        legacy_unclassified:attempts.filter(a=>a.model_invoked_at==null&&a.started_at==null).length};
}

import {buildWorldMovements} from '../src/chat-world-movements.js';
import {resolveLimits} from '../src/limits.js';
import {RECORD_STORES,createWorldRecordStore,isRecordWorld,expandRecordWorld,joinRecord,splitRecord} from './world-record-store.js';
import {createRecordCandidates,isRecordCandidate,expandRecordCandidate,validateRecordPartial,mergePartialCandidate} from './world-record-candidate.js';
import {validateMessageReference} from '../src/chat-consumption.js';
import {RETAIN_STEPS} from '../src/snapshot.js';
import {parse as parseArchive,stringify as stringifyArchive} from '../vendor/flatted/index.js';
import {isConfirmedFailedOperation} from './operation-status.js';
import {effectiveSourceRecords} from '../src/source-edit.js';
// Browser-owned canonical history. Indexes and vectors are rebuildable caches.
import { Dexie } from '../vendor/world-memory.js';
import { sha256Hex } from '../src/browser-capabilities.js';
import { validateSourceRecords } from '../src/source-records.js';
// ★2026-10-16（用户令）：世界快照不含玩家参数、导出含参数、同一份世界正文库里只留一份。
//   归属口径只在 `src/param-ownership.js` 一处；内容寻址只在 `web/world-body-store.js` 一处。
import { playerParamsOf, stripPlayerParams, hydratePlayerParams, userParamsRecord } from '../src/param-ownership.js';
import { bodyDigestOf, bodyRefOf, isRefRow, inlineBodyOf, verifyBody } from './world-body-store.js';

function fail(message, status=409) { const error=new Error(message); error.status=status; throw error; }
function id(value,label) { if(typeof value!=='string'||!value.trim())fail('Invalid '+label,400); return value; }
function revision(value) { if(!Number.isSafeInteger(value)||value<0)fail('Invalid revision',400); return value; }
function scope(pointer) { if(!pointer||typeof pointer!=='object')fail('Invalid pointer',400);id(pointer.world_id,'world_id');id(pointer.branch_id,'branch_id');if(Object.hasOwn(pointer,'revision'))revision(pointer.revision);return [pointer.world_id,pointer.branch_id]; }
// Reject values JSON.stringify would otherwise discard or coerce.
function canonical(value, seen=new Set()) {
    if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
    if(typeof value==='number'){if(!Number.isFinite(value))fail('Strict JSON requires finite numbers',400);return JSON.stringify(value);}
    if(typeof value!=='object')fail('Strict JSON rejects '+typeof value,400);
    if(seen.has(value))fail('Strict JSON rejects cyclic values',400);
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(!array&&prototype!==Object.prototype&&prototype!==null)fail('Strict JSON requires plain objects',400);
    if(Object.getOwnPropertySymbols(value).length)fail('Strict JSON rejects symbol properties',400);
    const keys=Object.getOwnPropertyNames(value).filter(k=>!(array&&k==='length'));
    for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail('Strict JSON rejects hidden properties and accessors',400);}
    if(array&&(keys.length!==value.length||keys.some((k,i)=>k!==String(i))))fail('Strict JSON rejects sparse or extended arrays',400);
    seen.add(value);
    const result=array?'['+value.map(v=>canonical(v,seen)).join(',')+']':'{'+keys.sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],seen)).join(',')+'}';
    seen.delete(value);return result;
}
// Copy strict JSON without escaping a large backup payload inside another JSON string.
// A visited map preserves existing shared audit references; equal independent arrays stay independent.
function detached(value,stack=new Set(),known=new Map()){
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'){if(!Number.isFinite(value))fail('Strict JSON requires finite numbers',400);return value;}
    if(typeof value!=='object')fail('Strict JSON rejects '+typeof value,400);
    if(stack.has(value))fail('Strict JSON rejects cyclic values',400);
    if(known.has(value))return known.get(value);
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(!array&&prototype!==Object.prototype&&prototype!==null)fail('Strict JSON requires plain objects',400);
    if(Object.getOwnPropertySymbols(value).length)fail('Strict JSON rejects symbol properties',400);
    const keys=Object.getOwnPropertyNames(value).filter(k=>!(array&&k==='length'));
    if(array&&(keys.length!==value.length||keys.some((k,i)=>k!==String(i))))fail('Strict JSON rejects sparse or extended arrays',400);
    const result=array?[]:{};known.set(value,result);stack.add(value);
    for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail('Strict JSON rejects hidden properties and accessors',400);Object.defineProperty(result,key,{value:detached(descriptor.value,stack,known),enumerable:true,writable:true,configurable:true});}
    stack.delete(value);return result;
}
export function readBrowserBackupPayload(bundle){return bundle?.encoding==='flatted-v1'?parseArchive(bundle.payload):JSON.parse(bundle.payload);}
function equal(a,b,known=new WeakMap()){
    if(a===b)return true;
    if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
    const previous=known.get(a);if(previous?.has(b))return true;if(previous)previous.add(b);else known.set(a,new WeakSet([b]));
    const left=Object.keys(a).sort(),right=Object.keys(b).sort();
    return left.length===right.length&&left.every((key,i)=>key===right[i]&&equal(a[key],b[key],known));
}
const terminal=row=>row.status==='cancelled'||row.status==='committed';
function active(row){if(terminal(row))fail('Operation is terminal: '+row.status);}
function envelope(row){return detached({world_id:row.world_id,branch_id:row.branch_id,revision:row.revision,world:row.world});}
function job(snapshot){return {world_id:snapshot.world_id,branch_id:snapshot.branch_id,revision:snapshot.revision,identity:canonical([snapshot.world_id,snapshot.branch_id,snapshot.revision]),status:'queued',error:null};}
// ★2026-10-16：行的"正文身份"与"玩家参数"分开。
//   行里存的是**剥掉玩家参数**的正文（按摘要只留一份），玩家参数单独存 `userParams`（按稳定 world_id）。
//   读取时再把参数合回去 ⇒ 引擎、渲染、检索拿到的仍是完整世界（它们的读法一行不改）。
function rowRound(world){const tick=world?.meta?.tick;return Number.isFinite(tick)?tick:null;}
function snapshot(pointer,world,provenance=null){scope(pointer);revision(pointer.revision);const copy=detached(world);if(!copy||Array.isArray(copy)||typeof copy!=='object')fail('World must be a JSON plain object',400);const body=stripPlayerParams(copy),digest=bodyDigestOf(body);return {...pointer,body_digest:digest,body_bytes:canonical(body).length,round:rowRound(copy),at:provenance?.saved_at??null,provenance:detached(provenance),digest};}
// 检查点／操作行里按引用存世界正文时用的标记（只在库内部出现，读出时会被换回完整世界）。
const BODY_REF_KEY='__sw2_body_ref';
/**
 * 把任意结构里 `world` 这一格换成引用标记（**纯函数**，改的是副本）。
 * 返回 `{value, changed, bodies}`：`bodies` 是这一趟遇到的世界正文（调用方负责落库）。
 * 为什么递归：检查点的形状由编排层决定（`prepared.world` 在顶层，别处可能在更深处）；
 * 只认键名 `world` 且值是普通对象，其它键（提示包、检索结果、回执）一个字不动。
 */
function packWorldRefs(value){
    if(!value||typeof value!=='object')return {value,changed:false,bodies:[]};
    if(Array.isArray(value)){
        const out=[];let changed=false;const bodies=[];
        for(const item of value){const packed=packWorldRefs(item);if(packed.changed)changed=true;bodies.push(...packed.bodies);out.push(packed.value);}
        return {value:changed?out:value,changed,bodies};
    }
    let changed=false;const bodies=[],out={};
    for(const [key,item] of Object.entries(value)){
        if(key==='world'&&item&&typeof item==='object'&&!Array.isArray(item)&&!Object.hasOwn(item,BODY_REF_KEY)){
            changed=true;bodies.push(item);out[key]={[BODY_REF_KEY]:bodyDigestOf(stripPlayerParams(item))};continue;
        }
        const packed=packWorldRefs(item);if(packed.changed)changed=true;bodies.push(...packed.bodies);out[key]=packed.value;
    }
    return {value:changed?out:value,changed,bodies};
}
/** 把引用标记换回完整世界（`resolve` 由调用方给：库里读正文，或迁移时的临时表）。 */
function unpackWorldRefs(value,resolve){
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(item=>unpackWorldRefs(item,resolve));
    const ref=value[BODY_REF_KEY];
    if(typeof ref==='string')return resolve(ref);
    const out={};
    for(const [key,item] of Object.entries(value))out[key]=unpackWorldRefs(item,resolve);
    return out;
}
/** 收集一份结构里所有的正文引用（导出／导入时按这份清单搬运，避免漏带正文）。 */
function collectBodyRefs(value,out=new Set()){
    if(!value||typeof value!=='object')return out;
    if(Array.isArray(value)){for(const item of value)collectBodyRefs(item,out);return out;}
    const ref=value[BODY_REF_KEY];
    if(typeof ref==='string')out.add(ref);
    for(const item of Object.values(value))collectBodyRefs(item,out);
    return out;
}
function errorDetails(error){if(typeof error==='string')return {type:'Error',message:error};if(error&&typeof error==='object')return {type:typeof error.type==='string'?error.type:typeof error.name==='string'?error.name:'Error',message:typeof error.message==='string'?error.message:'Unknown model outcome'};fail('Error must be a string or typed error',400);}
// Walk world-level source references (including publication "updates" containers and
// provenance wrappers) so required versions are neither missed nor invented.
function walkSources(value,visit) {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const item of value)walkSources(item,visit);return;}
    visit(value);
    for(const key of ['original','sourceInitialization','sourcePublication','updates'])if(value[key])walkSources(value[key],visit);
}
function publication(value) { return !!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.hasOwn(value,'records')||Object.hasOwn(value,'sources')||Object.hasOwn(value,'updates')||Object.hasOwn(value,'import_id')); }
function validatePublication(value) {
    const records=validateSourceRecords(value.records,{published:true});
    const referenced=records.some(record=>record.source_refs?.length);
    // A setting-update container carries only {records:[],sources:[],updates:[complete bundle]}.
    if(value.updates!==undefined){if(!Array.isArray(value.updates)||!value.updates.length)fail('Backup source updates invalid',400);for(const update of value.updates)validatePublication(update);}
    if(!referenced&&!Object.hasOwn(value,'import_id'))return;
    if(!Array.isArray(value.sources)||!value.sources.length)fail('Backup source manifest requires complete originals',400);
    const sources=new Map();
    for(const source of value.sources){id(source.source_id,'source_id');id(source.content_hash,'content_hash');id(source.task_id,'task_id');if(typeof source.content!=='string'||sha256Hex(source.content)!==source.content_hash)fail('Backup source original content hash mismatch',400);if(!source.metadata||typeof source.metadata!=='object'||Array.isArray(source.metadata))fail('Backup source metadata invalid',400);if(sources.has(source.source_id))fail('Backup source manifest duplicate source_id',400);sources.set(source.source_id,source);if(value.import_id&&source.task_id!==value.import_id)fail('Backup source manifest task mismatch',400);}
    const omitted=value.omitted_source_ids??[];if(!Array.isArray(omitted)||new Set(omitted).size!==omitted.length)fail('Backup source omissions invalid',400);for(const sourceId of omitted){id(sourceId,'omitted source_id');if(!sources.has(sourceId))fail('Backup omitted source missing',400);}
    for(const record of records)for(const ref of record.source_refs||[]){const source=sources.get(ref.source_id);if(!source||ref.content_hash!==source.content_hash||omitted.includes(ref.source_id)||ref.task_id&&ref.task_id!==source.task_id)fail('Backup source_refs do not match source manifest',400);}
}
const FORMAT='story-world-v2-browser-backup';
// Imported operations get a new identity inside the target world/branch, so the live id is a
// deterministic function of that scope. The untouched original row stays in the audit fields.
export function importedOperationId(world_id,branch_id,operation_id){id(world_id,'world_id');id(branch_id,'branch_id');id(operation_id,'operation_id');return 'imported:'+sha256Hex(canonical([world_id,branch_id,operation_id]));}

export function createWorldJournal({database=null,projectSourceImport=null,sourceAuditTables=[],name='story-world-v2-canonical',indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange}={}) {
    if(typeof indexedDB?.open!=='function'||!IDBKeyRange)fail('Browser capability missing: IndexedDB',400);
    id(name,'database name');
    const db=database??new Dexie(name,{indexedDB,IDBKeyRange});
    if(!database){
    db.version(1).stores({heads:'[world_id+branch_id], world_id, revision',snapshots:'[world_id+branch_id+revision], [world_id+branch_id]',operations:'operation_id, [world_id+branch_id], status',indexJobs:'[world_id+branch_id+revision], status',vectors:'[identity+hash], identity',libraries:'library_id',imports:'[library_id+import_id], library_id',sourceVersions:'[library_id+version], library_id',bindings:'scope'});
    db.version(2).stores({snapshots:'[world_id+branch_id+revision], [world_id+branch_id], world_id',savedSnapshots:'[world_id+snapshot_id], world_id'});
    // ★2026-10-16（用户令）v3：世界正文按内容只留一份 + 玩家参数单独存。
    //   为什么升级放在 Dexie 的 upgrade 里：迁移要在**同一个事务**里完成，中途失败整体回滚；
    //   原件（旧行里的内联正文）在正文写成功之前**一个字不删**（读取兼容未就绪不得先删旧正文）。
    db.version(3).stores({worldBodies:'digest',userParams:'world_id'}).upgrade(async tx=>{
        const rows=await tx.table('snapshots').toArray(),saved=await tx.table('savedSnapshots').toArray();
        const params=new Map();
        for(const row of await tx.table('userParams').toArray())params.set(row.world_id,row.params??{});
        const bodies=tx.table('worldBodies');
        async function putBody(world,at){
            const body=stripPlayerParams(world);
            const digest=bodyDigestOf(body),previous=await bodies.get(digest);
            if(previous){const check=verifyBody(digest,previous.body);if(!check.ok)fail(check.reason);return {body_digest:digest,body_bytes:canonical(body).length,round:rowRound(world),at:at??null,digest};}
            await bodies.add({digest,body,bytes:canonical(body).length,created_at:new Date().toISOString()});
            return {body_digest:digest,body_bytes:canonical(body).length,round:rowRound(world),at:at??null,digest};
        }
        for(const row of rows){
            const world=row.world;if(!world)continue;
            if(!params.has(row.world_id))params.set(row.world_id,playerParamsOf(world));
            if(!row.body_digest){const ref=await putBody(world,row.provenance?.saved_at??null);delete row.world;Object.assign(row,ref);await tx.table('snapshots').put(row);}
            else{const previous=await bodies.get(row.body_digest);if(!previous){const body=stripPlayerParams(world);await bodies.add({digest:row.body_digest,body,bytes:canonical(body).length,created_at:new Date().toISOString()});}else{const check=verifyBody(row.body_digest,previous.body);if(!check.ok)fail(check.reason);}}
        }
        for(const row of saved){
            const world=row.world;if(!world)continue;
            if(!params.has(row.world_id))params.set(row.world_id,playerParamsOf(world));
            if(!row.body_digest){const ref=await putBody(world,row.metadata?.at??row.metadata?.createdAt??null);delete row.world;Object.assign(row,ref);await tx.table('savedSnapshots').put(row);}
        }
        // ★操作行里的世界正文同样收敛：候选（`proposal`）与推演检查点（`checkpoints.prepared.world`）。
        //   候选这一格是**整份世界**（含当时参数，供审计），所以只把它换成引用、保留它的摘要身份。
        for(const row of await tx.table('operations').toArray()){
            let next={...row},touched=false;
            if(row.proposal&&typeof row.proposal==='object'&&!row.body_digest){
                const ref=await putBody(row.proposal,null);
                delete next.proposal;
                next={...next,body_digest:ref.body_digest,body_bytes:ref.body_bytes,round:ref.round};touched=true;
            }
            const packed=packWorldRefs(row.checkpoints);
            if(packed.changed){for(const body of packed.bodies)await putBody(body,null);next={...next,checkpoints:packed.value};touched=true;}
            if(touched)await tx.table('operations').put(next);
        }
        for(const [world_id,env] of params){
            const record=userParamsRecord(world_id,env);
            const previous=await tx.table('userParams').get(world_id);
            if(!previous)await tx.table('userParams').add(record);
            else if(!equal(previous.params??{},record.params))await tx.table('userParams').put({...previous,params:record.params});
        }
    });
    // ★2026-10-17（用户令）v4：**导入不再把整包备份抄进库**。
    //   原来 `inputs.bundle` 与 `original_bundle` 各存一份逐字节相同的整包（真账那条 57 MB），
    //   而它们唯一的用途只是"判重"与"抠恢复点名字"。这一步把已经存进去的整包收成指纹与计数：
    //   · 操作行：`inputs.bundle` 只留 {digest,format,version,encoding,payload_bytes}；`original_bundle` 整个撤掉；
    //   · 旧档桥的 provenance.original_bundle：只留指纹与结构（恢复点名字早就逐条落在"附带状态"的元数据里）。
    //   判重改用指纹（同一份文件重导 ⇒ 同一个 digest ⇒ 照旧复用，不建第二个世界）。
    db.version(4).stores({}).upgrade(async tx=>{
        const operations=tx.table('operations');
        for(const row of await operations.toArray()){
            let next=null;
            const bundle=row.inputs?.bundle;
            if(bundle&&typeof bundle==='object'&&Object.hasOwn(bundle,'payload')){
                const ref={digest:bundle.digest??sha256Hex(bundle.payload??''),format:bundle.format??null,version:bundle.version??null,encoding:bundle.encoding??null,payload_bytes:typeof bundle.payload==='string'?bundle.payload.length:0};
                next={...row,inputs:{...row.inputs,bundle:ref}};
            }
            if(Object.hasOwn(row,'original_bundle')){
                const stripped={...(next??row)};delete stripped.original_bundle;
                if(!stripped.import_summary&&row.original_bundle)stripped.import_summary={partitions:null,snapshots:null,saved_snapshots:null,recovery_points:null,branches:null};
                next=stripped;
            }
            if(next)await operations.put(next);
        }
        const snapshots=tx.table('snapshots'),saved=tx.table('savedSnapshots');
        for(const table of [snapshots,saved]){
            for(const row of await table.toArray()){
                let touched=false;
                for(let p=row.provenance;p&&typeof p==='object';p=p.original){
                    const original=p.original_bundle;if(!original||typeof original!=='object'||!Object.hasOwn(original,'payload'))continue;
                    const stripped={...original};delete stripped.payload;
                    if(typeof original.payload==='string')stripped.payload_bytes=original.payload.length;
                    stripped.digest=original.digest??sha256Hex(original.payload??'');
                    p.original_bundle=stripped;touched=true;
                }
                if(touched)await table.put(row);
            }
        }
    });
    db.version(5).stores({...RECORD_STORES,recordConversions:'[world_id+branch_id+revision]'});
    }
    const records=createWorldRecordStore(db),candidates=createRecordCandidates(db),recordTables=[...records.tables,db.recordConversions];
    async function readRawBody(digest,label){
        const row=await db.worldBodies.get(digest);
        if(!row)fail((label??'世界正文')+'引用缺失：'+String(digest).slice(0,12)+'…',404);
        const check=verifyBody(digest,row.body);if(!check.ok)fail(check.reason);
        return row.body;
    }
    async function readBody(digest,label){
        const raw=await readRawBody(digest,label);
        return isRecordWorld(raw)?records.readWorld(raw):isRecordCandidate(raw)?candidates.read(raw):raw;
    }
    async function writeCandidate(world){
        const value=await candidates.pack(stripPlayerParams(world));await writeBody(value);return value;
    }
    async function recordDescriptor(pointer){
        const row=await db.snapshots.get([...scope(pointer),revision(pointer.revision)]);if(!row)fail('World snapshot missing',404);
        const raw=isRefRow(row)?await readRawBody(row.body_digest):inlineBodyOf(row);
        if(isRecordWorld(raw))return raw;
        const converted=await db.recordConversions.get([...scope(pointer),pointer.revision]);
        if(converted){if(converted.source_digest!==row.digest)fail('Converted snapshot identity changed');return converted.descriptor;}
        // Old snapshots remain immutable. Each successful conversion is a resumable sidecar.
        const history=(await branchRows(db.snapshots,pointer)).filter(s=>s.revision<=pointer.revision).sort((a,b)=>a.revision-b.revision);
        let previous=null;const evidence=new Map();
        for(const old of history){
            const existing=await db.recordConversions.get([...scope(pointer),old.revision]);
            const value=isRefRow(old)?await readRawBody(old.body_digest):inlineBodyOf(old);
            if(isRecordWorld(value)||existing){previous=isRecordWorld(value)?value:existing.descriptor;for(const row of await records.getRecords(previous.pointer))if(row.record_kind==='event'){const event={...row};delete event.record_kind;evidence.set(event.id,event);}continue;}
            const world=isRecordCandidate(value)?await candidates.read(value):value;
            for(const event of world.events??[])if(event?.id)evidence.set(event.id,detached(event));
            const archived=(world.milestones??[]).flatMap(m=>m.rows??[]).filter(r=>r?.id).map(row=>({...evidence.get(row.id),...row}));
            const p={world_id:pointer.world_id,branch_id:pointer.branch_id,revision:old.revision};
            previous=await db.transaction('rw',...recordTables,async()=>{
                const descriptor=await records.putVersion(p,world,{previous,operation:{kind:'legacy-conversion',operation_id:old.provenance?.operation_id??null,at:old.at??null},eventEvidence:archived});
                await db.recordConversions.put({...p,source_digest:old.digest,descriptor});return descriptor;
            });
        }
        return previous;
    }
    async function archiveEvidence(world,previous=null){
        const before=new Map((previous?.core?.milestones??[]).flatMap(m=>m.rows??[]).map(row=>[row.id,row]));
        const changed=(world.milestones??[]).flatMap(m=>m.rows??[]).filter(row=>!equal(before.get(row.id),row));
        if(!previous)return changed;
        const originals=new Map((await records.getRecords(previous.pointer,changed.map(r=>r.id))).map(row=>[row.id,row]));
        return changed.map(row=>{const old=originals.get(row.id),out={...old,...row};delete out.record_kind;return out;});
    }
    async function writeBody(world){
        const body=stripPlayerParams(world),digest=bodyDigestOf(body),previous=await db.worldBodies.get(digest);
        if(previous){const check=verifyBody(digest,previous.body);if(!check.ok)fail(check.reason);return digest;}
        await db.worldBodies.add({digest,body,bytes:canonical(body).length,created_at:new Date().toISOString()});
        return digest;
    }
    async function paramsOf(world_id){
        const row=await db.userParams.get(world_id);
        return row?.params??{};
    }
    /** 保存这个世界的玩家参数（值没变就不写，绝不空写一次）。
     *  ★★空表是"不改参数"，不是"把参数清光"：回快照、导入旧包这些路径拿到的是**剥掉参数**的正文，
     *    若允许空表覆盖，就会把玩家此刻的参数悄悄抹掉（用户令：回快照不回参数）。
     *    真要清空某一格，走 `param-store` 的墓碑语义（"玩家删过它"）——那条路会给出**非空**的表。 */
    async function saveParams(world_id,env){
        const record=userParamsRecord(world_id,env),previous=await db.userParams.get(world_id);
        if(!Object.keys(record.params).length&&(previous?.params&&Object.keys(previous.params).length))return 0;
        if(!previous)return db.userParams.add(record);
        if(equal(previous.params??{},record.params))return 0;
        return db.userParams.put({...previous,params:record.params});
    }
    /** 读取世界：库里是"剥掉参数的正文"，这里按 world_id 把参数合回去（完整世界）。 */
    async function worldOf(row){
        if(isRefRow(row))return hydratePlayerParams(await readBody(row.body_digest),await paramsOf(row.world_id));
        const inline=inlineBodyOf(row);
        if(inline)return hydratePlayerParams(inline,await paramsOf(row.world_id));
        fail('World snapshot missing',404);
    }
    // ★推演检查点里的世界副本（`prepared.world`）也是同一份世界正文：写的时候换成引用、读的时候换回来。
    //   为什么要做（用户本轮"三处都做"）：真账里 16 行 `prepared.world` ≈ 3.7 MB，与保存点里那份是同一个世界。
    //   形状纪律：**只换 `world` 这一格**，检查点里别的键（packed 的提示包、recall 的检索结果）原样不动。
    async function packWorld(value){
        const packed=packWorldRefs(detached(value));
        const mapping=new Map();
        await db.transaction('rw',...recordTables,db.worldBodies,async()=>{for(const body of packed.bodies){
            const value=await writeCandidate(body);mapping.set(bodyDigestOf(stripPlayerParams(body)),bodyDigestOf(value));
        }});
        function remap(value){if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(remap);if(typeof value[BODY_REF_KEY]==='string')return {[BODY_REF_KEY]:mapping.get(value[BODY_REF_KEY])??value[BODY_REF_KEY]};return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));}
        return remap(packed.value);
    }
    async function unpackWorld(value,world_id){
        const found=[...JSON.stringify(value??null).matchAll(/"__sw2_body_ref":"([0-9a-f]{64})"/g)].map(match=>match[1]);
        if(!found.length)return value;
        const params=world_id?await paramsOf(world_id):{};
        const bodies=new Map();
        for(const digest of new Set(found))bodies.set(digest,hydratePlayerParams(await readBody(digest,'推演检查点世界'),params));
        return unpackWorldRefs(value,digest=>bodies.get(digest));
    }
    function savedSnapshot(world_id,row){
        id(world_id,'world_id');id(row?.snapshot_id,'snapshot_id');
        const world=detached(row.world);if(!world||typeof world!=='object'||Array.isArray(world))fail('Saved snapshot world invalid',400);
        const body=stripPlayerParams(world),ref=bodyRefOf(body,{round:rowRound(world),at:row.metadata?.at??row.metadata?.createdAt??null});
        // 摘要与保存点同一口径：**剥掉玩家参数的世界正文**的摘要（旧包按整份世界算的那种在导入校验里另行兼容）。
        const copy=detached(row);delete copy.world;return {...copy,world_id,body_digest:ref.body_digest,body_bytes:ref.body_bytes,round:ref.round,at:ref.at,digest:ref.body_digest};
    }
    async function saveSnapshots(world_id,rows){
        if(!Array.isArray(rows))fail('Saved snapshots must be an array',400);
        const bodies=rows.map(r=>stripPlayerParams(detached(r.world)));
        const copies=rows.map(r=>savedSnapshot(world_id,r));
        return db.transaction('rw',...recordTables,db.savedSnapshots,db.worldBodies,db.userParams,async()=>{
            for(const [index,row] of copies.entries()){
                const previous=await db.savedSnapshots.get([world_id,row.snapshot_id]);
                if(previous){
                    // 同一份附带状态重复导入：正文必须逐字节相同，否则明确拒绝（绝不覆盖别人的状态）。
                    const previousBody=isRefRow(previous)?await readBody(previous.body_digest):inlineBodyOf(previous);
                    if(!previousBody||!equal(previousBody,bodies[index]))fail('Immutable saved snapshot conflict');
                    continue;
                }
                const descriptor=await writeCandidate(bodies[index]),ref=bodyRefOf(descriptor,{round:row.round,at:row.at});
                await db.savedSnapshots.add({...row,...ref,digest:ref.body_digest});
            }
            return copies.length;
        });
    }
    async function getSavedSnapshot(world_id,snapshot_id){id(world_id,'world_id');id(snapshot_id,'snapshot_id');const row=await db.savedSnapshots.get([world_id,snapshot_id]);if(!row)fail('Saved snapshot missing',404);return detached({...row,world:await worldOf(row)});}
    let snapshotListCache=null;
    async function listSnapshotMetadata(pointer){
        scope(pointer);
        const key=canonical(scope(pointer)),heads=await db.heads.where('world_id').equals(pointer.world_id).toArray();
        const otherHeads=canonical(heads.filter(r=>r.branch_id!==pointer.branch_id).sort((a,b)=>a.branch_id<b.branch_id?-1:a.branch_id>b.branch_id?1:0));
        const savedCount=await db.savedSnapshots.where('world_id').equals(pointer.world_id).count();
        const prior=snapshotListCache,valid=prior?.key===key&&prior.otherHeads===otherHeads&&prior.savedCount===savedCount;
        const order=(a,b)=>Number(a.imported)-Number(b.imported)||(b.tick??-1)-(a.tick??-1)||(b.formal_revision??-1)-(a.formal_revision??-1);
        const distinct=rows=>{const seen=new Set();return rows.filter(row=>{if(seen.has(row.content))return false;seen.add(row.content);return true})};
        const contentAliases=new Map();
        async function formal(r){
            const content=(await db.recordCommits.get([r.world_id,r.branch_id,r.revision]))?.content_digest??contentAliases.get(r.digest)??r.digest;
            return {content,digest:r.digest,snapshot_id:canonical(['journal',r.branch_id,r.revision]),formal_revision:r.revision,tick:r.round??null,current:false,at:r.at??r.provenance?.saved_at??null,imported:r.branch_id!==pointer.branch_id};
        }
        let background,current;
        if(valid&&prior.revision===pointer.revision){background=prior.background;current=prior.current;}
        else if(valid&&Number.isSafeInteger(pointer.revision)&&pointer.revision===prior.revision+1){
            const row=await db.snapshots.get([...scope(pointer),pointer.revision]);
            if(row){current=await formal(row);background=distinct([...prior.background,current].sort(order)).slice(0,RETAIN_STEPS+1);}
        }
        if(!background){
            // Conversion metadata bridges old whole-body hashes and new record-content hashes.
            // This map lives only during the cold list build; routine refresh keeps the bounded cache.
            for(const row of await db.recordConversions.filter(r=>r.world_id===pointer.world_id).toArray()){
                const commit=await db.recordCommits.get([row.world_id,row.branch_id,row.revision]);if(commit?.content_digest)contentAliases.set(row.source_digest,commit.content_digest);
            }
            const currentRow=await db.snapshots.get([...scope(pointer),pointer.revision]);
            if(currentRow&&!currentRow.record_store&&!contentAliases.has(currentRow.digest)){
                // Only the selected old state needs a content identity; do not expand old history.
                const world=await worldOf(currentRow),core=stripPlayerParams(world),tables={};
                for(const [table,kind]of Object.entries({entities:'entity',agendas:'agenda',events:'event',conditions:'condition',relations:'relation',chronicle:'chronicle'})){
                    if(!Array.isArray(core[table])||!core[table].every(r=>r&&typeof r==='object'&&!Array.isArray(r)&&typeof r.id==='string'&&r.id)||new Set(core[table].map(r=>r.id)).size!==core[table].length)continue;
                    tables[table]=core[table].map(row=>{const {payload,state}=splitRecord(row,kind);return {id:row.id,payload_digest:sha256Hex(canonical(payload)),state_digest:sha256Hex(canonical(state))};});delete core[table];
                }
                contentAliases.set(currentRow.digest,bodyDigestOf({$sw2RecordCandidate:1,core,tables}));
            }
            const list=[];
            for(const r of await db.snapshots.where('world_id').equals(pointer.world_id).toArray()){
                if(r.branch_id===pointer.branch_id&&r.revision>pointer.revision)continue;
                const row=await formal(r);list.push(row);if(r.branch_id===pointer.branch_id&&r.revision===pointer.revision)current=row;
            }
            await db.savedSnapshots.where('world_id').equals(pointer.world_id).each(r=>list.push({content:contentAliases.get(r.body_digest??r.digest)??r.body_digest??r.digest,digest:r.digest,snapshot_id:canonical(['saved',r.snapshot_id]),tick:r.round??null,current:false,at:r.at??r.metadata?.at??r.metadata?.createdAt??null,label:r.metadata?.id??null,imported:true}));
            // Keep one spare background entry because the current state is always displayed first.
            background=distinct(list.sort(order)).slice(0,RETAIN_STEPS+1);
        }
        if(snapshotListCache?.key!==key||snapshotListCache.revision<=pointer.revision)
            snapshotListCache={key,revision:pointer.revision,otherHeads,savedCount,background,current};
        return distinct([...(current?[{...current,current:true}]:[]),...background]).slice(0,RETAIN_STEPS).map(({content,...row})=>detached(row));
    }
    async function readSnapshot(pointer,key){
        scope(pointer);if(Number.isSafeInteger(key)&&key>=0)return getWorld(pointer,{revision:key});
        let source;try{source=JSON.parse(key)}catch{fail('Snapshot identity invalid',400)}
        if(!Array.isArray(source))fail('Snapshot identity invalid',400);
        if(source[0]==='saved'&&source.length===2)return getSavedSnapshot(pointer.world_id,source[1]);
        if(source[0]==='journal'&&source.length===3){if(source[1]===pointer.branch_id&&source[2]>pointer.revision)fail('Future snapshot unavailable',400);return getWorld({world_id:pointer.world_id,branch_id:source[1]},{revision:source[2]});}
        fail('Snapshot identity invalid',400);
    }
    const branchRows=(table,pointer)=>table.where('[world_id+branch_id]').equals(scope(pointer)).toArray();
    async function operation(pointer,operation_id){scope(pointer);id(operation_id,'operation_id');const row=await db.operations.get(operation_id);if(!row||row.world_id!==pointer.world_id||row.branch_id!==pointer.branch_id)fail('Operation missing for pointer',404);return row;}
    async function mutate(pointer,operation_id,change){return db.transaction('rw',...recordTables,db.operations,async()=>{const row=await operation(pointer,operation_id);await change(row);await db.operations.put(detached(row));return detached(row);});}
    async function initialize(pointer,world,{provenance=null}={}){
        let value=snapshot({world_id:pointer?.world_id,branch_id:pointer?.branch_id,revision:pointer?.revision},world,{saved_at:new Date().toISOString(),...provenance});
        return db.transaction('rw',...recordTables,db.heads,db.snapshots,db.indexJobs,db.worldBodies,db.userParams,async()=>{
            const head=await db.heads.get(scope(pointer));
            if(head){const old=await db.snapshots.get([...scope(pointer),value.revision]);if(!old)fail('Branch exists with immutable snapshot conflict');const oldWorld=await worldOf(old);if(!equal(oldWorld,detached(world)))fail('Branch exists with immutable snapshot conflict');return envelope({...old,world:oldWorld});}
            const descriptor=await records.putVersion(pointer,stripPlayerParams(world),{operation:{kind:'initialize',at:value.at},eventEvidence:(world.milestones??[]).flatMap(m=>m.rows??[])});
            value={...snapshot(pointer,descriptor,value.provenance),round:rowRound(world),record_store:1};
            await writeBody(descriptor);await saveParams(pointer.world_id,playerParamsOf(world));
            await db.snapshots.add(value);await db.heads.add({...pointer,base_revision:pointer.revision});await db.indexJobs.add(job(value));return envelope({...value,world:detached(world)});
        });
    }
    async function getWorld(pointer,{revision:requested=null}={}){
        const partition=scope(pointer);let number=requested;
        if(number===null){const head=await db.heads.get(partition);if(!head)fail('World head missing',404);number=head.revision;}
        revision(number);const row=await db.snapshots.get([...partition,number]);if(!row)fail('World snapshot missing',404);return envelope({...row,world:await worldOf(row)});
    }
    async function getWorkingWorld(pointer,{revision:requested=null,referenceIds=[],stateOnly=false}={}){
        scope(pointer);let number=requested;
        if(number===null){const head=await db.heads.get(scope(pointer));if(!head)fail('World head missing',404);number=head.revision;}
        revision(number);const fixed={world_id:pointer.world_id,branch_id:pointer.branch_id,revision:number};
        const descriptor=await recordDescriptor(fixed),params=await paramsOf(pointer.world_id);
        const core=hydratePlayerParams(descriptor.core,params);
        const afterTick=Math.max(0,(core.meta?.tick??0)-resolveLimits(core).往事轮数+1);
        const view=await records.readWorkingWorld(descriptor,{afterTick,referenceIds,stateOnly});
        const hydrated=hydratePlayerParams(view.world,params),delta=JSON.stringify(hydrated).length-JSON.stringify(view.world).length;
        return {...envelope({...fixed,world:hydrated}),record_view:detached(view.partial),record_metrics:{...view.metrics,world_bytes:view.metrics?.world_bytes==null?null:view.metrics.world_bytes+delta,view_bytes:JSON.stringify(hydrated).length}};
    }
    async function getRecordChanges(pointer,{after_revision=-1}={}){
        scope(pointer);revision(pointer.revision);if(!Number.isSafeInteger(after_revision)||after_revision< -1||after_revision>pointer.revision)fail('Invalid change range',400);
        const selected=await recordDescriptor(pointer),changes=await records.getChanges(pointer,{after_revision});
        const source=core=>({sourcePublication:core.sourcePublication??null,sourceInitialization:core.sourceInitialization??null,source:core.source??null,canon:core.context?.setting?.frozen?.canon??null,
            meta:{sourcePublication:core.meta?.sourcePublication??null,sourceInitialization:core.meta?.sourceInitialization??null,sourceEdits:core.meta?.sourceEdits??null}});
        const previous=after_revision<0?null:await recordDescriptor({...pointer,revision:after_revision});
        return detached({world_id:pointer.world_id,branch_id:pointer.branch_id,revision:pointer.revision,range:{after_revision,through_revision:pointer.revision},changes,source_changed:!previous||!equal(source(previous.core),source(selected.core))});
    }
    async function getRecordsAtPositions(pointer,positions){
        scope(pointer);revision(pointer.revision);if(!Array.isArray(positions)||positions.some(p=>typeof p!=='string'))fail('Invalid record positions',400);
        await recordDescriptor(pointer);return detached(await records.recordsAtPositions(pointer,positions));
    }
    async function startOperation(pointer,input){
        scope(pointer);const inputs=detached(input);id(inputs.operation_id,'operation_id');revision(inputs.expected_revision);
        for(const key of ['world_id','branch_id'])if(Object.hasOwn(inputs,key)&&inputs[key]!==pointer[key])fail('Operation pointer scope conflict',400);
        return db.transaction('rw',...recordTables,db.heads,db.operations,async()=>{
            const previous=await db.operations.get(inputs.operation_id);
            if(previous){if(previous.world_id!==pointer.world_id||previous.branch_id!==pointer.branch_id||!equal(previous.inputs,inputs))fail('Immutable operation input conflict');return detached(previous);}
            const head=await db.heads.get(scope(pointer));if(!head)fail('World head missing',404);if(head.revision!==inputs.expected_revision)fail('Stale expected revision');
            const pending=(await db.operations.where('status').anyOf(inputs.kind==='field-schema'?['started','proposed','failed']:['started','proposed']).toArray())
                .filter(row=>row.world_id===pointer.world_id&&row.branch_id===pointer.branch_id&&row.expected_revision===head.revision&&!['committed','cancelled'].includes(row.status)&&!isConfirmedFailedOperation(row));
            if(pending.some(row=>row.inputs?.kind==='field-schema')||inputs.kind==='field-schema'&&pending.length)
                fail('当前版本仍有未决任务，字段定义与任务权限不能并发改写');
            const row={operation_id:inputs.operation_id,world_id:pointer.world_id,branch_id:pointer.branch_id,expected_revision:inputs.expected_revision,inputs,status:'started',phase:'queued',checkpoints:{},call:null,proposal:null,receipt:null,errors:[],allow_limited:false};await db.operations.add(row);return detached(row);
        });
    }
    async function checkpoint(pointer,operation_id,key,value){id(key,'checkpoint key');const copy=await packWorld(detached(value));return mutate(pointer,operation_id,row=>{if(Object.hasOwn(row.checkpoints,key)){if(!equal(row.checkpoints[key],copy))fail('Immutable checkpoint conflict');return;}active(row);Object.defineProperty(row.checkpoints,key,{value:copy,enumerable:true,writable:true,configurable:true});});}
    async function setPhase(pointer,operation_id,phase){id(phase,'phase');return mutate(pointer,operation_id,row=>{active(row);row.phase=phase;});}
    // 请求真正发到厂商的那一刻落一个标记：只有落在盘上，才允许把“没等到回话”当成结果未明。
    // 没落上（被浏览器拦下、地址不通、通道没配）就是一定没生成，可按确认失败收尾并恢复按钮。
    async function markModelPosted(pointer,operation_id){return mutate(pointer,operation_id,row=>{active(row);if(row.call?.outcome!=='requested')fail('Model request can only be posted once per requested call');Object.defineProperty(row.checkpoints,'model-request-posted',{value:true,enumerable:true,writable:true,configurable:true});});}
    async function claimModel(pointer,operation_id,{provider=null,model=null,request_id=null}={}){
        const details=detached({provider,model,request_id});for(const [key,value]of Object.entries(details))if(value!==null)id(value,key);
        return db.transaction('rw',...recordTables,db.operations,async()=>{const row=await operation(pointer,operation_id);if(terminal(row)||row.call!==null)return false;row.call={outcome:'requested',...details,response:null,usage:null};await db.operations.put(row);return true;});
    }
    async function saveResponse(pointer,operation_id,{response,usage=null,unconfirmed=false,provider_response=null,failure=null}={}){
        const raw=detached(response),tokens=detached(usage);
        const partial=unconfirmed?detached({response:raw,usage:tokens,provider_response,failure}):null;
        return mutate(pointer,operation_id,row=>{
            if(unconfirmed && Object.hasOwn(row.checkpoints,'unconfirmed-model-response')){
                if(!equal(row.checkpoints['unconfirmed-model-response'],partial))fail('Immutable model response conflict');return;
            }
            if(row.call?.outcome==='received'){
                if(unconfirmed||!equal(row.call.response,raw)||!equal(row.call.usage,tokens))fail('Immutable model response conflict');return;
            }
            if(row.status==='committed')fail('Operation is terminal: committed');
            if(row.call?.outcome!=='requested')fail('Model response requires requested call');
            // Keep interrupted wire data complete without turning it into a confirmed response.
            // The backup contract requires call.response to remain null for unknown outcomes.
            if(unconfirmed){
                row.checkpoints['unconfirmed-model-response']=partial;
                row.call={...row.call,outcome:'unknown',usage:tokens};
                row.errors.push({stage:'model',...errorDetails(failure??'模型响应尚未确认')});
            }else{
                row.call={...row.call,outcome:'received',response:raw,usage:tokens};
                row.checkpoints['model-response-confirmed']=true;
            }
        });
    }
    async function markModelUnknown(pointer,operation_id,error){const details=errorDetails(error);return mutate(pointer,operation_id,row=>{if(row.call?.outcome!=='requested')fail('Model unknown requires requested call');row.call.outcome='unknown';row.errors.push({stage:'model',...details});});}
    async function failOperation(pointer,operation_id,{stage,message,callFailure=false,usage=null}={}){id(stage,'stage');if(typeof message!=='string')fail('Invalid error message',400);const tokens=detached(usage);return mutate(pointer,operation_id,row=>{active(row);row.errors.push({stage,message,callFailure:!!callFailure,usage:tokens});row.status='failed';row.phase='failed';if(callFailure&&row.call?.outcome==='requested')row.call.outcome='unknown';if(tokens!==null&&row.call&&row.call.outcome!=='received')row.call.usage=tokens;});}
    async function resumeOperation(pointer,operation_id){return mutate(pointer,operation_id,row=>{active(row);if(row.call&&row.call.outcome!=='received'||!isConfirmedFailedOperation(row))fail('Only failed preparation or confirmed response can be reprocessed');row.status='started';row.phase=row.call?'settle':'queued';});}
    async function allowLimited(pointer,operation_id){return mutate(pointer,operation_id,row=>{active(row);row.allow_limited=true;});}
    async function saveProposal(pointer,operation_id,world,{partial=null}={}){validateRecordPartial(partial,world);const copy=detached(world);if(!copy||typeof copy!=='object'||Array.isArray(copy))fail('World must be a JSON plain object',400);
        const body=await db.transaction('rw',...recordTables,db.worldBodies,async()=>await writeCandidate(copy)),ref=bodyRefOf(body,{round:rowRound(copy)});
        // 正文先按内容落一份（幂等：同一份正文重复写不会多占空间），行里只记引用。
        await db.transaction('rw',...recordTables,db.worldBodies,async()=>{await writeBody(body);});
        return mutate(pointer,operation_id,row=>{
            const same=isRefRow(row)?row.body_digest===ref.body_digest:row.proposal!==null&&equal(row.proposal,copy);
            if(same&&!equal(row.record_partial??null,partial))fail('Immutable candidate partial conflict');
            if(same){if(row.status==='cancelled')fail('Operation is terminal: cancelled');return;}
            if(isRefRow(row)||row.proposal!==null)fail('Immutable candidate conflict');
            active(row);row.body_digest=ref.body_digest;row.body_bytes=ref.body_bytes;row.round=ref.round;row.record_partial=detached(partial);row.status='proposed';row.phase='proposed';
        });}
    async function commitOperation(pointer,operation_id){
        const prepared=await operationFor(pointer,operation_id);if(prepared.status==='committed')return detached(prepared);active(prepared);if(prepared.status!=='proposed'||prepared.proposal===null)fail('Commit requires proposed operation');
        const nextRevision=revision(prepared.expected_revision+1);let value=snapshot({world_id:pointer.world_id,branch_id:pointer.branch_id,revision:nextRevision},prepared.proposal,{operation_id,saved_at:new Date().toISOString()});
        return db.transaction('rw',...recordTables,db.operations,db.heads,db.snapshots,db.indexJobs,db.worldBodies,db.userParams,async()=>{
            const row=await operation(pointer,operation_id);if(row.status==='committed')return detached(row);active(row);if(row.status!=='proposed')fail('Operation changed before commit');
            const head=await db.heads.get(scope(pointer));if(!head||head.revision!==row.expected_revision)fail('Stale expected revision at commit');
            const proposed=await readBody(row.body_digest);
            if(!equal(proposed,stripPlayerParams(prepared.proposal)))fail('Operation changed before commit');
            const previous=await recordDescriptor({...pointer,revision:row.expected_revision}),next={world_id:pointer.world_id,branch_id:pointer.branch_id,revision:nextRevision};
            const descriptor=await records.putVersion(next,stripPlayerParams(prepared.proposal),{previous,partial:row.record_partial??null,operation:{operation_id,kind:row.inputs?.kind??'turn',at:value.at},eventEvidence:await archiveEvidence(prepared.proposal,previous)});
            value={...snapshot(next,descriptor,value.provenance),round:rowRound(prepared.proposal),record_store:1};
            await writeBody(descriptor);await saveParams(pointer.world_id,playerParamsOf(prepared.proposal));
            await db.snapshots.add(value);await db.heads.put({...head,revision:nextRevision});await db.indexJobs.add(job(value));row.status='committed';row.phase='committed';row.receipt={operation_id,world_id:pointer.world_id,branch_id:pointer.branch_id,revision:nextRevision};await db.operations.put(row);return detached(row);
        });
    }
    async function cancelOperation(pointer,operation_id){return mutate(pointer,operation_id,row=>{if(terminal(row))return;row.status='cancelled';row.phase='cancelled';});}
    async function restoreBranch(pointer,{operation_id,source_revision,target_branch}){
        scope(pointer);id(operation_id,'operation_id');revision(source_revision);id(target_branch,'target_branch');const inputs=detached({operation_id,source_revision,target_branch});
        const source=await getWorld(pointer,{revision:source_revision}),history=(await branchRows(db.snapshots,pointer)).filter(s=>s.revision<=source_revision).sort((a,b)=>a.revision-b.revision);
        const copies=[];
        for(const s of history){
            const body=isRefRow(s)?await readBody(s.body_digest):inlineBodyOf(s);
            if(!body)fail('World snapshot missing',404);
            const ref=bodyRefOf(body,{round:s.round??rowRound(body),at:s.at??null});
            const sourceDescriptor=await recordDescriptor({world_id:pointer.world_id,branch_id:pointer.branch_id,revision:s.revision});
            const evidence=(await records.getRecords(sourceDescriptor.pointer)).filter(r=>r.record_kind==='event').map(r=>{const row={...r};delete row.record_kind;return row;});
            copies.push({...s,eventEvidence:evidence,world:body,branch_id:target_branch,body_digest:ref.body_digest,body_bytes:ref.body_bytes,round:ref.round,at:ref.at,provenance:{original:s.provenance,restored_from:{world_id:pointer.world_id,branch_id:pointer.branch_id,revision:s.revision},operation_id}});
        }
        return db.transaction('rw',...recordTables,db.operations,db.heads,db.snapshots,db.indexJobs,db.worldBodies,db.userParams,async()=>{
            const previous=await db.operations.get(operation_id);if(previous){if(previous.kind!=='restore'||previous.world_id!==pointer.world_id||previous.branch_id!==pointer.branch_id||!equal(previous.inputs,inputs))fail('Immutable restore operation conflict');return detached(previous.receipt);}
            const target=[pointer.world_id,target_branch];if(await db.heads.get(target))fail('Target branch exists; cannot overwrite');
            const check=await db.snapshots.get([...scope(pointer),source_revision]);if(!check)fail('Source snapshot changed');const checkWorld=await worldOf(check);if(!equal(checkWorld,source.world))fail('Source snapshot changed');
            let priorDescriptor=null;
            for(const copy of copies){const world=copy.world,p={world_id:pointer.world_id,branch_id:target_branch,revision:copy.revision};
                const descriptor=await records.putVersion(p,world,{previous:priorDescriptor,operation:{kind:'restore',operation_id,at:copy.at??null},eventEvidence:copy.eventEvidence??await archiveEvidence(world,priorDescriptor)});
                await writeBody(descriptor);delete copy.world;delete copy.eventEvidence;Object.assign(copy,{...snapshot(p,descriptor,copy.provenance),round:copy.round??rowRound(world),at:copy.at??null,record_store:1});priorDescriptor=descriptor;
            }
            await db.snapshots.bulkAdd(copies);await db.indexJobs.bulkAdd(copies.map(job));await db.heads.add({world_id:pointer.world_id,branch_id:target_branch,revision:source_revision,base_revision:copies[0].revision});
            const receipt={operation_id,world_id:pointer.world_id,branch_id:target_branch,revision:source_revision};await db.operations.add({operation_id,world_id:pointer.world_id,branch_id:pointer.branch_id,kind:'restore',inputs,status:'committed',phase:'committed',expected_revision:source_revision,receipt});return detached(receipt);
        });
    }
    async function listIndexTasks(pointer=null){if(pointer)scope(pointer);const rows=await db.indexJobs.where('status').anyOf('queued','failed','running','unknown').toArray();return detached(rows.filter(r=>!pointer||r.world_id===pointer.world_id&&r.branch_id===pointer.branch_id));}
    async function indexTask(pointer){scope(pointer);revision(pointer.revision);const row=await db.indexJobs.get([...scope(pointer),pointer.revision]);if(!row)fail('Persisted index job missing for identity',404);return row;}
    async function beginIndexMaintenance(pointer,{embeddingIdentity,runId}){
        id(embeddingIdentity,'embedding identity');id(runId,'maintenance run');
        return db.transaction('rw',...recordTables,db.indexJobs,async()=>{const row=await indexTask(pointer);row.embedding_identity=embeddingIdentity;row.run_id=runId;row.status='running';row.error=null;await db.indexJobs.put(row);return detached(row);});
    }
    // Claims live in the existing version jobs. Looking at request metadata across jobs
    // prevents a new current version from paying again for a hash whose outcome is unknown.
    async function reserveIndexVectors(pointer,{embeddingIdentity,requestId,hashes}){
        id(embeddingIdentity,'embedding identity');id(requestId,'vector request');if(!Array.isArray(hashes))fail('Invalid vector hashes',400);for(const hash of hashes)id(hash,'vector hash');
        return db.transaction('rw',...recordTables,db.indexJobs,db.vectors,async()=>{
            const row=await indexTask(pointer),blocked=new Set(),cached=new Set();
            // Another journal may have saved this hash since the caller's cache
            // read. Check the cache under the same lock as the request claim.
            for(const hash of new Set(hashes))if(await db.vectors.get([embeddingIdentity,hash]))cached.add(hash);
            for(const task of await db.indexJobs.toArray()){
                let changed=false;const requests=task.vector_requests?.[embeddingIdentity]??{};
                for(const [hash,item]of Object.entries(requests))if(item.status==='reserved'&&hashes.includes(hash)){delete requests[hash];changed=true;}else if(item.status!=='reserved')blocked.add(hash);
                if(changed){await db.indexJobs.put(task);if(task.world_id===row.world_id&&task.branch_id===row.branch_id&&task.revision===row.revision)row.vector_requests=task.vector_requests;}
            }
            const allowed=[...new Set(hashes)].filter(hash=>!cached.has(hash)&&!blocked.has(hash));
            row.vector_requests??={};row.vector_requests[embeddingIdentity]??={};
            for(const hash of allowed)Object.defineProperty(row.vector_requests[embeddingIdentity],hash,{value:{request_id:requestId,status:'reserved'},writable:true,enumerable:true,configurable:true});
            await db.indexJobs.put(row);return {allowed,cached:[...cached],blocked:hashes.filter(hash=>!cached.has(hash)&&blocked.has(hash))};
        });
    }
    async function settleIndexVectors(pointer,{embeddingIdentity,requestId,hashes,status}){
        if(!['reserved','posted','unknown','done','rejected','cancelled'].includes(status))fail('Invalid vector request status',400);
        return db.transaction('rw',...recordTables,db.indexJobs,async()=>{const row=await indexTask(pointer),requests=row.vector_requests?.[embeddingIdentity]??{},settled=[];
            for(const hash of hashes){const item=requests[hash];if(item?.request_id!==requestId)continue;settled.push(hash);if(['done','rejected'].includes(status)||(status==='cancelled'&&item.status==='reserved'))delete requests[hash];else item.status=status==='cancelled'?'unknown':status;}
            await db.indexJobs.put(row);return {settled};
        });
    }
    async function completeIndex(pointer,{identity,status='done',error=null,runId=null}={}){
        scope(pointer);id(identity,'identity');if(!['done','failed','unknown','cancelled'].includes(status))fail('Invalid index status',400);const details=detached(error);
        return db.transaction('rw',...recordTables,db.indexJobs,async()=>{const row=await indexTask(pointer);if(row.identity!==identity)fail('Persisted index job identity mismatch',409);if(runId!==null&&row.run_id!==runId)return detached(row);row.status=status;row.error=details;await db.indexJobs.put(row);return detached(row);});
    }

    async function getMovements(pointer,{after_revision=null}={}){
        scope(pointer);revision(pointer.revision);const descriptor=await recordDescriptor(pointer);
        const head=await db.heads.get(scope(pointer));if(!head)fail('World head missing',404);
        const base=head.base_revision??descriptor.pointer.revision,after=after_revision===null?base-1:revision(after_revision);
        if(after>pointer.revision)fail('动向版本范围无效',400);
        const start=Math.max(after,base-1),result=await records.getMovements(pointer,{after_revision:start});
        return detached({...result,range:{after_revision:start,through_revision:pointer.revision,base_revision:base}});
    }
    async function readChatCursor(chat_scope,pointer){
        id(chat_scope,'chat scope');scope(pointer);
        const row=await db.bindings.get(chat_scope),cursor=row?.chat_context_cursor;
        if(!cursor||cursor.world_id!==pointer.world_id||cursor.branch_id!==pointer.branch_id
            ||!Number.isSafeInteger(cursor.through_revision)||cursor.through_revision<0||cursor.through_revision>pointer.revision)return null;
        try{validateMessageReference(cursor.message_ref)}catch{return null;}
        return detached(cursor);
    }
    async function saveChatCursor(chat_scope,pointer,{through_revision,message_ref}={}){
        id(chat_scope,'chat scope');scope(pointer);revision(pointer.revision);revision(through_revision);validateMessageReference(message_ref);
        if(pointer.revision!==through_revision)fail('聊天游标版本不匹配',400);
        return db.transaction('rw',...recordTables,db.bindings,db.heads,db.snapshots,async()=>{
            const binding=await db.bindings.get(chat_scope),bound=binding?.state?.pointer;
            if(!bound||bound.world_id!==pointer.world_id||bound.branch_id!==pointer.branch_id)fail('聊天绑定或分支已改变');
            const head=await db.heads.get(scope(pointer)),snapshot=await db.snapshots.get([...scope(pointer),through_revision]);
            if(!head||head.revision<through_revision||!snapshot)fail('聊天世界版本不存在',404);
            const previous=binding.chat_context_cursor;
            if(previous?.world_id===pointer.world_id&&previous.branch_id===pointer.branch_id&&previous.through_revision>through_revision)return detached(previous);
            const cursor={world_id:pointer.world_id,branch_id:pointer.branch_id,through_revision,message_ref:detached(message_ref)};
            await db.bindings.put({...binding,chat_context_cursor:cursor});return detached(cursor);
        });
    }

    async function getRecords(pointer,ids=null,{lifecycleMetadata=true}={}){
        scope(pointer);revision(pointer.revision);if(ids!==null){if(!Array.isArray(ids))fail('Record IDs must be an array',400);for(const value of ids)id(value,'record id');}const descriptor=await recordDescriptor(pointer),world=descriptor.core,formal=await records.getRecords(pointer,ids),recordMap=new Map();
        const archived=new Set((world.milestones??[]).flatMap(m=>[...(m.ids??[]),...(m.rows??[]).map(r=>r.id)]));
        function add(row,kind,publication=false){if(lifecycleMetadata&&kind==='event'&&archived.has(row?.id))row={...row,archived:true,lifecycleKnown:row.closed===true,...(row.closed===true?{pending:false}:{})};if(!row||typeof row!=='object'||Array.isArray(row))fail('Invalid formal record',400);id(row.id,'record id');const previous=recordMap.get(row.id);if(previous){if(publication)return;if(previous.record_kind!==kind||!equal({...previous,record_kind:kind},{...row,record_kind:kind}))fail('Formal record ID collision: '+row.id);return;}recordMap.set(row.id,{...row,record_kind:kind});}
        for(const row of formal)add(row,row.record_kind);
        for(const milestone of world.milestones||[])for(const row of milestone.rows||[])!recordMap.has(row.id)&&add(row,'event');
        const history=world.history;if(Array.isArray(history)){for(const row of history)add(row,'event');}else if(history){for(const row of history.events||history.rows||[])add(row,'event');}
        if(ids!==null&&ids.every(value=>recordMap.has(value))){
            const effective=effectiveSourceRecords(world,[...recordMap.values()]),byId=new Map(effective.map(row=>[row.id,row]));
            return detached(ids.map(value=>byId.get(value)).filter(Boolean));
        }
        const publications=[],seenPublications=new Set();
        function collect(value){if(!value||typeof value!=='object')return;const key=canonical(value);if(seenPublications.has(key))return;seenPublications.add(key);publications.push(value);for(const update of value.updates||[])collect(update);}
        collect(world.sourcePublication);collect(world.meta?.sourcePublication);
        const initialized=world.meta?.sourceInitialization;
        if(initialized?.library_id&&Number.isSafeInteger(initialized.version))collect(await db.sourceVersions.get([initialized.library_id,initialized.version]));
        for(const publication of publications){
            if(isFinalizedPublication(publication)){for(const row of publication.records??[])if(row.record_kind==='location')add(row,'location',true);for(const row of finalizedEvidenceRecords(publication))add(row,row.record_kind,true);continue;}
            for(const row of publication.records||[])add(row,row.record_kind||row.kind||'entity',true);
            const omitted=new Set(publication.omitted_source_ids||[]);
            for(const source of publication.sources||[])if(!omitted.has(source.source_id)&&typeof source.content==='string'){
                // Exact adopted original, scoped to its immutable source version. This is evidence
                // for world reasoning; it is never a direct chat observation or an invented fact.
                const identity=[publication.library_id??null,publication.version??null,source.source_id,source.content_hash??sha256Hex(source.content)];
                add({...source,id:'source:'+sha256Hex(canonical(identity)),library_id:publication.library_id??null,version:publication.version??null},'source',true);
            }
        }
        const effective=effectiveSourceRecords(world,[...recordMap.values()]);
        if(ids!==null){if(!Array.isArray(ids))fail('Record IDs must be an array',400);for(const value of ids)id(value,'record id');const byId=new Map(effective.map(row=>[row.id,row]));return detached(ids.map(value=>byId.get(value)).filter(Boolean));}return detached(effective);
    }
    async function exportWorld(pointer,{compact=false}={}){
        scope(pointer);revision(pointer.revision);
        const data=await db.transaction('r',...sourceAuditTables,...recordTables,db.heads,db.snapshots,db.operations,db.sourceVersions,db.libraries,db.imports,db.savedSnapshots,db.worldBodies,db.userParams,async()=>{
            await getWorld(pointer,{revision:pointer.revision});const selectedHead=await db.heads.get(scope(pointer));if(!selectedHead)fail('World head missing',404);
            // A HEAD export snapshots the whole world (every branch as of export time). An explicit
            // older revision is a fixed historical export of that branch alone, so neither future
            // snapshots nor other branches can leak into the historical snapshot.
            const full=pointer.revision===selectedHead.revision,heads=full?await db.heads.where('world_id').equals(pointer.world_id).toArray():[selectedHead];
            const allOperations=await db.operations.toArray(),partitions=[];
            // 世界正文按摘要只搬一份（导出里也是"引用 + 一份正文"，不是每个快照复制一份）。
            const bodies=new Map();
            async function bodyOf(row){
                if(isRefRow(row)){if(!bodies.has(row.body_digest))bodies.set(row.body_digest,await readRawBody(row.body_digest));return readBody(row.body_digest);}
                const inline=inlineBodyOf(row);if(!inline)fail('World snapshot missing',404);return inline;
            }
            for(const head of heads){
                const boundary=full?head.revision:pointer.revision;
                const snapshots=(await branchRows(db.snapshots,head)).filter(s=>s.revision<=boundary).sort((a,b)=>a.revision-b.revision);
                const operations=allOperations.filter(o=>o.world_id===pointer.world_id&&(o.status==='committed'?o.receipt?.world_id===pointer.world_id&&o.receipt?.branch_id===head.branch_id&&o.receipt.revision<=boundary:o.branch_id===head.branch_id&&o.expected_revision<=boundary)).map(o=>o.world_id===pointer.world_id&&o.branch_id===head.branch_id?o:{...o,world_id:pointer.world_id,branch_id:head.branch_id,original:o});
                partitions.push({pointer:{world_id:pointer.world_id,branch_id:head.branch_id,revision:boundary},head:{...head,revision:boundary},snapshots,operations});
            }
            partitions.sort((a,b)=>a.pointer.branch_id<b.pointer.branch_id?-1:a.pointer.branch_id>b.pointer.branch_id?1:0);
            const selected=partitions.find(part=>part.pointer.world_id===pointer.world_id&&part.pointer.branch_id===pointer.branch_id&&part.pointer.revision===pointer.revision);if(!selected)fail('Selected branch partition missing');
            const savedSnapshots=full?await db.savedSnapshots.where('world_id').equals(pointer.world_id).toArray():[];
            // Preserve the source libraries and original imports required to interpret every historical snapshot.
            const libraryIds=new Set(),requiredVersions=new Set();
            function reference(value){walkSources(value,row=>{if(typeof row.library_id==='string'){libraryIds.add(row.library_id);if(Number.isSafeInteger(row.version))requiredVersions.add(canonical([row.library_id,row.version]));}});}
            for(const s of [...partitions.flatMap(part=>part.snapshots),...savedSnapshots]){const body=await bodyOf(s);reference(body.sourcePublication);reference(body.sourceInitialization);reference(body.meta?.sourcePublication);reference(body.meta?.sourceInitialization);reference(s.provenance);}
            // 操作行里的正文引用（候选 `body_digest`、检查点里的引用标记）也要随包带走。
            for(const part of partitions)for(const row of part.operations){
                if(isRefRow(row)&&!bodies.has(row.body_digest))bodies.set(row.body_digest,await readRawBody(row.body_digest));
                for(const digest of collectBodyRefs(row.checkpoints))if(!bodies.has(digest))bodies.set(digest,await readRawBody(digest,'推演检查点世界'));
            }
            const sourceVersions=(await db.sourceVersions.toArray()).filter(s=>requiredVersions.has(canonical([s.library_id,s.version])));
            const requiredImports=new Set(sourceVersions.filter(v=>v.import_id).map(v=>canonical([v.library_id,v.import_id])));
            const libraries=(await db.libraries.toArray()).filter(s=>libraryIds.has(s.library_id)).map(s=>({...s,version:Math.max(0,...sourceVersions.filter(v=>v.library_id===s.library_id).map(v=>v.version))}));
            let imports=(await db.imports.toArray()).filter(s=>requiredImports.has(canonical([s.library_id,s.import_id])));
            if(projectSourceImport)imports=await Promise.all(imports.map(row=>projectSourceImport(row)));
            const params=await paramsOf(pointer.world_id);
            // 包内正文按内容只留一份（与库里同一把尺子）：同一份世界不会在包里出现多次。
            const bundledBodies=new Map();
            for(const row of bodies.values()){const digest=bodyDigestOf(row);if(!bundledBodies.has(digest))bundledBodies.set(digest,row);}
            const scopes=new Map(),candidateDigests=new Set();
            for(const body of bodies.values()){
                if(isRecordWorld(body)){const p=body.pointer,k=canonical(scope(p));scopes.set(k,{...p,revision:Math.max(p.revision,scopes.get(k)?.revision??-1)});}
                if(isRecordCandidate(body))for(const refs of Object.values(body.tables))for(const r of refs){candidateDigests.add(r.payload_digest);candidateDigests.add(r.state_digest);}
            }
            const include=r=>{const p=scopes.get(canonical([r.world_id,r.branch_id]));return p&&r.revision<=p.revision;};
            const recordVersions=(await db.recordVersions.toArray()).filter(include),recordCommits=(await db.recordCommits.toArray()).filter(include),recordLogs=(await db.recordLogs.toArray()).filter(include);
            const digests=new Set([...candidateDigests,...recordVersions.filter(r=>!r.deleted).flatMap(r=>[r.payload_digest,r.state_digest])]);
            const recordBodies=(await db.recordBodies.bulkGet([...digests])).filter(Boolean);
            if(recordBodies.length!==digests.size)fail('Backup required record body missing');
            const recordStore={format:1,recordVersions,recordCommits,recordLogs,recordBodies};
            return {recordStore,pointer:selected.pointer,heads:[selected.head],snapshots:selected.snapshots,operations:selected.operations,partitions,sourceVersions,libraries,imports,userParams:detached(params),worldBodies:[...bundledBodies.values()],savedSnapshots};
        });
        const packed=compact||!!data.savedSnapshots?.length;const payload=packed?stringifyArchive(data):canonical(data);return {format:FORMAT,version:5,...(packed?{encoding:'flatted-v1'}:{}),payload,digest:sha256Hex(payload)};
    }
    function validateBackup(bundle){
        detached(bundle);if(bundle.format!==FORMAT||![1,2,3,4,5].includes(bundle.version)||typeof bundle.payload!=='string')fail('Invalid backup format',400);if(sha256Hex(bundle.payload)!==bundle.digest)fail('Backup digest mismatch',400);
        if(bundle.version===4&&bundle.encoding!=='flatted-v1'||bundle.version<4&&bundle.encoding!==undefined||bundle.version===5&&bundle.encoding!==undefined&&bundle.encoding!=='flatted-v1')fail('Invalid backup encoding',400);
        let data;try{data=readBrowserBackupPayload(bundle);}catch{fail('Invalid backup JSON',400);}detached(data);scope(data.pointer);revision(data.pointer.revision);
        for(const key of ['heads','snapshots','operations','sourceVersions','libraries','imports'])if(!Array.isArray(data[key]))fail('Invalid backup '+key,400);
        // 世界正文表（随包带；旧包没有这一格 ⇒ 走行内正文的兼容读法）。
        // 形状是**正文对象的数组**（每份只出现一次，身份由内容算出），不是行、也不是映射。
        if(data.worldBodies===undefined)data.worldBodies=[];
        if(!Array.isArray(data.worldBodies))fail('Invalid backup world bodies',400);
        const bodyMap=new Map();
        for(const entry of data.worldBodies){const digest=bodyDigestOf(entry);if(bodyMap.has(digest))fail('Duplicate backup world body',400);bodyMap.set(digest,entry);}
        // 一行的正文：优先按引用取（并在取不到时明确失败），旧包才回落到行内正文。
        const expand=value=>isRecordWorld(value)?expandRecordWorld(value,data.recordStore):isRecordCandidate(value)?expandRecordCandidate(value,data.recordStore?.recordBodies??[]):value;
        const bodyOfRow=row=>{
            if(isRefRow(row)){if(!bodyMap.has(row.body_digest))fail('Backup world body reference missing',400);return expand(bodyMap.get(row.body_digest));}
            const inline=inlineBodyOf(row);if(!inline)fail('Backup snapshot world missing',400);return inline;
        };
        if(bundle.version===5){
            if(data.recordStore?.format!==1||!['recordVersions','recordCommits','recordLogs','recordBodies'].every(k=>Array.isArray(data.recordStore[k])))fail('Invalid backup record store',400);
            const hashes=new Set();for(const body of data.recordStore.recordBodies){if(!body||typeof body.digest!=='string'||hashes.has(body.digest)||sha256Hex(canonical(body.value))!==body.digest)fail('Invalid backup record body',400);hashes.add(body.digest);}
            for(const [table,keys]of [['recordVersions',['world_id','branch_id','kind','id','revision']],['recordCommits',['world_id','branch_id','revision']],['recordLogs',['world_id','branch_id','revision','kind','id']]]){
                const authorizedRows=[...(data.snapshots??[]),...(data.partitions??[]).flatMap(p=>p.snapshots??[])];
                const authorizedBodies=authorizedRows.filter(isRefRow).map(r=>bodyMap.get(r.body_digest)).filter(Boolean);
                const limits=new Map();for(const body of authorizedBodies)if(isRecordWorld(body)){const k=canonical(scope(body.pointer));limits.set(k,Math.max(limits.get(k)??-1,body.pointer.revision));}
                const seen=new Set();for(const row of data.recordStore[table]){scope(row);revision(row.revision);const limit=limits.get(canonical(scope(row)));if(limit===undefined||row.revision>limit)fail('Backup record evidence scope/revision invalid',400);const key=canonical(keys.map(k=>row[k]));if(seen.has(key))fail('Duplicate backup record identity',400);seen.add(key);}
            }
        }else if([...bodyMap.values()].some(v=>isRecordWorld(v)||isRecordCandidate(v)))fail('Record bodies require new backup format',400);
        data.userParams=detached(data.userParams??{});if(!data.userParams||typeof data.userParams!=='object'||Array.isArray(data.userParams))fail('Invalid backup user params',400);
        for(const key of Object.keys(data.userParams))id(key,'user param key');
        let parts;
        if(bundle.version===1){if(data.heads.length!==1||!data.heads[0]||typeof data.heads[0]!=='object'||Array.isArray(data.heads[0]))fail('Invalid backup head',400);parts=[{pointer:data.pointer,head:data.heads[0],snapshots:data.snapshots,operations:data.operations}];}
        else{
            if(!Array.isArray(data.partitions)||!data.partitions.length)fail('Invalid backup partitions',400);
            for(const part of data.partitions){if(!part||typeof part!=='object'||Array.isArray(part))fail('Invalid backup partition',400);scope(part.pointer);revision(part.pointer.revision);if(!Array.isArray(part.snapshots)||!Array.isArray(part.operations))fail('Invalid backup partition rows',400);if(!part.head||typeof part.head!=='object'||Array.isArray(part.head))fail('Invalid backup partition head',400);}
            parts=data.partitions;
            const selected=parts.find(part=>part.pointer.world_id===data.pointer.world_id&&part.pointer.branch_id===data.pointer.branch_id&&part.pointer.revision===data.pointer.revision);if(!selected)fail('Invalid backup selected partition',400);
            if(data.heads.length!==1||!equal(data.heads[0],selected.head))fail('Invalid backup head',400);
            if(!equal(data.snapshots,selected.snapshots)||!equal(data.operations,selected.operations))fail('Invalid backup selected partition rows',400);
        }
        const seenPartitions=new Set(),operationIds=new Set();
        for(const part of parts){
            const pointer=part.pointer,partition=scope(pointer),base=part.head.base_revision,match=row=>row.world_id===partition[0]&&row.branch_id===partition[1];
            if(pointer.world_id!==data.pointer.world_id)fail('Invalid backup partition world identity',400);
            const partitionKey=canonical(partition);if(seenPartitions.has(partitionKey))fail('Duplicate backup branch partition',400);seenPartitions.add(partitionKey);
            if(!match(part.head)||part.head.revision!==pointer.revision)fail('Invalid backup partition head',400);revision(base);
            const ordered=[...part.snapshots].sort((a,b)=>a.revision-b.revision);
            if(base>pointer.revision||ordered.length!==pointer.revision-base+1)fail('Incomplete backup history',400);
            for(let i=0;i<ordered.length;i++){const row=ordered[i];scope(row);revision(row.revision);if(!match(row)||row.revision!==base+i)fail('Invalid backup snapshot identity/revision',400);const body=bodyOfRow(row);const checked=snapshot({world_id:row.world_id,branch_id:row.branch_id,revision:row.revision},body,row.provenance);
                // 摘要口径：新包按"剥掉玩家参数的世界正文"算；旧包按"整份世界（含参数）"算 —— 两种都认，但**必须有一个对上**。
                const legacyDigest=sha256Hex(canonical(hydratePlayerParams(body,data.userParams)));
                const stored=isRefRow(row)?bodyMap.get(row.body_digest):null,storedDigest=stored?bodyDigestOf(stored):checked.digest;
                if(isRecordWorld(stored)&&(stored.pointer.world_id!==row.world_id||stored.pointer.branch_id!==row.branch_id||stored.pointer.revision!==row.revision))fail('Backup record snapshot scope mismatch',400);
                if(storedDigest!==row.digest&&checked.digest!==row.digest&&legacyDigest!==row.digest)fail('Backup snapshot digest mismatch',400);
                if(isRefRow(row)&&row.body_digest!==storedDigest)fail('Backup snapshot body digest mismatch',400);}
            const statuses=['started','proposed','failed','cancelled','committed'];
            for(const row of part.operations){id(row.operation_id,'operation_id');if(operationIds.has(row.operation_id))fail('Duplicate backup operation',400);operationIds.add(row.operation_id);scope(row);if(!match(row)||!statuses.includes(row.status)||(row.kind!==undefined&&!['restore','import'].includes(row.kind)))fail('Invalid backup operation status or identity',400);id(row.phase,'phase');revision(row.expected_revision);if(row.expected_revision>pointer.revision)fail('Future backup operation revision',400);if(!row.inputs||typeof row.inputs!=='object'||Array.isArray(row.inputs)||row.inputs.operation_id!==row.operation_id)fail('Invalid backup operation inputs',400);
                if(row.status==='committed'){const receipt=row.receipt;if(!receipt||receipt.operation_id!==row.operation_id||!match(receipt)||!Number.isSafeInteger(receipt.revision)||receipt.revision>pointer.revision||receipt.revision<base)fail('Invalid backup operation receipt',400);if(!['restore','import'].includes(row.kind)){const landed=ordered[receipt.revision-base];const landedBody=landed?bodyOfRow(landed):null;
                    // 候选：新包只有引用（`body_digest`）、旧包是内联的**整份世界**（含当时参数）⇒ 比正文那一半。
                    let proposal=isRefRow(row)?expand(bodyMap.get(row.body_digest)):(row.proposal??null);
                    validateRecordPartial(row.record_partial??null);
                    if(proposal&&row.record_partial){const previous=ordered.find(s=>s.revision===row.expected_revision);proposal=mergePartialCandidate(stripPlayerParams(proposal),previous?bodyOfRow(previous):null,row.record_partial);}
                    if(receipt.revision!==row.expected_revision+1||!landedBody||!proposal||!equal(stripPlayerParams(proposal),landedBody))fail('Invalid backup committed proposal/revision',400);}}
                else if(row.receipt!==null||row.expected_revision>pointer.revision)fail('Future backup operation results',400);
                if(!['restore','import'].includes(row.kind)){if(row.inputs.expected_revision!==row.expected_revision||typeof row.allow_limited!=='boolean'||!Array.isArray(row.errors)||!row.checkpoints||typeof row.checkpoints!=='object'||Array.isArray(row.checkpoints))fail('Invalid backup operation fields',400);for(const error of row.errors)if(!error||typeof error!=='object'||Array.isArray(error)||typeof error.stage!=='string'||typeof error.message!=='string')fail('Invalid backup operation error',400);if(row.call!==null){if(!row.call||!['requested','received','unknown'].includes(row.call.outcome)||!['provider','model','request_id','response','usage'].every(key=>Object.hasOwn(row.call,key)))fail('Invalid backup model call status',400);for(const key of ['provider','model','request_id'])if(row.call[key]!==null)id(row.call[key],'model call '+key);if(row.call.outcome!=='received'&&row.call.response!==null)fail('Invalid backup model response',400);}if(row.status==='proposed'&&row.proposal==null&&!isRefRow(row))fail('Invalid backup proposal',400);}
            }
            part.ordered=ordered;
        }
        if(bundle.version>=3&&!Array.isArray(data.savedSnapshots))fail('Invalid backup saved snapshots',400);
        data.savedSnapshots??=[];const savedIds=new Set();
        for(const row of data.savedSnapshots){if(row.world_id!==data.pointer.world_id)fail('Invalid backup saved snapshot identity',400);const body=bodyOfRow(row);const checked=savedSnapshot(row.world_id,{...row,world:body});
            const legacyDigest=sha256Hex(canonical(hydratePlayerParams(body,data.userParams)));
            const stored=isRefRow(row)?bodyMap.get(row.body_digest):null,storedDigest=stored?bodyDigestOf(stored):checked.digest;
            if(isRecordWorld(stored)){const p=stored.pointer,part=parts.find(part=>part.pointer.world_id===p.world_id&&part.pointer.branch_id===p.branch_id);if(p.world_id!==row.world_id||!part?.ordered.some(s=>s.revision===p.revision))fail('Backup saved record descriptor scope/revision invalid',400);}
            if(row.digest!==storedDigest&&row.digest!==checked.digest&&legacyDigest!==row.digest)fail('Backup saved snapshot digest mismatch',400);
            if(isRefRow(row)&&row.body_digest!==storedDigest)fail('Backup saved snapshot body digest mismatch',400);if(savedIds.has(row.snapshot_id))fail('Duplicate backup saved snapshot',400);savedIds.add(row.snapshot_id);}
        function unique(rows,key,check){const seen=new Set();for(const row of rows){check(row);const value=canonical(key(row));if(seen.has(value))fail('Duplicate backup source identity',400);seen.add(value);}}
        unique(data.sourceVersions,r=>[r.library_id,r.version],r=>{id(r.library_id,'library_id');revision(r.version);validatePublication(r);});unique(data.libraries,r=>r.library_id,r=>id(r.library_id,'library_id'));unique(data.imports,r=>[r.library_id,r.import_id],r=>{id(r.library_id,'library_id');id(r.import_id,'import_id');});
        for(const row of [...parts.flatMap(part=>part.ordered),...data.savedSnapshots]){const rowBody=bodyOfRow(row);for(const root of [rowBody.sourcePublication,rowBody.sourceInitialization,rowBody.meta?.sourcePublication,rowBody.meta?.sourceInitialization,row.provenance])walkSources(root,p=>{
            if(publication(p))validatePublication(p);
            if(typeof p.library_id!=='string')return;
            if(!Number.isSafeInteger(p.version))fail('Backup source reference requires a fixed version',400);
            const version=data.sourceVersions.find(v=>v.library_id===p.library_id&&v.version===p.version);
            if(!version)fail('Backup required source version missing',400);
            if(publication(p))for(const key of ['records','sources','omitted_source_ids','import_id'])if(Object.hasOwn(p,key)&&!equal(p[key],version[key]))fail('Backup publication differs from fixed source version',400);
        });}
        for(const library of data.libraries){revision(library.version);const versions=data.sourceVersions.filter(v=>v.library_id===library.library_id);if(library.version!==Math.max(0,...versions.map(v=>v.version)))fail('Backup source library version mismatch',400);}
        for(const row of data.imports){if(!['draft','cancelled','published'].includes(row.status))fail('Invalid backup source import status',400);if(!Array.isArray(row.entries)||!Array.isArray(row.items)||!Array.isArray(row.candidates)||!Array.isArray(row.execution?.attempts))fail('Invalid backup source import arrays',400);for(const item of row.items){id(item.source_id,'source_id');id(item.content_hash,'content_hash');if(!['pending','requested','unknown','failed','succeeded','cancelled'].includes(item.status))fail('Invalid backup source item status',400);const entry=row.entries.find(e=>e.source_id===item.source_id);if(!entry||typeof entry.content!=='string'||sha256Hex(entry.content)!==item.content_hash)fail('Backup source import original hash mismatch',400);}for(const attempt of row.execution.attempts){id(attempt.attempt_id,'attempt_id');if(!['requested','received','unknown','failed','succeeded'].includes(attempt.outcome))fail('Invalid backup source attempt outcome',400);}for(const candidate of row.candidates)validateSourceRecords(candidate.records,{deferReferences:true});if(row.status==='published'){const version=data.sourceVersions.find(v=>v.library_id===row.library_id&&v.import_id===row.import_id);if(!version||row.receipt?.version!==version.version)fail('Backup source import receipt mismatch',400);}}
        for(const version of data.sourceVersions)if(version.import_id&&!data.imports.some(r=>r.library_id===version.library_id&&r.import_id===version.import_id&&r.status==='published'))fail('Backup required original source import missing',400);
        data.partitionList=parts;
        data.bodyMap=bodyMap;data.expandRecordBody=expand;
        return data;
    }
    async function previewImport(bundle){
        const data=validateBackup(bundle),part=data.partitionList.find(p=>p.pointer.world_id===data.pointer.world_id&&p.pointer.branch_id===data.pointer.branch_id&&p.pointer.revision===data.pointer.revision),row=part.ordered.find(s=>s.revision===data.pointer.revision);
        const body=isRefRow(row)?data.expandRecordBody(data.bodyMap.get(row.body_digest)):row.world;
        return {world:hydratePlayerParams(detached(body),data.userParams),revision:row.revision,report:{errors:[],warnings:[]},bundle_digest:bundle.digest,snapshot_count:data.partitionList.reduce((n,p)=>n+p.snapshots.length,0)+data.savedSnapshots.length,branches:data.partitionList.map(p=>({world_id:p.pointer.world_id,branch_id:p.pointer.branch_id,revision:p.pointer.revision}))};
    }
    async function importWorld({operation_id,world_id,branch_id,bundle,snapshotsOnly=false}){
        id(operation_id,'operation_id');scope({world_id,branch_id});const data=validateBackup(bundle);
        // ★2026-10-17（用户令「导入只需要记住导过哪份文件，不需要把那份文件再抄一遍」）：
        //   导入**不再把整包备份抄进库**（原来 `inputs.bundle` 与 `original_bundle` 各存一份，
        //   逐字节相同、加起来 57 MB，而它们唯一的用途只是"判重"与"抠恢复点名字"）。
        //   现在只留：**指纹**（这份文件的身份，判重与审计都够）＋ 结构摘要（格式／版本／编码／字节数／各类计数）。
        //   原件始终在用户自己手里；要再导一次，拿那个文件来即可。
        const bundleRef={digest:bundle.digest,format:bundle.format,version:bundle.version,encoding:bundle.encoding??null,payload_bytes:typeof bundle.payload==='string'?bundle.payload.length:0};
        const inputs=detached({operation_id,world_id,branch_id,bundle:bundleRef,...(snapshotsOnly?{snapshotsOnly:true}:{})});
        const parts=snapshotsOnly?data.partitionList.filter(p=>p.pointer.branch_id===data.pointer.branch_id):data.partitionList;
        // 恢复点名字／时间：**当场从这份文件里抠出来存进元数据**（原来靠把整包留在库里、每次导入再解析）。
        const legacyMetadata=new Map(),parsedBundles=new Set();
        function recoveryId(row){for(let p=row.provenance;p&&typeof p==='object';p=p.original){if(typeof p.recovery_point==='string')return p.recovery_point;}const name=row.branch_id;return typeof name==='string'&&name.startsWith('recovery:')?name.slice(9):null;}
        for(const part of data.partitionList)for(const row of part.snapshots)for(let p=row.provenance;p&&typeof p==='object';p=p.original){
            const original=p.original_bundle;if(!original?.payload||parsedBundles.has(original.payload))continue;parsedBundles.add(original.payload);
            let content;try{content=JSON.parse(original.payload)}catch{continue}
            for(const point of content.recovery_points??[])if(point?.original_snapshot&&typeof point.id==='string')legacyMetadata.set(point.id,detached(point.original_snapshot));
            for(const point of content.original_snapshots??[])if(point&&typeof point.id==='string'&&!legacyMetadata.has(point.id))legacyMetadata.set(point.id,detached(point));
        }
        // 旧格式（整包还在 provenance 里）这里顺带把它收成指纹：名字已经抠进元数据，正文不必再留一份。
        for(const part of data.partitionList)for(const row of part.snapshots)for(let p=row.provenance;p&&typeof p==='object';p=p.original){
            const original=p.original_bundle;if(!original||typeof original!=='object'||!Object.hasOwn(original,'payload'))continue;
            const stripped={...detached(original)};delete stripped.payload;
            if(typeof original.payload==='string')stripped.payload_bytes=original.payload.length;
            if(original.digest)stripped.digest=original.digest;else stripped.digest=sha256Hex(original.payload??'');
            p.original_bundle=stripped;
        }
        const summary={partitions:data.partitionList.length,snapshots:data.partitionList.reduce((n,p)=>n+p.snapshots.length,0),saved_snapshots:data.savedSnapshots.length,recovery_points:legacyMetadata.size,branches:data.partitionList.map(p=>p.pointer.branch_id)};
        // 导入时正文一律按内容只留一份：先落正文，行里只记引用（旧包的行内正文也收敛成引用）。
        const bodyByDigest=new Map();
        for(const entry of data.worldBodies)bodyByDigest.set(bodyDigestOf(entry),entry);
        const bodyOfRow=row=>isRefRow(row)?data.expandRecordBody(bodyByDigest.get(row.body_digest)):inlineBodyOf(row);
        function pinnedEvidence(row){const raw=isRefRow(row)?bodyByDigest.get(row.body_digest):null;if(!isRecordWorld(raw))return [];const latest=new Map(),p=raw.pointer;for(const r of data.recordStore.recordVersions){if(r.world_id!==p.world_id||r.branch_id!==p.branch_id||r.revision>p.revision||r.kind!=='legacy-event')continue;const old=latest.get(r.id);if(!old||old.revision<r.revision)latest.set(r.id,r);}const bodies=new Map(data.recordStore.recordBodies.map(b=>[b.digest,b.value]));return [...latest.values()].filter(r=>!r.deleted).map(r=>joinRecord(bodies.get(r.payload_digest),bodies.get(r.state_digest)));}
        const savedCopies=data.savedSnapshots.map(row=>savedSnapshot(world_id,{...row,world:bodyOfRow(row),snapshot_id:'import:'+sha256Hex(canonical([bundle.digest,row.snapshot_id])),provenance:{original:row.provenance??null,imported_from:{world_id:row.world_id,snapshot_id:row.snapshot_id,bundle_digest:bundle.digest}}}));
        if(snapshotsOnly)for(const part of data.partitionList.filter(p=>p.pointer.branch_id!==data.pointer.branch_id))for(const row of part.snapshots)savedCopies.push(savedSnapshot(world_id,{snapshot_id:'history:'+sha256Hex(canonical([bundle.digest,row.branch_id,row.revision])),world:bodyOfRow(row),metadata:legacyMetadata.get(recoveryId(row))??{id:recoveryId(row)},provenance:{original:row.provenance??null,imported_from:{world_id:row.world_id,branch_id:row.branch_id,revision:row.revision,bundle_digest:bundle.digest}}}));
        // The selected branch lands on the requested target branch. Every other branch keeps a
        // deterministic, distinct name inside the new world, so partitions are never merged.
        const branchMap=new Map([[data.pointer.branch_id,branch_id]]),used=new Set([branch_id]);
        for(const name of parts.map(p=>p.pointer.branch_id).filter(name=>name!==data.pointer.branch_id).sort()){
            let mapped=name;if(used.has(mapped))mapped=mapped+'~'+sha256Hex(canonical([world_id,branch_id,name])).slice(0,12);
            if(used.has(mapped))fail('Backup branch mapping collision');used.add(mapped);branchMap.set(name,mapped);
        }
        const branchFor=name=>branchMap.has(name)?branchMap.get(name):branchMap.get(data.pointer.branch_id);
        const copies=[],opRows=[],operation_map={},seenOperations=new Set();
        for(const part of parts){
            const targetBranch=branchMap.get(part.pointer.branch_id);
            for(const s of part.snapshots)copies.push({...detached(s),world_id,branch_id:targetBranch,provenance:{original:s.provenance,imported_from:{world_id:data.pointer.world_id,branch_id:part.pointer.branch_id,revision:s.revision,bundle_digest:bundle.digest},operation_id}});
            for(const row of part.operations){
                const remapped=importedOperationId(world_id,targetBranch,row.operation_id);if(seenOperations.has(remapped))fail('Duplicate backup operation identity');seenOperations.add(remapped);
                const receipt=row.receipt?{...row.receipt,operation_id:remapped,world_id,branch_id:branchFor(row.receipt.branch_id)}:null;
                // Full original audit row (including its own operation_id/request_id) stays under
                // `original`; only the live identity inside the target world/branch is patched.
                const original=detached(row),mutable=Object.fromEntries(['checkpoints','errors','call'].filter(key=>Object.hasOwn(original,key)).map(key=>[key,detached(original[key])]));opRows.push({...original,...mutable,operation_id:remapped,world_id,branch_id:targetBranch,inputs:{...original.inputs,operation_id:remapped},receipt,original,original_operation_id:row.operation_id});
                operation_map[row.operation_id]={operation_id:remapped,branch_id:targetBranch};
            }
        }
        return db.transaction('rw',...recordTables,db.operations,db.heads,db.snapshots,db.indexJobs,db.sourceVersions,db.libraries,db.imports,db.savedSnapshots,db.worldBodies,db.userParams,async()=>{
            const old=await db.operations.get(operation_id);
            if(old){
                // 幂等：同一份文件（同一个指纹）重导同一个世界 ⇒ 原样返回，不建第二个世界。
                //   指纹相同但目标不同（别的聊天／别的世界编号）⇒ 照旧拒绝，不静默改指。
                const previous=old.inputs??{};
                const sameBundle=previous.bundle?.digest===bundleRef.digest;
                if(old.kind!=='import'||!sameBundle||previous.world_id!==world_id||previous.branch_id!==branch_id||Boolean(previous.snapshotsOnly)!==Boolean(snapshotsOnly))fail('Immutable import operation conflict');
                return detached(old);
            }
            for(const targetBranch of branchMap.values())if(await db.heads.get([world_id,targetBranch]))fail('Target branch exists; cannot overwrite');
            // Shared immutable content is safe to reuse. Donor version identities are never
            // installed into live tables: importing a new world cannot occupy an old world's next revision.
            for(const value of data.recordStore?.recordBodies??[]){
                const previous=await db.recordBodies.get(value.digest);
                if(previous&&!equal(previous,value))fail('Backup record body collision');if(!previous)await db.recordBodies.add(detached(value));
            }
            const importedRefs=new Map();
            for(const entry of data.worldBodies){
                const stored=isRecordCandidate(entry)?entry:await writeCandidate(data.expandRecordBody(entry));
                await writeBody(stored);importedRefs.set(bodyDigestOf(entry),bodyDigestOf(stored));
            }
            function runtimeRefs(value){
                if(!value||typeof value!=='object')return value;
                if(Array.isArray(value))return value.map(runtimeRefs);
                if(typeof value[BODY_REF_KEY]==='string')return {...value,[BODY_REF_KEY]:importedRefs.get(value[BODY_REF_KEY])??value[BODY_REF_KEY]};
                return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,runtimeRefs(item)]));
            }
            for(const row of opRows){
                if(row.proposal&&typeof row.proposal==='object'&&!row.body_digest){
                    const stored=await writeCandidate(row.proposal),ref=bodyRefOf(stored,{round:rowRound(row.proposal)});
                    delete row.proposal;Object.assign(row,ref);
                }else if(row.body_digest&&importedRefs.has(row.body_digest)){
                    const digest=importedRefs.get(row.body_digest),stored=await readRawBody(digest);
                    Object.assign(row,bodyRefOf(stored,{round:row.round??null}));
                }
                // Only live runtime references change. The complete original audit row remains opaque.
                if(row.checkpoints!==undefined)row.checkpoints=runtimeRefs(await packWorld(row.checkpoints));
            }
            await saveParams(world_id,data.userParams);
            for(const row of data.sourceVersions){const previous=await db.sourceVersions.get([row.library_id,row.version]);if(previous&&!equal(previous,row))fail('Backup source identity collision');if(!previous)await db.sourceVersions.add(detached(row));}
            // The shared source-library registry may legitimately be newer than the exported
            // snapshot. The fixed source versions are what the world needs, so accept a higher
            // existing counter for the same library but never a different library identity.
            for(const row of data.libraries){const previous=await db.libraries.get(row.library_id);if(!previous){await db.libraries.add(detached(row));continue;}if(!equal({...previous,version:0},{...row,version:0}))fail('Backup source identity collision');if((previous.version??0)<row.version)await db.libraries.put({...previous,version:row.version});}
            for(const row of data.imports){const previous=await db.imports.get([row.library_id,row.import_id]);if(previous&&!equal(previous,row))fail('Backup source identity collision');if(!previous)await db.imports.add(detached(row));}
            for(const row of opRows){if(row.operation_id===operation_id||await db.operations.get(row.operation_id))fail('Backup operation identity collision');await db.operations.add(detached(row));}
            for(const saved of savedCopies){const source=data.savedSnapshots.find(r=>'import:'+sha256Hex(canonical([bundle.digest,r.snapshot_id]))===saved.snapshot_id);const world=source?bodyOfRow(source):bodyOfRow(data.partitionList.flatMap(p=>p.snapshots).find(r=>'history:'+sha256Hex(canonical([bundle.digest,r.branch_id,r.revision]))===saved.snapshot_id));const descriptor=await writeCandidate(world),ref=bodyRefOf(descriptor,{round:saved.round,at:saved.at});await db.savedSnapshots.add({...saved,...ref,digest:ref.body_digest});}
            const previousDescriptors=new Map();
            for(let i=0;i<copies.length;i++){
                const row=copies[i],p={world_id:row.world_id,branch_id:row.branch_id,revision:row.revision},body=bodyOfRow(row),previous=previousDescriptors.get(row.branch_id)??null;
                const descriptor=await records.putVersion(p,body,{previous,operation:{kind:'import',operation_id,at:row.at??null},eventEvidence:[...await archiveEvidence(body,previous),...pinnedEvidence(row)]});
                await writeBody(descriptor);copies[i]={...snapshot(p,descriptor,row.provenance),round:row.round??rowRound(body),at:row.at??null,record_store:1};previousDescriptors.set(row.branch_id,descriptor);
            }
            await db.snapshots.bulkAdd(copies);await db.indexJobs.bulkAdd(copies.map(job));
            for(const part of parts)await db.heads.add({...part.head,world_id,branch_id:branchMap.get(part.pointer.branch_id)});
            const receipt={operation_id,world_id,branch_id,revision:data.pointer.revision};
            // 不再留整包（`original_bundle` 撤掉）：只留指纹、结构与计数 —— 判重、审计、面板读数都够用。
            const row={operation_id,world_id,branch_id,kind:'import',inputs,status:'committed',phase:'committed',expected_revision:data.pointer.revision,receipt,operation_map,branch_map:Object.fromEntries(branchMap),import_summary:detached(summary)};
            await db.operations.add(detached(row));return detached(row);
        });
    }
    /** 读操作行：检查点里按引用存的世界正文换回完整世界（引擎读的就是这个形状）。 */
    async function operationFor(pointer,operation_id){
        const row=await operation(pointer,operation_id);
        const copy=detached(row);
        if(!copy.proposal&&isRefRow(copy))copy.proposal=hydratePlayerParams(await readBody(copy.body_digest,'候选世界'),await paramsOf(copy.world_id));
        if(copy.checkpoints&&typeof copy.checkpoints==='object')copy.checkpoints=await unpackWorld(copy.checkpoints,copy.world_id);
        return copy;
    }
    return {db,recordTables,recordStore:records,recordDescriptor,initialize,getWorld,getWorkingWorld,getRecordChanges,getRecordsAtPositions,saveSnapshots,getSavedSnapshot,listSnapshotMetadata,readSnapshot,startOperation,getOperation:(p,i)=>operationFor(p,i),checkpoint,setPhase,markModelPosted,claimModel,saveResponse,markModelUnknown,failOperation,resumeOperation,allowLimited,saveProposal,commitOperation,cancelOperation,restoreBranch,listIndexTasks,beginIndexMaintenance,reserveIndexVectors,settleIndexVectors,completeIndex,getMovements,readChatCursor,saveChatCursor,getRecords,exportWorld,previewImport,importWorld,readBody,paramsOf,saveParams,close:()=>db.close()};
}
import {isFinalizedPublication,finalizedEvidenceRecords} from '../src/finalized-source.js';

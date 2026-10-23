import {SOURCE_AB_PROTOCOL} from './source-ab-contract.js';
import {collectAbFieldReview} from './source-ab-fields.js';
import {redactText} from './diagnostics.js';
import {chatIdentity, identityScope} from './chat-scope.js';
// New-world task identity and immutable input. No browser, storage or model effects.
export const CREATION_PROTOCOL = 'world-creation-v1';
export const CREATION_SELECTION_KEY = 'creationSelections';
export class CreationError extends Error {
    constructor(code, message) { super(message); this.name = 'CreationError'; this.code = code; }
}
export function creationError(code, message) { return new CreationError(code, message); }
const failureStages={read:'读取当前抽象任务失败',start:'启动抽象失败',claim:'登记模型请求失败',plan:'安排后续抽象失败',model:'模型调用失败',receipt:'模型回执暂未保存',consume:'已收结果暂未处理完成',publication:'世界保存失败','field-view':'字段窗口未能打开','field-confirm':'字段暂未保存',execution:'抽象执行失败'};
export function creationFailure(error,{stage='execution',code=stage+'-failed'}={}){
 const names=['CreationError','Error','TypeError','ReferenceError','SyntaxError','RangeError','QuotaExceededError','DataCloneError','InvalidStateError','TransactionInactiveError','AbortError','ConstraintError','NotFoundError','SecurityError','NetworkError'];
 const exception=names.includes(error?.name)?error.name:'Error';
 const details={QuotaExceededError:'浏览器存储空间不足',DataCloneError:'待保存数据无法复制',InvalidStateError:'浏览器存储或窗口状态不可用',TransactionInactiveError:'保存事务已结束',ConstraintError:'保存记录发生冲突',SecurityError:'浏览器拒绝存储访问',NotFoundError:'所需记录或存储尚未读到'};
 const safeCode=error instanceof CreationError&&/^[a-z][a-z0-9-]{0,63}$/.test(error.code)?error.code:code;
 const detail=error instanceof CreationError?redactText(String(error.message)).slice(0,400):details[exception]??exception;
 const failure={stage,code:safeCode,exception,message:(failureStages[stage]??failureStages.execution)+'：'+detail+'。已有资料与回执保留，请核对后继续'};
 const type=error?.sw2CallFailure?.type;if(['timeout','network','stream-incomplete','http','provider','not-sent','empty','invalid-json','truncation'].includes(type))failure.model_type=type;
 const status=error?.sw2CallFailure?.status??error?.status;if(Number.isInteger(status)&&status>=100&&status<=599)failure.http_status=status;
 return failure;
}
export function creationScope(ctx) {
    const identity = chatIdentity(ctx), {chatId, characterId, groupId} = identity;
    if (!chatId) throw creationError('missing-chat', '当前聊天身份尚未就绪，请稍后再开始');
    for (const value of [characterId, groupId]) if (value !== null && (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value))) throw creationError('invalid-chat', '当前聊天身份无法核对');
    return identityScope(identity);
}
export function freezeCreationValue(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freezeCreationValue(child);
    return Object.freeze(value);
}
export function preparedCreationTask({ run_id, library_id, import_id, snapshot_id, scope, command_id, created_at, source_creation_protocol }) {
    for (const value of [run_id, library_id, import_id, snapshot_id, scope, command_id]) if (typeof value !== 'string' || !value) throw creationError('invalid-task', '新任务身份不完整');
    if(source_creation_protocol!==undefined&&source_creation_protocol!==SOURCE_AB_PROTOCOL)throw creationError('unsupported-source-protocol','该新任务的抽象版本无法识别');
    return { protocol: CREATION_PROTOCOL, ...(source_creation_protocol?{source_creation_protocol}:{}), run_id, library_id, import_id, snapshot_id, scope, command_id,
        revision: 0, status: 'prepared', phase: 'prepare', created_at, updated_at: created_at, failure: null };
}
export function creationView(task) {
    if (!task) return null;
    return { scope: task.scope, run_id: task.run_id, import_id: task.import_id, snapshot_id: task.snapshot_id,
        revision: task.revision, status: task.status, phase: task.phase, failure: task.failure,
        progress: task.progress ?? { done: 0, total: 0 }, field_revision: task.field_review?.revision ?? null };
}

import { collectWorkspaceFields } from './source-field-candidates.js';
import { confirmFieldTable, fieldCandidateRevision } from './source-field-table.js';
const taskCopy = value => structuredClone(value);
export function creationFieldReview(groups) {
    const review = groups.some(g=>g.protocol===SOURCE_AB_PROTOCOL)?collectAbFieldReview(groups):collectWorkspaceFields(groups);
    return { ...review, revision: fieldCandidateRevision(review.candidates), confirmed: null };
}
export function transitionCreationTask(task, event) {
    if (task.protocol !== CREATION_PROTOCOL || event.scope !== task.scope || event.snapshot_id !== task.snapshot_id) throw creationError('wrong-owner', '该操作不属于当前资料任务');
    const sameExecution = event.execution_id && event.execution_id === task.execution_id;
    const terminal = ['cancelled', 'completed'].includes(task.status);
    let patch;
    switch (event.type) {
    case 'execution-started':
        if (!['prepared', 'fields_confirmed'].includes(task.status)) throw creationError('stale-task', '本任务状态已变化，请重新核对');
        if (typeof event.execution_id !== 'string' || !event.execution_id) throw creationError('invalid-execution', '执行身份不完整');
        patch = { status: 'running', phase: task.status === 'fields_confirmed' ? 'semantic' : 'foundation', execution_id: event.execution_id,
            progress: { done: 0, total: 0 }, failure: null }; break;
    case 'local-failure':
        if(terminal)return {task,changed:false};
        patch={failure:taskCopy(event.failure),...(task.status==='running'?{status:'paused'}:{})};break;
    case 'checkpoint': return { task, changed: false };
    case 'progress':
        if (terminal || !sameExecution || task.status !== 'running') return { task, changed: false };
        if (![event.done, event.total].every(Number.isSafeInteger) || event.done < 0 || event.total < event.done) throw creationError('invalid-progress', '任务进度无法核对');
        if (event.done < (task.progress?.done ?? 0)) return { task, changed: false };
        if (task.progress?.done === event.done && task.progress?.total === event.total) return { task, changed: false };
        patch = { progress: { done: event.done, total: event.total } }; break;
    case 'fields-ready':
        if (terminal || !sameExecution || task.status !== 'running' || task.phase !== 'foundation') return { task, changed: false };
        patch = { status: 'needs_fields', phase: 'fields', field_review: creationFieldReview(event.groups),
            progress: { done: event.total ?? task.progress?.done ?? 0, total: event.total ?? task.progress?.total ?? 0 } }; break;
    case 'fields-confirmed': {
        if (terminal || !task.field_review || event.expected_field_revision !== task.field_review.revision) throw creationError('stale-fields', '字段版本已变化，请重新打开当前任务的字段表');
        const table = confirmFieldTable(task.field_review.candidates, event.fields);
        if (task.status === 'fields_confirmed' && !task.failure && task.field_review.confirmed?.revision === table.revision) return { task, changed: false };
        if (task.status !== 'needs_fields') throw creationError('stale-fields', '该任务已不在等待字段确认');
        patch = { status: 'fields_confirmed', phase: 'fields-confirmed', failure:null, field_review: { ...task.field_review, confirmed: table } }; break;
    }
    case 'execution-superseded':
        if(terminal||!sameExecution||task.status!=='running')return {task,changed:false};
        patch={status:'paused',phase:task.phase,failure:{code:'newer-intent',message:'本聊天已开始新的抽象；旧资料与回执保留'}};break;
    case 'execution-paused':
        if(terminal || !sameExecution || task.status!=='running')return {task,changed:false};
        patch={status:'paused',phase:task.phase,failure:{code:'local-save-failed',message:'本次结果暂未保存，已有进度保留；可以继续保存或重新开始'}};break;
    case 'receipts-revalidated':
        if(!sameExecution||!['failed','unknown'].includes(task.status))throw creationError('stale-task','任务状态已变化，不能重验原回执');
        patch=event.blocked?{status:event.unknown?'unknown':'failed',phase:event.unknown?'unknown':'failed',failure:taskCopy(event.failure)}:{status:'running',phase:event.phase,failure:null};break;
    case 'preparation-resumed':
        if(task.status!=='cancelled'||task.execution_id!==undefined)throw creationError('stale-task','任务已经开始执行，不能退回准备阶段');
        patch={status:'prepared',phase:'prepare',failure:null};break;
    case 'recovery-resumed':
        if(task.status==='completed'||task.execution_id!==event.previous_execution_id||!['running','paused','failed','unknown','cancelled'].includes(task.status)||typeof event.new_execution_id!=='string'||!event.new_execution_id||event.new_execution_id===task.execution_id)throw creationError('stale-task','任务或执行状态已变化，不能恢复旧执行');
        patch={status:'running',phase:event.phase,execution_id:event.new_execution_id,failure:null};break;
    case 'execution-resumed':
        if(task.status!=='paused'||!sameExecution)throw creationError('stale-task','该任务不能继续本次保存');
        patch={status:'running',failure:null};break;
    case 'publication-ready':
        if (terminal || !sameExecution || task.status !== 'running') return {task,changed:false};
        patch = {status:'ready_to_commit',phase:'publication',failure:null}; break;
    case 'publication-failed':
        if (terminal || !['ready_to_commit','save_failed'].includes(task.status)) return {task,changed:false};
        patch = {status:'save_failed',phase:'publication',failure:event.failure?taskCopy(event.failure):{code:'save-failed',message:'完整抽象已保留，世界暂未保存；可以继续保存或重新开始'}}; break;
    case 'published':
        if (terminal || !['ready_to_commit','save_failed'].includes(task.status)) return {task,changed:false};
        patch = {status:'completed',phase:'completed',pointer:taskCopy(event.pointer),failure:null}; break;
    case 'execution-failed':
        if (terminal || !sameExecution || task.status !== 'running') return { task, changed: false };
        patch = { status: event.unknown ? 'unknown' : 'failed', phase: event.unknown ? 'unknown' : 'failed',
            failure: event.failure?taskCopy(event.failure):{ code: event.unknown ? 'model-unknown' : 'foundation-failed',
                message: event.unknown ? '本次请求结果尚未确认，已保留进度；可以重新开始' : '本次抽象未能完成，已保留进度；可以重新开始' } }; break;
    case 'cancel':
        if (terminal) return { task, changed: false };
        patch = { status: 'cancelled', phase: 'cancelled' }; break;
    default: throw creationError('invalid-event', '无法识别本次资料任务操作');
    }
    return { task: { ...taskCopy(task), ...taskCopy(patch), revision: task.revision + 1, updated_at: event.at }, changed: true };
}
export function creationStatusText(task) {
    if(task.status==='completed')return '世界已保存，可以开始对话';
    if(task.status==='cancelled')return '本次抽象已停止，原文与已收到的结果保留';
    if(task.failure)return task.failure.message;
    if (task.recoverable) return '执行已中断，进度已保留；请核对后继续或重新开始';
    if (task.status === 'completed') return '世界已保存，可以开始对话';
    if (task.status === 'ready_to_commit') return '完整抽象已保存，正在建立世界';
    if (task.status === 'running' && task.phase === 'semantic') return '正在按已确认字段整理统一世界';
    if (task.status === 'running') return '正在整理本次资料的名册与设定' + (task.progress?.total ? '（' + task.progress.done + '/' + task.progress.total + '）' : '…');
    if (task.status === 'needs_fields') return '请确认本次资料的抽取字段；关闭窗口会保留待确认任务';
    if (task.status === 'fields_confirmed') return '字段已保存，可点击“继续抽象”；已有抽象进度保留';
    if (task.status === 'cancelled') return '本次抽象已停止，原文与已收到的结果保留';
    if (task.failure) return task.failure.message;
    return '当前资料已保存，尚未开始抽象';
}

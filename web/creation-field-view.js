import { openSourceFieldReview } from './source-field-panel.js';
import { creationError } from '../src/creation-task.js';

// View decisions are captured at the click, before an asynchronous chat switch.
export function createCreationFieldView({ getScope, getDocument = () => globalThis.document,
    render = (review, options) => openSourceFieldReview(getDocument(), review, options) } = {}) {
    let active = null;
    function close() { const previous = active; active = null; previous?.controller.abort(); }
    function scopeChanged() { if (active && active.owner.scope !== getScope()) close(); }
    function closeRun(runId) { if (active?.owner.run_id === runId) close(); }
    function open(task, { initialFields = null } = {}) {
        if (task.status !== 'needs_fields' || !task.field_review || task.scope !== getScope()) return Promise.resolve({ stale: true });
        const owner = Object.freeze({ scope: task.scope, run_id: task.run_id, import_id: task.import_id,
            snapshot_id: task.snapshot_id, field_revision: task.field_review.revision });
        if (active && JSON.stringify(active.owner) === JSON.stringify(owner)) return active.result;
        close();
        const session = { owner, controller: new AbortController(), result: null, decided: false, accepted: false, choice: null };
        active = session;
        function onDecision(choice) {
            if (session.decided) return;
            const copy = choice == null ? null : structuredClone(choice);
            session.decided = true; session.choice = copy;
            session.accepted = active === session && owner.scope === getScope() && !session.controller.signal.aborted;
        }
        const review = structuredClone(task.field_review);
        // This is the editor's unsaved retry input; the persisted candidates stay unchanged.
        if (initialFields) review.candidates = structuredClone(initialFields);
        let pending;
        try { pending = render(review, { signal: session.controller.signal, owner, onDecision }); }
        catch {
            if (active === session) active = null;
            session.controller.abort();
            return Promise.reject(creationError('field-view-unavailable', '字段窗口暂未打开，待确认任务仍已保存'));
        }
        session.result = Promise.resolve(pending).then(choice => {
            if (!session.decided) onDecision(choice);
            if (active === session) active = null;
            session.controller.abort();
            return session.accepted ? { owner, choice: session.choice } : { stale: true, owner };
        }, () => {
            if (active === session) active = null;
            session.controller.abort();
            throw creationError('field-view-unavailable', '字段窗口暂未打开，待确认任务仍已保存');
        });
        return session.result;
    }
    return { open, close, closeRun, scopeChanged, currentOwner: () => active ? { ...active.owner } : null };
}

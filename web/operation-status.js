export function isConfirmedFailedOperation(row) {
    // Older model-stage failures may contain an interrupted response marked received.
    if (row?.status !== 'failed') return false;
    // 本地执行已退出且没有候选或提交：确认的是本轮未落账，上游结果仍保留 unknown。
    if (row.call?.outcome === 'unknown' && row.checkpoints?.['model-attempt-ended'] === true && row.proposal == null && row.receipt == null) return true;
    // Missing dispatch evidence alone cannot prove that the sender was never invoked.
    if (!row.call || (row.call.outcome === 'requested' && row.checkpoints?.['model-request-not-sent'] === true)) return true;
    // 发了请求、又确实拿到了回话之后的失败（结算/保存/提交阶段）同样是确认失败：回合没落账，也不该锁住按钮。
    if (row.call.outcome === 'received') return row.checkpoints?.['model-response-confirmed'] === true || ['settle', 'save', 'commit'].includes(row.errors?.at(-1)?.stage);
    return false;
}

// 异步查书等操作只可写回开始时的那份世界，不能覆盖期间保存的玩家设置。
export function createWorldWriteGuard({ world, getWorld, getScope }) {
    const originalVersion = JSON.stringify(world), scopeKey = JSON.stringify(getScope());
    let candidate = null, candidateVersion = null;
    const changed = () => new Error('世界版本已改变，迟到查书结果未保存，请重新查询');
    const guard = {
        checkScope() {
            if (JSON.stringify(getScope()) !== scopeKey) throw new Error('聊天已切换，迟到查书结果未保存');
        },
        assertCurrent() {
            this.checkScope();
            if (JSON.stringify(world) !== originalVersion || JSON.stringify(getWorld()) !== originalVersion) throw changed();
        },
        prepare(next) {
            this.assertCurrent();
            candidate = next;
            candidateVersion = JSON.stringify(next);
        },
        validateInput() {
            this.checkScope();
            const currentVersion = JSON.stringify(getWorld());
            if (JSON.stringify(world) !== originalVersion || JSON.stringify(candidate) !== candidateVersion
                || (currentVersion !== originalVersion && currentVersion !== candidateVersion)) throw changed();
        },
    };
    return guard;
}

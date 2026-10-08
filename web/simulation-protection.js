// 用户的禁止模拟开关：候选账与当前账分开，保存确认后才刷新界面。
import { setSimulationBlocked } from '../src/simulation-protection.js';

export function createSimulationProtectionHub({ getWorld, saveWorld, isBusy, getScope, refresh, setStatus = null } = {}) {
    for (const [name, value] of Object.entries({ getWorld, saveWorld, isBusy, getScope, refresh })) {
        if (typeof value !== 'function') throw new TypeError(`createSimulationProtectionHub：${name} 必须是函数`);
    }
    let saving = false;
    async function set(id, blocked, expected = null) {
        if (saving) throw new Error('禁止模拟设置正在保存，请稍候再试');
        if (isBusy()) throw new Error('世界正在演算，请结束后再设置禁止模拟');
        const original = getWorld();
        const scope = JSON.stringify(getScope()), version = JSON.stringify(original);
        if (expected && expected.scopeKey !== scope) throw new Error('聊天已切换，请重新打开角色详情');
        if (expected && expected.worldVersion !== version) throw new Error('世界版本已改变，请重新打开角色详情');
        const change = setSimulationBlocked(structuredClone(original), id, blocked);
        if (!change.changed) return { ok: true, changed: false };
        const candidate = change.world, candidateVersion = JSON.stringify(candidate);
        const guard = {
            checkScope() {
                if (JSON.stringify(getScope()) !== scope) throw new Error('聊天已切换，禁止模拟设置未完成');
                if (isBusy()) throw new Error('世界已开始演算，禁止模拟设置未完成');
            },
            assertCurrent() {
                this.checkScope();
                if (JSON.stringify(getWorld()) !== version) throw new Error('世界版本已改变，请重新设置禁止模拟');
            },
            validateInput() {
                this.checkScope();
                const current = JSON.stringify(getWorld());
                if (JSON.stringify(original) !== version || JSON.stringify(candidate) !== candidateVersion
                    || (current !== version && current !== candidateVersion)) throw new Error('世界版本已改变，请重新设置禁止模拟');
            },
        };
        saving = true;
        try {
            guard.assertCurrent();
            const saved = await saveWorld(candidate, guard);
            guard.validateInput();
            if (saved?.ok === false || saved?.queued) throw new Error(`禁止模拟设置保存未确认：${saved.reason || '保存仍在排队'}`);
            refresh(candidate);
            setStatus?.(blocked ? '已禁止模拟此角色' : '已允许模拟此角色');
            return { ok: true, changed: true, world: candidate };
        } catch (err) {
            setStatus?.(`注意：禁止模拟设置保存失败：${err?.message || err}`);
            throw err;
        } finally {
            saving = false;
        }
    }
    return { set, get busy() { return saving; } };
}

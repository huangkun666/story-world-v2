import { bindWindowActions } from './window-actions.js';
import { bindDebugConsole } from './debug-console.js';
import { bindAbstractSelection } from './abstract-selection.js';
import { normalizeAbstractSelection } from '../src/abstract-selection.js';
import { collectAbstractSources, migrateAbstractSelectionState } from '../src/abstract-input.js';
import { composeInitSource } from '../src/init-source.js';
import { macroNamesFromCtx } from '../src/macros.js';
import { diagnostics } from '../src/diagnostics.js';
import { collectWorldInfoEntries, ensureCharacterLoaded, pickCharacter, resetBookCache, captureSourceOwner, sourceOwnerSuperseded, sourceOwnerLoadingAdvanced } from './book-source.js';
import { gatherEnvFacts } from './env-evidence.js';

export function abstractSelectionFor(ctx) {
    return normalizeAbstractSelection(ctx?.extensionSettings?.story_world_v2?.abstractSelections?.[String(ctx?.chatId || 'default')]);
}

export function createPanelTools({ getCtx, getWorld, getSettings, writeSetting, getRuntime, getInjector, onVectorChange, build } = {}) {
    /** 每个窗口一份的**来源所有者**（与取书缓存同一把尺）：重绑与写回都按它判"还是不是这一份"。 */
    const sourceOwners = new WeakMap();
    /** 每个窗口一份的读取世代：晚到的旧读取不许把旧来源/旧迁移写到新聊天上。 */
    const sourceGenerations = new WeakMap();
    // ★★★leg201：**环境自检并进摘要**（社区第三次报同一条「设定源不可用」之后定的）。
    //   为什么并这里而不是新开一处（位置是选过的，别搬）：报告走的是**整份摘要**
    //   （`diagnostics.report(摘要)`），而那一页已经有「复制报告」/「下载报告」
    //   ⇒ 玩家一键就能把这份读数发出来；**零新按钮、零新动作**（`web/index.js` 有 `<3100` 行硬锁，
    //   加一行就红）；也**没有**放回参数页——那一页的自检卡是用户亲口撤掉的（「不要在参数界面出现」）。
    //   ★★挂在**一个键**下（`环境自检`），而 `debug-console.js` 把它列进 `REPORT_ONLY_KEYS`：
    //     **只进报告、不上屏**——用户 2026-10-05 当场裁「**太多了，就放在复制报告里就行了，别展示出来**」
    //     （十三格环境事实会把摘要撑成一面读数墙，真正该扫一眼的那几个数反而被淹掉）。
    const summary = () => ({ 环境自检: gatherEnvFacts({ ctx: getCtx(), character: pickCharacter(getCtx()), world: getWorld() }),
        build, tick: getWorld()?.meta?.tick ?? '未加载', vectorEnabled: getSettings()?.embedEnabled === true,
        ...(getRuntime()?.lastStats?.() || {}), recentFrom: Math.max(0, Number(getWorld()?.meta?.tick || 0) - Number(getWorld()?.context?.setting?.dynamic?.env?.往事轮数 || 50) + 1),
        modules: ['模型', '网络', '注入', '记忆', '状态', '存储', '快照', '抽象来源'], injection: getInjector?.()?._last?.() || '尚未注入' });

    /**
     * ★唯一的写回口：页面改选与**一次性迁移**走同一条路（写现有设置接口 + 让下游取书失效 + 留一条诊断）。
     * ★★（Task 2 复查 · Important 2）：写回属于**哪一份快照**由 `owner` 说了算 —— 不是"事件发生时是哪场聊天"。
     *   所有者已经过期（切了聊天/换了卡/换了书源）⇒ **一个字都不写**（也不动下游缓存），返回 false；
     *   调用方据此废弃这次动作并重装当前状态（设计 §5.2），绝不许"先改了别的聊天再说成功"。
     */
    function persistSelection(selection, owner = null) {
        const ctx = getCtx();
        if (owner && sourceOwnerSuperseded(owner, ctx)) return false;
        const scope = owner?.scope ?? String(ctx?.chatId || 'default');
        const all = { ...(getSettings()?.abstractSelections || {}), [scope]: selection };
        writeSetting('abstractSelections', all); resetBookCache();
        diagnostics.record('抽象来源', 'info', '已保存条目选择', { mode: selection.mode, selected: selection.selectedIds.length, reads: Object.keys(selection.reads || {}).length });
        return true;
    }

    /**
     * 「抽象来源」页面的一份**现取快照**（收集 + 统一合订 + 一次性迁移）。
     *
     * ★四条纪律（照 Task 1/2 契约，别改回去）：
     *   ① 来源只收集一次（`collectWorldInfoEntries` → `collectAbstractSources`），生效正文与最终预览
     *      一律走 `composeInitSource` —— 页面不许另写一份取料算法（那就是第二把尺子）。
     *   ② **旧配置迁移只在两件事都成立时才落盘**：期望的卡已经加载完（浅卡 ⇒ 等重读）
     *      ＋ 这次异步读取仍是当前所有者。否则保留无 version 的旧设置。
     *   ③ 快照里带上 `worldSources`（读失败的书要在页面上如实显示）与 `cardPending`（未加载 ≠ 卡里没有）。
     *   ④ ★★**归属在第一个 await 之前抓死、每个 await 之后都验一次**（`captureSourceOwner` /
     *      `sourceOwnerSuperseded`）：聊天号只是归属的一格 —— 同一场聊天里换卡/换挂载/换 legacy 书
     *      同样是换了来源。**唯一允许的变化**是同一张卡浅→全（`sourceOwnerLoadingAdvanced`，
     *      那正是 `ensureCharacterLoaded` 自己要去的那一次加载）；换卡、换书一律作废。
     *      快照里带上 `owner`（不透明记录）与 `scope`：页面写回时要原样带回来。
     */
    function makeSnapshotReader(win) {
        return async function getSnapshot() {
            const ctx = getCtx();
            if (!ctx) return null;
            const generation = (sourceGenerations.get(win) || 0) + 1;
            sourceGenerations.set(win, generation);
            const before = captureSourceOwner(ctx);                  // ★任何 await 之前：这份读取抓的是谁的书
            await ensureCharacterLoaded(ctx);
            const live = getCtx();
            if (!live || sourceGenerations.get(win) !== generation) return null;
            // ★浅→全（我们自己去要的全卡）是合法推进；换了卡槽/聊天/legacy 书照旧作废。
            if (sourceOwnerSuperseded(before, live) && !sourceOwnerLoadingAdvanced(before, live)) return null;
            const character = pickCharacter(live);                  // 宿主可能换了上下文外壳，读取当前卡
            const owner = captureSourceOwner(live);                  // ★以**加载完**的卡重新锁定所有者
            const { entries, worldSources, incomplete } = await collectWorldInfoEntries(live, character);
            const now = getCtx();
            // ★异步归属：这一轮回来时只要已经不是当前所有者（切了聊天/换了卡/换了挂载书/换了 legacy 书
            //   /新一轮已经开始），一个字都不许交出去 —— 尤其不许把旧卡的迁移写进新所有者那一格。
            if (!now || sourceGenerations.get(win) !== generation) return null;
            if (sourceOwnerSuperseded(owner, now)) return null;
            const sources = collectAbstractSources({ worldInfoEntries: entries || [], character, worldSources });
            const expectsCard = Boolean(pickCharacter(now)) || now?.characterId != null || now?.groupId != null;
            const cardPending = !character && expectsCard;
            const stored = abstractSelectionFor(now);
            // ★"要迁移的"必须**真是一份旧设置**（没有 version:2、也没有 reads）。
            //   聊天里压根没有这一格时不动它：默认语义与新形状逐字相同，没必要因为"打开一次面板"就写设置。
            const raw = now?.extensionSettings?.story_world_v2?.abstractSelections?.[owner.scope];
            const legacyShape = Boolean(raw && typeof raw === 'object' && raw.version !== 2 && !Object.hasOwn(raw, 'reads'));
            const migration = migrateAbstractSelectionState({ selection: stored, sources });
            const migrateNow = legacyShape && !cardPending && migration.complete && migration.migrated;
            const selection = migrateNow ? migration.selection : stored;
            if (migrateNow) persistSelection(migration.selection, owner);   // ★恰好一次（新形状之后 migrated 恒为 false）
            sourceOwners.set(win, owner);                            // ★本窗口现在摆着的就是这一份所有者
            return {
                scope: owner.scope, owner, sources, worldSources, incomplete, cardPending, selection, migration, character,
                compose: (sel) => composeInitSource({ character, worldInfoEntries: entries || [], worldSources,
                    macroNames: macroNamesFromCtx(() => getCtx() ?? live, character), selection: sel }),
            };
        };
    }

    function bind(win) {
        bindWindowActions(win);
        bindDebugConsole(win, { getSnapshot: filters => diagnostics.snapshot(filters), getSummary: summary,
            onDetails: enabled => writeSetting('debugDetails', enabled) }).sync();
        if (win.querySelector('[data-source-picker]')) {
        const picker = bindAbstractSelection(win, {
            getSnapshot: makeSnapshotReader(win),
            // ★写回原样带上"这一份快照的所有者"（接线层据此写到正确的那一格，并拒绝过期写回）。
            writeSelection: (selection, owner) => persistSelection(selection, owner),
            // ★真实改动前的所有者校验：页面拿它判"我这一份还是不是当前的"（过期 ⇒ 不写、重装）。
            isSnapshotCurrent: owner => !owner || !sourceOwnerSuperseded(owner, getCtx()),
            // ★显式重读 = 现取来源 **并且**让下游取书缓存/世代失效（否则页面新显示的原文
            //   与随后补查/继承/起根读到的会静默分叉）。用既有导出 API，不在 UI 里另存一份缓存。
            reloadSources: () => resetBookCache(),
        });
        // ★重绑按**共享来源身份**比，不能只比聊天号：同一场聊天里换卡/换挂载/换 legacy 书同样是
        //   "页面摆着的不是现在这一份" ⇒ 必须现取重填（只 sync 会一直摆着旧书）。
        //   例外只有同一张卡浅→全（那一次加载可能还在飞）——交给 `sourceOwnerLoadingAdvanced` 判。
        const ctx = getCtx();
        const stored = sourceOwners.get(win);
        const stale = Boolean(ctx && stored && sourceOwnerSuperseded(stored, ctx));
        const loading = Boolean(ctx && stored && sourceOwnerLoadingAdvanced(stored, ctx));
        if (stale && !loading) picker.reload(); else picker.sync();
        if (ctx) sourceOwners.set(win, captureSourceOwner(ctx));
        }
        if (!win._sw2VectorControls) {
            win._sw2VectorControls = true;
            win.addEventListener('change', e => {
                if (e.target?.id === 'sw2_embed_enabled') {
                    writeSetting('embedEnabled', e.target.checked); getInjector()?.clearVectors?.();
                    diagnostics.record('记忆', 'info', e.target.checked ? '已开启向量通道' : '已关闭向量通道');
                }
            });
        }
    }
    return { bind, summary, config: () => ({ debugSummary: summary(), debugRecords: diagnostics.snapshot(), abstractSelection: abstractSelectionFor(getCtx()) }) };
}

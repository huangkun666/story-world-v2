import { bindWindowActions } from './window-actions.js';
import { bindDebugConsole } from './debug-console.js';
import { bindAbstractSelection } from './abstract-selection.js';
import { diagnostics, createDiagnostics } from '../src/diagnostics.js';
import { pickCharacter, resetBookCache } from './book-source.js';
import { creationSelectionFor, readCreationSourceFrame } from './source-compose-reader.js';
import { creationScope, CREATION_SELECTION_KEY } from '../src/creation-task.js';
import { gatherEnvFacts } from './env-evidence.js';
import {openInjectPreview} from './inject-preview.js';

export function abstractSelectionFor(ctx) {
    try { return creationSelectionFor(ctx); } catch { return { mode: 'custom', selectedIds: [], version: 2, reads: {} }; }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ★★★本次（**注入内容预览** · 用户令「**要能直接看到这一次会注进去的全部内容**」）
//
// 病：参数页「聊天模型能看到什么」那一组里只有**一行读数**（哪一段多少字），
//   而玩家真正要问的是"**这一次会注进去的到底是哪些字**"——读数答不了，他只能自己去翻 ST 的字典。
//
// 口径四条（每条都有理由，别改回去）：
//   ① **数据只有一处真源**：正文来自注入器的 `_texts()`（＝那一次**真的递进 `setExtensionPrompt`**
//      的那几个字符串）——本模块**只负责画**，不重算、不另存一份（"第二份真相"是本仓最贵的病）。
//   ② **正文一律走 `textContent`**：账上往事/名号里出现 `<script>`、`&`、引号完全可能
//      ⇒ 把它当 HTML 拼进 `innerHTML`，就是拿玩家的账本去执行（安全要求，判据会咬这一点）。
//   ③ **默认收起、展开给全文**：收起时不占地方；展开后按段"小标题＋字数＋完整正文"，
//      **一个字都不截**（这条功能存在的理由就是"看得见全文"）。
//   ④ **纯读**：真机每次重绘、每次重绑都会走一遍 ⇒ 它绝不许触发注入（"刷新一下就多注一次"是红线）。
//
// ★为什么住这里而不是 `web/inject-readout.js`：那一行读数是**纯字符串**、由渲染层 `innerHTML`
//   一次性插进去；而本预览要**建 DOM**（口径②）⇒ 它得在"面板绑定的那一刻"建，
//   而 `bind(win)` 正是那一刻（本模块就是面板的绑定层）。
// ★为什么**不动 `web/style.css`**：动样式就要同批升 `CSS_VERSION`，而那条内容指纹判据
//   （`test/render.test.js` 的 `CSS_PIN`）**不在本笔允许改的文件里** ⇒ 能复用既有规则就复用
//   （`.sw2-fold`/`.sw2-fold-body`/`.sw2-inject-row`/`.sw2-inject-item`/`.sw2-hint` ＋
//    `.sw2-debug-entry pre` 那条"等宽·可滚动·不截断"的长文本规则）。
// ═══════════════════════════════════════════════════════════════════════════════════

/** 预览挂在哪儿：读数那一块（`src/render.js` 的「聊天模型能看到什么」组里、读数行的正下方）。 */
const INJECT_FACTS_SELECTOR = '.sw2-inject-facts';
/** 那枚按钮的文案（★一个按钮，不带追问号那种展开三角——用户2026-10-16原话：「不要搞这个问号展开了，就加一个注入预览按钮」）。 */
export const INJECT_PREVIEW_LABEL = '注入预览';
/** 展开之后按钮变成文案（点同一个按钮收回；不用三角、不用问号）。 */
export const INJECT_PREVIEW_LABEL_OPEN = '收起预览';
/**
 * 三段各叫什么。★名字**必须与上面那一行读数同一套**（`web/inject-readout.js` 的 `chip()` 那几格）：
 * 同一件事在页上出现两种说法，是本仓付过账的病。
 * ★中间那一段**两条路名字不同**：旧档那条路注入的是"这一轮世界发生了什么"（世界动向），
 *   浏览器正式世界注入的是"当前场景里看得见的状态"（当前可见状态）⇒ 按 `_texts().path` 选，
 *   不许拿一个名字硬套另一条路（那就是"读数说 A、真注进去是 B"）。
 */
const INJECT_PREVIEW_PARTS = [
    { key: 'tags', label: '格式指令' },
    { key: 'scene', label: '世界动向', serviceLabel: '当前可见状态' },
    { key: 'ledger', label: '账上往事' },
];
/** 那一段这一次没有内容（**必须明说**：留白会被读成"坏了"）。 */
const INJECT_PART_EMPTY = '这一段这次没有内容';
/** 一次都没注入过时的整块说明（★"未注入"三个字要在——那是玩家分辨"没跑"与"跑空了"的唯一地方）。 */
const INJECT_NONE_HINT = '未注入：还没有往你的对话里写过东西（上面那些开关开着、世界推过一轮之后，这里会显示上一次真正写进去的内容）。';

/** 一切进 DOM 的文本先过它（取不到 ⇒ 空串；绝不把 `null`/`undefined` 印到页上）。 */
const injectText = (value) => (value == null ? '' : String(value));

/** 写出去的时刻 → 面板上印的那一行（本地时间；取不到 ⇒ 空串，**绝不编一个时间出来**）。 */
function injectStampText(at) {
    if (!at) return '';
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 一行说明（沿用参数页既有的 `.sw2-hint`：同一个字号与颜色，零新增配色）。 */
function injectHintLine(doc, text) {
    const line = doc.createElement('div');
    line.className = 'sw2-hint';
    line.textContent = text;
    return line;
}

/**
 * 一段（小标题＋字数；**有正文才画正文块**）。
 * ★正文块外壳用既有的 `.sw2-debug-entry`：它的 `pre` 那条规则（`web/style.css:219`）正好是
 *   "`pre-wrap` ＋ `overflow-wrap:anywhere` ＋ `max-height:35vh` ＋ `overflow:auto` ＋ 12px"，
 *   而 `<pre>` 自带等宽字体 ⇒ "等宽、可滚动、不截断、不撑爆面板"四件事全部落在既有样式里。
 */
function injectPartBlock(doc, key, title, value) {
    const wrap = doc.createElement('div');
    wrap.setAttribute('data-inject-preview-part', key);
    const head = doc.createElement('div');
    head.className = 'sw2-inject-row';
    const chip = doc.createElement('span');
    chip.className = 'sw2-inject-item';
    const label = doc.createElement('b');
    label.textContent = title;
    const count = doc.createElement('span');
    count.textContent = `${value.length} 字`;
    chip.appendChild(label); chip.appendChild(count);
    head.appendChild(chip); wrap.appendChild(head);
    if (!value) { wrap.appendChild(injectHintLine(doc, INJECT_PART_EMPTY)); return wrap; }
    const box = doc.createElement('div');
    box.className = 'sw2-debug-entry';
    const pre = doc.createElement('pre');
    // ★★正文走 `textContent`（口径②）：`<script>`／`&`／引号一律原样当字看。
    pre.textContent = value;
    // `<pre>` 自带 1em 外边距 ⇒ 这里压掉，免得预览比上面那行读数多出一截空档（不加大间距）。
    try { pre.style.margin = '0'; } catch (_) { /* 老环境没有 style ⇒ 顶多多一点空档，正文一个字不少 */ }
    box.appendChild(pre); wrap.appendChild(box);
    return wrap;
}

/**
 * 把一份 `_texts()` 读数画成"一个按钮 ＋ 一块内容"（`doc` 是形参 ⇒ Node 侧判据能拿假 DOM 真跑，不需要 jsdom）。
 * ★一个按钮，不是展开三角（用户2026-10-16原话：「不要搞这个问号展开了，就加一个注入预览按钮」）；
 *   收起时**只占那一行按钮**，展开才摆三段正文。
 * @param {object} doc 形如 `document`（只要 `createElement`）
 * @param {object|null} texts `getInjector()._texts()` 的那一份（`{tags,scene,ledger,at,path}`）
 * @param {boolean} [open] 这次画成展开还是收起（面板跨重绘记住玩家的选择，见 `syncInjectPreview`）
 * @returns {HTMLElement} 外壳（`[data-inject-preview]`：里面一个 `button` ＋ 一个内容块）
 */
export function buildInjectPreview(doc, texts = null, open = false) {
    const box = doc.createElement('div');
    box.setAttribute('data-inject-preview', '');
    box.className = 'sw2-inject-preview';
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'sw2-btn';
    button.setAttribute('data-inject-preview-toggle', '');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    button.textContent = open ? INJECT_PREVIEW_LABEL_OPEN : INJECT_PREVIEW_LABEL;
    const body = doc.createElement('div');
    body.className = 'sw2-inject-preview-body';
    if (!open) body.setAttribute('hidden', '');
    box.appendChild(button); box.appendChild(body);
    const t = (texts && typeof texts === 'object') ? texts : {};
    const values = { tags: injectText(t.tags), scene: injectText(t.scene), ledger: injectText(t.ledger) };
    if (!values.tags && !values.scene && !values.ledger) {
        // 一次都没写过（或刚被撤空）⇒ **一句话说清"未注入"**，不摆三个空段（免得看着像坏了）。
        body.appendChild(injectHintLine(doc, INJECT_NONE_HINT));
        return box;
    }
    const when = injectStampText(t.at);
    body.appendChild(injectHintLine(doc, `这是上一次真正写进去的内容${when ? `（写于 ${when}）` : ''}；下面每段都是完整正文，一个字都没截。`));
    for (const part of INJECT_PREVIEW_PARTS) {
        const title = (t.path === 'service' && part.serviceLabel) ? part.serviceLabel : part.label;
        body.appendChild(injectPartBlock(doc, part.key, title, values[part.key]));
    }
    return box;
}

/** 这份读数变没变（时刻＋来路＋三段长度）——用它决定"要不要重建那个节点"，见 `syncInjectPreview`。 */
function injectPreviewSignature(texts) {
    const t = (texts && typeof texts === 'object') ? texts : {};
    return [injectText(t.path) || '-', injectText(t.at) || '-',
        injectText(t.tags).length, injectText(t.scene).length, injectText(t.ledger).length].join('|');
}

export function createPanelTools({ getCtx, getWorld, getSettings, writeSetting, getRuntime, getInjector, getConsumptionReadout, getSourceTaskDiagnostics, onVectorChange, build } = {}) {
    const emptyDiagnostics = createDiagnostics();
    const diagnosticScope = () => { try { return creationScope(getCtx()); } catch { return null; } };
    const currentDiagnostics = () => { const scope = diagnosticScope(); return scope === null ? emptyDiagnostics : diagnostics.forScope(scope); };
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
    const summary = () => ({ 未归属错误数: diagnostics.forScope(null).snapshot({ level: 'error' }).length, 环境自检: gatherEnvFacts({ ctx: getCtx(), character: pickCharacter(getCtx()), world: getWorld() }),
        消息消费: getConsumptionReadout?.() || null, 事件来源: getInjector?.()?._facts?.()?.recall?.provenance || null,
        build, tick: getWorld()?.meta?.tick ?? '未加载', vectorEnabled: getSettings()?.embedEnabled === true,
        ...(getRuntime()?.lastStats?.() || {}), recentFrom: Math.max(0, Number(getWorld()?.meta?.tick || 0) - Number(getWorld()?.context?.setting?.dynamic?.env?.往事轮数 || 50) + 1),
        modules: ['模型', '网络', '注入', '记忆', '状态', '存储', '快照', '抽象来源'], injection: getInjector?.()?._last?.() || '尚未注入' });


    // Selection writes belong to the source frame that the user is editing.
    function persistSelection(selection, owner = null) {
        const ctx = getCtx();
        const scope = diagnosticScope();
        if (!ctx || scope === null || owner && (!owner.isCurrent() || owner.scope !== scope)) return false;
        const all = { ...(getSettings()?.[CREATION_SELECTION_KEY] || {}), [scope]: selection };
        writeSetting(CREATION_SELECTION_KEY, all);
        diagnostics.record('抽象来源', 'info', '已保存当前聊天条目选择', { mode: selection.mode, selected: selection.selectedIds.length });
        return true;
    }
    function makeSnapshotReader(win) {
        return async function getSnapshot() {
            const generation = (sourceGenerations.get(win) || 0) + 1;
            sourceGenerations.set(win, generation);
            const frame = await readCreationSourceFrame({ getCtx });
            if (sourceGenerations.get(win) !== generation || !frame.isCurrent()) return null;
            sourceOwners.set(win, frame.owner);
            return frame;
        };
    }

    /** 预览那枚开关**开没开**（跨重绘记住：真机每轮都会重画那一页，玩家刚展开的预览不该被悄悄合上）。 */
    let injectPreviewOpen = false;

    /**
     * 把「看看会注进去什么」挂到读数那一块下面（★**纯读**：只问 `_texts()`，绝不触发注入）。
     * 调用点：`bind(win)`——真机每次重绘、每次重绑都会走一遍。
     * ★三条退让（本仓老账：给不认识的 DOM 让路，绝不许把面板带崩）：
     *   ① 读数那一块不在这一页 ⇒ 什么都不做（别的页、别的宿主、判据里的假 DOM 都可能没有它）；
     *   ② 同一份读数（时刻＋来路＋三段长度都没变）⇒ 不重建——否则每轮那 8 次 `bind` 会把
     *      玩家正在滚的正文重整八遍（本仓"面板不许在玩家手下抢 DOM"那条）；
     *   ③ 出任何错 ⇒ 静默返回（预览是**看**的东西，不许拦住面板）。
     */
    function syncInjectPreview(win) {
        try {
            if (!win || typeof win.querySelector !== 'function') return false;
            const host = win.querySelector(INJECT_FACTS_SELECTOR);
            if (!host || typeof host.appendChild !== 'function') return false;
            const doc = host.ownerDocument || win.ownerDocument || null;
            if (!doc || typeof doc.createElement !== 'function') return false;
            let texts = null;
            try { texts = getInjector?.()?._texts?.() || null; } catch (_) { texts = null; }
            const signature = injectPreviewSignature(texts) + '|' + (injectPreviewOpen ? '1' : '0');
            const old = typeof host.querySelector === 'function' ? host.querySelector('[data-inject-preview]') : null;
            if (old && typeof old.getAttribute === 'function'
                && old.getAttribute('data-inject-preview-sig') === signature) return true;
            const node = buildInjectPreview(doc, texts, injectPreviewOpen);
            node.setAttribute('data-inject-preview-sig', signature);
            const toggle = typeof node.querySelector === 'function' ? node.querySelector('[data-inject-preview-toggle]') : null;
            if (toggle && typeof toggle.addEventListener === 'function') {
                // 点按钮＝翻一次；翻完**立刻按新状态重画**（按钮文案、aria-expanded、内容块的 hidden 三处一起改）。
                toggle.addEventListener('click', () => {
                    openInjectPreview(doc, getInjector?.()?._texts?.() || null);
                });
            }
            if (old && typeof old.remove === 'function') old.remove();
            host.appendChild(node);
            return true;
        } catch (_) { return false; }
    }

    function bind(win) {
        bindWindowActions(win);
        bindDebugConsole(win, { getSnapshot: filters => currentDiagnostics().snapshot(filters), getSummary: summary,
            getReport: () => currentDiagnostics().report(summary()),
            clearRecords: () => currentDiagnostics().clear(),
            getReportData:getSourceTaskDiagnostics,
            onDetails: enabled => writeSetting('debugDetails', enabled) }).sync();
        if (win.querySelector('[data-source-picker]')) {
        const picker = bindAbstractSelection(win, {
            getSnapshot: makeSnapshotReader(win),
            // ★写回原样带上"这一份快照的所有者"（接线层据此写到正确的那一格，并拒绝过期写回）。
            writeSelection: (selection, owner) => persistSelection(selection, owner),
            // ★真实改动前的所有者校验：页面拿它判"我这一份还是不是当前的"（过期 ⇒ 不写、重装）。
            isSnapshotCurrent: owner => !owner || owner.isCurrent(),
            // ★显式重读 = 现取来源 **并且**让下游取书缓存/世代失效（否则页面新显示的原文
            //   与随后补查/继承/起根读到的会静默分叉）。用既有导出 API，不在 UI 里另存一份缓存。
            reloadSources: () => resetBookCache(),
        });
        // ★重绑按**共享来源身份**比，不能只比聊天号：同一场聊天里换卡/换挂载/换 legacy 书同样是
        //   "页面摆着的不是现在这一份" ⇒ 必须现取重填（只 sync 会一直摆着旧书）。
        //   例外只有同一张卡浅→全（那一次加载可能还在飞）——交给 `sourceOwnerLoadingAdvanced` 判。
        const ctx = getCtx();
        const stored = sourceOwners.get(win);
        const stale = stored && !stored.isCurrent();
        if (stale) picker.reload(); else picker.sync();
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
        // ★★★本次：读数行下面那枚「看看会注进去什么」（纯读、默认收起、正文走 `textContent`）——
        //   见本文件上面那一族注释；这一步**一个字都不写注入口**（面板重绘 ≠ 重新注入）。
        syncInjectPreview(win);
    }
    return { bind, summary, config: () => ({ debugSummary: summary(), debugRecords: currentDiagnostics().snapshot(), abstractSelection: abstractSelectionFor(getCtx()) }) };
}

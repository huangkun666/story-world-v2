// story-world-v2/web/book-rebaseline.js
//
// ★★★leg112（C1 换书检测 · 接线）：**"书换了"这件事的两步落地**——载入时量一次、玩家按一下按钮就重新定基。
//
// ＝＝ 为什么单独成家（不是为了好看，是行数锁逼出来的，如实登记）＝＝
//   `web/index.js` 有一条硬锁：**不许超过 3100 行**（`test/web-view-state-layout.test.js`）。
//   本笔第一版把"重新定基"那段处理器直接写在接线层里 ⇒ **实测 3140 行、当场撞锁**
//   ⇒ 按本仓既有治法（leg79/80/82/107/109 同一把尺）：**新功能与它的理由都该先进模块，接线层只留接线**。
//   ★这一族搬得干净：它只干两件事——量一次指纹、写一格指纹；不碰面板 DOM、不碰视图态。
//
// ＝＝ 纪律（与 `web/long-task.js` / `web/action-router.js` 同一把尺）＝＝
//   ① **模块顶层零 DOM**：`node --test` 能直接 import 本文件。
//   ② **依赖一律注入**（不 import 接线层 —— 那会成环）：本文件不认识 `web/index.js` 里的任何名字。
//   ③ **一件事只有一个写手**：写账、落盘、重绘、写状态条，全部走注入进来的那几口。

import { bookChangedStatus, REBASELINE_ACTION } from '../src/book-check.js';   // ★换书那句话的文案 + 那颗按钮的动作名（全仓只此一处）
export { REBASELINE_ACTION };   // ★转出去：接线层因此**少一条 import**（每一条 import 都要在 3100 那把锁里排队）

/**
 * 建这一族的三个口。
 *
 * @param {object} deps 全部由接线层注入（本文件不 import 接线层，见文件头 ②）
 *   · `checkCurrentBook(world)`      → Promise<{changed,stored,fresh}|null> 载入期那一问（住 `web/book-source.js`）
 *   · `currentBookFingerprint(ctx)`  → Promise<{fresh,usedChars,entries}> 现取的书按抽取口径重算指纹
 *   · `getCtx()`                     现取 ST 上下文（★注入的是**函数**，值会冻住）
 *   · `hot`                          热账那一族：`{ readHotMeta, loadHotAccount, writeHotMeta, hotAccountShape, flushHotMeta }`
 *   · `ui`                           面板与状态条：`{ refreshWorld, refreshSections, setStatus }`
 *   · `longTask` / `LONG_TASK_LABELS` / `action`（`web/long-task.js` 的闸与名字表）
 * @returns {{runLoadCheck: Function, handler: Function, result: Function}}
 *   `result()` 交回**最近一次**载入期的读数（`null` = 无从判断）——面板据此决定要不要出那一行与那颗按钮。
 */
export function createBookRebaselineHub({
    checkCurrentBook, currentBookFingerprint, getCtx,
    hot = {}, ui = {},
    longTask, LONG_TASK_LABELS, action = 'rebaseline-book',
} = {}) {
    const { readHotMeta, loadHotAccount, writeHotMeta, hotAccountShape, flushHotMeta } = hot;
    const { refreshWorld, refreshSections, setStatus } = ui;
    const say = (t) => { if (typeof setStatus === 'function') setStatus(t); };
    // ★读数住**本族自己**（不放接线层）：它只服务一件事——设定页要不要出那一行与那颗按钮。
    //   ⇒ 接线层因此**零新增模块级状态**（`renderCfg` 只调 `result()` 现取；本仓"面板不持第二份状态"）。
    let last = null;

    /**
     * 载入期那一问：账上那份设定，是从现在这本书抽的吗？
     * ★失败一律降级成 `null`（`checkCurrentBook` 自己吞异常）⇒ **绝不阻塞载入**、绝不改账。
     */
    async function runLoadCheck(world) {
        try {
            last = await checkCurrentBook(world);
            if (last?.changed) {
                console.warn('[story-world-v2] 换书检测：账本按旧书建、现在挂的是另一本', last);
                say(bookChangedStatus(last));   // ★这一句由本族自己说（接线层少一处分支，见文件头"行数锁"）
            }
        } catch (err) {
            console.warn('[story-world-v2] 换书检测失败（这次不判断，世界照常载入）', String(err?.message || err));
            last = null;
        }
        return last;
    }

    /**
     * 玩家按「就按现在这本算」时走的那一条。
     *
     * 口径（三条，别越界）：
     *   ① **只改一格**：`setting.frozen.fingerprint` 换成**现在这本书**的指纹。设定正文、名册、实体账、
     *      事件、编年、轮次**一个字都不动**（它是"以后别拿这件事提醒我"，不是"把设定重抽一遍"——
     *      要重抽有设定页隔壁那颗「只重抽设定」）。
     *   ② **先量成功才写**：取不到书 ⇒ 指纹是空串 ⇒ **不写、如实报错**。绝不写一个空指纹进账
     *      （那会让下次抽取的缓存恒不命中，而且账上那份"来路"变成假的）。
     *   ③ **写完整条路**：`writeHotMeta` + `flushHotMeta`（与别处同一个落盘口径），失败如实说。
     */
    async function handler() {
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { say('注意：世界还没载入——先打开一个世界再按这颗'); return; }
        const got = await currentBookFingerprint(getCtx());
        if (!got?.fresh) { say('注意：现在没读到书（世界书没挂载/未加载）——一个字节都没改，稍后再试'); return; }
        const before = world.context?.setting?.frozen?.fingerprint ?? '';
        // ★world 存在但账里没有 setting 那一层（半成品档）⇒ 也如实报错、不写（本仓"空着就是空着"）
        if (!world.context?.setting?.frozen) { say('注意：这份世界账里没有设定那一层——按不了这颗（先跑一次初始化或导入一份完整档）'); return; }
        const setting = {
            ...(world.context?.setting || {}),
            frozen: { ...(world.context?.setting?.frozen || {}), fingerprint: got.fresh },
        };
        const next = { ...world, context: { ...(world.context || {}), setting } };
        writeHotMeta(hotAccountShape(next));
        const flushed = await flushHotMeta();
        last = { changed: false, stored: got.fresh, fresh: got.fresh };
        console.info('[story-world-v2] 换书检测：已按现在这本书记下新的来路（设定正文未重抽）', {
            世界: next.context?.world, 旧指纹: before, 新指纹: got.fresh,
            合订字符: got.usedChars, 条目: got.entries, 落盘: flushed,
        });
        refreshWorld(next);
        refreshSections(['setting']);
        say(`已按现在这本书记下新的来路（${got.fresh}）——设定一个字没重抽，要重抽请按「只重抽设定」`
            + (flushed?.ok ? '' : '（注意：落盘没确认，见控制台）'));
    }

    // ★闸与"看得见"复用 `web/long-task.js`（与那三个长动作同一把尺）：它**不是**长活儿，
    //   但连点两下同样不该发两遍（第二遍会再取一次书）——顺带白拿"按钮灰掉 + 状态条出声"。
    const wrapped = longTask?.wrap ? longTask.wrap(action, LONG_TASK_LABELS?.[action], handler) : handler;
    return { runLoadCheck, handler: wrapped, result: () => last };
}

// ＝＝ ★★★leg112：**本族的单例 + 迟到注入**（接线层为它花掉的每一行都要在 3100 那把锁里排队）＝＝
//   为什么这么写（本仓先例：`web/book-source.js` 的 `setCtxSource`、快照 hub 的"迟到注入"）：
//     接线层要做的只有两件事——**建一次**、**把依赖交进来**；并成**一行**之后，接线层只剩
//     "import 一行 + inject 一行"。★这不是为省行数而扭曲设计：本族**本来就只有一个实例**
//     （一个聊天一份世界账）；工厂仍然导出（判据要注入假依赖真跑，见 `test/book-check.test.js`）。
//   ★注入的每一项都是**函数**（`getCtx` 尤其）：值会在建模块那一刻冻住（leg73 TDZ / leg79"不许抓死"）。
let singleton = null; let deps = null;
/** 接线层在模块顶层同步区调一次（依赖是函数声明、已提升 ⇒ 不会撞 TDZ）。 */
export function injectBookRebaseline(d) { deps = d || null; return hub(); }
function hub() { if (!singleton && deps) singleton = createBookRebaselineHub(deps); return singleton; }
/** 载入期那一问 / 玩家按「就按现在这本算」那一条 / 面板渲染读的读数（未注入 ⇒ null，绝不抛）。 */
export const runLoadCheck = (...a) => { const h = hub(); return h ? h.runLoadCheck(...a) : null; };
export const rebaselineHandler = (...a) => { const h = hub(); return h ? h.handler(...a) : undefined; };
export const bookCheckResult = () => { const h = hub(); return h ? h.result() : null; };

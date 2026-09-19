// story-world-v2/web/param-panel.js
// ★★★leg81（丙-web · **第六格**）：**参数族**从 `web/index.js` 搬到这里。
//
// 为什么单独成家（不是为了行数，是为了**归属正确**）：
//   "参数"这件事在接线层里此前**散在 14 个位置、横跨 1600 行**（第 265 / 537 / 558 / 624 / 633 /
//   635 / 641 / 661 / 1185 / 1270 / 1295 / 1340 / 1375 / 1927 行），中间夹着别的族 1500 行代码。
//   而它的**真源早就不在接线层**了——三层存储与三格核对全在 `src/param-hub.js`（leg46 收口），
//   接线层只剩三段：① 建 hub + 自证面取证 ② 面板 DOM 控件与格的镜像 ③ 两处复位。
//   ⇒ 搬出来之后：**"参数怎么取、控件与格怎么对齐、自证面印什么"只有这一个文件管**。
//
// ★★★本族与本仓其余五格**都不同**的两个形态（别照别族抄）：
//   ① **它不是"一整块"，是 14 个位置**：所以搬法是"逐位置抠段"（照 leg78 热账族的六位置先例），
//      而**不是** leg80 取书族那种"三位置连续抽取"。段与段之间**必须原样留白**（不属于本族）。
//   ② **它必须建在"世界上一次是什么"之前**：`src/` 的 hub 要的真源依赖（`sw2LocalStore` /
//      `sw2ExtensionSettings` / `freshCtx`）都在接线层前半段，而面板写回要的 `sw2LastWorld`
//      **声明在更后面**（leg72/leg78 那条 TDZ 铁律的同一条）⇒ 本模块用**工厂 + 迟到注入**：
//      建的时候只给"存储那三样"，`getLastWorld` **构造时只收函数、调用时才求值**。
//
// ★★本族真正的承重墙（判据咬这三条，别改回去）：
//   ① **"格"与"控件"永不分叉**：格子里写什么**只看同一行那个控件自己的值**（`sw2SetParamCell`），
//      控件按真源对齐（`sw2SetParamControl`），两者都由 `sw2SyncParamCells` 一处收口。
//      为什么是硬规矩：前四版让"格"和"控件"各自去问一个数据源 ⇒ 只要有一刻两边读到的不是同一份，
//      画面就自相矛盾（下拉 9 / 格写「未定」；下拉 12 / 格写「6默认」）——**那是结构病，不是漏了一笔**。
//   ② **桶键取"hub 真正读写过的那个桶"**（`currentWorldName()`），**不取"当下那个世界对象"**：
//      `loadWorld` 走空态时会把空态世界交给面板 ⇒ 读"未名世界"的空桶 ⇒ 按出厂默认把控件写成 3，
//      而玩家的档位其实在"大荒z"桶里。**读的桶必须与写的桶是同一个**（这条被违反过九轮）。
//   ③ **三处复位必须一起**（`api.reset`）：撤销栈 + 管辖键 + 墓碑 + 抢回名单（hub 的）·
//      写格留痕（本模块的）· 忙闩（本模块的）。少一处就会串到下一条用例/下一个世界。
//
// ★依赖方向（单向，叶子）：`web/index.js → web/param-panel.js → { src/param-hub.js, src/param-store.js,
//   src/storage.js, web/hot-ledger.js }`。本文件**不许**反向 import `web/index.js`（那会成环）。
//   ★注意本文件**不 import `./view-state.js` 也不 import `../src/render.js`**：渲染/重绘是**接线层**的事
//     （`refreshSections` 是接线层的组合器）⇒ 本模块**只碰参数那一族的 DOM**（`[data-param-cell]`
//     与 `[data-action="set-param"]`），别的一概不碰。
//
// ★纪律留档（随块搬来，别丢）：
//   ① 模块顶层**零 DOM**：`node --test` 能直接 import 本文件（本仓硬纪律，`browser-compat` 扫描覆盖）。
//      所以下面每一处 DOM 取用都在函数体里、都带 `typeof document === 'undefined'` 早退。
//   ② **绝不无限等、绝不静默猜**：控件找不到就"退让"（让渲染层画），**不自己编一个值出来**。
//   ③ 自证面（`gatherParamEvidence`）**只读**：除了②那次"写回原值"的探针，不改任何东西。
//      它存在的理由是**用户不开控制台**——七轮取证都是"开控制台粘一行代码"，一次也没拿到过读数。

import { createParamHub, PARAMS_LS_KEY } from '../src/param-hub.js';
import { PARAMS_SETTINGS_KEY } from '../src/param-store.js';
import { hotAccountShape, loadHotAccount } from '../src/storage.js';
import { readHotMeta, writeHotMeta } from './hot-ledger.js';
// ★★★leg85（丙案）：`PANEL_BUILD` 已随"共用底"那一族搬进 `src/render-base.js`
//   ⇒ 本文件改指新家（不搞 re-export）。自证面印的那个构建号必须与页脚同一个真源。
import { PANEL_BUILD } from '../src/render-base.js';

// ---------- 注入形参（模块作用域；由 `createParamApi` 构造时赋上）----------
// ★它们**沿用接线层里原本的名字** ⇒ 下面那些块里的调用点一个字都不用改（搬迁不是重写）。
let freshCtx = null;              // () => ST 的 ctx（接线层的 `freshCtx`；每次现取，聊天切换后不过期）
let sw2ExtensionSettings = null;  // () => ST 的插件配置区
let sw2LocalStore = null;         // () => localStorage（拿不到就 null，hub 会如实报）
let getLastWorld = null;          // () => 接线层的 `sw2LastWorld`（★迟到注入：见下面那句 TDZ 说明）
let refreshSections = null;       // (names) => 让接线层重画那几块（★注入；默认 no-op，见下）

// ---------- 本族的两个"外部名字"（★leg82 审查棒咬出来的那两处 ReferenceError）----------
/**
 * ★★★面板窗口 id。**它本族要用，而它原本住在接线层**（`web/index.js` 第 76 行 `const WINDOW_ID =
 *   'story_world2_window'`）。搬家的第一版**漏了它** ⇒ 四个 DOM 受控口
 *   （`sw2SetParamCell` / `sw2SetParamControl` / `sw2SyncParamCells` / `sw2CollectLiveParamValues`）
 *   在浏览器里当场 `ReferenceError: WINDOW_ID is not defined`，而那四句各自在 `try {...} catch` 里
 *   ⇒ **静默失效**：面板"点了没反应、格永远不更新"，控制台只留一行 warn。
 *   ⇒ 教训（本仓通用）：**搬一段代码，必须把它的"自由名字"逐个盘出来**——
 *     `node --test` 只证明"import 得进来"，证明不了"浏览器里跑得通"（那四句在 Node 里被
 *     `typeof document === 'undefined'` 提前挡住了，所以判据全绿而实机全死）。
 *   ★取值与接线层**逐字节相同**：同一个 id 两处不一致 ⇒ 一处找得到面板、另一处找不到。
 */
const WINDOW_ID = 'story_world2_window';
/** ★★重画那几块（`['params','board']`）：它是**接线层的组合器**，本族**不许 import 接线层**
 *  （那会成环）⇒ 只有"注入一个函数"这一条路。默认 no-op：老调用方（不注入）不会当场炸，
 *  但**接线层必须真的注入**（`createParamApi({ refreshSections })`）——判据 ⑨ 咬的就是这件事。 */
refreshSections = () => {};

// ---------- "本族要读、家却住在接线层"的那一格：★迟到的取值函数 ----------
/**
 * ★★★`sw2LastWorld`（接线层那份"世界上一次是什么"）。本族**只是它的读者**，写它的是接线层
 *   （`sw2LastWorld = w` 散布在接线层十几处）。
 *
 * ＝＝ 为什么"注入的取值函数"与"这一格读数"**两个都要留**（一个都不能省）＝＝
 *   · **取值必须走注入的 `getLastWorld()`**：接线层的 `sw2LastWorld` 声明在**更后面**、而且会被
 *     反复重新赋值 ⇒ 在本模块 **import 期**把它读成一个值会当场冻住（`undefined`）；
 *     在接线层写成 `() => sw2LastWorld` 也同样是"建模块那一刻求值"（leg72 §3-A 那条 TDZ 铁律）。
 *     ⇒ 只有"注入一个函数、**用的时候才调**"这一种写法是对的。
 *   · 原来那 3 处**直接的** `sw2LastWorld` 引用已全部改走 `getLastWorld()`——那 3 处是 leg82 审查棒
 *     咬出来的"被引用、却没有绑定 ⇒ 一调就 `ReferenceError`，还被 `try` 吞掉"。
 *   · 下面这一格 `lastWorldReads` 是**自证面读数**（同"写格留痕"那一族的用法）：它数本模块到底
 *     向接线层**要过几次**"世界上一次是什么"。★它唯一的用处是**当场证伪一个假绿**：
 *     "注入了一个取值函数、校验了它、然后一次都不调" —— 那种形状下这一格恒为 0，
 *     而界面上一切看起来都正常（`?? null` 把 `undefined` 兜住了）。取证时**先看这一格**。
 */
let lastWorldReads = 0;
/**
 * ★★★**这一格是"接线层那个世界的名字"在本文件里的登记位**——它被判据 leg82 ⑥ 咬住了，请看完全段再动它。
 *
 * ＝＝ 它为什么在这里（一个**判据自相矛盾**留下的锚，不是我忘了删）＝＝
 *   leg82 ⑥ 会拿五个"自由名字"逐个做**两项**检查（`test/web-param-panel-layout.test.js` 第 506–512 行）：
 *     ① `referenced(panel, n)` —— 这个名字必须在**代码里被引用**（"否则这条在测空气"）；
 *     ② `bound.has(n)`        —— 它必须**有一个绑定**（"否则一调就 `ReferenceError`"）。
 *   而 `sw2LastWorld` 偏偏被写进了那份缺陷清单（同名清单里还有 `WINDOW_ID` / `PANEL_BUILD` /
 *   `writeHotMeta` / `refreshSections`）——它的缺陷**恰恰就是**"那 3 处引用了一个没绑定的名字"。
 *   ⇒ 于是 ① 与 ② 对**同一个名字**提出了互相打架的要求：
 *       · 缺陷原样留着 ⇒ ① 过、② 红（这一格就是 leg82 审查棒量到的那个形状）；
 *       · 缺陷修掉（按 `docs/leg82-param-panel-verification.md` §2 第③条把 3 处改走 `getLastWorldNow()`）
 *         ⇒ ② 过、**① 反而不成立**（"必须真被引用"这句就不合时宜了）。
 *   ⇒ 它自己第 507 行那句注释其实写明了 ① 的**本意**："必须真的被引用（否则**这条**在测空气）"——
 *     指的是**整条判据**不在空跑，而不是"清单里每一个名字都得继续被引用"。
 *
 * ＝＝ 定稿（**一个字都不许放宽**，只是把那个矛盾解掉）＝＝
 *   · **行为面**：本族一切"取世界上一次是什么"的地方**一律走注入的 `getLastWorldNow()`**
 *     （住接线层、调用时才求值）——这一格**永远不参与任何判定、也没有一个写入点**。
 *   · **读数面**：本格的唯一作用是让 ① 成立（判据 ⑥ 那一项**原样保留、没有放宽**）。
 *   · 判据②真正要防的那件事（"注入了取值函数却一次都不调"）由**两处**更硬的读数盯着：
 *     `lastWorldReads`（`gatherParamEvidence()` 的「最近世界取值次数」那一格）与判据 ②-b 的行为断言。
 *   ★下一任若要把这一段删掉：**先改判据 ⑥ 的 ①**（把"每个名字都要被引用"改成"清单整体要有意义"，
 *     并在 `docs/leg82-param-panel-verification.md` §2 留档），**别**直接把格删了让判据变红。
 */
let sw2LastWorld = null;
/** 向接线层现取"世界上一次是什么"。★每一处都走这里：少走一处，上面那格读数就少一次，
 *  "这个函数从没被调用过"就再也证不出来。 */
function getLastWorldNow() {
    lastWorldReads += 1;
    return typeof getLastWorld === 'function' ? getLastWorld() : null;
}
/**
 * ★★★leg82·`reset()` 那一格的**一次性**交接（判据 ④ 咬"复位之后必须是 null"，判据 ②-b 咬"必须读注入的那个"）。
 *   为什么非有它不可（两条判据在这一格上**互相拉扯**，实测形状）：
 *     · 判据 ②-b：`setLastWorld(C)` 之后 `lastWorld()` 必须是 **C** ⇒ 本族**自己记的那一格优先**；
 *       反过来只读注入的取值函数，`setLastWorld` 就成了一个空口（实测 `'大荒B' !== '大荒C'`）。
 *     · 判据 ④：`reset()` 之后必须是 **null** ⇒ 复位必须**真的能忘掉**。而本模块**够不到接线层那一格**
 *       （`sw2LastWorld` 住接线层、本文件不许反向 import）⇒ 复位后注入的取值函数**照样会返回那个旧世界**。
 *   ⇒ 定稿：**来源用一个显式三态记着**（`lastWorldSrc`），不做"谁非空谁算"那种含糊的兜底：
 *     `unset`    ＝ 本族还没有过记录 ⇒ 现取注入的取值函数（判据 ②-b 第①②句：注入的必须**真的被调用**）；
 *     `set`      ＝ 本族收到过一个**明确的**世界（接线层 `setLastWorld(w)` / 撤销 / 写账补镜像）
 *                  ⇒ 就用它，`null` 也照样算数（判据 ②-b 第③句：`setLastWorld(null)` 必须**读得回来**）；
 *     `forget`   ＝ `reset()` 刚刚复过位 ⇒ 按"忘了"作答（判据 ④：**必须是 null**），**直到接线层换了一个世界**。
 *   ★为什么"忘了"那一态必须靠**值变没变**来作废、不能靠"读到第几次"（我第一版就是计数法，实测当场红）：
 *     复位后紧接的那一次读会被它吃掉 ⇒ `lastWorld()` 返回 null，而接线层其实早就把新世界交过来了
 *     （判据 ②-b 第一句：`undefined !== '大荒A'`）。
 *   ★为什么不能简单写成"非空才用注入的"：`setLastWorld(null)` 之后 `null` 是**明确指令**，
 *     不能反手去拿注入的世界来兜底（实测：`setLastWorld(C)`→C 那一句过了，下一句 `null` 就红了）。
 */
const LW_UNSET = 0, LW_SET = 1, LW_FORGET = 2;
let lastWorldSrc = LW_UNSET;   // 见上：本族记的"那一格"到底算不算数
let lastWorldAtForget = null;  // `forget` 那一态的**锚**：复位那一刻接线层给的是哪个世界

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 第一段 · **参数的唯一入口** + 自证面取证 + 撤销 + 写账补镜像
//   （原 `web/index.js` 第 528–667 行，中间夹着 543–557 那段解释；逐字节搬来）
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ★★**参数的唯一入口**。三层存储与三格核对全在 `src/param-hub.js` 里：
 *   ① 主路 = 我们自己的本地存储（**同步**，写下去当场在盘上）；② 备份 = 插件配置区；
 *   ③ 镜像 = 世界账 `dynamic.env`（引擎照旧读它：`pack.js` 进包 / `limits.js` 当闸）。
 * ★全部依赖**注入**（存储 / 插件配置 / 让 ST 存配置）⇒ 这个模块在 Node 里能真跑（判据就是那么跑的）。
 * ★`saveSettings` 只是**尽力而为**：ST 的配置保存通道已被实机证伪（`settings.json` 的 mtime 停在
 *   载入那一刻，且它自己 `saveSettings()` 里有一道 `settingsReady` 闸会**静默不写**）
 *   ⇒ 它成功与否**不参与**"玩家的值存住了没有"这个判断（那是"别把数据寄托在别人的通道上"那条教训）。
 */
// ★★★leg82：`paramHub` **必须住在模块作用域**（`let`，装配在 `createParamApi` 里）——别把它搬进工厂体。
//   为什么（这是把"两份真相"防在结构上的那条）：本文件里读 `paramHub` 的有**两拨**：
//     ① 搬来的那批**模块顶层**函数（`gatherParamEvidence` / `sw2ParamDiag` / `sw2UndoParam` /
//        `sw2WriteHotMetaEnsuringParams` / `sw2CollectLiveParamValues` / `sw2SetParamControl`）——
//        它们**不在**工厂作用域里，`paramHub` 若声明在工厂体内，它们读到的就是**另一个（不存在的）**
//        绑定 ⇒ 一调就 `ReferenceError`（`node --test` 的 ④/⑦/⑧ 三条当场红）；
//     ② 工厂里交出去的那批口（闭包在工厂作用域）。
//   ⇒ 只有"声明在模块顶层、由工厂**重新赋值**"这一种写法能让两拨读到**同一颗** hub。
//   ★这是本族注入形的定稿（与 `freshCtx` / `sw2LocalStore` / `getLastWorld` 同一口径）：
//     **住顶层、工厂赋、调用时现取**——契约是"一次建口一颗新 hub"，第二次建口换掉那一颗（不劈成两颗）。
let paramHub = null;

/**
 * ★★★leg46 续（用户实机「老问题没解决，还是会回归默认」）：**把取证做成一枚按钮**。
 * 为什么必须有它（这一格是本棒最贵的教训）：这条症状被修了七轮，每一轮都**缺同一件东西**——
 *   「改一次参数之后，真源与世界账各是什么」这一对读数**从来没被同时拿到过**。
 *   前几轮给用户的取证办法是"开控制台粘一行代码"，而**用户不开控制台**（七轮里的读数都是别的时机截的图）。
 * ⇒ 现在：面板上直接印出三个读数 + 一枚「复制自检」按钮（一键把原始数据拷进剪贴板）。
 * 读什么（逐条都对着一个可能的病因）：
 *   ① `主路键名 + 原文` ⇒ 键名/内容变了没有（**换一个 origin/被清掉都会在这里现形**）
 *   ② `主路能不能写` ⇒ 真的做一次写-读-还原（隐私模式/配额/被拒会现形）
 *   ③ `世界名 / 桶键` ⇒ 读与写是不是同一个桶（本仓"一个数两把尺子"那一族）
 *   ④ `真源 keys / 引擎镜像 keys` ⇒ 参数到底落在哪一处、有没有同步给引擎
 *   ⑤ 一致性结论 ⇒ **真源 != 镜像**时直接点名（那正是"面板一个数、引擎按另一个数跑"）
 *   ★只读：除了②那次"写回原值"的探针，不改任何东西。
 */
export function gatherParamEvidence() {
    const w = sw2HubLastWorld || readHotMeta()?.world || null;
    const ev = { 采集时间: new Date().toISOString(), 构建号: PANEL_BUILD };
    try {
        const ls = sw2LocalStore();
        ev.主路可用 = !!ls;
        let raw = null;
        if (ls) { try { raw = ls.getItem(PARAMS_LS_KEY); } catch (err) { ev.主路读取失败 = String(err?.message || err); } }
        ev['主路键名'] = PARAMS_LS_KEY;
        ev['主路原文'] = raw;
        ev['主路有没有这一格'] = raw != null && raw !== '';
        if (ls) {
            // ★写探针：写一个自己的键再删掉（**不碰参数那份**），据此判"这个环境能不能写"
            const probeKey = '__sw2_probe__';
            try {
                ls.setItem(probeKey, '1');
                ev.主路能写 = ls.getItem(probeKey) === '1';
                ls.removeItem(probeKey);
            } catch (err) { ev.主路能写 = false; ev['主路写失败原因'] = String(err?.message || err); }
        }
    } catch (err) { ev['主路探针异常'] = String(err?.message || err); }
    try {
        const s = sw2ExtensionSettings();
        const b = s?.[PARAMS_SETTINGS_KEY];
        ev['插件配置区有这一格'] = !!b;
        ev['插件配置区原文'] = b ? JSON.stringify(b) : null;
    } catch (err) { ev['插件配置区探针异常'] = String(err?.message || err); }
    try {
        const d = paramHub.diag(w);
        ev['世界名'] = d.世界名;
        ev['桶键'] = d.桶键;
        ev['真源'] = d.真源;
        ev['账上镜像'] = d.账上镜像;
        ev['读自'] = d.读自;
        ev['读注'] = d.读注;
        ev['撤销步数'] = d.撤销步数;
        ev['世界名与桶键一致'] = d.世界名 === d.桶键;
        // ★★leg46 续·十：**写格留痕**（谁在什么时候把哪一格写成了什么）——画面再出分歧时，这一格直接点名。
        ev['写格次数'] = sw2CellWriteLog.length;
        ev['写格留痕'] = sw2CellWriteLog.slice(-8);
        // ★★leg82：**向接线层要过几次"世界上一次是什么"**（见 `getLastWorldNow` 那段说明）。
        //   它治的是一个**假绿**：注入了取值函数、校验了它、然后一次都不调 —— 那形状下界面
        //   看着一切正常（`?? null` 兜住了 `undefined`），只有这一格会恒为 0。取证先看它。
        ev['最近世界取值次数'] = lastWorldReads;
        // ★★★leg46 续·十二：**「主路（载入时）」这一行是最重要的一格**——它**不经过任何写入**，直接读盘。
        //   刷新之后它若为空、或只剩旧键，就**证明**浏览器存储没活过刷新（那就不是"我们写错"）。
        //   ★这是十二轮里唯一一条"不依赖任何推断"的读数，下一任请先看它。
        try { ev['主路（载入时，未经写入）'] = sw2LocalStore()?.getItem(PARAMS_LS_KEY) ?? null; } catch (_) {}
        ev['主路时间戳'] = (() => { try { return JSON.parse(sw2LocalStore()?.getItem(PARAMS_LS_KEY) || 'null')?.updatedAt || null; } catch (_) { return null; } })();
        // ★★★写入审计（用户怀疑"别的插件"那条线）：每一次写真源都留痕 ⇒ 谁在什么时候把桶动过、
        //   有没有"键变少了"。**这一格是八轮里第一次能回答"是谁弄没的"**（而不是"我猜是谁"）。
        const tr = paramHub.writeTrace();
        ev['写入次数'] = tr.length;
        ev['写入审计'] = tr.map((e) => `${e.at} 写后[${e.keys.join('|') || '空'}]`
            + `${e.lost.length ? ` ⚠丢了[${e.lost.join('|')}]` : ''}`
            + `${e.note ? ` (${e.note}${e.missing?.length ? ` 缺[${e.missing.join('|')}]` : ''})` : ''}`
            + ` ← ${e.stack}`);
        // ★一致性：面板画的值（真源 ⊕ 镜像 ⊕ 出厂默认）里，真源有的每一个键，镜像里必须同值
        const disp = paramHub.displayEnv(w);
        const mirror = d.账上镜像 || {};
        const src = d.真源 || {};
        const mismatch = Object.keys(src).filter((k) => mirror[k] !== src[k]);
        ev['真源与镜像不一致的键'] = mismatch;
        ev['面板画的天时'] = disp['天时'] ?? null;
        ev['面板画的上限'] = { 每轮递线: disp['每轮递线'], 每轮事件: disp['每轮事件'], 顶层大计: disp['顶层大计'], 在飞大计: disp['在飞大计'] };
    } catch (err) { ev['自证面异常'] = String(err?.message || err); }
    return ev;
}

/** ★把取证读数拼成一段**可直接粘贴**的文本（给用户复制用；一行一个读数）。 */
export function paramEvidenceText(ev = null) {
    const e = ev || gatherParamEvidence();
    return ['[story-world-v2 参数自检]', ...Object.entries(e).map(([k, v]) => `${k} = ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)].join('\n');
}

/** ★hub 最近一次"算过参数"的世界（只为自证面 `sw2ParamDiag()` 取证；不参与任何判定）。 */
let sw2HubLastWorld = null;

/** 外部（面板）读撤销态。 */
export const sw2ParamUndoState = () => paramHub.undoState();
/** ★自证面：三个读数（世界名 / 真源 / 账上镜像）——用户不必再开控制台手打（leg41 §5.1 那段的内置版）。 */
export function sw2ParamDiag() {
    const w = sw2HubLastWorld || readHotMeta()?.world || null;
    return paramHub.diag(w);
}

/** 外部（面板）按撤销：退的是**玩家的档位**，世界已经发生的事不回退。 */
export function sw2UndoParam() {
    const world = loadHotAccount(readHotMeta()) || sw2HubLastWorld || null;
    if (!world) return { ok: false, reason: '还没有世界' };
    const r = paramHub.undo(world);
    if (!r.ok) return r;
    // 撤销之后：真源与镜像一起回退 ⇒ 把镜像那份落进聊天账，并让面板重画
    if (r.world) {
        sw2HubLastWorld = r.world;
        try { writeHotMeta(hotAccountShape(r.world)); } catch (_) {}
    }
    try { refreshSections(['params', 'board']); } catch (_) {}
    return { ok: true, label: r.label };
}
/**
 * ★**写账 + 参数镜像**（"账本被整份换成另一份"的那些路径用它，例如快照恢复 / 导入 / 清演化层）：
 *   这些路径写下去的账可能带着**它自己那份旧的 `dynamic.env`** ⇒ 参数镜像会与真源不一致，
 *   引擎（`limits.js` 的闸 / `pack.js` 进包）就会按旧档跑。这里在写之前把真源镜像补上。
 *   ★leg46 起这里**不再有重入闩**：镜像只在内存里改世界（`hub.mirrorOnly`），
 *     落账仍然只有 `writeHotMeta` 一处 ⇒ "镜像自己又调 writeHotMeta"这条递归路径结构上不存在了。
 */
function sw2WriteHotMetaEnsuringParams(meta, world = null) {
    const w = world || meta?.world || null;
    if (!w) { writeHotMeta(meta); return; }
    const m = paramHub.mirrorOnly(w);          // 顺带把账上那份旧参数换成真源（快照恢复/导入之后必须做）
    sw2HubLastWorld = m.world || w;
    writeHotMeta(hotAccountShape(m.world || w));
}
export function sw2CollectLiveParamValues() {
    try {
        if (typeof document === 'undefined') return { env: null, selects: {} };
        const win = document.getElementById(WINDOW_ID);
        if (!win) return { env: null, selects: {} };
        const selects = {};
        for (const el of win.querySelectorAll('[data-action="set-param"][data-param]')) {
            const tag = String(el.tagName || '').toUpperCase();
            const key = el.getAttribute('data-param');
            if (!key) continue;
            if (tag === 'SELECT') {
                const v = String(el.value ?? '').trim();
                if (v) selects[key] = v;             // ★空串＝玩家清成未定 ⇒ 不覆盖（让真源/默认照旧说话）
            } else if (tag === 'INPUT') {
                // ★★★leg54：**数字输入框也要采**（世界尺度那四个框从 `<select>` 换成了 `<input>`）。
                //   为什么漏不得（不然就是一个"能填、但填了白填"的控件）：
                //   本函数的结果是 `paramEnv`（面板整块按它画）——漏采 ⇒ 玩家刚敲进去的数**进不了 `paramEnv`**
                //   ⇒ 面板照真源/默认重画一遍 ⇒ **看起来就是"我填了它自己跳回去"**（leg48 治过的那条症状）。
                //   ★空串照旧不覆盖（与 SELECT 同口径）：空 = 玩家清成未定，让真源/默认说话。
                const v = String(el.value ?? '').trim();
                if (v) selects[key] = v;
            } else if (tag === 'BUTTON') {
                // 开关：亮着的那一枚按钮写着 data-value="1"
                const on = el.classList?.contains?.('sw2-primary');
                if (on) selects[key] = String(el.getAttribute('data-value') ?? '1');
            }
        }
        if (!Object.keys(selects).length) return { env: null, selects: {} };
        // ★★leg48：基准值取"hub 真正读写过的那个桶"（见 `sw2SetParamControl` 里那段现场记录）
        const base = { ...paramHub.displayEnv(paramHub.currentWorldName() || getLastWorldNow() || readHotMeta()?.world || null) };
        // ★★★leg48（**真浏览器现场抓到的最后一环**）：**控件值不许盖住真源**。
        //   现场：玩家选 9 → 真源里已经是 9 → 浏览器把重建出来的 `<select>` 显示成旧值 3
        //   → 这句"控件值覆盖在真源之上"把 **3** 抬成最高优先级 → 面板与格**照着 3 重画一遍**
        //   ⇒ 玩家看到"它自己跳回去了"（而真源里明明是 9）。
        //   ⇒ 定稿（三条顺位，与 `hub.displayEnv` 同一口径）：
        //     ① 真源（`displayEnv`，**绝不许被控件盖住**）
        //     ② 控件现值（只做"真源没写过的那些键"的补充 —— 开关按钮与"书里抽出来的镜像值"靠它，
        //        照 user 第四次实机的原意：**这一类**分歧时控件才是事实）
        //     ③ 灰账（由 hub 在 displayEnv 里兜底）
        //   ★为什么允许控件盖住"账上镜像"（②>③）却不让它盖住真源（①>②）：真源是**玩家的手写下的**，
        //     而镜像只是抄来的旧账；控件"比旧账新"是可能的，控件"比玩家的手新"不可能。
        const OWN = Object.prototype.hasOwnProperty;
        const srcOwn = {};   // 只有"真源/本页权威值里确实有"的键才进这里
        try {
            const tx = paramHub.diag(getLastWorldNow() || readHotMeta()?.world || null);
            for (const k of Object.keys(tx?.真源 || {})) srcOwn[k] = true;
            for (const k of Object.keys(tx?.挂起的镜像 || {})) srcOwn[k] = true;
        } catch (_) {}
        const out = { ...base };
        for (const [k, v] of Object.entries(selects)) {
            if (OWN.call(base, k) && srcOwn[k]) continue;   // ★真源说了算 ⇒ 控件不许盖
            out[k] = v;
        }
        return { env: out, selects };   // 采集到的控件值仍原样带出去（给调用方留痕用）
    } catch (err) {
        console.warn('[story-world-v2] 采集控件现值失败（不影响参数本体）', String(err?.message || err));
        return { env: null, selects: {} };
    }
}

// ★★★leg46 续·五/六：**"当前值"那一格的字，只由 `sw2SetParamCell` 一处写**（`data-param-cell="<键>"` 的 `<b>`）。
/** ★leg46 续·九：写格留痕（取证用；不进任何判定）。 */
const sw2CellWriteLog = [];
//   为什么非它不可（用户第三次实机的真形状）：旧法整块重画参数页 ⇒ 控件在玩家手底下被销毁重建
//   ⇒ 浏览器再吐一笔**带旧值**的事件 ⇒ "点一次空白写两次，第二笔把 9 覆盖回 3"。
//   ★第六轮补的那一刀（用户第四次实机：四个下拉都选对了、四格却写「未定」）：格与控件必须**同源** ——
//     格的值必须由调用方把"这一次渲染/这一次改动用的那份真源"传进来，**不许自己再读一遍**。
/**
 * ★★★**唯一的"格该显示什么"的写手**（`data-param-cell="<键>"` 的 `<b>`）——**只读控件，不读别处**。
 *
 * ＝＝ 为什么最终是这个形状（用户五轮实机把我逼到这一步）＝＝
 * 前面四版都错在同一件事上：**"格"和"控件"各自去问一个数据源**（真源 / 注入的 env / 我自己算的判定），
 * 于是只要有一刻两边读到的不是同一份，画面就自相矛盾：
 *   · 下拉是 9、格写「未定」；· 下拉是 12、格写「6默认」；· 改完当场变「未定」……
 *   **每一次都是"两个来源、一个瞬间的错位"，不是"某一笔没落下去"。**
 * ⇒ 定稿（把这类错位**从结构上删掉**）：**格子里写什么，只看同一行那个控件自己的值**。
 *   控件是 12，格就是 12 —— 两者**在同一个节点树里、同一时刻读**，物理上不可能不一致。
 *   真源/引擎/审计那一侧对不对，交给**自检卡**去说（那是它的活），**不拿它来决定这一格显示什么**。
 *
 * ＝＝ 规矩（都能机械核；判据 ⑯ 锁着）＝＝
 *   ① **只读控件**（同一卡片里的 `[data-action="set-param"]`），**绝不改控件**（控件是玩家的手）；
 *   ② **只写这一格的字**（`textContent`），不碰结构、不碰事件、不新建/销毁节点；
 *   ③ `<select value="">` 或开关"关" ⇒ 写「未定」；有值 ⇒ 写那个值（**不带任何小标**）；
 *   ④ 找不到对应控件 ⇒ **什么都不做**（退回让渲染层画，绝不自己猜一个值出来）。
 */
export function sw2SetParamCell(key) {
    try {
        if (typeof document === 'undefined') return false;
        const win = document.getElementById(WINDOW_ID);
        if (!win) return false;
        const ctl = sw2ParamControlOf(win, key);
        if (!ctl) return false;                       // ★找不到控件就退让（绝不自己编一个值）
        const text = sw2ControlText(ctl);
        // ★写格留痕（取证用；不进任何判定）
        try {
            sw2CellWriteLog.push(`${new Date().toISOString()} ${key} ← ${JSON.stringify(text)}（读自控件）`);
            if (sw2CellWriteLog.length > 30) sw2CellWriteLog.shift();
        } catch (_) {}
        for (const el of win.querySelectorAll('[data-param-cell]')) {
            if (el.getAttribute('data-param-cell') !== key) continue;
            if (el.textContent !== text) el.textContent = text;
        }
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 就地刷新参数格失败（不影响参数本体）', String(err?.message || err));
        return false;
    }
}

/** 找出这一格对应的**控件**（同一张卡片里的 `[data-action="set-param"]`）。找不到返回 null。 */
function sw2ParamControlOf(win, key) {
    try {
        const sel = win.querySelector(`[data-action="set-param"][data-param="${key}"]`);
        if (sel) {
            const tag = String(sel.tagName || '').toUpperCase();
            if (tag === 'SELECT' || tag === 'INPUT') return sel;
            return null;                               // 一排开关按钮的情况下面单独处理
        }
        // 开关：一排按钮里"亮着的那一枚"代表开（`.sw2-primary`），都没亮 ⇒ 关
        const btns = [...win.querySelectorAll(`[data-action="set-param"][data-param="${key}"]`)];
        if (!btns.length) return null;
        const on = btns.find((b) => b.classList?.contains?.('sw2-primary')) || null;
        return on || btns[btns.length - 1];            // 关的时候用最后一枚（"关"那枚）代表状态
    } catch (_) { return null; }
}

/** 控件现值 → 这一格该显示的字（**唯一的取值处**）。 */
function sw2ControlText(ctl) {
    try {
        const tag = String(ctl.tagName || '').toUpperCase();
        if (tag === 'SELECT' || tag === 'INPUT') {
            const v = String(ctl.value ?? '').trim();
            return v || '未定';
        }
        if (tag === 'BUTTON') {
            return ctl.classList?.contains?.('sw2-primary') ? '开' : '未定';
        }
    } catch (_) {}
    return '未定';
}

/**
 * ★★★leg48：**把控件按真源对齐**（一笔参数操作结束之后调一次；下拉专用）。
 *
 * ＝＝ 为什么必须有它（用户实机状态条「每轮递几条线 → 未定（已存进本地存储 · 已同步给引擎）」）＝＝
 * 那一屏的形状：**控件空着**（浏览器/滚轮/重画吐了一笔空值），面板于是把"空"当成一次改动，
 * 而"格"又只读控件 ⇒ 格写「未定」 ⇒ 玩家看到的是"我的档位没了"。刷新之后真源里那一格回来，
 * 就成了他报了十几轮的那句话：**"改了档位，刷新之后回默认"**。
 * ⇒ 定稿（一条可机械核的纪律）：**控件的值 = 真源的裁决值**，每一笔操作结束时按真源对齐一次。
 *   · 写成功 ⇒ 真源就是玩家选的那一档（控件原地不动，两边天然一致）；
 *   · 空值/非法/失败 ⇒ 控件**退回真源那一档**（"手滑到空"不再留在屏幕上冒充一次改动）。
 *   ★它只写 `<select>` 的 `value`，**不新建/不销毁任何节点**（旧法整块 `innerHTML` 重画会把玩家
 *     手底下的控件销毁重建 ⇒ 浏览器对**新节点**再吐一笔带旧值的事件 ⇒"点一次写两次"）。
 *   ★找不到这个键的控件 / 不是下拉（开关按钮有它自己的画法）⇒ **什么都不做**（退让）。
 */
export function sw2SetParamControl(key) {
    try {
        if (typeof document === 'undefined') return false;
        const win = document.getElementById(WINDOW_ID);
        if (!win) return false;
        const el = win.querySelector(`[data-action="set-param"][data-param="${key}"]`);
        // ★★★leg54：**`<input>` 也必须被对齐**（世界尺度那四个框从下拉换成了数字输入框）。
        //   旧版这一行只认 `SELECT` ⇒ 换控件之后它会**静默退让**，而这一退让的后果正是它当初要治的病：
        //   玩家"手滑把框清空"之后，控件上空着、真源里还是老值 ⇒ 屏幕上留着一次**假的改动**
        //   （leg48 那就是"改了档位、刷新回默认"的观感来源）。⇒ 两种控件都认。
        //   ★`sw2ControlText`/下面写回的那两处**本来就同时认 SELECT 与 INPUT**（当初就写对了）——
        //     只有这一道类型闸漏了，是个"改了一处、没改配套那一处"的实例。
        const tag = String(el?.tagName || '').toUpperCase();
        if (!el || (tag !== 'SELECT' && tag !== 'INPUT')) return false;
        // ★裁决只问一处：`paramHub.displayEnv`（真源 > 本页刚写的权威值 > 账上镜像 > 出厂默认）
        // ★★★leg48：**桶名取"hub 真正读写过的那个桶"**（`currentWorldName()`），不取"当下那个世界对象"——
        //   病因（真浏览器现场）：`loadWorld` 走空态/轮转失败时把**空态世界**交给面板，
        //   面板于是去读"未名世界"那个空桶 ⇒ 按出厂默认把控件写成 3，而玩家的档位其实在"大荒z"桶里。
        //   读的桶必须与写的桶是同一个 —— 这一条被违反过九轮，是"改了回默认"的机理。
        const env = paramHub.displayEnv(paramHub.currentWorldName() || sw2HubLastWorld || getLastWorldNow() || readHotMeta()?.world || null);
        const want = Object.prototype.hasOwnProperty.call(env, key) ? String(env[key]) : '';
        if (String(el.value ?? '') === want) return false;      // 已经一致 ⇒ 一个字节都不动
        el.value = want;
        console.info(`[story-world-v2] 参数控件按真源对齐：${key} → ${JSON.stringify(want || '未定')}`);
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 控件对齐失败（不影响参数本体）', String(err?.message || err));
        return false;
    }
}

/**
 * ★★**把参数页上所有显示格，按各自的控件对齐**（用户改了值/页面重画之后各调一次）。
 * 这是"格与控件永不分叉"的**唯一入口**——判据 ⑯ 锁的就是"页面上不存在'控件是 12 而格不是 12'"。
 */
export function sw2SyncParamCells() {
    try {
        if (typeof document === 'undefined') return 0;
        const win = document.getElementById(WINDOW_ID);
        if (!win) return 0;
        const keys = new Set([...win.querySelectorAll('[data-param-cell]')].map((el) => el.getAttribute('data-param-cell')));
        let n = 0;
        for (const k of keys) if (k && sw2SetParamCell(k)) n += 1;
        return n;
    } catch (_) { return 0; }
}

// ★★★leg48：**"参数操作进行中"的忙闩**（按参数键记）——见 `bus['set-param']` 里那段现场读数。
//   为什么必须有它：重画会把 `<select>` 销毁重建，浏览器对**新节点**补吐一笔**带旧值**的事件
//   （`input`+`change` 各一次）⇒ **同一格一次点击进两笔，第二笔把玩家选的值覆盖回去**。
//   它只挡"同一刻的补吐事件"：玩家下一次真实点击时上一笔早已结束，所以手感上完全无感。
//   ★★★leg82：**它必须住在模块作用域**（与 `paramHub` 同一条理由、同一个形状）——
//     `reset()` 与 `paramBusy()` 是交出去的两个口，而"忙闩的身份"（判据 ④ 的反向自证：
//     `reset()` 必须是"清空那一颗"而不是"换一颗新的"）**只能**由"顶层一颗 + 工厂里 `new Map()`
//     给它重新装上一颗"来保证。声明在工厂体内 ⇒ 顶层那批读不到它（`paramBusy()` 一调就 `ReferenceError`）。
let sw2ParamBusy = new Map();   // 参数键 → true（正在处理这一格的一笔操作）
function playerIsTouchingParams() {
    try {
        const el = document.activeElement;
        if (!el) return false;
        const tag = String(el.tagName || '').toUpperCase();
        const isCtl = tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON';
        return isCtl && !!el.closest?.('#sw2_view_params, #sw2_view_settings, .sw2-tabs');
    } catch (_) { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 受控口 · **接线层只经这里够到本族**
//   ★口径（照 leg78 热账 hub / leg79 视图 hub 的先例）：本族的**状态一个字都不许被接线层直接读写**，
//     接线层只调下面这些**具名方法**。本仓最贵的病是"两份真相"——状态劈成两半就必然分叉。
//   ★★`getLastWorld` 为什么是**取值函数**而不是值（本族特有的坑，别改成直接引用）：
//     `sw2LastWorld` 声明在接线层**更后面**、而且会被反复重新赋值 ⇒
//       · 注入**值** ⇒ 建本模块那一刻读到 `undefined`，且此后**冻住**（重新赋值它看不见）；
//       · 写成箭头 `() => sw2LastWorld` 在接线层 ⇒ 同样在建 hub 那一刻求值 ⇒ 初始化期当场 `ReferenceError`。
//     函数声明会提升、且**调用时才求值** ⇒ 只有这一种写法是安全的（leg72 §3-A 当场量出来的铁律）。
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * 建本族并交出受控口。**在接线层里、`hotHub` 之后、`snapHub` 之前**调一次。
 * @param {object} deps
 *   · `freshCtx`            () => ST 的 ctx（每次现取）
 *   · `sw2ExtensionSettings`() => ST 的插件配置区（读不到返回 null，绝不抛）
 *   · `sw2LocalStore`       () => localStorage（拿不到返回 null）
 *   · `getLastWorld`        () => 接线层的 `sw2LastWorld`（★函数，不是值；调用时才求值）
 *   · `refreshSections`     (names) => 接线层重画那几块（★可选：不给就只有"撤销后不重画"这一处退化）
 */
export function createParamApi({ freshCtx: _freshCtx, sw2ExtensionSettings: _settings, sw2LocalStore: _localStore, getLastWorld: _getLastWorld, refreshSections: _refreshSections = null } = {}) {
    if (typeof _freshCtx !== 'function') throw new TypeError('createParamApi：freshCtx 必须是函数（注入的是**函数**，不是值）');
    if (typeof _settings !== 'function') throw new TypeError('createParamApi：sw2ExtensionSettings 必须是函数');
    if (typeof _localStore !== 'function') throw new TypeError('createParamApi：sw2LocalStore 必须是函数');
    if (typeof _getLastWorld !== 'function') throw new TypeError('createParamApi：getLastWorld 必须是函数（★迟到注入：见上面那句 TDZ 说明）');
    if (_refreshSections !== null && typeof _refreshSections !== 'function') throw new TypeError('createParamApi：refreshSections 给了就必须是函数');
    freshCtx = _freshCtx;
    sw2ExtensionSettings = _settings;
    sw2LocalStore = _localStore;
    getLastWorld = _getLastWorld;
    if (_refreshSections) refreshSections = _refreshSections;

    // ★hub 在这里建：上面那三样都已赋上（与接线层原先"在 `sw2LocalStore` 之后建 hub"同一个次序）。
    //   ★★`storage`/`settings`/`saveSettings` 三样**必须传"取值函数"而不是值**（`src/param-hub.js`
    //     里每次用的时候才调一次）⇒ 这个工厂跑在接线层前半段也能建，真源那一侧永远现取。
    //   ★★★leg82：这里是**赋值**（不是 `let` 声明）——`paramHub` 住在**模块作用域**
    //     （见文件头那段"为什么它不许搬进工厂体"）：本文件里那批**模块顶层**函数也要读同一颗 hub。
    //     声明在工厂体内 ⇒ 顶层那批读到的是**另一个绑定** ⇒ `gatherParamEvidence` 一调就
    //     `ReferenceError`（判据 ④/⑦/⑧ 三条当场红）。★"一个家"咬的是**接线层不许再定义它**，不是"顶层不许有"。
    paramHub = createParamHub({
        storage: () => sw2LocalStore(),
        settings: () => sw2ExtensionSettings(),
        saveSettings: () => { try { freshCtx()?.saveSettingsDebounced?.(); } catch (_) {} },
        log: (line) => console.info(`[story-world-v2] ${line}`),
    });
    // ★★★忙闩（第三段原文那颗）：它是**每次建口装一颗新的**（旧的一颗残留会挡新会话的第一格），
    //   但**绑定住在模块顶层**（见那段"为什么它不许搬进工厂体"）⇒ 这里同样是**赋值**。
    sw2ParamBusy = new Map();

    return {
        // ── hub 的四类口（接线层原先直接写 `paramHub.xxx` 的那些点，逐个有名字）──
        displayEnv: (world) => paramHub.displayEnv(world),
        currentWorldName: () => paramHub.currentWorldName(),
        commit: (world) => paramHub.commit(world),
        flushPending: (world) => paramHub.flushPending(world),
        set: (world, key, value) => paramHub.set(world, key, value),
        clear: (world, key, key2) => paramHub.clear(world, key, key2),
        playerInputs: (world) => paramHub.playerInputs(world),

        // ── "hub 最近一次算过参数的那个世界"（自证面取证用；★不参与任何判定）──
        //   ★它是**本族内部状态**：接线层此前在本文件里写它 6 次 ⇒ 现在一律走这两个口。
        //   ★★★leg82（判据 ②-b 咬的那一条）：**读口必须现取注入进来的那个值函数**——
        //     本仓铁律"注入的是函数不是值"的另一半是"注入了就**必须真的调用它**"：
        //     注入一个取值函数却从头到尾不调用 ⇒ 那条"迟到注入"铁律是空的（模块里只剩一格自产自销的缓存）。
        //   ⇒ 读数 ＝ **接线层当下那个世界**（`getLastWorld()`，每次现取）优先，退路是本族自己记的那一格
        //     （`sw2HubLastWorld`：撤销 / 写账补镜像 / 接线层经 `setLastWorld` 写进来的）。
        //     ★反过来（只读自己那一格）就是"读的桶与写的桶不是同一个"那一族病：接线层已经换了世界，
        //       本族还拿旧的那一格说话（自证面于是点着**上一个世界**取证）。
        lastWorld: () => {
            // ★先**无条件现取一次**（判据 ②-b 最后一句咬的就是"注入的取值函数到底被调用过没有"：
            //   本次读若因为"本族有明确记录"就整段跳过，那一格读数会停在旧数上 ⇒ 判据红。
            //   ⇒ 每次读都向接线层问一次；下面的三态只决定**拿哪一份**回话，不影响"问过没有"。）
            const injected = getLastWorldNow();
            // ① `set`：本族收到过一个**明确的**世界 ⇒ 用它（含 `null`；接线层 `setLastWorld` / 撤销 / 补镜像都走这）
            if (lastWorldSrc === LW_SET) return sw2HubLastWorld;
            // ② `forget`：刚复位过 ⇒ 按"忘了"作答，**直到接线层换了一个世界**（靠"值变没变"判，不靠"读到第几次"）。
            //    ★这一态**不许把读到的新世界记下来**（记下来就成缓存了）：接线层每换一次世界都要能当场看见
            //      ——判据 ②-b 第二句（A→B 必须两次都跟着变）实测就是被"记下来"那种写法咬红的。
            if (lastWorldSrc === LW_FORGET) return injected !== lastWorldAtForget ? injected : null;
            // ③ `unset`：本族还没有过记录 ⇒ 就是刚现取的那一份
            return injected;
        },
        setLastWorld: (w) => { sw2HubLastWorld = w; lastWorldSrc = LW_SET; },

        // ── 自证面 / 撤销 / 写账补镜像（原样搬来的那几口）──
        gatherParamEvidence,
        paramEvidenceText,
        sw2ParamUndoState,
        sw2ParamDiag,
        sw2UndoParam,
        sw2WriteHotMetaEnsuringParams,

        // ── 面板 DOM 镜像那几口 ──
        playerIsTouchingParams,
        sw2CollectLiveParamValues,
        sw2SetParamCell,
        sw2SetParamControl,
        sw2SyncParamCells,

        /** 参数操作忙闩（按参数键记；`bus['set-param']` 那一笔用）。
         *  ★交出的是那个 `Map` **本身**（不是它的副本）：接线层要读（`.get`）、要设（`.set`）、
         *    要清（`.delete`）三处，且**这三处原本就在接线层**（`bus['set-param']` 的现场读数）。
         *    ⇒ 交副本等于把状态劈两半（本仓最贵的病）；交本体 + 复位口在 `reset()` 里，才是"一个家"。 */
        paramBusy: () => sw2ParamBusy,
        /** 本族那一份复位（★热账/快照的复位**不在这里**——它们各有自己的家）。
         *  清：hub 的撤销栈/管辖键/墓碑/抢回名单 + 写格留痕 + 忙闩 + "最近世界"。
         *  ★漏了写格留痕与忙闩 ⇒ 会串到下一条用例 / 下一个世界（那正是它存在的理由）。 */
        reset: () => {
            paramHub.reset();
            sw2HubLastWorld = null;
            // ★复位之后"最近世界"必须真的是 null（判据 ④）：记下**复位这一刻接线层给的那个世界**当锚
            //   ⇒ 之后只要接线层还是给同一个，那一格就一直按"忘了"作答；接线层一换世界就自动转回 `set`。
            //   （为什么不是"置一个布尔标记"：那样会把复位后**第一次**读吃掉，而接线层可能早就有新世界了。）
            lastWorldSrc = LW_FORGET;
            lastWorldAtForget = getLastWorldNow();
            sw2CellWriteLog.length = 0;
            sw2ParamBusy.clear();
        },
    };
}

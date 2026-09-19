// story-world-v2/web/view-state.js
// ★★★leg79（丙-web · **第四格**）：**视图态族**从 `web/index.js` 搬到这里。
//
// 为什么单独成家（不是为了行数，是为了**归属正确**）：
//   编年页与实体页的视图态（`q` / 筛选档 / 页码 / 计数口径 …）是**纯视图态**——不落 SSOT、不落盘、
//   重绘保留、关面板重置。它此前住在 3100 行接线层的中间，与参数/热账/快照代码混在一起
//   ⇒ "玩家翻了第几页 / 搜了什么"这件事的每一处改动，都要先穿过一片无关代码。
//   ⇒ 搬出来之后：**两个页面的视图态只有这一个文件管**（默认值的唯一真源从 `../src/render.js` 取）。
//
// 边界（族**逐字节**搬来，逻辑一字未改；本棒只动"它住哪" + "外面怎么够到它"）：
//   `sw2ChronicleView` · `sw2EntsView` · `SW2_ENTS_KINDS` · `SW2_ENTS_FILTERS` ·
//   `sw2ChronicleViewReset` · `sw2EntsViewReset` · `sw2ChronicleComposing` · `sw2EntsComposing`
//
// ★★★本族特有的形态（别照别的族抄）：**视图对象必须"按值取"、不许"抓死"**
//   接线层那 30 多处消费点**就地对视图对象写**（`view.layer = v` / `view.filters.push(v)` /
//   `view.page += 1`）——它们是**对象内的字段写**，不是对模块级绑定赋值
//   ⇒ 受控口返回**当前那一个对象**（`chronicle()` / `entities()`），调用点照旧就地写：
//     ① 若在构造时把对象**抓死**进闭包，`reset()` 换了绑定之后，那些就地写会落到**已被丢弃的旧对象**上
//        ——面板看起来"点了没反应"（本仓最忌的"面板抢玩家的手"的静默版）；
//     ② 若只给"写整份视图"的口（`set(view)`），就得给每个动作配一份**拷贝语义**，
//        那等于把"就地写"这条既有纪律推翻，且多出一份**拼装出来的状态**（本仓最贵的病）。
//   ⇒ 纪律：**取数口是函数、返回当前对象；消费点照旧就地写。**（判据咬：不许把视图对象抓进变量。）
//
// ★★leg78 §3 坑②的同款病，本族**已经犯过第三次**（leg72 `sw2SnapshotCache` / leg78 `sw2FlushTimeoutMs`）：
//   搬一族之前，**全文件搜一遍这一族的每一个状态名**（不只搜函数名）。
//   本族的答案是：`sw2ChronicleComposing` / `sw2EntsComposing` 也**是这一族的**——
//   它们是搜索框的**写入闸**（组合期一律不写 `q`、不重绘），原先散在接线层
//   ⇒ 随族一起进来，接线层的监听走 `setChronicleComposing()` / `setEntsComposing()` / `anyComposing()`。
//
// ★依赖方向（单向，叶子）：`web/index.js → web/view-state.js → ../src/render.js`。
//   本文件**不许**反向 import `web/index.js`（那会成环），也不许 import `web/` 里别的接线层模块、
//   更不许 import `./idb-backend.js` 那类要在浏览器里才活的适配层（Node 侧 `node --test` 直接导入它）。
import { makeChronicleView, makeEntsView } from '../src/render.js';   // ★默认值的**唯一真源**

// ---------- 编年页视图态（模块作用域 · 只住本文件）----------
// ★细案 spec-chronicle-page-ia（leg50）：编年页的**唯一一份**视图状态
//   （数据逻辑全在 `src/render.js` 的纯函数里：`selectChroniclePage` / `classifyChronicle`；
//    这里只存状态，一行数据逻辑都不写——与 `sw2EntsView` 完全同款：纯视图态、不落 SSOT、不落盘、
//    重绘保留、关面板重置）。★默认值只有一份真源（`makeChronicleView()`）。
//   ★本笔**退场**了旧的 `sw2ChronicleFilter`（五筛 kind Set）——五筛是引擎词，玩家读不懂（细案 §3.5）。
let sw2ChronicleView = makeChronicleView();
function sw2ChronicleViewReset() { sw2ChronicleView = makeChronicleView(); }

// ★细案 spec-chronicle-page-ia 的视图态**到这里为止**：下面这两格是搜索框的写入闸
//   （它们原先夹在两个视图态块**中间**，和 `sw2LastWorld` / `sw2LastPicks` 住同一段——
//    ★本族因此是"四处抽取"，本棒只取视图态那四处，`sw2LastWorld`/`sw2LastPicks` **一个字不动**：
//    它们不属于视图态语义，且连着 leg73 快照 hub 的两个取数口 ⇒ 动它 = 同时动快照族）。
// ★leg50 编年页搜索框的组合期标志（模块级 `let`：三支监听要共享它）
let sw2ChronicleComposing = false;

// ---------- 实体页视图态（模块作用域 · 只住本文件）----------
// ★细案 spec-entities-page-ia：实体页的**唯一一份**视图状态
//   （数据逻辑全在 `src/render.js` 的纯函数里：`selectEntityPage` / `entsHitCounts`；这里只存状态，
//    一行数据逻辑都不写——本仓"零第二份状态"纪律，与上面的 `sw2ChronicleView` 完全同款：
//    纯视图态、不落 SSOT、不落盘、重绘保留、关面板重置）
//   ★终审 M10：默认值**只有一份真源**（渲染层的 `makeEntsView()`）——原先这里与 `src/render.js` 的
//     `ENTS_DEFAULT_VIEW` 各写一份字面量、靠人同步（本笔加 `scope` 字段时正是两处都要改）。
let sw2EntsView = makeEntsView();
const SW2_ENTS_KINDS = new Set(['all', 'faction', 'character']);
const SW2_ENTS_FILTERS = new Set(['busy', 'recent', 'named', 'orphan']);
function sw2EntsViewReset() { sw2EntsView = makeEntsView(); }
// ★终审 C1：中文输入法**组合期**标志（模块级：`compositionstart`/`compositionend`/`input` 三支监听共享）。
//   组合期一律不写状态、不重绘（`refreshSections` 换掉搜索框节点 = 组合被中途打断 = 玩家打不出字）。
let sw2EntsComposing = false;

// ============ 依赖注入工厂 + 受控口（接线层够到本族的**唯一**通道）============
// ★形态照 `createHotLedgerHub` / `createSnapshotHub` 先例。★本族**零注入形参**（它谁也不调）：
//   工厂是"状态 → 口的映射"，没有 deps —— 这不是漏了，是这一族的形状（比热账族更叶子：
//   热账族还要注入 `freshCtx`，本族连上下文都不碰）。
export function createViewStateHub() {
    return {
        // ---- 读：返回**当前**那一个对象（★不许抓死：见文件头那条纪律）----
        chronicle: () => sw2ChronicleView,
        entities: () => sw2EntsView,
        // ★两个视图对象**一次读齐**：接线层那两处渲染调用点（`renderWindow` / `refreshSections`）
        //   原先各写一遍同样的解构 ⇒ 收成一口，省得将来形状改了要改两处。
        views: () => ({ chronicleView: sw2ChronicleView, entsView: sw2EntsView }),
        // ---- 复位（纯视图态：关面板即回默认；默认值从 `makeXxxView()` 重取）----
        resetChronicle: sw2ChronicleViewReset,
        resetEntities: sw2EntsViewReset,
        // ---- 编年页动作（★词表与"回第一页"两条规矩跟状态**同住一处**）----
        //   ① 换"只看/了结/轮次" ⇒ **回第一页**（命中集合变了，停在第 3 页会落在另一批行上）；
        //   ② 换"计数口径" ⇒ **不回第一页**（一个行都不动，只是几枚钮换了把尺子；回首页 = 无理由的位移）。
        setLayer: (v) => { if (['all', 'event', 'book'].includes(v)) sw2ChronicleView.layer = v; sw2ChronicleView.page = 1; sw2ChronicleView.pageBook = 1; },
        setClosed: (v) => { if (['any', 'done', 'open'].includes(v)) sw2ChronicleView.closed = v; sw2ChronicleView.page = 1; sw2ChronicleView.pageBook = 1; },
        setRange: (v) => { if (['5', '10', 'all'].includes(v)) sw2ChronicleView.range = v; sw2ChronicleView.page = 1; sw2ChronicleView.pageBook = 1; },
        setChronicleScope: (v) => { if (v === 'all' || v === 'hit') sw2ChronicleView.scope = v; },
        //   ★两层的页是两枚分页器、两个游标（细案 §3.4：一枚共享分页器会在"收起的名单"上翻页 ⇒ 死控件）
        turnChroniclePage: (layer, delta) => { if (layer === 'book') sw2ChronicleView.pageBook += delta; else sw2ChronicleView.page += delta; },
        // ---- 实体页动作（★`SW2_ENTS_KINDS`/`SW2_ENTS_FILTERS` 那两张词表**只住本文件**）----
        //   返回 false = "这个词不在两张词表里"（接线层据此**一个字都不动**，与原先的 else-if 同义）。
        //   ★`page = 1` 与三个兄弟动作一致：换了分组口径 ⇒ 命中集合的**切法与顺序都变**。
        applyEntsFilter: (v) => {
            if (SW2_ENTS_KINDS.has(v)) sw2EntsView.kind = v;
            else if (SW2_ENTS_FILTERS.has(v)) {
                const i = sw2EntsView.filters.indexOf(v);
                if (i >= 0) sw2EntsView.filters.splice(i, 1); else sw2EntsView.filters.push(v);
            } else return false;
            sw2EntsView.page = 1;          // ★换筛选必回第一页（否则"页码夹紧"会让人以为点了没反应）
            return true;
        },
        setEntsSort: (v) => { if (['active', 'recent', 'name'].includes(v)) sw2EntsView.sort = v; sw2EntsView.page = 1; },
        setEntsGroup: (v) => { if (['none', 'parent', 'loc', 'kind'].includes(v)) sw2EntsView.grp = v; sw2EntsView.page = 1; },
        //   ★页码由渲染层夹紧（`selectEntityPage` 的越界夹紧），这里只管加减——零第二份夹紧逻辑
        turnEntsPage: (delta) => { sw2EntsView.page += delta; },
        setEntsScope: (v) => { if (v === 'all' || v === 'hit') sw2EntsView.scope = v; },
        // ---- 搜索框写入闸（组合期）----
        //   ★`input` 那支监听一进门就 `anyComposing()` 早退；两个 `compositionstart` 各置一格。
        setChronicleComposing: (on) => { sw2ChronicleComposing = Boolean(on); },
        setEntsComposing: (on) => { sw2EntsComposing = Boolean(on); },
        anyComposing: () => sw2ChronicleComposing || sw2EntsComposing,
    };
}

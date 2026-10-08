// story-world-v2/web/index.js
// K30 骨架 + K34 渲染接线（编排层·浏览器侧）：ST 插件入口——面板挂载 + 八页签渲染刷新。
// 范式实读 v1（manifest/js/settings.html/ui.js）后仿写，命名空间 sw2_ 全隔离：
//   ① settings.html 模板经 ctx.renderExtensionTemplateAsync 注入（缺模板有最小回退窗）；
//   ② 扩展菜单「魔杖」入口挂 extensionsMenu；③ 弹窗 z-index 压顶内联规则（id 特异性）；
//   ④ css 带版本查询防浏览器缓存吞修复；⑤ 全局错误网进状态条。
// K34 渲染接线：refreshWorld(world, {config, oldVolumes}) 把 render.js 纯函数产物填入页签；
//   面板零第二份状态（A-2 语义）；按钮走 data-action 委托 → window.__sw2Actions（K36 接调度，
//   当前为占位提示）。纪律：模块顶层零 DOM（node --test 可动态导入；browser-compat 扫描覆盖）。
import { renderAll, renderVolumeReadHtml, renderChainViewHtml } from '../src/render.js';   // ★leg160：`panoramaRangeFromValue` 那条 import 随那一族撤掉
// ★★★leg85（丙案 · `src/render.js` 的第一个切口）：`LABELS` / `PANEL_BUILD` 这两个**共用底**的符号
//   已随那一族搬进 `src/render-base.js` ⇒ 本文件改指新家（**不搞 re-export**：那会让"它到底住哪"
//   重新变模糊，正是本仓 leg71 立规矩要治的病）。`test/render.test.js` 那边同批改指向。
import { LABELS, PANEL_BUILD } from '../src/render-base.js';
// ★★★leg79（丙-web 第四格）：视图态族（编年/实体两页的视图态 + 复位 + 两枚词表 + 组合期标志）
//   整族搬进 `web/view-state.js`。★本文件**不再** import `makeEntsView`/`makeChronicleView`
//   ——那两个工厂现在由新模块直接问渲染层取（默认值的真源照旧只有一份，只是取它的地方少了一处）。
//   ★够到那一族一律走**受控口** `viewState`（见下面建 hub 那一段）。
import { createViewStateHub } from './view-state.js';
import { createMapPopupHub } from './map-reader.js';
import { bindSettingReader } from './setting-reader.js';
import { bindPageSubtabs } from './page-subtabs.js'; import { bindPanoramaReader } from './panorama-reader.js';
// ★★★leg73（丙-web · 第二格）：快照容错子系统整族搬进 `web/snapshot-store.js`。
//   ★判据锁死：**只取回工厂**（取回集合"不多不少"）——其余一律经 `snapHub` 的方法取用。
import { createSnapshotHub } from './snapshot-store.js';
// ★★★leg140（用户令「**点击实体就会出现，能看到这个实体的各种属性以及它的事迹**」）：
//   实体观览窗口整族住 `web/entity-window.js`（取数 ＋ 拼 HTML ＋ 开关三件都在那儿，本文件只装配）。
//   ★为什么不写在这里：本文件有**行数硬锁**（`< 3100`，余量见 `STATE.md` §1）——新功能与它的理由
//     都该先进模块（照 leg107 把动作路由搬出去的同一条理由）。
import { createEntityWindowHub, ENTITY_WINDOW_ACTION } from './entity-window.js';
import { createSimulationProtectionHub } from './simulation-protection.js';
import { createWorldWriteGuard } from './world-write-guard.js';
// ★★★leg78（丙-web · 第三格）：热账（hot-meta）读写落盘子系统整族搬进 `web/hot-ledger.js`。
//   本文件从此**不再持有一格热账状态**（11 格全在新家）。
import { createHotLedgerHub } from './hot-ledger.js';
// ★★★leg82（丙-web · **第六格 · 最后一格**）：**参数族**整族搬进 `web/param-panel.js`。
//   ★判据锁死：**只取回工厂**（取回集合"不多不少"）——其余一律经 `paramApi` 的**受控口**取用
//     （清单见新家 `return {...}`：hub 四类口 + 自证面/撤销/写账补镜像 + 面板 DOM 镜像 + 忙闩 + 复位）。
//   ★旧家不再留任何"参数族的实现"：hub 装配、自证面、撤销、写格留痕、忙闩、DOM 镜像、最近世界
//     全部只有新家那一份（判据跑在**剥注释后的源码**上——注释里可以留档、代码里不许再有定义）。
import { createParamApi } from './param-panel.js';
// ★★★leg103（A3）：**「覆盖现存世界」的告知文案与事实归一**整族搬进 `web/world-replace.js`
//   （`worldToBeReplaced` / `initWorldOverwriteNotice` / 新增 `importOverwriteNotice`）。
//   ★为什么搬：那一族是**纯文案 + 纯归一**（零 DOM、零引擎依赖），而且现在有了**两个**入口
//     （初始化 / 导入）⇒ 两处文案必须同一口径，收在一处才不会各写各的。
//   ★**不做 re-export**（leg71 立的规矩：re-export 会让"它到底住哪"重新变模糊）——
//     原消费者（`test/init-overwrite-guard.test.js`）**改指向新家**。
import { worldToBeReplaced, initWorldOverwriteNotice, importOverwriteNotice } from './world-replace.js';
// ★★★leg89：**注入面**整族单独一个模块（`web/inject.js`）——插件第一次"会动你的对话"。
//   ★它只认识"字符串 + 注入口"，不认识引擎：标签规范与名册那两段的组装是**纯函数**
//     （`tagSpecText`/`rosterText`/`buildInjections`，Node 可直接测）；本文件只负责
//     "什么时候设、拿哪个世界设"，以及把读数报出来。设计见 `docs/spec-tagged-actions-extraction.md` §6。
import { createInjector, ledgerVolumes, sw2RecallQueryText, liveRetrievalParams } from './inject.js';
// ★★★（2026-10-05）：参数页那一行「上一次注入的经过」——措辞与拼法住这个模块（**本层只把读数递进去**）。
import { injectReadoutHtml } from './inject-readout.js';
import { macroNamesFromCtx } from '../src/macros.js';   // ★leg148：酒馆宏的真名对（{{user}} → 人设名）
import { normalizeMacroEntities } from './world-entity-migration.js';   // ★leg148：存量局——把"宏做的你"并回棋子
import { mergedMainHtml } from './page-compose.js';   // ★leg98 补四：并页那一页怎么拼（页头＋信息带升页头＋两栏）——理由见该模块头部
import { captureScrollPositions, restoreScrollPositions } from './scroll-keep.js';
// ★★★leg104（A4）：**旧卷展开改挂浮层**（它原来插进编年页 ⇒ 每轮重绘把它**无声吞掉**，且展开后没有收起口）。
import { openVolumePopup, closeVolumePopup } from './volume-popup.js';
// ★★★leg107：**按钮点击那一口搬进 `web/action-router.js`** —— 接线层的端到端判据的第一格。
//   病与口径见该模块头部与细案 `docs/superpowers/specs/2026-09-22-leg107-action-router-design.md`：
//   这条链是 leg89/92/103/105 四次实机「点了没反应」的现场，而它此前**一行判据都没有**
//   （96 个判据文件里 0 个真的派发过点击）。搬出去它才能被单独 import 进 Node **真点一下**。
import { createActionRouter, readPayload } from './action-router.js';
// ★★★leg142（用户令「把获取模型列表（点击某一项自动填入模型id）和测试是否连通做一下」）：
//   **模型通道那一族的新家** —— 设置表单的写通道（原住本文件）＋ 两枚新按钮的接线。
//   搬的理由见那个文件头（本文件只剩 1 行；而那两个新功能本来就属于这一族）。
import { createModelChannelHub, SETTINGS_INPUTS, proseStripLists } from './model-channel.js';
import { readEmbedConfig } from '../src/embed-client.js';
// ★★★leg161（用户令「**那就让 chat 侧也接上向量检索呗**」）：**记忆通道（向量）那一族接回来**，
//   ★作用面本笔扩了：原来只喂"世界模型那一栏"，现在**聊天侧那一段也吃向量路**。
//   ★两条通道的装配 ＋ 那条"聊天侧向量召回口"**整段住 `web/settings-channels.js`**
//     （本文件有 `<3100` 行硬锁 ⇒ 照纪律"要加东西先把一族搬出去"）。
import { createEmbedWiring, makeVectorRecall } from './settings-channels.js';
import { createPanelTools, abstractSelectionFor } from './panel-tools.js';
import { diagExtract, setDiagnosticDetails, diagEvidence, diagTickOutcome, diagSettingOutcome } from './diagnostic-transport.js';
import { rememberHotHistory } from '../src/vector-history.js';
import { loadLedgerVolumes } from './inject.js';
import { createWindowShell } from './window-shell.js';
import { probeEmbedChannel } from '../src/embed-client.js';   // ★leg172：「量一批几行」那口（probeEmbedChannelCapacity）已撤——发多少行由通道自动缩批学到
// ★★★leg109：**长活儿的护栏**（闸 + 出声 + 按钮灰掉 + 抛错也放闸）——三件事要跑几十秒到几十分钟
//   （只重抽设定 / 只抽刻度 / 采用草稿），此前跑起来**界面上没有任何"正在跑"的样子**
//   ⇒ 玩家以为没点上、再点一次就发出去第二串模型调用。理由全写在 `web/long-task.js` 里
//   （本文件有行数硬锁 `< 3100`，解释一律进模块）。
import { createLongTask, LONG_TASK_LABELS } from './long-task.js';
// ★★★leg109：**状态条那一族**（写那行字 / 未捕获异常那一句 / 挂样式表）搬进 `web/status-bar.js`。
//   ★为什么搬：本文件有行数硬锁 `< 3100`，而 B4 那笔实测要 9 行、余量只有 4 行
//     ⇒ 用户当场拍板"把状态条搬出去"（搬的账与理由写在那个文件头部）。
// ★★★leg162：**两件事同批**搬进 `web/status-bar.js`——① 外壳动作条右端那格状态的实现 `syncActionbar`
//   （同族：把真值印成人话）② 总闸那一族（键名 / 一次性迁移 / 判据）。本文件只留：`AUTO_ADVANCE_KEY`
//   别名（2 处读者）＋ 两个函数的**转出**（`test/plugin-master-switch.test.js:17` 照旧从本文件取）
//   ＋ `syncActionbar` 的**依赖注入**（只有本文件同时够得着参数真源与账上镜像）。
import { setStatus, injectCss, reportWinError, syncActionbar as syncActionbarImpl, ensureAutoAdvanceKey, autoAdvanceOn } from './status-bar.js';
import { installRuntimeDiagnostics } from './runtime-diagnostics.js';
// ★★★（2026-10-05 用户第二道令）：这里原来 import `tagReadoutLine` 来拼参数页那一行原始读数
//   （`标签注入：…`）——那一行**已整行撤掉** ⇒ 这一条 import 也没了消费者（**整行删除**）。
//   ★`tagReadoutLine` 本身仍在（`src/tick.js` 的落账读数用它：标签抽到了几条），别误删那边。
import { expandChain } from '../src/chain.js';
import { migrateLegacyAttrs } from '../src/settle.js';   // leg24 片4：旧账一次性清理（读到热账后、渲染前）
// ★★★leg74（补接线）：同一家的**第三处旧账清理**要先引进来才谈得上接线——
//   `migrateStyleRulesFromCanon` 早就从 `src/settle.js` 导出了，但接线层一直**既没 import 也没调用**
//   ⇒ 老账里那几类（文风禁令/变量指令/其他）会一直躺在面板上（用户看到的就是它）。
import { migrateStyleRulesFromCanon } from '../src/settle.js';
import {
    hotAccountShape, loadHotAccount, planChronicleRotation, countLedgerEntries,
    volumeToChronicleRows, buildExportBundle, verifyImportBundle,
    // ★★★leg55（leg54 §6.4「凡是面板上印出来的数字，都要问一句它是现算的还是写死的」）：
    //   冷档阈值那两个数（`500 轮 / 5MB`）此前是**渲染层写死的兜底**，而设置页那行写着"读 config"——
    //   实际 `renderCfg()` 从不注入这两键 ⇒ 那半个分支是**死路**，"现算"是假的。
    //   ⇒ 把真源接上（同一份常量既被 `planChronicleRotation` 当缺省、又被面板印出来）。
    PROPOSED_LIMITS,
} from '../src/storage.js';
// ★★leg70（A6）：import 加 `scalesToFlat` —— 采用通道里那份草稿的**旧两列**必须走**唯一**那条派生路
//   （概念表是源、旧两列是派生视图，`abstract.js:1064` 那三条口径）。手写第二份 ⇒ 面板/进包的旧两列
//   与 `刻度` 漂移成"一个数两把尺子"（leg56 在"盘算上限"上治过的老病）。
import { extractWorldSetting, applySettingToSsot, resetDynamicLayer, describeProgress, buildScalePrompt, sanitizeScales, scalesToFlat, EXTRACT_CONCURRENCY } from '../src/abstract.js';
// ★leg40：从世界源起根（把书里"正在发生的事"落成账上的线头事件；幂等、可重入、失败零阻塞）
// ★★★Task 4：`seedRootsForWorld` 已搬去 `web/seed-roots-wiring.js`（本文件有 `< 3100` 行硬锁；
//   起根这一笔要接"来源身份 + 原话"与带行号的分块 ⇒ 照纪律「先搬一族再接线」）。
import { seedRootsFromPass, seedFingerprint } from '../src/seed-roots.js';
import { seedRootsForWorld } from './seed-roots-wiring.js';
// leg24 片1（停抄书）：runAttrsRound / runRelationRound / applyRosterAttrs / refineEntityAttrs 四个入口随
// 「抄书流水线」整条删除（名册里不再有从书里抄来的属性/隶属，补抽按钮与 bus 动作同批下掉）。
// bookFingerprint 的浏览器侧唯一用途是补抽前的指纹守卫，随之删除（书指纹仍由 extractWorldSetting 写进 setting）。
// ★★★leg144：`createCache` **请回来了**（它此前只活在判据与 demo 里——见下面 `abstractCache` 那一段）。
import { createCache } from '../src/fp-hash.js';   // ★leg159c：原名 `fingerprint.js`——撞上 EasyPrivacy 那条规则，改名（行数不变）
import { createGeographyHub, retainGeography } from './geography-wiring.js';
import { createIdbVolumeStore, createIdbVectorStore } from './idb-backend.js';
// ★leg73：`../src/snapshot.js` 的 import **整条删掉**（判据②：那一族唯一的消费者是搬走的块；
//   留着就是"块外还有人用"的假象，会让"谁拥有这块逻辑"重新变模糊）。
import { createTickQueue } from '../src/async-tick.js';
import { createMessageConsumptionHub, latestAssistantText, recordConsumption, chatScope } from './message-consumption.js';
import { runTick } from '../src/tick.js';
import { resolveBrowserTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-config.js';
// ★★★leg87：单轮超时/输出上限那两个框的**出厂缺省**要从真源取（与 `createHttpTransport`
//   真正吃的那个数同源）——填过就吃玩家的，没填就印出厂值，绝不自己另抄一份数字。
import { PROPOSED_CALL_LIMITS } from '../src/transport-http.js';
import { composeInitSource, compileSummary, slimLegacyCompile } from '../src/init-source.js';   // ★本次：同行的 `normalizeEntryKey` 已删——它的真消费者在 `web/book-source.js`，本文件零读者
// 细案 spec-entity-field-lookup（用户 2026-09-11 批准）：按需查书补字段（实力/位置）+ 两条 ≤15。
// 本层只负责"取世界书原文 + 落盘"，选择/查询/回写的判据全在 src/entity-lookup.js（纯编排层，可 Node 测）。
// ★leg46：档位/开关/上限三张表**不再在本文件里判**（归一与白名单都在 `src/param-hub.js` 一处）。
// ★本次（清死码）：这里原先还留着 `import { switchOn }`（注释写"闸的读法"），而本文件对它**零读者**
//   ——同一套读法已由下面 `autoAdvanceOn` 自己写了一遍（口径逐字相同，判据仍拿 `switchOn` 与它对拍）。
// ★★参数从世界账里搬出来（leg41 立、leg46 收口）：真源 = 插件自己的存储，
//   世界账的 `dynamic.env` 降级为**镜像**（引擎照旧读它）。★本文件**不再够到参数存储的判据**：
//   `isParamStoreKey` / `normalizeStore` / `ENGINE_DERIVED` 都住进了各自的新家 —— 本次删掉这三条零读者 import。
// ★★★leg46（用户令「重构代码吧，我已经没有耐心了」）：**参数全生命周期收进一个模块**。
//   本文件从此**只留接线**：面板取 `hub.displayEnv()`、改动调 `hub.set(world,key,value)`、
//   载入调 `hub.commit(world)`。写存储/回读核对/镜像/撤销/自证面**一律不再出现在本文件里**
//   （旧的五处写入口 —— `sw2PersistParamEnv` / `sw2WriteParamBucket` / `paramUndo.write` /
//     载入接纳 / 快照前补镜像 —— 连同它们的"各自现算一次世界名"一起删掉）。
//   ★★★leg82 补记：`createParamHub` 的 import **已随参数族搬走**（装配现在在新家
//     `web/param-panel.js` 的 `createParamApi({...})` 里）。这里只留 **`PARAMS_LS_KEY`** 一个常量——
//     它唯一的消费者是本文件那个**有意保留**的例外函数 `sw2WriteLocalBucketRaw()`
//     （并入"服务端文件"那条路；判据 ⑨ 按**函数体**放行它，见 test/param-hub.test.js）。
//     ★注意：常量的**读**（把键名交给那个函数）不是"写参数那一格"——判据 ⑨ 自己留档踩过这个假红
//       ⇒ 不能连 import 一起删掉（删了那个例外函数当场 `ReferenceError`）。
import { PARAMS_LS_KEY } from '../src/param-hub.js';
// ★★★leg125（2026-09-25 · 用户令「**我说了解耦就解耦，直接删了**」＋「一个插件偏要给一个特定的插件
//   留个通道干嘛？？所以我觉得很多都是过剩设计」）：**"投给柚月の记忆"那一族已整条拆除**——
//   `web/memory-store.js` · `src/memory-bridge.js` · 那两张投影表 · 开关 `memoryEnabled` ·
//   面板上"上次投递"那行自证面 · 状态条那半句 · 三条专门判据，全删。
//   ★为什么删（不是"降级"）：它**不存任何东西**——`buildMemoryPayload(world)` 只是把**自己账上现成的
//     事实**拼成两张表，"念"给那个插件听（单向投影）；而账与卷里本来就有这些事实 ⇒ 为一个特定插件
//     专门养一条通道＝**过剩设计**（用户原话）。
//   ★"读"那条路更早就不在了：`src/recall.js` 借人家向量库的那份 **leg122 已拔接线**，本笔连死码一起清。
//   ★**别再请回来**：要把"世界现状"递给聊天模型，走的是**注入那几段**（`web/inject.js`），
//     而且那里**有意只递"与书不一样的那几处"**——递全量＝叙事被账本殖民（那条口径见 `inject.js` 头注）。
// ★★★leg80（丙-web · 第五格）：**取书族**整族已搬进 `web/book-source.js`（三位置逐字节抽取）。
//   本文件从此只留接线：`autoComposeSource` 仍住在本地（它是**编排**、不是取书），但它消费新家的
//   `pickCharacter` / `collectWorldInfoEntries`；四条查书/继承消费点也直接问新家要。
//   ★★★本族特有的形态：新家**不吃 window**，把 ctx 当形参收（三档定位是纯字符串函数，Node 里可直接真测）；
//     唯一例外是**零参**的 `bookEntriesForInherit()`——它内部走**注入进来的** `getCtx()`
//     （见下面那句 `setCtxSource(getCtx);`：★注入的是**函数**不是值，值会把上下文冻在建模块那一刻）。
//   ★旧家仍是**门面**：再导出那 7 个口，外部消费者（`test/lookup-batch.test.js` 等）import 零改动。
//   ★★★leg82（顺手修掉一个**潜伏的假红**，留档）：下面那句原来写成 `export { ... };` **不带分号**
//     紧跟下一行 `import { createParamApi } from './param-panel.js';` ⇒ leg72/leg73 那两把尺子
//     （它们在扫"export 花括号 + from + 模块名"那种 re-export 形状，分隔空白允许换行）
//     会把**两行拼起来**读成一次 re-export —— 命中的那个来源字符串其实是下一行 `param-panel` 的
//     import ⇒ 误判而红。
//     ⇒ 定稿：**句末补上分号**（原来"右花括号"与 "from" 之间只剩空白，现在中间隔了一个分号），语义一字未改。
//   ★★留档纪律（本棒当场踩到）：这一段的注释里**不许**出现**不成对的花括号**——
//     `snapshot.test.js` 的 leg27 d（"自动流程调用的函数必须在模块顶层"）是**按花括号深度**判的，
//     而它**不剥注释** ⇒ 注释里多一个右花括号就会把后面 `advanceTick` 的深度算成负数、
//     那条锁当场红（实测：深度 -2，报"它在某个块内，块外调用不到"）。
//     要举例就写**成对**的，或者干脆用文字描述（本段就是这样处理的）。
import { characterWorldNames, characterBookEntries, collectWorldInfoEntries, pickCharacter, ensureCharacterLoaded, resetBookCache, bookEntriesForInherit, locateNameLine, locateNameSnippet, bookEntryText, bookTextForEntity, setCtxSource, checkCurrentBook, currentBookFingerprint, setAbstractSelectionSource, bookContextIdentity } from './book-source.js';
import { seedAndReport } from './seed-diagnostics.js';   // ★Task 3：种账读数（待核对/弃置/别名/关系边）的收口
import { injectBookRebaseline, runLoadCheck as runBookLoadCheck, rebaselineHandler, bookCheckResult, REBASELINE_ACTION } from './book-rebaseline.js';   // ★leg112：换书检测那一族（实现与理由都住那儿；动作名由它转出）
export { characterWorldNames, characterBookEntries, bookEntriesForInherit, resetBookCache, locateNameLine, locateNameSnippet, bookEntryText };
// ★★★leg76 收尾（本次补齐）：`planBatches` 的 import **已摘掉**——它在接线层的唯一调用点
//   （`planBatchesLazy`，随全册批量补全整族撤除）没了 ⇒ 只收未用 import，**`src/` 一个字不动**
//   （`planBatches` 在 `src/entity-lookup.js` 里仍是活的纯函数：`runBatchLookup` 内部就调它）。
import { runEntityLookupStep, runBatchLookup, pickOneForLookup, deriveLocationFromBook } from '../src/entity-lookup.js';

const NAMESPACE = 'STORY_WORLD_V2';
// ★1.0.0（发布首版）：本常量与 `manifest.json` 的 `version` 是**同一个版本号的两处写法**，
//   必须同批改——`test/browser-compat.test.js` 用 `sw2Version()` 锁住它，改一处不改另一处当场红。
//   ⚠ 别把它当"内部构建号"用：内部构建号是 `src/render.js` 的 `PANEL_BUILD`（面板页脚印的那行）。
const VERSION = '1.1.2';
const WINDOW_ID = 'story_world2_window';
// ★leg93c：事件链**浮层**的容器 id（挂在 `document.body` 上、**不在面板窗口里** ⇒ 面板关着也能看）。
//   一处定义、三处引用（建/收/查），免得又出现"同名副本 = 本仓最贵的病"。
const CHAIN_MASK_ID = 'sw2_chain_mask';
// leg26：参数独立页签；leg27 后：第八页签「快照」
// ★★★leg97（用户令：「**观棋和说书其实是一个东西吧，不如就合并成一页也简洁些**」）：**两个页签并成一页。**
//   定稿口径（照设计交接 §4.3）：
//     · **主层 ＝ 说书那四层**（大势 → 此刻 → 面 → 线 → 点，`src/panorama.js`）；
//     · **附层 ＝ 观棋原来的五块降为四块**：`digest`（时局句）**撤掉**——它与"大势"是同一件事的两种说法，
//       而"大势"是**书的原文措辞**、`digest` 是拼装句（同 §4.3：留大势，digest 那句兜底话并入"此刻"那一行）；
//     · 其余四块（信息带 / 盘算总览 / 动态流 / 位置速览）**原样搬进来**，位置不动、口径不动
//       （★地图那一层用户已裁「先不改」⇒ 只搬位置，不动口径）。
//   ★为什么不把两块塞进 `renderAll` 的两个键：`panorama.js` 是**零 import 的真叶子**（模块图有判据锁着），
//     而 `board` 是**五块对象**（直填 `innerHTML` 会渲染成 `[object Object]`）⇒ 组合只能在**接线层**做。
const SECTIONS = ['panorama', 'chronicle', 'archive', 'entities', 'setting', 'params', 'snapshots', 'settings'];
// ★★★leg98 补四（用户令：「**你总得把这个放在上面吧？而且我要往下翻很久才能看到这些**」）：
//   并页那一页怎么拼（页头 ＋ 信息带升成页头 ＋ 两栏）**整族搬进 `web/page-compose.js`**。
//   ★为什么搬：本文件有条行数锁（`test/web-view-state-layout.test.js` 与 `…hot-ledger…` 都钉着
//     `lines < 3100`）——而这一族长大之后就顶破了那一格。搬走之后本文件**比并页时还薄**，
//     而且"哪一块住哪一栏"变成一处可单独测的纯字符串拼装（`web/page-compose.js` 零 import）。
//   ★两个刷新入口仍然共用同一个 `mergedMainHtml`（一处实现，不分叉）。
//   ★★leg109：`CSS_HREF` 那一行随"状态条那一族"搬进 `web/status-bar.js`（同一个目录 ⇒ 算出来同一个串）。
// ★leg40b（面板本体体检 · 第一刀 + 第二刀）：CSS 也动了（.sw2-env-row 去掉了那条恒真的档位条
//   ⇒ 相关规则失效；空态与卡片的间距随文案收短而变）⇒ 版本号必须往前走，否则浏览器吃旧样式。
// ★leg40c 续（落盘口径那一刀）：界面**文案真变了**（状态条新增"账上本来就是它，无需改动 · 已落盘"一句、
//   世界尺度卡新增构建号一行）⇒ 按 leg29 规矩升位，否则浏览器吃旧 CSS 时那句会排得难看。
// ★★★leg48（用户令「我给你一次机会解决这个bug」）：构建号 → `leg48b-params-page-clean`。
//   ★玩家可见面真的变了：**参数页撤掉了「自检」卡与「🔍 复制自检」按钮**（用户令「把自检也删了，参数页签的」
//     ·「不要在参数界面出现」）⇒ CSS 同步升位。
//   这一棒的现场是**真浏览器 + 真面板代码**跑出来的（见 docs/session-handoff-2026-09-16-leg48.md §2）：
//   写入一直是好的，坏的是"读"——面板按**另一个桶/滞后一拍的镜像**把玩家选的值盖了回去。
// ★leg49（细案 spec-entities-page-ia）同步升位：实体页版式整套换了（三列 + 工具条 + 分组 + 分页），
//   `web/style.css` 里的规则增删一起走 ⇒ CSS 版本号必须跟着升，否则浏览器缓存旧样式
//   （"页面是新代码、样式是旧的"正是这一串要治的病）。与 `PANEL_BUILD` 同批。
//   ★名字随 `PANEL_BUILD` 一起被评审修正过（原名 `…-leg49-entities-three-cols` 含 `entity`，
//   与"玩家可见文本零引擎术语"那条锁对撞 ⇒ 用户拍板改名 `leg49-three-column-roster`）。
// ★终审修正（`-f1`）：`web/style.css` 又动了（删 10 条零生产者旧版式规则 + 补工具条那三处声明）
//   ⇒ 照本文件顶上那条纪律（"CSS 动了就必须升位，否则浏览器吃旧样式"）往前走一格。
//   ★`PANEL_BUILD` **不动**：它是用户验收第①步的判据（印在参数页最下面那行上），本笔的修正不该改它；
//     这两个版本号本来的关系是"同批升位"，不是"必须同一串"。
// ★工具条排布定稿（用户实拍截图 +「这个角色和势力这个位置比较乱」⇒ 拍板「就乙吧」）：
//   `web/style.css` 又动了（新增 `.sw2-ents-g` / `.sw2-ents-gl` / `.sw2-ents-g-q` 三条、删掉被标签替代的
//   `.sw2-ents-grp`）⇒ 照同一条纪律再往前走一格。`PANEL_BUILD` 仍**不动**（同上：它是验收判据）。
// ★leg50（细案 spec-chronicle-page-ia）同批升位：编年页版式整套换了（撤 560px 内滚动框 + 分层块
//   + 工具条 + 每层分页器），`web/style.css` 里的规则增删一起走 ⇒ CSS 版本号必须跟着升。
//   ★`PANEL_BUILD` 也同批升位（`leg50-story-and-ledger`）：本笔玩家可见面**真的变了**
//     （用户验收第①步会照着念这一串，所以它必须能对上本笔）。
//   ★起名前先过禁词扫描——`leg50-layered-chronicle-tools` 与 `leg50-chronicle-layers` **都被扫出 `chronicle`**
//     （leg49 §4① 的同一颗雷，那一条踩过两次）⇒ 定稿 `leg50-story-and-ledger`（零禁词）。
// ★★leg52 同批升位：参数页版式与观棋信息带**真的变了**（四键并卡 + 推进卡撤走 + 撤销卡上移 +
//   长说明折进 `<details>` + 浪尖去重）⇒ `style.css` 增了 `.sw2-fold` 一族规则，CSS 版本号必须跟着升。
//   ★同一条禁词纪律：`leg52-params-and-tide` 里零引擎术语（params/tide 是玩家词面的英文）。
// ★★★leg54 同批升位：世界尺度那四个框从 `<select>` 换成 `<input type="number">`
//   ⇒ `style.css` 增了 `.sw2-param-input` 一族规则（定宽/右对齐/去箭头）⇒ **CSS 版本号必须跟着升**。
//   ★禁词纪律同前：`leg54-unlimited-limits` 零引擎术语（limits 是玩家词面）。
// ★★★leg89 同批升位：设置页多了「与聊天模型的接线」那张卡（三个开关靠现有 `.sw2-toggle` 画，
//   没新增 CSS 规则）——★但升位照做：**CSS 版本号是"这一版样式属于哪一版面板"的凭据**，
//   漏升会让玩家拿着旧缓存看新面板（本仓 leg40b 实测过一次"改了样式没改版本号 ⇒ 看起来没生效"）。
//   ★禁词纪律同前：`leg89-tag-extract` 零引擎术语。
// ★★★leg93c 同批升位：**事件链改走浮层**（用户令「点击后不要放在编年页了，直接弹出一个小窗口」）——
//   病是接线层把链视图插进了**写死的 `#sw2_view_chronicle`**（在大事纪页点「链」，内容跑到编年页）。
//   ⇒ `web/style.css` 新增 `.sw2-cv-mask` / `.sw2-cv-box` / `.sw2-cv-hint` 三条规则
//     （浮层的壳、内层链视图的边距收口、底部提示）⇒ **CSS 动了就必须升位**，否则浏览器吃旧样式。
//   ★顺带把停在 leg89 的号补齐：leg90–leg92 都没动样式，所以一直没升（那不是漏，是没动）。
//   ★★leg94：`leg93c-chain-popup` → **`20260921-leg94-storyview`**——本笔**真的动了样式**：「说书」视图一整族 `.sw2-pan-*`（+ 里程碑条目 `.sw2-rawid-note` / `.sw2-rawid-num`）是新增的，不升号浏览器会拿旧样式表去画新 DOM（版面当场散）。
//   ★★★leg95：→ **`20260922-leg95-linesettles`**——**新增了一条规则** `.sw2-pan-idle`
//     （说书页点层的第三种状态"没人再提了"：与"还开着"必须长得不一样，否则用户仍分不清
//     "这一段还在往下长"和"账上还没放下来"）。★照仓里纪律：**动了样式就升**——
//     与 leg94 那次"只删一条死规则不升"的情形正相反。
//   ★★★leg95b：→ **`20260922-leg95-points`**——用户驳回第一刀（「**开没开着不应该挂在事件上**」）：
//     **点层一个字都不印状态**（那一族 `.sw2-pan-open/-idle/-done` 在点层已无生产点），
//     状态只在线头那枚徽上说一次、分两态 ⇒ **新增 `.sw2-pan-badge.stale`**（挂着没了结）。
//     ★**这一格必须跟着升**：用户上一屏吃的正是旧样式表（页脚号没变 ⇒ 他以为我改错了）。
//   ★★★leg97：→ **`20260922-leg97-places`**——「面」四层落地，新增「面」那一族规则
//     （`.sw2-pan-face` / `-fh` / `-brg` / `-dashi` / `-other` / `-selfcheck`）。
//   ★★★leg98：→ **`20260922-leg98-rowbg`**（用户令「**是改这一栏的颜色**不是标题文字」）：
//     线头那一栏原来 `background:transparent` ⇒ **透出的就是面卡底**（实测两边亮度差 0），
//     整条栏只靠一条 2px 竖线划分，而那条竖线对面卡底只有 **1.21:1** ⇒ 栏目与面卡糊成一片。
//     ⇒ 给那一栏**自己的底**（`#282f3c`）＋ 竖线提亮到 `#3a4356`（live 那条改实色琥珀）。
//     ★**样式真变了 ⇒ CSS 号必须升**（这一格的作用就是"别让玩家吃旧样式表"）。
//   ★★★leg98 补二：→ **`20260922-leg98-bandmerge`**（用户令「**里面有两个大势卡片留一个就好了**，
//     世情 · 3 键，还有浪尖，张力，盘算数量你看看怎么集合起来好看」——三套候选里选了**乙**）：
//     信息带**五格平铺 → 两栏**（左＝世情 3 键竖排 · 右＝三行读数），并**撤掉带里的「大势」格**。
//     ★新增三条规则（`.sw2-band-read` / `.sw2-readrow` / `.sw2-readkey`）＋ `.sw2-tides` 由竖列改**横排**
//     ⇒ **样式真变了 ⇒ 再升一格**。
//   ★★★leg98 补四 → **`20260922-leg98-pagecols`**（用户令「**你总得把这个放在上面吧？而且我要往下翻很久才能看到这些**」）：
//     **信息带升成页头** ＋ 这一页**改两栏** ⇒ 新增 `.sw2-merged-grid/-main/-side`（右栏 sticky、窄屏退单列）；★★★leg99 两笔：动态流撤出 ＋ **两栏各自独立滑动**（动了样式）⇒ 升，理由见 `web/style.css` 那三族规则上方。
//   ★★★leg104 → **`20260923-leg104-scrollkeep`**：★**样式零改动**（`web/style.css` 一个字节没动）；同批升的理由是
//     两个号的 **leg 差 ≤1** 那条耦合锁（leg103 没动样式 ⇒ 本号停在 leg102，只升面板号那条锁就当场红）——见 `src/render-base.js`。
//   ★★★leg104 同棒**第三笔**（样式一批）→ **`20260923-leg104-cues`**：本笔**真动了样式**（`:disabled` 一族
//     ＋ chip 手型 ＋ 档位条/步点灭态色 ＋ 窄屏两条兜底）⇒ 按纪律同批升（这一格的作用就是"别让玩家吃旧样式表"）。
//   ★★★leg141 → **`20260927-leg141-deeds-split`**（用户真机看后当场三条：「**把（账上「涟漪」头一个是他；
//     正文给的也在这一格里）这种文字给删了**」＋「**窗口再大个百分之20差不多就可以**」＋
//     「**把事迹分为他做的和涉及到他的**」）：★**真动了样式**——`.sw2-ew-window` 尺寸两处
//     （`820px → 984px` ＝ 正好 ×1.2 · 高度上限 `86% → 90%`）＋ 删掉 `.sw2-ew-hint` 那条
//     **零消费者**的死规则（撤了说明文它就没人用了）⇒ 按纪律同批升。
//   ★★★leg143 → **`20260927-leg143-params-regroup`**（用户令「**设置里的那些闸其实也可以归到参数页，
//     然后把参数页的样式改一下**」）：★**真动了样式**——新增 `.sw2-limit-group` 那一族组头规则
//     （世界尺度那九个框按「闸 / 尺」分两组，组头靠一条实线与上面分开）⇒ 按纪律同批升。
//   ★★★leg157 → **`20260930-leg157-merged-scroll`**（用户令「**顺便把下拉的bug解决了**」＝观棋页"滚到
//     最底部滚轮就失效、拉不上去"）：★**真动了样式**（grid 高度改由 flex 分配 ＋ 并页改 flex 列 ＋ 一条 `contain`）⇒ 同批升。为什么非改不可（`100%` 看着没毛病、其实让页多出 249px **够不着**的滚动）⇒ `web/style.css` 的 leg157 注释。
//   ★★★leg160 → **`20261001-leg160-panel-window`**（用户令「**还是把这个删了吧，只放最近的就行了**」＋「**把看多少轮之前改成旋钮给用户**」）：★**真动了样式**——`.sw2-pan-range` 那两条规则整块撤掉、手机档名单里两格一并删 ⇒ 同批升。
//   ★★★leg196 → **`20261005-leg196-map-mobile`**（手机端真机报的 bug：地图浮层"只在最顶上露一小块框"）：**真动了样式**——`.sw2-map-mask` 从"只有 `inset:0`"改成**自己声明 `width:100%;height:100%`**，手机档补 `height:100dvh`。为什么非改不可（宿主给 `<html>` 加了 transform/perspective ⇒ 固定定位的包含块变成那个 0 高的盒子 ⇒ 遮罩实测塌成 12px）⇒ 全量读数在 `web/style.css` 那一处 leg196 注释里。
const CSS_VERSION = '20261008-leg209-character-protection-cleanup'; // 角色保护开关放进资料行，撤掉头部长说明。
// leg24 片1：leg21 增量补抽的会话态（refining / refinedFailed / refinedFp / syncRefinedFp）随补抽入口一并删除

export const sw2Version = () => VERSION;
// ★leg40b（第二刀 · 死代码）：`sw2TabState(name, active)` 已删——它是 `{ name, active }` 的恒等包装，
//   生产零调用（只有 `test/browser-compat.test.js` 拿它当"模块能载入"的探针用）。
//   该用例的真实目的（web/index.js 顶层零 DOM、Node 可载）由紧随其后的 `sw2Version()` 承担，探针随之改。

function getCtx() {
    if (typeof window === 'undefined') return null;
    try {
        return window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;
    } catch (_) {
        return null;
    }
}

// ★leg80：把"当前 ST 上下文怎么取"注入取书族（零参的 `bookEntriesForInherit()` 内部用它）。
//   ★★注入的是**函数**，不是值——`window.SillyTavern.getContext()` 每一轮都可能换（换聊天/换卡），
//     注入一个值就等于把上下文冻在**建模块那一刻**（leg73 的 TDZ 铁律、leg79 的"不许抓死"，第三次）。
//   ★位置铁律：必须在**模块顶层同步区**、且在 `getCtx` 的函数声明之后——不许拖进任何入口函数里
//     （否则"装好 fake ctx 直接调取书口"的测试会先跑 ⇒ 静默拿到一本空书）。
setCtxSource(getCtx);
setAbstractSelectionSource(() => abstractSelectionFor(getCtx())); setDiagnosticDetails(() => modelSettings()?.debugDetails === true);

// ★★★leg145b：**未捕获异常的分流搬进 `web/status-bar.js`**（`reportWinError`）——这里只留挂载那两行。
//   原来这里是 `onWinError`：它**不过滤**，页面上**任何人的**异常都写进状态条。实测那一回：手机端
//   SillyTavern 自带 TTS 抛的 `SpeechSynthesisUtterance is not defined` 印在了本插件面板上
//   （本插件一行语音代码都没有）。⇒ 现在**自己的错进状态条、别人的错只进控制台**。
//   ★leg91 那条留档（把**事件对象本身**也带进控制台，好展开 stack 定位"是谁、哪一轮中止的"）
//     随实现一并搬进 `reportWinError`，一个字没丢。

// ★★★leg161：**观棋窗口那一族的壳已整族搬进 `web/window-shell.js`**（压顶样式 · 去重 · 取模板 ·
//   开 · 关 · 挂菜单入口）——理由与历次搬家同一条：本文件有 `<3100` 行硬锁，而要加东西就得先腾地方。
//   ★本文件从此只留**下面这一行装配**（`shell` 那几个函数就是原来那几个）。
//   ★★**一处例外**：`closeWindow` 在下面**包了一层**——因为"收起面板 ⇒ 视图态重置"那两句
//     `viewState.resetChronicle()` / `viewState.resetEntities()` **必须出现在接线层里**
//     （`test/web-view-state-layout.test.js` 的丙-web⑩ 锁着"八个状态只有一个家、接线层走受控口
//     且**真的在用**"）。壳只管窗口本身，视图态归接线层。
const shell = createWindowShell({ windowId: WINDOW_ID, setStatus });
const { modalBoost, ensureWindow, openWindow, ensureWandEntry } = shell;

/** 收起面板：窗口那一半归壳，**视图态那一半归这里**（见上那一段留档）。 */
function closeWindow() {
    shell.closeWindow();
    // ★细案实体页：视图态随关面板重置（照编年页"纯视图态、关面板重置"的口径）
    viewState.resetEntities();
    viewState.resetChronicle();
}

// ★★★leg109：`setStatus`（写状态条那行字）**已搬进 `web/status-bar.js`**（理由见上面那条 import）。
//   为什么留这一段话在这里：本文件里**一百多处**都在调 `setStatus`，改名/换家会让下一任找不到它。

// ★★★leg109：长活儿那套护栏**在这里建**（就在状态条那一处下面）：`setStatus` 的声明必须已生效，
//   而动作总线要用它 ⇒ 位置只有这一处。闸/出声/按钮灰掉怎么做的，全在 `web/long-task.js` 里。
const longTask = createLongTask({ setStatus });

// ★★★leg144：**书指纹缓存终于接上了线**（用户令「在保证抽象质量的情况下优化抽象的时间」）。
//   病（本仓自己登记过的旧账）：`extractWorldSetting` 支持 `cache`，判据与 demo 也一直在用它，
//   而**生产这两处调用从没传过** ⇒ 这条缓存**在真机上一次都没被行使过**
//   （`docs/handoffs/session-handoff-2026-09-11-leg25.md:14` 就写着「书指纹缓存从没接线」，一直没修）。
//   后果：**同一本书再点一次「初始化」= 又是完整一遍 20–30 分钟**（真钱）。
//   ★为什么现在接它是安全的：键 = `bookFingerprint(书文)`（书变即失效）+ `CACHE_VERSION` 形状戳
//     （提示词/形状一变就抬它 ⇒ 老条目自动作废，leg141 那条"老世界命中旧缓存、新提示词一次都没被行使"的教训有据）。
//   ★它**只活在这一次页面会话里**（内存，`CACHE_MAX=5` 按时间淘汰）——刷新页面即清空，不落盘、不污染设置区。
//   ★它**不碰**「只重抽设定」：那条通道传 `force: true`（它的存在意义就是"书没变我也要重抽"）。
const abstractCache = createCache();

// ★★leg40c 续（用户实机「只是展开下拉就弹一句，点了还是改不了值」）：
//   **任何一次重绘都会把参数页的 `<select>` 整个销毁重建**（`innerHTML = ...`），
//   而浏览器**已展开的原生下拉属于那个被销毁的节点** ⇒ 列表当场关掉、那一次的点击作废。
//   这是 leg27 那条"下拉自己关"的同族病：那条只治了 `set-param` **之后**的自重绘，
//   而 `refreshWorld`（推进一轮 / 载入世界 / 回快照 / 刷新快照清单）**任何一刻都可能来**。
//   ⇒ 治法：**玩家手下有活控件时不换那一页的 DOM**——把这次重绘**押后**，控件失焦时补。
//   ★位置必须在 `refreshWorld` **之前**（它也要用这两个东西；放后面就是 TDZ 当场炸——
//     本仓 leg40c 已经为"循环依赖 + TDZ"吃过一次 653 条判据一片红）。
const pendingSectionRefresh = new Set();
let sw2SectionRefreshRunning = false;   // 重绘**自己**会夺走焦点 ⇒ 会再触发一次 focusout ⇒ 必须防重入
// ★★★leg89 留档（一次没走通的尝试，如实记着）：注入开关那条路上曾经加过一张"这次重绘是插件自己发起的"
//   通行证（`sw2SelfClickRedraw`），用来豁免下面那条押后判据——**试过，实机没解决**（用户仍报"点了不切、
//   点别处才切"）⇒ 已撤。现在那个开关**不重画整页**，只原地改那一行控件自己的 DOM（见 `sw2ToggleInject`），
//   因此**不需要**任何押后豁免：它既不换整页、也不夺焦点。
// ★★★leg82：`playerIsTouchingParams()` 已随参数族搬进 `web/param-panel.js`（本文件一律走
//   `paramApi.playerIsTouchingParams()`）。★"它必须在 `refreshWorld` **之前**可用"这件事没变——
//   受控口是**具名方法**（不是值），调用时才求值 ⇒ 用法与原先那个局部函数**逐字相同**。
if (typeof document !== 'undefined') {
    document.addEventListener('focusout', () => {
        if (!pendingSectionRefresh.size) return;
        setTimeout(() => {
            if (paramApi.playerIsTouchingParams()) return;   // 手还在控件上（跳到另一个控件）⇒ 继续押后
            if (sw2SectionRefreshRunning) return;   // 重绘自己正在跑（它会夺焦点 ⇒ 别再自己咬自己）
            const names = [...pendingSectionRefresh];
            pendingSectionRefresh.clear();
            console.info('[story-world-v2] 控件已失焦 —— 补上押后的重绘：', names.join('、'));
            refreshSections(names);
        }, 0);
    }, true);
}

// ---------- K34：渲染接线（纯函数产物 → DOM；面板零第二份状态） ----------
export function refreshWorld(world, { oldVolumes = [] } = {}) {
    if (typeof document === 'undefined') return;
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    try {
        // ★★leg40b（A2 · 体检修）：这里原有一个 `config` 形参，算出的 `cfg` **从未被用过**
        //   （下一行硬调 `renderCfg()`）⇒ 任何调用方传进来的 config 都被**静默丢弃**。
        //   "忘了加参数不报错"是这类静默丢弃最坏的地方：以后往 config 塞一个开关，面板会安静地不认。
        //   现在把这个形参撤掉，只留**一条**配置路：`renderCfg()`（= 活设置 + 任务/快照/记忆自证）。
        //   判据同步：`test/render.test.js` 里那条"不许整页重绘"的用例仍锁 `renderCfg()` 这条真路。
        sw2LastWorld = world;   // K41：链视图入口持引用（同一对象，零第二份状态）
        // ★★★leg92（真缺陷修 · 用户报「开关写着 1、构建号是新的、`sw2_` 一个都没有」）：
        //   **注入必须在"世界进内存之后"再设一次**——`setupAsyncTicks` 里那次 `apply()` 跑在
        //   `loadWorld()` **之前**，那一刻 `sw2LastWorld` 还是 null ⇒ `getWorld()` 返回 null
        //   ⇒ 名册段为空；更坏的是**总闸关着时世界永远不推**，而重设注入只挂在"世界推完一轮"
        //   （`async-tick.js:57` 的 `refresh` 只在演算成功后才跑）⇒ **再也没有第二次机会**，
        //   账上只剩"注入了 0 字/没注入过"（两者在字典里长得一样：`clear()` 会删 key）。
        //   ⇒ 放在这里（每一条 `refreshWorld` 调用点都覆盖：首载 / 切聊天 / 切世界 / 推进一轮）。
        try {
            sw2Injector?.apply();
            // ★★★（2026-10-05 用户第二道令）：这里原来还把 `r.line`（那句原始读数）存进
            //   `sw2LastInjectLine`，供参数页那一行印出来——那一行**已按用户令撤掉**
            //   （"那句我让你抽出重点的话也删了，毕竟已经抽出来了"）⇒ 副本与变量一起删。
            //   参数页现在那一行读数**现取** `sw2Injector._facts()`（不留第二份真相）。
        } catch (err) {
            // 失败零阻塞：注入不成交绝不能拦住面板渲染（本仓既有口径）
            console.warn('[story-world-v2] 载入世界后重设注入失败（面板照常）:', err?.message || err);
        }
        // leg27 后：快照清单同理（config.snapshots = IDB 读回的元信息 + 一行事实摘要）
        // ★★★leg46 续·十（**用户第五次实机："我改了值旁边直接变成未定" ⇒ 不再有"两个来源"**）：
        //   参数页**整块按 `paramEnv` 画**（下拉与格一起画，它们天然一致），**再按控件对齐一遍格**。
        //   把清单里不存在的键也一起交给渲染层 ⇒ 渲染层不会画"默认"小标（那个小标本身就在误导玩家：
        //   "默认"与"你改的值"在同一格里分不清）。
        const live = paramApi.sw2CollectLiveParamValues();
        const cfgForRender = renderCfg(live.env ? { paramEnv: live.env } : {});
        const out = renderAll(world, { config: cfgForRender, oldVolumes, view: viewState.views() });
        // ★★leg46 续·六（**格与控件同源**）：页面刚用 `cfg.paramEnv` 画完 ⇒ 顺手用**同一份**把显示格对齐。
        //   为什么必须用同一份（用户第四次实机：四个下拉都选对了、四格却写「未定」）：格若自己去读第二遍真源，
        //   就会与控件错开一个时刻（读到空 ⇒ 写「未定」），看起来就像"什么都没生效"。
        // ★★leg46 续·十：整页画完之后**按控件对齐格**（格的字只从同一行的控件读 ⇒ 永不分叉）。
        //   真源与控件是否一致，交给自检卡去报（它才是说这件事的地方）。
        try { paramApi.sw2SyncParamCells(); } catch (_) {}
        const chipWorld = win.querySelector('#sw2_world_chip');
        if (chipWorld) chipWorld.textContent = `世界：${out.header.world || '—'}`;
        const chipTick = win.querySelector('#sw2_tick_chip');
        if (chipTick) chipTick.textContent = out.header.tick;
        // ★★★leg162：外壳动作条右端那格状态（**每一页都在**，所以在这里刷——每次整页渲染都覆盖）
        syncActionbar(world);
        for (const name of SECTIONS) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (!el) continue;
            // ★★leg40c 续：**不许在玩家手下抢 DOM**（见 `refreshSections` 的注释）。
            //   这里押后的是**当前那一页**：玩家正拉开下拉/按着按钮时，那一页的 innerHTML 一换，
            //   原生下拉当场关闭、那一次点击作废 —— 用户看到的正是"点了还是改不了值"。
            //   口径：其余页照常刷新（观棋页照旧随每轮更新），押后的那页在失焦时补上。
            if (paramApi.playerIsTouchingParams() && el.contains(document.activeElement)) {
                pendingSectionRefresh.add(name);
                console.info(`[story-world-v2] ${name} 页上有控件正被操作 —— 本轮整页刷新押后该页`);
                continue;
            }
            const keep = captureScrollPositions(el);   // ★leg104（C2）：重绘前先记住这一页的滚动位置（页 ＋ 并页两栏）
            if (name === 'panorama') {
                // ★leg97 并页：这一页是**四层 ＋ 观棋那几块**拼出来的（见 `mergedMainHtml`）。
                //   2026-09-08 实机那条教训仍在：board 是**五块对象**，直填 innerHTML 会渲染成 `[object Object]`。
                el.innerHTML = mergedMainHtml(out);
            } else {
                el.innerHTML = out[name];
            }
            bindPageSubtabs(win).sync(); panelTools.bind(win); if (name === 'setting') bindSettingReader(win).sync(); if (name === 'panorama') bindPanoramaReader(win).sync(freshCtx()?.chatId, keep); else restoreScrollPositions(el, keep); // 先恢复阅读状态，切聊天不沿用旧滚动。
        }
        refreshSettingsHints(); // 密钥 placeholder 随渲染刷新（表单值由 cfg 注入）
        // 第十三棒：每轮进展计数——「编年 +N 行」直接区分模型空步 vs 引擎未落账（账目可读性）
        const chronicleLen = Array.isArray(world.chronicle) ? world.chronicle.length : 0;
        const delta = sw2PrevChronicle == null ? null : chronicleLen - sw2PrevChronicle;
        sw2PrevChronicle = chronicleLen;
        // ★leg32f：本轮的**丢弃/裁定**也要出声（用户为了「演算失败：必填缺失 / 同名实体」吃过整步被拒的苦）——
        //   口径：只报**计数**（细节看观棋·动态流的「本轮裁定 N 条」），没丢就不出声（不留恒显示的噪声）。
        const lastLog = Array.isArray(world?.meta?.simLog) ? world.meta.simLog[world.meta.simLog.length - 1] : null;
        const lastWarns = Array.isArray(lastLog?.warnings) ? lastLog.warnings : [];
        const droppedNow = lastWarns.filter((x) => typeof x === 'string' && (x.startsWith('提议丢弃') || x.startsWith('裁定:') || x.startsWith('校验拒绝:'))).length;
        const dropLine = droppedNow ? ` · 本轮丢/拒 ${droppedNow} 条提议（细节见动态流）` : '';
        setStatus(`已同步 · 刚演完 ${out.header.tick}${delta == null ? '' : ` · 编年 ${delta >= 0 ? '+' : ''}${delta} 行`}${dropLine} · 窗口只读，不参与剧情`);
    } catch (err) {
        setStatus(`注意：渲染失败：${err?.message || err}`);
        console.warn('[story-world-v2] render failed:', err);
    }
}

// ---------- K34/K36：按钮委托（真实调度：advance-world 已接队列；其余走动作总线） ----------
// ★leg40b（A3 · 体检修）：**兜底那句原来会把引擎术语印到玩家眼前**——
//   面板渲染与 `window.__sw2Actions` 装配之间存在一个窗口（模板先到、总线后到），
//   在这个窗口里点任何动作都会走到下面那一行，于是状态条打出「「lookup-entity」接线随后续步骤（当前为占位）」：
//   既漏了英文动作名，又违反本仓 A-3「玩家可见文本零引擎术语」。现在兜底改成人话，并把动作名收进控制台。
//   （`player-desc` 那个历史残留的 data-action 已撤，见 render.js 设置页那段注释。）
function dispatchAction(action, payload, event) {
    const bus = typeof window !== 'undefined' ? window.__sw2Actions : null;
    if (bus && typeof bus[action] === 'function') {
        bus[action](payload, event);
        return;
    }
    if (action === 'advance-world' && sw2TickQueue) {
        // ★★★leg88 撤回留档（原 leg87 那笔"手动路径递对话"已撤，回到零参）：那笔递的是"你发的话"。
        //   **用户裁示：那不是他要的提取**（他要的是"注入提示词让聊天模型产出带标签的正文、插件从正文里正则提取"）。
        // ★★★leg89：新口径递给它的是**最后一条正文**（标签长在里面），但**同一段正文只推一次**
        //   ⇒ 走 `sw2AdvanceOnce()`（自动路与手动路共用同一把尺子，见那个函数的头注）。
        const v = sw2AdvanceOnce({ manual: true });   // ★★leg108（B5）：**被挡住也要出声**——此前返回值被丢掉 ⇒ 上一轮还在跑时连点第二下**一个字都不说**
        if (v?.skipped === 'busy') setStatus('⏳ 上一轮还在跑——这一下没有重复发（跑完会自己更新）');
        else if (v?.skipped === 'no-queue') setStatus('注意：这一下没接上（面板还没准备好）——世界没有动');
        return;
    }
    console.warn('[story-world-v2] 面板还没装配完，这一下没接上：', action);
    setStatus('⏳ 面板刚打开、还没装配完 —— 稍等一拍再按一次（世界没有动）');
}

// ---------- K35：存储层接线（热账=chat metadata；冷档=IndexedDB 卷） ----------
const HOT_META_KEY = 'story_world_v2';
const EXPORT_FILENAME = 'story-world-v2-export.json';

// 首开空态世界（形状合法=render 契约；K34 防御口径：空世界=各数组为空，不是裸 {}）
const EMPTY_WORLD = Object.freeze({
    version: 1,
    context: { world: '', tension: 0.5, positions: [] },
    entities: [],
    weights: {},
    agendas: [],
    events: [],
    chronicle: [],
    milestones: [],
    meta: { tick: 0, simLog: [] },
});

// v1 教训（adapter.js）：ctx.chatMetadata 是取用时的引用快照，聊天切换后过期——
// 每次读/写热账都重新取最新 context。
function freshCtx() {
    return getCtx();
}


// ---------- ★leg78：热账族的**三个转发口**（真定义全在 `web/hot-ledger.js`）----------
// 为什么留同名转发而不是把调用点改成 `hotHub.readHotMeta()`：这些名字是**既有调用点与判据钩子**
// 认的（`sw2SetFlushTimeout` 供 `node --test` 把超时压到几十毫秒）；保留同名 ⇒ **测试 import 零改动**。
// ★但**只许转发**，不许在这里再实现一遍（再写一遍 = "两份真相"，本仓最贵的病）。
// ★★这三个口**不是转发**、是**解构绑定**（`const {…} = hotHub;`，见上面建 hub 那一段）——
//   为什么不像下面两个那样写转发函数：判据「热账族在旧家**不再定义**」咬的就是
//   `function readHotMeta` 这种**函数声明**（再写一遍 = 两份复制品）。解构来的绑定**不是定义**，
//   而全文件的调用点（裸名）与语义**一字未变** ⇒ 这才是该有的形状（也是判据 ⑤ 咬的受控通道形状）。
// ★下面这两个**是**转发口（判据点名要求"只转发"）：
// ★它是既有导出名（`web/index.js` 的消费者按名字取它）⇒ **具名再导出**那个绑定。
export { sw2ExplicitChatName };
/** ★leg78 转发口：热账超时档注入（真定义在新家；判据钩子，见上）。 */
export function sw2SetFlushTimeout(ms) {
    return hotHub.sw2SetFlushTimeout(ms);
}
// ★leg78：`sw2ExplicitChatName` 与上面那三个口同款 —— **解构绑定**，不写转发函数
//   （判据「旧家不再定义」咬的是函数声明；而它是既有导出名 ⇒ 下面把它原样再导出）。

/**
 * ★leg73/leg78：**落盘簿记复位**（只供判据用；每次测试开局调用，防上一例的在飞/待落状态串味）。
 *   三家的复位**组合**在这里（对外仍是同一个名字 ⇒ 两个测试文件 import 零改动）：
 *   ① 热账自己那 8 行 → `hotHub.resetHotLedgerState()`（甲案：不与参数族绑在一起）；
 *   ② 参数族（撤销栈/管辖键/墓碑/抢回名单）；③ 快照族（内容闸指纹 + 参数闸基准）。
 */
export function sw2ResetFlushState() {
    hotHub.resetHotLedgerState();
    // ★★★leg82：参数族那一份复位**一次清四样**（hub 的撤销栈/管辖键/墓碑/抢回名单 + 写格留痕 + 忙闩 + 最近世界）
    //   ——四句各有其主，别把谁的复位并到别人家里去（热账/快照各有自己的家）。
    paramApi.reset();   // ★leg46：撤销栈 + 管辖键 + 墓碑 + 抢回名单都是 hub 的模块级状态（不清会串到下一条用例）
    snapHub.resetDedupState();         // ★leg73：快照那两个闸（原先是直接写 sw2SnapLast / sw2SnapLastWorldFp）
}

// ---------- ★leg33d：插件总闸（用户令「加一个启动和关闭插件的入口，要不然这个插件会直接自动生效」）----------
// 设计口径三条，都要能机械核：
//   ① **总闸只管"自动"**：关掉之后——发消息不自动推进、切聊天不自动载入世界。**手动永不被闸**：
//      观棋窗口照常打开、面板照常渲染、「推进一轮」照常能按（那是你明确要求的动作）。
//   ② **缺省关**（`params.js` 的 `SWITCH_PARAMS.autoAdvance.def = '0'`）——照本仓开关惯例
//      （**缺键=关、只有显式 '1' 算开**，见 `switchOn`）⇒ "装上/载入即静默"，正对用户原话。
//   ③ ★**但存量世界要给一次性迁移**：真账实测——用户现存世界里那个键**早就被写过 '1'**（他正在用它）；
//      若升级后因为"缺键=关"就悄悄停掉，等于把正在跑的世界按停——那是事故，不是功能。
//      （★原文这里举的例子是 `memoryEnabled` 那一格，而它 leg125 已随那条通道删除；本条口径不依赖是哪个键。）
//      故：**该世界已有推进史（`meta.simLog` 非空）且开关键从未写过** ⇒ 迁成 '1'（= 维持"升级前后一字不变"）；
//      **全新世界（无史）一律 '0'** ⇒ 新世界要你按一下「开始」才动。
//      ★幂等：迁移只写"键不存在"的世界；你手动关掉会把 '0' 写进账，此后**永不再迁移**（尊重显式选择）。
const AUTO_ADVANCE_KEY = 'autoAdvance';

// ★★★leg162：外壳动作条右端那格状态——实现与来路住 `web/status-bar.js`；本处只留**注入**。
const syncActionbar = (world) => syncActionbarImpl(world, {
    liveEnvOf: () => paramApi.sw2CollectLiveParamValues(),   // 页面上控件此刻的值（最高顺位，照 leg48）
    envOf: (w) => paramApi.displayEnv(w || null),            // 参数真源那个唯一裁决处
    onOf: (w) => { const hot = w || readHotMeta()?.world || null; return hot ? autoAdvanceOn(hot) : null; },
});

/**
 * ★leg33d：**每收到一条消息**时的总闸判据（从 `setupAsyncTicks` 里提出来，为的是能真跑测试）。
 * 口径（三条，都能机械核）：
 *   · 开（显式 '1'）⇒ 调 `advance()` —— 这就是"插件自动生效"的那一下。
 *   · 关（缺键/'0'/空）⇒ **一次都不推进**，只 `setStatus` **明说**（否则"世界怎么不动了"会被当成 bug）。
 *   · 手动路径**不经过这里**（面板「推进一轮」走 `dispatchAction('advance-world')`）⇒ **永不被闸**。
 * @returns {{advanced:boolean, reason?:string}} 便于测试与调用方留痕（不靠副作用判断）
 */
export function sw2OnMessageReceived(hotWorld, { advance, setStatus: status } = {}) {
    if (!autoAdvanceOn(hotWorld)) {
        if (typeof status === 'function') {
            // ★leg103：指路改「设置页」（leg52 已把「推进一轮」从参数页撤走）；同句另三处在 `:2083`/`:2478`/`render.js:580`。
            // ★★★leg162：那枚按钮**又搬了一次家**——从设置页底部升进**窗口外壳的动作条**（八页常驻）
            //   ⇒ 四处指路同批改成「**窗口顶部**」。leg103 那条纪律一字未改（指路必须指向按钮真正所在）。
            status('⏸ 插件已关（发消息不自动推进）· 参数页「插件总闸」可开 · 或按窗口顶部的「推进一轮」手动推');
        }
        return { advanced: false, reason: 'autoAdvance=off' };
    }
    if (typeof advance === 'function') advance();
    return { advanced: true };
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★★leg46：**参数全生命周期收进 `src/param-hub.js`，本文件只留接线**（用户令「重构代码吧，我已经没有耐心了」）。
// 这一格的性质（为什么是"推倒"而不是"再补一层"）：
//   "改档位 → 刷新回默认"从 leg26 到 leg45 被修了**七轮**，判据 662→693 全绿而实机一次都没好。
//   七轮全在**症状附近**改代码（三态返回 / 回读核对 / 抢回 / 延后重试 / 本地兜底 / 覆盖层 /
//   就地同步控件 / 撤销栈），而真形状是：**同一个数有五个写入口、三份存储、两套"值从哪来"的规则**，
//   而且每次调用各自 `worldNameOf(world ?? sw2LastWorld ?? readHotMeta()?.world)` **现算一次世界名**
//   ⇒ 读用一个桶、写用另一个桶，**不报错、不抛异常，只是静默写到别处**（本仓"一个数两把尺子"）。
//
// ⇒ 现在本文件里**没有**任何"读写参数存储"的代码了（三样东西一起没了）：
//   ① 桶读写（`sw2ParamBucket` / `sw2WriteParamBucket` / `sw2ParamEnv` / `sw2PersistParamEnv`）；
//   ② 管辖键与镜像（`sw2ManagedParamKeys` / `sw2MirrorParamsToAccount`）；
//   ③ 撤销栈的装配与 `paramUndo` 的 write 回调。
//   取而代之的是**一个对象 + 三个入口**：`hub.set(world, key, value)` · `hub.commit(world)` · `hub.undo(world)`。
//   ★纪律（判据 `test/param-hub.test.js` ⑨ 用源码扫描锁死）：
//     本文件**不许**再出现 `localStorage.setItem(` 或 `extensionSettings[...PARAMS_...]` 的赋值——
//     参数只有一个写入口，其余全是它的下游。

/** 读 ST 的插件配置区（拿不到就返回 null —— 绝不抛，面板其余部分照常工作）。 */
function sw2ExtensionSettings() {
    try {
        const ctx = freshCtx();
        const s = ctx?.extensionSettings;
        return s && typeof s === 'object' ? s : null;
    } catch (_) { return null; }
}

function sw2WriteLocalBucketRaw(bucket) {
    try {
        const ls = sw2LocalStore();
        if (!ls) return false;
        ls.setItem(PARAMS_LS_KEY, JSON.stringify(bucket));
        return true;
    } catch (err) {
        console.warn('[story-world-v2] 并入服务端参数失败（不影响参数本体）', String(err?.message || err));
        return false;
    }
}

/** 主路存储（**惰性取**：载入后才可用；拿不到就 null —— hub 会如实报"只能退回插件配置区"）。 */
function sw2LocalStore() {
    try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; } catch (_) { return null; }
}

// ★★★leg82：**`paramHub` 的装配已随参数族搬进 `web/param-panel.js`**。
/* ★★★leg82 留档：这一格**原来**的形状（照本仓"注释里可以留档"那条纪律原样存一份）。
 * 它现在是新家 `createParamApi({...})` 的内部装配，本文件一个字都不再经手：
const paramHub = createParamHub({
    storage: () => sw2LocalStore(),
    settings: () => sw2ExtensionSettings(),
    saveSettings: () => { try { freshCtx()?.saveSettingsDebounced?.(); } catch (_) {} },
    log: (line) => console.info(`[story-world-v2] ${line}`),
});
 * ★全部依赖照旧**注入**（存储 / 插件配置 / 让 ST 存配置）⇒ 新模块在 Node 里能真跑（判据就是那么跑的）。
 * ★`saveSettings` 照旧只是**尽力而为**：ST 的配置保存通道已被实机证伪（`settings.json` 的 mtime 停在
 *   载入那一刻，且它自己 `saveSettings()` 里有一道 `settingsReady` 闸会**静默不写**）
 *   ⇒ 它成功与否**不参与**"玩家的值存住了没有"这个判断（"别把数据寄托在别人的通道上"那条教训）。
 * ★★本文件从此**不再持有参数族的任何一格状态**（撤销栈 · 写格留痕 · 忙闩 · 最近世界全在新家）——
 *   状态劈两半就是本仓最贵的病（两份真相）。
 */

/**
 * ★★★leg78：**热账 hub**（账本怎么写 / 怎么落盘 / 被覆盖了怎么抢回来，全在 `web/hot-ledger.js`）。
 *   三样依赖**注入**（这正是新模块能"零 import"当叶子的原因）：
 *     ① `freshCtx` —— 每次现取 ST 上下文（v1 教训：chatMetadata 引用会随聊天切换过期）；
 *     ② `hotMetaKey` —— 热账住在 chatMetadata 的哪一格；
 *     ③ `getSnapHub` —— ★**迟到注入**（取值函数，不是现成对象）：`writeHotMeta` 末尾要调
 *        `snapHub.requestSnapshot()`，而快照 hub 只能**在本 hub 之后**才建（它要的 `readHotMeta`/
 *        `flushHotMeta` 现在住热账新家）⇒ 构造时抓死会拿到 `undefined`，调用点当场 `TypeError`。
 *   ★**次序铁律**：本 hub 必须**先于** `snapHub` 建（`test/web-hot-ledger-layout.test.js` ⑥ 有顺序自证）。
 */
const hotHub = createHotLedgerHub({
    freshCtx,
    hotMetaKey: HOT_META_KEY,
    getSnapHub: () => snapHub,      // ★取值函数：调用那一刻才解析（那时快照 hub 已经建好了）
});
// ★leg78：读 / 写 / 落盘三个口**解构**取回 ⇒ 全文件那些调用点（27/15/10 处）**一字未改**
//   （搬迁不是重写；这也是判据 ⑤ 咬的"受控通道"形状）。
const { readHotMeta, writeHotMeta, flushHotMeta } = hotHub;
// ★`sw2ExplicitChatName` 单独一行取（判据要的那一行是**逐字**的三口解构，不许夹第四个名字）。
const { sw2ExplicitChatName } = hotHub;
// ★leg112（C1）：换书检测那一族在这里注入依赖。★位置必须在热账三口解构之后（第一版放 `longTask` 下面 ⇒ 动态导入当场炸 `Cannot access 'readHotMeta'…`）——建 hub 的位置由依赖决定，不是由"看着顺眼"决定。
injectBookRebaseline({
    checkCurrentBook, currentBookFingerprint, getCtx: () => getCtx(), hot: { readHotMeta, loadHotAccount, writeHotMeta, hotAccountShape, flushHotMeta },
    ui: { refreshWorld, refreshSections, setStatus }, longTask, LONG_TASK_LABELS, action: REBASELINE_ACTION });

/**
 * ★★★leg73：**快照 hub**（快照那一族全在 `web/snapshot-store.js`）。
 *   十样依赖注入：7 个接线层函数 + 3 个取数口（`getLastWorld`/`setLastWorld`/`getListedVolumes`）。
 *   ★注意那三个**取数口是函数而不是现成值**：`sw2LastWorld` / `LISTED_VOLUMES` 都会被反复重新赋值
 *     ⇒ 抓死当下那个值 = 快照永远按"开局那一刻的世界/卷表"拍（本仓 TDZ/时序坑的同款）。
 *   ★依赖里那三个热账口（`readHotMeta`/`flushHotMeta`/`sw2WriteHotMetaEnsuringParams`）来自上面那个 hub。
 */
// ★★三个取数口必须是**函数声明**（提升 + 调用时才求值），**不许**写成箭头：
//   箭头会在**建 hub 那一刻**求值，而 `sw2LastWorld` / `LISTED_VOLUMES` 声明在本段更后面
//   ⇒ 初始化期当场 `ReferenceError`（leg72 §3-A 量出来的坑，判据 ④ 有反向自证）。
/** 取：链视图入口持的那份世界（★现取，不缓存：它会被反复重新赋值）。 */
function getLastWorld() {
    return sw2LastWorld;
}
/** 放：把世界写回链视图入口（快照恢复之后必须让面板读到**新的**那份）。 */
function setLastWorld(w) {
    sw2LastWorld = w;
}
/** 取：卷表（★现取：`LISTED_VOLUMES` 每次载入都会重新赋值，抓死就是旧表）。 */
function getListedVolumes() {
    return LISTED_VOLUMES;
}

/**
 * ★★★leg82：**参数族的受控口**（真定义全在 `web/param-panel.js`；本文件只留接线）。
 *   五样依赖**注入**（这正是新模块能"零 import 接线层"当叶子的原因）：
 *     ① `freshCtx`              每次现取 ST 上下文（v1 教训：chatMetadata 引用会随聊天切换过期）；
 *     ② `sw2ExtensionSettings`  每次现取插件配置区（备份那份）；
 *     ③ `sw2LocalStore`         每次现取主路存储；
 *     ④ `getLastWorld`          ★**函数声明，不是箭头**（本仓 leg72 §3-A 那条 TDZ 铁律）；
 *     ⑤ `refreshSections`       ★本文件的组合器（局部重绘）——**必须真的注入**（判据 ⑨）。
 *   ★★★为什么 `getLastWorld` 必须是**函数**、且必须"调用时才求值"：`sw2LastWorld` 声明在本段
 *     **更后面**，而且会被反复重新赋值（十几处）。箭头 `() => sw2LastWorld` 看着像函数，但它与
 *     "直接传值"在**建工厂那一刻**求值是同一条路；本文件这里用的是**函数声明** `getLastWorld`
 *     （函数声明提升 + 调用时才求值）⇒ 建工厂时拿到的是一个**已经初始化好**的函数对象，
 *     读的是**调用那一刻**的 `sw2LastWorld`。（判据 ②-a/②-b 逐条咬这件事：传成值必须当场
 *     `TypeError`、每次调用必须现取。）
 *   ★★`refreshSections` 也在这里注入：`param-panel.js` **不许**反向 import 本文件（那会成环）
 *     ⇒ 只有"注入一个函数"这一条路。不给它 ⇒ 撤销之后画面不重画（判据 ⑨ 咬的就是"它是不是
 *     真的被叫到了"——被 `try` 吞掉的失败不算成功）。
 *     ★它同样是**函数声明**（见下面 `function refreshSections(names)`）⇒ 与 `getLastWorld` 同款：
 *       函数声明会提升，所以"建工厂那一刻传进去"拿到的是**函数本体**，不是 `undefined`。
 *   ★次序（本仓铁律）：`hotHub` → `snapHub` → `paramApi`。本族要 `getLastWorld`，
 *     所以它必须建在 `getLastWorld` **声明之后**（就是这一格）。
 */
const paramApi = createParamApi({
    freshCtx,
    sw2ExtensionSettings,
    sw2LocalStore,
    getLastWorld,          // ★函数声明：调用时才求值（写成箭头 = 建工厂那一刻求值 ⇒ TDZ 当场炸）
    refreshSections,       // ★接线层的组合器：撤销之后让面板重画（不注入 ⇒ 那一句退化成 no-op）
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★leg82：**门面（受控口的同名转发）——`web/index.js` 的导出面一个字都不许变**
//   ★为什么必须有这一段（本仓 leg80 取书族的先例：**旧家仍是门面**）：这几个名字是
//     **既有消费者与判据钩子**按名字取的（`test/param-hub.test.js` 直接 `const { gatherParamEvidence,
//     paramEvidenceText } = mod`；`set-param-persist.test.js` 取 `sw2ParamDiag`/`sw2UndoParam`）⇒
//     搬家时"消费者 import 零改动"靠的就是这里。**去掉这一段，那些判据当场 `TypeError: not a function`**
//     （实测：`mod.gatherParamEvidence is not a function` ×5、`mod.sw2SetParamCell` ×1、
//      `mod.sw2CollectLiveParamValues` ×2）。
//   ★★口径：这里是**转发**，不是"第二份实现"——一行调用，零逻辑。判据咬的"本文件不许再定义那一族"
//     咬的是**实现**（正则：`^(?:export\s+)?(?:function|const|let|var)\s+<名字>` 后面**紧跟函数体**那种）；
//     而"导出面不变"是**另一条**既有契约（上面那些测试按名字取口）。
//   ★★为什么不写成 **re-export**（`export {...}` 后面直接跟 from 那种写法）：本仓明令**不搞 re-export**
//     （leg71 立、leg72/leg73 的 `reExports()` 判据在扫那种形状 —— "它到底住哪"不许再变模糊）。
//     写成 `export const` 门面则同时满足两条：**归属清楚**（真定义只有一处）+ **取口不变**。
//   ★注意本段注释里**不要**出现那种形状的字面量：`reExports()` 那把尺子**不剥注释** ⇒
//     注释里写一个就当场被当成 re-export（本棒实测踩到过，留档）。
// ═══════════════════════════════════════════════════════════════════════════════════════════════
/** ★leg82 门面：自证面（"用户不开控制台"时的唯一读数）——真定义在 `web/param-panel.js`。 */
export const gatherParamEvidence = () => paramApi.gatherParamEvidence();
/** ★leg82 门面：把自证读数拼成一段可直接粘贴的文本（真定义在 `web/param-panel.js`）。 */
export const paramEvidenceText = (ev = null) => paramApi.paramEvidenceText(ev);
/** ★leg82 门面：自证面三读数（世界名 / 真源 / 账上镜像）——真定义在 `web/param-panel.js`。 */
export const sw2ParamDiag = () => paramApi.sw2ParamDiag();
/** ★leg82 门面：按撤销（退的是**玩家的档位**，世界已经发生的事不回退）——真定义在 `web/param-panel.js`。 */
export const sw2UndoParam = () => paramApi.sw2UndoParam();
/** ★leg82 门面：采集页面上现存参数控件的值——真定义在 `web/param-panel.js`。 */
export const sw2CollectLiveParamValues = () => paramApi.sw2CollectLiveParamValues();
/** ★leg82 门面：写参数格（只看同一行那个控件自己的值）——真定义在 `web/param-panel.js`。 */
export const sw2SetParamCell = (key) => paramApi.sw2SetParamCell(key);

const snapHub = createSnapshotHub({
    freshCtx,
    setStatus,
    refreshWorld,
    loadHotAccount,
    readHotMeta,
    sw2WriteHotMetaEnsuringParams: (meta, world = null) => paramApi.sw2WriteHotMetaEnsuringParams(meta, world),
    flushHotMeta,
    // ★★★leg85：`hotAccountShape` 以前**漏注入** ⇒ `restoreSnapshot` 里那句是裸引用 ⇒
    //   恢复快照整条路一调就 `ReferenceError`（被 catch 吞成一行"恢复失败"）。
    //   现在补上；`createSnapshotHub` 那边会**当场校验**它是函数（缺了就在建 hub 那一刻响，
    //   不再等到玩家点下去）。
    hotAccountShape,
    getLastWorld,
    setLastWorld,
    getListedVolumes,
    captureMemoryHistory: async w => embedRuntime?.captureHistory(w, await loadLedgerVolumes(freshCtx()?.chatId, w)),
    restoreMemoryHistory: async (w, history) => { memoryWiring?.invalidate(); sw2Injector?.clearVectors?.(); await embedRuntime?.restoreHistory(w, history); },
});

// ★★★leg140：**实体观览窗口**的装配（用户令「点击实体就会出现…」）。
//   ★`getWorld` 必须是**函数**且**调用时才求值**（`sw2LastWorld` 声明在本段更后面、且会被反复重新赋值
//     ——传成值就是"第二份真相"，与 `getLastWorld` 那条留档同一个理由）。
//   ★窗口挂在 `document.body` 上（不在面板窗口里）⇒ 面板开着关着都能看；`z-index` 压得住面板。
const simulationProtection = createSimulationProtectionHub({
    getWorld: () => readHotMeta()?.world || sw2LastWorld,
    getScope: () => chatScope(freshCtx()), isBusy: () => Boolean(sw2TickQueue?.busy),
    saveWorld: (world, guard) => hotHub.commitHotMeta(hotAccountShape(world), { guard }),
    refresh: world => refreshWorld(world), setStatus,
});
const entityWindow = createEntityWindowHub({
    getWorld: () => sw2LastWorld || readHotMeta()?.world || null,
    getScope: () => chatScope(freshCtx()),
    setStatus,
    setSimulationBlocked: (id, blocked, expected) => simulationProtection.set(id, blocked, expected),
});

// ★★★leg82：**自证面 / 撤销 / 写账补镜像**三块已随参数族搬进 `web/param-panel.js`。
//   ★留档点名（判据 ③ 的反向自证要求这些名字在本文件里仍能搜到——**搜到的是这段留档**）：
//   · 自证面（"用户不开控制台"时的唯一读数）：`export function gatherParamEvidence()` /
//     `export function paramEvidenceText(ev)` —— 现在走 `paramApi.gatherParamEvidence()` /
//     `paramApi.paramEvidenceText()`（新家自己 `import { readHotMeta, writeHotMeta } from './hot-ledger.js'`）。
//   · 「hub 最近一次算过参数的世界」那一格内部状态：它现在是**新家的内部状态**，
//     本文件读写它一律走 `paramApi.lastWorld()` / `paramApi.setLastWorld(w)`（一个家）。
/* ★★★leg82 留档：这一格**原来**的定义（照本仓"注释里可以留档"那条纪律原样存一份）：
let sw2HubLastWorld = null;
 */
//   · 撤销：`export function sw2UndoParam()`，以及 `function sw2WriteHotMetaEnsuringParams(meta, world)`
//     （★它现在的接线形状是 `paramApi.sw2WriteHotMetaEnsuringParams(...)`，见快照 hub 的注入面那一行）。
//   ★本文件仍要够得到的两口（外部消费者与判据钩子按名字取）：
//     `sw2ParamUndoState`（下面那一行转发给受控口）与 `paramApi.sw2WriteHotMetaEnsuringParams`。
/** 外部（面板）读撤销态。 */
export const sw2ParamUndoState = () => paramApi.sw2ParamUndoState();
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

/** 落盘结果 → 状态条那半句（**只有三种话，且只有一种带 ⚠**）。 */export function flushOutcomeText(r) {
    if (r?.ok && !r.queued) return ' · 已落盘';
    if (r?.ok && r.queued) return ' · 已改（另一次保存还在飞，已排队补落盘）';
    // ★★leg78：这一格原先**直接读热账的私有状态** `sw2FlushTimeoutMs`（跨块读状态 ⇒ 搬走后当场
//   `ReferenceError`，本棒当场踩到过）⇒ 定稿走**受控口** `hotHub.flushTimeoutMs()`。
    const why = r?.reason === 'timeout' ? `超过 ${Math.round(hotHub.flushTimeoutMs() / 1000)} 秒未返回`
        : r?.reason === 'no-ctx' ? '拿不到聊天上下文'
            : r?.reason === 'no-save-chat' ? '这一版 ST 没有可用的保存入口'
                // ★leg40c 续·五：ST 的保存**静默跳过**了（回得太快 / 文件名取不到就 return）
                : r?.reason === 'skipped' ? 'ST 的保存通道没真写（回得太快，疑似静默跳过）'
                    // ★leg40c 续·二 / 续·六：账本被**别的副本**覆盖了（下一个 tick 拿旧世界回写是主要来路）
                    : r?.reason === 'replaced' ? `账本被别的副本覆盖了（试了 ${SW2_FLUSH_TRIES} 次没抢回来）`
                        : '保存报错';
    return ` · 注意：这次没能确认落盘（${why}${r?.detail ? ` —— 宿主原话：${r.detail}` : ''}）`;   // ★★★leg197：`detail` = **宿主报的那句原话**（TT 是原生应用、手机更没有控制台 ⇒ 不印出来，这个错就永远只能靠猜）
}

function volumeStore() {
    const ctx = freshCtx();
    const chatId = ctx?.chatId || 'default';
    return createIdbVolumeStore(String(chatId));
}

// K36：轮次队列（setupAsyncTicks 装一次；dispatchAction 的手动补推要用它）
let sw2TickQueue = null;

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★leg79/leg81（丙-web · **第四格**）：**视图态族已整族搬进 `web/view-state.js`**——本族的**八个状态**
//   **只住新模块**，本文件**一个字都不许再直接读写**（本仓最贵的病是"两份真相"）。
//   ★★本族特有的坑（别改成抓死）：**视图对象必须现取**——`viewState.chronicle()` / `viewState.entities()`。
//     为什么：消费点是对**对象内字段**的就地写（`view.layer = v` / `view.filters.push(v)` / `view.page += 1`），
//     而 `reset()` 会**换掉模块级绑定** ⇒ 谁把对象抓进变量，复位之后那些就地写就落到**被丢弃的旧对象**上
//     （面板看起来"点了没反应"，且**不抛错、不报警**）。
//   ★★本族**零注入形参**（它谁也不调；★说书页那一格同理：归一住 `src/panorama.js`）⇒ `createViewStateHub()` 无 deps。
const viewState = createViewStateHub();

// ---------- K34/K36：会话态（模块级 · 面板零第二份状态） ----------
let sw2LastSettings = null;
let sw2PrevChronicle = null;      // 上一渲染的编年行数（第十三棒：进展计数用）
// ★★★leg79/leg81（丙-web · **第四格**）：**编年页视图态整族已搬进 `web/view-state.js`**。
//   原先这里住着 `sw2ChronicleView` / `sw2ChronicleViewReset` / `sw2ChronicleComposing` 三样，
//   而 `sw2LastWorld` / `sw2SnapshotCache` / `sw2LastPicks` **正夹在它中间**（不是连续块）
//   ⇒ 本棒按"四处抽取"只取视图态那几处，那三样**一个字不动**（它们不属于视图态语义）。
//   ★够到那一族一律走**受控口** `viewState`（见下面建 hub 那一段）：视图对象**现取**，
//     绝不许抓进变量（复位会换绑，抓死 = 就地写落到被丢弃的旧对象上 = "点了没反应"且不报错）。
let sw2LastWorld = null;          // K41：链视图入口持引用（同一对象，零第二份状态）
// ★leg73：`sw2SnapshotCache` 已随快照族搬进 `web/snapshot-store.js`（状态只许有一个家）；
//   面板要那份清单 ⇒ 走受控口 `snapHub.readSnapshotCache()`（见下面 `renderCfg` 与复位那段）。
let sw2LastPicks = null;          // 细案 §3：上一轮"上场实体"名单（选人调用失败时退回它，再退兜底名单）
// ★★★leg89：**标签读数的会话级自证面**（`{tagReadout, tagFacts}`）——不落账、不入卷，
//   只活在内存里（与 `sw2LastPicks` 同性质）：它是"这一轮正文长什么样"的读数，不是世界状态。
//   ★为什么不像 `picks` 那样写进世界：世界步没有"标签"这一格（`worldStepSchema` 顶层 `additional:false`），
//     硬塞进去要么炸校验、要么变成一条**永远不会被清理的过期货**（leg34 那次"过期检索冒充新检索"的同款病）。
let sw2LastTagFacts = null;
/** ★leg89：注入器（`setupAsyncTicks` 里装配；装配前为 null ⇒ 注入面整体不存在 = 与今天逐字节相同）。 */
let sw2Injector = null;
/** 注入开关的人话名（状态条与那一卡共用；★玩家可见文本，零引擎术语）。★leg143：那一卡现住**参数页**。 */
const INJECT_SWITCH_LABEL = { injectTagSpec: '让聊天模型按标签写行动', injectRoster: '把名号表递进对话',
    injectWorldTide: '把上轮世界动向递进对话', injectLedgerRecall: '把账上往事递进对话',};
// ★★★leg115：**第四段（账上往事）默认开**——另外三个"缺省=关"是当年**有意**定的，不许顺手翻过来
//   （用户立的要求是「聊天llm**不知道**什么时候世界发生了什么事」⇒ 默认关就等于白做）；口径：**从没设过才算开**。
// ★★★leg200b（用户令「**不写就不剥得了，你还非搞个这个按钮干嘛**」）：**「剥掉正文里的机器块」那枚开关已撤**——
//   正文剥块只由玩家那两份名单说了算（不填＝不剥）；旧设置里那个键成无主键（无读者）⇒ 旧账无害、不迁移。
function injectSwitchOn(key) {
    if (key === 'injectLedgerRecall') return String(modelSettings()?.[key] ?? '1') === '1';
    return String(modelSettings()?.[key] ?? '') === '1';   // 其余三个：**只有显式 '1' 算开**（全仓同口径）
}
// Stable identities and committed history share one manual/automatic entry.
const consumptionHub = createMessageConsumptionHub({ getCtx: freshCtx,
    getWorld: () => loadHotAccount(readHotMeta()), getQueue: () => sw2TickQueue, onStatus: setStatus });
export function sw2ConsumptionReadout() { return consumptionHub.readout(); }
export function sw2LatestMessageText(ctx) { return latestAssistantText(ctx); }
// Legacy helper; the live entry uses persisted message identities.
export function sw2ShouldAdvance(mes, lastMes) {
    if (!mes) return { go: true, reason: 'no-dialogue' };
    return mes === lastMes ? { go: false, reason: 'same-message' } : { go: true };
}
export function sw2AdvanceOnce(options = {}) { return consumptionHub.advance(options); }

// ★★★leg79/leg81：**实体页视图态整族也已搬进 `web/view-state.js`**
//   （`sw2EntsView` / `SW2_ENTS_KINDS` / `SW2_ENTS_FILTERS` / `sw2EntsViewReset` / `sw2EntsComposing`）。
//   ★两张筛选词表随状态同住一处（判据咬：词表只许在新家定义）；够到它们走 `viewState.*` 受控口。

function modelSettings() {
    const ctx = freshCtx();
    const raw = ctx?.extensionSettings?.['story_world_v2'] ?? null;
    return raw && typeof raw === 'object' ? raw : null;
}

// ★★★leg144（用户真机反馈原话：「**每个人使用的网关不同支持的并发度上限不同**」）：
//   **开局读整本书时同时发几个请求**——设置页「模型通道」那张卡里那一格（`data-settings="extractConcurrency"`）。
//   ★为什么提成一个函数（而不是三处各写一遍 `modelSettings()?.extractConcurrency ?? …`）：
//     三处（名册遍＋设定遍 · 起根 · 只重抽设定）必须**读同一个数**——写三遍就是三份真相，
//     而"同一件事两处口径"正是本仓最贵的病。**一把尺子，三处调用。**
//   ★缺省回 `EXTRACT_CONCURRENCY`（出厂值，唯一真源在 `src/abstract.js`）；没填过/填坏了 ⇒ 走缺省，**不猜**。
function extractConcurrency() {
    const n = modelSettings()?.extractConcurrency;
    return Number.isInteger(n) && n >= 1 ? n : EXTRACT_CONCURRENCY;
}

function readSettings() {
    const ctx = freshCtx();
    if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object' && !ctx.extensionSettings['story_world_v2']) {
        ctx.extensionSettings['story_world_v2'] = {};
    }
    return ctx?.extensionSettings?.['story_world_v2'] ?? null;
}

function writeSetting(key, value) {
    const ctx = freshCtx();
    const s = readSettings();
    if (!s) return;
    s[key] = value;
    if (key.startsWith('embed')) { sw2Injector?.clearVectors?.(); memoryWiring?.settingsChanged(); }
    try { ctx?.saveSettingsDebounced?.(); } catch (_) {}
}

// ★★★leg87：`playerDesc: 'sw2_player_desc'` **已删**——那张「你的开档描述」卡连同这段绑定一起撤
//   （依据：那段字写进 `meta.playerDesc` 后全仓零处读，见 `src/render.js` 设置页那段留档）。
// ★★★leg87：单轮超时/输出上限两个框**改走 `data-settings`，不再写在这张按 id 找键的表里**。
//   为什么另立一条路：这两个键的值**必须是数字**（`createHttpTransport` 拿它当毫秒/整数用），
//   而这条老路的 `writeSetting(key, e.target.value)` 会把 `'120'` 这样的**字符串**原样写进设置
//   ⇒ 引擎侧 `setTimeout(…, '120000')` 靠隐式转换侥幸能跑，"空框/中文/负数"则静默变成 NaN。
//   ⇒ 口径：**声明在 markup 上（`data-settings="键名"`），校验在唯一一处**（下面 onField 里那段）。
// ★★★leg142：`SETTINGS_INPUTS` / `SETTINGS_NUM_RANGE` / `SETTINGS_NUM_LABEL` / `sw2NormalizeNumericSetting`
//   这一族**整族已搬进 `web/model-channel.js`**（理由见那个文件头：本文件只剩 1 行，而"获取模型列表 /
//   测试连通"两个新功能本来就属于这一族 ⇒ 搬出去正好落在同一个家里，不是随手挪一个不相干的东西）。
//   ★本文件仍从那里取 `SETTINGS_INPUTS`（`refreshSettingsHints` 要用），见上面的 import。

function nextPlayerId(entities = []) {
    let max = 0;
    for (const e of entities) {
        const m = /^e_p(\d+)$/.exec(String(e?.id || ''));
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `e_p${max + 1}`;
}

// ★leg33c（用户拍板「位置变成自由文本，位置集干脆删了」）：**位置集从"闸"降级为"参照表"**，
//   并且**不再截断**。两件事分开说，别混：
//   ① 降级：`check-step.js` 的位置段不再拒整步（集外只留痕）、`settle.js` 的 spawnEntities 集外照收。
//      依据：位置线的定案本来是"只做呈现、不做机制"（START-HERE §1），而白名单却一直在当硬闸；
//      实测 8 本真实世界书里只有 3 本有干净地名表（`demo/audit-mechanism-genericity.js` 机制②），
//      其余 4 本退化成 `['未明']` ⇒ 闸在那些书上近乎失效。⇒ 参照表留给模型/面板/位置继承用，
//      但**不再决定"模型配不配写这个地名"**。
//   ② 不截断：**`POSITIONS_CAP` 已作废**（原来是 60，按书序截断防巨书灌爆输入）。真账实测截掉的代价：
//      canon 有 **134** 个地点条目，被切到 59 ⇒ 模型写书里真有的 `太清境`/`万魔殿`/`落英谷` 反被拒整步。
//      参照表已实测极轻（134 项 ≈ 600 字符 ≈ **180 est**），且**不参与 trimPack 裁剪** ⇒ 省钱的理由不成立。
//   ⚠保留 `cap` 形参只为兼容既有调用点（传 0/负 = 不截断）；生产路径不再传它。
export const POSITIONS_CAP = Infinity;   // ★已作废（留常量名防旧调用点炸）；见上 ②
export function derivePositions(setting, { fallback = '未明', cap = POSITIONS_CAP } = {}) {
    const book = setting?.frozen?.canon?.bookEntities || [];
    const seen = [];
    const push = (v) => {
        const s = String(v || '').trim();
        if (!s || seen.includes(s)) return;
        seen.push(s);
    };
    for (const b of book) {
        if (b?.location) { push(b.location); continue; }
        if (b?.kind === 'location') {
            push(b.name);
        }
    }
    for (const place of setting?.frozen?.canon?.geography?.places || []) push(place.name);
    // cap 缺省 = Infinity ⇒ 全收；显式传有限值才截断（既有用例自设上限时仍可测）
    const room = Number.isFinite(cap) ? Math.max(0, cap - 1) : seen.length;
    return [fallback, ...seen.filter((s) => s !== fallback).slice(0, room)];
}

export function attachPlayerPiece(world, playerName) {
    const nm = String(playerName || '').trim();
    const entities = world.entities || [];
    const existing = nm ? entities.find((e) => e.name === nm) : null;
    if (existing) {
        world.context = { ...(world.context || {}), playerId: existing.id };
        return { created: false, reused: true, playerId: existing.id, name: existing.name };
    }
    const id = nextPlayerId(entities);
    const ent = {
        id,
        kind: 'character',
        name: nm || '你',
        location: (world.context?.positions || [])[0] || '未明',
        lastActiveTick: 0,   // 头几轮不静默（与 spawnEntities 同口径——否则棋子一开始就被静默门滤掉）
    };
    world.entities = [...entities, ent];
    world.context = { ...(world.context || {}), playerId: id };
    return { created: true, reused: false, playerId: id, name: ent.name };
}

export function namePlayerPiece(world, parsedName) {
    const nm = String(parsedName || '').trim();
    const pid = world.context?.playerId;
    if (!nm || !pid) return { renamed: false };
    const others = (world.entities || []).find((e) => e.name === nm && e.id !== pid);
    if (others) {
        world.context = { ...world.context, playerId: others.id };
        world.entities = world.entities.filter((e) => e.id !== pid);   // 同名他人 ⇒ 合并，空棋子不留
        return { renamed: true, mergedInto: others.id, name: others.name };
    }
    world.entities = world.entities.map((e) => (e.id === pid ? { ...e, name: nm } : e));
    return { renamed: true, name: nm };
}

// ★★★leg148：**"把宏做的你并回棋子"那一族已整族搬进 `web/world-entity-migration.js`**
//   （理由：本文件有 3100 行硬锁，机制代码加进来就顶破 ⇒ 照本仓做法**搬一族出去，不抬锁**）。
//   接线层只负责接上：下面载入期那一步调 `normalizeMacroEntities`。病灶与新家口径 ⇒ 那个文件头。

// ---------- ★leg40b（I-1）：**覆盖现存世界的守门**（用户点单修；这条会真丢用户数据）----------
// ★★★leg103：这一族文案与归一**已整族搬进 `web/world-replace.js`**（含本段全部留档：两种标准、
//   顺序之病、那条假承诺的查实与治法等）——接线层只负责**问与动手**。导出面原样保持：
//   `worldToBeReplaced` / `initWorldOverwriteNotice` 仍从本模块 re-export（判据与外部调用方零改动）。

// ★★★leg80（丙-web · 第五格）：**取书族已整族搬进 `web/book-source.js`**——
//   卡读取（`characterWorldNames` / `characterBookEntries`）· ST ctx 取书（`collectWorldInfoEntries(ctx, character)` /
//   `pickCharacter(ctx)`）· 取书缓存（私有 `sw2BookCache` + `resetBookCache()`）· 三个消费者口 ·
//   名号定位三档（`locateNameLine` / `locateNameSnippet` / `bookEntryText`，纯字符串函数）+ 私有 `escapeRegExp`。
//   ★依赖方向单向（叶子）：本文件 → `web/book-source.js` → `../src/init-source.js`。
//   ★留档（这一族为什么值得单独成家）：旧法里 `lookupOneEntity` 调的是**全仓从未定义**的
//     `bookEntriesCached()`（真名是 `worldBookCached`）⇒ 点面板行的「查/重查」当场 `ReferenceError`；
//     位置继承那三条路也因此断了两条（`bookEntries` 压根没送进收口）⇒ 用户真账 563 实体的
//     `location` 全是占位值「未明」。这些口现在只有新家一处实现，接线层只负责**把书递进去**。
export async function autoComposeSource() {
    const ctx = getCtx();
    const session = JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId]);
    const character = await ensureCharacterLoaded(ctx);   // ★leg154：懒加载卡（ST 的 performance.lazyLoadCharacters）先要全卡——不问就会报「四件套全空」而书其实在卡上
    const owner = bookContextIdentity(ctx);
    const { entries: worldInfoEntries, worldSources } = await collectWorldInfoEntries(ctx, character);
    if (session !== JSON.stringify([getCtx()?.chatId, getCtx()?.characterId, getCtx()?.groupId]) || owner !== bookContextIdentity(getCtx())) return { ok: false, reason: '聊天或来源已切换，请重新读取', text: '', sourceItems: [], effectiveEntries: [], worldInfoEntries: [] };
    const res = composeInitSource({ character, worldInfoEntries, worldSources, macroNames: macroNamesFromCtx(() => ctx, character), selection: abstractSelectionFor(ctx) });
    res.sourceDiag = { // 诊断附加元数据（非契约字段，仅控制台消费）
        identity: { characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null, chatId: ctx?.chatId ?? null },
        character: { name: character?.name ?? null, world: character?.world ?? null, hasBook: Boolean(character?.character_book || character?.data?.character_book) },
        worldSources, excluded: res.excluded || [], warnings: res.warnings || [],
    };
    if (!res.ok) {
        try {
            console.warn('[story-world-v2] 初始化设定源失败诊断', {
                ctxKeys: ctx ? Object.keys(ctx).slice(0, 40) : null,
                sourceDiag: res.sourceDiag,
                worldInfoType: ctx?.worldInfo ? (Array.isArray(ctx.worldInfo) ? 'array' : typeof ctx.worldInfo) : null,
                reason: res.reason,
            });
        } catch (_) {}
    }
    // 第二十五棒 e：把**真书条目**随源一起交出去——名册落账那一步（seedBookEntities）的零 token 兜底
    //   （成员行反推归属 / 紧贴名号的档位标签 / 势力规模原话）**必须读正文**，而 canon 名册条目只是名号表。
    //   这里已经收过一次条目，顺手带出，免得为了拿正文再收一遍（同一份数据取两次＝两次真实取书）。
    res.worldInfoEntries = res.effectiveEntries;
    return res;
}

// 抽取调用诊断包装（第十八棒）：transport 返回裸字符串（transport-http 契约）或 {text} 对象都吃——
// K38 抽取接线曾只取 `.text`（真实 transport 返回字符串 → 恒空 →「抽取输出为空」实为接线雷，
// 合成演练从未真跑所以未炸；worldstep.js L12 同款双形取法早已存在）。空/非 JSON 响应现场上控制台。

// 初始化诊断（leg27 起：抽取每段的真实字符数/耗时都在这里现身——用户"看不到日志"那一刀）
function logInitDiagnostics(ctx, src, extractOut) {
    try {
        const char = pickCharacter(ctx);
        const charBook = (char?.character_book || char?.data?.character_book) || null;
        const bookEntries = charBook ? (Array.isArray(charBook.entries) ? charBook.entries : (charBook.entries && typeof charBook.entries === 'object' ? Object.values(charBook.entries) : null)) : null;
        const wi = ctx?.worldInfo;
        const wiShape = Array.isArray(wi) ? 'array' : (wi && typeof wi === 'object') ? 'object' : typeof wi;
        const wiEntries = Array.isArray(wi) ? wi : (wi && typeof wi === 'object' && Array.isArray(wi.entries) ? wi.entries : null);
        const pieces = ['description', 'scenario', 'personality', 'first_mes'].filter((k) => typeof char?.[k] === 'string' && char[k].trim());
        const canon = extractOut?.setting?.frozen?.canon;
        console.info('[story-world-v2] 初始化诊断', {
            identity: { characterId: ctx?.characterId ?? null, groupId: ctx?.groupId ?? null, chatId: ctx?.chatId ?? null },
            character: {
                name: char?.name ?? null,
                world: char?.world ?? null, // 卡上的世界信息名（ST 卡字段）
                pieces: pieces.length ? pieces : null,
                book: charBook ? { at: char.character_book ? 'character_book' : 'data.character_book', entries: bookEntries ? bookEntries.length : null } : '（无卡内置书）',
            },
            worldInfo: {
                shape: wiShape,
                entries: wiEntries ? wiEntries.length : null,
                keys: wi && typeof wi === 'object' && !Array.isArray(wi) ? Object.keys(wi).slice(0, 20) : null,
                preview: wiEntries ? wiEntries.slice(0, 2).map((e) => `${String(e.key ?? e.name ?? e.uid ?? '?')}: ${String(e.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}`) : null,
                mounted: src?.sourceDiag?.worldSources ?? null, // 具名挂载：哪些书读到了/几条（防"书没挂上"被当"书里没有"）
            },
            source: { ok: src?.ok, label: src?.label, usedChars: src?.usedChars, entryCount: src?.entryCount, pieceCount: src?.pieceCount, truncated: src?.truncated, excluded: src?.excluded || [], warnings: src?.warnings || [], preview: src?.text ? src.text.replace(/\s+/g, ' ').slice(0, 120) : null },
            extract: extractOut ? { ok: extractOut.ok, cached: extractOut.cached, fingerprint: extractOut.fingerprint, errors: extractOut.errors || [], canonSize: canon ? { powerScale: canon.powerScale?.length ?? 0, factions: canon.factions?.length ?? 0, bookEntities: canon.bookEntities?.length ?? 0 } : null } : null,
        });
    } catch (_) {}
}

function refreshSettingsHints() {
    const s = modelSettings() || {};
    const el = document.getElementById(SETTINGS_INPUTS.apiKey);
    if (el) el.placeholder = s.apiKey ? '（已保存 · 留空=不改）' : '（本机读取，不打印）';
}

/**
 * ★★★leg89：**注入开关的写通道**（用户令：开三个开关控制"插件要不要动你的对话"）。
 *
 * ★★为什么它**不是** `onField` 里的一格（本笔踩过，留档）：
 *   第一版把判据挂在 `bindSettingsForm` 的 `input`/`change` 委托上（`data-settings-bool`）——
 *   **按钮点击根本不派发 `input`/`change`** ⇒ 处理器一次都跑不到，玩家看到的是"点了没反应、
 *   状态栏一个字都没有"。而本仓**所有按钮走的是 `click` 委托 + `data-action` + 动作总线**
 *   （`bindActions` → `dispatchAction`）——它接的是 `click`，所以那条路才通。
 *   ⇒ 定稿：这个开关走**与其它按钮同一条路**（`data-action="inject-toggle"`），
 *     并且判据提成**这个导出函数**（本仓铁律：要真 ctx 的接线，要么提成可导出函数真跑，
 *     要么写注入 fake 的测试 —— 这样它**能在 Node 里被真测**，不再是"只有人手点才知道"）。
 *
 * 做四件事，顺序固定（每一步的**理由**都写死在这儿）：
 *   ① 写盘（`extension_settings.story_world_v2`，与地址/密钥/数字键同一条路）；
 *   ② 立刻重设注入（开了却要等一轮才生效 ⇒ 玩家会以为没开）；
 *   ③ **重画设置页**——"开/关"那个字与按钮高亮**只活在渲染产物里**（数字框不靠重绘，开关靠）
 *      ⇒ 不重画就是"点了没反应"（这是本笔第二个坑）；
 *   ④ 状态条**报真数**（注入口取不到时如实说跳过，不许假装成功）。
 * @returns {{ok:boolean, on:boolean, line:string}} 便于判据与调用方留痕（不靠副作用判断）
 */
export function sw2ToggleInject(key, on) {
    if (!key) return { ok: false, on: false, line: '没有开关名' };
    const want = Boolean(on);
    writeSetting(key, want ? '1' : '0');
    let rowMissed = false;   // ★leg108（B3）：那一格有没有真的在眼前更新（见下面那段）
    let res = null;
    try {
        res = sw2Injector?.apply() || null;
        // ★★★（2026-10-05）这里原来还存一份 `runs` 副本（"注入跑过 N 次…"那一行读它）——
        //   那一行已按用户令撤掉（"这是用来调试的"）⇒ 副本一并删；参数页那一行读数改问
        //   `sw2Injector._facts()`（**现取，不留第二份真相**）。★`res.line` 那一份副本同批删
        //   （参数页那句原始读数也撤了——"那句我让你抽出重点的话也删了，毕竟已经抽出来了"）。
    } catch (err) {
        console.warn('[story-world-v2] 切换注入开关后重设失败（不影响别的事）:', err?.message || err);
    }
    try {
        // ★★★leg89（用户实机四次：「点了不切，点别处才切」）——**不再重画整页**。
        //   原来这里调 `refreshSections(['settings'])`（整页 innerHTML 换掉），它要穿过本仓两道护栏
        //   （`playerIsTouchingParams` 的押后判据 + `sw2SectionRefreshRunning` 的防重入），
        //   任何一道不合我意，画面就晚一拍——而玩家看到的正是"点了不切、点别处才切"。
        //   ⇒ 定稿：**只改这一处控件自己的 DOM**（三行里那一行：那个"开/关"字 + 两枚按钮的高亮）。
        //     它不换整页 ⇒ 不经过任何押后/防重入判据，也**不夺焦点**（玩家点的那枚按钮原地不动）。
        //   ★为什么不这么做就会一直错：`refreshWorld` 里本来就有一处"整页刷新"会顺带把设置页画对
        //     （带着新一轮的读数）——所以"点别处才切"说明**另有东西把它画对了**，而我这处只是白等。
        //   ★失败零阻塞：找不到那个节点就什么都不做（开关本身早就写盘了）。
        const onText = want ? '开' : '关';
        const rows = document.querySelectorAll(`[data-inject-switch="${key}"]`);
        for (const row of rows) {
            const box = row.closest('.sw2-actions-inline');
            const label = box?.querySelector('.sw2-param-val');
            if (label) label.textContent = onText;
            for (const b of box?.querySelectorAll?.('[data-inject-switch]') || []) {
                const isOnBtn = String(b.getAttribute('data-value') ?? '') === '1';
                b.classList.toggle('sw2-primary', isOnBtn === want);
            }
        }
        // ★★leg108（B3）：**一个节点都没找到 ⇒ 不许不吭声**（旧行为静默跳过 ⇒ 控件还印着旧状态，
        //   而状态条在说另一件事 = 同一刻两处说两件事）。两条来路：这一格此刻不在 DOM 里 ·
        //   选择器与标记对不上（后者会**永远**静默失效、还不抛错）。
        rowMissed = rows.length === 0;
    } catch (err) {
        console.warn('[story-world-v2] 注入开关原地改字失败（开关本身已生效）:', err?.message || err);
    }
    const label = INJECT_SWITCH_LABEL[key] || key;
    // ★leg108（B3）：控件没更新成 ⇒ 状态条自己说出来（否则"控件说旧的、状态条说新的"）
    //   ★★★leg143：指路从**设置页改成参数页**——那一卡随用户令搬去了参数页
    //     （「设置里的那些闸其实也可以归到参数页」）⇒ 这句提示必须跟着搬，否则它指的地方没有那一格。
    const miss = rowMissed ? '（注意：这一格没在眼前更新——切走再切回参数页就是新状态）' : '';
    if (!want) {
        const line = `已关闭 · ${label}（世界账没动）`;
        setStatus(line + miss);
        return { ok: true, on: false, line };
    }
    if (res?.ok) {
        const line = `已打开 · ${label} → 已注入 ${res.tagsChars + res.worldChars} 字（立刻生效）`;
        setStatus(line + miss);
        return { ok: true, on: true, line };
    }
    const line = `注意：${res?.line || '注入口取不到'}——开关记下了，但这一段这一轮没注入`;
    setStatus(line + miss);
    return { ok: false, on: true, line };
}

// ★★★leg142：`bindSettingsForm`（设置表单的写通道：`set-param` 委托 / 三个按 id 找键的框 /
//   `data-settings` 数字键 / `<select>` 滚轮守卫）**整段已搬进 `web/model-channel.js`**。
//   搬的理由与那一族的来路（leg26/40c/87/89 踩过的坑）都跟着搬过去了，一个字没丢。
//   本文件只在装配处调 `modelChannel.bindSettingsForm()`。

// ★★★leg80：取书缓存 + 三个消费者口（原始条目 / 书正文 / 按名号三档文本）也**只住新家**了。
//   ★本族真正的承重墙（留档，别改回去）：**三态语义**——`{ ok: true, entries: [] }` = 书读到了但
//     书里真没有（另一态）；`{ ok: false }` = **书没读到**（取书炸了/一本都没取到）⇒ 调用方**不写任何痕迹**。
//     旧法失败时 `return []`，与"书里没有"同形 ⇒ 引擎把"读不到书"记成「书未明述」并把该栏**永久锁死**
//     （实测代价：用户真账 563 实体、`location` 占位值「未明」563——面板整列「未载」）。
//   ★留档（leg25 f 那三条断头，全在原地接线层，正是这一族搬家的理由）：
//     ① `lookupOneEntity` 调 `bookEntriesCached()`——**该函数全仓从未定义**（真名 `worldBookCached`）⇒
//        点面板行的「查/重查」当场 `ReferenceError`；
//     ② `advanceTick` 的 preStep 与批量补全**压根没传 `bookEntries`** ⇒ `runBatchLookup` 里
//        `bookEntries == null` ⇒ 位置继承原样返回世界 ⇒ 推断跑 0 次；
//     ③ 全量测试没有任何一条把 `bookEntries` 喂给这两个收口 ⇒ "接线断了而测试全绿"。
//   ★零参那一口的契约**一个字没改**：`bookEntriesForInherit()` 仍然零参，内部走**注入进来的** `getCtx()`；
//     其余的口一律收 ctx 形参（谁调谁给）——两种形状并存是故意的，判据咬这一条。

// ★★★leg76 收尾（本次补齐）：**全册批量补全整族已撤**——撤掉的是这三格（每轮搭车的任务态）
//   加后面那四格（`batchStatusText`/`startBatchTask`/`runBatchChunk`/`planBatchesLazy`），
//   以及两处总线动作与 `renderCfg` 里的 `lookupTask`。撤的依据（leg76 §1）：方向本身是错的——
//   它真会问的那批实体里**十个有九个是「势力」**，而提示词**明令势力不抽实力** ⇒ 那一栏对它们永远补不上。
//   ★边界：**行内那枚「查」是好的，保留**（`lookup-entity`/`lookupOneEntity` 一个字未动）。

// 渲染 config（渲染层不持状态：任务/快照/记忆自证一律由本层注入）
// ★★★leg142：模型通道 hub 的**模块级把手**（装配处赋值）。为什么不是局部 const：
//   `renderCfg()` 是模块级的函数声明，而装配发生在另一个函数体里 ⇒ 要让它俩互相看得见，
//   只能有一个模块级的把手（与 `sw2LastWorld` / `paramApi` 同一形状，本仓既有做法）。
let modelChannel = null;
let embedChannel = null, embedRuntime = null, memoryWiring = null;
const panelTools = createPanelTools({ getCtx: freshCtx, getWorld: () => sw2LastWorld, getSettings: modelSettings, writeSetting, getRuntime: () => embedRuntime, getInjector: () => sw2Injector, onVectorChange: () => memoryWiring?.settingsChanged(), getConsumptionReadout: sw2ConsumptionReadout, build: PANEL_BUILD });

function renderCfg(extra = {}) {
    // ★★leg46：把**参数真源**与**撤销态**注入渲染层（渲染层不持状态，照本仓既有纪律）：
    //   `paramEnv` ⇒ 面板画的是**真源**（不是滞后一拍的世界账镜像）；
    //   ★★而"真源里没有这个键时该显示什么"（出厂默认）**只由 `hub.displayEnv` 一处裁决**——
    //     leg41 的"四个下拉全空白"就是因为同步逻辑另写了一套"没有就是空"（同一语义两处实现 ⇒ 迟早分叉）。
    //   `paramUndo` ⇒ 撤销按钮的自证面（可退几步）。
    //   ★世界对象用**面板正在渲染的那一份**（`sw2LastWorld`）现取：桶键必须与它同源。
    //   ★★★leg82：但**桶键优先取"hub 真正读写过的那个桶"**（受控口 `currentWorldName()`）——
    //     这就是 leg48 那条"**读的桶 = 写的桶**"（被违反过九轮，正是"改了档位、刷新回默认"的机理）：
    //     `loadWorld` 走空态/轮转失败时交给面板的是**空态世界**（世界名 = 未名世界），
    //     按它去读会读到**另一个空桶** ⇒ 面板按出厂默认画一遍，把玩家选的值从画面上盖掉。
    //     ⇒ 与"控件按真源对齐"那一处同一口径（那边本来就是 `currentWorldName()` 优先）。
    const w = paramApi.currentWorldName() || sw2LastWorld || readHotMeta()?.world || null;
    return {
        ...(modelSettings() || {}),
        ...panelTools.config(),
        // ★★★leg142：「模型通道」那两格的**渲染态**（模型清单 ＋ 连通结论）住在 hub 里，由这里摊进 config；
        // ★★★leg172：**记忆通道那一格清单（`embedCatalog`）也走这里**（两条通道各持一份、互不覆盖）——不摊进来 ⇒ 整页重画会吞掉刚取到的清单。
        ...((modelChannel?.renderState?.()) || {}), ...((embedChannel?.renderState?.()) || {}),
        // ★★★leg161：「记忆通道（向量）」那张卡的**三格现值 ＋ 一行读数**。
        //   ★三格从设置现读（`readEmbedConfig` 是唯一真源，认不出的格一律留空——**绝不替玩家编地址**）；
        //   ★那一行读数由 hub 拼（`embedReadoutLine`：没配 / 还没嵌过 / 欠多少 / 上轮失败，四态分得开）。
        embedBaseUrl: readEmbedConfig(modelSettings() || {}).baseUrl,
        embedApiKey: readEmbedConfig(modelSettings() || {}).apiKey,
        embedModel: readEmbedConfig(modelSettings() || {}).model,
        embedLine: (() => { try { return embedChannel?.line?.() || ''; } catch (_) { return ''; } })(),
        // ★★★leg161：**检索参数那几格的现值**（没填过 ⇒ 渲染层退回出厂值，出厂值住 `src/limits.js`）。
        //   ★它们与上面那三格不同：那三格是"通道配置"，这几格是"怎么取、取多少"。
        //   ★★★（2026-10-05）：多一格 `retrievalMaxChars`（「往事注入多少字」）——它是**整段的字数上限**
        //     （此前写死 1600），字面路与向量路两路合起来都吃它。
        retrievalMinScore: Number.isFinite(Number((modelSettings() || {}).retrievalMinScore)) ? Number((modelSettings() || {}).retrievalMinScore) : undefined,
        retrievalTop: Number.isFinite(Number((modelSettings() || {}).retrievalTop)) ? Number((modelSettings() || {}).retrievalTop) : undefined,
        retrievalDepth: Number.isFinite(Number((modelSettings() || {}).retrievalDepth)) ? Number((modelSettings() || {}).retrievalDepth) : undefined,
        retrievalMaxChars: Number.isFinite(Number((modelSettings() || {}).retrievalMaxChars)) ? Number((modelSettings() || {}).retrievalMaxChars) : undefined,
        // ★★★（2026-10-05 · 用户令「**把图片的第一段话中的关键信息抽取出来展示在参数页**」＋
        //   「**第二段话可以删了，这是用来调试的**」）：参数页那一行读数走 `injectReadoutHtml`
        //   （措辞住 `web/inject-readout.js`；数据直接问注入器 `_facts()`——**本层不再存第二份**，
        //     `web/index.js` 的 3100 行硬锁逼的）。★`vectorOn` ＝ 向量通道（设置页「记忆通道」）——
        //   它就是"往事走向量还是走关键词"的那个对齐开关（用户 2026-10-05 拍板：只做自动对齐）。
        injectReadout: injectReadoutHtml({ facts: sw2Injector?._facts?.() || null, vectorOn: embedChannel?.enabled?.() === true, rosterOn: injectSwitchOn('injectRoster') }),
        snapshots: snapHub.readSnapshotCache(),
        paramEnv: paramApi.displayEnv(w),
        paramUndo: sw2ParamUndoState(),
        // ★★leg46 续：自检卡要的读数（世界名/桶键 · 真源 · 引擎镜像 · 主路能不能写）——
        //   渲染层不持状态，一律由本层注入（照本仓既有纪律）。
        paramDiag: paramApi.gatherParamEvidence(),
        // ★★★leg55（leg54 §6.4）：**面板上印出来的数字必须现算**——旧卷卡那行「自动入卷阈值」原本
        //   靠 `?? '500'` / `?? '5'` 兜底，`renderCfg()` 从不注入这两键 ⇒ "读 config"是死路，
        //   印出来的其实是渲染层抄的一份字面量（正是 leg54 那个 4096 的同一种病）。
        //   ⇒ 从真源现读：这两值就是 `planChronicleRotation` 本笔在上面走的那条缺省（同一份常量）。
        limitsTicks: PROPOSED_LIMITS.ticks,
        limitsBytesMB: PROPOSED_LIMITS.bytes / 1024 / 1024,
        // ★★★leg87（用户令「改也改不了是死的不会根据模型变化」）：单轮超时/输出上限**现读设置**。
        //   没填过 ⇒ 出厂值（`PROPOSED_CALL_LIMITS`，与引擎真正吃的那个数同源）；
        //   填过 ⇒ 印你填的（这两个框从此是**控件**，不再是"印一行常量"的展示品）。
        callTimeoutSec: (modelSettings() || {}).callTimeoutSec ?? Math.round(PROPOSED_CALL_LIMITS.timeoutMs / 1000),
        callMaxTokens: (modelSettings() || {}).callMaxTokens ?? PROPOSED_CALL_LIMITS.maxTokens,
        // ★★★leg144：那个新框**印什么**——走 `extractConcurrency()`（同一个读数口，与真跑读的是同一个数）
        extractConcurrency: extractConcurrency(),
        // ★★★leg89：「与聊天模型的接线」卡要的三个读数——**全部现读真源**（面板不持状态、不抄字面量）：
        //   · `injectSwitches` 四个开关的**当前态**（真源 = `extension_settings.story_world_v2`）；
        //   · `tagMaxActions` 那个数字框的值（没填过 ⇒ 出厂 12，与引擎缺省同一个数）。
        //   ★★★（2026-10-05 · 用户第二道令）：「**把那句我让你抽出重点的话也删了，毕竟已经抽出来了**」
        //     ⇒ 这里原来还有一格 `injectLine`（`标签注入：…` 那一整句）**整格撤掉**：
        //     它的关键信息已经抽成参数页那一行小格（`web/inject-readout.js`），
        //     而它的尾巴（`position=` / "插件只注入这几段"）本来就是给排查用的。
        //     ★`tagReadoutLine` 那一份**仍在**（`src/tick.js` 的落账读数用它，那是另一件事：标签抽到了几条）。
        injectSwitches: {
            injectTagSpec: injectSwitchOn('injectTagSpec'), injectRoster: injectSwitchOn('injectRoster'),
            injectWorldTide: injectSwitchOn('injectWorldTide'), injectLedgerRecall: injectSwitchOn('injectLedgerRecall'),
        },
        tagMaxActions: (modelSettings() || {}).tagMaxActions ?? 12,
        proseLists: proseStripLists({ settings: modelSettings() }),
        // ★★★（2026-10-05 · 用户令「**第二段话可以删了，这是用来调试的**」）：这里原来还画着
        //   「注入跑过 N 次 · 最后一次 …」／「注入器还没跑过（…若一直这样，把这条发我）」那一行——
        //   **整条撤掉**（它是排查话术，不是给玩家的读数）。⇒ `sw2LastInjectRuns` 这个副本也一并删了：
        //   它的数据源改由 `injector._facts()` 现取（参数页那一行读数读它）。
        bookCheck: bookCheckResult(),   // ★leg112（C1）：换书检测读数（`null` = 无从判断 ⇒ 设定页一个字都不画）
        ...extra,
    };
}

// 局部重绘（★leg27 后：`set-param` 原走整页重绘 ⇒ 销毁正在展开的 `<select>` ⇒ 列表自己关）。
// 纪律：只换受影响页签的 innerHTML；失败只上控制台（局部重绘失败不该打断落账那条路）。
// ★★leg40c 续（用户实机「只是展开下拉就弹一句，点了还是改不了值」）：
//   押后逻辑的**定义**已提到 `refreshWorld` 之前（见那一段注释：放这里就是 TDZ 当场炸）。

// ★★★leg82：**采集控件现值**那一块已随参数族搬进 `web/param-panel.js`
//   （留档：`export function sw2CollectLiveParamValues()`；上面 `refreshWorld` 里那处调用点
//    改走 `paramApi.sw2CollectLiveParamValues()`，返回形状 `{ env, selects }` 一字未变）。
//   ★它为什么必须存在（原样留档，别丢）：渲染整页之前先把页面上现存控件的值收起来当**最高优先级
//    覆盖**——否则"真源里还没落成"的那一刻，渲染层会按出厂默认画格，而控件上还留着玩家选的值
//    （用户第四次实机那张"下拉是 9/12/30/40、四格却写 3默认/6默认/15默认/20默认"）。
//    ★两条边界同样搬走了：空串**不覆盖**（＝玩家清成未定，让真源/默认说话）；控件值**不许盖住真源**。

// ★★★leg82：**面板 DOM 镜像**那一整段（写格留痕 · 写格 · 找控件 · 取值 · 对齐控件 · 同步格）
//   已随参数族搬进 `web/param-panel.js`（本文件里**不再有它们的定义**）。
/* ★★★leg82 留档：这几格的**原来**形状（照本仓"注释里可以留档"那条纪律原样存一份）：
const sw2CellWriteLog = [];
export function sw2SetParamCell(key) { ... }
function sw2ParamControlOf(win, key) { ... }
function sw2ControlText(ctl) { ... }
export function sw2SetParamControl(key) { ... }
export function sw2SyncParamCells() { ... }
 */
//   ★★本文件里**仍然会出现这些名字**——但它们只出现在受控口的**调用点**里
//     （`paramApi.sw2SetParamCell(k)` / `paramApi.sw2SyncParamCells()` 这种形状），**不是定义**。
//     判据咬的正是这条区别：状态与实现只能有一个家，调用点可以有很多处。
//   ★"格与控件永不分叉"那条承重墙随族搬走（判据 ⑯ 仍咬它，只是现在咬的是新家）：
//     格子的字**只看同一行那个控件自己的值**；控件按真源对齐；两者由**新家那一个入口**收口
//     （它遍历页面上所有 `[data-param-cell]`，逐个按本行控件对齐）。

function refreshSections(names) {
    if (typeof document === 'undefined') return;
    sw2SectionRefreshRunning = true;
    try {
        const win = document.getElementById(WINDOW_ID);
        if (!win || !sw2LastWorld) return;
        const out = renderAll(sw2LastWorld, { config: renderCfg(), oldVolumes: LISTED_VOLUMES, view: viewState.views() });
        for (const name of names || []) {
            const el = win.querySelector(`#sw2_view_${name}`);
            if (!el) continue;
            // ★玩家正在这一页上下拉/点按钮 ⇒ 这一页押后（否则等于把他的手从控件上打掉）
            if (paramApi.playerIsTouchingParams() && el.contains(document.activeElement)) {
                pendingSectionRefresh.add(name);
                console.info(`[story-world-v2] ${name} 页上有控件正被操作 —— 本次重绘押后（避免销毁正在展开的下拉）`);
                continue;
            }
            const keep = captureScrollPositions(el);   // ★leg104（C2）：局部重绘同理——先记后放（见并页那处的口径）
            if (name === 'panorama') {
                el.innerHTML = mergedMainHtml(out);   // ★leg97 并页：四层 ＋ 观棋那几块（唯一一处组合）
            } else if (typeof out[name] === 'string') {
                el.innerHTML = out[name];
            }
            bindPageSubtabs(win).sync(); panelTools.bind(win); if (name === 'setting') bindSettingReader(win).sync(); if (name === 'panorama') bindPanoramaReader(win).sync(freshCtx()?.chatId, keep); else restoreScrollPositions(el, keep);
        }
    } catch (err) {
        console.warn('[story-world-v2] 局部重绘失败（不影响落账）', String(err?.message || err));
    } finally {
        // ★重绘**自己**会换掉 DOM（被换掉的控件若正持焦点，浏览器会派发 focusout）
        //   ⇒ 不在这里清掉标志，"补上押后的重绘"就会自己咬自己（实测会多跑一轮空刷新）。
        sw2SectionRefreshRunning = false;
    }
}

// ---------- leg27：抽取进度（用户「十多分钟了还是没抽好，我也看不到日志」那一刀） ----------
// 进度文案：按**真实已花时间**算（旧法用"已完成段之和" ⇒ 正在跑的那段不在里面 ⇒ 恒显 0 秒 = 用户说的「读秒没变」）
function extractionProgressText(events, elapsedMs) {
    const fin = (events || []).filter((e) => e && e.phase === 'finish');
    const done = fin.filter((e) => e.ok).length;
    const spent = Number.isFinite(elapsedMs) ? elapsedMs : fin.reduce((n, e) => n + (Number(e.ms) || 0), 0);
    const mins = Math.floor(spent / 60000);
    const secs = Math.floor((spent % 60000) / 1000);
    const cost = mins ? `${mins} 分 ${String(secs).padStart(2, '0')} 秒` : `${secs} 秒`;
    const cur = (events || []).filter((e) => e && e.phase === 'start').slice(-1)[0] || null;
    if (cur && (cur.step === 'chunk' || cur.step === 'attrs')) {
        const what = cur.step === 'chunk' ? '名册' : '属性';
        return `⏳ 抽取中 · ${what}第 ${cur.index}/${cur.count} 块（${cur.chars} 字符）· 已 ${done} 段 · 已花 ${cost}`;
    }
    return `⏳ 抽取中 · 设定（${cur ? cur.chars : '—'} 字符）· 已花 ${cost}`;
}

/**
 * 抽取进度处理器（leg27 F1/F1b）——导出以便**真测**（注入假计时器验"读秒在跳"）。
 * 心跳口径：每 `intervalMs` 按**真实已花时间**重写一次状态栏；每 `heartbeatMs` 在控制台留一行"仍在跑"
 * （"看不见在动"与"已经死了"在界面上完全同形——这是用户实机两次反馈逼出来的）。
 */
export function extractionProgressHandler(events, { setText = setStatus, intervalMs = 1000, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval, log = (m) => console.info(m), heartbeatMs = 30000 } = {}) {
    let timer = null;
    let startedAt = null;
    let lastText = null;
    let heartbeatAt = null;
    const render = (elapsedOverride, diagnostic = true) => {
        const elapsed = Number.isFinite(elapsedOverride) ? elapsedOverride : (startedAt == null ? null : now() - startedAt);
        const text = extractionProgressText(events, elapsed);
        lastText = text;
        try { setText(text, { diagnostic }); } catch (_) {}
        return text;
    };
    const tick = () => {
        try {
            render(undefined, false);
            if (heartbeatAt == null || now() - heartbeatAt >= heartbeatMs) {
                heartbeatAt = now();
                const cur = (events || []).filter((e) => e && e.phase === 'start').slice(-1)[0] || null;
                const done = (events || []).filter((e) => e && e.phase === 'finish' && e.ok).length;
                const label = cur ? (cur.step === 'canon' ? '设定与名册' : `第 ${cur.index}/${cur.count} 块（${cur.step === 'attrs' ? '属性' : '设定与名册'}）`) : '（准备中）';
                try {
                    log(`[story-world-v2] 抽取仍在跑：${label} · 已 ${done} 段 · 已花 ${Math.round((startedAt == null ? 0 : now() - startedAt) / 1000)} 秒（这一段还没返回属正常，单块是分钟级）`);
                } catch (_) {}
            }
        } catch (_) {}
    };
    const stop = () => {
        if (timer == null) return;
        try { clearTimer(timer); } catch (_) {}
        timer = null;
    };
    return {
        onEvent: (ev) => {
            try {
                const label = ev.step === 'canon' ? '设定与名册' : `第 ${ev.index}/${ev.count} 块（${ev.step === 'attrs' ? '属性' : '设定与名册'}）`;
                if (ev.phase === 'start') {
                    if (startedAt == null) {
                        startedAt = now();
                        timer = setTimer(tick, intervalMs);      // ★心跳：让"它没死"每秒都看得见
                        if (typeof timer?.unref === 'function') timer.unref();   // Node 侧别把进程吊住
                    }
                    console.info(`[story-world-v2] 抽取调用：${label} 开始（输入 ${ev.chars} 字符）`);
                    render(0);                                    // 立刻出一次（别等 1 秒）
                } else {
                    console.info(`[story-world-v2] 抽取调用：${label} ${ev.ok ? '完成' : '失败'}（${ev.chars} 字符 · ${((ev.ms || 0) / 1000).toFixed(1)}s${ev.ok ? '' : ` · ${ev.error}`}）`);
                    render();
                }
            } catch (_) { /* 进度上报绝不影响抽取 */ }
        },
        stop,
        _state: () => ({ running: timer != null, lastText }),   // 供判据观测（"读秒在跳"必须可验）
    };
}

// ---------- leg25 d：查书补全（面板行内「查/重查」；全册批量补全那一枚 leg76 已撤） ----------
// ★leg80：新家的 `bookTextForEntity(entity, ctx)` **收 ctx 形参**（本族不吃 window），而下游
//   `src/entity-lookup.js` 的注入面是**单参**的 `bookText(entity)`（`resolveBookSource` 只把实体传进去）
//   ⇒ 这一层把 ctx **现取**补上。等价于搬走之前那一版"函数内部自己调 `getCtx()`"：
//   每调一次现取一次、不抓死（抓死 = 换了聊天/卡之后还在读上一本书，静默、不报错）。
const sw2BookTextForEntity = (entity) => bookTextForEntity(entity, getCtx());

export async function lookupOneEntity(id, { forceFields = null } = {}) {
    const world = loadHotAccount(readHotMeta()) || sw2LastWorld;
    if (!world) return { ok: false, error: '还没有世界' };
    const guard = createWorldWriteGuard({ world, getWorld: () => loadHotAccount(readHotMeta()) || sw2LastWorld, getScope: () => chatScope(freshCtx()) });
    const settings = modelSettings();
    const resolved = resolveBrowserTransport(settings);
    if (!resolved) return { ok: false, error: '模型通道未配置' };
    const { entity, missing } = pickOneForLookup(world, id, { forceFields });
    if (!entity) return { ok: false, error: '账上没有这个实体' };
    // ★★★leg76 收尾（本次补齐）：这句话原先写着"用页顶的「补全全册实力」"——**那枚钮已撤**
    //   ⇒ 它就成了一条**玩家读了会去找、却找不到**的指路（leg40b 治过的"永久承诺"同款病）。
    //   改如实：全册那条腿已不在，能做的就是**在这一行上连「书未明述」一起推倒重查**。
    if (!missing.length) return { ok: false, error: '这一栏已经有原话了（要连「书未明述」一起推倒重查，用这一行的「重查」；全册批量补全的旧入口已撤）' };
    const res = await runBatchLookup({
        ssot: world, transport: diagExtract(resolved), bookText: sw2BookTextForEntity,
        ids: [id], forceFields, tick: world?.meta?.tick ?? 0,
        bookEntries: await bookEntriesForInherit(),   // ★leg25 f：这条路也必须吃位置继承（零 token 兜底）
        // ★★★Task 4：查书是**严格出处道**（默认即 strict）：每条字段要"该名号自己的来源编号 + 逐字原话"。
        //   原始凭证（编号/原话）**只进受门控的诊断面**（`diagEvidence`，`debugDetails` 为真才带原话）——
        //   不进世界账、不进快照（与抽取/起根同一条纪律）。
        onEvidence: diagEvidence,
    });
    if (!res.stats) return { ok: false, error: res.warning || '查书未成' };
    guard.prepare(res.ssot);
    await hotHub.commitHotMeta(hotAccountShape(res.ssot), { guard });
    sw2LastWorld = res.ssot;
    refreshWorld(res.ssot, { oldVolumes: LISTED_VOLUMES });
    return { ok: true, stats: res.stats, warning: res.warning, entity: res.ssot.entities.find((x) => x.id === id) };
}

// ---------- K36：每轮演化（前置步 + 主调用 + 落盘点） ----------
async function advanceTick({ world, dialogue, transaction }) {
    if (simulationProtection.busy) return { ok: false, error: '禁止模拟设置正在保存，请稍候再推进世界' };
    const settings = modelSettings();
    sw2LastSettings = settings;
    // ★★★leg87（用户令「改也改不了是死的不会根据模型变化」）：主调用那两个数**从设置现读**。
    //   缺省仍由 `createHttpTransport` 从 `PROPOSED_CALL_LIMITS` 取（一个真源，未填时行为逐字节不变）；
    //   玩家填过就吃玩家的（`sw2NormalizeNumericSetting` 已在写盘那一步挡掉非法值）。
    const limits = {
        ...(Number.isFinite(settings?.callTimeoutSec) ? { timeoutMs: settings.callTimeoutSec * 1000 } : {}),
        ...(Number.isFinite(settings?.callMaxTokens) ? { maxTokens: settings.callMaxTokens } : {}),
    };
    const resolved = resolveBrowserTransport(settings, { limits });
    if (!resolved) {
        return { ok: false, error: '模型通道未配置（设置页填写服务地址/密钥/模型）' };
    }
    const res = await runTick({
        // ★★★leg88 撤回留档：这里曾是 `extractCtx: buildExtractCtx(world)`（"从你发的话里提取落子"）——
        //   用户裁示那不是他要的提取 ⇒ 连同 `web/dialogue.js` 整族撤回。
        // ★★★leg200：`stripBlocks` 撤了（提取那一趟不再剥块——它只扫围栏里面的行）；★剥只剩**一个**消费者：检索查询串（见下 `queryTextOf`）。
        // ★★★leg119：`ledgerVolumes`（冷档里的旧编年）——不递它，轮转之后「纪事」栏会**悄悄少一半**，细案 `docs/spec-volumes-into-recall.md`。
        transport: diagExtract(resolved), ssot: world, dialogue, ledgerVolumes: ledgerVolumes(),
        // ★★★leg161（接回来）：**世界模型那一栏的召回口**——`runTick` 在 `registerDialogueFacts`
        //   之后、`buildEvolutionPack` 之前调它（顺序是机制的一部分，判据 P7 钉着）。
        //   ★没配通道 / 抛错 ⇒ 那一栏不出现，世界照常推进（`recallForTick` 自己永不抛）。
        recallVec: (o) => embedChannel?.recallForTick(o) ?? null,
        // ★★★leg89：单轮注入行动条数上限（设置页那个可填数字框；没填 ⇒ 引擎缺省）。
        tagMaxActions: Number.isFinite(settings?.tagMaxActions) ? settings.tagMaxActions : undefined,
        // 前置步：① 选本轮上场实体（LLM，≤15）→ ② 只对缺字段者查书（模型）→ ③ 引擎回写查书标记。
        // 失败零阻塞：任一步失败都退回引擎镜头，世界照常推进（细案 §4）。
        // ★★★leg76 收尾（本次补齐）：原先这里还有一段"**批量补全借轮次搭车**"（每轮 ≤BATCH_PER_TICK 批、
        //   跑完把 ssot 换成批量后的那份）——它随全册批量补全整族撤除。撤掉之后这一格**只剩前置步本身**：
        //   前置步是真在干活的那条路（不是被撤的对象），所以它一个字未动，只是不再有搭车的那一段。
        preStep: async ({ ssot: cur, move }) => {
            const pre = await runEntityLookupStep({
                ssot: cur,
                transport: diagExtract(resolved),
                bookText: sw2BookTextForEntity,
                tick: cur?.meta?.tick ?? 0,
                moveFact: move,
                // ★★★Task 4：前置步这条真在干活的路也是**严格出处道**（与面板「查/重查」同一把尺子）；
                //   凭证只进受门控的诊断面（`diagEvidence`）。
                onEvidence: diagEvidence,
                prevPicks: sw2LastPicks,
                // leg25 f：每轮前置步那条路也要吃位置继承（零 token，不占模型预算）
                bookEntries: await bookEntriesForInherit(),
            });
            // ★leg34：世界书检索注入**不在这里**——它放在 `runTick` 里（`injectWorldBookRecall`），
            //   因为那一步要读**本轮选中的 picks**（`pre.picks`），而 `runTick` 正好在 preStep 之后、
            //   出包之前拿到它 ⇒ **一处执行、顺序天生正确**，也不会重复检索。
            return pre;
        },
        // 落盘点：前置步的新字段**必须落盘**，否则 Ctrl+F5 一次就重查一遍（细案 §7）。
        onPreStep: async (pre) => {
            if (!pre?.ssot) return;
            transaction.assertCurrent();
            if (pre.picks) sw2LastPicks = pre.picks;
            if (pre.warning) console.warn('[story-world-v2] 查书前置步:', pre.warning);
            const shapeBefore = readHotMeta()?.world;
            if (shapeBefore && pre.ssot.meta?.entityFields !== shapeBefore.meta?.entityFields) {
                await hotHub.commitHotMeta(hotAccountShape(pre.ssot), { guard: transaction });
                transaction.acceptCurrent();
            }
        },
    });
    transaction.assertCurrent();
    // ★leg40b 续（死锁修复）：降级路径**单独出一行**（此前只有 panel 裁定条里那句话）。
    //   为什么单独打：这条路径的语义是"这一轮不是模型写的那一轮"——它必须**能复盘**：
    //   丢了哪几条、原始拒因是什么。（面板裁定条只截前几条，控制台留全量。）
    diagTickOutcome(res, world?.meta?.tick);
    if (res?.healed?.used) {
        console.warn('[story-world-v2] 本轮提议校验处理', {
            kind: res.ok ? '降级重试（合法提议已落账）' : '演算失败（世界未推进，可重试）',
            dropped: (res.healed.dropped || []).map((d) => `${d.family}「${d.label || d.index}」：${d.reason}`),
            errors: res.healed.errors,
            warnings: res.healed.warnings,
        });
    }
    // ★★★leg89：标签读数**每轮从头写**（没标签的轮次就把上一轮那行清掉——绝不让它冒充本轮）。
    sw2LastTagFacts = res?.tagFacts || null;
    // ★★★leg198（反馈第 2 条：**不许静默退化**）：**开关开着却没有标签** ⇒ 如实出声——那一档才是真问题
    //   （"模型没按规范写"，且它会让"正文里的事"一整轮都记不下来）；开关关着是玩家自己的选择，不刷屏。
    if (res?.tagReadout) console.info(`[story-world-v2] ${res.tagReadout}`);
    else if (res?.ok && injectSwitchOn('injectTagSpec')) setStatus('注意：这一轮正文里没有标签——正文里的事这一轮没记下来（模型没按标签规范写）');
    return res;
}

export function setupAsyncTicks(ctx) {
    if (sw2TickQueue) return;
    const es = ctx?.eventSource;
    const et = ctx?.eventTypes || ctx?.event_types;
    sw2TickQueue = createTickQueue({
        tick: advanceTick,
        load: () => loadHotAccount(readHotMeta()),
        // E2：轮转失败不再当成功——抛给队列（async-tick 的 save 失败面：报「落账失败…可重试」、
        // 不 refresh、世界原样；旧实现返回原世界被当 succeed → 界面报「已同步」而盘上什么都没写）。
        getScope: () => chatScope(freshCtx()), beforeCommit: recordConsumption,
        onOutcome: (outcome) => consumptionHub.onOutcome(outcome),
        save: async (ssot, transaction, options) => {
            const rot = await ensureChronicleRotated(ssot, transaction, false);
            if (!rot.ok) throw new Error(rot.error);
            // ★★★leg125：这里原来挂着"投给柚月の记忆"那一步（开关 `memoryEnabled`）——整条已删，见文件顶部留档。
            return hotHub.commitHotMeta(hotAccountShape(rot.hot), { guard: transaction, saveMessages: options.saveMessages });
        },
        refresh: (hot) => {
            refreshWorld(hot, { oldVolumes: LISTED_VOLUMES });            // ★★★leg89：世界推完 ⇒ **重设注入**（名册可能刚长了新人）。
            //   ★★★leg161：顺手**把聊天侧那条向量备好**（后台跑、不 await）——`apply()` 是同步的，
            //     它只能**同步读缓存**；所以向量必须在"下一次 apply"之前就位（这一轮备、下一轮用）。
            //     失败零阻塞：备不到 ⇒ 下一轮只走字面路（＝本笔之前的行为）。
            try { sw2Injector?.prefetchVectors?.(); } catch (_) { /* 加速层不许影响世界 */ }
            //   为什么在这里而不是 `MESSAGE_RECEIVED` 里：这条回调是"真落了账之后"才走到的那一格，
            //   名册此时才是最新的（在 `MESSAGE_RECEIVED` 里设会迟到一轮，等于每轮都注入上一轮的名册）。
            try {
                sw2Injector?.apply();   // ★那句原始读数（`r.line`）的副本已删——参数页改读 `_facts()`
            } catch (err) {
                // ★失败零阻塞：注入不成绝不能拦住世界推进（本仓既有口径）
                console.warn('[story-world-v2] 注入标签失败（世界照常推进）:', err?.message || err);
            }
        },
        onStatus: setStatus,
        afterTick: () => memoryWiring?.catchUp(),
    });
    // ★★★leg89：**注入器装配**。三件事按顺序说清：
    //   ① 注入什么：标签格式指令 + 名号对照（两段，可分别关；世界动向默认关——见 `web/inject.js` 头注）；
    //   ② 什么时候设：世界每推完一轮**重设一次**（`MESSAGE_RECEIVED` 之后就会走到），
    //      外加切聊天/载入世界时设一次 ⇒ 下一轮发消息时它已是最新的（`setExtensionPrompt` 会一直挂着）；
    //   ③ 拿谁设：`getWorld` **现取**（`sw2LastWorld` → 热账），与 `renderCfg` 同一口径——
    //      **不许抓死**（抓死 = 换了聊天还在给新对话注入上一个世界的名册）。
    sw2Injector = createInjector({
        getCtx: freshCtx,
        getWorld: () => sw2LastWorld || readHotMeta()?.world || null,
        isOn: injectSwitchOn,
        vectorEnabled: () => embedChannel?.enabled?.() === true,
        // ★★★（2026-10-05）参数页那三格改成**现读**：这一格是本模块唯一读设置的地方，
        //   注入器与召回口都从这里取 ⇒ 填了就生效（旧法读的是 `RETRIEVAL_PARAMS` 那个冻结常数）。
        retrievalParams: () => liveRetrievalParams(modelSettings()),
        setStatus,
        // ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」）：**聊天侧那一段也吃向量路**。
        //   查询串照 `yuzuki-Memory` 那一格的同一件事——**正文最近 N 条**（N ＝「检索上下文深度」，
        //   出厂 2，住 `web/inject.js` 的 `RETRIEVAL_PARAMS`）；料是**世界账的编年行**。
        //   ★`floor: 0` ＝ **不要窗口闸**：聊天侧与"世界模型那一栏"不同——它没有"纪事"在兜底，
        //     所以**全账都算候选**（这正是用户那句「**保证相关度最大就不用管时间了**」的落点）。
        //   ★**永不抛**：这一路是加速层，失败 ⇒ 这一轮只走字面路（＝本笔之前的行为）。
        //   ★`floor: 0` ＝ **不要窗口闸**：聊天侧没有「纪事」在兜底 ⇒ **全账都算候选**
        //     （这正是用户那句「**保证相关度最大就不用管时间了**」的落点）。
        vectorRecall: makeVectorRecall({
            getCtx: freshCtx,
            getWorld: () => sw2LastWorld || readHotMeta()?.world || null,
            getRuntime: () => embedRuntime,
            getVolumes: () => ledgerVolumes(),
            queryTextOf: (ctx, depth) => sw2RecallQueryText(ctx, 400, depth, proseStripLists({ settings: modelSettings() })),
            params: () => liveRetrievalParams(modelSettings()),
        }),
    });
    sw2Injector.apply();   // 首次装配即生效（否则"开了开关却要等一轮才注入"）
    sw2Injector.prefetchVectors?.();   // ★leg161：顺手把向量备好（下一轮 apply 时就是同步读缓存）
    es?.on?.(et.MESSAGE_RECEIVED, () => {
        // ★leg33d 总闸：关掉时**不自动推进**（但说一句，别让用户以为插件坏了或以为推过了）。
        //   闸的判据提成导出的纯函数 `sw2OnMessageReceived` —— 为的是**能真测**（本仓铁律：
        //   "要真 ctx 的接线，要么提成可导出函数真跑，要么写注入 fake ctx 的测试"）。
        sw2OnMessageReceived(loadHotAccount(readHotMeta()), {
            // ★★★leg89：**传正文**——`advanceTick` 的 `dialogue` 形参本来就是"这一轮的对话"，
            //   新口径的标签就长在里面（`runTick` 内 `extractTags(dialogue)`）。
            //   ★为什么不在里面自己读 `ctx.chat`：形参已经在、已经有测试面（`async-tick` 的 fake 注入），
            //     再开第二条读法就成了"同一个东西两把尺子"（本仓 leg46 那类病的根）。
            //   ★读不到（拿空串）就是"这一轮没有正文"——**不退回更早的消息**（那会让上一轮冒充本轮）。
            //   ★★★走 `sw2AdvanceOnce`（而不是直接 `advance(...)`）：手动路与自动路要共用
            //     "同一段正文只推一次"这把尺子，否则总闸开着时按「推进一轮」会拿同一段正文提两遍。
            advance: () => sw2AdvanceOnce(),
            setStatus,
        });
    });
    // ★★★leg48：**吞错可以，沉默不行**（见 `initPanel` 里那句注释：载入失败被空 `.catch` 吞掉，
    //   是"世界没到"这件事十二轮不可见的直接原因）。
    es?.on?.(et.CHAT_CHANGED, () => {
        sw2TickQueue?.invalidate();
        loadWorld().catch((err) => console.warn('[story-world-v2] 切聊天后载入世界失败（面板照常可用）：', err));
    });
}

// 卷清单缓存（K36 接线用；loadWorld/导入后刷新）
let LISTED_VOLUMES = [];

// 原 listOldVolumes 保持语义（K35），refreshWorld 用缓存清单
async function listOldVolumes() {
    try {
        return await volumeStore().list();
    } catch (_) {
        return [];
    }
}

// 幂等冷档轮转 + 热账写回：编年超阈值 → 前置段入卷；且**无论是否轮转都写热账**。
// （第十三棒修复：原实现只在入卷分支 writeHotMeta——无轮转路径推进后的世界从不落盘，
//  只活在内存/DOM，刷新即回滚到推进前。loadWorld 也走此入口，幂等无副作用。）
// 审计修复 E1：卷号从热账读（nextVolume，跨页面刷新延续）→ 卷库实有清单校正 →
//   写回 hotAccountShape(带新 nextVolume)，第二卷起不再覆盖第一卷。
// 审计修复 E2（执行序纪律）：**先入卷库、成功后才允许剥段写回**——volumeStore().put 抛错时
//   绝不写热账、绝不返回剥了段的世界；返回 {ok:false} 由调用方如实上报（旧实现 catch 掉异常
//   返回原世界，界面照报「已同步」= 内存改了、盘上没写、界面说成功）。
// 返回 {ok, hot, volume}：ok:false = world 原样（热账/内存一致，无静默失败面）。
async function ensureChronicleRotated(world, transaction = null, write = true) {
    transaction?.assertCurrent();
    world = rememberHotHistory(world);
    const nextVolume = nextVolumeOfHotMeta();
    const store = volumeStore();
    let volumes = [];
    try {
        volumes = await store.list();   // 卷库清单（也作卷号校正依据）
    } catch (err) {
        return { ok: false, hot: world, error: `卷库不可读：${shortErr(err)}` };
    }
    transaction?.assertCurrent();
    const plan = planChronicleRotation({ world, nextVolume, volumes });
    if (!plan.mustRotate) {
        if (write) writeHotMeta(hotAccountShape(world));   // 无轮转也写回（第十三棒语义不变）
        return { ok: true, hot: world, volume: null };
    }
    try {
        await store.put(plan.volume);   // 先落卷：只有它成功，才允许提交"剥了段"的世界
    } catch (err) {
        // 写失败 = 世界不动（热账一行不少、内存与盘上一致），如实上报给调用方
        return { ok: false, hot: world, error: `卷「${plan.volume.id}」入卷失败：${shortErr(err)}` };
    }
    // E2 执行序收口：落卷成功之后才用 applied（剥段后 + nextVolume 已 +1）覆盖热账
    transaction?.assertCurrent();
    if (write) writeHotMeta(hotAccountShape(plan.applied));
    return { ok: true, hot: plan.applied, volume: plan.volume };
}

// 热账里的下一卷号（E1：旧账无此字段 → 1；planChronicleRotation 再用卷库清单兜底校正）
function nextVolumeOfHotMeta() {
    const meta = readHotMeta();
    return Number.isInteger(meta?.nextVolume) && meta.nextVolume > 0 ? meta.nextVolume : 1;
}

function shortErr(err) {
    return String(err?.message || err || '未知错误');
}

// 世界注入入口（K36 推进后 / 导入后 / 加载热账后调用）
// 第二十五棒 e：名册落账（**可重入**）——世界加载与初始化共用同一个收口。
// 为什么需要它：这一步在 leg24 之后只搬 name/kind，而**已建好的世界是持久化的**（账停在当年那份代码上）
//   ⇒ 归属/档位/规模那块永远缺。把它做成幂等可重入、挂在世界加载上 ⇒ 老世界一刷新就自己补上。
// 安全性质（全部有测试锁）：幂等（第二次 zero 变化）、只填空栏、不新建实体（`seeded` 恒 0）、
//   零 token（纯读真书正文，不调模型）、不碰世界进度（tick/事件/盘算/编年/权重/已查字段）。
// 提成导出函数是为了**能被真测**：写在 loadWorld 里就只能测它的复制品（本仓纪律：测试不许自带被测逻辑的复制品）。
export function seedAndBackfill(hotWorld, { entries = [] } = {}) {
    const before = countLedgerEntries(hotWorld);
    // ★Task 3：种账 + 关系网 + 读数（载入补缺同样不许静默；★leg141：关系网必须跑在建实体之后、幂等）。
    const { seed, rel } = seedAndReport(hotWorld, { entries, stage: '载入补缺' });
    const seededDelta = countLedgerEntries(hotWorld) - before;
    const backfilled = (seed.fieldsAttached ?? 0) + (seed.parentVerified ?? 0) + (seed.aliasesAttached ?? 0);
    return { seed, rel, seededDelta, backfilled, changed: seed.seeded > 0 || seededDelta > 0 || backfilled > 0 || rel.seeded > 0 };
}

/**
 * ★★leg40：**从世界源起根**（把书里"正在发生的事"落成账上的线头事件）——**已搬去 `web/seed-roots-wiring.js`**。
 *
 * 为什么搬（★★★Task 4 · integration boundaries）：本文件有 `< 3100` 行硬锁
 *   （`test/web-view-state-layout.test.js`），而这一笔要给起根接上**来源身份 + 原话**（严格道）
 *   与**带行号的分块**。照本仓纪律「要往接线层加东西 ⇒ 先把一族搬出去」，这一族连同它的头注一并搬走；
 *   本文件只留**调用点**（下面初始化那一段），并从这里 import。
 */

/**
 * 位置继承（零 token 结构推断）——挂加载期，与名册落账同一份条目。
 * 提成导出是为了真测（注入真条目真跑），与 `seedAndBackfill` 同治法。
 */
export function inheritLocations(world, { entries = [] } = {}) {
    if (!Array.isArray(entries) || !entries.length) return { ssot: world, inherited: 0 };
    const d = deriveLocationFromBook({ world, entries });
    return { ssot: d.ssot, inherited: d.stats?.inherited ?? 0 };
}

export async function loadWorld() {
    memoryWiring?.invalidate(true); sw2Injector?.clearVectors?.();
    resetBookCache();   // leg25 d：取书缓存与聊天/卡绑定——每次载入世界都必须重取（否则换卡换书还吃旧缓存）
    const meta = readHotMeta();
    const world = meta ? loadHotAccount(meta) : null;
    if (!world) {
        LISTED_VOLUMES = [];
        refreshWorld(EMPTY_WORLD, { oldVolumes: [] });
        setStatus('还没有世界 · 点「开始新世界」（或「导入恢复」一份旧档）');
        return;
    }
    // ★★载入期的参数口径（三条，都能机械核）：
    //     ① 参数的**真源**在插件自己的存储里 ⇒ 载入时以它为准写进 `dynamic.env`（镜像）；
    //     ② **账上已有、真源里没有**的键（旧账 / 从前写在 env 里的档位）**一次性接纳进真源**——
    //        否则升级后玩家会看到自己的档位"消失了"（那是事故，不是升级）；
    //     ③ 从此**没有第三份**存储（leg40c 那个 `sw2_pending_params` 兜底桶已随 leg41 撤除）。
    //   ★这个顺序（放在 `ensureChronicleRotated` 之前）沿用 leg40c 的教训：参数与卷轮转无关，
    //     轮转失败不该连带让参数处理不到。
    // ★★★leg46：**载入期一次做完**（接纳账上已有的参数 + 合并进真源 + 镜像回世界账）——
    //   三件事都在 `paramHub.commit(world)` 里，一次事务、一个桶键、一份核对结果。
    //   旧版把它们摊在本文件里（各算一次世界名、各写一次存储）⇒ 这正是"读一个桶、写另一个桶"的温床。
    const adopted = paramApi.commit(world);
    paramApi.setLastWorld(world);
    // ★★★leg48：**把"世界没到那一刻"写下的档位一次补进世界账**（幂等）。
    //   为什么必须有这一步（本棒治"改了回默认"的另一半）：写入口已经和世界解耦了 ——
    //   世界对象没到 ⇒ 真源照写、引擎那一格挂起 ⇒ **必须在这里补上**，否则"面板改了、引擎按旧档跑"。
    //   顺序放在 `commit` 之后：先接纳账上已有的，再把本会话写过的补齐（两次都是幂等纯函数）。
    const flushed = paramApi.flushPending(world);
    const flushedWorld = flushed.world || null;
    const paramsAdopted = adopted.adopted;
    const paramsMirrored = adopted.mirrorChanged || flushed.changed;
    if (flushed.changed) {
        console.info('[story-world-v2] 载入期把"世界没到那一刻"写下的档位补进世界账', {
            键: flushed.keys.join('、'), 世界名: adopted.worldName,
        });
    }
    void flushed;   // ★leg48：这里只用到 `flushed.world / .changed / .keys`（末尾那次"世界成型后再补"同一口径）
    if (paramsMirrored) {
        // ★leg48：两路都算（`commit` 的接纳 + `flushPending` 的补镜像）——取"真的动过的那一份"。
        const mirroredNow = flushedWorld || adopted.world;
        world.context.setting = mirroredNow.context.setting;   // 只换 setting（世界其余部分原地不动）
        console.info('[story-world-v2] 载入期把参数真源镜像进世界账', {
            参数: Object.keys(adopted.env).join('、') || '（无）',
            接纳进真源: paramsAdopted ? '是' : '无需',
            补进了挂起的: flushed.changed ? flushed.keys.join('、') : '无',
            世界名: adopted.worldName,
        });
    }
    if (adopted.note) console.warn(`[story-world-v2] 参数：${adopted.note}`);
    const replayedPendingEnv = paramsAdopted || paramsMirrored;
    const rot = await ensureChronicleRotated(world);
    if (!rot.ok) {
        // 轮转失败 = 世界不动（内存与盘上一致），如实报错不装成功（E2 语义）
        // ★★★leg48：**这条路上也要补镜像**——它正是真浏览器现场抓到的那个形状（世界半成品 ⇒ 面板空态）。
        //   旧版这里直接 `refreshWorld` 就完了，玩家在这一刻改的档位只能等下一次载入才进世界账。
        try { paramApi.flushPending(rot.hot); } catch (_) {}
        refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
        setStatus(`注意：${rot.error}——世界原样不动（热账没写），可重试`);
        return;
    }
    const hot = rot.hot;
    const migrated0 = migrateLegacyAttrs(hot);   // leg24 片4：旧账一次性清理（幂等）
    // ★leg60：**第二处旧账清理**——把第一版写胖的 `frozen.compile`（含 189 条名号明细 + 未登记的键）
    //   在载入时收成标量摘要（幂等、不可变；无可摘则原对象返回）。与上面同一治法，同一位置。
    const migrated = slimLegacyCompile(migrated0);
    if (migrated !== migrated0) console.info('[story-world-v2] 编译读数旧账已收成标量摘要（诊断明细不再进账本）');
    // ★★★leg74（补接线）：**第三处旧账清理**——把"不算世界"的那几类（文风禁令/变量指令/其他）
    //   从法则账里摘掉（`src/settle.js` 的 `migrateStyleRulesFromCanon`，幂等 + 不可变 + 留痕）。
    //   为什么必须在**载入期**清（而不只是"下次抽取别再收"）：那些条目**早就在老账里了**，
    //   只改抽取侧 ⇒ 老账里那几类会一直躺在面板上（用户看到的正是它）。
    //   ★留档（**本笔没做，是既有待办**）：`restoreSnapshot` 目前**不跑**这处迁移 ⇒ 恢复一份
    //     leg74 之前的快照会把那三类带回来（直到下一次 `loadWorld` 才被清掉）。形态早就写明了
    //     （leg74 §3-A：让 `restoreSnapshot` 写回前调**同一个** `migrateStyleRulesFromCanon`，
    //     不是在渲染层截）——它**不属于本次三条红灯**，故此处只登记、不夹带。
    const migrated1 = migrateStyleRulesFromCanon(migrated);
    if (migrated1 !== migrated) console.info('[story-world-v2] 法则账旧账已清（文风禁令/变量指令/其他 不进世界账）');
    const hotWorld = migrated1;   // 旧账清理后的世界（下面所有落账都基于它，别把清理结果丢了）
    // 名册落账（可重入）+ 位置继承：共用同一份条目，一次落盘
    const bookEntriesForSeed = await bookEntriesForInherit();
    const { seed, seededDelta, backfilled, changed } = seedAndBackfill(hotWorld, { entries: bookEntriesForSeed });
    // leg25 f：**位置继承也挂在加载期**（零 token、幂等、只填空位）——打开面板即见效，
    //   不必等玩家推一轮或点「查」。与名册落账共用同一份条目，一次落盘。
    const loc = inheritLocations(hotWorld, { entries: bookEntriesForSeed });
    let world2 = loc.ssot;   // ★leg148：`let`——下面"并回宏实体"那一步会换一份世界（`macroSync.ssot`）
    // ★★leg32h：**玩家棋子身份每轮校准一次**（幂等、零 token、先于落盘）。
    //   为什么需要：棋子建得太早（初始化那一刻），而"主角名"可能**后来才进世界**——
    //   真实案例：主角「黄坤」在第 42 轮被模型当新实体入局，而棋子从第 1 轮就叫「你」
    //   ⇒ 世界账里两个平行的人，模型于是**一直演黄坤**（用户：「又把主角演了」）。
    //   这里在每次载入时用 ST 的人设名（`name1`）校准：**同名实体已存在 ⇒ 认领它、把空棋子并掉**
    //   （`namePlayerPiece` 的两个分支），没有则只给棋子改名。★拿不到名字就什么都不做（不猜）。
    const personaNow = (() => { try { return String(getCtx()?.name1 || '').trim(); } catch (_) { return ''; } })();
    // ★★★leg148：**先把"宏做的你"并回棋子，再校准名字**——顺序不能反（`namePlayerPiece` 按名字认领，
    //   那枚 `{{user}}` 还在就可能被认成"你"）。它只动引用、不碰名字 ⇒ 本族口径见新家文件头。
    const macroSync = normalizeMacroEntities(world2, { nameLower: personaNow || '你' });
    if (macroSync.ssot) world2 = macroSync.ssot;
    if (macroSync.merged) {
        try { console.info('[story-world-v2] 并回：账上那枚酒馆占位符做的"你"', { names: macroSync.names, merged: macroSync.merged }); } catch (_) { /* 诊断面失败不影响世界 */ }
    }
    const pieceSync = personaNow ? namePlayerPiece(world2, personaNow) : { renamed: false };
    // ★★leg40（用户拍板后的形状）：**起根只在两处发生**——
    //   ① **初始化**（`bus['init-world']`，新世界开局那一步）；
    //   ② **显式移植**（`demo/seed-roots-migrate.js`，备份 + 写后自证的一次性动作）。
    //   ★**载入期（打开面板/刷新）绝不自动起根**：那会变成"你只打开面板看一眼，它就在后台烧掉一次几十秒的抽取调用"，
    //     而这时候用户没有任何"我要种"的意图。用户原话问的就是这一格（「这个做种是初始化的时候种的？」）。
    //   ⇒ 存量世界要补根，走 ②；判据（幂等指纹 + 线头是否够用）仍由 `shouldSeedRoots` 一处说了算。
    // ★leg33d：插件总闸的一次性迁移（幂等；只对"该键从未写过"的世界动手，见 ensureAutoAdvanceKey 注释）。
    //   有推进史的存量世界 ⇒ 迁成 '1'（升级前后行为一字不变）；全新世界 ⇒ '0'（要你按一下「开始」）。
    const autoKeyAdded = ensureAutoAdvanceKey(world2);
    // ★★leg74（补接线）：这一行是本棒自查发现的那个洞的定稿——**两次清理各算各的**，
    //   不许合并成一次比较（合并会让"只改了其中一件事"漏写盘）：
    //     `migrated !== hot`  = `slimLegacyCompile`（leg60）那一次；
    //     `migrated1 !== migrated` = 法则账清旧账（leg74）这一次。
    //   少了后一项 ⇒ 只发生文风禁令清理时**不写盘**：面板是对的（内存干净），
    //   而盘上那份老账照旧带着写法规矩（导出/换机/看账都还能看到）。
    if (changed || loc.inherited > 0 || migrated !== hot || migrated1 !== migrated || pieceSync.renamed || macroSync.merged > 0 || autoKeyAdded || replayedPendingEnv) {   // 两次清理各算各的（ref 判等，幂等不空写）
        writeHotMeta(hotAccountShape(world2));   // 账本已变：内存与盘上必须一致（导出/「全册 N」读的就是这里）
        const flushed = await flushHotMeta(); // 名册入账/旧账清理不该只活在页面内存——走既有显式落盘路径
        if (!flushed.ok) { console.warn('[story-world-v2] 账本写回未落盘', { reason: flushed.reason, detail: flushed.detail, seeded: seed.seeded, seededDelta, backfilled, 位置: loc.inherited, 棋子校准: pieceSync, 补回本地档位: replayedPendingEnv }); setStatus(`注意：世界账没落盘${flushOutcomeText(flushed)}`); }   // ★★★leg197：落盘失败**也要上状态条**（原来只进控制台 ⇒ TT 实机上玩家那一屏一个字都不显示）；载入期每次都走这一笔（`ensureChronicleRotated` 无轮转也写回）⇒ 这一格就是那个症状的现身之处
        else if (backfilled > 0 || loc.inherited > 0 || pieceSync.renamed || macroSync.merged > 0 || autoKeyAdded || replayedPendingEnv) {
            console.info('[story-world-v2] 名册落账可重入：本次补齐', {
                归属: seed.parentVerified ?? 0, 字段: seed.fieldsAttached ?? 0, 弃关系: seed.parentDemoted ?? 0, 位置: loc.inherited,
                棋子校准: pieceSync,   // ★leg32h：认领/改名/并掉空棋子都要留痕（用户能看见"主角认领了没有"）
                并回宏实体: macroSync.merged ? `${macroSync.merged} 枚（${macroSync.names.join('、')}）` : '无',   // ★leg148
                插件总闸: autoKeyAdded ? `${AUTO_ADVANCE_KEY}=${world2.context.setting.dynamic.env[AUTO_ADVANCE_KEY]}（首次写入）` : '已写过，不碰',
                补回本地档位: replayedPendingEnv ? '是（上次落盘没确认，这次重落）' : '无',
            });
        }
    }
    // ★★★leg48（**解耦的另一半，用户追问"解耦了？"点出来的窟窿**）：世界**跑完了** ⇒ 立刻再补一次镜像。
    //   为什么必须在这里补（不只是开头那次 `flushPending`）：
    //     开头那次在 `commit` 之后、`ensureChronicleRotated` **之前**；如果世界对象是"载入链跑到后半段
    //     才成型"的，那一次补的是**半成品**。玩家在"世界对象还没成型"的窗口里改的档位，
    //     就会一路挂到**下一次载入**才进世界账 ⇒ 这一次会话里"面板改了、引擎按旧档跑"。
    //   ⇒ 口径：**"世界一到就补"**——载入链**每一处拿到可用世界的地方**都补一次（幂等、无变化零写）。
    const lateFlush = paramApi.flushPending(world2);
    if (lateFlush.changed) {
        writeHotMeta(hotAccountShape(lateFlush.world || world2));
        // ★日志口径与载入期开头那次**同一条**（同一件事只有一个说法，别造第二套）
        console.info('[story-world-v2] 载入期把"世界没到那一刻"写下的档位补进世界账', {
            键: lateFlush.keys.join('、'), 世界名: adopted.worldName, 时机: '世界成型后',
        });
    }
    LISTED_VOLUMES = await listOldVolumes();
    await runBookLoadCheck(world2);   // ★leg112（C1）：在世界交给面板**之前**量一次（面板渲染读它决定出不出那一行）
    refreshWorld(world2, { oldVolumes: LISTED_VOLUMES });
    snapHub.refreshSnapshots(); memoryWiring?.settingsChanged();
    // ★leg33d：关着的时候**明说**（否则"世界怎么不动了"会被当成 bug；面板照常可用）
    if (!autoAdvanceOn(world2)) {
        setStatus('⏸ 插件已关 · 自动推进不生效（发消息/切聊天都不动世界）· 参数页「插件总闸」可开 · 也可按窗口顶部的「推进一轮」手动推');
    }
}

// ---------- leg26 b：记忆投递（引擎事实 → 记忆插件）----------
// ★★★leg72（丙-web · 第一格）：**这一族已整族搬进 `web/memory-store.js`**——
//   插件适配器（连同 leg27 g 那条血泪留档：读现状那行参数**不许**传 null，否则会把用户
//   自己填的角色档案逐条抹掉）、两枚逻辑表别名、投递入口、只读自检、投递自证面与它的显示行。
//   ★本文件从此一个字都不再经手它们的实现：上面那条 import 就是唯一的取回面。
//   ★留档：记忆那一族的状态（投递自证面）与它的读法**同处一地**，本文件只走受控通道。

// ★★★leg82：**"参数操作进行中"的忙闩**已随参数族搬进 `web/param-panel.js`。
/* ★★★leg82 留档：这一格**原来**的定义（照本仓"注释里可以留档"那条纪律原样存一份）：
const sw2ParamBusy = new Map();   // 参数键 → true（正在处理这一格的一笔操作）
 */
//   为什么必须有它（原样留档）：重画会把 `<select>` 销毁重建，浏览器对**新节点**补吐一笔**带旧值**
//   的事件（`input`+`change` 各一次）⇒ **同一格一次点击进两笔，第二笔把玩家选的值覆盖回去**。
//   它只挡"同一刻的补吐事件"：玩家下一次真实点击时上一笔早已结束，所以手感上完全无感。
//   ★★本文件读写它一律走 `paramApi.paramBusy()`——交出来的是那颗 `Map` 的**本体**（不是副本）：
//     交副本 = 把状态劈两半 ⇒ 忙闩当场形同虚设（本仓最贵的病）。

// ---------- K35：真实动作总线（阅卷/导出/导入；其余按钮随 K36 接调度） ----------
// ★leg40b（A2 · 体检修）：动作总线在这里装配，而面板模板与事件委托早于它 —— 见 `dispatchAction` 的兜底。
if (typeof window !== 'undefined') {
    window.__sw2Actions = window.__sw2Actions || {};
    const bus = window.__sw2Actions;
    const mapPopup = createMapPopupHub({ getWorld: () => loadHotAccount(readHotMeta()) || sw2LastWorld, onExtract: () => bus['extract-map']?.(), setStatus });
    bus['open-map'] = () => mapPopup.open();
    const geographyHub = createGeographyHub({ getWorld: () => loadHotAccount(readHotMeta()) || sw2LastWorld,
        getIdentity: () => JSON.stringify([freshCtx()?.chatId, freshCtx()?.characterId, freshCtx()?.groupId, abstractSelectionFor(freshCtx())]),
        getSource: autoComposeSource, setStatus,
        extract: async prompt => {
            const resolved = resolveBrowserTransport(modelSettings() || {}, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
            if (!resolved) throw new Error('模型通道未配置');
            return diagExtract(resolved)(prompt);
        },
        persist: async next => { writeHotMeta(hotAccountShape(next)); sw2LastWorld = next; refreshWorld(next); return flushHotMeta(); } });
    bus['extract-map'] = () => geographyHub.backfill();
    // ★★★leg142（用户令「把获取模型列表（点击某一项自动填入模型id）和测试是否连通做一下」）：
    //   **模型通道那一族的新家** —— 设置表单写通道（原住本文件，整段搬走）＋ 两枚新按钮。
    //   ★三枚动作**都进总线**：设置页上"画了按钮就必须有人接"那条判据锁着这一页，
    //     而它的例外白名单只有 `advance-world` 一个（`test/param-hub.test.js`）——
    //     新按钮不许走"纯 DOM 属性"那条捷径（那是注入开关的定案，不是通用做法）。
    //   ★★★leg152：**装配整段搬进 `web/settings-channels.js`**（本文件有 `<3100` 行硬锁；
    //     "装配"本来也不该住在接线层）。
    //   ★leg156（用户令「稳定版不带没验过的功能」）：**记忆通道那一族整族撤走**
    //     ⇒ `web/settings-channels.js` 随之删除，模型通道那一族的装配回到本文件
    //     （这里只是装配；形状与流程照旧住 `web/model-channel.js`）。
    //   ★leg156（用户令「稳定版不带没验过的功能」）：**记忆通道那一族整族撤走** ⇒ 那时装配回到本文件。
    //   ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」）：**记忆通道接回来**，
    //     而且本笔还要多挂一条"聊天侧向量召回口"⇒ **装配整段再搬回 `web/settings-channels.js`**
    //     （本文件有 `<3100` 行硬锁；照纪律"要加东西先把一族搬出去"）。
    //     ★本文件从此只留**这一行装配**；两条通道的形状与流程各住自己的模块。
    //   ★★★leg161（用户令「**那就让聊天侧也接上向量检索呗**」）：**记忆通道接回来**。
    //     ★装配住本文件（**不许再往 `web/settings-channels.js` 搬**）：`test/model-channel.test.js`
    //       与 `test/web-view-state-layout.test.js` 两条判据锁着"接线层里必须看得见这几处注册与取用"
    //       （`'list-models': () => modelChannel.listModelsAction(),` 与 `viewState.resetChronicle()`）——
    //       搬走就是把那两条判据变成空绿。腾行数的活由 `web/window-shell.js` 那一族承担。
    modelChannel = createModelChannelHub({
        getWin: () => document.getElementById(WINDOW_ID), getSettings: () => modelSettings(), writeSetting, setStatus, readPayload, dispatch: dispatchAction,
    });
    Object.assign(bus, {
        'list-models': () => modelChannel.listModelsAction(),
        'probe-model': () => modelChannel.probeModelAction(),
        'pick-model': (payload) => modelChannel.pickModelAction(payload?.model),
    });
    const embedWiring = createEmbedWiring({
        indexStore: { load: () => createIdbVectorStore(String(freshCtx()?.chatId || 'default')).load(), save: data => createIdbVectorStore(String(freshCtx()?.chatId || 'default')).save(data), drop: () => createIdbVectorStore(String(freshCtx()?.chatId || 'default')).drop() },
        getWorld: () => sw2LastWorld, getScope: () => String(freshCtx()?.chatId || 'default'), getVolumes: () => loadLedgerVolumes(freshCtx()?.chatId, sw2LastWorld),
        getSettings: () => modelSettings(), writeSetting, getWin: () => document.getElementById(WINDOW_ID),
        getWindowTurns: () => Number(resolveLimits(sw2LastWorld || readHotMeta()?.world || null)?.往事轮数),
        onStatus: (m) => setStatus(m),
        channelDeps: { probeChannel: (cfg) => probeEmbedChannel(cfg) },
    });
    embedChannel = embedWiring.embedChannel;
    memoryWiring = embedWiring;
    embedRuntime = embedWiring.embedRuntime;
    Object.assign(bus, embedWiring.actions);

    // ★★★leg89：注入开关**改由 `bindActions` 的 click 委托直接收**（见那一处的注释与沿革）。
    //   这里原来注册的 `inject-toggle` 总线动作**已撤**——不是每个按钮都必须走总线，
    //   而这条路连续两版都在"事件能不能到"上出问题 ⇒ 收进唯一点击入口最稳。

    // ---------- ★★leg62：**独立抽取设定**的入口（用户令「方便我直抽设定快速看效果」）----------
    // 口径（三条，别越界）：
    //   ① **只抽刻度（概念表）**——不走名册遍/属性遍那两轮（那要跑好几块、分钟级）；
    //      "这把尺长什么样"一次调用就够 ⇒ 想快速看效果时不必等整条管线。
    //   ② **结果不入账**：草稿挂在 `world.context.__scaleDraft`（会话态，不是契约字段、不写盘），
    //      已冻结的设定一个字不动。要真采用就走正常的初始化/重抽（本按钮不当第二条写入口）。
    //   ③ ★leg197：档位名**不再过出处闸**（`sanitizeScales` 已不看原文）⇒ 模型交的档位一律照收；下面那个 dropped 读数因此恒为 0。
    bus['extract-scales'] = longTask.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async () => {
        const settings = modelSettings() || {};
        const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
        if (!resolved) { setStatus('注意：模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
        setStatus('正在合订设定源（角色卡 + 世界信息）…');
        let src;
        try { src = await autoComposeSource(); } catch (err) { setStatus(`注意：合订设定源失败：${String(err?.message || err)}`); return; }
        if (!src?.ok) { setStatus(`注意：设定源不可用：${src?.reason || '未知'}——请检查 ST 是否已载入角色卡/世界书`); return; }
        setStatus(`直抽刻度中（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}）…`);
        const t0 = Date.now();
        let calls = 0;
        let raw = '';
        try {
            raw = await diagExtract(resolved)(buildScalePrompt(src.text));
            calls = 1;
        } catch (err) {
            setStatus(`注意：直抽失败（${((Date.now() - t0) / 1000).toFixed(1)}s）：${String(err?.message || err)}`);
            return;
        }
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        // 解析（模型偶尔把 JSON 包在别的话里：取第一对花括号）
        let obj = null;
        let parseErr = '';
        try {
            const s = String(raw || '');
            obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
        } catch (err) { parseErr = String(err?.message || err); }
        if (!obj) {
            console.warn('[story-world-v2] 直抽刻度：输出不是 JSON（前 200 字）', String(raw || '').slice(0, 200));
            setStatus(`注意：直抽返回的不是 JSON（${secs}s）——原文已打到控制台，账本未动`);
            return;
        }
        const errors = [];
        const scales = sanitizeScales(obj.刻度 ?? obj.轴 ?? obj, { sourceText: src.text }, errors);
        // ★leg197：出处闸已撤 ⇒ 这个读数恒为 0（旧读数留着，免得动草稿形状与既有判据；见上一条注释）。
        const dropped = errors.filter((e) => /原文查不到/.test(e)).length;
        const world = readHotMeta() ? loadHotAccount(readHotMeta()) : null;
        if (!world) { setStatus('注意：世界还没载入，直抽结果无处可放（账本未动）'); return; }
        world.context.__scaleDraft = {
            at: new Date().toISOString(), source: src.label || '', secs: Number(secs), calls,
            scales, dropped, errors: errors.slice(0, 20),
        };
        refreshSections(['setting']);
        console.info(`[story-world-v2] 直抽刻度完成：${scales.length} 张表 · ${secs}s`, { scales, errors });
        setStatus(`直抽刻度完成：${scales.length} 张概念表 · ${secs}s${dropped ? ` · ${dropped} 条档位原文里找不到（已丢）` : ''}——只落「设定」页那一栏，账本未动`);
    });
    bus['clear-scale-draft'] = () => {
        const world = readHotMeta() ? loadHotAccount(readHotMeta()) : null;
        if (!world) { setStatus('注意：世界还没载入'); return; }
        delete world.context.__scaleDraft;
        refreshSections(['setting']);
        setStatus('已清掉直抽刻度那一栏（账本本来就没动过）');
    };

    // ---------- ★★leg70（A6）：**采用这份草稿（只换刻度）** —— 抽完能存 ----------
    // 病（`docs/leg68-recon-pending.md` §A6 实测 + 用户 leg63 原话「我刚刚抽了有很多表，但是原本的内容还在」）：
    //   上面那条直抽通道只把结果挂到 `world.context.__scaleDraft`（**会话态**），
    //   `applySettingToSsot` / `writeHotMeta` / `flushHotMeta` **一个都没调**
    //   ⇒ ① 刷新即丢；② `frozen.canon.刻度` 一个字不动 ⇒ 面板上"原本的内容还在"；
    //     ③ 那一栏**永远只是看的**（想真用只能走「初始化」= 重开世界，或「只重抽设定」= 换掉整份设定）。
    //   ★而"直抽那条路不当第二条写入口"是**有意留的口**（见上一条通道的口径注释），不是漏接的线
    //     ⇒ 所以**另起一个动作**：抽 = 一次调用瞄一眼、采用 = 写账落盘，两件事不许同处一地。
    //
    // 口径（四条，别越界）：
    //   ① **只换刻度那三格**（`刻度` + 由它派生的 `powerScale`/`dims`）——用户要的是"换尺子"，
    //      不是"换设定"：法则/名册/史略/世情/张力**一个字不动**（判据里有反向白名单）。
    //   ② **料 = 手上那份草稿**（`world.context.__scaleDraft.scales`），**不是重抽一遍**
    //      ⇒ 本动作**不许**出现 `extractWorldSetting`（本仓最贵的病：把"抽"与"存"接成一条）。
    //   ③ **名册保命靠形状**：canon 从**账上那份**展开起手（`{ ...before, … }`）⇒ `bookEntities`
    //      等键天然带过。对照同族的「只重抽设定」——它换的是**整份** canon，所以它必须**显式**保名册。
    //   ④ **落盘三步一个不少**：`applySettingToSsot`（唯一那条换设定路）→ `writeHotMeta` →
    //      **`await flushHotMeta()`** ⇒ 刷新不丢（这一步正是本动作与"只瞄一眼"的根本区别，leg20 语义）。
    bus['adopt-scale-draft'] = longTask.wrap('adopt-scale-draft', LONG_TASK_LABELS['adopt-scale-draft'], async () => {
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { setStatus('注意：世界还没载入——先载入一个世界再采用草稿'); return; }
        const draft = world.context?.__scaleDraft;
        if (!draft || typeof draft !== 'object') { setStatus('注意：草稿栏是空的——先按「只抽刻度」抽一次再采用'); return; }
        // 空草稿不许入账：那会把账上的尺子**抹成零张表**（"抽到 0 张"不该等于"清空刻度"）
        const scales = Array.isArray(draft.scales) ? draft.scales : [];
        if (!scales.length) { setStatus('注意：这份草稿一张表都没有——不采用（账上的刻度一个字没动）'); return; }
        const frozen = world.context?.setting?.frozen;
        const before = frozen?.canon || {};
        // ★拍板 9：覆盖**不可回** ⇒ 旧的那一份先打到控制台再覆盖（照「只重抽设定」那条"改一次留一次痕"）。
        //   读数直接取自**手上这份 canon**（`刻度` 是源，旧两列是派生视图 ⇒ 数它一张表几档就是账上真数）。
        const oldScales = Array.isArray(before.刻度) ? before.刻度 : [];
        const nTiers = (list) => list.reduce((n, t) => n + (t.档位 || []).length + (t.子表 || []).reduce((m, s) => m + (s.档位 || []).length, 0), 0);
        console.info('[story-world-v2] 采用这份草稿：即将只换刻度那三格（旧读数备份，旧账不再可回）', {
            世界: world.context?.world, 指纹: frozen?.fingerprint, 草稿源: draft.source || '',
            旧: {
                刻度表: oldScales.length, 档位: nTiers(oldScales),
                旧两列: { 档位: (before.powerScale || []).length, 维度: (before.dims || []).length },
            },
            新: { 刻度表: scales.length, 档位: nTiers(scales), 遗留错误: (draft.errors || []).length },
        });
        // ★拍板 4：旧两列走**唯一**那条派生路（`abstract.js:1064`）——不许在这里手写一份 `powerScale`/`dims`
        const flat = scalesToFlat(scales);
        // ★拍板 3：名册保命那一步 —— **从旧 canon 展开**（`bookEntities` 等键原样带过，结构上保命）
        const canon = { ...before, 刻度: scales, powerScale: flat.powerScale, dims: flat.dims };
        // ★拍板 5/6：`fingerprint` **不动**（本次没重读源 ⇒ 动它就是谎报"书变了"，会让"书没变不重抽"失去依据）；
        //   `extractedAt` **要新**（它印在设定页副标题「抽取于 …」上，而刻度确实是这一刻换的；
        //   ★代价如实说：它不再表示"整份设定来自同一次抽取"——更准的做法是另加一个键，那要动契约，已登记待报批）
        const setting = { ...world.context.setting,
            frozen: { ...world.context.setting.frozen, canon, extractedAt: new Date().toISOString() },
        };
        // ★拍板 1/2：走唯一那条换设定的路径（其余字段原样带过；不许自己拼一份 `context`）
        const next = applySettingToSsot(world, setting);
        // ★拍板 7：入账 ⇒ 草稿**退场**（留着 ⇒ 面板同时画"草稿"与"账本"两份刻度，看着像没生效）
        delete next.context.__scaleDraft;
        writeHotMeta(hotAccountShape(next));
        const flushed = await flushHotMeta();   // 采用入账：走与「只重抽设定」同一条显式落盘路径
        refreshWorld(next, { oldVolumes: LISTED_VOLUMES });
        refreshSections(['setting']);
        const fmt = (list) => `${list.length} 张 / ${nTiers(list)} 档`;
        // ★拍板 8：如实报三样 —— 换了什么 / 没动什么 / **单次调用的局限**（`leg63.md` §5.3 登记的必须告知项）
        setStatus(`已采用这份草稿：刻度换成 ${fmt(scales)}（原来 ${fmt(oldScales)}）`
            + `——只换刻度那三格（刻度 + 派生出来的力量谱系/维度）· 法则/名册/史略/张力一个字没动`
            + `（无回退键，旧的那份已打到控制台）`
            + ` · 注意：草稿是一次调用抽的、「只重抽设定」走多块 + 块间合并 ⇒ 两边不会逐字相同；想走生产那条管线就用「只重抽设定」`
            + (flushed.ok ? '' : '（注意：落盘没确认，见控制台——刷新可能丢）'));
    });

    // ---------- ★★leg62b：**只重抽设定**（用户令「我只想重抽设定」）----------
    // 病（用户原话）：「这个设定我抽得不满意，而且我只想重抽设定」——
    //   走「初始化」会把整个世界重新开局（实体账清空重种、棋子重建、进度归零），
    //   而用户只是对**设定那一块**不满意 ⇒ 必须有一条"**只换设定、名册与进度一个字不动**"的通道。
    //
    // 口径（三条）：
    //   ① **只换 `context.setting`**（走 `applySettingToSsot` = 唯一那条换设定的路径），
    //      **实体账 / 事件 / 编年 / 里程 / 棋子 / 轮次 一律不碰**（这就是"只重抽设定"的字面意思）。
    //   ② 抽取走的还是**生产那条管线**（`extractWorldSetting`：名册遍 + 属性遍 + 概念表），
    //      与初始化同一串函数 ⇒ 抽出来的东西与初始化口径一致，不是第二套。
    //      ★但不调 `seedBookEntities` —— 那一步是"把名册种进实体账"，正是本动作要避免的。
    //   ③ **旧设定先备份到控制台**（`console.info` 打旧 canon 的读数）：覆盖是不可回的，
    //      至少让"上一次抽的是什么"在控制台留一份（本仓"改一次留一次痕"的口径）。
    bus['reextract-setting'] = longTask.wrap('reextract-setting', LONG_TASK_LABELS['reextract-setting'], async () => {
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { setStatus('注意：世界还没载入——先打开/载入一个世界再重抽设定'); return; }
        const settings = modelSettings() || {};
        const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
        if (!resolved) { setStatus('注意：模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
        const before = world.context?.setting?.frozen?.canon || {};
        console.info('[story-world-v2] 只重抽设定：即将覆盖旧设定（读数备份，旧账不再可回）', {
            世界: world.context?.world, 指纹: world.context?.setting?.frozen?.fingerprint,
            旧: {
                档位: (before.powerScale || []).length, 维度: (before.dims || []).length,
                刻度表: (before.刻度 || []).length, 法则: (before.rules || []).length,
                史略: (before.historyNotes || []).length,
            },
        });
        setStatus('正在合订设定源（角色卡 + 世界信息）…');
        let src;
        try { src = await autoComposeSource(); } catch (err) { setStatus(`注意：合订设定源失败：${String(err?.message || err)}`); return; }
        if (!src?.ok) { setStatus(`注意：设定源不可用：${src?.reason || '未知'}——请检查 ST 是否已载入角色卡/世界书`); return; }
        setStatus(`只重抽设定中（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}）…名册与进度不会动`);
        const progressEvents = [];
        const progress = extractionProgressHandler(progressEvents);
        let r;
        try {
            r = await extractWorldSetting({
                sourceText: src.text,
                extract: diagExtract(resolved),
                force: true,                      // ★强制重抽：本动作的存在意义就是"书没变我也要重抽"
                // ★★★leg144：并发几路**从设置里读**（设置页「模型通道」那一格；没填过 ⇒ 出厂值）。
                //   数住 `src/abstract.js` 的 `EXTRACT_CONCURRENCY`（一处定义，三个调用点共用）。
                concurrency: extractConcurrency(),
                onProgress: progress.onEvent,
                extraDeclared: src.titleRoster,
                compileInfo: compileSummary(src.catalog, src.titleRoster),
                // ★★leg62c（用户令「重抽时跳过名册遍」）：名册遍的产物（`bookEntities`）只喂
                //   `seedBookEntities`，而实体已经全在账上了 ⇒ 那一遍是把调用烧在**无人消费**的产物上。
                //   ⇒ 每块 2 次调用降到 **1 次**（大荒 9 块：18 → 9 次）——用户实机一轮 >20 分钟的主因之一。
                //   代价：书里**新增**的名号这次不入册（要补名册就走「初始化」）——状态条如实报。
                skipRoster: true,
                // ★Task 3：允许来源（发射端自有的最终接收块）+ 依据明细（走既有调试面）。理由见 src/abstract.js。
                allowedSources: src.allowedBlocks || null,
                evidencePolicy: 'strict',
                onEvidence: diagEvidence,
            });
        } catch (err) {
            progress.stop();
            setStatus(`注意：重抽失败：${String(err?.message || err)}——设定一个字没动`);
            return;
        }
        progress.stop();
        diagSettingOutcome(r);
        if (!r.ok) {
            setStatus(`注意：重抽失败：${(r.errors || []).join('; ')}——设定一个字没动`);
            return;
        }
        // ★★必须保住 `bookEntities`：跳了名册遍 ⇒ 这次的 canon 里**没有名册**
        //   ⇒ 直接换上去会把账上的名册抹成空（★这正是本仓"删字段只删一半"的老病，别踩）。
        //   口径：名册照旧用**账上那一份**（本次没重抽它），其余设定用新的。
        const keptBook = before.bookEntities || [];
        if (keptBook.length) r.setting.frozen.canon.bookEntities = keptBook;
        retainGeography(world.context.setting, r.setting);
        // ★只换 setting：走唯一那条换设定的路径（其余字段原样带过）
        const next = applySettingToSsot(world, r.setting);
        writeHotMeta(hotAccountShape(next));
        const flushed = await flushHotMeta();
        const after = r.setting?.frozen?.canon || {};
        console.info('[story-world-v2] 只重抽设定完成', {
            世界: src.worldName, 调用: r.timing?.calls, 毫秒: r.timing?.ms, 名册遍: '已跳过',
            新: {
                档位: (after.powerScale || []).length, 维度: (after.dims || []).length,
                刻度表: (after.刻度 || []).length, 法则: (after.rules || []).length,
                史略: (after.historyNotes || []).length,
            },
            名册: `${keptBook.length} 条（本次未重抽，照旧保留）`,
            实体账: (next.entities || []).length, 轮次: next.meta?.tick, 落盘: flushed,
            errors: (r.errors || []).slice(0, 6),
        });
        refreshWorld(next, { oldVolumes: LISTED_VOLUMES });
        refreshSections(['setting']);
        const secs = r.timing?.ms == null ? '' : ` · ${Math.round(r.timing.ms / 1000)}s`;
        setStatus(`设定已重抽（${(after.刻度 || []).length} 张刻度表 / ${(after.powerScale || []).length} 档 / ${(after.rules || []).length} 条法则${secs}`
            + ` · 调用 ${r.timing?.calls ?? '?'} 次 · 名册遍已跳过）`
            + `——名册 ${(next.entities || []).length} 个实体与第 ${next.meta?.tick ?? 0} 轮进度一个字没动`
            + (keptBook.length ? `；账上 ${keptBook.length} 条名册照旧保留（本次没重抽名册）` : '')
            + (flushed.ok ? '' : '（注意：落盘没确认，见控制台）'));
    });

    // ★leg112（C1）「就按现在这本算」：动作名 → 处理器（实现住 `web/book-rebaseline.js`；★别搬回来——搬回来实测 3140 行撞锁）
    bus[REBASELINE_ACTION] = rebaselineHandler;

    // ---------- leg26：世界参数 · 档位（参数页）----------
    // 口径（用户令「参数独开页签」+「让用户自己调挡位」）：
    //   · 这些是**玩家对世界的输入**，不是引擎算出来的判断、也不是书里的原稿 ⇒ 独立一页。
    //   · 引擎**只照抄**：值必须是 params.js 的档位原话（白名单）。
    //   ★★leg41 改口径（用户令「可以你做吧」）：**落点从世界账改成插件自己的配置区**
    //     （`extensionSettings`，走 ST 的 `saveSettingsDebounced`）——见 `src/param-store.js` 头部。
    //     世界账里的 `dynamic.env` 降级为**镜像**（引擎还照旧读它）。于是：
    //     ①"改一次参数 = 整份 9.6MB 聊天上盘"这件事**没了**；②"刷新回默认"这件事**没有对象了**。
    bus['set-param'] = async (payload) => {
        const key = String(payload?.param || '').trim();
        const value = String(payload?.value ?? '').trim();
        // ★★★leg48（**真浏览器现场抓到的第二笔**）：同一格里会进**两笔**——
        //   `收到：每轮递线 → "9"（ok）` → `控件按真源对齐 → "3"` → `收到：每轮递线 → "3"（ok）`
        //   ⇒ 第二笔把玩家选的 9 覆盖成 3，画面看起来就是"它自己跳回去了/刷新回默认"。
        //   第二笔的来源：整页/局部重画把 `<select>` **销毁重建** ⇒ 浏览器对**新节点**补吐一笔
        //   带**旧值**的事件（`input`+`change` 各一次，所以现场是"点一次写两次"）。
        //   ⇒ 定稿（一笔操作 = 一笔事务）：**本通道忙的时候，同一格再来的事件一律不受理**，
        //     并如实留痕（不是静默丢弃）。它只挡"同一刻的补吐事件"，挡不住玩家下一次真实的点击
        //     （那时上一笔早已结束）。
        const busy = paramApi.paramBusy().get(key);
        if (busy) {
            console.info(`[story-world-v2] set-param：上一次操作还在进行中 ⇒ 不受理这一笔重复事件`
                + `（值 ${JSON.stringify(value)}）——这是重画/浏览器补吐的那一笔，不是玩家的手：${key}`);
            return;
        }
        paramApi.paramBusy().set(key, true);
        try {
            return await sw2ApplyParam(key, value, payload);
        } finally {
            paramApi.paramBusy().delete(key);
        }
    };

    /**
     * ★leg48：`set-param` 的**实体**（从 `bus['set-param']` 里提出来，为的是让"忙闩"能干净地包住它）。
     * 口径不变：判定与写入全在 `paramHub`；本函数只做接线（拿世界 → 交给 hub → 落账 → 对齐画面 → 状态条）。
     */
    async function sw2ApplyParam(key, value, payload) {
        // ★★★leg48：**"明确清空"与"手滑到空"在这一层分开**（判定必须在接线层，因为只有这一层
        //   知道"这一个控件有没有「未定」这一项、玩家是不是选了它"）：
        //   · 下拉里的空串 = 玩家**明确选了「未定」**（`render.js` 给每个下拉的首项就是它）⇒ 走 `clear()`；
        //   · 开关按钮的空值 = 不是清空（它有 data-value）⇒ 走 `set()`，由 hub 按空值处理（什么都不动）。
        //   ★为什么非分不可（用户实机状态条的原话）：不分的时候，浏览器吐一笔**带空值的事件**
        //     （重画/滚轮/失焦）就会被当成"玩家要清空" ⇒ **档位被删**，而状态条还报"已存进本地存储"。
        const el = payload?.el || null;
        const fromUnsetOption = (() => {
            try { return String(el?.tagName || '').toUpperCase() === 'SELECT' && el.value === ''; } catch (_) { return false; }
        })();
        // ★★leg46：本条通道**只做三件接线的事**，判定与写入全在 `paramHub` 里：
        //   ① 拿**当下的**世界（从聊天账现读一份，不用渲染层那份引用）——★拿不到不再是"拒绝写入"的理由；
        //   ② 把它的返回值当**唯一真相**——状态条照抄 `humanLine`（存到哪 / 镜像成没成 / 失败在哪一步）；
        //   ③ 把镜像那份写回聊天账 + 按真源把控件与格对齐。
        //   ★本函数**不再碰任何存储**（旧版这里既算世界名、又写 localStorage、又写插件配置、
        //     又自己镜像一遍 —— 五处写入口就是这么散出去的）。
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        // ★★★leg48：**世界对象拿不到时，把"世界名"单独交给 hub**（它是桶键的唯一来源）。
        //   为什么必须单独给名字：真机上"世界在盘上、`loadHotAccount` 却给了 null/半成品"是最常见的形状
        //   （载入链中任一环失败）。此时**名字是有的**（就在热账那一格里），而桶键只能靠它 ——
        //   名字拿不到就会退回兜底名 ⇒ 档位存进另一个桶 ⇒ 面板读的是原桶 ⇒ **玩家看到"我改的不见了"**。
        //   ★注意：这里**只取名，不猜内容** —— 拿不到就是空串，hub 自己会用"最后一次见到的名字"兜底。
        const worldNameHint = (() => {
            try { return String(payload?.worldName || meta?.world?.context?.world || '').trim(); } catch (_) { return ''; }
        })();
        const key2 = world || worldNameHint || null;
        const r = fromUnsetOption ? paramApi.clear(key2, key) : paramApi.set(key2, key, value);
        paramApi.setLastWorld(r.mirror?.world || world || paramApi.lastWorld() || null);
        // ★★★leg48：**世界没到就出声**（旧版这条路上一个字都不说，于是"世界对象没拿到"这件事
        //   在玩家与维护者两边都不可见——十二轮里缺的就是这一行）。
        if (!world) {
            console.warn(`[story-world-v2] 这一刻拿不到世界对象（载入还没跑完或失败）——`
                + `参数**照常写进真源**，引擎那一格（世界账）等世界载入后由 flushPending 补上`
                + `（见控制台里 loadWorld 的报错；面板参数页自检卡有「世界对象」一行）`);
        }
        // ★★★leg46 续·五（**用户第三次实机：「我点了四次为啥有八次写入，在点击旁边空白的时候会直接写入两次」**）：
        //   八次写入 = 四组"**写成功 → 40 毫秒后丢掉**"，每一对的第二笔**都是同一个 `bus.set-param`**
        //   ⇒ **同一格一次点击进了两次**，且第二笔带的值与第一笔不同（否则会走"无变化"分支、不会写盘）。
        //   ⇒ 这一行是**定性用的读数**（零风险、不改行为）：把"这一笔到底提交了什么值、结果是什么分支"
        //     打到控制台。下一份反馈里，`收到：<键> → <值>` 连着两行就是答案（第二行的值是什么，一眼就知道）。
        console.info(`[story-world-v2] set-param 收到：${key} → ${JSON.stringify(value)}`
            + `（${fromUnsetOption ? '明确清空' : '赋值'} · 真源现值 ${JSON.stringify(r.before)}`
            + ` · 世界「${r.worldName ?? '—'}」· 世界对象 ${world ? '在' : '**不在**'}`
            + ` · 判定 kind=${r.kind} changed=${r.changed} · 面板构建 ${PANEL_BUILD}）`);
        if (r.reason) console.info(`[story-world-v2] set-param 未受理：${r.reason}`);
        if (r.kind === 'noop-empty') {
            console.info(`[story-world-v2] set-param：空值不算改档位 ⇒ 一个字都没写（要清空请明确选「未定」）：${key}`);
        } else if (r.kind === 'unchanged') {
            console.info(`[story-world-v2] set-param 无变化：${key} = ${r.after ?? '未定'}（真源里本来就是它，无需改动）`);
        }

        // 受理了（真值变了）⇒ 把镜像那份落进聊天账。★从这里往后全是"下游"，参数已经安全落定。
        if (r.changed && r.mirror?.world) {
            writeHotMeta(hotAccountShape(r.mirror.world));
            paramApi.setLastWorld(r.mirror.world);
        }


        // ★★★leg46 续·五（**用户第三次实机：「点一次空白写两次、第二笔把 9 覆盖回 3」**）：这一格**改了治法**。
        //   旧法：`refreshSections(['params', ...])` —— **整块 innerHTML 重画参数页**。
        //   它的后果（用户审计里五组"写成功 → 40ms 后丢掉"就是它）：把玩家手底下的 `<select>` **销毁重建**
        //   ⇒ 浏览器对**新节点**再吐一笔事件（带着刚被换掉的**旧值**）⇒ 第二笔把第一笔覆盖回默认。
        //   ⇒ 定稿：**只就地改显示格**（`data-param-cell="<键>"` 那一个 `<b>` 的字），
        //     **绝不重画参数页、绝不碰任何控件、绝不回写控件的值**。
        //     （与 leg41 那条铁律一致：控件是玩家的手，不是我们的画布；`<b>` 才是我们的画布。）
        //   ★★★本次（清死码）：这里原有的一句 `refreshSections(['board'])` 已删——**`board` 从来不是一个页签 id**
        //     （`settings.html` 8 个容器里没有它，leg97 并页时 `#sw2_view_board` 已退场）⇒ `if (!el) continue`
        //     **必然命中**，那句只白跑一遍 `renderAll`。★不"顺手改成 `['panorama']`"：那会让可见面**真的**多一次
        //     重绘（并页那两栏会重建）= 行为变化，要升 `PANEL_BUILD` 并另行取证；本笔只清死码，不夹带行为变化。
        if (r.kind === 'ok' || r.kind === 'fail') {
            // ★★★leg46 续·十（**用户第五次实机："我改了值旁边直接变成未定"**）：这里**不再按真源写格**。
            //   格的字现在**只从同一行的控件读**（`sw2SetParamCell` 的规矩）⇒ 控件是 12，格就必须是 12。
            //   曾经在这里按 `r.env` 写过一版，结果"真源那一份里没有这个键"时把它写成「未定」——
            //   而控件明明显示着玩家刚选的值 ⇒ 画面自相矛盾。**这条路整段删掉**。
            // ★★★leg48（**"改了回默认"的最后一环**）：这一笔结束之后，**控件按真源对齐**——
            //   写成功 ⇒ 控件停在玩家选的那一档（真源＝它）；空值/非法/失败 ⇒ 控件**退回真源那一档**，
            //   于是"手滑到空"不会再留在屏幕上冒充一次改动（旧版留着的就是那一屏：
            //   控件空着、"格"跟着写「未定」，刷新一看档位回默认）。
            paramApi.sw2SetParamControl(key);
            paramApi.sw2SyncParamCells();
            // 撤销按钮的可用性跟着刷（它是按钮，改 `disabled` 不算"回写控件的值"）
            try {
                const btn = document.getElementById(WINDOW_ID)?.querySelector?.('[data-action="param-undo"]');
                if (btn && typeof btn.disabled === 'boolean') btn.disabled = !(sw2ParamUndoState().count > 0);
            } catch (_) {}
        }

        // ★leg33d：总闸被打开 ⇒ 立刻把它"接上"（不必等下一轮）。关掉**不做任何拆除**——
        //   世界原样留在盘上、面板照常渲染，只是不再自动推进（手动「推进一轮」永不被闸）。
        if (r.kind === 'ok' && key === AUTO_ADVANCE_KEY) {
            // ★★★leg162：外壳动作条那格状态**当场跟着变**（不然玩家按了「关」，顶上那句照旧说"自动推进"）
            syncActionbar(null);
            if (r.after === '1') {
                const hotNow = loadHotAccount(readHotMeta());
                setStatus('插件已开 · 发消息会自动推进世界（要停请回参数页按「关」）'
                    + (hotNow ? '' : ' · 注意：但还没有世界：先「开始新世界」'));
            } else {
                setStatus('⏸ 插件已关 · 世界原样留在盘上（没有清账、没有拆线）· 要看按观棋窗口、要推按窗口顶部的「推进一轮」');
            }
            return;
        }
        // ★★状态条 = hub 的原话（**不许在这里另写一套口径**——leg41 的"说得比做得好听"就是两套口径）
        setStatus(r.humanLine);
    }
    // ---------- leg41：撤销（参数页那一枚；照 v1 的撤销栈）----------
    bus['param-undo'] = async () => {
        const r = paramApi.sw2UndoParam();
        if (!r.ok) { setStatus(`↶ ${r.reason}`); return; }
        setStatus(`↶ 已撤销：${r.label} —— 档位回到那一步之前（世界已经发生的事不回退）`);
    };

    // ---------- leg25 d：查书补全（只剩面板行内「查/重查」这一条路）----------
    // 单实体：即时查一次（不必等下一轮世界推进），查完立即落盘 + 重绘
    bus['lookup-entity'] = async (payload) => {
        const id = payload?.entity;
        if (!id) return;
        const forceFields = payload?.force === 'all' ? 'all' : (payload?.force ? 'absent' : null);
        setStatus(`正在查书：${payload?.name || id}…`);
        try {
            const r = await lookupOneEntity(id, { forceFields });
            if (!r.ok) { setStatus(`注意：${r.error}`); return; }
            const e = r.entity || {};
            const got = ['实力', '位置'].filter((f) => typeof e[f] === 'string' && e[f].trim())
                .map((f) => `${f}：${e[f]}`).join(' · ');
            setStatus(`${e.name || id} → ${got || '书里没给出可用原话'}${r.warning ? `（${r.warning}）` : ''}`);
        } catch (err) {
            setStatus(`注意：查书失败：${err?.message || err}`);
        }
    };

    // ★★★leg76 收尾（本次补齐）：`bus['lookup-batch']` 与它的别名 `bus['lookup-batch-all']` **整段删除**。
    //   撤钮之后两头都必须干净：产物里没有那枚钮（`src/render.js` 已撤）、总线里也不许再有那两个动作
    //   （`test/lookup-batch.test.js:441` 正是"两头都不许回潮"那条锁）。
    //   ★判据纪律留档：只锁一头的话，"按钮撤了但处理器留着"或反之都能溜过——正是 leg40b 治的那类半拉子。
    //   ★边界：上面那枚行内「查」（`lookup-entity`）**是好的，保留**——本笔只撤全册那一枚。

    // ---------- leg27 后：快照容错（第八页签的两个动作）----------
    bus['snapshot-restore'] = async (payload) => {
        const id = payload?.snap;
        if (!id) return;
        const tick = payload?.tick === '' || payload?.tick == null ? null : Number(payload.tick);
        const cur = loadHotAccount(readHotMeta()) || sw2LastWorld;
        const curTick = cur?.meta?.tick;
        const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm(`确定回到第 ${tick ?? '?'} 轮的这次保存？${payload?.saved ? `\n保存时间：${payload.saved}` : ''}\n\n· 世界账回到第 ${curTick ?? '?'} 轮 → 第 ${tick ?? '?'} 轮\n· 只回世界账，对话记录不动\n· 恢复前自动保存当前状态\n\n确认后立即生效。`)
            : true;
        if (!ok) { setStatus('已取消（世界原样）'); return; }
        sw2TickQueue?.invalidate();
        setStatus(`正在回到快照 ${id}…`);
        const r = await snapHub.restoreSnapshot(id);
        if (!r.ok) { setStatus(`注意：回不去（链不完整）——${r.error}`); return; }
        await snapHub.refreshSnapshots();
        memoryWiring?.settingsChanged();
        // ★★leg72b：`flushed` 是 `flushHotMeta()` 返回的**三态对象**（`{ ok, reason }`）——
        //   写成 `r.flushed ?` 是判**对象真值**（恒真）⇒ 真失败也印"已落盘"，
        //   与上面 `snapshot-store.js` 里那条"存根恒真"是**同一种病**（leg67–71 的形态）。
        //   ⇒ 必须按 `.ok` 分叉；这就是本仓那条「面板上印出来的必须现算」的落法。
        setStatus(`已回到第 ${r.tick ?? '?'} 轮${r.flushed?.ok ? ' · 已落盘' : ' · 注意：落盘失败（见控制台）'}——对话记录未动`);
    };

    bus['snapshot-clear'] = async () => {
        const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
            ? window.confirm('重置快照？\n\n· 会清空**当前聊天**的全部快照（别的聊天不受影响）\n· 然后立刻给**现在这份世界**拍一份新链头（第 1 份）\n· 世界账本身**不动**，只动快照库\n\n适用场景：盘上混着旧代码/丢账时拍下的脏数据。')
            : true;
        if (!ok) { setStatus('已取消（世界原样）'); return; }
        const r = await snapHub.resetSnapshots();
        if (!r.ok) { setStatus(`注意：重置失败：${r.error}`); return; }
        await snapHub.refreshSnapshots();
        setStatus(`快照已重置（清掉 ${r.removed} 份 · 已拍新链头 s1）——世界账未动，窗口保留 15 步`);
    };

    // ---------- K35：阅卷 / 编年五筛 / 链视图 / 导出导入 ----------
    bus['read-volume'] = async (payload) => {
        const volId = payload?.vol;
        if (!volId) return;
        try {
            const volume = await volumeStore().get(volId);
            if (!volume) { setStatus(`注意：卷「${volId}」不在库中`); return; }
            const rows = volumeToChronicleRows(volume);
            // ★★★leg104（A4）：进**浮层**，不再插进编年页——那一页每轮整块重绘（`refreshWorld`／
            //   `refreshSections`）⇒ 展开的旧卷被**无声吞掉**，而且展开之后没有收起口。
            //   ★链浮层若开着先收掉：**一次只留一层**（两个浮层各挂一条 ESC，叠着按一下会散架）。
            bus['chain-close']?.();
            openVolumePopup(renderVolumeReadHtml(volId, rows));
            setStatus(`已展开旧卷「${volId}」（${rows.length} 行 · 只读）`);
        } catch (err) {
            setStatus(`注意：阅卷失败：${err?.message || err}`);
        }
    };
    // ★leg104（A4）：收起旧卷浮层（浮层里那枚「收起」/ 点空白 / ESC 三条路都走它；这里给总线留一个点名）。
    bus['volume-close'] = () => closeVolumePopup();

    // ---------- leg50（细案 spec-chronicle-page-ia）：编年页工具条五个动作 ----------
    // 口径与实体页四枚动作**完全同款**：改状态一行 + 只重绘本页（选数据一行都不写在这里，
    // 全在 `src/render.js` 的 `selectChroniclePage` 纯函数里）。★重绘走 `refreshSections(['chronicle'])`。
    //   ★回第一页的规矩（照实体页的既有理由）：
    //     · 换"只看/了结/轮次" ⇒ **回第一页**（命中集合变了，停在第 3 页会落在另一批行上）；
    //     · 换"计数口径" ⇒ **不回第一页**（一个行都不动，只是几枚钮换了把尺子；回首页 = 无理由的位移）。
    bus['ch-layer'] = (payload) => {
        viewState.setLayer(String(payload?.value || 'all'));   // ★leg79/81：状态与"回第一页"两条规矩都住新家
        refreshSections(['chronicle']);
    };
    bus['ch-closed'] = (payload) => {
        viewState.setClosed(String(payload?.value || 'any'));
        refreshSections(['chronicle']);
    };
    bus['ch-range'] = (payload) => {
        viewState.setRange(String(payload?.value || '10'));
        refreshSections(['chronicle']);
    };
    bus['ch-scope'] = (payload) => {
        viewState.setChronicleScope(String(payload?.value || 'all'));   // ★不动 page（与 `ents-scope` 同一条理由）
        refreshSections(['chronicle']);
    };
    bus['ch-page'] = (payload) => {
        // ★页码由渲染层夹紧（`selectChroniclePage` 的越界夹紧），这里只管加减——零第二份夹紧逻辑。
        //   ★★★本次（清死码）：**只剩一个游标了**——账目层那枚分页器 leg105 已撤，本次把它的游标 `pageBook`
        //     与产物 `sel.books` 一并删掉（实测：`pageBook` 取 1/3/99 产物逐字节相同）。⇒ 这里不再读
        //     `payload.layer`（产物里 `ch-page` 钮都带 `data-layer="event"`，`"book"` 一枚都没有），`turnChroniclePage` 也只收一个增量。
        viewState.turnChroniclePage(String(payload?.value) === 'prev' ? -1 : 1);
        refreshSections(['chronicle']);
    };
    // ★★★leg160：`bus['pan-seg']`（"看的是哪一段"那一族唯一的动作）**撤掉**——这一页画多少由账上那一格「往回看轮数」决定（设置里的框），页面上不再有钮可点。

    // ---------- leg49（细案 spec-entities-page-ia）：实体页工具条四枚动作 ----------
    // 口径：改状态一行 + 只重绘本页。**选数据一行都不写在这里**（全在 `src/render.js` 的纯函数里）。
    // ★重绘走 `refreshSections(['entities'])` 而不是自己拼 innerHTML：它是本仓唯一的局部重绘通道，
    //   且跑在 `sw2SectionRefreshRunning` 防重入标志里（自拼 innerHTML 会绕过它 ⇒ 重绘自己咬自己）。
    // ★★leg79/81：两张筛选词表（`SW2_ENTS_KINDS` / `SW2_ENTS_FILTERS`）**随族搬走了** ⇒
    //   接线层不再自己判词表：`applyEntsFilter` 返回 `false` = "这个词不在两张表里"，
    //   与原先的 `else-if` **同义**（接线层据此一个字都不动）。
    bus['ents-filter'] = (payload) => {
        viewState.applyEntsFilter(String(payload?.value || ''));
        refreshSections(['entities']);
    };
    bus['ents-sort'] = (payload) => {
        viewState.setEntsSort(String(payload?.value || 'active'));
        refreshSections(['entities']);
    };
    // ★分组那一档（`grp`）：控件与分组渲染在 Task 5 同批落地（用户拍板"中途不许有死控件"）。
    //   ★`page = 1` 复位与三个兄弟动作一致（Task 4 评审判定它当时零可观察行为、约定本笔补）：
    //     换了分组口径 ⇒ 命中集合的**切法与顺序都变**，停在第 3 页会落在另一批组上
    //     （与"换筛选/换搜索词必回第一页"同一条道理，否则玩家以为点了没反应）。
    bus['ents-group'] = (payload) => {
        viewState.setEntsGroup(String(payload?.value || 'none'));
        refreshSections(['entities']);
    };
    bus['ents-page'] = (payload) => {
        // ★页码由渲染层夹紧（`selectEntityPage` 的越界夹紧），这里只管加减——零第二份夹紧逻辑
        viewState.turnEntsPage(String(payload?.value) === 'prev' ? -1 : 1);
        refreshSections(['entities']);
    };
    // ★终审 I1：chip 计数的**口径开关**（全册 ⇄ 当前结果）。走的还是既有那条 `refreshSections(['entities'])`
    //   通道（与四个兄弟动作同形：改状态一行 + 只重绘本页）。
    //   ★**不动 `page`**（与三个兄弟动作不同，理由必须说清）：换筛选/换搜索词会**改变命中集合**
    //     ⇒ 停在第三页会落在另一批行上（那种情况回第一页是对的）；而换计数口径**一个行都不动**——
    //     `rows`/`hit`/`pages` 全不变，只是那几枚钮上的数换了把尺子。此时回第一页反而是**无理由的位移**
    //     （玩家正翻到第 7 页看着，点一下口径就被踢回第 1 页 = 本仓最忌的"面板抢玩家的手"）。
    bus['ents-scope'] = (payload) => {
        viewState.setEntsScope(String(payload?.value || 'all'));
        refreshSections(['entities']);
    };

    // ★★★leg140：**点实体行 ⇒ 弹「实体观览窗口」**（用户令「点击实体就会出现，能看到这个实体的
    //   各种属性以及它的事迹」）。行上的标记由 `src/render.js` 打（`data-action="ent-open"`）。
    //   ★窗口自己那棵树里的关闭口**在 hub 里收**：浮层挂 `document.body`，够不到这条总线
    //     ——与链浮层那条留档（`open-chain` 上面那段）是同一个坑，别再踩一次。
    //   ★参数名是 `who`（行上挂的是 `data-who`）：`data-entity` 那个名字**被既有判据占着**
    //     （它当"行内那枚「查」钮在不在"的代理，见 `src/render.js` 那一处留档）⇒ 别抢。
    bus[ENTITY_WINDOW_ACTION] = (payload) => { entityWindow.open(payload?.who); };

    // ★★★leg93c（用户令「**事件链条点击后不要放在编年页了，直接弹出一个小窗口**，
    //   要不然我在大事纪页签点击还得回到编年页」）：链视图改走**浮层**。
    //   病（源码可证）：旧实现把渲染好的链视图 `insertAdjacentHTML('afterbegin')` 到
    //   **写死的 `#sw2_view_chronicle`** ⇒ 链按钮在两处（编年页 + 大事纪·旧卷页，C-1 两个入口），
    //   从大事纪点，内容却进了**另一个页签** ⇒ 玩家看到"点了没反应"，得自己切回编年页。
    //   ⇒ 修法：链视图进一个**挂在 `document.body` 上的浮层**（三条理由见 `web/style.css` 的 `.sw2-cv-mask`）。
    //   ★浮层与面板窗口**互不影响**：面板关着也能看（链是只读事实）；面板的 ESC 只管面板，浮层的 ESC 只管浮层。
    bus['open-chain'] = (payload) => {
        try {
            const id = payload?.chain;
            const world = sw2LastWorld;
            if (!world || !id) { setStatus('注意：没有可展开的链'); return; }
            const chain = expandChain(world, id);
            const html = renderChainViewHtml(chain, { world, volumes: LISTED_VOLUMES });
            // 先撤上一层（点第二条链 ⇒ 换内容，不留两份）
            document.getElementById(CHAIN_MASK_ID)?.remove();
            const mask = document.createElement('div');
            mask.className = 'sw2-cv-mask';
            mask.id = CHAIN_MASK_ID;
            const box = document.createElement('div');
            box.className = 'sw2-cv-box';
            box.innerHTML = `${html}<div class="sw2-cv-hint">点空白处或按 Esc 关闭 · 链视图只读</div>`;
            mask.appendChild(box);
            // ⓵ 点**背景**关掉（点弹窗内部不关——不然想看细处一点就没了）
            mask.addEventListener('click', (e) => { if (e.target === mask) closeChainPopup(); });
            // ⓷ ★★**浮层自己的按钮委托**（这条是必须的，别删）：面板的动作总线 `bindActions` 是挂在
            //   **`#story_world2_window`** 上的（`addEventListener('click', …)`），而本浮层挂在 `document.body`
            //   ⇒ 浮层里的 `data-action` **永远走不到那条总线**：链视图自带的「收起」（`chain-close`）与
            //   各处的「阅卷」（`read-volume`）会**点了没反应**。
            //   ★leg108 勘正：旧文案把「阅卷」写成 `.sw2-goto` —— 实测不成立（浮层产物里零个
            //     `.sw2-goto`；它是 `data-action="read-volume" data-vol=…`，而 `.sw2-goto` 的生产者在面板里）。
            //   ⇒ 在浮层上挂一条同形状的委托，**它只处理浮层自己那棵树里的东西**（`e.target.closest` 天然限定），
            //     不碰面板的任何行为（面板里那两个按钮照旧走总线，两边不重不漏）。
            mask.addEventListener('click', (e) => {
                const t = e.target;
                const goto = t?.closest?.('.sw2-goto');
                if (goto) {
                    // 「阅卷」= 要看旧卷页 ⇒ **先把浮层收掉**，否则挡住了玩家要看的东西（用户那句抱怨的另一面）
                    const view = goto.getAttribute('data-view') || 'archive';
                    closeChainPopup();
                    document.getElementById(WINDOW_ID)?.querySelector(`.sw2-tab[data-view="${view}"]`)?.click();
                    return;
                }
                const act = t?.closest?.('[data-action]');
                if (!act) return;
                const action = act.getAttribute('data-action');
                if (action === 'chain-close') { closeChainPopup(); return; }
                if (action === 'open-chain') {
                    // 链里再点链 ⇒ 换内容（`open-chain` 自己会先撤上一层）
                    bus['open-chain']({ chain: act.getAttribute('data-chain') });
                    return;
                }
                // 浮层里若将来长出别的动作：交给面板那条总线（宁可走一次，也别画了不接）
                // ★★leg108：参数不再手拼 —— 与主委托共用同一条读法 `readPayload`（病与实测见模块头）。
                dispatchAction(action, readPayload(act), e);
            });
            // ⓶ ESC 关掉：**捕获阶段**且 `stopPropagation` ⇒ 面板那条"ESC 关整个窗口"不会跟着一起触发
            //   （本监听只在浮层存在期间挂着，随浮层一起摘掉——见 `closeChainPopup`）
            document.body.appendChild(mask);
            const onEsc = (e) => {
                if (e.key !== 'Escape') return;
                e.stopPropagation();
                e.preventDefault();
                closeChainPopup();
            };
            mask._sw2Esc = onEsc;
            document.addEventListener('keydown', onEsc, true);
            setStatus(chain.ok ? `链已展开（上承 ${chain.up?.length ?? 0} · 下沿 ${chain.down?.length ?? 0} · 只读）` : '注意：链视图不可用');
        } catch (err) {
            setStatus(`注意：链视图失败：${err?.message || err}`);
        }
    };

    /** ★leg93c：收链浮层（**一处收口**：`chain-close` 按钮 / 点背景 / ESC 三条路都走它）。 */
    function closeChainPopup() {
        const el = document.getElementById(CHAIN_MASK_ID);
        if (el?._sw2Esc) document.removeEventListener('keydown', el._sw2Esc, true);
        el?.remove();
    }

    bus['chain-close'] = () => closeChainPopup();

    bus['export-world'] = async () => {
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { setStatus('注意：还没有世界可导出'); return; }
        try {
            const volumes = await volumeStore().list();
            const full = await Promise.all(volumes.map((v) => volumeStore().get(v.id)));
            const { json } = await buildExportBundle(world, full.filter(Boolean));
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = EXPORT_FILENAME;
            a.click();
            URL.revokeObjectURL(a.href);
            setStatus(`已导出整聊天（世界账 + ${full.filter(Boolean).length} 卷）`);
        } catch (err) {
            setStatus(`注意：导出失败：${err?.message || err}`);
        }
    };

    bus['import-world'] = async () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const res = await verifyImportBundle(text);
                if (!res.ok) { setStatus(`注意：导入被拒：${res.error}`); return; }
                // ★★★leg103（A3）：**导入与初始化同等破坏力，就必须问同一句**。
                //   病：这条路原来选错文件就直接 `writeHotMeta` + `loadWorld`，一声不响换掉当前世界；
                //   而隔壁「✨ 开始新世界」有确认框（同一份代码里两种标准）。
                //   ★两个契约：① 闸在**任何改动之前**（`writeHotMeta` 是第一个破坏动作）；
                //     ② 无 `window.confirm` ⇒ 放行，绝不因为"问不出来"把人卡死（与初始化同一条）。
                const target = worldToBeReplaced(loadHotAccount(readHotMeta()));
                if (target) {
                    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                        ? window.confirm(importOverwriteNotice(target))
                        : true;
                    if (!ok) {
                        setStatus(`已取消——世界「${target.name}」原样不动（没有导入，也没有发生任何调用）`);
                        return;
                    }
                }
                writeHotMeta(hotAccountShape(res.world));   // leg41：导入的账带它自己那份 env；随后 loadWorld 会把真源镜像补上
                const store = volumeStore();
                for (const v of res.volumes) await store.put(v);
                await loadWorld();
                const flushed = await flushHotMeta();   // leg20 语义：关键路径显式落盘后再报成功
                setStatus(`已导入：世界与 ${res.volumes.length} 卷${flushOutcomeText(flushed)}`);
            } catch (err) {
                setStatus(`注意：导入失败：${err?.message || err}`);
            }
        });
        input.click();
    };

    // ---------- K38：初始化（抽取五件套 + 名册）----------
    // ★★★leg144：**补上防连点闸**（它是面板上唯一没被 `longTask` 护住的长时间动作——另外三格早就有了）。
    //   病：初始化要跑 20–30 分钟，而界面上**没有任何"正在跑"的样子**（按钮照旧可点、文字照旧）
    //   ⇒ 玩家以为没点上、再点一次 ⇒ **两串模型调用一起跑**（白等一份时间、花两份钱，还互相抢网关）。
    //   ★闸/出声/按钮灰掉这三件事的实现在 `web/long-task.js`（本文件不重复写一遍）。
    bus['init-world'] = longTask.wrap('init-world', LONG_TASK_LABELS['init-world'], async () => {
        // ★★leg40b（I-1）：**先问，再动手**——这条必须是本函数第一条语句。
        //   放在这里（而不是放到 writeHotMeta 之前）是因为：抽取与起根都在这后面，
        //   真账实测合起来要几分钟（起根 170–490 秒）⇒ 闸若靠后，用户会在**毫不知情**的情况下等完再被覆盖。
        //   口径：有世界才问（`worldToBeReplaced` 返回 null = 没什么可丢的，别多问一句）；
        //   问不出来（无 window.confirm）⇒ 放行，绝不卡死。
        const target = worldToBeReplaced(loadHotAccount(readHotMeta()));
        if (target) {
            const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(initWorldOverwriteNotice(target))   // ★先归一（worldToBeReplaced）再喂文案：契约见该函数注释
                : true;
            if (!ok) {
                setStatus(`已取消——世界「${target.name}」原样不动（没有覆盖，也没有发生任何调用）`);
                return;
            }
            // ★★★leg103：**让那句承诺变成真的**（原来它是假的，见 `world-replace.js` 头部留档）——
            //   在确认之后、**任何改动与任何模型调用之前**先给当前世界拍一份自保快照。
            //   ★为什么必须在这里：`requestSnapshot` 的唯一调用点是 `writeHotMeta` 末尾，而抽取在它之前，
            //     所以不补这一下的话，用户以为的"退路"拍到的是**刚抽出来的新世界**（退回来还是新的）。
            //   ★零阻塞：拍快照失败绝不许挡住初始化（照 `requestSnapshot` 自己的纪律）。
            try { snapHub.requestSnapshot(loadHotAccount(readHotMeta()), '换掉前自保'); }
            catch (err) { console.warn('[story-world-v2] 换掉前自保快照没拍成（不影响初始化）:', err?.message || err); }
        }
        try {
            const settings = modelSettings() || {};
            // leg27：抽取走**独立超时档**（extraction: true = EXTRACTION_TIMEOUT_MS），不再蹭主调用的 120s
            const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
            if (!resolved) { setStatus('注意：模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
            setStatus('正在合订设定源（角色卡 + 世界信息）…');
            const src = await autoComposeSource();
            if (!src.ok) { setStatus(`注意：设定源不可用：${src.reason}——请检查 ST 是否已载入角色卡/世界书`); return; }
            setStatus(`设定源就绪（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}），开始抽取…`);
            // leg27 F1/F1b：抽取**全程可见**——进度事件 + 1 秒心跳读秒（用户「看不到日志」那一刀）
            const progressEvents = [];
            const progress = extractionProgressHandler(progressEvents);
            // ★★★leg150（甲案）：**人设名先读**——原来它到"安棋子"那一步才读，而甲案要在**抽取期间**
            //   就把玩家自己挡在起根候选名单外（那一刻账还没建，`context.playerId` 根本不存在）。
            //   名字读 ST 的 `name1`；★拿不到就退回空串（空串不排任何人），**不猜**。
            const personaName = (() => { try { return String(getCtx()?.name1 || '').trim(); } catch (_) { return ''; } })();
            const r = await extractWorldSetting({
                sourceText: src.text,
                extract: diagExtract(resolved), // 双形取法：字符串/JSON 都吃
                force: false,
                // ★★★leg144：**并发几路从设置里读**（此前是一块一块排队：大荒 9 块 × 2 遍 = 18 次调用 ≈27 分钟）。
                //   数住 `src/abstract.js` 的 `EXTRACT_CONCURRENCY`（一处定义，三个调用点共用）。
                concurrency: extractConcurrency(),
                // ★★★leg144：**书指纹缓存**（书没变 ⇒ 命中即零调用秒回；见上面 `abstractCache` 那一段）。
                //   `force: false` 正是"自动路径"该有的样子：书变了指纹就变、自动重抽。
                cache: abstractCache,
                onProgress: progress.onEvent,
                // ★leg60：**题名面**（零 token 的 cast）走"照书办"通道强制并册——
                //   作者把名册写在题名里（三国 `控制器_张辽`×187 / `张辽正史`×184），模型只抽到 127 条。
                extraDeclared: src.titleRoster,
                // ★leg60（第 3 件）：**编译完整性读数**落进 `setting.frozen.compile`——面板与账本都看得见
                //   "书里有多少条设定类条目 / 本次编译覆盖了多少 / 声明面漏了多少"。
                //   ⚠★**只落摘要标量**（用户真账实测抓出的自己那一刀）：第一版我把整个 `src.catalog`
                //     铺进去了，于是 `titleRoster`（189 条带 `why` 的名号明细）**整块进账**——
                //     13,679 字符 = 账本的 **11.4%**，而且契约层没登记它（`additional:false` ⇒ 违约）。
                //     明细属于**控制台诊断面**（`logInitDiagnostics` 已有），账本只留计数。
                compileInfo: compileSummary(src.catalog, src.titleRoster),
                // ★★★leg150（甲案·用户令「起根并进第二遍」）：抽取的第二遍**顺带**问"书里正在发生的事"
                //   ⇒ 起根不再需要第三次通读全书（三国 42 → **28** 次调用）。给这一格 = 委托它顺带问；
                //   不给（或小书单发／命中书指纹缓存）⇒ 下面照旧走 `seedRootsForWorld`（行为零变化）。
                seedRoots: { playerName: personaName },
                // ★Task 3：与"只重抽设定"同一条纪律（新规矩不许只长在一条路上）。
                allowedSources: src.allowedBlocks || null,
                evidencePolicy: 'strict',
                onEvidence: diagEvidence,
            });
            progress.stop();
            // 抽取耗时与逐段读数（成功也要出声——"慢"必须有据可查）
            console.info('[story-world-v2] 抽取耗时实测', {
                ok: r.ok, cached: r.cached, timing: r.timing, steps: describeProgress(progressEvents),
            });
            logInitDiagnostics(getCtx(), src, r); // 控制台诊断（现场唯一证据面）
            diagSettingOutcome(r);
            if (!r.ok) {
                const tk0 = r.timing || {};
                const secs0 = tk0.ms == null ? null : Math.round(tk0.ms / 1000);
                console.warn('[story-world-v2] 抽取失败实测', {
                    timing: tk0, steps: describeProgress(progressEvents), errors: r.errors || [],
                });
                setStatus(`注意：抽取失败${secs0 == null ? '' : `（${tk0.calls || 0} 次调用 / ${secs0} 秒）`}：${(r.errors || []).join('; ')}${/超时|timeout/.test((r.errors || []).join(';')) ? '——建议提高抽取超时或换更快的模型；每段成败见控制台' : ''}——世界未动`);
                return;
            }
            let seed = {
                version: 1,
                context: { world: src.worldName || '未名世界', tension: 0.5, positions: derivePositions(r.setting), setting: r.setting },
                entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
                meta: { tick: 0, simLog: [] },
            };
            // 第二十五棒 e：初始化创建世界时就把真书正文交给名册落账（零 token 兜底要用正文）；
            //   随后 `loadWorld()` 还会再跑一次（幂等）——两处同一条路径，谁先跑都不重不漏。
            // ★Task 3：种账 + 关系网 + 读数一次做完（`web/seed-diagnostics.js`；本文件只接线）。
            const seedOut = seedAndReport(seed, { entries: src.worldInfoEntries || [], stage: '初始化种账' });
            // B 组接线：世界必须真的有一枚玩家棋子（否则五条"禁写玩家"守卫、掩码、影响通道全是死的）。
            // leg25 c：开档描述的**四维解析整段删除**（那个小调用连同 player-setup/player-inject 两个模块一起没了）
            //   ——四维浮点已不存在（没法精确表示；手拍值让"编的"看起来像"算的"）。
            //   玩家棋子现在只有身份与位置（结构性事实），和别的实体同尺；开档描述本身仍留在 meta 里可查。
            //   ★★leg32h（用户：「又把主角演了」）：**这里必须把玩家的真名传进去**。
            //   旧法 `attachPlayerPiece(seed)` 空参 ⇒ 棋子永远叫「你」⇒ 模型在第 42 轮把主角「黄坤」
            //   当**新实体**入局（`e_42_1`）⇒ 世界账里两个平行的人 ⇒ 模型一直很尽责地演黄坤
            //   （替他开盘算、推进、写"以雷法锁定薛铁衣气机，展开殊死搏杀"这类**玩家自己的选择**）。
            //   传名字后：`attachPlayerPiece` 会**复用同名实体**（名册里就有 → 直接认领），否则建一枚真名棋子；
            //   此后每轮载入还有 `namePlayerPiece` 兜底，把"后来才出现的主角实体"并进来。
            //   名字读 ST 的 `name1`（用户人设名）。★拿不到就退回旧口径（空串 ⇒ 「你」），**不猜**。
            //   ★leg150：这次读已**挪到抽取之前**（甲案要在抽取期间就把玩家挡在起根候选名单外）——
            //     这里直接用上面那个 `personaName`（同一次读，不许读两遍：两遍就可能拿到两个值）。
            const piece = attachPlayerPiece(seed, personaName);
            // ★★★leg87：这里原本还有一段「把设置页的开档描述写进 `seed.meta.playerDesc`」——
            //   随那张卡一起撤（依据：写进去之后**全仓零处读**，四维解析那一族 leg25 c 已整条删除）。
            //   撤掉它 = 新账不再多一个无人读的字段；旧账里已有的一律不动（引擎不读，迁不迁行为相同）。
            const playerFinal = seed.entities.find((e) => e.id === seed.context?.playerId);
            // ★★leg40：**从世界源起根**——新世界开局就种几条"书里正在发生的事"当线头。
            //   为什么必须在**开局**这一步（用户拍板：起根只留在"初始化"与"显式移植"两处，**载入期绝不自动跑**）：
            //   世界源被抽成静态设定 + 名册（0 条起过事）⇒ 全账第 25 轮之前只有 1 条事件 ⇒ 模型可引用的节点只有那场大乱。
            //   ★★位置：**必须在 `attachPlayerPiece` 之后**——根要落成事件，而当事人得在账上认得出人；
            //     甲案合进来之后，"**问**"挪到了第二遍（那时还没棋子，所以人设名是**显式递进去**的，见上面 `seedRoots`），
            //     而"**落账**"仍在原处（`src/seed-roots.js` 的 `seedRootsFromPass` 自己再挡一次玩家）。
            //   失败零阻塞（起根不成照常开局）；种下的根在面板链视图里标「由世界源而起」。
            try {
                // ★★★leg150（甲案）：**两条路，按"根有没有并进第二遍"分叉**——
                //   · 有（大书正常抽取）⇒ 直接落账，**一次调用都不再发**；
                //   · 没有（小书单发／命中书指纹缓存）⇒ 照旧走 `seedRootsForWorld`（行为与改造前逐字相同）。
                //   为什么按 `Array.isArray` 而不是"数组非空"：**并进来了但一条没起出来**也必须算"并进来了"，
                //   否则会退回去再发 N 次调用（那正是这一笔要省掉的东西）。
                setStatus(Array.isArray(r.rawRoots) ? '正在开局：把抽出来的根种进账…' : '正在开局：从世界源起根（读整本书里"正在发生的事"）…');
                const seededRoots = Array.isArray(r.rawRoots)
                    ? seedRootsFromPass(seed, {
                        perChunk: r.rawRoots, fingerprint: seedFingerprint(src.text || ''), at: new Date().toISOString(),
                        candidateCount: r.rawRootsCandidates, warnings: r.rawRootsWarnings,
                    })
                    : await seedRootsForWorld(seed, {
                        sourceText: src.text || '', extract: diagExtract(resolved), fresh: true,
                        concurrency: extractConcurrency(),   // ★leg144：起根这一遍也并发（同一个数、同一条网关）
                        // ★★★Task 4：起根那条路也要**来源身份 + 原话**（与上面抽取同一份发射端产物）。
                        //   `evidencePolicy:'strict'` 是**显式**的：拿不到允许来源 ⇒ 明确拒绝，不许静默回落 legacy。
                        allowedSources: src.allowedBlocks || null, evidencePolicy: 'strict',
                        onProgress: (e) => setStatus(`正在开局：起根 第 ${e.index}/${e.count} 块（${e.chars} 字符）${e.ok ? `· 得 ${e.got} 条` : `· 失败`}…`),
                    });
                if (seededRoots.ok && !seededRoots.skipped) {
                    setStatus(`正在开局：已从世界源起 ${seededRoots.seeded} 条根（${seededRoots.chunkCount} 块 · 候选 ${seededRoots.candidateCount} 人）…`);
                } else if (!seededRoots.ok) {
                    console.warn('[story-world-v2] 起根未成（照常开局）', seededRoots);
                    setStatus('注意：起根未成（照常开局，见控制台）——世界照旧可用，线头可在之后再补');
                }
            } catch (err) {
                console.warn('[story-world-v2] 起根异常（照常开局）', err?.message || err);
            }
            const had = Boolean(target);   // = 本次确实换掉了一个现存世界（守门那一步已经查过，这里只留痕）
            writeHotMeta(hotAccountShape(seed));
            await loadWorld();
            const flushed = await flushHotMeta();   // leg20 语义：落盘后才报成功
            void had; void playerFinal;
            const tk = r.timing || {};
            const tsec = tk.ms == null ? null : Math.round(tk.ms / 1000);
            // ★leg144：命中书指纹缓存时**没有 `timing`** ⇒ 必须**如实说**"这本书刚抽过、直接复用了上次的设定"，
            //   而不是留空让人以为"这次抽得飞快"（本仓禁的那一类：说得比做的好听）。
            const extractNote = r.cached
                ? ' · 这本书刚抽过，直接复用了上次的设定（零调用）'
                : (tsec == null ? '' : ` · 抽取 ${tk.calls || 0} 次调用 ${tsec} 秒`);
            setStatus(`新世界已就绪「${src.worldName || '未名世界'}」（${(seed.entities || []).length} 个名号 · ${seed.context.positions.length} 个地点 · 你=${piece.name} · 源=${src.label}${src.truncated ? ' · 源已截断' : ''}${extractNote}）${flushOutcomeText(flushed)}`
                + (r.settingReport?.empty ? ' · 注意：未抽到全局设定，详情见调试台「设定抽取」' : ''));
        } catch (err) {
            setStatus(`注意：初始化失败：${err?.message || err}`);
        }
    });

    // 面板按钮写的是 `clear-evolution`（render.js §参数/设置页那个"清除演化层"按钮）——
    //   与 `reset-dynamic` 同一动作，两个名字都接上（同上：防"按钮画了没人接"）。
    bus['clear-evolution'] = (payload, event) => bus['reset-dynamic'](payload, event);

    bus['reset-dynamic'] = async () => {        try {
            const meta = readHotMeta();
            const world = meta ? loadHotAccount(meta) : null;
            if (!world?.context?.setting?.dynamic) { setStatus('注意：还没有世界（无演化层可清）'); return; }
            // ★★★leg46 续（本轮查出来的**真缺陷**，用户症状的一个真来源）：
            //   `resetDynamicLayer()` 的结构是 `dynamic: { tension, env: {}, derivedFrom: [] }` ——
            //   它把 `env` **清成空表**（那是 leg26 之前"四个数值环境量"的设计遗产）。
            //   而**引擎读档位读的就是 `dynamic.env`**（`pack.js` 进包 / `limits.js` 当闸）⇒
            //   按一下这枚按钮，引擎眼里玩家的档位当场"回归默认"，直到下一次载入才被真源镜像补回来。
            //   旧状态条还写着「参数档位保留」——**说得比做的好听**（本仓禁的那一类）。
            //   ⇒ 定稿：清完**立刻把玩家档位镜像补回去**（真源才是档位的家，清演化层不许碰它），
            //     并让状态条如实报"补回来几个"。★补的只有**玩家输入**（`playerInputs`）——
            //     因变量（民生度/动乱度）是**世界的结果**，这一枚按钮清的正是引擎算出来的那一层，
            //     把它们搬回来就会"清了又被填回去"（判据 ⑫b 当场抓红过这一版）。
            const carried = paramApi.playerInputs(world);     // 清之前在手上（只读，不改世界）
            world.context.setting = resetDynamicLayer(world.context.setting);
            const dyn = world.context.setting.dynamic;
            world.context.setting = { ...world.context.setting, dynamic: { ...dyn, env: { ...carried } } };
            const rot = await ensureChronicleRotated(world);
            LISTED_VOLUMES = await listOldVolumes();
            refreshWorld(rot.hot, { oldVolumes: LISTED_VOLUMES });
            if (!rot.ok) {
                setStatus(`注意：${rot.error}——演化层已在内存清掉、盘上没写（可重试）`);
                return;
            }
            const flushed = await flushHotMeta();
            const n = Object.keys(carried).length;
            setStatus(`演化层已清（张力重算 · 卷库不动）· 参数档位 ${n ? `${n} 个原样保留并已同步给引擎` : '本来就没设过'}${flushOutcomeText(flushed)}`);
        } catch (err) {
            setStatus(`注意：清演化层失败：${err?.message || err}`);
        }
    };

    // ---------- leg46 续：参数自检（**把取证做成一枚按钮**）----------
    // 用户令「老问题没解决，还是会回归默认」之后的这一棒：前七轮缺的**从来不是补丁，是读数**。
    // 这枚按钮一次给出五个决定性读数（主路键名/原文/能不能写 · 世界名与桶键 · 真源 · 引擎镜像 ·
    // 真源与镜像不一致的键），并尽量拷进剪贴板 ⇒ 玩家不用开控制台。
    bus['param-doctor'] = async () => {
        const ev = paramApi.gatherParamEvidence();
        const text = paramApi.paramEvidenceText(ev);
        console.info(text);
        let copied = false;
        try {
            if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(text); copied = true; }
        } catch (_) { copied = false; }
        const bad = Object.keys(ev['真源'] || {}).filter((k) => (ev['账上镜像'] || {})[k] !== ev['真源'][k]);
        const head = ev['主路有没有这一格']
            ? `参数自检：真源 ${Object.keys(ev['真源'] || {}).length} 个键`
                + `${bad.length ? ` · 注意：有 ${bad.length} 个没同步给引擎（${bad.join('、')}）` : ' · 引擎镜像一致'}`
                + `${ev['主路能写'] === false ? ' · 注意：本地存储**写不进去**' : ''}`
            : '参数自检：注意：本地存储里**没有**参数这一格（写没落下去，或被清了）';
        setStatus(`${head} · ${copied ? '读数已复制到剪贴板，直接粘给我' : '读数已打进控制台（Console）'}`);
    };
}

function bindActions() {
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    // ★★★leg107：点击委托那一段（注入开关早退 / `.sw2-goto` 早退 / 拼 payload / 派发）
    //   **整段搬进 `web/action-router.js`**，连同 leg89 那段定案说明一起（避免第二份真相）。
    //   本处只剩这一句装配：模块顶层零 DOM，判据能在 Node 里真点一下（`test/action-router.test.js`）。
    createActionRouter({ win, dispatch: dispatchAction, toggleInject: sw2ToggleInject }); bindSettingReader(win); bindPageSubtabs(win); panelTools.bind(win);
    // ★细案实体页：搜索框（`#sw2_ents_q`）走 input 通道——`refreshSections` 换掉 innerHTML 会**夺焦点**，
    //   ⇒ 重绘后必须把焦点与光标还回去（不还，用户打到第二个字就掉焦点——这是"面板抢玩家的手"的另一种形态）。
    // ★★终审 C1：**中文输入法（IME）组合期一律不许抢 DOM**。
    //   事件真相：组合期间浏览器照旧对 `<input>` 派发 `input`（`e.isComposing === true`），而上面那句
    //   重绘会把**搜索框那一个节点整个换掉** ⇒ 组合会话被当场打断：玩家用拼音打「东海浮空岛」，
    //   打到第二个字就没了（这正好打在用户验收第③步上）。
    //   ⇒ 处置（照本仓既有的"别抢玩家的手"口径，最小改动）：①组合期 `input` 进门**先早退**
    //     （不写状态、不重绘）；②`compositionend` 才把**整串**落成 `sw2EntsView.q` 并**补一次重绘**。
    //   ★**不用防抖/定时器绕**：那会把"打字时列表滞后"引进来（新的、更难解释的病），且与本笔"最小改动"不符。
    //   ★标志是**模块级** `let`（下面两支监听要共享它；挂在函数里等于没有）。
    //   ★判据走源码锁（`test/render.test.js` 的"终审 C1"那条，自带反向自证）——IME 组合序列在 Node 里
    //     造不出真序列，而这段护栏的可观察效果"不发生一次重绘"要真 DOM + 真世界对象才看得见。
    win.addEventListener('compositionstart', (e) => {
        if (e.target?.closest?.('#sw2_ents_q')) viewState.setEntsComposing(true);
        if (e.target?.closest?.('#sw2_ch_q')) viewState.setChronicleComposing(true);
    });
    win.addEventListener('compositionend', (e) => {
        const q = e.target?.closest?.('#sw2_ents_q');
        const cq = e.target?.closest?.('#sw2_ch_q');
        if (cq) {
            // ★leg50 编年页搜索框：与实体页那一支**逐字同款**（同一个病、同一副药——
            //   "重绘把搜索框节点换掉 ⇒ 中文输入法组合被当场打断"）。
            viewState.setChronicleComposing(false);
            const caret = cq.selectionStart;
            // ★leg79/81：视图对象**就地写**（`viewState.chronicle().field = …`）——**不许绑进变量**：
            //   绑了它，`reset()` 一换绑定，这些就地写就落到**被丢弃的旧对象**上（面板"点了没反应"，且不抛错）。
            viewState.chronicle().q = String(cq.value || '');
            viewState.chronicle().page = 1;        // 换搜索词必回第一页（同筛选）
            refreshSections(['chronicle']);
            const again = win.querySelector('#sw2_ch_q');
            if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
            return;
        }
        if (!q) return;
        viewState.setEntsComposing(false);
        // 组合结束 = 补一次**正常的提交**（组合期一次都没提交过）；四步与下面 input 那支同形。
        const caret = q.selectionStart;
        viewState.entities().q = String(q.value || '');
        viewState.entities().page = 1;             // 换搜索词必回第一页（同筛选）
        refreshSections(['entities']);
        const again = win.querySelector('#sw2_ents_q');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
    });
    win.addEventListener('input', (e) => {
        // ★C1 护栏：组合期**在改状态与重绘之前**早退（这两样都会把组合打断）
        if (e.isComposing || viewState.anyComposing()) return;
        // ★leg50 编年页搜索框（同款四步）
        const cq = e.target?.closest?.('#sw2_ch_q');
        if (cq) {
            const caret = cq.selectionStart;
            viewState.chronicle().q = String(cq.value || '');
            viewState.chronicle().page = 1;
            refreshSections(['chronicle']);
            const again = win.querySelector('#sw2_ch_q');
            if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
            return;
        }
        const q = e.target?.closest?.('#sw2_ents_q');
        if (!q) return;
        const caret = q.selectionStart;
        viewState.entities().q = String(q.value || '');
        viewState.entities().page = 1;             // 换搜索词必回第一页（同筛选）
        refreshSections(['entities']);
        const again = win.querySelector('#sw2_ents_q');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
    });
}

function bindTabs() {
    const win = document.getElementById(WINDOW_ID);
    if (!win) return;
    const tabs = [...win.querySelectorAll('.sw2-tab')];
    const views = [...win.querySelectorAll('.sw2-view')];
    for (const tab of tabs) {
        tab.addEventListener('click', () => {
            const view = tab.getAttribute('data-view');
            for (const t of tabs) t.classList.toggle('sw2-active', t === tab);
            for (const v of views) v.classList.toggle('sw2-active', v.id === `sw2_view_${view}`);
        });
    }
    document.getElementById('sw2_window_close')?.addEventListener('click', closeWindow);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeWindow();
    }, true);
}

function initPanel(ctx) {
    if (typeof window === 'undefined') return;
    if (window[NAMESPACE]?.loaded) return;
    window[NAMESPACE] = { loaded: true, version: VERSION };
    injectCss(CSS_VERSION);   // ★leg109：号仍在上面那一处（判据按本文件的 `const CSS_VERSION = '…'` 取值），只是"拼进地址"那一步搬进了模块
    modalBoost();
    window.addEventListener('error', reportWinError);
    window.addEventListener('unhandledrejection', reportWinError);
    installRuntimeDiagnostics(window);
    ensureWindow(ctx).then(() => {
        bindTabs();
        bindActions();
        modelChannel?.bindSettingsForm?.(); // K36：设置表单写通道（extension_settings）★leg142 起住 web/model-channel.js
        loadWorld().catch((err) => {
            // ★★★leg48：**这里原来是一个空函数 `.catch(() => {})`** —— 载入路的一切失败都被它吞掉。
            //   它的代价被记在案（用户报"改档位回默认"十二轮）：那十二轮里，**"世界到底载入成没成"
            //   这件事在玩家与维护者两边都不可见**（控制台一个字没有、界面上照旧画那一屏）。
            //   ⇒ 定稿：**吞错可以（不许因为载入失败把面板打挂），但必须出声**，而且说清"后果是什么"。
            console.warn('[story-world-v2] 载入世界失败（面板照常可用，参数照常能改能存；'
                + '只是"引擎那一格"与世界镜像要等下次载入补上）：', err);
            setStatus(`注意：世界载入失败：${String(err?.message || err)}——参数照常能改能存（引擎那一格下次载入补）`);
        });   // 首次打开即载入热账（缺世界则空态提示）
        setupAsyncTicks(ctx); // K36：回合钩子（MESSAGE_RECEIVED 推进 / CHAT_CHANGED 重载）
    });
    ensureWandEntry();
}

// 启动：ctx 就绪即挂（DOMContentLoaded / ST 就绪事件双保险）
(function boot() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const start = () => {
        const ctx = getCtx();
        if (ctx) initPanel(ctx);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
        if (!window[NAMESPACE]) window.addEventListener('SillyTavernReady', start, { once: true });
        if (!window[NAMESPACE]) window.addEventListener('APP_READY', start, { once: true });
    }
})();

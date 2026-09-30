# 交接 · 第八十棒（leg79）：**丙-web 第四格「视图态族」已搬进 `web/view-state.js`**

> **接手第一件事：读这份。** 本棒把**编年页/实体页的视图态**（两份视图对象 + 两枚词表 + 两个复位
> + 两个组合期标志）整族搬出接线层。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 `read`/`edit`/`write`）；**行数/字节数一律用 `node -e`**。
> ⚠ **本仓是 monorepo**，git 根 = **`F:/deepseek/plugins`**；跑 git 一律 `git -C F:/deepseek/plugins`。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）。
> ⚠ **真机位 = junction** ⇒ 改仓即改实机（本棒**纯搬迁、可见面零变化**，不必看界面）。
> ⚠ 上一棒（leg78）搬的是**热账族**，它立的"六位置逐字节抽取"与本棒的"四处抽取"是同一种形态——
> 见 `docs/session-handoff-2026-09-20-leg78.md`。

---

## 0. 一句话

**视图态族（`sw2ChronicleView`/`sw2EntsView` + 两枚词表 + 两个复位 + `sw2ChronicleComposing`/
`sw2EntsComposing`）整族搬进新建的 `web/view-state.js`**；接线层只经**受控口**够到它；
`web/index.js` **3107 → 3079 行**。

⇒ 读数：**`node --test` 977/977**（接手 969，**+8** 条判据）· 冒烟 **8231 字节未变** ·
`world` 哈希 **`5fe7b698…` 未变** · import 环 **4 条未变** —— ★**四条全部逐字节不变**
（纯搬迁的硬判据）。`PANEL_BUILD` **未动**（可见面零变化 ⇒ 不必看界面）。

---

## 1. 本棒做了什么（施工结果）

| 项 | 值 |
|---|---|
| 新模块 | **`web/view-state.js`（113 行 · ★只 import `../src/render.js` 一条）** |
| 接线层 | `web/index.js` **3107 → 3079 行**（−28） |
| 新判据 | **`test/web-view-state-layout.test.js`（343 行 · 8 条）** |
| 搬法 | ★**四位置逐字节抽取**（编年视态块 / 编年组合期 / 实体视态块 / 实体组合期） |

### 1.1 搬进新家的东西

- **状态（8 个）**：`sw2ChronicleView` · `sw2EntsView` · `SW2_ENTS_KINDS` · `SW2_ENTS_FILTERS`
  · `sw2ChronicleComposing` · `sw2EntsComposing` + 两个复位函数 `sw2ChronicleViewReset`/`sw2EntsViewReset`
- **工厂**：`createViewStateHub()`（★**零 deps**：本族谁也不调，比热账族还叶子）
- **受控口（19 个）**：`chronicle()` · `entities()` · `views()` · `resetChronicle()` · `resetEntities()`
  · 编年六口（`setLayer`/`setClosed`/`setRange`/`setChronicleScope`/`turnChroniclePage`）
  · 实体六口（`applyEntsFilter`/`setEntsSort`/`setEntsGroup`/`turnEntsPage`/`setEntsScope`）
  · 组合期三口（`setChronicleComposing`/`setEntsComposing`/`anyComposing`）

### 1.2 **没搬**的（两条缝，逐条有理由）

| 缝 | 留在哪 | 为什么 |
|---|---|---|
| `sw2LastWorld`（+ `let sw2LastPicks`） | 接线层 | ★**夹在本族两段中间**（块 791–797 与 805–814 之间），但**不属于视图态语义**——它是"面板正在渲染的那一份世界"，且连着 leg73 快照 hub 的两个取数口 ⇒ 动它 = 同时动快照族（违反"一棒一族"） |
| `refreshSections` / `renderAll` | 接线层 | 重绘通道是**接线层**的东西；新家只交视图对象（消费点照旧在接线层） |

---

## 2. ★★★本族特有的形态：**视图对象「按值取」，不许「抓死」**

这与 leg78 那条"跨族调用点归属"、leg73 那条"迟到注入"**都不同**，是本族独有的：

```
接线层那 30 多处消费点是**就地对视图对象写**：view.layer = v / view.filters.push(v) / view.page += 1
而 reset() 换的是**模块级绑定**（sw2EntsView = makeEntsView()）
```

⇒ 谁把视图对象**抓进一个变量**，复位之后那些就地写就落到**被丢弃的旧对象**上：
**不抛错、不报警**，玩家的点击照旧执行、照旧重绘，只是写进了一份谁也看不见的对象
⇒ 面板上看起来就是"**点了没反应**"（本仓最忌的"面板抢玩家的手"的**静默版**）。

★定稿口径：**受控口返回"当前那一个对象"，消费点就地写**——判据⑪因此写成：
> 接线层里 `const|let|var x = viewState.chronicle()` 这种写法**一处都不许有**（必须 `viewState.chronicle().field = …`）

★这一条是**可机械检查**的（不是"注意点"）：本棒为此把四条监听里的中间变量全改成链式直写。

---

## 3. ★★三处踩坑（下一棒必读，都是"判据自己写窄了/写错了"）

### 坑①（最贵）：`if\s*\(([^)]*)\)` 这个条件正则会**跨语句乱配**
本族把"两个标志"合成一口 `anyComposing()` 之后，护栏那一行长这样：

```js
if (e.isComposing || viewState.anyComposing()) return;
```

原来的条件正则 `\(([^)]*)\)` 在**内层 `(`** 上截断、又配上了**后面另一条语句**的 `)` ⇒
抓着"条件"去 `includes('anyComposing')` **永远为假** ⇒ 判据**假红**。
★修法：换成**真正配对括号**的扫描器（遇到 `(` 就嵌套计数，取与 `if (` 同层级的 `)`）。
★这条比 leg71 §4.1"被注释骗"更隐蔽：那次是注释里有符号名，这次是**正则把条件切短了**。

### 坑②：注释里写出 `if (...)` 形状 ⇒ 判据当场红
我在 `input` 监听上方写了一句解释，里面出现 `if (e.isComposing || viewState.anyComposing())` 的**字样**
⇒ 那个"配对括号"扫描器先命中了**注释里的那一条**（它在真护栏**之前**）⇒ 判据红。
★纪律：**护栏的判据按"第一条命中"取**时就要求注释里不许出现同形文本——
本仓这是**第五次**"判据被注释骗"，这次是"被自己刚写的注释骗"。

### 坑③：同进程里"初始化那一次"**观察不到**
视图态是**模块级**的；`node --test` 同一个文件里的用例**共享模块实例** ⇒
只要前面任何一条用例调过一次 `resetEntities()`，后面读到的是**复位路径**的产物。
★实拍：变异"初始化时与 `ENTS_DEFAULT_VIEW.filters` 共用同一个数组"**一路全绿**。
★修法：**初始态另起进程量**（本棒判据⑮用 `execFileSync(node, ['--input-type=module','-e',probe])`）。
⇒ ★一般规律：**"模块级状态 + 同进程多用例"= 初始化路径容易被前一条用例掩盖**，要单独量。

---

## 4. 三条设计决定（都写在代码里，别改回去）

### ① 词表与"回第一页"两条规矩**跟状态同住一处**
原先"`['all','event','book'].includes(v)`"与"`page = 1`"写在接线层的 bus 动作里，
而词表 `SW2_ENTS_KINDS`/`SW2_ENTS_FILTERS` 写在状态旁边 ⇒ **状态一个家、规矩另一个家**。
定稿收进 hub：`setLayer/setClosed/…`、`applyEntsFilter`（★返回 `false` = 词表不认 ⇒
接线层据此一个字都不动，与原先的 `else-if` 同义）。接线层只剩"派发 + 重绘"。

### ② 组合期标志**随族搬走**（不是留在接线层）
它是搜索框的**写入闸**（组合期一律不写 `q`、不重绘）⇒ 与"那份视图态"是同一件事的两半。
接线层走 `setEntsComposing()`/`setChronicleComposing()` 写、`anyComposing()` 读。
★判据咬"接线层**不许留镜像**"（`sw2EntsComposing = true` 那种直写 = 两份真相）。

### ③ `views()` 一口交齐两个视图对象
接线层那两处渲染调用点（`renderWindow` / `refreshSections`）原先各写一遍同样的字面量
`{ chronicleView: …, entsView: … }` ⇒ 收成一口。★判据咬**键名一个不差**（`renderAll` 按这两个键取视态）。

---

## 5. 交接状态与读数

| 项 | 现值 |
|---|---|
| `node --test` | **977 / 977**（fail 0 · skipped 0）（接手 969 ⇒ **+8**：新建 8 条结构/行为判据） |
| 冒烟 | **8231 字节 · PASS · 警告 0**（★逐字节未变） |
| 行为哈希 | `world` `5fe7b698dee8d9e891e82197691b884b0445dbad9a480f5cabf1c7c48d152a38`（★未变） |
| import 环 | **4 条**（★未变） |
| `PANEL_BUILD` | `leg76-roster-batch-pull`（★**未动**：纯搬迁、可见面零变化） |
| 分支 | monorepo `leg62-scales-concept-table` · ★本棒**未提交** |
| 实机位 | junction ⇒ 改仓即改实机（本棒**不需要看界面**的验收） |

### 本棒动过的文件

| 类 | 文件 |
|---|---|
| 生产 | **`web/view-state.js`（新建）** · `web/index.js`（四处抽取 + 建 hub + 消费点改受控口） |
| 判据 | **`test/web-view-state-layout.test.js`（新建 · 8 条）** · `test/render.test.js`（★**两条跨文件锁改指新家**，见 §6） |
| 文档 | `docs/session-handoff-2026-09-20-leg79.md`（本文件） · `docs/START-HERE.md` |
| 注释 | `src/render.js`（两处"接线层的 `sw2XxxView`"改成"`web/view-state.js` 的"） |
| 装置 | `F:/deepseek/tmp/leg79-*.mjs`（仓库外：抠段夹具 / 逐字节自证 / 十二段咬合 / 值等价 / 若干诊断） |

### ★★关于"可见面零变化"的**对照物选错**（如实留档）

本棒第一版想照 leg71/73 惯例用 `git archive HEAD` 那棵树比渲染产物 —— **那是错的**：
HEAD = `e992562`（leg69 收尾），而工作区里压着 **leg72～leg78** 的未提交改动
⇒ 两棵树差 8 棒，产物当然不同（那与"本棒有没有改可见面"**无关**）。
★**纯结构搬迁的正确对照物是"消费者那一层"**：视图态的形状与默认值由 `src/render.js` 的
`makeChronicleView()`/`makeEntsView()` **唯一定义** ⇒ 判据⑭用**真跑一遍**钉住：
`hub.chronicle()`/`hub.entities()` **逐字节等于**那两个工厂的产物、且经 hub 喂 `renderAll`
与直接喂默认值**产物逐字节相同**（另加反向对照：换个筛选档 ⇒ 产物**真的变**，防空绿）。

---

## 6. ★★两条跨文件锁已改指新家（下一棒若再动这一族，两条要一起看）

`test/render.test.js` 里那两条锁**必须**跟着符号走（本棒改动**只针对"家在哪个文件"，
口径一个字没放宽）：

| 原锁 | 现锁 | 口径有没有变 |
|---|---|---|
| `★终审 C1`：`/^let sw2EntsComposing = false;$/m` 钉在 `web/index.js` | 钉在 **`web/view-state.js`**，并**加**一条"接线层不许直写标志" | ★没放宽，**加严** |
| `★终审 C1`：护栏条件里判 `sw2EntsComposing`/`sw2ChronicleComposing` | 判 `viewState.anyComposing()`（两标志合成一口） | ★没放宽：**"早退必须排在改状态与重绘之前"**那条顺序口径原样保留 |
| `★终审 M10`：接线层 `import[^;]*makeEntsView` + `makeEntsView()` **恰好 2 处** | **掰成两半**：新家 `import` 工厂 + 恰好 2 处；接线层**不许再 import 那两个工厂** | ★没放宽，**加严**（多锁了一条"接线层不许自己造视图态"） |

★顺带留档：`hasCompositionGuard` 那个辅助函数**参数化了词表**（默认值仍是实体页那一套），
`hasChronicleGuard` 现在也走它——两条判据共用一份"顺序"口径。

---

## 7. 下一棒正事（丙-web 还剩**两族**）

**查书补字段族 → 参数族**

### ★★ 查书补字段族：**表已过期，必须先自重量**
leg72 §3-A 那张表把它列成 ≈150 行，而它的清单里**一半已被 leg76 删掉**
（`batchTaskStatus`/`startBatchTask`/`stopBatchTask`/`batchStatusText`/`runBatchChunk`/`planBatchesLazy`）
⇒ **做之前必须自己量**（用 §8 的探针，改三张表即可）。

### ★ 参数族（放最后）
`paramHub` 一族 + `sw2ParamBusy`/`sw2SetParamControl`/`sw2SetParamCell`/`sw2SyncParamCells`/
`sw2CollectLiveParamValues`/`gatherParamEvidence`；★剩下多是**视图重绘**（与 `refreshSections` 耦合）。
★注意：参数族的**复位**早已被 leg78 用"甲案"拆开（接线层的 `sw2ResetFlushState` 是**组合器**）
⇒ 那一棒留下的干净切口正是给这一族用的。

### ★ 别忘了
- **leg75 的那条**：老快照恢复会把 `文风禁令/变量指令/其他` 带回来（形态：让 `restoreSnapshot` 走同一个迁移函数）；
- ★**本棒新登记的一条**：`web/view-state.js` 是**模块级单例**，"另起一个 hub"**不隔离**
  （判据⑭④把它钉住了）——下一棒若需要"干净的视图态"来测，**得调 `resetXxx()` 或另起进程**，
  别指望新 hub（本棒探针在这上面假红过两次）。

---

## 8. 装置（都在 `F:/deepseek/tmp/`）

| 脚本 | 干什么 |
|---|---|
| ★★`leg79-extract-parts.mjs` | 把**四个位置**抠成原文夹具（★全用**内容锚点**定位，找不到/不唯一就抛） |
| ★★★`leg79-move-proof.mjs` | **搬迁自证**：逐行断言"从原文抠出来的代码行逐字节出现在新家"+ 旧家逐符号归零 |
| ★★★`leg79-bite-probe.mjs` | **十二段咬合演练**（每条判据由**它自己那条**变异咬红；★每条都先自证变异真打上了） |
| ★★★`leg79-viewstate-equivalence.mjs` | **值等价**（= 渲染层默认值）+ 就地写/复位/hub 是把手不是容器（可跑，不是读数） |
| ★`leg79-diag-*.mjs` | 七处诊断（护栏正则 / 逐字节 / 假红归因 / 变异等不等价 / 初始态别名）——**踩坑的现场** |
| ★★`leg77-hotmeta-coupling.mjs` | **改三张表就能量下一族**（`FAMILY_FN`/`FAMILY_STATE`/`SIDE_CHANNELS`），直接算出"族符号落在几段" |

---

*第八十棒（leg79）· 2026-09-20 · 用户令「把优化架构剩下的做了」（丙-web 剩余族）
→ 照 leg78 §6 的顺序：**视图态族整族搬进 `web/view-state.js`**（四位置逐字节抽取）
→ ★★本族特有形态：**视图对象按值取、不许抓死**（抓死 ⇒ 复位后写到被丢弃的对象、面板"点了没反应"且不报错）
→ ★三处踩坑（正则跨语句乱配 / 注释里写出 `if (...)` / 同进程观察不到初始化那一次），都已修并写进判据
→ ★三条设计决定（词表与规矩同住一处 · 组合期标志随族走 · `views()` 一口交齐）
→ ★★"可见面零变化"的对照物**换了**（HEAD 那棵树差 8 棒 ⇒ 改用"真跑一遍"对渲染层的默认值）
→ 977/977 · 冒烟 8231 未变 · 行为哈希未变 · 环 4 条未变 · 接线层 3107→3079 行
→ 交接*

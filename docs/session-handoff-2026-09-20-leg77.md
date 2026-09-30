# 交接 · 第七十八棒（leg77）：**丙-web 第三格「热账族」的搬迁前复量**（本棒**未动代码**）

> **接手第一件事：读这份。** 本棒**不改一行生产代码**，只做一件事：
> 按 leg72/73 立的纪律，把**热账族**的耦合**自己重量一遍**（★leg72 §3-A 那张表已被 leg76 证明会过期）。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 `read`/`edit`/`write`）；**行数/字节数一律用 `node -e`**。
> ⚠ **本仓是 monorepo**，git 根 = **`F:/deepseek/plugins`**；跑 git 一律 `git -C F:/deepseek/plugins`。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）。
> ⚠ **真机位 = junction** ⇒ 改仓即改实机。
> ⚠ **本棒之前的 leg76 已收尾**（撤「补全全册实力」钮）——那一棒的交接见 `session-handoff-2026-09-20-leg76.md`。

---

## 0. 一句话

**热账族的真实形状与 leg72 §3-A 那张表**不一样**，而且差得不是一点** ⇒ 本棒把差在哪、怎么切、
有什么雷，逐条量清落档，**留给下一棒照着搬**（本仓纪律：一棒只搬一族，且搬迁前必须先自重量）。

⇒ 读数：`node --test` **964/964**（未动代码 ⇒ 与 leg76 同数）· 冒烟 **8231 字节** ·
`world` 哈希 **`5fe7b698…`** · import 环 **4 条**。

★★★**但"零代码改动"的自证不是这四条**（本棒当场纠正了自己的一个错判，如实留档）：
这四条读数**只覆盖 `src/`** ——
- `world` 哈希与冒烟都跑 `demo/smoke-demo.js` 的**夹具世界**，**`web/` 一个字都不经过**；
- `node --test` 会加载 `web/index.js`，但它只证明"能被加载/判据全绿"，**证不了"这个文件没被写过一个字节"**；
- import 环只扫 `src/`。
⇒ **真正的自证是文件写入时刻**（`node -e` 量 `mtime`）：本棒全部生产文件的最后修改时刻
**都早于本棒第一次写文档的时刻**（`web/index.js` = `15:42:39Z` · 最晚的生产文件 ·
本棒文档 = `15:50:24Z`）⇒ **本棒只写了两个 `.md`，生产代码零写入**。
★**纪律（下一棒做"纯测量/纯文档"棒时直接用）**：**"我没动代码"要用 mtime 证，不要用读数证**
——读数不变**不能**推出"接线层没被改"（leg76 的教训正是"改 `web/` 而引擎读数纹丝不动"）。

---

## 1. ★★★与 leg72 §3-A 那张表的三处不符（本棒实测）

| 项 | leg72 §3-A 写的 | **本棒实测** | 差异性质 |
|---|---|---|---|
| 规模 | ≈ **220 行 + 11 个模块级状态** | 族内顶层声明 **17 个**（9 个函数 + 8 个状态）· 真实行数**散在 6 段**（见 §2） | ★表低估了"散"、高估了"整" |
| 成员 | 把 `hotAccountShape` / `readHotAccount` 列进族内 | ★**这两个根本不是本文件的** —— 它们住在 **`src/storage.js`**（`:28` / `:41`），`web/index.js:14` 只是 import 进来 | ★表把**依赖**当成了**成员** |
| 状态 | 11 个 | 本文件里**热账自己的**状态是 **8 个**（见 §2 表） | 数字对不上，须以实测为准 |

★**教训（与 leg76 §1.3 同一条）**：**接口清单式的表会过期，且过期的方式是"把依赖记成成员"**。
⇒ 下一棒**不要照抄那张表去搬**，照本文件 §2 的实测清单搬。

---

## 2. 族符号的真实落点（★**六段，不连续**）

```
  388  function readHotMeta
  445  let    sw2HotMetaFlushing          ┐
  446  let    sw2HotMetaLastCallAt        │
  447  let    sw2HotMetaLastWriteAt       │  ← 热账状态段①（15 行）
  454  let    sw2HotMetaPendingWriteAt    │
  455  let    sw2HotMetaLastFlushOkAt     │
  456  const  hotMetaUnflushed            │
  461  let    sw2HotMetaFlushedCurrent    ┘
  ⋯⋯  ★463–618：**参数块**（leg46 的 paramHub 一族）住在中间 ⋯⋯
  650  function writeHotMeta
  719  export function sw2SetFlushTimeout ┐
  720  （sw2FlushTimeoutMs 的 setter）   │
  725  let    sw2FlushChain               │
  726  let    sw2FlushChainBusy           │  ← 热账核心段②（72 行，**最干净的一段**）
  738  const  SW2_SAVE_MIN_MS             │
  739  export function sw2ExplicitChatName│
  747  function sw2CallSaveChat           │
  759  function hotMetaSignatureOf        │
  767  function hotMetaFingerprint        │
  770  let    sw2HotMetaWrittenFp         │
  771  let    sw2HotMetaWrittenMeta       │
  784  function reassertWrittenMetaIfClobbered
  796  function flushHotMeta              ┘
  889  export function sw2ResetFlushState   ← 复位/簿记（★leg73 第三条纪律要求单独找的那个）
```

★★**关键结构事实**：**参数块（463–618）就夹在热账的两段之间**。
⇒ 热账族**不可能一次"整段搬"**（这一点与 leg72 记忆族、leg73 快照族**都不同**——那两族是连续块）。
⇒ 本族的搬法是**"抽取"而不是"剪切"**：从 6 个位置各取所需，**必须逐位置自证**。

---

## 3. 族外消费者（决定"要不要注入"、注入什么）

★按**引用它的顶层符号**聚合，实测 **20 个**：

| 消费者 | 用了族内几个 | 用了哪些 |
|---|---|---|
| `lookupOneEntity` | 5 | `readHotMeta` `sw2LastWorld` `writeHotMeta` `hotAccountShape` `flushHotMeta` |
| `sw2ParamBusy` | 5 | 同上（换 `hotAccountShape`/`flushHotMeta`/`sw2LastWorld`） |
| `advanceTick` | 4 | `readHotMeta` `writeHotMeta` `hotAccountShape` `flushHotMeta` |
| `loadWorld` | 4 | 同上 |
| `sw2UndoParam` | 3 | `readHotMeta` `writeHotMeta` `hotAccountShape` |
| `sw2WriteHotMetaEnsuringParams` | 2 | `writeHotMeta` `hotAccountShape` |
| `snapHub` | 2 | `readHotMeta` `flushHotMeta` |
| `renderCfg` | 2 | `readHotMeta` `sw2LastWorld` |
| `sw2CollectLiveParamValues` / `sw2SetParamControl` | 各 2 | `readHotMeta` `sw2LastWorld` |
| `ensureChronicleRotated` | 2 | `writeHotMeta` `hotAccountShape` |
| 其余 9 个（`refreshWorld`/`gatherParamEvidence`/`sw2ParamDiag`/`getLastWorld`/`setLastWorld`/`refreshSections`/`setupAsyncTicks`/`nextVolumeOfHotMeta`/顶层游离） | 各 1 | 多为 `sw2LastWorld` 或 `readHotMeta` |

★**读法**：
- **读写口只有三个**（`readHotMeta` / `writeHotMeta` / `flushHotMeta`）⇒ 契约面很窄，**这是好消息**；
- **`hotAccountShape` 是真依赖**（13 处调用）——它已在 `src/storage.js`，**搬它不需要，也不许搬**；
- ★**`sw2LastWorld` 是最大的一根刺**（见 §4）。

---

## 4. ★★★三根刺（下一棒搬之前必须处理）

### 刺①：`sw2LastWorld` —— 被 §3 里半数消费者用着，且**声明在极后面**

```
  283   sw2LastWorld = world;                       ← 赋值（sw2OnMessageReceived 一带）
  938   function getLastWorld() { return sw2LastWorld; }   ┐ 快照 hub 的**取数口**
  939   function setLastWorld(w) { sw2LastWorld = w; }     ┘（leg73 立的 TDZ 规矩：必须是**函数声明**）
  969   let sw2LastWorld = null;   ← ★声明在这里（"K41：链视图入口持引用"）
  ⋯⋯ 另有 1549/1610/1625/1755/1788/1789/1893/1909/2757/2894 等十余处直接读写 ⋯⋯
```
★**它不在热账语义里**（它是"面板正在渲染的那一份世界"的引用），**本棒判定：不该跟热账族一起搬**。
⇒ 搬热账族**保留 `sw2LastWorld` 在原处**，族内若需要世界就走 §3 那条 `readHotMeta()?.world` 口径。
★**但**：`getLastWorld`/`setLastWorld` 是 leg73 快照 hub 的注入口 ⇒ **动它 = 同时动快照族**，
本仓纪律"一棒一族"⇒ **别碰**。

### 刺②：`sw2ResetFlushState` 跨了两族（热账簿记 **+** `paramHub.reset()`）

```
  889  export function sw2ResetFlushState() {
           sw2HotMetaFlushing = false; sw2HotMetaFlushedCurrent = false;
           sw2HotMetaLastCallAt = 0;  sw2HotMetaLastWriteAt = 0;
           sw2HotMetaPendingWriteAt = 0; sw2HotMetaLastFlushOkAt = 0;
           sw2FlushChainBusy = false;  sw2FlushChain = Promise.resolve();
           paramHub.reset();          ← ★★这一句是**参数族**的（leg46）
           sw2HubLastWorld = null;    ← ★★这一句也是参数族的
       }
```
★**它是被测试广泛使用的钩子**：`test/param-hub.test.js`（14 处）与 `test/set-param-persist.test.js` 都从
`../web/index.js` 取它 ⇒ **搬走它就要改测试的 import**（本仓"收缩导出面"的口径允许，但要知道代价）。
★**两个可选形态**（下一棒定，本棒不替你拍）：
- **(甲) 只搬热账那半** ⇒ 新模块导出 `resetHotLedgerState()`，`sw2ResetFlushState` 留在接线层当**组合器**
  （先调新模块的复位、再调 `paramHub.reset()`）⇒ ★**接线层仍导出同一个名字，测试一行不用改**；
- **(乙) 整条搬走** ⇒ 新模块要吃 `paramHub` 注入（形态同 leg72/73 的依赖注入工厂）⇒ 测试 import 改指向。
★**本棒倾向 (甲)**：它**不把两族的复位绑在一起**（正好为"参数族"那一棒留出干净的切口），
且**测试零改动**——但这是设计决定，写在这里给下一棒参照，不是既成事实。

### 刺③：`hotAccountShape` / `loadHotAccount` 已在 `src/storage.js`

★**它们是依赖，不是成员**（§1 那张表记错了）。搬族时**照旧 import 过来用**，**不许**在 `web/` 再抄一份。

---

## 5. 建议的切口（下一棒可直接照此施工）

| 项 | 建议 |
|---|---|
| **新模块名** | `web/hot-ledger.js`（与 `web/memory-store.js`（leg72）/`web/snapshot-store.js`（leg73）同族命名） |
| **搬什么** | `readHotMeta` · `writeHotMeta` · `flushHotMeta` · `hotMetaSignatureOf` · `hotMetaFingerprint` · `reassertWrittenMetaIfClobbered` · `sw2CallSaveChat` · `sw2ExplicitChatName` · `sw2SetFlushTimeout` · 8 个热账状态 · `SW2_SAVE_MIN_MS` · `SW2_FLUSH_TIMEOUT_MS` · 以及**热账那半的复位**（按刺②选甲就导出 `resetHotLedgerState()`） |
| **不搬** | `sw2LastWorld` + 它的两个取数口（刺①）· `paramHub` 一族（那是"参数族"那一棒的）· `hotAccountShape`/`loadHotAccount`（已是 `src/storage.js` 的） |
| **新模块的硬要求**（leg72/73 立，逐条沿用） | ①模块顶层**零 DOM** ②**不许 re-export** ③"声明在后面的状态"**只能注入取数函数**（TDZ 铁律：**不许用箭头**）④**产物必须"真 import 一次"**（`node --check` 查不出裸赋值与坏 export） |
| **依赖注入** | 族内需要 `getCtx()`（取 ST 上下文）与 `HOT_META_KEY` ⇒ 走**注入**（照 `createSnapshotHub(deps)` / `createParamHub` 先例），**不要**让新模块反向 import `web/index.js` |
| **判据形态** | 新建 `test/web-hot-ledger-layout.test.js`，照 `web-memory-layout` / `web-snapshot-layout` 两条同款：①符号只在**新家**定义、旧家不再定义 ②import 集合**不多不少** ③**八个状态只有一个家** ④**TDZ 铁律：取数口不许是箭头** ⑤接线层真的变薄 |
| **四条硬读数** | `node --test` 全绿 · 冒烟 **8231 字节逐字节未变** · `world` 哈希 `5fe7b698…` **未变** · import 环 **4 条**（本族是纯搬迁 ⇒ **这四条都必须逐字节不变**，变了就是搬错了） |

★**搬法纪律（本族特有，因为它是"六段抽取"而不是"整段剪切"）**：
**每个位置各写一条自证**（`head+块+tail` 逐字节拼回原文）——leg73 §4.1 那条教训在这里**更**适用：
"比我自己拼出来的产物"是**假自证**，必须**字节级往返 + 逐行归因**。

---

## 6. 待办（按优先级）

### ★★ A. 本棒的正事（下一棒第一动作）

**照 §5 把热账族搬进 `web/hot-ledger.js`**，然后按 order 接着做 **视图态族 → 查书补字段族 → 参数族**。

★★**注意 leg72 §3-A 那张表**已被本棒与 leg76 证明**有两处过期**（本棒 §1 · leg76 §3-C）：
- **查书补字段族**：表里 ≈150 行，其清单里**一半已被 leg76 删掉**（`batchTaskStatus`/`startBatchTask`/
  `stopBatchTask`/`batchStatusText`/`runBatchChunk`/`planBatchesLazy`）⇒ **做那一族前必须自己重量**；
- **热账族**：见本棒 §1。

### ★ B. 视图态族是最小最干净的一格（≈40 行，可作"热身"）

`sw2ChronicleView` / `sw2EntsView` + 它们的 reset + 两个白名单 Set。
★bus 里只有 `ch-*`/`ents-*` 用它 ⇒ 消费者面最窄。

### ★ C. leg75 / leg76 留下的两条（未动）

- **老快照恢复会把那三类带回来**（`restoreSnapshot` 不跑载入期迁移）⇒ 形态：让 `restoreSnapshot` 走同一个迁移函数；
- ★★**请用户点一次「只重抽设定」**验 leg75 抽取侧的硬禁令；★**顺带看一眼「角色与势力」页**验 leg76 撤钮。

### ★ D. 「重抽名册」——用户问过、**已明确不做**（leg76 §3-A）

用户原话「**没事**」⇒ **不做**。★若将来要做，依据已备：接口**可直接复用**
（`autoComposeSource()` + `extractWorldSetting()`，初始化与「只重抽设定」已经在共用），
缺的是 ①`rosterOnly` 开关（与 `skipRoster` 对称）②小书单发通道（≤30000 字符）的旁路
③★**真正的难点：名册增量并入的安全策略**（同名只补空字段、绝不重建、绝不覆盖已有值）。
★★**硬锁**：`test/adopt-scale-draft.test.js:296` 锁着"只重抽设定照旧走生产管线"、
`scales-concept-table.test.js` 锁着"直抽那条路上不许出现 `extractWorldSetting`" ⇒ **必须另起 `bus[...]` 动作**。

### ★ E. 旧待办（沿用，未动）

乙-2（`settleTick` 显式阶段化，高风险、单独细案）· A2 真修（书声明面 → `declaredParent`，要报批）·
leg70 两格（草稿跨刷新仍会丢 · `extractedAt` 语义被放宽）· A1/A4 · `INIT_SOURCE_HARD_CEILING` ·
366 条人物档案 · 题名面精度 · `chunkRows` 抹行首空白 · 实教账 `S~E级` 那 5 条 · 日期被抽象成角色 ·
**`实力` 栏错位** · 发布面没推（要吃 leg71～leg77 得单独发版）。

---

## 7. 我（leg77）犯过的错 / 本棒的方法留档

1. **★本棒是"零代码改动"的纯测量棒——这在本仓是**允许且必要**的一格，但它**没有"读数自证"可依靠**。**
   我第一版在 §0 写的是"四条读数逐字节不变 = 零代码改动的自证" ⇒ ★**那是错的**：
   这四条**只覆盖 `src/`**（冒烟与行为哈希走夹具世界、`web/` 一个字不经过；环只扫 `src/`）。
   定稿改成**量 mtime**（本棒全部生产文件的 mtime 都早于本棒写文档的时刻）——那才是真凭据。
   ★**纪律**：**"我没动 X"要用"X 的 mtime"证，不要用"别处的读数没变"证**（那是两回事）。
   ★顺带一个真教训：**探针本身也会污染判断**——第一版探针把 `hotAccountShape` 当成族内定义去文件里找
   ⇒ 报"没找到"；若不追下去就会写出一张错的表。
   ★**纪律：探针报"找不到"时，先分清"真不在"与"我的符号表写错了"**（本棒当场追出"它们住在 `src/storage.js`"）。

2. **★符号普查的"顶层声明"判据会漏掉 import 进来的名字。**
   我的探针只扫 `/^(?:export\s+)?(?:async\s+)?(function|let|const|var|class)/` ⇒ **import 绑定天然不在里面**。
   而 leg72 那张表正是**把 import 当成了本地定义**。⇒ **纪律：清单里有、普查里没有的名字，
   第一件事是 `grep` 它在**别的模块**是不是 export——别急着说"名字写错了"。**

3. **★"侧面通道"这一条（leg73 立的）本棒又验了一次它的价值。**
   光按"热账"两个字找，会得到 3 个函数；照纪律把"复位/簿记"单独找一遍，
   才挖出 `sw2ResetFlushState`（它**跨了两族**，是下一棒最大的决策点之一）。
   ⇒ **纪律沿用：每族普查都必须单独问一句"这一族的复位/簿记/开关在哪"。**

---

## 8. 装置与坑

### 8.1 本棒新增装置（`F:/deepseek/tmp/`）

| 脚本 | 干什么 |
|---|---|
| ★★`leg77-hotmeta-coupling.mjs` | **热账族耦合复量**（族符号落点 / 族外消费者按顶层符号聚合 / 块连续性 / 副作用面）——**改一个符号表就能量下一族** |

★**它比 leg73 那两个探针多了一格**：把"族符号落在**几段**"直接算出来（本棒靠它才发现"六段不连续"）。
⇒ **下一棒量视图态族/查书补字段族/参数族时直接改 `FAMILY_FN`/`FAMILY_STATE`/`SIDE_CHANNELS` 三张表。**

### 8.2 坑（沿用）

- 含中文的文件一律 `read`/`edit`/`write`；行数/字节数一律 `node -e`；**别与 PowerShell 量的历史数字比**；
- `git show HEAD:… > file` 会写成 **UTF-16**；回退**永远不要 `git checkout --`**；
- ★**"某个符号还在不在"要剥注释后再判**（leg76 §4.2 那次假红）；
- ★**`import { … }` 花括号里一律不写注释**（leg74 §4.1）；
- ★**演练"没咬住"按顺序问三句**：变异打上了吗 → 等不等价 → **最后**才问是不是判据瞎了
  （leg74 立、leg75 踩、leg76 再踩 ⇒ 请当硬规矩）。

---

## 9. 验收基线（本棒收尾实测 · ★全部与 leg76 逐字节相同）

| 项 | 现值 | 怎么来的 |
|---|---|---|
| `node --test` | **964 / 964**（fail 0 · skipped 0） | ★实测（本棒零代码改动 ⇒ 与 leg76 同数） |
| 冒烟 | **8231 字节 · PASS · 警告 0** | ★实测（**逐字节未变**） |
| 行为哈希 | `world` `5fe7b698dee8d9e891e82197691b884b0445dbad9a480f5cabf1c7c48d152a38` | ★实测（**未变**） |
| import 环 | **4 条** | ★实测（**未变**） |
| ★**零改动的真凭据** | 全部生产文件 mtime **早于**本棒写文档时刻（`web/index.js` `15:42:39Z` 最晚 · 文档 `15:50:24Z`） | ★实测（**§0 那条纠正**：上面四条读数证不了这个） |
| `PANEL_BUILD` | `leg76-roster-batch-pull`（**未动**——本棒没碰可见面） | 沿用 |
| `VERSION` | `1.0.0`（未动） | 本棒没动 |
| 分支 | monorepo `leg62-scales-concept-table` | ★本棒**未提交**（见 §10） |

★**本棒不需要"看界面"的验收**（看不到任何可见面变化）⇒ 真机验收沿用 leg76 §6 那四条。

---

## 10. 交卷状态（本棒**未提交** · 下一棒第一动作）

| 项 | 值 |
|---|---|
| 分支 | monorepo `leg62-scales-concept-table`（git 根 `F:/deepseek/plugins`） |
| 本棒 | ★**未提交**；★**生产代码一个字没动**——只新增本文档 + `START-HERE.md` 一处入口 |
| ⚠ 提醒 | `git status` 里会**同时**看到 leg70～leg77 的改动叠在一起——**别把别人的改动当成自己的** |

**本棒实际动过的文件**：

| 类 | 文件 |
|---|---|
| 生产 | ★**无**（本棒零代码改动） |
| 文档 | `docs/session-handoff-2026-09-20-leg77.md`（本文件）· `docs/START-HERE.md`（本棒入口） |
| 装置 | `F:/deepseek/tmp/leg77-hotmeta-coupling.mjs`（仓库外） |

### 下一棒的**第一动作**

1. ★**读 §5 的切口**，直接开工搬热账族（新模块 `web/hot-ledger.js`；
   ★**先定刺②那一格：甲（接线层留组合器、测试零改动）还是乙（整条搬走、注入 paramHub）**）；
2. ★搬完跑**四条硬读数**，**必须逐字节不变**（本族是纯搬迁）；
3. ★**别顺手做的事**：别搬 `sw2LastWorld`（刺①）、别碰 `src/storage.js`（`hotAccountShape` 在那儿）、
   别把参数族的东西一起搬（那是后面那一棒）。

---

*第七十八棒（leg77）· 2026-09-20 · 用户令「**把优化架构剩下的做了**」（丙-web 剩余四族）
→ 按 leg72/73 立的纪律，**先自重量**丙-web 第三格「热账族」的耦合（★那张表已被 leg76 证明会过期）
→ ★★★**实测三处不符**：①表把 `hotAccountShape`/`readHotAccount` 记成族内成员，**它们住在 `src/storage.js`**
   ②真实状态是 **8 个**（不是 11）③★**族符号散在六段、且参数块夹在中间** ⇒ 本族**不能整段剪切**，
   只能**六位置抽取**（与 leg72 记忆族、leg73 快照族**都不同**——那两族是连续块）
→ ★**三根刺**：`sw2LastWorld`（不该跟走，且动它会连带快照族）·
   `sw2ResetFlushState`（**跨两族**：热账簿记 + `paramHub.reset()`）· `hotAccountShape` 是依赖不是成员
→ ★**切口与判据形态已写全**（§5：新模块 `web/hot-ledger.js` + `test/web-hot-ledger-layout.test.js` 五条锁）
→ ★**探针 `leg77-hotmeta-coupling.mjs` 改三张表就能量下一族**
→ 读数四条**逐字节未变**（零代码改动的自证）→ 交接*

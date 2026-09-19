# 交接 · 第七十九棒（leg78）：**丙-web 第三格「热账族」已搬进 `web/hot-ledger.js`**

> **接手第一件事：读这份。** 本棒把**热账（hot-meta）读写落盘子系统**整族搬出接线层。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 `read`/`edit`/`write`）；**行数/字节数一律用 `node -e`**。
> ⚠ **本仓是 monorepo**，git 根 = **`F:/deepseek/plugins`**；跑 git 一律 `git -C F:/deepseek/plugins`。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）。
> ⚠ **真机位 = junction** ⇒ 改仓即改实机（本棒**纯搬迁、可见面零变化**，不必看界面）。
> ⚠ 上一棒（leg77）是**纯测量**（未动代码），它的切口清单是本棒的施工图 ——
> 见 `docs/session-handoff-2026-09-20-leg77.md`。

---

## 0. 一句话

**热账族（`readHotMeta`/`writeHotMeta`/`flushHotMeta` + 11 个状态 + 超时档/重试环 + 复位）整族搬进
新建的 `web/hot-ledger.js`**；`web/index.js` **3296 → 3108 行**；接线层从此只经**受控通道**够到账本。

⇒ 读数：**`node --test` 969/969**（接手 964，**+5** 条结构判据）· 冒烟 **8231 字节未变** ·
`world` 哈希 **`5fe7b698…` 未变** · import 环 **4 条未变** —— ★**四条全部逐字节不变**
（纯搬迁的硬判据：动一个字节就该有一条变）。`PANEL_BUILD` **未动**（可见面零变化）。

---

## 1. 本棒做了什么（施工结果）

| 项 | 值 |
|---|---|
| 新模块 | **`web/hot-ledger.js`（337 行，★零 import = 叶子中的叶子）** |
| 接线层 | `web/index.js` **3296 → 3108 行**（−188） |
| 新判据 | **`test/web-hot-ledger-layout.test.js`（219 行 · 5 条结构锁）** |
| 搬法 | ★**六位置逐字节抽取**（不是整段剪切，见 §2） |

### 1.1 搬进新家的东西

- **函数（10 个导出）**：`readHotMeta` · `writeHotMeta` · `flushHotMeta` · `hotMetaSignatureOf` ·
  `hotMetaFingerprint` · `sw2ExplicitChatName` · `sw2SetFlushTimeout` · `flushTimeoutMs`（★本棒新开的受控口）
  · `resetHotLedgerState`（★本棒拆出来的）· `createHotLedgerHub`
- **族内部（不导出）**：`reassertWrittenMetaIfClobbered` · `sw2CallSaveChat`
- **状态（11 个）**：`sw2HotMetaFlushing` · `sw2HotMetaLastCallAt` · `sw2HotMetaLastWriteAt` ·
  `sw2HotMetaPendingWriteAt` · `sw2HotMetaLastFlushOkAt` · `sw2HotMetaFlushedCurrent` ·
  `sw2FlushChain` · `sw2FlushChainBusy` · `sw2FlushTimeoutMs` · `sw2HotMetaWrittenFp` · `sw2HotMetaWrittenMeta`
- **常量**：`SW2_FLUSH_TIMEOUT_MS` · `SW2_FLUSH_TRIES` · `SW2_SAVE_MIN_MS` · `SW2_FLUSH_BACKOFF_MS`

### 1.2 **没搬**的（三条缝，逐条有理由）

| 缝 | 留在哪 | 为什么 |
|---|---|---|
| `freshCtx()` / `getCtx()` | 接线层 | 它是"取 ST 上下文"的**通用口**（全文件都在用）⇒ **注入**进新模块，不复制一份 |
| `sw2LastWorld` + `getLastWorld`/`setLastWorld` | 接线层 | ★**它不属于热账语义**（是"面板正在渲染的那一份世界"），且连着 leg73 快照 hub 的两个取数口 ⇒ 动它 = 同时动快照族（违反"一棒一族"） |
| `paramHub.reset()` / `sw2HubLastWorld` / `snapHub.resetDedupState()` | 接线层 | ★参数族与快照族的东西（见 §3 刺②的**甲案**） |

---

## 2. ★★★本族特有的搬法：**六位置逐字节抽取**（别照别族抄）

leg72 记忆族、leg73 快照族都是**连续块**（整段剪切）；**热账族不是** ——
它散在**六段**里，而且**参数块（leg46 的 paramHub 一族）正夹在它中间**：

```
  388  readHotMeta
  441–461  热账状态段（7 格）
  ⋯ 463–618：★参数块住在这里 ⋯
  650  writeHotMeta
  714–886  超时档 → 排队链 → 落盘名/签名 → 抢回 → flushHotMeta（★最干净的一段，173 行）
  889  sw2ResetFlushState（跨三族的复位）
```

⇒ **搬法纪律**：每个位置各取所需，**每个位置都要有字节级自证**。
★本棒的做法与证明：先把六段抠成夹具（`leg78-extract-parts.mjs`），搬完再**逐行断言
"从原文抠出来的代码行逐字节出现在新模块里"**（`leg78-move-proof.mjs`，全部命中）。

★★★**leg73 §4.1 那条教训在这里更适用**：**"比我自己拼出来的产物"是假自证** ——
必须拿**原文**逐字节比。★本棒的探针正是这么写的（并且它当场抓出了我的三处"以为搬了其实没搬/形态变了"）。

---

## 3. ★★本棒当场踩到的两个坑（下一棒必读）

### 坑①（最贵）：**跨族的调用点，搬迁时要逐个问"这个方法住在哪个 hub 上"**

`writeHotMeta` 末尾那一下是 **`snapHub.requestSnapshot(meta?.world, '落账')`** —— 快照族的口。
我第一版把它记成"热账 hub 自己的口"，写成 `getHotHub().requestSnapshot(...)` ⇒
**测试当场红了一片**（17 条），错误原话：

```
TypeError: getHotHub(...).requestSnapshot is not a function
    at writeHotMeta (web/hot-ledger.js:125)
    at sw2ApplyParam (web/index.js:2494)
```
★**纪律**：搬一族时，族内每一处**跨族调用**都要单独确认归属；写依赖注入之前，
先把"它调的是哪个 hub 的哪个方法"抄下来。

### 坑②：`flushOutcomeText` 里那句"超过 N 秒"读了热账的**私有状态**

`flushOutcomeText`（接线层）原先直接读 `sw2FlushTimeoutMs` —— 那是**跨块读私有状态**
（leg72 那次 `ReferenceError` 事故的同款形状）。搬走后它会当场炸。
⇒ 定稿给它开了一个**受控口** `hotHub.flushTimeoutMs()`，并把这条口径写进判据。
★**纪律**：搬一族之前，**全文件搜一遍这一族的每一个状态名**（不只搜函数名）——
leg72 漏了 `sw2SnapshotCache`、本棒漏了 `sw2FlushTimeoutMs`，**同一种病第三次**。

---

## 4. 三条设计决定（都写在代码里，别改回去）

### ① 甲案：跨三族的复位**拆开**，接线层留组合器
`sw2ResetFlushState` 原先一次清**三族**的东西（热账 8 行 + 参数 2 句 + 快照 1 句）。
定稿：新模块只导 `resetHotLedgerState()`（热账那 8 行）；接线层的 `sw2ResetFlushState` 退化成**组合器**。
★好处：①两族的复位不被绑在一起（给"参数族"那一棒留出干净切口）②
**`test/param-hub.test.js`（14 处）与 `test/set-param-persist.test.js` 的 import 一行都不用改**。

### ② `sw2SetFlushTimeout` 保留**转发口**
它是判据钩子（把超时压到几十毫秒真跑超时分支）。定稿：真定义在新家，
接线层留一个 `return hotHub.sw2SetFlushTimeout(ms)` 的转发 ⇒ 名字/路径不变、测试零改动。
★判据咬"**只许转发**"（自己再实现一遍 = 超时档有两个家）。

### ③ `getSnapHub` 必须**迟到注入**（取值函数）
快照 hub 由接线层**在热账之后**才建（leg73 的次序：它要的 `readHotMeta`/`flushHotMeta` 现在住热账模块）
⇒ 注入**取值函数** `getSnapHub: () => snapHub`，**不许**构造时抓死。
★判据同时钉住**顺序**（`hotHub` 必须先于 `snapHub` 建）——顺序若变，这个理由就失效，要重新论证。

---

## 5. 交接状态与读数

| 项 | 现值 |
|---|---|
| `node --test` | **969 / 969**（fail 0 · skipped 0）（接手 964 ⇒ **+5** 结构判据） |
| 冒烟 | **8231 字节 · PASS · 警告 0**（★逐字节未变） |
| 行为哈希 | `world` `5fe7b698dee8d9e891e82197691b884b0445dbad9a480f5cabf1c7c48d152a38`（★未变） |
| import 环 | **4 条**（★未变） |
| `PANEL_BUILD` | `leg76-roster-batch-pull`（★**未动**：纯搬迁、可见面零变化） |
| 分支 | monorepo `leg62-scales-concept-table` · ★本棒**未提交** |
| 实机位 | junction ⇒ 改仓即改实机（本棒**不需要看界面**的验收） |

### 本棒动过的文件

| 类 | 文件 |
|---|---|
| 生产 | **`web/hot-ledger.js`（新建）** · `web/index.js`（六位置抽取 + 三处转发/组合器 + 注入） |
| 判据 | **`test/web-hot-ledger-layout.test.js`（新建 · 5 条）** · `test/snapshot.test.js`（跨文件锁跟着符号改指新家） · `test/web-snapshot-layout.test.js`（同上） · `test/param-hub.test.js`（同上） |
| 文档 | `docs/session-handoff-2026-09-20-leg78.md`（本文件） · `docs/START-HERE.md` |
| 装置 | `F:/deepseek/tmp/leg78-*.mjs`（仓库外：抠段夹具 / 删除脚本 / 逐字节自证 / 计数） |

---

## 6. 下一棒正事（丙-web 还剩**三族**，顺序照旧）

**视图态族 → 查书补字段族 → 参数族**

### ★ 视图态族（≈40 行，最小最干净，建议下一棒做它）
`sw2ChronicleView` / `sw2EntsView` + 它们的 reset + 两个白名单 Set。
★bus 里只有 `ch-*`/`ents-*` 用 ⇒ 消费者面最窄。

### ★★ 查书补字段族：**表已过期，必须先自重量**
leg72 §3-A 那张表把这一族列成 ≈150 行，而它的清单里**一半已被 leg76 删掉**
（`batchTaskStatus`/`startBatchTask`/`stopBatchTask`/`batchStatusText`/`runBatchChunk`/`planBatchesLazy`）
⇒ **做之前必须自己量**（用 §7 的探针，改三张表即可）。

### ★ 参数族（放最后）
`paramHub` 一族 + `sw2ParamBusy`/`sw2SetParamControl`/`sw2SetParamCell`/`sw2SyncParamCells`/
`sw2CollectLiveParamValues`/`gatherParamEvidence`；★剩下多是**视图重绘**（与 `refreshSections` 耦合）。

### ★ 别忘了
- **leg75 的那条**：老快照恢复会把 `文风禁令/变量指令/其他` 带回来（形态：让 `restoreSnapshot` 走同一个迁移函数）；
- **leg76 §3-B/C**：`test/web-snapshot-layout.test.js` 里那条快照钩子断言已随本棒改指新家 ——
  下一棒若再动热账/快照的接缝，**两条跨文件锁要一起看**。

---

## 7. 装置（都在 `F:/deepseek/tmp/`）

| 脚本 | 干什么 |
|---|---|
| ★★`leg78-extract-parts.mjs` | 把六段抠成**原文夹具**（搬迁前后逐字节比的基础） |
| ★★★`leg78-move-proof.mjs` | **搬迁自证**：逐行断言"从原文抠出来的代码行逐字节出现在新家"；★含**缝**（留在原地 / 刻意改写）两类例外的分开表达 |
| ★★`leg78-delete-block.mjs` | 锚点 + 自证的删除脚本（**锚点不唯一/找不到就一个字都不写**） |
| ★`leg78-selfcheck.mjs` / `leg78-count.mjs` | 状态归属与符号计数（剥注释后判） |
| ★★`leg77-hotmeta-coupling.mjs` | **改三张表就能量下一族**（`FAMILY_FN`/`FAMILY_STATE`/`SIDE_CHANNELS`），比 leg73 那两个多一格：直接算出"族符号落在几段" |

---

*第七十九棒（leg78）· 2026-09-20 · 用户令「把优化架构剩下的做了」（丙-web 剩余族）
→ 照 leg77 的切口施工：**热账族整族搬进 `web/hot-ledger.js`**（六位置逐字节抽取）
→ ★★踩坑两处（跨族调用点归属 / 跨块读私有状态），都已修并写进判据
→ ★三条设计决定（甲案拆复位 · 转发口 · 迟到注入 getSnapHub）
→ 969/969 · 冒烟 8231 未变 · 行为哈希未变 · 环 4 条未变 · 接线层 3296→3108 行
→ 交接*

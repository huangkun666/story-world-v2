# leg81 重建 · 施工方法与进度（接线层重构）

> **接手第一件事：读这份。** 它记录的是"接线层被 `git checkout` 换成 leg69 之后，怎么把它按五/六族重构回来"。
> 事故本身见 `docs/session-handoff-2026-09-20-leg81.md`。**已入档检查点 commit：`048c3c6`**（现状）。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 read/edit/write；数字用 `node -e`）。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）。

---

## 0. 现状读数（每次交接都要更新这一格）

| 项 | 值 |
|---|---|
| `node --test` | **984 tests · 955 pass · 29 fail**（重建起点是 950/34） |
| `web/index.js` | **3675 行**（判据要求 < 3100；leg80 那一版是 2862） |
| 已完成的族 | ★**视图态族（leg79）6/7 通过**（剩一条是行数闸，见 §3） |
| 完好未动 | `src/` 全部 · `test/` 87 文件 · `docs/` 32 份 · 六个新家模块 |
| 引擎侧 | 冒烟 **8231 字节 · PASS · 警告 0**（每一步都要复核，不许被接线层改动带偏） |

---

## 1. ★★★施工总原则（照这个做，别自己发明）

**不要重写接线层。** 现盘上那份（leg69）里**六族的实现都还在**，而六个新家模块也**都完好**。
⇒ 每一族都是同一个三步机械动作：

```
① 删：把这一族的**族内实现**从 web/index.js 删掉（状态声明 + 函数体）
② 接：从新家模块 import 它导出的口；建 hub（工厂）；把消费点改成走**受控口**
③ 证：跑这一族的 test/web-*-layout.test.js + 全量 node --test + 冒烟
```

**施工图 = `test/web-*-layout.test.js` 那五个文件的全部断言**（共 **204 条**）。
已抽成一张可读清单：`F:/deepseek/tmp/leg81-BLUEPRINT.txt`（每个 test 名下面是它的全部 assert）。

---

## 2. ★★已跑通的那一族：视图态（照它抄）

**这是唯一已经做完的一族，也是模板。** 具体做了什么：

| 步 | 动作 |
|---|---|
| ① 删 | `web/index.js` 里删掉 8 个族状态：`sw2ChronicleView` / `sw2ChronicleViewReset` / `sw2ChronicleComposing` / `sw2EntsView` / `SW2_ENTS_KINDS` / `SW2_ENTS_FILTERS` / `sw2EntsViewReset` / `sw2EntsComposing`。★**注意它们不是连续块**：`sw2LastWorld` / `sw2SnapshotCache` / `sw2LastPicks` **正夹在中间**，那三样不属于本族，**一个字不许动** |
| ② 接 | 顶部 `import { createViewStateHub } from './view-state.js';`；并从 `../src/render.js` 的 import 里**摘掉** `makeEntsView` / `makeChronicleView`（那两个工厂现在只由新家问渲染层取）。建 `const viewState = createViewStateHub();`（★本族**零注入形参**）。九枚动作 + 两处渲染调用点 + 关面板两处复位 + 三支搜索框监听，全部改成走口 |
| ③ 证 | `node --test test/web-view-state-layout.test.js` ⇒ **6/7 通过**（剩 ⑬ 是行数闸）；全量 34 红 → **29 红**；冒烟未变 |

### ★★三条踩出来的纪律（每一族都会再遇到）

1. **视图对象/状态对象"现取"，但取证要就地写**：受控口给的是**取值函数**（`viewState.chronicle()`）。
   判据 ⑪ **同时**要求两件事：① 不许 `const v = viewState.chronicle()`（绑进变量 ⇒ 复位换绑后，
   就地写落到**被丢弃的旧对象**上 ⇒ 面板"点了没反应"且不报错）；② **必须真的就地写**，且
   `viewState.(chronicle|entities)().\w+\s*(\+\+|--|\+=|-=|=)` 这种形状**≥6 处**。
   ⇒ 写法：`viewState.entities().q = String(q.value || '');`（一行一写，别图省事绑变量）。
2. **删状态时保留"夹在中间"的别人的状态**（这一族有 3 个）。删之前先 `grep` 一遍全文件，
   把"这一族的状态名"和"夹在中间的名字"分开列。
3. **注释可以留档，代码里必须归零**：判据跑在**剥注释后**的源码上 ⇒ 删掉的实现可以在原地留一段
   中文回执（写明"搬去哪儿、为什么、哪个口"），这既是留档也不犯判据。

---

## 3. 行数闸（别被它误导）

`web-view-state-layout` ⑬ 与 `web-hot-ledger-layout` ⑦ 各有 `lines < 3100` / `lines < 3150`。
**现在 3675 行 ⇒ 必然红**，它**不是**"视图态没搬干净"，而是"还有五族没搬"。
leg69 的接线层里六族实现全在（记忆 4 处 / 快照 4 处 / 热账 5 处 / 视图态 1 处 / 取书 4 处 / 参数 4 处
= **22 处族内实现**待外移）⇒ 搬完大致落到 2800 行，那两条**自然转绿**。⇒ **不要为了过行数闸去删别的代码。**

---

## 4. 剩下五族（按"由简到繁"排序，建议顺序）

| 序 | 族 | 新家模块 | 判据文件 | 备注 |
|---|---|---|---|---|
| 1 | **记忆** | `web/memory-store.js`（320 行 · 10 导出） | `web-memory-layout`（5 条） | 最简单；注入面只有 1 个（`sw2MemoryPush`） |
| 2 | **取书** | `web/book-source.js`（284 行 · 12 导出） | `web-book-source-layout`（7 条） | 注入面 1 个（`setCtxSource`）；★两种形状并存：**一口零参 + 其余收形参** |
| 3 | **热账** | `web/hot-ledger.js`（337 行 · 13 导出） | `web-hot-ledger-layout`（6 条） | ★**迟到注入** `getSnapHub` 必须是**取值函数**（判据⑥咬） |
| 4 | **快照** | `web/snapshot-store.js`（283 行 · 13 导出） | `web-snapshot-layout`（5 条） | 注入面最大（16 个）；建 hub 次序在热账**之后** |
| 5 | **参数** | ★`web/param-panel.js`（497 行 · **已写好**） | 待建 `web-param-panel-layout` | 见 §5 |

### 建 hub 的次序（**照这个顺序**，判据锁着）
```
… → const viewState = createViewStateHub();（已完成）
  → const hotHub = createHotLedgerHub({ freshCtx, hotMetaKey: HOT_META_KEY, getSnapHub: () => snapHub });
  → const { readHotMeta, writeHotMeta, flushHotMeta } = hotHub;
  → const snapHub = createSnapshotHub({ setStatus, refreshWorld, freshCtx, loadHotAccount, readHotMeta,
                                        sw2WriteHotMetaEnsuringParams, flushHotMeta,
                                        getLastWorld, setLastWorld, getListedVolumes });
  → const paramApi = createParamApi({ freshCtx, sw2ExtensionSettings, sw2LocalStore, getLastWorld });
```
★`getLastWorld` / `setLastWorld` / `getListedVolumes` **必须是函数声明**（判据咬"提升 + 调用时才求值"）：
`sw2LastWorld` 与 `LISTED_VOLUMES` 声明在文件更后面且会被反复重新赋值 ⇒ 写成箭头函数会在建 hub 那一刻求值 ⇒ TDZ。
★`sw2ResetFlushState()` 是**组合器**，四句各有其主：
`hotHub.resetHotLedgerState()` · `paramHub.reset()`（经 paramApi）· `sw2HubLastWorld = null`（经 paramApi）· `snapHub.resetDedupState()`。

---

## 5. 参数族（`web/param-panel.js` 已写好，只差接线）

模块已经存在且**自证过**（六道：逐字节往返 / 0 孤儿 / 旧家实现归零 / 真 import 成功）。
接线层侧要做：
- `import { createParamApi } from './param-panel.js';`
- 删掉接线层里参数族的实现（`paramHub` 装配 / `gatherParamEvidence` / `paramEvidenceText` /
  `sw2ParamDiag` / `sw2UndoParam` / `sw2WriteHotMetaEnsuringParams` / `sw2HubLastWorld` /
  `sw2CollectLiveParamValues` / `sw2SetParamCell` / `sw2ParamControlOf` / `sw2ControlText` /
  `sw2SetParamControl` / `sw2SyncParamCells` / `sw2ParamBusy` / `sw2CellWriteLog` / `playerIsTouchingParams`）；
- 消费点改走受控口（受控口清单见模块尾部 `return {...}`）。
★参数族那一棒的**全部依据**（量、切口、两堵承重墙、四个坑）在 `docs/session-handoff-2026-09-20-leg81.md` §2–§3。

---

## 6. 还有两处"跨族锁"要跟着符号走

| 锁 | 内容 |
|---|---|
| `test/param-hub.test.js` ⑨ | 源码级扫 `web/index.js`：不许再出现参数存储的写语句（`PARAMS_LS_KEY` 那条**只有** `sw2WriteLocalBucketRaw` 例外）；且必须 `createParamHub(` 真的被调（参数族搬走后 ⇒ 改为断言**经 `createParamApi` 建**） |
| `test/param-hub.test.js` ⑮ / `render.test.js` | 用 `src.indexOf('export function sw2SetParamControl')` 取切片 ⇒ 符号搬到新家后这几处锚点**必须改指新家**（★口径不许放宽：仍要锁"两种控件都认"那条） |

---

## 7. 每一族的收尾清单（照抄）

```
□ node --check web/index.js
□ node --test test/web-<族>-layout.test.js        ← 该族判据全绿
□ node --test                                      ← 全量 pass 只增不减，且**没有新红**
□ node demo/smoke-demo.js                          ← 终态 SSOT 必须仍 8231 字节、警告 0
□ node -e "…"                                      ← 该族符号在 web/index.js 代码里**归零**（注释里可留档）
□ git add -A && git commit                         ← ★每族一提交（这一条是本棒血的教训）
```

---

*leg81 重建 · 起点 commit `048c3c6` · 视图态族已完成（6/7）· 34 红 → 29 红*

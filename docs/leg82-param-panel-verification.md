# leg81/82 · `web/param-panel.js` 独立验证结论（★5 个真缺陷，待修）

> **接手第一件事：读这份，然后照 §2 的修法改 `web/param-panel.js`。**
> 验证方：独立 subagent（只读生产文件、不改），判据文件：**`test/web-param-panel-layout.test.js`（579 行 · 11 条）**。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 read/edit/write；数字用 `node -e`）。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）。

---

## 0. 一句话

`web/param-panel.js`（497 行 · 参数族新家）**结构自证全过**（逐字节往返 / 0 孤儿 / 旧家实现归零 / 真 import 成功），
**但它有 5 个真缺陷，全部只在"真调一次"时暴露**：
`WINDOW_ID` 无绑定 · `getLastWorld` 被赋值却从未被调用（3 处写成 `sw2LastWorld`）· `PANEL_BUILD` 无绑定 ·
`writeHotMeta` 没 import · `refreshSections` 无绑定。
⇒ 现状：**面板整族 DOM 镜像 100% 静默失效**、自证面一调就 `ReferenceError`、撤销不落账、快照恢复/导入的补镜像路整条不可用。

★**这一条是本棒最该记住的**：`import` 成功 **≠** 能真调。我的"六道自证"只验了**结构**与"能否 import"，
**没验任何一次真实调用** —— 于是 5 个 `ReferenceError` 全都躲过去了。**下一族一律要加"真调一次"的判据。**

---

## 1. 五个真缺陷（逐条：位置 / 症状 / 后果）

| # | 位置 | 事实 | 后果 |
|---|---|---|---|
| **1 ★最重** | `web/param-panel.js` 第 204 / 289 / 359 / 394 行 `document.getElementById(WINDOW_ID)`；模块顶层与 `createParamApi` 的 `deps` 里**都没有** `WINDOW_ID` | 全模块无绑定 | 浏览器里调 `sw2SetParamCell('每轮递线')` ⇒ `ReferenceError: WINDOW_ID is not defined`，被各自 `catch` 吞掉（少一行 warn）⇒ **面板整族 DOM 镜像 100% 静默失效**（`sw2CollectLiveParamValues` 退回 `{env:null}`、`sw2SyncParamCells` 退回 0） |
| **2** | 第 53 行声明 `let getLastWorld = null;` + 第 445 行赋值；但 3 处调用点（第 230 / 245 / 375 行）写的是 **`sw2LastWorld`**（本模块里没有这个名字） | `getLastWorld` **调用次数 0**（实测）；那 3 处是自由变量 | 建好 hub 后**最新世界永远取不到**（`lastWorld()` 恒 null，`setLastWorld` 成了唯一写入口）⇒ 面板桶键那条链断在源头（正是"读的桶与写的桶不是同一个"那一族病） |
| **3** | 第 93 行 `构建号: PANEL_BUILD`，全模块无绑定 | ★**抛在 `try` 之外**（第 94 行才进 try） | `gatherParamEvidence()` 一调就 `ReferenceError` ⇒ 连 `写格次数` / `主路（载入时）` / 写入审计这些格**一个都拿不到**；`paramEvidenceText()` 同款。★这条是"用户不开控制台"的唯一读数通道 |
| **4 ★承重墙** | 第 182 / 196 / 199 行调 `writeHotMeta`；而第 46 行只 `import { readHotMeta }`（★`hot-ledger.js` **有**导出 `writeHotMeta`） | 没 import | `ReferenceError: writeHotMeta is not defined`。第 182 行那句被 `try` 吞掉 ⇒ **撤销不再落账**；196/199 让"快照恢复 / 导入 / 清演化层"前的**补镜像路整条不可用** ⇒ 引擎（`limits.js` 闸 / `pack.js` 进包）按**旧档**跑 |
| **5** | 第 184 行 `refreshSections(['params','board'])`，无绑定 | 没注入 | 撤销本身成功（`:177 paramHub.undo` 好使）但**画面停在旧值**（那句被 try 吞掉） |

### ★一条"没踩中的坑"也要留档（证伪过的清白）
`sw2ParamBusy` 是**模块顶层** `let`（第 407 行），而 `createParamApi` 在第 437 行才声明 ⇒ 它**没有**被误搬进工厂体；
`:485 paramBusy: () => sw2ParamBusy` 与 `:493 .clear()` 指同一颗 Map ⇒ **忙闩的身份与复位是对的**（`reset()` 四样里忙闩那一样实测通过）。

### ★另一条非缺陷但必须报
`web/index.js`（3675 行）现在**根本没接上**这个模块：`createParamApi` 一次都没调、`param-panel` 全仓零 import，
而 `sw2HubLastWorld` / `sw2CellWriteLog` / `sw2ParamBusy` / `paramHub` 四个**定义**都还在接线层里
⇒ 那是 `git checkout` 事故的产物（见 `docs/session-handoff-2026-09-20-leg81.md` §1），**不是模块的错**。
⇒ 判据 ③（接线层不许再定义那四个）现在红得**正确**，等参数族接线做完自会转绿。

---

## 2. 建议的最小修法（改了这 5 条，11 条判据里应只剩 ③ 一条红）

```
① `createParamApi` 的 `deps` 补两样：`WINDOW_ID`、`refreshSections`（都要**函数/常量**都必须真被用起来）
② `writeHotMeta` 直接补进第 46 行那条 import：`import { readHotMeta, writeHotMeta } from './hot-ledger.js';`
③ 把第 230 / 245 / 375 行的 `sw2LastWorld` 换成 `getLastWorld()`
④ `PANEL_BUILD` 补一个注入项或从 `../src/render.js` import（★注意本模块**不许**反向 import `web/index.js`，那条会成环）
★ 修完必须跑：`node --test test/web-param-panel-layout.test.js` ⇒ 只剩 ③ 红；
  再跑 `node --test`（全量）与 `node demo/smoke-demo.js`（终态必须仍 8231 字节 / 警告 0）。
★ 判据**不许**放宽；模块改完若某条判据仍红，**先问"是模块错还是判据错"**，别直接改判据。
```

---

## 3. 验证方明确"没能覆盖"的部分（下任补）

1. **真浏览器**：假 DOM。`WINDOW_ID` 这条是浏览器语义下**推**出来的（Node 里被 `typeof document === 'undefined'` 挡住）
   —— ★本仓 `browser-compat` 扫描**覆盖不到"自由变量"这一类**，这正是它躲过所有既有判据的原因。
2. **端到端接线**：`bus['set-param']` / `sw2ResetFlushState` / 两处复位**没验**（因为迁移还没发生）。
3. **三个口的行为**没跑：`playerIsTouchingParams` / `sw2SetParamControl` / `sw2CollectLiveParamValues`
   （只验了"存在且是函数"+"顶层零 DOM"）。
4. `sw2UndoParam` 那条路依赖 hot-ledger 的 `freshCtx` ⇒ 判据文件**不是完全自包含**（测试台按真机次序先建 hotLedgerHub）；
   若将来 `createHotLedgerHub` 注入面改名，该文件要跟着改。
5. 全量回归当时基线是 950/34（事故产物）；`module-layout` + `browser-compat` 单跑 9 pass / 1 fail（那 1 条是既有失败，与本棒无关）。

---

*leg82 · 验证方：独立 subagent · 判据 `test/web-param-panel-layout.test.js`（11 条：现 2 绿 / 9 红，红的有 5 条是真缺陷、1 条等接线、3 条是缺陷的下游）*

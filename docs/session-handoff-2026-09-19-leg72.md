# 交接 · 第七十三棒（leg72）：**丙- web 第一格 —— 记忆子系统搬出 3700 行接线层**

> **接手第一件事：读这份。** 第二件事：细案 `docs/plan-structure-optimization.md` 的
> **甲 / 乙-1 / 丙-记三格已落地（leg67/68/71）**，**丙-web 本棒开了第一格**。
> ⇒ 还剩 **丙-web 的其余族**（引用/快照/参数/视图态/…）与 **乙-2**（`settleTick` 显式阶段化，高风险、要单独细案）。
> 本棒依据：细案 §3.2 + `leg71` 交接 §3-A（丙-web 的**可行性第一件事 = 先量耦合**）。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 `read`/`edit`/`write`）；**行数/字节数一律用 `node -e`**（见 §5.2）。
> ⚠ **本仓是 monorepo**，git 根 = **`F:/deepseek/plugins`**；跑 git 一律 `git -C F:/deepseek/plugins`。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）——在 monorepo 根跑会连带跑别的插件（见 §5.3）。

---

## 0. 一句话

**丙-web 的第一格落地：把"记忆投递"整个子系统从 `web/index.js` 搬进 `web/memory-store.js`**，
`web/index.js` **3771 → 3514 行**（新建模块 320 行）——
★**这一格选它的理由不是"它大"，而是它是唯一一个"搬出去之后归属真的变正确"的族**（理由见 §1.1）。
★★**顺带修掉一个真正的设计病**：那份状态 `sw2MemoryPush` 原来被接线层**直接读写 4 处**
⇒ 搬迁时给它配了**两个受控通道**（`readMemoryPush()` / `clearMemoryPush()`），**状态从此只有一个家**（§1.4）。

⇒ 收尾读数：**`node --test` 951/951**（接手 945，**+6**）· 冒烟 **8231 字节 · PASS · 警告 0** ·
**行为哈希与 HEAD 逐字节相同**（`world` `5fe7b698…`）·
★★**渲染产物逐字节相同**（`8ec7362f…`，与 leg71 那条硬判据同一个值；第二笔升构建号后经**受控对照**证明差异只是构建号）·
**五段咬合演练全部咬住**（§2.5）· **`PANEL_BUILD`**：第一笔搬迁**不升位**、第二笔修缺陷**升到 `leg72-restore-flush-honest`**（§1.6 / §3-C）。

★★**同一棒第二笔（leg72b）修掉一处真缺陷**：`restoreSnapshot()` 的落盘一行**曾被换成存根**
`const flushed = { ok: true };`（leg67–71 期间的未提交改动）⇒ **面板那句「已落盘」从来没说过真话**
（既不落盘、字段又是判对象真值恒真）。已恢复真落盘 + 面板按 `flushed.ok` 分叉 + 补一条判据。全过程见 §3-C。

---

## 1. 硬事实（本棒实测）

### 1.1 ★★为什么本棒**没有**照字面"按动作总线切"（这是本棒最重要的一个判断）

细案 §3.2 的原文是「`web/index.js` 按**动作总线**切：`bus` 的注册表 + 各自处理器分文件，
**保留一个薄接线层**」。本棒先按交接 §3-A 的要求**量了耦合**，量完之后**改了做法**，理由如下（都有实测数字）：

| 量到的事实 | 数字 | 含意 |
|---|---|---|
| `bus` 块本身 | **2823–3627 行，805 行，30 个动作** | ★它**本来就已经是一个独立段落**（`if (typeof window !== 'undefined') { … }` 一整块） |
| 把它切出去要跨模块传递的**模块级可变状态** | **64 个**（`let/const` 顶层）中的一大批 | ★`web/index.js` 顶层有 **64 个模块级状态**（`sw2LastWorld`/`paramHub`/`sw2EntsView`/`LISTED_VOLUMES`/…），处理器几乎人人都摸 |
| 最"公共"的那一个 | `setStatus` 被 **9 个组**用；`readHotMeta` **5 组**；`refreshSections` **4 组** | ★"薄接线层"要往外递的是一张**巨大的依赖表** |
| 处理器里**唯一**用到的族内符号 | 各组 2～16 个不等，且**多为跨族共享** | ★"按族分文件"会把**共享状态**劈到两个文件 —— 本仓最贵的病（两份真相） |

★★**结论（写清楚，供下一棒复核）**：
**"按动作总线切"这个动作本身，在 `web/index.js` 上等于把 `let` 绑定的可变状态跨模块共享。**
JS 的 `import` 是**只读活绑定** ⇒ 接线层里 `sw2LastWorld = world` 这种**重新赋值**在跨模块后**根本写不了**；
硬做只有两条路：①把状态收进一个 context 对象到处传（那 805 行处理器要**逐行改**，
与本仓"纯结构搬迁、行为零变化"的验收口径冲突）；②用 getter/setter 包装几十个状态
（= **手工重写一个模块系统**，风险远大于收益）。
⇒ 本棒的做法：**改按"语义簇"切，一次切一族**（细案 §3.2 的**要义**是"按语义边界，不按行数"），
**优先切"搬出去之后归属真的变正确"的族** —— 而不是"切起来最省事"的族。

### 1.2 病：一个 3700 行的接线层，里面住着一个**完整子系统**

| 块 | 原位置 | 它是什么 | 谁真正需要它 |
|---|---|---|---|
| **记忆投递** | `web/index.js:2539-2809`（271 行）+ 顶层 55/56 两行 | 记忆插件适配器（注入形参 `YM`）· 记录写入与旧表清理 · **只读自检**（含语义自检）· 投递自证面与它的一行读法 | **它自己**（`setupAsyncTicks` 的 tick 落账 / `bus['init-world']` / `loadWorld` 那一句）；面板只要**一行字符串** |

★病的准确名字：**"一个接线层，同时兼任一个子系统的家"**。
它此前与 3000 行参数/视图/快照代码挤在一起 ⇒ "记忆投递"的每一处改动都要先穿过一片无关代码；
更坏的是那份状态（§1.4）被接线层**直接读写**。

### 1.3 治法：一个族整体搬出 + 一个"状态收口"

```
web/memory-store.js  （320 行，**零 DOM**）  ← 记忆那 271 行 + EVENTS_TABLE_NAME + 两个受控通道
web/index.js         （3771 → 3514 行）     ← 按新位置 import 回来（它自己仍要用 4 个）
```

**本棒各处坐标（实测，供下一棒直接定位）**

| 位置 | 是什么 |
|---|---|
| `web/memory-store.js:1` | 头注：它是什么 · 为什么单独成家 · 边界 · **状态归属** · 依赖方向 · 两条纪律留档 |
| `web/memory-store.js:41` | `import { … } from '../src/memory-bridge.js'`（**唯一一条 import**） |
| `web/memory-store.js:42` | `EVENTS_TABLE_NAME`（随块搬来，见 §1.5 第 1 条实测改正） |
| `web/memory-store.js:44` | `SW2_RECORD_PREFIX`（原块第一行） |
| `web/memory-store.js:300` | `readMemoryPush()`（新增的受控通道 · 读） |
| `web/memory-store.js:304` | `clearMemoryPush()`（新增的受控通道 · 清） |
| `web/index.js:33` | 从新模块 import 回六个符号（**只有六个**，见 §2.2 判据②） |
| `web/index.js:~2541` | **旧址留痕**（"这一整块搬走了 ⇒ 见 `web/memory-store.js`"） |
| `web/index.js` 三处调用点 | `renderCfg` 的 `memoryPush: readMemoryPush()` · 主开关两处 `clearMemoryPush()` |
| `test/web-memory-layout.test.js` | **本棒新判据 5 条**（结构不变量） |
| `test/browser-compat.test.js:listSources()` | **扫描面改成跟着 `web/` 目录走**（§1.5 第 3 条） |

### 1.4 ★★★状态归属（本棒最该记住的一条）

`sw2MemoryPush`（记忆投递自证面）原来**只在新模块的块内被读写**——
**错**。实测它在块外还有 **4 处**直接读写：

| 行 | 原文 | 谁 |
|---|---|---|
| `web/index.js:1730` | `memoryPush: sw2MemoryPush,` | `renderCfg()` **注入**给渲染层 |
| `web/index.js:2232` | `} else if (sw2MemoryPush) {` | tick 落账读它 |
| `web/index.js:2233` | `sw2MemoryPush = null;` | 开关关了 ⇒ 自证面归零 |
| `web/index.js:2898` | `if (!on) sw2MemoryPush = null;` | 同上（`reset-dynamic` 那条路） |

★**我第一版就是漏了这 4 处**（消费者普查只数了**函数声明**，没数 `let/const` 状态）
⇒ 搬完当场 `ReferenceError: sw2MemoryPush is not defined`、3 个测试文件红（见 §4.1）。
★★**治法不是"把状态劈成两半"**（那正是本仓最贵的病），而是：
**状态只住 `web/memory-store.js`，外面一律走两条受控通道**：

```js
export function readMemoryPush() { return sw2MemoryPush; }   // 渲染层要的读数
export function clearMemoryPush() { sw2MemoryPush = null; }  // 主开关"关掉即归零"
```

★口径：**状态与它的读法同处一地** —— 这是"归属正确"的具体形状，判据丙-web③咬住它（§2.2）。

### 1.5 ★实测改正的三处（设计/前置与实测不一致，以实测为准）

| # | 前置/我的假设 | 实测 | 处置 |
|---|---|---|---|
| 1 | `EVENTS_TABLE_NAME` 是"块内的事"，随块走即可 | 它的**定义在块外**（`web/index.js:60`）、**引用全在块内** | 随块搬（不搬就是断线）；判据丙-web④咬住"它在 index.js 代码里不再出现" |
| 2 | 搬完之后 `web/index.js` 只需取回 4 个符号 | 还要取回**两个受控通道**（§1.4） | 取回清单 = **6 个**，判据②锁"不多不少" |
| 3 | `test/browser-compat.test.js` 会照看新的 `web/` 模块 | 它**写死**只扫 `web/index.js` | ★扫描面改成**跟着 `web/` 目录走**（现算，不写死清单），并加"每个 web/*.js 都必须在扫描面里"的断言 —— 否则新模块成了**浏览器可载性的盲区**（判据还绿、但已经照不到新东西） |

### 1.6 ★`PANEL_BUILD` **不升位**（理由与 leg71 相同）

本棒是**纯结构搬迁**：渲染产物逐字节相同（§1.5/§2.3）、冒烟逐字节相同、
玩家可见面与模型可见面**一个字节没变** ⇒ 升位等于宣称一个不存在的改动（leg55/leg66 那条纪律的反面）。
⇒ `PANEL_BUILD` 保持 **`leg70-adopt-scale-draft`**。

---

## 2. 本棒已完成

### 2.1 改动面（**新建 2 + 改 6**）

| 类 | 文件 | 落成什么 |
|---|---|---|
| **新建** | `web/memory-store.js`（320 行） | 记忆投递子系统（271 行逐字节搬来 + 两行随迁 + 两条受控通道 + 头注） |
| **新建** | `test/web-memory-layout.test.js`（~200 行） | **5 条结构判据**（含三条反向自证） |
| 改 | `web/index.js` | 块搬走（3771→3514）+ 留痕 + 回填 import（6 个）+ **4 处状态引用改走受控通道** |
| 改 | `test/browser-compat.test.js` | 扫描面跟着 `web/` 目录走 + 每个 web 模块必须在列 + 反向自证 |
| 改 | `test/memory-bridge.test.js` | import 改指新家（**不搞 re-export**） |
| 改 | `test/memory-semantic.test.js` | 同上 |
| 改 | `test/snapshot.test.js` | 同上；★两条**读源码的结构锁**（leg27 d / leg27 g）改成**按"符号的新家"取源码**（判据内容一个字没放松） |

### 2.2 判据（**5 条**，逐条一句话）

| # | 用例 | 一句话 |
|---|---|---|
| 1 | **符号在新家定义、旧家不再定义** | 防"搬了但旧家还留一份"；★**跑在剥注释后的源码上**（裸正则会被留痕注释骗，§4.2） |
| 2 | **`web/index.js` import 回它还要用的那批** | 集合**不多不少**（6 个）；且**不再 import `src/memory-bridge.js`** |
| 3 | ★★★**`sw2MemoryPush` 只有一个家** | 状态在新模块里**恰好一处**定义 · 接线层**代码**里不再出现它 · 4 处引用都改走受控通道（`readMemoryPush()` 1 处 + `clearMemoryPush()` 2 处） |
| 4 | ★**新模块不许反向 import 接线层** | 单向 ⇒ 不可能成环；并断言它的 import **只有一条**（`../src/memory-bridge.js`）；`EVENTS_TABLE_NAME` 随迁 |
| 5 | ★**接线层真的变薄** | 实现体记号（`Storage.loadState?.(fallback)`/`saveOrigin`/…）在旧家**不在**、在新家**在**；行数 < 3600 |

★为什么第 3 条是"最重要的一条"：它咬的**不是一个搬家动作，而是一个设计口径**——
"一个状态只有一个家、外面走受控通道"。这正是本仓最容易长歪、也最贵的地方。

### 2.3 交付面

| 项 | 值 |
|---|---|
| `node --test` | **951 / 951**（fail 0 · skipped 0）（接手 945 ⇒ 第一笔 **+5** 结构判据 + 第二笔 **+1** 缺陷判据） |
| 冒烟 | **8231 字节 · PASS · 警告 0**（逐字节未变） |
| 行为哈希 | `world` `5fe7b698dee8d9e891e82197691b884b0445dbad9a480f5cabf1c7c48d152a38`（与 HEAD 逐字节相同） |
| **渲染产物** | 第一笔：sha256 `8ec7362f…`（**搬迁前后完全一致**）· 第二笔：`2ece100f…`，★**受控对照证明差异只是构建号**（换回旧名 ⇒ `8ec7362f…`） |
| import 环 | **4 条**（与 leg71 基线逐条相同；`web/` 侧新模块**不参与** src 的环检测——它是叶子，只 import `src/memory-bridge.js`） |
| `src` 模块数 | **43**（未动） |
| `web/` 模块数 | **3**（`index.js` · `idb-backend.js` · **`memory-store.js`**） |
| `PANEL_BUILD` | **`leg72-restore-flush-honest`**（第二笔升位；第一笔搬迁本身不升位，理由见 §1.6 与 §3-C） |
| `VERSION` / `manifest.version` | `1.0.0`（未动） |
| 分支 | monorepo `leg62-scales-concept-table` | ★本棒**未提交**（见 §7） |

### 2.4 体量对照

| 文件 | 前 | 后 |
|---|---|---|
| `web/index.js` | 3771 行 / 264,239 字节 | **3514 行 / 242,130 字节**（−257 行） |
| `web/memory-store.js` | — | **320 行 / 27,402 字节** |
| `test/web-memory-layout.test.js` | — | 新建（5 条判据） |

### 2.5 ★咬合演练（`F:/deepseek/tmp/leg72-bite-probe.mjs`，**五段全部咬住**）

| 演练 | 制造的缺陷 | 咬它的那条断言 | 实测 |
|---|---|---|---|
| ① | 接线层又直接读那份状态（**v1 的原始病**） | 丙-web③ | ✓ 只红它一条 |
| ② | 主开关的"归零"绕过受控通道（只改一处） | 丙-web③ | ✓ 只红它一条 |
| ③ | 旧家留一份副本（把 `memoryPushLine` 又定义回接线层） | 丙-web① | ✓ 咬住；★**连带红了丙-web②**（import 清单少了它）—— 如实记，那是真连带不是假绿 |
| ④ | 新模块反向 import 接线层（造环） | 丙-web④ | ✓ 只红它一条 |
| ⑤ | 用 re-export 把归属重新搞模糊 | 丙-web① | ✓ 只红它一条 |

★**摘锁纪律照 leg71 §4.2 办**：每段都由**它自己那条断言**亲自咬出；
演练完**立即用脚本保存的原文恢复**，并跑全量确认 **950/950 回到基线**（实测已确认）。

### 2.6 ★★leg72b（同一棒第二笔）：`restoreSnapshot` 的落盘存根 —— 已修

见 §3-C（那一格已从"待办 · 要报批"变成"已修"，全过程与铁证都在那里）。三条读数：

| 项 | leg72（第一笔） | leg72b（第二笔，收尾） |
|---|---|---|
| `node --test` | 950/950 | **951/951**（+1：新判据「恢复快照必须真的落盘」） |
| 冒烟 / `world` sha256 | 8231 字节 / `5fe7b698…` | **同左（未变）** |
| 渲染产物（规范化后） | `8ec7362f…` | `2ece100f…`（★**差异只是构建号**——受控对照换回旧名 ⇒ **回到 `8ec7362f…`**，见 §3-C） |
| `PANEL_BUILD` | `leg70-adopt-scale-draft`（不升位） | **`leg72-restore-flush-honest`（升位）**——理由见 §3-C |

---

## 3. 待办（按优先级）

### ★★ A. 丙-web 的**其余族**（本棒开了第一格，剩下的是同一把尺继续量）

★★**快照族已经做过一轮可行性普查（leg72b 顺手量的，结论留给下一棒直接用）**：

| 量到的事实 | 数字 / 原文 |
|---|---|
| 族内规模 | `ensureSnapshotChain` / `snapshotStore` / `stripParamKeys` / `isParamOnlyChange` / `requestSnapshot` / `snapshotList` / `restoreSnapshot` / `clearSnapshots` / `resetSnapshots` / `refreshSnapshots`，**连续块 `web/index.js:931-1150`**（含注释约 220 行）+ `sw2SnapshotCache` |
| 族内自洽 | 实测**几乎全部消费者都在族内**（`snapshotStore` 7 处引用全在族内；`clearSnapshots`/`resetSnapshots` 各只有族内或 bus 调用） |
| ★对外只有 **3 个连接点** | ① `writeHotMeta` 调 `requestSnapshot`（`web/index.js:670` 附近的 `requestSnapshot(meta?.world, '落账')`）② `loadWorld` 调 `refreshSnapshots` ③ `renderCfg` 读 `sw2SnapshotCache`（`:1736`） |
| 需要注入的依赖（6 个） | `readHotMeta` · `writeHotMeta` · `flushHotMeta` · `sw2WriteHotMetaEnsuringParams` · `refreshWorld` · `getLastWorld`（★`paramHub` 本身不用注入——见下） |
| ★★★**必须当心的坑（本棒当场发现）** | **`let sw2LastWorld` 声明在 `:1144`，正好在快照块（`:931-1150`）的尾部** ⇒ 若用**箭头函数**注入 `() => sw2LastWorld`，会在 `web/index.js` 的初始化期**立刻求值** ⇒ **TDZ `ReferenceError`**。⇒ **必须用 `function getLastWorld() { return sw2LastWorld; }`**（函数声明提升、调用时才求值），或把 `sw2LastWorld` 的提升一并做掉 |
| 另一个顺序约束 | `writeHotMeta`（`:647`）**内部就调 `requestSnapshot`** ⇒ 快照 hub **必须在 `:647` 之前建好** ⇒ 与上一条叠加，需要先理顺"模块状态 → hub 构造 → 函数"的初始化顺序 |
| 建议形态 | **依赖注入工厂**（同 `createParamHub`，本仓已有先例）：`createSnapshotHub({ readHotMeta, writeHotMeta, flushHotMeta, writeHotMetaEnsuringParams, refreshWorld, getLastWorld })`；★`sw2WriteHotMetaEnsuringParams` 自己用 `paramHub.mirrorOnly`（`:641`）⇒ 把它整个注入即可（闭环 `paramHub → writeHotMeta → requestSnapshot → snapshotHub` 不会在初始化期求值） |
| ★连带面 | `test/snapshot.test.js` 里**两条读源码的结构锁**会跟着搬（`bodyOf(...)` 的取样文件要改指新模块）；`test/browser-compat.test.js` 已改成跟着目录走（**自动覆盖**，不用动） |

**其余族建议顺序**（按"搬出去之后归属变正确"的程度排，附本棒实测的耦合数字）：

| 序 | 候选族 | 规模 | 为什么排这个位置 |
|---|---|---|---|
| 1 | **快照族** | `snapshotStore` / `requestSnapshot` / `restoreSnapshot` / `refreshSnapshots` / `clearSnapshots` / `resetSnapshots` / `ensureSnapshotChain` / `stripParamKeys` / `isParamOnlyChange` ≈ **150 行** | ★**独占符号最多的一族**（实测：这些符号的消费者几乎全在族内），只与 `src/snapshot.js` + `readHotMeta` 打交道 |
| 2 | **热账族（hot-meta）** | `readHotMeta`/`writeHotMeta`/`flushHotMeta`/`reassertWrittenMetaIfClobbered`/`hotMetaSignatureOf`/`hotMetaFingerprint`/`sw2CallSaveChat`/`sw2ResetFlushState` ≈ **220 行 + 11 个模块级状态** | 归属极清楚（"账本怎么读写落盘"），但 **`readHotMeta` 被 8 个 bus 动作用**、`flushHotMeta` 被 5 个用 ⇒ 切线要连同"账本读写口"一起定契约 |
| 3 | **视图态族** | `sw2ChronicleView` / `sw2EntsView` + 它们的 reset + 两个白名单 Set | ★**最小最干净**（bus 里只有 `ch-*`/`ents-*` 用），但**独立价值也最小**（约 40 行） |
| 4 | **查书补字段族** | `lookupOneEntity` / `batchTaskStatus` / `startBatchTask` / `stopBatchTask` / `batchStatusText` / `runBatchChunk` / `planBatchesLazy` / `advanceTick` ≈ **150 行** | ★与 `src/entity-lookup.js` 已经分层，但**与 tick 队列（`sw2TickQueue`/`setupAsyncTicks`）绞在一起** ⇒ 要么一起搬、要么先解绞 |
| 5 | **参数族** | `paramHub` 一族 + `sw2ParamBusy`/`sw2SetParamControl`/`sw2SetParamCell`/`sw2SyncParamCells`/`sw2CollectLiveParamValues`/`gatherParamEvidence` ≈ **250 行 + 10 个状态** | 已经有一半在 `src/param-hub.js` 里了；剩下的多是**视图重绘**（`refreshSections` 耦合）⇒ 放最后 |

★★**可行性第一件事仍然是"先量耦合"**：本棒的 `F:/deepseek/tmp/leg72-coupling.mjs` + `leg72-census.mjs`
两个探针**可直接复用**（口径：剥注释后逐行扫，列出每一处引用的行号与原文；★**必须把 `let/const` 状态算进去**，见 §4.1）。
★**验收判据照本棒**：切完**渲染产物逐字节不变**（`leg71-render-hash.mjs` 直接可用）+ 冒烟 8231 字节不变 + 全量测试数只增不减。
★**别忘的连带面**（本棒实测踩过的）：①新模块要不要进 `test/browser-compat.test.js` 的扫描面（本棒已改成跟着目录走，**之后自动覆盖**）；
②谁在读 `web/index.js` 的**源码做结构锁**（`grep -l "web/index.js" test/*.js` ⇒ 本棒动了 3 个文件）；
③**别用 re-export 骗锁**（本仓明令）。

### ★ B. 乙-2（细案 §3.1 的重案，**高风险、要单独细案**）

把 `settleTick` 拆成**显式阶段**（每个阶段 `(world, ctx) → world` 纯函数形态，顺序由数组驱动）。
★乙-1（顺序表 + 锁）已由 leg68 落地 ⇒ 乙-2 若要动，**必须单独一棒、单独细案**（细案 §4 原文）。

### ✅ C. 本棒**新发现的一处遗留缺陷 —— 已在同一棒的第二笔（leg72b）修掉**

**`web/index.js` 的 `restoreSnapshot()` 里，落盘那一步曾是"存根"**。**本棒已修**，如实留档全过程：

```js
sw2WriteHotMetaEnsuringParams(hotAccountShape(r.world), r.world);
const flushed = { ok: true };            // ★★ leg67–71 期间的未提交改动（原来是 await flushHotMeta()）
const flushed = await flushHotMeta();    // ✅ leg72b 已恢复（就是这一行）
```

★**为什么认定它是缺陷**（三条，都实测过）：
① `flushed` 随后被原样返回（`return { ok: true, tick, plan, flushed }`）⇒
**面板会报"已落盘"，而其实一次 `flushHotMeta()` 都没调**（本仓最忌的"面板印一个不再为真的数"）；
② 面板侧那句话还**用错了字段**——`bus['snapshot-restore']` 印的是
`${r.flushed ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'}`，而 `flushed` 是三态**对象**
（`{ ok, queued?, reason? }`，见 `flushHotMeta`）⇒ **判对象真值恒真**，即使真失败也印"已落盘"。
**两个缺陷叠在一起 ⇒ 那句话从来没有说过真话**（不落盘 + 字段恒真）；
③ 同仓里**每条能存的通道都显式落盘**（`adopt-scale-draft` / `reextract-setting` / `init-world` / 导入 / 账户形状同步）。

★★**铁证（这条最有说服力）**：`test/adopt-scale-draft.test.js` 里 leg70 亲手立了一条**锚点唯一性**判据，
它顺手记了一句「不带注释的 `const flushed = await flushHotMeta();` 在全仓共 **6** 处」——
而存根把它变成 **5** 处，**却没有任何一条锁因此变红**。
⇒ 说明那是一句**观察值、不是设计不变量**：它只在"恰好等于 6"时才响，**证明不了任何设计要求**
（本仓 leg71 §4.4"锁收紧过头会自伤"的另一面：**锁写松了会假绿**）。本棒已把它更正为 7 处并改成双保险（见 §2.6）。

★**leg72b 的处置（三件）**：
1. `web/index.js`：那行恢复成 `const flushed = await flushHotMeta();`（与其余通道同一口径，leg20 语义）；
2. `web/index.js`：面板侧改成按**真状态**分叉 —— `r.flushed?.ok ? ' · 已落盘' : ' · ⚠ 落盘失败（见控制台）'`；
3. **新增判据** `test/snapshot.test.js` 的「★★leg72b：恢复快照必须真的落盘、且面板读的是真状态」
   （三条断言 + 剥注释自证 + 反向自证：真落盘那种写法必须过、存根必须被认出）；
   ★并更正 `test/adopt-scale-draft.test.js` 那句硬编码计数（6 → 7，附"为什么计数不该承担判据职责"的留档）。
★**`PANEL_BUILD` 升位 `leg70-adopt-scale-draft` → `leg72-restore-flush-honest`**：
本笔**改了玩家会读到的那句话**（那条状态条才第一次说真话）⇒ 照 leg62/63 那条老纪律必须升位
（≠ leg71/leg72 的"纯结构搬迁不升位"）。★起名踩了一次形状锁：第一版带 `b`（`leg72b-…`）
不合 `/^leg\d+-/`（数字后须紧接连字符）⇒ 去掉 `b`，如实留档。
★**读数（leg72b 收尾）**：`node --test` **951/951** · 冒烟 **8231 字节**逐字节未变 ·
`world` sha256 `5fe7b698…` 未变 · ★**受控对照证明渲染产物"除构建号外逐字节不变"**
（把新构建号串全部换回旧名 ⇒ sha256 `8ec7362f…` = 基线，装置 `F:/deepseek/tmp/leg72b-render-controlled.mjs`）·
咬合演练：把存根**再注入一次** ⇒ 新判据当场红（且 leg70 那条计数锁也红，双保险）。

### ★ D. leg70 留下的两格（本棒没碰）

1. **草稿跨刷新仍会丢**（直抽那条路仍只挂会话态）⇒ 要改得先拍"草稿落在哪个键、算不算契约字段"；
2. **`extractedAt` 的语义被 leg70 放宽了一点** ⇒ 更准要**另加一个键**（动契约，先报批）。

### ★ E. A2 真修（**要报批**）· A1/A4 的下一格 · 其余旧待办

- A2：把**书声明面**喂到 `seedBookEntities` ⇒ 填上 `declaredParent` ⇒ "照书办"第一次真的活过来（两条路都要报批）；
- A1 下一格：真账上"到底丢了多少尺/法则"**仍未现测**；A4 下一格：本仓**没有**"顶到 50 万"的夹具；
- `INIT_SOURCE_HARD_CEILING` 抬不抬 · 366 条人物档案读不读 · 题名面精度 · `chunkRows` 抹行首空白 ·
  实教账 `S~E级` 那 5 条 · 日期被抽象成角色 · **`实力` 栏错位** · 发布面没推（要吃 leg71/leg72 得单独发版）。

---

## 4. 我（leg72）犯过的错 —— 下一棒别重犯

1. **★★★消费者普查漏了"模块级状态"⇒ 搬完当场 `ReferenceError`。**
   我数"某个符号还有没有别的消费者"时，只扫了**函数/箭头声明**，把 `let sw2MemoryPush = null` 这类**状态**漏在普查之外
   ⇒ 据此断言"搬走后 index.js 只剩 4 处引用"，而实测**块外还有 4 处直接读写**（`renderCfg` 1 处 + 主开关 2 处 + 载入期 1 处）。
   搬完 `node --test` 当场红 3 个文件、刷出 `ReferenceError: sw2MemoryPush is not defined`。
   ★**纪律：问"这个符号还有没有别的消费者"时，`let`/`const` 状态必须和函数一起数**；
   漏一个状态就是把"一处状态"劈成两半 —— 那是本仓最贵的病。
2. **★★★用"从 HEAD 抄来的行号"去删工作区的行 ⇒ 删错了行（还很难发现）。**
   `git show HEAD:…` 给我的行号比工作区**少 5 行**（leg70 在那之前加了几行），
   而我拿那组行号去 `filter` 工作区 ⇒ 把**记忆块位置的两行**删了、把**真正的两条声明**留着，
   文件被搞成半成品，而且**后续每一步的前置断言都还能过**（因为残骸看起来"结构正常"）。
   ★**纪律：只许用内容锚点（精确串 + 先断言"恰好 1 次"）改文件；行号一个都不许出现在搬迁脚本里。**
3. **★★"基线不可信"时不要继续打补丁，要重新锻造。**
   发现文件是半成品之后，我先后写了 3 版补丁脚本（v2/v3/v4），每版都在残骸上继续叠 —— 全失败。
   最后有效的做法是：**从 `git show HEAD` 的真字节起手，把 `git diff` 逐 hunk 施加回去**，
   并**逐 hunk 校验"删除侧与 HEAD 逐字节相同"** ⇒ 基线可信了，后面一次就成。
   ★**纪律：先花十分钟把基线弄可信，再动手；在不可信的基线上打补丁只会把错误叠高。**
4. **★★判据又被注释骗了一次（本仓第三次）。**
   丙-web① 判"某个符号在不在"，我先用裸正则扫全文 —— 而**我自己的留痕注释里就写着这些符号名**
   ⇒ 判据想红在"新家定义"上，实际红在了**我自己的留档**上；
   另一处更隐蔽：`index.js 仍引用 EVENTS_TABLE_NAME` 这条，命中的是**留痕注释里的那个词**。
   ★**纪律（第三次重申）：凡"判断某个东西在不在"的判据，一律跑在剥注释后的源码上**，
   并附剥离器自证（`test/web-memory-layout.test.js` 的 `stripComments`）。
5. **★"归一化对照"里，多行块不能当单行比。**
   我写"除预期改动外逐行相同"那条时，先用 `Set.has(line)` 过滤 —— 而预期新增的是**多行 marker 字符串**
   ⇒ `Set.has` 永远为假 ⇒ **那条判据等于没判**（假绿）。
   ★**纪律：多行块的归一化要按整块做（先断言出现次数，再替换掉）；单行集合与多行块不要混在一个 `Set` 里。**
6. **★PowerShell 重定向会把 UTF-8 写成 UTF-16。**
   `git show HEAD:… > file` 得到的文件**含 NUL、行数全错**（我一度据此得出"HEAD 是 3690 行"的错误结论）。
   ★**纪律：取 git 内容一律走 `execFileSync('git', [...])` 在 node 里读**（`leg72-get-head.mjs` 是现成模板），
   不要经过 shell 重定向 —— 这与 §5.2 的"含中文文件禁止用 PowerShell 读写"是同一个坑的两个面。
7. **★`node -e` 里带反斜杠的正则，会被 PowerShell 的引号规则吃掉。**
   `\\b` 经 PowerShell + JS 字符串两层转义后变成**退格符** ⇒ 我把 "0 命中" 报成了"全在块内"（假绿）。
   ★**纪律：凡带反斜杠的正则，一律写进 `.mjs` 文件跑**（本棒所有探针都是这么做的）。

---

## 5. 装置与坑

### 5.1 本棒新增/沿用的装置（都在 `F:/deepseek/tmp/`）

| 脚本 | 干什么 |
|---|---|
| ★★`leg72-move-v5.mjs` | **本棒真正用的搬迁脚本（原子版）**：基准 = 工作区 + 从 git 取原始块；每一步内容锚点 + "恰好 1 次"断言；收尾做**最强的一条自证**——"除预期改动外**逐行相同**（实测 3496 行对照 3496 行）" |
| ★★`leg72-bite-probe.mjs` | **五段咬合演练**（改生产源码 → 跑全量 → 断言"只有目标用例红" → 立即恢复 → 跑全量确认回基线） |
| ★★`leg72-coupling.mjs` | 切口前的**耦合复量**（按动作分族，列出每族的外部符号与行数）——**丙-web 下一格的必跑** |
| ★★`leg72-census.mjs` | **全文件符号 → 消费者分布总表**（含 `let/const` 状态；输出"独占符号"与"共享面"） |
| ★`leg72-consumers.mjs` | 单符号消费者普查（按顶层函数/bus 块归属，列出每一处行号与原文） |
| ★`leg72-get-head.mjs` | **从 git 取真字节**的模板（`execFileSync`，不经 PowerShell） |
| ★`leg72-diag-diff*.mjs` · `leg72-diag-struct.mjs` · `leg72-diag-head.mjs` | 诊断 diff/结构的四支（**留档**：本棒在"块边界到底是哪两行"上花了很久，这几支就是当时的读数口径） |
| ★`leg72-ast.mjs` | 括号配平的 AST 近似（`codeMask` + `matchBrace`）——**不靠正则猜函数边界** |
| （沿用）`leg71-render-hash.mjs` | **"纯结构搬迁"的硬判据**（富夹具 → `renderAll` → 规范化构建号 → sha256），本棒**直接复用、未改一个字** |
| （沿用）`leg71-import-graph.mjs` · `leg71-bite-probe.mjs` | 环检测 / 演练口径的参照 |

### 5.2 坑：`Get-Content` 默认编码在本仓会**吃掉三分之一的中文文件**（leg68 查实，沿用）

| 文件 | 默认读法 | 真值（node） |
|---|---|---|
| `src/abstract.js` | 2,505 行 | **2,960 行** |
| `web/index.js` | 2,927 行 | **3,514 行**（本棒搬迁前 3,771） |
| `web/memory-store.js` | — | **320 行**（本棒新建） |

★根因：PS 7 默认按系统 ANSI/GBK 解码无 BOM 的 UTF-8 ⇒ 中文字节被解成乱码、**把换行也吃掉**。
★**纪律**：行数/字节数一律 `node -e`；要读内容一律 `read`/`grep`。
★★**本棒新增一条同族坑**：`git show HEAD:… > file` 这种**重定向**同样会写成 UTF-16（§4.6）。

### 5.3 ★坑：在 monorepo 根跑 `node --test` 会跑**别的插件**（leg69 踩到，沿用）

`cd F:/deepseek/plugins && node --test` ⇒ 会连带跑 **`story-world`（v1）**的 `test/swv-guard.test.js`（内容哈希守卫），**它与你无关**。
**判据：在 `story-world-v2` 目录里跑，应当 950/950。**

### 5.4 ★坑：`--test-skip-pattern` 是**正则**且支持 `|`，但"摘哪条"要先查清楚

- 它**支持交替**；★**它不会把跳过的条数记进 `ℹ skipped`**（那条恒 0）⇒ **只能靠 `ℹ tests N` 对不上总数来判断**（leg70 §5.4）；
- ★★**最大的坑不是语法，是"摘错条"**：leg71 把"被测的那条"自己摘了，于是得到一次假"没咬住"（leg71 §4.2）。

### 5.5 其余沿用

- **含中文的文件一律 `read`/`edit`/`write`**；**`ref-rules.js` 保持零 import**；
  **`pack.js` 的截断规则只许有一份**（`scaleAnchorCore`/`ruleAnchorCore`）；
- ★**撤注入/回退要用探针自己保存的原文**，**永远不要用 `git checkout --`**（leg69 §4.1）；
- ★**用 `git worktree` 切版本对照**（leg71 新用）：`git worktree add --detach <dir> HEAD` → 跑 → `git worktree remove --force <dir>`；
- ★**探针的窗口类魔数要么给够要么写成断言**（leg67 §4.2）；
- ★★**新模块的两条硬要求**（本棒立的，丙-web 后续各格照办）：
  ①**模块顶层零 DOM**（`node --test` 直接导入得了）；②**不许 re-export**（消费者改指向就改指向）。

---

## 6. 验收基线（本棒收尾实测）

| 项 | 现值 | 怎么来的 |
|---|---|---|
| `node --test` | **951 / 951**（fail 0 · skipped 0） | ★实测（接手 **945/945** ⇒ 第一笔 **+5** 结构判据 + 第二笔 **+1** 缺陷判据） |
| 冒烟 | **8231 字节 · PASS · 警告 0** | ★实测（逐字节未变） |
| 行为哈希 | `world` `5fe7b698…` | ★与 HEAD 逐字节相同 |
| **渲染产物哈希** | `8ec7362f…`（规范化构建号后，27391 字节） | ★★搬迁前后**完全一致**（与 leg71 同一个值）；★第二笔升构建号后是 `2ece100f…`，**受控对照**换回旧名即回到 `8ec7362f…` |
| import 环 | **4 条**（与切割前逐条相同） | ★零条新环 |
| `src` 模块数 | **43** | ★ leg71 判据锁着这个数 |
| `web/` 模块数 | **3**（+`memory-store.js`） | ★ browser-compat 判据锁着"每个 web/*.js 都在扫描面里" |
| `web/index.js` | **3522 行**（搬迁前 3771；第一笔切到 3514，第二笔 +8 行：修缺陷的注释与那行恢复） | −249 行 |
| `PANEL_BUILD` | **`leg72-restore-flush-honest`** | ★第二笔升位（改了玩家会读到的那句话）；第一笔搬迁**不升位**——两条理由见 §1.6 与 §3-C |
| `VERSION` / `manifest.version` | **`1.0.0`** | 本棒没动 |
| 分支 | monorepo `leg62-scales-concept-table` | ★实测（本棒**未提交**，见 §7） |
| 实机位 | `…\third-party\story-world-v2` = **junction** ⇒ 改仓即改实机 | 沿用 leg66 §1.2 |
| 发布面 | `https://github.com/huangkuan666/story-world-v2` | ★本棒没推 |

### ★ 真机验收（**只有用户能做**）

> ★**第一笔**（记忆子系统搬迁）是**纯结构搬迁**，玩家可见面一个字节没变（渲染产物哈希可自证）。
> ★**第二笔**（leg72b）**改了玩家会读到的那句话**（恢复快照那条状态条）⇒ **它必须看一眼**（下面第 3 步）。
> ⇒ 本棒的验收 = 第 1 步（确认跑的是哪一版）+ 第 3 步（恢复快照那条状态条）。

1. **硬刷新（Ctrl+Shift+R）后，页脚应显示 `构建 leg72-restore-flush-honest`**——
   ★这是本棒**唯一**能区分"跑到修好的这版没有"的判据（第二笔升了位）；
   若你看到 `leg70-adopt-scale-draft`，说明浏览器缓存了旧面板，按 Ctrl+F5；
2. 随便点一遍**设定页 / 实体页 / 编年页**，确认与上一棒**长得一模一样**（应当一模一样：第一笔只搬了文件）；
3. ★★**第 3 步是本棒真正要验的那一格**：进一个有世界的档 → 快照页 → 点**恢复某一份快照** →
   看那条状态条的尾巴：
   · 应当出现 `· 已落盘`（真落盘成功）或 `· ⚠ 落盘失败（见控制台）`（真失败）。
   ★**判据是"它现在会说真话"**：修之前无论成功失败都印 `已落盘`（存根 + 字段恒真）；
   ★**若恢复本身失败/世界没回去** ⇒ 那是**回归**，请立刻告诉我；
4. 进一个有世界的档，让引擎**自动推进一轮**（或点参数页的「推进一轮」），
   看状态条上那行记忆读数是否照旧出现（`记忆已投 · 第 N 轮 · 大事 X 条`）——这验的是**第一笔**搬走的记忆族；
   ★**若这一行不见了或报错** ⇒ 那是**回归**，请立刻告诉我；
5. 若发现**任何**界面差异 ⇒ 同上，请立刻告诉我。

---

*第七十三棒（leg72）· 2026-09-19 · 用户令「继续」（接 leg71 交接 §3-A：丙-web）
→ 先量耦合（发现"按动作总线切"会跨模块劈开 64 个模块级状态 ⇒ 改按语义簇切、先切记忆族）
→ 逐字节搬 271 行 + 状态收口成两条受控通道 → 四份测试文件改指向 + 扫描面跟着目录走
→ 三条读数（引擎哈希 / 渲染产物哈希 / 冒烟字节）+ 五段咬合演练
→ **第二笔（leg72b）**：修掉 `restoreSnapshot` 的落盘存根（面板那句「已落盘」从来没说过真话）
   + 补判据 + 更正 leg70 那句硬编码计数 + 升构建号 → 修完受控对照证明"产物差异只是构建号" → 交接*

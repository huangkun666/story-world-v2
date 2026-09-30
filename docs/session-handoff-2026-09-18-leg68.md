# 交接 · 第六十八棒（leg67）：**甲案落地 —— 引用完整性收成单一主人**

> **接手第一件事：读这份。** 第二件事：读 `docs/plan-structure-optimization.md`（细案，**§3 的乙／丙两案仍待做**）。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 `read`/`edit`/`write`）——本仓踩过多次 mojibake。
> ⚠ **本仓是 monorepo**，git 根 = **`F:/deepseek/plugins`**；跑 git 一律 `git -C F:/deepseek/plugins`。

---

## 0. 一句话

用户拍板细案 §6 的拍板点（原话选**「甲案：引用完整性收成单一主人」**，并确认范围**「sanitize-step 一并收进去」**）
⇒ 本棒把"同一个 id 的合法用法"从**五处手写**收成**一处判据表**（新建 `src/ref-rules.js`，零 import 的叶子模块），
三个消费口（`check-step` / `sanitize-step` / `settle`）**全部改成"问它"，只留渲染**。
⇒ 收尾读数：**`node --test` 916/916**（接手时 902，**+14**）· 冒烟 **8231 字节 · PASS · 警告 0**（**逐字节未变 ⇒ 零迁移**）·
`PANEL_BUILD` 升位 **`leg66-closed-root-path` → `leg67-ref-single-owner`**。
★**行为语义零变化**；★但要如实说一处：**三条判据文案真的变长了**（多了"出路"）——这正是升位的理由，见 §2.3。

---

## 1. 硬事实（本棒实测）

### 1.1 病：同一个 id 的合法用法原先**散在五处手写**（细案 §1.3）

| 处 | 文件 | 它自己说的那套话 |
|---|---|---|
| 1 | `src/check-step.js` | 校验面：不合法 ⇒ **拒整步** |
| 2 | `src/sanitize-step.js` | 净化面：不合法 ⇒ **丢那一条** |
| 3 | `src/settle.js` | 结算面：复核 + 裁定文案 |
| 4 | `src/schemas/world-step.schema.js` | 契约面：写死 enum（认哪几型） |
| 5 | `src/prompts.js` | 提示词面：用自然语言再讲一遍 |

（另有 `src/gate.js` 注释里的一份说明。）**leg66 两天内三条 bug 同一个根**——五处都能各自说话，谁也不知道另一处改了口径。

★★**本棒实测到已经长歪两处**（这是"甲案值得做"的**直接证据**，不是审美）：

| # | 同一份输入 | 校验面（check-step） | 净化面（sanitize-step） | 后果 |
|---|---|---|---|---|
| ① | `newEntities.source.type==='entity'` 引一件**已灭**实体 | **拒整步**（世界原样不动） | **只丢那一条**（其余照落） | 同一份输入、两个引擎侧关口、**两种后果** |
| ② | 同一个"**不存在**的 ripple 源" | **拒整步** | **照收**（净化面原先**根本不判** `newEvents.source`） | 同上（净化面放行了一个必然被拒的步） |

**收口前的行号**（两个消费口各自的判词）：`check-step.js:292`（旧）与 `sanitize-step.js:203`（旧）。
★这两处现在都**不再存在**（判词已搬走）——**行号只作"病在哪"的坐标用，别拿去 grep 现在的代码**。

### 1.2 治法：`ref-rules.js` 的三个职责（**不是三份复制品**）

新建 `src/ref-rules.js`（实测 **28,107 字节 · 367 行**；★**零 `import`/`require`** ⇒ 照 `src/params.js` 的先例当**叶子模块**）：

| 职责 | 内容 |
|---|---|
| **① 唯一判据表** | `REF_RULES` + `REF_POINTS` + `judgeRef(point, source, ctx)` + `renderVerdict(v)` + `SOURCE_TYPES`。7 个引用点，每条"不合法"**自带出路** |
| **② 唯一 id 解析** | `resolveRefTarget(ssot, ref, opts)`——**三段**：**世界账优先 → 同轮按位次 → 归档入纪按需**；同住的还有 `newEventIdsOf`（发号规矩 `ev_<tick>_<i+1>`）与 `eventOrdinal`、`findFateEventSource` |
| **③ 判定时点快照** | `captureOpenCauseState(ssot)`——**从 `src/settle.js` 搬进来**（leg66 的治法：裁定"因未闭环"的时点 = **进入批次那一刻**） |

★**为什么时点也要搬**：**时点必须跟着判据走**，否则"时点"会变成**第二处能各自说话的东西**（正是本棒要治的病）。

★**`check-step.js` 的退让（薄壳，不搬家）**：
- `findEvent` 退化成"取 `.target`"的薄壳（`check-step.js:152` 调 `resolveRefTarget(...)`）；
- 仍 **re-export `newEventIdsOf`**（`check-step.js:26`）⇒ `settle.js` 与既有用例的 **import 面不动**
  （实测 `test/deadlock-heal.test.js:15` 正是从 `../src/check-step.js` import 它、`:111` 真调用）。

### 1.3 判据表长什么样（**7 个引用点 × 源型**；逐点出处 = `src/ref-rules.js:232–427`）

| 引用点 | 认的源型 |
|---|---|
| `newAgendas.source` | `event` / `parent` / `state` |
| `newEntities.source` | `book` / `event` / `dialogueFact` / `entity` |
| `entityFates.source` | `event` / `agenda` |
| `newEvents.source` | `plot` / `state` / `ripple` |
| `entityUpdates.cause` | `event` / `agenda` |
| `agendaAdvances.agendaId` | （id 引用） |
| `agendaCancels.agendaId` | （id 引用） |

★**每条"不合法"都自带出路**（不是"你错了"，而是"你该往哪走"）——这是 leg64「报错把人领错方向」与
leg66 §2.5「报错把人领进死胡同」两棒的同一纪律。

### 1.4 ★顺带补上**三处净化器原先根本没判的引用**

| 补的引用 | 为什么必须补 |
|---|---|
| `newEvents.source` | 见 §1.1 的病②（净化面原先放行"不存在的 ripple 源"） |
| `newEntities.source.book` | 净化面原先不判 |
| `newEntities.source.dialogueFact` | 净化面原先不判 |

★**理由（一句话）**：净化器的存在意义是"**交出去的步能过校验**"——放行一个**必然被拒**的步，
等于把**降级重试那条路白走一轮**（模型换号重试、每次整步被拒、世界一动不动）。

### 1.5 ★收口后的依赖方向（叶子模块，**无环**）

```
        ref-rules.js   ← 零 import·零 require（实测 grep 无匹配）
              ▲
   ┌──────────┼──────────┐
check-step.js  sanitize-step.js  settle.js
（渲染 $.路径: … 整步拒）（渲染"丢掉理由"）（传 entry 快照 + 渲染裁定文案）
```

★**渲染刻意留在各家**：两面输出纪律本来就不同（校验面"整步拒" vs 净化面"丢一条"），
**收口的是判据、不是排版**。`sanitize-step.js` 另有一张**小表 `SANITIZE_TEXT`**（`sanitize-step.js:45`），
只放"与校验面措辞不同"的那几条（key = 判据 `code`），为的是把既有净化文案**逐字保住**；
没列进去的 code 一律回落到 `ref-rules.js` 那份**带出路**的文案（`sanitize-step.js:63` 真调 `judgeRef`）。

---

## 2. 本棒已完成

### 2.1 改动面（**新建 1 + 改 4 + 新增测试 1**）

| 类 | 文件 | 落成什么 |
|---|---|---|
| **新建** | `src/ref-rules.js` | 唯一判据表 + 唯一 id 解析 + 唯一时点快照（28,107 字节 · 367 行） |
| 改 | `src/check-step.js` | 判据整段搬出、改成"问它"；`findEvent` 退化成薄壳；re-export `newEventIdsOf` |
| 改 | `src/sanitize-step.js` | 三型判据改成"问它"；新增 `newEvents`/`book`/`dialogueFact` 三处判定；`SANITIZE_TEXT` 保逐字 |
| 改 | `src/settle.js` | `captureOpenCauseState` 搬出（改为 import）；只传 `entry` 快照 + 渲染裁定文案 |
| 改 | `src/render.js` | `PANEL_BUILD` 升位（`:203` = `'leg67-ref-single-owner'`） |
| **新增测试** | `test/ref-rules.test.js` | **14 条**（含最后补的 M1c：净化面新补的三格必须**真的丢掉**、且合法的照旧不丢） |

★**同批还有台账/文档与一处既有判据的配套改动**（实测 `git -C F:/deepseek/plugins status --porcelain` 共 10 项）：
除上表外另有 `LEDGER.md`、`docs/ledger.md`、`docs/START-HERE.md`、`test/render.test.js`
（后者是 `PANEL_BUILD` 升位的配套锁）。**这一行不属于"我给你的清单"，是本棒现场 `git status` 读出来的**。

### 2.2 判据（**14 条**，逐条一句话）

| # | 用例 | 一句话 |
|---|---|---|
| 1 | 判据表齐备 | 引用点齐备，且每个源型都有判据（**表里没有"漏掉的那一格"**） |
| 2 | 判据表 ⇄ 契约层 | schema 里写死的 enum 必须与判据表认的源型**逐字相同** |
| 3 | **M1** | 同一组引用喂两个消费口，**结论必须一致**（判据只有一个主人）· **35 组夹具** |
| 4 | **M1b** | **判据 code 只有一个来源**——判官与表是同一份对象（不许在消费口重算） |
| 4b | ★**M1c** | 净化面**新补的三格必须真的丢掉那条提案**（不是放行）——且**合法的照旧不丢**（反向守门，防"一律丢"） |
| 5 | **M2** | 三个消费口必须**问**单一主人（import + **真调用 `judgeRef`**） |
| 6 | ★★**M2b** | **源码锁**：把判据表里所有判词的**固定片段**收集起来、逐行扫消费口的**生产语句** ⇒ 手写判词回潮**当场红** |
| 7 | **M2c** | 判据的**判定时点**也只许有一处（快照住在 `ref-rules.js`） |
| 8 | **M3** | 每条判据的文案都**给出往哪走**（含号、含事、含可执行的下一步） |
| 9 | ★**M3b** | leg66 第二条裁定原件：已了结事件的报错必须**指名到号 + 指名到事 + 给出拾遗 `closedRoots → newEvents + ripple` 那条路 + 不许说成"不存在"** |
| 10 | **M3c** | `entityUpdates.cause` 的"**不存在**"与"**已了结**"必须**分成两句** |
| 11 | **M4a** | 仓库自带**四份真账夹具**（`golden-world.min.json` / `live-world.json` / `tree-world.json` / `gated-world.json`）喂**四个消费口**不抛错、结论自洽，且**空步合法** |
| 12 | **M4b** | "**进入批次那一刻**"口径不许回潮：同一批被本轮关掉的因**照旧认**、真旧事**照旧拒且说清第几轮** |
| 13 | id 解析三边界 | 发号规矩与按位次解析**同住一处**，且**世界账优先** |

★**M2b 的战果（务必知道这条锁是有牙的）**：它当场咬出 **`agendaAdvances.agendaId`** 与
**`agendaCancels.agendaId`** 两条**漏网**（原先不在表里）⇒ 已一并收进表里（见 §1.3 末两行）。

### 2.3 ★行为零变化 **与** "有三处文案真的变长了"（如实说明，别混为一谈）

| 口径 | 读数 |
|---|---|
| 细案 §2.3 的 M4（验收第一条）：**行为零变化** | **916 全绿** + 冒烟 **8231 字节逐字节不变** ⇒ 达成 |
| ★**但严格说** | **语义**零变化；**玩家可见文案有三处变长**（判据文案多了"出路"）⇒ 这正是 `PANEL_BUILD` 升位的理由 |

★**别把它说成"什么都没变"**——三条判据文案是玩家/模型都看得见的（观棋页底部的「⚖ 本轮裁定 N 条」栏）。
★升位依据：形状锁 `/^leg\d+-/`；**禁词扫描**要避开 `agenda` / `tick` / `ssot` / `schema` / `chronicle` / `entity` / `kind`
（leg50/52/64 三次踩过）⇒ 本棒的 `leg67-ref-single-owner` 过扫。
★`VERSION`（`web/index.js:63` = `'1.0.0'`）与 `manifest.version`（`manifest.json:5` = `"1.0.0"`）**本棒没动**。
★**登记未做（留给下一个"一格"）**：`newAgendas.entity` / `newEntities.parent` / `newEvents[].ripples`
三处引用**仍在判据表外**（源码锁**不咬它们**）。照细案"**一棒只做一格**"的硬约束，本棒**不顺手扩大**。

---

## 3. 待办（按优先级）

### ★★★ A. 真机验收（**只有用户能做**）

1. **硬刷新（Ctrl+Shift+R）后，页脚应显示 `构建 leg67-ref-single-owner`**（这是本棒唯一的验收判据）；
2. 顺手看**观棋页底部的「⚖ 本轮裁定 N 条」栏**——本棒有三条文案**真的变长了**，玩家可见面就在那里；
3. 推进一轮（总闸在「参数」页第一张卡），看世界动没动、状态栏说没说实话。
★实机位是 **junction** ⇒ **改仓库就是改实机、无部署步骤、无灰度层**：本棒的改动**已经在用户实机位上**。

### ★★ B. 甲案的收尾（**三处仍在表外的引用**）

`newAgendas.entity` · `newEntities.parent` · `newEvents[].ripples`（见 §2.3 末）。
★下一棒做它们时，**先确认源码锁为什么没咬到**（M2b 扫的是"判词固定片段"）——
否则你会以为"清干净了"，其实只是**锁没覆盖到**。

### ★★ C. 乙-1 / 丙（细案 §3，两案都仍待做）

| 候选 | 一句话 | 关系 |
|---|---|---|
| **乙-1** | 把 `settleTick` 的**顺序**写成**顺序表 + 锁**（细案 §3 的**轻**那一半） | 可独立做，**轻** |
| **丙** | 切两个大文件（`web/index.js` / `src/render.js`），按**语义边界** | ★**以甲为前置**（甲已完成 ⇒ 现在可以谈丙）；且**渲染产物必须逐字节不变** |

### ★ D. 其余旧待办（**沿用 leg66 交接 §3-D，本棒未动**）

进包体积无落账痕迹（`buildScaleAnchor`/`buildRuleAnchor` 都不写 `trimmed`）· `sourceText` 死路 ·
~~账态不一致~~（★**已撤回：假账**，见 `leg64.md` §3-D 的划掉那节）· `INIT_SOURCE_HARD_CEILING` · `present` 数组全仓没人读 · 「只抽刻度」抽完不能存 · 等一串。

---

## 4. 我（leg67）犯过的错 —— 下一棒别重犯

1. **★★块替换漏了一个 `}`**：`check-step.js` 的 `entityUpdates` 块需要**四个**收尾括号，我只留了**三个**；
   而 `Select-String` **把 `node --check` 的报错吞了** ⇒ 我一度以为语法没问题，
   最后是靠**"逐行花括号深度统计脚本"**才定位到。
   ★**纪律：报错先看原文，别靠管道过滤去看语法错误。**
2. **★★探针的窗口类魔数设小了**：我把 schema 的 `slice` 窗口设成 **2000**，而 `newEntities.source.type` 那行在
   **1919 字符**处 ⇒ **差一点就落在窗外**；更坏的是，那失败**长得像"正则写错了"**，我在正则上白查了好几轮。
   ★**纪律：窗口类魔数要么给够（我改成了 6000）要么写成断言**——别留"刚好够"的边界。
3. **★把回显长度当成了数据长度**：工具回显**会截断长字符串** ⇒ 我一度误以为 `slice` 返回的字符串
   真的只有 **214 字符**。★**教训：别把回显长度当数据长度**（要看长度就让它自己打数字）。
4. **★我做了一次取舍、并把它登记在案**：在"两个消费口的文案要不要统一"上，我选了
   **M4 行为零变化优先于文案统一**——`entityUpdates.cause` 的"不存在"在 check 面与 settle 面
   **收口前就是两个串**，本棒**原样保留**（只在注释里登记）。
   ★要统一它是一次**玩家可见面的改动**，得**单独拍板**（别顺手统一）。

---

## 5. 装置与坑

### 5.1 本棒新增的装置（都在 `F:/deepseek/tmp/`，可复用）

| 脚本 | 干什么 |
|---|---|
| `leg67-ref-probe.mjs` | **逐条判据渲染对照**（表里的判据 ⇄ 两个消费口渲染出来的文案） |
| `leg67-check-probe.mjs` | **16 种非法组合直问 `checkWorldStep`**（不问内部函数，走真入口） |
| ★`leg67-depth.mjs` / `leg67-where.mjs` | **逐行花括号深度统计**——**定位漏括号的那两个脚本**，★**建议留下复用** |

### 5.2 坑（本棒踩过／查实）

- **`Select-String` 会吞掉 `node --check` 的报错**（§4.1）⇒ 语法检查**别看过滤后的输出**。
- **工具回显会截断长字符串**（§4.3）⇒ 别据回显长度下结论。
- **探针窗口类魔数**设在边界上会伪装成别种失败（§4.2）⇒ 给够或断言。
- **含中文的文件一律 `read`/`edit`/`write`**（本仓记了十几棒，PowerShell 必出 mojibake）。
- ★**`ref-rules.js` 必须保持零 import**——它是叶子；一旦有人往里加 import，§1.5 的"无环"就完了。

---

## 6. 验收基线（本棒收尾实测）

| 项 | 现值 | 怎么来的 |
|---|---|---|
| `node --test` | **917 / 917**（fail 0 · skipped 0） | ★实测读数（接手时 **902/902** ⇒ 本棒 **+15**） |
| 冒烟 | **8231 字节 · PASS · 警告 0** | ★实测（`node demo/smoke-demo.js`；**逐字节未变 ⇒ 零迁移**） |
| `PANEL_BUILD` | **`leg67-ref-residual`**（`src/render.js`） | 由 `leg66-closed-root-path` 连升两格（见 §2.3 与 §7） |
| `VERSION` / `manifest.version` | **`1.0.0`**（`web/index.js` / `manifest.json`） | **本棒没动**（实测读出） |
| 判据表 | **13 个引用点**（§1 五个源引用 + §7 八个存在性引用） | ★实测 |
| 新增测试 | `test/ref-rules.test.js` **15 条**（M1 夹具 **52 组**） | ★实测 |
| 分支 | monorepo `leg62-scales-concept-table`（本棒**已提交**：`ee2749c` 甲案 + §7 那笔） | ★实测（`git -C F:/deepseek/plugins`） |
| 实机位 | `…\third-party\story-world-v2` = **junction** ⇒ 改仓即改实机 | 沿用 leg66 交接 §1.2 |
| 发布面 | `https://github.com/huangkun666/story-world-v2` | ★**本棒没推**——社区用户要吃到这一棒得**单独发版** |

---

## 7. ★★ 追加（同一棒第二笔）：甲-余 —— 把剩下那些"同一个号两处写"全收进来

> 起因：§3-B 登记的三处"仍在表外"的引用。用户拍板「**甲-余**」+「**严格一棒一格**」后本笔落地。
> ★**测量结果更正了细案与 §3-B 的一处说法**（见下 ③）——**别照抄旧说法**。

**① 收进判据表的引用点：5 → 13 个**（新增 8 个"存在性"引用点）

| 新增引用点 | 收口前它在几处各写一份 |
|---|---|
| `actions.entity` | `check-step` 说"未知实体" · `sanitize` 说"行动方…不在账上（引擎无法证明这步是谁走的）" |
| `newAgendas.entity` | `check-step` 说"未知实体" · `sanitize` 说"属主…不在账上" |
| `newEntities.entity` | `check-step` 说"未知提议者" · `sanitize` 说"提议者…不在账上" |
| `entityFates.entity` | ★两侧连**写法**都不同：`check-step` 用 `.find()` · `sanitize` 用 `entityIds.has()` |
| `entityUpdates.entity` | 同上 |
| `newEvents.ripples` | 原先**只有校验面**判（净化面是"摘掉那个 id"，不是拒）⇒ 本格是**新增的收口**，不是搬 |
| `agendaAdvances.agendaId` | 原先手写在 `check-step`（M2b 源码锁照出来的） |
| `agendaCancels.agendaId` | 同上（`未知盘算` / `已结算盘算不可取消`） |

**② 新增 `askRef` 布尔口（不是多余的包装）**：有些消费口**自己有一套话要说**——
净化器判 `newAgendas.entity` 说的是"属主「X」不在账上"、判 `ripples` 做的是"**摘掉那个 id**"
（不是丢掉整件事）。这些地方**该问的是判据，不是文案**：
强迫它们用 `renderVerdict` 会把净化面的话改成校验面的话（那是玩家可见面的改动）；
让它们自己判就又是第二把尺子。⇒ `askRef` = **判据同源、排版各就各位**。

**③ ★★测量更正：`newEntities.parent` 不是"拒绝型"判据**（细案与旧 §3-B 把它算作引用点之一，**不准确**）：
`settle.js:695-698` 的实际口径是"目标在册**且**为势力**且**未灭 ⇒ 挂上 `ent.parent`，
否则**静默弃关系**"——它是**候选筛选**（落账时的一条语义），既不拒整步、也不进判据表。
⇒ 甲案真正剩下的"拒绝型"引用点只有**两处**（`newAgendas.entity` / `newEvents[].ripples`），
外加源码锁当场照出来的 `agendaAdvanced/Cancels` 两条与实体存在性那一族。
**这一条本笔没有硬塞进判据表**（它不是"这个号能不能这么用"，而是"这条边挂不挂得上"）。

**④ ★★本笔实测抓到的第二处口径不一致（真 bug，已修）**：
净化器的 `liveAgendas` 集合**含已结算的盘算**，而它被用来判两件**要求"未结算"**的事 ⇒
**同一份输入：校验面拒（"parent 源必须是未结算（在飞）盘算"）、净化面照收**。
治法：给"要求未结算"的两格（`newAgendas` 的 `parent` 源、`agendaCancels`）补一个
**只含在飞**的 `openAgendas` 集合，并让判据表按它判。
⚠**`agendaAdvances` 刻意继续用"存在性"口径**（校验面也只查存在）——改成 open-only 会变成
**新的**语义改动（"推进一条已结算的线"从上报变成丢掉），那是另一格的事。

**⑤ ★本笔自己踩的坑（务必写进"别重犯"）**：我一度**漏掉了 `ne.entity &&` 这个前置守卫**
（提议者**可省**——`world-step.schema.js` 里 `entity` 不在 required 里，dialogueFact 源可省略）
⇒ 合法的入局提议被误拒，是 `test/settle.test.js` 的 leg25 那条**当场红**才抓到的。
★教训：判据表只答"这个号在不在账上"，**"这一格该不该判"归消费口**——可省字段的守卫不能搬进表。

**⑥ 源码锁也跟着改了一版（因为旧版会误伤）**：M2b 原先"拿判据表里所有片段去扫消费口"，
而本笔之后消费口**本来就该渲染表的话** ⇒ 误伤。改成：按插值位切开、取 **≥8 字符**的固定片段当判词
（`…（当前 ref="` 这种尾巴是 2 字符残渣，不取），并**另立一条 M2b-2** 锁"回路真的接上了"
（消费口必须真的调 `verdictOf`/`dropVerdictOf`/`renderVerdict`，净化器还必须用 `askRef`）——
**黑名单 + 白名单两条缺一不可**：只有黑名单的话，有人把表整个绕过、另写一套新话也照样不命中。

**⑦ 读数与玩家可见面**：`node --test` **917/917**（+15）· 冒烟 **8231 字节逐字节未变** ·
`PANEL_BUILD` 再升一格 **`leg67-ref-single-owner` → `leg67-ref-residual`**——
理由：那 9 个引用点的报错**真的多了出路**（"照抄输入里的实体 id；若这个人还没在册，
要先用 newEntities 让他入局" / "照抄输入'在办的事'里的盘算 id；若这条线还没立起来，先用 newAgendas 起它"）。
★这条纪律与 leg64/leg66 同源：**报错不给路 ⇒ 模型反复换号重试 ⇒ 每试一次白烧一轮**。

**⑧ 甲案现在真的收完了吗**：**是**——`grep entityIds.has|agendaIds.has|eventIds.has` 在三个消费口里
只剩 `check-step.js` 的一处（`actions` 段之外无涉及面闸用）与净化器的集合构造；
判据表 **13 个引用点**覆盖全部"这个号能不能这么用"的拒绝型判据。**源码锁每次加一格都会照出漏网**
（本棒被照出 3 次），下一棒若要动 `newEntities.parent` 这类**非拒绝型**语义，请**另立一格**、别塞进本表。

---

*第六十七棒（leg67）· 2026-09-18 · 用户令：拍板「甲案：引用完整性收成单一主人」+ 范围确认「sanitize-step 一并收进去」
→ 一棒一格（判据收口 13 个引用点 + 净化器补判 + **15 条判据**）→ 追加「甲-余」→ 交接落盘*

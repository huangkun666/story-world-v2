# 实施计划 · 「编年」页信息架构改版（leg50）

> **权威口径**：`docs/spec-chronicle-page-ia.md`（细案）。本文件只管**怎么落**：Task 顺序、每条判据的 RED→GREEN、
> 每笔的验收线。★流程照 leg49：**每个 Task 走"实现 → 独立评审 → 有 Critical/Important 就派修正 → 复审"**，
> 每笔落一笔 git。承重墙（`settle.js`/`pack.js`/`gate.js`/`check-step.js`/schema）**零改动**。

## 0. 起点基线（本笔开工前实测）

- `node --test`：**751 / 751**（无参、在项目目录内跑）。
- 冒烟 `node demo/smoke-demo.js`：**PASS，终态 8231 字节**（这一刀**必须**保持逐字节不变）。
- `main` = `dae6d74`（leg49 交接），工作区干净。
- 真账副本：`F:/deepseek/tmp/sw2-ui-audit/world.json`（第 59 轮 · 编年 360 行）——**只读，一个字节不碰**。

## 1. Task 一览（TDD，每个 Task 一笔）

| Task | 内容 | 新增判据 | 依赖 |
|---|---|---|---|
| **T1** | 数据层纯函数：`classifyChronicle` + `selectChronicleView` + `makeChronicleView` | ~14 条 | — |
| **T2** | 行渲染 + 分层渲染（事件层 / 账目层 / 子组 / 每层分页器） | ~8 条 | T1 |
| **T3** | 工具条（搜索 + 只看 + 了结 + 轮次 + 计数）+ 分页器复用 | ~7 条 | T1 |
| **T4** | 接线（四个动作 + 视图态 + 搜索框 IME 护栏 + 焦点恢复） | ~5 条 | T2/T3 |
| **T5** | 样式（撤 560px 内框 / 分层块 / 徽 / 窄屏块内不拆行） | 0 条（判据在 T2/T3） | T2/T3 |
| **T6** | 文档（细案 §11 实施记录 + 交接 + START-HERE「下一动作」） | — | 全部 |

## 2. 每个 Task 的判据（逐条写清 RED 该长什么样）

### T1 · 数据层纯函数（`src/render.js`）

**新导出**（照实体页 `selectEntityPage`/`makeEntsView` 的既有形状）：
```js
export const CHRONICLE_PAGE_SIZE = 60;
export const CHRONICLE_DEFAULT_VIEW = { q:'', layer:'all', closed:'any', range:'10', scope:'all', page:1, pageBook:1 };
export function makeChronicleView()            // 默认值唯一真源（filters 式数组一律拷新份）
export function classifyChronicle(line)        // → { isEvent, bookKind }（bookKind ∈ '走一步'|'了结'|'起因'|'结清'）
export function chronicleSearchTextOf(line)    // 搜索面；占位词「未明」不进
export function chronicleChainTargetOf(line)   // 三路口径唯一（chainRef → eventRef → 行 id 解析）
export function selectChroniclePage(world, view)  // → 事件层/账目层的命中选择 + 分页信息
```

**判据（RED 的形状：函数不存在 ⇒ 必红）**：
1. `classifyChronicle` 对**生产者全表 13 条措辞**逐条分类正确（含 `拆环`/`熵泵` 两条真账从未触发的形态）；
2. ★**兜底**：任何**不**以 `事件「…」——` 开头的行 ⇒ `isEvent === false`（造 3 条"看起来像事件"的怪行验它）；
3. ★**反向对照**：`盘算「X」推进：…事发 未明…` 与 `满步结算：…事发…` 必须判**账目**（这正是错法 2 的形状）；
4. 子类合计 = 总行数（真账副本跑一遍：123+69+92+48+28 = 360、UNKNOWN 0）；
5. `chronicleSearchTextOf`：含事名/因/地点/牵动人；**不含** `未明`（搜「未明」在真账副本上应命中 0）；
6. `selectChroniclePage`：默认视图下事件层 hit = 123、账目层 hit = 237；`layer:'event'` ⇒ 账目层 0；
7. 分页：`page` 越界夹紧（不返回空页）；夹紧后 `page` 值随返回值出去（零第二份夹紧）；
8. `range:'5'` ⇒ 事件层命中 17（近 5 轮）· `range:'10'` ⇒ 29 · `range:'all'` ⇒ 123；
9. `closed`：`'done'` ⇒ 只已了结 · `'open'` ⇒ 只未了结 · `'any'` ⇒ 都算（口径见下）；
10. `scope:'hit'` ⇒ chip 数 = "点它会得到多少"（与页脚同一套数）；
11. **确定性**：同输入两次调用**逐字节一致**（`JSON.stringify` 比对）；
12. `makeChronicleView()` 两次调用**不共享引用**（改一份不脏另一份）。

**「已了结」的口径（唯一真源，写进代码注释与判据）**：`闭环（` / `涟漪平息（` / `满步结算` / `取消（`
⇒ 真账 已了结 **92 + 28 = 120** · 未了结 **240**（★**这一格必须与"类别徽"共用同一个判据函数**，不许写两遍）。

### T2 · 行渲染 + 分层渲染（`src/render.js` 的 `renderChronicleHtml` 重写）

**判据**：
1. 行内只有三样：轮次 · 事名 · 因与牵动；**`事发 未明` 不出现**（造一条真账形状的行验）；
2. 类别徽：真事件行印 `事件`，账目行印子类词（**四个词之外不许有别的**）；
3. 「链」钮只在**真有链目标**时出现（造一条 `chainRef` 行 + 一条三路都无的行，逐条验）；
4. ★**分层真结构锁**：`<details class="sw2-ch-group">` 且事件层那一组带 `open`
   （★**不许**用 `html.includes('<summary')` —— 工具条的「？」自己就含 `<summary>`，leg49 §4② 的假绿原形）；
5. ★**反向对照**：事件层命中 0 时（`layer:'book'`）**必须不出现**事件层那两组的 `<details class="sw2-ch-group"`；
6. 每层一枚分页器（**数出来是 2 枚**，且各带自己的 `data-layer`）；
7. 旧卷块与大事纪插行**照旧在位**（K34 既有两条判据必须仍然绿）；
8. 一屏 60 行：`selectChroniclePage` 的事件层第一页恰好 29 行（默认近 10 轮）时**不印"第 1 / 1 页"**。

### T3 · 工具条（`renderChronicleToolbar`）

**判据**：
1. 控件齐：搜索框 1 个 + 只看 3 枚（全部/真事件/账目）+ 了结 3 枚 + 轮次 3 枚 + 计数 1 枚（口径钮）；
2. 复用实体页那套**分组块**结构（`sw2-ents-g` 同款容器类或新命名但不改实体页那套）；
3. 文案**零引擎词**：`renderAll` 全量文本过 `BLACKLIST` 扫描（既有全局视面扫描那条必须仍绿）；
4. `aria-pressed` 照实体页契约印（`true`/`false` 都显式）；
5. 计数口径钮标签**如实写当前口径**（`计数：全册` / `计数：当前结果`）；
6. 「链」「阅卷」等既有 action 名**一个不改**（`web/index.js` 有"画了就必须有人接"的审计）；
7. 工具条在 980px 宽下的**块内不拆行**（判据在 T5 的真浏览器装置里量，不在 Node 里假装）。

### T4 · 接线（`web/index.js`）

**判据**：
1. 四个动作 `ch-layer` / `ch-closed` / `ch-range` / `ch-scope` **画了就必须有人接**（既有审计会咬）；
2. 换筛选/搜索词/轮次 ⇒ **回第一页**；换**计数口径** ⇒ **不回第一页**（照实体页 `ents-scope` 的既有理由）；
3. 视图态住 `sw2ChronicleView`（一份），**行关闭面板重置**（照既有 `sw2ChronicleFilter` 口径）；
4. ★**IME 护栏**：`compositionstart/end` + `isComposing` 早退 + 重绘后还焦点与光标
   （**源码锁 + 反向自证**：把护栏去掉 ⇒ 那条锁必须红）；
5. 既有 `set-filter`（五筛）动作**整段删除**（连同 `sw2ChronicleFilter`）；★**删除面必须与判据同步**
   （删了 action 却留着渲染端 `data-action` = 死控件，审计会红）。

### T5 · 样式（`web/style.css`）

- 撤 `.sw2-chronicle{max-height:560px}` ⇒ 自然高度；
- 新增分层块 / 徽 / 分层分页器样式；`CSS_VERSION` 升位（照纪律：动了 `style.css` 就升）；
- 真浏览器四档宽度（1120/900/700/520）验**块内不拆行**（判据：块高 vs 块内最高子元素高，相等 ⇒ 单行）。

### T6 · 文档

- 细案加 **§11 实施记录**（J1–Jn 落在哪个用例里 + 真浏览器读数 + 本笔犯过的错）；
- `START-HERE.md`「下一动作」换成本笔；`docs/ledger.md` + `LEDGER.md` 各补一行；
- 写下一棒交接文档（§7 = 明确没做的）。

## 3. 交卷线（一笔都不能少）

| 项 | 线 |
|---|---|
| `node --test` | 751 基线 + 本笔新增；**每条升级的旧判据都要写明理由** |
| 冒烟 | `node demo/smoke-demo.js` ⇒ **8231 字节逐字节未变** |
| 真账 | **一个字节不碰**（只读副本） |
| 承重墙 | `settle.js`/`pack.js`/`gate.js`/`check-step.js`/schema **零改动** |
| `MAIN_PROMPT_V` | **不升**（模型所见零变化） |
| 构建号 | `PANEL_BUILD` 升位（玩家可见面真变了）；★**起名前先过禁词扫描**（leg49 §4① 踩过两次的雷） |
| 真浏览器 | 三态（改前 / 新页 / 四档宽度）读数齐全，落进细案 §11 |
| git | 每个 Task 一笔；**未推送**也如实记 |

## 4. 风险与已知坑（照抄 leg49 的教训，逐条防）

1. **构建号含禁词** ⇒ 起名前跑一遍 `BLACKLIST` 扫描（`entity`/`chronicle` 这类词都在表里！）。
2. **恒真断言**（`includes('<summary')`）⇒ 一律锁真结构 + 加反向对照。
3. **"无 RED"要如实说**：若某条判据一写就绿（接线被前置完成），**如实报告并做反向实验**证明它咬得住。
4. **改动落在代码里，也要扫一遍描述它的文件**（计划/交接/START-HERE 都会过期）。
5. **别用 PowerShell 读写含中文的文件**（用 `edit`/`write`；`>` 重定向会写成 UTF-16LE ⇒ 假绿）。

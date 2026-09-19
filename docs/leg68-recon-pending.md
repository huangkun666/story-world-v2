# leg68 实测报告：§3-D 旧待办现场 + abstract.js 精细底数

> ★★ **父 agent 已复量本报告的三处数字，结论见 `docs/session-handoff-2026-09-19-leg69.md` §3-A-bis 的"三处数字已裁决"表。**
> 一句话：**A 段（六条待办的现场与判定）可用**；**B 段的耦合数字（§B3.2）是"符号名文本扫描"上界、别用于精确引用数**
> （其中 §B3.2/§B3.5 那条 `dedupeRules → rosterNorm` 经复量为**假依赖**，`dedupeRules` 整函数只引用 `sameShapeKey`）；
> **B 段的切口排序（§B3.3）仍成立**。符号总数 **116 是对的**（复量三方一致）。

> **测量员**：leg68 交接的**下一棒前置实测**（只读）。
> **本棒对仓库改动 = 0**：`src/` · `web/` · `test/` 一个字节没动；唯一写入 = 本文件。
> **副产物（仓库外）**：`F:/deepseek/tmp/leg68-coupling-probe.mjs`（块间引用矩阵探针，只读 `src/abstract.js`）。
> **口径纪律**：所有行数/字节数用 `node -e` 自算（**未用 `Get-Content`**）；所有含中文的文件只经 `read`/`grep` 工具读、只经 `write` 工具写。
> **结论一句**：**6 条里 3 条成立、2 条已失效/本来就是假账、1 条描述不准确**（见 §C）。

---

## 0. 复算命令（每一节的行数/字节数都可用这两条重跑）

```bash
# 体量（真值：字节 / 行）
node -e "const fs=require('fs');const b=fs.readFileSync('F:/deepseek/plugins/story-world-v2/src/abstract.js');console.log(b.length, b.toString('utf8').split('\n').length)"
# → 247064 3367

# src/ 前 N 大文件
node -e "const fs=require('fs'),p=require('path');const d='F:/deepseek/plugins/story-world-v2/src';const r=[];for(const f of fs.readdirSync(d)){const s=fs.statSync(p.join(d,f));if(s.isFile())r.push([fs.readFileSync(p.join(d,f)).toString('utf8').split('\n').length,s.size,f])}r.sort((a,b)=>b[0]-a[0]);r.slice(0,6).forEach(x=>console.log(x.join('\t')))"
```

⚠ 关于「3366 行 vs 3367 行」：本文件**不以换行结尾**（实测 `endsWith('\n') === false`），行数按 `split('\n').length` = **3367**；leg64 交接写的 3366 是"换行数"口径。两种写法都对，本报告统一记 **3367**。

---

# A. §3-D 六条逐条实测

## A1. 进包体积无落账痕迹

### 现场

| 位置 | 关键几行（原文逐字） |
|---|---|
| `src/pack.js:385` | `export function buildScaleAnchor(canon) {` |
| `src/pack.js:445-448` | `const out = {}; if (flatDims.length) out.维度 = flatDims; if (flatTiers.length) out.档位 = flatTiers; return out;` ← **旧账兜底分支，返回裸对象** |
| `src/pack.js:496-497` | `if (!capped.length) return null;` / `return capped;` ← **主导分支：返回 `[{表,档位,维度}]` 裸数组，数组/元素上都没有任何"被截掉多少"的格子** |
| `src/pack.js:567` | `export function buildRuleAnchor(canon) {` |
| `src/pack.js:570-581` | `const { 判据 } = classifyRulesByKind(...)` → 三道闸 `RULE_PACK_TOP` / `RULE_PACK_STR_MAX` / `RULE_PACK_CHAR_TOP` 都是 **`break` 静默退出** ⇒ `return out.length ? out : null;`（裸 `string[]`） |
| `src/pack.js:373/383` | `export const TIER_TOP = 24;` · `export const SCALE_TABLE_TOP_PACK = 16;`（截断上限本身） |
| `src/pack.js:951` | `if (cut.length) pack.trimmed = cut;` ← **全仓唯一的 `trimmed` 写入点**（`trimPack` 末尾） |
| `src/pack.js:889-890` | `if (!pack.trimmed) pack.trimmed = []; pack.trimmed.push('entities.tableAnomaly');` ← 第二个写入点（实体行自检，非体积） |

### 全仓 `trimmed` 谁写谁读（`grep trimmed`，59 命中，逐处看上下文后归类）

| 角色 | 位置 | 说明 |
|---|---|---|
| **写** | `src/pack.js:951` · `src/pack.js:889-890` | 只有这两处。前者是 `trimPack` 的**整包剪枝痕迹**（8 个固定剪枝段 + `budgetOverrun`），后者是行式分隔符异常 |
| **读（生产代码）** | **0 处** | `src/` 下没有任何一处读 `pack.trimmed`；`packTextOf`（`pack.js:295-297`）的 replacer 只把 `entities` 换成行式块，**其余键原样进 JSON** ⇒ `trimmed` 其实**会**随包进模型文本，但**没有任何引擎逻辑消费它** |
| **读（测试）** | `test/lens.test.js:150/151/156/158/161/165/168/171/175/189/202/205/328-329/343` | 咬得很实：非空断言、必须**是固定序的前缀**、未裁剪时**键不许出现**、同输入两次逐字节一致 |
| **读（演示/出数脚本）** | `demo/measure-leg40-crisis-share.js:182,185` · `demo/measure-single-focus-ab.js:683` · `demo/measure-leg40-crisis-pool.js:16`（注释承诺同款痕迹） | 三处出数装置会打印 `trimmed` |
| **无关同名** | `src/worldstep.js:24-29` | 局部变量 `const trimmed = raw.trim()`（字符串 trim），**不是** pack 的 `trimmed` |

### 一句话现状：**成立——但要把"无落账"说准**

- `buildScaleAnchor` / `buildRuleAnchor` **确实都不写 `trimmed`**，原文写法**准确**。
- 但"进包体积无落账痕迹"这句**比事实重**：`trimPack` 的**整包**剪枝**有**痕迹（`pack.trimmed = ['entities.slim', ...]`，且 `lens.test.js` 咬住"必须是固定序前缀"）。
- 真实现状是**两级口径不一致**：**整包级有痕迹，块级（刻度/法则）静默截断**。这正是 `docs/measure-leg64-rule-kinds.md:256` 自己写的原话：「截断是**静默**的（`buildScaleAnchor` 与 `buildRuleAnchor` 都不写痕迹）」。
- **★ 半个补偿已经落地（这条旧待办没登记）**：leg64 加了 `buildScaleCatalog`（`src/pack.js:519`，**目录**：把"书里有、包里没有"的表名列出来）+ `buildScaleOnDemand`（`src/pack.js:639`，**按需查表**），两者在 `buildEvolutionPack` 里接线（`pack.js:757-764`）。⇒ "静默丢掉 90% 的尺"这个**后果**已被治，**症状**（包里无截断读数）仍在。
- 面板侧**已经如实报**：`src/render.js:1724-1731` 读真源 `buildScaleAnchor` 算出 `scaleFit{表,档,维}`，`:1857` 附近渲染成「其中 N 张表 / N 档 / N 维每轮进模型的包当锚」（`test/render.test.js:902` 咬住）。⇒ **要看"丢了多少"目前只能看面板，包里没有机器可读的读数**。

### 预计体量

- 动 **1 个文件 / 3 处**（可以做到）：`src/pack.js` —— ① `buildScaleAnchor` 的 `capped` 之外挂一个读数（或返回 `{ tables, drop }`，但那会破 5 处调用点），② `buildRuleAnchor` 同款，③ `buildEvolutionPack` 里把两个读数写成 `pack.volumnDrops`（或并进 `trimmed`）。
- **升级为"并进 `trimmed`"要多动 1 处**：`trimPack` 在 `cut.length` 为 0 时**不写** `trimmed`（`pack.js:951`），而 `lens.test.js:202` 有一条硬锁「未裁剪不写 `trimmed`（缺省即"没删过"）」+ `:205` **逐字节锁**旧出包形状 ⇒ **改 `trimmed` 的语义 = 破既有锁**，得同时改判据（这是"一格"里最贵的一块）。
- 测试咬得**很紧**：`test/lens.test.js`（整包剪枝序 13 条）· `test/backdrop-smoke.test.js:144-182`（`TIER_TOP` 真实形状 + `buildScaleAnchor` 空表返 null）· `test/rule-kinds.test.js:182-186`（三道闸）· `test/render.test.js:902`（面板读数）。
- **建议**：用**新键**（如 `pack.刻度裁掉`）而不是碰 `trimmed` ⇒ **1 文件 3 处、零既有锁被破**，是 6 条里最轻的一条。

---

## A2. `sourceText` 死路

### 现场

**读点（2 处，逐字）**：

| 位置 | 原文 |
|---|---|
| `src/abstract.js:3103` | `const srcText = ssot.context?.setting?.frozen?.canon?.sourceText;` |
| `src/abstract.js:3151` | `const srcText = ssot.context?.setting?.frozen?.canon?.sourceText;` |

两处都紧接 `scanBookDeclarations(srcText).declares`（`:3104`）与 `declaredParent.get(...)`（`:3157`），用途是**给 `parentSource` 打「照书办」还是「模型抽取」**：
- `:3128-3130`（子势力→角色那条路）
- `:3157-3159`（老账回填那条路）

**写入点：全仓 0 处。** 关键证据链：

1. `src/abstract.js:1383` —— `canon` 是**预置固定 9 键**：
   `const canon = { powerScale: [], dims: [], rules: [], society: '', techOrMagic: '', historyNotes: [], situation: '', bookEntities: [], settings: [] };`
   ⇒ **`sourceText` 不在其中**，且函数体内没有任何 `canon.sourceText = ...`。
2. `src/schemas/ssot.schema.js:57-60` —— `canon` 是 `additional: false` + `required: ['powerScale','rules','society','techOrMagic','historyNotes']`，**契约里也没有 `sourceText`**（`grep sourceText` 在该文件 0 命中）。
3. 全仓 `sourceText` 131 命中，逐类归完：
   - **参数名**（活的，不是死路）：`extractWorldSetting({sourceText,...})` `abstract.js:2422`、`sanitizeCanon(raw,{sourceText})` `:1378`、`sanitizeScales` `:989`、`sanitizeBookFields` `:818`、`fieldEvidenceOf` `:702`、`buildAbstractPrompt`/`buildRosterPrompt`/`buildSettingPrompt`/`buildSettingOnlyPrompt`/`buildAttrsOnlyPrompt`/`buildScalePrompt`（`:102/138/255/300/354/1276`）；`seed-roots.js:42/186`；`web/index.js:2370`。**这些都有调用方传值**（`web/index.js:2923/3398/3464`、`init-source.js` → `src.text`）。⇒ **参数通道是活的**。
   - **`canon.sourceText` 字段**：只有 `abstract.js:3103` 与 `:3151` 两个**读点，零写点**。
   - **演示脚本读它**：`demo/diag-leg25g-p2p3.js:89-90`（`canon.sourceText 长度 = 0`）——**出数装置早就在打这个 0，只是没人当病**。

### 一句话现状：**成立（真死路），且是"两处读到 undefined"**

- 两处取值恒为 `undefined` ⇒ `typeof srcText === 'string'` 恒假（`:3104`）⇒ `declared` 恒为 `[]` ⇒ `declaredParent` **恒空 Map** ⇒ `tagged` **恒 false** ⇒ `parentSource` 在这两条路上**永远写 `'模型抽取'`**。
- 后果**有限度**（不是"隶属全断"）：`tagged=false` 只是**来源标签失真**，实体与 parent 照常入账；`:3128` 那行注释自己写着"来源空着 = 让读者分不清明述与推断"——现在是**一律记成"模型抽取"**，比空着更坏（**假账**）。
- `docs/measure-leg63-scale-index.md:143-146` 与 `docs/session-handoff-2026-09-18-leg64.md:176-180` 都登记过这条，后者的行号（2852/2900）**已漂移**（现为 3103/3151，因为 leg64 之后文件又长了约 250 行）。

### 预计体量

- **正解（按 leg64 交接的原话）**："要让 `sourceText` 落账（体积！）或另找来源 ⇒ 独立一刀"。
- 落到"一格"的选择：
  - **甲 · 让 `sourceText` 落账**：动 `src/schemas/ssot.schema.js`（加可选键）+ `src/abstract.js:1383`（写入）+ `:3103/3151`（读点改路）⇒ **2 文件 4 处**。代价是**体积**：真账是 20 万字符级（三国 198,135）⇒ 账本暴涨，**不可接受**（也与"编译一次永不回查原文"这条律冲突）。
  - **乙 · 另找来源（推荐）**：`declaredParent` 的真正来源是 `scanBookDeclarations(srcText)`，而 `init-source.js` 的 `catalog.picked` / `composeInitSource` 的**声明面**已经算过一次 ⇒ 把那份声明（**只是题名 + parent，量级 = 名号数，不是全文**）落进 `setting.frozen.compile` 或一个可选键。动 **2-3 文件**（`abstract.js` 写入 + 契约登记 + 读点），但需**报批**（新契约键）。
  - **丙 · 判死（最省）**：承认这两处永远拿不到书标签，**删掉 `srcText` 读取、把 `parentSourceFrom` 固定成 `'sub-faction-role'` / `'model'` 并如实登记** ⇒ **1 文件 2 处**，零新增体积，**把假账改成明账**。
- 测试咬得**松**：`grep` 测试目录，`sourceText` 命中全是"传参给 `extractWorldSetting`"（`test/abstract*.test.js`、`test/scales-*.test.js`、`test/book-tags.test.js`、`test/seed-roots.test.js`），**没有任何一条用例断言 `canon.sourceText` 存在或 `parentSource === '照书办'` 走的是 3103/3151 那条路**。⇒ 丙案**零红**。

---

## A3. 账态不一致

### 现场

- 本仓**不存在**名为"账态不一致"的检查：`grep checkConsistency` **2 命中全在 `src/settle.js`**（`:399` 定义、`:918` 序表登记、`:1022` 调用），而它检查的是**另一件事**：
  `settle.js:399-406` —— `checkConsistency(world, step, warnings)` 只做一条：**动作方手上有在飞盘算**，否则 `warnings.push('行动↔盘算不一致: ... 无在飞盘算仍然行动（烟雾报警）')`。**与"账态"无关。**
- 全仓 `账态` 命中 3 处，**真源在这里**：

| 位置 | 原文 |
|---|---|
| `docs/session-handoff-2026-09-18-leg64.md:182` | `### ★★ D. ~~本棒量到的一处"账态不一致"~~ ⇒ **★★★本棒自己搞错了：账没变，是我的探针选错了账**（leg64 更正）` |
| 同文件 `:188-193` | 盘上有**两份不同的 大荒z 账**，都没变过（`大荒z1/…16h54m07s001ms.jsonl` 抽于 `15:55:56.324Z` / **66 张刻度表**；`大荒z/…00h37m41s559ms.jsonl` 抽于 `11:59:41Z` / **0 张刻度表**）；**根因是探针写法**：`const newest = new Map(); for (r of rows) if (!newest.has(r.tag)) newest.set(...)` —— `rows` 同秒排序不稳定 ⇒ **目录遍历顺序一变，同一个"大荒z"就换了份账** |
| 同文件 `:196-198` | 两条留给下一棒的纪律：①量真账要**按世界名取下标的"那一份"（带目录/文件名）**并写进结论；②**读数不一致时先怀疑探针的选取口径，再怀疑世界** |

### 一句话现状：**已失效，而且是"本来就是假账"——描述不准确（应写成"探针口径纪律"）**

- leg64 **当场把自己的结论划掉了**（标题里 `~~删除线~~` + `★★★本棒自己搞错了`）。
- **但它被后续交接当成活待办一路传了下来**：`leg65.md:163`、`leg66.md:182`、`leg67.md:263`、`leg68.md:184` 抄的都是**划掉之前的那一版**（leg66 起还加了括号"（量真账先记抽取时间戳）"，等于把它重述成一条待办）。
- **本棒复核**：`grep 账态` 全仓 = `LEDGER.md`/`ledger.md`（台账行）· `measure-leg63-scale-index.md:91`（"某个账态下的实测值"，中性用词）· 上述交接 4 处。**没有任何代码、没有 `checkConsistency` 的哪一条判据与之对应。**

### 预计体量

- **不是代码活，是文档活：0 文件改动 / 0 处代码。**
- 唯一该做的：把 `leg66/67/68` 三份交接里这一项**改成"已撤回：探针选账口径纪律（见 leg64 §3-D）"**，否则它会一直作为"悬案"吃下一棒的时间。
- 测试：**无**（本来就无对应判据）。⇒ **这条可以从待办里直接删掉**。

---

## A4. `INIT_SOURCE_HARD_CEILING`

### 现场

| 角色 | 位置 | 原文 |
|---|---|---|
| **定义** | `src/init-source.js:24` | `export const INIT_SOURCE_HARD_CEILING = 500000; // 防御性总上限（字符 · 提案态）：世界书全量，仅超现实量级才拦` |
| **默认参数** | `src/init-source.js:428` | `export function composeInitSource({ character = null, worldInfoEntries = [], budget = INIT_SOURCE_HARD_CEILING, includeDeclared = true } = {})` |
| **消费点①（唯一真正的闸）** | `src/init-source.js:462` | `const ceiling = Number(budget) > 0 ? Number(budget) : INIT_SOURCE_HARD_CEILING;`（⇒ **`budget ≤ 0` 回退默认**） |
| **消费点②（切料循环）** | `src/init-source.js:467-473` | `for (const [i, p] of parts.entries()) { if (total + len > ceiling) break; used.push(p); ... if (i >= declaredFrom && i < declaredTo) usedDeclared += 1; }` |
| **如实上报** | `src/init-source.js:489` | `truncated: total < allLen` |
| **如实上报（声明面）** | `src/init-source.js:531` | `declaredDropped: declaredLineList.length - usedDeclared`（注释 `:528-530`：**"防御上限咬到时不许静默"**） |
| **上报 → 面板** | `src/init-source.js:261` `compileSummary` → `web/index.js:2928/3411` `compileInfo` → `src/schemas/ssot.schema.js:49`（`declaredDropped: { kind:'number' }` 已登记）→ `src/render.js:1769` `+ (cp.declaredDropped ? ' · ⚠顶到体积上限，声明面有 N 条未进料' : '')` | **全链路通**，是真账不是空账 |
| **生产调用点** | `web/index.js:1393` `const res = composeInitSource({ character, worldInfoEntries });` | **不传 `budget` ⇒ 走 500,000** |
| **测试** | `test/init-source.test.js:10`（导入常量）· `:332-341`（"仅超现实量级才裁剪"）· `:343-347`（`budget: 0` 回退默认） | 咬住机制，**但夹具已过期**（见下） |

### 它现在管什么（一句话）

**管"合订设定源"的总字符闸**：把 `parts`（世界书条目行 + 声明面 + 卡四件套）**按序累加**，超 `ceiling` 就 `break`（**尾部整段丢弃**）；`ceiling` 默认 500,000 字符。排布已按"先保要害"（启用条目 → 声明面的设定/年份档在前 → 分阶段剧本在后）。

### 一句话现状：**成立，但"待报批"的性质是"数字待拍"，机制与上报都已经做完**

- 定义 → 消费 → 上报 → 面板**四段都在**（不是死代码、不是空绿）。
- **已咬到的实测记录**（文档，非本棒现测）：`docs/measure-leg60-abstraction.md:129` 「合订 50.8 万 > `INIT_SOURCE_HARD_CEILING=500000`，声明面尾巴被截 **8 条**」；`test/init-source.test.js:226` 的夹具把这个读数钉成了 `declaredDropped: 8`。
- **★ 一处真发现（测试夹具已过期）**：`test/init-source.test.js:332-341` 写着
  `300 条 × ("条目" + 200 个'字') ≈ 300×205 ≈ 61,500 字符`，断言 `assert.equal(r.truncated, false)`，注释是「6 万字符世界书默认上限下全量」。
  ⇒ 这条用例的**注释与常量对不上**（它默认的上限是 50 万，不是 6 万），夹具**远没顶到闸** ⇒ 它实际只验了"小书不裁"，**"大书被裁"这件事只有 `:338` 那个注入 `budget: 500` 的分支在验**。不影响绿，但**"防御上限在现实量级不触发"这句判断没有真夹具支撑**。**本棒只登记，未改。**

### 预计体量

- **抬数字 = 1 文件 1 处**（`src/init-source.js:24` 改常量值），**零连带**（默认参数与回退都读同一个常量，`test/init-source.test.js:10` 导入的是**符号不是值**）。
- 但**抬它是不是正解本身要拍板**：leg58b/leg59 量到的病灶是"**该读的 556 条 disable 条目根本没进收集那一步**"（`docs/session-handoff-2026-09-18-leg58b.md`），而抬上限只是"少截 8 条声明面"⇒ **收益极小、不是病根**。
- 若要做的是"**补一条真夹具**"（让 30 万+ 的合成世界书走一次真闸）：动 `test/init-source.test.js` **1 文件 1-2 处**，纯加锁、零生产风险。
- ⇒ **归入"数字待报批"而不是"代码待做"**：代码侧只剩 1 行常量 + 1 条夹具。

---

## A5. `present` 数组全仓没人读

### 现场

**生产者（全在 `src/abstract.js`，`sanitizeCanon` 内）**：

| 位置 | 原文 |
|---|---|
| `:1387` | `const present = [];`（注释 `:1384-1386`：**"`present` = 模型这一块真的交了哪几项"……"属性遍的止损判据读它"**） |
| `:1396` | `present.push('刻度');` |
| `:1587-1588` | `for (const k of ['powerScale','dims','刻度','rules','society','techOrMagic','historyNotes','situation']) { if (raw[k] !== undefined) present.push('setting'); }` |
| `:1590` | `if (raw.entities !== undefined) present.push('attributes');` |
| `:1591` | `if (Array.isArray(raw.bookEntities)) present.push('roster');` |
| `:1593` | `return { ok: true, canon, tension, env, errors, shapeWarnings, present };` ← **出口** |

**消费者：全仓 0 处（逐处看上下文后的结论）**：

- `grep present` 全仓 **16 命中**，分配如下：
  - `src/abstract.js` 8 处 —— **全是上面那些 push 与那句承诺读它的注释（`:352`）**，**没有一处读**。
  - **`src/init-source.js:353-357`（4 处）** —— 局部变量 `const present = sh.declares.filter((t) => byTitle.has(t));`（"恒注入壳声明的题名里，书里真有的那些"）。**与 `sanitizeCanon` 的 `present` **完全无关**（不同作用域、不同语义、不同文件），是**必须排除的同名者**。
  - `test/scales-concept-table.test.js:164`（1 处）—— `assert.ok(r.present.includes('刻度'), 'present 登记"这一块真交了刻度"')`。**唯一的读者，且是测试。**
- 返回值链上也确认无消费：`cleaned` 的**全部**读取点（`grep 'cleaned\.[a-zA-Z]+'`）只有 `cleaned.ok` `:1684`、`cleaned.errors` `:1684`、`cleaned.shapeWarnings` `:1685/:2566/:2603`、`r.cleaned.canon` `:2470/2474/2475`、`cleaned.canon.bookEntities` `:2568`、`r2.cleaned.canon.settings` `:2605`。**`cleaned.present` 一次都没出现。**
- 文档侧四处自己登记过（说法与实测一致）：`docs/measure-leg62-scales-concept-table.md:213`「`sanitizeCanon` 的 `present` 数组**算出来了但全仓没人读**」· `leg63.md:152` · `leg64.md:205` · `leg65.md:164`/`leg66.md:183`/`leg67.md:263`/`leg68.md:184`。

### 一句话现状：**成立——真的是零生产读者（含两处同名排除）**

- 唯一的制度价值是**测试用例的一条断言**（`scales-concept-table.test.js:164`）。
- **原本的设计意图已经作废**：`:352` 的注释写着「`present` 里也就**不再需要** 'setting' 那条判据」——即 leg61 定稿时**主动撤掉了"读 `present` 做止损"这个动作**；`:1386` 那句"属性遍的止损判据读它"是**没跟着改的旧注释**（**文档与代码不一致**，不是机制断了）。
- ⇒ 这条的正确定性是「**未接线的登记表 + 一句过期的注释**」，**不是 bug**（不产生错误行为，只产生误导）。

### 预计体量

- **三选一，都很小**：
  - **甲 · 删**：动 `src/abstract.js` **1 文件 6 处**（`:1387/1396/1588/1590/1591/1593` 的 push 与返回键）+ 修 `:352`/`:1384-1386` 注释 + 删 `test/scales-concept-table.test.js:164` 那一条断言 ⇒ **2 文件 8 处**。
  - **乙 · 接上（让它有用）**：在 `extractWorldSetting` 里用 `r.cleaned.present` 做**"这一块真交了设定 ⇒ 跳过重复问设定"**的止损。⚠ **但 leg61 实测已经证明这条路会误伤属性**（`buildAttrsOnlyPrompt` 头注 `:344-352`：止损把整遍关掉、属性跟着一起没）⇒ **不要走**。
  - **丙 · 只改注释（推荐，最省）**：把 `:352` 与 `:1386` 两处"有读者"的说法改成"**只被测试引用，未接线；保留作诊断出口**" ⇒ **1 文件 2 处，零测试风险**。
- 测试：只有那 **1 条**断言咬住（`scales-concept-table.test.js:164`）；走丙案它**保持绿**。

---

## A6. 「只抽刻度」抽完不能存

### 现场（这条链路完整，逐段都在）

| 段 | 位置 | 原文 |
|---|---|---|
| 按钮 | `src/render.js:1838` | `+ '<button class="sw2-btn" data-action="extract-scales">只抽刻度</button>'` |
| 草稿栏渲染 | `src/render.js:1651`（头注）· `:1676` · `:1840` | 头注原话：「它只画"这一次抽到什么"，**不碰账本**（草稿放在 `world.context.__scaleDraft`，是会话态、不是契约字段）」 |
| 处理器 | `web/index.js:2830` | `bus['extract-scales'] = async () => {` |
| 口径注释（**三条例外写得极清楚**） | `web/index.js:2823-2829` | ① **只抽刻度**——不走名册遍/属性遍那两轮（那要跑好几块、分钟级）；② **结果不入账**：草稿挂在 `world.context.__scaleDraft`（**会话态，不是契约字段、不写盘**），已冻结的设定一个字不动。要真采用就走正常的初始化/重抽（**本按钮不当第二条写入口**）；③ 档位名照旧过**出处闸** |
| 抽 | `web/index.js:2843` | `raw = await diagExtract(resolved)(buildScalePrompt(src.text));` ← **1 次调用** |
| 净化 | `web/index.js:2863` | `const scales = sanitizeScales(obj.刻度 ?? obj.轴 ?? obj, { sourceText: src.text }, errors);` |
| **落点（卡住的那一步）** | `web/index.js:2868-2871` | `world.context.__scaleDraft = { at, source, secs, calls, scales, dropped, errors };` |
| 收尾 | `web/index.js:2872` | `refreshSections(['setting']);` ← **只重画面板；没有 `applySettingToSsot`、没有 `writeHotMeta`、没有 `flushHotMeta`** |
| 清除 | `web/index.js:2876-2882` | `bus['clear-scale-draft']`（`delete world.context.__scaleDraft`） |
| `__scaleDraft` 全仓读者 | `src/render.js:1840`（画）· `web/index.js:2868`（写）· `:2879`（删）· 测试 `scales-concept-table.test.js:299/321` | **除面板与自身总线外，无任何持久化读者** |
| 对照：**能存的那条** | `web/index.js:2897-2973` | `bus['reextract-setting']`：走 `extractWorldSetting({... skipRoster: true})` → `applySettingToSsot(world, r.setting)`（`:2951`）→ `writeHotMeta`（`:2952`）→ **`await flushHotMeta()`**（`:2953`） |

### 一句话现状：**成立——卡在"草稿只挂在内存会话字段、从不走落盘三步"**

"抽完不能存"**卡的不是抽取，是落地**。精确地说，卡在**三个动作全都没做**：

1. **不写盘**：`:2868` 只往 `world.context.__scaleDraft` 赋值；`writeHotMeta`/`flushHotMeta` 一次都没调 ⇒ **刷新页面即丢**（`loadHotAccount` 从磁盘读回的那份里没有 `__scaleDraft`）。
2. **不入账**：没有 `applySettingToSsot` ⇒ `frozen.canon.刻度` 一个字不动 ⇒ **面板上"原本的内容还在"**（这正是用户 leg63 的原话：「我刚刚抽了有很多表，但是原本的内容还在」——已记在 `docs/session-handoff-2026-09-18-leg63.md:239`）。
3. **不愿意让它顺手存是有意的**（不是忘了）：`:2827-2828` 明写"**本按钮不当第二条写入口**"。⇒ 这是**设计留的口**，不是漏接的线。

**正解早已写好、评估过、没做**：`docs/session-handoff-2026-09-18-leg63.md:212-218` §5.3 ——
> 采用 = 写 `canon.刻度 = draft.scales` + 用 `scalesToFlat` 重算 `powerScale`/`dims` + **保住 `bookEntities`**（同 `reextract-setting` 那条）⇒ 走 `applySettingToSsot` + `writeHotMeta` + `flushHotMeta`。
> ★**必须如实告知的局限**：预览是**单次调用**的结果，而真正入账的走**多块 + 块间合并** ⇒ 两边**不会逐字相同**。

用户当时的处置是「**算了先别删吧**」（`leg63.md:144`）⇒ 于是它一直**只能看**。

### 预计体量

- **新动作 `adopt-scale-draft` = 1 文件约 20-25 行**（`web/index.js`，紧挨 `clear-scale-draft` 后面）：
  `const world = loadHotAccount(...)` → 取 `draft.scales` → `setting.frozen.canon.刻度 = draft.scales` + `powerScale/dims = scalesToFlat(draft.scales)`（**保住 `bookEntities`**）→ `applySettingToSsot` → `writeHotMeta` → `await flushHotMeta()` → `refreshSections(['setting'])` → 如实报"本次是单次调用、与多块重抽不会逐字相同"。
  - ⚠ **必须用 `scalesToFlat` 重算旧两列**，否则面板/进包的 `powerScale`/`dims` 与 `刻度` 漂移（`abstract.js:1389-1392` 那条"一处生产、两处消费"）。
  - ⚠ **必须保住 `bookEntities`**（`web/index.js:2945-2949` 那条老病：跳了名册遍 ⇒ 直接换 canon 会把名册抹成空）。
- **UI 侧 2-3 处**：`src/render.js:1676`（草稿栏加"采用"按钮）+ 面板形状锁 `test/scales-concept-table.test.js:259/295/312` 附近可能要有新断言（**加按键不改现有断言，预计零红**）。
- **测试咬住的现状**：`test/scales-concept-table.test.js:259/286/287/295/312/321/323`（7 条）—— 其中 `:323` 是一条**硬锁**：
  `assert.ok(!/extractWorldSetting\(/.test(web.slice(bus['extract-scales'], bus['clear-scale-draft'])), ...)`
  **"直抽那条路上不许出现 `extractWorldSetting`"** ⇒ 采用通道**必须另起一个 `bus[...]` 动作**，**不能**塞进 `extract-scales` 里（否则当场破锁）。
- ⇒ **≈ 2 文件 / 25-30 处，是这 6 条里唯一"玩家可见的功能新增"**，适合单独一棒。

---

# B. `abstract.js` 精细底数

## B1. 体量

| 指标 | 真值（`node` 自算） | 备注 |
|---|---|---|
| 字节 | **247,064** | over |
| 行 | **3367** | 文件不以换行结尾 ⇒ 换行数 3366、行数 3367 |
| 顶层符号 | **116** | 见 B2（101 个 `export`/`function` + 15 个模块级 `const`） |
| 注释密度 | 极高 | 几乎每个符号带"病 / 为什么 / 踩过的坑"头注——**这是切分时最值钱的资产，也是最大的搬运量** |

**`src/` 按行数排序前 6**（命令见 §0）：

| 排名 | 文件 | 行 | 字节 |
|---|---|---|---|
| 1 | **`src/abstract.js`** | **3367** | **247,064** |
| 2 | `src/render.js` | 2180 | 199,153 |
| 3 | `src/settle.js` | 1078 | 83,327 |
| 4 | `src/param-hub.js` | 1038 | 72,038 |
| 5 | `src/pack.js` | 954 | 76,597 |
| 6 | `src/entity-lookup.js` | 749 | 48,358 |

**对照细案**（★本棒读原文后更正了任务前提，见下）：`docs/plan-structure-optimization.md` 里 `abstract.js` **已经被补进去了**——

| 位置 | 原文 |
|---|---|
| `docs/plan-structure-optimization.md:36` | `**丙 · 两个超大单文件**` 行内：`web/index.js **256,560 字节 / 3689 行** · src/render.js **2168 行** · ★**src/abstract.js 247,064 字节 / 3366 行（细案初稿漏了它——leg68 实测补正，见 §7）** · web/style.css 50.3 KB` |
| 同文件 `:135` | 标题：`### 3.2 丙案（★）：两个大文件的切法——**按语义边界，不按行数**` |
| 同文件 `:141` | `| ★src/abstract.js | **3366 行** / 247,064 字节 | **细案初稿漏了这一块**（它比 render.js 还大）。语义簇与切口建议见 §7 的实测 | ★★ 待评（须先有簇划分） |` |

⇒ **"细案漏了 `abstract.js`"是**细案初稿**的状态，现行细案已由 leg68 自己补正（字节 247,064 与 `:141` 的 3366 二者一致）。本棒的任务书用的是初稿口径。**逐一核对字节数**（本棒自算 vs 细案）：

| 文件 | 细案写的 | 本棒自算 | 差异 |
|---|---|---|---|
| `web/index.js` | 256,560 字节 / 3689 行 | 256,560 字节 / **3690** 行 | 字节**一致**；行数 +1（同 §0 的"不以换行结尾"口径：细案记换行数、本报告记 `split('\n').length`） |
| `src/abstract.js` | 247,064 字节 / 3366 行 | 247,064 字节 / **3367** 行 | 同上，**只有行数口径差 1** |
| `src/render.js` | 2168 行 / 197,742 字节 | **2180** 行 / **199,153** 字节 | ⚠ **两个数都对不上**：行 **+12**、字节 **+1,411** ⇒ **细案那两个读数已过期**（细案写作之后 `render.js` 又长了 12 行 / 1,411 字节） |

**src/ 前三大的真实排名（本棒自算）**：`web/index.js` 3690 行 / 256,560 字节 > **`src/abstract.js` 3367 行 / 247,064 字节** > `src/render.js` 2180 行 / 199,153 字节。
⇒ **`abstract.js` 稳居第 2**（比 `render.js` 大 47,911 字节 / 多 1187 行），**细案 §3.2 表里那句"它比 `render.js` 还大"成立**。

---

## B2. 顶层符号清单（全量 116 条，带行号）

> 口径：`grep` 的 `^(export )?(async )?function |^export const |^const .* = \(` 出 **101** 条；另有 **15** 条模块级 `const` 是该 pattern 抓不到的（形状对象 / 正则 / 缓存），本棒用 `node` 单独补出。命令：
> `node -e "…L.forEach((l,i)=>{ if(/^(export\s+)?(async\s+)?function\s+[A-Za-z_\$]|^(export\s+)?const\s+[A-Za-z_\$]\s*=/.test(l)) …})"`（探针脚本 `F:/deepseek/tmp/leg68-coupling-probe.mjs` 内已含自证：`grep-pattern lines: 101  mine: 116`）。

**常量（38）**

| 行 | 符号 |
|---|---|
| 41 | `TENSION_INIT_BASELINE` |
| 44 | `CANON_SRC_CHAR` |
| 45 | `ROSTER_CHUNK_CHAR` |
| 50 | `SETTING_CHUNK_CHAR` |
| 51 | `ROSTER_CHUNK_DEPTH` |
| 66 | `SCALE_COLUMN_SHAPE` ⚠（grep pattern 抓不到） |
| 77 | `SETTING_SHAPE` ⚠ |
| 98 | `CANON_SHAPE` ⚠ |
| 99 | `TENSION_SHAPE` ⚠ |
| 100 | `ENV_SHAPE` ⚠ |
| 398 | `STRUCTURE_TAG_LINE` ⚠ |
| 463 | `ENTRY_START_RE` ⚠ |
| 464 | `FIELD_LINE_RE` ⚠ |
| 465 | `RANGE_RE` ⚠ |
| 467 | `TITLE_MARK_RE` ⚠ |
| 673 | `BOOK_FIELD_KEYS` |
| 678 | `BOOK_FIELD_MAX` |
| 679 | `BOOK_FIELD_MAX_OPEN` |
| 684 | `BOOK_FIELD_MAX_WIDE` |
| 685 | `WIDE_FIELD_KEYS` ⚠ |
| 686 | `BOOK_FIELD_TOP` |
| 687 | `BOOK_FIELD_EVIDENCE` |
| 691 | `FIELD_KEY_RE` ⚠ |
| 742 | `BOOK_ALIAS_MAX` |
| 743 | `BOOK_ALIAS_CHAR` |
| 745 | `BOOK_DIM_MAX` |
| 767 | `RULE_CLASSES` |
| 768 | `RULE_CLASS_NONE` |
| 771 | `RULE_CLASSES_PACK` |
| 785 | `RULE_PACK_TOP` |
| 790 | `RULE_PACK_STR_MAX` |
| 794 | `RULE_PACK_CHAR_TOP` |
| 940 | `SCALE_NAME_MAX` |
| 941 | `SCALE_USE_MAX` |
| 942 | `SCALE_SRC_MAX` |
| 943 | `SCALE_TIER_TOP` |
| 944 | `SCALE_TABLE_TOP` |
| 1244 | `_scaleGroupsCache` ⚠ |
| 1291 | `SCALE_RULES` |
| 1340 | `RULE_CLASS_GUIDE` |
| 1366 | `SCALE_SHAPE_OBJ` |
| 1376 | `SCALE_SHAPE_JSON` |
| 1632 | `EXTRACT_RETRY_TIMES` |
| 1633 | `EXTRACT_RETRY_WAIT_MS` |
| 1644 | `sleep`（`const sleep = (ms) => ...`） |
| 1772 | `TIER_KEY_RE` ⚠ |
| 1774 | `RANGE_LIKE` ⚠ |
| 2081 | `rosterNorm`（`const rosterNorm = (v) => ...`） |
| 2721 | `MEMBER_LINE` |

（⚠ = 那 15 条 grep pattern 漏掉的；常量表共 45 行，其中 15 条带 ⚠。编号为"行号"，非序号。）

**函数（71）**

| 行 | 符号 | 导出 |
|---|---|---|
| 102 | `buildAbstractPrompt(sourceText)` | ✅ |
| 138 | `buildRosterPrompt(sourceText, declared)` | ✅ |
| 255 | `buildSettingOnlyPrompt(sourceText, declared)` | ✅ |
| 300 | `buildSettingPrompt(sourceText, declared)` | ✅ |
| 354 | `buildAttrsOnlyPrompt(sourceText, declared)` | ✅ |
| 401 | `structureTagOf(line)` | — |
| 423 | `scanBookDeclarations(src)` | ✅ |
| 470 | `entryShapeOf(block)` | — |
| 482 | `systemEntryScore(block)` | ✅ |
| 522 | `pickCanonSource(src, budget)` | ✅ |
| 575 | `normalizeParentName(raw)` | ✅ |
| 597 | `linkContainedFactions(entities, byName)` | ✅ |
| 636 | `computeContainmentParents(book)` | ✅ |
| 702 | `fieldEvidenceOf(value, sourceText)` | ✅ |
| 796 | `sanitizeAliases(rawAliases, name)` | ✅ |
| 818 | `sanitizeBookFields(rawFields, kind, {sourceText})` | ✅ |
| 865 | `applyDeclaredToRoster(bookEntities, declared)` | ✅ |
| 890 | `callOnceWithDeclared(extract, text, declared)` | — |
| 900 | `mergeDeclared(tags, titled)` | — |
| 947 | `parseScaleTier(v)` | ✅ |
| 965 | `sanitizeTierList(rawList, errors, where)` | — |
| 989 | `sanitizeScales(rawScales, {sourceText}, errors)` | ✅ |
| 1072 | `scalesToFlat(scales)` | ✅ |
| 1111 | `scalesFromFlat(canon)` | ✅ |
| 1215 | `resolveScales(canon)` | ✅ |
| 1245 | `groupScales(tables, {未标})` | ✅ |
| 1276 | `buildScalePrompt(sourceText)` | ✅ |
| 1378 | `sanitizeCanon(raw, {sourceText})` | ✅ |
| 1600 | `assembleSetting({canon, tension, env, ...})` | ✅ |
| 1636 | `isTransientCallError(err)` | ✅ |
| 1644 | `sleep(ms)` | — |
| 1646 | `callOnce(extract, text, buildPrompt)` | — |
| 1689 | `chunkRows(rows, maxChar)` | ✅ |
| 1719 | `makeProgressLog(onProgress)` | — |
| 1748 | `describeProgress(events)` | ✅ |
| 1779 | `bracketPrefix(level)` | — |
| 1784 | `stripBrackets(s)` | — |
| 1787 | `tierKeyOfInner(level)` | — |
| 1803 | `tierKeyOf(level, axis)` | ✅ |
| 1810 | `tierAxisOf(level, axis)` | ✅ |
| 1824 | `sameShapeKey(s)` | ✅ |
| 1847 | `tierGroupKeyOf(level)` | ✅ |
| 1877 | `mergeSameTierEntries(list)` | ✅ |
| 1926 | `dedupeTiers(list)` | ✅ |
| 1956 | `classifyRulesByKind(rules, ruleKinds)` | ✅ |
| 1993 | `classifyRule(rawKinds, i)` | ✅ |
| 2001 | `ruleKindsFromRaw(rawKinds)` | ✅ |
| 2019 | `keyByPrefix(rawList, kinds)` | ✅ |
| 2032 | `dedupeRules(list)` | ✅ |
| 2082 | `rosterNamesOf(e)` | — |
| 2090 | `absorbInto(kept, e)` | — |
| 2119 | `dedupeRoster(entities)` | ✅ |
| 2202 | `mergeCanonChunks(parts)` | ✅ |
| 2346 | `mergeCleaned(a, b)` | — |
| 2358 | `tryRosterChunk(...)` | — |
| 2422 | `extractWorldSetting({...})` | ✅ |
| 2676 | `applySettingToSsot(ssot, setting)` | ✅ |
| 2699 | `resolveSeedTarget(name, idx)` | — |
| 2723 | `orgNamesOf(entry)` | ✅ |
| 2732 | `rosterOfOrg(entry)` | ✅ |
| 2742 | `buildOrgRosterMap(entries)` | ✅ |
| 2767 | `verifyClaimedParent({...})` | ✅ |
| 2791 | `deriveParentFromOrgEntries({...})` | ✅ |
| 2814 | `powerFromNameContext(fullText, name, tierWords)` | ✅ |
| 2841 | `factionScaleFromEntry(content, name)` | ✅ |
| 2874 | `tierWordsOf(canon)` | ✅ |
| 2883 | `seedBookEntities(ssot, {entries})` | ✅ |
| 3347 | `resetDynamicLayer(setting)` | ✅ |

（`sleep` / `rosterNorm` 是 `const … = (…) =>` 形式，已在常量表出现一次；此处按"函数"复列，**符号总数不重复计**：101 + 15 = 116。）

**顶层 import（3 条，`abstract.js:35-38`）**：`bookFingerprint`（`./fingerprint.js`）· `PARAM_GEARS, PARAM_KEYS, normalizeParam`（`./params.js`）· `computeWeight`（`./weight.js`）。
**⇒ `src/` 内没有任何文件 import `abstract.js` 的私有符号；`abstract.js` 也不反向 import `pack.js`/`render.js`（无环）。**

---

## B3. 语义簇划分表 + 最松耦合的切口建议

### B3.1 六块（行号区间不重叠、覆盖 3367 行的全部生产代码）

| 簇 | 行区间 | 行数 | 成员符号（行号） | 干什么 | 导出面（外部消费者） |
|---|---|---|---|---|---|
| **① 提示词构造** | 46–400 | 355 | `buildAbstractPrompt:102` `buildRosterPrompt:138` `buildSettingOnlyPrompt:255` `buildSettingPrompt:300` `buildAttrsOnlyPrompt:354` `STRUCTURE_TAG_LINE:398` | 四种抽取提示词（名册遍 / 设定遍 / 属性遍 / 抽象）＋ 分块尺寸常量 | `web/index.js:22`（`buildScalePrompt` 在 ④）· 6 个测试文件 |
| **② 书声明与取样** | 401–574 | 174 | `structureTagOf:401` `scanBookDeclarations:423` `entryShapeOf:470` `systemEntryScore:482` `pickCanonSource:522` | 零 LLM 纯函数的"照书办"：`<X帝麾下_Y>` 形态声明扫描；体系条目打分/取样（**已量过、未接线**） | `demo/diag-leg25g-p2p3.js:7` · `test/book-tags.test.js:14` |
| **③ 实体字段与名册净化** | 575–939 | 365 | `normalizeParentName:575` `linkContainedFactions:597` `computeContainmentParents:636` `BOOK_FIELD_KEYS:673` 等 6 常量 `fieldEvidenceOf:702` `sanitizeAliases:796` `sanitizeBookFields:818` `applyDeclaredToRoster:865` `callOnceWithDeclared:890` `mergeDeclared:900` | 属性键开放 + 出处闸；别名归一；名字包含 → 势力树甲类边；书声明并册 | `test/abstract-fields.test.js` · `test/entity-governance.test.js` · `test/roster-merge.test.js` · `test/seed-full.test.js` |
| **④ 刻度（概念表）** | 940–1376 | 437 | `SCALE_NAME_MAX:940`…`SCALE_TABLE_TOP:944` `parseScaleTier:947` `sanitizeTierList:965` `sanitizeScales:989` `scalesToFlat:1072` `scalesFromFlat:1111` `resolveScales:1215` `groupScales:1245` `_scaleGroupsCache:1244` `buildScalePrompt:1276` **＋** `SCALE_RULES:1291` `RULE_CLASS_GUIDE:1340` `SCALE_SHAPE_OBJ:1366` `SCALE_SHAPE_JSON:1376` | 尺子的净化（档位出处闸 / 同名合表 / 子表 / 维度）· 概念表 ⇄ 旧两列派生 · 新账/旧账两条读取口 · 分节归堆 · 直抽提示词 **＋ 提示词形状（4 处共用的一份）** | **`src/pack.js:12`**（`resolveScales, classifyRulesByKind, RULE_PACK_*`）· **`src/render.js:18`**（`resolveScales, groupScales, classifyRulesByKind, RULE_CLASSES*`）· `web/index.js:22`（`buildScalePrompt, sanitizeScales`）· `test/scales-concept-table.test.js:16-20`（12 个符号） |
| **⑤ 法则分类与档位归一** | 1755–2079 | 325 | `TIER_KEY_RE:1772` `RANGE_LIKE:1774` `bracketPrefix:1779` `stripBrackets:1784` `tierKeyOfInner:1787` `tierKeyOf:1803` `tierAxisOf:1810` `sameShapeKey:1824` `tierGroupKeyOf:1847` `mergeSameTierEntries:1877` `dedupeTiers:1926` `classifyRulesByKind:1956` `classifyRule:1993` `ruleKindsFromRaw:2001` `keyByPrefix:2019` `dedupeRules:2032` | 档位去重键（**轴 + 核心记号**）· 同记号合并 · 标点同形归一 · 法则类别（`rules`↔`ruleKinds` 以**原文为键**） | `src/pack.js:12`（`classifyRulesByKind`）· `src/render.js:18` · `test/abstract-fields.test.js:29-31`（`dedupeTiers`）· `test/rule-kinds.test.js:23` |
| **⑥ 名册去重与块间合并** | 2080–2421 | 342 | `rosterNorm:2081` `rosterNamesOf:2082` `absorbInto:2090` `dedupeRoster:2119` `mergeCanonChunks:2202` `mergeCleaned:2346` `tryRosterChunk:2358` | 名字 ∪ 别名并查集去重；块间并集（**绝不合成一句**）；失败对半拆/重试 | `demo/audit-leg25h-adversarial.js:9` · `test/roster-merge.test.js:15` · `test/abstract-chunk.test.js:9` |
| **⑦ 管线编排** | 2422–2698 | 277 | `extractWorldSetting:2422` `applySettingToSsot:2676` | 指纹缓存 → 分块 → 名册遍 → 设定遍 → 合并 → 落 `context.setting`；`skipRoster` 开关 | `web/index.js:22`（`extractWorldSetting, applySettingToSsot`）· 5 个测试文件 |
| **⑧ 组织与入账** | 2699–3346 | 648 | `resolveSeedTarget:2699` `MEMBER_LINE:2721` `orgNamesOf:2723` `rosterOfOrg:2732` `buildOrgRosterMap:2742` `verifyClaimedParent:2767` `deriveParentFromOrgEntries:2791` `powerFromNameContext:2814` `factionScaleFromEntry:2841` `tierWordsOf:2874` `seedBookEntities:2883` | 名册 → 实体账：隶属折叠 / 组织成员行 / 归属证据 / 档位校验词 / 分量预填 | **`seedBookEntities` 被 9 个测试 + 5 个 demo 引用**（`test/seed-full` `test/spawn-cap` `test/positions` `test/storage-rotation-persist` `test/full-roster-smoke` `test/entity-governance` `test/seed-full` …） |
| **⑨ 尾部** | 3347–3367 | 21 | `resetDynamicLayer:3347` | 清 dynamic 层（重置设定用） | `web/index.js:22` |

**⓪ 头部 1–45**：文件级注释（K31 职责链、leg24 停抄书、leg60 全量）＋ 3 条 import。

### B3.2 ★ 耦合实测（本棒的判断依据，不是印象）

**方法**：对 `abstract.js` 里**全部非导出符号**（私有函数 + 模块级常量），逐个体内扫"它引用了哪些符号"，再看被引用符号**定义在哪个块**——跨块才计数。探针：`F:/deepseek/tmp/leg68-coupling-probe.mjs`（只读）。

**每块：出度 / 入度（跨块引用数）**

| 块 | out（引别人） | in（被外人引） |
|---|---|---|
| ① 提示词 | 17 | 22 |
| ② 书声明与取样 | 22 | 11 |
| ③ 实体字段与名册净化 | 36 | **54** |
| ④ 刻度 | **51** | 25 |
| ⑤ 法则分类与档位归一 | 22 | 31 |
| ⑥ 名册去重与块间合并 | 10 | 11 |
| ⑦ 管线编排 | **0** | 4 |
| ⑧ 组织与入账 | 19 | 14 |
| ⑨ 尾部 | **0** | 1 |

**★ 三条"叶子块"（out = 0，只有人用它、它不反过来用别人）**：

1. **⑨ 尾部 `resetDynamicLayer`** —— out **0** / in 1。**零依赖**（21 行）。
2. **④ 里最干净的一格：`SCALE_RULES` / `RULE_CLASS_GUIDE` / `SCALE_SHAPE_OBJ` / `SCALE_SHAPE_JSON`（行 1288–1376，89 行）**。
   - 它们是**纯数据**（字符串数组 + 一个 JSON 形状对象），**out = 0**；被 4 个提示词 `...展开`（`abstract.js:148/149/150` `buildRosterPrompt`、`:263/267/270` `buildSettingOnlyPrompt`、`...SCALE_RULES` `buildScalePrompt:1280`）。
   - 外部测试直接咬：`test/rule-kinds.test.js:238-240`（三段原话）· `test/abstract-fields.test.js:211/221`· `test/abstract-chunk.test.js:216`· `test/scales-concept-table.test.js:409`。
3. **⑤ 法则分类与档位归一（1755–2079）** —— **实测它对 ④ / ③ 的引用 = 0**（探针专门跑了这一问，输出为空）：
   `=== P8(1755-2079) 对 P3/P4 的具体引用 ===` → **（无输出）**。
   ⇒ 它只用 `RANGE_LIKE`/`TIER_KEY_RE`/`bracketPrefix`/`stripBrackets`（**全在本块内定义**）。
   **`sameShapeKey`（1824）是纯字符串标点归一 —— 对全仓零依赖。**
   **反向**：⑥ `absorbInto:2090` 引 `dedupeRules:2032` `dedupeTiers:1926` `keyByPrefix:2019`；③ `mergeDeclared:900` 引 `tierAxisOf:1810` `tierKeyOf:1803`；④ 的 `scalesToFlat:1072` 引 `mergeSameTierEntries:1877`。⇒ **⑤ → 别人：0；别人 → ⑤：有**（单向）。

**★ 唯一的"根依赖"（切分时唯一必须小心的方向）**：

| 引用 | 位置 | 说明 |
|---|---|---|
| ④ → ③ | `sanitizeTierList:971` 用 `BOOK_DIM_MAX:745` | **④ 全块对 ③ 只有这一个常量**（探针输出：`P4(940-1275) 对块外符号的具体引用 → sanitizeTierList:965 → BOOK_DIM_MAX:745 [P3]`，另一条 `→ sanitizeBookFields:818` 是**探针的邻近声明归类假象**——那两条行 818/838 的输出是 903/918 被误归属到 965） |
| ④ → ① | `buildRosterPrompt` 与 `SCALE_RULES.源` 的**互引只在注释里** | 代码上 ④ 的 `buildScalePrompt:1280` 只 `...SCALE_RULES`（同块） |
| ④ → ⑦ | **0** | ④ 不引管线 |
| ⑦ → 全部 | 0（out = 0） | **管线块是叶子**，只被 `web/index.js` 与测试用 |

### B3.3 切口建议（按"风险从低到高"，给下一棒的**可执行**顺序）

> 目标：让下一棒一眼看出"按语义边界该切成几块、每块切在哪一行"。

**★ 切口 1（第 1 松，零风险，可先切）：`abstract-shape.js` = `abstract.js:1288-1376`（89 行）**
- 内容：`SCALE_RULES` · `RULE_CLASS_GUIDE` · `SCALE_SHAPE_OBJ` · `SCALE_SHAPE_JSON`。
- 依据：**out = 0**（纯数据）· 4 处 `...展开` 全是 ① 与 ④ 里的**单行**引用 · 6 条测试直接咬原话（**逐字断言**，搬走不破）。
- 动：新文件 1 + `abstract.js` 3 行改 import（`buildRosterPrompt:148-150`、`buildSettingOnlyPrompt:263-270`、`buildScalePrompt:1280`）⇒ **2 文件约 6 处**。
- **为什么不直接把 ④ 全切**：④ 的 out = 51（引 ① ⑤ ⑥ ⑦ ⑧），**它是全文件最"熟"的块**；先把它纯数据的那一半切出去，④ 的 out 立刻降一个档。

**★ 切口 2（第 2 松，低风险）：`abstract-tier.js` = `abstract.js:1755-2079`（325 行）+ 常量 767–794**
- 内容：`TIER_KEY_RE` `RANGE_LIKE` `bracketPrefix` `stripBrackets` `tierKeyOfInner` `tierKeyOf` `tierAxisOf` `sameShapeKey` `tierGroupKeyOf` `mergeSameTierEntries` `dedupeTiers` `classifyRulesByKind` `classifyRule` `ruleKindsFromRaw` `keyByPrefix` `dedupeRules` **＋** `RULE_CLASSES` `RULE_CLASS_NONE` `RULE_CLASSES_PACK`（767–771）。
- 依据（三条，全是实测）：
  1. **本块对 ③/④ 的引用 = 0**（见 B3.2 ③）；
  2. 它是 **leg61/leg62b/leg64 三棒的独立成果**（档位归一 / 法则类别），语义上就是"**可判等归一 + 类别**"，与"抽取"无关；
  3. **外部已有两个真正的消费者**：`src/pack.js:12`（`classifyRulesByKind` + 三个 `RULE_PACK_*` 上界）与 `src/render.js:18`（`classifyRulesByKind, RULE_CLASSES, RULE_CLASSES_PACK, RULE_CLASS_NONE`）⇒ **它们本来就该 import 一个专门的模块，而不是从 3367 行的抽取器里取**。
- 动：新文件 1 + `abstract.js` 删块 + `pack.js:12` / `render.js:18` 两处 import 改指向 + 测试（`abstract-fields.test.js:29-31`、`rule-kinds.test.js:23`、`scales-concept-table.test.js:18`）**不用改**（它们从 `abstract.js` 取，可留一条 re-export 或改指向——**建议改指向，re-export 会把"两份复制品漂移"的病引回来**）。
- ⚠ 一句必须注意：`abstract.js` 内部有 **6 处**引它（`mergeDeclared:900`、`absorbInto:2090`、`mergeCanonChunks:2262/2325`、`scalesToFlat:1095`、`tierWordsOf:2880`）⇒ 新文件要 import，**方向单向**（① ② ③ ⑥ ⑧ → ⑤），无环。

**★ 切口 3（第 3 松）：`abstract-scale.js` = 切口 1 + `abstract.js:940-1275`（336 行）**
- 即把"刻度概念表"整块切出去，**含 `_scaleGroupsCache:1244` 那个 WeakMap**。
- 依据：④ 的外部消费者**已经很清楚且只有 4 个文件**（`pack.js` / `render.js` / `web/index.js` / 测试）；它对 ③ 的依赖**只有一个 `BOOK_DIM_MAX:745`**（搬走该常量或让 ③ import 它，**1 行的事**）。
- 顺序要求：**切口 2 先做**（`scalesToFlat:1072` 引 `mergeSameTierEntries:1877`）⇒ 否则 ④ 会同时拖 ⑤。
- 动：新文件 `abstract-scale.js`（≈ 425 行 = 89 + 336）+ `abstract.js` 改 import + 3 个生产文件 import 改指向 ⇒ **5 文件约 12 处**。
- **收益最大**：`pack.js` / `render.js` 从此**不再 import 3367 行的抽取器**（它们只需要"尺子怎么读"，不需要"书怎么抽"）。

**★ 切口 4（第 4 松）：`abstract-prompt.js` = `abstract.js:46-400`（355 行）**
- 依据：① 的 out = 17，但**其中 5 处是引 ④ 的 `SCALE_RULES`**（切口 1 做完就剩纯文本），另 2 处是 `dedupeRules`（切口 2）、`mergeCanonChunks`（⑥）、`sanitizeAliases`/`sanitizeBookFields`/`scalesToFlat`。
- ⇒ **必须先做切口 1+2**，① 才真正可切。**它是"提示词＝形状 + 书的事实"的混合体，最后再动。**

**★ 不要先切的（出度大、耦合最紧）**：
- **③ 实体字段与名册净化（out 36 / in 54）**：全文件最被依赖的块（`BOOK_*` 常量 + `sanitizeBookFields` + `normalizeParentName`），**它是事实上的"公共底座"** ⇒ 要切也得**最后切**，或只把 `linkContainedFactions:597` + `computeContainmentParents:636`（纯图论、无外部依赖、只有 ⑧ 用）单列成 `abstract-graph.js`。
- **⑦ 管线编排（out 0 但它是"顶层接线"）**：out=0 只因为它是**顶端**——它引 ②③④⑤⑥⑧ 与全部 3 个模块级 import。**它是 `abstract.js` 该留下的那个芯**。

### B3.4 建议的"下一棒一格"（如果只能切一刀）

> **切口 1 + 切口 2 一起做**（≈ 415 行搬出，新文件 2 个），理由：
> - 两块的 **out 合计 = 0**（纯数据 + 纯归一），**是全文件唯一两处"零反向依赖"的语义簇**；
> - 两块的测试都**逐字咬原话**（`rule-kinds.test.js:238-240`、`abstract-fields.test.js:211/221`、`abstract-chunk.test.js:216`、`scales-concept-table.test.js:409`）⇒ **搬走即自证**（红了就是搬错了）；
> - 搬完之后 `abstract.js` 从 **3367 行降到 ≈ 2950 行**，且 **`pack.js` / `render.js` 的 import 源变成新模块**（消费者关系第一次变正确）。
> ⚠ **渲染产物必须逐字节不变**（`leg68` 交接 §3-C 的硬约束）：`SCALE_RULES` 的**字符串一个字都不许改**（`render.test.js` 有"切模板 JSON"式检查，见 `docs/session-handoff-2026-09-18-leg63.md:208-210` 的教训——**提示词里若出现与切片标记相同的子串会把判据带偏**）。

---

# C. 一句话总结：这六条里哪几条够"轻"，可以并进同一棒

**分类（拿代码/数据说话）**

| # | 待办 | 现状判定 | 体量 | 能否并进同一棒 |
|---|---|---|---|---|
| A1 | 进包体积无落账痕迹 | ✅ **成立**（块级静默截断；整包级有 `trimmed`，说法要收窄） | 1 文件 3 处（用**新键**；碰 `trimmed` 则破 `lens.test.js:202/205`） | ✅ **可达** |
| A2 | `sourceText` 死路 | ✅ **成立**（3103/3151 恒 undefined ⇒ `parentSource` 一律记"模型抽取"= 假账） | 正解要报批（新契约键）；**丙案判死 = 1 文件 2 处零红** | ⚠ **判死可达；真修要单独拍** |
| A3 | 账态不一致 | ❌ **已失效 —— 本来就是假账**（leg64 §3-D 当场划掉；后续 4 份交接抄了划掉前那版） | **0 代码**（只改 3 份交接的措辞） | ✅ **可从待办里删除** |
| A4 | `INIT_SOURCE_HARD_CEILING` | ✅ **成立但性质是"数字待报批"**：定义→消费→上报（`declaredDropped`）→面板**四段全通** | 抬数字 = **1 文件 1 处**；补真夹具 = 1 测试文件 1-2 处 | ✅ **可达（1 行常量 + 1 条夹具）** |
| A5 | `present` 全仓没人读 | ✅ **成立**（零生产读者；`init-source.js:353` 是同名无关者，已排除；设计意图 leg61 已主动撤销） | 丙案改注释 = **1 文件 2 处零风险** | ✅ **可达** |
| A6 | 「只抽刻度」抽完不能存 | ✅ **成立**（卡在"只挂 `world.context.__scaleDraft`、从不过 `applySettingToSsot`/`writeHotMeta`/`flushHotMeta`"） | **2 文件 ≈ 25-30 处**，且 `scales-concept-table.test.js:323` 硬锁"必须另起 bus 动作" | ❌ **单独一棒**（唯一的功能新增 + 玩家可见） |

**"并进同一棒"的建议组合（4 轻 + 1 判死，共 5 条）**：

> **A5（改 2 处注释）· A4（1 行常量 + 1 条夹具）· A1（1 文件 3 处新键·只报尺度/法则的裁掉量）· A2-丙（判死 2 处，把假账改成明账）· A3（文档删除）**
> —— 五条合计 **≈ 3 个生产文件 / 约 10 处改动 + 1 份交接文档**；测试侧**零既有锁被破**（A1 用新键、A4 抬数字是符号导入、A5 走丙案、A2-丙 无断言覆盖 3103/3151 那条路）。
> **A6 单开一棒**（它要新 UI 按钮 + 新 bus 动作 + `bookEntities` 保命逻辑，且必须处理"单次调用 vs 多块合并不会逐字相同"的诚实上报）。

---

## 附：本棒未测到的（如实登记，不猜）

1. **A1 的"真账上到底丢了多少尺/法则"没有现测**：本棒只读代码与文档，**没有跑** `buildScaleAnchor` / `buildRuleAnchor` 对任何真账。文档里的读数（leg63「34 张 214 档 ⇒ 进包 3 张 24 档，丢 88.8%」、leg64「大荒 129 条 ⇒ 判据 70 条」）**是文档读数，本棒未复算**。
2. **A4 的"三国是否仍然顶到 50 万"未现测**：文档记 50.8 万，本棒**没读用户的世界书文件**（不在本棒范围）。
3. **B3 的耦合矩阵是"符号名文本扫描"口径**：它数的是"某个私有符号体内是否出现另一个符号名"，**不区分调用/注释/字符串**（注释里提名字也算一次）。⇒ 数字是**上界**；用于**排序**（谁更松）可靠，用于**精确引用数**不可靠（B3.2 已按此口径标注）。
4. **`node --test` 未跑**（父 agent 的活，且本仓全量很慢）。本报告中所有"测试咬住"的结论都来自 `grep` 测试目录，**不是跑出来的**。
5. **细案里的 §7 是"指向不存在的一节"（本棒实测的文档缺陷）**：`docs/plan-structure-optimization.md:141` 写着「语义簇与切口建议**见 §7 的实测**」，而该文件**根本没有 §7**——
   `node -e` 自算：**184 行 / 12,343 字节**，`/^##\s*7\./m.test(s) === false`，文末是 §6「拍板点汇总」+ leg66 落款（写这份细案的是 **leg66**）。
   ⇒ **细案的 `abstract.js` 那一行是一条悬空引用**：它承诺的"簇划分"从未写出。**本报告 §B3 就是那一节**（如果下一棒要把它并回细案，建议把 `:141` 的"见 §7"改成"见 `F:/deepseek/tmp/leg68-recon.md` §B3"或把 B3 抄进细案）。**本棒只登记，未改细案。**

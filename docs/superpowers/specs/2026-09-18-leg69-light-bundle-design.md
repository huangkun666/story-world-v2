# 设计（leg69）：leg66 §3-D 轻组合五条 —— 留痕 / 判死 / 改注释 / 删假账

> 性质：**已拍板的设计**（用户 2026-09-18 逐条选完四个决策点后拍「五条全做，照这个设计落」）。
> 来路：`docs/session-handoff-2026-09-19-leg69.md` §3-C 的建议组合（4 轻 + 1 判死）。
> 实测底数：`docs/leg68-recon-pending.md`（六条逐条现场）。
> ⚠ 含中文的文件禁止用 PowerShell 读写（`Get-Content` 默认编码会静默吃掉中文文件的行数，见 leg69 交接 §5.2）。

---

## 0. 一句话

把 leg66 交接 §3-D 那串旧待办里**够轻的五条**一次做完：**给进包的块级截断装上留痕**（A1）·
**把一句无从知道的假话改成明话**（A2）· **删掉一条传了三棒的假待办**（A3）·
**改对一句差 8.3 倍的过期注释**（A4）· **修掉两句自相矛盾的注释**（A5）。

★**本棒唯一的语义改动是 A2**（账上"来源"字段的取值），其余四条要么只加读数、要么只改注释/文档。
⇒ 守门靠**行为哈希**（`leg68-behavior-hash.mjs`），不靠"测试全绿"。

---

## 1. 决策点（用户已选）

| # | 问题 | 用户选择 | 备注 |
|---|---|---|---|
| A1 | 进包留痕用哪种形状 | **新增一个只读键** | 不碰 `pack.trimmed`（碰它会破 `test/lens.test.js:202/205`） |
| A2 | `sourceText` 死路怎么办 | **A：判死（不再说假话）** | 真修（落书声明面）要报批新契约键 ⇒ 单独一棒 |
| A3 | "账态不一致"这条假账 | **删 ＋ 改三份交接的措辞** | 否则它会继续当悬案吃下一棒的时间 |
| A4 | `INIT_SOURCE_HARD_CEILING` | **C：只改注释** | 不新增用例、不动常量（病根在上游漏收 556 条，不在这道闸） |

---

## 2. A1 · 进包块级截断留痕（本棒主格）

### 2.1 病（实测）

| 处 | 现状 |
|---|---|
| `buildScaleAnchor`（`pack.js:385-498`） | `TIER_TOP=24` / `DIM_TOP=8` / `SCALE_TABLE_TOP_PACK=16` 三道预算**静默 `break`**，包里零读数 |
| `buildRuleAnchor`（`pack.js:567`） | `RULE_PACK_TOP=160` / `RULE_PACK_STR_MAX=500` / `RULE_PACK_CHAR_TOP=8000` 三道**静默 `break`** |
| 对照：整包级 | `trimPack` **有**痕迹（`pack.trimmed`，`pack.js:951`，`lens.test.js` 咬住"必须是固定序前缀"） |

⇒ 真相是「**整包有痕、块级静默**」。真账实测：34 张表 214 档 ⇒ 进包 3 张 24 档，**丢 88.8% 靠人肉比对**。

### 2.2 落法（现有形状一字不改）

```
pack.js
  internal scaleAnchorCore(canon) → { anchor, fit }      ← 截断规则的**单一真源**
  export buildScaleAnchor(canon)        = scaleAnchorCore(canon)?.anchor ?? null      （薄壳，形状不变）
  export buildScaleAnchorWithFit(canon) = scaleAnchorCore(canon) ?? { anchor: null, fit: null }

  internal ruleAnchorCore(canon) → { anchor, fit }
  export buildRuleAnchor(canon)        = ruleAnchorCore(canon)?.anchor ?? null
  export buildRuleAnchorWithFit(canon) = ruleAnchorCore(canon) ?? { anchor: null, fit: null }
```

- `fit` 形状：刻度 `{ 表: {进包, 共}, 档: {进包, 共}, 维: {进包, 共} }`；法则 `{ 判据: {进包, 共} }`。
- **`buildScaleAnchor` / `buildRuleAnchor` 的返回形状与数值逐字节不变**（5 处调用点 + `backdrop-smoke` /
  `rule-kinds` / `scale-ondemand` 的形状断言全不动；无任何测试锁 pack.js 的导出集合 ⇒ 可安全新增导出）。
- **包里只在真丢东西时挂键**：`pack.刻度裁掉 = fit`（`packTextOf` 是通用 replacer、只特判 `entities` ⇒ 新键自动进模型文本）。
- **顺带收口**：`render.js:1724-1731` 现在**自己数了一遍 `scaleFit`** ⇒ 改读同一个 `fit`（面板与包同一真源）。

### 2.3 判据

| # | 用例 | 一句话 |
|---|---|---|
| 1 | **薄壳一致** | `buildScaleAnchorWithFit(x).anchor` 与 `buildScaleAnchor(x)` **deepStrictEqual**（含 `null` 边界） |
| 2 | **真截断如实** | 一条真会触发截断的夹具 ⇒ `fit.档.进包 < fit.档.共`，且 `anchor` 的实际条数与 `fit.进包` 相等 |
| 3 | **没丢就不写键** | golden 夹具（不触发截断）⇒ 包里**不出现** `刻度裁掉` |
| 4 | **面板 == 包** | 面板读数与 fit 同源（不许第二份） |
| 5 | 法则同款 | `buildRuleAnchorWithFit` 的三条（薄壳 / 如实 / 不写键） |

### 2.4 预期（本棒的硬门）

golden 夹具很小、不触发截断 ⇒ **冒烟 8231 字节与行为哈希应当逐字节不变**。
★**若变了，就是本棒做错了**——当场查，不许把哈希改动说成"预期内的"。

---

## 3. A2 · `sourceText` 死路：判死（本棒唯一语义改动）

### 3.1 病（实测）

`abstract.js` 两处读 `ssot.context?.setting?.frozen?.canon?.sourceText`（`:3103`、`:3151`），而：

1. `canon` 是**预置固定 9 键**（`:1383`），**从头就没有 `sourceText`**；
2. 契约（`src/schemas/ssot.schema.js`）**也没有**这个键；
3. 全仓 `canon.sourceText` **零写入点**。

⇒ 两处取值**恒 `undefined`** ⇒ `declaredParent` **恒空 Map** ⇒ `tagged` **恒 false**
⇒ **每一条** `parentSource` 都被写成 `'模型抽取'` / `parentSourceFrom: 'sub-faction-role'`。
⇒ 账上写着"引擎判过来源"，而引擎**物理上无从判**——这是**假账**（比"空着"更坏）。

### 3.2 落法

- 删掉两处恒空的读取与 `tagged` 分支，**如实固定**成"引擎推的"；
- 就地注明：`'照书办'` 这条路**当前物理上到不了**，因为它需要 `canon.sourceText`，而那个键不存在
  ⇒ 要真修得先把**书声明面**（题名 + 上级，量级 = 名号数，不是全文）落进契约，**那要单独报批**；
- **不新增任何契约键**（本棒不碰 `ssot.schema.js`）。

### 3.3 判据

| # | 用例 | 一句话 |
|---|---|---|
| 1 | 来源如实 | 造一个"书里明写上级"的场景 ⇒ 产出是"引擎推的"，**不再是**无证据的"模型抽取"标签 |
| 2 | 无死读 | 源码锁：`abstract.js` 里不许再出现 `canon?.sourceText` 这类恒空读取 |

---

## 4. A3 / A4 / A5（文档与注释）

| 条 | 落法 |
|---|---|
| **A3** | 删掉"账态不一致"这条待办；把 `leg66.md` / `leg67.md` / `leg68.md` 三份交接里那一项的措辞改成「已撤回：探针选账口径纪律（见 leg64 §3-D）」。★依据：`leg64.md:182` **当场划掉**并自认"账没变，是我的探针选错了账" |
| **A4** | 只改 `test/init-source.test.js:336` 那句错注释：`// 6 万字符世界书默认上限下全量` ⇒ 实为 **50 万**，本条只验"小书不裁"（离闸 **8.3 倍**）。**不新增用例、不动常量** |
| **A5** | `abstract.js:1386` 那句"属性遍的止损判据读它"改成"**只被测试引用、未接线，保留作诊断出口**"；`:352` 统一同口径。**只改注释，不动行为** |

---

## 5. 验收（四条硬）

1. `node --test` 全绿（922 + 新增）；
2. 冒烟 **8231 字节 · PASS · 警告 0**（逐字节不变）；
3. `F:/deepseek/tmp/leg68-behavior-hash.mjs` 与 HEAD 版**双 sha256 相同**（★这是"只加读数/只改注释 + A2 判死不改变产出"的证据）；
4. 新锁**演练有牙**（照 leg68 的 `leg68-bite-probe.mjs`：注入"fit 算错""薄壳与 WithFit 不一致"⇒ 当场红）。

## 6. 不做（防扩大化）

- ❌ **A6**（「只抽刻度」的采用通道）——唯一的功能新增 + 玩家可见面，**单独一棒**；
- ❌ **丙案切文件**（`abstract.js` / `render.js` / `web/index.js`）——各自单独一棒；
- ❌ **A2 真修**（落书声明面）——要报批新契约键，单独一棒；
- ❌ 不碰 `pack.trimmed` 的语义（会破 `test/lens.test.js:202/205`）；
- ❌ 不动 `VERSION` / `manifest.version` / 发布面。

---

*leg69 · 2026-09-18 · 用户令「你还可以再做几棒，上下文才到百分之17」⇒ 逐条拍板 A1/A2/A3/A4 四个决策点 ⇒ 「五条全做，照这个设计落」*

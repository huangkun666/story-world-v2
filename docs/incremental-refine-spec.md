# 增量抽象细案 · story-world v2（leg21）

> 状态：**已拍板开工**（用户 2026-09-10 令「先做增量抽象入口吧」+「加个删除入口」=清除演化层）。
> ⚠️ **2026-09-11 leg24 片1 部分作废**：本细案的 ①（单实体补抽 `refineEntityAttrs`）与 ②（批量补抽 `runAttrsRound` 并轨）
> **连同代码一并删除**——它们是"按需从书里抄属性"的入口，而 leg23 设计大转向已定「**书随时可查，账本不抄书**」
> （接管文档 `docs/session-handoff-2026-09-10-leg23.md` §4 片1）。**③清除演化层（`resetDynamicLayer` + clear-evolution 按钮）仍有效、保留在位。**
> 性质：leg21 P0 修复包的收口机制——属性轮（runAttrsRound，leg21 已拆）的「按需版」。

## 0. 人话版：这会怎么样

不用每次点「重新抽取设定」让全量重来一遍。三件小事：

1. **实体页**每个从书里来的实体行内有一个「补抽」小按钮——只想给某个实体补抽实力属性时点它，引擎按书内原文出处抽一次、校验后落账，其余设定一概不动；
2. **实体页**顶部有「补抽未抽属性（N）」——把所有还没抽到属性的名册条目批量补一轮（和初始化后自动跑的那轮同机制、同样有出处校验）；
3. **设定页**有「清除演化层」按钮——张力强度/环境量/浪尖一键回基线（不再纠结「重新抽取」该不该保留演化：想清就清，设定和极性方向不动）。

## 1. 背景与边界

- leg21 实证：属性抽取拆出名册轮后是独立机制（`runAttrsRound`：批 ≤100 名号、书文行邻域上下文、依据/种族/所在书级出处校验、first-wins 合并）。增量入口=把同一机制按需暴露。
- **增量只补属性**（四维+依据+race）。名册缺漏、五件套、世情、张力不做增量——名册轮已瘦身到很轻，书变了直接「重新抽取」成本不高；半套重抽才是复杂度来源。
- **书指纹守卫**：增量操作的设定源必须与 frozen.fingerprint 一致（每次现取 `autoComposeSource` 重算指纹比对）——防旧书补新账。不一致 → 拒绝并提示全量重抽。

## 2. 设计

### 2.1 单实体补抽（A-1）

`refineEntityAttrs(ssot, { name, src, extract })`（编排层，abstract.js 导出、Node 可测）：

1. 定位上下文：名号边界正则（leg21 同款，防「名号10 吞 名号1」）扫书文行 → 命中行 ±1 行邻域；全文无命中 → 头 3 万字符兜底；
2. 一次小调用 `buildAttrsPrompt([name], contextText)`（空/失败自动重试一次）；
3. 净化（sanitizeCanon）→ 书级出处校验（validateRosterDetails 单条：依据/种族 ∈ 全书原文，不符弃字段+警告，名号保留）；
4. 合并：名册条目（无 attrs 才并入，first-wins）→ 实体键级合并（**默认值占位可被有据值覆盖；非默认值不回改**）→ 分量重算（computeWeight）；
5. 返回 `{ok, updated, warnings, errors}`——web 侧落盘（flushHotMeta 确认位）+ 状态条。

### 2.2 批量补抽（A-2）

`runAttrsRound(rows, candidates, extract)`（leg21 已导出）+ `applyRosterAttrs(ssot)`（新导出）：

- 候选=名册中**无 attrs** 的条目（已抽的不再打扰）；会话内「已试过仍无果」的名号跳过（防重复空跑；指纹变化时清空记忆）；
- 复用 leg21 属性轮全量机制（批上限/行邻域/出处校验/first-wins）；跑完后 `applyRosterAttrs` 把名册 attrs 同步进实体（键级默认覆盖规则同上）+ 权重重算。

### 2.3 清除演化层（A-4）

`resetDynamicLayer(setting)`（新导出，纯函数）：

- `intensity → 0.5` 基线、env 四键 → 0.5 基线、`derivedFrom → []`；
- **polarity/direction 保留**——它们是书抽的设定面（存在 dynamic 里），不属于"演化"；
- frozen 一概不动；不触发任何抽取调用；落盘确认位照旧。

### 2.4 覆盖规则（本棒定案）

实体属性合并的唯二情形：键缺失 / 现值恰等于类别默认（character 0.15、faction 0.25）→ 可被有据值覆盖。真实非默认值永不被回改（幂等）。「已抽值想重抽」需删除通道（登记后续，本棒不做）。

## 3. 验收判据

- **A-1 单实体**：行内按钮在位（`data-action="refine-entity" data-entity="e_bk_N"`，且仅当该书有对应名册条目）；调用形状=该名号+行邻域；出处校验弃置留痕；实体属性更新+分量重算；落盘确认位；幂等（非默认键不回改）
- **A-2 批量**：候选=无 attrs 条目；有 attrs 条目零调用；与 runAttrsRound 同口径；合并+重算+落盘；空候选给出提示不空跑
- **A-3 指纹守卫**：合订源指纹 ≠ frozen.fingerprint → 拒绝 + 提示重新抽取
- **A-4 清除演化层**：intensity/env 回基线、derivedFrom 清空、polarity/direction 保留；落盘确认位
- **A-5 黑名单**：新文案过 A-3 全局扫描（零禁词零代号）
- **A-6 回归**：`node --test` 全绿（386 + 新增）

## 4. 范围限制（本棒不做）

名册缺漏增补（名册轮已轻，全量重抽成本低）；五件套/世情/张力增量；补抽结果的回改通道（删除某实体的已抽属性）；实体检索（独立 P1）。

## 5. 施工序（测试→部署→台账）

1. 编排层 `abstract.js`：导 `runAttrsRound`；新 `applyRosterAttrs` / `refineEntityAttrs` / `resetDynamicLayer`
2. 编排层 `web/index.js`：`payload.entity` 透传；`clear-evolution` / `refine-entity` / `refine-pending` 三动作（指纹守卫、防重入、落盘确认位）
3. 渲染层 `render.js` + style：实体页行按钮/头部批量按钮（带候选计数）、设定页清除按钮
4. 测试：abstract +3（合并规则/单实体全链/重置形状）、render +1（按钮在位+A-3）
5. 台账 + git 提交

---

*增量抽象细案 · 2026-09-10 · leg21 · 已拍板开工。*
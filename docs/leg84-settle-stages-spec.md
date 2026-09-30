# 细案 · 乙-2：`settleTick` 显式阶段化（leg84）

> 依据：`docs/plan-structure-optimization.md` §3.1 的**重案**（乙-2）· `docs/session-handoff-2026-09-19-leg69.md` §B
> （"本棒的 `SETTLE_ORDER` 正好是它的**前置**：表已经把'顺序'从 139 行里抽出来了，乙-2 要做的只是把这 24 步
> 变成可被数组驱动的形态"）· 用户令（2026-09-20）「做，给我做完」。
>
> ⚠ 本仓对该案的两条硬要求：**①单独一棒 ②单独细案**（本文即②）· **行为零变化必须是验收的第一条**
> （细案 §2.5 拍板点 3：「否则分不清'收口'与'改语义'」）。

---

## 0. 一句话

把 `src/settle.js` 的 `settleTick`（**140 行 · 体内 28 处顶层调用 · 全程就地改 `world`**）
拆成 **8 个显式阶段**，每阶段一个函数、职责单一、按**固定顺序**调用；
顺序的"为什么"仍由 `SETTLE_ORDER`（leg68 已建）**唯一承载**，并由 `test/settle-order.test.js` 继续锁住。

★**不做的事**：不改任何语义闸、不改包形状、不动 `SETTLE_ORDER` 的内容一个字、不删任何一步。

---

## 1. 病（为什么要做）

`settleTick` 是一条 **140 行的顺序过程**（`src/settle.js:998-1137`），步骤先后**本身在承担语义**：

- 承重证据（leg66 W2f 真账）：`applyEntityUpdates` 里那句复核**注释自称"防御"、实际承重**——
  契约层说"因必须还没了结"，而"真正生效的位置"由它排在 `closeEvents` **之后**决定
  ⇒ 曾把一条**刚放行的合法变更**吞掉（真账 `meta.entityFields['e_bk_297']` 零留痕）。
- 现状：**顺序已经写下来了**（leg68 的 `SETTLE_ORDER` + 5 条锁），但**代码本身仍是一整块**——
  读的人要同时装下"8 个概念域、3 个共享收集器、5 个跨阶段产物"才能读懂一行。

⇒ 乙-2 要的是：**让"阶段"在代码里也成为一等公民**，而不只是表里的一行名字。

---

## 2. ★实测底数（本棒直读源码，不抄任何旧文档的数字）

```
settleTick   = src/settle.js:998 → 1137        （140 行）
体内顶层调用 = 28 处；其中 SETTLE_ORDER 登记 24 条
  ★`normalizeSameStepEventRefs` 出现两次（校验后 / 门控后）——两次位置都承担语义，故表里是两行
```

### 2.1 跨阶段**共享**的东西（阶段化的真正难点，逐项有归属）

| 名字 | 是什么 | 谁产出 | 谁消费 |
|---|---|---|---|
| `world` | 本轮的工作副本（`structuredClone(ssot)`） | 阶段1 | **所有阶段**（就地改） |
| `tick` | `world.meta.tick + 1` | 阶段1 | 几乎所有阶段 |
| `warnings` | 收警告的数组（就地 push） | 阶段1 建 | 阶段2/4/6/7 写；阶段8 读 |
| `chronicle` | 收编年条目的数组（就地 push） | 阶段1 建 | 阶段4/6/7 写；阶段8 读 |
| `playerAffected` | K9 影响通道审计 | 阶段1 建 | 阶段8 读（**全函数无写入点**——见 §5②） |
| `stepN` | 校验后的步 | 阶段2 | 阶段8 读（算 `proposals`） |
| `gate` | 门控结果（含 `droppedCounts`/`step`） | 阶段3 | 阶段4/8 读 |
| `gstep` | 门控并归一后的步（**后续所有 `gstep` 都是它**） | 阶段3 | 阶段4/6/7 读 |
| `lim` | 生效上限 | 阶段3 | 阶段4 读 |
| `openCauseAtEntry` | ★批次入口的因果快照 | 阶段3 | 阶段6 读 |
| `spawned` / `born` | 本轮的盘算/实体 | 阶段4 | 阶段5 读（活跃记账） |
| `events` | `hangEvents` 的产物 | 阶段4 | 阶段6 读（`reactivateNamed`） |
| `cancelledIds` / `closedIds` | 取消集 / 联闭集 | 阶段6 | 阶段6 内部（`closedIds` 还要被 `pushTidePeak`/`closeEvents` 消费） |
| `pack` | 进化包 | 阶段8 | 阶段8（`recordMetrics`） |

⇒ ★**结论：共享面很大且是"就地写"形态**（`warnings.push` / `applyX(world, …)`）⇒
细案 §3.1 写的"每个阶段 `(world, ctx) → world` **纯函数**"**在这一版做不到**（要变成纯函数得改
`warnings`/`chronicle` 的收集形态与每个 `applyX` 的签名 ⇒ 那是**改语义面**，超出"行为零变化"的验收口径）。
**故本棒的口径是**：`(world, ctx) → world` 的**形状**照做（统一签名、顺序由数组驱动），
但**共享产物仍走 `ctx` 就地收集**——与原实现逐字节等价。★这一条是**如实登记的口径收窄**，不是偷工。

### 2.2 阶段划分（8 段 · 按**概念域**切，不按行数）

| # | 阶段名 | 职责（一句话） | 含哪些步骤 |
|---|---|---|---|
| 1 | `prepareSettle` | 校验先行 + 立工作副本 + 收集本轮共享产物 + 对话依据册记账 | `checkWorldStep`(早退) · `structuredClone` · `bookDialogue` |
| 2 | `applyStepConstraints` | 把"同轮引用"归一成引擎真发的号 + 收集那两路留痕 | `normalizeSameStepEventRefs`(#1) · 两个 `preWarnings`/`pre.warnings` 循环 |
| 3 | `gateAndSnapshot` | 主动作权门控 + 第二次归一 + **批次入口因果快照** | `computeIdleFaces` · `gateWorldStep` · `normalizeSameStepEventRefs`(#2) · `resolveLimits` · `captureOpenCauseState` |
| 4 | `adjudicateAndPopulate` | 出生裁判 + 落账 + 事件产率上限 + 挂链 | `spawnAgendas` · `adjudicate`(早退) · `spawnEntities` · 事件洪峰截断 · `hangEvents` |
| 5 | `consistencyAndWeights` | 一致性检查 + 活跃记账 + 分量/张力重算 | `checkConsistency` · 活跃记账六循环 + 实体回写 · `recomputeWeights` · `updateTensionIntensity` |
| 6 | `closeAndSettleFates` | 取消 → 推进 → 浪尖 → 闭环 → 灭 → 字段写回 → 熵泵 | `applyAgendaCancels` · `applyAgendaAdvances` · `pushTidePeak` · `closeEvents` · `applyEntityFates` · `applyEntityUpdates` · `pulseEntropy` |
| 7 | `reactivateAndRetire` | 复归 + 背景化 GC + 乱象档位派生 | `reactivateNamed` · `retireInactive` · `updateUnrestGear`（★装回） |
| 8 | `recordAndArchive` | 编年落账 + 档案摘要化 + 递包 + 观测台记账 | `chronicleEvents` · 编年并入 · `archiveClosedEvents` · `buildEvolutionPack` · `recordMetrics` |

★**为什么这么切**：每一段的**输出**都是下一段的**输入**（§2.1 那张表的下游关系），
且段与段之间**没有"回读上一段的中间量"**（除 `events` 由段4 给段6、`closedIds` 在段6 内传递）。

### 2.3 ★阶段边界的**承重顺序**（必须逐条保住，判据要咬）

```
段6 内：applyAgendaCancels → applyAgendaAdvances → pushTidePeak → closeEvents
        → applyEntityFates → applyEntityUpdates → pulseEntropy
  · 取消**先于**推进（被取消者当 tick 推进落 closed）
  · 浪尖**紧随** closedIds 产出
  · 灭**在**闭环后（先结清再言灭）
  · ★★字段写回**在**闭环后，靠 openCauseAtEntry 把口径拉回批次入口（W2f）
段7 内：updateUnrestGear **在** retireInactive **之后**
  （它派生自事件、且读 status，而 status 刚被 retireInactive 改过）
```

---

## 3. 施工方案（形态）

```js
// ★阶段签名统一：(world, ctx) → world
export function prepareSettle(world, ctx) { … return world; }
…
/** ★顺序表是唯一主人：本数组的顺序 = 执行顺序；表里的 why 解释"为什么在这个位置"。 */
export const SETTLE_STAGES = Object.freeze([prepareSettle, applyStepConstraints, …]);

export function settleTick({ ssot, step, moveFact, calls = 1, preWarnings = [] }) {
    const ctx = { step, moveFact, calls, preWarnings, tick: null, warnings: [], chronicle: [],
        playerAffected: [], stepN: null, gate: null, gstep: null, lim: null,
        openCauseAtEntry: null, spawned: [], born: [], events: [], pack: null, blocked: null };
    let world = structuredClone(ssot);
    for (const stage of SETTLE_STAGES) world = stage(world, ctx) || world;
    if (ctx.blocked) return ctx.blocked;          // ★早退两条（校验拒 / 裁定拒）走这里
    return { ok: true, ssot: world, stage: { chronicle: ctx.chronicle, warnings: ctx.warnings, events: ctx.events } };
}
```

★三条形态纪律（都写进判据）：
1. **阶段函数住在 `settle.js` 里、且按执行顺序排列** —— `test/settle-order.test.js` 那条"源码序"锁
   才能**继续**成立（它按"函数体里出现的先后"判序）。★这是**选它而非搬去新文件**的理由。
2. **`settleTick` 不再自己调那 24 步** ⇒ 顺序锁的抽取面从「`settleTick` 一个函数体」改成
   「8 个阶段函数体、按 `SETTLE_STAGES` 顺序拼接」。★这是**锁的升级、不是放宽**（口径逐条不变，
   且新增一条"每个阶段都必须真被 `SETTLE_STAGES` 驱动"）。
3. **早退（`blocked`）不许用 `return` 从阶段里穿出去** —— 阶段一律 `return world`，
   早退写进 `ctx.blocked`，由 `settleTick` 统一返回。★理由：本仓最忌"两条写法并存"。

---

## 4. 判据（要做哪些锁）

| # | 判据 | 咬什么 |
|---|---|---|
| ① | **阶段数组 = 执行顺序**，且每个阶段都**真被驱动** | 抽掉一个阶段 / 换顺序 / 数组里塞个没人调的 ⇒ 红 |
| ② | **顺序锁升级**：`SETTLE_ORDER` 的 24 条仍**逐条**钉在 8 个阶段体里，先后不变 | 改序 / 删步 / 换函数 ⇒ 红（口径与 leg68 逐条相同） |
| ③ | **无陈旧条目**（每个阶段都非空、都有 `return world`） | 出现空壳阶段 ⇒ 红 |
| ④ | ★**行为逐字节不变**：`demo/smoke-demo.js` 的终态 SSOT 仍 **8231 字节** + 全量 1001 条判据全绿 | 任何语义漂移 ⇒ 红 |
| ⑤ | **`settleTick` 真的变薄**（行数下界→上界） | 阶段化没落地（还是 140 行）⇒ 红 |

★**咬合演练**（必做，每段先自证"变异真打上了"）：
把 `applyAgendaCancels`/`applyAgendaAdvances` 对调 · 删掉一个阶段 · 把 `updateUnrestGear` 挪到 `retireInactive` 之前 ·
阶段数组里换顺序 —— 四条各由**它自己那条**判据咬红。

---

## 5. ★风险面与"没做"（如实登记，便于下一棒接）

| # | 风险 / 缺口 | 处置 |
|---|---|---|
| ① | **`world` 重新赋值**：`settleTick` 里 `let world`，若某阶段返回新对象而后续阶段拿到的是旧引用 ⇒ 静默错账 | 判据①咬"阶段返回的世界必须是**被传进去的那个**（同一引用）"；本版全部阶段都 `return world`（就地改） |
| ② | **`playerAffected` 是死收集器**：全函数**没有任何 push 点**（K9 影响通道随四维一并删除，leg25 c），只在 `recordMetrics` 里被读 | ★**本棒不动它**（动它＝改语义）。如实登记：它现在恒为 `[]`，「引擎独占写玩家」那条红线的审计面**只剩空壳**——这是**独立的待办**，不属于乙-2 |
| ③ | **纯函数形态做不到** | 见 §2.1 末段：收集器与 `applyX` 全是就地写 ⇒ 变纯函数＝改语义面。本棒只做"显式阶段 + 数组驱动" |
| ④ | 顺序锁的抽取面变了 | 见 §3 纪律2：改成 8 个阶段体拼接，口径逐条不变 |
| ⑤ | 阶段名与 `SETTLE_ORDER` 的 `call` 名**不是一回事** | ★表登记的是**被调用的那一步**（如 `closeEvents`），阶段是**概念域**（如 `closeAndSettleFates`）⇒ **不许把两者混成一张表**（混了就把"顺序的为什么"降级成"函数的清单"） |

---

*第八十四棒（leg84）· 2026-09-20 · 用户令「做，给我做完」· 乙-2 细案（先出方案，再动代码）*

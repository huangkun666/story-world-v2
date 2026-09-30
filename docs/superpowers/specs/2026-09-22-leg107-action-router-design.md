# 设计（leg107）：接线层的端到端判据 —— 把按钮点击那一口提成可测的模块

> 性质：**已拍板的设计**（用户 2026-09-22 在三个方案里选「甲：先治这一个入口」，
> 并明确点头了本设计四段：「可以，四段都同意」）。
> ★**定稿时勘正了两处我先前说错的数**（见 §4.2 第 2 条）——设计文档也要守"改那一处"的纪律。
> 来路：`docs/session-handoff-2026-09-21-leg106.md` §8「下一笔最该做的」。
> ⚠ 含中文的文件禁止用 PowerShell 读写（见 `STATE.md` §2.1 同级铁律）。

---

## 0. 一句话

面板上所有按钮共用一个点击入口，而它把按钮身上的 `data-*` 属性**按一张手写的 13 词名单**
翻译成参数 —— **不在名单上的词一律静默扔掉**。leg105 那个「编年页下一页点了没反应」
就是被这张名单扔掉了 `data-layer` 造成的。本笔把这一口提成可单独调用的模块，
**名单改成「照单全收」**，并第一次让「真的点一下」这件事有判据站岗。

★ 本笔**唯一的语义改动**是 §4 那一刀（`data-*` 从名单制 → 照单全收）；
`el` 与 `worldName` 两个键**不在此列、行为逐字不变**（§4.2 有勘正留档）；其余是搬家 + 加判据。

---

## 1. 病（逐行取证，不是推演）

### 1.1 这条链的真身

```
点击 ──► win.addEventListener('click')            web/index.js:2941
      ├─► ① data-inject-switch 早退（注入开关直接收，不进总线）  :2951
      ├─► ② .sw2-goto 早退（模拟点页签）                       :2961
      ├─► ③ 拼 payload（13 键，手写枚举）                      :2967  ★★
      └─► dispatchAction(action, payload, e)                  :2968
              └─► window.__sw2Actions[action]                 :510-526
                      └─► 处理器 ──► 引擎 tick
```

区间实测：`bindActions()` 共 **101 行**（`:2938-3038`）；其中点击委托块 **29 行**
（`:2941-2969`，空行 0 · 注释行 9 · 代码行 20）。`web/index.js` 现 **3099 行**（硬锁 `<3100`）。

### 1.2 三处**会静默**的地方（「点了没反应」全部由它们生产）

| # | 处 | 现状 | 后果 |
|---|---|---|---|
| ① | payload 白名单 `:2967` | 手写枚举 13 键：`source vol chain filter entity name force snap tick param value key layer` | 按钮身上写别的词 ⇒ **静默丢弃** |
| ② | `dispatchAction` 兜底 `:524` | 动作不在总线上只 `console.warn` + 状态条闪一句 | 引擎**没动**，判据读不到 |
| ③ | 行数锁 `test/web-view-state-layout.test.js:339-340` | `lines < 3100` **且** `lines > 2600` | 只朝"变薄"一个方向使劲；"新功能先进模块"**只活在交接文档的口头里** |

### 1.3 leg105 的现场（本设计的第一动机）

- `src/render.js:1252` 画的翻页按钮带 `data-action="ch-page" data-value="next" data-layer="${layer}"`；
- `web/index.js:2571` 的处理器读的是 `payload?.layer`；
- 而 `data-layer` **当时不在 `:2967` 那张名单里** ⇒ 永远 `undefined`
  ⇒ `String(undefined || 'event')` = `'event'`
  ⇒ **点账目层的「下一页」，动的是事件层的页码**。

处理器跑了、没抛错、测试全绿，玩家看到「页数也不会跳」。

### 1.4 为什么现有判据抓不住

实测 96 个判据文件：

- **48 个**读 `web/index.js` 的**源码文本**做正则断言 ⇒ 「把代码从 A 搬到 B」会红，
  而「按钮点了没反应」全绿；
- **10 个**真加载 `web/index.js`；
- **0 个**真的派发过一次点击。

最接近的一条是 `test/lookup-batch.test.js:403`（「画了按钮就必须有人接」），
但它止步于**字符串 vs 注册表**：证明"名字对得上"，不证明"点下去会怎样"。

---

## 2. 范围（用户已选：甲）

**做**：把 `:2941-2969` 这一段提成新模块 `web/action-router.js` + 名单改照单全收 + 写端到端判据。

**不做**（留待后续单独拍板）：

- 弹窗里那套翻译（`web/index.js:2655-2665`，链浮层挂在 `document.body`、走不到 `win` 委托）；
- 参数页特例（`:1310`，`set-param` 手工拼 payload）；
- 行数锁那三条规矩（改它 = 改承重判据，见 `STATE.md` §2.2 第 4 条）。

---

## 3. 模块形状（搬家族 + 依赖注入）

照本仓既有先例（`web/view-state.js` / `web/book-source.js` / `web/scroll-keep.js`）：
**把一族从 `web/index.js` 搬进自己的模块，用注入把外部依赖接进来。**

```js
// web/action-router.js
export function createActionRouter({ win, dispatch, toggleInject }) {
    // 返回 { handleClick(e), route(el) } —— route 是纯的（元素 → {action,payload}），handleClick 是薄壳
}
```

- `route(el)` **纯函数**：给定一个 DOM 元素，交出 `{ action, payload }` 或 `null`
  （`null` = 这一下不该走总线）。★ 它是本笔判据的主要落点。
- `handleClick(e)` **薄壳**：照原顺序处理三支（注入开关 → `.sw2-goto` → 总线），
  与 `:2941-2969` **逐支同序**。
- `dispatch` / `toggleInject` 由调用方注入 ⇒ 判据可注入 spy，**不需要真引擎**。

`web/index.js` 侧：`bindActions()` 里那 29 行换成约 4 行（建 router + 调 `createActionRouter`）。
**预计 `web/index.js` 3099 → ≈3065 行**（余量 1 行 → ≈36 行）。

---

## 4. ★★ 唯一的语义改动：名单 → 照单全收

**现在**：13 词手写名单，不在名单上的 `data-*` **静默丢弃**。
**改成**：元素身上**写了什么就拿什么**（遍历 `el.dataset` / `attributes`，取全部 `data-*`）。

### 4.1 安全性取证（为什么这一刀是安全的）

- **全仓没有任何一处枚举或展开 payload**：`Object.keys(payload)` / `Object.entries(payload)` /
  `JSON.stringify(payload)` / `...payload` —— 实测**全仓 0 处命中**。
- 处理器**一律是点名要某一个键**、要不到就走默认值。**机械清点**（`payload?.X` 全量正则）：
  处理器一共读 **12 个键** = `chain el entity force layer name param snap tick value vol worldName`。
- 现名单 13 个属性 = `data-source data-vol data-chain data-filter data-entity data-name
  data-force data-snap data-tick data-param data-value data-key data-layer`
  ⇒ 键名 `source vol chain filter entity name force snap tick param value key layer`。

**两边对账（这一格是本笔的承重墙，必须逐字准）**：

| 分类 | 键 | 说明 |
|---|---|---|
| ★**处理器要、且来自属性**（10） | `chain entity force layer name param snap tick value vol` | 照单全收**一个都不会少** |
| ★★**处理器要、但不来自任何属性**（2） | **`el`** · **`worldName`** | 见 §4.2 —— **照单全收取不到它们，本笔不改变其行为** |
| 名单里有、但**没有任何处理器读**（3） | `source` · `filter` · `key` | 死重量（本笔**不删**，留档） |

★ 这三条死重量值得单独说一句：**名单是一份没人校对的复制品** ——
它多列了 3 个没人读的键、又漏了 `layer`（直到 leg105 才补上）。
"照单全收"之后这份复制品**整个消失**，多列/漏列同时成为不可能。

### 4.2 ★ 两个"不来自属性"的键（如实说清，不许埋在搬家里）

**`el` 与 `worldName` 都不来自任何 `data-*` 属性** —— 实测：`data-el` / `data-world-name`
在 `src/` 与 `web/` 里**零处出现**。它们是**手工塞进 payload 的**：

- `el`：只发生在参数页那条特例路上（`web/index.js:1310` 的
  `dispatchAction('set-param', { …, el: hit }, e)`）；
- `worldName`：`web/index.js:2372` 读它作"世界名提示"，**实测全仓没有任何一处写入它**
  ⇒ **它今天恒为 `undefined`**（`payload?.worldName || meta?.world?.context?.world` 的
  第一顺位是死的，一直在吃第二顺位）。

⇒ 两件事必须说清：

1. **照单全收不改变这两个键的任何行为** —— 它们不是属性，遍历属性永远取不到它们；
   改前改后**逐字相同**。
2. ★**更正我先前的两处错话**（留档，免得下一任照错话去查）：
   - 我一度说"参数页下拉框身上写着 `data-el`、照单全收后从拿不到变成拿得到" ⇒ **不成立**，
     `data-el` 根本不存在；
   - 我一度说"14 个键、其中 13 个来自属性" ⇒ **数错了**，真值是 **12 个键、其中 10 个来自属性**。

**⇒ 本笔的语义改动只有一条：`data-*` 从「名单制」改成「照单全收」。
`el` / `worldName` 不在此列，行为逐字不变。**

### 4.3 剩余风险（如实说）

- **键名写错不再静默**：`data-layr` 这种错字此前被名单吞掉、现在会进 payload
  ⇒ 处理器读到 `undefined` 走默认值。**净收益**：错字从"被吞"变成"在 payload 里看得见"。
- `dispatchAction` 的软失败（§1.2 ②）**本笔不动** —— 它属于"总线装配时序"另一个话题。

---

## 5. 判据（新文件 `test/action-router.test.js`）

| # | 判据 | 抓什么 |
|---|---|---|
| ① | **真点击**：fake DOM + 真渲染产物 + 派发 `click` ⇒ 断言 spy 收到的 `{action, payload}` 逐字正确 | 整条链「元素 → 动作 + 参数」 |
| ② | ★**leg105 回归锁**：合成一枚 `data-action="ch-page" data-value="next" data-layer="book"` 的按钮（照 `src/render.js:1252` 的真实形状）⇒ 断言 `payload.layer === 'book'` | **`data-layer` 不许再被扔掉** |
| ③ | ★**反向对照**（防空绿）：同一枚按钮把 `data-layer` 拿掉 ⇒ 断言 `payload.layer` 变成 `undefined`（证明 ② 真的是在测那个属性，不是在测空气） | 判据自己不会静默失效 |
| ④ | **三支同序**：注入开关早退（不进总线）· `.sw2-goto` 早退（模拟点页签）· 普通按钮走总线 | 搬家没改行为 |
| ⑤ | **真产物里真的有按钮**：从 `renderAll` 出来的真 HTML 里取出翻页按钮喂给 `route()`（证明判据打在真产物上，不是自造的形状） | 「判据必须打产品真入口」 |

★ 关于 ② 的诚实说明：leg105 **已把账目层那枚分页器整个删了**
（`src/render.js` 现在只在 `:1310` 画事件层那枚），所以面板上**没有**账目层翻页按钮可点。
② 用**合成按钮**锁「这个键以后不许再被扔掉」，③ 是它的反向对照。

---

## 6. 验收（照 `STATE.md` §2.3「测试 → 部署 → 台账」三件连着做）

1. **测试**：`node --test`（插件目录内）全绿；新判据文件在列；`web/index.js` 行数下降且仍 `> 2600`。
2. **部署**：junction 已指向项目根 ⇒ **Ctrl+Shift+R** 即载（用户实机验收：面板点一遍各页按钮）。
3. **台账**：`docs/ledger.md` 补 leg107 一行（**5 格**，与表头同列数 —— `test/ledger-shape.test.js` 计数棘轮锁着）。

**不升的号**：`PANEL_BUILD` / `CSS_VERSION` / `MAIN_PROMPT_V` 三个都不升
（玩家可见版面与提示词零改动 —— 本笔是搬家 + 加判据）。

**可复现命令**：

| 看什么 | 命令 |
|---|---|
| 全量判据 | `node --test`（**无参**，必须在插件目录内） |
| 冒烟 | `node demo/smoke-demo.js`（应仍 **PASS · 8231 字节**，引擎零漂移） |
| 文档守门 | `node scripts/audit-docs.mjs` |
| 行数 | `node -e "console.log(require('fs').readFileSync('web/index.js','utf8').split('\n').length)"` |

---

## 7. 风险与回退

| 风险 | 处置 |
|---|---|
| 搬家改坏行为 | 搬家那一笔**单独一次提交**，判据全绿才进下一笔（行为零改动是它的验收线） |
| 照单全收引出意外 | §4.1 已取证"零处枚举 payload"；若仍出意外，**回退 §4 那一刀、保留搬家**（两笔分开正是为此） |
| 行数锁 | 本笔使 `web/index.js` **变薄**，两个断言都不碰、都不放宽 |

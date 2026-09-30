# 交接 · 第七十七棒（leg76）：**「补全全册实力」撤钮 —— 方向本身是错的**

> **接手第一件事：读这份。** 本棒是**用户报的第三个真缺陷**（leg74 文风禁令 → leg75 丢弃集 → 本棒撤钮），
> 不是结构搬迁。用户原话：「**这个按钮根本用不了，要么就改成重抽名册，要么就删了**」。
> ⚠ 含中文的文件**禁止用 PowerShell 读写**（用 `read`/`edit`/`write`）；**行数/字节数一律用 `node -e`**。
> ⚠ **本仓是 monorepo**，git 根 = **`F:/deepseek/plugins`**；跑 git 一律 `git -C F:/deepseek/plugins`。
> ⚠ **`node --test` 必须在包目录里跑**（workdir = `story-world-v2`）。
> ⚠ **真机位 = junction**：`F:\jiuguanai\SillyTavern-Launcher\SillyTavern\public\scripts\extensions\third-party\story-world-v2`
> → `F:\deepseek\plugins\story-world-v2` ⇒ **改仓即改实机、无需部署**。
> ⚠ **真账位置**：`F:\jiuguanai\SillyTavern-Launcher\SillyTavern\data\default-user\chats\<聊天名>\<聊天名>.jsonl`，
> 账在每行的 `chat_metadata.story_world_v2.world`，`canon` 在 `world.context.setting.frozen.canon`。

---

## 0. 一句话

**全册批量补全（`⬇ 补全全册实力`）整族撤除** —— 不是"实现有小病"，而是**方向错的**：
它真会去问的那批实体里**十个有九个是「势力」**，而提示词**明令势力不抽实力** ⇒ **那一栏对它们永远补不上**。
⇒ 撤钮（渲染端 + 总线 + 任务编排 + 每轮搭车那段）· 面板文案改成如实（**不再指路到一个不存在的入口**）·
`PANEL_BUILD` 升位 **`leg76-roster-batch-pull`**。

⇒ 读数：**`node --test` 964/964** · 冒烟 **8231 字节未变** · `world` 哈希 **未变** · import 环 **4 条未变**。
★**行内那枚「查」是好的，保留**（只撤全册那一枚）。

---

## 1. 硬事实（本棒真账实测）

### 1.1 ★★★先量清"点下去到底发生什么"（三个缺陷叠在一起）

`startBatchTask` 取**全部存活实体** → `planBatches` 用 `forcedFields({forceFields:'absent'})` 过滤
→ 全被 `skipped('nothing-to-ask')` ⇒ `batches` 为空 ⇒ `runBatchChunk` 立刻返回 `done` ⇒ **面板毫无反应**。

| 账 | 实体 | 已有实力值 | **默认口径 `missingFields` 会问的** | **★按钮实际会问的** |
|---|---|---|---|---|
| 大荒z1 | 689 | 526 | **152** | **11** |
| 实教数据库版v2.0 | 134 | 1 | **132** | **1** |

**缺陷①：它要查的东西被自己的过滤条件滤掉了。**
`forcedFields` 只覆盖 `state='absent'`（书未明述）与"已到重试上限"两类，**没有**覆盖 `state='pending'`；
而 `missingFields` 又因为 `count >= 2` 把这些 `pending` 挡掉 ⇒ **两个口径都不碰它们** ⇒ **死区**。
（大荒z1 那 152 个缺字段的实体，**正是**卡在 `pending, count=2`。）

**缺陷②：点了不当场跑。** 它只把任务排队（`sw2BatchTask`），真正的跑动在**世界推进**的 `preStep` 里
（`BATCH_PER_TICK = 1`，每轮 1 批）⇒ 不推一轮就完全没动静。

**缺陷③：跑完那句总结被印成字面量 `null`。**
`runBatchChunk` 返回 `{done, summary}`、`setStatus(r.summary)` 是对的，但循环紧接着执行
`setStatus(batchStatusText())`，而此时任务已清空 ⇒ `batchTaskStatus()` 返回 `null`
⇒ `setStatus(null)` ⇒ `el.textContent = null` ⇒ **面板状态栏印出 `null`**。

### 1.2 ★★★根因：**方向错了**（这是撤而不是修的依据）

按钮真会问的那 11 个实体（大荒z1）：

```
菩提禅院 · 万法阁 · 战皇殿 · 万斗武场 · 酆都鬼府 · 大虞 · 天庭 · 魔宗 · 界渊长城 · 忘忧凡川   ← 全部 kind=faction
小宅仙                                                                                    ← 唯一角色，源是 [ejs] 模板条目
```

而 `src/entity-lookup.js` 的 `buildLookupPrompt` **明令**：

> 「★**势力条目不抽实力**（势力只写它自己的性质/规模描述，与角色档位不是一回事）——势力条目的"实力"一律留空」

⇒ **10/11 是模型被明确要求留空的势力** ⇒ 那一栏对它们**永远补不上** ⇒ 重试到上限后**原地空转**。
★所以"修好它"这个选项**不成立**（把过滤放宽只会让模型多做无用功）；
★而"重抽名册"是**另一件事**（见 §3-A，本棒**没有**做，理由与工作量都写在那边）。

### 1.3 这条病史早就记过（不是本棒第一次发现）

| 出处 | 记了什么 |
|---|---|
| `docs/handoffs/session-handoff-2026-09-11-leg25e.md` §2.4 | 「**「补全全册实力/位置」实际是空转**（复验时发现）」 |
| `docs/ledger.md`（leg25 e） | 「U1 **位置被占位值「未明」闸死** ⇒ 「补全全册实力/位置」一半空转」 |
| `docs/ledger.md`（leg40b） | 位置那条腿在 leg25 f 被摘掉后，**面板文案没跟上**（"永久承诺"类病的同款） |
★**教训**：这条"空转"被记进档**整整十五棒**（leg25e → leg40b → 本棒）都没人撤，
原因是它**测试全绿**（判据锁的是"按钮画出来了"，不是"点了有用"）。
⇒ ★**本仓那条老纪律的又一次重演**：**"控件在产物里" ≠ "这个控件有用"**。
**本棒把判据翻成"不许回潮"**（§2.3），而不是"必须在"。

---

## 2. 本棒已完成

### 2.1 改动面（**改 2 生产 + 改 3 测试 + 新建 0**）

| 类 | 文件 | 落成什么 |
|---|---|---|
| 改 | `src/render.js` | 撤 `<button data-action="lookup-batch-all">` 与进度行（`batchButtonHtml`/`batchHintHtml` 整段）· 页底指路文案改成如实（**不再提那枚钮**）· `PANEL_BUILD` 升位 |
| 改 | `web/index.js` | 删 `BATCH_PER_TICK`/`sw2BatchTask`/`batchTaskStatus`/`stopBatchTask`/`batchStatusText`/`startBatchTask`/`runBatchChunk`/`planBatchesLazy` · `renderCfg` 去掉 `lookupTask` · `advanceTick` 的 `preStep` 去掉搭车那一段 · 删 `bus['lookup-batch']` 与别名 `bus['lookup-batch-all']` · import 去掉未再用的 `planBatches` |
| 改 | `test/lookup-batch.test.js` | 「批量进度与按钮随 config 进面板」**翻成撤钮锁**（两头都锁：产物 + 总线）· 总线审计那条改成**反向点名** |
| 改 | `test/render.test.js` | 页底那条从"指路到那枚钮"翻成"**不许再指路**" · 细案实体页那条翻成反向锁 · `PANEL_BUILD` 锁升位 |
| 改 | `test/location-inherit-wiring.test.js` | 「三处生产调用点」→ **两处**（第三处就是被删的 `runBatchChunk`），**其余口径一个字不放宽** |

### 2.2 ★★`src/` **一个字没动**（边界纪律）

| 东西 | 处置 | 为什么 |
|---|---|---|
| `planBatches`（`src/entity-lookup.js`） | **保留** | 它**仍有真消费者**：`runBatchLookup` 内部就调它（`:277`）；且 `test/lookup-batch.test.js` 与 `demo/bench-batch-plan.js` 都在用 ⇒ 它是**活的纯函数**，删了才是扩大处理面 |
| `planBatches` 在 `web/index.js` 的 import | **摘掉** | 它的唯一调用点（已删的 `planBatchesLazy`）没了 ⇒ 接线层不再需要它（**只收未用 import，不动 `src/`**） |
| `forcedFields` / `missingFields` / `planBatches` | **保留** | 行内单实体「查」与每轮前置步仍走同一收口 |
| `runEntityLookupStep` / 每轮前置步 | **保留** | 那条路是**真的在干活**的（不是本棒删的对象） |
| 行内那枚「查」（`lookup-entity` / `lookupOneEntity`） | **保留** | 它是对的（用户没说它坏；本棒实测它与本族无耦合） |

### 2.3 判据（**1 条翻新 + 2 条翻向 + 1 条收窄**）

1. ★★★`leg76：全册批量补全已撤` —— **两头都锁**：产物里不许有那枚钮/进度行（**连把旧 `config.lookupTask`
   塞进来也不许画**）、行内那枚「查」必须还在、且面板**不许再指路到一个不存在的钮**；
2. `leg25 d：面板产物里每个 data-action 都必须有真实处理器` —— 改成**反向点名**：
   `lookup-batch-all`/`lookup-batch` **不许**出现在产物或总线里（撤钮后这条从"点名必须在"翻成"点名不许在"）；
3. `render.test.js` 细案实体页那条 —— 从"入口仍在"翻成**反向锁**；
4. `location-inherit-wiring.test.js` —— 门槛 3 → 2，**其余不放宽**（少一处照样红）。

### 2.4 ★咬合演练（`leg76-bite-probe.mjs`，**四段全部咬住**）

| 演练 | 制造的缺陷 | 结果 |
|---|---|---|
| ① | 把那枚钮**画回版面**（真回潮） | ✓ 咬住（连带红 3 条） |
| ② | 只画钮、总线上没有处理器（半拉子回潮） | ✓ 咬住（连带红 2 条） |
| ③ | 面板文案**指路回**那枚已撤的钮（承诺一个不存在的东西） | ✓ 咬住（连带红 3 条） |
| ④ | 总线把 `lookup-batch-all` 处理器**接回来** | ✓ 咬住（红"画了按钮没人接"那条审计） |
★★★**演练①第一版是"等价变异"**（如实留档，照 leg75 §4.1 的纪律）：
我第一版只把 `const batchButtonHtml = …` 加回去、**没接进版面** ⇒ 产物一字不变 ⇒ **全绿是对的**
（死变量不是缺陷）⇒ 改成**真接进版面**才咬住。**又验了一次"没咬住要先分清是哪种"**。

### 2.5 端到端验收（`leg76-verify-removal.mjs` / `leg76-verify-code-only.mjs`）

- 真 `renderEntitiesHtml` 产物里：`data-action="lookup-batch-all"` / `补全全册实力` / `■ 停止补全` / `补全中`
  **四项全无**；行内「查」**仍在**；**把旧 `config.lookupTask` 塞进来也不画**；
- 产物里剩的 6 个 `data-action`（`ents-filter`/`ents-sort`/`ents-group`/`ents-scope`/`lookup-entity`/`ents-page`）**逐个都有真处理器**；
- **剥注释后**扫代码：`bus['lookup-batch*']` 与那 8 个已删符号（`startBatchTask`/`stopBatchTask`/`batchTaskStatus`/
  `runBatchChunk`/`planBatchesLazy`/`batchStatusText`/`sw2BatchTask`/`BATCH_PER_TICK`）**一个都不剩**；
- `planBatches` 在 `src/` **仍在导出**、接线层**已不引用**。

---

## 3. 待办（按优先级）

### ★★ A. 「重抽名册」**本棒没做**——用户当初给的第二条路（工作量与形态如实报）

用户原话是「要么就改成重抽名册，要么就删了」⇒ 本棒选了**删**。若下一棒要做"重抽名册"，先看这几条：

| 项 | 实测/判断 |
|---|---|
| **工作量** | ★**中等偏小**。本仓**已有对称先例**：`bus['reextract-setting']`（leg62b）就是"只重抽设定"——它甚至**显式跳过名册遍**（`leg62c` 用户令）。做"只重抽名册"基本是把那条反过来：**换提示词通道（名册遍）+ 换一份 canon 字段（`bookEntities` / 实体属性）** |
| ★**真正的风险** | **不是代码量，是"别把玩家的世界重开"**。`reextract-setting` 能安全是因为它**只换 setting、不动实体账**；而名册遍的产物直接喂 `seedBookEntities` ⇒ **一旦按新名册重建实体，就会冲掉：`status`（死没死）· `parent`（隶属）· `location` · 各实体累计的 `实力` · 与 `agendas`/`events`/`chronicle` 的引用** |
| ★**建议形态** | 照 leg40/leg70 那条"**只提取不发明 + 幂等 + 备份 + 写后自证**"的老路：**按名号对账并入**（同名者**只补空字段**、绝不重建、绝不覆盖已有值），新增的名号才落账；并**显式留痕**（哪些补了、哪些没动） |
| ★**判据形态** | ①重抽后**死亡/在飞盘算/编年引用一条不许变**；②已有值**一个字节不动**；③空字段才被补；④幂等（连跑两次第二次零变化）；⑤**不许**复用已删的批量编排（那族已判死） |
| **值不值得** | ★**先问用户**。大荒z1 真账：689 实体里 **526 条已有实力**、缺的 152 条**大多是势力**（本来就不该有）⇒ **收益可能很小**。真要补，缺的是**角色**那几十条，而那正是行内那枚「查」能一个个点的 |

### ★ B. leg75 留下的两条（沿用，本棒没碰）

- **老快照里的那三类会"复活"**：`restoreSnapshot` 不跑载入期迁移 ⇒ 恢复 leg75 之前的快照会把
  `文风禁令`/`变量指令`/`其他` 带回来（直到下次 `loadWorld`）。★形态已写明：让 `restoreSnapshot` 走同一个迁移函数；
- ★★**请用户点一次「只重抽设定」验抽取侧硬禁令**（leg75 §1.2b 把抽取侧的门关上了，那一抽才是真验证）。

### ★ C. 丙-web 的其余族（leg72/73 那条线，本棒没碰）

★顺序与数字仍有效：**热账族 → 视图态族 → 查书补字段族 → 参数族**；
★★**注意**：leg72 交接 §3-A 那张表把"查书补字段族"列成 **≈150 行**，其清单里**一半是本棒刚删掉的**
（`batchTaskStatus`/`startBatchTask`/`stopBatchTask`/`batchStatusText`/`runBatchChunk`/`planBatchesLazy`）
⇒ **下一棒做这一族之前必须自己重量**（表已过期，这是本棒顺带产生的差异）。

### ★ D. 乙-2（`settleTick` 显式阶段化，高风险、要单独细案）· 与旧待办（沿用，未动）

- **A2 真修（要报批）**：书声明面 → `seedBookEntities` ⇒ `declaredParent`；
- leg70 留下的两格：**草稿跨刷新仍会丢** · **`extractedAt` 语义被放宽**（动契约，先报批）；
- A1：真账上"到底丢了多少尺/法则"仍未现测；A4：本仓**没有**"顶到 50 万"的夹具；
- `INIT_SOURCE_HARD_CEILING` 抬不抬 · 366 条人物档案读不读 · 题名面精度 · `chunkRows` 抹行首空白 ·
  实教账 `S~E级` 那 5 条 · 日期被抽象成角色 · **`实力` 栏错位** · 发布面没推（要吃 leg71～leg76 得单独发版）。

---

## 4. 我（leg76）犯过的错 —— 下一棒别重犯

1. **★★★演练"没咬住"：这次又是"变异等价"，两棒连着踩同一个坑。**
   演练①第一版只把 `const batchButtonHtml = …` 加回去、**没接进版面** ⇒ 产物一字不变 ⇒ 全绿，
   ★**而那是对的**（死变量不产生缺陷）。改成"真接进版面"才咬住。
   ★**纪律（leg74 立、leg75 踩、本棒再踩 ⇒ 下一棒请当硬规矩）**：
   **演练没咬住时，按顺序问三句**——①**变异真的打上了吗**（锚点命中几次？产物变了吗？）
   ②**它等不等价**（不改变行为的变异不该被咬）③**最后才问是不是判据瞎了**。
   ★本棒第一版连第一句都没问。

2. **★★★两次改文本都把不该动的行删了/并了（`edit` 的 `old_string` 多带内容）。**
   ①我想**删两行**，`old_string` 写的是**三行**、`new_string` 只回了两行 —— 结果**多删了一行注释**；
   ②另一次 `old_string` 多带一个换行 ⇒ **把两行并成一行**。
   两次都**当场读回上下文发现并修回**。
   ★**纪律：`edit` 之后必须读回那一段**；要"删 A 留 B"时，`old_string` 与 `new_string` 的**行差必须自己数一遍**。

3. **★★判据里"产物里有没有某个串"要连"塞旧 config"一起判。**
   撤钮后我第一版只测了 `renderEntitiesHtml(w)`，忘了渲染层过去会读 `config.lookupTask`
   ⇒ 若有人把旧 config 塞回来，第一版判据**看不见**。定稿把三种 config（`undefined`/`{}`/带旧 `lookupTask`）**都测一遍**。
   ★**纪律：撤一个"读 config 的控件"时，判据要把"旧 config 还在喂"这条也堵上。**

4. **★`PANEL_BUILD` 起名第二次被扫描器咬住。** 我起成 `leg76-entities-batch-removed` ⇒ 含 **`entities`**
   ⇒ 被「工具栏零引擎术语」那条扫描器当场红（★构建号也画在玩家视线内）。定稿 `leg76-roster-batch-pull`。
   ★leg75 那次是含 `kind`（`classes` 里的子串）⇒ **连着两棒被同一个扫描器咬住**，
   下一棒起名**先在心里过一遍那七个禁词 + "工具栏零术语"那条**。

5. **★一句"删除"会连带红一条看起来无关的判据——那通常是判据在正确地干活。**
   删掉 `runBatchChunk` 后，`location-inherit-wiring` 那条"**三处**生产调用点都要传条目"当场红
   （实际 2 处）。★那不是"测试坏了"，是**它数的正是"调用点"，而我少了一个调用点**。
   ⇒ 处理方式是**改门槛并写明理由**（3→2），**不是**把那条判据删掉或放宽成 `>=1`。

---

## 5. 装置与坑

### 5.1 本棒新增/沿用的装置（都在 `F:/deepseek/tmp/`）

| 脚本 | 干什么 |
|---|---|
| ★★★`leg76-batch-button-probe.mjs` | **真账实测**：这个钮点下去到底会问几个、为什么是 0（分层数 已有值/ok/absent/其他态/无记录） |
| ★★`leg76-stuck-entities.mjs` | 把那 11 个"真会被问"的实体摊开，看它们的 `kind` 与书条目命中情况 ⇒ **查出 10/11 是势力** |
| ★★`leg76-verify-removal.mjs` | 撤钮端到端验收（真渲染产物 + 真源码处理器对照） |
| ★`leg76-verify-code-only.mjs` | **剥注释后**扫代码：8 个已删符号与两个总线动作一个都不剩 |
| ★★`leg76-bite-probe.mjs` | **四段咬合演练**（含那次"等价变异"的如实留档） |
| （沿用）`leg68-behavior-hash.mjs` · `leg71-import-graph.mjs` · `leg75-*` | 行为哈希 / 环检测 / leg75 那一套真账实证 |

### 5.2 坑（沿用）

- **含中文的文件一律 `read`/`edit`/`write`**；行数/字节数一律 `node -e`；
  **不要拿 PowerShell 量的历史数字与 node 量的新数字比**；
- **`git show HEAD:… > file` 会写成 UTF-16**；回退**永远不要 `git checkout --`**；
- ★**"某个符号还在不在"要剥注释后再判**：本棒第一版裸正则扫 `bus['lookup-batch-all']`
  ⇒ **打中了我自己写的解释性注释** ⇒ 假红（`leg76-verify-code-only.mjs` 是剥注释后的正确版）；
- ★**新模块硬要求**：零 DOM / 不许 re-export / 后面的状态只能注入取数函数（TDZ）/ **产物必须真 import 一次**；
- ★**`import { … }` 花括号里一律不写注释**（leg74 §4.1）。

---

## 6. 验收基线（本棒收尾实测）

| 项 | 现值 | 怎么来的 |
|---|---|---|
| `node --test` | **964 / 964**（fail 0 · skipped 0） | ★实测（与 leg75 同数：**1 条翻新 + 1 条换名**，不是"没加判据"） |
| 冒烟 | **8231 字节 · PASS · 警告 0** | ★实测（**逐字节未变**——本棒只删接线层，没碰引擎） |
| 行为哈希 | `world` `5fe7b698dee8d9e891e82197691b884b0445dbad9a480f5cabf1c7c48d152a38` | ★实测（**未变**） |
| import 环 | **4 条**（与前五棒逐条相同） | ★零条新环 |
| `PANEL_BUILD` | **`leg76-roster-batch-pull`** | ★升位（工具栏真的少了一枚钮 + 页底文案改了） |
| `VERSION` / `manifest.version` | `1.0.0`（未动） | 本棒没动 |
| 分支 | monorepo `leg62-scales-concept-table` | ★本棒**未提交**（见 §7） |
| 实机位 | `…\third-party\story-world-v2` = **junction** ⇒ 改仓即改实机 | 沿用 |

### ★ 真机验收（**必须看一眼**——你报的就是这个钮）

1. **硬刷新（Ctrl+Shift+R）后，页脚应显示 `构建 leg76-roster-batch-pull`**；
2. ★★**进「角色与势力」页**：工具栏里**不该再有**「⬇ 补全全册实力」那枚钮；
   页底那句**不该再指路**到它，应看到「…**不再自动重查**（全册批量补全的旧入口已撤…）」；
3. ★★**行内那枚「查」必须还在、还能用**（点一下会给状态条反馈）——**这是本棒的边界：只撤全册那一枚**；
4. 若发现**别的**入口少了 ⇒ 请立刻告诉我。

---

## 7. 交卷状态（本棒**未提交** · 下一棒第一动作）

### 7.1 提交状态

| 项 | 值 |
|---|---|
| 分支 | monorepo `leg62-scales-concept-table`（git 根 `F:/deepseek/plugins`） |
| 本棒 | ★**未提交**（改动只在工作区）——与前六棒（leg70～leg75）同款：**它们也都没提交** |
| ⚠ 提醒 | `git status` 里会**同时**看到 leg70～leg76 七棒的改动叠在一起——**别把别人的改动当成自己的**，也别以为"没提交=没生效"（实机位是 junction，**改仓即改实机**） |

**本棒实际动过的文件**（相对 leg75 收尾那一刻）：

| 类 | 文件 |
|---|---|
| 生产 | `src/render.js`（撤钮 + 进度行 + 页底文案 + `PANEL_BUILD`）· `web/index.js`（删批量补全整族 + import 收未用符号） |
| 判据 | `test/lookup-batch.test.js` · `test/render.test.js` · `test/location-inherit-wiring.test.js` |
| 文档 | `docs/session-handoff-2026-09-20-leg76.md`（本文件）· `docs/START-HERE.md`（本棒入口） |

### 7.2 下一棒的**第一动作**

1. ★**等用户回话**：验收只需看一眼「角色与势力」页（§6 那 4 条）；
2. ★**若用户说"还是想要重抽名册"** ⇒ 走 §3-A：**先读那张表**（风险在"别把玩家的世界重开"，不在代码量），
   并按 **leg40/leg70 的"只提取不发明 + 幂等 + 备份 + 写后自证"** 老路做；
   ★**不要**复用本棒删掉的批量编排（那族已判死，判据反向锁着）；
3. ★**别顺手做的事**：别为了"对称"把行内那枚「查」也一起改、别在渲染层再补一个"隐藏"开关、
   **别去动 `src/entity-lookup.js`**（本棒一个字没动是有意的：`planBatches` 还有真消费者）。

---

*第七十七棒（leg76）· 2026-09-20 · 用户实拍：「**这个按钮根本用不了，要么就改成重抽名册，要么就删了**」
→ **先量清"点下去发生什么"**：`forcedFields('absent')` 只覆盖 `absent`/卡上限两类 ⇒ 大荒z1 689 实体**只问 11 个**、
   实教 134 **只问 1 个**（缺字段的 152/132 卡在 `pending` ⇒ **死区**）· 点了不当场跑 · 跑完把总结印成字面量 `null`
→ ★★★**查出根因**：真会问的那 11 个里 **10 个是「势力」**，而提示词**明令势力不抽实力** ⇒ **永远补不上**
→ ⇒ 定稿：**方向错 ⇒ 撤钮**（不是修）；`src/` **一个字没动**（`planBatches` 仍有真消费者）· 行内「查」保留
→ 撤钮端到端验收 + **剥注释**扫代码（8 个符号 + 2 个总线动作一个不剩）+ **四段咬合演练全咬住**
→ 964/964 · 冒烟 8231 未变 · 行为哈希未变 · 环 4 条未变 · `PANEL_BUILD` → `leg76-roster-batch-pull`
→ ★**"重抽名册"如实报工作量与风险**（§3-A，本棒**没做**）→ 交接*

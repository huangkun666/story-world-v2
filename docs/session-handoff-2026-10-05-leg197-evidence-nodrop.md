# 抽象时"引用找不到原文就丢"整族撤销（leg197）

> ★**本笔之后接手的人先看这里**：发布仓 main 已从 `a754834` 走到 **`03e641b`**
> （构建号 **`leg197-evidence-nodrop`**，版本号仍 **`1.1.0`** —— 这一笔改的是**抽象时的净化口径**，
> **没升版本号、没打 tag、没建 release**，用户只说了"推送"）。
> ★**接手第一入口仍是 `STATE.md`**（当前值只在它 §1）；这一份只讲"这一笔干了什么、边界在哪"。
> ★上一笔（leg196 手机端地图浮层整屏）的交接在
> `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-05-leg196-map-mobile.md`。

用户 2026-10-05 两道令（逐字）：

> ①「**把抽象时因为引擎根据模型给的引用而找不到原文而丢弃模型提出的行动的这个行为全部取消了，
> 之前取消了属性相关的，现在我要全面撤销，然后你改完后真跑一次抽象确认没问题后推送，我要睡觉了**」
>
> ②「**对了顺便把文档移植到F盘的那个位置这样好管理并且c盘也不会爆满，好了我要睡觉了**」

## 接手位置

- 唯一实施源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`，分支 `codex/entities-refresh`；
  插件子树在仓库根 `.../332e/plugins` 之下，git 命令里的路径要带 `story-world-v2/` 前缀。
- 本笔**两笔提交**（都在 `3782a51` ＝ leg196 记账笔之后）：
  - `d6e6d56` **实施笔**（36 个路径：9 个 `src/` ＋ 17 个 `test/`（含新增 1 份）＋ 2 个 `web/` ＋ `README.md` ＋
    `STATE.md` ＋ 6 个 `docs/`）；
  - `e3b1a38` **记账笔**（发布点读数：`STATE.md` §1 ＋ `scripts/audit-docs.mjs` 的 `PUBLISHED_*` ＋ 生成物）。
- 发布仓：`a754834` → **`03e641b`**（实施那一笔，核验 **8/8 ✔**）→ **`d5d70e2`**（记账那一笔，同样 **8/8 ✔**，
  就是现在远端 main 的尖端）。**tag / release 一个都没动**（用户只说"推送"）。
  ★口径：`STATE.md` §1「发布仓 main」那一行记的是**代码提交**（`03e641b`），
  **不是 tip**——这是本仓既有的记账次序（`scripts/audit-docs.mjs` 顶部 `PUBLISHED_COMMIT_REF` 那段写着）。
- 只读终检 `node scripts/verify-release.mjs`：**20/20 ✔**（退出码 0）。
- 本机安装：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，
  已 `fetch` ＋ `reset --hard origin/main` 到 **`d5d70e2`**（构建号 `leg197-evidence-nodrop`）。
  ⇒ **Ctrl+Shift+R** 之后参数页最上面那行应显示 `leg197-evidence-nodrop`。
- 装置与证据全在 `F:/deepseek/tmp/leg197-evidence/`（真跑脚本 ＋ 日志 ＋ 红证装置 ＋ 两次发布的日志）。
- 文档迁移装置在 `F:/deepseek/tmp/leg197-docs-migration/`（含两边备份、同步脚本与收尾脚本，见 §6）。

## 一、病（用户那句话在代码里的落点）

Task 3（leg185 那一族）在抽象链上立了一整套**出处核验**：模型每条主张要带 `ev:{s,q}`
（来源编号 ＋ 逐字原话），引擎拿 `verifyQuote` 逐字核；**核不过就把这条主张丢掉**。
除此之外还有两道同族的闸：名册/设定面的**名字必须真在书文里**（`filterByBookEvidence`）、
关系边与起根的**"书里那句话"必须真在书文里**（`longestBookRun`）。

leg189 撤掉了其中**一格**（属性值的逐字出处拒收）。**本笔撤掉剩下的全部。**

用户看到的症状就是"**模型明明提了，账上却没有**"——名号、类别、别名、所属、设定项、档位、
关系边、开局事件、地图地点、查书取值，任何一样只要"引用的那句话在引擎这边对不上"，**当场消失**。

## 二、治法（一句话：**出处只记账、不拦人**）

口径全文写在 `src/abstract-evidence.js` 文件头。要点：

| 层 | 旧法 | 新法 |
|---|---|---|
| `verifyQuote` | 核不过 ⇒ 调用方丢东西 | **函数体一个字未改**；它只是那把尺子，**没人再拿它当闸门** |
| 记账 | `keep` / `drop` / `pending` | `keep`（核过）/ `pending`（没给）/ **`unverified`（给了但对不上 ⇒ ★照收）** |
| 摘要 | `dropped` 数"被拒收的" | **`dropped` 在出处这条路上恒为 0**（它只装"非出处原因"的丢弃）；核不过改记 `unverified`，另加 `unverifiedByReason` 保留"为什么核不过" |

**逐条撤掉的**（每条都留了 `★leg197` 注释）：

| 文件 | 撤掉的闸 |
|---|---|
| `src/abstract.js` | `sanitizeCanon` 的 `keepSetting`（设定面逐项出处）· 名册行的**类别/别名/所属**三格 · 属性遍的类别/所属 · `env` 档位的真出处 · `sanitizeScales` 的 `settingClaim`（**整个形参删掉**：档位/注/子表档位/维度）· 块级关系边的 `_swVerified` 放行条件 · `sanitizeBookRelations` 的**原话闸 ＋ `_swVerified` 闸 ＋ 缺 quote 闸** · **`filterByBookEvidence` 整条删除**（函数 ＋ 两条路上的四处调用） |
| `src/seed-roots.js` | `sanitizeSeedRoots` 的严格道 `ev` 闸 · 缺 quote 闸 · legacy 的"块内跑长"闸 |
| `src/geography-extract.js` | `sanitizeGeography` 的 `check()` 拒收 · **`literal()`（名称/别名/身份说明/通道名要在所引原话里）整条撤掉** |
| `src/entity-lookup.js` | `verifyLookupReplies` 的出处拒收（字段值不再因出处被拒） |
| `src/abstract.js` | 大书路那条"没核过就 fail-closed 丢根"的兜底 ⇒ 改成**照收 ＋ 如实报接线缺口** |

**没撤的（都不是"找不到原文"，逐条钉在判据里）**：缺 `name`/`title` · 缺当事人（`parties` 空）·
自指关系 · 关系边**端点不在名册**（解析不出实体 id ⇒ 本来就落不了账）· `PARAM_GEARS` **枚举白名单** ·
同名重复的**类别/归属冲突墓碑** · 查书**同名多值冲突**（"不采先到者"）· 酒馆宏占位符不当名号 ·
`pruneJunkRules` 那三类（凭**模型的类别标注**，不是出处）。

## 三、四个号

- `PANEL_BUILD` → **`leg197-evidence-nodrop`**（玩家可见：以前被丢的名号/属性/档位/关系边/开局事件/
  地图地点/查书取值，现在**都会出现在面板上**）。
- `CACHE_VERSION` → **`10`**（`9 → 10`：抽取的问法与净化口径都变了 ⇒ 旧缓存必须失效）。
- `CSS_VERSION` **不升**（`web/style.css` 一个字节没动，`CSS_PIN` 号与指纹都没换）。
- `MAIN_PROMPT_V` **不升**（`src/prompts.js` 一行未碰）。
- ★`web/index.js` **3098 / 3100 行**（硬锁 `<3100`）：本笔只改了那两行注释的**文字**，**没加行**。

## 四、判据（**先证红再改**，不是"改完补一条绿的"）

- **新增** `test/evidence-nodrop.test.js` **9 条**，三层：
  ① 记账层（`unverified` 照收、`dropped` 恒 0、`unverifiedByReason` 留原因）；
  ② 五条净化路各一条（名册三格 · 刻度档位/注/维度 · 关系边 · 起根 · 地理）；
  ③ **反向自证**：全仓**不许再有那几道闸的痕迹**（`filterByBookEvidence` 不存在 ·
  `abstract.js` 不再 import `longestBookRun`/`SEED_QUOTE_MIN_RUN` · `sanitizeScales` 没有 `settingClaim` ·
  "块级没核过 ⇒ 丢边"那一支不存在 · 起根没有"指不回书里" · 地理没有 `literal()` · 查书没有"字段值不在所引原话里 ⇒ 不收"）
  ＋ **"没撤的那一半"**（形状与冲突照旧丢——这条改前改后都必须绿，是**对照组**）。
- **先证红**：拿**改前那棵树**（`git checkout HEAD` 到临时目录）跑这份判据 ⇒ **8 红 1 绿**，
  绿的那条正是对照组（`F:/deepseek/tmp/leg197-evidence/red-proof/`）。
- **旧判据翻案**：47 条断言翻成新口径（16 个测试文件）——每一处都**两头咬**：
  东西**照收** ＋ 核不过**仍记进诊断**（`summary.unverified` / `unverifiedByReason` / `onEvidence` 记录）。
  测试**一条没删**（每个文件的 `test(` 条数与改前相同）。
- 全量：**2048 / 2048 · fail 0 · skipped 0 · todo 0**（改前 2039）。
- 冒烟：**PASS · 终态 SSOT 8351 字节逐字节未变 · 警告 0**（本笔不碰引擎的每轮演化）。
- 文档守门：**PASS · 黄 1**（只剩冻结 `LEDGER.md` 的历史超长行）。

## 五、真跑一次抽象（用户令"真跑一次抽象确认没问题"）

装置 `F:/deepseek/tmp/leg197-evidence/run-real-abstraction.mjs`（**只读**：不写世界账/聊天/世界书），
真书 `大荒-姬元真`（235 条，取前 32 条 / 59215 字符 / 32 个允许来源）＋ 真模型 ＋ **严格出处道**。
读数与结论见 `F:/deepseek/tmp/leg197-evidence/real-abstraction.log`：

- **`ok = true`**，**274 秒 / 4 次调用**（2 块 × 名册遍＋设定遍），**零失败块**。
- 产物：概念表 **18 张 / 115 档** · 力量谱系 78 档 · 维度 4 条 · 法则 **33** 条 · 史略 1 条 ·
  社会格局与力量体系**都有** · 书名录 **55** 个 · 设定面 **44** 条 · 关系网 **2** 条 · 带属性的名册条目 **45** 个 ·
  张力（极/方向/强度）正常。
- ★**出处核验照旧在跑**：主张 **168** 条 → 核过 **163** · 待核对 0 · **出处对不上 5（照收）** ·
  **非出处原因丢弃 0**。⇒ 旧法下这 **5 条会被丢掉**（4 条"原话不在本次展示的片段内" ＋ 1 条
  "设定原话不在所引出处内"），**现在全部留在产物里**，同时**仍如实记进诊断**（那一行就在 `errors` 里）。
- ★**关系网真能落账**：`seedBookRelations` 种下 **2** 条 · 跳过 0 · **端点认不出 0**。
- `errors` 只有 5 行，**全是读数**（属性遍成功 2 块 / 起根 1 条 / 属性条目 44 条 / 关系网 2 条 / 抽取依据那一行），
  **没有一行是拒收**。

## 六、文档搬家（用户第二道令）——**做了一半，如实登记**

**做到的**：`F:/deepseek/plugins/story-world-v2/docs/` 现在装着**两边并集**——
C 盘工作树那份 docs **整棵合并进去**（272 个文件**逐字节核对通过**），F 盘原有的 **27 份独有文件**
（leg174–leg196 的交接 ＋ 一份文档同步备份目录 ＋ 两份计划）**原样保留** ⇒ 共 **299 份**。
两边备份在 `F:/deepseek/tmp/leg197-docs-migration/C-docs-before/` 与 `F-docs-before/`。

**没做到的（最后一步）**：把 C 盘那个 `docs` 目录**换成指向 F 盘的目录联接**。
实测 **`Rename-Item docs` 与"腾空后删目录"都被 Windows 拒绝（EPERM）**，而同级的
`demo`/`scripts` 改名正常、`docs` 的**子项**增删也正常 ⇒ 是**某个长驻进程占着 `docs` 这个目录本身**
（多半是本会话的文件观察层，本会话内解不开）。⇒ **收尾脚本已写好、幂等、带回滚**：

```
node F:/deepseek/tmp/leg197-docs-migration/finish-junction.mjs
```

**重启 DSH 会话后跑一次即可收口**（脚本会：腾空 → 删空目录 → `mklink /J` → 核对 → 打印 git status；
删不掉就把东西原样搬回来并退出，绝不丢文件）。
★**收口之前，两边怎么保持一致**：在 C 盘改完 docs 之后跑一次
`node F:/deepseek/tmp/leg197-docs-migration/sync-to-f.mjs`（只覆盖 C 盘有的文件、逐字节核对；
F 盘独有的那些原样不动）。本笔收尾时已跑过，两边一致（`同步 0 个 · 272 个全部逐字节核对通过`）。
★在那之前：**新交接一律写 F 盘那份**（这本来就是这个仓的规矩，见 `AGENTS.md`）。
★**副作用如实登记**：F 盘那个仓（分支 `leg151-prefetch`）的 `docs/` 因此会显示为"被改过"
（25 个文件被 C 盘那份覆盖）——**这是"F 盘成为文档的家"的必然结果**，要退回就用上面那两份备份。

## 七、后续边界（如实登记）

1. ★**`canon.settings` 那道缝重新敞开了**：leg139 为"外来内容从 `settings` 这一格落账"补的全书级校验
   随本笔撤掉 ⇒ 别的扩展塞进那次调用的内容可以再落账。**这是用户当次的明确选择**；
   要收回来只需恢复 `src/abstract.js` 里那两个函数调用（历史里有一份原样实现，本笔的注释里写着位置）。
2. ★**`docs/` 里那条 `sourceText` 形参**（`sanitizeScales` / `sanitizeBookRelations` / `sanitizeSeedRoots`）
   **留着但不再被读**——只为调用方零改动。下次动这三个函数时顺手删掉。
3. ★**`web/index.js` 那个 `dropped` 读数成了死通路**（直抽刻度草稿栏）：出处闸撤了 ⇒ 它恒为 0，
   而 `src/render.js` 那一支与 `test/scales-concept-table.test.js` 一条断言还认它。
   **本笔没清**（清它要同时动渲染层与判据）；要清就一起清。
4. ★**查书那条路也一并撤了**（`src/entity-lookup.js`）：字段值不再因出处被拒，`stats.rejected`
   只剩"同名多值冲突"一种来路。★这是把用户那句"全面撤销"读到了底——**若他本意只指抽象**，
   这一处就是**多撤的**（恢复点：`verifyLookupReplies` 里那段被替换的循环，注释里留着旧文案）。
5. ★**发布仓只推了 main，tag/release 没动**：装仓库地址/走更新的人拿得到这一笔；
   **从 release 页下载的人拿不到**（`v1.1.0` 仍指着 `e28be61`）。要不要发补丁版**等用户拍板**。
   ★这也是**连着的第二笔"只推 main 不发版"**（leg196 也是）⇒ 下一个发版日会一次带两笔出去。
6. 本笔**没有改世界书、没有改用户聊天、没有重写工作区**；`CACHE_VERSION` 抬了 ⇒ **旧抽取缓存自动失效**，
   已经抽好的世界**不会**被自动重抽（要重抽得用户自己点）。

## 八、文档收尾

源码改动：`src/abstract-evidence.js`（口径全文 ＋ `unverified` ＋ `unverifiedByReason`）·
`src/abstract.js`（七处闸 ＋ 删 `filterByBookEvidence` ＋ 提示词里那几句"核不过就丢"改成实话）·
`src/seed-roots.js` · `src/geography-extract.js` · `src/entity-lookup.js` · `src/abstract-setting-report.js`
（`reasons` 收 `unverified`）· `src/render-base.js`（`PANEL_BUILD`）· `src/fp-hash.js`（`CACHE_VERSION`）·
`src/render.js`（草稿栏那段注释改实话）· `web/diagnostic-transport.js`（`unverified` 记 `warn`）·
`web/index.js`（两行注释改文字，**不加行**）。

判据改动：**新增** `test/evidence-nodrop.test.js`（9 条）；**翻案** 16 个文件 47 条断言
（`abstract` · `abstract-chunk` · `abstraction-input` · `abstract-fields` · `abstract-confirmation` ·
`abstract-review-fixes` · `abstract-review-fixes2` · `book-relations` · `seed-roots` ·
`integration-boundary-roots` · `integration-boundary-lookup` · `geography-extract` ·
`empty-setting-diagnostics` · `retain-extracted-attributes` · `scales-concept-table` · `render`）。

台账：`STATE.md` §1（判据 · `PANEL_BUILD` · 新增一行"出处核验"口径 · `CACHE_VERSION`）与 §4 ＋ §5（文档住哪）·
`README.md` 判据数 · `docs/done-archive.md` 开头新增 leg196 一条 · `docs/work-current.md` §1 新令逐字 ·
`docs/index.json` 与知识索引随文档重建。
★上一笔的交接（leg196 那一份）**没有**加指向本笔的横幅——它记的是"地图浮层整屏"那件事，与本笔不冲突。
F 盘那份 `STATE.md` **本次也没有覆盖**（它仍停在 leg169 读数；覆盖它是另一件事）。

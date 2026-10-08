# 「往事怎么找」三格真正生效 ＋ 四格挂上小问号

用户 2026-10-05 先令「把冻结改成真正生效吧，顺便把参数的名字改一下，但是要显得专业精简点」，看到改名一版后当场纠正：「**我不是让你这样改名字我是想让你改成一眼就能知道这是作用在哪以及作用是什么的名字**」，随即定案：「**名字恢复到原样，然后在旁边添加一个小问号说明作用即可**」。功能、判据、台账与本机预览安装已全部完成。当前权威读数统一见 [源码 STATE.md §1](C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2/STATE.md:40)。F 盘原开发分支的源码与 STATE.md 不覆盖。

## 接手位置

- 唯一实施源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`，分支 `codex/entities-refresh`；插件子树在仓库根 `.../332e/plugins` 之下，git 命令里的路径要带 `story-world-v2/` 前缀。
- 本笔两次提交：`f8584f0`（现读设置，含一版**已被用户否掉的改名**）与 `be822d1`（**最终形状**：名字恢复原样 ＋ 四枚小问号 ＋ `CSS_VERSION` 同批升）。两笔都留在历史里，照本仓"不修正过去、只标注过去"办——**别把 `f8584f0` 那版名字当成现在的口径**。
- 功能提交 `be822d1`；安装提交 `9587809`（669 个跟踪文件与源码逐字节一致）；机读记录 `F:/deepseek/tmp/leg192-param-hints/final-verification.json`。
- 本机安装：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，分支 `main`。
- **没有推任何远端**（发布仓仍停在 `88bd80e` / `leg160-panel-window`）。刷新酒馆 `Ctrl+Shift+R` 后生效；参数页最上面那行应显示 `leg192-param-hints`。
- 历史未决事项以源码 `STATE.md` §3 与 `docs/work-current.md` 为准。

## 治的是什么病

参数页「插件对你的对话做了什么」那张卡里，后三格（相似度阈值 · 最大召回条数 · 检索上下文深度）**界面上能填、设置也真写盘，但真跑的那条路读的是模块加载时冻结的常数**（`web/inject.js` 的 `RETRIEVAL_PARAMS`）⇒ 填多少都不生效：

| 环节 | 旧代码 | 结果 |
|---|---|---|
| 定义 | `web/inject.js` `Object.freeze({ … top: RETRIEVAL_TOP … })` | 冻结 |
| 那个数 | `src/limits.js` `RETRIEVAL_TOP = 6` | 常数 |
| 接线 | `web/index.js` `makeVectorRecall({ …, params: RETRIEVAL_PARAMS })` | 只喂常数 |
| 消费 | `web/settings-channels.js` `Number(params.top) … : 6` | 恒为 6 |
| 兜底 | `web/embed-runtime.js` `top ?? RECALL_TOP_DEFAULT` | 也是 6 |

`web/` 里 `retrievalTop` 的消费方**只有渲染层那一处**（读出来印到界面上），没有第二条路。

## 改了什么

### 一、参数改成现读（填了就生效）

- `web/inject.js` 新增 `liveRetrievalParams(settings)`：填过的用填的，非法/缺省回出厂值。
- `createInjector` 新增一格依赖 `retrievalParams`，内部每次用时现取（`paramsNow()`）：查询串两处与字面额度一处不再读冻结常数。
- `web/settings-channels.js` 的 `makeVectorRecall`：`params` 现在**可以是一个函数**，每次召回现取现值；不传函数的调用方行为逐字节不变。
- `web/index.js` 只加两格接线：`retrievalParams` 与 `params` 都是 `() => liveRetrievalParams(modelSettings())`。

### 二、参数一改，旧的召回结果当场作废重取

召回结果是**提前备好**的（聊天侧那段注入是同步的），只改读数不改缓存指纹就会拿旧结果充数。治法：把**取数那几格的指纹**并进 `readVectorScope()`，`sameVectorScope` 一起比 `top / minScore / depth` ⇒ 参数一改指纹就变 ⇒ 走既有的作废重取那条路。

### 三、名字保持原样 ＋ 各挂一枚小问号

- **四个名字一个字没改**（`一轮最多递多少条行动` · `相似度阈值` · `最大召回条数` · `检索上下文深度`），状态条那三格的名字也照旧。
- 每格标签下面各挂一枚小问号（`src/render.js` 的 `paramHint()`）：**复用现成的 `.sw2-fold`**（`？` 圆圈 ＋ 原生 `<details>`，零 JS、零接线、浏览器原生键盘与无障碍），点开说清三件事——**这一格作用在哪 · 管什么 · 什么时候不生效**。
- 四段说明的要点：第一格"管的是**递给世界模型的行动条数**，它不进对话，不是注入的行数上限"；后三格各自"管的是**按语义找旧事那一路**（字面那一路不吃它）"＋"**没开记忆通道时这格不生效**"。
- 结构上**问号是 `.sw2-field` 的直接子元素**（`grid-column:1/-1`），**不许塞进 `<label>`**：块级 `<details>` 放进 label 不合规范，点它还会顺带把焦点带进数字框。判据专门咬这一条。
- CSS 只多两条规则（`web/style.css` 的 `.sw2-fold.sw2-fold-inline`）⇒ **`CSS_VERSION` 同批升**为 `20261005-leg192-param-hints`，`CSS_PIN` 的号与指纹（`6e6ddcab…`）同批换。

## 验收和证据

- 新增判据 `test/retrieval-params-live.test.js`（5 条，走真生产函数，不写复制品）：① 改「最大召回条数」当场改取回条数、非法值回出厂；② 改「检索上下文深度」当场改查询串；③ 参数一改 ⇒ 旧结果作废重取；④ 出厂缺省逐格等于 `limits.js` 的值；⑤ 四个名字保持原样、四枚问号都在标签外面、说明里写明了适用范围。
- 全量与冒烟读数见 `STATE.md` §1；改名前后的参数页在真账 `chronicle-page-real-world.json` 上逐字渲染核对过。
- 安装版上重跑同一套：判据 **2031 / 2031 · fail 0** · 冒烟 **PASS · 8351 字节 · 警告 0** · 文档守门 **PASS · 黄 1**（唯一的黄是冻结 `LEDGER.md` 的历史超长行，未重写历史）。
- `MAIN_PROMPT_V` / `CACHE_VERSION` / `DB_VERSION` **都不升**（提示词与抽取问法没碰；本笔零模型调用）。

## 后续边界（如实登记）

- **只改了"聊天侧那一段往事"的参数**。世界模型那一栏的召回口（`src/pack.js` 的 `fetchRelatedPast`）**从来不读这三格**：它的条数上限是 `RECALL_TOP_DEFAULT`（也是 6），走另一条路。要不要让它也吃玩家设置，**是另一个决定**，本笔没动。
- **整段往对话里塞多少字，目前是写死的**（`web/inject.js` 的 `LEDGER_RECALL_DEFAULT.maxChars = 1600`，参数页上没有对应旋钮）；两条路各占多少份额也写死（`RETRIEVAL_LITERAL_SHARE = 0.6`）。用户 2026-10-05 当场问过"怎么没有向量库注入正文的参数"——**这确实是缺的**，要不要补、补哪一个（字数总额度 / 语义份额），得他点头再动。
- **没开记忆通道时这三格仍然不生效**——那是设计，不是缺陷；四段说明里都写明了。改设置的生效时点是"下一次消息进来备召回那一刻"，不是"填完立刻重算"。
- 本笔没有真模型调用、没有改世界书或用户聊天、没有推远端。

## 文档收尾

源码改动：`src/render.js`（`paramHint` ＋ 四格挂问号）· `src/render-base.js`（`PANEL_BUILD` ＋ 留档）· `web/index.js`（接线两格 ＋ `CSS_VERSION`）· `web/inject.js`（`liveRetrievalParams` ＋ `paramsNow`）· `web/settings-channels.js`（`params` 可为函数）· `web/style.css`（两条规则）· `web/model-channel.js`（状态条名字恢复原样）· `test/render.test.js`（值同批换）· 新增 `test/retrieval-params-live.test.js`。

台账：`STATE.md` §1 的读数（判据数 · `PANEL_BUILD` · `CSS_VERSION` · `web/index.js` 行数）与 §4 一条；`README.md` 判据数；`docs/done-archive.md` 本笔收进 leg189 与 leg185–leg186 两条（§4 只留当前两件，守住 20 KB 黄线：现 19318 字节）；`docs/index.json` 与知识索引随文档重建。F 盘那份 `STATE.md` 仍停在 leg169 读数，**本次没有覆盖它**。

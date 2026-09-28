# 知识索引（生成物 · 别手改）

> 由 `node scripts/build-kb.mjs` 从仓里**现抽**：**256 张卡**，每一张都指得出**源文件与行号**。
> 指纹 `97bd26b6-d7b6c977`（源文件 97bd26b6 · 抽卡代码 d7b6c977）——**对不上就是索引过期**（守门 R10）。

**怎么用**：想查什么就搜关键词（`${cards.length}` 张卡全在下面，按类分组）——
机器可读的那份在 `docs/kb.json`，带搜索框的那份在 `docs/kb-search.html`（浏览器直接打开）。

## 一眼看清这仓

| 事实 | 值 |
|---|---|
| 它是什么 | 跑在 SillyTavern 里的"活世界引擎"：世界书只读 · 引擎记账（账房＋史官） · LLM 只提议与执笔 |
| 构建号 | `leg145b-own-errors` |
| 提示词号 | `v2-agenda-t1-30` |
| 版本 | `1.0.0`（ST 扩展） |
| 规模 | src **47** · web **18** · 判据 **116** · 探针 **76** · 文档 **159** |
| 最新交接 | `session-handoff-2026-09-28-leg145-mobile.md` |

## 卡片（按类分组）

### 入口/规矩（7）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| STATE.md · 0. 三十秒版：这台东西是什么 | `STATE.md:13` | 一个跑在 SillyTavern 里的**活世界引擎**。你每推进一步 RP，世界演化一步：势力与角色按自己的盘算行动，事件从行动里长出来、带因果。 |
| STATE.md · 0.5  活儿在哪（接手第一件事） | `STATE.md:29` | ／ 你要知道的 ／ 只看这一处 ／ |
| STATE.md · 1.  当前权威读数（唯一出处） | `STATE.md:40` | > 这一节是**全仓唯一的当前值出处**。别处引用一律写"见 `STATE.md` §1"。 |
| STATE.md · 2. 红线与规矩（逐字搬家，不许改写） | `STATE.md:72` | > **用户原话：「不要动代码，把不要动代码写进最高准则，没有我的命令不准动一个字节」。** |
| STATE.md · 3.  未决事项（唯一一份活儿清单） | `STATE.md:134` | > 每条带：**出处** · **触发条件** · **拍板人**。做完就地划掉并写"已办结（哪棒）"。 |
| STATE.md · 4. 上一棒 | `STATE.md:174` | - **本次**（2026-09-28 · **手机端适配**）：用户令「**我需要你做适配手机端**」⇒ **一行引擎代码没动**， |
| STATE.md · 5. 现场（本机） | `STATE.md:191` | - **项目**：`F:\deepseek\plugins\story-world-v2`（仓库根是 `F:\deepseek\plugins`，**不是** `F:\deepseek`；分支 **`main`**——★ |

### 活儿（12）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 现在做什么（用户最后一道令 · 逐字） | `docs/work-current.md:14` |  |
| 最近几道令（倒序 · 一行一道 ＋ 落点） | `docs/work-current.md:338` | 1. 2026-09-25（本笔）：★★★这些设定总共也就几千字吧？干脆全塞得了然后我预算抬到50000token＋ ／ 2. 2026-09-25：★★★没用的设计全给我摒弃＋不能本轮检索到⇒ |
| 还剩哪些活儿（批次表指针 ＋ 怎么用） | `docs/work-current.md:1` | 唯一一份批次表：`docs/session-handoff-2026-09-22-leg109b-defects.md` §3 |
| 批次 第 0 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:141` | C1 换书检测 · D1 撤 `entityUpdates` 上限 |
| 批次 第 1 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:142` | B2 编年进包 · B1 世界动向默认开 |
| 批次 第 2 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:143` | B3/E1 账本自己的检索 |
| 批次 第 3 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:144` | ★★A2 剩下那一半（世界 → 正文的完整回路）+ C4 把判据喂给模型 |
| 批次 第 4 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:145` | A3 关系网（账上第 10 张表） |
| 批次 第 5 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:146` | C3 对账窗口（★已裁：不给玩家做，2026-09-23，见下表后的更正）+ E2/E3 |
| 批次 第 6 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:147` | A4 颗粒度对齐 + A5 玩家棋子的状态 |
| 批次 第 7 批 · 已办结 | `docs/session-handoff-2026-09-22-leg109b-defects.md:148` | D3 记忆层解耦 + E1 卷库摘要 |
| 批次 随时 · 没做 | `docs/session-handoff-2026-09-22-leg109b-defects.md:149` | 观感那一批 |

### 待拍板（4）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 待拍板 1 · 账本检索用什么？ | `docs/session-handoff-2026-09-22-leg109b-defects.md:179` |  |
| 待拍板 2 · 关系边的额度：每轮允许几条关系变更？ | 照 `entityUpdates` 撤限后的口径（不限）／单独设一个上限 | 要单独设限（它是世界结构的变化，比一个人的某个字段重），但数字得用户拍 | `docs/session-handoff-2026-09-22-leg109b-defects.md:180` |  |
| 待拍板 3 · 记忆解耦的语义：不装记忆插件时，插件自己要不要存一份？ | ①不要（那个开关就是"装了才有用"）②要（等于自建一个记忆库，工作量不小） | 没倾向，这是产品决定 | `docs/session-handoff-2026-09-22-leg109b-defects.md:181` |  |
| 待拍板 4 · 颗粒度往哪边对齐 | `docs/session-handoff-2026-09-22-leg109b-defects.md:182` |  |

### 缺口（19）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 缺口 A1 | `docs/session-handoff-2026-09-22-leg109b-defects.md:85` | 玩家的行动全靠聊天模型自觉写标签。忘写 ⇒ 退回逐行扫全篇；再不行 ⇒ 当"这一轮玩家没行动"，世界照演 |
| 缺口 A2 | `docs/session-handoff-2026-09-22-leg109b-defects.md:86` | 世界模型看不到正文，聊天模型看不到账本——两条线各写各的故事 |
| 缺口 A3 | `docs/session-handoff-2026-09-22-leg109b-defects.md:87` | 没有关系网（见 §1.2） |
| 缺口 A4 | `docs/session-handoff-2026-09-22-leg109b-defects.md:88` | 正文的颗粒度进不了账（见 §1.1 ③） |
| 缺口 A5 | `docs/session-handoff-2026-09-22-leg109b-defects.md:89` | 玩家棋子本身几乎不累积状态——只有身份与位置。第 30 轮那句"我答应过你"在引擎眼里不存在 |
| 缺口 B1 | `docs/session-handoff-2026-09-22-leg109b-defects.md:95` | 「世界动向」默认关（引擎算的张力/动乱/大势本来能反向影响故事，关着就等于这条回路不存在） |
| 缺口 B2 | `docs/session-handoff-2026-09-22-leg109b-defects.md:96` | ★编年史一行都不进世界步。我核了包的全部键（world/tension/setting/positions/entities/agendas/pendingEvents/departed/recentClosedEven |
| 缺口 B3 | `docs/session-handoff-2026-09-22-leg109b-defects.md:97` | 账本自己的历史没有检索（旧编年进卷、卷只给玩家看；recall.js 检索的是书不是账） |
| 缺口 B4 | `docs/session-handoff-2026-09-22-leg109b-defects.md:98` | 注入是"上一轮结算出来的"——就算把 B1 打开，故事也比世界晚一拍 |
| 缺口 C1 | `docs/session-handoff-2026-09-22-leg109b-defects.md:104` | 换书检测缺失（★已拍板做，见 §1.3） |
| 缺口 C2 | `docs/session-handoff-2026-09-22-leg109b-defects.md:105` | 改书不重抽 ⇒ 聊天模型读新书、账本用旧快照。★按用户定的"书一般不变、变了就重开聊天"，这条降级为低优先 |
| 缺口 C3 | `docs/session-handoff-2026-09-22-leg109b-defects.md:106` | 没有对账窗口：三份真相（书 / 账 / 正文）可逆性完全不同（书随时可改 · 字段可改 · 已结算的事件不可逆），却没有一处并排给玩家看 ⇒ 玩家分不出哪句是原稿、哪句是插件改的、哪句是模型编的 |
| 缺口 C4 | `docs/session-handoff-2026-09-22-leg109b-defects.md:107` | "据书 / （推）"这套判据没喂给模型——账上有发票，但模型不知道自己能不能推翻书里明述的东西 |
| 缺口 D1 | `docs/session-handoff-2026-09-22-leg109b-defects.md:113` | entityUpdates 每轮 ≤3 是提案态数字、静默拦变更（★已拍板取消，见 §1.3） |
| 缺口 D2 | `docs/session-handoff-2026-09-22-leg109b-defects.md:114` | 同类嫌疑犯：DEPARTED_TAIL=20、recall ≤5 段/≤4000 字符——同一条"提案态"自认里点名的另外两个 |
| 缺口 D3 | `docs/session-handoff-2026-09-22-leg109b-defects.md:115` | 记忆那一层全绑死柚月の记忆（见 §1.1 ①）；而且只投不读回、没有"过期"概念（死了的人、收了场的事永远躺在记忆里） |
| 缺口 E1 | `docs/session-handoff-2026-09-22-leg109b-defects.md:121` | 卷库只存不检索、也不压缩（整段搬走，没有摘要）——★2026-09-25 用户拍板：摒弃"摘要"那一半（"没多大用的设计直接摒弃即可"）。理由两条：它与原文同形状（都是按时间的流水 ⇒ 不带来新信息），而且进不了包（tr |
| 缺口 E2 | `docs/session-handoff-2026-09-22-leg109b-defects.md:122` | 名册只列活人 ⇒ 账上死了的人从聊天模型视野里整个消失；而给世界模型的"离场名册"不报死没死（有意为之，防编事实） |
| 缺口 E3 | `docs/session-handoff-2026-09-22-leg109b-defects.md:123` | 同一人的 实力 两边可以不同（账本可改、聊天模型看到的是书里原值） |

### 交接（91）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 交接 leg48（2026-09-16） | `docs/session-handoff-2026-09-16-leg48.md:1` | 0. 一句话 ／ 1. 判决性证据（都在本机，可复核） ／ 2.2 三个把我拦住很久的坑（留档，别再踩） ／ 3. 改了什么（逐条对着 §0 的表） ／ 4. 判据与实证（本棒） ／ 5. 用户验收三步（必须做，且只看这 |
| 交接 leg49（2026-09-16） | `docs/session-handoff-2026-09-16-leg49.md:1` | 0. 一句话 ／ 1. 定稿口径（用户逐条拍板） ／ 2. 三列版式（定稿） ／ 3. 判据与实证 ／ 4.  本棒最该带走的三条教训 ／ ① 构建号踩了同一颗雷（第二次） ／ ② 一条"永远为真"的断言（假绿的典型形状 |
| 交接 leg50（2026-09-17） | `docs/session-handoff-2026-09-17-leg50.md:1` | 0. 一句话 ／ 1. 定稿口径（用户逐条拍板） ／ 2. 改后长什么样 ／ 3. 判据与实证 ／ 4.  本棒最该带走的四条 ／ ① 真事件判据连错两次（第三次才对） ／ ③ 只有真浏览器 + 逐行几何测量才抓得到的缺 |
| 交接 leg51（2026-09-17） | `docs/session-handoff-2026-09-17-leg51.md:1` | 0. 一句话 ／ 2.  用户那两句的取证结论 ／ 4. 细案大纲（下一任照这个开工；先拍板再实施） ／ Task 0 · 前置取证（没做完不许动手） ／ Task 1 · 参数页版式（用户已认的两条） ／ Task 2 |
| 交接 leg52（2026-09-17） | `docs/session-handoff-2026-09-17-leg52.md:1` | 0. 一句话 ／ 3.  用户三句拍板（逐句对上改了哪一处） ／ 4.  实测读数（改前  改后，同装置同口径） ／ 5. 改了哪些文件（逐项） ／ 7.  本棒没做的（明确划界） ／ 8.  交给下一任的待办（按优先级 |
| 交接 leg53（2026-09-17） | `docs/session-handoff-2026-09-17-leg53.md:1` | 0. 一句话 ／ 5. 五个面一起改（参数口径只有一处） ／ 6. 判据 ／ 7. 改了哪些文件 ／ 8.  交给下一任的待办 |
| 交接 leg54（2026-09-17） | `docs/session-handoff-2026-09-17-leg54.md:1` | 0. 一句话 ／ 2. 改了什么（逐处） ／ 5. 判据 ／ 6.  留给下一任的 |
| 交接 leg58（2026-09-18） | `docs/session-handoff-2026-09-18-leg58b.md:1` | 0. 一句话 ／ 1. 世界书是怎么写的（数据面） ／ 2. 怎么生效（两套消费者，各走各的） ／ 3.  病灶（真账实证，可复核） ／ 4.  本棒的未知清单（下一任的工作量都在这） ／ 4.1 我说错过的一条（留档， |
| 交接 leg59（2026-09-18） | `docs/session-handoff-2026-09-18-leg59.md:1` | 0. 一句话 ／ 2.  五个未知的结案 ／ 4.  下一任第一步（按此顺序，别跳） ／ 5. 本棒的交卷状态 |
| 交接 leg60（2026-09-18） | `docs/session-handoff-2026-09-18-leg60.md:1` | 0. 一句话任务 ／ 2. 要做什么（按顺序，别跳） ／ 第 2 件（紧随其后，别单独做）：让设定进包 ／ 第 3 件（可选、最后做）："编译完整性"自检 ／ 3. 验收（现成期望值，直接抄） ／ 4. 别做的事（这一棒 |
| 交接 leg61（2026-09-18） | `docs/session-handoff-2026-09-18-leg61.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 3. 待办（按优先级；每条都给方案与代价） ／ A. 势力树（用户已拍「还是得要」，未实施） ／ 6. 验收基线（下一棒别倒退） ／ 7.2 真机读数（新管线 |
| 交接 leg62（2026-09-18） | `docs/session-handoff-2026-09-18-leg62.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 2. 本棒已完成（读数可复核） ／ 2.2 真机验收读数（全本跑 · 真模型） ／ 3. 待办（按优先级） ／ B. "没有档位"的分支（本棒只查清，未做）  |
| 交接 leg63（2026-09-18） | `docs/session-handoff-2026-09-18-leg63.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 2. 本棒已完成（读数可复核） ／ 2.1 设计口径（用户当场拍的四条） ／ 2.2 落地（9 笔） ／ 2.3 面板怎么变的（用户截图那个混排的根治） ／  |
| 交接 leg64（2026-09-18） | `docs/session-handoff-2026-09-18-leg64.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 2. 本棒已完成（5 笔，读数可复核） ／ 2.2 参数页（七格全可调） ／ 3. 待办（按优先级） ／ A. 规则进包（下一棒的正事，本棒只出数未改码） ／ |
| 交接 leg65（2026-09-18） | `docs/session-handoff-2026-09-18-leg65.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 1.4 两道闸的单位教训（本棒第一版就错在这里） ／ 1.5 老账口径（用户拍板）与它的可验证后果 ／ 2. 本棒已完成（1 笔，读数可复核） ／ 3. 待办 |
| 交接 leg66（2026-09-18） | `docs/session-handoff-2026-09-18-leg66.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 1.5 发布面审计（本棒探的，逐条有出处） ／ 2. 本棒已完成（8 笔，读数可复核） ／ 3. 待办（按优先级） ／ B. UI 微调（用户提了，但没说哪里 |
| 交接 leg67（2026-09-18） | `docs/session-handoff-2026-09-18-leg67.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测，都指得出出处） ／ 1.1 现在是两个仓，职责不同 ／ 1.2 实机装的是什么（把这一格钉死） ／ 1.3 发布面四件（都已落地） ／ 1.4 三条"交接没写、实读才看见"的东西 |
| 交接 leg68（2026-09-18） | `docs/session-handoff-2026-09-18-leg68.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.4 顺带补上三处净化器原先根本没判的引用 ／ 1.5 收口后的依赖方向（叶子模块，无环） ／ 2. 本棒已完成 ／ 2.2 判据（14 条，逐条一句话） ／ 3. 待办 |
| 交接 leg69（2026-09-19） | `docs/session-handoff-2026-09-19-leg69.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.4 "锁有牙"是演练出来的，不是声称的 ／ 2. 本棒已完成 ／ 2.1 改动面（新建 1 + 改 4） ／ 2.2 判据（5 条，逐条一句话） ／ 3. 待办 ／ D |
| 交接 leg70（2026-09-19） | `docs/session-handoff-2026-09-19-leg70.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 2. 本棒已完成 ／ 2.1 改动面（新建 3 + 改 3） ／ 2.2 判据（10 条，逐条一句话） ／ 3. 待办（按优先级） ／ C. A2 真修（要报批） ／ D. |
| 交接 leg71（2026-09-19） | `docs/session-handoff-2026-09-19-leg71.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.3 "搬"是怎么做的（可自证，不是手抄） ／ 1.5 三条读数（"切割没改行为"的硬证据） ／ 2. 本棒已完成 ／ 2.1 改动面（新建 3 + 改 8） ／ 2.2 |
| 交接 leg72（2026-09-19） | `docs/session-handoff-2026-09-19-leg72.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.4 状态归属（本棒最该记住的一条） ／ 2. 本棒已完成 ／ 2.1 改动面（新建 2 + 改 6） ／ 2.2 判据（5 条，逐条一句话） ／ 2.3 交付面 ／ 2 |
| 交接 leg73（2026-09-19） | `docs/session-handoff-2026-09-19-leg73.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.5 接线层那 5 处改动（逐条记账） ／ 2. 本棒已完成 ／ 2.1 改动面（新建 2 + 改 4） ／ 2.2 判据（5 条，逐条一句话） ／ 2.3 交付面 ／  |
| 交接 leg105（2026-09-20） | `docs/session-handoff-2026-09-20-leg105.md:1` | 1.1 先排查错的那一层（不是白干） ／ 1.2  真凶：双重死控件（两处都查实了） ／ 1.3 为什么不修还有一条工程理由 ／ 4.  判据跟改（三处）＋ 细案补注（三处） ／ 6.  本棒最该带走的（三条） |
| 交接 leg74（2026-09-20） | `docs/session-handoff-2026-09-20-leg74.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.3 三个入口 + 唯一实现 ／ 1.5 本棒自查发现的一个洞（已修，如实留档） ／ 2. 本棒已完成 ／ 2.2 判据（新增 6 条，逐条一句话） ／ 2.3 交付面  |
| 交接 leg75（2026-09-20） | `docs/session-handoff-2026-09-20-leg75.md:1` | 0. 一句话 ／ 1. 硬事实（本棒实测） ／ 1.2 丢弃集 = 三类（这是本棒的核心改动） ／ 1.4 唯一一份"哪几类不进账本" ／ 1.5 函数改名与"不改留痕常量名"的理由 ／ 2. 本棒已完成 ／ 2.2 真 |
| 交接 leg76（2026-09-20） | `docs/session-handoff-2026-09-20-leg76.md:1` | 0. 一句话 ／ 1. 硬事实（本棒真账实测） ／ 1.2 根因：方向错了（这是撤而不是修的依据） ／ 1.3 这条病史早就记过（不是本棒第一次发现） ／ 2. 本棒已完成 ／ 2.2 src/ 一个字没动（边界纪律）  |
| 交接 leg77（2026-09-20） | `docs/session-handoff-2026-09-20-leg77.md:1` | 0. 一句话 ／ 2. 族符号的真实落点（六段，不连续） ／ 3. 族外消费者（决定"要不要注入"、注入什么） ／ 4. 三根刺（下一棒搬之前必须处理） ／ 5. 建议的切口（下一棒可直接照此施工） ／ 6. 待办（按优 |
| 交接 leg78（2026-09-20） | `docs/session-handoff-2026-09-20-leg78.md:1` | 0. 一句话 ／ 1. 本棒做了什么（施工结果） ／ 1.1 搬进新家的东西 ／ 1.2 没搬的（三条缝，逐条有理由） ／ 3. 本棒当场踩到的两个坑（下一棒必读） ／ 4. 三条设计决定（都写在代码里，别改回去） ／  |
| 交接 leg79（2026-09-20） | `docs/session-handoff-2026-09-20-leg79.md:1` | 0. 一句话 ／ 1. 本棒做了什么（施工结果） ／ 1.1 搬进新家的东西 ／ 1.2 没搬的（两条缝，逐条有理由） ／ 坑③：同进程里"初始化那一次"观察不到 ／ 4. 三条设计决定（都写在代码里，别改回去） ／ ① |
| 交接 leg80（2026-09-20） | `docs/session-handoff-2026-09-20-leg80.md:1` | 0. 一句话 ／ 2. 本棒做了什么（施工结果） ／ 2.3 没搬的（两条缝，逐条有理由） ／ 4. 本棒踩的三个坑（都已修，都写进判据/装置） ／ 坑③：另起进程的探针"要能看见那条纪律"才有意义 ／ 6. 下一棒正事 |
| 交接 leg81（2026-09-20） | `docs/session-handoff-2026-09-20-leg81.md:1` | 0. 一句话 ／ 1.1 发生了什么（三个动作，第二个是致命的） ／ 1.3 现在仓库处于什么状态 ／ 1.4 恢复路径（三条，按推荐序） ／ 1.5 本棒留下的"止血"动作（已完成） ／ 3. 本棒踩的四个坑（都已修， |
| 交接 leg83（2026-09-20） | `docs/session-handoff-2026-09-20-leg83.md:1` | 0. 一句话 ／ 1.1 执行结果（一族一读数） ／ 2. 现在是什么状态（读数） ／ 4. 本棒最值钱的四条教训（含我自己犯的） ／ ①（我犯的·最贵）一次性装置必须自带幂等闸 ／ ③（我犯的）import 成功 ≠  |
| 交接 leg85（2026-09-20） | `docs/session-handoff-2026-09-20-leg85.md:1` | 0. 一句话 ／ 1. 本棒做了什么（四笔，逐笔可 review） ／ 1.2 第 1 笔的迁移本身（§8-2 的案子） ／ 2. 读数（本棒收尾） ／ 3.1 本棒那一刀是怎么定的（底数，不是印象） ／ 3.2 本棒踩 |
| 交接 leg86（2026-09-20） | `docs/session-handoff-2026-09-20-leg86.md:1` | 0.  接手先看这一条：用户已明确叫停结构优化 ／ 1. 本棒做了什么（三笔，第一笔已撤） ／ 2. 读数（本棒收尾，= leg85 收尾态） ／ 3.  用户两问的源码答案（本棒唯一的实质产出） ／ 3.1 插件怎么知 |
| 交接 leg88（2026-09-20） | `docs/session-handoff-2026-09-20-leg88.md:1` | 1. 两棒做了什么（一张表看完） ／ 6.  本棒踩的坑（写下来免得下一任再踩一遍） ／ 7.1 用户口径（原话） ／ 7.2  已核过的真接口（不用自己挂钩子） ／ 7.3  三个真障碍（不解决就别接进引擎） ／ 7. |
| 交接 leg89（2026-09-20） | `docs/session-handoff-2026-09-20-leg89.md:1` | 1. 本棒做了什么（一张表看完） ／ 2. 读数与自证（本棒收尾，全部实测） ／ 3.2 提取出来落到哪（三处） ／ 4.  本棒踩的坑（写下来免得下一任再踩） ／ 5.  已登记、本棒没做（明确不是待办） ／ 6.   |
| 交接 leg93（2026-09-20） | `docs/session-handoff-2026-09-20-leg93.md:1` | 1. 这一棒做了什么（一张表看完） ／ 2. ③段「世界动向」：从"账本腔"到"人话" ／ 3.  三件必须记住的事（这一棒最贵的产物） ／ 3.3 用户的两句裁示（照做，别改） ／ 4. 本棒踩的坑（写下来免得下一任再 |
| 交接 leg93（2026-09-20） | `docs/session-handoff-2026-09-20-leg93b.md:1` | 1. 这一棒做了什么（一张表） ／ 2.  用户那一问的实测答案（本棒的技术核心） ／ 3. 甲案的形状（改的是哪些字） ／ 4. 本棒踩的坑（写下来免得下一任再踩） ／ 5.  已登记、本棒没做（明确不是待办） ／ 6 |
| 交接 leg93（2026-09-20） | `docs/session-handoff-2026-09-20-leg93d.md:1` | 0.1 「问问题」≠「授权改码」 ／ 1. 这一棒做了什么（一张表看完） ／ 5.  已登记、本棒没做（明确不是待办） ／ 6. 本棒踩的坑（写下来免得下一任再踩） ／ 7.  只有人能跑的真机验收（下一任用） |
| 交接 leg94（2026-09-20） | `docs/session-handoff-2026-09-20-leg94.md:1` | 交接 · 第九十四棒（leg94） ／ 1. 这一棒做了什么（一张表看完） ／ 2. 三处实机病 + 一处撤除（都是呈现层） ／ 2.2 大事纪两处纯 bug ／ 2.3 编年账目行里的号  人话 ／ 3.  「说书」视 |
| 交接 leg100（2026-09-21） | `docs/session-handoff-2026-09-21-leg100.md:1` | 0.1 病（用户在实机看到的原文） ／ 0.4  顺手核清的两件事（不猜，读代码） ／ 1.  修法与它的边界 ／ 3.1  本笔踩的两脚（都如实留档） ／ 5.  本笔登记但没动的两处（下一任先看这里） ／ 6.  本 |
| 交接 leg102（2026-09-21） | `docs/session-handoff-2026-09-21-leg102.md:1` | 1.1 链路（每一环都指得出出处） ／ 1.2  为什么"能装"是运气好，而不是理所当然 ／ 1.3 本棒实测（14 项，全绿） ／ 4.1 用户点名的两条（机理已核准） ／ 4.3  分层建议（别把 13 条一次倒给读 |
| 交接 leg103（2026-09-21） | `docs/session-handoff-2026-09-21-leg103.md:1` | 1.1 三版怎么来的 ／ 2.1 分档口径（下一任照用） ／ 2.4 还没动的（按我给的优先级排，§5 详列） ／ 5.4  第四优先：剩下的 A/B/C 零散项 ／ 5.5  三条"登记但早先拍板过"的（别推翻） ／  |
| 交接 leg106（2026-09-21） | `docs/session-handoff-2026-09-21-leg106.md:1` | 1.1 实测出来的五处失效（都不是假想） ／ 1.2 治法：不修正过去，只标注过去 ／ 3.  两处玩家看得见的假话（本棒顺手改正） ／ 4.  两处卫生 ／ 5.  本棒踩的坑（下一任照做，能省一整轮） ／ 6.  发 |
| 交接 leg95（2026-09-21） | `docs/session-handoff-2026-09-21-leg95.md:1` | 交接 · 第九十五棒（leg95） ／ 1. 这一棒做了什么（一张表看完） ／ 2. 引擎与契约（本棒主菜） ／ 2.2  闭环第四型：模型判"这一段讲完了" ／ 2.3 契约面（三处，缺一处就哑） ／ 2.4 提示词第 |
| 交接 leg95（2026-09-21） | `docs/session-handoff-2026-09-21-leg95d.md:1` | 1. 全页状态词统一（这一笔的第二个实质改动） ／ 3. 验收 ／ 4. 已登记、本笔没做 ／ 5.  下一任的正事 |
| 交接 leg96（2026-09-21） | `docs/session-handoff-2026-09-21-leg96.md:1` | 交接 · 第九十六棒（leg96 · 接手棒） ／ 1. 本棒做了什么 ／ 1.3 升位（只升一个号） ／ 1.4 判据（+1 条，三条断言） ／ 3.  已登记、本棒没做 ／ 4.  下一任的正事（按本棒的建议排序）  |
| 交接 leg96（2026-09-21） | `docs/session-handoff-2026-09-21-leg96e-design.md:1` | 1.1  面的立与不立（真账标定的判据） ／ 1.2  桥（面↔面）：账上现成的，一根不用编 ／ 2. 用户两个追问的答复（都验过真账，不是推理） ／ 2.3 顺带查清的一件事：浪尖 不能当中介层 ／ 3.  演示页（本 |
| 交接 leg97（2026-09-21） | `docs/session-handoff-2026-09-21-leg97.md:1` | 0.  一句话：这一棒把「面」从演示页搬进了产品 ／ 1.  落地在哪（四个文件，模块图一个字符没动） ／ 2.  三条口径（判据钉着，别再自己发明） ／ 2.1 落脚处：每条线恰好一处（核算平的根据） ／ 7.  真账 |
| 交接 leg98（2026-09-21） | `docs/session-handoff-2026-09-21-leg98.md:1` | 3.  修三：面头分开报「落脚／路过」（判据⑫） ／ 4.  判据与反向自证 ／ 6.  已登记、本棒没做（照旧，不是待办） ／ 10.  只有人能跑的真机验收（下一任用） |
| 交接 leg99（2026-09-21） | `docs/session-handoff-2026-09-21-leg99.md:1` | 2.  修法与它的边界（判据锁着） ／ 2.1  玩家看得见的那一笔：83  76 ／ 4.  反向自证 6/6 全部当场红（两组装置） ／ 6.1 同族解析器还有 四份复本（两族） ／ 7.  本棒踩的坑（下一任照做） |
| 交接 leg107（2026-09-22） | `docs/session-handoff-2026-09-22-leg107.md:1` | 1.  病与治法 ／ 1.1 病：那张手写名单（逐行取证，不是推演） ／ 1.2 治法一：照单全收（本棒唯一的语义改动） ／ 3.  发布面读数漂移勘正（本棒接手时咬出来的） ／ 4.  本棒踩的坑（下一任照做，能省一整 |
| 交接 leg108（2026-09-22） | `docs/session-handoff-2026-09-22-leg108.md:1` | 1. 病与治法 ／ 1.1  判据读数的漂移，与守门缺的那条腿 ／ 1.5  快照页标出"盘上现在这份"（B6） ／ 1.6  一处判据打架（本棒最该带走的一课） ／ 2. 本棒的判据 ／ 4.  本棒踩的坑（下一任照做 |
| 交接 leg109（2026-09-22） | `docs/session-handoff-2026-09-22-leg109.md:1` | 1. 病与治法 ／ 1.5  本笔不做（免得越界） ／ 3.  本棒踩的坑（下一任照做，能省一整轮） ／ 5.  留给下一任 |
| 交接 leg109（2026-09-22） | `docs/session-handoff-2026-09-22-leg109b-defects.md:1` | 0.  一句话 ／ 1. 用户点的四条（逐条核过） ／ 1.1 四条都成立，各带证据 ／ 1.3 用户已拍板的两件（都还没动手） ／ 2. 我另补的 13 条（每条都核过，带证据） ／ 2.1 闭环断口 ／ 2.2 该看 |
| 交接 leg110（2026-09-22） | `docs/session-handoff-2026-09-22-leg110-111.md:1` | 0. 一句话 ／ 1.1 病（两处叠在一起） ／ 1.2 影响面（先量再动） ／ 1.4 两处自证 ／ 1.5 本笔自己踩的三个坑（留档，都值得记） ／ 1.6 旧账自愈（不用跑迁移脚本） ／ 2. leg111：归档事 |
| 交接 leg112（2026-09-22） | `docs/session-handoff-2026-09-22-leg112.md:1` | 0. 一句话 ／ 1. C1 换书检测：它治什么、怎么做的 ／ 1.1 病（你上一场问过的那件事） ／ 1.3 口径（三条，别越界） ／ 1.4 它照出来的那件事（你要知道） ／ 2. D1 撤掉「每轮改字段 ≤3」：先 |
| 交接 leg113（2026-09-22） | `docs/session-handoff-2026-09-22-leg113.md:1` | 0. 一句话 ／ 1. 病：世界模型每轮失忆 ／ 1.1 人话版 ／ 1.2 用户早就拍过这条口径（leg34） ／ 1.3 实测（用户真账 · 只读副本） ／ 2. 治法（只做加法，四层） ／ 2.1 口径：收哪些、弃 |
| 交接 leg114（2026-09-22） | `docs/session-handoff-2026-09-22-leg114.md:1` | 0. 一句话 ／ 1. 病：那个读数是个"永远刚好"的数 ／ 1.1 人话版 ／ 1.2 但细案漏了一格（这是本笔最值钱的发现） ／ 2. 治法（只做加法，四层 + 契约层） ／ 2.3 不设条数上限、也不新增任何"提案 |
| 交接 leg115（2026-09-23） | `docs/session-handoff-2026-09-23-leg115.md:1` | 0. 一句话 ／ 1. 病：账上"没有时间"这回事 ／ 1.1 人话版 ／ 2.5 "死抽屉"这一次真的堵上了（本仓的老病） ／ 2.1 为什么"不做算术"是这一笔的命门 ／ 2.2 "六种方式"不是装饰（用户就问了这一 |
| 交接 leg116（2026-09-23） | `docs/session-handoff-2026-09-23-leg116.md:1` | 0. 一句话 ／ 1. 病：排序在"卡预算"的时候就是决定性的 ／ 1.1 人话版 ／ 1.3 为什么这不是"风格问题" ／ 2. 治法（三条，都不改口径只改次序与接口） ／ 5. 读数 ／ 6. 留给下一任 |
| 交接 leg117（2026-09-23） | `docs/session-handoff-2026-09-23-leg117.md:1` | 0. 一句话 ／ 2. 病：来路断在"大事纪"门口（本笔的要害） ／ 2.1 病在哪（实读代码） ／ 2.2 但归档那件事没丢（这是本笔能修的前提） ／ 3.3 一个只有跑判据才会发现的低级坑 ／ 4. 读数 ／ 5.  |
| 交接 leg118（2026-09-23） | `docs/session-handoff-2026-09-23-leg118.md:1` | 0. 一句话 ／ 1. 病：同一件往事，两条各写一套的取数路 ／ 2. 治法（全是"换个地方要"，不是新机制） ／ 3. 读数（"零行为变化"是怎么证明的） ／ 4. 本笔踩的坑（都值得记） ／ 4.2 新判据第一次就是 |
| 交接 leg119（2026-09-23） | `docs/session-handoff-2026-09-23-leg119.md:1` | 0. 一句话 ／ 2. 治法（全是"换个地方要"，不是新机制） ／ 4. 本笔踩的坑（这三条最值钱） ／ 4.3 我为一桩收尾来回问，被用户顶回来 ／ 5. 留给下一任 ／ 5.3 一条还没拍的数字（本笔一个数没动） ／ |
| 交接 leg120（2026-09-23） | `docs/session-handoff-2026-09-23-leg120.md:1` | 0. 一句话 ／ 1. 病（实测，不是推测） ／ 2.4 额度：用户拍板「不限」（这一条有来历） ／ 3. 读数（"真修好了"是怎么证明的） ／ 4. 本笔踩的坑（四条，都留档） ／ 5. 留给下一任 ／ 5.1 本笔还 |
| 交接 leg121（2026-09-23） | `docs/session-handoff-2026-09-23-leg121.md:1` | 0. 一句话 ／ 1. 病：实测抓到的，不是推演 ／ 1.2 起点一致，之后分叉 ／ 1.3  病是真的：真账最后一轮重掷一次就抓到了 ／ 2.3  三条口径（缺一条这个设计就是错的） ／ 3. 读数（"真修好了"是怎么 |
| 交接 leg122（2026-09-24） | `docs/session-handoff-2026-09-24-leg122.md:1` | 0. 一句话 ／ 1.3 本笔的判据是反向锁（不是删判据） ／ 1.4  如实登记：拆掉之后的后果 ／ 2.1 它是什么 ／ 2.3  三条必须报给你的现场事实 ／ 2.4 怎么用（照它自己 README 的说法） ／  |
| 交接 leg123（2026-09-24） | `docs/session-handoff-2026-09-24-leg123.md:1` | 0. 一句话 ／ 2. 落地五处（写账权仍在引擎手里） ／ 3. 判据与读数 ／ 6. 留给下一任（都不立项，等你拍板） ／ 7. 别做的事 |
| 交接 leg124（2026-09-24） | `docs/session-handoff-2026-09-24-leg124-knowledge-index.md:1` | 0. 一句话 ／ 2. 交付三件 ／ 2.3 顺手治的三处既有问题 ／ 5. 如实登记：搜索的已知短板 ／ 6. 本棒没做的（下一任最该先看这一段） ／ 7. 别做的事 ／ 8. 怎么复量 ／ 全量判据（无参，必须在插件 |
| 交接 leg125（2026-09-25） | `docs/session-handoff-2026-09-25-leg125-drop-memory-link.md:1` | 0. 一句话 ／ 1. 用户原话（逐字，这一节比任何细案都准） ／ 2. 交付三件 ／ 2.2 B8：状态条改说人话（一句「已保存」） ／ 3. 判据与读数的净变化 ／ 4. 本棒踩的坑（三个，都留档） ／ 5. 如实登 |
| 交接 leg126（2026-09-25） | `docs/session-handoff-2026-09-25-leg126-volume-summary-spec.md:1` | 0. 一句话 ／ 1. 用户原话（逐字，这一节比任何细案都准） ／ 2. 交付两件（都是文档） ／ 3. 这一棒真正值钱的三条（接手的人先看这一节） ／ 3.1 "证据要分等级"——本笔最值钱的一条 ／ 4. 本棒踩的坑 |
| 交接 leg127（2026-09-25） | `docs/session-handoff-2026-09-25-leg127-line-curve.md:1` | 0. 一句话 ／ 1. 用户原话（逐字，这一节比任何细案都准） ／ 2. 交付 ／ 2.3 三处"砍掉"的落点 ／ 3. 这一棒真正值钱的四条（接手的人先看这一节） ／ 3.2  四条实测发现 ／ 4. 本棒踩的坑（四个 |
| 交接 leg128（2026-09-25） | `docs/session-handoff-2026-09-25-leg128-context-chain.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 3.  这一笔唯一那个结构决定：多因点住在哪 ／ 4. 两个真问题、两处已修 ／ 5. 如实登记（本笔的短板与没做的） ／ 6. 本笔没做的（下一任最该先看这一段） ／ 7. |
| 交接 leg129（2026-09-25） | `docs/session-handoff-2026-09-25-leg129-longrun-fixes.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付（四个病 ＋ 第五个；每处都有判据） ／ 3. 那一跑的读数（硬数） ／ 7. 别做的事 ／ 8. 怎么复量 |
| 交接 leg130（2026-09-25） | `docs/session-handoff-2026-09-25-leg130-coverage-and-fixes.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 3. 那一轮体检的读数（硬数） ／ 4. 覆盖到哪（这一节比 §3 更要紧） ／ 5. 如实登记（读上面那些数之前先读这段） ／ 6. 下一笔怎么干 ／ 7. 别做的事 ／  |
| 交接 leg131（2026-09-25） | `docs/session-handoff-2026-09-25-leg131-design-audit.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：两份判断（这一节是本笔的全部价值） ／ 2.3 缺点清单（甲乙丙丁四类 · 逐条带出处） ／ 3. 硬读数：哪些是我亲手验的，哪些是读来的 ／ 3.1 本笔动过的 |
| 交接 leg132（2026-09-25） | `docs/session-handoff-2026-09-25-leg132-related-recall.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2.1 那一栏是什么 ／ 3. 硬读数：哪些是亲手验的 ／ 5. 下一笔怎么干（待用户点头，不是命令） ／ 6. 别做的事 ／ 7. 怎么复量 |
| 交接 leg133（2026-09-25） | `docs/session-handoff-2026-09-25-leg133-recent-window.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2.1 三条口径（一条都不许松） ／ 2.2 改动面 ／ 3. 硬读数：哪些是亲手验的 ／ 5. 下一笔怎么干（待用户点头，不是命令） ／ 6. 别做的事 ／ 7. 怎么复量 |
| 交接 leg134（2026-09-25） | `docs/session-handoff-2026-09-25-leg134-deadcode-purge.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：删了什么、留了什么 ／ 2.1 筛的时候只认三类（缺一条就不算垃圾） ／ 2.2 删掉的（分四路并行做的） ／ 3. 硬读数：哪些是亲手验的 ／ 4. 如实登记（ |
| 交接 leg135（2026-09-25） | `docs/session-handoff-2026-09-25-leg135-fullpack-budget.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：改了什么 ／ 2.3 连带账（都是实测逼出来的，不是顺手改） ／ 2.6 文档 ／ 3. 硬读数：哪些是亲手验的 ／ 4. 如实登记（这一节比改动本身要紧） ／  |
| 交接 leg136（2026-09-26） | `docs/session-handoff-2026-09-26-leg136-fewer-gates.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：改了什么 ／ 2.3 丙 · 三处假话（不是拆闸，是改错话） ／ 2.5 连带：判据夹具重造 ＋ 三个号 ／ 3. 硬读数：哪些是亲手验的 ／ 4. 如实登记（这 |
| 交接 leg137（2026-09-27） | `docs/session-handoff-2026-09-27-leg137-event-time.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：改了什么 ／ 2.1 定稿的形状（一句话） ／ 2.4 逐文件 ／ 3. 硬读数：哪些是亲手验的 ／ 4.  如实登记（这一节比改动本身要紧） ／ 4.3  真机 |
| 交接 leg138（2026-09-27） | `docs/session-handoff-2026-09-27-leg138-book-door-and-snapshot.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔是什么 ／ 3. 硬读数：哪些是亲手验的 ／ 4.  查出的问题（本笔的主体 · 逐条） ／ 4.3  P3：起根那三道闸，一道都没拦住它 ／ 4.8 遗留（ |
| 交接 leg139（2026-09-27） | `docs/session-handoff-2026-09-27-leg139-model-channel-snapshot-gates.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 4.1 上一次干活那条结论为什么不成立 ／ 4.2 真通道（三条链，逐条读码 ＋ 真账对账） ／  |
| 交接 leg140（2026-09-27） | `docs/session-handoff-2026-09-27-leg140-entity-window.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 4.1 症状与根因 ／ 4.3  第二值钱的：展示页偏偏是对的 ／ 4.4 排查过程（如实记，含一 |
| 交接 leg141（2026-09-27） | `docs/session-handoff-2026-09-27-leg141-book-relations.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 4.1 我第一版给的是什么、他问了什么 ／ 4.2 定稿口径（三条，判据钉着） ／ 6. 做法与判 |
| 交接 leg142（2026-09-27） | `docs/session-handoff-2026-09-27-leg142-model-picker.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 7.  下一任做什么（活儿单） ／ 8. 别做的事 ／ 9. 本笔没做到的（别把没做的当做了） |
| 交接 leg143（2026-09-27） | `docs/session-handoff-2026-09-27-leg143-params-regroup.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 4.  本笔最值钱的三条 ／ ② 分组口径必须落在真源，不许渲染层自己再判一遍 ／ 5.  我栽的 |
| 交接 leg144（2026-09-27） | `docs/session-handoff-2026-09-27-leg144-parallel-extract.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 4.  本笔最值钱的四条 ／ ② "按原下标收回"不是洁癖，是质量 ／ ③ 书指纹缓存"从没接线" |
| 交接 leg145（2026-09-28） | `docs/session-handoff-2026-09-28-leg145-mobile.md:1` | 0. 一句话 ／ 1. 用户原话（逐字） ／ 2. 交付：本笔改了什么（逐文件） ／ 3. 硬读数（哪些是亲手验的） ／ 4.  本笔最值钱的三条 ／ 5.  我栽的三跤（如实登记） ／ 跤一：装置骗了我一次——四张截图 |

### 细案（25）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 细案 b2-chronicle-via-recall | `docs/spec-b2-chronicle-via-recall.md:1` | 细案 · B2 接检索层——那一栏往事，不再自己伸手抓 |
| 细案 chat-ledger-conflict | `docs/spec-chat-ledger-conflict.md:1` | 细案 · 把"账上跟书不一样的地方"递进对话（治聊天模型写冲突）——只写设计，不碰产品代码 |
| 细案 chronicle-in-pack | `docs/spec-chronicle-in-pack.md:1` | 细案 · 编年进包（B2）——让世界模型"记得自己的过去" |
| 细案 chronicle-page-ia | `docs/spec-chronicle-page-ia.md:1` | 细案 · 「编年」页信息架构改版（leg50 · 分层上桌 + 工具层） |
| 细案 context-master | `docs/spec-context-master.md:1` | 设计总稿 · 上下文：模型每一轮看到什么（账 · 卷 · 树 · 线 · 包） |
| 细案 entities-page-ia | `docs/spec-entities-page-ia.md:1` | 细案 ·「角色与势力」页信息架构改版（发布前 UX 第一刀） |
| 细案 entity-field-lookup | `docs/spec-entity-field-lookup.md:1` | 细案 · 按需查书补字段（实力/位置）+ 两条 ≤15 上限（已批准 · 已落地 · 2026-09-11 · 第二十五棒） |
| 细案 entity-section-encoding | `docs/spec-entity-section-encoding.md:1` | 细案 · 实体段表达法收改（pack 文本改成行式表格） |
| 细案 faction-member-title-prefix | `docs/spec-faction-member-title-prefix.md:1` | 细案 · 势力成员挂不上：头衔式成员名解析（leg25 g · 已改判：本细案搁置） |
| 细案 failure-verdict-and-visibility | `docs/spec-failure-verdict-and-visibility.md:1` | 细案 · 盘算满步终局 + 可见性 + 位置缺失口径（X1 / X3 / X2 / X4） |
| 细案 long-memory-theory | `docs/spec-long-memory-theory.md:1` | 细案 · 长期记忆的理论骨架（树的形状 · 纪的三级 · 卷纪正交） |
| 细案 lookup-batch-refresh | `docs/spec-lookup-batch-refresh.md:1` | 细案 · 查书补全三件套（批量补全 / 单实体重查 / 选人可见） |
| 细案 novelist-clause | `docs/spec-novelist-clause.md:1` | 细案 · 小说家条款（给 LLM 创作权）与实体字段写回 |
| 细案 pack-budget-knob | `docs/spec-pack-budget-knob.md:1` | 细案 · 包预算旋钮——让"看多少"跟着模型能力走 |
| 细案 parent-affiliation | `docs/spec-parent-affiliation.md:1` | 细案 · 势力↔角色关联（`parent`）回填 · 已实施（2026-09-11 第二十五棒 e） |
| 细案 prose-into-ledger | `docs/spec-prose-into-ledger.md:1` | 细案 · 把正文接进账本（治"你在戏里做的事，账上一个字都不知道"） |
| 细案 relationship-network | `docs/spec-relationship-network.md:1` | 细案 · 关系网（A3）——只写设计，不碰产品代码 |
| 细案 retrieval-layer-interface | `docs/spec-retrieval-layer-interface.md:1` | 细案 · 检索层接口——只写接口与纪律，不实现检索 |
| 细案 snapshot-fault-tolerance | `docs/spec-snapshot-fault-tolerance.md:1` | 细案 · 快照容错系统（每步可回滚）· 第二十七棒后 · 2026-09-11 |
| 细案 tag-granularity | `docs/spec-tag-granularity.md:1` | 细案 · 标签颗粒度对齐（把"你这轮做了什么"接进账）——只写设计，不碰产品代码 |
| 细案 tagged-actions-extraction | `docs/spec-tagged-actions-extraction.md:1` | 设计 · 带标签正文 → 正则提取 → 喂世界模型（`spec-tagged-actions-extraction`） |
| 细案 volume-summary | `docs/spec-volume-summary.md:1` | 细案 · 卷摘要（E1 剩下的那一半）——已摒弃（2026-09-25），留档不实施 |
| 细案 volumes-into-recall | `docs/spec-volumes-into-recall.md:1` | 细案 · 旧卷进检索层（B3/E1 剩下的那一层）——只写设计，不碰产品代码 |
| 细案 world-model-widening | `docs/spec-world-model-widening.md:1` | 细案 · 世界模型层变宽（leg33 · 承接 leg32 §1 的"单焦点塌缩"） |
| 细案 world-widening | `docs/spec-world-widening.md:1` | 细案 · 让世界变宽（静默门是单向门） |

### 索引（2）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| docs/superpowers/specs/（4 份旧档） | `docs/superpowers/specs:1` | 旧档目录（历史，不是现状）；逐份细节在那里，现状一律看 STATE.md §1 |
| docs/handoffs/（34 份旧档） | `docs/handoffs:1` | 旧档目录（历史，不是现状）；逐份细节在那里，现状一律看 STATE.md §1 |

### 知识库（11）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 知识库 00-index · 总目录与问题路由 | `kb/00-index.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 01-overview · 概览与理念 | `kb/01-overview.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 02-architecture · 架构与数据流 | `kb/02-architecture.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 03-ledger-ssot · 世界账（SSOT）模型 | `kb/03-ledger-ssot.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 04-source-map · 源码地图（src/） | `kb/04-source-map.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 05-web-panel · 面板与注入（web/） | `kb/05-web-panel.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 06-parameters · 世界参数与旋钮 | `kb/06-parameters.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 07-decisions · 决策与红线 | `kb/07-decisions.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 08-testing-tooling · 测试与工具链 | `kb/08-testing-tooling.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库 09-glossary · 术语表 | `kb/09-glossary.md:1` | （★快照：冲突时以代码为准；当前值只看 STATE.md §1） |
| 知识库机器可读索引（kb-index.json） | `kb/kb-index.json:1` | 文件 / 符号 / 术语 / 决策 / 红线 / 流水线阶段（★快照，会过期） |

### 当前值（17）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 当前值 · 判据 | `STATE.md:47` | **1390 / 1390 · fail 0 · skipped 0 · todo 0**（★leg145b 加 **+6**；逐棒增减 ⇒ `docs/done-archive.md`） ｜ 复量：`node --te |
| 当前值 · 冒烟 | `STATE.md:48` | **PASS · 终态 SSOT 8351 字节 · 警告 0** ｜ 复量：`node demo/smoke-demo.js` |
| 当前值 · PANEL_BUILD | `STATE.md:49` | **`leg145b-own-errors`** ｜ 复量：`src/render-base.js`（★leg145b 升：**异常分流**——只有自家的错进状态条） |
| 当前值 · ★手机端 | `STATE.md:50` | **面板在手机上能用**：页签**一行横滑**（44px）· 窄屏**单列** · 点击目标 **44/36/32px** · 输入类 **16px** · 遮罩留边 **6px** ＋ 视口高 **`100dvh`** |
| 当前值 · ★抽取并发度 | `STATE.md:51` | **缺省 2 路**。★**它是设置项**：设置页「模型通道」→「同时问几块」（**只设下限不设上限**，用户 2026-09-27 裁「数自己填不设上限」）；`EXTRACT_CONCURRENCY` 只是**没填过的 |
| 当前值 · 包预算 出厂值 | `STATE.md:52` | **50000**（leg135 抬的：用户令「我预算抬到50000token」） ｜ 复量：`src/limits.js`（旋钮，面板可改；档位 30000/50000/60000） |
| 当前值 · ★leg136 拆掉的闸 | `STATE.md:53` | **出包期五道条数闸** → `Infinity` · **镜头暗闸**（撤，改跟 `包预算` 走并留痕）· **聊天侧落账两道配额** ⇒ 出包期**只剩整包预算一条尺** ｜ 复量：`src/pack.js` · ` |
| 当前值 · ★leg137 时间那条链 | `STATE.md:54` | **① 解析器**两级尝试（真机 **0 条**，留作保险）。**② 时间**：`newEvents[]` 多一格 **`at`** ＋ 包里多**「时间」一栏** ＋ `纪事`/`相关往事` 带 `timeMark`； |
| 当前值 · ★leg141/141b：窗口 ＋ 关系网 | `STATE.md:55` | 窗口 **984px** · 事迹拆两格 · ★★★**初始化第一次把书里明写的关系种进账**（`ssot.relations` **24 条**，**24/24 反查书有据**）· **麾下**（最多 **12 人** |
| 当前值 · ★leg139：通道 ＋ 回档 ＋ 两道闸 | `STATE.md:56` | **模型调用走 `XMLHttpRequest`**（页面 `fetch` 可能被别的扩展换掉）· **回档**：`requestSnapshot` 曾把"锚点世界"记成"当前世界"（已修）· **两道机械闸**：起根" |
| 当前值 · CSS_VERSION | `STATE.md:57` | **`20260927-leg145-mobile`** ｜ 复量：`web/index.js`（`CSS_VERSION`；拼进地址那一步在 `web/status-bar.js`） |
| 当前值 · MAIN_PROMPT_V | `STATE.md:58` | **`v2-agenda-t1-30`** ｜ 复量：`src/prompts.js`（★leg137：第 9 条补"时间那一栏怎么读 ＋ 每件事各自写 at"） |
| 当前值 · web/index.js 行数 | `STATE.md:59` | **3082 / 3100**（硬锁 `<3100`，`test/web-view-state-layout.test.js:339`；★leg145b **−4**——异常钩子搬去 `status-bar.js`） ｜ |
| 当前值 · 发布仓 main | `STATE.md:60` | **`2a86cfa`** · 构建号 **`leg145-mobile`**（leg129–145 一次补齐；★记账提交会再压一笔在上面） ｜ 复量：`node scripts/verify-release.mjs` |
| 当前值 · release tag | `STATE.md:61` | **`v1.0.0-preview.2` → `2a86cfa`（leg145）** · 旧 `preview.1`→`1a54424` 不动 ｜ 复量：★点 release 下载的人现在拿到 leg145（§3-A） |
| 当前值 · 发布点读数的语义（leg124 立） | `STATE.md:62` | **"已发布到哪一版"只有本行是人核过的真值**；`docs/index.json` 分 `sourceBuild`（现读）/ `published`（人核过的常数，改它＝一次发布）。全文 ⇒ `scripts/audi |
| 当前值 · 版本号 | `STATE.md:63` | `manifest.json` = `web/index.js` 的 `VERSION` = **`1.0.0`**（两处，判据锁着第二处） ｜ 复量：`test/browser-compat.test.js` |

### 怎么跑（2）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| 怎么验证（三条命令，都在插件目录内跑） | `STATE.md:47` | node --test（全量判据，无参）· node demo/smoke-demo.js（50 轮冒烟）· node scripts/audit-docs.mjs（文档守门） |
| 怎么发布（导出独立根树 → 仓外跑判据冒烟 → 推 → 远端逐字节核） | `scripts/publish-release.mjs:1` | node scripts/publish-release.mjs（推）· node scripts/verify-release.mjs（远端只读终检） |

### 代码地图（66）

| 卡片 | 在哪 | 是什么 |
|---|---|---|
| src/abstract-shape.js | `src/abstract-shape.js:1` | story-world-v2/src/abstract-shape.js |
| src/abstract-tier.js | `src/abstract-tier.js:1` | story-world-v2/src/abstract-tier.js |
| src/abstract.js | `src/abstract.js:1` | story-world-v2/src/abstract.js |
| src/async-tick.js | `src/async-tick.js:1` | story-world-v2/src/async-tick.js |
| src/book-check.js | `src/book-check.js:1` | story-world-v2/src/book-check.js |
| src/chain.js | `src/chain.js:1` | story-world-v2/src/chain.js |
| src/check-step.js | `src/check-step.js:1` | story-world-v2/src/check-step.js |
| src/chronicle-brief.js | `src/chronicle-brief.js:1` | story-world-v2/src/chronicle-brief.js |
| src/entity-lookup.js | `src/entity-lookup.js:1` | story-world-v2/src/entity-lookup.js |
| src/entropy.js | `src/entropy.js:1` | story-world-v2/src/entropy.js |
| src/extract.js | `src/extract.js:1` | story-world-v2/src/extract.js |
| src/fingerprint.js | `src/fingerprint.js:1` | story-world-v2/src/fingerprint.js |
| src/gate.js | `src/gate.js:1` | story-world-v2/src/gate.js |
| src/init-source.js | `src/init-source.js:1` | story-world-v2/src/init-source.js |
| src/ledger-recall.js | `src/ledger-recall.js:1` | story-world-v2/src/ledger-recall.js |
| src/limits.js | `src/limits.js:1` | leg40b 续：尺度上限的唯一真源 + 可调档位（用户令：「能不能直接把这些闸门参数直接放进参数页？」→ 拍板"甲+乙档全开"）。 |
| src/lines.js | `src/lines.js:1` | story-world-v2/src/lines.js |
| src/observatory.js | `src/observatory.js:1` | story-world-v2/src/observatory.js |
| src/pack.js | `src/pack.js:1` | story-world-v2/src/pack.js |
| src/panorama.js | `src/panorama.js:1` | story-world-v2/src/panorama.js |
| src/parallel-run.js | `src/parallel-run.js:1` | story-world-v2/src/parallel-run.js |
| src/param-hub.js | `src/param-hub.js:1` | story-world-v2/src/param-hub.js |
| src/param-store.js | `src/param-store.js:1` | story-world-v2/src/param-store.js |
| src/params.js | `src/params.js:1` | story-world-v2/src/params.js |
| src/position.js | `src/position.js:1` | story-world-v2/src/position.js |
| src/prompts.js | `src/prompts.js:1` | story-world-v2/src/prompts.js |
| src/ref-rules.js | `src/ref-rules.js:1` | story-world-v2/src/ref-rules.js |
| src/render-base.js | `src/render-base.js:1` | story-world-v2/src/render-base.js |
| src/render.js | `src/render.js:1` | story-world-v2/src/render.js |
| src/sanitize-step.js | `src/sanitize-step.js:1` | story-world-v2/src/sanitize-step.js |
| src/schema.js | `src/schema.js:1` | story-world-v2/src/schema.js |
| src/seed-roots.js | `src/seed-roots.js:1` | story-world-v2/src/seed-roots.js |
| src/setting.js | `src/setting.js:1` | story-world-v2/src/setting.js |
| src/settle.js | `src/settle.js:1` | story-world-v2/src/settle.js |
| src/smoke.js | `src/smoke.js:1` | story-world-v2/src/smoke.js |
| src/snapshot.js | `src/snapshot.js:1` | story-world-v2/src/snapshot.js |
| src/st-preset.js | `src/st-preset.js:1` | story-world-v2/src/st-preset.js |
| src/storage.js | `src/storage.js:1` | story-world-v2/src/storage.js |
| src/streams.js | `src/streams.js:1` | story-world-v2/src/streams.js |
| src/tag-extract.js | `src/tag-extract.js:1` | story-world-v2/src/tag-extract.js |
| src/tick.js | `src/tick.js:1` | story-world-v2/src/tick.js |
| src/transport-config.js | `src/transport-config.js:1` | story-world-v2/src/transport-config.js |
| src/transport-http.js | `src/transport-http.js:1` | story-world-v2/src/transport-http.js |
| src/undo-stack.js | `src/undo-stack.js:1` | story-world-v2/src/undo-stack.js |
| src/unrest.js | `src/unrest.js:1` | story-world-v2/src/unrest.js |
| src/weight.js | `src/weight.js:1` | story-world-v2/src/weight.js |
| src/worldstep.js | `src/worldstep.js:1` | story-world-v2/src/worldstep.js |
| web/action-router.js | `web/action-router.js:1` | story-world-v2/web/action-router.js |
| web/book-rebaseline.js | `web/book-rebaseline.js:1` | story-world-v2/web/book-rebaseline.js |
| web/book-source.js | `web/book-source.js:1` | story-world-v2/web/book-source.js |
| web/entity-window.js | `web/entity-window.js:1` | story-world-v2/web/entity-window.js |
| web/hot-ledger.js | `web/hot-ledger.js:1` | story-world-v2/web/hot-ledger.js |
| web/idb-backend.js | `web/idb-backend.js:1` | story-world-v2/web/idb-backend.js |
| web/index.js | `web/index.js:1` | story-world-v2/web/index.js |
| web/inject.js | `web/inject.js:1` | story-world-v2/web/inject.js |
| web/long-task.js | `web/long-task.js:1` | story-world-v2/web/long-task.js |
| web/model-channel.js | `web/model-channel.js:1` | story-world-v2/web/model-channel.js |
| web/page-compose.js | `web/page-compose.js:1` | story-world-v2/web/page-compose.js |
| web/param-panel.js | `web/param-panel.js:1` | story-world-v2/web/param-panel.js |
| web/scroll-keep.js | `web/scroll-keep.js:1` | story-world-v2/web/scroll-keep.js |
| web/snapshot-store.js | `web/snapshot-store.js:1` | story-world-v2/web/snapshot-store.js |
| web/status-bar.js | `web/status-bar.js:1` | story-world-v2/web/status-bar.js |
| web/view-state.js | `web/view-state.js:1` | story-world-v2/web/view-state.js |
| web/volume-popup.js | `web/volume-popup.js:1` | story-world-v2/web/volume-popup.js |
| web/world-replace.js | `web/world-replace.js:1` | story-world-v2/web/world-replace.js |
| 判据在哪（test/ 共 116 个 *.test.js） | `test:1` | 全量跑 node --test（无参，必须在插件目录内）；按子系统分组见 kb/08-testing-tooling.md |

## 最近提交（接手时判"现在到哪一棒了"）

- `de74e41 story-world-v2 发布：另打 tag `v1.0.0-preview.2` ＋ 建新 release（面板 leg145-mobile）`
- `8005fac story-world-v2 发布记账：把"当前发布点"更新到 leg145-mobile（`15cd9e5`）`
- `e9bddca story-world-v2 发布流程修复：打通"导出件里跑守门"那两处（知识索引指纹不再含 kb/ ＋ 生成物不再现读 git）`
- `ecb38db story-world-v2 leg129–leg145：长期记忆与检索收口 → 面板七页重排 → 抽取并发 → 手机端适配（17 棒一次提交）`
- `faad1f5 story-world-v2 leg128：把上下文那条链打通（含多因点）＋ 修掉逐行量包那个性能病`
- `852aa5b story-world-v2 leg128：上下文设计总稿（散稿整合成一份 · 「一条线在包里长什么样」定案 · 砍掉四件没用的设计）`
- `d8590a2 story-world-v2 leg127：交接（§8 那条曲线 N=5 ＋ 砍掉"卷摘要"那件过剩设计 ＋ 四条实测发现 ＋ 全仓 25 处日期勘误 09-26→09-25）`
- `48a5459 story-world-v2 leg127：摒弃 E1 卷摘要（≈250:1 的图注 · 与原文同形状 · 进不了包）+ 定"摘要只长在纪上" + 批次表与活儿清单同步`
- `cdc68c2 story-world-v2 leg127：量出 §8 那条曲线（干净合成世界 900 轮 × 三档起根密度 · N=5 已拍）+ 四条实测发现 + 卷摘要细案与理论对齐 + 登记两件新活儿`
- `12e896e story-world-v2 leg126：E1 卷摘要细案（待拍板）+ 长期记忆理论骨架（单亲森林·合流事件·纪的三级·卷纪正交）+ 立"证据分等级"的规矩（用户令：先进行理论分析）`
- `d763a6c story-world-v2 leg125：交接（删掉'投给柚月の记忆'那条过剩通道 + 状态条改说人话 + 批次表三格误判勘正 + 卷摘要留给下一任）`
- `4c78625 story-world-v2 leg125：删掉'投给柚月の记忆'那条过剩通道（用户令：解耦就解耦，直接删了）+ 状态条改说人话（B8：只说'已保存'）+ 现读代码勘正批次表 C4/E2/E3 三格误判`


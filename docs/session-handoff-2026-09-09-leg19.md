# 会话交接 · story-world v2 · 第十九棒（2026-09-09 · 悬案破案 · 全量棋盘+每轮镜头细案拍板与实施 · 377/377）

> ⚠️ **本文件是 story-world v2 的第十九份交接入口。接手前必读（按序）**：①`ANCHOR.md`（唯一尺子，状态行指下一阶段；第十九棒决策记录已回填）②`docs/dev-process.md`（执行手册；§6 队列已登记"项目知识库"待办）③本文件 ④`docs/ledger.md`（工程台账，本棒 L132-L143）⑤**`docs/full-roster-lens-spec.md`（全量棋盘+每轮镜头细案·已拍板+实施完成）**⑥`docs/ratification-batch-k38-2026-09-09.md`（报批清单，#2/#4 已按第十九棒修订，其余 10 项待拍板）。
> 状态：**实机悬案破案并修正取数（根因=模块化 ST 的 getContext() 无 character/worldInfo 字段，`characters[0]` 回退取到角色库首卡=内置 Assistant——浏览器每轮初始化都在拿错卡的碎料喂抽取，"真书从来都在、实机跑不出像样世界"闭环）→ 用户四连拍板（棋盘=账本/镜头=视野、提示词约束为主、不设池顶、势力必须抽象含子势力）→ 细案 `full-roster-lens-spec.md` 全案拍板并 K43-K48 实施完成（全量入账+净化折叠+权重预填/镜头选择器 30k+麾下成员打包/删超席强制+newEntities parent/大势·张力名实分离+实体页全册镜头徽/观测台镜头口径）**。**377/377 全绿**。**实机复验待用户**（Ctrl+F5 →「重新抽取设定」→ 观大势/张力行与实体页全册）。**待拍板**：报批 10 项（#2/#4 已修订）+ 生成层 + 焦点公式 A/B + 复归拉杆。**待办**：项目知识库（用户令仅登记）。

---

## 0. 人话版：这一棒发生了什么

先把你十来天在实机上"点开始新世界永远跑不出像样世界"的悬案破了：现代版 ST 的浏览器上下文里**根本没有"当前角色卡"和"世界信息"这两个字段**，上一棒的兜底逻辑取到的是角色库第一张卡——内置的 "Assistant"（135 字、无书）——所以浏览器每轮初始化都在拿错卡的碎料喂抽取，而真书（姬元真 235 条）从头到尾都在卡里没动过。取数修好后，你又拍板了四件事并把它们全部做完：**全书 345 个名号全部站上棋盘**（角色全量入账、势力净化折叠、子势力进分支表），模型每轮只透过 **30k 的镜头**看该看的人（实测全量入镜只花 7.9k），**不再有任何席位上限**（轮换算法从此只管理镜头进出，不淘汰资格），观棋窗口里**大势与张力各占一行**、角色页能看到全册与在场徽。一句"开工吧"，细案 K43-K48 六步全部落地，377/377。

## 1. 本棒主线（按时间序）

1. **接棒取证**：读毕 leg18 必读六件套；实机诊断日志（用户首贴）实证——`character: {name:'Assistant', book:'无'}`、`worldInfo: shape 'undefined'`、合订源仅 135 字。**根因锁定**（读 ST 实码）：`st-context.js` getContext() 无 `character`/`worldInfo`；`characters` 数组+`characterId`/`groupId` 是正路；v1 已验证取数（adapter.js L406-422/L536-545：动态 import world-info.js + chatMemberCards）。修复 `pickCharacter`（characterId 索引/群成员头像名解析，删 `characters[0]` 回退）+ 世界书双轨（旧 ctx.worldInfo 兼容 + 官方 `ctx.loadWorldInfo(name)`，候选序=卡 world→chatMetadata.world_info→globalSelect→已载表键）+ 诊断升级（identity/mounted 逐本条目数）。
2. **导出世界三问定案**（用户贴 `story-world-v2-export (2).json`）：world=大荒z（取卡修复生效）、canon 16 档标尺/345 名号（**抽取确食全本** 27.2 万字符）、实体 32=旧席位上限（**"角色势力少"真因=32 席被书序基石占满**）。指纹四变体对账全不对→**浏览器内存态≠磁盘态**（卡无 world/聊天无挂载/settings 无 world_info 表，书从会话内挂载进入）——与 settings.json 解析异常同源嫌疑，待用户排查。
3. **「大势为什么是这个」答问**：导出世界张力两句系书内正邪框架（悲天悯人×5/堕落×18/魔道×35/正邪×2，首条总纲 key=「正邪之辩 浩然正气」）的抽取概括，非模型编造；**「张力怎么叫大势」成立**——名实错位，细案 C4 修（大势/张力分列）。
4. **势力抽象+子势力+四拍板**（用户连发指令）：棋盘/镜头、提示词约束为主（「代码约束这种边界是约束不完的」）、不设池顶（「设定上限会把重要的划掉」）、势力必须抽象+子势力考虑（leg16 原话复证）。细案 `full-roster-lens-spec.md` 落盘（9 拍板点）。
5. **K43-K47 施工**（每步测试→台账→提交）：见 §2 交付表。
6. **K48 收口**：细案转已拍板+实施完成、ANCHOR 决策记录+状态行、报批单修订、台账回填。
7. **知识库待办**：用户令「写进待办事项即可，我不让你来做」——docs 膨胀治理（归档/状态表/决策索引/细案生命周期）仅登记。

## 2. 现状盘点

**测试：377/377（本棒实测；358→377 = +19：seed-full 7 + lens 6 + spawn-cap 3 + render K46 2 + full-roster-smoke 1；entity-governance 超席测试改无超席新语义、prompts.test 版本锁升 t1-4）。**

**模块**：改 `src/abstract.js`（净化 kind 三值+parent；seedBookEntities 重写=全量+折叠+权重预填+id 防冲突）、`src/pack.js`（镜头选择器 lensList+麾下成员 membersOf+30k 预算）、`src/settle.js`（POOL_CAP 废/超席强制退删/spawnEntities 无池顶+parent）、`src/render.js`（大势·张力分列/实体页全册镜头徽分支麾下）、`src/observatory.js`（驻留镜头口径）、`src/prompts.js`（v2-agenda-t1-4）、`src/schemas/ssot.schema.js`（bookEntities kind 三值+parent；实体 parent/branches；盘算 branch）、`src/schemas/world-step.schema.js`（newEntities parent）、`web/index.js`（取数修正+logInitDiagnostics+sourceDiag+seed 注释）。

**demo 新增**：`inspect-chat-world.js`（热账检视，--scan/--export）、`match-source-fingerprint.js`（指纹对账）、`probe-settings-worldinfo.js`（挂载真相探查）、`roster-kinds.js`（名册形态分析）。

**文档**：台账 L132-L143；ANCHOR 决策记录+状态行；报批单 #2/#4 修订标注；细案转已拍板。

**git**：本棒提交 `0be7f9a?` 前共 6 个：诊断（ed45319）、取数破案（2765d72）、补遗+工具（748f9db）、细案（3fcbd16）、C8 子势力（38efa14）、知识库待办（7cac666）、K43+44（cf39d4e）、K45（a7be123）、K46+47（95bf773）、K48（9267ca6）。**纪律：仅 add `story-world-v2/` 下对应文件，绝不 add -A。**

**ST 现场**：junction 在位（`public/scripts/extensions/third-party/story-world-v2` → `F:\deepseek\plugins\story-world-v2`）；聊天=大荒z（`大荒z - 2026-09-01@00h37m41s559ms.jsonl`，首行 2.9MB 含 story_world 旧键/yuzukiMemory 等他物，story_world_v2={} 空残留）；settings.json（1MB）无 world_info 表、Parse 异常待排查（疑与浏览器内存态分叉同源）。

## 3. 关键决策与结论索引

1. **悬案破案=取数层**（非引擎）：模块化 ST ctx 无 character/worldInfo → `characters[0]` 取到库首卡 Assistant。修复=characterId/群成员解析 + 官方 loadWorldInfo 双轨（台账 L133）。**所有"世界不像样/角色太少"的旧账先重抽再说**。
2. **棋盘=账本、镜头=每轮视野**（用户四拍板之一）：全量入账=资格；镜头=pack 每轮按分量+点名选人（30k 预算内）；轮换算法（闲置退休/复归/静默应答）管理镜头进出，不淘汰资格。
3. **提示词约束为主**（四拍板之二）：净化/折叠形态纪律进抽取 prompt（parent 只填书明述/location 标地名），引擎只守诚实底线（弃关系+警告，不拒整包）。先例=ripples 铁律 8。
4. **不设池顶**（四拍板之三）：POOL_CAP 废；超量→重新抽取重建；存储由冷档/导出兜底。
5. **势力抽象+子势力**（leg16 原话复证）：势力净化折叠（链顶解析→branches 分支表）；角色全量；盘算 branch 身份链契约先行；升格/降格通道排期独立 K（三家分晋原型）。
6. **37 万字符实证**：345 名号全量入镜只花 7906/30000（全量棋盘 100t 曲线：346 实体/坏账 0/无席位满员/确定性逐字节）。
7. **大势≠张力**（用户指认）：渲染名实分离——大势行=张力+环境危险带+浪尖拼装句；张力行=三件套独立行。
8. **浏览器内存态≠磁盘态**（导出指纹四变体对账结论）：挂载来源钉死不阻塞，diagnostic mounted 可收尾。

## 4. 未决点 / 待拍板

- **【实机复验·下一棒第一动作】全量棋盘效果验收**：Ctrl+F5 → 设置页「↻ 重新抽取设定」（**必须重抽**——新抽取形态才产出 parent/location 分类）→ ①观棋信息带：大势行（拼装句）与张力行（三件套）分列 ②角色与势力页：全册（数百人，不再 32）、「在场」徽、宗门行分支/麾下、角色行隶属 ③状态条抽取警告。异常即贴现场即修。
- **【待拍板】报批 12 项**：#2（max_tokens 4096→16384）与 #4（席位 32 废除）已按第十九棒修订；其余 10 项（#1 冷档/#3 PLAYER_DESC/#5 新实体缺省/#6 依据册 TOP5/#7 拒签线/#8 驻留区/#9 远期判据/#10 钳制/#11 合订抽取组/#12 抽取预算 16384）仍提案态待点。
- **【待拍板】生成层细案**（v1 式种子：现状一句/谋划≤3/事件≤3/编年 1-2 行，引擎校验，数字提案）——"开局是活的"直接诉求。
- **【待拍板/挂真跑】焦点公式 A/B**（提及出局/加权；镜头只用结算层数据）· **复归拉杆**（名额 1/名册 TOP5）· **升格/降格通道**（分支转主，细案 C8 排期）。
- **【待办】项目知识库**（docs 归档/状态表/决策索引/细案生命周期）——触发=用户指令。
- **【现场】settings.json 解析异常**（用户排查；疑与浏览器内存态分叉/巨型世界内嵌同源）· 大荒z 聊天 `story_world_v2={}` 空残留（用户点头后清）· `suggestion.doc` 未跟踪杂项（用户处置）· 知识库待办已登记。

## 5. 环境与命令

- 运行位置：`F:\deepseek\plugins\story-world-v2`（Node 24+，零依赖无构建）；git 仓 = `F:\deepseek\plugins`（**严禁 add -A**）。
- 测试：`node --test`（**必须无参**）；总览：`node demo/status.js`。
- 热账检视：`node demo/inspect-chat-world.js --scan`（全聊天）/ `--export <文件>`（导出包）；指纹对账：`node demo/match-source-fingerprint.js <世界书> <导出> <卡png>`；挂载探查：`node demo/probe-settings-worldinfo.js`；名册形态：`node demo/roster-kinds.js <导出>`。
- ST 部署位 junction（如拆，`mklink /J <ST>\public\scripts\extensions\third-party\story-world-v2 F:\deepseek\plugins\story-world-v2` 重建）；改动 Ctrl+F5 即载。
- 用户环境事实：ST 数据 `F:\jiuguanai\SillyTavern-Launcher\SillyTavern\data\default-user`（模块化核心：ctx 无 character/worldInfo；世界书走官方 `loadWorldInfo(name)`；挂载=extension_settings.world_info 表+globalSelect+chatMetadata.world_info）；活跃预设=预设 1（gemini-3.1-pro-preview @ gcli.ggchan.dev，思考型）；卡 大荒z 内嵌 235 条 character_book（卡 world 字段为空）；worlds 8 本（Global_自用同人角色卡世界书 21MB）。

## 6. 铁律（九条延续，全部有效）

1. 没命令不动代码；机制新增两段式。2. 上限/阈值先报批。3. 机制文档开口先给「人话版」。4. 改码三件事连着做：测试 → 部署 → 台账。5. 审批=never：沙箱拒绝即终局。6. 先 read 再 edit 被改过的文件。7. 任何决定过一遍检验三问。8. 数据说话：阈值/契约争议先出曲线/现场。9. 分层归属：修复必须声明所改层。

## 7. 交接给下一棒的现场（可信任的起点）

- 代码全绿 **377/377**（本棒实测：K43-K48 全量棋盘交付 + 此前的 358 全量回归）；提交链完整可回查（§2 git 清单）。
- 取数修正已上线：`pickCharacter`（characterId/群成员）+ `loadWorldInfo` 双轨 + 聊天级挂载 + 诊断常驻（成功失败都打 `[story-world-v2] 初始化取数诊断`，含 identity/character.world/mounted 逐本条目数）。
- 抽象本体依旧实证 OK；345 全量入镜实测 7906/30k——镜头不会截断现规模，截断机制只在实体数爆涨时兜底。
- 数字：30k/16k/无池顶/闲置退休 20/复归/静默应答为已拍板；其余（报批 10 项/生成层/焦点/复归拉杆）提案态，未拍板不当定案用。
- 实机侧唯一未钉死=浏览器挂载来源的磁盘镜像（内存态≠磁盘态）；不阻塞验收，诊断/mounted 可随时收尾。
- 用户情绪：本棒从高爆转向拍板节奏；先做实机复验、少开新机制；报批/生成层等复验后清桌。

## 8. 下一棒任务书

1. **实机复验（第一动作）**：Ctrl+F5 →「↻ 重新抽取设定」→ 按 §4 三处观察；异常贴现场即修（取数/镜头/渲染各层对号）。
2. **拍板桌清空**：报批 10 项逐项定案；生成层细案拍板后施工（v1 式种子）。
3. **焦点公式修订**入焦点细案（提及出局 A/加权 B）；复归拉杆与**升格/降格通道**挂真跑读数/排期；
4. **真跑带新素材**（对话反复点名→依据册→主动提议实绩；全量棋盘下观察镜头进出与驻留读数真值）；
5. **现场事务**：settings.json 解析异常提示用户排查；大荒z 空世界元数据键清理（用户点头后）；知识库待办保持登记；
6. **纪律重申**：任何 transport 新调用点先对 worldstep.js L12 双形写法；真跑在前机制在后；先 read 再 edit。

---

*第十九棒交接 · 2026-09-09 · 悬案破案 + 全量棋盘&镜头细案拍板实施（K43-K48） · 377/377 · 实机复验待用户 · 下一动作：Ctrl+F5 + 重新抽取 + 三处观察。*
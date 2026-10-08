# 来源修复、首轮拒绝保护与属性保留交接

用户 2026-10-04 最新要求「嗯嗯交接吧」。本轮功能实施已完成，本文件汇总 leg187–leg189，并链接此前来源页修复。当前权威读数统一见 [源码 STATE.md §1](C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2/STATE.md:40)。F 盘原开发分支的源码与 STATE.md 不覆盖。

## 接手位置

- 唯一实施源码：C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2，分支 codex/entities-refresh。聊天环境显示的 c2c6 工作树不是本次实施目录，不要在那里继续修改。
- 最后功能提交：b66c2acf41ae51ad678cc961a29b1e70f0fdceda；本交接收尾只改文档与生成索引，最新文档提交和安装提交见 F:/deepseek/tmp/leg189-handoff/install-verification.json。
- 本机安装：F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2，main 分支。功能安装提交 0af8faf2037b07abc5dfff0915e607db65cf15d2。
- 没有推送远端；不要把本机安装记成发布。刷新酒馆 Ctrl+Shift+R 后生效。
- 历史未决事项以源码 STATE.md §3 和 docs/work-current.md 为准，不能把旧提案当作新命令。

## 已完成

### 来源页（leg186）

正文/选段窗口有「关闭正文 ×」，关闭保留选中、阅读方式、选段和筛选。搜索原本已设置 hidden，但 display:flex 覆盖了隐藏规则；现在显示结果与计数一致。全选、反选、取消结果只作用于当前筛选结果。

交接与真实浏览器验收见 [leg186](F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-04-leg186-source-picker-fixes.md)，证据 F:/deepseek/tmp/leg186-source-picker/。

「自动清理」是来源阅读模式，不是属性拒收策略。跨来源同文条目沿用来源/条目身份保留，本次没有新增内容去重逻辑。

### 首轮无有效输出仍加轮数（leg187）

拒绝不可靠的模型响应，不再用空步替代非法输出并继续落账；非法 JSON、不可用形状及全部提议无效的回合不推进轮次。有合法提议的部分有效响应仍保留合法部分。预处理使用副本，失败不会把预处理结果留进原世界。

提交 503afd5；回归、安装与审查证据 F:/deepseek/tmp/leg187-rejected-rounds/。这一结论针对程序拒绝路径；没有用户当时第一轮完整原始响应，不能据此断言已确认其实际根因，也没有补写丢失的第一轮事件。

### 设定页空白与警告（leg188）

严格设定提示词提供逐项出处示例；只重抽设定若返回空结果，会在写缓存/替换原设定前失败，已有设定保留。初始化若交回的全局设定全被拒绝，也不静默当作成功；仅交名册的合法初始化仍可进行并给出诊断。全局设定收/弃摘要与具体原因不会被大量属性日志淹没，无需开启详细数据才能看到摘要。

提交 af634e9；证据 F:/deepseek/tmp/leg188-setting-diagnostics/。未拿到用户当时模型原始设定返回，所以不能确认其设定页空白究竟是未返回、出处拒收还是格式问题。此保护没有凭空恢复设定。

### 描述属性完整保留（leg189，最新用户规则）

用户明确要求取消属性丢弃，以「散修，现代穿越者，阴险老六」和补充「自号极阴」为例。此要求覆盖之前 leg185 的描述属性严格出处/冲突留空设计；接手不要把旧字段闸重新加回去。

- 人物、势力、地点 fields 的非空描述完整保存。取消逐字出处拒收、键名形态限制、值截断、每实体项数上限及属性冲突墓碑。
- 相同值去重；无数字的完整补充描述保留覆盖双方的较完整文本；不同描述按书序换行并存。含 Unicode 数字的描述只做完整行去重，不按子串压缩，避免 1/10、小数、负数、千位符、全角数字或等级吞值。
- 数字、布尔、列表、对象转 JSON 文本保存；空值无描述不造字段。来源写「模型抽取」，不冒充「书里原话」。
- 新模块 src/abstract-fields.js 为单响应、跨块、拆半及种账提供同一文本与合并规则。提示词同步取消字段逐字引用要求；缓存版本已更新，旧策略缓存失效。
- 类别、别名、结构隶属、关系与全局设定的核验继续保留。「所属」描述始终保存，只有经关系出处核验的候选才能进入结构 parent；种账不直接从未经核验的 fields.所属 建关系。
- 属性拆半合并带走后半的已核验 kind/parent，冲突两行保留至最终名册归并诊断；不改写源块。模型属性与 id/kind/attrs 等结构键同名时原值留在 canon.fields，不覆盖引擎结构；schema 查询只读自有键，constructor/__proto__ 描述不会被误当契约。

## 验收和证据

功能证据目录 F:/deepseek/tmp/leg189-retained-attributes/：

- source-tests.log：正常全量回归通过，具体当前数量见 STATE.md §1。
- source-smoke.log、installed-smoke.log：50 tick 合成烟测 PASS，警告为零。
- source-audit.log、installed-audit.log：文档守门 PASS；唯一黄色为冻结 LEDGER 的历史超长行，未重写历史。
- final-verification.json、install-verification.json：功能提交及本机提交、跟踪文件逐字节一致、两棵工作树干净、未推送远端。
- review-final.md：独立只读复审 Ready；审查过程中发现的归属绕过、数字吞值、拆半丢归属/冲突均已关闭。
- red.log、struct-red.log、numbers-red.log、review-red.log、review2-red.log：旧策略与新增反例的失败证据；对应绿色日志保留。
- test/retain-extracted-attributes.test.js：用户身份实例、两遍出处不匹配、长属性、多项、非字符串、缓存、种账、结构键保护、数字与真实非 JSON 失败拆半回归。

交接文档和生成索引收尾证据另在 F:/deepseek/tmp/leg189-handoff/，防止覆盖功能验收快照。

## 后续边界

本轮用户已授权的修复全部完成，复审未发现本次范围内剩余可操作缺陷。没有修改世界书、角色卡或用户聊天，没有调用真实模型，也没有自动重抽、重置或改写已有世界。

新规则在新的抽象中生效；已丢弃的旧属性不会自动补回。「只重抽设定」跳过名册/属性遍，不能用于恢复已丢失的实体属性。已有实体种账仍沿用历史保留路径，不自动覆盖已有世界的状态；若用户要补旧账，应另获具体修复范围，先复制原始聊天再诊断，不能为了补属性直接初始化重置世界。

如果刷新后实际操作仍异常，应先取得该次原始返回和设定摘要，区分模型没有返回内容、结构核验拒收和界面显示；不要再次恢复描述属性丢弃规则来掩盖问题。

## 文档收尾

源码文档提交：a3c20f3144181a4034f9978657c9fa3e30b9958b；本机文档安装提交：12e8e6efbf6e2ae05ac4d00c4002b1fbf8fcaf30。收尾仅修改 STATE 和生成索引，源码功能未变。STATE 缓存版本记录已与 src/fp-hash.js 对齐，最新交接指针已更新。源码文档守门 PASS，跟踪文件逐字节一致且两树干净；安装目录复核结果见 F:/deepseek/tmp/leg189-handoff/installed-audit.log。

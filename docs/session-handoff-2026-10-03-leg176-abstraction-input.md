# leg176 · 抽象输入优化（2026-10-03）

先读当前实现工作树的 `STATE.md`，当前权威读数见 §1；用户命令与当前事项见 §0.5 指向的 `docs/work-current.md`。本文件是本次已测快照，不另建待办总表。

## 用户授权与现场

用户原话：

> F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-02-leg174-story-reader.md你把抽象问题优化一下吧，在这之前你列举一下还有什么问题，可以使用本地的dsh为你干活

先列举源码证实的问题，给出明确技术来源处理的细案，用户批准后说：

> 可以，开工吧

已实施并安装本机预览。延续用户此前“更新了先不推，让我本地看到效果验证完后再推”的要求，本次未推远端。新交接仅放在本 F 盘 docs，未在 C 盘创建副本。

本次从已安装源码基准 `669c912` 接续，未将 cf18 旧 leg150 或 F 盘旧开发分支装回酒馆。

- 实现工作树：`C:/Users/30319/.codex/worktrees/cf18/plugins/story-world-v2`
- 分支：`codex/abstraction-input-cleanup`
- 实现提交：`78125b722d87b177f4e6a063a25758d6f52d9795`
- 旧 d630 阅读改版工作树及 F 盘 `leg151-prefetch` 源码保留。
- 设计：[spec-abstraction-input-cleanup.md](F:/deepseek/plugins/story-world-v2/docs/spec-abstraction-input-cleanup.md)
- 实施计划：[plan-abstraction-input-cleanup.md](F:/deepseek/plugins/story-world-v2/docs/plan-abstraction-input-cleanup.md)
- 安装目录：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`
- 最终源码与安装提交、跟踪文件核对：[install-verification.json](F:/deepseek/tmp/leg176-abstraction-input/install-verification.json)
- 本机安装脚本：`F:/deepseek/tmp/leg176-abstraction-input/install-local-preview.mjs`，明确从 cf18 导出子树，先检查两端干净，再快进本机安装仓。

## 已解决的入口问题

| 原问题 | 本次处理 |
|---|---|
| 技术条目与脚本原样进入抽象 | 新增无依赖叶子模块 `src/abstract-source.js`；专用 `[mvu_update]` / `[initvar]` 条目整条排除，成对 EJS / script / UpdateVariable 区块只移除区块，返回排除记录。只处理副本，不改原书、不执行代码。 |
| 排除要求主要限于法则 | `ABSTRACT_FACT_RULES` 在名册、属性、设定、刻度、关系所在问法、单实体查书及起根共用，明确资料不是模型指令，示例和变量初值不证明世界状态。真实数值与实力仍抄原话。 |
| 技术题名可直接补册 | 专用技术条目及纯脚本配置不参与题名名册。普通控制器确实点名有效世界正文时保留作者题名，禁用的真实人物档案也沿用原有题名来源。声明探测仍先读原书。 |
| 小书接受书外名号 | 小书复用大书 `filterByBookEvidence`，有效题名作为允许的出处；关系端点改用已通过校验的名册。 |
| 补查及入账仍能绕回原技术文本 | 实体补查、独立起根、初始化原文属性补缺共用清理。补查相关条目全被排除时返回未加载，不将其写成“书未明述”。 |
| 技术改动触发书指纹、题名变更漏过缓存 | 有效正文与有效题名共同参与书指纹。只改变被排除且不影响有效题名的技术内容，不改变指纹；控制器改变名号来源会失效缓存。抽象问法缓存版本已更新，权威值见 `STATE.md` §1。 |

其他修正：连续技术区块之间保留文字边界；补充汉字码点不会被拼成新名号；角色卡内置书的空白 comment 能正确回落 name；区块未闭合时保留原文并报告。缺正文但有自证题名时只交原名，不编属性。

独立复核发现一个缓存遗漏：剔除纯控制器后，题名变化只通过 `extraDeclared` 影响名册，没有进入文本指纹。已先写实际同一缓存两次初始化的失败回归，再补充未编入正文的作者题名。继续复验发现防御上限会截掉题名文本，于是指纹独立纳入名号序列；预算短例与默认上限、大书、小书、浏览器换书路径均已验证。最终复核未发现重要阻塞。

## 验收证据

全量测试、冒烟及文档守门均通过，读数与当前源码 `STATE.md` §1 一致。安装目录也跑过同样的测试和冒烟，知识索引同步；所有跟踪文件与源码字节一致，两端工作区干净。

本次新增回归覆盖实际合订、抽取编排、入账补缺和浏览器书源调用，包含真正的缓存命中路径，未以模拟输出代替真实模型效果。浏览器模块依赖图与生产接线守门随全量测试通过。

验收日志位于 `F:/deepseek/tmp/leg176-abstraction-input/`：

- `source-tests.log`、`source-smoke.log`、`source-docs-audit.log`
- `installed-tests.log`、`installed-smoke.log`、`installed-docs-audit.log`
- `install-verification.json`：最终安装核对
- `worldbook-comparison.json`：八本本机世界书的零模型前后对照
- `compare-worldbooks.mjs`：对照脚本，不调用模型、不输出原文

对照快照：三国有效输入从 500184 到 415507 个 UTF-16 字符，原有 189 个题名全部保留；大荒从 268764 到 234506；re0 从 88151 到 84018。四本未含被排除内容的有效世界书输入逐字相同；禁用的记忆库仍不可用。该读数仅代表输入变化，不证明提速比例或模型质量。

文档守门仍有既存 `LEDGER.md` 索引行超长的黄色提示，本次未扩大为台账整理任务。

## 本地 dsh 与独立审查

使用 `local-agent-commander` 调度本机 dsh，两次均为只读，不允许写文件或读凭据：

- 初次审计 run `30473fae01e545c5a13706b9d93fb2bc`，超时。
- 定向复核 run `03e42d4940fb4fff90f7a0ca79b6c115`，超时。
- 没有完整 dsh 结论；只采纳经过独立复现的日志线索，修复文字边界、真实题名召回与过滤后的补查状态。未采纳语义黑名单或数值推断。
- 按 `requesting-code-review` 完成独立只读审查；发现的缓存问题已修复，复核额外验证题名改名会重抽、仅诊断文案变化仍命中缓存。

dsh 运行记录在 `C:/Users/30319/.codex/local-agent-commander/runs/` 对应 run 目录，记录不是交接文件，不含凭据内容。

## 用户验证入口与限制

酒馆 **Ctrl+Shift+R** 刷新。构建号在“参数”页顶部与“角色与势力”表头，值见源码 `STATE.md` §1。

新初始化、设定或刻度重抽、单实体查书与起根使用新口径。旧世界名册和已有事件不自动删除或重建；“只重抽设定”也不会清洗原名册。若要比较完整抽象结果，应在新初始化中验证。

尚未调用用户的真实模型通道，没有同书、同模型、同配置的质量与耗时前后实测。无明确协议标记的技术散文由共同抽象要求约束，未做确定性的语义删除；未闭合区块保留并报告。下一位不能将这版描述为“已证明更快”或“所有技术示例都不可能进入模型输出”。

其他历史待办只引用当前源码 `STATE.md` §3 与 §0.5 的唯一清单：预计耗时/取消、长期归档“一轮一卷”、真实模型效果复验、实际聊天观感。不要在本交接追加一份平行任务表。

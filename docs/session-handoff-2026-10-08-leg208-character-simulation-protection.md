# 玩家、禁止模拟角色与本轮行动事实保护

当前入口是 `STATE.md` §0.5，权威读数见 §1，本机位置见 §5。用户原话逐字保存在 `docs/work-current.md` §1。源码与交接都位于 F 盘。

玩家由已有 `context.playerId` 始终保护。角色详情新增「禁止模拟」/「允许模拟」，手动状态保存为实体 `simulationBlocked`；模型不能写此字段，玩家不能解除。本轮正文实际行动的实体在对应一次推进中享有同样保护，保护到期后恢复普通演化；只被提及、被波及或改字段不算实际行动。旧世界无需重建。

保护覆盖动作、行踪、姿态、言语、心理、选择、承诺与字段。标题和 NPC 描述也属于保护范围：人在家却被写成“狂奔上学”，即使 NPC 是动作主语，也必须拒绝。其他角色仍可按已确认处境与受保护对象互动，不得把意图写成其已经完成的行为。

结构规则共用 `src/simulation-protection.js`，校验和净化同时拦截主动动作、盘算、命运、字段、关系来源和对受保护盘算的父子委派。受保护名单独立出包，镜头裁剪不会裁掉；已有别名与设定别名沿用同一身份解析，冲突名不当确定别名。

`src/simulation-review.js` 在主输出解析后、任何落账与修复前，用已确认输入独立检查所有提案组。每条提案必须得到唯一合法判断；拒绝、失败、非法 JSON、漏项、重复项或未知路径都中止本轮，原世界保持不变。通过后才走既有结构校验与落账。有保护名单且有提案时会多一次现有世界通道的模型调用，成本和等待时间增加。

保存走真实 `hotHub.commitHotMeta` 事务，成功后刷新；失败、换聊天或账版本改变不报成功，窗口内显示错误。保存期间按钮禁用，演算启动受阻。CSS 未改。

详情按钮绑定打开时的聊天与世界版本，切换聊天或同编号换世界后旧按钮拒绝保存。手动查书在查询前捕获原世界，返回后再次检查并事务写回；迟到查询不得覆盖期间保存的禁止模拟标记。

验证证据目录：`F:/deepseek/tmp/character-simulation-protection-2026-10-08/`。

- `worktree-tests.log`、`source-doc-audit.log`、`installed-tests.log`：全量测试；当前数量见 `STATE.md` §1。
- `smoke-final.log`、`installed-smoke.log`：合成演算冒烟。
- `browser-verification.json`、`protected-npc-*.png`、`protected-player-*.png`：桌面和窄屏 Chrome 真点击；实际保护 hub、角色窗口与 hot ledger，使用合成存储。
- `shared-protection-tests.log`、`shared-protection-review-fixes-tests.log`：结构保护、临时到期、委派与冲突别名回归。
- `core-review.md`：独立审查；委派写承诺与冲突别名问题已补回归修复，最终复核见该报告。
- `source-integration.json`：先比对原文件指纹，再增量合入日常项目，保留原未提交改动与 HEAD。
- `backup/installed-before.bundle`、`backup/installed-before.tar`：本地安装前完整历史与原树。
- `install-verification.json`、`http-verification.json`：安装提交、全运行文件和实际酒馆 HTTP 响应逐字节核验。

本次不调用真实模型，不改真实聊天、世界账或世界书，不推发布仓。语义核验仍由模型判断；合成拒绝/允许样本验证接线与失败处理，不能证明真实模型没有漏判。已有错误事件不自动重写；用户强制刷新酒馆，在聊天副本试跑玩家在家及普通 NPC 反应场景，验证实际通道质量。

设计与计划：`docs/superpowers/specs/2026-10-08-character-simulation-protection-design.md`、`docs/superpowers/plans/2026-10-08-character-simulation-protection.md`。隔离开发树保留于 `F:/deepseek/worktrees/character-simulation-protection/plugins/story-world-v2`，便于后续反馈；日常项目仍是 `F:/deepseek/plugins/story-world-v2`。

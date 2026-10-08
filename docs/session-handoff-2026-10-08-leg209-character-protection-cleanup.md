# 撤销未经批准的额外调用，调整角色保护界面

当前入口是 `STATE.md` §0.5，读数见 §1，本机位置见 §5；用户原话逐字保存在 `docs/work-current.md` §1。

用户明确要求撤掉第二次模型核验，并指出角色详情头部的大按钮与长说明突兀。本次完全删除额外模型调用、`simulationReviewTransport` 参数、独立核验模块及假审核测试辅助，旧合成场景直接调用生产 `runTick`。玩家、手动禁止模拟和本轮行动三类保护都有真实调用计数回归：有提案的推进只调用原主模型一次，越权的结构化动作仍被程序拒绝。

保留 `simulationBlocked`、共享权限校验、盘算委派与承诺保护、临时名单到期、冲突别名解析及保存事务。角色的自由文本事实继续依赖原生成提示词，程序并不能理解并硬判所有叙述，不宣称彻底杜绝模型编造。原生成提示没有另加调用。

详情资料行使用紧凑「禁止模拟」开关，状态通过开关和 ARIA 表示；撤掉长说明与重复保护标签，玩家使用不可解除的简短标识。保存状态为空时不占行，失败在窗口内显示；键盘切换后焦点仍留在开关。标题提示简短解释作用，角色列表已有保护标签保留。

证据目录：`F:/deepseek/tmp/character-protection-cleanup-2026-10-08/`。

- `call-count-red.log`、`ui-red.log`：删除前调用数与旧界面回归失败证据。
- `focused-tests.log`、`worktree-tests.log`、`installed-tests.log`：功能与全量测试，当前数量见 `STATE.md` §1。
- `smoke-final.log`、`installed-smoke.log`：合成演算终态保持一致。
- `browser-verification.json`、`protection-control-*.png`：桌面/窄屏真实控件、空格键、ARIA、保存回读、失败、忙碌和旧窗口拒绝。
- `core-review.md`：独立审查；`source-integration.json`：合入前字节核对及保留原 HEAD。
- `backup/installed-before.bundle`、`backup/installed-before.tar`：原安装历史和原树。
- `install-verification.json`、`http-verification.json`：本地安装提交、完整运行文件与酒馆实际 HTTP 响应字节核对。

强制刷新酒馆后测试角色详情开关。未调用真实模型、修改真实聊天/世界账/世界书或推远端；实际模型遵守原提示的质量仍需用户现场试用。此前额外核验的实现和测试说明是历史，当前以本次交接与 STATE 为准。

计划：`docs/superpowers/plans/2026-10-08-character-protection-cleanup.md`。隔离树仍保留于 `F:/deepseek/worktrees/character-simulation-protection/plugins/story-world-v2`，日常项目为 `F:/deepseek/plugins/story-world-v2`。

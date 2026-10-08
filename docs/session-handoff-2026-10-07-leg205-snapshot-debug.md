# leg205 · 快照选择与调试信息

日期：2026-10-07。当前权威读数统一见 `STATE.md` §1，授权原话见 `docs/work-current.md` §1。此前聊天事件提示词优化保留，模型创作质量仍待用户重跑。

## 本次原因与行为

截图里两份同轮快照都叫“落账”。两种世界写入入口都使用这个原因，而同轮的查书、补全等可以产生不同状态；旧列表没有内容差异，且保存时间只有截取的 UTC 时分秒。截图本身不能证明用户这两份具体改了什么，也不能据此删去其中一份。

现在清单使用既有 `restoreFrom` 只读还原已有快照，再比较上一份可读内容；显示事件、人物或势力、盘算、持续条件、关系及设定的真实变化和具体名称/字段值。前两项直接可见，更多变化可展开，并明确相较哪个快照编号。本地保存日期和时间一起显示；当前状态只取原 `current` 标记。首份明确无法比较更早变化，同内容明确相同；坏链或缺失完整世界明确无法读取并禁用回档按钮。完整与增量仍是存储信息。

调试台去掉窗口收起、通用 IDB 写入成功及每秒读数；保留关键操作和失败。既有 error/unhandledrejection 分流现在把错误消息、文件行列、堆栈结构化写入记录；其他来源标为页面异常，状态条继续只报告本插件异常。新适配层捕获资源加载失败及 console.warn/error，保留原控制台参数、接收者和返回值，可重复安装或卸载；已结构化记录后的控制台转发不重复采集。未知来源控制台日志明确标为来源未定位。

记录器订阅驱动日志与摘要更新，保留筛选、控件和焦点，新的来源选项可直接选。现有有界容量和脱敏继续使用；控制台对象的完整模型输入/回复/世界字段不自动采集，普通 log/info 不接管。浏览器未暴露或完全吞掉的错误无法凭监听凭空得到。

## 实施与验证

开发隔离树：`F:/deepseek/worktrees/snapshot-debug-usability/plugins/story-world-v2`，仅本次源码/测试的提交 `854b6fe6859b59a15e173d49f8b3aad13652b491`。已经合回唯一日常项目 `F:/deepseek/plugins/story-world-v2`，保留原有未提交内容。源码声明范围与合回前逐文件备份见证据目录的 `source-integration.json` 和 `source-before/`。

设计：`docs/superpowers/specs/2026-10-07-snapshot-debug-usability-design.md`；计划：`docs/superpowers/plans/2026-10-07-snapshot-debug-usability.md`。生产逻辑没有世界书名字、题材或轮次数阈值，按已有账本字段处理。快照保留策略、数据库版本、世界步骤和主模板均未修改。

证据目录：`F:/deepseek/tmp/snapshot-debug-usability-2026-10-07/`。

- `red-tests.log`：修改前确认目标缺口；后续 console/资源用例也先失败再通过。
- `worktree-tests.log`、`worktree-smoke.log`：完整回归与合成演算。
- `browser-verification.json` 与 `before/after-snapshots-*.png`、`after-debug-*.png`：真实 Chrome 下桌面及窄屏合成展示，核对当前标记、日期、实际差异、实时错误与筛选。
- `review.md`：独立只读审查，无阻塞或重要问题。
- `source-tests.log`、`source-smoke.log`、`source-doc-audit.log`：合回后的检查。

已安装到酒馆实际加载的 `F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`；安装目录测试、冒烟、文档核验及实际 HTTP 文件对照通过。全部运行文件与日常源码一致，安装前 Git bundle 与原树归档在证据目录 `backup/`。最终现场、安装提交及备份以 `STATE.md` §5 和证据目录的 `install-verification.json` 为准。未推送远端，未修改真实聊天、世界书或快照，未调用真实模型。

## 用户复测

酒馆 Ctrl+Shift+R，构建号看「参数」或「角色与势力」；当前值见 `STATE.md` §1。打开快照看同轮的具体变化，再在「设置 → 调试」按来源/级别查看故障，并复制报告给后续排查者。真实 ST/TT 保存回读、实体手机操作及模型质量仍待用户现场验收。

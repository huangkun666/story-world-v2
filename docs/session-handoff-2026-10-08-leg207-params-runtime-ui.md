# 参数页运行与注入布局交接

当前读数与构建只看 `STATE.md` §1，本地实际加载目录看 §5。唯一日常项目为 `F:/deepseek/plugins/story-world-v2`，用户原话与布局批准见 `docs/work-current.md` §1。

## 最终行为

运行与注入分成自动运行、聊天如何影响世界、聊天模型能看到什么、往事怎么找四块。每项直接显示用途和调整后的影响，长例子仍可展开。向量阈值、召回条数与正文黑白名单放在默认折叠的高级设置；现有参数名、原值、范围与控件接线保留。

自动推进关闭的说明只表示发消息不推进、切聊天不自动载入，仍可从窗口顶部手动推进；明确它不关闭下方的资料注入。关闭标签指令只是不再要求聊天模型写标签，已有标签仍可读取。资料开关分别说明名号、世界动向、往事及跟书不同的现状；原上次注入读数放在资料卡内。

世界条件注脚原样移动到世界条件子页，不再混在运行页底部。输入与 label 关联，说明贴近输入；四块宽度统一，手机同序，无横向溢出；高级设置可用 Space 键展开。

## 交互中发现并修正的保存问题

真实表单委托验证发现两处此前已有的问题：往事注入字数键未登记进数字范围表，所有修改被拒；相似度阈值误走整数校验，小数被拒。

本次补齐已有字数输入范围与人话名称，根据已有小数键表调用已有小数校验。没有改变检索算法、参数默认值或旧输入范围。两项均先以真实 `bindSettingsForm` 的 input/change 委托证红，修后验证边界、合法现值、小数归一，以及非法值不会覆盖原值。

## 检索说明的核实

审查确认现有检索实现保留最近正文的原文片段，正文名单主要处理向量检索补充使用的正文，按名字找不读取两份名单。未填名单时，调大上下文深度可能不会改变查询；不能承诺每条较早正文都进入查询。短说明、悬停说明与展开细节已按实际行为修正。本项是既有实现的观察，没有扩大本次范围去修改检索算法。

## 验证与集成

证据目录：`F:/deepseek/tmp/params-runtime-ui-2026-10-08/`。

- 开工源指纹、隔离工作树基线、两处保存红绿测试及控件前后对照见 `baseline.json`、`baseline-plugin-tests.log`、`task-1-save-red.log`、`task-1-save-green.log`、`task-1-controls-evidence.json`。
- 桌面与窄屏用真实渲染、样式、action-router、settings 表单委托及合成数据，验证各项原值、四块分组、label、高级折叠与键盘、开关点击、五个数字和两份名单保存、重绘后现值保留。报告 `after-browser-verification.json`，截图 `after-runtime-*.png`、`after-advanced-*.png`。
- 全量及冒烟见 `worktree-tests.log`、`worktree-smoke.log`；审查见 `task-1-review.md`。源码与安装读数和守门见 `STATE.md` §1、§5 对应日志。
- 日常集成先核对声明文件开工指纹，只复制本次文件并备份原件，保留既有未提交修改与日常 HEAD。记录 `source-integration.json`，原件在 `source-before/`。
- 安装前历史 bundle 与原树 tar 在 `backup/`。安装全量、冒烟、文档守门与实际 HTTP 字节核验见 `installed-tests.log`、`installed-smoke.log`、`installed-doc-audit.log`、`http-verification.json`；安装本地提交记录见 `install-verification.json`。

未调用真实模型，未改真实世界、聊天或世界书，未推送远端。浏览器验证为合成数据，真实 ST/TT 保存回读和实体手机仍需用户现场试用。

## 本地复测

在酒馆 Ctrl+Shift+R 后打开「参数 → 运行与注入」。确认四块分组和直接可见的说明，展开高级设置可找到原向量参数和正文名单；往事字数及相似度小数修改应能保存。

设计与计划：`docs/superpowers/specs/2026-10-08-params-runtime-ui-design.md`、`docs/superpowers/plans/2026-10-08-params-runtime-ui.md`。前一棒快照去重和插件诊断范围修正保留，此次没有继续调整快照列表。

# 观棋文案与角色势力名册实施计划

采用 writing-plans 与 executing-plans 在当前隔离工作树实施，授权来自用户本次请求。

目标：核实显示轮数有效、纠正页面名，并减少角色势力页的视觉拥挤。

架构：只调整参数说明、渲染输出与样式；原有选择器和动作名继续连接现有控制器。高级选项的展开由当前视图条件决定，不创建世界状态或第二份名册。

技术：原生 JavaScript、HTML、CSS、Node 测试、Chrome 无界面浏览器。

约束：保留参数键、值域、分页和世界契约；中文文件用补丁修改；以 STATE §1 为读数出处；交接只放 F 盘；本机预览用本地 Git 快进更新。

- [x] 在 `test/roster-toolbar.test.js` 验证默认折叠、生效条件可见与原动作保留，旧渲染先失败，实施后通过。
- [x] 在 `src/limits.js` 修正玩家文案，在 `src/render.js` 折叠高级工具和查书说明、添加页头及列标题，保留字段与按钮。
- [x] 在 `web/style.css` 原规则处调整名册样式，增加限定于名册的布局与窄屏规则。更新 `web/index.js` 的样式版本、`src/render-base.js` 的面板号与 `test/render.test.js` 样式指纹。
- [x] 针对性回归、全量 `node --test` 与 `node demo/smoke-demo.js` 通过；Chrome 检查 1440、768、390、360 宽的实际布局、展开与实体窗口通过，独立只读复核无待修问题。全量与构建读数见 `STATE.md` §1。
- [ ] 复核差异和交互，更新 README、STATE 与生成索引；提交经验证源码。
- [ ] 使用上一棒本地安装脚本的安全检查和快进方式安装预览；再次验证安装字节、测试、冒烟及文档守门。写 F 盘交接并报告刷新方式。

本记录随源码提交冻结。交付步骤的最终安装证据和完成状态，以 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-03-leg183-roster-cleanup.md` 为准；冻结时未勾选的交付步骤不构成下一棒待办。

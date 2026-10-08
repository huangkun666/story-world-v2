# 顶部调试信息收起与项目改进建议

当前构建、判据和样式读数以源码 `STATE.md` §1 为准。

用户本次要求隐藏截图里的顶部调试信息，并询问项目还有哪些改进方向。
交接中的旧任务和本机 dsh 使用记录仅作为背景；本次没有扩大功能范围。

## 实现

- 源码：`C:/Users/30319/.codex/worktrees/fb99/plugins/story-world-v2`，分支 `codex/panel-status-cleanup`。
- 基线：前一份手机、记忆与调试交接的最终源码提交 `f4b20874f4518fe6f9c2c1a7bef174cbc02ad9f7`。
- 源码提交：`aeacf467dcbe204c6038a99bdd73bc2723c3c0d2`。
- 顶部状态行默认不占空间。模型数量、模型填入、同步结果等常规信息只留在「设置 → 调试」。
- 正在执行的操作、抽取块进度和警告仍展开显示；正常完成或收起窗口后重新隐藏。
- 移除模板里写死的自动推进提示，自动推进真状态继续由既有动作条负责。
- 未修改 CSS、引擎、提示词、世界书或真实模型配置；仅同步玩家可见构建号及其既有校验。

## 验证

- 全量：`F:/deepseek/tmp/leg179-full.log`；冒烟：`F:/deepseek/tmp/leg179-smoke.log`，均通过；读数见 `STATE.md` §1。
- 浏览器：`F:/deepseek/tmp/leg179/browser/report.json`，真实渲染器、模型列表控制器、状态栏和 CSS，覆盖两档桌面及手机。
- 复现截图中的模型列表成功提示，核验模型列表保留、顶部无提示及空白、调试页记录保留、进行中和错误仍可见。
- 浏览器截图已人工查看。网络使用测试替身，零真实模型调用。
- 本机安装位：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`。
- 本地安装提交：`fa3e47b7c8fa2997920cda54e32e2f48cc7ab7ad`。`F:/deepseek/tmp/leg179/install-verification.json` 确认源/安装跟踪文件逐字节一致，安装工作树干净；不推远端。
- 安装后浏览器：`F:/deepseek/tmp/leg179/installed-browser/report.json`，全部检查通过，零运行时异常。
- 安装后文档与知识索引守门：`F:/deepseek/tmp/leg179-installed-audit.log`，通过；仅保留既有 LEDGER 长行提示。

## 建议范围

优先考虑长剧情记忆质量实测、长任务取消与续跑、首次建世界的配置引导，以及关注人物的变化浏览。
这些只是供用户选择的方向，本次未增加任务、参数或机制。

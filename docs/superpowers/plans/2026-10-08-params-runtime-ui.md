# 参数页运行与注入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新手能直接看懂运行与注入每一项的用途，并能区分聊天送入世界和世界资料送入聊天。

**Architecture:** 在现有 renderParamsHtml 内重组运行子页，不改保存和注入机制。复用现有事件委托及原生 details，并给每项直接可见的短说明。

**Tech Stack:** 原生 JavaScript、HTML、CSS，Node test，Chrome CDP 合成浏览器验证。

## Global Constraints

- 只在 F 盘新任务工作树修改，从当前日常源复制现有未提交状态作为基线。
- 四块顺序：自动运行、聊天如何影响世界、聊天模型能看到什么、往事怎么找。
- 原参数名、值、控件 ID 与 data 接线保留；不改变默认值、上限、存储、检索或模型行为。
- 每项直接显示用途与影响；向量参数和正文名单放进默认折叠的高级设置。
- 不写真实世界、聊天或世界书，不调用真实模型，不推远端。

### Task 1: 重排与说明

**Files:** src/render.js、web/style.css、src/render-base.js、web/index.js；必要调整 test/render.test.js 与 test/retrieval-params-live.test.js 中失效的布局假设。

**Interfaces:** renderParamsHtml(world, { config }) 输入与返回 HTML 的接口不变；保留 autoAdvance、四个 data-inject-switch、五个数字输入和两个名单输入的原接线。

**实施发现的接线缺口：** web/model-channel.js 中补齐往事注入字数的既有输入范围与人话名称，表单根据已有 SETTINGS_FLOAT_KEYS 调用已有小数校验。test/model-channel.test.js 用真实表单委托先证红，验证合法值写入、非法值拒绝；相似度报错须说明可用小数，不能再声称只认整数。

- [x] 阅读设计及原 renderParamsHtml、injSwitch、paramHint、现有样式和渲染测试，核对各项实际作用。
- [x] 用真实渲染产物验证四块布局尚不存在，保存改前浏览器截图；低影响排版改动不增加镜像实现的字符串测试。
- [x] 按设计调整运行子页。说明贴近控件；数值 label 关联现有 ID；原生高级设置保持可编辑；输入框、按钮手机尺寸遵循现有 CSS 规范。
- [x] 升 PANEL_BUILD 为 leg207-params-runtime-ui，CSS_VERSION 为 20261008-leg207-params-runtime-ui，同步 test/render.test.js 的 CSS_PIN 版本和实际 SHA-256。
- [x] 调整原有测试的卡片取域和顺序假设以适应四块布局，保留值与语义验证；运行 node --test test/render.test.js test/retrieval-params-live.test.js test/web-param-panel-layout.test.js 并检查失败原因。
- [x] 自查只改约定文件；提交本次 UI 修改，详细报告写在证据目录 task-1-report.md。

### Task 2: 验证、合入与本地安装

**Files:** 证据目录浏览器/安装脚本；日常 docs、STATE.md、README.md 及现有生成索引。

**Interfaces:** 真实 renderParamsHtml 与 styles；真实 route/bindSettingsForm/set-param 接线；本地实际加载目录见 STATE.md §5。

- [x] 用浏览器真实模块与合成世界，在桌面与手机分别核对四块、控件现值、说明可见、键盘展开、控件接线和无横向溢出，留前后截图与 JSON 报告。
- [x] 独立审查本次差异；处理实质问题后复核。
- [x] 运行 node --test、node demo/smoke-demo.js、node scripts/build-kb.mjs、node scripts/audit-docs.mjs，记录真实输出。
- [x] 核对日常声明文件开工指纹；备份文件，仅复制此次修改，保留原未提交内容和日常 HEAD。
- [x] 安装前备份实际加载目录 Git 历史与原树，增量安装，运行全量和冒烟，逐字节及 HTTP 核验。
- [x] 更新 STATE.md、docs/work-current.md、README.md、docs/ledger.md 与日常交接，生成索引并执行最终文档守门；记录安装本地提交及未推远端状态。

# 观棋阅读布局实施计划

> 按任务顺序在本会话实施，每项完成后复核。设计来源：`docs/spec-panorama-reader.md`；用户已确认。

**目标：** 修复卡头挤压，扩大正文，并让地点、故事和事件可定位、可分辨。

**结构：** 渲染层提供稳定标识；组合器提供阅读控件；独立浏览器模块保存临时阅读状态。读数来自既有 DOM 和线状态，滚动恢复沿用现有模块。

**技术：** 原生 JavaScript、CSS、Node test、Chrome CDP；不安装依赖。

## 约束

- 开发使用现有隔离工作树，从 leg172 基线新建 `codex/panorama-reader` 分支。
- 不改引擎、账本、模型、提示词、分组归属和近期窗口。
- 样式更新同步 CSS_VERSION、CSS_PIN；可见变化同步 PANEL_BUILD。
- 文档归档到用户指定的 `F:/deepseek/plugins/story-world-v2/docs`。
- 本机预览延续提交子树导出、干净克隆快进的安装流程。

## 任务一：建立可复现的阅读验收

文件：新增 `test/panorama-reader.test.js`；浏览器装置放本聊天可视化目录。

- [x] 基线运行 `node --test`，确认原有判据通过。
- [x] 新测试调用 `panoramaQueryMatches('江州 万法阁 １级', '万法阁 1级')`，验证字面多词检索、全半角和零结果。
- [x] 用委托事件及 DOM 替换测试 `bindPanoramaReader(win).sync(scope, scroll)`：输入法、过滤、清空、地点定位、辅助区开关、同世界恢复和切聊天重置。
- [x] 在真实 Chrome 中喂长关系名单，断言地名可正常显示且卡片高度有限；在旧样式上记录失败。

## 任务二：地点、故事和事件的结构

文件：`src/panorama.js`、`web/page-compose.js`、`web/style.css`。

接口：故事节点使用 `data-pan-key`、`data-pan-live`；地点使用 `data-pan-place`；工具使用 `data-pan-search/location/unresolved/side/focus`，不进入引擎动作总线。

- [x] 把关系名单变为可换行的独立项，地点卡头改纵向结构。
- [x] `pointRows` 输出轮次列和事件内容列；重复来源说明集中到页内阅读说明。
- [x] 组合器保留原有主栏内容和附层顺序，在主栏外提供世界现状折叠与工具行。
- [x] 增强故事线边框、展开箭头、正文缩进和事件分隔；桌面盘算窄栏、窄屏单列，检查长文本。

## 任务三：阅读交互与刷新接线

文件：新增 `web/panorama-reader.js`；修改 `web/index.js` 两处刷新装配。

接口：`bindPanoramaReader(win)` 返回幂等的 `{ sync(scope, scroll), dispose() }`；`panoramaQueryMatches(text, query)` 返回布尔值。

- [x] 委托 input/change/click/composition 事件，检索只改变可见性和展开状态；刷新前读取实际展开属性。
- [x] 保留同世界查询、地点、未结筛选、辅助区、专注模式、稳定故事键和窄屏滚动。
- [x] 两处刷新传入聊天身份 `freshCtx()?.chatId` 和滚动快照，模块恢复阅读状态后调用既有滚动恢复。
- [x] 跑定向测试和浏览器交互检查，修复后记录先红后绿证据；补充空窗口与演员名单检索回归。

## 任务四：验证与本机交付

文件：`src/render-base.js`、`web/index.js`、`test/render.test.js`、`STATE.md`、`README.md`、`docs/work-current.md`、交接与索引生成物。

- [x] 升构建号和样式缓存号，更新既有版本及指纹期望，不放宽测试条件。
- [x] 用生产渲染截图检查桌面、窄屏、手机，以及专注和展开现状的状态。
- [x] 运行 `node --test`、`node demo/smoke-demo.js`、`node scripts/audit-docs.mjs`、`node scripts/build-kb.mjs`。
- [x] 独立代码审查，修复有效问题后重跑相应验证。
- [x] 提交源码，导出已提交子树到本机预览；核对全部跟踪文件，复跑部署目录测试和冒烟。
- [x] 将设计、计划和交接文档复制到 F 盘 docs 并逐字节核对，交付截图和刷新入口。

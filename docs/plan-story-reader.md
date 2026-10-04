# 世界近况与故事阅读 Implementation Plan

> **For agentic workers:** Use executing-plans and local-agent-commander. dsh contributed a renderer test draft and an independent review; Codex completed implementation and verified actual artifacts. The renderer assignment timed out before implementation, so ownership transferred after termination.

**Goal:** 把批准的世界近况和独立故事阅读草图接入观棋页面。

**Architecture:** 保留既有 `buildPanorama` 作为故事分组与阅读窗口的来源。新渲染器输出首页、各故事正文和人物地点说明；浏览器控制器在这些已有节点之间导航和筛选。现有组合器装入世界现状、盘算及地图。

**Tech Stack:** 原生 JavaScript、HTML、CSS、Node 内置测试、Chrome CDP；无新增依赖。

## Global Constraints

- 世界事实取既有账本和指针，程序不写新剧情、不替角色打分。
- `web/index.js` 仍 `<3100` 行，只更换版本号；绑定从既有阅读入口分派。
- 窗口沿用现有「往回看轮数」，一条故事只要被纳入就完整展示。
- 改样式同步样式版本及内容指纹；改可见页面同步构建号。权威读数见 `STATE.md` §1。
- 本机预览安装采用已提交子树导出和干净克隆快进，不推远端。

## Task 1: 故事数据与渲染（dsh 测试草稿，Codex 实现与验收）

**Files:** `src/story-reader.js`、`test/story-reader.test.js`。

**Interfaces:** `buildStoryReader(world, opts)` 返回故事模型；`renderStoryReaderHtml(world, opts)` 输出根节点 `data-story-app data-pan-world`。首页行 `data-story-row data-story-id data-story-live data-story-search`；正文 `data-story-detail data-story-id`；人物地点按钮 `data-story-context`，说明内容 `data-story-context-panel data-story-context-id`。

- [x] 先写有行为价值的测试，动态导入新模块并核对函数存在：
  ```js
  const module = await import('../src/story-reader.js');
  assert.equal(typeof module.renderStoryReaderHtml, 'function');
  ```
  在新模块不存在时，`node --test test/story-reader.test.js` 失败，记录输出。
- [x] 用 `buildPanorama(world, opts)` 的唯一线程列表构建首页，按有来源的最新轮次排序，保留完整正文和来源；避免从不同地点拼回重复故事。
- [x] 测试跨地点一条故事只出现一次；较早的起头随窗口内的新进展保留；关闭、无位置、人物名、HTML 字符和纪事进展都正确展示。
- [x] 跑 `node --test test/story-reader.test.js`，须失败为零，并交还实际文件与红绿证据。

## Task 2: 阅读交互与正式接线（Codex）

**Files:** `web/story-reader.js`、`test/story-reader-browser.test.js`、`web/panorama-reader.js`、`web/page-compose.js`、`src/render.js`。

**Interfaces:** `bindStoryReader(win)` 返回 `{sync(scope, scroll), dispose()}`；`bindPanoramaReader(win)` 遇到新根节点时转交新绑定，保留旧结构回退。

- [x] 使用委托事件的 DOM 装置先测试进入故事、返回、搜索恢复、同世界节点替换、切聊天与空窗口恢复；缺新绑定时确认失败。
- [x] `sync` 读取根节点的世界身份，对同聊天同世界恢复状态；不同身份清空状态。阅读位置使用 `captureScrollPositions` / `restoreScrollPositions` 的已有槽。
- [x] 控制器支持 `data-story-open`、`data-story-back`、`data-story-view`、`data-story-search-toggle`、`data-story-search-input`、`data-story-clear`、`data-story-world`、`data-story-context`、`data-story-close-context`、`data-story-jump`。
- [x] 组合器遇到 `data-story-app` 时把 `board.infoband`、`board.agendaStrip`、`board.side` 放进隐藏的世界查询区域；不重复追加正文。
- [x] 正式 `renderAll` 的 `panorama` 键调用新渲染器；旧 `renderPanoramaHtml` 导出仍用于已有格式回退与原数据行为测试。
- [x] 在新测试及原有阅读、窗口和接线测试通过后进入样式任务。

## Task 3: 样式、验收与本机预览（Codex）

**Files:** `web/style.css`、`web/index.js`、`src/render-base.js`、`test/render.test.js`、`STATE.md`、交接及生成索引。

- [x] 把批准草图的紧凑列表、单栏故事和按需说明接到生产类名；保留窗口滚动、手机触控和键盘焦点。
- [x] 更新构建号、样式版本和 SHA256 内容指纹。
- [x] 跑新功能测试、`node --test`、`node demo/smoke-demo.js`；全量通过后停止无依据的重复测试。
- [x] 用真实 Chrome 检查生产页面的桌面和手机截图、溢出、打开故事、返回、搜索、输入法、世界查询、刷新和空窗口；修复实际问题。
- [x] 用本机 dsh 独立复核改动，核对发现并修复实质问题。
- [x] 更新 `STATE.md` §1、交接、README 及知识索引，`node scripts/audit-docs.mjs` 通过。
- [x] 提交已验证源码；用既有预览装置导出当前插件子树，干净快进本机安装，逐文件核对；安装目录全量测试与冒烟通过后交付。

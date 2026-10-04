# 手机操作、可选向量、抽象来源与调试台 Implementation Plan

> For agentic workers: use local-agent-commander for the user's installed dsh; Codex integrates and verifies each deliverable. User approved execution in this chat.

**Goal:** 手机页签恢复宽度；向量明确选用且可补齐/回滚；抽象条目可选；调试信息集中可导出。

**Architecture:** 向量进度和来源校验独立于世界引擎；选择模块同时供所有读书口消费；调试记录器和显示器独立；入口仅装配。

**Tech Stack:** 原生JavaScript ESM、Node测试、IndexedDB、原生DOM/CSS、Chrome CDP。无外部依赖。

## Global Constraints

- 当前实现基线247aa0e；当前工作树C:/Users/30319/.codex/worktrees/d050/plugins/story-world-v2，分支codex/mobile-memory-console。
- 零真实模型调用，真实密钥不读不输出，原世界书和旧快照不修改。
- web/index.js保持<3100行；变更样式与玩家版面同步更新CSS_VERSION、CSS_PIN、PANEL_BUILD。
- 中文文件通过apply_patch或Node UTF-8处理，不通过PowerShell内容读写。
- 本机安装、暂不发布；新交接写F:/deepseek/plugins/story-world-v2/docs/。

## Task 1: 快照隔离与连续补齐

Files: src/vector-store.js, src/embed-orchestration.js, web/embed-runtime.js, web/embed-channel.js, web/settings-channels.js, web/snapshot-store.js；新src/vector-history.js；test/vector-history.test.js及现有向量回归。

Interfaces: 索引持久保存逐条来源摘要与coverage；运行时增加invalidate()，补齐循环只在开启时运行；getWorld/getVolumes/getScope现取；generation废弃过期异步结果。

- [x] 写回归：第30轮完成后停用至120轮，窗口起点71，重开必须补31..70；部分完成第70轮不许把连续指针跳过第31轮。
- [x] 写回归：恢复旧世界时索引中未来/不存在/同ID异文的行在候选排序前剔除；在途返回不可污染新世界。
- [x] 用node --test test/vector-history.test.js确认失败；按条目记录与连续边界实现，落盘后推进，失败保留重试；复跑向量族。
- [x] 整合快照失效动作、立即补齐、动态聊天和模型隔离；记录旧冷档无法证实的降级状态。

## Task 2: 默认关闭与完整关键词

Files: src/embed-client.js, web/embed-channel.js, web/settings-channels.js, web/inject.js, src/render.js, web/index.js；test/embed-opt-in.test.js。

- [x] 先断言`embedEnabled(readEmbedConfig({embedBaseUrl:"x",embedApiKey:"y",embedModel:"z"}))===false`并确认旧码失败。
- [x] 分离配置齐全与用户启用判断；probe/list保持显式操作，开启设置持久保存。
- [x] 注入器现取开关；关闭/切换时清缓存并废弃Promise结果，字面候选使用完整cap；失败/空向量也归还未使用容量。
- [x] 回归真实注入依赖：关闭零自动请求、旧缓存不注入、重开立即补齐、不重建世界。

## Task 3: 调试记录与设置入口（本机dsh独立文件）

Files: 新src/diagnostics.js、web/debug-console.js、test/diagnostics-console.test.js；Codex接入web/status-bar.js、web/index.js、src/transport-http.js、web/inject.js和渲染入口。

Interfaces: `diagnostics.record(module,level,message,data)`；`snapshot({module,level})`；`report(summary)`；`renderDebugConsole({summary,records,details})`；`bindDebugConsole(win,{getSnapshot,getSummary,onDetails})`。UI返回字符串，不把对象拼进innerHTML；report递归脱敏。

- [x] dsh先写脱敏/容量/筛选/HTML转义回归，观察失败，再实现独立模块。
- [x] 根代理接入状态、异常、网络调用元信息、注入和存储动作；详细正文缺省不采集。
- [x] 设置子页签新增调试；复制/下载/清除/详情开关由专用控制器处理，避免主入口膨胀。

## Task 4: 自选抽象条目

Files: 新src/abstract-selection.js、web/abstract-selection.js；src/init-source.js、web/book-source.js、web/index.js、src/render.js；test/abstract-selection.test.js。

Interfaces: `{mode:"default"|"custom",selectedIds:string[]}`；条目标识由来源书+uid组成；选择读取现有插件设置。过滤后的同一entry集合供正文、题名、声明、补抽及指纹使用，技术清理继续作用。

- [x] 回归选择一条/排除一条，未选题名不能补册，内置书不能绕过选择；默认逐字兼容。
- [x] 回归缓存：选中正文/题名变化失效，未选条目变化不影响有效指纹；补查/起根不能绕过。
- [x] 实现纯选择模块和DOM控制器，来源可分组/搜索/批量选择/预览；存量世界不自动重抽。
- [x] 明确新条目不自动纳入自选，消失条目提示，使用原来源读取契约。

## Task 5: 手机操作与文字整理

Files: settings.html、web/window-shell.js、web/window-actions.js（新）、web/style.css、src/render.js、web/index.js、src/render-base.js；test/window-actionbar.test.js、手机浏览器验证脚本在F盘tmp。

- [x] 手机菜单只显示一份有效世界动作，保持既有data-action路由；菜单退出/点击外侧/键盘关闭。
- [x] 手机页签整行横滑，桌面操作布局不变；剪掉重复解释，保留状态与错误。
- [x] 生成改前/改后390与桌面截图，检查横溢、点击、菜单、页签滑动、自选与调试子页签。

## Task 6: 审查、验收、本机安装与交接

- [x] 使用本机dsh只读审查最终diff；核实每条重要发现并修复。
- [x] node --test；node demo/smoke-demo.js；node scripts/build-kb.mjs；node scripts/audit-docs.mjs；刷新STATE/README唯一读数。
- [x] 复用仓外本机安装脚本，导出完整跟踪树，快进安装仓，验证文件一致与安装版测试/冒烟。
- [x] 新交接写F盘docs，记录源码/安装提交与验证日志，主工作树保持干净，报告未发布状态。

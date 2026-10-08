# 快照选择与调试信息实施计划

> 执行方式：本聊天内逐项实施，测试与审查后再合回日常 F 盘项目。工作树 `F:/deepseek/worktrees/snapshot-debug-usability/plugins/story-world-v2`；新交接只写日常项目。设计见 `docs/superpowers/specs/2026-10-07-snapshot-debug-usability-design.md`。

**目标：** 同轮快照可据内容选择，错误及排查信息及时进入调试台。

**架构：** 使用已有快照还原生成只读摘要；保留现有纯诊断记录器，在浏览器侧增加错误采集与订阅接线。

**约束：** 所有新文件住 F 盘；不变更快照保留数量和 IDB 版本；不改用户账或原快照；不推送。渲染变化升级面板构建，样式变化同步升级样式号；主模板未修改时不升其版本。

## 任务一：让快照可以辨别

- [x] 在 `test/snapshot-preview.test.js` 先复现同轮事件与位置变化不可见，并覆盖旧增量、断链、首份无比较基准、同内容和输入不变。
- [x] 在 `src/snapshot.js` 增加 `previewSnapshots(records)`，输出每条记录及 `preview: { headline, details, readable, comparedTo }`；调用 `restoreFrom`，以成功还原的前一份为比较对象，不生成或写回新快照。
- [x] `web/snapshot-store.js` 的 `snapshotList()` 返回带摘要的清单；恢复失败和读取失败写入诊断。
- [x] `src/render.js` 显示摘要、可展开详情及本地保存日期，明确不可读取状态；当前标记仍只取 `current`。相关布局在 `web/style.css`，同步版本。
- [x] 执行快照测试与真实接线回归，逐份恢复核对仍得到原世界。

## 任务二：让调试台聚焦排查

- [x] 在 `test/runtime-diagnostics.test.js` 先复现关窗噪声、外部异常漏报，测试 console 原方法、安装幂等与卸载、资源失败、订阅及脱敏。
- [x] `src/diagnostics.js` 增加 `subscribe(listener)` 并在记录/清空后通知；监听失败不影响记录。
- [x] `web/status-bar.js` 支持显式关闭状态日志，结构化记录自己的和外部未捕获错误；`web/window-shell.js` 在关窗时只更新状态。
- [x] `web/runtime-diagnostics.js` 负责可卸载的 console.warn/error 与资源错误采集；安装一次并保持原方法调用；提供诊断自身输出的防重入口。`web/index.js` 只接线。
- [x] `web/idb-backend.js` 取消通用成功消息；进度心跳只刷新 UI。`web/debug-console.js` 订阅更新且保留筛选与焦点。
- [x] 执行诊断、状态来源和浏览器接线回归。

## 任务三：合回并安装

- [x] 查看所有本次差异，确认仅覆盖声明的文件，保留日常项目原有改动。
- [x] 全量测试、合成冒烟、泛用性核对及真实浏览器桌面/窄屏展示；证据放 `F:/deepseek/tmp/snapshot-debug-usability-2026-10-07/`。
- [x] 同步 `STATE.md`、`docs/work-current.md` 与工程台账，生成知识索引并通过文档核验。
- [x] 备份当前本地安装后增量安装，安装目录测试、冒烟、文档与实际 HTTP 字节核对通过。
- [x] 新交接写 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-07-leg205-snapshot-debug.md`，报告实际效果与未覆盖的宿主现场验证。

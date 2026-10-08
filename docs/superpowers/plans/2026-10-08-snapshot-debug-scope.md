# 快照重复项与诊断范围实施计划

目标：用户无需选择完整或增量，相同回档结果只显示一次；调试台只收本插件。
设计：`docs/superpowers/specs/2026-10-08-snapshot-debug-scope-design.md`。
工作树：`F:/deepseek/worktrees/snapshot-debug-scope/plugins/story-world-v2`。按本聊天 inline 流程实施，当前已有授权继续优化并安装；不再次请求例行确认。

## 快照

- [x] 调整 `test/snapshot-preview.test.js`，先验证旧行为仍显示重复及具体内容，再覆盖 full/delta、当前原目标、历史 known、对象顺序、坏链及大数量。
- [x] `src/snapshot.js` 的 `previewSnapshots` 合并恢复等价项，生成 `diffCount`、同轮保存顺序，移除语义内容说明。
- [x] `web/snapshot-store.js` 的清单摘要只统计可见项；`src/render.js` 和 `web/style.css` 改为紧凑数量行，隐藏存储形式及细节；`web/index.js` 回档确认和结果不要求用户理解类型。
- [x] 同步 `PANEL_BUILD`、CSS 版本及指纹锁，执行快照/恢复接线相关测试。

## 诊断

- [x] `test/runtime-diagnostics.test.js` 和 `test/status-bar-error-scope.test.js` 先复现宿主/未知来源被误收，验证正例及后续调用栈反例。
- [x] `web/runtime-diagnostics.js` 统一 URL 与首个来源判据，console 仅采明确本插件来源，资源只采自身路径；保持原行为和卸载。
- [x] `web/status-bar.js` 只处理明确本插件异常，未知/宿主不再进调试台或由插件重复输出。
- [x] 相关与全量回归、冒烟；浏览器验证重复项只一行、紧凑数量以及宿主日志不出现、本插件异常仍实时到达。

## 合回与安装

- [x] 对照声明文件的开工前指纹，保留日常项目已有改动；独立审查后合回。
- [x] 更新 `STATE.md`、README、工作记录、台账及新交接，生成知识索引并核验。
- [x] 备份本地安装后增量部署，安装目录测试、冒烟、文档及实际 HTTP 字节匹配。
- [x] 交接只写 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-08-leg206-snapshot-scope.md`，给出刷新后的复测方式。

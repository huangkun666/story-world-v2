# 抽象输入优化实施计划

> 执行方式：当前聊天逐项实施，Codex 主做、本地 dsh 定向复核。使用 executing-plans 与 test-driven-development；用户已于 2026-10-03 批准优化提案并说“可以，开工吧”。

**目标：** 让明确的技术输入退出抽象，补抽口径一致，小书不接受书外名册。
**结构：** `src/abstract-source.js` 是无状态叶子模块，返回清理副本及排除记录。原条目探测继续保留声明依赖；所有送模型的抽象问法共用说明。
**技术：** 原有浏览器 ES modules、Node 内置测试，零新依赖。

## 约束

不修改世界书，不执行脚本，不猜语义，不新增数值阈值。使用明确协议标记与成对区块；界限不完整时保留并报告。保持原文属性。当前读数仅更新源码 `STATE.md` §1。新交接只放 F 盘 docs。本机预览须在验证后同步；不远端发布。

## 1. 输入与题名

- [x] 建立 `codex/abstraction-input-cleanup`，从当前已安装源码接续并运行全量基线。
- [x] 新增 `test/abstraction-input.test.js`，通过真实 `composeInitSource` 验证专用技术条目、混合脚本区块、原始声明取件、题名和技术改动指纹。
- [x] 先运行 `node --test test/abstraction-input.test.js`，确认上述断言在旧实现失败。
- [x] 实现接口 `prepareAbstractEntry(entry) -> {content, excluded, warnings}` 与 `prepareAbstractText(text) -> {text, excluded, warnings}`。按原书题名保留排除原因、移除字数；不改变入参。
- [x] 在 `normalizeEntry` 和角色卡片段出口使用该接口；题名名册排除明确技术来源；`probeBook` 仍读原书声明。再次运行上述测试及初始化源相关测试。

## 2. 所有抽象入口与小书校验

- [x] 用真实浏览器书源函数注入合成 ctx，检查单实体补查、独立起根、当前书指纹；为小书书外名字增加拒绝断言。
- [x] 先确认补抽和小书断言失败，再改 `web/book-source.js` 与 `src/abstract.js`。小书使用现有 `filterByBookEvidence`，题名依据按原合同保留。
- [x] 在 `src/abstract-shape.js` 定义共用 `ABSTRACT_FACT_RULES`，名册/属性/设定/刻度/起根/实体查书全部展开。运行新测试和抽象、起根、查书相关测试。
- [x] 将 `src/fp-hash.js` 的问法缓存版本升一，旧缓存不能命中新问法；不改模型通道、样式版本和世界推进。
- [x] 独立复核发现题名变更漏过缓存后，先复现旧缓存继续交回名册，再把未编入正文的有效题名纳入合订；指纹独立包含有效题名名号，防御上限截断时也不会漏掉。回归同时覆盖大小书缓存和浏览器换书指纹。

## 3. 验收与本机预览

- [x] 发起 dsh 只读复核并接管验收。两次任务都超时，没有完整审查结论；Codex 独立复现、验证部分日志指出的边界问题，补充回归后修正。
- [x] 运行多世界书零模型检查，只输出汇总：普通世界书内容保持原样，技术文本量减少，声明取件仍保留真实正文。该检查不代替真实模型效果测量。
- [x] 运行 `node --test`、`node demo/smoke-demo.js`；更新源码 `STATE.md` 与本次说明，再跑 `node scripts/build-kb.mjs`、`node scripts/audit-docs.mjs`。
- [x] 仅提交本次源码树。直接导出已提交插件子树，将干净的本机安装目录快进至该子树；临时取件引用随后删除，核对全部跟踪文件字节并在安装目录验证。
- [x] 写 F 盘交接与安装核对记录，报告验证结果、现存限制及刷新入口。最终结果见 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-03-leg176-abstraction-input.md`。

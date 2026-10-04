# 当前问题的召回与关键词排序 Implementation Plan

> 用户已授权开工；实现按本文在当前隔离工作区进行，结束时使用 requesting-code-review 做独立复核。本文随源码冻结，交付后的最终状态与提交、安装证据只看 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-03-leg182-recall-query-refresh.md`，未勾选的交付步骤不表示仍有待办。

**Goal:** 新问题不会使用旧查询的向量，有限预算优先装入命中更多关键词的记录。

**Architecture:** 查询所属信息由注入器在请求、完成和使用三处检查；现有异步召回继续后台执行。账本检索层提供只读的字面匹配排序，关键词模式与聊天预算选择共用它，排版仍保留时间顺序。

**Tech Stack:** 零依赖 JavaScript ES modules、Node 内置测试、SillyTavern 上下文注入口。

## 约束

完整设计见 `docs/superpowers/specs/2026-10-03-recall-query-refresh-design.md`。从上一棒最终提交继续，当前基线读数见 `STATE.md` §1。不得增加预算或等待阈值。测试证红只新增测试，不原地替换业务源码为旧版。不改 UI、CSS、提示词和世界数据。新交接只写 F 盘。

## 1. 先证红（已完成）

- [x] 在 `test/recall-query.test.js` 使用真实 `recallLedger` 与 `createInjector`，注入可控制 Promise 的假向量网络和假注入口。
- [x] 关键词用 `{tick:1,text:'alpha beta gamma'}` 与 `{tick:2,text:'alpha'}`，断言 `limit:1` 及有限字符预算留下前者；同分断言较新记录先行；名称模式单独使用仍新优先。
- [x] 聊天预算夹具放足量新的一词记录及一条旧的多词记录，查询三个词，断言旧记录进入 `INJECT_KEY_LEDGER`。另测名称优先认领同一旧记录时仍不会提前截掉它。
- [x] 向量夹具先得到商队记录，再发送退婚输入，断言立即移除旧内容、发起新查询；控制新 Promise 完成，断言自动重设注入。
- [x] 覆盖迟到、失败、相同查询复用、空查询、开关、聊天和世界身份变化、同对象回档。
- [x] 运行 `node --test test/recall-query.test.js`，保存 `F:/deepseek/tmp/leg182-recall-query/red.log`，核验失败来自上述旧行为。

## 2. 向量所属检查（已完成）

**File:** `web/inject.js`；接口保持 `createInjector(...)` 的入参与 `apply()` 同步返回契约。

- [x] 为每次准备保存 `{world,tick,chatId,characterId,groupId,text}`，其中 `text = sw2RecallQueryText(ctx,400,RETRIEVAL_PARAMS.depth)`。比较原有世界引用及逐个原值，不推测话题类别。
- [x] `prefetchVectors()` 先检查向量与召回开关、世界及非空查询。不同所属信息先 `clearVectors()`；相同信息复用当前请求。继续通过现有 `vectorRecall()` 获取网络结果。
- [x] 成功或失败回调只在请求代次及上述所属信息仍一致时处理；成功支持现有数组与 `{items}` 两种形状，成功后调用同步 `apply()`；失败清空并恢复字面额度，不抛出到发送流程。
- [x] `apply()` 使用缓存前再次核对所属信息，失配时整批清除。发送事件中先准备向量，再同步注入当前字面结果。
- [x] 运行向量回归和既有 `test/memory-lifecycle.test.js`、`test/tag-extract.test.js`，核验关闭及迟到隔离。

## 3. 关键词选择（已完成）

**Files:** `src/ledger-recall.js`、`web/inject.js`。

- [x] 导出只读的 `rankKeywordMatches(items,text)`，以 `keywordsOf(text)` 的不同词命中数降序、已有轮次降序、原输入顺序排序；返回新数组及原行引用。
- [x] `modeKeyword` 保留非零命中过滤，复用该排序；从 `MODES_SORTED` 中移出关键词模式。名称及最近模式保持原排序，向量保持相似度排序。
- [x] 聊天查询使用 `maxChars:null` 收集候选，再对名称与关键词去重后的候选调用同一排序；现有预算的两轮字面选择都沿用这份顺序。选完后仍按轮次升序排版。
- [x] 更新相邻注释，区别预算选择与输出排版。运行 `node --test test/recall-query.test.js test/ledger-recall.test.js test/tag-extract.test.js test/memory-lifecycle.test.js`。

## 4. 交付

- [ ] 独立 reviewer 只读复核工作区 diff、设计及回归，修复确认的问题。
- [ ] 无参 `node --test`、`node demo/smoke-demo.js`、`node scripts/build-kb.mjs`、`node scripts/audit-docs.mjs --check`、`git diff --check`。STATE 的当前值只在 §1 更新，其余引用它。
- [ ] 提交后从插件子树导出本机预览，安装位先检查干净，使用本地 fetch 与 `merge --ff-only`，核验文件清单和字节，再在安装位跑全量、冒烟及文档守门。
- [ ] 交接写 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-03-leg182-recall-query-refresh.md`，列源码和安装提交、验证路径及后台召回时机的限制。

# 新事件位置可选修复计划

> **For agentic workers:** 使用 test-driven-development 实施并按 verification-before-completion 验证；本次由当前 agent 连续执行，完成后使用 requesting-code-review 做独立只读审查。

**Goal:** 模型新提议的事件省略位置时正常保留和落账，不再因缺位置丢弃流言等合法事件。

**Architecture:** 沿用现有事件格式校验、逐条净化与结算。位置在模型提议和账本两侧均可省；写明时仍要求非空字符串，沿用自由文本和注解归一。没有位置时不补默认地点、不产生集外位置警告，编年只省掉事发地点短句，其他事件字段与因果继续保留。

**Tech Stack:** 原生 JavaScript ESM、Node test；零新增依赖。

## 授权与约束

- 用户 2026-10-04 明确要求「你先把刚刚说的小问题解决了吧」，落实此前「位置改成可选」要求。
- 仅修复新事件缺位置拒收。地图、道路、移动与消息传播设计不在本次实施范围；种账类别核对继续保留。
- 唯一实施目录为 C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2；安装到当前本机酒馆预览，不推远端、不修改已有聊天或世界书。
- 含中文文件用 apply_patch 修改。先在 F:/deepseek/tmp/leg190-optional-event-position/ 保存独立回归并跑旧源码证红，再将测试加入源码。

## 实施步骤

- [ ] 运行现有全量回归确认基线；独立回归覆盖缺位置校验、净化保留、单事件推进、真实 runTick、同轮盘算依赖、集外地点、非法来源及位置类型、提示词说明。
- [ ] `src/schemas/world-step.schema.js` 去掉新事件必填列表中的 position，保留填写时的非空字符串要求；`src/sanitize-step.js` 删除缺位置丢整件事件的过滤条件。
- [ ] `src/check-step.js` 先核对填写位置经归一后仍有非空地点，再只对实际位置归一与记录集外提示；净化同样拒绝填写空格或纯注解的非法位置，不给缺位置事件增加 undefined 键。`src/settle.js` 按存在性写位置，编年地点短句也按存在性生成。
- [ ] `src/prompts.js` 明确 newEvents[].position 可省，无法确定省略而不猜；同批更新 MAIN_PROMPT_V。更新账本侧旧注释和 test/schema.test.js 中与新要求相反的断言。
- [ ] 将独立回归以本地相对模块引用加入 `test/optional-event-position.test.js`；先跑针对性回归，再跑无参 `node --test` 与 `node demo/smoke-demo.js`。
- [ ] 完成只读复审，修正可操作缺陷；更新 STATE.md、docs/done-archive.md、docs/work-current.md 与构建号，运行 `node scripts/build-kb.mjs` 和 `node scripts/audit-docs.mjs`。
- [ ] 提交源码，从已提交子树导出本机预览提交并仅本地 fast-forward 安装；在安装目录验证回归、冒烟、文档守门、逐字节一致和两树干净。证据保留在本次 F 盘目录。

## 验收

用户贴出的流言事件在缺位置时正常进入第 1 轮事件账，其同轮盘算引用能成立；编年、包文本没有 undefined 或凭空的大营地点；缺位置不增加乱象地点数。非法来源、缺标题、填写为 null/数字/空串的非法事件仍被拒收，既有有效地点与集外地点规则继续通过。

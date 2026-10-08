# 抽取与载入可靠性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 实施用户批准的块大小设置、具体失败报告、无效请求停止、载入保护，以及追加的中止抽象与失败后可重试。

**Architecture:** 抽取参数和错误策略由抽取编排层管理；HTTP 层保留服务端事实；界面只保存设置、呈现记录。宿主接线用现有写账事务保护聊天范围。

**Tech Stack:** 零依赖 ES modules、Node 内建 test、SillyTavern 浏览器扩展。

## Global Constraints

- 唯一日常项目 `F:/deepseek/plugins/story-world-v2`；实施树 `F:/deepseek/worktrees/abstraction-reliability-2026-10-08/plugins/story-world-v2`。
- 子代理只准 `gpt-6.1-sol` 和 `gpt-6-luna`，禁止 Astra。
- 完整原文行不截断；超长行独立成块并提示。默认块大小仍由 `SETTING_CHUNK_CHAR` 定义。
- 禁止真实模型调用、改真实聊天/世界书、公开推送、升版本或发 Release。
- 不放松世界数据/角色保护校验，不额外模型核验；`web/index.js` 必须少于 3100 行。
- 先证红再实现；中文文件只用 UTF-8 文件工具或 Node，不用 PowerShell 读写。

## Task 1: 抽取核心、HTTP 与诊断

**Files:** `src/abstract-limits.js`, `src/abstract.js`, `src/transport-http.js`, `web/diagnostic-transport.js`, `web/debug-console.js`；新增/扩充对应行为测试。

**Interfaces:**
- 新增 `normalizeExtractChunkChars(raw)`，返回正安全整数，非法输入采用 `SETTING_CHUNK_CHAR` 的默认值；用户输入拒绝由设置层负责。
- `extractWorldSetting({... , chunkChars = SETTING_CHUNK_CHAR, signal = null})`；`timing.calls` 为真实请求次数，`timing` 包含实际块规模与并发事实，缓存匹配有效 `chunkChars`。
- `diagExtract(resolved, options?)` 保持原有可调用字符串返回接口；options 为 `{task, sourceChars, chunkChars, concurrency, signal}`，把 signal 传给 resolved.transport 的第二参数。
- `createHttpTransport` 返回函数兼容 `(prompt, {signal} = {})`；外部中止清理监听并报告用户中止，不误报超时；即使注入发送器忽略中止也要及时结束本次调用。
- 返回的抽取函数提供 `.finish(result)` 和 `.stats()`；有 options 时记开始/结束配置，无 options 的旧消费者行为保持。stats 至少包含 `calls`。
- HTTP 异常保留类型/状态/服务端拒因/结束原因，仍通过现有脱敏后入报告。

- [x] 写失败回归：小源调小也分块、大小值切换缓存失效、超长行完整/有警告；401/429不会瀑布重试、小书超时一次；真假调用计数、截断/过滤/HTTP详细错误可区分。
- [x] 跑新测试观察预期红；保存日志到 `F:/deepseek/tmp/abstraction-reliability-2026-10-08/`。
- [x] 实现上述接口；非暂时性请求错误停止后续新请求并返回失败，不落新世界。已有并发在飞请求不计为取消。有限网络重试耗尽后不递归拆半。
- [x] 保留返回空/非法JSON等内容级已有拆分语义；明确上下文错误码可以拆小，其他请求拒绝不可猜成内容问题。
- [x] 中止信号覆盖调用前、在飞HTTP、重试等待、递归/并发队列与缓存提交前；中止结果为 `{ok:false,cancelled:true}`，不写部分成功缓存；同函数下一次无 signal 的调用不受影响。
- [x] 跑对应测试及全量测试，自检旧断言的真实契约；必要的旧失败语义更新须在报告解释证据。只提交本任务文件。

请求计数验收示例：

```js
let calls = 0;
const r = await extractWorldSetting({ sourceText: Array.from({length: 40}, (_, i) => `row${i}:` + 'x'.repeat(1000)).join('\n'), concurrency: 1,
  extract: async () => { calls++; throw Object.assign(new Error('HTTP 401'), { status: 401 }); } });
assert.equal(r.ok, false);
assert.equal(calls, 1);
assert.equal(r.timing.calls, calls);
```

## Task 2: 设置界面

**Files:** `web/model-channel.js`, `src/render.js`, `settings.html`, `web/window-shell.js`；设置保存、渲染、完整/回退操作区行为测试。

**Interfaces:** 新增 `extractChunkCharsOf(settings)`，用 Task 1 的归一化返回有效字符数；数字写通道键 `extractChunkChars`、显示名“抽取每块字符数”。

- [x] 写并跑红测试：默认现值、正整数持久化、非法/小数/超安全整数拒绝；HTML框的 data-settings 和默认值真实存在。
- [x] 接入现有数字设置写通道，框放“同时问几块”附近，文案说明字符非token、完整行超限提示、小块不保证总耗时更短、只抽刻度不使用本项。
- [x] 连通成功说明没有验证正式JSON参数。跑模型通道与渲染测试；只提交本任务文件。
- [x] 窗口操作区和回退窗口都新增 `data-action="cancel-extraction"` 的“中止抽象”按钮，初始禁用；Task 3 的任务hub根据真实运行状态同步 disabled/aria-disabled，不复制一份忙碌状态到渲染层。

验收示例：

```js
assert.equal(sw2NormalizeNumericSetting('extractChunkChars', '10000'), 10000);
assert.equal(sw2NormalizeNumericSetting('extractChunkChars', '1.5'), null);
assert.equal(sw2NormalizeNumericSetting('extractChunkChars', '9007199254740992'), null);
assert.equal(extractChunkCharsOf({}), SETTING_CHUNK_CHAR);
```

## Task 3: 宿主接线与载入保护

**Files:** `web/index.js`、`web/extraction-actions.js`、`web/extraction-progress.js`、`web/extraction-task.js`、`web/hot-ledger.js`、`web/book-rebaseline.js`、`web/diagnostic-transport.js`、`src/seed-roots.js`、`web/seed-roots-wiring.js`、内部面板构建号及对应回归。后两项补足起根阶段中止与止损；热账改动补足空聊天保存中止后的回滚；诊断统计贯穿整项任务。

**Interfaces:** 消费 Task 1/2 的 `chunkChars` 参数、`extractChunkCharsOf(settings)`、`diagExtract(resolved, options).finish(result)`；长任务复用 `createWorldWriteGuard`。

- [x] 写红测试：假IDB挂起A载入→切B→恢复，B世界保持原值；同聊天乱序返回不得旧载入覆盖新载入；初始化等待切聊天不落账。
- [x] 捕获聊天与任务版本，所有异步返回和写账前检查；让已有轮转事务检查也实际工作。保持现有热账保存/参数逻辑。
- [x] 初始化和只重抽设定传真实块大小、并发、源规模和模型到同一份抽取函数；失败/异常/完成都记录 `.finish`；进度计时器在 finally 清理。
- [x] 三个抽象入口复用一个任务控制器/任务hub，运行时拒绝并行的新抽象；中止按钮 abort 当前任务，切聊天也 abort；下一次运行创建新控制器。
- [x] 用户中止不写热账/缓存，不被起根“失败照常开局”的兜底吞掉；所有中止/失败/成功/抛错都释放抽象忙闩、进度、旧提示和按钮状态。用假 ctx 真点击后连续重试验证。
- [x] 避免旧任务失败提示覆盖新聊天状态，避免新世界保存期间切聊天；不得将请求停止等同于已发请求取消。
- [x] 运行新回归、初始化/只重抽接线/热账保存/布局测试，确认行数限制；只提交本任务文件。

载入验收使用生产 `loadWorld`、可控 `indexedDB.open`/事务完成事件和动态 `window.SillyTavern.getContext`，观察真实 `updateChatMetadata` 的目标聊天；禁止测试另抄一份载入函数。

## Task 4: 整合、审查与本地安装

**Files:** 社区指南/FAQ/README、STATE 当前读数与当前工作、生成索引、F盘交接与证据。

- [x] 同步两份文档到最终按钮和错误行为，保留未验证模型/宿主兼容范围。
- [x] 完成全量测试、50轮合成冒烟、语法检查；更新当前权威读数，重新生成索引并跑文档守门。
- [x] 生成本分支完整 diff 文件，派 6.1 Sol 独立审查规格符合性与代码质量；处理所有实质问题并复验覆盖测试。
- [x] 备份原安装树/历史，在安装位工作区干净且原版本符合基线时增量安装；不把开发历史或私人数据推上远端。
- [x] 安装树与源码核对字节；运行安装树测试/冒烟，必要时本机只读HTTP核验。合回日常项目并保留原文档改动。
- [x] 在 `F:/deepseek/plugins/story-world-v2/docs/` 写交接，报告结果、限制与未发布事实。

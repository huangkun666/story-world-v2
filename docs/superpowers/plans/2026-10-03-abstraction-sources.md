# 抽象来源和抽取入账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能控制全部实际读取来源及正文，并消除后处理误判归属和丢失已抽取数据的问题。

**Architecture:** 浏览器只收集原始来源，纯函数统一计算生效内容，所有抽取和补资料入口共用该结果。模型判断实体语义，程序核对出处与格式并完整保存，禁止将局部名单、关键词或名字包含当作事实。

**Tech Stack:** 原生 JavaScript ES modules、Node 内置测试、浏览器原生 DOM 和现有 SillyTavern 接口；零新增依赖。

## Global Constraints

- 完整需求以 `../specs/2026-10-03-abstraction-sources-design.md` 为准，用户已批准，执行期间不再要求重复批准。
- 当前源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`；基准提交 `fb28fd6b6bd639ea47b3d08b9d542076a41957ea`。
- 原世界书和角色卡只读；真实聊天账不改；不自动执行真实模型请求或推远端。
- 新交接仅写 `F:/deepseek/plugins/story-world-v2/docs/`，遵守 AGENTS.md。
- 中文文件仅用编辑工具或 Node 按 UTF-8 读写，不用 PowerShell 读写。
- 当前构建、测试读数、版本规则与入口行数限制只见 `STATE.md` §1；源变更须更新知识索引与文档守门。
- 先写真实数据流回归并观察预期失败，再改生产代码；既有断言口径变更必须有先前失败和新需求依据。
- 单次只派一个实施代理；审查只读。阶段报告及证据保存到 `F:/deepseek/tmp/leg185-abstraction-sources/`。

## Task 1: 完整来源与统一实际取料

**Files:**
- Create: `src/abstract-input.js`、`test/abstract-input.test.js`。
- Modify: `src/abstract-selection.js`、`src/init-source.js`、`src/abstract-source.js`、`web/book-source.js`、`web/index.js` 取料接线。
- Test: `test/abstract-selection-wiring.test.js`、`test/abstraction-input.test.js`、`test/init-source*.test.js`、`test/web-book-source-layout.test.js`。

**Interfaces:**
- `collectAbstractSources({ worldInfoEntries = [], character = null, worldSources = null })` 返回完整来源项目数组；世界书原条目和角色卡四项正文各自有稳定身份。
- `resolveAbstractSources({ sources, selection })` 返回原文、读取方式、选段验证、清理后的项目以及诊断；不得修改调用方对象。
- `composeInitSource(...)` 保持现有返回字段，并增加 `sourceItems`、`effectiveEntries` 与生效原因；`text` 是最终读取预览及抽取共用原文。
- 项目有来源身份、题名、原文、禁用/技术/空状态；UI 可使用 `entrySelectionId`；选择的读取方式支持 `auto`、`full`、`segments`，选段含原文位置与原文核对信息。
- 旧自选世界书配置保持原选项及原有卡片正文含义；新配置能明确排除所有卡片正文。未选原文不参与补查、起根、兜底与指纹。

- [ ] **Step 1: 写失败回归。** 用启用、禁用、空正文、不同来源相同正文及角色卡四项正文组成夹具，断言完整清单与勾选后的实际输入。

```js
const sources = collectAbstractSources({ worldInfoEntries: entries, character: card });
const picked = { mode: 'custom', selectedIds: [entrySelectionId(disabled)], reads: {} };
const result = composeInitSource({ worldInfoEntries: entries, character: card, selection: picked });
assert.ok(result.text.includes(disabled.content));
assert.equal(result.text.includes(unselected.content), false);
assert.equal(result.text.includes(card.description), false);
assert.deepEqual(entries, originalEntries);
```

- [ ] **Step 2: 运行红灯。** `node --test test/abstract-input.test.js test/abstract-selection-wiring.test.js`；失败应针对未实现行为，修正夹具或导入错误后再继续。
- [ ] **Step 3: 实现纯来源计算与接线。** 只收集一次清单，按明确选择生成副本。自选禁用条目克隆为允许读取，不改原禁用标记；角色卡正文使用独立身份；选段与原文不匹配时标失效，不回退全文。默认声明取件保留合法路径；初始化结束返回实际生效条目，`autoComposeSource` 不再用原始条目覆盖它。缓存、继承、补查和起根全部经同一入口，不重新清理已处理正文。

```js
const composed = composeInitSource({ character, worldInfoEntries, selection });
return { ...composed, worldInfoEntries: composed.effectiveEntries };
```

- [ ] **Step 4: 验证绿灯与完整数据流。** 运行上述针对性测试及全部取书/初始化回归；新行为下需要改变的结构断言保持真实接线验证，不删掉覆盖点。报告 UI 需要的确切项目与选择接口。
- [ ] **Step 5: 提交并报告。** 提交本阶段生产与测试文件；报告写 `task-1-report.md`，包含红绿证据、接口、命令输出及兼容说明。

## Task 2: 来源页面、正文选段与批量操作

**Files:**
- Modify: `web/abstract-selection.js`、`web/panel-tools.js`、`src/render.js`、`web/style.css`。
- Create: 必要的独立来源编辑 UI 模块；职责与主选择器分开，模块顶层不访问 DOM。
- Test: `test/abstract-selection.test.js` 及新的实际操作回归。

**Interfaces:**
- 使用 Task 1 完整来源清单与实际取料结果，不复制一份 UI 取料算法。
- 保留既有 `[data-source-picker]`、`[data-source-entry]` 和搜索钩子；扩展读取方式、选段和预览动作。
- `bindAbstractSelection` 的写回仍走现有插件设置接口，保存选择和原文选段。

- [ ] **Step 1: 写失败回归。** 实际点击取消禁用后仅当前结果内的禁用项取消；隐藏的勾选保留。按来源选择不会选到同号的另一来源。卡片正文独立取消、多选段保存与恢复、重读后的选段失效可见。

```js
clickAction(root, 'exclude-disabled');
assert.equal(visibleDisabled.checked, false);
assert.equal(hiddenDisabled.checked, true);
assert.equal(visibleEnabled.checked, true);
```

- [ ] **Step 2: 运行红灯。** `node --test test/abstract-selection.test.js` 及新增操作测试，记录预期失败。
- [ ] **Step 3: 实现页面。** 桌面列表/正文两栏，手机顺序展开；列出原始来源所有行。顶部简洁批量菜单含全选、取消、反选、取消禁用、取消技术、取消空正文；组头支持来源整组操作。默认和自选明确分开，每条支持自动清理、全文、多个原文选段。最终原文预览复用 Task 1 计算。动态输入保留焦点，HTML 转义及键盘操作沿用原规则。
- [ ] **Step 4: 验证绿灯与浏览器。** Node 操作回归通过后，以真实生产渲染、桌面和手机宽度验证搜索、批量、选段、预览、重开恢复和页面无横向溢出。原书副本渲染前后深比较一致。
- [ ] **Step 5: 提交并报告。** 提交 UI 和测试；报告写 `task-2-report.md`，给出浏览器验证入口与证据位置。版本号留到 Task 4 统一更新。

## Task 3: 抽取确认和完整入账

**Files:**
- Modify: `src/abstract.js`、`src/schemas/ssot.schema.js`、别名搜索与实体解析的实际消费者。
- Create: 必要的小型抽取依据处理模块，避免扩大入口文件。
- Test: `test/seed-full.test.js`、`test/roster-merge.test.js`、`test/abstract-chunk.test.js`、抽取完整数据流回归。

**Interfaces:**
- 只核对 Task 1 实际允许的文本；抽取输出包含对应来源及原文依据，未核实结果具有诊断去向。
- 旧账、固定响应回归与新抽取契约明确区分；未提供新证据不能被假标为已核实，也不能因列表缺席误判为反驳。
- 类别、别名、属性、归属在抽取→清理→合并→实体转换→搜索之间保持清楚的数据去向。

- [ ] **Step 1: 写失败回归。** 正确归属在添加普通括注字段、部分成员名单后保留；包裹题名仅作候选；缺类别不被默认为角色；已确认别名保存并可解析；不同类别同名不被自动合并；仅名字包含不能建立上级。

```js
const world = seedKnownExtraction(correctClaim, factionWithProseFields);
assert.equal(world.entities.find(e => e.name === '月野兔').parent, '科学团');
assert.deepEqual(world.entities.find(e => e.name === '月野兔').aliases, ['水手月亮']);
```

- [ ] **Step 2: 运行红灯。** 针对性生产函数回归失败并与已复验现象对应；证据写报告。
- [ ] **Step 3: 实现语义分工。** 模型提示明确人/势力/地点、别名与归属的原文依据；程序只核实际来源与结构。移除名单缺席、正则成员和名字包含直接建立或删除关系的路径，保留定位用途。类别未确认候选进入诊断而非默认造实体。别名落实体为可选兼容字段，搜索与解析复用。关系边不增加常驻出处章。冲突与证据不符有记录，不静默先到先得；规模原话不造人。
- [ ] **Step 4: 验证绿灯。** 运行相关抽取、落账、搜索和旧世界测试；对同一事实的多种排版做完整生产流程对照。模型未实测的质量不宣称已验收。
- [ ] **Step 5: 提交并报告。** 提交代码和回归；报告写 `task-3-report.md`，列出改变的既有规则及对应原始失败证据。

## Task 4: 整体审查、版本、验证、本机预览和台账

**Files:** `src/render-base.js`、`web/index.js` 既有版本定义、必要的提示词/抽取缓存版本、`STATE.md`、生成索引；F 盘交接与独立预览装置。

- [ ] **Step 1: 整体审查。** 用基准到当前的完整 diff，请独立 reviewer 检查批准设计、批量操作和所有数据边界；修复重要问题并验证。
- [ ] **Step 2: 版本与全量验证。** 根据实际样式、可见页面、抽取问法与缓存变化更新对应版本。`node --test`、`node demo/smoke-demo.js`、`node scripts/build-kb.mjs`、`node scripts/audit-docs.mjs`、`git diff --check` 全部核对；当前权威读数只更新 `STATE.md` §1。
- [ ] **Step 3: 本机预览。** 参考 `F:/deepseek/tmp/leg184-roster-label/install-local-preview.mjs` 创建本阶段独立导出装置，固定上一安装提交，验证源码和安装位干净并快进本机安装。安装位独立运行全量与冒烟，核对全部跟踪文件字节；不推远端。
- [ ] **Step 4: 台账与交接。** STATE 写真实最终行为与限制；新交接写 F 盘指定目录，索引同步；证据保存在本阶段临时目录。
- [ ] **Step 5: 收尾。** 报告功能、批量操作、验证及刷新方式；保留开发分支，避免发布或合并私有主仓。

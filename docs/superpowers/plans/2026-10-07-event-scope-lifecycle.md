# 事件范围与持续条件实施计划

> **For agentic workers:** 使用 subagent-driven-development，按任务实施、审查和验证；用户已于本轮明确授权实施并安装本地测试版，无需再次询问是否开工。

**Goal:** 全校公告等群体事件保留完整范围，无需列全体角色；已完成事件产生的持续条件独立保存，并可通过合理获知途径引出人物行动。

**Architecture:** 聊天协议与世界 JSON 都经统一事件结构和条件登记函数落账。范围仅凭明确身份与成员关系核对，保留原话和历史确认结果；公开范围不作知情名单。现有历史、来源过滤、事务保存和行动保护继续承重。

**Tech Stack:** 零依赖 JavaScript ES modules、Node 内置测试、SillyTavern 本地扩展。

## 全局约束

- 细案：`F:/deepseek/plugins/story-world-v2/docs/superpowers/specs/2026-10-07-event-scope-and-lifecycle-design.md`。用户本轮原话：“可以，开工吧，之后安装在本地我测试下质量”。
- 日常入口仍为 F 盘；开发树 `F:/deepseek/worktrees/event-scope-lifecycle/plugins/story-world-v2`，集成回日常入口后安装。已有未提交文档保留。
- 无逐人知情账、传播接收流水账、自动传播、故事日历推算、关键词语义判定、新数量限制。
- 新协议明确声明 4；旧 v3 与旧协议继续读取，新旧事件字段不混用。范围缺席表示未声明，原文不替换成臆测成员。
- `affected` 是影响/适用范围，`audience` 是公布/传递范围；两者不混同，后者不能认定所有人知情或行动。
- 已完成事件与条件 `planned/active/ended` 分开。条件创建和变更有真实事件原因，旧文本不覆写，旧条件结束后不能激活。
- 不改真实世界书、聊天或世界账，不调用真实模型。结构验证与用户后续模型质量测试分开。
- 当前读数只写 STATE §1；源码/文档改动后重建知识索引并跑文档守门。只安装本地，不推远程。

## 任务 1：统一事件与条件落账、世界输出契约

**Files:** 新建 `src/event-contract.js`；修改 `src/schemas/ssot.schema.js`、`src/schemas/world-step.schema.js`、`src/check-step.js`、`src/sanitize-step.js`、`src/settle.js`、`src/gate.js`、必要的 `src/ref-rules.js`；测试 `test/event-contract.test.js` 和既有结算/契约测试。

**Interfaces:**

```js
export const EVENT_PROTOCOL = 4;
export function eventDetails(event); // 复制 category/actors/affected/audience/reportedContent/eventProtocol 等明确新字段
export function eventEntityIds(event, world); // 旧 ripples，或新 actors + 历史确认的 affected；不含 audience
export function eventDetailText(event); // 类别/当事人/影响/公开原文的简短中文说明，不猜测
```

`event-contract.js` 还统一提供新事件字段结构核对、范围确认和条件创建/变更函数。范围为 `{kind,text,ref?}`，kind 为 entity/members/place/text；模型不能填写 resolution。成员只依据已有 parent/branch 关系；事件入账确认部分保存 `resolution:{knownIds,asOfTick}`，不改历史；条件范围按当前关系解释。

- [x] 先在 `test/event-contract.test.js` 写公告无当事人、影响/公开分开、未知原文保留、部分成员、历史成员不回填、无协议与混合字段拒绝、条件因果与状态流转测试。
- [x] 运行 `node --test test/event-contract.test.js`，确认新行为未实现而失败。
- [x] 实现上述共同函数及 schema 新可省字段。世界新事件需 pending boolean；七必填组不变；conditionUpdates 仅在声明新协议时允许。
- [x] 结算创建新事件时保存明确字段和 closed 状态，聊天关联变化/承诺仍共用结果；v4 当事人缺席合法，单事件继承自己的时间。条件创建/变更通过共同入口登记，坏条件逐项诊断。
- [x] 新 eventProtocol、newEvents 条件引用走现有同轮事件引用规则，净化删掉事件时同步修正条件引用，不能错绑另一件事。
- [x] 解除静默只依据明确当事人、已核对影响对象、在办事项或本轮合法因果反应；不把公开范围、文本“全体”当名单。新范围不展开 ripples，也不计为已行动。
- [x] 运行 `node --test test/event-contract.test.js test/schema.test.js test/settle.test.js test/chat-results.test.js test/gate.test.js test/ref-rules.test.js`，自审并提交任务文件。

## 任务 2：聊天协议与注入规范

**Files:** 修改 `src/tag-extract.js`、`web/inject.js`；新建 `test/tag-event-scope.test.js`，必要的既有规范断言随协议升级修改。

**Interfaces:** `extractTags(text,ctx)` 保持现有行动/变化/承诺形状，新增可省 `references`、`conditionUpdates`、`conditionsBad`；`events` 新协议项携带 `category/actors/affected/audience/at`，pending 必填，不用 participantIds 表达新范围。

```js
// v4 facts.events
{ localId: 'E1', title: '公开规则', pending: false,
  affected: [{kind:'text',text:'全体学生'}],
  audience: [{kind:'text',text:'全体学生'}], at: '08:15' }
// v4 facts.conditionUpdates
{ op:'create', localId:'C1', eventRef:'E1', statement:'规则原文', state:'planned' }
{ op:'state', conditionRef:'cond_1_1', state:'active', eventRef:'E2' }
```

- [x] 先写 `test/tag-event-scope.test.js`，覆盖三格事件、关联标签前后顺序、多项范围、未知对象、引用无新事件、条件时间/替代、坏协议不降级、两事件不同时间与地点、v3 不变、获知只写行动。
- [x] 运行 `node --test test/tag-event-scope.test.js` 证红。
- [x] 新增标签：类别、当事人、影响范围、公开范围、引用、持续条件、条件范围、条件时间、条件变更、替代条件。关联在扫描后按编号汇总；每结果使用前面最近此刻/场景；坏关联留拒绝诊断。
- [x] 注入规范输出协议 4 的完整小例子；区分动作、结果、义务、持续条件、影响、公开。普通获知途径写行动；重要泄密作为因果结果；重提用引用；错误公告只记发布说法。
- [x] `buildInjections` 将有效/尚未生效条件按 ID 只提供一次；不得因此复述聊天提交的公告。必要条件 ID 提供给模型可明确引用结束/替代。
- [x] 运行 `node --test test/tag-event-scope.test.js test/tag-extract.test.js test/chat-results.test.js test/streams.test.js test/leg198-hygiene.test.js`，自审并提交任务文件。

## 任务 3：输入、归档、保存与展示贯通

**Files:** `src/tick.js`、`src/pack.js`、`src/world-input.js`、`src/prompts.js`、`src/storage.js`、`src/snapshot.js`、`src/chronicle-brief.js`、`src/ledger-recall.js`、`src/panorama.js`、`src/story-reader.js`、`src/render.js`、`src/render-base.js` 及相应测试；任务 1 拥有的结算归档处通过协作完成，避免同时修改。

- [x] 先写 `test/event-scope-integration.test.js`：真实 runTick 输入一次公告、独立 actedIds、条件原因归档后仍进输入、聊天来源过滤、导出导入/快照/热账重载、范围在读者/召回/展示保留、实际成员变化只更新条件当前匹配。
- [x] 运行 `node --test test/event-scope-integration.test.js`，确认缺失接线失败。
- [x] turnFacts.events 使用共同详情复制函数，去重仍按 ID。引用已有事实进入世界理解但不新建事件；持续条件进入世界输入和聊天当前状态，保存保留 ended 历史。
- [x] schema 热账/导入验签/快照路径保留条件；事件归档完整保留明确字段及历史范围确认。归档后的因能核对，不因归档丢条件。
- [x] pack 为 planned/active 条件留完整条文；超预算只整条取舍并留裁剪诊断，不半截条文，沿原整包预算。
- [x] MAIN_PROMPT 输出 eventProtocol 与 v4 范围/条件说明，取消通过长波及名单表达群体或知情；普通反应的合理途径在 note。按规则升 MAIN_PROMPT_V。
- [x] 全景事件详情显示类别、当事人、影响范围、公开范围；仍有效条件可在现有页面查看。读者点名用共同 eventEntityIds，不把群体原文当人物；新构建号可见。不新增 CSS 时不升 CSS_VERSION。
- [x] 运行相关集成/召回/展示/保存测试和全量 `node --test`；模块计数/导入图等结构锁按真实新增模块更新，并保留它们的约束。

## 任务 4：审查、集成与本地安装

- [x] 独立审查细案逐项覆盖与最终 diff，修正重要问题，运行覆盖修复的测试。
- [x] 跑 `node demo/smoke-demo.js` 和泛用性审计；泛用性脚本传入真实世界书目录，只读，不碰用户账。
- [x] 提交开发树；以本次任务文件集成回日常 F 盘入口，避免夹带原未提交文档。更新 `docs/work-current.md` 保留用户原令并补本次原令，STATE 当前读数与交接。
- [x] 读既有本地预览安装脚本，复用其备份、仅运行文件拷贝和本地提交方式；部署目标 `F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，不推送。
- [x] 安装前备份旧部署，安装后逐字节比对 manifest/src/web，运行安装目录测试与冒烟，并核对酒馆实际 HTTP 返回的新规范和构建号。
- [x] 跑 `node scripts/build-kb.mjs`、`node scripts/audit-docs.mjs`；交接写入日常入口 docs，说明结构验收证据及用户尚需测试的实际模型质量。

## 计划自审与进度

细案 §4–8 对应任务 1/2；§9 保存、归档与来源约束对应任务 3；§10 情景测试对应各任务测试；§11 排除项为全局约束。未添加新的数值配额。协议与条件接口在任务间保持上述形状。

- 基线：全量测试通过，日志在 `F:/deepseek/worktrees/event-scope-lifecycle/baseline-tests.log`。
- 任务 1、任务 2、任务 3：已实现，独立审查发现的问题补回归并修复。
- 任务 4：最终独立审查 Approved；已合入 F 盘日常入口并安装酒馆本地。安装目录测试、冒烟和实际 HTTP 字节核对通过。当前读数见 STATE.md §1；安装证据和备份在 F:/deepseek/tmp/event-scope-local-preview-2026-10-07/。真实模型输出质量由用户试跑。

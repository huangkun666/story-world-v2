# 地理关系与地图弹窗实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 世界源的地理关系进入当轮演化输入，同一份数据在独立地图弹窗中展示；已有世界可单独补抽地图。

**Architecture:** 在冻结设定中增加可选 geography，抽取与查询各自独立，主页面只留地图按钮。使用既有来源核验、世界保存与快照，地图不制造位置或路程，不改变事件可省位置及玩家禁写规则。

**Tech Stack:** 原生 JavaScript ESM、Node 内置测试、HTML/SVG、现有 SillyTavern 传输与持久化适配。

## Global Constraints

- 源码只在 `C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2` 实施；不覆盖 F 盘原开发分支。
- 地点关系首版只有 within、adjacent、passage；未知方向不默认双向；原文条件保留文本。
- 不新增第三方依赖，不运行真实模型调用，不改用户已有聊天或世界书。
- 缺地图旧世界合法；位置自由文本、表外位置及缺位置事件继续正常接收。
- 原文引用只进既有诊断，不落世界账；复用本次允许来源和作用域核验。
- 人物位置、事发地点、行动地点和波及名单不混用；结构推导与来源未载必须外显。
- 地图按钮打开挂在 document.body 上的弹窗；关闭、遮罩、ESC 与焦点恢复可验证。
- 有用户授权，连续完成实施、复审、验证和本机预览安装，无需再询问执行方式。
- 子任务只编辑各自拥有的文件，不提交、不安装、不修改共享台账；控制者统一整合提交。

## Task 1: 地理契约与查询

**Files:** 新增 `src/geography.js`、`src/schemas/geography.schema.js`、`test/geography.test.js`。

**Interfaces:**

```js
resolvePlace(geography, value) // { status: 'matched'|'ambiguous'|'unmapped', place, candidates }
buildMapData(world) // { generated, places, links, unlocated: { entities, events } }
geographyPack(world, { moveFact = null } = {}) // compact facts object or undefined
// geography.schema.js exports geographySchema and GEOGRAPHY_VERSION = 1.
```

places 记录 `{id,name,aliases?}`，links 记录 `{from,to,type,via?,direction?,condition?}`。地图投影可增加派生 children、parents、entities、events 和来源显示；不得把这些投影写回冻结层。未匹配位置作为关系未载的观察记录，重名保持歧义，不靠包含字符串匹配。已确认同名占位词地点先匹配真实身份，历史占位值不制造位置。

- [ ] 写行为测试并证红：三层包含、确认别名、重名歧义、多重包含、缺地图、未定位、来源区别和通道方向。
- [ ] 用 `node --test test/geography.test.js` 验证失败来源是缺失的行为。
- [ ] 实现上述查询及可选 schema；不调用模型，不读 DOM。
- [ ] 同一命令转绿并自审输入不变性与缺资料退化行为。

## Task 2: 来源抽取与补抽服务

**Files:** 新增 `src/geography-extract.js`、`test/geography-extract.test.js`；修改 `src/abstract.js` 及其相关测试。不得编辑 Task 1、Task 3 或主控制者文件。

**Interfaces:**

```js
sanitizeGeography(raw, { sourceText = '', evidence = null, previous = null } = {})
// => { geography, warnings, dropped }
mergeGeography(parts, { previous = null } = {}) // cleaned geography with remapped IDs
extractGeography({ sourceText, allowedSources, extract, previous = null, onProgress = null })
// => Promise<{ ok, geography, errors, calls }>
```

raw places 使用临时 key/name/aliases/ev，raw links 使用临时 from/to/type/ev 和可选通道字段。复用 abstract-evidence 的允许来源、已展示片段与逐字引用，逐条处理非法地理提议，引用核完即弃。地点编号由引擎发；跨块编号必须重映射，确认同名不同地点不能按短名合并。包含环的内部边全部剔除，相邻与通道环保留。

新世界地理随现有名册调用返回，经 sanitizeCanon/mergeCanonChunks/最终组装保存。没有地理输出时旧路径不增加空键。完整抽取缓存增加格式识别，旧缓存不声称已有地图。仅重抽设定或刻度要保留同来源地图。独立 extractGeography 为旧世界补抽服务，分块和异常不影响既有世界，拒绝空传输冒充成功。

- [ ] 写来源核验、错误局部拒收、跨块关系和真实 extractWorldSetting 接线测试，运行证红。
- [ ] 实现独立模块并接入现有抽取，不新建每轮调用。
- [ ] 执行 `node --test test/geography-extract.test.js` 与受影响 abstract 测试。
- [ ] 报告所覆盖的缓存及局部重抽入口，保留真实风险供复审。

## Task 3: 地图弹窗

**Files:** 新增 `src/map-view.js`、`web/map-reader.js`、`test/map-popup.test.js`；修改 `src/render.js`、`web/index.js`、现有样式文件和受影响地图呈现测试。不得编辑抽取、pack、schema、prompts、共享台账。

**Interfaces:**

```js
renderMapHtml(world, { placeId = '', query = '' } = {}) // HTML from buildMapData
createMapPopupHub({ getWorld, doc = null, onExtract = null, setStatus = null })
// => { open, close, refresh }
```

旧 renderSideHtml 只输出地图按钮和摘要，不包含地图详情 DOM。弹窗使用单独遮罩挂在 document.body，复用现有窗口视觉风格，按钮触发 `bus['open-map']`。补抽回调调用 `bus['extract-map']`，该 handler 由主控制者接入。getWorld 必须读取最新世界，不能在建工厂时抓旧值。桌面分栏，手机单栏。搜索、区域切换、父级、多重包含入口、关系线及人物/事件详情都在弹窗内部；未知位置人物及无地点事件可以查看。正常视图保留位置来源。不存在地理事实时不伪造连线、距离或方向。

- [ ] 写开关、遮罩、ESC、焦点、主面板重绘仍可用及入口未展开的行为测试，运行证红。
- [ ] 实现纯渲染和独立交互工厂，接入真实入口。
- [ ] 执行地图与渲染相关测试；旧展开式断言按用户明确的新行为更新，不能放松数据正确性判据。
- [ ] 可行时在桌面与手机尺寸检查弹窗布局，报告视觉验证的实际范围。

## Task 4: 演化输入、写回与发布验证（主控制者）

**Files:** 修改 `src/schemas/ssot.schema.js`、`src/pack.js`、`src/prompts.js`、`src/render-base.js`、`web/inject.js`（仅已有开启通道）、`web/index.js`（Task 3 结束后）；新增 `web/geography-wiring.js`、集成与预算回归；更新权威台账及索引。

```js
createGeographyHub({ getWorld, getIdentity, getSource, extract, persist, setStatus })
// => { backfill }; calls extractGeography, compares identity/source/world before saving.
```

主调用前附加 geographyPack 的紧凑事实。默认全量；超预算先裁地图远处部分，相关组与包含链作为整体，装不下就省掉并记已装/未装计数，不挤掉因果主资料。无地图旧世界不增加字段。用真实 runTick 测主调用入口和调用次数。

补抽读取当前来源选择，记录调用前世界身份、来源摘要和世界字节版本；返回后重新核对，只给尚未变化的世界写地理字段，沿用现有落盘结果提示。不重种或重开；回档、换聊天、推进及来源变更期间的迟到结果不能覆盖现状。地图刷新读取同一份 SSOT。

- [ ] 执行泛用性审计并保存结果；新增 SSOT、runTick、预算、导出回档及迟到写回测试，运行证红。
- [ ] 完成上述接线与提示词，保持 schema 位置可选及玩家规则。
- [ ] 逐项核对设计验收，执行相关测试、全量 `node --test` 和 `node demo/smoke-demo.js`。
- [ ] 独立复审整个任务，修复有证据的缺陷，更新当前值、README 判据数与文档。
- [ ] 执行 `node scripts/build-kb.mjs`、`node scripts/audit-docs.mjs`、`git diff --check`，提交具体文件。
- [ ] 从测试后的源码子树快进安装本机预览，再运行安装版守门与冒烟，逐字节比较源码和安装版；不推远程。

## 控制者自审

三类子任务文件所有权不重叠，主控制者等 UI 接线完成后再改 web/index.js。契约以 geography.schema.js 为唯一形状定义；抽取产生它、查询与界面消费它。所有用户验收均落到以上四项任务和集成测试，实施过程中更新本计划的完成状态。

# 记忆通道模型列表实施计划

> For agentic workers: use subagent-driven-development or executing-plans to implement the task and review its result.

**Goal:** 记忆通道可以获取并点选模型，移除手动容量探测。

**Architecture:** 复用 `src/transport-http.js` 的 `listModels`；记忆通道 hub 持有独立列表状态，动作总线调用它，渲染层接收状态。批量处理沿用客户端自动缩批。

**Tech Stack:** 原生 JavaScript、Node test、既有 HTML 与 CSS。

## Global Constraints

- 只改本次模型列表与手动容量探测涉及的模块；不改世界账、演化提示词或检索排序。
- 沿用 `embedBaseUrl`、`embedApiKey`、`embedModel` 与既有输入 id。
- 密钥不打印、不写入报告；列表不自动选择模型。
- `web/index.js` 保持 `<3100` 行；不改样式表，构建号为 `leg172-memory-models`。
- 不推远端；核验后同步本机插件。

### Task 1: 实现并验证记忆通道交互

**Files:** `web/embed-channel.js`、`web/settings-channels.js`、`web/index.js`、`src/render.js`、`src/embed-client.js`、`src/render-base.js`；判据在 `test/embed-channel.test.js`、`test/embed-client.test.js` 与相关装配测试。

**Interfaces:** 复用 `listModels({baseUrl, apiKey, fetchImpl})`；hub 提供列表获取、选中回填和渲染状态，动作使用 `list-embed-models`、`pick-embed-model`。

- [x] 写行为判据，用注入的 fetch 返回 `{data:[{id:'embed-a'}]}`；断言 GET 发往记忆地址、取列表不写设置、点选只写 `embedModel`，节点就地更新。写一个真实 `createEmbedWiring` 集成判据检查动作调用。
- [x] `node --test test/embed-channel.test.js`，确认新增行为在旧实现上失败。
- [x] 复用既有取数和渲染口，实现列表与回填；删除手动容量探测按钮、动作、函数及专属判据，保留自动缩批判据。
- [x] 定向测试通过；独立复核 diff，确认失败、转义、两条通道隔离和刷新状态。
- [x] 主代理运行 `node --test`、`node demo/smoke-demo.js`，更新 STATE/README/交接及知识索引，执行文档守门。
- [x] 提交后同步本机预览，逐文件核对，再在部署目录跑全量判据与冒烟。

### Task 2: 修复默认窗口下界（用户已单独确认）

**Files:** `web/embed-runtime.js`、`test/embed-window-defaults.test.js`。

**Interfaces:** `createEmbedRuntime` 的 `stepForTick`、`recallForTick`、`stats`；未传 `floor` 取计算值，显式 `floor: 0` 保持原义。

- [x] 写普通调用判据：第 6 轮、窗口 3、编年 1 至 6，每条一条向量；默认补建应收第 1 至 3 轮，默认统计未补前欠 3 件，默认召回排除窗口内条目。另测显式零下界。
- [x] `node --test test/embed-window-defaults.test.js`，确认旧实现的默认补建和统计失败。
- [x] 三个 `Number.isFinite(Number(floor)) ?` 改为 `floor != null && Number.isFinite(Number(floor)) ?`；不改变轮次公式或检索排序。
- [x] `node --test test/embed-window-defaults.test.js test/embed-runtime.test.js test/embed-runtime-chronicle.test.js test/vector-pack.test.js` 通过，独立复核后交主代理做全量验证。

### Task 3: 同类窗口错误——聊天全账召回调用处

**Files:** `web/settings-channels.js`、`test/chat-vector-window.test.js`。

- [x] 用真实 `createEmbedRuntime` 建好全账索引后调用 `makeVectorRecall`，在热账与归档卷两种装置上证红：有索引但候选为零。
- [x] 调用处传当前轮次加一，维持聊天全账候选的既有约定；底层零下界语义与排序不改。
- [x] 两种真实装配回归通过；独立审查覆盖该调用处与本机代理改动。

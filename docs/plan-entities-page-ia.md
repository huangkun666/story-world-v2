# 「角色与势力」页信息架构改版 · 实施计划

> **给自动化执行者：** 建议用 `subagent-driven-development`（每个任务派一个干净的子代理，任务之间评审）或 `executing-plans` 逐任务执行。步骤用 `- [ ]` 复选框跟踪。
> **上游细案（权威口径，开工前必读）**：`docs/spec-entities-page-ia.md`（本计划是它的落地，判据 J1–J11 在那里定义）
> ★ **路径说明（如实记）**：技能默认把计划存到 `docs/superpowers/plans/`，但本仓既有惯例是
> `docs/spec-*.md` 一律平铺在 `docs/`（现有 30+ 份细案都在那里）⇒ 本计划按**仓库惯例**存为
> `docs/plan-entities-page-ia.md`，与细案并列。

**目标**：把「角色与势力」页从"621 张等价卡一路平铺（170319px、626 按钮、0 搜索）"改成
"三列 + 搜索/筛选/分组/排序/分页"，并把恒空字段（位置 76% 空、最近活跃 96% 空）请出版面。

**架构**：数据选择逻辑（筛选/排序/分页/搜索匹配）放 `src/render.js` 作**纯函数**并导出（可在 Node 里直接测）；
`web/index.js` 只持一份**视图状态对象** + 接线（点击 chip 改状态 → 只重绘实体页 → 恢复搜索框焦点）；
样式改 `web/style.css`。**渲染层不持状态，接线层不算数据**——与本仓 `renderChronicleHtml` 的
`view.chronicleFilter` 同款分工。

**技术栈**：纯 ESM（零依赖）· Node 内置 `node:test` + `node:assert/strict` · 无构建步骤 ·
浏览器侧零框架（原生 DOM + 模板字符串）

## 全局约束（每个任务都隐含遵守）

- **最高准则：「没命令不准动一个字节」**（`ANCHOR.md`）。本计划已获用户批准 ⇒ 按计划执行。
- **含中文的文件禁止用 PowerShell 读写**（`Set-Content` 会吃字符、造 U+FFFD 不可逆损坏——leg28 血案）。一律用编辑工具或 Node 的 `writeFileSync(..., 'utf8')`。
- **判语法必须用真 import**（`node --check` 按 CJS 解析会给假绿）。
- **判据必须无参、必须在项目目录内跑**：`cd F:\deepseek\plugins\story-world-v2 && node --test`。
- **基线**：本计划开工前 `node --test` = **731/731 全绿**、`node demo/smoke-demo.js` = **PASS（终态 8231 字节逐字节未变）**。改动过程中这两个数只许在"按新口径升级用例"时变，**冒烟字节数不许变**。
- **承重墙**：不得改 `src/settle.js` / `src/pack.js` / `src/gate.js` / `src/check-step.js` / 任何 `src/schemas/*`。
- **`MAIN_PROMPT_V` 不升**（模型看到的东西零变化）。
- **真账一个字节不碰**（要读先 `cp` 副本）。
- **玩家可见文本零引擎术语**（K33/A-3 既有三条用例继续咬；★构建号渲染在玩家视线内，起名要过禁词判据：禁 `agenda`/`tick`/`ssot`/`schema`）。
- **不推送**（`git push` 需用户明令；本仓 `main` 领先 `origin/main` 575 笔是常态）。
- **提交信息全中文**、用 `git commit -F <文件>` 传（避免 PowerShell 编码坑）；临时信息文件放 `.git/` 并在提交后删除。

---

## 文件结构（先锁边界）

| 文件 | 职责 | 本计划的改动 |
|---|---|---|
| `src/render.js` | 渲染纯函数（SSOT → HTML） | 新增 3 个导出纯函数（选行/分页/文案）；重写 `renderEntitiesHtml`；新增工具栏与空态 |
| `test/render.test.js` | 渲染面判据 | 新增 11 条（J1–J11）；**按新口径升级 5 条既有用例** |
| `test/lookup-batch.test.js` | 查书/位置继承面判据 | `:381` 一条断言换落点（`（推）` 从位置列改到名号格） |
| `web/index.js` | 接线层（自身零第二份状态） | 新增 `sw2EntsView` 一份视图状态 + 4 个动作 + 搜索框 input 接线 + 重绘后恢复焦点 |
| `web/style.css` | 样式（CSS 变量令牌 `--sw2-*`） | 三列栅格、工具栏、分组、分页；删只服务旧列的规则 |

---

## Task 1: 数据选择层（纯函数 + 导出）

**Files:**
- Modify: `src/render.js`（在 `renderEntitiesHtml` 之前插入；`export` 出去）
- Test: `test/render.test.js`（新增 `test/entities-view.test.js`？**不**——本仓渲染面判据都住 `test/render.test.js`，照旧住这里）

**Interfaces:**
- Produces:
  - `ENTS_PAGE_SIZE: number`（值 `60`）
  - `ENTS_DEFAULT_VIEW: { q: string, kind: 'all'|'faction'|'character', filters: string[], grp: 'none'|'parent'|'loc'|'kind', sort: 'active'|'recent'|'name', page: number }`
  - `entsSearchTextOf(e: object): string`
  - `selectEntityPage(world: object, view: object): { rows: object[], total: number, hit: number, page: number, pages: number, from: number, to: number }`
  - `entsHitCounts(world: object): { all: number, faction: number, character: number, busy: number, recent: number, named: number, orphan: number }`

- [ ] **Step 1: 写失败用例（数据层四条）**

追加到 `test/render.test.js` **文件末尾**（该文件已有 `world()` 夹具可复用）：

```js
// ============ 细案 spec-entities-page-ia：实体页数据选择层（纯函数） ============
test('细案实体页：选行 = 搜索 ∪ 类别 ∪ 筛选，且搜索**覆盖位置**（位置不占列 ≠ 查不到）', () => {
    const w = {
        version: 1, context: { world: 'x', playerId: 'e_p' }, entities: [
            { id: 'e_a', kind: 'character', name: '玄一道祖', location: '西极昆仑山', parent: '昆仑道宫', '实力': 'T9渡劫巅峰' },
            { id: 'e_b', kind: 'faction', name: '万法阁', location: '东海浮空岛', '规模': '极富', '性质': '修真百艺总坛' },
            { id: 'e_c', kind: 'character', name: '无名散人', location: '未明' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 5 },
    };
    const base = { ...ENTS_DEFAULT_VIEW };
    assert.equal(selectEntityPage(w, base).hit, 3, '不筛 = 全量');
    // ★位置不在版面上，但必须在搜索面里
    assert.equal(selectEntityPage(w, { ...base, q: '东海浮空岛' }).hit, 1, '★搜位置命中（位置不占列 ≠ 查不到）');
    assert.equal(selectEntityPage(w, { ...base, q: '昆仑道宫' }).hit, 1, '搜归属命中');
    assert.equal(selectEntityPage(w, { ...base, q: 'T9渡劫' }).hit, 1, '搜实力原话命中');
    assert.equal(selectEntityPage(w, { ...base, q: '修真百艺' }).hit, 1, '搜性质原话命中');
    assert.equal(selectEntityPage(w, { ...base, kind: 'faction' }).hit, 1, '类别筛');
    assert.equal(selectEntityPage(w, { ...base, filters: ['orphan'] }).hit, 2, '无归属筛（万法阁 + 无名散人）');
    assert.equal(selectEntityPage(w, { ...base, filters: ['named'] }).hit, 1, '有归属筛');
    assert.equal(selectEntityPage(w, { ...base, q: '不存在的词' }).hit, 0, '搜不到 = 0（不是全量）');
});

test('细案实体页：排序三档（在办优先 / 最近活跃优先 / 按名号）', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_1', kind: 'character', name: '丙', lastActiveTick: 3 },
            { id: 'e_2', kind: 'character', name: '甲', lastActiveTick: 9 },
            { id: 'e_3', kind: 'character', name: '乙' },
        ],
        weights: {}, agendas: [{ id: 'a_1', owner: 'e_3', goal: '在办', closed: false, progress: 1, maxSteps: 3 }],
        events: [], chronicle: [], milestones: [], meta: { tick: 9 },
    };
    const base = { ...ENTS_DEFAULT_VIEW };
    assert.deepEqual(selectEntityPage(w, { ...base, sort: 'active' }).rows.map((e) => e.name), ['乙', '甲', '丙'], '在办优先，其余按最近活跃');
    assert.deepEqual(selectEntityPage(w, { ...base, sort: 'recent' }).rows.map((e) => e.name), ['甲', '丙', '乙'], '最近活跃优先');
    // ★按名号：期望值 = **丙 甲 乙**（丙 bǐng < 甲 jiǎ < 乙 yǐ）。
    //   ★★留档一处我写错的期望值（Task 1 评审当场纠正）：本计划初稿写的是 `['丙','乙','甲']`，那既不是拼音序、
    //   也不是笔画序（实测 `zh-u-co-stroke` 给 `乙丙甲`），**就是错的**。
    //   ★环境事实（实测）：Node v24.19.0 / ICU 78.3 **不含拼音排序数据**——
    //   `new Intl.Collator('zh-u-co-pinyin').resolvedOptions().collation === 'default'`，
    //   即 `localeCompare(name, 'zh')` 走的是**默认（部首/笔画）序**，不是拼音序。
    //   真账 621 名号实测：末尾是「祝无双 · 转轮鬼圣 · 转轮鬼使 · 转轮王 · 追风 · 坐忘大罗」
    //   （zhù/zhuǎn/zhuī/zuò 被拆散）⇒ **产品面已知限制**：想按拼音找名字会与预期有偏差。
    //   三条出路（**均已评估，本笔选 A**）：A 接受默认序（零依赖、确定性，且"按名号"只是第三排序档，
    //   真正的入口是搜索）；B 引拼音表（破坏"零依赖"纪律，且表外生僻字仍退化）；C 受控词表手写键（同上）。
    assert.deepEqual(selectEntityPage(w, { ...base, sort: 'name' }).rows.map((e) => e.name), ['丙', '甲', '乙'], '按名号（ICU 默认序）');
});

test('细案实体页：分页 —— 一屏 60 行、页码越界夹紧、from/to 如实', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `e_${i}`, kind: 'character', name: `名${String(i).padStart(3, '0')}` }));
    const w = { version: 1, context: { world: 'x' }, entities: many, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 } };
    const base = { ...ENTS_DEFAULT_VIEW };
    const p1 = selectEntityPage(w, base);
    assert.equal(p1.pages, 3, '130 条 / 60 = 3 页');
    assert.equal(p1.rows.length, 60, '★首屏只渲染 60 行（判据 J10）');
    assert.equal(p1.from, 1); assert.equal(p1.to, 60);
    const p2 = selectEntityPage(w, { ...base, page: 2 });
    assert.equal(p2.page, 2); assert.equal(p2.from, 61); assert.equal(p2.to, 120);
    const p3 = selectEntityPage(w, { ...base, page: 3 });
    assert.equal(p3.rows.length, 10); assert.equal(p3.to, 130);
    assert.equal(selectEntityPage(w, { ...base, page: 99 }).page, 3, '★页码越界夹到最后一页（不是空页）');
    assert.equal(selectEntityPage(w, { ...base, page: 0 }).page, 1, '★页码 0/负数夹到第一页');
    assert.equal(selectEntityPage(w, { ...base, q: '名00' }).rows.length, 10, '筛完再分页（命中 10）');
});

test('细案实体页：命中计数七格（chip 上的数不许写死）', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_1', kind: 'faction', name: '有家的', parent: '上级' },
            { id: 'e_2', kind: 'character', name: '孤身的' },
            { id: 'e_3', kind: 'character', name: '最近动过的', lastActiveTick: 7 },
        ],
        weights: {}, agendas: [{ id: 'a_1', owner: 'e_2', goal: 'g', closed: false }], events: [], chronicle: [], milestones: [], meta: { tick: 7 },
    };
    assert.deepEqual(entsHitCounts(w), { all: 3, faction: 1, character: 2, busy: 1, recent: 1, named: 1, orphan: 2 });
});
```

★ 如果 `test/render.test.js` 顶部没有 `ENTS_DEFAULT_VIEW` / `selectEntityPage` / `entsHitCounts`，把它们加进**已有的** import 块（第 10–14 行那个 `import { ... } from '../src/render.js';`），不要新开 import 语句。

- [ ] **Step 2: 跑用例确认失败**

Run: `cd F:\deepseek\plugins\story-world-v2` 然后 `node --test test/render.test.js`
Expected: FAIL —— 报 `ENTS_DEFAULT_VIEW is not defined`（ReferenceError，导入名不存在）

- [ ] **Step 3: 实现数据选择层**

在 `src/render.js` 的 `renderEntitiesHtml` **之前**插入（紧跟 `function lookupButtons(...)` 那段之后）：

```js
// ============ 细案 spec-entities-page-ia：实体页数据选择层（纯函数，可导出单测） ============
// 分工（照 renderChronicleHtml 的 view.chronicleFilter 同款）：**选数据住渲染层、存状态住接线层**。
//   ⇒ 接线层只持一份视图状态对象，一行数据逻辑都不写（本仓"零第二份状态"纪律）。
export const ENTS_PAGE_SIZE = 60;
export const ENTS_DEFAULT_VIEW = { q: '', kind: 'all', filters: [], grp: 'none', sort: 'active', page: 1 };

// 搜索面：★位置**在**这里（位置不占版面 ≠ 查不到——细案 §3.3 是硬口径）
export function entsSearchTextOf(e) {
    // ★Task 1 评审的 Minor 定夺：「未明」是**占位词不是内容**（不是地名），不许进搜索面——
    //   否则搜「未明」会命中 475 个"位置未知"的人（本仓既有纪律："占位词绝不作为值渲染/检索"）。
    const loc = typeof e?.location === 'string' && e.location !== '未明' ? e.location : '';
    return [e?.name, e?.parent, loc, e?.['实力'], e?.['规模'], e?.['性质'], e?.['倾向'],
        ...(Array.isArray(e?.organs) ? e.organs : []), ...(Array.isArray(e?.branches) ? e.branches : [])]
        .filter((x) => typeof x === 'string' && x).join(' ').toLowerCase();
}

export function entsHitCounts(world) {
    const es = world?.entities || [];
    const busy = new Set((world?.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    return {
        all: es.length,
        faction: es.filter((e) => e.kind === 'faction').length,
        character: es.filter((e) => e.kind === 'character').length,
        busy: es.filter((e) => busy.has(e.id)).length,
        recent: es.filter((e) => typeof e.lastActiveTick === 'number').length,
        named: es.filter((e) => e.parent).length,
        orphan: es.filter((e) => !e.parent).length,
    };
}

export function selectEntityPage(world, view = {}) {
    const v = { ...ENTS_DEFAULT_VIEW, ...(view || {}) };
    const busy = new Set((world?.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    const filters = new Set(Array.isArray(v.filters) ? v.filters : []);
    const q = String(v.q || '').trim().toLowerCase();
    let rows = (world?.entities || []).filter((e) => v.kind === 'all' || e.kind === v.kind);
    if (filters.has('busy')) rows = rows.filter((e) => busy.has(e.id));
    if (filters.has('recent')) rows = rows.filter((e) => typeof e.lastActiveTick === 'number');
    if (filters.has('named')) rows = rows.filter((e) => e.parent);
    if (filters.has('orphan')) rows = rows.filter((e) => !e.parent);
    if (q) rows = rows.filter((e) => entsSearchTextOf(e).includes(q));
    const cmp = {
        // 在办优先 → 最近活跃次之 → 名号（确定性三重键：同输入必得同序）
        active: (a, b) => (busy.has(b.id) ? 1 : 0) - (busy.has(a.id) ? 1 : 0)
            || (b.lastActiveTick ?? -1) - (a.lastActiveTick ?? -1) || String(a.name).localeCompare(String(b.name), 'zh'),
        recent: (a, b) => (b.lastActiveTick ?? -1) - (a.lastActiveTick ?? -1) || String(a.name).localeCompare(String(b.name), 'zh'),
        name: (a, b) => String(a.name).localeCompare(String(b.name), 'zh'),
    }[v.sort] || null;
    if (cmp) rows = rows.slice().sort(cmp);
    const hit = rows.length;
    const pages = Math.max(1, Math.ceil(hit / ENTS_PAGE_SIZE));
    const page = Math.min(Math.max(1, Number(v.page) || 1), pages);   // ★越界夹紧（不返回空页）
    const slice = rows.slice((page - 1) * ENTS_PAGE_SIZE, (page - 1) * ENTS_PAGE_SIZE + ENTS_PAGE_SIZE);
    // ★Task 1 评审的 Minor 定夺：空结果时 from/to **按意图**都是 0（不写 `?1:0` 那种没解释的三元），
    //   Task 3 的分页器遇到 hit===0 时只印「命中 0」，不印「显示第 0–0 条」。
    const from = slice.length ? (page - 1) * ENTS_PAGE_SIZE + 1 : 0;
    const to = slice.length ? (page - 1) * ENTS_PAGE_SIZE + slice.length : 0;
    return { rows: slice, total: (world?.entities || []).length, hit, page, pages, from, to };
}
```

- [ ] **Step 4: 跑用例确认通过**

Run: `node --test test/render.test.js`
Expected: PASS（新增 4 条全绿，原有条目一条都不许变红）

- [ ] **Step 5: 跑全量判据**

Run: `node --test`
Expected: **735 pass / 0 fail**（731 + 4）

- [ ] **Step 6: 提交**

```bash
cd F:/deepseek/plugins/story-world-v2
git add src/render.js test/render.test.js
git commit -m "细案实体页 1/5：数据选择层纯函数（选行/排序/分页/命中计数）"
```

---

## Task 2: 行渲染三列化（位置列与活跃列退场）

**Files:**
- Modify: `src/render.js` 的 `renderEntitiesHtml()`（现 667–812 行）
- Test: `test/render.test.js`（新增 J1/J2/J3/J6/J7/J11 六条；**升级**既有 4 条）

**Interfaces:**
- Consumes: Task 1 的 `selectEntityPage` / `entsHitCounts` / `ENTS_DEFAULT_VIEW` / `ENTS_PAGE_SIZE`
- Produces:
  - `renderEntitiesHtml(world, { config = null, view = {} } = {}): string`（**签名扩参**，`view` 走 `ENTS_DEFAULT_VIEW` 同形）
  - 新增格子类名（供 CSS 与判据）：`sw2-cell sw2-c-name`（名号 + 档位 + 查询钮）、`sw2-relone`（归属与来历串）、`sw2-agcell`（在办的事）
  - **删除**格子类名：`sw2-c-loc`、`sw2-c-active`、`sw2-c-act`、`sw2-c-rel`、`sw2-aidle`、`sw2-orphan`
  - `（推）` 标记改落名号格（`<span class="sw2-quiet-note">（推）</span>`，title 仍是 `derivedTip`）

- [ ] **Step 1: 写失败用例（J1/J2/J3/J6/J7/J11）**

追加到 `test/render.test.js` 末尾：

```js
// ============ 细案 spec-entities-page-ia：三列版式（位置列/活跃列退场） ============
test('★细案实体页 J1/J2：位置列与活跃列**不得出现**；位置在渲染结果里零出现（列已撤）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    for (const cls of ['sw2-c-loc', 'sw2-c-active', 'sw2-c-act']) {
        assert.ok(!html.includes(cls), `★格子 ${cls} 必须退场（细案 J1）`);
    }
    assert.ok(!html.includes('最近活跃'), '★「最近活跃」不进版面（细案 J6：只进排序与筛选）');
    assert.ok(!html.includes('sw2-locval'), '★位置值不占列');
    // ★但位置必须在**搜索面**里（J2 的另一半：不占列 ≠ 查不到）
    const hit = selectEntityPage(w, { ...ENTS_DEFAULT_VIEW, q: '黄府' });
    assert.ok(hit.hit >= 1, '★搜位置仍能命中（w.context.playerId 那位在「黄府」）');
});

test('★细案实体页 J3：无在办时**不输出**占位句（空态不占版面）', () => {
    const w = world();
    w.agendas = [];
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('眼下没有在办的盘算'), '★旧占位句不得回潮（真账 ~600 行挂着它）');
    assert.ok(!html.includes('你的每一步从对话里来'), '★★玩家那句占位也退场（细案 J11：玩家标记不许搬回来）');
});

test('★细案实体页 J6/J7：规模只许出现一次；归属与来历是一格一串', () => {
    const w = {
        version: 1, context: { world: 'x' }, entities: [
            { id: 'e_f', kind: 'faction', name: '慈航医堡', location: '未明', '规模': '长城上唯一的医修结社', '性质': '游走于死亡边缘的提灯人', '倾向': '不修杀伐' },
        ],
        weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
    };
    const html = renderEntitiesHtml(w);
    assert.equal((html.match(/长城上唯一的医修结社/g) || []).length, 1, '★★规模只许出现一次（自证：我在 demo 里先犯过这个错）');
    assert.ok(html.includes('sw2-relone'), '归属与来历有独立容器');
    assert.ok(html.includes('游走于死亡边缘的提灯人'), '性质原话入面');
    assert.ok(!html.includes('未载'), '★「未载」这类空态词不进版面');
});

test('★细案实体页 J11：行内不出现玩家标记与占位', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.ok(!html.includes('sw2-player'), '★玩家底纹不进新行（细案 J11）');
    assert.ok(!html.includes('你的棋子'), '★「你的棋子」标记退场；玩家靠归属与在办自证');
});
```

- [ ] **Step 2: 跑用例确认失败**

Run: `node --test test/render.test.js`
Expected: FAIL —— `sw2-c-loc` 仍在（J1 第一条红）、`眼下没有在办的盘算` 仍在（J3 红）、规模出现两次不是一次（J7 红）

- [ ] **Step 3: 重写行渲染**

把 `src/render.js` 里 `renderEntitiesHtml` 的 `const rows = (world.entities || []).map((e) => { ... });` 整段
（现 679–795 行）替换为下面这段；同时把函数签名与头部改成新的：

```js
export function renderEntitiesHtml(world, { config = null, view = {} } = {}) {
    // K46：镜头名单（pack 引擎层同口径）+ 麾下成员派生——全册展示、隶属
    const lens = new Set(lensList(world).map((x) => x.e.id));
    // ★细案 spec-entities-page-ia：三列版式（名号 / 归属与来历 / 在办的事）。
    //   位置与最近活跃**不占版面**：位置 23.5% 有值、最近活跃 3.9% 有值
    //   （真账 621 实体实测）⇒ 一列印 76% / 96% 的空，是把信号淹在噪声里。
    //   ★但位置仍在搜索面里（entsSearchTextOf）——不占列 ≠ 查不到。
    const page = selectEntityPage(world, view);
    const busyOwners = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));

    const rows = page.rows.map((e) => {
        const agenda = (world.agendas || []).find((a) => !a.closed && a.owner === e.id);
        const status = e.status && e.status !== 'active'
            ? `<span class="sw2-visible ${e.status === 'dead' ? 'v-hidden' : 'v-known'}">${LABELS.status[e.status]}</span>` : '';
        const lensBadge = lens.has(e.id) && (!e.status || e.status === 'active') ? '<span class="sw2-visible v-known">在场</span>' : '';
        const parentDerived = e.parentSource === '结构推导';
        const derivedTip = '这条是结构推出来的：由组织条目的驻地/隶属推出（书里没在这个名号自己身上明述），不是模型创作';
        // （推）：位置/归属是推来的 ⇒ 标记落在**名号格**（位置列已退场，来源标记不许跟着一起消失
        //   ——lookup-batch.test.js:381 与"引擎推的不许当书里写的"这条纪律都指着它）。
        // ★两支都要保留：`parentSource`（归属推导）与 `位置来源`（位置推导）——
        //   旧代码两个都判，本次**只改落点不改判定**（parentSource 有 5 个测试文件在用，删除它会连坐）。
        const derived = parentDerived || world.meta?.entityFields?.[e.id]?.位置来源 === '结构推导';
        const rec = world.meta?.entityFields?.[e.id];
        const lookupState = (f) => rec?.attempts?.[f]?.state ?? 'none';
        // 查询钮：只在**真需要补**的行出现（旧版每行两枚 ⇒ 真账 626 枚；真账只有 ~12 行是待查态）
        // ★口径照既有 `lookupButtons()`（`src/render.js:658`）：action 名是 **`lookup-entity`**、
        //   id 走 `data-entity`、强制重查走 `data-force="absent"`——**不许自造 action 名**
        //   （`test/lookup-batch.test.js` 有一条"画了按钮就必须有人接"的审计会当场抓红）。
        const settled = ['ok', 'absent'].includes(lookupState('实力'));
        const lookupBtn = e.kind === 'character' && !settled
            ? `<button class="sw2-chainbtn" data-action="lookup-entity" data-entity="${escapeHtml(e.id)}" title="${attrText('只补还没定案的栏（已查到的原话不动）')}">查</button>`
            : '';
        // 归属与来历：**一串同源的事**（归属 › 实力 · 规模 › 性质 · 倾向），一个格子说完
        const origin = [
            e.parent ? `<span class="sw2-relone-who">${escapeHtml(e.parent)}</span>` : '',
            typeof e['实力'] === 'string' && e['实力'].trim() ? `<span class="sw2-relone-pow">${escapeHtml(e['实力'])}</span>` : '',
            typeof e['规模'] === 'string' && e['规模'].trim() ? escapeHtml(e['规模']) : '',
            typeof e['性质'] === 'string' && e['性质'].trim() ? escapeHtml(e['性质']) : '',
            typeof e['倾向'] === 'string' && e['倾向'].trim() ? `<span class="sw2-relone-dim">${escapeHtml(e['倾向'])}</span>` : '',
        ].filter(Boolean).join('<span class="sw2-relone-sep"> · </span>');
        const crew = e.kind === 'faction' ? membersOf(world, e) : null;
        const crewPower = crew
            ? crew.map((n) => {
                const m = (world.entities || []).find((x) => x.name === n);
                return typeof m?.['实力'] === 'string' && m['实力'].trim() ? `${n}（${m['实力']}）` : null;
            }).filter(Boolean)
            : [];
        const crewHtml = crew?.length
            ? `<span class="sw2-relone-sep"> · </span><span class="sw2-relone-crew">麾下 ${escapeHtml(crew.join('、'))}</span>` : '';
        const crewPowerHtml = crewPower.length
            ? `<span class="sw2-relone-sep"> · </span><span class="sw2-relone-dim">麾下实力 ${escapeHtml(crewPower.join('、'))}</span>` : '';
        // 在办的事：**只有真在办才有字**（旧版无在办时印一句"眼下没有在办的盘算。"占主句位，真账 ~600 行都是它）
        const agendaHtml = agenda
            ? `<span class="sw2-aggoal">${escapeHtml(agenda.goal)}</span><span class="sw2-agstage">${escapeHtml(agenda.stage || '谋划中')} · ${agenda.progress ?? 0}/${agenda.maxSteps ?? 0}</span>${agenda.visibility === 'concealed' ? '<span class="sw2-visible v-hidden">暗</span>' : ''}`
            : '';
        const hot = busyOwners.has(e.id) ? ' sw2-hot' : '';
        return `<div class="sw2-entity-row${hot}">`
            + `<div class="sw2-cell sw2-c-name">`
            + `<div class="sw2-ename">${escapeHtml(e.name)}<small>${kindLabel(e, world)}${status}${lensBadge}</small>`
            + (derived ? `<span class="sw2-quiet-note" title="${attrText(derivedTip)}">（推）</span>` : '')
            + lookupBtn
            + `</div></div>`
            + `<div class="sw2-cell sw2-relone">${origin || '<span class="sw2-empt"></span>'}${crewHtml}${crewPowerHtml}</div>`
            + `<div class="sw2-cell sw2-agcell">${agendaHtml}</div>`
            + `</div>`;
    });
    // ... 头部与工具条见 Task 3 ...
    return `<div class="sw2-list-head">全部角色与势力（全册 ${page.total} · 本轮镜头 ${lens.size}）<small class="sw2-quiet-note" title="面板构建号：改了代码但页面还是旧的时（浏览器缓存），拿这个对照">构建 ${PANEL_BUILD}</small></div>`
        + `<div class="sw2-entity-list">${rows.join('')}</div>`;
}
```

★ 注意：`kindLabel(e, world)` 对玩家返回「你的棋子」——**J11 要求行内不出现「你的棋子」**。把 `kindLabel` 对玩家的返回
改成只返回类别（`角色`）：在 `kindLabel` 里删掉玩家那一支（现 185–193 行）。**这是一处承重改动，必须连带跑 Task 2 Step 4 的全量判据确认没有别的用例依赖它。**

- [ ] **Step 4: 按新口径升级 4 条既有用例**

这 4 条锁的是**旧版式**，语义仍在但落点变了——照下面逐条改（**不是删，是升级**）：

1. `test/render.test.js:515`
   旧：`assert.match(html, /sw2-quiet-note">最近活跃<\/span><br>第45轮/);`
   新：`assert.ok(!html.includes('最近活跃'), '★最近活跃不占版面（细案 J6）');`
2. `test/render.test.js:523`
   旧：`assert.match(html3, /全部角色与势力（全册 6 · 本轮镜头 4） <small class="sw2-quiet-note">另 2 位退休\/已灭<\/small>/);`
   新：`assert.match(html3, /全部角色与势力（全册 6 · 本轮镜头 4）/, '全册与镜头计数仍在（含退休/已灭的 2 位）');`
   （新头部不再单列"另 N 位退休/已灭"——状态徽就在行内，判据 J-口径：**同一事实不说两遍**）
3. `test/render.test.js:542`
   旧：`assert.ok(html.includes('sw2-c-loc'), '位置列在位');`
   新：`assert.ok(!html.includes('sw2-c-loc'), '★位置列已退场（细案 J1）——位置改由搜索承担');`
4. `test/render.test.js:809`（整条用例改名为 `★细案实体页：三列版式（旧六格版式已按细案重做）`）
   把 ① ② 两段替换为：
   ```js
   // ① 三列各就各位（旧六格：名号/位置/归属·来历/在办/最近/查 ⇒ 细案定稿三格）
   for (const cls of ['sw2-c-name', 'sw2-relone', 'sw2-agcell']) {
       assert.ok(html.includes(`class="sw2-cell ${cls}"`), `格子 ${cls} 在位`);
   }
   assert.ok(!html.includes('sw2-c-loc'), '★位置列退场');
   // ② 空态**不占版面**（旧版是虚线 chip「未载」+ 一整列 76% 都印它）
   assert.ok(!html.includes('未载'), '★「未载」不进版面（细案：空态一律不占版面）');
   ```
   ③ ④ 两段里的关系行断言换成新容器：
   ```js
   assert.ok(html.includes('sw2-relone'), '归属与来历有独立容器');
   assert.ok(html.includes('正道仙门魁首'), '规模原话入面（在归属与来历格里）');
   assert.ok(html.includes('盐帮'), '分支入面');
   assert.ok(!html.includes('<span class="sw2-relval">未明</span>'), '★占位词「未明」绝不作为"值"渲染出来');
   ```
   ★ 原用例的 ④ 条「分支单独成行」不再成立（三列版式里分支并入归属与来历串）⇒ 断言改成"分支入面"。
5. `test/lookup-batch.test.js:381`
   旧：`assert.ok(html.includes('（推）'), '★面板位置列标（推）');`
   新：`assert.ok(html.includes('（推）'), '★面板标（推）——位置列已退场，来源标记改落名号格（引擎推的不许当书里写的）');`
   （断言本身不用改字，只需确认落点仍在渲染结果里；若红 ⇒ 说明 Task 2 Step 3 的 `derived` 判定没覆盖这条路径，
   照 `world.meta.entityFields[id].位置来源 === '结构推导'` 补全）

- [ ] **Step 5: 跑用例确认通过**

Run: `node --test test/render.test.js test/lookup-batch.test.js`
Expected: PASS（新增 4 条 + 升级 5 条全绿）

- [ ] **Step 6: 跑全量判据与冒烟**

Run: `node --test` → Expected: **739 pass / 0 fail**
Run: `node demo/smoke-demo.js` → Expected: **PASS，终态 8231 字节逐字节未变**（渲染改动不许动引擎产物）

- [ ] **Step 7: 提交**

```bash
git add src/render.js test/render.test.js test/lookup-batch.test.js
git commit -m "细案实体页 2/5：三列版式——位置列/活跃列退场，空态不占版面"
```

---

## Task 3: 工具条（搜索 / 筛选 / 分组 / 排序 / 分页）

**Files:**
- Modify: `src/render.js` 的 `renderEntitiesHtml()`（补头部与工具条；新增两个小渲染函数）
- Test: `test/render.test.js`（新增 J5 一条 + 工具条结构一条）

**Interfaces:**
- Consumes: Task 1 的 `selectEntityPage` / `entsHitCounts` / `ENTS_DEFAULT_VIEW`；Task 2 的三列格子
- Produces:
  - `renderEntsToolbar(world, view): string`（工具条 HTML）
  - `renderEntsPager(pageInfo): string`（分页 HTML）
  - 控件类名与属性（接线层与判据都靠这些）：`data-action="ents-filter"` + `data-value`（值：`all`/`faction`/`character`/`busy`/`recent`/`named`/`orphan`）、`data-action="ents-sort"` + `data-value`（`active`/`recent`/`name`）、`data-action="ents-group"` + `data-value`（`none`/`parent`/`loc`/`kind`）、`data-action="ents-page"` + `data-value`（`prev`/`next`）、`id="sw2_ents_q"`（搜索框）
  - 计数徽 `class="sw2-chip-n"`

- [ ] **Step 1: 写失败用例**

```js
// ============ 细案 spec-entities-page-ia：工具条（J5：必须存在搜索与分页控件） ============
test('★细案实体页 J5：搜索控件与分页控件**必须存在**（旧版各 0 个）', () => {
    const w = world();
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('id="sw2_ents_q"'), '★搜索框在位（旧版：0 个）');
    assert.match(html, /<input[^>]*type="search"/, '搜索框是真 input[type=search]');
    assert.ok(html.includes('data-action="ents-page"'), '★分页控件在位');
    assert.ok(html.includes('data-action="ents-filter"'), '筛选 chip 在位');
    assert.ok(html.includes('data-action="ents-sort"'), '排序控件在位');
    // ★分组控件**不在本任务**（用户拍板：从 Task 3 移到 Task 5，中途不许交付死控件）
    assert.ok(!html.includes('data-action="ents-group"'), '★本任务不许出现分组控件（它连同分组渲染一起去 Task 5）');
    // 计数不许写死：chip 上的数来自 entsHitCounts
    const c = entsHitCounts(w);
    assert.ok(html.includes(`>${c.all}<`), `「全部」格印真数 ${c.all}`);
});

test('★细案实体页：两处既有入口按细案改挂工具条（不许在改版里丢掉）', () => {
    const w = world();
    // ① 全册补全按钮（lookup-batch.test.js:436/447 锁它，原在页眉）
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('data-action="lookup-batch-all"'), '★「⬇ 补全全册实力」入口仍在');
    assert.ok(html.includes('⬇ 补全全册实力'), '文案不变（既有用例按这句锁）');
    // 跑到「停止补全」那一态
    const running = renderEntitiesHtml(w, { config: { lookupTask: { cursor: 4, total: 623, success: 3, pending: 1, absent: 0, failed: 0 } } });
    assert.ok(running.includes('■ 停止补全 4/623'), '★进度态照旧由 config.lookupTask 进渲染层');
    // ② 查书三态说明（render.test.js:547/620 锁它，原在页底整行）⇒ 收进可展开的「？」
    assert.ok(html.includes('sw2-ents-asks'), '三态说明改成可展开容器');
    assert.ok(html.includes('账上只记查到的与玩出来的东西'), '★说明文本必须**连续出现**（既有用例用 includes 锁它）');
});

test('★细案实体页：命中计数与页码如实印出（不是估计值）', () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: `e_${i}`, kind: 'character', name: `名${String(i).padStart(3, '0')}` }));
    const w = { version: 1, context: { world: 'x' }, entities: many, weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 } };
    const html = renderEntitiesHtml(w);
    assert.ok(html.includes('命中 <b>130</b>'), '命中数如实');
    assert.ok(html.includes('显示第 1–60 条'), '区间如实');
    assert.ok(html.includes('第 1 / 3 页'), '页码如实');
    // 筛选态下计数跟着变
    const html2 = renderEntitiesHtml(w, { view: { q: '名00' } });
    assert.ok(html2.includes('命中 <b>10</b>'), '筛完计数跟着变');
});

test('★细案实体页：工具栏与列表头**零引擎术语**（构建号也在玩家视线内）', () => {
    const html = renderEntitiesHtml(world());
    const text = String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    for (const bad of ['agenda', 'tick', 'ssot', 'schema', 'entity', 'ENTITIES']) {
        assert.ok(!text.toLowerCase().includes(bad.toLowerCase()), `工具栏不得出现引擎术语「${bad}」`);
    }
});
```

- [ ] **Step 2: 跑用例确认失败**

Run: `node --test test/render.test.js`
Expected: FAIL —— `id="sw2_ents_q"` 不存在

- [ ] **Step 3: 实现工具条与分页**

★ **本步还要顺带收掉两处同源的"假承诺"文案**（Task 2 复审判定：同类缺陷各只差一个行状态/一个文件位置）：
1. **`web/index.js:1989`**（接线层的玩家可见报错）现写着
   `'这一栏已经有原话了（要重查请用「重查」）'`——**那个行内「重查」钮在 Task 2 已被撤掉**。
   改成指向**真实存在的入口**：`'这一栏已经有原话了（要连「书未明述」一起推倒重查，用页顶的「补全全册实力」）'`。
   ★改完跑 `grep -n "要重查请用" web/index.js` 应为空。
2. **`src/render.js` 的 `pending` 态按钮 tooltip** 现说「…再点一次重查…」，与页脚新口径（行内「查」不负责推倒重查）自相矛盾，
   且 `pending` 且 `attempts.count ≥ 2` 的行点下去会落到上面那条错措辞。
   把 tooltip 改成**只承诺它真做的事**：`'按需去世界书取这个名号的原话（只补没定的栏）'`。

在 `src/render.js` 里 `renderEntitiesHtml` **之前**插入两个渲染函数：

```js
// 实体页工具条（细案 §3.2）：两行——搜索 + 类别 + 筛选 ／ 排序 + 全册补全 + 查书三态提示
//   ★`config` 必须从 `renderEntitiesHtml` 透传进来——批量补全进度**只由 config 进渲染层**
//   （本仓纪律：渲染层不持任务状态；真路是 `config.lookupTask`，见 `web/index.js` 的 `renderCfg()`）
export function renderEntsToolbar(world, view, config = null) {
    const v = { ...ENTS_DEFAULT_VIEW, ...(view || {}) };
    const c = entsHitCounts(world);
    const filters = new Set(v.filters || []);
    const chip = (action, value, label, on, n) =>
        `<button class="sw2-chip${on ? ' on' : ''}" data-action="${action}" data-value="${value}">${label}`
        + (n == null ? '' : `<span class="sw2-chip-n">${n}</span>`) + '</button>';
    const kinds = [['all', '全部', c.all], ['faction', '势力', c.faction], ['character', '角色', c.character]];
    // 既有「⬇ 补全全册实力 / ■ 停止补全」按钮（`lookup-batch.test.js:436-448` 锁它；原在页眉，改挂工具条）
    const task = config?.lookupTask || null;
    const batchButtonHtml = task
        ? `<button class="sw2-btn" data-action="lookup-batch-all" title="${attrText('再点一次可停；已查到的都留账')}">■ 停止补全 ${task.cursor}/${task.total}</button>`
        : `<button class="sw2-btn" data-action="lookup-batch-all" title="${attrText('把全册在册角色的实力按需查一遍（借世界推进分批跑，不阻塞推进；再点一次可停）')}">⬇ 补全全册实力</button>`;
    // 查书三态说明：页底那整行太长 ⇒ 收进可展开的「？」（★文本必须**连续**出现，`render.test.js:547/620` 用 includes 锁它）
    const asksHintHtml = `<details class="sw2-ents-asks"><summary title="${attrText('这三种标记各是什么意思')}">？</summary>`
        + `<div class="sw2-ents-asks-body">账上只记查到的与玩出来的东西：<b>有值</b>=书里原话；`
        + `<b>未加载到</b>=查过书但这轮模型没抽出来（下轮再补，不代表书里没有）；<b>书未明述</b>=书里确实没写。`
        + `每行的<b>查</b>=只补没定的栏，<b>重查</b>=连「书未明述」也推倒重查。</div></details>`;
    return `<div class="sw2-ents-tools">`
        + `<div class="sw2-ents-tools-row">`
        + `<input id="sw2_ents_q" class="sw2-ents-q" type="search" value="${attrText(v.q)}" placeholder="搜索名号 / 归属 / 位置 / 实力 / 规模 / 性质…">`
        + kinds.map(([k, label, n]) => chip('ents-filter', k, label, v.kind === k, n)).join('')
        + chip('ents-filter', 'busy', '只看在办', filters.has('busy'), c.busy)
        + chip('ents-filter', 'recent', '最近动过的', filters.has('recent'), c.recent)
        + chip('ents-filter', 'named', '有归属的', filters.has('named'), c.named)
        + chip('ents-filter', 'orphan', '无归属的', filters.has('orphan'), c.orphan)
        + `</div>`
        + `<div class="sw2-ents-tools-row">`
        + `<span class="sw2-ents-grp">排序</span>`
        + [['active', '在办优先'], ['recent', '最近活跃优先'], ['name', '按名号']]
            .map(([s, label]) => chip('ents-sort', s, label, v.sort === s)).join('')
        + batchButtonHtml      // ★既有「⬇ 补全全册实力」，从页眉挪到这里（lookup-batch.test.js:436/447 锁它）
        + asksHintHtml         // ★页底那句三态注脚（render.test.js:547/620 锁它），改成可展开的「？」
        + `</div></div>`;
}

// 分页（细案 §3.2）：一屏 60 行
//   ★空结果时只印「命中 0」——**不印「显示第 0–0 条」**（Task 1 评审定夺：空态不占版面）
export function renderEntsPager(info) {
    if (!info || info.pages <= 1) {
        const span = info && info.hit > 0 ? `　显示第 ${info.from}–${info.to} 条` : '';
        return `<div class="sw2-ents-pager"><span class="sw2-ents-hit">命中 <b>${info?.hit ?? 0}</b>${span}</span></div>`;
    }
    return `<div class="sw2-ents-pager">`
        + `<button class="sw2-btn" data-action="ents-page" data-value="prev"${info.page <= 1 ? ' disabled' : ''}>‹ 上一页</button>`
        + `<span class="sw2-ents-hit">命中 <b>${info.hit}</b>　显示第 ${info.from}–${info.to} 条　第 ${info.page} / ${info.pages} 页</span>`
        + `<button class="sw2-btn" data-action="ents-page" data-value="next"${info.page >= info.pages ? ' disabled' : ''}>下一页 ›</button>`
        + `</div>`;
}
```

然后把 `renderEntitiesHtml` 的 `return` 改成：

```js
    const empty = page.hit === 0
        ? '<div class="sw2-ents-empty">没有命中的名号——清掉筛选项或换个词试试。</div>' : '';
    return `<div class="sw2-list-head">全部角色与势力（全册 ${page.total} · 本轮镜头 ${lens.size}）`
        + (page.hit !== page.total ? `<small class="sw2-quiet-note">命中 ${page.hit}</small>` : '')
        + `<small class="sw2-quiet-note" title="面板构建号：改了代码但页面还是旧的时（浏览器缓存），拿这个对照">构建 ${PANEL_BUILD}</small></div>`
        + renderEntsToolbar(world, view)
        + `<div class="sw2-entity-list">${rows.join('')}</div>`
        + empty
        + renderEntsPager(page);
```

★ 若 `view.grp !== 'none'`，`rows` 要按分组切开——**在 Task 3 里先不做**，`grp` 这一档留到 Task 5（分组要动列表容器结构，与 CSS 一起做才自洽）。工具条上那三枚分组钮先照常渲染（点了会改状态，Task 5 才生效）——**这不许留成"假控件"**：Task 5 是同一批工作的一部分，两步之间不许交付给用户。

- [ ] **Step 4: 跑用例确认通过**

Run: `node --test test/render.test.js` → Expected: PASS

- [ ] **Step 5: 跑全量与冒烟**

Run: `node --test` → Expected: **743 pass / 0 fail**（739 + **4** —— Step 1 的代码块是 4 条用例；原写"742/+3"是笔误，已改正）
Run: `node demo/smoke-demo.js` → Expected: **PASS，8231 字节未变**

- [ ] **Step 6: 提交**

```bash
git add src/render.js test/render.test.js
git commit -m "细案实体页 3/5：工具条——搜索/筛选/排序/分页（计数读真源，不写死）"
```

---

## Task 4: 接线层（一份视图状态 + 重绘后恢复焦点）

> ★★ **本任务在 Task 3 里已被"提前完成"**（如实记，不是越界）：`web/index.js` 的接线**必须**与工具条同批落地——
> 既有审计 `test/lookup-batch.test.js:403`「画了 `data-action` 就必须有人接」会在工具条出现的**那一瞬间**把它咬红，
> 不接线则全量判据必红。故 Task 3 已写进：`sw2EntsView` + `sw2EntsViewReset()`（`:1090/1093/171`）·
> 四个动作（`:2965/2975/2983/2988`）· 两处 `entsView` 透传（`:249/1885`）· 搜索框 input 接线 + 焦点/光标恢复（`:3245-3254`）。
> ⇒ **本任务的剩余工作只有：核对 + 补判据**（逐条对照下面的 Step 1/Step 3 是否都已成立），
> 若发现缺口才动手；**不许为了"把任务做完"而重写已成立的接线**。

**Files:**
- Modify: `web/index.js`（仅在核对发现缺口时）
- Test: `test/lookup-batch.test.js`（既有「每个 data-action 都必须有真实处理器」审计会自动咬住新动作——**这是本任务的主要判据**）

**Interfaces:**
- Consumes: Task 3 的控件属性（`ents-filter`/`ents-sort`/`ents-group`/`ents-page` + `data-value`、`#sw2_ents_q`）
- Produces: `sw2EntsView`（模块级 `let`，唯一一份）· `sw2EntsViewReset()` · 动作名 `ents-filter` / `ents-sort` / `ents-group` / `ents-page`
  - ★**无新增渲染函数**：接线走既有的 `refreshSections(['entities'])` 与本仓既有的 `renderCfg()` 通道
    （计划初稿在这里写过一个 `renderEntsView()` 辅助函数，**那会另造一处重绘口子，已作废**；
    实际落地的两个渲染函数是 Task 3 的 `renderEntsToolbar` 与 `renderEntsPager`）

- [ ] **Step 1: 写失败用例（接线审计：新动作必须有处理器）**

★ **先读 `test/lookup-batch.test.js:403-442` 那条审计**——它的机制是**全产物差异检查**，不只是点名断言：

```js
const NON_BUS = new Set(['advance-world']);                                   // :432
const dangling = actions.filter((a) => !handlers.has(a) && !NON_BUS.has(a));  // :433
assert.deepEqual(dangling, [], `★这些动作画了按钮但没有处理器：${dangling.join('、')}`);  // :434
```

即：**只要产物里出现一个没注册处理器的 `data-action`，它就红**。所以：
- Task 3 接线之前，它会因为 `ents-filter`/`ents-sort`/`ents-page` 三个新动作而红（这就是接线被前置的原因）；
- 本任务只需**补一条正向点名断言**（在 `:437` 那行之后追加）：

```js
        // ★细案实体页：工具条与分页器的三个动作必须真的有处理器（全产物差异检查在 :433 已覆盖"有没有漏"，
        //   这一行补的是"点名的这三个必须有"——两组判据分工不同）
        for (const act of ['ents-filter', 'ents-sort', 'ents-page']) {
            assert.ok(handlers.has(act), `★${act} 必须有真实处理器`);
        }
        // ★分组动作 `ents-group` 在 Task 3/4 时**还没有任何控件产生它**（分组钮属 Task 5）——
        //   它的处理器**应该已经注册好**（`web/index.js` 里四个动作是一起加的），但产物里搜不到这个名字。
        //   两条一起锁，把"处理器已备好"与"控件还没上"这两件事**分开说实话**（等 Task 5 加控件后，前半仍成立）。
        assert.ok(handlers.has('ents-group'), '★分组动作的处理器已备好（Task 5 才点亮控件）');
        assert.ok(!actions.includes('ents-group'), '★此刻产物里不该有分组控件（中途不交付死控件）');
```

★ **RED 的形态**（如实说明，别指望一个假的 red）：本任务**大部分会直接绿**，因为三个动作的处理器在 Task 3 已随控件落地。
真正还能红的只有把上面第一条 `for` 里**故意写错一个动作名**来验证断言有效；
**不许为了凑一个 red 而先把已成立的接线删掉**（那正是"为测试而破坏实现"）。
若四条断言全部直接绿 ⇒ 本任务的正确定性是「**核对 + 补判据**」，**报告里就如实写"无 RED，因为接线已被 Task 3 前置完成"**，不要编造 TDD 证据。

- [ ] **Step 2: 跑用例确认失败**

Run: `node --test test/lookup-batch.test.js`
Expected: FAIL —— `★ents-filter 必须有真实处理器`

- [ ] **Step 3: 实现接线**

★ **先改两处 view 透传**（实体页视图态要随渲染进渲染层，与既有 `sw2ChronicleFilter` 完全同款）：

`web/index.js:247`（`refreshWorld` 里）：
```js
        const out = renderAll(world, { config: cfgForRender, oldVolumes, view: { chronicleFilter: sw2ChronicleFilter, entsView: sw2EntsView } });
```
`web/index.js:1874`（`refreshSections` 里）：
```js
        const out = renderAll(sw2LastWorld, { config: renderCfg(), oldVolumes: LISTED_VOLUMES, view: { chronicleFilter: sw2ChronicleFilter, entsView: sw2EntsView } });
```

在 `web/index.js` 第 1079 行 `let sw2ChronicleFilter = null;` 附近加视图态（**同款纪律：纯视图态、不落 SSOT、不落盘、重绘保留、关面板重置**）：

```js
// ★细案 spec-entities-page-ia：实体页的**唯一一份**视图状态
//   （数据逻辑全在 src/render.js 的纯函数里；这里只存状态，一行数据逻辑都不写）
let sw2EntsView = { q: '', kind: 'all', filters: [], grp: 'none', sort: 'active', page: 1 };
const SW2_ENTS_KINDS = new Set(['all', 'faction', 'character']);
const SW2_ENTS_FILTERS = new Set(['busy', 'recent', 'named', 'orphan']);
function sw2EntsViewReset() { sw2EntsView = { q: '', kind: 'all', filters: [], grp: 'none', sort: 'active', page: 1 }; }
```

★ **实写时用下面这一份**（放进 `bus` 注册区，与 `bus['lookup-batch']` 那一带并列）：

```js
    // 细案实体页：改状态 → 只重绘实体页（复用既有 `refreshSections`，它是本仓唯一一处局部重绘通道）
    bus['ents-filter'] = (payload) => {
        const v = String(payload?.value || '');
        if (SW2_ENTS_KINDS.has(v)) sw2EntsView.kind = v;
        else if (SW2_ENTS_FILTERS.has(v)) {
            const i = sw2EntsView.filters.indexOf(v);
            if (i >= 0) sw2EntsView.filters.splice(i, 1); else sw2EntsView.filters.push(v);
        }
        sw2EntsView.page = 1;          // ★换筛选必回第一页（否则"页码夹紧"会让人以为点了没反应）
        refreshSections(['entities']);
    };
    bus['ents-sort'] = (payload) => {
        const v = String(payload?.value || 'active');
        if (['active', 'recent', 'name'].includes(v)) sw2EntsView.sort = v;
        sw2EntsView.page = 1;
        refreshSections(['entities']);
    };
    bus['ents-group'] = (payload) => {
        const v = String(payload?.value || 'none');
        if (['none', 'parent', 'loc', 'kind'].includes(v)) sw2EntsView.grp = v;
        // ★Task 3 评审的 Minor：本动作漏了与三个兄弟一致的"回第一页"复位——
        //   它 Task 3 时还没被点亮（控件在 Task 5），现在点亮了，必须补上：
        //   换分组会改变页数与成员，不回第一页就会出现"页码夹紧"造成的空页错觉。
        sw2EntsView.page = 1;
        refreshSections(['entities']);
    };
    bus['ents-page'] = (payload) => {
        sw2EntsView.page += (String(payload?.value) === 'prev' ? -1 : 1);
        refreshSections(['entities']);
    };
```

★★ **为什么用 `refreshSections(['entities'])` 而不是自己拼 innerHTML**：
① 它是本仓**唯一一处**局部重绘通道（DRY，重绘口径只住一处）；
② 它内部那条"控件正被操作就押后"的闸（`:1879`）只认 `#sw2_view_params / #sw2_view_settings / .sw2-tabs`
（见 `playerIsTouchingParams`，`:203-211`）——**实体页的搜索框不在闸内** ⇒ 打字时照常重绘，不会被押后；
③ 它跑在 `sw2SectionRefreshRunning` 防重入标志里（`:1870`），顺带避开"重绘自己咬自己"。

★ **搜索框焦点**：`refreshSections` 换掉 `innerHTML` 会夺焦点 ⇒ 在 `bindWindowActions` 的 input 处理里
**重绘后把焦点与光标还回去**（这一步不是可选的——不还，用户打到第二个字就掉焦点）：

```js
    win.addEventListener('input', (e) => {
        const q = e.target?.closest?.('#sw2_ents_q');
        if (!q) return;
        const caret = q.selectionStart;
        sw2EntsView.q = String(q.value || '');
        sw2EntsView.page = 1;
        refreshSections(['entities']);
        const again = win.querySelector('#sw2_ents_q');
        if (again) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (_) {} }
    });
```

★ 面板关闭时要重置视图态（照 `sw2ChronicleFilter` 的处置，`:1079` 的注释写着"关面板重置"）：
找到关面板那条路（`sw2ChronicleFilter = null` 只在筛选用例里，真正的"关面板重置"在窗口关闭处理里），
把 `sw2EntsViewReset()` 加进去。**先用 `grep -n "closeWindow\|sw2_window_close" web/index.js` 定位**，照那里的既有写法加。

- [ ] **Step 4: 跑用例确认通过**

Run: `node --test test/lookup-batch.test.js`
Expected: PASS（四个新动作都有处理器）

- [ ] **Step 5: 跑全量判据与冒烟**

Run: `node --test` → Expected: **743 pass / 0 fail**
Run: `node demo/smoke-demo.js` → Expected: **PASS，8231 字节未变**

- [ ] **Step 6: 提交**

```js
git add web/index.js test/lookup-batch.test.js
git commit -m "细案实体页 4/5：接线——一份视图状态 + 只重画本页 + 重绘后恢复搜索框焦点"
```

---

## Task 5: 样式 + 分组落地 + 版位升位 + 文档

**Files:**
- Modify: `web/style.css`（`.sw2-entity-row` 栅格改三列；新增工具条/分组/分页样式；删只服务旧列的规则）
- Modify: `src/render.js`（`grp !== 'none'` 时的分组渲染；`PANEL_BUILD` 升位）
- Modify: `web/index.js`（`CSS_VERSION` 同步升位）
- Modify: `docs/START-HERE.md`（下一动作换成这一笔）

**Interfaces:**
- Consumes: Task 3 的工具条类名 · Task 4 的 `sw2EntsView.grp`
- Produces: `PANEL_BUILD` = **`leg49-entities-three-cols`**（★不含禁词 `agenda`/`tick`/`ssot`/`schema`）· `CSS_VERSION` = `20260916-leg49-entities-three-cols`

- [ ] **Step 1: 写失败用例（分组结构 + 构建号 + 禁词）**

★★ **本步必须同时翻转一条 Task 4 留下的"自失效断言"**（Task 4 评审判定：它是刻意自失效的，
Task 5 点亮分组控件时**必须同一笔改掉**，否则中途全量会红）：
`test/lookup-batch.test.js:449` 现写着 `assert.ok(!actions.includes('ents-group'), '★此刻产物里不该有分组控件')`
⇒ 本笔把它**改成正向**：`assert.ok(actions.includes('ents-group'), '★分组控件已点亮（Task 5 与分组渲染同批）')`。
★同时确认 `web/index.js` 的 `bus['ents-group']` 已补上 `sw2EntsView.page = 1;`（Task 4 评审判定它当时零可观察行为，
约定在本笔补——**先 grep 确认，缺了就补**）。

```js
test('★细案实体页：分组——按归属/位置/类别切成可展开的组，组头带真数', () => {
    const w = world();
    // ★分组控件**在本任务**落地（用户拍板：从 Task 3 移到这里，与分组渲染同批——中途不许有死控件）
    const plain = renderEntitiesHtml(w);
    assert.ok(plain.includes('data-action="ents-group"'), '★分组钮在位（本任务才加）');
    const html = renderEntitiesHtml(w, { view: { grp: 'parent' } });
    assert.ok(html.includes('sw2-ents-grp-block'), '分组容器在位');
    assert.ok(html.includes('<summary'), '组头可展开（details/summary）');
    const none = renderEntitiesHtml(w, { view: { grp: 'none' } });
    assert.ok(!none.includes('sw2-ents-grp-block'), '不分组时不出现分组容器');
});

test('★细案实体页：版位升位且不含引擎术语（构建号在玩家视线内）', () => {
    assert.equal(PANEL_BUILD, 'leg49-entities-three-cols');
    for (const bad of ['agenda', 'tick', 'ssot', 'schema']) {
        assert.ok(!PANEL_BUILD.includes(bad), `构建号不得含「${bad}」`);
    }
});
```

（`PANEL_BUILD` 已在 `test/render.test.js` 顶部 import；没有就补进已有的 import 块。）

- [ ] **Step 2: 跑用例确认失败**

Run: `node --test test/render.test.js`
Expected: FAIL —— `sw2-ents-grp-block` 不存在；`PANEL_BUILD` 仍是 `leg48b-params-page-clean`

- [ ] **Step 3: 实现分组渲染**

**先给工具条补上分组钮**（用户拍板：它从 Task 3 移到这里，与分组渲染同批落地）——
在 `renderEntsToolbar` 的第一行 row 里，紧跟「无归属的」那枚 chip 之后插入：

```js
        + `<span class="sw2-ents-grp">分组</span>`
        + [['none', '不分组'], ['parent', '按归属'], ['loc', '按位置'], ['kind', '按类别']]
            .map(([g, label]) => chip('ents-group', g, label, v.grp === g)).join('')
```

然后在 `renderEntitiesHtml` 里，把拼 `rows` 那段之后、`return` 之前加分组包装（**不分组时零变化**）：

```js
    // 分组（细案 §3.2）：把同一批行按归属/位置/类别切开，组头带真数（details 折叠）
    let body;
    if ((view?.grp ?? 'none') === 'none') {
        body = `<div class="sw2-entity-list">${rows.join('')}</div>`;
    } else {
        const keyOf = {
            parent: (e) => e.parent || '（无归属）',
            loc: (e) => (e.location && e.location !== '未明') ? e.location : '（位置未载）',
            kind: (e) => LABELS.kind[e.kind] || e.kind,
        }[view.grp];
        const groups = new Map();
        page.rows.forEach((e, i) => {
            const k = keyOf(e);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(rows[i]);
        });
        const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
        body = sorted.map(([k, list]) =>
            `<details class="sw2-ents-grp-block" open><summary><span class="sw2-ents-grp-t">${escapeHtml(k)}</span>`
            + `<span class="sw2-ents-grp-c">${list.length} 位</span></summary>`
            + `<div class="sw2-entity-list">${list.join('')}</div></details>`).join('');
    }
```

- [ ] **Step 4: 改样式**

★ **本步还要收 Task 3 评审的 4 条 Minor**（逐条给了修法，只有第 1 条需要动一行逻辑）：
1. **同一事实印两遍**（本仓自己的规矩："同一事实不说两遍"）：表头那句 `<small class="sw2-quiet-note">命中 N</small>`
   与分页器的 `命中 <b>N</b>` 同屏都在说命中数 ⇒ 把表头那句**改成只说"筛掉了多少"、且只在筛选态出现**：
   ```js
   const dropped = page.total - page.hit;
   // ...
   + (page.hit !== page.total ? `<small class="sw2-quiet-note">筛掉 ${dropped}</small>` : '')
   ```
   ⇒ 分页器说"命中多少"、表头说"筛掉多少"，**两个数各说一件事**，不再重复。
2. **搜索框缺无障碍名**：`src/render.js` 的 `<input id="sw2_ents_q" ...>` 加
   `aria-label="搜索名号 / 归属 / 位置 / 实力 / 规模 / 性质"`（本仓其它控件用 `title` 通道，`aria-label` 与之一致）。
3. **`test/render.test.js` 里一条过时注释**（写着「leg49 暂留原位（Task 3 把它收进工具条的「？」里…）」）⇒ 更新成现状。
4. **`src/render.js` 结尾缺换行** ⇒ 补一个（顺便消掉 git 的 `\ No newline at end of file`）。
   ★留档不做的两条：**分组动作 `ents-group` 缺 `page = 1` 复位**（Task 5 点亮它时再加，属 Task 5 范围）·
   **排序钮在面板夹具下 `active` 与 `recent` 同序**（数据层已有专门判据覆盖，属覆盖度 polish）。

`web/style.css` 第 251 行那条 `.sw2-entity-row{display:grid;grid-template-columns:160px 104px ...}` 换成三列：

```css
.sw2-entity-row{display:grid;grid-template-columns:212px minmax(0,1.3fr) minmax(0,1fr);gap:16px;align-items:baseline;padding:7px 12px;border-bottom:1px solid var(--sw2-line-soft);}
.sw2-entity-row.sw2-hot{background:var(--sw2-card-2);border-left:2px solid var(--sw2-amber);}
.sw2-entity-row > *{min-width:0;}
.sw2-relone{font-size:12.5px;line-height:1.5;color:var(--sw2-text-dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.sw2-relone-who{color:var(--sw2-text);}
.sw2-relone-pow{color:var(--sw2-amber);}
.sw2-relone-dim{color:var(--sw2-text-faint);}
.sw2-relone-sep{color:var(--sw2-line);}
.sw2-agcell{font-size:12.5px;line-height:1.5;color:var(--sw2-text);}
.sw2-agstage{color:var(--sw2-text-faint);margin-left:6px;}
.sw2-ents-tools{display:flex;flex-direction:column;gap:7px;margin:8px 0 10px;position:sticky;top:0;background:var(--sw2-panel);z-index:3;padding:6px 0;}
.sw2-ents-tools-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
.sw2-ents-q{flex:1;min-width:200px;padding:6px 10px;border-radius:6px;border:1px solid var(--sw2-line);background:var(--sw2-card);color:var(--sw2-text);font:inherit;}
.sw2-chip{cursor:pointer;padding:4px 11px;border-radius:999px;border:1px solid var(--sw2-line);background:var(--sw2-card);color:var(--sw2-text-dim);font:inherit;font-size:12px;}
.sw2-chip.on{background:var(--sw2-amber-dim);color:var(--sw2-text);border-color:var(--sw2-amber);}
.sw2-chip-n{opacity:.7;margin-left:5px;}
.sw2-ents-grp{color:var(--sw2-text-faint);font-size:11px;letter-spacing:1px;margin-left:4px;}
.sw2-ents-hit{color:var(--sw2-text-dim);font-size:12px;margin-left:auto;}
.sw2-ents-pager{display:flex;gap:10px;align-items:center;justify-content:center;padding:14px 0;}
.sw2-ents-empty{padding:34px;text-align:center;color:var(--sw2-text-faint);}
.sw2-ents-grp-block{margin:0 0 12px;}
.sw2-ents-grp-block>summary{cursor:pointer;display:flex;gap:10px;align-items:baseline;padding:7px 10px;border-radius:7px;background:var(--sw2-card);border:1px solid var(--sw2-line-soft);}
.sw2-ents-grp-t{font-weight:600;}
.sw2-ents-grp-c{color:var(--sw2-text-faint);font-size:12px;}
.sw2-btn-mini{padding:1px 7px;font-size:11px;margin-left:6px;}
```

★ 变量名必须**是 `web/style.css` 里已存在的令牌**（★本计划初稿在这里犯过错：我写了 `--sw2-bg`，**它不存在**）。
开工时先 `grep -n -- '"--sw2-' web/style.css | head -30` 核对。已核实的真名（`:root` 里）：
`--sw2-panel:#1b1f28` · `--sw2-card:#20252f` · `--sw2-card-2:#262c38` · `--sw2-line:#2c3342` ·
`--sw2-line-soft:#242a36` · `--sw2-text:#e8eaef` · `--sw2-text-dim:#9aa3b5` · `--sw2-text-faint:#6b7590` ·
`--sw2-amber:#e3ad55` · `--sw2-amber-dim:rgba(227,173,85,.35)`。
**缺哪个就用最接近的既有令牌，不许新造一个语义重复的。**
同时**删掉**只服务旧列的规则：`.sw2-c-loc{...}`、`.sw2-c-loc .sw2-eattr.nodata{...}`、`.sw2-c-active{...}`、
`.sw2-c-act{...}`、`.sw2-aidle{...}`、`.sw2-orphan{...}`（现 259/275/276/274/269 行）。

- [ ] **Step 5: 升位（构建号与 CSS 版本）**

- `src/render.js`：`export const PANEL_BUILD = 'leg49-entities-three-cols';`（原 `leg48b-params-page-clean`）
- `web/index.js`：`const CSS_VERSION = '20260916-leg49-entities-three-cols';`（原 `20260916-leg48b-params-page-clean`）

- [ ] **Step 6: 跑用例确认通过**

Run: `node --test test/render.test.js` → Expected: PASS

- [ ] **Step 7: 全量判据 + 冒烟 + 真 import**

Run: `node --test` → Expected: **745 pass / 0 fail**
Run: `node demo/smoke-demo.js` → Expected: **PASS，8231 字节未变**
Run: `node --input-type=module -e "await import('./src/render.js'); console.log('OK')"` → Expected: **OK**

- [ ] **Step 8: 真浏览器复验（本仓纪律：判据绿 ≠ 实机好）**

复用 `F:\deepseek\tmp\sw2-ui-pages.mjs`（本次细案建的只读装置）重新出实体页 HTML、截图，确认：
① 看不到位置列与"最近活跃"列；② 在办为空的行没有占位句；③ 工具条在位；
④ 搜索"东海浮空岛"命中 11 位（真账实测值）。
★ 装置要**改成传 view 参数**：`renderAll(world, { view: { entsView: { q: '东海浮空岛' } } })`——
`renderAll` 的 `view` 目前只透传 `chronicleFilter`，本步要顺带给 `entities` 透传 `view.entsView`
（改 `renderAll` 里 `entities: renderEntitiesHtml(world, { config })` → `{ config, view: view.entsView ?? {} }`）。

- [ ] **Step 9: 提交**

```bash
git add src/render.js web/index.js web/style.css test/render.test.js
git commit -m "细案实体页 5/5：样式三列 + 分组落地 + 版位升 leg49-entities-three-cols"
```

---

## Task 6: 文档与验收指引

**Files:**
- Modify: `docs/START-HERE.md`（「下一动作」换成本笔；判据基线 745）
- Modify: `docs/spec-entities-page-ia.md`（状态从"等用户过目"改成"已实施"）

- [ ] **Step 1: 更新 `docs/START-HERE.md` 的「下一动作」**

照 leg48 换档的写法（**接手第一眼看到的必须是真的**）：写明这一笔做了什么、真因、判据数、构建号、
**用户验收三步**（Ctrl+F5 看构建号 → 看不到位置列/活跃列 → 搜「东海浮空岛」应命中 11 位）。

- [ ] **Step 2: 更新细案状态行**

`docs/spec-entities-page-ia.md` 第 3 行 `> 状态：**设计已定稿，等用户过目后开工**（2026-09-16）`
改成 `> 状态：**已实施**（leg49-entities-three-cols · 判据 745/745 · 冒烟 8231 字节未变）——实施记录见下方 §11`。

- [ ] **Step 3: 追加实施记录（§11）**

在细案末尾追加一节：逐条列出 J1–J11 落在哪个用例里、真浏览器复验读数、以及**本笔犯过的错**（若有）。

- [ ] **Step 4: 跑全量判据（文档改动不该影响，但按纪律复跑）**

Run: `node --test` → Expected: **745 pass / 0 fail**

- [ ] **Step 5: 提交**

```bash
git add docs/START-HERE.md docs/spec-entities-page-ia.md
git commit -m "细案实体页 6/6：留档换档 + 实施记录（用户验收三步）"
```

---

## 自检记录（写完计划后自己跑的一遍）

| 检查 | 结果 |
|---|---|
| **规格覆盖** | J1→Task2 · J2→Task2 · J3→Task2 · J4（空态措辞）→ **已并入 J3/J7 的"空态不进版面"**（细案 §5.1 的五套措辞收敛**未做**——它跨八页，属下一刀；**已在细案 §7 登记**）· J5→Task3 · J6→Task2 · J7→Task2 · J8（纯函数锁）→ **既有用例 `:300` 自动咬住**（不用新增）· J9（禁词）→ 既有三条 + Task3 新增一条 · J10→Task1+Task3（首屏 60 行）· J11→Task2 |
| **占位符扫描** | 无 TBD/TODO；每个改代码的步骤都给了完整代码块 |
| **类型一致性** | `selectEntityPage` / `entsHitCounts` / `ENTS_DEFAULT_VIEW` / `ENTS_PAGE_SIZE` / `renderEntsToolbar` / `renderEntsPager` 在 Task 1/3 定义、Task 2/4/5 消费，名字与参数一致；`sw2EntsView` 字段名（`q`/`kind`/`filters`/`grp`/`sort`/`page`）与 `ENTS_DEFAULT_VIEW` 同形 |
| **发现的缺口（已补）** | ① `kindLabel` 对玩家返回「你的棋子」会撞 J11 ⇒ Task 2 Step 3 明写要删那一支；② `（推）` 原来落在位置列 ⇒ Task 2 给了新落点（名号格）+ `lookup-batch.test.js:381` 的处理；③ 分组要动列表容器 ⇒ 单独放 Task 5 与 CSS 同批；④ `renderAll` 不透传实体页 view ⇒ Task 5 Step 8 明写要加 |
| **★ 引用符号逐个核名（本计划初稿在这里错了 5 处，全部已改）** | ① `--sw2-bg` **不存在** ⇒ 真名 `--sw2-panel`；② `sw2PanelConfig` **不存在** ⇒ 真名 `renderCfg()`（`web/index.js:1852`）；③ 我写的 `redrawEntsView()` 会**另造一处重绘** ⇒ 改用本仓唯一通道 `refreshSections(['entities'])`（`:1868`）；④ 实体页查询钮的 action 真名是 **`lookup-entity`**（`src/render.js:660`，不是 `entity-lookup`），force 走 `data-force="absent"`、id 走 `data-entity`；⑤ `sw2-player` 这个类在实体页**根本没用**（真名是 `sw2-entity-row sw2-player`，而我在 Task 2 已把它删掉）⇒ J11 的断言改成"不出现 `sw2-player`"。 |
| **★ 开工前用户拍板四处（已全部写回计划）** | ① 在分支 `leg49-entities-three-cols` 上做（不在 main 直接开工）；② **分组控件从 Task 3 移到 Task 5**（中途不许交付死控件）；③ 页底查书三态注脚改成可展开的「？」（文本必须连续出现，既有两条 `includes` 断言照旧能咬）；④ **「⬇ 补全全册实力」保留**，从页眉挪到工具条第一行。 |
| **★ Task 1 评审的 Minor 定夺（已写回计划）** | ① **排序期望值我写错了**：`sort:'name'` 的正确期望是 `['丙','甲','乙']`（丙 bǐng < 甲 jiǎ < 乙 yǐ），初稿写的 `['丙','乙','甲']` 既非拼音序也非笔画序 ⇒ 已改正并留档**产品面已知限制**：ICU 78.3 无拼音排序数据（`collation` 解析为 `default`），真账实测走**部首/笔画序**（末尾「祝无双·转轮鬼圣·转轮鬼使·转轮王·追风·坐忘大罗」被拆散）；本笔选"接受默认序"（零依赖 + 确定性；真正的入口是搜索，不是排序）。② 空结果 `from/to` **按意图都是 0**，分页器不印「显示第 0–0 条」。③ `entsSearchTextOf` 不再收「未明」（占位词不是内容，否则搜「未明」命中 475 人）。④ `recent/named/orphan` 两个调用点各写一遍谓词——评审说现在**过早**（只有两处），**留到 Task 3 接 chip 时若出现第三处消费者再提成一张表**。 |
| **★ 一个会直接弄坏功能的陷阱（已查清并写进 Task 4）** | `refreshSections` 里那条"控件正被操作 ⇒ 押后重绘"的闸只认 `#sw2_view_params / #sw2_view_settings / .sw2-tabs`（`playerIsTouchingParams`，`:203-211`）——**实体页不在闸内** ⇒ 用 `refreshSections(['entities'])` 时打字会照常重绘。若当初照我第一版自己拼 `innerHTML`，就绕过了 `sw2SectionRefreshRunning` 防重入标志，会重新引爆 leg27 那次的"重绘自己咬自己"。 |
| **承重墙** | 六个任务没有一处碰 `settle.js`/`pack.js`/`gate.js`/`check-step.js`/schemas；`MAIN_PROMPT_V` 全程未升 |
| **判据数推演** | 基线 731 ⇒ T1 +4（735）⇒ T2 +4（739）⇒ **T3 +4（743，不是 742）** ⇒ T4 +0（审计用例内加断言）⇒ T5 +2（745）⇒ T6 +0（745）。★**T3 那一格我原推演写 +3 是错的**：Step 1 的代码块里**本来就是 4 个 `test(...)`**（标题与 Step 5 写的"3 条"是我笔误）——实现者按代码块逐字落地、报了 743，**以代码块为准**。 |

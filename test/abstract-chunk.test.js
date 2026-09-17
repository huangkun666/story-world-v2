// story-world-v2/test/abstract-chunk.test.js
// 第十八棒：大书分段多调用（v1 范本对齐——设定五件套=头 3 万单发；书名录=全条目分块多调用，
// 拆半自适应 + 失败降级 + 全书级出处校验）。小书（≤3 万）单发行为零变化（abstract.test 基线）。
// leg24 片1（停抄书）：关系轮/属性轮调用点已删——大书调用数 = 1 次五件套 + 每块 1 次；
// 并新增两条锁：①两轮 prompt 不许过问书里的上级/所在/属性 ②抄书流水线的函数与常量确实退场（删除位锁）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractWorldSetting, CANON_SRC_CHAR, ROSTER_CHUNK_CHAR, SETTING_CHUNK_CHAR, ROSTER_CHUNK_DEPTH, chunkRows, buildAbstractPrompt, buildRosterPrompt, dedupeRoster } from '../src/abstract.js';

// 测试书：k0..k(n-1) 条目行（约 210 字符/条）；名号藏在条目深处（第 3 个词）
function makeBook(n) {
    const rows = [];
    for (let i = 0; i < n; i += 1) {
        rows.push(`【k${i}】名号${i} ` + '字'.repeat(200));
    }
    return rows.join('\n');
}

function parseNames(text) {
    const out = [];
    const re = /【k(\d+)】(\S+)/g;
    let m;
    while ((m = re.exec(text))) out.push({ name: `名号${m[1]}`, kind: 'character' });
    return out;
}

// 确定性 mock：从输入原文里提取名号回填 bookEntities（只提取不创作）；可注入"超过 X 字符即坏"模拟大块失败
function makeExtract({ maxOk = Infinity, calls = null } = {}) {
    const extract = async (prompt) => {
        if (calls) calls.push(prompt.length);
        const header = '———— 设定原文如下 ————';
        const src = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        if (Array.from(src).length > maxOk) return '这不是 JSON';
        const bookEntities = parseNames(src);
        if (!bookEntities.length) bookEntities.push({ name: '书内无名的世界', kind: 'character' });
        return JSON.stringify({
            powerScale: [{ level: '顶层', note: '主宰一方。' }],
            rules: ['法则一（原文）'],
            society: '社会格局（原文）',
            techOrMagic: '力量体系（原文）',
            historyNotes: ['史略一（原文）'],
            bookEntities,
            // ★leg61：**属性遍**（`buildSettingPrompt` 问的是 `entities`）——mock 照形状回一条：
            //   值必须是"本段原文里逐字能找到的"（出处闸），所以这里抄原文里真实存在的填充串。
            entities: [{ name: '书内无名的世界', kind: 'character', fields: { 表外属性名: '字'.repeat(50) } }],
            tension: { polarity: '正邪', direction: '邪压正' },
            env: {},
        });
    };
    return extract;
}

const EMPTY_CACHE = () => ({ map: new Map(), get(k) { return this.map.get(k) ?? null; }, set(k, v) { this.map.set(k, v); } });

// ★leg60：**题名面**（零 token 的 cast）在大书路径上也要过——并册 + 全书级出处判定放行。
//   为什么单独一条：大书路径有一道"全书级出处校验"（`src.includes(name)`，纯编造才丢），
//   而题名面剥出来的名号**可能只出现在题名里、正文一个字都没有**（三国 `张辽正史` 这类条目是禁用的）。
//   ⇒ 出处判定的口径扩成"src ∪ 题名面"：**题名也是这本书的一部分**（判据不是"我们觉得像名字"，
//   而是"它被作者当名字用过"——是某条条目的 key）。
test('★leg60 题名面：大书路径下模型漏掉的名号也强制并册，且过全书级出处判定', async () => {
    const filler = Array.from({ length: 700 }, (_, i) => `【f${i}】` + '字'.repeat(200)).join('\n');
    const src = `${filler}\n【控制器_A】与名号无关的正文。`;
    assert.ok(Array.from(src).length > CANON_SRC_CHAR, '前置：确为大书');
    const extract = async () => JSON.stringify({ bookEntities: [{ name: 'f0', kind: 'character' }] });
    const r = await extractWorldSetting({
        sourceText: src, extract, cache: null,
        extraDeclared: [{ name: '只在题名里出现过的名号' }],
    });
    assert.equal(r.ok, true);
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('只在题名里出现过的名号'), '★题名面并册（src 正文里根本没有它，仍算"书里有据"）');
    assert.ok(names.includes('f0'), '模型抽到的名号照旧入册（题名面不挤掉任何人）');
    const only = r.setting.frozen.canon.bookEntities.find((b) => b.name === '只在题名里出现过的名号');
    assert.equal(only.kind, undefined, '★题名面判不出类别 ⇒ 不写 kind（不猜；下游按既有缺省走）');
});

test('chunkRows：行级分块按累计字符，超长单行自成一块', () => {
    const rows = ['a'.repeat(10), 'b'.repeat(10), 'c'.repeat(30)];
    assert.deepEqual(chunkRows(rows, 25), ['a'.repeat(10) + '\n' + 'b'.repeat(10), 'c'.repeat(30)]);
    assert.deepEqual(chunkRows(rows, 100), [rows.join('\n')]);
});

test('★leg60 大书分块：调用 = **每块 1 次**（五件套与名册同轮一遍抽完），全量覆盖（尾部名号不丢）', async () => {
    const src = makeBook(2000); // ≈ 42 万字符（含尾部 字 填充）——超 3 万触发分块
    const lenA = Array.from(src).length;
    assert.ok(lenA > CANON_SRC_CHAR, '前置：确为大书');
    const calls = [];
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache: null });
    assert.equal(r.ok, true);
    // ★leg60 改口径：**不再有"五件套单发"那一次**——五件套与名册在同一批块里一遍抽完。
    //   旧法 = 1 次（头 3 万，只抽设定）+ N 次（读全，只抽名册）= 同一本书喂两遍；
    //   真账代价：三国真档位表在 3 万之外 ⇒ 模型照抄了窗口里的【声誉】十级当力量谱系。
    // ★leg61：块尺寸改由 `SETTING_CHUNK_CHAR`（30000）决定——那个 60000 是 leg21 给"只报名号"定的，
    //   两遍抽取之后 6 万的块在 600 秒网关限下必然超时（实测级联拆半：大荒 22 次调用/1909 秒）。
    const expectChunks = Math.ceil(lenA / SETTING_CHUNK_CHAR);
    // ★★★leg61 改口径：**每块调用 1 次 → 每块 2 次**（名册遍 + 属性/设定遍）。
    //   依据（真机实测，装置 `F:\deepseek\tmp\leg61-live-roster-ab.js`）：同一批块、同一模型，
    //   "只报名号"去重 1022 个名号 vs "七样一起问"去重 364 个——差的是**每个名号的输出成本**
    //   （~57 字符 vs ~188 字符），不是输出装不下（预算还余 4,000 token）。
    //   ⇒ 名册与属性各拿一份只干一件事的提示词；**代价写在锁里**（调用数上界 2×块数），不许悄悄变。
    const upper = expectChunks * 2;
    assert.ok(calls.length >= expectChunks && calls.length <= upper,
        `每块 1~2 次调用（名册遍 + 属性遍；实际 ${calls.length} 次 / 块数 ${expectChunks}）`);
    assert.ok(calls.length > expectChunks, '★两遍抽取真的跑了（属性遍不是空转）');
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('名号1999'), '尾部条目名号全量覆盖（v1 教训：名字密集段不许头截断）');
    assert.equal(new Set(names).size, names.length, '合并去重');
    // 名号顺序 = 书序（k0 在前，k1999 在后）
    assert.equal(names[0], '名号0');
    assert.equal(names[names.length - 1], '名号1999');
    // ★leg60 新锁：mock 每块都交**同一条** powerScale/rules ⇒ 块间**并集去重**后必须只剩 1 条（不是 N 条）
    assert.equal(r.setting.frozen.canon.powerScale.length, 1, '块间并集去重（N 块交同一条 ⇒ 最终 1 条，且 note 不丢）');
    assert.equal(r.setting.frozen.canon.powerScale[0].note, '主宰一方。', 'note 随 level 一起留下');
    assert.deepEqual(r.setting.frozen.canon.rules, ['法则一（原文）'], 'rules 同样并集去重');
    assert.equal(r.setting.frozen.canon.society, '社会格局（原文）', '一句话型字段取到值（不是空）');
});

test('leg25 g：跨块别名合并——去重键 = 名字 ∪ 别名，先见到的当正名，叫法一个不丢', () => {
    // 场景来自**真模型实测**（gemini-3.1-pro-preview 跑真书两块）：
    //   块1 看得到条目定义 ⇒ 出 `人族皇朝`，aliases=[大虞, 大虞皇朝]；
    //   块2 看不到定义   ⇒ 出 `大虞皇朝`，aliases=[人族皇朝, 大虞]   ← **指向正好相反**。
    // ★裁决**故意保持最简**：先见到的当正名，其余叫法全进 aliases。
    //   我一度加过一套四层排序裁决（书里真有 `【名】` 条目 > 不是长名截断 > 被指认次数 > 名字长度），
    //   每一层都在修上一层的洞，且当场出真 bug（`isTruncation` 写宽 ⇒ `【名号10】` 里的"名号1"被判成截断
    //   ⇒ `名号1000..1999` 排在队首、反把 `名号0..999` 当别名吃掉，既有书序锁当场红）。
    //   ⇒ **"哪个叫法当 name"是次要诉求**，主诉求只有两条：①合成一条（不碎片化）②叫法不丢。故整组裁掉。
    const chunk1 = [{ name: '人族皇朝', kind: 'faction', aliases: ['大虞', '大虞皇朝'], fields: { 规模: '方圆7500万里' } }];
    const chunk2 = [{ name: '大虞皇朝', kind: 'faction', aliases: ['人族皇朝', '大虞'] }, { name: '虞昭华', kind: 'character' }];

    const merged = dedupeRoster([...chunk1, ...chunk2]);
    const dy = merged.filter((m) => ['人族皇朝', '大虞皇朝', '大虞'].includes(m.name));
    assert.equal(dy.length, 1, '★三个叫法必须合成**一条**（治碎块的目的）');
    const all = [dy[0].name, ...(dy[0].aliases || [])];
    for (const n of ['人族皇朝', '大虞皇朝', '大虞']) assert.ok(all.includes(n), `叫法「${n}」不许丢`);
    assert.equal(dy[0].fields?.规模, '方圆7500万里', '拼字段：已有的不丢');
    assert.ok(merged.some((m) => m.name === '虞昭华'), '无关条目不受影响');
    assert.ok(!merged.some((m) => m.name === '大虞'), '别名不许作为独立条目留下');

    // 顺序无关：颠倒两块仍只有一条（正名可以随顺序变，但**条数**不许变）
    const flipped = dedupeRoster([...chunk2, ...chunk1]);
    assert.equal(flipped.filter((m) => ['人族皇朝', '大虞皇朝', '大虞'].includes(m.name)).length, 1,
        '★颠倒后仍是**一条**');

    // 书序锁定：同形条目一律保持原顺序（我加排序裁决时把这条弄红过，留锁防复发）
    const many = Array.from({ length: 1200 }, (_, i) => ({ name: `名号${i}`, kind: 'character' }));
    const kept = dedupeRoster(many).map((e) => e.name);
    assert.equal(kept.length, 1200, '同形条目不许被误合并');
    assert.equal(kept[0], '名号0');
    assert.equal(kept[1199], '名号1199');

    // 同名只留一条，缺的字段由后一条补上
    const plain = dedupeRoster([{ name: '甲', kind: 'faction' }, { name: '甲', kind: 'faction', parent: '乙' }]);
    assert.equal(plain.length, 1, '同名只留一条');
    assert.equal(plain[0].parent, '乙', '缺的字段由后一条补上');
    // 空/缺名条目直接丢（不许污染名册）
    assert.equal(dedupeRoster([{ aliases: ['x'] }, null, { name: '  ' }]).length, 0, '缺 name 的条目丢弃');
});

test('★leg60 一块里名册与设定同轮抽（旧"名册轮只问 name/kind / 不许问 powerScale"按新口径改写）', async () => {
    const src = makeBook(200);
    const prompts = [];
    const extract = async (prompt) => {
        prompts.push(prompt);
        const header = '———— 设定原文如下 ————';
        const part = prompt.includes(header) ? prompt.slice(prompt.indexOf(header) + header.length) : '';
        return JSON.stringify({ bookEntities: parseNames(part) });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.ok(prompts.length >= 1, '确实发起块调用');
    const p = prompts[0];
    // ① 停抄书口径**整条不倒退**（leg24 片1 的守门原样留着——合并提示词最容易顺手把它带回来）
    assert.ok(!/hardPower|softPower|intel|"attrs"|"race"|"依据"/.test(p), '仍不问四维属性/种族/原文依据（停抄书）');
    // ② ★leg60 新口径：同一块里**必须**问设定（旧锁是"名册轮不许问 powerScale/situation"——
    //    合并成一份提示词后那条锁的语义反了：现在**不问才是 bug**，所以正反两面都锁）
    assert.match(p, /"powerScale"/, '★合并轮必须抽力量谱系（旧口径：名册轮不许问——已按 leg60 改写）');
    assert.match(p, /"situation"/, '★世情句必须抽（真账：三国把它抽成了"天下大势发生重大变故（如黄巾起义…）"）');
    assert.match(p, /"rules"/, '法则必须抽');
    assert.match(p, /"society"/, '社会格局必须抽');
    assert.match(p, /"techOrMagic"/, '力量/生态体系必须抽');
    assert.match(p, /"historyNotes"/, '史略必须抽');
    assert.match(p, /这一段（本块）里有什么就抽什么/, '★写明"一块里有什么就抽什么"（分块按书序，不按数据类型切）');
    // ③ 名册纪律原样在位（这些锁沿用旧测试，一条不删）
    assert.match(p, /不要给它们标 faction/, '种族禁令名单式强化在位（人族/妖族/鬼族…不算势力）');
    const tplText = p.slice(p.indexOf('形状如下；可省字段不写 null）：') + '形状如下；可省字段不写 null）：'.length, p.indexOf('\n纪律：'));
    const tpl = JSON.parse(tplText);
    assert.deepEqual(Object.keys(tpl.bookEntities[0]), ['name', 'aliases', 'kind'], '第一形态：名号 + 别名 + 类别');
    const charTpl = tpl.bookEntities.find((x) => x.kind === 'character');
    assert.deepEqual(Object.keys(charTpl.fields), ['所属', '身份', '定位', '实力'], '★角色属性组 = 所属/身份/定位/实力');
    const facTpl = tpl.bookEntities.find((x) => x.kind === 'faction');
    assert.deepEqual(Object.keys(facTpl.fields), ['性质', '倾向', '规模'], '★势力属性组 = 性质/倾向/规模（规模≠角色档位）');
    // ★leg60 新增：三个形态都要带 aliases（旧模板只在第一形态写了它 ⇒ 模型从不给角色/势力交别名）
    assert.deepEqual(Object.keys(charTpl).sort(), ['aliases', 'fields', 'kind', 'name'], '角色形态也带 aliases');
    assert.deepEqual(Object.keys(facTpl).sort(), ['aliases', 'fields', 'kind', 'name'], '势力形态也带 aliases');
    assert.match(p, /所属（角色的所属势力）= 必抄项/, '★所属是必抄项，写明"不许推测、不许按常识分配"');
    assert.match(p, /实力（角色的档位）= 必抄项/, '★实力是必抄项（照抄原话、不套别书档位）');
    assert.match(p, /不许套用别的书的档位体系/, '挡"套档位"的那句纪律在位');
    // ④ 设定那一段的形状与名册**同在一份 JSON**（一处定义：CANON_SHAPE，两个 builder 共用）
    //    ★leg60 起多一项 `dims`（维度/刻度）——它是"书里的尺子"，进包当锚（`pack.js` 的 buildScaleAnchor）
    //    ★★leg62 起多一项 `刻度`（**概念表**）：书里的尺子按"一把尺 = 一张表"交，
    //       `powerScale`/`dims` 两列保留在形状里（老账与 `buildAbstractPrompt` 的兼容面），
    //       但**生产提示词明确要求模型不要再交它们**（净化层以 `刻度` 为源、旧两列由它派生）。
    //    ★★★leg64 起多一项 `判据`（**法则的类别**，与 `rules` 按位对齐）：决定哪几条法则进每轮包。
    assert.deepEqual(Object.keys(tpl).sort(), ['bookEntities', 'dims', 'env', 'historyNotes', 'powerScale', 'rules', 'situation', 'society', 'techOrMagic', 'tension', '判据', '刻度'],
        '★一份 JSON 里同时有设定（含维度/刻度/概念表/法则类别）与名册（leg60 的"一遍抽完"）');
    // ★★leg62：概念表必须是**第一项**（模型按形状办事，先看到的那一项最容易被交出来）
    assert.equal(Object.keys(tpl)[0], '刻度', '★概念表排在最前（形状的第一项就是它）');
    // ★★★leg64：`判据` 必须**紧挨** `rules`（形状里"这一条法则是什么类"就写在法则下面，模型不易漏）
    //   ★按**相邻性**锁，不写下标字面量：本笔第一版这里写的是 `slice(3, 5)`，而它假定
    //     "rules 一定在第 3 位"——那个位置由 `刻度` 与 `CANON_SHAPE` 的展开顺序共同决定，
    //     加一项或调一次顺序它就红，而**红的不是被锁的那件事**（正是本仓"判据锁了字面量、
    //     没锁性质"的老病）。要锁的性质只有一条：**`判据` 紧跟在 `rules` 后面**。
    const shapeKeys = Object.keys(tpl);
    assert.equal(shapeKeys[shapeKeys.indexOf('rules') + 1], '判据', '★判据紧挨 rules（按位对齐那一列）');
    assert.ok(p.includes('与 `rules` 逐条对齐'), '★分类口径真的写进了提示词（共用 `RULE_CLASS_GUIDE`）');
    assert.ok(p.includes('大多数法则都属于"其他"'), '★明写"大多数是其他"（不这么写，判据那一类会被灌满 ⇒ 等于整包塞进去）');
    assert.match(p, /一律交进 `刻度` 字段/, '★写明刻度一律交进 `刻度`（概念表口径）');
    assert.match(p, /不要\*\*另外交 `powerScale` \/ `dims`/, '★写明不要另交 powerScale/dims（防同一档存两份 + 白烧输出预算）');
    assert.match(p, /一把尺 = 一张表|同一套等级记号、用来描述同一个概念/, '★概念表的定义在位（"一张表"=同一套记号描述同一个概念）');
    assert.match(p, /不同的概念\*\*必须分开成不同的表/, '★"制度与刻度必须分表"在位（用户截图那个混排的根治）');
    assert.match(p, /对"大境界"的细分（第一阶\/第二阶…）\*\*不另立一张表\*\*/, '★小阶当子表（用户拍：「当子表」）');
    assert.match(p, /紧凑：不要缩进、不要换行/, '★紧凑序列化（真机实测：原预算下就 finish=stop，输出短 44%）');
    assert.match(p, /"dims"/, '★维度/刻度要抽（真账：三国的 `勇武|韬略|内政|统御|气度|健康: range: -100~100`）');
});

test('leg24 片1：抄书流水线的函数与常量整条退场（删除位锁——防无声复活）', async () => {
    const mod = await import('../src/abstract.js');
    for (const gone of ['buildAttrsPrompt', 'buildRelationPrompt', 'runAttrsRound', 'runRelationRound',
        'validateRosterDetails', 'applyRosterAttrs', 'refineEntityAttrs',
        'ATTRS_BATCH_MAX', 'ROUND_BATCH_CHAR']) {
        assert.equal(mod[gone], undefined, `${gone} 应已删除（停抄书）`);
    }
    for (const kept of ['buildAbstractPrompt', 'buildRosterPrompt', 'extractWorldSetting', 'seedBookEntities',
        'scanBookDeclarations', 'applyDeclaredToRoster', 'resetDynamicLayer']) {
        assert.equal(typeof mod[kept], 'function', `${kept} 仍在（片1 不动它）`);
    }
    // 两条 prompt 的正面口径锁（与上一条测试的"不许问"互补：该问的一个不能少）
    assert.match(buildAbstractPrompt('书文'), /"bookEntities"/, '名号+类别仍抽（账本主键）');
    assert.match(buildRosterPrompt('书文', [{ name: '界渊长城' }]), /界渊长城/, '照书办召回清单仍在');
});

test('小书（≤ 3 万）单发：仅 1 次调用（既有行为零变化）', async () => {
    const src = makeBook(100); // ≈ 2.1 万字符
    const calls = [];
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache: null });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.ok(r.setting.frozen.canon.bookEntities.some((b) => b.name === '名号99'));
});

test('块失败自适应拆半：大块坏（>50k）→ 对半拆到底仍全量（v1 tryChunk 同款）', async () => {
    const src = makeBook(3000); // ≈ 63 万字符 → 首层 ~11 块，多数 >50k 会触发拆半
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ maxOk: 50000 }), cache: null });
    assert.equal(r.ok, true, '拆半后整体成功');
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('名号2999'), '尾部名号在拆半后仍全量覆盖');
    assert.ok(names.length > 2000, `合并几乎无损（实际 ${names.length} 个名号）`);
});

test('单块彻底失败：降级不阻塞其余块，ok 仍 true 且 errors 带警告', async () => {
    const src = makeBook(2000);
    let calls = 0;
    const extract = async (prompt) => {
        calls += 1;
        const header = '———— 设定原文如下 ————';
        const part = prompt.slice(prompt.indexOf(header) + header.length);
        // 第 2 块（第一次块调用=第 2 次总调用）恒坏：只给首块 10 条以内的输入放行
        if (Array.from(part).length > 200 && calls >= 3 && ROSTER_CHUNK_DEPTH > 0) return '坏块'; // 第 3 次起（第 2 块起）全坏
        return JSON.stringify({ bookEntities: parseNames(part), powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true, '首块成功即可 ok（书名录部分成功不阻塞）');
    assert.ok(r.errors.length >= 1, '降级警告在 errors 中如实可见');
    assert.ok(r.setting.frozen.canon.bookEntities.length > 0);
});

test('全部失败（五件套坏 + 各块坏）：ok=false 世界不动', async () => {
    const src = makeBook(2000);
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ maxOk: 0 }), cache: null });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length >= 1);
});

test('全书级出处校验：原文没出现的名号弃（纯编造才丢，v1 同款）', async () => {
    const src = makeBook(500); // ≈ 10.5 万字符 → 分块
    const extract = async (prompt) => {
        const header = '———— 设定原文如下 ————';
        const part = prompt.slice(prompt.indexOf(header) + header.length);
        const bookEntities = parseNames(part);
        bookEntities.push({ name: '凭空出现的尊者', kind: 'character' }); // 编造
        return JSON.stringify({ bookEntities, powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(!names.includes('凭空出现的尊者'), '编造名号被弃');
    assert.ok(r.errors.some((e) => e.includes('出处校验')), '弃置留痕');
});

test('大书缓存命中：零调用（同一本书只抽一次，v1 拍板语义）', async () => {
    const src = makeBook(2000);
    const cache = EMPTY_CACHE();
    const calls = [];
    const first = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache });
    assert.equal(first.ok, true);
    const callsAfterFirst = calls.length;
    assert.ok(callsAfterFirst > 1);
    const second = await extractWorldSetting({ sourceText: src, extract: makeExtract({ calls }), cache });
    assert.equal(second.ok, true);
    assert.equal(second.cached, true);
    assert.equal(calls.length, callsAfterFirst, '命中后零新增调用');
});

test('空输出自动重试一次：首调空、二调成功 → ok（v1 瞬时网关空回复教训）', async () => {
    const src = makeBook(50); // 小书单发路径
    let calls = 0;
    const extract = async () => {
        calls += 1;
        if (calls === 1) return '';
        return JSON.stringify({ bookEntities: parseNames(src), powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [], tension: {}, env: {} });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true);
    assert.equal(calls, 2, '空响应后自动重试一次');
    assert.ok(r.setting.frozen.canon.bookEntities.length > 0);
});

test('两次皆空 → ok=false 且 errors 注明已重试', async () => {
    const r = await extractWorldSetting({ sourceText: makeBook(50), extract: async () => '', cache: null });
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes('已重试'), '失败说明带重试语义');
});

test('分块抽取确定性：同输入同 mock 两次产物逐字节一致', async () => {
    const src = makeBook(600); // ≈ 12.6 万字符
    const input = { sourceText: src, extract: makeExtract(), cache: null, extractedAt: '2026-09-09T00:00:00.000Z' };
    const a = await extractWorldSetting(input);
    const b = await extractWorldSetting(input);
    assert.deepEqual(a.setting, b.setting);
    assert.deepEqual(a.errors, b.errors);
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27（用户令「二十多分钟很慢，你做吧」）：**超时 ≠ 瞬时错**——超时**止损跳过**，不许对半拆/重试。
// 病（读真码 + 实测真书算出来的）：旧法把超时并进"抽取调用失败"，于是走 v1 的拆半自适应路：
//   超时 → 对半拆（每半再各超时）→ 拆到 depth=4 → 保底重试 → 全败才降级
//   ⇒ 单块最坏 31 次调用 × 120 秒 ≈ **62 分钟**，而这 62 分钟之后**结果仍是跳过**（纯烧时间不长数据）。
//   ★关键：拆小的是**输入**，而超时主因是**生成时间**（输出预算 16,384 tokens/次固定，reasoning 还占盘）
//     ⇒ "对半拆"这条药对超时**无效**，必须分治。
// 真账实测规模（`demo/match-source-fingerprint.js` + `demo/diag-leg25g-chunks.js`）：
//   大荒-姬元真.json = 235 条 / 265,866 字符 / 213 行 / **5 块**，块大小 [59215, 58673, 59892, 58902, 30344]。
// 造超时（形态与真 transport 一致：`sw2Timeout=true`，见 `transport-http.js` 的 markTimeout）
const timeoutErr = () => Object.assign(new Error('主调用超时（300000ms，提案）'), { sw2Timeout: true });

test('★leg27：某块**超时** ⇒ 只调一次即止损跳过（不对半拆、不保底重试），且块号/原因如实进 errors', async () => {
    const src = makeBook(2000);   // 大书 → 头 1 次 + N 块
    const calls = [];
    let timedOutInput = null;
    const extract = async (prompt) => {
        calls.push(prompt);
        // 只让**第 2 次调用**（第一块）超时——其余块的输入与那次**逐字节相同**却会成功，
        // 所以"后续有没有再调"完全由**引擎的重试策略**决定，与输入内容无关（这才是这条锁要的对照）。
        if (calls.length === 2) {
            timedOutInput = prompt;
            throw timeoutErr();
        }
        const header = '———— 设定原文如下 ————';
        const part = prompt.slice(prompt.indexOf(header) + header.length);
        return JSON.stringify({ bookEntities: parseNames(part) });
    };
    const r = await extractWorldSetting({ sourceText: src, extract, cache: null });
    assert.equal(r.ok, true, '一块超时不该拖垮全局（其余块照常）');
    const fails = r.timing.steps.filter((e) => e.phase === 'finish' && e.ok === false);
    // ★"先证红"的判据：旧法（超时并进瞬时错）走对半拆 → 该块那一次超时会引发 2/4/8… 次后续失败
    assert.equal(fails.length, 1, `★恰好 1 次失败事件（对半拆会让它变成 2/4/8… 次，实际 ${fails.length}）`);
    // ★结构性最强的一条：超时之后，**同一份输入再也没被送出去过**（拆半/保底重试都会重发或改发）
    assert.ok(timedOutInput, '夹具前提：确实有一次超时调用');
    const resent = calls.filter((p) => p === timedOutInput).length;
    assert.equal(resent, 1, `★超时那一刻的输入**只发出过 1 次**（旧法会拆半/重发 ⇒ >1，实际 ${resent}）`);
    assert.ok(fails[0].error.includes('超时'), `失败原因写明"超时"（实际：${fails[0].error}）`);
    assert.ok(r.errors.some((e) => /第 \d+\/\d+ 块抽取失败/.test(e)), '★errors 必须写明**是哪一块**（旧法只说"块抽取失败"，丢了多少数据不说）');
});

test('★leg27 对照：瞬时错（空响应）**仍然**拆半自适应（v1 语义不许被超时分治误伤）', async () => {
    const src = makeBook(3000);   // ≈ 63 万字符：首层约 11 块，多数 >50k
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract({ maxOk: 50000 }), cache: null });
    assert.equal(r.ok, true, '拆半后整体成功');
    const names = r.setting.frozen.canon.bookEntities.map((b) => b.name);
    assert.ok(names.includes('名号2999'), '尾部名号在拆半后仍全量覆盖');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// leg27：**抽取过程可见**（用户原话「**我也看不到日志不知道抽得怎么样**」）。
// 病（真码确认）：抽取期间一行进度都没有——状态栏只在开头写一句、之后不动；控制台只在**全部结束**才出声
//   ⇒ 6 次调用是黑盒，"正在跑"与"已经卡死"在界面上完全同形（用户实机等 20+ 分钟无从判断）。
// 判据按**结构**写（本仓 leg26 的教训：按字面写会"全绿状态下不红"）：
//   ①每段必须**成对**出现 start/finish（配对数量，不是文案）
//   ②finish 必须带 start 时同样的 chars、真实的 ms、成败布尔
//   ③上报函数抛错**不许影响抽取**（观测面不能成为故障点）
test('★leg27：进度上报按"段"成对出现（start/finish 配对）+ 带真实字符数与耗时', async () => {
    const src = makeBook(600);   // ≈ 12.6 万字符 → 分块
    const events = [];
    const r = await extractWorldSetting({
        sourceText: src, extract: makeExtract(), cache: null,
        onProgress: (ev) => events.push({ ...ev }),
    });
    assert.equal(r.ok, true);
    const starts = events.filter((e) => e.phase === 'start');
    const finishes = events.filter((e) => e.phase === 'finish');
    assert.ok(starts.length >= 2, `多段上报（实际 start ${starts.length} / finish ${finishes.length}）`);
    assert.equal(starts.length, finishes.length, '★start/finish 必须**一一配对**（少一个 = 某段静默，正是这次的病）');
    // 配对键 = step + index；且每对 chars 一致（同一个段的输入不该被改写）
    for (const s of starts) {
        const f = finishes.find((x) => x.step === s.step && x.index === s.index);
        assert.ok(f, `${s.step}#${s.index} 必须有 finish（不许只报开始不报结束）`);
        assert.equal(f.chars, s.chars, `${s.step}#${s.index} 的 chars 前后一致`);
        assert.equal(typeof f.ms, 'number', `${s.step}#${s.index} 必须带真实耗时 ms`);
        assert.ok(f.ms >= 0, 'ms 非负');
        assert.equal(typeof f.ok, 'boolean', '成败是布尔事实，不是文案');
    }
    // ★★★leg61 改口径（这一条的来历值得留着）：leg60 曾把"五件套段"取消（设定与名册同一批块一遍抽完），
    //   本棒又把它**请回来了**——因为实测发现"一遍抽完"的代价是**名册产量掉 2.8 倍**
    //   （同一批块：只报名号 1022 个 vs 七样一起问 364 个；每个名号的输出成本 ~57 vs ~188 字符）。
    //   ⇒ 现在 `canon` 段 = **属性+设定遍**（`buildSettingPrompt`），`chunk` 段 = 名册遍。
    //   ★旧锁"不许有 canon 段"因此**按设计作废**（不是回归）：它锁的是 leg60 的合并口径，那个口径已被实测否掉。
    //   现在锁的是**新的两遍口径**：两段一一配对、且属性遍覆盖全书（不是只读头 3 万）。
    assert.ok(finishes.some((e) => e.step === 'canon'), '★leg61：属性+设定遍必须在进度面出声（回归 leg27 的"全程可见"）');
    const chunkChars = finishes.filter((e) => e.step === 'chunk').reduce((n, e) => n + e.chars, 0);
    const allChars = Array.from(src).length;
    const expectChunkChars = Array.from(src.split('\n').map((s) => s.trim()).filter(Boolean).join('\n')).length;
    // 块是"行级分块"：块**内部**的行间换行保留，块与块**之间**那一个换行不出现（join 的边界）
    //   ⇒ 块字符数之和 = 全书 − (块数 − 1)。这不是丢内容，是分块本身的算术。
    const chunkCount = finishes.filter((e) => e.step === 'chunk').length;
    assert.equal(chunkChars + (chunkCount - 1), expectChunkChars,
        `块覆盖**整本书**（块 ${chunkChars} + 边界换行 ${chunkCount - 1} vs 全书 ${allChars}）`);
    // 返回值里带得走（界面/诊断要能复述"这次多少段、多少耗时"）
    assert.equal(r.timing.mode, 'big');
    assert.equal(r.timing.calls, finishes.length, 'timing.calls = 实际完成段数');
    assert.ok(r.timing.ms >= 0, 'timing.ms 真实总耗时');
});

test('★leg27：上报函数自身抛错**不许影响抽取**（观测面绝不能成为故障点）', async () => {
    const src = makeBook(600);
    const r = await extractWorldSetting({
        sourceText: src, extract: makeExtract(), cache: null,
        onProgress: () => { throw new Error('界面层炸了'); },
    });
    assert.equal(r.ok, true, '★上报抛错时抽取照常完成（旧法没有上报面，这条锁防的是"加了上报反而更脆"）');
    assert.ok(r.setting.frozen.canon.bookEntities.length > 0);
});

test('★leg27：小书路径同样上报（1 段：五件套）+ timing.mode=small', async () => {
    const src = makeBook(100);   // ≈ 2.1 万字符 → 单发
    const events = [];
    const r = await extractWorldSetting({ sourceText: src, extract: makeExtract(), cache: null, onProgress: (e) => events.push({ ...e }) });
    assert.equal(r.ok, true);
    assert.equal(events.filter((e) => e.phase === 'start').length, 1, '小书 = 1 段');
    assert.equal(events.filter((e) => e.phase === 'finish').length, 1);
    assert.equal(r.timing.mode, 'small');
    assert.equal(r.timing.calls, 1);
});
// story-world-v2/test/scale-ondemand.test.js
// ★★★leg64 第四轮（用户令「做吧」）：**按需查表**——模型"点名要"某几张刻度表的全链路判据。
//
// 这一棒治的病（上一轮核查出来的缺口，指得出出处）：
//   本棒第三轮给模型递了一份 `刻度目录`（60 张表名，治"64 张表里 60 张它不知道存在"），
//   但**没有任何入口能拿到目录里那 60 张中的任何一张**：
//     · `recall` 按**实体名 + 未决事件标题**发问（`recall.js` 的 `collectRecallQuery`）
//       ⇒ 表格只能"随它所在的条目碰巧被召回"，**模型无法指定要看哪张尺**；
//     · `lookup` 那套（`meta.entityFields`）索引键是**实体 id** ⇒ **对表格没有入口**。
//   ⇒ 那就成了本仓最忌的那类东西：**提示词替机制承诺一个它做不到的事**
//     （先例：`render.js:126` 那条"未查：轮到时会按需去世界书取原话"——永远兑现不了，405 行挂着它）。
//
// ★本文件的判据形态纪律（照 leg61 §4.1 与 `rule-kinds.test.js` 的同一把尺）：
//   **不许出现"我在某一本书里看到的词"当判据**——夹具全是自造记号（`甲阶`/`乙榜`/`丙典`）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildScaleAnchor, buildScaleCatalog, buildScaleOnDemand, buildScaleTableIndex,
    sanitizeScaleRequests, buildEvolutionPack, SCALE_ONDEMAND_TOP,
} from '../src/pack.js';
import { checkWorldStep } from '../src/check-step.js';

// ── 夹具：自造的账（30 张表 ⇒ 必然发生"进包截断"，从而目录非空、查表有意义） ──
const tableOf = (i) => ({
    名: `表${i}`, 源: `条目${i}`, 用途: '分级',
    档位: Array.from({ length: 3 }, (_, j) => ({ 档: `X${i}-${j}`, 注: `第${j}档` })),
    维度: (i % 5 === 0) ? [{ 名: `维${i}`, 范围: '0~9' }] : undefined,
});
const canonOf = (n = 30) => ({ powerScale: [], dims: [], rules: [], 刻度: Array.from({ length: n }, (_, i) => tableOf(i)) });
const worldOf = (canon) => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['临城'],
        setting: {
            frozen: { fingerprint: 'fnv1a_t', extractedAt: '2026-09-18T00:00:00Z', canon, compile: null },
            dynamic: { tension: { polarity: '甲/乙', direction: '甲压乙', intensity: 0.5 }, env: {}, derivedFrom: [] },
        },
    },
    entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0 },
});
const emptyStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

// ═══════════════ ① 索引与净化：编的表名不许"差不多就给一张" ═══════════════
test('★leg64 查表：索引按表名（与目录同一把尺 —— 名字截断长度一致）', () => {
    const canon = canonOf(5);
    const idx = buildScaleTableIndex(canon);
    assert.equal(idx.size, 5);
    assert.ok(idx.has('表0') && idx.has('表4'));
    // 与目录/进包同一把截断尺：超长表名两边都截到 `SCALE_NAME_MAX_PACK`
    const longName = '这个表名特别长特别长特别长特别长特别长特别长';
    const idx2 = buildScaleTableIndex({ powerScale: [], dims: [], rules: [], 刻度: [{ 名: longName, 档位: [{ 档: 'X1' }] }] });
    const key = [...idx2.keys()][0];
    assert.ok(key.length < longName.length, '超长表名被截断（与目录一致）');
    assert.ok(buildScaleCatalog({ powerScale: [], dims: [], rules: [], 刻度: [{ 名: longName, 档位: [{ 档: 'X1' }] }] }, new Set())?.[0].startsWith(key.slice(0, 10)),
        '★目录里那一串与索引键同源（否则"照抄目录"的模型永远对不上）');
});

test('★★leg64 查表：**账上没有的表名一律拒**，并如实列出被拒的名字', () => {
    const idx = buildScaleTableIndex(canonOf(5));
    const { ok, missed } = sanitizeScaleRequests(['表1', '我编的表', '表9'], idx);
    assert.deepEqual(ok, ['表1'], '只有账上真有的那张被收');
    assert.deepEqual(missed, ['我编的表', '表9'], '★编的与不存在的都如实留痕（不替它造一张）');
    // 去重 + 上限
    const many = Array.from({ length: 20 }, (_, i) => `表${i % 5}`);
    assert.deepEqual(sanitizeScaleRequests(many, idx).ok, ['表0', '表1', '表2', '表3', '表4'], '去重且按点名序');
    assert.equal(sanitizeScaleRequests(Array.from({ length: 5 }, (_, i) => `表${i}`), idx).ok.length, 5, `至多 ${SCALE_ONDEMAND_TOP} 张`);
});

// ═══════════════ ② 取全那张表（与进包的"取前几档"相反） ═══════════════
test('★★leg64 查表：点名要的给**整张**（进包块受预算只给前几档，补料块给全）', () => {
    // 造一张档位很多的表：进包会截，补料不会
    const big = { 名: '长表', 源: '甲', 档位: Array.from({ length: 40 }, (_, j) => ({ 档: `X${j}`, 注: `第${j}档` })) };
    const canon = { powerScale: [], dims: [], rules: [], 刻度: [big, ...Array.from({ length: 20 }, (_, i) => tableOf(i))] };
    const anchor = buildScaleAnchor(canon) || [];
    const inPack = (anchor.find((t) => t.表 === '长表')?.档位 || []).length;
    const got = buildScaleOnDemand(canon, ['长表']);
    assert.ok(got, '要得到');
    assert.equal(got.tables[0].表, '长表');
    assert.ok(inPack < 40, `夹具确实发生了进包截断（进包 ${inPack} 档 / 共 40）`);
    assert.equal(got.tables[0].档位.length, 40, '★补料给**整张**（40 档一条不少）');
});

test('★leg64 查表：装不下就**整张不要**（不做"给半张"——半张尺比没有更坏）', () => {
    // 一张超大的表：超过单轮补料总字符上限 ⇒ 整张丢，且记进 `dropped`
    const huge = { 名: '巨表', 源: '甲', 档位: Array.from({ length: 4000 }, (_, j) => ({ 档: `X${j}`, 注: `第${j}档的说明文字` })) };
    const canon = { powerScale: [], dims: [], rules: [], 刻度: [huge, tableOf(1)] };
    const got = buildScaleOnDemand(canon, ['巨表', '表1']);
    assert.ok(got, '小的那张仍要得到');
    assert.deepEqual(got.tables.map((t) => t.表), ['表1'], '★巨表整张被丢（不是给半张）');
    assert.deepEqual(got.dropped, ['巨表'], '丢的记进 `dropped`（如实留痕）');
});

test('★leg64 查表：一张都给不出 ⇒ null（键不出现，与"空着就是空着"同尺）', () => {
    assert.equal(buildScaleOnDemand(canonOf(3), []), null);
    assert.equal(buildScaleOnDemand(canonOf(3), ['我编的']), null, '全是编的 ⇒ 什么都不给');
    assert.equal(buildScaleOnDemand(undefined, ['表0']), null);
});

// ═══════════════ ③ 全链路：模型点名 ⇒ 核过 ⇒ 同一轮进包 ═══════════════
test('★★★leg64 查表全链路：`lookupScales` 点名 ⇒ 引擎核 ⇒ **同一轮**那张表的档位进包', () => {
    const canon = canonOf(30);
    const world = worldOf(canon);
    const step = { ...emptyStep(), lookupScales: ['表7'] };
    const r = checkWorldStep(step, world);
    assert.equal(r.ok, true, '合法点名不被拒');
    assert.deepEqual(world.meta.scaleRequests, ['表7'], '★核过的表名落进账（引擎的交接面）');
    // 同一轮出包就该看得见（这是"当轮可见"那一格的全部意义）
    const built = buildEvolutionPack(world, null);
    const sup = built.pack.setting.刻度补;
    assert.ok(Array.isArray(sup), '★`刻度补` 真的进了包');
    assert.equal(sup.length, 1);
    assert.equal(sup[0].表, '表7');
    assert.equal(sup[0].档位.length, 3, '整张的档位都在');
    // 目录仍在（两者不是替代关系）：目录列的是"没进包的"，补料是"点名要来的"
    assert.ok(Array.isArray(built.pack.setting.刻度目录), '目录没被补料顶掉');
    // ★键序：刻度 → 刻度目录 → 刻度补 → 法则
    const keys = Object.keys(built.pack.setting);
    assert.deepEqual(keys.slice(keys.indexOf('刻度'), keys.indexOf('刻度') + 3), ['刻度', '刻度目录', '刻度补'], '★键序：刻度 → 刻度目录 → 刻度补');
});

test('★★leg64 查表全链路：**编的表名被拒**（整步不合法 ⇒ 不落账、不进包）', () => {
    const world = worldOf(canonOf(30));
    const step = { ...emptyStep(), lookupScales: ['我编的表'] };
    const r = checkWorldStep(step, world);
    assert.equal(r.ok, false, '★编的表名要让整步被拒——"无源之物不入局"的表格版');
    assert.ok(r.errors.some((e) => e.includes('我编的表')), '错误里点名是哪个表名对不上');
    assert.equal(world.meta.scaleRequests, undefined, '★被拒的步**不留痕迹**（写账只在整步无错时发生）');
    // 就算硬把账写成编的名字，出包也不给（净化层最后一道）
    const forced = worldOf(canonOf(30));
    forced.meta.scaleRequests = ['我编的表'];
    assert.equal(buildEvolutionPack(forced, null).pack.setting.刻度补, undefined, '净化层再兜一道：编的名字给不出东西');
});

test('★leg64 查表全链路：不写 `lookupScales` ⇒ 与旧行为逐字节同（可选组）', () => {
    const world = worldOf(canonOf(30));
    const r = checkWorldStep(emptyStep(), world);
    assert.equal(r.ok, true, '★缺席合法（可选组：本轮没要点表不是形状错误）');
    const built = buildEvolutionPack(world, null);
    assert.equal('刻度补' in built.pack.setting, false, '★没点名 ⇒ `刻度补` 这个键不出现');
    assert.ok(built.pack.setting.刻度 && built.pack.setting.刻度目录, '刻度与目录照旧');
});

test('★★leg64 查表：**一次性的**——每轮被覆盖，不跨轮囤积', () => {
    const world = worldOf(canonOf(30));
    checkWorldStep({ ...emptyStep(), lookupScales: ['表7'] }, world);
    assert.deepEqual(world.meta.scaleRequests, ['表7']);
    // 下一轮没点名 ⇒ 覆盖成空 ⇒ 包里不再有补料（"包不是仓库"）
    checkWorldStep({ ...emptyStep(), lookupScales: [] }, world);
    assert.deepEqual(world.meta.scaleRequests, []);
    assert.equal(buildEvolutionPack(world, null).pack.setting.刻度补, undefined, '★上一轮要来的表不会一直挂着');
});

test('★★leg64 查表：提示词里**真的告诉模型**有这个入口（不给入口 = 又一条兑现不了的承诺）', async () => {
    const { MAIN_PROMPT, OUTPUT_TEMPLATE } = await import('../src/prompts.js');
    assert.ok(MAIN_PROMPT.includes('lookupScales'), '★主提示词里有这一格（否则模型永远不会用）');
    assert.ok(/刻度目录/.test(MAIN_PROMPT), '★告诉它表名从「刻度目录」照抄');
    assert.ok(OUTPUT_TEMPLATE.includes('"lookupScales"'), '★输出模板里有它（形状里没有 ＝ 模型不会交）');
});

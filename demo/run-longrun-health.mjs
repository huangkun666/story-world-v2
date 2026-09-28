// story-world-v2/demo/run-longrun-health.mjs
// ★这件事：**让真模型自己驱动世界、长跑一段，全程监听**——找隐形 bug、看生成质量、看各部分运转状态。
//
// 为什么要用**干净的合成世界**（照 `measure-leg127-line-curve.js` 的同一条理由）：
//   用户 2026-09-25 原话「现在的这个跑出来的账本没有什么权威性的，因为是**多个版本一起跑出来的产物**」
//   ⇒ 那份真账是**事故现场**：拿它体检，会把"历史伤"读成"今天的病"。
//   本脚本**不读任何存量账**：世界从第 1 轮起、单一版本、因果完整 ⇒ 读出来的病都是**今天这一版**的。
//
// ★它监听什么（八类，每轮记一行 JSONL；App 崩溃也能从日志里捡回半程）：
//   ① **这一轮成不成**：`ok` / 失败原因 · 有没有走**自愈降级**（`healed`）· 引擎**拒签/裁定**了几条（`stage.warnings`）
//   ② **主调用**：用时 · 输出体量（字符 / token 估算）——撞不撞厂商输出上限
//   ③ **包**：估算 token · 占预算几成 · `trimmed` 痕迹（哪几栏被裁）· 各栏条数
//   ④ ★**leg128 那条新链**：`故事线` 立了几条 · 行里 `·合流N` 多因点几个 · 模型点名要了几条 ·
//      下一轮 `线的经过` 真递了几条（★这一格是本脚本最想验的：链刚接上，实机跑没跑过）
//   ⑤ **账**：新增 / 闭环的事件与盘算 · 编年新增几行 · 归档搬走几件
//   ⑥ **观测台**（`src/observatory.js` 现成的三件）：悬空指针 · 拒签统计 · 占座摸鱼
//   ⑦ ★**不变量自查**（最可能抓到隐形 bug 的一格）：**只增不改**（老事被改写没有）· **闭环不复活** ·
//      **不许凭空消失** · **单亲无环** · id 唯一 · 编年只长不缩
//   ⑧ **生成质量**：新事件的来路分布 · 来路指不着的几条 · 标题重复 · **空转轮**（一轮一件都没长出来）
//
// 跑法（★都在插件目录内跑）：
//   node demo/run-longrun-health.mjs --ticks=3                    # 先探一小段，看每轮成本
//   node demo/run-longrun-health.mjs --ticks=40                   # 长跑
//   node demo/run-longrun-health.mjs --ticks=40 --out=F:/deepseek/tmp/longrun-1
//   ★中途想停：在输出目录里建一个空文件 `STOP`，下一轮开头就收拾停当退出（**不硬杀**，日志完整）。
//
// ★★旋钮（leg130 加；照交接 leg129 §6 那张清单——**加旋钮是为了把"没压到的面"一个个压到**）：
//   `--budget=<est>`    把包预算拧到这么小 ⇒ **逼出裁剪序**（走的是账上那条真写通道 `dynamic.env.包预算`，
//                       `resolveLimits` 现读；不是本台自己造一把尺）。
//   `--roster=<n>`      种子世界扩到 n 个角色（默认 8 ＝ 原样）。★n>8 时另起 2 个势力（带麾下成员），
//                       这样 `entities.slim`（逐出成员简表）才**有东西可逐**。
//   `--seed-agendas=<n>` 种 n 条已了结盘算（默认 0）＋ 2 条在飞盘算 ⇒ 让 `closedAgendas`／`agendas.detail`
//                       两段**有东西可裁**。★只影响本台合成的起点，不是产品行为。
//   `--dialogue=<文本|@文件>` 喂给 `runTick` 的正文（默认空串＝现状）⇒ 压标签那条路（面②）。
//   `--calls=<n>`       主调用记账条数（默认 1）。
//   `--rotatespan=<n>`  编年轮转阈值（默认 200；本台自定值，非生产）。
//   ★**默认全不设** ⇒ 读数与 leg129 那一跑**同口径可比**（"零扰动"）。
//
// ★纪律三条：
//   · **密钥只在 `resolveWorldTransport()` 里面读**，本脚本从不打印、从不碰它（`STATE.md` §5）。
//   · **本脚本不写插件目录里任何东西**：账本快照与日志全部写进 `--out` 那个目录。
//   · ★**它不是判据**（不住 `test/`）：它出一份**读数**，判据要另立。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { rotateChronicle } from '../src/storage.js';
import { packTextOf, TOKEN_RATIO, computeIdleFaces } from '../src/pack.js';
// ★leg130：**预算现读**走引擎自己那条路（`resolveLimits` 读账上 `dynamic.env.包预算`）——
//   台里绝不许出现"第二把尺子"（上面 `estTokens` 那条注释是同一条纪律）。
import { resolveLimits } from '../src/limits.js';
import { scanDanglingRefs, rejectionStats, residencyStats } from '../src/observatory.js';
import { linesOf, forestOf, LINE_MIN_EVENTS } from '../src/lines.js';
import { resolveWorldTransport } from '../src/st-preset.js';
// ★★leg130（面③：世界书那条路）——**全部走生产自己那条管线**，本台不另写一份：
//   `extractWorldSetting`（抽书：五件套 ＋ 名册）→ `applySettingToSsot`（唯一那条换设定路）→
//   `seedBookEntities`（把名册种进实体账）→ `seedRoots`（起根：落 `seed` 型根）。
//   `derivePositions` 是 `web/index.js` 导出的**建世界那一步用的真函数**（本台不另立一套位置集）。
// ★★leg135：多带一个 `resolveScales` —— 读"书里有几张尺"**唯一正确的那一口**（见下面第 372 行那段）。
import { applySettingToSsot, extractWorldSetting, seedBookEntities, resolveScales } from '../src/abstract.js';
import { seedRoots } from '../src/seed-roots.js';
import { renderAll } from '../src/render.js';   // ★面⑦：**生产那一个渲染入口**（面板用的就是它）
import { runEntityLookupStep } from '../src/entity-lookup.js';
import { derivePositions } from '../web/index.js';

// ★量体的尺**必须跟引擎那把逐字同一把**：`pack.js:268` 的 `estTokensOf` 是模块私有的
//   （`const estTokensOf = (value) => Math.ceil(packTextOf(value).length / TOKEN_RATIO)`）⇒
//   这里照它的公式重写一遍，**不另立一套算法**（本仓最忌"两把尺子"）。
//   ⚠ `.length` 是 UTF-16 码元数、不是码点数——**故意照抄引擎**，因为要比的就是同一个数。
const estTokens = (pack) => Math.ceil(packTextOf(pack).length / TOKEN_RATIO);

// ───────────────────────── 0. 命令行 ─────────────────────────
// ★★面② 的现成样本（`--dialogue=sample`）——**三族标签齐全**，且**每一格都对得上这个合成世界**：
//   · 名号取自种子世界的真名（主帅／军师／副将／斥候），地点取自 `context.positions`；
//   · 故意留了一个**不在名册上**的人（船夫）⇒ 压"归不上名字也递给世界模型看"那条路；
//   · 【变化】的值**逐字出现在正文里**（这是引擎四道机械校验的第③道："值必须在正文里找得到"；
//     找不到 ⇒ 判定为换算/编出来的 ⇒ 不收）。
//   ★纪律：围栏那三个反引号**写成单引号字符串**（这个文件里别处有模板字符串，里头出现反引号会把模板截断
//     ——本仓 leg128 就栽过一次，见总稿 §7.5 第 1 条）。
const SAMPLE_DIALOGUE = [
    '主帅把军师叫到帅案前，压低声音说：「粮道上的事，今夜就要有结果。」',
    '军师点头，提笔在手令上写下八个字：按兵不动，静待其变。',
    '副将领了令，连夜赶往前线，把斥候换了下来。斥候回营报说，边关外的马蹄印一直延伸到河滩。',
    '船夫在渡口边上嘟囔了一句，说这几日夜里总有船来往，却不点灯。',
    '',
    '```tags',
    '【此刻】长平历九年 三月初七 卯时',
    '【时长】三日',
    '【场景：主帐】',
    '【行动】主帅｜下令｜军师',
    '【行动】军师｜拟令｜主帅',
    '【行动】副将｜赶往｜前线',
    '【行动】船夫｜撑船｜副将',
    '【变化】军师｜定位｜按兵不动，静待其变',
    '【承诺】主帅｜粮道上的事今夜要有结果｜军师',
    '```',
].join('\n');

const argv = Object.fromEntries(process.argv.slice(2).map((s) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    return m ? [m[1], m[2] ?? 'true'] : [s, 'true'];
}));
const TICKS = Number(argv.ticks ?? 20);
// ★编年轮转跨度：**这里是本台自己的选择，不是生产的值**（生产 500 轮）。
//   压到 200 只为一件事：别让热账长到把包撑爆——那会把"长跑体检"变成"单点性能测量"。
//   ⚠ 因此本台报的"卷数"只在 200 这个阈值下成立，**不能当生产的卷数用**。
const ROTATE_SPAN = Number(argv.rotatespan ?? 200);
// ★★leg130 新旋钮（来路见文件头那段；**默认值一律＝原样**）。
const BUDGET = Number.isFinite(Number(argv.budget)) && Number(argv.budget) >= 1 ? Number(argv.budget) : null;
const ROSTER = Number.isFinite(Number(argv.roster)) && Number(argv.roster) >= 8 ? Number(argv.roster) : 8;
const SEED_AGENDAS = Number.isFinite(Number(argv['seed-agendas'])) && Number(argv['seed-agendas']) >= 0
    ? Number(argv['seed-agendas']) : 0;
const CALLS = Number.isFinite(Number(argv.calls)) && Number(argv.calls) >= 1 ? Number(argv.calls) : 1;
// ★★leg130（面③）：世界书那条路
const BOOK = argv.book ? String(argv.book) : null;          // 世界书（ST 世界书 JSON 或纯文本）
const CANON = argv.canon ? String(argv.canon) : null;       // 抽好的设定（JSON：{setting, entries}）＝**抽一次的缓存**
const SEED_ROOTS_ON = argv['seed-roots'] === 'true';        // 抽完书起一次根（落 `seed` 型根；真调用）
const NO_EXTRACT = argv['no-extract'] === 'true';           // 只许用缓存，不许真抽（防手滑烧钱）
// ★★leg130（面⑥）：**故意把单轮超时逼出来**。生产上那次 abort 是 `transport-http.js` 的
//   `createHttpTransport` 自己发的定时器；本台在**传输外面**套一层同样形状的定时器
//   （抛出的错**照它那条口径打上 `sw2Timeout = true`**，人话文案也照抄）⇒ 下游那条路
//   （`tick.js` / 编排层怎么处置超时）**走的是真代码**。★如实登记：被替掉的只有"abort 是怎么发出来的"这一步。
const TIMEOUT_SEC = Number.isFinite(Number(argv.timeout)) && Number(argv.timeout) > 0 ? Number(argv.timeout) : null;
/** ★`--hang=2,5`：**指定哪几轮模型不回话**（真跑里就是供应商卡住／网关吊死那件事）。
 *  ★它必须与 `--timeout` 同时用——不设超时就是**永远等下去**，那不是测量，那是把台子挂死。 */
const HANG = new Set(String(argv.hang ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0));
// ★★leg130（面③ 的另一半）：**查书写回**——`runTick` 的 `preStep` 那一格，接法与生产逐字一致
//   （`web/index.js` 的 `preStep`：选本轮上场实体 → 只对缺字段者查书 → 引擎回写）。
//   `--lookup-book=<路径>` 是**查书的书文**（不给就用 `--book` 那一份的书文）。
const LOOKUP = argv.lookup === 'true';
const LOOKUP_BOOK = argv['lookup-book'] ? String(argv['lookup-book']) : null;
// ★正文那一路：`--dialogue=@路径` 从文件读（**用 node 读字节、不经终端**——本仓铁律：含中文的文件禁止用 PowerShell 过手）。
const DIALOGUE = (() => {
    const raw = argv.dialogue;
    if (raw === undefined || raw === 'true' || raw === '') return '';
    const s = String(raw);
    if (s === 'sample') return SAMPLE_DIALOGUE;         // ★面② 的现成样本（三族标签齐全）
    if (!s.startsWith('@')) return s;
    const p = s.slice(1);
    try { return readFileSync(p, 'utf8'); } catch (e) {
        console.error(`✗ 读不到 --dialogue 那个文件：${p}（${e?.message || e}）`);
        process.exit(1);
    }
    return '';
})();
const OUT = String(argv.out ?? `F:/deepseek/tmp/longrun-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
mkdirSync(OUT, { recursive: true });
const STOP_FILE = `${OUT}/STOP`;
const LOG = `${OUT}/ticks.jsonl`;

const line = (s = '') => console.log(s);
const num = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

// ───────────────────────── 1. 干净世界的起点 ─────────────────────────
// 形状照 `measure-leg127-line-curve.js` 的 `buildSeedWorld()`（那是 900 轮跑通的合成世界），
// 另加**两棵刻意不同的树**——本台第一件要问的事就在这里（见下面 `★两棵树` 那段）：
//   · 树甲：根是**由处境而生**的那件事（`state`），它**永不收口**，底下挂着 4 件已收口的事；
//   · 树乙：根是一件**已收口**的 `state` 事，整棵树全收口。
//   两棵都是 5 件事件 ⇒ 立线的判据只差"**全收口**"这一格 ⇒ 它们是一组**对照**。
//
// ★★leg130：`--roster` / `--seed-agendas` 两个旋钮**只在被点名时才动世界**——
//   `buildSeedWorld(8, 0)` 与 leg129 那一跑**逐字节同一个起点**（读数才可比）。
function buildSeedWorld(roster = 8, seedAgendas = 0) {
    const POSITIONS = ['主帐', '前线', '粮道', '边关'];
    const CAST = ['主帅', '军师', '小校', '粮官', '斥候', '副将', '使节', '匠头'];
    const entities = CAST.map((name, i) => ({
        id: `e${i + 1}`, kind: 'character', name, location: POSITIONS[i % POSITIONS.length],
    }));
    // ★规模效应（交接 §6 的面④）：把班底扩到 n 人、驻点扩到 10+ ——`entities.slim`／视野／名册才有东西可压。
    //   ★两个势力（带麾下成员）：`pack.js` 的成员简表是**派生**的（`membersOf`：子实体的 parent 指过来）
    //     ⇒ 只有真挂上子实体，`entities.slim` 才有东西可逐（否则那一段永远"裁的是空气"，读数是假的）。
    if (roster > 8) {
        const EXTRA_POS = ['粮仓', '校场', '后营', '水门', '关隘', '驿道', '市集', '山道', '渡口', '大营'];
        for (const p of EXTRA_POS) if (!POSITIONS.includes(p)) POSITIONS.push(p);
        entities.push({ id: 'e_f1', kind: 'faction', name: '镇北军', location: '大营' });
        entities.push({ id: 'e_f2', kind: 'faction', name: '漕帮', location: '渡口' });
        for (let i = 9; i <= roster; i += 1) {
            const loc = POSITIONS[i % POSITIONS.length];
            entities.push({
                id: `e${i}`, kind: 'character', name: `${['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'][i % 8]}字号${i}`,
                location: loc, parent: i % 2 ? 'e_f1' : 'e_f2',
            });
        }
    }
    const weights = Object.fromEntries(entities.map((e) => [e.id, 0.5]));   // K2 真公式起应在 [0,1]
    const ev = (id, title, source, closed, up = [], ripples = []) => ({
        id, title, source, position: '边关', ripples, closed, links: { up, down: [] },
    });
    const world = {
        version: 1,
        context: {
            world: '长跑体检用的合成世界（单一版本 · 因果完整 · 带 5 轮既往史）',
            tension: 0.5,
            positions: POSITIONS,
        },
        entities,
        weights,
        agendas: [],
        events: [
            // ★★树甲（对照甲）：根**开着**——它就是总稿 §4.6 末条说的那个"由处境而生的处境"，
            //   `source.type='state'` 的那种事**永不闭环**（`pack.js:877` 原文："只有 state 源会永不闭环"）。
            ev('ev_1_1', '边关起了变故', { type: 'state' }, false, [], ['e1', 'e2']),
            ev('ev_2_1', '粮道被截', { type: 'ripple', ref: 'ev_1_1' }, true, ['ev_1_1']),
            ev('ev_3_1', '内应叛变', { type: 'ripple', ref: 'ev_1_1' }, true, ['ev_1_1']),
            // ★这一件是**多因点**：主因是 ev_2_1，另一条因记在 `links.up` 里（leg128 那一格）
            ev('ev_4_1', '商队覆灭', { type: 'ripple', ref: 'ev_2_1' }, true, ['ev_2_1', 'ev_3_1']),
            ev('ev_5_1', '残部西逃', { type: 'ripple', ref: 'ev_4_1' }, true, ['ev_4_1']),
            // ★★树乙（对照乙）：根**收了口** ⇒ 整棵树全收口（只差这一格）
            ev('ev_5_2', '山道塌方', { type: 'state' }, true, [], ['e3', 'e4']),
            ev('ev_5_3', '商旅绕行', { type: 'ripple', ref: 'ev_5_2' }, true, ['ev_5_2']),
            ev('ev_5_4', '绕行遇伏', { type: 'ripple', ref: 'ev_5_3' }, true, ['ev_5_3', 'ev_5_2']),
            ev('ev_5_5', '伏兵退去', { type: 'ripple', ref: 'ev_5_4' }, true, ['ev_5_4']),
            ev('ev_5_6', '商队重开', { type: 'ripple', ref: 'ev_5_5' }, true, ['ev_5_5']),
        ],
        chronicle: [],
        meta: { tick: 5, simLog: [] },
    };
    // ★★面① 要压的那几段（`recentClosedEvents`／`agendas.detail`／`closedAgendas`）**得有东西可裁**：
    //   起点里补一批**已收口**的事（让"最近了结的事"那一栏够长）＋几条盘算（在飞 2 条、已了结 n 条）。
    //   ★形状逐格照 `ssot.schema.js`（`additional:false`）：漏一格当场违约，那不是"读数不好看"，是假账。
    if (roster > 8 || seedAgendas > 0) {
        for (let i = 1; i <= 24; i += 1) {
            world.events.push(ev(`ev_4_${i + 1}`, `既往收口的事第 ${i} 件`, i % 3 === 0
                ? { type: 'state' } : { type: 'ripple', ref: 'ev_1_1' }, true,
            i % 3 === 0 ? [] : ['ev_1_1'], [`e${(i % roster) + 1}`]));
        }
        const mkAgenda = (id, owner, goal, closed, extra = {}) => ({
            id, owner, goal, stage: closed ? '结清' : '在办', visibility: 'known',
            maxSteps: 4, progress: closed ? 4 : 1,
            memory: { promises: [], done: closed ? [goal] : [], blocked: [], turnsAlive: 1 },
            source: { type: 'state' }, ...(closed ? { closed: true } : {}), ...extra,
        });
        world.agendas.push(mkAgenda('ag_1_1', entities[0].id, '稳住边关', false));
        world.agendas.push(mkAgenda('ag_1_2', entities[1].id, '查清粮道被截的来路', false));
        for (let i = 1; i <= seedAgendas; i += 1) {
            world.agendas.push(mkAgenda(`ag_3_${i}`, entities[i % 8].id, `既往办结的第 ${i} 件谋划`, true));
        }
    }
    return world;
}

/** ★把旋钮落到**生产那条真写通道**上（`resolveLimits` 现读 `context.setting.dynamic.env`）。
 *  ★写成**字符串**：契约里 `env` 是 `strRecord`（`ssot.schema.js:289`），面板写的也是字符串
 *    （`normalizeLimit` 两种都收——但"照生产的形状写"才叫真压）。 */
function applyKnobs(w) {
    if (BUDGET == null) return w;
    w.context.setting = w.context.setting || {};
    w.context.setting.dynamic = w.context.setting.dynamic || {};
    w.context.setting.dynamic.env = { ...(w.context.setting.dynamic.env || {}), 包预算: String(BUDGET) };
    return w;
}

// ───────────────────────── 2. 模型通道（真模型 or 合成；★密钥不出下面那一格） ─────────────────────────
const FAKE = argv.fake === 'true';
let rawTransport = null;
if (FAKE) {
    // ★`--fake`：**零模型调用**跑通整台仪器（也顺带把 leg128 那条新链压一遍）。
    //   它演的"模型"只做两件事：① 每轮长一件事、挂在前一件上（长出一条长链 ⇒ 够 N=5 立线）；
    //   ② 每隔 3 轮**从它收到的提示词里读 `故事线` 那一栏、点名要第一条**——这样
    //      "线进包 → 点名 → 下一轮递经过"这条链**在免费的前提下也真跑到了**。
    //   ⚠ 它**不是**质量样本：合成世界＋合成模型，只配用来验"仪器通不通"。
    let n = 0;
    rawTransport = async (p) => {
        n += 1;
        const text = String(p);
        const block = /"故事线"\s*:\s*\[([\s\S]*?)\]/.exec(text);
        const roots = block ? [...block[1].matchAll(/(ev_\d+_\d+)/g)].map((m) => m[1]) : [];
        // ★leg130：**从包里现读一个"开着的号"来挂**——原先写死 `ev_1_1`（那是合成世界的根），
        //   一换世界（`--book` 起的世界里根本没有 `ev_1_1`）就**每轮违约**。
        //   口径：优先挂在"未决事件"里的第一条（那一定是开着的）；一条都没有就用 `state` 源（无 ref，合法）。
        const pend = /"pendingEvents"\s*:\s*\[([\s\S]*?)\]/.exec(text);
        const pendIds = pend ? [...pend[1].matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]) : [];
        const anchor = pendIds[0] || null;
        const step = {
            actions: [],
            // ★每轮都挂回**同一个开着的根**——故意造成"许多件事共用一个处境"，
            //   正是总稿 §4.6 末条说"今天只能靠共用那个根事件来做"的那条路，压一压它成不成立。
            newEvents: [{
                title: `合成第 ${n} 件`,
                source: anchor ? { type: 'ripple', ref: anchor } : { type: 'state' },
                position: '主帐',
            }],
            agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
        };
        // 每隔几轮就"点名要第一条线的经过"——把"点名 ⇒ 下一轮递经过"那条链也压到
        if (roots.length && n % 3 === 0) step.lookupLines = [roots[0]];
        return { text: JSON.stringify(step) };
    };
    line('★合成模式（--fake）：**零模型调用**，只验仪器与那条新链通不通。');
} else {
    const resolved = resolveWorldTransport();
    if (!resolved) {
        console.error('✗ 读不到模型配置（`resolveWorldTransport()` 返回 null）——本台需要真模型；'
            + '只想验仪器就加 `--fake`（零模型调用）。');
        process.exit(1);
    }
    line(`真模型：${resolved.model}（来源 ${resolved.source}）`);
    rawTransport = resolved.transport;
}
line(`输出目录：${OUT}`);
line(`打算跑 ${TICKS} 轮 · 编年轮转阈值 ${ROTATE_SPAN} 轮（本台自定，非生产值）`);// ★★leg130：**把生效的旋钮原样印出来自证**——"没设旋钮"与"设了没生效"在读数上长得一模一样
//   （这正是本台三处监视器失效的同一个形状）⇒ 凡是压面，先把"我压的是哪一格"印出来。
line(`旋钮：班底 ${ROSTER} 人 · 包预算 ${BUDGET == null ? '出厂 30000（未拧）' : BUDGET}`
    + ` · 已了结盘算种子 ${SEED_AGENDAS} 条 · calls ${CALLS}`
    + ` · 正文 ${DIALOGUE ? `${Array.from(DIALOGUE).length} 字` : '空串（现状）'}`
    + `${TIMEOUT_SEC ? ` · 单轮超时 ${TIMEOUT_SEC}s${HANG.size ? `（第 ${[...HANG].join('、')} 轮故意不回话）` : ''}` : ''}`
    + `${BOOK ? ` · 世界书 ${BOOK}` : ''}`);
line('');

// ───────────────────────── 2.5 ★★面③：从**世界书**起一个世界（走生产那条抽书路） ─────────────────────────
/** 读书文件 → `{text, entries}`。★两种形状都收（照 `web/index.js` 与 `diag-extract-realbook.js` 的成例）：
 *  ① ST 世界书 JSON（`{entries:{...}}` 或 `{entries:[...]}`）——`comment` 当条目名、`content` 当正文；
 *  ② 纯文本——原样当书文（`entries` 为空 ⇒ 名册落账那一步没有"零 token 兜底"，如实少一份料）。*/
function loadBook(path) {
    const raw = readFileSync(path, 'utf8');
    try {
        const j = JSON.parse(raw);
        const list = j?.entries && !Array.isArray(j.entries) ? Object.values(j.entries) : (j?.entries || null);
        if (!Array.isArray(list) || !list.length) return { text: raw, entries: [] };
        const entries = list.filter((e) => e && typeof e === 'object');
        const text = entries.map((e) => `## ${String(e?.comment || e?.key?.[0] || '').trim()}\n${String(e?.content ?? '')}`).join('\n\n');
        return { text, entries };
    } catch (_) {
        return { text: raw, entries: [] };   // 不是 JSON ⇒ 当纯文本
    }
}

/** 起一个"书里长出来的世界"——**每一步都调生产自己的函数**（见文件头那段）。
 *  ★两段调用：`extractWorldSetting`（抽书）与 `seedRoots`（起根）。
 *  ★**缓存**：抽一次的结果落 `--canon` 那个文件；下次同一条命令**零调用**复跑（读数才可比）。*/
async function buildBookWorld() {
    const book = loadBook(BOOK);
    line(`★面③：从世界书起世界 —— ${BOOK}`);
    line(`　 书文 ${Array.from(book.text).length} 字符 · 条目 ${book.entries.length} 条 · 缓存 ${CANON || '（不写）'}`);

    let cache = null;
    if (CANON && existsSync(CANON)) {
        cache = JSON.parse(readFileSync(CANON, 'utf8'));
        line(`　 ★用缓存里的设定（**零抽取调用**）：法则 ${cache?.setting?.frozen?.canon?.rules?.length ?? 0} 条`
            + ` · 标尺 ${cache?.setting?.frozen?.canon?.powerScale?.length ?? 0} 档`
            + ` · 书名录 ${cache?.setting?.frozen?.canon?.bookEntities?.length ?? 0} 个`);
    }
    if (!cache) {
        if (NO_EXTRACT) {
            console.error(`✗ 没有可用的设定缓存（${CANON || '--canon 没给'}）而 --no-extract 开着——不抽书就没世界可起。`);
            process.exit(1);
        }
        if (FAKE) {
            console.error('✗ `--book` 要真模型抽书，而 `--fake` 的"模型"只会写世界步 JSON——'
                + '先跑一次真的（不带 --fake）把设定缓存下来，之后 `--fake --canon=…` 就能零调用复跑。');
            process.exit(1);
        }
        const t0 = Date.now();
        line('　 开始抽书（真调用，可能要几分钟）…');
        const r = await extractWorldSetting({
            sourceText: book.text,
            extract: async (p) => (await rawTransport(p)),
            cache: null,
            extractedAt: new Date().toISOString(),
        });
        line(`　 抽书结束：ok=${r.ok} · 用时 ${Math.round((Date.now() - t0) / 1000)}s`
            + `${r.errors?.length ? ` · 警告 ${r.errors.length} 条` : ''}`);
        if (!r.ok) { console.error(`✗ 抽书失败：${(r.errors || []).join('; ')}`); process.exit(1); }
        cache = { setting: r.setting, entries: book.entries };
        if (CANON) writeFileSync(CANON, JSON.stringify(cache), 'utf8');
    }
    const setting = cache.setting;
    // ★查书写回那条路要的书文与条目：书世界自己就有一份（不给 `--lookup-book` 就用它）
    if (!bookTextForLookup) bookTextForLookup = cache.text || book.text;
    if (!bookEntriesForLookup.length) bookEntriesForLookup = cache.entries || book.entries;
    const positions = derivePositions(setting);
    const canon = setting?.frozen?.canon || {};
    // ★★leg135：这一行原来读的是 `canon.scales?.length ?? canon.powerScale?.length ?? 0` ——
    //   **两个都不是"书里有几张尺"的家**（`scales` 这个键根本不存在；`powerScale` 是旧两列，新账是空的）
    //   ⇒ 实测：包里明明装了 **41 张表**，这一行却印 `刻度 0 张/档`（本笔跑真书时当场看见）。
    //   ⇒ 改成走 `resolveScales`（与出包/面板**同一个读取口**：新账读 `刻度`、旧账由旧两列推导）。
    //   ★这正是本仓那条老病"一个数两把尺子"的又一次现形：报数与实物不同源 ⇒ 报出来的是假话。
    const scaleTables = resolveScales(canon);
    const scaleTiers = scaleTables.reduce((n, t) => n + ((t['档位'] || []).length), 0);
    line(`　 设定：位置集 ${positions.length} 个（${positions.slice(0, 6).join('、')}${positions.length > 6 ? '…' : ''}）`
        + ` · 刻度 ${scaleTables.length} 张 / ${scaleTiers} 档 · 法则 ${canon.rules?.length ?? 0} 条`);

    // ★建世界这一步**逐字照生产**（`web/index.js` 的初始化那一段）：同一个种子形状、同一条换设定路、同一个名册落账。
    let w = {
        version: 1,
        context: { world: BOOK.split(/[\\/]/).pop() || '书里长出来的世界', tension: 0.5, positions },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 0, simLog: [] },
    };
    w = applySettingToSsot(w, setting);
    const seeded = seedBookEntities(w, { entries: cache.entries || book.entries });
    line(`　 名册落账：入账 ${seeded.seeded} 个实体 · 折叠 ${seeded.folded ?? 0} · 跳过地名 ${seeded.skippedLocation ?? 0}`
        + ` · 警告 ${seeded.warnings?.length ?? 0}`);
    // ★起根（真调用，一次）——落 `seed` 型根（与 state/plot/ripple 并列的第四型）
    if (SEED_ROOTS_ON) {        const t1 = Date.now();
        const res = await seedRoots({
            ssot: w,
            sourceText: cache.text || book.text,
            extract: async (p) => (await rawTransport(p)),
            fingerprint: `leg130:${Array.from(cache.text || book.text).length}`,
            at: new Date().toISOString(),
            minRoots: Number(argv.minroots ?? 3),
        });
        const ids = res.ids || [];
        line(`　 起根：ok=${res.ok} · 种下 ${res.seeded ?? 0} 条 · 用时 ${Math.round((Date.now() - t1) / 1000)}s`
            + `${res.skipped ? `（跳过：${res.reason}）` : ''}`);
        for (const id of ids) {
            const e = (w.events || []).find((x) => x.id === id);
            line(`　　 ${id}「${String(e?.title ?? '').slice(0, 40)}」@${e?.position ?? '未载'}`
                + ` 人=[${(e?.ripples || []).map((r) => w.entities.find((x) => x.id === r)?.name || r).join('、')}]`);
        }
        if (res.errors?.length) line(`　　 错误：${res.errors.join(' | ')}`);
    }
    line('');
    return w;
}

// 主调用包一层：只为**读数**（输出体量 / 用时 / 原始文本），不改引擎一个字节。
let lastOut = null;
let currentRound = 0;      // ★面⑥：`--hang` 要按"第几轮"决定回不回话（真跑里就是这一轮供应商卡住）
// ★面③ 的另一半（查书写回）：生产里 `preStep` 的状态就这两格（`sw2LastPicks` 与落盘点）
let lastPicks = null;
let lastLookup = null;
let bookTextForLookup = LOOKUP_BOOK ? loadBook(LOOKUP_BOOK).text : null;
let bookEntriesForLookup = LOOKUP_BOOK ? loadBook(LOOKUP_BOOK).entries : [];
/** ★★★leg130 现场取证抓出来的**本台第 10 处"找错了对象"**（留档，这一处最值得记）：
 *  `resolveBookSource(bookText, entity)` 要的**不是"整本书的字符串"**，而是
 *  ① 一个**按实体取条目**的函数 `(entity) => entries`（生产上就是 `sw2BookTextForEntity`），或
 *  ② 一个**按名号开键的对象** `bookText[entity.name]`。
 *  本台第一版递了**整本书那个字符串** ⇒ `'…'.name` 是 undefined ⇒ 取到 `[]`
 *  ⇒ `runLookup` 的 `.filter((t) => t.entries.length)` **把每一个目标都丢掉**
 *  ⇒ 返回 `{byName:{}, skipped:'no-source'}` ⇒ `applyLookup` 把"**没读到书**"记成
 *     `sources[id] = []`＝"**书读到了、但书里确实没有这个名号**" ⇒ 账上一律 `absent`「书未明述」。
 *  ★结果我一度把它报成"**可疑的真病**"——**错的是我**：引擎对"我递的那个形状"处置得**与它自己的注释逐字一致**。
 *  ★教训（本台第 10 次同一个形状）：**"书上没写"和"我没把书递给它"在读数上一模一样**；
 *    凡要报"某处是空的"，先证自己**递对了对象**、找对了名字。
 *  ⇒ 现在按生产那个形状递：**一个按实体取条目的函数**（条目按 `comment`/`key` 对上实体正名）。 */
function bookSourceFor(entries) {
    return (entity) => {
        const nm = String(entity?.name ?? '').trim();
        if (!nm) return [];
        return (entries || []).filter((e) => {
            const c = String(e?.comment ?? e?.name ?? '').trim();
            const keys = Array.isArray(e?.key) ? e.key.map(String) : (e?.key ? [String(e.key)] : []);
            return c === nm || keys.includes(nm);
        })
        // ★★形状（`entity-lookup.js:320` 现读）：`buildLookupPrompt` 取的是 **`x.text`**——
        //   `const src = (t.entries || []).filter((x) => x && x.text);`
        //   ⇒ 条目必须是 `{name, text}`。递 `{comment, content}`（ST 世界书的原字段名）**它一个都不认**，
        //     于是提示词里印成「（本书没有该名号的条目）」——**看着像"书里没有"，其实是"形状不对"**。
        //   ★这是本台同一个形状的第 11 次（"没有内容"与"我递错了形状"读数一样）——**别再猜，去读那一行**。
            .map((e) => ({ name: String(e?.comment ?? e?.name ?? '').trim(), text: String(e?.content ?? e?.text ?? '') }));
    };
}
let bookSourceFn = LOOKUP_BOOK ? bookSourceFor(bookEntriesForLookup) : null;
// ★★面③（查书写回）的耗时**要单独扣掉**：前置步那几次调用走的是另一条通道，
//   不扣就会把它算进"引擎侧耗时"（实测：不扣时引擎侧显示 7926ms，看着像引擎慢了八秒）。
let lookupMsRound = 0;
let lookupMsTotal = 0;
// ★面⑥：超时那一层（见 `TIMEOUT_SEC` 那段的说明——形状与 `transport-http.js` 的发法逐条对齐）
const timedTransport = async (p) => {
    if (TIMEOUT_SEC == null) return rawTransport(p);
    // ★这一轮"模型不回话"：**永不 resolve** ⇒ 只有超时那道闸能结束它（真跑里就是这样）。
    //   ★台子第一版把这一支**写在定时器之前直接 return** ⇒ 那一轮**没有任何东西能结束它**，
    //     实测当场把台子挂住（Node 报 `Detected unsettled top-level await`）——留档。
    const work = HANG.has(currentRound) ? new Promise(() => {}) : Promise.resolve(rawTransport(p));
    let timer = null;
    const timeoutErr = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(Object.assign(new Error(`模型超时（${TIMEOUT_SEC * 1000}ms）——这一轮没等到模型回话，已中止`),
                { sw2Timeout: true }));
        }, TIMEOUT_SEC * 1000);
    });
    try {
        return await Promise.race([work, timeoutErr]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};
const capturedTransport = async (p) => {
    const t0 = Date.now();
    const out = await timedTransport(p);
    const text = typeof out === 'string' ? out : (out && typeof out.text === 'string' ? out.text : '');
    lastOut = {
        ms: Date.now() - t0,
        outChars: Array.from(text).length,
        outTokEst: Math.round(Array.from(text).length / 1.6),   // 与 `pack.TOKEN_RATIO` 同口径（1600 字符 ≈ 1000 token）
        text,
    };
    return out;
};

/** ★宽容解析：只为读数（引擎自己那条路有它自己的解析与净化，这里不许替它判）。 */
function looseParse(text) {
    const s = String(text || '').trim();
    for (const cand of [s, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)]) {
        if (!cand) continue;
        try { const o = JSON.parse(cand); if (o && typeof o === 'object') return o; } catch (_) { /* 下一手 */ }
    }
    return null;
}

// ───────────────────────── 3. 账本快照与不变量 ─────────────────────────
/** 账上"每一件东西"的身份：id 唯一 · 老事不许被改写 · 闭环不许复活 · 不许凭空消失。 */
function accountSnapshot(world) {
    const ev = new Map();    // 热账事件
    const row = new Map();   // 归档副本（`milestones[].rows`）——归档会把事件从热账**删掉**，这是合法的"搬走"
    const ag = new Map();
    for (const e of world.events || []) {
        ev.set(e.id, {
            title: e.title ?? '', st: e.source?.type ?? null, sr: e.source?.ref ?? null,
            closed: !!e.closed, up: (e.links?.up || []).length,
        });
    }
    for (const m of world.milestones || []) {
        for (const r of m.rows || []) {
            if (!row.has(r.id)) row.set(r.id, { title: r.title ?? '', st: r.source?.type ?? null, sr: r.source?.ref ?? null });
        }
    }
    for (const a of world.agendas || []) {
        ag.set(a.id, { goal: String(a.goal ?? ''), closed: !!a.closed, st: a.source?.type ?? null, sr: a.source?.ref ?? null });
    }
    return { ev, ag, row };
}

/** 单亲＋无环：顺着"我来路是谁"往上走，必须**走得出去**（走回自己就是环）。 */
function walkIntegrity(world) {
    const evById = new Map((world.events || []).map((e) => [e.id, e]));
    const rowById = new Map();
    for (const m of world.milestones || []) for (const r of m.rows || []) if (!rowById.has(r.id)) rowById.set(r.id, r);
    const agById = new Map((world.agendas || []).map((a) => [a.id, a]));
    const parentOf = (kind, node) => {
        const st = node?.source?.type, ref = node?.source?.ref;
        if (kind === 'event') {
            if (st === 'ripple' && ref) return { kind: 'event', id: ref };
            if (st === 'plot' && ref) return { kind: 'agenda', id: ref };
            return null;
        }
        if (st === 'parent' && ref) return { kind: 'agenda', id: ref };
        if (st === 'event' && ref) return { kind: 'event', id: ref };
        if (node?.parentId) return { kind: 'agenda', id: node.parentId };
        return null;
    };
    const get = (k, id) => (k === 'event' ? (evById.get(id) || rowById.get(id)) : agById.get(id));
    let cycles = 0, danglingParents = 0;
    const ids = [...evById.keys(), ...agById.keys()];
    for (const id of ids) {
        const kind = evById.has(id) ? 'event' : 'agenda';
        let cur = { kind, id };
        const seen = new Set();
        while (cur) {
            const key = `${cur.kind}:${cur.id}`;
            if (seen.has(key)) { cycles += 1; break; }
            seen.add(key);
            const node = cur.id === id && cur.kind === kind ? get(kind, id) : get(cur.kind, cur.id);
            if (!node) { danglingParents += 1; break; }
            const p = parentOf(cur.kind, node);
            if (p && !get(p.kind, p.id)) { danglingParents += 1; break; }
            cur = p;
        }
    }
    // 单亲：来路是一件**单个对象**（契约层就禁止多来路）⇒ 这里查的是"有没有人偷偷用 `links.up` 当第二个来路"。
    //   口径：`links.up` 是**多因（入边）**，不是划分的根据（总稿 §4.6）——所以它**不该**被当成 parent。
    //   本格只报"一条 `links.up` 指向了不存在的东西"（悬空多因）。
    return { cycles, danglingParents };
}

/** 多因那一格的自查（`links.up`）。
 *  ★★口径纪律（本台第一版在这里踩过一次，留档免得下一任重踩）：**"悬不悬空"必须用引擎自己那把尺**。
 *    引擎的 `observatory.js:scanDanglingRefs` 把"已归档的号"也算**可达**（`milestones[].ids`；
 *    归档时事件的 `links` 会被搬到里程碑上、行里只留五格，见 `settle.js:737`），
 *    而自建的一套只认热账 ⇒ **归档一发生就报假警**（实测第 1 轮就误报了一条"悬空多因"，引擎自己报 0）。
 *    ⇒ 同一个问题**不许有两把尺**：悬空一律采信引擎的数，本函数只补两件引擎不替我们答的——
 *      **自指**（`up` 指向自己）与**热账里的多因点个数**。 */
function upstreamIntegrity(world, engineDangling) {
    let selfUp = 0, hotMultiCause = 0, upTotal = 0;
    for (const e of world.events || []) {
        const up = e.links?.up || [];
        if (up.length >= 2) hotMultiCause += 1;
        upTotal += up.length;
        for (const u of up) if (u === e.id) selfUp += 1;
    }
    return { danglingUp: engineDangling, selfUp, hotMultiCause, upTotal };
}

// ★★★leg130（面①：**裁剪序**）——`trimPack` 那条**固定剪枝序**（总稿 §3.3 那张表）。
//   为什么要在这里抄一份：**要判"顺序对不对"，就得有一份"应该是怎样"**。
//   ★口径纪律：这份表是**照 `src/pack.js` 的 `trimPack` 现读**抄下来的（顺序、名字逐字），
//     不是照文档抄的——文档与代码冲突时**以代码为准**（本仓铁律）。代码里那八段依次是：
const TRIM_ORDER = [
    'entities.slim',        // ① 实体行：逐出麾下成员简表／分支表／机构表
    'entities.idOnly',      // ② 实体行：只剩 id+name
    'recentClosedEvents',   // ③ 最近了结的事：只留 id（`closed` 记号必须还在）
    'pendingEvents',        // ④ 未决事件：只留 id+title
    'agendas.detail',       // ⑤ 在飞盘算：只留 id+goal+progress
    'closedAgendas',        // ⑥ 已了结盘算：只留 id+goal
    '纪事',                 // ⑦ 往事：**整栏拿掉**（不是截短；装回来由末道额度守卫做）
    '相关往事',             // ⑦.⑤ ★leg132：引擎替模型翻回来的旧账——排在"往事"之后丢（"有选择"的那一条比"没选择"的那一条值钱）
    'idleFaces',            // ⑧ 待启用名单：**整段丢弃**（不截短——名单靠轮换保证公平）
];

/** ★★面① 的判据函数：**这一轮裁得对不对**。
 *  ★它只做三件机械的事，**不作任何语义判断**：
 *    ① `trimmed` 里那几段的名字，**必须是固定序的一个子序列**（顺序不许乱、不许回头）；
 *    ② 每段只许出现**一次**（`纪事` 那格允许带尾巴 `纪事.留N条`）；
 *    ③ `budgetOverrun` 若出现，**必须在最末**（它是"序全走完仍越界"的兜底痕迹）。
 *  ★★为什么要判"顺序"而不是只判"裁过"：**顺序就是这份设计的全部内容**——
 *    "先裁实体细节、最后动往事"是这个机制的意义所在；只报"裁过 N 轮"等于什么都没验。 */
function trimAudit(trimmed) {
    if (!Array.isArray(trimmed) || !trimmed.length) return null;
    const names = trimmed.map((s) => String(s));
    const base = names.map((s) => (s.startsWith('纪事') ? '纪事' : s));
    const segs = base.filter((s) => s !== 'budgetOverrun');
    const slots = segs.map((s) => TRIM_ORDER.indexOf(s));
    const unknown = segs.filter((s) => TRIM_ORDER.indexOf(s) < 0);
    const ordered = slots.every((v, i) => v >= 0 && (i === 0 || v > slots[i - 1]));
    const onceEach = new Set(segs).size === segs.length;
    const overrunLast = !names.includes('budgetOverrun') || names[names.length - 1] === 'budgetOverrun';
    return {
        段: segs, 顺序: ordered, 无重段: onceEach, 兜底在末: overrunLast,
        认不出的段: unknown,
        // ★往事那一段的**两种形态**（`纪事`＝整栏没装下；`纪事.留N条`＝装回了一部分）
        往事留痕: names.find((s) => s.startsWith('纪事')) || null,
        合规: ordered && onceEach && overrunLast && unknown.length === 0,
    };
}

/** 包读数：预算占比 · 裁剪痕迹 · 各栏条数 · ★新链那两栏。
 *  ★坑（本台第一版就踩了，零模型调用那一跑当场抓出来）：`buildEvolutionPack` 返回的是**包一层壳**
 *    `{ pack, text, estTokens, estBeforeTrim }`——**不是包本身**。照壳读 ⇒ `故事线`/`trimmed` 全读成空，
 *    而提示词里其实有（"监视器永远不报警"那种失效形状）。⇒ 这里一律先拆壳，并且
 *    **用引擎自己算的 `estTokens`**（同一把尺，不另算）。
 *  ★★leg130 修的一格（同一种"找错了名字"的病）：**预算也是现读的**——
 *    第一版写死 `EVOLUTION_BUDGET_TOKENS`（出厂 30000）⇒ `--budget=3000` 那一跑的
 *    `pct`／"越预算(量)"两格会**拿出厂值当尺子量一个被拧过的世界**，读数全是假的。 */
function packReadout(w, world) {
    if (!w || !w.pack) return null;
    const pack = w.pack;
    const budget = resolveLimits(world).包预算;      // ★引擎那把尺，不另立
    const est = Number.isFinite(w.estTokens) ? w.estTokens : estTokens(pack);
    const keys = Object.keys(pack);
    const arr = (k) => (Array.isArray(pack[k]) ? pack[k].length : (pack[k] === undefined ? 0 : 1));
    const story = Array.isArray(pack['故事线']) ? pack['故事线'] : [];
    // ★`·合流N` 是"这条线里有几个多因点"（总稿 §4.1）——把 N 加起来就是这一轮看得见的多因点总数
    let multiCauseMarks = 0, multiCauseLines = 0;
    for (const s of story) {
        const m = /·合流(\d+)/.exec(String(s));
        if (m) { multiCauseMarks += Number(m[1]); multiCauseLines += 1; }
    }
    const trimmed = Array.isArray(pack.trimmed) ? pack.trimmed : null;
    // ★★leg130：末道额度守卫那两条硬口径（总稿 §3.3 末行 / 交接 §6 ① 的"看什么"）——
    //   ① **整条收、整条丢**（不许拦腰砍半句）；② 装回来的是**最新那一端**（不是随手一段）。
    //   ★怎么证的：拿包里的 `纪事` 跟**全量那一份**（`pack.__chronicle`，不可枚举、不进序列化）
    //     逐行对**身份**（同一批字符串对象）＋对**位次**（必须是那一段的尾巴）。这是机械核对，不是眼看。
    const fullBrief = Array.isArray(pack.__chronicle) ? pack.__chronicle : null;
    const keptBrief = Array.isArray(pack['纪事']) ? pack['纪事'] : null;
    const briefIntact = (() => {
        if (!keptBrief || !keptBrief.length) return true;                 // 一条没装 ⇒ 无所谓整不整
        if (!fullBrief) return null;                                      // 拿不到全量 ⇒ **不许猜**（空着就是空着）
        const whole = keptBrief.every((r) => fullBrief.includes(r));       // 每一行都是原文里那一行（不是截断的）
        const tail = fullBrief.slice(-keptBrief.length);
        const isTail = whole && tail.every((r, i) => r === keptBrief[i]);  // 且正好是最新那一段
        return whole && isTail;
    })();
    return {
        est, budget, pct: Number((100 * est / budget).toFixed(2)),
        // ★"裁之前有多大"（`estBeforeTrim` 只在真裁过时才带出来）——它答的是"我该把预算填多少"
        estBeforeTrim: Number.isFinite(w.estBeforeTrim) ? w.estBeforeTrim : null,
        chars: String(w.text ?? '').length,
        trimmed,
        trim: trimAudit(trimmed),
        // ★★面① 最要紧的一格：**裁到这一步，"故事线"还在不在**（总稿 §4.5"先装地图、再装地皮"）。
        //   它在 ⇒ 地图保住了；它不在 ⇒ 地图被地皮挤掉了（那是设计里明说"不许发生"的事）。
        故事线在: Array.isArray(pack['故事线']),
        // ★★leg130（面④规模）：实体段占包比 ＋ 待启用名单这一轮点了谁
        //   ★"实体段占包比"要拿**同一个量体函数**量（`packTextOf` 对 `entities` 那一格换行式表格），
        //     本台不另立算法；外层那个 `{"entities":"…"}` 壳约 16 字符，是常数、不影响比值的读法。
        实体段占包比: null,   // 由调用方补（要拿 `est` 做分母）
        实体段est: estTokens({ entities: pack.entities }),
        待启用池: computeIdleFaces(world, 9999).length,   // ★池子多大（用**引擎自己那把尺**数，不另算）
        idleFacesIds: Array.isArray(pack.idleFaces) ? pack.idleFaces.map((x) => x?.id).filter(Boolean) : [],
        卷行数: 0, 卷行进包数: 0,   // ★面⑤：由调用方补（要拿 `volumes` 与包里的 `纪事` 对）
        // ★★leg130（面③）：书的原件那两栏——`刻度`（书里的尺子）与`法则`（书里的判定原则）。
        //   ★★★**本台第四次栽在"找错了名字"上**（前三次：读包壳 · 悬空自建一把尺 · 中文名对英文键）——
        //     第一版这里读的是**包顶层**的 `pack['刻度']` / `pack['法则']`，当场报"两栏都没进包"；
        //     真相是它们**住在 `pack.setting` 里面**（`pack.js:1007-1014`：`setting: {...(scale?{刻度:scale}:{}),
        //     ...(ruleAnchor?{法则:ruleAnchor}:{})}`）⇒ **包顶层根本没有这两个键**。
        //   ★教训（与前三处同一个形状，再记一遍）：**"那一栏是空的"与"我找错了地方"在读数上一模一样**；
        //     凡要报"某栏没进包"，先**把包摊开**看真键（这一格现在把 `setting` 的子键也印出来自证）。
        刻度在: pack.setting?.['刻度'] !== undefined,
        法则在: pack.setting?.['法则'] !== undefined,
        刻度表数: Array.isArray(pack.setting?.['刻度']) ? pack.setting['刻度'].length : 0,
        法则条数: Array.isArray(pack.setting?.['法则']) ? pack.setting['法则'].length : 0,
        setting子键: pack.setting ? Object.keys(pack.setting) : null,
        按需查表在: pack.setting?.['刻度补'] !== undefined,
        刻度法则被块级切: pack.dropped ? Object.keys(pack.dropped) : null,
        纪事条数: Array.isArray(pack['纪事']) ? pack['纪事'].length : 0,
        // ★末道守卫那两条：整条收整条丢 · 装的是最新那一端（`null` = 拿不到全量，**不许猜**）
        纪事整条: briefIntact,
        纪事全量条数: fullBrief ? fullBrief.length : null,
        overrun: Array.isArray(trimmed) && trimmed.includes('budgetOverrun'),
        keys,
        // ★★★本台的**第三处"监视器读了个空"**（前两处：读了包壳、悬空自建一把尺）——留档，免得下一任再踩：
        //   这一格第一版写的是**中文栏目名**（`实体`／`在飞盘算`／`关系`…），可包里真正的键**大半是英文**的
        //   （`entities`／`agendas`／`relations`／`pendingEvents`／`departed`／`idleFaces`…），
        //   只有 `故事线`／`纪事` 是中文键 ⇒ 那一排读数**大半恒为 0**，而控制台上看着"挺正常"。
        //   ⇒ 现在**按真键数**（并把真键原样印在 `keys` 里，自证口径）。
        //   ★教训一句话：**"没有内容"和"我找错了名字"在读数上长得一模一样**——
        //     凡是要报"某栏是空的"，先证明自己找对了名字。
        counts: Object.fromEntries(keys.map((k) => [k, arr(k)])),
        storyLines: story.slice(0, 3),
        multiCauseMarks, multiCauseLines,
    };
}

/** ★★leg130（面②：正文那条路）——**正文进去之后，引擎这一侧到底收下了什么**。
 *  为什么单独立一格：这条路的每一段（解析 → 注册 → 落格 → 递回模型 → 盖时间印记）**都有自己的口径**，
 *  而"没压到"时它们的读数**全是 0**——0 与"我找错了名字"在读数上长得一样（本台的老病）⇒
 *  所以这里把**每一段的原话读数**都摊开，谁没动一眼看得见。
 *  ★口径：一律**照引擎自己交出来的那几格读**（`r.tagFacts` / `r.dialogueStats` / `r.tagReadout` / 账上的
 *    `meta.lastInjection` 与编年行），**本台不自己再解析一遍正文**（那就成了第二把尺子）。 */
function dialogueReadout(r, world, chronicleBefore) {
    const f = r?.tagFacts || null;
    if (!f) return null;
    const rows = Array.isArray(world?.chronicle) ? world.chronicle : [];
    const newRows = rows.slice(chronicleBefore);
    return {
        // ── 解析那一段（`extractTags` 的收料面）──
        解析行数: f.parsed ?? 0, 进包条数: f.count ?? 0,
        行动: f.actions?.length ?? 0,
        变化: f.changes?.length ?? 0, 变化丢: f.changesBad?.length ?? 0,
        承诺: f.promises?.length ?? 0, 承诺丢: f.promisesBad?.length ?? 0,
        主角: f.player ? 1 : 0,
        归不上名字: (f.unresolved || []).reduce((n, u) => n + (u.n || 0), 0),
        不在名册也给看: f.notNoted?.length ?? 0,
        形状不合: f.malformed?.length ?? 0,
        此刻: f.at ?? null, 时长: f.elapsed || null,
        围栏: f.shell ? `${f.shell.found ? '有' : '没有'}（按${f.shell.mode}扫）` : null,
        // ── 落账那一段（`registerDialogueFacts` 的 stats）──
        落账事件: r.dialogueStats?.events ?? 0, 落格: r.dialogueStats?.updates ?? 0,
        落账丢: r.dialogueStats?.dropped ?? 0, 落账封顶: r.dialogueStats?.capped ?? 0,
        // ── 递回去那一段 ──
        读数行: r.tagReadout || null,
        注入行: world?.meta?.lastInjection ? String(world.meta.lastInjection).slice(0, 90) : null,
        // ── 时间印记那一段（`stampChronicleTime`）──
        本轮新编年: newRows.length,
        本轮盖了时长印记: newRows.filter((x) => x && x.elapsed).length,
        编年累计有时长印记: rows.filter((x) => x && x.elapsed).length,
        本轮编年带此刻: newRows.filter((x) => x && x.timeMark).length,
    };
}

/** ★失败归因：本台第一次真跑（27 轮）里 **10 轮报废**，逐条读下来**全是同一个病根**——
 *  **模型从"已经了结的事"里取号**（三个面：新线的源 / 变更的因 / 收场）。归成一类，别报成三条病。 */
function failKindOf(err) {
    const s = String(err || '');
    // ★leg130（面⑥）：超时**是止损**，不是"可重试的瞬时错"（`transport-http.js` 用 `sw2Timeout` 把两者分开）
    if (/超时|sw2Timeout/.test(s)) return '模型超时（止损·不重试）';
    if (s.includes('起盘算要挂在')) return '挂在已了结的事上起新线';
    if (s.includes('cause: 因必须是')) return '拿旧事解释今天的变化';
    if (s.includes('收场是一次性的')) return '给已了结的事收场';
    if (s.includes('非法 JSON')) return '返回非法 JSON';
    if (s.includes('传输失败') || s.includes('返回空')) return '传输/空返回';
    return `其它: ${s.slice(0, 60)}`;
}

// ───────────────────────── 4. 长跑主循环 ─────────────────────────
line('════════ 开始长跑 ════════');

// ─────────── ★★起跑前的对照（**回归哨兵**：这四条必须同数） ───────────
// 背景（留档，免得下一任看不懂这一格在守什么）：本台第一次真跑时，"处境／种子"根**永不收口**
//   （`settle.js:378` 的自动收口只扫 `ripple`），而立线判据要求**整棵树全收口、根也算**
//   （老 `lines.js:180`）⇒ **凡挂在"处境／种子"上的树永远立不成线**（实测：一棵 17 件的大树一次都没进过包）。
// ⇒ 已修：**"起点"不参与"全收口"那一格**（见 `src/lines.js` 的 `forestOf`）。
// ★这一格现在是**回归哨兵**：四条必须**同数**。哪一条掉回 1，就是有人把那格改回去了。
{
    const mk = (rootType, rootClosed) => {
        const w = buildSeedWorld();
        w.events[0].source = { type: rootType };
        w.events[0].closed = rootClosed;
        return w;
    };
    // ★2×2：根的类型（`state`＝由处境而生 / `seed`＝**生产做种走的就是这一型**，见 `src/seed-roots.js:156`）
    //        × 根收没收口。两型在"引擎自己那一圈收不收它"这件事上**同命**（`settle.js:378` 只扫 ripple）。
    const arms = [
        ['state 根 · 开着', mk('state', false)],
        ['state 根 · 收了口', mk('state', true)],
        ['seed  根 · 开着（★生产做种就是这一型）', mk('seed', false)],
        ['seed  根 · 收了口', mk('seed', true)],
    ];
    line('★起跑前对照（回归哨兵：四条必须同数——修之前"开着"那两条会各少 1 条）：');
    const totals = [];
    for (const [name, w] of arms) {
        const r = linesOf(w);
        totals.push(r.total);
        line(`   ${name.padEnd(34, ' ')} ⇒ 立线 **${r.total}** 条 / 树 ${r.trees} 棵`);
    }
    const same = totals.every((v) => v === totals[0]);
    line(`   ⇒ ${same ? `★四条一致（都是 ${totals[0]} 条）⇒ 那一格没被改回去` : `✗ 不一致（${totals.join('/')}）——"起点卡树"那个病回来了，见 src/lines.js 的 forestOf`}`);
    line('');
}
const tRun0 = Date.now();
// ★leg130：起点世界**带上旋钮**（默认＝原样）。`applyKnobs` 只往账上写一格（`dynamic.env.包预算`），
//   走的是面板那条真写通道 ⇒ 引擎读到的与生产上"玩家自己填了一个小值"**同一条路**。
//   ★`--book` 给了 ⇒ 世界从**书**起（走生产那条抽书路），否则仍是本台那台合成世界。
let world = applyKnobs(BOOK ? await buildBookWorld() : buildSeedWorld(ROSTER, SEED_AGENDAS));
const volumes = [];
const prevSnap = { current: accountSnapshot(world) };
const seenTitles = new Map();     // 归一化标题 → 出现过几次（生成质量：重复）
const rows = [];
const findings = [];              // ★"隐形 bug"候选：不变量被破 / 引擎自己报的病
let mainCallMs = 0, mainCallChars = 0;
let prevLineDetail = 0;           // 上一轮模型点名要了几条（这一轮该收到几条）

function note(kind, detail) {
    findings.push({ tick: world.meta?.tick ?? 0, kind, detail: String(detail).slice(0, 300) });
    line(`   ⚠ [${kind}] ${String(detail).slice(0, 220)}`);
}

for (let t = 1; t <= TICKS; t += 1) {
    currentRound = t;
    if (existsSync(STOP_FILE)) { line(`\n★ 看到 ${STOP_FILE} ⇒ 收拾停当，提前收工（跑完 ${t - 1} 轮）。`); break; }

    const before = prevSnap.current;
    const tickBefore = world.meta?.tick ?? 0;
    const chronicleBefore = (world.chronicle || []).length;
    lastOut = null;
    lookupMsRound = 0;
    const t0 = Date.now();
    let r = null, thrown = null;
    try {
        // ★递 `ledgerVolumes`（生产里这一步是递的）：编年剥进卷之后，**模型还看得见那些旧往事**。
        //   不递 ⇒ 剥走的那段等于**从模型眼前消失**（不是"搬走了"，是"没了"）⇒ 长跑读数会失真。
        // ★leg130：正文与 calls 改走旋钮（默认仍是空串 / 1 ⇒ 与 leg129 那一跑同口径）。
        r = await runTick({
            transport: capturedTransport, ssot: world, dialogue: DIALOGUE,
            extractCtx: {}, calls: CALLS, ledgerVolumes: volumes,
            // ★面③（查书写回）：接法与生产逐字一致（见 `web/index.js` 的 `preStep`）。
            //   ★前置步的调用**不走那层故意超时**（生产上它另有一档更宽的抽取超时），也别混进主调用读数。
            ...(LOOKUP ? {
                preStep: async ({ ssot: cur, move }) => {
                    const pre = await runEntityLookupStep({
                        ssot: cur,
                        transport: async (p) => {
                            const t = Date.now();
                            try { return await rawTransport(p); } finally { lookupMsRound += Date.now() - t; }
                        },
                        // ★★这里递的**不是书文那个字符串**，是"按实体取条目"的函数（见 `bookSourceFor` 那段留档）
                        bookText: bookSourceFn || bookTextForLookup || '',
                        tick: cur?.meta?.tick ?? 0,
                        moveFact: move,
                        prevPicks: lastPicks,
                        bookEntries: bookEntriesForLookup,
                    });
                    lastLookup = pre;
                    return pre;
                },
                onPreStep: async (pre) => { if (pre?.picks) lastPicks = pre.picks; },
            } : {}),
        });
    } catch (e) {
        thrown = String((e && e.stack) || e);
    }
    const wallMs = Date.now() - t0;
    lookupMsTotal += lookupMsRound;
    if (lastOut) { mainCallMs += lastOut.ms; mainCallChars += lastOut.outChars; }

    const row = {
        t, tickBefore, wallMs, mainMs: lastOut?.ms ?? null,
        // ★★leg130：**引擎侧耗时** = 整轮 − 主调用。面① 那条性能病（"逐行量包 ⇒ 单轮 1100ms"）
        //   量的就是这一格：真跑里它与模型耗时混在一起（几百倍噪声），**只有减掉才看得见**。
        //   ★`--fake` 那一跑的主调用几乎是 0ms ⇒ 那一跑的 `engineMs` 就是**干净读数**。
        engineMs: lastOut ? Math.max(0, wallMs - lastOut.ms - lookupMsRound) : wallMs,
        lookupMs: lookupMsRound,
        outChars: lastOut?.outChars ?? null, outTokEst: lastOut?.outTokEst ?? null,
        ok: !!r?.ok, error: r?.ok ? null : (thrown || r?.error || '未知失败'),
        // ★`healed` 是**对象**（`{used,dropped,warnings,errors}`）——**恒真**，不许直接 `if (r.healed)`：
        //   认它有没有真走自愈，只看 `used`（第一版写成 `if (r.healed)` ⇒ 每轮都误报一次"自愈"，见下）。
        healed: r?.healed?.used === true,
        healedDetail: r?.healed?.used === true ? JSON.stringify(r.healed).slice(0, 220) : null,
        warnings: (r?.stage?.warnings || []).length,
        warningSamples: (r?.stage?.warnings || []).slice(0, 4).map((w) => String(w).slice(0, 160)),
        pack: null, storyLineDetails: null, namedLines: null, lineDetailGiven: null,
        account: null, observatory: null, integrity: null, quality: null, dialogue: null,
    };

    if (r?.ok) {
        world = r.ssot;

        // ★森林读数：立了几条线 · 最大的树多大 · **有几棵树"只差收口"就能立线**
        //   （最后一格是本台第一件发现的量化：挂在"处境根"上的树全都卡在这里）
        {
            const fo = forestOf(world);
            const nearly = fo.trees
                .filter((t) => t.eventCount >= LINE_MIN_EVENTS && !t.allClosed)
                .map((t) => ({ 根: t.root, 件: t.eventCount, 根是: t.rootType }))
                .sort((a, b) => b.件 - a.件);
            row.forest = {
                树: fo.trees.length, 线: linesOf(world).total,
                最大的树: Math.max(0, ...fo.trees.map((t) => t.nodeCount)),
                没收口的树: fo.trees.filter((t) => !t.allClosed).length,
                差一格就能立线: nearly,
            };
        }

        // ③ 包（★`world` 也递进去——预算那一格要按**账上生效的那个数**量，不许拿出厂值当尺子）
        row.pack = packReadout(r.pack, world);
        if (row.pack) {
            // ★面④：实体段占包比（分母是**引擎自己算的那一份** `estTokens`）
            row.pack.实体段占包比 = row.pack.est ? Number((100 * row.pack.实体段est / row.pack.est).toFixed(1)) : null;
            // ★面⑤：**卷里的旧往事，模型还看得见吗**。
            //   ★★★本台**第七次**栽在"读了个空"上，留档：第一版拿 `轮次|原文` 去对，
            //     可包里那些行是**洗过行文的**（`fetchChroniclePast` 走 `briefLineText` 重写过文字），
            //     于是逐字比对**一条都对不上**，当场报"卷里的往事一条都没进包"——**那是假警报**。
            //   ⇒ 改成按**轮次**对（干净、机械）：找出"只在卷里、已经不在热账里"的那些轮次，
            //     再看包里有没有出现这些轮次。**出现了 ⇒ 卷真的被读回来了**。
            const hotTicks = new Set((world.chronicle || []).map((rr) => Number(rr.tick)));
            const volTicks = new Set();
            for (const v of volumes) for (const rr of v.rows || []) volTicks.add(Number(rr.tick));
            const onlyVol = [...volTicks].filter((tk) => !hotTicks.has(tk));
            const packTicks = new Set((Array.isArray(r.pack.pack?.['纪事']) ? r.pack.pack['纪事'] : [])
                .map((rr) => Number(rr.tick)));
            row.pack.卷里独有的轮次 = onlyVol.length;
            row.pack.包里出现的卷里独有轮次 = onlyVol.filter((tk) => packTicks.has(tk)).length;
        }
        // ④ ★新链：模型这一轮点名要了哪几条线（从**原始输出**里读，宽容解析）
        const parsed = looseParse(lastOut?.text);
        row.parseOk = !!parsed;
        const wanted = parsed?.lookupLines;
        row.namedLines = Array.isArray(wanted) ? wanted.length : 0;
        row.storyLineDetails = (Array.isArray(wanted) ? wanted : []).slice(0, 6);
        // ★这一轮真收到的"线的经过"条数（= 上一轮点名、这一轮兑现）。
        //   ★注意先拆壳（`r.pack` 是 `{pack,text,estTokens}`，不是包本身）——第一版这里也读错了一次。
        row.lineDetailGiven = Array.isArray(r.pack?.pack?.['线的经过']) ? r.pack.pack['线的经过'].length : 0;
        // ⑤ 账
        const snap = accountSnapshot(world);
        const newEv = [...snap.ev.keys()].filter((id) => !before.ev.has(id));
        const newAg = [...snap.ag.keys()].filter((id) => !before.ag.has(id));
        const nowArchived = [...before.ev.keys()].filter((id) => !snap.ev.has(id) && snap.row.has(id));
        row.account = {
            newEvents: newEv.length, newAgendas: newAg.length,
            // ★★leg130（面③）：`seed` 型根（"世界源起的根"那一型）——**账上真出现**才算压到
            seed型根: (world.events || []).filter((e) => e.source?.type === 'seed').length,
            dialogue型事件: (world.events || []).filter((e) => e.source?.type === 'dialogue').length,
            events: snap.ev.size, agendas: snap.ag.size,
            openEvents: [...snap.ev.values()].filter((x) => !x.closed).length,
            closedEvents: [...snap.ev.values()].filter((x) => x.closed).length,
            openAgendas: [...snap.ag.values()].filter((x) => !x.closed).length,
            archived: nowArchived.length,
            chronicleAdded: (world.chronicle || []).length - chronicleBefore,
            chronicle: (world.chronicle || []).length,
            volumes: volumes.length,
            sourceKinds: newEv.length ? (() => {
                const d = {};
                for (const id of newEv) { const k = snap.ev.get(id).st ?? '无源'; d[k] = (d[k] || 0) + 1; }
                return d;
            })() : {},
            newEventSamples: newEv.slice(0, 5).map((id) => ({ id, title: snap.ev.get(id).title, st: snap.ev.get(id).st, sr: snap.ev.get(id).sr })),
            newAgendaSamples: newAg.slice(0, 3).map((id) => ({ id, goal: snap.ag.get(id).goal.slice(0, 60), st: snap.ag.get(id).st, sr: snap.ag.get(id).sr })),
        };

        // ⑥ 观测台（现成的三件；★`scanDanglingRefs` 返回的是 `{ dangling, count }` 对象，不是数组）
        row.observatory = {
            dangling: scanDanglingRefs(world).count,
            rejection: rejectionStats(world.meta?.simLog),
            residency: residencyStats(world).loungers?.length ?? null,
        };
        // ⑥.⑤ ★★面②：正文那条路（没喂正文时这一格是 `null`——**不是 0**："没压到"与"压了没收下"要分得开）
        row.dialogue = dialogueReadout(r, world, chronicleBefore);
        // ⑥.⑥ ★★面③的另一半：**查书写回**（没开 `--lookup` 时是 `null`，同上）
        row.lookup = LOOKUP ? {
            选中几人: lastLookup?.picks?.length ?? 0,
            清零调用: lastLookup?.calls ?? 0,
            警告: lastLookup?.warning || null,
            stats: lastLookup?.stats || null,
            位置继承: lastLookup?.locationInherited ?? 0,
            // ★"回写有没有落到账上"的**结果面**：账上真带 `实力` 的实体有几个
            账上有实力的实体: (world.entities || []).filter((e) => typeof e['实力'] === 'string' && e['实力'].trim()).length,
            包里有实力的行: (Array.isArray(r.pack?.pack?.entities) ? r.pack.pack.entities : [])
                .filter((e) => e && typeof e['实力'] === 'string' && e['实力'].trim()).length,
        } : null;

        // ⑦ ★不变量自查——**这里最可能抓到隐形 bug**
        const integ = walkIntegrity(world);
        const ups = upstreamIntegrity(world, row.observatory.dangling);
        const broken = { rewritten: [], revived: [], vanished: [], agendaRewritten: [], agendaVanished: [] };        for (const [id, now] of snap.ev) {
            const was = before.ev.get(id);
            if (!was) continue;
            if (was.title !== now.title || was.st !== now.st || was.sr !== now.sr) broken.rewritten.push(id);
            if (was.closed && !now.closed) broken.revived.push(id);
        }
        for (const id of before.ev.keys()) {
            if (!snap.ev.has(id) && !snap.row.has(id)) broken.vanished.push(id);
        }
        for (const [id, now] of snap.ag) {
            const was = before.ag.get(id);
            if (!was) continue;
            if (was.goal !== now.goal || was.st !== now.st || was.sr !== now.sr) broken.agendaRewritten.push(id);
        }
        for (const id of before.ag.keys()) if (!snap.ag.has(id)) broken.agendaVanished.push(id);
        // ★编年"只长不缩"：本轮的轮转发生在这段检查**之后** ⇒ 这里它只该变长
        row.integrity = { ...integ, ...ups, broken, chronicleShrank: row.account.chronicleAdded < 0 };

        // ⑧ 生成质量
        const dup = [];
        for (const id of newEv) {
            const key = snap.ev.get(id).title.replace(/\s+/g, '');
            if (!key) continue;
            const n = (seenTitles.get(key) || 0) + 1;
            seenTitles.set(key, n);
            if (n > 1) dup.push(key);
        }
        row.quality = { dupTitles: dup.length, dupSamples: dup.slice(0, 3), emptyTick: newEv.length === 0, noSource: newEv.filter((id) => !snap.ev.get(id).st).length };

        // ★把不变量被破的每一件**立刻**报名（不要等到收尾才说）
        if (broken.rewritten.length) note('改账', `第 ${t} 轮：${broken.rewritten.length} 件老事被改写（只增不改被破）例：${broken.rewritten.slice(0, 3)}`);
        if (broken.revived.length) note('复活', `第 ${t} 轮：${broken.revived.length} 件已闭环的事复活了 例：${broken.revived.slice(0, 3)}`);
        if (broken.vanished.length) note('消失', `第 ${t} 轮：${broken.vanished.length} 件事既不在热账也不在归档里 例：${broken.vanished.slice(0, 3)}`);
        if (broken.agendaVanished.length) note('盘算消失', `第 ${t} 轮：${broken.agendaVanished.length} 条盘算不见了 例：${broken.agendaVanished.slice(0, 3)}`);
        if (integ.cycles) note('成环', `第 ${t} 轮：来路里走出 ${integ.cycles} 个环`);
        if (integ.danglingParents) note('悬空来路', `第 ${t} 轮：${integ.danglingParents} 条来路指不着东西`);
        if (ups.danglingUp) note('悬空指针', `第 ${t} 轮：引擎自己的坏账扫描报 ${ups.danglingUp} 条悬空引用（含 links.up）`);
        if (ups.selfUp) note('自指多因', `第 ${t} 轮：links.up 里 ${ups.selfUp} 条指向自己`);
        if (row.pack?.overrun) note('越预算', `第 ${t} 轮：包越预算且未裁回来（budgetOverrun）`);
        // ★★leg130（面① 的三条判据）：顺序／地图还在不在／末道守卫的那两种形态
        if (row.pack?.trim && !row.pack.trim.合规) {
            note('裁剪序不对', `第 ${t} 轮：trimmed=${JSON.stringify(row.pack.trimmed)} `
                + `（顺序 ${row.pack.trim.顺序} · 无重段 ${row.pack.trim.无重段} · 兜底在末 ${row.pack.trim.兜底在末}`
                + ` · 认不出的段 ${JSON.stringify(row.pack.trim.认不出的段)}）`);
        }
        if (row.pack?.trimmed && !row.pack.故事线在 && (row.forest?.线 ?? 0) > 0) {
            note('地图被挤掉', `第 ${t} 轮：包被裁（${JSON.stringify(row.pack.trimmed)}），而"故事线"那一栏**不在包里**`
                + `（这一轮账上真有 ${row.forest.线} 条线）——总稿 §4.5 明说它该在最便宜那一档活下来`);
        }
        if (row.integrity.chronicleShrank) note('编年缩短', `第 ${t} 轮：编年少了 ${-row.account.chronicleAdded} 行（只长不缩被破）`);
        if (row.pack && row.pack.est > row.pack.budget) note('越预算(量)', `第 ${t} 轮：包 ${row.pack.est} est > 预算 ${row.pack.budget}`);
        if (!r.ok) note('本轮失败', r.error || '未知');
        if (r.healed?.used === true) note('自愈降级', `第 ${t} 轮：世界步被拒后走了自愈路径 ${row.healedDetail}`);
    } else {
        row.failKind = failKindOf(row.error);
        note('本轮失败', `第 ${t} 轮［${row.failKind}］：${row.error}`);
    }

    // ★照生产轮转：编年超阈值就剥一段入卷（剥的是账本冗余，链条不动）
    if (r?.ok) {
        const { hot, volume } = rotateChronicle(world, { limits: { ticks: ROTATE_SPAN, bytes: Infinity }, volumeSeq: volumes.length + 1 });
        if (volume) { volumes.push(volume); world = hot; row.account.volumes = volumes.length; }
        prevSnap.current = accountSnapshot(world);
    }
    rows.push(row);
    appendFileSync(LOG, `${JSON.stringify(row)}\n`, 'utf8');

    const st = row.pack?.counts ?? {};
    line(`${String(t).padStart(3)} 轮 [tick ${tickBefore}→${world.meta?.tick ?? '?'}] ${row.ok ? '✓' : '✗'} ${String(row.wallMs).padStart(6)}ms`
        + ` (引擎 ${String(row.engineMs).padStart(5)}ms)`
        + ` · 包 ${String(row.pack?.est ?? '—').padStart(5)} est (${num(row.pack?.pct, 1)}%)`
        + ` · 新事 ${row.account?.newEvents ?? '—'} · 新线 ${row.account?.newAgendas ?? '—'}`
        + ` · 故事线 ${st.故事线 ?? '—'}${row.pack?.multiCauseMarks ? `(合流${row.pack.multiCauseMarks})` : ''}`
        + ` · 点名 ${row.namedLines ?? '—'} ⇒ 收到 ${row.lineDetailGiven ?? '—'}`
        + ` · 提议 ${row.observatory?.rejection?.proposals ?? '—'}/拒 ${row.observatory?.rejection?.rejected ?? '—'}`
        + ` · 警告 ${row.warnings}${row.healed ? ' · 自愈' : ''}`);
    if (row.pack?.trimmed) {
        line(`      裁过：${JSON.stringify(row.pack.trimmed)}`
            + `　段数 ${row.pack.trim?.段.length ?? 0}/${TRIM_ORDER.length}`
            + `　序${row.pack.trim?.合规 ? '✔合规' : '✗不合规'}`
            + `　地图${row.pack.故事线在 ? '在' : '★不在'}`
            + `${row.pack.estBeforeTrim ? `　裁前 ${row.pack.estBeforeTrim} est` : ''}`);
    }
    if (row.dialogue) {
        const d = row.dialogue;
        line(`      正文：${d.读数行 || '（读数行为空）'}`
            + `　落账 ${d.落账事件} 件（丢 ${d.落账丢} 封顶 ${d.落账封顶}）· 落格 ${d.落格}`
            + `　时长印记 ${d.本轮盖了时长印记}/${d.本轮新编年} 行`
            + `${d.注入行 ? `　注入「${d.注入行.slice(0, 40)}…」` : '　★注入行为空'}`);
    }
    if (row.account?.newEventSamples?.length) {        for (const e of row.account.newEventSamples) line(`      + ${e.id}「${String(e.title).slice(0, 40)}」源 ${e.st}${e.sr ? `→${e.sr}` : ''}`);
    }
    for (const a of row.account?.newAgendaSamples || []) line(`      + 新线 ${a.st}${a.sr ? `→${a.sr}` : ''}「${a.goal}」`);
    if (!row.ok) line(`      ✗ ${String(row.error).slice(0, 400)}`);
}

// ───────────────────────── 5. 收尾读数 ─────────────────────────
const runMs = Date.now() - tRun0;
const done = rows.length;
const okRows = rows.filter((x) => x.ok);
const last = rows[rows.length - 1];

const sum = (f) => rows.reduce((n, x) => n + (Number(f(x)) || 0), 0);
const summary = {
    跑了几轮: done, 成功轮: okRows.length, 失败轮: done - okRows.length,
    总用时秒: Number((runMs / 1000).toFixed(1)),
    平均每轮秒: done ? Number((runMs / 1000 / done).toFixed(2)) : null,
    主调用总秒: Number((mainCallMs / 1000).toFixed(1)),
    主调用占比: runMs ? Number((100 * mainCallMs / runMs).toFixed(1)) : null,
    主调用输出字符合计: mainCallChars,
    输出最大token估: Math.max(0, ...rows.map((x) => x.outTokEst || 0)),
    包est末轮: last?.pack?.est ?? null, 包est峰: Math.max(0, ...rows.map((x) => x.pack?.est || 0)),
    包占比峰: Math.max(0, ...rows.map((x) => x.pack?.pct || 0)),
    裁过的轮数: rows.filter((x) => x.pack?.trimmed).length,
    越预算轮数: rows.filter((x) => x.pack?.overrun).length,
    // ★★leg130（面①：裁剪序）——**这一排就是"压到哪算数"那张单子**（交接 §6 ①）：
    //   `trimmed` 非空 ≥ N 轮 · 七段里至少真触发 4 段 · 无 budgetOverrun · 单轮耗时 < 200ms。
    '裁过的轮占比': done ? Number((100 * rows.filter((x) => x.pack?.trimmed).length / done).toFixed(1)) : null,
    '触发过的段': (() => {
        const seen = new Set();
        for (const x of rows) for (const s of x.pack?.trim?.段 || []) seen.add(s);
        return [...seen];
    })(),
    '触发段数': (() => {
        const seen = new Set();
        for (const x of rows) for (const s of x.pack?.trim?.段 || []) seen.add(s);
        return seen.size;
    })(),
    '裁剪序不合规轮数': rows.filter((x) => x.pack?.trim && !x.pack.trim.合规).length,
    '地图被挤掉轮数': rows.filter((x) => x.pack?.trimmed && !x.pack.故事线在).length,
    '往事留痕样本': [...new Set(rows.map((x) => x.pack?.trim?.往事留痕).filter(Boolean))].slice(0, 4),
    // ★引擎侧单轮耗时（面① 那条性能病量的就是它；`--fake` 那一跑是干净读数）。
    //   ★只算**成功轮**：报废轮没有主调用读数，`engineMs` 会退化成"整轮墙钟"（实测把超时等待算成引擎慢了）。
    引擎侧单轮毫秒峰: Math.max(0, ...rows.filter((x) => x.ok).map((x) => x.engineMs || 0)),
    引擎侧单轮毫秒均: okRows.length ? Number((okRows.reduce((n, x) => n + (x.engineMs || 0), 0) / okRows.length).toFixed(1)) : null,
    查书前置步耗时合计秒: Number((lookupMsTotal / 1000).toFixed(1)),
    // ★★leg130（面④规模）：实体段占包比 · 待启用名单轮换公平性 · 关系边
    '实体段占包比(末轮)': last?.pack?.实体段占包比 ?? null,
    '实体段占包比峰': Math.max(0, ...rows.map((x) => x.pack?.实体段占包比 || 0)),
    班底人数: (world.entities || []).length,
    待启用池峰: Math.max(0, ...rows.map((x) => x.pack?.待启用池 || 0)),
    待启用名单轮换过的不同人: (() => {
        const s = new Set();
        for (const x of rows) for (const id of x.pack?.idleFacesIds || []) s.add(id);
        return s.size;
    })(),
    '关系边(末轮)': last?.pack?.counts?.relations ?? 0,
    // ★★leg130（面⑤卷）
    卷数: volumes.length,
    '卷里独有的轮次(末轮)': last?.pack?.卷里独有的轮次 ?? 0,
    '包里出现的卷里独有轮次(末轮)': last?.pack?.包里出现的卷里独有轮次 ?? 0,
    // ★★leg130（面⑥超时/多调用）
    超时轮数: rows.filter((x) => /超时/.test(String(x.error || ''))).length,
    calls记账: CALLS,
    设定超时秒: TIMEOUT_SEC,
    // ★★leg130（面②：正文那条路）——`row.dialogue` 为 `null` 的轮**不计入**（"没喂"与"喂了没收下"要分得开）
    正文喂了的轮数: rows.filter((x) => x.dialogue).length,
    'dialogue型事件合计': sum((x) => x.dialogue?.落账事件),
    落格合计: sum((x) => x.dialogue?.落格),
    解析行动合计: sum((x) => x.dialogue?.解析行数),
    归不上名字合计: sum((x) => x.dialogue?.归不上名字),
    注入行非空轮数: rows.filter((x) => x.dialogue?.注入行).length,
    时长印记盖到编年行合计: sum((x) => x.dialogue?.本轮盖了时长印记),
    自愈轮数: rows.filter((x) => x.healed).length,
    警告合计: sum((x) => x.warnings),
    空转轮: rows.filter((x) => x.quality?.emptyTick).length,
    标题重复次数: sum((x) => x.quality?.dupTitles),
    '多因点(末轮)': last?.pack?.multiCauseMarks ?? 0,
    // ★拒签是**引擎自己数的累计值**（窗 20）⇒ 只报末轮那个数，**不许跨轮相加**（相加就是自己造一个假数）
    末轮提议数: last?.observatory?.rejection?.proposals ?? null,
    末轮被拒数: last?.observatory?.rejection?.rejected ?? null,
    末轮拒签率: last?.observatory?.rejection?.rate ?? null,
    末轮悬空指针: last?.observatory?.dangling ?? null,
    模型点名合计: sum((x) => x.namedLines),
    线的经过递出合计: sum((x) => x.lineDetailGiven),
    发现数: findings.length,
    按类发现: findings.reduce((d, f) => { d[f.kind] = (d[f.kind] || 0) + 1; return d; }, {}),
    // ★失败归因与**白花的时间**：本台第一次真跑最刺眼的一条读数就在这两格
    失败归因: rows.filter((x) => !x.ok).reduce((d, x) => { const k = x.failKind || '未归类'; d[k] = (d[k] || 0) + 1; return d; }, {}),
    白花的时间占比: runMs ? Number((100 * rows.filter((x) => !x.ok).reduce((n, x) => n + (x.wallMs || 0), 0) / runMs).toFixed(1)) : null,
    最长连续报废轮: (() => { let best = 0, cur = 0; for (const x of rows) { cur = x.ok ? 0 : cur + 1; if (cur > best) best = cur; } return best; })(),
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify({ summary, findings, rows }, null, 2), 'utf8');
// ★把**终态世界**也存下来：读数是"过程"，世界是"结果"——事后要复核某条线/某棵树立不立得住，
//   得有这份原样账（本台第一版没存，第一趟真跑就只能事后靠猜）。
writeFileSync(`${OUT}/world.json`, JSON.stringify(world), 'utf8');

line('');
line('════════ 收尾读数 ════════');
for (const [k, v] of Object.entries(summary)) line(`  ${String(k).padEnd(20, ' ')} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
line('');
line(`★记账写在这里：${LOG}`);
line(`★汇总与逐轮明细：${OUT}/summary.json`);

if (findings.length) {
    line('');
    line(`★★★★ 长跑里报出来的病（${findings.length} 条，按类归拢）★`);
    const byKind = new Map();
    for (const f of findings) { if (!byKind.has(f.kind)) byKind.set(f.kind, []); byKind.get(f.kind).push(f); }
    for (const [kind, list] of byKind) {
        line(`  【${kind}】${list.length} 次`);
        for (const f of list.slice(0, 3)) line(`     第 ${f.tick} 轮：${f.detail}`);
        if (list.length > 3) line(`     …还有 ${list.length - 3} 次（见 summary.json）`);
    }
} else {
    line('');
    line('★长跑里**一条不变量都没被破**（findings 为空）。★但这只说明"这一台没抓到"，不等于"没有病"：');
    line('  本台只看**引擎侧的不变量**与产出形状，**看不到"故事讲得好不好"**（那要人的眼睛）。');
}

// ───────────────────────── 5.5 ★★面① 的"压到哪算数"（交接 §6 ① 那张单子，逐条打勾） ─────────────────────────
// ★这一段是**判据的读数面**，不是判据本身（本台不住 `test/`）——它把"算不算压到了"当场算给人看。
{
    const trimmedRows = rows.filter((x) => x.pack?.trimmed);
    const segs = new Set();
    for (const x of rows) for (const s of x.pack?.trim?.段 || []) segs.add(s);
    const bad = rows.filter((x) => x.pack?.trim && !x.pack.trim.合规).length;
    // ★★★本台**第五次**栽在"读了个空"上，留档（前四次：读包壳 · 悬空自建一把尺 · 中文名对英文键 ·
    //   刻度/法则读错了地方）：这一格原先写成 `trimmed && !故事线在` ⇒ **世界还没长出线来的时候也报"被挤掉"**
    //   （实测：书世界头 3 轮账上一条线都没有，它照样报 3 轮"地图被挤掉"）。
    //   ⇒ 判据补上"**这一轮账上真有线**"这一格才算数（`row.forest.线` 就是 `linesOf(world).total`）。
    const mapLost = rows.filter((x) => x.pack?.trimmed && !x.pack.故事线在 && (x.forest?.线 ?? 0) > 0).length;
    // ★★★本台**第八次**栽在"读了个空"上：这一格原先对**所有**轮取峰，而**报废轮没有主调用时间**（`lastOut` 为 null）
    //   ⇒ `engineMs` 退化成"整轮墙钟"（实测：故意逼出的超时轮显示 **2009ms**，被当成"引擎慢了"）。
    //   ⇒ 只对**成功轮**取峰（引擎侧耗时只有在"这一轮真跑了引擎"时才有意义）。
    const enginePeak = Math.max(0, ...rows.filter((x) => x.ok).map((x) => x.engineMs || 0));
    // ★★★leg130：**把"无 budgetOverrun"这一格拆成两格**——原先那一格是**假绿**：
    //   它只看"有没有 budgetOverrun 这条痕"，而**包真越界的轮次才是要判的那件事**。
    //   实测（本台第一次压这一面就撞上）：90 轮里有 **4 轮**包真越了预算（3010/3003/3002/3018 > 3000），
    //   而 `trimmed` 里**一条 budgetOverrun 都没有** ⇒ 旧写法报"✔ 无越界"，那是**把"仪器没响"当成了"没病"**
    //   （本仓最贵的那个形状）。⇒ 现在按"**越界 ⇒ 必须有痕**"判。
    const overBudget = rows.filter((x) => x.pack && x.pack.est > x.pack.budget);
    const silentOver = overBudget.filter((x) => !x.pack.overrun);
    const briefKeptRows = rows.filter((x) => (x.pack?.纪事条数 ?? 0) > 0).length;
    const briefBroken = rows.filter((x) => x.pack && x.pack.纪事整条 === false);
    const checks = [
        ['裁剪真跑过（trimmed 非空 ≥ 1 轮）', trimmedRows.length >= 1, `${trimmedRows.length}/${done} 轮`],
        ['七段里至少真触发 4 段', segs.size >= 4, `${segs.size} 段：${[...segs].join(' · ') || '（一段都没触发）'}`],
        ['裁剪序合规（子序列、不重段、兜底在末）', bad === 0, `${bad} 轮不合规`],
        ['"故事线"（地图）在裁过的轮里活下来', mapLost === 0, `${mapLost} 轮被挤掉`],
        ['往事装回时"整条收整条丢"＋装的是最新那一端（§3.3 末行）', briefBroken.length === 0,
            `${briefKeptRows} 轮装回了往事，其中 ${briefBroken.length} 轮★不是整条/不是最新那一端`],
        ['★包越界必留痕（越界的轮都得有 budgetOverrun）', silentOver.length === 0,
            `${overBudget.length} 轮越界，其中 ${silentOver.length} 轮★静默越界`
            + (silentOver.length ? `（例：${silentOver.slice(0, 3).map((x) => `第${x.t}轮 ${x.pack.est}>${x.pack.budget}`).join(' · ')}）` : '')],
        ['单轮引擎耗时 < 200ms', enginePeak < 200, `峰 ${enginePeak}ms`],
    ];
    line('');
    line('════════ ★面①（包的裁剪序）压到哪算数 ════════');
    for (const [name, ok, detail] of checks) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(38, ' ')} ${detail}`);
    line(`  ★口径：本段只报读数；"算不算数"由人拍板（本台不是判据）。`);
}

// ───────────────────────── 5.6 ★★面② 的"压到哪算数"（交接 §6 ② 那张单子，逐条打勾） ─────────────────────────
{
    if (!DIALOGUE) {
        line('');
        line('════════ ★面②（正文那条路）压到哪算数 ════════');
        line('  —— **没压**（`--dialogue` 没设 ⇒ 正文是空串）★这不是"没问题"，是"未知"。');
    } else {
        const dRows = rows.filter((x) => x.dialogue);
        const evSum = dRows.reduce((n, x) => n + (x.dialogue.落账事件 || 0), 0);
        const updateSum = dRows.reduce((n, x) => n + (x.dialogue.落格 || 0), 0);
        const injRows = dRows.filter((x) => x.dialogue.注入行).length;
        const stampSum = dRows.reduce((n, x) => n + (x.dialogue.本轮盖了时长印记 || 0), 0);
        const readoutRows = dRows.filter((x) => x.dialogue.读数行).length;
        const checks = [
            ['`dialogue` 型事件 > 0（正文那些既成事实真进账了）', evSum > 0, `${evSum} 件`],
            ['`tagReadout` 非空（读数行真报出来了）', readoutRows > 0, `${readoutRows}/${dRows.length} 轮`],
            ['注入行非空（这一轮世界发生了什么，递回聊天上下文）', injRows > 0, `${injRows}/${dRows.length} 轮`],
            ['`elapsed`（时长）至少盖到一行编年', stampSum > 0, `${stampSum} 行`],
            ['【变化】真落格（四道机械校验全过 ⇒ 值落到了实体上）', updateSum > 0, `${updateSum} 格`],
            ['没喂正文的轮不掺进来（`null` ≠ 0）', dRows.length === done, `${dRows.length}/${done} 轮有这一格`],
        ];
        line('');
        line('════════ ★面②（正文那条路）压到哪算数 ════════');
        for (const [name, ok, detail] of checks) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(44, ' ')} ${detail}`);
        line('  ★口径：本段只报读数；"算不算数"由人拍板（本台不是判据）。');
    }
}

// ───────────────────────── 5.7 ★★面③ 的"压到哪算数"（交接 §6 ③ 那张单子，逐条打勾） ─────────────────────────
{
    line('');
    line('════════ ★面③（世界书那条路）压到哪算数 ════════');
    if (!BOOK) {
        line('  —— **没压**（`--book` 没给 ⇒ 这个世界里没有书）★这不是"没问题"，是"未知"。');
    } else {
        const scaleRows = rows.filter((x) => x.pack?.刻度在).length;
        const ruleRows = rows.filter((x) => x.pack?.法则在).length;
        const seedRootsEnd = last?.account?.seed型根 ?? 0;
        const subKeys = [...new Set(rows.flatMap((x) => x.pack?.setting子键 || []))];
        line(`  自证口径：包里 \`setting\` 的子键 = ${JSON.stringify(subKeys)}`
            + `（★刻度/法则住在它里面，**不在包顶层**——本台第一版就栽在这）`);
        const checks = [
            ['`刻度`（书里的尺子）进过包', scaleRows > 0, `${scaleRows}/${done} 轮`],
            ['`法则`（书里的判定原则）进过包', ruleRows > 0, `${ruleRows}/${done} 轮`],
            // ★"没要求起根"与"要求了没种下"必须分开——否则又是"没压到"冒充"没问题"
            [SEED_ROOTS_ON ? '`seed` 型根真出现（起根那一步落账了）' : '`seed` 型根（★本轮**没要求**起根：`--seed-roots` 没开）',
                SEED_ROOTS_ON ? seedRootsEnd > 0 : true,
                SEED_ROOTS_ON ? `末轮 ${seedRootsEnd} 条` : '未压'],
            ['书的原件没被块级预算切光（`dropped` 里没有刻度/法则）',
                !rows.some((x) => (x.pack?.刻度法则被块级切 || []).some((k) => k === '刻度' || k === '法则')),
                `${rows.filter((x) => x.pack?.刻度法则被块级切).length} 轮报过块级截断`],
        ];
        for (const [name, ok, detail] of checks) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(44, ' ')} ${detail}`);
    }
}

// ───────────────── 5.7b ★★面③ 的另一半：**查书写回**（与"有没有书"分开判——两件事） ─────────────────
{
    line('');
    line('════════ ★面③·另一半（查书写回）压到哪算数 ════════');
    if (!LOOKUP) {
        line('  —— **没压**（`--lookup` 没开）★这不是"没问题"，是"未知"。');
    } else {
        const lk = rows.filter((x) => x.lookup);
        const withStr = last?.lookup?.账上有实力的实体 ?? 0;
        line(`  每轮选中 ${[...new Set(lk.map((x) => x.lookup.选中几人))].join(' / ')} 人`
            + ` · 查出调用 ${lk.reduce((n, x) => n + (x.lookup.清零调用 || 0), 0)} 次`
            + ` · 位置继承 ${lk.reduce((n, x) => n + (x.lookup.位置继承 || 0), 0)} 条`
            + ` · 前置步耗时 ${Number((lookupMsTotal / 1000).toFixed(1))} 秒`);
        for (const [name, ok, detail] of [
            ['查书写回有读数（账上真出现了带 `实力` 的实体）', withStr > 0, `末轮 ${withStr} 个实体带实力`],
            ['写回的字段进了包（包里实体行带 `实力`）', (last?.lookup?.包里有实力的行 ?? 0) > 0,
                `末轮 ${last?.lookup?.包里有实力的行 ?? 0} 行`],
            ['前置步失败零阻塞（有警告也照常推进）', okRows.length > 0,
                `警告：${[...new Set(lk.map((x) => x.lookup.警告).filter(Boolean))].join(' / ') || '无'} · 成功轮 ${okRows.length}/${done}`],
        ]) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(44, ' ')} ${detail}`);
        line('  ★口径：本段只报读数；"算不算数"由人拍板（本台不是判据）。');
    }
}

// ───────────────────────── 5.8 ★★面④⑤⑥ 的"压到哪算数"（交接 §6 那三张单子） ─────────────────────────
{
    // ── 面④ 规模效应 ──
    const idleSeen = (() => {
        const s = new Set();
        for (const x of rows) for (const id of x.pack?.idleFacesIds || []) s.add(id);
        return s.size;
    })();
    const poolPeak = Math.max(0, ...rows.map((x) => x.pack?.待启用池 || 0));
    line('');
    line('════════ ★面④（规模效应）压到哪算数 ════════');
    line(`  班底 ${(world.entities || []).length} 人（\`--roster=${ROSTER}\`）· 驻点 ${(world.context?.positions || []).length} 个`);
    for (const [name, ok, detail] of [
        ['实体段占包比读数出来了', rows.some((x) => x.pack?.实体段占包比 != null),
            `末轮 ${last?.pack?.实体段占包比 ?? '—'}% · 峰 ${Math.max(0, ...rows.map((x) => x.pack?.实体段占包比 || 0))}%`],
        ['待启用名单转过 ≥ 一轮完整轮换', poolPeak > 0 && idleSeen >= poolPeak, `轮换到过 ${idleSeen} 人 / 池峰 ${poolPeak} 人`],
        ['关系边读数出来（合成世界自然不产关系，0 也算读数）', true, `${last?.pack?.counts?.relations ?? 0} 条`],
    ]) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(40, ' ')} ${detail}`);
    line('  ★口径：单轮耗时就报在上面那三格（引擎侧峰/均），要"随规模怎么走"就得**两支不同 `--roster` 对跑**。');

    // ── 面⑤ 卷 ──
    line('');
    line('════════ ★面⑤（卷）压到哪算数 ════════');
    line(`  编年轮转阈值 ${ROTATE_SPAN} 轮（本台自定，非生产 500）`);
    for (const [name, ok, detail] of [
        ['卷 > 0（真剥出过卷）', volumes.length > 0, `${volumes.length} 卷`],
        ['包里仍能看见卷里的旧往事（`ledgerVolumes` 递回去真的有用）',
            (last?.pack?.卷里独有的轮次 ?? 0) > 0 && (last?.pack?.包里出现的卷里独有轮次 ?? 0) > 0,
            `末轮 只在卷里的轮次 ${last?.pack?.卷里独有的轮次 ?? 0} 个，`
            + `其中出现在包里 ${last?.pack?.包里出现的卷里独有轮次 ?? 0} 个`],
    ]) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(44, ' ')} ${detail}`);
    if (!volumes.length) line('  ★没剥出卷 ⇒ 下面那条"看不见"**不算数**（"没压到"不是"没问题"）。');

    // ── 面⑥ 超时 ──
    line('');
    line('════════ ★面⑥（超时）压到哪算数 ════════');
    if (TIMEOUT_SEC == null) {
        line('  —— **没压**（`--timeout` 没设）★这不是"没问题"，是"未知"。');
    } else {
        const timeouts = rows.filter((x) => /超时/.test(String(x.error || '')));
        for (const [name, ok, detail] of [
            ['超时至少逼出 1 次并如实留痕', timeouts.length > 0, `${timeouts.length} 轮`],
            ['超时被归到"止损·不重试"那一类（不是"可重试的瞬时错"）',
                timeouts.length === 0 || timeouts.every((x) => x.failKind === '模型超时（止损·不重试）'),
                [...new Set(timeouts.map((x) => x.failKind))].join(' / ') || '—'],
            ['超时那一轮不拖垮后面（tick 照常往前走）',
                timeouts.length === 0 || rows.some((x) => x.t > timeouts[0].t && x.ok), '看上面逐轮行'],
        ]) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(46, ' ')} ${detail}`);
    }

    // ── 面⑦ 面板：agent 先做的只有渲染探针（要用户的眼睛才算数） ──
    line('');
    line('════════ ★面⑦（面板那一层）════════');
    line('  —— **没压**：那一格要用户的眼睛（agent 只能先跑 `demo/` 里那几个渲染探针）。');
}

// ───────────────── 5.9 ★★面⑦（面板）的"不需要眼睛那一半" ─────────────────
// 拿**终态世界**调**生产那一个渲染入口**（`renderAll`，面板用的就是它），机械扫产物里
//   "肉眼不用看就能判死"的病：漏进 `undefined`/`NaN`/`[object Object]`（占了位却什么都没画出来）
//   与"玩家可见文本里混进引擎术语"（A-3）。
// ★它**判不了"好不好看、看不看得清"**——那一半要人的眼睛（§6 ⑦ 自己写着"agent 替不了"）。
{
    line('');
    line('════════ ★面⑦（面板 · 不需要眼睛那一半）════════');
    try {
        const rendered = renderAll(world, { config: {}, oldVolumes: [] });
        const html = typeof rendered === 'string'
            ? rendered : Object.values(rendered).map((v) => (typeof v === 'string' ? v : '')).join('\n');
        const count = (re) => [...html.matchAll(re)].length;
        const visible = html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
        const jargon = ['tick', 'entity', 'agenda', 'ssot', 'schema', 'pack', 'overrun', 'trimmed']
            .filter((w) => new RegExp(`(^|[^a-zA-Z])${w}([^a-zA-Z]|$)`, 'i').test(visible));
        const checks = [
            ['版面里没有 `undefined`（占了位却没画出来）', count(/undefined/g) === 0, `${count(/undefined/g)} 处`],
            ['版面里没有 `NaN`', count(/\bNaN\b/g) === 0, `${count(/\bNaN\b/g)} 处`],
            ['版面里没有 `[object Object]`', count(/\[object Object\]/g) === 0, `${count(/\[object Object\]/g)} 处`],
            ['可见文字里没有引擎术语（A-3）', jargon.length === 0, jargon.join('、') || '无'],
        ];
        line(`  渲染入口 renderAll · 产物 ${html.length} 字符 · 世界 ${(world.entities || []).length} 实体 / ${(world.chronicle || []).length} 编年`);
        for (const [name, ok, detail] of checks) line(`  ${ok ? '✔' : '✗'} ${name.padEnd(40, ' ')} ${detail}`);
        line('  ★这一格**判不了**"好不好看/看不看得清"（无 CSS、无布局、无交互）——那一半要用户看图。');
    } catch (e) {
        line(`  ✗ 渲染扫不了：${String(e?.message || e).slice(0, 120)}`);
    }
}

// ───────────────────────── 6. 本台自己的短板（如实登记） ─────────────────────────
line('');
line('★本台的短板（读上面那些数之前先读这一段）：');
line('  ① **世界是合成的**（默认 8 人 4 驻点；`--roster` 可扩到 n 人 10+ 驻点）'
    + '⇒ 大班底才暴露的病，只有拧了那个旋钮的那一跑才看得见；');
line('  ② **正文默认为空**（dialogue 传空串）⇒ 不拧 `--dialogue`，标签那条路／聊天侧落账那一格**全程零负载**；');
line('  ③ **没有世界书**（不抽书）⇒ 不喂书，刻度/法则那两栏、查书写回、`seed` 型根**全程零负载**；');
line('  ④ **编年轮转阈值默认自定的 200 轮**（生产 500）⇒ 卷数不能当生产读数用；');
line('  ⑤ **默认一轮一次主调用**（calls=1）⇒ 多调用那条路要 `--calls` 才压得到；');
line('  ⑥ ★它**不是判据**（不住 `test/`、不进 `node --test`）⇒ 它报的病要另立判据才算"锁住"。');

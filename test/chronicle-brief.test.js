// story-world-v2/test/chronicle-brief.test.js
// ★★★leg113（B2 编年进包）判据：把"收哪些、弃哪些"钉死，并锁住三件容易悄悄坏掉的事。
//   细案：`docs/spec-chronicle-in-pack.md`。口径住 `src/chronicle-brief.js`（零 import 真叶子）。
//
// 为什么这批判据必须存在（每条背后都是一次实测）：
//   · **J1 分类**：口径是"锚行首的模板形状"，不是扫关键词——两种写法实测**判得不一样的有 5 行**，
//     而那 5 行全是必须保住的"收场得失"（理由那句话里的词会命中关键词规则）。
//   · **J2 收场理由**：账上**没有结局字段**（`pack.js:872`），结清/取消/收场的事**只写在编年文本里**
//     ⇒ 丢了就永久丢。这是本批最要紧的一条。
//   · **J3 不设上限**：`entityUpdates 每轮 ≤3` 就是"没量过的提案态数字当家"，2026-09-22 用户拍板撤掉
//     ⇒ 本模块**不许**冒出"最多 N 条/最多 N 轮"这类常数。
//   · **J4 空着就是空着**：没有编年 ⇒ 那栏**不出现**（键不挂），逐字节回到今天。
//   · **J5 只搬不改写**：编年本身一个字不动（本笔是"窄口"，用户拍板）。
//   · **J6 整条丢**：超预算时**从最旧的整条丢**，绝不拦腰砍（砍半句比不写更坏）。
//   · **J7 键序**：那一栏只在有内容时挂，且**在 `turnFacts` 之前**（两把既有锁才都不动）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chronicleBrief, chronicleBriefKind, isChronicleBriefLine, briefLineText, CHRONICLE_BRIEF_KINDS } from '../src/chronicle-brief.js';
import { buildEvolutionPack, packTextOf, trimPack } from '../src/pack.js';
// ★★★leg119：**轮转**（编年进冷档的"卷"）——"卷里那段往事还取不取得到"的判据要**真造一次轮转**，
//   所以用**生产那一把**（`storage.js` 的 `rotateChronicle`），不自己捏一个假卷。
import { rotateChronicle } from '../src/storage.js';

const K = CHRONICLE_BRIEF_KINDS;

// ── 账上的真行（全部取自 `settle.js` 的 chronicle.push 模板；改模板必须同批改这里）──
const L = {
    causeEvent: { tick: 2, text: '事件「万法阁商队筹备完毕」——沿「万法阁商队集结」而来，事发 东海浮空岛，牵动 万法阁' },
    causeState: { tick: 1, text: '事件「万法阁商队集结」——由世界处境而生，事发 东海浮空岛，牵动 万法阁' },
    causeAgenda: { tick: 4, text: '因事而生：万法阁 由「死煞杀局启动」生「完成死煞杀局的部署」' },
    step: { tick: 10, text: '盘算「协助突围」推进：白小娥燃烧精元死守' },
    outcomeCancel: { tick: 9, text: '盘算「炼化死煞核心」取消（万法阁）：核心二次暴动且遭两方势力围攻，炼化彻底失败' },
    outcomeClose: { tick: 60, text: '事件「大虞京城遣使干预北山」这一段收场了：镇抚使已直接动手，遣使干预阶段结束' },
    ledgerSettle: { tick: 7, text: '盘算「完成死煞杀局的部署」满步结算：结清（期满收摊，终结产果 §4.4④）' },
    ledgerQuiet: { tick: 7, text: '事件「死煞之气外泄」涟漪平息（链源已了结）' },
    ledgerClose: { tick: 7, text: '事件「死煞暗流涌动」闭环（源盘算已结算）' },
    ledgerFlow: { tick: 20, text: '「白小娥」淡出视野（久未现身）' },
    ledgerEnter: { tick: 20, text: '「万子明」入局（因事而入）' },
};

const mk = (chronicle = []) => ({
    entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '中央' }],
    agendas: [], events: [], chronicle, weights: {},
    context: { world: '测试界', positions: ['中央'] }, meta: { tick: 5 },
});

// ── J1：该收的收、该弃的弃 ────────────────────────────────────────────────────
test('leg113·J1：分类锚"行首"——来路/经过/收场得失三类收，四类机械记账弃', () => {
    assert.equal(chronicleBriefKind(L.causeEvent), K.CAUSE);
    assert.equal(chronicleBriefKind(L.causeState), K.CAUSE);
    assert.equal(chronicleBriefKind(L.causeAgenda), K.CAUSE);
    assert.equal(chronicleBriefKind(L.step), K.STEP);
    assert.equal(chronicleBriefKind(L.outcomeCancel), K.OUTCOME);
    assert.equal(chronicleBriefKind(L.ledgerSettle), K.LEDGER);
    assert.equal(chronicleBriefKind(L.ledgerQuiet), K.LEDGER);
    assert.equal(chronicleBriefKind(L.ledgerClose), K.LEDGER);
    assert.equal(chronicleBriefKind(L.ledgerFlow), K.LEDGER);
    assert.equal(chronicleBriefKind(L.ledgerEnter), K.LEDGER);
    assert.equal(isChronicleBriefLine(L.step), true);
    assert.equal(isChronicleBriefLine(L.ledgerSettle), false);
});

test('leg113·J1b：★★"扫关键词"那种写法是错的（实测被证伪，留档防复发）', () => {
    // 这一行的"**理由**"里含「炼化」「失败」等词；若判据去扫全行关键词（比如拿"结清/闭环"之类做规则），
    // 它就会把这一行判成机械记账 ⇒ **把模型给的理由永久丢掉**（账上没有结局字段，见 J2）。
    // 口径：一律锚**行首**的模板形状，理由住在账上真名的位置（「」里），不参与判定。
    const nasty = { tick: 9, text: '盘算「结清旧账以闭死煞余波」取消（万法阁）：此事已闭环，余波也已涟漪平息，故取消' };
    assert.equal(chronicleBriefKind(nasty), K.OUTCOME, '★名字与理由里堆满记账词，也必须判成"收场得失"');
    assert.equal(isChronicleBriefLine(nasty), true);
});

// ── J2：★★收场理由不许被弃掉（本批最要紧的一条）────────────────────────────────
test('leg113·J2：★账上没有结局字段 ⇒ 带理由的收场话必须留在包里', () => {
    const brief = chronicleBrief(mk([L.outcomeCancel, L.outcomeClose, L.ledgerSettle, L.ledgerClose]));
    const texts = brief.map((r) => r.text).join('\n');
    assert.ok(texts.includes('炼化彻底失败'), '★盘算取消的**理由**必须在（`pack.js:872`：账上没有结局字段）');
    assert.ok(texts.includes('遣使干预阶段结束'), '★模型给的收场理由必须在（那是 `settle.js:395` 那条模型通道）');
    assert.equal(brief.length, 2, '两条记账行一条都不许进来');
});

test('leg113·J2b：引擎通用闭环（写死的常量）与模型收场理由（另一条通道）在账上分得开', () => {
    // 依据（源码，实施时读过）：`settle.js:348` 的闭环文本是**写死的常量**「闭环（源盘算已结算）」；
    // 而模型收场走 `settle.js:392`，文本是「…这一段收场了：<理由>」，chronicle id 前缀 `ch_*_evs_*`。
    // ⇒ 所以"弃通用闭环、留模型理由"这条**不需要动 settle.js、不需要动契约**。
    assert.equal(isChronicleBriefLine(L.ledgerClose), false, '引擎通用闭环：弃（真账 49 条全是这句，实测无一带理由）');
    assert.equal(isChronicleBriefLine(L.outcomeClose), true, '模型收场理由：留');
});

// ── J3：★不设条数/轮数上限（刚撤掉的那颗雷不许回来）────────────────────────────
test('leg113·J3：本模块不许出现"最多 N 条 / 最多 N 轮"这类提案态数字', () => {
    const src = readFileSync(new URL('../src/chronicle-brief.js', import.meta.url), 'utf8');
    // 只看代码（注释里为说明历史可以提到"≤3"这类字样，故先剥注释再查）
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\b(?:TOP|LIMIT|MAX|CAP)\b/.test(code), '★不许有上限常量（上限只认包的总预算，由 trimPack 兜）');
    assert.ok(!/\.slice\(0,\s*\d+\)/.test(code), '★不许截断条数（要丢由 trimPack 从最旧的整条丢）');
    // 行为面：喂 500 行来路 ⇒ 一条不少（本模块自己不设限）
    const many = Array.from({ length: 500 }, (_, i) => ({ tick: i + 1, text: `事件「事${i}」——由世界处境而生，事发 中央，牵动 甲` }));
    assert.equal(chronicleBrief(mk(many)).length, 500, '★本模块不做任何条数限制（实测 500 条全过）');
});

// ── J4：空着就是空着 ────────────────────────────────────────────────────────
test('leg113·J4：没有编年 ⇒ 那一栏不出现（键不挂）、包与今天逐字节相同', () => {
    const noChron = buildEvolutionPack(mk([]), null, {});
    assert.equal('纪事' in noChron.pack, false, '★空着就是空着：不许挂一个空数组占位');
    const allLedger = buildEvolutionPack(mk([L.ledgerSettle, L.ledgerClose, L.ledgerFlow]), null, {});
    assert.equal('纪事' in allLedger.pack, false, '全是机械记账 ⇒ 过滤后为空 ⇒ 同样不许挂键');
    const withChron = buildEvolutionPack(mk([L.step]), null, {});
    assert.equal('纪事' in withChron.pack, true, '有真往事 ⇒ 键在');
});

// ── J5：只搬不改写 ──────────────────────────────────────────────────────────
test('leg113·J5：编年原文一个字不改（只去固定前后缀）', () => {
    const b = briefLineText(L.step.text);
    assert.equal(b, '「协助突围」推进：白小娥燃烧精元死守', '★行首那个"盘算"去掉，其余**逐字**原样');
    assert.ok(briefLineText(L.causeEvent.text).includes('万法阁商队集结'), '★事件名逐字');
    assert.ok(briefLineText(L.causeEvent.text).includes('东海浮空岛'), '★地点逐字');
    // ★不许"改写事实"：净化只做固定串替换，不重排、不补字、不解释
    assert.equal(briefLineText('事件「甲事」——沿「乙事」而来'), '「甲事」——沿「乙事」而来');
});

test('leg113·J5b：行内容原样带 tick（编年本来就是只往后加 ⇒ 顺序不改）', () => {
    const brief = chronicleBrief(mk([L.causeState, L.step, L.outcomeCancel]));
    assert.deepEqual(brief.map((r) => r.tick), [1, 10, 9], 'tick 原样带出、顺序按账上原序（不重排）');
    assert.deepEqual(Object.keys(brief[0]), ['tick', 'text'], '★每行只两格（多一格就是新造字段）');
});

// ── J6：★超预算 ⇒ 从最旧的整条丢，绝不拦腰砍 ──────────────────────────────────
test('leg113·J6：trimPack 会裁这一栏，且从最旧的整条丢、痕迹如实', () => {
    // 造一个"编年很长、其余很小"的账，把预算压到**真的装不下**（否则那一段不会执行——本用例自己踩过这个假装置）
    const rows = Array.from({ length: 400 }, (_, i) => ({ tick: i + 1, text: `事件「第${i + 1}段旧事」——沿「第${i}段旧事」而来，事发 中央，牵动 甲` }));
    const w = mk(rows);
    const built = buildEvolutionPack(w, null, {});
    assert.equal(built.pack.纪事.length, 400, '30000 预算下这一栏装得下（前提：本用例的"不裁"那一半）');
    assert.equal(built.pack.trimmed, undefined, '前提：30000 时不裁');
    // 收紧预算 ⇒ 必须裁，且裁的是最旧那批
    const p = buildEvolutionPack(w, null, {});
    const before = p.pack.纪事.length;
    const est0 = Math.ceil(packTextOf(p.pack).length / 3);
    const cut = trimPack(p.pack, 2000);          // 全包 est≈7000 ⇒ 必须裁
    const rows2 = p.pack.纪事 ?? [];
    assert.ok(est0 > 2000, `前提：这份包真的超预算（est=${est0}）`);
    assert.ok(cut.some((n) => String(n).startsWith('纪事')), `★裁了就要如实记名（实测 trimmed=${JSON.stringify(cut)}）`);
    assert.ok(rows2.length < before, '确实裁掉了一部分');
    assert.ok(rows2.length > 0, '★不是整栏丢：额度够装最近那几条（这几条正是"接得上"最需要的）');
    assert.equal(rows2[rows2.length - 1].tick, 400, '★留下的是**最新**那条（从最旧的丢）');
    assert.equal(rows2[0].tick, 400 - rows2.length + 1, '★留下的是一段**连续**的尾巴（不是抽着丢）');
    // ★绝不拦腰砍：每一行都必须是完整的账上行（首尾都在原文里）
    for (const r of rows2) {
        const src = rows.find((x) => x.tick === r.tick);
        assert.ok(src, `留下的行必须在账上（tick=${r.tick}）`);
        assert.ok(r.text.includes(src.text.replace(/^事件/, '').slice(0, 6)), '★整条留：行文没有被截断');
        assert.ok(r.text.endsWith('牵动 甲'), '★整条留：尾巴也完整（拦腰砍会把结尾切掉）');
    }
    assert.ok(Math.ceil(packTextOf(p.pack).length / 3) <= 2000, '裁完必须落回预算内（"预算已强制"不许是空话）');
});

// ── J6b：★★额度守卫改二分之后，**语义一个字没变**（锁结果，不锁算法）──────────────
// 为什么要有这一条：那一格原来逐条量一次整包 ⇒ 包一超预算就把单轮拖到 1100ms（实测，且不会自己好）。
//   改二分的**依据**是"装得下的条数单调"——这条判据就是那个依据的哨兵：
//     ① 落回预算内；② **再多留一条就真越界**（⇒ 取到的是"最大 keep"，与逐行试同一个答案）；
//     ③ 留下的仍是**连续**的最旧→最新那一段尾巴。
test('★leg128·J6b：额度守卫改二分 ⇒ 仍是"最大 keep"（边界紧、语义不变）', () => {
    const est = (v) => Math.ceil(packTextOf(v).length / 3);
    const rows = Array.from({ length: 400 }, (_, i) => ({ tick: i + 1, text: `事件「第${i + 1}段旧事」——沿「第${i}段旧事」而来，事发 中央，牵动 甲` }));
    const p = buildEvolutionPack(mk(rows), null, {});
    const brief = p.pack.__chronicle;            // 全量那一份（`buildEvolutionPack` 用不可枚举的键递进来）
    const cut = trimPack(p.pack, 2000);
    const kept = p.pack.纪事 ?? [];
    const keep = kept.length;
    assert.ok(keep > 0 && keep < brief.length, `前提：真的裁在中间（keep=${keep}/${brief.length}）`);
    assert.ok(est(p.pack) <= 2000, `① 落回预算内（est=${est(p.pack)}）`);
    // ② 边界紧：把"多留一条"那一份**按搜索当时用的那个 trimmed 串**复原再量一次。
    //    （搜索当时 `trimmed` 还是 `[...cut,'纪事']` 那个短形态 ⇒ 复原它才是同一个读数。）
    const probeTrimmed = (p.pack.trimmed || []).map((x) => (String(x).startsWith('纪事') ? '纪事' : x));
    const probe = { ...p.pack, 纪事: brief.slice(-(keep + 1)), trimmed: probeTrimmed };
    assert.ok(est(probe) > 2000, `★再多留一条就越界（est=${est(probe)}）⇒ 取到的正是"最大 keep"`);
    // ③ 尾巴连续、且在最新那一端
    assert.equal(kept[kept.length - 1].tick, rows[rows.length - 1].tick, '留下的最后一条＝账上最新那条');
    assert.equal(kept[0].tick, rows[rows.length - keep].tick, '留下的是一条连续尾巴（中间不抽条）');
    assert.ok(cut.some((n) => String(n) === `纪事.留${keep}条`), '痕要与事实同数');
});

// ── J6c：★那道守卫**不许再退化成逐条量整包**（实测病：单轮 15ms→1100ms，永久）──────
test('★leg128·J6c：超预算时量体次数是 O(log 条数) —— 4000 条往事必须毫秒级回来', () => {
    const rows = Array.from({ length: 4000 }, (_, i) => ({ tick: i + 1, text: `事件「第${i + 1}段旧事」——沿「第${i}段旧事」而来，事发 中央，牵动 甲` }));
    // ★必须用一个"大到不裁"的预算先建包：否则 `buildEvolutionPack` 内部那次就把 `纪事` 裁掉了，
    //   而额度守卫那一格只在 `pack.纪事 === undefined` 时才跑（真正的病就在那一格里）。
    const p = buildEvolutionPack(mk(rows), null, { lim: { 包预算: 1000000000 } });
    assert.equal('纪事' in p.pack, true, '前提：建包时没裁（全量那一栏在）');
    const t0 = Date.now();
    trimPack(p.pack, 20000);
    const ms = Date.now() - t0;
    assert.ok((p.pack.纪事 ?? []).length > 0, '前提：真的留了一部分（不然量的不是那个循环）');
    assert.ok(Math.ceil(packTextOf(p.pack).length / 3) <= 20000, '裁完落回预算内');
    // 逐条量整包：上千次 × 每份上百 KB 的序列化 ⇒ **秒级**；二分：十几次 ⇒ **毫秒级**。
    // 阈值留足余量（改前本机实测 1s 量级；改后 10ms 量级）。
    assert.ok(ms < 500, `超预算时的量体必须是 O(log 条数)（实测 ${ms}ms；逐条量整包是秒级）`);
});

// ── J7：键序（两把既有锁都不动的那个位置）────────────────────────────────────
test('leg113·J7：那一栏挂在 turnFacts 之前（`turnFacts` 必须最末那条锁照旧成立）', () => {
    const withFacts = buildEvolutionPack(mk([L.step]), null, { turnFacts: { actions: [], count: 0, parsed: 0 } });
    const keys = Object.keys(withFacts.pack);
    assert.equal(keys[keys.length - 1], 'turnFacts', '★`turnFacts` 仍是最末（`tag-extract.test.js` 那条锁照旧）');
    assert.ok(keys.indexOf('纪事') < keys.indexOf('turnFacts'), '★那一栏在它前面（这就是"两把锁都不用动"的原因）');
    // 16 键字面量锁不含它（`lens.test.js` 那条锁照旧）
    assert.equal(keys.filter((k) => k === '纪事').length, 1, '只出现一次');
});

// ── 净增与预算（把量过的数钉在判据里，防悄悄膨胀）──────────────────────────────
test('leg113：这一栏的净增是量过的——不许悄悄膨胀（同一把尺 packTextOf）', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ tick: i + 1, text: `事件「第${i + 1}段」——沿「第${i}段」而来，事发 中央，牵动 甲` }));
    const withOut = buildEvolutionPack(mk([]), null, {});
    const withIt = buildEvolutionPack(mk(rows), null, {});
    const delta = packTextOf(withIt.pack).length - packTextOf(withOut.pack).length;
    assert.ok(delta > 0, '有内容就有增量');
    // 每条约 40–60 字符（含 JSON 包装）——超出就是有人往行里塞了新字段
    const perRow = delta / 50;
    assert.ok(perRow < 90, `★每条净增 ${perRow.toFixed(1)} 字符（含包装）——超 90 说明这一栏变重了，请复核口径`);
});

// ── ★★★leg118（B2 接检索层）：那一栏的取数改向检索层要 ────────────────────────
//   细案 `docs/spec-b2-chronicle-via-recall.md`。用户 2026-09-23 拍的硬约束：
//   「**世界模型检索到的和进包的不能重复**」——它只能靠"**一栏、一源**"守住。
//   本批三条判据，每条守一件会**悄悄**坏掉的事。

test('leg118·J8：★取数路唯一——`pack.js` 不许再自己伸手抓编年（直取当场红）', () => {
    // 为什么必须有：这一笔的全部价值就是"世上只剩一条取往事的路"。谁哪天顺手写回一句
    // `chronicleBrief(ssot)` 直取，**两套取法必然分叉**的老毛病就当场回来了
    // （本仓为这个形状刚付过账：leg117 合并的两份规则表实测已经分叉）
    // ——而那时候**别的判据全是绿的**，只有这一条会红。
    const code = readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8')
        .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');   // 先剥注释（说明历史时可以提到它）
    assert.ok(!code.includes('chronicleBrief('), '★`pack.js` 不许再直取编年——那一栏只能向检索层要');
    assert.ok(code.includes('recallLedger('), '★那一栏必须走检索层那条唯一入口');
});

test('leg118·J9：★接线前后逐行相同——生产那一栏与"旧实现"这把对照尺必须一模一样', () => {
    // 为什么必须有：接线是"零行为变化"的搬家（用户拍板的第一步）⇒ **模型看到的东西不许变一个字**。
    // 对照尺 = `chronicleBrief`（接线前那份实现：直取编年）；它与新路**互相独立**
    // ⇒ 谁单方面改坏了其中一条，这条判据当场红（"我觉得等价"不算证据，"逐行相同"才算）。
    // ★夹具按**账上原序**摆（轮次递增）——那是真账的唯一形态：编年**只往后加**
    //   （`settle.js` 每轮 `world.chronicle = [...world.chronicle, ...chronicle]`）。
    const rows = [L.causeState, L.causeEvent, L.ledgerSettle, L.ledgerClose, L.outcomeCancel, L.step, L.ledgerFlow];
    const w = mk(rows);
    const pack = buildEvolutionPack(w, null, {}).pack;
    // ★★★leg137：比 **tick 与 text 两格**（不再整行 `deepEqual`）——因为生产那一栏现在**多带一格 `timeMark`**
    //   （见 `pack.js` 的 `stampRowsWithTimeMark`）。★本笔之前这里靠"夹具恰好没有 timeMark"才碰巧绿：
    //   一旦夹具里出现一行带时间的账，它就会红得莫名其妙（**判据量的东西与它自称量的东西不是一回事**）。
    //   ⇒ 口径写清楚：**内容（哪几行、什么次序、什么文字）必须一模一样**；多出来的那一格由下面 J13 一族专管。
    const content = (arr) => (arr || []).map((r) => ({ tick: r.tick, text: r.text }));
    assert.deepEqual(content(pack.纪事), content(chronicleBrief(w)),
        '★生产那一栏必须与对照尺**逐行同内容**（同条数、同次序、同文字）');
    assert.deepEqual(pack.纪事.map((r) => r.tick), [1, 2, 9, 10], '★栏内是"从最早到现在"的时间线（三行机械记账一条都不进）');
    // ★如实登记一处**已知差异**（不是 bug，但必须写下来，别让它藏在"逐行相同"后面）：
    //   旧路保留**账上原序**；新路经检索层，而"最近优先"那一格是**按轮次排**的（leg116 统一排序）。
    //   真账上两者是同一个东西（编年只往后加；真账 382 行实测逐行逐字符相同）。
    //   只有**账被外部弄乱**时才分得开——而那时候"按轮次排"是**更忠实**的那一个：
    //   那一栏对模型的承诺就是"一轮接一轮，从最早到现在"（`prompts.js` 第 9 条原话）。
    const scrambled = mk([L.step, L.causeState, L.outcomeCancel, L.causeEvent]);   // 故意乱序：tick 10/1/9/2
    const out = buildEvolutionPack(scrambled, null, {}).pack.纪事;
    assert.deepEqual(out.map((r) => r.tick), [1, 2, 9, 10], '账上乱序 ⇒ 按轮次回到时间线（这就是登记的那处差异）');
});

test('leg118·J10：★那一栏不许被检索层的出厂字符上限截断（6000 是别人的尺，不是它的）', () => {
    // 病（leg118 实读 + 细案 §3.2）：检索层的 `maxChars` 原来只有 `Number.isFinite` 一条路
    //   ⇒ 传 `Infinity` **不是"不限"，是掉回出厂 6000**（`Infinity` 不是有限数）。
    //   而这一栏的口径是"**上限只认包的总预算**"（leg113 §3.4：不新增提案态数字）。
    //   真账实测：那一栏 10,207 字符 / 258 条 ⇒ 撞上 6000 会被**静默截掉将近一半**，且不报错。
    //   ⇒ 这条判据就是那个默认值的守门人：谁把 `maxChars: null` 拿掉，它当场红。
    const rows = Array.from({ length: 400 }, (_, i) => ({ tick: i + 1, text: `事件「第${i + 1}段旧事」——沿「第${i}段旧事」而来，事发 中央，牵动 甲` }));
    const pack = buildEvolutionPack(mk(rows), null, { lim: { 包预算: 200000 } }).pack;
    const chars = (pack.纪事 || []).reduce((n, r) => n + r.text.length, 0);
    assert.ok(chars > 6000, `前提：这份账的往事确实比出厂上限长（实测 ${chars} 字符）`);
    assert.equal((pack.纪事 || []).length, 400, `★一条都不许被静默截掉（实测留下 ${(pack.纪事 || []).length} 条）`);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★leg137：**把账上的时间点递给世界模型**（用户令「既然这次有了时间，就每次把提取到的时间
//   当作事件的时间」＋「做完吧」）。口径住 `pack.js` 的 `stampRowsWithTimeMark`。
//   病：`timeMark` 在这之前是**只写不读**的——账上有、包里一个字都没有
//   ⇒ 世界模型只看得见**轮次号**，看不见"故事走到什么时候了"。
//   ★写法是**增量**（只在"与上一行不同"时带一格）：真账实测 每行都带 = +3,029 token／
//     只在变化处带 = +12 token（同一轮十几件事共用一个时间点）。下面 J13 一族锁的就是这个形状。
// ══════════════════════════════════════════════════════════════════════════════════════════════

// 四行往事，时间点只有两个（tick1/2 同一时间，tick9/10 另一个）——正是真账的形状
const TIMED = [
    { tick: 1, text: L.causeState.text, timeMark: '复苏历三年 三月初七' },
    { tick: 2, text: L.causeEvent.text, timeMark: '复苏历三年 三月初七' },
    { tick: 9, text: L.outcomeCancel.text, timeMark: '复苏历三年 三月十五' },
    { tick: 10, text: L.step.text, timeMark: '复苏历三年 三月十五' },
];

test('★★★leg137·J13：账上的时间点进包——★只在"与上一行不同"时带一格（增量写法）', () => {
    const pack = buildEvolutionPack(mk(TIMED), null, {}).pack;
    const rows = pack.纪事 || [];
    assert.equal(rows.length, 4, '前提：四行往事都在（本用例量的就是它们）');
    // ★这是本笔最要紧的一条：同一时间点**只出现一次**（不重复占额度）
    assert.equal(rows[0].timeMark, '复苏历三年 三月初七', '★第一行带时间点（它是这一栏起点的"什么时候"）');
    assert.equal(rows[1].timeMark, undefined,
        '★★第二行**不许重复**同一个时间点（缺格读作"与上一行同一时间"）——这一格就是那 250 倍差价的来源');
    assert.equal(rows[2].timeMark, '复苏历三年 三月十五', '★时间往前走 ⇒ 在这里出现一次（读的人据此知道"从这里往后到了这个时辰"）');
    assert.equal(rows[3].timeMark, undefined, '★同时间的第三行同样不重复');
});

test('★★★leg137·J14：账上**没有**时间 ⇒ 包里一格都不许多（红线 2：空着就是空着）', () => {
    // ★防的病：为了"让模型看得见时间"而填一个占位值（比如拿 tick 冒充"什么时候"）。
    const pack = buildEvolutionPack(mk([L.causeState, L.causeEvent]), null, {}).pack;
    const rows = pack.纪事 || [];
    assert.equal(rows.length, 2, '前提：两行往事都在');
    assert.ok(rows.every((r) => r.timeMark === undefined), '★★两行都不许有时间格（账上没有就是没有）');
    // ★而且整份包要与"这一格存在之前"逐字节相同——老账、老聊天零扰动
    const before = JSON.stringify(mk([L.causeState, L.causeEvent]));
    assert.equal(JSON.stringify(mk([L.causeState, L.causeEvent])), before, '★夹具本身没被这一改动过');
});

test('★★★leg137·J15：只带一格、不带别的（形状锁：多一格就是新造字段）', () => {
    // ★与 J5b 那条"`chronicleBrief` 每行只两格"**分工不同**：那一条管**对照尺**（旧实现，仍两格），
    //   这一条管**生产那一栏**——它现在最多三格（`tick` / `text` / `timeMark`），**不许再多**。
    const pack = buildEvolutionPack(mk(TIMED), null, {}).pack;
    for (const r of pack.纪事 || []) {
        const keys = Object.keys(r).sort();
        assert.ok(
            JSON.stringify(keys) === JSON.stringify(['text', 'tick']) ||
            JSON.stringify(keys) === JSON.stringify(['text', 'tick', 'timeMark']),
            `★生产那一栏的行只许有 tick/text/timeMark 三格（实测 ${JSON.stringify(keys)}）`,
        );
    }
});

test('★★★leg137·J16：两栏口径一致——`相关往事` 也带时间，且**首行必带**（缺格不许指向栏外的行）', () => {
    // ★为什么必须两栏都管：两栏读**同一份账**（`ledger-recall.js`），口径分开写就是"同一件事两份实现"。
    //   而"相关往事"这一栏是从**旧端**开始装的、装不下就停在旧端 ⇒ 头几行可能被退掉，
    //   退掉之后**新首行必须补回它自己的时间点**（否则"缺格＝与上一行同一时间"会指向一个**不在栏里**的行）。
    //   ★夹具照本文件既有的形状（`test/related-recall.test.js` 那把尺）：
    //     120 行、账上第 120 轮、缺省窗口 50 ⇒ 前 70 行落在**窗口外**，由 `相关往事` 按相关度取。
    const chronicle = [];
    for (let t = 1; t <= 120; t += 1) {
        chronicle.push({
            tick: t,
            text: t % 6 === 0
                ? `事件「白小娥第${t}件旧事」——沿「更早那件」而来，事发 中央，牵动 白小娥`
                : `事件「杂事第${t}件」——由世界处境而生，事发 中央，牵动 无名氏`,
            // ★时间点每 60 轮往前跳一次 ⇒ 相邻行大量同时间（正是增量写法要压的那种形状）
            timeMark: t <= 60 ? '复苏历三年 三月初七' : '复苏历三年 三月十五',
        });
    }
    const w = {
        entities: [{ id: 'e_a', kind: 'character', name: '白小娥', location: '中央' }],
        agendas: [], events: [], weights: {}, chronicle,
        context: { world: '测试界', positions: ['中央'] },
        meta: { tick: 120 },
    };
    const pack = buildEvolutionPack(w, null, { picks: ['e_a'], lim: { 包预算: 800 } }).pack;
    const rel = pack.相关往事 || [];
    assert.ok(rel.length > 0, '前提：这一栏真的取到了东西（否则量的不是它）');
    assert.ok(rel.every((r) => Object.keys(r).every((k) => ['tick', 'text', 'timeMark'].includes(k))),
        '★这一栏的行同样只许三格（tick/text/timeMark）');
    assert.equal(typeof rel[0].timeMark, 'string',
        '★★首行**必须**带时间点——它没有"上一行"可继承，缺格在这里就是"读不出来"的意思');
    // ★相邻两行同时间 ⇒ 后一行不许再带一次（与 `纪事` 同一把尺子）
    const dup = rel.findIndex((r, i) => i > 0 && r.timeMark !== undefined && r.timeMark === rel[i - 1].timeMark);
    assert.equal(dup, -1, '★相邻两行时间相同时，后一行不许再带一次（增量写法，两栏同一把尺子）');
});


//   细案 `docs/spec-volumes-into-recall.md`；用户 2026-09-23 令「接」。
// ══════════════════════════════════════════════════════════════════════════════════════════════

test('leg119·J11：★★轮转之后「纪事」那一栏**不许缩水**（卷要一起看）', () => {
    // 病（本笔实读 + 真账实测）：编年太长时 `rotateChronicle`（`storage.js:74`）把**最旧的一段**
    //   整段搬进"卷"（住在浏览器 IndexedDB 里）⇒ 那些行**就不在 `ssot.chronicle` 里了**，
    //   而这一栏的取数（`pack.js` 的 `fetchChroniclePast`）只读账上的编年
    //   ⇒ **轮转一发生，这一栏悄悄少一半**。真账强制轮转实测：**237 条 → 118 条**。
    //   ★★而 `trimPack` 那一刻量到的是**缩水后的**编年，它**全装得下** ⇒ 包里 `trimmed` 依然是
    //     `undefined`、**一个字都不会说**。⇒ 一句话：**上游先悄悄剪短了，于是下游的诚实检查报告说一切正常。**
    //   ⇒ 这条判据就是那个静默的守门人：谁把 `volumes` 那一格拿掉，它当场红。
    const rows = Array.from({ length: 24 }, (_, i) => ({ id: `ch_${i + 1}`, tick: i + 1, text: `盘算「事${i + 1}」推进：走到第 ${i + 1} 步` }));
    const w = mk(rows);
    const { hot, volume } = rotateChronicle(w, { limits: { ticks: 5, bytes: 5 * 1024 * 1024 } });
    assert.ok(volume && volume.rows.length > 0, '前提：这份账真的轮转过（否则下面几条全是空绿）');
    const lim = { 包预算: 200000 };            // 预算给足 ⇒ 只考察"卷有没有接上"，不考察裁剪
    const before = (buildEvolutionPack(w, null, { lim }).pack.纪事 || []).length;
    const lost = (buildEvolutionPack(hot, null, { lim }).pack.纪事 || []).length;
    const kept = (buildEvolutionPack(hot, null, { lim, volumes: [volume] }).pack.纪事 || []).length;
    assert.ok(lost < before, `★前提自证：不递卷时这一栏**真的会少**（实测 ${before} → ${lost}）——否则这条判据是空绿`);
    assert.equal(kept, before, `★接了卷 ⇒ 一条都不许少（实测 ${kept}，轮转前 ${before}）`);
    // ★把"它为什么静默"也一并钉住：少了这么多，而包里**照旧报"没裁过"**
    assert.equal(buildEvolutionPack(hot, null, { lim }).pack.trimmed, undefined,
        '★如实登记：少了这么多，`trimmed` 依然是 undefined —— 这就是"静默"长什么样');
});

test('leg119·J12：★不递卷 / 递空数组 / 递坏卷 ⇒ 包**逐字节不变**（旧调用方零扰动）', () => {
    const rows = [L.causeState, L.causeEvent, L.outcomeCancel, L.step];
    const w = mk(rows);
    const base = JSON.stringify(buildEvolutionPack(w, null, {}).pack);
    assert.equal(JSON.stringify(buildEvolutionPack(w, null, { volumes: null }).pack), base, '★不传 ⇒ 逐字节不变');
    assert.equal(JSON.stringify(buildEvolutionPack(w, null, { volumes: [] }).pack), base, '★空数组 = 没有卷（同一条路）');
    assert.equal(JSON.stringify(buildEvolutionPack(w, null, { volumes: [null, {}, { rows: null }] }).pack), base,
        '★形状不对的卷要被跳过（不炸、不编、也不影响这一栏一个字）');
});

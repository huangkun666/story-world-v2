// story-world-v2/test/no-guess.test.js
// ★★★leg198：**"没有标签就拿词表猜玩家动作"这一族整族拆掉**。
//
// 用户 2026-10-05 令（逐字）：
//   「**这个词表按道理说早应该拆了，这是很久之前的设计了，早就不适用了，这个功能要猜，
//     没标签就不进正文的行动即可**」
//
// 拆之前那两个病（都能在源码里指到行）：
//   ① `src/extract.js` 的 13 条动词表是给"**玩家自己打的那句话**"设计的，而生产上喂进去的是
//      **模型写的整段正文**（`web/index.js` 取最后一条消息 → `runTick` 的 `dialogue`）
//      ⇒ 正文里随便谁"问道""离开"，都会被算成**玩家**这一轮的动作；
//   ② `src/tick.js` 那支 `lastFact` 回退更重：玩家这一轮没有标签时，它把
//      **别人最后一条行动**当成玩家的落子（`tagFacts.actions` 按 `src/tag-extract.js` 的口径
//      **只装非主角的行**）⇒ 世界模型会读到"玩家做了某件其实是他人的事"。
//
// 新口径一句话：**没有玩家标签 ⇒ 这一轮玩家没有落子**（不猜、不顶）。
//
// 本文件锁三件事：
//   ① **反向自证**：那一族的痕迹一个都不许留（模块、函数名、调用点、判据）；
//   ② **新口径**：无标签 ⇒ `move === null`，且递给世界模型的那一格也是空；
//   ③ **对照组**：玩家自己的标签在 ⇒ 落子照旧成立（这条改前改后都必须绿）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTick } from '../src/tick.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '`'.repeat(3);
/** 把几行标签包进 ```tags 块（照 `web/inject.js` 那份规范的形状）。 */
const fenced = (...lines) => [FENCE + 'tags', ...lines, FENCE].join('\n');

/** 最小世界：一个玩家棋子（黄坤）＋ 一个旁人（甲）。 */
const mkWorld = () => ({
    version: 1,
    context: { world: '测试', positions: ['未明', '临渊城'], playerId: 'e_p1' },
    entities: [
        { id: 'e_a', kind: 'character', name: '甲', location: '临渊城', status: 'active' },
        { id: 'e_p1', kind: 'character', name: '黄坤', location: '临渊城', status: 'active' },
    ],
    weights: { e_a: 0.5, e_p1: 0.5 },
    agendas: [], events: [], milestones: [], chronicle: [],
    meta: { tick: 3, simLog: [], warnings: [], entityFields: {} },
});
const STEP = {
    actions: [], newEvents: [{ title: '甲夺了渡口', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] }],
    agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
};
const run = (dialogue, extra = {}) => runTick({
    transport: async () => ({ text: JSON.stringify(STEP) }),
    ssot: mkWorld(), dialogue, recall: false, ...extra,
});

// ── ① 反向自证：那一族一个字节都不许留 ────────────────────────────────────────
test('leg198①：词表猜测那一族**整族不存在**（模块 / 函数名 / 调用点，全树扫）', () => {
    assert.equal(existsSync(path.join(ROOT, 'src', 'extract.js')), false,
        '★`src/extract.js`（13 条动词表那一族）必须已经删掉——它读的输入口径从根上就不成立');
    assert.equal(existsSync(path.join(ROOT, 'test', 'extract.test.js')), false,
        '★它那份黄金样本判据随模块一起撤（样本夹具本身留着，别的判据还在用它）');
    // ★注意：第 4 条只咬**模块路径**（`src/extract.js` / `./extract.js`）——不咬任何叫 `…extract.js`
    //   的别的文件（仓里有 `demo/diag-init-extract.js` 这种无关名字）。
    const banned = [/extractMove/, /VERB_TABLE/, /filterOOC/, /src\/extract\.js|'\.\/extract\.js'/];
    const trees = ['src', 'web', 'demo'];
    let scanned = 0;
    for (const dir of trees) {
        for (const f of readdirSync(path.join(ROOT, dir))) {
            if (!f.endsWith('.js')) continue;
            const text = readFileSync(path.join(ROOT, dir, f), 'utf8');
            scanned += 1;
            for (const re of banned) {
                assert.ok(!re.test(text), `★${dir}/${f} 里还留着「${re}」的痕迹——那一族必须整族拆掉`);
            }
        }
    }
    assert.ok(scanned > 100, `★扫描面太小（只读到 ${scanned} 个文件）⇒ 这条判据是空绿`);
    // 判据这一侧也要扫（防止哪份判据还在 import 那个模块）——**跳过本文件自己**（它必须点这些名字）
    for (const f of readdirSync(path.join(ROOT, 'test'))) {
        if (!f.endsWith('.js') || f === 'no-guess.test.js') continue;
        const text = readFileSync(path.join(ROOT, 'test', f), 'utf8');
        assert.ok(!/extractMove|src\/extract\.js/.test(text), `★test/${f} 还在用那个模块`);
    }
});

test('leg198②：`tick.js` 里那支 `lastFact` 回退也已拆（反向自证，逐行）', () => {
    const src = readFileSync(path.join(ROOT, 'src', 'tick.js'), 'utf8');
    assert.ok(!/lastFact/.test(src), '★"末条事实"那支回退必须拆掉：它把**别人的行动**顶到玩家头上');
    assert.ok(!/tagFacts\.actions\[tagFacts\.actions\.length - 1\]/.test(src), '★同上，换一种写法也不许回来');
});

// ── ② 新口径：没有标签就没有落子 ───────────────────────────────────────────────
test('leg198③：正文里没有标签 ⇒ 这一轮玩家**没有落子**（不许拿正文里的动词猜）', async () => {
    // 病：这句正文里"问道"命中词表 ⇒ 旧口径会把「询问」记成**玩家**的动作。
    const r = await run('甲问道："我们走吧，此地不宜久留。"');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move, null, '★没有标签 ⇒ 落子为空（"没标签就不进正文的行动"）');
    assert.equal(r.pack.pack.playerMove, null, '★递给世界模型的那一格也必须是空——不许猜一个动作塞进去');
    assert.ok(!String(r.streams?.injection || '').includes('你的行迹'),
        '★"你的行迹"那行不许出现（它一出现，玩家就以为自己的话被读成了动作）');
});

test('leg198④：只有别人的标签 ⇒ 玩家的落子仍是空（★不许把别人的行动顶到玩家头上）', async () => {
    // 病（源码可指）：玩家没有标签时，旧口径走 `lastFact` = `tagFacts.actions` 的**末条**，
    //   而那一栏按 `src/tag-extract.js` 的口径**只装非主角的行** ⇒ 别人的行动变成玩家的落子。
    const r = await run(fenced('【行动】甲｜沉吟'));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move, null, '★玩家没出手 ⇒ 落子为空');
    assert.equal(r.pack.pack.playerMove, null,
        '★递出去的那一格必须是空：拿"甲沉吟"冒充"玩家沉吟"，世界模型会照着演');
    // 对照组：甲那条行动**照旧入账**（拆的是回退，不是标签提取）
    assert.ok(r.dialogueStats.events >= 1, '★别人的行动照旧要记下来（只是不许记到玩家头上）');
});

// ── ③ 对照组：玩家自己的标签照旧成立 ──────────────────────────────────────────
test('leg198⑤（对照组）：玩家自己的标签在 ⇒ 落子照旧成立（改前改后都必须绿）', async () => {
    const r = await run(fenced('【行动】黄坤｜修炼'));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move?.verb, '修炼', '★玩家自己的行动必须原样进落子');
    assert.equal(r.move?.source, 'tag', '★来源如实标成标签');
    assert.equal(r.pack.pack.playerMove?.verb, '修炼', '★递出去的那一格也要是它');
});

test('leg198⑥（对照组）：玩家标签**只写了人、没写做了什么** ⇒ 落子照旧在（动词可以为空）', async () => {
    // leg89 那条口径没撤：标签口径下没有词表，动词可以空着——但那仍是**已经发生的事实**。
    const r = await run(fenced('【行动】黄坤'));
    assert.equal(r.ok, true, r.error);
    assert.ok(r.move, '★这一条不许被"没有动词"丢掉');
    assert.equal(r.move.verb, null, '★动词空着就是空着（不填占位值）');
    assert.equal(r.move.source, 'tag');
});

// ── ④ ★★★leg199：**块外**的标签一个都不许认（"猜"的最后一条路）──────────────────
//   用户令（2026-10-05，逐字）：「**删掉降级吧**」——指的是 `src/tag-extract.js` 里
//   "块不在 ⇒ 退回逐行扫全篇"那条降级（leg93 立的）。它当年是甲案的安全绳，而 leg198 体检**实跑**
//   （装置 `F:/deepseek/tmp/leg198-audit/probe.mjs`）证明它是一条比词表更狠的猜测路：
//     正文里**只要有一行以 `【行动】` 开头**（引用一张字条、一份告示、解说格式、打比方），
//     它就成一条真行动；而**写到玩家名上**时，它**变成玩家这一轮的落子**、原样递给世界模型。
//   ⇒ 本组判据锁的就是"那条路不许回来"，两档都咬（别人名 / 玩家名）。
test('leg199①：正文里**引用**一行【行动】（没有块）⇒ 一件都不许记（字条/告示不算行动）', async () => {
    const r = await run('他想起昨夜那张纸条，上面写着：\n【行动】甲｜偷袭｜黄坤\n黄坤把纸条揉成一团。');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.dialogueStats.events, 0, '★块外那一行是**正文在引用**，不许当成真行动记下来');
    assert.equal(r.move, null, '★更不许变成玩家的落子');
    assert.equal(r.pack.pack.playerMove, null);
    assert.equal(r.tagFacts.shell.found, false, '★如实标出"这一轮没有块"（面板据此把原因说出来）');
});

test('leg199②：★★引用里点到**玩家名** ⇒ 玩家这一轮**没有落子**（这是那条路最狠的一档）', async () => {
    // 实跑读数（改前）：`move.verb = '刺杀'`、`pack.playerMove = {verb:'刺杀',object:'甲',…}` ⇒
    //   世界模型会把"信上写的刺杀"当成玩家真出手了，照它演下去。
    const r = await run('甲把信递过来，信上写着：\n【行动】黄坤｜刺杀｜甲\n黄坤看完，把信烧了。');
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move, null, '★★块外那句【行动】点到玩家名，也**不许**变成玩家的落子');
    assert.equal(r.pack.pack.playerMove, null, '★★递给世界模型的那一格必须是空');
    assert.equal(r.dialogueStats.events, 0, '★那一行整个不进账');
    assert.ok(!String(r.streams?.injection || '').includes('你的行迹'), '★"你的行迹"那行不许出现');
});

test('leg199③（对照组）：同一行**包进块里** ⇒ 照旧是一条真行动（边界只挡块外）', async () => {
    const r = await run(fenced('【行动】黄坤｜刺杀｜甲'));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move?.verb, '刺杀', '★块里那一条照常成立（证明上面那两个 0 是边界判出来的，不是夹具坏了）');
    assert.equal(r.dialogueStats.events, 1);
});

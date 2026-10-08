import { readHostSource } from './host-wiring-source.js';
// story-world-v2/test/long-task.test.js
//
// ★★★leg109 判据：**长活儿"正在跑"要看得见、连点第二下不许发第二串**
//   （`STATE.md` §3 ② 那一条；细案 `docs/superpowers/specs/2026-09-22-leg108-long-task-design.md`）。
//
// ＝＝ 这一笔要治的病（为什么它排在 B 类最前）＝＝
//   面板上三件事要跑几十秒到几十分钟（只重抽设定 / 只抽刻度 / 采用草稿），跑起来**界面上没有
//   任何"正在跑"的样子** ⇒ 玩家以为没点上、**再点一次就发出去第二串模型调用**（白等一份时间、
//   花两份钱；采用那一条还会两笔覆盖写账）。★本仓最贵的一种浪费。
//
// ＝＝ 判据形态（照本仓那把尺）＝＝
//   ① 每一条都**真跑**（`createLongTask` 直接 import 进来，喂假窗口/假状态条），不是扫源码充数；
//   ② 带**反向对照**（跑完必须放行 · 没人点的时候按钮上一个字都不许变 · 源码锁要能被故意改坏咬住）；
//   ③ 源码锁（第 ⑥ 条）**精确到那三个字面量**：防"模块写好了、没人用"（leg25f 那条病历）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLongTask, LONG_TASK_LABELS, BUSY_TEXT } from '../web/long-task.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const webSrc = () => readHostSource();

/**
 * 只剥**注释**、保留字符串字面量（照本仓既有形状：`test/retired-controls.test.js:78`、
 * `test/adopt-scale-draft.test.js:71` 同一份口径）。
 * ★为什么必须剥：本仓的留档注释里**逐字写着**被撤/被搬走的东西（"某某已搬进…"），裸扫会把
 *   **留档**算成**实现**（leg71 §4.1 / leg74 §4.1 记过好几次的那个洞）。
 */
function stripComments(src) {
    let out = ''; let i = 0; const n = src.length;
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
        if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            const q = c; out += c; i += 1;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === q) { i += 1; break; }
                i += 1;
            }
            continue;
        }
        out += c; i += 1;
    }
    return out;
}

/** 假按钮：只实现本模块真会用到的那几样（`setAttribute` / `removeAttribute` / `textContent` / `isConnected`）。 */
function fakeButton(text) {
    const attrs = new Map();
    return {
        textContent: text,
        isConnected: true,
        disabled: false,
        setAttribute(k, v) { attrs.set(k, v); if (k === 'disabled') this.disabled = true; },
        removeAttribute(k) { attrs.delete(k); if (k === 'disabled') this.disabled = false; },
        hasAttribute(k) { return attrs.has(k); },
    };
}

/**
 * 假窗口 + 假状态条。
 * @param buttons 按动作名给的按钮清单；**只按 `[data-action="<动作>"]` 那一种选择器取**
 *   （本模块只发这一种查询 ⇒ 假窗口也只认这一种，别的选择器一律返回空——"找不到就什么都不做"）。
 */
function fixture(buttons = {}) {
    const said = [];
    const win = {
        querySelectorAll(sel) {
            const m = /^\[data-action="([^"]+)"\]$/.exec(sel);
            return m ? (buttons[m[1]] || []) : [];
        },
    };
    return { win, said, task: createLongTask({ win, setStatus: (s) => said.push(s), log: () => {} }) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * ★★★**"被挡住那一下必须立刻返回"——这一条要能被证伪，而且不许把测试挂死。**
 *
 * ＝＝ 为什么必须有它（本文件反向自证当场量出来的，如实留档）＝＝
 *   第一版是直接 `await wrapped()` 取第二次的返回值。我把闸**故意拆掉**（`if (inFlight.has(action))`
 *   → `if (false)`）跑反向自证时，`node --test` **挂死了**（跑满 180 秒超时被杀，一条红都没印出来）：
 *   闸一拆，第二次调用不再早退，而是**并发跑内层**、一起 `await` 那道永远不放开的 `gate`
 *   ⇒ 谁都回不来。★**挂死比红更坏**：红会告诉你哪儿错了，挂死只会让你以为"测试跑得慢"。
 *   ⇒ 定稿：等它的时候**只等 2 秒**；没回来就当场判红，并把"它其实进去了"这句话印出来。
 *     这样反向自证（拆闸）得到的是**一条干净的红**，而不是一次挂死。
 */
function settled(promise, ms, what) {
    return Promise.race([
        Promise.resolve(promise),
        sleep(ms).then(() => { throw new Error(`${what}：超过 ${ms}ms 还没回来 ⇒ 它没被挡住，而是**并发跑进去了**`); }),
    ]);
}

// ───────────────── ① 闸真的挡：连点两下 = 两串模型调用（本笔的正事） ─────────────────

test('★leg109 ① 闸：第一次还在飞的时候，第二次立刻返回，内层函数只被调了 1 次', async () => {
    const { task } = fixture();
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const wrapped = task.wrap('reextract-setting', LONG_TASK_LABELS['reextract-setting'], async () => {
        calls += 1;
        await gate;
        return '第一次的结果';
    });

    const first = wrapped();                       // 第一次：在飞
    await sleep(0);
    // ★★第二次用 `settled` 等（2 秒上限）：闸若被拆掉，这一下会**并发跑进去**、跟着一起等 gate
    //   ⇒ 没有上限就是"测试挂死"（反向自证实测踩过，见 `settled` 那段留档）。
    const second = await settled(wrapped(), 2000, '连点的第二下');
    assert.equal(second, undefined, '★被挡住那一下必须**立刻返回**（不排队、不等第一次跑完）');
    assert.equal(calls, 1, `★★内层函数只许被调 1 次（否则就是两串模型调用）；实测 ${calls} 次`);
    assert.equal(task.running('reextract-setting'), true, '第一次仍在飞 ⇒ 闸必须是"关着"的');

    release();
    assert.equal(await first, '第一次的结果', '★第一次的返回值必须原样交出去（同签名：包一层不许改行为）');
    assert.equal(calls, 1, '跑完之后调用次数照旧是 1（第二下从头到尾没进去过）');
});

// ───────────────── ② ★反向对照：跑完之后必须放行 ─────────────────

test('★★leg109 ② 反向对照：跑完之后再调必须放行（防"闸一开就再也打不开"，那会把功能锁死）', async () => {
    const { task } = fixture();
    let calls = 0;
    const wrapped = task.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => { calls += 1; return calls; });

    assert.equal(await wrapped(), 1, '第一次照常跑');
    assert.equal(await wrapped(), 2, '★★第二次（玩家真的又点了一次）必须放行——内层被调 2 次');
    assert.equal(calls, 2, `★跑完之后闸必须重新打开；实测内层被调 ${calls} 次`);
    assert.equal(task.running('extract-scales'), false, '跑完之后 running 必须是假');
    assert.deepEqual(task.busy(), [], '★跑完之后"在跑的动作"必须是空的（否则那一格被永久挡住）');
});

// ───────────────── ③ ★抛错也要放闸（否则一次失败就把那一格永久挡住） ─────────────────

test('★★leg109 ③ 抛错：错误照常往上抛（不许吞），且闸必须释放、按钮必须还原', async () => {
    const btn = fakeButton('只重抽设定');
    const { task, win } = fixture({ 'reextract-setting': [btn] });
    assert.ok(win, '前置：假窗口就位');
    let calls = 0;
    const wrapped = task.wrap('reextract-setting', LONG_TASK_LABELS['reextract-setting'], async () => {
        calls += 1;
        if (calls === 1) throw new Error('模型通道炸了');
        return '第二次成功';
    });

    await assert.rejects(() => wrapped(), /模型通道炸了/, '★错误必须原样往上抛（吞掉错误 = 状态条永远停在"正在跑"）');
    assert.equal(task.running('reextract-setting'), false, '★★抛错也必须放闸（finally）——否则这一格被永久挡住');
    assert.equal(btn.textContent, '只重抽设定', '★抛错之后按钮文字也要还原成原样');
    assert.equal(btn.disabled, false, '★抛错之后按钮不许留在"灰掉"那一态');
    assert.equal(await wrapped(), '第二次成功', '★★反向对照：出过一次错之后，下一次必须照样能跑');
});

// ───────────────── ④ 被挡住要出声（与 leg108 给"推进一轮"补的那条同口径） ─────────────────

test('★leg109 ④ 被挡住要出声：状态条收到一句人话，且必须含「没有重复发」', async () => {
    const { task, said } = fixture();
    let release;
    const gate = new Promise((r) => { release = r; });
    const wrapped = task.wrap('adopt-scale-draft', LONG_TASK_LABELS['adopt-scale-draft'], async () => { await gate; });

    const first = wrapped();
    await sleep(0);
    await settled(wrapped(), 2000, '连点的第二下（出声那一条）');
    assert.equal(said.length, 1, `★被挡住必须**出声**（不许静默）；实测状态条收到 ${said.length} 句`);
    assert.match(said[0], /没有重复发/, `★那句人话必须说清"这一下没有重复发"；实测「${said[0]}」`);
    assert.match(said[0], /采用这份草稿/, '★还要说清**是哪一件**还在跑（念的是人话名字，不是动作名）');
    release();
    await first;
    assert.equal(said.length, 1, '★放行的那两次调用不许再往状态条上写东西（出声只属于"被挡住"那一下）');
});

// ───────────────── ⑤ 看得见：按钮灰掉 + 文字「正在跑…」，跑完逐字还原 ─────────────────

test('★leg109 ⑤ 看得见：按钮置灰 + 文字改成「正在跑…」，跑完**原文字逐字**还原', async () => {
    const btnA = fakeButton('只抽刻度');
    const btnB = fakeButton('只抽刻度');            // 同一个动作在面板上画在不止一处
    const { task } = fixture({ 'extract-scales': [btnA, btnB] });
    let release;
    const gate = new Promise((r) => { release = r; });
    const wrapped = task.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => { await gate; });

    const running = wrapped();
    await sleep(0);
    for (const [name, b] of [['第一枚', btnA], ['第二枚', btnB]]) {
        assert.equal(b.disabled, true, `★跑的时候${name}按钮必须是灰的（看不见"正在跑"正是本笔要治的病）`);
        assert.equal(b.textContent, BUSY_TEXT, `★跑的时候${name}按钮文字必须是「${BUSY_TEXT}」`);
    }
    release();
    await running;
    assert.equal(btnA.textContent, '只抽刻度', '★★跑完必须还原成**原文字**（原样存下来的那一份，不许自己编一个）');
    assert.equal(btnB.textContent, '只抽刻度', '★第二枚同理');
    assert.equal(btnA.disabled, false, '★跑完按钮必须能再点');
});

test('★leg109 ⑤-b 零阻塞：找不到按钮 / 没有窗口 ⇒ 一个字节都不动，也不抛', async () => {
    // 反向对照之一：面板上根本没有这枚按钮
    const empty = fixture({});
    let ran = 0;
    const noBtn = empty.task.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => { ran += 1; return 'ok'; });
    assert.equal(await noBtn(), 'ok', '★找不到按钮不许影响长活儿本身（零阻塞）');
    assert.equal(ran, 1, '★长活儿照跑');
    assert.deepEqual(empty.said, [], '★没被挡住 ⇒ 一句都不许说');

    // 反向对照之二：连窗口都没有（Node 侧 / 面板还没画出来）
    const bare = createLongTask({ setStatus: () => {} });
    const wrapped = bare.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async () => 'still ok');
    assert.equal(await wrapped(), 'still ok', '★没有窗口也必须照跑（DOM 只是"看得见"，不是闸）');

    // 反向对照之三：按钮被重绘换掉了（`isConnected === false`）⇒ 不许去碰它、更不许猜新节点该写什么
    const gone = fakeButton('只抽刻度');
    const f = fixture({ 'extract-scales': [gone] });
    const w2 = f.task.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => { gone.isConnected = false; gone.textContent = '重绘换掉的新节点'; });
    await w2();
    assert.equal(gone.textContent, '重绘换掉的新节点', '★已被换掉的旧节点**一个字都不许改**（如实登记：那一下"看得见"是尽力而为）');
});

// ───────────────── ⑥ 接线三处：三个动作都真的被包了（防"模块写好了没人用"） ─────────────────

test('★★leg109 ⑥ 接线：三个长动作都真的被 `longTask.wrap` 包了，且用的是同一份人话名字', () => {
    const web = stripComments(webSrc());
    // ★★★leg144：**把「初始化」也纳入这条锁**（它此前不在名单里 ⇒ "包了没有"没人验）。
    //   这正是本条锁存在的理由："模块写好了没人用"那一族病历——现在它有据可查了。
    for (const action of ['reextract-setting', 'extract-scales', 'adopt-scale-draft', 'init-world']) {
        const argument = action === 'adopt-scale-draft' ? '' : 'task';
        const anchor = `bus['${action}'] = longTask.wrap('${action}', LONG_TASK_LABELS['${action}'], async (${argument}) => {`;
        assert.equal(web.split(anchor).length - 1, 1,
            `★★\`${action}\` 必须**恰好一处**写成「包起来」的样子（模块写好了没人用 = leg25f 那条病历；`
            + `两处 = 下面这条源码锁会读到错的那一段）`);
    }
    // ★人话名字只有一处定义（接线层引用模块里那张表，不许在本文件里另抄一份）。
    //   ★这条**第一版写错了**（如实留档）：原来是"接线层里不许出现那三句人话"——太钝，
    //     当场咬住 8 行**本来就该有**的旧文案（"先按「只抽刻度」抽一次再采用"等等）。
    //     那不是复制品，那是别处的正常说法。⇒ 改成**只咬"又定义了一张名字表"**这件事本身。
    assert.match(web, /import \{ createLongTask, LONG_TASK_LABELS \} from '\.\/long-task\.js'/,
        '★接线层必须从模块取那张名字表（自己抄一份中文 ⇒ 面板上两处说法迟早不一样）');
    assert.ok(!/const\s+LONG_TASK_LABELS\s*=/.test(web),
        '★接线层不许**再定义一张** `LONG_TASK_LABELS`（那就是第二份真相）');
    assert.ok(!/'reextract-setting'\s*:\s*'/.test(web),
        '★接线层不许把"动作名 → 人话"再抄一遍（只许走模块里那张表）');
    // ★正向对照：那三句人话必须真的住在模块里（否则上面两条"不许"会变成"哪儿都没有"的空绿）
    const mod = readFileSync(new URL('../web/long-task.js', import.meta.url), 'utf8');
    for (const label of ['只重抽设定', '只抽刻度', '采用这份草稿']) {
        assert.ok(mod.includes(`'${label}'`), `★\`web/long-task.js\` 的名字表里必须有「${label}」`);
    }
});

test('★★leg109 ⑥-b 反向对照：源码锁真的会咬人（故意把一处改回"没包"的样子 ⇒ 当场红）', () => {
    const web = stripComments(webSrc());
    const broken = web.replace(
        "bus['extract-scales'] = longTask.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => {",
        "bus['extract-scales'] = async () => {",
    );
    assert.notEqual(broken, web, '前置：那次替换必须真的改到东西（否则这条反向对照自己在空跑）');
    const anchor = "bus['extract-scales'] = longTask.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => {";
    assert.equal(broken.split(anchor).length - 1, 0, '★★故意改坏之后必须**找不到**那个锚点（第 ⑥ 条就是这么咬的）');
    // 另一半：名字表里少一个动作，接线层当场就取不到名字（`undefined` ⇒ 状态条会念出"undefined"）
    assert.equal(LONG_TASK_LABELS['extract-scales'], '只抽刻度', '★名字表里必须有这一个动作');
    // ★★★leg112：**3 → 4**（C1 换书检测的「就按现在这本算」加进来了）。口径没放宽：
    //   "多放 = 有人以为别的动作也有闸"这条理由仍在 ⇒ 加一个就要在这里写清**是谁、为什么**。
    //   它**不是长活儿**（取一次书 + 算一次指纹 + 写一格，毫秒级），加它只为"连点两下不发两遍"
    //   （第二遍会再取一次书）——与那三个长动作共用同一把闸，见 `web/book-rebaseline.js` 头注。
    // ★★★leg144：**4 → 5**（「初始化」加进来了）。这一格**反过来**：它是面板上**最慢**的
    //   （真账 20–30 分钟），却一直是**唯一没被护住**的那一个 —— 连点两下 = 两串模型调用一起跑
    //   （白等一份时间、花两份钱，还互相抢网关）。所以它不只是"不发两遍"，是这五格里收益最大的一格。
    assert.equal(Object.keys(LONG_TASK_LABELS).length, 5, '★名字表只放这五个动作（多放 = 有人以为别的动作也有闸）');
});

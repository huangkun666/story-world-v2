// story-world-v2/test/prose-extract.test.js
// ★★★leg198：**提取正文之前，先把"不是正文"的东西剥掉**。
//
// 这是社区反馈第 4 条（作者原话：「建议给「提取正文」也加一层**排除**（注释 ／ 成对标签块）」），
// 病（他给的现象，本仓源码可证）：正文里混着两类**不是正文**的东西——
//   ① 别的扩展的状态栏块（`<角色手机>…</角色手机>`，里面还套着一整套状态/动态/备忘）；
//   ② 给自己看的 HTML 注释（`<!--抢话自查: …-->`）。
// 而提取那一趟拿的是**整条消息原文，一个字符都不剥**（`web/index.js` 取最后一条 → `runTick` 的 `dialogue`）。
//
// 仓库里本来就有这一层（`proseOnly`，住在 `web/inject.js`，只服务"找旧事的查询串"）——
// 本笔把它**搬进 `src/`（提取链在引擎这一层，而 `src/` 不许 import `web/`）**，
// 并**加两条**：① HTML 注释也剥；② ★**围栏被成对块包住时整段退回原文**
//   （否则会把 ```tags 块一起剥掉 ⇒ 一整轮标签全丢，那是最坏的失效形状）。
//
// 口径三条（照反馈者的建议，也照本仓自己的纪律）：
//   · **结构判**（同名开闭成对），**不是标签名清单**——`ANCHOR.md` §4.8 明禁"用词表判语义"；
//   · **剥完为空 ⇒ 退回原文**（与 `proseOnly` 现有边界一致，不会比今天更坏）；
//   · ★**不剥三反引号块**——` ```tags ` 块正是提取要读的料，谁都不许剥它。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { proseOnly } from '../src/prose.js';
import { runTick } from '../src/tick.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FENCE = '`'.repeat(3);
const fenced = (...lines) => [FENCE + 'tags', ...lines, FENCE].join('\n');

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

// ── ① 老口径逐字不变（对照组：查询串那一侧靠它，动它就是动实测曲线）────────────────
test('leg198⑦（对照组）：`proseOnly` 的成对块口径照旧（拉丁名那一档一个字节没变）', () => {
    assert.equal(proseOnly('<status>机器块</status>正文在这里。'), ' 正文在这里。',
        '★同名开闭成对的那一段剥掉、正文照留（老口径）');
    assert.equal(proseOnly('<status>整条都包住了</status>'), '<status>整条都包住了</status>',
        '★剥完是空的 ⇒ **退回原文**（不会比今天更坏）');
    const code = [FENCE + 'tags', '【行动】甲｜离开', FENCE].join('\n');
    assert.equal(proseOnly(code), code, '★三反引号块**有意不剥**（那正是提取要读的料）');
});

test('leg198⑦b：★名字那一格放宽到**中文名**（社区反馈里那类块就叫 `<角色手机>`）', () => {
    // 病：旧正则要求"名字以拉丁字母开头"⇒ `<角色手机>…</角色手机>` **一个都剥不掉**，
    //   而那正是反馈者手上那类块的名字（`<角色手机>` 里套着一整套 `<status>`／`<SNS>`／`<memo>`）。
    assert.equal(proseOnly('<角色手机>机器块</角色手机>正文在这里。'), ' 正文在这里。',
        '★中文名的成对块也要剥（结构判：同名开闭成对，不是标签名清单）');
});

// ── ② 新口径：注释也剥 ＋ 围栏保命 ──────────────────────────────────────────────
test('leg198⑧：提取这一趟把「成对块 ＋ HTML 注释」都剥掉（结构判，不用标签名清单）', () => {
    const text = '开头。<!--抢话自查: 本段描写甲的反应 --><状态栏>机器</状态栏>结尾。';
    const got = proseOnly(text, { keepTagsFence: true });
    assert.ok(!got.includes('抢话自查'), '★HTML 注释不是正文，要剥掉');
    assert.ok(!got.includes('机器'), '★成对块照旧剥掉');
    assert.ok(got.includes('开头。') && got.includes('结尾。'), '★正文一个字都不许少');
});

test('leg198⑨：★围栏被成对块包住 ⇒ **整段退回原文**（不许把标签一起剥掉）', () => {
    // 这是本笔最要紧的一条保命规则：` ```tags ` 不是 HTML 标签、本身不会被那个正则命中，
    //   但**它可能住在别的扩展的信封里**（`<角色手机>…```tags…```…</角色手机>`）。
    //   只按"成对块剥掉"办，就会把**一整轮的标签全剥没**，而且一声不响。
    const wrapped = ['<信封>', '正文在这里。', fenced('【行动】甲｜离开'), '</信封>'].join('\n');
    const got = proseOnly(wrapped, { keepTagsFence: true });
    assert.equal(got, wrapped, '★原文里有围栏、剥完没了 ⇒ 退回原文（宁可少剥，不许把标签剥没）');
});

// ── ③ 接线：真跑一轮，证明"剥这一层"真的在起作用 ────────────────────────────────
//   ★★★leg199 翻案（用户令「**删掉降级吧**」）：这条判据原来拿"**块外的**一行裸标签"当对照，
//     而 leg199 起"没有 ` ```tags ` 块 ⇒ 零收获" ⇒ 那个对照**两头都是 0**、判据变成空绿。
//     ⇒ 拆成两面，各锁一件**真能观察到**的事（不造一个"看起来有差别"的假对照）：
//       ① ★**保围栏那条边界真的在兜底**：标签块住在信封里时，剥完围栏没了 ⇒ **整段退回原文**
//          （宁可少剥，不许把一整轮的标签剥没——`src/prose.js` 边界③）；
//       ② ★**剥掉的确实是信封里的字**（这一层真的动了文本，不是空转）——而正文一个字不少。
test('leg198⑩：剥这一层真的在起作用（保围栏兜底 ＋ 信封里的字确实被剥掉）', async () => {
    const envelope = ['<状态栏>', fenced('【行动】甲｜离开'), '</状态栏>'].join('\n');
    const dialogue = envelope + '\n正文在这里。';

    // ① ★边界③：围栏被信封包住 ⇒ 整段退回原文（`proseOnly` 只认这一个函数，行为即引擎读到的文本）
    const kept = proseOnly(dialogue, { keepTagsFence: true });
    assert.equal(kept, dialogue, '★原文里有围栏、剥完没了 ⇒ **退回原文**（否则一整轮标签全丢）');
    //   代价如实锁住：这一档下信封**照旧留着**（那是"宁可少剥"的价钱，不是 bug）
    assert.ok(kept.includes('<状态栏>'), '★如实登记：这一档下信封留着（保围栏优先于剥干净）');

    // ② ★对照：信封里**没有**围栏 ⇒ 那一层真的被剥掉，而正文一个字不少
    const plain = ['<状态栏>', '【行动】甲｜离开', '</状态栏>', '正文在这里。'].join('\n');
    const stripped = proseOnly(plain, { keepTagsFence: true });
    assert.ok(!stripped.includes('【行动】甲｜离开'), '★信封里的那行确实被剥掉了（这一层不是空转）');
    assert.ok(stripped.includes('正文在这里。'), '★正文一个字都不许少');

    // ③ 真跑一轮：正文里那个**真块**照旧读得出（剥这一层不许误伤正常路径）
    const r = await run(plain + '\n' + fenced('【行动】甲｜离开'), { stripBlocks: true });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.dialogueStats.events, 1, '★信封剥掉之后，正文末尾那个真块照旧记下一件事');
});

test('leg198⑪：剥完之后，正文里的标签照旧读得到（不许误伤）', async () => {
    const dialogue = ['<状态栏>机器</状态栏>', '正文在这里。', fenced('【行动】黄坤｜修炼')].join('\n');
    const r = await run(dialogue, { stripBlocks: true });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.move?.verb, '修炼', '★机器块剥掉之后，玩家自己的标签照旧成立');
    assert.equal(r.dialogueStats.events, 1, '★正文里那一件事照旧记下来');
});

// ── ④ 接线与开关：源码锁（这一层必须有开关，且默认开着）──────────────────────────
test('leg198⑫：开关接在线上（接线层传值 ＋ 面板那一枚 ＋ 默认开）', () => {
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const render = readFileSync(path.join(ROOT, 'src', 'render.js'), 'utf8');
    assert.match(web, /stripBlocks:/, '★接线层必须把开关的真值递给 `runTick`（否则这一层永远不开）');
    assert.match(web, /stripMachineBlocks/, '★开关名要有一处定义（读设置那口）');
    assert.match(render, /stripMachineBlocks/, '★面板上要有这一枚开关（玩家得能关掉它）');
    const src = readFileSync(path.join(ROOT, 'src', 'tick.js'), 'utf8');
    assert.match(src, /stripBlocks = false/, '★引擎侧的形参缺省必须是"不剥"（老调用方零扰动）');
    assert.match(src, /proseOnly\(dialogue \|\| '', \{ keepTagsFence: true \}\)|keepTagsFence: true/,
        '★提取那一趟必须走"保围栏"的那一档');
});

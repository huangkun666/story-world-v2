// story-world-v2/test/entity-window.test.js
//
// ★★★leg140：**实体观览窗口**的判据（用户令「点击实体就会出现，能看到这个实体的各种属性以及它的事迹」）。
//
// 这一份要咬住三件事（本仓 §2.3 第 6 条：**接线必须有测试**）：
//   ① **纯函数那一半**（`renderEntityWindowHtml` 与它那几个取数口）——真跑，不需要 DOM；
//   ② **接线那一半**——`src/render.js` 真给实体行打了可点标记、`web/index.js` 真把动作挂上了总线；
//   ③ **窗口那一半**——用**假 DOM** 真开一次、真关一次（Esc / 点暗处 / ✕ 三条路都走一遍）。
//
// ★为什么第 ③ 条必须用假 DOM 真跑而不是"读源码看有没有那几句"：
//   本仓 leg89/92/103/105 四次实机「**点了没反应**」全长在"**写了但没接上**"这条链上，
//   而当时的判据全是源码级锁（看着都对）。⇒ 能真跑的一律真跑。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ENTITY_WINDOW_MASK_ID, ENTITY_WINDOW_ACTION,
    attrPairsOf, originOf, deedsOf, involvedOf, agendasOf, relationsOf, networkOf,
    changedFieldsOf, renderEntityWindowHtml, createEntityWindowHub,
} from '../web/entity-window.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** ★本仓那条尺子：**注释里可以留档、代码里不许有定义** —— 凡"某个名字还在不在"的判据，
 *  都要**先剥注释**再咬（不然留档那句自己会把判据咬红，而错的是尺子不是代码）。
 *  ★这不是假想：leg140 的 ⑥ 与 leg141 的 ㉑ **各踩过一次**（都是"把注释里的留档当成了代码"）。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// ── 夹具：照真账（大荒z · 第 1 轮）的形状造，但**刻意留出四个空样本** ────────────
//   ★夹具里那些值不是编的：它们逐字抄自 `F:\jiuguanai\...\chats\大荒z` 的副本
//     （真账 640 实体 / 11 事件 / 1 条在办谋划），这样"窗口长什么样"才是照真账画的。
function fixture() {
    return {
        version: 1,
        context: { playerId: 'e_p1', positions: ['未明', '江州城'] },
        entities: [
            // 玩家：有"变过的格"、有事迹、被卷进来过
            { id: 'e_p1', kind: 'character', name: '黄坤', location: '未明', lastActiveTick: 1, 身份: '确立江州实际掌控者地位' },
            // 一个"书里给的属性最全 + 归属是推出来的"的角色
            {
                id: 'e_bk_429', kind: 'character', name: '白狐·雪姬', location: '未明',
                实力: 'T3筑基境', 身份: '白狐公主', 性别: '女', 描述: '银发冰蓝本命狐火',
                fieldSource: { 身份: '书里原话', 实力: '书里原话', 性别: '书里原话', 描述: '书里原话' },
                parent: '青丘国', parentSource: '结构推导', parentSourceFrom: '成员行@青丘国',
            },
            // 一个势力：有在办谋划
            {
                id: 'e_bk_19', kind: 'faction', name: '万法阁', location: '东胜沧洲', lastActiveTick: 1,
                规模: '极富, 垄断丹药灵器阵盘', 性质: '修真百艺总坛', 倾向: '商业合作', 领地: '东海浮空岛',
                fieldSource: { 性质: '书里原话', 倾向: '书里原话', 规模: '书里原话', 领地: '书里原话' },
            },
            // ★全空样本：属性有三栏，事迹/在办/关系/点名**一样都没有**
            { id: 'e_bk_1', kind: 'faction', name: '须弥山', location: '未明', 规模: '下界菩提禅院的真正祖庭', 性质: '人族佛门飞升者归宿', 倾向: '正道' },
            // 一个**连属性都没有**的
            { id: 'e_bare', kind: 'character', name: '无名客', location: '未明' },
            // 转义样本（名字里带尖括号——渲染层必须转义）
            { id: 'e_xss', kind: 'character', name: '<img src=x onerror=alert(1)>', location: '未明', 身份: '坏人' },
        ],
        weights: {},
        agendas: [
            { id: 'a_1_1', owner: 'e_bk_19', goal: '借江州新主之势，垄断此地商路', stage: '进献重宝探底', visibility: 'concealed', maxSteps: 4, progress: 0, source: { type: 'state' } },
        ],
        events: [
            // 起根（第 0 轮，无 timeMark）——主语是白狐·雪姬
            { id: 'ev_seed_3', title: '白狐雪姬隐匿于人族宗门历练', source: { type: 'seed' }, position: '人族宗门内', ripples: ['e_bk_429', 'e_bk_70'], seedFrom: { quote: '目前正于人族宗门内隐匿历练。', tick: 0 } },
            // 起根——主语是万法阁
            { id: 'ev_seed_1', title: '前往帅府击杀薛铁衣', source: { type: 'seed' }, position: '地下水榭门外', ripples: ['e_bk_19'], seedFrom: { quote: '万子明在水榭外候命。', tick: 0 } },
            // 正文（聊天侧）——主语是玩家
            { id: 'ev_1_500', title: '黄坤的身份变成了「确立江州实际掌控者地位」', source: { type: 'dialogue' }, dialogueKind: 'change', position: '江州城·西关旧屋', ripples: ['e_p1'], timeMark: '复苏历19025年 十月十八', proseQuote: '【变化】黄坤｜身份｜确立江州实际掌控者地位', closed: true, closedAt: 1 },
            // 涟漪——主语是万法阁，**玩家在 ripples 里但不是头一个**（⇒ 玩家的"被卷进来"）
            { id: 'ev_1_1', title: '万法阁遣人携重宝正式入江州', source: { type: 'ripple', ref: 'ev_1_500' }, position: '江州城', ripples: ['e_bk_19', 'e_p1'], timeMark: '复苏历19025年 十月廿一' },
            // 涟漪——主语是白狐·雪姬（⇒ 她的第 2 件事迹）
            { id: 'ev_1_2', title: '白狐雪姬在人族宗门的秘境试炼中遭遇凶兽', source: { type: 'ripple', ref: 'ev_seed_3' }, position: '人族宗门内', ripples: ['e_bk_429', 'e_bk_70'], timeMark: '复苏历19025年 十月廿一' },
        ],
        chronicle: [],
        milestones: [],
        meta: {
            tick: 1,
            seedRoots: { fingerprint: 'seed:268824:30000:1whpgkf' },
            entityFields: {
                e_p1: {
                    fields: {
                        身份: { value: '确立江州实际掌控者地位', cause: 'ev_1_500', causeType: 'event', tick: 1, source: '变更', prior: null },
                    },
                    attempts: { 实力: { count: 1, lastTriedAt: 0, state: 'absent' } },
                    sources: [],
                },
            },
            dialogueBook: { e_bk_19: { count: 3, lastTick: 1 } },
        },
    };
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ① 纯函数那一半
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

test('leg140·①：属性对——常用键在前、结构键不摆进来、空串不印', () => {
    const w = fixture();
    const pairs = attrPairsOf(w.entities.find((e) => e.id === 'e_bk_429'));
    const keys = pairs.map((p) => p[0]);
    // 常用键（`src/tag-extract.js` 的 CHANGE_FIELDS）按它自己的序排在前面
    assert.deepEqual(keys.slice(0, 3), ['身份', '实力', '性别'], `常用键的序要照 CHANGE_FIELDS：${keys.join('/')}`);
    assert.ok(keys.includes('描述'), '表外的键照收（真账里有四十来种表外键）');
    for (const bad of ['id', 'kind', 'name', 'location', 'fieldSource', 'parent', 'parentSource', 'parentSourceFrom', 'lastActiveTick']) {
        assert.ok(!keys.includes(bad), `★结构键「${bad}」不该摆进「来历与身份」（它是结构，不是书里给的属性）`);
    }
    // 出处跟着值走
    assert.equal(pairs.find((p) => p[0] === '身份')[2], '书里原话');
    // 空串/非字符串一律不印（红线 2：空着就是空着）
    assert.equal(attrPairsOf({ id: 'x', kind: 'character', name: 'x', 身份: '', 实力: '   ', 性别: null }).length, 0);
    assert.deepEqual(attrPairsOf(null), [], '没实体 ⇒ 空数组，不抛');
});

test('leg140·②：归属那一格必须带「怎么来的」（书里明写 vs 从别处推的，是两件事）', () => {
    const w = fixture();
    const o = originOf(w.entities.find((e) => e.id === 'e_bk_429'));
    assert.ok(o, '有 parent ⇒ 必须交出归属那一格');
    assert.equal(o.bits[0].v, '青丘国');
    assert.match(o.how, /结构推导/, '★"怎么来的"必须一起交出来（真账 213 个有上级的实体都带 parentSource）');
    assert.equal(originOf({ id: 'x', kind: 'character', name: 'x' }), null, '没归属 ⇒ null（不印空壳）');
});

test('leg140·③：★事迹＝ripples[0] 是他；被卷进来＝他在 ripples 里但不是头一个（两件事分得开）', () => {
    const w = fixture();
    assert.deepEqual(deedsOf(w, 'e_bk_429').map((e) => e.id), ['ev_1_2', 'ev_seed_3'], '★新的在前（账上顺序倒过来）');
    assert.deepEqual(deedsOf(w, 'e_p1').map((e) => e.id), ['ev_1_500']);
    // ★玩家在 ev_1_1 的 ripples 里，但那件事的主语是万法阁 ⇒ 那是"被卷进来"，不是他的事迹
    assert.deepEqual(involvedOf(w, 'e_p1').map((e) => e.id), ['ev_1_1']);
    assert.deepEqual(deedsOf(w, 'e_p1').filter((e) => e.id === 'ev_1_1'), [], '★同一件事不许同时算进"他做的"');
    assert.deepEqual(involvedOf(w, 'e_bk_429'), [], '他是自己那两件事的主语 ⇒ "被卷进来"是空的');
});

test('leg140·④：事迹的顺序是「新的在前」——账上第一件必须排在最后（★这条就是排序那把尺子）', () => {
    const w = fixture();
    const accountOrder = w.events.filter((e) => e.ripples[0] === 'e_bk_429').map((e) => e.id);
    assert.deepEqual(accountOrder, ['ev_seed_3', 'ev_1_2'], '前置：账上的顺序是"先发生的在前"');
    const shown = deedsOf(w, 'e_bk_429').map((e) => e.id);
    assert.deepEqual(shown, [...accountOrder].reverse(), '★显示的顺序必须正好是账上顺序**倒过来**');
    assert.notDeepEqual(shown, accountOrder, '反向自证：要是没倒过来，这一条当场红');
});

test('leg140·⑤：变过的格——原值/现值/因哪件事/哪一轮都在；有 prior 时优先用 prior', () => {
    const w = fixture();
    const c = changedFieldsOf(w, 'e_p1');
    assert.equal(c.length, 1);
    assert.equal(c[0].field, '身份');
    assert.equal(c[0].now, '确立江州实际掌控者地位');
    assert.equal(c[0].prev, null, '首次改 ⇒ 原来没有');
    assert.equal(c[0].cause, 'ev_1_500');
    assert.equal(c[0].tick, 1);
    // 链式留痕：改过两次 ⇒ 上一次的值在 `prior.value` 里
    const w2 = { meta: { entityFields: { x: { fields: { 身份: { value: 'B', prev: 'A', prior: { value: 'A0' }, tick: 2 } } } } } };
    assert.equal(changedFieldsOf(w2, 'x')[0].prev, 'A0', '★有 prior 用 prior（那才是"上一版"），没有才退回 prev');
    assert.deepEqual(changedFieldsOf(w, 'e_bk_1'), [], '没留痕 ⇒ 空数组（不抛）');
});

test('leg140·⑥：关系——账上没有那张表时不许抛、不许瞎编', () => {
    const w = fixture();
    assert.deepEqual(relationsOf(w, 'e_p1'), [], '★真账里根本没有 relations 这张表 ⇒ 必须是空数组，不是 undefined');
    assert.deepEqual(relationsOf({}, 'e_p1'), []);
    // ★★leg140b：`namedOf`（被正文点名那个取数口）**已随那一格一起删掉**（用户当场指出的：
    //   正文的产出就是事件，那些事件本来就长在「事迹」里 ⇒ 那个计数在玩家眼前没有意义）。
    //   本仓不留死码 ⇒ 这一条反过来钉住"它真的不在了"。
    //   ★尺子要**先剥注释**：本仓的规矩是"**注释里可以留档、代码里不许有定义**"——
    //     第一版没剥注释，把留档那句也一起咬了（判据当场红，错的是尺子不是代码）。
    const code = stripComments(read('web/entity-window.js'));
    assert.ok(!/export function namedOf/.test(code), '★`namedOf` 已随「被正文点名」那一格撤掉（撤了格它就是死码）');
    assert.ok(!code.includes('dialogueBook'), '★窗口里不许再读 `meta.dialogueBook`（它是**引擎的依据册**，不是给玩家看的事实）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ② 整份窗口（七格）
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

test('leg140·⑦：**六格**一个不少（已拍板口径），且格子标题是人话', () => {
    const html = renderEntityWindowHtml(fixture(), 'e_bk_429');
    for (const t of ['来历与身份', '变过的格', '事迹 · 他做的', '事迹 · 涉及到他的', '他手上的事', '关系']) {
        assert.ok(html.includes(t), `★六格里少了「${t}」`);
    }
    // ★leg140b：第七格「被正文点名」**已撤**（用户当场指出）——反过来钉住它不许回潮
    assert.ok(!html.includes('被正文点名'), '★「被正文点名」那一格已按用户口径撤掉，不许回潮');
    assert.match(html, /sw2-ew-close/, '★窗口必须有一枚 ✕（三条关闭路径之一）');
    assert.match(html, /sw2-ew-body/, '★窗口体要有自己的滚动容器（`.sw2-window` 是 flex 列，不写就被裁）');
});

// ★★★leg141（用户令「**把（账上「涟漪」头一个是他；正文给的也在这一格里）这种文字给删了**」）：
//   格标题后面那半句**括号说明文**整批撤掉。★这条判据咬的是**那个机理**，不是某一个词：
//     **格标题里不许再出现括号**——他那句话点的就是这个位置（"标题 后面跟一对括号"）。
//   ① 产物：每一格的标题里都不许有 `（`；
//   ② 样式表：`.sw2-ew-hint` 那条规则**同批删掉**（撤了它就是零消费者的死码——本仓不留死码）。
//   ★为什么②也要咬：只删调用、把规则留在样式表里，是本仓 leg134「死码清理」点名过的那种"半拉子删除"。
//   ★★**第一版这条写歪了，留档**（错的是尺子、不是代码）：第一版把「涟漪」「头一个」「主语」
//     三个词**在整个产物里**全禁了 —— 当场红在「涟漪」上，而**红得没道理**：
//     `SRC_CN` 那张表把 `source.type === 'ripple'` 的事件印成「涟漪」那枚小标，那是
//     **事件来路**（书里给的 / 别的事牵出来的 / 正文给的），是**事实**、不是解释文。
//     ⇒ 收窄成"**标题里不许有括号**"＋"**那半句原文逐字不许回潮**"，两头都咬得住。
test('leg141·㉑：★★格标题后面那半句括号说明文**已整批撤掉**（用户当场点的那类文字）', () => {
    const w = fixture();
    const css = read('web/style.css');
    const src = read('web/entity-window.js');
    // ① 每一格的标题里不许再有括号（★这才是用户点掉的那个位置）
    for (const id of ['e_bk_429', 'e_p1', 'e_bk_1', 'e_bare', 'e_bk_19']) {
        const html = renderEntityWindowHtml(w, id);
        const heads = [...html.matchAll(/sw2-ew-sech">([\s\S]*?)<span class="sw2-ew-n">/g)].map((m) => m[1]);
        assert.ok(heads.length >= 5, `前置：这个实体至少要交出 5 个格标题（实际 ${heads.length}）——取不到就是空绿`);
        for (const h of heads) {
            assert.ok(!/[（(]/.test(h), `★★格标题里不许再有那半句括号说明文（实体 ${id}）：${JSON.stringify(h)}`);
        }
        // 那半句的原文也要逐字钉死（防止有人换个说法又写回来）
        for (const gone of ['他做过的事（', '别人做的事牵到他（', '玩出来的边（', '书里给的原话']) {
            assert.ok(!html.includes(gone), `★格标题后面那半句已撤，不许回潮：「${gone}」`);
        }
    }
    // ② 样式表里那条规则**同批删掉**（不留零消费者的死规则）
    //   ★★两头都要**先剥注释**：上面那段留档里逐字写着 `.sw2-ew-hint`（本仓规矩：注释里可以留档、
    //     代码里不许有定义）——不剥的话，留档那句自己就把这条咬红（实测当场红过一次）。
    assert.ok(!stripComments(css).includes('.sw2-ew-hint'),
        '★`.sw2-ew-hint` 已零消费者 ⇒ 那条规则必须一起删（本仓不留死码）');
    assert.ok(!stripComments(src).includes('sw2-ew-hint'), '★源码里也不许再引用它');
    // ③ 反向自证：`sec()` 那个口现在只吃两参（标题 ＋ 计数）——写回三参就是回潮
    assert.ok(!/sec\([^)]*,\s*'[^']*（/.test(stripComments(src)), '★`sec()` 不许再吃"说明文"那一参');
});

// ★★★leg141（用户令「**把事迹分为他做的和涉及到他的**」）：
//   原来那两格叫「事迹」与「被卷进来」，**区分全靠标题上那行括号说明文**（"涟漪头一个是他" vs
//   "他在涟漪里但不是头一个"）。说明文一撤，两个名字就站不住了 ⇒ 格名照用户的原话拆开。
//   ★这条判据咬的是**呈现层**那一半（取数那一半由 ③④ 两条咬着，本笔一个字节没动它）：
//     同一份夹具、同一个实体，两格必须**分开成两段**、各带自己的计数，而且**合起来不重不漏**。
test('leg141·㉒：★★事迹拆成两格——「事迹 · 他做的」与「事迹 · 涉及到他的」（用户当场点的分法）', () => {
    const w = fixture();
    const html = renderEntityWindowHtml(w, 'e_p1');       // 玩家：1 件他做的 ＋ 1 件牵到他的
    // 前置：两格真都在，且**旧那个笼统的「事迹」标题不许再单独出现**
    assert.ok(html.includes('事迹 · 他做的'), '★要有「事迹 · 他做的」');
    assert.ok(html.includes('事迹 · 涉及到他的'), '★要有「事迹 · 涉及到他的」');
    assert.ok(!/sw2-ew-sech">事迹<span/.test(html), '★旧那个笼统的「事迹」标题不许回潮（它正是"分不开"的那个名字）');
    // 计数各自对得上（★不是"两格都印了个数"就算数——要数与账对得上）
    const heads = [...html.matchAll(/sw2-ew-sech">([^<]+)<span class="sw2-ew-n">([^<]+)</g)].map((m) => [m[1], m[2]]);
    const nOf = (t) => (heads.find((h) => h[0] === t) || [])[1];
    assert.equal(nOf('事迹 · 他做的'), `共 ${deedsOf(w, 'e_p1').length} 件`, '★"他做的"那个数要等于账上他当主语的事');
    assert.equal(nOf('事迹 · 涉及到他的'), `共 ${involvedOf(w, 'e_p1').length} 件`, '★"涉及到他的"那个数要等于别人做的事牵到他的');
    // ★不重不漏：同一件事**不许**同时出现在两格里（这是"分得开"的唯一硬判据）
    const deedIds = deedsOf(w, 'e_p1').map((e) => e.id);
    const invIds = involvedOf(w, 'e_p1').map((e) => e.id);
    assert.equal(deedIds.filter((id) => invIds.includes(id)).length, 0, '★两格不许有交集');
    // 两格里的每一件都必须真在产物里（标题逐字印出来）——防"数是抄的、行没渲染"
    for (const id of [...deedIds, ...invIds]) {
        const title = w.events.find((e) => e.id === id).title;
        assert.ok(html.includes(title), `★这一件没印出来：${title}`);
    }
});

test('leg140b·⑦b：★窗口**不许占满整屏**（用户当场：「窗口太大几乎占了整个屏幕」）', () => {
    const css = read('web/style.css');
    // 前置：`.sw2-window` 那条基础规则**是面板专用的"占满整屏"**（leg102 用户当时要的）——
    //   本窗口要覆盖它，就得有自己的尺寸规则（取不到 ⇒ 下面那条是空绿）。
    assert.match(css, /\.sw2-window\{[^}]*width:100%[^}]*height:calc\(100vh - 40px\)/,
        '前置：`.sw2-window` 基础规则确实是"占满整屏"（面板那扇窗用的）');
    // ★★leg141（用户令「**窗口再大个百分之20差不多就可以**」）：在 140b 那把尺上放大两成 ——
    //   820 × 1.2 = **984**（正好两成）· 高度上限 86% → 90%（★高度**不敢让满两成**：
    //   103% 装不下，而 140b 之前那版"占满整屏"正是他当场嫌过的 ⇒ 90% 上下各留 5% 边距）。
    assert.match(css, /\.sw2-ew-window\{[^}]*width:984px[^}]*max-height:90%/,
        '★实体观览窗口的尺寸：984px（＝820 × 1.2） × 最高 90%');
    // 反向：不许出现"本窗口也占满整屏"的写法
    assert.ok(!/\.sw2-ew-window\{[^}]*height:calc\(100vh/.test(css), '★本窗口不许继承"占满整屏"那个高度');
    // ★两个数都要能自证是"从 140b 那把尺算出来的"，不是随手拍的：
    const m = /\.sw2-ew-window\{width:(\d+)px;max-width:100%;height:auto;max-height:(\d+)%;\}/.exec(css);
    assert.ok(m, '★`.sw2-ew-window` 那一行必须是"宽 ＋ 上限"两格齐全的写法（取不到 ⇒ 下面两条是空绿）');
    assert.equal(Number(m[1]), Math.round(820 * 1.2), '★宽度必须正好是 820 × 1.2 = 984（用户说的"百分之20"）');
    assert.ok(Number(m[2]) > 86 && Number(m[2]) < 100,
        `★高度上限要在"更大"与"不占满整屏"之间（现为 ${m[2]}%）——100% 就是用户嫌过的"几乎占了整个屏幕"`);
});

test('leg140·⑧：★空态**分两种写法**（主体格写明为什么 · 次要格一句人话）——已拍板口径', () => {
    const bare = renderEntityWindowHtml(fixture(), 'e_bk_1');       // 全空样本
    // 主体格：他做的 / 涉及到他的 / 变过的格 / 在办 —— 要答"为什么没有"
    // ★★★leg198 翻案（社区反馈第 3 条）：旧文案是「账上还没有他做过的事——这本书里没写他在做什么，
    //   这一局也还没轮到他。」——**后半句是假话**（真相常常是"正文里有，但这一轮没有标签 ⇒ 没记下来"）。
    //   ⇒ 新文案如实说，并指向那一枚开关。
    assert.match(bare, /账上还没有他做过的事——正文里的事，要等标签点到他才记得下来/, '★"他做的"空要说清是哪一种空');
    assert.match(bare, /账上没记着这个实体的格变过/, '★变过的格空要说清为什么');
    assert.match(bare, /眼下没有在办的谋划/, '★在办空要说清为什么');
    assert.match(bare, /还没有别人做的事牵到他/, '★"涉及到他的"空要说清为什么');
    // 次要格：关系 —— 一句人话就够（★leg141b：它现在读**整张网**，空态口径随之改）
    assert.match(bare, /账上他还没跟谁连上/, '★关系空一句人话');
    // ★不许拿占位值凑（红线 2）。
    //   ★本条第一版把破折号 `——` 也一起禁了 ⇒ **当场红，而错的是尺子**：那几句里它是**正常的中文标点**
    //     （"账上还没有他的事迹——这本书里没写他在做什么…"），不是占位值。
    //     ⇒ 收窄成"**真的占位词**"：空态里不许出现这些词。
    for (const bad of ['暂无数据', 'N/A', '待补', '（无）']) {
        assert.ok(!bare.includes(bad), `★空态不许用占位词「${bad}」凑数`);
    }
    // 反过来钉一头：空态**必须**是"说了为什么"的整句，不许只剩一个符号或一个词
    const empties = [...bare.matchAll(/<div class="sw2-ew-empty">([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
    assert.ok(empties.length >= 5, `全空样本至少要交出 5 处空态（实际 ${empties.length}）`);
    for (const t of empties) {
        assert.ok(t.length >= 8, `★空态必须是"说清了为什么"的一句话，不许是一枚符号或一个词：${JSON.stringify(t)}`);
        assert.ok(!/^[—\-–—\s]+$/.test(t), `★空态不许是一根横杠：${JSON.stringify(t)}`);
    }
});

test('leg140·⑨：★实体不在账上 ⇒ 如实说，不抛、不白屏（那一行可能是换世界之前的旧行）', () => {
    const html = renderEntityWindowHtml(fixture(), 'e_gone');
    assert.match(html, /账上没有这个实体/, '★要如实说，不许静默空白');
    assert.match(html, /e_gone/, '把那个 id 印出来（不然维护者不知道是哪一行）');
    assert.ok(html.length > 200, '不许白屏');
    assert.doesNotThrow(() => renderEntityWindowHtml(null, 'x'));
    assert.doesNotThrow(() => renderEntityWindowHtml(fixture(), null));
});

test('leg140·⑩：名字/属性里的尖括号必须转义（渲染层的老账，别再犯）', () => {
    const html = renderEntityWindowHtml(fixture(), 'e_xss');
    assert.ok(!html.includes('<img src=x'), '★裸标签不许进产物');
    assert.ok(html.includes('&lt;img src=x'), '要转义成实体');
});

test('leg140·⑪：玩家那一枚要标出来（`context.playerId` 指谁就是谁），且只标一个', () => {
    const w = fixture();
    const mine = renderEntityWindowHtml(w, 'e_p1');
    assert.match(mine, /你 · 玩家棋子/, '★玩家要标出来（不然玩家分不清哪个是自己）');
    const other = renderEntityWindowHtml(w, 'e_bk_429');
    assert.ok(!other.includes('你 · 玩家棋子'), '别人不许被标成玩家');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ③ 窗口那一半：假 DOM 真开真关（三条关闭路径都走一遍）
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝═══════════════════════════════

/** 极简假 DOM：只 stub 本模块用到的那几口（createElement / body / getElementById / 事件）。
 *  ★两处第一版写错、被本判据当场咬出来的地方（留档防下一棒再写错）：
 *    ① `remove()` 必须**从父节点的 children 里摘掉自己**——只置一个 `_removed` 标志的话，
 *       "连点两个实体只许留一份遮罩"那条会数出两份（**假 DOM 的错，不是产品代码的错**）；
 *    ② `querySelector` 必须返回**一个真会记录监听的元素**——返回空桩的话，
 *       "✕ 自己挂上了 click 没有"那条永远看不到监听（同样是夹具的错）。
 *    ⇒ 教训与 leg89 那条一致：**假 DOM 写歪了，判据会红在错的地方**——先分清是谁的错，再改。 */
function fakeDoc() {
    const byId = new Map();
    const listeners = [];
    const mk = (tag) => {
        const el = {
            tagName: tag, id: '', className: '', innerHTML: '', children: [], _lis: [], _parent: null, _removed: false,
            appendChild(c) {
                c._parent = this;
                this.children.push(c);
                if (c.id) byId.set(c.id, c);
                return c;
            },
            remove() {
                this._removed = true;
                if (this.id) byId.delete(this.id);
                if (this._parent) {
                    const i = this._parent.children.indexOf(this);
                    if (i >= 0) this._parent.children.splice(i, 1);
                    this._parent = null;
                }
            },
            addEventListener(t, f) { this._lis.push([t, f]); },
            querySelector(sel) {
                // 只认本模块会问的那一个选择器（够用即可，不假装是个真 DOM）
                if (sel === '.sw2-ew-close') return (this._closeStub = this._closeStub || mk('div'));
                return null;
            },
        };
        return el;
    };
    const body = mk('body');
    const doc = {
        body,
        createElement: mk,
        getElementById: (id) => byId.get(id) || null,
        addEventListener(t, f, cap) { listeners.push([t, f, cap]); },
        removeEventListener(t, f, cap) { const i = listeners.findIndex((l) => l[0] === t && l[1] === f); if (i >= 0) listeners.splice(i, 1); },
        _listeners: listeners,
    };
    return doc;
}

test('leg140·⑫：★真开一次——遮罩挂到 body 上、id 对、内容是那个实体（假 DOM 真跑）', () => {
    const doc = fakeDoc();
    const hub = createEntityWindowHub({ getWorld: () => fixture(), doc });
    assert.equal(hub.isOpen(), false, '起手必须是关着的');
    assert.equal(hub.open('e_bk_429'), true, '开成功要交 true');
    assert.equal(hub.isOpen(), true);
    const mask = doc.getElementById(ENTITY_WINDOW_MASK_ID);
    assert.ok(mask, `★遮罩必须挂在 body 上且 id = ${ENTITY_WINDOW_MASK_ID}（链浮层那条先例）`);
    assert.ok(doc.body.children.includes(mask), '★必须真挂进 body');
    assert.match(mask.className, /sw2-window-mask/, '★壳复用面板那套（不另造窗口系统）');
    assert.match(mask.className, /sw2-ew-mask/, '★要带自己的那枚（它只负责把 z-index 抬到面板之上）');
    assert.match(mask.children[0].innerHTML, /白狐·雪姬/, '窗口里要是被点的那一位');
    assert.match(mask.children[0].innerHTML, /青丘国/, '内容真渲染出来了');
});

test('leg140·⑬：★连点两个实体 ⇒ 换内容，不留两份（遮罩只许有一个）', () => {
    const doc = fakeDoc();
    const hub = createEntityWindowHub({ getWorld: () => fixture(), doc });
    hub.open('e_bk_429');
    hub.open('e_p1');
    assert.equal(doc.body.children.filter((c) => c.id === ENTITY_WINDOW_MASK_ID).length, 1, '★同时只许有一份遮罩');
    assert.match(doc.getElementById(ENTITY_WINDOW_MASK_ID).children[0].innerHTML, /黄坤/);
});

test('leg140·⑭：★三条关闭路径一处收口——点暗处 / Esc（捕获阶段）/ ✕', () => {
    const doc = fakeDoc();
    const hub = createEntityWindowHub({ getWorld: () => fixture(), doc });

    // ⓵ 点**窗口外的暗处**关掉；点窗口内部**不关**（不然想看细处一点就没了）
    hub.open('e_p1');
    let mask = doc.getElementById(ENTITY_WINDOW_MASK_ID);
    const click = mask._lis.find((l) => l[0] === 'click')[1];
    click({ target: mask.children[0] });          // 点在窗口上
    assert.equal(hub.isOpen(), true, '★点窗口内部不许关（这是"想看细处一点就没了"那个病）');
    click({ target: mask });                      // 点在暗处
    assert.equal(hub.isOpen(), false, '★点暗处要关');

    // ⓶ Esc：**捕获阶段**且 `stopPropagation`（面板自己也有一条"Esc 关整个窗口"，不拦会一起关掉）
    hub.open('e_p1');
    const esc = doc._listeners.find((l) => l[0] === 'keydown');
    assert.ok(esc, '★Esc 那条监听必须挂上');
    assert.equal(esc[2], true, '★必须在**捕获阶段**（照链浮层那条留档）');
    let stopped = false;
    esc[1]({ key: 'Escape', stopPropagation() { stopped = true; }, preventDefault() {} });
    assert.equal(stopped, true, '★必须 stopPropagation（否则面板会被一起关掉）');
    assert.equal(hub.isOpen(), false, '★Esc 要关掉窗口');
    assert.equal(doc._listeners.filter((l) => l[0] === 'keydown').length, 0, '★关掉之后 Esc 那条监听必须摘掉（不许留着）');

    // ⓷ ✕（窗口里那枚）——浮层挂 body，够不到面板的动作总线 ⇒ 必须自己收
    hub.open('e_p1');
    mask = doc.getElementById(ENTITY_WINDOW_MASK_ID);
    const closeBtn = mask.children[0]._closeStub?._lis.find((l) => l[0] === 'click');
    assert.ok(closeBtn, '★✕ 必须自己挂上 click（面板总线够不到 document.body 上的浮层）');
    closeBtn[1]();
    assert.equal(hub.isOpen(), false, '★✕ 要关掉窗口');
});

test('leg140·⑮：世界不在 ⇒ 如实说、不抛；`getWorld` 必须是函数（传成值当场拦下）', () => {
    const doc = fakeDoc();
    const said = [];
    const hub = createEntityWindowHub({ getWorld: () => null, setStatus: (s) => said.push(s), doc });
    assert.equal(hub.open('e_p1'), false, '没世界 ⇒ 开不成');
    assert.match(said.join('|'), /还没有世界/, '★要如实出声（不许静默什么都没发生）');
    assert.throws(() => createEntityWindowHub({ getWorld: null }), /getWorld/, '★传成值必须当场拦下（本仓"第二份真相"那条）');
});

test('leg140·⑯：★世界对象是**现取**的——不是建 hub 那一刻抓死的（换世界之后要看新账）', () => {
    const doc = fakeDoc();
    let cur = fixture();
    const hub = createEntityWindowHub({ getWorld: () => cur, doc });
    hub.open('e_p1');
    assert.match(doc.getElementById(ENTITY_WINDOW_MASK_ID).children[0].innerHTML, /黄坤/);
    // 换一份账：把黄坤改名 ⇒ 再开必须是新的那一份
    const w2 = fixture();
    w2.entities.find((e) => e.id === 'e_p1').name = '换了名字的人';
    cur = w2;
    hub.open('e_p1');
    assert.match(doc.getElementById(ENTITY_WINDOW_MASK_ID).children[0].innerHTML, /换了名字的人/, '★必须读调用那一刻的世界，不是建 hub 那一刻的');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝═════════════════════════════════════════════════
// ④ 接线那一半：**真的接上了没有**（本仓四次"点了没反应"全在这条链上）
// ＝＝＝＝＝＝＝════════════════════════════════════════════════════════════════════

test('leg140·⑰：★实体行真的可点（`src/render.js` 给行打了 `data-action="ent-open"` 与实体 id）', () => {
    const src = read('src/render.js');
    assert.match(src, /class="sw2-entity-row\$\{hot\}" data-action="ent-open" data-who="\$\{attrText\(e\.id\)\}"/,
        '★行的开标签上必须真有这两个属性（这是"点了有反应"的唯一入口）');
    // ★行里那枚「查」不许被吃掉：动作路由取 `closest('[data-action]')`，从按钮出发先命中按钮自己
    assert.match(src, /data-action="lookup-entity"/, '★行内「查」必须还在（它走自己的动作）');
    // ★★本笔撞过的一条（留档防下一棒改回去）：**行上那个属性名必须是 `data-who`，不许是 `data-entity`**——
    //   `test/render.test.js` 拿 `data-entity="<id>"` 当"**行内那枚「查」钮在不在**"的代理
    //   （"已定案的行不留查询钮"，真账 626 枚按钮的病根）。行上再挂同名属性 ⇒ 那个代理被污染，
    //   实测当场红。按 §2.2 第 4 条「改判据 = 改承重墙」⇒ 不动判据，改名字。
    assert.ok(!/class="sw2-entity-row[^"]*"[^>]*data-entity=/.test(src),
        '★行上不许挂 `data-entity`（那个名字被既有判据当"查钮在不在"的代理占着）');
    // 反向自证：把行标签写回旧样子 ⇒ 上面那条当场红（这里用"旧串不许再出现"钉住）
    assert.ok(!src.includes('<div class="sw2-entity-row${hot}">'), '★旧的行标签（没有 data-action）不许再出现');
});

test('leg140·⑱：★动作真挂上了总线（`web/index.js` 用常量注册，不是手写字符串）', () => {
    const src = read('web/index.js');
    assert.match(src, /import \{ createEntityWindowHub, ENTITY_WINDOW_ACTION \} from '\.\/entity-window\.js';/,
        '★要取回工厂与动作名两个口');
    assert.match(src, /bus\[ENTITY_WINDOW_ACTION\] = \(payload\) => \{ entityWindow\.open\(payload\?\.who\); \};/,
        '★动作必须真注册到总线上（用常量，不许手写一遍字符串——那是第二份真相）');
    assert.match(src, /const entityWindow = createEntityWindowHub\(\{/, '★hub 必须真建出来');
    assert.match(src, /getWorld: \(\) => sw2LastWorld \|\| readHotMeta\(\)\?\.world \|\| null/, '★世界必须现取（与 renderCfg 同一口径）');
    // 反向自证：不许出现"手写动作名"的第二份（常量那份才是唯一口径）
    assert.ok(!/bus\['ent-open'\]/.test(src), "★不许手写 bus['ent-open']（要用 ENTITY_WINDOW_ACTION）");
});

test('leg140·⑲：★样式表里那一族规则真在（且 `.sw2-entity-row` 基础规则没被写第二遍）', () => {
    const css = read('web/style.css');
    for (const sel of ['.sw2-window-mask.sw2-ew-mask{', '.sw2-ew-body{', '.sw2-ew-kv{', '.sw2-ew-deed{', '.sw2-ew-empty{']) {
        assert.ok(css.includes(sel), `★样式表里少了 ${sel}`);
    }
    assert.match(css, /\.sw2-window-mask\.sw2-ew-mask\{z-index:51000;\}/,
        '★z-index 必须抬到面板（50000）之上——取 51000，与链浮层同一把尺');
    // ★本仓那条硬纪律：`.sw2-entity-row` 基础规则**只许声明一次**（判据在 render.test.js，这里再钉一遍防本笔踩它）
    const decls = [...css.matchAll(/(^|\n)\.sw2-entity-row(\s*\{)/g)];
    assert.equal(decls.length, 1, `★\`.sw2-entity-row\` 基础规则只许一条（实际 ${decls.length} 条）`);
    assert.ok(css.includes('.sw2-entity-row[data-action]{cursor:pointer;}'),
        '★可点的手型只给"真带动作的那一行"（leg104 那条"假可点"的教训：不给没有动作的元素上手型）');
});

// ＝＝＝＝＝＝＝════════════════════════════════════════════════════════════════════
// ⑤ ★★★本笔真机上栽的那一条（用户报「点击不了，没有窗口弹出」）——留档在这里，别再犯
// ＝＝＝＝＝＝＝════════════════════════════════════════════════════════════════════
//
// 病：`open()` 把遮罩的 `className` 写成 `'sw2-window-mask sw2-ew-mask'`，**漏了 `sw2-open`**。
//   而 `web/style.css` 里 `.sw2-window-mask{…display:none…}`、只有 `.sw2-window-mask.sw2-open{display:flex}`
//   ⇒ 窗口**真被创建、真挂进 `document.body`、内容真渲染了**，但**是 `display:none` 的**：
//     玩家看到的是"点了没反应"，而且**一个字都不报错**。
//
// ★为什么前面那 19 条判据一条都没咬住（本笔最该带走的一条）：
//   · ⑫ 只断言了 `className` 含 `sw2-window-mask` 与 `sw2-ew-mask` —— **从没断言"打开态"那个类**；
//   · `isOpen()` 查的是"元素在不在 DOM 里" —— 在，所以它一直说"开着"；
//   · **假 DOM 没有 CSS** ⇒ 样式表说什么，判据一个字都不知道。
//   ⇒ 教训：**"元素建出来了"不等于"人看得见"**。凡"可见性由样式表决定"的窗口/浮层，
//     判据必须**同时**咬住"那个类"与"样式表里那个类的含义"（下面这条就是照这个写的）。
//
// ★★还有一条更值得记的：**展示页（`docs/spec-entity-window-mockup.html`）偏偏是对的**——
//   它的 JS 里写了 `mask.classList.add('sw2-open')`。**样板跑通了不等于生产接线跑通了**，
//   这正是上一次交接里"最值钱的那一条"（判据写对了 ≠ 生产接线对了），本笔当场又踩了一遍。
test('leg140·⑳：★★★打开之后窗口必须**真看得见**——遮罩要带 `sw2-open`（本笔真机上栽的就是这一条）', () => {
    const css = read('web/style.css');
    // ★前置两条：把"为什么必须是这个类"钉进判据（取不到 ⇒ 下面那条就是空绿）。
    //   本仓那条纪律：判据要咬住**机理**，不是咬住一个字符串。
    assert.match(css, /\.sw2-window-mask\{[^}]*display:none/,
        '前置：`.sw2-window-mask` 默认必须是 `display:none`（这就是"不带 sw2-open 就隐形"的机理）');
    assert.match(css, /\.sw2-window-mask\.sw2-open\{[^}]*display:flex/,
        '前置：打开态是靠 `.sw2-open` 切成 `display:flex` 的');
    // ★★真跑：开一次，看那枚遮罩到底带不带"打开态"那个类。
    const doc = fakeDoc();
    const hub = createEntityWindowHub({ getWorld: () => fixture(), doc });
    hub.open('e_p1');
    const mask = doc.getElementById(ENTITY_WINDOW_MASK_ID);
    const cls = String(mask.className).split(/\s+/);
    assert.ok(cls.includes('sw2-open'),
        `★★★打开之后遮罩**必须**带 \`sw2-open\` —— 否则按样式表它是 \`display:none\`：`
        + `窗口真挂在 DOM 上、内容真渲染了，但**一个字都看不见，而且不报任何错**。`
        + `（leg140 真机上就是这个病：用户点实体行"没反应"。）实际 className=${mask.className}`);
    // 反向：关掉之后那枚元素要**真从 DOM 撤掉**（不是只把类去掉、留个空壳）
    hub.close();
    assert.equal(doc.getElementById(ENTITY_WINDOW_MASK_ID), null, '★关掉之后遮罩必须真从 DOM 撤掉');
});

// ══════════════════════════════════════════════════════════════════════════════
// ⑥ ★★★leg141b（用户当场两问：「**势力的麾下怎么点击窗口不显示**」＋
//   「**关系网包括了势力与势力和势力与角色没？**」）：两刀 ——
//   ①**反向看**（谁归我管 = 麾下）②**层级并进那张网**（所属/分支/机构也是边）。
//   ★两刀其实是一件事的两面：**层级本来就住在 `parent`/`branches`/`organs` 里**，
//     而旧窗口只从"下级那一侧"印、且关系格只读 `relations` 表
//     ⇒ 点一个势力，麾下看不见、关系格也是空的。
// ══════════════════════════════════════════════════════════════════════════════

test('leg141b·㊱：★★★势力的**麾下**必须印出来（反向看）——这是用户当场问的那一格', () => {
    const w = fixture();
    w.entities.push({ id: 'e_m1', kind: 'character', name: '青丘长老', location: '未明', parent: '青丘国' });
    w.entities.push({ id: 'e_m2', kind: 'character', name: '阿狸', location: '未明', parent: '青丘国' });
    const f = { id: 'e_f1', kind: 'faction', name: '青丘国', location: '未明', branches: ['青丘旁支'] };
    w.entities.push(f);
    // ① 取数口：**借的是 `memberEntitiesOf`**（与面板「麾下：」同一把尺子），不另写一份
    //   ★序是**码点序**（`白`U+767D < `阿`U+963F < `青`U+9752），**不是拼音序**——
    //     那正是既有那把尺子的口径（"名号序、确定性"，leg25 b 立的）；本判据照它写，
    //     ★**第一版我按拼音写成「青丘长老/阿狸/白狐·雪姬」⇒ 当场红，错的是尺子不是代码**。
    const crew = networkOf(w, f).filter((x) => x.label === '麾下').map((x) => x.other);
    assert.deepEqual(crew, ['白狐·雪姬', '阿狸', '青丘长老'], `★麾下要全量印出来（码点序，与面板同一把尺）：${crew.join('/')}`);
    // ② 产物里真有那几行，而且**不是**"等 N 人"那种截断写法（窗口是全量；面板那一行才截 8 个）
    const html = renderEntityWindowHtml(w, 'e_f1');
    assert.ok(html.includes('麾下'), '★★势力那一页必须有「麾下」（用户点开势力看不见的就是它）');
    for (const n of ['青丘长老', '阿狸', '白狐·雪姬']) assert.ok(html.includes(n), `★麾下成员要印出来：${n}`);
    assert.ok(!html.includes('等3人'), '★窗口是**全量**，不许用面板那一行的"等 N 人"截断写法');
    // ③ **可点**：认得到实体的行要挂 `data-who`
    assert.match(html, /<b data-who="e_m1" title="点一下看这个人">青丘长老<\/b>/, '★★麾下那一行必须可点');
});

test('leg141b·㊲：★★层级**并进那张网**——所属/分支/机构都是边，而且"怎么来的"没丢', () => {
    const w = fixture();
    const net = networkOf(w, w.entities.find((e) => e.id === 'e_bk_429'));
    const par = net.find((x) => x.label === '所属');
    assert.ok(par, '★`parent` 是一条边（所属）');
    assert.equal(par.other, '青丘国', '★对方名照印');
    assert.equal(par.tail, '结构推导 · 成员行@青丘国',
        '★★leg25 g 立的"怎么来的"**一个字没丢**——它跟着「所属」那条边搬过来了');
    // 分支 / 机构
    const w2 = fixture();
    w2.entities.push({ id: 'e_f2', kind: 'faction', name: '大虞', location: '未明', branches: ['界渊长城'], organs: ['须弥界域'] });
    const l2 = networkOf(w2, w2.entities.find((e) => e.id === 'e_f2')).map((x) => `${x.label}:${x.other}`);
    assert.ok(l2.includes('分支:界渊长城'), '★`branches` 是一条边（分支）');
    assert.ok(l2.includes('机构:须弥界域'), '★`organs` 是一条边（机构）');
    // ★★一个事实只有一个家：层级**不许**被写进 `relations` 表（那是"同一个号两处写"）
    const before = JSON.stringify(w2.relations ?? null);
    renderEntityWindowHtml(w2, 'e_f2');
    assert.equal(JSON.stringify(w2.relations ?? null), before, '★★取数口不许改账（层级只是被"当边读"）');
    assert.equal(Object.prototype.hasOwnProperty.call(w2, 'relations'), false, '★更不许凭空建 relations 键');
});

test('leg141b·㊳：★★归属那三行**从「来历与身份」搬走**了（一个事实不许印两遍）', () => {
    const w = fixture();
    const html = renderEntityWindowHtml(w, 'e_bk_429');
    assert.ok(originOf(w.entities.find((e) => e.id === 'e_bk_429')), '前置：这一位确实有归属（否则下面两条是空绿）');
    const kv = /<dl class="sw2-ew-kv">([\s\S]*?)<\/dl>/.exec(html);
    assert.ok(kv, '前置：来历与身份那一段要在');
    for (const t of ['所属', '分支', '机构']) {
        assert.ok(!kv[1].includes(`<dt>${t}</dt>`), `★★「${t}」已搬进关系格，不许在「来历与身份」里再印一遍`);
    }
    assert.ok(html.includes('青丘国'), '★归属在关系格里照旧印得出来（搬走了，不是删了）');
    assert.ok(!html.includes('不是书里明写的名字，是从别处推出来的'), '★那条注解已随归属搬走（原文案不再出现）');
    assert.ok(html.includes('结构推导'), '★但"怎么来的"这个信息本身还在（在所属那条边上）');
});

test('leg141b·㊴：★认不到实体的名字**照样印**、只是不可点（如实，不藏）', () => {
    const w = fixture();
    w.entities.push({ id: 'e_f9', kind: 'faction', name: '某势力', location: '未明', parent: '书里提过但没入池的上级' });
    const html = renderEntityWindowHtml(w, 'e_f9');
    assert.ok(html.includes('书里提过但没入池的上级'), '★认不到也要印出来（书里写着，不许因为点不动就藏起来）');
    assert.match(html, /<b class="sw2-ew-netoff">书里提过但没入池的上级<\/b>/, '★它是**不可点**的那种（没有 data-who）');
    assert.ok(!/data-who="undefined"/.test(html), '★不许挂一个 undefined 的 id 上去');
});

test('leg141b·㊵：★点麾下那个名字 ⇒ 换到那一页（同一个窗口，不新开第二扇）', () => {
    const doc = fakeDoc();
    const w = fixture();
    w.entities.push({ id: 'e_m1', kind: 'character', name: '青丘长老', location: '未明', parent: '青丘国' });
    w.entities.push({ id: 'e_f1', kind: 'faction', name: '青丘国', location: '未明' });
    const hub = createEntityWindowHub({ getWorld: () => w, doc });
    hub.open('e_f1');
    const box = doc.getElementById(ENTITY_WINDOW_MASK_ID).children[0];
    const click = box._lis.find((l) => l[0] === 'click');
    assert.ok(click, '★关系格必须挂上委托 click（不然麾下那些名字点了没反应）');
    // 真点一下那个可点的名字（★假 DOM 没有 `closest` ⇒ 传一个带 `closest` 的 target；
    //   产品代码用的是 `closest?.`，所以真浏览器与假 DOM 都走得通）
    click[1]({ target: { closest: (sel) => (sel === '[data-who]' ? { getAttribute: () => 'e_m1' } : null) } });
    const mask = doc.getElementById(ENTITY_WINDOW_MASK_ID);
    assert.equal(doc.body.children.filter((c) => c.id === ENTITY_WINDOW_MASK_ID).length, 1,
        '★同时只许有一份遮罩（换页不是开新窗）');
    assert.match(mask.children[0].innerHTML, /青丘长老/, '★换到了那一页');
    // 反向：点到没有 data-who 的地方 ⇒ 什么都不做（不许白开一次）
    const before = mask.children[0].innerHTML;
    click[1]({ target: { closest: () => null } });
    assert.equal(doc.getElementById(ENTITY_WINDOW_MASK_ID).children[0].innerHTML, before, '★点空白处不换页');
});

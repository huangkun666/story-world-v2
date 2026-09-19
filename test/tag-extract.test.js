// story-world-v2/test/tag-extract.test.js
// ★★★leg89 判据：**带标签正文 → 正则提取**（设计 `docs/spec-tagged-actions-extraction.md` §11 那张单子）。
// 口径来源（用户原话，逐条可查）：
//   · 「正则提取聊天llm输出的各角色的行动（包括主角）内容」
//   · 「累加吧」（多次 `【时长】` = 时间继续往后走）
//   · 「角色的行动全都注入（先别管那个 name 集…）」
//   · 「让插件模拟器按世界逻辑演下去就好了」
// ★每条判据都写"它防的是什么病"——本仓的规矩：判据锁**还对不对**，不只锁"在不在"。
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, hasTagFacts, tagReadoutLine, TAG_FIELD_SEP } from '../src/tag-extract.js';
import { buildEvolutionPack } from '../src/pack.js';
import { tagSpecText, rosterText, buildInjections, createInjector, INJECT_KEY_TAGS } from '../web/inject.js';
import { sw2LatestMessageText, sw2ShouldAdvance, sw2ToggleInject } from '../web/index.js';
import { runTick } from '../src/tick.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ★世界动向那条通道的**写端**要用真跑一次 tick 才验得到 ⇒ 起一个最小世界 + 假 transport。
const mkWorld = () => ({
    version: 1,
    context: { world: '测试', positions: ['未明', '临渊城'], playerId: null },
    entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '临渊城', status: 'active' }],
    weights: { e_a: 0.5 },
    agendas: [], events: [], milestones: [],
    chronicle: [],
    meta: { tick: 3, simLog: [], warnings: [], entityFields: {} },
});
const STEP = {
    actions: [], newEvents: [{ title: '甲夺了渡口', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] }],
    agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
};

const ENTITIES = [
    { id: 'e_xue', name: '薛铁衣', aliases: ['铁衣'] },
    { id: 'e_po', name: '孟婆', aliases: [] },
    { id: 'e_p1', name: '黄坤', aliases: ['坤哥'] },
];
const LOCATIONS = ['未明', '忘川渡口', '孟婆庄'];
const CTX = { entities: ENTITIES, locations: LOCATIONS, playerId: 'e_p1', maxActions: 12 };

const FULL = [
    '【时长】三天',
    '【场景：忘川渡口】',
    '【行动】薛铁衣｜迎战｜黄坤',
    '【行动】孟婆｜探查｜灵脉',
    '',
    '【时长】一炷香',
    '【场景：孟婆庄】',
    '【行动】黄坤｜搜刮｜阴阳玉',
].join('\n');

// ── §11①　四族正则命中全部形状 ────────────────────────────────────────────────
test('leg89①：四族正则命中——三格／两格／少对象／全角冒号／半角冒号／块外行动', () => {
    const f = extractTags(FULL, CTX);
    assert.equal(f.actions.length, 2, '非主角的两条进 actions');
    assert.equal(f.actions[0].actorId, 'e_xue');
    assert.equal(f.actions[0].verb, '迎战', '★动词**原样保留**（不做词表归一：新口径没有词表）');
    assert.equal(f.actions[0].targetId, 'e_p1', '对象按名号归一（这里是主角⇒仍归一到 id）');
    assert.equal(f.actions[0].targetText, '黄坤', '原文照留（归不上也不丢那句话）');
    assert.equal(f.actions[1].targetId, null, '★"灵脉"不在册 ⇒ targetId 为 null（**不凭空造实体**）');
    assert.equal(f.actions[1].targetText, '灵脉', '★但对不上账的原文要留着（不静默丢）');

    // 两格（缺对象）与半角冒号 —— 模型真会这么写
    const f2 = extractTags('【场景: 忘川渡口】\n【行动】孟婆｜探查', CTX);
    assert.equal(f2.actions.length, 1);
    assert.equal(f2.actions[0].targetText, null, '两格 ⇒ 没有对象');
    assert.equal(f2.actions[0].location, '忘川渡口', '★半角冒号的场景同样认（模型两个都会写）');

    // 块外行动：地点算空（不是"在上一处"）
    const f3 = extractTags('【行动】孟婆｜探查', CTX);
    assert.equal(f3.actions[0].location, null, '★没有场景头的行动 ⇒ 地点空着（不猜、不继承上一处）');
});

// ── §11②　时长累加（★不做算术） ───────────────────────────────────────────────
test('leg89②：多次【时长】**累加且不做算术**——并列递过去，绝不换成小时数', () => {
    const f = extractTags(FULL, CTX);
    assert.deepEqual(f.elapsedParts, ['三天', '一炷香'], '按出现序收集');
    assert.equal(f.elapsed, '三天；一炷香', '★并列成一段散文');
    // ★这条是"编数"红线的判据：谁把它算成 72 小时，这条当场红。
    assert.ok(!/\d/.test(f.elapsed), '★不许出现数字（不做换算＝不编数）');
});

// ── §11③　场景继承 ───────────────────────────────────────────────────────────
test('leg89③：场景继承——行动的地点 = 上面最近的【场景：…】；场景在表外则原样留文本并标 derived=false', () => {
    const f = extractTags(FULL, CTX);
    assert.equal(f.actions[0].location, '忘川渡口');
    assert.equal(f.actions[0].locationDerived, true, '场景在册 ⇒ derived');
    const f2 = extractTags('【场景：书里没写的地方】\n【行动】孟婆｜探查', CTX);
    assert.equal(f2.actions[0].location, '书里没写的地方', '★表外地名照留（位置不是闸，本仓 leg33c 同口径）');
    assert.equal(f2.actions[0].locationDerived, false, '★但要如实标"这不是账上的地名"');
});

// ── §11④　归不上的名字：不进包、不造实体、如实报数 ────────────────────────────
test('leg89④：归不上的主语——**不进包、绝不新建实体**，只进 unresolved 如实报数', () => {
    const f = extractTags('【场景：忘川渡口】\n【行动】船夫｜划船\n【行动】船夫｜靠岸\n【行动】孟婆｜探查', CTX);
    assert.equal(f.actions.length, 1, '两条"船夫"都不进包');
    assert.deepEqual(f.unresolved, [{ name: '船夫', n: 2 }], '★同一个名字只报一次（带条数）');
    assert.equal(f.parsed, 3, '★parsed 数的是**正文里解析出的行动条数**（含归不上名字的、含主角的）');
    // 别名归一：写"铁衣"也要认出来（实测过"小娥 ≠ 白小娥"那类坑）
    const alias = extractTags('【行动】铁衣｜迎战', CTX);
    assert.equal(alias.actions[0].actorId, 'e_xue', '★别名必须归一到同一个 id');
    const alias2 = extractTags('【行动】坤哥｜拔剑', CTX);
    assert.equal(alias2.player?.verb, '拔剑', '★主角的别名同样认（认不出主角＝主角那一条会丢）');
});

// ── §11④b　读数行：两笔"丢了"各说各的（不混成一笔账） ────────────────────────
test('leg89④b：读数行把"入包/截断/归不上"分开报（★丢了什么必须看得见）', () => {
    // 15 条解析出、12 条入包 ⇒ 印"15 条（入包 12）"
    const many = Array.from({ length: 15 }, (_, i) => `【行动】孟婆｜动作${i}`).join('\n');
    const line = tagReadoutLine(extractTags(many, { ...CTX, maxActions: 12 }));
    assert.ok(line.includes('15 条') && line.includes('入包 12'), `★截断必须报出来：${line}`);
    // 空输入 ⇒ 不该有读数行（不许印一行全 0 的假自证）
    assert.equal(tagReadoutLine(extractTags('', CTX)), null);
});

// ── §11④c　★端到端实测抓出来的真毛病：三格写法不许丢事 ───────────────────────
test('leg89④c：模型把四格写成三格时，主语取哪一格**由"认不认得出来"决定**（不许丢事）', () => {
    // 病（本笔端到端实测）：模型写「谁｜做了什么｜针对谁」而插件按"两格=无对象"读
    //   ⇒ 把**动词当成主语** ⇒ 归不上 ⇒ **整条行动静默丢掉**（这一轮发生的事少一件，而读数只报"归不上"）。
    const swapped = extractTags('【行动】薛铁衣｜迎战｜黄坤', CTX);
    assert.equal(swapped.actions.length, 1, '★三格写法不许被丢');
    assert.equal(swapped.actions[0].actorId, 'e_xue', '★主语要认得出（不许把"迎战"当主语）');
    assert.equal(swapped.actions[0].verb, '迎战');
    assert.equal(swapped.actions[0].targetId, 'e_p1');
    assert.equal(swapped.unresolved.length, 0, '★读对了就不该有"归不上"的噪声');
    // 反向（防过度修正）：规范读法**认得出来**时，第三个字段就是对象——哪怕它对不上账
    const normal = extractTags('【行动】薛铁衣｜迎战｜船夫', CTX);
    assert.equal(normal.actions[0].actorId, 'e_xue');
    assert.equal(normal.actions[0].targetText, '船夫', '★三格读法只是兜底，不许抢走正常读法');
});


test('leg89⑤：主角那条**绝不进 actions**，只占 playerMove 槽；多条只入账 1 条且如实报数', () => {
    const f = extractTags(FULL, CTX);
    assert.ok(!f.actions.some((a) => a.actorId === 'e_p1'), '★★主角不许出现在 actions 里（check-step 会让玩家出手 ⇒ 拒整步）');
    assert.equal(f.player.verb, '搜刮');
    assert.equal(f.player.targetText, '阴阳玉');
    assert.equal(f.player.location, '孟婆庄');
    const many = extractTags('【行动】黄坤｜拔剑\n【行动】黄坤｜格挡', CTX);
    assert.equal(many.player.verb, '拔剑', 'playerMove 是单事实形状（契约 v1）⇒ 取第一条');
    assert.equal(many.playerDropped, 1, '★丢了 1 条要**报出来**（不静默）');
});

// ── §11⑥⑦⑧　动词／形状不合／封顶 ────────────────────────────────────────────
test('leg89⑥⑦⑧：动词原样保留 · 形状不合留痕 · 封顶可见', () => {
    // ⑥ 表外动词原样保留（"拔剑冲阵"不许被写成"迎战"）
    const v = extractTags('【行动】孟婆｜拔剑冲阵', CTX);
    assert.equal(v.actions[0].verb, '拔剑冲阵', '★不归一、不降级');
    const noVerb = extractTags('【行动】孟婆', CTX);
    assert.equal(noVerb.actions.length, 1, '★连动词都没有也仍是"某人做了一件事"这条事实');
    assert.equal(noVerb.actions[0].verb, null);

    // ⑦ 形状不合的行要留痕（不静默吞）
    const bad = extractTags('【行动】\n【时长】\n【场景】\n孟婆走过来，看了他一眼。', CTX);
    assert.equal(bad.actions.length, 0);
    assert.equal(bad.malformed.length, 3, '★空标签三行都留痕（第四行是正文，不算形状问题）');

    // ⑧ 封顶：parsed > count 必须可见
    const many = Array.from({ length: 15 }, (_, i) => `【行动】孟婆｜动作${i}`).join('\n');
    const capped = extractTags(many, { ...CTX, maxActions: 12 });
    assert.equal(capped.count, 12);
    assert.equal(capped.parsed, 15, '★截断必须能被算出来（15 条解析出、12 条入包）');
});

// ── §11⑨　空输入与"值不值得进包" ─────────────────────────────────────────────
test('leg89⑨：没标签 ⇒ 键不出现（没标签的老聊天逐字节回到今天）', () => {
    const none = extractTags('孟婆走过来，看了他一眼。', CTX);
    assert.equal(hasTagFacts(none), false, '★纯正文 ⇒ 没有标签事实');
    assert.equal(tagReadoutLine(none), null, '★连读数行都不该有（不许印一行全 0 的假自证）');
    // 没标签的正文进包 ⇒ **不许有 turnFacts 这个键**（否则每个老聊天白背一段空壳）
    const world = { entities: ENTITIES, agendas: [], events: [], chronicle: [], context: { positions: LOCATIONS }, meta: {} };
    const pack = buildEvolutionPack(world, null);
    assert.equal('turnFacts' in pack.pack, false, '★★空着就是空着：不挂键');
    // 有标签 ⇒ 键在，且**缀在末尾**（lens.test.js 那条键序锁要求"只做加法"）
    const withFacts = buildEvolutionPack(world, null, { turnFacts: { actions: [], count: 0, parsed: 0 } });
    const keys = Object.keys(withFacts.pack);
    assert.equal(keys[keys.length - 1], 'turnFacts', '★新键必须缀在最末（中间插键会动到既有的键序锁）');
});

// ── §11⑩⑪　注入面：关掉即零注入；纯函数可逐字锁 ─────────────────────────────
test('leg89⑩：注入面——三个开关**全关 ⇒ 一次都不注入**（关掉即恢复原样）', () => {
    const calls = [];
    const fakeCtx = {
        setExtensionPrompt: (...a) => calls.push(a),
        extension_prompt_types: { IN_CHAT: 1 },
    };
    const inj = createInjector({ getCtx: () => fakeCtx, getWorld: () => ({ entities: ENTITIES }), isOn: () => false });
    const r = inj.apply();
    assert.equal(r.off, true, '全关 ⇒ 走"关"这条分支');
    assert.equal(calls.filter((c) => c[1]).length, 0, '★★没有任何一段非空内容被写进去');
    assert.ok(String(r.line).includes('已关'), '★如实说"已关"（不是静默，也不是假装注入成功）');

    // 取不到注入口 ⇒ **如实降级报一次**，不假装成功
    const said = [];
    const noApi = createInjector({ getCtx: () => ({}), getWorld: () => ({ entities: ENTITIES }), isOn: () => true, setStatus: (s) => said.push(s) });
    const r2 = noApi.apply();
    assert.equal(r2.ok, false, '拿不到接口 ⇒ ok:false（不假装成功）');
    assert.equal(said.length, 1, '★只吵一次（别每轮刷屏）');
    assert.ok(String(r2.line).includes('跳过'), r2.line);
});

test('★★★leg90c：注入位置必须是 `IN_PROMPT`——`IN_CHAT` 会被 ST 整段丢掉（模型永远收不到）', () => {
    // ★真因（用户：「**上下文我好像都没看见注入**」）：
    //   leg89 拍的位置是 `IN_CHAT`（=1，"贴着最后一条消息"），而 ST 的 chat completion 组装阶段
    //   （`public/scripts/openai.js`）第 1345 行是：
    //       if (![BEFORE_PROMPT, IN_PROMPT].includes(prompt.position)) continue;
    //   ⇒ **`IN_CHAT` 的扩展提示词根本不进 prompt**；`getPromptPosition` 也只认 BEFORE_PROMPT(2)→'start'
    //     与 IN_PROMPT(0)→'end'，其余一律返回 false。
    //   ★为什么 leg89 的判据没咬住：它们只断言"`setExtensionPrompt` 被调了、内容非空"——
    //     那是"写进了 ST 的字典"，**不等于"进了发给模型的 prompt"**。这条判据锁的是**位置值本身**。
    const calls = [];
    const fakeCtx = {
        setExtensionPrompt: (...a) => calls.push(a),
        // ★两个常量都给（照真 ST 给全）——免得"取不到就退回字面量"的分支掩盖了位置写错
        extension_prompt_types: { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 },
    };
    const inj = createInjector({ getCtx: () => fakeCtx, getWorld: () => ({ entities: ENTITIES }), isOn: () => true });
    const r = inj.apply();
    assert.equal(r.ok, true, r.line);
    assert.ok(calls.length >= 2, '两段都写了');
    for (const c of calls) {
        // 签名：setExtensionPrompt(key, value, position, depth, scan, role)
        assert.equal(c[2], 0, `★position 必须是 IN_PROMPT(0)，实测 ${c[2]}`
            + `（★IN_CHAT(1) 会被 openai.js:1345 丢掉 ⇒ 模型永远收不到这段）`);
        assert.notEqual(c[2], 1, '★`IN_CHAT` 绝不许回潮——它是"读数看着注入了、模型啥也没收到"的根因');
        assert.equal(c[4], false, 'scan 保持 false（我们不走世界书扫描那条路）');
        assert.equal(c[5], 0, 'role = SYSTEM(0)');
    }
    assert.ok(String(r.line).includes('position=0'), '★读数要明写位置（这一段到底进不进 prompt 就看它）');
});

test('★★★leg92：总闸关着时**注入也必须生效**（世界不推 ≠ 不注入）——以及"没跑"与"注入 0 字"要分得开', () => {
    // ★真缺陷（用户报：「开关写着 `injectTagSpec:"1"`、构建号是新的、`sw2_` **一个都没有**」）：
    //   三处叠在一起 ——
    //   ① `initPanel` 里 `sw2Injector.apply()` 跑在 `loadWorld()` **之前** ⇒ 那一刻 `sw2LastWorld` 是 null；
    //   ② 名册/世界动向都需要世界账 ⇒ 那一次算出来两段都空 ⇒ 写进去的是空串（`clear()` 更会把 key **删掉**）；
    //   ③ 重设注入只挂在"世界推完一轮"（`async-tick.js:57` 的 `refresh` **只在演算成功后才跑**）
    //      ⇒ **总闸关着时世界永远不推 ⇒ 再也没有第二次机会**，账上就永远是"没有 sw2_ 注入"。
    //   ⇒ 判据两半：**（甲）世界没到也必须把"不需要世界的"那段注进去**；
    //             **（乙）"没跑过"与"跑了但 0 字"必须在读数里长得不一样**（否则排查没有方向）。
    const calls = [];
    const store = {};
    const fakeCtx = {
        setExtensionPrompt: (k, v, ...rest) => { calls.push([k, v, ...rest]); store[k] = v; },
        extension_prompt_types: { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 },
    };
    // 甲：**只开格式指令**，且**世界为 null**（模拟"装配时世界还没进内存"）
    const inj = createInjector({ getCtx: () => fakeCtx, getWorld: () => null, isOn: (k) => k === 'injectTagSpec' });
    const r = inj.apply();
    const tagsCall = calls.filter((c) => c[0] === INJECT_KEY_TAGS).pop();
    assert.ok(tagsCall, '格式指令那段必须被写（它不依赖世界账）');
    assert.ok(String(tagsCall[1]).length > 100, `★★世界没到也要注入格式指令（实测 ${String(tagsCall[1]).length} 字）`);
    assert.ok(String(tagsCall[1]).includes('必须用标签标出'), '★注进去的是真规范，不是空串');
    // ★★这一条才是用户那个症状的正面判据：**字典里真留下了这个 key，且非空**
    //   （他报的是"一个 `sw2_` 都没有"——所以判据必须看**最终留下的值**，不是"调用发生过"）。
    assert.ok(String(store[INJECT_KEY_TAGS] || '').length > 100,
        `★★世界没到也必须留下非空的 sw2_tags（实测 ${String(store[INJECT_KEY_TAGS] || '').length} 字）——`
        + '用户报的"一个 sw2_ 都没有"就是这一格空了/被 clear() 删了');
    assert.equal(r.tagsChars > 0, true, '读数要如实报注入了多少字');
    // 乙：跑过的证据必须存在且能区分三种状态
    assert.equal(r.runs.count, 1, '跑过几次要记账');
    assert.equal(r.runs.lastOff, false, '这次不是"全关"');
    assert.equal(r.runs.lastChars > 0, true, '这次真注入了字');
    // 全关 ⇒ 明确记成"全关"（不是"注入 0 字"）
    const off = createInjector({ getCtx: () => fakeCtx, getWorld: () => null, isOn: () => false }).apply();
    assert.equal(off.runs.lastOff, true, '★全关要记成 lastOff（与"开了但 0 字"分得开）');
    assert.ok(String(off.line).includes('已关'), off.line);
    // ★接线面（源码级锁 · 照本仓 leg55 那条"接线层也要锁"的先例）：
    //   注入的重设点必须在 **`refreshWorld`（世界进内存之后）** 里 —— 它覆盖首载/切聊天/切世界/推一轮。
    //   只锁"存在"不够：`setupAsyncTicks` 里那次 `apply()` 也在同一个文件里，**必须锁在 refreshWorld 体内**。
    const src = readFileSync(new URL('../web/index.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('function refreshWorld'), src.indexOf('function refreshWorld') + 3000);
    assert.ok(body.includes('sw2Injector?.apply()'),
        '★`refreshWorld` 体内必须重设注入（世界进内存之后那一次——用户报的真缺陷就是缺它）');
    const atWorld = body.indexOf('sw2LastWorld = world');
    const atApply = body.indexOf('sw2Injector?.apply()');
    assert.ok(atWorld >= 0 && atApply > atWorld,
        '★顺序：先 `sw2LastWorld = world`（世界到位）再 `apply()`（否则名册仍取不到）');
});

test('leg89⑪：标签规范与名册是**纯函数**（逐字锁得住，且不吃 DOM）', () => {    const spec = tagSpecText();
    // 规范必须教会模型三族标签，并且把"全角竖线｜"与"四格"讲清楚（正则全靠它）
    for (const must of ['【时长】', '【场景：', '【行动】', TAG_FIELD_SEP, '主角']) {
        assert.ok(spec.includes(must), `★规范里必须出现「${must}」（缺一样模型就写不出可提取的标签）`);
    }
    const roster = rosterText({ entities: ENTITIES });
    assert.ok(roster.includes('薛铁衣') && roster.includes('铁衣'), '★名册要带别名（否则模型写别名插件认不出）');
    assert.ok(!roster.includes('e_xue'), '★不许把引擎 id 递给聊天模型（它不是世界模型那一侧）');
    const both = buildInjections({ entities: ENTITIES }, { spec: true, roster: true });
    assert.ok(both.tags.includes('【行动】') && both.tags.includes('薛铁衣'), '两段合成一条注入');
    assert.equal(both.world, '', '★世界动向默认关（开了剧情会围着账本转）');
    assert.equal(buildInjections({ entities: ENTITIES }, { spec: false, roster: false }).tags, '', '两段都关 ⇒ 空串');
    // ★leg90：**第三格（针对谁）也要"有就写、没就不写"**（用户令）——注入给聊天模型的规范里必须写明，
    //   因为插件这一侧的 `【行动】谁｜做了什么｜针对谁` 全靠模型把它写出来；模型不写，世界模型那一侧
    //   就永远只看到动词、看不到对象（用户实机之问：接引谁？）。
    assert.ok(spec.includes('知道就写、不知道就不写'), '★规范要教"对象有就写、没就不写"');
    assert.ok(spec.includes('不要为了凑格式编一个名字'), '★反向：不许为凑格式编对象');
    // ★★★leg90 第二次改（用户实机取证：注入**真到了**、模型就是不写）：
    //   真机读数 `sw2_tags | position=1 depth=1 role=0 | 475字 | 锚点=true` ⇒ 注入有效、问题在措辞软。
    //   病：原话是「**请**用标签标出」+ 末尾「标签只是给插件读的路标…**不要为了标签改变你的文风**」
    //   ⇒ 模型在读起来像"可选建议"的句子面前选择不写。⇒ 整段改成**硬要求**（必须 + 不写的后果 + 自检）。
    //   ★为什么这条是判据而不是文案喜好：它锁的正是"上面那个病不许回潮"（软措辞一回来，功能就静默失效）。
    assert.ok(spec.includes('必须用标签标出'), '★必须是硬要求（用户实机证明"请"字软措辞模型不照做）');
    assert.ok(!spec.includes('本回合请用标签标出'), '★旧的软措辞（"请"）不得回潮——它正是模型不写的因');
    assert.ok(spec.includes('这一轮白跑'), '★要写明**不写的后果**（否则模型把它当可选建议）');
    assert.ok(spec.includes('写完之后自己数一遍'), '★要给模型一个可执行的**自检**动作');
    assert.ok(spec.includes('没有这个块 = 这一轮没达标'), '★自检要有明确的合格判据');
    assert.ok(spec.includes('这个块必须有'), '★收尾再钉一次（与"文风自由"并存，但块是硬要求）');
    // ★★★leg93（用户裁示「**就甲吧**」）：规范必须把"**块**"讲到不可能误解——
    //   提取器从此**只扫块里**（`shellRange`），块外一律当正文。规范若不说清，模型不包块 ⇒
    //   退回逐行扫（老行为，见下面那条降级判据）⇒ 用户问的那个病**照旧**。
    assert.ok(spec.includes('```tags'), '★规范必须给出块的开围栏原文（模型照抄的那个形状）');
    assert.ok(spec.includes('一个标签占一整行'), '★必须写明"一个标签一行"（行首不许有杂物，否则整行丢）');
    assert.ok(spec.includes('只有这个块里面的标签插件才看'), '★必须写明"只认块里的"（这是甲案的边界本身）');
});

// ── §11⑭　★别名的真源在**书**里（用户拍板「认得出就按插件的正名来看」） ──────────
test('leg89⑭：书名录里的别名要认得出来，且**正名优先**（正名不许被别名盖掉）', () => {
    // 病（本笔实核）：账上实体**不带别名**——播种只拷 id/kind/name/location/parent/实力…
    //   别名留在 `context.setting.frozen.canon.bookEntities`（抽书时用来合重的那份）。
    //   ⇒ 别名那一档不喂它，就是死的（模型写"小娥"永远归不上）。
    const canon = [
        { name: '白小娥', aliases: ['小娥', '娥儿'] },
        { name: '小娥', aliases: [] },              // ★书里真有一条正名就叫"小娥" ⇒ 它必须赢
        { name: '黄坤', aliases: ['坤哥'] },
    ];
    const ctx = { ...CTX, canon };
    // ① 别名 → 认得出来，账上仍写**正名那个 id**
    //   ★夹具校正（第一版写错了，判据当场咬住）：要让"埃儿"指到账上的 `e_po`，
    //     书里那条正名必须**就是账上的正名**（账上那条叫「孟婆」）——否则它指向的是"账上还没有的人"。
    const canon2 = [
        { name: '孟婆', aliases: ['孟婆汤', '婆子'] },
        // ★夹具纪律（第一版把"黄坤"写成 `e_p1`，被咬住）：书里凡**账上真有的人**，正名必须与账上一致
        //   ——否则它指向的是"账上还没有的人"，别名自然也不该认得出。
        { name: '黄坤', aliases: ['坤哥'] },
        { name: '白小娥', aliases: ['小娥'] },      // ★「小娥」只是别人的别名（书里没有它自己的条目）
    ];
    const ctx2 = { ...CTX, canon: canon2 };
    const byAlias = extractTags('【行动】婆子｜搜刮', ctx2);
    assert.equal(byAlias.actions.length, 1, '★别名要认得出来（否则这一条会被当"归不上"丢掉）');
    assert.equal(byAlias.actions[0].actorId, 'e_po', '★认出来要落到**账上那个实体的 id**（正名 = 孟婆 = e_po）');
    assert.equal(byAlias.unresolved.length, 0);
    // ② ★别名照认：主角的别名也要认得出（认不出主角 ⇒ 主角那条会掉进 NPC 那堆里）
    const playerAlias = extractTags('【行动】坤哥｜拔剑', ctx2);
    assert.equal(playerAlias.player?.verb, '拔剑', '★主角的别名同样要认（正名 = 黄坤 = e_p1）');
    assert.equal(playerAlias.actions.length, 0, '认出来是主角 ⇒ 不许进 actions 那堆');
    // ②b ★正名优先（本判据的核心）：书里**另有一条正名就叫「小娥」**时，它不许被
    //    「白小娥的别名」抢走 —— 抢走的后果是**把动作记到另一个人头上**（比丢掉更坏）。
    //   ⚠这条只能断言"没被记给白小娥"：账上本来就没有「白小娥」这个人（CTX 里只有薛铁衣/孟婆/黄坤），
    //     所以正确结果是**不进 actions**，而是进 notNoted（名字留着、事留着，只是没入账）。
    const collide = extractTags('【行动】小娥｜传讯｜孟婆', {
        ...CTX,
        canon: [{ name: '白小娥', aliases: ['小娥'] }, { name: '小娥', aliases: [] }],
    });
    assert.equal(collide.actions.length, 0, '★「小娥」自己是一条正名 ⇒ 不许记成白小娥的别名');
    assert.deepEqual(collide.unresolved, [{ name: '小娥', n: 1 }], '如实报数，不猜');
    assert.equal(collide.notNoted[0].name, '小娥', '★但这条行动要留着（见 ⑯）');
    // ③ 别名指向的人**在账上（已是主角）** ⇒ 认得出，且**只走 playerMove**（承重墙同样适用于别名）
    const playerByAlias = extractTags('【行动】坤哥｜拔剑｜孟婆', ctx2);
    assert.equal(playerByAlias.player?.verb, '拔剑', '★别名认出主角 ⇒ 走主角槽');
    assert.equal(playerByAlias.actions.length, 0, '★认出来是主角 ⇒ 绝不许进 actions');
    assert.equal(playerByAlias.unresolved.length, 0);
    // ④ 不传 canon ⇒ 别名那一档是死的（如实报数）——★但**行动仍然不丢**（只进 notNoted）
    const noCanon = extractTags('【行动】婆子｜搜刮｜阴阳玉', CTX);
    assert.deepEqual(noCanon.unresolved, [{ name: '婆子', n: 1 }], '没喂书名录 ⇒ 认不出别名（如实报数）');
    assert.equal(noCanon.actions.length, 0, '不进"账上实体的行动"那一栏');
});

// ── §11⑯　★★不在名册上的人：**行动不许丢**（用户：「就算不在名册上也给插件模型看到啊？？」） ──
test('leg89⑯：不在名册上的人——**不造人、不进账，但行动必须原样递下去**', () => {
    // 病（本笔第一版做错了，用户当场指出）：主语查不到就 `continue` ⇒ 这条行动**彻底消失**，
    //   世界模型只知道"有个名字归不上"，**不知道他干了什么** ⇒ "这个人该不该入局"永远没证据。
    const f = extractTags('【场景：忘川渡口】\n【行动】船夫｜划船｜孟婆\n【行动】船夫｜靠岸\n【行动】孟婆｜探查', CTX);
    // ① 账上的那条照常
    assert.equal(f.actions.length, 1, '账上的人照常进 actions');
    assert.equal(f.actions[0].actorId, 'e_po');
    // ② ★不在名册上的人：名字 + **做过的事**都要在
    assert.deepEqual(f.unresolved, [{ name: '船夫', n: 2 }], '报数（两个人各一条）');
    const nn = f.notNoted.find((x) => x.name === '船夫');
    assert.ok(nn, '★★不在名册上的人必须出现在 notNoted 里（不许只报个名字）');
    assert.deepEqual(nn.did, ['划船｜孟婆', '靠岸'], '★★他做过的事要原样留着（这才是"该不该让他入局"的证据）');
    // ③ ★绝不造人（`entities` 是只读的入参，抽完不该多出任何东西）
    assert.equal(f.actions.some((a) => a.actorId === null), false, '★notNoted 里的人不许混进 actions（那会让世界模型以为他们在账上）');
    // ④ 读数行要说实话：这些人**没入账，但已经递下去了**（不许写成"丢了"或"入账了"）
    const line = tagReadoutLine(f);
    assert.ok(line.includes('不在名册') && line.includes('已递给世界模型'), `★读数行措辞要如实：${line}`);
    // ⑤ 进了包：turnFacts 里必须有 notNoted（否则"递下去"是假的）
    const world = { entities: ENTITIES, agendas: [], events: [], chronicle: [], context: { positions: LOCATIONS }, meta: {} };
    assert.equal('turnFacts' in buildEvolutionPack(world, null).pack, false);
});

// ── §11⑰　★名册不封顶（用户：「120个角色上顶没必要啊」） ─────────────────────
test('leg89⑰：注入的名册**不封顶**——砍掉名字 = 自己制造"认不出"', () => {
    // 病：原设计把名册砍到 120 个。后果是**账上真有的人**排在 120 名之外时，
    //   模型写了他也认不出 ⇒ 变成"不在名册"，而那是插件自己砍出来的。
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `e_${i}`, name: `角色${i}`, location: 'x', status: 'active' }));
    const t = rosterText({ entities: many, context: {} });
    assert.ok(t.includes('角色0') && t.includes('角色399'), '★第 399 个也必须列出来（不封顶）');
    assert.ok(!t.includes('未列出'), '★没有"另有 N 位未列出"这种话（那说明还在砍）');
    // 账上真有的名字，注入之后必须**认得出**（这才是"名册够用"的判据）
    const all = extractTags('【行动】角色399｜探查', { entities: many, locations: [], playerId: null });
    assert.equal(all.actions.length, 1, '★列出来的名字必须真认得出（否则名册是白给的）');
    assert.equal(all.actions[0].actorId, 'e_399');
});

test('leg89⑮：注入的名号表要把**书里登记的别叫法**括出来（模型写哪个都认得出）', () => {
    const world = {
        entities: [{ id: 'e_po', name: '白小娥', location: 'x', status: 'active' }],
        context: { setting: { frozen: { canon: { bookEntities: [{ name: '白小娥', aliases: ['小娥', '娥儿'] }] } } } },
    };
    const t = rosterText(world);
    assert.ok(t.includes('白小娥'), '正名照列');
    assert.ok(t.includes('小娥') && t.includes('娥儿'), '★别叫法要括在后面（否则模型不知道该写哪个）');
    assert.ok(!t.includes('e_po'), '★不许把引擎 id 递给聊天模型');
    // 账上有、书里没有的名字照样列（世界模型后来入局的人，书里当然没有）
    const t2 = rosterText({ entities: [{ id: 'e_new', name: '游方剑客', location: 'x' }], context: {} });
    assert.ok(t2.includes('游方剑客'), '书里没有的名字也要列');
    // 状态过滤：已离场的不列（那与本仓"离场名册另走一路"的口径一致）
    const t3 = rosterText({ entities: [{ id: 'e_d', name: '死人', status: 'dead' }], context: {} });
    assert.equal(t3, '', '全是离场者 ⇒ 名册为空（不注入）');
    // ★★★leg89 更正：**地名要一起给**（第一版只给人名 ⇒ 规范里说"场景用名册里的地名"，自相矛盾）
    const t4 = rosterText({
        entities: [{ id: 'e_1', name: '甲', location: 'x' }],
        context: { positions: ['未明', '临渊城', '忘川渡口'] },
    });
    assert.ok(t4.includes('临渊城') && t4.includes('忘川渡口'), '★地名表必须一起注入（否则模型写的场景对不上账）');
    assert.ok(!t4.includes('未明'), '★占位词「未明」不列（它不是地名，列了会让模型照着写）');
});

// ── §11⑱　★★注入开关的**接线路**（用户实机「点了没反应」的那个坑，必须被咬住） ──────────
test('leg89⑱：注入开关走的是**按钮那条路**（唯一 click 入口直接收，不经 input/change）', () => {
    // 病（用户实机报的两次，本笔第一版与第二版各栽一次）：
    //   ① 挂 `data-settings-bool` 指望 `bindSettingsForm` 的 `input`/`change` 委托
    //      ——**按钮点击不派发 `input`/`change`** ⇒ 处理器一次都跑不到（状态栏一个字都没有）；
    //   ② 改走 `data-action` + 动作总线 ⇒ 切换**延迟到下一次刷新**才画出来
    //      （用户原话：「点了之后还要再点旁边的空白才会切换」）。
    // ⇒ 定案：**唯一点击入口**（`bindActions` 的 click 委托，与标签页/其它按钮同一条）
    //    + **纯 DOM 属性** `data-inject-switch`，直接调 `sw2ToggleInject()`。
    // 本判据读源码锁这条形状（按钮行为要真 DOM 才看得见，源码形状是唯一能锁的地方）：
    const root = path.resolve(import.meta.dirname, '..');
    const web = readFileSync(path.join(root, 'web', 'index.js'), 'utf8');
    const render = readFileSync(path.join(root, 'src', 'render.js'), 'utf8');
    assert.match(render, /data-inject-switch="\$\{escapeHtml\(key\)\}"/, '★按钮必须挂 data-inject-switch（键名就在它身上）');
    assert.ok(!/data-settings-bool"/.test(render), '★不许再出现 data-settings-bool（按钮收不到 input/change）');
    assert.ok(!/data-action="inject-toggle"/.test(render), '★也不再走动作总线（第二版那条路会延迟一拍）');
    // 唯一点击入口里必须**直接收**它（在 `closest('[data-action]')` **之前**）
    const clickAt = web.indexOf("win.addEventListener('click'");
    const swAt = web.indexOf("closest?.('[data-inject-switch]')");
    const actAt = web.indexOf("closest?.('[data-action]')", clickAt);
    assert.ok(clickAt > 0 && swAt > clickAt && actAt > swAt, '★它必须在唯一点击入口里、且排在 data-action 判据之前');
    assert.match(web, /sw2ToggleInject\(key, on\)/, '★收到之后必须真的调判据函数');
    // ★★★leg89（用户实机第四次仍报「点了不切、点别处才切」）⇒ 定案：**不重画整页，只原地改那一行**。
    //   为什么（这条路连着两版没走通）：整页重画要穿过本仓两道护栏（押后判据 + 重绘防重入），
    //   任何一道不合我意，画面就晚一拍；而"点别处才切"说明**另有东西本来就会把它画对**
    //   （`refreshWorld` 的整页刷新）⇒ 我这处整页重画纯属白等。
    //   原地改 DOM：不换整页、不夺焦点、不经过任何判据 ⇒ 没有任何"晚一拍"的空间。
    assert.match(web, /document\.querySelectorAll\(`\[data-inject-switch="\$\{key\}"\]`\)/, '★必须原地查那一行控件');
    assert.match(web, /label\.textContent = onText/, '★"开/关"那个字要当场改');
    assert.match(web, /classList\.toggle\('sw2-primary'/, '★按钮高亮要当场改');
    // ★那张"豁免押后"的通行证已撤（试过没用，只许在留档注释里出现，不许回到代码里）
    const codeOnly = web.replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/sw2SelfClickRedraw\s*=/.test(codeOnly), '★不许回潮到"豁免押后"那版（代码里不能再有它）');
});

test('leg89⑳：③世界动向 = **这一轮世界发生了什么**（读端；★这格原来是空的）', () => {
    // 病（用户当场骂出来的）：「**把这一轮世界发生了什么注入上下文啊**」——
    //   我第一版读 `world.meta.lastInjection`，而**全仓零处写它**（那段只在 demo 脚本里被打过）
    //   ⇒ 那个开关是个**死开关**：开了什么都不发生。
    const world = { entities: ENTITIES, context: { positions: LOCATIONS }, meta: { lastInjection: '◆ [第4轮] 薛铁衣夺了渡口' } };
    const off = buildInjections(world, { spec: false, roster: false, worldTide: false });
    assert.equal(off.world, '', '开关关着 ⇒ 一个字节都不注入');
    const on = buildInjections(world, { spec: false, roster: false, worldTide: true });
    assert.ok(on.world.includes('薛铁衣夺了渡口'), '★开了就要真把这一轮发生的事带进去');
    assert.ok(on.world.includes('已经发生的事'), '★必须标明"这是已经发生的事"（不是让它去写的剧本）');
    // 没有新发生的事 ⇒ 不许注入空壳，也不许拿上一轮的冒充
    const empty = buildInjections({ entities: ENTITIES, context: {}, meta: {} }, { spec: false, roster: false, worldTide: true });
    assert.equal(empty.world, '', '★账上没有"这一轮发生了什么" ⇒ 不注入（不许留个空标题）');
});

test('leg89㉑：③世界动向的**写端**——跑完一轮 tick，账上真的留下"这一轮发生了什么"（真跑）', async () => {
    // ★这条是"写读两端接上"的另一半：不真跑一次 tick，就没法证明那一格有人写。
    const transport = async () => ({ text: JSON.stringify(STEP) });
    const r = await runTick({ transport, ssot: mkWorld(), dialogue: '', extractCtx: {}, recall: false });
    assert.equal(r.ok, true, r.error);
    const tide = r.ssot.meta.lastInjection;
    assert.ok(typeof tide === 'string' && tide.length, '★结算完必须把"这一轮发生了什么"写进账（否则下一轮没得注入）');
    assert.ok(tide.includes('甲夺了渡口'), `★写的要是**这一轮的事**：${tide}`);
    assert.ok(!tide.includes('各归何处'), '★不许把位置聚合那段塞进来（那是给世界模型看的，会把聊天上下文灌爆）');
    // 读端拿到的就是它
    assert.ok(buildInjections(r.ssot, { spec: false, roster: false, worldTide: true }).world.includes('甲夺了渡口'));
    // ★没有新发生的事那一轮 ⇒ 清掉（不许上一轮的冒充本轮）
    const idle = await runTick({
        transport: async () => ({ text: JSON.stringify({ ...STEP, newEvents: [] }) }),
        ssot: r.ssot, dialogue: '', extractCtx: {}, recall: false,
    });
    assert.equal(idle.ok, true, idle.error);
    assert.equal('lastInjection' in (idle.ssot.meta || {}), false, '★这一轮没有新事 ⇒ 那一格要清掉（不许留旧的冒充新的）');
});

test('leg90㉒：③段**只注世界动向，不注引擎记账行**（用户实机第二次骂出来的）', async () => {
    // 病（用户原话）：「**这注入的是啥，直观吗？？？**」——leg89 第一版把**整条编年**拼进 `lastInjection`，
    //   而编年里混着**给面板链视图看的记账行**：「由处境而生：X 生「Y」」/「盘算「X」推进：…」/
    //   「盘算「X」满步结算：结清（期满收摊，终结产果 §4.4④）」/「事件「X」闭环（源盘算已结算）」。
    //   ⇒ 聊天模型读到的"世界动向"九成是账本措辞（且带 §4.4④ 这种内部编号）。
    // ★判据的**唯一口径**是本仓既有那条：`src/streams.js:71` 从 leg25 起只把带 `eventRef` 的编年行
    //   当"世界动向"（因果链上的节点）。这条判据锁的就是"两个注入口径不许分叉"。
    // ★为什么 leg89㉑ 没咬住它：那条夹具只有**一条事件**，编年里除事件外没有别的行 ⇒ 全量与过滤后**逐字相同**。
    const w = mkWorld();
    w.agendas = [{
        id: 'ag_1', owner: 'e_a', goal: '筹备物资前往大荒边缘遏制死煞瘟疫',
        stage: '筹备', visibility: 'known', maxSteps: 1, progress: 0, closed: false,
        memory: { promises: [], done: [], blocked: [], turnsAlive: 0 },
    }];
    const busy = {
        actions: [],
        newEvents: [{ title: '幽冥浊流冲击大虞帅府', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] }],
        agendaAdvances: [{ agendaId: 'ag_1', step: '医修退守核心医堡并开启护宗大阵' }],
        newAgendas: [{ entity: 'e_a', goal: '趁大荒动乱窃取大虞龙气', visibility: 'known', source: { type: 'state' } }],
        agendaCancels: [], newEntities: [], entityFates: [], entityUpdates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(busy) }), ssot: w, dialogue: '', extractCtx: {}, recall: false });
    assert.equal(r.ok, true, r.error);
    // 先自证"这一轮真的长出了记账行"——否则这条判据是空跑（假绿）
    const texts = (r.stage.chronicle || []).map((c) => c.text);
    assert.ok(texts.some((t) => !/^事件「/.test(t)), `★夹具必须真产出记账行，否则锁不住：${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => /^事件「/.test(t)), `★夹具必须真产出事件行：${JSON.stringify(texts)}`);
    const tide = r.ssot.meta.lastInjection;
    assert.ok(tide.includes('幽冥浊流冲击大虞帅府'), `★世界动向要在：${tide}`);
    for (const junk of ['满步结算', '终结产果', '§4.4④', '推进：', '由处境而生', '闭环（源盘算已结算）']) {
        assert.ok(!tide.includes(junk), `★记账行不许进聊天上下文（"${junk}"）：${tide}`);
    }
    // ★两个注入口径不许分叉：③段 = streams 那条既有口径的**同一批行**
    //   （leg90 续：③段改人话后**文本不再相同**，但"哪几行动进注入"必须是同一批
    //    —— 一行事件对一行"事件「…」…"，这是锁"两处不许各写一套"的可比口径）
    const streamRows = r.streams.injection.replace(/^【世界动向】/, '').split('；').filter(Boolean);
    const tideRows = tide.split('；').filter(Boolean);
    assert.equal(tideRows.length, streamRows.length,
        `★③段与 streams 的【世界动向】必须是同一批行：\n  ③段 ${tideRows.length} 行\n  streams ${streamRows.length} 行`);
    streamRows.forEach((t, i) => {
        const title = t.replace(/^事件「/, '').split('」')[0];
        assert.ok(tideRows[i].includes(title), `★第 ${i + 1} 行要对上同一个事件：「${title}」不在「${tideRows[i]}」里`);
    });
});

test('leg90㉓：③段要说**大白话**（内部词 `盘算` 不许进聊天上下文）', async () => {
    // 用户原话：「**换成大白话**」。病：`c.text` 里写着 `盘算「…」`，而 `盘算` 是**我们内部的词**
    //   （世界步的 agendas），聊天模型没有这个概念 ⇒ 读到只会把它当专有名词照抄进正文。
    //   ⇒ 改走 `tideLines()`：拿 `ssot.events` 按 eventRef 对上事件本体，用人话重述。
    const w = mkWorld();
    w.agendas = [{
        id: 'ag_1', owner: 'e_a', goal: '筹备物资前往大荒边缘遏制死煞瘟疫',
        stage: '筹备', visibility: 'known', maxSteps: 1, progress: 0, closed: false,
        memory: { promises: [], done: [], blocked: [], turnsAlive: 0 },
    }];
    const step = {
        actions: [],
        newEvents: [
            // plot 源（引在飞盘算）· state 源（无源引用）各一条
            { title: '万魔之祖完成初步接引', source: { type: 'plot', ref: 'ag_1' }, position: '大荒', ripples: ['e_a'] },
            { title: '幽冥浊流冲击大虞帅府', source: { type: 'state' }, position: '临渊城', ripples: ['e_a'] },
        ],
        agendaAdvances: [{ agendaId: 'ag_1', step: '医修退守' }],
        newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [], entityUpdates: [],
    };
    const r = await runTick({ transport: async () => ({ text: JSON.stringify(step) }), ssot: w, dialogue: '', extractCtx: {}, recall: false });
    assert.equal(r.ok, true, r.error);
    const tide = r.ssot.meta.lastInjection;
    // ① 内部词一个都不许出现
    for (const word of ['盘算', '编年', '结算', '盘算「']) {
        assert.ok(!tide.includes(word), `★「${word}」是内部词，不许进聊天上下文：${tide}`);
    }
    // ② 事件本身要在（不许为了"好读"把事实丢了）
    assert.ok(tide.includes('万魔之祖完成初步接引'), tide);
    assert.ok(tide.includes('幽冥浊流冲击大虞帅府'), tide);
    // ③ 因果与地点要用话讲出来（不是"由某源而生"）
    assert.ok(tide.includes('筹备物资前往大荒边缘遏制死煞瘟疫'), `★plot 源要把"因为哪件在办的事"讲出来：${tide}`);
    assert.ok(!tide.includes('由盘算'), tide);
    assert.ok(tide.includes('大荒') && tide.includes('临渊城'), `★地点要在：${tide}`);
    // ④ 名字要出名字（不是实体 id）
    assert.ok(tide.includes('甲') && !tide.includes('e_a'), `★牵涉的人要渲染成名号、不许露 id：${tide}`);
});

// ── §11㉔　★★★leg93：**标签块**（用户裁示「就甲吧」） ──────────────────────────
// 用户那一问（原话）：「**正文里有【…】呢？不能包裹在一个标签里吗？**」
// 实测（装置 `F:/deepseek/tmp/leg93-brackets-in-prose.mjs`，逐字喂真提取器）抓出来的两处**真会出事的**：
//   ① 正文里一句**以 `【行动】` 开头**的叙述（解说格式/举例子/被引用）⇒ 被当成**一条真行动**
//      （名字 = 整句话，落进 unresolved/notNoted）；
//   ② 正文里一句**以 `【时长】` 开头**的叙述 ⇒ `elapsed` **收下一整句话**
//      （实测「这个词表示时间流逝。」），而**引擎一个字都不校验这个值**，它原样进世界模型的 prompt。
// ★根因：认不认得出标签**全看 `【` 在不在行首**——正文与标签**共用同一个语法空间**。
// ⇒ 甲案：给标签一个**专属边界**（```tags 围栏块），**只扫块里**；块不在 ⇒ 退回逐行扫（老行为）。
const FENCE = '`'.repeat(3);

test('★★★leg93㉔：正文里的【行动】/【时长】不再被当成标签——**只认块里的**', () => {
    const prose = [
        '【行动】这两个字是插件要读的路标。',      // ← 病①：正文在解说格式
        '【时长】这个词表示时间流逝。',            // ← 病②：正文在解释词义
        `${FENCE}tags`,
        '【时长】半炷香',
        '【场景：忘川渡口】',
        '【行动】薛铁衣｜格挡防御｜黄坤',
        FENCE,
    ].join('\n');
    const f = extractTags(prose, CTX);
    assert.equal(f.shell.mode, 'shell', '★有块 ⇒ 走"只扫块里"');
    assert.deepEqual(f.unresolved, [], '★★块外那句「【行动】…」**一条都不许进**（这就是甲案要治的病①）');
    assert.deepEqual(f.notNoted, [], '★它也不许递下去（块外的是正文，不是行动）');
    assert.equal(f.elapsed, '半炷香', '★★块外那句「【时长】…」不许当成本轮时长（病②——垃圾会进世界模型的 prompt）');
    assert.equal(f.count, 1, '块里的那条行动照常入账');
    assert.equal(f.parsed, 1, '块外那句**不占** parsed（读数不许被污染）');
    // 块内的其它【…】同样不许被认（只认三族）
    const inside = extractTags([`${FENCE}tags`, '【系统提示】你已习得《九幽雷罡》。', '【行动】薛铁衣｜格挡防御｜黄坤', FENCE].join('\n'), CTX);
    assert.equal(inside.count, 1, '块里的【系统提示】不是三族 ⇒ 不看');
    assert.deepEqual(inside.unresolved, [], '★更不许把它当成一条行动');
});

test('★★★leg93㉔b：块不在 ⇒ **退回逐行扫**（老账、老聊天逐字节不变）', () => {
    // ★这条是甲案的**安全绳**：模型漏写围栏时不许"整轮零标签"（那比"少认几条"严重得多）。
    //   证据口径：与 leg89 的夹具**同一段文本**，块在/块不在，抽出来的东西必须**一模一样**。
    const bare = FULL;
    const wrapped = `${FENCE}tags\n${FULL}\n${FENCE}`;
    const a = extractTags(bare, CTX);
    const b = extractTags(wrapped, CTX);
    assert.equal(a.shell.mode, 'all', '★没块 ⇒ mode=all（老行为）');
    assert.equal(a.shell.found, false);
    assert.equal(b.shell.mode, 'shell');
    assert.deepEqual(b.actions, a.actions, '★★包块与不包块抽出来的 actions **逐字段相同**（甲案不许改变正常路径的结果）');
    assert.deepEqual(b.elapsedParts, a.elapsedParts);
    assert.deepEqual(b.locations, a.locations);
    assert.equal(b.count, a.count);
});

test('★★★leg93㉔c：块没闭合 ⇒ 吃到文末，标签照样读出来（模型忘收尾不许整轮白跑）', () => {
    const unclosed = [`${FENCE}tags`, '【时长】半炷香', '【行动】薛铁衣｜格挡防御｜黄坤'].join('\n');
    const f = extractTags(unclosed, CTX);
    assert.equal(f.shell.mode, 'shell', '开围栏在 ⇒ 仍然是"只扫块里"');
    assert.equal(f.shell.closed, false, '★如实标出"没闭合"（不许假装它闭合了）');
    assert.equal(f.count, 1, '★没闭合也要把标签读出来');
    assert.equal(f.elapsed, '半炷香');
    // 围栏行**必须整行只有它**才算开壳：` ```tags 后面跟字 ` 不算（否则正文里一句"用 ```tags 开头"就开了壳）
    const notAShell = [`${FENCE}tags 这是说明`, '【行动】薛铁衣｜格挡防御｜黄坤'].join('\n');
    const g = extractTags(notAShell, CTX);
    assert.equal(g.shell.mode, 'all', '★围栏行不干净 ⇒ 不算开壳，退回逐行扫');
    assert.equal(g.count, 1);
});

test('★★★leg93㉔d：空块 vs 块外真标签——边界生效（块空着就一个都不认）', () => {
    // ★这是甲案的**代价面**，必须锁住让维护者看得见：模型的标签若写在块外，就是**不认**。
    //   它由注入规范那条硬要求（`tagSpecText`）兜——所以这条与规范判据是一对，缺一不可。
    const f = extractTags([`${FENCE}tags`, FENCE, '【行动】薛铁衣｜格挡防御｜黄坤'].join('\n'), CTX);
    assert.equal(f.shell.mode, 'shell');
    assert.equal(f.count, 0, '★块空着 ⇒ 块外那条标签不认（边界就是这么定的）');
    assert.equal(hasTagFacts(f), false, '★空块 ⇒ 键不出现（照 `recalled` 那条口径）');
});

// ── 接线面的两条：读正文（现取/不猜）与"一输入一推进" ────────────────────────

test('leg89⑲：`sw2ToggleInject` 判据本体**真能跑**（关掉要说"已关"，打开要报注入字数）', () => {
    // 它做四件事：写盘 → 重设注入 → 重画设置页 → 状态条报真数。这里在 Node 里真调它，
    // 断言"没有注入口时**不许假装成功**"（`ok:false` + 明说跳过）——那是本仓"不印假话"的口径。
    const r1 = sw2ToggleInject('injectTagSpec', false);
    assert.equal(r1.ok, true, '关掉一定成功（关不需要注入口）');
    assert.equal(r1.on, false);
    assert.ok(r1.line.includes('已关闭'), r1.line);
    // 打开：Node 侧没有 ST 上下文 ⇒ 注入口取不到 ⇒ **如实降级**（不许报成功、不许抛错）
    const r2 = sw2ToggleInject('injectTagSpec', true);
    assert.equal(r2.on, true, '开关本身记下了');
    assert.equal(r2.ok, false, '★没有注入口 ⇒ 不许假装注入成功');
    assert.ok(r2.line.includes('⚠'), r2.line);
    assert.equal(sw2ToggleInject('', true).ok, false, '没有键名 ⇒ 拒绝（不猜）');
});
test('leg89⑫：读正文——取最后一条；拿不到就给空串（**不退回更早的消息**）', () => {
    assert.equal(sw2LatestMessageText({ chat: [{ mes: '上一条' }, { mes: '这一条' }] }), '这一条');
    assert.equal(sw2LatestMessageText({ chat: [] }), '', '空聊天 ⇒ 空串');
    assert.equal(sw2LatestMessageText({}), '', '没有 chat ⇒ 空串（不猜）');
    assert.equal(sw2LatestMessageText(null), '', 'null ⇒ 空串');
    assert.equal(sw2LatestMessageText({ chat: [{ mes: '旧' }, { mes: undefined }] }), '', '★最后一条不是文本 ⇒ 空串（绝不退回上一条冒充本轮）');
});

test('leg89⑬：一输入一推进——同一段正文只推一次（自动路与手动路共用这把尺子）', () => {
    // 第一次：推
    assert.equal(sw2ShouldAdvance('【行动】孟婆｜探查', null).go, true);
    // 同一条再来：**不推**（总闸开着时先自动推过一次，玩家再按「推进一轮」就是这一格）
    const again = sw2ShouldAdvance('【行动】孟婆｜探查', '【行动】孟婆｜探查');
    assert.equal(again.go, false);
    assert.equal(again.reason, 'same-message');
    // 新的一条：推
    assert.equal(sw2ShouldAdvance('【行动】薛铁衣｜迎战', '【行动】孟婆｜探查').go, true);
    // ★没有正文 ⇒ **照常推**（老行为就是零参推进；不许因为新功能把"手动补推"堵死）
    assert.equal(sw2ShouldAdvance('', null).go, true);
    assert.equal(sw2ShouldAdvance('', '上一轮那段').go, true, '★空正文不许被当成"同一条"而卡死推进');
});

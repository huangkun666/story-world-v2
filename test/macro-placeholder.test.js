// story-world-v2/test/macro-placeholder.test.js
// ★★★leg148：**酒馆的宏不该变成世界里的人。**
//
// 【病】（社区用户报的，2026-09-28）
//   世界书作者写 `{{user}}` 是惯例（那是"玩家"的占位符）。酒馆自己会在组装提示词时把它
//   换成人设名（`name1`）——**但那是酒馆的活儿，我们绕过了酒馆、直接读条目原文**
//   （`src/init-source.js` 的 `normalizeEntry`）。于是那个宏**原封不动**进了抽取提示词，
//   模型看见书里有个叫 `{{user}}` 的人，**忠实地把它抽成了一条角色**。
//
//   为什么它一路没被拦住（三道关口全是空的）：
//     ① **替换**：全仓搜 `{{user}}`/`{{char}}` ＝ 0 处 —— 我们从没替换过；
//     ② **契约**：`ssot.schema.js` 的名字那一格只有 `minLength:1` ⇒ `{{user}}` 是合法名字；
//     ③ **出处闸**：`{{user}}` **真在书里** ⇒ 放行（它拦"编造"，不拦"抄了宏"）。
//   而**认领玩家棋子**那把尺子只比名字相不相等（`web/index.js` 的 `namePlayerPiece`：
//   `e.name === nm`）⇒ 「{{user}}」与「怪璃」永远不相等 ⇒ 认领不了 ⇒ **这枚实体留在账上当棋手**。
//   ⇒ 账上变成"两个你"，世界模型每轮看到两枚棋子（与用户当年那句「又把主角演了」同一形状）。
//
// 【★这一族本仓认识，只是漏了一格】
//   `src/abstract.js:793` 早为「键名」写过一模一样的话：
//     「排除模型把整句话当键、或把 `{}`/`<>` 这类占位符当键
//       （占位符那一条与 §D 的 `<user>` 同族：**它真的在原文里，所以出处闸抓不住它**）」
//   ——**上次加在键名上，这次漏在实体名上**。本文件把那一格补上。
//
// 【口径】（照红线：空着就是空着）
//   · 宏**能换成真名就换**（人设名 / 角色名**已经在读**了：`web/index.js` 的 `getCtx()?.name1`）；
//   · **读不到真名 ⇒ 只挡、不猜**——绝不替它编一个名字。名字是纯占位符形状 ⇒ 这一项**不收**，
//     并留痕（照 `sanitizeCanon` 既有口径：坏项 push 进 `errors`，不静默吞）。

import test from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_RE, isMacroPlaceholder, substituteMacros, PLAYER_NAME_UNKNOWN } from '../src/macros.js';
import { composeInitSource } from '../src/init-source.js';
import { sanitizeCanon } from '../src/abstract.js';
import { spawnEntities } from '../src/settle.js';
import { normalizeMacroEntities } from '../web/world-entity-migration.js';

// ============ ① 形状闸：什么算"纯占位符"（纯函数，零依赖） ============

test('★形状闸：宏/占位符形状的名字一律认出（大小写与空格都算）', () => {
    for (const bad of [
        '{{user}}', '{{char}}', '{{ user }}', '{{USER}}', '{{User}}',
        '{{persona}}', '{{主角}}',
        '<user>', '<char>', '<USER>', '< bot >',
    ]) {
        assert.equal(isMacroPlaceholder(bad), true, `★「${bad}」应当被认出是占位符`);
    }
});

test('★形状闸：残缺的半截宏也挡（括号都不配对，只可能是抄坏了）', () => {
    for (const bad of ['{{user', 'user}}', '<user', 'user>', '{{}}', '<>']) {
        assert.equal(isMacroPlaceholder(bad), true, `★「${bad}」括号不配对／里面空的，应当挡住`);
    }
});

test('★★形状闸：平衡的括号夹在名字里 ⇒ 不挡（那是"含宏的文本"，不是"一个宏"）', () => {
    // ★口径边界：本仓不许凭形状把合法的书文判死——挡的是"它根本不是一个名字"，
    //   不是"它长得可疑"。`李{{user}}` 换名之后是 `李怪璃`，那是个可用的人名。
    for (const good of ['李{{user}}', '{{user}}的师父', '甲<乙>丙']) {
        assert.equal(isMacroPlaceholder(good), false, `★「${good}」是含宏的文本，不许被挡`);
    }
});

test('★形状闸：正常名字一个都不许误伤（这是它敢上岗的前提）', () => {
    for (const good of [
        '怪璃', '黄坤', '张辽', '万法阁', '大虞', '九宸玄陆',
        'user', 'User', 'char', 'ользователь', 'A',
        '李{{user}}',            // 混写的当名字用：**不是纯占位符** ⇒ 名字照收（只挡"整条都是宏"）
        '{{user}}的师父',        // 同上
        '第 3 章', 'Dark Elf',
    ]) {
        assert.equal(isMacroPlaceholder(good), false, `★「${good}」是正常名字，不许被挡`);
    }
});

test('★形状闸：空白/空值不冒充名字（空着就是空着，不报"这是宏"）', () => {
    for (const v of ['', '   ', null, undefined]) {
        assert.equal(isMacroPlaceholder(v), false, '★空值不是宏——它是"没有"，两件事别混');
    }
});

// ============ ② 替换：能换成真名就换 ============

test('★★替换：`{{user}}`/`{{char}}` 换成真名（大小写与空格都认）', () => {
    const out = substituteMacros('{{user}} 与 {{ char }} 在江州结怨，{{USER}} 记下了', {
        playerName: '怪璃', charName: '姬元真',
    });
    assert.equal(out, '怪璃 与 姬元真 在江州结怨，怪璃 记下了');
});

test('★★★读不到真名 ⇒ 一个字都不许猜（收成"没有名字"的记号，不是编一个）', () => {
    const out = substituteMacros('{{user}} 与 {{char}} 结怨', { playerName: '', charName: '' });
    assert.equal(out, `${PLAYER_NAME_UNKNOWN} 与 ${PLAYER_NAME_UNKNOWN} 结怨`);
    assert.ok(!/\{\{|<user>|<char>/i.test(out), '★替换之后不许再残留宏形状（否则模型照样抽它）');
    assert.ok(out.includes(PLAYER_NAME_UNKNOWN), '★要留下"这里本来是个玩家名，读不到"的记号');
});

test('★替换：没有宏的原文逐字节不动（旧世界/旧书零漂移）', () => {
    const s = '【九宸玄陆】大荒分五洲，人族与妖族各有其道。';
    assert.equal(substituteMacros(s, { playerName: '怪璃', charName: '姬元真' }), s);
});

test('★替换：宏正则不吃正常的花括号文本', () => {
    assert.equal(MACRO_RE.test('{"tags":"x"}'), false, '★JSON 那种花括号不是宏');
    assert.equal(MACRO_RE.test('{{user}}'), true);
});

// ============ ③ 源头：送进抽取的那份原文里，不许留着宏 ============

test('★★★源头（这一条就是社区用户报的那个 bug）：世界书里的 `{{user}}` 不许原样送进抽取', () => {
    const r = composeInitSource({
        character: { name: '姬元真' },
        worldInfoEntries: [
            { key: ['旧怨'], comment: '旧怨', content: '{{user}} 与姬元真有旧怨，{{char}} 心里清楚。' },
        ],
        macroNames: { playerName: '怪璃', charName: '姬元真' },
    });
    assert.equal(r.ok, true);
    assert.ok(!r.text.includes('{{user}}'), '★★★送进抽取的原文里不许留着 `{{user}}`（这就是那个 bug 的入口）');
    assert.ok(!r.text.includes('{{char}}'), '★★★`{{char}}` 同批');
    assert.ok(r.text.includes('怪璃'), '★换成了玩家真名');
    assert.ok(r.text.includes('姬元真'), '★换成了角色真名');
});

test('★★源头：读不到人设名 ⇒ 也只挡不猜（原文里不许留宏，也不许冒出一个假名）', () => {
    const r = composeInitSource({
        character: { name: '姬元真' },
        worldInfoEntries: [{ key: ['旧怨'], comment: '旧怨', content: '{{user}} 与姬元真有旧怨。' }],
        macroNames: { playerName: '', charName: '' },
    });
    assert.equal(r.ok, true);
    assert.ok(!r.text.includes('{{user}}'), '★照样不许留宏');
    assert.ok(!r.text.includes('怪璃'), '★没读到名字就不许冒出名字来');
});

test('★源头：不带宏的书，合订文本逐字节与今天相同（零漂移，旧世界不惊动）', () => {
    const book = [{ key: ['地理'], comment: '地理', content: '大荒分五洲。' }];
    const a = composeInitSource({ character: { name: '姬元真' }, worldInfoEntries: book });
    const b = composeInitSource({
        character: { name: '姬元真' }, worldInfoEntries: book,
        macroNames: { playerName: '怪璃', charName: '姬元真' },
    });
    assert.equal(a.text, b.text, '★没有宏 ⇒ 传不传名字都一个字节不差');
});

// ============ ④ 契约面：净化层不许让纯宏名进账 ============

test('★★★净化层：纯宏形状的名号不许入册（它真在原文里 ⇒ 出处闸抓不住它，只能在这里挡）', () => {
    const r = sanitizeCanon({
        bookEntities: [
            { name: '怪璃', kind: 'character' },
            { name: '{{user}}', kind: 'character' },
            { name: '<user>', kind: 'character' },
        ],
    }, { sourceText: '怪璃与{{user}}与<user>都在原文里' });
    const names = r.canon.bookEntities.map((b) => b.name);
    assert.deepEqual(names, ['怪璃'], '★只许留下真名，宏名一律不入册');
    assert.ok(r.errors.some((e) => e.includes('{{user}}') || e.includes('占位符')), '★挡下要留痕（不静默吞）');
});

test('★净化层：正常名字一个都不许被这条误伤', () => {
    const r = sanitizeCanon({
        bookEntities: [
            { name: '张辽', kind: 'character' },
            { name: 'user', kind: 'character' },       // 真有人叫这个名 ⇒ 不是宏，照收
            { name: '李{{user}}', kind: 'character' }, // 混写 ⇒ 名字照收
        ],
    }, { sourceText: '张辽 user 李{{user}}' });
    assert.deepEqual(r.canon.bookEntities.map((b) => b.name), ['张辽', 'user', '李{{user}}']);
});

test('★★★入局那道门：模型提议一枚叫 `{{user}}` 的实体 ⇒ 丢它，而且不建（同一条尺子）', () => {
    // 这一条治的是**第二条通路**：世界书只是入口之一，模型在游玩中也可能提一个宏名实体。
    // 入局那道门在 `settle.js` 的 `spawnEntities`（与册子那道门共用 `src/macros.js` 同一把尺子）。
    const w = { entities: [], agendas: [], events: [], context: { positions: ['江州'] }, meta: { tick: 3 } };
    const gstep = { newEntities: [{ name: '{{user}}', kind: 'character', location: '江州', source: { type: 'book' } }] };
    const warnings = [];
    const chronicle = [];
    spawnEntities(w, gstep, 3, warnings, chronicle);
    assert.equal(w.entities.length, 0, '★宏名实体不许入账（它是"没有名字"，不是一个人）');
    assert.ok(warnings.some((s) => s.includes('占位符')), '★丢它要留痕（不静默吞）');
    assert.equal(chronicle.length, 0, '★也不许为它落一行「入局」编年');
});

test('★入局那道门：正常新人照旧入局（证明上面那条没把门焊死）', () => {
    const w = { entities: [], agendas: [], events: [], context: { positions: ['江州'] }, meta: { tick: 3 } };
    const gstep = { newEntities: [{ name: '白小娥', kind: 'character', location: '江州', source: { type: 'book' } }] };
    const warnings = [];
    const chronicle = [];
    spawnEntities(w, gstep, 3, warnings, chronicle);
    assert.equal(w.entities.length, 1, '正常提议照旧入局');
    assert.equal(w.entities[0].name, '白小娥');
    assert.equal(chronicle.length, 1, '★照旧落一行「入局」编年（本笔没动这条）');
});

// ============ ⑤ 存量局：账上那枚"宏做的你"并回棋子 ============

test('★★★存量局：宏实体并进棋子——引用要一起搬（盘算主人 / 关系两端），不许留悬空指针', () => {
    const world = {
        context: { playerId: 'e_p1' },
        entities: [
            { id: 'e_p1', name: '怪璃', kind: 'character', location: '未明' },
            { id: 'e_5_1', name: '{{user}}', kind: 'character', location: '江州', aliases: ['阿璃'] },
            { id: 'e_2_1', name: '姬元真', kind: 'character' },
        ],
        agendas: [
            { id: 'a_1', owner: 'e_5_1', goal: '寻药', closed: false },
            { id: 'a_2', owner: 'e_2_1', goal: '闭关', closed: false },
        ],
        relations: [
            { id: 'rel_1', from: 'e_5_1', to: 'e_2_1', type: '旧怨' },
            { id: 'rel_2', from: 'e_2_1', to: 'e_5_1', type: '提防' },
        ],
    };
    const r = normalizeMacroEntities(world, { nameLower: '怪璃' });
    assert.equal(r.merged, 1, '★那枚 `{{user}}` 要被并掉');
    const w2 = r.ssot;
    assert.deepEqual(w2.entities.map((e) => e.id), ['e_p1', 'e_2_1'], '★账上只剩棋子和真人，不再有"另一个你"');
    assert.equal(w2.context.playerId, 'e_p1', '★棋子身份不变（命名归 namePlayerPiece，本函数不掺和）');
    assert.equal(w2.entities[0].name, '怪璃', '★★名字由人设那条规矩说了算——本函数**不许**把棋子改名成宏');
    assert.equal(w2.entities[0].location, '江州', '★棋子本来没有位置（未明）⇒ 把它带过来');
    assert.ok((w2.entities[0].aliases || []).includes('阿璃'), '★别名要跟着人走，不许丢');
    assert.equal(w2.agendas.find((a) => a.id === 'a_1').owner, 'e_p1', '★★在飞盘算的主人跟着搬到棋子（否则盘算没有主人）');
    assert.equal(w2.agendas.find((a) => a.id === 'a_2').owner, 'e_2_1', '★别人的盘算一个字不动');
    const ends = w2.relations.map((x) => `${x.from}→${x.to}`).sort();
    assert.deepEqual(ends, ['e_2_1→e_p1', 'e_p1→e_2_1'], '★★关系两端都要重写（不许留指向已下架实体的悬空边）');
});

test('★★存量局：并完自环要丢掉（两端都成了玩家 ⇒ 账上不该有的自指）', () => {
    const world = {
        context: { playerId: 'e_p1' },
        entities: [
            { id: 'e_p1', name: '怪璃', kind: 'character' },
            { id: 'e_5_1', name: '{{user}}', kind: 'character' },
        ],
        agendas: [],
        relations: [{ id: 'rel_1', from: 'e_5_1', to: 'e_p1', type: '自我' }],
    };
    const w2 = normalizeMacroEntities(world, {}).ssot;
    assert.deepEqual(w2.relations, [], '★并完变成"自己对自己"的边要丢掉');
});

test('★存量局：没有可靠的"你"可并 ⇒ 什么都不做（不许猜谁是玩家）', () => {
    const world = {
        context: {},   // 没有 playerId
        entities: [{ id: 'e_5_1', name: '{{user}}', kind: 'character' }],
        agendas: [], relations: [],
    };
    const r = normalizeMacroEntities(world, { nameLower: '怪璃' });
    assert.equal(r.merged, 0, '★找不到棋子 ⇒ 只登记、不动手（删了会让引用悬空，改名要猜——两件都不许）');
    assert.deepEqual(r.names, ['{{user}}'], '★但要如实报出看见了什么');
});

test('★存量局：幂等——并过一次之后，再跑什么都不做', () => {
    const world = {
        context: { playerId: 'e_p1' },
        entities: [
            { id: 'e_p1', name: '怪璃', kind: 'character' },
            { id: 'e_5_1', name: '{{user}}', kind: 'character' },
        ],
        agendas: [], relations: [],
    };
    const first = normalizeMacroEntities(world, {});
    assert.equal(first.merged, 1);
    const second = normalizeMacroEntities(first.ssot, {});
    assert.equal(second.merged, 0, '★第二次跑必须什么都不做（照 normalizeMilestoneLinks 那条先例）');
    assert.equal(second.ssot, undefined, '★没变就不返回新世界（调用方按"没变"处理）');
});

test('★存量局：名字正常的账，一个字节都不许动（零漂移）', () => {
    const world = {
        context: { playerId: 'e_p1' },
        entities: [{ id: 'e_p1', name: '怪璃', kind: 'character' }, { id: 'e_2_1', name: '姬元真', kind: 'character' }],
        agendas: [], relations: [],
    };
    const r = normalizeMacroEntities(world, {});
    assert.equal(r.merged, 0);
    assert.equal(r.ssot, undefined, '★没宏实体 ⇒ 不换世界（旧账零扰动）');
});

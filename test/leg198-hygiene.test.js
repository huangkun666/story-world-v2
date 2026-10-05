// story-world-v2/test/leg198-hygiene.test.js
// ★★★leg198 的另外三处（都来自社区反馈，逐条对过源码）：
//
//   ① **起根那格 `why` 把"预判"当"已发生"**（反馈第 1 条）——他抓对了字段、抓错了格子：
//      `seedFrom.why` **从不进模型**（全仓只有面板/工具读 `seedFrom`），真进模型的是这条根的 **title**
//      （`src/pack.js` 的线头/线捆只带 `id/title/position/people`）。
//      ⇒ 治法：**给 title 立时态纪律**（只写此刻正在发生的那一步），并把那个**死格 `why` 撤掉**
//        （写了没人读、面板不显示、还容易把预判写进去）。★老账里已有的 `why` 照旧合法（契约键留着）。
//   ② **实体页「事迹」空文案与正文观感相反**（反馈第 3 条）——它写「这本书里没写他在做什么，
//      这一局也还没轮到他」，而真相往往是"正文里有，但这一轮没有标签 ⇒ 没记下来"。
//   ③ **零标签静默退化**（反馈第 2 条）——`tagReadoutLine` 零标签返回 null ⇒ 面板/状态条一个字都没有。
//      治法：**标签开关开着却没有标签**时如实出声（那才是"模型没按规范写"这个真问题；
//      开关关着是玩家自己的选择，不刷屏）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEED_ROOT_ITEM_SHAPE, sanitizeSeedRoots, applySeedRoots } from '../src/seed-roots.js';
import { tagReadoutLine, extractTags } from '../src/tag-extract.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── ① 起根：title 立时态纪律，死格 why 撤掉 ────────────────────────────────────
test('leg198⑬：起根那格 `why` 撤掉（写了没人读），title 只许写"此刻正在发生"', () => {
    assert.ok(!('why' in SEED_ROOT_ITEM_SHAPE), '★`why` 那一格必须撤掉——它是死格，还专门招"预判"');
    assert.match(SEED_ROOT_ITEM_SHAPE.title, /正在发生/, '★title 的说明要写明"此刻正在发生"');
    assert.match(SEED_ROOT_ITEM_SHAPE.title, /不许写|不要写/, '★并且要明写"不许写接下来会怎样"');
    // 净化与落账两处都不许再带着它走
    const { roots } = sanitizeSeedRoots({ roots: [{ title: '甲在渡口设卡', parties: ['甲'], quote: 'q', why: '接下来他会封锁商路' }] });
    assert.equal(roots.length, 1, '前置：这条根要能落下来');
    assert.ok(!('why' in roots[0]), '★净化层不许再收 `why`');
    const ssot = {
        entities: [{ id: 'e_a', kind: 'character', name: '甲', location: '临渊城', status: 'active' }],
        context: { setting: { frozen: { canon: { bookEntities: [] } } } },
        events: [], meta: { tick: 0 },
    };
    const res = applySeedRoots(ssot, roots, { fingerprint: 'f', at: 't0', tick: 0 });
    assert.equal(res.seeded, 1, '前置：这条根要能种进账');
    const seeded = ssot.events[0];
    assert.ok(seeded.seedFrom?.quote === 'q', '★书里那句话照旧留着（它是可核查的那一半）');
    assert.ok(!('why' in seeded.seedFrom), '★账上不许再写 `why`（预判不该和事实并列）');
});

test('leg198⑭（对照组）：老账里已有的 `seedFrom.why` 照旧合法（契约键留着，零迁移）', () => {
    const schema = readFileSync(path.join(ROOT, 'src', 'schemas', 'ssot.schema.js'), 'utf8');
    assert.match(schema, /seedFrom:[\s\S]{0,400}?why: \{ kind: 'string' \}/,
        '★契约里那一格必须留着——删掉它，老账一载入就违约（本仓 leg60 为这个形状付过账）');
});

// ── ② 实体页「事迹」空文案如实 ────────────────────────────────────────────────
test('leg198⑮：实体页「事迹 · 他做的」空文案不许与正文观感相反', () => {
    const src = readFileSync(path.join(ROOT, 'web', 'entity-window.js'), 'utf8');
    assert.ok(!/这本书里没写他在做什么，这一局也还没轮到他/.test(src),
        '★那句断言"书里没写、也没轮到他"是**假话**（真相常常是"有，但没标签 ⇒ 没记下来"）');
    assert.match(src, /标签/, '★新文案要如实说出"要标签才记得下来"，并指向那一枚开关');
});

// ── ③ 零标签不许静默 ─────────────────────────────────────────────────────────
test('leg198⑯：零标签时读数仍是 null（口径不许放宽），但接线层必须出声', () => {
    const none = extractTags('甲一路走远了，谁也没回头。', { entities: [], locations: [], playerId: null });
    assert.equal(tagReadoutLine(none), null,
        '对照：零标签 ⇒ 读数行仍是 null（`hasTagFacts` 那条口径一个字没放宽）');
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    assert.match(web, /这一轮正文里没有标签|正文里没有标签/,
        '★零标签必须出声：接线层要有一句如实的话（不许静默退化）');
    assert.match(web, /injectSwitchOn\('injectTagSpec'\)[\s\S]{0,120}?setStatus|setStatus\([\s\S]{0,120}?没有标签/,
        '★而且只在"标签开关开着却没有标签"时出声（开关关着是玩家自己的选择，不刷屏）');
    assert.match(web, /注意/, '★那句话要带「注意」——状态条只让"进行中/警告"露头（`web/status-bar.js` 那条口径）');
});

// ── ④ 往事注入：量体与产出同一把尺子 ─────────────────────────────────────────
test('leg198⑰：注入额度那一把尺子**只有一把**（量什么就印什么）', () => {
    const recall = readFileSync(path.join(ROOT, 'src', 'ledger-recall.js'), 'utf8');
    const inject = readFileSync(path.join(ROOT, 'web', 'inject.js'), 'utf8');
    assert.match(recall, /export function recalledLineText/, '★"一行往事长什么样"要有一个共用口');
    const hits = (recall.match(/' {2}· '/g) || []).length;
    assert.equal(hits, 1, `★那一行的拼法只许有一处（实为 ${hits} 处）——两处拼法迟早分叉`);
    assert.match(inject, /recalledLineText/, '★量体那一侧要走同一个共用口（它原来量的是"剥过的"，印的是原文）');
    assert.ok(!/const line = ` {2}· \$\{proseOnly/.test(inject), '★不许再拿剥过的长度当额度尺子');
});

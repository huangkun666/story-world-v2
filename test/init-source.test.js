// story-world-v2/test/init-source.test.js
// 第十八棒：初始化设定源合订（编排层助手纯函数）——自动合订角色卡+世界信息 /
// 世界书条目全量不截断（v1 教训对齐）/ 尊重禁用标记 / 卡件 v1 spend 同款 / 防御上限 / 去重 / 确定性。
// 换源/worldBook 机制已整体废除——本模块不再接受任何外部文本槽。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    composeInitSource, probeBook, deriveTitleRoster, compileCompleteness, compileSummary, slimLegacyCompile,
    SSOT_COMPILE_KEYS, INIT_SOURCE_HARD_CEILING, INIT_PIECE_CAPS,
} from '../src/init-source.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';

const CARD = {
    name: '江州奇谭',
    description: '大虞边陲江州，妖邪四起。'.repeat(30), // 约 360 字
    scenario: '边关告急，商路断绝。'.repeat(20),
    personality: '各方势力各怀鬼胎。'.repeat(10),
    first_mes: '雨夜，你站在城门口。'.repeat(5),
};

const ENTRY = (key, content) => ({ key, content });
const BOOK_ENTRY = (uid, content) => ({ uid, key: `k${uid}`, content });

test('自动合订卡四件套，顺序=描述/场景/人格/开场白，worldName=卡名', () => {
    const r = composeInitSource({ character: CARD });
    assert.equal(r.ok, true);
    assert.ok(r.label.includes('自动合订'));
    assert.equal(r.worldName, '江州奇谭');
    assert.equal(r.pieceCount, 4);
    assert.ok(r.text.includes('大虞边陲江州'));
    assert.ok(r.text.includes('边关告急'));
    assert.ok(r.text.includes('各方势力'));
    assert.ok(r.text.includes('雨夜，你站在城门口'));
    const iDesc = r.text.indexOf('大虞边陲江州');
    const iScen = r.text.indexOf('边关告急');
    const iPers = r.text.indexOf('各方势力');
    const iMes = r.text.indexOf('雨夜，你站在城门口');
    assert.ok(iDesc < iScen && iScen < iPers && iPers < iMes, '四件套按 描述→场景→人格→开场白 排');
});

test('卡件各自截断到提案上限（v1 spend 同款），世界书条目不受此限', () => {
    const big = { ...CARD, description: '妖'.repeat(5000), first_mes: '雨'.repeat(3000) };
    const r = composeInitSource({ character: big });
    const descPart = r.text.split('\n').find((s) => s.startsWith('妖'));
    const mesPart = r.text.split('\n').find((s) => s.startsWith('雨'));
    assert.ok(Array.from(descPart).length <= INIT_PIECE_CAPS.description, '描述 spend ≤ 1200');
    assert.ok(Array.from(mesPart).length <= INIT_PIECE_CAPS.first_mes, '开场白 spend ≤ 400');
});

test('世界书条目全量不截断：长条目完整保留（v1 教训对齐：头截断砍名字密集段）', () => {
    const longContent = '妖'.repeat(3000) + '青面兽，盘踞枯井。' + '妖'.repeat(3000);
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [ENTRY('枯井', longContent)],
    });
    assert.ok(r.text.includes('青面兽，盘踞枯井。'), '条目深处的名号不被截断');
    assert.equal(r.truncated, false, '世界书不做预算裁剪');
});

// ★leg60：标签口径锁——**题名优先于触发词**。
//   为什么要有（真账症状）：旧法取 `key[0]`（ST 的触发词表），于是模型看到
//   `【吕氏】人物档案：吕玲绮…`（题名 `吕玲绮`）、`【九宸玄陆】`（题名 `世界总设定`）、
//   `【境界】`（题名 `战力准则`）；`key=[]` 的 15 条更直接变成 `【36】` 这种纯数字。
//   ⇒ 作者亲手写的题名一个字都没进过抽取（名册/体系的名字全靠模型从正文里猜）。
test('leg60 标签口径：题名（comment）优先，题名缺失才回落触发词，最后才是 uid', () => {
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [
            { key: ['吕氏', '吕绮玲'], comment: '吕玲绮', content: '人物档案：吕玲绮。' },
            { key: '世界总纲', content: '无题名的一条。' },
            { key: [], comment: '', content: '无题名无键的一条。', uid: 36 },
        ],
    });
    assert.ok(r.text.includes('【吕玲绮】人物档案：吕玲绮。'), '★题名优先（旧法只给【吕氏】）');
    assert.ok(r.text.includes('【世界总纲】无题名的一条。'), '题名缺失 ⇒ 回落触发词（旧行为，不倒退）');
    assert.ok(r.text.includes('【36】无题名无键的一条。'), '都没有 ⇒ 回落 uid（旧行为，不倒退）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★leg60（用户令「把抽象这件事做好了，泛用化设计」）：**声明面取料**的判据。
//   病（真账实测）：ST 生态里"禁用条目"常常是作者的**仓储**——条目关掉（ST 自己的注入器不烧它），
//     改由控制器脚本运行时 `getwi(null,'张辽正史')` 按需取。旧法 `collectEntries` 一条不剩跳过 disable ⇒
//     引擎把整座图书馆扔了：三国 827 条里 563 条禁用 = 全书的 **81%**（850,282 字），引擎只看得到 **18.9%**；
//     大荒只禁用 12% ⇒ 看得到 87.6%。**这就是"三国名册跟大荒不是一个档次"的主因。**
//   判据（纯函数 · 零词表 · 与方言无关）：① 恒注入壳（`constant` 且含取件调用）声明的目录必读；
//     ② 一个壳点名的标题**互相成族**（共享 2–3 字前后缀且 ≥3 条）⇒ 它声明的是一"套"（体系表/世界观）⇒ 读；
//     ③ 零散点名（一人一条的人物档案）⇒ 不进料（题名进名册，正文留台账）。
test('★leg60 声明面取料：恒注入壳 + 成套声明进料（含禁用条目），零散实例不进', () => {
    const entries = [
        { uid: 1, comment: '剧本背景控制', key: [], constant: true, content: "<%_ %><%- await getwi(null,'正史159') %>" },
        { uid: 2, comment: '控制器_世界观背景', key: ['正史'], content: "<%_ %><%- await getwi(null,'演义战力体系') %><%- await getwi(null,'演义智谋内政体系') %><%- await getwi(null,'演义鬼神道德体系') %>" },
        { uid: 3, comment: '控制器_张辽', key: ['张辽'], content: "<%_ %><%- await getwi(null,'张辽正史') %><%- await getwi(null,'张辽演义') %>" },
        { uid: 4, comment: '控制器_张飞', key: ['张飞'], content: "<%_ %><%- await getwi(null,'张飞正史') %><%- await getwi(null,'张飞演义') %>" },
        { uid: 11, comment: '正史159', key: [], disable: true, content: '建安元年，曹操迎天子都许。' },
        { uid: 12, comment: '演义战力体系', key: [], disable: true, content: 'T0级_天下无双 数值标定 勇武100。' },
        { uid: 13, comment: '演义智谋内政体系', key: [], disable: true, content: '智谋分三档。' },
        { uid: 14, comment: '演义鬼神道德体系', key: [], disable: true, content: '鬼神道德体系。' },
        { uid: 15, comment: '张辽正史', key: [], disable: true, content: '张辽字文远。' },
        { uid: 16, comment: '张辽演义', key: [], disable: true, content: '张辽演义事。' },
        { uid: 17, comment: '张飞正史', key: [], disable: true, content: '张飞字益德。' },
        { uid: 18, comment: '张飞演义', key: [], disable: true, content: '张飞演义事。' },
    ];
    const r = composeInitSource({ character: null, worldInfoEntries: entries });
    assert.ok(r.text.includes('【正史159】'), '★恒注入壳声明的目录必读——**而且它是禁用条目**（这一刀就是本棒的病根）');
    assert.ok(r.text.includes('【演义战力体系】'), '★"成套声明"里的体系表进料（三国 powerScale 就靠这条）');
    assert.ok(!r.text.includes('【张辽正史】'), '★零散实例（一人一条的人物档案）不进料——题名进名册、正文留台账');
    assert.equal(r.catalog.picked, 4, '选中 = 恒壳 1 + 成套 3');
    assert.equal(r.catalog.skipped, 4, '未编译 4 条（张辽/张飞 各 2）——台账要带字数，第 3 件自检读它');
    assert.ok(r.catalog.skippedChars > 0, '未编译台账带字数');
    assert.equal(r.catalog.declaredDropped, 0, '没顶到防御上限时不许有"截掉的声明"');
    assert.equal(r.entryCount, 4 + 4, 'entryCount = 启用 4 + 声明面 4');
    // 开关关掉 ⇒ 逐字退回旧口径（可回滚、可对照）
    const old = composeInitSource({ character: null, worldInfoEntries: entries, includeDeclared: false });
    assert.ok(!old.text.includes('【演义战力体系】'), 'includeDeclared:false ⇒ 只读启用条目（旧口径）');
    assert.equal(old.catalog, null, '关掉就不产出声明面读数');
});

test('★leg60 泛用性守门：**没有壳的书零扰动**——合订文本与旧口径逐字节相同', () => {
    // 大荒（壳 1 个、声明 7 条）· re0 / 实教世界书 / Eldoria / 全球书（**壳 0 个**）都走这条路径。
    // 为什么必须锁：本棒的取料是"按书的声明"，若把"没声明"也当成"要读点什么"，就会把
    // 大荒那种"启用集本来就是全书"的书搅乱（那是它名册质量好的原因，绝不能赔进去）。
    const entries = [
        { uid: 1, comment: '世界总设定', key: ['九宸玄陆'], content: '世界纪元：浩劫后纪元。' },
        { uid: 2, comment: '战力准则', key: ['境界'], content: 'T1感气境。' },
        { uid: 3, comment: '没人点名的禁用条目', key: [], disable: true, content: '没人点名我。' },
    ];
    const a = composeInitSource({ character: null, worldInfoEntries: entries });
    const b = composeInitSource({ character: null, worldInfoEntries: entries, includeDeclared: false });
    assert.equal(a.text, b.text, '★没有壳 ⇒ 与旧口径逐字节相同');
    assert.equal(a.catalog.shells, 0, '一个壳都没有');
    assert.equal(a.catalog.picked, 0, '选中 0 条');
    assert.ok(a.text.includes('【世界总设定】') && !a.text.includes('没人点名我'), '启用集照旧、禁用集照旧跳过');
});

test('★leg60 声明面读数：探测层把"作者把料放在哪"全量报出来（零模型、可判据锁）', () => {
    const entries = [
        { uid: 1, comment: '壳A', key: [], constant: true, content: "await getwi(null,'X正史')" },
        { uid: 2, comment: '壳B', key: [], content: "// 注释里的 getwi(null,'不该算') \n await getWorldInfo('没这条')" },
        { uid: 3, comment: 'X正史', key: [], disable: true, content: '甲乙丙。' },
    ];
    const p = probeBook(entries, null);
    assert.equal(p.entries, 3);
    assert.equal(p.enabled, 2);
    assert.equal(p.disabled, 1);
    assert.equal(p.constShells.length, 1, '恒注入壳只认 constant === true');
    assert.deepEqual(p.declared.map((d) => d.title), ['X正史'], '声明表只收书里真有的');
    assert.deepEqual(p.missing, ['没这条'], '★点名了但书里没有的（作者笔误）如实报——三国实测 5 个');
    assert.equal(p.declared[0].disabled, true, '声明面里的禁用/启用状态逐条带出');
    assert.equal(p.declared[0].by[0], '壳A', '声明者是谁也带出（诊断要能指认）');
    assert.ok(!p.declared.some((d) => d.title === '不该算'), '★注释里的取件调用不算声明（剥注释，leg59b 踩过）');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// ★★leg60：**题名即名册**（零 token）——作者已经把 cast 写在题名里了。
//   真账实测：三国题名里有 `控制器_张辽`（×187）· `张辽正史`/`张辽演义`（×184/185）· `甄宓人设控制`（×32）
//   ⇒ 185 个人物；而真账名册只有 **127** 条（模型要在 220 条 JS 控制器里捞名字，捞不全）。
//   判据三步：①题名 2–3 字前后缀频次 ≥3 = 书自己的体例 ②剥掉体例得残差 ③★残差必须是**本书的 key**
//   （作者自己把它当名字用过）——`世界观背景`/`159`/`战力体系` 这类残差谁也没当过名字 ⇒ 全弃。
test('★leg60 题名即名册：零 token 剥出 cast（自证：残差必须是本书当过的名字）', () => {
    const entries = [
        { uid: 1, comment: '控制器_张辽', key: ['张辽'], content: "<%_ getwi(null,'张辽正史') _%>" },
        { uid: 2, comment: '控制器_张飞', key: ['张飞'], content: "<%_ getwi(null,'张飞正史') _%>" },
        { uid: 3, comment: '控制器_关羽', key: ['关羽'], content: "<%_ getwi(null,'关羽正史') _%>" },
        { uid: 4, comment: '控制器_世界观背景', key: ['正史', '演义'], content: "<%_ getwi(null,'演义战力体系') _%>" },
        { uid: 5, comment: '貂蝉人设控制', key: ['貂蝉'], content: "<%_ getwi(null,'貂蝉正史') _%>" },
        { uid: 6, comment: '张辽正史', key: [], disable: true, content: '张辽字文远。' },
        { uid: 7, comment: '张飞正史', key: [], disable: true, content: '张飞字益德。' },
        { uid: 8, comment: '关羽正史', key: [], disable: true, content: '关羽字云长。' },
        { uid: 9, comment: '貂蝉正史', key: [], disable: true, content: '貂蝉，王允歌伎。' },
        { uid: 10, comment: '张辽演义', key: [], disable: true, content: '演义事。' },
        { uid: 11, comment: '张飞演义', key: [], disable: true, content: '演义事。' },
        { uid: 12, comment: '关羽演义', key: [], disable: true, content: '演义事。' },
        { uid: 13, comment: '貂蝉演义', key: [], disable: true, content: '演义事。' },
        { uid: 14, comment: '正史159', key: [], disable: true, content: '建安元年。' },
    ];
    const names = deriveTitleRoster(entries, null).map((x) => x.name);
    assert.deepEqual(names.sort(), ['关羽', '张辽', '张飞', '貂蝉'], '★题名里的 cast 被剥出来（零调用、零 token）');
    assert.ok(!names.includes('世界观背景'), '★自证不过 ⇒ 不收（`世界观背景` 谁也没当过名字）');
    assert.ok(!names.includes('159'), '★`正史159` 剥出的 `159` 不是名字 ⇒ 不收');
    // ★只认"主导体例"（首版实测踩出来的）：`貂蝉演义` 既能剥前缀 `貂蝉`（×3）也能剥后缀 `演义`（×4），
    //   必须取**族最大**的那个 ⇒ 收 `貂蝉`、**不收 `演义`**。旧写法会剥出 `演义`/`正史` 两个**路由词**
    //   当名号（它们恰好也是 key，自证闸拦不住）——真书实测：三国因此多了 2 条假名号。
    assert.ok(!names.includes('演义') && !names.includes('正史'), '★模式/路由词不许当名号（主导体例那一刀）');
    // ★接线锁（这一条是踩出来的）：题名面必须以**顶层键**交出去——`web/index.js` 读的是
    //   `src.titleRoster`（喂给 extractWorldSetting 的 extraDeclared）。我第一版把它塞进了 catalog 摘要里,
    //   顶层是 undefined ⇒ 191 个名号一个都没进册，而**判据全绿**（与"别名通道"同一个形状）。
    const composed = composeInitSource({ character: null, worldInfoEntries: entries });
    assert.equal(Array.isArray(composed.titleRoster), true, '★composed.titleRoster 必须是顶层数组（接线面）');
    assert.deepEqual(composed.titleRoster.map((x) => x.name).sort(), ['关羽', '张辽', '张飞', '貂蝉'], '顶层键里就是那几个人');
    assert.equal(composed.catalog.titleRoster.length, 4, 'catalog 摘要里也留一份（诊断面读它）');
});

// ★leg60（交接第 3 件）：**编译完整性自检**——"书里有多少条设定类条目 vs 编译覆盖了多少 ⇒ 漏了如实报"。
//   交接原话：有了它，以后"哪个体系没抽出来"**不用再靠翻磁盘对账**。
//   ⚠这一条同时是**接线锁**：读数必须真的跟着合订结果交出去（`catalog.completeness`）——
//     我在题名面上踩过一次"算对了但顶层没交出去、全绿"的坑，这类洞必须靠接线锁守。
test('★leg60 编译完整性自检：题名判据只报数不做取舍，且读数真的交出去（接线锁）', () => {
    const entries = [
        { uid: 1, comment: '壳A', key: [], constant: true, content: "await getwi(null,'演义战力体系')" },
        { uid: 2, comment: '演义战力体系', key: [], disable: true, content: 'T0级 天下无双。' },
        { uid: 3, comment: '九宸玄陆·力量体系全典', key: ['境界'], content: '修炼等级分四境。' },
        { uid: 4, comment: '没人点名的体系条目', key: [], disable: true, content: '体系正文。' },
        { uid: 5, comment: '普通条目', key: ['甲'], content: '与设定无关。' },
    ];
    const cc = compileCompleteness(entries, null, { compiledTitles: ['壳A', '演义战力体系', '九宸玄陆·力量体系全典', '普通条目'] });
    assert.deepEqual(cc.settingTitles.map((x) => x.title), ['演义战力体系', '九宸玄陆·力量体系全典', '没人点名的体系条目'],
        '题名判据认出三条"设定类"（含一条**没被点名、因而没进编译**的）');
    assert.equal(cc.compiled, 2, '其中两条本次编译覆盖了');
    assert.deepEqual(cc.missed.map((x) => x.title), ['没人点名的体系条目'], '★漏了的那条**如实点名**（"哪个体系没抽出来"一眼看到）');
    // 接线锁：合订结果里必须带得走
    const composed = composeInitSource({ character: null, worldInfoEntries: entries });
    assert.equal(composed.catalog.completeness.settingTitles, 3, '★compose 结果里带出设定类条目总数（接线面）');
    assert.equal(composed.catalog.completeness.settingCompiled, 2);
    assert.deepEqual(composed.catalog.completeness.missedTitles, ['没人点名的体系条目']);
});

// ★★leg60：**落账形状锁**——`compile` 只许标量（契约层 `additional:false`，而它是自己的键表）。
//   这一条是用户真账实测抓出来的自己那一刀：第一版把整个 catalog 铺进去 ⇒
//   `titleRoster`（189 条带 why 的名号明细）整块进账 = 13,679 字符 = 账本 11.4%，且**违约**。
test('★leg60 编译读数落账：只许标量、键必须在契约表里（明细留诊断面，账本只留计数）', () => {
    const catalog = {
        entries: 827, enabled: 264, disabled: 563, enabledChars: 196695, disabledChars: 847299,
        shells: 220, constShells: 1, declared: 554, declaredChars: 835382,
        picked: 188, pickedChars: 309001, declaredDropped: 8, skipped: 366, skippedChars: 526381,
        // 下面这些是"明细/派生"，**不许进账本**
        declaredLines: 188, missing: 5, windowCover: { entries: 12, chars: 30000 },
        titleRoster: [{ name: '张辽', from: '控制器_张辽', why: '…' }],
        completeness: { settingTitles: 12, settingCompiled: 12, missedTitles: [] },
    };
    const s = compileSummary(catalog, catalog.titleRoster);
    assert.equal(s.titleNames, 1, '题名面只落**条数**（不落那 189 条明细）');
    assert.equal(s.settingTitles, 12, '设定类条目数从 completeness 里提出来落成标量');
    assert.equal(s.settingCompiled, 12);
    for (const [k, v] of Object.entries(s)) {
        assert.equal(typeof v, 'number', `★${k} 必须是标量（键表 = SSOT_COMPILE_KEYS）`);
        assert.ok(SSOT_COMPILE_KEYS.includes(k), `★${k} 必须在契约表里（否则 additional:false 会违约）`);
    }
    assert.ok(!('titleRoster' in s) && !('completeness' in s) && !('windowCover' in s) && !('missing' in s),
        '★明细字段一个都不许进账本');
    assert.equal(JSON.stringify(s).length < 400, true, `落账读数必须是短表（实测 ${JSON.stringify(s).length} 字符）`);
    assert.equal(compileSummary(null, []), null, '没有探测结果 ⇒ 不落键');
});

// ★★leg60 旧账清理（与 `settle.migrateLegacyAttrs` 同一治法）：把写胖的 compile 收成标量摘要。
//   为什么需要：用户那份三国真账花了二十多分钟才跑完，为 6 个诊断键让他重跑是荒唐的；
//   而契约（`additional:false`）不修就一直违纪。判据按"无可摘 ⇒ 原对象返回"那套写（幂等 + 零空写）。
test('★leg60 旧账清理：胖 compile 收成标量摘要（幂等 · 无可摘则原对象返回 · 收完过契约）', () => {
    // 夹具必须是一份**形状完整的世界**（否则最后那条"收完过契约"判据红的是夹具、不是代码）
    const mk = (compile) => ({
        version: 1,
        context: {
            world: '三国', tension: 0.5, positions: ['未明'],
            setting: {
                frozen: { fingerprint: 'f', extractedAt: 't', canon: { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] }, compile },
                dynamic: { tension: { polarity: '未聚', direction: '', intensity: 0.5 }, env: {} },
            },
        },
        entities: [{ id: 'e1', kind: 'character', name: '张辽', location: '未明' }],
        weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 },
    });
    const fat = mk({
        entries: 827, enabled: 264, disabled: 563, declared: 554, picked: 188, skipped: 366,
        enabledChars: 392482, declaredLines: 188, missing: 5,
        windowCover: { entries: 12, chars: 30000 },
        titleRoster: [{ name: '张辽', from: '控制器_张辽', why: '…' }, { name: '关羽', from: '关羽正史', why: '…' }],
        completeness: { settingTitles: 12, settingCompiled: 12, missedTitles: [] },
        settingTitles: 12, settingCompiled: 12, titleNames: 189,
    });
    const out = slimLegacyCompile(fat);
    assert.notEqual(out, fat, '有可摘的 ⇒ 产出新对象');
    assert.equal(out.context.setting.frozen.compile.titleRoster, undefined, '★189 条名号明细不许留在账本里');
    assert.equal(out.context.setting.frozen.compile.windowCover, undefined);
    assert.equal(out.context.setting.frozen.compile.titleNames, 189, '计数一个不少（摘的是明细，不是读数）');
    assert.equal(out.context.setting.frozen.compile.settingTitles, 12);
    assert.ok(Object.keys(out.context.setting.frozen.compile).every((k) => SSOT_COMPILE_KEYS.includes(k)), '只剩契约表里的键');
    // 幂等 + 不空写
    const again = slimLegacyCompile(out);
    assert.equal(again, out, '★已经干净 ⇒ **原对象返回**（不空写、逐字节一致）');
    assert.equal(slimLegacyCompile(null), null);
    assert.deepEqual(slimLegacyCompile({}), {}, '无 setting 不炸（原样返回）');
    // 收完必须过契约（这一条是"修契约"整件事的收口判据）
    const clean = validate(out, ssotSchema);
    assert.equal(clean.ok, true, clean.errors.join('; '));
});

test('世界书条目优先于卡件：条目在前，且带【键】前缀', () => {
    const r = composeInitSource({
        character: CARD,
        worldInfoEntries: [ENTRY('江州', '三面环山，一面临水，妖气盘踞。'), ENTRY('边关', '铁门紧闭。')],
    });
    assert.ok(r.text.startsWith('【江州】三面环山'));
    assert.ok(r.text.indexOf('【江州】') < r.text.indexOf('大虞边陲江州'), '条目排在卡件前');
    assert.equal(r.entryCount, 2);
});

test('尊重酒馆禁用标记：disable/enabled:false 条目不注入（v1 同款）', () => {
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [
            ENTRY('启用', '青面兽。'),
            { key: '禁用', content: '金算盘。', disable: true },
            { key: '停用', content: '白小娥。', enabled: false },
        ],
    });
    assert.ok(r.text.includes('【启用】'));
    assert.ok(!r.text.includes('金算盘') && !r.text.includes('白小娥'));
    assert.equal(r.entryCount, 1);
});

test('卡内置世界书双通道：character_book 顶层与 data.character_book（v1 ch.data?.character_book || ch.character_book）', () => {
    const cardTop = { ...CARD, character_book: { entries: [BOOK_ENTRY(1, '书内名号：青面兽。')] } };
    const rTop = composeInitSource({ character: cardTop });
    assert.ok(rTop.text.includes('【k1】书内名号：青面兽。'));

    const cardData = { ...CARD, data: { character_book: { entries: [BOOK_ENTRY(2, '书内名号：金算盘。')] } } };
    const rData = composeInitSource({ character: cardData });
    assert.ok(rData.text.includes('【k2】书内名号：金算盘。'));
});

test('双通道同内容去重：worldInfo 与 character_book 同键同文只记一次', () => {
    const card = { ...CARD, character_book: { entries: [{ key: '万法阁', content: '万法阁：藏经三千。' }] } };
    const r = composeInitSource({
        character: card,
        worldInfoEntries: [ENTRY('万法阁', '万法阁：藏经三千。')],
    });
    assert.equal((r.text.match(/万法阁：藏经三千。/g) || []).length, 1);
    assert.equal(r.entryCount, 1);
});

test('防御上限：仅超现实量级才裁剪（机制保留，正常世界书永不触发）', () => {
    const bigEntries = [];
    for (let i = 0; i < 300; i += 1) bigEntries.push({ key: `k${i}`, content: `条目${i}：` + '字'.repeat(200) });
    const r = composeInitSource({ character: null, worldInfoEntries: bigEntries });
    assert.equal(r.truncated, false); // 6 万字符世界书默认上限下全量
    assert.ok(r.usedChars > 50000);
    const tiny = composeInitSource({ character: CARD, worldInfoEntries: bigEntries, budget: 500 });
    assert.equal(tiny.truncated, true); // 注入极小防御上限验证机制仍在
    assert.ok(tiny.usedChars <= 500);
});

test('防御上限 0 / 负数：回退默认上限', () => {
    const r = composeInitSource({ character: CARD, budget: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.pieceCount, 4);
});

test('世界书条目全部禁用：ok=false 且 reason 指认禁用面', () => {
    const r = composeInitSource({
        character: null,
        worldInfoEntries: [
            { key: 'a', content: '内容', disable: true },
            { key: 'b', content: '内容', enabled: false },
        ],
    });
    assert.equal(r.ok, false);
    assert.ok(r.reason.includes('禁用'));
});

test('全空输入：ok=false（不产出空设定）', () => {
    const r = composeInitSource({});
    assert.equal(r.ok, false);
    assert.ok(r.reason);
    const r2 = composeInitSource({ character: { name: '无四件套' } });
    assert.equal(r2.ok, false);
});

test('确定性：同输入两次逐字节一致', () => {
    const input = { character: CARD, worldInfoEntries: [ENTRY('江州', '三面环山。'), ENTRY('边关', '铁门紧闭。')] };
    const a = composeInitSource(input);
    const b = composeInitSource(input);
    assert.deepEqual(a, b);
    assert.equal(a.text, b.text);
});
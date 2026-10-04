import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeInitSource, deriveTitleRoster } from '../src/init-source.js';
import { extractWorldSetting, seedBookEntities, buildAbstractPrompt, buildRosterPrompt, buildAttrsOnlyPrompt, buildSettingOnlyPrompt, buildScalePrompt } from '../src/abstract.js';
import { buildSeedRootsPrompt } from '../src/seed-roots.js';
import { buildLookupPrompt } from '../src/entity-lookup.js';
import { bookFingerprint, createCache } from '../src/fp-hash.js';
import { bookTextForEntity, bookTextForRoots, currentBookFingerprint, resetBookCache } from '../web/book-source.js';

const fact = { comment: '城主', key: ['柳川'], content: '柳川居于青岚城，实力为破妄境。' };
const tech = { comment: '[mvu_update]变量更新规则', key: ['柳川'], content: '柳川的调试身份为示例工具。每轮全量replace。' };
const compose = (entries) => composeInitSource({ worldInfoEntries: entries });
const ctxFor = (entries) => ({ character: { name: '测试世界', character_book: { entries } } });

test('专用 MVU 条目不进抽象，原世界正文与入参保留', () => {
    const entries = [fact, tech, { comment: '[InitVar]初值', content: '示例变量初值99' }];
    const before = JSON.stringify(entries);
    const r = compose(entries);
    assert.equal(r.text, '【城主】' + fact.content);
    assert.equal(JSON.stringify(entries), before);
    assert.ok(r.excluded.some((e) => e.title === tech.comment && e.chars > 0));
});

test('混合条目仅去掉成对脚本与变量区块，保留世界数值和叙事标签', () => {
    const r = compose([{ comment: '[mvu_plot]城中近况', content: '勇武99。<% print("技术示例"); %>仍在守城。<script type="text/javascript">技术代码</script>兵力300。<UpdateVariable>更新协议</UpdateVariable>城墙完整。' }]);
    assert.equal(r.text, '【[mvu_plot]城中近况】勇武99。仍在守城。兵力300。城墙完整。');
});

test('普通世界里的变量、系统和规则不是排除理由', () => {
    const text = '变量之神管理魔法系统。跨境界有反噬规则，实力为T9，资源100。';
    assert.equal(compose([{ comment: '变量系统规则', content: text }]).text, '【变量系统规则】' + text);
});

test('未闭合区块保留并报告，删除区块不拼造名字', () => {
    const incomplete = '柳川<% 未闭合的脚本。城墙完整。';
    const a = compose([{ comment: '正文', content: incomplete }]);
    assert.equal(a.text, '【正文】' + incomplete);
    assert.ok(Array.isArray(a.warnings), '应提供技术区块告警');
    assert.ok(a.warnings.some((s) => s.includes('未闭合')));
    const b = compose([{ comment: '正文', content: '甲<script>代码</script>乙' }]);
    assert.ok(!b.text.includes('甲乙'));
    assert.ok(b.text.includes('甲') && b.text.includes('乙'));
});

test('相邻技术区块移除后仍保留两个文字片段的边界', () => {
    const r = compose([{ comment: '正文', content: '甲<script>代码</script><% 另段代码 %>乙' }]);
    assert.equal(r.text, '【正文】甲\n乙');
});

test('补充汉字码点之间删除脚本也不会拼造名字', () => {
    const r = compose([{ comment: '正文', content: '𠀀<script>代码</script>𠀁' }]);
    assert.equal(r.text, '【正文】𠀀\n𠀁');
});

test('控制器先读声明，移除脚本后仍合订被点名的禁用正文', () => {
    const r = compose([
        { comment: '[ejs]历史控制器', constant: true, content: '<%- await getwi(null,"旧史") %>' },
        { comment: '旧史', disable: true, content: '柳川正在守城。' },
    ]);
    assert.equal(r.text, '【旧史】柳川正在守城。');
    assert.equal(r.catalog.declared, 1);
});

test('全是技术内容时如实返回没有可用设定', () => {
    const r = compose([tech]);
    assert.equal(r.ok, false);
    assert.match(r.reason, /技术|设定/);
    assert.ok(r.excluded.length);
});

test('纯脚本配置题名不能补成实体，普通人物题名照旧', () => {
    const config = ['甲工具', '乙工具', '丙工具'].map((name) => ({ comment: '配置_' + name, key: [name], content: '<script>const name="' + name + '";</script>' }));
    const people = ['柳川', '岳林', '沈舟'].map((name) => ({ comment: '人物_' + name, key: [name], content: name + '正在守城。', disable: true }));
    assert.deepEqual(deriveTitleRoster(config), []);
    assert.deepEqual(deriveTitleRoster(people).map((e) => e.name), ['柳川', '岳林', '沈舟']);
});

test('只改排除的技术内容不改变有效书指纹', () => {
    const a = compose([fact, tech]);
    const b = compose([fact, { ...tech, content: '技术输出格式改版' }]);
    assert.equal(bookFingerprint(a.text), bookFingerprint(b.text));
    assert.notEqual(bookFingerprint(a.text), bookFingerprint(compose([{ ...fact, content: fact.content + '城墙已毁。' }]).text));
});

test('纯控制器贡献的有效题名变化也更新书指纹和初始化缓存', async () => {
    const names = ['柳川', '岳林', '沈舟'];
    const controllers = names.map((name) => ({ comment: '控制器_' + name, key: [name], constant: true, content: '<% getwi(null,"人物资料") %>' }));
    const rest = [{ comment: '人物资料', disable: true, content: '三位守将在边关驻防。' }, { comment: '世界', content: '边境有三座古城。' }];
    const a = compose([...controllers, ...rest]);
    const b = compose([...controllers.map((e) => ({ ...e, content: '<% const x=1; %>' })), ...rest]);
    assert.deepEqual(a.titleRoster.map((d) => d.name), names);
    assert.deepEqual(b.titleRoster, []);
    const cache = createCache();
    let calls = 0;
    const extract = async () => { calls += 1; return '{"bookEntities":[]}'; };
    const first = await extractWorldSetting({ sourceText: a.text, extraDeclared: a.titleRoster, cache, extract });
    assert.deepEqual(first.setting.frozen.canon.bookEntities.map((e) => e.name), names);
    const second = await extractWorldSetting({ sourceText: b.text, extraDeclared: b.titleRoster, cache, extract });
    assert.equal(second.cached, false, '不应命中旧题名名册');
    assert.equal(calls, 2);
    assert.deepEqual(second.setting.frozen.canon.bookEntities, []);
    assert.notEqual(bookFingerprint(a.text), bookFingerprint(b.text));
    resetBookCache();
    assert.notEqual((await currentBookFingerprint(ctxFor([...controllers, ...rest]))).fresh, (await currentBookFingerprint(ctxFor([...controllers.map((e) => ({ ...e, content: '<% const x=1; %>' })), ...rest]))).fresh);
    resetBookCache();
});

test('防御上限截掉题名文本时，题名不再进入下游和输入指纹', async () => {
    const names = ['柳川', '岳林', '沈舟'];
    const controllers = names.map((name) => ({ comment: '控制器_' + name, key: [name], constant: true, content: '<% getwi(null,"人物资料") %>' }));
    for (const [budget, content] of [[11, '云城正在下雨。'], [undefined, '地'.repeat(499996)]]) {
        const rest = [{ comment: '人物资料', disable: true, content: '三位守将在边关驻防。' }, { comment: '世界', content }];
        const before = [...controllers, ...rest];
        const after = [...controllers.map((e) => ({ ...e, content: '<% const x=1; %>' })), ...rest];
        const a = composeInitSource({ worldInfoEntries: before, budget });
        const b = composeInitSource({ worldInfoEntries: after, budget });
        assert.equal(a.truncated, true);
        assert.equal(a.text, b.text, '预算内正文相同，但有效题名不同');
        const cache = createCache();
        const extract = async () => '{"bookEntities":[]}';
        const first = await extractWorldSetting({ sourceText: a.text, extraDeclared: a.titleRoster, cache, extract });
        const second = await extractWorldSetting({ sourceText: b.text, extraDeclared: b.titleRoster, cache, extract });
        assert.deepEqual(a.titleRoster, [], '预算外题名不能补回抽取或兜底');
        assert.deepEqual(b.titleRoster, []);
        assert.equal(second.cached, true, '允许读取的材料相同，复用同一缓存');
        assert.deepEqual(second.setting.frozen.canon.bookEntities, []);
        assert.equal(first.fingerprint, second.fingerprint);
        if (budget === undefined) {
            resetBookCache();
            assert.equal((await currentBookFingerprint(ctxFor(before))).fresh, first.fingerprint);
            assert.equal((await currentBookFingerprint(ctxFor(after))).fresh, second.fingerprint);
            resetBookCache();
        }
    }
});

test('小书拒绝书外名册并用有效名册校验关系', async () => {
    const r = await extractWorldSetting({ sourceText: '柳川与岳林一同守城。', extract: async () => JSON.stringify({
        bookEntities: [{ name: '柳川' }, { name: '岳林' }, { name: '书外角色' }],
        relations: [{ from: '柳川', to: '书外角色', kind: '同盟', quote: '柳川与岳林一同守城。' }],
    }) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.setting.frozen.canon.bookEntities.map((e) => e.name), ['柳川', '岳林']);
    assert.ok(!r.setting.frozen.canon.relations?.length);
    assert.ok(r.errors.some((s) => s.includes('名号')));
});

test('初始化入账的原文属性补缺也不能重新读入专用技术条目', () => {
    const world = {
        context: { positions: ['未明'], setting: { frozen: { canon: { bookEntities: [{ name: '柳川', kind: 'character' }], powerScale: [{ level: '破妄境', note: '一档实力' }] } } } },
        entities: [], weights: {}, agendas: [], events: [], meta: { tick: 0 },
    };
    seedBookEntities(world, { entries: [{ comment: '[mvu_update]柳川示例', content: '柳川（破妄境）' }] });
    assert.equal(world.entities[0].实力, undefined);
});

test('单实体查书与独立起根排除同一技术来源', async () => {
    resetBookCache();
    const ctx = ctxFor([tech, fact]);
    const entity = await bookTextForEntity({ name: '柳川' }, ctx);
    assert.equal(entity.ok, true);
    assert.equal(entity.entries.length, 1);
    assert.equal(entity.entries[0].text, fact.content.slice(0, -1), '查书沿用现有句级定位，去掉句末标点');
    const roots = await bookTextForRoots(ctx);
    assert.ok(roots.text.includes(fact.content));
    assert.ok(!roots.text.includes(tech.content));
    resetBookCache();
});

test('相关条目被技术规则全部排除时，不把未加载写成书里没有', async () => {
    resetBookCache();
    const r = await bookTextForEntity({ name: '柳川' }, ctxFor([tech]));
    assert.equal(r.ok, false);
    resetBookCache();
});

test('补查与合订在题名空白时仍识别 name 上的技术标记', async () => {
    resetBookCache();
    const entries = [{ ...tech, comment: ' ', name: tech.comment }, fact];
    assert.equal(compose(entries).text, '【城主】' + fact.content);
    const r = await bookTextForEntity({ name: '柳川' }, ctxFor(entries));
    assert.equal(r.entries.length, 1);
    resetBookCache();
});

test('换书检测与初始化对相同清理后文本计算指纹', async () => {
    const a = await currentBookFingerprint(ctxFor([fact, tech]));
    const b = await currentBookFingerprint(ctxFor([fact, { ...tech, content: '技术更新' }]));
    assert.equal(a.fresh, bookFingerprint(compose([fact, tech]).text));
    assert.equal(a.fresh, b.fresh);
});

test('全部抽象问法明确约束所有字段，保留真实数值属性', () => {
    const text = fact.content;
    const prompts = [buildAbstractPrompt(text), buildRosterPrompt(text), buildAttrsOnlyPrompt(text), buildSettingOnlyPrompt(text), buildScalePrompt(text), buildSeedRootsPrompt(text), buildLookupPrompt({}, [{ name: '柳川', entries: [{ text }] }])];
    for (const prompt of prompts) {
        assert.match(prompt, /全部输出字段/);
        assert.match(prompt, /脚本条件.*不能证明/);
        assert.match(prompt, /真实世界正文中的实力、数量/);
        assert.ok(prompt.includes(text));
    }
});

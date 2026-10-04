import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBookFields, sanitizeCanon, mergeCanonChunks, dedupeRoster, extractWorldSetting, seedBookEntities, buildRosterPrompt, buildAttrsOnlyPrompt } from '../src/abstract.js';
import { freezeAllowedSources } from '../src/abstract-evidence.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { createCache } from '../src/fp-hash.js';

const name = '极阴';
const brief = '散修，现代穿越者，阴险老六';
const full = `${brief}，自号极阴`;
const text = '极阴是散修。';
const sources = [{ sourceId: 'world', title: '世界', text }];
const ev = { s: 'S1', q: text };
const evidence = () => ({ strict: true, frozen: freezeAllowedSources(sources), records: [] });
const row = fields => ({ name, kind: 'character', fields, ev });

test('用户实例：身份描述有补充时保留完整值，不清空、不报属性冲突', () => {
    const conflicts = [];
    const [kept] = dedupeRoster([row({ 身份: brief }), row({ 身份: full })], { conflicts });
    assert.equal(kept.fields.身份, full);
    assert.equal(conflicts.some(c => c.field === 'field'), false);
});

test('不同属性描述全部保留，第三次重复不能清空或重复增长', () => {
    const [kept] = dedupeRoster([row({ 倾向: '镇压邪魔' }), row({ 倾向: '度化众生' }), row({ 倾向: '镇压邪魔' })]);
    assert.equal(kept.fields.倾向, '镇压邪魔\n度化众生');
});

test('不同数字和等级不能因字符包含关系被当成同一个属性值', () => {
    const [kept] = dedupeRoster([row({ 兵力: '1', 等级: 'T1' }), row({ 兵力: '10', 等级: 'T10' })]);
    assert.equal(kept.fields.兵力, '1\n10');
    assert.equal(kept.fields.等级, 'T1\nT10');
});

for (const key of ['bookEntities', 'entities']) {
    test(`${key}：缺失或不匹配的属性出处都不能删除字段`, () => {
        for (const extra of [{}, { fieldEv: { s: 'S99', q: '不存在' } }]) {
            const proof = evidence();
            const r = sanitizeCanon({ [key]: [{ ...row({ 身份: full, '比较长而且含标点的属性名字：': '跨段整合的描述' }), ...extra }] }, { sourceText: text, evidence: proof });
            const kept = r.canon[key === 'entities' ? 'settings' : key][0];
            assert.equal(kept.fields.身份, full);
            assert.equal(kept.fields['比较长而且含标点的属性名字：'], '跨段整合的描述');
            assert.equal(proof.records.some(x => x.class === 'field' && x.action === 'drop'), false);
        }
    });
}

test('属性不再限制键名、值长、数量，也不删除与键相同的值', () => {
    const long = '详细属性描述'.repeat(80);
    const fields = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`属性编号${i}`, `模型值${i}`]));
    Object.assign(fields, { 身份: long, '完整的长属性名称（带标点）': long, 定位: '定位', 所属: '/太素帝' });
    const r = sanitizeBookFields(fields, 'character', { sourceText: '' });
    assert.deepEqual(r.fields, fields);
    assert.equal(r.truncated, 0);
    assert.deepEqual(r.inferred, []);
});

test('数字、布尔、列表与对象属性保留其 JSON 内容', () => {
    const r = sanitizeBookFields({ 兵力: 0, 是否存活: false, 能力: ['雷法', '剑术'], 战绩: { 胜: 3 } }, 'character');
    assert.deepEqual(r.fields, { 兵力: '0', 是否存活: 'false', 能力: '["雷法","剑术"]', 战绩: '{"胜":3}' });
});

test('一个响应里重复身份补充也应完整保留', () => {
    const r = sanitizeCanon({ bookEntities: [row({ 身份: brief }), row({ 身份: full }), row({ 身份: brief })] }, { sourceText: text, evidence: evidence() });
    assert.equal(r.canon.bookEntities[0].fields.身份, full);
});

test('实际小书抽取、缓存与种账都保留没有匹配出处的完整属性', async () => {
    const cache = createCache();
    const r = await extractWorldSetting({ sourceText: text, allowedSources: sources, cache, extract: async () => JSON.stringify({ bookEntities: [row({ 身份: full, 表外属性: '跨段描述' })] }) });
    assert.equal(r.ok, true, r.errors?.join(';'));
    const cached = await extractWorldSetting({ sourceText: text, allowedSources: sources, cache, extract: async () => { throw Error('不应调用'); } });
    assert.equal(cached.cached, true);
    assert.equal(cached.setting.frozen.canon.bookEntities[0].fields.身份, full);
    const w = { version: 1, context: { world: '测试', tension: 0.5, positions: ['未明'], setting: r.setting }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    seedBookEntities(w);
    assert.equal(w.entities[0].身份, full);
    assert.equal(w.entities[0].表外属性, '跨段描述');
    assert.equal(w.entities[0].fieldSource.身份, '模型抽取');
    assert.equal(validate(w, ssotSchema).ok, true);
});

test('大书两遍合并不会吞掉后到的属性补充', async () => {
    const src = `${text}\n${'补充材料。\n'.repeat(6000)}`;
    const r = await extractWorldSetting({
        sourceText: src, allowedSources: [{ ...sources[0], text: src }],
        extract: async prompt => JSON.stringify(prompt.startsWith('你是世界属性') ? { entities: [row({ 身份: full })] } : { bookEntities: [row({ 身份: brief })] }),
    });
    assert.equal(r.ok, true, r.errors?.join(';'));
    assert.equal(r.setting.frozen.canon.bookEntities.find(x => x.name === name).fields.身份, full);
});

test('属性与引擎结构键同名时原值仍保存，实体账结构合法', () => {
    const fields = JSON.parse('{"身份":"散修","lastActiveTick":"很久以前","attrs":{"兵力":3},"fieldSource":"来源说明","__proto__":"属性文本","constructor":"构造说明"}');
    const r = sanitizeCanon({ bookEntities: [row(fields)] }, { sourceText: text, evidence: evidence() });
    const w = { version: 1, context: { world: '测试', tension: 0.5, positions: ['未明'], setting: { frozen: { fingerprint: 'x', extractedAt: 'now', canon: r.canon } } }, entities: [], weights: {}, agendas: [], events: [], chronicle: [], meta: { tick: 0 } };
    seedBookEntities(w);
    assert.equal(w.context.setting.frozen.canon.bookEntities[0].fields.lastActiveTick, '很久以前');
    assert.equal(w.context.setting.frozen.canon.bookEntities[0].fields.attrs, '{"兵力":3}');
    assert.equal(w.entities[0].attrs, undefined);
    assert.equal(w.entities[0].lastActiveTick, undefined);
    assert.equal(typeof w.entities[0].fieldSource, 'object');
    assert.equal(w.entities[0].constructor, '构造说明');
    const v = validate(w, ssotSchema);
    assert.equal(v.ok, true, v.errors.join(';'));
    assert.equal({}.污染, undefined);
});

test('严格提示词不再要求属性逐字匹配某一句引用', () => {
    const frozen = freezeAllowedSources(sources);
    for (const build of [buildRosterPrompt, buildAttrsOnlyPrompt]) {
        const prompt = build(text, [], { sources: frozen, fields: true });
        assert.doesNotMatch(prompt, /属性值必须能在该 `ev.q` 里逐字找到|核不过的字段一律不收|属性值要能在同一条 `ev`/);
    }
});

for (const [first, second] of [['1','1.5'],['1','-1'],['T1','T1.5'],['1','+1'],['1','1/2'],['1','1,000'],['1','1，000'],['1','1 000'],['1','1\u202f000'],['1','－1'],['1','±1'],['.5','.50'],['T 1','T 1,000'],['１','１，０００']]) {
    test('数值与等级完整 token 保留：' + first + ' / ' + second, () => {
        const [kept] = dedupeRoster([row({ 数值: first }), row({ 数值: second })]);
        assert.equal(kept.fields.数值, first + '\n' + second);
    });
}

for (const key of ['bookEntities', 'entities']) {
    for (const linked of [false, true]) {
        test(key + ' 所属描述保留，结构关系必须有出处：' + linked, () => {
            const q = linked ? '甲是乙的散修。' : '甲是散修。';
            const src = q + '乙是门派。';
            const proof = { strict: true, frozen: freezeAllowedSources([{ sourceId:'world', title:'世界', text:src }]), records:[] };
            const character = { name:'甲', kind:'character', fields:{ 所属:'乙' }, ev:{s:'S1',q} };
            const faction = {name:'乙', kind:'faction', ev:{s:'S1',q:'乙是门派。'}};
            const raw = key === 'bookEntities' ? {bookEntities:[character,faction]} : {entities:[character],bookEntities:[faction]};
            const r = sanitizeCanon(raw, {sourceText:src, evidence:proof});
            const items = key === 'entities' ? r.canon.settings : r.canon.bookEntities;
            assert.equal(items.find(x => x.name === '甲').fields.所属, '乙');
            assert.equal(items.find(x => x.name === '甲').parent, linked ? '乙' : undefined);
            if (key === 'bookEntities') {
                const w = { entities:[], context:{setting:{frozen:{canon:r.canon}}} };
                seedBookEntities(w);
                assert.equal(w.entities.find(x => x.name === '甲').所属, '乙');
                assert.equal(w.entities.find(x => x.name === '甲').parent, linked ? '乙' : undefined);
            }
        });
    }
}

test('属性拆半合并保留后半核验的 parent，冲突关系留给名册收口诊断', () => {
    const src = '甲是散修。甲是乙的散修。甲是丙的散修。乙是门派。丙是门派。';
    const clean = (fields, q) => sanitizeCanon({entities:[{name:'甲',kind:'character',fields,ev:{s:'S1',q}}]}, {sourceText:src,evidence:{strict:true,frozen:freezeAllowedSources([{sourceId:'world',text:src}]),records:[]}});
    const first = clean({身份:'散修'},'甲是散修。');
    const second = clean({所属:'乙'},'甲是乙的散修。');
    const merged = mergeCanonChunks([first,second]);
    assert.equal(merged.canon.settings[0].parent,'乙');
    assert.deepEqual(merged.canon.settings[0].fields,{身份:'散修',所属:'乙'});
    assert.equal(first.canon.settings[0].parent,undefined,'合并不改写源块');
    const third = clean({所属:'丙'},'甲是丙的散修。');
    const conflicts=[];
    const [kept] = dedupeRoster(mergeCanonChunks([first,second,third,second]).canon.settings,{conflicts});
    assert.equal(kept.parent,undefined);
    assert.equal(kept.fields.所属,'乙\n丙');
    assert.equal(conflicts.some(c=>c.field==='parent'),true);
    const w={entities:[],context:{setting:{frozen:{canon:{bookEntities:[kept,{name:'乙',kind:'faction'},{name:'丙',kind:'faction'}]}}}}};
    seedBookEntities(w);
    assert.equal(w.entities.find(x=>x.name==='甲').parent,undefined);
});

test('不同含数字属性并列后，整行重复仍去重', () => {
    const [kept]=dedupeRoster([row({兵力:'1'}),row({兵力:'1,000'}),row({兵力:'1'})]);
    assert.equal(kept.fields.兵力,'1\n1,000');
});

test('属性拆半的类别冲突保留两份描述并进入最终诊断', () => {
    const merged=mergeCanonChunks([{canon:{settings:[row({身份:'散修'})]}},{canon:{settings:[{...row({性质:'门派'}),kind:'faction'}]}}]);
    const conflicts=[];
    const [kept]=dedupeRoster(merged.canon.settings,{conflicts});
    assert.equal(kept.kind,undefined);
    assert.deepEqual(kept.fields,{身份:'散修',性质:'门派'});
    assert.equal(conflicts.some(c=>c.field==='kind'),true);
});

for (const clash of [false,true]) {
    test('实际属性遍失败拆半保留结构主张及描述：冲突=' + clash, async () => {
        const q1='甲是散修。',q2='甲是乙的散修。',q3='甲是丙的散修。',qf='乙是门派。丙是门派。';
        const src=[q1,...Array.from({length:1199},(_,i)=>'甲线填充'+i+'：把材料撑到第一块后半段。'),q2,q3,qf,...Array.from({length:1800},(_,i)=>'其他填充'+i+'：材料超过大书分块下限。')].join('\n');
        let split=false,childCount=0;
        const r=await extractWorldSetting({sourceText:src,allowedSources:[{sourceId:'world',text:src}],extract:async prompt=>{
            const chunk=prompt.slice(prompt.indexOf('———— 设定原文如下 ————'));
            const entity=(name,kind,fields,q)=>({name,kind,fields,ev:{s:'S1',q}});
            if(!prompt.startsWith('你是世界属性')) return JSON.stringify({bookEntities:[...(chunk.includes(q1)?[entity('甲','character',{},q1)]:[]),...(chunk.includes(qf)?[entity('乙','faction',{},qf),entity('丙','faction',{},qf)]:[])]});
            if(!split&&chunk.includes(q1)&&chunk.includes(q2)){split=true;return '这不是 JSON';}
            if(split&&(chunk.includes(q1)||chunk.includes(q2)))childCount++;
            return JSON.stringify({entities:[...(chunk.includes(q1)?[entity('甲','character',{身份:'散修'},q1)]:[]),...(chunk.includes(q2)?[entity('甲','character',{所属:'乙'},q2)]:[]),...(clash&&chunk.includes(q3)?[entity('甲','character',{所属:'丙'},q3)]:[])]});
        }});
        assert.equal(r.ok,true,r.errors?.join(';'));
        assert.equal(split,true,'真实拆半必须发生');
        assert.ok(childCount>=2,'两个属性子块确实被调用');
        const kept=r.setting.frozen.canon.bookEntities.find(x=>x.name==='甲');
        assert.equal(kept.parent,clash?undefined:'乙');
        assert.equal(kept.fields.所属,clash?'乙\n丙':'乙');
        assert.equal(kept.fields.身份,'散修');
        const w={entities:[],context:{setting:r.setting}};
        seedBookEntities(w);
        assert.equal(w.entities.find(x=>x.name==='甲').parent,clash?undefined:'乙');
    });
}

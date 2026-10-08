import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTags, hasTagFacts } from '../src/tag-extract.js';
import { buildInjections, tagSpecText } from '../web/inject.js';
const ctx = { entities: [{id:'p',name:'小明',kind:'character'},{id:'s',name:'学校',kind:'faction'}] };
const read = body => extractTags('```tags\n'+body+'\n```', ctx);
test('v4 范围关联前后均可，未知原话完整保留，时间地点分别继承', () => {
 const f=read('【协议】4\n【影响范围】E1｜原文｜全体学生\n【此刻】08:15\n【场景：体育馆】\n【事件】E1｜公布规则｜已完成\n【类别】E1｜公示\n【当事人】E1｜小明、陌生人\n【公开范围】E1｜成员｜学校\n【影响范围】E1｜对象｜未知组织\n【此刻】09:00\n【场景：教室】\n【事件】E2｜课已结束｜已完成');
 assert.equal(f.protocol,4); assert.equal(f.events.length,2);
 assert.deepEqual(f.events[0].actors,[{name:'小明',ref:'p'},{name:'陌生人'}]);
 assert.deepEqual(f.events[0].affected,[{kind:'text',text:'全体学生'},{kind:'entity',text:'未知组织'}]);
 assert.deepEqual(f.events[0].audience,[{kind:'members',text:'学校',ref:'s'}]);
 assert.equal(f.events[0].at,'08:15');assert.equal(f.events[1].at,'09:00');assert.equal(f.events[1].location,'教室');
 assert.equal('participantIds' in f.events[0],false);assert.deepEqual(f.actedIds,[]);
});
test('引用不建立事件；条件关联先后、时间空位和替代保留',()=>{
 const f=read('【协议】4\n【引用】ev_1\n【条件范围】C1｜原文｜全体学生\n【条件时间】C1｜下周｜\n【替代条件】C1｜cond_old\n【持续条件】C1｜E1｜禁止携带手机｜尚未生效\n【事件】E1｜新规则公布｜已完成\n【条件变更】cond_old｜已结束｜E1');
 assert.deepEqual(f.references,['ev_1']);assert.equal(f.conditionUpdates[0].effectiveFrom,'下周');assert.equal(f.conditionUpdates[0].supersedes,'cond_old');assert.equal(f.conditionUpdates[0].scope[0].text,'全体学生');assert.equal(f.conditionsBad.length,0);
 assert.ok(hasTagFacts(read('【协议】4\n【引用】ev_1')));
});
test('坏新版声明与未匹配关联逐项诊断且不能降级',()=>{
 for(const declaration of ['', '【协议】3\n','【协议】5\n','【协议】4\n【协议】3\n']){
 const f=read(declaration+'【类别】E1｜公示\n【事件】E1｜公告｜小明｜已完成\n【变化】小明｜实力｜金丹｜E1');assert.equal(f.events.length,0);assert.equal(f.changes.length,0);assert.ok(f.eventsBad.length);
 }
 const f=read('【协议】4\n【类别】X｜公示\n【条件范围】X｜原文｜众人');assert.equal(f.eventsBad[0].why,'eventRef');assert.equal(f.conditionsBad[0].why,'conditionRef');
});
test('成员不猜角色；获知只写行动；v3保持兼容',()=>{
 const f=read('【协议】4\n【事件】E1｜公告｜已完成\n【影响范围】E1｜成员｜小明\n【影响范围】E1｜成员｜未知组织\n【行动】小明｜看到公告后安排出行');assert.deepEqual(f.events[0].affected,[{kind:'text',text:'小明'},{kind:'text',text:'未知组织'}]);assert.deepEqual(f.actedIds,['p']);assert.equal(f.events.length,1);
 assert.deepEqual(read('【协议】3\n【事件】E1｜抵达｜小明｜已完成').events[0].participantIds,['p']);
});
test('注入提供v4及当前条件一次，不复述原因公告与结束条件',()=>{
 const world={entities:[],conditions:[{id:'c1',statement:'禁止手机',state:'planned',eventRef:'e1'},{id:'c1',statement:'禁止手机',state:'planned'},{id:'c2',statement:'旧条文',state:'ended'}],events:[{id:'e1',title:'学校公告原文',source:'chat'}]};
 const text=Object.values(buildInjections(world,{spec:false,roster:false})).join('\n');assert.equal(text.split('禁止手机').length-1,1);assert.ok(text.includes('c1'));assert.ok(!text.includes('旧条文'));assert.ok(!text.includes('学校公告原文'));assert.ok(tagSpecText().includes('【协议】4'));
});
test('没有前置时间不回填；条件与结果坏形状不会混入正文',()=>{
 const f=read('【协议】4\n【事件】E0｜旧事已成｜已完成\n【此刻】中午\n【事件】E1｜新结果｜已完成｜ev_old\n【变化】小明｜实力｜金丹｜E1\n【变化】小明｜身份｜学生｜E_missing\n【持续条件】C1｜E1｜完整条文｜有效\n【条件时间】C1｜｜次年\n【持续条件】C2｜E_missing｜坏原因｜有效\n【条件范围】C1｜胡乱类型｜众人\n【事件】E2｜坏状态｜继续');
 assert.equal(f.events[0].at,undefined);assert.equal(f.events[1].at,'中午');assert.deepEqual(f.events[1].causeIds,['ev_old']);
 assert.equal(f.changes.length,1);assert.equal(f.changes[0].value,'金丹');assert.equal(f.changes[0].eventLocalId,'E1');assert.equal(f.changesBad[0].why,'eventRef');
 assert.equal(f.conditionUpdates.length,1);assert.equal(f.conditionUpdates[0].effectiveFrom,undefined);assert.equal(f.conditionUpdates[0].effectiveUntil,'次年');
 assert.deepEqual(f.conditionsBad.map(x=>x.why),['eventRef','shape']);assert.equal(f.eventsBad[0].why,'shape');
});
test('当前条件成员按现有关系变化，不改原范围或历史公告',()=>{
 const condition={id:'c1',state:'active',statement:'现行条文',scope:[{kind:'members',text:'学校',ref:'s'}]};
 const world={conditions:[condition],entities:[{id:'s',name:'学校',kind:'faction'},{id:'p',name:'小明',kind:'character',parent:'学校'}]};
 const first=buildInjections(world,{spec:false,roster:false}).tags;assert.ok(first.includes('当前已确认部分：小明'));
 world.entities.push({id:'q',name:'小红',kind:'character',parent:'学校'});const second=buildInjections(world,{spec:false,roster:false}).tags;assert.ok(second.includes('小明、小红'));assert.deepEqual(condition.scope,[{kind:'members',text:'学校',ref:'s'}]);
});
test('空当事人拒绝而不声明空集合',()=>{
 const f=read('【协议】4\n【事件】E1｜公告｜已完成\n【当事人】E1｜、、');
 assert.equal(f.events[0].actors,undefined);assert.deepEqual(f.eventsBad.map(x=>x.why),['shape']);
});
test('条件时间和替代冲突保留首个合法声明，相同声明幂等',()=>{
 const f=read('【协议】4\n【事件】E1｜新规则公布｜已完成\n【当事人】E1｜、、\n【持续条件】C1｜E1｜现行条文｜有效\n【条件时间】C1｜明日｜月底\n【条件时间】C1｜明日｜月底\n【条件时间】C1｜后日｜月底\n【替代条件】C1｜cond_old\n【替代条件】C1｜cond_old\n【替代条件】C1｜cond_other');
 assert.equal(f.conditionUpdates[0].effectiveFrom,'明日');assert.equal(f.conditionUpdates[0].effectiveUntil,'月底');assert.equal(f.conditionUpdates[0].supersedes,'cond_old');
 assert.equal(f.conditionsBad.length,2);assert.ok(f.conditionsBad.every(x=>x.why==='conflict'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_PROTOCOL, resolveScopes, eventDetails, eventEntityIds, checkEventContract, applyConditionUpdates } from '../src/event-contract.js';
import { registerDialogueFacts, settleTick } from '../src/settle.js';
import { checkWorldStep } from '../src/check-step.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { gateWorldStep } from '../src/gate.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
const world = () => ({entities:[{id:'org',name:'学校',kind:'faction'},{id:'a',name:'甲',kind:'character',parent:'学校'},{id:'b',name:'乙',kind:'character'}],events:[{id:'ev_1_1'}],conditions:[],meta:{tick:1}});
test('公告没有当事人，影响和公开不混同，历史成员不回填',()=>{
 const w=world(); const ev={eventProtocol:EVENT_PROTOCOL,title:'公告',pending:false,affected:resolveScopes([{kind:'members',text:'学校成员',ref:'org'},{kind:'text',text:'全体学生'}],w,1),audience:[{kind:'entity',text:'乙',ref:'b'}]};
 assert.deepEqual(checkEventContract({...ev,affected:[{kind:'members',text:'学校成员',ref:'org'}]},4),[]); assert.deepEqual(eventEntityIds(ev,w),['a']); w.entities[2].parent='学校'; assert.deepEqual(eventEntityIds(ev,w),['a']); assert.equal(eventDetails(ev).affected[1].text,'全体学生');
});
const ledger = () => ({version:1,context:{world:'学校',tension:0.5,positions:['未明']},entities:world().entities.map(e=>({...e,location:'未明'})),events:[],agendas:[],chronicle:[],milestones:[],weights:{},meta:{tick:0,simLog:[]}});
const empty = () => ({actions:[],newEvents:[],agendaAdvances:[],newAgendas:[],agendaCancels:[],newEntities:[],entityFates:[]});
test('聊天v4无人物公告逐件时间落账，关联变化不创建混合字段，条件解析消息编号',()=>{
 const w=ledger(); const r=registerDialogueFacts(w,{tick:1,facts:{protocol:4,events:[{localId:'E1',title:'公告',pending:false,at:'上午',affected:[{kind:'members',text:'学校成员',ref:'org'}]},{localId:'E2',title:'天降大雨',pending:false,at:'下午'}],changes:[{entityId:'a',field:'身份',value:'学生',eventLocalId:'E1'}],conditionUpdates:[{op:'create',localId:'C1',eventRef:'E1',statement:'规则原文',state:'active'}]}});
 assert.equal(r.events,2); assert.equal(r.conditions,1); assert.equal(w.events[0].timeMark,'上午'); assert.equal(w.events[1].timeMark,'下午'); assert.equal(w.events[0].ripples,undefined); assert.equal(w.events[0].actors[0].ref,'a'); assert.equal(w.conditions[0].eventRef,w.events[0].id); assert.deepEqual(r.actedIds,[]); assert.equal(validate(w,ssotSchema).ok,true);
});
test('世界v4同轮条件落账，旧账无新字段保持形状，新详情归档保留',()=>{
 const w=ledger(); const step={...empty(),eventProtocol:4,newEvents:[{title:'公告',source:{type:'state'},pending:false,reportedContent:'校方声称',affected:[{kind:'members',text:'学校成员',ref:'org'}]}],conditionUpdates:[{op:'create',localId:'C1',eventRef:'ev_1_1',statement:'规则',state:'active'}]};
 assert.equal(checkWorldStep(step,w).ok,true); const r=settleTick({ssot:w,step}); assert.equal(r.ok,true); assert.equal(r.ssot.events[0].closed,true); assert.equal(r.ssot.events[0].ripples,undefined); assert.equal(r.ssot.conditions[0].eventRef,'ev_1_1');
 r.ssot.meta.tick=25; const archived=settleTick({ssot:r.ssot,step:empty()}); const row=archived.ssot.milestones.flatMap(m=>m.rows||[]).find(e=>e.id==='ev_1_1'); assert.deepEqual(row.affected[0].resolution,{knownIds:['a'],asOfTick:1}); assert.equal(row.reportedContent,'校方声称'); assert.equal(validate(archived.ssot,ssotSchema).ok,true);
 assert.equal(Object.hasOwn(settleTick({ssot:ledger(),step:empty()}).ssot,'conditions'),false);
});
test('坏条件逐项净化，删第一事件不能把条件错绑到第二件',()=>{
 const step={...empty(),eventProtocol:4,newEvents:[{title:'坏事件',source:{type:'state'},pending:false,ripples:[]},{title:'好事件',source:{type:'state'},pending:false}],conditionUpdates:[{op:'create',localId:'C1',eventRef:'ev_1_1',statement:'坏事件规则',state:'active'},{op:'create',localId:'C2',eventRef:'ev_1_2',statement:'好事件规则',state:'active'},{op:'create',localId:'C3',eventRef:'missing',statement:'悬空',state:'active'}]};
 const r=dropInvalidProposals(step,ledger()); assert.equal(r.step.newEvents.length,1); assert.equal(r.step.conditionUpdates.length,1); assert.equal(r.step.conditionUpdates[0].statement,'好事件规则'); assert.equal(r.step.conditionUpdates[0].eventRef,'ev_1_1'); assert.equal(checkWorldStep(r.step,ledger()).ok,true);
});
test('公开范围不解除静默，有明确原因与行动缘由可反应',()=>{
 const w=ledger(); w.events=[{id:'ev_0_1',title:'公告',source:{type:'state'},closed:true,eventProtocol:4,audience:[{kind:'entity',text:'乙',ref:'b',resolution:{knownIds:['b'],asOfTick:0}}]}];
 const step={...empty(),actions:[{entity:'b',verb:'安排'}]}; assert.equal(gateWorldStep(step,w).step.actions.length,0);
 step.newAgendas=[{entity:'b',goal:'安排',visibility:'known',source:{type:'event',ref:'ev_0_1'},note:'查阅公告后安排'}]; assert.equal(gateWorldStep(step,w).step.actions.length,1);
});
test('无前置时间的v4事件不继承消息后面的全局时刻',()=>{
 const w=ledger(); registerDialogueFacts(w,{tick:1,facts:{protocol:4,at:'下午',events:[{localId:'E1',title:'之前事件',pending:false},{localId:'E2',title:'之后事件',pending:false,at:'下午'}]}});
 assert.equal(Object.hasOwn(w.events[0],'timeMark'),false); assert.equal(w.events[1].timeMark,'下午');
});
test('静默门删除第一件plot事件后，条件只绑定幸存的实际原因',()=>{
 const w=ledger(); w.agendas=[{id:'old_b',owner:'b',goal:'旧事',closed:true,source:{type:'state'}}];
 const step={...empty(),eventProtocol:4,newEvents:[{title:'静默者提议',source:{type:'plot',ref:'old_b'},pending:false},{title:'确立规则',source:{type:'state'},pending:false}],conditionUpdates:[{op:'create',localId:'C1',eventRef:'ev_1_1',statement:'不该出现',state:'active'},{op:'create',localId:'C2',eventRef:'ev_1_2',statement:'实际规则',state:'active'}]};
 const r=settleTick({ssot:w,step}); assert.equal(r.ok,true); assert.equal(r.ssot.conditions.length,1); assert.equal(r.ssot.conditions[0].statement,'实际规则'); assert.equal(r.ssot.conditions[0].eventRef,'ev_1_1'); assert.ok(r.stage.warnings.some(s=>s.includes('条件原因事件已被丢弃')));
});
test('无协议、新旧混合和模型填 resolution 拒绝',()=>{
 assert.ok(checkEventContract({affected:[]}).length); assert.ok(checkEventContract({pending:false,ripples:[]},4).length); assert.ok(checkEventContract({pending:false,affected:[{kind:'text',text:'学生',resolution:{knownIds:[]}}]},4).length);
});
test('条件必须有因，状态留历史，结束不能再激活，替代保留旧条文',()=>{
 const w=world(); let r=applyConditionUpdates(w,[{op:'create',localId:'C1',eventRef:'missing',statement:'规则',state:'active'},{op:'create',localId:'C2',eventRef:'ev_1_1',statement:'旧规则',state:'planned'}],{tick:1});
 assert.equal(r.rejected.length,1); const id=w.conditions[0].id;
 applyConditionUpdates(w,[{op:'state',conditionRef:id,eventRef:'ev_1_1',state:'active'},{op:'create',localId:'C3',eventRef:'ev_1_1',statement:'新规则',state:'active',supersedes:id}],{tick:2});
 assert.equal(w.conditions[0].statement,'旧规则'); assert.equal(w.conditions[0].eventRef,'ev_1_1'); assert.equal(w.conditions[0].state,'ended'); assert.equal(w.conditions[0].changes.length,3);
 assert.deepEqual(w.conditions[0].changes[0],{state:'planned',eventRef:'ev_1_1',tick:1});
 assert.equal(applyConditionUpdates(w,[{op:'state',conditionRef:id,eventRef:'ev_1_1',state:'active'}],{tick:3}).rejected.length,1);
});
test('v4未履行义务不随源盘算结清，旧plot事件仍自动闭合',()=>{
 const w=ledger(); w.agendas=[{id:'a_org',owner:'org',goal:'发布约定',stage:'准备',visibility:'known',progress:0,maxSteps:4,closed:false,memory:{promises:[],done:[],blocked:[],turnsAlive:0},source:{type:'state'}}];
 w.events=[{id:'ev_0_1',title:'旧plot事项',source:{type:'plot',ref:'a_org'},closed:false,links:{up:[],down:[]}},{id:'ev_0_2',title:'仍需兑现的约定',source:{type:'plot',ref:'a_org'},eventProtocol:4,closed:false,links:{up:[],down:[]}}];
 const step={...empty(),eventProtocol:4,agendaCancels:[{agendaId:'a_org',reason:'发布安排已结束'}],newEvents:[{title:'新承诺仍需履行',source:{type:'plot',ref:'a_org'},pending:true}]};
 const r=settleTick({ssot:w,step}); assert.equal(r.ok,true); assert.equal(r.ssot.agendas[0].closed,true); assert.equal(r.ssot.events.find(e=>e.id==='ev_0_1').closed,true); assert.equal(r.ssot.events.find(e=>e.id==='ev_0_2').closed,false); assert.equal(r.ssot.events.find(e=>e.id==='ev_1_1').closed,false);
 const explicitlyClosed=settleTick({ssot:r.ssot,step:{...empty(),eventClosures:[{event:'ev_0_2',why:'约定已经兑现'}]}}); assert.equal(explicitlyClosed.ok,true); assert.equal(explicitlyClosed.ssot.events.find(e=>e.id==='ev_0_2').closed,true);
});
test('v4未决后果不因无人接线平息，旧ripple按原规则关闭',()=>{
 const w=ledger(); w.meta.tick=10; w.events=[{id:'ev_1_1',title:'已完成原因',source:{type:'state'},closed:true,closedAt:1,links:{up:[],down:['ev_1_2','ev_1_3']}},{id:'ev_1_2',title:'旧涟漪',source:{type:'ripple',ref:'ev_1_1'},closed:false,links:{up:['ev_1_1'],down:[]}},{id:'ev_1_3',title:'仍未履行事项',source:{type:'ripple',ref:'ev_1_1'},eventProtocol:4,closed:false,links:{up:['ev_1_1'],down:[]}}];
 const r=settleTick({ssot:w,step:empty()}); assert.equal(r.ok,true); assert.equal(r.ssot.events.find(e=>e.id==='ev_1_2').closed,true); assert.equal(r.ssot.events.find(e=>e.id==='ev_1_3').closed,false);
 const explicitlyClosed=settleTick({ssot:r.ssot,step:{...empty(),eventClosures:[{event:'ev_1_3',why:'义务履行'}]}}); assert.equal(explicitlyClosed.ok,true); assert.equal(explicitlyClosed.ssot.events.find(e=>e.id==='ev_1_3').closed,true);
});
test('同轮合法公告允许有明确来源和缘由的静默人物反应',()=>{
 const w=ledger(); const step={...empty(),eventProtocol:4,newEvents:[{title:'封路告示已发布',source:{type:'state'},pending:false}],actions:[{entity:'b',verb:'改道'}],newAgendas:[{entity:'b',goal:'改道',visibility:'known',source:{type:'event',ref:'ev_1_1'},note:'看到本轮封路告示后改道'}]};
 assert.equal(checkWorldStep(step,w).ok,true); const g=gateWorldStep(step,w); assert.equal(g.step.actions.length,1); assert.equal(g.step.newAgendas.length,1);
 const settled=settleTick({ssot:w,step}); assert.equal(settled.ok,true); assert.ok(settled.ssot.agendas.some(a=>a.owner==='b'&&a.source.ref==='ev_1_1'));
});
test('未来、越界、无缘由与非法原因事件不能提供同轮反应资格',()=>{
 for (const [ref,note,event] of [['ev_2_1','反应',{title:'公告',source:{type:'state'},pending:false}],['ev_1_9','反应',{title:'公告',source:{type:'state'},pending:false}],['ev_1_1','',{title:'公告',source:{type:'state'},pending:false}],['ev_1_1','反应',{title:'公告',source:{type:'plot',ref:'missing'},pending:false}],['ev_1_1','反应',{title:'公告',source:{type:'state'},pending:false,ripples:[]}]] ) {
  const g=gateWorldStep({...empty(),eventProtocol:4,newEvents:[event],actions:[{entity:'b',verb:'反应'}],newAgendas:[{entity:'b',goal:'反应',visibility:'known',source:{type:'event',ref},note}]},ledger()); assert.equal(g.step.actions.length,0); assert.equal(g.step.newAgendas.length,0);
 }
});
test('删去静默plot原因不放行反应，幸存公告因按原身份改写不会漂移',()=>{
 const w=ledger(); w.agendas=[{id:'old_a',owner:'a',goal:'旧事',closed:true,source:{type:'state'}}];
 for (const [ref,count] of [['ev_1_1',0],['ev_1_2',1]]) {
  const step={...empty(),eventProtocol:4,newEvents:[{title:'被删的plot',source:{type:'plot',ref:'old_a'},pending:false},{title:'真实公告',source:{type:'state'},pending:false}],actions:[{entity:'b',verb:'反应'}],newAgendas:[{entity:'b',goal:'反应',visibility:'known',source:{type:'event',ref},note:'看到告示后安排'}]};
  const g=gateWorldStep(step,w); assert.equal(g.step.actions.length,count); assert.equal(g.step.newAgendas.length,count); if (count) assert.equal(g.step.newAgendas[0].source.ref,'ev_1_1');
 }
});
test('超出最终事件额度的原因不能让静默人物行动或起线',()=>{
 const w=ledger(); const events=Array.from({length:7},(_,i)=>({title:`公告${i+1}`,source:{type:'state'},pending:false}));
 const g=gateWorldStep({...empty(),eventProtocol:4,newEvents:events,actions:[{entity:'b',verb:'反应'}],newAgendas:[{entity:'b',goal:'反应',visibility:'known',source:{type:'event',ref:'ev_1_7'},note:'看到第七件公告后安排'}]},w); assert.equal(g.step.actions.length,0); assert.equal(g.step.newAgendas.length,0);
});

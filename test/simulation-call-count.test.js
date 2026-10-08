import test from 'node:test';
import assert from 'node:assert/strict';
import {runTick} from '../src/tick.js';

const fixture=()=>({version:1,context:{world:'保护验证',positions:['家中'],playerId:'p'},
    entities:[{id:'p',name:'玩家',kind:'character',location:'家中'},
        {id:'n',name:'同伴',kind:'character',location:'家中'},
        {id:'t',name:'守卫',kind:'character',location:'家中'}],
    weights:{},agendas:[],events:[],chronicle:[],meta:{tick:0,simLog:[]}});
const step=id=>({actions:[{entity:id,verb:'擅自出门'},{entity:'t',verb:'守门'}],
    newEvents:[{title:'守卫在门前巡视',source:{type:'state'},pending:false}],
    agendaAdvances:[],newAgendas:[],agendaCancels:[],newEntities:[],entityFates:[]});

for(const mode of ['玩家','手动禁止','本轮行动'])test(`${mode}保护保留程序拦截，有内容推进也不增加模型调用`,async()=>{
    const w=fixture();let id='p',dialogue='';
    if(mode!=='玩家'){delete w.context.playerId;id='n';}
    if(mode==='手动禁止')w.entities[1].simulationBlocked=true;
    if(mode==='本轮行动')dialogue='```tags\n【行动】同伴｜巡视\n```';
    const before=JSON.stringify(w);let calls=0;
    const result=await runTick({ssot:w,dialogue,transport:async prompt=>{
        calls++;if(calls>1)throw Error('不允许增加第二次模型调用');
        assert.match(prompt,/protectedCharacters/);
        return JSON.stringify(step(id));
    }});
    assert.equal(calls,1,'保护不增加调用');assert.equal(result.ok,true,result.error);
    assert.equal(result.ssot.meta.simLog.at(-1).calls,1);
    assert.equal(result.ssot.entities.find(e=>e.id===id).location,'家中');
    assert.ok(result.healed.dropped.some(x=>x.family==='actions' && x.index===0), '越权结构提案仍被程序拒绝');
    assert.equal(JSON.stringify(w),before);
});

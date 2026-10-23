// Fixed AB evidence becomes formal initial state without model calls or spawn quotas.
import {sha256Hex} from './browser-capabilities.js';
import {canonicalSourceJson} from './source-records.js';

const digest=value=>sha256Hex(canonicalSourceJson(value));
export const initialEventEvidenceId=(publication,id)=>'source-initial-event:'+digest([publication.library_id,publication.version,id]);
const planEvidenceId=(publication,id)=>'source-plan:'+digest([publication.library_id,publication.version,id]);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;

export function initialRecordText(record,{plan=false}={}){
    let text=record.text;
    if(plan&&nonempty(record.goal)&&!text.includes(record.goal))text+='；目标：'+record.goal;
    if(nonempty(record.qualifiers)&&!text.includes(record.qualifiers))text+='；'+record.qualifiers;
    return text;
}

export function sourceInitialState(publication,index,{fingerprint,extractedAt}){
    const out={events:[],agendas:[],records:[],diagnostics:[]},initial=publication.ab_initial;
    if(initial===undefined)return out;
    if(!initial||initial.version!==1||!Array.isArray(initial.events)||!Array.isArray(initial.plans))throw Error('Invalid AB initial state version or arrays');
    const names=new Map([...index.entities,...index.locations]),registrationOnly=publication.ab_registration===1;
    const seen=new Set();
    const idFor=(kind,record)=>{
        if(!record||!nonempty(record.id)||!nonempty(record.text))throw Error('Initial '+kind+' requires source id and text');
        const key=kind+':'+record.id;
        if(seen.has(key))throw Error('Duplicate initial source record '+key);
        seen.add(key);
        return (kind==='event'?'ev_0_source_':'a_0_source_')+digest([publication.library_id,publication.version,record.id]);
    };
    for(const record of initial.events){
        const id=idFor('event',record);
        if(record.status!=='ongoing')continue;
        if(!Array.isArray(record.participant_ids))throw Error('Initial event participant_ids must be an array');
        for(const participant of record.participant_ids)if(!registrationOnly&&!names.has(participant))throw Error('Initial event participant reference missing: '+participant);
        if(!registrationOnly&&record.location_id!=null&&!index.locations.has(record.location_id))throw Error('Initial event location reference missing: '+record.location_id);
        const ref=initialEventEvidenceId(publication,record.id);
        const event={id,eventProtocol:4,title:initialRecordText(record),source:{type:'seed',ref},producer:'setting',recordType:'state',
            actors:[...new Set(record.participant_ids)].filter(participant=>index.entities.has(participant)).map(participant=>({ref:participant,name:index.entities.get(participant).name})),
            seedFrom:{quote:record.text,fingerprint,at:extractedAt,tick:0},links:{up:[],down:[]},closed:false};
        if(record.location_id!=null&&index.locations.has(record.location_id))event.position=index.locations.get(record.location_id).name;
        if(nonempty(record.story_time))event.timeMark=record.story_time;
        out.events.push(event);
        out.records.push({id,kind:'event',source_record_id:record.id,source_ref:ref});
    }
    for(const record of initial.plans){
        const id=idFor('agenda',record);
        if(record.status!=='pending')continue;
        if(!names.has(record.subject_id)){
            if(!registrationOnly)throw Error('Initial plan owner reference missing: '+record.subject_id);
            out.diagnostics.push({source_record_id:record.id,reason:'Unbound plan owner remains in source evidence; no entity is fabricated'});
            continue;
        }
        if(!index.entities.has(record.subject_id)){
            out.diagnostics.push({source_record_id:record.id,reason:'Location plan remains source evidence; no character owner is fabricated'});
            continue;
        }
        if(!nonempty(record.goal))throw Error('Initial plan goal must be nonempty');
        if(record.visibility!==undefined&&!['known','concealed'].includes(record.visibility))throw Error('Invalid explicit initial plan visibility');
        const ref=planEvidenceId(publication,record.id);
        const goal=initialRecordText(record,{plan:true});
        // Source text does not provide a simulation deadline or a plan stage.
        // Missing visibility stays missing: knowledge of the source is not public action.
        const agenda={id,owner:record.subject_id,goal,
            ...(record.visibility===undefined?{}:{visibility:record.visibility}),source:{type:'state',ref},
            progress:0,memory:{promises:[],done:[],blocked:[],turnsAlive:0}};
        out.agendas.push(agenda);
        out.records.push({id,kind:'agenda',source_record_id:record.id,source_ref:ref});
    }
    return out;
}

import {sha256Hex} from '../src/browser-capabilities.js';
import {splitRecord,joinRecord,validateRecordPartial} from './world-record-store.js';
const kinds={entities:'entity',agendas:'agenda',events:'event',conditions:'condition',relations:'relation',chronicle:'chronicle'};
const clone=value=>structuredClone(value);
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const isRecordCandidate=value=>value?.$sw2RecordCandidate===1;
const validTable=rows=>Array.isArray(rows)&&rows.every(row=>row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string'&&row.id)&&new Set(rows.map(row=>row.id)).size===rows.length;
export function expandRecordCandidate(descriptor,recordBodies){
 if(!isRecordCandidate(descriptor)||!descriptor.core||!descriptor.tables)throw Error('Invalid candidate record descriptor');
 const bodies=recordBodies instanceof Map?recordBodies:new Map(recordBodies.map(row=>[row.digest,row]));
 const get=digest=>{const row=bodies.get(digest);if(!row||sha256Hex(canonical(row.value))!==digest)throw Error('Candidate record body missing or corrupt: '+digest);return row.value};
 const world=clone(descriptor.core);
 for(const [table,refs]of Object.entries(descriptor.tables)){
  if(!kinds[table]||!Array.isArray(refs))throw Error('Invalid candidate record table');
  const ids=new Set();
  world[table]=refs.map(ref=>{const row=joinRecord(get(ref.payload_digest),get(ref.state_digest));if(row.id!==ref.id||ids.has(row.id))throw Error('Candidate record identity conflict');ids.add(row.id);return row;});
 }
 return world;
}
export function createRecordCandidates(db){
 async function pack(world){
  const core=clone(world),tables={};
  async function put(value){const digest=sha256Hex(canonical(value)),old=await db.recordBodies.get(digest);if(old&&canonical(old.value)!==canonical(value))throw Error('Candidate body hash conflict');if(!old)await db.recordBodies.add({digest,value});return digest;}
  for(const [table,kind]of Object.entries(kinds)){
   if(!validTable(world[table]))continue;
   delete core[table];tables[table]=[];
   for(const row of world[table]){const {payload,state}=splitRecord(row,kind);tables[table].push({id:row.id,payload_digest:await put(payload),state_digest:await put(state)});}
  }
  return {$sw2RecordCandidate:1,core,tables};
 }
 async function read(descriptor){
  const digests=[...new Set(Object.values(descriptor.tables??{}).flatMap(rows=>rows.flatMap(row=>[row.payload_digest,row.state_digest])))];
  const bodies=await db.recordBodies.bulkGet(digests);return expandRecordCandidate(descriptor,bodies.filter(Boolean));
 }
 return {pack,read};
}

export function mergePartialCandidate(world,previous,partial){
 validateRecordPartial(partial,world);const result=clone(world);
 for(const [table,value]of Object.entries(partial??{})){
  if(value.complete!==false)continue;
  if(!previous||!validTable(previous[table])||!validTable(world[table]))throw Error('Invalid partial candidate base or table');
  const loaded=new Set(value.ids),supplied=new Map(world[table].map(r=>[r.id,r])),rows=[];
  for(const row of previous[table]){if(supplied.has(row.id)){rows.push(supplied.get(row.id));supplied.delete(row.id);}else if(!loaded.has(row.id))rows.push(row);}
  rows.push(...supplied.values());result[table]=rows;
 }
 return result;
}

export {validateRecordPartial} from './world-record-store.js';

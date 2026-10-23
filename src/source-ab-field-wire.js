// Request-local field aliases change transport only. Free text and stored field identities stay intact.
const clone=structuredClone;
const rows=value=>Array.isArray(value)?value:[];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function freezeAbFieldWire(input,fieldIds){
 const reserved=new Set(fieldIds),reserve=value=>{if(typeof value==='string')reserved.add(value);};
 for(const field of rows(input.field_table?.fields))reserve(field.id);
 for(const group of rows(input.groups)){
  reserve(group.field?.id);
  for(const field of rows(group.fields))reserve(field.id);
  for(const field of rows(group.field_declarations)){reserve(field.local_id);reserve(field.ref);}
  for(const candidate of rows(group.candidates))reserve(candidate.field_id);
 }
 let index=0;const pairs=[];
 for(const id of [...new Set(fieldIds)].sort()){
  let short;do{short='f'+(++index);}while(reserved.has(short));
  reserved.add(short);pairs.push([short,id]);
 }
 return {version:1,pairs};
}
export function encodeAbFieldInput(input,stage,wire){
 const out=clone(input);if(wire?.version!==1)return out;
 const aliases=new Map(wire.pairs.map(([short,id])=>[id,short]));
 const replace=(record,key)=>{if(object(record)&&Object.hasOwn(record,key)&&aliases.has(record[key]))record[key]=aliases.get(record[key]);};
 if(stage==='ab-a')for(const field of rows(out.field_table?.fields))replace(field,'id');
 if(stage==='ab-organize')for(const group of rows(out.groups)){
  replace(group.field,'id');
  for(const field of rows(group.fields))replace(field,'id');
  for(const candidate of rows(group.candidates))replace(candidate,'field_id');
 }
 return out;
}
export function decodeAbFieldResponse(response,stage,wire){
 const out=clone(response);if(wire?.version!==1||!object(out))return out;
 const originals=new Map(wire.pairs),decode=value=>originals.has(value)?originals.get(value):value;
 if(stage==='ab-a')for(const attribute of rows(out.attributes))if(object(attribute)&&Object.hasOwn(attribute,'field_id'))attribute.field_id=decode(attribute.field_id);
 if(stage==='ab-organize')for(const group of rows(out.groups))for(const binding of rows(group?.bindings))if(object(binding)&&binding.slot==='field_id'&&Array.isArray(binding.ids))binding.ids=binding.ids.map(decode);
 return out;
}

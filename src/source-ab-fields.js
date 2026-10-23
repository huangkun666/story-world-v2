// AB's unified definitions already distinguish meanings. Keep those identities through user edits.
import {normalizeFieldDefinition} from './source-field-table.js';
import {SOURCE_AB_PROTOCOL} from './source-ab-contract.js';
export function collectAbFieldReview(groups){
 const candidates=[];
 for(const group of groups){
  if(group.protocol!==SOURCE_AB_PROTOCOL)throw TypeError('AB字段候选协议不一致');
  for(const raw of group.fields)candidates.push(raw.source_optional?structuredClone(raw):normalizeFieldDefinition(raw,{allowedSources:group.refs}));
 }
 if(candidates.some(f=>!f.source_optional)&&new Set(candidates.map(f=>f.id)).size!==candidates.length)throw TypeError('AB字段候选编号重复');
 return {candidates,proposals:structuredClone(candidates),
  definition_variants:candidates.map(f=>({field_id:f.id,variants:[structuredClone(f)]})),
  scope_counts:Object.fromEntries(['character','faction','location'].map(k=>[k,candidates.filter(f=>f.kinds.includes(k)).length]))};
}

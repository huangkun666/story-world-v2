// Stable field identity is name + applicable kinds. Wording variants are review evidence,
// never new writable fields. Disjoint scopes remain separate even when their text is equal.
import {normalizeFieldDefinition} from './source-field-table.js';
import {canonicalSourceJson} from './source-records.js';
export function collectWorkspaceFields(groups){
    const proposals=[],byName=new Map();
    for(const group of groups)for(const raw of group.fields){const field=normalizeFieldDefinition(raw,{allowedSources:group.refs});proposals.push(field);if(!byName.has(field.name))byName.set(field.name,[]);byName.get(field.name).push(field);}
    const candidates=[],definition_variants=[];
    for(const [name,fields] of byName){
        const scopes=new Map();
        for(const kind of ['character','faction','location']){
            const applicable=fields.filter(f=>f.kinds.includes(kind));if(!applicable.length)continue;
            const signature=canonicalSourceJson([...new Set(applicable.map(f=>canonicalSourceJson([f.meaning,f.kinds])))].sort());
            if(!scopes.has(signature))scopes.set(signature,{kinds:[],fields:applicable});scopes.get(signature).kinds.push(kind);
        }
        for(const group of scopes.values()){
            const meanings=[...new Set(group.fields.map(f=>f.meaning))],sources=[...new Set(group.fields.flatMap(f=>f.sources))];
            const meaning=meanings.length===1?meanings[0]:'原文候选说明（请核对是否同义；不同义请改名或拆分）：\n'+meanings.map((m,i)=>(i+1)+'. '+m).join('\n');
            const candidate=normalizeFieldDefinition({name,meaning,kinds:group.kinds,sources});candidates.push(candidate);
            definition_variants.push({field_id:candidate.id,variants:structuredClone(group.fields)});
        }
    }
    return {candidates,proposals,definition_variants,scope_counts:Object.fromEntries(['character','faction','location'].map(k=>[k,candidates.filter(f=>f.kinds.includes(k)).length]))};
}

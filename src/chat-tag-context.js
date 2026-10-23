import {resolveChatReferences} from './chat-world-context.js';
import {readWorldFieldSchema,worldWritablePropertyFields} from './source-field-table.js';
// Identity resolution is internal; no bulk roster is needed by the chat model.
export function relevantRosterText(){return ''}
export function relevantFieldText(world,query=''){
 if(!world)return '';
 const ids=new Set(resolveChatReferences(world,query).entityIds),schema=readWorldFieldSchema(world);
 const entities=(world.entities??[]).filter(e=>ids.has(e.id)&&['character','faction'].includes(e.kind));
 const labels={character:'人物',faction:'组织',location:'地点'};
  const alreadyDefined=new Set(worldWritablePropertyFields(world).map(f=>f.id));
  const fields=schema.fields.filter(f=>f.enabled!==false&&!alreadyDefined.has(f.id)&&entities.some(e=>f.kinds.includes(e.kind)&&Object.hasOwn(e,f.storageKey)));
 return fields.length?'\n\n【相关属性含义】\n'+fields.map(f=>f.name+'（'+f.kinds.map(k=>labels[k]).join('／')+'）'+(f.meaning?'：'+f.meaning:'')).join('\n'):'';
}

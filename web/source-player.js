import {sourceWorld} from '../src/source-world.js';
export function playerMatches(records,name){const text=String(name??'').trim();if(!text)return [];return records.filter(r=>r.kind==='character'&&(r.name===text||(r.aliases??[]).includes(text)));}
export function initializePlayerWorld(bundle,options){
 const result=sourceWorld(bundle,options),name=String(options?.playerName??'').trim();if(options?.playerId||!name)return result;
 const matches=playerMatches(result.world.entities,name);if(matches.length>1)throw Error('玩家角色重名，请明确选择对应角色');
 let player=matches[0];if(!player){let id='player:'+encodeURIComponent(name),suffix=0;while(result.world.entities.some(e=>e.id===id))id='player:'+encodeURIComponent(name)+':'+(++suffix);player={id,kind:'character',name};result.world.entities.push(player)}
 result.world.context.playerId=player.id;return result;
}

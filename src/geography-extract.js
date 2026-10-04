import { freezeAllowedSources, verifyQuote, evidenceRecord, evidenceDictionary, materialRowsOf, scopeForRows } from './abstract-evidence.js';
import { GEOGRAPHY_VERSION } from './schemas/geography.schema.js';
import { SETTING_CHUNK_CHAR } from './abstract-limits.js';

const value = v => typeof v === 'string' ? v.trim() : '';
const empty = () => ({ version: GEOGRAPHY_VERSION, places: [], links: [] });
const identity = p => JSON.stringify([value(p?.name),value(p?.qualifier)]);

// 提示词只交临时编号；最终编号由引擎生成。原话仅供核验，不落账。
export const geographyShape = {
  places: [{ key: '本块临时编号', name: '地点原名', qualifier: '区分同名地点的原文身份说明，可省且必须原文明述', aliases: ['原文明述的同一地点叫法，可省'], ev: { s: 'S1', q: '逐字原文' } }],
  links: [{ from: '临时编号', to: '临时编号', type: 'within|adjacent|passage', via: '通道原名，可省', direction: 'both|forward，原文明述才写', condition: '原文通行条件，可省', ev: { s: 'S1', q: '逐字原文' } }],
};

export function sanitizeGeography(raw, { sourceText = '', evidence = null, previous = null } = {}) {
  const warnings = [], dropped = [], geography = empty(), keys = new Map();
  const reject = (subject, why) => { dropped.push({ subject, why }); warnings.push(`地图: ${subject}：${why}`); };
  // ★★★leg197（用户令：全面撤销"引用找不到原文就丢"）：下面这两个"核出处"的函数**不再决定收不收**——
  //   它们只把结果记进诊断（`evidence.records`）与 `warnings`。留下的判据全是**形状**：
  //   临时编号/原名缺失或编号重复 · 端点未确认或关系类型非法 · 包含环 · 重复关系。
  //   ★`literal`（"这个名称/文本要在核过的引用里逐字出现"）整条撤掉：那正是"找不到原文就丢"。
  const noteProof = (item, cls, subject) => {
    const proof = verifyQuote(evidence?.frozen, { ev: item?.ev, scope: evidence?.scope ?? null, spanText: sourceText, cls, subject });
    if (Array.isArray(evidence?.records)) evidence.records.push(evidenceRecord({cls,subject,action:proof.ok?'keep':'unverified',why:proof.why,ref:proof.ref,quote:proof.ok?null:proof.quote}));
    if (!proof.ok) warnings.push(`地图: ${subject}：出处核不过——${proof.why}（★leg197：**照收**，只记这一条）`);
    return proof;
  };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.places) || !Array.isArray(raw.links)) {
    reject('地理输出', 'places 与 links 必须是数组'); return { geography, warnings, dropped };
  }
  for (const p of raw.places) {
    const key=value(p?.key), name=value(p?.name);
    if (!key || !name || keys.has(key)) { reject(name || key || '地点','临时编号/原名缺失或编号重复'); continue; }
    noteProof(p,'geography-place',name);
    const out={id:`p_${geography.places.length+1}`,name};
    if (value(p.qualifier)) out.qualifier=value(p.qualifier);
    const aliases=[...new Set((Array.isArray(p.aliases)?p.aliases:[]).map(value).filter(a=>a&&a!==name))];
    if (aliases.length) out.aliases=aliases;
    geography.places.push(out);keys.set(key,out.id);
  }
  for (const l of raw.links) {
    const subject=`${value(l?.from)} → ${value(l?.to)}`;
    const from=keys.get(value(l?.from)),to=keys.get(value(l?.to)),type=value(l?.type);
    if (!from || !to || from===to || !['within','adjacent','passage'].includes(type)) { reject(subject,'端点未确认或关系类型非法'); continue; }
    noteProof(l,'geography-link',subject);
    const out={from,to,type};
    if (type==='passage') {
      for (const k of ['via','condition']) if (value(l[k])) out[k]=value(l[k]);
      if (['both','forward'].includes(l.direction)) out.direction=l.direction;
      else if (l.direction!==undefined) reject(subject,'方向非法，方向字段已弃');
    }
    geography.links.push(out);
  }
  const merged=mergeGeography([geography],{previous});
  if (merged.links.length<geography.links.length) warnings.push('地图: 重复关系或包含环内部关系已弃');
  return { geography:merged,warnings,dropped };
}

export function mergeGeography(parts, { previous = null } = {}) {
  const result=empty(), list=(Array.isArray(parts)?parts:[]).filter(Boolean);
  const occurrences=new Map();
  const totalOccurrences=new Map();
  for (const part of list) for (const p of part.places || []) { const k=identity(p); occurrences.set(k,Math.max(occurrences.get(k)||0,(part.places||[]).filter(x=>identity(x)===k).length)); }
  for (const part of list) for (const p of part.places || []) {
    const key=identity(p);totalOccurrences.set(key,(totalOccurrences.get(key)||0)+1);
  }
  const uniqueIdentity = (key, qualifier) => occurrences.get(key)===1 && (Boolean(qualifier) || totalOccurrences.get(key)===1);
  const previousNames=new Map();
  for (const p of previous?.places || []) { const key=identity(p),a=previousNames.get(key)||[];a.push(p);previousNames.set(key,a); }
  const used=new Set(), byName=new Map();let seq=0;
  const allocate = (key, qualifier) => {const old=previousNames.get(key);if (uniqueIdentity(key,qualifier)&&old?.length===1&&!used.has(old[0].id)) {used.add(old[0].id);return old[0].id;} let id;do{id=`p_${++seq}`;}while(used.has(id)||(previous?.places||[]).some(p=>p.id===id));used.add(id);return id;};
  for (const part of list) {
    const remap=new Map();
    for (const p of part.places || []) {
      const name=value(p?.name);if(!name||!value(p?.id)||remap.has(p.id))continue;
      // 跨块重复短名缺少确认身份时，保留不同地点；原文身份说明唯一才合并。
      const key=identity(p);
      const canMerge=uniqueIdentity(key,value(p.qualifier));
      let target=canMerge?byName.get(key):null;
      if(!target){target={id:allocate(key,value(p.qualifier)),name};if(value(p.qualifier))target.qualifier=value(p.qualifier);result.places.push(target);if(canMerge)byName.set(key,target);}
      const aliases=[...new Set([...(target.aliases||[]),...(Array.isArray(p.aliases)?p.aliases:[])].map(value).filter(a=>a&&a!==name))];
      if(aliases.length)target.aliases=aliases;remap.set(p.id,target.id);
    }
    for(const l of part.links||[]){const from=remap.get(l.from),to=remap.get(l.to);if(!from||!to||from===to||!['within','adjacent','passage'].includes(l.type))continue;const out={from,to,type:l.type};if(l.type==='passage'){for(const k of ['via','condition'])if(value(l[k]))out[k]=value(l[k]);if(['both','forward'].includes(l.direction))out.direction=l.direction;}result.links.push(out);}
  }
  const within=result.links.filter(l=>l.type==='within');
  const edges=new Map();for(const l of within){const a=edges.get(l.from)||[];a.push(l.to);edges.set(l.from,a);}
  const reaches=(from,to)=>{const seen=new Set(),pending=[from];while(pending.length){const n=pending.pop();if(n===to)return true;if(seen.has(n))continue;seen.add(n);pending.push(...(edges.get(n)||[]));}return false;};
  const seen=new Set();result.links=result.links.filter(l=>{if(l.type==='within'&&reaches(l.to,l.from))return false;const key=JSON.stringify(l);if(seen.has(key))return false;seen.add(key);return true;});
  return result;
}

export async function extractGeography({ sourceText, allowedSources, extract, previous = null, onProgress = null }) {
  const errors=[],parts=[];let calls=0,failed=false;
  const source=String(sourceText??''),frozen=freezeAllowedSources(allowedSources);
  if (!source.trim() || !frozen || typeof extract!=='function') return {ok:false,geography:null,errors:['补抽地图缺少来源材料、允许来源或抽取调用'],calls};
  const rows=materialRowsOf(source),chunks=[];let indexes=[],chars=0;
  // 使用既有设定块大小，避免另添模型容量阈值。
  for(let i=0;i<rows.length;i++){if(chars+rows[i].text.length>SETTING_CHUNK_CHAR&&indexes.length){chunks.push(indexes);indexes=[];chars=0;}indexes.push(i);chars+=rows[i].text.length+1;}if(indexes.length)chunks.push(indexes);
  for(let i=0;i<chunks.length;i++){
    const picked=chunks[i],text=picked.map(j=>rows[j].text).join('\n'),scope=scopeForRows(frozen,{text:source,rows,indexes:picked});
    const prompt=[{role:'system',content:'只抽取本次材料明述的地点身份、别名、包含(within)、相邻(adjacent)与通道(passage)。不猜距离、方向或道路。同名不同地点使用不同临时 key；尽量保留原文完整名称。每个地点与关系都带 ev（引擎会逐字核并把结果记进诊断；★核不过不再丢弃，但"抄不出原话的就别交"这条纪律照旧）。没有资料就返回空数组。输出严格 JSON：'+JSON.stringify({geography:geographyShape})},{role:'user',content:evidenceDictionary(frozen,{scope})+'\n'+text}];
    try{
      calls++;
      const output=await extract(prompt.map(m=>m.content).join('\n\n'));
      if(typeof output!=='string'||!output.trim())throw new Error('抽取输出为空');
      const raw=JSON.parse(output),proposed=raw?.geography??raw;
      if(!proposed || !Array.isArray(proposed.places) || !Array.isArray(proposed.links))throw new Error('抽取形状不完整');
      const clean=sanitizeGeography(proposed,{sourceText:text,evidence:{frozen,scope}});
      errors.push(...clean.warnings);
      if(clean.geography.places.length)parts.push(clean.geography);
    }
    catch{failed=true;errors.push(`补抽地图第 ${i+1} 块失败（空输出、非法 JSON、形状不完整或调用失败）`);}
    try{onProgress?.({phase:'finish',index:i+1,total:chunks.length,calls});}catch{/* 进度显示不能影响抽取 */}
  }
  // 任一调用失败时不交可写回的半份地图；旧账由调用者保持原样。
  if(failed)return {ok:false,geography:null,errors,calls};
  const geography=mergeGeography(parts,{previous});
  return {ok:geography.places.length>0,geography:geography.places.length?geography:null,errors,calls};
}

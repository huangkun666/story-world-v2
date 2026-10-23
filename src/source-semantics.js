// Semantic annotations are supplied by the extractor; never inferred from words.
export const SOURCE_SEMANTIC_PROTOCOL='source-jobs-v5';
export const RELATION_FACT_TYPES=Object.freeze(['current','historical','conditional','disposition','instruction']);
export const PROPERTY_MEANINGS=Object.freeze(['attribute','current_location','base_location','origin','destination','instruction']);
export const SOURCE_RULE_KINDS=Object.freeze(['判断依据','世界观设定','文风禁令','变量指令','其他']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
/** Ordered wire labels map to exact original rules; invalid input stays invalid for C validation. */
export function normalizeRuleKinds(rules,kinds){
 if(!Array.isArray(kinds))return kinds;
 if(rules===undefined)rules=[];
 if(!Array.isArray(rules)||rules.length!==kinds.length||kinds.some(k=>!SOURCE_RULE_KINDS.includes(k)))return kinds;
 const pairs=new Map();for(const [i,rule]of rules.entries()){if(typeof rule!=='string'||pairs.has(rule)&&pairs.get(rule)!==kinds[i])return kinds;pairs.set(rule,kinds[i]);}
 return Object.fromEntries(pairs);
}
export function assertFactType(value){if(!RELATION_FACT_TYPES.includes(value))throw new TypeError('relation fact_type must be current/historical/conditional/disposition/instruction');}
export function assertRuleClassification(data){if(!Array.isArray(data.rules)||!data.rules.length)return;for(const rule of data.rules){if(!object(data.ruleKinds)||!Object.hasOwn(data.ruleKinds,rule)||!SOURCE_RULE_KINDS.includes(data.ruleKinds[rule]))throw new TypeError('every rule needs its own valid ruleKinds classification');}}
export function propertyFields(property,kind,{semantic=false}={}){
 if(semantic&&!PROPERTY_MEANINGS.includes(property.meaning))throw new TypeError('property meaning must identify attribute/current_location/base_location/origin/destination/instruction');
 if(property.meaning==='instruction')return {};
 if(semantic&&(typeof property.value!=='string'||!property.value.trim()))throw new TypeError('explicit property value must be nonempty；已交出的属性不能用空值冒充抽象成功');
 const formalLocation=semantic&&(property.meaning==='current_location'&&kind!=='location'||property.meaning==='base_location'&&kind==='faction');
 const key=semantic&&property.key==='location'&&(!formalLocation||property.value!==property.location_name)?'原文.location':property.key;
 const fields=Object.fromEntries([[key,property.value]]);
 if(semantic&&['current_location','base_location'].includes(property.meaning)){
  if(typeof property.location_name!=='string'||!property.location_name.trim())throw new TypeError('location_name is required for an explicitly named current location/base');
  if(property.meaning==='current_location'&&kind!=='location'||property.meaning==='base_location'&&kind==='faction')fields.location=property.location_name;
 }
 return fields;
}
/** Preserve unclassified legacy rules; remove only explicit non-world classifications. */
export function projectClassifiedRules(data){
 const out=structuredClone(data);if(!Array.isArray(out.rules))return out;
 const excluded=new Set(out.rules.filter(r=>Object.hasOwn(out.ruleKinds??{},r)&&['文风禁令','变量指令','其他'].includes(out.ruleKinds[r])));
 out.rules=out.rules.filter(r=>!excluded.has(r));
 if(object(out.ruleKinds))out.ruleKinds=Object.fromEntries(Object.entries(out.ruleKinds).filter(([r])=>!excluded.has(r)));
 return out;
}
export const SOURCE_SEMANTIC_GUIDE=[
 '事实按含义分类，不按关键词：现已成立的关系用 current；只在过去成立且当前未证实仍成立用 historical；尚未发生或满足条件后才成立用 conditional；亲近倾向、态度与行为偏好用 disposition；给AI/插件如何生成或运行的要求用 instruction。不能把条件结果提前当当前关系，也不能删掉条件。正文须完整含主体及对象，保留原意。已有亲属/师徒/婚姻不因涉及玩家而删除。',
 '人物能力、性格、倾向属于角色属性，世界内真实自然规则和行为机制属于世界设定；请AI使用格式、生成器、审查人格、脚本更新等运行要求只在原稿保留，不编成世界事实。',
 '每条 rules 必须给 ruleKinds：判断依据或世界观设定才是正式法则；文风禁令、变量指令、其他仅供分类后排除。世情与历史分别进 situation/historyNotes；等级概念用刻度。属性、社会、力量体系、规则不重复抄同一长段。',
 '所有原文明述的实际地点均独立列身份，包括地图层级、区域、城镇、地点详情和散落在角色/势力介绍中的地名；不只抽最大层级或某个位面。明确的包含归属必须分别列父子 identities 与 geography_type=within（from子/to父）；明述相邻、八向和实际通路分别交原地理字段。方位不等于包含，势力控制不等于空间包含，名称和故乡不证明所在。现有通路带季节/准入条件仍可为 current 并保留条件，假设日后修建的通路是 conditional。',
 'properties 每个值给 meaning：普通属性 attribute、明确当前所在 current_location、固定驻地 base_location、故乡 origin、未来目的地 destination、模型运行要求 instruction。current_location/base_location 同时给 location_name 原文明述地名，不把所属、故乡、将去地、经常出没地当当前所在。人物住所不证明人现在在家；势力明确驻地可形成其 location。value 保留原话，location_name 只命名该处，不推测。',
].join('\n');

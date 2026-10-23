import {sourceInitialState} from './source-initial-state.js';
import {sourceBaselineHash} from './source-records.js';
import {isFinalizedPublication,validateFinalizedPublication} from './finalized-source.js';
// services/world-engine/source-world.mjs
// Task 1：**已发布的固定资料版本 → 一个新世界**（零模型、零网络、纯函数）。
//
// 为什么必须有这一层（口径的来路）：
//   · 资料侧（Python/SQLite）已经发布出**固定版本**：正式记录 + 来源指针 + 精确缺失名单。
//     新世界只能从这个固定版本长出来，不许回头读世界书、不许重新抽取、不许猜。
//   · 身份只有一种：**正式 ID**。同名不同 ID 是两个人，别名只是叫法 ⇒ 一律按 ID 落账
//     （`seedBookEntities` 那条路按名字合并，本层**一个字都不用**）。
//   · 位置**有明述或显式输入就填、没有就不填**（★用户新令 2026-10-12：实体不带 location 键，
//     `positions` 可空；绝不按名字/归属/玩家场景猜，也不补占位）；关系与设定仍须有明述或显式输入。
//
// 分工（别混）：
//   · 本文件只做"固定资料 → 世界"这一件事，不调用模型、不读磁盘、不写账；
//   · 世界的结构（canon 五件套 / 张力 / env）复用既有的零模型装配器 `assembleSetting`，
//     避免在这里再写第二份形状（"两份真相"是本仓最贵的病）；
//   · 发布原件（完整记录 + 来源指针）**逐字**留在 `world.meta.sourcePublication`，
//     并且产出前必须过**现有** `ssotSchema`——引擎偷偷多写字段在本仓是硬违约。
import { sha256Hex } from './browser-capabilities.js';
import {assertFactType,projectClassifiedRules} from './source-semantics.js';
import { validate } from './schema.js';
import { ssotSchema } from './schemas/ssot.schema.js';
import { BEARING_DIRECTIONS, GEOGRAPHY_VERSION, geographySchema } from './schemas/geography.schema.js';
import { assembleSetting, scalesToFlat } from './abstract.js';
import { projectSourceEntityFields } from './source-records.js';

const CANON_SCHEMA = ssotSchema.props.context.props.setting.props.frozen.props.canon;
const ENTITY_SCHEMA = ssotSchema.props.entities.items;
const WORLD_VERSION = 1;                      // 世界文档版本（资料版本住在 meta.sourcePublication.version）
const RECORD_KINDS = ['entity', 'location', 'relation', 'setting'];

// canon 里这三格是**抽取旧路的名号键**（名册 / 属性设定遍 / 书里的关系网）。
// 正式记录一律用 ID ⇒ 名号键在这里是"另一条路的东西"，收下就等于同一件事有两个家：
// 一边是正式 ID、一边是名号，且名号侧没有身份保证。⇒ 明确失败，不静默搬。
const NAME_KEYED_CANON = ['bookEntities', 'settings', 'relations'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串`);
    return value;
}

// bundle 是发布返回的 receipt + sources + records（`Repository.publish` 的实际形状）。
// 五件固定件缺一不可：少了任何一件，"这是哪个版本、缺了谁"就说不清了。
function readBundle(bundle) {
    if (!isObject(bundle)) throw new Error('bundle 必须是发布版本对象');
    const library_id = text(bundle.library_id, 'bundle.library_id');
    if (!Number.isSafeInteger(bundle.version) || bundle.version <= 0) {
        throw new Error('bundle.version 必须是正的安全整数（固定资料版本）');
    }
    if (!Array.isArray(bundle.records)) throw new Error('bundle.records 必须是数组');
    for (const [i, record] of bundle.records.entries()) {
        if (!isObject(record)) throw new Error(`bundle.records[${i}] 必须是对象`);
    }
    if (!Array.isArray(bundle.sources)) throw new Error('bundle.sources 必须是数组');
    for (const [i, source] of bundle.sources.entries()) {
        if (!isObject(source)) throw new Error(`bundle.sources[${i}] 必须是对象`);
        for (const key of ['source_id', 'content_hash', 'task_id']) text(source[key], `bundle.sources[${i}].${key}`);
    }
    if (!Array.isArray(bundle.omitted_source_ids)) throw new Error('bundle.omitted_source_ids 必须是数组');
    const omitted = bundle.omitted_source_ids.map((id, i) => text(id, `bundle.omitted_source_ids[${i}]`));
    if (new Set(omitted).size !== omitted.length) throw new Error('bundle.omitted_source_ids 不许重复');
    // `conversion` 是引擎在本层写的记账格（指纹/时间/诊断）⇒ 发布侧同名键会互相覆盖，必须挡住。
    if (Object.hasOwn(bundle, 'conversion')) throw new Error('bundle.conversion 与引擎记账格同名（拒绝覆盖）');
    let copy;
    try {
        copy = structuredClone(bundle);
    } catch (error) {
        throw new Error(`bundle 必须是可克隆的纯 JSON 数据：${error.message}`);
    }
    return { ...copy, library_id, omitted_source_ids: omitted };
}

function readOptions(options) {
    if (!isObject(options)) throw new Error('options 必须是对象');
    const worldName = text(options.worldName, 'options.worldName');
    // ★用户新令（2026-10-12）：**有位置就填，没位置就不填**。整个世界没有已知位置也不许拒绝建立
    //   ⇒ `positions` 省略 = 空 = 合法（空数组同样合法，绝不补占位地点）。
    const rawPositions = options.positions === undefined || options.positions === null ? [] : options.positions;
    if (!Array.isArray(rawPositions)) {
        throw new Error('options.positions 必须是数组（可省/可空：没有已知位置就不声明）');
    }
    const positions = rawPositions.map((p, i) => text(p, `options.positions[${i}]`));
    if (!Number.isFinite(options.tension)) throw new Error('options.tension 必须是有限数字');
    const entityLocations = Object.create(null);
    if (options.entityLocations !== undefined) {
        if (!isObject(options.entityLocations)) throw new Error('options.entityLocations 必须是对象（正式 ID → 显式位置）');
        for (const [id, value] of Object.entries(options.entityLocations)) {
            text(id, 'options.entityLocations 的键（正式实体 ID）');
            entityLocations[id] = text(value, `options.entityLocations.${id}`);
        }
    }
    const playerId = options.playerId === undefined || options.playerId === null
        ? null : text(options.playerId, 'options.playerId');
    const blockedIds = [];
    if (options.blockedIds !== undefined) {
        if (!Array.isArray(options.blockedIds)) throw new Error('options.blockedIds 必须是数组');
        for (const [i, id] of options.blockedIds.entries()) {
            const value = text(id, `options.blockedIds[${i}]`);
            if (!blockedIds.includes(value)) blockedIds.push(value);
        }
    }
    const extractedAt = text(options.extractedAt, 'options.extractedAt');
    return { worldName, positions, tension: options.tension, entityLocations, playerId, blockedIds, extractedAt };
}

// 正式记录逐条核对形状（发布侧已核过一遍；这里是本层的入口闸：**坏数据不许进来**）。
// 纪律：只核对、不补造——缺的可选键不填，空串照旧是空串。
function indexRecords(records) {
    const entities = new Map();
    const locations = new Map();
    const relations = [];
    const settings = [];
    const kinds = new Map();
    for (const [i, record] of records.entries()) {
        const kind = record.record_kind;
        if (!RECORD_KINDS.includes(kind)) {
            throw new Error(`bundle.records[${i}] 的 record_kind ${JSON.stringify(kind)} 不是已发布资料的类型`);
        }
        const id = text(record.id, `bundle.records[${i}].id`);
        if (kinds.has(id)) throw new Error(`正式 ID ${id} 在发布记录里出现两次（不许覆盖）`);
        kinds.set(id, kind);
        if (kind === 'entity') {
            text(record.name, `实体 ${id} 的 name`);
            if (record.kind !== 'character' && record.kind !== 'faction') {
                throw new Error(`实体 ${id} 的 kind 必须是 character/faction`);
            }
            if (record.aliases !== undefined) {
                if (!Array.isArray(record.aliases)) throw new Error(`实体 ${id} 的 aliases 必须是数组`);
                record.aliases.forEach((alias, j) => text(alias, `实体 ${id} 的 aliases[${j}]`));
            }
            if (record.fields !== undefined) {
                if (!isObject(record.fields)) throw new Error(`实体 ${id} 的 fields 必须是对象`);
                for (const [key, value] of Object.entries(record.fields)) {
                    text(key, `实体 ${id} 的 fields 键`);
                    if (typeof value !== 'string') throw new Error(`实体 ${id} 的 fields.${key} 必须是字符串`);
                }
            }
            entities.set(id, record);
        } else if (kind === 'location') {
            text(record.name, `地点 ${id} 的 name`);
            if (record.aliases !== undefined) {
                if (!Array.isArray(record.aliases)) throw new Error(`地点 ${id} 的 aliases 必须是数组`);
                record.aliases.forEach((alias, j) => text(alias, `地点 ${id} 的 aliases[${j}]`));
            }
            locations.set(id, record);
        } else if (kind === 'relation') {
            text(record.from_id, `关系 ${id} 的 from_id`);
            text(record.to_id, `关系 ${id} 的 to_id`);
            text(record.text, `关系 ${id} 的 text`);
            if(Object.hasOwn(record,'fact_type'))assertFactType(record.fact_type);
            relations.push(record);
        } else {
            if (!isObject(record.data)) throw new Error(`设定 ${id} 的 data 必须是对象`);
            settings.push(record);
        }
    }
    return { entities, locations, relations, settings, kinds };
}

// 位置：**显式 entityLocations 或记录里逐字的 `fields.location`**，有就填、没有就不填（不落键）。
// 不许兜底：兜底就是"猜"（名字像地名 / 所属势力的驻地 / 玩家所在场景都不构成明述）。
// 位置集只在**声明了非空集合**时当闸；显式与记录明述互相矛盾仍拒绝（不许静默挑一个）。
function resolveLocations(index, input) {
    const positions = new Set(input.positions);
    const declaredSet = input.positions.length > 0;
    for (const [id, location] of Object.entries(input.entityLocations)) {
        if (!index.entities.has(id)) throw new Error(`options.entityLocations 的 ${id} 不是本批正式实体（未知 ID）`);
        if (declaredSet && !positions.has(location)) throw new Error(`实体 ${id} 的显式位置「${location}」不在 options.positions 里`);
    }
    const resolved = new Map();
    const emptyFields = [];
    for (const [id, record] of index.entities) {
        const explicit = Object.hasOwn(input.entityLocations, id) ? input.entityLocations[id] : null;
        const raw = record.fields && Object.hasOwn(record.fields, 'location') ? record.fields.location : null;
        const book = raw !== null && raw.trim() ? raw : null;
        if (explicit && book && explicit !== book) {
            throw new Error(`实体 ${id} 的位置冲突：显式「${explicit}」≠ 记录明述「${book}」`);
        }
        const location = explicit || book;
        if (!location) continue;                    // ★没位置就不填：实体账上不落 location 键
        if (declaredSet && !positions.has(location)) {
            throw new Error(`实体 ${id} 的位置「${location}」不在 options.positions 里`);
        }
        if (explicit && raw !== null && !book) emptyFields.push({ id, field: 'location' });
        resolved.set(id, location);
    }
    return { resolved, emptyFields };
}

function buildEntities(index, input, locationOf) {
    for (const id of input.blockedIds) {
        if (!index.entities.has(id)) throw new Error(`options.blockedIds 的 ${id} 不是本批正式实体（未知 ID）`);
    }
    if (input.playerId !== null) {
        const player = index.entities.get(input.playerId);
        if (!player) throw new Error(`options.playerId 的 ${input.playerId} 不是本批正式实体（未知 ID）`);
        if (player.kind !== 'character') throw new Error(`options.playerId 的 ${input.playerId} 不是 character 实体`);
    }
    const blocked = new Set(input.blockedIds);
    const entities = [];
    const emptyFields = [], renamedFields = [];
    for (const [id, record] of index.entities) {
        // ★用户新令（2026-10-12）：没位置就**不落 location 键**（不是空串、不是「未明」占位）。
        const entity = { id, kind: record.kind, name: record.name };
        const location = locationOf.get(id);
        if (location !== undefined) entity.location = location;
        if (record.aliases !== undefined) entity.aliases = [...record.aliases];
        if (blocked.has(id)) entity.simulationBlocked = true;
        const projected = projectSourceEntityFields(record.fields || {});
        renamedFields.push(...projected.renamed.map(rename => ({id, ...rename})));
        for (const [key, value] of Object.entries(projected.fields)) {
            if (key === 'location') continue;                       // 已作位置来源（见 resolveLocations）
            // 已登记键（实力/身份/…）契约要求非空 ⇒ 空串不落账（**不填占位值**），只留诊断；原件仍在 meta。
            if (Object.hasOwn(ENTITY_SCHEMA.props, key) && !value.trim()) {
                emptyFields.push({ id, field: key });
                continue;
            }
            Object.defineProperty(entity, key, { value, enumerable: true, writable: true, configurable: true });
        }
        for(const relation of index.relations){
            if(relation.fact_type!=='disposition'||relation.from_id!==id)continue;
            const target=index.entities.get(relation.to_id)||index.locations.get(relation.to_id);if(!target)continue;
            let key='对'+target.name+'的倾向';
            while(Object.hasOwn(entity,key)&&entity[key]!==relation.text)key='原文.'+key;
            Object.defineProperty(entity,key,{value:relation.text,enumerable:true,writable:true,configurable:true});
        }
        entities.push(entity);
    }
    return { entities, emptyFields, renamedFields };
}

// 关系：**两端都必须是正式实体**。端点落在地点记录上时，那条边留在原件与诊断里——
// 绝不改写成"实体关系"（那会把一个地名变成一个人，是本仓最贵的错法之一）。
function buildRelations(index) {
    const relations = [];
    const skipped = [];
    for (const record of index.relations) {
        if(record.fact_type&&record.fact_type!=='current'){
            skipped.push({id:record.id,from_id:record.from_id,to_id:record.to_id,fact_type:record.fact_type,reason:'此记录不是当前已成立关系，按类别保留，不提前写入关系账'});continue;
        }
        const from = index.entities.has(record.from_id);
        const to = index.entities.has(record.to_id);
        if (!from || !to) {
            skipped.push({ id: record.id, from_id: record.from_id, to_id: record.to_id,
                from_kind: index.kinds.get(record.from_id) ?? 'unknown',
                to_kind: index.kinds.get(record.to_id) ?? 'unknown',
                reason: '端点不是正式实体——原件留在 meta.sourcePublication，不写成实体关系' });
            continue;
        }
        relations.push({ id: record.id, from: record.from_id, to: record.to_id, type: record.text, tick: 0 });
    }
    return { relations, skipped };
}

// 地理：**正式地点记录**（ID/名/别名）一律成为可浏览地点——同名不同 ID 是两个地点，不按名字合并。
// 地点关系只在带**明确结构化字段**时转地理边：`geography_type` ∈ bearing|within|adjacent|passage，
// bearing 边必须带八向之一；`via`/`direction`/`condition` 只用记录里逐字的字段。
// 自由文本（"南城在北港南方"）**一个方位都不解析**；无结构化字段时只留地点，方位仍未载。
const GEOGRAPHY_TYPES = ['bearing', 'within', 'adjacent', 'passage'];
function buildSourceGeography(index,{registrationOnly=false}={}) {
    const places = [];
    for (const [id, record] of index.locations) {
        const place = { id, name: record.name };
        if (record.aliases !== undefined) place.aliases = [...record.aliases];
        places.push(place);
    }
    const links = [];
    const skipped = [];
    for (const record of index.relations) {
        if (!registrationOnly&&(!index.locations.has(record.from_id) || !index.locations.has(record.to_id))) continue;
        if(record.fact_type&&record.fact_type!=='current'){
            skipped.push({id:record.id,reason:'该地理记录不是当前事实，保留机制原文，不提前建立地图边'});continue;
        }
        const type = record.geography_type;
        if (!GEOGRAPHY_TYPES.includes(type)) {
            skipped.push({ id: record.id, reason: '地点关系无明确 geography_type——原件留在 meta.sourcePublication，不解析自由文本方位' });
            continue;
        }
        if (type === 'bearing' && !BEARING_DIRECTIONS.includes(record.bearing)) {
            skipped.push({ id: record.id, reason: 'bearing 边缺少合法方位（八向之一）——拒绝该边，不猜' });
            continue;
        }
        const link = { from: record.from_id, to: record.to_id, type };
        if (type === 'bearing') link.bearing = record.bearing;
        for (const key of ['via', 'condition']) {
            if (typeof record[key] === 'string' && record[key].trim()) link[key] = record[key];
        }
        if (type === 'passage' && ['both', 'forward'].includes(record.direction)) link.direction = record.direction;
        links.push(link);
    }
    return { places, links, skipped };
}

// 稳定序列化：同一份内容（键序无关）→ 同一个字符串；用于"同 ID 同内容"判重，不做语义推断。
function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

// 地理：多个来源（设定里的 geography + 正式地点记录）按**正式 ID** 合并。
// 纪律：同 ID 同内容只载一份；同 ID 内容不同 ⇒ 明确失败（那是"同一个身份两份说法"，不是可静默取一份的补充）；
// 边只并集去重，且合并后每条边的两端都必须在册（引用完整性）——悬空的边不许静默留下。
function mergeGeographyById(parts, { checkIntegrity = true, registrationOnly = false, geographyNames = new Map() } = {}) {
    const list = (Array.isArray(parts) ? parts : []).filter(Boolean);
    if (!list.length) return null;
    const places = [];
    const byId = new Map();
    const links = [];
    const linkKeys = new Set();
    for (const geography of list) {
        if (!isObject(geography) || !Array.isArray(geography.places) || !Array.isArray(geography.links)) {
            throw new Error('地理必须是 { version, places, links } 对象（合并入口闸）');
        }
        if (geography.version !== GEOGRAPHY_VERSION) {
            throw new Error(`地理版本 ${JSON.stringify(geography.version)} 不是 ${GEOGRAPHY_VERSION}`);
        }
        for (const [i, rawPlace] of geography.places.entries()) {
            if (!isObject(rawPlace)) throw new Error(`地理 places[${i}] 必须是对象`);
            const id = text(rawPlace.id, `地理 places[${i}].id`);
            // Use only the final model's explicit name choice; the raw publication stays untouched.
            const place=registrationOnly&&geographyNames.has(id)?{...rawPlace,name:geographyNames.get(id)}:rawPlace;
            const known = byId.get(id);
            if (!known) {
                const copy = structuredClone(place);
                byId.set(id, copy);
                places.push(copy);
            } else if (canonicalJson(known) !== canonicalJson(place)) {
                if(registrationOnly){
                    if(known.aliases!==undefined||place.aliases!==undefined)known.aliases=[...new Set([...(known.aliases??[]),...(place.aliases??[])])];
                    if(place.qualifier)known.qualifier=mergeCanonString(known.qualifier,place.qualifier);
                    continue;
                }
                throw new Error(`地理地点 ${id} 在不同来源里内容不同（同一正式 ID 冲突，不许静默取一份）`);
            }
        }
        for (const [i, link] of geography.links.entries()) {
            if (!isObject(link)) throw new Error(`地理 links[${i}] 必须是对象`);
            const key = canonicalJson(link);
            if (linkKeys.has(key)) continue;
            linkKeys.add(key);
            links.push(structuredClone(link));
        }
    }
    // 中间态（设定来源先合一份）先不查：正式地点记录还没并进来，边可能指向待并的地点。
    if (checkIntegrity&&!registrationOnly) for (const link of links) {
        if (!byId.has(link.from) || !byId.has(link.to)) {
            throw new Error(`地理边 ${JSON.stringify(link.from)} → ${JSON.stringify(link.to)} 的端点不是已载地点`
                + '（引用完整性：不许留下悬空链接）');
        }
    }
    return { version: GEOGRAPHY_VERSION, places, links:registrationOnly?links.filter(link=>validate(link,geographySchema.props.links.items).ok&&(link.type!=='bearing'||BEARING_DIRECTIONS.includes(link.bearing))):links };
}

// 把正式地点记录并入已有 geography（设定若已给则先按 ID 合成一份），沿用同一个 ID 合并闸。
function mergeSourceGeography(existing, index, {registrationOnly=false,geographyNames=new Map()}={}) {
    const source = buildSourceGeography(index,{registrationOnly});
    const parts = [];
    if (existing !== undefined && existing !== null) parts.push(existing);
    if (source.places.length || source.links.length) {
        parts.push({ version: GEOGRAPHY_VERSION, places: source.places, links: source.links });
    }
    return { geography: mergeGeographyById(parts,{registrationOnly,geographyNames}), skipped: source.skipped };
}

// 设定聚合：per-source 抽取的每条设定记录都是**该来源的完整证据**——不是"同一个格子只能有一个作者"。
// 策略**只按 canon schema 的类型**派生（不写"这本书有哪些字段"的词表，不加逐书常量）：
//   · array     ⇒ 按来源顺序收集全部条目（structuredClone 逐字保留，净化/丢项不在这一层做）；
//   · string    ⇒ 完整不同原话按来源顺序拼接；空串=书里没给，不覆盖非空、不参与拼接；
//   · strRecord ⇒ 键并集；只有**同键不同值**才是真冲突（那才是两份互斥主张）；
//   · object    ⇒ 契约里 canon 唯一对象格是地理，走 mergeGeographyById（按正式 ID）。
// 名号键（抽取旧路）照旧拒绝；形状不合法的值在聚合前先过契约，绝不猜测。
const CANON_STRING_SEPARATOR = '\n\n';   // 结构化分隔，不合成新句子：每条原话仍是完整原文

function mergeCanonString(current, value) {
    if (!value) return current;                 // 空串=书里没给
    if (!current) return value;
    if (current === value) return current;
    return `${current}${CANON_STRING_SEPARATOR}${value}`;
}

function relationSettings(index){
    const rows=[];
    for(const record of index.relations){
        if(!['conditional','historical'].includes(record.fact_type))continue;
        const from=index.entities.get(record.from_id)||index.locations.get(record.from_id),to=index.entities.get(record.to_id)||index.locations.get(record.to_id);
        if(!from||!to)continue;
        const phrase=from.name+' → '+to.name+'：'+record.text;
        const data=record.fact_type==='historical'?{historyNotes:[phrase]}:{rules:[phrase],ruleKinds:{[phrase]:'世界观设定'}};
        rows.push({id:record.id,data});
    }
    return rows;
}

function buildCanon(settings, index, {registrationOnly=false,geographyNames=new Map()}={}) {
    settings=[...settings,...relationSettings(index)];
    // These are already selected/coexisting final records, never unreviewed extraction candidates.
    // The optional scalar classification cannot choose one of several retained original values.
    const concurrentRuleKinds=new Map();
    if(registrationOnly)for(const record of settings)for(const [rule,kind]of Object.entries(record.data.ruleKinds??{})){
        if(!concurrentRuleKinds.has(rule))concurrentRuleKinds.set(rule,new Set());
        concurrentRuleKinds.get(rule).add(kind);
    }
    settings=settings.map(record=>{
        const data=structuredClone(record.data);
        if(registrationOnly&&data.ruleKinds)for(const rule of Object.keys(data.ruleKinds))if(concurrentRuleKinds.get(rule)?.size>1)delete data.ruleKinds[rule];
        return {...record,data:projectClassifiedRules(data)};
    });
    const canon = { powerScale: [], rules: [], society: '', techOrMagic: '', historyNotes: [] };
    const empty = [];
    const geographies = [];
    const mapOwners = new Map();   // `${field}\0${key}` → 先写这条的 record.id（冲突时报得出双方）
    // 模型只该交概念表 `刻度`；`powerScale`/`dims` 是派生视图（见下方）。记录里显式交过的键
    // 由记录自己当源，程序绝不覆盖。
    const suppliedKeys = new Set(settings.flatMap(record => Object.keys(record.data)));
    for (const record of settings) {
        if (!Object.keys(record.data).length) { empty.push(record.id); continue; }
        for (const [key, value] of Object.entries(record.data)) {
            if (NAME_KEYED_CANON.includes(key)) {
                throw new Error(`设定 ${record.id} 的 data.${key} 是名号键（抽取旧路的名册/关系网）`
                    + '——正式记录用 ID，不接受名号键');
            }
            const schema = Object.hasOwn(CANON_SCHEMA.props,key) ? CANON_SCHEMA.props[key] : null;
            if (!schema) {
                throw new Error(`设定 ${record.id} 的 data.${key} 不是当前 canon 形状的键`);
            }
            const shape = validate(value, schema);
            if (!shape.ok) throw new Error(`设定 ${record.id} 的 data.${key} 形状不合法：${shape.errors.join('; ')}`);
            switch (schema.kind) {
                case 'array': {
                    const list = canon[key] ?? (canon[key] = []);
                    for (const item of value) list.push(structuredClone(item));
                    break;
                }
                case 'string':
                    canon[key] = mergeCanonString(canon[key], value);
                    break;
                case 'strRecord': {
                    const target = canon[key] ?? (canon[key] = {});
                    for (const [k, v] of Object.entries(value)) {
                        const ownerKey = `${key}\0${k}`;
                        if (Object.hasOwn(target, k) && target[k] !== v) {
                            throw new Error(`设定 ${record.id} 与 ${mapOwners.get(ownerKey)} 都写了 canon.${key}[${k}]`
                                + ' 且值不同（冲突，不许静默合并）');
                        }
                        Object.defineProperty(target,k,{value:v,enumerable:true,writable:true,configurable:true});
                        if (!mapOwners.has(ownerKey)) mapOwners.set(ownerKey, record.id);
                    }
                    break;
                }
                case 'object': {
                    if (schema !== geographySchema) {
                        throw new Error(`设定 ${record.id} 的 data.${key} 是未支持聚合的 canon 对象格`);
                    }
                    geographies.push(value);
                    break;
                }
                default:
                    throw new Error(`设定 ${record.id} 的 data.${key} 的 schema kind ${JSON.stringify(schema.kind)}`
                        + ' 没有聚合策略');
            }
        }
    }
    // 概念表是源，旧两列是派生视图（与 abstract.js 的 `scalesToFlat` 同一口径）：只有记录真的交了
    // `刻度`、且对应旧列没被显式交过时才派生。显式交过的旧记录逐字保留（legacy explicit 不改写）。
    if (suppliedKeys.has('刻度')) {
        const flat = scalesToFlat(canon.刻度);
        if (!suppliedKeys.has('powerScale')) canon.powerScale = flat.powerScale;
        if (!suppliedKeys.has('dims')) canon.dims = flat.dims;
    }
    // 地理：设定来源先按 ID 合成一份，再与正式地点记录并（同名不同 ID 各自保留，不按名字合并）。
    const settingsGeography = geographies.length ? mergeGeographyById(geographies, { checkIntegrity: false, registrationOnly, geographyNames }) : null;
    const mergedGeography = mergeSourceGeography(settingsGeography, index,{registrationOnly,geographyNames});
    if (mergedGeography.geography) canon.geography = mergedGeography.geography;
    const check = validate(canon, CANON_SCHEMA);
    if (!check.ok) throw new Error(`设定合并后未过 canon 契约：${check.errors.join('; ')}`);
    return { canon, empty, geographySkipped: mergedGeography.skipped };
}

/** Per-source setting evidence uses one aggregator for world creation and setting/scales updates.
 * Return only supplied keys, so a partial update never writes the aggregator's empty defaults. */
export function sourceSettingPatch(records) {
    const index=indexRecords(records),{canon}=buildCanon(index.settings,index);
    const supplied=new Set([...index.settings,...relationSettings(index)].flatMap(record=>Object.keys(record.data)));
    // 交了概念表 `刻度` 就把派生视图一并回给补丁：缺的那一列由 `buildCanon` 从刻度派生。
    // 没交刻度的键保持"没提就不写"，绝不空覆盖。
    const keys=new Set(supplied);
    if(supplied.has('刻度')){keys.add('powerScale');keys.add('dims');}
    return Object.fromEntries([...keys].map(key=>[key,structuredClone(canon[key])]));
}

// 资料指纹：**同一个固定版本 ⇒ 同一个指纹**（含内容摘要），供幂等/留痕用（不读磁盘、不调模型）。
function fingerprintOf(publication) {
    const digest = sha256Hex(JSON.stringify({
        library_id: publication.library_id,
        version: publication.version,
        sources: publication.sources,
        omitted_source_ids: publication.omitted_source_ids,
        records: publication.records,
    }));
    return `source:${publication.library_id}@${publication.version}:${digest.slice(0, 16)}`;
}

/**
 * sourceWorld：把**一个已发布的固定资料版本**转成一个新世界。
 * @param {object} bundle 发布版本（`library_id/version/records/sources/omitted_source_ids`）
 * @param {object} options `worldName/positions/tension/entityLocations/playerId/blockedIds/extractedAt`
 * @returns {{world: object, source: object}} 世界过 `ssotSchema`；`source` 是给调用方的身份回执与诊断
 */
export function sourceWorld(bundle, options = {}) {
    const publication = readBundle(bundle);
    if(isFinalizedPublication(publication))validateFinalizedPublication(publication);
    const input = readOptions(options);
    const index = indexRecords(publication.records);
    const locations = resolveLocations(index, input);
    const { entities, emptyFields, renamedFields } = buildEntities(index, input, locations.resolved);
    const { relations, skipped } = buildRelations(index);
    if(isFinalizedPublication(publication))for(const relation of relations)if(publication.finalized.current.relations.find(r=>r.id===relation.id)?.state==='ended'){relation.endedTick=0;relation.endedWhy='原文开局前已结束';}
    const registrationOnly=publication.ab_registration===1;
    const geographyNames=new Map((registrationOnly?publication.finalized?.geography_name_choices??[]:[]).map(choice=>[choice.place_id,choice.name]));
    const { canon, empty: emptySettings, geographySkipped } = buildCanon(index.settings, index,{registrationOnly,geographyNames});
    const fingerprint = fingerprintOf(publication);
    const initial=sourceInitialState(publication,index,{fingerprint,extractedAt:input.extractedAt});
    const diagnostics = {
        non_entity_relations: skipped,
        ...(publication.ab_initial?{initial_state:initial.diagnostics}:{}),
        geography_relations: geographySkipped,
        empty_fields: [...locations.emptyFields, ...emptyFields],
        empty_settings: emptySettings,
        ...(renamedFields.length ? {renamed_fields: renamedFields} : {}),
    };
    const world = {
        version: WORLD_VERSION,
        context: {
            world: input.worldName,
            tension: input.tension,
            positions: [...input.positions],
            ...(input.playerId ? { playerId: input.playerId } : {}),
            // 形状复用既有零模型装配器：canon 五件套 + 张力 + env（env 空=没读数，不编档位词）。
            setting: assembleSetting({
                canon,
                tension: { polarity: '', direction: '' },
                env: {},
                legacyTension: input.tension,
                fingerprint,
                extractedAt: input.extractedAt,
            }),
        },
        entities,
        weights: {},
        agendas: initial.agendas,
        events: initial.events,
        relations,
        conditions: [],
        milestones: [],
        chronicle: [],
        meta: {
            tick: 0,
            // 完整发布原件 + 来源指针 + 本层记账（发布版本是哪一份、缺了谁、哪些内容没能落成世界状态）。
            sourcePublication: {
                ...publication,
                conversion: { fingerprint, baseline_hash:sourceBaselineHash(publication), extracted_at: input.extractedAt, diagnostics, ...(publication.ab_initial?{initial_state_records:initial.records}:{}) },
            },
        },
    };
    const check = validate(world, ssotSchema);
    if (!check.ok) throw new Error(`sourceWorld 产出未过 ssotSchema：${check.errors.join('; ')}`);
    const source = {
        library_id: publication.library_id,
        version: publication.version,
        omitted_source_ids: [...publication.omitted_source_ids],
        sources: structuredClone(publication.sources),
        fingerprint,
        extracted_at: input.extractedAt,
        counts: {
            records: publication.records.length,
            entities: entities.length,
            relations: relations.length,
            locations: index.locations.size,
            settings: index.settings.length,
        },
        diagnostics,
    };
    return { world, source };
}

// Reuses formal-ID geography conversion for an explicitly adopted map update.
export function sourceGeography(records,existing=null) { return mergeSourceGeography(existing,indexRecords(records)); }

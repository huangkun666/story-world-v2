import {normalizeRuleKinds} from './source-semantics.js';
import {SOURCE_GEOGRAPHY_CONTRACT} from './source-records.js';
// Pure adapter: project one raw source-job response onto the program's record contract.
//
// Contract (2026-10-13):
//   · Never mutate the caller's protocol; the returned `protocol` is an independent deep clone and
//     every field of every record is kept verbatim (no truncation, no inferred values).
//   · Kind is normalized only for the explicitly listed synonyms
//     (人物/person/character → character, 势力/force/faction/organization → faction,
//     地点/place/location → location). Any other value is left untouched for validation to reject.
//   · Every identity is assigned a deterministic program ref `e1..eN` in array order. Every other
//     field (name, aliases, sources, disambiguation, unknown extras) is preserved.
//   · The explicit boolean adjacent:true, with no existing geography fields, maps to
//     geography_type:adjacent; the original key/value is retained in projections. Other values
//     or coexisting geography fields stay untouched for validation to reject.
//   · Relation endpoints are resolved from an original ref OR an exact full name/alias (no trim, no
//     fuzzy, no ref-over-name priority). A collision is disambiguated by intersecting the relation's
//     sources with the identity's sources; when that is still ambiguous the adapter throws instead of
//     guessing or dropping the relation. Unknown endpoints are left as-is for validation.
//   · A geography annotation on a relation whose endpoints both resolve to known
//     character/faction/location identities, at least one of them non-location, is preserved as an
//     ordinary relation: the five geo fields are removed and every original value is appended to the
//     text verbatim (Chinese label + original value), and one log entry is pushed to `projections`.
//     Unknown endpoints/kinds are never downgraded; two location endpoints keep the strict geo
//     contract untouched (missing direction is never filled in).
//
// This module is pure: no I/O, no clock, no global state.

const GEO_FIELDS = Object.freeze(['geography_type', 'bearing', 'via', 'direction', 'condition']);
const GEO_LABELS = Object.freeze({
    geography_type: '地理类型',
    bearing: '方位',
    via: '途经',
    direction: '方向',
    condition: '条件',
});
const KNOWN_KINDS = Object.freeze(['character', 'faction', 'location']);

/** Explicit synonym table only; anything else is unknown and left for validation. */
const KIND_SYNONYMS = new Map(Object.entries({
    人物: 'character', person: 'character', character: 'character',
    势力: 'faction', force: 'faction', faction: 'faction', organization: 'faction',
    地点: 'location', place: 'location', location: 'location',
}));

/**
 * Deterministic kind normalization over the explicit synonym table. Unknown values are returned
 * unchanged (no guessing); case/whitespace folding applies only to the lookup key.
 */
export function normalizeSourceJobKind(value) {
    if (typeof value !== 'string') return value;
    const key = value.trim().toLowerCase();
    return KIND_SYNONYMS.get(key) ?? value;
}

export function isKnownSourceJobKind(value) {
    return KNOWN_KINDS.includes(value);
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Lossless deep clone of plain JSON data; primitives (including undefined) pass through. */
function cloneValue(value) { return structuredClone(value); }

function textToken(value) {
    return typeof value === 'string' && value ? value : null;
}

/** Every exact token an endpoint may use to name one identity: original ref, name and aliases. */
function identityTokens(identity) {
    const tokens = new Set();
    if (!isObject(identity)) return tokens;
    for (const token of [identity.ref, identity.name]) if (textToken(token)) tokens.add(token);
    if (Array.isArray(identity.aliases)) for (const alias of identity.aliases) if (textToken(alias)) tokens.add(alias);
    return tokens;
}

function sourcesOf(record) {
    return Array.isArray(record?.sources) ? record.sources.filter(source => typeof source === 'string') : [];
}

/** Exact source intersection; an empty side never disambiguates. */
function sourcesIntersect(left, right) {
    const set = new Set(sourcesOf({ sources: left }));
    if (!set.size) return false;
    return sourcesOf({ sources: right }).some(source => set.has(source));
}

/**
 * Resolve one relation endpoint value to an identity index.
 * @returns {{status:'unresolved'}|{status:'resolved',index:number}|{status:'ambiguous',matches:number[]}}
 */
function resolveEndpoint(value, tokens, identities, relationSources) {
    if (!textToken(value)) return { status: 'unresolved' };
    const matches = [];
    for (let index = 0; index < tokens.length; index += 1) if (tokens[index].has(value)) matches.push(index);
    if (!matches.length) return { status: 'unresolved' };
    if (matches.length === 1) return { status: 'resolved', index: matches[0] };
    const bySource = matches.filter(index => sourcesIntersect(identities[index]?.sources, relationSources));
    if (bySource.length === 1) return { status: 'resolved', index: bySource[0] };
    return { status: 'ambiguous', matches };
}

/** Readable, lossless rendering of the original geography values the relation carried. */
function geographySuffix(relation) {
    const parts = [];
    for (const field of GEO_FIELDS) {
        if (!Object.hasOwn(relation, field)) continue;
        const value = relation[field];
        parts.push(`${GEO_LABELS[field]}=${typeof value === 'string' ? value : String(value)}`);
    }
    return `\n（原提议地理注记：${parts.join('；')}）`;
}

/**
 * Project one source-job protocol response. The input is never modified.
 * @param {object} protocol raw response with optional `identities`, `relations`, `properties` arrays
 * @param {{chunks?:Array}} [options] planned chunks (accepted for caller symmetry; projection itself
 *        is chunk-independent and reads only the response's own refs/sources)
 * @returns {{protocol:object, projections:Array}}
 */
export function projectSourceJobResponse(protocol, { chunks = [] } = {}) {
    void chunks;
    if (!isObject(protocol)) throw new TypeError('source job protocol must be a JSON object');
    const output = cloneValue(protocol);
    const projections = [];
    for(const [index,setting]of (Array.isArray(output.settings)?output.settings:[]).entries()){
        if(!isObject(setting?.data)||!Array.isArray(setting.data.ruleKinds))continue;
        const mapped=normalizeRuleKinds(setting.data.rules,setting.data.ruleKinds);
        if(!Array.isArray(mapped)){setting.data.ruleKinds=mapped;projections.push({type:'ordered-rule-classifications',index,count:setting.data.rules?.length??0});}
    }

    const inputIdentities = Array.isArray(protocol.identities) ? protocol.identities : [];
    const identities = Array.isArray(output.identities) ? output.identities : [];
    const properties = Array.isArray(output.properties) ? output.properties : [];
    const relations = Array.isArray(output.relations) ? output.relations : [];

    const tokens = inputIdentities.map(identityTokens);

    for (const [index, identity] of identities.entries()) {
        if (!isObject(identity)) continue;
        identity.kind = normalizeSourceJobKind(identity.kind);
        identity.ref = 'e' + (index + 1);
    }
    for (const property of properties) {
        if (!isObject(property)) continue;
        property.kind = normalizeSourceJobKind(property.kind);
    }

    for (const [index, relation] of relations.entries()) {
        if (!isObject(relation)) continue;
        const relationSources = relation.sources;
        const from = resolveEndpoint(relation.from, tokens, inputIdentities, relationSources);
        const to = resolveEndpoint(relation.to, tokens, inputIdentities, relationSources);
        if (from.status === 'ambiguous') throw new TypeError(`source job relation ${index} from ${JSON.stringify(relation.from)} is ambiguous`);
        if (to.status === 'ambiguous') throw new TypeError(`source job relation ${index} to ${JSON.stringify(relation.to)} is ambiguous`);
        if (from.status === 'resolved') relation.from = 'e' + (from.index + 1);
        if (to.status === 'resolved') relation.to = 'e' + (to.index + 1);

        // Only the verified boolean spelling is structural; never interpret a value or
        // reconcile competing geography annotations. The existing endpoint rules below
        // decide whether this can be a map edge or must remain an ordinary literal relation.
        if (Object.hasOwn(relation, 'adjacent') && relation.adjacent === true
            && !GEO_FIELDS.some(field => Object.hasOwn(relation, field))) {
            relation.geography_type = 'adjacent';
            delete relation.adjacent;
            projections.push({ type: 'geography-type-from-boolean', index,
                original_key: 'adjacent', original_value: true, geography_type: 'adjacent' });
        }

        if(!Object.hasOwn(relation,'geography_type')){
            const hasBearing=Object.hasOwn(relation,'bearing'),hasDirection=Object.hasOwn(relation,'direction');
            const inferred=hasBearing&&!hasDirection&&SOURCE_GEOGRAPHY_CONTRACT.enums.bearing.includes(relation.bearing)?'bearing':hasDirection&&!hasBearing&&SOURCE_GEOGRAPHY_CONTRACT.enums.direction.includes(relation.direction)?'passage':null;
            if(inferred){relation.geography_type=inferred;projections.push({type:'geography-type-from-field',index,geography_type:inferred,field:hasBearing?'bearing':'direction',value:hasBearing?relation.bearing:relation.direction,original_text:relation.text});}
        }
        const details={};
        for(const [flag,field] of [['via_explicit','via'],['condition_explicit','condition']]){
            if(!Object.hasOwn(relation,flag))continue;
            if(typeof relation[flag]!=='boolean')throw new TypeError('geography evidence flags must be booleans');
            details[flag]=relation[flag];
            if(relation[flag]&&Object.hasOwn(relation,'geography_type')&&typeof relation.text==='string'&&relation.text.trim()&&!Object.hasOwn(relation,field))relation[field]=relation.text;
            delete relation[flag];
        }
        if(Object.keys(details).length)projections.push({type:'geography-details-from-text',index,...details,original_text:relation.text});
        if (!Object.hasOwn(relation, 'geography_type')) continue;
        // Malformed text/annotation values remain errors; projection may not conceal them.
        if(typeof relation.text!=='string'||!relation.text.trim()||!Object.hasOwn(SOURCE_GEOGRAPHY_CONTRACT.variants,relation.geography_type)||GEO_FIELDS.some(key=>Object.hasOwn(relation,key)&&(typeof relation[key]!=='string'||!relation[key].trim()))||Object.entries(SOURCE_GEOGRAPHY_CONTRACT.enums).some(([key,values])=>Object.hasOwn(relation,key)&&!values.includes(relation[key])))continue;
        if (from.status !== 'resolved' || to.status !== 'resolved') continue;
        const fromkind = identities[from.index]?.kind;
        const tokind = identities[to.index]?.kind;
        if (!isKnownSourceJobKind(fromkind) || !isKnownSourceJobKind(tokind)) continue;
        const variant=SOURCE_GEOGRAPHY_CONTRACT.variants[relation.geography_type];
        const coherent=variant.requires.every(key=>Object.hasOwn(relation,key))&&!variant.forbids.some(key=>Object.hasOwn(relation,key));
        if (fromkind === 'location' && tokind === 'location' && coherent) continue;

        const original = {};
        for (const field of GEO_FIELDS) if (Object.hasOwn(relation, field)) original[field] = relation[field];
        const originalText = relation.text;
        const suffix = geographySuffix(relation);
        relation.text = typeof originalText === 'string' ? originalText + suffix : suffix;
        for (const field of GEO_FIELDS) delete relation[field];

        projections.push({
            type: 'geography-downgrade',
            index,
            fromkind,
            tokind,
            from_ref: relation.from,
            to_ref: relation.to,
            ...original,
            original_text: originalText,
            appended_text: suffix,
        });
    }

    return { protocol: output, projections };
}

// Frozen source-derived spatial facts; view projections are not persisted here.
export const GEOGRAPHY_VERSION = 1;
// ★方位（bearing）：`from` 地点在 `to` 地点的该方位；只收原文明述/显式结构，不从名号或通道方向猜。
export const BEARING_DIRECTIONS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const text = { kind: 'string', minLength: 1 };
export const geographySchema = {
    kind: 'object', additional: false, required: ['version', 'places', 'links'],
    props: {
        version: { kind: 'number', int: true, min: GEOGRAPHY_VERSION, max: GEOGRAPHY_VERSION },
        places: { kind: 'array', items: {
            kind: 'object', additional: false, required: ['id', 'name'],
            props: { id: text, name: text, aliases: {kind: 'array', items: text}, qualifier: text },
        } },
        links: { kind: 'array', items: {
            kind: 'object', additional: false, required: ['from', 'to', 'type'],
            props: { from: text, to: text, type: {kind: 'string', enum: ['within', 'adjacent', 'passage', 'bearing']},
                bearing: {kind: 'string', enum: BEARING_DIRECTIONS},
                via: text, direction: {kind: 'string', enum: ['both', 'forward']}, condition: text },
            // 契约只管形状（bearing 属八向键表）；"bearing 边必须有合法方位"的语义闸在
            // sanitizeGeography / mergeGeography / buildMapData 三处同一口径执行。
        } },
    },
};

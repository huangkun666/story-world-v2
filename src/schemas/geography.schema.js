// Frozen source-derived spatial facts; view projections are not persisted here.
export const GEOGRAPHY_VERSION = 1;
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
            props: { from: text, to: text, type: {kind: 'string', enum: ['within', 'adjacent', 'passage']},
                via: text, direction: {kind: 'string', enum: ['both', 'forward']}, condition: text },
        } },
    },
};

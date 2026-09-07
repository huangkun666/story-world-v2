// story-world-v2/src/schema.js
// 迷你 schema 校验器（零依赖）：真 schema 强制的地基（S2，还 D-C3 债）。
// 支持 kind: object / array / string / number / boolean / numRecord / any
// 语义约束（如 progress ≤ maxSteps、事件位置 ∈ 世界状态）归引擎校验，schema 只管形状。

export function validate(doc, schema) {
    const errors = [];
    walk(doc, schema, '$', errors);
    return { ok: errors.length === 0, errors };
}

function walk(value, schema, path, errors) {
    switch (schema.kind) {
        case 'object': {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                errors.push(`${path}: 期望对象`);
                return;
            }
            for (const k of schema.required || []) {
                if (!(k in value)) errors.push(`${path}.${k}: 必填缺失`);
            }
            for (const [k, v] of Object.entries(value)) {
                const sub = schema.props?.[k];
                if (!sub) {
                    if (!schema.additional) errors.push(`${path}.${k}: 未知字段`);
                    continue;
                }
                walk(v, sub, `${path}.${k}`, errors);
            }
            break;
        }
        case 'array': {
            if (!Array.isArray(value)) {
                errors.push(`${path}: 期望数组`);
                return;
            }
            if (schema.minItems != null && value.length < schema.minItems) {
                errors.push(`${path}: 少于 ${schema.minItems} 项`);
            }
            if (schema.maxItems != null && value.length > schema.maxItems) {
                errors.push(`${path}: 多于 ${schema.maxItems} 项`);
            }
            value.forEach((v, i) => walk(v, schema.items, `${path}[${i}]`, errors));
            break;
        }
        case 'string': {
            if (typeof value !== 'string') {
                errors.push(`${path}: 期望字符串`);
                return;
            }
            if (schema.enum && !schema.enum.includes(value)) {
                errors.push(`${path}: 枚举外值 "${value}"`);
            }
            if (schema.minLength != null && value.length < schema.minLength) {
                errors.push(`${path}: 短于 ${schema.minLength}`);
            }
            break;
        }
        case 'number': {
            if (typeof value !== 'number' || Number.isNaN(value)) {
                errors.push(`${path}: 期望数字`);
                return;
            }
            if (schema.int && !Number.isInteger(value)) errors.push(`${path}: 期望整数`);
            if (schema.min != null && value < schema.min) errors.push(`${path}: 小于 ${schema.min}`);
            if (schema.max != null && value > schema.max) errors.push(`${path}: 大于 ${schema.max}`);
            break;
        }
        case 'boolean': {
            if (typeof value !== 'boolean') errors.push(`${path}: 期望布尔`);
            break;
        }
        case 'numRecord': {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                errors.push(`${path}: 期望对象`);
                return;
            }
            for (const [k, v] of Object.entries(value)) {
                if (typeof v !== 'number' || Number.isNaN(v)) errors.push(`${path}.${k}: 期望数字`);
            }
            break;
        }
        case 'any':
            break;
        default:
            throw new Error(`未知 schema kind: ${schema.kind}`);
    }
}
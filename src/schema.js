// story-world-v2/src/schema.js
// 迷你 schema 校验器（零依赖）：真 schema 强制的地基（S2，还 D-C3 债）。
// 支持 kind: object / array / string / number / boolean / numRecord / strRecord / any
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
                    // ★leg34：`denied` = **显式拒收的已退休字段**（与 `additional` 配合用）。
                    //   为什么需要它：放开额外字段（`additional: true`）会把**删掉的旧字段一起放回来**——
                    //   本棒实测 `attrs`（四维浮点，leg25 c 已删）当场被重新接受，3 条老用例红。
                    //   而那条规矩是硬规矩：「**删字段只删一半最危险**——引擎不写、契约仍收 = 看起来删了其实没有」。
                    //   ⇒ 分工：`additional` 管"**没见过的键**"（放行），`denied` 管"**见过但已废的键**"（拒收）。
                    if (schema.denied?.includes(k)) errors.push(`${path}.${k}: 已退休字段（不再接受——"删字段只删一半"最危险）`);
                    else if (!schema.additional) errors.push(`${path}.${k}: 未知字段`);
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
        case 'strRecord': {   // leg26：字符串值映射（世界参数档位：键 → 档位原话）
            if (value === null || typeof value !== 'object' || Array.isArray(value)) {
                errors.push(`${path}: 期望对象`);
                return;
            }
            for (const [k, v] of Object.entries(value)) {
                if (typeof v !== 'string' || !v.trim()) errors.push(`${path}.${k}: 期望非空字符串`);
            }
            break;
        }
        case 'any':
            break;
        default:
            throw new Error(`未知 schema kind: ${schema.kind}`);
    }
}
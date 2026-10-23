import { createDefaultPromptPresets } from './prompt-preset-defaults.js';

export { createDefaultPromptPresets } from './prompt-preset-defaults.js';

const ROLES = new Set(['system', 'user', 'assistant']);
const PURPOSES = new Set(['abstract', 'simulate']);
const own = (obj, key) => Object.hasOwn(obj, key);
function invalid(message) { throw new Error('提示词预设：' + message); }
function dataProperty(value, key, label) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!own(descriptor, 'value')) invalid(label + '不能包含访问器');
    if (!descriptor.enumerable) invalid(label + '不能包含非枚举字段');
    if (typeof key !== 'string') invalid(label + '包含未知字段');
}
function object(value, label, inspectOwn = true) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(label + '必须是普通对象');
    if (inspectOwn) for (const key of Reflect.ownKeys(value)) dataProperty(value, key, label);
}
function array(value, label) {
    if (!Array.isArray(value)) invalid(label + '必须是数组');
    const fields = Reflect.ownKeys(value);
    for (const key of fields) {
        // length 是数组固有的非枚举属性；其余字段必须是普通索引数据。
        if (key === 'length') continue;
        dataProperty(value, key, label);
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) invalid(label + '包含未知字段');
    }
    if (fields.length !== value.length + 1) invalid(label + '不能包含稀疏空洞');
    return value;
}
function keys(value, allowed, label) {
    object(value, label);
    if (Reflect.ownKeys(value).some(key => !allowed.includes(key))) invalid(label + '包含未知字段');
}
function text(value, label) {
    if (typeof value !== 'string' || !value.trim()) invalid(label + '不能为空');
    return value;
}
function validatePreset(value, { requireId = true } = {}) {
    keys(value, requireId ? ['id', 'name', 'messages'] : ['name', 'messages'], '预设');
    const result = requireId ? { id: text(value.id, '预设 ID') } : {};
    result.name = text(value.name, '预设名称');
    array(value.messages, '消息列表');
    const ids = new Set();
    let tasks = 0;
    result.messages = Array.from(value.messages).map(message => {
        object(message, '消息');
        // 只允许结构化任务标记，不能把普通正文当作任务。
        if (own(message, 'task')) {
            keys(message, ['id', 'task'], '任务消息');
            if (message.task !== true || message.id !== 'task') invalid('任务消息必须使用 task 标记和 ID');
            if (ids.has(message.id)) invalid('消息 ID 不能重复');
            ids.add(message.id);
            tasks++;
            return { id: 'task', task: true };
        }
        keys(message, ['id', 'name', 'role', 'content', 'enabled'], '普通消息');
        const id = text(message.id, '消息 ID');
        if (id === 'task' || ids.has(id)) invalid('消息 ID 不能重复或占用 task');
        ids.add(id);
        const name = text(message.name, '消息名称');
        if (!ROLES.has(message.role)) invalid('消息角色只支持 system、user、assistant');
        if (typeof message.content !== 'string') invalid('消息正文必须是文本');
        if (typeof message.enabled !== 'boolean') invalid('消息启用状态必须是布尔值');
        return { id, name, role: message.role, content: message.content, enabled: message.enabled };
    });
    if (tasks !== 1) invalid('每份预设必须恰有一条任务消息');
    return result;
}
export function validatePromptPresets(config) {
    keys(config, ['version', 'presets', 'bindings'], '配置');
    if (config.version !== 1) invalid('不支持此配置版本');
    array(config.presets, '预设列表');
    const presets = Array.from(config.presets).map(preset => validatePreset(preset));
    const ids = new Set();
    for (const preset of presets) {
        if (ids.has(preset.id)) invalid('预设 ID 不能重复');
        ids.add(preset.id);
    }
    keys(config.bindings, ['abstract', 'simulate'], '用途选择');
    const bindings = {};
    for (const purpose of PURPOSES) {
        const id = config.bindings[purpose];
        if (typeof id !== 'string' || (id !== '' && !ids.has(id))) invalid('用途选择引用了不存在的预设');
        bindings[purpose] = id;
    }
    return { version: 1, presets, bindings };
}
export function readPromptPresets(settings) {
    object(settings, '设置', false);
    const config = settings.promptPresets;
    return config === undefined ? createDefaultPromptPresets() : validatePromptPresets(config);
}
function freeze(value) {
    if (value && typeof value === 'object') {
        for (const item of Object.values(value)) freeze(item);
        Object.freeze(value);
    }
    return value;
}
export function buildPresetRequest(settings, purpose, prompt) {
    if (!PURPOSES.has(purpose)) invalid('用途只支持 abstract 或 simulate');
    if (typeof prompt !== 'string') invalid('任务正文必须是文本');
    const config = readPromptPresets(settings);
    const id = config.bindings[purpose];
    if (!id) return freeze({ messages: undefined, preset: null });
    const chosen = config.presets.find(preset => preset.id === id);
    const messages = [];
    for (const message of chosen.messages) {
        if (message.task) messages.push({ role: 'user', content: prompt });
        else if (message.enabled) messages.push({ role: message.role, content: message.content });
    }
    return freeze({ messages, preset: { purpose, id: chosen.id, name: chosen.name, messages: chosen.messages } });
}

// 只派生编辑视图；旧版多段内容不能被当作单段正文写回。
export function promptPresetEditorValue(preset) {
 const rows=preset?.messages??[];
 const editable=rows.length===2&&!rows[0].task&&rows[0].role==="system"&&rows[0].enabled===true&&rows[1].task===true;
 if(editable)return {editable:true,content:rows[0].content};
 return {editable:false,content:rows.filter(row=>!row.task).map((row,i)=>"第"+(i+1)+"段 · "+row.name+(row.enabled?"":" · 已停用")+"\n"+row.content).join("\n\n")};
}

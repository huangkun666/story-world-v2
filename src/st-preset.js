// story-world-v2/src/st-preset.js
// 酒馆预设直读（用户授权：直接使用酒馆预设跑世界主调用）：
// 从 ST settings.json 递归定位旧插件 llmPresets + activeLlmPreset（预设 1 = gemini 旗舰，预设 2 = deepseek flash），
// 取活跃预设 → 归一化 base → 返回 transport。密钥只在运行时本机读取，不落库、不打印。
import { readFileSync } from 'node:fs';
import { createHttpTransport, createEnvTransport } from './transport-http.js';

export const DEFAULT_SETTINGS_PATH = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/settings.json';

function findNode(obj, key, mustAlsoHave) {
    if (!obj || typeof obj !== 'object') return null;
    if (key in obj && (!mustAlsoHave || mustAlsoHave in obj)) return obj;
    for (const v of Object.values(obj)) {
        const r = findNode(v, key, mustAlsoHave);
        if (r) return r;
    }
    return null;
}

export function loadStPresetConfig(settingsPath = process.env.ST_SETTINGS_PATH || DEFAULT_SETTINGS_PATH) {
    let raw;
    try {
        raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
    } catch {
        return null;
    }
    // 优先 story-world 插件自己的节点（特征键 worldSimWave/dashboardView），退而求其次找任意 activeLlmPreset 节点
    const node = findNode(raw, 'activeLlmPreset', 'worldSimWave')
        || findNode(raw, 'activeLlmPreset', 'dashboardView')
        || findNode(raw, 'activeLlmPreset');
    if (!node || !Array.isArray(node.llmPresets)) return null;
    const active = node.llmPresets.find((p) => p.id === node.activeLlmPreset);
    const preset = active || node.llmPresets[0];
    if (!preset?.baseUrl || !preset?.apiKey || !preset?.model) return null;
    return { baseUrl: preset.baseUrl, apiKey: preset.apiKey, model: preset.model, presetName: preset.name };
}

// 统一解析：env → 酒馆预设 → null。返回 { transport, source, baseUrl, model }（不暴露密钥字段）。
export function resolveWorldTransport(env = process.env) {
    const envT = createEnvTransport(env);
    if (envT) {
        const base = env.ST_OPENAI_BASE || env.OPENAI_BASE_URL;
        const model = env.ST_WORLD_MODEL || env.OPENAI_MODEL;
        return { transport: envT, source: 'env', baseUrl: base, model };
    }
    const cfg = loadStPresetConfig();
    if (cfg) {
        return {
            transport: createHttpTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model }),
            source: 'st-preset',
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            presetName: cfg.presetName,
        };
    }
    return null;
}
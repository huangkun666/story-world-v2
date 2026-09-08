// story-world-v2/src/player-setup.js
// 玩家开档解析接线（K32/双流 UI，编排层；细案 §3.5 → A-8）：
// playerDesc →（截断 PLAYER_DESC_LIMIT=2000 提案）→ 一次小调用 prompt（只提取不创作、
// 四字段全可选 [0,1]、无依据不输出）→ transport 提取 → JSON 解析 → injectPlayerAttrs（v1.1）
// 落账。触发：设定池就绪（frozen.canon）且世界含 playerId——不满足原样返回（P-E 零扰动）。
// 失败零阻塞：调用抛错/超时/非法 JSON/非对象 → parsed=null → 全部落定案默认（#6-9）。
// overwrite=true = force 重解析（「重新抽取设定」联动，T7-3）：只覆盖 meta.playerParse
// 溯源账内的键（上一轮由解析注入的）；手填键永不触碰；重解析失败保持旧解析值。
// 手填优先/幂等/[0,1] 钳制 全部由注入器担保（不重复实现）。
import { PLAYER_DESC_LIMIT, injectPlayerAttrs } from './player-inject.js';

export function buildPlayerParsePrompt(playerDesc) {
    return [
        '你是玩家开档描述的抽取器。只提取不创作：从下面的描述里摘出玩家实力的陈述，没有依据的字段一律不输出。',
        '输出严格 JSON，形状如下（四字段全可选，数值域 [0,1]；可省字段不写 null）：',
        JSON.stringify({ hardPower: 0.5, office: 0.5, intel: 0.5, network: 0.5 }, null, 2),
        'hardPower = 武力/修为 ｜ office = 权位/职务 ｜ intel = 耳目/知晓 ｜ network = 人脉/门路',
        '———— 玩家开档描述如下 ————',
        playerDesc,
    ].join('\n');
}

export async function runPlayerSetup({ ssot, playerDesc = '', transport, overwrite = false }) {
    const playerId = ssot.context?.playerId;
    const canon = ssot.context?.setting?.frozen?.canon;
    if (!playerId || !canon) {
        return { ok: true, ssot, skipped: 'no-trigger' };   // 设定池未就绪/无玩家：零扰动（P-E）
    }

    const desc = String(playerDesc ?? '').slice(0, PLAYER_DESC_LIMIT).trim();
    let parsed = null;
    if (desc) {
        let rawText = null;
        if (typeof transport === 'function') {
            try {
                const resp = await transport(buildPlayerParsePrompt(desc));
                rawText = typeof resp === 'string' ? resp : null;
            } catch {
                rawText = null;   // 失败零阻塞：parsed 保持 null → 定案默认
            }
            if (rawText != null) {
                const t = rawText.trim();
                if (t) {
                    try {
                        const j = JSON.parse(t);
                        if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j;
                    } catch { /* 非法 JSON：parsed 保持 null */ }
                }
            }
        }
    }

    const next = injectPlayerAttrs(ssot, {
        playerDesc: desc,
        parse: parsed ? () => parsed : null,
        overwrite,
    });
    return { ok: true, ssot: next, skipped: desc ? null : 'empty-desc', parsed };
}
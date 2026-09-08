// story-world-v2/src/player-inject.js
// 玩家 attrs 自动注入（K28/设定大势层，细案 §3.4 → A-7；玩家档案细案 P-B 触发闭合）。
// 触发点：设定池就绪（frozen.canon 落库）且世界含 context.playerId；无玩家世界跳过（P-E 旁观兼容）。
// 映射表（T4 拍板）：命中即用、不覆盖手填（已有值一律不动）、全缺省回退到报批定案初始值（#6-9：
// hardPower 0.25 / office 0.05 / network 0.3 / intel 0.4）。
// 命中 = 零 token 关键词扫描（v1 powerFromNameContext 同思路：确定性、无 LLM 调用）；
// 力量词表顺序 = 长词在前（'至尊' 先于 '强'——防短词先命中）；表内数值提案态（随 K29 曲线报批）。
// 注入函数为纯函数（返回新 SSOT，不可变）；调用点 = 抽象管线初始化路径（ST 接线时落位，当前编排层就位）。

const orDefault = (v, d) => (v == null ? d : v);

export const PLAYER_INJECT_DEFAULTS = { hardPower: 0.25, office: 0.05, network: 0.3, intel: 0.4 };   // P-F 定案（报批 #6-9）

export const PLAYER_INJECT_HINTS = {
    hardPower: {
        src: (canon) => `${orDefault(canon.powerScale?.[0]?.note, '')} ${orDefault(canon.powerScale?.[0]?.level, '')}`,
        hints: [['至尊', 0.8], ['至强', 0.8], ['帝', 0.7], ['王', 0.6], ['强', 0.5], ['中', 0.3], ['凡', 0.1], ['弱', 0.1]],
    },
    office: {
        src: (canon) => orDefault(canon.society, ''),
        hints: [['朝', 0.4], ['宗', 0.3], ['世', 0.3], ['门', 0.2]],
    },
    intel: {
        src: (canon) => orDefault(canon.techOrMagic, ''),
        hints: [['谍', 0.5], ['讯', 0.4], ['术', 0.3], ['法', 0.3], ['修', 0.2]],
    },
};

export function injectPlayerAttrs(ssot) {
    const playerId = ssot.context?.playerId;
    const canon = ssot.context?.setting?.frozen?.canon;
    if (!playerId || !canon) return ssot;   // 触发点未就绪：不动（无玩家 = P-E 旁观零特判）
    const player = ssot.entities.find((e) => e.id === playerId);
    if (!player) return ssot;
    // 命中即用、不覆盖手填：仅填充缺失 attrs 键
    const next = { ...player, attrs: { ...player.attrs } };
    for (const [attr, conf] of Object.entries(PLAYER_INJECT_HINTS)) {
        if (next.attrs[attr] != null) continue;
        const text = conf.src(canon);
        const hit = conf.hints.find(([kw]) => text.includes(kw));
        if (hit) next.attrs[attr] = hit[1];
    }
    for (const [attr, dflt] of Object.entries(PLAYER_INJECT_DEFAULTS)) {
        if (next.attrs[attr] == null) next.attrs[attr] = dflt;
    }
    const out = structuredClone(ssot);
    out.entities = ssot.entities.map((e) => (e.id === playerId ? next : e));
    return out;
}
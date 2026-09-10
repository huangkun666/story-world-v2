// story-world-v2/src/player-inject.js
// 玩家 attrs 自动注入（K28/设定大势层，细案 §3.4 v1.1 → A-7；玩家档案细案 P-B 触发闭合）。
// v1.1（2026-09-08 第十棒，T7 拍板）：词表映射（#14-16 撤销）→ LLM 一次小解析：
//   输入物 = 玩家开档描述段 playerDesc（自然语言，调用方=ST 设置/开档流程持有；不落 SSOT）；
//   解析 = 一次小调用（transport 注入式，parse 依赖注入——测试注入 fake）：只提取不创作、
//   无依据字段不输出；输出形状 {hardPower?, office?, intel?, network?} 数值域 [0,1]，引擎边界钳制
//   （与红线 4"模型提议、引擎钳制"同构）；失败/超时/非法输出/空描述 → **什么都不写**（leg24 审计处置：默认值作废）。
// 落账：**只有解析出依据的维度才落账**；其余空着；手填一律优先（不覆盖）；幂等（已注入值视为手填）。
// 调用点 = 抽象管线初始化路径（ST 接线时落位，当前编排层就位）；失败零阻塞（世界原样不动，绝不编数）。

// leg24 检察官审计处置（F 组：引擎不再替玩家编数）：**定案默认值整条作废**。
//   旧法（报批 #6-9）：解析不出的维度落 0.25/0.05/0.3/0.4——那些数是引擎替他填的，
//   看起来却像客观数据，直接违反 design-core §2.4 硬规矩一「空着就是空着」。
//   现法：**只落解析得出的维度**（有依据才落账）；解析不出就空着，等世界提议或玩家自己说。
//   保留导出（空对象）只为不破坏既有 import 面；**不得再往里加默认值**。
export const PLAYER_INJECT_DEFAULTS = Object.freeze({});
export const PLAYER_DESC_LIMIT = 2000;   // 提案态：玩家描述输入上限（字符）——属长跑防线预算校准批（延续提案）

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function injectPlayerAttrs(ssot, { playerDesc = '', parse, overwrite = false } = {}) {
    const playerId = ssot.context?.playerId;
    const canon = ssot.context?.setting?.frozen?.canon;
    if (!playerId || !canon) return ssot;   // 触发点未就绪：不动（无玩家 = P-E 旁观零特判）
    const player = ssot.entities.find((e) => e.id === playerId);
    if (!player) return ssot;

    // 一次小调用解析（只提取不创作；解析器注入式——真跑=transport 包装，测试=fake）
    let parsed = null;
    const desc = playerDesc.slice(0, PLAYER_DESC_LIMIT);
    if (desc.trim() && typeof parse === 'function') {
        try { parsed = parse(desc); } catch { parsed = null; }   // 失败零阻塞：什么都不写（不编数）
    }

    // leg24 审计处置：默认值表已作废 → 键集合不再来自默认表，而来自**解析结果本身**
    const attrKeys = [...new Set([...Object.keys(parsed || {}), ...(ssot.meta?.playerParse?.injected || [])])];
    if (!attrKeys.length) return ssot;   // 没有任何可落账的维度：原样返回（空着就是空着）

    // 手填优先（含已注入值=幂等）；有依据字段=解析值（钳制）；**没有依据就什么都不写**
    // K32 溯源账：parse 有依据而落账的键记入 meta.playerParse.injected——
    // force 重解析（overwrite=true）只覆盖此集的键；手填键（从未由解析注入）永不触碰；
    // 重解析无新依据（失败/未输出该键）→ 旧解析值保留、溯源不变（不降级、也不填默认）。
    const prevInjected = new Set(ssot.meta?.playerParse?.injected || []);
    const next = { ...player, attrs: { ...(player.attrs || {}) } };
    const injected = new Set(prevInjected);
    for (const k of attrKeys) {
        const pv = parsed && isNum(parsed[k]) ? clamp01(parsed[k]) : null;
        if (next.attrs[k] == null) {
            if (pv == null) continue;          // 无依据 → 这一维空着（不写默认值）
            next.attrs[k] = pv;
            injected.add(k);
        } else if (overwrite && prevInjected.has(k)) {
            if (pv != null) { next.attrs[k] = pv; injected.add(k); }
            // pv == null：保持旧解析值，溯源不变
        }
        // 其余（手填/非拓源键）：不动
    }

    const out = structuredClone(ssot);
    out.entities = ssot.entities.map((e) => (e.id === playerId ? next : e));
    if (injected.size) {
        out.meta = { ...(out.meta || {}), playerParse: { injected: [...injected].sort() } };
    }
    return out;
}
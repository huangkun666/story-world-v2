// story-world-v2/src/player-inject.js
// 玩家 attrs 自动注入（K28/设定大势层，细案 §3.4 v1.1 → A-7；玩家档案细案 P-B 触发闭合）。
// v1.1（2026-09-08 第十棒，T7 拍板）：词表映射（#14-16 撤销）→ LLM 一次小解析：
//   输入物 = 玩家开档描述段 playerDesc（自然语言，调用方=ST 设置/开档流程持有；不落 SSOT）；
//   解析 = 一次小调用（transport 注入式，parse 依赖注入——测试注入 fake）：只提取不创作、
//   无依据字段不输出；输出形状 {hardPower?, office?, intel?, network?} 数值域 [0,1]，引擎边界钳制
//   （与红线 4"模型提议、引擎钳制"同构）；失败/超时/非法输出/空描述 → 全部落已定案默认（#6-9）。
// 落账：有依据字段=解析值；其余=默认；手填一律优先（不覆盖）；幂等（已注入值视为手填）。
// 调用点 = 抽象管线初始化路径（ST 接线时落位，当前编排层就位）；失败零阻塞（默认兜底）。

export const PLAYER_INJECT_DEFAULTS = { hardPower: 0.25, office: 0.05, network: 0.3, intel: 0.4 };   // P-F 定案（报批 #6-9）
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
        try { parsed = parse(desc); } catch { parsed = null; }   // 失败零阻塞：落默认
    }

    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
    const keys = Object.keys(PLAYER_INJECT_DEFAULTS);
    const valueOf = (k) => {
        const v = parsed && parsed[k];
        return isNum(v) ? clamp01(v) : PLAYER_INJECT_DEFAULTS[k];
    };

    // 手填优先（含已注入值=幂等）；有依据字段=解析值（钳制）；其余=已定案默认
    // K32 溯源账：parse 有依据而落账的键记入 meta.playerParse.injected——
    // force 重解析（overwrite=true）只覆盖此集的键；手填键（从未由解析注入）永不触碰；
    // 重解析无新依据（失败/未输出该键）→ 旧解析值保留、溯源不变（不降级默认）。
    const prevInjected = new Set(ssot.meta?.playerParse?.injected || []);
    const next = { ...player, attrs: { ...player.attrs } };
    const injected = new Set(prevInjected);
    for (const k of keys) {
        const pv = parsed && isNum(parsed[k]) ? clamp01(parsed[k]) : null;
        if (next.attrs[k] == null) {
            next.attrs[k] = pv ?? PLAYER_INJECT_DEFAULTS[k];
            if (pv != null) injected.add(k);
        } else if (overwrite && prevInjected.has(k)) {
            if (pv != null) { next.attrs[k] = pv; injected.add(k); }
            // pv == null：保持旧解析值，溯源不变（失败零阻塞语义的 force 面）
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
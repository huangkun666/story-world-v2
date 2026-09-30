// story-world-v2/src/streams.js
// 双流渲染（S6）：观棋窗口（动态流 + 各方位置动作 + 当前格局）与 RP 注入（行迹纪要式事实）。
// ★leg25 f（用户拍板「X3 删掉掩码」）：注入侧**不再做可见性过滤**。沿革：K10 掩码真值（观察者=玩家）
//   → leg24 片3 改为事实驱动（m = 情报 × 位置）→ leg25 c 只剩位置 → leg25 f 删掉——
//   因为到后期两个取值（同地 1.0 / 异地 0.5）都过阈值 0.25 ⇒ **掩码恒真、一个事实都没挡住**。
//   现口径：观棋侧与注入侧**都全局可见**（两侧同向，不制造两套真相）。依据见
//   `docs/spec-failure-verdict-and-visibility.md` §3。

/**
 * positionLine(world) → 观棋流里的「📍 各归何处」一行（**按处聚合**，leg25 f）
 * 形态：`📍 各归何处：忘川（27：孟婆·分身、转轮鬼圣…）｜ 东胜沧洲（19：…）｜ 位置未载（390：书里没写，不是"在别处"）`
 * 与面板 `renderSideHtml` 同一口径（两处都按处聚合、都不丢未载那筐）；
 * 组内按名号序（确定性，便于逐字节回归锁）。地点多时只列前 LOC_GROUP_CAP 处，其余折成一句计数。
 */
export const LOC_GROUP_CAP = 12;         // 观测行里最多平铺几处（防超长书把这一行灌爆；超出只给计数）
export function positionLine(world, { cap = LOC_GROUP_CAP } = {}) {
    const ef = world?.meta?.entityFields || {};
    const real = (v) => typeof v === 'string' && v.trim() && v !== '未明';
    const byLoc = new Map();
    const unknown = [];
    for (const e of world?.entities || []) {
        if (!e?.name) continue;
        if (!real(e.location)) { unknown.push(e); continue; }
        if (!byLoc.has(e.location)) byLoc.set(e.location, []);
        byLoc.get(e.location).push(e);
    }
    const groups = [...byLoc.entries()]
        .sort((a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])));
    const shown = groups.slice(0, cap).map(([loc, list]) => {
        const names = list.map((e) => e.name).sort((a, b) => String(a).localeCompare(String(b)));
        const derived = list.every((e) => ef[e.id]?.位置来源 === '结构推导');
        return `${loc}${derived ? '（推）' : ''}（${list.length}：${names.join('、')}）`;
    });
    if (groups.length > cap) {
        const restN = groups.slice(cap).reduce((s, [, l]) => s + l.length, 0);
        shown.push(`另 ${groups.length - cap} 处（${restN} 人）`);
    }
    if (unknown.length) shown.push(`位置未载（${unknown.length}：书里没写，不是"在别处"）`);
    return `📍 各归何处：${shown.join('｜') || '（账上还没有实体）'}`;
}

export function renderStreams(world, stage, moveFact) {
    const observer = [];

    // 动态流：本 tick 的编年条目（可读、带因果）
    for (const c of stage.chronicle) observer.push(`◆ [tick ${c.tick}] ${c.text}`);

    // 各方位置（★leg25 f 重做：由"563 条平铺"改为**按处聚合**）
    //   旧法一行把 563 个实体名与地点顺次铺开，谁也读不出"谁跟谁在一处"——而那是位置唯一能提供的信息。
    //   新法按地点分组（组内按名号序），末尾单列「位置未载」一筐。
    //   ★纪律（用户 2026-09-11 定的交互口径）：**未载 ≠ 在别处**——它只是"书里没写"。
    //   引擎对"两个实体能否相遇"零表态（那是笔的事）；这里只是把账上已有的空间结构摆出来给模型看。
    observer.push(positionLine(world));

    // 当前格局
    const open = (world.agendas || []).filter((a) => !a.closed);
    const pending = (world.events || []).filter((e) => !e.closed);
    const agDesc = open.map((a) => `「${a.goal}」${a.progress}/${a.maxSteps}`).join('、');
    observer.push(`▣ 当前格局：张力 ${world.context.tension} · 未决事件 ${pending.length} · 在飞盘算 ${open.length}${agDesc ? `（${agDesc}）` : ''}`);

    // RP 注入：行迹纪要式事实（预算有限）
    // ★leg25 f（用户拍板「X3 删掉掩码」）：此处原有一道可见性过滤（`isVisible(visibilityMask({sameLocation}))`）。
    //   为什么删：掩码到后期只剩"同地 1.0 / 异地 0.5"两个取值，而阈值 0.25 ⇒ **两者都过闸**，
    //   这道判断**没有任何事实挡得住**（死参数 + 假机制）。现口径 = 玩家看得见全部带因果指针的世界动向，
    //   与观棋侧"全局可见"（ANCHOR §3⑥）**同向**，不制造两套真相。
    //   连带的登记项一并消失：原来"事件位置缺失该按同地/异地/中立取哪一值"那个**未拍板**的问题，
    //   在这里已无对象（不再需要这个概念）。concealed 盘算的编年抑制（K21）不受本改动影响。
    //   口径保留一条：只有带 `eventRef` 的编年行算"世界动向"（那是**因果链上的节点**，有据可查）；
    //   没有 eventRef 的行（规矩行/氛围行）不进注入。
    let injection = null;
    const evLines = stage.chronicle.filter((c) => c.eventRef).map((c) => c.text);
    if (evLines.length) injection = `【世界动向】${evLines.join('；')}`;
    if (moveFact?.verb) {
        const obj = moveFact.object ? `向 ${moveFact.object}` : '';
        const line = `【你的行迹】${moveFact.verb}${obj}——落子已记，兑现待棋局结算（时差 §4.7）`;
        injection = injection ? `${injection}\n${line}` : line;
    }

    return { observer, injection };
}
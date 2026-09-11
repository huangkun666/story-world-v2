// story-world-v2/src/streams.js
// 双流渲染（S6）：观棋窗口（动态流 + 各方位置动作 + 当前格局）与 RP 注入（行迹纪要式事实）。
// ★leg25 f（用户拍板「X3 删掉掩码」）：注入侧**不再做可见性过滤**。沿革：K10 掩码真值（观察者=玩家）
//   → leg24 片3 改为事实驱动（m = 情报 × 位置）→ leg25 c 只剩位置 → leg25 f 删掉——
//   因为到后期两个取值（同地 1.0 / 异地 0.5）都过阈值 0.25 ⇒ **掩码恒真、一个事实都没挡住**。
//   现口径：观棋侧与注入侧**都全局可见**（两侧同向，不制造两套真相）。依据见
//   `docs/spec-failure-verdict-and-visibility.md` §3。

export function renderStreams(world, stage, moveFact) {
    const observer = [];

    // 动态流：本 tick 的编年条目（可读、带因果）
    for (const c of stage.chronicle) observer.push(`◆ [tick ${c.tick}] ${c.text}`);

    // 各方位置与动作（位置来自世界状态，§3.2）
    observer.push(`📍 各方位置：${world.entities.map((e) => `${e.name} @ ${e.location}${world.meta?.entityFields?.[e.id]?.位置来源 === '结构推导' ? '（推）' : ''}`).join('、')}`);

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
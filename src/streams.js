// story-world-v2/src/streams.js
// 双流渲染（S6）：观棋窗口（动态流 + 各方位置动作 + 当前格局）与 RP 注入（行迹纪要式事实）。
// K10 掩码真值（K4 解挂）：注入侧观察者 = 玩家——**leg24 片3 起掩码事实驱动** m = 情报 × 位置，m<0.25 省略；
// 无玩家世界（旁观）注入降级全见（P-E）。观棋侧全局可见不变（用户权利，ANCHOR §3⑥）。
// 片3 删掉的两件事：①比值项（源分量÷观察者分量）②"零分量观察者无所见"短路——那个数用户已定不要了，
// 且新世界开局账面无数，留着短路会让玩家什么都看不见。
import { isVisible, visibilityMask } from './weight.js';

export function renderStreams(world, stage, moveFact) {
    const observer = [];

    // 动态流：本 tick 的编年条目（可读、带因果）
    for (const c of stage.chronicle) observer.push(`◆ [tick ${c.tick}] ${c.text}`);

    // 各方位置与动作（位置来自世界状态，§3.2）
    observer.push(`📍 各方位置：${world.entities.map((e) => `${e.name} @ ${e.location}`).join('、')}`);

    // 当前格局
    const open = (world.agendas || []).filter((a) => !a.closed);
    const pending = (world.events || []).filter((e) => !e.closed);
    const agDesc = open.map((a) => `「${a.goal}」${a.progress}/${a.maxSteps}`).join('、');
    observer.push(`▣ 当前格局：张力 ${world.context.tension} · 未决事件 ${pending.length} · 在飞盘算 ${open.length}${agDesc ? `（${agDesc}）` : ''}`);

    // RP 注入：行迹纪要式事实（预算有限；K10 掩码真值 → 片3 事实驱动）
    let injection = null;
    const playerId = world.context?.playerId;
    const player = playerId ? world.entities.find((e) => e.id === playerId) : null;
    let evLines;
    if (!playerId) {
        evLines = stage.chronicle.filter((c) => c.eventRef).map((c) => c.text);   // P-E：无玩家世界全见
    } else if (player) {
        const intel = player.attrs?.intel ?? 0;
        const had = player.attrs?.intel !== undefined;   // leg24 片2：账面无数 → 按中立情报（0.5）算，不再"无所见"
        evLines = stage.chronicle
            .filter((c) => {
                if (!c.eventRef) return false;
                const ev = world.events.find((e) => e.id === c.eventRef);
                if (!ev) return true;   // 防御：节点不在则不过滤
                // leg25（唯一真源）：掩码一律经 weight.visibilityMask 取——此处原有一份**内联复制**的公式，
                //   与 weight.js 的实现是两份代码，改一处另一处不动的漂移风险不再接受（副本已删）。
                // "账面无 intel" 的口径（按中立 0.5）留在调用方：weight 不知道账本缺键语义。
                // 位置判定：只有在**两侧位置都在账上且相等**时才算"同地"。
                //   事件没给 position 时，旧写法 `ev.position === player.location` 恒假 → 被当成"确实在别处"
                //   （把"不知道"读成了"知道在远处"）。改为显式判真：位置缺失 → 落到 posDiff 一侧，
                //   **与"真的在别处"同值**（口径=不因数据缺失而放宽可见性），行为逐字节不变；
                //   "未知"该按异地/同地/中立另取一值，属**待拍板**，未擅自发明（见交付说明）。
                const sameLocation = ev.position != null && ev.position === player.location;
                return isVisible(visibilityMask({ intel: had ? intel : 0.5, sameLocation }));
            })
            .map((c) => c.text);
    } else {
        evLines = [];   // 观察者在册信息缺失：无所见（防御）
    }
    if (evLines.length) injection = `【世界动向】${evLines.join('；')}`;
    if (moveFact?.verb) {
        const obj = moveFact.object ? `向 ${moveFact.object}` : '';
        const line = `【你的行迹】${moveFact.verb}${obj}——落子已记，兑现待棋局结算（时差 §4.7）`;
        injection = injection ? `${injection}\n${line}` : line;
    }

    return { observer, injection };
}
// story-world-v2/src/streams.js
// 双流渲染（S6）：观棋窗口（动态流 + 各方位置动作 + 当前格局）与 RP 注入（行迹纪要式事实）。
// K10 掩码真值（K4 解挂）：注入侧观察者 = 玩家——m = clamp(事件源分量÷玩家分量 × 情报 × 位置)，m<0.3 省略；
// 无玩家世界（旁观）注入降级全见（P-E）；零分量观察者无所见（K1 语义）。观棋侧全局可见不变（用户权利，ANCHOR §3⑥）。
import { resolveEventSource } from './settle.js';
import { visibilityMask, isVisible } from './weight.js';

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

    // RP 注入：行迹纪要式事实（预算有限；K10 掩码真值）
    let injection = null;
    const playerId = world.context?.playerId;
    const player = playerId ? world.entities.find((e) => e.id === playerId) : null;
    const obsWeight = playerId ? (world.weights?.[playerId] ?? 0) : null;
    let evLines;
    if (!playerId) {
        evLines = stage.chronicle.filter((c) => c.eventRef).map((c) => c.text);   // P-E：无玩家世界全见
    } else if (player && obsWeight > 0) {
        evLines = stage.chronicle
            .filter((c) => {
                if (!c.eventRef) return false;
                const ev = world.events.find((e) => e.id === c.eventRef);
                if (!ev) return true;   // 防御：节点不在则不过滤
                const { weight: srcWeight } = resolveEventSource({ world, ev, weights: world.weights || {} });
                const m = visibilityMask({
                    srcWeight: srcWeight ?? 0,
                    obsWeight,
                    intel: player.attrs?.intel ?? 0,
                    sameLocation: ev.position === player.location,
                });
                return isVisible(m);
            })
            .map((c) => c.text);
    } else {
        evLines = [];   // 零分量观察者：无所见
    }
    if (evLines.length) injection = `【世界动向】${evLines.join('；')}`;
    if (moveFact?.verb) {
        const obj = moveFact.object ? `向 ${moveFact.object}` : '';
        const line = `【你的行迹】${moveFact.verb}${obj}——落子已记，兑现待棋局结算（时差 §4.7）`;
        injection = injection ? `${injection}\n${line}` : line;
    }

    return { observer, injection };
}
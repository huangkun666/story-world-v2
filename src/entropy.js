// story-world-v2/src/entropy.js
// 熵泵（leg26 改定义）：**世界静默时，引擎按点报一次"世界安稳"**——唯一不看模型脸色的节拍器。
//
// ★ 本文件在 leg26 被改写（用户令「熵泵又不用全删，删掉没用的功能不就行了，改个定义就好了」）。
//   删掉的（原来全是编出来的，无任何引擎消费者）：
//     · `ENV_KEYS`/`ENV_DRIFT_STEP`/`SAW`/`BANDS` —— 四个 0~1 环境量的锯齿推演与危险带/回缓带；
//     · **四句写死的事件台词**（「熵泵·民生凋敝：劳役征发四起」等）——引擎替世界宣布事实，违反"引擎不发明事实"。
//   留下的（真机制）：
//     · **每 ENV_TICK 一拍**（不看模型在干嘛）；
//     · **到点出声 / 条件回头收声** 这个循环——它是全引擎**唯一会自己闭环**的事件（其余未决事件
//       要么等源盘算终结、要么等涟漪平息窗；模型提的 `state` 源事件**永不自动闭环**）。
//   改掉的（新定义）：
//     · **触发面**：从"编出来的数越阈" → **账本自己能证明的结构事实**（连续 N 轮没有新事件上桌）；
//     · **收声面**：从"数字回摆" → **世界真动了**（有新事件落账 ⇒ 这条自闭环）。
//   ⇒ 落账的那条事件是**真实发生过的结构变化**（世界静默了 N 轮），不是一句抄来的台词。
//   数字（已报批的 #1-#8 随键表一并作废；新值 `ENTROPY_TICK`/`QUIET_WINDOW` 为提案态，随本棒报批）。
//
// 零创作纪律（不变）：事件只从**账上数得出的事实**落，模型不发明（world-step schema 无熵泵写面）。

import { eventBornTick } from './setting.js';

export const ENTROPY_TICK = 3;      // 提案：每 3 tick 检查一次（沿用旧 ENV_TICK 的节奏，数字待报批）
export const QUIET_WINDOW = 10;     // 提案：连续多少轮没有新事件上桌 ⇒ 报一次「天下安稳」

// 当前未决的熵泵事件（至多一条：同种未决不重复落）
const openPumpEvent = (world) =>
    (world.events || []).find((e) => !e.closed && String(e.id).startsWith('ev_pump_'));

// 最近一条**非熵泵**事件的出生轮（没有 ⇒ -Infinity）。熵泵自己的事件不算"世界动了"，
//   否则它会自己把自己哄睡（出声 → 自己成为最新事件 → 永远不静默）。
export function lastRealEventTick(world) {
    let last = -Infinity;
    for (const e of world.events || []) {
        if (String(e.id).startsWith('ev_pump_')) continue;
        const t = eventBornTick(e.id);
        if (t > last) last = t;
    }
    return last;
}

// 引擎 tick 段（settle 挂接点：closeEvents 之后、chronicleEvents 之前）——操作 structuredClone 后的世界。
export function pulseEntropy(world, tick, chronicle) {
    // 无设定池世界：熵泵不启动（旁观/旧世界零扰动——leg26 保留这条守卫）
    if (!world.context?.setting?.dynamic) return;
    if (tick % ENTROPY_TICK !== 0) return;
    const open = openPumpEvent(world);
    const lastReal = lastRealEventTick(world);

    // 收声（新定义）：世界真的动了（有真实事件落在本熵泵事件之后）⇒ 安稳期结束，自闭环
    if (open) {
        const bornOpen = eventBornTick(open.id);
        if (lastReal > bornOpen) {
            open.closed = true;
            open.closedAt = tick;
            chronicle.push({
                id: `ch_${tick}_pumpC_${open.id}`,
                tick,
                text: '天下已不安静（新的事件上桌，安稳期结束）',
                kind: 'state',
            });
        }
        return;   // 同种未决不再重复落
    }

    // 出声（新定义）：连续 QUIET_WINDOW 轮没有任何真实事件上桌 ⇒ 报一次"世界静下来了"。
    //   ★静默从哪儿算起：没有真实事件的历史（新世界/空前史）从 **t0** 算起——
    //     跟"标题里的轮数"用同一个锚，否则会出现"检查说安静、标题说 Infinity 轮"这种自相矛盾。
    const anchor = Number.isFinite(lastReal) ? lastReal : 0;
    const quiet = tick - anchor >= QUIET_WINDOW;
    if (!quiet) return;
    const ev = {
        id: `ev_pump_${tick}_1`,
        title: `天下安稳：已 ${tick - anchor} 轮无新事上桌`,
        source: { type: 'state' },
        position: world.context.positions[0],   // 处境无特定驻点，落位置集首项（沿用旧口径）
        ripples: [],
        links: { up: [], down: [] },
        closed: false,
    };
    world.events.push(ev);
    chronicle.push({
        id: `ch_${tick}_pump_${ev.id}`,
        tick,
        text: `${ev.title}（世界静默，处境上桌）`,
        kind: 'state',
    });
}

// story-world-v2/web/world-entity-migration.js
// ★★★leg148：**把账上那枚"宏做的你"并回棋子**（存量局那半个修复 · 编排层 · 零 import 的真叶子）。
//
// 【为什么单独成家（这一族为什么值得有自己的文件）】
//   ① 它是**一次性的存量修复**，与"接线"不是一回事——修完（并干净）之后它每次载入都什么都不做；
//   ② `web/index.js` 有 **3100 行硬锁**，而本笔的机制代码加进去就把它顶破了
//      ⇒ 照本仓既有做法：**搬一族出去，不是把锁抬高**（`STATE.md` 里那条"下一笔要往接线层加东西，
//      先把一族搬出去"就是这个意思）；
//   ③ 它是纯函数族（世界由形参递进来、就地读、返回一份新的）⇒ 能在 Node 里直接真跑，判据好写。
//
// 【它治的病】（社区用户报的，2026-09-28；机制与"三道关口为什么都拦不住" ⇒ `src/macros.js` 头注）
//   世界书原文里的 `{{user}}` 被**原样**抽成了一条角色 ⇒ 账上有了"另一个你"。
//   认领棋子那把尺子只比名字相不相等（`namePlayerPiece`：`e.name === nm`）⇒ 「{{user}}」与「怪璃」
//   永远不相等 ⇒ 认领不了 ⇒ 那枚实体留在账上当棋手 ⇒ 世界模型每轮**同时看到两枚棋子**
//   （与用户当年那句「又把主角演了」同一个形状，leg32h 修过一次）。
//
// 【为什么必须搬引用、不能只删】账上**存实体 id 的地方只有三处**（现读全仓核过）：
//   ① `context.playerId`　② `agendas[].owner`（在飞盘算的主人）　③ `relations[].from/.to`（关系两端）。
//   直接删 = 留悬空指针（盘算没有主人、关系指向不存在的人）⇒ 那是比原病更坏的账。
//   ★`events[].ripples` 与编年行里存的是**名字**不是 id ⇒ 并名之后它们**自动就对了**，不必动
//     （这是"只存一处真相"顺手赚到的：id 与名分工清楚，清理就只清理 id 那一半）。
//
// 【纪律】
//   · **不碰名字**：棋子叫什么由 `namePlayerPiece`（按酒馆人设名）一处说了算，本族一个字不掺和。
//   · **不猜**：找不到可靠的"你"（没有 playerId 也没有缺省名那枚棋子）⇒ **什么都不做**，
//     只把"看见了什么"如实报出去。删了会让引用悬空，改名要猜谁是玩家——两件都不许做（红线 2）。
//   · **幂等**：并完就把它下架 ⇒ 第二次跑找不到它 ⇒ 什么都不做（照 `normalizeMilestoneLinks` 先例）。

import { isMacroPlaceholder } from '../src/macros.js';

/**
 * 把账上"名字是纯占位符形状"的实体并回玩家棋子，并把**指向它的引用**一起搬过去。
 *
 * @param {object} world 世界账（**只读**：不就地改，返回的是新世界）
 * @param {{nameLower?:string}} [opts] `nameLower` = 兜底认棋子用的名（人设名；没有 `playerId` 时才用）
 * @returns {{merged:number, names:string[], ssot?:object}}
 *   `merged` = 并掉了几个；`ssot` **只在真变了的时候才有**（调用方按"没变"处理，照零漂移口径）。
 */
export function normalizeMacroEntities(world, { nameLower = '你' } = {}) {
    const entities = Array.isArray(world?.entities) ? world.entities : [];
    const macro = entities.filter((e) => isMacroPlaceholder(e?.name));
    if (!macro.length) return { merged: 0, names: [] };

    const playerId = world?.context?.playerId;
    let piece = playerId ? entities.find((e) => e.id === playerId) : null;
    // ★兜底**只在没有棋子时**才认名：有 playerId 就一律并进它（那才是"你"，与它叫什么无关）。
    //   `nameLower` 只当缺省名「你」那一族旧账的把手（`attachPlayerPiece` 拿不到人设名时建的就是它）。
    if (!piece) {
        const lower = String(nameLower || '').trim().toLowerCase();
        piece = entities.find((e) => String(e?.name || '').trim().toLowerCase() === lower) || null;
    }
    // 棋子本身也是宏名（或压根找不到）⇒ 没有可靠的"你"可并 ⇒ **什么都不做**（见文件头"不猜"）
    if (!piece || isMacroPlaceholder(piece.name)) {
        return { merged: 0, names: macro.map((e) => String(e.name)) };
    }

    const deadIds = new Set(macro.filter((e) => e.id !== piece.id).map((e) => e.id));
    if (!deadIds.size) return { merged: 0, names: [] };

    // ── 并：把宏实体身上**能带走的**带进棋子（位置只填空位；别名/分支/机构按名去重）──
    const mergedPiece = { ...piece };
    for (const e of macro) {
        if (e.id === piece.id) continue;
        if ((!mergedPiece.location || mergedPiece.location === '未明') && e.location && e.location !== '未明') {
            mergedPiece.location = e.location;
        }
        for (const f of ['aliases', 'branches', 'organs']) {
            if (!Array.isArray(e[f]) || !e[f].length) continue;
            const had = Array.isArray(mergedPiece[f]) ? mergedPiece[f] : [];
            const selfName = String(mergedPiece.name || '').trim().toLowerCase();
            const add = e[f].filter((x) => x && !had.includes(x) && String(x).trim().toLowerCase() !== selfName);
            if (add.length) mergedPiece[f] = [...had, ...add];
        }
    }

    const next = {
        ...world,
        entities: entities.filter((e) => !deadIds.has(e.id)).map((e) => (e.id === piece.id ? mergedPiece : e)),
        context: { ...(world.context || {}), playerId: piece.id },
        agendas: (world.agendas || []).map((a) => (deadIds.has(a?.owner) ? { ...a, owner: piece.id } : a)),
    };
    // ── 关系两端：重写之后**两端都成了玩家**的那种自环要丢掉（账上不该有的自指），重复边同批去掉 ──
    if (Array.isArray(world.relations) && world.relations.length) {
        const seen = new Set();
        const out = [];
        for (const r of world.relations) {
            const from = deadIds.has(r?.from) ? piece.id : r?.from;
            const to = deadIds.has(r?.to) ? piece.id : r?.to;
            if (from === to) continue;
            const key = `${from}\u0000${to}\u0000${r?.type}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(from === r?.from && to === r?.to ? r : { ...r, from, to });
        }
        next.relations = out;
    }
    return { merged: deadIds.size, names: macro.map((e) => String(e.name)), ssot: next };
}

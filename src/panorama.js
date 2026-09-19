// story-world-v2/src/panorama.js
// ★★leg94「说书」视图（用户令：「你虽然能看懂整个因果，但是我看不懂，还要你给我讲解」）
//   —— **零 LLM**：把账上现成的字重新编排成人话，一个字都不新编（同 chain.js 的纪律）。
//
// 用户看的是三样东西，没有一样是为"读故事"造的：
//   ① 编年 367 行 = **引擎流水账**（`满步结算：结清（期满收摊，终结产果 §4.4④）`）；
//   ② 事件表 = **数据库**（只有标题+地点+机器号，没有"起因是谁挑的、代价是什么"）；
//   ③ 因果链视图 = **图谱**（`ev_48_2`、谋/纪/源徽章）。⇒ 玩家读到的全是我们的行话。
//
// 本模块的活儿：**把同一件事散在三四处的字，收进一段里**。
//   来路：`event.source.{type,ref}` ＋ `agenda.memory.done / blocked`（逐轮过程话与"代价"就在这里）
//   经过：事件标题（按出生轮序）＋ 编年行 `text`（推进话与闭环话）
//   结果：`closed / closedAt`（老账没这格 → 按里程碑标题兜，如实不猜）
//   ★分工照 chain.js：本模块**自己渲染**（`renderPanoramaHtml`）——因为渲染要 world（位置名/名号/
//     编年原文），而 `render.js` 的页面级函数只收 world 一层，不再多传一份上下文（重复传参 = 两份真相）。
//   ★纪律（判据照咬）：**正文里零引擎词、零机器号**（`盘算/事件/涟漪/结算/入局/编年/里程碑/闭环/满步`
//     与 `ev_* / a_* / e_bk_* / m_* / ch_*` 一律不许出现在可见文本里）；账上原文里的内部词**降级成标点**
//     （去掉那个词、留下它带的句子），**绝不改写事实**。

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
// 出生轮：`ev_<轮>_<序>`；开局种子（`ev_seed_N`）算第 0 轮（同 chain.js 的 `eventBornTick` 口径）
export const bornTick = (id) => {
    const m = /^ev_(\d+)_\d+$/.exec(String(id || ''));
    if (m) return Number(m[1]);
    return /^ev_seed_\d+$/.test(String(id || '')) ? 0 : null;
};
const idCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// ★leg95：「最近几轮算'还在往下长'」——**这个数不许自己另立一个**，它与 `settle.js` 的
//   `CHAIN_SETTLE`（涟漪平息窗，报批 #13 定案 = 5）**必须同值**。
//   ★为什么在这里写成局部常量而不是 import：本模块是**零 import 的真叶子**（仓里有判据锁着这一条，
//     先例 `render-base.js` / `tag-extract.js`）。⇒ 用"**同源断言**"兜住漂移（`test/panorama.test.js`
//     有一条判据把这两个数钉在一起：两边一旦不等，判据当场红）——不许靠注释约定。
const RECENT_GROWTH_WINDOW = 5;

// 账上的内部词 → 降级成标点（去掉词、留下句子；不补写、不解释）
const ENGINE_NOISE = ['满步结算', '结算', '涟漪平息', '涟漪', '闭环', '盘算', '事件', '编年', '里程碑', '入局', '里程碑插行'];
// 号有两种形状（同 render.js 的 `CHRONICLE_BARE_ID`：新账长号 `ev_11_1` / 老账短号 `ev_0`）
const BARE_ID_RE = /\b(?:ev_seed_\d+|ev_\d+(?:_\d+)?)\b/g;
export function stripEngine(text) {
    let t = String(text ?? '');
    for (const w of ENGINE_NOISE) t = t.split(w).join('');
    return t
        .replace(/（源[^）]*）/g, '')          // （源盘算已结算）
        .replace(/（链源已了结）/g, '')
        .replace(/（期满收摊[^）]*）/g, '')   // （期满收摊，终结产果 §4.4④）
        .replace(/【[^】]*】/g, '')
        .replace(/[：:]\s*(?=[。；;]|$)/g, '')
        .replace(/^[：:、，,\s]+|[：:、，,\s]+$/g, '')
        .replace(/[（(]\s*[)）]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
// ★机器号的两道闸（顺序要紧）：**先认名**（查表换成人话），**后清号**（认不出的宁可不说）。
//   为什么不是"一律清"：账上 `因事而生：X 由「ev_2_1」生「Y」` 那类行，号是**有用的来路**——
//   认得出就换成那件事的名字；认不出才退到"清掉号"（宁少一个名，不印一串码）。
export function resolveIds(text, names) {
    const t = String(text ?? '');
    if (!names || !names.size) return t;
    return t.replace(new RegExp(BARE_ID_RE.source, 'gi'), (id) => names.get(id) || id);
}
function scrubIds(text) {
    return String(text ?? '').replace(BARE_ID_RE, '').replace(/[（(]\s*[)）]/g, '').replace(/\s{2,}/g, ' ').trim();
}
// 账上一句话 → 说书里那句话：**认名 → 去行话 → 清残留的号**（顺序固定，三处消费者共用这一份）
const say = (text, names) => scrubIds(stripEngine(resolveIds(text, names)));
// 名号：账上的名字原样用；缺了才退回 id（旧账可能没有这一格）
const nameOf = (world, id) => (world.entities || []).find((e) => e.id === id)?.name || '';

export function buildPanorama(world) {
    const events = world?.events || [];
    const agendas = world?.agendas || [];
    const chronicle = world?.chronicle || [];
    const agOf = new Map(agendas.map((a) => [a.id, a]));
    // 展示用的起名：去掉机器号的引号与"（…）"尾巴：「大虞封锁死煞（第 3 轮）」→ 大虞封锁死煞
    const clean = (s) => String(s ?? '').replace(/^[（(][^）)]*[）)]/, '').replace(/[（(][^）)]*[）)]$/, '').trim();
    // ★★名字查表要**同时吃热事件与归档**（真账实测踩到）：`接着「ev_24_1」往下长`——那个号早已归档，
    //   热表里没有它 ⇒ 原样印出来就是机器号。归档事件的标题在里程碑 `titles` 里（与 `ids` 同位）
    //   ⇒ 照 `render.js` 的 `chronicleEventNames` 同一口径建表（**查不到就不印号**，见 `causeOf`）。
    const nameMap = new Map();
    for (const e of events) if (e?.id && e?.title) nameMap.set(String(e.id), String(e.title));
    for (const ms of (world?.milestones || [])) {
        const mids = Array.isArray(ms.ids) ? ms.ids : [];
        const mt = Array.isArray(ms.titles) ? ms.titles : [];
        mids.forEach((id, i) => { if (!nameMap.has(String(id)) && typeof mt[i] === 'string' && mt[i]) nameMap.set(String(id), mt[i]); });
    }
    const titleOf = (id) => nameMap.get(String(id)) || '';

    // ① 逐事件的"经过话"与"代价话"：编年行按 eventRef 归位（老账无 eventRef → 按文案含标题兜）
    //   ★收进这一段的是**推进话与收束话**：开篇话（`事件「X」——…`）由"来路/标题"那两行负责；
    //   ★★"收场话"要滤掉（第一版没滤，真账上"付出的代价"里冒出「白泽成功救出重伤妖王」——
    //     那是一句**收场**，不是代价，只因为它带"重伤"二字被我的正则捞了进来）。
    //     ⇒ 判据：这句话是不是「那件事收场了」。三种形态（原文/去引号/带前缀）都要吃。
    const isClosureOf = (text, title) => {
        const t = String(text);
        if (!title) return false;
        return t === `「${title}」` || t === title
            || t.endsWith(`「${title}」`) || t.endsWith(title)
            || /^(那件事|此事|这件事)?(收场|了结|平息|闭环)/.test(t);
    };
    const tracesOf = (id) => {
        const ev = events.find((e) => e.id === id);
        const rows = chronicle.filter((c) => c.eventRef === id
            || (!c.eventRef && ev && String(c.text).includes(String(ev.title))));
        const out = [];
        for (const c of rows) {
            if (/^事件「/.test(String(c.text))) continue;   // 事件行（含收场话）不进"经过"——理由见上
            const t = say(c.text, nameMap);
            if (!t || isClosureOf(t, ev?.title)) continue;
            out.push({ tick: c.tick, text: t });
        }
        return out;
    };
    // ② 来路：`source` 三型（书里埋的 / 局势自己拱的 / 某件事带出来的 / 某人谋出来的）
    const causeOf = (ev) => {
        const s = ev.source || {};
        if (s.type === 'seed') return { kind: 'seed', text: `这一条书里早就埋着${ev.seedFrom?.quote ? `：${cut(stripEngine(ev.seedFrom.quote), 40)}` : ''}` };
        if (s.type === 'state') return { kind: 'state', text: '当时的局面自己拱出来的' };
        if (s.type === 'plot') {
            const a = agOf.get(s.ref);
            return { kind: 'plot', text: `由${a?.owner ? `${nameOf(world, a.owner)}的` : ''}打算「${clean(a?.goal) || s.ref}」推出来`, agenda: a || null };
        }
        if (s.type === 'ripple') {
            const up = titleOf(s.ref);
            // ★查不到上游的标题（号在账上认不出）时**不印号**——印"更早的一件事"，宁少一个名、不多一串码
            return { kind: 'ripple', text: up ? `接着「${clean(up)}」往下长` : '接着更早的一件事往下长' };
        }
        return { kind: 'none', text: '来路在账上没记' };
    };

    // ③ 分组：把散账收成"一条线"
    //   边①一件事接着上一件（ripple）；边②同一批人（同一 owner）的几条线并成一条——
    //   真账实测：不并的话 42 条谋划会碎成 40 多条"线"，比编年还难读。
    const ids = events.map((e) => e.id);
    // 下游表：谁的账上有 "links.up 里含我" 或 "source.ref === 我" 的事 ⇒ **有新事从它长出来**。
    //   ★两个来源都要收：契约上 `links.up` 是引擎落账时补的下游指针（旧账可能缺这一格），
    //     而 `ripple` 的 `source.ref` 是**作者自己写的**那句话——两者合起来才是完整的一份"长出表"。
    //   ★它只回答"**长过没有**"这个结构问题；"**还在不在长**"必须再看新事是哪一轮出生的（见 `growing`）。
    const kidsOf = new Map();
    for (const e of events) {
        const ups = [...(Array.isArray(e.links?.up) ? e.links.up : []), e.source?.type === 'ripple' ? e.source.ref : null];
        for (const u of ups) {
            if (!u) continue;
            if (!kidsOf.has(u)) kidsOf.set(u, []);
            kidsOf.get(u).push(e);
        }
    }
    const parent = new Map(ids.map((i) => [i, i]));
    const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };
    const ownerOfPlot = new Map(agendas.map((a) => [a.id, a.owner || '']));
    for (const e of events) {
        if (e.source?.type === 'ripple' && parent.has(e.source.ref)) union(e.id, e.source.ref);
        if (e.source?.type === 'plot') e.__owner = ownerOfPlot.get(e.source.ref) || '';
    }
    // ★★处境根并进它该在的那条线（真账试读后定的第二条边）：`source.type === 'state'` 的事没有谋划，
    //   但它的 `ripples` 常常是**同一个势力**（真账：`死煞之气外泄` 牵动万法阁 ⇒ 它就是万法阁那条线的开头）。
    //   口径写窄：**只在"这件事牵动的名单里恰好只有一方、且这一方在账上只属于一条线"时才并**——
    //   宽一点（牵动里有谁就并给谁）会把不相干的处境硬塞进别人的故事（"天下大乱"那种事牵动一大片）。
    //   ★走的还是**同一份"势力→线"归属**：每个势力可能有好几条线（如万法阁的死煞线与引爆线各一条），
    //     那就**不并**（归属不唯一 ⇒ 宁可不并，也不猜）。
    const ownerThreads = new Map();   // owner（谋划主人的实体号）→ Set(线根)
    const isPlotOwner = new Set();    // 账上"有谋划在身"的那些实体号（判"这件事牵动的是不是谋划的主人"）
    for (const e of events) {
        if (e.source?.type === 'plot') isPlotOwner.add(ownerOfPlot.get(e.source.ref) || '');
    }
    isPlotOwner.delete('');
    for (const e of events) {
        if (!e.__owner) continue;
        if (!ownerThreads.has(e.__owner)) ownerThreads.set(e.__owner, new Set());
        ownerThreads.get(e.__owner).add(find(e.id));
    }
    for (const e of events) {
        if (e.source?.type !== 'state') continue;
        // ★口径坑（判据当场咬出来的两次）：`ripples` 里是**普通实体号**（`e_bk_1`），
        //   而归属键是**谋划主人的实体号**。第一版拿 `ownerOfPlot`（它的键是谋划号）去查 ⇒ 永远查空。
        //   ⇒ 先把牵动名单**过滤成"账上有谋划在身的那几个"**，再取主人集合。
        const roster = [...new Set((e.ripples || []).filter((r) => isPlotOwner.has(r)))];
        if (roster.length !== 1) continue;
        const roots = ownerThreads.get(roster[0]);
        if (roots && roots.size === 1) union(e.id, [...roots][0]);
    }
    const byOwner = new Map();
    for (const e of events) {
        const o = e.__owner;
        if (!o) continue;
        if (!byOwner.has(o)) byOwner.set(o, []);
        byOwner.get(o).push(e.id);
    }
    for (const list of byOwner.values()) for (let i = 1; i < list.length; i += 1) union(list[0], list[i]);
    for (const e of events) delete e.__owner;

    const groups = new Map();
    for (const id of ids) {
        const r = find(id);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r).push(id);
    }

    // ④ 一条线 → 一段人话
    const threads = [];
    for (const [, members] of groups) {
        const evs = members.map((id) => events.find((e) => e.id === id)).filter(Boolean)
            .sort((a, b) => (bornTick(a.id) ?? 0) - (bornTick(b.id) ?? 0) || idCmp(a.id, b.id));
        if (!evs.length) continue;
        const ticks = evs.map((e) => bornTick(e.id) ?? 0);
        const head = evs.find((e) => e.source?.type === 'ripple' || e.source?.type === 'plot') || evs[0];
        const headCause = causeOf(head);
        const kinds = new Set(evs.map((e) => e.source?.type));
        const openEvs = evs.filter((e) => !e.closed);
        // 起意：这条线的"主角"与"他为什么动手"（没有开篇谋划的首领时留空，如实）
        let kicker = null;
        if (headCause.kind === 'plot' && headCause.agenda) {
            const a = headCause.agenda;
            kicker = {
                actor: nameOf(world, a.owner) || '某方',
                goal: clean(a.goal),
                stage: clean(a.stage),
                steps: (a.memory?.done || []).map((x) => ({ tick: Number(String(x).match(/^t(\d+)/)?.[1] ?? NaN), text: cut(say(String(x).replace(/^t\d+[:：]\s*/, ''), nameMap), 70) })),
            };
        }
        // 地点与人物：账上写了的才写
        const places = [...new Set(evs.map((e) => e.position).filter((p) => p && p !== '未明'))];
        const actors = [...new Set(evs.flatMap((e) => (e.ripples || []).map((r) => nameOf(world, r))).filter(Boolean))];
        const costs = [];
        for (const e of evs) {
            for (const t of tracesOf(e.id)) if (/代价|舍弃|重伤|透支|放弃|被迫|覆灭|断腕|断臂|命悬一线|独自|破产|无法|未能|失手/.test(t.text)) costs.push({ tick: t.tick, text: t.text });
            if (e.source?.type === 'plot') {
                const a = agOf.get(e.source.ref);
                // ★"卡住的那一句"取自谋划自己记下的 `blocked` 原话。两种形状都要吃：
                //   `t4: 放弃（…）`（带轮次前缀）与纯句子。★前缀必须**削掉**——第一版只削了 `done` 那一支，
                //   于是真账里印出「第 54 轮 t57: 放弃（幽冥反噬过于猛烈，不得不放弃窃取核心）」
                //   （玩家不该看见 `t57:` 这种行号；当玩家读一遍时当场读到）。
                const raw = String((a?.memory?.blocked || [])[0] || '');
                const mt = /^t(\d+)[:：]\s*/.exec(raw);
                const b = say(raw.replace(/^t\d+[:：]\s*/, ''), nameMap);
                // 轮次：优先用那句自带的（它才是"什么时候卡住的"），没有才退回这件事出生的轮次
                if (b) costs.push({ tick: mt ? Number(mt[1]) : (bornTick(e.id) ?? 0), text: b });
            }
        }
        threads.push({
            id: evs[0].id,
            name: clean(kicker?.goal) || clean(titleOf(head.id)) || '一条没留名的线',
            actor: kicker?.actor || nameOf(world, evs[0].ripples?.[0]) || '',
            from: Math.min(...ticks),
            to: Math.max(...ticks),
            count: evs.length,
            places,
            actors,
            kicker,
            cause: headCause,
            events: evs.map((e) => ({
                id: e.id,
                tick: bornTick(e.id) ?? 0,
                title: e.title,
                why: causeOf(e).text,
                position: e.position && e.position !== '未明' ? e.position : '',
                // ★leg97：**认不出名号的，那一格就什么也不印**——第一版换成空串之后照样 join('、')，
                //   真账上就印出一串空顿号「牵动 、、」（当玩家读一遍时当场读到）。
                //   口径照旧：宁少一个名，不印一串码。
                ripples: (e.ripples || []).map((r) => nameOf(world, r)).filter(Boolean),
                closed: !!e.closed,
                closedAt: e.closedAt ?? null,
                // ★leg95：这两格只喂**悬停**（点层不再印任何状态标——见 threadHtml 那一段的注释）
                closedBy: e.closedBy ?? null,        // 'model' = 模型判"这一段讲完了"
                closedWhy: e.closedWhy ?? null,      // 模型给的那句理由
                traces: tracesOf(e.id),
            })),
            // 去重后的代价/转折（同一句只留一次）
            costs: costs.filter((c, i) => costs.findIndex((x) => x.text === c.text) === i).slice(0, 6),
            // ★★★leg95 第二刀（用户令「开没开着不应该挂在事件上」）：**"开没开着"只在线头说一次**，分两态：
            //   · `growing`＝最近 `CHAIN_SETTLE`(5) 轮里还有新事从这条线长出来 ⇒ **还在往下长**（火烧眉毛的那批）
            //   · `live` 但 `!growing` ⇒ **挂着没了结**（没人接着写了，账上还没放下来）
            //   ★信号用的是引擎早就在用的那个（"最近几轮会长东西吗"），不是新发明的判据。
            // ★★★接手棒（leg96）修：**原来这一格量错了东西**——写的是 `最晚一件事的轮次 > tick − 窗口`，
            //   那量的是「**最近有没有事落在这条线上**」，不是「**还有没有新事从它长出来**」。
            //   真账当场证死（装置 `F:/deepseek/tmp/leg96-badge-verify.mjs` 旧法 vs `-after.mjs` 用真模块复验）：
            //     还没收场的线里 **8 条被判反**（A 局 3 · B 局 5）——它们**一个下游都没有**
            //     （`血屠魔君现身南疆掀起杀戮`/`菩提禅院钟声震荡大荒`/`鹤空降长城`…），
            //     只因为"刚落账一件事"就被印成**还在往下长**（事实上它一个岔都没长出来）。
            //   ⇒ 定稿判据＝**结构口径**（与引擎 `settle.js` 的 `hasPendingDownstream` 同一个问法：
            //     "还有没有下游"，只是把"任何时候有过"收窄成"**最近几轮里长出来的**"）：
            //     **这条线上有没有哪件事，在最近 `RECENT_GROWTH_WINDOW` 轮里有新事从它长出来。**
            //   ★为什么**不**退回"这条线有没有长过下游"：那样"30 轮前长过一次、此后一直搁着"的线会
            //     永远印成"还在往下长"——那是把"长过"当成"还在长"（同一个坑的另一半）。
            //   ★只有"最近刚落账、还没到下一轮"的新线才可能两法分歧（它确实还没长出岔）——
            //     那时印"挂着没了结"是**如实**的：账上确实还没放下来，也确实还没有下文。
            growing: evs.some((x) => (kidsOf.get(x.id) || []).some((k) => (bornTick(k.id) ?? 0) > (world.meta?.tick ?? 0) - RECENT_GROWTH_WINDOW)),
            // ★★★leg95d（用户第四次指认：「**没讲完的事又是啥，这也不对吧**」）：**这一格整块拿掉。**
            //   病（两条，都是本棒的老病）：
            //     ① **"没讲完的事"本身就是一句引擎行话**——它说的是"账上还没标了结"，而用户看到的那几件
            //        （第 1 轮、第 9 轮…）**全都发生过了**。★与 §0 那条总纲同源：**账目状态不是事实**。
            //     ② **同一批标题在一条线里印第二遍**——它们本来就都在上面那条时间线里（`t.events`）。
            //   为什么删了不丢信息：线头那行已经写着 `第 A–B 轮 · N 件事`（计数），
            //     时间线写着每一件事的**经过**（过程）——这一格既不是计数也不是过程，它是**把账目状态
            //     换个说法再列一遍**。真要查一手账目，去「史卷」（编年）那儿有全部行。
            //   ★判据⑩把"它不得回潮"钉死（含旧措辞与旧形状）。
            //   ⚠编号：leg96 那一棒已经用了判据⑨（它治的是徽上"还在往下长"的**信号用错**）⇒ 本笔是⑩。
            live: openEvs.length > 0,
            kindMix: [...kinds].filter(Boolean).join('/'),
        });
    }
    threads.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || b.to - a.to || a.from - b.from || idCmp(a.id, b.id));
    return {
        threads,
        stats: {
            events: events.length,
            threads: threads.length,
            liveThreads: threads.filter((t) => t.live).length,
            // ★leg97：三态的口径**只在这里算一次**（统计行、面头、自证闸都从这两个数来——
            //   一处口径，免得又出现"同一页两种说法"那种老病）
            growingThreads: threads.filter((t) => t.growing).length,
            openEvents: events.filter((e) => !e.closed).length,
            closedEvents: events.filter((e) => e.closed).length,
            unexplained: events.filter((e) => !e.source || !['seed', 'state', 'plot', 'ripple'].includes(e.source.type)).length,
        },
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ★★★leg97：「面」——**一个地方**（用户令「**以人物为切口感觉就不像面了**」⇒ 面是空间，不是人）
//
// 四层（设计交接 `docs/session-handoff-2026-09-21-leg96e-design.md` §1，用户已看过演示并说「不错」）：
//
//   大势   ── 书里写定的局面（一句，原文措辞；引擎只读）      ← `context.setting.frozen.canon.situation`
//     └ 此刻：N 处有事发生 · 全书 M 条线（三态）              ← 活数，机械算的
//   面     ── 一个地方（事的 position）
//     └ 面头：几条线在这里交会 · 几件事发生在此 · 与别处相连：某某 → 哪几处
//   线     ── 一条故事（事件的连通分量）
//     └ 线头：名字 · 第 A–B 轮 · N 件事 · **那枚徽（三态，一个数都不带）**
//   点     ── 一件事（时点）：第 N 轮 · 事名 · 来路 · 地点 · 牵动的人（**一个字都不说状态**）
//
// **每一层从哪来（不许新造数据）**：大势＝书的设定层（前提）；面＝事件的 `position`（自由文本，
//   **不建地名册、不做字面合并**——用户已裁「地点很难写全」）；线＝事件的连通分量（`buildPanorama` 已算）；
//   点＝事件自己的格子；**桥**（原设计里的"块"）＝同一个实体出现在 ≥2 个面（`ripples` 是实体号，牢）。
//
// ★★三条口径（都是用户这一棒定的，别再问）：
//   ① **面 ＝ 空间上的一个地方**，人只在线里当"主使 / 牵动的人"；
//   ② **"块"不是层，是面与面之间的关系**（印在面头上：`与别处相连：某某 → 哪几处`）；
//   ③ ★**大势统领不了面**（它是一句话，句子收不了条目；且"书的原始设定"是**前提**，账上算出的是**事实**
//      ⇒ 前提不能收纳事实）。**大势与面的真关系 ＝ 对读**：大势给"何故"，面给"何处"。
//
// ★★★三条纪律（本棒的判据与 README 都钉着）：
//   1. **一条线只有一个落脚处** ⇒ 核算才平。按"地点"推会把同一条线推两遍
//      （设计交接 §1.1 第 4 条：leg96 当场踩到 `大虞龙气外泄` 重复）。这里的落脚处 =
//      `面（它到达的、事最多的那个面）＞ 它自己的主要地点 ＞ 无 ⇒ 各处散落`，**互斥且穷尽**。
//   2. **呈现层加一层组织，就要配一条"总数对得上"的闸**（设计交接 §3.1）：`census` 那三个数
//      加起来**必须等于总条数**，`dropped` 必须为空 —— 它当场咬出过两个真错。
//   3. **归属按线算一次**；单线地点与"这条线也伸到了"**都不算第二次落脚**（它们只是交叉引用）。
const PLACE_UNKNOWN = '未明';   // 账上"地点那格没写"的哨兵值（照全仓同一口径）
// 一件事的地点：账上写了的才算（`未明` 与空白一律当"没写"）
const placeOf = (e) => {
    const p = e?.position;
    const s = (p == null ? '' : String(p)).trim();
    return s && s !== PLACE_UNKNOWN ? s : '';
};

/**
 * ★★"账上这一格**像不像一个地名**"——**只有这一份实现**（建面时剔人、印面头时判自指，两处共用）。
 * 真账实测（A/B 两局的实体表）：
 *   · `大虞`（王朝）与 `战皇殿`/`万法阁`/`天庭` 都是 `kind:'faction'`，驻地 `未明` 或别的城市
 *     ⇒ **它们是"手"**（势力确实在做事、确实横跨几个面），**必须留着**；
 *   · `界渊长城` 也是 `kind:'faction'`，但**驻地逐字等于它自己的名字**（`location === name`）
 *     ⇒ 它是个**地方**。
 * ★已知杂质（**留给"名字撞车"那个案子**，设计交接 §6.3）：B 局里 `界渊长城` 的驻地写的是短名 `长城`
 *   （不逐字等于自己），所以它还是会漏进桥的名单——判据不许用"子串包含"去猜
 *   （`大荒` ⊂ `大荒皇朝`、`京城` ⊂ `大虞京城` 会误伤一片），宁可如实留着这一个。
 * ★第一版的两条错法都在这里留档（**过严与过宽各栽一次**）：写成"只认 kind==='character'"
 *   ⇒ A 局那 6 个桥**全部消失**；写成"名字在位置表里就当地名"⇒ `大虞/万法阁/战皇殿` 一起被吃掉
 *   （**把势力当成了地方**，"收紧过头会自伤"的同族）。
 */
function looksLikePlaceOf(entByName, name) {
    const e = entByName.get(name);
    if (!e) return false;
    if (e.kind === 'character') return false;
    if (['place', 'location', 'region', 'site'].includes(e.kind)) return true;
    return !!e.location && e.location !== PLACE_UNKNOWN && e.location === e.name;
}

/**
 * ★★★「面」：把一条条线组织成"一个地方一段"。
 * ★为什么留在这个模块（不进新文件）：`panorama.js` 是**零 import 的真叶子**，
 *   而 `test/module-layout.test.js` 锁着"模块数 = 46"与"它不 import 任何东西"。
 *   面这一层用的全是**已经算出来的东西**（线的连通分量、事件的 position、ripples），
 *   所以它是本模块的**下一段**，不是新模块——模块图一个字符都不用动。
 * ★它**不改世界**（只在自己的局部表里加字段）；返回结构里没有一丝引擎术语。
 */
export function buildFaces(world, threads) {
    const list = Array.isArray(threads) ? threads : buildPanorama(world).threads;
    // ★不管谁传进来的线，`places` 一律**重算成数组**（`buildPanorama` 里那一格是"事发地名清单"，
    //   而面这一层要的是"去重后的地点集"——两处形状不同，就地归一，免得下游踩到 Set/Array 两种形状）
    const ents = world?.entities || [];
    const entById = new Map(ents.map((e) => [e.id, e]));
    // ★★**按名字查**：`t.events[].ripples` 里装的是**名号**（`panorama.js` 在 `buildPanorama` 那段
    //   就用 `nameOf` 把号换成了名）——按 id 查表永远查空（本棒第一版就是这么栽的：
    //   `cast` 全空 ⇒ 桥一个都不剩。**动手前先把那一格的形状看清楚**，比猜快得多）。
    const entByName = new Map(ents.filter((e) => e?.name).map((e) => [e.name, e]));
    const nameOf = (id) => entById.get(id)?.name || String(id);
    // ★★"只留角色/势力，别把地名当人"（设计交接 §1.2 末条）：`ripples` 里**混着地名当人名**。
    //   真账实测（A/B 两局的实体表）：
    //     · `大虞`（王朝）与 `战皇殿`/`万法阁`/`天庭` 都是 `kind:'faction'`，驻地 `未明` 或别的城市
    //       ⇒ **它们是"手"**（势力确实在做事、确实横跨几个面），**必须留着**；
    //     · `界渊长城` 也是 `kind:'faction'`，但**驻地逐字等于它自己的名字**（`location === name`）
    //       ⇒ 它是个**地方**（真账里它还被印成 `界渊长城 → 界渊长城` 那种自指桥，见设计交接 §3.2 第 2 条）。
    //   ★已知杂质（**留给"名字撞车"那个案子**，设计交接 §6.3）：B 局里 `界渊长城` 的驻地写的是短名
    //     `长城`（不逐字等于自己），所以它还是会漏进桥的名单——判据不许用"子串包含"去猜
    //     （`大荒` ⊂ `大荒皇朝`、`京城` ⊂ `大虞京城` 会误伤一片），宁可如实留着这一个。
    //   ★第一版的两条错法都在这里留档（**过严与过宽各栽一次**）：写成"只认 kind==='character'"
    //     ⇒ A 局那 6 个桥**全部消失**；写成"名字在位置表里就当地名"⇒ `大虞/万法阁/战皇殿`
    //     一起被吃掉（**把势力当成了地方**，"收紧过头会自伤"的同族）。
    //   ★两条"别误伤"的口径（**都是真账当场咬出来的**）：
    //     ① **位置表那一半必须按 kind 收口**：`posSet.has(name)` 只能判"**它自己就是一个地名**"，
    //        所以只对 `place`/`location` 那类推定 kind 生效——`万法阁` 的驻地就在 `东海浮空岛`
    //         （位置表里有它），但"驻地在一个地方"**不等于**"它是个地方"；
    //     ② **驻地等于自己名字**那一半不设限：`界渊长城` 的驻地就叫"长城"（那是地名），
    //        而 `万法阁` 的驻地不叫"万法阁" ⇒ 两条互不干扰。
    const looksLikePlace = (name) => looksLikePlaceOf(entByName, name);

    // ① 每条线：它到过哪些地方（去重）· 牵动的人（剔掉地名型与**账上查不到的名**）· 每个地方各几件事
    for (const t of list) {
        t.places = [...new Set(t.events.map(placeOf).filter(Boolean))];
        // ★`cast` 一律**剔掉账上查不到的名**（真账实测：`ripples` 里有查不到的 ⇒ 印出来就是一串空顿号
        //   「、、、、」——第一版当玩家读时当场读到；这是"宁少一个名、不印一串码"的老口径）
        t.cast = [...new Set(t.events.flatMap((e) => e.ripples || []))]
            .filter((n) => !looksLikePlace(n) && entByName.has(n));
        t.placeCount = new Map();
        for (const e of t.events) {
            const p = placeOf(e);
            if (p) t.placeCount.set(p, (t.placeCount.get(p) || 0) + 1);
        }
    }
    // ② 每个地方有哪些线到达 ⇒ **到达线 ≥2 才立起来当一个面**（用户口径①；真账：A 局 3 面 · B 局 11 面）
    const arrive = new Map();
    for (const t of list) for (const p of t.places) {
        if (!arrive.has(p)) arrive.set(p, new Map());
        arrive.get(p).set(t.id, t);
    }
    const faceSet = new Set([...arrive.entries()].filter(([, m]) => m.size >= 2).map(([p]) => p));
    // ③ ★落脚处：**每条线恰好一处**（面 ＞ 它自己的主要地点 ＞ 无）——核算平的根据
    //   ★两个表**一律用线 id 当键**（值才是地方名）：第一版把"线对象"当键、`homeLone.entries()`
    //     又按 `[地方, 线]` 解构 ⇒ 键值放反，取到的 `t` 是个字符串（真账当场炸）。口径统一成 id。
    const homeFace = new Map();     // 线 id → 面名
    const homeLone = new Map();     // 线 id → 单线地点名（从不经过任何面的线）
    const scattered = [];           // 一个地方都没记的线
    for (const t of list) {
        const fs = t.places.filter((p) => faceSet.has(p))
            .sort((a, b) => (t.placeCount.get(b) - t.placeCount.get(a)) || (arrive.get(b).size - arrive.get(a).size));
        if (fs.length) { homeFace.set(t.id, fs[0]); continue; }
        const pls = [...t.placeCount.entries()].sort((a, b) => b[1] - a[1]);
        if (pls.length) homeLone.set(t.id, pls[0][0]); else scattered.push(t);
    }
    // ④ 面：到达线 ≥2 的地方各一张卡
    //   ★`f.cast` 存成**数组**（第一版存了 Set ⇒ `f.cast.map/includes` 当场炸：本仓"形状不一致"的老病）。
    const faces = [...faceSet].map((place) => {
        const lines = [...arrive.get(place).values()];
        const cast = new Set();
        for (const t of lines) for (const c of t.cast) cast.add(c);
        return { place, lines, cast: [...cast], lone: [], routes: 0, passes: 0, events: 0 };
    }).sort((a, b) => b.lines.length - a.lines.length || String(a.place).localeCompare(String(b.place), 'zh'));
    const faceOf = new Map(faces.map((f) => [f.place, f]));
    for (const f of faces) {
        // ★"几件事发生在此" = **真的发生在这个地方的**那些事（按 placeOf 数）——
        //   第一版写成"落脚线在此的事之和"，那量的是别的东西（本仓 §0 那条纪律：
        //   **一格填对了，还要问"喂给它的那个数，量的是不是这件事"**）。
        f.events = list.reduce((n, t) => n + t.events.filter((e) => placeOf(e) === f.place).length, 0);
        for (const t of f.lines) {
            t.here = t.events.filter((e) => placeOf(e) === f.place).length;
            t.elsewhere = t.places.filter((p) => p !== f.place);
            // ★桥那一行去掉"这条线自己的主使"（他本来就在卡上，再列一遍就是重复——设计交接 §3.2 第 1 条）
            const others = new Set(f.lines.filter((o) => o !== t).flatMap((o) => o.cast));
            t.shares = t.cast.filter((c) => c !== t.actor && others.has(c));
            if (homeFace.get(t.id) === f.place) f.routes += 1; else f.passes += 1;
        }
    }
    // ⑤ 单线地点：**只被一条线到达**的地方（`arrive.size === 1`）——那条线有个落脚面时，
    //    这个地点作为**「这一处另有 N 件单独发生的事」**列在它落脚的那个面里（**地名照印**）。
    //    ★它**不是第二次落脚**：线的落脚处只有 §③ 算的那一处，这条只是交叉引用 ⇒ 核算照旧平。
    //    （线自己没有落脚面时，那个地点就是它的落脚处，走 §⑥ 的「各处散落」，不在这里重复报。）
    for (const t of list) {
        if (!homeFace.has(t.id)) continue;
        const f = faceOf.get(homeFace.get(t.id));
        for (const p of t.places) {
            if (faceSet.has(p) || (arrive.get(p)?.size ?? 0) !== 1) continue;
            f.lone.push({ place: p, line: t, tick: t.to, count: t.placeCount.get(p) });
        }
    }
    for (const f of faces) f.lone.sort((a, b) => String(a.place).localeCompare(String(b.place), 'zh'));
    // ⑥ 「各处散落」：从不经过任何面的线（它们各自只在一处发生，跟别的事没连成一场）。
    //    ★与设计交接 §1.1 第 3 条同一件事；定稿名字用用户裁的那个「各处散落」
    //      （不是「其他」——设计交接 §0 第 ② 条：那批线**有地点**，只是"一个地方只有一条线路过"）。
    const others = [
        ...[...homeLone.entries()].map(([id, place]) => {
            const t = list.find((x) => x.id === id);
            return { place, line: t, tick: t.to, count: t.placeCount.get(place) || 0 };
        }),
        ...scattered.map((t) => ({ place: '', line: t, tick: t.to, count: t.events.length })),
    ].sort((a, b) => b.count - a.count || String(a.place).localeCompare(String(b.place), 'zh'));
    // ⑦ 桥（原设计里的"块"）：同一个**角色**出现在 ≥2 个面
    const entFaces = new Map();
    for (const f of faces) for (const c of f.cast) {
        if (!entFaces.has(c)) entFaces.set(c, new Set());
        entFaces.get(c).add(f.place);
    }
    const bridges = [...entFaces.entries()].filter(([, s]) => s.size >= 2)
        .map(([id, s]) => ({ id, name: nameOf(id), places: [...s], n: s.size }))
        .sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name), 'zh'));
    for (const f of faces) f.shared = bridges.filter((b) => b.places.includes(f.place));
    // ⑧ ★★★自证闸：**四个数必须对得上**（设计交接 §3.1 那条纪律）
    //    "线 N 条 = 面内 ＋ 单线地点 ＋ 散落 · 掉出页面 0"
    //    ★口径：三个分类是**互斥且穷尽**的（按 §③ 的落脚处算），所以它是一条真闸——
    //      少一条线（漏排）或多一条线（重复排）都当场咬得住。
    const census = { total: list.length, routed: homeFace.size, lone: homeLone.size, scattered: scattered.length };
    census.sum = census.routed + census.lone + census.scattered;
    const dropped = list.filter((t) => !homeFace.has(t.id) && !homeLone.has(t.id) && !scattered.includes(t));
    // ★★落脚表**当事实交出去**（线 id → 地方名）：三个分类各有归属，谁落在哪儿一目了然。
    //   为什么要交出去（本棒踩到的一次）：判据想核"只数落脚线的话会数出几件"时，
    //   **在测试里照着规则重写一遍**就是立了第二把尺子（第一版重写的排法跟产品差一条 ⇒ 当场红）。
    //   ⇒ 归属这种"算出来的事实"只许有一处实现，判据直接读它。
    const homeOf = new Map();
    for (const t of list) {
        if (homeFace.has(t.id)) homeOf.set(t.id, homeFace.get(t.id));
        else if (homeLone.has(t.id)) homeOf.set(t.id, homeLone.get(t.id));
        else homeOf.set(t.id, '');
    }
    return { faces, bridges, others, census, dropped, homeOf, sit: String(world?.context?.setting?.frozen?.canon?.situation || '') };
}

// 线头那枚徽的三态（**只许说状态，一个数都不带**）——一处定义，统计行与徽共用同一套词
const badgeOf = (t) => (t.live ? (t.growing ? ['live', '还在往下长'] : ['stale', '挂着没了结']) : ['done', '已收场']);
// 一条线的"轮次跨度"（只有一轮时不印"第 7–7 轮"——照仓里"不印负数轮/第 0–0 条"同一条口径）
const spanOf = (from, to) => (from === to ? `第 ${from} 轮` : `第 ${from}–${to} 轮`);

// 一件件事（点层）：轮次 · 事名 · 来路 · 地点 · 牵动的人 —— ★**一个字都不说状态**
//   `onlyPlace` 给了就只印发生在那里的（面里那一栏）；点层重排的是账上原有的字，没有一句是新写的。
function pointRows(t, onlyPlace) {
    const evs = onlyPlace ? t.events.filter((e) => e.position === onlyPlace) : t.events;
    return evs.map((e) => {
        const bits = [`<span class="sw2-pan-t">第 ${e.tick} 轮</span>`, `<b>${esc(e.title)}</b>`];
        if (onlyPlace && e.position) bits.push(`<span class="sw2-pan-at">${esc(e.position)}</span>`);
        if (e.why) bits.push(`<span class="sw2-pan-why">${esc(e.why)}</span>`);
        if (e.ripples.length) bits.push(`<span class="sw2-pan-who">牵动 ${esc(e.ripples.join('、'))}</span>`);
        const evTitle = e.closed
            ? ` title="${esc(e.closedBy === 'model' ? `这一段已收场${e.closedAt != null ? `（第 ${e.closedAt} 轮）` : ''}${e.closedWhy ? `：${e.closedWhy}` : ''}` : `已了结${e.closedAt != null ? `（第 ${e.closedAt} 轮）` : ''}`)}"`
            : '';
        return `<li${evTitle}>${bits.join(' ')}</li>`;
    }).join('');
}

// 一段人话（一条线）——**面里的一段**
//   ★leg94 版式三条（真账试读后定的，都为"别让一句话说两遍"）：
//     ① **轮次只有一轮时不印"第 7–7 轮"**；
//     ② **起头那句话与线名一样时不再重复**（单件事的线：标题 = 起头 = 那件事，印三遍是噪音）；
//     ③ 单件事的线**不摆"一条线怎么走的"**（它把那件事又印一遍）——只有"起因 + 结果"两行。
//   ★leg97：第三个入参换成"面"（`f.place`）——点层只印**发生在这个面上的**那些事；
//     线自己的轮次跨度仍然照全条线印（"这条线伸得多远"本身就是信息）。
function lineHtml(t, f, world) {
    const span = spanOf(t.from, t.to);
    const here = f ? t.events.filter((e) => e.position === f.place) : t.events;
    const elsewhere = f ? t.elsewhere : [];
    const steps = t.kicker?.steps?.length
        ? `<div class="sw2-pan-sub">他一步步是怎么做的</div><ul class="sw2-pan-steps">${t.kicker.steps.map((s) => `<li>${Number.isFinite(s.tick) ? `<span class="sw2-pan-t">第 ${s.tick} 轮</span> ` : ''}${esc(s.text)}</li>`).join('')}</ul>`
        : '';
    const costs = t.costs.length
        ? `<div class="sw2-pan-sub">付出的代价 / 卡住的地方</div><ul class="sw2-pan-costs">${t.costs.map((c) => `<li><span class="sw2-pan-t">第 ${c.tick} 轮</span> ${esc(c.text)}</li>`).join('')}</ul>`
        : '';
    // ★leg95d：`open`（"没讲完的事"那一块）**整块删除**——见 `buildPanorama` 里那一段的注释。
    const sub = t.actor ? `主使：${esc(t.actor)}` : '';
    // 线头那句过场话：与线名不同才印（否则就是同一句话第二次）· 单件事的线不重复它自己的标题
    const head = t.events[0];
    const kick = (t.count === 1 || t.name === head.title)
        ? ''
        : `起头：${esc(head.title)}${head.why ? `　<span class="sw2-pan-why">${esc(head.why)}</span>` : ''}`;
    const [cls, label] = badgeOf(t);
    return `<details class="sw2-pan-thread${t.live ? ' live' : ''}"${t.live && t.count > 2 ? ' open' : ''}>`
        + `<summary><span class="sw2-pan-dot${t.live ? ' live' : ''}"></span>`
        + `<span class="sw2-pan-name">${esc(t.name)}</span>`
        + `<span class="sw2-pan-span">${span} · ${t.count} 件事${here.length && here.length !== t.count ? `（在此 ${here.length} 件）` : ''}</span>`
        // ★★★leg95c（用户第三次指认：「**这个 7 还是事件的数量啊**」）：那枚徽**只许说状态，一个数都不带**。
        //   病：第一版写的是 `还在往下长 · ${t.openEvents.length} 件没了结` ⇒ 把**事件计数**又缝回了
        //   一枚"说线的状态"的徽里——而**同一行左边已经印着「第 0–12 轮 · 8 件事」**（数还说重了）。
        //   ★这条是本仓第三次栽在同一个坑上，故把纪律写死在这里：
        //     **"说状态的地方只说状态，说数量的地方只说数量"**——两者都不许越界到对方那一格去。
        + `<span class="sw2-pan-badge ${cls}">${label}</span>`
        + `</summary>`
        + `<div class="sw2-pan-body">`
        + (sub || kick ? `<div class="sw2-pan-rule">${sub}${sub && kick ? '<br>' : ''}${kick}</div>` : '')
        // ★leg97：线伸到哪儿去了（面与面之间的**对读**：这一条在别处还有事）
        + (elsewhere.length ? `<div class="sw2-pan-else">这条线也伸到了：${esc(elsewhere.join('、'))}</div>` : '')
        // ★设计交接 §3.2 第 1 条：桥那一行**去掉这条线自己的主使**（他本来就在卡上，再列一遍就是重复）；
        //   名单太长就收口（真账上有一条共享了 7 个人 ⇒ 一行铺满反而读不出重点）
        + (t.shares.length ? `<div class="sw2-pan-share">与这一处别的线共享：${t.shares.slice(0, 4).map((c) => `<b>${esc(c)}</b>`).join('、')}${t.shares.length > 4 ? ` 等 ${t.shares.length} 人` : ''}</div>` : '')
        + steps
        + (t.count > 1 ? `<div class="sw2-pan-sub">一条线怎么走的</div><ul class="sw2-pan-events">${pointRows(t, f ? f.place : null)}</ul>` : '')
        + costs
        + `<div class="sw2-pan-foot">这一段是把账上的字重新排的：来路取事与谋划的指针，过程取逐轮记下的原话，<b>没有一句是新写的</b>。要看一手账目，去「史卷」。</div>`
        + `</div></details>`;
}

// 面头上的"与别处相连"：**桥**（同一个角色/势力出现在 ≥2 个面）——这就是"面之间能相互组织"的答案
//   ★桥那一行**不许自指**（设计交接 §3.2 第 2 条：真账里曾印出 `界渊长城 → 界渊长城`）。
//   ★★但"剔掉本面"不能只做**逐字相等**（本棒当玩家读真账时读到的就是这么漏过去的）：
//     真账里那个面的名字是 `长城`、而那条桥的名字是 `界渊长城`（**名字撞车**，设计交接 §6.3 那件事），
//     逐字比不相等 ⇒ 印出来就是 `界渊长城 → 界渊长城`，读到的人一头雾水。
//   ⇒ 定稿：**它自己像地名、而且名字与这个面互为子串**时也算自指
//     （`界渊长城` ⊃ `长城`）。★只对**像地名的那种**放宽——人/势力那一路仍走逐字相等
//     （否则 `大荒` 会把 `大荒皇朝` 那种真桥误伤掉）。
function bridgesHtml(f, entByName) {
    // ★自指的形状（前两条真账里出现过、第三条是"名字撞车"的同一族，逐条对着真账标定）：
    //   ① **逐字相等**：`长城 → 长城`；
    //   ② ★**一个"名字里含着自己驻地"的事物**（`界渊长城`，驻地 `长城`）**跨到了驻地同名的那一面**
    //      ⇒ 印出来就是 `界渊长城 → 界渊长城`（设计交接 §3.2 第 2 条点名的那一行）。
    //      判据取**方向性**的：驻地得像地名、且**名字里含着驻地**（`界渊长城` 含 `长城`）——
    //      反过来（名字是驻地的前缀）不成立，那样 `万法阁`（驻地 `大荒`）会被误当成地名。
    //   ③ **它自己就是那个地名**（名字在位置表里 / 名字等于自己的驻地）⇒ 逐字那条已经兜住了。
    //   ★★两版错法都留档（**过宽和过严都是错**）：
    //     · 只按逐字相等 ⇒ 真账上那行 `界渊长城 → 界渊长城` 照样印出来（本棒当玩家读时读到）；
    //     · 把"驻地等于本面"单独当一条 ⇒ `凤鸣天阙`（驻地 `未明`）与 `天庭` 也被剔了，
    //       那两行**整条消失**——而它们正是"面与面相互组织"的证据。
    const locationLike = (e) => !!e && !!e.location && e.location !== PLACE_UNKNOWN
        && (looksLikePlaceOf(entByName, e.location) || e.location !== e.name);
    const selfRef = (name) => {
        if (name === f.place) return true;
        const e = entByName.get(name);
        if (!e) return false;
        // 名字里含着自己那个"像地名"的驻地 ⇒ 它其实是那个地方的一个说法，不是"别处"
        if (locationLike(e) && String(name).includes(String(e.location))) return true;
        return looksLikePlaceOf(entByName, name)
            && (String(name).includes(String(f.place)) || String(f.place).includes(String(name)));
    };
    //   ★★**同一个词指两样东西**那一族（`大虞` 既是王朝名、又被写成地名）：
    //     桥自己的名字与该处名字**逐字相同**且账上真有这么一个实体 ⇒ `大虞 → 大虞` 不印
    //     （读者只会当成排字错）。判据收在最窄：**两边都得是账上认得出的名字**才算。
    //   ★★六版错法全部留档（**过宽和过严都是错**，这是全仓改得最多的一处）：
    //     · 只按逐字相等 ⇒ 真账上 `界渊长城 → 界渊长城` 与 `大虞 → 大虞` 照样印出来；
    //     · 把"驻地等于本面"单独当一条 ⇒ `凤鸣天阙`（驻地 `未明`）与 `天庭` 也被剔了、那两行整条消失；
    //     · 只按"像不像地名"收口 ⇒ `界渊长城`（驻地 `长城`，名字里含驻地）漏过去；
    //     · 放宽到"名字含驻地 ⇒ 一律自指" ⇒ `万法阁`（驻地 `大荒`）那种正常桥有被误伤的风险；
    //     ★· **只咬"两边逐字相同"**（leg97 那四版共同的窄处）⇒ 真机当场漏出两行（leg98 用户指认）：
    //        `大虞 → 大虞皇陵`（印在 `大虞` 自己那张卡上）与 `界渊长城 → 长城`（印在 `界渊长城` 自己那张卡上）
    //        ——**名字逐字不相同**，所以旧判据一条都咬不住；
    //     ★· 反过来"桥名出现在 `places` 里就整条不印"⇒ 会把 `渡虚帝 → 界海·鬼门关` 那种
    //        **既到本面、又到别处**的真桥整条吃掉（它在 `长城` 那张卡上是有用的一行）。
    //   ⇒ 定稿分两处判（**判"谁"和判"去哪儿"是两件事**）：
    //     ① **去处**：`selfRef(去处)` ＋ "去处就是桥自己的名字且账上真有这个实体"（原有四版）；
    //     ② **桥自己**：`b.name === f.place` ⇒ **整行不印**（leg98 补）。
    //        ★为什么不能写成"`f.place` 在 `b.places` 里就整行不印"：真账里大半的桥**都到过本面**
    //          （它们正是把两处连起来的人）⇒ 那样写会让 `长城`/`界海` 这些卡上的桥整片消失。
    //        ★为什么不用 `e.location === f.place` 判②：真账里这些人的驻地大半是「未明」，
    //          那条尺子在真账上一次都不成立（**判据比现场窄一格**，本仓老病）。
    const rows = f.shared
        .map((b) => ({
            name: b.name,
            to: b.places.filter((p) => !selfRef(p) && !(p === b.name && !!entByName.get(p))),
        }))
        .filter((b) => b.name && b.to.length && b.name !== f.place);
    if (!rows.length) return '';
    // ★★leg98（用户实机读到的那一处误读）：这些名字是**人/势力**，而旧的「与别处相连：」读起来
    //   像是"这一处连着哪几处"。真账现场两张卡并排看时，读者会以为箭头左边是别的地名。
    //   ⇒ 标签明说"**人**"这层身份，并点破这些名字在卡里本来就有（不点名是哪几条线——
    //     那会写成第二个"与这一处别的线共享"，本仓"同一件事两处表达"的老病）。
    return `<div class="sw2-pan-brg"><b>谁把这里和别处连起来</b>（都是卡上那些线里的人）：${rows.slice(0, 4).map((b) => `<b>${esc(b.name)}</b> → ${esc(b.to.join(' · '))}`).join('　')}</div>`;
}

// ★★★自证闸（设计交接 §3.1：**呈现层加一层组织，就要配一条"总数对得上"的闸**）
//   与编年页那条「子类合计 + 真事件 = 总行数」同源。★它必须印出来——藏在代码里的闸咬不住读者没看见的错。
function gsum(m, three) {
    const c = m.census;
    const parts = [`面内 ${c.routed}`, `单线地点 ${c.lone}`, `散落 ${c.scattered}`];
    const bad = m.dropped.length || c.sum !== c.total;
    return `<div class="sw2-pan-selfcheck${bad ? ' bad' : ''}">自证：线 <b>${c.total}</b> 条 = ${parts.join(' ＋ ')}`
        + `（共 <b>${c.sum}</b> 条）${bad
            ? ` · ⚠ 对不上：掉出页面 <b>${m.dropped.length}</b> 条（${esc(m.dropped.map((t) => t.name).join('、'))}）`
            : ` · 掉出页面 <b>0</b>`}`
        + `　·　那枚徽：还在往下长 <b>${three.growing}</b> · 挂着没了结 <b>${three.stale}</b> · 已收场 <b>${three.done}</b></div>`;
}

// ★大势与面之间那一段：**大势与面的真关系 ＝ 对读**（设计交接 §2.2）
//   ★★大势**统领不了面**：它是一句话，句子收不了条目（A 局 31 字 · B 局 72 字，各自只切成一句，
//     内部是顿号并列＝属性罗列）；而且"书的原始设定"是**前提**、账上算出的是**事实**——
//     前提不能收纳事实（否则就是「拿一句话冒充一个结构」）。
//   ⇒ 这一段只做两件事：报"此刻有多少处有事"（活数）＋讲清"大势给何故、面给何处"。
function bridgeHtml(m, stats, three) {
    const c = m.census;
    const kinds = [stats.liveThreads ? `还在往下长 <b>${stats.growingThreads}</b>` : '', three.stale > 0 ? `挂着没了结 <b>${three.stale}</b>` : '', three.done > 0 ? `已收场 <b>${three.done}</b>` : ''].filter(Boolean).join(' · ');
    return `<div class="sw2-pan-now">此刻：<b>${m.faces.length}</b> 处有事发生 · 全书 <b>${stats.threads}</b> 条线${kinds ? `（${kinds}）` : ''}`
        + `　·　<b>${m.bridges.length}</b> 个角色手伸到了两处以上</div>`
        + `<div class="sw2-pan-hint"><b>大势</b>是书里写定的<b>何故</b>，<b>面</b>是账上算出来的<b>何处</b>——两样并排读，不去互相统领。`
        + `下面按「面」组织：一个地方一段（<b>${m.faces.length}</b> 处有两桩以上的事在这里交会）；`
        + (c.lone ? `只经过一条线的地点 <b>${c.lone}</b> 处，挂在它那条线的面里；` : '')
        + `从不经过任何面的线 <b>${c.scattered}</b> 条，收在末尾「各处散落」。`
        + `面里每一条线是一段故事，点标题看它一步步怎么走的。<br><b>这里没有一个字是模型新写的</b>——全部是账上的原文与指针，只换了排法。</div>`
        // ★leg97：**那三态全页一套词**（照 leg95d 那条纪律：统计行 / 面头 / 徽 / 自证闸，一处口径）。
        //   数还从 `stats` 来（上面算过一次），这里只是把它印出来。
        + `<div class="sw2-pan-stats">`
        + `<span class="sw2-pan-stat"><b>${stats.threads}</b> 条线</span>`
        + `<span class="sw2-pan-stat live"><b>${stats.growingThreads}</b> 还在往下长</span>`
        + (three.stale ? `<span class="sw2-pan-stat"><b>${three.stale}</b> 挂着没了结</span>` : '')
        + (three.done ? `<span class="sw2-pan-stat"><b>${three.done}</b> 已收场</span>` : '')
        + `<span class="sw2-pan-stat"><b>${stats.events}</b> 件事</span>`
        + `<span class="sw2-pan-stat"><b>${m.faces.length}</b> 处面</span>`
        + `</div>`;
}

export function renderPanoramaHtml(world) {
    if (!world) return '<div class="sw2-pan-head">说书 · 这个世界还没有开档</div>';
    const { threads, stats } = buildPanorama(world);
    if (!stats.events) {
        return `<div class="sw2-pan-head">说书 · 还没长出可讲的事</div>`
            + `<div class="sw2-pan-empty">世界刚开局。等它自己走过几轮，这里会把"谁在谋划什么、事情怎么滚起来、谁付出了代价"按条理讲给你听。</div>`;
    }
    const m = buildFaces(world, threads);
    // ★印面头时也要判"这条桥是不是在自指"⇒ 也要那把"像不像地名"的尺子（**同一个实现**，
    //   传的是 `entByName` 而不是一个闭包：闭包会变成第二份影子实现）
    const entByName = new Map((world?.entities || []).filter((e) => e?.name).map((e) => [e.name, e]));
    const three = {
        growing: stats.growingThreads,
        stale: stats.liveThreads - stats.growingThreads,
        done: stats.threads - stats.liveThreads,
    };
    // ⑦ 「各处散落」（用户裁的名字 · 设计交接 §0 第 ② 条）：从"一个地方只有一条线路过"这一批
    //   ★区块头里保留「零散的事」四个字（leg94 判据④/⑤ 咬的就是这一块——它是**点层的第二支渲染**）
    const othersBlock = m.others.length
        ? `<div class="sw2-pan-other"><div class="sw2-pan-otherh">各处散落 · ${m.others.length} 件零散的事`
            + `<span class="sw2-pan-secn">· 一个地方只有一条线路过，跟别的事没连成一场 · 地名照印</span></div>`
            + `<ul class="sw2-pan-oneshot">` + m.others.map((o) => {
                const t = o.line;
                const [cls, label] = badgeOf(t);
                const pl = o.place
                    ? `<span class="sw2-pan-at">${esc(o.place)}</span>`
                    : `<span class="sw2-pan-at">（账上没写地点）</span>`;
                // 点层那两行也**一个字都不印状态**（同 leg95 那条纪律）；只有线头那枚徽说状态。
                return `<li><span class="sw2-pan-t">${spanOf(t.from, t.to)}</span> <b>${esc(t.name)}</b> ${pl}`
                    + `<span class="sw2-pan-span"> · ${o.count} 件事</span>`
                    + `<span class="sw2-pan-badge ${cls}">${label}</span></li>`;
            }).join('') + `</ul></div>`
        : '';
    return `<div class="sw2-pan-head">说书 · 这世界已经发生的事</div>`
        + `<div class="sw2-pan-dashi">`
        + `<div class="sw2-pan-dashilab">大势 · 书里写定的局面（原文措辞）</div>`
        + `<div class="sw2-pan-dashitxt">${m.sit ? esc(m.sit) : '（这本账没留大势句——它是书的设定层，重新抽书之后才会有）'}</div>`
        + `</div>`
        + bridgeHtml(m, stats, three)
        + m.faces.map((f) => `<div class="sw2-pan-face">`
            + `<div class="sw2-pan-fh"><div class="sw2-pan-fhl">`
            + `<span class="sw2-pan-fhn">${esc(f.place)}</span>`
            // ★面头这一行照设计交接 §1 的原话：**几条线在这里交会 · 几件事发生在此**
            //   （"几件事"＝真的发生在这个地方的；"几处单线地点"＝只被一条线到达的那些地方）
            // ★★leg98（用户实机那一屏咬出来的第三处）：**"交会"把那两个数糊成了一个**。
            //   真账现场：`大虞` 与 `大虞皇陵` 两张卡都是"2 条线在这里交会"、装的还是同一批线，
            //   可它们一个是**落脚**（这条线就是在这儿的事最多）、一个是**路过**——
            //   读者看不出差别，只看见两张几乎一样的卡（用户原话："你发现什么问题了吗"）。
            //   ⇒ 落脚/路过**分开报**（两个数只在有一支为零时不印，省得空话）。
            //   ★`f.routes`/`f.passes` 是 `buildFaces` **已经算好交出来**的数（不在这里另算一遍）。
            + `<span class="sw2-pan-fhs"><b>${f.lines.length}</b> 条线在这里交会`
            + (f.routes && f.passes
                ? `（<b>${f.routes}</b> 条落脚在此 · <b>${f.passes}</b> 条路过）`
                : f.passes ? '（都只是路过）' : '')
            + ` · <b>${f.events}</b> 件事发生在此`
            + (f.lone.length ? ` · 另有 <b>${f.lone.length}</b> 处单线地点` : '')
            + ` · 还在往下长 <b>${f.lines.filter((t) => t.growing).length}</b></span>`
            + `</div>${bridgesHtml(f, entByName)}</div>`
            + `<div class="sw2-pan-fb">`
            + f.lines.map((t) => lineHtml(t, f, world)).join('')
            + (f.lone.length
                // ★单线地点：**地名照印**（设计交接 §1.1 第 2 条）——它就是"这一处另有 N 件单独发生的事"，
                //   连它起头那件事一起印出来，读者才知道那是什么事（只印一个线名会读成谜语）
                ? `<div class="sw2-pan-lonebox"><div class="sw2-pan-sub">这一处另有 ${f.lone.length} 处单线地点`
                    + `<span class="sw2-pan-secn">· 那些地方只有这一条线路过</span></div>`
                    + `<ul class="sw2-pan-oneshot">` + f.lone.map((l) => {
                        const head = l.line.events[0];
                        return `<li><span class="sw2-pan-at">${esc(l.place)}</span>`
                            + `　<b>${esc(head.title)}</b><span class="sw2-pan-t">第 ${head.tick} 轮</span>`
                            + `${head.why ? ` <span class="sw2-pan-why">${esc(head.why)}</span>` : ''}`
                            + `<span class="sw2-pan-span"> · 这条线共 ${l.line.count} 件事（${spanOf(l.line.from, l.line.to)}）</span>`
                            + (l.line.name !== head.title ? `<span class="sw2-pan-span"> · 属「${esc(l.line.name)}」那条线</span>` : '')
                            + `</li>`;
                    }).join('')
                    + `</ul></div>`
                : '')
            + `</div></div>`).join('')
        + othersBlock
        + gsum(m, three);
}

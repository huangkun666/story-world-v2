// story-world-v2/web/entity-window.js
//
// ★★★leg140（用户令「**点击实体就会出现，能看到这个实体的各种属性以及它的事迹**」）：
//   **实体观览窗口**——点面板「角色与势力」页里的一个实体，弹出一扇窗口，把这个人的
//   来历、变过的格、**他做的**、**涉及到他的**、在办的谋划、关系，一次看全。
//
// ★★本模块的边界（守死）：**取数 ＋ 拼 HTML ＋ 开关窗口**，三件而已。
//   · **零新写通道**：下面每一格都是**现推**（从 `world` 这个对象上现算），
//     没有一格是新加的账、没有一处迁移、契约层一个字节没动。
//   · **不碰引擎**：本模块零 `src/` 依赖（只借一个 `escapeHtml`），不认识引擎、不认识视图态。
//   · **不认识面板**：窗口开在哪、谁点开的，全靠注入进来的 `getWorld`。
//   ⇒ 模块顶层**零 DOM** ⇒ Node 里可直接 import，纯函数那几口能真跑判据
//     （与 `web/action-router.js` / `web/view-state.js` 同一把尺）。
//
// ★★★窗口是**弹在页面上层**的（用户当场改的那一条：「窗口是弹出来在页面上层的，不是被显示在页面中的」）。
//   ⇒ 照 `web/index.js` 那条链浮层（leg93c）**同一个做法**，三条一起抄：
//     ① 挂在 `document.body` 上、**不在面板窗口里** ⇒ 面板开着关着都能看；
//     ② `z-index` **高于面板那 50000**（本模块用 `.sw2-ew-mask` 那条，值 51000 —— 与链浮层同一把尺）；
//     ③ **自己的关闭三条路一处收口**（✕ / 点窗口外的暗处 / Esc），且 **Esc 走捕获阶段 +
//        `stopPropagation`** —— 面板自己有一条"Esc 关整个窗口"，不拦的话按一次 Esc 会把面板一起关掉。
//   ★壳**复用**面板那套 `.sw2-window-mask` ＋ `.sw2-window`（leg101/102 定稿"遮罩 ＋ 占满整屏"）：
//     本仓最忌"同一件事两条路"，窗口系统已经有一套，不另造第二套。
//
// ★★判据口径（为什么这么分格）：见 `docs/spec-entity-window-mockup.html` 的「四件事已拍板」——
//   ① **六格**（★leg141 起 ③④ 两格的**格名**改成「事迹 · 他做的」与「事迹 · 涉及到他的」，
//      格数没变：还是六格）；② 事迹**新的在前、不印轮次**；③ 空态**分两种**
//      （主体格写明为什么 · 次要格一句人话）；④ 接线住本文件。
//   ★第 ② 条是被真账逼出来的：**事件上根本没有「第几轮」这一格**
//   （`ssot.schema.js` 的 `events[]` 里没有 `tick`，11 件真账全都没有）⇒ 要按轮次分组就得
//   从 id 里反解或给事件补一格（动契约），两样都不划算 ⇒ **账上数组本来就是发生顺序，倒过来即可**。

import { escapeHtml } from '../src/render-base.js';
// ★★★leg141b（用户当场问「**势力的麾下怎么点击窗口不显示**」）：**"谁归我管"那把尺子借过来用，不另写一份**。
//   判据（`kind === 'character'` ∧ `parent ∈ {势力名, 其分支}`）的**唯一真源**在 `src/pack.js`
//   的 `memberEntitiesOf`（面板「麾下：」那一行也用它）——本模块只借**取数**那一半，
//   **呈现**自己来（窗口要全量、带 id、可点；面板那一行是截到 8 个的名号串）。
import { memberEntitiesOf } from '../src/pack.js';

/** 浮层的 id（一处定义、多处引用——照 `CHAIN_MASK_ID` 的先例）。 */
export const ENTITY_WINDOW_MASK_ID = 'sw2_entity_window';
/** 动作名（实体行上挂 `data-action="ent-open" data-entity="<id>"`）。 */
export const ENTITY_WINDOW_ACTION = 'ent-open';

// ── ① 「来历与身份」里**不摆**的键：它们是结构，不是"书里给的属性" ──────────────
//   ★逐个说清为什么（别凭感觉加）：
//     · `id` / `kind` / `name` —— 已经印在窗口头上了；
//     · `location` —— 头上那行「位置」印的就是它；
//     · `lastActiveTick` —— 头上那行「最近动过」；
//     · `status` —— 头上那行「状态」；
//     · `fieldSource` —— 它是**出处表**（每个属性的来历），单独渲染，不是一格属性；
//     · `parent` / `parentSource` / `parentSourceFrom` —— 归属那一格（要标"怎么来的"）；
//     · `branches` / `organs` —— 归属那一格的从属名单（分支/机构）。
const STRUCT_KEYS = new Set([
    'id', 'kind', 'name', 'location', 'lastActiveTick', 'status',
    'fieldSource', 'parent', 'parentSource', 'parentSourceFrom', 'branches', 'organs',
]);

// ── ② 常用键的**显示序**：照 `src/tag-extract.js` 的 `CHANGE_FIELDS` ──────────
//   ★为什么不另写一份名单：那七个键（所属/身份/定位/实力/性质/倾向/规模）在全仓**已经有一处口径**
//     （正文【变化】能改的就是它们）。再抄一份 = 第二份真相，改了一处另一处不知道。
//   ★表外的键（真账里有 特征/描述/性别/领地/本体/性情/地位/化形/本命/寿元/境界… 四十来种）
//     **照收**，排在常用键后面、**按实体自己的键序**（不是字母序——账上的键序就是书里抽出来的次序，
//     换个序等于替作者重排他的书）。
export const ATTR_ORDER = ['所属', '身份', '定位', '实力', '性质', '倾向', '规模'];

/**
 * 纯函数：一个实体 → **有序的属性对** `[[键, 值, 出处], …]`。
 * ★出处取自 `entity.fieldSource[键]`（真账里 617/640 个实体带这张表；没有 ⇒ 交 `null`，不猜）。
 */
export function attrPairsOf(entity) {
    if (!entity || typeof entity !== 'object') return [];
    const src = (entity.fieldSource && typeof entity.fieldSource === 'object') ? entity.fieldSource : {};
    const seen = new Set();
    const out = [];
    const push = (k) => {
        if (seen.has(k) || STRUCT_KEYS.has(k)) return;
        const v = entity[k];
        if (typeof v !== 'string' || !v.trim()) return;      // 空着就是空着：非字符串/空串一律不印
        seen.add(k);
        out.push([k, v, typeof src[k] === 'string' ? src[k] : null]);
    };
    for (const k of ATTR_ORDER) push(k);
    for (const k of Object.keys(entity)) push(k);
    return out;
}

/** 纯函数：归属那一格（上级 ＋ 分支 ＋ 机构），带"怎么来的"。没有 ⇒ `null`。 */
export function originOf(entity) {
    if (!entity || typeof entity !== 'object') return null;
    const bits = [];
    if (typeof entity.parent === 'string' && entity.parent.trim()) bits.push({ t: '所属', v: entity.parent });
    if (Array.isArray(entity.branches) && entity.branches.length) bits.push({ t: '分支', v: entity.branches.join('、') });
    if (Array.isArray(entity.organs) && entity.organs.length) bits.push({ t: '机构', v: entity.organs.join('、') });
    if (!bits.length) return null;
    // ★"怎么来的"必须一起印：真账里 213 个有上级的实体，`parentSource` 有"照书办 / 结构推导 / 模型抽取…"
    //   ——"书里明写的"与"从成员行推的"是两件事，只印名字等于把推断冒充原话。
    const how = [entity.parentSource, entity.parentSourceFrom].filter((x) => typeof x === 'string' && x.trim());
    return { bits, how: how.length ? how.join(' · ') : null };
}

/**
 * 纯函数：**事迹**——账上 `ripples[0] === id` 的那些事件。
 * ★`ripples[0]` 恒是这件事的主语（`src/settle.js` 写明的约定）⇒ 这就是"他做过的事"。
 * ★**新的在前**（账上数组本来是发生顺序，整个倒过来）——已拍板口径，理由见文件头。
 */
export function deedsOf(world, id) {
    const evs = Array.isArray(world?.events) ? world.events : [];
    return evs.filter((e) => Array.isArray(e?.ripples) && e.ripples[0] === id).reverse();
}

/** 纯函数：**被卷进来**——他在 `ripples` 里、但**不是**头一个（别人做的事牵到他）。同样新的在前。 */
export function involvedOf(world, id) {
    const evs = Array.isArray(world?.events) ? world.events : [];
    return evs.filter((e) => Array.isArray(e?.ripples) && e.ripples.includes(id) && e.ripples[0] !== id).reverse();
}

/** 纯函数：**他手上的事**（在办的谋划）。 */
export function agendasOf(world, id) {
    const ags = Array.isArray(world?.agendas) ? world.agendas : [];
    return ags.filter((a) => a?.owner === id);
}

/**
 * 纯函数：**关系**——账上跟他相连的边（**一张网，不分出处**）。
 * ★★leg141（用户令「**把抽象阶段的关系网抽象做出来，我才发现初始化的时候都没有关系网**」）：
 *   从这一笔起，账上这张网**开局就有**了——初始化会把书里明写的关系（师徒/辖属/结拜/仇敌…）
 *   种进来（`src/abstract.js` 的 `seedBookRelations`，`tick: 0`），此后由玩的过程往下长。
 *   ★**本函数一个字没改**：它读的一直是同一张表 —— 这正是不分家的好处
 *     （旧口径那张网开局恒空，所以这一格常空；现在开局就有东西可看）。
 *   ★**不许按出处分组**（用户 2026-09-27 当场裁的：「**为啥你们总喜欢把一个东西分为书里写的和之后改的？？**」）：
 *     玩家要的是"现在谁跟谁是什么关系"，不是"这条是谁给的"——出处那件事住在引擎里，不上屏幕。
 */
export function relationsOf(world, id) {
    const rs = Array.isArray(world?.relations) ? world.relations : [];
    return rs.filter((r) => r?.from === id || r?.to === id);
}

/** 纯函数：**变过的格**——`meta.entityFields[id].fields`（玩出来的，带因、带轮次、带原值）。 */
export function changedFieldsOf(world, id) {
    const rec = world?.meta?.entityFields?.[id];
    const fields = (rec && typeof rec === 'object' && rec.fields && typeof rec.fields === 'object') ? rec.fields : {};
    return Object.entries(fields).map(([k, v]) => ({
        field: k,
        now: v?.value ?? null,
        prev: v?.prior?.value ?? v?.prev ?? null,      // 上一版优先（`prior` 是链式留痕），否则首次改之前的原值
        cause: v?.cause ?? null,
        tick: Number.isFinite(v?.tick) ? v.tick : null,
        source: v?.source ?? null,
    }));
}

/**
 * ★★★leg141b（用户当场问「**势力的麾下怎么点击窗口不显示**」＋「**关系网包括了势力与势力和势力与角色没？**」）：
 *   **关系网** —— 这个实体在账上连着的一切，**一张网、不分出处、不分来源**。
 *
 * 三种来源合成**一张有向边表**：
 *   ① **层级·正向**（他自己身上的 `parent` / `branches` / `organs`）—— 所属 / 分支 / 机构；
 *   ② **层级·反向**（**谁归他管** ⇒ 就是「**麾下**」）—— 走 `memberEntitiesOf`（与面板同一把尺子）；
 *   ③ **账上的边**（`ssot.relations`）—— 开局从书里种的 ＋ 玩出来的。
 *
 * ★★为什么层级也算"关系"：它**本来就是边**（角色 → 势力、子势力 → 上级、机构 → 名下的主），
 *   只不过住在 `parent` / `branches` / `organs` 这三个字段里。★用户那一问的正解就是这个：
 *   **不并进来，开局那张网永远是空的**——书里的层级**不用等重抽就有**（它是初始化建的）。
 *
 * ★★**一个事实只有一个家**（本仓最贵的那条纪律）：`parent` 仍是层级的**唯一真源**，
 *   本函数只是**把它当边读**，**绝不往 `relations` 表里再写一份**——那是"同一个号两处写"。
 *   ⇒ 出包那一侧也**一个字不用改**：层级早就在包里（实体行式那七个字段里的 `parent` 与 `members`）。
 *
 * @returns `{dir, label, other, who, tail, kind}[]`——`dir`：`'out'` 我→他 / `'in'` 他→我；
 *   `who`：对方在账上的实体 id（**解析不到就 null ⇒ 那一行不可点**，但**照样印出来**）；
 *   `kind`：`'hier'` 层级 / `'edge'` 账上的边。
 */
export function networkOf(world, entity) {
    if (!entity || typeof entity !== 'object') return [];
    const ents = Array.isArray(world?.entities) ? world.entities : [];
    const byName = new Map();
    for (const x of ents) {
        const nm = String(x?.name ?? '').trim();
        if (nm && !byName.has(nm)) byName.set(nm, x?.id);
    }
    const out = [];
    // ① 层级·正向（`originOf` 是那三格的**唯一取数口**，本函数不重写一遍判据）
    const origin = originOf(entity);
    if (origin) {
        // ★"怎么来的"跟着 `所属` 那一条走（leg25 g 立的：读者要分得清"书里明写"与"从别处推的"）。
        //   搬到这里而不是留在「来历与身份」：层级现在住关系格，**一个事实只许有一个家**。
        for (const b of origin.bits) {
            out.push({
                dir: 'out', label: b.t, other: b.v, who: byName.get(b.v) || null,
                tail: b.t === '所属' ? (origin.how || null) : null, kind: 'hier',
            });
        }
    }
    // ② 层级·反向（**麾下**）——★这一段就是用户问的那一格
    for (const m of memberEntitiesOf(world, entity)) {
        out.push({ dir: 'in', label: '麾下', other: String(m?.name ?? ''), who: m?.id || null, tail: null, kind: 'hier' });
    }
    // ③ 账上的边（开局从书里种的 ＋ 玩出来的）
    for (const r of relationsOf(world, entity.id)) {
        const mine = r.from === entity.id;
        const otherId = mine ? r.to : r.from;
        const other = ents.find((x) => x?.id === otherId);
        out.push({
            dir: mine ? 'out' : 'in',
            label: String(r.type ?? ''),
            other: String(other?.name ?? otherId ?? ''),
            who: otherId || null,
            tail: Number.isFinite(r.endedTick) ? `第 ${r.endedTick} 轮起不再算数` : null,
            kind: 'edge',
        });
    }
    return out;
}

// ── 渲染：几段共用的零件 ────────────────────────────────────────────────
const KIND_CN = { faction: '势力', character: '角色' };
const SRC_CN = { seed: '起根', ripple: '涟漪', plot: '情节', state: '处境', dialogue: '正文' };
const STATUS_CN = { active: '活跃', retired: '背景', dead: '已灭' };

// ★★leg141（用户令「**把（账上「涟漪」头一个是他；正文给的也在这一格里）这种文字给删了**」）：
//   格标题上**不再挂那行括号说明**。★他这条是对的，而且是本仓那条「**没多大用的设计直接摒弃即可**」
//   的又一例：那些说明文讲的全是**引擎内部的黑话**（「涟漪」「头一个」「主语」），
//   而玩家读的是"这个人做过什么"——**标题 ＋ 计数**已经把这一格说清了，多那半句只是噪音。
//   ★一并把格名改成**自解释的**（见下面 ③④：事迹拆成「他做的」与「涉及到他的」）——
//     原来那两格的区分**全靠那行说明文撑着**，说明文一撤、名字自己就得站得住。
const sec = (title, n) => `<div class="sw2-list-head sw2-ew-sech">${escapeHtml(title)}`
    + (n == null ? '' : `<span class="sw2-ew-n">${escapeHtml(n)}</span>`) + `</div>`;

/** 一件事件渲染成一行（事迹与被卷进来共用同一把尺子——同一件事只许一种印法）。 */
function eventRowHtml(e) {
    const t = String(e?.title ?? '').trim();
    const kind = e?.source?.type ?? '';
    const bits = [];
    if (e?.timeMark) bits.push(`<span class="sw2-ew-when">${escapeHtml(e.timeMark)}</span>`);
    if (e?.position) bits.push(`事发 ${escapeHtml(e.position)}`);
    if (e?.source?.ref) bits.push(`沿 ${escapeHtml(e.source.ref)} 而来`);
    if (e?.closed) bits.push('已收场');
    const quote = (typeof e?.proseQuote === 'string' && e.proseQuote.trim()) ? e.proseQuote
        : (typeof e?.seedFrom?.quote === 'string' && e.seedFrom.quote.trim()) ? e.seedFrom.quote : null;
    return `<div class="sw2-entry sw2-ew-deed">`
        + `<div class="sw2-ew-dtitle">${escapeHtml(t)}`
        + (kind ? `<span class="sw2-chip sw2-ew-kindchip">${escapeHtml(SRC_CN[kind] || kind)}</span>` : '')
        + `</div>`
        + (bits.length ? `<div class="sw2-ew-cmeta">${bits.join('<span class="sw2-ew-sep"> · </span>')}</div>` : '')
        + (quote ? `<div class="sw2-ew-quote">${escapeHtml(quote)}</div>` : '')
        + `</div>`;
}

/**
 * ★★★本模块的主口：**纯函数**——给一份世界账和一个实体 id，交出整扇窗口的 HTML。
 *   判据直接调它（不需要 DOM、不需要浏览器）。
 * ★实体不在账上 ⇒ **如实说**（不抛错、不空白）：那一行可能是世界换过之后的旧行。
 */
export function renderEntityWindowHtml(world, id) {
    const ents = Array.isArray(world?.entities) ? world.entities : [];
    const e = ents.find((x) => x?.id === id) || null;
    if (!e) {
        return `<header class="sw2-header sw2-ew-head"><div class="sw2-badge sw2-ew-badge">观</div>`
            + `<div class="sw2-title-block"><div class="sw2-title">账上没有这个实体</div>`
            + `<div class="sw2-subtitle">id ${escapeHtml(String(id ?? '（空）'))}</div></div>`
            + `<div class="sw2-close sw2-ew-close" title="关闭（Esc）">✕</div></header>`
            + `<div class="sw2-ew-body"><div class="sw2-ew-empty">这一行是<b>上一份账</b>上的——世界换过之后它就没了。`
            + `关掉这扇窗口、刷新面板即可。</div></div>`;
    }

    const kindCn = KIND_CN[e.kind] || e.kind || '';
    const status = STATUS_CN[e.status] || null;
    const isPlayer = world?.context?.playerId === e.id;

    // ── 头 ──
    const head = `<header class="sw2-header sw2-ew-head">`
        + `<div class="sw2-badge sw2-ew-badge">观</div>`
        + `<div class="sw2-title-block">`
        + `<div class="sw2-title sw2-ew-name">${escapeHtml(String(e.name ?? ''))}`
        + (isPlayer ? `<span class="sw2-chip sw2-ew-you">你 · 玩家棋子</span>` : '')
        + `<span class="sw2-ew-kind">${escapeHtml(kindCn)}</span></div>`
        + `<div class="sw2-subtitle sw2-ew-sub">`
        + `<span>位置 <b>${escapeHtml(String(e.location ?? '未明'))}</b></span>`
        + (Number.isFinite(e.lastActiveTick) ? `<span>最近动过 <b>第 ${e.lastActiveTick} 轮</b></span>` : '')
        + (status ? `<span>状态 <b>${escapeHtml(status)}</b></span>` : '')
        + `<span>账上 id <b>${escapeHtml(String(e.id))}</b></span>`
        + `</div></div>`
        + `<div class="sw2-close sw2-ew-close" title="关闭（Esc）">✕</div></header>`;

    const body = [];

    // ── ① 来历与身份（书里给的属性） ──
    //   ★★leg141b：**归属那三行（所属/分支/机构）从这里搬走了**——它们现在住 ⑥ 关系格（当成边看）。
    //     为什么搬（不是"顺手挪"）：用户当场问「**关系网包括了势力与势力和势力与角色没？**」，
    //     而这三格**本来就是边**；留在两处就是本仓那条「**同一事实印两遍**」的老病
    //     （`spec-entities-page-ia.md` 的 D2 就是这个病，当年在面板上治过一次）。
    //     ★"怎么来的"（`parentSource`：书里明写 / 结构推导…）**没丢**——它跟着「所属」那条边走（见 ⑥）。
    const attrs = attrPairsOf(e);
    if (attrs.length) {
        let h = sec('来历与身份', `${attrs.length} 栏`);
        h += `<dl class="sw2-ew-kv">`;
        for (const [k, v, src] of attrs) {
            h += `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}`
                + (src ? `<span class="sw2-ew-src">${escapeHtml(src)}</span>` : '') + `</dd>`;
        }
        h += `</dl>`;
        body.push(h);
    } else {
        body.push(sec('来历与身份', '0 栏')
            + `<div class="sw2-ew-empty">书里没给这个人写过属性——账上只有他的名号与类别。</div>`);
    }

    // ── ② 变过的格（玩出来的） ──
    const changed = changedFieldsOf(world, e.id);
    if (changed.length) {
        let h = sec('变过的格', `${changed.length} 格`);
        for (const c of changed) {
            h += `<div class="sw2-ew-chg"><span class="sw2-ew-cf">${escapeHtml(c.field)}</span>`
                + `<span class="sw2-ew-arrow">→</span>`
                + (c.prev ? `<span class="sw2-ew-old">${escapeHtml(String(c.prev))}</span><span class="sw2-ew-arrow">→</span>`
                    : `<span class="sw2-ew-old">（原来没有）</span><span class="sw2-ew-arrow">→</span>`)
                + `<span class="sw2-ew-new">${escapeHtml(String(c.now ?? ''))}</span>`
                + `<span class="sw2-ew-cmeta">因 ${escapeHtml(String(c.cause ?? '（没记）'))}`
                + (c.tick != null ? ` · 第 ${c.tick} 轮` : '')
                + (c.source ? ` · ${escapeHtml(c.source)}` : '') + `</span></div>`;
        }
        body.push(h);
    } else {
        body.push(sec('变过的格', '0 格')
            + `<div class="sw2-ew-empty">账上没记着这个实体的格变过——它这些栏都是书里给的，不是玩出来的。</div>`);
    }

    // ── ③ 事迹 · **他做的**（他是主语的那些事） ──
    //   ★★leg141（用户令「**把事迹分为他做的和涉及到他的**」）：原来这两件事分别叫「事迹」与
    //     「被卷进来」，**两者的区分全靠标题上那行括号说明文撑着**（"账上「涟漪」头一个是他"
    //     vs "他在「涟漪」里、但不是头一个"）。说明文一撤（同一道令的上半句），那两个名字就
    //     站不住了——**玩家读不出"事迹"和"被卷进来"原来是一件事的两面**。
    //   ⇒ 格名直接照用户的原话拆开：**「事迹 · 他做的」** 与 **「事迹 · 涉及到他的」**。
    //     ★取数口一个都没动（`deedsOf` / `involvedOf` 还是那两把尺子，`ripples[0]` 恒是主语
    //       这条约定照旧由 `src/settle.js` 担保）——本笔**只改名字**，账上零扰动。
    //   ★「正文给的也在这一格里」那半句也一并撤：正文产出的事件（`source.type === 'dialogue'`）
    //     本来就落在这里、带着「正文」那枚小标（`SRC_CN.dialogue`）——**小标自己会说话**，
    //     不必再用一行字解释它为什么在这儿。
    const deeds = deedsOf(world, e.id);
    if (deeds.length) {
        body.push(sec('事迹 · 他做的', `共 ${deeds.length} 件`) + deeds.map(eventRowHtml).join(''));
    } else {
        body.push(sec('事迹 · 他做的', '共 0 件')
            // ★★★leg198（社区反馈第 3 条）：旧文案把"书里没写、也没轮到他"当结论印出来——
            //   那是**假话**：真相常常是"正文里他做了事，但这一轮没有标签 ⇒ 没记下来"
            //   （正文里的事要进这一栏，唯一的入口是标签）。⇒ 改成如实说，并指向那一枚开关。
            //   那是**假话**：真相常常是"正文里他做了事，但这一轮没有标签 ⇒ 没记下来"
            //   （正文里的事要进这一栏，唯一的入口是标签）。⇒ 改成如实说，并指向那一枚开关。
            + `<div class="sw2-ew-empty">账上还没有他做过的事——正文里的事，要等标签点到他才记得下来（开关在「参数」页：「让聊天模型按标签写行动」）。</div>`);
    }

    // ── ④ 事迹 · **涉及到他的**（别人做的事牵到他） ──
    const involved = involvedOf(world, e.id);
    if (involved.length) {
        body.push(sec('事迹 · 涉及到他的', `共 ${involved.length} 件`) + involved.map(eventRowHtml).join(''));
    } else {
        body.push(sec('事迹 · 涉及到他的', '共 0 件')
            + `<div class="sw2-ew-empty">还没有别人做的事牵到他——账上他一向是做事的那个人，没被别人卷进去过。</div>`);
    }

    // ── ⑤ 他手上的事（在办的谋划） ──
    const ags = agendasOf(world, e.id);
    if (ags.length) {
        let h = sec('他手上的事', `${ags.length} 条`);
        for (const a of ags) {
            h += `<div class="sw2-ew-ag"><div class="sw2-ew-aggoal">${escapeHtml(String(a.goal ?? ''))}</div>`
                + `<div class="sw2-ew-cmeta"><span>${escapeHtml(String(a.stage || '谋划中'))}</span>`
                + `<span>进度 ${Number(a.progress) || 0}/${Number(a.maxSteps) || 0}</span>`
                + (a.visibility === 'concealed' ? `<span class="sw2-ew-hush">暗处</span>` : '')
                + `</div></div>`;
        }
        body.push(h);
    } else {
        body.push(sec('他手上的事', '0 条')
            + `<div class="sw2-ew-empty">眼下没有在办的谋划——他没在盘算什么，或者盘算已经结清了。</div>`);
    }

    // ── ⑥ 关系网（**一张网**：层级 ＋ 账上的边，不分出处、不分来源） ──
    //   ★★★leg141b（用户当场两问：「**势力的麾下怎么点击窗口不显示**」＋
    //     「**关系网包括了势力与势力和势力与角色没？**」）：这一格从"只读 `relations` 表"
    //     改成**读整张网**（`networkOf`）——层级（所属/分支/机构/**麾下**）与账上的边**并成一张表**。
    //   ★★一行 = 一条边：`<标签> <对方名> <尾巴>`。层级在前（骨架），账上的边在后（动态）。
    //   ★**可点的行**：对方在账上认得到实体 ⇒ 挂 `data-who`，点一下就换到那个人（同一个窗口，不新开）。
    //     认不到的（书里写了名号但没入池）⇒ **照样印出来**，只是不可点（如实，不藏）。
    const net = networkOf(world, e);
    if (net.length) {
        let h = sec('关系', `${net.length} 条`);
        for (const x of net) {
            const dirCn = x.kind === 'hier' ? '' : (x.dir === 'out' ? '对 ' : '被 ');
            const nm = x.who
                ? `<b data-who="${escapeHtml(String(x.who))}" title="点一下看这个人">${escapeHtml(x.other)}</b>`
                : `<b class="sw2-ew-netoff">${escapeHtml(x.other)}</b>`;
            h += `<div class="sw2-ew-rel${x.kind === 'hier' ? ' sw2-ew-hier' : ''}">`
                + `<span class="sw2-ew-cf">${escapeHtml(dirCn + x.label)}</span> `
                + nm
                + (x.tail ? `<span class="sw2-ew-cmeta">${escapeHtml(x.tail)}</span>` : '')
                + `</div>`;
        }
        body.push(h);
    } else {
        body.push(sec('关系', '0 条')
            + `<div class="sw2-ew-empty">账上他还没跟谁连上——书里没写他的归属与同僚，这一局也还没长出关系来。</div>`);
    }

    // ── ⑦ 「被正文点名」那一格**已撤**（leg140b · 用户当场指出的） ────────────────────
    //   用户原话：「**被正文点名的次数是啥？？正文不也是给出事件给插件管理吗？那就直接放在事迹里面啊**」。
    //   ★他说得对，而且是**本仓那条"一条信息只许住在它该住的那一格"**的又一例：
    //     `meta.dialogueBook` 数的是"这个名字在正文里被叫过几回"，它**是给引擎自己用的依据册**
    //     （`dialogueFact` 那型源的门槛：只有"对话里反复被点名"的对象才走那一型，见 `src/settle.js`）——
    //     **不是给玩家看的事实**。正文真正产出给玩家的东西**就是事件**，而那些事件
    //     （`source.type === 'dialogue'`）**本来就长在「事迹」那一格里**（带着「正文」那枚小标）。
    //   ⇒ 撤掉整格，一个字都不丢：要看"正文给了他什么"，看「事迹」。
    //   ★`namedOf()` 那个取数口**同批删掉**（撤了格它就零消费者了——本仓不留死码）。

    return head + `<div class="sw2-ew-body">${body.join('')}</div>`;
}

/**
 * 依赖注入工厂（照 `createSnapshotHub` / `createHotLedgerHub` / `createActionRouter` 先例）。
 * @param {{getWorld: () => object|null, setStatus?: (s: string) => void, doc?: object|null}} deps
 *   ★`getWorld` 必须是**函数**（世界对象会被反复重新赋值——传成值就是"第二份真相"）。
 */
export function createEntityWindowHub({ getWorld, setStatus = null, doc = null } = {}) {
    if (typeof getWorld !== 'function') throw new TypeError('createEntityWindowHub：`getWorld` 必须是函数');
    const D = () => doc || (typeof document !== 'undefined' ? document : null);
    let escHandler = null;

    /** 一处收口：✕ / 点窗口外的暗处 / Esc 三条路都走它。 */
    function close() {
        const d = D();
        const el = d?.getElementById?.(ENTITY_WINDOW_MASK_ID) || null;
        if (el?._sw2Esc && d?.removeEventListener) d.removeEventListener('keydown', el._sw2Esc, true);
        escHandler = null;
        el?.remove?.();
    }

    function isOpen() {
        return Boolean(D()?.getElementById?.(ENTITY_WINDOW_MASK_ID));
    }

    /** 打开某个实体的窗口。★世界对象**现取**（`getWorld()`），不是建 hub 那一刻抓死的。 */
    function open(id) {
        const d = D();
        if (!d?.createElement || !d?.body?.appendChild) {
            if (setStatus) setStatus('注意：这个环境里开不了实体窗口');
            return false;
        }
        const world = getWorld();
        if (!world) { if (setStatus) setStatus('注意：还没有世界可看'); return false; }
        close();                                   // 先撤上一层（连点两个实体 ⇒ 换内容，不留两份）
        const mask = d.createElement('div');
        // ★★★`sw2-open` 这一个类**绝不能少**（leg140 真机上就是栽在它上面）：
        //   `web/style.css` 里 `.sw2-window-mask{…display:none…}`，**只有** `.sw2-window-mask.sw2-open`
        //   才切成 `display:flex` ⇒ 少了它，窗口**真建出来、真挂进 `document.body`、内容真渲染了**，
        //   但它是**隐形的**：玩家看到的是"点了没反应"，而且**一个字都不报错**。
        //   ★面板自己那扇窗是 `openWindow()` 里 `classList.add('sw2-open')` 干的（同一个机理）。
        //   ★判据 `test/entity-window.test.js` 的 ⑳ 两头咬着它：这个类在不在 ＋ 样式表里它是什么意思。
        mask.className = 'sw2-window-mask sw2-ew-mask sw2-open';
        mask.id = ENTITY_WINDOW_MASK_ID;
        const box = d.createElement('div');
        box.className = 'sw2-window sw2-ew-window';
        box.innerHTML = renderEntityWindowHtml(world, id);
        mask.appendChild(box);
        // ⓵ 点**窗口外的暗处**关掉（点窗口内部不关——不然想看细处一点就没了）
        mask.addEventListener('click', (ev) => { if (ev.target === mask) close(); });
        // ⓶ 窗口里那枚 ✕（浮层挂在 `document.body` ⇒ 面板的动作总线够不到它，自己收）
        box.querySelector?.('.sw2-ew-close')?.addEventListener('click', () => close());
        // ⓸ ★★★leg141b（用户当场问「**势力的麾下怎么点击窗口不显示**」）：**关系格里可点的名字**——
        //   点「麾下 凌霄」就换到凌霄那一页（**同一个窗口，不新开第二扇**）。
        //   ★走**委托**（一行监听管住整格）：窗口内容是 `innerHTML` 一次性灌进去的，
        //     逐行挂监听要在每次重渲染后重挂一遍——委托没有这个问题。
        //   ★只认 `[data-who]`（账上认得到实体的那些行）；认不到的行**没有**这个属性 ⇒ 天然不可点。
        //   ★`closest?.` 用可选调用：判据那份**假 DOM** 没有 `closest`（它只 stub 了本模块用到的那几口），
        //     真浏览器里一定有。★别把这一句改成"假设一定有 `closest`"——那会让假 DOM 判据当场红在错的地方。
        box.addEventListener('click', (ev) => {
            const hit = ev.target?.closest?.('[data-who]');
            const id = hit?.getAttribute?.('data-who');
            if (id) open(id);
        });
        // ⓷ Esc：**捕获阶段 + stopPropagation** ⇒ 面板那条"Esc 关整个窗口"不会跟着一起触发
        //   （与链浮层 `web/index.js` 的 `onEsc` 逐字同款；本监听只在窗口存在期间挂着，随它一起摘掉）
        const onEsc = (ev) => {
            if (ev.key !== 'Escape') return;
            ev.stopPropagation();
            ev.preventDefault();
            close();
        };
        escHandler = onEsc;
        mask._sw2Esc = onEsc;
        if (d.addEventListener) d.addEventListener('keydown', onEsc, true);
        d.body.appendChild(mask);
        return true;
    }

    return { open, close, isOpen };
}

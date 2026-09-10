// story-world-v2/src/settle.js
// 结算管线（S5）：按序 校验 → 薄裁定 → 因果挂链 → 一致性检查 → 分量重算（常量占位）→ 落账 → 编年 → GC/度量。
// 纯函数：输入 SSOT 不被修改，返回新世界。硬规则出处：ANCHOR §3②/§4.2/§4.4/§4.5、切片细案 S5、长跑防线细案 §2.5。
import { checkWorldStep } from './check-step.js';
import { buildEvolutionPack } from './pack.js';
import { gateWorldStep } from './gate.js';
import { computeWeightAtTick } from './weight.js';
import { pulseEntropy } from './entropy.js';   // K27：熵泵（环境推演器 + 越阈落状态源事件）
import { updateTensionIntensity, pushTidePeak, eventBornTick } from './setting.js';   // K29：张力强度更新 + 浪尖派生（A-5 两来源）；bornTickOf 共用契约解析器

export const ATTR_BOUNDS = [0, 1];    // 属性硬边界（薄裁定器按量裁的硬结果之一）

// K9：玩家影响通道系数（玩家档案细案 §3.3，提案态——K11 曲线校准后正式报批，铁律 2/8）
export const PLAYER_IMPACT = { targeted: 0.05, rippled: 0.02 };

// K14 出生裁判上限（盘算树细案 §3.2 → A-3）：每 tick 新生 / 在飞全局 / 顶层（无父）上限。
// T2 已拍板；数字提案态——K16 冒烟曲线后正式报批（铁律 2/8）。
export const AGENDA_CAPS = { perTick: 2, open: 15, topLevel: 5 };
const AGENDA_STAGE_FALLBACK = '谋划';   // 新盘算缺省阶段（ssot schema 要求 stage 非空）
export const VERDICT_HURT_THRESHOLD = 0.05;   // K15 败露判据（细案 §3.4，T3 已拍板；提案态——随 GC 数字一并报批）

// K19 事件产率上限 / 链尾结清窗（因果链细案 §3.1/§3.2，T1/T2 已拍板；均提案态——曲线支撑：
// 产率 max 4/tick 开局、稳态 1（细案 §1 配套曲线）；正式报批走报批支线，铁律 2/8）
export const EVENT_CAPS = { perTick: 6 };
export const CHAIN_SETTLE = 5;

// K20 档案摘要化（因果链细案 §3.3，T3 已拍板 + T3-D1 引擎结构摘要；longrun §2.2 原值，提案态——随报批支线）
// 热窗 20 tick：闭环满 20 tick 且无未决下游 → 按出生段压入里程碑（温层）；里程碑不进模型输入（pack 只取未决+近 2 closed，自动剥离）
export const ARCHIVE = { hotWindow: 20, milestoneEvery: 10 };

// K37 实体治理数字组（细案 §3.7 → A-10..A-12；铁律 2：全部提案态，随 K37 曲线 + K38 报批）
export const ENTITY_BIRTH_PER_TICK = 1;      // 提案：单轮新生 ≤1
export const ENTITY_IDLE_RETIRE_TICKS = 20;  // 提案：连续未活跃轮数（背景化条件）
// leg24 片3 删除位：RETIRE_WEIGHT_FLOOR（"影响力低于地板才准退休"）已删——判据不再吃分量。
//   片2 曾提前单摘它，三处冒烟当场红（应答机制 66→34、全册 active 破）；根因=当时门控还在吃分数，
//   而分数退化的世界"谁静默"已经失真。片3 把门控/镜头/掩码全换成结构判据之后，退休才具备换判据的前提。
//   现判据（下表 retireInactive）：无在飞盘算 ∧ 无未决事件引用 ∧ 连续 ENTITY_IDLE_RETIRE_TICKS 轮未露面。
export const ENTITY_GC_SCAN_TICKS = 20;      // 提案：背景化扫描周期
// （POOL_CAP 席位上限已于第十九棒 K45 废除——full-roster-lens-spec C3：资格=在册，镜头管进出；用户 2026-09-09 拍板「不设上限」）

// ---- K38 补差包（敲定稿 D 条）原"入局数值"面；**leg24 片2 账本换血：预填整段删除** ----
// 旧法：新实体入局按 kind 预填四维（character 0.15 / faction 0.25），名册实体也照填——
//   病根（用户实证）：**75.2% 实体四维全默认**（导出 (5)：453/602），"全 0.5/全 0.15"看起来像客观数据，
//   实际是我们替他填的。design-core §2.4 硬规矩一：**空着就是空着，不许填默认值冒充客观**。
// 现法：入局**不预填任何数值**（attrs 缺省=账面空着，schema 里 attrs 由必填改可选）；
//   数值只有一个来源=**模型每轮提议的 stateChanges/newEntities.attrs**（引擎钳制 [0,1]，留痕），
//   加上分量公式在"账面无数"时按中立值取中性 floor（见 weight.js NEUTRAL_ATTR）。
// 数字常量 ENTITY_ATTR_DEFAULT 已删（它唯一的用途就是那次预填）。
export const INBORN_ATTR_KEYS = ['hardPower', 'office', 'network', 'intel'];

// leg24 片4 数据迁移：旧账里那批**引擎编的假数**的一次性清理表（新代码不再产生这些数，此表只为清旧账）。
// 出处：git d6ea94d^ 的 `ENTITY_ATTR_DEFAULT = { character: 0.15, faction: 0.25 }`（入局预填）+ `buildSeedAttrs`（名册预填）。
// 病根（用户实证）：613 实体里 263 个全 0.15 / 67 个全 0.25（另有 37 个玩家注入 0.5——那不是本函数的面，
//   玩家数值由 player-inject/player-setup 侧负责）。界面读"账上有键"= 「有据 4/4」→ 界面在骗人。
//   实机复验（第二十五棒）：真正的大头是**混合行**——一维模型真值 + 其余几维旧默认，全在整行判词之外（见下）。
// 规则：**逐维**判——该维等于本类别旧默认值 ∧ 书里没写这一维 ∧ 编年里该实体无属性变更 → 删该维 + 留档。
export const LEGACY_ENTITY_ATTR_DEFAULTS = { character: 0.15, faction: 0.25 };
export const LEGACY_ATTRS_MIGRATED_AT = 'legacyAttrsMigratedAt';   // meta 一次性标记（幂等闸）
export const LEGACY_ATTRS_PURGED = 'legacyAttrsPurged';            // meta 留档：{ [entityId]: { [attr]: 删掉的值 } }

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

const SOURCE_LABEL = null; // 已废弃（第十三棒：编年源头措辞改写名不写代号，见 chronicleEvents）

const entityName = (world, id) => world.entities.find((e) => e.id === id)?.name || id;   // 编年渲染：id 一律成名（"棋好看"）

// ---- leg24 片4 起的旧账清理（纯函数迁移；幂等；不可变风格与全库一致） ----
// ★ 第二十五棒实机修正（用户实况：切图上"兵力怎么还存在"）：**判据从"整行全等"改成"逐维"**。
//   旧法（整行）：四维**恰好全等**旧默认值才批 → 旧账里绝大多数脏行是**混合行**
//     （一维是模型真值 + 其余几维是引擎默认，形如 阐教 {hardPower .25, office .5, network .25, intel .25}）
//     → 整行判词恒假 → 一条都不清。实测用户那份 613 实体旧账：283 行带四维，**1132 维里 500 维是旧默认值**，
//     旧法一格没动（20:37 备份实证：legacyAttrsMigratedAt=2、留档 330 条，283 行仍在）。
//   现法（逐维）：**每个维度独立判**——该维等于本类别旧默认值 ∧ 书里没写这一维的数值 ∧ 编年里这个实体没有过
//     属性变更 → 删这一维；否则保留。实测同一份旧账：删 500 维（兵力 71 / 权位 63 / 人脉 185 / 耳目 181），
//     保留 632 维，**632 = 书里明写该维 632 + 编年豁免 0 + 非默认值 0**（一条真值都不掉，"宁可漏清不可错清"仍在）。
//
//   两条豁免各自守什么（都不是猜的，是两处可查的事实来源）：
//   ①**书里明写这一维**：`bookEntities[].attrs[k]` 有数就是有数（旧抽取产出 attrs 与 evidence **同键集**，
//     实测 290 条：attrs 键 ∈ evidence 键，故逐维判不需要再借助整条 evidence 串——整条 evidence 会让
//     "有据的那一维"给另外三维当挡箭牌，正是旧法漏清 500 维的机理）。
//   ②**编年里该实体有过属性变更**：那条 `「X」兵力 a→b` 就是这维的来路（真跑出来的数哪怕恰好是 0.25，
//     也不许当假数删掉）——leg24 片4 的属性编年让这条判据成为可能，此前无从分辨。
//
//   只删键、不改形状：attrs 仍是可选 numRecord；非四维键一律不碰（不在本迁移的面）。
const legacyDefaultOf = (kind) => LEGACY_ENTITY_ATTR_DEFAULTS[kind];
const bookNumberFor = (bookByName, name, k) => {
    const b = bookByName.get(name);
    const v = b?.attrs?.[k];
    return typeof v === 'number' && Number.isFinite(v);
};
// 编年里出现过属性变更的实体名（判据②；渲染写名不写代号，故用 name 对齐——与 pushAttrChronicle 同口径）
function chronicledAttrNames(chronicle) {
    const out = new Set();
    for (const c of chronicle || []) {
        const m = /^「(.+?)」(兵力|权位|人脉|耳目) /.exec(String(c?.text || ''));
        if (m) out.add(m[1]);
    }
    return out;
}

/**
 * migrateLegacyAttrs(ssot) → 世界（纯函数，不改输入）
 * 旧账一次性清理：批掉"引擎替模型编的"**逐维**默认值，被批掉的值写进 meta.legacyAttrsPurged 留档，
 * meta.legacyAttrsMigratedAt 记一次性标记（= 当时 tick）保证幂等（重复跑逐字节一致、不覆盖既有留档）。
 * 只删键、不改形状：attrs 仍是可选 numRecord（旧账零扰动原则）。
 */
export function migrateLegacyAttrs(ssot) {
    if (!ssot || typeof ssot !== 'object') return ssot;
    const meta = ssot.meta || {};
    if (meta[LEGACY_ATTRS_MIGRATED_AT] !== undefined) return ssot;   // 已迁过：原样返回（幂等，绝不重扫）
    const bookByName = new Map(((ssot.context?.setting?.frozen?.canon?.bookEntities) || []).map((b) => [b?.name, b]));
    const chronicled = chronicledAttrNames(ssot.chronicle);          // 判据②：编年里有属性变更的实体
    const purged = {};
    let changed = false;
    const entities = (ssot.entities || []).map((e) => {
        const def = legacyDefaultOf(e.kind);
        if (def === undefined || !e.attrs || typeof e.attrs !== 'object') return e;   // 类别无旧默认表 → 不在本迁移的面
        const kept = {};
        const dropped = {};
        for (const [k, v] of Object.entries(e.attrs)) {
            if (!INBORN_ATTR_KEYS.includes(k)) { kept[k] = v; continue; }             // 非四维键不碰
            const fake = v === def && !bookNumberFor(bookByName, e.name, k) && !chronicled.has(e.name);
            if (fake) dropped[k] = v; else kept[k] = v;
        }
        if (!Object.keys(dropped).length) return e;
        purged[e.id] = dropped;                                      // 被删的值不许无声消失（逐键留档）
        changed = true;
        const next = { ...e };
        if (Object.keys(kept).length) next.attrs = kept;
        else delete next.attrs;                                      // 整行清空 → 账面回到"空着就是空着"（片2 口径）
        return next;
    });
    if (!changed) return ssot;                                       // 无可清即不改一字（幂等：结果字节一致）
    return {
        ...ssot,
        entities,
        meta: {
            ...meta,
            [LEGACY_ATTRS_MIGRATED_AT]: meta.tick ?? 0,
            [LEGACY_ATTRS_PURGED]: { ...(meta[LEGACY_ATTRS_PURGED] || {}), ...purged },   // 不覆盖既有留档
        },
    };
}

// 属性中文名（编年措辞用；与 render.js LABELS.attr 同口径——界面侧有自己一份，故此处不跨层 import 渲染层）
const ATTR_LABEL = { hardPower: '兵力', office: '权位', network: '人脉', intel: '耳目' };

// 编年依据短句：cause 是事件/盘算引用（**不是**代号入视线的编年主体，而是"因何"的必要依据），
// 渲染写名不写代号（A-3）：盘算 → 「目标」、事件 → 「标题」、归档事件 → 「标题」；找不到就只留原始 ref（审计价值 > 措辞洁癖）。
function causePhrase(world, cause) {
    if (!cause) return '';
    const a = (world.agendas || []).find((x) => x.id === cause);
    if (a) return `（因盘算「${a.goal}」）`;
    const ev = (world.events || []).find((x) => x.id === cause);
    if (ev) return `（因事件「${ev.title}」）`;
    const m = (world.milestones || []).find((x) => (x.ids || []).includes(cause));
    if (m) return `（因已入纪之事）`;
    return `（依据 ${cause}）`;
}

// 属性落账编年（leg24 片4，补 leg24 片3 漏的账：**每条变更留痕**）：
// 旧法：adjudicate 里所有属性落账路径只 warnings.push（进 simLog，不进编年）——模型把某实体
//   intel 0.5→0.7，账上查不出**何时、因何**（cause 只是提议里的可选字段，没进账）。
// 现法：非玩家实体的属性**实际生效变更**各写一条编年（kind=state——处境驱动的世界变化；
//   与"淡出视野"同章），一行一次 stateChanges（不额外刷屏）；值没真变（静默被拒/无基线负向不收/
//   钳制到同值）一律不写。玩家侧另走 applyPlayerImpact → simLog.playerAffected（红线 1：引擎独占写玩家）。
function pushAttrChronicle(world, chronicle, c, tick, before, after, seqById) {
    const seq = (seqById[c.entity] = (seqById[c.entity] ?? 0) + 1);
    const label = ATTR_LABEL[c.attr] || c.attr;
    chronicle.push({
        id: `ch_${tick}_attr_${c.entity}_${seq}`,
        tick,
        text: `「${entityName(world, c.entity)}」${label} ${before}→${after}${causePhrase(world, c.cause)}`,
        kind: 'state',
    });
}

// ①-② 校验 + 薄裁定（硬结果：**只有属性边界钳制与"静默方自我增强被拒"**）
// leg24 片3（拆引擎裁定）：删除"低分量动作方按分量比折减"——用户拍板「引擎不裁胜负」，
//   而"弱的一方打强的一方伤害打折"就是最直白的裁胜负（还要靠那个没法客观的分数）。现法：提议值与边界钳制说了算。
// K15：hurtByEntity 收集 stateChanges 负向实际生效值（三态败露判据的窗口输入）
function adjudicate(world, step, tick, warnings, gate, hurtByEntity, chronicle) {
    const checked = checkWorldStep(step, world);
    if (!checked.ok) {
        for (const e of checked.errors) warnings.push(`校验拒绝: ${e}`);
        return false;
    }
    const silentSet = new Set(gate.silent);
    const liftedSet = new Set(gate.lifted);
    const attrSeq = {};   // leg24 片4：同 tick 同实体多条属性变更的编年 id 序号（确定性唯一）
    for (const [i, c] of step.stateChanges.entries()) {
        const e = world.entities.find((x) => x.id === c.entity);
        if (!e) continue; // 校验层已保证存在（防御）
        const selfSilent = !c.actor && silentSet.has(c.entity) && !liftedSet.has(c.entity);
        let eff = c.delta;
        if (selfSilent) {
            eff = 0;
            warnings.push(`裁定: 静默方自我增强被拒（${c.entity}.${c.attr} 申请 ${c.delta}）`);
        }
        if (!c.cause) warnings.push(`stateChanges 无 cause: ${c.entity}.${c.attr}（坏账前置，K5）`);
        // leg24 片2（账本换血）：账面**没有**这一维时，把模型这次的提议当作**该维的初值**，
        // 不从 0 起算增量——旧法 `?? 0` 等于引擎替它把未知维定成 0（"不知道"被当成"很弱"，
        // 而且负向提议会被硬边界钳到 0，凭空造出一个"被打到 0"的事实）。
        // 现法：①非负提议 = 该维第一个真值，留痕；②**负向提议（无基线可减）不收，只留痕**——
        //   账面上"没有这一维"时，扣减无从下手；要削弱一个账面无数的实体，得先有一次正向落账。
        if (e.attrs?.[c.attr] === undefined) {
            if (!(eff > 0)) {
                warnings.push(`裁定: 账面无「${c.attr}」，负向提议 ${eff} 无基线可减——不收（先有正向落账才谈削弱；leg24 片2）`);
                continue;
            }
            const init = clamp(eff, ATTR_BOUNDS);
            if (init !== eff) warnings.push(`裁定: 属性硬边界（${c.entity}.${c.attr} 初值 ${eff}→${init}）`);
            e.attrs = e.attrs || {};
            e.attrs[c.attr] = init;
            warnings.push(`裁定: 账面无「${c.attr}」——本次提议记为该维初值 ${init}（不从 0 起算，leg24 片2）`);
            pushAttrChronicle(world, chronicle, c, tick, '账上无数', init, attrSeq);   // leg24 片4：初值落账同样留痕
            continue;
        }
        const before = e.attrs[c.attr];
        const after = clamp(before + eff, ATTR_BOUNDS);
        // 第二十五棒实机修正（用户问「属性硬边界（e_bk_1.hardPower 0→0，申请 -0.2）这是什么」）：
        //   旧法只要"申请值越界"就报裁定——于是**已经在下界 0 的属性**被提议再扣（申请 -0.2）时，
        //   报出一条「0→0」的空裁定：账上一格没变，却在界面上占了"本轮裁定"的位置。
        //   实测（用户当前世界）：属性硬边界裁定 6 条里 **4 条是这种空裁定**，而每轮警告总共才 1-2 条
        //   ⇒ 噪声占了裁定面的一半，把真该看的裁定（真被钳住的那 2 条）挤掉了。
        //   现法：**只有钳制真的改变了落账值时**才叫边界裁定；值本来就等于钳制结果 → 记为"越界提议被忽略"
        //   （仍是如实留痕：模型提过、引擎没收，只是不冒充"裁了个边界"）。
        //   未变值的提议本来就不写编年（见下行 `after !== before` 守卫），两处口径现在一致了。
        if (after === before) {
            warnings.push(`裁定: 越界提议被忽略（${c.entity}.${c.attr} 已是 ${before}，申请 ${before + eff}）`);
            continue;
        }
        if (after !== before + eff) {
            warnings.push(`裁定: 属性硬边界（${c.entity}.${c.attr} ${before}→${after}，申请 ${before + eff}）`);
        }
        e.attrs[c.attr] = after;
        if (after !== before) pushAttrChronicle(world, chronicle, c, tick, before, after, attrSeq);   // leg24 片4：钳到同值不算变更
        if (after < before) hurtByEntity[c.entity] = (hurtByEntity[c.entity] ?? 0) + (after - before);   // K15：负向 δ（实际生效值）
    }
    return true;
}

// ③ 因果挂链：新事件落账为节点，上游指针入 links.up
function hangEvents(world, step, tick) {
    const added = [];
    step.newEvents.forEach((ev, i) => {
        const id = `ev_${tick}_${i + 1}`;
        const node = {
            id,
            title: ev.title,
            source: { ...ev.source },
            position: ev.position,
            ripples: [...(ev.ripples || [])],
            links: { up: ev.source.type === 'ripple' ? [ev.source.ref] : [], down: [] },
            closed: false,
        };
        world.events.push(node);
        added.push(node);
    });
    return added;
}

// 事件源分量解析（K9 影响通道 / K10 注入掩码共用）：
// plot → 盘算属主分量；ripple → 沿链上溯至 plot/state；state → 世界大势常量 1.0（提案：天威以全力论）。
// K20 跨段防御：上溯未命中 events → 查 milestones.ids（归档事件在里程碑内的 id 清单中可达）。
// 不变式：未决事件的链上游必在热池（归档候选要求"无未决下游"）——防御不删，周期零成本。
export function resolveEventSource({ world, ev, weights }) {
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    const findNode = (id) =>
        (world.events || []).find((e) => e.id === id)
        || (world.milestones || []).find((m) => m.ids.includes(id))
        || (world.milestones || []).find((m) => m.id === id)
        || null;
    let cur = ev;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        const type = cur.source?.type;
        if (type === 'plot') {
            const owner = agendaOwner.get(cur.source.ref);
            return { source: owner ?? cur.source.ref, weight: weights[owner] ?? 0 };
        }
        if (type === 'state') return { source: 'world', weight: 1.0 };
        cur = (cur.source?.ref && findNode(cur.source.ref)) || null;
    }
    return { source: 'world', weight: 0 };
}

// K9 影响通道（引擎独占写玩家，红线 1 代码化，玩家档案细案 §3.3）：
// ① 他人 actions[].target === playerId → hardPower −= PLAYER_IMPACT.targeted
// ② 新事件波及玩家 → 已有各 attrs −= PLAYER_IMPACT.rippled
// 确定性、钳制 [0,1]、simLog 审计（playerAffected）。
// leg24 片3：**删掉 min(1, w_src/w_player) 折减系数**——那个数用户已定不要了；影响改用报批定案的固定系数
//   （报批 #4-9：−0.05×min(1,ratio) / −0.02×ratio 里的"ratio"部分随分量退场，系数本身仍在）。
//   理由同 adjudicate：拿两个没法客观的分数相除来决定"玩家被影响多少"，就是引擎在裁强弱。
function applyPlayerImpact(world, gstep, tick, playerId, playerAffected, warnings) {
    const player = world.entities.find((e) => e.id === playerId);
    if (!player) return;
    const hit = (attr, amount, source) => {
        const before = player.attrs[attr] ?? 0;
        const after = clamp(before + amount, ATTR_BOUNDS);
        // 第二十五棒实机修正（与 adjudicate 同一把尺）：值已在边界、影响再往下压 → 记"越界提议被忽略"，
        //   不冒充"裁了个边界"（同族空裁定噪声）。
        //   **但记录照写**：playerAffected 的 `delta: 0` = "世界伸手碰了玩家、被吃住了"——那是模型要看见的
        //   事实（K9 影响通道的审计面），不是噪声，所以这里只动措辞、不动记录。
        if (after === before) {
            warnings.push(`裁定: 越界提议被忽略（${playerId}.${attr} 已是 ${before}，申请 ${before + amount}）`);
        } else if (after !== before + amount) {
            warnings.push(`裁定: 属性硬边界（${playerId}.${attr} ${before}→${after}，申请 ${before + amount}）`);
        }
        player.attrs[attr] = after;
        playerAffected.push({ tick, source, attr, delta: after - before });
    };
    for (const a of gstep.actions) {
        if (a.target !== playerId) continue;
        hit('hardPower', -PLAYER_IMPACT.targeted, a.entity);
    }
    for (const ev of gstep.newEvents) {
        if (!(ev.ripples || []).includes(playerId)) continue;
        const { source } = resolveEventSource({ world, ev, weights: world.weights || {} });
        for (const attr of Object.keys(player.attrs)) hit(attr, -PLAYER_IMPACT.rippled, source);
    }
}

// 执行债（events.closed 关闭路径最小面，2026-09-07 顺手清）+ K19 闭环三型（因果链细案 §3.1 → A-1）：
// ① 源结清：盘算终结/取消 → 其 plot 源事件全部闭环（closedAt 记落账 tick——归档判龄）；
// ② 链尾结清：ripple 事件链头已了结 + 落账 ≥ 涟漪平息窗（CHAIN_SETTLE）+ 无未决下游引用 → 自动闭环
//    （"涟漪平息"——K6 点名窗口随链尾收敛，世界不自锁）；链头语义：plot → 源盘算终结才算数；
//    state → 处境不是驱动马达（波纹靠自身延伸/消亡），恒视为已了结（常驻保留不变）；
// ③ 常驻保留：state 源未决事件永不自动闭环（不在此函数内处理）。
// 闭环留痕只进观棋（不带 eventRef → 不进注入：闭环是历史状态，不是新动向）。
// 完整闭环设计（叶子结清/裁剪/事件产率上限）随因果链强化阶段（dev-process §6 队列）。
const bornTickOf = (ev) => eventBornTick(ev.id);   // 事件 id 契约共享解析器（setting.js；K29 起同源）
const headClosed = (world, ev) => {
    let cur = ev;
    const seen = new Set();
    while (cur && !seen.has(cur)) {
        seen.add(cur);
        if (cur.source?.type === 'plot') {
            const a = (world.agendas || []).find((x) => x.id === cur.source.ref);
            return !!(a && a.closed);
        }
        if (cur.source?.type === 'state') return true;
        cur = (cur.source?.ref && world.events.find((e) => e.id === cur.source.ref)) || null;
    }
    return false;   // 防御：链异常/悬空 → 不结清
};
const hasPendingDownstream = (world, ev) =>
    (world.events || []).some((e) => !e.closed && (e.links?.up || []).includes(ev.id));   // 下游 = links.up 引用方（down 未维护）

function closeEvents(world, closedIds, tick, chronicle) {
    if (closedIds.size) {
        for (const ev of world.events) {
            if (ev.closed || ev.source?.type !== 'plot') continue;
            if (!closedIds.has(ev.source.ref)) continue;
            ev.closed = true;
            ev.closedAt = tick;
            chronicle.push({ id: `ch_${tick}_evc_${ev.id}`, tick, text: `事件「${ev.title}」闭环（源盘算已结算）`, kind: 'major', chainRef: ev.id });
        }
    }
    for (const ev of world.events) {
        if (ev.closed || ev.source?.type !== 'ripple') continue;
        if (!headClosed(world, ev)) continue;
        if (tick - bornTickOf(ev) < CHAIN_SETTLE) continue;
        if (hasPendingDownstream(world, ev)) continue;
        ev.closed = true;
        ev.closedAt = tick;
        chronicle.push({ id: `ch_${tick}_evc2_${ev.id}`, tick, text: `事件「${ev.title}」涟漪平息（链源已了结）`, kind: 'ripple', chainRef: ev.id });
    }
}

// ④ 行动↔盘算一致性（生成器烟雾报警器）：动作实体须有未结在飞盘算

// ---- K14 出生裁判（盘算树细案 §3.2/§3.3 → A-2/A-3/A-4/A-5 前半）----
// gate 已滤静默方提案（A-2）；此处 GC 上限（A-3）→ 落账（§3.1 形状）→ 挂因/委派留痕（§4.4①/②，
// 父 promises 写 = A-5 前半）→ 环检测自动拆（A-4：低分量方断边转伺机 + memory.blocked 写 + 编年留痕）。
// 环检测为防御性实现：parentId 不可变 + K13 校验（parent 源必引已存在在飞盘算）下，同 tick 互指提议
// 在契约层即被拒，环仅可能来自历史/手工错账（记台账 K14 行）——防御不删，周期零成本。

// 环检测（§3.3）：从新节点沿 parentId 链上溯，路径上出现重复节点即环；返回环上成员数组（含重复起点）。
function findCycle(start, agendas) {
    const byId = new Map(agendas.map((a) => [a.id, a]));
    const path = [];
    const seen = new Set();
    let cur = start;
    while (cur) {
        if (seen.has(cur.id)) {
            return path.slice(path.findIndex((a) => a.id === cur.id));
        }
        seen.add(cur.id);
        path.push(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return null;
}

// 自动拆环（ANCHOR §4.1 / 细案 §3.3 → A-4）：环内挑一方断其与父的边转独立。
// leg24 片3：**排序判据由"分量升序"改为结构序**——①盘算年纪：turnsAlive 小者（较新）先让
//   ②再比 progress 浅者先让 ③再比 id 序（确定性兜底）。原判据吃那个已被拍板删除的分数。
// blocked 记"拆环让路"；编年留痕。
function breakCycle(cycle, world, tick, chronicle) {
    const age = (a) => (typeof a.memory?.turnsAlive === 'number' ? a.memory.turnsAlive : 0);
    const sorted = [...cycle].sort((x, y) => {
        if (age(x) !== age(y)) return age(x) - age(y);
        if (x.progress !== y.progress) return x.progress - y.progress;
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    });
    const victim = sorted[0];
    delete victim.parentId;
    victim.memory.blocked.push('拆环让路');
    chronicle.push({
        id: `ch_${tick}_cyc_${victim.id}`,
        tick,
        text: `拆环：${entityName(world, victim.owner)} 让路转伺机（较新者先让）`,
        kind: victim.visibility === 'concealed' ? 'shade' : 'scheme',
    });
}

export function spawnAgendas(world, gstep, tick, warnings, chronicle) {
    const spawned = [];
    for (const na of gstep.newAgendas || []) {
        const goal = na.goal;
        const owner = na.entity;
        const openNow = (world.agendas || []).filter((a) => !a.closed).length + spawned.length;
        const topNow = (world.agendas || []).filter((a) => !a.closed && !a.parentId).length
            + spawned.filter((a) => !a.parentId).length;
        // GC 上限（A-3）：超限拒建 + 警告，世界其余照常（超限不新建，§4.3 语义之一）
        if (spawned.length >= AGENDA_CAPS.perTick) {
            warnings.push(`裁定: 盘算大厦顶（每 tick 新生 ≤${AGENDA_CAPS.perTick}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        if (openNow >= AGENDA_CAPS.open) {
            warnings.push(`裁定: 盘算大厦顶（在飞全局 ≤${AGENDA_CAPS.open}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        if (na.source.type !== 'parent' && topNow >= AGENDA_CAPS.topLevel) {
            warnings.push(`裁定: 盘算大厦顶（顶层 ≤${AGENDA_CAPS.topLevel}）：${entityName(world, owner)} 提议「${goal}」被拒`);
            continue;
        }
        // 落账（§3.1：与既有 agenda 同形状 + 可选 parentId；id = a_<tick>_<n>；maxSteps 缺省 4）
        const agenda = {
            id: `a_${tick}_${spawned.length + 1}`,
            owner,
            goal,
            stage: na.stage || AGENDA_STAGE_FALLBACK,
            visibility: na.visibility,
            maxSteps: na.maxSteps ?? 4,
            progress: 0,
            memory: { promises: [], done: [], blocked: [], turnsAlive: 0 },
        };
        if (na.source.type === 'parent') agenda.parentId = na.source.ref;
        world.agendas.push(agenda);
        // 环检测（§3.3）：每次创建时沿父链上溯，触到自己即环（确定性）；成环不拒绝整件事——自动拆
        const cycle = findCycle(agenda, world.agendas);
        if (cycle) breakCycle(cycle, world, tick, chronicle);
        spawned.push(agenda);
        // 挂因留痕（§4.4①/②，措辞按细案 §3.2 三型）
        if (na.source.type === 'state') {
            chronicle.push({ id: `ch_${tick}_ag_${agenda.id}`, tick, text: `由处境而生：${entityName(world, owner)} 生「${goal}」`, kind: agenda.visibility === 'concealed' ? 'shade' : 'scheme' });
        } else if (na.source.type === 'event') {
            const ev = (world.events || []).find((e) => e.id === na.source.ref);
            chronicle.push({ id: `ch_${tick}_ag_${agenda.id}`, tick, text: `因事而生：${entityName(world, owner)} 由「${ev?.title ?? na.source.ref}」生「${goal}」`, kind: agenda.visibility === 'concealed' ? 'shade' : 'scheme' });
        } else {
            const parent = world.agendas.find((x) => x.id === agenda.parentId);
            parent.memory.promises.push(agenda.id);   // A-5 前半：委派承诺写入（清 promises 写入执行债）
            // K21 暗处渲染（因果链细案 §3.4 → A-4）：concealed 委派不留痕——数据照写（父 promises 属账），编年抑制（暗处不曝光）
            if (agenda.visibility !== 'concealed') {
                chronicle.push({
                    id: `ch_${tick}_ag_${agenda.id}`,
                    tick,
                    text: `委派：${entityName(world, parent.owner)} 拆大给小——「${goal}」（授 ${entityName(world, owner)}）`,
                    kind: 'scheme',
                });
            }
        }
    }
    return spawned;
}
function checkConsistency(world, step, warnings) {
    const openOwners = new Set((world.agendas || []).filter((a) => !a.closed).map((a) => a.owner));
    for (const a of step.actions) {
        if (!openOwners.has(a.entity)) {
            warnings.push(`行动↔盘算不一致: ${a.entity} 无在飞盘算仍然行动（烟雾报警）`);
        }
    }
}

// ⑤ 分量重算（K3：真公式 × 静止衰减因子；衰减作用于分量缓存不改属性——动量分离，长跑 §2.3）
function recomputeWeights(world, tick) {
    const tension = world.context?.tension ?? 0.5;
    world.weights = {};
    for (const e of world.entities) {
        const idle = tick - (e.lastActiveTick ?? 0);   // 旧夹具无历史按 tick 计；宽限期（人物 8/势力 20）内因子恒 1
        world.weights[e.id] = computeWeightAtTick(e.attrs, e.kind, tension, idle);
    }
    return world.weights;
}

// K22 取消通道裁决（因果链细案 §3.5 → A-5；C3 拍板落地——生命周期六态补全，与出生对称）：
// 模型只有提议权（gate 已滤静默方，K18）；引擎无条件裁决（轻量版）——closed + memory.blocked 记"放弃"
// + 编年措辞精确 + 在飞子断链转独立（不悬挂已死之父，K15 托孤同哲学）+ plot 源事件联闭（交 closeEvents）。
// 取消先于推进：同 tick 的被取消者推进落入既有 closed 拦截（世界不重唱）。不记兑现/败露/达成（取消是独立结局）。
function applyAgendaCancels(world, gstep, tick, chronicle) {
    const cancelled = new Set();
    for (const ac of gstep.agendaCancels || []) {
        const a = world.agendas.find((x) => x.id === ac.agendaId);
        if (!a || a.closed) continue;   // 校验层已保证在飞（防御）
        a.closed = true;
        a.memory.blocked.push(`t${tick}: 放弃（${ac.reason || '未言明'}）`);
        cancelled.add(a.id);
        const owner = entityName(world, a.owner);
        chronicle.push({
            id: `ch_${tick}_can_${a.id}`,
            tick,
            text: `盘算「${a.goal}」取消（${owner}）：${ac.reason || '未言明理由'}`,
            kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
        });
        const sons = world.agendas.filter((x) => x.parentId === a.id && !x.closed);
        if (sons.length) {
            for (const s of sons) delete s.parentId;   // 诸子断链转独立（事业未竟，不悬挂已死之父）
            chronicle.push({
                id: `ch_${tick}_canS_${a.id}`,
                tick,
                text: `取消后遗留子盘算 ${sons.length} 项转独立（事业未竟）`,
                kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
            });
        }
    }
    return cancelled;
}

// ⑥ 落账：盘算推进 + 生命周期（返回本 tick 新结算的盘算 id 集——终结产果联闭用）
function applyAgendaAdvances(world, step, tick, chronicle, warnings) {
    const closedIds = new Set();
    for (const ad of step.agendaAdvances) {
        const a = world.agendas.find((x) => x.id === ad.agendaId);
        if (!a) continue;   // 校验层已保证存在
        if (a.closed) {
            // 满步重播拦截（活档实测发现）：已结算盘算的推进 → 警告 + 跳过，世界不重唱"达成"
            warnings.push(`盘算推进被拒: ${ad.agendaId}（${a.goal}）已结算`);
            continue;
        }
        a.progress += 1;
        if (ad.stage) a.stage = ad.stage;
        a.memory.done.push(`t${tick}: ${ad.step}`);
        a.memory.turnsAlive += 1;
        // K21 暗处渲染（因果链细案 §3.4 → A-4）：concealed 推进不留痕——memory.done 属账照写，动态流条目抑制（暗处合法）
        if (a.visibility !== 'concealed') {
            chronicle.push({ id: `ch_${tick}_adv_${ad.agendaId}`, tick, text: `盘算「${a.goal}」推进：${ad.step}`, kind: 'scheme' });
        }
        if (a.progress >= a.maxSteps) {
            a.closed = true;
            closedIds.add(a.id);
            // K15 满步三态（细案 §3.4 → A-6；模型无直接终结通道，结局全归引擎）：
            // 判序 = 变形（有在飞子 → 事业移交诸子，断链转独立）→ 败露（近 2 tick 负 δ ≥0.05 提案）→ 达成。
            // 判序决策（记台账）：托孤优先——任何有在飞子的终结必先断链，子盘算不悬挂已死之父；
            // 败露/达成只在无子时按伤害窗口裁决；三种终止都终结产果（§4.4④）。
            const sons = world.agendas.filter((x) => x.parentId === a.id && !x.closed);
            let verdict = '达成';
            if (sons.length) {
                verdict = '变形';
                for (const s of sons) delete s.parentId;   // 诸子断链转独立（树在结算中演化）
                chronicle.push({
                    id: `ch_${tick}_fin_${a.id}`,
                    tick,
                    text: `盘算「${a.goal}」满步结算：变形，事业移交诸子（${sons.length} 项断链转独立）`,
                    kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
                });
            } else {
                const owner = world.entities.find((x) => x.id === a.owner);
                const hw = owner?.hurtWindow || [0, 0];
                if (Math.abs((hw[0] ?? 0) + (hw[1] ?? 0)) >= VERDICT_HURT_THRESHOLD) {
                    verdict = '败露';
                    chronicle.push({
                        id: `ch_${tick}_fin_${a.id}`,
                        tick,
                        text: `盘算「${a.goal}」满步结算：败露——功败垂成（${entityName(world, a.owner)}）`,
                        kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
                    });
                } else {
                    chronicle.push({
                        id: `ch_${tick}_fin_${a.id}`,
                        tick,
                        text: `盘算「${a.goal}」满步结算：达成（终结产果 §4.4④）`,
                        kind: a.visibility === 'concealed' ? 'shade' : 'scheme',
                    });
                }
            }
            // K14 兑现落痕（细案 §3.3 → A-5 后半）：仅"达成"态兑现——败露/变形不记（K15 三态后收紧）
            if (verdict === '达成' && a.parentId) {
                const parent = world.agendas.find((x) => x.id === a.parentId);
                if (parent) {
                    parent.memory.done.push(`兑现：${a.goal}`);
                    // K21 暗处渲染：concealed 兑现不留痕——父 done 属账照写，编年抑制（子达成是暗处的成果，不上桌）
                    if (a.visibility !== 'concealed') {
                        chronicle.push({
                            id: `ch_${tick}_ful_${a.id}`,
                            tick,
                            text: `兑现：${entityName(world, parent.owner)} 收「${a.goal}」之果`,
                            kind: 'scheme',
                        });
                    }
                }
            }
        }
    }
    return closedIds;
}

// K20 档案摘要化（因果链细案 §3.3 → A-3）：闭环满热窗且无未决下游的事件，按出生 tick 段压成里程碑。
// 里程碑 = 引擎结构摘要（T3-D1 拍板：确定性、零调用、链上节点）：span/counts/titles/ids 全量保真（"任取归档事件可回溯"），
// 段外指针重指里程碑（links.up/down 修复——割断的是热池文本，不是链条）；里程碑不进动态流不进模型输入（温层）。
// 历史闭环（无 closedAt）视为可直接归档——旧账优先清。
function archiveClosedEvents(world, tick) {
    const { hotWindow, milestoneEvery } = ARCHIVE;
    const bySeg = new Map();
    for (const ev of world.events) {
        if (!ev.closed) continue;
        if (ev.closedAt != null && tick - ev.closedAt < hotWindow) continue;
        if (hasPendingDownstream(world, ev)) continue;   // 整链结清才归档（指针跨段不悬）
        const born = bornTickOf(ev);
        const seg = Math.floor((born - 1) / milestoneEvery);   // 出生段：t1-10 段 0，t11-20 段 1，…
        if (!bySeg.has(seg)) bySeg.set(seg, []);
        bySeg.get(seg).push(ev);
    }
    if (!bySeg.size) return;
    const segMax = Math.max(...bySeg.keys());
    for (let seg = 0; seg <= segMax; seg++) {
        const segEvs = bySeg.get(seg);
        if (!segEvs?.length) continue;
        const id = `m_${(seg + 1) * milestoneEvery}`;
        const existing = (world.milestones || []).find((m) => m.id === id);
        const m = existing || {
            id,
            span: { from: seg * milestoneEvery + 1, to: (seg + 1) * milestoneEvery },
            counts: { events: 0 },
            titles: [],
            ids: [],
            links: { up: [], down: [] },
        };
        for (const ev of segEvs) {
            m.counts.events += 1;
            m.titles.push(ev.title);
            m.ids.push(ev.id);
            for (const upId of ev.links?.up || []) {
                if (bornTickOf({ id: upId }) > -Infinity && Math.floor((bornTickOf({ id: upId }) - 1) / milestoneEvery) === seg) continue;   // 段内引用不进 up
                if (!m.links.up.includes(upId)) m.links.up.push(upId);
            }
        }
        world.events = world.events.filter((e) => !m.ids.includes(e.id));
        // 段外遗留节点（事件/里程碑）up 指针重指里程碑（引用修复——链条不断）
        for (const ev of world.events) {
            for (let i = 0; i < (ev.links?.up || []).length; i++) {
                if (m.ids.includes(ev.links.up[i])) {
                    ev.links.up[i] = m.id;
                    if (!m.links.down.includes(ev.id)) m.links.down.push(ev.id);
                }
            }
        }
        for (const om of world.milestones || []) {
            if (om === m) continue;
            for (let i = 0; i < (om.links?.up || []).length; i++) {
                if (m.ids.includes(om.links.up[i])) {
                    om.links.up[i] = m.id;
                    if (!m.links.down.includes(om.id)) m.links.down.push(om.id);
                }
            }
        }
        if (!existing) (world.milestones = world.milestones || []).push(m);
    }
}

// ⑦ 编年：事件条目（可读、带因果；实体 id 一律渲染成名——"棋好看"。
//   第十三棒：源头措辞写名/题/目标——由盘算「目标」而生 / 由世界处境而生 / 沿「上游事件标题」而来；
//   代号（ev_/a_/e_）绝不入玩家视线（A-3）；历史行保持原样，只作用于新落账行。）
function eventSourcePhrase(world, ev) {
    if (ev.source.type === 'plot') {
        const a = (world.agendas || []).find((x) => x.id === ev.source.ref);
        return a ? `由盘算「${a.goal}」而生` : '由盘算而生';
    }
    if (ev.source.type === 'ripple') {
        const up = (world.events || []).find((x) => x.id === ev.source.ref);
        return up ? `沿「${up.title}」而来` : '沿旧事而来';
    }
    return '由世界处境而生';
}
function chronicleEvents(world, step, tick, chronicle) {
    const name = (id) => world.entities.find((e) => e.id === id)?.name || id;
    step.newEvents.forEach((ev, i) => {
        const ripples = ev.ripples?.length ? `，牵动 ${ev.ripples.map(name).join('、')}` : '';
        chronicle.push({
            id: `ch_${tick}_ev_${i + 1}`,
            tick,
            text: `事件「${ev.title}」——${eventSourcePhrase(world, ev)}，事发 ${ev.position}${ripples}`,
            kind: ev.source.type === 'plot' ? 'major' : ev.source.type === 'ripple' ? 'ripple' : 'state',
            eventRef: `ev_${tick}_${i + 1}`,
        });
    });
}

// ⑧ GC/度量（切片版）：simLog 记账（长跑细案 §2.5 四字段；K2 起含门控审计；K9 起含 playerAffected 影响审计）。
// K38 观测台（敲定稿 I 条）：entry 增 proposals（提议条数=拒签率分母）/ rejected（静默滤除+裁定拒=分子）——
//   只在有值时写（旧账零扰动；观测台对缺字段走 warnings 兜底口径）。
function recordMetrics(world, tick, packTokens, calls, warnings, chronicle, gate, playerAffected = [], proposals = 0, rejected = 0) {
    world.meta.simLog = world.meta.simLog || [];
    const entry = {
        tick,
        packTokens,
        ssotBytes: JSON.stringify(world).length,
        events: world.events.length,
        chronicle: chronicle.length,
        calls,
        warnings: [...warnings],
    };
    if (gate) {
        entry.silent = [...gate.silent];
        entry.lifted = [...gate.lifted];
        entry.silentDropped = { ...gate.droppedCounts };
    }
    if (playerAffected.length) entry.playerAffected = [...playerAffected];
    if (proposals > 0) entry.proposals = proposals;
    if (rejected > 0) entry.rejected = rejected;
    world.meta.simLog.push(entry);
}

// K37 生通道②落账（细案 §3.7 → A-10）：入局提议——单轮 ≤1 拒超限；
// 落账（id=e_<tick>_<n>；kind 缺省 character；**attrs 只在模型提议时落，没提议就空着**——leg24 片2）
// + 编年「XX 入局」（kind major=大事）
function spawnEntities(world, gstep, tick, warnings, chronicle) {
    const born = [];
    for (const ne of gstep.newEntities || []) {
        if (born.length >= ENTITY_BIRTH_PER_TICK) {
            warnings.push(`裁定: 入局限额（每 tick 新生 ≤${ENTITY_BIRTH_PER_TICK}）：「${ne.name}」被拒`);
            continue;
        }
        if (world.entities.some((e) => e.name === ne.name)) continue;   // 重名拒（check 已查，防御）
        const kind = ne.kind || 'character';
        // leg24 片2：**不再按 kind 预填四维**——没提议就是没数据（空着就是空着），
        // 引擎只在模型真提议了数值时钳制落账（有据才留痕）。
        const proposed = ne.attrs && typeof ne.attrs === 'object' ? ne.attrs : {};
        const attrs = {};
        for (const [k, v] of Object.entries(proposed)) {
            const clamped = clamp(v, ATTR_BOUNDS);
            if (clamped !== v) warnings.push(`裁定: 入局属性钳制（${ne.name}.${k} ${v}→${clamped}）`);
            attrs[k] = clamped;
        }
        const ent = {
            id: `e_${tick}_${born.length + 1}`,
            kind,
            name: ne.name,
            location: ne.location,
            attrs,
            lastActiveTick: tick,
        };
        // K45/C7（用户 2026-09-09 拍板：提示词约束为主）：newEntities 可带 parent=所属势力名——目标在册且为势力且未灭才落；否则弃关系+警告（照常入局）
        const parent = typeof ne.parent === 'string' && ne.parent.trim() ? ne.parent.trim() : null;
        if (parent) {
            const target = world.entities.find((t) => t.name === parent);
            if (target && target.kind === 'faction' && (target.status || 'active') !== 'dead') ent.parent = parent;
            else warnings.push(`裁定: 「${ne.name}」的从属「${parent}」不在册/非势力/已灭——弃关系（照常入局）`);
        }
        world.entities.push(ent);
        born.push(ent);
        const why = ne.source.type === 'event'
            ? `因事件「${(world.events || []).find((e) => e.id === ne.source.ref)?.title ?? ''}」而生`
            : ne.source.type === 'book' ? '名载书中' : '屡被提及，声名鹊起';
        chronicle.push({ id: `ch_${tick}_ent_${ent.id}`, tick, text: `「${ent.name}」入局（${why}）`, kind: 'major' });
    }
    return born;
}

// K37 对话依据册（细案 §3.7 → A-10 通道③）：落子提取对象命中即记账（meta.dialogueBook，随背景化清理）；
// "白小娥反复被点名"成为可溯源的 dialogueFact 依据（extract 双名单的引擎侧落账）
function bookDialogue(world, moveFact, tick) {
    const obj = moveFact?.object;
    if (!obj || typeof obj !== 'string') return;
    world.meta.dialogueBook = world.meta.dialogueBook || {};
    const rec = world.meta.dialogueBook[obj] || { count: 0, lastTick: 0 };
    rec.count += 1;
    rec.lastTick = tick;
    world.meta.dialogueBook[obj] = rec;
}

// K37 灭通道（细案 §3.7 → A-11）：覆灭提议 → 引擎复核——source.ref 真实落账且指向已了结
// （agenda closed / 事件闭环或已归档入纪）+ 目标无在飞盘算子树 → status=dead（终局不复归）+ 编年「覆灭」；
// 打崩 ≠ 灭（attrs 归零仍是合法客体，K7 万法阁案例回归）；玩家不可灭（check 已拒，防御）
function applyEntityFates(world, gstep, tick, warnings, chronicle) {
    for (const f of gstep.entityFates || []) {
        const ent = world.entities.find((e) => e.id === f.entity);
        if (!ent || (ent.status || 'active') === 'dead') continue;   // check 已查（防御）
        if ((world.agendas || []).some((a) => a.owner === ent.id && !a.closed)) {
            warnings.push(`裁定: 覆灭复核拒绝——「${ent.name}」仍有在飞盘算（先了结，再言灭）`);
            continue;
        }
        if (f.source.type === 'agenda') {
            const ag = world.agendas.find((a) => a.id === f.source.ref);
            if (!ag || !ag.closed) { warnings.push(`裁定: 覆灭复核拒绝——源盘算「${f.source.ref}」未真实终结`); continue; }
        } else {
            const hot = world.events.find((e) => e.id === f.source.ref);
            const archived = (world.milestones || []).some((m) => (m.ids || []).includes(f.source.ref));
            if (!hot && !archived) { warnings.push(`裁定: 覆灭复核拒绝——源事件「${f.source.ref}」不在账`); continue; }
            if (hot && !hot.closed) { warnings.push(`裁定: 覆灭复核拒绝——源事件「${f.source.ref}」未了结（尘埃未定）`); continue; }
        }
        ent.status = 'dead';
        chronicle.push({
            id: `ch_${tick}_fate_${ent.id}`,
            tick,
            text: `「${ent.name}」覆灭${f.reason ? `（${f.reason}）` : ''}`,
            kind: 'major',
        });
    }
}

// K37 复归（细案 §3.7 → A-12）：被本 tick 落账事件点名（ripples 命中）→ retired 自动升回 active；
// 一条确定性规则不发明状态机；dead 终局不复归；编年「复归」一笔（kind ripple——被波及点名而起的反应）
function reactivateNamed(world, events, tick, chronicle) {
    const named = new Set();
    for (const ev of events || []) for (const r of ev.ripples || []) named.add(r);
    if (!named.size) return;
    for (const e of world.entities) {
        if (e.status !== 'retired' || !named.has(e.id)) continue;
        e.status = 'active';
        e.lastActiveTick = tick;
        const ev = (events || []).find((x) => (x.ripples || []).includes(e.id));
        chronicle.push({
            id: `ch_${tick}_rev_${e.id}`,
            tick,
            text: `「${e.name}」复归（被「${ev?.title ?? '事件'}」点名）`,
            kind: 'ripple',
        });
    }
}

// K37 背景化 GC（细案 §3.7 → A-12）：扫描轮（每 ENTITY_GC_SCAN_TICKS）——条件=无在飞盘算 + 无未决事件/链引用
// + 连续 ENTITY_IDLE_RETIRE_TICKS 轮未露面（**片3 起不再看分量**）→ status=retired
// （名录/指针全保留；编年「淡出」一笔，kind state——处境驱动）；依据册随退休清理（其名消账）。
// K45（full-roster-lens-spec C3 拍板）：**超席强制退已废除**（资格=在册，镜头管进出——用户 2026-09-09 拍板）——
// 闲置退休仍保留：长期没戏份的实体退二线（**仍在册**、可被点名复归），这是"镜头进出"的引擎侧实现。
// leg24 片3：判据里的分量地板已删（那个数用户已定不要）。
//   ⚠️ 两条边界（实测踩过，留档）：① **"没露过面"≠"久未露面"**——`lastActiveTick` 缺失 = 从没出过手
//   （书里读进来的名号就是这种）；若把它当 t0，新世界 t20 会把全册实体一次性退休（实测 K47 全量棋盘
//   active 346→0：镜头空转、应答机制失效）。故保留"必须有过活跃记录"这一条——退的是"曾经在场、
//   如今久未现身"的人，不是"还没上场"的人。② 上一版注释里"从没出过手也在 t20 退二线是设计要的行为"
//   是**错的判断**，被 K47 与重量冒烟两处读数当场证伪。
function retireInactive(world, tick, warnings, chronicle) {
    const canRetire = (e) => !(world.agendas || []).some((a) => a.owner === e.id && !a.closed)
        && !(world.events || []).some((ev) => !ev.closed && (ev.ripples || []).includes(e.id));
    if (tick % ENTITY_GC_SCAN_TICKS !== 0) return;
    for (const e of world.entities) {
        if (e.status && e.status !== 'active') continue;
        if (!canRetire(e)) continue;
        if (typeof e.lastActiveTick !== 'number' || tick - e.lastActiveTick < ENTITY_IDLE_RETIRE_TICKS) continue;
        e.status = 'retired';
        if (world.meta?.dialogueBook) delete world.meta.dialogueBook[e.name];
        chronicle.push({ id: `ch_${tick}_ret_${e.id}`, tick, text: `「${e.name}」淡出视野（久未现身）`, kind: 'state' });
    }
}

export function settleTick({ ssot, step, moveFact, calls = 1 }) {
    // 校验先行：不合格则世界如实不动（诚实不落账），tick 不推进
    const pre = checkWorldStep(step, ssot);
    if (!pre.ok) {
        return { ok: false, ssot, stage: { warnings: pre.errors.map((e) => `校验拒绝: ${e}`), chronicle: [] } };
    }

    const world = structuredClone(ssot);
    const warnings = [];
    const chronicle = [];
    const tick = world.meta.tick + 1;
    world.meta.tick = tick;
    const playerId = world.context?.playerId ?? null;   // K8/K9：玩家棋子标注（红线 1 代码化就位）
    const playerAffected = [];                          // K9：影响通道审计
    bookDialogue(world, moveFact, tick);                // K37：对话依据册记账（moveFact.object 命中）

    // ②' 主动作权门控（K2，细案 §3.2）：校验之后、裁定之前。滤除静默方主动作——不落账、不编年、不注入（双面无痕）；被点名可应答。
    const gate = gateWorldStep(step, ssot, moveFact);
    const gstep = gate.step;
    // K14 出生裁判（盘算树细案 §3.2 落点：gate 之后、裁定之前）：GC 上限 → 落账 → 挂因/委派留痕 → 环检测自动拆
    const spawned = spawnAgendas(world, gstep, tick, warnings, chronicle);

    const hurtByEntity = {};
    if (!adjudicate(world, gstep, tick, warnings, gate, hurtByEntity, chronicle)) {
        // 不可达（check 已过），防御
        return { ok: false, ssot, stage: { warnings, chronicle } };
    }
    const born = spawnEntities(world, gstep, tick, warnings, chronicle);   // K37：入局提议落账（校验先行——裁定后再落账，重名自反不误伤）
    // K15 三态判据窗口（细案 §3.4）：实体粒度近 2 tick 负向 δ（stateChanges 实际生效值）；
    // 窗口 [本 tick, 上一 tick]；惰性写——全 0 删字段（旧夹具/黄金锚点零扰动）。
    for (const e of world.entities) {
        const cur = hurtByEntity[e.id] ?? 0;
        if (cur !== 0 || e.hurtWindow) {
            const next = [cur, e.hurtWindow?.[0] ?? 0];
            if (next[0] === 0 && next[1] === 0) delete e.hurtWindow;
            else e.hurtWindow = next;
        }
    }
    // K19 事件产率上限（因果链细案 §3.2 → A-2）：按提议序保留前 ≤N，超限拒建 + 警告（"事件洪峰"——与盘算大厦顶
    // 同哲学：双面无痕于世界，留痕于 simLog）；门控后、影响通道前——被拒不涉影响/挂链/编年
    if (gstep.newEvents.length > EVENT_CAPS.perTick) {
        const kept = gstep.newEvents.slice(0, EVENT_CAPS.perTick);
        for (const ev of gstep.newEvents.slice(EVENT_CAPS.perTick)) {
            warnings.push(`裁定: 事件洪峰（每 tick ≤${EVENT_CAPS.perTick}）：「${ev.title}」被拒`);
        }
        gstep.newEvents = kept;
    }
    const events = hangEvents(world, gstep, tick);
    // K9 影响通道：引擎独占写玩家（他人 targeting / 新事件波及 → 分量比影响，落账在重算前——分量当轮反映）
    if (playerId) applyPlayerImpact(world, gstep, tick, playerId, playerAffected, warnings);
    checkConsistency(world, gstep, warnings);
    // K3 活跃记账：落账主动作方（actions/盘算推进/plot 事件属主）记 lastActiveTick；被打击/被波及的客体不计
    // K11 玩家同尺：有落子轮（moveFact.verb 非空）= active；OOC/静默轮不记 → 站桩权力照萎缩（长跑 §2.3）
    const agendaOwner = new Map((world.agendas || []).map((a) => [a.id, a.owner]));
    const activeIds = new Set();
    for (const a of gstep.actions) activeIds.add(a.entity);
    for (const ad of gstep.agendaAdvances) { const o = agendaOwner.get(ad.agendaId); if (o) activeIds.add(o); }
    for (const ev of gstep.newEvents) { if (ev.source?.type === 'plot') { const o = agendaOwner.get(ev.source.ref); if (o) activeIds.add(o); } }
    for (const na of spawned) activeIds.add(na.owner);   // K14：提议并落账 = 活跃（与 gate 滤除语义对称——静默方提议被滤=不活跃）
    for (const e of born) activeIds.add(e.id);           // K37：入局 = 活跃（lastActiveTick 落账）
    if (playerId && moveFact?.verb) activeIds.add(playerId);
    for (const e of world.entities) { if (activeIds.has(e.id)) e.lastActiveTick = tick; }
    recomputeWeights(world, tick);
    updateTensionIntensity(world, tick);   // K29 张力强度（细案 T3：事件频次×分量比×衰减；引擎确定性计算，模型不拍）
    const cancelledIds = applyAgendaCancels(world, gstep, tick, chronicle);   // K22 取消裁决（细案 §3.5 → A-5；先于推进——被取消者当 tick 推进落 closed 拦截）
    const closedIds = applyAgendaAdvances(world, gstep, tick, chronicle, warnings);
    for (const id of cancelledIds) closedIds.add(id);   // 取消集并入联闭（取消 = 终结产果路径之一）
    pushTidePeak(world, closedIds, tick);   // K29：盘算浪尖派生（细案 §3.6②——顶层终结/取消 → derivedFrom 浪尖项，A-5 两来源之一）
    closeEvents(world, closedIds, tick, chronicle);   // 闭环三型：源结清（K9 执行债）+ 链尾结清（K19）+ 取消联闭（K22）
    applyEntityFates(world, gstep, tick, warnings, chronicle);   // K37 灭通道：覆灭复核落账（在闭环后——尘埃落定再言灭）
    pulseEntropy(world, tick, chronicle);   // K27 熵泵（细案 §3.5 → A-6）：环境推演器每 ENV_TICK 一步；越阈落状态源事件；恢复闭环
    reactivateNamed(world, events, tick, chronicle);   // K37 复归：本 tick 落账事件点名 → retired 升回 active
    retireInactive(world, tick, warnings, chronicle);  // K37 背景化 GC：扫描轮条件退休 + 超席位强制（守卫）
    chronicleEvents(world, gstep, tick, chronicle);
    world.chronicle = [...world.chronicle, ...chronicle];   // 编年落账（推进留痕 + 事件条目）
    archiveClosedEvents(world, tick);   // K20 档案摘要化（细案 §3.3 → A-3）：闭环满热窗 + 整链结清 → 里程碑温层（零编年零注入）

    const pack = buildEvolutionPack(world, moveFact || null);
    // K38 观测台：拒签率分子/分母记账（铁律 8：先有数，后说话）
    const proposals = ['actions', 'newEvents', 'agendaAdvances', 'stateChanges', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates']
        .reduce((n, k) => n + (step[k]?.length ?? 0), 0);
    const rejected = Object.values(gate.droppedCounts).reduce((a, b) => a + b, 0)
        + warnings.filter((w) => (w.startsWith('裁定:') || w.startsWith('校验拒绝:')) && !w.includes('入局属性钳制')).length;
    recordMetrics(world, tick, pack.estTokens, calls, warnings, chronicle, gate, playerAffected, proposals, rejected);

    return { ok: true, ssot: world, stage: { chronicle, warnings, events } };
}
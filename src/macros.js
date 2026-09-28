// story-world-v2/src/macros.js
// ★★★leg148：**酒馆的宏不该变成世界里的人**（引擎层纯函数 · 零 DOM/零 IO · 零依赖）。
//
// 【这一格治的是什么病】（社区用户报的，2026-09-28）
//   世界书作者写 `{{user}}` 是惯例（那是"玩家"的占位符）。酒馆自己会在组装提示词时把它
//   换成人设名（`name1`）——**但那是酒馆的活儿，我们绕过了酒馆、直接读条目原文**。
//   于是那个宏**原封不动**进了抽取提示词，模型看见书里有个叫 `{{user}}` 的人，
//   **忠实地把它抽成了一条角色**（它不是乱编，是照抄我们递过去的原文）。
//
//   而**认领玩家棋子**那把尺子只比名字相不相等（`web/index.js` 的 `namePlayerPiece`）⇒
//   「{{user}}」与「怪璃」永远不相等 ⇒ 认领不了 ⇒ 这枚实体留在账上当棋手 ⇒
//   **账上变成"两个你"**（与用户当年那句「又把主角演了」同一形状）。
//
// 【为什么必须在这一层挡，别处挡不住】（三道关口本来都是空的）
//   ① **替换**：全仓搜 `{{user}}`/`{{char}}` ＝ 0 处 —— 我们从没替换过（本模块第一次做）；
//   ② **契约**：`ssot.schema.js` 的名字那一格只有 `minLength:1` ⇒ `{{user}}` 是**合法名字**；
//   ③ **出处闸**：`{{user}}` **真在书里** ⇒ 放行 —— 它拦的是"编造"，不拦"抄了个宏"。
//   ★③这一条不是我推的，是**本仓自己早就写下的**（`src/abstract.js:793` 那句为「键名」写的
//     注释）：「排除模型把整句话当键、或把 `{}`/`<>` 这类占位符当键（占位符那一条与 §D 的
//     `<user>` 同族：**它真的在原文里，所以出处闸抓不住它**）」。
//     ⇒ **上次加在键名上，这次漏在实体名上。** 本模块把那一格补上。
//
// 【口径：空着就是空着】（红线 §2.2 第 2 条）
//   · 宏**能换成真名就换**（人设名/角色名**本来就在读**：`web/index.js` 的 `getCtx()?.name1`）；
//   · **读不到真名 ⇒ 只挡、不猜**：换成 `PLAYER_NAME_UNKNOWN` 那个记号（"这里本来是个玩家名，
//     但读不到"），于是**下游那条形状闸必然挡住它**（记号本身是纯占位符形状）。
//     ⇒ 结果：**绝不会替它编一个名字**，也**绝不会让宏形状残留**。
//
// 【零漂移】没有宏的原文**逐字节不动**（`substituteMacros` 命中才换）⇒ 旧书、旧世界不受惊动。

/** 一个纯宏/占位符形状的整串：`{{…}}` 或 `<…>`（大小写不敏感、内容允许空白）。 */
const BRACE_MACRO_RE = /^\{\{[^{}]*\}\}$/;
const ANGLE_MACRO_RE = /^<[^<>]*>$/;

/** ★替换用：**只认成对的宏**（不成对的不换——换了会把正常文本啃掉一块）。`g` 标志，配 `replace` 用。 */
export const MACRO_RE = /\{\{\s*(user|char)\s*\}\}/gi;

/**
 * 纯占位符形状 ⇒ 这一项**不许当名字**（不是"格式校验"，是"它根本不是一个名字"）。
 *
 * ★口径的边界（这是本条最容易走偏的地方，写下来免得下一任"顺手放宽/收紧"）：
 *   · **整串就是一个宏**（`{{user}}` / `<user>`）⇒ 挡。它显然是占位符，不可能是人名。
 *   · **残缺的半截宏**（`{{user` / `user}}` / `<user`）⇒ 挡。括号都不配对，只可能是抄坏了。
 *   · ★**平衡的括号夹在名字中间**（`李{{user}}` / `{{user}}的师父`）⇒ **不挡**——
 *     那不是"一个宏"，那是一段**含宏的文本**；本仓不许凭形状把合法的书文判死
 *     （挡的是"它根本不是一个名字"，不是"它长得可疑"）。
 */
export function isMacroPlaceholder(v) {
    const s = String(v ?? '').trim();
    if (!s) return false;                       // ★空值不是宏——它是"没有"（两件事别混）
    if (BRACE_MACRO_RE.test(s)) return true;    // {{user}} / {{ user }} / {{主角}}
    if (ANGLE_MACRO_RE.test(s)) return true;    // <user> / < bot >
    return isMalformedMacro(s);                 // {{user / user}} / <user / ——只挡**不配对**的
}

/**
 * 残缺的半截宏：有开没闭、或有闭没开。
 * ★必须查**配不配对**，不许"见到 `{{` 就判"这是宏"`（那会把 `李{{user}}` 这种正常文本一起判死）。
 */
function isMalformedMacro(s) {
    const hasOpenBrace = s.includes('{{');
    const hasCloseBrace = s.includes('}}');
    if (hasOpenBrace !== hasCloseBrace) return true;
    const hasOpenAngle = s.includes('<');
    const hasCloseAngle = s.includes('>');
    return hasOpenAngle !== hasCloseAngle;
}

/**
 * ★★读不到玩家真名时的记号。
 *   ★它必须**自己就是纯占位符形状**——这样下游才挡得住（见 `isMacroPlaceholder`）。
 *   ★措辞是给人看的（查账时一眼看懂"这里本来是个玩家名"），但它进不了账（会被挡）。
 */
export const PLAYER_NAME_UNKNOWN = '⟨读不到玩家名⟩';

/**
 * 把原文里的酒馆宏换成真名。**没有宏 ⇒ 原样返回**（逐字节零漂移）。
 *
 * @param {string} text 原文（世界书条目内容 / 角色卡件 / 任何要送进模型的书文）
 * @param {{playerName?:string, charName?:string}} names 真名；读不到就传空 ⇒ 换成 `PLAYER_NAME_UNKNOWN` 记号
 * @returns {string}
 */
export function substituteMacros(text, { playerName = '', charName = '' } = {}) {
    const s = String(text ?? '');
    if (!MACRO_RE.test(s)) return s;            // ★零漂移：没宏就一个字节都不动
    MACRO_RE.lastIndex = 0;                     // 上面那次 test 推进过 lastIndex，重置再用
    const player = String(playerName ?? '').trim() || PLAYER_NAME_UNKNOWN;
    const ch = String(charName ?? '').trim() || PLAYER_NAME_UNKNOWN;
    return s.replace(MACRO_RE, (m, kind) => (String(kind).toLowerCase() === 'user' ? player : ch));
}

/**
 * 一份名字对（从酒馆上下文取；**读不到就空着**——本函数不猜、不兜底）。
 * 放在这里是为了让两个调用方（`web/index.js` 的初始组合与换书检测）**用同一把尺子**。
 * @param {() => object|null} getCtx 现取上下文（★不许抓死：切卡切聊天都要现读）
 * @param {object|null} character 当前角色卡
 */
export function macroNamesFromCtx(getCtx, character = null) {
    const ctx = (() => { try { return typeof getCtx === 'function' ? getCtx() : null; } catch (_) { return null; } })();
    const playerName = String(ctx?.name1 ?? '').trim();
    const charName = String(character?.name ?? ctx?.name2 ?? '').trim();
    return { playerName, charName };
}

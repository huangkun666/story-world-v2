// story-world-v2/web/env-evidence.js
// ★★★leg201（2026-10-05 · 社区第三次报同一条「设定源不可用：角色卡四件套全空」之后定的）：
//   **环境自检**——一次把"这个环境到底是什么样"取证完，让每一份社区报告都能**一轮分类**。
//
// ＝＝＝ 为什么必须有它（这一格的来路，别当可选装饰）＝＝＝
//   同一条「设定源不可用」被社区报了**三次**（leg154 修过一次），每一轮都卡在同一件事上：
//   **维护者与玩家两边都拿不到"环境到底是什么形状"这一格读数**。
//     · 手机端**没有控制台** ⇒ 插件里那些 `console.warn(...诊断...)` 一句都取不出来；
//     · 玩家能给的只有**一张状态条截图**，而状态条那一句同时覆盖三种完全不同的病
//       （卡真空 / 宿主把正文放在 `data` 层 / 懒加载没取回来）；
//     · 于是每轮都要来回问三四次："你的版本？""换张卡试试？""在角色聊天里吗？"
//   ⇒ 定稿：**把环境事实做成一份能一键复制的读数**，并挂在**已经存在**的那条取证通道上。
//
// ＝＝＝ 为什么是"并进调试页的摘要"（位置是选过的，别搬）＝＝＝
//   · 设置页 →「调试」子页签的摘要**会自动渲染任意键**（`debug-console.js` 的 `summaryHtml`），
//     而那一页已经有**「复制报告」/「下载报告」**两枚按钮 ⇒ 并进摘要 = 玩家一键就能把这份读数发出来；
//   · **零新按钮、零新动作**：不用碰 `web/index.js`（它有 `<3100` 行硬锁，加一行就红）；
//   · ★也**没有**放回参数页——那一页的自检卡是用户亲口撤掉的（「不要在参数界面出现」）。
//
// ＝＝＝ 纪律（三条）＝＝＝
//   ① **零 import 的真叶子**：只吃 `{ctx, character, world}` 三个现成对象 ⇒ Node 里能直接真跑判据；
//   ② **只描述形状，不解释形状**：读不到就写"（没读到）"，**绝不用空值反推结论**
//      （本仓硬规矩二：`读不到` ≠ `书里没有`）；
//   ③ **永不抛**：取证本身炸了绝不能把"报错"变成"抛错"（每一格各自 try）。

/** 卡四件套的键名（与 `abstract-input.js` 的 `CHARACTER_SOURCE_FIELDS` 同源；此处只读不写）。 */
const CARD_FIELDS = ['description', 'personality', 'scenario', 'first_mes'];

const has = (v) => v !== null && v !== undefined;
const len = (s) => (typeof s === 'string' ? s.trim().length : 0);
const sumLen = (o) => CARD_FIELDS.reduce((n, k) => n + len(o?.[k]), 0);
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).length : 0);

/**
 * 描述一个"世界信息"来源的**原始形状**（不解析、不合并——解析是 `book-source.js` 的活）。
 * 为什么要报形状而不是报条数：**条数是解析之后的结论**，而"读不到"与"书里没有"必须分形
 * （硬规矩二）。这一格只回答"宿主给过来的那一坨长什么样"。
 */
function shapeOf(v) {
    if (!has(v)) return '无';
    if (Array.isArray(v)) return `数组 ${v.length} 条`;
    if (typeof v === 'object') return `对象（${keysOf(v)} 个键）`;
    return typeof v;
}

/**
 * 收集环境事实。**纯函数**（无 DOM、无 import、无副作用）——所有取数由调用方注入。
 * @param {object} [deps]
 * @param {object|null} [deps.ctx]        ST/TT 的上下文（`getContext()` 现取那一份）
 * @param {object|null} [deps.character]  本次读到的角色卡（接线层的 `pickCharacter(ctx)`）
 * @param {object|null} [deps.world]      当下的世界账（没有就传 null）
 * @returns {Record<string, string>} 扁平的中文键读数（直接并进调试页摘要）
 */
export function gatherEnvFacts({ ctx = null, character = null, world = null } = {}) {
    const out = {};

    // ── ① 宿主与浏览器（"哪一套保存/取卡语义"决定后面所有判据）──────────────────
    try {
        const w = typeof window !== 'undefined' ? window : null;
        out['宿主'] = w?.__TAURITAVERN__ ? 'TauriTavern（第三方宿主 · 后端 Rust 重写）' : 'SillyTavern（或同形前端）';
    } catch (_) { out['宿主'] = '（读不到）'; }
    try {
        const ua = typeof navigator !== 'undefined' ? String(navigator?.userAgent || '') : '';
        out['浏览器'] = ua ? ua.slice(0, 90) : '（读不到）';
    } catch (_) { out['浏览器'] = '（读不到）'; }

    // ── ② 上下文（"在不在角色聊天里"——三次报告里最常问的那一问）────────────────
    try {
        out['聊天号'] = has(ctx?.chatId) ? String(ctx.chatId) : '（没有 · 可能没进聊天）';
        out['角色号'] = has(ctx?.characterId) ? String(ctx.characterId) : '（没有 · 可能没选卡）';
        out['群聊号'] = has(ctx?.groupId) ? String(ctx.groupId) : '（无 · 非群聊）';
    } catch (_) { /* 单格失败不拖累整份读数 */ }

    // ── ③ 卡形状（★★★这一格就是三次报告的正主）────────────────────────────
    try {
        if (!character) {
            out['角色卡'] = '（没读到卡）';
        } else {
            out['角色卡'] = String(character.name || character.data?.name || '（无名）');
            // ★顶层与 `data` 层**分开报**：这两格一摆出来，"是我们的读法没跟上宿主形状"
            //   与"卡里真没有"当场分得清（`abstract-input.js` 的取法两层都看）。
            out['卡正文·顶层'] = `${sumLen(character)} 字`;
            out['卡正文·data层'] = `${sumLen(character?.data)} 字`;
            // ★`shallow` 连**类型**一起报：`lazyLoadCharacters` 那个键只认 `=== true`，
            //   宿主若给 `1`/`"true"`，我们要当场看得出是"标志形状不对"而不是"卡是空的"。
            out['卡·shallow'] = character.shallow === undefined ? '（无这个键）' : `${String(character.shallow)}（${typeof character.shallow}）`;
            out['卡·顶层键数'] = String(keysOf(character));
            out['卡·内置书'] = (() => {
                const b = character.character_book?.entries ?? character.data?.character_book?.entries;
                return Array.isArray(b) ? `${b.length} 条` : has(b) ? `非数组（${typeof b}）` : '无';
            })();
        }
    } catch (_) { /* 同上 */ }

    // ── ④ 世界信息的三个来源（各自**只报原始形状**，解析归 book-source.js）────────
    try {
        out['世界信息·ctx'] = shapeOf(ctx?.worldInfo);
        out['世界信息·聊天'] = shapeOf(ctx?.chatMetadata?.world_info);
        out['世界信息·设置'] = shapeOf(ctx?.extensionSettings?.world_info);
    } catch (_) { /* 同上 */ }

    // ── ⑤ 世界账（"插件到底有没有世界"——空态与故障的分界）──────────────────────
    try {
        if (!world) {
            out['世界账'] = '（没有 · 尚未开局或载入失败）';
        } else {
            const n = (v) => (Array.isArray(v) ? v.length : '—');
            out['世界账'] = `tick ${world.meta?.tick ?? '—'} · 实体 ${n(world.entities)} · 事件 ${n(world.events)} · 编年 ${n(world.chronicle)}`;
        }
    } catch (_) { out['世界账'] = '（读不到）'; }

    return out;
}

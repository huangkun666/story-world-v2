// story-world-v2/src/book-check.js
//
// ★★★leg112（C1 换书检测）：**世界载入时，比一次"账上那份设定是从哪本书抽的"与"现在挂的是哪本书"。**
//
// ＝＝ 一句话说清它治什么病 ＝＝
//   用户原话（leg109b §1.3）：「世界书一般都不会变的吧？变了重开一个聊天不就好了吗？」
//   —— 前半句成立、后半句是**人的约定**，而插件此前**根本不知道有没有人违反它**：
//   同一个聊天里把书换了（换卡带的另一本内置书 / ST 的"挂到本聊天" / 全局改选），
//   账本照旧按**旧书**跑，面板上却什么都不说 ⇒ 玩家看到的是"两个世界各说各话"，
//   而且**没有任何一处会告诉他这件事发生了**。
//   ⇒ 本模块只做一件事：**如实说一句**（绝不自己重抽、绝不自己改账——那是玩家按按钮才做的事）。
//
// ＝＝ 口径（三条，别越界）＝＝
//   ① **只出声，不动手**：发现不等**不自动重抽**（重抽要跑模型、大书 20–30 分钟），
//      也不偷偷把账上的指纹改掉。玩家看到话，自己决定按不按那颗「就按现在这本算」。
//   ② **空着就是空着**（红线 2）：账上**没有**指纹（leg26 之前的老账）、或**这次没读到书**
//      ⇒ 一律**什么都不说**。绝不拿"读不到"当"书变了"，也绝不用空值反推。
//   ③ **纯函数**：本模块顶层零 DOM、零 IO、不 import 引擎别处 ⇒ `node --test` 直接真跑
//      （本仓硬纪律；判据见 `test/book-check.test.js`）。
//
// ＝＝ 为什么这个判断值得存在（本笔实测，不是设想）＝＝
//   用户那份真账（`大荒z`，2026-09-11 15:59 抽取）账上存着 `fnv1a_pi8kez_6gui`，
//   而照引擎真实算法（`composeInitSource` + `bookFingerprint`）重算现在的书得到
//   `fnv1a_15fuert_5rdo`（合订文本 337,266 字 → 268,542 字，少了两成）。
//   那本书文件本身从 2026-08-25 起没再改过、聊天级与全局都没有额外挂书 ⇒
//   说明**账上那份设定当初不是从他现在这本书抽的**，而这件事此前**没有任何地方会说**。

/** 动作名：玩家按「就按现在这本算」时走的那颗按钮（`web/index.js` 的动作总线上有同名处理器）。 */
export const REBASELINE_ACTION = 'rebaseline-book';

/** 玩家能看懂的那颗按钮（★文案不夹英文、不夹引擎术语——`STATE.md` §2.5 红线）。 */
export const REBASELINE_LABEL = '就按现在这本算';

/**
 * 比对"账上那份设定的来路"与"现在这本书"。
 *
 * @param {object} args
 * @param {string} args.stored   账上记的书指纹（`setting.frozen.fingerprint`）
 * @param {string} args.fresh    这次现取的书、照同一套算法算出来的指纹
 * @param {boolean} [args.sourceOk] 这次**真的读到了书**吗（读不到 ⇒ 一句话都不说）
 * @returns {{changed:boolean, stored:string, fresh:string}|null} `null` = 无从判断（不说任何话）
 */
export function checkBookSource({ stored = '', fresh = '', sourceOk = true } = {}) {
    const a = String(stored ?? '');
    const b = String(fresh ?? '');
    // ② 空着就是空着：任一侧没有指纹 / 这次没读到书 ⇒ 不判断（不是"变了"，是"不知道"）
    if (!sourceOk) return null;
    if (!a || !b) return null;
    return { changed: a !== b, stored: a, fresh: b };
}

/**
 * 状态条那一句话（人话，玩家看得懂）。
 * ★措辞口径：**说清"为什么现在这样"**——账本是按旧书建的、现在挂的是另一本，
 *   所以你会看到两边对不上；然后给出**两条出路**（换回来 / 按现在这本算）。
 */
export function bookChangedStatus({ fresh = '', stored = '' } = {}) {
    return `书换了：账本还是按原来那本书建的（${String(stored)}），现在挂的是另一本（${String(fresh)}）`
        + `——你看到的世界账与正文可能对不上。要么把书换回去，要么按设定页那颗「${REBASELINE_LABEL}」把账本改成按现在这本算`;
}

/**
 * 重新定基之后那一句（说清"做了什么、没做什么"）。
 * ★必须写明**没有重抽**：否则玩家会以为设定已经跟着新书更新了（那是假的）。
 */
export function rebaselinedStatus({ fresh = '' } = {}) {
    return `已按现在这本书记下新的来路（${String(fresh)}）——设定一个字没重抽，要重抽请按「只重抽设定」`;
}

/**
 * 设定页那一行 HTML（只在"书真的换了"时非空）。
 * ★渲染层只负责把它贴进去 ⇒ 玩家可见文案**只有本模块一处**（避免"同一个概念两种说法"）。
 * @param {{changed:boolean}|null} result `checkBookSource` 的返回值
 * @param {(s:string)=>string} escapeHtml 渲染层的转义口（★指纹是引擎产物，一律转义后再上屏）
 */
export function bookChangedBannerHtml(result, escapeHtml = (s) => String(s)) {
    if (!result?.changed) return '';
    return `<div class="sw2-hint" style="margin-top:6px">注意：账本按<b>原来那本书</b>建的（${escapeHtml(result.stored)}），`
        + `现在挂的是另一本（${escapeHtml(result.fresh)}）——`
        + `<button class="sw2-btn" data-action="${REBASELINE_ACTION}">${REBASELINE_LABEL}</button>`
        + `（设定不会重抽；只是以后不再拿这件事提醒你）</div>`;
}

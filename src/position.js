// story-world-v2/src/position.js
// 位置值的**唯一归一入口**（leg33）。纯函数、零依赖 —— 置于独立叶子模块是为了**避开循环依赖**：
//   `settle.js` 已 `import { checkWorldStep } from './check-step.js'`，若 check-step 再回头 import settle 就成环。
//   故真源放这里，`settle.js` 再导出一次（`export { normalizePosition } from './position.js'`），
//   让既有的 `import { normalizePosition } from './settle.js'` 也成立。

/**
 * 剥掉位置值尾部的「（推）」注解。
 *
 * 病根（真机实测，同一输入间歇复现）：leg31 把「这个位置是引擎按结构推断的」标进了**实体表的 location 列**
 *   （`北俱荒洲（推）`，见 `pack.js` entityRow 的 `locationNote`；表读法在 `ENTITY_TABLE_LEGEND` 里讲了它是什么意思），
 *   但**没有任何地方把模型抄回来的那串剥掉**。于是模型把实体表的格子**原样**写进
 *   `newEvents[].position` / `actions[].position` ⇒ 位置闸认不出 ⇒ **拒整步**
 *   （实测原文：`$.newEvents[2].position: " 北俱荒洲（推）" 不在世界位置集`）。
 *
 * ★为什么是"剥掉"而不是"拒"：「（推）」是**引擎自己的注解**，不是模型编的地名——
 *   模型抄它恰恰说明它读懂了那个格子。为引擎的表达法惩罚模型，是判据的假阳性。
 * ★口径同 leg32f（`newEntities` 位置不在集内 → 归一到「未明」）：**注解剥掉之后仍不在集内**的，
 *   才是真·编了地名，那一条继续照原样处理（本函数**只剥注解，不做任何替换或猜测**）。
 * ★与 `pack.js` 的 `locationNote` 同源，正则都是 `/（推）$/`。**改注解形状必须两处一起改。**
 *
 * @param {*} v 模型给的位置值（可能 undefined / null / 非字符串）
 * @returns {*} 剥掉注解并 trim 的字符串；非字符串原样返回（让下游"不在集内"照常判它）
 */
export function normalizePosition(v) {
    return typeof v === 'string' ? v.trim().replace(/（推）$/, '') : v;
}

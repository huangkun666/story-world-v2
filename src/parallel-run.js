// story-world-v2/src/parallel-run.js
//
// ★★★leg144：**把一串互不依赖的活儿并发发出去，按原下标收回来**。
//
// ── 为什么要有这个文件（病，逐条有据）────────────────────────────────────────
//   抽取管线此前是**一条完全串行的链**：
//     `for (const [ci, chunk] of chunks.entries()) { await tryRosterChunk(…) }`
//   ——名册遍这样跑、属性+设定遍再这样跑一遍、起根（`seedRootsChunked`）也这样跑。
//   大书（26.6 万字 / 每块 3 万字）⇒ **9 块 × 2 遍 + 起根 9 块 = 27 次调用，一次都不重叠**。
//   代码里自己的实测（`src/abstract.js` 的块尺寸注释 + `web/long-task.js` 的文件头）：
//     · 3 万字的块每次 **≈90 秒**；
//     · 大荒真账 **22 次调用 / 1909 秒**（≈32 分钟）；
//     · `STATE.md` §3 登记的"大书首跑 **20–30 分钟**"。
//   ⇒ 这就是用户说的"很多用户反映这件事"。**不是模型慢，是它们被写成了排队。**
//
// ── 为什么并发在这里是安全的（本模块唯一要紧的一条）──────────────────────────
//   那 27 次调用**彼此毫无依赖**：每块是书文里独立的一段；两遍问的是不同的东西
//   （名册遍只问名号、设定遍问设定与属性）；而合并是**全部跑完之后**才做的纯函数
//   （`mergeCanonChunks` / `dedupeRoster`）。
//   ⇒ 并发只改"**什么时候发出去**"，不改"**发什么**"、也不改"**按什么次序收**"。
//
//   ★★★**收回必须按原下标**（`out[i] = …`，**不是** `out.push(…)`）——这是质量的那条线：
//     · `dedupeRoster` 的定稿口径是"**每组取最先出现的那个叫法当 `name`**"；
//     · `mergeCanonChunks` 的定稿口径是"**首块优先**"（张力与四个环境档位只看第一块）。
//   按完成次序 push，会让这两条**悄悄换人**——而判据只数得出"名字/档位变了"，
//   **指不出是谁换的**（本仓 leg103 §G："数组里没有的词等于不存在"那一族）。
//   按下标写回 ⇒ 上面两条拿到的次序与串行时**逐字相同**。
//
// ── 为什么并发度是"每次取活儿时重读"的（不是一个建池时定死的数）──────────────
//   网关一旦被并发惹毛（429 限流 / 524 / 5xx / 链路断），调用方要能把并发度**当场降到 1**，
//   而**已经在跑的那几条必须有序退场**（不能把已经取走的活儿丢掉、也不能重复取）。
//   ⇒ `limit` 允许传**函数**；每条 lane 在**取下一件活儿之前**重读一次，超出当前额度的
//     lane 自己退出（`finally` 里把计数还回去），**永远至少留一条**把剩下的活儿跑完。
//   ★如实说清边界：**降下去就不再升回来**（退场的 lane 不会复活）。本仓用它做的是
//     "遇到网关推回就退回串行"，只需要单向。
//
// ── 纪律 ────────────────────────────────────────────────────────────────────
//   ① **纯机制**：这个文件不认识"块""抽取""网关"这些词——**降不降并发由调用方决定**
//      （策略住在 `src/abstract.js` / `src/seed-roots.js`，机制只住这里；本仓"一把尺子，几处调用"）。
//   ② **零依赖**：`node --test` 能直接 import（本仓硬纪律）。
//   ③ **一件活儿抛错不许拖垮整批**：`worker` 抛出的错照 `Promise.all` 的语义上抛给调用方，
//      但**其余 lane 照常把已取走的活儿跑完**（不做"一炸全停"）——
//      一条 lane 的异常不该让整本书白抽。★调用方若想让"某一块失败"不炸整批，
//      应在自己的 `worker` 里把失败收成返回值（抽取管线就是这么做的）。

/**
 * 把 `items` 逐件交给 `worker` 并发执行，**结果按原下标收回**。
 *
 * @param {any[]} items 活儿清单（互不依赖；空数组 ⇒ 直接返回空数组、一条 lane 都不建）
 * @param {number|Function} limit 并发度；传函数则**每次取活儿前重读**（用于"当场降级"）
 * @param {(item:any, index:number)=>Promise<any>} worker 单件活儿（返回值原样进 `out[index]`）
 * @returns {Promise<any[]>} 与 `items` **等长、同序**的结果数组
 */
export async function runParallel(items, limit, worker) {
    const list = Array.isArray(items) ? items : [];
    if (typeof worker !== 'function') throw new TypeError('runParallel：第三个参数必须是函数');
    const out = new Array(list.length);
    if (!list.length) return out;

    // 并发度读法（唯一一处）：非有限数 / 小于 1 一律当 1——**绝不允许算出 0 条 lane**
    //   （0 条 = 一件活儿都不会被取走，而返回的却是一个"跑完了"的空结果数组 ⇒ 静默丢数据）。
    const limitOf = () => {
        const raw = typeof limit === 'function' ? limit() : limit;
        const n = Math.floor(Number(raw));
        return Number.isFinite(n) && n >= 1 ? n : 1;
    };

    let next = 0;          // 下一个待取的下标（lane 之间共享；JS 单线程 ⇒ 取号不会撞车）
    let live = 0;          // 此刻活着的 lane 数（退场判定用它）
    const runLane = async () => {
        live += 1;
        try {
            for (;;) {
                if (live > limitOf()) return;   // 额度被调低 ⇒ 多余的 lane 有序退场（至少留一条）
                if (next >= list.length) return;
                const i = next;
                next += 1;
                out[i] = await worker(list[i], i);   // ★按下标写回 = 保序的那一行
            }
        } finally {
            live -= 1;
        }
    };

    const lanes = Math.min(limitOf(), list.length);
    await Promise.all(Array.from({ length: lanes }, runLane));
    return out;
}

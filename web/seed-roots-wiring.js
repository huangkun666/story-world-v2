// story-world-v2/web/seed-roots-wiring.js
// ★★★Task 4（integration boundaries）：**分块起根那条路的接线**——原住 `web/index.js`，为行数硬锁搬出来。
//
// 为什么搬（不是审美，是本仓立过的纪律「要往接线层加东西 ⇒ 先把一族搬出去」）：
//   `web/index.js` 有 `< 3100` 行硬锁（`test/web-view-state-layout.test.js`），而这一笔要给起根接上
//   **来源身份 + 原话**（`allowedSources` ⇒ 严格道）与**带行号的分块**（作用域与分块同一把尺子）。
//   搬走这一族 = 接线层不长高，而这一族也终于有了自己的家（与 `web/view-state.js`、`web/book-source.js` 同款）。
//
// ★它只做接线：取书文 → 分块（**带行号**）→ 交给 `src/seed-roots.js` 的 `seedRootsChunked`。
//   `minRoots` / `fresh` 两个形参是旧签名的兼容面（前者未用、后者只进日志），一个字不动。
//
// 提成导出是为了**能被真测**（注入真 extract 真跑），与 `seedAndBackfill` 同治法。
import {
    SEED_CHUNK_CHAR, SEED_CANDIDATES_TOP, seedFingerprint, chunkBookTextWithRanges,
    maxRootsPerChunk, seedRootsChunked, buildSeedCandidatePool,
} from '../src/seed-roots.js';

/**
 * ★★★leg150：**候选池那一族住在 `src/seed-roots.js`**（`buildSeedCandidatePool`）——本文件只调用。
 *   为什么那边是家：它本来就是"起根"这一族的一半（"从账上挑还没上过台的人"），而它**有两个入口**
 *   （账本入口 ＋ 甲案那条"从第一遍的名册名字起根"的入口）⇒ 两个入口必须并排住。
 *
 * ★★★Task 4：`allowedSources` / `evidencePolicy` 两个形参是**严格道的接线**——
 *   与初始化抽取那两个参数**同名同义**（`src/abstract.js` 的 `extractWorldSetting`）：
 *   · `allowedSources` = 发射端（`composeInitSource`）自己产出的**最终接收块**（来源 ID + 逐字文本）；
 *   · `evidencePolicy:'strict'` = 显式要求"编号 + 原话"；**没有允许来源 ⇒ 明确拒绝**，不许静默回落 legacy。
 */
export async function seedRootsForWorld(hotWorld, { sourceText = '', extract = null, fresh = false, minRoots = 3, chunkChars = SEED_CHUNK_CHAR, candidates = null, onProgress = null, concurrency = 1, allowedSources = null, evidencePolicy = null, signal = null } = {}) {
    if (signal?.aborted) throw Object.assign(new Error('用户已中止抽取'), { sw2Cancelled: true });
    if (typeof extract !== 'function') return { ok: false, skipped: true, reason: '没有可用的抽取通道' };
    const src = String(sourceText ?? '');
    // ★leg150：指纹与"每块几条"两件事都搬进了 `src/seed-roots.js`（**两条路共用一处**）——
    //   甲案那条路（并进第二遍）也要算同一个指纹，各写一份就会"同一本书被种两遍根"。
    const fp = seedFingerprint(src, chunkChars);
    // 候选人名单：缺省 = 账上"从没被任何事件点过名的 active 实体名"（机械，零语义）
    // ★★leg61（跨书实测后改的排序，用户令「做种的候选只有 60 个吗？但是我是把所有实体都放进上下文了啊」）：
    //   名单**不是硬闸**（提示词里那句"名单里没有的，才用书里别处明述的名号"是真的会被用的——
    //   真账实测：大荒 13 人次里 4 个、三国 14 人次里 3 个都是**名单外**的名字，位次能到 #346）。
    //   但它是一份"优先挑这些"的**引导**，而旧法按**账本顺序**取前 60 ⇒ 引导指向了错误的人：
    //     三国进池的是 `大汉/大魏/大吴/中山无极甄氏…`（按 kind 排序后国号与氏族在前面），
    //     而**书里戏最多的那批人被挤在外面**：诸葛亮(出现 111 次) · 姜维(81) · 司马懿(74) · 关羽(56)…
    //     ——三国 385 个合格候选里，出现 ≥10 次的 **114 个**（占 90%）一个都没进名单。
    //   ⇒ 排序键换成"**这个名字在本书原文里出现多少次**"（零 token、零词表、纯函数）：
    //     引导于是对准"书里真有事的人"，而不是"账本里排前面的人"。`<user>` 这类占位符靠名号形态闸挡。
    const pool = Array.isArray(candidates) ? candidates : buildSeedCandidatePool(hotWorld, src, SEED_CANDIDATES_TOP);
    // ★★★Task 4：**带行号**的分块（与 `chunkBookText` 同一把尺子的唯一实现）——
    //   严格道要把"这一块展示了哪些行"交回来源块（`scopeForRows`），分块与作用域必须是同一把尺子。
    const chunks = chunkBookTextWithRanges(src, chunkChars);
    const r = await seedRootsChunked({
        ssot: hotWorld, chunks, extract, candidates: pool, fingerprint: fp, at: new Date().toISOString(),
        maxPerChunk: maxRootsPerChunk(chunks.length),
        onProgress, concurrency, signal,
        sourceText: src,          // ★Task 4：整份书文（块的行号在它里面定位）
        allowedSources,           // ★Task 4：来源身份 + 逐字文本（发射端的最终接收块）
        evidencePolicy,           // ★Task 4：strict（有来源）/ legacy（**只许显式**）
    });
    if (r.warnings?.length) console.warn('[story-world-v2] 起根净化剔除', { warnings: r.warnings.slice(0, 6), skippedParties: r.skippedParties });
    if (r.ok && !r.skipped) {
        console.info('[story-world-v2] 起根完成（世界源 → 线头）', { seeded: r.seeded, ids: r.ids, fresh, chunks: chunks.length, candidates: pool.length, fingerprint: fp });
    }
    return { ...r, fingerprint: fp, chunkCount: chunks.length, candidateCount: pool.length };
}

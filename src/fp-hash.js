// story-world-v2/src/fp-hash.js
// ★★★leg159c（用户 2026-09-30 拍「治本：改名」）：**这个文件原来叫 `fingerprint.js`，被广告过滤器误杀。**
//   病（社区那位装了过滤列表的人报「装不上」；本仓逐条独立复验过，装置 `F:/deepseek/tmp/leg159b-block/`）：
//   EasyPrivacy 主线**第 982 行**有一条
//     `/fingerprint.js^$domain=~github.com`
//   ——它是拿来封 FingerprintJS 那个指纹库的（它的发行文件就叫这个名字），语义是"**路径里含
//   `/fingerprint.js` 就拦，只有发起方是 github.com 才豁免**"。★它**没写 `third-party`**
//   ⇒ **第一方请求照拦**：酒馆从本机 http 服务端抓 `…/story-world-v2/src/fingerprint.js` 时当场被掐断。
//   ★★后果特别难查（这是非改不可的理由）：ES module 的依赖图里**任何一个文件抓取失败**，
//   整个 `<script type="module">` 只派发一个**不携带任何信息的裸 Event**——`message`/`filename` 全是 null，
//   `String(e)` = `[object Event]`（实测 `{"isEvent":true,"ctor":"Event","keys":["isTrusted"]}`）
//   ⇒ 酒馆那句报错就长成 `[object Event]`、控制台几乎没有痕迹，**硬刷新无效**（从装好那一刻起 100% 触发）。
//   ⇒ 改名到 `fp-hash.js`（不再含 `fingerprint` 这个词）。★口径：**文件名也是产品面**——
//     自己的模块名撞上公共过滤列表的词，代价是"整个面板打不开"，而改名的代价只是几处 import。
//   ★复验口径（装置 `verify-block.mjs`）：从入口 `web/index.js` 静态走一遍 import 图（65 个模块），
//     按那条规则的语义逐个匹配 ⇒ 全仓**只有这一个**命中；把它的抓取拦掉 ⇒ 页面收到的正是那个裸 Event。
//   ★★改名的纪律：**契约/引擎/渲染一个字没动**、页面可见面零变化 ⇒ `PANEL_BUILD`/`CSS_VERSION`/
//     `MAIN_PROMPT_V`/`CACHE_VERSION` **四个号一个都不升**（`CACHE_VERSION` 与文件名无关，它管缓存形状）。
// 书指纹缓存（K26/设定大势层，细案 §3.2③ + 附录 A → A-3）：v1 算法原样搬（director.js bookFingerprint / adapter.js abstractCache）。
//   书指纹 = FNV-1a 32 位（offset 0x811c9dc5、prime 0x01000193、Math.imul、>>>0）+ 长度混入——有效书文与作者题名共同参与；
//   缓存 = LRU 有界（按 extractedAt 串序淘汰）+ 版本戳防形状演进——同指纹命中 = 零抽取调用（A-3）；
//   深拷贝保护：命中返回拷贝，缓存本体不被下游改动（v1 同款）。
// force 重抽（玩家主动「重新抽象」）= 调用方行为：set 总是覆盖同指纹条目，冲掉旧产物即可。

export const FNV1A_OFFSET = 0x811c9dc5;
export const FNV1A_PRIME = 0x01000193;
export const CACHE_VERSION = 11;       // ★leg198：**起根那一问的问法变了**（title 立时态纪律：
                                     //   "只写此刻正在发生的那一步、不许写接下来会怎样" ＋ 撤掉死格 `why`）
                                     //   ⇒ 同一本书抽出来的东西不一样了 ⇒ 旧缓存必须失效。
                                     //   10（leg197）：出处那一整套"核不过就丢"全面撤销 ⇒ 抽取的问法与
                                     //   净化口径都变了（同一本书抽出来的东西不一样了）⇒ 旧缓存必须失效。
                                     //   9（leg192）：增加地理抽取，旧抽取形状缓存失效。
                                     // v1→v2（K31）：缓存值由 canon 五件套扩展为 {canon, tension, env}
                                     //   ——同指纹命中需还原 dynamic 初值（张力/环境量），只存五件套会在
                                     //   命中路径丢初值；v2 无持久化缓存，版本抬升零迁移成本。
                                     // v2→v3（leg141）：**canon 多了 `relations` 这一格**（书里的关系网，
                                     //   用户令「把抽象阶段的关系网抽象做出来」）⇒ 旧缓存条目里**没有这一项**。
                                     //   ★★为什么非抬不可（这是本笔最容易漏掉的一环，如实留档）：
                                     //     **缓存键只有"书文本指纹"**（`bookFingerprint` 只吃书文），
                                     //     **提示词改了它不知道** ⇒ 不抬这一格，老世界再点「初始化」会**命中旧缓存**、
                                     //     拿着"没有关系网"的那份 canon 直接返回，**新提示词一次都不会被行使**
                                     //     （而那看起来完全正常：ok=true、cached=true、账照建）。
                                     //   ★代价如实说：抬了之后**所有世界的旧缓存全部失效** ⇒ 下一次抽取
                                     //     是一次**真调用**（大书 20–30 分钟真钱）。这钱本来就得花——
                                     //     不花就永远拿不到关系网。
                                     // v3→v4（leg150）：**抽取的"问法"变了**——用户令「甲案＋丙案，开工吧」：
                                     //   ① **丙案**：第二遍首块那份重复的"设定＋属性"整份删掉（第二遍只问属性）；
                                     //   ② **甲案**：起根**并进第二遍**（第 2..N 块顺带问"书里正在发生的事"），
                                     //      调用数 3N → 2N。
                                     //   ★抬它的理由与 v2→v3 **逐字相同**：缓存键只有书指纹，**问法改了它不知道**
                                     //     ⇒ 不抬，老书再点「初始化」会命中旧缓存，新问法**一次都不会被行使**
                                     //     （而且看起来完全正常：ok=true、cached=true、账照建）。
                                     //   ★代价照旧如实说：抬了 ⇒ 旧缓存全部失效，下一次抽取是真调用（大书十几分钟真钱）。
                                     //   ★★顺带记一条**名号口径**：改的是"抽取怎么问"，不是"每轮递给模型的那份包"
                                     //     （`src/prompts.js` 一个字节没动）⇒ `MAIN_PROMPT_V` **不升**；
                                     //     这一格才是那个该升的号（细案 §2.2 原写"要升 MAIN_PROMPT_V"，本笔勘正）。
export const CACHE_MAX = 5;            // LRU 上限（v1 原值；多书共存有界）

export function bookFingerprint(text, titleRoster = []) {
    // 题名还通过 extraDeclared 参与名册；预算截断正文时也不能漏掉这一份有效输入。
    // 没有题名时沿用原算法，出处说明等诊断变化不影响名号指纹。
    const names = [...new Set((Array.isArray(titleRoster) ? titleRoster : []).map((d) => String(d?.name ?? '').trim()).filter(Boolean))];
    const input = names.length ? JSON.stringify([text, names]) : text;
    let h = FNV1A_OFFSET;
    for (let i = 0; i < input.length; i += 1) { h ^= input.charCodeAt(i); h = Math.imul(h, FNV1A_PRIME) >>> 0; }
    return `fnv1a_${h.toString(36)}_${input.length.toString(36)}`;
}

export function createCache(initialStore = {}) {
    const store = { ...initialStore };   // 可播种（测试注入/版本迁移）；不染外来对象
    return {
        get(fingerprint) {
            const entry = store[fingerprint];
            if (!entry || entry.cacheVersion !== CACHE_VERSION) return null;
            return JSON.parse(JSON.stringify(entry));   // 深拷贝：保护缓存本体（v1 同款）
        },
        set(fingerprint, canon, extractedAt, meta = null) {
            // ★★★Task 3：**只有缓存才有的严格策略标记 + sourceDigest**（Codex 决议：缓存标量元数据
            //   住在缓存信封里，**不进 world canon、不进关系边**）。`extractWorldSetting` 的严格缓存
            //   复用要同时核对 `evidencePolicy === 'strict'` 与 `sourceDigest` 相同；旧条目没有这两格
            //   ⇒ 严格道一律 miss（**绝不把"缺证明"当成 legacy 免检**）。legacy 调用保持旧的指纹命中口径。
            //   ⚠`CACHE_VERSION` 本任务**不抬**（Task 4 负责）：旧条目靠上面这条闸自然失效，形状演进照旧走版本号。
            store[fingerprint] = { cacheVersion: CACHE_VERSION, fingerprint, extractedAt: extractedAt || '', canon, ...(meta && typeof meta === 'object' ? meta : {}) };
            const keys = Object.keys(store);
            if (keys.length > CACHE_MAX) {
                keys.sort((a, b) => String(store[a].extractedAt || '').localeCompare(String(store[b].extractedAt || '')));
                for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete store[k];
            }
        },
        size() { return Object.keys(store).length; },
        keys() { return Object.keys(store).slice().sort(); },
    };
}

// story-world-v2/web/book-source.js
// ★★★leg80（丙-web · **第五格**）：**取书族**从 `web/index.js` 搬到这里。
//
// 为什么单独成家（不是为了行数，是为了**归属正确**）：
//   "从 ST 世界书取到原文、并在正文里定位到某个名号"这件事，此前**整个住在 3000 行接线层的中段**
//   （第一块在第 957 行、第二块掠过 150 行别人的代码、第三块在第 1199 行）——而它的**下游**早就出去了：
//   `src/entity-lookup.js`（选择/查询/回写判据）、`src/init-source.js`（起根设定源）都在 `src/` 里，
//   `web/index.js` 只剩"把书递进去 + 落盘"的接线。
//   ⇒ 搬出来之后：**"书怎么取、名号怎么定位"只有这一个文件管**（三条消费路都直接问它）。
//
// ★★本族**真正的承重墙**（别改回去）：取书的**三态语义**——
//   `{ ok: true, entries: [...] }` = 书读到了（条目可能为空 = 书里真没有）；
//   `{ ok: false }`           = **书没读到**（取书炸了/一本都没取到）⇒ 调用方**不写任何痕迹**，下轮再试。
//   旧法失败时 `return []`，与"书里没有"同形 ⇒ 引擎把"读不到书"记成「书未明述」并**永久锁死**该栏
//   （违反硬规矩「绝不用空值反推『书里没有』」）。实测代价：用户真账 563 实体、`location` 占位值「未明」563。
//
// ★依赖方向（单向，叶子）：`web/index.js → web/book-source.js → ../src/init-source.js`。
//   本文件**不许**反向 import `web/index.js`（那会成环），也不许 import `./idb-backend.js` 那类
//   "要在浏览器里才活"的适配层（Node 侧 `node --test` 直接导入本模块）。
//
// ★本族**特有的形态（别照别的族抄）**：它**不吃 `window`**，而是**把 ctx 当形参收**——
//   `collectWorldInfoEntries(ctx, character)` / `pickCharacter(ctx)` / `worldBookCached(ctx)`。
//   为什么：接线层的 `getCtx()` 读的是 `window.SillyTavern` ⇒ 若不收形参，本模块就**必须**在浏览器里才活，
//   而"名号定位"那三档（纯字符串函数）本该在 Node 里被直接真测（`test/lookup-batch.test.js` 正在测它们）。
//   ⇒ 唯一持有 ctx 的地方仍然是接线层的 `getCtx()`，本模块只是**每一次调用都现取**。
//   ★★★纪律同 leg79 §2「视图对象按值取、不许抓死」：**ctx 不许在本模块里被缓存**——
//     它每轮都可能换（换聊天/换卡），抓死一份就是"面板读着上一本书"（静默、不报错）。

import { normalizeEntryKey } from '../src/init-source.js';   // 条目指纹的键归一（与起根同一份契约）

export function characterWorldNames(character) {
    const out = [];
    const seen = new Set();
    const push = (v) => {
        const s = String(v ?? '').trim();
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    };
    push(character?.world);                            // 卡上写的 ST 世界信息名
    push(character?.data?.extensions?.world);          // 另一种 ST 卡格式（数据段）
    push(character?.extensions?.world);                // data.extensions 之外的 extensions 段
    return out;
}

export function characterBookEntries(character) {
    const book = character?.character_book || character?.data?.character_book;
    const raw = book?.entries;
    const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
    return list.filter((e) => e && typeof e === 'object').map((e, i) => ({
        uid: e.id ?? i,
        key: Array.isArray(e.keys) ? e.keys : (e.key ?? []),
        keysecondary: e.secondary_keys ?? [],
        comment: e.comment ?? '',
        content: String(e.content ?? ''),
        disable: e.enabled === undefined ? Boolean(e.disable) : !e.enabled,
    })).filter((e) => e.content);
}


export async function collectWorldInfoEntries(ctx, character) {
    const legacy = ctx?.worldInfo;
    if (Array.isArray(legacy)) return { entries: legacy, worldSources: null, readable: true };
    if (legacy && typeof legacy === 'object' && Array.isArray(legacy.entries)) return { entries: legacy.entries, worldSources: null, readable: true };
    const names = [];
    const seenName = new Set();
    const push = (n) => { if (n && typeof n === 'string' && n.trim() && !seenName.has(n)) { seenName.add(n); names.push(n.trim()); } };
    push(character?.world); // 卡上写的世界信息名（v1 同款：单卡 z 情形靠它）
    const chatWi = ctx?.chatMetadata?.['world_info']; // 聊天级挂载（ST assignLorebookToChat 写 chat_metadata.world_info）
    if (typeof chatWi === 'string') push(chatWi); else if (Array.isArray(chatWi)) for (const n of chatWi) push(n);
    for (const n of (ctx?.extensionSettings?.world_info?.globalSelect ?? [])) push(n);
    for (const n of Object.keys(ctx?.extensionSettings?.world_info ?? {})) push(n);
    const fpOf = (e) => {
        const content = String(e?.content ?? '').trim();
        if (!content) return null;
        return `${normalizeEntryKey(e)}\u0000${content}`;   // 契约来自 init-source（键归一 + 正文）
    };
    const entries = [];
    const seenFp = new Set();
    let dupEntries = 0;
    const addEntry = (e) => {
        if (!e || typeof e !== 'object') return;
        const fp = fpOf(e);
        if (fp) {
            if (seenFp.has(fp)) { dupEntries += 1; return; }
            seenFp.add(fp);
        }
        entries.push(e);
    };
    for (const e of characterBookEntries(character)) addEntry(e);   // 卡内置书：不花 loadWorldInfo，先收
    let loadedAny = false;
    const worldSources = [];
    for (const name of names) {
        try {
            const w = typeof ctx?.loadWorldInfo === 'function' ? await ctx.loadWorldInfo(name) : null;
            const raw = w?.entries;
            const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : null);
            const ok = Boolean(list?.length);
            if (ok) loadedAny = true;
            worldSources.push({ name, ok, entries: list?.length ?? 0 });
            if (list) for (const e of list) addEntry(e);
        } catch (err) {
            worldSources.push({ name, ok: false, entries: 0 });
        }
    }
    return { entries, worldSources, readable: loadedAny || entries.length > 0, dupEntries };
}

export function pickCharacter(ctx) {
    if (ctx?.character && typeof ctx.character === 'object') return ctx.character; // 已解析好的 ST 卡
    const chars = ctx?.characters;
    if (!Array.isArray(chars)) return null;
    if (ctx?.groupId != null) {
        const g = Array.isArray(ctx.groups) ? ctx.groups.find((x) => String(x?.id) === String(ctx.groupId)) : null;
        const avatars = Array.isArray(g?.members) ? g.members : [];
        for (const av of avatars) { const m = chars.find((c) => c?.avatar === av); if (m) return m; }
        return null;
    }
    const chid = Number(ctx?.characterId);
    if (Number.isInteger(chid) && chid >= 0 && chars[chid]) return chars[chid];
    return null;
}


// 取书结果按会话缓存。三态语义（**"读不到"与"书里没有"必须分形**——硬规矩二）：
//   `{ ok: true, entries: [...] }` = 书读到了（条目可能为空 = 书里真没有）
//   `{ ok: false }`           = **书没读到**（取书炸了/一本都没取到）→ 调用方**不写任何痕迹**，下轮再试
//   旧法失败时 `return []`，与"书里没有"同形 ⇒ 引擎把读不到书记成「书未明述」并**永久锁死**该栏
//   （违反硬规矩「绝不用空值反推『书里没有』」）。另：取书结果按会话缓存（原实现每个实体重取一遍全量书）。
let sw2BookCache = null;   // { names, entries, readable }——只活在内存，loadWorld 时清
export function resetBookCache() { sw2BookCache = null; }

async function worldBookCached(ctx) {
    if (sw2BookCache) return sw2BookCache;
    const character = pickCharacter(ctx);
    const { entries, readable } = await collectWorldInfoEntries(ctx, character);
    sw2BookCache = { entries: entries || [], readable };
    return sw2BookCache;
}

// leg25 f 修（**接线类缺陷，本棒最重的一条**）：位置继承（零 token 结构推断，`deriveLocationFromBook`）
//   要的是**原始 ST 条目**（`comment`=条目名 / `content`=正文 / `key`=键数组）——它自己按条目名与
//   正文成员行匹配实体，**不经过查书那套"按名号取三档文本"**，所以不能复用 `bookTextForEntity`。
// 旧法为什么一次都没生效（三处断头，全在接线层）：
//   ① `lookupOneEntity` 调 `bookEntriesCached()`——**该函数全仓从未定义**（只有 `worldBookCached`），
//      点面板行的「查/重查」当场抛 `ReferenceError`；
//   ② `runBatchChunk`（批量补全）与 `advanceTick` 的 preStep（每轮前置步）**压根没传 `bookEntries`**
//      ⇒ `runBatchLookup` 里 `bookEntries == null` ⇒ `withInherit` 原样返回世界 ⇒ 推断跑 0 次；
//   ③ 全量测试没有任何一条把 `bookEntries` 喂给这两个收口 ⇒ "接线断了而测试全绿"（本仓常客）。
// 实测代价（用户真账 563 实体）：`location` 真值 0 / 占位值「未明」563——面板整列「未载」。
// 该函数提成**导出**是为了能被真测（与 `autoComposeSource` 同一治法）：注入 fake ST ctx 真跑。
// 失败语义（与查书路同纪律）：**取不到书就返回空数组 = 本轮不推断**，绝不猜位置、绝不阻塞调用方。
// ★★leg80：本口**签名一个字没改**（仍然零参）——证据是外面真有消费者按零参用它：
//   `test/location-inherit-wiring.test.js` 装好 fake ST ctx 之后直接 `mod.bookEntriesForInherit()`。
//   ⇒ 它像 `collectWorldInfoEntries` 一样，**自己去找 ctx**（`getCtx` 是接线层注入进来的；
//     本模块其余的口都是"ctx 当形参收"——两种形状并存是**故意的**：这一口是"当前会话的书"，
//     与 `getCtx()` 的语义同一件事；其余几口是纯的，谁调谁给 ctx）。
let getCtx = () => null;
/** 接线层注入"当前 ST 上下文怎么取"（★注入的是**函数**，不是值——值会在建模块那一刻冻住）。 */
export function setCtxSource(fn) { if (typeof fn === 'function') getCtx = fn; }

export async function bookEntriesForInherit() {
    try {
        const book = await worldBookCached(getCtx());
        if (!book?.readable) return [];          // 书没挂载/读不到 ⇒ 结构推断没得依据（≠ 书里没有）
        return Array.isArray(book.entries) ? book.entries : [];
    } catch (err) {
        console.warn('[story-world-v2] 位置继承：取书失败（本轮不推断，世界照常推进）', String(err?.message || err));
        return [];
    }
}

// ★leg40：**世界书正文**（供"从世界源起根"用）——与 `bookEntriesForInherit` 同一份缓存，只多拼一段文本。
//   为什么另起一个函数而不是在起根处现拼：取书要 await + 失败兜底，散在调用点会长出第二份"取书口径"。
//   格式与 `autoComposeSource` 的世界信息一致（## 条目名 + 正文），起根提示词与设定抽取读到的就是同一种书文。
//   失败语义同 `bookEntriesForInherit`：**取不到书就返回空文本**（起根会如实报"世界源正文为空"，绝不猜）。
export async function bookTextForRoots(ctx) {
    try {
        const book = await worldBookCached(ctx);
        if (!book?.readable) return { text: '', entries: 0 };
        const entries = Array.isArray(book.entries) ? book.entries : [];
        const text = entries
            .map((e) => `## ${String(e?.comment || e?.key?.[0] || '').trim()}\n${String(e?.content ?? '')}`)
            .join('\n\n');
        return { text, entries: entries.length };
    } catch (err) {
        console.warn('[story-world-v2] 起根：取书失败（本轮不起根，世界照常载入）', String(err?.message || err));
        return { text: '', entries: 0 };
    }
}

// B6（leg25 d，细案 spec-lookup-batch-refresh §B6）：在条目正文里**定位到该名号自己那一行**。
//   为什么值得做：v2 只会"命中条目→整条给"，而用户的书格式高度规整——
export function locateNameLine(content, name) {    const text = String(content ?? '');
    const nm = String(name ?? '').trim();
    if (!text || !nm) return null;
    // 行首（可带列表符号）出现名号，**紧跟着**冒号或圆括号属性 = 该名号自己那一行；
    //   名号后面先跟别的字（`吞天妖王 与 金刚狮王 (…) 交战。`）⇒ 明确**不认**（防跨名号抓错人）。
    const re = new RegExp(`^[-*·•\\s]*${escapeRegExp(nm)}\\s*(?:[：:]|\\()([^\\n]*)`, 'm');
    const m = re.exec(text);
    return m ? m[0].trim() : null;
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function locateNameSnippet(content, name) {
    const EXPAND = 160;   // 名号前后各取多少字符（够一句上下文，又不至于把整条灌进 prompt）
    // ★边界优先级（leg25 d 的判据抓过一次）：**先找句读/换行（硬边界），找不到才退到逗号（软边界）**。
    //   旧法见逗号就停 ⇒「…吞天妖王于北荒现身，」——把紧跟其后的「气息T8大乘中期」切掉了，
    //   模型看不到档位原话 ⇒ 记 absent ⇒ **假的「书未明述」**（与本仓一直在治的那种病同款）。
    const hardStop = /[\n。！？；]/;
    const softBreak = /[，、]/;
    const text = String(content ?? '');
    const nm = String(name ?? '').trim();
    if (!text || !nm) return null;
    const m = new RegExp(escapeRegExp(nm)).exec(text);
    if (!m) return null;
    const scan = (dir) => {
        let hard = null;
        let soft = null;
        if (dir < 0) {
            for (let i = m.index - 1; i >= 0 && m.index - i <= EXPAND; i -= 1) {
                if (hardStop.test(text[i])) { hard = i + 1; break; }
                if (soft === null && softBreak.test(text[i])) soft = i + 1;
            }
        } else {
            const end = m.index + nm.length;
            for (let i = end; i < text.length && i - end <= EXPAND; i += 1) {
                if (hardStop.test(text[i])) { hard = i; break; }
                if (soft === null && softBreak.test(text[i])) soft = i;
            }
        }
        return { hard, soft };
    };
    const fromSide = scan(-1);
    const toSide = scan(1);
    const from = fromSide.hard !== null ? fromSide.hard : (fromSide.soft !== null ? fromSide.soft : Math.max(0, m.index - EXPAND));
    const to = toSide.hard !== null ? toSide.hard : (toSide.soft !== null ? toSide.soft : Math.min(text.length, m.index + nm.length + EXPAND));
    const seg = text.slice(from, to).trim();
    return seg || null;
}

export function bookEntryText(content, name, cap = 1200) {
    const raw = String(content ?? '');
    const line = locateNameLine(raw, name);
    if (line) return { text: line, located: 'line' };
    const snippet = locateNameSnippet(raw, name);
    if (snippet) return { text: snippet, located: 'snippet' };
    return { text: raw.slice(0, cap), located: 'none' };   // 定位不到才整条截断（cap 内），并如实标 located
}

export async function bookTextForEntity(entity, ctx) {
    const name = String(entity?.name || '').trim();
    if (!name) return { ok: true, entries: [] };
    let book;
    try {
        book = await worldBookCached(ctx);
    } catch (err) {
        console.warn('[story-world-v2] 查书：取书失败（**不是"书里没有"**，不写任何痕迹，下轮再试）', String(err?.message || err));
        return { ok: false };
    }
    if (!book.readable) {
        console.warn('[story-world-v2] 查书：一本书都没读到（世界书没挂载/未加载）——本轮不写痕迹');
        return { ok: false };
    }
    const hit = (book.entries || []).filter((e) => {
        const comment = String(e?.comment || '').trim();
        const keys = Array.isArray(e?.key) ? e.key : [e?.key];
        return comment === name || comment.includes(name) || keys.map((k) => String(k ?? '').trim()).includes(name);
    });
    return {
        ok: true,
        entries: hit.slice(0, 4).map((e) => {
            const picked = bookEntryText(e?.content, name);
            return {
                name: String(e?.comment || name).trim(),
                text: picked.text,
                located: picked.located,
            };
        }).filter((x) => x.text),
    };
}


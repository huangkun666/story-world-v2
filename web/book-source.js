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

import { composeInitSource } from '../src/init-source.js';
import { entrySelectionId } from '../src/abstract-selection.js';
import { entityKeysOf } from '../src/entity-identity.js';

let selectionSource = () => ({ mode: 'default' });
export function setAbstractSelectionSource(fn) { selectionSource = typeof fn === 'function' ? fn : () => ({ mode: 'default' }); resetBookCache(); }
import { bookFingerprint } from '../src/fp-hash.js';                            // ★leg112：书指纹（与抽取同一条算法）；★leg159c 改名（原名撞广告过滤器）
import { checkBookSource } from '../src/book-check.js';                          // ★leg112：换书检测（纯函数，只判断不说谎）
import { macroNamesFromCtx } from '../src/macros.js';                            // ★leg148：酒馆宏的真名对

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
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        ...e,
        uid: e.uid ?? e.id,
        key: Array.isArray(e.keys) ? e.keys : (e.key ?? []),
        keysecondary: e.secondary_keys ?? [],
        comment: String(e.comment ?? '').trim() || String(e.name ?? '').trim(),
        content: String(e.content ?? ''),
        disable: e.enabled === undefined ? Boolean(e.disable) : !e.enabled,
    }));
}


export async function collectWorldInfoEntries(ctx, character) {
    const legacy = ctx?.worldInfo;
    const legacyEntries = Array.isArray(legacy) ? legacy : Array.isArray(legacy?.entries) ? legacy.entries : null;
    const names = [];
    const seenName = new Set();
    const push = (n) => { if (n && typeof n === 'string' && n.trim() && !seenName.has(n)) { seenName.add(n); names.push(n.trim()); } };
    for (const name of characterWorldNames(character)) push(name);
    const chatWi = ctx?.chatMetadata?.['world_info']; // 聊天级挂载（ST assignLorebookToChat 写 chat_metadata.world_info）
    if (typeof chatWi === 'string') push(chatWi); else if (Array.isArray(chatWi)) for (const n of chatWi) push(n);
    for (const n of (ctx?.extensionSettings?.world_info?.globalSelect ?? [])) push(n);
    const entries = [];
    const seenFp = new Set();
    let dupEntries = 0;
    const addEntry = (e) => {
        if (!e || typeof e !== 'object') return;
        const fp = entrySelectionId(e);
        if (fp) {
            if (seenFp.has(fp)) { dupEntries += 1; return; }
            seenFp.add(fp);
        }
        entries.push(e);
    };
    for (const e of characterBookEntries(character)) addEntry({ ...e, _sw2Source: `character:${character?.name || ''}` });
    if (legacyEntries) {
        for (const entry of legacyEntries) addEntry(entry);
        return { entries, worldSources: null, readable: true, incomplete: false, dupEntries };
    }
    let loadedAny = false;
    let failedAny = false;
    const worldSources = [];
    for (const name of names) {
        try {
            const w = typeof ctx?.loadWorldInfo === 'function' ? await ctx.loadWorldInfo(name) : null;
            const raw = w?.entries;
            const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : null);
            const ok = Boolean(list);
            if (ok) loadedAny = true; else failedAny = true;
            worldSources.push({ name, ok, entries: list?.length ?? 0 });
            if (list) for (const e of list) addEntry({ ...e, _sw2Source: name });
        } catch (err) {
            failedAny = true;
            worldSources.push({ name, ok: false, entries: 0 });
        }
    }
    // ★★（Task 1 复查项 3）：**"读到空书"与"没读全"必须分形**——
    //   `readable` 只说"至少有一处读到了"；`incomplete` 说"还有挂载来源没读到"。
    //   把两者并成一个，就会把"某本挂载书没读到"当成"书里没有该名号"（引擎据此写永久 absent）。
    return { entries, worldSources, readable: loadedAny || entries.length > 0, incomplete: failedAny, dupEntries };
}

// ★★★（Task 1 二次复查 Important 2）：**legacy 世界书来源的引用与版本**。
//   病灶：下面的 live 归属只看 `bookContextIdentity`（聊天/角色/挂载设置）——**不含**宿主的 `ctx.worldInfo`
//   数组 ⇒ 同一场对话里换掉那份 legacy 世界书（新数组、新正文）时，异步边界上的归属校验照样通过，
//   未完成的旧请求就把旧书交出去（继承交回旧正文、缓存按旧 owner 命中）。它**不是**切聊天，
//   所以 `CHAT_CHANGED → loadWorld → resetBookCache` 那条路不会响。
//   口径：语义归属之外，**快照并校验来源的引用与版本**——
//     · 引用：`ctx.worldInfo` 数组本体（换数组 = 换来源）；
//     · 版本：逐格条目身份 + 正文/题名/键的 32 位 FNV-1a（**原地改**也算换来源：push、改正文、
//       改触发词、换掉某一格都看得见）。
//   ★代价如实说：版本是 O(全书字符数) 的只读扫描（缓存命中那一步也要算一次）。为什么不做更省的
//     "只比长度"：正文长度相同的**换书**（同 uid 同长度、内容不同）正是这份缓存最容易静默串书的一格
//     （重审夹具就是它）——那正是这条口径要治的病，省掉它等于没治。取书本身是异步 I/O，这个量级可接受。
//   ★不改宿主数据、不缓存外来对象；旧宿主没有 `worldInfo` 时恒为 `'null'`（零动作）。
function legacyEntriesOf(ctx) {
    const legacy = ctx?.worldInfo;
    return Array.isArray(legacy) ? legacy : Array.isArray(legacy?.entries) ? legacy.entries : null;
}
function fnv1a32(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
}
// ★★★（Task1 末次复查 · Important 2）：版本 = **逐格读取/身份字段的独立快照**（规范 JSON），不是拼接串。
//   病灶（旧法两处）：① **漏了 `constant`**——它是"恒注入壳"的判据，原地 false→true 会改实际取料
//     （禁用仓料从"不读"变"读"），而版本读数一个字不变 ⇒ 热缓存/继承/起根/指纹继续吃旧书；
//   ② **把成对的回退字段合并**——`uid ?? id`、`comment ?? name`、`key ?? keys`、`disable/enabled` 压成
//     一位 ⇒ 同引用原地在这些格之间挪值（`key: [] → keys: ['乙']`、`comment: '' → name: '乙'`）看不见。
//   口径：字段清单 = **实际解析路真的读的那些**（`entrySelectionId`/`titleOf`/`labelOf`/取料判据）：
//     uid、id、comment、name、key、keys、content、constant、disable、enabled、`_sw2Source`。
//     **逐字段独立**（不合并回退）、**规范 JSON**（字段名与顺序固定、缺字段记 null，不靠分隔符消歧）；
//     **不扫无关的整对象元数据**（宿主元数据可能有环，且与取料无关）。
//   `content` 照旧取 32 位 FNV-1a（全书正文是这里最大的一格：哈希既判得了"同长度换书"，又不让
//   版本串按全书体积膨胀——缓存命中那一步每次都要算一遍）。
const LEGACY_VERSION_FIELDS = ['uid', 'id', 'comment', 'name', 'key', 'keys', 'content', 'constant', 'disable', 'enabled', '_sw2Source'];
function canonicalField(value) {
    if (value === undefined) return null;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.map(canonicalField);
    try { return JSON.parse(JSON.stringify(value)); } catch { return '[unrepresentable]'; }   // 环 / BigInt / 函数
}
function legacyBookVersion(entries) {
    if (!Array.isArray(entries)) return 'null';
    const rows = entries.map((e) => {
        const row = {};
        for (const field of LEGACY_VERSION_FIELDS) {
            let value = canonicalField(e?.[field]);
            // 来源名按解析路的口径归一（`entrySelectionId` 的 `sourceOf`：去首尾空白、折叠内部空白）——
            // 只有"实际身份会变"的改动才算换来源，纯空白噪声不该让缓存白重取一遍全书。
            if (field === '_sw2Source' && value !== null) value = String(value).trim().replace(/\s+/g, ' ');
            row[field] = field === 'content' ? fnv1a32(JSON.stringify(value)) : value;
        }
        return row;
    });
    return JSON.stringify(rows);   // 数组长度（条目数）本身也在 JSON 里
}
function legacySnapshot(ctx) {
    const entries = legacyEntriesOf(ctx);
    return { ref: entries, version: legacyBookVersion(entries) };
}
/** 这份读取抓的来源，与"现在这一份"是不是同一个来源（引用 + 版本）。 */
function sameLegacySource(snapshot, ctx) {
    const entries = legacyEntriesOf(ctx);
    return snapshot.ref === entries && snapshot.version === legacyBookVersion(entries);
}

// ★★★（Task 1 复查项 4）：**live 归属校验**。宿主换聊天/换卡/换来源时常常交一个**新对象**、
//   旧对象一个字不动——抓着旧对象跟自己比（旧法）永远相等 ⇒ 未完成的旧请求照样把旧书交出去
//   （继承、指纹两条路都中，而它们的契约写的是"当前会话的书"）。
//   `readLive` = 进入这次读取时"它读的就是 live 那本书"（身份相同即算：酒馆每次都交新外壳）。
//   是 ⇒ 结束时拿**现取的 live** 校验归属；否（显式传进来的外部快照：离线调用、Node 直测）
//   ⇒ 照旧比对自己那一刻的身份——外部 ctx 的契约一个字不改。
//   ★★（二次复查 Important 2）：live 校验同时要比 **legacy 来源快照**（引用 + 版本）——同一场对话里
//   换掉 `ctx.worldInfo` 也算换了来源（见上面 `legacySnapshot`）。
//   ★收尾补的一刀：**显式传进来的外部 ctx 也要认它自己那份来源**（`readLive` 为假时比的是**传进来的
//   那个 ctx**，不是现取的 live）——"读取途中来源换了 ⇒ 这份读取作废"是同一条纪律，两条路一个口径；
//   而外部快照的契约一个字不改：绝不许拿 live 的书去判一份故意传进来的别样快照。
function ownerSuperseded(ctx, ownerAtStart, legacyAtStart, readLive) {
    if (!readLive) return bookContextIdentity(ctx) !== ownerAtStart || !sameLegacySource(legacyAtStart, ctx);
    const source = getCtx();
    return bookContextIdentity(source) !== ownerAtStart || !sameLegacySource(legacyAtStart, source);
}
function readsLiveCtx(ctx, owner, legacyAtStart) {
    const live = getCtx();
    if (live == null || bookContextIdentity(live) !== owner) return false;
    // ★★（二次复查 Important 2）：身份相同还不等于"读着 live 那本书"——**故意传进来的外部快照**
    //   可能与现取 live 同一场对话、却拿的是另一份 legacy 世界书（离线对照/直测）⇒ 它不是 live 那本，
    //   不许拿 live 去判它的归属（否则外部 ctx 会被 live 的来源"误判作废"）。
    return sameLegacySource(legacyAtStart ?? legacySnapshot(ctx), live);
}

// ★★★leg112（C1 换书检测）：**把"现在挂的是哪本书"按抽取那条路重算一遍指纹**，与账上那份比对。
//   ★必须复用 `composeInitSource`：账上那个指纹由合订文本与有效题名共同计算（`src/abstract.js`，
//     两条抽取路同一行）⇒ 只有用**同一个合订算法**重算，两个指纹才可比（另拼一份 = 造第二把尺子）。
//   ★失败语义（照本文件既有三态）：**读不到书 / 没读全 / 没合订出文本 ⇒ `fresh: ''`** ⇒ 调用方一句话都不说。
//     **绝不拿"读不到"（或"只读到一部分"）当"书变了"**（红线 2；未读全这一态见下方 Task 1 复查遗留项 1）。
export async function currentBookFingerprint(ctx) {
    try {
        const session = JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId]);
        const generation = bookGeneration;
        const legacyAtStart = legacySnapshot(ctx);                      // ★二次复查：这份 legacy 来源的引用 + 版本
        const readLive = readsLiveCtx(ctx, bookContextIdentity(ctx), legacyAtStart);   // ★复查项 4：进入时抓的是不是 live 那本
        const character = await ensureCharacterLoaded(ctx);   // ★leg154：懒加载卡先要全卡（否则算出的是"名册那一层"的合订文本）
        const owner = bookContextIdentity(ctx);
        const { entries, worldSources, incomplete } = await collectWorldInfoEntries(ctx, character);
        if (generation !== bookGeneration || session !== JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId]) || ownerSuperseded(ctx, owner, legacyAtStart, readLive)) return { fresh: '', usedChars: 0, entries: 0 };
        // ★★★（dsh 有界跟进 · Task 1 复查遗留项 1）：**未读全 ⇒ 不判断**——绝不拿部分文本当"书换了"。
        //   病灶：本函数此前只看"合订出没出文本"，**不看** `collectWorldInfoEntries(...).incomplete`
        //   ⇒ 某本挂载书这次读不到（或卡还在懒加载）时，它拿**其余部分**算出一个"新指纹"，
        //   与账上（完整时算的）一比 ⇒ 当场报"书换了"——而书一个字没改，只是这次没读全。
        //   ★这与上面那条失败语义是**同一条红线**（`src/book-check.js` 口径②、本文件三态纪律）：
        //     "读不到/没读全" ⇒ `fresh: ''` ⇒ 调用方一句话都不说、下轮再试；宁可不说，绝不谎报。
        //   ★`character?.shallow` 单独算一态：浅卡时挂载来源可能全读到了（`incomplete` 为假），
        //     但**卡四件套也是这份指纹源的一部分**，没到手就同样只能"不知道"（与 `worldBookCached`
        //     的 `incompleteRead` 同一把尺）。★这不会削弱检测：账上指纹本就是四件套齐时算的。
        if (incomplete === true || character?.shallow === true) {
            console.warn('[story-world-v2] 换书检测：挂载来源本次没读全（**不是"书换了"**，这次不判断，下轮再试）');
            return { fresh: '', usedChars: 0, entries: (entries || []).length };
        }
        // ★★★leg148：**必须与 `autoComposeSource`（抽取那一条路）用同一份宏真名**——
        //   两处只要有一处替换、另一处不替换，算出来的就是**两个不同的合订文本** ⇒
        //   `stored !== fresh` ⇒ 每个玩家一开面板就被判"书换了"（假警报，而且看起来完全像真的）。
        //   ⇒ 口径：**换名这一步在两条路上都做，用的是同一把尺子**（`macroNamesFromCtx` 一处定义）。
        const macroNames = macroNamesFromCtx(() => ctx, character);
        const res = composeInitSource({ character, worldInfoEntries: entries || [], worldSources, macroNames, selection: selectionSource() });
        if (!res?.ok || !res.text) return { fresh: '', usedChars: 0, entries: (entries || []).length };
        return { fresh: bookFingerprint(res.text, res.titleRoster), usedChars: res.usedChars ?? res.text.length, entries: (entries || []).length };
    } catch (err) {
        console.warn('[story-world-v2] 换书检测：取书失败（这次不判断，世界照常载入）', String(err?.message || err));
        return { fresh: '', usedChars: 0, entries: 0 };
    }
}

/**
 * 载入期那一问：**账上那份设定，是从现在这本书抽的吗？**
 * @param {object} world 账上的世界（读 `context.setting.frozen.fingerprint`）
 * @param {object} [opts] `{ ctx }` 缺省自己现取当前 ST 上下文（与 `bookEntriesForInherit` 同一形状）
 * @returns {Promise<{changed:boolean, stored:string, fresh:string}|null>} null = 无从判断（不说任何话）
 */
export async function checkCurrentBook(world, { ctx = null } = {}) {
    const stored = String(world?.context?.setting?.frozen?.fingerprint ?? '');
    if (!stored) return null;                                   // 老账没有指纹 ⇒ 无从比对（空着就是空着）
    const got = await currentBookFingerprint(ctx || getCtx());
    return checkBookSource({ stored, fresh: got.fresh, sourceOk: Boolean(got.fresh) });
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

// ★★★leg154（**社区用户报的 bug** · 2026-09-30）：**懒加载卡**。
//   酒馆有个性能开关 `performance.lazyLoadCharacters`（`src/endpoints/characters.js:35`）。
//   打开之后角色列表接口只交回**名册那一层**——
//   `{ shallow: true, name, avatar, tags, data: { name, creator, … } }`，
//   而 **description / personality / scenario / first_mes 与"卡上挂的那本世界书"一个字都不在里面**。
//   ST 自己就靠 `shallow === true` 这个键决定"要不要再去取全卡"（`unshallowCharacter` →
//   `getOneCharacter` → **按头像找到那一格、原地换掉**；群聊那一口 `unshallowGroupMembers` 也是照这个循环写的）。
//   ⇒ 旧法读卡时从没问过这一句：卡还在懒加载，就把「角色卡四件套全空；世界信息/内置书为空」报给用户，
//     而**他的书好端端地挂在卡上**（读不到 ≠ 书里没有——本文件顶上第一条承重墙）。
//
//   ★这一口只做一件事：**读卡之前先问 ST 要一次全卡**。不是懒加载卡 ⇒ 一个字都不动。
//   ★永不抛：老 ST / 残缺上下文 / 取回失败 ⇒ 照旧把手上那份交出去（调用方据此如实报"还没加载完"，
//     绝不假装书里没有）。失败只记一行 console，不打断世界。
export async function ensureCharacterLoaded(ctx) {
    const picked = pickCharacter(ctx);
    if (!picked || picked.shallow !== true) return picked;      // 不是懒加载卡（或压根没卡）⇒ 零动作
    try {
        if (typeof ctx?.unshallowCharacter === 'function') {
            // ★按"我们刚挑中的那一格"算下标：单卡、群聊成员、欢迎页那位助手都是同一条路
            //   （ST 自家的 `unshallowGroupMembers` 也是这么找人的——同一把尺，不另立）。
            const chars = Array.isArray(ctx.characters) ? ctx.characters : [];
            const idx = chars.indexOf(picked);
            const id = idx >= 0 ? idx : ctx.characterId;
            if (id !== undefined && id !== null && id !== '') await ctx.unshallowCharacter(String(id));
        }
    } catch (err) {
        console.warn('[story-world-v2] 角色卡是懒加载卡，向 ST 要全卡失败（这次照旧读，下轮再试）', String(err?.message || err));
    }
    return pickCharacter(ctx) || picked;   // 取回之后**重挑一次**（ST 是原地换掉那一格，旧的引用已作废）
}


// 取书结果按会话缓存。三态语义（**"读不到"与"书里没有"必须分形**——硬规矩二）：
//   `{ ok: true, entries: [...] }` = 书读到了（条目可能为空 = 书里真没有）
//   `{ ok: false }`           = **书没读到**（取书炸了/一本都没取到）→ 调用方**不写任何痕迹**，下轮再试
//   旧法失败时 `return []`，与"书里没有"同形 ⇒ 引擎把读不到书记成「书未明述」并**永久锁死**该栏
//   （违反硬规矩「绝不用空值反推『书里没有』」）。另：取书结果按会话缓存（原实现每个实体重取一遍全量书）。
let sw2BookCache = null;   // { names, entries, readable }——只活在内存，loadWorld 时清
let bookGeneration = 0;
export function resetBookCache() { sw2BookCache = null; bookGeneration += 1; }

export function bookContextIdentity(ctx) {
    const character = pickCharacter(ctx);
    return JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId, character?.avatar, character?.name, characterWorldNames(character), character?.shallow,
        ctx?.chatMetadata?.world_info, ctx?.extensionSettings?.world_info]);
}

// ★★★（Task 2 复查 · Important 1/2）：**跨模块共用的"来源所有者"**（页面接线与取书缓存同一把尺）。
//   病灶：页面接线（`web/panel-tools.js`）此前只拿 `chatId` 当护栏，而"**同一场聊天**里换卡、
//   换挂载、换掉宿主那份 legacy 世界书"同样是换了书源 —— `chatId` 一个字没变，`bookContextIdentity`
//   看不见 `ctx.worldInfo` 的引用/版本 ⇒ 晚到的旧读取照旧把旧卡的迁移写进"现在是新卡"的那一格，
//   旧事件也照旧写进新所有者那一格。
//   口径：**"什么算同一份来源"只有这一处**（与取书缓存同一把尺）。页面接线与页面控制器都调它，
//   谁都不许再拼第二份"来源身份"。
//   · `captureSourceOwner(ctx)`：在任何 await **之前**抓一份所有者（聊天 + 卡槽 + 挂载 + 是否浅卡
//     + legacy 世界书的引用与内容版本）；
//   · `sourceOwnerSuperseded(owner, ctx)`：这一份还是不是现在这一份（全等比较）；
//   · `sourceOwnerLoadingAdvanced(owner, ctx)`：**唯一允许的"变了"** —— 同一张卡从名册那一层
//     （`shallow`）变成全卡（`ensureCharacterLoaded` 正是为它存在的）。卡槽换了、聊天换了、
//     legacy 书换了都不算"加载推进"，照旧作废。
//   ★owner 里带着**私有的** legacy 快照（引用 + 逐字段版本），模块外只当**不透明记录**用：
//     版本算法只有 `legacyBookVersion` 一份，不外泄、也不许调用方按别的方式重算一遍。
/** 卡槽身份（`shallow` 与卡字段都在外）：同一格 + 同头像/名字 = 同一张卡。 */
function cardSlotOf(ctx) {
    const character = pickCharacter(ctx);
    return JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId, character?.avatar, character?.name]);
}
/**
 * 这一份 legacy 来源的**内容**还是不是同一本（页面归属用这一条）。
 * ★为什么比取书缓存那条路宽一格（严的那条仍是 `sameLegacySource`：引用 + 版本）：页面接线每一轮
 *   都经 `window.SillyTavern.getContext()` **现取**上下文，宿主完全可能交一个**新数组壳**而书一个字
 *   没改；若把"换壳"也当"换书"，页面会把用户的每一次点击都判成过期（点一次丢一次，页面不可用）。
 *   决定"是不是同一本书"的是**内容**（逐字段规范 JSON 指纹：号/题名/键/正文/恒注入/禁用/来源，
 *   连顺序与条数），**原地改**（push、改正文、改触发词）照样看得见。
 *   ★宿主没有 legacy 世界书时（模块化 ST 的 `getContext()` 就没有 `worldInfo`）恒为 `'null'`，零扫描。
 */
function sameLegacyContent(snapshot, ctx) {
    return snapshot.version === legacyBookVersion(legacyEntriesOf(ctx));
}
export function captureSourceOwner(ctx) {
    const legacy = legacySnapshot(ctx);
    const identity = bookContextIdentity(ctx);
    return { scope: String(ctx?.chatId || 'default'), key: `${identity}\u0000${legacy.version}`, identity,
        slot: cardSlotOf(ctx), mounts: JSON.stringify([ctx?.chatMetadata?.world_info, ctx?.extensionSettings?.world_info]),
        shallow: pickCharacter(ctx)?.shallow === true, legacy };
}
/** 这一份所有者还是不是现在这一份（聊天/卡/挂载/浅卡状态/legacy 书的内容，全等）。 */
export function sourceOwnerSuperseded(owner, ctx) {
    if (!owner) return false;
    if (String(ctx?.chatId || 'default') !== owner.scope) return true;
    if (bookContextIdentity(ctx) !== owner.identity) return true;
    return !sameLegacyContent(owner.legacy, ctx);
}
/** 同一张卡从浅卡变全卡（我们自己去要的那一次加载）——不算换来源；其余任何变化都不算。 */
export function sourceOwnerLoadingAdvanced(owner, ctx) {
    if (!owner?.shallow) return false;                        // 抓这份时卡就是全的 ⇒ 任何变化都是换来源
    if (pickCharacter(ctx)?.shallow === true) return false;  // 仍是浅卡，不是加载完成
    if (String(ctx?.chatId || 'default') !== owner.scope) return false;
    if (cardSlotOf(ctx) !== owner.slot) return false;         // 换了卡槽就不是"同一张卡在加载"
    if (JSON.stringify([ctx?.chatMetadata?.world_info, ctx?.extensionSettings?.world_info]) !== owner.mounts) return false;
    return sameLegacyContent(owner.legacy, ctx);
}

async function worldBookCached(ctx) {
    const owner = bookContextIdentity(ctx);
    const session = JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId]);
    const generation = bookGeneration;
    const legacyAtStart = legacySnapshot(ctx);   // ★二次复查：这份 legacy 来源的引用 + 版本（下面两道边界都验）
    const readLive = readsLiveCtx(ctx, owner, legacyAtStart);   // ★复查项 4：进入时抓的是不是 live 那本（见 ownerSuperseded）
    function resolve(got) {
        const composed = composeInitSource({ character: got.character, worldInfoEntries: got.entries, worldSources: got.worldSources,
            macroNames: macroNamesFromCtx(() => ctx, got.character), selection: selectionSource() });
        return { ...got, entries: composed.effectiveEntries, composed };
    }
    // ★★（二次复查 Important 2）：缓存命中也要认来源——**同一场对话换掉 legacy 数组**（或原地改它）
    //   就不再是同一本书（此前只比 `ctx.worldInfo` 引用，原地改看不见；重审夹具正是换数组那一格）。
    if (sw2BookCache && sw2BookCache.owner === owner && sw2BookCache.worldInfo === ctx?.worldInfo
        && sw2BookCache.legacyVersion === legacyBookVersion(legacyEntriesOf(ctx))) return resolve(sw2BookCache);
    const character = await ensureCharacterLoaded(ctx);   // ★leg154：懒加载卡先要全卡（否则卡上那本书根本看不见）
    const loadedOwner = bookContextIdentity(ctx);
    const { entries, readable, worldSources, incomplete } = await collectWorldInfoEntries(ctx, character);
    if (generation !== bookGeneration || session !== JSON.stringify([ctx?.chatId, ctx?.characterId, ctx?.groupId]) || ownerSuperseded(ctx, loadedOwner, legacyAtStart, readLive)) return { readable: false, entries: [], incomplete: true, composed: { text: '', sourceItems: [] } };
    const hasCardText = character?.shallow !== true && ['description', 'scenario', 'personality', 'first_mes'].some(field => String(character?.[field] ?? character?.data?.[field] ?? '').trim());
    // ★★（Task 1 复查项 3）：**未读全**（有挂载书没读到 / 卡四件套还没到手）与"读到空书"分形：
    //   前者不许缓存（失败来源必须能重试），下游也不许拿它当"书里没有"。
    const incompleteRead = incomplete === true || character?.shallow === true;
    const got = { owner: loadedOwner, worldInfo: ctx?.worldInfo, legacyVersion: legacyAtStart.version, character: character ? structuredClone(character) : null, entries: structuredClone(entries || []), worldSources,
        readable: readable || hasCardText, incomplete: incompleteRead };
    // ★★★leg154：**读不到就别缓存**——本文件顶上那条三态纪律写着"读不到 ⇒ 下轮再试"，
    //   而旧实现把空结果也缓存了 ⇒ 那个"下轮"永远吃同一份空结果（纪律与实现对不上：静默、不报错）。
    //   生产上咬到过两次：① 页面刚起来时 ST 的角色列表还没到；② 卡还在懒加载（上面那一口正在治它）。
    //   ★只有**真读到**才缓存——这样"每个实体重取一遍全量书"那个老毛病也不会回来。
    //   ★复查项 3 扩展：**读全**才算——部分失败的那一份也不许缓存（否则失败来源永不重试）。
    if (got.readable && !got.incomplete) sw2BookCache = got;
    return resolve(got);
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
        return { text: book.composed.text || '', entries: book.entries.length };
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
    for (const confirmedName of Array.isArray(name) ? name : [name]) {
        const line = locateNameLine(raw, confirmedName);
        if (line) return { text: line, located: 'line' };
        const snippet = locateNameSnippet(raw, confirmedName);
        if (snippet) return { text: snippet, located: 'snippet' };
    }
    return { text: raw.slice(0, cap), located: 'none' };   // 定位不到才整条截断（cap 内），并如实标 located
}

export async function bookTextForEntity(entity, ctx) {
    const name = String(entity?.name || '').trim();
    if (!name) return { ok: true, entries: [] };
    const names = entityKeysOf(entity);
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
    const related = (book.entries || []).filter((e) => {
        const comment = String(e?.comment || '').trim();
        const keys = Array.isArray(e?.key) ? e.key : [e?.key];
        return names.some((n) => comment === n || comment.includes(n) || keys.map((k) => String(k ?? '').trim()).includes(n)
            || (e._sw2SourceKind === 'character-field' && e.content.includes(n)));
    });
    const hit = related.filter((e) => e.content.trim());
    if (!hit.length && book.incomplete) {
        // ★★（Task 1 复查项 3）：挂载来源**没读全**（某本书没读到 / 卡正文还没加载）⇒ 这一轮不许
        //   判"书里没有"（下游 `applyLookup` 会据此写永久 absent）。不写痕迹，下轮重试。
        console.warn('[story-world-v2] 查书：挂载来源本次没读全（**不是"书里没有"**，不写任何痕迹，下轮再试）');
        return { ok: false, reason: '挂载来源本次没读全，不据此判定书里没有' };
    }
    if (!hit.length && book.composed.sourceItems.some(s => s.selected && ['technical', 'stale-segments', 'unloaded', 'budget-excluded'].includes(s.status)
        && names.some((n) => s.title.includes(n) || (Array.isArray(s.entry.key) ? s.entry.key : [s.entry.key]).includes(n)))) return { ok: false, reason: '相关来源本次未生效，不据此判定书里没有' };
    return {
        ok: true,
        entries: hit.slice(0, 4).map((e) => {
            const picked = bookEntryText(e?.content, names);
            return {
                name: String(e?.comment || name).trim(),
                text: picked.text,
                located: picked.located,
                // ★★★Task 4（integration boundaries）：**来源身份**跟着条目一起交出去。
                //   为什么必须在这里写、而不是让查书那层自己编号：查书要能回答"这条字段值凭哪一条条目入账"，
                //   而条目名会重复（两本书同名的条目）⇒ 身份 = 来源名 + 条目 uid（旧 ST 字段原样保留）。
                //   它只用于**本次调用的出处核对**（`src/entity-lookup.js` 的 `freezeLookupTargets`）；
                //   原始凭证不落世界账（与抽取/起根同一条纪律）。
                sourceId: `${String(e?._sw2Source || 'world-info').trim() || 'world-info'}#${String(e?.uid ?? e?.comment ?? name).trim()}`,
            };
        }).filter((x) => x.text),
    };
}


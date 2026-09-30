// story-world-v2/web/hot-ledger.js
// ★★★leg78（丙-web · **第三格**）：**热账（hot-meta）读写落盘子系统**从 `web/index.js` 搬到这里。
//
// 为什么单独成家（不是为了行数，是为了**归属正确**）：
//   这一族是一个**完整子系统**——自己的 7 个模块级状态、自己的编排（何时写内存 / 何时显式落盘 /
//   被别的副本覆盖了怎么抢回来 / 排队补写在飞窗口）、自己的超时档与重试环。
//   它此前**散在 3500 行接线层的六段里**（★与 leg72 记忆族、leg73 快照族**都不同**——那两族是连续块），
//   而且**参数块正夹在它中间** ⇒ 任何一处改"账本怎么写下去"都要先穿过一片无关代码。
//   ⇒ 搬出来之后：**账本怎么写/怎么落盘只有这一个文件管**。
//
// ★★搬法（本族特有，别照别族抄）：**六位置逐字节抽取**，不是整段剪切。
//   每个位置都从 `web/index.js` **原样搬来**（注释与代码一字未改），只动"它住哪" + "外面怎么够到它"：
//     ① `SW2_FLUSH_TIMEOUT_MS` / `sw2FlushTimeoutMs` / `SW2_FLUSH_TRIES` / `SW2_FLUSH_BACKOFF_MS` /
//        `sw2SetFlushTimeout` / 排队链两格
//     ② `SW2_SAVE_MIN_MS` / `sw2ExplicitChatName` / `sw2CallSaveChat` / 签名两函数 / 写的本体两格
//     ③ `reassertWrittenMetaIfClobbered` / `flushHotMeta`
//     ④ 热账那半的复位（`resetHotLedgerState`，原 `sw2ResetFlushState` 的前 8 行）
//     ⑤ 热账状态段（`sw2HotMetaFlushing` 等 7 格）
//     ⑥ `readHotMeta` / `writeHotMeta`
//
// ★★状态归属（本棒最该记住的一条，别改回去）：
//   热账的 **7 个**模块级状态**只住在本文件**，单一真源、不劈两半。
//   接线层要读账本 ⇒ `hotHub.readHotMeta()`；要写 ⇒ `hotHub.writeHotMeta()`；
//   要显式落盘 ⇒ `hotHub.flushHotMeta()`；测试要清簿记 ⇒ `hotHub.resetHotLedgerState()`。
//   ★为什么不让外面直接读写：那样"账本"就有两个家，一处改了另一处不知道——本仓最贵的病（"两份真相"）。
//
// ★★依赖方向（单向，叶子）：`web/index.js → web/hot-ledger.js`。
//   本文件**不许** import `web/index.js`（那会成环），也**不许** import `web/` 里别的接线层模块
//   ——★注意它连 `./snapshot-store.js` 与 `../src/param-hub.js` 都**不 import**：
//   那两样（`paramHub.reset()` / `snapHub.requestSnapshot()`）**是注入进来的**
//   （`createHotLedgerHub(deps)`，与 `createSnapshotHub` / `createParamHub` 同款先例）。
//   ⇒ 本模块**零 import**（叶子中的叶子）：这也顺手证明"热账"没有依赖任何别的子系统。
//
// ★★★两处"迟到的注入"（本族特有的坑，别改成直接引用）：
//   ① `snapHub` —— `writeHotMeta` 末尾要调 `snapHub.requestSnapshot(...)`（**唯一的落账收口**），
//      而快照 hub 由接线层**在本模块之后**才建（leg73 的次序：它要的 `readHotMeta`/`flushHotMeta`
//      正是本模块现在管的）⇒ 注入的是一个**取值函数** `deps.getSnapHub()`，
//      **不许**在构造时把 hub 抓死（那时它还不存在 ⇒ 调用点当场 `TypeError`）。
//      ★本棒第一版就是这里写错了（把 `requestSnapshot` 记成"热账 hub 自己的口"）⇒ 判据当场红，
//        如实留档：**跨族的调用点，搬迁时要逐个问"这个方法住在哪个 hub 上"**。
//   ② `paramHub.reset()` 住在 `resetHotLedgerState` 里 —— 那是**参数族**的东西。
//      ⇒ ★本棒选**甲案**：本模块**只复位热账自己那 8 行**；`paramHub.reset()` 与 `sw2HubLastWorld = null`
//        留在接线层的组合器 `sw2ResetFlushState()` 里 ⇒ **两族的复位不被绑在一起**
//        （正好给"参数族"那一棒留出干净切口），且**测试 import 一行都不用改**。
//
// ★纪律留档（随块搬来，别丢）：
//   ① `flushHotMeta` 返回**三态**而非布尔：`{ok:true}` 已落盘 · `{ok:true,queued:true}` 排队补写 ·
//      `{ok:false,reason}` 真失败。**再没有第四种含糊态**。
//   ② 在飞 ⇒ **排队补写**；判据是"在飞那次保存有没有带上此刻这份写"（`sw2HotMetaFlushedCurrent`），
//      **不是**布尔 `pending`（布尔会长期为真 ⇒ 每次点旋钮都白存一次整份 9.6MB 聊天）。
//   ③ **绝不无限等**：`sw2FlushTimeoutMs` 超时就如实报；且**超时也必须放开"在飞"那一格**（自愈），
//      否则一次卡住此后永远排队。
//   ④ **别问返回值，去问账本**：`ctx.saveChat` 其实是 `saveChatConditional`，它会**静默返回不写盘**
//      ⇒ 落盘后必须**回读核对指纹**（`savedAt|tick|…`），对不上就重试，试完仍对不上**绝不报成功**。
//   ⑤ 账本被别的副本覆盖 ⇒ **先用我们写的那份抢回来**（`reassertWrittenMetaIfClobbered`），否则重存的
//      还是被覆盖掉的那份 ⇒ 玩家刚改的档位就"回到默认"了。
//
// ---------- 注入形参（模块作用域；由 `createHotLedgerHub` 构造时赋上）----------
// ★它们**沿用接线层里原本的名字** ⇒ 下面那些块里的调用点一个字都不用改（搬迁不是重写）。
let freshCtx = null;          // () => ST 的 ctx（接线层的 `freshCtx`；每次现取，聊天切换后不过期）
let HOT_META_KEY = null;      // 热账住在 chatMetadata 的哪一格
let getSnapHub = null;        // () => 快照 hub（★迟到注入：见下面"两处迟到"①）

// ---------- 热账超时档 / 重试环常量 ----------
export const SW2_FLUSH_TIMEOUT_MS = 10_000;
let sw2FlushTimeoutMs = SW2_FLUSH_TIMEOUT_MS;
// 重试次数与退避（第 1 次不等；后两次让开 ST 那道 1 秒闸）
export const SW2_FLUSH_TRIES = 3;
const SW2_FLUSH_BACKOFF_MS = [0, 150, 400];
// 供判据注入（`node --test` 里把超时压到几十毫秒，真跑超时分支而不必等 10 秒）
export function sw2SetFlushTimeout(ms) {
    sw2FlushTimeoutMs = Number.isFinite(ms) && ms > 0 ? ms : SW2_FLUSH_TIMEOUT_MS;
}

// 排队补写用的**一条**链（不堆第二条：多人同刻写入也只需要"最后一次再存一遍"）
let sw2FlushChain = Promise.resolve();
let sw2FlushChainBusy = false;

// 落盘修复（leg20）：ST 1.15 的 ctx.updateChatMetadata() 只改内存、不触发任何保存（public/script.js 实测），
// 热账必须主动触发聊天保存才写进 jsonl——此前世界只活在页面内存，刷新/关机即丢。
// 策略：写内存 + ST 自带防抖保存（saveMetadataDebounced → saveChatConditional 整聊天上盘）；
// 关键路径（初始化/重抽/导入）用 flushHotMeta() 显式 await 落盘后再报成功。
let sw2HotMetaFlushing = false;
let sw2HotMetaLastCallAt = 0;      // 上一次"真调 saveChat"的时刻（判"在飞那次有没有把我的写算进去"）
let sw2HotMetaLastWriteAt = 0;     // 上一次"写热账内存"的时刻（`writeHotMeta` 里打点）
// ★"账上还有没有**没落盘的写**"这一个事实必须显式记着（不能靠"值变没变"反推）：
//   `set-param` 的"无变化即忽略"捷径要用它——值没变、但上一笔写还没落下去时，那一下点必须**补落盘**，
//   否则玩家的操作被无声吞掉（正是用户实机「点了没反应」的成因之一）。
//   ★判据用**时刻**而不是布尔（第一版用布尔，写错了）：`pending = true` 只说明"成功落过一次盘"，
//     而每轮 tick 都写账 ⇒ 那个布尔会长期为真 ⇒ 每次点旋钮都白存一次整份聊天（真账 9.6MB）。
//     真正的判据只有一条：**最后一次确认成功的落盘，有没有晚于最后一次写**。
let sw2HotMetaPendingWriteAt = 0;   // 还没被确认落盘覆盖的那次写的时刻（0 = 没有）
let sw2HotMetaLastFlushOkAt = 0;    // 最近一次"确认成功"的落盘时刻
export const hotMetaUnflushed = () => sw2HotMetaPendingWriteAt > sw2HotMetaLastFlushOkAt;
// "**正在飞的那次保存**有没有带上此刻账上这份写" —— 决定"要不要再排一次补写"的唯一判据。
//   ★为什么不能只用 `pending` 判：`pending` 只说明"确认落盘成功过"，而快照/防抖路径都会清它，
//     于是它会**长期为真**（每轮 tick 都写账）⇒ 拿它当"要不要补写"的判据就会变成每次点旋钮都白存一次
//     （真账 9.6MB 一整份上盘，这不是小事）。这一个标志只在"在飞那次已覆盖最新写"时为真。
let sw2HotMetaFlushedCurrent = false;

// v1 教训（adapter.js）：ctx.chatMetadata 是取用时的引用快照，聊天切换后过期——
// 每次读/写热账都重新取最新 context。
export function readHotMeta() {
    const ctx = freshCtx();
    return ctx?.chatMetadata?.[HOT_META_KEY] ?? null;
}

export function writeHotMeta(meta) {
    const ctx = freshCtx();
    if (!ctx || typeof ctx.updateChatMetadata !== 'function') return;
    // ★★leg41（本笔的核心简化）：这里原来有一层 `sw2WithParamOverlay(meta)`——它的作用是
    //   "让玩家的参数档位搭上每一笔世界写"，用来对抗"账本被别的副本换手时把档位洗掉"。
    //   参数真源搬进 `extensionSettings` 之后，**参数本来就不在这份账里了** ⇒ 搭车这件事连同
    //   它要防的那一类竞争一起消失。现在这一笔写**只写世界**（`dynamic.env` 里那份是镜像，
    //   由 `sw2MirrorParamsToAccount` 在参数变动时同步）。
    ctx.updateChatMetadata({ [HOT_META_KEY]: meta });
    sw2HotMetaLastWriteAt = Date.now();
    sw2HotMetaPendingWriteAt = sw2HotMetaLastWriteAt;   // 这一笔写还没被确认落盘覆盖
    sw2HotMetaWrittenMeta = meta;   // 被覆盖时拿它抢回来（同一个对象，零拷贝）
    sw2HotMetaWrittenFp = hotMetaSignatureOf(meta);   // 回读核对基线（见 hotMetaSignatureOf）
    try {
        if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        else if (typeof ctx.saveChat === 'function') ctx.saveChat().catch(() => {});
    } catch (_) {}
    // leg27 后 · 快照容错：**唯一的落账收口**就是这里——挂在这一处 ⇒ 全步覆盖
    //（查书前置步 / tick 演化 / 批量补全 / 单实体查 / 卷轮转 / 名册入账 / 初始化 / 导入 / 清演化层）。
    // 纪律：**fire-and-forget**（不 await）+ 内部 try/catch ⇒ 快照失败绝不影响世界推进（同记忆投递）。
    // ★leg78：快照 hub 走**迟到注入**（它由接线层在本模块之后才建，见文件头"两处迟到"①）。
    getSnapHub().requestSnapshot(meta?.world, '落账');
}

// ★★leg40c 续·五（用户实机「根本没落盘，刷新也回默认」）：**落盘要自己带文件名**。
//   读 ST 真源发现的那一格（`public/script.js:7105-7127`）：
//     `saveChat` 的文件名取 `characters[this_chid]?.chat`；**取不到就 `console.warn` 后直接 `return`**
//     ——**不写盘、不抛错**。而 `ctx.saveChat` 又是 `saveChatConditional`（它把内层异常也 catch 掉）
//     ⇒ 从插件侧看**永远"成功"**，盘上却什么都没写。这正是"改了就回默认"的最后一块拼图。
//   ⇒ 两条治法：
//     ① 保存时**显式带 `chatName`**（取 `ctx.chatId`，它与 ST 内部 `getCurrentChatId()` 同源）
//        ⇒ **不再依赖 `characters[this_chid].chat` 那个可能为空的字段**；
//     ② **计时闸**：一次真的整份上盘不可能在 10ms 内回来；**回得太快就当"它静默跳过了"**，
//        拒绝报成功并交给重试环（这道闸也顺带兜住别的静默 return 分支）。
const SW2_SAVE_MIN_MS = 10;
export function sw2ExplicitChatName() {
    const ctx = freshCtx();
    try {
        const id = ctx?.chatId ?? ctx?.getCurrentChatId?.();
        return typeof id === 'string' && id.trim() ? id.trim() : null;
    } catch (_) { return null; }
}
/** 调一次 ST 的保存（显式带文件名）；返回 { ms, fast } —— `fast` 为真 = 疑似静默跳过。 */
async function sw2CallSaveChat(ctx) {
    const chatName = sw2ExplicitChatName();
    const t0 = Date.now();
    await (chatName ? ctx.saveChat({ chatName }) : ctx.saveChat());
    return { ms: Date.now() - t0, fast: Date.now() - t0 < SW2_SAVE_MIN_MS };
}

// 我们最后写进账本那份形状的签名（判"账本还是不是我写的那一份"）。
//   ★为什么不用整个 JSON：真账 9.6MB，每次落盘串一遍是实打实的开销。
//   ★为什么**必须**带上 `env` 的键集（判据当场抓过一版）：用户那一天的症状正是
//     "档位键被吃掉了"，而那时 tick 没变 ⇒ 只看 `savedAt|tick` 会**假阳**（以为还是我那份）。
//     ⇒ 签名 = `savedAt|tick|编年行数|事件末位 id|env 键集`，全是 O(1) 的取数，且**覆盖了会被吃掉的那部分**。
export function hotMetaSignatureOf(meta) {
    if (!meta || typeof meta !== 'object') return null;
    const w = meta.world || {};
    const ev = Array.isArray(w.events) && w.events.length ? String(w.events[w.events.length - 1]?.id ?? '') : '';
    const ch = Array.isArray(w.chronicle) ? w.chronicle.length : 0;
    const keys = Object.keys(w?.context?.setting?.dynamic?.env || {}).sort().join(',');
    return `${meta.savedAt}|${w?.meta?.tick ?? ''}|${ch}|${ev}|${keys}`;
}
export function hotMetaFingerprint() {
    return hotMetaSignatureOf(readHotMeta());
}
let sw2HotMetaWrittenFp = null;   // `writeHotMeta` 写下去那一份的签名（回读核对基线）
let sw2HotMetaWrittenMeta = null; // 写下去的那一份本体（被别的副本覆盖时**拿它抢回来**）

/**
 * ★★leg40c 续·二：**把被抢走的账本抢回来**（用户实机「点跑一轮后参数又回到默认」的正面治法）。
 * 病：我们写下的档位，被"另一份世界副本"回写热账时吃掉了（下一个 tick 拿旧世界覆盖、聊天被重载…）
 *   ⇒ 玩家看到的就是"回到默认"。只在判别层重试是不够的——**重存的还是被覆盖后的那份**。
 * 治法：保存之前先看账本还是不是我写的那一份；不是 ⇒ **用我写的那份重新覆盖回去**，再存。
 * ★为什么不需要"别覆盖人家更新的写"那道闸（第一版加了，结果**自己把自己锁死**、判据当场抓红）：
 *   现在账本**不等于我那份**就已经说明"我被换掉了"；若这时账本内容正确，那它就是**更新的正确版本**，
 *   重存一遍无害（幂等）。故只按"内容是不是我那份"判，不掺时间戳。
 * @param {{fp:string, meta:object}} want 本次落盘开始时冻结的基线
 * @returns {boolean} 抢回来了没有
 */
function reassertWrittenMetaIfClobbered(want) {
    const fp = hotMetaFingerprint();
    if (!want?.fp || fp === want.fp) return false;                    // 账本还是我那份
    const ctx = freshCtx();
    if (!ctx || typeof ctx.updateChatMetadata !== 'function' || !want.meta) return false;
    console.warn('[story-world-v2] 账本被别的副本覆盖 —— 用我们写的那一份抢回来（否则玩家刚改的档位就"回到默认"了）', { 被换成: fp, 抢回: want.fp });
    ctx.updateChatMetadata({ [HOT_META_KEY]: want.meta });
    sw2HotMetaLastWriteAt = Date.now();       // 记账：这一下也是一次"写"
    sw2HotMetaPendingWriteAt = sw2HotMetaLastWriteAt;
    return true;
}

export async function flushHotMeta() {
    const ctx = freshCtx();
    if (!ctx) return { ok: false, reason: 'no-ctx' };
    if (typeof ctx.saveChat !== 'function') return { ok: false, reason: 'no-save-chat' };
    if (sw2HotMetaFlushing) {
        // 在飞：不假装成功、也不假装失败——排一次补写，如实回报"排队中"
        // ★要不要补写的判据 = **在飞的那次保存有没有带上最新的写**（`sw2HotMetaFlushedCurrent`）：
        //   带上 ⇒ 不补（省一次无谓的整份上盘）；没带上（含"在飞那次是报过超时还挂着的那一次"）⇒ 补。
        //   `inFlightCoversMyWrite` 只作日志佐证，不作判据（时刻比较不严谨）。
        const inFlightCoversMyWrite = sw2HotMetaLastCallAt >= sw2HotMetaLastWriteAt;
        console.info('[story-world-v2] 热账保存已在飞 —— 本次写入排队补落盘', {
            在飞那次是否已含本次写: inFlightCoversMyWrite,
        });
        if (!sw2HotMetaFlushedCurrent && hotMetaUnflushed() && !sw2FlushChainBusy) {
            sw2FlushChainBusy = true;
            sw2FlushChain = sw2FlushChain
                .then(() => new Promise((r) => { setTimeout(r, 0); }))
                .then(() => flushHotMeta())
                .then((r) => { if (!r.ok) console.warn('[story-world-v2] 排队补落盘未成', r.reason); })
                .catch((err) => { console.warn('[story-world-v2] 排队补落盘抛错', String(err?.message || err)); })
                .finally(() => { sw2FlushChainBusy = false; });
        }
        return { ok: true, queued: true };
    }

    sw2HotMetaFlushing = true;
    sw2HotMetaFlushedCurrent = false;   // 这一次保存**还没**证明带上最新写（成功才置真）
    let lastErr = null;
    // ★冻结本次落盘的基线（见 `reassertWrittenMetaIfClobbered` 的 `want` 说明）
    const want = { fp: sw2HotMetaWrittenFp, meta: sw2HotMetaWrittenMeta };
    try {
        // ★★回读核对的重试环（见本函数头注释：`saveChatConditional` 会**静默不写**）
        for (let attempt = 1; attempt <= SW2_FLUSH_TRIES; attempt += 1) {
            if (attempt > 1) {
                const wait = SW2_FLUSH_BACKOFF_MS[Math.min(attempt - 1, SW2_FLUSH_BACKOFF_MS.length - 1)];
                await new Promise((r) => { setTimeout(r, wait); });
                console.info(`[story-world-v2] 热账落盘核对未过 —— 第 ${attempt}/${SW2_FLUSH_TRIES} 次重试`);
            }
            reassertWrittenMetaIfClobbered(want);   // ★被别的副本覆盖 ⇒ 先抢回来（否则重存的还是被覆盖掉的那份）
            sw2HotMetaLastCallAt = Date.now();
            let timer = null;
            let saveMs = null;
            try {
                const raced = await Promise.race([
                    sw2CallSaveChat(ctx),
                    new Promise((r) => { timer = setTimeout(() => r('__sw2_timeout__'), sw2FlushTimeoutMs); }),
                ]);
                if (raced === '__sw2_timeout__') throw new Error(`saveChat 超过 ${sw2FlushTimeoutMs}ms 未返回`);
                saveMs = raced.ms;
                // ★太快 = ST **静默跳过**了写盘（`saveChat` 的 `fileName` 为空就 `return`；见 sw2CallSaveChat 注释）
                if (raced.fast) throw new Error(`saveChat 只花了 ${raced.ms}ms 就返回（整份上盘不可能这么快 ⇒ 疑似被静默跳过）`);
            } catch (err) {
                const reason = String(err?.message || err);
                lastErr = /未返回/.test(reason) ? 'timeout' : /静默跳过/.test(reason) ? 'skipped' : 'throw';
                console.warn('[story-world-v2] 热账落盘未确认', reason);
                continue;   // 交给重试环（退避后再试）
            } finally {
                clearTimeout(timer);
            }
            // ★核对：账本还是**我写下去的那一份**吗。
            //   ★★诚实边界（这一格反复踩过，写死）：`readHotMeta()` 读的是**内存副本**，而账本正是我们
            //     刚写进去的 ⇒ 只要没人拿别的副本覆盖它，这里**必然相等** —— 所以它能抓的是
            //     **"账本被换成了别的副本"**（下一个 tick 拿旧世界覆盖、聊天被重载等），
            //     **抓不到**"ST 静默没写盘"（那件事从浏览器侧根本判不了：内存与磁盘无法区分）。
            //     ⇒ 故语义定成：相等 ⇒ "我们写下去的账本还在"（可报已落盘）；
            //       不相等 ⇒ 账本被人换了 ⇒ **抢回来 + 重存**（这才是重试环真正拦得住的那一类）。
            const after = hotMetaFingerprint();
            if (want.fp && after === want.fp) {
                console.info('[story-world-v2] 热账已落盘', new Date().toISOString(), { 耗时ms: saveMs });
                sw2HotMetaLastFlushOkAt = Date.now();   // 这一刻之前的写都算已上盘
                sw2HotMetaFlushedCurrent = true;
                return { ok: true };
            }
            lastErr = 'replaced';
            // ★★leg41：这里原来还有三件"抢参数"的动作（`sw2PinParamsOnLiveAccount` 钉 + 本地兜底 +
            //   延后重试）。它们全部为"参数住在世界账里"而存在——真源搬进插件配置后，
            //   账本被谁换手都动不到玩家的档位 ⇒ 这三个动作连同它们要防的竞争一起撤掉。
            //   注意：**世界账自己的核对与重试保留**（它对"世界"仍然有用：tick 的落账不该被静默吞掉）。
            console.warn('[story-world-v2] 热账在我写完之后被换成了别的副本 —— 重存一次', { 期望: want.fp, 实际: after });
        }
        // 试完仍对不上 ⇒ **如实报**（世界这一笔可能只在内存里；参数不受影响——它有自己的家）
        return { ok: false, reason: lastErr || 'replaced' };
    } finally {
        // ★超时也必须**放出这一格**（自愈）：旧式的"在飞"标志在超时分支里若不放开，一次卡住的保存
        //   会把此后每一次改参数都变成"排队"⇒ **一次卡死永久卡死**（判据实测抓到过这一版：
        //   超时那一轮之后，下一轮报的还是"另一次保存还在飞"）。
        //   放开它不会造成并发双写失控：真正写下去的那次早已开始，它带的是**当时**那份账；
        //   后来的写由这次（或排队那次）负责。ST 侧 `isChatSaving` 自己会把并发收敛掉。
        sw2HotMetaFlushing = false;
    }
}

/**
 * ★只供判据用：清掉**热账自己那 8 行**落盘簿记（每次测试开局调用，防上一例的在飞/待落状态串味）。
 * ★leg78：本函数原先是接线层的 `sw2ResetFlushState`，它**同时**清了参数族与快照族的东西（跨了三族）。
 *   ⇒ 拆开：本模块只清**自己的** 8 行；参数族那两句（`paramHub.reset()` / `sw2HubLastWorld = null`）
 *     与快照族的 `snapHub.resetDedupState()` 留在接线层的组合器 `sw2ResetFlushState()` 里
 *     （对外仍是同一个名字 ⇒ **测试 import 一行都不用改**）。
 */
export function resetHotLedgerState() {
    sw2HotMetaFlushing = false;
    sw2HotMetaFlushedCurrent = false;
    sw2HotMetaLastCallAt = 0;
    sw2HotMetaLastWriteAt = 0;
    sw2HotMetaPendingWriteAt = 0;
    sw2HotMetaLastFlushOkAt = 0;
    sw2FlushChainBusy = false;
    sw2FlushChain = Promise.resolve();
}

/** ★leg78：把**当前生效的超时档**如实报出去（`flushOutcomeText` 那句"超过 N 秒未返回"要用它）。
 *  ★为什么必须有这个口：原先接线层直接读 `sw2FlushTimeoutMs` —— 那是**跨块直接读私有状态**
 *    （leg72 那次事故的同款形状）⇒ 搬走后会当场 `ReferenceError`。
 *    ⇒ 口径：**状态只住本文件**，外面要读就走这个受控口（`hotHub.flushTimeoutMs()`）。 */
export function flushTimeoutMs() {
    return sw2FlushTimeoutMs;
}

/**
 * 依赖注入工厂（照 `createSnapshotHub` / `createParamHub` 先例）。
 *   `deps` 三样：`freshCtx`（取 ST 上下文）· `hotMetaKey`（热账住哪一格）· `getSnapHub`（★迟到取快照 hub）。
 * ★为什么 `getSnapHub` 是**取值函数**而不是构造时抓死的对象：快照 hub 由接线层**在本模块之后**才建
 *   （它要的 `readHotMeta`/`flushHotMeta` 现在住本模块）⇒ 构造时抓死会拿到 `undefined`，
 *   而**调用点**（`writeHotMeta` 末尾那一下）会当场 `TypeError`。
 * ★★**不许**把它写成"构造时传入的现成 hub 引用"——那正是本仓 TDZ/时序坑的同款。
 */
export function createHotLedgerHub(deps) {
    freshCtx = deps.freshCtx;
    HOT_META_KEY = deps.hotMetaKey;
    getSnapHub = deps.getSnapHub;
    return {
        readHotMeta, writeHotMeta, flushHotMeta,
        hotMetaUnflushed, hotMetaFingerprint, hotMetaSignatureOf,
        sw2ExplicitChatName, sw2SetFlushTimeout, resetHotLedgerState,
        flushTimeoutMs,
    };
}

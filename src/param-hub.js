// story-world-v2/src/param-hub.js
// ★★★leg46（用户令「重构代码吧，我已经没有耐心了」）：**参数这一个数的全生命周期，只归这一个模块**。
//
// ＝＝＝ 为什么推倒重写（不是"再补一层"）＝＝＝
// 这条症状（"改了档位、刷新回默认"）在 leg26～leg45 之间被"修"过 **七轮**，判据从 662 涨到 693 全绿，
// 而实机一次都没好。七轮的共同形状是：**症状出现在屏幕上，于是每一轮都在屏幕附近改代码**
// （三态返回 / 回读核对 / 抢回 / 延后重试 / 本地兜底 / 参数覆盖层 / 就地同步控件 / 撤销栈…）。
// 真正的问题从来不是"某一笔没落下去"，而是**同一个数有五个写入口、三份存储、两套"值从哪来"的规则**：
//   · 写入口：`set-param` 的编辑、`loadWorld` 的接纳、`sw2PersistParamEnv`、`paramUndo` 的 write 回调、
//     快照恢复前的"补镜像"、`sw2WriteHotMetaEnsuringParams` —— 六处都能写参数，谁也不认识谁；
//   · 真源：`localStorage` + `extensionSettings` + （历史上的）`sw2_pending_params` —— 三份，谁是权威靠约定；
//   · 桶键：每次调用各自 `worldNameOf(world ?? sw2LastWorld ?? readHotMeta()?.world)` **现算一次**——
//     读用一个世界名、写用另一个世界名，**不报错、不抛异常、只是静默写到另一个桶**（本仓"一个数两把尺子"）。
// ⇒ 所以本模块的纪律只有一条（其余都是它的推论）：
//
//   ★★ **一个数：一个写入口 · 一个桶键 · 一份存储；每一次操作自己核对，核对不过就当场说实话。**
//
// ＝＝＝ 形状 ＝＝＝
//   · **纯逻辑 + 注入**：`storage`（读取/写入/删除一个字符串键）、`settings`（插件配置区）、
//     `saveSettings`、`writeWorld`（把世界写回聊天账）全部由调用方注入 ⇒ Node 里能真跑判据；
//     本模块**零 DOM / 零 window / 零 localStorage 直连 / 零 ST 直连**。
//   · **一次操作 = 一次事务**：入口处**取一次**桶（`begin`），此后读、改、写、核对**全用这一份**——
//     中途绝不再"现算一次世界名"，于是"读一个桶、写另一个桶"在这套结构里**不可能发生**。
//   · **写完必核对**（三格，逐格如实上报，不许合并成一句"已保存"）：
//       ① 真源：写下去→**回读**→值与键都在？  ② 桶键：是不是写进了**这个世界的桶**？
//       ③ 镜像：世界账 `dynamic.env` 里引擎读得到新值？
//     任何一格不过 ⇒ `ok:false` + **说清是哪一格**（状态条照抄这句话，绝不谎报成功）。
//
// ＝＝＝ 与旧代码的关系（哪些是搬过来的，哪一条是新的）＝＝＝
//   · 搬：白名单/归一（`params.js` + `limits.js` 两张既有表，本模块**不新开词汇**）、
//     桶形状与镜像纯函数（`param-store.js`：只删"真源管辖的玩家输入键"）、受控编辑+撤销栈
//     （`undo-stack.js`，照 v1 语义）。
//   · 新：**「面板该显示什么值」的裁决只在本模块一处**（`displayEnv`：真源 > 账本镜像 > 出厂默认），
//     以及**三格核对**与**自证面文案**（`humanLine` / `diag`）。leg41 的教训是"同一语义在两处实现 ⇒ 迟早分叉"
//     （`sw2ParamEnvFor` 与渲染层各判一次，直接造出"四个下拉全空白"那个缺陷）。

import { PARAM_KEYS, SWITCH_PARAMS } from './params.js';
import { LIMIT_KEYS, LIMIT_GEARS, limitKey, LIMIT_DEFAULTS, LIMIT_META } from './limits.js';
import {
    PARAMS_SETTINGS_KEY, worldNameOf, isParamStoreKey, isPlayerInputKey, normalizeStoreValue,
    emptyStore, normalizeStore, loadMergedEnv, mirrorEnvIntoWorld, paramKeysInWorldEnv,
} from './param-store.js';
import { createParamUndoStack } from './undo-stack.js';

/** 主路（我们的存储）在这个键上；插件配置区那份是**备份/镜像**，不是权威。 */
export const PARAMS_LS_KEY = 'sw2_params_v1';
/** 参数键的完整白名单（判据核对"两张表都在"）。 */
export const ALL_PARAM_KEYS = Object.freeze([...LIMIT_KEYS, ...PARAM_KEYS, ...Object.keys(SWITCH_PARAMS)]);
const UNDO_LIMIT = 20;

/**
 * ★★★leg48：**写入口不再要求"世界对象"**——这是"改了档位回默认"真正的病根。
 *
 * 十二轮里每一轮都把这条症状当成"某一笔没落下去"，去查落点、同源、重绘、墓碑、抢回。
 * 真正的形状是**一道与存储无关的闸**：
 *   旧写入口第一句就是 `if (!world?.context?.setting?.dynamic) return reject('还没有世界可设参数（先初始化）')`
 *   ⇒ **世界对象没拿到，玩家改的档位连"写"这一步都走不到**（`writeBucket` 一次都不跑，
 *     自检里的 `写入次数` 于是恒为 0、`updatedAt` 恒为 null —— 用户实机读数就是这个形状）。
 *   而"世界对象没拿到"和"参数该不该存下来"**是两件毫不相干的事**：
 *   参数真源按**世界名**分桶，而**世界名一个字都不需要世界对象**——
 *   路由读的是 `world.context.world`（= 世界账里存的那个名字，就是"大荒z"本身）。
 * ⇒ 定稿（一条不许违反的纪律）：
 *   **桶键只取世界名；世界对象是"镜像的去处"，不是"能不能写的条件"。**
 *   世界没到 ⇒ 照写主路 + 挂起镜像；世界后到 ⇒ `flushPending` 补镜像。玩家的档位在任何一刻都不丢。
 *
 * 配套的两条（都是同一条症状的另一半，见 `set()` 里各处的注释）：
 *   · **空值不再当"清空命令"**：玩家把下拉拨到空、或浏览器吐一笔带空值的事件时，
 *     旧行为是**把他已存的档位删掉**（"改了回默认"的机理之一）；
 *   · **没写就不许说"已存进本地存储"**：旧版拿"上一次读过的主路源"当"这一笔的落点"，
 *     于是"真源本来就是未定 ⇒ 没写任何东西"那一支照样报成功——用户抓到的正是这一句。
 */

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// 一、真源座（**唯一**碰存储的地方）
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

/**
 * @param {object} deps
 * @param {{getItem:(k:string)=>string|null, setItem:(k:string,v:string)=>void, removeItem?:(k:string)=>void}|null} deps.storage
 *        我们的主路存储（浏览器里是 `window.localStorage`）。**同步**——写下去当场在盘上。
 * @param {() => object|null} [deps.settings] 插件配置区（`ctx.extensionSettings`；备份/迁移用）
 * @param {() => void} [deps.saveSettings] 让 ST 把配置存下去（**尽力而为，不是主路**）
 * @param {(line:string)=>void} [deps.log]
 */
export function createParamHub({ storage = null, settings = null, saveSettings = null, log = () => {} } = {}) {
    // ★`lastRead` 记"上一次真源从哪儿读到的"——它是自证面（和"写失败"的判据）要说的话。
    //   缺了它就会出现 leg41 那种事：写着"已存在插件配置里"，而玩家下次打开什么都没有。
    let lastRead = { source: 'none', note: null };
    /**
     * ★★★leg46 续（用户实读：两次"写成功"而真源里没有那两个键 ⇒ **一定有什么把整份桶盖回去了**）：
     *   **写入审计**——每一次写真源都留一条痕（时刻 · 这次写进哪些键 · 上一次写后是哪些键 · 调用栈）。
     *   为什么必须记栈：这条症状查了八轮，每一轮都缺"**是谁把玩家的档位弄没的**"这一个事实。
     *   只记"键变了"判不出是谁；记下栈就能当场点名（`param-hub.js:NNN` → 调用方）。
     *   ★零成本（只在两次写之间比一次键集合），且**永不抛**（审计失败绝不能影响写参数）。
     */
    const writeTrace = [];
    /** 这次写的是哪个世界的桶（审计要知道"丢了谁"）——由 `submit` 在写之前设好。 */
    let lastWriteWorldName = null;
    /** ★本会话**写成功过**的键**和值**（按世界记）：既用来检测"被谁弄没了"，也用来**抢回**（见 begin）。 */
    const sessionWrites = new Map();   // worldName → Map<key, value>
    /**
     * ★★★leg46 续（用户点破的那条线：**"有没有可能是其他插件造成的"**——v1 就被大纲插件干扰过）：
     *   **删键墓碑**（按世界 + 键记）。
     *   为什么必须有它（机理，不是猜测）：别的插件/另一个页面实例会把**它自己那份旧快照**
     *   整份写回聊天账或存储 ⇒ 我们**载入接纳**时读到"旧的那两个键" ⇒ 而接纳是**绝对写**
     *   （`submit` 就写它拿到的那份 env）⇒ **把玩家新写的档位一起删掉了**。
     *   这正是用户那一屏的形状：存储里只剩"页面载入那一刻"的两个键。
     *   ⇒ 有了墓碑：**玩家删掉的键，任何旧快照都再也"接纳"不回来**（"删"这件事有记忆）。
     *   ★它只服务于"接纳"这一条路：玩家自己去改一个被墓碑标记的键 ⇒ 墓碑随即清掉（正常写入优先）。
     */
    const tombstones = new Map();      // worldName → Set<key>
    const tombstonesOf = (name) => tombstones.get(name) || new Set();
    /** ★墓碑要**落盘**（见 `writeBucket` / `readBucket`）：只活在内存里的话，Ctrl+F5 一刷新就没了，
     *  而"旧快照把玩家删掉的键填回来"恰恰发生在**下一次载入**——那正是必须挡住的那一刻。 */
    function tombstoneShape() {
        const out = {};
        for (const [name, set] of tombstones) if (set && set.size) out[name] = [...set];
        return out;
    }
    /** 从盘上那份**原文**里把墓碑读回内存（只增不减：内存里的更权威）。 */
    function loadTombstonesFromRaw(raw) {
        try {
            for (const [name, keys] of Object.entries(JSON.parse(raw)?.deleted || {})) {
                if (!Array.isArray(keys) || !keys.length) continue;
                const set = new Set(tombstonesOf(String(name)));
                for (const k of keys) set.add(String(k));
                tombstones.set(String(name), set);
            }
        } catch (_) {}
    }
    /**
     * ★★墓碑单独放**一个键**（`-deleted` 后缀），不跟参数桶挤在一起。
     *   为什么（判据 ⑬b 逼出来的）：别的插件"整份写回旧快照"时会把它那份 JSON 盖到**参数那个键**上，
     *   而它那份里当然没有我们的 `deleted` 字段 ⇒ 墓碑跟着一起没了 ⇒ 下一次载入就挡不住（自愈也无从下手，
     *   因为新页面内存里本来就是空的）。放进**我们自己的另一个键**之后，那类整体覆盖就碰不到它。
     */
    const TOMBSTONE_LS_KEY = `${PARAMS_LS_KEY}-deleted`;
    /**
     * 把内存里的墓碑写进**它自己那个键**（独立于"写参数"）。
     * ★★★leg46 续·三（**用户实机审计抓出来的真缺陷，我自己造的**）：这一版原来"顺手"也把**参数桶整份重写**一遍
     *   （`{ ...base, deleted: shape }`）——那是一条**会吃掉玩家档位的路**：
     *   只要它读到的 `base` 是一份"还没有刚写进去那个键"的快照（并发/外部改动的窗口），
     *   它就会把那一格**整份覆盖掉**。用户审计里那两笔写得清清楚楚：
     *     `04:05:45.884 写后[autoAdvance|动乱度|每轮递线]` ← 他选 9，写成功
     *     `04:05:45.922 写后[autoAdvance|动乱度] ⚠丢了[每轮递线]` ← 38 毫秒后，同一笔操作里被抹掉
     *   ⇒ 定稿（一条不许违反的纪律）：**墓碑只许写它自己那个键，永远不许碰参数桶**。
     *     "参数桶里也留一份 deleted"那条冗余**删掉**——它带来的风险远大于它挡的那点事。
     */
    function persistTombstones(why) {
        const s = st();
        if (!s || s.__throw || typeof s.setItem !== 'function') return false;
        try {
            s.setItem(TOMBSTONE_LS_KEY, JSON.stringify(tombstoneShape()));
            log(`[参数真源] ${why} —— 已记进它自己的键（参数桶一个字节都没碰）`);
            return true;
        } catch (err) {
            log(`[参数真源] 墓碑没能落盘（不影响参数本体）：${String(err?.message || err)}`);
            return false;
        }
    }
    /** 从那个**独立键**里读墓碑（新页面开场第一件事：内存空着，只能靠它）。 */
    function loadTombstonesFromKey() {
        const s = st();
        if (!s || s.__throw || typeof s.getItem !== 'function') return;
        try { loadTombstonesFromRaw(s.getItem(TOMBSTONE_LS_KEY) ? JSON.stringify({ deleted: JSON.parse(s.getItem(TOMBSTONE_LS_KEY)) }) : null); } catch (_) {}
    }
    /**
     * ★★自愈（八轮之后最后补上的那一道）：盘上那份若**没带上我们内存里的墓碑**（＝被别人整份写回旧快照），
     *   就立刻把墓碑重新写回去。为什么必须自愈：要挡的那一刻永远是"**下一次载入**"，
     *   而它读的是盘；盘上丢了墓碑，那道闸就等于不存在（判据 ⑬b 当场抓红过这一版）。
     */
    function healTombstones(parsedBucket) {
        try {
            const onDisk = (parsedBucket && typeof parsedBucket === 'object' && parsedBucket.deleted) || {};
            for (const [name, set] of tombstones) {
                if (!set || !set.size) continue;
                const disk = new Set(Array.isArray(onDisk[name]) ? onDisk[name] : []);
                if ([...set].some((k) => !disk.has(k))) return persistTombstones(`盘上的墓碑丢了（外部整份写回旧快照）⇒ 自愈`);
            }
        } catch (_) { /* 自愈失败不影响读 */ }
        return false;
    }
    function markDeleted(worldName, key) {
        const set = new Set(tombstonesOf(worldName));
        set.add(key);
        tombstones.set(worldName, set);
        persistTombstones(`记下"${worldName} 的「${key}」被玩家清空过"`);   // ★立刻写穿（见 persistTombstones 的注释）
        return [...set];
    }
    function clearDeleted(worldName, key) {
        const set = tombstonesOf(worldName);
        if (!set.has(key)) return;
        set.delete(key);
        tombstones.set(worldName, set);
        persistTombstones(`销掉"${worldName} 的「${key}」的墓碑"（玩家又给了值）`);
    }
    function noteSessionWrite(worldName, env) {
        try {
            const map = sessionWrites.get(worldName) || new Map();
            for (const [k, v] of Object.entries(env || {})) map.set(k, v);
            sessionWrites.set(worldName, map);
        } catch (_) {}
    }
    /** 玩家清空 ⇒ 忘掉"本会话写过它"（否则抢回会把他刚删掉的键又塞回去）。 */
    function forgetSessionWrite(worldName, key) {
        try { sessionWrites.get(worldName)?.delete(key); } catch (_) {}
    }
    function noteWrite(keys, extra = {}) {
        try {
            const prev = writeTrace.length ? writeTrace[writeTrace.length - 1].keys : null;
            writeTrace.push({
                at: new Date().toISOString(),
                keys: [...keys].sort(),
                prevKeys: prev,
                lost: prev ? prev.filter((k) => !keys.includes(k)) : [],
                ...extra,
                stack: String(new Error().stack || '').split('\n').slice(2, 6).map((s) => s.trim().replace(/^at\s+/, '')).join(' ← '),
            });
            if (writeTrace.length > 20) writeTrace.shift();
            const e = writeTrace[writeTrace.length - 1];
            if (e.lost.length) {
                // ★丢键是重大事件：不但留痕，还要当场出声（含栈）——八轮里缺的就是这一行
                log(`⚠ 写入时键变少了：丢了 ${e.lost.join('、')}（现在 ${e.keys.join('、') || '（空）'}）· 调用栈 ${e.stack}`);
            }
        } catch (_) { /* 审计永不阻塞写 */ }
    }

    const st = () => {
        try { return typeof storage === 'function' ? storage() : storage; } catch (err) {
            return { __throw: String(err?.message || err) };
        }
    };
    const cfg = () => {
        try { const s = typeof settings === 'function' ? settings() : settings; return s && typeof s === 'object' ? s : null; } catch (_) { return null; }
    };
    /** 插件配置区那份旧落点（leg41 及之前的"真源"；现在只当备份读）。 */
    const legacyBucket = () => {
        const s = cfg();
        if (!s) return null;
        try {
            const raw = s[PARAMS_SETTINGS_KEY];
            return raw && typeof raw === 'object' ? normalizeStore(raw) : null;
        } catch (_) { return null; }
    };

    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // ★★★leg48：**桶键的来源**——只认"世界名"这个字符串，**不认世界对象**（见文件头那段）。
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
    /** 世界名（入参可以是世界名本身，也可以是世界对象）——这是**唯一的桶键来源**。
     * ★★★leg48：**拿不到世界对象时，退回"最后一次见到的那个世界名"**（`lastKnownName`）。
     *   为什么必须这样（这条症状最阴的一格）：玩家点下拉那一刻如果世界对象没到，桶键就会落到
     *   "未名世界"这个兜底名 ⇒ 档位**存到了另一个桶**，面板读的是"大荒z"那个桶 ⇒ 两边都"没错"，
     *   可**玩家看到的就是"我改的东西不见了"**（本仓"一个数两把尺子"的老病）。
     *   ⇒ 口径：世界名**能记住就记住**；实在没有（真·没有世界）才用兜底名。 */
    const worldNameArg = (world) => {
        const usable = !!(world && typeof world === 'object' && world.context?.setting?.dynamic);
        const name = usable
            ? worldNameOf(world)
            : (typeof world === 'string' ? String(world).trim() : '');
        if (name) lastKnownName = name;      // ★★★leg48：**任何一次事务都顺手记住桶名** ⇒ 之后拿不到世界也能读对桶
        return name || lastKnownName || worldNameOf(null);
    };
    /** 镜像的去处（引擎读的那一格）；世界没到 ⇒ null（**不是错误**，只是"镜像稍后再补"）。 */
    const hasWorld = (world) => !!(world && typeof world === 'object' && world.context?.setting?.dynamic);
    /** 挂起账：世界没到的那一刻写下的键值（世界后到时一次补齐）。只活在内存里——真源已经落盘了。 */
    const pendingMirror = new Map();   // worldName → { [key]: value }
    /** ★最后一次见到的**世界对象**（读路径的兜底：载入还没跑完时，`displayEnv` 也得画对桶）。 */
    let lastKnownWorld = null;
    /** ★最后一次见到的**世界名**（写路径的兜底：世界对象没到时，桶键也得是"大荒z"而不是兜底名）。 */
    let lastKnownName = null;
    /** ★★最后一次**真正读写过的桶名**（面板显示值必须读同一个桶；见 `begin` 里那段现场记录）。 */
    let lastBucket = null;
    /**
     * ★★★leg48：**这个页面自己刚写进去的那份权威值**（按世界名记）。
     *   它就是 `displayEnv` 的第二顺位——见那个函数头部那段（现场读数：写成功之后，
     *   面板按**滞后的世界账镜像**把玩家的 9 覆盖回 3 ⇒ "改了回默认"）。
     *   只在**回读成功之后**登记（写失败绝不登记：那会让面板画一个没存住的值）。
     */
    const lastAuthoritative = new Map();   // worldName → { [key]: value }
    const noteAuthoritative = (name, env) => {
        const cur = { ...(lastAuthoritative.get(name) || {}) };
        for (const [k, v] of Object.entries(env || {})) if (isPlayerInputKey(k)) cur[k] = v;
        lastAuthoritative.set(name, cur);
    };
    const notePending = (name, env) => {
        try {
            const cur = pendingMirror.get(name) || {};
            for (const [k, v] of Object.entries(env || {})) if (isPlayerInputKey(k)) cur[k] = v;
            pendingMirror.set(name, cur);
        } catch (_) {}
    };

    /**
     * 取真源桶（**一次操作只调一次**）。
     * 读序：主路（我们自己的存储） > 插件配置区（备份/升级路径）。
     * ★键在、值坏 ⇒ 也认（洗成合法空桶）——不悄悄回落到备份那份，否则玩家会看到"清了又回来"。
     */
    function readBucket() {
        const s = st();
        // ★开场第一件事：把墓碑从**它自己那个键**里读回来（新页面内存空着，只能靠它）
        loadTombstonesFromKey();
        if (s && typeof s.getItem === 'function' && !s.__throw) {
            let raw = null;
            try { raw = s.getItem(PARAMS_LS_KEY); } catch (err) {
                lastRead = { source: 'none', note: `主路读取失败：${String(err?.message || err)}` };
                return emptyStore();
            }
            if (raw != null && raw !== '') {
                try {
                    lastRead = { source: 'local', note: null };
                    const parsed = normalizeStore(JSON.parse(raw));
                    // ★把"玩家删过哪些键"从盘上读回来（见 tombstonesOf 的注释）：刷新之后它必须还在，
                    //   否则下一次载入又会被旧快照填回来（那正是这条症状的形状）。
                    loadTombstonesFromRaw(raw);
                    // ★★自愈：盘上那份可能被**别人**整份写回旧快照（连 `deleted` 一起丢掉）
                    //   ⇒ 我们内存里记得的墓碑必须重新写回去，否则下一次载入就挡不住了。
                    healTombstones(parsed);
                    return parsed;
                } catch (err) {
                    lastRead = { source: 'local', note: `主路里的内容不是合法 JSON（已按空档处理）：${String(err?.message || err)}` };
                    return emptyStore();
                }
            }
        }
        const legacy = legacyBucket();
        if (legacy) {
            lastRead = { source: 'legacy', note: '主路里还没有这份参数（用插件配置区那份起步）' };
            return legacy;
        }
        lastRead = { source: s?.__throw ? 'none' : 'none', note: s?.__throw ? `主路不可用：${s.__throw}` : null };
        return emptyStore();
    }

    /**
     * 写真源桶 + **回读核对**：**主路**（我们的存储，同步）成功 ⇒ `stored:'local'`；
     * 主路不可用（隐私模式等）⇒ 退**插件配置区**并如实标 `stored:'config'`；
     * 主路**在但写失败**（配额/被拒）⇒ `ok:false` 并把原因原样带出去。
     * ★★口径（leg46 的命根子，判据 `param-hub.test.js` ⑥ 锁死）：**"备份写上了"不等于"玩家的值存住了"**。
     *   插件配置区的保存通道是真机上**已被证伪**的那一条（`settings.json` 的 mtime 停在载入那一刻）
     *   ⇒ 主路失败时若靠它把 `ok` 抬成 true，就会重演"状态条说已保存、刷新后什么都没有"——
     *     那正是用户报了七轮的那句话。所以这里**两路分开报**，谁也不替谁背书。
     */
    function writeBucket(bucket) {
        // ★★★leg46 续·三：**参数桶里不再夹带 `deleted`**。理由（用户审计抓出来的真缺陷）：
        //   夹带它就意味着"写墓碑"要顺带重写整份参数桶，而那一笔一旦读到旧快照，就会吃掉玩家刚写进去的键
        //   （用户审计：`写后[…|每轮递线]` → 38ms 后 `⚠丢了[每轮递线]`）。墓碑有**它自己那个键**，
        //   两条路从此井水不犯河水：参数桶只由 `submit` 写，墓碑只由 `persistTombstones` 写。
        //   （`readBucket` 仍兼容读旧的"夹带形"，见 `loadTombstonesFromRaw`。）
        let want = null;
        try { want = JSON.stringify(bucket); } catch (err) {
            return { ok: false, stored: null, reason: `参数表没法序列化：${String(err?.message || err)}`, note: null, readSource: lastRead.source };
        }
        // ★审计：这次写进去的是哪些键（丢了谁要当场出声）——进 `writeTrace`，自检里看得到
        try { noteWrite(Object.keys((bucket?.worlds || {})[lastWriteWorldName] || {})); } catch (_) {}
        const out = { ok: false, stored: null, reason: null, note: null, readSource: lastRead.source };
        const s = st();
        const coreUsable = !!(s && !s.__throw && typeof s.setItem === 'function' && typeof s.getItem === 'function');
        if (coreUsable) {
            try {
                s.setItem(PARAMS_LS_KEY, want);
                const back = s.getItem(PARAMS_LS_KEY);       // ★回读：这才是"写成了没有"的唯一证据
                if (back === want) { out.ok = true; out.stored = 'local'; }
                else out.reason = '写进主路后读回来不一样（可能被拒绝或配额不足）';
            } catch (err) {
                out.reason = `主路写入失败：${String(err?.message || err)}`;
            }
        } else if (s?.__throw) {
            out.reason = `主路不可用：${s.__throw}`;
        } else {
            out.reason = '这个环境没有可用的本地存储';
        }
        // 备份那份（插件配置区）：**尽力而为**——写得上会让 ST 的备份/导出/迁移带上它。
        // ★它永远不许改 `out.ok`（见上面那段）：主路没成就没成。
        const c = cfg();
        if (c) {
            try {
                c[PARAMS_SETTINGS_KEY] = bucket;
                if (typeof saveSettings === 'function') { try { saveSettings(); } catch (_) {} }
                if (!out.ok) out.note = `插件配置区那份也写了，但那条通道不保证跨启动存活`;
            } catch (err) {
                if (!out.ok) out.note = `插件配置区那份没写上：${String(err?.message || err)}`;
            }
        } else if (!out.ok) {
            out.note = '插件配置区也拿不到';
        }
        // ★主路根本不存在（不是"写失败"）⇒ 插件配置区就是**唯一**的家，此时它才算数（照实说它在哪儿）。
        if (!coreUsable && c) {
            out.ok = true;
            out.stored = 'config';
            out.reason = null;
            out.note = '这个环境没有本地存储，只能存在插件配置区那份（它不保证跨启动存活）';
        }
        if (!out.ok && !out.note) out.note = '参数没能存进任何一处';
        log(`[参数真源] 写${out.ok ? `成功（${out.stored === 'local' ? '主路' : '插件配置区'}）` : `失败：${out.reason}`}`
            + `${out.note ? ` · ${out.note}` : ''}`);
        return out;
    }

    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // 二、一次事务：取桶 → 改 → 写 → 核对（读/写/核对共用同一份桶与同一个世界名）
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

    // ★"真源管辖的键"：只有**玩家输入**才有资格被镜像删除（因变量是世界的结果，见 param-store）。
    //   按世界名分别记（换世界不清零，也不会串味）。
    const managed = new Map();   // worldName → Set<key>
    const managedOf = (name) => managed.get(name) || new Set();
    function registerManaged(world, keys) {
        const name = worldNameArg(world);
        const set = new Set(managedOf(name));
        for (const k of keys || []) if (isPlayerInputKey(k)) set.add(k);
        managed.set(name, set);
        return [...set];
    }

    /**
     * 事务：读一次桶 + 钉住世界名（此后这个事务里任何"桶键"都只许是它）。
     * ★★leg46 续（用户怀疑"别的插件动了我们的键"那条线）：这一步顺带做**丢键检测**——
     *   本会话在这个世界上**写成功过的**键，如果在下一次读桶时**不在了**，那就是**有人在我们之外改了它**
     *   （别的插件整份写回旧快照 / 清存储 / 配额），必须当场留痕 + 出声。
     *   ★它只**检测并上报**，不偷偷"补回去"：默默补会把"谁弄丢的"这条线索一起埋掉（八轮教训）。
     */
    function begin(world) {
        const bucket = readBucket();
        // ★★★leg48：桶键**只取世界名**（入参可以是世界名或世界对象）——世界对象没到时照样能读写真源。
        const worldName = worldNameArg(world);
        // ★★★leg48：**记下"最后一次真正读写过的桶"**——面板显示值必须读**同一个桶**。
        //   病因（真浏览器现场）：`loadWorld` 走空态/轮转失败时把**空态世界**交给面板
        //   ⇒ 面板去读"未名世界"那个空桶 ⇒ 按出厂默认把控件写成 3，而玩家的档位其实躺在
        //   "大荒z"那个桶里 ⇒ 两边都不报错、画面就是"改了回默认"（本仓"一个数两把尺子"）。
        lastBucket = worldName;
        if (world && hasWorld(world)) {
            lastKnownWorld = world;
            lastKnownName = worldName;
        }
        const env = { ...(bucket.worlds[worldName] || {}) };
        const mine = sessionWrites.get(worldName) || null;
        const gone = tombstonesOf(worldName);
        // ★★★leg46 续·三（**我自己上一版造的缺陷，用户审计当场抓出来**）：
        //   这里原来有一句"墓碑优先：把墓碑标记过的键从 env 里删掉"。它的后果是**把玩家刚写进去的键藏起来**
        //   （下一笔操作的 `before` 归 null、面板画成默认），而且它跟 `persistTombstones` 合起来会
        //   **真的把那一格从存储里抹掉**（用户审计：写成功 → 38ms 后 `⚠丢了[每轮递线]`）。
        //   ⇒ 定稿：**墓碑只在 `commit` 的"接纳"那一步生效**（那一句才是它要挡的：旧快照把玩家删过的键填回来），
        //     在**正常读/写**这条路上它一个字都不许影响。删掉这几行，`resurrected` 只作为读数上报。
        const vanished = mine ? [...mine.keys()].filter((k) => !(k in env)) : [];
        if (vanished.length) {
            const line = `⚠ 本会话写进「${worldName}」的档位不见了：${vanished.join('、')}`
                + `（现在只剩 ${Object.keys(env).join('、') || '（空）'}）——有别的代码在写这一格`;
            log(line);
            try { noteWrite(Object.keys(env), { note: `读桶时发现被外部改过（丢了 ${vanished.join('、')}）` }); } catch (_) {}
            // ★★★leg46 续·四（**用户实机那两张图之后加的最后一道**）：**抢回**。
            //   背景：用户的审计显示"写成功 → 38ms 后被抹掉"，而那张截图显示失焦重画时**画面回到了 3**
            //   （3 = 出厂默认 = 存储里没有那一格）⇒ 有**第二个东西**在跟这一格来回抢（另一个页面实例 /
            //   另一个副本 / 别的插件整份写回）。八轮里我们的做法一直是"检测并上报"，而**上报救不了玩家**。
            //   ⇒ 定稿：本会话写成功过的键**只要不见了就立刻按当时的原值补回去**（一次，不循环），
            //     并留痕"抢回"。这样即便对面一直在抢，**玩家看到的、引擎读到的都还是他选的那一档**。
            //   ★只抢"本会话确实写过、且玩家没删过"的键（清空过的键会从 `sessionWrites` 里忘掉）。
            try {
                const back = { ...env };
                for (const k of vanished) back[k] = mine.get(k);
                bucket.worlds[worldName] = back;
                lastWriteWorldName = worldName;
                const w = writeBucket(bucket);
                for (const k of vanished) env[k] = mine.get(k);
                log(`[参数真源] 抢回：${vanished.join('、')} 被外部抹掉 ⇒ 已按原值写回（${w.ok ? '成功' : `失败：${w.reason}`}）`);
                try { noteWrite(Object.keys(env), { note: `抢回（外部抹掉了 ${vanished.join('、')}）` }); } catch (_) {}
            } catch (err) {
                log(`[参数真源] 抢回失败（不影响参数本体）：${String(err?.message || err)}`);
            }
        }
        return {
            bucket, worldName, env,
            readSource: lastRead.source,
            readNote: lastRead.note,
            vanished,
            resurrected: [...gone].filter((k) => k in env),   // 只作读数上报（见上面那段：读/写路上不许用）
        };
    }

    /**
     * 把一份参数表提交进真源（写 + **回读核对**）。
     * ★★两个名字必须分清（我自己第一版就在这里翻过车，判据当场抓红，留档）：
     *   · `stored` = **写这份的落点**（`'local'` / `'config'` / `null`）——回答"存到哪了"；
     *   · `storedEnv` = **回读回来那份值**——回答"盘上到底是什么"。
     *   第一版把回读那份也叫 `stored` 并让它覆盖了前者 ⇒ 状态条拿到一个对象去比 `'local'`，
     *   于是**明明存进了主路，却报"已存下来"**（本仓"一个名字两个意思"的老病，我照旧踩了一次）。
     */
    function submit(tx, env) {
        tx.bucket.worlds[tx.worldName] = { ...(env || {}) };
        lastWriteWorldName = tx.worldName;            // ★审计要知道"这次写的是哪个桶"
        const write = writeBucket(tx.bucket);
        const back = readBucket();                    // 回读（主路优先）
        const storedEnv = { ...(back.worlds[tx.worldName] || {}) };
        const want = { ...(env || {}) };
        const missing = Object.keys(want).filter((k) => storedEnv[k] !== want[k]);
        const extra = Object.keys(storedEnv).filter((k) => !(k in want));
        // ★★回读核对（八轮里最贵的一课在这里收口）：**写完立刻回读**，读回来对不上就是**有人在我们写下之后
        //   又改了它**（别的插件整份写回旧快照，或配额/被拒）⇒ 必须留痕并如实上报，绝不谎报成功。
        //   ★注意：`writeBucket` 的 `ok` 只说明"那一刻写进去并被读回"；这里再读一次是**第二个时间点**，
        //     两次之间若被第三方改动，`missing` 就不为空 —— 这一格正是"用户报的存不住"最直接的证据。
        if (missing.length || extra.length) {
            noteWrite(Object.keys(storedEnv), {
                note: '回读不一致',
                missing: [...missing],
                extra: [...extra],
            });
        }
        noteSessionWrite(tx.worldName, want);          // ★记着"本会话写过这个键"（丢键检测的基线）
        if (write.ok) noteAuthoritative(tx.worldName, storedEnv);   // ★★★leg48：面板显示值的第二顺位（见 displayEnv）
        return { ...write, storedEnv, missing, extra, worldName: tx.worldName, readSourceAfter: lastRead.source };
    }

    /**
     * 镜像进世界账（引擎读 `dynamic.env`）+ **核对它真的在那儿**。
     * ★注意：镜像的输入是**回读到的真源**（不是"我以为写下去的那份"）——
     *   两份不一致时，引擎必须跟**盘上真实那份**，否则"面板写 12、引擎按 6 跑"。
     * ★★leg46 续：**只镜像"玩家输入"那些键**（`isPlayerInputKey`）。为什么（判据 ⑫b 当场问出来的）：
     *   真源桶里会**接纳**账上已有的参数键，其中 `民生度`/`动乱度` 是**因变量**（世界的结果、面板只呈现）。
     *   若把整份真源照抄进镜像，就会出现这种事故：玩家按一下「清除演化层」（那一枚的职责正是**清掉
     *   引擎算出来的那一层**），镜像里去重又冒出一个旧的 `动乱度` —— 清的与填的互相抵消。
     *   ⇒ 口径：**镜像 = 玩家的输入**；世界的因变量归世界自己每轮写、每轮覆盖（引擎的既有行为，零改动）。
     */
    function mirrorInto(world, env, managedKeys) {
        const before = { ...(world?.context?.setting?.dynamic?.env || {}) };
        const inputs = {};
        for (const [k, v] of Object.entries(env || {})) if (isPlayerInputKey(k)) inputs[k] = v;
        const next = mirrorEnvIntoWorld(world, inputs, managedKeys);
        const after = { ...(next?.context?.setting?.dynamic?.env || {}) };
        const bad = Object.keys(inputs).filter((k) => after[k] !== inputs[k]);
        return { world: next, before, after, ok: bad.length === 0, missing: bad, changed: next !== world };
    }

    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // 三、对外：面板显示值（**唯一的裁决处**）
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

    /**
     * ★★"面板这一格该显示什么"——**只在本函数里裁决一次**，渲染层与任何同步逻辑都用它。
     * 优先级（写死；leg41 的"四个下拉全空白"就是因为我另写了一处"没有就是空"）：
     *   ① **真源**（玩家在这个世界选过的） > ② 账本镜像（存量世界/书里抽出来的） > ③ **出厂默认**（`LIMIT_DEFAULTS`）。
     * 返回的表**只含玩家能拧的键**（因变量不在里面——它们只呈现、不给旋钮）。
     */
    function displayEnv(world) {
        // ★★★leg48（**这条症状的真正心脏，用真浏览器抓到的现场**）：
        //   本函数的口径一直写着"真源优先"，可第二顺位原来读的是 **`paramKeysInWorldEnv(w)`＝世界账镜像** ——
        //   而镜像是**滞后一拍**的那一份（要先写世界账、再让 `writeHotMeta` 落进聊天账）。
        //   现场（真浏览器读数，leg48）：
        //     `[参数真源] 写成功（主路）`（真源里已经是 9）
        //     → `参数控件按真源对齐：每轮递线 → "3"`（**读镜像读到旧值 3，当场把玩家选的 9 覆盖回去**）
        //   玩家看到的正是"我点了一下，它自己跳回去了/刷新就回默认"。
        //   ⇒ 定稿：第二顺位改成"**这个页面自己刚写进去的那份权威值**"（`lastAuthoritative`），
        //     它由 `set/clear/undo/commit` 在**回读成功之后**写下来 ⇒ 与真源同源、绝不滞后。
        //   记档（免得下一任又把它改回读镜像）：本仓"一个数两把尺子"的老病在这里发作过**九轮**，
        //   而九轮都去改"写字的那一方"，没人查"读字的那一方读的是哪一本账"。
        const w = world || lastKnownWorld;
        const tx = begin(w);
        const fromStore = { ...tx.env };
        const fromLive = { ...(lastAuthoritative.get(tx.worldName) || {}) };
        const out = {};
        for (const k of Object.keys(fromStore)) if (isPlayerInputKey(k)) out[k] = fromStore[k];
        // ★面板**不许画**玩家明确清空过的键（哪怕它被外部又写回存储里）——"未定"就该显示"未定"，
        //   否则会出现"我删了它、它自己又回来了"（那正是 leg41 记过的"清空失效"）。
        for (const k of tombstonesOf(tx.worldName)) delete out[k];
        for (const [k, v] of Object.entries(fromLive)) {
            if (!isPlayerInputKey(k)) continue;
            if (tombstonesOf(tx.worldName).has(k)) continue;   // ★同上：清空过的键不许"复活"到面板
            if (Object.prototype.hasOwnProperty.call(out, k)) continue;
            const n = normalizeStoreValue(k, v);
            if (typeof n === 'string') out[k] = n;
        }
        // ★★★leg48（**这条症状的真正心脏，真浏览器现场读数**）：这一顺位**原来读的是世界账镜像**
        //   （`paramKeysInWorldEnv(w)`），而镜像是**滞后一拍**的那一份 —— 现场：
        //     `[参数真源] 写成功（主路）`（真源里已经是 9）→ `参数控件按真源对齐：每轮递线 → "3"`
        //     （**读镜像读到旧值 3，当场把玩家选的 9 覆盖回去**）⇒ 玩家看到"它自己跳回去了/刷新回默认"。
        //   ⇒ 三条顺位（写死；判据 ④ 锁着）：
        //     ① **真源**（`tx.env`：玩家在这个世界选过的，同步、当场在盘上）
        //     ② **本页面刚写进去的那份权威值**（`lastAuthoritative`：与真源同源、绝不滞后）
        //     ③ **账本镜像**（只作**最后兜底**：存量世界/书里抽出来、真源还不认识的那些键）
        //     ★③ 只能是"兜底"，绝不能盖住 ①② —— 这一条被违反过九轮，是"改了回默认"的机理。
        const fromWorld = paramKeysInWorldEnv(w);
        for (const [k, v] of Object.entries(fromWorld)) {
            if (!isPlayerInputKey(k)) continue;
            if (tombstonesOf(tx.worldName).has(k)) continue;
            if (Object.prototype.hasOwnProperty.call(out, k)) continue;
            const n = normalizeStoreValue(k, v);
            if (typeof n === 'string') out[k] = n;
        }
        // ③ 出厂默认：**只由这一处补**（真源与账上都缺 ⇒ 面板画出厂值，绝不画空串）
        //   ★★leg46 续·四（**探针当场抓出来的**）：但**玩家明确清空过的键不许补出厂默认**——
        //     否则"我把上限清成未定"会当场显示成 **3**，而那正是用户八轮里一直报的那句话
        //     （"改了就回默认"）：他清空 ⇒ 面板画 3 ⇒ 他以为没生效/被回滚。
        //     口径：墓碑（＝玩家删过）⇒ 面板画「未定」（下拉第一项就是它，`render.js` 的 `PARAM_UNSET`）。
        for (const k of LIMIT_KEYS) {
            if (Object.prototype.hasOwnProperty.call(out, k)) continue;
            if (tombstonesOf(tx.worldName).has(k)) continue;
            const d = LIMIT_DEFAULTS?.[k];
            if (d != null) out[k] = String(d);
        }
        return out;
    }

    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // 四、对外：唯一的写入口
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
    //   `set(world, key, value)` 的返回值就是**自证面**要说的全部内容（状态条照抄 `humanLine`）。

    const undoStack = createParamUndoStack({
        read: () => ({}),                    // ★永不使用：受控入口一律显式传"变更前那份"（见 undo-stack 的注释）
        write: () => {},                     // ★同上：写存储只由 submit() 做，这里不写第二次
        log: (line) => log(`[参数真源] ${line}`),
        limit: UNDO_LIMIT,
    });
    /** 撤销栈里的"变更前那份"要连**世界名**一起记（否则换世界后撤销会写进别人的桶）。 */
    let undoScope = null;   // { worldName }

    /**
     * 唯一的写入口。
     * @param {object} world 目标世界（**必传**：它的名字就是桶键；不传就是没有归属，直接拒绝）
     * @param {string} key 参数键（白名单）
     * @param {*} value 新值（`''`/null = 清成「未定」）
     * @returns {{
     *   ok:boolean, changed:boolean, kind:'ok'|'unchanged'|'noop-empty'|'reject'|'fail',
     *   key:string, label:string, before:string|null, after:string|null, reason:string|null,
     *   worldName:string|null, env:object, managed:string[], stored:object,
     *   mirror:{world:object|null, ok:boolean, changed:boolean}, store:{ok:boolean,stored:string|null,reason:string|null,note:string|null},
     *   humanLine:string, diag:object
     * }}
     */
    /**
     * ★★★leg48：**"清空"是一条显式通道**（`clear()`），不再由"提交了一个空值"隐式触发。
     *
     * 为什么必须分开（用户实机状态条的原话就是判据）：
     *   他点下拉，面板收到的是**空值**，旧代码于是走"清空"那一支 —— 报「每轮递几条线 → 未定
     *   （已存进本地存储 · 已同步给引擎 · 撤销可回退）」。于是两件坏事同时发生：
     *     ① 他**根本没想清空**，档位却被删了；② 而"已存进本地存储"是**假的**——那一刻 `writeBucket`
     *        一次都没跑（真源里本来就没这个键 ⇒ 没有可删的 ⇒ 没写任何东西），
     *        这正是自检里 `写入次数 = 0`、`updatedAt = null` 的来源。
     *   ⇒ 定稿：**"手滑到空"与"明确清空"必须是两个不同的动作**——
     *     · `set(world,key,'')`  = 手滑/重复事件 ⇒ **一个字都不动**，如实说"现在是什么、没写东西"；
     *     · `clear(world,key)`   = 玩家在下拉里**明确选了「未定」**（接线层判定）⇒ 才是清空。
     *   这一刀把"改了就回默认"里最脏的一半**从结构上删掉**了：不存在的删除，就不会发生。
     */
    function set(world, key, value) {
        const k = String(key ?? '').trim();
        const label = paramLabel(k);
        const reject = (reason, kind = 'reject') => ({
            ok: false, changed: false, kind, key: k, label, before: null, after: null, reason,
            worldName: world ? worldNameArg(world) : null, env: {}, managed: [], stored: {},
            mirror: { world: null, ok: false, changed: false },
            store: { ok: false, stored: null, reason, note: null },
            humanLine: `⚠ ${reason}`, diag: {},
        });
        // ★★★leg48：**这里不再有"世界没到就不许写"那道闸**（见文件头那段）——
        //   它是这条症状真正的心脏：世界对象拿不到 ⇒ 玩家的档位连写都走不到，而界面上看不出任何异常。
        if (!isParamStoreKey(k)) return reject(`未知参数键：${k || '（空）'}`);

        // 归一：**三态**分明（合法值 / 清空 / 非法）——把"非法"当成"清空"就会静默毁掉玩家的档位。
        const raw = value == null ? '' : String(value).trim();
        const norm = normalizeStoreValue(k, raw);
        if (raw && norm === false) {
            const opts = limitKey(k) != null ? `（可选：${(LIMIT_GEARS_OF(k) || []).join(' / ')}）` : '';
            return reject(`「${raw}」不是「${label}」的可选档位${opts}`);
        }
        const after = typeof norm === 'string' ? norm : null;

        // ★★事务：读一次桶 + 钉住世界名，此后读/改/写/核对全用这两样。
        const tx = begin(world);
        const before = Object.prototype.hasOwnProperty.call(tx.env, k) ? String(tx.env[k]) : null;

        // ★★★leg48：**空值一律不动真源**（见函数头那一段：手滑到空 ≠ 明确清空）。
        //   真源里本来没有 ⇒ 报「本来就是未定」；本来有 ⇒ 报「现在就是 X，空值不算改档位」。
        //   两支都**不许**说"已存进本地存储"——`store.stored` 恒为 null（没写就是没写）。
        if (after == null) {
            return {
                ok: true, changed: false, kind: 'noop-empty', key: k, label, before, after,
                reason: null, worldName: tx.worldName, env: tx.env, managed: [...managedOf(tx.worldName)],
                stored: tx.env, mirror: { world: null, ok: true, changed: false },
                store: { ok: true, stored: null, reason: null, note: '这一下什么都没写' },
                humanLine: before == null
                    ? `${label} 本来就是「未定」（这一下没有改动，也**没有写任何东西**）`
                    : `${label} 现在就是 ${before}（空值不算改档位——要清空请在下拉里**明确选「未定」**）`,
                diag: diag(world, tx),
            };
        }
        if (before === after) {
            return {
                ok: true, changed: false, kind: 'unchanged', key: k, label, before, after,
                reason: null, worldName: tx.worldName, env: tx.env, managed: [...managedOf(tx.worldName)],
                stored: tx.env, mirror: { world: null, ok: true, changed: false },
                // ★同上：没写就是没写（值没变 ⇒ 一次存储都没碰）
                store: { ok: true, stored: null, reason: null, note: '这一下什么都没写' },
                humanLine: `${label} → ${after}（本来就是它，无需改动）`,
                diag: diag(world, tx),
            };
        }

        // 受控编辑：先记"变更前那份"（撤销栈），再算新值，最后一次写入。
        const next = { ...tx.env };
        if (after == null) delete next[k]; else next[k] = after;
        // ★墓碑：清空 ⇒ **记一笔"玩家删过它"**（旧快照别想把它接纳回来）；重新赋值 ⇒ 销掉墓碑。
        if (after == null) markDeleted(tx.worldName, k); else clearDeleted(tx.worldName, k);
        // ★抢回名单：清空 ⇒ 忘掉"本会话写过它"（不许把他刚删掉的键又塞回去）；赋值 ⇒ 记下值。
        if (after == null) forgetSessionWrite(tx.worldName, k);

        // ★写之前先把"这个键归真源管辖"登记上（玩家刚写过的键；清空它时镜像才有权从账上删）
        const managedList = registerManaged(world, [k, ...Object.keys(next)]);

        const store = submit(tx, next);
        // 回读到的就是权威（主路优先）；写失败 ⇒ 如实报错，**不谎报成功**
        const authoritative = store.ok ? { ...store.storedEnv } : { ...next };
        if (!store.ok) {
            return {
                ok: false, changed: false, kind: 'fail', key: k, label, before, after,
                reason: store.reason || '没能把参数存下来', worldName: tx.worldName,
                env: authoritative, managed: managedList,
                stored: store.stored, mirror: { world: null, ok: false, changed: false }, store,
                humanLine: `${label} → ${countWord(k, after)} · ⚠ 没能存下来（${store.reason || '未知原因'}）`
                    + `${store.note ? ` · ${store.note}` : ''}——刷新会丢，请把这一句告诉维护者`,
                diag: diag(world, tx),
            };
        }

        // ★撤销步进放在"写成功"之后：写不进去的那一步不许进栈（否则撤销会退到一个从没存在过的状态）。
        //   ★压在栈上的是**变更前那份值的引用**（零拷贝）+ 它属于哪个世界（`worldName` ⇒ 防跨世界撤销）。
        if (undoScope && undoScope.worldName !== tx.worldName) undoStack.reset();   // 换了世界 ⇒ 上一段历史作废
        undoScope = { worldName: tx.worldName };
        undoStack.push(`${label} → ${after ?? '未定'}`, { ...tx.env }, tx.worldName);

        // ★镜像进世界账（引擎读的是这里）。输入 = **回读到的真源**。
        // ★★★leg48：**世界对象没到时，"镜像"这一格挂起，绝不因为镜像写不了就把整笔判失败**。
        //   为什么必须分开（这条症状的心脏）：镜像要的是一整个"世界对象"，而那个对象要等
        //   `loadWorld` 跑完 IndexedDB 卷库 → 快照链 → 取世界书 → 名册落账 → 位置继承 才拿得到。
        //   旧版把两者绑成一条：世界没到 ⇒ 连**真源**都不写 ⇒ 玩家的档位当场丢（"改了回默认"）。
        //   定稿：**真源是权威、当场落；镜像是通道、可以晚一步**——世界后到由 `flushPending` 一次补齐。
        let m = { world: null, ok: false, changed: false, missing: [], pending: false };
        if (hasWorld(world)) {
            m = { ...mirrorInto(world, authoritative, managedOf(tx.worldName)), pending: false };
        } else {
            notePending(tx.worldName, authoritative);
            m = { world: null, ok: false, changed: false, missing: [], pending: true };
        }
        const mirrorNote = m.pending
            ? '引擎那一步（世界账）等世界载入后补上'
            : (m.ok ? null : `镜像没写全（缺 ${m.missing.join('、')}）`);

        return {
            ok: true, changed: true, kind: 'ok', key: k, label, before, after,
            reason: null, worldName: tx.worldName, env: authoritative, managed: managedList,
            stored: store.stored, mirror: { world: m.world, ok: m.ok, changed: m.changed, pending: m.pending },
            store,
            humanLine: `${label} → ${countWord(k, after)}（${storeWord(store.stored)}`
                + `${m.changed && m.ok ? ' · 已同步给引擎' : ''}`
                + `${m.pending ? ' · 引擎那一步等世界载入后补' : ''}`
                + `${mirrorNote ? ` · ⚠ ${mirrorNote}` : ''}`
                + `${store.note ? ` · ${store.note}` : ''} · 撤销可回退）`,
            diag: diag(world, tx),
        };
    }

    /**
     * ★★★leg48：**把挂起的镜像一次补齐**（世界后到时调；幂等）。
     * 谁调它：`web/index.js` 的 `loadWorld`（载入期）与快照/导入这类"账本被整份换掉"的路径。
     * 口径（三条，都能机械核）：
     *   ① 只在**真源里确实有、而账上不是这个值**时才动手（幂等；不写多余的一笔）；
     *   ② 世界对象拿不到 ⇒ 什么都不做（**不是失败**，只是等下一次世界到）；
     *   ③ 只镜像**玩家输入**（因变量归世界自己写，见 `mirrorInto` 的口径）。
     * @returns {{world:object|null, changed:boolean, ok:boolean, keys:string[], pending:boolean}}
     */
    function flushPending(world) {
        const name = worldNameArg(world);
        const empty = { world: null, changed: false, ok: true, keys: [], pending: false };
        if (!hasWorld(world)) return { ...empty, pending: true };
        const tx = begin(world);
        const want = {};
        for (const [k, v] of Object.entries(tx.env)) if (isPlayerInputKey(k)) want[k] = v;
        const account = world?.context?.setting?.dynamic?.env || {};
        const keys = Object.keys(want).filter((k) => account[k] !== want[k]);
        pendingMirror.delete(name);
        if (!keys.length) return { ...empty, world };
        const m = mirrorInto(world, want, managedOf(tx.worldName));
        return { world: m.world, changed: m.changed, ok: m.ok, keys, pending: false };
    }

    /**
     * ★★★leg48：**显式清空**（`clear`）——只有"玩家在下拉里明确选了「未定」"才走这里（接线层判定）。
     *
     * 与 `set()` 的分工（这一刀是本棒治"改了就回默认"的核心）：
     *   · `set(world,key,'')` = 手滑/滚轮/重复事件 ⇒ **什么都不动**；
     *   · `clear(world,key)`  = 明确清空 ⇒ 删键 + 记墓碑（旧快照再也填不回来）+ 镜像里也删掉。
     * 两条路**不共用"空值"这个信号**——因为空值是一个**无法区分意图**的信号，而删除是不可逆的。
     */
    function clear(world, key) {
        const k = String(key ?? '').trim();
        const label = paramLabel(k);
        const bad = (reason) => ({
            ok: false, changed: false, kind: 'reject', key: k, label, before: null, after: null, reason,
            worldName: world ? worldNameArg(world) : null, env: {}, managed: [], stored: {},
            mirror: { world: null, ok: false, changed: false },
            store: { ok: false, stored: null, reason, note: null },
            humanLine: `⚠ ${reason}`, diag: {},
        });
        if (!isParamStoreKey(k)) return bad(`未知参数键：${k || '（空）'}`);
        const tx = begin(world);
        const before = Object.prototype.hasOwnProperty.call(tx.env, k) ? String(tx.env[k]) : null;
        if (before == null) {
            return {
                ok: true, changed: false, kind: 'noop-empty', key: k, label, before, after: null,
                reason: null, worldName: tx.worldName, env: tx.env, managed: [...managedOf(tx.worldName)],
                stored: tx.env, mirror: { world: null, ok: true, changed: false },
                store: { ok: true, stored: null, reason: null, note: '这一下什么都没写' },
                humanLine: `${label} 本来就是「未定」（这一下没有改动，也**没有写任何东西**）`,
                diag: diag(world, tx),
            };
        }
        const next = { ...tx.env };
        delete next[k];
        markDeleted(tx.worldName, k);          // ★"玩家删过它"要落盘（旧快照不许把它填回来）
        forgetSessionWrite(tx.worldName, k);   // ★也不许被"抢回"塞回去
        const managedList = registerManaged(world, [k, ...Object.keys(next)]);
        const store = submit(tx, next);
        if (!store.ok) {
            return {
                ok: false, changed: false, kind: 'fail', key: k, label, before, after: null,
                reason: store.reason || '没能把清空存下来', worldName: tx.worldName,
                env: { ...next }, managed: managedList,
                stored: store.stored, mirror: { world: null, ok: false, changed: false }, store,
                humanLine: `${label} → 未定 · ⚠ 没能存下来（${store.reason || '未知原因'}）——刷新会回来`,
                diag: diag(world, tx),
            };
        }
        if (undoScope && undoScope.worldName !== tx.worldName) undoStack.reset();
        undoScope = { worldName: tx.worldName };
        undoStack.push(`${label} → 未定`, { ...tx.env }, tx.worldName);
        const authoritative = { ...store.storedEnv };
        const m = hasWorld(world)
            ? { ...mirrorInto(world, authoritative, managedOf(tx.worldName)), pending: false }
            : (notePending(tx.worldName, {}), { world: null, ok: false, changed: false, pending: true });
        return {
            ok: true, changed: true, kind: 'ok', key: k, label, before, after: null,
            reason: null, worldName: tx.worldName, env: authoritative, managed: managedList,
            stored: store.stored, mirror: { world: m.world, ok: m.ok, changed: m.changed, pending: m.pending },
            store,
            humanLine: `${label} → 未定（已清空 · ${storeWord(store.stored)}`
                + `${m.pending ? ' · 引擎那一步等世界载入后补' : (m.ok ? ' · 已同步给引擎' : ' · ⚠ 镜像没写全')}`
                + ' · 撤销可回退）',
            diag: diag(world, tx),
        };
    }

    /** 撤销一步：把"变更前那份"写回真源 + 镜像回世界账（世界已经发生的事不回退）。 */
    function undo(world) {
        if (!undoStack.canUndo()) return { ok: false, reason: '没有可撤销的改动' };
        // ★★★leg48：撤销同样**不要求世界对象**（世界没到只影响"镜像晚一步"，不影响撤销本身能否成立）
        const tx = begin(world);
        if (undoScope && undoScope.worldName !== tx.worldName) return { ok: false, reason: '这是另一个世界的改动，不能在这里撤销' };
        // ★★纪律（判据当场抓红过一版）：**先 peek 拿"变更前那份"→ 自己写 → 写成功了才 pop**。
        //   ① 不许调 `undoStack.undo()`：它走注入的 `write` 回调，而 v2 的写回必须经过本模块的事务
        //      （写存储 + 回读核对 + 镜像）——注入一个"什么都不做"的 write 就会让撤销变成**空操作**
        //      （正是 leg41 那个 bug 的镜像：返回 ok、日志照打、存储一个字没变）；
        //   ② 写失败不许 pop（否则那一步历史凭空消失）。
        const entry = undoStack.peek();
        if (!entry) return { ok: false, reason: '没有可撤销的改动' };
        if (entry.worldName && entry.worldName !== tx.worldName) {
            return { ok: false, reason: '这是另一个世界的改动，不能在这里撤销' };
        }
        const store = submit(tx, entry.value);
        if (!store.ok) {
            return { ok: false, reason: `撤销没能写进真源：${store.reason}`, label: entry.label };
        }
        undoStack.pop();                                     // ★写成功了才丢这一步
        noteAuthoritative(tx.worldName, store.storedEnv);   // ★★★leg48：撤销之后面板也要画这份（第二顺位）
        const m = hasWorld(world)
            ? { ...mirrorInto(world, { ...store.storedEnv }, managedOf(tx.worldName)), pending: false }
            : (notePending(tx.worldName, store.storedEnv), { world: null, ok: false, changed: false, pending: true });
        return {
            ok: true, label: entry.label, reason: null, env: { ...store.storedEnv },
            world: m.world, mirrorOk: m.ok, mirrorPending: !!m.pending, store,
        };
    }

    /**
     * 载入期**一次做完**：接纳账上已有的参数 → 合并进真源 → 镜像回世界账。
     * 原子性口径：三件事一起算、一起报（失败留痕），并返回**新的世界对象**（调用方拿它落账）。
     */
    function commit(world) {
        const tx = begin(world);                                   // ★事务：读一次桶 + 钉住世界名（墓碑也在这一步生效）
        const accountEnv = paramKeysInWorldEnv(world);
        const legacyPending = arguments.length > 1 ? arguments[1] : null;
        const merged = loadMergedEnv(tx.bucket, tx.worldName, accountEnv, legacyPending);
        // ★★墓碑优先（八轮之后加的那道闸）：**玩家删掉过的键，任何旧快照都不许再"接纳"回来**。
        //   机理：别的插件/另一个页面实例把旧快照写回 ⇒ 我们读到"旧的那两个键" ⇒ 而接纳是绝对写
        //   ⇒ 会把玩家新写的档位一起删掉（＝用户那一屏的形状）。有了这一句，删除这件事有记忆。
        const env = { ...merged.env };
        const gone = tombstonesOf(tx.worldName);
        const blocked = [...gone].filter((k) => k in env);
        for (const k of blocked) delete env[k];
        const changed = merged.changed || blocked.length > 0;
        // 管辖键 = 账上那批 ∪ 真源里已有的（并集；此后真源里没有的就是玩家删的）
        const keys = registerManaged(world, [...Object.keys(accountEnv), ...Object.keys(tx.env)]);
        let store = null;
        if (changed) store = submit(tx, env);
        const effective = store && store.ok ? { ...store.storedEnv } : env;
        if (store && store.ok) noteAuthoritative(tx.worldName, effective);   // ★★★leg48：接纳之后面板就画这份
        // ★★★leg48：世界对象没到 ⇒ **接纳照做（真源该合的合）**，只是镜像这一格挂起（世界后到由 flushPending 补）
        const m = hasWorld(world)
            ? { ...mirrorInto(world, effective, keys), pending: false }
            : (notePending(tx.worldName, effective), { world: null, ok: false, changed: false, pending: true });
        if (changed) {
            log(`[参数真源] 载入接纳：世界「${tx.worldName}」真源 ${Object.keys(effective).join('、') || '（空）'}`
                + `${blocked.length ? ` · 已挡住 ${blocked.length} 个"玩家删过"的旧值回填（${blocked.join('、')}）` : ''}`
                + `${store?.ok ? '' : ` · ⚠ 接纳没能存下来（${store?.reason}）`}`);
        }
        return {
            world: m.world || world, env: effective, adopted: changed, mirrorOk: m.ok, mirrorChanged: m.changed,
            mirrorPending: !!m.pending,
            store, worldName: tx.worldName, managed: keys, blockedResurrect: blocked, vanished: tx.vanished,
            note: store && !store.ok ? `接纳没能存下来：${store.reason}` : null,
        };
    }

    /**
     * ★**这个世界的玩家输入**（真源 ∩ `isPlayerInputKey`）——给"清演化层 / 快照恢复"这类
     *   "世界那一层被重算"的路径用：它们要把玩家的档位**原样放回去**，但**不许**顺手把
     *   世界的因变量（`民生度`/`动乱度`）也搬回来（那是世界的活，不是玩家的输入）。
     *   ★与 `mirrorInto` 的"只镜像玩家输入"是同一条口径 —— 两处同源，不各判一套。
     */
    function playerInputs(world) {
        const tx = begin(world);
        const out = {};
        for (const [k, v] of Object.entries(tx.env)) if (isPlayerInputKey(k)) out[k] = v;
        return out;
    }

    /** 只镜像（给"账本被整份换成另一份"的路径用：快照恢复 / 导入 / 清演化层）。 */
    function mirrorOnly(world) {
        const tx = begin(world);
        const env = { ...tx.env };
        // ★删除权限用**管辖键**（账上接纳过的那一批）：`清除演化层` 之后真源里那个 `动乱度`
        //   本来就是"从账上接纳来的"，镜像才有权把它从账上拿掉（否则清了又被填回去）。
        //   ★注意与"只镜像玩家输入"配套：能删的只有真源管辖过的键，绝不误伤别人写的键。
        // ★★leg48：世界对象没到 ⇒ 不报"ok:true"充数（那会让调用方以为镜像成了）——挂起 + 如实说 pending。
        if (!hasWorld(world)) {
            notePending(tx.worldName, env);
            return { world: null, ok: false, changed: false, pending: true, env, missing: [] };
        }
        const m = mirrorInto(world, env, managedOf(tx.worldName));
        return { world: m.world || world, ok: m.ok, changed: m.changed, pending: false, env, missing: m.missing };
    }

    /** 自证面（用户可读的一句话，状态条与控制台共用）。 */
    function humanLine(extra = null) {
        return extra || `参数真源：${lastRead.source === 'local' ? '主路' : lastRead.source === 'legacy' ? '插件配置区' : '（还没有）'}`
            + `${lastRead.note ? ` · ${lastRead.note}` : ''} · 撤销 ${undoStack.count()} 步`;
    }

    /**
     * 三个读数（**用户截图/贴日志用的那一份**；对照 `localStorage` / 世界账 `env` / 世界名）。
     * 这就是 leg41 §5.1 让用户手打的那段控制台代码的**内置版**——以后不用让玩家开控制台。
     * ★★★leg48：多三格——`世界对象到手没有`（＝这次镜像做没做）、`桶键`（这次写进哪个桶）、
     *   `挂起的镜像`（世界没到那一刻攒下的键）。**这三格就是这次这条症状的照妖镜**：
     *   旧版在"世界对象没到"时什么都不写、也不说话，玩家与维护者两边都看不见。
     */
    function diag(world, tx = null) {
        const t = tx || begin(world);
        const s = st();
        let raw = null;
        try { raw = s && typeof s.getItem === 'function' ? s.getItem(PARAMS_LS_KEY) : null; } catch (_) {}
        return {
            世界名: t.worldName,
            桶键: t.worldName,
            主路: raw,
            真源: { ...(t.bucket.worlds[t.worldName] || {}) },
            读自: lastRead.source,
            读注: lastRead.note,
            账上镜像: { ...(world?.context?.setting?.dynamic?.env || {}) },
            管辖键: [...managedOf(t.worldName)],
            撤销步数: undoStack.count(),
            世界对象: hasWorld(world) ? '有' : '没有（镜像这一格挂起，世界载入后自动补）',
            挂起的镜像: { ...(pendingMirror.get(t.worldName) || {}) },
        };
    }

    function reset() {
        undoStack.reset();
        managed.clear();
        tombstones.clear();
        sessionWrites.clear();        // ★抢回名单也是模块级状态：不清会把上一条用例的键"抢回"到下一条（判据当场红过）
        pendingMirror.clear();        // ★同上：挂起的镜像也不许串到下一条用例
        lastAuthoritative.clear();    // ★同上：权威值快照也不许串（否则下一条用例会读到上一条的值）
        lastKnownWorld = null;
        lastKnownName = null;
        lastBucket = null;
        undoScope = null;
        lastRead = { source: 'none', note: null };
    }

    return {
        // 写入口（唯一）
        set, clear, undo, commit, mirrorOnly, registerManaged, flushPending,
        // 读（面板/渲染层）
        displayEnv, playerInputs, humanLine, diag, managedKeys: (world) => [...managedOf(worldNameArg(world))],
        /** ★审计：每一次写真源的留痕（自检面据此说出"谁在什么时候把桶动过"）。 */
        writeTrace: () => writeTrace.map((e) => ({ ...e, keys: [...e.keys], prevKeys: e.prevKeys ? [...e.prevKeys] : null, lost: [...e.lost] })),
        undoState: () => ({ canUndo: undoStack.count() > 0, count: undoStack.count() }),
        /**
         * ★★★leg48：**最后一次真正读写过的桶名**（＝"这个页面认的那个世界"）。
         * 面板显示值/控件对齐**必须读这个桶**——不然就会出现"写进 A 桶、读 B 桶、按默认把玩家选的值盖掉"
         * （真浏览器现场抓到的形状；本仓"一个数两把尺子"）。
         */
        currentWorldName: () => lastBucket || lastKnownName || null,
        reset,
        // 只读探针（判据用；生产不用）
        _readBucketForTest: () => readBucket(),
    };
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
// 五、面板文案（人话；玩家可见文本不许出现引擎术语）
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝

/** 人话标签（状态条 / 撤销按钮共用）。 */
export function paramLabel(key) {
    if (limitKey(key) != null) return LIMIT_META?.[key]?.label || key;
    if (SWITCH_PARAMS?.[key]?.label) return SWITCH_PARAMS[key].label;
    return key;
}
function countWord(key, after) {
    if (String(key) === 'autoAdvance' || String(key) === 'memoryEnabled') return after === '1' ? '开' : '关';
    return after ?? '未定';
}
function storeWord(stored) {
    if (stored === 'local') return '已存进本地存储';
    if (stored === 'config') return '已存在插件配置里';
    return '已存下来';
}
function LIMIT_GEARS_OF(key) {
    try { return LIMIT_GEARS[key]; } catch (_) { return null; }
}

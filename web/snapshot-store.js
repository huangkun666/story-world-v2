// story-world-v2/web/snapshot-store.js
// ★★★leg73（丙-web · **第二格**）：**快照容错子系统**从 `web/index.js` 搬到这里。
//
// 为什么单独成家（不是为了行数，是为了**归属正确**）：
//   这一族已经是一个**完整子系统**——自己的模块级状态（链/写队列/去重指纹/对齐标记/参数闸基准）、
//   自己的编排（何时拍 · 基准从哪来 · 失败怎么吞）、自己的保留窗口；
//   块内**零 DOM、零渲染、零视图态**（`node --test` 直接导入得了）。
//   它此前住在 3500 行接线层的中间 ⇒ "快照怎么拍/怎么回"的每一处改动都要先穿过一片无关代码。
//   ⇒ 搬出来之后：**快照的事只有这一个文件管**（纯逻辑从 `../src/snapshot.js` 取，存储适配从 `./idb-backend.js` 取）。
//
// 边界（块**逐字节**搬来，逻辑一字未改；本棒只动"它住哪" + "外面怎么够到它"）：
//   `ensureSnapshotChain` · `snapshotStore` · `stripParamKeys` · `isParamOnlyChange` · `requestSnapshot` ·
//   `snapshotList` · `restoreSnapshot` · `clearSnapshots` · `resetSnapshots` · `refreshSnapshots`
//   + 五个链状态 + `sw2SnapshotCache`（它原先住在块尾**之外**，随族一起迁）。
//
// ★★状态归属（本棒最该记住的一条，别改回去）：
//   快照的六个模块级状态**只住在本文件**，单一真源、不劈两半。
//   接线层要读清单面 ⇒ `readSnapshotCache()`；要清测试簿记 ⇒ `resetDedupState()`。
//   ★为什么不让外面直接读写：那样"快照链"就有两个家，一处改了另一处不知道——本仓最贵的病（"两份真相"）。
//
// ★★依赖方向（单向，叶子）：`web/index.js → web/snapshot-store.js → ../src/snapshot.js`。
//   本文件**不许**反向 import `web/index.js`（那会成环），也不许 import `web/` 里别的接线层模块。
//   ⇒ 接线层那几样东西（7 个函数 + 3 个取数口）一律走**依赖注入工厂** `createSnapshotHub(deps)`——
//     与 `src/param-hub.js` 的 `createParamHub` 同款（本仓先例：要真 ctx/真接线的子系统，提成可注入的工厂才测得动）。
//
// ★★★TDZ 铁律（leg72 §3-A 当场量出来的坑，务必照办）：
//   接线层那两个状态（`sw2LastWorld` / `LISTED_VOLUMES`）**声明在本模块之外、且位置更靠后**、
//   还可能被反复重新赋值 ⇒ **必须注入"取数函数"**，**不许注入值、更不许写成箭头 `() => sw2LastWorld`**：
//   箭头在**建 hub 那一刻**就求值 ⇒ 初始化期当场 `ReferenceError`。
//
// ★纪律留档（随块搬来，别丢）：
//   ① `requestSnapshot` 的**内容闸**（逐字节相同不拍）与**参数闸**（只有参数键在动不拍）都在本文件；
//      参数闸必须放在"记指纹"**之前**，否则一次纯参数写会冲掉 `sw2SnapLastWorldFp` 基准（判据锁着）。
//   ② `stripParamKeys` **不许**把 `ENGINE_DERIVED`（引擎每轮派生那几格）当参数剥掉——
//      剥了就会把"乱象变了"误判成"只有参数在动" ⇒ **不拍快照 ⇒ 回档丢状态**（leg53 真事故）。
//   ③ `restoreSnapshot` 必须**真的** `await flushHotMeta()`（leg72b：这一行曾被换成存根
//      `const flushed = { ok: true };` ⇒ 面板印的「已落盘」从来没说过真话）。
//   ④ ★★★leg85：`restoreSnapshot` **写回前**必须跑**同一处**载入期迁移 `migrateStyleRulesFromCanon`
//      （连续七棒的待办 leg74 §3-A → leg75 §3-C / leg76 §3-B / leg77 / leg78 / leg79 / leg80 都登记过）。
//      为什么必须是**同一个函数**（而不是在这里再写一次过滤）：本仓最忌"同一件事两处实现"——
//      摘除的唯一实现在 `pruneJunkRules`，这里调的是**它的那条既有通道**，不是第二份口径。
//      为什么必须在**这个位置**（写回前、而不是渲染层截）：`restoreSnapshot` 的产物是**世界账**，
//      而账本会被导出/换机/看账读到 ⇒ 脏数据一旦写回就出了门；渲染层再截就只是"看不见"，账上照旧有。
import { describeSnapshots, planStep, planRetention, restoreFrom } from '../src/snapshot.js';   // 纯逻辑（可 Node 测）
import { isParamStoreKey } from '../src/param-store.js';   // 判"这个键是不是参数"（参数闸用）
import { ENGINE_DERIVED } from '../src/params.js';         // ★leg53：引擎每轮算的那几格（不许当参数剥掉）
// ★★★leg85：旧快照的"文风禁令/变量指令/其他"要在这里被摘掉（载入期那处迁移的**同一个函数**）。
import { migrateStyleRulesFromCanon } from '../src/settle.js';
import { createIdbSnapshotStore } from './idb-backend.js'; // 存储适配（照旧卷同层同纪律）
//
// ---------- 注入形参（模块作用域；由 `createSnapshotHub` 构造时赋上）----------
// ★它们**沿用接线层里原本的名字** ⇒ 下面那段块里的调用点一个字都不用改（搬迁不是重写）。
let freshCtx = null;
let setStatus = null;
let refreshWorld = null;
let loadHotAccount = null;
let readHotMeta = null;
let sw2WriteHotMetaEnsuringParams = null;
let flushHotMeta = null;
// ★★★leg85：`hotAccountShape` **必须注入**（本棒当场咬出来的一个真缺陷，见文件末 `createSnapshotHub` 那段）。
//   它原先在 `restoreSnapshot` 里是**裸引用**，而本文件从头到尾**没有**它（也没 import）——
//   ⇒ 那条路一调就 `ReferenceError: hotAccountShape is not defined`，被 `catch (err)` 吞成
//     `{ ok: false, error: 'hotAccountShape is not defined' }` ⇒ **恢复快照整条路不可用**，
//     而面板只会印一行"恢复失败"（用户看到的就是"点了没反应"）。
//   ★为什么会漏：leg82 那次独立验证只查了 `web/param-panel.js`（那一族五个 `ReferenceError`），
//     没人对**快照族**做同一件事 ⇒ 同一个病在隔壁住着。**判据的覆盖面也是覆盖面**。
//   ★为什么走注入而不是自己 import：本文件是**叶子**（见文件头"依赖方向"）——
//     它要的两样东西 `hotAccountShape`/`loadHotAccount` 一个来自 `src/storage.js`、一个来自接线层，
//     凡"接线层那侧的取数口"一律走注入，才保得住"叶子"这条形态（判据把 import 清单锁成四条）。
let hotAccountShape = null;
/// ★★TDZ 铁律：接线层那两个状态的读法一律走**取数函数**（建 hub 时不求值、调用时才求值）。
let accessLastWorld = null;        // () => 接线层的 sw2LastWorld
let assignLastWorld = null;        // (w) => 接线层的 sw2LastWorld = w
let accessListedVolumes = null;    // () => 接线层的 LISTED_VOLUMES（每次现取，不缓存；它被反复重新赋值）
//
// ---------- 快照链状态（模块作用域 · 只住本文件）----------
let sw2SnapChain = { seq: 0, anchorId: null, anchorSeq: null, anchorWorld: null };
let sw2SnapQueue = Promise.resolve();   // 写串行（IDB 异步，不串行会竞态丢份）
let sw2SnapLast = [];                   // 最近两份快照的**逐字节指纹**（去重用，最多两串）
let sw2SnapInited = null;               // 链是否已与 IDB 对齐（null=未对齐）

// ★leg27 e（用户实拍：s1 时间最新、s12 最旧，**id 序列与时间完全对不上**）：
//   病 = **`seq` 只活在内存里，刷新即归零，而 IDB 里的旧快照还在**。
//   IDB 键是 `${chatId}:${id}` ⇒ 刷新后新链又从 `s1` 开始 ⇒ **新快照把旧快照按 id 一份份覆盖**，
//   各条链交织在一起（"越新的 id 时间越早"），且**重复份永远清不掉**（用户看到的"一下子多了这么多"）。
//   ⇒ 治法：**加载时把链与 IDB 对齐**——`seq` 取盘上最大序号，**凭空续号、绝不回头覆盖**。
//   对齐后 `anchorWorld` 为空 ⇒ 下一份自愿落 full（`planStep` 的既有规则），链头永远完整。
export async function ensureSnapshotChain() {
    if (sw2SnapInited) return sw2SnapInited;
    sw2SnapInited = (async () => {
        try {
            const metas = await snapshotStore(freshCtx).list();
            const seqs = metas.map((s) => { const m = /^s(\d+)$/.exec(String(s.id ?? '')); return m ? Number(m[1]) : 0; });
            const maxSeq = seqs.length ? Math.max(...seqs) : 0;
            if (maxSeq > sw2SnapChain.seq) sw2SnapChain = { ...sw2SnapChain, seq: maxSeq };
            console.info(`[story-world-v2] 快照链已对齐：盘上 ${metas.length} 份 · 最大序号 s${maxSeq}（新快照从 s${maxSeq + 1} 起，不再覆盖旧的）`);
        } catch (err) {
            console.warn('[story-world-v2] 快照链对齐失败（本次按新链处理）', String(err?.message || err));
        }
        return true;
    })();
    return sw2SnapInited;
}

export function snapshotStore(freshCtx) {
    const ctx = freshCtx();
    const chatId = String(ctx?.chatId ?? ctx?.chatMetadata?.chat_id_hash ?? 'default');
    return createIdbSnapshotStore(chatId);
}

/** 拍一份快照（异步 · 串行 · 零阻塞）。reason 只作可读标注，判据不放它身上。 */
//   ★★leg41（用户实机「参数改了好像还会生成快照极其不友好」）：**参数改动不再拍快照**。
//   为什么（v1 的先例）：v1 的持久快照只给"大操作"（生成/修订/体检）与受控编辑，5 份窗口就够用；
//     而 v2 把快照钩在**唯一落账收口**上，于是"改一个旋钮"也走这条路——`dynamic.env` 一变，
//     世界就逐字节变了，过不了下面那道内容闸 ⇒ **拧一次旋钮烧掉一个快照位**（15 份窗口被旋钮吃掉）。
//   口径（能机械核）：把**参数键全部摘掉**之后两份世界**逐字节相同** ⇒ 这一步只有参数在动，
//     **不是世界动了** ⇒ 不拍。此时参数的真源在插件配置里（本笔刚搬的家），快照本来也管不到它。
// ★★★leg53：**引擎每轮算的那几格不算"参数"**。
//   为什么必须加这一条（本棒实测的真事故形状）：`动乱度` 现在由 `src/unrest.js` 每轮从账上派生，
//   而本函数下面按 `isParamStoreKey` 剥"参数键"——它会**连引擎派生的那一格一起剥掉**
//   ⇒ `isParamOnlyChange` 会把"乱象变了"误判成"只有参数在动" ⇒ **不拍快照** ⇒ **回档丢状态**。
//   口径：`isParamStoreKey`（形状上属于参数表）≠ **"该被当参数剥掉"**——派生结果**是世界状态**。
export function stripParamKeys(world) {
    const copy = JSON.parse(JSON.stringify(world));      // 深拷贝：绝不动真账一个键
    const env = copy?.context?.setting?.dynamic?.env;
    if (!env || typeof env !== 'object') return copy;
    for (const k of Object.keys(env)) {
        if (ENGINE_DERIVED.includes(k)) continue;        // ★派生结果留在指纹里（它是世界状态）
        if (isParamStoreKey(k)) delete env[k];
    }
    return copy;
}
let sw2SnapLastWorldFp = null;   // 上一份"摘掉参数键"的世界指纹（判"只有参数在动"的基准）
export function isParamOnlyChange(world) {
    try {
        const env = world?.context?.setting?.dynamic?.env;
        if (!env || !Object.keys(env).some((k) => isParamStoreKey(k))) return false;   // 没有参数键 ⇒ 不适用
        if (!sw2SnapLastWorldFp) return false;           // 没有上一份可比 ⇒ 老实拍（链头必须有）
        return JSON.stringify(stripParamKeys(world)) === sw2SnapLastWorldFp;
    } catch (_) { return false; }
}
export function requestSnapshot(world, reason) {
    if (!world || typeof world !== 'object') return;
    const snapshot = JSON.parse(JSON.stringify(world));   // 立即取副本（后续可能被就地改）
    // ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝
    // ★leg27 d（用户实拍「**怎么一下子多了这么多，落账太细了还是 tick 吧**」，一屏 12 份、其中 11 份
    //   「增量 · 0KB」、tick 全是「第 0 轮」、时间戳挤在同一秒）：
    //   病的准确名字 = **"落账"不等于"世界动了"**。`writeHotMeta` 是**内存与盘面同步**的收口，
    //   它会在"账本逐字节没变"时也被调用（名册落账/位置继承/迁移/快照回填/初始化那一串）。
    //   我原来挂在它上面 ⇒ **对同一份世界反复拍快照**，其中还有**逐字节相同**的纯重复。
    //   ⇒ 加**内容闸**：与上一份逐字节相同 ⇒ 直接不拍（"一步"的定义 = **世界真的变了**）。
    //   这一闸同时把"落账太细"与"重复份"一起治掉：一个 tick 推进 = 一次真变化 = 一份快照。
    const fp = JSON.stringify(world);
    if (sw2SnapLast.includes(fp)) return;
    // ★leg41：**只有参数键在动 ⇒ 这不是"世界动了"**，不拍（理由见上面那段"参数改动不再拍快照"）。
    //   ★它必须放在"记指纹"**之前**：否则一次纯参数写会把 `sw2SnapLastWorldFp` 冲掉，
    //   下次真世界变化反而比不上了（判据里专门锁了这一条）。
    if (isParamOnlyChange(world)) {
        console.info('[story-world-v2] 只有参数档位变了（世界本体逐字节没变）⇒ 不拍快照');
        return;
    }
    sw2SnapLast = [fp, ...sw2SnapLast].slice(0, 2);
    sw2SnapLastWorldFp = JSON.stringify(stripParamKeys(world));
    sw2SnapQueue = sw2SnapQueue.then(async () => {
        try {
            await ensureSnapshotChain();      // ★异步边界上再保一次（防 loadWorld 的第一次对齐竞态）
            const p = planStep({
                seq: sw2SnapChain.seq,
                tick: world?.meta?.tick ?? null,
                world: snapshot,
                prevAnchorWorld: sw2SnapChain.anchorWorld,
                prevAnchorId: sw2SnapChain.anchorId,
                anchorSeq: sw2SnapChain.anchorSeq,
                reason: String(reason || '落账'),
            });
            await snapshotStore(freshCtx).put(p.snapshot);
            sw2SnapChain = { seq: p.nextSeq, anchorId: p.anchorId, anchorSeq: p.anchorSeq, anchorWorld: snapshot };
            // 保留窗口 15 步 · 锚点完整性由 planRetention 保证：丢锚就丢它名下的 delta
            const metas = await snapshotStore(freshCtx).list();
            const plan = planRetention({ snapshots: metas });
            if (plan.drop.length) await snapshotStore(freshCtx).drop(plan.drop);
            console.info(`[story-world-v2] 快照 ${p.snapshot.id}（${p.snapshot.kind}${p.mode ? `·${p.mode}` : ''} · ${p.snapshot.bytes} 字节）· ${p.snapshot.reason} · 现有 ${metas.length - plan.drop.length} 份`);
        } catch (err) {
            // 失败零阻塞：只进控制台（世界推进永远优先）
            console.warn('[story-world-v2] 快照失败（不影响世界推进）', String(err?.message || err));
        }
    });
}

/** 面板用：读快照清单 + 一行事实摘要（失败返回空，不抛） */
export async function snapshotList() {
    try {
        const metas = await snapshotStore(freshCtx).list();
        return { ok: true, list: metas, text: describeSnapshots(metas) };
    } catch (err) {
        return { ok: false, list: [], text: `快照不可读：${err?.message || err}` };
    }
}

/**
 * 回到某一步（**只回世界账**，用户拍板；对话记录不动）。
 * 三条纪律：①恢复前**先给当前状态拍一份**（防"恢复错了回不来"）②链不可恢复 ⇒ 明确拒绝、世界原样不动
 * ③恢复后落盘 + 重绘 + 把该份钉住（keepId）不被窗口剪掉。
 */
export async function restoreSnapshot(targetId) {
    try {
        const store = snapshotStore(freshCtx);
        const all = await store.listAll();
        const r = restoreFrom({ snapshots: all, targetId });
        if (!r.ok) return { ok: false, error: r.error };
        const current = loadHotAccount(readHotMeta()) || accessLastWorld();
        if (current) requestSnapshot(current, '恢复前自保');       // ②自保（异步，不阻塞这次恢复）
        // ★★★leg85：**恢复前先跑载入期那处旧账清理**（leg74 立、连续七棒登记的待办，本棒收口）。
        //   病（照 leg74 §3-A 原话）：这份快照若是 leg74 **之前**拍的，它账上还带着那几类
        //   （`文风禁令` / `变量指令` / `其他`）——**恢复一次就把用户已经拍板清掉的东西带回来**，
        //   而且要等下一次 `loadWorld` 才再被清掉（在那之前面板上就摆着它们）。
        //   治法：写回前调 `migrateStyleRulesFromCanon`（**同一个函数**，不在这里重写过滤）。
        //   ★三条纪律照旧成立：**幂等**（账上没有那几类 ⇒ 原对象返回 ⇒ 恢复出来的账逐字节不变）、
        //     **不可变**（返回新 ssot，`r.world` 那份原件一字不动）、**不许无声消失**（摘掉的原话
        //     进 `meta.styleRulesPurged` 留档，随下面那次落盘一起上盘）。
        //   ★★位置为什么必须在 `sw2WriteHotMetaEnsuringParams` **之前**（本棒最容易写错的一处）：
        //     那个函数**自己会落一次盘**（它内部保证"参数真源补镜像"这件事落下去）⇒ 若先写它、
        //     后迁移，则**那份带文风禁令的脏账已经上盘了**，后面那次 flush 只是覆盖回去——
        //     中间那一刻盘上是脏的（导出/看账能读到），且违背本仓"落盘前先把账弄干净"的口径。
        //   ★★为什么是**就地算一次、两个消费者共用**（而不是"写成 `if (migrated !== r.world)` 只做副作用"）：
        //     后者会让写回用的仍是**没迁移的那一份**（`r.world`）——那正是"算了不用"的形状，
        //     判据若只锁"调了这个函数"，这种半吊子写法照样绿。⇒ 迁移结果必须**真的流到写回面**。
        const migrated = migrateStyleRulesFromCanon(r.world);
        if (migrated !== r.world) {
            console.info('[story-world-v2] 快照恢复：这份旧快照里的"文风禁令/变量指令/其他"已按载入期同一口径摘掉（不再带回账上）');
        }
        // ★leg41：恢复的是**世界账**（参数不在里面）⇒ 写回前先把真源镜像补上，
        //   否则恢复后引擎会按"快照里那份旧 env"跑（面板写 12、闸按 6 —— 正是本仓禁的"一个数两把尺子"）。
        sw2WriteHotMetaEnsuringParams(hotAccountShape(migrated), migrated);
        // ★★★leg72b：**这一行曾经被换成存根** `const flushed = { ok: true };`（leg67–71 期间的未提交改动）
        //   ⇒ 后果不是"跳过落盘"，是**面板会说谎**：`bus['snapshot-restore']` 印的是
        //   `r.flushed ? ' · 已落盘' : ' · ⚠ 落盘失败'`，而恒真对象让那半句永远绿。
        //   本仓铁律「面板上印出来的数字必须现算」+「关键路径落盘后才报成功」（leg20 语义）
        //   ⇒ 恢复成显式落盘。★与其余五条能存的通道（账户形状同步/初始化/导入/重抽设定/采用草稿）同一口径。
        const flushed = await flushHotMeta();
        // ★leg85：`r.world` 到这里已经**被上面那次迁移替下**（`migrated` 才是写回盘上那一份）
        //   ⇒ "最近世界"必须取迁移后的那一份，否则内存里留的还是带文风禁令的旧账
        //   （表现为"恢复完账干净、可下一次落盘又把脏的写回去"）。
        //   ★这一行的口径与写回面**同一个来源**：两处若取不同的一份，就是本仓最贵的病（两份真相）。
        assignLastWorld( loadHotAccount(readHotMeta()) || migrated);
        refreshWorld(accessLastWorld(), { oldVolumes: accessListedVolumes() });
        // 钉住该份 + 它需要的锚（keepId 闭包）
        try {
            const metas = await store.list();
            const plan = planRetention({ snapshots: metas, keepId: String(targetId) });
            if (plan.drop.length) await store.drop(plan.drop);
        } catch (_) {}
        const t = r.world?.meta?.tick;
        return { ok: true, tick: t, plan: r.plan, flushed };
    } catch (err) {
        return { ok: false, error: String(err?.message || err) };
    }
}

export async function clearSnapshots() {
    try {
        const n = await snapshotStore(freshCtx).clear();
        // 三个内存态一起清：链、去重指纹、**对齐标记**（清了盘就必须允许重新对齐，否则新链又从头覆盖）
        sw2SnapChain = { seq: 0, anchorId: null, anchorSeq: null, anchorWorld: null };
        sw2SnapLast = [];
        sw2SnapInited = null;
        return { ok: true, removed: n };
    } catch (err) {
        return { ok: false, error: String(err?.message || err) };
    }
}

/**
 * 重置快照（清空 + 立刻给当前世界拍一份新链头）。
 * 用途（用户实拍 12 份的来源）：盘上混着**旧代码/丢账时拍下的**快照——内容不可信、id 也乱。
 * 一键丢掉那些、从"现在这份干净世界"重新起链。
 */
export async function resetSnapshots() {
    const cleared = await clearSnapshots();
    if (!cleared.ok) return cleared;
    const current = loadHotAccount(readHotMeta()) || accessLastWorld();
    if (current) await requestSnapshot(current, '重置后链头');
    return { ok: true, removed: cleared.removed };
}

export async function refreshSnapshots({ silent = true } = {}) {
    try {
        await ensureSnapshotChain();          // ★先对齐（否则新链会从头覆盖旧链）
        const r = await snapshotList();
        sw2SnapshotCache = { list: r.list, text: r.text };
        if (accessLastWorld()) refreshWorld(accessLastWorld(), { oldVolumes: accessListedVolumes() });
    } catch (err) {
        if (!silent) setStatus(`⚠ 快照刷新失败：${err?.message || err}`);
    }
}

let sw2SnapshotCache = null;      // leg27 后：快照清单（IDB 读回的元信息 + 摘要文案）——随 config 进渲染层，面板零第二份状态
//
// ---------- 受控通道（外面要够到"只住在这里"的状态，一律走这两条口）----------
/// 读：接线层渲染快照页要的清单面（`refreshSnapshots` 写它、`renderCfg` 读它）。
export function readSnapshotCache() { return sw2SnapshotCache; }
/// 清：接线层"落盘簿记复位"要顺带清的两个闸（内容闸指纹 + 参数闸基准）。
export function resetDedupState() { sw2SnapLast = []; sw2SnapLastWorldFp = null; }

// ★★接线层的**唯一入口**（依赖注入工厂）。
//   `deps` 十一样：8 个接线层函数 + 3 个取数口。
//   ★`freshCtx` 也走 deps（`snapshotStore` 每次现取 chatId ⇒ 换聊天自动换键空间，这是 leg27 e 的前提）。
//   ★★★leg85：**必填的四样要当场校验**（照 `createParamHub`/`createParamApi` 的先例）。
//     理由是本棒当场量出来的那个真缺陷：`hotAccountShape` 漏注入时**不报错、不报警**——
//     它只在"玩家真去恢复一份快照"那一刻炸成 `ReferenceError`，然后被 `catch` 吞成一行"恢复失败"。
//     ⇒ **缺依赖必须在建 hub 那一刻就响**（fail fast），不能等到用户点下去才发现。
//     为什么只校验这四样（而不是全部十一）：这四样是"缺了就会炸/会静默错"的那批——
//     其余几样（`setStatus`/`refreshWorld`/三个取数口）缺失时是**降级**而不是抛错，
//     它们由 `web-snapshot-layout ④` 那条"注入形参必须声明且被用到"的锁看着。
export function createSnapshotHub(deps) {
    if (!deps || typeof deps !== 'object') throw new TypeError('createSnapshotHub 需要 deps 对象');
    // ★本仓铁律：注入的**一律是函数**（注入值 = 冻在建 hub 那一刻，TDZ/过期）
    for (const key of ['freshCtx', 'loadHotAccount', 'readHotMeta', 'hotAccountShape']) {
        if (typeof deps[key] !== 'function') {
            throw new TypeError(`createSnapshotHub：\`${key}\` 必须是函数（收到 ${JSON.stringify(deps[key])}）`
                + '——注入的是函数不是值；★`hotAccountShape` 漏注入正是 leg85 咬出来的那个"恢复整条路不可用"的真缺陷');
        }
    }
    freshCtx = deps.freshCtx;
    setStatus = deps.setStatus;
    refreshWorld = deps.refreshWorld;
    loadHotAccount = deps.loadHotAccount;
    readHotMeta = deps.readHotMeta;
    sw2WriteHotMetaEnsuringParams = deps.sw2WriteHotMetaEnsuringParams;
    flushHotMeta = deps.flushHotMeta;
    hotAccountShape = deps.hotAccountShape;
    accessLastWorld = deps.getLastWorld;
    assignLastWorld = deps.setLastWorld;
    accessListedVolumes = deps.getListedVolumes;
    return {
        snapshotList, restoreSnapshot, clearSnapshots, resetSnapshots,
        requestSnapshot, refreshSnapshots, snapshotStore,
        readSnapshotCache, resetDedupState,
    };
}

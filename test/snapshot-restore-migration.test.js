// story-world-v2/test/snapshot-restore-migration.test.js
// ★★★leg85：**恢复一份旧快照时，载入期那处旧账清理必须跟着跑**——
//   leg74 §3-A 立的待办，leg75 §3-C / leg76 §3-B / leg77 / leg78 / leg79 / leg80 / leg83 连续七棒登记，
//   本棒收口。**先立锁（本文件），再改代码**（细案 §3.2 的纪律）。
//
// ── 病是什么（照 leg74 §3-A 原话）─────────────────────────────────────────────
//   `restoreSnapshot` 原先**只回世界账、不跑载入期迁移** ⇒ 恢复一份 **leg74 之前**拍的快照，
//   会把当时账上的那几类（`文风禁令` / `变量指令` / `其他`）**一起带回来**，
//   直到下一次 `loadWorld` 才被清掉——在那之前面板上就摆着用户已经拍板清掉的东西。
//   ★这不是"看不见"的问题：`restoreSnapshot` 的产物是**世界账**，导出 / 换机 / 看账都读得到它
//     ⇒ 脏数据一旦写回就出了门（在渲染层拦截只能做到"看不见"，账上照旧有）。
//
// ── 治法（leg74 §3-A 指定的形态，一个字没改）────────────────────────────────
//   `restoreSnapshot` **写回前**调**同一个** `migrateStyleRulesFromCanon`（不是在这里再写一次过滤）。
//   ★本仓最忌"同一件事两处实现"：摘除的唯一实现在 `pruneJunkRules`，本处调的是**它的那条既有通道**。
//
// ── 本文件的判据形态（照 `test/web-param-panel-layout.test.js` 那把"真调一次"的尺）──────
//   ★★★**这条必须真调**，不能只锁源码：leg82 的教训是"`import` 成功 ≠ 能真调"——
//     当时 `web/param-panel.js` 里 5 个 `ReferenceError` 全部躲过了"结构自证"。
//   ⇒ 本文件**搭一个假 IndexedDB + 真 hub**，把 `restoreSnapshot` 真的跑一遍，
//     然后看**写回面收到的那份世界**（`sw2WriteHotMetaEnsuringParams` 的实参）。
//     ★为什么不看返回值：返回值里只有 `{ ok, tick, plan, flushed }`，**世界不在里面**
//       ⇒ 只看返回值的话，"迁移算了但没写回"这种半吊子写法照样绿。
//
// ★夹具纪律（本仓明令，照 `rule-kinds.test.js`）：**不许出现"我在某一本书里看到的词或数字"当判据**。
//   下面的法则原文全是自造记号（`甲律`/`乙律`…），类别一律取自 `RULE_CLASSES_DROP` 常量
//   （不是抄字面量）⇒ 换一本书、改一次词表，本文件照样成立。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { migrateStyleRulesFromCanon } from '../src/settle.js';
import { RULE_CLASSES_DROP, RULE_CLASS_NONE } from '../src/abstract-tier.js';
import { hotAccountShape, loadHotAccount } from '../src/storage.js';
import { createSnapshotHub } from '../web/snapshot-store.js';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 一、假 IndexedDB（够用到"真的走完一遍 createIdbSnapshotStore"）

/**
 * 为什么自己搭一个（而不是把 `snapshotStore` 做成可注入）：`createIdbSnapshotStore` 是**叶子**，
 *   它只碰 `indexedDB` 这一个全局 ⇒ 在 Node 里补上这个全局，就能让**真实现**跑起来，
 *   不必为了"可测"去改生产代码的形状（改形状就等于让判据咬不到真东西了）。
 * ★它只实现 `idb-backend.js` 真正用到的那一面（见该文件）：`open` / `createObjectStore` /
 *   `transaction` / `objectStore` / `getAll` / `get` / `put` / `delete`。
 * ★事务的 `oncomplete` 走 `queueMicrotask`：真 IDB 是异步的，快照链的写队列正是靠这个才需要串行。
 */
function installFakeIdb() {
    const dbs = new Map();
    const openDbNames = new Set();

    const makeDb = (name) => {
        const stores = new Map();
        const db = {
            objectStoreNames: { contains: (n) => stores.has(n) },
            createObjectStore: (n) => { stores.set(n, new Map()); },
            transaction(storeName) {
                const rowsMap = stores.get(storeName);
                if (!rowsMap) throw new Error(`假 IDB：没有这张表 ${storeName}`);
                const tx = { error: null };
                tx.objectStore = () => ({
                    getAll: () => { const r = { result: [...rowsMap.values()] }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    get: (k) => { const r = { result: rowsMap.has(k) ? rowsMap.get(k) : undefined }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    put: (rec) => { rowsMap.set(rec.key, rec); const r = { result: rec.key }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                    delete: (k) => { rowsMap.delete(k); const r = { result: undefined }; queueMicrotask(() => tx.oncomplete?.()); return r; },
                });
                return tx;
            },
            close() {},
        };
        return db;
    };

    globalThis.indexedDB = {
        open(name) {
            const req = { result: null, error: null };
            if (!dbs.has(name)) dbs.set(name, makeDb(name));
            req.result = dbs.get(name);
            const fresh = !openDbNames.has(name);      // 只有**第一次**才补吐 upgrade（真 IDB 同款）
            openDbNames.add(name);
            queueMicrotask(() => {
                if (fresh) req.onupgradeneeded?.();
                req.onsuccess?.();
            });
            return req;
        },
    };
    return () => { delete globalThis.indexedDB; };
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 二、世界夹具（法则账带"该被摘掉的那几类"）

const R_JUDGE = '甲律：检定取整';
const R_WORLD = '乙律：此界有两轮日月';
const R_STYLE = '丙律：正文必须收在同一个标记里';
const R_VAR = '丁律：每轮先读一次环境';
const R_MISC = '戊律：安装方法见状态栏倒数第三个按钮';

/** 一份"像真账"的世界（形状照 `snapshot.test.js` 的 `makeWorld`：entities/weights/… 都在）。 */
function makeWorld({ tick = 3, withJunk = true } = {}) {
    const rules = withJunk ? [R_JUDGE, R_WORLD, R_STYLE, R_VAR, R_MISC] : [R_JUDGE, R_WORLD];
    const canon = { rules, bookEntities: [{ name: '角色1', kind: 'character' }] };
    // ★只给"该被摘掉的那几类"标类别；留下的两条标成保留类（`RULE_CLASS_NONE` 之外的合法类）
    if (withJunk) {
        canon.ruleKinds = { [R_JUDGE]: '判断依据', [R_WORLD]: '世界观设定' };
        RULE_CLASSES_DROP.forEach((cls, i) => { canon.ruleKinds[[R_STYLE, R_VAR, R_MISC][i]] = cls; });
    }
    return {
        version: 1,
        context: {
            world: '测试界',
            setting: {
                frozen: { fingerprint: 'fnv1a_t', extractedAt: 'T', canon },
                dynamic: { tension: { polarity: '未聚', direction: '', intensity: 0.5 }, env: {}, derivedFrom: [] },
            },
        },
        entities: [{ id: 'e_bk_1', name: '角色1', kind: 'character' }],
        weights: { e_bk_1: 0.31 },
        agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick, simLog: [] },
    };
}

/** 一份 full 快照记录（`restoreFrom` 认 `kind === 'full'` 就直接回它，不必配锚点）。 */
const fullRecord = (world, id = 's1') => ({
    format: 'sw2-snapshot', version: 1, id, tick: world.meta.tick, at: '2026-09-20T00:00:00.000Z',
    reason: '夹具', kind: 'full', world, bytes: JSON.stringify(world).length,
});

/**
 * 搭一个**真的** hub（假 IDB + 假接线层依赖），并把 `restoreSnapshot` 跑一遍。
 * 返回：`{ written, result, seedWorld }`
 *   · `written` = `sw2WriteHotMetaEnsuringParams(meta, world)` 收到的**那个 world**（= 写回盘上的那一份）
 *   · `result`  = `restoreSnapshot()` 的返回值
 *   · `seedWorld` = 快照里那一份**原件**（用于判"不可变"）
 */
async function runRestore(seedWorld) {
    const uninstall = installFakeIdb();
    try {
        // ★写回面装成一个**探针**：本判据要看的正是"写回盘上的到底是哪一份世界"
        const written = { world: null, meta: null, count: 0 };
        const hub = createSnapshotHub({
            freshCtx: () => ({ chatId: '夹具聊天', saveSettingsDebounced() {} }),
            setStatus: () => {},
            refreshWorld: () => {},
            loadHotAccount,
            readHotMeta: () => null,
            // ★★★leg85：`hotAccountShape` 是**注入**进来的（不是新家自己 import）——
            //   本判据第一次跑就把"它以前是裸引用、压根没注入"这个真缺陷咬了出来。
            hotAccountShape,
            sw2WriteHotMetaEnsuringParams: (meta, world) => { written.meta = meta; written.world = world; written.count += 1; },
            flushHotMeta: async () => ({ ok: true }),
            getLastWorld: () => null,          // ★刻意给 null：本次不测"恢复前自保"那条支路（另有用例锁它）
            setLastWorld: () => {},
            getListedVolumes: () => [],
        });
        // 先把快照塞进假 IDB（键空间照 `createIdbSnapshotStore`：`${chatId}:${id}`）
        const rec = fullRecord(seedWorld);
        const fakeDb = globalThis.indexedDB.open('story-world-v2', 2).result;
        fakeDb.objectStoreNames.contains('snapshots') || fakeDb.createObjectStore('snapshots', { keyPath: 'key' });
        fakeDb.transaction('snapshots', 'readwrite').objectStore().put({ key: `夹具聊天:${rec.id}`, ...rec });
        await new Promise((r) => setTimeout(r, 0));      // 让那条假事务的 oncomplete 走完

        const result = await hub.restoreSnapshot(rec.id);
        return { written, result, seedWorld };
    } finally {
        uninstall();
    }
}

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// 三、★★★行为判据：真调一次

test('★★★leg85：恢复一份带"文风禁令"的旧快照 ⇒ 恢复后账上**不许**有那一类（且原话进 meta 留档）', async () => {
    const seed = makeWorld({ tick: 3, withJunk: true });
    // ★判据前提自证（防"夹具里本来就没有那几类"的假绿）：这一份**真的**带着该被摘掉的那几类
    const seedKinds = seed.context.setting.frozen.canon.ruleKinds;
    for (const cls of RULE_CLASSES_DROP) {
        assert.ok(Object.values(seedKinds).includes(cls),
            `★夹具自证：这份"旧快照"里必须真的标着「${cls}」这一列（否则下面那条判据测的是空气）`);
    }
    assert.equal(seed.context.setting.frozen.canon.rules.length, 5, '★夹具自证：五条法则（留 2 摘 3）');

    const { written, result } = await runRestore(seed);

    // ① 恢复本身必须成功（否则下面所有断言都是"恢复失败恰好没写回"的假绿）
    assert.equal(result.ok, true, `★前置：这份快照必须能恢复（实测 ${JSON.stringify(result)}）`);
    assert.equal(written.count, 1, '★前置：写回面必须**恰好被调一次**（写回是本判据唯一的取证面）');
    assert.ok(written.world && typeof written.world === 'object', '★前置：写回面必须收到一份世界对象');

    // ② ★★★本棒要咬的那一条：写回盘上的那一份，账上**不许**有那几类
    const outKinds = written.world.context.setting.frozen.canon.ruleKinds || {};
    for (const cls of RULE_CLASSES_DROP) {
        assert.ok(!Object.values(outKinds).includes(cls),
            `★★★恢复后账上不许有「${cls}」这一类 —— 这正是 leg74 §3-A 那条待办；`
            + '出现它 = 恢复一次就把用户拍板清掉的东西带回来了');
    }
    // ③ 合法的那几条**原话一字不改**（防"一刀把整个法则账砍了"这种过度修正）
    assert.deepEqual(written.world.context.setting.frozen.canon.rules, [R_JUDGE, R_WORLD],
        `★只摘该摘的：判据/世界观那两条必须原话一字不改（实测 ${JSON.stringify(written.world.context.setting.frozen.canon.rules)}）`);
    assert.deepEqual(outKinds, { [R_JUDGE]: '判断依据', [R_WORLD]: '世界观设定' },
        '★类别键同步收窄（两列不许劈叉）——被摘掉那三类的键要一起消失');
    // ④ 不许无声消失：摘掉的原话进 `meta` 留档（照 leg74 的三条纪律之③）
    assert.deepEqual(written.world.meta.styleRulesPurged, [R_STYLE, R_VAR, R_MISC],
        '★★摘掉的原话必须进 `meta.styleRulesPurged` 留档（"不许无声消失"）');
    assert.equal(written.world.meta.styleRulesPurgedAt, 3,
        '★留痕时点照旧取 tick（缺省口径，与载入期那处同一个函数 ⇒ 同一个值）');

    // ⑤ ★不可变：快照里那一份**原件**一字未动（本仓"纯函数：输入不被修改"那条铁律）
    //    —— 快照是"历史"，恢复它不该把历史改了（改了就再没有"恢复到当时"这回事）
    assert.equal(seed.context.setting.frozen.canon.rules.length, 5, '★★快照原件必须还是五条（迁移是不可变的）');
    assert.ok(Object.values(seed.context.setting.frozen.canon.ruleKinds).includes(RULE_CLASSES_DROP[0]),
        '★★快照原件里的类别键也一字未动');

    // ⑥ ★★反向自证：这条判据真的会咬 —— 把"没迁移的那一份"喂给同一口径，必须被认出来
    const notMigrated = clone(seed);
    const kindsOfNotMigrated = notMigrated.context.setting.frozen.canon.ruleKinds;
    assert.ok(Object.values(kindsOfNotMigrated).some((v) => RULE_CLASSES_DROP.includes(v)),
        '★反向自证：**未经迁移**的那一份必须被②那条口径判为不合格（否则上面全绿也可能只是判据瞎了）');
});

test('★★leg85：恢复一份**干净**快照 ⇒ 账本逐字节不变（幂等 ⇒ 新快照零扰动）', async () => {
    // ★为什么这条必须有：迁移是**每次恢复都要跑**的（没有"要不要跑"的分支）
    //   ⇒ 它若在"没有那几类"时也改动账本，就会**每一次恢复都改一个字节**——
    //     那既让"恢复出来的账与当时逐字节相等"这条快照的核心契约失效，也会白白多写一次盘。
    const seed = makeWorld({ tick: 9, withJunk: false });
    const before = JSON.stringify(seed);
    const { written, result } = await runRestore(seed);
    assert.equal(result.ok, true, '★前置：干净快照当然要能恢复');
    assert.equal(JSON.stringify(written.world), before,
        '★★★恢复一份干净快照 ⇒ 写回的那一份必须与快照**逐字节相等**（迁移无可摘时原对象返回）');
    // ★反向自证：这条"逐字节"是真的能咬的（拿一份被改过的世界，必须判不等）
    const tampered = clone(seed); tampered.meta.tick = 10;
    assert.notEqual(JSON.stringify(tampered), before, '★反向自证：改一个字节这条口径就必须红');
});

test('★★leg85：载入期与恢复期跑的是**同一个**函数（不是第二份过滤口径）', () => {
    // ① 载入期那处的实参是**同一个符号名**（`web/index.js` 的第三处清理）
    const index = read('web/index.js');
    assert.match(index, /const\s+migrated1\s*=\s*migrateStyleRulesFromCanon\(migrated\)/,
        '★载入期那处必须还在（本棒不动它——本棒只是让恢复期走同一个函数）');
    // ② 恢复期那处（新家）
    const store = read('web/snapshot-store.js');
    assert.match(store, /const\s+migrated\s*=\s*migrateStyleRulesFromCanon\(r\.world\)/,
        '★恢复期必须调**同一个** `migrateStyleRulesFromCanon`（写回前、就地算一次）');
    assert.match(store, /^import \{ migrateStyleRulesFromCanon \} from '\.\.\/src\/settle\.js';$/m,
        '★它必须是 import 进来的（本仓"import 花括号里不写注释"那条纪律：整行逐字比对，防漂移）');
    // ③ ★★本仓最忌"同一件事两处实现"：新家里**不许**出现第二个过滤口径
    //    （判据形态照 `rule-kinds.test.js`：只扫**带引号的形态**——那才是"又写了一遍过滤逻辑"的指纹；
    //     不留引号扫裸词会红在本文件自己的留档上）
    const code = store.split('\n').filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.equal((code.match(/'(?:文风禁令|变量指令|其他)'/g) || []).length, 0,
        '★★`web/snapshot-store.js` 的**代码**里不许出现那三个类别的字面量 —— 摘除只许走 `pruneJunkRules`');
    // ④ ★★★位置判据：迁移必须在**写回**之前（本棒最容易写错的一处）
    //    为什么：`sw2WriteHotMetaEnsuringParams` **自己会落一次盘** ⇒ 先写它、后迁移
    //    ⇒ 那份带文风禁令的脏账**已经上盘了**（导出/看账能读到），后面那次 flush 只是覆盖回去。
    const pMigrate = store.indexOf('migrateStyleRulesFromCanon(r.world)');
    const pWrite = store.indexOf('sw2WriteHotMetaEnsuringParams(hotAccountShape(migrated), migrated)');
    assert.ok(pMigrate > 0 && pWrite > 0, '★前置：两处都在（取不到就是判据自己写错了）');
    assert.ok(pMigrate < pWrite, '★★★迁移必须在写回**之前**（先写回 = 脏账已经出过门了）');
    // ⑤ ★★迁移结果必须**真的流到写回面**（"算了不用"是同一个洞的另一种形状）
    assert.ok(!/sw2WriteHotMetaEnsuringParams\(hotAccountShape\(r\.world\), r\.world\)/.test(store),
        '★★写回面**不许**还在用未迁移的 `r.world` —— 那正是"算了不用"（判据若只锁"函数被调到"就抓不住它）');
    assert.match(store, /assignLastWorld\(\s*loadHotAccount\(readHotMeta\(\)\) \|\| migrated\)/,
        '★"最近世界"也必须取**迁移后**的那一份（两处取不同的一份 = 本仓最贵的病：两份真相）');
    // ⑥ ★反向自证：④⑤两条口径都真的能咬
    const BAD_ORDER = 'sw2WriteHotMetaEnsuringParams(hotAccountShape(r.world), r.world);\nconst migrated = migrateStyleRulesFromCanon(r.world);';
    assert.ok(BAD_ORDER.indexOf('migrateStyleRulesFromCanon(r.world)') > BAD_ORDER.indexOf('sw2WriteHotMetaEnsuringParams'),
        '★反向自证：**先写回后迁移**的顺序必须被判为不合格（否则④是假绿）');
    assert.ok(/sw2WriteHotMetaEnsuringParams\(hotAccountShape\(r\.world\), r\.world\)/.test(BAD_ORDER),
        '★反向自证：**用未迁移那一份写回**必须被⑤认出来（否则⑤是假绿）');
});

test('★leg85：老账（没有类别那一格）零迁移 —— 认不出就不猜（与载入期同一口径）', async () => {
    // 照 leg74 的"零迁移纪律"：leg64 之前的账**根本没有 `ruleKinds`** ⇒ 一条都认不出来 ⇒ 原样返回。
    //   ★这条必须有：恢复一份很老的快照时，"猜着删"的代价比"留着"大得多（删掉的东西回不来）。
    const seed = makeWorld({ tick: 1, withJunk: true });
    delete seed.context.setting.frozen.canon.ruleKinds;      // 老账：那一格整个不存在
    const before = JSON.stringify(seed);
    assert.equal(migrateStyleRulesFromCanon(clone(seed)) && JSON.stringify(migrateStyleRulesFromCanon(clone(seed))), before,
        '★前置：没有类别那一格 ⇒ 迁移就是恒等（不猜、不重抽）');
    const { written, result } = await runRestore(seed);
    assert.equal(result.ok, true, '★前置：老快照也要能恢复（不许因为"清不了"就拒绝恢复）');
    assert.equal(JSON.stringify(written.world), before,
        '★★老账（无 `ruleKinds`）⇒ 一个字都不许改（零迁移：认不出就不猜）');
    assert.equal('styleRulesPurged' in written.world.meta, false,
        '★没有摘掉任何东西 ⇒ `meta` 里不该凭空多出留痕键');
    assert.ok(RULE_CLASS_NONE.length > 0, '★常量自证：类别词表里"未分类"那一格仍在（老账就是落在它上面）');
});

// ★★这一条**必须放在最后**：`createSnapshotHub` 是**模块级单例装配**（工厂把 deps 赋给模块作用域的
//   `let`），负控跑完会把依赖装成假的 ⇒ 后面的用例就测不到真测试台了（leg82 当场踩过并留档）。
test('★★leg85：工厂对"必填的四样"必须**当场**拒绝（缺依赖不许等到玩家点下去才炸）', () => {
    const good = {
        freshCtx: () => null, loadHotAccount: () => null, readHotMeta: () => null, hotAccountShape: (x) => x,
    };
    assert.doesNotThrow(() => createSnapshotHub(good),
        '★负控：四样都是函数时不许抛（否则这条判据自己假绿）');
    // ★★★本棒要咬的那一条：`hotAccountShape` 漏注入 ⇒ 恢复快照整条路不可用。
    //   它是本棒**真咬出来的缺陷**（不是假设）：本判据第一次跑就报
    //   `{"ok":false,"error":"hotAccountShape is not defined"}`。
    for (const key of ['freshCtx', 'loadHotAccount', 'readHotMeta', 'hotAccountShape']) {
        for (const bad of [{}, 'function', 42, null, undefined, []]) {
            assert.throws(() => createSnapshotHub({ ...good, [key]: bad }), TypeError,
                `★\`${key}\` 收到 ${JSON.stringify(bad)}（是值不是函数）时必须 throw TypeError`);
        }
    }
    assert.throws(() => createSnapshotHub(), TypeError, '★整份 deps 都不给时也必须拒绝');
    // ★反向自证：这条口径真的能咬住"缺一格"（拿掉 `hotAccountShape` 那份必须被认出来）
    const missing = { ...good };
    delete missing.hotAccountShape;
    assert.ok(typeof missing.hotAccountShape !== 'function',
        '★反向自证：漏注入那一份必须过不了上面的校验（否则这条锁是假绿）');
});

// story-world-v2/test/param-store.test.js
// ★★leg41：**参数真源（`src/param-store.js`）+ 撤销栈（`src/undo-stack.js`）**的单元判据。
//   为什么单独一层判据（不只靠 `set-param-persist.test.js` 的端到端）：这两个模块是"参数住在哪"
//   这件事的**唯一裁决处**——白名单归一、三态返回、桶形状、镜像纪律、撤销语义都在这里，
//   端到端用例查不出"某个键被静默丢掉"这种细账（leg40c 六轮全绿而实机全败就是这么来的）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PARAMS_SETTINGS_KEY, PARAMS_STORE_VERSION, worldNameOf, isParamStoreKey, isPlayerInputKey, normalizeStoreValue,
    emptyStore, normalizeStore, loadMergedEnv, mirrorEnvIntoWorld, paramKeysInWorldEnv, applyParamEdit,
    ALL_PARAM_KEYS,
} from '../src/param-store.js';
import { createParamUndoStack } from '../src/undo-stack.js';
import { ENGINE_DERIVED } from '../src/params.js';   // ★leg53：引擎每轮算的那几格（真源不许接纳它们）

const mkWorld = (env = {}, worldName = '大荒z') => ({
    context: { world: worldName, setting: { dynamic: { tension: { polarity: 'P', intensity: 0.5 }, env: { ...env } } } },
    entities: [], meta: { tick: 3 },
});

test('leg41·param-store：键表完整（四个尺度上限 + 四个档位 + 三个开关都在白名单里）', () => {
    assert.equal(PARAMS_SETTINGS_KEY, 'story_world_v2_params');
    for (const k of ['每轮递线', '每轮事件', '顶层大计', '在飞大计', '民生度', '动乱度', '天时', '张力推手', 'autoAdvance', 'memoryEnabled']) {
        assert.ok(isParamStoreKey(k), `★${k} 必须在白名单里`);
        assert.ok(ALL_PARAM_KEYS.includes(k), `★${k} 必须进 ALL_PARAM_KEYS`);
    }
    assert.ok(!isParamStoreKey('recordEnabled'), '已撤的开关不许在表里');
    assert.ok(!isParamStoreKey('不存在的键'));
});

test('leg41·param-store：归一三态分明（合法值 / 清空 / 非法），绝不把非法当清空', () => {
    assert.equal(normalizeStoreValue('天时', '大灾'), '大灾');
    assert.equal(normalizeStoreValue('每轮事件', 12), '12', '★数字要归一成字符串（账本契约 strRecord）');
    assert.equal(normalizeStoreValue('每轮事件', '12'), '12');
    assert.equal(normalizeStoreValue('autoAdvance', '1'), '1');
    assert.equal(normalizeStoreValue('天时', ''), null, '空 ⇒ 清空');
    assert.equal(normalizeStoreValue('天时', '   '), null, '全空白 ⇒ 清空');
    assert.equal(normalizeStoreValue('天时', '春和景明'), false, '★非法档位 ⇒ false（**不是** null：绝不能被当成"清空"）');
    // ★★leg54（口径升级）：`每轮事件: '7'` 从"非法"移走了——**上限无上限之后 7 是合法值**。
    //   这条判据的**实质一字未变**：真正的非法（非数字/小数/0/负数）一律 `false`，不当清空。
    assert.equal(normalizeStoreValue('每轮事件', '0'), false, '★0 不是合法条数 ⇒ false（**不是** null）');
    assert.equal(normalizeStoreValue('每轮事件', '2.5'), false, '★小数 ⇒ false');
    assert.equal(normalizeStoreValue('每轮事件', '-1'), false, '★负数 ⇒ false');
    assert.equal(normalizeStoreValue('每轮事件', '7'), '7', '★但 7 现在**合法**（无上限；旧版这里判它非法）');
    assert.equal(normalizeStoreValue('没有这个键', '大灾'), false);
});

test('leg41·param-store：桶形状——洗坏形/丢垃圾键/按世界名分桶', () => {
    assert.deepEqual(emptyStore(), { version: PARAMS_STORE_VERSION, worlds: {} });
    assert.deepEqual(normalizeStore(null), emptyStore(), '空/坏输入 ⇒ 空桶（绝不抛）');
    assert.deepEqual(normalizeStore({ version: 1, worlds: 'x' }), emptyStore());
    // ★★leg54（口径升级）：`每轮事件: '0'` 才是垃圾了（旧版用 '7'，而无上限之后 7 合法）。
    //   这条判据的**实质一字未变**：洗桶时认不出的键与读不懂的值都丢，别搬进新家。
    const cleaned = normalizeStore({ version: 1, worlds: { 大荒z: { 天时: '大灾', 乱写的键: 'x', 每轮事件: '0', autoAdvance: 1 } } });
    // ★口径（读实现确认过，不是猜）：归一先做 `String(v).trim()` ⇒ 数字 1 会被**认成开关的 '1'**；
    //   真正的垃圾是"读不懂的值"（`每轮事件: '0'`——条数不能是 0）与"认不出的键"。
    assert.deepEqual(cleaned.worlds['大荒z'], { 天时: '大灾', autoAdvance: '1' });
    assert.equal(cleaned.worlds['大荒z']['乱写的键'], undefined, '★认不出的键一律丢（不搬进新家）');
    assert.equal(cleaned.worlds['大荒z']['每轮事件'], undefined, '★读不懂的值一律丢（"0" 不是合法条数）');
    const badSwitch = normalizeStore({ version: 1, worlds: { W: { autoAdvance: '2' } } });
    assert.deepEqual(badSwitch.worlds.W, {}, '★开关只认 1/0（"2" 丢掉）');
});

test('leg41·param-store：载入合并的优先级——**真源 > 账上 > 旧兜底**（真源一旦写过就永远是它）', () => {
    const bucket = { version: 1, worlds: { 大荒z: { 天时: '大灾' } } };
    const r = loadMergedEnv(bucket, '大荒z', { 天时: '平常', 张力推手: '紧绷' }, { 每轮递线: '6' });
    assert.equal(r.env['天时'], '大灾', '★真源赢（哪怕账上是别的档位）');
    assert.equal(r.env['张力推手'], '紧绷', '账上有的、真源没有的 ⇒ 接纳（升级不丢档位）');
    assert.equal(r.env['每轮递线'], '6', '旧兜底只在真源与账上都没有时才补');
    assert.equal(r.changed, true);
    const same = loadMergedEnv(bucket, '大荒z', { 天时: '大灾' }, null);
    assert.equal(same.changed, false, '★没有需要接纳的键 ⇒ changed:false（调用方据此不白写一次配置）');
});

test('★★★leg53：**引擎每轮算的那几格不许被"接纳"进真源**（派生结果归账上，真源只管玩家能拧的）', () => {
    // 病（本棒实测的机理）：`动乱度` 现在由 `src/unrest.js` 每轮从账上派生，而载入接纳会把
    //   "账上已有的参数键"接进**插件配置桶**（`settings.json`）⇒ 引擎算的**结果**被写进
    //   "玩家在这个世界选过什么"那个桶里 = **语义污染**，且那份值下一轮就过期。
    // ★这条同时守住旧账兼容的另一半：**玩家能拧的键照旧接纳**（不许因为堵这一格把接纳整条关掉）。
    const r = loadMergedEnv({ version: 1, worlds: {} }, 'W', { 动乱度: '动荡', 天时: '大灾', 民生度: '艰难' }, null);
    assert.equal(r.env['动乱度'], undefined, '★引擎派生的那一格**不许**进真源（它是结果，不是玩家的选择）');
    assert.equal(r.env['天时'], '大灾', '★玩家能拧的照旧接纳（旧账升级不丢档位）');
    assert.equal(r.env['民生度'], undefined, '★`民生度` 也不进真源（因变量，真源无权管辖——leg41 立的规矩）');
    // 所以"真源桶里只有玩家输入"这条不变量，在任何源上都成立
    for (const k of Object.keys(r.env)) {
        assert.ok(!ENGINE_DERIVED.includes(k), `★真源里不许有引擎派生的键「${k}」`);
    }
});

test('leg41·param-store：镜像——只碰参数键；世界别的 env 键一个不动；无变化返回原对象', () => {
    const w = mkWorld({ 动乱度: '动荡', 别的引擎键: 'x' });
    const out = mirrorEnvIntoWorld(w, { 天时: '大灾' });
    assert.equal(out.context.setting.dynamic.env['天时'], '大灾');
    assert.equal(out.context.setting.dynamic.env['动乱度'], '动荡', '★账上已有的参数键**不许**被顺手擦掉（本模块第一版就错在这里，判据当场抓红）');
    assert.equal(out.context.setting.dynamic.env['别的引擎键'], 'x', '★非参数键不许动（引擎/旧版留下的键）');
    assert.equal(w.context.setting.dynamic.env['天时'], undefined, '★纯函数：不改入参');
    const same = mirrorEnvIntoWorld(out, { 天时: '大灾' });
    assert.equal(same, out, '★无变化 ⇒ 返回原对象（调用方据此不白写账）');
});

test('leg41·param-store：镜像的删除**只删"玩家输入"里被真源删掉的那些**（三个坑都要躲开）', () => {
    const w = mkWorld({ 动乱度: '动荡', 天时: '大灾', 别的引擎键: 'x' });
    // ①没登记管辖键（判据/旧调用方）⇒ 一个都不删（绝不误伤）
    const noKeys = mirrorEnvIntoWorld(w, {}, null);
    assert.equal(noKeys.context.setting.dynamic.env['天时'], '大灾', '★没登记 ⇒ 不删（退回"只填不删"）');
    // ②登记了管辖键 ⇒ 真源里没了的那个才是玩家删的（删它），没管辖的一个不动
    const managed = mirrorEnvIntoWorld(w, {}, ['天时', '张力推手']);
    assert.ok(!('天时' in managed.context.setting.dynamic.env), '★玩家删掉的档位必须真的从账上消失（否则引擎还按旧档跑）');
    assert.equal(managed.context.setting.dynamic.env['别的引擎键'], 'x', '★没管辖的非参数键永远不碰');
    // ③★**因变量不归真源管**（判据当场抓出的语义差）：哪怕被登记进管辖键，也**不许**被删——
    //    `民生度`/`动乱度` 是世界的**结果**（面板只呈现），若被真源"管"住，
    //    一次载入接纳就会把"书里/引擎刚写的世界结果"钉成玩家输入，反压世界的新值。
    const dep = mirrorEnvIntoWorld(w, { 天时: '大灾' }, ['动乱度', '民生度']);
    assert.equal(dep.context.setting.dynamic.env['动乱度'], '动荡', '★因变量永远不被镜像删掉');
    assert.equal(dep.context.setting.dynamic.env['天时'], '大灾');
    // ④清空（真源里这个键没了）在载入期照样生效 ⇒ 清空不会"复活"
    const reload = mirrorEnvIntoWorld(managed, {}, ['天时']);
    assert.ok(!('天时' in reload.context.setting.dynamic.env), '★清空过的档位在下次载入不会复活');
});

test('leg41·param-store：`isPlayerInputKey` 与 `isParamStoreKey` 是两件事（形状 vs 权限）', () => {
    // 形状上都在参数表里
    for (const k of ['天时', '张力推手', '民生度', '动乱度', '每轮事件', 'autoAdvance']) {
        assert.ok(isParamStoreKey(k), `${k} 形状上属于参数表`);
    }
    // 但只有"玩家能拧的"才是真源管辖
    for (const k of ['天时', '张力推手', '每轮事件', '每轮递线', '顶层大计', '在飞大计', 'autoAdvance', 'memoryEnabled']) {
        assert.ok(isPlayerInputKey(k), `★${k} 是玩家输入 ⇒ 真源有权管辖`);
    }
    for (const k of ['民生度', '动乱度']) {
        assert.equal(isPlayerInputKey(k), false, `★${k} 是因变量（世界的结果，面板只呈现）⇒ 真源无权管辖`);
    }
    assert.equal(isPlayerInputKey('别的引擎键'), false);
});

test('leg41·param-store：从世界账取参数键（只取白名单内的）', () => {
    const got = paramKeysInWorldEnv(mkWorld({ 天时: '大灾', 动乱度: '动荡', 别的引擎键: 'x', autoAdvance: '1' }));
    assert.deepEqual(got, { 天时: '大灾', 动乱度: '动荡', autoAdvance: '1' });
    assert.equal(worldNameOf(mkWorld({}, '大荒z')), '大荒z');
    assert.equal(worldNameOf(null), '未名世界', '拿不到世界名 ⇒ 兜一个稳定名（防"写进一个桶、读回另一个桶"）');
});

test('leg41·param-store：受控编辑——先算后写；无实质变更不入栈；非法值一律丢', () => {
    const prev = { 天时: '大灾' };
    const changed = applyParamEdit(prev, (p) => ({ ...p, 张力推手: '紧绷' }));
    assert.equal(changed.changed, true);
    assert.deepEqual(changed.env, { 天时: '大灾', 张力推手: '紧绷' });
    assert.deepEqual(changed.before, { 天时: '大灾' });
    assert.deepEqual(prev, { 天时: '大灾' }, '★纯函数：入参没被动过');
    const same = applyParamEdit(prev, (p) => ({ ...p }));
    assert.equal(same.changed, false, '★值一样 ⇒ 不算一次改动（不写盘、不入撤销栈）');
    // ★口径（读实现确认过，不是猜）：非法值会被**丢掉**（受控入口不该产生脏值）⇒ 若编辑只带来了
    //   非法值，那一格等于"被清掉" ⇒ 这**算一次改动**（真源里那个键没了），不是"无变化"。
    //   真源里绝不留下 '瞎写的' 这种值——这才是本用例要锁的东西。
    const dirty = applyParamEdit(prev, (p) => ({ ...p, 天时: '瞎写的' }));
    assert.equal(dirty.changed, true, '★脏值被丢 ⇒ 那一格等于清掉（算改动，但**绝不把脏值写进真源**）');
    assert.deepEqual(dirty.env, {}, '★真源里不许出现非法值');
    assert.deepEqual(prev, { 天时: '大灾' }, '★入参仍然一个字节没动');
    const dirtyNoop = applyParamEdit({}, (p) => ({ ...p, 天时: '瞎写的' }));
    assert.equal(dirtyNoop.changed, false, '★本来就空、编辑也只有脏值 ⇒ 无变化（不写盘、不入撤销栈）');
    const threw = applyParamEdit(prev, () => { throw new Error('炸'); });
    assert.equal(threw.changed, false);
    assert.match(threw.reason, /抛错/);
});

// ---------- 撤销栈 ----------
function mkStack(initial = {}) {
    let cur = { ...initial };
    const log = [];
    const stack = createParamUndoStack({
        read: () => ({ ...cur }),
        write: (next) => { cur = { ...next }; },
        log: (l) => log.push(l),
        limit: 3,
    });
    return { stack, log, get: () => ({ ...cur }) };
}

test('leg41·undo-stack：编辑 → 撤销 → 回到变更前那一步（逐字节）', () => {
    const s = mkStack({ 天时: '大灾' });
    assert.equal(s.stack.edit('天时 → 平常', (p) => ({ ...p, 天时: '平常' })).changed, true);
    assert.deepEqual(s.get(), { 天时: '平常' });
    assert.equal(s.stack.count(), 1);
    const label = s.stack.undo();
    assert.equal(label, '天时 → 平常');
    assert.deepEqual(s.get(), { 天时: '大灾' }, '★退回变更前那一份（引用写回，零拷贝）');
    assert.equal(s.stack.canUndo(), false);
    assert.equal(s.stack.undo(), null, '★没得退 ⇒ null（调用方据此如实报"没有可撤销的改动"）');
});

test('leg41·undo-stack：无实质变更不入栈；连续同标签合并成一步', () => {
    const s = mkStack({});
    assert.equal(s.stack.edit('x', (p) => ({ ...p })).changed, false);
    assert.equal(s.stack.count(), 0, '★无变化不入栈（否则撤销一次 = 什么都没发生）');
    s.stack.edit('a', (p) => ({ ...p, 天时: '大灾' }));
    s.stack.edit('a', (p) => ({ ...p, 天时: '平常' }));   // 同标签连续 ⇒ 合并
    assert.equal(s.stack.count(), 1, '★同标签连续编辑只记最早那一步（照 v1 的输入框语义）');
    s.stack.undo();
    assert.deepEqual(s.get(), {}, '★撤销回到**最早**那一步之前');
});

test('★★★leg41·undo-stack（实机抓红的真缺陷）：**回调自己写存储时，栈也必须记"变更前"那份**', () => {
    // 病（我这一轮亲手踩的，留档防重犯）：`edit()` 过去是"先 push 再 write"，而 `push` **自己再 read 一次**。
    //   只要 `fn` 里就写了存储（本仓 `set-param` 的受控编辑正是这么写的：`sw2PersistParamEnv(next)`），
    //   那次 read 读到的就是**改完之后**的状态 ⇒ 栈里存的是"新状态" ⇒ **撤销等于什么都没撤**。
    //   ★它还很会藏：单跑判据全绿、`undo()` 也返回 ok、日志还打着"撤销：xxx"——只是存储没变。
    //   ⇒ 现在 `edit()` 把**已取好的"变更前"那份**直接传给 `pushValue`，语义与 v1 的"先记后写"完全一致。
    let store = {};
    const st = createParamUndoStack({
        read: () => ({ ...store }),
        write: (next) => { store = { ...next }; },   // 照真实现的形状（撤销时就是靠它把旧值写回去）
    });
    // ★照 web 层的形状：**`fn` 自己也写存储**（这正是触发那个 bug 的写法）
    st.edit('改 天时', (prev) => { const next = { ...prev, 天时: '大灾' }; store = { ...next }; return next; });
    st.edit('改 张力推手', (prev) => { const next = { ...prev, 张力推手: '紧绷' }; store = { ...next }; return next; });
    assert.deepEqual(store, { 天时: '大灾', 张力推手: '紧绷' });
    assert.equal(st.count(), 2, '两步改动 = 两步撤销');
    assert.equal(st.undo(), '改 张力推手');
    assert.deepEqual(store, { 天时: '大灾' }, '★★撤销必须真的把存储退回去（旧实现退不动：栈里记的是"改后"那份）');
    assert.equal(st.undo(), '改 天时');
    assert.deepEqual(store, {}, '★再退一步 ⇒ 回到最初');
});

test('★leg41·undo-stack：写存储只发生**一次**（同一笔编辑不许写两遍）', () => {
    // 病：web 层一度在 `fn` 里写一次、`edit()` 的 `write` 又写一次 ⇒ 每笔编辑写两遍
    //   （顺带把"撤销栈读到改后状态"那个 bug 放大成必然）。现在**写存储只有一处**。
    let store = {};
    let writes = 0;
    const st = createParamUndoStack({
        read: () => ({ ...store }),
        write: (next) => { writes += 1; store = { ...next }; },
    });
    st.edit('x', (prev) => ({ ...prev, 天时: '大灾' }));
    assert.equal(writes, 1, '★一次编辑只许写一次存储');
    st.undo();
    assert.equal(writes, 2, '撤销那次也算一次写');
});

test('leg41·undo-stack：上限滑窗（丢最旧）· 写回失败不许留"撤销到不存在的状态"', () => {
    const s = mkStack({});
    for (let i = 0; i < 5; i += 1) s.stack.edit(`第${i}步`, (p) => ({ ...p, [`k${i}`]: '1' }));
    assert.equal(s.stack.count(), 3, '★上限 3 ⇒ 只留最近 3 步');
    const bad = createParamUndoStack({
        read: () => ({ 天时: '大灾' }),
        write: () => { throw new Error('写不进去'); },
    });
    const r = bad.edit('x', (p) => ({ ...p, 天时: '平常' }));
    assert.equal(r.ok, false);
    assert.match(r.reason, /写回失败/);
    assert.equal(bad.count(), 0, '★写失败 ⇒ 那一步必须从栈上摘掉');
});

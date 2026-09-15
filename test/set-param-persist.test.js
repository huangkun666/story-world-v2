// story-world-v2/test/set-param-persist.test.js
// ★★leg46（用户令「重构代码吧，我已经没有耐心了」）：**面板那条总线的判据**——只锁"接线"。
//
// 这一份的边界（为什么必须窄）：参数的**行为**判据全在 `test/param-hub.test.js`（真源/镜像/撤销/
// 三态/刷新/接纳/自洽）。这里只回答一个问题：**面板按下下拉之后，接线层有没有把 hub 的结果
// 正确地落到该落的地方**（真源 + 聊天账 + 状态条 + 面板重绘）。
// ★为什么要把边界划清（本仓最贵的一课）：leg41 那一版在这里锁了"真源桶形状 / 分桶 / 镜像删除规则 /
//   撤销步数"等**属于 hub 的语义**，于是同一语义在两处各判一遍 ⇒ 改动时两处一起漂（而判据全绿、
//   实机全败）。现在**一处实现、一处判据**：hub 的语义只在 param-hub.test.js 锁。
//
// 本文件锁四件事（都是"接线错了就会重现用户症状"的那种）：
//   ① 一次点击 ⇒ 真源落定 + **世界账镜像落定**（用户报的读数就是后者那一格）；
//   ② 状态条 = hub 的原话（不许在接线层另写一套"说得比做的好听"的口径）；
//   ③ 改参数**不 flush 整份聊天**（旧法每拧一次旋钮 = 整份 9.6MB 上盘）；
//   ④ 非法档位 ⇒ 拒绝且**不动真源**、面板重绘**不整页**（整页重绘会销毁正在展开的下拉）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installFakeDom, makeLocalStorage, makeSt } from './fixture-param.mjs';

const { status: statusEl } = installFakeDom();
const mod = await import('../web/index.js');
const { sw2ResetFlushState, sw2ParamUndoState, sw2UndoParam, sw2ParamDiag } = mod;

const setParam = async (key, value) => {
    statusEl.textContent = '';
    await globalThis.window.__sw2Actions['set-param']({ param: key, value });
    return statusEl.textContent;
};
/** 每条用例 = 一个新浏览器（清主路）。 */
beforeEach(() => { sw2ResetFlushState(); globalThis.window.localStorage = makeLocalStorage(); });

// ── ① 真源 + 镜像（用户的读数就是第二格）──────────────────────────────────
test('★★★leg46·①（接线）：一次点击 ⇒ 真源落定 **且** 世界账镜像落定（用户报的那一格）', async () => {
    const st = makeSt();
    const line = await setParam('天时', '大灾');
    assert.deepEqual(st.store(), { 天时: '大灾' }, '★真源里就是玩家选的那一档');
    assert.deepEqual(st.mirror(), { 天时: '大灾' }, '★★世界账 `dynamic.env` 读得到（leg41 用户读数就是这里只有两个旧键）');
    assert.match(line, /已存进本地存储/, '★状态条说的是真话：存进了本地存储');
    assert.ok(!/已落盘/.test(line), '★不许再出现"已落盘"（那是整份聊天上盘的说法，与参数无关）');
    assert.equal(st.calls.saveChat, 0, '★不触整份聊天上盘');
    assert.ok(st.calls.saveSettings >= 1, '插件配置区那份照样写（备份/导出/迁移会带上它）');
});

test('★leg46·①b（接线）：八个参数键走**同一条**真源（档位 / 开关 / 四个尺度上限不分家）', async () => {
    const st = makeSt();
    await setParam('天时', '大灾');
    await setParam('每轮事件', '12');
    await setParam('autoAdvance', '1');
    assert.deepEqual(st.store(), { 天时: '大灾', 每轮事件: '12', autoAdvance: '1' });
    assert.deepEqual(st.mirror(), { 天时: '大灾', 每轮事件: '12', autoAdvance: '1' }, '镜像一条不落');
});

test('★leg46·①c（接线）：引擎真的按镜像跑（上限 12 生效，不是"面板写 12、闸按 6"）', async () => {
    const st = makeSt();
    await setParam('每轮事件', '12');
    const { resolveLimits } = await import('../src/limits.js');
    assert.equal(resolveLimits(st.mirror ? st.chatMetadata.story_world_v2.world : st.world)['每轮事件'], 12,
        '★引擎的闸读到的就是 12');
});

// ── ② 状态条 = hub 的原话 ─────────────────────────────────────────────────
test('★★leg46·②（接线）：写失败时状态条**如实报错**（接线层不许把失败说成成功）', async () => {
    const st = makeSt();
    // 把主路换成"写不进去"的那种存储（真机形状：隐私模式 / 配额）
    globalThis.window.localStorage = {
        getItem: () => { throw new Error('存储被禁用'); },
        setItem: () => { throw new Error('存储被禁用'); },
        removeItem: () => {},
    };
    const line = await setParam('天时', '大灾');
    assert.match(line, /没能存下来/, '★状态条必须说出失败');
    assert.match(line, /存储被禁用/, '★并说清哪一步失败（"不许谎报"是七轮教训换来的）');
    assert.ok(!/已存进本地存储/.test(line), '★绝不谎报成功');
    void st;
});

test('★leg46·②b（接线）：值没变 ⇒ 如实出声"本来就是它"（"点了没反应"是原始抱怨）', async () => {
    const st = makeSt();
    await setParam('天时', '大灾');
    const line = await setParam('天时', '大灾');
    assert.match(line, /本来就是它/);
    assert.equal(sw2ParamUndoState().count, 1, '★"无变化"不许入撤销栈');
    void st;
});

// ── ③ 不整份上盘 ──────────────────────────────────────────────────────────
test('★★leg46·③（接线）：改参数**不 flush 整份聊天**（旧法每拧一次旋钮 = 整份 9.6MB 上盘）', async () => {
    const st = makeSt();
    await setParam('天时', '大灾');
    await setParam('每轮事件', '12');
    assert.equal(st.calls.saveChat, 0, '★★一次显式整份聊天保存都不该有');
});

// ── ④ 拒绝与重绘 ──────────────────────────────────────────────────────────
test('★leg46·④（接线）：非法档位 ⇒ 拒绝、**不动真源**、不入撤销栈', async () => {
    const st = makeSt();
    const line = await setParam('天时', '春和景明');
    assert.deepEqual(st.store(), {}, '真源没被写脏');
    assert.ok(!('天时' in st.mirror()), '镜像也没有它');
    assert.match(line, /不是「天时」的可选档位/);
    assert.equal(sw2ParamUndoState().count, 0, '拒绝的那一下不入撤销栈');
});

test('★★leg46·④b（接线）：未知参数键 ⇒ 拒绝（这条通道只收白名单里的键）', async () => {
    const st = makeSt();
    const line = await setParam('不存在的键', 'x');
    assert.match(line, /未知参数键/);
    assert.equal(st.rawStore(), null, '真源一个字都没写');
});

test('★leg46·④c（接线）：空值（滚轮滑过下拉）⇒ **不认这一下**，值不许变', async () => {
    const st = makeSt();
    const line = await setParam('天时', '');
    assert.deepEqual(st.store(), {}, '真源一个字都没写');
    assert.match(line, /本来就是「未定」/);
    assert.ok(!/已存|已落盘/.test(line), '不谎报成功');
});

// ── ⑤ 撤销走总线 ──────────────────────────────────────────────────────────
test('★★leg46·⑤（接线）：面板的撤销按钮 ⇒ 真源与镜像一起回退（世界已发生的事不回退）', async () => {
    const st = makeSt();
    await setParam('天时', '大灾');
    await setParam('张力推手', '紧绷');
    assert.equal(sw2ParamUndoState().count, 2, '两次改动 = 两步撤销');
    const r = sw2UndoParam();
    assert.equal(r.ok, true, '撤销成功');
    assert.deepEqual(st.store(), { 天时: '大灾' }, '★退回上一步');
    assert.deepEqual(st.mirror(), { 天时: '大灾' }, '★镜像同步回退');
    const r2 = sw2UndoParam();
    assert.equal(r2.ok, true);
    assert.deepEqual(st.store(), {}, '再退一步 ⇒ 回到最初');
    assert.equal(sw2UndoParam().ok, false, '★没得退时如实拒绝');
});

// ── ⑥ 自证面 ──────────────────────────────────────────────────────────────
test('★★leg46·⑥（接线）：自证面把"世界名 / 真源 / 账上镜像"一次报全（玩家不必再开控制台）', async () => {
    const st = makeSt();
    await setParam('天时', '大灾');
    const d = sw2ParamDiag();
    assert.equal(d.世界名, '大荒z', '★桶键就是世界名（读与写同一把尺子）');
    assert.equal(d.桶键, '大荒z');
    assert.deepEqual(d.真源, { 天时: '大灾' });
    assert.deepEqual(d.账上镜像, { 天时: '大灾' });
    assert.equal(d.读自, 'local', '★读自哪里（主路 / 插件配置区）也如实报');
    assert.ok(String(d.主路).includes('大荒z'), '主路原文也要在（坏形/丢键时一眼看得出）');
});

// story-world-v2/test/param-hub.test.js
// ★★★leg46（用户令「重构代码吧，我已经没有耐心了」）：**参数唯一写入口的判据**。
//
// 这份文件替换掉"在屏幕附近打补丁"的那七轮判据。它锁的不是"某一笔有没有落下去"，
// 而是**结构性纪律**（每一条都能机械核，且对着一条真实症状）：
//   ① 一个写入口：真源 + 镜像 + 撤销**一次事务**做完（写两次存储 / 写两遍镜像都算犯规）；
//   ② **一个桶键**：读与写用的是**同一个世界名**——这是"读一个桶、写另一个桶"那类静默失败的根治；
//   ③ 写必核对，且**如实**：主路写失败时不许因为"备份写上了"就报成功（用户报了七轮的那句话）；
//   ④ 面板的值**只由 `displayEnv` 一处裁决**（真源 > 账本镜像 > 出厂默认），绝不出空串；
//   ⑤ 刷新（世界账换一份）⇒ 值还在、面板照旧画对；
//   ⑥ 载入接纳：账上已有的档位一次性进真源（升级不丢档位），且**不动别的世界**；
//   ⑦ 撤销：退的是玩家的档位（真源 + 镜像一起回退），步数如实；
//   ⑧ 空值三态：本来就是未定 ⇒ 不认；有值 ⇒ 才算清空；非法档位 ⇒ 拒绝且**不动真源**；
//   ⑨ ★**写入口不许回潮**：`web/index.js` 里不许再出现参数存储的写语句（源码级扫描）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { installFakeDom, makeLocalStorage, makeSt, makeHub, makeWorld } from './fixture-param.mjs';

const { status: statusEl } = installFakeDom();
const mod = await import('../web/index.js');
const { sw2ParamUndoState, sw2UndoParam, sw2ResetFlushState, sw2ParamDiag } = mod;
const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'param-hub.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 每条用例 = 一个新浏览器（清主路）+ 清模块级状态。 */
beforeEach(() => { sw2ResetFlushState(); globalThis.window.localStorage = makeLocalStorage(); });

// ── ① 一个写入口：真源 + 镜像一次做完 ─────────────────────────────────────
test('★★leg46·①：一次 `set` ⇒ 真源与镜像**一起**写好（不是"先写真源、镜像看运气"）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    const r = hub.set(st.world, '天时', '大灾');
    assert.equal(r.ok, true, '写成功');
    assert.equal(r.kind, 'ok');
    assert.deepEqual(st.store(), { 天时: '大灾' }, '★真源（主路）里就是玩家选的那一档');
    assert.deepEqual(r.mirror.world.context.setting.dynamic.env, { 天时: '大灾' }, '★镜像（引擎读的那一格）同步写好');
    assert.equal(r.mirror.ok, true, '镜像核对通过');
    assert.match(r.humanLine, /已存进本地存储/, '★状态条说的是**存到哪了**');
    assert.ok(!/已落盘/.test(r.humanLine), '★不许再说"已落盘"（那是整份聊天上盘的说法，与参数无关）');
    assert.equal(st.calls.saveChat, 0, '★参数改动不触整份聊天上盘');
    assert.ok(st.calls.saveSettings >= 1, '插件配置区那份照样写（备份/导出/迁移会带上它）');
    // 桶带版本号、按世界名分桶（换聊天不串味）
    assert.equal(st.rawStore().version, 1);
    assert.deepEqual(Object.keys(st.rawStore().worlds), ['大荒z']);
});

test('★leg46·①b：**只写一次存储**（同一笔改动写两遍 = 本仓"撤销失灵"那个 bug 的温床）', async () => {
    const st = makeSt();
    const seen = [];
    const realSet = globalThis.window.localStorage.setItem;
    globalThis.window.localStorage.setItem = (k, v) => { seen.push(k); return realSet(k, v); };
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    assert.deepEqual(seen, ['sw2_params_v1'], `★一笔改动只许写一次真源，实际 ${JSON.stringify(seen)}`);
});

test('★★leg46·①（真总线那一版）：世界里落定之后，账上读到的就是镜像', async () => {
    // ★判据自己踩过一次（留档）：`hub.set` **不会**就地改 `chat_metadata`——它返回**新的世界对象**，
    //   落账是接线层（`set-param` 那条总线）干的。所以"账上读得到"要在**总线**上判（见 ⑩），
    //   在 hub 这一层拿 `st.mirror()` 去判就是**假红**（第一版就是这么红的）。
    const st = makeSt();
    sw2ResetFlushState();
    await globalThis.window.__sw2Actions['set-param']({ param: '天时', value: '大灾' });
    assert.deepEqual(st.mirror(), { 天时: '大灾' }, '★总线走完 ⇒ 世界账里读得到（用户报的那一格读数）');
});

// ── ② 一个桶键：读与写同一个世界名（"读一个桶、写另一个桶"的根治）──────────
test('★★leg46·②：换世界 ⇒ 写进**那个世界自己的桶**，绝不写脏另一个世界', async () => {
    const st = makeSt({ worldName: '世界甲' });
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    const w2 = st.switchWorld('世界乙');
    const r = hub.set(w2, '每轮事件', '12');
    assert.equal(r.worldName, '世界乙', '★这次事务钉住的桶键');
    assert.deepEqual(st.rawStore().worlds['世界甲'], { 天时: '大灾' }, '甲世界那一桶原样');
    assert.deepEqual(st.rawStore().worlds['世界乙'], { 每轮事件: '12' }, '乙世界写进**自己的**桶');
    assert.deepEqual(r.mirror.world.context.setting.dynamic.env, { 每轮事件: '12' }, '乙世界的镜像只含乙的参数');
    // ③ 自证面把两个读数（世界名 / 真源 / 账上镜像）原样报出来 —— 用户不必再开控制台
    const d = hub.diag(w2);
    assert.equal(d.世界名, '世界乙');
    assert.equal(d.桶键, '世界乙');
    assert.deepEqual(d.真源, { 每轮事件: '12' });
    assert.equal(d.读自, 'local');
});

test('★leg46·②b：世界名缺失 ⇒ 归到「未名世界」这一个桶（不许散成多个无名桶）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    const anon = makeWorld('');
    hub.set(anon, '天时', '大灾');
    assert.ok(st.rawStore().worlds['未名世界'], `★实际桶：${JSON.stringify(Object.keys(st.rawStore().worlds))}`);
});

// ── ③ 写必核对，且**如实**（用户报了七轮的那句话）─────────────────────────
test('★★★leg46·③：主路写不进去 ⇒ 状态条**如实报错并说清原因**（绝不许因为"备份写上了"就报成功）', async () => {
    const st = makeSt();
    const hub = await makeHub({ storage: () => ({ getItem: () => { throw new Error('存储被禁用'); }, setItem: () => { throw new Error('配额不足'); } }) });
    const r = hub.set(st.world, '天时', '大灾');
    assert.equal(r.ok, false, '★没存下来就是没存下来（旧实现靠"插件配置区写上了"把 ok 抬成 true ⇒ 谎报成功）');
    assert.equal(r.kind, 'fail');
    assert.match(r.humanLine, /没能存下来/);
    assert.match(r.humanLine, /配额不足|存储被禁用/, '★原因必须原样带出来（"说清哪一步失败"）');
    assert.equal(r.mirror.world, null, '真源没落定 ⇒ 不往世界账里写一份"看起来生效了"的镜像');
    assert.deepEqual(st.mirror(), {}, '★世界账里必须没有它');
});

test('★leg46·③b：**主路写进去、读回来不一样** ⇒ 也算失败（回读核对不是装饰）', async () => {
    const st = makeSt();
    const fake = {
        getItem: () => null,                     // 读回来永远是空 ⇒ 与写下去的必然不一致
        setItem: () => {},
    };
    const hub = await makeHub({ storage: () => fake });
    const r = hub.set(st.world, '天时', '大灾');
    assert.equal(r.ok, false, '回读不一致必须判失败');
    assert.match(r.humanLine, /没能存下来/);
});

test('★leg46·③c：完全没有本地存储（隐私模式）⇒ 退回插件配置区，但**如实说明它不保证跨启动存活**', async () => {
    const st = makeSt();
    const hub = await makeHub({ storage: () => null });
    const r = hub.set(st.world, '天时', '大灾');
    assert.equal(r.ok, true, '只剩这一处可用时以它为准');
    assert.match(r.humanLine, /插件配置里/, '★说的是"存在插件配置里"，不是"已存进本地存储"');
    assert.match(r.humanLine, /不保证跨启动存活/, '★这句必须说出来（它正是"刷新就没了"的那个风险）');
    assert.deepEqual(st.settingsMirror(), { 天时: '大灾' });
});

// ── ④ 面板的值只由 displayEnv 一处裁决 ────────────────────────────────────
test('★★leg46·④：面板的值**只由 displayEnv 裁决**（真源 > 账本镜像 > 出厂默认），且绝不出空串', async () => {
    const st = makeSt({ env: {} });
    const hub = await makeHub();
    // 真源里有一个（玩家选过）、账上镜像里有一个（存量世界/书里抽的）、谁都没有的两个
    st.world.context.setting.dynamic.env = { 每轮事件: '12' };
    hub.set(st.world, '天时', '大灾');
    const view = hub.displayEnv(st.chatMetadata.story_world_v2.world);
    assert.equal(view['天时'], '大灾', '① 真源说了算');
    assert.equal(view['每轮事件'], '12', '② 真源没有 ⇒ 用账上镜像那个');
    assert.equal(view['每轮递线'], '3', '③ 两处都没有 ⇒ **出厂默认**（不是空串、不是 undefined）');
    assert.equal(view['顶层大计'], '15', '③ 同上');
    for (const [k, v] of Object.entries(view)) {
        assert.notEqual(String(v), '', `★「${k}」绝不许是空串（leg41 的"四个下拉全空白"就是它）`);
    }
    assert.ok(!('动乱度' in view), '★因变量（民生度/动乱度）不给旋钮 ⇒ 不进面板那份');
});

test('★★leg46·④b：面板画的就是这份值（渲染层与 hub **同源**，不许各判一套）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    hub.set(st.mirror?.world || st.chatMetadata.story_world_v2.world, '每轮事件', '12');
    const { renderParamsHtml } = await import('../src/render.js');
    const html = renderParamsHtml(st.chatMetadata.story_world_v2.world, { config: { paramEnv: hub.displayEnv(st.chatMetadata.story_world_v2.world) } });
    const seg = (key) => { const i = html.indexOf(`data-param="${key}"`); return html.slice(i, html.indexOf('</select>', i)); };
    assert.match(seg('天时'), /<option value="大灾" selected>/, '天时那一栏选中玩家选的那档');
    assert.match(seg('每轮事件'), /12" selected/, '上限那一栏也读真源（leg41 漏过它 ⇒ 画回 6）');
    assert.match(seg('每轮递线'), /3" selected/, '真源没有 ⇒ 画出厂默认');
});

// ── ⑤ 刷新：用户报的那一条 ────────────────────────────────────────────────
test('★★★leg46·⑤（用户报的那一条）：改完参数 → 世界账换一份（＝刷新）⇒ 值还在、下拉还选中它', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    hub.set(st.chatMetadata.story_world_v2.world, '每轮事件', '12');
    const want = st.store();
    const fresh = st.simulateReload();                      // 真刷新：世界账从盘上重读一份新的
    assert.deepEqual(st.store(), want, '★真源不在世界账里 ⇒ 世界怎么换手动不到玩家的档位');
    const hub2 = await makeHub();                            // 新页面 = 新 hub（读同一份主路）
    const c = hub2.commit(fresh);                            // 载入期：接纳 + 镜像
    assert.deepEqual(hub2.displayEnv(c.world), { 天时: '大灾', 每轮事件: '12', 每轮递线: '3', 顶层大计: '15', 在飞大计: '20' },
        '★四个下拉都画对（12 而不是回到 6）');
    assert.deepEqual(c.world.context.setting.dynamic.env, { 天时: '大灾', 每轮事件: '12' },
        '★刷新之后镜像照旧同步给引擎');
});

test('★leg46·⑤b：**ST 的配置通道完全没跟上**（settings.json 那份是旧的/空的）⇒ 主路照样说了算', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    st.ctx.extensionSettings = {};        // 真机形状：`saveSettings()` 那道 `settingsReady` 闸静默不写
    const hub2 = await makeHub();
    assert.deepEqual(hub2.displayEnv(st.chatMetadata.story_world_v2.world)['天时'], '大灾', '★主路（同步写）才是答案');
});

// ── ⑥ 载入接纳 ────────────────────────────────────────────────────────────
test('★★leg46·⑥：载入接纳——账上已有的档位**一次性进真源**（升级不丢档位、幂等）', async () => {
    const st = makeSt({ env: { 动乱度: '动荡', autoAdvance: '0', 天时: '大灾' } });
    const hub = await makeHub();
    const c = hub.commit(st.world);
    assert.equal(c.adopted, true, '第一次载入要接纳');
    assert.deepEqual(c.env, { 动乱度: '动荡', autoAdvance: '0', 天时: '大灾' }, '账上那三个键进真源');
    assert.deepEqual(st.store(), { 动乱度: '动荡', autoAdvance: '0', 天时: '大灾' }, '★落进主路');
    const again = hub.commit(c.world);
    assert.equal(again.adopted, false, '★幂等：第二次载入不再"接纳"（否则每次打开面板都白写一次）');
});

test('★leg46·⑥b：载入接纳**只动这个世界的桶**', async () => {
    const st = makeSt({ worldName: '世界甲' });
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    const w2 = st.switchWorld('世界乙', { 张力推手: '紧绷' });
    hub.commit(w2);
    assert.deepEqual(st.rawStore().worlds['世界甲'], { 天时: '大灾' }, '甲世界那一桶原样');
    assert.deepEqual(st.rawStore().worlds['世界乙'], { 张力推手: '紧绷' }, '乙世界接纳自己的键');
});

// ── ⑦ 撤销 ────────────────────────────────────────────────────────────────
test('★★leg46·⑦：撤销退的是**玩家的档位**（真源+镜像一起回退），步数如实', async () => {
    const st = makeSt();
    const hub = await makeHub();
    // ★每一步都把 hub 返回的世界**落进聊天账**（生产里是接线层的 `writeHotMeta`），
    //   之后一律用 `st.liveWorld()` 拿"当下的世界"（不许抓旧引用——leg41 为这件事假红过）
    const r1 = hub.set(st.liveWorld(), '天时', '大灾');
    st.apply(r1.mirror.world);
    const r2 = hub.set(st.liveWorld(), '张力推手', '紧绷');
    st.apply(r2.mirror.world);
    assert.equal(hub.undoState().count, 2, '两次改动 = 两步撤销');
    const u = hub.undo(st.liveWorld());
    st.apply(u.world);
    assert.equal(u.ok, true, '撤销成功');
    assert.deepEqual(st.store(), { 天时: '大灾' }, '★退回上一步（张力推手没了）——旧版这里是空操作/或干脆清空真源');
    assert.deepEqual(st.mirror(), { 天时: '大灾' }, '镜像同步回退');
    assert.equal(hub.undoState().count, 1);
    const u2 = hub.undo(st.liveWorld());
    st.apply(u2.world);
    assert.equal(u2.ok, true);
    assert.deepEqual(st.store(), {}, '再退一步 ⇒ 回到最初（一个字都没有）');
    assert.equal(hub.undoState().canUndo, false, '退光了就没了');
    assert.equal(hub.undo(st.liveWorld()).ok, false, '★没得退时如实拒绝（不许假装成功）');
});

test('★leg46·⑦b：撤销**不许跨世界**（另一个世界的改动不能在这个世界里撤销）', async () => {
    const st = makeSt({ worldName: '世界甲' });
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    const w2 = st.switchWorld('世界乙');
    const u = hub.undo(w2);
    assert.equal(u.ok, false, '★跨世界的撤销必须拒绝（否则会把甲的档位写进乙的桶）');
    assert.deepEqual(st.rawStore().worlds['世界甲'], { 天时: '大灾' }, '甲那一桶一个字节没动');
    assert.equal(st.rawStore().worlds['世界乙'], undefined, '也不许凭空造出乙的桶');
});

// ── ⑧ 空值三态 + 非法值 ───────────────────────────────────────────────────
// ★★★leg48 改口径（用户实机状态条的原话就是判据）：
//   用户点了下拉，提交上来的是**空值**，而旧实现把它当"清空命令"⇒ **把他的档位删了**，
//   状态条还报「每轮递几条线 → 未定（已存进本地存储 · 已同步给引擎 · 撤销可回退）」——
//   而那一刻 `writeBucket` 一次都没跑（自检里 `写入次数 = 0`、`updatedAt = null` 就是这个形状）。
//   ⇒ 定稿：**"空值"与"清空"分成两条通道**：
//     · `set(world,key,'')` = 手滑/滚轮/重复事件 ⇒ **一个字都不动**，也不许说"已存进本地存储"；
//     · `clear(world,key)`  = 玩家明确选「未定」（接线层判定）⇒ 才是清空。
test('★★★leg48·⑧：**空值不再删档位**（手滑到空 ≠ 明确清空）；真清空走显式的 `clear()`', async () => {
    const st = makeSt();
    const hub = await makeHub();
    // ① 本来就是未定：空值 ⇒ 什么都没写（★不许报"已存进本地存储"——用户实机抓到的正是这一句）
    const a = hub.set(st.world, '天时', '');
    assert.equal(a.kind, 'noop-empty');
    assert.deepEqual(st.store(), {}, '★真源一个字都没写');
    assert.match(a.humanLine, /本来就是「未定」/);
    assert.match(a.humanLine, /没有写任何东西/, '★必须说清"什么都没写"（旧版这里报的是"已存进本地存储"）');
    assert.equal(a.store.stored, null, '★★`stored` 说的是"这一笔写到哪了"⇒ 没写就必须是 null');
    // ② 已经有值：空值 ⇒ **档位原样留着**（旧实现会把它删掉 = 用户报的"改了就回默认"）
    const b = hub.set(st.world, '天时', '大灾');
    assert.equal(b.kind, 'ok');
    st.apply(b.mirror.world);                                  // ★接线层的那一句（web/index.js 的 writeHotMeta）
    const c = hub.set(st.liveWorld(), '天时', '');              // 手滑到空（滚轮/重画/重复事件）
    assert.equal(c.kind, 'noop-empty', '★空值不算清空');
    assert.deepEqual(st.store(), { 天时: '大灾' }, '★★玩家的档位必须原样留着（这一格是这条 bug 的心脏）');
    assert.equal(st.mirror()['天时'], '大灾', '★镜像也不许被清掉');
    assert.match(c.humanLine, /空值不算改档位/);
    assert.equal(hub.undoState().count, 1, '★空值那一下不许入撤销栈（它没改任何东西）');
    // ③ 明确清空：走 `clear()` ⇒ 真删 + 记墓碑 + 镜像同步删 + 可撤销
    const d = hub.clear(st.liveWorld(), '天时');
    assert.equal(d.kind, 'ok');
    assert.deepEqual(st.store(), {}, '★明确清空要认（玩家就是想清掉）');
    st.apply(d.mirror.world);                       // ★接线层那一步（writeHotMeta）
    assert.ok(!('天时' in st.mirror()), '镜像也跟着清掉（引擎不许还按旧档跑）');
    assert.match(d.humanLine, /已清空/);
    assert.equal(hub.undoState().count, 2, '★清空是实质改动 ⇒ 入撤销栈');
    // ④ 清一个本来就是未定的键：不许说"已存进本地存储"
    const e = hub.clear(st.liveWorld(), '张力推手');
    assert.equal(e.kind, 'noop-empty');
    assert.equal(e.store.stored, null);
    assert.match(e.humanLine, /没有写任何东西/);
});

test('★leg46·⑧b：非法档位 ⇒ 拒绝、**不动真源**、不入撤销栈', async () => {
    const st = makeSt();
    const hub = await makeHub();
    const r = hub.set(st.world, '天时', '春和景明');
    assert.equal(r.ok, false);
    assert.match(r.humanLine, /不是「天时」的可选档位/);
    assert.deepEqual(st.store(), {}, '真源没被写脏');
    assert.equal(hub.undoState().count, 0, '拒绝的那一下不入撤销栈');
});

test('★leg46·⑧c：值没变 ⇒ 不写盘、不入栈，但**必须出声**（"点了没反应"是原始抱怨）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    const n = st.calls.saveSettings;
    const r = hub.set(st.chatMetadata.story_world_v2.world, '天时', '大灾');
    assert.equal(r.kind, 'unchanged');
    assert.match(r.humanLine, /本来就是它/);
    assert.equal(st.calls.saveSettings, n, '★值没变 ⇒ 不白写一次配置');
    assert.equal(hub.undoState().count, 1, '★"无变化"不许入撤销栈');
});

test('★leg46·⑧d：非法值/未知键**绝不被当成清空**（三态分明——这是前六轮丢掉玩家档位的真因）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.set(st.world, '天时', '大灾');
    const before = st.store();
    hub.set(st.chatMetadata.story_world_v2.world, '每轮事件', '999');      // 不在档位表里
    hub.set(st.chatMetadata.story_world_v2.world, '不存在的键', 'x');
    assert.deepEqual(st.store(), before, '★两次非法提交之后，玩家的档位原样还在');
});

// ── ⑪ 自检面（用户令「老问题没解决，还是会回归默认」之后加的那一枚）────────────────
test('★★★leg46·⑪：自检读数**一次拿全**（键名 · 原文 · 能不能写 · 世界名/桶键 · 真源 · 引擎镜像）', async () => {
    const st = makeSt({ env: { 动乱度: '动荡' } });
    sw2ResetFlushState();
    // ★先走一次"载入接纳"（真机上打开面板就会走：`loadWorld` → `hub.commit`）——
    //   否则"账上已有的那批"进不了真源（**判定只归 `commit` 管**，`set-param` 不管接纳）。
    //   判据自己踩过一次：直接 `set-param` 就断言"账上那批也在真源里" ⇒ 假红。
    const { createParamHub } = await import('../src/param-hub.js');
    const hub = createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => {},
    });
    st.apply(hub.commit(st.liveWorld()).world);
    // ★判据自己踩过一次（留档）：`主路原文` 在**没写过**时就是 `null`（不是 ''），
    //   所以"原样带出来"这条必须在**写过之后**判（第一版在写之前判 ⇒ 假红）。
    assert.equal(typeof mod.gatherParamEvidence()['主路原文'], 'string', '接纳之后就已有这一格');
    await globalThis.window.__sw2Actions['set-param']({ param: '天时', value: '大灾' });
    const ev = mod.gatherParamEvidence();
    // ① 主路：键名 + 原文 + 有没有这一格（"写没落下去 / 被清了"就在这里现形）
    assert.equal(ev['主路键名'], 'sw2_params_v1', '★键名必须报出来（换 origin / 改名都会在这里现形）');
    assert.equal(typeof ev['主路原文'], 'string', '主路原文要原样带出来');
    assert.match(ev['主路原文'], /大荒z/, '★原文里要看得到**这个世界那一桶**');
    assert.equal(ev['主路有没有这一格'], true, '写过之后这一格必须在');
    // ② 能不能写：自检自己试一次（写完即删，不碰参数那份）
    assert.equal(ev['主路能写'], true, '正常环境要报"能写"');
    assert.equal(globalThis.window.localStorage.getItem('__sw2_probe__'), null, '★探针键必须删掉（不留垃圾）');
    // ③ 世界名与桶键（读与写同一把尺子）
    assert.equal(ev['世界名'], '大荒z');
    assert.equal(ev['桶键'], '大荒z');
    assert.equal(ev['世界名与桶键一致'], true);
    // ④ 真源 / 引擎镜像 / 不一致的键
    assert.deepEqual(ev['真源'], { 动乱度: '动荡', 天时: '大灾' }, '真源 = 账上接纳那批 ⊕ 刚写的那一个');
    assert.deepEqual(ev['账上镜像'], { 动乱度: '动荡', 天时: '大灾' }, '引擎镜像必须跟上');
    assert.deepEqual(ev['真源与镜像不一致的键'], [], '一致');
    // ⑤ 可粘贴的文本（玩家复制给维护者的就是这一段）
    const text = mod.paramEvidenceText(ev);
    assert.match(text, /\[story-world-v2 参数自检\]/);
    assert.match(text, /主路键名 = sw2_params_v1/);
    assert.match(text, /世界名 = 大荒z/);
    assert.equal(text.split('\n')[0], '[story-world-v2 参数自检]', '★第一行是抬头（粘出来就知道是什么）');
    // ⑥ 构建号也在读数里（"页面是不是新代码"是第一件要分清的事）
    //   ★leg50：形状从 `/^leg4\d/` 放宽到 `/^leg\d+/`——原来那条把"升位链条"钉死在 4x 上，
    //     换到 leg50 就红（而它要说的只是"这是一串构建号"，不是"必须是第 4x 棒"）。
    assert.equal(typeof ev['构建号'], 'string');
    assert.match(ev['构建号'], /^leg\d+-/, `构建号形状不对：${ev['构建号']}`);
    void st;
});

test('★★leg46·⑪b：自检**抓得住"写不进去"**（隐私模式/配额 ⇒ 当场报出来，不是等玩家发现丢档）', async () => {
    makeSt();
    globalThis.window.localStorage = {
        getItem: () => { throw new Error('存储被禁用'); },
        setItem: () => { throw new Error('存储被禁用'); },
        removeItem: () => {},
    };
    const ev = mod.gatherParamEvidence();
    assert.equal(ev['主路能写'], false, '★写不进去必须如实报 false（这条是"刷新就没了"的第一嫌疑人）');
    assert.match(String(ev['主路写失败原因']), /存储被禁用/, '并带上原因');
});

test('★★★leg48·⑪c（口径反转）：**参数页上不许再出现自检读数**（用户令「不要在参数界面出现」）', async () => {
    // 沿革（留档，免得下一任又把它请回来）：
    //   leg46 续把取证摆上参数页（读数 + 「🔍 复制自检」按钮），理由是"玩家不开控制台"；
    //   而 leg48 修这条症状时，**第一步正是靠用户贴来的那份自检读数**（`写入次数 = 0` 那一格）。
    //   ⇒ 用户拍板：**这一页是"玩家调档位的地方"，不是维护者的仪表盘**——读数一个字节都不印。
    //     取证能力改为**内部保留**（`gatherParamEvidence()` / `bus['param-doctor']`），界面不许出现。
    makeSt();
    const { renderParamsHtml } = await import('../src/render.js');
    const html = renderParamsHtml(st_liveWorld(), { config: { paramEnv: {}, paramDiag: mod.gatherParamEvidence() } });
    assert.ok(!/自检/.test(html), '★参数页上不许出现「自检」卡（哪怕读数传来也不画）');
    assert.ok(!/data-action="param-doctor"/.test(html), '★参数页上不许有「复制自检」按钮');
    assert.ok(!/引擎镜像|账上镜像|写入留痕|主路键名/.test(html), '★读数格（引擎镜像/写入留痕/主路键名）一个都不许印在这一页上');
    // ★但**取证能力**必须还在（要取证时从控制台/内部动作取；防"删界面顺手把能力也删了"）
    const { gatherParamEvidence, paramEvidenceText } = mod;
    assert.equal(typeof gatherParamEvidence, 'function', '★取证函数必须保留（它修这条 bug 时是第一步）');
    assert.match(paramEvidenceText(gatherParamEvidence()), /参数自检/, '★取证文本仍能产出一份可粘贴的读数');
});

test('★★leg46·⑪d：复制自检按钮**有真实处理器**（画了不接 = 死代码，本仓判据一贯要求）', async () => {
    makeSt();
    assert.equal(typeof globalThis.window.__sw2Actions['param-doctor'], 'function', '★按钮必须接到真动作');
    statusEl.textContent = '';
    await globalThis.window.__sw2Actions['param-doctor']();
    assert.match(statusEl.textContent, /参数自检/, '★按一下必须当场出声（并把读数打进控制台/剪贴板）');
});

test('★★leg46·⑪e：**参数页上画出来的每个按钮都有人接**（画了不接 = 死代码，本仓一贯判据）', async () => {
    makeSt();
    const { renderParamsHtml } = await import('../src/render.js');
    const html = renderParamsHtml(st_liveWorld(), { config: { paramEnv: {}, paramDiag: mod.gatherParamEvidence() } });
    const actions = [...new Set([...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]))];
    assert.ok(actions.length >= 3, `参数页上应当有若干动作（实测 ${JSON.stringify(actions)}）`);
    // ★`advance-world` 是**有意的例外**：它不走动作总线，走 `dispatchAction` 里的特判
    //   （`sw2TickQueue.advance()`，K36 手动补推那条路）；`lookup-batch.test.js` 里已有同类白名单
    //   （它出现的历史原因正在 leg40b 那条"面板还没装配完"的兜底文案上）。⇒ 这里同样放行，但**只放行它一个**。
    const NON_BUS = new Set(['advance-world']);
    const bus = globalThis.window.__sw2Actions;
    for (const a of actions) {
        if (NON_BUS.has(a)) continue;
        assert.equal(typeof bus[a], 'function', `★「${a}」按钮画在了参数页上，但没有真实处理器（玩家按下去不会有任何反应）`);
    }
    assert.ok(actions.includes('param-undo'), '★撤销按钮必须在参数页上');
    // ★★★leg48：`param-doctor`（自检按钮）**已按用户令从这一页撤掉** ⇒ 不再要求它出现在页面上；
    //   但它的处理器仍必须留着（取证能力内部保留）——防"删界面顺手把能力也删了"。
    assert.ok(!actions.includes('param-doctor'), '★参数页上不该再有自检按钮（用户令「不要在参数界面出现」）');
    assert.equal(typeof bus['param-doctor'], 'function', '★但取证动作本身必须还在（内部保留）');
});

function st_liveWorld() { return globalThis.window.SillyTavern.getContext().chatMetadata.story_world_v2.world; }

// ── ⑫ 「清除演化层」不许吃掉参数（本轮查出来的真缺陷）────────────────────────
test('★★leg46·⑫：**清演化层之后，引擎镜像里玩家档位一个不少**（旧版会清成空表却报"参数档位保留"）', async () => {
    const st = makeSt();
    sw2ResetFlushState();
    await globalThis.window.__sw2Actions['set-param']({ param: '天时', value: '大灾' });
    await globalThis.window.__sw2Actions['set-param']({ param: '每轮事件', value: '12' });
    assert.deepEqual(st.mirror(), { 天时: '大灾', 每轮事件: '12' }, '前置：镜像里有玩家档位');
    // 病灶：`resetDynamicLayer()` 的结构里 `env: {}` ⇒ 引擎读档位那一格被清空
    const { resetDynamicLayer } = await import('../src/abstract.js');
    const cleared = resetDynamicLayer(st.liveWorld().context.setting);
    assert.deepEqual(cleared.dynamic.env, {}, '★这就是病灶本身（如实记下：清演化层会清 env）');
    // 定稿：清完必须把**玩家档位**镜像补回去 ⇒ 引擎读到的还是玩家那两档
    await globalThis.window.__sw2Actions['reset-dynamic']();
    assert.deepEqual(st.mirror(), { 天时: '大灾', 每轮事件: '12' }, '★清演化层**不许**把玩家的档位从引擎眼里抹掉');
    assert.deepEqual(st.store(), { 天时: '大灾', 每轮事件: '12' }, '★真源一个字没少');
});

test('★leg46·⑫b：清演化层**只回填玩家输入**，不把"世界的结果"也搬回去（因变量该被清掉）', async () => {
    // ★口径（探针当场问出来的一个真问题）：`动乱度`/`民生度` 是**因变量**（世界的结果），
    //   "清除演化层"清的正是引擎自己算的那一层 ⇒ 它**应当**被清掉、由世界重新长出来；
    //   而 `天时`（玩家输入）必须原样保留。旧版把两者一起清空 ⇒ 玩家的档位也一起没了。
    const st = makeSt({ env: { 动乱度: '动荡' } });
    sw2ResetFlushState();
    const { createParamHub } = await import('../src/param-hub.js');
    const hub = createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => {},
    });
    st.apply(hub.commit(st.liveWorld()).world);          // 载入接纳（动乱度进真源 + 镜像）
    await globalThis.window.__sw2Actions['set-param']({ param: '天时', value: '大灾' });
    assert.equal(st.mirror()['动乱度'], '动荡', '前置：镜像里有世界的那个结果');
    await globalThis.window.__sw2Actions['reset-dynamic']();
    assert.equal(st.mirror()['天时'], '大灾', '★玩家输入保留');
    assert.ok(!('动乱度' in st.mirror()), '★世界的结果被清掉（它会由世界重新长出来）——这正是这一枚按钮该干的事');
});

// ── ⑬ ★★★外部干扰（用户点破的那条线：「有没有可能是其他插件造成的」）────────────
//   背景（v1 的先例）：v1 时代被大纲系统插件干扰过、查不出 bug ⇒ 这个生态里**确实有别的代码在动同一份数据**。
//   机理（不需要猜是哪个插件）：别的插件/另一个页面实例把**它自己那份旧快照**整份写回
//   （聊天的 `chat_metadata` 或存储），我们读到的就是"页面载入那一刻"的旧值 ⇒
//   而**载入接纳是绝对写**（写它拿到的那份 env）⇒ 会把玩家新写的档位一起删掉。
//   这两条判据锁的就是"外部怎么写，玩家的档位都不许丢；而且**要当场说出是被外部改的**"。
test('★★★leg46·⑬：**别的插件把存储整份写回旧快照** ⇒ (a) 玩家档位不许被删 (b) 当场出声点名', async () => {
    const st = makeSt({ env: { 动乱度: '动荡', autoAdvance: '0' } });
    sw2ResetFlushState();
    const { createParamHub } = await import('../src/param-hub.js');
    const hub = createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => {},
    });
    st.apply(hub.commit(st.liveWorld()).world);              // 载入接纳（账上那两个旧键）
    await globalThis.window.__sw2Actions['set-param']({ param: '每轮递线', value: '9' });
    assert.equal(st.store()['每轮递线'], '9', '前置：玩家改的那一档进了真源');

    // ★模拟外部干扰：把它自己那份**旧快照**整份写回同一个键（这正是"被别的插件干扰"的形状）
    const stale = JSON.stringify({ version: 1, worlds: { 大荒z: { 动乱度: '动荡', autoAdvance: '0' } } });
    globalThis.window.localStorage.setItem('sw2_params_v1', stale);
    assert.equal(st.store()['每轮递线'], undefined, '前置：外部那一笔确实把玩家档位抹掉了（重现了症状形状）');

    // (b) 下一次操作必须**当场出声**（并在审计里留痕 + 带调用栈）
    const logs = [];
    const realInfo = console.info;
    console.info = (...a) => { logs.push(a.map(String).join(' ')); };
    try {
        await globalThis.window.__sw2Actions['set-param']({ param: '每轮事件', value: '12' });
    } finally { console.info = realInfo; }
    const warned = logs.some((l) => l.includes('不见了') || l.includes('键变少了'));
    assert.ok(warned, `★必须留下一句"我写过的键不见了"（含调用栈）——八轮里缺的就是这一行；实际日志：${JSON.stringify(logs.filter((l) => l.includes('story-world-v2')).slice(-4))}`);
    const ev = mod.gatherParamEvidence();
    assert.ok(ev['写入次数'] >= 2, '审计要有留痕');
    assert.ok((ev['写入审计'] || []).some((l) => l.includes('丢')), '审计里要看得到"丢了谁"');
});

test('★★leg46·⑬b：**"玩家删掉的键"有墓碑（且落盘）** ⇒ 旧快照再也不能把它"接纳"回来', async () => {
    // 机理：接纳是绝对写 ⇒ 没有墓碑时，"玩家清空过的档位"会被旧账/旧快照一次次填回来（清空失效）；
    //   反过来，旧快照里**本来就没有**玩家新写的键 ⇒ 旧快照一写回，那些键就被删掉了（＝症状的形状）。
    //   ⇒ 墓碑管的是"删"这件事的记忆，而且**必须落盘**：要挡的那一刻正是"下一次载入"（Ctrl+F5 之后）。
    const st = makeSt({ env: { 天时: '大灾' } });
    sw2ResetFlushState();
    const { createParamHub } = await import('../src/param-hub.js');
    const mk = () => createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => {},
    });
    const hubA = mk();
    st.apply(hubA.commit(st.liveWorld()).world);
    const r = hubA.clear(st.liveWorld(), '天时');            // 玩家明确清空（★leg48：走显式通道）
    assert.equal(r.ok, true, '前置：清空写成功');
    assert.deepEqual(st.store(), {}, '前置：清空生效');
    // ★墓碑要真的在盘上（否则 Ctrl+F5 之后它就没了，而"被填回来"恰恰发生在下一次载入）。
    //   ★★leg46 续·三：墓碑**住它自己那个键**（`sw2_params_v1-deleted`），**不许夹带在参数桶里**——
    //     夹带就意味着"写墓碑要顺带重写整份参数桶"，而那一笔读到旧快照时会**吃掉玩家刚写进去的键**
    //     （用户实机审计抓出来的真缺陷：写成功→38ms 后 `⚠丢了[每轮递线]`）。这条判据把两者钉开。
    const deletedKey = JSON.parse(globalThis.window.localStorage.getItem('sw2_params_v1-deleted') || 'null');
    assert.deepEqual(deletedKey?.['大荒z'], ['天时'], '★"玩家删过 天时"这件事必须落盘（在它自己那个键里）');
    const rawBucket = JSON.parse(globalThis.window.localStorage.getItem('sw2_params_v1'));
    assert.equal(rawBucket.deleted, undefined, '★★参数桶里**不许**夹带 deleted（夹带＝写墓碑会重写桶＝吃掉玩家档位）');

    // 外部（别的插件 / 另一个页面实例）把旧快照整份写回：天时 又冒出来了
    globalThis.window.localStorage.setItem('sw2_params_v1', JSON.stringify({ version: 1, worlds: { 大荒z: { 天时: '大灾' } } }));

    // ★★关键：**换一个全新的 hub**（＝Ctrl+F5 之后那条路，内存里什么都没有，只能靠盘上的墓碑）
    const hubB = mk();
    const c = hubB.commit(st.liveWorld());
    assert.ok(!('天时' in c.env), '★玩家删过的键不许被"接纳"回来（墓碑优先 —— 哪怕换了页面）');
    assert.ok((c.blockedResurrect || []).includes('天时'), '★而且要如实报出"挡住了哪个旧值回填"');
    assert.deepEqual(st.store(), {}, '★真源里也不许出现它');
});

test('★★★leg46·⑬c（**用户实机审计抓出来的真缺陷**）：**除了玩家自己那一下，任何代码都不许删掉真源里的键**', async () => {
    // 病灶（用户 04:05 的审计，逐字留档）：
    //   `04:05:45.884 写后[autoAdvance|动乱度|每轮递线]`      ← 玩家选 9，**写成功**
    //   `04:05:45.922 写后[autoAdvance|动乱度] ⚠丢了[每轮递线]` ← 38 毫秒后，**同一笔操作里**被抹掉
    // 真因（是我上一版自己造的）：`persistTombstones()` 除了写自己的键，还**顺手把参数桶整份重写**了一遍
    //   （`{...base, deleted}`）⇒ 那一笔只要读到"还没有刚写进去那个键"的 base，就把那一格吃掉。
    //   ★配套的第二半：`begin()` 里"墓碑优先删键"会让玩家刚写的键在**下一次读**时**凭空消失**（before 归 null）。
    // ⇒ 本判据锁三条（都能机械核）：
    //   ① 写墓碑**只许动它自己那个键**，参数桶一个字节都不许变；
    //   ② 正常读写那条路上，**墓碑不许影响任何键**（玩家写过的键必须在）；
    //   ③ 全程只有"玩家清空"那一下会让键消失。
    const st = makeSt({ env: { 动乱度: '动荡' } });
    sw2ResetFlushState();
    const { createParamHub } = await import('../src/param-hub.js');
    const hub = createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => {},
    });
    st.apply(hub.commit(st.liveWorld()).world);
    const ls = globalThis.window.localStorage;
    const watch = [];                       // 记下每一次对**参数那个键**的写入（内容摘要）
    const realSet = ls.setItem.bind(ls);
    ls.setItem = (k, v) => {
        if (k === 'sw2_params_v1') {
            let keys = '(坏形)';
            try { keys = Object.keys(JSON.parse(v).worlds?.['大荒z'] || {}).join('|'); } catch (_) {}
            watch.push(keys);
        }
        return realSet(k, v);
    };
    try {
        // ★每一步都把 hub 返回的世界落进聊天账（生产里是接线层的 `writeHotMeta`），再拿当下那份继续
        //   ——判据自己踩过一次：不落账就接着用旧引用 ⇒ 镜像"看不见"（假红）。
        const step = (v) => { const r = hub.set(st.liveWorld(), '每轮递线', v); st.apply(r.mirror.world); return r; };
        step('9');            // 玩家给值
        step('');             // 玩家清空（★只有这一下会删键）
        step('9');            // 再给值
        step('6');            // 再改
    } finally { ls.setItem = realSet; }
    // ① 参数桶的写入序列：只该出现"玩家意图"的内容（增键 / 清空 / 再增 / 改），不该出现"被墓碑吃掉的中间态"
    const lostByOthers = watch.filter((keys, i) => i > 0 && watch[i - 1] && keys
        && watch[i - 1].split('|').filter((k) => k && !keys.split('|').includes(k) && k !== '每轮递线').length);
    assert.deepEqual(lostByOthers, [], `★除了玩家清空那一下，任何写入都不许把别的键弄丢；实际序列：${JSON.stringify(watch)}`);
    // ② 最终态：玩家最后给的那个值必须在（＋账上原有两个键）
    assert.deepEqual(st.store(), { 动乱度: '动荡', 每轮递线: '6' }, '★玩家写过的键必须都在，值是他最后选的那个');
    assert.equal(st.mirror()['每轮递线'], '6', '★镜像里也要在（引擎读它跑）');
    // ③ 清空过又给回来的键，**墓碑不许留着**（留着就会在别的路上把它再吃掉）
    const del = JSON.parse(ls.getItem('sw2_params_v1-deleted') || '{}');
    assert.ok(!(del['大荒z'] || []).includes('每轮递线'), `★玩家又给了值 ⇒ 墓碑必须销掉；实际：${JSON.stringify(del)}`);
});

test('★★★leg46·⑬d：**抢回** —— 外部把玩家写过的档位抹掉 ⇒ 下一次读就按原值写回（画面/引擎都回到他选的那档）', async () => {
    // 为什么必须有这一条（用户实机两张图逼出来的）：
    //   审计显示"写成功 → 38ms 后被抹掉"，而截图显示**失焦重画时画面回到 3**（＝存储里没有那一格）。
    //   ⇒ 有**第二个东西**在跟这一格来回抢（另一个页面实例 / 另一个副本 / 别的插件整份写回）。
    //   八轮里我们的做法一直只是"检测并上报"，而**上报救不了玩家** ⇒ 现在改成**抢回**（一次，不循环）。
    const st = makeSt({ env: { 动乱度: '动荡' } });
    sw2ResetFlushState();
    const { createParamHub } = await import('../src/param-hub.js');
    const hub = createParamHub({
        storage: () => globalThis.window.localStorage,
        settings: () => globalThis.window.SillyTavern.getContext().extensionSettings,
        saveSettings: () => {},
    });
    st.apply(hub.commit(st.liveWorld()).world);
    const r = hub.set(st.liveWorld(), '每轮递线', '9');
    st.apply(r.mirror.world);
    assert.equal(st.store()['每轮递线'], '9', '前置：玩家写成功');

    // ★外部（另一个上下文/另一个副本）把它整份写回"没有那一格"的样子
    globalThis.window.localStorage.setItem('sw2_params_v1', JSON.stringify({ version: 1, worlds: { 大荒z: { 动乱度: '动荡' } } }));
    assert.equal(st.store()['每轮递线'], undefined, '前置：外部确实抹掉了它（重现用户那张图的形状）');

    // 下一次"读"（面板重画 / 任何一次事务的入口）⇒ 抢回
    //   ★判据自己踩过一次：这里原来截的是 `console.info`，而 hub 的 `log` 是**注入**的
    //     （这条用例里注入给了 web 层）⇒ 截不到东西（假红）。改判**审计留痕**（那才是能带出去的证据）。
    const view = hub.displayEnv(st.liveWorld());                 // ＝失焦重画那一下读的值
    assert.equal(view['每轮递线'], '9', '★面板读到的必须还是玩家选的那档（不是出厂默认 3）');
    assert.equal(st.store()['每轮递线'], '9', '★而且盘上也要被抢回来');
    const tr = hub.writeTrace();
    assert.ok(tr.some((e) => String(e.note || '').includes('抢回')), `★抢回必须留痕（自证面/审计里要看得到）——实际：${JSON.stringify(tr.map((e) => e.note).slice(-4))}`);
    // ★抢回不许把"玩家清空过的键"也塞回来（清空是玩家的明确意图）
    //   ★leg48：清空改走显式通道 `clear()`（`set('')` 不再当清空命令）
    const r2 = hub.clear(st.liveWorld(), '每轮递线');
    st.apply(r2.mirror.world);
    globalThis.window.localStorage.setItem('sw2_params_v1', JSON.stringify({ version: 1, worlds: { 大荒z: { 动乱度: '动荡', 每轮递线: '9' } } }));
    const v2 = hub.displayEnv(st.liveWorld());
    // ★口径（探针当场抓出来的第二个真 bug）：玩家清空过的键，面板**既不许显示那个旧值、也不许显示出厂默认**，
    //   而要显示「未定」——否则"我清成未定"会当场变成 3，而那正是用户八轮里报的那句话（"改了就回默认"）。
    assert.ok(!v2['每轮递线'], `★玩家清空过的键必须显示为「未定」（空），不许显示 9、也不许显示出厂默认 3；实际：${JSON.stringify(v2['每轮递线'])}`);
    assert.notEqual(String(v2['每轮递线']), '3', '★尤其不许显示成出厂默认 3');
});

test('★★★leg46·⑭（**用户实机「点一次空白写两次、第二笔把 9 覆盖回 3」的根治**）：改参数**只就地改显示格**，绝不重画参数页', async () => {
    // 真形状（用户审计五组"写成功 → 40ms 后丢掉"）：旧法 `refreshSections(['params', ...])` 会
    //   **整块 innerHTML 重画参数页** ⇒ 把玩家手底下的 `<select>` 销毁重建 ⇒ 浏览器对**新节点**再吐
    //   一笔带**旧值**的事件 ⇒ 第二笔把第一笔覆盖回默认。
    // ⇒ 三条判据：①只改文字、不碰结构；②绝不碰控件；③接线层不许再重画参数页。
    // ★★leg46 续·十升级（用户第五次实机「我改了值旁边直接变成未定」）：格的字**只从同一行的控件读**——
    //   判据从"按 `r.env` 写"改成"**控件是 12，格就必须是 12**"（那才是这类错位的根治）。
    const st = makeSt({ env: { 动乱度: '动荡' } });
    sw2ResetFlushState();
    const mkCtl = (k, v) => ({ tagName: 'SELECT', value: v, classList: { contains: () => false }, getAttribute: (n) => (n === 'data-param' ? k : null) });
    const cell = (k) => ({ tagName: 'B', textContent: '（旧）', children: [], changed: 0, getAttribute(n) { return n === 'data-param-cell' ? k : null; }, set textContent(v) { this._t = v; this.changed += 1; }, get textContent() { return this._t; } });
    const c1 = cell('天时'); const c2 = cell('每轮递线');
    const sels = [mkCtl('天时', '大灾'), mkCtl('每轮递线', '9'), mkCtl('每轮事件', '12')];
    const undoBtn = { disabled: true };
    const win = {
        querySelectorAll: (sel) => (sel === '[data-param-cell]' ? [c1, c2] : (sel === '[data-action="set-param"][data-param]' ? sels : [])),
        querySelector: (sel) => (sel === '[data-action="param-undo"]' ? undoBtn : sels.find((s) => sel.includes(s.getAttribute('data-param'))) || null),
    };
    const realGet = globalThis.document.getElementById;
    globalThis.document.getElementById = (id) => (id === 'story_world2_window' ? win : (id === 'sw2_status_text' ? { textContent: '' } : null));
    try {
        // ① 格必须跟着**控件**（不是跟着真源/注入的那份）
        mod.sw2SetParamCell('天时');
        assert.equal(c1.textContent, '大灾', '★控件是"大灾" ⇒ 格就必须写"大灾"（读自同一行的控件）');
        mod.sw2SetParamCell('每轮递线');
        assert.equal(c2.textContent, '9', '★控件是 9 ⇒ 格必须是 9（不许写「未定」，不许写"3默认"）');
        // ② 控件一个字节都不许动
        assert.equal(sels[0].value, '大灾', '★★控件**一个字节都不许动**（它是玩家的手）');
        assert.equal(sels[1].value, '9', '★同上');
        // ③ 找不到控件的键 ⇒ 格一个字都不动（退让，不自己编值）
        const before = c1.changed;
        mod.sw2SetParamCell('顶层大计');            // 页面上没有它的控件
        assert.equal(c1.changed, before, '★找不到控件时不许动任何格（绝不自己猜一个值出来）');
    } finally { globalThis.document.getElementById = realGet; }
    // ④ 接线层不许再重画参数页（源码级）
    const src = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const seg = src.slice(src.indexOf("bus['set-param']"), src.indexOf("bus['param-undo']"));
    const codeOnly = seg.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/refreshSections\(\s*\[\s*'params'/.test(codeOnly), '★set-param 里不许再整块重画参数页');
    assert.match(codeOnly, /sw2SyncParamCells\(\)/, '★必须改走"按控件对齐格"（`sw2SyncParamCells`）');
    void st;
});

test('★★★leg46·⑮（**用户第四次实机：「下拉是 9/12/30/40，四格却写 3默认/6默认/15默认/20默认」**）：控件是事实——画面不许与玩家的选择矛盾', async () => {
    // 那一屏的机理：渲染参数页那一刻 `paramEnv` 里没有那四个键（读不到/没落成），渲染层就按"出厂默认"画格，
    //   而**控件上还留着玩家选的值** ⇒ 玩家看到"我选的 vs 面板说的"自相矛盾，观感＝"改了没生效"。
    // ⇒ 定稿：渲染整页之前先**采集页面上现存控件的值**当最高优先级覆盖；两者不一致要**记审计**（不许静默）。
    const st = makeSt({ env: { 动乱度: '动荡' } });
    sw2ResetFlushState();
    // 假 DOM：四个上限控件上都有玩家选的值，而真源里**一个都没有**（＝那一屏的形状）
    const mkSel = (k, v) => ({ tagName: 'SELECT', value: v, classList: { contains: () => false }, getAttribute: (n) => (n === 'data-param' ? k : (n === 'data-value' ? null : null)) });
    const sels = [mkSel('每轮递线', '9'), mkSel('每轮事件', '12'), mkSel('顶层大计', '30'), mkSel('在飞大计', '40')];
    const win = { querySelectorAll: (sel) => (sel === '[data-action="set-param"][data-param]' ? sels : []), querySelector: () => null };
    const realGet = globalThis.document.getElementById;
    globalThis.document.getElementById = (id) => (id === 'story_world2_window' ? win : (id === 'sw2_status_text' ? { textContent: '' } : null));
    let live = null;
    try { live = mod.sw2CollectLiveParamValues(); } finally { globalThis.document.getElementById = realGet; }
    assert.deepEqual(live.selects, { 每轮递线: '9', 每轮事件: '12', 顶层大计: '30', 在飞大计: '40' }, '★控件现值要采全');
    assert.equal(live.env['每轮递线'], '9', '★控件值要**覆盖**在真源之上（真源里没有它 ⇒ 不许显示成出厂默认 3）');
    assert.equal(live.env['每轮事件'], '12', '★同上');
    // ★反例：控件是空串（玩家清成未定）⇒ **不许**覆盖（让真源/默认照旧说话，"未定"要显示得出来）
    const emptySel = { tagName: 'SELECT', value: '', classList: { contains: () => false }, getAttribute: () => '天时' };
    const win2 = { querySelectorAll: (sel) => (sel === '[data-action="set-param"][data-param]' ? [emptySel] : []), querySelector: () => null };
    globalThis.document.getElementById = (id) => (id === 'story_world2_window' ? win2 : null);
    let live2 = null;
    try { live2 = mod.sw2CollectLiveParamValues(); } finally { globalThis.document.getElementById = realGet; }
    assert.equal(live2.env, null, '★控件是空串 ⇒ 不覆盖（否则"清成未定"会被画成旧值）');
    void st;
});

test('★★★★leg46·⑯（**已作废并删除**）：~~第三个落点（服务端文件）~~ —— 那一层是**我没验证过接口形状就写的**，实机 `HTTP 404`，已整段撤除', async () => {
    // ★留档（别再走一遍）：用户第七次实机的自检里 `服务端文件 = {ok:false, reason:"读文件 HTTP 404"}`。
    //   我照"ST 的文件接口"写的那两个调用（`/api/files/upload` / `/api/files/retrieve`）**形状不对**
    //   （我猜的是 multipart，后来改成 JSON 也仍是 404，而**我没有 ST 本体可以核**）。
    //   ⇒ 处置：**整段撤掉**（连同 web 层那三处调用与 hub 的 `afterWrite` 注入点），只留**验证过**的机制。
    //   ★教训（写给下一任）：**没有可读取的参照物时，不要新增"与外部接口对接"的层**——
    //     它对玩家的风险是"看起来多了一层保险、实际什么都没做成"，而它的失败**只有实机能发现**。
    const src = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    for (const dead of ['SW2_PARAM_FILE', 'sw2FileRead', 'sw2FileWrite', 'sw2MergeParamFile', 'sw2StHeaders']) {
        assert.ok(!src.includes(dead), `★${dead} 是没验证过的接口那一层，不许回潮`);
    }
    const hubSrc = readFileSync(path.join(ROOT, 'src', 'param-hub.js'), 'utf8');
    assert.ok(!hubSrc.includes('afterWrite'), '★hub 的那个注入点也一并撤了（不留半成品接口）');
});

// ── ⑨ 写入口不许回潮（源码级）─────────────────────────────────────────────
test('★★★leg46·⑨：**参数只有一个写入口**——`web/index.js` 里不许再有参数存储的写语句', async () => {
    const src = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    // ★判据自己踩过一次（留档）：第一版把 `extensionSettings[...] = ...` 一律当违规，
    //   而 `readSettings()` 里那句是**模型设置**（`story_world_v2` 那一格，与参数无关）⇒ 假红。
    //   ★第二版又踩一次：把"出现过 localStorage.setItem"当违规，而自检探针（`gatherParamEvidence`）
    //     会写一个**自己的临时键**（写完即删，不碰参数那份）⇒ 假红。
    //   ⇒ 口径收紧到"**写**参数那一格"：只有这三种形状算写（读与"把键名原样报出来"不算）。
    //   ★★leg46 续·十一：多了一个**有意的例外**——`sw2WriteLocalBucketRaw()` 的函数体：载入时把**服务端文件**
    //     那份并进本地（"第三个落点"的入口；**玩家改档位那条路绝不经过它**）。
    //   ★判据自己的第三课：例外要按**函数体**放行，不能按"这一行出现过函数名"放行——
    //     那句 `setItem` 在自己的行上，行级放行漏掉了它（当场假红）。
    const bodyOf = (name) => {
        const i = src.indexOf(`function ${name}(`);
        if (i < 0) return '';
        const j = src.indexOf('\n}', i);
        return src.slice(i, j > i ? j : i + 2000);
    };
    const rawHelper = bodyOf('sw2WriteLocalBucketRaw');
    assert.ok(rawHelper, '★那个例外函数必须在（它改名字了就把本判据同步改）');
    const codeNoHelper = codeLines.filter((l) => !l.includes('PARAMS_LS_KEY') || !rawHelper.includes(l.trim()));
    const offences = codeNoHelper.filter((l) => /PARAMS_LS_KEY\s*,\s*[^)]/.test(l)                     // setItem(PARAMS_LS_KEY, ...)
        || /\[PARAMS_SETTINGS_KEY\]\s*=/.test(l)                                                       // settings[KEY] = ...
        || /\[\s*['"]story_world_v2_params['"]\s*\]\s*=/.test(l)
        || /setItem\s*\(\s*['"]sw2_params_v1['"]/.test(l));
    assert.deepEqual(offences, [], '★参数存储的写只许在 src/param-hub.js 里发生（唯一例外：并入服务端文件那个函数体）');
    // hub 必须是**唯一**装存储的地方：本文件只许"注入"，不许自己读写
    assert.match(src, /createParamHub\(/, 'hub 必须真的装起来（画了不接 = 死代码）');
    const hubSrc = readFileSync(HUB, 'utf8');
    assert.match(hubSrc, /localStorage/, '★真源读写住在 param-hub 里（它是唯一碰存储的模块）');
});

test('★leg46·⑨b：旧补丁层与旧写入口都不许回潮（七轮补丁逐个点名）', async () => {
    const src = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const forbidden = [
        'sw2PlanFlushRetry', 'SW2_FLUSH_RETRY_DELAY_MS',   // 延后重试（每 3 秒整份上盘）
        'sw2_pending_params',                              // localStorage 兜底（第三个真源）
        'sw2ParamOverlay', 'sw2NoteParamChange', 'sw2PinParamsOnLiveAccount', 'sw2WithParamOverlay',
        'sw2ParamEnv', 'sw2ParamBucket', 'sw2WriteParamBucket', 'sw2PersistParamEnv',   // 散出去的写入口
        'sw2MirrorParamsToAccount', 'sw2ManagedParamKeys', 'sw2SetManagedKeys',
        'sw2LastParamWriteOut', 'sw2MigrateLegacyPendingParams',
    ];
    const codeLines = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));
    for (const name of forbidden) {
        assert.ok(!codeLines.some((l) => l.includes(name)), `★${name} 是旧写入口/旧补丁层，不许回潮`);
    }
    assert.match(src, /hotMetaFingerprint\(\)/, '世界账自己的回读核对**保留**（它对"世界"仍然有用）');
});

test('★leg46·⑨c：判据自己的夹具只有一份（真源注入 ⇒ 两个判据文件共用 fixture-param）', async () => {
    for (const name of ['param-hub.test.js', 'set-param-persist.test.js']) {
        const src = readFileSync(path.join(ROOT, 'test', name), 'utf8');
        assert.match(src, /fixture-param\.mjs/, `★${name} 必须用公共夹具（两处各写一份 ⇒ 迟早分叉）`);
    }
});

// ＝＝ ★★★leg48：**这一条就是用户报的那条症状**（"改了档位，刷新之后回默认"）＝＝
// 真形状（用户自检读数 + 盘上真账双向印证）：**世界对象没拿到**（载入路还没跑完/失败）⇒
//   旧写入口第一句 `if (!world?.context?.setting?.dynamic) return reject(...)` ⇒
//   **真源一个字都没写**（`写入次数 = 0`、`updatedAt = null`、盘上 `dynamic.env` 只有载入期那两个旧键）。
// ⇒ 四条判据锁死新口径：**档位能不能存住，与世界对象在不在无关**。
test('★★★leg48·A：世界对象**没到**也照样存住档位（这条症状的心脏）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    // ★前置：世界**来过一次**（载入期 commit）⇒ hub 记住了"大荒z"这个名字；随后世界对象才丢的。
    //   这正是真机上的顺序：载入跑了一半/失败 ⇒ 界面还在、世界对象这个**变量**空了。
    hub.commit(st.liveWorld());
    // 玩家点下拉那一刻，世界对象是空的（＝旧代码直接 reject 的那个形状）
    const r = hub.set(null, '每轮递线', '9');
    assert.equal(r.kind, 'ok', `★不许因为"没有世界对象"就拒绝写（旧版这里是 kind=reject、一个字都没写）；实际 ${r.kind} / ${r.reason}`);
    assert.equal(r.ok, true);
    assert.equal(r.worldName, '大荒z', '★★桶键必须是"大荒z"（退回兜底名 = 写进另一个桶 = 玩家看到"我改的东西不见了"）');
    assert.deepEqual(st.store(), { 每轮递线: '9' }, '★★真源里必须真的存住了（这一格是他刷新之后能不能看到的关键）');
    assert.equal(r.mirror.pending, true, '★镜像这一格如实标"挂起"（不是失败、也不是成功）');
    assert.match(r.humanLine, /已存进本地存储/);
    assert.match(r.humanLine, /等世界载入后补/, '★状态条要说清"引擎那一步晚一点"（不许含糊成"已同步"）');
    assert.match(r.diag.世界对象, /没有/, '★自检卡必须点名"世界对象没有"（旧版这件事完全不可见）');

    // 世界后到 ⇒ 一次补齐（幂等）
    const f1 = hub.flushPending(st.liveWorld());
    assert.equal(f1.changed, true, '★补镜像必须真的动了一次');
    assert.deepEqual(f1.keys, ['每轮递线']);
    st.apply(f1.world);
    assert.deepEqual(st.mirror(), { 每轮递线: '9' }, '★★引擎那一格补上了（面板改了、引擎必须知道）');
    const f2 = hub.flushPending(st.liveWorld());
    assert.equal(f2.changed, false, '★幂等：第二次什么都不做');

    // ★世界名也拿不到（真·没有世界）⇒ 落在"未名世界"这个稳定桶（不许抛、不许丢）
    const hub2 = await makeHub();
    const r2 = hub2.set('', '天时', '大灾');
    assert.equal(r2.ok, true, '★拿不到世界名也要有个稳定的家（绝不许丢）');
    assert.equal(r2.worldName, '未名世界');
});

test('★★★leg48·B：世界对象**没到**时的撤销也照走（真源回退，不由世界决定）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.commit(st.liveWorld());
    hub.set(null, '每轮递线', '9');
    assert.deepEqual(st.store(), { 每轮递线: '9' });
    const u = hub.undo(null);
    assert.equal(u.ok, true, '★撤销不许因为"没有世界对象"被拒');
    assert.deepEqual(st.store(), {}, '★真源退回那一步之前');
    assert.equal(u.mirrorPending, true, '★镜像如实标"挂起"');
});

test('★★★leg48·C：载入期把"世界没到那一刻"写下的档位补进世界账（端到端，走真总线）', async () => {
    const st = makeSt();
    sw2ResetFlushState();
    // ① 世界账里**世界对象读不出来**（＝载入链断在半路那一刻的真形状：热账那格还在，
    //    `loadHotAccount` 却给不出对象 ⇒ 旧代码在这里 reject、一个字都没写）
    const saved = st.chatMetadata.story_world_v2;
    const nameHint = saved.world.context.world;                 // "大荒z"（旧版拿不到世界时**连名字都不传**）
    st.chatMetadata.story_world_v2 = { ...saved, world: null };
    statusEl.textContent = '';
    await globalThis.window.__sw2Actions['set-param']({ param: '每轮递线', value: '9', worldName: nameHint });
    assert.deepEqual(st.store(), { 每轮递线: '9' }, '★世界对象不在，档位也必须真的存住');
    assert.match(statusEl.textContent, /已存进本地存储/);
    // ② 世界回来 ⇒ 载入期补镜像（与 `loadWorld` 里 commit → flushPending 同一序）
    st.chatMetadata.story_world_v2 = saved;
    const hub = await makeHub();
    const f = hub.flushPending(st.liveWorld());
    st.apply(f.world);
    assert.deepEqual(st.mirror(), { 每轮递线: '9' }, '★★世界一回来，引擎那一格就补上了');
});

// ＝＝ ★★★leg48：**"写一个桶、读另一个桶"**（这条症状的最后一块拼图，真浏览器现场抓到的）＝＝
// 现场（真 Chrome + 真面板代码，`?empty=1` 模拟"世界对象读不出来"）：
//   ① 玩家选 9 ⇒ `[参数真源] 写成功（主路）`（真源里已经是 9）
//   ② 面板对齐画面 ⇒ `参数控件按真源对齐：每轮递线 → "3"`（**读到另一个桶**：探针显示 桶名=未名世界、真源={}）
//   ③ 于是画面回到 3 —— 而玩家的档位在"大荒z"那个桶里躺着，**两边都不报错**
// 机理：`loadWorld` 走空态/轮转失败时把**空态世界**交给面板（世界名 = 未名世界）
//   ⇒ 面板按那个空桶 + 出厂默认把控件写成 3（本仓"一个数两把尺子"）。
// ⇒ 口径：**面板显示值必须读"hub 真正读写过的那个桶"**（`currentWorldName()`），不读"当下那个世界对象"。
test('★★★leg48·D：**读的桶 = 写的桶**（写完后拿空态世界来读，也必须读到玩家写的那一档）', async () => {
    const st = makeSt();
    const hub = await makeHub();
    hub.commit(st.liveWorld());                       // 正常载入一次（hub 记住"大荒z"）
    hub.set(st.liveWorld(), '每轮递线', '9');
    assert.equal(hub.currentWorldName(), '大荒z', '★hub 认的桶就是写过的那个');
    // ★模拟 `loadWorld` 的空态分支：交给 hub 一个**空态世界**（世界名 = 未名世界）
    const emptyWorld = {
        version: 1, context: { world: '', tension: 0.5, positions: [] },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 0, simLog: [] },
    };
    // ① 显示值：读的是"hub 认的那个桶" ⇒ 必须还是 9
    const view = hub.displayEnv(hub.currentWorldName());
    assert.equal(view['每轮递线'], '9', '★按空态世界去读会读到出厂默认 3（那正是"改了回默认"）');
    // ② **拿空态世界来读也不许换桶**（hub 自己那一层的闸）：空态世界不参与桶名解析
    assert.equal(hub.displayEnv(emptyWorld)['每轮递线'], '9',
        '★★空态世界（世界名 = 未名世界）**不许**把读数切到另一个空桶——切过去就会读成出厂默认 3、'
        + '把玩家选的 9 从画面上盖掉（真浏览器现场抓到的形状）');
    assert.equal(hub.currentWorldName(), '大荒z', '★hub 认的桶自始至终是写过的那个');
    // ③ 接线层必须用 `currentWorldName()` 取桶（源码级，防回潮）
    const web = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    assert.match(web, /paramHub\.currentWorldName\(\)/, '★面板显示值/控件对齐必须读"hub 认的那个桶"');
});

// ── ⑩ 面板接线（真跑总线）────────────────────────────────────────────────
test('★★leg46·⑩：走真总线（面板点下拉）⇒ 状态条 = hub 的原话，真源与镜像都对', async () => {
    const st = makeSt();
    sw2ResetFlushState();
    statusEl.textContent = '';
    await globalThis.window.__sw2Actions['set-param']({ param: '天时', value: '大灾' });
    assert.deepEqual(st.store(), { 天时: '大灾' }, '★真源落定');
    assert.deepEqual(st.mirror(), { 天时: '大灾' }, '★世界账镜像落定（玩家报的读数就是这一格）');
    assert.match(statusEl.textContent, /天时 → 大灾/);
    assert.match(statusEl.textContent, /已存进本地存储/, '★状态条说的是真话');
    // 面板按真源渲染 ⇒ 刷新后还是这一档
    const d = sw2ParamDiag();
    assert.equal(d.世界名, '大荒z');
    assert.deepEqual(d.真源, { 天时: '大灾' });
    assert.deepEqual(d.账上镜像, { 天时: '大灾' });
});

test('★★leg46·⑩b：撤销按钮走真总线 ⇒ 真源与镜像一起回退', async () => {
    const st = makeSt();
    sw2ResetFlushState();
    await globalThis.window.__sw2Actions['set-param']({ param: '天时', value: '大灾' });
    const r = sw2UndoParam();
    assert.equal(r.ok, true, '撤销成功');
    assert.deepEqual(st.store(), {}, '★真源退回最初');
    assert.deepEqual(st.mirror(), {}, '★镜像也退回');
    assert.equal(sw2ParamUndoState().canUndo, false);
});

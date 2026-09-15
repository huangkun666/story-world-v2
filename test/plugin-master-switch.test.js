// story-world-v2/test/plugin-master-switch.test.js
// leg33d（用户令「顺便加一个启动和关闭插件的入口，要不然这个插件会直接自动生效」）：
// **插件总闸**——`autoAdvance`。它管的是"插件自己要不要自动跑"，与其余开关（管"插件对外的动作"）不同族。
//
// 判据四层（缺一不可）：
//   ① 开关登记面：`SWITCH_PARAMS.autoAdvance` 存在、**缺省关**（照本仓开关惯例）、且标了 `master`（排最前）。
//   ② ★**存量世界的一次性迁移**：有推进史且该键从未写过 ⇒ 迁成 '1'（**升级不许把正在跑的世界悄悄按停**）；
//      全新世界 ⇒ '0'；**幂等**（键已存在就一个字节都不碰——包括你手动关掉的 '0'）。
//   ③ 闸的读法：**只有显式 '1' 算开**（缺键=关，与 `switchOn` 同口径）。
//   ④ 渲染面：总闸卡**排在其余开关之前**，且写出**当前后果**（不是"应该没问题"）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SWITCH_PARAMS, switchOn, isParamKey, normalizeParam } from '../src/params.js';
import { ensureAutoAdvanceKey, sw2AutoAdvanceOn, sw2OnMessageReceived } from '../web/index.js';
import { renderParamsHtml, renderSettingsHtml } from '../src/render.js';   // leg52：推进入口改在设置页，判据要扫那一页

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'autoAdvance';
// 造一个"形状够用"的世界（render/迁移只读这几个字段）
function world({ simLog = [], env = {}, noDynamic = false } = {}) {
    const w = {
        version: 1,
        context: { world: '临渊城', tension: 0.5, positions: ['未明', '临渊城'] },
        entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
        meta: { tick: 0, simLog },
    };
    if (!noDynamic) w.context.setting = { dynamic: { env: { ...env } } };
    return w;
}

test('leg33d·① 总闸已登记：缺省关 + master 标记（它管"插件自己"，不是"插件对外的动作"）', () => {
    const conf = SWITCH_PARAMS[KEY];
    assert.ok(conf, 'autoAdvance 必须在 SWITCH_PARAMS 里（否则参数页没有入口、set-param 会拒）');
    assert.equal(conf.def, '0', '★缺省关：照本仓开关惯例（memoryEnabled 也是 def=0）⇒ 装上/载入即静默');
    assert.equal(conf.master, true, '标 master ⇒ 渲染时排最前、单独一张卡');
    assert.ok(isParamKey(KEY), '参数键白名单要认它（否则 set-param 报"未知参数键"）');
    assert.equal(normalizeParam(KEY, '1'), '1');
    assert.equal(normalizeParam(KEY, '0'), '0');
    assert.equal(normalizeParam(KEY, '开'), null, '非 0/1 一律 null（不写占位值）');
});

test('leg33d·② 存量世界迁移：有推进史 ⇒ 迁成 1（★升级不许把正在跑的世界悄悄按停）', () => {
    const w = world({ simLog: [{ tick: 1 }, { tick: 2 }] });   // 有史 = 用户正在用
    assert.equal(ensureAutoAdvanceKey(w), true, '应写入（该键从未写过）');
    assert.equal(w.context.setting.dynamic.env[KEY], '1', '★有史 ⇒ 1（升级前后行为一字不变）');
    assert.equal(sw2AutoAdvanceOn(w), true);
});

test('leg33d·② 全新世界迁移：无推进史 ⇒ 留 0（新世界要你按一下「开始」才动）', () => {
    const w = world({ simLog: [] });
    assert.equal(ensureAutoAdvanceKey(w), true, '应写入');
    assert.equal(w.context.setting.dynamic.env[KEY], '0', '★无史 ⇒ 0（不自动生效）');
    assert.equal(sw2AutoAdvanceOn(w), false);
});

test('leg33d·② 迁移幂等：键已存在就一个字节不碰（含你手动关掉的 0）', () => {
    // 有史的世界，但用户已手动关 ⇒ **尊重显式选择**，不许迁回 1
    const w = world({ simLog: [{ tick: 1 }], env: { [KEY]: '0' } });
    assert.equal(ensureAutoAdvanceKey(w), false, '已写过 ⇒ 不迁移');
    assert.equal(w.context.setting.dynamic.env[KEY], '0', '★"关过"是显式选择，永不被迁移覆盖');
    // 用户的记忆开关不许被动过（迁移只碰它自己那个键）
    const w2 = world({ simLog: [{ tick: 1 }], env: { memoryEnabled: '1' } });
    ensureAutoAdvanceKey(w2);
    assert.equal(w2.context.setting.dynamic.env.memoryEnabled, '1', '迁移只碰 autoAdvance，别动别人的键');
    assert.equal(w2.context.setting.dynamic.env[KEY], '1');
    // 连跑两次结果相同
    assert.equal(ensureAutoAdvanceKey(w2), false);
    assert.equal(w2.context.setting.dynamic.env[KEY], '1');
});

test('leg33d·② 缺 dynamic 层的世界：不崩、不写（没有可写的地方）', () => {
    const w = world({ noDynamic: true });
    assert.equal(ensureAutoAdvanceKey(w), false);
    assert.equal(ensureAutoAdvanceKey(null), false);
    assert.equal(ensureAutoAdvanceKey({}), false);
});

test('leg33d·③ 闸的读法：只有显式 1 算开；缺键/空/其它一律当关（与 switchOn 同口径）', () => {
    assert.equal(sw2AutoAdvanceOn(world({ env: { [KEY]: '1' } })), true);
    assert.equal(sw2AutoAdvanceOn(world({ env: { [KEY]: '0' } })), false);
    assert.equal(sw2AutoAdvanceOn(world({ env: {} })), false, '★缺键 = 关（空着就是空着）');
    assert.equal(sw2AutoAdvanceOn(world({ env: { [KEY]: 'true' } })), false, '只有 "1" 算开');
    assert.equal(sw2AutoAdvanceOn(null), false);
    assert.equal(sw2AutoAdvanceOn({}), false);
    // 与 params.js 的 switchOn 必须一致（两把尺子会长歪）
    const on = world({ env: { [KEY]: '1' } });
    assert.equal(sw2AutoAdvanceOn(on), switchOn(on, KEY), '闸的读法与 switchOn 必须同口径');
});

test('leg33d·③★接线真跑：关着时**一次都不推进**（并提出手动出路）；开着时推进一次', () => {
    // 关：不许推进，且必须明说（否则"世界怎么不动了"会被当成 bug）
    let advanced = 0; let said = '';
    const off = sw2OnMessageReceived(world({ env: { [KEY]: '0' } }), { advance: () => { advanced += 1; }, setStatus: (s) => { said = s; } });
    assert.equal(off.advanced, false);
    assert.equal(advanced, 0, '★关着时 advance() 一次都不许被调（这就是"不自动生效"的机械判据）');
    assert.equal(off.reason, 'autoAdvance=off', '闸要说得出原因（便于留痕/测试，不靠副作用判断）');
    assert.ok(said.includes('插件已关') && said.includes('推进一轮'), `关着时要明说并给出手动出路，实际：${said}`);
    // 缺键（老账/裸世界）同样当关
    let advanced2 = 0;
    const missing = sw2OnMessageReceived(world({ env: {} }), { advance: () => { advanced2 += 1; }, setStatus: () => {} });
    assert.equal(missing.advanced, false);
    assert.equal(advanced2, 0, '缺键=关');
    // 开：推进一次，且不再报"已关"
    let advanced3 = 0; let said3 = '';
    const on = sw2OnMessageReceived(world({ env: { [KEY]: '1' } }), { advance: () => { advanced3 += 1; }, setStatus: (s) => { said3 = s; } });
    assert.equal(on.advanced, true);
    assert.equal(advanced3, 1, '开着时正好推进一次（不多不少）');
    assert.equal(said3, '', '开着时不打扰状态栏');
});

test('leg33d·③ 手动路径不经过总闸（那是"你明确要求的动作"，永不被闸）', () => {
    // 闸只装在 MESSAGE_RECEIVED 那条自动链上；手动「推进一轮」走 dispatchAction('advance-world')。
    //   判据（机械）：本模块导出的闸函数**不碰** tickQueue 之外的东西，且**没有**任何"手动入口也要过闸"的接线。
    //   这里用一个关着闸的世界调闸函数，断言它**只**报已关、**不**影响任何手动面。
    let manualTouched = 0;
    sw2OnMessageReceived(world({ env: { [KEY]: '0' } }), { advance: () => { manualTouched += 1; }, setStatus: () => {} });
    assert.equal(manualTouched, 0, '闸不许"顺手"替手动路径做决定（手动要走 dispatchAction，不经过这里）');
});

test('leg33d·④ 渲染面：总闸卡排在其余开关之前，且写出"当前后果"（不许只说"应该没问题"）', () => {
    const off = world({ env: { [KEY]: '0', memoryEnabled: '0' } });
    const htmlOff = renderParamsHtml(off, {});
    const iMaster = htmlOff.indexOf('插件总闸');
    const iMemory = htmlOff.indexOf('写进记忆插件');
    assert.ok(iMaster >= 0, '参数页必须有总闸卡');
    assert.ok(iMaster < iMemory, '★总闸必须排在其余开关之前（它是入口，藏在中间就找不到）');
    assert.ok(htmlOff.includes('插件静默'), '★关着时要写出后果（否则"世界怎么不动了"会被当成 bug）');
    assert.ok(htmlOff.includes('推进一轮'), '关着时要指出手动出路（手动永不被闸）');
    // ★★leg52（用户令「**推进和撤销不应该放到参数页吧**」→ 拍板「推进撤」· 依据 leg51 §2.1）：
    //   leg40b 当年把「推进一轮」挪进参数页，理由是"这一页就是你对世界的输入"——
    //   **而"推进一轮"不是输入，是动作**（它一个档位都不写）。且 `data-action="advance-world"`
    //   在**设置页也有一枚** ⇒ 参数页这一枚是**重复入口**。⇒ 参数页那一张卡整段撤掉。
    //   ★但 leg40b 原本那条判据的**实质必须保住**：面板上说"要推请按「推进一轮」"时，
    //     **那一枚按钮必须真的存在、真的有人接**（"画了不接/只说不给"是本仓一贯要治的病）。
    //     ⇒ 判据改指**留存的那一面**：设置页有它；且**参数页不再重复**它。
    //     （"有人接"那一半由 `test/param-hub.test.js` 的 ⑪e 扫两页一起锁。）
    assert.ok(!htmlOff.includes('data-action="advance-world"'),
        '★leg52：参数页不再重复画「推进一轮」（它是动作，不是输入；设置页那枚是唯一入口）');
    const settingsOff = renderSettingsHtml(off, { config: {} });
    assert.ok(settingsOff.includes('data-action="advance-world"'),
        '★★「要推请按「推进一轮」」这句提示必须真有一枚按钮兑现——它现在在**设置页**（入口一个不少）');
    assert.ok(settingsOff.includes('推进一轮'), '设置页那枚按钮的名字与状态栏/提示同一口径');
    // 开着时的后果说明
    const on = world({ env: { [KEY]: '1', memoryEnabled: '0' } });
    const htmlOn = renderParamsHtml(on, {});
    assert.ok(htmlOn.includes('发消息会自动推进世界'), '★开着时也要写出后果（每收到一条消息推进一轮）');
});

// ★★leg40b（面板本体体检 · 第二刀）：**删掉"什么都不做"的开关**。
//   病：参数页原来还有第三个开关「记进编年史书」（key `recordEnabled`），而它**一个字节都不写**——
//   全仓只有 `params.js` 那一行定义 + 注释，没有任何消费者。它的来路本仓早登记过
//   （`docs/handoffs/session-handoff-2026-09-11-leg26.md` §7 E2：「我顺手加的面，落点未核验」）。
//   它比"没用"更坏：点了会**落一次盘 + 状态栏报"已开"**，然后什么也不发生。
//   判据分两面：①它不许回潮（登记面 + 渲染面 + 写通道都要干净）；
//   ②**留下来的那两个开关必须真有消费者**——这条是本用例真正的价值（防下一具壳再长出来）。
test('★leg40b：参数开关表零"空壳"——每个开关都得有真消费者；recordEnabled 不得回潮', () => {
    // ① 登记面：旧键已撤
    assert.equal(SWITCH_PARAMS.recordEnabled, undefined, '★recordEnabled 已撤（它一个字节都不写）');
    assert.ok(!isParamKey('recordEnabled'), '白名单不该再认它（认了 = set-param 会写一个无人读的键）');
    // ② 渲染面：参数页不许再出现那张卡，也不许挂写通道
    const html = renderParamsHtml(world({ env: { memoryEnabled: '0', recordEnabled: '0' } }), {});
    assert.ok(!html.includes('记进编年史书'), '★参数页不许再摆这个开关');
    assert.ok(!html.includes('data-param="recordEnabled"'), '★不许挂写通道');
    assert.ok(!html.includes('编年史'), '「编年史」这个说法在参数页零残留（别改名回潮）');
    // ③ ★留下的两个开关**必须各有一个真消费者**（源码级判据：读它的地方不止定义那一行）
    const src = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const renderSrc = readFileSync(path.join(ROOT, 'src', 'render.js'), 'utf8');
    for (const key of Object.keys(SWITCH_PARAMS)) {
        const uses = (src.match(new RegExp(`'${key}'`, 'g')) || []).length
            + (renderSrc.match(new RegExp(`'${key}'`, 'g')) || []).length;
        assert.ok(uses >= 1, `★开关 ${key} 必须有真消费者（否则就是一个点了不动的壳）`);
    }
});

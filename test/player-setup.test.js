// story-world-v2/test/player-setup.test.js
// K32/双流 UI：玩家开档解析接线（细案 §3.5 → A-8）——全链调用/零阻塞降级/截断/
// force 重解析（溯源账 meta.playerParse：只覆盖解析注入键，手填键永不触碰，失败保持旧值）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { PLAYER_DESC_LIMIT, PLAYER_INJECT_DEFAULTS, injectPlayerAttrs } from '../src/player-inject.js';
import { buildPlayerParsePrompt, runPlayerSetup } from '../src/player-setup.js';

const DESC = '散修出身，炼气九层。北山矿场搏命十年，认得矿场把头的门路。';
const PARSE_BODY = { hardPower: 0.3, office: null, intel: 0.6, network: 0.55 };
const PARSE_JSON = JSON.stringify(PARSE_BODY);

function worldWith({ player = true, canon = true } = {}) {
    const w = {
        version: 1,
        context: { world: '江州', tension: 0.6, positions: ['黄府'] },
        entities: [
            { id: 'e_xie', kind: 'faction', name: '薛铁衣', location: '黄府', attrs: {} },
            { id: 'e_player', kind: 'character', name: '黄坤', location: '黄府', attrs: {} },
        ],
        weights: {},
        agendas: [],
        events: [],
        chronicle: [],
        meta: { tick: 0 },
    };
    if (player) w.context.playerId = 'e_player';
    if (canon) {
        w.context.setting = {
            frozen: {
                fingerprint: 'fnv1a_x_1',
                extractedAt: 't',
                canon: { powerScale: [{ level: '炼气', note: '修士' }], rules: [], society: '', techOrMagic: '', historyNotes: [] },
            },
            dynamic: {
                tension: { polarity: 'A/B', direction: '', intensity: 0.5 },
                env: { 民生度: 0.5, 动乱度: 0.5, 天时: 0.5, 张力推手: 0.5 },
                derivedFrom: [],
            },
        };
    }
    return w;
}

test('K32 提示词：只提取不创作 + 四维形状 + 姓名可选（leg25 接线）+ 描述入 prompt，确定性', () => {
    const p = buildPlayerParsePrompt(DESC);
    assert.match(p, /只提取不创作/);
    assert.match(p, /没有依据的一律不输出/);
    assert.match(p, /hardPower/);
    assert.match(p, /network/);
    assert.match(p, /name/, 'leg25：解析顺带取姓名（建世界时给棋子命名）');
    assert.ok(p.includes(DESC));
    assert.equal(buildPlayerParsePrompt(DESC), buildPlayerParsePrompt(DESC));
});

test('K32 无触发（无 playerId / 设定池未就绪）：原样返回，transport 不调用（P-E 零扰动）', async () => {
    let calls = 0;
    const transport = async () => { calls += 1; return PARSE_JSON; };
    const wNoPlayer = worldWith({ player: false });
    const noPlayer = await runPlayerSetup({ ssot: wNoPlayer, playerDesc: DESC, transport });
    assert.equal(noPlayer.skipped, 'no-trigger');
    assert.equal(noPlayer.ssot, wNoPlayer); // 原样同引用（零扰动）
    const wNoCanon = worldWith({ canon: false });
    const noCanon = await runPlayerSetup({ ssot: wNoCanon, playerDesc: DESC, transport });
    assert.equal(noCanon.skipped, 'no-trigger');
    assert.equal(noCanon.ssot, wNoCanon);
    assert.equal(calls, 0);
});

test('K32 全链：解析值落账 + 缺字段默认 + 钳制 + 溯源账记录 + 过 schema；prompt 经 transport 送达', async () => {
    let promptSeen = '';
    const transport = async (p) => { promptSeen = p; return PARSE_JSON; };
    const r = await runPlayerSetup({ ssot: worldWith(), playerDesc: DESC, transport });
    assert.equal(r.skipped, null);
    assert.ok(promptSeen.includes(DESC));
    const player = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.equal(player.attrs.hardPower, 0.3);
    assert.equal(player.attrs.office, PLAYER_INJECT_DEFAULTS.office); // 缺字段走默认
    assert.equal(player.attrs.intel, 0.6);
    assert.equal(player.attrs.network, 0.55);
    assert.deepEqual(r.ssot.meta.playerParse.injected, ['hardPower', 'intel', 'network']);
    const checked = validate(r.ssot, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));
});

test('K32 钳制：解析越界值被引擎钳回 [0,1]（1.5→1、-0.2→0）', async () => {
    const r = await runPlayerSetup({
        ssot: worldWith(),
        playerDesc: DESC,
        transport: async () => JSON.stringify({ hardPower: 1.5, intel: -0.2 }),
    });
    const player = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.equal(player.attrs.hardPower, 1);
    assert.equal(player.attrs.intel, 0);
});

test('K32 失败零阻塞：transport 抛错 / 非法 JSON / 非对象 → 全落定案默认，无溯源账，世界其余不动', async () => {
    for (const mode of ['throw', 'badjson', 'nonobj', 'empty']) {
        const transport = async () => {
            if (mode === 'throw') throw new Error('网络断了');
            if (mode === 'badjson') return '{oops';
            if (mode === 'nonobj') return '[1,2,3]';
            return '';
        };
        const r = await runPlayerSetup({ ssot: worldWith(), playerDesc: DESC, transport });
        const player = r.ssot.entities.find((e) => e.id === 'e_player');
        assert.deepEqual(player.attrs, { ...PLAYER_INJECT_DEFAULTS });
        assert.equal(r.ssot.meta.playerParse, undefined, mode);
        const checked = validate(r.ssot, ssotSchema);
        assert.equal(checked.ok, true, checked.errors.join('; '));
    }
});

test('K32 空描述：不发起调用（transport 未触发），全落定案默认', async () => {
    let calls = 0;
    const r = await runPlayerSetup({ ssot: worldWith(), playerDesc: '   ', transport: async () => { calls += 1; return PARSE_JSON; } });
    assert.equal(r.skipped, 'empty-desc');
    assert.equal(calls, 0);
    const player = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.deepEqual(player.attrs, { ...PLAYER_INJECT_DEFAULTS });
});

test('K32 截断：超长描述截到 PLAYER_DESC_LIMIT，transport 收到的 prompt 只含截断后文本', async () => {
    const long = '甲'.repeat(PLAYER_DESC_LIMIT + 500);
    let promptSeen = '';
    const r = await runPlayerSetup({ ssot: worldWith(), playerDesc: long, transport: async (p) => { promptSeen = p; return PARSE_JSON; } });
    assert.equal(promptSeen.length, buildPlayerParsePrompt(long.slice(0, PLAYER_DESC_LIMIT)).length);
    assert.ok(!promptSeen.includes('甲'.repeat(PLAYER_DESC_LIMIT + 1).slice(0, PLAYER_DESC_LIMIT + 1)));
    assert.equal(r.ssot.entities.find((e) => e.id === 'e_player').attrs.hardPower, 0.3);
});

test('K32 force 重解析：只覆盖溯源账内键；手填键永不触碰；重解析失败保持旧解析值', async () => {
    // 首轮：注入 hardPower/intel（网络=默认 0.3 非解析来源）；office 由用户手填
    const w0 = worldWith();
    w0.entities.find((e) => e.id === 'e_player').attrs.office = 0.9;
    const first = await runPlayerSetup({ ssot: w0, playerDesc: DESC, transport: async () => PARSE_JSON });
    const p = first.ssot.entities.find((e) => e.id === 'e_player');
    assert.equal(p.attrs.office, 0.9);                 // 手填未被覆盖
    assert.equal(p.attrs.hardPower, 0.3);
    assert.deepEqual(first.ssot.meta.playerParse.injected, ['hardPower', 'intel', 'network']);

    // force 重解析：新描述解析出新值 hardPower=0.1 intel=0.9 + 新键 office=0.2
    const second = await runPlayerSetup({
        ssot: first.ssot,
        playerDesc: '重修之后脱胎换骨',
        overwrite: true,
        transport: async () => JSON.stringify({ hardPower: 0.1, intel: 0.9, office: 0.2 }),
    });
    const p2 = second.ssot.entities.find((e) => e.id === 'e_player');
    assert.equal(p2.attrs.hardPower, 0.1);   // 解析注入键：更新
    assert.equal(p2.attrs.intel, 0.9);       // 解析注入键：更新
    assert.equal(p2.attrs.office, 0.9);      // 手填键：永不触碰
    assert.equal(p2.attrs.network, 0.55);    // 首轮解析来源键：本次无新依据 → 旧解析值保留（不降级默认）
    assert.deepEqual(second.ssot.meta.playerParse.injected, ['hardPower', 'intel', 'network']);

    // force 失败（本次解析无依据）：保持旧解析值、溯源不变、不降级默认
    const third = await runPlayerSetup({ ssot: second.ssot, playerDesc: DESC, overwrite: true, transport: async () => '{}' });
    const p3 = third.ssot.entities.find((e) => e.id === 'e_player');
    assert.equal(p3.attrs.hardPower, 0.1);
    assert.equal(p3.attrs.intel, 0.9);
    assert.deepEqual(third.ssot.meta.playerParse.injected, ['hardPower', 'intel', 'network']);
    const checked = validate(third.ssot, ssotSchema);
    assert.equal(checked.ok, true, checked.errors.join('; '));
});

test('K32 幂等回归：无 overwrite 的二次注入无二次变化（v1.1 语义不回归）', async () => {
    const first = await runPlayerSetup({ ssot: worldWith(), playerDesc: DESC, transport: async () => PARSE_JSON });
    const second = await runPlayerSetup({ ssot: first.ssot, playerDesc: DESC, transport: async () => PARSE_JSON });
    assert.deepEqual(second.ssot, first.ssot); // 含溯源账在内逐字节一致
});

test('K32（leg24 重基线）无 transport：不进小调用，**什么都不写**（旧法落定案默认，已作废）', async () => {
    const r = await runPlayerSetup({ ssot: worldWith(), playerDesc: DESC });
    const player = r.ssot.entities.find((e) => e.id === 'e_player');
    assert.deepEqual(player.attrs, {}, '引擎不替玩家编数：没解析就没数');
});

test('K32 注入器溯源回归：手填键永不被 force 覆盖（leg24 重基线：不再有"默认值落账"这种中间态）', () => {
    const w = worldWith();
    // 首轮注入器直调：只有 hardPower 有依据；intel 是**手填**（非解析来源）
    const w1 = injectPlayerAttrs(w, { playerDesc: DESC, parse: () => ({ hardPower: 0.6 }) });
    assert.deepEqual(w1.meta.playerParse.injected, ['hardPower']);
    w1.entities.find((e) => e.id === 'e_player').attrs.intel = 0.9;   // 手填
    // force：解析给出 intel——但它是手填键，不得覆盖（不做来源升级骗局）
    const w2 = injectPlayerAttrs(w1, { playerDesc: DESC, parse: () => ({ intel: 0.3 }), overwrite: true });
    assert.equal(w2.entities.find((e) => e.id === 'e_player').attrs.intel, 0.9, '手填值不被 force 覆盖');
    assert.deepEqual(w2.meta.playerParse.injected, ['hardPower'], '溯源账不因手填键扩张');
});
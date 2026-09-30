// story-world-v2/test/retired-controls.test.js
// ★★★leg84（用户令「还要做多久才完工」⇒ 收尾这一格就交付）：**已撤控件的通用锁**。
//
// 【这一条锁治的病】本仓的判据网里，**每撤一个控件都各配一条"不许回潮"的锁**，而**没有一条通用的**：
//   · `test/render.test.js` 锁「⬇ 补全全册实力」那枚钮与文案 → 它只扫**产物**；
//   · `test/plugin-master-switch.test.js` 锁「记进编年史书」那张卡 → 它只扫**参数页产物**；
//   · ★而 `lookupOneEntity` 的报错串**根本不进渲染产物** ⇒ 上两条结构上都看不见它。
//   **事实证明了这个盲区**：那句"用页顶的「补全全册实力」"在 leg76 撤钮之后**活了下来**，
//   一路到 leg83 才由**人眼**（不是判据）查出来 ⇒ 它是一条"玩家读了会去找、却找不到"的指路，
//   与 leg40b 治过的「永久承诺」同款病。
//
// 【为什么不能只往 `BLACKLIST` 里加两个字面量】`BLACKLIST` 是**引擎术语**表（分量/熵泵/派生源…），
//   它扫的是**渲染产物**——而本文件治的那个洞**恰恰在产物之外**。往那张表里加只会多一条同样盲的扫描。
//   ⇒ 本文件按「**登记表 + 两面锁**」建，并**明确写出扫描面与已知盲区**（盲区要么关掉、要么写进登记表）。
//
// 【两面锁】①**产物面**：渲染产物里的已撤控件名 = 0（含深链对象里每一个字符串）。
//           ②**玩家可见源码串面**：★这一面才是本锁的**主要价值**——它扫的是**会显示给玩家的字面量**，
//             覆盖到产物面照不到的地方（`web/index.js` 的 `lookupOneEntity` 报错串正是其一）。
//
// 【咬合演练】把 leg83 修掉的那句旧指路**注回去**运行本文件 ⇒ 当场红（探针见提交说明）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderAll, renderEntitiesHtml } from '../src/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ═══════════════════════════════════════════════════════════════════════════════════
// ① 登记表：本仓**已由用户拍板撤除**的控件
//    ★新增一条的成本 = 一行；★纪律：**只有"用户明确拍板撤除"的才登记**，
//      "改了个名字"不算（那会立刻假红在正常的重命名上）。
// ═══════════════════════════════════════════════════════════════════════════════
const RETIRED_CONTROLS = [
    {
        name: '补全全册实力',
        action: 'lookup-batch-all',
        why: '方向本身是错的（真账实测：它只问 forcedFields(absent) 那一小撮；11 个里 10 个是「势力」，'
            + '而提示词明令势力不抽实力 ⇒ 永远补不上、原地空转）。用户令「这个按钮根本用不了，要么就改成重抽名册，要么就删了」',
        from: 'docs/session-handoff-2026-09-20-leg76.md §1；判据 test/lookup-batch.test.js:437-442',
    },
    {
        name: '记进编年史书',
        action: 'recordEnabled',
        why: '一个字节都不写（全仓只有定义那一行 + 注释、没有任何消费者）：点了会落一次盘、状态栏报"已开"，然后什么也不发生',
        from: 'leg40b 第二刀；判据 test/plugin-master-switch.test.js:152-167',
    },
    {
        name: '你的开档描述',
        action: 'playerDesc',
        why: '写进 `meta.playerDesc` 之后**全仓零处读**（唯一的"读"是它自己回显进那个框）：四维解析那一族'
            + '（`player-setup.js`/`player-inject.js`）leg25 c 已整条删除，而玩家棋子只有身份与位置、'
            + '没有任何属性需要一段自述去推 ⇒ 那句「世界从中读你的来历与身份、落成棋子自己的处境」'
            + '是一条**永不会兑现的承诺**。用户令「A 删了」（leg87）',
        from: 'leg87；判据 test/render.test.js 的 K34 设置页那条（卡与 id 都不许回潮）',
    },
];

// ═══════════════════════════════════════════════════════════════════════════════════
// ② 扫描面（显式写死 + 附盲区说明）
//    已知**故意不扫**的两类，理由都在表内：
//      · `src/abstract*.js` / `prompts.js` 等——它们是**模型可见面**（提示词），
//        「文风禁令」那类词在那里是**必须出现**的（它是类别词表的一员），扫了必假红；
//      · `test/**`——判据自己的反向自证**故意**要写出那个名字（"它不许出现"这句话本身要含它）。
// ═══════════════════════════════════════════════════════════════════════════════════
const PLAYER_VISIBLE_FILES = [
    'src/render.js',                       // 唯一画 DOM 的模块（只有 web/index.js 与 param-panel.js 调它）
    ...readdirSync(path.join(ROOT, 'web')).filter((f) => f.endsWith('.js')).map((f) => `web/${f}`),
];

/**
 * 只剥**注释**、保留字符串字面量（照本仓既有形状：`test/rule-kinds.test.js:36`、
 * `lookup-batch.test.js` 的同一份口径）。★为什么必须剥注释：本仓的**留档注释**里逐字写着
 * 已撤控件的名字（"某某已撤"），裸扫会把**留档**算成**实现** ⇒ 判据红在自己的注释上
 * （leg71 §4.1 / leg74 §4.1 记过好几次的那个洞）。
 */
function stripComments(src) {
    let out = ''; let i = 0; const n = src.length;
    while (i < n) {
        const c = src[i]; const c2 = src[i + 1];
        if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
        if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            const q = c; out += c; i += 1;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === q) { i += 1; break; }
                i += 1;
            }
            continue;
        }
        out += c; i += 1;
    }
    return out;
}

// ★★★白名单：**每一处都必须带出处**，且下面第 ④ 格会**反查**它真实存在
//   （照本仓「白名单不许无法证伪」那条纪律：条目写错一个标点就会被当场抓出来，
//    而不会静默变成"整表放行"）。
const ALLOWED = [
    {
        file: 'src/entity-lookup.js',
        quote: 'spec-lookup-batch-refresh.md',
        why: '★不是玩家可见文案：它是**细案的文档名**，出现在模板字面量的 `${}` 表达式块里'
            + '（`stripComments` 拦不住模板里的表达式块——交接 §4.④ 记的那个坑）。'
            + '★顺带如实登记本扫描器的一个**已知盲区**：模板字面量的 `${}` 里的内容会被当成代码原样保留。',
    },
    {
        file: 'web/index.js',
        quote: '的旧入口已撤',
        why: '★★这是**判据允许的"如实告知"**，不是指路：leg83 修掉旧指路后，那句话改成'
            + '「…要连「书未明述」一起推倒重查，用这一行的「重查」；全册批量补全的旧入口已撤」——'
            + '它必须**点名**那个已撤入口，玩家才知道"别去找了"。'
            + '★口径（合法 vs 违规的界线）：**合法 = 只有"它已撤"这一种陈述**（句中含"已撤"）；'
            + '**违规 = 指路**（"用页顶的…"／"去点…"）。本白名单是**能证伪的**：'
            + '下面第 ④ 格反查这句引文必须真在其中，第 ⑤ 格再单独咬"这个函数体内不许出现控件名"。',
    },
];

// ★夹具：照 `test/lookup-batch.test.js:15-29` 的既有形状（本仓"同一口径不许两处实现"），
//   只补上 `config`/`oldVolumes` 让它真的能跑完整的 `renderAll`。
//   ★leg87：`playerDesc` 这个键已随那张卡撤掉（本文件登记表里就有它）⇒ 夹具不再喂它。
const CONFIG = { baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' };
const VOLUMES = [{ id: '卷一', info: '第 1–500 轮 · 512KB · 收在插件本地' }];
const world = (over = {}) => ({
    version: 1,
    context: {
        world: '测试世界', tension: 0.5, positions: ['未明'], playerId: 'e_p1',
        setting: {
            frozen: {
                fingerprint: 'f', extractedAt: 't',
                canon: {
                    bookEntities: [],
                    // ★带上法则：让设定页真的渲染出法则栏，两面的对照才有东西可扫
                    rules: ['煞气须以灵脉镇压', '契书为王'],
                    ruleKinds: { 0: '判断依据', 1: '世界观设定' },
                },
            },
        },
    },
    entities: [
        { id: 'e_p1', kind: 'character', name: '你', location: '未明' },
        { id: 'e_a', kind: 'character', name: '甲一道祖', location: '未明', 实力: 'T9' },
        { id: 'e_b', kind: 'faction', name: '乙妖盟', location: '未明' },
    ],
    weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
    meta: { tick: 3, simLog: [] },
    ...over,
});
const textOnly = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
function deepStrings(o, acc = []) {
    if (typeof o === 'string') acc.push(o);
    else if (Array.isArray(o)) for (const v of o) deepStrings(v, acc);
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) deepStrings(o[k], acc);
    return acc;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ③ 面一：渲染产物里的已撤控件名 = 0
// ═══════════════════════════════════════════════════════════════════════════════════
test('★★★leg84：八页签渲染产物里，已撤控件的名字一处都不许有（含悬停 title 与深链字符串）', () => {
    const all = renderAll(world(), { config: CONFIG, oldVolumes: VOLUMES });
    const text = deepStrings(all).map(textOnly).join('\n');
    for (const c of RETIRED_CONTROLS) {
        assert.ok(!text.includes(c.name),
            `★产物里出现了已撤控件「${c.name}」——那是一条"玩家读了会去找、却找不到"的指路`
            + `（撤除依据：${c.from}）`);
    }
    // ★反向自证（防"扫的是空气"）：产物必须**真的有内容**，否则上面两条断言平凡成立
    assert.ok(text.length > 2000, `前置：产物必须有内容（实测 ${text.length} 字符，否则上面两条是空绿）`);
    assert.ok(text.includes('盘算') || text.includes('法则') || text.includes('世界'),
        '前置：产物里确有玩家话（不是空壳）');
});

test('★★★leg84：实体页工具条里不许再有那枚钮，也不许挂那条动作', () => {
    const html = renderEntitiesHtml(world());
    for (const c of RETIRED_CONTROLS) {
        assert.ok(!html.includes(c.name), `实体页不许再出现「${c.name}」`);
        assert.ok(!html.includes(`data-action="${c.action}"`), `★也不许挂 ${c.action} 那条写通道`);
    }
    // ★反向自证：实体页确实渲染了（否则上面是空绿）；行内那枚**还活着**的「查」必须在
    assert.ok(html.length > 500, '前置：实体页真的渲染了');
    assert.ok(html.includes('data-action="lookup-entity"'),
        '前置 + 对照：行内那枚「查」**仍活着**（撤的是"全册"那枚，不是整个查书面）');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ④ 面二：★玩家可见的**源码串**里的已撤控件名 = 0（白名单除外）
//    这一面才是本锁的主要价值：它覆盖 `renderAll` **结构上看不见**的地方。
// ═══════════════════════════════════════════════════════════════════════════════════
test('★★★leg84：玩家可见源码里的已撤控件名 = 0（★含 renderAll 照不到的报错串）', () => {
    // 前置自证：扫描面**真的读到了文件**（防路径写错 ⇒ 整条锁退化成空绿）
    assert.ok(PLAYER_VISIBLE_FILES.length >= 8,
        `★扫描面必须真有文件（实测 ${PLAYER_VISIBLE_FILES.length} 个）；路径写错会让本锁静默空转`);
    assert.ok(PLAYER_VISIBLE_FILES.includes('web/index.js') && PLAYER_VISIBLE_FILES.includes('src/render.js'),
        '★两个关键文件必须在扫描面里（leg76 那个洞正长在 web/index.js 上）');

    const violations = [];
    for (const rel of PLAYER_VISIBLE_FILES) {
        const code = stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
        for (const c of RETIRED_CONTROLS) {
            let at = code.indexOf(c.name);
            while (at >= 0) {
                const snippet = code.slice(Math.max(0, at - 80), at + 80);
                if (!ALLOWED.some((a) => a.file === rel && snippet.includes(a.quote))) {
                    violations.push(`${rel}: …${snippet.replace(/\s+/g, ' ')}…  ← 提到已撤控件「${c.name}」`);
                }
                at = code.indexOf(c.name, at + 1);
            }
        }
    }
    assert.deepEqual(violations, [],
        `★玩家可见的源码里提到了已撤控件（每一条都要么删掉、要么按"能证伪的白名单"登记）：\n${violations.join('\n')}`);
});

test('★★★leg84：白名单不许无法证伪 —— 每条都得真在其中（防"整表静默放行"）', () => {
    for (const a of ALLOWED) {
        assert.ok(a.quote && a.why && a.file, '★白名单每条必须带 出处 + 理由 + 文件');
        const code = stripComments(readFileSync(path.join(ROOT, a.file), 'utf8'));
        assert.ok(code.includes(a.quote),
            `★白名单条目已失效：${a.file} 里再也找不到「${a.quote}」⇒ 必须删掉这一条`
            + `（留着就是一张能放行任何东西的空牌）`);
        // ★加严：引文必须落在**字符串字面量**里。否则改编一句**注释外的代码**
        //   （例如把一个变量改名叫 `的旧入口已撤` 之类）就能骗过白名单匹配 ⇒ 放行理由不成立。
        const at = code.indexOf(a.quote);
        const lineStart = code.lastIndexOf('\n', at) + 1;
        const line = code.slice(lineStart, code.indexOf('\n', at));
        assert.ok(/['"`]/.test(line),
            `★白名单引文必须落在字符串字面量里（引文所在行一个引号都没有 ⇒ 这条放行理由不成立）：${a.file} 「${a.quote}」`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ⑤ 逐条点名：leg83 人眼查出来的那一处，钉在它自己的函数里
//    （本仓纪律：判据要锚在**内容**上，不锚行号；这里锚的是"在那个函数体内、且在错误文案里"）
// ═══════════════════════════════════════════════════════════════════════════════════
test('★★★leg84：`lookupOneEntity` 的兜底提示不许再指向已撤的「补全全册实力」（leg83 人眼查出来的那一处）', () => {
    const src = readFileSync(path.join(ROOT, 'web', 'index.js'), 'utf8');
    const at = src.indexOf('export async function lookupOneEntity(');
    assert.ok(at > 0, '★前置：`lookupOneEntity` 仍在 web/index.js（判据不许因为函数被改名而静默失效）');
    const end = src.indexOf('\nexport ', at + 10);
    const lines = src.slice(at, end > 0 ? end : undefined).split('\n');
    assert.ok(lines.some((l) => l.includes('ok: false, error:')), '★前置：这个函数里确有玩家会读到的报错文案');

    // ★★口径（这是本判据真正要守的那条界线，两者形状不同但**同一口径**）：
    //   **合法 = 如实告知"它已撤"** —— 该行要么含 `已撤`，要么在同一字符串字面量里**点名并说明已撤**
    //     （实拍两处：源 ② 是「全册批量补全…的旧入口已撤」= 别名 + 已撤；leg83 修的是改成"用这一行的「重查」"）；
    //   **违规 = 指路** —— 「用页顶的「补全全册实力」」「去点…」这种"让玩家去找一个没有的钮"。
    //   ⇒ 判据咬的是"有没有指路"，不是"有没有提过那个名字"（后者会把**如实说明**一起误杀）。
    const offenders = [];
    lines.forEach((line, i) => {
        for (const c of RETIRED_CONTROLS) {
            if (!line.includes(c.name)) continue;
            const inString = /['"`]/.test(line);
            const honest = line.includes('已撤')
                || /已撤|撤(?:掉|了|除)|不存在/.test(line.slice(Math.max(0, line.indexOf(c.name) - 40), line.indexOf(c.name) + c.name.length + 40));
            if (!(inString && honest)) offenders.push(`第 ${i + 1} 行：${line.trim()}`);
        }
    });
    assert.deepEqual(offenders, [],
        `★这条报错文案在**指路**到已撤控件（合法形态只有一种：如实说明"它已撤"）：\n${offenders.join('\n')}`);

    // ★反向对照：**修好的那句话必须在位**（否则"把整段报错删掉"也能让上面通过 —— 那叫治成哑巴）
    const body = lines.join('\n');
    assert.ok(body.includes('重查'), '★对照：如实口径（"用这一行的「重查」"）必须在位，不许靠删句子过关');
    // ★反向对照：正因为它**如实提了**那个已撤入口，本文件第 ④ 格的扫描才不是空转
    assert.ok(body.includes('已撤'), '★对照：这句里"已撤"二字在位（既是如实口径，也是第 ④ 格白名单的锚）');
});

// ═══════════════════════════════════════════════════════════════════════════════════
// ⑥ 登记表自身的守门（照本仓"判据自己也要能被证伪"那条纪律）
// ═══════════════════════════════════════════════════════════════════════════════════
test('★★leg84：登记表每条都必须带"撤除依据"与"写通道名"（防止登记表退化成一张许愿单）', () => {
    assert.ok(RETIRED_CONTROLS.length >= 2, '至少登记 leg76 与 leg40b 这两条（本仓已拍板撤除的控件）');
    for (const c of RETIRED_CONTROLS) {
        assert.ok(c.name && c.name.length >= 4, `控件名要写全：${c.name}`);
        // ★勘正留痕（本仓 §5 那条纪律）：初版这里写的是 `/^[a-z-]+$/`，把 `recordEnabled` 判红了——
        //   错在**假设了每个控件都只有 `data-action` 一种写通道**。事实：`recordEnabled` 是**参数键**
        //   （写通道是 `data-param="…"`）。⇒ 口径改成"认两种通道形态"（语义未动，登记表一个字没改）。
        assert.ok(c.action && /^(?:[a-z][a-z0-9-]*|[a-z][a-zA-Z0-9]*)$/.test(c.action),
            `写通道名要写成 data-action / data-param 的键形态：${c.action}`);
        assert.ok(c.why && c.why.length >= 20, `必须写清"为什么撤"（否则下一棒会想把它加回来）：${c.name}`);
        assert.ok(/leg\d+|判据|令/.test(c.from), `必须带出处（leg 号 / 判据文件）：${c.name}`);
    }
});

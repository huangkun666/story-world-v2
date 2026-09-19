// story-world-v2/test/pack-fit.test.js
// ★★★leg69（A1 · 设计见 `docs/superpowers/specs/2026-09-18-leg69-light-bundle-design.md` §2）：
//   **进包块级截断的留痕**——病：`buildScaleAnchor` / `buildRuleAnchor` 在自身预算里**静默 `break`**
//   （表 ≤`SCALE_TABLE_TOP_PACK` / 档 ≤`TIER_TOP` / 维 ≤`DIM_TOP` / 判据 ≤`RULE_PACK_TOP`），
//   包里零读数 ⇒ 真账「34 张表 214 档 ⇒ 进包 3 张 24 档、丢 88.8%」只能靠人肉比对
//   （对照：**整包级**的 `trimPack` 是有痕迹的 `pack.trimmed`）。
//
// 本文件的判据（设计 §2.3）：
//   ① **薄壳一致**：`WithFit(...).anchor` 与薄壳 `buildScaleAnchor(...)` 是**同一个东西**
//      （含 `null` 两种边界）——治"抽核心时把某条分支漏在薄壳外"。
//   ② **真截断如实**：一条真顶到预算的夹具 ⇒ `进包 < 共`，**且读数与实物逐个对上**（不是自己另算一遍）。
//   ③ **没丢就不写键**：golden 夹具（不触发截断）⇒ 包里**不出现** `刻度裁掉`（零迁移纪律）。
//   ④ **面板 == 包**：面板读数与包里读数**同一来源**（治"一个数两把尺子"）。
//   ⑤ **法则同款**：`buildRuleAnchorWithFit` 照 ①③ 办。
//
// ★判据形态纪律（照 leg61/64/67 同一把尺）：夹具全是**自造记号**（`表N`/`X1`/`甲境`），
//   不抄大荒/三国/实教的任何原话——"换一本书照样成立"这条锁才算锁住了。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildScaleAnchor, buildScaleAnchorWithFit, buildRuleAnchor, buildRuleAnchorWithFit,
    buildEvolutionPack, TIER_TOP, DIM_TOP, SCALE_TABLE_TOP_PACK,
} from '../src/pack.js';
// ★`RULE_PACK_TOP` 的真源在 **`abstract-tier.js`**（pack.js 是**引用式**取它，不重写数字 —— 那条纪律见 pack.js 头注）。
//   ★★leg71（丙案）：真源**换家**——法则分类那三道进包上界随"档位归一 + 法则分类"一起搬到了新模块。
import { RULE_PACK_TOP } from '../src/abstract-tier.js';

const GOLDEN = JSON.parse(readFileSync(new URL('./fixtures/golden-world.min.json', import.meta.url), 'utf8'));

// ───────── 夹具（全自造） ─────────
/** 一条**真顶到块级预算**的 canon：30 张表 × 每张 3 档 3 维 ⇒ 表/档/维三道闸都会被咬。 */
const fatCanon = () => ({
    powerScale: [], dims: [], rules: [],
    刻度: Array.from({ length: 30 }, (_, i) => ({
        名: `表${i}`, 源: '甲',
        档位: [{ 档: `X${i}a`, 注: '一' }, { 档: `X${i}b`, 注: '二' }, { 档: `X${i}c`, 注: '三' }],
        维度: [{ 名: `维${i}a`, 范围: '甲境' }, { 名: `维${i}b`, 范围: '乙境' }, { 名: `维${i}c`, 范围: '丙境' }],
    })),
});
/** 一条**装得下**的 canon（不触发任何块级预算）。 */
const thinCanon = () => ({
    powerScale: [], dims: [], rules: [],
    刻度: [{ 名: '表0', 源: '甲', 档位: [{ 档: 'X0a', 注: '一' }], 维度: [{ 名: '维0a', 范围: '甲境' }] }],
});
/** 组装一个最小 ssot（面板与出包都吃它）。 */
const ssotOf = (canon) => ({
    context: { world: '测试世界', setting: { frozen: { canon }, dynamic: { tension: { polarity: '甲/乙', intensity: 0.5 }, env: {} } } },
    entities: [], agendas: [], events: [], chronicle: [], milestones: [], meta: { tick: 1 },
});

/**
 * **只剥注释**（保留字符串与模板字面量的内容 —— 被找的调用就住在模板插值里）。
 * 比"正则整体替换"可靠：逐字符走一遍，进到字符串/模板/正则里就照抄，注释换成空格。
 */
function stripComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const c2 = src[i + 1];
        if (c === '/' && c2 === '/') {                       // 行注释：整行剩下都丢掉
            while (i < n && src[i] !== '\n') i += 1;
            continue;
        }
        if (c === '/' && c2 === '*') {                       // 块注释：丢到收尾，换行照留（保行号感）
            i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
                if (src[i] === '\n') out += '\n';
                i += 1;
            }
            i += 2;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {          // 字符串/模板：**原样照抄**（含 `${…}` 里的代码）
            const quote = c;
            out += c;
            i += 1;
            while (i < n) {
                if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
                out += src[i];
                if (src[i] === quote) { i += 1; break; }
                i += 1;
            }
            continue;
        }
        out += c;
        i += 1;
    }
    return out;
}

// ═══════════════ ① 薄壳一致（两支必须是同一个东西，含 null 边界） ═══════════════
test('A1-①：WithFit 的 anchor 与薄壳逐字节同形（含两种 null 边界）', () => {
    for (const [label, canon] of [['fat', fatCanon()], ['thin', thinCanon()],
        ['null', null], ['空表', { powerScale: [], dims: [], rules: [], 刻度: [] }],
        ['只有空白项', { dims: [{ name: '  ' }], powerScale: [{ level: '' }] }]]) {
        const shell = buildScaleAnchor(canon);
        const withFit = buildScaleAnchorWithFit(canon);
        assert.deepEqual(withFit.anchor, shell, `刻度：${label} 的薄壳与 WithFit 必须是同一个东西`);
        if (shell === null) assert.equal(withFit.fit, null, `刻度：${label} 没东西进包 ⇒ fit 也必须是 null`);
    }
    for (const [label, canon] of [['有判据', { rules: ['甲境: 跨阶→DC17'], ruleKinds: { '甲境: 跨阶→DC17': '判断依据' } }],
        ['无判据', { rules: [], ruleKinds: {} }], ['null', null], ['老账无类别', { rules: ['甲境: 一'] }]]) {
        assert.deepEqual(buildRuleAnchorWithFit(canon).anchor, buildRuleAnchor(canon), `法则：${label} 的薄壳与 WithFit 必须是同一个东西`);
    }
});

// ═══════════════ ② 真截断如实（读数与**实物**逐个对上） ═══════════════
test('A1-②：真顶到预算时 进包 < 共，且读数与实物逐个相等（不是自己另算一遍）', () => {
    const canon = fatCanon();
    const { anchor, fit } = buildScaleAnchorWithFit(canon);
    assert.ok(anchor?.length, '夹具必须真进包（否则这条用例什么都没验）');
    // 咬到闸了 ⇒ 进包 < 共
    assert.ok(fit.表.进包 <= SCALE_TABLE_TOP_PACK && fit.表.共 > fit.表.进包, `表：进包 ${fit.表.进包} / 共 ${fit.表.共}`);
    assert.ok(fit.档.共 > fit.档.进包, `档：进包 ${fit.档.进包} / 共 ${fit.档.共}`);
    assert.ok(fit.维.共 > fit.维.进包, `维：进包 ${fit.维.进包} / 共 ${fit.维.共}`);
    // ★读数 == 实物（数 `anchor` 自己的元素，而不是相信 fit 自报）
    const real = (key) => anchor.reduce((n, t) => n + ((t[key] || []).length), 0);
    assert.equal(fit.表.进包, anchor.length, '表.进包 必须等于 anchor 的条数');
    assert.equal(fit.档.进包, real('档位'), '档.进包 必须等于 anchor 里档位的实际条数');
    assert.equal(fit.维.进包, real('维度'), '维.进包 必须等于 anchor 里维度的实际条数');
    // `共` 必须 ≥ 进包，且不超出 canon 里的真实总量（自造夹具 30×3）
    assert.equal(fit.档.共, 90, '共 必须等于账上档位总量（30 张 × 3 档）');
    assert.equal(fit.维.共, 90, '共 必须等于账上维度总量（30 张 × 3 维）');
    // 三道闸的常量本身也是判据的一部分（改预算必须连带改这条）
    assert.ok(fit.档.进包 <= TIER_TOP && fit.维.进包 <= DIM_TOP, '进包数必须落在预算之内');
});

test('A1-②b：法则块顶到条数闸时 进包 < 共（且 = RULE_PACK_TOP）', () => {
    const rules = Array.from({ length: RULE_PACK_TOP + 25 }, (_, i) => `甲境${i}: 跨一阶→DC1${i}`);
    const canon = { rules, ruleKinds: Object.fromEntries(rules.map((r) => [r, '判断依据'])) };
    const { anchor, fit } = buildRuleAnchorWithFit(canon);
    assert.equal(fit.判据.共, rules.length, '共 = 分类后判据总数');
    assert.equal(fit.判据.进包, anchor.length, '进包 = anchor 实际条数');
    assert.ok(fit.判据.共 > fit.判据.进包, `真咬到闸：${fit.判据.进包}/${fit.判据.共}`);
    assert.ok(fit.判据.进包 <= RULE_PACK_TOP, '进包不许超条数闸');
});

// ═══════════════ ③ 没丢就不写键（零迁移纪律） ═══════════════
test('A1-③：没丢东西时包里**不出现** `刻度裁掉`（golden 与薄夹具两条）', () => {
    for (const [label, ssot] of [['golden 夹具', GOLDEN], ['薄夹具', ssotOf(thinCanon())]]) {
        const built = buildEvolutionPack(ssot, null);
        assert.ok(!('刻度裁掉' in (built.pack.setting || {})),
            `★${label}：不触发块级预算 ⇒ 这个键必须不出现（空着就是空着）`);
    }
});

test('A1-③b：真丢东西时该键出现，且形状就是两个 WithFit 的读数', () => {
    const canon = fatCanon();
    const built = buildEvolutionPack(ssotOf(canon), null);
    const got = built.pack.setting?.刻度裁掉;
    assert.ok(got, '★顶到预算 ⇒ 包里必须留下读数（这正是本棒要治的"静默"）');
    const fit = buildScaleAnchorWithFit(canon).fit;
    assert.equal(got.刻度.档.进包, fit.档.进包, '包里读数 == 真源读数（档）');
    assert.equal(got.刻度.表.共, fit.表.共, '包里读数 == 真源读数（表·共）');
    assert.ok(typeof got.刻度.原因 === 'string' && got.刻度.原因.length > 0, '必须说清是**哪道预算**切掉的');
});

// ═══════════════ ④ 面板 == 包（一个数不许有两把尺子） ═══════════════
test('A1-④：面板的进包读数与包里读数**同一来源**（render.js 不许自己数一遍）', () => {
    const src = readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
    // ★必须**只剥注释**再扫：本仓注释极密，而 leg69 的收口说明里**逐字引用了**被删掉的那行
    //   （"原先这里自己数了一遍 `scaleAnchor.reduce(...)`"）⇒ 不剥注释就会拿注释当证据
    //   （leg68 复量时正是栽在这个口径上）。
    //   ★★**不许用"把字符串换成空串"的粗暴掩码**（本棒踩过一次）：那个调用**住在模板字面量的
    //     `${…}` 插值里**（拼提示词文案时用的），掩掉模板内容 ⇒ 把要找的代码一起抹了 ⇒ 假红。
    //     正确做法是**跳过**字符串/模板（保留其内容），只把注释换成空格。
    const code = stripComments(src);
    assert.ok(code.includes('buildScaleAnchorWithFit('),
        '★面板必须读 WithFit 那个口（`buildScaleAnchorWithFit` 出现在 render.js 的**代码**里，不是注释里）');
    // ★口径（leg69 演练时**连改三版**才立住，每一版都是演练/全量跑抓出来的 —— 留档别重犯）：
    //   ① `!/scaleAnchor\.reduce\(/` —— **太窄**？不：它其实是对的那一版。但当时我没验证"它咬得住换名版"。
    //   ② `/\.reduce\([^)]*\.档位/` —— **在真代码上不命中**：`[^)]*` 被箭头函数形参的 `)` 提前截断
    //      （`.reduce((n, t) => n + (t.档位 …`）⇒ "该红的不红"。
    //   ③ "按动作窗口认"（凡 `.reduce(` 附近数 `档位` 就禁）—— **太宽**：面板在 `:1660-1661`
    //      **合法地**数 `scales`（`resolveScales` 的**全量**：用于"其余 N 张没进包"那句对照），
    //      那与"进包读数"是**两个不同的量** ⇒ 全量跑当场红 1 条（自伤）。
    //   ⇒ 定稿：**认那个动作 + 那个来源** —— 被收口掉的是"**对 `scaleAnchor` 自己 reduce**"，
    //     而 `scaleAnchor` 这个绑定名已被删（现存只有注释里提到它，故必须先剥注释再扫）。
    //     ★这条锁的边界写清楚：它防的是"**把旧那段抄回来**"（那是唯一真实的回潮形态）；
    //       若有人另起炉灶写第三种数法，锁**不咬**——那种情况得靠人读。
    assert.ok(!/scaleAnchor\.reduce\(/.test(code),
        '★面板不许再对 `scaleAnchor` 自己 reduce 数档位/维度——那正是被本棒收口掉的"第二份复制品"'
        + '（进包读数必须来自 fit；面板数**全量** `scales` 是另一件事，不受本条限制）');
    assert.ok(!/scaleAnchor\.length\b/.test(code),
        '★面板不许再用 `scaleAnchor.length` 自算表数（读数必须来自 fit）');
    // 端到端：同一 canon 下，包里的表数 == fit.表.进包
    const canon = thinCanon();
    const fit = buildScaleAnchorWithFit(canon).fit;
    const built = buildEvolutionPack(ssotOf(canon), null);
    assert.equal((built.pack.setting.刻度 || []).length, fit.表.进包, '包里的表数 == fit.表.进包');
});

// ═══════════════ ⑤ 留痕不许越界：块级读数 ≠ 整包读数 ═══════════════
test('A1-⑤：`刻度裁掉` 只报**块级**预算，不冒充整包的 `trimmed`', () => {
    const pack = readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8');
    // 两块读数必须来自 WithFit（真源），不是本文件另算
    assert.match(pack, /buildScaleAnchorWithFit\(/, '出包必须读 WithFit 口');
    assert.match(pack, /buildRuleAnchorWithFit\(/, '出包必须读 WithFit 口（法则同款）');
    // 键名与 `trimmed` 分工：本条不写 `trimmed`（那是 `trimPack` 的活）
    assert.match(pack, /刻度裁掉/, '新键必须真的被用上');
});

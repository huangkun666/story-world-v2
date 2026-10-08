// story-world-v2/test/web-index-bare-refs.test.js
// ★★★leg210：接线层（`web/index.js`）里**「裸引用兄弟模块导出的名字、却全文件没有出处」**这一类 bug 的判据。
//
// 这一棒治的两处病（**同一形状，都是"拆模块时漏的"**；同一把判据一次抓出来）：
//   ① `SW2_FLUSH_TRIES`（住 `web/hot-ledger.js`）—— leg78 把热账族搬走时它**没进 import 名单**，
//      而唯一引用它的那一句在 `flushOutcomeText` 的 `replaced` 支上 ⇒ 账本被别的副本覆盖时，
//      求值状态文本当场 `ReferenceError`，被外层 `catch` 吃掉，状态条印的是
//      「注意：初始化失败：SW2_FLUSH_TRIES is not defined」（TT/手机没有控制台 ⇒ 天书且无从自救）。
//   ② `resolveLimits`（住 `src/limits.js`）—— `getWindowTurns` 那一行裸调它，而本文件从没 import 过它；
//      消费端 `web/settings-channels.js` 那格带 `catch (_) { return undefined; }` ⇒ **症状是静默**：
//      玩家设的「往事轮数」对向量召回窗口从来没生效过（一路回退出厂窗口、不报错、不提示）。
//
// ★为什么必须是一条**通用**判据（而不是再点名钉一个符号）：
//   本仓为这一类病已经点名写过两次（`web-param-panel-layout.test.js` ⑥ 的 BUGS 清单、
//   `snapshot.test.js` 的块作用域那一条），两次都是**事后**补的 ⇒ 换个名字再来一次照样溜过去
//   （本棒就是"换个名字再来一次"的第三次，而且它已经躺了两个多月）。
//   这一条把口径反过来：**凡是兄弟模块导出的名字，只要在接线层里被裸引用（非成员访问、非对象键），
//   就必须在接线层里有个出处**（import 名单 / 声明 / 解构 / 形参 / catch）。
//   ★本棒实测：修复前 2 命中（正好是上面两处）、修复后 0 命中。
//
// ★判据形态纪律（照 `web-hot-ledger-layout.test.js` / `web-param-panel-layout.test.js` 同一把尺）：
//   ① 一律跑在**剥注释后的源码**上（留痕注释里就写着这些符号名，不剥就是假红/假绿两头顶）；
//   ② ★★**模板插值里的名字必须保住**——`${SW2_FLUSH_TRIES}` 正是本棒的现场；把字符串内容整体丢掉的
//      剥注释器**看不见它**（本棒第一版就写错成那样，判据当场假绿——这条留档给下一棒）；
//   ③ 每条都要能**当场红**（下面 ② 拿"修复前的真片段"与四种"有出处"的写法做反向自证）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const listDir = (rel) => readdirSync(fileURLToPath(new URL('../' + rel, import.meta.url)));

/**
 * 剥注释：注释与**普通字符串的内容抹成空格**、换行原样保留（行号才对得上）；
 * ★★但**模板插值（`${…}`）原样留下** —— `\`… ${SW2_FLUSH_TRIES} …\`` 正是本棒的现场，
 * 而"把字符串内容整体丢掉"的剥法**看不见它**（本棒第一版就写成那样，判据当场假绿；留档给下一棒）。
 * ★为什么普通字符串要抹掉（而不是像别的判据那样"内容照留"）：这一条是**否定式**判据
 * （"被裸引用就必须有出处"），留字符串内容 ⇒ `setStatus('resolveLimits 失败了')` 这种
 * **只是提到名字**的写法会被误判成裸引用（假红）。⇒ 只给插值开门，别的一律抹。
 * @param {{keepStrings?: boolean}} [opts] `keepStrings` ⇒ 字符串原样保留（④ 要从 `reason: '…'` 里读字面量）
 */
function stripComments(src, { keepStrings = false } = {}) {
    const out = src.split('');
    const blank = (from, to) => { for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '; };
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i], c2 = src[i + 1];
        if (c === '/' && c2 === '/') { const s = i; while (i < n && src[i] !== '\n') i++; blank(s, i); continue; }
        if (c === '/' && c2 === '*') {
            const s = i; i += 2;
            while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
            i = Math.min(n, i + 2);
            blank(s, i);
            continue;
        }
        if (keepStrings) {   // ★只剥注释那一档：字符串（含模板）整段原样跳过
            if (c === '"' || c === "'" || c === '`') {
                i++;
                while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === c) { i++; break; } i++; }
            } else i++;
            continue;
        }
        if (c === '"' || c === "'") {
            const s = i; i++;
            while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === c) { i++; break; } i++; }
            blank(s, i);
            continue;
        }
        if (c === '`') {
            blank(i, i + 1); i++;
            while (i < n) {
                if (src[i] === '\\') { blank(i, i + 2); i += 2; continue; }
                if (src[i] === '`') { blank(i, i + 1); i++; break; }
                if (src[i] === '$' && src[i + 1] === '{') {
                    // ★插值原样留下：跳到与它配对的 `}`（插值里再嵌字符串的写法极少，这里不细抠）
                    i += 2;
                    let depth = 1;
                    while (i < n && depth > 0) {
                        if (src[i] === '{') depth++;
                        else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
                        i++;
                    }
                    continue;
                }
                blank(i, i + 1); i++;
            }
            continue;
        }
        i++;
    }
    return out.join('');
}

/** 兄弟模块（`web/` 与 `src/` 里的每个 .js，接线层自己除外）导出的名字 → 它住在哪些文件里。 */
function collectSiblingExports() {
    const exported = new Map();
    const add = (name, rel) => { if (!exported.has(name)) exported.set(name, []); exported.get(name).push(rel); };
    for (const dir of ['web', 'src']) {
        for (const f of listDir(dir)) {
            if (!f.endsWith('.js')) continue;
            const rel = `${dir}/${f}`;
            if (rel === 'web/index.js') continue;
            const src = stripComments(read(rel));
            for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1], rel);
            for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
                for (const part of m[1].split(',')) {
                    const name = part.trim().split(/\s+as\s+/).pop().trim();
                    if (name) add(name, rel);
                }
            }
        }
    }
    return exported;
}

/**
 * 判据核心口径：接线层里**裸引用**（非成员访问、非对象键、非 import 语句）**且全文件没有出处**的兄弟模块导出名。
 * ★独立成一个纯函数（好让它能被假源码直接喂——反向自证那条判据靠它）。
 * @returns {Array<{name:string, files:string[], line:number}>}
 */
function bareRefs(indexSrc, exported) {
    const code = stripComments(indexSrc);
    const imported = new Set();
    for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from/g))
        for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n) imported.add(n); }
    for (const m of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) imported.add(m[1]);
    /** "有出处" = 任何深度上的声明 / 解构 / 形参 / catch（★不要求"必须住在顶层"：
     *  块作用域那条纪律另有判据在咬（`snapshot.test.js`），这里是"**一个字都没绑定**"那一类）。 */
    const boundAnywhere = (name) => {
        const N = name.replace(/\$/g, '\\$');
        return [
            new RegExp(`\\b(?:const|let|var|function|class)\\s+${N}\\b`),
            new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${N}\\b[^}]*\\}`),
            new RegExp(`\\b(?:const|let|var)\\s*\\[[^\\]]*\\b${N}\\b[^\\]]*\\]`),
            new RegExp(`\\bfunction\\b[^(]*\\([^)]*\\b${N}\\b[^)]*\\)`),
            new RegExp(`\\([^()]*\\b${N}\\b[^()]*\\)\\s*=>`),
            new RegExp(`\\bcatch\\s*\\(\\s*${N}\\s*\\)`),
        ].some((re) => re.test(code));
    };
    // import/export 语句整段抹掉：引入名与"来源名"都不是引用（`X as Y` 里的 X 曾把本棒第一版骗红过）
    const head = code.replace(/^[ \t]*(?:import|export)\b[^\n]*$/gm, (s) => ' '.repeat(s.length));
    const hits = [];
    head.split('\n').forEach((line, idx) => {
        for (const m of line.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)(\s*:)?/g)) {
            const name = m[2];
            const before = line.slice(0, m.index + m[1].length).replace(/\s+$/, '');
            // 对象字面量的**键**不算引用：`{ k:` 同行，或行首 `k:`（多行对象）——`setSimulationBlocked:` 曾把第一版骗红
            if (m[3] && (before.slice(-1) === '{' || before.slice(-1) === ',' || before.trim() === '')) continue;
            if (!exported.has(name) || imported.has(name) || boundAnywhere(name)) continue;
            hits.push({ name, files: exported.get(name), line: idx + 1 });
        }
    });
    return hits;
}

// ─────────────────── ① 真源码：这一类缺陷必须为零 ───────────────────

test('★★★leg210①：接线层里"裸引用兄弟模块的导出、却全文件没有出处"必须为零', () => {
    const exported = collectSiblingExports();
    const index = read('web/index.js');
    // ★前提两条（否则"0 命中"可能只是判据在测空气）
    assert.ok(exported.size > 500, `★判据前提：兄弟模块导出的名字得够多才说明表子搭对了；实测 ${exported.size} 个`);
    assert.ok(/export function flushOutcomeText/.test(stripComments(index)), '★判据前提：读到的确实是接线层源码');
    const hits = bareRefs(index, exported);
    assert.deepEqual(hits.map((h) => `${h.name}@${h.line}`), [],
        '★★★接线层里这些名字被**裸引用**、且全文件没有任何出处 ⇒ 一调就 `ReferenceError: <名字> is not defined`'
        + '（若它还在一个 `catch` 后面，症状就是**静默失效**）：\n'
        + hits.map((h) => `   · \`${h.name}\`（住 ${h.files.join('、')}）@ web/index.js:${h.line}`).join('\n'));
});

// ─────────────────── ② 反向自证：口径必须"该红的红、该放的放" ───────────────────

test('★★★leg210②：反向自证——拿修复前的**真片段**喂它必须红，四种"有出处"的写法必须放行', () => {
    const EXPORTS = new Map([
        ['SW2_FLUSH_TRIES', ['web/hot-ledger.js']],
        ['resolveLimits', ['src/limits.js']],
        ['setSimulationBlocked', ['src/simulation-protection.js']],
        ['readHotMeta', ['web/hot-ledger.js']],
    ]);
    // ★这两条就是本棒修掉的**原样写法**（① 住模板插值里、② 住普通表达式里）
    const MUST_CATCH = {
        '① 模板插值里的裸引用（本棒现场）': 'const t = `账本被别的副本覆盖了（试了 ${SW2_FLUSH_TRIES} 次没抢回来）`;',
        '② 普通表达式里的裸引用（本棒第二处）': 'const n = Number(resolveLimits(world)?.往事轮数);',
    };
    for (const [why, src] of Object.entries(MUST_CATCH)) {
        const hits = bareRefs(src, EXPORTS);
        assert.equal(hits.length, 1, `★反向自证：${why} 必须被认出来（实际 ${hits.length} 命中）`);
    }
    // ★四种"有出处"的写法（都真的出现在接线层里）——一个都不许被咬
    const MUST_PASS = {
        'import 名单里有它': `import { SW2_FLUSH_TRIES } from './hot-ledger.js';\nconst t = \`试了 \${SW2_FLUSH_TRIES} 次\`;`,
        '受控口（成员访问）': 'const t = `试了 ${hotHub.flushTries()} 次`;',
        '对象字面量的键（同行）': 'const o = { setSimulationBlocked: (a) => a };',
        '对象字面量的键（多行）': 'const o = {\n        setSimulationBlocked: (a) => a,\n    };',
        '顶层解构取回': 'const { readHotMeta } = hotHub;\nconsole.log(readHotMeta());',
        '形参': 'function f(readHotMeta) { return readHotMeta; }',
        // ★两种"只是提到名字"的写法（文本，不是引用）——留字符串内容就会把它们误判成裸引用（假红）
        '普通字符串里提到它': "const s = 'resolveLimits 失败了';",
        '模板的字面量部分提到它': 'const s = `resolveLimits 没生效`;',
    };
    for (const [why, src] of Object.entries(MUST_PASS)) {
        assert.deepEqual(bareRefs(src, EXPORTS), [], `★负控：${why} 是有出处的 ⇒ 不许被咬（否则这条判据会把整个接线层判死）`);
    }
});

// ─────────────────── ③ 状态文本：每一种落盘结果都得给一句人话 ───────────────────

test('★★★leg210③：`flushOutcomeText` 每一支都必须给一句人话（含本棒的 `replaced`）', async () => {
    const mod = await import('../web/index.js');
    assert.equal(typeof mod.flushOutcomeText, 'function', '★它必须是能单独调的导出（否则这条判据咬不住）');
    const CASES = [
        [{ ok: true }, '已落盘'],
        [{ ok: true, queued: true }, '排队补落盘'],
        [{ ok: false, reason: 'timeout' }, '秒未返回'],
        [{ ok: false, reason: 'no-ctx' }, '拿不到聊天上下文'],
        [{ ok: false, reason: 'no-save-chat' }, '没有可用的保存入口'],
        [{ ok: false, reason: 'skipped' }, '疑似静默跳过'],
        [{ ok: false, reason: 'replaced' }, '被别的副本覆盖'],
        [{ ok: false, reason: 'stale-scope' }, '中途换了'],   // ★leg210b：它原先落到兜底那句「保存报错」（指错方向）
    ];
    for (const [r, want] of CASES) {
        let text = null, err = null;
        try { text = mod.flushOutcomeText(r); } catch (e) { err = e; }
        assert.equal(err, null,
            `★★reason=${r.reason ?? '(成功)'} 这一支**抛了**：\`${err && err.constructor.name}: ${err && err.message}\``
            + ' —— 异常抛在**求值状态文本**那一步 ⇒ 调用点之后的一切都被跳过，而玩家看到的只有外层 catch 那句天书');
        assert.ok(String(text).includes(want), `★reason=${r.reason ?? '(成功)'} 那句人话里要有「${want}」；实际：${text}`);
    }
    // ★本棒的现场：`replaced` 那句必须**带上次数**（走受控口取真源），且**不许**把 JS 的报错原话当人话印出去
    const replaced = mod.flushOutcomeText({ ok: false, reason: 'replaced' });
    assert.match(replaced, /试了 3 次没抢回来/, `★"试了 N 次"里的 N 必须是真的（SW2_FLUSH_TRIES = 3）；实际：${replaced}`);
    assert.ok(!/is not defined/.test(replaced), '★★不许把 `ReferenceError` 的原话印给玩家（TT/手机上没有控制台 ⇒ 天书且无从自救）');
    // ★宿主原话那一格（leg197）：`detail` 必须一路带到句子末尾
    assert.match(mod.flushOutcomeText({ ok: false, reason: 'throw', detail: '宿主报的那句原话' }), /宿主原话：宿主报的那句原话/,
        '★leg197：`detail`（宿主的原话）必须印出来——它存在的理由就是"没有控制台也能查"');
    // ★超时那句读的是**活值**（受控口），不是抄死在源码里的数字
    try {
        mod.sw2SetFlushTimeout(1234);
        assert.match(mod.flushOutcomeText({ ok: false, reason: 'timeout' }), /超过 1 秒未返回/,
            '★超时那句必须读 `hotHub.flushTimeoutMs()` 的**当时值**（改了档就要跟着变）');
    } finally {
        mod.sw2SetFlushTimeout(10_000);
    }
});

// ─────────────────── ④ 契约：族里新报一个 reason，状态文本就必须跟着学一句 ───────────────────

test('★★leg210④：热账能报的每一个 `reason`，状态文本都要接得住（新加的 reason 不许静默落到兜底）', async () => {
    const hot = stripComments(read('web/hot-ledger.js'), { keepStrings: true });   // ★要读 `reason: '…'` 的字面量
    const reasons = new Set([...hot.matchAll(/reason:\s*'([^']+)'/g)].map((m) => m[1]));
    // `lastErr` 那两处不是 `reason: '…'` 的字面量写法（一个是三元的产物、一个是重试环末尾的赋值）
    for (const n of ['skipped', 'throw', 'replaced']) reasons.add(n);
    // ★"落到兜底那句「保存报错」"的**只剩一类，而且是按设计**：宿主自己抛的错。
    //   ★其余 reason 一律要有自己的人话。leg210 那一棒把 `stale-scope` 记成"已知缺口"，
    //     **leg210b 补上了它的人话**（它不是说"保存报错"，是说"这一笔因为切了聊天而不再算数"）⇒
    //     这本账现在只剩按设计的那一条。
    const FALLBACK_BY_DESIGN = { throw: '宿主自己抛的错 ⇒ 兜底那句「保存报错」正好是它该说的话' };
    const mod = await import('../web/index.js');
    const fallback = mod.flushOutcomeText({ ok: false, reason: '这个 reason 谁都没见过' });
    assert.ok(reasons.size >= 5, `★判据前提：热账能报的 reason 要真的抽出来（实测 ${reasons.size}：${[...reasons].join('/')}）`);
    const loose = [];
    for (const reason of reasons) {
        const text = mod.flushOutcomeText({ ok: false, reason });
        if (text === fallback && !(reason in FALLBACK_BY_DESIGN)) loose.push(reason);
    }
    assert.deepEqual(loose, [],
        `★★热账新报了这些 reason，而状态文本只会说兜底那句「保存报错」⇒ 玩家拿到的是一个**说错方向**的提示：${loose.join('、')}\n`
        + '   （要么给它一句人话，要么写进 `FALLBACK_BY_DESIGN` 并说明为什么它就该用兜底那句）');
    // ★这份名单不许当垃圾桶：条目要少、且每条都得写明理由
    assert.ok(Object.keys(FALLBACK_BY_DESIGN).length <= 2,
        '★这份名单一旦开始长草，就说明"每个 reason 都要有人话"这条口径已经名存实亡');
    for (const [k, v] of Object.entries(FALLBACK_BY_DESIGN)) {
        assert.ok(v && v.length > 8, `★名单里的 \`${k}\` 必须写明为什么（不能只留个名字）`);
    }
});

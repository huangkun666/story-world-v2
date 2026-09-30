// story-world-v2/test/browser-load-graph.test.js
// ★★★leg154（**社区用户报的 bug** · 2026-09-30）：ST 报「扩展程序 "观棋窗口 (Story World v2)" 加载失败：[object Event]」。
//
// 那句话为什么什么也说明不了：ST 是用 `<script type="module" src=…>` 挂扩展的
//   （`public/scripts/extensions.js` 的 `addExtensionScript`），而它 `reject(err)` 交出去的是
//   **浏览器那个 error 事件本身** ⇒ 界面上只剩 `[object Event]`。凡是"模块图里有**任何一个**文件取不到"，
//   都长成这一句：装残缺、少提交一个文件、服务器上大小写对不上、老浏览器解析不了……全一个样。
//
// ★而本仓的判据**照不到这一类**：`node --test` 走的是 Node 的解析器——它在 **Windows 的盘**上跑，
//   于是 **①大小写**（`./Book.js` 指向 `book.js`：Windows 放过、Linux/安卓 404）与
//   **②"在盘上但没提交"**（本地 junction 照样跑，社区装到的那棵树里没有它）**两条全都测不出来**。
//   ⇒ 本判据把"浏览器真会去取的那张文件清单"**算出来**逐条核：存在、**逐字节大小写对得上**、**git 收了**。
//
// ★判据纪律：不许写死文件清单（清单跟着 import 现算）；自带反向自证（证明它真会咬，不是空绿）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SPEC = /(?:^|[\s;{}])(?:import|export)\s[^;'"`]*?from\s*['"]([^'"]+)['"]/g;

/** 一个文件里所有的静态 import/export-from 目标（字符串字面量，不追动态表达式） */
function specsOf(src) {
    return [...src.matchAll(SPEC)].map((m) => m[1]);
}

/**
 * 把 `fromRel` 里那条相对说明符还原成盘上的**真名**。
 * ★逐段拿回它所在的目录去比（`readdirSync` 给的是盘上真名）——**不许**用 `existsSync`：
 *   Windows/macOS 的盘不分大小写，`existsSync` 对 `./Book.js` 与 `./book.js` 都点头。
 * @returns {{rel:string}|{bad:{seg:string, dir:string, real:string[], missing:boolean}}}
 */
function resolveCaseExact(fromRel, spec) {
    const cleaned = spec.split('?')[0].split('#')[0];
    const joined = path.normalize(path.join(path.dirname(fromRel), cleaned)).replace(/\\/g, '/');
    const segs = joined.split('/').filter(Boolean);
    let cur = '';
    for (const seg of segs) {
        const dir = cur ? path.join(ROOT, cur) : ROOT;
        let real = [];
        try { real = readdirSync(dir); } catch { real = []; }
        if (!real.includes(seg)) {
            return { bad: { seg, dir: cur || '.', real: real.filter((r) => r.toLowerCase() === seg.toLowerCase()), missing: real.length === 0 } };
        }
        cur = cur ? `${cur}/${seg}` : seg;
    }
    return { rel: cur };
}

/** 从入口把整张图走一遍（入口 = `manifest.json` 的 `js`，那是 ST 唯一会挂的那个文件） */
function walkGraph(entry) {
    const seen = new Set();
    const queue = [entry];
    const edges = [];
    const bad = [];
    const bare = [];
    while (queue.length) {
        const rel = queue.shift();
        if (seen.has(rel)) continue;
        seen.add(rel);
        const abs = path.join(ROOT, rel);
        if (!existsSync(abs)) { bad.push({ from: '(入口)', spec: rel, seg: path.basename(rel), dir: path.dirname(rel), real: [], missing: true }); continue; }
        const src = readFileSync(abs, 'utf8');
        for (const spec of specsOf(src)) {
            if (!spec.startsWith('.')) { bare.push(`${rel} → ${spec}`); continue; }
            const got = resolveCaseExact(rel, spec);
            if (got.bad) { bad.push({ from: rel, spec, ...got.bad }); continue; }
            edges.push(`${rel} → ${got.rel}`);
            if (!seen.has(got.rel)) queue.push(got.rel);
        }
    }
    return { seen, edges, bad, bare };
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const graph = walkGraph(manifest.js);

/** git 收了哪些文件（★不在 git 工作树里 ⇒ 交 null，那一半跳过：发布导出件本来就不是仓库） */
function trackedFiles() {
    try {
        const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (inside !== 'true') return null;
        return new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
            .split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/')));
    } catch { return null; }
}

// ─────────────────── ① 图是走得到的 ───────────────────

test('★★★leg154·浏览器载入图①：入口与它的整张图**每个文件都在盘上、大小写逐字节对得上**', () => {
    assert.ok(manifest.js && manifest.css, 'ST 靠 manifest.json 的 js/css 找文件 ⇒ 两个键都必须在');
    for (const f of [manifest.js, manifest.css]) {
        assert.ok(existsSync(path.join(ROOT, f)), `★manifest 指的 ${f} 必须在盘上（真名）`);
    }
    assert.equal(graph.bad.length, 0,
        '★★★有文件取不到 ⇒ 浏览器那一整张模块图**全废**，而 ST 只报得出 `[object Event]`（社区用户就是这么被卡住的）：\n'
        + graph.bad.map((b) => `   ${b.from} → ${b.spec}｜在 ${b.dir}/ 下找不到 ${b.seg}`
            + (b.real.length ? `（盘上的真名是 ${b.real.join(' / ')} ⇒ 大小写对不上）` : '（这一层根本没有它）')).join('\n'));
    assert.ok(graph.seen.size >= 20, `★图至少该有 20 个模块（实际 ${graph.seen.size}）——数字突然变小 ⇒ 入口被换掉了`);
    assert.ok(graph.seen.has('web/index.js'), '★入口必须在图里');
    assert.ok(graph.seen.has('src/pack.js') && graph.seen.has('src/render.js'), '★引擎与渲染那两个大头必须在图里');
    // ★源码在 `src/` 与 `web/` 之外（`test/`、`demo/`、`scripts/`）的文件**绝不进这张图**
    for (const rel of graph.seen) {
        assert.ok(rel.startsWith('web/') || rel.startsWith('src/'),
            `★浏览器那张图里混进了 ${rel} —— 非 web/src 的东西不该被浏览器加载`);
    }
});

// ─────────────────── ② 图里的文件必须真被提交 ───────────────────

test('★★leg154·浏览器载入图②：图上每个文件都必须**被 git 收了**（本地 junction 会放过"没提交"）', () => {
    const tracked = trackedFiles();
    if (tracked === null) {
        // 发布导出件里没有 .git ⇒ 那一半跳过（导出件里"存在"本身就等于"在树里"）
        assert.ok(true, '不在 git 工作树里（发布导出件的情形）⇒ 这一半跳过');
        return;
    }
    const missing = [...graph.seen].filter((rel) => !tracked.has(rel));
    assert.deepEqual(missing, [],
        '★★★这些文件在盘上、却**没被 git 收**：本地 junction 照样跑，而社区装到的那棵树里**没有它** ⇒ '
        + '整张模块图断 ⇒ ST 报 `[object Event]`（`.gitignore` 咬到、或忘了 `git add`）：\n'
        + missing.map((m) => `   ${m}`).join('\n'));
});

// ─────────────────── ③ 浏览器那张图里不许有裸模块名 ───────────────────

test('★leg154·浏览器载入图③：图里零裸模块名（本插件零依赖、浏览器没有 node_modules 可查）', () => {
    assert.deepEqual(graph.bare, [],
        '★浏览器侧 import 一个裸模块名（非 `./` `../` 开头）⇒ 解析不到，整张图废。命中：\n'
        + graph.bare.map((b) => `   ${b}`).join('\n'));
});

// ─────────────────── ④ 反向自证：这两条判据真会咬 ───────────────────

test('★leg154·浏览器载入图④（反向自证）：换错大小写 / 指向不存在的文件，都必须当场被抓', () => {
    // ★为什么必须自带这一条：Windows 的盘对大小写是**放过**的（`import './INDEX.JS'` 照样跑通），
    //   所以"检查器到底咬不咬大小写"必须自己证明一次，否则上面第 ① 条可能只是空绿。
    const wrongCase = resolveCaseExact('web/index.js', './INDEX.JS');
    assert.ok(wrongCase.bad, '★大小写对不上必须被抓（Windows 会放过它，Linux/安卓上就是 404）');
    assert.equal(wrongCase.bad.seg, 'INDEX.JS');
    assert.deepEqual(wrongCase.bad.real, ['index.js'], `★还要指出盘上的真名；实际：${JSON.stringify(wrongCase.bad.real)}`);
    // 盘上**真有**这个文件（`existsSync` 会点头）⇒ 证明上面那条不是靠"文件不存在"骗过去的
    assert.ok(existsSync(path.join(ROOT, 'web', 'INDEX.JS')) || existsSync(path.join(ROOT, 'web', 'index.js')),
        '★反向自证的立足点：`web/index.js` 确实在盘上（错的只是大小写）');
    const nope = resolveCaseExact('web/index.js', './nope-not-here.js');
    assert.ok(nope.bad && nope.bad.missing === false, '★指向不存在的文件必须被抓，且要区分于"目录都读不到"');
    // 真的那条必须过（否则上面全是"一律判红"的假咬）
    const ok = resolveCaseExact('web/index.js', './book-source.js');
    assert.equal(ok.rel, 'web/book-source.js', '★正确的说明符必须原样通过');
    const up = resolveCaseExact('web/index.js', '../src/pack.js');
    assert.equal(up.rel, 'src/pack.js', '★跨目录（../src/）也要解得对');
});

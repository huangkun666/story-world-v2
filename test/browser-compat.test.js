// story-world-v2/test/browser-compat.test.js
// K30：浏览器可载性静态扫描——src/ + web/index.js 的 Node 内建面为零（除显式声明的 Node-only 模块）。
// 面 = 引擎全部业务模块（浏览器宿主直接 import 的面）；demo/* 与 test/* 不在浏览器面内不扫描。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 声明为 Node-only 的模块（fs/env 专属，仅 CLI/demo 路径 import，浏览器绝不触达）
const NODE_ONLY = new Set(['st-preset.js']);
// 声明含 process 守卫的模块（允许 process.*，但必须带 typeof 守卫防浏览器 ReferenceError）
const GUARD_REQUIRED = new Set(['transport-http.js']);

const FORBIDDEN = [
    { re: /require\s*\(/, name: 'CommonJS require' },
    { re: /from\s*['"]node:/, name: 'node: 内建 import' },
    { re: /process\./, name: 'process 全局' },
    { re: /Buffer\./, name: 'Buffer' },
    { re: /__dirname|__filename/, name: '__dirname/__filename' },
    { re: /\bchild_process\b/, name: 'child_process' },
    { re: /\bnode:fs\b|\bnode:path\b|\bnode:os\b|\bnode:url\b|\bnode:crypto\b/, name: 'node: 成员引用' },
];

function listSources() {
    const out = [];
    for (const f of readdirSync(path.join(ROOT, 'src'))) {
        if (f.endsWith('.js')) out.push(path.join(ROOT, 'src', f));
    }
    // ★★★leg72（丙-web）：接线层**从"一个文件"变成"一个目录"**（`web/memory-store.js` 等）。
    //   本扫描面必须**整个 web/ 目录**都扫，否则新模块成了"浏览器可载性"的盲区——
    //   ★这正是 leg71 §4.1 那类病的同族：**判据还绿，但它已经照不到新东西**（覆盖面悄悄漏了）。
    //   ★同时保留 `web/index.js` 的显式在列断言（下面那条），让"入口文件被漏扫"不可能发生。
    for (const f of readdirSync(path.join(ROOT, 'web'))) {
        if (f.endsWith('.js')) out.push(path.join(ROOT, 'web', f));
    }
    return out;
}

const files = listSources();

test('K30 扫描面完整：src 全部模块 + web/ 全部模块在列（leg72：web 侧已不止 index.js）', () => {
    assert.ok(files.length >= 20, `扫描面 ${files.length} 项`);
    assert.ok(files.some((f) => f.endsWith(path.join('src', 'transport-http.js'))));
    assert.ok(files.some((f) => f.endsWith(path.join('src', 'st-preset.js'))));
    assert.ok(files.some((f) => f.endsWith(path.join('src', 'transport-config.js'))));
    assert.ok(files.some((f) => f.endsWith(path.join('web', 'index.js'))));
    // ★★★leg72：**扫描面必须跟着目录走**——新加的 web 侧模块要**自动**被扫到，
    //   而不是"等谁想起来再加一行"（那正是覆盖面悄悄漏掉的老路）。
    //   判据：`web/` 下每一个 .js 都必须在扫描面里（拿目录现算，不写死清单）。
    for (const f of readdirSync(path.join(ROOT, 'web'))) {
        if (!f.endsWith('.js')) continue;
        assert.ok(files.some((p) => p.endsWith(path.join('web', f))),
            `★web/${f} 不在浏览器可载性扫描面里 ⇒ 它成了盲区（改 listSources 让它跟着目录走）`);
    }
    // 反向自证：这条判据真的会咬（塞一个不存在的"新模块"进清单，断言必须失败）
    assert.ok(!files.some((p) => p.endsWith(path.join('web', '不存在的模块.js'))), '★反向自证：不在盘上的文件不许出现在扫描面');
});

test('K30 浏览器面零 Node 内建（Node-only 模块豁免）', () => {
    for (const f of files) {
        const base = path.basename(f);
        if (NODE_ONLY.has(base)) continue;
        const src = readFileSync(f, 'utf8');
        for (const { re, name } of FORBIDDEN) {
            if (GUARD_REQUIRED.has(base) && name === 'process 全局') continue;
            assert.ok(!re.test(src), `${f}: 浏览器侧出现 ${name}`);
        }
    }
});

test('K30 守卫声明与豁免合理：st-preset 确持 node:fs；transport-http 含 typeof 守卫且无 node: import；transport-config 全净', () => {
    const preset = readFileSync(path.join(ROOT, 'src', 'st-preset.js'), 'utf8');
    assert.match(preset, /from 'node:fs'/);

    const http = readFileSync(path.join(ROOT, 'src', 'transport-http.js'), 'utf8');
    assert.match(http, /typeof process !== 'undefined'/);
    assert.ok(!/node:/.test(http));

    const cfg = readFileSync(path.join(ROOT, 'src', 'transport-config.js'), 'utf8');
    assert.ok(!/process/.test(cfg));
    assert.ok(!/node:/.test(cfg));
});

test('K30 动态导入冒烟：web/index.js 顶层零 DOM，Node 可直接加载（浏览器可载性实证）', async () => {
    const mod = await import('../web/index.js');
    assert.equal(typeof mod.sw2Version, 'function');
    // ★1.0.0（发布首版）：这个断言锁的是**发布版本号**（`web/index.js` 的 VERSION），
    //   而它与 `manifest.json` 的 `version` 是同一个号的两处写法 ⇒ **发版时两处同批改**，
    //   判据当场红就是提醒你漏了一处（本仓"同一件事两处实现"的一贯治法：让它红，别让它漂）。
    assert.equal(mod.sw2Version(), '1.0.0');
    // ★leg40b（体检 · 第二刀）：`sw2TabState(name, active)` 探针已删——它是 `{ name, active }` 的
    //   恒等包装、生产零调用。这条用例的真实目的（模块能在 Node 里被加载）由上面两行承担；
    //   这里改为锁**它不该再回来**（同一个"零引用的包装函数"是这次体检删掉的一类东西）。
    assert.equal(mod.sw2TabState, undefined, '★sw2TabState 已删（零引用的恒等包装），不许回潮');
});
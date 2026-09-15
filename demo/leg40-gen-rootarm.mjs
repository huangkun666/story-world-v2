// story-world-v2/demo/leg40-gen-rootarm.mjs
// leg40 第二个变体族（**全部落在系统 TEMP，仓库一个字节不动**）：治"起了根没人浇"。
//
// 病灶（本棒实测）：真账 59 轮里模型自己起过 **9 条**"无来路"的线头（慈航医堡/截教/黑山老妖/天机阁主…），
//   形状完全合格（各有地点、各有人），但**下一轮一条都没被接续**——全黏回那场大乱。9 轮对跑同款：
//   trim 臂 8 轮起 8 条新线、**有 ref 锚的 0 条** ⇒ 8 颗种子、一条都没接上。
//   ⇒ 缺口不是"起根能力"，是**起了根之后没台账、也没规矩回头看**（那 9 条混在 31 条未决事件里，
//     外观与那场大乱的 14 条分支完全一样）。
//
// 两个臂（同一份真账、同起点、承重墙零改动）：
//   · `--arm promptonly`：**只加规矩**——把"线头"这件事写进提示词（把那些没有来路的未决事件，
//        每轮挑一条往下写一步）。零新增数据、零新增调用、零 token 成本。
//   · `--arm promptlist`：**规矩 + 台账**——再把"起了根还没人接的那几条"单独列一栏（`openRoots`）
//        递进包里，让模型看得见是哪几条（照 `idleFaces` 的成法：名单必须递到眼前才有人用）。
//
// 实现（与 leg36–leg39 同一套）：TEMP 里生成
//   · pack.js 副本 —— 插一栏 `openRoots`（机械筛"无来路未决事件"，只报 id/title/position/ripples 人数）
//   · prompts.js 副本 —— 在提示词末尾附一段臂专属规矩
//   · loader.mjs —— 把 `src/pack.js`、`src/prompts.js` 重定向到副本（相对导入用 pathToFileURL 指回 src/）
//
// 用法：node demo/leg40-gen-rootarm.mjs            → 打印 SW2_TMP=<目录>
//   node demo/run-leg40-variant.mjs <SW2_TMP> --arm promptonly  --ticks 8 --out F:/deepseek/tmp/leg40-p1.json
//   SW2_ROOT_ARM=promptlist …               --arm promptlist --ticks 8 --out F:/deepseek/tmp/leg40-p2.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = join(tmpdir(), `sw2-leg40r-${Date.now()}`);
mkdirSync(OUT, { recursive: true });

const packSrc = readFileSync(new URL('../src/pack.js', import.meta.url), 'utf8');
const promptSrc = readFileSync(new URL('../src/prompts.js', import.meta.url), 'utf8');

// ---------- ① pack.js 副本：插 openRoots 一栏（+ threads 臂的"线捆"那一栏） ----------
const PACK_ANCHOR = '    const pack = {\n        world: ssot.context?.world,';
if (!packSrc.includes(PACK_ANCHOR)) { console.error('✗ pack.js 接线点没找到——拒绝生成'); process.exit(2); }
// 插在 buildEvolutionPack 里（pack 对象字面量之前），并在对象字面量末尾加一栏。
// ★为什么在函数体内算而不在模块顶层：它要读 `ssot`（那一轮的世界）。
const PACK_INSERT = `    // ★leg40 变体（TEMP 副本）：**线头台账**——"起了根、但还没人接"的未决事件（无来路者）。
    //   口径全机械：未决事件里，source.ref 不指向池内事件/盘算（或压根没 ref）的那个集合。
    //   ★为什么必须有这一栏：那几条混在 31 条未决事件里，外观与那场大乱的分支**完全一样**
    //     ⇒ 模型认不出"哪条是我上轮自己起的、还没人接"（实测：59 轮起过 9 条，0 条被接续）。
    let __sw2OpenRoots;
    let __sw2Threads;
    if (globalThis.__SW2_ROOT_LIST__ || globalThis.__SW2_ROOT_ARM__ === 'threads') {
        const openEv = (ssot.events || []).filter((e) => !e.closed);
        const evIds = new Set(openEv.map((e) => e.id));
        const agIds = new Set((ssot.agendas || []).map((a) => a.id));
        __sw2OpenRoots = openEv
            .filter((e) => !e.source?.ref || !(evIds.has(e.source.ref) || agIds.has(e.source.ref)))
            .map((e) => ({ id: e.id, title: e.title, position: e.position, ripples: (e.ripples || []).length }));
    }
    // ★threads 臂：把线头**分捆**，并按"新颖度"机械排序（不含危机地名的排前面）——
    //   目的：让"一轮并推多条线"这件事有**明确的收件人**（而不是让模型自己在 13 条里挑）。
    if (globalThis.__SW2_ROOT_ARM__ === 'threads') {
        const nameOf = (id) => (ssot.entities || []).find((x) => x.id === id)?.name || id;
        const CRISIS_PLACE = /大荒|北山|南荒部洲|幽冥|南疆/;
        __sw2Threads = (__sw2OpenRoots || [])
            .map((r) => ({ ...r, people: ((ssot.events || []).find((e) => e.id === r.id)?.ripples || []).map(nameOf) }))
            .map((r) => ({ ...r, novelty: (CRISIS_PLACE.test(String(r.position)) ? 0 : 1) }))
            .sort((a, b) => b.novelty - a.novelty || String(a.id).localeCompare(String(b.id)))
            .slice(0, 3)
            .map((r) => ({ id: r.id, title: r.title, position: r.position, people: r.people }));
    }
    const pack = {
        world: ssot.context?.world,`;
const packCopy = packSrc.replace(PACK_ANCHOR, PACK_INSERT)
    .replace(
        '        idleFaces,\n    };',
        '        idleFaces,\n        // ★leg40 变体：线头台账 / 线捆（未开这一臂时是 undefined ⇒ 键不出现，与原文同行为）\n        openRoots: __sw2OpenRoots,\n        threads: __sw2Threads,\n    };',
    );
if (!packCopy.includes('__sw2OpenRoots') || !packCopy.includes('threads: __sw2Threads')) { console.error('✗ pack 副本形状不对——拒绝生成'); process.exit(2); }

// ---------- ② prompts.js 副本：附臂专属规矩 ----------
const PROMPT_ARM = [
    '【本回合的额外规矩 · 线头】上面的未决事件里，有几条是"起了头、后面还没人接着办"的线（它们没有来路——不是谁在办的事、也不是别的事的余波）。',
    '这些线头**不是背景**，是这个世界上还没被写下去的另一条线：**本回合至少挑一条，把它往下写一步**（用 plot 或 ripple 挂到它自己身上，让下一轮还接得上）。',
    '★不要把它们都收进"那一场"里：线头自己的地点与人是谁，就写谁的事。',
].join('');
const PROMPT_ARM_LIST = [
    '【本回合的额外规矩 · 线头台账】输入里的 openRoots 就是**"起了头、后面还没人接着办"的线**（引擎机械筛出来的：没有来路——不是谁在办的事、也不是别的事的余波）。',
    '这些线头**不是背景**，是这个世界上还没被写下去的另一条线：**本回合至少挑其中一条，把它往下写一步**（用 plot 或 ripple 挂到它自己身上，让下一轮还接得上）。',
    '★每一轮都要看一眼 openRoots：上一轮你写过的线头若还在里面，说明它还没被接上，接着写它——**线要连着走，不能起了就扔**。',
    '★不要把它们都收进"那一场"里：线头自己的地点与人是谁，就写谁的事。',
].join('');
// ★threads 臂（本棒最后一跑）：**一轮调用，并推多条线**。
//   输入侧：把线头**分捆**（`threads` 一栏：每条线头 = 它自己 + 自己的人 + 自己的地点）；
//   输出侧：把"至少挑一条"改成"**上面那几条，本回合每条各写一步**"。
//   为什么这么设计（读数依据）：16 个臂、每轮新事件 2–5 件（一次调用写多件事它一直在做），
//   但**每轮新起的主线永远是 1 条**；闸（perTick 3 / 事件 6）从没咬到，瓶颈在"输入形状 + 输出要求"。
const PROMPT_ARM_THREADS = [
    '【本回合的额外规矩 · 并推多条线】输入里的 threads 是引擎挑出来的**几条独立的线**（每条自带：它自己的地点、它自己的人、它此刻的那一步）。',
    '★**本回合这几条线，每条各写一步**——每条线都要出一件**新的未决事件**，用 source.type="ripple" + ref= 那条线头的 id（或先为它起一条盘算，再用 plot 挂上）。',
    '★**不许把它们合并**：不要把三条线写成同一件事的三个角度，也不要让它们都卷进同一个地点——那是"假并行"。',
    '★**不许只写一条**：三条里只推一条 = 本轮不合格。三条各自的地点与人是谁，就写谁的事。',
].join('');
// 接线点：把 pack 序列化进提示词的唯一出口（`${pack.text}`）
const PROMPT_ANCHOR = '${pack.text}`;';
if (!promptSrc.includes(PROMPT_ANCHOR)) { console.error('✗ prompts.js 接线点没找到——拒绝生成'); process.exit(2); }
const promptCopy = promptSrc.replace(
    'export function assembleMainPrompt(pack) {\n    return `${MAIN_PROMPT}\\n\\n${ENTITY_TABLE_LEGEND}\\n\\n【世界状态与落子事实】\\n${pack.text}`;',
    'export function assembleMainPrompt(pack) {\n    const __arm = globalThis.__SW2_ROOT_ARM__;\n    const __extra = __arm === \'promptlist\' ? globalThis.__SW2_ROOT_TEXT_LIST__\n        : (__arm === \'threads\' ? globalThis.__SW2_ROOT_TEXT_THREADS__ : (__arm ? globalThis.__SW2_ROOT_TEXT__ : \'\'));\n    return `${MAIN_PROMPT}\\n\\n${ENTITY_TABLE_LEGEND}\\n\\n【世界状态与落子事实】\\n${pack.text}` + (__extra ? `\\n\\n${__extra}` : \'\');',
);
if (!promptCopy.includes('__SW2_ROOT_ARM__') || !promptCopy.includes('__SW2_ROOT_TEXT_THREADS__')) { console.error('✗ prompts 副本形状不对——拒绝生成'); process.exit(2); }

writeFileSync(join(OUT, 'pack.base.js'), packSrc, 'utf8');
writeFileSync(join(OUT, 'pack.roots.js'), packCopy, 'utf8');
writeFileSync(join(OUT, 'prompts.base.js'), promptSrc, 'utf8');
writeFileSync(join(OUT, 'prompts.roots.js'), promptCopy, 'utf8');

// ---------- ③ loader：按 SW2_ROOT_ARM 重定向两个模块 ----------
const loader = `// leg40 线头臂 loader（TEMP）——重定向 src/pack.js 与 src/prompts.js
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ARM = process.env.SW2_ROOT_ARM || '';           // '' | promptonly | promptlist
const SELF = fileURLToPath(new URL('./', import.meta.url));
const SRC = 'F:/deepseek/plugins/story-world-v2/src/';
const T_PACK = fileURLToPath(new URL(ARM ? './pack.roots.js' : './pack.base.js', import.meta.url));
const T_PROMPT = fileURLToPath(new URL(ARM ? './prompts.roots.js' : './prompts.base.js', import.meta.url));
if (ARM) {
    globalThis.__SW2_ROOT_ARM__ = ARM;
    globalThis.__SW2_ROOT_LIST__ = ARM === 'promptlist' || ARM === 'threads';
}
const TEXT = ${JSON.stringify(PROMPT_ARM)};
const TEXT_LIST = ${JSON.stringify(PROMPT_ARM_LIST)};
const TEXT_THREADS = ${JSON.stringify(PROMPT_ARM_THREADS)};
globalThis.__SW2_ROOT_TEXT__ = TEXT;
globalThis.__SW2_ROOT_TEXT_LIST__ = TEXT_LIST;
globalThis.__SW2_ROOT_TEXT_THREADS__ = TEXT_THREADS;
registerHooks({
    resolve(spec, ctx, next) {
        let s = spec;
        const from = ctx && ctx.parentURL ? ctx.parentURL : '';
        if (s.startsWith('./') && from.startsWith('file:') && fileURLToPath(from).startsWith(SELF)) s = new URL(spec, pathToFileURL(SRC)).href;
        const r = next(s, ctx);
        if (!r || typeof r.url !== 'string') return r;
        if (r.url.endsWith('/src/pack.js')) return { ...r, url: pathToFileURL(T_PACK).href, shortCircuit: true };
        if (r.url.endsWith('/src/prompts.js')) return { ...r, url: pathToFileURL(T_PROMPT).href, shortCircuit: true };
        return r;
    },
    load(url, ctx, next) {
        if (url.startsWith('file:') && fileURLToPath(url).startsWith(SELF) && url.endsWith('.js')) {
            const body = readFileSync(fileURLToPath(url), 'utf8');
            const flags = [];
            if (ARM) {
                flags.push('globalThis.__SW2_ROOT_ARM__ = ' + JSON.stringify(ARM) + ';');
                flags.push('globalThis.__SW2_ROOT_LIST__ = ' + (ARM === 'promptlist' || ARM === 'threads') + ';');
                flags.push('globalThis.__SW2_ROOT_TEXT__ = ' + JSON.stringify(TEXT) + ';');
                flags.push('globalThis.__SW2_ROOT_TEXT_LIST__ = ' + JSON.stringify(TEXT_LIST) + ';');
                flags.push('globalThis.__SW2_ROOT_TEXT_THREADS__ = ' + JSON.stringify(TEXT_THREADS) + ';');
            }
            return { format: 'module', source: flags.join('\\n') + '\\n' + body, shortCircuit: true };
        }
        return next(url, ctx);
    },
});
`;
writeFileSync(join(OUT, 'loader.mjs'), loader, 'utf8');

console.log(`SW2_TMP=${OUT}`);
console.log(`pack 副本 ${packSrc.length} → ${packCopy.length}（+${packCopy.length - packSrc.length}）· prompts 副本 ${promptSrc.length} → ${promptCopy.length}（+${promptCopy.length - promptSrc.length}）`);
console.log(`  自证：pack 有 openRoots=${packCopy.includes('openRoots: __sw2OpenRoots')} · prompts 有臂分支=${promptCopy.includes('__SW2_ROOT_ARM__')}`);

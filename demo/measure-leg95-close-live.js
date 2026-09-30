// story-world-v2/demo/measure-leg95-close-live.js
// leg95 · 只读回测：把真账里"还开着"的事端给模型，看它判不判"该结束了"。
//   ★零引擎改动、零落盘：只读两份导出，照着 settle.js 的口径自己算"还开着"，问模型，打印结果。
//   同一个账、同一批事，两种问法**并排对照**（这是本装置唯一要回答的问题）：
//     问法 A「讲完了没有」（叙事）  vs  问法 B「还用不用接着提」（在办/搁置）
//   为什么并排：模型管收场是"判语义"，而语义有两种可能的意思——不并排就分不清它答的是哪一种。
//
// 运行：node demo/measure-leg95-close-live.js
import fs from 'node:fs';
import { resolveWorldTransport } from '../src/st-preset.js';
import { CHAIN_SETTLE } from '../src/settle.js';

const FILES = [
    ['A(60轮)', 'C:/Users/30319/Downloads/story-world-v2-export.json'],
    ['B(11轮)', 'C:/Users/30319/Downloads/story-world-v2-export (1).json'],
].filter(([tag]) => !process.env.ONLY || tag.startsWith(process.env.ONLY));
const born = (id) => { const m = /^ev_(\d+)_/.exec(String(id)); return m ? Number(m[1]) : 0; };

const FRAMINGS = [
    {
        key: 'A',
        title: '问法 A · 讲完了没有（叙事口径）',
        rule: '一条"事"该结束了，意思是：**这件事在世界里已经讲完了**——该发生的都发生了，它的后果也已经落定或被人接管，没有谁还在这件事上做事。反过来，只要账上还有谁在接着它做事，或者它掀起的动静还没落定，它就还没讲完。',
    },
    {
        key: 'B',
        title: '问法 B · 还用不用接着提（在办／搁置口径）',
        rule: '一条"事"该结束了，意思是：**它已经从"眼下的事"变成"过去的事"**——世界现在往前看的时候不再需要把它摆在台面上接着处理它了（事情本身是什么结局不重要，重要的是它不再占着"正在办"的位置）。反过来，只要它还是眼下局面的一部分，就还没结束。',
    },
];

function openEvents(world) {
    const evs = world.events;
    const byId = new Map(evs.map((e) => [e.id, e]));
    const ent = new Map((world.entities || []).map((e) => [e.id, e]));
    const ag = new Map((world.agendas || []).map((a) => [a.id, a]));
    const tick = world.meta.tick;
    const name = (id) => ent.get(id)?.name || String(id);
    return evs.filter((e) => !e.closed).map((e) => {
        const s = e.source || {};
        let why;
        if (s.type === 'seed') why = '这件事是书里早就埋着的（开局就在那儿）';
        else if (s.type === 'state') why = '这件事是当时的局面自己拱出来的';
        else if (s.type === 'plot') { const a = ag.get(s.ref); why = `这件事是${a?.owner ? `${name(a.owner)}的` : ''}打算「${a?.goal || s.ref}」推出来的`; }
        else if (s.type === 'ripple') { const u = byId.get(s.ref); why = u ? `这件事是接着「${u.title}」长出来的` : '这件事是接着更早的一件事长出来的'; }
        else why = '这件事的来路账上没记';
        const kids = evs.filter((x) => (x.links?.up || []).includes(e.id)).map((x) => x.title);
        return {
            id: e.id, title: e.title, at: e.position || '未明',
            who: (e.ripples || []).map(name), why, born: born(e.id), age: tick - born(e.id),
            kids, seedLike: s.type === 'seed' || s.type === 'state',
        };
    }).sort((a, b) => a.born - b.born || String(a.id).localeCompare(String(b.id)));
}

function buildPrompt(world, items, framing) {
    const tick = world.meta.tick;
    const lines = items.map((x) => [
        `- ${x.id}  「${x.title}」`,
        `    第 ${x.born} 轮发生（距今 ${x.age} 轮）· 发生在 ${x.at}`,
        `    牵动过：${x.who.length ? x.who.join('、') : '账上没记'}`,
        `    来路：${x.why}`,
        x.kids.length ? `    ★已经有 ${x.kids.length} 件新事是接着它长出来的：${x.kids.slice(0, 4).join('、')}${x.kids.length > 4 ? ' 等' : ''}` : '    ★目前没有任何新事是接着它长出来的',
    ].join('\n')).join('\n');

    return `你是这个世界的作者。世界已经走到第 ${tick} 轮。下面这些事**都发生过**（它们不是"正在发生"，是已经落账的事），账上把它们列在"还没结束"里，我需要你判一遍：**哪些该从"还没结束"里拿出来了。**

${framing.rule}

判的时候守住三条：
1. 只判下面列出来的这些事，一件都不要多加。
2. 已经"结束"的**不要求它有个圆满结局**——半途而废、被更大的事盖过去、不了了之，都算结束。
3. 拿不准的**就不要列**。宁可少列（我下一轮还会再问一次），也不要为了凑数把还在台上的事按下去。

下面是要判的事（共 ${items.length} 件）：

${lines}

只回一个 JSON，不要任何别的字：
{"close":[{"event":"照抄上面那个编号","why":"一句话：为什么它已经结束了"}]}
（如果一件都不该结束，就回 {"close":[]}）`;
}

function parseClosures(text) {
    const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
    if (!m) return { error: '没有 JSON' };
    let obj;
    try { obj = JSON.parse(m[0]); } catch (e) { return { error: `JSON 解析失败：${e.message}` }; }
    const arr = Array.isArray(obj?.close) ? obj.close : null;
    if (!arr) return { error: '没有 close 数组' };
    return { close: arr.map((x) => ({ event: String(x?.event ?? '').trim(), why: String(x?.why ?? '').trim() })).filter((x) => x.event) };
}

const resolved = resolveWorldTransport();
if (!resolved) { console.error('未找到模型配置（env 或酒馆预设）'); process.exit(1); }
console.log(`模型：${resolved.model}（来源 ${resolved.source}）\n`);

// ★★一处真踩过的坑（留档，免得下一任再踩）：`transport(prompt)` **直接返回字符串**
//   （`transport-http.js` 返回 `data.choices[0].message.content`），**不是 `{text}` 对象**——
//   第一版照 `.text` 读 ⇒ 每次都得到 `undefined` ⇒ 打印"调用失败：没有 JSON"，白跑三次调用。
//   现在两侧都认（字符串 / `{text}`），并把原始长度与结尾打出来（空回话与截断当场看得见）。
async function callModel(prompt) {
    const raw = await resolved.transport(prompt);
    const text = typeof raw === 'string' ? raw : (raw?.text ?? '');
    return { text: String(text ?? '') };
}

for (const [tag, file] of FILES) {
    if (!fs.existsSync(file)) { console.log(`（跳过 ${tag}：找不到 ${file}）`); continue; }
    const world = JSON.parse(fs.readFileSync(file, 'utf8')).world;
    const items = openEvents(world);
    const openIds = new Set(items.map((x) => x.id));
    console.log(`\n${'='.repeat(72)}\n${tag} · tick=${world.meta.tick} · 还开着 ${items.length} 件（种/境开头的 ${items.filter((x) => x.seedLike).length} 件）\n${'='.repeat(72)}`);

    for (const f of FRAMINGS) {
        const t0 = Date.now();
        let out;
        try { out = await callModel(buildPrompt(world, items, f)); }
        catch (e) { console.log(`\n【${f.title}】调用失败：${e?.message || e}`); continue; }
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        const p = parseClosures(out.text);
        console.log(`\n【${f.title}】${secs}s · 回话 ${out.text.length} 字符`);
        if (p.error) {
            console.log(`  ✗ ${p.error}`);
            console.log(`    空回话？${out.text.length === 0 ? '是——模型没吐内容（推理占了预算或提示词过长）' : '否'}`);
            if (out.text.length) console.log(`    回话前 300 字：${out.text.slice(0, 300)}`);
            continue;
        }
        const valid = p.close.filter((c) => openIds.has(c.event));
        const bogus = p.close.filter((c) => !openIds.has(c.event));
        const dup = valid.length !== new Set(valid.map((c) => c.event)).size;
        console.log(`  提出收场 ${p.close.length} 件 ⇒ 号在册且还开着 **${valid.length}** · 号对不上 ${bogus.length}${dup ? ' · 有重复' : ''}`);
        const byKind = { seed: 0, state: 0, plot: 0, ripple: 0 };
        for (const c of valid) { const it = items.find((x) => x.id === c.event); const t = world.events.find((e) => e.id === c.event)?.source?.type; if (t in byKind) byKind[t]++; void it; }
        console.log(`    其中来路：种子 ${byKind.seed} · 处境 ${byKind.state} · 谋划 ${byKind.plot} · 承接上文 ${byKind.ripple}`);
        const young = valid.filter((c) => (items.find((x) => x.id === c.event)?.age ?? 99) < CHAIN_SETTLE);
        console.log(`    ★其中"还很年轻"（落账不足 ${CHAIN_SETTLE} 轮）的：${young.length} 件${young.length ? ` —— ${young.map((c) => c.event).join(', ')}` : ''}`);
        const growing = valid.filter((c) => (items.find((x) => x.id === c.event)?.kids.length ?? 0) > 0);
        console.log(`    ★其中"还有新事接着它长"的：${growing.length} 件${growing.length ? ` —— ${growing.map((c) => { const it = items.find((x) => x.id === c.event); return `${c.event}「${it.title}」（下挂 ${it.kids.length} 件）`; }).join(' · ')}` : ''}`);
        for (const c of p.close.slice(0, 60)) {
            const it = items.find((x) => x.id === c.event);
            console.log(`      ${openIds.has(c.event) ? '✓' : '✗'} ${c.event}${it ? ` 「${it.title}」` : '（号不在册）'} — ${c.why}`);
        }
    }
}

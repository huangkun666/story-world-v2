// story-world-v2/demo/audit-design-candidates.js
// **为「败露判据 / 可见性」两个设计点做八本书实测**（ANCHOR §4.8：加机制前先拿多书数据）。
// 跑法：node demo/audit-design-candidates.js "<worlds 目录>"
// 判据全部零 token、纯结构解析；不读单本结论当证据。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));

function load(file) {
    const b = JSON.parse(readFileSync(file, 'utf8'));
    const raw = b.entries;
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        keys: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
        off: e.disable === true || e.enabled === false,
    })).filter((e) => !e.off);
}

// ① X2/X3 候选：同一实体**同时**出现在 ≥2 个事件里要跨事件引用，而书里只有"事件行"这种形态？
//    这里量的其实是**运行时**结构（事件/盘算），书文本里量不到 ⇒ 只量"书能不能供给这种结构"：
//    · 势力条目 = 盘算属主的来源；成员行 = 势力与角色的固定关联（跨事件可比的锚点）
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
// ② 位置候选：位置集（kind=location 近似）+ 明述驻地行 + 条目**名字**里究竟有没有地名
const PLACE_HINT = /(?:所在地|驻地|核心底蕴|位于|地处|居)\s*[:：]?\s*([^\n。；]{2,30})/g;
// "名字像地名"的判据（仅用于估算位置集大小，与 web/derivePositions 的 kind 标签同性质）
const PLACE_SUFFIX = /[洲山城谷域海界境岛原野岭峰林泽洞窟殿阁陆川州江河][·]?$/;

const rows = [];
for (const file of files) {
    const name = file.split(/[\\/]/).pop();
    let on;
    try { on = load(file); } catch (e) { console.log(`[SKIP] ${name}: ${e.message}`); continue; }
    if (!on.length) { console.log(`[EMPTY] ${name}`); continue; }

    // 位置集规模近似（与 audit-mechanism-genericity 同口径，便于横向对照）
    const locish = on.filter((e) => PLACE_SUFFIX.test(e.comment)).length;
    // 明述驻地行的条目数
    let withHint = 0;
    for (const e of on) { PLACE_HINT.lastIndex = 0; if (PLACE_HINT.test(e.content)) withHint += 1; }
    // 势力条目数（有 ≥2 条成员行的）＋ 成员行总数 —— 盘算属主与"稳定锚点"的供给面
    let orgs = 0, memberRows = 0;
    for (const e of on) {
        MEMBER_LINE.lastIndex = 0;
        const n = [...e.content.matchAll(MEMBER_LINE)].length;
        memberRows += n;
        if (n >= 2) orgs += 1;
    }
    // 事件/状态类条目形态：书里有没有"处境/事件"这种会随时间变的段落（供盘算挂因）
    const stateish = on.filter((e) => /(当前|如今|此刻|局势|大势|浩劫|危局|战事)/.test(e.content.slice(0, 200))).length;

    rows.push({ book: name, entries: on.length, locish, withHint, orgs, memberRows, stateish });
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log('八本真实世界书 · 设计候选的**供给面**实测（零 token·纯结构）\n');
console.log(pad('书', 34) + num('条目', 6) + num('地名条目', 9) + num('明述驻地', 9) + num('势力条目', 9) + num('成员行', 8) + num('处境段落', 9));
console.log('-'.repeat(94));
for (const r of rows) console.log(pad(r.book.slice(0, 32), 34) + num(r.entries, 6) + num(r.locish, 9) + num(r.withHint, 9) + num(r.orgs, 9) + num(r.memberRows, 8) + num(r.stateish, 9));
console.log('-'.repeat(94));
const eff = (f) => rows.filter(f).length;
console.log(`\n★泛用性分档（判据=这本书能不能供给该机制的结构性输入）：`);
console.log(`  ① 位置集可用（地名条目 ≥3）：${eff((r) => r.locish >= 3)} / ${rows.length}`);
console.log(`  ② 明述驻地可用（≥1 条）：   ${eff((r) => r.withHint >= 1)} / ${rows.length}`);
console.log(`  ③ 势力+成员行可用（=可推出稳定关联/属主）：${eff((r) => r.orgs >= 1)} / ${rows.length}`);
console.log(`  ④ 处境/事件段落可用：       ${eff((r) => r.stateish >= 1)} / ${rows.length}`);
console.log(`\n★「不共线」复核（缺形态时必须只"不生效"、不许"给错结果"）：`);
for (const r of rows) {
    const dead = [r.locish < 3 && '①无地名表', r.withHint < 1 && '②无驻地明述', r.orgs < 1 && '③无势力成员行', r.stateish < 1 && '④无处境段落'].filter(Boolean);
    console.log(`  ${pad(r.book.slice(0, 30), 32)} ${dead.length ? `不生效：${dead.join('/')}` : '四项供给齐备'}`);
}

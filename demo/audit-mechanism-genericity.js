// story-world-v2/demo/audit-mechanism-genericity.js
// **按 ANCHOR §4.8 量每个机制的泛用性**（用户令：「不能泛用到所有世界书的设计都是垃圾」）。
// 对八本真实世界书，逐机制测"在这本书上有没有效果、以及没有效果时会不会给出错误结果"。
// 判据（零 token，纯结构解析；不需要模型）：
//   机制①「成员行 → 归属」：组织条目正文里有多少条严口径成员行；没有它这本书有多少角色拿不到归属
//   机制②「位置继承」：位置集是不是干净地名表（kind=location 条目数）+ 有多少条明述驻地
//   机制③「势力规模兜底」：有多少 `[势力: X (…)]` / `核心底蕴:` 形态
// 用法：node demo/audit-mechanism-genericity.js <worlds目录>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { derivePositions } from '../../story-world-v2/web/index.js';

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f));

function loadEntries(file) {
    const b = JSON.parse(readFileSync(file, 'utf8'));
    const raw = b.entries;
    const list = Array.isArray(raw) ? raw : Object.values(raw || {});
    return list.filter((e) => e && typeof e === 'object').map((e) => ({
        comment: String(e.comment ?? e.name ?? '').trim(),
        content: String(e.content ?? ''),
        keys: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
        disabled: e.disable === true || e.enabled === false,
    }));
}
const MEMBER_STRICT = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]\s*(男|女|雄|雌|公|母)\s*[,，、]\s*([^)）]{1,24})[)）]/gm;
const MEMBER_LOOSE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
const FACTION_TAG = /\[\s*势力\s*[:：][^\]（(\n]{0,40}?[（(]([^）)]{2,40})[）)]/g;
const SCALE_LABEL = /(?:核心底蕴|底蕴|规模|兵力)\s*[:：]\s*([^\n。；;]{2,40})/g;
const PLACE_HINT = /(?:所在地|驻地|核心底蕴|位于|地处|居)\s*[:：]?\s*([^\n。；]{2,30})/g;

const rows = [];
for (const file of files) {
    let list;
    try { list = loadEntries(file); } catch (e) { console.log(`[SKIP] ${file}: ${e.message}`); continue; }
    const on = list.filter((e) => e.disable !== true && e.enabled !== false);
    if (!on.length) { console.log(`[EMPTY] ${file}: 条目 ${list.length} 全被禁用`); continue; }
    const name = file.split(/[\\/]/).pop();

    // 机制①：严口径成员行（真花名册形态）
    let strictRows = 0, looseRows = 0, orgsWithStrict = 0, orgsWithLoose = 0;
    const memberNames = new Set();
    for (const e of on) {
        MEMBER_STRICT.lastIndex = 0; MEMBER_LOOSE.lastIndex = 0;
        const s = [...e.content.matchAll(MEMBER_STRICT)];
        const l = [...e.content.matchAll(MEMBER_LOOSE)];
        strictRows += s.length; looseRows += l.length;
        if (s.length >= 2) orgsWithStrict += 1;
        if (l.length >= 2) orgsWithLoose += 1;
        for (const m of s) memberNames.add(m[1].trim());
    }
    // 机制②：位置集（kind=location 条目 = 干净地名表的来源）
    const setting = {
        frozen: { canon: { bookEntities: on.map((e) => ({ name: e.comment, kind: 'character' })) } },
    };
    // 用真 derivePositions：只喂"书里明述的地名"不可行（没有 kind 信息），这里改用同一函数的输入面近似：
    //   location 条目 = comment 像地名（含 洲/山/城/谷/域/海/界/境 等）——仅用于估算位置集大小
    const locish = on.filter((e) => /[洲山城谷域海界境岛原野岭峰林泽洞窟殿阁]$/.test(e.comment)).length;
    const positions = derivePositions({
        frozen: { canon: { bookEntities: on.map((e) => ({ name: e.comment, kind: /[洲山城谷域海界境岛原岭峰林泽]$/.test(e.comment) ? 'location' : 'character' })) } },
    });
    let placeHints = 0;
    for (const e of on) { PLACE_HINT.lastIndex = 0; placeHints += [...e.content.matchAll(PLACE_HINT)].length; }
    // 机制③：势力规模形态
    let facTags = 0, scaleLabels = 0;
    for (const e of on) {
        FACTION_TAG.lastIndex = 0; SCALE_LABEL.lastIndex = 0;
        facTags += [...e.content.matchAll(FACTION_TAG)].length;
        scaleLabels += [...e.content.matchAll(SCALE_LABEL)].length;
    }
    rows.push({
        book: name, entries: on.length, chars: on.reduce((s, e) => s + e.content.length, 0),
        strictRows, looseRows, orgsWithStrict, orgsWithLoose, memberNames: memberNames.size,
        locish, positions: positions.length, placeHints, facTags, scaleLabels,
    });
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log('按 ANCHOR §4.8 逐机制量泛用性（八本真实世界书·零 token·纯结构解析）\n');
console.log(pad('书', 34) + num('条目', 6) + num('成员行严', 9) + num('含册条目', 9) + num('成员名', 7) + num('位置集', 7) + num('驻地明述', 9) + num('势力标签', 9) + num('底蕴标签', 9));
console.log('-'.repeat(112));
for (const r of rows.sort((a, b) => b.strictRows - a.strictRows)) {
    console.log(pad(r.book.slice(0, 32), 34) + num(r.entries, 6) + num(r.strictRows, 9) + num(r.orgsWithStrict, 9) + num(r.memberNames, 7) + num(r.positions, 7) + num(r.placeHints, 9) + num(r.facTags, 9) + num(r.scaleLabels, 9));
}
console.log('-'.repeat(112));
const eff = (f) => rows.filter(f).length;
console.log(`\n效果分布（"这本书上有没有用"）：`);
console.log(`  机制①成员行 → 归属：有严口径成员行的书 = ${eff((r) => r.strictRows > 0)} / ${rows.length}`);
console.log(`  机制②位置继承  ：位置集 >2 项（= 有干净地名表）的书 = ${eff((r) => r.positions > 2)} / ${rows.length}；有驻地明述的书 = ${eff((r) => r.placeHints > 0)} / ${rows.length}`);
console.log(`  机制③势力规模  ：有势力标签/底蕴标签的书 = ${eff((r) => r.facTags + r.scaleLabels > 0)} / ${rows.length}`);
console.log(`\n★泛用性裁决（ANCHOR §4.8 第二条"不共线"）：`);
for (const r of rows) {
    const no1 = r.strictRows === 0, no2 = r.positions <= 2, no3 = r.facTags + r.scaleLabels === 0;
    const dead = [no1 && '①无成员行', no2 && '②无地名表', no3 && '③无规模标签'].filter(Boolean);
    console.log(`  ${pad(r.book.slice(0, 30), 32)} ${dead.length ? `机制不生效：${dead.join('/')}` : '机制可用'}${dead.length === 3 ? '   ← 三个形态依据全缺 = 只能靠模型+校验（唯一通用骨架）' : ''}`);
}

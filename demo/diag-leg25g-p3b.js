// story-world-v2/demo/diag-leg25g-p3b.js   （只读，只读副本）
// leg25 g · P3 第二问：`大虞` 这个 canon 条目**自己带不带正文**？
//   如果带（模型抽取时把正文一起抄了），那虞昭华的成员行就在 canon 自己手里，
//   根本不用碰书、不用动归一尺——只差"去看看 canon 条目的 content"。
import { readFileSync } from 'node:fs';

const raw = readFileSync(process.env.SWV2_CHAT, 'utf8');
const world = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2.world;
const book = world.context?.setting?.frozen?.canon?.bookEntities || [];

const withContent = book.filter((b) => typeof b.content === 'string' && b.content.trim());
console.log(`canon.bookEntities = ${book.length} · 其中**带正文(content)**的 = ${withContent.length}`);
console.log(`字段分布样例 = ${JSON.stringify(Object.keys(book[0] || {}))}`);

for (const nm of ['大虞', '人族皇朝', '大虞皇朝', '昆仑道宫', '万妖盟']) {
    const b = book.find((x) => x.name === nm);
    if (!b) { console.log(`\n「${nm}」→ canon 里没有`); continue; }
    console.log(`\n「${nm}」kind=${b.kind} 字段=${JSON.stringify(Object.keys(b))}`);
    if (b.content) {
        console.log(`  正文长度 = ${b.content.length}`);
        console.log(`  正文前 400 字 = ${b.content.slice(0, 400).replace(/\n/g, ' ⏎ ')}`);
        console.log(`  ★含「虞昭华」？ ${b.content.includes('虞昭华') ? '是' : '否'}`);
    } else {
        console.log(`  ★无 content 字段（正文没被抄进 canon）`);
    }
}

// canon 里到底有没有任何条目带正文/成员行
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
let rosterish = 0;
for (const b of book) {
    if (typeof b.content !== 'string') continue;
    MEMBER_LINE.lastIndex = 0;
    if ([...b.content.matchAll(MEMBER_LINE)].length) rosterish += 1;
}
console.log(`\n★canon 条目里能扫出成员行的 = ${rosterish} / ${book.length}`);

// 虞昭华在 canon 里长什么样（它自己带什么字段）
const yzh = book.find((b) => b.name === '虞昭华');
console.log(`\n虞昭华 canon 条目 = ${JSON.stringify(yzh)}`);

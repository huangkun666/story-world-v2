// story-world-v2/demo/measure-leg25g-map.js   （只读，只读副本；不写任何文件）
// leg25 g 量化：位置展示「收成一个入口」到底省了多少视线（真卡 + 真账 + 真书）。
// 对照：同一份真账下，侧栏在 ①旧形态（整片铺开 = leg25 f 的样子）②新形态（收进「地图」默认收起）各占多少字节。
//   新形态的"开口尺寸" = details 之前的摘要部分（用户不点开时真正看到的量）。
// 跑法：node demo/measure-leg25g-map.js "<chat jsonl 副本>" "<角色卡 png>"
import { readFileSync } from 'node:fs';
import { characterBookEntries, inheritLocations } from '../web/index.js';
import { renderAll } from '../src/render.js';
import { PANEL_BUILD } from '../src/render-base.js';   // ★leg85：共用底搬进 render-base.js

function cardFromPng(file) {
    const buf = readFileSync(file);
    let off = 8, card = null;
    while (off + 12 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const data = buf.subarray(off + 8, off + 8 + len);
        if (type === 'tEXt') {
            const z = data.indexOf(0);
            if (data.toString('latin1', 0, z) === 'chara') card = JSON.parse(Buffer.from(data.subarray(z + 1).toString('latin1'), 'base64').toString('utf8'));
        }
        off += 12 + len;
        if (type === 'IEND') break;
    }
    return card;
}

const world = JSON.parse(readFileSync(process.argv[2], 'utf8').split('\n')[0]).chat_metadata.story_world_v2.world;
const entries = characterBookEntries(cardFromPng(process.argv[3]));

// 生产链：位置继承那一刀（与 loadWorld 同口径）
const r = inheritLocations(world, { entries });
const w = r.ssot;
w.meta = w.meta || { tick: 0, simLog: [] };
w.chronicle = w.chronicle || []; w.events = w.events || []; w.agendas = w.agendas || [];
w.milestones = w.milestones || [];
w.context.playerId = w.context.playerId || w.entities[0]?.id;

const side = renderAll(w, { config: { lookupTask: null }, oldVolumes: [], view: {} })?.board?.side || '';
const full = side.length;
// 新形态：开口 = `<details …>` 到 `</summary>` 为止（用户不点开时看到的部分）
const briefEnd = side.indexOf('</summary>');
const brief = briefEnd >= 0 ? side.slice(0, briefEnd + '</summary>'.length).length : null;
// 旧形态（leg25 f）：没有 details 包裹时的长度 = 去掉 details 外壳与说明行
const inner = (side.match(/<div class="sw2-side">([\s\S]*)<\/div><\/details>$/) || [, side])[1];
const legacy = inner.length + '<div class="sw2-col-head">各归何处 · 速览（21 处 / 173 人有处可循）</div>'.length;

const groups = (side.match(/class="sw2-locgroup"/g) || []).length;
const unknownBasket = side.includes('sw2-locgroup-unknown') ? 1 : 0;
const chips = (side.match(/class="sw2-locchip/g) || []).length;

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('leg25 g · 位置展示收成一个入口「地图」· 真账量化\n');
console.log(`构建号 = ${PANEL_BUILD}`);
console.log(`真账：实体 ${w.entities.length} · 真位置 ${w.entities.filter((e) => e.location && e.location !== '未明').length} · 位置集 ${(w.context.positions || []).length}`);
console.log(`侧栏内容：地点组 ${groups} 个 · 未载筐 ${unknownBasket} 个 · 名号 chip ${chips} 个\n`);
console.log('对照（同一份真账、同一套内容）：');
console.log(`  ① 旧形态（整片铺开，leg25 f）      = ${legacy} 字节（${kb(legacy)}）`);
console.log(`  ② 新形态·全展开（点开地图之后）    = ${full} 字节（${kb(full)}）`);
console.log(`  ③ 新形态·默认收起（用户实际看到）  = ${brief} 字节（${kb(brief)}）`);
if (brief) {
    console.log(`\n★ 默认态相对旧形态 = ${(legacy / brief).toFixed(1)}× 缩小（省 ${((1 - brief / legacy) * 100).toFixed(1)}%）`);
    console.log(`★ 内容零删减：点开后仍是 ${groups} 组 + 未载筐（同一份内容，只是折叠）`);
}
console.log('\n开口实际长这样：');
console.log('  ' + side.slice(0, briefEnd + 11).replace(/\s+/g, ' '));

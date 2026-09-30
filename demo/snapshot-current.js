// story-world-v2/demo/snapshot-current.js  (只读：当前世界的实况快照，交接用)
import { readFileSync } from 'node:fs';
const p = process.env.SWV2_CHAT;
const raw = readFileSync(p, 'utf8');
const box = JSON.parse(raw.slice(0, raw.indexOf('\n'))).chat_metadata.story_world_v2;
const w = box.world || {};
const lk = w.meta?.entityFields || {};
const ents = w.entities || [];
const canon = w.context?.setting?.frozen?.canon || {};
console.log('savedAt =', box.savedAt, '| tick =', w.meta?.tick);
console.log('实体 =', ents.length, '| 角色 =', ents.filter((e) => e.kind === 'character').length, '| 势力 =', ents.filter((e) => e.kind === 'faction').length);
console.log('canon.bookEntities =', (canon.bookEntities || []).length, '| powerScale =', (canon.powerScale || []).length, '| rules =', (canon.rules || []).length, '| society 长度 =', String(canon.society || '').length);
console.log('★ parent =', ents.filter((e) => e.parent).length, '| 实力 =', ents.filter((e) => e['实力']).length, '| 规模 =', ents.filter((e) => e['规模']).length);
console.log('entityFields 记录 =', Object.keys(lk).length, '| 位置集 =', (w.context?.positions || []).length);
const src = {}; for (const e of ents) if (e.parent) src[e.parentSource || '?'] = (src[e.parentSource || '?'] || 0) + 1;
console.log('parent 来源分账 =', JSON.stringify(src));
const ev = {}; for (const e of ents) if (e.parentSourceFrom) ev[e.parentSourceFrom] = (ev[e.parentSourceFrom] || 0) + 1;
console.log('证据类型（前 6）=', JSON.stringify(Object.entries(ev).sort((a, b) => b[1] - a[1]).slice(0, 6)));
const loads = {}; for (const e of ents) if (e.parent) loads[e.parent] = (loads[e.parent] || 0) + 1;
console.log('麾下最多的势力 =', Object.entries(loads).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v})`).join('、'));
console.log('事件 =', (w.events || []).length, '| 盘算 =', (w.agendas || []).length, '| 编年 =', (w.chronicle || []).length);
for (const nm of ['吞天妖王', '玄一道祖', '清玄真人', '虞昭华', '混乱之地·万妖盟', '万妖盟', '昆仑道宫']) {
    const e = ents.find((x) => x.name === nm);
    console.log(`  ${nm}: ${e ? `实力=${JSON.stringify(e['实力'] ?? null)} 规模=${JSON.stringify(e['规模'] ?? null)} parent=${JSON.stringify(e.parent ?? null)}` : '(不在册)'}`);
}

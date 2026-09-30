// story-world-v2/demo/summarize-leg40b-seedmax.js
// leg40b · 三臂对照收口（base / gate / max）——只看读数，不替我下结论。
// 用法：node demo/summarize-leg40b-seedmax.js F:/deepseek/tmp/leg40b-base.json F:/deepseek/tmp/leg40b-gate.json F:/deepseek/tmp/leg40b-max.json
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
const arms = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(f, 'utf8')) }));
const pad = (s, n) => String(s).padEnd(n);
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');

console.log('=== 三臂对照（初始化起根路 · 真模型）===');
console.log('');
console.log(pad('项', 28) + arms.map((a) => pad(a.arm, 12)).join(''));
const row = (label, fn) => console.log(pad(label, 28) + arms.map((a) => pad(fn(a), 12)).join(''));

row('闸：TOP/MAX/每块', (a) => `${a.gates.SEED_ROOTS_TOP}/${a.gates.SEED_ROOTS_MAX}/${a.arm === 'base' ? 2 : '∞'}`);
row('闸：AGENDA perTick', (a) => String(a.gates.AGENDA_CAPS.perTick));
row('块数', (a) => String(a.book.chunks));
row('★落账种子', (a) => String(a.seeding.seeded));
row('★块均产出', (a) => (a.seeding.seeded / a.book.chunks).toFixed(2));
row('每块返回合计', (a) => String(a.seeding.gotTotal));
row('被丢（去重/上限）', (a) => String(a.seeding.gotTotal - a.seeding.seeded));
row('空手块', (a) => `${a.seeding.chunkLog.filter((c) => !c.got).length}/${a.book.chunks}`);
row('调用次数 / 用时', (a) => `${a.seeding.calls} / ${a.seeding.secs}s`);
row('逐块产出', (a) => a.seeding.chunkLog.map((c) => (c.ok ? c.got : '✗')).join(''));
row('终态 tick', (a) => String(a.final.tick));
row('★第1轮新线', (a) => String((a.ticks[0]?.newAgendas || []).length));
row('第1轮新事件', (a) => String((a.ticks[0]?.newEvents || []).length));
row('线头 before→after', (a) => `${a.ticks[0]?.openRootsBefore ?? '-'}→${a.ticks[0]?.openRootsAfter ?? '-'}`);
row('线捆条数', (a) => String((a.ticks[0]?.threads || []).length));
row('线捆被推', (a) => `${(a.ticks[0]?.pushed || []).length}/${(a.ticks[0]?.threads || []).length}`);
row('第1轮警告', (a) => String(a.ticks[0]?.warnings ?? '-'));

console.log('');
console.log('=== 位置分布（防"开闸后全挤回同一处"）===');
for (const a of arms) {
  const locs = a.seeds.map((s) => String(s.position || '（未载）'));
  const uniq = new Set(locs);
  const top = [...locs.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map()).entries()].sort((x, y) => y[1] - x[1]);
  console.log(`  ${pad(a.arm, 8)} 条数 ${locs.length} · 不同位置 ${uniq.size} · 最大一处 ${top[0] ? `${top[0][0]}×${top[0][1]}` : '—'} ⇒ 集中度 ${locs.length ? pct(top[0]?.[1] || 0, locs.length) : 'n/a'}`);
}

console.log('');
console.log('=== 当事人（看是不是同几个人/同一批势力）===');
for (const a of arms) {
  const people = a.seeds.flatMap((s) => s.people || []);
  const uniq = new Set(people);
  console.log(`  ${pad(a.arm, 8)} 人次 ${people.length} · 不同的人 ${uniq.size}`);
  console.log(`           ${[...uniq].slice(0, 22).join('、')}`);
}

console.log('');
console.log('=== 逐条根（带书里原话）===');
for (const a of arms) {
  console.log(`  ── ${a.arm} ──`);
  for (const s of a.seeds) console.log(`   ${pad(s.id, 11)} @${pad(s.position || '未载', 20)} [${(s.people || []).join('、')}] 「${s.title}」`);
}

console.log('');
console.log('=== 第1轮实际长出来的（这才叫"百花齐放"）===');
for (const a of arms) {
  const t = a.ticks[0] || {};
  console.log(`  ── ${a.arm} ── 新线 ${(t.newAgendas || []).length} 条 · 新事件 ${(t.newEvents || []).length} 件`);
  for (const g of t.newAgendas || []) console.log(`      盘算 ${g.type}${g.ref ? `→${g.ref}` : ''} 「${g.goal}」`);
  for (const e of t.newEvents || []) console.log(`      事件 @${e.position || '未载'}${e.ref ? ` ←${e.ref}` : ''} 「${e.title}」`);
}

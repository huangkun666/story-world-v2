// story-world-v2/demo/verify-leg25h-merge.js  （只读：简化后的合并行为自证）
import { dedupeRoster } from '../src/abstract.js';

const show = (label, out) => console.log(`  ${label} → 条数 ${out.length}：${JSON.stringify(out.map((m) => [m.name, ...(m.aliases || [])]))}`);

console.log('leg25 h · 跨块别名合并（简化裁决）自证\n');

// ① 真模型实测那一幕：两块指向相反
const chunk1 = [{ name: '人族皇朝', kind: 'faction', aliases: ['大虞', '大虞皇朝'], fields: { 规模: '方圆7500万里' } }];
const chunk2 = [{ name: '大虞皇朝', kind: 'faction', aliases: ['人族皇朝', '大虞'] }, { name: '虞昭华', kind: 'character' }];
show('块1+块2', dedupeRoster([...chunk1, ...chunk2]));
show('块2+块1（颠倒）', dedupeRoster([...chunk2, ...chunk1]));

// ② 真模型实际产出的那些别名（从 A/B 实测里抄下来的）
const real = [
    { name: '人族皇朝', kind: 'faction', aliases: ['大虞', '大虞皇朝'] },
    { name: '昆仑道宫', kind: 'faction', aliases: ['昆仑'] },
    { name: '瑶池圣地', kind: 'faction', aliases: ['瑶池'] },
    { name: '荒古姬家', kind: 'faction', aliases: ['姬家'] },
    { name: '荒古姜家', kind: 'faction', aliases: ['姜家'] },
    { name: '大虞', kind: 'faction' },          // 另一块又单抽出来的碎片
    { name: '昆仑', kind: 'faction' },
    { name: '瑶池', kind: 'faction' },
];
show('真账那批别名 + 重复碎片', dedupeRoster(real));

// ③ 反向锁：不相关的名字绝不许被合（防止"合出假关系"）
const unrelated = [{ name: '万法阁', kind: 'faction' }, { name: '无间魔宗', kind: 'faction' }, { name: '无间血海', kind: 'faction' }];
show('不相关（必须 3 条）', dedupeRoster(unrelated));

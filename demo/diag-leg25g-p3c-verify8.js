// story-world-v2/demo/diag-leg25g-p3c-verify8.js   （只读）
// leg25 g · P3：把「真正会新写入的 8 条」逐条拿到书里对证 —— 它们到底是不是真关系。
import { readFileSync } from 'node:fs';

const bj = JSON.parse(readFileSync(process.env.SWV2_BOOK, 'utf8'));
const list = Array.isArray(bj.entries) ? bj.entries : Object.values(bj.entries || {});
const entries = list.filter((e) => e && typeof e === 'object').map((e) => ({
    comment: String(e.comment ?? e.name ?? '').trim(),
    content: String(e.content ?? ''),
    key: (Array.isArray(e.keys) ? e.keys : Array.isArray(e.key) ? e.key : [e.key]).map((k) => String(k ?? '').trim()).filter(Boolean),
    disable: e.disable === true || e.enabled === false,
})).filter((e) => !e.disable);

// 靠 key 别名补上的那两个条目（本次改动的全部实际影响面）
for (const [entryName, org] of [['人族皇朝', '大虞'], ['隐世圣地·瑶池', '瑶池圣地'], ['原初圣界', '圣族']]) {
    const e = entries.find((x) => x.comment === entryName);
    console.log('='.repeat(78));
    console.log(`书条目 [${entryName}]  key 里含「${org}」？ ${e?.key.includes(org) ? '★是' : `否（key=${JSON.stringify(e?.key)}）`}`);
    if (!e) continue;
    console.log(`正文全文（${e.content.length} 字）：`);
    console.log(e.content);
    console.log('');
}

console.log('='.repeat(78));
console.log('逐条对证：8 条新写入的角色，是否真在该条目正文里（且是成员行形态）');
const MEMBER_LINE = /^[-*·•\s]*([^\s(（:：、,]{2,20})\s*[（(]/gm;
const targets = ['虞昭华', '秦红袖', '沈天君', '瑶池圣母', '灭情师太', '蟠桃树灵·夭夭', '青鸟', '叶清璇'];
for (const nm of targets) {
    let found = [];
    for (const e of entries) {
        if (!e.content.includes(nm)) continue;
        MEMBER_LINE.lastIndex = 0;
        const ms = [...e.content.matchAll(MEMBER_LINE)].map((m) => m[1].trim());
        if (ms.includes(nm)) found.push(`成员行@[${e.comment}]`);
        else found.push(`仅正文提及@[${e.comment}]`);
    }
    console.log(`  ${nm}：${found.join('、') || '★书里找不到'}`);
}

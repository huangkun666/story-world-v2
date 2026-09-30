// story-world-v2/test/prompt-required-fields.test.js
// ★leg64 第五轮（用户实机报「⚠ 演算失败：$.newAgendas[0].visibility: 必填缺失（世界原样未动，可重试）」）：
//   **提示词里"必填"与 schema 里的"必填"必须对得上**。
//
// 病（本棒查出来的，指得出出处）：
//   `world-step.schema.js:28` 把 `visibility` 放在 `newAgendas` 的 `required` 里，
//   而提示词的**字段说明**把它写成一个**没有「可省」标记的裸字段**：
//       `…；stage=起始阶段（可省）；visibility=明暗（known/concealed）；maxSteps=步数上限（1..8，可省，引擎钳制）；…`
//   那条说明是 ~2000 字符的一整段（不可读），而紧邻的对照面 `agendaAdvances[].step` 写着「（必填）」
//   ⇒ 模型很自然地**没看出 visibility 是必填**，于是省略它 ⇒ **整步被拒、世界原样不动、白烧一轮**。
//   ★注意这条与"净化器只做减法"是**两条不同的纪律**：`sanitize-step.js` 被明令**不许替模型编内容**
//     （`test/deadlock-heal.test.js:184` 锁着），所以"缺 visibility"只能靠**提示词说清楚**来治，
//     不能靠引擎补一个默认值——那是替模型编。
//   ⇒ 本文件的判据：**凡是 schema 里 required 的字段，提示词里必须标「必填」**（机械可查）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAIN_PROMPT } from '../src/prompts.js';
import { worldStepSchema } from '../src/schemas/world-step.schema.js';

// 从 schema 真源里取"每个对象组各自 required 哪些字段"（不手抄——手抄就会漂）
const groupRequired = () => {
    const out = new Map();
    for (const [g, spec] of Object.entries(worldStepSchema.props)) {
        const req = spec?.items?.required;
        if (Array.isArray(req) && req.length) out.set(g, req);
    }
    return out;
};

test('★★leg64：`newAgendas` 的必填字段在提示词里**说清了**（用户实机栽在 visibility 上）', () => {
    const req = groupRequired().get('newAgendas');
    assert.deepEqual(req, ['entity', 'goal', 'visibility', 'source'], '夹具前提：schema 里这四个是必填');
    // ① 首选手面：**紧邻对照面必须带「必填」标记**——`agendaAdvances[].step` 一直是这么写的（「（必填）」），
    //    `visibility` / `source.type` 过去**没有**（这就是模型的误读来源）⇒ 现在补上。
    for (const f of ['visibility', 'source.type']) {
        assert.match(MAIN_PROMPT, new RegExp(`${f.replace('.', '\\.')}=[^；]{0,30}必填`),
            `★字段说明里 \`${f}\` 必须标「必填」（对照面 \`agendaAdvances[].step\` 就是这么写的）`);
    }
    // ② 组级陈述：那一段 2000 字的说明不可读 ⇒ 四条必写字段必须在**规则第 7 条**里再点名一遍
    //    （模型不必去啃长段落也能知道"省了会被拒"）。
    assert.match(MAIN_PROMPT, /必写字段/, '★规则第 7 条点名"有哪些必写字段"');
    for (const f of ['entity', 'goal', 'visibility', 'source.type']) {
        assert.ok(MAIN_PROMPT.includes(f.split('.')[0]) && MAIN_PROMPT.includes(f.split('.')[1] || f),
            `★必写字段清单里有 \`${f}\``);
    }
    assert.match(MAIN_PROMPT, /省了整步会被拒/, '★并且写明代价（否则模型不会当回事）');
});

test('★leg64：`visibility` 的取值二选一 + 引擎侧仍然必填（**不许**改成"缺了给默认值"）', () => {
    assert.deepEqual(worldStepSchema.props.newAgendas.items.props.visibility.enum, ['known', 'concealed']);
    assert.ok(worldStepSchema.props.newAgendas.items.required.includes('visibility'),
        '★引擎侧必填**照旧**——本笔只修"提示词没说清"，不放松契约（放松＝替模型编一个默认值）');
    // 净化器只做减法那条纪律仍在（源码锁：本笔不许把"补默认值"混进去）
    const san = readFileSync(new URL('../src/sanitize-step.js', import.meta.url), 'utf8');
    assert.match(san, /visibility !== 'known' && na\.visibility !== 'concealed'/,
        '★净化器对 visibility 仍是"两个取值之外一律丢整条"，没有"缺了就当 known"');
    assert.ok(!/visibility\s*(\?\?|\|\|)\s*'known'/.test(san), '★没有偷偷给它兜个默认值');
});

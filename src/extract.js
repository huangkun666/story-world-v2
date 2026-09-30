// story-world-v2/src/extract.js
// 落子提取 · 引擎规则侧（S3）——对话 → 一条结构化落子事实 {verb, object, location, attempt, note?}
// 契约（§3.1，活档实测后定稿版 v1）：
//   1. 单事实：取主动作，其余丢弃（条件/次意图为已知限制，解在后续提取调用增强——ANCHOR 未决点 1 深化项）；
//   2. OOC 元指令层必滤（实测发现：真实会话里（继续）/更新变量/重写/检索 密集出现）；
//   3. 对象靠显式名单 + 别名（实测发现：小娥≠白小娥），分两类：实体名单 + 非实体目标名单
//      （实测发现：对象不止实体——灵脉/财货/地点目标都合法）；玩家自称不得作对象（黄坤排除）；
//   4. 位置可空（实测发现：玩家侧位置几乎只以"这里/那/目的地"代词出现）——由主调用在世界状态里补位；
//   5. attempt 恒真（§4.7 时差：对话只写尝试，结果归模拟器；账吃对话、兑现归引擎）。

// 动词归一表：pattern（优先级从高到低，先特异后泛用）→ 规范动词
const VERB_TABLE = [
    [/搜刮/, '搜刮'],
    [/值几何|询价|询个价|作价/, '询价'],
    [/躲我后面/, '掩护'],
    [/来路|盘问|质问/, '盘问'],
    [/去解决|去解|解决掉/, '迎战'],
    [/去看看|看看吧|看看|前去查探/, '探查'],
    [/带路|跟我来|跟着|跟随/, '跟随'],
    [/我背|背着/, '背负'],
    [/温柔地说|问道|问我|问/, '询问'],
    [/开始修炼|闭关|修炼/, '修炼'],
    [/主人了|认主|收服/, '收服'],
    [/得了|图谋|谋划|想夺/, '图谋'],
    [/离开|告辞/, '离开'],
];

// OOC 元指令层：全角/半角括号内内容 + 显式指令词
const OOC_PATTERNS = [
    /[（(](?:继续|更新|重写|检索|修改|跳过|快写)[^）)]*[）)]/g,
    /(?:更新变量|重写|检索.{0,6}记忆|你是猪吗)/g,
];

export function filterOOC(text) {
    const dropped = [];
    let t = text;
    for (const re of OOC_PATTERNS) {
        t = t.replace(re, (m) => { dropped.push(m.trim()); return ''; });
    }
    // 全角括号兜底（未命中指令词的括号内容整体滤除）
    t = t.replace(/（[^）]*）/g, (m) => { dropped.push(m.trim()); return ''; });
    return { clean: t.trim(), dropped };
}

export function extractMove(text, ctx = {}) {
    const { clean, dropped } = filterOOC(text);
    if (!clean) {
        return { verb: null, object: null, location: null, attempt: false, note: dropped.join(' ') || null, dropped };
    }
    let verb = null;
    for (const [re, v] of VERB_TABLE) {
        if (re.test(clean)) { verb = v; break; }
    }
    const player = ctx.playerName || '';
    const object = [...(ctx.entityNames || []), ...(ctx.objectNames || []).map((n) => ({ name: n }))]
        .find((e) => {
            if (e.name === player) return false;
            return clean.includes(e.name) || (e.aliases || []).some((a) => clean.includes(a));
        })?.name || null;
    const location = (ctx.locations || [])
        .map((l) => (typeof l === 'string' ? { name: l } : l))
        .find((l) => clean.includes(l.name) || (l.aliases || []).some((a) => clean.includes(a)))?.name || null;
    return { verb, object, location, attempt: true, note: dropped.join(' ') || null, dropped };
}
// story-world-v2/web/inject-readout.js
// ★★★（2026-10-05 · 用户令，两条连着下）：
//   ①「**把图片的第一段话中的关键信息抽取出来展示在参数页**」——那张图里那一行是
//      `标签注入：格式指令 1349 字 · 世界动向 326 字 · 账上往事 87 字（跟书不一样 87 字 · 往事 没命中 …）`
//      `· 向量路 关键词）（作为系统提示词排在提示词末尾 · position=0；插件只注入这几段，不读也不改你的正文）`；
//   ②「**第二段话可以删了，这是用来调试的**」——第二段是那张图底下那行"注入器还没跑过…"，
//      已经**不再画到面板上**（它只留在控制台诊断里）。
//
// 【它答的是什么】"插件**上一次**往你的对话里塞了哪几段、各多少字、往事是怎么找回来的"。
//   ★这是**给玩家看的读数**（不是排查日志）：一句人话 ＋ 一串"哪一段多少字"的小格。
//
// 【★为什么单独一个模块】`web/index.js` 有**硬锁 `<3100` 行**（`test/web-view-state-layout.test.js`）——
//   本笔要往接线层加"这一行怎么写"，照本仓既有纪律（leg142/150/160/161/177）：**先把一族搬出去**。
//   而措辞属于"渲染的事"，不属于"接线的事"⇒ 住这里，接线层只把 `facts` 递进来。
//
// 【★自动对齐（用户 2026-10-05 拍板：只做自动对齐）】往事有两路：
//   · **向量路**（按意思找）——**向量通道（设置页「记忆通道」）开着时**才可能走向量；
//   · **关键词路**（按名字/按词找）——它一直都在，是向量没开时唯一的那一路。
//   ⇒ 面板**如实印出上一次真走的是哪一路**，不新增玩家开关（玩家不需要理解两路，他需要看见结果）。
//
// 【★零 Node 内建依赖、顶层零 DOM 访问】（`test/browser-compat.test.js` 的扫描面）；本模块**纯函数**：
//   输入一份读数，输出一段 HTML 字符串（**自己转义**；渲染层只负责插进页面）。
//
// ★措辞纪律：**名字用玩家认得的那些**（"格式指令""世界动向""账上往事""往事""关键词"），
//   不写内部词（"注入段""段号""literal/vector"）。

const esc = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const int = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0);

/** 一个小格：`标签 值`（★值里已经带好"字/条"这类单位，本函数不再自己编单位）。 */
const chip = (label, value) => `<span class="sw2-inject-item"><b>${esc(label)}</b>${esc(value)}</span>`;

/**
 * 往事那一路的说明（**哪几路真跑了、各取回几条**）——★这是"向量到底进没进去"的唯一可见处。
 * @param {object|null} past `facts.recall`
 * @param {boolean} vectorOn 向量通道开着没有（**它才是"走向量/走关键词"的开关**）
 * @returns {string} 一句人话（没有往事那一段的读数 ⇒ 空串）
 */
export function vectorPathLine(past = null, vectorOn = false) {
    if (!past) return '';
    const lit = int(past.literal), vec = int(past.vector);
    const keptLit = int(past.keptLiteral), keptVec = int(past.keptVector);
    if (!vectorOn) return '往事：只走关键词路（向量通道没开）';
    if (!vec) return lit ? `往事：关键词路取回 ${lit} 条，向量路这一轮没备好` : '往事：两路都没取到';
    return `往事：关键词路取回 ${lit} 条（装了 ${keptLit}）· 向量路取回 ${vec} 条（装了 ${keptVec}）`;
}

/**
 * 把注入器递来的读数拼成参数页那一行。
 *
 * @param {object} deps
 * @param {object|null} deps.facts         `web/inject.js` 的 `runs.last` 抽出来的那份（没跑过 ⇒ null）
 * @param {boolean} [deps.vectorOn]        向量通道（设置页「记忆通道」）开着没有
 * @param {boolean} [deps.rosterOn]        名号表那枚开关（名册那一段并进①段，要单独说清它算不算）
 * @returns {string} 一段 HTML（直接 innerHTML 用）
 */
export function injectReadoutHtml({ facts = null, vectorOn = false, rosterOn = false } = {}) {
    if (!facts || !facts.status || facts.status === 'off') {
        // ★★★（2026-10-05 · 用户第二道令）：原来这一卡底下还有一整句"原始读数"（`标签注入：…`），
        //   本笔**整行撤掉**（关键信息已经抽成上面那一行小格）⇒ "还没跑过"这句话搬到这里来说，
        //   免得玩家看到一片空白以为坏了（本仓那条老账：**读数不许留空**）。
        return '<div class="sw2-inject-row sw2-inject-row-wide">'
            + '插件现在不动你的对话：四枚开关都关着（关了即恢复原样）；'
            + '还没注入过的时候也在这一行报——世界推一轮后这里会显示上一次往对话里塞了多少字。</div>';
    }
    if (facts.status === 'fail') {
        return '<div class="sw2-inject-row sw2-inject-row-wide">上一次注入<b>写入失败</b>——这一轮什么都没塞进去（原因见控制台）。</div>';
    }
    const tags = int(facts.tagsBytes);
    const tide = int(facts.tideBytes);
    const div = int(facts.divergenceBytes);
    const past = int(facts.recalledBytes);
    // ★"往事这一段开没开"用**那一次真跑的值**（`facts.ledgerOn`）——它是那一刻的事实，
    //   不拿"现在开关在哪"去追认上一次的结果（本仓"过期货冒充新检索"那条老病）。
    const ledgerOn = Boolean(facts.ledgerOn);
    const items = [];
    // ① 格式指令 ＋ 名号表（合成一段写进去的，所以照实合成一格说；它俩都不是 0 字才报）
    items.push((tags || rosterOn)
        ? chip('格式指令＋名号表', `${tags} 字`)
        : chip('格式指令＋名号表', '未开'));
    // ② 世界动向
    items.push(tide ? chip('世界动向', `${tide} 字`) : chip('世界动向', '未开'));
    // ③ 账上往事（跟书不一样那一段**不依赖检索**，取不到往事时它照样在 ⇒ 分开报）
    if (!ledgerOn && !past && !div) items.push(chip('账上往事', '未开'));
    else {
        items.push(chip('账上往事', past ? `${past} 字` : '这一轮没取到'));
        if (div) items.push(chip('跟书不一样', `${div} 字`));
    }
    // ④ 向量路：**哪一路真在找**（自动对齐的可见处）
    items.push(chip('往事怎么找', vectorOn ? '向量＋关键词' : '关键词'));
    if (facts.count) items.push(chip('注入', `${int(facts.count)} 次`));
    const path = vectorPathLine(facts.recall, vectorOn);
    const total = int(facts.totalBytes);
    const lead = facts.status === 'empty'
        ? '开关开着，可这一次<b>一个字都没注入</b>（世界还没进内存时名册取不到）'
        : `插件上一次往你的对话里塞了 <b>${total} 字</b>`;
    return `<div class="sw2-inject-row">${items.join('')}</div>`
        + `<div class="sw2-inject-row sw2-inject-row-wide"><span class="sw2-inject-lead">${lead}</span>`
        + `${path ? `<span class="sw2-inject-sub">${esc(path)}${int(facts.recall?.overflow) ? ` · 额度装不下 ${int(facts.recall.overflow)} 条` : ''}</span>` : ''}`
        + `</div>`;
}

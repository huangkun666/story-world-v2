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
 * ★★★（2026-10-12 · 用户令「**浏览器里看到的东西不是远端服务**」）：**本地方案**那一侧的来路口径。
 *
 * 病：那一格原来只有两档——`service` 印"服务核对可见内容"，**其余一律**印"向量＋关键词/关键词"。
 *   而本地方案（浏览器世界）的检索既不是远端服务，也不只是"关键词"⇒ 不把来路说准，
 *   玩家会以为"我看到的是某个远端服务核对过的"（对本地世界是**假话**）。
 * 治法：`source === 'local'` 一律印"**本地…**"，并按读数自报的 `mode` 说清是哪几路；
 *   `mode` 没报 ⇒ 三路合起来说（**不许把没发生的事说成发生了**）。`source === 'service'` 照旧。
 */
function localRecallLabel(mode) {
    const m = String(mode ?? '').toLowerCase();
    if (m === 'vector') return '本地向量';
    if (m === 'graph' || m === 'world' || m === 'task' || m === 'tasks') return '本地图';
    if (m === 'literal' || m === 'fulltext' || m === 'text' || m === 'keyword') return '本地全文';
    if (m === 'fulltext-graph') return '本地全文与图';
    if (m === 'hybrid-graph') return '本地全文、向量与图';
    if (m === 'references') return '本地直接引用';
    if (m === 'not-requested') return '本轮未请求';
    return '本地检索';
}

/**
 * 往事那一路的说明（**哪几路真跑了、各取回几条**）——★这是"向量到底进没进去"的唯一可见处。
 * @param {object|null} past `facts.recall`
 * @param {boolean} vectorOn 向量通道开着没有（**它才是"走向量/走关键词"的开关**）
 * @returns {string} 一句人话（没有往事那一段的读数 ⇒ 空串）
 */
export function vectorPathLine(past = null, vectorOn = false) {
    if (!past) return '';
    if (past.source === 'service') return past.mode === 'limited' || past.limited ? '聊天可见内容：检索受限，已提供可确认的记录' : '聊天可见内容：已按版本核对';
    if (past.source === 'local') return past.limited ? '往事：本地检索受限，已提供可确认的记录'
        : past.mode === 'not-requested' ? '往事：本轮未请求检索'
        : `往事：${localRecallLabel(past.mode)}，已按固定版本核对`;
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
    const fullState = Object.hasOwn(facts, 'movementBytes');
    if(fullState){
        const stateOn=Boolean(facts.sceneOn),limited=Boolean(facts.stateLimited)||int(facts.stateOmitted)>0;
        const state=!stateOn?'未开':int(facts.stateBytes)?`${int(facts.stateBytes)} 字${limited?' · 受限':' · 完整'}`:facts.recall?'没有相关状态':'待准备';
        const movement=!stateOn?'未开':`${int(facts.movementBytes)} 字${int(facts.movementOmitted)?' · 未带入 '+int(facts.movementOmitted)+' 条':''}`;
        const history=!ledgerOn?'未开':past?`${past} 字`:'本次没有相关历史';
        return '<div class="sw2-inject-row">'+chip('当前状态',state)+chip('本批动向',movement)+chip('相关往事',history)+'</div>'
            +(facts.recall?.limited?'<div class="sw2-hint">历史检索受限，已提供可确认的记录。</div>':'');
    }
    // ① 这里只显示实际格式指令，不再声称包含名号表。
    items.push((tags || rosterOn)
        ? chip('格式指令', `${tags} 字`)
        : chip('格式指令', '未开'));
    // ② 世界动向
    items.push(tide ? chip('世界动向', `${tide} 字`) : chip('世界动向', '未开'));
    // ③b 当前可见状态（★★★2026-10-12：本地方案那一段"眼前情形"的读数）
    //   ★只有注入器**真把这一格递进来了**（读数里有 `sceneOn`）才画——老账与服务链路的读数里
    //     根本没有它 ⇒ 照旧一个字都不出现（**老读数行为逐字不变**，见用户"没 sceneOn 就照旧"那条）。
    //   ★三态分得开（本仓"读数不许留空"那条）：开而有内容 ⇒ N 字；开着但这一轮没有可见变更 ⇒
    //     "本场景无可见变更"；关着 ⇒ "未开"。★溢出如实报条数并指明该拧哪一格，且把这一段标成受限。
    if (Object.prototype.hasOwnProperty.call(facts, 'sceneOn')) {
        const sceneOn = Boolean(facts.sceneOn);
        const stateBytes = int(facts.stateBytes);
        const omitted = int(facts.stateOmitted);
        const limited = Boolean(facts.stateLimited) || omitted > 0;
        const body = !sceneOn ? '未开' : (stateBytes === 0 ? (limited?'当前状态读取受限':fullState?'没有相关状态':'本场景无可见变更') : `${stateBytes} 字${fullState&&!limited?' · 完整':''}`);
        items.push(chip(fullState?'当前状态':'当前可见状态', sceneOn && limited ? `${body}（受限）` : body));
        if (sceneOn && omitted > 0) items.push(chip('状态未装入', fullState?`${omitted} 条，读取受限`:`${omitted} 条，请增加状态字数`));
        if(fullState)items.push(chip('本批动向',sceneOn?`${int(facts.movementBytes)} 字${int(facts.movementOmitted)?' · 未带入 '+int(facts.movementOmitted)+' 条':''}`:'未开'));
    }
    // ③ 账上往事（跟书不一样那一段**不依赖检索**，取不到往事时它照样在 ⇒ 分开报）
    if (!ledgerOn && !past && !div) items.push(chip('账上往事', '未开'));
    else {
        items.push(chip('账上往事', past ? `${past} 字` : '这一轮没取到'));
        if (div) items.push(chip('跟书不一样', `${div} 字`));
    }
    // ④ 来路：**哪一路真在找**（自动对齐的可见处）。
    //   ★★★（2026-10-12）：本地方案（浏览器世界）**不是远端服务** ⇒ `source === 'local'`
    //     一律印"本地…"（按读数自报的 mode 说清是哪几路）；只有真服务回执才印"服务核对可见内容"。
    const recallSource = facts.recall?.source;
    items.push(chip('往事怎么找', recallSource === 'service' ? '服务核对可见内容'
        : recallSource === 'local' ? localRecallLabel(facts.recall?.mode)
        : vectorOn ? '向量＋关键词' : '关键词'));
    if (facts.count) items.push(chip('注入', `${int(facts.count)} 次`));
    const path = vectorPathLine(facts.recall, vectorOn);
    const total = int(facts.totalBytes);
    const lead = facts.status === 'empty'
        ? '开关开着，可这一次<b>一个字都没注入</b>（世界还没进内存时名册取不到）'
        : `插件上一次往你的对话里塞了 <b>${total} 字</b>`;
    return `<div class="sw2-inject-row">${items.join('')}</div>`
        + `<div class="sw2-inject-row sw2-inject-row-wide"><span class="sw2-inject-lead">${lead}</span>`
        + `${path ? `<span class="sw2-inject-sub">${esc(path)}${int(facts.recall?.omitted) ? ` · 额度装不下 ${int(facts.recall.omitted)} 条` : ''}${int(facts.recall?.overflow) ? ` · 额度装不下 ${int(facts.recall.overflow)} 条` : ''}</span>` : ''}`
        + `</div>`;
}

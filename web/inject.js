// story-world-v2/web/inject.js
// ★★★leg89：**插件第一次"会动你的对话"**——发消息前把两段塞进聊天上下文。
//   设计：`docs/spec-tagged-actions-extraction.md` §6。口径（逐条都有依据）：
//
//   ① **分两段、可分别关**（本仓 leg86 §5 的定稿纪律）：格式指令 / 名号对照 / 可选世界动向。
//      世界动向**默认关**——注入"世界状态"会让剧情越来越围着账本转（**叙事被账本殖民**）。
//   ② 走 ST 的现成口 `setExtensionPrompt(key, value, IN_PROMPT, depth, scan, SYSTEM)`
//      ⇒ `IN_PROMPT`(0) + `role=SYSTEM`。
//      ★★★leg90c：**位置曾经是 `IN_CHAT`，那是个真缺陷**——ST 的 `scripts/openai.js:1345` 是
//        `if (![BEFORE_PROMPT, IN_PROMPT].includes(prompt.position)) continue;` ⇒ `IN_CHAT`(1) 的
//        扩展提示词**根本不进发给模型的 prompt**（只躺在 ST 的字典里，所以面板读数"看着注入了"）。
//        `getPromptPosition`：`BEFORE_PROMPT(2)→'start'`、`IN_PROMPT(0)→'end'`，**其余一律 false**。
//        ⇒ 定稿 `IN_PROMPT`(0)：映射成 `'end'`，作为一条 system 消息排在提示词集合末尾。**绝不退回 1。**
//      ★**不用更重的那条路**（挂 `CHAT_COMPLETION_PROMPT_READY` 自己往 `chat` 数组里克隆 system 消息——
//        那是 yuuki 记忆插件的走法，我们不需要：它要改数组、要防重复插入，`setExtensionPrompt` 自己管这些）。
//      ⚠仍然照签名传 `depth=0`，但 **`IN_PROMPT` 下 ST 不读 depth**（`openai.js:1352` 取的是
//        `getPromptPosition(prompt.position)`）；它只在 `IN_CHAT` 那条路上有意义——而那条路是死的。
//   ③ ★**接口从 `ctx` 现取**（`SillyTavern.getContext().setExtensionPrompt`，ST 的 `scripts/st-context.js:40/144`
//      就把它挂在 ctx 上）⇒ **不 import 硬路径**（那会对安装位置产生耦合，也会让 Node 侧加载当场炸）。
//      取不到（旧版 ST / Node 侧）⇒ **静默降级为"不注入"**，但**如实报一次**（不假装注入成功）。
//   ④ 每轮**重设**（把上一轮的撤掉再写新的）：不允许上一轮那几段"冒充本轮"。
//      `MESSAGE_RECEIVED` 之后世界推完会调一次 ⇒ 下一轮发消息时它已是最新的。
//
// 零 DOM、零引擎依赖：本模块只认识"字符串"与"注入口"，可被 Node 测试直接调（注入 fake ctx）。

export const INJECT_KEY_TAGS = 'sw2_tags';       // ① 格式指令 + ② 名号对照（合成一条）
export const INJECT_KEY_WORLD = 'sw2_world';     // ③ 世界动向（默认关）

/** ★名册不封顶（leg89 更正·用户：「120个角色上顶没必要啊」）——见 `rosterText` 的注释。 */
export const ROSTER_CAP = Infinity;

// ★围栏记号：**三反引号**（本文件里不写字面量，`FENCE` 一处定义，免得与模板串那种雷同形）。
//   ★为什么这个文件里写反引号是安全的（与 `src/prompts.js` 那条雷不同）：本段只在**运行时**拼字符串、
//     经 `setExtensionPrompt` 递出去，**从不进任何模板字符串**；`prompts.js` 也不 import 它。
const FENCE = '`'.repeat(3);

/**
 * ★给聊天模型的标签规范（纯函数，Node 可测）。这就是"注入提示词让聊天llm生产带标签的内容"那段正文。
 * 写法纪律（本仓 A-3 同款）：**说人话、零引擎术语**（不出现 actions/turnFacts/id 这类词）。
 *
 * ★★★leg93（用户裁示「**就甲吧**」）：**全部标签必须包在一个 ```tags 块里**，且这段是硬要求。
 *   为什么非包不可（用户那一问「正文里有【…】呢？不能包裹在一个标签里吗？」的答案）：
 *   插件原来是**逐行扫全篇**，于是"正文里以 `【行动】` 开头的一句叙述"会被当成**真行动**、
 *   "以 `【时长】` 开头的一句叙述"会**当成本轮时长收下**（实测：`elapsed` = 「这个词表示时间流逝。」）。
 *   ⇒ 改成"**只认块里的**"：块外怎么写都不算。所以这一段必须把"**块**"讲到模型不可能误解。
 *   ★配一段**降级**：模型忘了包块时，插件退回逐行扫（老行为）——**不会整轮零标签**。
 */
export function tagSpecText() {
    return [
        '【本回合必须用标签标出"已经发生的行动"】',
        '★这是本回合的**硬要求**，不是风格建议：正文照常写，但**每一个真的做了动作的角色都要有一行标签**。',
        '缺了标签，插件这一轮就收不到任何角色的行动（这一轮白跑）——所以**先保证标签，再谈文风**。',
        '',
        `★★把所有标签**集中放在正文最末尾的一个 ${FENCE}tags 块里**（前后各一行 ${FENCE} 围栏，照下面那样写）。`,
        '**只有这个块里面的标签插件才看**；块外面写了也不作数（所以正文里怎么引用、怎么打比方都不会被误读）。',
        '',
        `${FENCE}tags`,
        '【时长】三天',
        '【场景：忘川渡口】',
        '【行动】薛铁衣｜迎战｜黄坤',
        '【行动】孟婆｜探查｜灵脉',
        FENCE,
        '',
        '规则：',
        `1. **一个 ${FENCE}tags 块**，放在正文**最末尾**；开围栏那一行**只有** ${FENCE}tags 这四个字加三个反引号，别的一律不写。`,
        '2. **一个标签占一整行**——行首不许有别的东西（不缩进、不加「-」或「*」或「1.」），行尾也不许再跟别的标签。',
        '3. 【时长】表示**从这里起又过了多久**（三天／半晌／一炷香／半月）。可以出现多次，表示时间继续往后走。',
        '4. 【场景：X】表示**这一场戏在哪儿**（X 用下面【本世界的名号】里列出的**地名**）。换了地方就再写一条。',
        '5. 【行动】一行一条，中间用**全角竖线｜**分开，依次是：**谁做的｜做了什么｜针对谁**。后两格可以不写，第一格必须有。',
        '6. ★第三格（针对谁）**知道就写、不知道就不写**：针对的是某个人或某样东西，就把他的名字写进去（写「迎战黄坤」不写「迎战」）；实在说不清对象是什么，就空着不写——**不要为了凑格式编一个名字**。',
        '7. 只标**真的做了动作**的人：只是在场、只是被提到、只是说话，都不算。',
        '8. **主角（你正在扮演的那位玩家）的行动照样标**——插件只是记下来，不会替他做决定。',
        '9. 【场景：X】以下的行动都算在这个场景里，不用每条都写地点。',
        '10. ★**写完之后自己数一遍**：这一轮有几个人真的动了手？他们是不是每个人都有一行【行动】？**漏一个就等于这一轮少记了一个人的事。**',
        '',
        '★**自检（照这个查）**：正文末尾应当有**这一个块**，像这样——',
        `${FENCE}tags`,
        '【时长】三天',
        '【场景：忘川渡口】',
        '【行动】薛铁衣｜迎战｜黄坤',
        '【行动】孟婆｜探查｜灵脉',
        '【行动】黄坤｜搜刮｜阴阳玉',
        FENCE,
        '没有这个块 = 这一轮没达标。',
        '',
        '★标签是**给插件读的路标**：正文写法照旧自由（**块外**想怎么写就怎么写、想怎么提这些记号都行），**不必**为了标签改你的叙事——但**这个块必须有**。',
    ].join('\n');
}

/**
 * ★名号对照（纯函数）：让聊天模型写标签时**有名字可抄**（这是插件能把标签对上账的前提）。
 *   ★只给"名号 + 别名"这两样：不给 id（模型又不用 id）、不给状态与位置（那是世界模型那一侧的账，
 *     塞进聊天上下文只会引导剧情围着账本转）。
 * ★★leg89（用户拍板「模型认得出那就直接按照插件的正名来看」）：别名的真源是**书**——
 *   账上实体不带别名（播种只拷 id/kind/name/location/parent/实力…），别名留在 `canon.bookEntities`。
 *   ⇒ 名册按正名列出，**把书名录里登记的别的叫法括在后面**（有才写），模型写哪个都认得出。
 *   账上有、书里没有的名字照样列（世界模型后续入局的实体书里当然没有）。
 */
export function rosterText(world, { cap = ROSTER_CAP } = {}) {
    const aliasOf = new Map();   // 正名（归一后）→ 别名数组
    for (const c of world?.context?.setting?.frozen?.canon?.bookEntities || []) {
        const n = String(c?.name || '').trim();
        if (!n) continue;
        const list = (c.aliases || []).map((a) => String(a || '').trim()).filter(Boolean);
        if (list.length && !aliasOf.has(n)) aliasOf.set(n, list);
    }
    const active = (world?.entities || []).filter((e) => e?.name && (e.status || 'active') === 'active');
    // ★★★leg89 更正（用户：「120个角色上顶没必要啊」）：**不封顶**。
    //   为什么原设计封顶是错的：这张表是"让模型写对名字"的**必需料**——砍掉的那部分，
    //   模型写了也认不出（会变成"不在名册"），砍它等于**自己制造归不上**。
    //   要省 token 该省别处，不该省这张表（它一项就是"名号（也叫 别称）"，很轻）。
    //   ⚠`cap` 形参保留（既有调用点/判据可自设上限），生产路径不再传它。
    const room = Number.isFinite(cap) ? Math.max(0, cap) : active.length;
    // 地点表：`context.positions`（`derivePositions` 按这本书的地名建）——只列真地名，略过占位词「未明」
    const places = (world?.context?.positions || [])
        .map((p) => String(p || '').trim())
        .filter((p) => p && p !== '未明');
    const rows = active.slice(0, room).map((e) => {
        const alias = aliasOf.get(String(e.name).trim()) || (e.aliases || []).filter(Boolean);
        return alias.length ? `${e.name}（也叫 ${alias.join('、')}）` : e.name;
    });
    if (!rows.length && !places.length) return '';
    const more = active.length > room ? `（另有 ${active.length - room} 位未列出）` : '';
    // ★★★leg89 更正：**地名要一起给**。理由（两处，都是实核出来的）：
    //   ① 注入的规范里写着「【场景：X】用名册里的地名」——而第一版的名册**只有人名**（自相矛盾）；
    //   ② 引擎侧对场景做归一（`tag-extract.js` 拿 `context.positions` 对），
    //      模型凭空写的地名会被标成"不在账上的地名"⇒ 地点事实整体打折。
    //   地点表来自 `context.positions`（`derivePositions` 按**这本书**的地名建的，134 项 ≈ 180 est，很轻）。
    const placeLine = places.length ? `\n【本世界的地名】\n${places.join('、')}` : '';
    return `【本世界的名号】\n${rows.join('、')}${more}${placeLine}\n`
        + `（写标签时用这里的**正名**（括号里的是别叫法，写了插件也认）；这些之外的生名字插件认不出。）`;
}

/**
 * 组装要注入的那两段（纯函数，便于判据逐字锁）。
 * @returns {{tags: string, world: string}} 空串 = 该段不注入
 */
export function buildInjections(world, { roster = true, spec = true, worldTide = false } = {}) {
    const tags = [
        spec ? tagSpecText() : '',
        roster ? rosterText(world) : '',
    ].filter(Boolean).join('\n\n');
    // ③ **世界动向 = 这一轮世界发生了什么**（`runTick` 结算后写进 `meta.lastInjection` 的编年条目）。
    //   ★★★leg89 补（用户：「**把这一轮世界发生了什么注入上下文啊**」）：这一格**原来是空的**——
    //     我第一版读 `meta.lastInjection` 而**全仓零处写它**（那段只在 demo 脚本里被打印过）
    //     ⇒ 那个开关是个**死开关**（开了什么都不发生）。现在写读两端都接上了。
    //   ★时差（设计，不是 bug）：世界步在**这一轮收到消息之后**才结算 ⇒ 注入进下一轮聊天上下文的是
    //     "上一轮结算出来的这一轮"。这是"账按轮走、故事按时间走"的代价，要在界面上说明白。
    //   ★包一层标题，让聊天模型一眼看出这是**已经发生过的世界事实**（不是让它去写的剧本）。
    const tide = worldTide && world?.meta?.lastInjection
        ? `【世界动向 · 已经发生的事】\n${String(world.meta.lastInjection)}`
        : '';
    return { tags, world: tide };
}

/**
 * 注入器（依赖注入式工厂，照本仓 `createParamHub`/`createSnapshotHub` 的先例：**注入的是函数不是值**）。
 * deps: `{ getCtx, getWorld, isOn, setStatus }`
 *   - `getCtx()`   现取 ST 上下文（**不许抓死**：换聊天/换卡后上下文会换）
 *   - `getWorld()` 现取当前世界（拿名册）
 *   - `isOn(key)`  读设置开关（缺省 false = 不注入）
 *   - `setStatus(msg)` 如实出声（取不到注入口时只报一次）
 */
export function createInjector({ getCtx, getWorld, isOn = () => false, setStatus = () => {} } = {}) {
    if (typeof getCtx !== 'function' || typeof getWorld !== 'function') {
        throw new TypeError('createInjector：`getCtx` 与 `getWorld` 必须是函数（注入的是函数不是值）');
    }
    let warned = false;
    let lastLine = null;
    // ★★★leg92：**跑过的证据**（用户报"开关是 1、字典里却没有"时，这一格能一眼分开"没跑"与"跑了失败"）。
    //   记的是**事实**：调用了几次、最后一次什么结果、什么时候。
    const runs = { count: 0, lastOk: null, lastOff: null, lastChars: 0, lastAt: null };

    const readApi = () => {
        const ctx = getCtx();
        const fn = ctx?.setExtensionPrompt;
        const types = ctx?.extension_prompt_types || ctx?.extensionPromptTypes;
        // ★★★leg90c 真因修（用户：「**上下文我好像都没看见注入**」）：
        //   原来这里用的是 **`IN_CHAT`（=1）**——那是 leg89 设计时拍的口径（"贴着最后一条消息"），
        //   而它在 **chat completion 的组装阶段被整段丢掉**。ST 源码（`scripts/openai.js`）：
        //     · 1345 行：`if (![BEFORE_PROMPT, IN_PROMPT].includes(prompt.position)) continue;`
        //       ⇒ **`IN_CHAT` 的扩展提示词根本不进 prompt**（不进 = 模型永远收不到）；
        //     · `getPromptPosition`：`BEFORE_PROMPT(2)→'start'`、`IN_PROMPT(0)→'end'`，**其余一律返回 false**。
        //   ⇒ 我们那两段一直只写在 ST 的字典里（所以面板读数/`extensionPrompts` 都"看得见"），
        //     **却一次都没进过发给模型的 prompt**。这解释了"读数说注入了 475 字、模型就是不写标签"。
        //   ★定稿用 **`IN_PROMPT`(0)**：映射成 `'end'`，作为一条 system 消息排在提示词集合末尾
        //     （既有"靠后=更受注意"的好处，又真的进 prompt）。`scan=false` 照旧。
        //   ★取不到常量时退回**字面量 0**（`IN_PROMPT`，`script.js:449`）；**绝不退回 1**。
        const inPrompt = typeof types?.IN_PROMPT === 'number' ? types.IN_PROMPT : 0;
        const sysRole = 0;   // extension_prompt_roles.SYSTEM → getPromptRole → 'system'
        return typeof fn === 'function' ? { fn: fn.bind(ctx), position: inPrompt, sysRole } : null;
    };

    /** 撤掉上一轮注入的两段（**先撤后写**：绝不让上一轮冒充本轮）。 */
    function clear() {
        const api = readApi();
        if (!api) return false;
        try {
            api.fn(INJECT_KEY_TAGS, '', api.position, 0, false, api.sysRole);
            api.fn(INJECT_KEY_WORLD, '', api.position, 0, false, api.sysRole);
            return true;
        } catch (_) { return false; }
    }

    /**
     * 按当前设置与世界**重设**注入。返回自证读数（面板/控制台都读它）：
     * `{ ok, off, tagsChars, worldChars, line }`。★`off` = 玩家把开关关了（**不是失败**，别报成失败）。
     */
    function apply() {
        const spec = Boolean(isOn('injectTagSpec'));
        const roster = Boolean(isOn('injectRoster'));
        const tide = Boolean(isOn('injectWorldTide'));
        const stamp = () => {
            runs.count += 1;
            runs.lastAt = (() => { try { return new Date().toISOString(); } catch (_) { return null; } })();
        };
        if (!spec && !roster && !tide) {
            clear();
            lastLine = '标签注入：已关（插件不看也不动你的对话）';
            stamp(); runs.lastOk = true; runs.lastOff = true; runs.lastChars = 0;
            return { ok: true, off: true, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        const api = readApi();
        if (!api) {
            // ★如实降级：注入口取不到就别假装注入成功（也只吵一次，别每轮刷屏）
            lastLine = '标签注入：这个 ST 版本没有"往上下文里塞东西"的接口——已跳过（世界照常推进）';
            if (!warned) { warned = true; setStatus?.(`⚠ ${lastLine}`); }
            stamp(); runs.lastOk = false; runs.lastOff = false; runs.lastChars = 0;
            return { ok: false, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        const { tags, world } = buildInjections(getWorld(), { spec, roster, worldTide: tide });
        try {
            if (tags) api.fn(INJECT_KEY_TAGS, tags, api.position, 0, false, api.sysRole);
            else api.fn(INJECT_KEY_TAGS, '', api.position, 0, false, api.sysRole);
            if (world) api.fn(INJECT_KEY_WORLD, world, api.position, 0, false, api.sysRole);
            else api.fn(INJECT_KEY_WORLD, '', api.position, 0, false, api.sysRole);
        } catch (err) {
            lastLine = `标签注入：写入失败（${err?.message || err}）——这一轮没有注入`;
            setStatus?.(`⚠ ${lastLine}`);
            stamp(); runs.lastOk = false; runs.lastOff = false; runs.lastChars = 0;
            return { ok: false, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        warned = false;
        stamp(); runs.lastOk = true; runs.lastOff = false; runs.lastChars = tags.length + world.length;
        // ★leg90c：读数里**明写位置**——它是这一段能不能真进 prompt 的判据（`IN_PROMPT`=0 → ST 映射成 'end'）。
        // ★★★leg92：**开关开着、但一个字都没注入**（世界没进内存 ⇒ 名册取不到 ⇒ 两段都空）
        //   必须**明说**，否则它和"已关"在界面上长得一样（这正是 leg92 那个真缺陷被藏了这么久的原因）。
        if (!runs.lastChars) {
            lastLine = `标签注入：⚠ 开关开着，但这一次**一个字都没注入**`
                + `（名册/世界动向都需要世界账；世界还没进内存时取不到）· position=${api.position}`;
            setStatus?.(`⚠ ${lastLine}`);
            return { ok: true, off: false, tagsChars: 0, worldChars: 0, line: lastLine, runs: { ...runs } };
        }
        // ★★★leg93 修（读数印错名·会误导排查）：这一格原来是 `名册 ${world.length} 字`——
        //   **世界动向那段（`world`）的字数被印成了"名册"**。名册根本不在这里：它在 ① 段里
        //   （`buildInjections` 把 `rosterText()` 并进 `tags`，本仓从 leg89 起就是这个形状）。
        //   ⇒ 照实分开印：① 段的字数 + ③ 段的字数（各叫各的名字）。
        lastLine = `标签注入：格式指令 ${tags.length} 字 · 世界动向 ${world.length ? `${world.length} 字` : '（未开）'}`
            + `（作为一条系统提示词排在提示词末尾 · position=${api.position}；插件只注入这两段，不读也不改你的正文）`;
        return { ok: true, off: false, tagsChars: tags.length, worldChars: world.length, line: lastLine, runs: { ...runs } };
    }

    // ★leg92：`runs` 也交出去——"跑过没有"是排查第一问（见上面那段注释）。
    return { apply, clear, readApi, _last: () => lastLine, _runs: () => ({ ...runs }) };
}

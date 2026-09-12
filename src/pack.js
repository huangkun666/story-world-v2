// story-world-v2/src/pack.js
// 演化上下文打包（S4/S5 共用）：世界自身状态 + 玩家落子事实 → 主调用输入。
// 长跑防线细案 §2.1：预算常量（原提案 4k tokens 已废；第十九棒 K44 拍板 30k，见下方 EVOLUTION_BUDGET_TOKENS）+ 固定打包序 + 超限剪枝。
// K44/第十九棒（full-roster-lens-spec C2/C7 拍板）：实体段=**镜头选择器**——
//   全量棋盘上按「四段确定性序：①例外保送（被点名/在飞盘算属主/近 2 tick 活跃）②手上有在办盘算 ③近 5 轮出手 ④实体 id 序」排序、30k 内取前缀；
//   势力实体附「麾下成员」简表（parent 派生反查，含分支成员）；分量数字仍不入包（P3 不变）。
export const EVOLUTION_BUDGET_TOKENS = 30000; // 用户 2026-09-09 定案（"现在的大模型绝对有这个能力"）；镜头容量=预算内自适应
export const LENS_DEFAULT_MAX_TOKENS = 30000; // 镜头（实体段）独立上限（同值；测试可注入小值验证截断机制）
export const LENS_MEMBERS_TOP = 8;            // 势力麾下成员简表条数上限（份内按**名号序**，leg25 b 前为分量序；超出记「等 N 人」）
export const TOKEN_RATIO = 3;                // 粗略估计：1 token ≈ 3 字符（中文）
export const DIALOGUE_BOOK_TOP = 5;          // 提案：K38 补差包——依据册摘要进包条数上限（敲定稿 C 条）

// 镜头名单（引擎层纯函数只读，一处定义多处读取）：全量 active 实体 → 四段确定性序（leg24 片3）：
//   ① 保送（moveFact.object / 未决事件 ripples / 在飞盘算属主 / lastActiveTick ≥ tick−2）
//   ② 手上有在办盘算者（盘算"年纪" new→old：memory.turnsAlive 小者先）
//   ③ 近 LENS_RECENT_TICKS 轮出手者（近→远）
//   ④ 其余按实体 id（字典序）
// 段内同值时一律取 id 序兜底 —— **全程零分数**（旧法：第④段按分量降序，那个数已随 leg24 片3 退场）
// 分量只用于排序，不随行输出（P3：模型看不到分量数字）。
export const LENS_RECENT_TICKS = 5;   // 提案（片3）：镜头第③段"近期出手"的轮数窗（原按分量降序，无窗可言）
// 体积估计（leg25：**模块级唯一一份**）——1 token ≈ 3 字符（中文），向上取整。
// 为什么提到模块级：此前 `lensList` 与 `trimPack` 各自持有一份同名局部 `est`/`estBudget`，
//   trimPack 被接进生产路径后，任何一次"只改一处"的编辑都可能让裁剪路径上的调用点悬空
//   （报错形态：`ReferenceError: est is not defined`，且**只在真的超预算时才炸**，小世界冒烟看不见）。
//   现在两处共用同一个函数：没有第二份可漂移的副本，也没有"函数声明在调用点之后"的写法。
//
// ★leg31 实体段表达法收改（细案 `docs/spec-entity-section-encoding.md`）：
//   量体**必须与真正发出去的文本同一个函数**，否则预算就成了"两把尺子"。故本函数改走 `packTextOf`
//   （= 面向模型的唯一序列化口径），实体段按行式表格称重，不再按实体逐个 JSON 对象称重。
const estTokensOf = (value) => Math.ceil(packTextOf(value).length / TOKEN_RATIO);

// ---------- leg31：实体段行式表格（表达法收改，零信息损失） ----------
// 病根（真账 tick 17 实测，618 实体）：实体段吃整包 96.8%，而其 56,047 个字符里
//   **键名 45.5% + JSON 标点 10.8% = 56% 是纯结构开销**（618 行各写一遍 `"kind":` …），真内容·汉字只占 12.2%。
//   ⇒ 表头只写一次、行内 TAB 分列 ⇒ 整包 est 19,306 → 9,789（**−49.3%**，下界口径亦 ≥49.6%）。
// ★只改**序列化**、不改**内部形状**：`pack.entities` 仍是对象数组 ⇒ trimPack 的按行删键（.slim/.idOnly）、
//   面板、测试判据**全部零连扰**；`JSON.parse(pack.text)` 往返性也仍成立（整段换成一个字符串格）。
// 空值 = **空列**（不用 `—` 充数，沿用硬规矩二"空着就是空着"）；`locationNote`（`（推）`）**并进 location 值**，
//   因为它是"结构推断"标记、不是独立事实，并进去信息零损失（实测 3,231 个非空格逐格还原一致）。
// 分隔符实测：真账 618 行全部值（含 members 逐元素）对 TAB/竖线/换行**命中 0**；
//   但那是**单本读数**（泛用性铁律 §2 第 3 条）⇒ 下方 `entityTableAnomalies` 把它变成**出包期机械自检**，不靠"我看过没问题"。
export const ENTITY_TABLE_HEADER = ['id', 'kind', 'name', 'location', 'parent', '实力', 'members'].join('\t');
const ENTITY_TABLE_COLS = ENTITY_TABLE_HEADER.split('\t');

// 一行的取值（缺列返回 ''）
const entityCell = (r, f) => {
    if (f === 'location') return r.location == null ? '' : `${r.location}${r.locationNote ?? ''}`;
    if (f === 'members') return Array.isArray(r.members) && r.members.length ? r.members.join('、') : '';
    return r[f] == null ? '' : String(r[f]);
};
// ★**保留全列对齐**（细案 §2.2/§8 的决定）：尾部空列**不收**——虽然收掉能多省 481 est（51.8% vs 49.3%），
//   但"某行少几列"会让模型误判列序（`e_p1` 那行若只剩 4 列，"第 6 列是 members"这条就读不出来了）。
//   **不拿可读性换这 1.6 个百分点**。空列一律写空字符串（TAB 相邻）。
const entityRowText = (r) => ENTITY_TABLE_COLS.map((f) => entityCell(r, f)).join('\t');

// ★自检（不改变输出，只上报）：任一格的**值本身**含 TAB/换行 ⇒ 会串列，必须显形（判据 C）。
//   ⚠实现纪律：**不许用"数 TAB 个数"判**——`entityRowText` 会收掉尾部空列（`e_p1` 只有 4 列），
//   按 TAB 计数对"尾部缺列"永远数不出来（本判据的第一版就栽在这，被新加的用例当场抓红）。
export function entityTableAnomalies(rows) {
    const bad = [];
    for (const r of Array.isArray(rows) ? rows : []) {
        const cellHasDelim = ENTITY_TABLE_COLS.some((f) => /[\t\n]/.test(entityCell(r, f)));
        if (cellHasDelim) bad.push(r?.id ?? '(无 id)');
    }
    return bad;
}

// 行式块：表头 + 每行一条（每行末尾的 `\n` 在 JSON 里要转义成 2 字符 ⇒ 用 join 拼、不留尾空行）
function entityTableBlock(rows) {
    if (!Array.isArray(rows) || !rows.length) return '';
    return ENTITY_TABLE_HEADER + '\n' + rows.map(entityRowText).join('\n');
}

// 行式块 → 对象数组（**仅供判据 D 做无损核对**，生产路径不回读：check-step 校验拿的是 ssot，不是 pack）
export function parseEntityTableBlock(block) {
    const [head, ...lines] = String(block ?? '').split('\n');
    const cols = head.split('\t');
    return lines.filter((l) => l !== '').map((l) => {
        const parts = l.split('\t');
        const row = {};
        cols.forEach((f, i) => { if (parts[i]) row[f] = parts[i]; });
        const m = /^(.+?)（推）$/.exec(row.location ?? '');
        if (m) { row.location = m[1]; row.locationNote = '（推）'; }
        if (row.members) row.members = row.members.split('、');
        return row;
    });
}

// ★面向模型的**唯一**序列化口径：只有实体段换行式块，其余九段逐字节不变；
//   未带 entities 的值走原样 —— 故 `lensList` 对**单行**量体（无 entities 键）零扰动。
export function packTextOf(pack) {
    return JSON.stringify(pack, (key, value) => (key === 'entities' ? entityTableBlock(value) : value));
}

export function lensList(ssot, { lensMaxTokens = LENS_DEFAULT_MAX_TOKENS, moveFact = null } = {}) {
    const est = (line) => estTokensOf(line);   // 行内估体：估的是**单行字符串**（与整包估计同一个函数）
    const tick = ssot?.meta?.tick ?? 0;
    const named = new Set();
    const obj = moveFact?.object;
    if (obj && typeof obj === 'string') named.add(obj);
    for (const ev of ssot?.events || []) if (!ev.closed) for (const r of ev.ripples || []) named.add(r);
    for (const ag of ssot?.agendas || []) if (!ag.closed) named.add(ag.owner);
    // 段②的输入：每个属主手上最"老"的在飞盘算年纪（turnsAlive 缺省按 0=刚生）
    const oldest = new Map();
    for (const ag of ssot?.agendas || []) {
        if (ag.closed) continue;
        const age = typeof ag.memory?.turnsAlive === 'number' ? ag.memory.turnsAlive : 0;
        if (!oldest.has(ag.owner) || age < oldest.get(ag.owner)) oldest.set(ag.owner, age);
    }
    const seg = (e) => {
        if (named.has(e.name) || named.has(e.id)
            || (typeof e.lastActiveTick === 'number' && tick - e.lastActiveTick <= 2)) return 0;   // ① 保送
        if (oldest.has(e.id)) return 1;                                                            // ② 有在办的事
        if (typeof e.lastActiveTick === 'number' && tick - e.lastActiveTick <= LENS_RECENT_TICKS) return 2;   // ③ 近期出手
        return 3;                                                                                  // ④ 其余
    };
    const rows = (ssot?.entities || [])
        .filter((e) => !e.status || e.status === 'active')      // K37 三点过滤①：retired/dead 出演化上下文
        .map((e) => ({ e, seg: seg(e), age: oldest.get(e.id) ?? 0, idle: tick - (e.lastActiveTick ?? -Infinity) }))
        .sort((a, b) => (a.seg - b.seg)
            || (a.seg === 1 ? a.age - b.age : 0)                            // ② 段内：盘算年纪 new→old
            || (a.seg === 2 ? a.idle - b.idle : 0)                          // ③ 段内：出手 近→远
            || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));           // 全部兜底：id 序（确定性）
    const out = [];
    let used = 0;
    for (const { e } of rows) {
        const line = JSON.stringify([e.id, e.name, e.kind]);
        const cost = est(line);
        if (out.length && used + cost > lensMaxTokens) break;    // 前缀截断（至少保留首名，防御空镜）
        used += cost;
        out.push({ e, w: ssot?.weights?.[e.id] ?? 0 });          // w 仅向后兼容保留：已无任何引擎消费者（片3）
    }
    return out;
}

// 麾下成员简表（C7 派生反查）：characters 的 parent 命中 实体名/其分支名 → 归该势力；
//   取前 LENS_MEMBERS_TOP（按名号字典序，同值按 id 兜底——**确定性**）。
// leg25 b（A1）：排序键由 `world.weights`（那个 0-1 的数）改**名号序**——片3 定案「引擎不拿数值排序」的
//   最后一处残留。旧法在 leg24 片2 之后必然退化：势力成员普遍四维为空 → 同取中立 floor → 分量全等 →
//   排序结果随底层数组顺序漂移，面板「麾下：」名单每次重算都可能换位。现在名号序逐字节稳定。
export function membersOf(world, faction) {
    const scope = new Set([faction.name, ...(faction.branches || [])]);
    const list = (world?.entities || [])
        .filter((e) => e.kind === 'character' && e.parent && scope.has(e.parent))
        .sort((a, b) => {
            const an = String(a.name ?? ''), bn = String(b.name ?? '');
            if (an !== bn) return an < bn ? -1 : 1;                   // ① 名号序（人可读，确定性）
            return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;            // ② 同名兜底：id 序
        });
    if (!list.length) return null;
    const heads = list.slice(0, LENS_MEMBERS_TOP).map((e) => e.name);
    if (list.length > LENS_MEMBERS_TOP) heads.push(`等${list.length}人`);
    return heads;
}

// 固定打包序：活跃实体简表 → 在飞盘算（含 memory）→ 未决事件 → 最近 2 tick 关闭事件 → 玩家落子事实 → 张力
// 已结算盘算不再喂给模型（防满步重播，活档实测发现）
// K2/P3：分量不再入包（ANCHOR §3③：模型看不到分量、不参与分量；门控在引擎侧兜底）
// leg25：出包末尾**强制整包预算**（超限按固定剪枝序裁，包内留 `trimmed` 痕迹；见 trimPack）
export function buildEvolutionPack(ssot, moveFact, { picks = null } = {}) {
    // K44：镜头选择器——全量棋盘有序入镜（保送+分量序），预算内前缀；分量不随行泄漏（P3）
    // 细案 spec-entity-field-lookup §3（用户 2026-09-11 批准）：**选择权归 LLM 时**传 picks——
    //   名单改用"本轮上场选择器"选的实体（引擎只做校验，见 entity-lookup.js），不再按预算截前缀。
    //   为什么必须换：lensList 是**引擎**按 30k 预算截前缀，镜头外的人连"想让谁动"都表达不了；
    //   leg24 片3 前按分量算的静默线实测把 345/346 全判静默（引擎实际上禁止了所有人出手）。
    //   picks 缺省=null 时行为与旧版逐字节一致（旧路径零扰动；预算仍由 trimPack 整包兜住）。
    const lens = picks
        ? picks.map((id) => ({ e: (ssot.entities || []).find((x) => x.id === id) })).filter((x) => x.e)
        : lensList(ssot, { moveFact });
    // leg25：实体行默认**全字段**（含麾下成员简表等重字段）；整包超预算时按固定剪枝序逐级降级
    //   （见 trimPack 的 entities.slim / entities.idOnly）。不裁时行内容与旧版逐字节一致。
    const entityRow = (e, mode) => {
        if (mode === 'idOnly') return { id: e.id, name: e.name };   // 最坏情况的兜底形态（视野仍在：还有名字）
        const row = { id: e.id, kind: e.kind, name: e.name, location: e.location };
        // leg25 d：**位置是"结构推出"还是"书里明述"必须让模型看出来**——不标的话它就当书里的
        //   事实用（用户质疑"推错会不会帮倒忙"）。来源落账在 meta.entityFields[id].位置来源。
        const locSrc = ssot.meta?.entityFields?.[e.id]?.位置来源;
        if (row.location && locSrc === '结构推导') row.locationNote = '（推）';
        if (e.parent) row.parent = e.parent;                      // C7：从属（角色→势力/分支）
        // 细案 spec-entity-field-lookup：按需查书补的 `实力`（文本）随行入包——**角色才有**
        //   （势力不写实力，用户拍板；势力实力在面板用麾下成员派生显示）。引擎不读它、不进任何公式。
        if (e.kind === 'character' && typeof e['实力'] === 'string' && e['实力'].trim()) row['实力'] = e['实力'];
        if (e.kind === 'faction' && e.branches?.length) row.branches = e.branches;   // C8：分支表
        if (e.kind === 'faction' && e.organs?.length) row.organs = e.organs;         // leg23：名下机构/部门（书里明述）
        if (e.kind === 'faction' && mode === 'full') {
            const members = membersOf(ssot, e);                   // C7：麾下成员简表（派生；逐行最重的可选字段）
            if (members) row.members = members;
        }
        return row;
    };
    const entities = lens.map(({ e }) => entityRow(e, 'full'));
    const agendas = (ssot.agendas || []).filter((a) => !a.closed).map((a) => ({
        id: a.id, owner: a.owner, goal: a.goal, stage: a.stage,
        visibility: a.visibility, progress: `${a.progress}/${a.maxSteps}`, memory: a.memory,
        parentId: a.parentId,   // K14（K13 施工补差，细案 §3.5）：树形是"谋划的结构"，可见；分量数字不可见原则 P3 不动
    }));
    const pendingEvents = (ssot.events || []).filter((e) => !e.closed).map((e) => ({
        id: e.id, title: e.title, source: e.source, position: e.position,
    }));
    const closedEvents = (ssot.events || []).filter((e) => e.closed).slice(-2).map((e) => ({
        id: e.id, title: e.title,
    }));
    const dyn = ssot.context?.setting?.dynamic;   // K29：设定大势块（只读注入；冻结层不入包——体积纪律 A-8）
    // K38 补差包（敲定稿 C 条）：对话依据册摘要进包——"谁反复被点名"模型看得见（dialogueFact 源/镜头依据；
    // 只取前 TOP 条，计数+最近提及轮；依据册总量留在账上）
    const db = ssot.meta?.dialogueBook;
    const dialogueBook = db && typeof db === 'object'
        ? Object.entries(db)
            .map(([name, rec]) => ({ name, count: rec?.count ?? 0, lastTick: rec?.lastTick ?? 0 }))
            .sort((a, b) => b.count - a.count || b.lastTick - a.lastTick)
            .slice(0, DIALOGUE_BOOK_TOP)
        : [];
    const pack = {
        world: ssot.context?.world,
        // 张力：有 setting 取演化层强度（引擎算），无则回退 context.tension 数字（细案 §3.1 兼容口径）
        tension: dyn ? dyn.tension?.intensity : ssot.context?.tension,
        setting: dyn ? { tension: dyn.tension, env: dyn.env ?? {} } : undefined,   // 大势块：张力三件 + 环境量（固定小结；derivedFrom 属引擎记账不入包）
        positions: ssot.context?.positions,
        entities,
        agendas,
        pendingEvents,
        recentClosedEvents: closedEvents,
        playerMove: moveFact || null,
        dialogueBook,
    };
    // leg25（死代码接线）：**总预算在这里强制**。此前 `trimPack` 全仓生产 0 调用——
    //   lensList 只按 lensMaxTokens 截**实体段**，agendas/pendingEvents/setting/positions **不参与任何裁剪**，
    //   30k 预算等于纸面数字（余量正被名册增长吃掉）。现改为：出包即自检**整包**预算，超限即按固定剪枝序裁。
    // 裁剪痕迹以 `pack.trimmed = ['recentClosedEvents', ...]` 留在**包里**（机器可读）：模型与调试者都知道
    //   "你看到的是删过的"，不是静默丢料。未裁剪时不写该键（旧输出逐字节不变，防回归）。
    // 降级通道：实体行按需重建（**惰性**——不裁剪时一次都不建，输出与原实现逐字节一致）
    Object.defineProperty(pack, '__relight', {
        value: (mode) => lens.map(({ e }) => entityRow(e, mode)),
        enumerable: false, writable: false, configurable: false,
    });
    trimPack(pack, EVOLUTION_BUDGET_TOKENS);
    // 判据 C（细案 §5）：行式分隔符冲突**出包期机械自检**，不靠"我看过没问题"。
    //   单本实测命中 0，但那是单本读数 ⇒ 一旦某世界书的名字里带 TAB/换行，这里如实上报（并并入 trimmed 痕迹）。
    const anomalies = entityTableAnomalies(pack.entities);
    if (anomalies.length) {
        pack.tableAnomalies = anomalies.slice(0, 5);
        if (!pack.trimmed) pack.trimmed = [];
        pack.trimmed.push('entities.tableAnomaly');
    }
    const text = packTextOf(pack);   // ★细案 §2.1：唯一序列化口径；estTokensOf 同一个函数 ⇒ 不存在"两把尺子"
    return { pack, text, estTokens: Math.ceil(text.length / TOKEN_RATIO) };
}

// 预算强制（leg25：`trimPack` 死代码接线而来——**函数本体保留**，只是现在真的有人调用它）。
// 固定剪枝序（确定性、可复现、与输入顺序无关；每段前重新量体，压进预算即停）：
//   ① entities.slim（实体行逐出重可选字段：麾下成员简表 / 分支表 / 机构表——**一并**逐出，
//      因为"只逐出成员"这一级在实测场景里从不成立，写进痕迹只会变成假账）
//   ② entities.idOnly（实体行只剩 id+name——视野仍全量，细节最省）
//   ③ recentClosedEvents（只留 id）④ pendingEvents（只留 id+title）⑤ agendas.detail（只留 id+goal+progress）
// 就地裁剪传入的 pack 并**把裁剪痕迹写进包里**（`pack.trimmed = [...]`，机器可读：模型与调试者都知道
//   "你看到的是删过的"，不是静默丢料）；未裁剪时不写该键（旧输出逐字节不变，防回归）。
// 返回被裁字段名清单（空数组=未裁，包原样）。就地改是安全的：buildEvolutionPack 每 tick 新建 pack，
//   不与调用方共享引用（旧版 structuredClone 版本正是"没人调用"的死代码形态）。
// 实测说明（900 实体/300 未决事件/300 在飞盘算的记账场景）：只靠 ③④⑤ 压不进 30k——实体段本身就吃满预算，
//   故剪枝序前移两段实体降级；最坏情况仍越界时留 `budgetOverrun` 痕迹（不静默炸预算）。
export function trimPack(pack, budgetTokens = EVOLUTION_BUDGET_TOKENS) {
    const cut = [];
    const stage = (name, reduce) => {
        // 每一段前重新量：压进预算即停（序固定 → 结果确定）。量体走模块级 estTokensOf（见文件头部说明：
        //   裁剪路径上不留任何可悬空的局部辅助名——小世界冒烟走不到这里，只有真超预算才会执行）。
        if (estTokensOf(pack) <= budgetTokens) return;
        reduce();
        cut.push(name);
    };
    // ① 实体行：逐出麾下成员简表（C7 派生，逐行最重）/ 分支表（C8）/ 机构表（leg23）——核心字段与 parent 保留
    stage('entities.slim', () => {
        if (pack.__relight) pack.entities = pack.__relight('slim');
    });
    // ② 实体行：只剩 id+name（最省形态；镜头次序与人数不变——"谁在棋盘上"不丢，"细节"丢）
    stage('entities.idOnly', () => {
        if (pack.__relight) pack.entities = pack.__relight('idOnly');
    });
    // ③ 最近关闭事件：本 tick 已不是主料（防满步重播），只留 id 供回溯
    stage('recentClosedEvents', () => {
        if (pack.recentClosedEvents?.length) pack.recentClosedEvents = pack.recentClosedEvents.map((e) => ({ id: e.id }));
    });
    // ④ 未决事件详情：id+title 保住"有事在飞"，砍掉 source/position 细节
    stage('pendingEvents', () => {
        if (pack.pendingEvents?.length) pack.pendingEvents = pack.pendingEvents.map((e) => ({ id: e.id, title: e.title }));
    });
    // ⑤ 在飞盘算细节：id+goal+progress 保住目标与进度，砍掉 stage/visibility/memory/parentId
    stage('agendas.detail', () => {
        if (pack.agendas?.length) pack.agendas = pack.agendas.map((a) => ({ id: a.id, goal: a.goal, progress: a.progress }));
    });
    // 兜底痕迹：固定剪枝序全部用尽仍越界 → 如实记在包里（不许"预算已强制"变成一句空话）
    if (estTokensOf(pack) > budgetTokens) cut.push('budgetOverrun');
    if (cut.length) pack.trimmed = cut;
    return cut;
}

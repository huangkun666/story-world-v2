// story-world-v2/demo/measure-leg121-divergence-live.js
// leg121 · 细案 `docs/spec-chat-ledger-conflict.md` 的**先证伪**装置（只读；不打印密钥）。
//
// ＝＝ 它要回答两个问题 ＝＝
//   问一（**零模型调用**，缺省就跑）：**账上已经死掉 / 离场的人，在之后的正文里还被当成"行动的主语"写过几次？**
//     ——这是"聊天模型照书里的旧样子写"这件事**有没有真的发生过**的取证。
//     ★扫不到 ⇒ 这个病在真账上没发生过 ⇒ 细案那套就不该做（先证伪自己）。
//   问二（`--live`）：把细案 §2.2 那一段递过去，模型会不会改？（A/B/C 三组对照，C 组**故意写反** = 证红）
//
// ＝＝ 纪律 ＝＝
//   · ★**只读副本**：本装置只 `readFileSync`，从不写回；真账原件由调用方先 cp 到 TEMP（本仓铁律）。
//   · ★**照生产那条路逐字复刻**：扫正文用的是**生产同款** `src/tag-extract.js` 的 `extractTags`
//     （不是自己写一套更宽松的正则）——否则"扫出来的冲突"可能是我造的。
//   · ★**不许静默截断**：生产口径 `maxActions` 出厂 12，本装置**故意调大**（取证不能因为截断而漏看），
//     并把"解析出多少条"如实印出来。
//
// 用法：
//   node demo/measure-leg121-divergence-live.js                  # 问一：取证（零模型调用）
//   node demo/measure-leg121-divergence-live.js --live           # 问二：A/B/C 三组真模型
//   node demo/measure-leg121-divergence-live.js --world <副本路径>
import { readFileSync } from 'node:fs';
import { extractTags } from '../src/tag-extract.js';

const args = process.argv.slice(2);
const hasFlag = (n) => args.includes(n);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const WORLD_PATH = argVal('--world', 'F:/deepseek/tmp/leg121/dahuangz-live.jsonl');
const LIVE = hasFlag('--live');
/** ★取证口径：**不截断**（生产出厂 12，这里调大——漏看会让"扫不到"这个结论不可信）。 */
const MAX_ACTIONS = 100000;
const PROBE = hasFlag('--probe');
// ★围栏记号**不写字面量**（本仓 leg120 的血证：模板字符串里写反引号 ⇒ 整份文件加载即炸，
//   而 `node --check` 对 `.js` **返回 0**）。照 `web/inject.js:136` 的做法一处定义。
const FENCE = '`'.repeat(3);

// ── 读真账副本（与既有装置同一条约定：首行是热账头，其余是消息） ──────────────────
function loadCopy(path) {
    const raw = readFileSync(path, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    const header = JSON.parse(lines[0]);
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    const msgs = [];
    for (let i = 1; i < lines.length; i += 1) {
        try { msgs.push(JSON.parse(lines[i])); } catch (_) { /* 坏行跳过，下面如实报数 */ }
    }
    return { world: box.world, chatMeta: header?.chat_metadata || {}, msgs, badLines: lines.length - 1 - msgs.length };
}

/** 从事件号 `ev_<轮次>_<位次>` 里解出轮次（★引擎发号的规则，`settle.js` 与 `ev_` 同规）。 */
function tickOfEventId(id) {
    const m = /^ev_(\d+)_/.exec(String(id || ''));
    return m ? Number(m[1]) : null;
}

const { world, chatMeta, msgs, badLines } = loadCopy(WORLD_PATH);
const tick = world?.meta?.tick ?? null;
const entities = world?.entities || [];
const canon = world?.context?.setting?.frozen?.canon || {};
const positions = world?.context?.positions || [];
const events = world?.events || [];
const chronicle = world?.chronicle || [];
const ef = world?.meta?.entityFields || {};

const byId = new Map(entities.map((e) => [e.id, e]));
const evById = new Map(events.map((e) => [e.id, e]));
const nameOf = (id) => byId.get(id)?.name || evById.get(id)?.title || id;

const line = (s) => console.log(s);
line('='.repeat(78));
line(`装置 leg121 · 细案 docs/spec-chat-ledger-conflict.md 的先证伪`);
line(`真账副本 = ${WORLD_PATH}`);
line(`世界 = ${world?.context?.world ?? '?'} · 轮次 tick = ${tick} · 消息 ${msgs.length} 条（坏行 ${badLines}）`);
line('='.repeat(78));

// ── ① 账的现状 ────────────────────────────────────────────────────────────────
const statusCount = {};
for (const e of entities) { const s = e.status || 'active'; statusCount[s] = (statusCount[s] || 0) + 1; }
const changedFields = [];
for (const [id, rec] of Object.entries(ef)) {
    for (const [f, r] of Object.entries(rec?.fields || {})) {
        if (r?.source === '变更') changedFields.push({ id, field: f, ...r });
    }
}
const derivedLoc = Object.entries(ef).filter(([, r]) => r?.位置来源 === '结构推导');
line('\n【① 账的现状】');
line(`  实体 ${entities.length} 条 · status 分布 ${JSON.stringify(statusCount)}`);
line(`  编年 ${chronicle.length} 行 · tick 范围 ${chronicle.length ? `${chronicle[0]?.tick} … ${chronicle[chronicle.length - 1]?.tick}` : '（空）'}`);
line(`  事件 ${events.length} 条 · 盘算 ${(world?.agendas || []).length} 条 · 关系 ${(world?.relations || []).length} 条`);
line(`  ★meta.entityFields：有留痕的实体 ${Object.keys(ef).length} 个 · **"被事件改过"的格 ${changedFields.length} 个** · "位置是推的" ${derivedLoc.length} 个`);

// ── ② 死 / 离场名单（含"死于第几轮、因哪件事"） ──────────────────────────────
const departed = entities.filter((e) => e.status === 'dead' || e.status === 'retired');
line(`\n【② 死 / 离场名单（${departed.length} 人）】`);
const departedInfo = [];
for (const e of departed) {
    const st = ef[e.id]?.fields?.status || null;
    const causeTick = st?.tick ?? tickOfEventId(st?.cause) ?? null;
    const causeText = st?.cause ? `${st.cause}「${nameOf(st.cause)}」` : '（账上没记因）';
    departedInfo.push({ id: e.id, name: e.name, status: e.status, tick: causeTick, cause: st?.cause || null });
    line(`  · ${e.name}（${e.id}）· ${e.status === 'dead' ? '已死' : '已离场'}`
        + ` · 第 ${causeTick ?? '?'} 轮 · 因 ${causeText} · lastActiveTick=${e.lastActiveTick ?? '—'}`);
}

// ── ③ 细案 §2.2 那一段：**照细案措辞现拼**（这就是问二要注入的东西） ─────────────
function divergenceText() {
    const rows = [];
    for (const e of entities) {
        if (e.status === 'dead' || e.status === 'retired') {
            const st = ef[e.id]?.fields?.status || null;
            const t = st?.tick ?? tickOfEventId(st?.cause) ?? null;
            const why = st?.cause ? `「${nameOf(st.cause)}」` : '';
            rows.push(`  · ${e.name}：${e.status === 'dead' ? '已死' : '已离场'}`
                + `${t !== null ? `（第 ${t} 轮${why ? ` ${why}` : ''}）` : ''}`);
        }
    }
    for (const c of changedFields) {
        const e = byId.get(c.id);
        if (!e) continue;
        const prev = c.prev && c.prev.value ? `，书里原样是「${c.prev.value}」` : '';
        rows.push(`  · ${e.name}的〈${c.field}〉：账上是「${c.value}」${prev}`
            + `（第 ${c.tick} 轮${c.cause ? `「${nameOf(c.cause)}」` : ''}）`);
    }
    for (const [id, r] of derivedLoc) {
        const e = byId.get(id);
        if (!e) continue;
        rows.push(`  · ${e.name}的所在是引擎按结构推出来的（书里没写）`);
    }
    if (!rows.length) return '';
    return '【这一局里跟书里不一样的地方】\n' + rows.join('\n')
        + '\n（这些是这一局里真的发生过、已经记在账上的改变——正文按这里写，别照书里的旧样子写；'
        + '也不要把这一段当台词念出来。）';
}
const divText = divergenceText();
line(`\n【③ 细案 §2.2 那一段的**实际样子**（${divText.length} 字）】`);
line(divText || '（空——账上没有分歧 ⇒ 按细案口径一个字都不注入）');

// ── ④ 扫正文：账上已死/离场的人，被写成"行动的主语" ──────────────────────────
const deadIds = new Set(departed.map((e) => e.id));
const deadName = new Map(departed.map((e) => [e.id, e]));
const assistant = msgs.map((m, i) => ({ i, ...m })).filter((m) => m && !m.is_user && typeof m.mes === 'string');
line(`\n【④ 扫正文（生产同款 extractTags · maxActions=${MAX_ACTIONS} 不截断）】`);
line(`  assistant 消息 ${assistant.length} 条 · 逐条跑`);

const hits = [];
let parsedTotal = 0, unresolvedTotal = 0, scanned = 0;
for (let k = 0; k < assistant.length; k += 1) {
    const m = assistant[k];
    let f = null;
    try {
        f = extractTags(m.mes, {
            entities, canon: canon.bookEntities || [], locations: positions,
            playerId: null, maxActions: MAX_ACTIONS,
        });
    } catch (err) { line(`  ⚠ 第 ${m.i} 条正文 extractTags 抛错：${err?.message || err}`); continue; }
    scanned += 1;
    parsedTotal += f.parsed || 0;
    unresolvedTotal += (f.unresolved || []).reduce((s, u) => s + (u.n || 0), 0);
    for (const a of f.actions || []) {
        // ★★仪器自证（本笔第一次跑就栽在这儿，留档）：`extractTags` 的行动行用的是 **`actorId`**，
        //   不是 `who`（见 `src/tag-extract.js:246-253`）。第一版读 `a.who` ⇒ 恒 undefined ⇒
        //   `deadIds.has(undefined)` 恒假 ⇒ **0 命中是构造出来的假阴性**，不是"病没发生"。
        if (!deadIds.has(a.actorId)) continue;
        const e = deadName.get(a.actorId);
        // ★从末尾数：最后一条 assistant 正文 ≈ 当前轮；往前推第几条 ≈ tick 往前几轮（**这是个猜测，下面要校准**）
        const fromEnd = assistant.length - 1 - k;
        hits.push({
            msgIndex: m.i, fromEnd, tickGuess: tick !== null ? tick - fromEnd : null,
            who: a.actorId, name: e?.name, status: e?.status,
            diedTick: departedInfo.find((d) => d.id === a.actorId)?.tick ?? null,
            verb: a.verb || '', target: a.targetText || '',
            raw: (m.mes.match(new RegExp(`^.*${String(e?.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'm')) || [''])[0].trim().slice(0, 120),
        });
    }
}
line(`  扫过 ${scanned} 条 · 解析出行动 ${parsedTotal} 条 · 归不上的名字 ${unresolvedTotal} 个`);
line(`\n  ★★ 命中（账上已死/离场的人被写成行动主语）：**${hits.length} 次**`);
for (const h of hits) {
    line(`   · 消息#${h.msgIndex}（从末尾数第 ${h.fromEnd} 条 · 猜第 ${h.tickGuess} 轮）`
        + `｜${h.name}（${h.status === 'dead' ? '已死' : '已离场'}于第 ${h.diedTick ?? '?'} 轮）`
        + `｜${h.verb}${h.target ? ` → ${h.target}` : ''}`);
    if (h.raw) line(`       原文：${h.raw}`);
}
if (!hits.length) {
    line('   ⇒ **一次都没有**。按细案的先证伪口径：这个病在真账上没发生过 ⇒ 那套机制不该做（或优先级很低）。');
}

// ── ④b 探针：**先怀疑仪器**——"0 命中"到底是"没发生"还是"扫不到"？ ──────────────
if (PROBE) {
    line('\n【④b 探针：正文里到底有没有标签？】');
    const reShell = new RegExp(FENCE + '\\s*tags');
    const withShell = assistant.filter((m) => reShell.test(m.mes));
    const withAction = assistant.filter((m) => m.mes.includes('【行动】'));
    const withAny = assistant.filter((m) => /【(行动|时长|场景)/.test(m.mes));
    line(`  assistant ${assistant.length} 条里：带 ${FENCE}tags 块的 **${withShell.length}** 条`
        + ` · 出现「【行动】」字样的 **${withAction.length}** 条 · 出现任一标签的 **${withAny.length}** 条`);
    line(`  ⇒ ${withAny.length === 0
        ? '★★一条标签都没有 ⇒ 本装置那个"0 命中"是**仪器瞎**（没有可扫的东西），**不是"病没发生"**'
        : '有标签可扫（那 0 命中才谈得上是"没发生"）'}`);
    for (const m of assistant.slice(-2)) {
        const t = String(m.mes).trim();
        line(`  ── 消息#${m.i}（${t.length} 字）尾部 300 字 ──`);
        line('  ' + t.slice(-300).replace(/\n/g, '\n  '));
    }
    line(`  ── 解析出来的行动（共 ${parsedTotal} 条）──`);
    for (const m of assistant) {
        let f = null;
        try { f = extractTags(m.mes, { entities, canon: canon.bookEntities || [], locations: positions, playerId: null, maxActions: MAX_ACTIONS }); } catch (_) { continue; }
        for (const a of f.actions || []) {
            line(`   · 消息#${m.i}｜${byId.get(a.actorId)?.name || a.actorId}｜${a.verb || ''}${a.targetText ? ` → ${a.targetText}` : ''}`);
        }
    }
}

// ── ★★成品验证：拿**刚落地的生产函数**在真账上跑一遍（不是我在这里复刻一份） ─────────────
//   为什么必须用它而不是上面 §③ 那段自拼的：**自拼的那份是我写的，生产那份才是要上线的**——
//   本仓 leg107 的病历正是"测试跑的是另一份实现"。
if (hasFlag('--divergence')) {
    const { ledgerDivergenceText, DIVERGENCE_DEFAULT } = await import('../web/inject.js');
    const t = ledgerDivergenceText(world);
    line(`\n【成品验证：生产函数 ledgerDivergenceText 在真账上的产出（上限 ${DIVERGENCE_DEFAULT.maxChars} 字）】`);
    line(t || '（空串——账上没有分歧 ⇒ 一个字都不注入）');
    line(`  ⇒ ${t.length} 字`);
}

// ── ⑥ ★★根本问题：**书 vs 账，逐格到底差多少？**（这才是"冲突"的直接盘点） ──────
//   为什么必须量这个：细案的立论是"账本早就≠书了"。可上面 ②/③ 只数了**被记成"变更"的格**
//   （真账只有 1 格）——那**不等于**"账与书只有 1 处不同"：还有一整类分歧**不会被记成变更**，
//   比如抽象期就没照书抄的格、后来被"背景化/覆灭"的**状态**、以及**账上有、书里没有**的实体。
//   ⇒ 逐格比一遍，才知道这个病到底有多大。
line('\n【⑥ 书 vs 账：逐格盘点】');
const bookByName = new Map();
for (const c of canon.bookEntities || []) {
    const n = String(c?.name || '').trim();
    if (n) bookByName.set(n, c);
}
line(`  书名录 ${bookByName.size} 条 · 账上实体 ${entities.length} 条`);
const inBook = entities.filter((e) => bookByName.has(String(e.name || '').trim()));
const notInBook = entities.filter((e) => !bookByName.has(String(e.name || '').trim()));
const bookOnly = [...bookByName.keys()].filter((n) => !entities.some((e) => String(e.name || '').trim() === n));
line(`  ★账上有、书里也有：**${inBook.length}** 条 · 账上有、书里没有：**${notInBook.length}** 条 · 书里有、账上没有：**${bookOnly.length}** 条`);
// ★"书里有、账上没有"这 134 条**必须看清是什么**：若是**角色**，那聊天模型读书时知道他们、
//   而引擎账上根本没有他们的席位 ⇒ 模型写他们行动，引擎**一个字节都记不下来**——这是**另一类冲突**
//   （不是"账改了书"，而是"书里有、账里缺"）。若只是法则/地点/概念条目，那就不是冲突。
const bookOnlyRows = bookOnly.map((n) => ({ name: n, kind: bookByName.get(n)?.kind || '（无 kind）' }));
const boKind = {};
for (const r of bookOnlyRows) boKind[r.kind] = (boKind[r.kind] || 0) + 1;
line(`    其中按 kind 分：${JSON.stringify(boKind)}`);
line(`    名单（前 30）：${bookOnlyRows.slice(0, 30).map((r) => `${r.name}(${r.kind})`).join(' · ')}`);
const notInBookRows = notInBook.map((e) => `${e.name}(${e.kind}·${e.status || 'active'}·${e.id})`);
line(`    ★账上有、书里没有的 ${notInBook.length} 条：${notInBookRows.join(' · ')}`);

/** 逐格比：只比两边**都写了**的格（一边空着 = 空着就是空着，不算"不同"）。 */
const CMP = ['实力', '所属', 'parent', 'kind', 'location', '规模', '性质', '倾向', '身份', '定位', 'race'];
const diff = [];
const bothCount = {};
for (const e of inBook) {
    const b = bookByName.get(String(e.name).trim());
    for (const f of CMP) {
        const a = e[f], c = b[f];
        if (a === undefined || a === null || a === '' || c === undefined || c === null || c === '') continue;
        bothCount[f] = (bothCount[f] || 0) + 1;
        if (String(a) !== String(c)) diff.push({ name: e.name, field: f, ledger: String(a), book: String(c) });
    }
}
line(`  逐格比过的格数：${JSON.stringify(bothCount)}`);
line(`  ★★**两边都写了、但值不一样**：**${diff.length}** 处`);
const byField = {};
for (const d of diff) byField[d.field] = (byField[d.field] || 0) + 1;
line(`     按格分：${JSON.stringify(byField)}`);
for (const d of diff.slice(0, 25)) line(`     · ${d.name} 的〈${d.field}〉：账「${d.ledger}」 ≠ 书「${d.book}」`);
if (diff.length > 25) line(`     …（还有 ${diff.length - 25} 处）`);

// ── ⑦ 校准"从末尾数第几条 ≈ 第几轮"这个猜测 ────────────────────────────────
line('\n【⑤ 校准：编年尾部的轮次 vs assistant 条数】');
const tail = chronicle.slice(-6).map((r) => `第${r.tick}轮:${String(r.text).slice(0, 28)}`);
for (const t of tail) line(`  ${t}`);
line(`  编年最后一行第 ${chronicle[chronicle.length - 1]?.tick} 轮 · 账上 tick ${tick} · assistant 正文 ${assistant.length} 条`);
line('  ★若"最后一行编年的轮次"与 tick 差得远，说明轮次↔消息条数的对应需要另找锚（下面 --live 用真上下文时不依赖这个猜测）。');

line(`\n${'='.repeat(78)}`);

// ══════════════════════════════════════════════════════════════════════════════
// `--selftest`：**零模型调用**，钉死本装置自己的一处缺陷（本笔实测抓出来的）
//
// 病（A/B/C 三组跑完才看出来）：B 组的输出**明明有 ```tags 块与 5 条【行动】**，
//   而生产解析器报 **0 条**。真因不在模型，在**本装置少了一步**：
//   我拿到的是**带模板包裹的原始输出**（模型把正文包在 `<UpdateVariable>`/JSONPatch 里当 **JSON 字符串**），
//   所以换行是**字面的两个字符 `\n`**，不是真换行 —— 而 `extractTags` 是**按行切**的
//   （`src/tag-extract.js:174` 的 `src.split(/\r?\n/)`）⇒ **整段正文成了"一行"** ⇒
//   行首不是 `【行动】` ⇒ 一条都认不出。
//   ★真机里不会有这一步之差：插件读的是 `message.mes`，那是 **ST 渲染之后**的文本（真换行）。
//   ⇒ 本装置必须**先把字面 `\n` 还原成真换行**，才等于生产看到的东西。
//
// ★这一节同时证明第二件更要紧的事：**账上已死的人，行动在生产里是"认得出、收得下"的**
//   （下面第二行解析出的行动里有「万子明」——他是账上唯一的 dead）。
// ══════════════════════════════════════════════════════════════════════════════
if (hasFlag('--selftest')) {
    line('\n【自检：字面 \\n vs 真换行（零模型调用）】');
    // ★夹具逐字抄自 B 组输出的**尾部**（那 260 字里正好含完整的标签块）
    const BLOCK = [
        '【时长】三月', '【场景：江州天字号洞府】',
        '【行动】万子明｜献上｜秘库钥匙', '【行动】黄坤｜吸取｜薛铁衣资源',
        '【行动】黄坤｜修习｜高阶功法', '【行动】黄坤｜助力｜白小娥',
        '【行动】白小娥｜突破｜大境界',
    ];
    const asJsonString = '...正文...\\n\\n' + FENCE + 'tags\\n' + BLOCK.join('\\n') + '\\n' + FENCE;   // ★字面 \n（未渲染）
    const asRendered = '...正文...\n\n' + FENCE + 'tags\n' + BLOCK.join('\n') + '\n' + FENCE;         // ★真换行（ST 渲染后）
    const run = (label, text) => {
        const f = extractTags(text, { entities, canon: canon.bookEntities || [], locations: positions, playerId: null, maxActions: MAX_ACTIONS });
        const names = (f.actions || []).map((a) => `${byId.get(a.actorId)?.name || a.actorId}(${byId.get(a.actorId)?.status || '?'})`);
        line(`  ${label}：解析出行动 **${(f.actions || []).length}** 条 ${names.length ? `→ ${names.join(' · ')}` : ''}`);
        return f;
    };
    run('① 字面 \\n（本装置第一版就是这么喂的）', asJsonString);
    run('② 真换行（= ST 渲染后，生产看到的东西）', asRendered);
    line('  ⇒ ① 为 0 是**装置的缺陷**，不是模型没写；② 才是真读数。');
    line('  ⇒ ★同时可见：「万子明」是账上唯一的 dead —— 他的行动**认得出、收得下** ⇒');
    line('     **模型把已死的人写成行动主语时，这件事会一路落进账本**（本仓没有"死者不许行动"的判据）。');
}

//
// 为什么测的是"标签"而不是"分歧"（本笔第一步量出来的，留档）：
//   第一步把"书 vs 账"逐格比了一遍 —— 两边都写了却不一样的格 **0 处**，61 轮只改过 1 格
//   ⇒ **"账与书冲突"在这份真账上量出来是 0**，跑分歧的 A/B/C 是在测一个不存在的问题。
//   而真正的大断口在别处：`injectTagSpec` **关着** ⇒ 96 条正文只有 1 条带标签、
//   61 轮只从正文解析出 4 条行动（玩家 0 条）⇒ **账本几乎没在接收正文**。
//
// 三组**只差注入的那一段**（上下文、玩家输入、模型、温度全同）：
//   A 现状：**不注入**标签规范（= 你现在的设置 injectTagSpec="0"）
//   B 治法：注入**生产同款** `tagSpecText()`（从 `web/inject.js` 直接 import，不是我重写的）
//   C 证红：注入同一段，但把围栏记号**故意换掉**（```tags → `@@TAGS@@`）
//          ★★C 组是这整套实验的命门：`@@TAGS@@` **在真历史与生产文本里都 0 次出现** ⇒
//            模型若真写了它，那只能是**读了我注入的那一段**——这才证明 B 组的成功
//            不是"模型本来就会写标签"（那叫空绿）。
//            ★第一版用的是 `<tags>`，**读数有混淆已换掉**：这份聊天的模板里本来就满是
//            XML 风格标签（`<UpdateVariable>`/`<JSONPatch>`/`<StatusPlaceHolderImpl/>`）⇒
//            模型写 `<tags>` 可能只是照周围的风格，**证红不成立**。
//            ★顺带：C 组的标签**生产端认不出**（`extractTags` 只认围栏）⇒ 它同时演示
//            "格式一错，标签整批丢"。
//
// ★★必须如实登记的三条（不然这个实验是自欺）：
//   ① **ST 的真实提示词组装没被复刻**：真机里是"角色卡 + 关键词世界书 + 历史 + 注入"由 ST 拼；
//      本装置把历史摊平成一段文本、注入排在末尾（**位置与生产一致**：`inject.js:329` 记 `IN_PROMPT`→'end'）。
//   ② **只取末 K 条历史**（省钱），真机上下文更长。
//   ③ **每组只跑一次、温度 0.7** ⇒ 结果是**定性**的，不是"确保"。
// ══════════════════════════════════════════════════════════════════════════════
if (LIVE) {
    const { loadStPresetConfig } = await import('../src/st-preset.js');
    const { createHttpTransport } = await import('../src/transport-http.js');
    const { tagSpecText } = await import('../web/inject.js');

    const cfg = loadStPresetConfig();
    if (!cfg) { line('✗ 读不到 ST 预设（loadStPresetConfig 返回 null）——本步中止'); process.exit(1); }
    // ★`maxTokens` 必须**给足**：标签块在**正文最末尾**，输出一被截断就会"看起来没写标签"——
    //   那是**仪器造成的假阴性**（本仓 leg120 的"截断必须可见"同一条纪律）。真账正文约 8000 字 ⇒ 给 8000 tokens。
    const transport = createHttpTransport({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, maxTokens: 8000 });
    line(`\n【问二 · 标签通道 A/B/C】模型 = ${cfg.model}（密钥不打印）`);

    const all = msgs.map((m, i) => ({ i, ...m }));
    const lastA = [...all].reverse().find((m) => m && !m.is_user && typeof m.mes === 'string');
    if (!lastA) { line('✗ 找不到最后一条 assistant 正文——本步中止'); process.exit(1); }
    const K = Number(argVal('--hist', '4'));
    const hist = all.filter((m) => m.i < lastA.i && typeof m.mes === 'string').slice(-K);
    const convo = hist.map((m) => `${m.is_user ? '【玩家】' : '【叙事】'}\n${String(m.mes).trim()}`).join('\n\n');
    line(`  重掷的是**真账最后那一轮**（消息#${lastA.i}）· 取它之前 ${hist.length} 条真历史`
        + `（${hist.map((m) => `#${m.i}${m.is_user ? '玩' : '叙'}`).join(' ')}）`);

    // B 组 = 生产原文；C 组 = 同一段、只换围栏记号
    // ★★★第一版 C 组用的是 `<tags>`，**读数有混淆，已换掉**（留档）：这份聊天的模板里本来就满是
    //   XML 风格的标签（`<UpdateVariable>` / `<JSONPatch>` / `<StatusPlaceHolderImpl/>`）⇒
    //   模型写出 `<tags>` **可能只是照周围的风格**，不一定是读了我注入的那一段 ⇒ **证红不成立**。
    //   ⇒ 换成 `@@TAGS@@`：**这四个字符在整份聊天与整份生产文本里都不可能自然出现** ⇒
    //     它一旦出现，只可能来自**我注入的那一段**。
    const MARK_OPEN = '@@TAGS@@';
    const MARK_CLOSE = '@@/TAGS@@';
    const SPEC_PROD = tagSpecText();
    const SPEC_BROKEN = SPEC_PROD.split(FENCE + 'tags').join(MARK_OPEN).split(FENCE).join(MARK_CLOSE);
    if (!SPEC_BROKEN.includes(MARK_OPEN)) { line('✗ C 组的替换没生效（围栏记号没被换掉）——证红就失效了，本步中止'); process.exit(1); }
    // ★反向前置：这个记号**不许**在真实历史里出现过（否则它出现了也不能证明什么）
    const markInHistory = msgs.some((m) => typeof m?.mes === 'string' && m.mes.includes(MARK_OPEN));
    if (markInHistory) { line('✗ 证红记号在真历史里已经出现过 ⇒ 这条证红不成立，本步中止'); process.exit(1); }
    line(`  证红记号 = ${MARK_OPEN}（**真历史里 0 次出现**，已当场核过）`);

    const ONLY = argVal('--only', '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const OUT_DIR = argVal('--out', '');

    // ── 正面实验要注入的"分歧段"（照细案 §2.2 的措辞，**并已按本轮实测更正**）──────────────
    //   ★更正①：**不含"位置是推的"那一栏**——实测它在真账上是 142 条 / 4000 字，且**根本不是冲突**
    //     （书里没写 ≠ 书里写了别的），照原文注入会正好犯 `inject.js:193-194` 那条"引导剧情围着账本转"。
    //   ★更正②：**不写"第几轮 + 因"**——实测 `applyEntityFates`（`settle.js:931-937`）不写
    //     `meta.entityFields`，3 个人的死/离场**都没记因**，细案 §2.1 那条来源写错了。
    const divergence = (flip) => {
        const rows = [];
        for (const e of entities) {
            if (e.status !== 'dead' && e.status !== 'retired') continue;
            const label = flip ? '健在（好端端活着）' : (e.status === 'dead' ? '已死' : '已离场');
            rows.push(`  · ${e.name}：${label}`);
        }
        if (!rows.length) return '';
        return '【这一局里跟书里不一样的地方】\n' + rows.join('\n')
            + '\n（这些是这一局里真的发生过、已经记在账上的改变——正文按这里写，别照书里的旧样子写；'
            + '也不要把这一段当台词念出来。）';
    };
    const DIV_TRUE = divergence(false);
    const DIV_FLIP = divergence(true);
    if (DIV_TRUE === DIV_FLIP) { line('✗ 证红版与真实版一模一样（账上大概没有 dead/retired）——证红失效，本步中止'); process.exit(1); }

    const buildPrompt = (inject, div = '') => [
        '你是这个世界的叙事者。下面是一段正在进行的故事，请续写下一段正文。',
        '', convo, '',
        ...(inject ? [inject, ''] : []),
        ...(div ? [div, ''] : []),
        '请直接写出接下来的一段正文（不要解释、不要复述上面的内容）。',
    ].join('\n');

    const GROUPS = [
        { tag: 'A 现状（不注入）', key: 'A', inject: '', div: '' },
        { tag: 'B 治法（生产标签规范）', key: 'B', inject: SPEC_PROD, div: '' },
        { tag: `C 证红（围栏换成 ${MARK_OPEN}）`, key: 'C', inject: SPEC_BROKEN, div: '' },
        { tag: 'D 正面（标签规范 ＋ 分歧段）', key: 'D', inject: SPEC_PROD, div: DIV_TRUE },
        { tag: 'E 证红（标签规范 ＋ 分歧段写反）', key: 'E', inject: SPEC_PROD, div: DIV_FLIP },
    ].filter((g) => !ONLY.length || ONLY.includes(g.key));
    line(`  本步要跑的组：${GROUPS.map((g) => g.key).join(' ')}`);
    if (ONLY.includes('D') || ONLY.includes('E')) {
        line(`  分歧段（真实版，${DIV_TRUE.length} 字）：\n${DIV_TRUE.split('\n').map((s) => '    ' + s).join('\n')}`);
        line(`  分歧段（写反版，${DIV_FLIP.length} 字）：\n${DIV_FLIP.split('\n').map((s) => '    ' + s).join('\n')}`);
    }

    const results = [];
    // ★★仪器更正（本笔实测抓出来的，见上面 `--selftest`）：模型把正文包在 JSONPatch 里当 **JSON 字符串**，
    //   换行是**字面的 `\n`**，而 `extractTags` **按行切** ⇒ 不还原就一条都认不出。
    //   真机里插件读的是 ST **渲染后**的 `mes`（真换行）⇒ 还原这一步是**补上真机本来就有的一步**。
    const renderLikeST = (s) => String(s).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    for (const g of GROUPS) {
        const prompt = buildPrompt(g.inject, g.div);
        line(`\n${'─'.repeat(74)}\n[${g.tag}] 提示词 ${prompt.length} 字 · 标签段 ${g.inject.length} 字 · 分歧段 ${g.div.length} 字`);
        const t0 = Date.now();
        let out = '';
        try { out = await transport(prompt); } catch (e) {
            line(`  ❌ 调用失败：${e?.message || e}`); results.push({ tag: g.tag, error: String(e?.message || e) }); continue;
        }
        const ms = Date.now() - t0;
        if (OUT_DIR) {
            try {
                const { mkdirSync, writeFileSync } = await import('node:fs');
                mkdirSync(OUT_DIR, { recursive: true });
                writeFileSync(`${OUT_DIR}/leg121-${g.key}-raw.txt`, String(out), 'utf8');
            } catch (e) { line(`  ⚠ 存盘失败：${e?.message || e}`); }
        }
        const rendered = renderLikeST(out);
        const reProd = new RegExp(FENCE + '\\s*tags');
        const hasProd = reProd.test(rendered);
        const hasAngle = rendered.includes(MARK_OPEN);
        const hasAction = rendered.includes('【行动】');
        let acts = [];
        try {
            acts = extractTags(rendered, { entities, canon: canon.bookEntities || [], locations: positions, playerId: null, maxActions: MAX_ACTIONS }).actions || [];
        } catch (_) { acts = []; }
        const actorNames = acts.map((a) => byId.get(a.actorId)?.name || a.actorId);
        const departedAsActor = acts.filter((a) => deadIds.has(a.actorId)).map((a) => byId.get(a.actorId)?.name);
        results.push({ tag: g.tag, key: g.key, ms, bytes: out.length, hasProd, hasAngle, hasAction, acts: acts.length, actorNames, departedAsActor, rendered });
        line(`  ${ms}ms · 输出 ${out.length} 字`
            + `｜围栏 ${FENCE}tags：**${hasProd ? '有' : '无'}**`
            + `｜${MARK_OPEN}：**${hasAngle ? '有' : '无'}**`
            + `｜【行动】 **${acts.length}** 条`);
        if (actorNames.length) line(`     行动主语：${actorNames.join(' · ')}`);
        line(`     ★★**账上已死/离场的人当主语**：${departedAsActor.length ? `**${departedAsActor.length} 次**（${departedAsActor.join(' · ')}）` : '**0 次**'}`);
        // 正文里提到这些人的**上下文**（判"是写成活的还是只提了一句"）
        for (const d of departedInfo) {
            const idx = rendered.indexOf(d.name);
            if (idx < 0) continue;
            line(`     〔${d.name}（${d.status === 'dead' ? '已死' : '已离场'}）出现在正文〕…${rendered.slice(Math.max(0, idx - 60), idx + 90).replace(/\n/g, ' ')}…`);
        }
        line(`  ── 输出尾部 200 字 ──`);
        line('  ' + String(rendered).trim().slice(-200).replace(/\n/g, '\n  '));
    }

    line(`\n${'='.repeat(78)}\n★汇总（判分口径写在下面，别只看"有没有标签"）`);
    for (const r of results) {
        if (r.error) { line(`  ${r.tag}：❌ ${r.error}`); continue; }
        line(`  ${r.tag}：围栏 ${r.hasProd ? '有' : '无'} · ${MARK_OPEN} ${r.hasAngle ? '有' : '无'}`
            + ` · 行动 ${r.acts} 条${r.actorNames?.length ? `（${r.actorNames.join('、')}）` : ''}`
            + ` · ★已死/离场的人当主语 **${r.departedAsActor?.length || 0}** 次`);
    }
    line('');
    line('  ★怎么读（**这一节是判据，不是描述**）：');
    line('   · A 无标签 ⇒ 现状确实收不到行动（与第一步"96 条只有 1 条带标签"对上）');
    line('   · B 有围栏 + 行动 ≥1 ⇒ 那一段**真的把通道接上了**');
    line(`   · C 出现 ${MARK_OPEN} ⇒ ★**模型确实在读我注入的格式**（该记号在真历史里 0 次出现，本步已当场核过）`);
    line(`   · ★★若 C 没出现 ${MARK_OPEN} ⇒ **B 组的成功不能归因于注入**（模型本来就会写）⇒ 这条通道的功劳是假的`);
    line('   · D（＋分歧段）与 E（分歧段写反）**只差一个词**：');
    line('       D 里"万子明＝已死"、E 里"万子明＝健在（好端端活着）" ⇒');
    line('       · D 的"已死/离场当主语"次数 **< B** ⇒ 分歧段真的在起作用；');
    line('       · ★★E 的次数 **> D**（或 E 把他写得比 D 更活）⇒ **证红成立**：模型确实在读分歧段；');
    line('       · ★★D 与 E 一样 ⇒ **分歧段根本没被理** ⇒ D 的"成功"是假的（哪怕数字好看）。');
} else {
    line('★第一步取证到此。零模型调用、原件零改动。加 --live 跑问二（3 次真模型调用）。');
}

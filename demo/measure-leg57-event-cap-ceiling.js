// story-world-v2/demo/measure-leg57-event-cap-ceiling.js
// leg57 · 出数装置：**「每轮事件」拧到 30/50，模型一次回复会不会撞输出天花板**
//   （结 leg54 §6 登记的那笔"没实测"，用户令「可以你跑吧」）。
//
// ── 要回答的问题（leg54 只核了"预算够"，从没量过"模型肯写几条"）────────────────────────
//   leg54 撤掉上限的依据是一条**推算**：预算 16384 token ÷ 一条事件 150–250 token ⇒ "够写几十条"
//   ⇒ 推论"那个 12 从来没咬到过模型"。★但**真天花板是"模型一次回复能写多长"**，这个数从没量过。
//
// ── 三档（只动 `每轮事件`，其余逐字相同；`每轮递线` 固定为真源里的 10）──────────────────
//   ev12 = 现状 · ev30 = 中度 · ev50 = 极端
//
// ── ★为什么必须抓 `finish_reason`（本棒的头号读数）─────────────────────────────────
//   全仓 grep `finish_reason` = **零命中** —— 生产从来没记它，`transport-http.js:87` 只把
//   `content` 返回、**其余全丢**。而它是唯一能机械区分这两种结局的量：
//     · `stop`   ⇒ 模型**写完了**（少写是它自己的选择）⇒ leg54 那条"上限是纸"成立
//     · `length` ⇒ **输出被硬截断** ⇒ JSON 缺一半 ⇒ 那一步根本**没被读懂**
//   ★这个区别是**承重**的：leg54 写在页上的后果是"你不会看到被拦，只会看到这一轮没长出新事"
//     ——那句承诺的前提是 **JSON 完整、引擎读懂了再按闸拒**（tick 照常前进）。而截断是**解析层面**
//     的失败，形状完全不同 ⇒ 若真会截断，面板那句话就是在承诺一件不成立的事。
//
// ── 纪律 ─────────────────────────────────────────────────────────────────────
//   · **真账走副本**（`loadRealWorld` 只读，`structuredClone` 后才改档位）
//   · **生产仓库零改动**：请求仍由真 `resolveWorldTransport()` 发出（同 baseUrl/model/max_tokens/
//     temperature/response_format ⇒ **逐字节同参**）；本装置只在**外层**包一层观测。
//   · 观测**不改返回值**：包装器返回的仍是原样 `content` ⇒ 我们量到的"解析失败"是**计划内的**，
//     不是被观测行为改出来的（否则会凭空造出截断假象）。
//   · 每 tick 存 `raw` 与 `usage` ⇒ 出数可复核、不靠结论复述。
//
// 用法：
//   node demo/measure-leg57-event-cap-ceiling.js --arm ev12 --ticks 3
//   node demo/measure-leg57-event-cap-ceiling.js --arm ev30 --ticks 3
//   node demo/measure-leg57-event-cap-ceiling.js --arm ev50 --ticks 3
//   node demo/measure-leg57-event-cap-ceiling.js --arm ev50 --ticks 3 --out F:/deepseek/tmp/leg57-ev50.json
import { readFileSync, writeFileSync } from 'node:fs';
import { runTick } from '../src/tick.js';
import { resolveLimits } from '../src/limits.js';

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const ST_DATA = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user';
const DEFAULT_WORLD = `${ST_DATA}/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl`;
const WORLD_PATH = argVal('--world', DEFAULT_WORLD);
const TICKS = Math.max(1, parseInt(argVal('--ticks', '3'), 10) || 3);
const ARM = argVal('--arm', 'ev12');
// 三档：只改 `每轮事件`。`每轮递线` 固定 10（用户真源里的值）⇒ 单变量。
const EV_PER_TICK = { ev12: 12, ev30: 30, ev50: 50 }[ARM];
if (!EV_PER_TICK) { console.error(`✗ --arm 只认 ev12 / ev30 / ev50（收到 ${ARM}）`); process.exit(2); }
const THREADS = Math.max(1, parseInt(argVal('--threads', '10'), 10) || 10);   // 缺省 = 用户真源实测值 10
const OUT_PATH = argVal('--out', '');
const line = (s) => console.log(s);

function loadRealWorld(path) {
    const raw = readFileSync(path, 'utf8');
    const nl = raw.indexOf('\n');
    const header = JSON.parse(nl < 0 ? raw : raw.slice(0, nl));
    const box = header?.chat_metadata?.story_world_v2;
    if (!box?.world) throw new Error(`chat_metadata.story_world_v2.world 缺失：${path}`);
    return box.world;
}

// ── 观测：**包住真的生产 transport**（不复制它的任何一行、不碰它的参数）──────────────────
// ★为什么是这个形状（第一版走错过，留档）：我本想"照抄 createHttpTransport 的参数自建一个"，
//   但 `resolveWorldTransport()` **刻意不暴露 apiKey**（`st-preset.js:38` 明写"不暴露密钥字段"）
//   ⇒ 自建就拿不到密钥。★而"让生产链可注入 fetch"又是**改生产代码**（本仓实验期零改动纪律）。
//   ⇒ 定稿：**全局 fetch 代理**——真 transport 照常调用 `fetch`（它绑的是全局），
//     我在代理里读完响应再原样交回去。**请求参数由此结构性地与生产逐字相同**（我根本没有机会改它），
//     而 `finish_reason` / `usage` / `raw` 都留得下来。跑完必恢复全局。
function installFetchSpy() {
    const real = globalThis.fetch;
    const obs = [];
    globalThis.fetch = async (url, init) => {
        const res = await real(url, init);
        const rec = { url: String(url), at: new Date().toISOString() };
        try {
            rec.promptChars = (() => { try { return JSON.parse(init?.body || '{}')?.messages?.[0]?.content?.length ?? null; } catch { return null; } })();
            rec.req = (() => { try { const b = JSON.parse(init?.body || '{}'); return { model: b.model, max_tokens: b.max_tokens, temperature: b.temperature, response_format: b.response_format?.type }; } catch { return null; } })();
        } catch { /* 只读诊断，失败不阻塞 */ }
        rec.http = res.status;
        // ★只读一份克隆来取 finish_reason；**原响应对象原样返回**（零行为改动）
        try {
            const clone = res.clone();
            const data = await clone.json();
            const choice = data?.choices?.[0] || {};
            rec.finish_reason = choice?.finish_reason ?? null;
            rec.usage = data?.usage || null;
            rec.contentChars = (choice?.message?.content || '').length;
            rec.reasoningChars = (choice?.message?.reasoning_content || '').length;
            try { JSON.parse(String(choice?.message?.content || '').trim()); rec.jsonParsed = true; } catch { rec.jsonParsed = false; }
        } catch (err) { rec.readError = String(err?.message || err); }
        obs.push(rec);
        return res;
    };
    return { obs, restore: () => { globalThis.fetch = real; } };
}

// ---------------- 跑 ----------------
line(`═══ leg57 · 「每轮事件」输出天花板 · 臂 = ${ARM}（每轮事件=${EV_PER_TICK} · 每轮递线=${THREADS}）═══`);
const world0 = loadRealWorld(WORLD_PATH);
line(`真账副本：${WORLD_PATH}`);
line(`起点 tick ${world0.meta?.tick} · 实体 ${(world0.entities || []).length} · 未决事件 ${(world0.events || []).filter((e) => !e.closed).length} · 在飞盘算 ${(world0.agendas || []).filter((a) => !a.closed).length}`);

// ★★★顺序是承重的（第一版踩过、当场被自证抓出来，留档）：
//   `createHttpTransport({...})` 的第 5 个参数是 `fetchImpl = fetch` —— **缺省值在"创建那一刻"求值**
//   ⇒ 若先建 transport、后装代理，transport 内部**已经绑住了原来的 fetch**，代理永远不被调用
//   （症状：`finish=null` / `req=undefined`，而 tick 照常成功——**装置静默失灵**）。
//   ⇒ **必须先装代理、再 resolveWorldTransport()**。
const { obs, restore } = installFetchSpy();

const { resolveWorldTransport } = await import('../src/st-preset.js');
const resolved = resolveWorldTransport();
if (!resolved) { console.error('✗ 未找到模型配置'); restore(); process.exit(1); }
line(`真模型：${resolved.source === 'st-preset' ? `酒馆预设「${resolved.presetName}」` : '环境变量'} · ${resolved.model} · ${TICKS} tick`);

const world = structuredClone(world0);
// ① 只动这两个上限（**在副本上**，真账一个字节不碰）
world.context.setting.dynamic.env = { ...(world.context.setting.dynamic.env || {}), 每轮事件: EV_PER_TICK, 每轮递线: THREADS };
const lim = resolveLimits(world);
line(`生效上限（resolveLimits 读出来的）：每轮事件=${lim.每轮事件} · 每轮递线=${lim.每轮递线} · 顶层大计=${lim.顶层大计} · 在飞大计=${lim.在飞大计}`);

const perTick = [];
let w = world;
try {
    for (let t = 1; t <= TICKS; t += 1) {
        const beforeEv = new Set((w.events || []).map((x) => x.id));
        const t0 = Date.now();
        let r;
        try {
            r = await runTick({ transport: resolved.transport, ssot: w, dialogue: '', extractCtx: {}, calls: 1 });
        } catch (err) {
            r = { ok: false, error: String(err?.message || err) };
        }
        const ms = Date.now() - t0;
        const rec = obs[obs.length - 1] || {};
        // ★自证：真 transport 实际发出的参数（若与生产不同，这里会露出来）
        //   ★若这里打出 undefined ⇒ **装置失灵**（代理没被调用、或读不到响应），
        //     此时 finish/usage 全是空值、后面所有结论都不成立 ⇒ 必须显式喊出来，不许静默继续。
        if (t === 1) {
            if (!rec.req) {
                line('★★ 装置失灵：代理没读到请求参数（finish/usage 将全为空 ⇒ 本跑结论无效）。');
                line('  排查：`installFetchSpy()` 必须在 `resolveWorldTransport()` **之前**调用'
                    + '（`fetchImpl = fetch` 的缺省值在创建 transport 那一刻就绑定了）。');
            } else {
                line(`自证 · 生产 transport 实发参数：${JSON.stringify(rec.req)}`);
            }
            line('');
        }
        const newEv = r.ok ? (r.ssot.events || []).filter((e) => !beforeEv.has(e.id)) : [];
        const warns = r.ok ? (r.stage?.warnings || []) : [];
        const capRejects = warns.filter((x) => /事件洪峰/.test(String(x))).length;
        const row = {
            t, ms,
            finish: rec.finish_reason ?? null,
            contentChars: rec.contentChars ?? null,
            reasoningChars: rec.reasoningChars ?? null,
            completionTokens: rec.usage?.completion_tokens ?? null,
            promptTokens: rec.usage?.prompt_tokens ?? null,
            jsonParsed: rec.jsonParsed ?? null,
            promptChars: rec.promptChars ?? null,
            ok: r.ok,
            newEventsAccepted: newEv.length,
            // ★拒签率的分母要从"落账 + 被洪峰拒的数量"反推——`stage` 形状是 {chronicle,warnings,events}，
            //   **不含 step**（第一版写 `r.stage.step.newEvents` 恒得 null，被自证打出来当场发现）。
            capRejected: capRejects,
            proposedTotal: newEv.length + capRejects,
            eventCapWarnings: capRejects,
            warnings: warns.length,
            healed: r.ok ? (r.healed || null) : null,
            error: r.ok ? null : String(r.error).slice(0, 260),
        };
        perTick.push(row);
        line(`t${t}  finish=${String(row.finish).padEnd(7)} 输出${String(row.contentChars).padStart(6)}字/推理${String(row.reasoningChars).padStart(6)}字 tok=${String(row.completionTokens).padStart(5)}  JSON=${row.jsonParsed ? '✓' : '✗'}  提议${String(row.proposedTotal).padStart(4)}件→落账${row.newEventsAccepted}件（洪峰拒${capRejects}）` + (row.ok ? '' : `  ✗ ${row.error}`));
        if (r.ok) w = r.ssot;
        else line('   （本 tick 失败 ⇒ 世界原样不动，继续下一 tick）');
    }
} finally {
    restore();   // ★无论成败都恢复全局 fetch
}

// ---------------- 汇总 ----------------
const sum = {
    arm: ARM, evPerTick: EV_PER_TICK, threads: THREADS, model: resolved.model, ticks: TICKS,
    finishReasons: perTick.reduce((m, r) => { m[r.finish] = (m[r.finish] || 0) + 1; return m; }, {}),
    truncated: perTick.filter((r) => r.finish === 'length').length,
    jsonFail: perTick.filter((r) => r.jsonParsed === false).length,
    tickFail: perTick.filter((r) => !r.ok).length,
    acceptedTotal: perTick.reduce((s, r) => s + r.newEventsAccepted, 0),
    proposedTotal: perTick.reduce((s, r) => s + (r.proposedTotal || 0), 0),
    capRejectedTotal: perTick.reduce((s, r) => s + (r.capRejected || 0), 0),
    capWarningsTotal: perTick.reduce((s, r) => s + r.eventCapWarnings, 0),
    maxAccepted: Math.max(0, ...perTick.map((r) => r.newEventsAccepted)),
    maxCompletionTokens: Math.max(0, ...perTick.map((r) => r.completionTokens || 0)),
    perTick,
};
line('');
line('─── 汇总 ───');
line(`finish_reason 分布：${JSON.stringify(sum.finishReasons)}`);
line(`★撞天花板（finish=length）：${sum.truncated}/${TICKS}`);
line(`JSON 解析失败：${sum.jsonFail}/${TICKS} · 整 tick 失败：${sum.tickFail}/${TICKS}`);
line(`落账事件合计 ${sum.acceptedTotal} 件（单轮最多 ${sum.maxAccepted}）· 模型提议合计 ${sum.proposedTotal} 件 · 事件洪峰拒签 ${sum.capRejectedTotal} 次`);
line(`completion_tokens 峰值 ${sum.maxCompletionTokens}（上限 16384）`);
if (OUT_PATH) { writeFileSync(OUT_PATH, JSON.stringify(sum, null, 1)); line(`\nJSON → ${OUT_PATH}`); }

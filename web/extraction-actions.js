// Extraction actions are one family: task lifetime, source, progress, commit.
import { extractWorldSetting, applySettingToSsot, describeProgress, buildScalePrompt, sanitizeScales } from '../src/abstract.js';
import { resolveBrowserTransport, EXTRACTION_MAX_TOKENS } from '../src/transport-config.js';
import { extractChunkCharsOf } from './model-channel.js';
import { diagEvidence, diagSettingOutcome } from './diagnostic-transport.js';
import { extractionProgressHandler } from './extraction-progress.js';
import { LONG_TASK_LABELS } from './long-task.js';
import { seedRootsFromPass, seedFingerprint } from '../src/seed-roots.js';
import { seedRootsForWorld } from './seed-roots-wiring.js';
import { worldToBeReplaced, initWorldOverwriteNotice } from './world-replace.js';
import { loadHotAccount } from '../src/storage.js';

export function bindExtractionActions(deps) {
    const { bus, taskHub, readHotMeta, modelSettings, autoComposeSource, extractConcurrency, compileSummary, retainGeography,
        refreshWorld, refreshSections, getVolumes, getCtx, snapHub, logInitDiagnostics, seedAndReport, derivePositions, attachPlayerPiece, flushOutcomeText,
        saveWorld, prepareWorld, readBookCheck, publishBookCheck } = deps;
    const longTask = { wrap(action, label, handler) {
        return deps.longTask.wrap(action, label, () => taskHub.run(action, label, handler));
    } };
    bus['cancel-extraction'] = () => taskHub.cancel();
    bus['extract-scales'] = longTask.wrap('extract-scales', LONG_TASK_LABELS['extract-scales'], async (task) => {
        const setStatus = task.setStatus;
        const settings = modelSettings() || {};
        const chunkChars = extractChunkCharsOf(settings), concurrency = extractConcurrency();
        const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
        if (!resolved) { setStatus('注意：模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
        task.configure(resolved, { chunkChars, concurrency });
        setStatus('正在合订设定源（角色卡 + 世界信息）…');
        let src;
        try { src = await task.wait(autoComposeSource()); } catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err; setStatus(`注意：合订设定源失败：${String(err?.message || err)}`); return; }
        if (!src?.ok) { setStatus(`注意：设定源不可用：${src?.reason || '未知'}——请检查 ST 是否已载入角色卡/世界书`); return; }
        const extract = task.extract(resolved, src, { chunkChars, concurrency });
        setStatus(`直抽刻度中（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}）…`);
        const t0 = Date.now();
        let calls = 0;
        let raw = '';
        try {
            raw = await task.wait(extract(buildScalePrompt(src.text)));
            calls = 1;
        } catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err;
            throw err;
        }
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        // 解析（模型偶尔把 JSON 包在别的话里：取第一对花括号）
        let obj = null;
        let parseErr = '';
        try {
            const s = String(raw || '');
            obj = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
        } catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err; parseErr = String(err?.message || err); }
        if (!obj) {
            console.warn('[story-world-v2] 直抽刻度：输出不是 JSON（前 200 字）', String(raw || '').slice(0, 200));
            setStatus(`注意：直抽返回的不是 JSON（${secs}s）——原文已打到控制台，账本未动`);
            return;
        }
        const errors = [];
        const scales = sanitizeScales(obj.刻度 ?? obj.轴 ?? obj, { sourceText: src.text }, errors);
        // ★leg197：出处闸已撤 ⇒ 这个读数恒为 0（旧读数留着，免得动草稿形状与既有判据；见上一条注释）。
        const dropped = errors.filter((e) => /原文查不到/.test(e)).length;
        const world = readHotMeta() ? loadHotAccount(readHotMeta()) : null;
        if (!world) { setStatus('注意：世界还没载入，直抽结果无处可放（账本未动）'); return; }
        task.guard.assertCurrent();
        world.context.__scaleDraft = {
            at: new Date().toISOString(), source: src.label || '', secs: Number(secs), calls,
            scales, dropped, errors: errors.slice(0, 20),
        };
        task.result = { ok: true, errors };
        refreshSections(['setting']);
        console.info(`[story-world-v2] 直抽刻度完成：${scales.length} 张表 · ${secs}s`, { scales, errors });
        setStatus(`直抽刻度完成：${scales.length} 张概念表 · ${secs}s${dropped ? ` · ${dropped} 条档位原文里找不到（已丢）` : ''}——只落「设定」页那一栏，账本未动`);
    });
    bus['reextract-setting'] = longTask.wrap('reextract-setting', LONG_TASK_LABELS['reextract-setting'], async (task) => {
        const setStatus = task.setStatus;
        const meta = readHotMeta();
        const world = meta ? loadHotAccount(meta) : null;
        if (!world) { setStatus('注意：世界还没载入——先打开/载入一个世界再重抽设定'); return; }
        const settings = modelSettings() || {};
        const chunkChars = extractChunkCharsOf(settings), concurrency = extractConcurrency();
        const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
        if (!resolved) { setStatus('注意：模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
        task.configure(resolved, { chunkChars, concurrency });
        const before = world.context?.setting?.frozen?.canon || {};
        console.info('[story-world-v2] 只重抽设定：即将覆盖旧设定（读数备份，旧账不再可回）', {
            世界: world.context?.world, 指纹: world.context?.setting?.frozen?.fingerprint,
            旧: {
                档位: (before.powerScale || []).length, 维度: (before.dims || []).length,
                刻度表: (before.刻度 || []).length, 法则: (before.rules || []).length,
                史略: (before.historyNotes || []).length,
            },
        });
        setStatus('正在合订设定源（角色卡 + 世界信息）…');
        let src;
        try { src = await task.wait(autoComposeSource()); } catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err; setStatus(`注意：合订设定源失败：${String(err?.message || err)}`); return; }
        if (!src?.ok) { setStatus(`注意：设定源不可用：${src?.reason || '未知'}——请检查 ST 是否已载入角色卡/世界书`); return; }
        const extract = task.extract(resolved, src, { chunkChars, concurrency });
        setStatus(`只重抽设定中（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}）…名册与进度不会动`);
        const progressEvents = [];
        const progress = task.progress = extractionProgressHandler(progressEvents, { setText: setStatus });
        let r;
        try {
            r = task.result = await task.wait(extractWorldSetting({
                sourceText: src.text,
                extract,
                force: true,                      // ★强制重抽：本动作的存在意义就是"书没变我也要重抽"
                // ★★★leg144：并发几路**从设置里读**（设置页「模型通道」那一格；没填过 ⇒ 出厂值）。
                //   数住 `src/abstract.js` 的 `EXTRACT_CONCURRENCY`（一处定义，三个调用点共用）。
                concurrency, chunkChars, signal: task.signal,
                onProgress: progress.onEvent,
                extraDeclared: src.titleRoster,
                compileInfo: compileSummary(src.catalog, src.titleRoster),
                // ★★leg62c（用户令「重抽时跳过名册遍」）：名册遍的产物（`bookEntities`）只喂
                //   `seedBookEntities`，而实体已经全在账上了 ⇒ 那一遍是把调用烧在**无人消费**的产物上。
                //   ⇒ 每块 2 次调用降到 **1 次**（大荒 9 块：18 → 9 次）——用户实机一轮 >20 分钟的主因之一。
                //   代价：书里**新增**的名号这次不入册（要补名册就走「初始化」）——状态条如实报。
                skipRoster: true,
                // ★Task 3：允许来源（发射端自有的最终接收块）+ 依据明细（走既有调试面）。理由见 src/abstract.js。
                allowedSources: src.allowedBlocks || null,
                evidencePolicy: 'strict',
                onEvidence: diagEvidence,
            }));
            task.assertCurrent();
        } catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err;
            progress.stop();
            throw err;
        }
        progress.stop();
        diagSettingOutcome(r);
        if (!r.ok) {
            setStatus(`注意：重抽失败：${(r.errors || []).join('; ')}——设定一个字没动`);
            return;
        }
        // ★★必须保住 `bookEntities`：跳了名册遍 ⇒ 这次的 canon 里**没有名册**
        //   ⇒ 直接换上去会把账上的名册抹成空（★这正是本仓"删字段只删一半"的老病，别踩）。
        //   口径：名册照旧用**账上那一份**（本次没重抽它），其余设定用新的。
        const keptBook = before.bookEntities || [];
        if (keptBook.length) r.setting.frozen.canon.bookEntities = keptBook;
        retainGeography(world.context.setting, r.setting);
        // ★只换 setting：走唯一那条换设定的路径（其余字段原样带过）
        const next = structuredClone(applySettingToSsot(world, r.setting));
        const flushed = await task.commit(next, saveWorld);
        task.assertCurrent();
        const after = r.setting?.frozen?.canon || {};
        console.info('[story-world-v2] 只重抽设定完成', {
            世界: src.worldName, 调用: r.timing?.calls, 毫秒: r.timing?.ms, 名册遍: '已跳过',
            新: {
                档位: (after.powerScale || []).length, 维度: (after.dims || []).length,
                刻度表: (after.刻度 || []).length, 法则: (after.rules || []).length,
                史略: (after.historyNotes || []).length,
            },
            名册: `${keptBook.length} 条（本次未重抽，照旧保留）`,
            实体账: (next.entities || []).length, 轮次: next.meta?.tick, 落盘: flushed,
            errors: (r.errors || []).slice(0, 6),
        });
        refreshWorld(next, { oldVolumes: getVolumes() });
        refreshSections(['setting']);
        const secs = r.timing?.ms == null ? '' : ` · ${Math.round(r.timing.ms / 1000)}s`;
        setStatus(`设定已重抽（${(after.刻度 || []).length} 张刻度表 / ${(after.powerScale || []).length} 档 / ${(after.rules || []).length} 条法则${secs}`
            + ` · 调用 ${r.timing?.calls ?? '?'} 次 · 名册遍已跳过）`
            + `——名册 ${(next.entities || []).length} 个实体与第 ${next.meta?.tick ?? 0} 轮进度一个字没动`
            + (keptBook.length ? `；账上 ${keptBook.length} 条名册照旧保留（本次没重抽名册）` : '')
            + (flushed.ok ? '' : '（注意：落盘没确认，见控制台）'));
    });

    bus['init-world'] = longTask.wrap('init-world', LONG_TASK_LABELS['init-world'], async (task) => {
        const setStatus = task.setStatus;
        // ★★leg40b（I-1）：**先问，再动手**——这条必须是本函数第一条语句。
        //   放在这里（而不是放到 writeHotMeta 之前）是因为：抽取与起根都在这后面，
        //   真账实测合起来要几分钟（起根 170–490 秒）⇒ 闸若靠后，用户会在**毫不知情**的情况下等完再被覆盖。
        //   口径：有世界才问（`worldToBeReplaced` 返回 null = 没什么可丢的，别多问一句）；
        //   问不出来（无 window.confirm）⇒ 放行，绝不卡死。
        const target = worldToBeReplaced(loadHotAccount(readHotMeta()));
        if (target) {
            const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
                ? window.confirm(initWorldOverwriteNotice(target))   // ★先归一（worldToBeReplaced）再喂文案：契约见该函数注释
                : true;
            if (!ok) {
                setStatus(`已取消——世界「${target.name}」原样不动（没有覆盖，也没有发生任何调用）`);
                return;
            }
            // ★★★leg103：**让那句承诺变成真的**（原来它是假的，见 `world-replace.js` 头部留档）——
            //   在确认之后、**任何改动与任何模型调用之前**先给当前世界拍一份自保快照。
            //   ★为什么必须在这里：`requestSnapshot` 的唯一调用点是 `writeHotMeta` 末尾，而抽取在它之前，
            //     所以不补这一下的话，用户以为的"退路"拍到的是**刚抽出来的新世界**（退回来还是新的）。
            //   ★零阻塞：拍快照失败绝不许挡住初始化（照 `requestSnapshot` 自己的纪律）。
            try { snapHub.requestSnapshot(loadHotAccount(readHotMeta()), '换掉前自保'); }
            catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err; console.warn('[story-world-v2] 换掉前自保快照没拍成（不影响初始化）:', err?.message || err); }
        }
        try {
            const settings = modelSettings() || {};
        const chunkChars = extractChunkCharsOf(settings), concurrency = extractConcurrency();
            // leg27：抽取走**独立超时档**（extraction: true = EXTRACTION_TIMEOUT_MS），不再蹭主调用的 120s
            const resolved = resolveBrowserTransport(settings, { maxTokens: EXTRACTION_MAX_TOKENS, extraction: true });
            if (!resolved) { setStatus('注意：模型通道未配置（设置页填写服务地址/密钥/模型）'); return; }
            task.configure(resolved, { chunkChars, concurrency });
            setStatus('正在合订设定源（角色卡 + 世界信息）…');
            const src = await task.wait(autoComposeSource());
            if (!src.ok) { setStatus(`注意：设定源不可用：${src.reason}——请检查 ST 是否已载入角色卡/世界书`); return; }
            const extract = task.extract(resolved, src, { chunkChars, concurrency });
            setStatus(`设定源就绪（${src.label} · ${src.usedChars} 字符${src.truncated ? ' · 已截断' : ''}），开始抽取…`);
            // leg27 F1/F1b：抽取**全程可见**——进度事件 + 1 秒心跳读秒（用户「看不到日志」那一刀）
            const progressEvents = [];
            const progress = task.progress = extractionProgressHandler(progressEvents, { setText: setStatus });
            // ★★★leg150（甲案）：**人设名先读**——原来它到"安棋子"那一步才读，而甲案要在**抽取期间**
            //   就把玩家自己挡在起根候选名单外（那一刻账还没建，`context.playerId` 根本不存在）。
            //   名字读 ST 的 `name1`；★拿不到就退回空串（空串不排任何人），**不猜**。
            const personaName = (() => { try { return String(getCtx()?.name1 || '').trim(); } catch (_) { return ''; } })();
            const r = task.result = await task.wait(extractWorldSetting({
                sourceText: src.text,
                extract, // 双形取法：字符串/JSON 都吃
                force: false,
                // ★★★leg144：**并发几路从设置里读**（此前是一块一块排队：大荒 9 块 × 2 遍 = 18 次调用 ≈27 分钟）。
                //   数住 `src/abstract.js` 的 `EXTRACT_CONCURRENCY`（一处定义，三个调用点共用）。
                concurrency, chunkChars, signal: task.signal,
                // ★★★leg144：**书指纹缓存**（书没变 ⇒ 命中即零调用秒回；见上面 `abstractCache` 那一段）。
                //   `force: false` 正是"自动路径"该有的样子：书变了指纹就变、自动重抽。
                cache: task.cache,
                onProgress: progress.onEvent,
                // ★leg60：**题名面**（零 token 的 cast）走"照书办"通道强制并册——
                //   作者把名册写在题名里（三国 `控制器_张辽`×187 / `张辽正史`×184），模型只抽到 127 条。
                extraDeclared: src.titleRoster,
                // ★leg60（第 3 件）：**编译完整性读数**落进 `setting.frozen.compile`——面板与账本都看得见
                //   "书里有多少条设定类条目 / 本次编译覆盖了多少 / 声明面漏了多少"。
                //   ⚠★**只落摘要标量**（用户真账实测抓出的自己那一刀）：第一版我把整个 `src.catalog`
                //     铺进去了，于是 `titleRoster`（189 条带 `why` 的名号明细）**整块进账**——
                //     13,679 字符 = 账本的 **11.4%**，而且契约层没登记它（`additional:false` ⇒ 违约）。
                //     明细属于**控制台诊断面**（`logInitDiagnostics` 已有），账本只留计数。
                compileInfo: compileSummary(src.catalog, src.titleRoster),
                // ★★★leg150（甲案·用户令「起根并进第二遍」）：抽取的第二遍**顺带**问"书里正在发生的事"
                //   ⇒ 起根不再需要第三次通读全书（三国 42 → **28** 次调用）。给这一格 = 委托它顺带问；
                //   不给（或小书单发／命中书指纹缓存）⇒ 下面照旧走 `seedRootsForWorld`（行为零变化）。
                seedRoots: { playerName: personaName },
                // ★Task 3：与"只重抽设定"同一条纪律（新规矩不许只长在一条路上）。
                allowedSources: src.allowedBlocks || null,
                evidencePolicy: 'strict',
                onEvidence: diagEvidence,
            }));
            task.assertCurrent();
            progress.stop();
            // 抽取耗时与逐段读数（成功也要出声——"慢"必须有据可查）
            console.info('[story-world-v2] 抽取耗时实测', {
                ok: r.ok, cached: r.cached, timing: r.timing, steps: describeProgress(progressEvents),
            });
            logInitDiagnostics(getCtx(), src, r); // 控制台诊断（现场唯一证据面）
            diagSettingOutcome(r);
            if (!r.ok) {
                const tk0 = r.timing || {};
                const secs0 = tk0.ms == null ? null : Math.round(tk0.ms / 1000);
                console.warn('[story-world-v2] 抽取失败实测', {
                    timing: tk0, steps: describeProgress(progressEvents), errors: r.errors || [],
                });
                setStatus(`注意：抽取失败${secs0 == null ? '' : `（${tk0.calls || 0} 次调用 / ${secs0} 秒）`}：${(r.errors || []).join('; ')}${/超时|timeout/.test((r.errors || []).join(';')) ? '——请在调试台核对逐段失败记录，并检查模型服务状态或更换更快的模型' : ''}——世界未动`);
                return;
            }
            let seed = {
                version: 1,
                context: { world: src.worldName || '未名世界', tension: 0.5, positions: derivePositions(r.setting), setting: r.setting },
                entities: [], weights: {}, agendas: [], events: [], chronicle: [], milestones: [],
                meta: { tick: 0, simLog: [] },
            };
            // 第二十五棒 e：初始化创建世界时就把真书正文交给名册落账（零 token 兜底要用正文）；
            //   载入时也走同一路径（幂等）；初始化的候选准备必须在最终保存前完成。
            // ★Task 3：种账 + 关系网 + 读数一次做完（`web/seed-diagnostics.js`；本文件只接线）。
            const seedOut = seedAndReport(seed, { entries: src.worldInfoEntries || [], stage: '初始化种账' });
            // B 组接线：世界必须真的有一枚玩家棋子（否则五条"禁写玩家"守卫、掩码、影响通道全是死的）。
            // leg25 c：开档描述的**四维解析整段删除**（那个小调用连同 player-setup/player-inject 两个模块一起没了）
            //   ——四维浮点已不存在（没法精确表示；手拍值让"编的"看起来像"算的"）。
            //   玩家棋子现在只有身份与位置（结构性事实），和别的实体同尺；开档描述本身仍留在 meta 里可查。
            //   ★★leg32h（用户：「又把主角演了」）：**这里必须把玩家的真名传进去**。
            //   旧法 `attachPlayerPiece(seed)` 空参 ⇒ 棋子永远叫「你」⇒ 模型在第 42 轮把主角「黄坤」
            //   当**新实体**入局（`e_42_1`）⇒ 世界账里两个平行的人 ⇒ 模型一直很尽责地演黄坤
            //   （替他开盘算、推进、写"以雷法锁定薛铁衣气机，展开殊死搏杀"这类**玩家自己的选择**）。
            //   传名字后：`attachPlayerPiece` 会**复用同名实体**（名册里就有 → 直接认领），否则建一枚真名棋子；
            //   此后每轮载入还有 `namePlayerPiece` 兜底，把"后来才出现的主角实体"并进来。
            //   名字读 ST 的 `name1`（用户人设名）。★拿不到就退回旧口径（空串 ⇒ 「你」），**不猜**。
            //   ★leg150：这次读已**挪到抽取之前**（甲案要在抽取期间就把玩家挡在起根候选名单外）——
            //     这里直接用上面那个 `personaName`（同一次读，不许读两遍：两遍就可能拿到两个值）。
            const piece = attachPlayerPiece(seed, personaName);
            // ★★★leg87：这里原本还有一段「把设置页的开档描述写进 `seed.meta.playerDesc`」——
            //   随那张卡一起撤（依据：写进去之后**全仓零处读**，四维解析那一族 leg25 c 已整条删除）。
            //   撤掉它 = 新账不再多一个无人读的字段；旧账里已有的一律不动（引擎不读，迁不迁行为相同）。
            const playerFinal = seed.entities.find((e) => e.id === seed.context?.playerId);
            // ★★leg40：**从世界源起根**——新世界开局就种几条"书里正在发生的事"当线头。
            //   为什么必须在**开局**这一步（用户拍板：起根只留在"初始化"与"显式移植"两处，**载入期绝不自动跑**）：
            //   世界源被抽成静态设定 + 名册（0 条起过事）⇒ 全账第 25 轮之前只有 1 条事件 ⇒ 模型可引用的节点只有那场大乱。
            //   ★★位置：**必须在 `attachPlayerPiece` 之后**——根要落成事件，而当事人得在账上认得出人；
            //     甲案合进来之后，"**问**"挪到了第二遍（那时还没棋子，所以人设名是**显式递进去**的，见上面 `seedRoots`），
            //     而"**落账**"仍在原处（`src/seed-roots.js` 的 `seedRootsFromPass` 自己再挡一次玩家）。
            //   失败零阻塞（起根不成照常开局）；种下的根在面板链视图里标「由世界源而起」。
            try {
                // ★★★leg150（甲案）：**两条路，按"根有没有并进第二遍"分叉**——
                //   · 有（大书正常抽取）⇒ 直接落账，**一次调用都不再发**；
                //   · 没有（小书单发／命中书指纹缓存）⇒ 照旧走 `seedRootsForWorld`（行为与改造前逐字相同）。
                //   为什么按 `Array.isArray` 而不是"数组非空"：**并进来了但一条没起出来**也必须算"并进来了"，
                //   否则会退回去再发 N 次调用（那正是这一笔要省掉的东西）。
                setStatus(Array.isArray(r.rawRoots) ? '正在开局：把抽出来的根种进账…' : '正在开局：从世界源起根（读整本书里"正在发生的事"）…');
                const seededRoots = Array.isArray(r.rawRoots)
                    ? seedRootsFromPass(seed, {
                        perChunk: r.rawRoots, fingerprint: seedFingerprint(src.text || ''), at: new Date().toISOString(),
                        candidateCount: r.rawRootsCandidates, warnings: r.rawRootsWarnings,
                    })
                    : await task.wait(seedRootsForWorld(seed, {
                        sourceText: src.text || '', extract, fresh: true,
                        concurrency, chunkChars, signal: task.signal,   // ★leg144：起根这一遍也并发（同一个数、同一条网关）
                        // ★★★Task 4：起根那条路也要**来源身份 + 原话**（与上面抽取同一份发射端产物）。
                        //   `evidencePolicy:'strict'` 是**显式**的：拿不到允许来源 ⇒ 明确拒绝，不许静默回落 legacy。
                        allowedSources: src.allowedBlocks || null, evidencePolicy: 'strict',
                        onProgress: (e) => setStatus(`正在开局：起根 第 ${e.index}/${e.count} 块（${e.chars} 字符）${e.ok ? `· 得 ${e.got} 条` : `· 失败`}…`),
                    }));
                task.assertCurrent();
                if (seededRoots.warnings?.length) r.warnings = [...(r.warnings || []), ...seededRoots.warnings];
                if (seededRoots.ok && !seededRoots.skipped) {
                    setStatus(`正在开局：已从世界源起 ${seededRoots.seeded} 条根（${seededRoots.chunkCount} 块 · 候选 ${seededRoots.candidateCount} 人）…`);
                } else if (!seededRoots.ok) {
                    r.warnings = [...(r.warnings || []), ...(seededRoots.errors || [])];
                    console.warn('[story-world-v2] 起根未成（照常开局）', seededRoots);
                    setStatus('注意：起根未成（照常开局，见控制台）——世界照旧可用，线头可在之后再补');
                }
            } catch (err) {
            if (err?.sw2Cancelled || err?.sw2Stopped || task.signal.aborted) throw err;
                console.warn('[story-world-v2] 起根异常（照常开局）', err?.message || err);
            }
            const had = Boolean(target);   // = 本次确实换掉了一个现存世界（守门那一步已经查过，这里只留痕）
            task.assertCurrent();
            seed = prepareWorld(seed, { entries: src.worldInfoEntries || [] });
            const bookCheck = await task.wait(readBookCheck(seed, task));
            const flushed = await task.commit(seed, saveWorld);
            task.assertCurrent();
            publishBookCheck(bookCheck, task);
            refreshWorld(seed, { oldVolumes: getVolumes() });
            void had; void playerFinal;
            const tk = { ...r.timing, ...extract.stats() };
            const tsec = tk.ms == null ? null : Math.round(tk.ms / 1000);
            // ★leg144：命中书指纹缓存时**没有 `timing`** ⇒ 必须**如实说**"这本书刚抽过、直接复用了上次的设定"，
            //   而不是留空让人以为"这次抽得飞快"（本仓禁的那一类：说得比做的好听）。
            const extractNote = r.cached
                ? ` · 复用了上次设定 · 本次 ${tk.calls || 0} 次调用（含起根）`
                : (tsec == null ? '' : ` · 抽取 ${tk.calls || 0} 次调用 ${tsec} 秒`);
            setStatus(`新世界已就绪「${src.worldName || '未名世界'}」（${(seed.entities || []).length} 个名号 · ${seed.context.positions.length} 个地点 · 你=${piece.name} · 源=${src.label}${src.truncated ? ' · 源已截断' : ''}${extractNote}）${flushOutcomeText(flushed)}`
                + (r.settingReport?.empty ? ' · 注意：未抽到全局设定，详情见调试台「设定抽取」' : ''));
        } catch (err) {
            if (err?.sw2Cancelled || task.signal.aborted) throw err;
            throw err;
        }
    });

}

// leg95 · 只读诊断：这个端点对"长提示词 + json_object"到底回什么？（先证形状，再重跑回测）
import { loadStPresetConfig } from '../src/st-preset.js';
const cfg = loadStPresetConfig();
console.log('预设：', cfg?.presetName, '· 模型：', cfg?.model);

async function probe(label, prompt) {
    const endpoint = `${String(cfg.baseUrl).replace(/\/+$/, '')}/chat/completions`;
    const t0 = Date.now();
    let res, raw = '';
    try {
        res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
            body: JSON.stringify({
                model: cfg.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                response_format: { type: 'json_object' },
                max_tokens: 16384,
            }),
            signal: AbortSignal.timeout(180000),
        });
        raw = await res.text();
    } catch (e) { console.log(`\n[${label}] 请求异常：${e?.message}`); return; }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n[${label}] ${secs}s · HTTP ${res.status} · 原始 ${raw.length} 字符`);
    let data; try { data = JSON.parse(raw); } catch { console.log('  非 JSON 响应：' + raw.slice(0, 300)); return; }
    const ch = data?.choices?.[0];
    console.log('  finish_reason：', ch?.finish_reason, '· usage：', JSON.stringify(data?.usage));
    const c = ch?.message?.content;
    console.log('  content 类型：', typeof c, '· 长度：', typeof c === 'string' ? c.length : '（非字符串）');
    if (typeof c === 'string' && c.length) console.log('  前 200 字：' + c.slice(0, 200));
    else console.log('  ★内容为空 · message 全文：' + JSON.stringify(ch?.message ?? data).slice(0, 600));
}

// ① 极小提示词（确认这个端点用 json_object 是否正常）
await probe('极小 · json_object', '只回一个 JSON：{"ok":true}');
// ② 中等长度的判事提示词（形状与回测一致，但只给 6 件事）
await probe('中量 · 判 6 件事', `你是这个世界的作者。世界走到第 60 轮。下面这些事都发生过，账上把它们列在"还没结束"里，请判哪些该拿出来了。
拿不准的就不要列。
- ev_1_1 「万法阁商队集结」
    第 1 轮发生（距今 59 轮）· 发生在 东海浮空岛
    牵动过：万法阁
    来路：这件事是当时的局面自己拱出来的
    ★目前没有任何新事是接着它长出来的
- ev_25_3 「死煞核心二次暴动」
    第 25 轮发生（距今 35 轮）· 发生在 东海浮空岛
    牵动过：万法阁、东海龙宫
    来路：这件事是接着「死煞核心暴动」长出来的
    ★已经有 2 件新事是接着它长出来的：死煞核心彻底破阵暴走、死煞之气倒灌东海
- ev_41_1 「大盘谷血战爆发」
    第 41 轮发生（距今 19 轮）· 发生在 大荒
    牵动过：薛铁衣、黄坤
    来路：这件事是薛铁衣的打算「拿下大盘谷」推出来的
    ★已经有 3 件新事是接着它长出来的
- ev_49_1 「黄坤与薛铁衣正面血战」
    第 49 轮发生（距今 11 轮）· 发生在 大荒
    牵动过：薛铁衣、黄坤
    来路：这件事是接着「大盘谷血战爆发」长出来的
    ★目前没有任何新事是接着它长出来的
- ev_59_1 「太古剑气撕裂九霄云层」
    第 59 轮发生（距今 1 轮）· 发生在 东胜沧洲
    牵动过：楚星河
    来路：这件事是楚星河的打算推出来的
    ★目前没有任何新事是接着它长出来的
- ev_60_2 「大虞龙气外泄」
    第 60 轮发生（距今 0 轮）· 发生在 大虞京城
    牵动过：极乐公子、大虞
    来路：这件事是接着「欲魔女潜伏大虞窃龙气」长出来的
    ★目前没有任何新事是接着它长出来的

只回一个 JSON，不要任何别的字：
{"close":[{"event":"照抄上面那个编号","why":"一句话：为什么它已经结束了"}]}`);

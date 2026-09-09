// story-world-v2/src/async-tick.js
// K36 异步化与可靠性（编排层，细案 §3.3 → A-4/A-5）：
//   回合完成即推进（事件钩子由浏览器侧绑）+ 串行防重入（同世界一次一个 tick）+
//   失败世界不动（引擎不变式）+ 状态条报错 + 重试路径。
// 注入面：{ tick, load, save, refresh, onStatus } —— 纯编排语义，Node 可测（fake 注入全路径）；
//   浏览器侧（web/index.js）负责把 transport/存储/渲染接进来。本模块零 DOM、零传输依赖。
// 分层归属：编排层（铁律 9）。

/**
 * createTickQueue(deps) → { advance, busy }
 * deps:
 *   tick({world, dialogue}) → {ok, ssot?, error?}  一次主调用+结算（失败=世界不动）
 *   load() → world|null                            读热账（浏览器侧：chat metadata 最新 ctx）
 *   save(ssot) → hot                                 入卷轮转+热账写回（可异步：浏览器侧 await IDB/写回；失败=抛错）
 *   refresh(hot)→ void                             渲染刷新
 *   onStatus(msg) → void                           状态条（报错/进度）
 * 语义：
 *   - 防重入：演算中再次 advance → {ok:false, skipped:'busy'}（连点保护，A-5 锁）
 *   - 无世界：{ok:false, skipped:'no-world'}（零阻塞，状态条提示）
 *   - tick 失败：{ok:false, error}，世界未写（复制语义由调用方保证），可立即重试
 *   - save 失败：{ok:false, error, save:true}（世界已演算未落盘），可立即重试
 *   - tick 成功 + save 成功：refresh(真世界) → {ok:true, tick}
 */
export function createTickQueue({ tick, load, save, refresh, onStatus }) {
    let running = false;

    async function advance(dialogue = '') {
        if (running) {
            onStatus?.('⚠ 上一轮还在演算，稍候再试（防重入）');
            return { ok: false, skipped: 'busy' };
        }
        const world = load();
        if (!world) {
            onStatus?.('尚无世界：当前聊天没有世界账——可到设置页「✨ 开始新世界」一键创建（角色卡自动为源），或「⬆ 导入恢复」载入备份');
            return { ok: false, skipped: 'no-world' };
        }
        running = true;
        try {
            onStatus?.('演算中…');
            const res = await tick({ world, dialogue: String(dialogue ?? '') });
            if (!res.ok) {
                // 失败降级：世界原样不动（引擎不变式），状态条报错，重试路径=再点一次
                onStatus?.(`⚠ 演算失败：${res.error}（世界原样未动，可重试）`);
                return { ok: false, error: res.error };
            }
            // save 允许异步（浏览器侧：IDB 入卷 + 热账写回）——必须 await 拿到真世界再 refresh。
            // （第十三棒实机冒烟：save 是 async 而不 await，refresh 拿到 Promise，
            //  render 读 world.entities 抛「Cannot read properties of undefined」，
            //  状态条被后写的「已同步」覆盖——面板永远卡在推进前的旧内容。）
            let hot;
            try {
                hot = await save(res.ssot);
            } catch (err) {
                onStatus?.(`⚠ 落账失败：${err?.message || err}（世界已演算未保存，可重试）`);
                return { ok: false, error: String(err?.message || err), save: true };
            }
            refresh?.(hot ?? res.ssot);
            onStatus?.(`已同步 · 刚刚演完第 ${res.ssot?.meta?.tick ?? '?'} 轮`);
            return { ok: true, tick: res.ssot?.meta?.tick };
        } catch (err) {
            onStatus?.(`⚠ 演算异常：${err?.message || err}（世界原样未动，可重试）`);
            return { ok: false, error: String(err?.message || err), thrown: true };
        } finally {
            running = false;
        }
    }

    return {
        advance,
        get busy() { return running; },
    };
}
// story-world-v2/src/tick.js
// 完整 tick 编排（S6）：对话 → 落子提取 → 演化上下文 → 主调用（真 schema）→ 结算 → 双流。
// 这就是"最小活棋盘跑通一次完整 tick"的入口。
import { extractMove } from './extract.js';
import { buildEvolutionPack } from './pack.js';
import { runMainCall } from './worldstep.js';
import { settleTick } from './settle.js';
import { renderStreams } from './streams.js';

export async function runTick({ transport, ssot, dialogue, extractCtx, calls = 1 }) {
    const move = extractMove(dialogue || '', extractCtx || {});
    // 未提取落子（OOC/无可提取动作）不拦 tick：世界以自身状态为原料，照常结算（§3②）；
    // moveFact 为空则注入无行迹行。诚实未提取由调用方/度量记录。
    const pack = buildEvolutionPack(ssot, move.verb ? move : null);
    const main = await runMainCall({ transport, ssot, pack });
    if (!main.ok) {
        return { ok: false, error: main.errors.join('; '), move, pack, streams: null };
    }
    const s = settleTick({ ssot, step: main.step, moveFact: move, calls });
    if (!s.ok) {
        return { ok: false, error: `结算拒绝: ${JSON.stringify(s.stage.warnings)}`, move, pack, streams: null };
    }
    const streams = renderStreams(s.ssot, s.stage, move);
    return { ok: true, ssot: s.ssot, stage: s.stage, streams, move, pack };
}
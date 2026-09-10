// story-world-v2/src/tick.js
// 完整 tick 编排（S6）：对话 → 落子提取 → 演化上下文 → 主调用（真 schema）→ 结算 → 双流。
// 这就是"最小活棋盘跑通一次完整 tick"的入口。
import { extractMove } from './extract.js';
import { buildEvolutionPack } from './pack.js';
import { runMainCall } from './worldstep.js';
import { settleTick } from './settle.js';
import { renderStreams } from './streams.js';

export async function runTick({ transport, ssot, dialogue, extractCtx, calls = 1, preStep = null, onPreStep = null }) {
    const move = extractMove(dialogue || '', extractCtx || {});
    // 细案 spec-entity-field-lookup §3：**前置步**（① LLM 选本轮上场实体 → ② 只对缺字段者查书 →
    //   ③ 引擎回写查书标记）必须在 buildEvolutionPack 之前跑——否则这一轮主调用看不到刚查回来的字段。
    //   失败零阻塞：preStep 抛错/失败一律继续（世界推进优先，字段是附加信息）。
    let world = ssot;
    let picks = null;
    if (typeof preStep === 'function') {
        try {
            const pre = await preStep({ ssot: world, move });
            if (pre?.ssot) world = pre.ssot;
            picks = pre?.picks || null;
            if (typeof onPreStep === 'function') await onPreStep(pre);   // 编排层落盘点（防 Ctrl+F5 重查）
        } catch (err) {
            picks = null;   // 前置步失败 → 退回引擎镜头（旧路径零扰动）
        }
    }
    // 未提取落子（OOC/无可提取动作）不拦 tick：世界以自身状态为原料，照常结算（§3②）；
    // moveFact 为空则注入无行迹行。诚实未提取由调用方/度量记录。
    const pack = buildEvolutionPack(world, move.verb ? move : null, { picks });
    const main = await runMainCall({ transport, ssot: world, pack });
    if (!main.ok) {
        return { ok: false, error: main.errors.join('; '), move, pack, streams: null };
    }
    const s = settleTick({ ssot: world, step: main.step, moveFact: move, calls });
    if (!s.ok) {
        return { ok: false, error: `结算拒绝: ${JSON.stringify(s.stage.warnings)}`, move, pack, streams: null };
    }
    const streams = renderStreams(s.ssot, s.stage, move);
    return { ok: true, ssot: s.ssot, stage: s.stage, streams, move, pack, picks };
}
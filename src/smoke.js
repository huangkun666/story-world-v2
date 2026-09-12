// story-world-v2/src/smoke.js
// 合成冒烟（S7，长跑防线细案 §2.5 切片版；K6 泛化）：N tick 连跑，断言——输入恒在预算内、
// SSOT 增长有界、GC 数字首次实证（在飞峰/生半）、分量不发散（K2 起真公式 [0,1]）、零非预期警告、
// K6 起：门控统计（静默/应答/滤除累计）、分量曲线采样。纯确定性。
import { runTick } from './tick.js';
import { EVOLUTION_BUDGET_TOKENS } from './pack.js';

export const DEFAULT_TICKS = 50;
export const SLICE_AGENDA_CAP = 15;    // §4.3 在飞全局 ≤15（提案，暂定生效）
export const SLICE_NEWBORN_CAP = 2;    // §4.3 每 tick 新生 ≤2（提案，暂定生效）
export const SLICE_TOP_CAP = 5;        // §4.3 顶层（无父）在飞 ≤5（提案，暂定生效）

const BEGIN = 3;   // a_1（0/4 起打？黄金样本 progress=1，maxSteps=4）：
                   // 黄金样本 a_1 progress=1 → 3 次推进到 4 → tick 3 强制结算，其后空转

const advanceStep = (n) => ({
    actions: [{ entity: 'e_merchant', verb: '沿商路北上巡查', position: '商路' }],
    newEvents: n === 1 ? [{ title: '守将允诺通关', source: { type: 'plot', ref: 'a_1' }, position: '边关', ripples: ['e_merchant'] }] : [],
    agendaAdvances: [{ agendaId: 'a_1', step: `推进第 ${n} 步`, stage: `阶段${n}` }],
    newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [],
});
// leg25 c：`stateChanges` 已从世界步契约删除（四维浮点不存在了），合成步骤随之不再产它。
const idleStep = () => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [] });

// stepGen(tick, world) → 世界步提案（K6：门控冒烟自定义生成器）；dialogueGen(tick, world) → 对话（K11：玩家落子段冒烟）
// onTick(tick, world) → void（可选观测钩子，零行为变化）：给"逐 tick 取数"的测量脚本用
//   （leg27 后量快照增量体积就靠它——纯观测，不参与任何判据、不落任何账）。
export async function runSmoke({ ssot, extractCtx, ticks = DEFAULT_TICKS, stepGen, dialogueGen, onTick = null } = {}) {
    let world = structuredClone(ssot);
    const metrics = {
        ticks: 0, maxPackTokens: 0, closedAtTick: null,
        bytes: [], warningsTotal: 0, peakOpenAgendas: 0, newbornsTotal: 0,
        silentTotal: 0, liftedTotal: 0, droppedTotal: 0, weightSeries: {},
        // K16 树冒烟统计（盘算树细案 §4 K16）：每 tick 新生峰 / 顶层峰 / 盘算大厦顶拒绝数
        maxPerTickBirths: 0, peakTopLevel: 0, rejectedTotal: 0,
        // K29 设定池冒烟：张力强度曲线采样 + 熵泵种子累计（热池事件 + 归档里程碑承接，链条不断口）
        intensitySeries: {}, pumpSeedTotal: 0,
    };
    for (let t = 1; t <= ticks; t++) {
        const step = stepGen ? stepGen(t, world) : (t <= BEGIN ? advanceStep(t - 1) : idleStep());
        const dialogue = dialogueGen
            ? dialogueGen(t, world)
            : (stepGen ? '（继续）' : (t <= BEGIN ? '我沿商路去看看' : '（静默）'));
        const transport = async () => ({ text: JSON.stringify(step) });
        const r = await runTick({ transport, ssot: world, dialogue, extractCtx });
        if (!r.ok) throw new Error(`冒烟 tick ${t} 失败: ${r.error}`);
        world = r.ssot;
        metrics.ticks = t;
        metrics.maxPackTokens = Math.max(metrics.maxPackTokens, r.pack.estTokens);
        metrics.warningsTotal += r.stage.warnings.length;
        const open = world.agendas.filter((a) => !a.closed).length;
        metrics.peakOpenAgendas = Math.max(metrics.peakOpenAgendas, open);
        // K16 树冒烟统计：新生（id 固定前缀 a_<tick>_，引擎生成器专有格式）、顶层峰、大厦顶拒绝
        const newBorn = world.agendas.filter((a) => a.id.startsWith(`a_${t}_`)).length;
        metrics.newbornsTotal += newBorn;
        metrics.maxPerTickBirths = Math.max(metrics.maxPerTickBirths, newBorn);
        metrics.peakTopLevel = Math.max(metrics.peakTopLevel, world.agendas.filter((a) => !a.closed && !a.parentId).length);
        metrics.rejectedTotal += r.stage.warnings.filter((w) => w.includes('盘算大厦顶')).length;
        if (metrics.closedAtTick === null && world.agendas.every((a) => a.closed)) metrics.closedAtTick = t;
        const last = world.meta.simLog[world.meta.simLog.length - 1];
        if (last) {
            metrics.silentTotal += last.silent?.length ?? 0;
            metrics.liftedTotal += last.lifted?.length ?? 0;
            metrics.droppedTotal += Object.values(last.silentDropped ?? {}).reduce((a, b) => a + b, 0);
        }
        if (t % 10 === 0 || t === ticks) {
            metrics.bytes.push({ tick: t, bytes: JSON.stringify(world).length });
            metrics.weightSeries[t] = { ...world.weights };
            if (world.context?.setting?.dynamic?.tension) metrics.intensitySeries[t] = world.context.setting.dynamic.tension.intensity;
            metrics.pumpSeedTotal = world.events.filter((e) => e.id.startsWith('ev_pump_')).length
                + (world.milestones || []).reduce((a, m) => a + m.ids.filter((id) => id.startsWith('ev_pump_')).length, 0);
        }
        // leg27 后：逐 tick 观测（纯读，零行为变化；异常不许影响冒烟本体）
        if (typeof onTick === 'function') {
            try { onTick(t, world); } catch (_) {}
        }
    }
    return { world, metrics };
}

export function assertSmoke({ world, metrics, budgetTokens = EVOLUTION_BUDGET_TOKENS }) {
    const errors = [];
    if (metrics.maxPackTokens > budgetTokens) errors.push(`输入超预算: ${metrics.maxPackTokens} > ${budgetTokens}`);
    if (metrics.warningsTotal !== 0) errors.push(`非预期警告 ${metrics.warningsTotal} 条`);
    if (metrics.peakOpenAgendas > SLICE_AGENDA_CAP) errors.push(`在飞盘算峰 ${metrics.peakOpenAgendas} 超 ≤${SLICE_AGENDA_CAP}`);
    if (metrics.newbornsTotal > 0 && metrics.maxPerTickBirths > SLICE_NEWBORN_CAP) errors.push(`每 tick 新生峰 ${metrics.maxPerTickBirths} 超 ≤${SLICE_NEWBORN_CAP}`);   // K16：切片语境（无创建路径）天然 0；树冒烟按上限断言
    if (metrics.peakTopLevel > SLICE_TOP_CAP) errors.push(`顶层在飞峰 ${metrics.peakTopLevel} 超 ≤${SLICE_TOP_CAP}`);
    const finalBytes = JSON.stringify(world).length;
    if (metrics.bytes.length < 3 || finalBytes > 20000) errors.push(`SSOT 增长异常: 终态 ${finalBytes} 字节`);
    const weightsOk = Object.keys(world.weights).length === world.entities.length
        && Object.values(world.weights).every((w) => w >= 0 && w <= 1);
    if (!weightsOk) errors.push('分量越界或缺失（K2 真公式起应在 [0,1] 且覆盖全部实体）');
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors };
}
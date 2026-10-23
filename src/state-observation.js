// story-world-v2/src/state-observation.js
// 显式观察元数据（committed state changes 的可见性披露）的**公共入口**。
//
// 为什么住在这里而不是 `event-contract.js`：实现（`observationSchema` / `storedObservationSchema` /
//   `observationErrors` / `storeObservation`）必须与 `conditionUpdateErrors` / `applyConditionUpdates`
//   同住 `event-contract.js`（条件那一路就在那里校验与落账，放别处会成环）。
//   而对外只暴露这一个模块 ⇒ 消费者（schema / check-step / 面板 / 可见性投影）import 它**不成环**：
//   依赖方向恒为 `state-observation → event-contract`，反向一条都没有。
export {
    observationSchema,
    storedObservationSchema,
    observationErrors,
    storeObservation,
} from './event-contract.js';

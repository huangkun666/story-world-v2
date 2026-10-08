# 事件打磨实施计划

> 实施方式：使用 subagent-driven-development，按模块先写行为测试、证红、实现、复核。用户于 2026-10-07 明确批准开工。

**目标：**聊天事件不回流聊天，普通动作不成为未决事件，重要结果在世界输入中出现一次，同一消息版本不重复消费。

**架构：**事件来源与因果来源分开判断。聊天通过版本化 tags 提交事件结果，行动仅作当轮保护。消息版本消费记录随世界提交保存；异步提交核对聊天和世界版本。

**技术：**原生 JavaScript ESM、Node 内置测试、既有 ST/TT 宿主适配层；不增加依赖。

**完成状态：**产品代码已合入 F 盘日常项目，本机测试、真账副本重放和固定输入的真模型对照已完成。实际 ST/TT/手机保存回读仍未验证；最终全面独立整合审查因子代理额度限制未取得结论，主 agent 处理已返回发现并继续复核。详见 `docs/session-handoff-2026-10-07-leg202-event-polish.md`；以下勾选代表本机实施任务及边界记录完成。

## 全局约束

- 唯一日常项目为 F:/deepseek/plugins/story-world-v2；实施树为 F:/deepseek/worktrees/event-polish-2026-10-07/plugins/story-world-v2，基线 8bc13a2。
- 不改真账、世界书、宿主安装；不发布，不推送。保留已有未提交文档。
- 不用动词词表、相似度或分数判断事件重要性；不恢复引用不匹配拒收。
- 不新增诊断页面或成排按钮。诊断进入复制报告。未知来源保留旧行为并如实统计。
- 不设聊天条数或硬配额；web/index.js 保持现有行数硬锁，必要时抽出消息处理模块。

## 任务 1：阻断回流（独立模块）

文件归属：src/event-provenance.js、src/ledger-recall.js、src/ledger-vector.js、web/vector-recall.js（如实际存在）、web/inject.js、相关新增测试。

- [x] 统一 classifyRecord(ssot, row, {volumes}) 返回 producer=chat/world/setting/unknown、recordType=result/state/maintenance；优先明确来源，再用 eventRef/chainRef、归档里程碑、确定的登记行 ID。
- [x] 所有聊天检索在预算与 top-N 前排除 chat result 和 maintenance；向量过滤补位，世界检索仍可取聊天历史。
- [x] 最终注入再次过滤；保留当前状态与由世界产生的聊天事件后果。记录选入 ID、过滤原因与未知来源数量。
- [x] tags 规范改为 v3：`【协议】3`、`【事件】E1｜结果摘要｜参与者名（顿号分隔）｜已完成或未决`，可选第五格为既有因果事件 ID（顿号分隔）。变化与承诺可在现有三格后加第四格本消息事件编号。事件继承场景/此刻；行动只标本轮已行动者。
- [x] 行为测试覆盖热账、冷卷、关键词、向量补位、维护记录、未知来源、状态保留和世界新后果。

## 任务 2：统一聊天事件（独立模块）

文件归属：src/tag-extract.js、src/settle.js、src/tick.js、src/schemas/ssot.schema.js 的事件/编年/归档字段、冷卷及归档保存来源的模块、相关测试。

- [x] 解析任务 1 的 v3 协议。事件输出 `{localId,title,participantIds,pending,location?,causeIds?}`；变化与承诺的 `eventLocalId` 关联同一结果。结构错误留诊断；未知参与者保留名称信息，不伪造实体。
- [x] 普通行动不建事件。无新事件标签的旧协议继续接收变化与承诺，变化建已完成结果、承诺保留未决；原事件不迁移、不删除。
- [x] 关联变化落同一结果、相同字段未变化不再新增变更事件。独立变化与承诺保持独立；因果引用只认存在的账上事件。
- [x] registerDialogueFacts 增加 `resultEvents`（本次落账事件本体）、`actedIds`、`changedFields`（`{entityId,field}`）。runTick 将简洁事件放 `turnFacts.events`，保护放 `actedIds` / `changedFields`，不再传普通动作全文。
- [x] 新增 dialogueKind=result；producer 与 recordType 可选字段须登记 schema，归档/冷卷不得丢来源。已完成事件仍可作因果源。
- [x] 测试先证红：问候不建事件、身份许可单结果关联多变化、承诺与独立结果、旧协议、解析边界、当轮玩家及字段保护。

## 任务 3：消息消费与异步保存（独立模块）

文件归属：web/message-consumption.js、web/index.js、src/async-tick.js、宿主保存模块、src/schemas/ssot.schema.js 的 meta 字段、相关新增测试。

- [x] 使用宿主真实消息 ID；没有时登记可保存的 extra.story_world_v2_message_id。身份含聊天、消息、swipe/版本及内容指纹，不能用数组下标或正文相等作为唯一身份。
- [x] meta.chatConsumption 保存消息版本、消费轮次、事件 ID、变更字段；与世界同笔保存。失败不消费，重试不重复写事件；刷新保留记录。
- [x] 手动无新助手消息仅推进世界，传空 dialogue；用户消息/系统消息不当助手标签。不同消息同正文分别消费。
- [x] 队列提交前核对聊天作用域和世界版本；前置查书保存同样拒绝迟到结果。保存失败回滚内存热账。
- [x] 已消费消息的编辑、删除、swipe 切换须拒绝自动覆盖，说明需通过已有快照回到受影响轮前核对重算；不静默撤销历史事实。
- [x] 测试覆盖 ST/TT 消息形状、失败重试、刷新、世界仅推进、切聊天/回档迟到结果、编辑版本及删除。

## 任务 4：完整世界输入与共同事件定义（主 agent）

文件归属：src/pack.js、src/prompts.js、src/gate.js、src/sanitize-step.js、因果引用判定模块、web/debug-console.js 的报告部分、相关测试。

- [x] 依据 turnFacts.events 中已提供事件 ID，在 pendingEvents、recentClosedEvents、纪事和相关往事中只保留必要引用或去掉重复正文，先去重再走既有总预算。
- [x] 当轮行动及字段保护使用紧凑保护集合；世界既有待办保持完整。闭合聊天结果仍能引出世界新后果，历史归档因果仍合法。
- [x] 世界提示词与聊天规范采用同一事件定义；世界提出新影响，不重演、复述或替玩家落子。同批升 MAIN_PROMPT_V。
- [x] 完整最终包的组成与重复计数、消息保存结果进入已有复制报告，不扩展页面。
- [x] 行为测试覆盖结果只出现一次、世界待办不被挤掉、已行动人物与改定字段保护、闭合及归档因果、无聊天轮次零漂移。

## 最终验收与交付

- [x] 对已复制真账重放最终注入；不调用原账、不修改原账。保存前后统计与未知来源单独报告。
- [x] 新增针对行为的回归测试；全量 node --test、node demo/smoke-demo.js、泛用性检查、语法检查通过。
- [x] 独立代码审查并修复重要问题；将代码集成到 F 盘日常项目，保留原未提交内容。
- [x] 更新 STATE.md 当前值、work-current 的实施状态（用户原令不改），建立 F 盘交接，运行知识索引与文档守门。
- [x] 固定副本/输入的真模型对照须使用已有已授权通道；若环境取不到通道或无法进入实际 ST/TT/手机，明确记录未验证项，不以单测代替。

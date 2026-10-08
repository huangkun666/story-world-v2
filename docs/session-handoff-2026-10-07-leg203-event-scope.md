# 事件范围与持续条件 · 本地试跑交接

日期：2026-10-07（Asia/Shanghai）。接手入口为 `STATE.md`；当前测试、构建号、版本与安装现场读数只看 `STATE.md` §1、§5。

## 人话版：这会怎么样

全校公告可以记录成一件面向全体学生的事件，不用把有戏份的几个人冒充全部受影响者。公开范围、适用范围与当事人分开。公告结束后，仍有效的规则单独保留；人物通过合理途径获知后可以作出反应，不维护逐人知情或接收记录。

## 授权与范围

用户逐字授权：「可以，开工吧，之后安装在本地我测试下质量」。此前讨论与原令保留在 `docs/work-current.md` §1。

细案为 `docs/superpowers/specs/2026-10-07-event-scope-and-lifecycle-design.md`；执行计划为 `docs/superpowers/plans/2026-10-07-event-scope-lifecycle.md`。只做本地预览，不推送发布仓；没有调用真实模型，没有改现有聊天、世界书或用户账。

## 已实现

- 协议 4 的事件结果有明确完成/未决状态，分别关联类别、当事人、影响范围、公开范围与原公告说法。未知群体保留原文；只有明确实体或成员关系才解析确认部分，历史确认不回填。
- 已有事实通过引用提供，不新建一次公告。新版不再混入旧 `ripples`；协议 3 仍兼容。坏新版头、关联与条件只留诊断，不退回旧名单猜测。
- 当前持续条件有原始原因、适用范围、生效声明、明确结束/替代原因及变化历史。原因事件归档后条件仍在；结束的条件不会作为现行规则注入。
- 普通获知途径写在行动或新盘算的缘由；重要泄露、截获、误传可产生普通因果结果。公开范围不自动变成已知、已行动或行动资格。
- 具有明确事件依据和合理缘由的具体反应者可以行动；合法同轮原因按原提议身份核对，删除或额度拒建的原因不能替人物解除静默。新版未决义务只经明确收场关闭。
- 世界输入、聊天当前状态、归档、召回、导入导出与增量快照保留新字段。本轮范围只从本轮事实提供，其他栏目引用身份；预算不足时新版事件和条件按完整项取舍并留下诊断。
- 事件详情显示范围；「观棋 → 查世界 → 世界现状、各方打算与地图 → 持续条件」可以查看仍有效或尚未生效的条件。默认折叠，沿既有页面布局。

## 验收证据

当前数值见 `STATE.md` §1。证据在 F 盘：

- 全量测试：`F:/deepseek/worktrees/event-scope-lifecycle/final-reviewed-tests.log`；真实 runTick、保存往返、归档引用和成员变动由 `test/event-scope-integration.test.js` 覆盖。
- 冒烟：`F:/deepseek/worktrees/event-scope-lifecycle/final-smoke.log`；旧协议合成世界终态保持原形状。
- 只读泛用性核对：`F:/deepseek/worktrees/event-scope-lifecycle/final-genericity.log`。现有世界书普遍缺结构化成员关系，因此未知范围保留原文；该检查不证明模型创作质量。
- 独立任务审查：`F:/deepseek/worktrees/event-scope-lifecycle/chat-review-report.md`、`core-review-report.md`、`integration-review-report.md`。发现的同轮原因漏认可、预算范围丢失和重复范围均补回归后修复。最终审查见同目录 `final-review-report.md`。
- 真实 Chrome + 生产外壳/样式/渲染/阅读控制器的合成展示：`F:/deepseek/tmp/event-scope-preview-2026-10-07/verification.json`。桌面和手机的改前/改后事件截图、现行条件截图均在该目录；未使用用户真实聊天。

审查还发现条件曾只在已撤出的动态流输出，真实组合页无法看到；现已接入「查世界」并以真实浏览器点击验证。

## 本地安装

已安装到酒馆实际加载的用户扩展：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`。安装工具、旧部署备份与核验统一放 `F:/deepseek/tmp/event-scope-local-preview-2026-10-07/`；该目录 `installed-tests.log` 和 `installed-smoke.log` 通过，`install-verification.json` 确认运行文件一致且部署干净，`http-verification.json` 确认酒馆实际 HTTP 返回与源码逐字节相同。最终文档收尾会另记本地提交，运行内容不变；现场读数见 `STATE.md` §5。

## 下一步

用户强制刷新酒馆后，从体育馆原场景重新生成一次：检查公告能否写完整群体范围，普通动作是否独立，持续规则能否留下，人物后续获知是否有合理缘由。结构测试通过不能代替真实模型的输出质量验收。实际 ST/TT/手机保存回读仍需现场验证；旧账不推断或补写历史知情与范围。

后续工作只按 `docs/work-current.md` 与用户新反馈推进；其它待办仅引用 `STATE.md` §3。

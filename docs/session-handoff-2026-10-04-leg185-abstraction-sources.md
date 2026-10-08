# 抽象来源、自由取料与有据入账交接

用户批准的四项工作均已完成，并已安装到本机酒馆。源码目录与安装目录分别完成正常全量测试和冒烟；安装文件与提交源码逐字节一致，两棵工作树均干净。刷新酒馆页面（Ctrl+Shift+R）后，在「设置 → 抽象来源」使用。

当前测试数量、构建号、样式号、缓存版本、入口行数等唯一权威值见 [源码 STATE.md §1](C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2/STATE.md:40)。F 盘原开发分支的 STATE.md 与源码未被覆盖；本文件只是新增交接，不是另一份当前数值台账。

## 已完成的行为

- 显示所有成功读取的世界书条目，包括禁用、技术内容和空正文；角色卡的描述、情景、性格、开场白分别列出。跨来源同名条目保留，来源内只按身份去重。
- 每项可选自动清理、全文或多段原文。原文只读，取消或选取禁用条目不会改变原书开关；原文变化后旧选段必须重新选择。
- 支持按来源、搜索和筛选操作，再批量选择、反选、取消勾选禁用项等。批量操作只作用于当前显示范围，隐藏的选择保留。默认与明确的自选空方案分开，选择按聊天保存，切换聊天时旧页面不能写入新聊天。
- 预览显示真正给模型的内容。初始化、标题依据、起始事件、查书和缓存使用同一份最终有效材料；超出预算或未生效的内容不能靠标题或旧缓存重新进入。
- 角色、势力、别名、所属、属性与关系由模型提议，程序核对本次来源和确切引文后入账。缺类型不自动当角色，缺依据不填值，身份含糊不取第一项；不再按成员词或名称包含关系擅自造事实。
- 已确认的完整别名保留并参与实际查找、所属、关系端点和起始事件。长条目只出现别名时，也会定位该段原文并真正交给查书模型。
- 已有世界不会自动重抽，原实体编号、死亡状态与旧快照保持原有连续性。

这些变化修的是程序在模型前后丢料、截断别名、错误归类或绕过取料范围的问题。模型仍负责语义判断；来源与引文核对能约束无依据的结果，不能保证模型永远判断正确。本次未调用真实模型，不能据离线验收声称真实识别质量已提高到某个数值。

## 现场与提交

- 唯一实施源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`，分支 `codex/entities-refresh`。
- 最终源码提交：`4d5d49b7544d836116a1a2ef5d6f19f0c5a0fa57`。最后生产修复为 `937c011603aa9245ed50b1bd5458b947ac3bb8e8`，随后仅刷新生成索引。
- 本机安装：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，分支 `main`，提交 `83b147051e28856e3dc11a0aef0030e7fe9b4e1e`。
- 安装脚本：`F:/deepseek/tmp/leg185-abstraction-sources/install-local-preview.mjs`。脚本从已提交插件子树生成本地预览提交，核对干净基线并快进安装；没有推送远端，也没有合并到原开发 main。
- 原来的 `C:/Users/30319/.codex/worktrees/134f/` 不是本次源码权威，不应继续在其中实施。

## 验收与证据

所有证据位于 `F:/deepseek/tmp/leg185-abstraction-sources/`：

- `source-release-final-verification.json`：最后生产代码的正常全量测试和冒烟通过。
- `installed-final-verification.json`：安装目录独立正常全量测试和冒烟通过。
- `install-verification.json`：来源与安装提交、跟踪文件清单、逐字节一致与安装目录干净。
- `source-syntax-verification.json`：最终提交的变动脚本语法、差异空白、入口行数与 STATE 大小检查通过。
- `docs-audit-verification.json`：文档守门、当前读数与生成知识索引同步通过。唯一黄色提示是冻结 LEDGER.md 的历史超长行，与本次无关，未重写历史。
- `browser-task2-parent/artifacts/verification.json`：实际桌面、平板与手机渲染、筛选、批量操作、选段、预览、来源重载和过期写入拦截通过。
- `browser-task2-large/artifacts/verification.json`：大列表末尾条目的手机正文进入视口，桌面正文保持可见并保留列表滚动位置；最初失败证据留在同目录的 `red/`。
- `task-1-accepted-review.md`、`task-2-accepted-review.md`、`task-3-second-fixes-review.md`：分项审查已接受。
- `whole-feature-review.md`：整包审查发现的唯一最终问题为长条目别名定位，末尾关闭记录已核对修复并给出 Ready。审查员在保存关闭记录后遇到额度限制；主任务读取了实际保存的记录及对应代码、证据，没有把失败状态当作成功输出。
- `final-long-alias-red.json` 与 `final-long-alias-accepted.json`：同一实际查书回归先失败后通过，验证正文片段、真正发出的请求与字段入账。
- `task-4-boundary-report.md` 与 `integration-boundary-probe-green.json`：严格查书、来源身份、起始事件、歧义与完整别名的真实调用验收；原始失败探针保留。

本机 dsh 参与了分项实现与只读分析。最后一个实施工人在代码完成后重复准备基线，已由主任务取消并接管；主任务补齐实际调用回归、全量验证、文档、安装和本交接。没有仍在编辑的 worker，没有给这一项留下继续实施的活儿。

## 后续边界

本次已批准工作已办结。历史未决事项仍只以源码 `STATE.md` §3 为准，不从旧交接或审查观察自行挑选新工作。真实模型重跑、发布远端和自动重抽现有世界都未在本次进行；不要将本机预览安装记为远端发布。

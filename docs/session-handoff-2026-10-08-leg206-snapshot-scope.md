# 快照重复项与诊断范围修正交接

当前读数、构建与版本只看 `STATE.md` §1，真实安装目录看 §5。唯一日常项目是
`F:/deepseek/plugins/story-world-v2`；新交接继续写这里的 docs。用户最后两条原话见 `docs/work-current.md` §1。

## 用户问题与原因

用户要知道完整与增量是否是同一个回档结果、为什么要列两份。上一版只是注明“相同”，
仍保留两个按钮，并增加具体内容说明，未解决选择问题。诊断包装了宿主 console 与页面资源，
把酒馆设置、宏弃用和页面图片失败也收到插件调试台，范围过大。

完整保存世界，增量保存相对锚点的修改，属于后台节省空间的实现；恢复流程会自动组合。
用户不应据此选择回档，列表现在按实际恢复结果合并。

## 最终行为

- `previewSnapshots` 只读还原已有记录，以世界和恢复时会使用的 `memoryHistory.known` 判等，
  对象键顺序不影响比较。相同状态只一行，优先保留真实当前 ID，否则保留最新 ID。
- 底层快照不删除、不迁移，锚点和恢复链保留。世界相同但历史 known 不同不合并。
  坏链仍显示无法读取并禁用按钮，避免误报可恢复。
- 列表隐藏 ID、完整/增量、字节和具体内容变化，只显示轮次、差异数量、本地时间和按钮。
  同轮不同状态显示保存顺序及最新标记。差异数量与上一份不同的可读状态比较，第一份无基准。
- 回档按钮保持原始目标 ID，确认显示轮次与保存时间，结果不展示内部存储类型。
- `runtime-diagnostics.js` 统一本插件来源判据；异常 filename 优先，缺失时检查实际首个栈帧。
  不跳过 data/blob/匿名来源去匹配后续插件调用者；无法定位的来源不采集。
  console 只收显式插件前缀或本插件源 Error，资源仅收自身根路径；保留浏览器原行为。
- 现有插件关键操作与结构化错误记录、脱敏、复制报告、实时刷新和筛选保留；关窗等噪声继续过滤。

## 验证与审查

证据目录：`F:/deepseek/tmp/snapshot-debug-scope-2026-10-08/`。

- 开工前基线、红测、全量、冒烟分别留在 baseline/red/worktree 日志。
  新测试验证 full/delta 判等、原当前 ID、非连续重复、键序、历史范围以及大差异数量。
- 浏览器用真实模块及样式、合成快照，在桌面和窄屏把相同 delta/full 合并为一个真实 ID，
  点击回档按钮验证还原结果；宿主和未知来源零记录，本插件控制台/异常/拒绝/资源实时可见。
  报告 `browser-verification.json`、截图 `after-snapshots-*.png` 和 `after-debug-*.png`。
- 独立只读审查指出首帧为 data/匿名来源时会误取后续插件帧，已修复并补反例；复审通过。
- 合回前核对声明文件的日常开工指纹，备份原件并保留先前未提交改动。
  记录 `source-integration.json`；日常 HEAD 未变。工作树在
  `F:/deepseek/worktrees/snapshot-debug-scope/plugins/story-world-v2`。

日常文档守门现跑全量通过，安装目录全量和冒烟通过；全部运行文件与日常源字节相同，
本次变动的运行模块通过实际酒馆 HTTP 路由核对。日志分别为 `source-doc-audit.log`、
`installed-tests.log`、`installed-smoke.log`、`http-verification.json`。
安装前 Git 历史 bundle 及原树 tar 在 `backup/`；安装目录最终文档守门与本地提交见
`installed-doc-audit.log`、`install-verification.json`。未调用真实模型、未写用户世界或聊天、未推送远端。

## 本地复测

安装完成后在酒馆 Ctrl+Shift+R，再打开快照页：相同恢复状态应只有一个入口；
同轮确实不同的状态保留保存时间和差异数量。调试台只应出现本插件记录。
这次浏览器验证使用合成数据，真实 ST/TT 及实体手机的完整保存回读仍由用户现场验证。

设计与实施计划：`docs/superpowers/specs/2026-10-08-snapshot-debug-scope-design.md`、
`docs/superpowers/plans/2026-10-08-snapshot-debug-scope.md`。不要把先前交接的“具体差异”或“页面资源采集”恢复回来。

# 来源页关闭正文、搜索与批量结果修复交接

本次用户要求已完成，并已安装到本机酒馆。Ctrl+Shift+R 刷新后使用「设置 → 抽象来源」。当前构建号、样式号与测试数量统一见 [源码 STATE.md §1](C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2/STATE.md:40)。

## 修复行为与原因

- 原文与选段栏新增「关闭正文 ×」。关闭只清除正在查看的条目，保留勾选、读取方式、已存选段、搜索与来源筛选；再次点「查看正文」即可打开。正文关闭时列表占满宽度，键盘焦点回到查看按钮，条目已被筛掉时回到搜索框。
- 搜索过滤原本正确设置了 `hidden`，但条目的 `display:flex` 样式覆盖了浏览器的默认隐藏规则，使未匹配条目依然显示。添加来源页范围内的 `[hidden]{display:none!important;}` 后，列表与结果计数一致。
- 全选结果、反选结果、取消结果继续操作搜索与来源筛选共同决定的当前结果。隐藏条目的选择保留，零结果时这些按钮不改变选择。

## 源码与本机安装

- 源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`，分支 `codex/entities-refresh`，提交 `1ccfd478329d2753388d6c65ff96c00dba0d1aae`。
- 安装：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，分支 `main`，提交 `323111f8e2fde240c3ffd682e5c98c3fcf617647`。
- 安装脚本：`F:/deepseek/tmp/leg186-source-picker/install-local-preview.mjs`。从已提交插件子树生成本地预览提交，核对干净基线并快进；安装跟踪文件与源码逐字节一致。源码与安装工作树均干净，未推送远端。
- 当前聊天默认的 `c2c6` 工作树版本较旧，本次没有在该目录实施。F 盘原开发分支的源码与 STATE.md 未覆盖，只在规定位置新增本交接。

## 验收证据

证据目录：`F:/deepseek/tmp/leg186-source-picker/`。

- `source-tests.log`：源码全量测试通过。
- `installed-final-verification.json`、`installed-tests.log`、`installed-smoke.log`：安装目录独立全量测试、合成冒烟与修改脚本语法检查通过。
- `install-verification.json`：安装提交、文件逐字节一致与干净工作树。
- `browser-red/verification.json`：修复前真实浏览器显示条目数与搜索计数不一致，回归按预期失败。
- `browser-green/verification.json`：修复后搜索、零结果、组合筛选、批量操作、正文关闭、重新打开、焦点与选段保存均通过。
- `browser-large/verification.json`：合成大列表验证通过。首次扩大夹具后有一处沿用小夹具的条数断言，已改为扩充后的实际条数并完整重跑。
- `browser-installed/verification.json`：对实际安装源码独立重跑大列表浏览器验收通过；桌面、平板与手机宽度均无横向溢出，未捕获异常为空。报告与截图来自合成夹具，不是用户聊天。
- `review-source-picker.md`：只读代码审查通过。

文档知识索引已刷新，文档守门通过；唯一黄色提示仍为冻结 LEDGER.md 的历史超长行。本次没有修改世界书、角色卡或用户聊天，也没有调用真实模型。

本次关闭与筛选修复已办结。此前的模拟首轮空输出、同文跨来源与历史未决事项不属于本次实施范围；如需继续调查，以用户下一步要求和源码 STATE.md 为准。

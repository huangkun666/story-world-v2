# 观棋留白、信息密度与名称下划线交接

人话版：观棋内容从居中窄栏铺到可用宽度，页头和行间距收紧，一屏能读到更多故事。人物与势力用蓝色加亮下划线，地点用琥珀色加亮下划线；故事正文中的名称可打开现有说明。页签只叫「观棋」。

授权来自用户 2026-10-02 的实际截图与明确修改请求。本次仅调整已实现阅读器的显示，后续机制工作不由此授权。

## 文件与规则

- 先前交接保留在 `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-02-leg174-story-reader.md`。确认 F 盘与 C 盘文件逐字节相同后，已删除用户点名的 e37e 副本及本次 d630 工作树内同名副本。
- 所有新交接统一放 `F:/deepseek/plugins/story-world-v2/docs/`。原项目和本次源码工作树的 `AGENTS.md` 已记录，不在 C 盘创建新交接。历史上其他棒次的归档保持原样。
- 源码：`C:/Users/30319/.codex/worktrees/d630/plugins/story-world-v2`，分支 `codex/story-reader-density`，从之前已安装的阅读器提交接续。F 盘原开发分支保留，其 `STATE.md` 仍属于该旧分支。
- 当前读数以本次源码工作树的 `STATE.md` §1 为准。阅读器设计在 `docs/spec-story-reader.md`，F 盘同名设计已同步；调整计划在本目录 `plan-story-reader-density.md`。

## 实现与验证

`src/story-reader.js` 按实体和已知地点名称做字面匹配，较长名称优先，分别转义原文与标记属性。列表内只放无交互的名称 span，不嵌套按钮；正文名称接已有说明路由。检索文本与世界数据不变。`web/style.css` 加宽首页和正文，减少页头及行间距，并保留手机字号和触摸行为；`settings.html` 缩短页签名称。构建、样式版本及样式指纹同步更新。

新名称判据先确认旧实现失败，生产 Chrome 的宽度利用率及首行高度断言亦先在旧版失败。真实浏览器使用仓库账本夹具和生产模板、组合器、CSS 与绑定，覆盖桌面、窄屏及手机，检查下划线、正文名称说明、导航、搜索输入法、同世界与空窗口刷新、返回位置、焦点与 Escape。单滚动区域与无横向溢出通过。独立代码复核指出手机祖先元素不能匹配后代容器查询，浏览器确认原规则不生效后移入手机媒体查询并复验。

浏览器脚本、截图及 JSON 在 `F:/deepseek/tmp/leg175-reader-density/`。这是仓库夹具验证，用户实际聊天观感仍需刷新查看。

## 本机预览

安装目标：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`。
已安装源码提交 `c84fd2b`，本机预览提交 `7643453`。全部跟踪文件与源码逐字节一致，两处 git 工作区干净；安装目录的相关阅读测试、冒烟及生产 Chrome 验证通过。源码全量判据和文档守门通过，唯一文档黄项仍为已有冻结台账的超长行。安装核对记录：`F:/deepseek/tmp/leg175-reader-density/install-verification.json`；安装目录浏览器记录：同目录的 `installed-production/verification.json`。没有推送远端。

刷新酒馆使用 **Ctrl+Shift+R**，在「参数」页顶部或「角色与势力」页表头核对构建号（见本次源码 `STATE.md` §1），再打开「观棋」。现有授权任务已完成，用户实际聊天的视觉验收待刷新确认。其他活儿仅引用本次源码 `STATE.md` §3，不从历史交接推断开工授权。

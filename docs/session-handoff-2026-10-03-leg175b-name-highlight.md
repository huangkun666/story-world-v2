# 观棋名称只保留高亮

用户原话：「下划线不要了吧只保留高亮即可」。人物与势力保留蓝色高亮，地点保留琥珀色高亮；移除下划线及鼠标经过时的下划线加粗。正文名称继续打开已有说明，版面与阅读交互沿用上次实现。

仅调整 `web/style.css` 并同步构建、样式版本、样式指纹和当前设计记录。源码全量测试与文档守门通过；生产 Chrome 核对桌面、窄屏、手机，首页与正文的名称均无下划线，说明入口与刷新恢复通过。当前权威读数见源码工作树 `STATE.md` §1。

源码：`C:/Users/30319/.codex/worktrees/d630/plugins/story-world-v2`，分支 `codex/story-reader-density`，提交 `669c912`。本机酒馆预览提交 `e597109`，全部跟踪文件逐字节一致，源码和安装目录均干净。未推送远端。脚本、截图与安装核对记录在 `F:/deepseek/tmp/leg175b-name-highlight/`。

按 **Ctrl+Shift+R** 刷新酒馆查看。新交接继续只放 `F:/deepseek/plugins/story-world-v2/docs/`；其他工作仅引用源码 `STATE.md` §3，不从历史交接推断开工授权。

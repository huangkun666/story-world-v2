# 项目已迁到 F 盘；事件打磨设计交接

日期：2026-10-07（Asia/Shanghai）。接手先读 `STATE.md`；当前工作见 `docs/work-current.md` §1。

## 项目的家

唯一日常项目根：`F:/deepseek/plugins/story-world-v2`。Git 根：`F:/deepseek/plugins`，公共 Git 数据同在 F；日常分支 `codex/f-drive-home`，起点为交接记录对应的最新开发提交 `8bc13a2`。

本机 dsh 完成最新版本恢复、F 独有文档保留、原 F 主目录和未提交内容备份、16 棵 C 工作树复制与 SHA-256 核对、Git worktree 修复及位置规则更新。Codex 完成独立核验、C 实体文件清理和受限环境之外的验证。

历史树保留在 `F:/deepseek/worktrees/<原ID>/plugins`，各自原 HEAD、分支、未提交状态和文件内容不变。它们用于追溯，不继续开发。新任务从日常 F 项目当前版本创建 F 盘工作树。

## C 盘旧路径

16 个旧项目路径现在都指向当前 F 项目。12 个仓库根是目录联接；4 个被程序占用的父目录留作空壳，仅含项目目录联接。没有实体项目源码或文档留在这些 C 目录；不需要重启后再跑旧 docs 迁移脚本。

清理没有终止用户程序，也没有改 ACL。dsh 先遇到其执行环境对 C 路径的写入限制；Codex 清理又实测到空目录被程序占用。对已核验、已清空的目录直接建立 NTFS 联接，完成兼容。执行命令、写文档和后续开发一律使用 F 盘绝对路径。

## 备份与核验

迁移材料：`F:/deepseek/tmp/f-drive-migration-2026-10-07/`。

- `backup/F-main-plugins-full/`：迁移前 F 主工作树的完整文件备份，包含独有文档。
- `backup/F-main-modified-tracked/`、`backup/F-main-untracked/`、`backup/F-main-uncommitted-tracked.patch`：原修改与未跟踪文件另存。
- `backup/all-refs-and-worktree-heads.bundle`：Git 历史和工作树提交备份。
- `independent-before.json`：Codex 独立记录的迁移前文件哈希与 Git 状态。
- `independent-verification.json`：迁移后独立核验。产品文件相对最新 332e 一致；16 棵历史树内容与原状态一致；无 C worktree 注册；旧 C 实体文件为零。
- `legacy-link-verification.json`：16 个旧项目路径均解析到当前 F 项目。
- `inventory/`、`logs/`：dsh 每棵复制和核对的原始证据。

全量测试与冒烟读数见 `STATE.md` §1。此次重新在 F 日常项目运行，日志为 `logs/commander-tests.log` 和 `logs/commander-smoke.log`；文档守门日志为 `logs/commander-audit-docs.log` 与 `logs/commander-audit-check.log`。没有产品代码改动，没有发布或推远端，也没有改宿主安装与真账。

## 后续模型规则

规则已写入日常项目 `AGENTS.md` 和工作树父目录 `F:/deepseek/worktrees/AGENTS.md`：禁止 Astra 子 agent；简单任务只用 `gpt-6-luna`，复杂任务只用 `gpt-6.1-sol`；本机 dsh 仍可按用户授权使用。

## 当前新任务

用户要求给出现有项目打磨、聊天与世界事件颗粒度对齐、停止聊天事件回流的设计，并担心聊天无效信息吸引世界模型注意力。

设计稿：`F:/deepseek/plugins/story-world-v2/docs/superpowers/specs/2026-10-07-event-granularity-and-chat-context-design.md`。真账副本、统计与现有注入器重放证据：`F:/deepseek/tmp/event-polish-design-2026-10-07/`。

推荐先停止事件回流，再把普通动作与有后续影响的结果分开，并对完整世界输入去重。保留重要聊天事实与当前状态；不能删除所有聊天改定的字段，也不能把依赖聊天事实产生的世界新后果一起过滤掉。

这份稿已完成自查，尚未批准或实施功能改动。下一步依据用户审阅意见调整设计。

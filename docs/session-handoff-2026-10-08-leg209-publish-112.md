# 发布 1.1.2：把 leg202–leg209 八棒一次推上发布仓 main（leg209 发布笔）

> ★**本笔之后接手的人先看这里**：发布仓 main 已从 `a075423`（leg201b 记账笔）走到 **`2a71ba5`**，
> 版本号 **1.1.1 → 1.1.2**，构建号 **`leg209-character-protection-cleanup`**。
> ★★**tag / release 一个都没动**（用户当次只点了"推 main ＋ 升号"）⇒ `v1.1.0` 仍指 `e28be61`，
> **点 release 下载的仍是那一棵**。这不是漏做，是当次问定的范围。
> ★接手第一入口仍是 `STATE.md` §0.5，当前值只在它 §1，本机现场在 §5。
> ★上一笔（leg209 实施：撤掉未经批准的额外核验调用 ＋ 收拢角色保护开关）的交接在
> `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-08-leg209-character-protection-cleanup.md`。

用户 2026-10-08 一道令（逐字）：

> 「**帮我推送并更新版本号**」（附 `docs/session-handoff-2026-10-08-leg209-character-protection-cleanup.md`）

★本仓规矩：**推 main / 打 tag / 发 release 是三件事，各要一次明令** ⇒ 当次问定两件：
**版本号升到 `1.1.2`** · **只推发布仓 main**（不打 tag、不发 release）。

## 一、接手位置与两个提交

- 唯一实施源码：`F:/deepseek/plugins/story-world-v2`（仓库根 `F:/deepseek/plugins`，公共 Git 目录
  `F:/deepseek/plugins/.git`），分支 **`codex/f-drive-home`**，插件子树在仓库根之下 ⇒ git 命令的路径要带 `story-world-v2/` 前缀。
- **接手时工作区里积压着 leg204–leg209 六棒没提交的改动**（102 项：源码、判据、文档、`.github/`、`assets/`），
  发布脚本第①步要"子树干净"才肯走 ⇒ 先提交。**两个提交**：

| # | 提交 | 是什么 |
|---|---|---|
| ① | **`8530f84`** | leg204–leg209 六棒一次提交（含 `.github/workflows/ci.yml`、`assets/` 三张图位、leg202–leg209 的交接与细案） |
| ② | **`a40f7dd`** | **发布笔**：版本号 1.1.1 → **1.1.2**（三处锁 ＋ README ＋ `STATE.md` §1）＋ **`web/runtime-diagnostics.js` 那一行修复**（见 §3） |

- **发布仓**（`huangkun666/story-world-v2`，只有 `main` 一支）：
  `a075423`（leg201b）→ **`2a71ba5`**（父 `a075423` · 根树 `3895efc3341d9adfee27f72e97beec753596c3c0`）。
  ★**leg202–leg209 八棒一次上线**——`a075423` 那一版还停在 leg201b（宿主保存与卡片形状），
  事件范围、快照、参数页、角色保护、诊断这一整批**都在这一笔里第一次出门**。
- ★口径照旧：`STATE.md` §1「发布仓 main」与 `scripts/audit-docs.mjs` 的 `PUBLISHED_COMMIT_REF`
  记的都是**代码提交**（`2a71ba5`），而远端 tip 是压在它上面的**记账笔**——**必然落后一笔，这是设计使然，
  别为了对齐再推第三次**。
- **本机那份克隆**（`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，
  推之前停在 leg209 的本地预览 `212cbdf`）⇒ 已按 `docs/dev-process.md` §10.0 收尾
  `git fetch` ＋ `git reset --hard origin/main` 到 **`2a71ba5`**；工作区干净、`manifest.json` 现读 **1.1.2**，
  根树 `3895efc…` 与源码子树**逐字节同一棵**。

## 二、版本号升在哪（三处锁 ＋ 两处文档 ＋ 生成物）

`manifest.json` 的 `version` · `web/index.js` 的 `VERSION` · **`test/browser-compat.test.js:93` 那处锁**
（★**漏了第三处当场红**——本次真的红了，见 §3）· `README.md`「这是 **1.1.2** 正式版」·
`STATE.md` §1「版本号」那格 · `docs/index.json` 与知识索引三件（生成物）。

★**为什么这一版该升号**：leg202–leg209 改的全是**玩家看得见的事**（事件范围与条件生命周期 ·
快照选择与实时诊断 · 参数页运行/注入重排 · 角色保护开关并入资料行）——正是 leg156 登记的那个坑：
**新旧号相同 ⇒ 用户看不出自己更新没更新**。

★**没动的号**（都照规矩"真变了才升"）：`PANEL_BUILD` 仍 `leg209-character-protection-cleanup`、
`CSS_VERSION` 仍 `20261008-leg209-character-protection-cleanup`、`MAIN_PROMPT_V` 仍 `v2-agenda-t1-37`、
`CACHE_VERSION` 仍 `11`、`DB_VERSION` 仍 `3`——这一笔只动版本号、台账、生成物与**一行诊断前缀**。

## 三、★★路上被发布闸咬出来的那个真 bug（本笔最值钱的一条）

**`--dry-run` 第③步当场红：导出件里判据 `2235 / 2236`**（本机开发树是 2236/2236，全绿）。
红的是 `test/runtime-diagnostics.test.js:59`：期望 2 行诊断、实得 1 行。

- **根因**：`web/runtime-diagnostics.js` 那行 `LOG_PREFIX` 是**从所在目录名现算**的
  （`new URL('../', import.meta.url).pathname.split('/').at(-1)`）。
  而发布流程把子树导出到 **`%TEMP%\sw2-release\out`** ⇒ 算出来是 **`[out]`** ⇒
  **本插件自己那 100 处日志一条都认不出**（它们写的是字面量 `[story-world-v2]`，如 `src/worldstep.js:26`）。
- **为什么本机看不出来**：开发目录与酒馆安装位都叫 `story-world-v2`（ST 本来也硬要求这个目录名）
  ⇒ 两边都算成 `[story-world-v2]`，**判据在本机恒绿**。**只有仓外导出件那个目录名才照得出来。**
- **治法**（当次问定甲案，用户点头）：**认产品那一份字面量**——`const LOG_PREFIX = '[story-world-v2]'`。
  真机（目录名 `story-world-v2`）**行为逐字节不变**；改名的目录也不再静默失效。
  ★这一修同时治掉本仓最恨的那类病：**同一个事实两处写法**（日志写字面量、采集器算目录名）。
- ★★**这一条是"闸真的会咬"的现场证词**：`publish-release.mjs` 在**仓外**跑判据与冒烟，
  正是为了"社区装到的那份就是我测过的那份"——它这次咬出的**不是格式问题，是一处只有换个目录才现形的真缺陷**。
  **没有这一修，这一版根本推不出去。**

## 四、验收和证据（全是亲手跑的）

- `node scripts/publish-release.mjs --dry-run` 先跑一遍（同一棵 `3895efc`）：判据 **2236 / 2236 · fail 0** ·
  冒烟 **PASS · 终态 SSOT 8351 字节** · 文档守门 **PASS · 黄 1**，**没有推**。
- `node scripts/publish-release.mjs` 真推：同四项读数一致，造提交 `2a71ba5`（父 `a075423`），
  **第 1 次推送成功**，远端核验 **8 项 8 ✔ · 0 ✘**（含 6 处逐字节 blob 哈希）。
- `node scripts/verify-release.mjs` 只读终检 **20 项 20 ✔ · 0 ✘**（退出码 0）——版本三处一致（1.1.2）·
  构建号一致 · README 读数逐字 · 新基建在位 · 无 `snapshots/` 无 `package.json` · **8 个文件逐字节同 blob** ·
  tag/release 现状只报不改。
  ★如实登记一处**网络抖动**：第一次跑终检时 `fetch` 被本机代理掐断
  （`UND_ERR_SOCKET · remotePort 7897`，`bytesRead 354601`），**重跑一遍即 20/20**——那是代理，不是远端。
- 逐字节等式：远端根树 = 本地子树树对象 = 酒馆那份克隆的 `HEAD^{tree}`
  = **`3895efc3341d9adfee27f72e97beec753596c3c0`**。
- ★**tag/release 现状**（脚本只报不改）：`v1.1.0→e28be61` · `v1.0.1→ec5416d` · `v1.0.0→778af70` ·
  `v1.0.0-preview.2→2a86cfa` · `v1.0.0-preview.1→1a54424` —— **五个 tag、五个 release 一个都没动**。
- 机读记录与日志：`F:/deepseek/tmp/leg209-publish-112/`
  （`publish-release.log` 真推那一遍的 stdout 原文 · `verify-release.log` 只读终检 · `record.json` 全部哈希与读数）。

## 五、边界（如实登记，不掩盖）

1. ★★**版本号是 1.1.2、而最近那个 release 还是 1.1.0 那棵**——用户当次的选择，**不是漏做**。
   ⇒ 从 **release 页下载**的人拿到的仍是 `e28be61` 那一版（**没有 leg161 之后的任何一笔**）；
   **填仓库地址装 / 走更新按钮**的人拿到的是 `2a71ba5`（有）。`audit-docs.mjs` 那一格已写明"别顺手对齐"。
2. ★**这一笔的产品改动只有一行**（`web/runtime-diagnostics.js` 的前缀），且**真机行为逐字节不变**；
   其余全是版本号、台账、生成物、`.github/` 与 `assets/`。四个内部号一个没动（见 §2）。
3. ★**发布前那六棒是"本机验过、用户预览过"的**：酒馆安装位此前停在 leg209 的本地预览 `212cbdf`
   （由 `integrate-install.mjs` 增量装、`installed-*.log` 与 `http-verification.json` 留档）；
   这一版是从远端拉回来的同一棵树 ⇒ **用户刷新后看到的就是他验过的那一份**（外加版本号与那一行修复）。
4. ★**真实模型的语义质量仍未验**：角色保护靠的是原生成提示词 ＋ 程序权限，程序并不理解并硬判所有叙述
   （上一棒已如实登记）。本次**零模型调用**、没改真实聊天/世界账/世界书。
5. **活儿单（`STATE.md` §3）没有新增、也没划掉**：这一笔是发布，不是功能。
6. ★`.github/workflows/ci.yml` 与 `assets/` 三张图位**这一笔第一次进发布树**（README 的 CI 徽章与三张图
   从此有实物）；`assets/` 里那三张是**占位图**，真机截图按同名覆盖即可（口径见 `assets/README.md`）。

## 六、留给下一棒的现场知识（会再撞的两条）

1. ★★**发布脚本会在"仓外导出件"里跑判据**（`%TEMP%\sw2-release\out`）⇒ **任何"按自己目录名/路径推断事实"
   的代码都会在那里现形**。本次咬出的是控制台前缀；下一处同类嫌疑是**任何用 `import.meta.url` 反推目录名的判断**。
   ★**别再写"从目录名现算"的东西**——产品里的字面量才是那一份真源。
2. ★**`verify-release.mjs` 会因本机代理抖动中途崩**（`UND_ERR_SOCKET`，它要把整份文件从 API 读回来做逐字节比对）
   ⇒ **直接重跑**，别去改脚本、也别读成"远端坏了"。
3. ★`publish-release.mjs` 在导出目录里跑文档守门时，守门脚本会往 **stderr** 打一句
   `fatal: not a git repository (or any of the parent directories): .git`——**那是设计内的**，
   但 PowerShell 会把整条命令的退出码报成 1。**判成不成只看脚本自己打的那几行**（`发布完成：… 核验 N 项`）。

## 七、文档收尾

源码改动：`manifest.json`（version）· `web/index.js`（`VERSION`）· `test/browser-compat.test.js`（那处锁）·
`web/runtime-diagnostics.js`（前缀那一行 ＋ 留档注释）· `README.md`（版本号那行）· `STATE.md`
（§0.5 当前交接 · §1 版本号与发布仓 main 两行 · §5 安装位现读）· `docs/work-current.md` §1（用户这道令逐字）·
`scripts/audit-docs.mjs`（`PUBLISHED_BUILD`／`PUBLISHED_COMMIT_REF`／`PUBLISHED_COMMIT_DATE` 跟到新发布点，
`PUBLISHED_TAG`／`PUBLISHED_TAG_COMMIT` **照旧**）· `docs/index.json` 与知识索引三件（生成物）。

★leg209 那份交接的开头已加一条**指向本笔**的横幅（免得下一棒照它读成"还没推"）。

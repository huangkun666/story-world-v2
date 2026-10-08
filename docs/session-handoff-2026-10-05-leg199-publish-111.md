# 发布 1.1.1：把 leg198 ＋ leg199 两笔推上发布仓 main（leg199 发布笔）

> ★**本笔之后接手的人先看这里**：发布仓 main 已从 `d5d70e2`（leg197 记账笔）走到 **`4b0d5e9`**，
> 版本号 **1.1.0 → 1.1.1**，构建号 **`leg199-blockonly`**。
> ★★**tag / release 一个都没动**（用户当次只点了"推 main ＋ 升号"）⇒ `v1.1.0` 仍指 `e28be61`，
> **点 release 下载的仍是那一棵**。这不是漏做，是当次问定的范围。
> ★上一笔（leg199 实施：删掉"块外裸标签"那条降级 ＋ 标签规范第 7 条改值口径）的交接在
> `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-05-leg199-blockonly.md`。
> ★接手第一入口仍是 `STATE.md`（当前值只在它 §1）。

用户 2026-10-05 一道令（逐字）：

> 「**帮我推送更新吧，版本号变成1.1.1**」

★本仓规矩：**推 main / 打 tag / 发 release 是三件事，各要一次明令** ⇒ 当次问定，用户选
**"只推 main ＋ 升号 1.1.1"**（不打 tag、不发 release）。

## 一、接手位置与四个提交

- 唯一实施源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`，分支 **`codex/entities-refresh`**；
  插件子树在仓库根 `.../332e/plugins` 之下，git 命令里的路径要带 `story-world-v2/` 前缀。
- **四个提交**（都在 leg198 的 `08d955f` 之后，**工作区已干净**）：

| # | 提交 | 是什么 |
|---|---|---|
| ① | **`a0b1ad2`** | **leg199 实施那一笔**（19 个文件：源码 4 ＋ 判据 9 ＋ 台账/生成物 6）——★上一棒留在工作区没提交，本笔先把它提交掉 |
| ② | **`4fd37b7`** | **发布笔**：版本号 1.1.0 → **1.1.1**（9 个文件） |
| ③ | **`772aea5`** | **修发布脚本两处**（凭据按主机挑行，见 §3）＋ 生成物 |
| ④ | **`7b60983`** | **记账笔**：发布点读数 ＋ `audit-docs.mjs` 常数 ＋ 生成物（★纯记账，产品行为零变化） |

- **发布仓**（`huangkun666/story-world-v2`，只有 `main` 一支）：
  `d5d70e2`（leg197 记账笔）→ **`79a91ce`**（正式那一笔，`publish-release.mjs` 核验 **8/8 ✔**）
  → **`4b0d5e9`**（记账那一笔，同样 **8/8 ✔**，**就是现在远端 main 的尖端**）。
- ★口径照旧：`STATE.md` §1「发布仓 main」与 `scripts/audit-docs.mjs` 的 `PUBLISHED_COMMIT_REF`
  记的都是**代码提交**（`79a91ce`），而远端 tip 是压在它上面的记账笔（`4b0d5e9`）——
  **必然落后一笔，这是设计使然，别为了对齐再推第三次。**
- **本机那份克隆**（`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，
  装之前停在 `d5d70e2`）⇒ 已 `fetch` ＋ `reset --hard origin/main` 到 **`4b0d5e9`**；
  它的根树 `a311685…` 与源码子树**逐字节同一棵**，工作区干净，`manifest.json` 现读 **1.1.1**。

## 二、版本号升在哪（五处 ＋ 生成物）

`manifest.json` 的 `version` · `web/index.js` 的 `VERSION`（**两处同批**，`test/browser-compat.test.js` 锁着第二处）
· README「这是 **1.1.1** 正式版」· `STATE.md` §1「版本号」那格 · `docs/index.json` 与知识索引三件（生成物）。

★**为什么这一版该升号**：leg199 改的是**玩家看得见的一件事**——"这一轮没有标签"的后果变了
（以前块外的裸标签照样读得出来，现在整轮零收获）。这正是 leg156 登记的那个坑：**新旧号相同 ⇒
用户看不出自己更新没更新**。

## 三、★★路上撞到的那个真 bug（本笔最值钱的一条）

**发布第一步就死在"取不到远端状态（网络？token？）"** —— 而**根因与网络无关**：

- `~/.git-credentials` 是**多主机共用**的文件。本机实测 **3 行**：`gitee` 一行 ＋ `github` 两行，
  而 2026-10-05 14:46 那行 **gitee 排到了第一行**。
- `publish-release.mjs` / `verify-release.mjs` 原写法是 `.split(/\r?\n/)[0]`——**取第一行** ⇒
  拿到的是 **11 位的 gitee 密钥** ⇒ 三个 API 全 `401 Bad credentials`。
- ★★**报错指向一个不是病灶的地方**：它只说"网络？token？"，而 token 本身**是好的**
  （github 那一行 40 位、`/user` 回 `200 · login huangkun666`）——**下一棒会照着"网络"去修**。
  这正是本仓最贵的那类病（leg100 那条"`origin` 不是所有远端"是同一个形状）。

**治法**（用户当次点头"修仓内两个脚本"）：**按主机挑行**——只认 `@github\.com`，
优先 `x-access-token` 那一行；挑不出时把"共几行 · github 几行"原样报出来，并写明★别退回"取第一行"。
两个脚本同批改（`publish-release.mjs` 的留档最全，`verify-release.mjs` 指向它）。

**取证**（装置在仓外 `F:/deepseek/tmp/leg199-publish/`）：`diag-api.mjs` 改前 `401 Bad credentials`；
`diag-api2.mjs`（改用 github 那一行）**`200` · main `d5d70e2` · 根树 `a4b0e5e`**。

★**这一笔改动本身进了发布仓**（用户知情）：它是"能推出去"的前提，不是顺手改。

## 四、验收和证据（全是亲手跑的）

- `publish-release.mjs` **跑了两遍**（正式笔、记账笔），每一遍都在**仓外导出的那棵树里**重跑了
  判据 ＋ 冒烟 ＋ 文档守门（"社区装到的那份就是我测过的那份"）：两遍都是
  **判据 2050 / 2050 · fail 0 · skipped 0 · todo 0** · **冒烟 PASS · 终态 SSOT 8351 字节** · **文档守门 PASS · 黄 1**；
  远端核验**各 8/8 ✔**（含 6 处逐字节 blob 哈希）。
- `verify-release.mjs` 只读终检 **20/20 ✔**（退出码 0）——**推正式笔之后跑一遍（`79a91ce`）、推记账笔之后再跑一遍（`4b0d5e9`）**。
- 逐字节等式：远端 8 个关键文件 = 本地 `HEAD:story-world-v2/<file>` 的 blob；
  安装位克隆 `HEAD^{tree}` = 源码子树树对象 = `a311685616c02d8a53d830dec16662105772d60a`。
- ★**tag/release 现状**（脚本只报不改）：`v1.1.0→e28be61` · `v1.0.1→ec5416d` · `v1.0.0→778af70` ·
  `v1.0.0-preview.2→2a86cfa` · `v1.0.0-preview.1→1a54424` —— **五个 tag 一个都没动**，release 页五个也原样。

## 五、边界（如实登记，不掩盖）

1. ★★**版本号是 1.1.1、而最近那个 release 还是 1.1.0 那棵**——用户当次的选择，**不是漏做**。
   ⇒ 从 **release 页下载**的人拿到的仍是 `e28be61` 那一版（**没有 leg198／leg199**）；
   **填仓库地址装 / 走更新按钮**的人拿到的是 `4b0d5e9`（有）。`audit-docs.mjs` 那一格已写明"别顺手对齐"。
2. ★**这一笔没有改任何产品行为**：四个提交加起来只动了版本号、台账、生成物、以及发布脚本自己。
   `PANEL_BUILD`（`leg199-blockonly` 是上一棒升的）／`CSS_VERSION`／`MAIN_PROMPT_V`／`CACHE_VERSION`／`DB_VERSION`
   在这一笔里**一个都没动**。
3. ★**上一棒 §3.5 那个"更大的病"仍未治、仍等用户拍**：`CHANGE_FIELDS` 那张七名白名单
   （`所属/身份/定位/实力/性质/倾向/规模`）把**书自己起名的格**（`境界`/`军威`/`声望`/`伤势`/`实权`…）挡在门外
   ⇒ `【变化】黄坤｜境界｜金丹期` **落格 0**（静默丢）。治法方向与代价写在上一棒交接 §3.5，**别自己开工**。
4. ★**上一棒 §6 第 1 条仍是下一棒的第一件事**：量"真模型写正文时包不包块"——它决定 leg199 在用户手上
   是"更干净"还是"整轮白跑"。装置现成：`demo/measure-leg121-divergence-live.js`（import 的正是生产那份
   `tagSpecText()`）。**没有量过的数，不许编。**
5. **活儿单（`STATE.md` §3）没有新增、也没划掉**：这一笔是发布，不是功能。
6. 本笔零模型调用、没有改世界书、没有改用户聊天、没有重写工作区（导出全在 `%TEMP%\sw2-release\`）。

## 六、留给下一棒的现场知识（会再撞的两条 ＋ 一条显示坑）

1. ★★**`~/.git-credentials` 的第一行随时可能是别的主机**（本笔已把两个脚本改成按主机挑行）。
   若哪天又见"取不到远端状态（网络？token？）"：**先跑 `F:/deepseek/tmp/leg199-publish/diag-api.mjs`**
   看是 `401`（凭据）还是连不上（网络）——**别再对着"网络"修**。
2. **`git` 直连 github 是断的 ⇒ push 必须给代理**：`$env:HTTPS_PROXY='http://127.0.0.1:7897'`
   （本机环境变量里已有；与 `docs/dev-process.md` §10.1 第 1 条一致）。★**同一个脚本里的 GitHub API 调用不需要代理**
   （带 token 直连就通；**不带 token 的匿名请求会被限流成 `403`** —— 那是限流，不是墙）。
3. ★**一个会让人误判的显示坑**：`publish-release.mjs` 在导出目录里跑文档守门时，守门脚本会往 **stderr**
   打一句 `fatal: not a git repository (or any of the parent directories): .git` —— **那是设计内的**
   （导出件本来就不在任何 git 仓库里），**不是故障**；但 PowerShell 把原生命令的 stderr 当错误记录
   ⇒ 整条命令的退出码会被报成 1。**判成不成要看脚本自己打的那几行**（`发布完成：… 核验 N 项`）。
4. **`F:/deepseek/plugins/story-world-v2/docs/` 仍是文档的家**（用户 2026-10-02 指定；C 盘那个 `docs`
   换成目录联接那一步仍没做成，见 `STATE.md` §5）。**本交接只写在 F 盘**，没进 C 盘工作树，
   也没进发布树——这是既有形态。

## 七、文档收尾

源码改动：`manifest.json`（version）· `web/index.js`（`VERSION`）· `test/browser-compat.test.js`（那处锁）·
`README.md`（版本号那行）· `STATE.md`（§1 三行 ＋ §4）· `scripts/publish-release.mjs` 与 `scripts/verify-release.mjs`
（凭据按主机挑行）· `scripts/audit-docs.mjs`（`PUBLISHED_BUILD`／`PUBLISHED_COMMIT_REF` 跟到新发布点，
`PUBLISHED_TAG`／`PUBLISHED_TAG_COMMIT` **照旧**）· `docs/index.json` 与知识索引三件（生成物，指纹 `eb75ca47-d7b6c977`）。

★leg199 那份交接的开头已加一条**指向本笔**的横幅（免得下一棒照它读成"还没提交、还没推"）。
★机读记录与装置：`F:/deepseek/tmp/leg199-publish/`（`diag-api.mjs` · `diag-api2.mjs` · 四份提交信息）。

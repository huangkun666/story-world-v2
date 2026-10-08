# 发布 1.1.0：把 leg161–leg194 那 51 笔一次发出去（leg195）

> ★**本笔之后接手的人先看这里**：发布仓 main 已从 `88bd80e`（leg160）走到 **`5d68a6b`**，
> 版本号 **1.0.1 → 1.1.0**，新 tag **`v1.1.0` → `e28be61`**，新 release 已发。
> ★上一笔（leg194：参数页那两句原始读数撤掉）的交接在
> `F:/deepseek/plugins/story-world-v2/docs/session-handoff-2026-10-05-leg194-original-line-gone.md`。

用户 2026-10-05 看完 leg194 那一版之后下了这一道令（逐字）：

> 「**我要发布了，这次是一次很大的更新**」

本笔全部办结：版本号、两笔提交、两次推送、tag、release、安装位、交接。当前权威读数统一见
[源码 STATE.md §1](C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2/STATE.md:40)。

## 接手位置

- 唯一实施源码：`C:/Users/30319/.codex/worktrees/332e/plugins/story-world-v2`，分支 `codex/entities-refresh`；
  插件子树在仓库根 `.../332e/plugins` 之下，git 命令里的路径要带 `story-world-v2/` 前缀。
- 本笔**两笔提交**（都在同一分支上，都在 `0b2d4ef` ＝ leg194 之后）：
  - `0c4102a` 发布笔（9 个文件）：版本号两处 ＋ 判据锁 ＋ README ＋ `STATE.md` §1 ＋ 生成物；
  - `1d32ad3` 记账笔（8 个文件）：发布点读数 ＋ README 两处勘正 ＋ `done-archive` 收 leg194。
- 发布仓：`88bd80e`（leg160）→ **`e28be61`**（正式那一笔，`publish-release.mjs` 核验 **8/8**）→
  **`5d68a6b`**（记账那一笔，同样 **8/8**，就是现在远端 main 的尖端）。
- tag / release：**`v1.1.0` → `e28be61`**（`prerelease:false`，与 `v1.0.1` 同为正式版）；
  旧四个 tag（`v1.0.1`/`v1.0.0`/两个预览版）**原样不动**。
  release：https://github.com/huangkun666/story-world-v2/releases/tag/v1.1.0
- 本机安装：`F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/extensions/story-world-v2`，
  分支 `main`（装之前停在 `d1cb16c` ＝ leg194 那一版）⇒ 已 `fetch` ＋ `reset --hard origin/main` 到 **`5d68a6b`**；
  它的根树 `cfa0764…` 与源码子树**逐字节同一棵**，670 个跟踪文件，工作区干净。
- 机读记录与全部装置：`F:/deepseek/tmp/leg195-publish/final-verification.json`（＋同目录四份配套件）。

## 那句话说清了什么（用户拍板四件）

| # | 拍板 | 落地 |
|---|---|---|
| ① | **推 main** | 推的是**发布仓**（`publish-release.mjs`）；本地 `main` 照旧不直接推（§3 那条老纪律） |
| ② | **升版本号** | `1.0.1` → **`1.1.0`**（问过三个候选，用户选 1.1.0）——**这一次不是修补**，是功能大版本 |
| ③ | **打新 tag ＋ 发 GitHub Release** | 此前 leg160/leg158 都只推 main、**不动 tag**，所以点 release 下载的人一直拿到 `v1.0.1` 那棵老树；本笔把这笔账清了 |
| ④ | **顺手改对 README 那两处过时话** | README 一直写"看「设置」页里的 `构建 …`"，而构建号早已搬到「**参数**」页最上面（leg159c 实机核过、`STATE.md` §5 早已勘正）⇒ 两处一起改对 |

## 改了什么（逐处）

### 一、版本号（`manifest.json` ＋ `web/index.js` ＋ 判据锁 ＋ README）

- `manifest.json` 的 `version` 与 `web/index.js` 的 `VERSION`：`1.0.1` → **`1.1.0`**（**两处一起改**，
  `test/browser-compat.test.js` 锁着第二处）。
- README 那行「这是 1.0.1 正式版」→「这是 **1.1.0** 正式版」。
- `STATE.md` §1「版本号」那一格跟着改，并写清升号的理由（就是 leg156/leg158/leg159 各棒登记过的那条老账：
  新旧号相同 ⇒ 玩家**看不出自己更新没更新**）。

### 二、发布点记账（读数只许有一个家）

- `STATE.md` §1：**「发布仓 main」**（`5d68a6b` ／ 构建号 `leg194-original-line-gone` ／ 版本号 `1.1.0`）
  与**「release tag」**（`v1.1.0` → `e28be61`）两行；§4 换成这一笔。
- `scripts/audit-docs.mjs`：四个 `PUBLISHED_*` 常数（`BUILD` / `COMMIT_REF` / `TAG` / `TAG_COMMIT` / `DATE`）
  跟到新发布点，并把"这一笔**同时发了 release**"这件事写进那一格的上文注释。
- `docs/index.json` 与知识索引三件（`kb.json` · `kb-index.md` · `kb-search.html`）随文档重生。
- `docs/done-archive.md` 开头收进 **leg194** 一条（§4 只留"当前那一笔"；★这一次**不是**入口顶格
  ——`STATE.md` 是 19693 / 20480 字节、还有余量——是那条规矩本身）。

### 三、README 两处勘正（第 87 行与第 200 行）

- 旧：「装完记得看「**设置**」页里的 `构建 <版本号>` 那行」／「以「**设置**」页里的 `构建 …` 那行为准」。
- 新：都改成「**参数**」页**最上面那行**，并明写「★**不在「设置」页**」。
- 依据：`STATE.md` §5「面板构建号在哪看」＋ leg159c 交接那次实机核对。**用户 2026-10-05 当场点头才改。**

### 四、★为什么推了**两次**（这是本仓的记账法，不是失误）

1. 先把**正式那一笔**推上去（`e28be61`）——它带的是新版本号，但 `STATE.md` 里"发布仓 main 是哪一笔"
   还写着上一版（那一笔推送之前，谁也不知道 `e28be61` 这个号）。
2. 再写一笔记账提交把发布点填对（`1d32ad3`），**再推一次**（`5d68a6b`）。
⇒ 于是 `PUBLISHED_COMMIT_REF` 那格**必然落后远端 tip 一笔**——`scripts/audit-docs.mjs` 里那条注释
（leg106 写的"别试图追上 tip，永远追不上"）说的就是这件事。**别为了对齐再推第三次。**

## 验收和证据

- `publish-release.mjs` **跑了两遍**（正式笔、记账笔），每一遍都在**仓外导出的那棵树里**重跑了
  判据 ＋ 冒烟 ＋ 文档守门（"社区装到的那份就是我测过的那份"）：两遍都是
  **判据 2038 / 2038 · fail 0** · **冒烟 PASS · 终态 SSOT 8351 字节逐字节未变** · **文档守门 PASS · 黄 2**；
  远端核验**各 8/8 ✔**（含 6 处逐字节 blob 哈希）。
- `verify-release.mjs` 只读终检 **20/20 ✔**（退出码 0）——**打 tag 前后各跑一遍，都是 20/20**。
- tag/release 装置 `F:/deepseek/tmp/leg195-publish/tag-release-v110.mjs` 退出码 0：
  新 tag 指向正确 ✔ · 旧四个 tag 都在 ✔ · 正式（非预览、非草稿）✔。
- 安装位核对：克隆 `HEAD^{tree}` = 源码子树树对象 = `cfa07642458585125e0c5ba97c8d6292cf4acee1`。
- ★**文档守门这一次是"黄 2"**（往常多为黄 1）：多的那一条是
  「`STATE.md` 余量还够（≥5%）· 现 19693 / 20480 字节（余 787）」——**是黄、不拦发布**，
  下一棒若还要往 `STATE.md` 加东西，照那条提示把 §4 里更早的一条搬进 `docs/done-archive.md`。

## 路上确认与踩到的（留给下一棒）

1. **`git` 直连 github 是断的 ⇒ push 必须给代理**：`$env:HTTPS_PROXY='http://127.0.0.1:7897'`
   （与 `docs/dev-process.md` §10.1 第 1 条一致；这一次给了，**两遍都是一次成功**）。
   ★但**同一个脚本里的 GitHub API 调用不需要代理**：带 token 直连就通
   （不带 token 的匿名请求会被限流成 `403 rate limit exceeded` —— 那是限流，不是墙）。
2. **§10.1 第 2 条这一次没撞**：父提交 `88bd80e` **已经在本地对象库里**，不必再从酒馆那份克隆 `fetch`。
3. ★★**一个会让人误判的显示坑**：`publish-release.mjs` 在导出目录里跑文档守门时，守门脚本会往
   **stderr** 打一句 `fatal: not a git repository (or any of the parent directories): .git`
   ——那是**设计内**的（导出件本来就不在任何 git 仓库里，守门会如实报"在 git 仓库里 = false"），
   **不是故障**。但 PowerShell 把原生命令的 stderr 当错误记录 ⇒ 整条命令的退出码会被报成 1。
   ⇒ **判成不成要看脚本自己打的那几行**（`发布完成：… 核验 N 项`、`NODE_EXIT=…`），别只看外层退出码。
   同样的道理：跑这两个脚本时**别用 `2>&1` 把 stderr 并进 stdout**，否则退出码更容易被读错。

## 后续边界（如实登记）

- **tag 与 main 差一笔**（`v1.1.0` → `e28be61`，main 尖端是记账笔 `5d68a6b`）——两步记账法的必然结果。
- ⇒ **点 release 下载的那棵树里，`STATE.md` §1「发布仓 main」那行仍写着 `88bd80e` / 版本号 `1.0.1`**
  （落后两笔）。**那不是"发布错了"**：`manifest.json` 的版本号、面板构建号、注入行为都与 main 一致，
  只是文档里那句自我指涉的读数慢了两笔。★**下一版发布前，别照着 release 下载件里的 STATE.md 认发布点**，
  认远端 main 或 `verify-release.mjs`。
- **本笔没有改任何产品行为**：两个提交加起来只动了版本号、README 两处过时话、以及随文档重生的生成物。
  `PANEL_BUILD` / `CSS_VERSION` / `MAIN_PROMPT_V` / `CACHE_VERSION` / `DB_VERSION` **一个都没升**。
- 活儿单（`STATE.md` §3）与批次表**没有新增**，也没划掉：这一笔是发布，不是功能。
- 本笔零模型调用、没有改世界书、没有改用户聊天、没有重写工作区（导出全在 `%TEMP%\sw2-release\`）。
- README 里那几条老边界（只在 SillyTavern 1.15.0 上验过、位置是自由文本、快照只回世界账、
  广告过滤器误杀那一段）**照旧有效**，本笔没碰。

## 文档收尾

源码改动：`manifest.json`（version）· `web/index.js`（`VERSION`）· `test/browser-compat.test.js`（那处锁）·
`README.md`（版本号那行 ＋ 构建号在哪两处）· `STATE.md`（§1 三行 ＋ §4）·
`scripts/audit-docs.mjs`（四个 `PUBLISHED_*` 与那一格注释）· `docs/done-archive.md`（收 leg194）·
`docs/index.json` 与知识索引三件（生成物，`node scripts/build-kb.mjs` ＋ `node scripts/audit-docs.mjs`）。

★leg194 那份交接已在开头加了一条**指向本笔**的横幅（免得下一棒照它读成"还没发布"）。
F 盘那份 `STATE.md` 仍停在 leg169 读数，**本次照旧没有覆盖它**。

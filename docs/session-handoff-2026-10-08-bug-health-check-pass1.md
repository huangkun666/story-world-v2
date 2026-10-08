# 体检交接 · 第一轮"分模块找潜在 bug"（2026-10-08）—— 已逐条查实合并版

> **这一份是什么**：用户下的一道令——"帮我体检这个项目，找出当前项目所有潜在的 bug，分模块依次找，按交接式找；找完写交接文档给下一任继续找；所有找到或疑似的都落在一个文档上。"
>
> **本轮又加了一道令**："按这份文档**查实**其中真正的 bug 保留下来。" ⇒ 我把下面每一条**独立回到真实代码逐行复核**，结果直接折进本文档：每条目带**裁决档位**，确证的保留、疑似的坐实"缺陷形状是否真存在"、原报告判过头的**降温/剔除**、原报告判"已排除"的**复核排除结论对不对**。**这张表就是"下一任一一对着修"的单子。**
>
> **仍未改任何代码，一个字节都没动**（守 `STATE.md` §2.1 最高准则）。这里只登记"病灶 + 修法方向 + 修复状态"。
>
> **裁决档位图例**：
> - **✅ 确证**：回代码链子闭合，能说出触发条件与后果；
> - **🟡 形状属实**：代码里的缺陷形状核实为真，但要真账/真机才显形（多为原"疑似"，我已替下一任坐实"是不是真缺陷"）；
> - **⛔ 排除·正确**：原报告判"非 bug"，我复核**排除结论对**，别再去当 bug 修；
> - **✂️ 剔除/降温**：原报告的判断回代码不成立，已修正口径。
>
> **修复状态列**：`⬜ 待修` / `🔧 进行中` / `✔ 已修（哪棒）`。用户按此逐条勾。

---

## 0. 一句话结论 + 逐条修复清单（按"确证 + 危害"重排）

判据、冒烟、文档守门**全绿**（基线见文末）。原报告 7 条"确证"里 **6 条我复核确为真**（E-1、A-1、A-2、B-1、E-2、F-1），E-3 属实但属"缺一道守卫"的低危；4 条"已排除"（B-2/C-2/D-1/D-2）**排除结论都对**。三条原"疑似"经我坐实后**升格为确证/确证形状**：B-3、D-3、F-2。一处需**给原报告降温**：C-1（本地其实已有真裁）。**最该先修的仍是**：① E-1 XSS（安全，最小改动）；② A-1 复活引用归档事件崩整轮；③ F-2 快照链跨聊天不复位。

| 优先级 | ID | 一句话 | 档位 | 位置（现读） | 状态 |
|---|---|---|---|---|---|
| 1 | **E-1** | 链视图把模型写的标题/盘算原样拼进 HTML（XSS） | ✅ 确证·安全 | `src/render.js:2644 / 2723`（源 `:2597–2605`） | ⬜ 待修 |
| 2 | **A-1** | 带因复活引用"已归档事件" ⇒ `ev` undefined ⇒ 崩整轮 | ✅ 确证 | `src/check-step.js:378→392` 配 `src/ref-rules.js:435–441` | ⬜ 待修 |
| 3 | **F-2** | 切聊天不复位快照链 ⇒ id 撞、覆盖另一本聊天旧快照 | ✅ 确证·形状 | `web/index.js:1702` 配 `web/snapshot-store.js:93–105` | ⬜ 待修 |
| 4 | **A-2** | 校验被拒前已把 `meta.lineRequests` 写进原件 | ✅ 确证 | `src/check-step.js:573` 配 `src/settle.js:1524` | ⬜ 待修 |
| 5 | **B-3** | 往事去重按对象身份比 ⇒ 恒排不掉（吃预算） | ✅ 确证·形状（升格） | `src/pack.js:1736`（回装在 `:1752`） | ⬜ 待修 |
| 6 | **F-1** | 链里点链漏摘 `document` 上的 ESC 监听（泄漏） | ✅ 确证 | `web/index.js:2592` 配 `:2643/:2651` | ⬜ 待修 |
| 7 | **D-3** | 选人名单"位置"列读中文键 `位置`，真值在 `location`（空招牌） | ✅ 确证（升格） | `src/entity-lookup.js:84/:100`（作者自证 `:41–42`） | ⬜ 待修（口径二选一） |
| 8 | **B-1** | `malformed` 被 `slice(0,3)` 截断后读数封顶在 3 | ✅ 确证·展示 | `src/tag-extract.js:620` 配 `:695` | ⬜ 待修 |
| 9 | **E-2** | "全部轮次"下编年表头印反区间 + "共 0 行" | ✅ 确证·展示 | `src/render.js:1515` 配 `:1379/:1370` | ⬜ 待修 |
| 10 | **E-3** | `fmtTick` 无守卫 ⇒ 可印"第 undefined 轮 / 第 Infinity 轮" | ✅ 确证·低 | `src/render-base.js:863` | ⬜ 待修 |
| 11 | **E-4** | 同一份 `PANEL_BUILD` 一处转义一处不转义 | 🟡 一致性问题 | `src/render.js:992` vs `:1948` | ⬜ 待修（低） |
| 12 | **A-3** | `event-provenance` 的 `seen` 只护"报告"、没护条目 | 🟡 形状属实 | `src/event-provenance.js:90–100` | ⬜ 待真机复现 |
| 13 | **C-3** | 拒签率对 `warnings` 元素不判类型就 `.startsWith` | 🟡 形状属实·防御缺口 | `src/observatory.js:33` | ⬜ 待真机 |
| 14 | **C-4** | `meta.tick` 读成 NaN ⇒ 整段历史静默清空 | 🟡 形状属实·边界触发 | `src/vector-history.js:11/15` | ⬜ 待真机 |
| 15 | **B-4** | 无 note 的档位 `:237` 丢、`:185` 留（口径不一） | 🟡 形状属实 | `src/abstract-tier.js:237` vs `:185` | ⬜ 待真机 |
| 16 | **D-4** | 填 `maxTokens=0`/`timeoutMs=0` 被静默吞回出厂值 | 🟡 形状属实·低 | `src/transport-config.js:29/36–37` | ⬜ 待修（低） |
| — | **C-1** | ~~召回超额撑爆预算~~ ⇒ 本地已有真裁，判过头 | ✂️ 降温·部分证伪 | `src/ledger-recall.js:606`（**有** break） | ⬜ 降级为观察项 |
| — | **A-4** | `.length`（UTF-16）当字节用（影响卷切分松紧，非正确性） | 🟡 属实·低 | `src/storage.js:51` | ⬜ 待定语义 |
| — | **B-2 / C-2 / D-1 / D-2** | 原"已排除"四条 | ⛔ 排除·正确 | 见 §2–§5 各条 | 🚫 别修 |

> 逐条细节（链子、对照证据、修法方向）在下面各轨道正文里。

---

## 1. 本轮"摸过"与"没摸"的模块（下一任的开工地图）

**本轮逐行/重点看过 + 已回代码查实其结论的**（按轨道）：

- A 核心数据流：`check-step.js`、`settle.js`（prepareSettle 段）、`ref-rules.js`（cause 一格 + resolveRefTarget）、`storage.js`、`tick.js`、`event-provenance.js`
- B 抽象与抽取：`abstract.js`（分段）、`abstract-tier.js`、`abstract-input.js`、`tag-extract.js`（读数/降级）、`geography-extract.js`、`init-source.js`
- C 证据/召回/出包/检索：`pack.js`（trimPack 往事段 / fetchChronicle / fetchRelated / build 侧窗口）、`ledger-vector.js`、`ledger-recall.js`、`vector-history.js`、`observatory.js`
- D 参数/传输/实体/并发：`transport-config.js`、`entity-lookup.js`、`param-hub.js`、`undo-stack.js`、`entropy.js`、`parallel-run.js`、`macros.js`、`fp-hash.js`
- E 渲染：`render.js`（链视图段 / 编年段）、`render-base.js`（fmtTick / attrText）
- F web：`index.js`（链浮层 / CHAT_CHANGED / 落盘簿记复位）、`snapshot-store.js`

**本轮基本没深入、下一任务必接着找的**（面积大、风险未知）：

- `sanitize-step.js`、`schema*`、`event-contract.js`、`chain.js`、`gate.js` 的**净化/落账半程**（只核了校验入口那侧）
- `abstract.js` **绝大多数**（它有 3000+ 行，只抽看了起根/分段/名册几处）、`prose.js`、`lines.js`、`seed-roots.js`、`embed*`、`vector*`（除 vector-history）、`evidence*`（除 event-provenance）
- `story-reader.js`、`panorama.js`、`map-view.js`
- `param*.js` 其余、`transport-http.js`（只扫了眼）、`limits.js`、`diagnostics*`、`unrest.js`、`entity-identity.js`
- web：`model-channel.js`、`inject.js`（只看了 `__sw2LedgerHooked` 那一处）、`entity-window.js`、`idb*`、`long-task.js`、`book-source.js`、`hot-account*`
- **44 个 web 模块 + 183 个 test** 只覆盖了一小把；test 里的**断言口径**是否与生产形状同构，本轮没系统查（这是"判据绿但真机红"的经典来源）。

---

## 2. A 轨 · 核心引擎数据流

### A-1 【✅ 确证】带因复活引用"已归档事件" ⇒ 校验里 `ev` 为 undefined ⇒ 整轮白烧

- **在哪**：`src/check-step.js:378→392` 配 `src/ref-rules.js:433–442`（`'entityUpdates.cause'.event` 一格）与 `src/ref-rules.js:76–83`（`resolveRefTarget`）。
- **链子（我逐环回代码复核过，成立）**：
  1. 模型提议把 `status='dead'` 的角色写成 `status='active'`（复活），给 `cause.type='event'`、`cause.ref=<某已归档事件号>`。
  2. `check-step.js:370` 先跑 `verdictOf('entityUpdates.cause', …)`。这一格 `ref-rules.js:435` 用 `resolveRefTarget(…, { includeArchived: true })`。
  3. `resolveRefTarget`（`:81–82`）对"**号在某个里程碑的 `ids` 里**"的事件返回 `{ target: null, archived: true }`。回 `:436` `if (!hit.target && !hit.archived)` —— `archived` 为真 ⇒ 条件为假 ⇒ **不报错、`:441` return null**。⇒ 判定层**放行了"引用一条已归档事件"**。
  4. 回 `check-step.js:371`：verdict 为 null ⇒ **不走 `continue`**。`:378` `const ev = (ssot.events || []).find(e => e.id === ref)` —— `ssot.events` 只是**热账**，已归档事件早不在里面 ⇒ **`ev = undefined`**。
  5. `:387` `u.value==='dead'`（复活写 active，跳过）；`:389` `u.field==='status'`（成立）；`:390`/`:391` 都不报错；`:392` 直接 `ev.eventProtocol === 4 ? …` —— 对 undefined 取属性 ⇒ **TypeError**。
- **抛出无 try/catch**（我核过）：`checkWorldStep`（`check-step.js:161`）体内无 try/catch；`prepareSettle`（`settle.js:1524`）调它、`structuredClone` 在 `:1531`——**抛错在克隆之前**、prepareSettle 没包 ⇒ 一路抛穿、这一步世界推进整轮失败。`tick.js:129`、`worldstep.js:32` 也直调 `checkWorldStep`（`worldstep.js` 外层有 try/catch 吞成"失败"，`tick.js` 那条未见包裹）。
- **触发前提**（三件同时）：① 有角色当前 `status='dead'`；② 模型这轮提复活（写 active）；③ cause 引用的事件已进大事纪（归档）。长账里"点过这名死者的那件事"早晚会被归档，**跑得越久越易撞上**。合成冒烟没有"归档后又复活"这条线，判据/冒烟抓不到——**与 STATE §1"判据全绿"不矛盾**。
- **修法方向**：`:378` 之后对 `ev` 为 undefined 补一条"引用的是已归档事件、核不了波及名单"的**错误**（`errors.push` + `continue`），别裸奔到 `:392`。**或**：判定层既然 `includeArchived:true` 认了归档，`check-step:378` 也该能从归档里取到那条事件的名单口径——但归档事件没带 ripples，语义上"复活必须挂在点到他的**未了结**事上"本就要求它未归档 ⇒ **更可能是判定层的 `includeArchived:true` 对该走窄**（动手前先定这条口径）。

### A-2 【✅ 确证】校验被拒前，已把 `meta.lineRequests` 写进**原件** ⇒ 违背"拒签则世界不动"

- **在哪**：`src/check-step.js:573`（第②段末）+ `src/settle.js:1519–1539`（prepareSettle）。
- **链子（已复核）**：`settle.js:1524` 把**原件 `ssot`**（还没克隆）交给 `checkWorldStep`。`check-step.js:573`：`if (!errors.length && (present || hadPrev)) ssot.meta = { ...(ssot.meta||{}), lineRequests: ok };` —— 此刻 errors 空 ⇒ 对原件 `ssot.meta` 落了一格 `lineRequests`。其后 ③(`:580`)/④/⑤(`:625`)/⑥(`:648`)/⑦(`:662`) 任一段 `errors.push` ⇒ 最终 `:671` 返回 `ok:false`。
- **`settle.js:1526` 那句注释"此刻 `ssot` 就是原件，一个字节没动"——现在这句是假的。** 被拒那一步，原件 `ssot.meta.lineRequests` 已被污染。
- **我替下一任把范围查清了**（原报告留的口子）：checkWorldStep 里**就地写 `ssot.xxx` 的只有 `:573` 一处**。③–⑦ 里 `:608/:609` 写的是 `ev.position`/`a.position`——改的是 **`step`（模型提议件）**、不是世界 `ssot`，无妨。**同一个病没有扩散。**
- **后果**：违背全仓红线"校验拒绝 ⇒ 世界如实不动"（`STATE.md` §2.1、§2.2）。实际危害取决于调用方是否把这枚被拒的 `ssot` 再落盘/重试：`lineRequests` 影响下一轮"故事线"请求口径 ⇒ 一轮被拒的申请可能悄悄改到后续线的请求。至少是不变量破口，可能升级为静默错账。
- **修法方向**：`:573` 的赋值挪到"确定 ok"之后，或只在工作副本上写、由驱动在成功时提交。

### A-3 【🟡 形状属实】`event-provenance.js` 去重 `seen` 只护"报告"，没护条目本身

- **在哪**：`src/event-provenance.js:90–100`。
- **复核确认形状**：`:93 if (!seen.has(id || row))` 护的是**报告层**（`counts`/`records`/`filtered`/`unknownSources`）；而 `:100 if (d.include) { items.push(...); report.selectedIds.push(id); }` **不在 `seen` 门内** ⇒ 同 id 且都 include 的两行 ⇒ `items`/`selectedIds` 并列收两条。**缺陷形状核实为真。**
- **为何仍"需真机"**：要撞上得 `rows` 出现重复 id 且都判 include；也可能下游另有去重抹平。**下一任**：拿一本有"多事件同源于一个盘算/里程碑"的真账喂 `filterChatRecords`，看 `items` 有无同 id 重复。

### A-4 【🟡 属实·低】`storage.js:51` 把 `JSON.stringify(x).length`（UTF-16 码元数）当**字节**用

- **复核确认**：`:51 function chronBytes(rows) { return JSON.stringify(rows).length; }`——是字符数不是字节。中文一个字 length=1 但落盘 3 字节 UTF-8 ⇒ 冷档阈值按 `.length` 判，会把"5MB"实际放到约 15MB 真字节（CJK 重的书）。**影响的是卷切分的松紧，不是正确性**。
- **注意**：STATE §1 冒烟量的是真字节（"8351 字节"），与本处 `.length` 不同源；且 STATE §3 已把 `splitOffOldest`（`storage.js:53`）的"卷一轮一卷"列为活口——本条与那条同源（阈值语义）。下一若要收，先定阈值到底是"字符"还是"字节"，别两边各叫一个数。

---

## 3. B 轨 · 抽象与抽取

### B-1 【✅ 确证·展示层】`tag-extract.js` 形状不合的行数被 `slice(0,3)` 截断后**读数封顶在 3**

- **在哪**：`src/tag-extract.js:620`（`malformed: malformed.slice(0, 3)`）配 `:695`（读数 `形状不合 ${f.malformed.length} 行`）。
- **链子（已复核）**：`malformed` 在结果里被砍到最多 3 条，读数直接读 `f.malformed.length` ⇒ 真丢 5 行时报"形状不合 3 行"。**与"丢了什么必须能被看见"这条口径（同文件 `:24` 顶注）相冲**——这里恰恰把丢失量说小了。
- **对照坐实这是 unique 的一处**：其它"丢了必须可见"的读数——`eventsBad`(`:687`)、`conditionsBad`(`:690`)、`changesBad`(`:693`)、`promisesBad`(`:694`)——**这些数组在 return（`:598–611`）里原样交出、没 slice**，读数如实；**唯独 `malformed` 被 slice**。"行动"栏的截断另有其数（`:676` 用 `count<非主角条数` 判），是如实的。
- **危害**：低危、纯展示，但踩红线口径。**修法方向**：读数用一个不被 slice 的总计数（`malformedTotal`），`malformed` 数组仍只留 3 条做样本即可。

### B-3 【✅ 确证·形状（升格）】`pack.js:1736` 往事去重**按引用比 ⇒ 恒排不掉**（原报告判"疑似·需真机"）

- **我回代码坐实了原报告的悬案**：`:1730–1732` 注释承诺"`fetchChroniclePast` 与 `fetchRelatedPast` 都返回**同一个** `briefLineText` 结果，所以身份比对是准的"——**这句不成立**：
  - `fetchChroniclePast`（`:895`）在 `:920` **每次都新建** `{ tick, text, timeMark }`，且 `:913` 注释明写"**必须新造对象，不许把账上那一行原样塞进来**"（为不改账）；
  - `fetchRelatedPast`（`:1035`）在 `:1068` **另建一批**新对象。
  - 两栏装的是**内容相同、引用不同**的对象 ⇒ `:1736 brief.filter(r => !relatedKept.includes(r))` 的 `.includes`（按引用）判不等 ⇒ **去重静默失效**。
- **窗口不救它**：建包时 `pack.纪事`（`:1404` 的 `brief`，`tick >= windowFloor`）与 `pack.相关往事`（`:1064` 里 `t >= floor` 筛掉窗口内、只留 `t < floor`）**本就互斥**（`floor === windowFloor`，`:1403` 与 `:1041` 同式）。失效真正咬人是在 **`trimPack` 的额度守卫回装那条路**：`:1752 if (briefAvail.length && pack.纪事 === undefined)` —— 当"纪事"整栏被固定剪枝序丢掉、守卫从 `briefAvail`（含窗口外行）回装时，一条**已在 `相关往事` 里的窗口外旧事**会因去重失效被**再装进"纪事"** ⇒ 同一件占**两次额度**（直接吃预算）。
- **为何仍留"需真机定量"**：撞上需"纪事被丢 + 该相关旧事落在回装区间 + 预算够回装它"三件同发，读码不能定量。**下一任**：真账造一条"既窗口外、又相关、又恰在回装段"的往事，`纪事` 被丢后出包数两栏有没有同件占双份。**坐实则价值不低（吃预算）**。
- **修法方向**：改成**按值键**去重（同 `:1450` 用的 `lineKeyOf(tick, text)`，`:1000` 定义为 `${tick}|${briefLineText(text)}`），别按对象身份。顺带对齐 `ledger-vector.js:352` 的**按 id 去重**（见 C-2）——两把尺子并成一把。

### B-2 【⛔ 排除·正确·留档免重查】`geography-extract.js:50/52` 通道方向非法时"照收链接、只弃方向字段"

- 我回代码确认**排除对**：`:50 reject(subject, '方向非法，方向字段已弃')` 只做诊断留痕，`:52` push 的 `out`（`:46` 建的 `{from,to,type}`）本就没带 direction（`:49` 只在方向合法时才挂 `direction`）——**与提示语"方向字段已弃"一致，是有意行为**。**不是 bug**。记在这里是为了防止下一任顺手"加个 continue"把合法链接误丢。

### B-4 【🟡 形状属实】`abstract-tier.js:237` 无 note 的档位被丢，而 `:185` 同形却留

- **复核确认不对称**：`:185` `.filter((x) => x.level)`——**只要 `level` 就留**（`note` 空也留）；`:237` `if (!level || !note) continue;`——**`level` 或 `note` 缺一个就丢**。两处对"档位条目"的取舍口径不一致。**需真机**：拿一本档位有裸名无释义的书，看重抽刻度会不会少档。

### B-5 【未核】`abstract.js:2495 / 2502` 分段索引与数组可能错位

- 本轮**未逐行核**（`abstract.js` 3000+ 行，是最大的未覆盖面）。原报告只登记形状、未验真，我亦未推翻。**下一任**重点扫这一带。

> B 轨其余记号（`abstract-input.js:83/100`、`init-source.js:650`、`tag-extract.js:644`、`abstract.js:2360 longest-wins` / `:2322/2343 dead seenPs` / `:3163`、`geography-extract.js:63–67`）本轮**只做了形状登记、未逐条验真**，留给下一任，别当结论。

---

## 4. C 轨 · 证据 / 召回 / 出包 / 检索

### C-1 【✂️ 降温·部分证伪】`ledger-recall.js:605`——原报告"不做中段裁剪、把整包撑过 `LEDGER_CHARS_DEFAULT`"**判过头**

- **回代码不成立**：`ledger-recall.js:601–608` 本地**就有一道真裁**——`:604` 循环、`:606 if (kept.length && chars + len > maxChars) break`。超预算即**停、整条不塞**（不是"只按估数放行不裁"）。
- **残余的真问题（比原报告小得多）**：① 本地裁的是**召回段自己的 `maxChars`**（缺省 `DEFAULTS.maxChars`），不是整包预算——**整包那一刀由 `pack.trimPack` 兜**（`:599` 注释也讲"纪事那一栏不设上限、只认包预算"是**有意**的）；② `:605` 的 `len = String(...).length` 用的是**字符数**（与 A-4 同族），且量的是 `it.text/title/goal`、与最终渲染进包那一份（带前后缀）不同形 ⇒ 召回段估算可能偏小，但**不会让整包越界**（包侧真量兜底）。
- **结论**：**不作"会撑爆预算"的 bug 保留**。降级为"召回段本地额度是字符估算、与包侧渲染量不同形"的低优先观察。**下一任**先读 `pack.js` 确认包侧真裁覆盖了召回段的估算误差，若覆盖则此项可关。

### C-2 【⛔ 排除·正确，唯一有价值的是引出 B-3】`ledger-vector.js:345/352` 按 id 去重是对的；`ripples` 那一格在生产形状下是死支

- **复核确认排除对**：`:352` 去重按 `skip.has(String(it.id))`（按 id，正确）。`:358` 附近对 `ripples`/`touched` 的加权处理，在生产世界形状（plot 事件走 actors/eventProtocol=4）下**走不到** ⇒ 死支/冗余，非缺陷。
- **顺带钉一个对齐点**：这里按 **id** 去重、而 `pack.js:1736`（B-3）按**对象身份**去重——**两把尺子不一致，且 B-3 那把是坏的**。修 B-3 时把两路并成一把（按 id / 按值键）。

### C-3 【🟡 形状属实·防御缺口】`observatory.js:33` 拒签率对 `warnings` 元素**不判类型**就 `.startsWith`

- **在哪 + 复核**：`src/observatory.js:33` `(r.warnings || []).filter(w => REJECTION_PREFIXES.some(p => w.startsWith(p)))`。若历史某轮 `warnings` 混进**非字符串**（数字/对象）⇒ `w.startsWith` 抛错 ⇒ 观测页拒签率那块渲染失败。生产 warnings 基本是字符串 ⇒ 属**防御缺口**。**下一任**扫有无写手往 `simLog[].warnings` 塞过非字符串；不能保证就加 `typeof w === 'string'` 前置过滤（最省）。

### C-4 【🟡 形状属实·边界触发】`vector-history.js:11/15` 若 `meta.tick` 读成 NaN ⇒ **整段历史静默清空**

- **在哪 + 复核**：`src/vector-history.js:11` `const now = Number(world?.meta?.tick)`，`:15` 每行 `add()` 里 `… || !Number.isFinite(now) || …` ⇒ **`return`**。若 `meta.tick` 缺失/非法 ⇒ `now=NaN` ⇒ 每行被丢 ⇒ `activeHistoryRows` 返回**空、且不报错**（召回/向量那一路"看着什么都没记住"）。
- **触发条件性**：新世界 tick 从 0 起（有限）不受影响；只有**导入的旧账 / 缺 tick 的世界**才撞。**与红线"空着就是空着"擦边**（读不到 tick ⇒ 假装没历史，可能该出声）。**下一任**用一本没 `meta.tick` 的旧账喂一下确认。

---

## 5. D 轨 · 参数 / 传输 / 实体 / 并发

### D-1 【⛔ 排除·正确】`macros.js:36/85–86` 共享 `/g` 正则的 `lastIndex` —— 作者已正确处理

- **复核确认排除对**：`:85 if (!MACRO_RE.test(s)) return s;` 不中时规范本就归 lastIndex=0 且随后直接 return；`:86 MACRO_RE.lastIndex = 0;` 命中即复位；`:89 s.replace(MACRO_RE, …)` 也自复位。**两分支都安全，非 bug**。留档防下一任误改。

### D-2 【⛔ 排除·by-design，非缺陷】`parallel-run.js:78 / 86` worker 抛错会留下"后台仍在跑的其余 lane"

- **复核确认排除对**：`:86 Promise.all(Array.from({length:lanes}, runLane))` 某 lane 抛 ⇒ 立刻 reject、其余 lane **不取消**（`:41–44` 注释明说有意"不做一炸全停"）；契约要求 worker 自把失败收成返回值（抽取管线照做）。**残留风险（低/需真机）**：若两条 lane **都**抛，第二条 reject 变 unhandledrejection ⇒ 浏览器 console 噪音 / Node 下可能触发 unhandledRejection。下一任若发现调试台偶发"未处理的 Promise 拒绝"，这里是一个源。**非数据 bug**。

### D-3 【✅ 确证（升格）】`entity-lookup.js:84` 选人名单那列"位置"读的是**中文键 `位置`**，而真位置在英文 `location`

- **在哪 + 复核**：`src/entity-lookup.js:80–85` `selectRosterLine`，`:84` 末列 `${val('位置')}`（= `e['位置']`）；`:100` 表头明列"…/ 位置"。**同文件作者自己已在 `:41–42` 写明**：「`fields` 里的中文键 `'位置'` 查的是 `entity['位置']`，而账本用的是英文键 `location`（**实测：中文键 0/563、`location` 有占位值 563/563**）」，并据此把 `ENTITY_LOOKUP_FIELDS`（`:47`）收成只剩 `['实力']`。
- **⇒ 名单"位置"列几乎恒为 `—`（空招牌），而地理系统真填的 `e.location` 从没被读进这栏 ⇒ LLM 选人看不到地图推出来的位置。** 表头承诺有、产出没有：误导模型也误导读码人。
- **是不是 bug 取决于口径**（但代码作者已自证键错位）：若产品决定"就是不喂位置给选人器"，那**表头该把"位置"去掉**，否则是空招牌。**修法方向（二选一）**：要么 `:84` 这栏改读 `e.location`（真喂位置），要么把表头 `:100` 与产出行 `:84` 的"位置"一起去掉。踩的是"个性/口径要自洽"。

### D-4 【🟡 形状属实·低，但碰红线】`transport-config.js:29/36–37` 用户填 `maxTokens=0` / `timeoutMs=0` 被静默吞回出厂缺省

- **在哪 + 复核**：`:29 maxTokensFinal = extraction ? (maxTokens || EXTRACTION_MAX_TOKENS) : (lim.maxTokens ?? maxTokens)`；`:36 ...(maxTokensFinal ? {maxTokens} : {})`、`:37 ...(timeoutMsFinal ? {timeoutMs} : {})`。0 是 falsy ⇒ **不传** ⇒ 落回 `createHttpTransport` 出厂值。
- **碰的红线**：STATE §1 反复强调这两个框"**现读设置、玩家可自己填**"。玩家真填了个 0（或本意"0=不限"），拿到的是"出厂 32768/出厂超时"，**与"填了就生效"的承诺不符**。0 不是合理取值 ⇒ 低危，但**静默回退**违背"现读"的诚实口径。**修法**：显式拒 0 并出声；或 `?? ` 全程一致（extraction 分支用 `||`、主调用分支用 `??`，两分支口径也不齐，一并统一）。

### D-5 其余（本轮**只登记未验**，别当结论）

- `param-hub.js:816–820`（清墓碑在写之前、失败无回滚）、`:554`（`displayEnv` 写侧副作用）、`:255–270`（`lastKnownName` 疑跨聊天残留）、`:698/700`（死支）、`:1026–1028`（`autoAdvance` null→"关"，注意与 STATE §3 那条"存量世界一次性迁移"口径对不对得上）、`param-hub.js:172–182`（`healTombstones` 是否 dead）、`entity-lookup.js:82`（同 D-3）、`undo-stack.js:96–101`（同标签 pop、疑仅测试面）、`fp-hash.js`（meta 展开覆盖）。**这些下一任逐条回代码坐实再定级。**

---

## 6. E 轨 · 渲染 UI 层

### E-1 【✅ 确证·安全类·本轮最高优先】链视图把**模型写的标题/盘算**原样拼进 HTML（XSS / 结构破坏）

- **在哪 + 复核**：`src/render.js:2597–2605`（`cvSrcPhrase`）——`沿「${n.title}」而来`（`:2599`）、`由盘算「${n.goal}」而生`（`:2600`）的 `n.title` / `n.goal` **没过 `escapeHtml`**。
- **两个消费点都裸拼**：`:2644`（`<div class="sw2-cv-meta">${src}</div>`，`src` 即 `:2641` 的 `cvSrcPhrase(nodes[i-1])`）与 `:2723`（`<b>源自</b>：${cvSrcPhrase(nearSrc)}`）。**`:2723` 同一行**里 `escapeHtml(root.position)` 转了、紧挨的 `cvSrcPhrase` 没转——一行之隔的对照，坐实是漏不是设计。
- **对照证据（同层都转义、唯独这里松）**：`cvSeedPhrase`（`:2609`）也内嵌未转义的 `${quote}`，但**调用处 `:2675` 补了 `escapeHtml(...)`**；`cvSrcPhrase` 的调用处 `:2644/:2723` **没补**。另 `escapeHtml(n.title)`(`:2643`)、`escapeHtml(n.goal)`(`:2648`) 都单转过。
- **危害**：`n.title`/`n.goal` 是 LLM 自由文本，含 `<`、`"`（如 `<img onerror=…>`）会破坏面板 DOM、甚至执行脚本。玩家可见面 + 注入面双重。**本轮唯一安全类确证项，优先级最高。**
- **修法方向（§2.1：等用户点头再动）**：`cvSrcPhrase` 内对 `n.title`/`n.goal` 走 `escapeHtml`（同款 `:2643/:2648`）；建议连 `cvSeedPhrase` 内也补转义，别只靠调用点（纵深防御）。
- **顺带排查（交下一任）**：全仓 `cv*Phrase`/拼串里还有没有别的"模型文本没转义"的格子；`render.js` 之外（`story-reader.js`/`panorama.js`/`map-view.js`）同族拼串也照这法子扫。

### E-2 【✅ 确证·展示】"全部轮次"下编年"近来发生的事"那组表头**印出反的轮区间 + "共 0 行"**

- **在哪 + 复核**：`src/render.js:1515`（组头）配 `:1379`（`hot.hit`）配 `:1370`（`rangeN: win`）。
- **链子**：选"全部轮次"时 `win`(=`rangeN`) 为 `null`。`:1379` `hot.hit = win == null ? 0 : hot.length` ⇒ `hit=0`；`:1515` 组头 `第 ${Math.max(1, sel.tick - (sel.rangeN ?? 0) + 1)}–${sel.tick} 轮 · 共 ${hot.hit} 行` ⇒ `rangeN` 为 null 时算成 `第 (tick+1)–tick 轮`（**区间反了/空区间**）且"共 0 行"。可这一组**实渲的是分页后的 `events` 主列表**（`:1515` 末传 `hot.rows=events`；`:1511` 注释自证"全部轮次下 126 条真事件翻 3 页"）。⇒ 玩家看到"共 0 行 / 第 127–126 轮"底下一大片事件，自相矛盾。
- **危害**：纯展示误导，不烧账；但正是"面板展示该对得上玩家看到"的硬伤。**修法方向**：`rangeN==null` 那支给个诚实表头（"全部轮次 · 共 N 行"），别套 `tick+1–tick` 窗口公式。

### E-3 【✅ 确证·低】`fmtTick` 无守卫 ⇒ 可能印"第undefined轮 / 第-Infinity轮"

- **在哪 + 复核**：`src/render-base.js:863` `export const fmtTick = (n) => \`第${n}轮\``——传 undefined/null/`±Infinity` 原样进串（同文件 `:864 fmtPct` 有 `?? 0` 兜底，`fmtTick` 没有）。
- **属实但触发条件性**：只有调用点传进非有限值才显形。`src/entropy.js:66–67` 注释自己就担心"标题说 Infinity 轮"这类矛盾，说明这族风险真实。**多数调用点传有效 tick** ⇒ 低危。**修法方向**：`fmtTick` 对非有限数给个诚实占位。既然是统一格式化口，加一道守卫最省。

### E-4 【🟡 一致性问题·低】`render.js:992` 与 `:1948` 对 `PANEL_BUILD` 的转义/显示口径不一致

- **复核确认**：`:992 <b>${escapeHtml(PANEL_BUILD)}</b>` vs `:1948 构建 ${PANEL_BUILD}`（未转义）。同一份值两种印法。**低危**（构建号是受控内部串，如 `leg209-character-protection-cleanup`，无 XSS 风险），但**违背"一把尺子"**。下一任顺带对齐即可。

---

## 7. F 轨 · web 接线层

### F-1 【✅ 确证】链浮层"链里点链"会**漏 document keydown 监听**（ESC 处理器越积越多）

- **在哪 + 复核**：`web/index.js:2592`（先撤上一层）+ `:2636–2643`（挂 ESC）+ `:2651–2655`（`closeChainPopup` 摘 ESC）+ `:2624–2627`（"链里再点链"回调 `bus['open-chain']`）。
- **链子**：`bus['open-chain']` 进来第一件事 `:2592 document.getElementById(CHAIN_MASK_ID)?.remove()` —— **只把旧 mask 从 DOM 摘掉，没跑 `closeChainPopup()`**，于是旧 mask 存在 **`document`** 上的那个 `keydown(onEsc, true)`（`:2643` 加的）**没被 `removeEventListener`**（`removeEventListener` 只在 `closeChainPopup` `:2653`）。每次"从一条链里点开另一条链"，就多一个**孤儿 onEsc 永久挂在 document**（闭包还牵着那条已 detached 的 mask）。
- **精确边界**：挂在 **mask 元素**上的 click 监听（`:2601/:2610`）随 `mask.remove()` 一起回收，**没问题**；泄漏的**只有挂在 `document` 上的 keydown**。
- **危害**：内存随点击累积；孤儿 onEsc 每次 ESC 各自 `stopPropagation/preventDefault/closeChainPopup`（`closeChainPopup` 按 id 找当前层，功能上大体幂等，但监听器本身**永不回收**）。确证的监听器泄漏，非数据错误。
- **修法方向**：`:2592` 改成先调 `closeChainPopup()`（它会正确摘 ESC）再建新的。**下一任**顺手验"连开 N 条链 → 关到 0 条 → 再按 ESC"行为是否仍正常。

### F-2 【✅ 确证·形状（升格）·F 轨最该修】切聊天**不复位快照链模块态** ⇒ 快照 id 可能撞到并覆盖另一本聊天的旧快照

- **在哪 + 复核**：`web/index.js:1702–1705`（`CHAT_CHANGED`）配 `web/snapshot-store.js:93/96/104–119`（链态 + `ensureSnapshotChain` 的 `sw2SnapInited` 一次性门）。
- **链子（坐实）**：
  - `snapshot-store.js:93–96`：`sw2SnapChain` / `sw2SnapQueue` / `sw2SnapLast` / `sw2SnapInited` 全是**模块级、与聊天无关**的全局；IDB 键 `${chatId}:${id}`（`snapshotStore(freshCtx)` `:121–124` 每次现取**当前** chatId）。
  - `web/index.js:1702–1705` `CHAT_CHANGED` 只做 `sw2TickQueue?.invalidate()` + `loadWorld()`，**没复位这四样**；`loadWorld`（`:1803`）也没调 `clearSnapshots/resetSnapshots`。
  - `ensureSnapshotChain`（`:104–105`）`if (sw2SnapInited) return` 一次性门：聊天 A 时已对齐 ⇒ 切到 B **不重跑对齐**（`:111` "取盘上最大序号"不执行）。
  - `requestSnapshot`（`:184–200`）在队列里 `await ensureSnapshotChain()` 被上面的门挡掉 ⇒ `planStep` 用**A 残留的 `sw2SnapChain.seq` + `anchorWorld/anchorId`**（`:187–193`）给 B 出号、做增量。
- **后果**（正是 `leg27 e` 治过的那个病**跨聊天复发**，`:98–102` 注释为证）：
  - 若 **B 盘上已有快照的 maxSeq > A 的链 seq** ⇒ B 的下一份快照 id 落进 B 已被占用的号 ⇒ **覆盖 B 里的一份旧快照**（丢历史，"`:100` 注释说的越新的 id 时间越早/重复清不掉"会再现）；
  - `anchorWorld/anchorId` 还停在 A ⇒ B 的第一份快照按 A 的锚世界做增量 ⇒ 增量对不上、回档可能拿到脏 delta；
  - 若 B 是全新聊天，A 停在 s20 ⇒ B 从 s21 起（不覆盖，只是编号跳，**外观**问题）。
- **复位口确实存在但没被接线**：`snapshot-store.js:335–346`（`clearSnapshots`）会复位（`:339–341`），`resetDedupState`（`:378`）只清 `sw2SnapLast`+`sw2SnapLastWorldFp`（**不碰 chain/inited**）；唯一串起 `resetDedupState` 的 `sw2ResetFlushState`（`index.js:574–580`）注释明写"**只供判据用**"——切聊天生产路没调它。
- **修法方向**：`CHAT_CHANGED` 里复位快照链（清 `sw2SnapChain` + 把 `sw2SnapInited` 置 null，让 `ensureSnapshotChain` 对新聊天重跑一次对齐）。**注意与异步队列 `sw2SnapQueue` 里可能还有上一本未落完的写竞态**——复位时机要么 drain 队列要么带 chatId 标签（发现切了本自动重置）。**建议下一任先做一次两本真聊天的实机复现**（开两本都有快照、且第二本最大序号更高的聊天，来回切、各推进一轮，看第二本旧快照有没有被盖）。

### F-3 【未坐实·需真机】`web/index.js:1842–1843` `mirroredNow` 可能 null 取属性

- 复核：`:1842 const mirroredNow = flushedWorld || adopted.world;` `:1843 world.context.setting = mirroredNow.context.setting;`，包在 `:1840 if (paramsMirrored)` 里。**我没坐实** `mirroredNow` 为 null 的分支是否可达（`if (paramsMirrored)` 是否保证 `adopted.world` 非空；导入/无热账时）。仍属**需真机**。下一任回代码看这一支。

### F-4 【未坐实】`web/index.js:508–510` `dispatchAction` 丢弃返回的 Promise

- 本轮未逐行深核。若 action handler 是 async，这里不 await/不 catch ⇒ 后台失败静默、状态条不更新。**下一任**扫 `bus[...]` 里哪些是 async、有没有该反馈给玩家却被吞掉的失败。

### F-5 【未坐实】`inject.js:1062–1073` 把 `__sw2LedgerHooked` 写在**宿主对象**上 ⇒ 第二个注入器漏挂/第一个用陈旧闭包

- 本轮只看了这一处形状，未坐实标记作用域是宿主对象还是本模块。**需真机**：重载插件/共存注入时看注入是否只生效一次且用的是当前世界。

### F-6 【未坐实·需真机】`idb-backend` openDb 未挂 `onblocked` ⇒ 老标签页占着时**可能永久挂起**

- 本轮未深核。IndexedDB `open()` 若有旧版本被别的连接占着会走 `blocked`/`versionchange`；不处理 `onblocked` ⇒ Promise 永不 settle ⇒ 面板卡在"载入中"。**需真机**（开两个酒馆标签）。下一任看 idb 封装有没有超时兜底。

> F 轨附带两条**已澄清**（复核后维持）：① `transport-http` 早改用 `XMLHttpRequest`，不存在"与宿主 fetch 被 hook 的耦合"；② web 层本轮没扫出别的 XSS（`index.js` 拼串基本都过 `escapeHtml`/`attrText`，唯 E-1 那处在 `src/render.js`）——**但没逐行穷尽 44 个 web 模块**，E-1 的教训（一行之隔漏转）说明同族风险真实，下一任按同法扫。

---

## 8. 文档/口径层（本体检跑守门时顺带核过）

- **`web/index.js` 行数没有漂移（先前的怀疑已排除，别再报）**：`STATE §1` 现写 **3085 / 3100**，`audit-docs` 判绿（`wc -l` 报 3084 是行尾换行符计数差，见 MEMORY 记的"split('\n').length 比 wc -l 多 1"）。⇒ 唯一要留意的是**硬锁 <3100、余量只剩 15 行**，后续往 `web/index.js` 加东西时快顶到顶了。
- 本轮这份是**体检文档**，不进 `STATE.md` §3 的唯一活儿清单（§2.4：agent 顺手记的观察**先写进当棒交接**，不进 §3）。要转成正式待办，需用户点头。
- **为出这份文档而改的派生文件**：按本仓"改文档就跑 `build-kb`"的规矩，`docs/kb.json / kb-index.md / kb-search.html` 需据本合并版**重生成**（守门 R10 指纹同步、判绿）。**源码一个字节没动。** ★注：上一版的查实结论已折进本文（不再另存 `*-VERIFIED.md` 副本，避免第二份真相）。

---

## 9. 建议下一任的接着修顺序（按"确证 + 危害"）

1. **E-1 链视图 XSS** —— 安全、确证、改动最小（`cvSrcPhrase` 补 `escapeHtml`）。先做。
2. **A-1 带因复活引用归档事件崩整轮** —— 确证的推进失败、长账必现。`:378` 后拦一条错误；先定"复活该不该允许挂归档事件"的口径。
3. **F-2 快照链跨聊天不复位** —— 代码形状已确证；先做两本聊天实机复现，再在 `CHAT_CHANGED` 复位链态（注意队列竞态）。F 轨最该修。
4. **A-2 拒签前改原件** —— 确证的不变量破口（我已替你查清只有 `:573` 一处）。赋值挪到"确定 ok"之后。
5. **B-3 往事按身份去重恒失效** —— 已坐实"两栏是各自新建的对象" ⇒ 尺子是坏的。改按 `lineKeyOf` 值键，顺带对齐 C-2 的 id 尺。
6. **F-1 ESC 监听泄漏** —— `:2592` 改调 `closeChainPopup()`。
7. **D-3 选人位置空招牌** —— 口径二选一：改读 `e.location` 或删表头/产出行的"位置"。
8. **B-1 / E-2 / E-3 / E-4** —— 展示/一致性确证项，低危但踩"丢了必须可见/一把尺子"红线。
9. **A-3 / C-3 / C-4 / B-4 / D-4** —— 形状属实的防御/一致性缺口，真账/真机才显形，可批量加前置守卫与出声。
10. **C-1 已从"撑爆预算"名单摘掉**（本地有 `:606` 真裁），降级为"召回段额度是字符估算"的低优先观察。

**没覆盖的大面**（本轮人力所限，下一任别当已查过）：`abstract.js` 主体、`sanitize-step.js`/`schema`/`event-contract.js` 的落账半程、`chain.js`/`gate.js`、`story-reader.js`/`panorama.js`/`map-view.js`、`model-channel.js`、其余 param/web、以及 **183 个测试的断言口径是否与生产形状同构**（"判据绿但真机红"的根）。

---

## 10. 读数现场（本轮证据）

- 基线（**未复量**，仅核 STATE §1 现值）：判据数以 `STATE.md` §1 为准（现写 2240/2240 · fail 0）；冒烟 `node demo/smoke-demo.js` PASS · 终态 SSOT 8351 字节；`node scripts/audit-docs.mjs` 通过。证据日志：`F:/deepseek/tmp/bug-hunt-2026-10-08/`、`F:/deepseek/tmp/audit-baseline-tests.log`。
- 现读行数：`web/index.js` 3085（Node `split('\n').length`；`wc -l` 3084）、`src/render.js` 2804、`src/check-step.js` 672、`src/pack.js` 1847、`src/transport-config.js` 43、`src/macros.js` 103、`src/parallel-run.js` 88、`src/vector-history.js` 53、`src/observatory.js` 137、`src/entropy.js` 87。
- **本轮查实逐条回真实代码复核，未改任何代码、零真实模型调用、未碰真实聊天/世界账/世界书、未推远端。** 每条"确证/升格"都附**独立复核过的 `文件:行号`**；标"形状属实"的行号亦经核对，缺的只是真账/真机复现。

// story-world-v2/test/prompts.test.js
// 契约层·主调用 prompt 锁（第十三棒起）：模板/铁律的关键语义是给模型看的契约——
// 回退即回归，用断言钉死（v2-ripples-1：ripples=实体 id 显式化）。
// leg24 检察官审计处置 H 组（v2-agenda-t1-5）：版本锁升位 + "分量"退场锁（片3）。
// leg25 c（单维删除）：**attrs 相关锁整条撤除**——四维浮点（兵力/权位/人脉/耳目）已随用户令删除，
//   模板里不再有 `attrs` 这一项（连同"省略=这一维空着"那句一起消失），所以没有可锁的东西了。
//   为什么不是"换名续用"：那正是本次要治的病（拿精确外壳装模糊内容）；该删就删，锁也一起删。
//   保留的锁改成"七组形状"——stateChanges 与 attrs 去掉后，世界步=七组，这个数字本身就是契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_PROMPT, MAIN_PROMPT_V, OUTPUT_TEMPLATE, assembleMainPrompt } from '../src/prompts.js';
// leg31：行式表格的往返判据（判据 D）与分隔符自检（判据 C）直接打真源函数，不自建副本
import { packTextOf, parseEntityTableBlock, entityTableAnomalies, ENTITY_TABLE_HEADER, buildEvolutionPack, trimPack, EVOLUTION_BUDGET_TOKENS } from '../src/pack.js';
// leg29：告知面上限不写字面量——直接读真源常量，改上限则本用例随之成立（与 worldstep 那条同法）
import { RIPPLE_TARGET_CAP } from '../src/weight.js';
// leg32d：七组必填的**真源**（与其在提示词里抄一遍，不如直接读 schema——数字/清单只允许一个真源）
import { worldStepSchema } from '../src/schemas/world-step.schema.js';

// leg32c：包面用例的小夹具（与 lens.test.js 同形——两处各留一份是有意的：
//   它俩测的东西不同，共享夹具会把"包形状"与"剪枝序"两件事绑在一起）
function mkWorld({ entities = [], weights = {}, events = [], agendas = [], tick = 0, moveFact = null } = {}) {
    return {
        context: { world: '测试', tension: 0.5, positions: ['中央'] },
        entities,
        weights,
        agendas,
        events,
        meta: { tick },
        moveFact,
    };
}
const ent = (id, name, kind, extra = {}) => ({ id, kind, name, location: '中央', ...extra });

test('契约锁：主调用模板版本与铁律语义（v2-agenda-t1-23：★leg100 第 15 条补「归档不许当候选」+ v2-agenda-t1-22：leg95 第 15 条「收场提议 eventClosures」+ v2-agenda-t1-21：leg90 第 8b 条「事件标题自带对象」+ leg40 第 14 条「线捆 + 拾遗」+ leg39 视角改写「你就是这个世界」+ 多主线并立 + 事件三源分工 + 新线三由来 + leg34 字段写回/带因复活/主动查 + leg33c 位置＝自由文本 + leg33「（推）」注解照旧剥 + leg32h 陈旧死链头过滤/并行 + 主角认领 + leg32g 待启用名单 + leg32e 新人出场权 + leg32d 七组必填/点名解锁 + leg32c 长跑接得上 + leg31 实体段行式表格 + leg29 波及上限告知面 + 分量退场 + leg25 c 七组形状）', () => {
    assert.equal(MAIN_PROMPT_V, 'v2-agenda-t1-23');
    // ★★★leg95（用户令「让 llm 来决定何时结束」+「引入机械就一定要避免让代码去理解语义」）：第 15 条。
    //   为什么立它：`seed`/`state` 两种源**没有任何关闭路径**，涟漪的门①追到种子永远 false
    //   ⇒ 真账 A 局 16 条 / B 局 44 条**结构上永远闭不了**（推 40 轮只增不减）。机械判不了"这段讲完了没有"。
    //   ★问法经真账回测定稿（装置 `demo/measure-leg95-close-live.js`）：问「讲完了没有」⇒ A 局点 18/42、
    //     B 局点 9/68，**号零错**；问「还用不用接着提」⇒ 同一份账点 43/68（含 14 件刚落账的）——太狠。
    assert.ok(MAIN_PROMPT.includes('eventClosures'), '第 15 条必须点名 eventClosures 这一组（不给入口＝兑现不了的承诺）');
    assert.ok(MAIN_PROMPT.includes('每一件都已经发生过了'), '★先把"还没结束"的语义说清（它不是"正在发生"，是"账上还没放下来"）——这是这一条的地基');
    assert.ok(MAIN_PROMPT.includes('这一段过去了'), '★"结束"的定稿口径＝这一段过去了（不是"有个圆满结局"）');
    assert.ok(MAIN_PROMPT.includes('半途而废、被更大的事盖过去、不了了之'), '★"结束 ≠ 圆满"必须明写（否则模型不敢收）');
    assert.ok(MAIN_PROMPT.includes('下一轮还会问一次'), '★"拿不准就不要列"要给退路（漏一件的代价远小于收错一件）');
    assert.ok(MAIN_PROMPT.includes('等于你自己把手头的线掐了'), '★点明"硬收"的后果（把还在演的事按下去）');
    assert.ok(MAIN_PROMPT.includes('收场不是在世界上再发生一件事'), '★防"给收场再写一件 state 的事"那种形态错乱');
    assert.ok(/一轮\*\*最多 8 件\*\*/.test(MAIN_PROMPT), '配额要写给模型看（超出的引擎顺延，不白跑）');
    assert.ok(MAIN_PROMPT.includes('已经收过场的事再收一次'), '★两种会被当场拒的写法要写明（省得白写一轮）');
    // ★旧"在办/搁置"问法**不许进生产提示词**：真账实测它一次清掉 63%（含刚落账的事）——那是把世界正演的事一起收了。
    assert.ok(!MAIN_PROMPT.includes('还用不用接着提'), '★回测里那个"太狠"的问法不得回潮（它会清掉正在演的事）');
    // ★leg40 第 14 条（线捆）：治"起了根没人浇"——真账 59 轮起过 9 条无来路的线、下一轮一条都没被接续。
    assert.ok(MAIN_PROMPT.includes('"线捆"（threads）'), '第 14 条必须点名 threads 这一栏（模型得知道看哪儿）');
    assert.ok(MAIN_PROMPT.includes('上面每一条，本回合各给它一步'), '★"每条各写一步"是这一条的核心要求（不是"挑一条"）');
    // ★★leg40b 续（口径升级）：条数现在**由包自己说**（`limits.js` 的「每轮递线」可调 3/6/9）。
    //   模板里存的是惰性记号（`TH_CN` 那两个 \u0001 包着的记号），**由 `assembleMainPrompt` 按本次递送条数渲染**
    //   ⇒ 所以这条锁要**两段都锁**：①模板里那句"只推一条＝没做完"必须在（要点不许丢）；
    //   ②默认 3 条时渲染出来的正文必须**与旧正文逐字相同**（这就是"默认行为不变"的判据）；
    //   ③换成 6 条时必须跟着变（否则又回到"递 6 条而正文说三条"那个自相矛盾的坑）。
    assert.ok(/条里只写一条 = 本回合没做完/.test(MAIN_PROMPT), '★必须把"只推一条"判为不合格（要点在模板里）');
    const promptWith = (n) => assembleMainPrompt({ pack: { threads: Array.from({ length: n }, (_, i) => ({ id: 'ev_x_' + i })) }, text: '{}' });
    assert.ok(promptWith(3).includes('三条里只写一条 = 本回合没做完'), '★默认 3 条 ⇒ 渲染出的正文与旧正文逐字相同');
    assert.ok(promptWith(6).includes('六条里只写一条 = 本回合没做完'), '★递 6 条 ⇒ 正文说六条（不许还写"三条"）');
    assert.ok(!promptWith(6).includes('最多只有三条'), '★旧的自相矛盾句（"这一栏最多只有三条"）不得回潮');
    assert.ok(!/\u0001TH_/.test(promptWith(3)) && !/\u0001TH_/.test(promptWith(6)), '★惰性记号不许漏进正文');
    assert.ok(MAIN_PROMPT.includes('不许把它们合并'), '★假并行（三线写成同一件事）必须明禁');
    assert.ok(MAIN_PROMPT.includes('出现在这里 = 它**还在等你接着写**'), '线头台账的读法：留在栏里 = 还没人接');
    // ★leg40 拾遗（closedRoots，用户给的第三条料路：挖账上已有的事件）
    assert.ok(MAIN_PROMPT.includes('拾遗（closedRoots）'), '第 14 条必须点名 closedRoots 这一栏');
    assert.ok(MAIN_PROMPT.includes('旧事也能接'), '拾遗的口径：旧事是可以接的（不是背景）');
    assert.ok(MAIN_PROMPT.includes('没有任何事的来路指向它'), '拾遗的机械判据要写清（已了结 + 无下游）');
    assert.ok(MAIN_PROMPT.includes('closedRoots 是可以动手接的'), '★与 recentClosedEvents 的分工必须写死（否则被当背景读过去）');
    assert.ok(MAIN_PROMPT.includes('一轮**接一条就够**'), '★限量：防它挤掉线捆那几条的位子');
    // ★与第 12 条（idleFaces）的语义分工必须清楚：一个是"谁该动"，一个是"哪条线没人接"
    assert.ok(MAIN_PROMPT.includes('idleFaces'), '第 12 条（待启用名单）仍在场');
    assert.ok(!MAIN_PROMPT.includes('本回合至少挑其中一条'), '旧"至少挑一条"口径不得回潮（它与"每条各写一步"直接打架）');
    // ★leg39（用户令「告诉 llm 他是世界本身，世界是多主线并行的」）：视角与"多主线"口径必须真写进去——
    //   改前实测：提示词通篇预设"只有一条主线"（"与主线无关""主线照推""主线之外再长出一条"），
    //   且**从未出现过"多条主线/新主线/自己的轴"任何一种要求** ⇒ 模型给的正是它被要求的：一条主线+一堆小事。
    assert.ok(MAIN_PROMPT.includes('你就是这个世界本身'), '视角：模型是这个世界，不是旁观者/旁白');
    assert.ok(MAIN_PROMPT.includes('世界从来不只有一条线'), '开篇即立"多线"是世界本身的性质');
    assert.ok(MAIN_PROMPT.includes('每条主线都有它自己的轴'), '★"主线各有自己的轴"必须明写（用户口径）');
    assert.ok(MAIN_PROMPT.includes('三条主线如果全在讲同一件事的不同角度'), '★同题三线≠三线：必须点明这个假并行');
    assert.ok(MAIN_PROMPT.includes('起了一条线，就得准备接着写它'), '★主线要能连着走（治"几轮就没影的小事"）');
    assert.ok(MAIN_PROMPT.includes('有的正紧、有的刚起、有的快收尾'), '同时几条线在走，且各在不同的火候');
    assert.ok(MAIN_PROMPT.includes('有人正在办它 → 用 "event"'), '新线三由来之一：event（最结实的那种）');
    assert.ok(MAIN_PROMPT.includes('真没有任何人在办'), '新线三由来之三：只有真没人办才 state');
    assert.ok(MAIN_PROMPT.includes('那是失忆的写法'), '点明"每条都写 state"的后果（线没来路、接不上）');
    // ★旧口径不得回潮（"小事"框架正是"只有一条主线"的产物）
    assert.ok(!MAIN_PROMPT.includes('写他们各自的小事'), '旧"小事"措辞必须退场（leg39 换档）');
    assert.ok(!MAIN_PROMPT.includes('每轮至少起一件"与主线无关"的事'), '旧"与主线无关"措辞必须退场');
    // ★leg33c：位置口径改成**自由文本**（用户拍板「位置变成自由文本，位置集干脆删了」）——
    //   旧契约说"必须写位置集里的地名"，与引擎新口径（集外照收）**必须一致**，否则又在教模型自我审查。
    assert.ok(MAIN_PROMPT.includes('位置不是闸'), '铁律 3 必须明说"位置不是闸"（模型别自我审查）');
    assert.ok(MAIN_PROMPT.includes('也照写'), '铁律 3 必须允许写书里真有的别处地名');
    assert.ok(!MAIN_PROMPT.includes('位置必须来自输入的位置集'), '旧的"必须来自位置集"措辞不得回潮');
    // ★leg33 的成果一个字节没松：「（推）」注解照旧必须剥掉（那是引擎自己打的标记）
    assert.ok(MAIN_PROMPT.includes('北俱荒洲（推）'), '铁律 3 保留"写错的例子"（模型照抄实体表格子的形态）');
    assert.ok(MAIN_PROMPT.includes('必须把「（推）」去掉'), '铁律 3 保留"要去掉注解"');
    assert.ok(MAIN_PROMPT.includes('不是地名的一部分'), '铁律 3 保留注解与地名的区别');
    // H1（leg24 片3 起那个数已退场、且不随行入包 P3）：提示词不再拿分量说"谁值得动"
    assert.ok(!MAIN_PROMPT.includes('分量'), '提示词对模型不再提"分量"（模型看不到它——P3）');
    assert.ok(!MAIN_PROMPT.includes('分量与盘算决定谁值得动'), '旧铁律 5 措辞不得回潮');
    assert.ok(!MAIN_PROMPT.includes('实体/分量/盘算'), '输入清单不再含分量');
    assert.ok(MAIN_PROMPT.includes('谁值得动由你在名单内决定'), '铁律 5 改结构事实口径（在办的事/刚出过手/被点名）');
    assert.ok(MAIN_PROMPT.includes('手上有在办的事、刚出过手、被点名的那几位优先'));
    assert.ok(MAIN_PROMPT.includes('引擎只做门控与拦矛盾'));
    // leg25 c：四维浮点退出契约面——模板/铁律/字段说明里不得再出现任何一个旧属性名或 attrs 键
    assert.ok(!MAIN_PROMPT.includes('attrs'), 'attrs 已随四维一起退出提示词（该删就删，不换名续用）');
    assert.ok(!/stateChanges/.test(MAIN_PROMPT), 'stateChanges 整条已删（它改的就是那四个数）');
    for (const term of ['hardPower', 'office', 'network', 'intel']) {
        assert.ok(!MAIN_PROMPT.includes(term), `旧属性名「${term}」不得回潮（手拍值让"编的"像"算的"，design-core-leg23 §4①）`);
    }
    // 七组形状（actions/newEvents/agendaAdvances/newAgendas/agendaCancels/newEntities/entityFates）
    assert.ok(MAIN_PROMPT.includes('七组：actions / newEvents / agendaAdvances / newAgendas / agendaCancels / newEntities / entityFates'),
        '世界步=七组的形状声明在模板里');
    // K45：newEntities parent 形态纪律在字段说明
    assert.ok(MAIN_PROMPT.includes('parent=所属势力名（可省'), 'K45 parent 说明在模板');
    assert.ok(!MAIN_PROMPT.includes('席位上限全归引擎'), '席位上限措辞已废（K45）');
    // 铁律 4（leg25 c 改写）：引用必须真实存在——不再提 stateChanges
    assert.ok(MAIN_PROMPT.includes('actions 的 entity、agendaAdvances 的 agendaId 必须引用输入中存在的 id'),
        '铁律 4 只提 actions/agendaAdvances 两条引用纪律（stateChanges 已删）');
    // 铁律 8：ripples 只收实体 id，事件引用走 source.type=ripple + ref
    assert.ok(MAIN_PROMPT.includes('newEvents[].ripples 只收被波及的**实体 id**'));
    assert.ok(MAIN_PROMPT.includes('绝对不是事件引用'));
    // 字段说明同步
    assert.ok(MAIN_PROMPT.includes('newEvents[].ripples=被波及的**实体 id 列表**'));
    // ★leg29 告知面（用户令「事件波及也改成 15 个」+「写进提示词」）：上限必须出现在提示词里——
    //   改前 prompts/pack/tick/entity-lookup 四处一字未提，模型写超限只会撞"拒整步"、白烧一整轮。
    assert.ok(MAIN_PROMPT.includes(`一次事件的波及名单至多 1..${RIPPLE_TARGET_CAP} 人`),
        `铁律 8 必须写出波及上限真值（真源 RIPPLE_TARGET_CAP=${RIPPLE_TARGET_CAP}）`);
    //   且必须带上更早咬人的那道闸：涉及 = 属主 + 本步所有 action 的 entity/target + 波及名单 ≤15
    //   ⇒ 只写"至多 15 个"会诱导模型写出必被拒的条数（本次要防的正是这个）
    assert.ok(MAIN_PROMPT.includes('涉及的实体') && MAIN_PROMPT.includes('故一次事件的波及名单实际最多 14 人'),
        '铁律 8 必须写出「涉及 ≤15 ⇒ 波及实际最多 14 人」这条咬合（否则提示词在教模型撞闸）');
    assert.ok(MAIN_PROMPT.includes('超过任一条**整步会被拒**'), '超限后果（拒整步）必须如实交代');
    assert.ok(MAIN_PROMPT.includes('★**上限 15 人，且计入"单盘算一轮涉及 ≤15"⇒ 实际最多 14 人**'),
        '字段说明与铁律 8 同口径（同一条上限不许两处不一致）');
    // 模板示例仍是实体 id（防止示例被改成事件 id 而语义漂移）
    assert.ok(OUTPUT_TEMPLATE.includes('"ripples": ["e_dayu", "e_xie"]'));
    // K37：newEntities/entityFates 形状与提议权语义进模板
    assert.ok(OUTPUT_TEMPLATE.includes('"newEntities"') && OUTPUT_TEMPLATE.includes('"entityFates"'));
    assert.ok(MAIN_PROMPT.includes('可以提议新实体入局') && MAIN_PROMPT.includes('覆灭与否全归引擎复核'));
    // 模板实体示例里不再有 attrs 键（leg25 c：入局数值面整条删）
    assert.ok(!OUTPUT_TEMPLATE.includes('"attrs"'), 'OUTPUT_TEMPLATE 不再示范 attrs（入局数值面已删）');
    // ★leg34（用户令「把字段写回和模型主动查的接口做了吧，这个功能能顺便解决死亡可以带因复活」）：
    //   铁律 13 的**语义**必须进模板（不只是版本号升位）——四条约束各锁一句，缺一句就是"模型不知道会撞闸"。
    assert.ok(MAIN_PROMPT.includes('人会长、会变'), '铁律 13 存在');
    assert.ok(MAIN_PROMPT.includes('一轮最多 3 条'), '约束②：每轮条数上限写进提示词');
    // ★丙′ 案（用户拍板「location 可以放啊，只是给修改权而已」）：禁写面收窄到"引擎自己的账"——
    //   提示词必须跟新口径一致，否则模型要么白写（以为能改的没写）、要么不敢写（以为不能改的）
    assert.ok(MAIN_PROMPT.includes('这些栏不能改') && MAIN_PROMPT.includes('id / kind / name'),
        '禁写面要点名（id/kind/name + 引擎自己的账）');
    assert.ok(MAIN_PROMPT.includes('lastActiveTick') && MAIN_PROMPT.includes('fieldSource'),
        '★引擎自己的账（出手记录 / 出处凭据）要写明不许填——填了等于伪造出处');
    assert.ok(MAIN_PROMPT.includes('也能写一个**账上还没有的新名目**'), '★"可以写新栏"必须讲给模型（否则它不敢写"称号/心境/伤势"）');
    assert.ok(MAIN_PROMPT.includes('位置与种族也照这个来'), '★location/race 可改要写明（用户拍板放开的）');
    assert.equal(MAIN_PROMPT.includes('不能改 id / kind / name（改了等于换个人'), false, '旧的"只禁三个"口径不许残留');
    assert.ok(MAIN_PROMPT.includes('不能改玩家棋子'), '约束④：玩家不可改写进提示词（红线 1）');
    assert.ok(MAIN_PROMPT.includes('不能把 status 写成 "dead"'), '覆灭只走 entityFates 这条要讲明白（否则模型以为字段能杀人）');
    assert.ok(MAIN_PROMPT.includes('值写文本'), '约束⑤：文本值进提示词（四维浮点被删的同一条理由）');
    // ★复活的**唯一路径**必须写明"必须先发生一件提到他的事"——这是防"死而复生循环"的那把锁
    assert.ok(MAIN_PROMPT.includes('本回合新落账的事点到了他的名字') && MAIN_PROMPT.includes('复活只能挂在一件正在发生的事上'),
        '带因复活的口径进提示词（复活必须与"被重新点名"同轮）');
    assert.ok(MAIN_PROMPT.includes('departed'), '离场名册（departed）必须在提示词里交代——否则模型不知道可以带回谁');
    // ★leg34 修正：⑥「使用时再查」的**实现方式**不是"模型主动问"，而是"出包前检索、当轮随包递"
    //   （用户追问「…都是一轮解决的啊」）⇒ 提示词里要讲的是 `recalled` 这一段，且写明"书里没有的别编"。
    assert.ok(MAIN_PROMPT.includes('recalled'), '检索注入段（recalled）必须进提示词——否则模型不知道那段是书里原文');
    assert.ok(MAIN_PROMPT.includes('别自己编设定'), '配套口径：书里没有的细节不许编（引擎不发明事实）');
    assert.equal(MAIN_PROMPT.includes('fieldQueries'), false, '★"模型主动查"已撤，不许在提示词里回潮');
    // entityUpdates 是"可选的"要说清，免得模型以为七组之外还得硬凑
    assert.ok(MAIN_PROMPT.includes('这一组是**可选的**'), '可选性必须写明（缺席=本回合没有这件事）');
    assert.ok(OUTPUT_TEMPLATE.includes('"entityUpdates"'), '模板必须示范 entityUpdates 形状（模型照模板写）');
    assert.equal(OUTPUT_TEMPLATE.includes('"fieldQueries"'), false, '模板里也不许再示范已撤的那一组');
    assert.ok(!OUTPUT_TEMPLATE.includes('"stateChanges"'), 'OUTPUT_TEMPLATE 不再示范 stateChanges');
    assert.ok(MAIN_PROMPT.includes('dialogueBook=对话依据册'), '依据册段说明在模板（K38 补差包 C 条）');
    // init 路径可用
    assert.ok(assembleMainPrompt({ text: '测试输入' }).includes('测试输入'));
});

test('契约锁：源头语义句共存（plot/state/ripple 三源 + 无源之物不存在）', () => {
    assert.ok(MAIN_PROMPT.includes('事件必须有源'));
    assert.ok(MAIN_PROMPT.includes('无源之物不存在'));
});

// ---------- leg31：实体段行式表格（细案 docs/spec-entity-section-encoding.md）----------
// 本段锁三件：①模型读得到列义说明 ②行式块**零损失**（判据 D）③分隔符冲突**机械显形**（判据 C，不靠"我看过没问题"）
test('leg31·判据 D：pack 文本的实体段是行式表格，且逐格还原零损失', () => {
    const rows = [
        { id: 'e_a', kind: 'character', name: '甲', location: '未明', parent: '青云门', 实力: 'T2' },
        { id: 'e_b', kind: 'faction', name: '乙', location: '东海浮空岛', locationNote: '（推）', members: ['丙', '丁', '等9人'] },
        { id: 'e_c', kind: 'character', name: '戊' },
    ];
    const pack = { entities: rows, positions: ['未明'] };
    const text = packTextOf(pack);
    const back = JSON.parse(text);                                   // 往返性仍成立（整段换成一个字符串格）
    assert.equal(typeof back.entities, 'string', 'entities 那一格必须是行式块字符串');
    assert.ok(back.entities.startsWith(ENTITY_TABLE_HEADER), '首行必须是表头');
    assert.deepEqual(parseEntityTableBlock(back.entities), rows, '★行式块逐格还原 == 内部对象（零损失）');
    assert.ok(!text.includes('"kind":"character"'), '旧对象数组写法不得回潮（那正是本次要省的 56% 结构开销）');
});

test('leg31·判据 C：行内混入 TAB/换行 ⇒ 出包期自检必须报得出（不静默串列）', () => {
    const clean = [{ id: 'e_a', kind: 'character', name: '甲', location: '未明' }];
    assert.deepEqual(entityTableAnomalies(clean), [], '干净数据不得误报');
    const dirty = [{ id: 'e_b', kind: 'character', name: '带\t制表符的名字', location: '未明' }];
    assert.deepEqual(entityTableAnomalies(dirty), ['e_b'], '★值里含 TAB 必须显形（否则列会串位）');
    assert.deepEqual(entityTableAnomalies([{ id: 'e_c', name: '换\n行' }]), ['e_c'], '换行同样必须显形');
});

// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg32c（用户令「接着改主提示词吧，怎么让 llm 长跑起来前后能接得上」）：
//   病的实测（真账 tick 27）：预算只占 33%（余量 20,003 token），而模型**看不见 11 条已了结盘算中的任何一条**、
//   28 条已关闭事件只带最近 2 条 ⇒ **接不上不是预算不够，是根本没往下传**。
//   这三条锁要防的是"回潮"：谁把 `source` / `closedAgendas` 从包里摘掉、或把铁律 9 删掉，必须当场红。
// ＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝＝════
// ★leg32d（用户实机报错「⚠ 演算失败：$.newAgendas: 必填缺失; $.agendaCancels: 必填缺失;
//   $.newEntities: 必填缺失; $.entityFates: 必填缺失（世界原样未动，可重试）」）：
//   病因在契约层：`world-step.schema` 的顶层 `required` 是**七组全要**（`schemas/world-step.schema.js:9`），
//   而旧铁律 6 只写「没有任何新动作/新事件/变更就输出空数组」——模型读成"没有内容就省掉这一组"，
//   于是输出合法 JSON 但只剩它用到的三组 ⇒ `schema.js:20` 逐个报「必填缺失」⇒ **整步被拒、世界原样不动**。
//   判据写成**结构性**的：schema 顶层 required 的每一项，提示词里都必须明文要求"一个都不能少"。
//   ★这条锁的意义：以后谁改 schema 的 required、或谁把这段说明删了，必须当场红——不许再靠用户实机踩。
test('leg32d·契约锁：schema 顶层 required 的七组，提示词必须逐组要求"一个都不能少"', () => {
    const req = worldStepSchema.required;
    assert.deepEqual(req, ['actions', 'newEvents', 'agendaAdvances', 'newAgendas', 'agendaCancels', 'newEntities', 'entityFates'], 'schema 顶层 required（真源）');
    // ① 七个组名在提示词里都点名了
    for (const k of req) assert.ok(MAIN_PROMPT.includes(k), `提示词必须点名组名 ${k}`);
    // ② 明文要求"不能少/不许省键"，且给出空数组的写法
    assert.ok(MAIN_PROMPT.includes('七个组名一个都不能少'), '要有"一个都不能少"的明文');
    assert.ok(MAIN_PROMPT.includes('不许把键省掉'), '要明文禁止省键');
    assert.ok(MAIN_PROMPT.includes('空数组 []'), '要给出"空组写 []"的写法');
    // ③ 要如实交代后果（拒整步 / 世界原样不动）——否则模型不知道省键的代价
    assert.ok(MAIN_PROMPT.includes('世界原样不动'), '要如实交代"省键 ⇒ 整步被拒、世界原样不动"');
    // ④ 别把"可省"误伤到组名上：必须明说"可省"只管组内字段
    assert.ok(/可省[^。]*不适用于[^。]*七组/.test(MAIN_PROMPT), '要明说"可省"不适用于七组本身');
});

test('★★leg90·第 8b 条：事件标题**自带对象**（用户令：有就写、没就不写）', () => {
    // 病（用户实机看注入输出时一句话问出来的）：「**万魔之祖完成初步接引，聊天llm怎么知道是接引谁**」。
    //   查实：事件契约只有 id/title/source/position/ripples 五格，**没有"对象"这一格**
    //   ⇒ "接引谁"只可能活在**标题字符串**里，注入面怎么改都答不出来。故治在写入那一刻的措辞。
    assert.ok(MAIN_PROMPT.includes('事件标题（newEvents[].title）必须自带对象'), '★8b 条在位');
    assert.ok(MAIN_PROMPT.includes('知道对象就写进标题里'), '★正向：知道就写进去');
    assert.ok(MAIN_PROMPT.includes('不知道对象就不要编'), '★反向：不知道不要编（编出来的会被当成账上事实往下传）');
    // 要给出**可照抄的对照**（正反各一例），否则模型不知道"自带对象"长什么样
    assert.ok(MAIN_PROMPT.includes('完成初步接引血屠魔君'), '★正向例子在位（用户原话那一条）');
    assert.ok(MAIN_PROMPT.includes('不写「万魔之祖完成初步接引」'), '★反向例子在位（正是用户骂的那一句）');
    // 判据要可自检（把标题单独拎出来读）
    assert.ok(MAIN_PROMPT.includes('把标题单独拎出来'), '★给出可自检的判据（模型能自己核对）');
    // 字段说明里也要点名 title（模型啃长段落时也能看到）
    assert.ok(MAIN_PROMPT.includes('newEvents[].title=事件标题'), '★字段说明里点名 title 的写法');
    // 输出模板的示例要跟着改（示例是模型照抄的样板——留着"偏将整军出城"这种虚标题等于教它写虚的）
    assert.ok(OUTPUT_TEMPLATE.includes('偏将整军出城，把北门的守将换成了自己人'), '★模板示例自带对象');
    assert.ok(!OUTPUT_TEMPLATE.includes('"title": "偏将整军出城"'), '★旧虚标题示例不得回潮');
});

test('leg32c·铁律 9：长跑接得上（因果要有来路 / 同一件事不重开 / 世界是好几条线并排走）', () => {
    // ① 三条口径都在（判据写成"要点在不在"，不钉整句 —— 措辞可以改，要点不许丢）
    assert.ok(MAIN_PROMPT.includes('长跑：往下传的时候，因果要接得上'), '铁律 9 在位');
    assert.ok(MAIN_PROMPT.includes('事件要有来路'), '要交代"事件要有来路"');
    assert.ok(MAIN_PROMPT.includes('不要每件事都"由世界处境而生"'), '要防"每件都由处境而生"这种失忆写法');
    assert.ok(MAIN_PROMPT.includes('同一件事不要重开'), '要交代"同一件事不重开"');
    // ★leg39 换档：要点不变（世界多线并行），措辞升级——从"好几条**线**并排走"（预设只有一条主线）
    //   改成"**好几条主线**在并排走 + 每条有它自己的轴 + 同时三五十条各自在推进"。
    assert.ok(MAIN_PROMPT.includes('世界是好几条主线在并排走'), '要交代"世界是好几条主线在并排走"（变宽的杠杆在模型侧）');
    assert.ok(MAIN_PROMPT.includes('此刻世界上应该**有三五条各自在推进的事**'), '要给出"同时几条线在走"的量级');
    assert.ok(!MAIN_PROMPT.includes('世界是好几条线并排走'), '旧措辞（预设单主线的那版）不得回潮');
    assert.ok(MAIN_PROMPT.includes('玩家棋子只是其中一枚'), '玩家不是舞台中心（与铁律 5 同向）');
    // ② 铁律里点名了输入里的那三个字段/段——否则模型不知道该用哪块数据
    for (const k of ['agendas[].source', 'closedAgendas', 'recentClosedEvents']) {
        assert.ok(MAIN_PROMPT.includes(k), `铁律 9 必须点名输入里的 ${k}`);
    }
    // ③ 不许借"创作权"把已删的编数面带回来（口径纪律）
    assert.ok(!/可以编|随便编|自由发挥数值/.test(MAIN_PROMPT), '不许出现"可以编（数）"这类措辞');
});

// ★leg32e·铁律 11（小说家条款第一片）：**模型有让新人出场的权**——但三道硬闸一个字不能松。
//   为什么要锁：这是"世界变宽"的总闸（旧三型源 ⇒ 书上没写的人永远进不来）；
//   同时它最容易被误读成"可以随便造人/造数"，所以**权限与边界必须同时锁住**。
test('leg32e·铁律 11：新人出场权在位，且边界（不重名/每轮一个/只许往前长）同时锁住', () => {
    assert.ok(MAIN_PROMPT.includes('你可以让新人出场'), '铁律 11 在位');
    assert.ok(MAIN_PROMPT.includes('source.type="entity"'), '要讲清用哪一型（entity 源）');
    assert.ok(MAIN_PROMPT.includes('ref=') && MAIN_PROMPT.includes('一个在册实体'), '要讲清 ref 引的是在册实体');
    assert.ok(MAIN_PROMPT.includes('每轮最多出场一个'), '★硬上限要如实交代（超提会被丢）');
    assert.ok(MAIN_PROMPT.includes('不是布景'), '要写明出场者与原有实体同权（不是布景）');
    assert.ok(MAIN_PROMPT.includes('宁缺勿造'), '★反面锁：不许为热闹造人');
    // 契约面：第四型源在字段说明里也有（否则模型只知道铁律、不知道字段怎么写）
    assert.ok(MAIN_PROMPT.includes('entity=在册实体 id'), '字段说明要含 entity 源的 ref 写法');
});

// ★★leg32i（用户：「你是怎么保证不演用户的？」）：
//   认领主角之后（`e_p1` → e_42_1「黄坤」），模型**不知道那一行就是玩家** ⇒ 继续写
//   `actions[0].entity = e_42_1`、推进主角的盘算、还以主角为提议者塞人 ⇒ 三条红线同时被踩 ⇒ **整步被拒**
//   （用户贴回来的两条报错就是这个）。⇒ 光有"不许写玩家"的守卫不够，**得让模型看得见哪一行是玩家**：
//   实体表加 `player` 列（玩家那行写 `★你`），并在铁律 5 里写明四条禁令 + 那句"写世界怎么对它，不写它怎么做"。
test('leg32i·玩家标记：实体表里那一行必须一眼认出是玩家（否则模型必然继续演主角）', () => {
    const w = mkWorld({ entities: [ent('e_a', '甲', 'character'), ent('e_p', '黄坤', 'character')], events: [], tick: 3 });
    w.context.playerId = 'e_p';
    const p = buildEvolutionPack(w, null);
    const rows = p.pack.entities;
    assert.ok(ENTITY_TABLE_HEADER.split('\t').includes('player'), `表头必须有 player 列：${ENTITY_TABLE_HEADER}`);
    const marked = rows.filter((r) => r.player);
    assert.equal(marked.length, 1, `★只许给玩家那一行打标（实际 ${marked.length} 行）`);
    assert.equal(marked[0].id, 'e_p', '被标记的必须是玩家棋子本人');
    const text = packTextOf(p.pack);
    assert.ok(text.includes('★你'), '★包文本里必须看得见玩家标记（不是只挂在对象上）');
    assert.deepEqual(parseEntityTableBlock(JSON.parse(text).entities), rows, '加列后逐格还原仍零损失（判据 D 不许破）');
    assert.ok(MAIN_PROMPT.includes('player 列写着 ★你 的那一行就是玩家棋子'), '要点名表里的那一行');
    assert.ok(MAIN_PROMPT.includes('不能让它出手'), '要禁 actions');
    assert.ok(MAIN_PROMPT.includes('不能替它立线'), '要禁 newAgendas');
    assert.ok(MAIN_PROMPT.includes('一条都不许推'), '要禁推进它的盘算');
    assert.ok(MAIN_PROMPT.includes('你写"世界怎么对它"，不写"它怎么做"'), '要给出那句可记的口径');
});
// ★★leg32g·铁律 12（待启用名单）：治"永远围绕那几个势力"的最后一块——
//   引擎把"该轮到却没露过面的人"递到模型眼前，并**要求名单被真用掉**。
//   为什么要锁：这条是**唯一**能打断那个自锁闭环的东西（那几家出手 ⇒ 永远排镜头最前 ⇒ 模型总写他们）；
//   只喊"换镜头"没用（模型手上没有"该轮到谁"的名单），所以"名单"与"必须用掉"两件都得在。
test('leg32g·铁律 12：待启用名单在位，且要求"一轮至少用一个新名字"', () => {
    assert.ok(MAIN_PROMPT.includes('待启用名单'), '铁律 12 在位');
    assert.ok(MAIN_PROMPT.includes('idleFaces'), '要点名输入里的 idleFaces');
    assert.ok(MAIN_PROMPT.includes('轮着换'), '要讲清名单每轮轮换（不是固定一批）');
    assert.ok(MAIN_PROMPT.includes('不是背景板'), '要讲清他们是"被轮到的人"，不是布景');
    assert.ok(MAIN_PROMPT.includes('一轮至少让**一个新名字**真正出现在你的输出里'), '★核心要求：名单必须被用掉');
    assert.ok(MAIN_PROMPT.includes('一轮动用**一两个**就够'), '★反面锁：别把名单当任务清单全塞进去');
});
// ★leg32d·铁律 10：**点名是唯一的解锁机制**（真账实测：38 轮只有东海龙宫靠 t24 被点名而首次出场）。
//   为什么要锁：这是"世界变宽"**唯一被实测有效的路**（§5.7）——谁把这段删了，世界会退回"就那么几家一直演"。
//   反面也要锁：**不许**把"点名"写成"把人塞进波及名单"（那是噪声，不是因果）。
test('leg32d·铁律 10：世界变宽靠点名（点名 ⇒ 解锁 ⇒ 他下一轮能自己立线）', () => {
    assert.ok(MAIN_PROMPT.includes('怎么让世界变宽'), '铁律 10 在位');
    assert.ok(MAIN_PROMPT.includes('一次都没被点名过的人，永远出不了第一次手'), '要点破"没点名就没资格"这个死循环');
    assert.ok(MAIN_PROMPT.includes('被点到的人**下一轮就有资格自己行动'), '要讲清点名的**效果**（下一轮解锁）');
    assert.ok(MAIN_PROMPT.includes('再点一两个"会因此坐不住"的第三方'), '要给出可操作的做法（点会坐不住的第三方）');
    assert.ok(MAIN_PROMPT.includes('不是**把不相干的人塞进波及名单'), '★反面锁：点名 ≠ 塞不相干的人（防噪声）');
    assert.ok(MAIN_PROMPT.includes('不要整轮只演那两三家'), '要对"就那么几家一直演"给出直接指令');
});

test('leg32c·包面：在飞盘算带出生理由 + 已了结线台账 + 已关闭事件带源（三样都在包里）', () => {
    const w = mkWorld({
        entities: [ent('e_a', '甲', 'character'), ent('e_b', '乙', 'faction')],
        events: [
            { id: 'ev_1', title: '旧事', source: { type: 'state' }, position: '中央', closed: true },
            { id: 'ev_2', title: '新事', source: { type: 'plot', ref: 'a_now' }, position: '中央', closed: false },
        ],
        agendas: [
            { id: 'a_now', owner: 'e_a', goal: '在办的事', stage: 's', visibility: 'known', progress: 1, maxSteps: 3, closed: false, source: { type: 'event', ref: 'ev_1' }, memory: { turnsAlive: 1 } },
            { id: 'a_old', owner: 'e_b', goal: '办完的事', stage: 's', visibility: 'known', progress: 3, maxSteps: 3, closed: true, source: { type: 'state' } },
        ],
        tick: 5,
    });
    const p = buildEvolutionPack(w, null);
    // ① 在办之事的出生理由进包（旧版丢掉了 ⇒ 模型看得见"在办什么"、看不见"为什么起这件事"）
    assert.deepEqual(p.pack.agendas[0].source, { type: 'event', ref: 'ev_1' }, '★在飞盘算必须带出生理由');
    // ② 已了结的线进包（旧版一条都不带 ⇒ 三十轮后同一个人能重开同一件事而像失忆）
    assert.equal(p.pack.closedAgendas.length, 1, '★已了结盘算台账要有内容');
    assert.deepEqual(p.pack.closedAgendas[0], { id: 'a_old', owner: 'e_b', goal: '办完的事', source: { type: 'state' } }, '谁/办什么/因何而起三样');
    // ③ 已关闭事件带 source（旧版只带 id+title，且只带 2 条）
    assert.ok(p.pack.recentClosedEvents.some((e) => e.id === 'ev_1' && e.source?.type === 'state'), '★已关闭事件要带源');
    // ★★★leg100（甲案）：**归档那一栏必须自己带记号**（未裁剪那一态也要锁）。
    //   ★本笔的**反向自证当场咬出来的一处空绿**：这条断言我第一版写成 `[0].closed === true`，
    //     而这份夹具里**第一条事件是开着的**（`recentClosedEvents[0]` 其实是那条已了结的 `ev_1`——
    //     但断言写宽了：只要那一栏非空就过）⇒ 把产品的记号整个删掉，判据**照旧全绿**。
    //     ⇒ 定稿按"**每一条**都得带"来咬（`every` + 非空前置），空绿被堵死。
    assert.ok(p.pack.recentClosedEvents.length > 0, '前置：这份夹具里归档那一栏要有内容（否则下面是空绿）');
    assert.ok(p.pack.recentClosedEvents.every((e) => e.closed === true),
        '★归档那一栏**每一条**都要盖 `closed: true`（未裁剪那一态）');
    // ★同时咬反面：候选那一栏**不许**被盖上同一个记号（盖上＝把可动的事说成墓碑）
    assert.ok(p.pack.pendingEvents.every((e) => e.closed === undefined),
        '★候选那一栏不许带 `closed` 记号（两栏要真的分得开——这才是甲案的目的）');
    // ④ 包文本里真的看得见（不是只挂在对象上、序列化时又丢了）
    const text = packTextOf(p.pack);
    assert.ok(text.includes('closedAgendas') && text.includes('办完的事'), '台账必须真的序列化进包文本');
    assert.ok(text.includes('"source"'), '出生理由必须真的序列化进包文本');
    assert.ok(text.includes('"closed":true'), '★记号必须真的序列化进包文本（挂在对象上而在序列化时丢了 = 没做）');
});

// ═══════════════ ★★★leg100（甲案）：归档与候选必须在**给模型的资料**里分得开 ═══════════════
// 用户令「**可以按甲吧**」（甲 = 让两栏长得不一样，而不是只在报错里骂它一句）。
// 真机病（`docs/session-handoff-2026-09-21-leg100.md` §0 有完整取证）：模型**从 `recentClosedEvents`
//   那一栏挑了两个已了结的号**去收场（`ev_6_4`/`ev_7_2`，恰好是那份尾巴的头两条）——两栏此前
//   **形状完全一样**（都是 id+title+source），模型手上没有分辨"候选/墓碑"的尺子。
// ★★为什么判据必须咬"**裁剪后记号还在**"：`trimPack` 的 ③ 级原来只留 `{id}`（把 title/source 全丢掉），
//   而"**只剩一串光秃秃的号**"恰恰是最像候选池的形态（真账 `trimmed=null`，但真超预算时就会走到那一级）。
//   ⇒ 记号做成**独立一格**、并且裁剪时要**跟着留**；只咬未裁剪那一态 = 漏掉最危险的那一态。
test('★leg100：预算裁剪把归档裁到只剩 id 时，**"已了结"的记号也必须活着**（最危险的那一态）', () => {
    // ★为什么不靠"堆实体去逼预算"（我前两版都这么写，两次都被自己的**前置断言**拦下：
    //   `cut=["entities.slim"]` / `["entities.slim","entities.idOnly"]` —— 说明那份夹具**根本没走到 ③**）：
    //   那条路要**猜**多大的夹具才越界，够不够全看别处的常量，而且夹具越堆越慢（实测 48ms）。
    //   ⇒ 本用例要咬的那件事**与预算无关**，只与"③ 那一级做什么"有关 ⇒ 直接从**不变量**出发构造：
    //     把包摆成"已经降级到底"的那一态（实体只剩 id+name，而这一态**本身就超预算**），
    //     于是 ③ 成为**第一个真正要动的**那一级 —— 不用猜、也不会被前两级吃掉。
    //   ★尺寸怎么定的（**不猜**）：预算 `EVOLUTION_BUDGET_TOKENS = 30000`、`TOKEN_RATIO = 3`（中文）
    //     ⇒ 包文本要**超过 90000 字符**才越界。8000 个 `{id,name}` ≈ 120000 字符 ⇒ 稳过线，
    //     且下面那条前置断言会**当场**把"没越界"顶红（第一版 3000 个实测 `cut=[]`，正是被它拦下的）。
    const entities = Array.from({ length: 8000 }, (_, i) => ({ id: 'e_' + i, name: '角色' + i }));   // idOnly 形态
    const mk = () => ({
        world: '测试', tension: 0.5, positions: ['中央'],
        entities,
        agendas: [],
        pendingEvents: [{ id: 'ev_2_1', title: '还开着的一件事', source: { type: 'state' }, position: '中央' }],
        recentClosedEvents: Array.from({ length: 20 }, (_, i) => ({
            id: 'ev_1_' + i, title: '已经了结的事' + i, source: { type: 'ripple' }, closed: true,
        })),
        playerMove: null, dialogueBook: [],
        // 实体已是最瘦形态 ⇒ 前两级（slim / idOnly）压不动它 ⇒ ③ 才是第一个真正生效的级别
        __relight: () => entities,
    });
    assert.ok(Math.ceil(JSON.stringify(mk()).length / 3) > EVOLUTION_BUDGET_TOKENS,
        '前置：夹具必须真的超预算（否则本用例是空绿）');
    const p = mk();
    const cut = trimPack(p);
    assert.ok(cut.includes('recentClosedEvents'),
        `前置：必须真的裁到 recentClosedEvents（实际 cut=${JSON.stringify(cut)}）`);
    const row = p.recentClosedEvents[0];
    assert.ok(row, '前置：归档那一栏要有内容（否则下面全是空绿）');
    assert.deepEqual(Object.keys(row), ['id', 'closed'], `★记号必须跟着留：实际 ${JSON.stringify(row)}`);
    assert.equal(row.title, undefined, '前提：③ 确实把 title 丢掉了（正是"只剩号"那一态）');
    assert.ok(packTextOf(p).includes('"closed":true'), '★记号必须真的在**包文本**里（序列化后仍看得见）');
    assert.ok(p.pendingEvents.every((e) => e.closed === undefined),
        '★候选那一栏不许盖上"已了结"的记号（盖上就等于把可动的事说成墓碑）');
});

// ★★leg100：提示词必须把"记号是什么意思"**写给模型看**（记号本身不会自己说话——leg39 的教训：
//   "给名单不给资格＝名单空转"）。三条一起咬：点出栏名 · 点出记号 · 说出"别从那一栏拿号"这个禁令。
test('★leg100：提示词第 15 条必须把"归档不许当候选"写给模型（栏名 + 记号 + 禁令三样齐）', () => {
    assert.ok(MAIN_PROMPT.includes('recentClosedEvents'), '★必须点名那一栏（模型得知道是哪一栏）');
    assert.ok(MAIN_PROMPT.includes('closed'), '★必须把记号的字面写给模型（它看到的是 `"closed": true`）');
    assert.ok(MAIN_PROMPT.includes('别从那一栏拿号'), '★必须给出禁令（只说"那是归档"不够——leg39 那条教训）');
    assert.ok(MAIN_PROMPT.includes('pendingEvents'), '★必须同时点出**该从哪一栏挑**（两栏都要点到才对得上）');
    assert.ok(!MAIN_PROMPT.includes('还用不用接着提'), '★"太狠"的旧问法照旧不许回潮（leg95 那条锁不动）');
});

test('leg32c·不新造字段：已了结线台账**不报结局**（账上没有结局字段，宁可少报）', () => {
    // 为什么锁这条：`settle.js` 把"结清/变形/取消"写进**编年文本**，盘算上不存结局。
    //   ⇒ 想在包里报"结局"就必须新造字段（动 ssot schema + 旧账迁移），那是另一笔；
    //   在没造之前，包里**不许**出现"办成了/失败了"这类引擎判断（leg25 f 已把"达成"收回为"结清"）。
    const w = mkWorld({
        entities: [ent('e_b', '乙', 'faction')],
        events: [],
        agendas: [{ id: 'a_old', owner: 'e_b', goal: '办完的事', stage: 's', visibility: 'known', progress: 3, maxSteps: 3, closed: true, memory: { turnsAlive: 3 } }],
        tick: 5,
    });
    const p = buildEvolutionPack(w, null);
    assert.deepEqual(Object.keys(p.pack.closedAgendas[0]), ['id', 'owner', 'goal', 'source'], '台账只许这四格（多了就是新造字段）');
    const text = packTextOf(p.pack);
    for (const bad of ['达成', '败露', '结清', '成功', '失败']) {
        assert.ok(!text.includes(`"${bad}"`), `★不许在台账里报结局「${bad}」（引擎没有这个输入）`);
    }
});

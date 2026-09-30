// story-world-v2/src/undo-stack.js
// ★★leg41：**受控编辑 + 撤销栈**——这一层 v1 有、v2 从来没有。
//
// 为什么需要它（用户一句话点破："我看 v1 没有这些问题啊，而且还有撤销栈配合快照"）：
//   v1 的所有手动修改都走**一个受控入口**：先取"变更前的引用"，再应用纯函数，最后写回；
//   因为纯函数是**写时复制**（改的是副本），"变更前那份"永远不会被后续操作改到
//   ⇒ 撤销栈**只需存一个引用 + 一个操作名**，undo = 把那个引用写回存储。**零拷贝、零成本**。
//   v2 直接改存储、没有这一层 ⇒ 于是：①没有"变更前状态"可退，只能靠"事后抢回"打补丁
//   （而抢回会把别人刚写的更新整份回滚，成了新的破坏源）；②"点了没反应"无法自证；
//   ③参数反复被洗掉却查不出是哪一笔记的。
//
// 与 v1 `plugins/shared/undo-stack.js` 的关系（诚实交代）：
//   本文件是**按 v1 那套语义在 v2 里重写的等价实现**，不是符号链接/跨仓 import——
//   因为 `plugins/shared/` 不在本插件的部署目录内（ST 只服务插件目录下的文件），
//   跨插件相对路径 import 在浏览器里取不到。语义逐条对齐（合并连续同类编辑 / 无实质变更不入栈 /
//   undo 写回引用 / 上限滑窗），差异只有一条：**撤销回调是注入的**（v2 的"写回"要顺带走镜像与记账）。
//
// 分层：**纯逻辑层**（零 DOM / 零存储 / 零 Node 内建 —— 进 browser-compat 扫描面）。
//   存储读写一律由调用方以 `read/write` 注入 ⇒ Node 里可真跑判据。

/**
 * @param {object} deps
 * @param {() => object} deps.read       读当前值（返回**引用**；调用方须保证返回的是当次真源快照）
 * @param {(next:object) => void} deps.write 写回（受控入口：写存储 + 镜像 + 记账都在这里）
 * @param {(v:object) => string} [deps.serialize] 判"无实质变更"用（缺省 JSON.stringify）
 * @param {(line:string) => void} [deps.log]
 * @param {number} [deps.limit]
 */
export function createParamUndoStack({ read, write, serialize = (v) => JSON.stringify(v), log = () => {}, limit = 20 } = {}) {
    let stack = [];          // [{ value, label }]——value 是**变更前的引用**
    let onChange = null;

    const notify = () => {
        try { onChange?.({ canUndo: stack.length > 0, count: stack.length }); } catch (_) {}
    };
    const setChangeCallback = (fn) => { onChange = typeof fn === 'function' ? fn : null; };

    /**
     * 记一步"变更前状态"。
     * ★★leg41 续（**修掉的真缺陷**）：必须传入**调用方已经取好的"变更前"那份**，
     *   不许自己再 `read()` 一次——因为 `edit()` 的写回**可能已经发生**（`fn` 里就可能写存储，
     *   本仓 `set-param` 的受控编辑就是这么做的），此时再读只会读到**改完之后**的状态
     *   ⇒ 撤销栈记的是"新状态"，**撤销等于什么都没撤**（判据当场抓红：栈里存的是
     *   `{天时,张力推手}` 而不是 `{天时}`）。这个 bug 在 v1 里不存在，因为 v1 的 `edit`
     *   是"先 push、后 write"；这里改成传值，语义就与 v1 完全对齐了。
     * 同标签连续记会被合并（照 v1：如输入框逐次 input 只记最早那一步）。
     */
    function pushValue(label, value, scope = null) {
        const name = String(label || '编辑');
        const top = stack[stack.length - 1];
        if (top && top.label === name) return false;
        if (!value || typeof value !== 'object') return false;
        stack.push({ value, label: name, ...(scope ? { worldName: String(scope) } : {}) });
        if (stack.length > limit) stack.shift();      // 上限滑窗（丢最旧）
        notify();
        return true;
    }
    /**
     * ★★leg46（**判据当场抓出的真 bug**，比缺陷本身值钱）：`push` 以前只收一个 `label`——
     *   值是自己 `read()` 一次拿的。于是"**调用方已经取好变更前那份、显式传进来**"这条口径
     *   **根本没有入口**：多传的实参被静默丢掉，栈里存的是 `read()` 的结果。
     *   在 `param-hub` 里 `read` 是刻意注入的空函数（写回必须走它自己的事务）⇒ 栈里存的
     *   永远是 `{}` ⇒ **撤销 = 把真源清空**（比"撤销是空操作"更坏：它会删掉玩家的档位）。
     *   ⇒ 定稿：**`push(label, value, scope)` 显式值优先**，没给值才退回 `read()`。
     * @param {string} label 操作名
     * @param {object} [value] **变更前那份**（调用方已取好；不给才自己读）
     * @param {string} [scope] 这一步属于哪个世界/命名空间（调用方据此拒绝跨世界撤销）
     */
    function push(label, value, scope) {
        let v = value;
        if (v == null) {
            try { v = read(); } catch (_) { return false; }
        }
        return pushValue(label, v, scope);
    }

    /**
     * 受控编辑：**先记、再改、无实质变更则整体回退**（照 v1 `edit` 的语义）。
     * @param {string} label 操作名（进撤销栈与日志）
     * @param {(prev:object) => object} fn 纯函数：接收当前值，返回**新对象**（不许改入参）
     * @returns {{ ok:boolean, changed:boolean, reason?:string, next?:object }}
     */
    function edit(label, fn) {
        if (typeof fn !== 'function') return { ok: false, changed: false, reason: '不是函数' };
        let prev = null;
        try { prev = read(); } catch (err) { return { ok: false, changed: false, reason: `读取失败：${String(err?.message || err)}` }; }
        if (!prev || typeof prev !== 'object') prev = {};
        // ★先把"变更前"这份**冻住**（深拷一层）：`fn` 里可能就写存储、甚至把 prev 的对象并进去，
        //   不冻住的话撤销栈拿到的引用会被后来的写改掉（就是上面那个 bug 的另一半）。
        const before = { ...prev };
        let next = null;
        try { next = fn({ ...prev }); } catch (err) { return { ok: false, changed: false, reason: `编辑抛错：${String(err?.message || err)}` }; }
        if (!next || typeof next !== 'object') return { ok: false, changed: false, reason: '编辑没返回新值' };
        let same = false;
        try { same = serialize(next) === serialize(prev); } catch (_) { same = false; }
        if (same) return { ok: true, changed: false, reason: '无实质变更' };   // ★不入栈、不写盘（照 v1）
        // ★传"已取好的变更前那份"（不许再读一次：那时可能已经写过了）
        pushValue(label, before);
        try { write(next); } catch (err) {              // 写失败 ⇒ 把它从栈上摘掉（不许留一个"撤销到不存在的状态"）
            stack.pop(); notify();
            return { ok: false, changed: false, reason: `写回失败：${String(err?.message || err)}` };
        }
        log(`编辑：${String(label || '手动编辑')}（撤销栈 ${stack.length}/${limit} 步）`);
        return { ok: true, changed: true, next };
    }

    /** 撤销一步：把"变更前那份"写回存储。返回被撤销的操作名（无历史 ⇒ null）。 */
    function undo() {
        const entry = stack.pop();
        if (!entry) return null;
        try { write(entry.value); } catch (err) { stack.push(entry); notify(); log(`撤销失败：${String(err?.message || err)}`); return null; }
        notify();
        log(`撤销：${entry.label}`);
        return entry.label;
    }

    const canUndo = () => stack.length > 0;
    const count = () => stack.length;
    /** ★leg46：**只看栈顶**（不弹）——调用方要先拿"变更前那份"的引用去算它的世界归属，
     *  再决定要不要真的撤销（例如"换了世界 ⇒ 不许在这个世界的账上撤销别人的改动"）。 */
    const peek = () => (stack.length ? stack[stack.length - 1] : null);
    /** ★leg46：**只弹栈、不写回**——调用方要自己把那份写回去（例如 v2 的 `param-hub`：
     *  写回必须走它自己的事务"写存储 + 回读核对 + 镜像"，不能走这里的注入 `write`）。
     *  ★顺序纪律（判据抓过）：先 `peek` 拿引用 → 自己写 → 写成功了才 `pop`；
     *    写失败不许 pop（否则那一步历史凭空消失，撤销栈就少了一步）。 */
    const pop = () => {
        const entry = stack.pop() || null;
        if (entry) notify();
        return entry;
    };
    const clear = () => { if (!stack.length) return false; stack = []; notify(); return true; };
    /** ★leg41：**判据用的硬清**（`clear` 会因为"本来就空"而不通知，判据要的是一刀切干净）。
     *  也是"换聊天"时的正确动作：撤销栈只活在当前会话里。 */
    const reset = () => { stack = []; notify(); };

    return { push, edit, undo, peek, pop, canUndo, count, clear, reset, setChangeCallback, limit };
}

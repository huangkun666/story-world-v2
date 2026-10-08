// story-world-v2/src/diagnostics.js
// ★★★细案 Task 3：**有界内存的调试记录器**（零依赖、顶层无 DOM、不碰 console）。
//
// ＝＝ 它是什么（一句话）＝＝
//   一个**只住在内存里**的环形账：`record()` 记一条，最多留最近 `limit` 条（缺省 200），
//   `snapshot()` 按模块/级别读出来（克隆），`report(summary)` 出一份能下载的 JSON 报告，
//   `clear()` 清空。插件别处想留一行"发生了什么"，**只许走这里**——
//   这样"调试信息在哪、留多久、给谁看"只有一个答案。
//
// ＝＝ 为什么脱敏写在**记录时**（不是报告时）＝＝
//   如果只脱报告，`snapshot()` 那条路（设置面板每轮要读）就还揣着明文密钥；
//   记录时脱干净 ⇒ 内存里、面板上、报告里**三处同一份**，没有"哪条路忘了脱"的可能。
//   报告那一头仍会再脱一遍摘要（`summary` 是调用方现传的，没经过 record）。
//
// ＝＝ 脱敏的三条口径（照用户批的细案）＝＝
//   ① **键名**：apiKey/embedApiKey/key/authorization/password/token/secret 这一族（含 camelCase、
//      下划线、连字符写法）⇒ 整条值换成 `[已脱敏]`；
//   ② **文本里嵌的**：`Authorization: Bearer xxx`、`x-api-key: xxx`、`token=xxx` ⇒ **保形替换**
//      （`Bearer` 还看得见，换成 `[已脱敏]` 的只有那串值）；
//   ③ **URL**：查询串里的 `api_key=`/`token=`/… 换值；`https://user:pass@host` 的密码段换值。
//   ★★**例外**：`usageTokens` / `totalTokens` / `maxTokens` 这一族是**用量计数**，不是口令
//      ⇒ 一律原样保留（"token"这个词在里面是"数了多少个 token"）。
//      实现上靠**分词**（`usageTokens` → usage+tokens；`keywords` 只有一个词 ⇒ 不是密钥）
//      而不是"包含 token 就脱"，否则关键词列表（keywords）会被误伤。
//
// ＝＝ 有界（内存不许被日志撑爆）＝＝
//   · 条数：只留最近 `limit` 条（1..5000，缺省 200）；
//   · 单条：消息 ≤ 500 字、载荷里的单个字符串 ≤ 1000 字、嵌套 ≤ 8 层 ⇒ 截断处留 `…`（不假装是全文）。
//
// ＝＝ 接得住任何值（记录器绝不许把调用方带崩）＝＝
//   循环引用 → `[循环引用]`；函数/Symbol → `[函数]`/`[符号]`；DOM 节点 → `[DOM 节点]`；
//   Error → 摊成 {name,message,stack}；Date → ISO 串；大整数 → 字符串；超深 → `[层级过深]`。
//   `record()` 整体还包着 try/catch：真出了没料到的事就返回 null，**绝不抛**。

/** 缺省容量（细案：最近 200 条）。 */
export const DEFAULT_LIMIT = 200;
/** 容量上界（"有界内存"的硬保证：再要也不给）。 */
export const MAX_LIMIT = 5000;
/** 脱敏后的占位（面板与报告里看到的就是它）。 */
export const REDACTED = '[已脱敏]';
/** 消息上限（字）。 */
const MESSAGE_MAX = 500;
/** 载荷里单个字符串的上限（字）。 */
const TEXT_MAX = 1000;
/** 模块名上限（字）。 */
const MODULE_MAX = 60;
/** 嵌套上限（层）。 */
const MAX_DEPTH = 8;

const LEVEL_ALIAS = {
    info: 'info', log: 'info', debug: 'info', trace: 'info',
    warn: 'warn', warning: 'warn',
    error: 'error', err: 'error', fatal: 'error', critical: 'error',
};

/** 键名分词后**这些词**就是密钥（`apikey` 是连写时的那一格）。 */
const SECRET_SEGMENTS = new Set([
    'apikey', 'key', 'token', 'tokens', 'secret', 'secrets',
    'password', 'passwd', 'pwd', 'authorization', 'auth', 'bearer',
    'credential', 'credentials',
]);
/** 用量计数白名单：这些名字里的 token 是"数了多少个"，**不是口令**（细案点名 usageTokens/totalTokens）。 */
const COUNT_KEYS = new Set([
    'usagetokens', 'totaltokens', 'prompttokens', 'completiontokens', 'cachedtokens',
    'reasoningtokens', 'inputtokens', 'outputtokens', 'maxtokens', 'tokenlimit',
    'tokenbudget', 'tokencount', 'tokensused', 'tokenusage', 'contexttokens',
]);
/** 连写成一格的密钥名（分词分不出来的那一批）。 */
const COMPOUND_SECRET = /(apikey|secretkey|clientsecret|privatekey|accesstoken|authtoken|refreshtoken|idtoken|bearertoken|password|passwd)/;

// ---------- 文本脱敏（嵌在正文里的密钥） ----------
/** `Authorization: Bearer xxx` / `"authorization": "Bearer xxx"` ⇒ 保形替换。 */
const AUTH_HEADER_RE = /(\bauthorization\b["']?\s*[:=]\s*["']?\s*(?:bearer|basic|token)?\s*["']?)([^\s,;"'}]+)/gi;
/** 光秃秃的 `Bearer xxx` / `Basic xxx`（没有 Authorization 前缀时）。 */
const BEARER_RE = /\b(bearer|basic)\s+([A-Za-z0-9\-._~+/=]{8,})/gi;
/** URL 查询串里的密钥参数（`?api_key=…&x=1`：只换值，别的参数一个字不动）。 */
const URL_QUERY_RE = /([?&#](?:embed[_-]?api[_-]?key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|token|key|password|passwd|secret|authorization|signature)=)([^&#\s]+)/gi;
/** URL userinfo 的密码段（`https://user:pass@host`）。 */
const URL_USERINFO_RE = /(\/\/[^\s/@:]+):([^\s/@]+)@/g;
/** 自由文本里的 `名字=值` / `名字: 值` / `"名字":"值"`（名字必须是独立的词，`usageTokens` 不在此列）。 */
const KEYED_TEXT_RE = /(^|[^A-Za-z0-9_])((?:embed[_-]?api[_-]?key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|client[_-]?secret|authorization|bearer|token|secret|password|passwd|key))(\s*["']?\s*[:=]\s*["']?\s*)([^\s,;"'&}]+)/gi;

/** 键名归一（去掉所有非字母数字，转小写）：`X-Api-Key` → `xapikey`。 */
const normKey = (key) => String(key).replace(/[^A-Za-z0-9]+/g, '').toLowerCase();

/** 键名分词：`usageTokens` → [usage,tokens]；`api_key` → [api,key]；`keywords` → [keywords]。 */
const segmentsOf = (key) => String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());

/**
 * 这个**键名**是不是密钥？（一处口径，`redact()` 与测试都走它）
 * ★先查用量计数白名单：`usageTokens`/`totalTokens` 走到这里就返回 false。
 */
export function isSecretKey(key) {
    const n = normKey(key);
    if (!n) return false;
    if (COUNT_KEYS.has(n)) return false;
    if (segmentsOf(key).some((s) => SECRET_SEGMENTS.has(s))) return true;
    return COMPOUND_SECRET.test(n);
}

/** 超长截断（留 `…` 如实标注"这不是全文"）。 */
const clampText = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** 嵌在文本里的密钥保形替换（`Bearer` 这类方案名保留，只有值换掉）。 */
export function redactText(value) {
    let out = String(value);
    out = out.replace(AUTH_HEADER_RE, (m, head) => `${head}${REDACTED}`);
    out = out.replace(BEARER_RE, (m, scheme) => `${scheme} ${REDACTED}`);
    out = out.replace(URL_QUERY_RE, (m, head) => `${head}${REDACTED}`);
    out = out.replace(URL_USERINFO_RE, (m, head) => `${head}:${REDACTED}@`);
    // ★`Bearer`/`Basic` 这种"方案名"当值时不算泄漏（上面那条已经处理过真值了），原样留着，
    //   否则 `Authorization: Bearer sk-x` 会被这一步啃成 `Authorization: [已脱敏] sk-x`（越脱越漏）。
    // ★已经换过的那一格（值就是占位）同样原样留：**脱敏必须幂等**，
    //   否则第二遍会把 `[已脱敏]` 再啃掉半个括号（URL 里就成 `api_key=[已脱敏]]`）。
    out = out.replace(KEYED_TEXT_RE, (m, lead, name, sep, val) => {
        if (/^(?:bearer|basic|token)$/i.test(val)) return m;
        if (val.startsWith(REDACTED)) return m;
        return `${lead}${name}${sep}${REDACTED}`;
    });
    return out;
}

/** `__proto__` 这类键名不许走赋值（否则一个数据键能把原型改掉）。 */
const setKey = (obj, key, value) => {
    Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * 递归脱敏 + 克隆（一处口径；面板渲染摘要时复用同一把尺）。
 * ★**只读不写**：喂进来的对象一个字都不改，交出去的是一份新结构（无共享引用）。
 * ★任何值都接得住：循环/函数/Symbol/Error/Date/DOM 节点/超深/大整数——绝不抛。
 */
export function redact(value) {
    return walk(value, 0, new Set());
}

function walk(value, depth, seen) {
    const type = typeof value;
    if (value === null || value === undefined) return null;
    if (type === 'string') return clampText(redactText(value), TEXT_MAX);
    if (type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return String(value);
    if (type === 'function') return '[函数]';
    if (type === 'symbol') return '[符号]';
    if (type !== 'object') return String(value);
    if (depth >= MAX_DEPTH) return '[层级过深]';
    if (seen.has(value)) return '[循环引用]';
    seen.add(value);
    try {
        if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '[无效时间]';
        if (value instanceof Error) {
            return {
                name: String(value.name ?? '错误'),
                message: clampText(redactText(String(value.message ?? '')), TEXT_MAX),
                stack: clampText(redactText(String(value.stack ?? '')), 500),
            };
        }
        if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));
        if (value instanceof Map) {
            const out = {};
            for (const [k, v] of value) setKey(out, String(k), walk(v, depth + 1, seen));
            return out;
        }
        if (value instanceof Set) return Array.from(value, (item) => walk(item, depth + 1, seen));
        if (typeof value.nodeType === 'number') return '[DOM 节点]';   // 别人的 DOM 节点不许被我们遍历
        const out = {};
        let names = [];
        try { names = Object.keys(value); } catch (_) { return '[无法读取]'; }
        for (const name of names) {
            let raw;
            try { raw = value[name]; } catch (_) { raw = '[读取失败]'; }
            setKey(out, name, isSecretKey(name) ? REDACTED : walk(raw, depth + 1, seen));
        }
        return out;
    } catch (_) {
        return '[无法读取]';
    } finally {
        seen.delete(value);   // ★只把"祖先链"当环：兄弟位置重复出现的同一个对象照常各给一份
    }
}

/** 深层克隆（记录已经脱敏过，这里只保证"零共享引用"）。 */
function cloneDeep(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(cloneDeep);
    const out = {};
    for (const key of Object.keys(value)) setKey(out, key, cloneDeep(value[key]));
    return out;
}

const cloneRecord = (rec) => ({
    time: rec.time,
    module: rec.module,
    level: rec.level,
    message: rec.message,
    data: cloneDeep(rec.data),
});

/** 级别归一：只留 info/warn/error 三档（大小写与常见别名都认，字典外的落到 info）。 */
const normalizeLevel = (level) => LEVEL_ALIAS[String(level ?? '').trim().toLowerCase()] || 'info';

/** 模块名归一：空着就叫 `(未知)`（不许出现空模块——面板的下拉要靠它分组）。 */
const normalizeModule = (module) => {
    const text = String(module ?? '').trim();
    return text ? clampText(text, MODULE_MAX) : '(未知)';
};

/** 消息归一：不是字符串也变一行字（对象走 JSON，函数/Symbol 有名字）。 */
function toText(message) {
    if (typeof message === 'string') return message;
    if (message === null || message === undefined) return '';
    const type = typeof message;
    if (type === 'number' || type === 'boolean' || type === 'bigint') return String(message);
    if (type === 'symbol') return '[符号]';
    if (type === 'function') return '[函数]';
    try {
        const json = JSON.stringify(redact(message));
        if (json) return json;
    } catch (_) { /* 落到下面那条兜底 */ }
    try { return String(message); } catch (_) { return '[无法显示]'; }
}

/**
 * 造一只记录器（单例见文件末尾的 `diagnostics`）。
 * @param {{limit?:number}} [options] 容量（缺省 200；非正数/非数字落回缺省，正数封顶 5000）
 * @returns {{record:Function, snapshot:Function, clear:Function, report:Function, limit:number, size:Function}}
 */
export function createDiagnostics({ limit = DEFAULT_LIMIT } = {}) {
    const wanted = Math.floor(Number(limit));
    const LIMIT = Number.isFinite(wanted) && wanted > 0 ? Math.min(wanted, MAX_LIMIT) : DEFAULT_LIMIT;
    const list = [];
    const listeners = new Set();
    let notifying = false;
    function notify() {
        if (notifying) return;
        notifying = true;
        try { for (const fn of [...listeners]) { try { fn(); } catch (_) {} } }
        finally { notifying = false; }
    }

    /**
     * 记一条。★**绝不抛**：值再怪也接得住，真出了没料到的事返回 null。
     * @param {string} module 来源模块（net/store/inject/...）
     * @param {string} level  info | warn | error（别名与大小写都认）
     * @param {string} message 一行字（超长截断）
     * @param {*} [data] 载荷（递归脱敏 + 克隆；缺省 null）
     * @returns {object|null} 存进去的那条（克隆）；失败 null
     */
    function record(module, level, message, data = null) {
        try {
            const rec = {
                time: Date.now(),
                module: normalizeModule(module),
                level: normalizeLevel(level),
                message: clampText(redactText(toText(message)), MESSAGE_MAX),
                data: data === null || data === undefined ? null : redact(data),
            };
            list.push(rec);
            if (list.length > LIMIT) list.splice(0, list.length - LIMIT);   // 只留最近 LIMIT 条
            notify();
            return cloneRecord(rec);
        } catch (_) {
            return null;
        }
    }

    /**
     * 读出来（克隆：改这一份动不了仓）。空串/空值 = 不过滤。
     * @param {{module?:string, level?:string}} [filters]
     * @returns {Array<{time:number,module:string,level:string,message:string,data:*}>}
     */
    function snapshot(filters = {}) {
        const wantModule = String(filters?.module ?? '');
        const wantLevel = String(filters?.level ?? '');
        const out = [];
        for (const rec of list) {
            if (wantModule && rec.module !== wantModule) continue;
            if (wantLevel && rec.level !== wantLevel) continue;
            out.push(cloneRecord(rec));
        }
        return out;
    }

    /** 清空（返回清掉几条——调用方要如实知道"本来就空"与"清掉了"是两件事）。 */
    function clear() {
        const removed = list.length;
        list.length = 0;
        notify();
        return removed;
    }

    /**
     * 出一份报告（JSON 字符串，给复制/下载用）。
     * ★摘要那一头也要递归脱敏（它是调用方现传的，没经过 `record`）。
     */
    function report(summary = {}) {
        const records = snapshot();
        const safeSummary = summary === null || summary === undefined ? {} : redact(summary);
        const doc = {
            title: 'Story World v2 调试报告',
            generatedAt: new Date().toISOString(),
            limit: LIMIT,
            count: records.length,
            summary: safeSummary,
            records,
        };
        try {
            return JSON.stringify(doc, null, 2);
        } catch (_) {
            return JSON.stringify({
                title: 'Story World v2 调试报告',
                generatedAt: new Date().toISOString(),
                limit: LIMIT,
                count: 0,
                summary: {},
                records: [],
                error: '报告序列化失败',
            });
        }
    }

    function subscribe(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.add(fn);
        return () => listeners.delete(fn);
    }
    return { record, snapshot, clear, report, subscribe, limit: LIMIT, size: () => list.length };
}

/** 插件共用的那一只（设置面板、网络与存储那几处都记到它上面）。 */
export const diagnostics = createDiagnostics();

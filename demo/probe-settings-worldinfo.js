// story-world-v2/demo/probe-settings-worldinfo.js
// 第十九棒：探查浏览器端挂载世界的磁盘真相——settings.json 的 extension_settings.world_info
// （键/globalSelect/各世界条目数/与 worlds 文件内容指纹对比）+ 大荒z 聊天头 chat_metadata.world_info。
// 用法：node demo/probe-settings-worldinfo.js
import { readFileSync } from 'node:fs';
import { bookFingerprint } from '../src/fingerprint.js';
import { composeInitSource } from '../src/init-source.js';

const SETTINGS = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/settings.json';
const CHAT = 'F:/jiuguanai/SillyTavern-Launcher/SillyTavern/data/default-user/chats/大荒z/大荒z - 2026-09-01@00h37m41s559ms.jsonl';

// 聊天头挂载
try {
    const raw = readFileSync(CHAT, 'utf8');
    const first = JSON.parse(raw.slice(0, raw.indexOf('\n')));
    console.log('chat_metadata.world_info =', JSON.stringify(first?.chat_metadata?.['world_info']));
    console.log('chat metadata keys =', Object.keys(first?.chat_metadata || {}).join(', '));
} catch (e) { console.log('chat probe fail:', e.message); }

// settings.json 世界表
try {
    const s = JSON.parse(readFileSync(SETTINGS, 'utf8'));
    console.log('settings.json size =', (await import('node:fs')).statSync(SETTINGS).size);
    const wi = s?.extension_settings?.world_info;
    console.log('extension_settings.world_info type =', wi ? (Array.isArray(wi) ? 'array' : typeof wi) : 'NONE');
    if (wi && typeof wi === 'object' && !Array.isArray(wi)) {
        const keys = Object.keys(wi);
        console.log('world_info keys =', keys.join(', ') || '(empty)');
        console.log('globalSelect =', JSON.stringify(wi.globalSelect));
        for (const k of keys) {
            if (k === 'globalSelect') continue;
            const w = wi[k];
            const ents = w?.entries;
            const list = Array.isArray(ents) ? ents : (ents && typeof ents === 'object' ? Object.values(ents) : null);
            if (list) {
                const res = composeInitSource({ character: null, worldInfoEntries: list });
                const fp = res.ok ? bookFingerprint(res.text) : 'n/a';
                console.log(`  [${k}] entries=${list.length} composedChars=${res.ok ? res.usedChars : '-'} fp=${fp}`);
            } else console.log(`  [${k}] entries: none`);
        }
    }
} catch (e) { console.log('settings probe fail:', e.message); }
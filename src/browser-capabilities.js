// Standard browser capabilities only; HTTP hosts do not need subtle, randomUUID or Workers.
import {sha256,bytesToHex} from '../vendor/world-memory.js';
export function sha256Hex(value) {
    if(typeof value==='string')value=new TextEncoder().encode(value);
    if(!(value instanceof Uint8Array))throw new TypeError('SHA-256 input must be a string or Uint8Array');
    return bytesToHex(sha256(value));
}
export function operationId(cryptoProvider=globalThis.crypto) {
    if(typeof cryptoProvider?.getRandomValues!=='function')throw new Error('Browser capability missing: crypto.getRandomValues');
    const bytes=new Uint8Array(16);cryptoProvider.getRandomValues(bytes);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=bytesToHex(bytes);
    return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}
export function browserCapabilities(environment=globalThis) {
    const capabilities={indexedDB:typeof environment.indexedDB?.open==='function'&&!!environment.IDBKeyRange,
        fetch:typeof environment.fetch==='function',secureRandom:typeof environment.crypto?.getRandomValues==='function'};
    const missing=[];
    if(!capabilities.indexedDB)missing.push('IndexedDB');if(!capabilities.fetch)missing.push('fetch');if(!capabilities.secureRandom)missing.push('crypto.getRandomValues');
    return {...capabilities,ok:missing.length===0,missing};
}
export function assertBrowserCapabilities(environment=globalThis) {
    const result=browserCapabilities(environment);
    if(!result.ok)throw new Error('Browser capability missing: '+result.missing.join(', '));
    return result;
}

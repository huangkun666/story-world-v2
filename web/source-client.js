import { ServiceError } from './service-client.js';

function canonicalJson(value) {
    const ordered = item => Array.isArray(item) ? item.map(ordered)
        : item && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map(k => [k, ordered(item[k])])) : item;
    return JSON.stringify(ordered(value));
}

// 资料候选和世界推进各有自己的操作身份；配对凭据只在请求头中使用。
export class SourceServiceClient {
    #base; #token; #fetch;
    constructor(baseUrl, pairingToken, { fetch: fetcher = globalThis.fetch } = {}) {
        const url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new ServiceError('服务地址无效');
        }
        if (typeof pairingToken !== 'string' || !pairingToken) throw new ServiceError('缺少服务配对凭据');
        this.#base = url.href.replace(/\/$/, ''); this.#token = pairingToken; this.#fetch = fetcher;
    }

    #id(value) {
        if (typeof value !== 'string' || !value.trim()) throw new ServiceError('资料身份无效');
        return encodeURIComponent(value);
    }

    #library(libraryId) { return `/libraries/${this.#id(libraryId)}`; }
    #import(libraryId, importId) { return this.#library(libraryId) + `/imports/${this.#id(importId)}`; }

    #version(value) {
        if (!Number.isSafeInteger(value) || value < 0) throw new ServiceError('资料版本无效');
    }

    #check(result, libraryId, importId = null) {
        const match = row => row && row.library_id === libraryId && (importId == null || row.import_id === importId);
        if (!match(result) || (result.receipt && !match(result.receipt))) throw new ServiceError('资料服务返回身份不匹配');
        return result;
    }

    async #request(path, { method = 'GET', body, signal } = {}) {
        const response = await this.#fetch(this.#base + '/v1' + path, {
            method, signal, headers: { Authorization: 'Bearer ' + this.#token,
                ...(body == null ? {} : { 'Content-Type': 'application/json' }) },
            ...(body == null ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) throw new ServiceError(`资料服务请求失败（${response.status}）`, response.status);
        try { return await response.json(); } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new ServiceError('资料服务响应尚未确认', null, true);
        }
    }

    async #writeImport(libraryId, importId, path, body, options = {}, verifyRecovered = null) {
        try {
            return this.#check(await this.#request(path, { ...options, method: 'POST', body }), libraryId, importId);
        } catch (error) {
            if ((error instanceof ServiceError && !error.uncertain) || error?.name === 'AbortError') throw error;
            try {
                const result = await this.getImport(libraryId, importId);
                if (!verifyRecovered || !await verifyRecovered(result)) throw new ServiceError('资料操作尚未确认', null, true);
                return result;
            }
            catch { throw new ServiceError('资料操作结果尚未确认，请核对同一导入任务', null, true); }
        }
    }

    async connect({ signal, rulesFingerprint = null } = {}) {
        const result = await this.#request('/health', { signal });
        if (result.source_contract_version !== 1 || result.contract_version !== 1 || result.data_version !== 1
            || result.rules_contract_version !== 1
            || (rulesFingerprint != null && result.rules_fingerprint !== rulesFingerprint)) {
            throw new ServiceError('资料服务与插件契约不兼容');
        }
        return result;
    }

    async createLibrary(libraryId, options = {}) {
        return this.#check(await this.#request('/libraries', { ...options, method: 'POST', body: { library_id: libraryId } }), libraryId);
    }

    async getLibrary(libraryId, options = {}) {
        const result = this.#check(await this.#request(this.#library(libraryId), options), libraryId);
        this.#version(result.version);
        return result;
    }

    async beginImport(libraryId, input, options = {}) {
        this.#id(input?.import_id);
        return this.#writeImport(libraryId, input.import_id, this.#library(libraryId) + '/imports', input, options, async () => {
            const original = await this.getImportInput(libraryId, input.import_id);
            return original.extractor_key === input.extractor_key && canonicalJson(original.entries) === canonicalJson(input.entries);
        });
    }

    async getImport(libraryId, importId, options = {}) {
        return this.#check(await this.#request(this.#import(libraryId, importId), options), libraryId, importId);
    }

    async getImportInput(libraryId, importId, options = {}) {
        return this.#check(await this.#request(this.#import(libraryId, importId) + '/input', options), libraryId, importId);
    }

    async claim(libraryId, importId, sourceId, options = {}) {
        // An uncertain claim must be inspected before any extractor request is issued.
        const result = this.#check(await this.#request(this.#import(libraryId, importId)
            + `/items/${this.#id(sourceId)}/claim`, { ...options, method: 'POST' }), libraryId, importId);
        if (result.source_id !== sourceId || typeof result.content_hash !== 'string' || !result.content_hash
            || typeof result.attempt_id !== 'string' || !result.attempt_id) {
            throw new ServiceError('资料请求返回来源不匹配');
        }
        return result;
    }

    async saveCandidate(libraryId, importId, sourceId, input, options = {}) {
        return this.#writeImport(libraryId, importId, this.#import(libraryId, importId)
            + `/items/${this.#id(sourceId)}/candidate`, input, options, async result => {
                if (result.items?.find(item => item.source_id === sourceId)?.status !== 'succeeded') return false;
                const candidate = await this.getCandidate(libraryId, importId, sourceId);
                return candidate.content_hash === input.content_hash && candidate.attempt_id === input.attempt_id
                    && canonicalJson(candidate.records) === canonicalJson(input.records)
                    && canonicalJson(candidate.graph_ids) === canonicalJson(input.graph_ids ?? {});
            });
    }

    async getCandidate(libraryId, importId, sourceId, options = {}) {
        const result = this.#check(await this.#request(this.#import(libraryId, importId)
            + `/items/${this.#id(sourceId)}/candidate`, options), libraryId, importId);
        if (result.source_id !== sourceId) throw new ServiceError('资料候选返回来源不匹配');
        return result;
    }

    async retry(libraryId, importId, sourceId, options = {}) {
        return this.#writeImport(libraryId, importId, this.#import(libraryId, importId)
            + `/items/${this.#id(sourceId)}/retry`, undefined, options,
            result => result.items?.find(item => item.source_id === sourceId)?.status === 'pending');
    }

    async cancel(libraryId, importId, options = {}) {
        return this.#writeImport(libraryId, importId, this.#import(libraryId, importId) + '/cancel', undefined, options,
            result => ['cancelled', 'published'].includes(result.status));
    }

    async publish(libraryId, importId, input, options = {}) {
        this.#version(input?.expected_version);
        const omitted = input.omitted_source_ids ?? [];
        if (!Array.isArray(omitted) || omitted.some(s => typeof s !== 'string' || !s) || new Set(omitted).size !== omitted.length) {
            throw new ServiceError('缺失来源名单无效');
        }
        const result = await this.#writeImport(libraryId, importId, this.#import(libraryId, importId) + '/publish', input, options,
            result => result.status === 'published');
        const receipt = result.receipt ?? result;
        if (result.status != null && result.status !== 'published') {
            throw new ServiceError('资料发布结果尚未确认，请核对同一导入任务', null, true);
        }
        if (receipt.version !== input.expected_version + 1 || receipt.expected_version !== input.expected_version
            || !Array.isArray(receipt.omitted_source_ids)
            || JSON.stringify([...receipt.omitted_source_ids].sort()) !== JSON.stringify([...omitted].sort())) {
            throw new ServiceError('资料发布返回版本或缺失来源不匹配');
        }
        return receipt;
    }

    async getVersion(libraryId, version, options = {}) {
        this.#version(version);
        const result = this.#check(await this.#request(this.#library(libraryId) + `/versions/${version}`, options), libraryId);
        if (result.version !== version) throw new ServiceError('资料服务返回版本不匹配');
        return result;
    }

    async executeImport(libraryId, importId, options = {}) {
        return this.#writeImport(libraryId, importId, this.#import(libraryId, importId) + '/execute', undefined, options,
            result => result.status === 'published' || result.execution?.running === true
                || (result.items?.length > 0 && result.items.every(item => item.status === 'succeeded'))
                || (result.execution?.attempts?.length > 0 && result.execution.attempts.some(attempt =>
                    result.items?.some(item => item.attempt_id === attempt.attempt_id))));
    }

    async searchVersion(libraryId, version, input, options = {}) {
        this.#version(version);
        if (version === 0 || typeof input?.query !== 'string' || !input.query.trim()
            || !Number.isSafeInteger(input.max_chars) || input.max_chars < 0) throw new ServiceError('资料查询无效');
        const result = this.#check(await this.#request(this.#library(libraryId) + `/versions/${version}/search`,
            { ...options, method: 'POST', body: input }), libraryId);
        if (result.version !== version) throw new ServiceError('资料检索返回版本不匹配');
        if (result.purpose !== 'source-world') throw new ServiceError('资料检索返回用途不匹配');
        return result;
    }

    async getIndex(libraryId, version, options = {}) {
        this.#version(version);
        const result = this.#check(await this.#request(this.#library(libraryId) + `/versions/${version}/index`, options), libraryId);
        if (result.version !== version) throw new ServiceError('资料索引返回版本不匹配');
        return result;
    }

    async initializeVersion(libraryId, version, input, options = {}) {
        try { input = JSON.parse(JSON.stringify(input)); }
        catch { throw new ServiceError('资料初始化输入无效'); }
        this.#version(version);
        if (version === 0 || !input || typeof input.options !== 'object' || input.options === null || Array.isArray(input.options)) {
            throw new ServiceError('资料初始化输入无效');
        }
        const worldPath = `/worlds/${this.#id(input.world_id)}/branches/${this.#id(input.branch_id)}?revision=0`;
        const matches = receipt => receipt?.world_id === input.world_id && receipt.branch_id === input.branch_id
            && receipt.revision === 0 && receipt.source?.library_id === libraryId && receipt.source.version === version
            && Array.isArray(receipt.source.omitted_source_ids);
        let result;
        try {
            result = await this.#request(this.#library(libraryId) + `/versions/${version}/initialize`,
                { ...options, method: 'POST', body: input });
        } catch (error) {
            if ((error instanceof ServiceError && !error.uncertain) || error?.name === 'AbortError') throw error;
            try {
                const saved = await this.#request(worldPath);
                const original = saved?.world?.meta?.sourceInitialization;
                const publication = saved?.world?.meta?.sourcePublication;
                if (saved.world_id !== input.world_id || saved.branch_id !== input.branch_id || saved.revision !== 0
                    || original?.world_id !== input.world_id || original.branch_id !== input.branch_id
                    || original.library_id !== libraryId || original.version !== version
                    || canonicalJson(original.options) !== canonicalJson(input.options)
                    || publication?.library_id !== libraryId || publication.version !== version
                    || !Array.isArray(publication.omitted_source_ids)) throw new Error('unconfirmed');
                result = { world_id: input.world_id, branch_id: input.branch_id, revision: 0,
                    source: { library_id: libraryId, version, omitted_source_ids: publication.omitted_source_ids } };
            } catch { throw new ServiceError('资料初始化结果尚未确认，请核对原世界', null, true); }
        }
        if (!matches(result)) throw new ServiceError('资料初始化返回身份或版本不匹配');
        return result;
    }

    async getSource(libraryId, sourceId, contentHash, options = {}) {
        const result = this.#check(await this.#request(this.#library(libraryId)
            + `/sources/${this.#id(sourceId)}/${this.#id(contentHash)}`, options), libraryId);
        if (result.source_id !== sourceId || result.content_hash !== contentHash) throw new ServiceError('资料服务返回来源版本不匹配');
        return result;
    }
}

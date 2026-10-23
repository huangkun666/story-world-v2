// 服务连接只返回绑定原世界的回执；正式世界写入由服务事务负责。
export class ServiceError extends Error {
    constructor(message, status = null, uncertain = false) {
        super(message); this.name = 'ServiceError'; this.status = status; this.uncertain = uncertain;
    }
}

export class WorldServiceClient {
    #base; #token; #fetch;
    constructor(baseUrl, pairingToken, { fetch: fetcher = globalThis.fetch } = {}) {
        const url = new URL(baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new ServiceError('服务地址无效');
        }
        if (typeof pairingToken !== 'string' || !pairingToken) throw new ServiceError('缺少服务配对凭据');
        this.#base = url.href.replace(/\/$/, ''); this.#token = pairingToken; this.#fetch = fetcher === globalThis.fetch ? fetcher.bind(globalThis) : fetcher;
    }

    async #request(path, { method = 'GET', body, signal } = {}) {
        const response = await this.#fetch(this.#base + '/v1' + path, {
            method, signal, headers: { Authorization: 'Bearer ' + this.#token,
                ...(body == null ? {} : { 'Content-Type': 'application/json' }) },
            ...(body == null ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) throw new ServiceError(`世界服务请求失败（${response.status}）`, response.status);
        try { return await response.json(); } catch (error) {
            if (error?.name === 'AbortError') throw error;
            throw new ServiceError('世界服务响应尚未确认', null, true);
        }
    }

    #scope(pointer) {
        if (!pointer || !['world_id', 'branch_id'].every(k => typeof pointer[k] === 'string' && pointer[k])) {
            throw new ServiceError('缺少正式世界身份');
        }
        return `/worlds/${encodeURIComponent(pointer.world_id)}`;
    }

    #check(result, pointer, operationId = null) {
        const check = row => row && row.world_id === pointer.world_id && row.branch_id === pointer.branch_id
            && (operationId == null || row.operation_id === operationId);
        if (!check(result) || (result.receipt && !check(result.receipt))) throw new ServiceError('世界服务返回身份不匹配');
        return result;
    }

    async connect({ signal, rulesFingerprint = null } = {}) {
        const result = await this.#request('/health', { signal });
        if (result.contract_version !== 1 || result.rules_contract_version !== 1 || result.data_version !== 1
            || (rulesFingerprint != null && result.rules_fingerprint !== rulesFingerprint)) {
            throw new ServiceError('世界服务与插件契约不兼容');
        }
        return result;
    }

    async getWorld(pointer, { revision = null, signal } = {}) {
        if (revision != null && (!Number.isSafeInteger(revision) || revision < 0)) throw new ServiceError('世界版本无效');
        const path = this.#scope(pointer) + `/branches/${encodeURIComponent(pointer.branch_id)}`
            + (revision == null ? '' : `?revision=${revision}`);
        return this.#check(await this.#request(path, { signal }), pointer);
    }

    async getObservation(pointer, input, { signal } = {}) {
        if (!Number.isSafeInteger(input?.revision) || input.revision < 0) throw new ServiceError('世界版本无效');
        if (typeof input.query !== 'string' || !input.query.trim() || !Number.isSafeInteger(input.max_chars) || input.max_chars < 0) {
            throw new ServiceError('聊天观察参数无效');
        }
        const path = this.#scope(pointer) + `/branches/${encodeURIComponent(pointer.branch_id)}/observe`;
        const result = this.#check(await this.#request(path, { method: 'POST', body: input, signal }), pointer);
        if (result.revision !== input.revision) throw new ServiceError('聊天观察返回版本不匹配');
        if (result.purpose !== 'chat' || typeof result.text !== 'string') throw new ServiceError('聊天观察返回用途不匹配');
        return result;
    }

    async getOperation(pointer, operationId, { signal } = {}) {
        return this.#check(await this.#request(this.#scope(pointer) + `/operations/${encodeURIComponent(operationId)}`, { signal }), pointer, operationId);
    }

    async startTurn(pointer, input, { signal } = {}) {
        const path = this.#scope(pointer) + `/branches/${encodeURIComponent(pointer.branch_id)}/turns`;
        try {
            return this.#check(await this.#request(path, { method: 'POST', body: input, signal }), pointer, input.operation_id);
        } catch (error) {
            if ((error instanceof ServiceError && !error.uncertain) || error?.name === 'AbortError') throw error;
            // A lost response may already have committed. Query; never start a second generation.
            try { return await this.getOperation(pointer, input.operation_id); }
            catch { throw new ServiceError('推进结果尚未确认，请重新连接后核对同一操作'); }
        }
    }

    async cancel(pointer, operationId, { signal } = {}) {
        return this.#check(await this.#request(this.#scope(pointer) + `/operations/${encodeURIComponent(operationId)}/cancel`,
            { method: 'POST', signal }), pointer, operationId);
    }

    async continueLimited(pointer, operationId, { signal } = {}) {
        return this.#check(await this.#request(this.#scope(pointer) + `/operations/${encodeURIComponent(operationId)}/continue-limited`,
            { method: 'POST', signal }), pointer, operationId);
    }

    async restore(pointer, input, { signal } = {}) {
        const receipt = await this.#request(this.#scope(pointer) + '/restore', { method: 'POST', body: input, signal });
        return this.#check(receipt, { world_id: pointer.world_id, branch_id: input.target_branch }, input.operation_id);
    }
}

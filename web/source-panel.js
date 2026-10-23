const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const phases = {pending:'等待执行',requested:'请求尚未确认',succeeded:'已有候选',failed:'失败，可明确重试',unknown:'结果尚未确认'};

export function renderSourcePanel() {
    return '<div class="sw2-set-card" data-source-panel><h4>资料导入</h4>'
        + '<p>使用上方世界服务连接。选择完整 JSON 原稿后，分别登记、执行、核对候选和明确发布。来源更新不会改变已建立的世界。</p>'
        + '<p>原稿格式：JSON 数组，每项包含 source_id、content 和 metadata；也可提供含 entries 数组的对象。原文完整保留。</p>'
        + '<label>资料库编号<input class="sw2-input" data-source-library></label>'
        + '<label>导入编号<input class="sw2-input" data-source-import></label>'
        + '<label>完整原稿文件<input class="sw2-input" data-source-file type="file" accept=".json,application/json"></label>'
        + '<div class="sw2-row"><button class="sw2-btn" data-source-register>登记完整原稿</button>'
        + '<button class="sw2-btn" data-source-execute>执行此导入</button><button class="sw2-btn" data-source-check>核对进度与候选</button>'
        + '<button class="sw2-btn" data-source-cancel>停止此导入</button></div>'
        + '<div data-source-details></div><button class="sw2-btn" data-source-publish>明确发布此资料版</button>'
        + '<p>以本任务发布的固定资料版建立新世界，再单独连接。初始化选项为 JSON 对象。</p>'
        + '<label>新世界编号<input class="sw2-input" data-source-world></label>'
        + '<label>新分支编号<input class="sw2-input" data-source-branch></label>'
        + '<label>初始化选项<textarea class="sw2-input" data-source-options rows="4" placeholder="例如：{&quot;worldName&quot;:&quot;新世界&quot;}"></textarea></label>'
        + '<div class="sw2-row"><button class="sw2-btn" data-source-initialize>从固定资料版建立新世界</button>'
        + '<button class="sw2-btn" data-source-attach>连接新世界</button></div><p data-source-status>尚未登记资料任务</p></div>';
}
function renderDetails(data) {
    if (!data) return '<p>尚未载入资料任务</p>';
    const row = data.import, entries = data.input.entries;
    const items = entries.map(entry => row?.items?.find(item => item.source_id === entry.source_id) ?? {source_id:entry.source_id,status:'pending'});
    const selected = entries.find(entry => entry.source_id === data.selected_source_id) ?? entries[0];
    const candidate = data.candidates?.[selected.source_id];
    return '<p>资料库：'+esc(data.library_id)+' · 导入：'+esc(data.input.import_id)+'</p>'
        + (data.action ? '<p>此任务有尚未确认的动作，请核对原任务。</p>' : '')
        + '<label>核对来源<select class="sw2-input" data-source-selected>'
        + entries.map(entry => '<option value="'+esc(entry.source_id)+'"'+(entry.source_id === selected.source_id ? ' selected' : '')+'>'+esc(entry.source_id)+'</option>').join('')+'</select></label>'
        + '<ul>'+items.map(item => '<li>'+esc(item.source_id)+'：'+esc(phases[item.status] ?? '等待核对')
            + (item.status === 'failed' ? ' <button class="sw2-btn" data-source-retry="'+esc(item.source_id)+'">明确重试此来源</button>' : '')+'</li>').join('')+'</ul>'
        + '<h5>完整原稿 · '+esc(selected.source_id)+'</h5><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:24em;overflow:auto">'+esc(selected.content)+'</pre>'
        + '<h5>原稿附属信息</h5><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(selected.metadata,null,2))+'</pre>'
        + '<h5>完整候选记录</h5><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:24em;overflow:auto">'
        + (candidate ? esc(JSON.stringify(candidate.records,null,2)) : '尚无已确认候选；请执行后核对进度。')+'</pre>'
        + (data.publication ? '<p>资料版本：'+esc(data.publication.version)+'；缺失来源：'+esc(data.publication.omitted_source_ids.join('、') || '无')+'</p>'
            : '<p>发布前请逐项确认缺失来源。未勾选全部缺失项时不会发布。</p>'+items.filter(item => item.status !== 'succeeded').map(item =>
                '<label><input type="checkbox" data-source-omit value="'+esc(item.source_id)+'">明确允许本资料版缺失：'+esc(item.source_id)+'</label>').join(''))
        + (data.initialization ? '<p>已建立新世界：'+esc(data.initialization.pointer.world_id)+' / '+esc(data.initialization.pointer.branch_id)+' · 版本 0；来源资料版 '+esc(data.initialization.receipt.source.version)+'</p>' : '');
}
export function createSourcePanel({session,onStatus = () => {}}) {
    const find = win => win?.querySelector('#sw2_view_settings .sw2-settings')?.querySelector('[data-source-panel]');
    function refresh(win) {
        const card = find(win);if (!card) return;
        const read = key => card.querySelector('[data-source-'+key+']'), data = session.readout();
        if (card._sw2SourceScope !== session.scope) {
            card._sw2SourceScope = session.scope;
            for (const key of ['library','import','file','world','branch','options']) {const field = read(key);if (field) field.value = ''}
            if (read('status')) read('status').textContent = data ? '请核对原资料任务' : '尚未登记资料任务';
        }
        if (data) {
            read('library').value = data.library_id;read('import').value = data.input.import_id;
            if (data.initialization) {
                read('world').value = data.initialization.input.world_id;read('branch').value = data.initialization.input.branch_id;
                read('options').value = JSON.stringify(data.initialization.input.options,null,2);
            } else if (data.action?.kind === 'initialize') {
                read('world').value = data.action.input.world_id;read('branch').value = data.action.input.branch_id;
                read('options').value = JSON.stringify(data.action.input.options,null,2);
            }
        }
        const detail = read('details');if (detail) detail.innerHTML = renderDetails(data);
    }
    function bind(win) {
        const pane = win?.querySelector('#sw2_view_settings .sw2-settings');if (!pane) return;
        let card = pane.querySelector('[data-source-panel]');
        if (!card) {pane.insertAdjacentHTML('beforeend',renderSourcePanel());card = pane.querySelector('[data-source-panel]')}
        if (!card) return;
        if (card._sw2SourceBound) {refresh(win);return}
        card._sw2SourceBound = true;card._sw2SourceScope = session.scope;refresh(win);
        const read = key => card.querySelector('[data-source-'+key+']');
        async function invoke(fn,button = null) {
            const scope = session.scope;if (button) button.disabled = true;
            try {
                const result = await fn(scope);if (scope !== session.scope) return;
                const text = result?.stale ? '聊天或连接已改变，请核对原任务' : result?.cancelled ? '资料导入已停止'
                    : result?.pending ? '资料动作尚未完成，请核对原任务' : result?.ok ? result.attached ? '新世界已连接'
                    : result.initialized ? '新世界已建立，请单独连接' : result.publication ? '资料已发布，版本 '+result.publication.version
                    : '资料任务已核对' : result?.error ?? '资料动作尚未确认';
                refresh(win);read('status').textContent = text;onStatus(text);
            } catch(error) {if (scope === session.scope) {read('status').textContent = String(error.message);onStatus(String(error.message))}}
            finally {if (button) button.disabled = false}
        }
        card.addEventListener('click',async event => {
            const button = event.target?.closest('button');if (!button || !card.contains(button)) return;
            await invoke(async scope => {
                if (button.hasAttribute('data-source-register')) {
                    const saved = session.readout();let entries;
                    const library_id = read('library').value, import_id = read('import').value, file = read('file').files?.[0];
                    if (file) {
                        const text = await file.text();if (scope !== session.scope) return {ok:false,stale:true};
                        let original;try {original = JSON.parse(text)} catch {throw Error('原稿文件不是有效 JSON')}
                        entries = Array.isArray(original) ? original : original?.entries;
                    } else if (saved?.library_id === library_id && saved.input.import_id === import_id) entries = saved.input.entries;
                    else throw Error('请选择完整 JSON 原稿文件');
                    return session.register({library_id,import_id,entries});
                }
                if (button.hasAttribute('data-source-execute')) return session.execute();
                if (button.hasAttribute('data-source-check')) return session.reconcile();
                if (button.hasAttribute('data-source-cancel')) return session.cancel();
                if (button.hasAttribute('data-source-publish')) return session.publish({omitted_source_ids:[...card.querySelectorAll('[data-source-omit]')].filter(field => field.checked).map(field => field.value)});
                if (button.hasAttribute('data-source-initialize')) {
                    let options;try {options = JSON.parse(read('options').value)} catch {throw Error('请填写有效的初始化选项 JSON 对象')}
                    return session.initialize({world_id:read('world').value,branch_id:read('branch').value,options});
                }
                if (button.hasAttribute('data-source-attach')) return session.attachWorld();
                if (button.hasAttribute('data-source-retry')) return session.retry(button.getAttribute('data-source-retry'));
            },button);
        });
        card.addEventListener('change',async event => {
            if (event.target?.hasAttribute?.('data-source-selected')) await invoke(() => session.selectSource(event.target.value));
        });
    }
    return {bind,refresh};
}

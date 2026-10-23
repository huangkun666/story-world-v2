const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function renderServicePanel({url='',active=false,pointer=null}={}) {
    return '<div class="sw2-set-card" data-service-panel><h4>世界服务</h4>'
        +'<p>选择已建立的服务世界。已有存档继续保留；这里不会迁移存档。</p>'
        +'<label>服务地址<input class="sw2-input" data-service-url type="url" value="'+esc(url)+'"></label>'
        +'<label>配对凭据<input class="sw2-input" data-service-token type="password" autocomplete="off" placeholder="填写或保留当前凭据"></label>'
        +'<label>世界编号<input class="sw2-input" data-service-world value="'+esc(pointer?.world_id)+'"></label>'
        +'<label>分支编号<input class="sw2-input" data-service-branch value="'+esc(pointer?.branch_id)+'"></label>'
        +'<label>版本<input class="sw2-input" data-service-revision type="number" min="0" step="1" value="'+esc(pointer?.revision??'')+'"></label>'
        +'<div class="sw2-row"><button class="sw2-btn" data-service-connect>连接此世界</button>'
        +'<button class="sw2-btn" data-service-check>核对本轮结果</button>'
        +'</div>'
        +'<p data-service-status>'+ (active?'已选用服务世界':'尚未选用服务世界')+'</p></div>';
}
export function createServicePanel({host,getCtx,onStatus=()=>{}}) {
    function bind(win){
        const pane=win?.querySelector('#sw2_view_settings .sw2-settings');if(!pane)return;
        let card=pane.querySelector('[data-service-panel]');
        if(!card){pane.insertAdjacentHTML('beforeend',renderServicePanel(host.config()));card=pane.querySelector('[data-service-panel]')}
        if(!card || card._sw2ServiceBound)return;card._sw2ServiceBound=true;
        card.addEventListener('click',async event=>{
            const button=event.target?.closest('button');if(!button || !card.contains(button))return;
            const read=key=>card.querySelector('[data-service-'+key+']')?.value??'';
            button.disabled=true;
            try {
                let result;
                if(button.hasAttribute('data-service-connect')){
                    const token=read('token')||getCtx()?.extensionSettings?.story_world_v2?.servicePairingToken;
                    const revision=read('revision');if(revision==='')throw new Error('请填写版本');
                    host.configure({url:read('url'),pairingToken:token});
                    result=await host.session.attach({world_id:read('world'),branch_id:read('branch'),revision:Number(revision)});
                } else if(button.hasAttribute('data-service-check'))result=await host.session.reconcile();
                else if(button.hasAttribute('data-service-cancel'))result=await host.session.cancel();
                else if(button.hasAttribute('data-service-limited'))result=await host.session.continueLimited();
                if(result){const text=result.ok?'世界已核对':result.cancelled?'本轮已停止':result.pending?'本轮尚未完成，请稍后核对':result.error??'本轮尚未确认';onStatus(text);card.querySelector('[data-service-status]').textContent=text}
            }catch(error){onStatus(error.message);card.querySelector('[data-service-status]').textContent=error.message}
            finally{button.disabled=false}
        });
    }
    return {bind};
}

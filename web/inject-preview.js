import {openPanelDialog} from './panel-dialog.js';
const opened=new WeakMap();
export function closeInjectPreviews(doc){for(const view of opened.get(doc)??[])view.close({force:true});opened.delete(doc);}
export function openInjectPreview(doc,texts=null){
 const t=texts??{},parts=[['tags','格式指令'],['scene',t.path==='service'?'当前状态与动向':'世界动向'],['ledger','相关历史']];
 const version=t.revision??t.pointer?.revision;
 const stamp=t.at&&!Number.isNaN(new Date(t.at).getTime())?new Date(t.at).toLocaleString():'';
 const views=opened.get(doc)??new Set();opened.set(doc,views);
 const view=openPanelDialog(doc,{onClose:()=>views.delete(view),title:'注入预览',subtitle:'上次实际写入'+(version==null?'':' · 第 '+version+' 版')+(stamp?' · '+stamp:'')+' · 全文只读'});
 views.add(view);view.overlay.setAttribute('data-inject-dialog','');
 const tabs=doc.createElement('div');tabs.className='sw2-review-tabs';tabs.setAttribute('role','tablist');view.body.before(tabs);
 const content=doc.createElement('pre');content.className='sw2-inject-fulltext';view.body.append(content);
 const status=doc.createElement('p');status.className='sw2-hint';status.textContent='打开预览不会重新注入或调用模型；遗漏提示按原文显示。';view.footer.append(status);
 for(const [key,label]of parts){
  const value=t[key]==null?'':String(t[key]),button=doc.createElement('button');button.className='sw2-btn';button.type='button';button.setAttribute('role','tab');button.setAttribute('data-inject-tab',key);button.textContent=label+' · '+value.length+' 字';
  button.onclick=()=>{for(const b of tabs.children)b.setAttribute('aria-selected',String(b===button));content.textContent=value||(!parts.some(([k])=>t[k])?'未注入：尚无实际写入内容。':'这一段这次没有内容');content.setAttribute('data-inject-text',key);view.body.scrollTop=0;};
  tabs.append(button);if(key==='scene')button.click();
 }
 tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...tabs.children],i=buttons.indexOf(doc.activeElement),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;buttons[next].click();buttons[next].focus();});
 return view;
}

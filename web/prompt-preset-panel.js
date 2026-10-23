import {readPromptPresets,validatePromptPresets,promptPresetEditorValue} from '../src/prompt-presets.js';
import {renderPromptPresets} from '../src/render-prompt-presets.js';
import {openPanelDialog} from './panel-dialog.js';
const copy=value=>JSON.parse(JSON.stringify(value));
export function createPromptPresetPanel({getWin=()=>null,getSettings,saveConfig,onStatus=()=>{}}={}) {
 let config=null,saved=null,selectedId='',error='',notice='',pending=null,signature=null,dialog=null,serial=0;
 const windows=new WeakSet();
 function identify(prefix){let id;do{id=prefix+'-'+Date.now().toString(36)+'-'+(++serial).toString(36);}while(config?.presets.some(p=>p.id===id||p.messages.some(m=>m.id===id)));return id;}
 function dirty(){return config!==null&&JSON.stringify(config)!==JSON.stringify(saved);}
 function read(){
  if(pending||dirty())return;
  try{const next=readPromptPresets(getSettings?.()),sig=JSON.stringify(next);if(signature!==sig){config=next;saved=copy(next);signature=sig;if(!next.presets.some(p=>p.id===selectedId))selectedId=next.presets[0]?.id??'';error='';}}
  catch(e){config=null;saved=null;error='读取提示预设失败：'+e.message;}
 }
 function preset(){return config?.presets.find(p=>p.id===selectedId);}
 function state(){read();return {config:config?copy(config):null,selectedId,dirty:dirty(),saving:!!pending,error,notice};}
 function refresh(){const node=getWin()?.querySelector?.('[data-prompt-preset-panel]');if(node)node.outerHTML=renderPromptPresets(state());}
 function changed(){error='';notice='';}
 function setBinding(purpose,id){read();if(!config||!['abstract','simulate'].includes(purpose)||id&&!config.presets.some(p=>p.id===id))return;config.bindings[purpose]=id;changed();}
 function editPreset(id){read();if(config?.presets.some(p=>p.id===id))selectedId=id;}
 function updatePreset(patch){
  read();const p=preset();if(!p)return;
  if(Object.hasOwn(patch,'name'))p.name=patch.name;
  if(Object.hasOwn(patch,'content')&&promptPresetEditorValue(p).editable)p.messages[0].content=patch.content;
  changed();
 }
 function createPreset(){read();if(!config)return null;const id=identify('preset');config.presets.push({id,name:'新预设',messages:[{id:identify('prompt'),name:'预设正文',role:'system',content:'',enabled:true},{id:'task',task:true}]});selectedId=id;changed();return id;}
 function deletePreset(id=selectedId){if(!config)return;config.presets=config.presets.filter(p=>p.id!==id);for(const purpose of ['abstract','simulate'])if(config.bindings[purpose]===id)config.bindings[purpose]='';if(selectedId===id)selectedId=config.presets[0]?.id??'';changed();}
 function undo(){if(!saved||pending)return;config=copy(saved);if(!preset())selectedId=config.presets[0]?.id??'';changed();}
 function save(){
  if(pending)return pending;read();if(!config)return Promise.resolve(false);
  let snapshot;try{snapshot=validatePromptPresets(config);if(typeof saveConfig!=='function')throw Error('没有可用的设置保存入口');}
  catch(e){error='保存失败：'+e.message;onStatus(error);refresh();return Promise.resolve(false);}
  pending=(async()=>{
   // 先让 pending 完成赋值，保存入口同步抛错也能正确结束等待状态。
   await Promise.resolve();
   try{
    const result=await saveConfig(copy(snapshot));saved=copy(snapshot);signature=JSON.stringify(snapshot);error='';
    notice=result?.queued?'已应用，已交给酒馆保存；持久保存结果以酒馆提示为准'+(dirty()?'；后续修改尚未保存':''):dirty()?'已保存提交时的内容；后续修改尚未保存':'已保存，下一次新请求使用这份设置';
    onStatus(notice);return true;
   }catch(e){error='保存失败：'+e.message+'；草稿仍保留';onStatus(error);return false;}
   finally{pending=null;refresh();}
  })();refresh();return pending;
 }
 function expand(){
  const doc=getWin()?.ownerDocument,p=preset();if(!doc||!p)return;const id=p.id,value=promptPresetEditorValue(p);
  dialog?.close();const d=openPanelDialog(doc,{title:value.editable?'展开编辑预设':'查看旧版预设',subtitle:value.editable?'应用后保留在草稿中，再点击“保存修改”提交。':'旧版内容只读保留，发送方式不变；可新建一份预设后切换。',onClose:()=>{dialog=null;}});dialog=d;d.dialog.classList.add('sw2-preset-dialog');
  const field=doc.createElement('textarea');field.className='sw2-input sw2-preset-expanded';field.setAttribute('aria-label','展开预设内容');field.value=value.content;field.readOnly=!value.editable;field.spellcheck=false;d.body.append(field);
  const cancel=doc.createElement('button');cancel.className='sw2-btn';cancel.textContent='取消';cancel.onclick=()=>d.close();d.footer.append(cancel);
  if(value.editable){const apply=doc.createElement('button');apply.className='sw2-btn sw2-primary';apply.textContent='应用到草稿';apply.onclick=()=>{const target=config?.presets.find(p=>p.id===id);if(target&&promptPresetEditorValue(target).editable){target.messages[0].content=field.value;changed();}d.close();refresh();};d.footer.append(apply);}
  field.focus();
 }
 const action=fn=>(payload={})=>{fn(payload);refresh();};
 const actions={'preset-save':()=>save(),'preset-undo':action(()=>undo()),'preset-edit':action(p=>editPreset(config?.bindings[p.purpose])),'preset-new':action(()=>createPreset()),'preset-delete':action(()=>deletePreset()),'preset-expand':()=>expand()};
 function syncDirty(){const node=getWin()?.querySelector?.('[data-prompt-preset-panel]');if(!node)return;const line=node.querySelector('.sw2-preset-status');if(line)line.textContent=error||notice||(dirty()?'有未保存修改':'尚无未保存修改');const undoButton=node.querySelector('[data-action="preset-undo"]');if(undoButton)undoButton.disabled=!!pending||!dirty();}
 function bind(win=getWin()){
  read();if(!win||windows.has(win))return;windows.add(win);
  function field(event){const el=event.target;if(!el?.closest?.('[data-prompt-preset-panel]'))return;if(el.hasAttribute('data-preset-field'))updatePreset({[el.getAttribute('data-preset-field')]:el.value});syncDirty();}
  win.addEventListener('input',field);
  win.addEventListener('change',event=>{const el=event.target;if(!el?.closest?.('[data-prompt-preset-panel]'))return;if(el.hasAttribute('data-preset-binding')){setBinding(el.getAttribute('data-preset-binding'),el.value);refresh();}else if(el.hasAttribute('data-preset-library')){editPreset(el.value);refresh();}else field(event);});
 }
 read();return {renderState:state,bind,actions,setBinding,editPreset,updatePreset,createPreset,deletePreset,undo,save};
}

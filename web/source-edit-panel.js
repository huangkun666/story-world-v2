import {ssotSchema} from '../src/schemas/ssot.schema.js';
import {sourceProfileValueSchema} from '../src/schemas/source-edit.schema.js';
import {readSourceEntityDraft,editableSourceSettings,sourceEditJson} from '../src/source-edit.js';

const copy=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={name:'名号',aliases:'别名',fields:'属性',location:'档案中的所在',society:'社会格局',techOrMagic:'力量体系',historyNotes:'史略',rules:'法则',situation:'基础形势',powerScale:'档位表',dims:'维度',level:'档位',note:'含义',range:'范围'};
const labelOf=key=>labels[key]??key;
const encoded=path=>esc(JSON.stringify(path));
const own=(obj,key)=>Object.hasOwn(obj??{},key);
const schemaOf=key=>ssotSchema.props.context.props.setting.props.frozen.props.canon.props[key];
function inferred(value){return {kind:Array.isArray(value)?'array':value!==null&&typeof value==='object'?'object':typeof value,additional:true,items:{kind:'string'},props:{}}}
function seed(schema){
 if(schema.kind==='array')return [];
 if(schema.kind==='object'){const value={};for(const key of schema.required??[])Object.defineProperty(value,key,{value:seed(schema.props[key]),enumerable:true,writable:true,configurable:true});return value}
 if(schema.kind==='strRecord'||schema.kind==='numRecord')return {};
 if(['number','boolean'].includes(schema.kind))return null;
 return '';
}
function field(value,schema,path,label){
 schema??=inferred(value);const attr='data-source-edit-path="'+encoded(path)+'"';
 if(schema.kind==='array'){
  const rows=(value??[]).map((item,i)=>'<details class="sw2-source-nested"><summary>'+esc((typeof item==='object'&&(item?.名??item?.name??item?.level))||'第 '+(i+1)+' 项')+'</summary>'+field(item,schema.items,[...path,i],label+' / '+(i+1))+'<button class="sw2-btn" type="button" data-source-remove="'+encoded([...path,i])+'">移除此项</button></details>').join('');
  return '<fieldset class="sw2-source-field"><legend>'+esc(label)+'</legend>'+rows+'<button class="sw2-btn" type="button" data-source-add-array="'+encoded(path)+'">添加条目</button></fieldset>';
 }
 if(['object','strRecord','numRecord'].includes(schema.kind)){
  const object=value??{},map=schema.kind!=='object';
  const rows=Object.entries(object).map(([key,item])=>{
   const inner=field(item,schema.props?.[key]??(map?{kind:schema.kind==='numRecord'?'number':'string'}:inferred(item)),[...path,key],map?'属性内容':labelOf(key));
   if(!map)return inner;
   return '<div class="sw2-source-map-row"><label>属性名<input class="sw2-input" data-source-map-key="'+encoded([...path,key])+'" value="'+esc(key)+'"></label>'+inner+'<button type="button" class="sw2-btn" data-source-remove="'+encoded([...path,key])+'">移除属性</button></div>';
  }).join('');
  const missing=Object.keys(schema.props??{}).filter(k=>!own(object,k));
  const add=map?'<button type="button" class="sw2-btn" data-source-add-map="'+encoded(path)+'">添加属性</button>':
   missing.length?'<label>补充字段<select class="sw2-input" data-source-property-choice="'+encoded(path)+'">'+missing.map(k=>'<option value="'+esc(k)+'">'+esc(labelOf(k))+'</option>').join('')+'</select></label><button type="button" class="sw2-btn" data-source-add-property="'+encoded(path)+'">添加字段</button>':'';
  return '<fieldset class="sw2-source-field"><legend>'+esc(label)+'</legend>'+rows+add+'</fieldset>';
 }
 if(schema.enum)return '<label class="sw2-source-field">'+esc(label)+'<select class="sw2-input" '+attr+'><option value="">请选择</option>'+schema.enum.map(v=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>';
 if(schema.kind==='boolean')return '<label class="sw2-source-field">'+esc(label)+'<select class="sw2-input" '+attr+' data-source-type="boolean"><option value="">请选择</option><option value="true"'+(value===true?' selected':'')+'>是</option><option value="false"'+(value===false?' selected':'')+'>否</option></select></label>';
 if(schema.kind==='number')return '<label class="sw2-source-field">'+esc(label)+'<input class="sw2-input" type="number" '+attr+' data-source-type="number" value="'+esc(value??'')+'"></label>';
 return '<label class="sw2-source-field">'+esc(label)+'<textarea class="sw2-input" rows="3" '+attr+'>'+esc(value)+'</textarea></label>';
}
export function renderSourceEditForm(draft,{selectedIndex=0,ruleKinds=draft.ruleKinds??{}}={}){
 if(draft.kind==='entity')return '<p class="sw2-hint">编辑人物档案：只修改抽象内容，已发生的推演保留。</p>'+
  '<label class="sw2-source-field">名号<input class="sw2-input" data-source-name value="'+esc(draft.value.name)+'"></label>'+
  '<label class="sw2-source-field">别名（每行一个）<textarea class="sw2-input" rows="3" data-source-aliases>'+esc(draft.value.aliases.join('\n'))+'</textarea></label>'+
  field(draft.value.fields,sourceProfileValueSchema.props.fields,['fields'],'抽象属性');
 const schema=schemaOf(draft.target),value=draft.value;
 let body;
 if(schema.kind==='array'){
  const index=Math.max(0,Math.min(selectedIndex,value.length-1)),item=value[index];
  const select='<label class="sw2-source-field">选择条目<select class="sw2-input" data-source-item-index>'+value.map((v,i)=>'<option value="'+i+'"'+(i===index?' selected':'')+'>'+esc((typeof v==='string'?v:v?.名??v?.name??v?.level)||'第 '+(i+1)+' 项')+'</option>').join('')+'</select></label>';
  body=(value.length?select+field(item,schema.items,[index],labelOf(draft.target)+' / '+(index+1))+'<button type="button" class="sw2-btn" data-source-remove="'+encoded([index])+'">移除此项</button>':'<p class="sw2-hint">暂无条目，可添加自己的设定。</p>')+'<button type="button" class="sw2-btn" data-source-add-array="[]">添加条目</button>';
 }else body=field(value,schema,[],labelOf(draft.target));
 return '<p class="sw2-hint">编辑世界设定：原稿及修改前版本保留。</p>'+body;
}
export function renderSourceEditComparison(result){
 const display=value=>value===undefined?'（无）':typeof value==='string'?value:JSON.stringify(value,null,2);
 return '<h3>修改对照</h3>'+((result.changed===false||!result.changes?.length)?'<p>没有内容变化。</p>':(result.changes??[]).map(row=>'<section class="sw2-source-diff"><h4>'+esc(String(row.label).split(' / ').map(labelOf).join(' / '))+'</h4><div><span>修改前</span><pre>'+esc(display(row.before))+'</pre></div><div><span>修改后</span><pre>'+esc(display(row.after))+'</pre></div></section>').join(''))+
  (result.preservedFields?.length?'<p class="sw2-hint">已变化的当前状态保持：'+esc(result.preservedFields.map(labelOf).join('、'))+'。只保存基础档案的修改。</p>':'');
}
const MASK='sw2_source_edit';
function createSingleSourceEditPanel({host,getWorld,onSaved=()=>{},onStatus=()=>{},doc=null,isCurrent=()=>true}){
 let modal=null,draft=null,working=null,kinds={},selectedIndex=0,saving=false,request=0,bound=null,returnFocus=null,escape=null;
 const D=()=>doc??globalThis.document;
 const report=text=>{const el=modal?.querySelector('[data-source-edit-status]');if(el)el.textContent=text;if(isCurrent())onStatus(text)};
 function close(){
  if(saving)return false;
  request++;if(draft)host.sourceEditor.cancel(draft.token);draft=null;working=null;
  if(escape)D()?.removeEventListener('keydown',escape,true);
  escape=null;modal?.remove();modal=null;if(isCurrent())returnFocus?.focus?.({preventScroll:true});returnFocus=null;return true;
 }
 const change=()=>{
  const result={value:copy(working)};
  if(draft.target==='rules'){
   result.ruleKinds=copy(kinds);
   for(const text of working){const key=String(text).trim();
    if(key&&!draft.value.includes(text)&&!own(result.ruleKinds,key))Object.defineProperty(result.ruleKinds,key,{value:'世界观设定',enumerable:true,writable:true,configurable:true});
   }
  }
  return result;
 };
 const isDirty=()=>sourceEditJson(working)!==sourceEditJson(draft.value);
 function invalidate(){
  const button=modal?.querySelector('[data-source-save]');if(button)button.disabled=!isDirty();
 }
 function renderForm(){
  modal.querySelector('[data-source-edit-form]').innerHTML=renderSourceEditForm({...draft,value:working,ruleKinds:kinds},{selectedIndex,ruleKinds:kinds});invalidate();
 }
 function getAt(path){let value=working;for(const key of path){if(!own(value,key))throw Error('编辑字段已改变，请重新选择');value=value[key]}return value}
 function setAt(path,value){
  if(!path.length){working=value;return}
  const parent=getAt(path.slice(0,-1)),key=path.at(-1);
  Object.defineProperty(parent,key,{value,enumerable:true,writable:true,configurable:true});
 }
 function getSchema(path){
  let schema=draft.kind==='entity'?sourceProfileValueSchema:schemaOf(draft.target);
  for(const key of path)schema=schema?.kind==='array'?schema.items:schema?.props?.[key]??{kind:schema?.kind==='numRecord'?'number':'string'};
  return schema;
 }
 function parsePath(element,key){return JSON.parse(element.getAttribute(key))}
 function buttonBusy(value){for(const el of modal.querySelectorAll('button,select,input,textarea'))el.disabled=value;if(!value)modal.querySelector('[data-source-save]').disabled=!isDirty()}
 async function open(spec,{add=false,returnTo=null}={}){
  if(!isCurrent())return false;
  if(saving)throw Error('正在保存修改，请稍候');
  close();const ticket=++request,active=returnTo??D()?.activeElement,next=await host.sourceEditor.open(spec);
  if(ticket!==request||!isCurrent()){host.sourceEditor.cancel(next.token);return false}
  draft=next;working=copy(next.value);kinds=copy(next.ruleKinds??{});selectedIndex=0;returnFocus=active;
  if(add&&Array.isArray(working)){working.push(seed(schemaOf(draft.target).items));selectedIndex=working.length-1}
  const d=D();if(!d?.body)throw Error('当前环境无法打开编辑窗口');
  modal=d.createElement('div');modal.id=MASK;modal.className='sw2-window-mask sw2-ew-mask sw2-source-edit-mask sw2-open';
  modal.innerHTML='<section class="sw2-window sw2-ew-window sw2-source-edit-window" role="dialog" aria-modal="true" aria-labelledby="sw2_source_edit_title"><header class="sw2-header sw2-ew-head"><div class="sw2-title-block"><h2 id="sw2_source_edit_title">'+(draft.kind==='entity'?'编辑人物档案':'编辑世界设定')+'</h2></div><button class="sw2-btn" type="button" data-source-close aria-label="关闭编辑">关闭</button></header><div class="sw2-ew-body sw2-source-edit-body">'+
   (draft.kind==='setting'?'<label class="sw2-source-field">设定分类<select class="sw2-input" data-source-category>'+editableSourceSettings(getWorld()).map(key=>'<option value="'+esc(key)+'"'+(key===draft.target?' selected':'')+'>'+esc(labelOf(key))+'</option>').join('')+'</select></label>':'')+
   '<div data-source-edit-form></div><p class="sw2-hint" data-source-edit-status role="status" aria-live="polite"></p></div><footer class="sw2-source-edit-actions"><button type="button" class="sw2-btn sw2-primary" data-source-save disabled>保存修改</button>'+
   (draft.canUndo?'<button type="button" class="sw2-btn" data-source-undo>撤销本项上次编辑</button>':'')+
   '<button type="button" class="sw2-btn" data-source-close>取消</button></footer></section>';
  d.body.appendChild(modal);renderForm();
  modal.addEventListener('input',event=>{
   if(!isCurrent()||saving)return;
   const el=event.target;try{
    if(el.matches('[data-source-name]'))working.name=el.value;
    else if(el.matches('[data-source-aliases]'))working.aliases=el.value.split(/\r?\n/).filter(v=>v.trim());
    else if(el.hasAttribute('data-source-edit-path')){
     const path=parsePath(el,'data-source-edit-path'),kind=el.getAttribute('data-source-type');
     const old=draft.target==='rules'&&path.length===1?getAt(path):null;
     const value=kind==='number'?(el.value===''?null:Number(el.value)):kind==='boolean'?(el.value===''?null:el.value==='true'):el.value;
     setAt(path,value);if(old!==null&&kinds[String(old).trim()])Object.defineProperty(kinds,String(value).trim(),{value:kinds[String(old).trim()],enumerable:true,writable:true,configurable:true});
    }else return;
    invalidate();
   }catch(error){report(error.message)}
  });
  modal.addEventListener('change',event=>{
   if(!isCurrent()||saving)return;
   const el=event.target;try{
    if(el.hasAttribute('data-source-item-index')){selectedIndex=Number(el.value);renderForm()}
    else if(el.hasAttribute('data-source-map-key')){
     const path=parsePath(el,'data-source-map-key'),parent=getAt(path.slice(0,-1)),old=path.at(-1),name=el.value;
     if(name!==old){if(own(parent,name))throw Error('属性名重复，请另取名称');Object.defineProperty(parent,name,{value:parent[old],enumerable:true,writable:true,configurable:true});delete parent[old];renderForm()}
    }else if(el.hasAttribute('data-source-category')){
     const dirty=isDirty();
     if(dirty&&d.defaultView?.confirm&&!d.defaultView.confirm('放弃当前未保存的修改并切换设定分类？')){el.value=draft.target;return}
     openSetting(el.value).catch(error=>report(error.message));
    }
   }catch(error){report(error.message)}
  });
  modal.addEventListener('click',async event=>{
   if(!isCurrent())return;
   const el=event.target.closest?.('button');if(!el||saving)return;
   try{
    if(el.hasAttribute('data-source-close')){close();return}
    if(el.hasAttribute('data-source-remove')){
     const path=parsePath(el,'data-source-remove'),parent=getAt(path.slice(0,-1));
     if(Array.isArray(parent))parent.splice(path.at(-1),1);else delete parent[path.at(-1)];
     selectedIndex=Math.max(0,Math.min(selectedIndex,(working?.length??1)-1));renderForm();return;
    }
    if(el.hasAttribute('data-source-add-array')){
     const path=parsePath(el,'data-source-add-array'),value=getAt(path);value.push(seed(getSchema(path).items));
     if(!path.length)selectedIndex=value.length-1;renderForm();return;
    }
    if(el.hasAttribute('data-source-add-map')){const path=parsePath(el,'data-source-add-map'),value=getAt(path);if(own(value,''))throw Error('请先填写新增属性的名称');Object.defineProperty(value,'',{value:'',enumerable:true,writable:true,configurable:true});renderForm();return}
    if(el.hasAttribute('data-source-add-property')){
     const path=parsePath(el,'data-source-add-property'),select=[...modal.querySelectorAll('[data-source-property-choice]')].find(e=>sourceEditJson(parsePath(e,'data-source-property-choice'))===sourceEditJson(path)),key=select?.value;
     if(key){const value=getAt(path);Object.defineProperty(value,key,{value:seed(getSchema(path).props[key]),enumerable:true,writable:true,configurable:true});renderForm()}return;
    }
    if(el.hasAttribute('data-source-save')||el.hasAttribute('data-source-undo')){
     const undo=el.hasAttribute('data-source-undo');if(!undo&&!isDirty()){report('没有内容变化。');return}
     saving=true;buttonBusy(true);const spec={kind:draft.kind,entityId:draft.target,key:draft.target};
     const result=undo?await host.sourceEditor.undo(draft.token):await host.sourceEditor.save(draft.token,change());
     if(result.needsReload){report(result.savedToOriginal?'修改已保存在原世界，当前聊天未采用旧结果。':'修改已正式保存，界面暂未同步；再次点击保存只重新读取已保存版本。');return}
     saving=false;close();if(!isCurrent())return;onSaved(spec,result);onStatus(result.newerVersion?'修改已保存，世界已继续前进，当前版本保持。':undo?'已撤销本项人工编辑；推演历史保留。':'抽象内容已保存；原资料与推演历史保留。');return;
    }
   }catch(error){report('未完成：'+error.message)}
   finally{saving=false;if(modal)buttonBusy(false)}
  });
  escape=event=>{if(!isCurrent())return;if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229){event.preventDefault();event.stopImmediatePropagation();close()}};
  d.addEventListener('keydown',escape,true);
  modal.querySelector('[data-source-edit-form] input,[data-source-edit-form] textarea,[data-source-edit-form] select')?.focus();
  return true;
 }
 function openEntity(id){return open({kind:'entity',entityId:id})}
 function openSetting(key='rules',add=false,returnTo=null){return open({kind:'setting',key},{add,returnTo})}
 return {
  openEntity,openSetting,close,isOpen:()=>!!modal&&isCurrent(),
  scopeChanged(){if(modal){modal.hidden=!isCurrent();modal.inert=!isCurrent();if(modal.style)modal.style.display=isCurrent()?'':'none';}},
  handleMenuEscape(event){
   if(!isCurrent())return false;
   if(event.key!=='Escape'||event.isComposing||event.keyCode===229)return false;
   const menu=bound?.querySelector('details[data-setting-menu][open]');if(!menu)return false;
   event.preventDefault();event.stopImmediatePropagation();menu.open=false;menu.querySelector('summary')?.focus({preventScroll:true});return true;
  },
  canEditEntity(world,id){if(!host.session.active)return false;try{readSourceEntityDraft(world,id);return true}catch{return false}},
  bind(root){
   if(bound===root)return;bound=root;
   const closeMenus=except=>{for(const menu of root.querySelectorAll('details[data-setting-menu]'))if(menu!==except)menu.open=false};
   root.addEventListener('toggle',event=>{
    if(!isCurrent())return;
    const menu=event.target;if(!menu.matches?.('details[data-setting-menu]')||!menu.open)return;
    closeMenus(menu);
    const items=menu.querySelector('.sw2-setting-menu-items'),r=menu.getBoundingClientRect(),height=D()?.defaultView?.innerHeight??root.clientHeight;
    const view=menu.closest('.sw2-view')?.getBoundingClientRect(),top=Math.max(0,view?.top??0),bottom=Math.min(height,view?.bottom??height);
    const above=Math.max(0,r.top-top-12),below=Math.max(0,bottom-r.bottom-12),up=items.scrollHeight>below&&above>below;
    menu.dataset.placement=up?'up':'down';items.style.maxHeight=Math.max(0,up?above:below)+'px';
   },true);
   root.addEventListener('scroll',event=>{if(!isCurrent())return;if(!event.target.closest?.('.sw2-setting-menu-items'))closeMenus()},true);
   root.addEventListener('click',event=>{
    if(!isCurrent())return;
    const menu=event.target.closest?.('details[data-setting-menu]');closeMenus(menu);
    if(menu&&event.target.closest?.('button'))menu.open=false;
    const el=event.target.closest?.('[data-source-edit-setting],[data-source-edit-add-setting]');if(!el||!root.contains(el))return;
    event.preventDefault();openSetting(el.getAttribute('data-source-edit-setting')||'rules',el.hasAttribute('data-source-edit-add-setting'),menu?.querySelector('summary')??el).catch(error=>{if(isCurrent())onStatus(error.message)});
   });
  }
 };
}

// Each chat keeps its DOM and unsaved input; host tokens are renewed only when
// another chat's editor has replaced them, with the original version checked.
export function createSourceEditPanel(options){
 const {getScope,host}=options;
 if(typeof getScope!=='function')return createSingleSourceEditPanel(options);
 const panels=new Map(),tokenOwners=new Map();let bound=null,activeToken=null;
 const scope=()=>String(getScope()??'');
 const pointer=()=>{const p=host.session?.readState?.()?.pointer;return p?sourceEditJson(p):null};
 function current(){
  const owner=scope();if(panels.has(owner))return panels.get(owner);
  const tokens=new Map();tokenOwners.set(owner,tokens);const isCurrent=()=>scope()===owner;
  const editor={
   async open(spec){
    if(!isCurrent())throw Error('聊天已改变，请回到原聊天继续编辑');
    const next=await host.sourceEditor.open(spec);
    activeToken=next.token;tokens.set(next.token,{spec:copy(spec),base:copy(next),pointer:pointer()});return next;
   },
   cancel(token){const saved=tokens.get(token);tokens.delete(token);return host.sourceEditor.cancel(saved?.activeToken??token)},
   async invoke(method,token,change){
    if(!isCurrent())throw Error('聊天已改变，请回到原聊天继续编辑');
    const saved=tokens.get(token);if(!saved)throw Error('编辑已关闭，请重新打开');
    token=saved.activeToken??token;
    if(activeToken!==token||saved.reopen){
     if(saved.pointer!==null&&saved.pointer!==pointer())throw Error('世界版本已改变，输入仍保留，请核对后重新打开编辑');
     const next=await host.sourceEditor.open(saved.spec);
     if(!isCurrent())throw Error('聊天已改变，输入仍保留');
     activeToken=next.token;
     if(sourceEditJson(next.value)!==sourceEditJson(saved.base.value)||sourceEditJson(next.ruleKinds)!==sourceEditJson(saved.base.ruleKinds))throw Error('档案版本已改变，输入仍保留，请核对后重新打开编辑');
     token=next.token;saved.activeToken=token;saved.reopen=false;
    }
    return method==='save'?host.sourceEditor.save(token,change):host.sourceEditor.undo(token);
   },
   save(token,change){return editor.invoke('save',token,change)},undo(token){return editor.invoke('undo',token)}
  };
  const panel=createSingleSourceEditPanel({...options,host:{sourceEditor:editor,session:host.session},isCurrent});
  panels.set(owner,panel);if(bound)panel.bind(bound);return panel;
 }
 return {openEntity:(...args)=>current().openEntity(...args),openSetting:(...args)=>current().openSetting(...args),
  close:()=>current().close(),isOpen:()=>panels.get(scope())?.isOpen()??false,
  scopeChanged(){for(const panel of panels.values())panel.scopeChanged();for(const [owner,tokens] of tokenOwners)if(owner!==scope())for(const saved of tokens.values())saved.reopen=true;},
  handleMenuEscape:event=>current().handleMenuEscape(event),canEditEntity:(...args)=>current().canEditEntity(...args),
  bind(root){bound=root;current().bind(root)}};
}

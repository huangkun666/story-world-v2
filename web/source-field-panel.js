import {confirmFieldTable,isWorldWritableDefinition} from '../src/source-field-table.js';
import {openPanelDialog} from './panel-dialog.js';
const scopes=[['character','人物'],['faction','势力'],['location','地点'],['character,faction','人物与势力'],['character,location','人物与地点'],['faction,location','势力与地点'],['character,faction,location','人物、势力与地点']];

function fieldSummary(doc,row,field,badge=null){
 const summary=doc.createElement('summary'),name=doc.createElement('strong'),kinds=doc.createElement('span');
 kinds.className='sw2-field-kinds';summary.append(name);if(badge)summary.append(badge);summary.append(kinds);row.append(summary);
 const labels={character:'人物',faction:'势力',location:'地点'};
 const update=()=>{name.textContent=field.name||'新字段';kinds.textContent=field.kinds.map(k=>labels[k]||k).join('、')};
 update();return {summary,update};
}
function fitMeaning(row,textarea,opened,field){
 const resize=()=>{if(row.open&&Number.isFinite(textarea.scrollHeight)){textarea.style.height='auto';textarea.style.height=Math.max(66,textarea.scrollHeight+2)+'px'}};
 row.addEventListener('toggle',()=>{if(row.open)opened.add(field);else opened.delete(field);resize()});
 textarea.addEventListener('input',resize);
}
function rememberOpen(body,fields,opened){
 for(const row of body.querySelectorAll('[data-field-row]')){const field=fields[Number(row.getAttribute('data-field-row'))];if(!field)continue;if(row.open)opened.add(field);else opened.delete(field)}
}

export function openSourceFieldReview(doc,review,options={}){
 if(options.worldEdit)return openWorldFieldEditor(doc,review,options);
 const {signal=null,readOnly=false,message=''}=options;
 return new Promise(resolve=>{
  const opened=new Set();
  let result=null,fields=structuredClone(review.confirmed?.fields??review.candidates??[]);
  const view=openPanelDialog(doc,{title:readOnly?'本世界抽取字段':'确认抽取字段',subtitle:readOnly?(review.confirmed?'已确认的定义；实际值以正式状态为准。':'字段信息暂不可用；不会修改已有世界。'):'名册与设定已整理。确认字段后，才开始抽取属性。',signal,onClose:()=>{try{options.onDecision?.(result)}catch{}resolve(result)}});
  view.overlay.setAttribute('data-field-dialog','');
  const status=doc.createElement('p');status.className='sw2-hint';status.setAttribute('role','status');view.footer.append(status);
  function draw(remember=true){
   if(remember)rememberOpen(view.body,fields,opened);view.body.replaceChildren();
   if(!fields.length){const p=doc.createElement('p');p.className='sw2-hint';p.textContent=readOnly?(message||'此世界确认的是空字段表，没有属性字段；身份和明述位置仍按原流程保留。'):'暂无属性字段；可添加，也可确认空表。身份和明述位置仍按原流程提取。';view.body.append(p);}
   fields.forEach((field,i)=>{
    const row=doc.createElement('details');row.className='sw2-field-manager-item';row.open=opened.has(field);row.setAttribute('data-field-row',String(i));
    const {update}=fieldSummary(doc,row,field),form=doc.createElement('div');form.className='sw2-field-definition';row.append(form);
    form.innerHTML='<label>字段名<input class="sw2-input" data-field-name></label><label>适用对象<select class="sw2-input" data-field-kinds></select></label><label class="sw2-field-meaning">补充说明（给模型）<textarea class="sw2-input" rows="2" data-field-meaning placeholder="可选；需要时补充特殊用法。"></textarea></label>';
    const name=form.querySelector('input'),meaning=form.querySelector('textarea'),select=form.querySelector('select');name.value=field.name;meaning.value=field.meaning;
    for(const [key,label]of scopes){const o=doc.createElement('option');o.value=key;o.textContent=label;select.append(o);}select.value=[...field.kinds].sort().join(',');
    name.oninput=()=>{field.name=name.value;update()};meaning.oninput=()=>field.meaning=meaning.value;select.onchange=()=>{field.kinds=select.value.split(',');update()};fitMeaning(row,meaning,opened,field);
    if(readOnly)for(const e of [name,meaning,select])e.disabled=true;
    else{const remove=doc.createElement('button');remove.type='button';remove.className='sw2-btn';remove.textContent='移除此项';remove.onclick=()=>{rememberOpen(view.body,fields,opened);fields.splice(i,1);draw(false);};form.append(remove);}
    view.body.append(row);
   });
   if(!readOnly){const add=doc.createElement('button');add.type='button';add.className='sw2-btn';add.textContent='添加字段';add.setAttribute('data-field-add','');add.onclick=()=>{fields.push({name:'',meaning:'',kinds:['character'],sources:[],origin:'user'});opened.add(fields.at(-1));draw();const row=[...view.body.querySelectorAll('[data-field-row]')].at(-1);if(row){row.open=true;row.querySelector('[data-field-name]')?.focus()}};view.body.append(add);}
  }
  draw();
  if(!readOnly){
   status.textContent='确认后保存编辑；稍后继续保留已完成的抽象，未确认的编辑不保存。';
   const later=doc.createElement('button');later.type='button';later.className='sw2-btn';later.textContent='稍后继续';later.onclick=()=>view.close();view.footer.append(later);
   const stop=doc.createElement('button');stop.type='button';stop.className='sw2-btn';stop.textContent='停止本次抽象';stop.setAttribute('data-field-stop','');stop.onclick=()=>{result={cancel:true};try{options.onDecision?.(result)}catch{}view.close();};view.footer.append(stop);
   const confirm=doc.createElement('button');confirm.type='button';confirm.className='sw2-btn sw2-primary';confirm.textContent='确认字段并继续';confirm.setAttribute('data-field-confirm','');confirm.onclick=()=>{try{confirmFieldTable(review.candidates,fields);result={fields:structuredClone(fields),expected_revision:review.revision};try{options.onDecision?.(result)}catch{}view.close();}catch(error){status.textContent=error.message;}};view.footer.append(confirm);
  }
 });
}

// Approved world editor: all validation/preview/persistence runs through the pinned host draft.
export function openWorldFieldEditor(doc,review,{signal=null,readOnly=false,message='',onPreview=null,onSave=null,onCancel=()=>{},isCurrent=()=>true,onView=()=>{}}={}){
 return new Promise(resolve=>{
  const opened=new Set();
  const schema=review.schema??{status:'unconfirmed',fields:[]},confirmed=schema.status==='confirmed';
   let fields=structuredClone(confirmed?schema.fields:[]).map(f=>({...f,selected:f.enabled!==false})),discovered=confirmed,preview=null,previewing=false,saving=false,closed=false,result=null;
  const node=(tag,text,cls)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
  const view=openPanelDialog(doc,{title:'世界字段',subtitle:(review.worldName||'当前世界')+' · 第'+(review.revision??'当前')+'版 · '+(schema.status==='invalid'?'读取失败':confirmed?'已确认':'尚未确认'),
   signal,isActive:isCurrent,canClose:()=>!saving,onClose:()=>{closed=true;onCancel();resolve(result)}});
  view.overlay.setAttribute('data-field-dialog','');view.overlay.setAttribute('data-field-manager','');view.overlay.classList.add('sw2-field-manager');
  for(const type of ['click','input','change','keydown'])view.overlay.addEventListener?.(type,event=>{if(!isCurrent()){event.preventDefault();event.stopImmediatePropagation();}},true);
  onView(view);
  const status=node('p','','sw2-hint');status.setAttribute('role','status');
  const errorText=error=>/stale.*revision/i.test(String(error.message))?'世界版本已改变，未覆盖已有修改。请重新读取后再编辑。':String(error.message);
  const button=(text,action,primary=false)=>{const b=node('button',text,'sw2-btn'+(primary?' sw2-primary':''));b.type='button';b.onclick=(...args)=>isCurrent()?action(...args):undefined;return b};
   const selected=()=>fields.filter(f=>f.selected||(schema.fields.some(old=>old.id===f.id)&&isWorldWritableDefinition(f))).map(({selected,...f})=>({...f,...(isWorldWritableDefinition(f)?{enabled:!!selected}:{})}));
  const edited=()=>{if(!readOnly&&!saving&&!previewing)status.textContent='未保存的编辑只在此窗口；关闭即放弃。'};
  const reload=()=>{result={reload:true};view.close()};
  function draw(remember=true){
   if(closed)return;if(remember)rememberOpen(view.body,fields,opened);view.body.replaceChildren();view.footer.replaceChildren(status);status.textContent=readOnly?(message||'当前只读，不会改变已有任务或世界。'):'未保存的编辑只在此窗口；关闭即放弃。';
   view.body.append(node('p',preview?'先核对这次修改，再保存。':'此表决定模型可以更新哪些自定义属性。行动、事件、承诺、位置与关系仍按固定协议记录。','sw2-field-manager-intro'));
   if(schema.status==='invalid'){view.body.append(node('p','字段表读取或校验失败，已有值与历史保留。不会改用默认字段或把失败当作空表。','sw2-field-manager-notice'));view.body.append(node('p',schema.error||message,'sw2-hint'));view.footer.append(button('重新读取',reload,true));return}
   if(readOnly&&message)view.body.append(node('p',message,'sw2-field-manager-notice'));
   if(!confirmed&&!discovered){
    view.body.append(node('p','旧世界还没有确认过字段。可以从现有值整理候选，选择后确认；补充说明可不填。不会调用模型、改写已有值或建立原书初态。','sw2-field-manager-notice'));
    const empty=node('section',undefined,'sw2-field-manager-empty');empty.append(node('strong','尚未确认字段表'),node('p','当前没有自定义属性写权限；已有世界继续保留。','sw2-hint'));
    if(!readOnly)empty.append(button('整理旧世界字段',()=>{fields=structuredClone(review.candidates??[]).map(f=>({...f,selected:false}));discovered=true;draw()},true));
    view.body.append(empty);
    if(!readOnly)view.footer.append(button('添加字段',()=>{discovered=true;add()}),button('确认空表',async()=>{fields=[];discovered=true;await showPreview()}));return;
   }
   if(preview){
    const list=node('ul',undefined,'sw2-field-manager-diff');for(const line of preview.changes?.length?preview.changes:['字段内容未改变。'])list.append(node('li',line));view.body.append(list);
    view.body.append(node('p','不会重抽世界，不会将当前属性写成原书初态。','sw2-hint'));
    view.footer.append(button('返回编辑',()=>{preview=null;draw()}),button('确认并保存',save,true));view.footer.lastChild.setAttribute('data-field-save','');return;
   }
   if(!confirmed&&fields.length)view.body.append(node('p','候选只归纳现存字段名、适用对象和值的形状，不猜定义。默认全部未选，选择后确认；补充说明可不填。','sw2-field-manager-notice'));
   if(!fields.length)view.body.append(node('p','字段表为空。确认保存后，自定义属性不可写；已有值和历史继续保留。','sw2-field-manager-notice'));
   fields.forEach((field,index)=>{
    const candidate=(review.candidates??[]).find(f=>f.id===field.id);
    const row=node('details',undefined,'sw2-field-manager-item');row.open=opened.has(field);row.setAttribute('data-field-row',index);
    const badge=node('span','','sw2-hint'),{update}=fieldSummary(doc,row,field,badge);
    const form=node('div',undefined,'sw2-field-definition'),enabled=node('label',undefined,'sw2-field-manager-enable'),check=node('input'),permission=node('span');check.type='checkbox';check.checked=!!field.selected;check.disabled=readOnly;check.setAttribute('data-field-enabled','');check.onchange=()=>{field.selected=check.checked;updateStatus();edited()};enabled.append(check,permission);form.append(enabled);
    const name=node('label','字段名'),nameInput=node('input',undefined,'sw2-input');nameInput.value=field.name;nameInput.disabled=readOnly;nameInput.setAttribute('data-field-name','');nameInput.oninput=()=>{field.name=nameInput.value;update();updateStatus();edited()};name.append(nameInput);form.append(name);
    const kind=node('label','适用对象'),select=node('select',undefined,'sw2-input');for(const [value,label]of scopes){const option=node('option',label);option.value=value;select.append(option)}select.value=[...field.kinds].sort().join(',');select.disabled=readOnly;select.setAttribute('data-field-kinds','');select.onchange=()=>{field.kinds=select.value.split(',');update();updateStatus();edited()};kind.append(select);form.append(kind);
    const meaning=node('label','补充说明（给模型）','sw2-field-meaning'),textarea=node('textarea',undefined,'sw2-input');textarea.rows=2;textarea.value=field.meaning??'';textarea.disabled=readOnly;textarea.setAttribute('data-field-meaning','');textarea.placeholder='可选；需要时补充特殊用法。';textarea.oninput=()=>{field.meaning=textarea.value;edited()};meaning.append(textarea);form.append(meaning);fitMeaning(row,textarea,opened,field);
    const note=node('p','','sw2-hint');
    function updateStatus(){const writable=isWorldWritableDefinition(field);badge.textContent=!confirmed&&field.origin==='inferred'?'待确认 · '+field.count+'个现存值':!writable?'定义只读':field.selected?'已启用':'未启用';permission.textContent=writable?'允许模型更新':'保留字段定义（当前只读）';note.textContent=(!confirmed&&field.origin==='inferred'?'从现有字段归纳，尚未授权。':candidate?'从旧世界归纳，已由你确认。':'改名保留已有值；移除后保留历史。')+(!writable?'现有文本写入入口不支持此值形状或对象类型，只保留定义与读取，已有内容完整保留。':'')}
    updateStatus();form.append(note);if(!readOnly)form.append(button('移除此项',()=>{rememberOpen(view.body,fields,opened);fields.splice(index,1);draw(false)}));row.append(form);view.body.append(row);
   });
   const fixed=node('details',undefined,'sw2-field-manager-note');fixed.append(node('summary','固定操作与关系结构'),node('p','事件、行动、承诺、位置与关系的建立／结束使用固定协议。关系双方、关系原文和结束状态属于已有结构，不会因整理候选自动获得额外写权限。','sw2-hint'));view.body.append(fixed);
   if(!readOnly)view.footer.append(button('添加字段',add),button('查看修改',showPreview,true));else view.footer.append(button('重新读取',reload));
  }
  function add(){fields.push({name:'',meaning:'',kinds:['character'],sources:[],origin:'user',selected:true});opened.add(fields.at(-1));draw();const row=[...view.body.querySelectorAll('[data-field-row]')].at(-1);if(row){row.open=true;row.querySelector('[data-field-name]')?.focus()}}
  async function showPreview(){if(!isCurrent())return;if(previewing||saving||readOnly)return;previewing=true;for(const e of view.body.querySelectorAll('input,select,textarea,button'))e.disabled=true;for(const b of view.footer.querySelectorAll('button'))b.disabled=true;try{const data=await onPreview?.(selected());if(closed)return;if(!data)throw Error('字段预览服务不可用');preview=data;draw()}catch(error){if(!closed)status.textContent=errorText(error)}finally{previewing=false;if(!closed){for(const e of view.body.querySelectorAll('input,select,textarea,button'))e.disabled=false;for(const b of view.footer.querySelectorAll('button'))b.disabled=false}}}
  async function save(){
   if(!isCurrent()||saving||readOnly)return;saving=true;status.textContent='正在保存，请等待完成。';for(const b of view.overlay.querySelectorAll('button'))b.disabled=true;
   try{const saved=await onSave?.(selected());if(!saved?.ok)throw Error('字段未能保存');result={saved:true,...saved};saving=false;view.close()}
   catch(error){if(!closed){status.textContent=errorText(error);view.footer.append(button('重新读取',reload));}}
   finally{saving=false;if(!closed)for(const b of view.overlay.querySelectorAll('button'))b.disabled=false}
  }
  draw();
 });
}

import {readPromptPresets,promptPresetEditorValue} from './prompt-presets.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,attrs='')=>'<button type="button" class="sw2-btn" data-action="'+action+'" '+attrs+'>'+label+'</button>';
export function renderPromptPresets(state={}){
 const cfg=state.config;
 if(!cfg)return '<div data-prompt-preset-panel><div class="sw2-set-card"><h4>提示预设</h4><p role="alert" class="sw2-hint">'+esc(state.error||'无法读取提示预设设置，请重新打开后重试。')+'</p></div></div>';
 const chosen=cfg.presets.find(p=>p.id===state.selectedId),value=chosen?promptPresetEditorValue(chosen):null;
 const options=(id,none=false)=>(none?'<option value=""'+(!id?' selected':'')+'>不使用</option>':'')+cfg.presets.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===id?' selected':'')+'>'+esc(p.name)+'</option>').join('');
 const binding=(purpose,label,help)=>'<div class="sw2-preset-use"><label for="sw2_preset_'+purpose+'">'+label+'</label><div class="sw2-preset-choice"><select id="sw2_preset_'+purpose+'" class="sw2-param-select" data-preset-binding="'+purpose+'" aria-label="'+label+'">'+options(cfg.bindings[purpose],true)+'</select>'+button('preset-edit','编辑','data-purpose="'+purpose+'"'+(!cfg.bindings[purpose]?' disabled':''))+'</div><p class="sw2-hint">'+help+'</p></div>';
 const use=chosen?['abstract','simulate'].filter(key=>cfg.bindings[key]===chosen.id).map(key=>key==='abstract'?'抽象':'推演'):[];
 return '<div data-prompt-preset-panel class="sw2-preset-panel"><p class="sw2-preset-intro">选择与编辑提示预设，保存后用于下一次新请求。</p>'
 +'<section class="sw2-set-card sw2-preset-current"><div class="sw2-preset-heading"><h4>当前使用</h4><div class="sw2-preset-save">'+button('preset-undo','撤销',state.saving||!state.dirty?'disabled':'')+button('preset-save',state.saving?'保存中…':'保存修改',state.saving?'disabled':'')+'</div></div><div class="sw2-preset-bindings">'+binding('abstract','抽象预设','资料抽取、整理与定稿')+binding('simulate','推演预设','世界推进')+'</div><p class="sw2-hint sw2-preset-status" role="status">'+esc(state.error||state.notice||(state.dirty?'有未保存修改':'尚无未保存修改'))+'</p></section>'
 +'<section class="sw2-set-card sw2-preset-editor"><div class="sw2-preset-heading"><h4>编辑预设</h4><select class="sw2-param-select" data-preset-library aria-label="编辑预设">'+(chosen?'':'<option value="">预设库为空</option>')+options(state.selectedId)+'</select>'+button('preset-expand',value&&!value.editable?'↗ 展开查看':'↗ 展开编辑',!chosen?'disabled':'')+'</div>'
 +(chosen?'<p class="sw2-hint sw2-preset-usage">'+(use.length===2?'当前用于：抽象、推演。内容修改同时影响抽象与推演。':use.length?'当前用于：'+use.join('、'):'当前未用于抽象或推演')+'</p><label class="sw2-preset-field">预设名称<input class="sw2-input" data-preset-field="name" aria-label="预设名称" value="'+esc(chosen.name)+'"></label>'
 +(!value.editable?'<p class="sw2-hint" data-preset-legacy>旧版内容只读保留，发送方式不变。可新建一份预设后切换使用。</p>':'')
 +'<label class="sw2-preset-content-label" for="sw2_preset_content">'+(value.editable?'预设正文':'旧版正文（只读）')+'</label><textarea id="sw2_preset_content" class="sw2-input sw2-preset-content" '+(value.editable?'data-preset-field="content"':'readonly data-preset-legacy-content')+' aria-label="预设正文" spellcheck="false">\n'+esc(value.content)+'</textarea>'
 :'<p class="sw2-hint">新建一份预设后开始编辑。</p>')
 +'<div class="sw2-preset-tools">'+button('preset-new','新建预设')+button('preset-delete','删除预设',!chosen?'disabled':'')+'</div></section></div>';
}
export function promptPresetStateFromSettings(settings){
 try{const config=readPromptPresets(settings);return {config,selectedId:config.presets[0]?.id??''};}
 catch(error){return {config:null,error:'读取提示预设失败：'+error.message};}
}

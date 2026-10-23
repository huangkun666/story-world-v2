// Shared read/edit surface. Closing releases its listeners and restores keyboard focus.
export function openPanelDialog(doc,{title,subtitle='',signal=null,onClose=()=>{},canClose=()=>true,isActive=()=>true}={}){
 const returnTo=doc.activeElement,overlay=doc.createElement('div'),keyboardTarget=doc.defaultView??doc;
 overlay.className='sw2-window-mask sw2-review-mask sw2-open';
 overlay.innerHTML='<section class="sw2-window sw2-review-dialog" role="dialog" aria-modal="true"><header class="sw2-review-head"><div><h3></h3><p></p></div><button type="button" class="sw2-btn" data-dialog-close>关闭</button></header><div class="sw2-review-body"></div><footer class="sw2-review-footer"></footer></section>';
 const dialog=overlay.querySelector('[role="dialog"]'),heading=overlay.querySelector('h3');
 heading.id='sw2_dialog_'+Math.random().toString(36).slice(2);dialog.setAttribute('aria-labelledby',heading.id);
 heading.textContent=title;overlay.querySelector('p').textContent=subtitle;
 let closed=false;
 function close({force=false}={}){if(closed||!force&&!canClose())return;closed=true;keyboardTarget.removeEventListener('keydown',keyboard,true);signal?.removeEventListener('abort',abort);overlay.remove();if(isActive())returnTo?.focus?.({preventScroll:true});onClose();}
 function abort(){close({force:true})}
 function keyboard(event){
  if(!isActive())return;
  if(event.isComposing||event.keyCode===229)return;
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();return;}
  if(event.key!=='Tab')return;
  const focusable=[...dialog.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(e=>!e.disabled&&!e.hidden&&e.getClientRects().length);
  if(!focusable.length){event.preventDefault();return;}
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&doc.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&doc.activeElement===last){event.preventDefault();first.focus();}
 }
 overlay.querySelector('[data-dialog-close]').onclick=()=>{if(isActive())close()};
 doc.body.append(overlay);keyboardTarget.addEventListener('keydown',keyboard,true);signal?.addEventListener('abort',abort,{once:true});
 if(isActive())overlay.querySelector('button').focus();if(signal?.aborted)close();
 return {overlay,dialog,body:overlay.querySelector('.sw2-review-body'),footer:overlay.querySelector('footer'),close};
}

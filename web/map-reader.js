import { renderMapHtml } from '../src/map-view.js';
export function createMapPopupHub({ getWorld, doc = null, onExtract = null, setStatus = null }) {
    let mask = null, box = null, trigger = null, placeId = '', query = '', composing = false;
    const documentOf = () => doc || (typeof document === 'undefined' ? null : document);
    const refresh = () => { if (!mask) return false; box.innerHTML = renderMapHtml(getWorld(), { placeId, query }); return true; };
    const close = () => {
        if (!mask) return false;
        const d = documentOf(); d.removeEventListener('keydown', onKey, true); mask.remove(); mask = box = null;
        const focus = trigger?.isConnected ? trigger : d.querySelector?.('[data-action="open-map"]');
        focus?.focus?.(); return true;
    };
    const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault?.(); close(); }
        if (e.key === 'Tab' && box?.querySelectorAll) {
            const items = [...box.querySelectorAll('button, input, summary, [tabindex="0"]')];
            if (!items.length) return;
            const d = documentOf(); const first = items[0], last = items.at(-1);
            if (e.shiftKey && (d.activeElement === first || d.activeElement === box)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    };
    const open = () => {
        const d = documentOf(); if (!d?.body || !d.createElement) return null;
        if (mask) { refresh(); box.focus?.(); return mask; }
        composing = false; trigger = d.activeElement; mask = d.createElement('div'); mask.id = 'sw2_map_mask'; mask.className = 'sw2-map-mask';
        box = d.createElement('div'); box.className = 'sw2-map-box'; box.tabIndex = -1; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'sw2_map_title');
        mask.appendChild(box); d.body.appendChild(mask);
        mask.addEventListener('click', async (e) => {
            if (e.target === mask) { close(); return; }
            const target = e.target?.closest?.('[data-map-action]'); if (!target) return;
            const action = target.dataset.mapAction;
            if (action === 'close') close();
            if (action === 'place') { placeId = target.dataset.place; refresh(); }
            if (action === 'refresh') refresh();
            if (action === 'extract') { try { await onExtract?.(); refresh(); } catch (error) { setStatus?.(`地图抽取失败：${error?.message || error}`); } }
        });
        const applySearch = e => {
            if (!e.target?.matches?.('[data-map-search]')) return;
            if (e.target.value === query) return;
            query = e.target.value; const pos = e.target.selectionStart; refresh();
            const input = box.querySelector?.('[data-map-search]'); input?.focus?.(); input?.setSelectionRange?.(pos, pos);
        };
        mask.addEventListener('compositionstart', e => {
            if (e.target?.matches?.('[data-map-search]')) composing = true;
        });
        mask.addEventListener('compositionend', e => {
            if (!e.target?.matches?.('[data-map-search]')) return;
            composing = false; applySearch(e);
        });
        mask.addEventListener('input', e => {
            if (!composing && !e.isComposing) applySearch(e);
        });
        d.addEventListener('keydown', onKey, true); refresh(); box.focus?.(); return mask;
    };
    return { open, close, refresh };
}

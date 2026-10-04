import { escapeHtml } from './render-base.js';

// View-only sections. Every control is rendered once; switching only changes visibility.
export function renderSubtabs(scope, sections) {
    const id = (key) => `sw2_subtab_${scope}_${key}`;
    return `<div class="sw2-subtabs-page" data-subtabs="${escapeHtml(scope)}">`
        + `<div class="sw2-subtabs" role="tablist" aria-label="${scope === 'params' ? '参数分类' : '设置分类'}">`
        + sections.map(({ key, label }, i) => `<button type="button" class="sw2-subtab" role="tab"`
            + ` id="${id(key)}" data-subtab="${key}" aria-controls="${id(key)}_panel"`
            + ` aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${escapeHtml(label)}</button>`).join('')
        + `</div>`
        + sections.map(({ key, html }, i) => `<section class="sw2-subpanel" role="tabpanel"`
            + ` id="${id(key)}_panel" data-subpanel="${key}" aria-labelledby="${id(key)}"${i ? ' hidden' : ''}>${html}</section>`).join('')
        + `</div>`;
}

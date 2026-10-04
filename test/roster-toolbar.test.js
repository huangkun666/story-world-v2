import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEntsToolbar } from '../src/render.js';

const world = { entities: [], agendas: [] };
const options = (html) => /<details class="sw2-ents-options"([^>]*)>([\s\S]*?)<\/details>/.exec(html);

test('名册默认只展开搜索与类别，其他操作保留在可打开的选项里', () => {
    const html = renderEntsToolbar(world, {});
    const fold = options(html);
    assert.ok(fold, '筛选与排列有独立的展开入口');
    assert.ok(!/\bopen\b/.test(fold[1]), '默认不让高级选项挤占名册');
    const primary = html.replace(fold[0], '');
    assert.ok(primary.includes('id="sw2_ents_q"'));
    for (const value of ['all', 'faction', 'character']) {
        assert.ok(primary.includes(`data-action="ents-filter" data-value="${value}"`));
    }
    for (const action of ['ents-sort', 'ents-group', 'ents-scope']) {
        assert.ok(fold[2].includes(`data-action="${action}"`), `${action} 仍可使用`);
        assert.ok(!primary.includes(`data-action="${action}"`));
    }
    assert.ok(fold[2].includes('data-action="ents-filter" data-value="busy"'));
    assert.ok(primary.includes('sw2-ents-asks'), '查书说明仍有入口');
});

test('名册的筛选或排列正在生效时，自动显示影响结果的选项', () => {
    for (const view of [{ filters: ['busy'] }, { sort: 'name' }, { grp: 'parent' }, { scope: 'hit' }]) {
        const fold = options(renderEntsToolbar(world, view));
        assert.ok(fold && /\bopen\b/.test(fold[1]), JSON.stringify(view));
        assert.ok(fold[2].includes('aria-pressed="true"'), '当前选项的按下态仍保留');
    }
    for (const view of [{ q: '山' }, { kind: 'faction' }]) {
        assert.ok(!/\bopen\b/.test(options(renderEntsToolbar(world, view))[1]), '首页可见条件不会额外展开高级项');
    }
});

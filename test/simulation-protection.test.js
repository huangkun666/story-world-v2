import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWorldStep } from '../src/check-step.js';
import { dropInvalidProposals } from '../src/sanitize-step.js';
import { buildEvolutionPack, trimPack } from '../src/pack.js';
import { validate } from '../src/schema.js';
import { ssotSchema } from '../src/schemas/ssot.schema.js';
import { MAIN_PROMPT, MAIN_PROMPT_V } from '../src/prompts.js';

import * as protection from '../src/simulation-protection.js';
const world = () => ({ version: 1, context: { world: 'Synthetic', playerId: 'p', positions: ['Home'] },
    entities: [
        { id: 'p', kind: 'character', name: 'Player', location: 'Home', aliases: ['Confirmed player'] },
        { id: 'b', kind: 'character', name: 'Blocked', location: 'Tower', simulationBlocked: true, posture: 'Waiting', aliases: ['Confirmed alias'] },
        { id: 'a', kind: 'character', name: 'Acted', location: 'Market' },
        { id: 'n', kind: 'character', name: 'NPC', location: 'Square' },
        { id: 'f', kind: 'faction', name: 'Faction', location: 'Square' },
    ], agendas: ['p', 'b', 'a', 'n'].map(owner => ({ id: `ag_${owner}`, owner, status: 'active', goal: 'Investigate', visibility: 'known' })),
    relations: ['p', 'b', 'a', 'n'].map(from => ({ id: `rel_${from}`, from, to: 'f', type: 'Promise', closed: false })),
    events: [{ id: 'ev_1_1', title: 'Confirmed cause', source: { type: 'state' }, closed: false }],
    chronicle: [], milestones: [], weights: {}, meta: { tick: 3, turnProtection: { tick: 4, actedIds: ['a'], participantIds: ['n'], changedFields: [] } } });
const emptyStep = extra => ({ actions: [], newEvents: [], agendaAdvances: [], newAgendas: [], agendaCancels: [], newEntities: [], entityFates: [], ...extra });
const proposals = id => ({
    actions: [{ entity: id, verb: 'Leave' }],
    newAgendas: [{ entity: id, goal: 'Go outside', visibility: 'known', source: { type: 'state' } }],
    agendaAdvances: [{ agendaId: `ag_${id}`, step: 'Decides to leave' }],
    agendaCancels: [{ agendaId: `ag_${id}`, reason: 'Changed mind' }],
    newEntities: [{ name: 'New person', entity: id, source: { type: 'event', ref: 'ev_1_1' } }],
    entityFates: [{ entity: id, verdict: 'dead', source: { type: 'event', ref: 'ev_1_1' } }],
    entityUpdates: [{ entity: id, field: 'location', value: 'Road', cause: { type: 'event', ref: 'ev_1_1' } }],
    relationUpdates: [{ from: id, to: 'f', type: 'Trust', cause: { type: 'event', ref: 'ev_1_1' } }],
    relationClosures: [{ id: `rel_${id}`, why: 'Renounces promise' }],
    newEvents: [{ title: 'Leaves home', source: { type: 'plot', ref: `ag_${id}` }, ripples: [] }],
});

test('shared predicates distinguish permanent protection, this coming round, and mere participation', () => {
    assert.equal(typeof protection.isSimulationBlocked, 'function');
    const w = world();
    assert.equal(protection.isSimulationBlocked(w, 'p'), true);
    assert.equal(protection.isSimulationBlocked(w, 'b'), true);
    assert.equal(protection.isSimulationBlocked(w, 'a'), false);
    assert.equal(protection.isProtectedForStep(w, 'a'), true);
    assert.equal(protection.isProtectedForStep(w, 'n'), false);
    w.meta.tick++;
    assert.equal(protection.isProtectedForStep(w, 'a'), false);
});

test('protected roster clones complete records and confirmed canon aliases with reasons', () => {
    assert.equal(typeof protection.protectedCharactersOf, 'function');
    const w = world();
    w.context.setting = { frozen: { canon: { bookEntities: [{ name: 'Blocked', aliases: ['Canon alias'] }] } } };
    const before = JSON.stringify(w);
    const rows = protection.protectedCharactersOf(w);
    assert.deepEqual(rows.map(e => e.id), ['p', 'b', 'a']);
    assert.equal(rows[1].posture, 'Waiting');
    assert.deepEqual(rows[1].aliases, ['Confirmed alias', 'Canon alias']);
    assert.ok(rows.every(e => e.protectionReason));
    assert.notEqual(rows[2].protectionReason, rows[1].protectionReason);
    rows[1].aliases.push('Invented');
    assert.equal(JSON.stringify(w), before);
});

test('setter is immutable, idempotent, character-only and cannot unblock the player', () => {
    assert.equal(typeof protection.setSimulationBlocked, 'function');
    const w = world();
    const before = JSON.stringify(w);
    const enabled = protection.setSimulationBlocked(w, 'n', true);
    assert.equal(enabled.changed, true);
    assert.equal(enabled.world.entities.find(e => e.id === 'n').simulationBlocked, true);
    assert.equal(enabled.world.context.playerId, 'p');
    assert.equal(JSON.stringify(w), before);
    assert.deepEqual(protection.setSimulationBlocked(enabled.world, 'n', true), { world: enabled.world, changed: false });
    assert.equal(protection.setSimulationBlocked(enabled.world, 'n', false).world.entities.find(e => e.id === 'n').simulationBlocked, false);
    for (const id of ['missing', 'f']) assert.throws(() => protection.setSimulationBlocked(w, id, true));
    assert.throws(() => protection.setSimulationBlocked(w, 'p', false));
});

for (const id of ['p', 'b', 'a']) {
    for (const [family, values] of Object.entries(proposals(id))) {
        test(`${family} rejects ${id} through validation and cleanup`, () => {
            const w = world();
            const step = emptyStep({ [family]: values });
            const checked = checkWorldStep(step, w);
            assert.equal(checked.ok, false, JSON.stringify(checked));
            assert.ok(checked.errors.some(e => e.includes(`$.${family}[0]`)), checked.errors.join(';'));
            const cleaned = dropInvalidProposals(step, w);
            assert.deepEqual(cleaned.step[family], []);
            assert.ok(cleaned.dropped.some(e => e.family === family));
        });
    }
}

test('ordinary NPC proposals and interactions toward protected characters remain legal', () => {
    const w = world();
    const step = emptyStep({ actions: [{ entity: 'n', verb: 'Observe', target: 'b' }],
        relationUpdates: [{ from: 'n', to: 'b', type: 'Trust', cause: { type: 'event', ref: 'ev_1_1' } }],
        agendaCancels: [{ agendaId: 'ag_n' }], relationClosures: [{ id: 'rel_n' }],
        newEvents: [{ title: 'NPC watches the tower', source: { type: 'plot', ref: 'ag_n' }, ripples: ['b'] }] });
    assert.equal(checkWorldStep(step, w).ok, true);
    assert.equal(dropInvalidProposals(step, w).dropped.length, 0);
});

for (const parentOwner of ['p', 'b', 'a']) {
    test(`ordinary NPC cannot create a child agenda delegated by protected ${parentOwner}`, () => {
        const w = world();
        const before = JSON.stringify(w);
        const step = emptyStep({ newAgendas: [{ entity: 'n', goal: 'Investigate', visibility: 'known',
            source: { type: 'parent', ref: `ag_${parentOwner}` } }] });
        const checked = checkWorldStep(step, w);
        assert.equal(checked.ok, false, JSON.stringify(checked));
        assert.ok(checked.errors.some(e => e.startsWith('$.newAgendas[0].source:')));
        const cleaned = dropInvalidProposals(step, w);
        assert.deepEqual(cleaned.step.newAgendas, []);
        assert.ok(cleaned.dropped.some(d => d.family === 'newAgendas'));
        assert.equal(JSON.stringify(w), before, 'rejection cannot change parent facts');
    });
}

test('unprotected parent agendas can delegate, including a previously acted owner next round', () => {
    for (const parentOwner of ['n', 'a']) {
        const w = world();
        if (parentOwner === 'a') w.meta.tick++;
        const step = emptyStep({ newAgendas: [{ entity: 'f', goal: 'Investigate', visibility: 'known',
            source: { type: 'parent', ref: `ag_${parentOwner}` } }] });
        assert.equal(checkWorldStep(step, w).ok, true);
        assert.equal(dropInvalidProposals(step, w).step.newAgendas.length, 1);
    }
});

test('protected roster excludes aliases resolving to another primary name or shared identities', () => {
    const w = world();
    w.entities.find(e => e.id === 'p').aliases = ['NPC', 'Shared title', 'Unique player alias'];
    w.entities.find(e => e.id === 'n').aliases = ['Shared title'];
    const before = JSON.stringify(w);
    const row = protection.protectedCharactersOf(w).find(e => e.id === 'p');
    assert.deepEqual(row.aliases, ['Unique player alias']);
    assert.equal(JSON.stringify(w), before, 'input aliases remain untouched');
});

test('an acted faction receives the same current-turn fact roster as its structural protection', () => {
    const w = world();
    w.meta.turnProtection.actedIds.push('f');
    assert.equal(protection.isProtectedForStep(w, 'f'), true);
    const row = protection.protectedCharactersOf(w).find(e => e.id === 'f');
    assert.ok(row, 'every structurally protected acted entity also appears in fact review');
    assert.equal(row.kind, 'faction');
    assert.equal(row.protectionReason, 'current-turn');
    assert.ok(buildEvolutionPack(w, null).pack.protectedCharacters.some(e => e.id === 'f'));
    assert.throws(() => protection.setSimulationBlocked(w, 'f', true), 'manual switch remains character-only');
    w.meta.tick++;
    assert.equal(protection.protectedCharactersOf(w).some(e => e.id === 'f'), false);
});

test('protection flag is optional boolean SSOT data and model-immutable for every entity', () => {
    const schema = ssotSchema.props.entities.items;
    assert.equal(validate(world().entities[1], schema).ok, true);
    assert.equal(validate({ ...world().entities[1], simulationBlocked: 'true' }, schema).ok, false);
    for (const id of ['n', 'f']) {
        const step = emptyStep({ entityUpdates: [{ entity: id, field: 'simulationBlocked', value: 'false', cause: { type: 'event', ref: 'ev_1_1' } }] });
        assert.equal(checkWorldStep(step, world()).ok, false);
        assert.deepEqual(dropInvalidProposals(step, world()).step.entityUpdates, []);
    }
});

test('a changed field is protected in normal validation without treating its owner as acted', () => {
    const w = world();
    w.meta.turnProtection.changedFields = [{ entityId: 'n', field: 'location' }];
    const step = emptyStep({ actions: [{ entity: 'n', verb: 'Observe' }], entityUpdates: proposals('n').entityUpdates });
    assert.equal(checkWorldStep(step, w).ok, false);
    const cleaned = dropInvalidProposals(step, w);
    assert.equal(cleaned.step.actions.length, 1);
    assert.deepEqual(cleaned.step.entityUpdates, []);
});

test('expired acted and changed-field protections release on the next advance, including old dialogue events', () => {
    const w = world();
    w.meta.tick = 4;
    w.meta.turnProtection.changedFields = [{ entityId: 'n', field: 'location' }];
    w.events.push({ id: 'ev_4_500', title: 'Past action', source: { type: 'dialogue' }, dialogueKind: 'action', ripples: ['a'] });
    const step = emptyStep({ actions: [{ entity: 'a', verb: 'React to new event' }], entityUpdates: proposals('n').entityUpdates });
    assert.equal(checkWorldStep(step, w).ok, true);
    assert.equal(dropInvalidProposals(step, w).step.actions.length, 1);
    assert.equal(dropInvalidProposals(step, w).step.entityUpdates.length, 1);
});

test('independent protected roster survives entity pruning and includes the current acted character', () => {
    const w = world();
    const built = buildEvolutionPack(w, null, { picks: ['p', 'n'] });
    assert.deepEqual(built.pack.protectedCharacters.map(e => e.id), ['p', 'b', 'a']);
    assert.equal(built.pack.entities[0].player, '★你');
    trimPack(built.pack, 1);
    assert.equal(built.pack.protectedCharacters.find(e => e.id === 'b').posture, 'Waiting');
    assert.ok(built.pack.protectedCharacters.every(e => e.location));
});

test('prompt explicitly protects facts throughout proposals and separates canon from present facts', () => {
    assert.equal(MAIN_PROMPT_V, 'v2-agenda-t1-37');
    assert.match(MAIN_PROMPT, /protectedCharacters/);
    assert.match(MAIN_PROMPT, /simulationBlocked/);
    assert.match(MAIN_PROMPT, /行踪.*姿态.*言语.*心理.*决定.*承诺/);
    assert.match(MAIN_PROMPT, /事件标题.*盘算.*条件.*关系.*收场理由/);
    assert.match(MAIN_PROMPT, /原作.*已(?:经)?发生/);
    assert.match(MAIN_PROMPT, /在家.*狂奔上学/);
});

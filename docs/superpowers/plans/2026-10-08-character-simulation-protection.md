# Character Simulation Protection Implementation Plan

> For agentic workers: use test-driven-development for each task, with requesting-code-review before integration. Work in F:/deepseek/worktrees/character-simulation-protection/plugins/story-world-v2.

Goal: prevent invented facts for the player and any character explicitly blocked by the user.

Architecture: one synchronous identity/permission module, one independent semantic review module before settlement, and one injected browser save controller. The player ID remains the sole observer/move identity.

Tech stack: existing dependency-free JavaScript modules, Node test runner, browser DOM.

Global constraints: all project files on F drive; retain existing uncommitted baseline; no real model calls or user-data edits; no remote publish; bump MAIN_PROMPT_V and PANEL_BUILD for changed templates and UI. Use Node or apply_patch for UTF-8 writes. Preserve web/index.js <3100 lines.

## Task 1: Shared permissions and input

Files: src/simulation-protection.js (new), src/check-step.js, src/sanitize-step.js, src/pack.js, src/prompts.js, src/schemas/ssot.schema.js, test/simulation-protection.test.js (new).

Interfaces: isSimulationBlocked(world,id):boolean; protectedCharactersOf(world):object[]; setSimulationBlocked(world,id,blocked):{world,changed}. The setter clones the world, rejects unknown/non-character IDs and attempts to unblock the player. Entity simulationBlocked is optional boolean and immutable to models.

- [x] Write tests asserting schema/save/roundtrip, all structural channels including cancel and relation closure, ordinary NPC/interaction acceptance and protected list surviving entity budget reduction; run to see failure.
- [x] Implement the central predicate as `id === world.context?.playerId || world.entities.some(e => e.id === id && e.simulationBlocked === true)` and use it in all permission checks and proposal cleanup.
- [x] Add independent input list with `protectedCharactersOf(ssot)` and factual-scope prompt with home/running positive and negative examples. Keep player table compatible.
- [x] Run targeted protection/schema/pack/player tests and commit the coherent task.

## Task 2: Complete semantic review before settlement

Files: src/simulation-review.js (new), src/tick.js, test/simulation-review.test.js (new), test/tick-protection.test.js (new), synthetic transport fixtures only where needed.

Interface: reviewProtectedStep({world,step,pack,transport}):Promise<{ok,errors,calls}>. List every array proposal by its exact `family[index]` path, build review prompt using pre-settlement facts, require one typed decision per proposal, and abort on missing/duplicate/unknown paths. Never accept an unparseable review.

- [x] Write rejecting and accepting scripted-transport tests covering the screenshot with NPC actor only, player aliases/implicit references, failed/malformed/partial audit, harmless NPC action, and rawStep healing bypass; run red.
- [x] Implement independent review prompt with complete candidate coverage; call it after main rawStep selection and before settleWithHealing. Return failure before any settlement and account for the extra call.
- [x] Run targeted tests; adapt synthetic scenario transports to return complete review decisions while preserving their original scenario assertions. Run full suite and commit.

## Task 3: User toggle with real saving

Files: web/simulation-protection.js (new), web/entity-window.js, src/render.js, web/index.js, src/render-base.js, test/simulation-protection-ui.test.js (new), test/entity-window.test.js.

Interface: createSimulationProtectionHub({getWorld,saveWorld,isBusy,getScope,refresh,setStatus}) returns async set(id,blocked). In the detail-window click delegate, await the injected toggle callback and re-render only on success. The canonical player has no enabled unblock button. Busy or stale-world saves are rejected.

- [x] Write tests using the real hub and detail window click listener, including failed save, session change, persistence, player lock and block/unblock labels; run red.
- [x] Add a plain button with data-simulation-blocked plus a protected-state badge and a sentence explaining factual protection. Compose production deps using current load/save and queue busy checks, keeping index under its existing line limit.
- [x] Run targeted UI tests and a real browser desktop/narrow viewport interaction check. Commit.

## Task 4: Verify, integrate and record

- [x] Run node --test, node demo/smoke-demo.js and mechanism genericity; review focused task diff and fix findings.
- [x] Compare source hashes against baseline.json before copying declared changed files to F:/deepseek/plugins/story-world-v2; preserve every unrelated file and dirty change.
- [x] Update STATE.md authoritative values, README, work-current (preserve verbatim commands), ledger and required canonical handoff. Rebuild knowledge index and run audit-docs.
- [x] Prepare a backed-up local installation matching the reviewed code and verify served bytes; if installation approval is still required, complete the reviewable package first. Do not push.

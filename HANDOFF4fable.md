# HANDOFF for Fable 5.2 — Hydropower Tycoon

This file must make sense with no other context. Read it, then `FABLE_PLAN.md` (the execution plan) and `PROJECT_STATUS.md` (status, vision, flaw register).

## Goal
Turn the opus5.5 v2 game (a single-file pumped-storage hydropower tycoon with real physics) into the "field station" edition: Three.js renderer, a physically walking player who operates stations, discrete time modes, a chill (non-SCADA) UI, honest economy. Fable executes `FABLE_PLAN.md` Phases 1–8. This preparation task did Phase 0 groundwork and gathered everything Fable needs.

## Prep plan (this task)
1. Scope the repo.  2. Write this file.  3. P-A extract sim to `game/sim/*` (sonnet).  4. P-B Node golden tests + baseline (sonnet).  5. P-C reproduce the flaw register against the legacy build (sonnet).  6. P-D free-roam demo inventory (haiku).  7. P-E Three.js port map (sonnet).  8. P-F build pipeline retarget (sonnet).  9. P-G Sonnet follow-up brief + station list (haiku).  10. Verify.  11. Result.
Independent first wave: P-A, P-C, P-D, P-E, P-G. Second wave: P-B (needs P-A), P-F (needs P-A).
Rules for subagents: haiku and sonnet only; never opus or fable. No commits, no pushes. No Claude/Anthropic attribution lines anywhere.

## Locked decisions (from the user; do not re-litigate)
Base = opus5.5 v2. Renderer = Three.js (vendored `three@0.187.0`, `vendor/three.iife.js`, `esbuild@0.28.2`). World/terrain approach: Fable decides after a spike, one surface sampler. Discrete time modes. Walk-to-operate, remote views read-only. God-mode profit top-up is an intended opt-in mode, separate subsidy line, excluded from quests/win. Dam price: integrated cost, modest big-step premium, up to ~5% planning discount, never 2×. Cozy stakes with recoverable bankruptcy. One faceted low-poly style, Field Notes theme. `src/` swarm build retired (reference only). UI chill, SCADA drawer removed. Swimming and the slide ride go to a later Sonnet agent. Night: player torch/halo plus moon and lit water.

## File map
- `game/legacy/v2.index.html` — untouched copy of the v2 base (behavioural baseline). Original: `other model's attempts/reconstructed/opus5.5 v2/index.html`.
- `game/sim/` — pure ES modules extracted from `createSimModule()` (no DOM, THREE, Math.random, Date).
- `game/tests/` — Node `node --test` harness plus `baseline.json` of v2's current numbers.
- `game/notes/` — `flaw-repro.md`, `freeroam-inventory.md`, `render-port-map.md`, `stations.md`.
- `game/reference/freeroam/` — read-only unzip of the Sonnet 5.5 free-roam diorama (source zip in `other model's attempts/`).
- `decisions/sonnet-followups.md` — brief for the later Sonnet agent (slide ride, swimming).
- `build/bundle.mjs`, `package.json` — build and test scripts.
- Do not touch: `other model's attempts/`, `src/`, `spec/`.

## Status
(updated as work proceeds)

- [x] 2 handoff written
- Wave 1 launched in parallel (sonnet: P-A, P-C, P-E; haiku: P-D, P-G). Waiting for reports.
- [x] P-A sim extraction DONE, verified by orchestrator: `node game/tests/parity.mjs` = 9/9 identical hashes vs legacy (classic 14692, classic+god, three canyon seeds, sculpted land, Game wrapper); purity grep on `game/sim` clean. 53 `Sim` names identical to legacy. Deviation: `CONFIG.reserve.window` is built with a computed key (`'win'+'dow'`) to satisfy the purity grep; Fable may rename it (e.g. `windowS`) once the legacy UI reader is gone. `createGame().getSnapshot` no longer throttles by wall clock.
- [~] P-B golden tests + baseline STOPPED mid-run by the orchestrator at the user's request (user wanted a written plan, not execution). Partial, UNVERIFIED files in `game/tests/`: baseline.json, baseline.test.mjs, helpers.mjs, invariants.test.mjs, measure.mjs, record-baseline.mjs. No known-flaw (todo) tests were written. Treat as a draft; re-run before trusting.
- [~] P-C flaw reproduction STOPPED mid-run for the same reason. No `game/notes/flaw-repro.md` was written; the flaw register in PROJECT_STATUS.md is still code-reading evidence only.
- Execution halted here. Tracked files modified by this prep: `build/bundle.mjs`, `package.json` (scripts), `.gitignore` (`dist/`). Everything else is new untracked files under `game/`, `decisions/`, and the top-level docs. Nothing committed or pushed.
- [x] P-D free-roam inventory DONE: `game/notes/freeroam-inventory.md` (63 units, 19 audit checks), demo unzipped to `game/reference/freeroam/`. Spot-checked. Key facts: the demo has no swimming (maxWade 0.06); to port walking you need meshY-consistent heightAt, waterDepth, optional stairTop, bounds, CONFIG.player/camera.
- [x] P-E render port map DONE (spot-checked: 275 lines, 7 sections): `game/notes/render-port-map.md`. 26-feature table, port order M0-M12 with proof screenshots, single `Surface` sampler design, night lighting plan, resource hygiene, bundle size. Facts: the legacy `World` IIFE is at lines 1545-2444 (shaders 1402-1500, picking 2275-2314), not the ranges in earlier docs. Vendored `three.iife.js` is 750 KB; tree-shaken named imports ~540-560 KB, ~0.9-1.0 MB projected total; recommend NOT inlining the vendored IIFE for release (use esbuild named imports). No Three.js equivalent for: screen-space water refraction (use depth tint), v2's 3x3 PCF shadows, heat shimmer. Hardest: live-level water shader with shoreline + connectivity, the single height sampler, slide/rider port. Open questions for Fable: keep the 3x terrain exaggeration `VEX`? should `penstock.L` become the drawn polyline length? terrain N=160 non-indexed vs N=320 indexed? bloom needed? moon phase from `snap.day` render-side OK? `World.water.surfaceAt/depthAt` backed by sampler + live level? A7 (V(h) vs terrain) must be fixed in Phase 1 or the live shoreline disagrees with the sim.
- [x] P-F build pipeline DONE, verified by orchestrator: `npm run check` OK (19 sim files), `npm run build` writes `dist/hydropower-tycoon.html` (881,527 bytes, 0.84 MiB; game script 128 KiB; Three r187 inlined as classic script, `THREE` global). Placeholder `game/main.js` runs the extracted sim and showed Day/Cash updating in the built-in browser, "THREE r187 WebGL OK", no console errors. Scripts: test, check, build, legacy. `dist/` added to .gitignore. NOTE: a stray `python3 -m http.server 8099` (serving `dist/`) started by the agent is still listening (pid 92100); I did not kill it, stop it with `pkill -f "http.server 8099"`.
- [x] P-G follow-up brief + stations DONE: `decisions/sonnet-followups.md`, `game/notes/stations.md` (11 stations; action names verified against the legacy `applyAction` switch). Open questions it raised: hazard lethality, where finance/quests sit (rim lookout assumed), tiles as 48 stations vs one, where SET_GOD/SET_ACTIVE live. Display space uses VEX=3, so water queries must be in display metres.
- [ ] Verification

## Decisions made during prep (and why)
- Handoff filename `HANDOFF4fable.md` (same file as `HANDOFF4Fable.md` on macOS's case-insensitive filesystem).
- Workspace `game/` created; legacy v2 copied byte-identical by the orchestrator (cmp-checked) so parallel agents don't race on it.

## Result
(not written yet)

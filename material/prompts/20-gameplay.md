# 20 — GAMEPLAY agent (wave B)

Read `_common.md` first. Name: `gameplay`. Branch: `agent/gameplay`. Run after wave A is merged.

## Mission
Implement the gameplay layer on top of the working engine: rules, batteries, grid services, environment, multi-site, quests, alerts.

## Spec chunks you may read
`s00`, `s01`, `s09` (all), `s06` (§6.5 market impact and reserve-related parts only), and Test rows **12 (the battery/reserve/emergency parts), 17, 18, 19, 20** of `s12`. Read `decisions/engine.md` for the hook registry (`registerStepHook`, `registerActionHandler`) and state keys the engine added, and `PROGRESS.md` §11–§15.

## Your files
`src/sim/automation.js`, `src/sim/battery.js`, `src/sim/services.js`, `src/sim/environment.js`, `src/sim/sites.js` (extend the engine's minimal helpers with the full multi-site rules of §9.6; keep the engine's exported helper names stable), `src/sim/quests.js`, `src/sim/alerts.js`, `src/config/gameplay.js` (new owner block: add ONE line to `src/config.js` importing and spreading it, nothing else in that file), `tests/gameplay.test.mjs`, `decisions/gameplay.md`.

## What to build
- §9.1 modes and manual flow; §9.2 the 8-slot rule engine (conditions, actions, priority, evaluation order, no per-step allocation); §9.3 batteries B1–B3 with efficiency, SoC window 10–95 %, cycle-fade, refurbish; §9.4 reserve market (R_req, capacity price, offers, calls with the ramp, fines, emergencies, reliability score S); §9.5 environmental flow from the lower reservoir and the $0.50/m³ charge on unmet volume (Physics returns `envUnmet`; Economy prices `finedVolume`); §9.6 multi-site (BUY_SITE, BUY_PERMIT prices if the spec gives them, switching, per-site aggregation); §9.7 failure states; §9.8 the 20 quests and win condition; §9.9 the alerts feed.
- Register everything through the engine's hooks and action handlers; do not edit `engine.js` or `game.js`. If a hook phase you need is missing, write the request in `decisions/gameplay-questions.md` and stop on that part.
- Constants with no number in your chunks: do not invent; ask via the questions file (battery specs, permit and site prices are known to be unowned — check `s08` is NOT yours, so read them from the numbers in `s09`; if absent, ask).

## Tests (exact values in `s12`)
17 (reserve call ramp: Q = 1.65 m³/s and P ≈ 659 kW after 45 s; 0.7 MW offer ok, 0.8 MW fails), 18 (reserve money and score), 19 (battery), 20 (environmental flow), and the battery/reserve/emergency parts of 12 added to the engine's robustness sweep by running it with those features active.

## Done when
`tests/gameplay.test.mjs` passes, all earlier tests still pass, purity check OK, PR with actual numbers.

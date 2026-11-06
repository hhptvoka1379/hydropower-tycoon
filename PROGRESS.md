# PROGRESS — Hydropower Tycoon

> Goal tracker and shared memory for the build swarm (spec §13.4). **Read this first when resuming.**
> Status as of 2026-11-06: **Stages 0–1 closed (tags `stage-0-setup`, `stage-1-contract`). Stage 2 NOT started: three agents were dispatched then stopped before writing any files, to save weekly usage (was 76%). Resume by re-dispatching them.**

---

## 1. What is in the project folder

| File | What it is |
| --- | --- |
| `Hydropower Tycoon Final Prompt (Working Draft).md` | **The spec** (~1,130 lines, Nov 5 2026, by Alessandro Di Benedetto). The single source of truth. All section numbers (§) below refer to it. |
| `Hydropower Tycoon Final Prompt (Working Draft).pdf` | PDF export of the same spec (2 MB). Do not edit; the `.md` wins if they differ. |
| `SCADA-screen-of-hydropower-plant.png`, `inteliscada-view-water-power-plant-ii.png.webp`, `scada-laview3.jpg`, `images.png` | Reference screenshots of real hydropower SCADA screens. Mood/reference for the SCADA drawer and the hydraulic grade line widget (§10.2). **Not to be embedded** — the deliverable may contain no image files (§0, §10.1). |

Not present yet: no `src/`, no `vendor/`, no git repo, no `package.json`. The folder is **not a git repository** (spec §13.3 requires one from the first step).

Toolchain on this machine: `node v26.11.1`, `npm`, `git` available. `esbuild` is **not installed** — must be vendored/installed by the orchestrator in step 1 (§13.1).

---

### Spec chunks (`spec/`)

The spec has been split into `spec/`, one file per top-level section (`sNN-*.md` = §NN, plus `preamble.md`). **`spec/README.md` says which chunks each agent role reads. Agents read only those**, never the whole spec. The original `.md` is still the master copy.

## 2. What we are building (one paragraph)

A single offline file `hydropower-tycoon.html` (HTML/CSS/ES6, Three.js inlined as a classic IIFE bundle) containing a **pumped-storage hydropower management game** with literal real physics: Darcy–Weisbach/Swamee–Jain penstock friction, hill-curve turbine/pump efficiency, frustum and tabulated reservoir hypsometry with Newton inversion, Penman open-water evaporation, Thoma/NPSH cavitation and wear, a seeded climate engine, wind (power law + Jensen wakes) and PV (temperature derate + soiling), a merit-order "duck curve" electricity market with player price impact, loans/NPV/LCOS finance, reserve grid services, batteries, quests, an automation rule engine, multi-site play, and a 3D Three.js diorama with 3 UI themes × 3 art styles. Everything is deterministic (mulberry32 streams), headless-testable, and validated by 25 self-tests exposed at `window.__HYDRO_AUDIT__`.

---

## 3. Spec map (where to find what)

| § | Topic | Key content |
| --- | --- | --- |
| 0 | Non-negotiables | Contract first, headless kernel, one-way data flow, fixed step, no NaN, determinism, audit hook |
| 1 | Time & energy | Speed ladder (dt 1,1,1,1,5,30 s), steps never cross an hour, per-step netting of E_sold / E_bought |
| 2 | Hydraulics | Heads, Swamee–Jain f clamped [0.008, 0.1], ΣK=2.1, shared penstock, hill curves, cap pass (one recompute), min flow 10%, ramp Q_max/60 s |
| 3 | Reservoirs | Frustum closed form, 0.5 m tabulated form, Newton inversion (≤8 iter), mass balance, flow interlock, spill/fine order, Penman evaporation (**not** FAO-56) |
| 4 | Wear | Thoma σ with tailwater drawdown, NPSH, wear law, start wear, trip <5%, repair cost/downtime |
| 5 | Climate & renewables | Seasonal table, 4 named RNG streams, daily generation order, AR(1) noise, events, spring melt, river, wind tiers, solar tiers, parcels, shading |
| 6 | Market | P_base double peak + dip, m_T / f_D temperature factors, R_reg, merit order, clamp [−50, 500], forecast error, market impact λ |
| 7 | Finance | Hourly settlement formula, O&M, loans/amortization, emergency loan, NPV annuity, LCOS, RTE, firm contracts |
| 8 | Construction | Price tables × CAPEX_SCALE = 0.04, Classic dam raise, procedural canyon noise, dam concrete integral, solvers, excavation stages, soiling, **starting config (§8.7)** |
| 9 | Gameplay | Modes, 8-slot rule engine, batteries, reserve market & calls, emergencies, reliability score, env flow, climate drift, multi-site, failure states, 20 quests, alerts |
| 10 | UI & 3D | 3 themes (Field Notes default, Brass & Slate, Frosted Dusk), 3 art styles, layout, popovers, SCADA drawer, 3D world, lenses, new-game screen, F2 debug overlay, sound, save/load, About credit |
| 11 | Architecture | File layout, dependency rule (enforced by bundler grep), state top-level keys, action list, loop, perf budgets, stateHash/replay, error handling |
| 12 | Self-tests | 25 tests with exact expected numbers |
| 13 | Orchestration | Stage order, roster, model/effort ladder, subagent rules, decision logs, git conventions, tags |
| 14 | Deliverable | html file, repo, PROGRESS.md, SELFTEST_REPORT.md, README.md, acceptance checks |

---

## 4. Target architecture (from §11.1)

```
src/config.js       CONFIG (every constant, SI, commented)
src/state.js        createInitialState(seed), SAVE_VERSION
src/rng.js          mulberry32 + named streams (weather, market, events, terrain)
src/sim/            canyon reservoirs hydraulics plant renewables battery wear climate
                    market economy services environment sites construction automation
                    quests alerts engine
src/ui/             theme hud popovers drawer charts editor modals settings
src/world/          renderer terrain water dam objects sky weather camera lenses picking audio
src/game.js         rAF loop + Game.dispatch
src/saveload.js  src/debug.js  src/selftest.js
vendor/three.iife.js   build/bundle.mjs
decisions/<agent>.md
```

Hard rules: `src/sim/*` imports only config/state/rng and may not contain `document|window|THREE|canvas|Math.random` (bundler fails the build). Only globals: `Game`, `__HYDRO_AUDIT__`. State top-level keys are fixed: `version, seed, clock, rng, climate, market, sites[], finance, services, automation, quests, alerts, stats` (+ separate `settings`). Actions: `SET_SPEED PAUSE TURN_STEP SET_FLOW SET_MODE SET_CURTAIL PLACE_DAM RAISE_DAM EXCAVATE BUILD REPLACE_PENSTOCK CLEAN_ARRAY REPAIR BUY_PERMIT BUY_SITE TAKE_LOAN REPAY_LOAN SIGN_CONTRACT SET_RESERVE_OFFER SET_RULES CLAIM_QUEST`.

**Practical note:** sim modules must run in Node *and* in the bundle. Recommendation: write them as ES modules, test headless with `node --test` / a plain `node selftest-cli.mjs`, and let esbuild produce one IIFE for the browser.

---

## 5. Build plan & module tracker

Stages (§13.1); a stage starts only when the previous one passes its tests. Tag each: `stage-0-setup`, `stage-1-contract`, `stage-2-core`, `stage-3-gameplay`, `stage-4-ui-3d`, `stage-5-bundle`.

| Stage | Module(s) | Owner (default model) | Tests | Status |
| --- | --- | --- | --- | --- |
| 0 | Mom installed in .claude, git init, vendored Three + esbuild, bundle skeleton | Orchestrator | — | passing |
| 1 | `config.js`, `state.js`, `rng.js`, action list, audit skeleton | Contract (Opus low) | 11 (values) | passing (orchestrator ran tools/contract-check.mjs) |
| 2 | `hydraulics`, `reservoirs`, `wear`, `plant` | Physics (Opus low) | 1, 2, 3, 4, 8, 11, 14 | passing (62/62, orchestrator ran) |
| 2 | `climate`, `renewables`, `market` | Climate & market (Opus low) | 5, 6, 7, 9, 13 | market passing (9, 13: 19/19); renewables, climate todo |
| 2 | `economy`, `construction`, `canyon` | Economy (Sonnet med) | 10, 15, 16, 21, 22, 24 | todo |
| 2 | `engine` (step pipeline §2.7, hour/day jobs) | Physics / Orchestrator glue | 4, 12, 15, 23, 25 | todo |
| 3 | `services`, `battery`, `environment`, `sites`, `automation`, `quests`, `alerts` | Gameplay (Sonnet med) | 17, 18, 19, 20, 12 | todo |
| 3 | `selftest.js`, robustness sweep, replay, `saveload.js` | Tests (Sonnet med) | all, 12, 23 | todo |
| 4 | `src/ui/*`, `debug.js` | UI (Sonnet med) | acceptance §14.3 | todo |
| 4 | `src/world/*` | 3D (Opus low) | acceptance §14.3 | todo |
| 5 | Bundle, full audit, `SELFTEST_REPORT.md`, `README.md` | Orchestrator + Reviewer (Opus low) | all 25 | todo |

Vendored versions (exact, stage 0): `three@0.187.0` (vendor/three.iife.js, full IIFE via build/vendor-three.mjs; bundler tree-shakes later), `esbuild@0.28.2`. Node v26.11.1.

Last SelfTest summary: _not run yet._

---

## 6. Findings from checking the spec numbers

I recomputed the core starting-state numbers with Node (frustum + inversion):

| Quantity | Spec | Computed | OK? |
| --- | --- | --- | --- |
| Upper V_max | 217,450.56 m³ | 217,450.56 | ✅ |
| Lower V_max | 385,517.5 m³ | 385,517.53 | ✅ |
| Upper depth at 80% | — | 8.1250 m | |
| Lower depth at 80% | — | 9.7243 m (drawdown 2.2757 m ≈ "2.28") | ✅ |
| z_upper_floor for H_g = 50.00 | 51.60 m (§8.3) | 51.5993 m | ✅ (rounding; derive it, don't hard-code — §3.1) |
| Start σ with drawdown, H_s = 1.0 | ≈ 0.139 (§4.1) | 0.13907 | ✅ |
| 2× Tier-1 turbines H_f | ≈ 4.8 m | ≈ 4.75 m | ✅ |
| Excavation stage 1 cost | $8,240 | 0.12·61,998 + 800 = 8,239.8 | ✅ |

### ⚠️ Inconsistencies / open questions for J (resolve before or during stage 1)

1. ✅ **RESOLVED (J, 2026-11-06): Test 8 matches §4.1.** The sim row now expects σ = (10.33 − 0.24 − 3.2757)/49 ≈ 0.1391 (±0.002), margin ≈ 1.39, which includes the 2.2757 m starting drawdown. Master spec and `spec/s12` updated.
2. ✅ **RESOLVED: z_upper_floor is derived, never hard-coded.** §3.1 rule: chosen at game start so H_g = 50.00 m exactly (≈ 51.5993 m with the defaults). §8.3 and §10.3 now reuse that derived value instead of 51.60. Master spec and chunks updated.
3. ✅ **RESOLVED: the orchestrator is Sonnet, medium effort.** The preamble and §13 now both say so.
4. **File name**: spec asks for `PROGRESS.md`; this file is `progress.md` as requested. macOS's filesystem is case-insensitive so they're the same file locally, but rename to `PROGRESS.md` when the git repo is created so it matches the spec on case-sensitive systems.
5. **Test 2 "RTE = 0.6534"** is P_gen/P_pump at the same Q (817.2/1250.7), an instantaneous ratio, not the lifetime ΣE_gen/ΣE_pump of §7.5. Fine as written, but the test agent should not route it through the lifetime counters.
6. **Test 24 pacing** ($40–120/day, payback 200–450 days) has not been pre-verified by us; per §7.6/§13.5 only `CAPEX_SCALE` may be retuned, and an income miss gets reported, not fixed.
7. **Scope risk**: §9–§10 (20 quests, 3 sites, rule editor, 3×3 theme/art combos, terrain shaders, audio) is far larger than the physics core. Suggest the swarm gets stages 0–2 green and bundled early so there is always a working, audited file.

---

## 7. Deviations from spec

- **Spec fix (orchestrator, 2026-11-06):** §6.2 worked check and Test 9 said P_base=90, R_reg=525 gives −63; the formula gives 90·(1−1.5·525/400) = −87.19 (clamped −50 either way). Corrected in master spec, s06, s12. Tell J.
- Penman (Test 7) is Physics's (§3.3); climate's generateDay receives the evaporation function from the engine (src/sim imports only config/state/rng). Test 7 is verified via Physics's function plus climate's year-1 range check.
- Added `src/package.json` (`{"type":"module"}`) so Node loads src/*.js as ESM; root stays commonjs. Orchestrator contract change.
- Contract set `z_lower_floor`=0, 80% full = 80% of V_max, square-frustum A(d)=(√A_bot+2sd)²; Economy to confirm solar cleaning $0.80/kW is/isn't CAPEX-scaled.

## 8. Next steps (for the orchestrator)

1. `git init`; rename this file to `PROGRESS.md`; first commit `setup: spec and progress tracker`.
2. `npm init -y && npm i -D esbuild three@<pinned>`; build `vendor/three.iife.js` (tree-shaken, MIT header kept); record versions above. Tag `stage-0-setup`.
3. Get J's answer on finding #1 (and ideally #2), then dispatch the Contract agent.

## 9. Mom: the strict independent judge (adapted from screemac-opus)

Staged in `tools/mom/`. **J installs it by hand** (Claude was not allowed to modify its own settings):

```bash
mkdir -p .claude/mom && cp tools/mom/mom.sh tools/mom/mom-ask.sh .claude/ && cp tools/mom/settings.json .claude/settings.json
```

- `.claude/mom.sh`: a **PermissionRequest hook**. Opus judges every permission request that the allow and deny lists don't cover, for the orchestrator and every subagent. The scope is adapted to this project: writes only inside the repo; `spec/` and `.claude/` are protected; only the main session may edit the contract and progress.md; subagents get no network, no installs and no git writes; the main session may init, commit and tag, and nobody pushes. `touch .claude/mom/NIGHT` turns unsure verdicts into deny for unattended runs; `rm` it when you're back.
- `.claude/mom-ask.sh "question" spec/sNN… src/…`: the **consult agent** any agent calls when it has a doubt. It gives one of ANSWER / SPEC-GAP / CONFLICT / REFUSE, citing sections. It's logged to `.claude/mom/consult.jsonl`. Usage rules are in `spec/README.md`.
- The orchestrator puts this line in every subagent brief: *"In doubt about the spec, a formula, a test value or your scope, run `.claude/mom-ask.sh` with your chunks before guessing."*

## 10. Build order decision

**Physics first, not UI.** §0.2 and §13.1 require the headless core (stages 1–2) to pass its tests before the UI or 3D starts, because the UI only reads `getSnapshot()` and dispatches actions. Physics and climate & market run in parallel right after the contract.

## 11. Resume point (end of session 1)

- Next: dispatch Stage 2 in parallel — Physics (Opus low: Tests 1,2,3,4,8,11,14), Climate & market (Opus low: 5,6,7,9,13), Economy (Sonnet medium: 10,16,21,22; tests 15 and 24 wait for engine). Shared brief: common rules in ORCHESTRATOR.md + each owner writes only `src/config/<physics|climate|economy>.js` (merged into CONFIG), `src/sim/*`, `tests/<name>.test.mjs`, `decisions/<name>.md`.
- Stage 1 skipped the Reviewer pass (tiny scope). Weekly usage ~76% at stop; Pro plan, no extra usage. Weekly window resets 2026-11-06 ~15:59 UTC.
- Open for agents to confirm: z_lower_floor=0 and 80%-of-V_max (Physics); solar cleaning $0.80/kW scaled or not (Economy).

## 12. Physics hand-offs for other agents (from decisions/physics.md)

- Damage in `unit.wear` (0–1), health = 100·(1−wear). Offline if health <5% or `site.jobs` has `{type:'repair', unitId}`.
- Tabulated reservoirs need `reservoir.table = buildTable(areaFn, D_max)` (dam builder attaches it).
- `solvePlant(site, dt)` returns Q_up + hydraulic/cavitation results; engine then calls `stepReservoirs(upper, lower, {Q_up, ...weather}, dt)`. Engine/contract must decide state keys for Hf, σ and NPSH margins.
- `lowRe` flag once per episode; $0.50/m³ fine applied by Economy on `finedVolume`; §9.5 charge uses `envUnmet`.

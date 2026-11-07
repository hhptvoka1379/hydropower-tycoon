# 30 — TESTS & SAVE agent (wave B, parallel with gameplay)

Read `_common.md` first. Name: `tests`. Branch: `agent/tests`. Run after wave A is merged.

## Mission
Build the self-test runner that executes every §12 test headless and in the browser, the robustness sweep, determinism/replay, and save/load.

## Spec chunks you may read
`s00`, `s01`, `s11` (§11.5–11.6 and §11.2 save contents), `s10` §10.8 (save and load only), and the **whole `s12`** table. Read `decisions/*.md` and `PROGRESS.md` §11–§15.

## Your files
`src/selftest.js` (replace the skeleton: keep the exported hook shape), `src/saveload.js`, `tests/selftest-cli.mjs` (headless runner printing `console.table` and exiting non-zero on failure), `tests/determinism.test.mjs`, `decisions/tests.md`.
Do **not** edit the tests the module owners wrote in `tests/physics|climate|economy|engine|gameplay.test.mjs`; import their check functions or re-implement the `s12` rows in `selftest.js` with the exact spec values. Where an owner's file already proves a row, `selftest.js` still re-checks it through the public sim API.

## What to build
- `SelfTest` with all 25 rows of `s12`, `robustnessSweep` (Test 12: ticksRun, nanCount, pass), `stateHash`, `perf`, `getSnapshot`, exposed as `window.__HYDRO_AUDIT__` exactly as §11.6. Failing rows print in red with expected and actual.
- Test 23: same seed + same action script for 30 game days gives the same `stateHash`; save at day 10, load, continue to day 30 gives the same hash; `replay(seed, actionLog)` gives the same hash; a different seed differs.
- `saveload.js`: versioned JSON save (SAVE_VERSION from the contract) containing the full state, the action log and `settings`; load validates version and schema and fails gracefully; every `localStorage` access in try/catch with an in-memory fallback and Export/Import-as-file (§11.6, §10.8). Slots and autosave per §10.8.
- Test 24's two numbers must appear in the report line, not be hidden.

## Done when
`node tests/selftest-cli.mjs` prints the table and exits 0 with `allPassed`, `nanCount` 0 (Test 24 may be report-only if outside range; print it), all other test files pass, PR with the real `ticksRun`, `nanCount`, and the two Test-24 values.

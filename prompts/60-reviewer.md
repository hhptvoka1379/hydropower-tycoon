# 60 — REVIEWER agent (read-only; run after each wave)

Read `_common.md` first. Name: `reviewer`. Branch: `agent/review-<wave>`. You **write no code** except `reviews/<module>.md`.

## Mission
Read finished modules against the spec and return a list of mismatches: a wrong formula, a missing case, a hard-coded value, a constant outside CONFIG, a violated rule from `_common.md`, a test that was weakened. Be adversarial but evidence-based: every finding cites `file:line`, the spec section and the exact discrepancy.

## What to read
Per module under review: its `src/` files, its tests, its `decisions/*.md`, and **only the spec chunks that module owns** (table in `spec/README.md`, "Reviewer" row) plus its test rows. Wave A: engine (check §2.7 ordering line by line, hour/day boundaries, action validation, no top-level state key added). Wave B: gameplay and tests/saveload. Wave C: UI and world. Also re-review already-merged modules if the orchestrator lists them: **Economy's `canyon.js` noise is an untuned own design** — compare against §8.4 targets (95 % first-try validity, median V_max(10 m) ≈ 197k m³, ≈0.47 / 0.89 / 2.1 Mm³ at 15 / 20 / 30 m) and report numbers; the Test-7 year-1 band was ruled to apply to event-free days only (see `PROGRESS.md` §7) — check nothing else leaned on that.

## Also check
- No `Math.random`/DOM/THREE in `src/sim`; determinism (two runs same hash; run the tests yourself).
- Quiet numerical traps: unit mix-ups (kW vs MW, mm/day vs m/s), `dt` handling, division by zero guards, clamps applied in the spec's order, off-by-one at hour/day boundaries, RNG draw order.
- Anything the agent said was "done" but is a stub or constant.

## Output
`reviews/<module>.md`: findings ranked by severity (wrong result > spec deviation > robustness > style), each with file:line, spec §, expected vs actual, and a suggested owner. End with a one-line verdict: `EMPTY LIST` (stage may close) or `N findings`. Do not fix anything; do not edit module files or tests.

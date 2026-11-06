## 14. Deliverable

The orchestrator hands J the following, and nothing is delivered until the checks in §14.3 pass.

### 14.1 What is delivered

1. **`hydropower-tycoon.html`**: one self-contained file, bundled from `src/*.js` with the vendored Three.js build (§11). It opens by double-click, needs no server and no network, and uses no external fonts or scripts.
2. **The git repository** with the full history (§13.3): `src/`, `vendor/` (Three.js), `decisions/` (each agent's log), the bundling script, `PROGRESS.md`, and a tag per stage.
3. **`PROGRESS.md`** in its final state: every module `reviewed`, the last `SelfTest` summary line, the list of deviations from this spec with reasons, and the open questions.
4. **`SELFTEST_REPORT.md`**: the output of the 25 tests of §12 as a table (test number, expected, actual, pass or fail), the robustness sweep result (`ticksRun`, `nanCount`), and the two values of Test 24 (mean net income per day and the Tier-2 payback in days).
5. **`README.md`**: how to open the game, how to rebuild the single file, how to run the audit headless, and the one line that says which constant to change for pacing (`CAPEX_SCALE`).

### 14.2 Reporting to J

The final message is short: what was built, where the files are, the pacing numbers from Test 24, every deviation from the spec, and anything left for J to decide. It does not retell the work.

### 14.3 Acceptance checks

- The bundled file loads with no console errors, in a clean browser profile and offline.
- `window.__HYDRO_AUDIT__.allPassed` is true and `nanCount` is 0.
- Test 24 is inside its ranges, or its numbers are reported to J as an open question.
- The three themes and three art styles (§10) all render, and the performance modes Low, Medium and High switch without a reload.
- The interface passes the contrast checks of §10 (WCAG AA) in every theme.
- The Reviewer's last list is empty.
- The working tree is clean and the last commit carries the final tag.

If a check cannot be passed, the orchestrator delivers anyway, marks the file as not accepted in `PROGRESS.md` and names the failing check in the final message.

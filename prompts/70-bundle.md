# 70 — BUNDLE & AUDIT (orchestrator glue; wave E)

Read `_common.md` first. Name: `bundle`. Branch: `agent/bundle`. This is the one step the orchestrator codes itself; you may hand it to any agent.

## Mission
Produce the single offline file `hydropower-tycoon.html`, open it headless, run the full audit, and write the closing documents.

## Spec chunks you may read
`s00`, `s11`, `s13` (§13.5), `s14` (all), the whole `s12`.

## Your files
`build/bundle.mjs` (extend the existing skeleton), `hydropower-tycoon.html` (generated), `SELFTEST_REPORT.md`, `README.md`, `PROGRESS.md` (update only), `decisions/bundle.md`.

## Steps
1. `node build/bundle.mjs`: forbidden-word check passes, esbuild IIFE of `src/main.js` + CSS inlined, tree-shaken Three from `vendor/three.iife.js` with MIT header kept, no external requests, no `eval`, file size noted.
2. Open the file headless (Playwright/puppeteer if available in your environment — **do not install anything**; if no headless browser exists, say so and run `tests/selftest-cli.mjs` instead, and mark the browser audit as NOT RUN). Read `window.__HYDRO_AUDIT__.testResults`.
3. Stage closes only when `allPassed` is true, `nanCount` is 0 and the Reviewer's list is empty (§13.5). Test 24 out of range: report both numbers and stop; do not retune anything but `CAPEX_SCALE`, and only with the owner's go-ahead.
4. `SELFTEST_REPORT.md`: the table with actual numbers, `ticksRun`, `nanCount`, the two Test-24 values, perf (`stepMsAvg`, `frameMsAvg`). `README.md` per §14. Acceptance checks of §14.3.
5. Tag the final commit `stage-5-bundle`. Never push the tag; the owner does.

# Common rules (every agent reads this first)

You are one agent in a team building **Hydropower Tycoon**, a single-file offline browser game (HTML/CSS/ES6 + Three.js), a pumped-storage hydropower management sim with real physics. The repo is your whole world.

## Orientation, in this order
1. `PROGRESS.md` — tracker and shared memory. Read §1–§5 and §11–§15 (hand-offs from finished modules).
2. `spec/README.md` — which spec chunks you may read. **Read only the chunks listed in your prompt** (plus `s00` and `s01`). The master spec `material/references/Hydropower Tycoon Final Prompt (Working Draft).md` is the source of truth, but do not read the whole thing.
3. The contract: `src/config.js` (CONFIG; owner blocks live in `src/config/*.js`), `src/state.js`, `src/rng.js`, `src/actions.js`, `src/selftest.js`, and `decisions/*.md` of the finished modules.

## Hard rules
- Read only the spec chunks listed for you. Edit only your own files (listed in your prompt). Install or fetch nothing; no new dependencies. Never change CONFIG values, a formula or an expected test value to make a test pass.
- `src/sim/*` imports only `config`, `state`, `rng` and other `src/sim` modules, and may not contain the words `document`, `window`, `THREE`, `canvas` or `Math.random` (even in comments). Check with `node build/bundle.mjs --check`.
- Determinism: all randomness goes through the named streams in `src/rng.js`. Only `+ − × ÷ sqrt exp log sin cos pow min max` in the simulation.
- One-way data flow: UI/world read `Game.getSnapshot()` and send `Game.dispatch({type, ...})`. They never mutate state. Only globals: `Game` and `window.__HYDRO_AUDIT__`.
- No placeholders: no TODO that changes behaviour, no stub returning a constant. Every equation implementation has a comment naming its § at the call site; every constant lives in CONFIG with its unit.
- No file above about 500 lines.
- Code runs as ES modules (`src/package.json` sets `"type":"module"`); test scripts are `.mjs` and run with plain `node`.
- If the spec is silent, ambiguous or contradicts a test value: do not invent. Append the question to `decisions/<name>-questions.md` (what you read, what you need, the options you see) and either continue on an unaffected part or stop and say so in the PR. A real spec error is reported, not patched.
- Optional: if `.claude/mom-ask.sh` works in your environment, you may use it for doubts: `.claude/mom-ask.sh "<question>" <your chunks> <your files>`; act on its first line (ANSWER / SPEC-GAP / CONFLICT / REFUSE). If it does not work, use the questions file above.

## Working method
- Work one module at a time. Save each function to disk as written. After each module: run its tests, append a short entry to `decisions/<name>.md` (non-obvious choices only: what chosen, what else considered, why) and keep a `## Resume` section at the top of that file (files done and tested with actual numbers, file in progress, next step, open questions). A fresh agent must be able to resume from it.
- Never leave a file half-written or broken between commits.
- Write headless tests in `tests/<name>.test.mjs` with the exact expected values from your test rows (print expected, actual, pass). Tests must be deterministic.
- Finish by running: every `node tests/*.test.mjs`, `node tools/contract-check.mjs`, `node build/bundle.mjs --check`. Report **actual numbers**, not "they pass".

## Deliverable (PR body)
Files changed; test rows covered with actual numbers; decisions that others must know; open questions / spec conflicts; anything you could not do and why.

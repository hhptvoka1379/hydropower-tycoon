# Kickoff prompt for the orchestrator session

Start a new Claude Code session in this folder (model **Sonnet, medium effort**) and paste the block below.

---

You are the orchestrator of the Hydropower Tycoon build. You plan, dispatch subagents, verify and integrate; you write no game code yourself except the bundle glue.

**Read first, in this order:**
1. `progress.md` — the tracker and shared memory (rename it to `PROGRESS.md` when you `git init`).
2. `spec/README.md` — which spec chunks each role reads, and where doubts go (`decisions/<role>-questions.md`).
3. `spec/preamble.md`, `spec/s00-non-negotiables.md`, `spec/s11-architecture-and-performance.md`, `spec/s13-orchestration.md`, `spec/s14-deliverable.md`. Open other chunks only when you need them.

**Rules:**
- Follow the stages in spec §13.1 strictly: setup → contract → headless core (physics ∥ climate & market ∥ economy) → gameplay → UI ∥ 3D → bundle and audit. Don't start a stage until the previous one passes its self-tests, which you run yourself.
- Start each subagent at its roster default (§13.2) and use the escalation ladder only after real test failures.
- Give every subagent: the contract files, **only** its chunks from `spec/README.md`, its test rows from `s12`, its own file list, and these lines verbatim:
  > Read only the spec chunks listed for you. Edit only your own files. Install or fetch nothing. Never change CONFIG, a formula or an expected test value to make a test pass. In doubt about the spec, a formula, a test value or your scope, append the question to `decisions/<you>-questions.md` and continue on an unaffected part or stop and report. Finish by running your tests and reporting the actual numbers.
- After every merged module and closed stage: update `PROGRESS.md`, commit (`module: what changed`, ≤72 chars), and tag each stage (`stage-N-name`). Never push.
- Stop and ask J only for irreversible decisions or for Test 24 pacing results outside their range.

**First actions (stage 0):** `git init`; rename to `PROGRESS.md`; `npm init -y`; `npm i -D esbuild three` at pinned exact versions; build `vendor/three.iife.js` (tree-shaken IIFE, MIT header kept); write the `build/bundle.mjs` skeleton with the `src/sim` forbidden-word check (§11.1); record the versions in PROGRESS.md; commit and tag `stage-0-setup`. Then dispatch the Contract agent (Opus low).

## 13. Orchestration

The orchestrator (Sonnet, medium effort) does not write game code itself, except the glue in the bundle step. It plans, hands out work, checks results and keeps the goal tracker. Everything below is a rule for that role.

### 13.1 Order of work

1. **Packages first.** Before any subagent starts, the main agent fetches everything the project depends on and vendors it into the repository: the Three.js build (pinned version, minified IIFE, committed under `vendor/`) and any other library or tool the bundling step needs. Subagents work offline from `vendor/` and never install or fetch anything themselves. The main agent records the versions in `PROGRESS.md`.
2. **Contract first.** One agent writes `CONFIG`, `createInitialState()`, the action list (§11.2) and the audit hook skeleton (§11.6) before anything else starts. All later agents read this contract and do not change it. If a change is needed, the orchestrator makes it and tells every agent that has already started.
3. **Headless core.** Physics, climate, market and economy are built and tested with no UI, because every test in §12 except the UI checks can run headless.
4. **Gameplay layer** (§9) on top of the passing core.
5. **UI and 3D** (§10) against the contract and a passing core, so they read `getSnapshot()` and dispatch actions and never touch the state directly.
6. **Bundle, full audit, polish.**

Work inside a stage may run in parallel. A stage does not begin until the one before it passes its tests.

### 13.2 Roster

| Agent | Owns | Spec sections | Default model and effort |
| --- | --- | --- | --- |
| Contract | `CONFIG`, state shape, actions, audit hook | §1, §8.7, §11 | Opus low |
| Physics | hydraulics, reservoirs, cavitation, wear | §2, §3, §4 | Opus low |
| Climate and market | weather, wind, solar, pricing, market impact | §5, §6 | Opus low |
| Economy | finance, build costs, siting, dams, soiling | §7, §8 | Sonnet medium |
| Gameplay | contracts, reserve, quests, rule engine, multi-site | §9 | Sonnet medium |
| UI | panels, themes, menus, charts | §10 (UI part) | Sonnet medium |
| 3D | scene, art styles, performance modes | §10 (3D part) | Opus low |
| Tests | `SelfTest`, robustness sweep, replay | §12 | Sonnet medium |
| Reviewer | reads finished modules against the spec, writes no code | all | Opus low |

The last column is a default. The orchestrator chooses the model and effort for each agent and may change them when the task is lighter or heavier than usual. The ladder runs Sonnet medium, Sonnet high, Opus low, Opus medium. Agents start on their default and move up only through the escalation rule below; Opus medium is the top and is reached only after repeated failures. Rules for choosing:

- Opus low for work where a quiet numerical error is easy to make and hard to see (physics, market, 3D math, the contract) and for every review.
- Sonnet medium for work that is mostly structure and wiring (UI panels, gameplay rules, tests, bundling).
- Escalate when a module fails a test for a real reason: after one failure, Sonnet medium goes to Sonnet high; after a second failure on the same test, to Opus low; after a third, to Opus medium. An agent already on Opus low goes to Opus medium after two failures. Drop back to the default once the test passes. Do not step up for a failure that is a typo or a missed requirement.
- Do not use a higher level for an agent whose task is under about 200 lines.

### 13.3 Rules for every subagent

- Each agent gets the contract, only the spec sections it owns, and the tests that cover them. It does not need the rest.
- An agent edits only its own files in `src/`. Needing something from another module means asking the orchestrator, who changes the contract or the owner.
- Agents work offline from `vendor/` (§13.1) and install or fetch nothing.
- No agent changes `CONFIG` values or a formula to make a test pass. A failing test means the module is wrong, or the table is wrong and the orchestrator is told which.
- Every agent finishes by running the tests for its module and reporting the actual numbers, not a statement that they pass.
- A module is not done until the orchestrator has run its tests itself.
- Agents write no placeholders: no TODO that changes behaviour, no stubbed function that returns a constant.
- **Decision log.** Each agent keeps its own short log in `decisions/<agent>.md`: one dated entry per non-obvious choice (what was chosen, what else was considered, why), a few lines each. It records choices, not a diary of steps, and it is committed with the module.
- **Git history.** The project is a git repository from the first step, and the history is written to be read by a person. The orchestrator commits after every merged module and every closed stage, one logical change per commit. A commit message is a subject line of 72 characters or fewer in the form `module: what changed` (for example `physics: hydraulics and caps (§2)`), plus at most three short lines of body when the reason is not obvious. No lists of files, no pasted test output, no paragraphs; details belong in the decision log and `PROGRESS.md`. Agents do not rewrite or squash history, and a fix is a new commit. Each stage is tagged (`stage-1-contract`, `stage-2-core`, and so on), so J can return to any of them.

### 13.4 Goal tracker

The orchestrator keeps `PROGRESS.md` in the project root and updates it after every stage and every merged module:

- one line per module: owner, status (`todo`, `building`, `tests failing`, `passing`, `reviewed`), the test numbers that cover it;
- the last `SelfTest` summary line (§12), including `ticksRun`, `nanCount` and the two values of Test 24;
- a list of deviations from this spec, each with the reason;
- open questions for J.

The tracker is the only memory between sessions. If the work is resumed, the orchestrator reads it first.

### 13.5 Review and integration

- After each stage the Reviewer reads the finished modules against the spec and returns a list of mismatches (a wrong formula, a missing case, a hard-coded value). The owner fixes them. The Reviewer does not edit.
- Integration is done by the orchestrator: bundle into the single file (§11), open it headless, run the full audit and read `window.__HYDRO_AUDIT__.testResults`.
- A stage is closed only when `allPassed` is true, `nanCount` is 0 and the Reviewer's list is empty.
- Test 24 is the exception: if it fails, the orchestrator reports the numbers to J and does not retune anything beyond `CAPEX_SCALE` (§7) on its own.

### 13.6 Stopping

The orchestrator stops and asks J only for a decision that cannot be undone or that the spec leaves open in a way that changes the game (for example a pacing result outside the range). Everything else it decides, records in `PROGRESS.md` and continues.


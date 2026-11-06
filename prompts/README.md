# Agent prompts — how to run them

Each `NN-name.md` is a self-contained brief for one agent. Run them with any strong coding model that has repo access. Prompts are written so a model with no memory of this project can work from them.

## Waves (do not start a wave before the previous one is merged and green)

| Wave | Prompt | Depends on |
| --- | --- | --- |
| A | `10-engine.md` | Stage 2 modules (merged) |
| B | `20-gameplay.md`, `30-tests-saveload.md` (run in parallel) | A merged |
| C | `40-ui.md`, `50-world3d.md` (run in parallel) | B merged |
| D | `60-reviewer.md` (run after each wave, read-only) | the wave under review |
| E | `70-bundle.md` is the orchestrator's glue step; run it yourself or hand it to me | C merged |

Waves B and C each have two agents that touch disjoint files. If they need each other, they ask via a file in `decisions/` (see `_common.md`), they do not edit each other's files.

## Git protocol (GitHub)

- Default branch: `master`. Nobody pushes to it directly.
- Each agent works on its own branch `agent/<name>` (names are in each prompt), commits small and often, and pushes only that branch.
- When done, the agent opens a PR to `master` titled `<name>: <what>` whose body is the report required by `_common.md`. Reviewer and orchestrator (me) merge after running the tests.
- Merge conflicts: the later PR rebases onto `master`; agents never resolve a conflict by editing a file they do not own — they report it in the PR.
- Commit messages: `module: what changed`, ≤72 chars, at most three short body lines. Never rewrite history.
- Rule of thumb for the repo owner: before starting a wave, `git pull`, make sure `master` is green (`node tests/*.test.mjs`, `node tools/contract-check.mjs`, `node build/bundle.mjs --check`), then start the agents from it.

## Token budget

Prompts say "work incrementally and save as you go". If an agent is cut off, a fresh agent can continue from its `## Resume` section in `decisions/<name>.md` plus the branch.

# Spec chunks — read ONLY yours

The full spec (`../Hydropower Tycoon Final Prompt (Working Draft).md`) is split here, one file per top-level section. File `sNN` = spec section §NN. The original file stays the master copy: if a chunk and the original ever differ, the original wins, and the orchestrator re-splits.

**Rule for every subagent (§13.3):** read the files listed for your role and nothing else. If you need something from another section, ask the orchestrator; do not go read it yourself. Never edit files in this folder.

## Everyone reads

- `s00-non-negotiables.md`
- `s01-global-simulation-contract.md` (time, netting, notation)
- the contract code (`src/config.js`, `src/state.js`) once it exists
- `../progress.md` §6 (known spec inconsistencies and how they were resolved)

## Per role

| Role | Read these chunks | Plus the test rows of `s12` |
| --- | --- | --- |
| Orchestrator | everything; especially `preamble`, `s13`, `s14` | all |
| Contract | `s08` (§8.7 start config), `s11` | 11 |
| Physics | `s02`, `s03`, `s04` | 1, 2, 3, 4, 8, 11, 14 |
| Climate & market | `s05`, `s06` | 5, 6, 7, 9, 13 |
| Economy | `s07`, `s08` | 10, 15, 16, 21, 22, 24 |
| Gameplay | `s09` | 17, 18, 19, 20 |
| Tests | `s12`, `s11` (§11.5–11.6) | all |
| UI | `s10` (§10.1, 10.2, 10.4–10.9), `s11` (§11.2–11.4) | — |
| 3D | `s10` (§10.1 art styles, 10.3, 10.4), `s08` (§8.3 terrain functions), `s11` (§11.4) | — |
| Reviewer | the chunks of the module under review | the matching rows |

`s12-self-test-protocol.md` is one table: read the intro rules plus only your rows.
# Launchers

Paste one launcher file's full text into a coding agent.

| Launcher | Wave | Prerequisite | Parallel with |
| --- | --- | --- | --- |
| `10-engine.txt` | A | Stage 2 modules merged (already on master) | none |
| `20-gameplay.txt` | B | wave A merged | `30-tests-saveload.txt` |
| `30-tests-saveload.txt` | B | wave A merged | `20-gameplay.txt` |
| `40-ui.txt` | C | wave B merged | `50-world3d.txt` |
| `50-world3d.txt` | C | wave B merged | `40-ui.txt` |
| `60-reviewer.txt` | D | the wave under review merged | none (read-only) |
| `70-bundle.txt` | E | wave C merged | none |

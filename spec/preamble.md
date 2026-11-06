## Preamble and deliverable

You are receiving a complete specification for a browser-based pumped-storage hydropower management game, **"HYDROPOWER TYCOON."** Implement exactly what is specified. Every formula, constant and self-test number here has been pre-validated: do not substitute, "improve" or abstract any of them. Where this document is silent, choose the physically realistic option and record the choice in a code comment.

You are the orchestrator (Sonnet, medium effort) of a multi-agent build in a file-editing workspace. You write the contract files, assign focused modules to subagents, verify their output against the self-tests, and bundle the result. For every subagent you spawn, you choose the model and the reasoning effort yourself, from Sonnet at medium effort up to Opus at low effort, with Opus at medium effort only as an escalation after repeated failures, matching both to the difficulty of the module (§13). Subagents never edit another agent's module or the contract.

**Deliverable.** One file, `hydropower-tycoon.html`: HTML5, CSS3 and ES6+, fully self-contained, opens offline from `file://`. There is no line-count target and no practical size limit (expect a few MB at most).

- 3D uses **Three.js**, vendored at a pinned version and inlined in the file, with its MIT license header kept. Bundle it to a classic IIFE script with a bundler (esbuild or rollup), because `file://` blocks module imports and recent Three.js releases ship no classic minified build.
- No CDN, no network requests, no external fonts, images or audio. Everything else is procedural: geometry, textures, shaders.
- Development happens in focused modules (`src/*.js`, `src/*.css`, about 300 to 500 lines each); a deterministic bundler script inlines them into the final file at the end.

**Critical directive.** Real physics only: fluid dynamics, thermodynamics, financial engineering. No abstracted game math. Every tunable constant lives in one `CONFIG` object, and all units are SI.


# Build pipeline (game/)

- `npm run check`  purity check on `game/sim` (forbidden: document, window, THREE, canvas, Date,
  performance, Math.random). `game/sim/config.js` builds its 'window' key from 'win'+'dow' on purpose.
- `npm run build`  runs the check, then bundles `game/main.js` with esbuild (iife, es2020, tree-shaken)
  and writes ONE offline file: `dist/hydropower-tycoon.html`. `vendor/three.iife.js` is inlined as a
  classic script before the game script, so `THREE` is a global; `game/style.css` is inlined too.
- `npm test`       `node --test game/tests/` (Node ES-module tests, `*.test.mjs`).
- `npm run legacy` serves `game/legacy/` (v2.index.html) on http://localhost:8080.

Layout: `game/sim/` pure ES modules (entry `index.js`: `Sim`, `createGame`), `game/main.js` browser entry
(currently a toolchain-proof placeholder), `game/style.css`, `game/legacy/` old single-file base.
Open `dist/hydropower-tycoon.html` directly (file://) or serve `dist/` with `python3 -m http.server`.
Imports from `game/main.js` must stay relative; esbuild resolves them, three comes only from the global.

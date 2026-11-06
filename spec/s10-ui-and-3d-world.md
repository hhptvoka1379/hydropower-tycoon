## 10. UI and 3D world

The game should feel like a calm diorama you tend, not a control-room spreadsheet. The 3D world fills the whole window, and the interface is a few soft floating pieces on top of it. Every number from the simulation stays reachable, but the detailed telemetry hides in a drawer until the player asks for it.

### 10.1 Themes, art styles and look

The look is chosen in Settings and can change at any time without touching the simulation. There are **three UI themes** and **three art styles for the 3D world**, any combination of which works. Nothing is an image file: every color, shape, gradient and grain is generated in code (CSS gradients, an inline SVG noise filter, procedural geometry). The result must not look cheap: depth comes from one consistent light direction (from the top left), restrained shadows and fine details, never from cartoon bevels, glows or heavy outlines.

**Rules shared by every theme**

- The layout does not change between themes, only the materials, colors and type do. Bars and panels are rectangular with small radii (6 to 10 px), edge to edge where they dock; there are no pill shapes.
- One primary action per view, clear hierarchy, visible focus rings, and full keyboard navigation. Text and background pairs meet WCAG AA (4.5:1) in every theme; the palettes below were checked. State is never shown by color alone: pair it with an icon or a word.
- Touch targets are at least 44 px. Below the 1024 × 640 minimum viewport the toolbar collapses to a menu button and the drawer takes the full width; there is no horizontal scroll.
- Every list and chart has a designed empty state, a loading state and an error state. `prefers-reduced-motion` turns off camera easing, particles, shimmer and animated gauges.
- Fonts are system stacks only (the file is offline). Numbers always use `font-variant-numeric: tabular-nums`.
- Semantic tokens that every theme defines: `--gen` (generation), `--pump` (pumping), `--ren` (wind and solar), `--warn`, `--alarm`, plus surface, raised surface, text, secondary text and border.

**Theme A: Field Notes** (paper, ink and earth pigments, like a surveyor's notebook)

- Palette: Paper `#f1ead9`, Paper shade `#ddd2b8`, Ink `#2b2a26`, Moss `#4f6b3a`, Clay `#a3472c`, River `#2f6f86`, Ochre `#c58b2a` (fills only; as text use `#8a5f10`).
- Tokens: gen = Moss, pump = Clay, ren = River, warn = Ochre, alarm = Clay with an icon.
- Type: headings in a serif stack (`'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif`), dense numbers in `ui-monospace, 'Cascadia Mono', Consolas, monospace`.
- Controls: paper cards with fine ruled lines and a faint paper grain, ink-drawn dials and tick marks on sliders, tabs like paper index tabs, quest badges like rubber stamps.

**Theme B: Brass and Slate** (machine-room metals with a patina; the skeuomorphic option)

- Palette: Slate `#1f2428`, Slate raised `#2a3137`, Brass `#b08d57` (bright `#d9b777`), Bone `#ece6d8`, Mist `#a9b0b5`, Verdigris `#5aa89b`, Oxide `#e07a6b`.
- Tokens: gen = Verdigris, pump = Oxide, ren = Brass bright, warn = Brass bright with an icon, alarm = Oxide with an icon.
- Type: engraved capitals with letter-spacing in `'DIN Alternate', Bahnschrift, 'Segoe UI Semibold', system-ui, sans-serif`, numbers in the same stack.
- Controls: real analog gauges (power, net head, reservoir level, price) with brass bezels, a subtle glass highlight and an animated needle, engraved nameplates, chunky toggle switches, faders with brass knobs, indicator lamps, and very discreet corner screws. Keep every effect fine and low-contrast so it reads as a real object and not as a toy.

**Theme C: Frosted Dusk** (refined glass)

- Palette: Night `#121c2e` (panels at 72% opacity with `backdrop-filter: blur(14px)`), Mist `#a7b6cc`, Text `#e8eef7`, Teal `#5eead4`, Coral `#fb7185`, Amber `#fbbf24`, Sky `#7dd3fc`.
- Tokens: gen = Teal, pump = Coral, ren = Sky, warn = Amber, alarm = Coral with an icon.
- Type: `ui-rounded, 'SF Pro Rounded', system-ui, 'Segoe UI', Roboto, sans-serif`.
- Controls: frosted panels with a 1 px inner highlight and a very light noise, thin-line charts, rectangular buttons.

**Art styles for the 3D world** (Settings; each changes only normals, materials and shaders, never the geometry of the simulation):

1. **Faceted low-poly:** flat shading, saturated vertex colors, hard shadows. The cheapest on the GPU and very readable.
2. **Soft stylized (default):** smooth shading, gradient vertex colors, soft shadows, gentle fog, rounded forms.
3. **Naturalistic:** smooth normals plus procedural shader detail (noise on rock and grass, wet-rock darkening at the waterline, sky scattering approximated by a gradient with a sun glow, softer water highlights). The heaviest style; it is not offered when quality is set to Low.

The defaults are Theme A with the Soft stylized art style; both can be changed in Settings at any time.

### 10.2 Layout

- **Top bar (always visible, edge to edge, 44 px high):** cash, today's profit, net power in MW (with an arrow for export or import), the spot price Price₀ in $/MWh with a small trend arrow, the game clock with season icon, and pause and speed controls.
- **Bottom toolbar (edge to edge):** icon buttons with labels for Build, Automation, Services (reserve and contracts, §9.4), Finance, Quests, Lens, Settings and Save/Load, plus a site switcher when the player owns more than one site (§9.6).
- **Notifications:** short toasts appear top center and fade out. A bell icon opens the full alerts feed (§9.9) as a panel; there is no permanent sidebar.
- **World popovers:** clicking (or tapping) a building opens a rectangular popover in the active theme, anchored to it. Its position is recomputed from the 3D point every frame, and it hides when the object is off screen. Contents:
  - *Powerhouse:* each pump and turbine with a mode toggle, a flow slider, a health bar, and the σ/σ\_c or NPSH margin as a chip that pulses amber below 1.15.
  - *Penstock:* diameter, roughness, velocity, H\_f, and the upgrade button.
  - *Dam:* height, class, V\_max and the Raise button, which opens the Dam Builder (§10.4).
  - *Reservoir:* volume, depth, percent full, today's evaporation, and the excavation stages (lower reservoir).
  - *Parcel and tile:* the 4 × 4 grid with free and used tiles, co-location effects, and a build menu with live NPV (§7.4).
  - *Solar array:* output, f\_soil, the Clean button and a curtail slider. *Wind turbine:* RPM, output, curtail slider. *Battery:* state of charge, mode, fade, the refurbish button.
- **SCADA drawer (Tab or F1):** slides in from the right over the world. It holds three live charts (24-hour price with the forecast and the reserve requirement, 24-hour reservoir volumes, and power flow with generation in teal, pumping in coral and renewables in blue), the full hydraulic and economic telemetry (H\_g, H\_n, H\_f major and minor, Q, v, Re, f, P, η, revenue rate, LCOS, RTE, S), and the visual automation editor of §9.2.
- **Hydraulic grade line widget:** a small 2-D cross-section in the bottom corner showing the upper reservoir, the penstock, the runner and the tailrace, with a dashed line that sags as H\_f grows with Q and pulses amber or red when the cavitation margin is below 1.15.
- **Modals:** Build overview, Automation, Finance (with loans and payoff), Quests, Settings, Save/Load, About.
- **Shortcuts:** Space pause, 1 to 6 the speed ladder of §1.1, T turn-step, Tab drawer, C cycle lens, F focus the selected object, F2 debug overlay, Esc close.

### 10.3 The 3D world

- **Stack:** Three.js as vendored in §0 (classic IIFE, no imports), WebGL2. If WebGL2 is missing, show a plain message; the simulation itself remains testable headless.
- **Units and axes:** 1 unit = 1 metre. X runs along the canyon (the cliff at x = 0, the valley continuing upstream as in §8.3), Y is elevation (lower reservoir floor at y = 0, upper floor at y = z_upper_floor, about 51.60, as derived in §3.1), Z is across the canyon. Camera near plane 1 m, far plane 8,000 m.
- **Terrain:** one heightfield mesh of about 3,200 × 1,600 m at 8 m resolution (about 80,000 vertices), colored per vertex (rock, grass, snow by height and season). It is built from the same functions as the simulation: `W_bot(x)`, `s(x)` and `z_bed(x)` of §8.3 for the procedural canyon, and the §3.1 frustum bowls at the Classic site. Parcels are flattened pads blended smoothly into the slopes. When an excavation or a dam raise finishes, only the affected region of the buffer is rebuilt.
- **Dam wall:** generated from the concrete profile of §8.4 (crest thickness and batter of the current class), rebuilt when the height changes. Show a darker band at the high-water line. During a build, show scaffolding and a progress ring.
- **Water:** one translucent plane per reservoir at the exact surface elevation `z_floor + d`, so the water depth on screen is the simulated depth (interpolate between steps). The terrain hides the parts that should be dry, a shoreline foam fades in where the water is shallow (the shader samples a height texture of the terrain), and two layers of gentle sine waves move the surface. The color goes from turquoise in the shallows to deep blue, and shifts with the season. Ice (Winter, `T̄ < 0`) turns the surface white and still.
- **Machines:** the penstock is a pipe along the hillside with flow particles whose speed is proportional to `v = Q / A_pipe`, pointing downhill when generating and uphill when pumping. The powerhouse has a runner that spins in proportion to Q. Wind rotors turn at `60 · λ · v_hub / (2πR)` rpm with λ = 7 and stop feathered when cut out. Solar panels glow in proportion to G and sparkle in rain. Batteries show a fill bar. Use instanced meshes for repeated objects (panels, rotors, tiles).
- **Light and sky:** a directional sun whose elevation is the same function as in §5.1 (so shadows and solar output agree), a hemisphere light, a soft shadow map (2,048 px, one cascade) that follows the camera focus, a sky gradient and fog tinted by time of day, a few hundred stars at night, and a dim moon light. Season changes the foliage and ground colors.
- **Weather:** rain and snow as a capped particle system (at most 1,500 particles), heat shimmer as a subtle screen-space wobble on heat-wave days, storm clouds darkening the sky, and wind-driven grass motion in the vertex shader.
- **Camera and input:** orbit (left drag), pan (right drag or WASD/arrows), zoom (wheel, eased toward the cursor), rotate (Q/E), with limits so the camera cannot go below the terrain or beyond the map. Clicking uses raycasting against objects tagged with an `entityId`; hovering lifts a soft outline and shows a one-line tooltip. Double-click flies the camera to the object.
- **Performance:** target 60 fps at 1080p on an integrated GPU in the World view. Cap the pixel ratio at 2. If the frame time stays above 22 ms for two seconds, step quality down one level (shadow map, particle cap, pixel ratio) and tell the player in Settings; Low/Medium/High can also be set by hand. No per-frame allocations in the render loop. The simulation and the renderer never share mutable state: the renderer reads an immutable snapshot of `SimEngine` once per frame.

### 10.4 Lenses and build modes

- **World lens (default):** the scene above.
- **Survey lens (automatic in Dam Builder and Parcel build mode, or with C):** the terrain shows 5 m elevation contour lines (drawn in the terrain shader from `fract(y / 5)`), the choke points of `W_bot(x)` are marked with pins, and a translucent blue plane shows the flooded basin at the dam height being considered.
- **Dam Builder:** at the siting step (§8.4) the player drags a dam marker along the canyon and sees, live, the V\_max of the 10 m starting dam and the price and volume of 20 m and 30 m dams there. After that the builder offers the three modes of §8.4 (height slider, max volume for a budget, target storage) with a live readout of height, price, build days, V\_max, stored energy in MWh and, in red, the warning when the lower reservoir is the bottleneck. The blue plane and the wall update as the slider moves.
- **Field zoom:** double-clicking a parcel flies the camera over it, shows its 4 × 4 tile grid and lets the player place arrays, turbines and batteries on tiles, with the co-location and wake effects of §5.5 shown as small badges.

### 10.5 New game screen and terrain bias menu

The new game screen has the Classic Benchmark and Procedural Canyon options, a seed field with a dice button, and a *terrain bias* menu for the procedural option, with a live miniature preview that re-renders as sliders move and a validity badge (§8.4: starting V\_max between 150,000 and 300,000 m³, or the number of retries needed). Sliders and their `CONFIG.terrain` keys:

| Slider | Key | Range | Default |
| --- | --- | --- | --- |
| Canyon width | `W0` | 30 – 120 m | 60 |
| Choke strength | `a_w` | 0 – 0.9 | 0.6 |
| Wall steepness (run per rise) | `s0` | 0.4 – 1.4 | 0.8 |
| Valley slope | `S0` | 0.005 – 0.03 | 0.015 |
| River size | `Q_base` | 0 – 0.6 m³/s | 0.15 |

The preview and the generated world use the same seed and the same functions, so the sliders never change what the world will look like beyond what the preview shows.

### 10.6 Debug overlay (F2), required

A translucent panel lists the live computed values so the player can check that the real equations are running: `Re, f, H_f (major and minor), H_n, H_dyn, Q, v, P_gen, P_pump, η_t, η_p, σ, σ_c, NPSH_A, NPSH_R, E (mm/day), R_n, T_cell, f_soil, RTE, LCOS, Price₀, Price_eff, R_reg, R_req, π_cap, λ, Impact, battery SoC, Q_env, S, seed`. A value that fails its self-test condition is shown in red.

### 10.7 Sound (optional, off by default)

A small WebAudio engine can synthesize ambient sound with no audio files: water noise scaled with Q, wind noise scaled with u₂, rain, and a soft low hum from the machines. It has one master volume slider and a mute toggle in Settings, and the game stays fully playable without it.

### 10.8 Save and load

Serialize the whole game state to JSON, `{version, seed, state}`, into `localStorage.hydroTycoonSave`, with an autosave every game day and on unload, manual Save, Load, Export (a text box with the JSON) and Import. The terrain, hypsometric tables and meshes are rebuilt from the seed and the saved parameters and are not stored. A version guard resets gracefully. The save is deterministically replayable: the same seed and the same inputs produce the same world.

### 10.9 About

The About modal, reachable from Settings in the toolbar and from a small footer badge, credits the game: **"Concept, physics architecture and game design by @Jeremih (Discord)."** It also lists, in plain language, the real equations behind the simulation (Darcy–Weisbach with Swamee–Jain, the Thoma parameter and NPSH, Penman evaporation, the wind power curve with Jensen wakes, PV temperature derating, merit-order pricing), the game version, the current seed, and the Three.js MIT license notice.


# Hydropower Tycoon: single-turn prompt

Build **Hydropower Tycoon** in one pass and return one deliverable: a single offline file, `hydropower-tycoon.html` (HTML, CSS and ES6 JavaScript, with Three.js inlined). It is a pumped-storage hydropower management sim with real physics, played as a cozy, tactile diorama: a little field station you tend, with a river, a dam, two lakes and a powerhouse you can see inside.

The game will be reviewed by playing it in a real browser, so what it looks like and how it feels matter as much as the numbers. Where this prompt names a mistake to avoid, it is a mistake an earlier attempt made and the player rejected.

## Look and feel

### Overall tone

- The 3D world fills the window. The interface is a few soft floating pieces on top, and detailed telemetry stays in a drawer until the player asks for it.
- It should feel like a diorama you tend, never a spreadsheet and never a generic dashboard. Give it a sense of place: a dam emblem, a warm field-station palette, compact floating instrument strips, and a start card in plain language rather than technical jargon.
- Don't put a permanent promotional headline or hero banner on screen. The landscape is the main thing; the interface supports it.

### Art style

- **Default art style: deliberate faceted low-poly.** Use flat shading, saturated vertex colors, hard shadows, chunky readable shapes, and broad foothills with seeded multi-scale highlands. Color terrain by elevation and slope (rock on steep faces, grass low, snow high, changing with season). Use clustered evergreen trees, boulders and riverbank gravel, not a repeating pattern.
- Offer two optional styles in Settings: **soft stylized** (smooth shading, gradient vertex colors, gentle fog) and **naturalistic** (procedural noise on rock and grass, wet-rock darkening at the waterline, a sky gradient with a sun glow). Styles change only normals, materials and shaders, never simulation geometry. The naturalistic style is not offered at Low quality.
- Everything is generated in code with no image files. Use one light direction from the top left and restrained shadows. Build depth from light and form, not cartoon bevels, glows or heavy outlines.

### Whimsy, fine and low-contrast

Include these small touches:

- wind rotors that feather when cut out;
- solar panels that sparkle in rain;
- grass that sways in the wind;
- shoreline foam;
- stars and a dim moon at night;
- ice on the water in winter;
- a tiny worker figure and crest rails on the dam as scale cues;
- evergreen clusters that change with the season;
- a spillway that appears when the upper reservoir spills;
- a switchyard and a service route near the powerhouse;
- quest badges like rubber stamps;
- a cavitation chip that pulses amber;
- a dashed grade line that sags under load.

### UI themes

Offer three live-switchable themes through CSS variables. The layout is identical across them; only materials, colors and type change.

- **Field Notes** (default): warm paper, ink and earth pigments, like a surveyor's notebook. Paper `#f1ead9`, ink `#2b2a26`, moss `#4f6b3a`, clay `#a3472c`, river `#2f6f86`, ochre `#c58b2a` (as text use `#8a5f10`). Serif headings, monospace numbers, paper cards with faint grain, index-tab tabs, and rubber-stamp quest badges.
- **Brass & Slate**: slate `#1f2428` with brass `#b08d57`, bone `#ece6d8`, verdigris `#5aa89b` and oxide `#e07a6b`. Analog gauges for power, net head, reservoir level and price, with brass bezels and animated needles, engraved nameplates and chunky toggle switches.
- **Frosted Dusk**: night-blue glass panels at 72 % opacity with a backdrop blur, teal, coral, amber and sky accents, rounded system type and thin-line charts.
- Every theme defines the tokens `--gen`, `--pump`, `--ren`, `--warn` and `--alarm`, plus surface, raised surface, text, secondary text and border.
- Panels are rectangular with small radii (6–10 px), with no pill shapes. Text and background pairs meet WCAG AA (4.5:1), and state is never shown by color alone.

## The 3D world: it must read as a real place

Earlier attempts failed here, so be specific.

- **Solid terrain.** The landscape is a thick solid with edge walls and a bottom. It is never a floating, zero-thickness surface and never an empty scene. Add broad foothills, varied relief and populated forests; avoid a flat capped plateau or steep circular-pit shoulders. Display vertical relief exaggerated about threefold for readability. This is presentation only; simulation heights and volumes are unchanged, so tree heights, tower heights and pipe cross-sections must compensate for the exaggeration so nothing stretches or shears.
- **Real cutaways.** A section is a cut through solid ground that shows an exposed earth face, not terrain deleted to see behind it. Provide camera presets: Overview, Dam, Turbines (cutaway), Penstock, Upper lake and Lower lake. Lake presets cut through the basin and show a water-volume section. The machine preset cuts a face with openings for the penstock trench and machine room. Clip foreground trees, structures and water consistently. Overview restores the complete solid terrain.
- **Water is a volume, not a disk.**
  - Draw each lake as terrain-clipped top and bottom geometry with real depth and an irregular shoreline. Don't use flat ellipses.
  - Use a physical transmission material with an animated normal-map distortion, so the surface refracts what is under it. Displace the surface a little near the shore.
  - Color goes from turquoise in the shallows to deep blue, and shifts with the season. Ice (winter) turns the surface white and still.
  - Water must not disappear in cutaways. A translucent core stays visible even when the plant is idle.
  - **No animated dots, spheres or dotted paths over the water.** Show flow with subtle continuous shading and currents instead.
- **River.** Use a winding downstream channel and an upstream river, sharing one seeded centerline with the terrain, with varied width, broad irregular banks, rocks and gravel. It must not look like a straight uniform trench or a drainage ditch. Downstream water follows the riverbed and does not float at reservoir level. Both rivers are clickable and show the latest simulated inflow and outflow in m³/s, with environmental release and spill counted in outflow.
- **Dam.** The wall is generated from the concrete profile of its class and rebuilt when the height changes, with a darker band at the high-water line. A raise in progress shows scaffolding or a translucent growing cap and a progress indicator. Place the dam at the upper basin rim, with the penstock intake at the dam rather than buried in the hillside.
- **Powerhouse.** This is the heart of the diorama, so build it carefully.
  - Ground it beside the lower basin on a foundation. Add a roof and a chamber you can see into.
  - Give the turbine and pump distinct, fixed bays. Their casings must not overlap.
  - Each runner and its shaft form **one rigid rotating assembly**, with bladed runner, casing, hub, bolts and a stationary generator housing. Each machine sits on its own pedestal.
  - Put decorative windows behind the spinning parts, never in front of them. Don't let any non-rotating part bob or wobble.
  - Rotate the turbine in the physically sensible direction, and animate the pump separately. Only units with flow move.
  - Water takes visibly separate routes. Water enters each turbine from above and exits below to the tailrace. Each pump takes water through a side intake from the lower side and sends it up its top outlet back toward the upper reservoir. Inactive branches hold still water. The path must not look like water passing straight through the machines.
  - The penstock shows a full-width water volume with a subtle continuous current that reverses when pumping and stops when paused, and a cross-section view of the intake, pipe and tailrace.
  - Clicking anywhere on a machine, including its blades, selects the whole machine with a fixed outline, not a spinning blade. Wind turbines select as a whole, tower and rotor.
- **Renewables and batteries.** Use instanced meshes for solar tiles and wind rotors. Wind rotors turn at `60 · λ · v_hub / (2πR)` rpm with λ = 7. Solar panels sit on grounded supports and glow in proportion to irradiance. Owned parcel tiles follow the terrain, are drawn in 3D with glowing contour outlines, and pulse gently in Build mode (respecting reduced motion).
- **Light and weather.**
  - The directional sun's elevation matches the solar-output function, so shadows and output agree.
  - Add a hemisphere light, a soft shadow map that follows the camera focus, and a sky gradient and fog tinted by time of day.
  - Rain and snow use a capped particle system (at most 1,500 particles). Add storm darkening, heat shimmer on heat-wave days, and wind-driven grass in the vertex shader.
- **Camera and input.**
  - Orbit with left drag. Pan with right drag, two-finger trackpad scroll, WASD or arrows. Zoom with pinch, Ctrl-scroll or the wheel, and rotate with Q/E. Limits keep the camera above the terrain and inside the map.
  - Provide a Settings switch that reverses gesture directions, because device conventions differ. Support touch: two-finger pan and pinch.
  - Picking uses raycasting. Hover lifts a soft outline and a one-line tooltip. Double-click flies the camera to the object with easing, unless reduced motion is requested.
- **Lenses.** A World lens, and a Survey lens that adds 5 m contour lines, pins at the canyon choke points, and a translucent plane showing the flooded basin at the dam height being considered. Other lenses show hydraulic, electrical and ecology views.
- **Performance.** Target 60 fps at 1080p on an integrated GPU, with the pixel ratio capped at 2. Allocate nothing in the render loop. If frame time stays above 22 ms for two seconds, step quality down one level (shadow map, particle cap, pixel ratio) and tell the player in Settings. Rebuild only the affected terrain region when a dam raise or excavation finishes.
- If WebGL2 is missing, show a plain message and keep a form-based fallback for building. The simulation stays usable headless.

## Non-negotiables

- The file is fully offline, with no external requests and no `eval`. Keep the MIT header on the Three.js code.
- Keep the simulation pure and deterministic.
  - It has no DOM or THREE code and no `Math.random`.
  - All randomness comes from named seeded streams.
  - It uses only `+ − × ÷ sqrt exp log sin cos pow min max`.
  - Same seed plus the same actions gives the same state hash.
- Data flows one way. The UI and the world read an immutable `Game.getSnapshot()` and send `Game.dispatch({type, ...})`. They never mutate state. The only globals are `Game` and `window.__HYDRO_AUDIT__`.
- Put every constant in a CONFIG object with its unit, and cite the equation's section at each formula. Include no stubs, placeholders or TODOs that change behavior.
- Don't invent values the spec gives. Where a number is unspecified, choose a sensible one and list it in the closing note.
- Do not claim anything is visually correct without having checked it. Build it correctly the first time.

## Simulation

Run a fixed-step engine. Each step applies queued actions and then runs, for every site, this pipeline in order: weather → renewables → plant solve → reservoirs → wear → economy accumulation → clock. Steps never cross an hour boundary. At each hour, update the climate and settle the economy at the hour's price. At each day, run the climate day boundary and the solar soiling update. Construction jobs advance every step. A new game does not advance until the player starts it.

### Physics

- **Hydraulics:**
  - major and minor head losses, net head and cavitation margins (σ and NPSH);
  - pump and turbine efficiency curves;
  - a penstock whose diameter, material and roughness can be replaced.
- **Reservoirs:**
  - mass is conserved exactly, so 1 m³/s for 1 h moves ±3,600 m³;
  - add rain, evaporation, spill, and an environmental-flow release;
  - the Classic site has no river. Procedural sites have a river whose snowpack is tracked **per site** and released only into that site's river, and valley runoff snow is tracked separately per site.
- **Wear and maintenance:** health, repairs and penstock replacement.
- **Climate and renewables:** seasons, weather, heat waves, storms, wind and solar output (with wake and shade between installations, and soiling and cleaning). Storms can damage wind turbines.

### Market and money

- **Dynamic grid price:** a duck-curve spot price with a 24-hour forecast, including negative prices, and market impact from the plant's own dispatch.
- **Finance:** hourly settlement, loans and repayment, contracts, bankruptcy (with an explicit sandbox continuation and one-time emergency credit), and payback and NPV for builds.
- **Renewable quotes:** a 20-year NPV from the 24-hour weather and price forecast, wake and shade effects, incremental O&M and the co-location discount, without mutating the game.
- **Co-location discount:** a solar or wind installation on a tile that already holds the other technology gets 15 % off the **equipment**, not the land.

### Construction and the dam

- **Terrain and siting:**
  - Offer the Classic two-lake start, and a procedural winding canyon built from seeded functions.
  - Starting a procedural game opens a detached 3D survey. The player explores, clicks a permitted canyon reach to place a visible dam preview, sees capacity and raise cost, and confirms or cancels. Cancel leaves any active game unchanged.
  - Meanders use absolute seeded coordinates, so moving the dam station recenters the same bends.
  - Include a terrain-bias menu and a river-size setting.
- **Building:** dams are placed and raised (integer metres on procedural sites) with class limits. Reservoirs are excavated in stages. Equipment comes in three tiers. Offer budget-limited and target-energy dam planning and storage estimates.
- **Dam damage:** after a qualifying storm-rain spill at a dam above 90 % of its class height, use a 2 % daily chance of a crack in the upper 25 % of the wall.
  - The plant stays usable. A visible warning tells the player to drain below the crack.
  - Wear accumulates only while water is above the crack: 0.2 points per ordinary day, 0.5 on a storm-rain day.
  - A repair costs 5 % of dam value, takes 24 hours, and can be ordered at any damage level.
  - Raise a critical alert for a crack at any site, even if it isn't the one being viewed.

### Gameplay

- **Operation:**
  - Provide manual Generate, Pump and Idle with a flow setpoint, plus an 8-slot rule engine with conditions, actions and priorities.
  - Manual dispatch switches automation off. An explicit enabled flag shows the state.
  - When a manual change is requested while the shared penstock is ramping to zero, keep the requested mode visibly selected.
- **Storage and grid:**
  - Batteries B1–B3 have efficiency, a state-of-charge window of 10–95 %, cycle fade and refurbishment.
  - The reserve market has offers, calls with a ramp, fines, emergencies and a reliability score.
  - Emergencies start at a random eligible hour that lets the 2–4-hour event finish that day.
  - In local-only pump mode, never import to sustain the pump. Let it close faster than its normal ramp if local production suddenly drops.
- **Environment:** environmental flow from the lower reservoir, with a $0.50/m³ charge on the unmet volume.
- **Wind repairs:** damaged turbines stay offline. An automatic repair starts only if cash after paying stays above the player's configured cash reserve.
- **Progression:**
  - Multiple sites, with site and permit purchases and a site switcher.
  - 20 quests and a win condition.
  - A year-end renewable bonus: the sum over renewable sites of 100 × the site's year-one capacity factor (delivered energy over nameplate capacity-hours, clamped to [0, 1]; sites with no renewables are excluded).
  - An alerts feed and failure states.
  - The starter Tier-2 solar array sits on parcel 1, tile 0.
- **God mode (optional):**
  - It dispatches and buys on the player's behalf.
  - It follows the player's own rules first, then a forecast-based fallback, with an editable flow target and cash reserve and editable cheap/peak hour counts.
  - It manages batteries, maintenance, repairs, cleaning, Tier-2 machine and penstock upgrades, and purchases of positive-NPV renewables, with optional curtailment at negative prices when no firm contract is active.
  - It never takes a loan and honors the repair reserve. It makes no promise of optimal profit.
  - An optional, default-on profit protection records a separate subsidy that guarantees at least $1 per settled operating hour. The Finance panel discloses the subsidy, and Settings can turn it off.
- **Demo mode:** a separate demo start with replenished funds and a visible infinity label. It builds dam raises and excavations instantly and permits any dam class, while keeping physics real. It can be saved and replayed. Normal play keeps its construction times and unlock rules.
- **Actions:** `SET_SPEED PAUSE TURN_STEP SET_FLOW SET_MODE SET_CURTAIL PLACE_DAM RAISE_DAM EXCAVATE BUILD REPLACE_PENSTOCK CLEAN_ARRAY REPAIR TAKE_LOAN REPAY_LOAN SIGN_CONTRACT BUY_PERMIT BUY_SITE SET_RESERVE_OFFER SET_RULES CLAIM_QUEST`. Validate each one, charge its cost against available budget, and reject with a reason instead of throwing. UI actions apply at the current fixed-step boundary and update the screen immediately, even while paused.
- **Game loop:**
  - Use `requestAnimationFrame` with a speed ladder and a 40 ms budget per frame. **All six speeds are directly selectable and must actually work.** Turn mode has a visible +1h control.
  - Pausing or changing speed clears stale carry-over time, and an indicator shows when the simulation is falling behind.
  - A top-level try/catch pauses the game, keeps the last good snapshot and shows an error panel with a copy button.
  - Guard `requestAnimationFrame` so the engine also runs under Node.

## Interface

- **World-first.** The 3D world is mostly unobstructed, with small contextual controls on the objects themselves. The operations dashboard is closed by default and opens from an Operate button. Detailed panels are secondary tools.
- **Context cards.** Clicking the powerhouse, a reservoir, the dam, the pipe, a river, a solar array, a wind turbine or a battery opens a compact card anchored to that object. Clicking blank space closes it.
  - **Powerhouse:** Generate, Pump and Idle, a flow slider, a note that manual control pauses automation, the actual versus requested mode, and a spot-price estimate labeled as excluding other costs. It also explains negative prices and says which bay holds the turbine and which the pump.
  - **Dam:** the safe water level, crack warnings and the repair price.
  - **Solar:** the clicked array's output, soiling, and its cleaning cost and action.
  - **Wind:** RPM, delivered power versus available power after curtailment, a curtail slider and the repair-reserve state.
  - **Battery:** state of charge, mode, fade and the refurbish action.
  - **Reservoir and rivers:** volume, depth, percent full, evaporation, inflow and outflow, and excavation stages for the lower reservoir.
- **Building.** Owned parcel tiles are drawn in the 3D landscape. In Build mode, clicking a tile opens a small anchored popover offering solar, wind and batteries, with tier selection, prices, occupied states, the co-location discount and a live NPV quote. A detailed build panel with a 4×4 tile grid stays available as a fallback.
- **Top bar:** cash (always visible, even on small screens), today's profit, net MW, spot price with a trend arrow, the clock with a season icon, and pause and speed controls. A bell opens the alerts feed.
- **Bottom toolbar:** Build, Automation, Services, Finance, Quests, Lens, Settings and Save/Load, plus a site switcher.
- **SCADA drawer** (F1): three live charts using 1,440-point ring buffers, with a 24-hour price with forecast and reserve requirement, reservoir volumes, and power flow (generation teal, pumping coral, renewables blue), selectable per site or aggregated.
  - It also holds the full telemetry (H_g, H_n, H_f, Q, v, Re, f, P, η, revenue rate, LCOS, RTE, reliability score S), the rule editor, and a hydraulic-grade-line widget that pulses amber or red when the cavitation margin is below 1.15.
  - Hourly settlement keeps a bounded 24-hour per-site history for these charts.
- **Other screens:** a new-game screen (seed, terrain bias, river size, Classic or procedural start, demo option), Settings (theme, art style, quality, gesture direction, sound off by default with synthesized WebAudio only, reduced motion), Save/Load with slots and autosave, About with a credit line, and an F2 debug overlay showing efficiencies, cavitation and NPSH values, radiation and cell temperature, effective price, reserve requirement, environmental flow and per-site snowpack.
- **Keyboard and accessibility.** Space pauses, 1–6 select speeds, T turns, C cycles lenses, F focuses, F2 opens debug, F1 opens the drawer, and Esc closes a panel even from a form field. Tab keeps its normal focus navigation. Focus rings are visible and touch targets are at least 44 px. The layout is responsive with no horizontal scroll. Every list and chart has an empty state, and `prefers-reduced-motion` turns off easing, particles, shimmer and animated gauges.
- **Updates:** the DOM updates only when a value changes by more than 0.1 % or after 1 s, and popovers and the drawer update only while open. Canvases handle `devicePixelRatio`.

## Self-test

Expose `window.__HYDRO_AUDIT__` with `testResults`, `allPassed`, `ticksRun`, `nanCount`, `stateHash`, `perf` and `getSnapshot`. Run the audit in a background worker so the UI never freezes, and report a clear status of pending, complete, failed or unavailable. Cover at least these 25 checks:

- mass conservation at dt 1, 5 and 30 (±3,600 m³ per 1 m³/s·h);
- per-step energy netting;
- a three-day robustness sweep with no NaN, volumes within bounds and health within 0–100, run with batteries, reserve offers and emergencies active;
- reserve call ramp (1.65 m³/s and about 659 kW after 45 s; a 0.7 MW offer is accepted and 0.8 MW fails), reserve money and score, battery behavior, and environmental-flow charges;
- determinism, save and load, and replay (same seed gives the same hash, a different seed differs, save at day 10 and continue to day 30 matches);
- a pacing report showing mean net income per day and payback of the Tier-2 pump and turbine pair, printed rather than hidden.

Saves are versioned JSON with schema validation and graceful failure, and they keep the terrain bias and chosen dam station so replay reproduces the terrain. `localStorage` goes in try/catch with an in-memory fallback, and file export and import are included.

## Output

Return the complete, fully working `hydropower-tycoon.html` in one response, with every system above implemented. After it, add a short note listing the constants you had to choose.

Don't ask questions, and don't produce multiple files or versions.

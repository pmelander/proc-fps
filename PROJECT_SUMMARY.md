# proc-fps — project summary

A fully procedural, Doom-style FPS running entirely in the browser, planned as a long-term project. No hand-made assets: levels, textures, sprites, and audio are all generated from a seed.

This file summarises the decisions made so far, the current state of the code, and what comes next. It can double as `CLAUDE.md` context.

## Core decisions (and why)

| Decision | Rationale |
|---|---|
| 2.5D sector geometry rendered in true 3D | Keeps the Doom feel; generation, collision, and culling are far simpler than full 3D. Sectors are natural portals. |
| Custom renderer (no Three.js) behind a `RenderBackend` interface | The defining features (portal culling, sector lighting, palette quantization) fight a general scene graph. WebGL2 now, WebGPU slot-in later. |
| Grid movement + free mouse look | Mouse aims freely; WASD steps one 128-unit cell forward, back, or sideways (Grimrock-style movement with shooter aiming). Suits procedural levels, makes AI and doors trivial, and makes sidestepping projectiles the core dodge skill. |
| Map format v0 as the backbone contract | Generator emits `MapData`; sim and renderer consume it. Enables hand-authored test maps, a future editor, and golden tests. |
| Deterministic sim, fixed 60 Hz | Replays are map hash + input log, used for bug reports, regression tests, and demos. |
| seed + `GENERATOR_VERSION` = level | Old seeds stay reproducible as the generator evolves. |
| Monorepo, DOM-free core/gen/sim | Those packages run in Node for tests and CI, and in a Worker later. |

## Stack

- TypeScript 7 (the Go port), Vite 8, Vitest 5, tsx, and npm workspaces. Packages are source-first, with `exports` pointing at `.ts`.
- `earcut` for floor and ceiling triangulation. It's the only runtime dependency.
- Node 22 in CI (GitHub Actions).

## Layout

| Package | Contents |
|---|---|
| `core` | `map.ts` (format v0, `hashMap`), `cells.ts` (`CellPlan`: cells → sectors with automatic T-junction splits), `rng.ts` (sfc32 + named forks), `dmath.ts` (deterministic trig), `math.ts` (render-side mat4), `geometry.ts` (sector loops, `SectorLocator`), `builder.ts` (`MapBuilder`, `rect`), `grid.ts` (`CellGrid`, `validateGridAlignment`), `validate.ts`, `constants.ts`, `textures.ts`. `maps/test01.json` is built by `scripts/build-test-maps.ts`. |
| `gen` | `generate.ts` (v0.11.0: mission → layout → room templates → cell plan → sectors), `mission.ts` (mission graph), `layout.ts` (grid embedding), `rooms.ts` (room templates), `population.ts` (enemies, health and ammo by level and depth), `validate.ts` (structural + grid + reachability + traps), `scripts/stats.ts` (headless health check). |
| `sim` | `input.ts` (`InputFrame`, quantization), `world.ts`, `state.ts`, `player.ts` (grid movement), `sim.ts`, `replay.ts`. |
| `render` | `backend.ts` (interface), `webgl2.ts`, `mesh.ts` (map → per-sector mesh), `palette.ts` (64 colours), `shaders.ts`, `renderer.ts` (`LevelRenderer`). |
| `app` | `main.ts` (loop, interpolation, HUD, compass), `input.ts` (DOM → `InputFrame`), `automap.ts`. |

Commands:

```
npm install
npm run dev              # ?seed=anything  or  ?map=test01 / test02 (doors, keys, secret) / test03 (combat) / test04 (lift, hazard);  /browse.html = seed browser;  /sprites.html = enemy sprite sheet
npm run ci               # typecheck + tests + gen:stats (2000 seeds) + build
npm run maps:build       # regenerate test map JSON (CI fails if it drifted)
npm run gen:stats -- --seeds 10000 [--level n]   # health check + distributions (rooms, doors, secrets, templates, attempts, gen time)
```

## Invariants (don't break these)

1. No DOM imports in `core`, `gen`, or `sim`.
2. No `Math.random` in core, gen, or sim. Use `Rng` and fork a named stream per subsystem (`layout`, `deco`, `theme`, …) so changing one subsystem's draws never reshuffles another.
3. No `Math.sin/cos/atan2/hypot/pow` in sim. They differ between JS engines at the ULP level and break cross-browser replays. Use `dsin` and `dcos`; `+ - * / sqrt floor round` are safe.
4. The sim advances only via `stepSim(world, state, InputFrame)`. Rendering interpolates between the previous and current tick.
5. Bump `GENERATOR_VERSION` on any change that alters output for an existing seed.
6. Bump `MAP_FORMAT_VERSION` on breaking format changes.
7. A changed replay/state hash in tests is a behaviour change: decide deliberately.

## Conventions

- Map space is (x, y) with y pointing north. World space is X = x, Y = up, Z = −y.
- A linedef's front side is on the **left** of v1→v2 (Doom uses the right). Sector outer loops are CCW and holes are CW.
- All geometry is axis-aligned on the 128 lattice, and things sit at cell centres. Adjacent sectors must share identical edges, so split T-junctions via `rect(..., { east: [...] })`.
- `MapBuilder` merges shared edges into two-sided lines automatically. A wall's texture comes from the side it's seen from; for example, a platform riser uses the surrounding room's `lower` texture, so override it with `setSideTextures`.
- Units are Doom-like: cell 128, player height 72, eye 64, max step 24. The player is taller than Doom's 56/41 because square pixels lose Doom's 1.2 vertical stretch; at 41 the camera felt too close to the floor.
- Heading 0/1/2/3 = E/N/W/S, which equals map angle h × 90°.

## Movement model (implemented)

- Yaw and pitch are continuous and never affect position. Pitch is clamped to ±1.3 rad.
- The movement heading is the yaw snapped to a cardinal. It switches only past 45° + `HEADING_HYSTERESIS` (0.14 rad).
- A step lasts `STEP_TICKS` = 14 ticks (about 230 ms) with a smoothstep ease, which works out to roughly 550 u/s, about Doom walking speed.
- Holding a key repeats steps seamlessly.
- A press during a step is buffered one deep, and its direction is resolved at press time.
- With both axes held, the most recently pressed one wins. Movement is 4-way only.
- Step-ups (≤ `MAX_STEP`) follow the ease. Stepping down falls once past the cell edge, and the next step waits for landing.
- `CellGrid.canStep` is the single movement rule, shared by the sim, gen validation, and (planned) AI.
- `CELL_SIZE`, `STEP_TICKS`, enemy step timers, and projectile speeds must be tuned together.

## Current state

**Working:**
- Map format and validation, including trap detection: every cell reachable from the start must still be able to reach the exit.
- The grid-aligned test map, which covers a platform, drop, stairs, and a void pillar.
- The v0.11 generator (hordes of fragile enemies; the mini boss and boss carry the keys onward; some levels span two storeys joined by lifts; each level also gets a theme, and `generate(seed, { level })` scales its population): a mission graph (M2 slice 1) embedded on the grid (slice 2) as rooms sized by type, joined by corridors, with loops routed by pathfinding. Rooms use templates (slice 3): hall (pillar rows), platform (or an unclimbable plinth), pit, stairs to a dais, and arena (boss and mini boss); start, exit, and loot rooms stay plain. Floors are flat (one storey) and hazard stripes mark only corridor ends. Connections get doors (slice 4) as the mission says, auto or key, with keys placed on base floor in their rooms. Up to 2 secret rooms per level (slice 5) hang off ordinary rooms behind secret doors.
- The WebGL2 renderer, which uses per-sector light with distance falloff in 16 bands and renders at 240p before a 64-colour palette post pass with Bayer dithering.
- Placeholder procedural patterns per texture id, with floor and ceiling tiles aligned to cells.
- Grid movement, replays (F8 downloads one), the automap (hold Tab; rotates with the look direction, drawn at 240p in the palette), and the HUD compass showing where W goes.

**Verified:**
- The typecheck is clean.
- 74 tests pass.
- 2000 seeds produce 0 validation failures (about 12 ms per map including validation).
- The production build succeeds (about 45 kB JS).
- Headless Chromium (SwiftShader) renders correctly.

**Not yet verified:** real mouse and keyboard play. Pointer lock can't run headless.

- Combat feel (M7), from play-testing:
  - A shotgun: `PELLETS` (8) hitscan pellets in a fixed spread (`PELLET_SPREAD`, so replays hold), `PLAYER_DAMAGE` (12) each, a 36-tick pump. With an enemy within `MELEE_REACH` and 45° of the aim, firing is an automatic melee strike (`MELEE_DAMAGE` 60). Ammo is infinite (the M5 ammo system is gone).
  - Hordes, not bullet sponges: ordinary enemies die to one close blast (grunt 20 HP, brute 55, sniper 20), everyone moves slower, snipers are bulkier to hit, and the population budget is far larger (level 1 ≈ 30 enemies, level 5 ≈ 50).
  - Bosses carry the keys onward: the mini boss drops the boss key and the boss drops the exit key (the exit sits behind its own key door). A carried key is a thing flag on the enemy (`dropsKeyFlags`, `droppedKey`); the sim turns it into a pickup where the carrier dies (`PickupInfo.carrier`, `pickupCell`), and validation counts it where the carrier starts. Keys are sprites shaped like keys.
  - Feel (app, render-only): a big pixel-art shotgun (`weapon.ts`) that kicks, pumps, swings for melee and bobs; the muzzle flash lights the scene (`LevelRenderer.flash`); the screen jolts on shots and hits; a bass-heavy boom and a pump clack. Kills burst into gibs and blood that fly, bounce and linger (`gore.ts`), the corpse is thrown by the blow, and death sounds pitch down with size.
  - Enemies are scary mutants: hunched, lumpy, clawed and toothed SDF models with mottled sickly skin, bone and raw flesh.
  - Lifts have their own tile (`BaseTex.Lift`: steel deck, chevron border, a glowing seam).
  - Dev flags: `&autoplay` runs without the pointer lock, `&autofire` holds the trigger.
- Hazards and storeys (M6):
  - Floor hazards: `SPECIAL_DAMAGE` sectors hurt the player (`HAZARD_DAMAGE` every `HAZARD_TICKS`, on landing first). Half the pits in pit rooms are slime or lava in the theme's colour; pits stay climbable and the room's outer ring is always safe, so the route never needs to cross one.
  - Lifts: `SPECIAL_LIFT` one-cell sectors travel between their floor (bottom) and the height in `tag` (top). Standing still aboard for `LIFT_WAIT` ticks sends one to its other end at `LIFT_SPEED`; walking into one that is not level calls it (nobody climbs or drops onto a lift). The grid treats a lift as level with a neighbour at either end, so reachability and trap checks understand it; the sim adds the lift's real height through `MoveGate` (`tryStep`: go / wait / no, covering doors, lifts and enemies). Enemies do not ride lifts. Rendered as movers after doors: the platform, the shaft walls, and the edges to the floors at each end move with it.
  - Storeys: 40% of level-1 levels (60% later) split by mission-graph depth, the deeper part a storey (192) up. Key and secret connections never change storey, so each crossing is an ordinary corridor at the lower floor ending in a lift (an auto door on it moves to the lower end). `?map=test04` has a lift and a hazard pit.
- Progression and balance (M5):
  - Runs: `?run=<id>&level=<n>` plays level n of a run (seed `<id>-<n>`). The level only changes the population, so the same seed at a higher level is the same layout, harder. Finishing a level shows kills, secrets and time, and E moves to the next; dying retries the level. Every level starts fresh (100 health, 40 ammo), so replays need nothing but the map and the input log.
  - Balance (`gen/src/population.ts`): an enemy budget per ordinary room from its size, the level (`levelDifficulty`: +20% per level) and its depth along the mission graph (rooms near the exit get more, and more brutes); snipers only deep in a level or from level 2; bigger escorts for the mini boss (and, from level 3, the boss). Health: always one in the gate room before the boss, 1–2 in loot and secret rooms, sometimes elsewhere (more often deeper). Ammo: enough boxes to kill every enemy with a 1.5× margin, placed from the start outwards, plus one per loot and secret room.
  - Ammo: 40 to start, 200 max, 20 per box; each shot spends a round and an empty weapon clicks. Validation checks the level's ammo covers every enemy and that there is health wherever there are enemies.
  - The world pauses whenever the game does not have the mouse (the start screen and Esc), so nothing attacks before the player starts and every simulated tick is in the replay. `&autoplay` (dev) runs it without the lock.
  - Tools: `gen:stats -- --level n`; the seed browser has a level field.
- Procedural content (M4):
  - Textures: every texture id is baked once per level into an atlas (`ATLAS_FS`, one full-screen pass, tileable noise) in the colours of the level's theme (`base`, `tech`, `hell`, `crypt`; `render/src/themes.ts`) with seeded variation. `LEVEL_FS` samples it texel-exact; atlas alpha marks glowing texels (tech strips, pickups), which pulse; slime or lava flows by scrolling.
  - Enemy sprites: small 3D signed-distance models ray-marched once into a sprite atlas (`SPRITE_BAKE_FS`): 5 shapes × 8 directions × 4 frames (walk, walk, attack, dead). The app picks the direction from the enemy's facing (at the player once alert, along its step while walking) and the frame from its state. Eyes are marked in the atlas and glow through the wind-up. `/sprites.html` shows the whole sheet.
  - Sound: a jsfxr-style synth (`app/src/audio/synth.ts`, pure and deterministic) renders a seeded sound set (`sounds.ts`): shots, hits, deaths, doors, pickups, secrets, the exit, footsteps, and a wind-up sound per attack kind (the sniper's charge whine lasts its wind-up). Enemy and door sounds are panned and attenuated by position. Music (`music.ts`) is composed from the seed (mode, tempo, four-chord progression, 16-step bass, drum and arpeggio patterns) and plays in two layers; the combat layer fades in with the number of enemies chasing the player. M toggles music, N sound.
- Combat (M3), all in the deterministic sim, so replays cover it:
  - Player: 100 health, a free-aim hitscan weapon (hold the mouse button; `FIRE_COOLDOWN` 16 ticks, 20 damage) traced through the grid with the level's own floors, ceilings and doors (`castRay`), death and the exit ending the level.
  - Enemies (`ENEMY_DEFS` in `sim/src/enemies.ts`): grunt (projectiles), brute (melee), sniper (rare, telegraphed hitscan), mini boss and boss (volleys). Grid-bound, one per cell, own step timers, pathing on a distance field to the player's cell through auto doors (key and secret doors are walls to them). Modes: idle → alert → chase ⇄ windup → attack, pain, dead. They wake on sight (10 cells, line of sight through open cells), on gunfire (a flood fill of 14 cells that closed doors stop), or when shot.
  - Dodging is the core skill: projectiles (5 units/tick) take longer than a player step to cross a cell, melee and hitscan land only if the player is still adjacent or in sight when the wind-up ends. Every enemy is at least player height so level shots connect.
  - Projectiles collide with the grid (cells, floors, ceilings, closed doors) rather than line segments: every wall is on the grid.
  - Rendering: a dynamic sprite pass (`render/src/sprites.ts`) with procedural silhouettes per enemy type; eyes glow through the wind-up (the telegraph), pain flashes white, corpses stay. Health packs are mesh pickups like keys.
  - HUD: health, crosshair, a placeholder gun with muzzle flash, a red hurt flash, and death / level-complete screens (E retries or moves on).
  - Generator: enemies by room kind (ordinary rooms by size, the mini boss with an escort, the boss alone; none in start, exit, loot, or secret rooms), never in front of a doorway; health in loot and secret rooms and some ordinary rooms. `?map=test03` is a combat arena.
- Secrets (M2 slice 5): a secret door looks like the wall it sits in (same texture, no gap under it), ignores bumping, opens with E, and never shows a prompt. Opening it finds the secret (`secret` event, a notice, and a found/total count on the HUD). Secret areas (`SPECIAL_SECRET_AREA`, id in `tag`) stay off the automap until found. `test02` has one north of the key room.
- Doors and keys (M2 slice 4): door state and held keys in `SimState`, auto doors that open when walked into, key doors opened with E/Space while holding the key, key pickups, and events (`door`, `locked`, `key`) for the HUD and later sound. The renderer moves door slabs and hides taken keys with per-frame mover offsets on a static mesh. The HUD shows an E or the missing key in the upper right when facing a closed key door. `?map=test02` has both door types.

**Unused but reserved:** `InputFrame.run` (a candidate for a faster step), plus `fire`.

## Known gaps (roughly in priority order)

1. **Portal culling.** The mesh is already grouped per sector (`LevelRenderer.sectorRanges`), but everything is drawn in one call.
2. **Back-face culling** is off. Walls are single quads owned by the visible side.
3. **Sector lookup** (`SectorLocator`) is O(lines). That's fine now; use the grid or a BSP later.
4. **Pinch points:** `chainLoops` doesn't support loops touching at a single vertex, so generators must avoid them. `emitCellPlan` detects them and throws, naming the vertex.
5. **Middle textures on two-sided lines** (grates, windows) need alpha. Not implemented.
6. **Sub-cell decorative geometry** needs a Decorative line flag and renderer-only handling.
7. **Uniforms** are set by name. The WebGPU backend will need a declared uniform-buffer layout.

## Roadmap

- **M2 — real generator:** ✅ complete (v0.6.0).
  - ✅ Slice 0: trap detection in validation.
  - ✅ Slice 1: a mission graph with start, exit, doors, and loops, using cyclic generation in the style of Dormans. Door types are in Doors below.
  - ✅ Slice 2: grid embedding of the graph, flat single-storey floor plans.
  - ✅ Slice 3: room templates (hand-authored archetypes with procedural parameters), emitted through `CellPlan`.
  - ✅ Slice 4: doors and keys in the map format, sim, renderer, HUD, and generator; validation walks the level collecting keys.
  - ✅ Slice 5: secrets: optional dead-end rooms behind secret doors, hidden on the automap until found.
  - ✅ Slice 6: tooling: `/browse.html` shows thumbnails and stats for pages of seeds (click to play); `gen:stats` reports distributions through `levelStats`.
- **M3 — combat:** ✅ complete (generator v0.7.0). Grid-bound enemies with their own step timers and distance-field pathing, wake-up by sight, noise and damage, the idle/alert/chase/windup/pain/dead state machine, free-aim hitscan, dodgeable projectiles (grid collision, since all walls are on the grid), rare telegraphed hitscan snipers, player health, death and the exit. Balance (enemy budget by graph depth, health along the critical path) stays in M5; some levels currently have no health at all.
- **M4 — procedural content:** ✅ complete (generator v0.8.0). Theme-coloured textures baked to an atlas on the GPU; SDF-modelled 8-direction, 4-frame enemy sprites baked to a sprite atlas; a seeded jsfxr-style sound set with positional playback; a seeded two-layer music generator that follows combat. Still open: per-theme quantization palettes (all themes share the 64-colour palette), and baked sprites for projectiles and pickups.
- **M6 — hazards and storeys:** ✅ complete (generator v0.10.0). Damaging floors, lifts, and two-storey levels.
- **M7 — combat feel:** ✅ complete (generator v0.11.0). A heavy shotgun with automatic melee, infinite ammo, hordes of fragile enemies, spectacular deaths, bosses dropping keys, key sprites, mutant enemies, a lift tile.
- **M5 — progression and balance:** ✅ complete (generator v0.9.0). Runs of levels with rising difficulty, enemy budgets by level and graph depth, health and ammo along the way, ammo, level stats, and pause. Beyond the roadmap: the Backlog below.

## Doors (decided)

Doors live **in cells**: a door is a one-cell sector whose ceiling drops to its floor, as in Doom. This keeps all geometry on the 128 grid, and the grid treats a door cell as walkable when it is open. There are two types:

| Type | Opens by | Frequency | Used for |
|---|---|---|---|
| Auto | Walking into it (the step waits for it to open) | Most doors | Room-to-room connections, including both sides of the mini boss |
| Key | Pressing use (E/Space) while holding the matching key | Rare | Loot rooms and the level boss |
| Secret | Pressing use (E/Space) on what looks like a wall | 0–2 per level | Optional secret rooms |

A third type, a use door that opened with E but needed no key, was tried in slice 4 and dropped: it added a chore without a decision.

The mission graph therefore places keys to guard optional loot and the boss, rather than scattering locks along the critical path. Doors stay open once opened. When the player faces a closed key door, the HUD shows an E in the upper right if they hold the key, and the missing key otherwise. Lifts are still undecided.

In the map format a door is a one-cell sector with its kind in `Sector.special` (`DoorKind.Auto` or `DoorKind.Key`) and a key door's key id in `tag`; keys are things `KEY_THING_BASE + id`. Doors are stored open and start closed in the sim, so a map's geometry is always the open level.

## Open design questions

- **Step feel.** The default is 230 ms. Around 150 ms is snappier, and changing it is one constant.
- **Run key:** a faster step, or remove it.
- **Diagonal-facing move feel.** The compass helps; consider whether 8-way is ever wanted. The current answer is no.

## Backlog

Ideas noted during play-testing, not yet scheduled. Each line points at whatever already exists for it.

- **Catwalks and double-height rooms.** A catwalk bridges a tall room on a second level, and the player can walk under it. The sector model allows one floor and one ceiling per point, but the renderer is true 3D with a depth buffer (unlike Doom's), so the limit is the map format and the grid, not rendering. Plan: *slabs* (3D-floor style) on cells with a top and an underside, which means a `MAP_FORMAT_VERSION` bump; `CellGrid` cells hold a stack of walkable levels; `canStep` moves level to level with the same step and headroom rules, with the level picked by the player's z; reachability and trap search run over (cell, level); the automap dims levels below. The generator then gives tall rooms catwalks joining upper doorways, so rooms can connect on two levels. Schedule after M2 slice 4 (doors), so the grid and movement rule change once. Fully stacked rooms with walls on both levels are a bigger, later step.

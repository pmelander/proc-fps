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
| `gen` | `generate.ts` (v0.6.0: mission → layout → room templates → cell plan → sectors), `mission.ts` (mission graph), `layout.ts` (grid embedding), `rooms.ts` (room templates), `validate.ts` (structural + grid + reachability + traps), `scripts/stats.ts` (headless health check). |
| `sim` | `input.ts` (`InputFrame`, quantization), `world.ts`, `state.ts`, `player.ts` (grid movement), `sim.ts`, `replay.ts`. |
| `render` | `backend.ts` (interface), `webgl2.ts`, `mesh.ts` (map → per-sector mesh), `palette.ts` (64 colours), `shaders.ts`, `renderer.ts` (`LevelRenderer`). |
| `app` | `main.ts` (loop, interpolation, HUD, compass), `input.ts` (DOM → `InputFrame`), `automap.ts`. |

Commands:

```
npm install
npm run dev              # ?seed=anything  or  ?map=test01 / test02 (doors and keys)
npm run ci               # typecheck + tests + gen:stats (2000 seeds) + build
npm run maps:build       # regenerate test map JSON (CI fails if it drifted)
npm run gen:stats -- --seeds 10000
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
- The v0.6 generator: a mission graph (M2 slice 1) embedded on the grid (slice 2) as rooms sized by type, joined by corridors, with loops routed by pathfinding. Rooms use templates (slice 3): hall (pillar rows), platform (or an unclimbable plinth), pit, stairs to a dais, and arena (boss and mini boss); start, exit, and loot rooms stay plain. Floors are flat (one storey) and hazard stripes mark only corridor ends. Connections get doors (slice 4) as the mission says, auto or key, with keys placed on base floor in their rooms. Up to 2 secret rooms per level (slice 5) hang off ordinary rooms behind secret doors.
- The WebGL2 renderer, which uses per-sector light with distance falloff in 16 bands and renders at 240p before a 64-colour palette post pass with Bayer dithering.
- Placeholder procedural patterns per texture id, with floor and ceiling tiles aligned to cells.
- Grid movement, replays (F8 downloads one), the automap (hold Tab; rotates with the look direction, drawn at 240p in the palette), and the HUD compass showing where W goes.

**Verified:**
- The typecheck is clean.
- 50 tests pass.
- 2000 seeds produce 0 validation failures (about 12 ms per map including validation).
- The production build succeeds (about 45 kB JS).
- Headless Chromium (SwiftShader) renders correctly.

**Not yet verified:** real mouse and keyboard play. Pointer lock can't run headless.

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

- **M2 — real generator:**
  - ✅ Slice 0: trap detection in validation.
  - ✅ Slice 1: a mission graph with start, exit, doors, and loops, using cyclic generation in the style of Dormans. Door types are in Doors below.
  - ✅ Slice 2: grid embedding of the graph, flat single-storey floor plans.
  - ✅ Slice 3: room templates (hand-authored archetypes with procedural parameters), emitted through `CellPlan`.
  - ✅ Slice 4: doors and keys in the map format, sim, renderer, HUD, and generator; validation walks the level collecting keys.
  - ✅ Slice 5: secrets: optional dead-end rooms behind secret doors, hidden on the automap until found.
  - Slice 6: tooling (seed browser, distribution tracking in `gen:stats`).
  - Tooling: a seed browser with map thumbnails, and distribution tracking in `gen:stats`.
- **M3 — combat:**
  - Grid-bound enemies: one per cell, own step timers, BFS pathfinding.
  - Wake-up by noise flood fill across sectors.
  - A state machine: idle, alert, chase, attack, pain, death.
  - Free-aim hitscan and projectiles. Projectiles need circle/segment collision, since player collision was replaced by the grid.
  - Keep hitscan enemies rare or telegraphed, and tune projectile speed against `STEP_TICKS`.
- **M4 — procedural content:**
  - Textures baked to an atlas via GPU render-to-texture with per-theme palettes.
  - SDF-composed 8-direction enemy sprites.
  - WebAudio sound effects in the style of jsfxr, plus a pattern-based music generator.
- **M5:** progression, balance tuning (enemy budget by graph depth, ammo and health along the critical path), themes, and polish.

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

- **Health.** Nothing tracks it yet. M3 (damage from enemies) and M5 (health placed along the critical path) both assume it. It belongs in sim state so replays cover it.
- **Floor hazards.** Damage floors. `Sector.special` is already reserved for this, but nothing reads it. Depends on health. Validation must keep the critical path hazard-free, or at least survivable.
- **Elevators and storeys.** Floor plans are flat per storey (done in M2 slice 2 for a single storey); elevators will join storeys. Lifts are the undecided half of the doors question. On the grid, a lift fits as a one-cell sector whose floor moves between two heights, the same moving-sector machinery as doors (M2 slice 4). Validation must treat a lift as a step in both directions only when it can be called from either end.
- **Catwalks and double-height rooms.** A catwalk bridges a tall room on a second level, and the player can walk under it. The sector model allows one floor and one ceiling per point, but the renderer is true 3D with a depth buffer (unlike Doom's), so the limit is the map format and the grid, not rendering. Plan: *slabs* (3D-floor style) on cells with a top and an underside, which means a `MAP_FORMAT_VERSION` bump; `CellGrid` cells hold a stack of walkable levels; `canStep` moves level to level with the same step and headroom rules, with the level picked by the player's z; reachability and trap search run over (cell, level); the automap dims levels below. The generator then gives tall rooms catwalks joining upper doorways, so rooms can connect on two levels. Schedule after M2 slice 4 (doors), so the grid and movement rule change once. Fully stacked rooms with walls on both levels are a bigger, later step.
- **Sound synthesis.** Already planned for M4: WebAudio effects in the style of jsfxr and a pattern-based music generator. No hand-made audio files, like the rest of the assets. Sounds are synthesised from a seed (per theme or per level) so they stay reproducible. Playback lives in `app` (WebAudio is a DOM API); the sim only emits events such as step, door, and hit, which keeps it deterministic and replayable.

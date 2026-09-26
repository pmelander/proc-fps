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
| `core` | `map.ts` (format v0, `hashMap`), `rng.ts` (sfc32 + named forks), `dmath.ts` (deterministic trig), `math.ts` (render-side mat4), `geometry.ts` (sector loops, `SectorLocator`), `builder.ts` (`MapBuilder`, `rect`), `grid.ts` (`CellGrid`, `validateGridAlignment`), `validate.ts`, `constants.ts`, `textures.ts`. `maps/test01.json` is built by `scripts/build-test-maps.ts`. |
| `gen` | `generate.ts` (v0.2.0 stub), `validate.ts` (structural + grid + reachability), `scripts/stats.ts` (headless health check). |
| `sim` | `input.ts` (`InputFrame`, quantization), `world.ts`, `state.ts`, `player.ts` (grid movement), `sim.ts`, `replay.ts`. |
| `render` | `backend.ts` (interface), `webgl2.ts`, `mesh.ts` (map → per-sector mesh), `palette.ts` (64 colours), `shaders.ts`, `renderer.ts` (`LevelRenderer`). |
| `app` | `main.ts` (loop, interpolation, HUD, compass), `input.ts` (DOM → `InputFrame`), `automap.ts`. |

Commands:

```
npm install
npm run dev              # ?seed=anything  or  ?map=test01
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
- Units are Doom-like: cell 128, player height 56, eye 41, max step 24.
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
- Map format and validation.
- The grid-aligned test map, which covers a platform, drop, stairs, and a void pillar.
- The v0.2 stub generator: a chain of rooms plus stepped one-cell corridors, with pillar, platform, and pit features in interior cells.
- The WebGL2 renderer, which uses per-sector light with distance falloff in 16 bands and renders at 240p before a 64-colour palette post pass with Bayer dithering.
- Placeholder procedural patterns per texture id, with floor and ceiling tiles aligned to cells.
- Grid movement, replays (F8 downloads one), the automap (Tab), and the HUD compass showing where W goes.

**Verified:**
- The typecheck is clean.
- 31 tests pass.
- 2000 seeds produce 0 validation failures (about 1.4 ms per map).
- The production build succeeds (about 45 kB JS).
- Headless Chromium (SwiftShader) renders correctly.

**Not yet verified:** real mouse and keyboard play. Pointer lock can't run headless.

**Unused but reserved:** `InputFrame.run` (a candidate for a faster step), plus `fire` and `use`.

## Known gaps (roughly in priority order)

1. **Trap detection in validation.** Every cell reachable from the start must be able to reach the exit. Today a pit you can't climb out of would pass.
2. **Portal culling.** The mesh is already grouped per sector (`LevelRenderer.sectorRanges`), but everything is drawn in one call.
3. **Back-face culling** is off. Walls are single quads owned by the visible side.
4. **Sector lookup** (`SectorLocator`) is O(lines). That's fine now; use the grid or a BSP later.
5. **Pinch points:** `chainLoops` doesn't support loops touching at a single vertex, so generators must avoid them.
6. **Middle textures on two-sided lines** (grates, windows) need alpha. Not implemented.
7. **Sub-cell decorative geometry** needs a Decorative line flag and renderer-only handling.
8. **Uniforms** are set by name. The WebGPU backend will need a declared uniform-buffer layout.

## Roadmap

- **M2 — real generator:**
  - A mission graph with start, exit, 2–3 key/door locks, loops, and secrets, using cyclic generation in the style of Dormans.
  - Grid embedding of the graph.
  - A room grammar: hand-authored archetypes with procedural parameters.
  - Sectorization, followed by validation that covers keys before locks and no traps.
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

## Open design questions

- **Step feel.** The default is 230 ms. Around 150 ms is snappier, and changing it is one constant.
- **Run key:** a faster step, or remove it.
- **Doors and lifts:** do they live on cell edges or in cells?
- **Diagonal-facing move feel.** The compass helps; consider whether 8-way is ever wanted. The current answer is no.

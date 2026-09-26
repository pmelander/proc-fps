# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

proc-fps is a fully procedural, Doom-style browser FPS: 2.5D sector geometry rendered in true 3D by a custom WebGL2 renderer, driven by a deterministic 60 Hz sim. Movement is grid-based (one 128-unit cell per step) with free mouse look. `PROJECT_SUMMARY.md` holds the design rationale, known gaps, roadmap and open questions. Read it before architectural work.

## Commands

TypeScript 7, Vite 8, Vitest 5, tsx, npm workspaces. CI uses Node 22.

```bash
npm install
npm run dev                          # Vite app → http://localhost:5173/?seed=anything  or  ?map=test01 / test02;  /browse.html = seed browser
npm run typecheck                    # tsc --noEmit over every package
npm test                             # vitest run (packages/*/test/**/*.test.ts, Node env)
npx vitest run packages/sim/test/sim.test.ts          # one file
npx vitest run -t "buffers a press made mid-step"     # one test by name
npm run maps:build                   # regenerate packages/core/maps/*.json from build-test-maps.ts
npm run gen:stats -- --seeds 2000    # generator health check (any invalid map exits non-zero) + level distributions
npm run ci                           # typecheck + test + gen:stats (2000) + build
```

In addition to `npm run ci`, the CI pipeline (`.github/workflows/ci.yml`) runs `maps:build` and then `git diff --exit-code packages/core/maps`. After any change to `MapBuilder`, the map format, or `build-test-maps.ts`, run `npm run maps:build` and include the regenerated JSON. Never hand-edit `maps/*.json`.

## Architecture

Packages are source-first: each `package.json` `exports` points straight at `src/index.ts`, so there is no build step between packages. Relative imports use `.js` extensions, and type-only imports need `import type` (`verbatimModuleSyntax`). `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on.

Data flows one way. **`MapData` (core/map.ts) is the contract** between producers and consumers:

```
gen.generate(seed) ─┐                       ┌─> sim: createWorld(map) → stepSim(world, state, InputFrame) per tick
core MapBuilder ────┴─> MapData ─ validate ─┤
(test maps)                                 └─> render: buildLevelMesh(map) → LevelRenderer → RenderBackend (WebGL2)
```

- **core**: map format v0 and `hashMap`, `CellPlan`/`emitCellPlan` (cells → sectors; outlines split automatically wherever the neighbour changes, so generators never place T-junction vertices by hand; throws on pinch points), `Rng` (sfc32 with named forks), deterministic trig (`dsin`/`dcos`), `MapBuilder` + `rect`, sector loop geometry and `SectorLocator`, and `CellGrid`. `CellGrid` is derived from the sector map and is the single movement truth: `canStep` is shared by the sim, the generator validation, and future AI.
- **gen**: `generate.ts` runs mission → layout → room templates → `CellPlan` → sectors (`GENERATOR_VERSION = '0.6.0'`); `generateDetailed` also returns the mission, layout, room designs, attempt count and failure reasons. `mission.ts` is the mission graph (rooms and door types, built as Dormans-style cycles; `validateMission` checks the key and mini-boss progression). `rooms.ts` holds the room templates (each keeps the room's outer ring as base floor, so doorways stay connected). `layout.ts` embeds the mission on the grid: rooms placed along a spanning tree with straight corridors, loops routed by turn-penalised pathfinding, and a separation rule so structures touch only at doorways. Floors are flat (one storey). Failed layouts retry on the next deterministic RNG fork. `validateGenerated` layers gameplay checks (grid alignment, reachability, traps) on top of core's structural `validateMap`.
- **sim**: fixed-step state machine. `InputFrame`s go in; `SimState` holds the player, door progress (per door id, doors stay open), held keys, taken pickups, found secrets, and per-tick `events`. `World` derives doors (`doorSectors` order = door id) and key pickups from the map. Movement asks a `DoorGate` whether a cell is blocked by a closed door and bumps auto doors open (key doors open with use while holding the key; secret doors open with use and count as found). `ReplayRecorder` and `runReplay` store a map hash plus the input log, and `hashState` pins behaviour in tests.
- **render**: `RenderBackend` interface with the WebGL2 implementation behind it. The mesh is static and grouped per sector (`LevelRenderer.sectorRanges`, reserved for portal culling). Moving parts are *movers*: vertices tagged with a mover id (door ids, then key pickups) shift down by `LevelRenderer.movers[id]`, a uniform array the app fills each frame from sim state (door slabs lower, taken keys sink out of view). The scene renders at low resolution, then a 64-colour palette post pass applies Bayer dithering.
- **app**: browser shell only. It holds the loop with tick interpolation, DOM input → `InputFrame`, the HUD compass, the door prompt (E, or the missing key, upper right), and the automap (hold Tab; look direction up). `browse.html` + `src/browse.ts` is the seed browser (a second Vite entry, `vite.config.ts`), drawing `src/thumbnail.ts` top-down maps with `levelStats` from gen. F8 downloads the current replay.

## Invariants

1. `core`, `gen` and `sim` never import DOM APIs. They run in Node for tests and CI, and later in a Worker. Only `render/webgl2.ts` and `app` touch the DOM.
2. No `Math.random` in core, gen or sim. Use `Rng` and fork a named stream per subsystem, so that one subsystem's draws never reshuffle another's. (`app` uses `Math.random` only to pick a URL seed.)
3. No `Math.sin/cos/atan2/hypot/pow` in sim. They differ at the ULP level across JS engines and break replays. Use `dsin`/`dcos`. `+ - * / sqrt floor round` are safe.
4. The sim advances only through `stepSim`, at 60 Hz. Rendering interpolates between the previous tick and the current one.
5. Bump `GENERATOR_VERSION` for any change that alters output for an existing seed. Bump `MAP_FORMAT_VERSION` for breaking format changes.
6. A changed replay or state hash in a test is a behaviour change. Decide deliberately. Don't just update the expected value.
7. `CELL_SIZE`, `STEP_TICKS`, enemy step timers and projectile speeds are tuned together.

## Geometry conventions

- In map space, (x, y) has y pointing north. World space is X = x, Y = up, Z = −y. Heading 0/1/2/3 = E/N/W/S = h × 90°.
- A linedef's front side is on the **left** of v1→v2 (Doom uses the right). Outer sector loops are CCW, holes are CW.
- All geometry is axis-aligned on the 128 lattice, and things sit at cell centres (`validateGridAlignment`).
- Adjacent sectors must share identical edges. Split T-junctions with `rect(..., { east: [...] })`. Loops that touch at a single vertex are unsupported (`chainLoops`).
- `MapBuilder` merges shared edges into two-sided lines. A wall takes its texture from the side it is seen from, so a platform riser needs `setSideTextures` to override the surrounding room's `lower` texture.
- Units: cell 128, player height 72, eye 64, max step 24. Taller than Doom's 56/41, which only read right through Doom's 1.2 vertical pixel stretch. Openings must be at least `PLAYER_HEIGHT` tall.

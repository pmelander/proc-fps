# Null Sector

A fully procedural, Doom-style FPS that runs in the browser. It uses 2.5D sector geometry rendered in true 3D, with a custom WebGL2 renderer and a deterministic sim.

Movement is grid-based with free look: the mouse aims freely, and WASD steps one 128-unit cell forward, back, or sideways, relative to the view yaw snapped to the nearest cardinal direction.

```
npm install
npm run dev            # http://localhost:5173/  (a new run)  or  ?run=id&level=n, ?seed=anything, ?map=test01 … test06;  /browse.html = seed browser
npm run ci             # typecheck + tests + generator health + build
```

## Layout

| Package | Role | DOM? |
|---|---|---|
| `core` | Map format (v1, with slabs), seeded RNG, deterministic trig, geometry, `MapBuilder`, validation | no |
| `gen` | Level generator (mission graph → grid layout → sectors) + gameplay validation + `gen:stats` | no |
| `sim` | Fixed-step deterministic simulation, input frames, replays | no |
| `render` | `RenderBackend` interface, WebGL2 backend, level mesh builder, palette post pass | yes (backend only) |
| `app` | Browser shell: loop, input, HUD, automap | yes |

`core`, `gen` and `sim` must never import DOM APIs. They run in Node for tests and CI, and in a Worker later.

## Rules that keep this sane long-term

1. **The map format is the contract.** Generators emit `MapData`, and the sim and renderer only consume it. Any breaking change bumps `MAP_FORMAT_VERSION`.
2. **seed + `GENERATOR_VERSION` = level.** Bump the version on any change that alters output for an existing seed.
3. **No `Math.random` in core, gen or sim.** Use `Rng` and fork a named stream per subsystem.
4. **No `Math.sin/cos/atan2/hypot` in sim.** They differ between JS engines at the ULP level and break cross-browser replays. Use `dsin` and `dcos` from core.
5. **Sim advances only in fixed ticks (60 Hz)** from `InputFrame`s. Rendering interpolates.
6. **Replays are map hash + input log.** If a replay test's hash changes, that is a behaviour change: decide deliberately.

## Movement model

- The mouse controls yaw and pitch continuously. They never affect position.
- The movement heading is the yaw snapped to E, N, W, or S. It switches only past 45° plus `HEADING_HYSTERESIS` (about 8°), so looking near a diagonal doesn't flip W between two directions. The HUD arrow shows where W goes.
- A step is `STEP_TICKS` (18 ticks, 300 ms: an armoured pace) with a smoothstep ease. Holding a key repeats seamlessly. A press made mid-step is buffered one deep, resolved against the heading at press time.
- With W and D both held, the most recently pressed axis wins. There are no diagonal steps.
- Steps up of at most `MAX_STEP` follow the ease. Stepping off a ledge falls once past the cell edge, and the next step waits for landing.
- `CellGrid` (core) is derived from the sector map and is the movement and AI truth. `canStep` is shared by the sim, generator validation, and (later) enemies.
- `CELL_SIZE`, `STEP_TICKS`, enemy step timers, and projectile speeds are tuned together.

## Conventions

- Map space is (x, y) with y pointing north. World space is X = x, Y = up, Z = −y.
- A linedef's front side is on the **left** of v1→v2. Sector outer loops are CCW and holes are CW.
- All geometry is axis-aligned and on the 128-unit cell lattice, and things sit at cell centres (`validateGridAlignment`). Sub-cell decorative geometry will need a Decorative line flag.
- Adjacent sectors must share identical edges, so split T-junctions with `rect(..., { east: [...] })`.
- Units are Doom-like: cell 128, player height 72, eye 64, max step 24.

## Status

M1–M23 are in place: map format, WebGL2 renderer with sector lighting and palette quantization, grid movement with free look, replays, CI, and the level generator (mission graph → grid layout → room templates, with auto doors, key doors, and secrets), and combat: grid-bound enemies that path, wake on sight and gunfire, and telegraph their attacks; free-aim hitscan; dodgeable projectiles; health. Textures, enemy sprites, sound and music are all generated: themed texture atlases, SDF-modelled 8-direction sprites, a jsfxr-style synth and a seeded music generator. A run alternates level types: flat, wide compounds, and ascents and descents over 3–6 storeys joined by lifts, one-way drops, bridges and atriums ringed by catwalks, with slime and lava pits and catwalk rooms you can cross or walk under. Combat is a heavy energy scattergun and a heavy bolter with explosive bolts (infinite ammo, magazines, R reloads, 1/2 or the wheel to switch) a left-hand chainsword (invulnerable while it grinds) and scarce grenades (E; doors open with Space) against hordes of mutants that burst into gibs, and every level breeds its own: two variants of each ordinary role with new body plans, legs, markings and skins that stand out from the level, and stats that pull opposite ways; grunts spit aimed bolts, lobbed globs or homing orbs; bosses fight in phases (ring bursts, walls with a gap, split shots, spirals, homing fans, summoned packs, telegraphed slams) and drop the keys onward. Runs start from a title screen at one of four difficulties and are a sequence of levels that get harder, scored and tracked across levels, with a summary and best runs at the end (`?run=<id>&level=<n>&diff=<d>`). `/browse.html` previews seeds, `/sprites.html` shows the enemy sprite sheet.

Next: the Backlog in PROJECT_SUMMARY.md (projectile patterns).
- Open design questions in PROJECT_SUMMARY.md.
- A WebGPU backend behind `RenderBackend` when compute is needed.

Press F3 in-game for a perf overlay (F4 toggles culling). Press F8 in-game to download the current replay. Drop it into a sim test to pin a bug.

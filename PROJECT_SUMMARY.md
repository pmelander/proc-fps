# proc-fps — project summary

A fully procedural, Doom-style FPS running entirely in the browser, planned as a long-term project. No hand-made assets: levels, textures, sprites, and audio are all generated from a seed.

This file summarises the decisions made so far, the current state of the code, and what comes next. It can double as `CLAUDE.md` context.

## Core decisions (and why)

| Decision | Rationale |
|---|---|
| 2.5D sector geometry rendered in true 3D | Keeps the Doom feel; generation, collision, and culling are far simpler than full 3D. Sectors are natural portals. |
| Custom renderer (no Three.js) behind a `RenderBackend` interface | The defining features (portal culling, sector lighting, palette quantization) fight a general scene graph. WebGL2 now, WebGPU slot-in later. |
| Grid movement + free mouse look | Mouse aims freely; WASD steps one 128-unit cell forward, back, or sideways (Grimrock-style movement with shooter aiming). Suits procedural levels, makes AI and doors trivial, and makes sidestepping projectiles the core dodge skill. |
| Map format (v1) as the backbone contract | Generator emits `MapData`; sim and renderer consume it. Enables hand-authored test maps, a future editor, and golden tests. |
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
| `core` | `map.ts` (format v1: slabs, `hashMap`), `cells.ts` (`CellPlan`: cells → sectors with automatic T-junction splits), `rng.ts` (sfc32 + named forks), `dmath.ts` (deterministic trig), `math.ts` (render-side mat4), `geometry.ts` (sector loops, `SectorLocator`), `builder.ts` (`MapBuilder`, `rect`), `grid.ts` (`CellGrid`, `validateGridAlignment`), `validate.ts`, `constants.ts`, `textures.ts`. `maps/test01.json` is built by `scripts/build-test-maps.ts`. |
| `gen` | `generate.ts` (v0.17.0: mission → layout → room templates → cell plan → sectors), `mission.ts` (mission graph), `layout.ts` (grid embedding), `rooms.ts` (room templates), `population.ts` (enemies, health and ammo by level and depth), `validate.ts` (structural + grid + reachability + traps), `scripts/stats.ts` (headless health check). |
| `sim` | `input.ts` (`InputFrame`, quantization), `world.ts`, `state.ts`, `player.ts` (grid movement), `sim.ts`, `replay.ts`. |
| `render` | `backend.ts` (interface), `webgl2.ts`, `mesh.ts` (map → per-sector mesh), `palette.ts` (64 colours), `shaders.ts`, `renderer.ts` (`LevelRenderer`). |
| `app` | `main.ts` (loop, interpolation, HUD, compass), `input.ts` (DOM → `InputFrame`), `automap.ts`. |

Commands:

```
npm install
npm run dev              # ?seed=anything[&type=compound|ascent|descent]  or  ?map=test01 / test02 (doors, keys, secret) / test03 (combat) / test04 (lift, hazard) / test05 (catwalk) / test06 (bridge);  /browse.html = seed browser;  /sprites.html = enemy sprite sheet
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
- A step lasts `STEP_TICKS` = 18 ticks (300 ms) with a smoothstep ease, about 430 u/s: a lumbering armoured pace (it was 14 ticks, Doom's walk, until play-testing asked for more time to react).
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
- The v0.15 generator (three level types: flat compounds, ascents and descents over 3–5 storeys joined by lifts, one-way drops, bridges and atriums; catwalk rooms; hordes of fragile enemies; the mini boss and boss carry the keys onward; each level also gets a theme, and `generate(seed, { level, type })` scales its population): a mission graph (M2 slice 1) embedded on the grid (slice 2) as rooms sized by type, joined by corridors, with loops routed by pathfinding. Rooms use templates (slice 3): hall (pillar rows), platform (or an unclimbable plinth), pit, stairs to a dais, and arena (boss and mini boss); start, exit, and loot rooms stay plain. Floors are flat within each storey and hazard stripes mark only corridor ends. Connections get doors (slice 4) as the mission says, auto or key, with keys placed on base floor in their rooms. Up to 2 secret rooms per level (slice 5) hang off ordinary rooms behind secret doors.
- The WebGL2 renderer, which uses per-sector light with distance falloff in 16 bands and renders at 240p before a 64-colour palette post pass with Bayer dithering.
- Placeholder procedural patterns per texture id, with floor and ceiling tiles aligned to cells.
- Grid movement, replays (F8 downloads one), the automap (hold Tab; rotates with the look direction, drawn at 240p with filled floors), and the HUD compass showing where W goes.

**Verified:**
- The typecheck is clean.
- 117 tests pass.
- 2000 seeds produce 0 validation failures (about 12 ms per map including validation).
- The production build succeeds (about 45 kB JS).
- Headless Chromium (SwiftShader) renders correctly.

**Not yet verified:** real mouse and keyboard play. Pointer lock can't run headless.

- Enemy behaviour (M16):
  - Lifts: the pathing field no longer treats lifts as walls, so enemies route through them between storeys. They ride by the player's rules (`liftAllows` in ai.ts): never on or off a moving lift; onto one that is not level they call it and wait, but never one the player stands on; off one towards a floor it is not level with they send it there and ride; and the way off must be open at the lift's real height. An enemy's height follows the platform (`floorNow`).
  - Flanking: two enemies in five (by index and variant, `flankSide`) flank to the player's left or right: while their path is longer than 4 steps they make for the reachable cell about 3 cells to that side of the player (across the player's facing, a second distance field per side, computed at most once a tick), then close in directly. Round a loop, a horde now comes from both ways.
  - High ground: a room's catwalk tops (an atrium's ring, the catwalk over a pit) are perches. Snipers picked for a room go up there when one is free, and an atrium gets a sniper on its ring with a chance rising with the level. `THING_HIGH` (flag 1 << 6) marks them; the sim starts them on the slab (level 1) and validation checks that level is walkable.
- More weapons (M15):
  - Guns are data (`core/src/weapons.ts`, `WEAPONS`): cooldown, magazine, reload, damage, pellets and spread, and an optional burst. The scattergun's pellets lose damage with range (`falloffAt`: full out to 2 cells, falling to a quarter at 8), so point-blank it is devastating and at range it only sprays. The heavy bolter fires every 9 ticks (6.7 a second), one bolt walking a small fixed pattern (`BOLT_SPREAD`, so replays hold), 12 damage, and each bolt bursts where it lands for 7 more to every enemy within 56 units of its body (a `blast` event). Its drum holds 30 and reloads in 2 s. Ammo stays infinite.
  - Switching: 1 and 2, the mouse wheel, or Q for the last gun; the request resolves to a weapon index before it is recorded (a new `weapon` input), so replays hold. A switch takes `WEAPON_SWITCH_TICKS` (24): the old gun lowers, the new one rises, nothing fires meanwhile, a reload in progress is dropped, the new gun's cooldown starts clear, and each gun keeps its own magazine (`PlayerState.mags`). The chainsword works with either.
  - The bolter view model (`bolter.ts`): a boxy gunmetal body with red and brass trim, a brass-banded drum on top, twin barrels firing in turn with a flash at that muzzle, and a glowing strip down its side that drains with the drum. Bolts leave a bright tracer and burst in a fireball with sparks and chips. Its sound is layered like the scattergun's (crack, punch, noise blast, distorted boom, sub-bass thump) but short enough to stack at its rate, the burst a deep rolling thud; the switch a mechanical clunk.
  - The ammo panel names the ammunition (scatter cell, bolt drum), shows a pip per round (thin ticks for the 30-round drum) and the weapon slots with the one in hand lit.
- Rendering performance (M14):
  - The biggest cost was the palette post pass: it matched 64 colours per pixel at full screen resolution times the device pixel ratio. Its dither is per scene pixel, so quantizing at the scene's 240 rows gives the same image: the canvas now holds exactly the low-res scene and CSS scales it up pixelated (`image-rendering: pixelated`), about 20× less fill at 1080p and 80× on a high-DPI screen.
  - Portal culling (`visibility.ts`, `PortalGraph`): from the camera's sector the view floods through two-sided lines, each narrowing the horizontal angle window, with sectors within 24 units of the camera rooted too (standing on a portal mid-step). Heights and door states are ignored, so it is conservative. On generated levels it keeps about 7% of sectors and 7–10% of triangles, in 7–16 µs a frame. The visible sectors' index ranges are merged where contiguous and drawn in one call (`DrawCall.ranges`). A test casts rays across the field of view from random poses in generated levels: every sector a ray passes through must be kept.
  - Sprite quads (gore can be over a thousand) are written into one reused buffer instead of a new array each frame.
  - F3 shows frame time, update and render CPU time, sectors and triangles drawn, ranges, sprites and the canvas size; F4 toggles culling for comparison.
- A heavier shot and its debris (after M12): the shot sound is a low zap, a crack, a long blast, a distorted boom and a sub-bass thump, played a little lower or higher each time. Each shot throws a tracer spark along every pellet (the sim's fixed spread, traced in the app with `castRay`), and where a pellet strikes a wall or floor a burst of white-hot sparks and stone chips that bounce and settle (new `Spark` and `Chip` sprites; pellets that hit an enemy make blood instead).
- Fixed: stepping off a raised lift towards a lower cell (the wall above a corridor's opening) walked through the wall and fell a storey. The grid lets a lift stand at whichever end suits a step; the sim now also requires the opening at the lift's real height.
- Enemy variety (after M12):
  - Each level breeds two variants of every ordinary role (grunt, brute, sniper), so it holds six kinds of ordinary enemy plus its mini boss and boss. Stats (`enemyDefsFor` now returns a pair per role; read one with `defOf(defs, enemy)`): the second variant takes the opposite speed trait (one quick and frail, one slow and tough) and, for grunts, another spit pattern. The generator marks second-variant enemies with `THING_VARIANT` (flag 1 << 5): 40% of rooms hold only the first, 40% only the second, 20% mix them. `EnemyState.variant` carries it into the sim.
  - Looks (`enemyLooks` now returns 8, one per sprite row: grunt, grunt, brute, brute, sniper, sniper, mini boss, boss; `spriteRow`): the second variant shifts the role's hue 30–50° towards clearer ground, flips its lightness, stands on different legs, wears another pattern and grows its own body plan. New traits: four leg types (biped, digitigrade, crawler with two splayed legs a side, slug), glowing markings (30%: the pattern's accent areas glow in the hue farthest from the theme and the skin; self-lit in SPRITE_FS, atlas alpha 0.68), wider saturation and value, and accents from several schemes (a darker shade, the complement, a triad, a pale belly).
  - The bake shader stays cheap to compile: legs are evaluated once after the silhouette, and all four types share one three-segment leg.
- The chainsword (after M12):
  - Melee is a chainsword in the left hand, drawn only while it attacks. Firing with an enemy within `MELEE_REACH` (190: the cell ahead and both diagonals) and just over 45° of the aim swings it instead of shooting; right-click or V swings it anywhere (a new replayed `melee` input).
  - An attack lasts `MELEE_TICKS` (48, 0.8 s): the blade comes up, then grinds `MELEE_HITS` (4) times, `MELEE_HIT_INTERVAL` (6) apart from tick `MELEE_FIRST_HIT` (8), each `MELEE_DAMAGE` (20) to everyone in the arc, and every hit makes them flinch, so a grind also stuns them out of their attacks. From the start through the grind (`MELEE_IFRAMES`, 30 ticks) nothing hurts the player: blows are turned away (`shielded` event, a clang and a pale blue glow from their direction). Nothing else fires until the attack ends; it needs no rounds and runs during a reload.
  - The view model (`chainsword.ts`): an armoured red-and-gold housing and a toothed blade whose chain runs faster while grinding. The attack is a low uppercut: it rises from below the screen, keeps lifting and shaking through the grind, then drops away, while the scattergun steps aside. Sparks spray off the teeth while it grinds and blood with every bite. Sounds: a revving two-stroke, a biting grind per hit.
- More gore (render-only, so replays are unaffected): kills burst into about half as many gibs again and four times their number in blood; hits spray blood out of the far side, away from the blow; drops that land become pools on the floor (flat sprites, a new `Sprite.flat`) and drops that hit a wall stick there, lingering for two minutes; a corpse leaves a pool where it lands and a smear along its throw; kills within 2.5 cells, and chainsword bites, splatter the screen with drops that run down and fade (`screenblood.ts`).
- Tempo and damage direction (after M12):
  - A heavier, slower pace: player steps of 18 ticks (was 14). Enemies slowed with it (step timers about 25% longer, wind-ups about 15% longer, projectiles 20% slower, the hitscan wind-up floor 58), so the tuning rules still hold: enemies are slower than the player and a sidestep dodges any projectile.
  - Heavier mouse look: lower sensitivity (0.0019 rad/px) and a turn-rate cap in the input sampler (0.08 rad/tick turning, 0.05 looking). A faster flick is spread over the next ticks, not lost, so the aim lands where the mouse went; replays record the capped turn.
  - Damage direction: `hurt` events carry `from` (the enemy for melee and hitscan, back along a projectile's flight; none for hazard floors), and the HUD glows red on the screen edge it came from (ahead is the top, behind the bottom), fading over 0.9 s.
- Gun play: a magazine (after M12):
  - Ammo stays infinite, but the scattergun's cell holds `MAG_SIZE` (8) shots. The eighth starts a `RELOAD_TICKS` (78, 1.3 s) reload; R reloads early (a new `reload` input, so replays hold; older replays read it as false). Nothing fires during a reload, but the automatic melee strike still does. The sim emits `reload` and `reloaded`.
  - The gun's side cell shows the rounds left; a reload dips and rolls the gun while the cell refills, with an eject-and-charge sound and a double click when ready.
  - HUD: a health bar top centre (green, amber at half, flashing red at a quarter) with the compass under it; bottom right the ammo type (scatter cell), a glowing pip per round in the theme's light colour, the count and an infinite reserve, and a progress bar while reloading. Held keys moved to the bottom left.
- Level types and verticality (M12):
  - Three types (`gen/src/levels.ts`), each a profile of mission size, room sizes, storey count and how storeys join. **Compound:** one storey, wide, more rooms, detours and dead ends, bigger rooms; hordes and flanking. **Ascent:** start on storey 0, the gate, boss and exit at the top of 3–5 storeys. **Descent:** the same upside down, taken mostly by drops. A run paces them by level (`levelTypeFor`): compound, ascent, compound, descent, …; `?seed=<s>&type=<t>` and the seed browser's type menu pick one.
  - Storeys come from each room's progress along the critical path (`MissionNode.progress`: 0 at the start, 1 at the gate, boss and exit, spread evenly along both arcs of the main cycle; branches take their host's), so the climb or fall spreads over the whole level. A connection climbs at most two storeys (a tall lift); fewer storeys when the mission is too short.
  - **Drops:** a corridor down one storey may run at the upper floor and end high in the lower room's wall, a ledge you jump from (gravity takes you down) and cannot climb back to. Each drop is kept only if the level still cannot strand the player: `strandsPlayer` (`progress.ts`) searches (room, keys held) states on the mission graph with drops one way. Descents keep most (drops 3–4 per level typically), ascents a few as shortcuts back down.
  - **Atriums:** ordinary rooms with a neighbour a storey up may become tall rooms ringed by a grating catwalk at that storey. Corridors from above arrive on the catwalk, corridors level with the room pass under it, and a lift in an inner corner joins them (`atriumDesign`).
  - Validation searches (cell, level, keys held) states with the sim's step rules (`validateProgress`): wherever the player can get with whatever keys they hold, the exit must still be reachable. It catches a key left above a drop, which plain reachability cannot.
  - The seed browser shows type, storeys, drops and atriums, and its thumbnails shade floors over each level's own height range. `gen:stats` cycles the types across seeds (or `--type`) and reports storeys, drops, atriums and bridges per type.
- Procedural enemies (M11):
  - Stats: `enemyDefsFor(seed)` (core/bestiary.ts) varies each role per generated level. A speed trait trades pace for hit points; grunts spit one bolt, twin softer bolts, or one quick bolt after a longer wind-up; brutes hit harder or softer; snipers vary damage and wind-up; the mini boss and boss fire wider softer volleys or tighter harder ones. Every variant keeps the tuning rules: slower than the player, projectiles at least `MIN_PROJECTILE_CELL_TICKS` per cell, hitscan wind-ups of at least `MIN_HITSCAN_WINDUP`, and ordinary enemies at most `MAX_FODDER_HP` (one close blast). The sim reads them from `world.enemyDefs`; hand-built maps (no seed) keep the baseline `ENEMY_DEFS`, so their tests and replays are unchanged.
  - Looks: `enemyLooks(seed, theme)` (render/bestiary.ts) breeds each of the five silhouettes: hunch, bulk, limb heft, head and jaw size, 0–2 horn pairs, back spikes, 1–4 eyes, a second pair of arms, a tail, and a mottled, banded, spotted or pale-bellied skin. `SPRITE_BAKE_FS` takes them as `uPlan` and the atlas is baked per level.
  - Contrast: role hues keep out of bands around the theme's saturated colours (its lights, slime, hazard paint, tinted stone) and apart from each other, so a crypt never breeds green mutants and a brute never passes for a grunt. `/sprites.html?seed=<s>&theme=<t>` shows a level's set with stats and theme swatches.
  - The exit: a glowing pad (`BaseTex.Exit`, lit whatever the sector light), a dithered beacon of light above it, and a hum within ten cells.
- Play-test polish (M10):
  - Lifts stop after each trip: standing on one sends it once, and it goes again only after you step off and back on (`LiftState.armed`).
  - Blast doors: auto and key doors are ribbed steel with a middle band (hazard chevrons, or the key's colour with a key emblem), bolts and glowing status lights, set in a new door-frame texture (a steel jamb with a light strip) on the door cell's walls. Door panels now carry the texture vertically too: the panel's bottom edge keeps its v and the texture rides up with it (before, both edges slid together, so a panel sampled a single texel row).
  - The automap samples the cell under each low-res pixel: solid floors shaded by height in four steps, with a faint cell grid and darker seams where the height changes; hazards (checker), lifts (stripes), catwalks (grating), closed doors (grey, or the key's colour) and the exit (a green checker) in their own colours; red walls outline the open level. Keys and the player are upright icons. It is zoomed out to 8 px a cell, and the weapon lowers while it is up.
  - The HUD shows the keys you hold as key icons above the health.
- Weapon redesign and bridges (M9):
  - The view model is a futuristic energy scattergun held to the right and seen from above and behind: the top and side of its shroud recede towards the crosshair (no view into the muzzle). Plating, vents, an energy cell and three coils glow in the theme's light colour; a shot flares them white-hot and a charge sweeps back up the coils through the cooldown. The shot gained an energy zap; a rising charge whine replaced the pump.
  - Bridges between storeys: half the corridors between storeys (into an ordinary room deep enough) arrive at the upper floor and run on into the lower room as a catwalk, ending in a lift down to its floor. Storeys genuinely overlap there, and the room below stays usable under the catwalk. `?map=test06` is a bridge.
- Catwalks and double-height rooms (M8):
  - Map format 1: a sector may carry a `slab` (bottom, top, textures): a horizontal block inside it. Its cells then have two walkable levels: the floor (under the slab, with the slab's underside as ceiling) and the slab's top.
  - `CellGrid` is level-aware: `levels`, `span`, `walkable/floorAt(…, level)`, and `stepTarget` (the level a step lands on: highest reachable floor, so movers walk onto a catwalk rather than drop through it). `reachStates` searches (cell, level) states; reachability and trap checks use it.
  - Sim: the player and enemies carry `level`/`fromLevel`; `MoveGate.tryStep` returns the landing level; enemies path over (cell, level) distance fields; melee needs matching height; shots and projectiles hit slabs; hazards and lifts act on level 0.
  - Render: slab tops (grating), undersides, and exposed edges; the automap outlines catwalks; thumbnails tint them.
  - Generator: the `catwalk` room template (big rooms): three steps down into a pit at -96, a grating catwalk across it at floor level (underside -16, so 80 of headroom below); 30% of pits are lava. `?map=test05` is a catwalk room.
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
  - Enemy sprites: small 3D signed-distance models ray-marched once into a sprite atlas (`SPRITE_BAKE_FS`): 5 shapes × 8 directions × 4 frames (walk, walk, attack, dead), baked per level from its body plans (M11). The app picks the direction from the enemy's facing (at the player once alert, along its step while walking) and the frame from its state. Eyes are marked in the atlas and glow through the wind-up. `/sprites.html` shows the whole sheet.
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
- Doors and keys (M2 slice 4): door state and held keys in `SimState`, auto doors that open when walked into, key doors opened with E/Space while holding the key, key pickups, and events (`door`, `locked`, `key`) for the HUD and later sound. The renderer moves door slabs and hides taken keys with per-frame mover offsets on a static mesh. The HUD shows an E or the missing key just above the crosshair when facing a closed key door. `?map=test02` has both door types.

**Unused but reserved:** `InputFrame.run` (a candidate for a faster step), plus `fire`.

## Known gaps (roughly in priority order)

1. **Back-face culling** is off. Walls are single quads owned by the visible side. Levels are about 1,000 triangles and culling draws about a tenth of them, so this is worth little now.
2. **Sector lookup** (`SectorLocator`) is O(lines). That's fine now (the camera's sector is found once a frame); use the grid or a BSP later.
3. **GPU timing** is not measured: the perf overlay shows CPU time only (timer queries are off by default in Firefox).
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
- **M5 — progression and balance:** ✅ complete (generator v0.9.0). Runs of levels with rising difficulty, enemy budgets by level and graph depth, health and ammo along the way, ammo, level stats, and pause. Beyond the roadmap: the Backlog below.
- **M6 — hazards and storeys:** ✅ complete (generator v0.10.0). Damaging floors, lifts, and two-storey levels.
- **M7 — combat feel:** ✅ complete (generator v0.11.0). A heavy shotgun with automatic melee, infinite ammo, hordes of fragile enemies, spectacular deaths, bosses dropping keys, key sprites, mutant enemies, a lift tile.
- **M8 — catwalks and double-height rooms:** ✅ complete (generator v0.12.0, map format 1). Slabs, level-aware grid, sim and rendering, and catwalk rooms.
- **M9 — weapon redesign and bridges:** ✅ complete (generator v0.13.0). A futuristic energy scattergun seen correctly over the barrel, and catwalks carrying corridors between storeys across lower rooms.
- **M10 — play-test polish:** ✅ complete (generator v0.14.0). Lifts stop after each trip, blast doors, a filled automap, and held keys on the HUD.
- **M12 — level types and verticality:** ✅ complete (generator v0.15.0). Compound, ascent and descent levels paced through a run; 3–5 storeys; one-way drops kept only where they cannot strand the player; atriums; validation over (cell, keys held) states.
- **M13 — play-test polish II:** ✅ complete (generator v0.16.0). An 8-shot magazine with reload, the ammo panel and a top-centre health bar; a heavier, slower tempo; damage direction glows; the left-hand chainsword with invulnerability frames; much more gore (pools, wall and screen splatter); two enemy variants per role with leg types and glowing markings; a heavier shot with tracers and impact debris; the raised-lift clipping fix.
- **M14 — rendering performance:** ✅ complete. The palette post pass now runs at the scene's low resolution (the canvas holds 240 rows and CSS scales it up pixelated; same image, a twentieth of the fill at 1080p), portal culling draws only the sectors the camera can see (about 7% of a level's sectors), visible ranges draw in one call, sprite quads reuse one buffer, and F3 shows a perf overlay (F4 toggles culling).
- **M15 — more weapons:** ✅ complete. The heavy bolter (fast, accurate, explosive bolts) beside the scattergun, weapon switching (1/2, wheel, Q), per-weapon magazines, its own view model, sounds, tracers and bursts, and a per-weapon ammo panel with weapon slots.
- **M16 — enemy behaviour:** ✅ complete (generator v0.17.0). Enemies ride lifts and follow the player between storeys, snipers perch on catwalk tops, and some enemies flank.
- **M17 — run structure:** planned. A title screen, a run summary, score and kills tracked across a run, difficulty options.
- **M11 — procedural enemies:** ✅ complete. Every generated level breeds its own mutants: seeded stat variants per role (core `enemyDefsFor`) and seeded body plans and skins that stand out from the theme (render `enemyLooks`). The exit gets a glowing pad, a light beacon and a hum.

## Doors (decided)

Doors live **in cells**: a door is a one-cell sector whose ceiling drops to its floor, as in Doom. This keeps all geometry on the 128 grid, and the grid treats a door cell as walkable when it is open. There are two types:

| Type | Opens by | Frequency | Used for |
|---|---|---|---|
| Auto | Walking into it (the step waits for it to open) | Most doors | Room-to-room connections, including both sides of the mini boss |
| Key | Pressing use (E/Space) while holding the matching key | Rare | Loot rooms and the level boss |
| Secret | Pressing use (E/Space) on what looks like a wall | 0–2 per level | Optional secret rooms |

A third type, a use door that opened with E but needed no key, was tried in slice 4 and dropped: it added a chore without a decision.

The mission graph therefore places keys to guard optional loot and the boss, rather than scattering locks along the critical path. Doors stay open once opened. When the player faces a closed key door, the HUD shows an E just above the crosshair if they hold the key, and the missing key otherwise. Lifts join storeys: step on and one carries you up or down once, then waits until you step off and back on.

In the map format a door is a one-cell sector with its kind in `Sector.special` (`DoorKind.Auto` or `DoorKind.Key`) and a key door's key id in `tag`; keys are things `KEY_THING_BASE + id`. Doors are stored open and start closed in the sim, so a map's geometry is always the open level.

## Open design questions

- **Step feel.** Now 300 ms (it was 230 ms). Changing it is one constant, but enemy step timers, wind-ups and projectile speeds are tuned with it.
- **Run key:** a faster step, or remove it.
- **Diagonal-facing move feel.** The compass helps; consider whether 8-way is ever wanted. The current answer is no.

## Backlog

Ideas noted during play-testing, not yet scheduled. Each line points at whatever already exists for it.

- **Visible sniper shots.** A sniper's hitscan shot should draw a glowing line from its muzzle to where it lands (the player, or the wall if they broke line of sight), fading out fast, so the player sees where it came from. Render-only: the sim's `attack` event for a hitscan enemy gives the shooter; the app draws the beam (a stretched glowing sprite or a chain of spark sprites along the ray, like the bolter tracers).
- **Even volleys leave a gap at the aim.** A volley fans symmetrically around the aim (`ai.ts` attack: offsets (k − (volley − 1) / 2) × spread), so an even count (twin-bolt grunts, 4- or 6-shot bosses) puts no projectile where the player stands: standing still dodges them. Fix: shift even fans by half a spread so one projectile flies at the aim (alternating sides per volley), or always add a centre shot.
- **More vertical levels.** The ascents and descents play best; make them a little more common than compounds. Today `levelTypeFor` alternates compound, ascent, compound, descent (half flat); e.g. compound, ascent, descent, ascent, compound, descent (a third flat).
- **Grenade launcher, limited ammo.** A left-hand launcher like the chainsword, fired with E; grenades are scarce: one now and then in a loot room, a count on the HUD. Needs: a grenade pickup (thing type) placed by the generator in some loot rooms, a count in `PlayerState`, a lobbed projectile with an arc, a fuse or impact burst with splash (reuse the bolter's blast), a left-hand view model and sounds. Controls (decided): fire it with E, and doors move to Space only (today E and Space both open doors).

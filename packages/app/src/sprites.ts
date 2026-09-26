import { EnemyType } from '@proc-fps/core';
import { LevelRenderer, WebGL2Backend } from '@proc-fps/render';
import { ENEMY_DEFS } from '@proc-fps/sim';

/** Dev view of the baked enemy sprite atlas (sprites.html), for iterating on the models. */
const canvas = document.getElementById('atlas') as HTMLCanvasElement;
const backend = WebGL2Backend.create(canvas);
backend.resize(2048, 320);
const renderer = new LevelRenderer(backend);
const order = [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper, EnemyType.MiniBoss, EnemyType.Boss];
renderer.bakeSprites(order.map((t) => (ENEMY_DEFS[t].radius * 2.6) / ENEMY_DEFS[t].height));
renderer.showSpriteAtlas();

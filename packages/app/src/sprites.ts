import { EnemyType, THEME_NAMES, enemyDefsFor, type ThemeName } from '@proc-fps/core';
import { BASELINE_LOOKS, LevelRenderer, THEME_COLORS, WebGL2Backend, enemyLooks } from '@proc-fps/render';

/**
 * Dev view of the baked enemy sprite atlas (sprites.html), for iterating on the models.
 * `?seed=<s>&theme=<t>` shows the mutants that seed breeds against that theme, with their stats;
 * no seed shows the baseline set.
 */
const params = new URLSearchParams(location.search);
const seed = params.get('seed') ?? undefined;
const themeParam = params.get('theme') ?? 'base';
const theme: ThemeName = (THEME_NAMES as readonly string[]).includes(themeParam) ? (themeParam as ThemeName) : 'base';

const canvas = document.getElementById('atlas') as HTMLCanvasElement;
const backend = WebGL2Backend.create(canvas);
backend.resize(2048, 320);
const renderer = new LevelRenderer(backend);
const order = [EnemyType.Grunt, EnemyType.Brute, EnemyType.Sniper, EnemyType.MiniBoss, EnemyType.Boss];
const defs = enemyDefsFor(seed);
const looks = seed ? enemyLooks(seed, theme) : BASELINE_LOOKS;
renderer.bakeSprites(order.map((t) => (defs[t].radius * 2.6) / defs[t].height), looks);
renderer.showSpriteAtlas();

// Theme swatches, then each role's stats and plan.
const hex = (c: readonly number[]) => '#' + c.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');
const swatch = (c: readonly number[]) => `<span class="sw" style="background:${hex(c)}"></span>`;
const info = document.getElementById('info') as HTMLDivElement;
info.innerHTML =
  `<p>${seed ? `seed <b>${seed}</b>, theme <b>${theme}</b>` : 'baseline (no seed)'} &nbsp; theme colours ${Object.values(THEME_COLORS[theme]).map(swatch).join('')}</p>` +
  '<table><tr><th>role</th><th>skin</th><th>hp</th><th>step</th><th>wind-up</th><th>attack</th><th>plan</th></tr>' +
  order
    .map((t, i) => {
      const d = defs[t];
      const l = looks[i]!;
      const attack = d.attack === 'melee' ? `melee ${d.damage}` : d.attack === 'hitscan' ? `hitscan ${d.damage}` : `${d.volley}× ${d.damage} @ ${d.projectileSpeed.toFixed(1)}`;
      const plan = [
        `${l.eyes} eye${l.eyes > 1 ? 's' : ''}`,
        l.horns ? `${l.horns} horn pair${l.horns > 1 ? 's' : ''}` : '',
        l.spikes ? `${l.spikes} spikes` : '',
        l.extraArms ? 'four arms' : '',
        l.tail ? 'tail' : '',
        ['mottled', 'banded', 'spotted', 'pale belly'][l.pattern],
      ].filter(Boolean).join(', ');
      return `<tr><td>${d.name}</td><td>${swatch(l.skin)}${swatch(l.accent)}</td><td>${d.hp}</td><td>${d.stepTicks}</td><td>${d.windup}</td><td>${attack}</td><td>${plan}</td></tr>`;
    })
    .join('') +
  '</table>';

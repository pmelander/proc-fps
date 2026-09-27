import { EnemyType, THEME_NAMES, defOf, enemyDefsFor, type ThemeName } from '@proc-fps/core';
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
backend.resize(2048, 512);
const renderer = new LevelRenderer(backend);
/** The enemy (type, variant) behind each sprite row. */
const order: [EnemyType, number][] = [
  [EnemyType.Grunt, 0], [EnemyType.Grunt, 1], [EnemyType.Brute, 0], [EnemyType.Brute, 1],
  [EnemyType.Sniper, 0], [EnemyType.Sniper, 1], [EnemyType.MiniBoss, 0], [EnemyType.Boss, 0],
];
const defs = enemyDefsFor(seed);
const looks = seed ? enemyLooks(seed, theme) : BASELINE_LOOKS;
renderer.bakeSprites(order.map(([type, variant]) => { const d = defOf(defs, { type, variant }); return (d.radius * 2.6) / d.height; }), looks);
renderer.showSpriteAtlas();

// Theme swatches, then each role's stats and plan.
const hex = (c: readonly number[]) => '#' + c.map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');
const swatch = (c: readonly number[]) => `<span class="sw" style="background:${hex(c)}"></span>`;
const info = document.getElementById('info') as HTMLDivElement;
info.innerHTML =
  `<p>${seed ? `seed <b>${seed}</b>, theme <b>${theme}</b>` : 'baseline (no seed)'} &nbsp; theme colours ${Object.values(THEME_COLORS[theme]).map(swatch).join('')}</p>` +
  '<table><tr><th>row</th><th>skin</th><th>hp</th><th>step</th><th>wind-up</th><th>attack</th><th>plan</th></tr>' +
  order
    .map(([type, variant], i) => {
      const d = defOf(defs, { type, variant });
      const l = looks[i]!;
      const attack = d.attack === 'melee' ? `melee ${d.damage}` : d.attack === 'hitscan' ? `hitscan ${d.damage}` : `${d.volley}× ${d.damage} @ ${d.projectileSpeed.toFixed(1)}`;
      const plan = [
        `${l.eyes} eye${l.eyes > 1 ? 's' : ''}`,
        l.horns ? `${l.horns} horn pair${l.horns > 1 ? 's' : ''}` : '',
        l.spikes ? `${l.spikes} spikes` : '',
        l.extraArms ? 'four arms' : '',
        l.tail ? 'tail' : '',
        ['biped', 'digitigrade', 'crawler', 'slug'][l.legs],
        ['mottled', 'banded', 'spotted', 'pale belly'][l.pattern],
        l.glow ? 'glowing markings' : '',
      ].filter(Boolean).join(', ');
      return `<tr><td>${d.name}${type === EnemyType.MiniBoss || type === EnemyType.Boss ? '' : ` ${variant + 1}`}</td><td>${swatch(l.skin)}${swatch(l.accent)}${l.glow ? swatch(l.glow) : ''}</td><td>${d.hp}</td><td>${d.stepTicks}</td><td>${d.windup}</td><td>${attack}</td><td>${plan}</td></tr>`;
    })
    .join('') +
  '</table>';

/**
 * Headless generator health check and distribution report. Runs in CI; any invalid map
 * fails the build. The distributions make shifts in level shape visible between versions.
 *   npm run gen:stats -- --seeds 10000
 */
import { GENERATOR_VERSION, generateDetailed, levelStats, validateGenerated, type LayoutFailure, type LevelStats, type RoomTemplate } from '../src/index.js';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const seeds = arg('seeds', 1000);

const failures: { seed: string; errors: string[] }[] = [];
const stats: LevelStats[] = [];
const sectors: number[] = [];
const lines: number[] = [];
const times: number[] = [];
const layoutFailures: Record<LayoutFailure, number> = { placement: 0, route: 0 };
const t0 = performance.now();
for (let i = 0; i < seeds; i++) {
  const seed = `stats-${i}`;
  const t = performance.now();
  let g;
  try {
    g = generateDetailed(seed);
  } catch (e) {
    failures.push({ seed, errors: [`threw: ${(e as Error).message}`] });
    continue;
  }
  times.push(performance.now() - t);
  const errors = validateGenerated(g.map);
  if (errors.length) failures.push({ seed, errors });
  sectors.push(g.map.sectors.length);
  lines.push(g.map.linedefs.length);
  stats.push(levelStats(g));
  for (const k of Object.keys(layoutFailures) as LayoutFailure[]) layoutFailures[k] += g.failures[k];
}
const ms = performance.now() - t0;

const summary = (xs: number[], digits = 0) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => (s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0).toFixed(digits);
  return `min ${q(0)}  p50 ${q(0.5)}  p95 ${q(0.95)}  max ${(s[s.length - 1] ?? 0).toFixed(digits)}`;
};
/** "0:31% 1:40% 2:29%" */
const histogram = (xs: number[]) => {
  const h = new Map<number, number>();
  for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1);
  return [...h].sort((a, b) => a[0] - b[0]).map(([k, n]) => `${k}:${Math.round((100 * n) / xs.length)}%`).join(' ');
};
const col = (label: string, text: string) => console.log(`${label.padEnd(12)}${text}`);

console.log(`generator ${GENERATOR_VERSION}: ${seeds} seeds in ${ms.toFixed(0)} ms (${(ms / seeds).toFixed(2)} ms/map incl. validation)`);
col('gen ms', summary(times, 1));
col('sectors', summary(sectors));
col('linedefs', summary(lines));
col('rooms', summary(stats.map((s) => s.rooms)));
col('size cells', `${summary(stats.map((s) => s.width * s.height))}  (bounding box)`);
col('corridors', `${summary(stats.map((s) => s.corridorCells))}  (cells)`);
col('loops', histogram(stats.map((s) => s.loops)));
col('auto doors', summary(stats.map((s) => s.doors.auto)));
col('key doors', histogram(stats.map((s) => s.doors.key)));
col('loot rooms', histogram(stats.map((s) => s.loot)));
col('secrets', histogram(stats.map((s) => s.secrets)));
const templateTotal: Record<string, number> = {};
for (const s of stats) for (const [t, n] of Object.entries(s.templates)) templateTotal[t] = (templateTotal[t] ?? 0) + n;
const rooms = Object.values(templateTotal).reduce((a, b) => a + b, 0);
col('templates', (Object.entries(templateTotal) as [RoomTemplate, number][]).map(([t, n]) => `${t} ${Math.round((100 * n) / rooms)}%`).join('  '));
col('attempts', `${histogram(stats.map((s) => Math.min(s.attempts, 5)))}  (5 = 5+)`);
col('layout fail', `placement ${layoutFailures.placement}  route ${layoutFailures.route}  (failed attempts, retried)`);
console.log(`failures    ${failures.length} (${((100 * failures.length) / seeds).toFixed(2)}%)`);
for (const f of failures.slice(0, 10)) console.log(`  ${f.seed}: ${f.errors.slice(0, 3).join('; ')}`);
if (failures.length) process.exit(1);

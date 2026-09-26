/**
 * Headless generator health check. Runs in CI; any invalid map fails the build.
 *   npm run gen:stats -- --seeds 10000
 */
import { GENERATOR_VERSION, generate, validateGenerated } from '../src/index.js';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const seeds = arg('seeds', 1000);

const failures: { seed: string; errors: string[] }[] = [];
const sectors: number[] = [];
const lines: number[] = [];
const t0 = performance.now();
for (let i = 0; i < seeds; i++) {
  const seed = `stats-${i}`;
  let map;
  try {
    map = generate(seed);
  } catch (e) {
    failures.push({ seed, errors: [`threw: ${(e as Error).message}`] });
    continue;
  }
  const errors = validateGenerated(map);
  if (errors.length) failures.push({ seed, errors });
  sectors.push(map.sectors.length);
  lines.push(map.linedefs.length);
}
const ms = performance.now() - t0;

const summary = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return `min ${q(0)}  p50 ${q(0.5)}  p95 ${q(0.95)}  max ${s[s.length - 1] ?? 0}`;
};

console.log(`generator ${GENERATOR_VERSION}: ${seeds} seeds in ${ms.toFixed(0)} ms (${(ms / seeds).toFixed(2)} ms/map)`);
console.log(`sectors   ${summary(sectors)}`);
console.log(`linedefs  ${summary(lines)}`);
console.log(`failures  ${failures.length} (${((100 * failures.length) / seeds).toFixed(2)}%)`);
for (const f of failures.slice(0, 10)) console.log(`  ${f.seed}: ${f.errors.slice(0, 3).join('; ')}`);
if (failures.length) process.exit(1);

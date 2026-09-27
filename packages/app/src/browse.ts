import { GENERATOR_VERSION, generateDetailed, isLevelType, levelStats, levelTypeFor, validateGenerated } from '@proc-fps/gen';
import { drawThumbnail } from './thumbnail.js';
import { installFonts } from './ui/skin.js';

void installFonts();

/**
 * Seed browser: thumbnails for a run of seeds (prefix + index), paged. Each card opens its
 * seed in the game. Prefix and page live in the URL so a view can be bookmarked or shared.
 */
const PER_PAGE = 24;
const THUMB = 200;

const params = new URLSearchParams(location.search);
const prefix = params.get('prefix') ?? 'seed-';
const level = Math.max(1, Number(params.get('level') ?? 1) || 1);
const page = Math.max(0, Number(params.get('page') ?? 0) || 0);
/** Level type: as a run would pace this level, unless one is picked. */
const typeParam = params.get('type');
const type = isLevelType(typeParam) ? typeParam : levelTypeFor(level);

const form = document.getElementById('controls') as HTMLFormElement;
const prefixInput = document.getElementById('prefix') as HTMLInputElement;
const levelInput = document.getElementById('level') as HTMLInputElement;
const typeInput = document.getElementById('type') as HTMLSelectElement;
const grid = document.getElementById('grid') as HTMLDivElement;
const status = document.getElementById('status') as HTMLParagraphElement;
const pageLabel = document.getElementById('page') as HTMLSpanElement;
const prev = document.getElementById('prev') as HTMLAnchorElement;
const next = document.getElementById('next') as HTMLAnchorElement;

prefixInput.value = prefix;
levelInput.value = String(level);
typeInput.value = isLevelType(typeParam) ? typeParam : '';
const query = (p: number) => ({ prefix, level: String(level), page: String(p), ...(isLevelType(typeParam) ? { type: typeParam } : {}) });
const link = (p: number) => `?${new URLSearchParams(query(p)).toString()}`;
pageLabel.textContent = `level ${level} ${type} · page ${page + 1} · seeds ${prefix}${page * PER_PAGE}–${prefix}${page * PER_PAGE + PER_PAGE - 1} · gen ${GENERATOR_VERSION}`;
prev.href = link(Math.max(0, page - 1));
prev.toggleAttribute('aria-disabled', page === 0);
next.href = link(page + 1);
form.addEventListener('submit', (e) => {
  e.preventDefault();
  location.search = new URLSearchParams({ prefix: prefixInput.value, level: levelInput.value, page: '0', ...(typeInput.value ? { type: typeInput.value } : {}) }).toString();
});

const seeds = Array.from({ length: PER_PAGE }, (_, i) => `${prefix}${page * PER_PAGE + i}`);
const cards = seeds.map((seed) => {
  const card = document.createElement('a');
  card.className = 'card';
  card.href = `./index.html?${new URLSearchParams({ seed, level: String(level), type }).toString()}`;
  card.innerHTML = `<canvas width="${THUMB}" height="${THUMB}"></canvas><p class="seed"></p><p class="meta">generating…</p>`;
  card.querySelector('.seed')!.textContent = seed;
  grid.append(card);
  return card;
});

// One level per frame keeps the page responsive while the grid fills in.
let invalid = 0;
let i = 0;
const fill = () => {
  const seed = seeds[i]!;
  const card = cards[i]!;
  const meta = card.querySelector('.meta')!;
  try {
    const t = performance.now();
    const g = generateDetailed(seed, { level, type });
    const ms = performance.now() - t;
    const errors = validateGenerated(g.map);
    const s = levelStats(g);
    drawThumbnail(card.querySelector('canvas')!, g.map, THUMB);
    meta.textContent =
      `${s.type} · ${s.storeys} storey${s.storeys === 1 ? '' : 's'}${s.drops ? ` · ${s.drops} drop${s.drops === 1 ? '' : 's'}` : ''}${s.atriums ? ` · ${s.atriums} atrium${s.atriums === 1 ? '' : 's'}` : ''}\n` +
      `${s.rooms} rooms · ${s.enemies} enemies · ${s.health} health\n` +
      `${s.doors.key} key door${s.doors.key === 1 ? '' : 's'} · ${s.secrets} secret${s.secrets === 1 ? '' : 's'}\n` +
      `${s.width}×${s.height} cells · ${s.attempts} ${s.attempts === 1 ? 'try' : 'tries'} · ${ms.toFixed(1)} ms`;
    if (errors.length) {
      invalid++;
      card.classList.add('invalid');
      meta.textContent += `\nINVALID: ${errors[0]}`;
    }
  } catch (e) {
    invalid++;
    card.classList.add('invalid');
    meta.textContent = `FAILED: ${(e as Error).message}`;
  }
  i++;
  status.textContent = i < seeds.length ? `generating ${i}/${seeds.length}…` : `${seeds.length} levels, ${invalid} invalid`;
  if (i < seeds.length) requestAnimationFrame(fill);
};
requestAnimationFrame(fill);

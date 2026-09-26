import { BaseTex, DoorKind, ThingType, doorKindOf, isEnemyThing, keyOfThing, sectorPolygons, secretOf, type MapData, type Sector } from '@proc-fps/core';
import { KEY_COLORS } from './keys.js';

const PAD = 6;
const WALL = '#c8b890';
const STEP_EDGE = 'rgb(200 184 144 / 0.35)';
const SECRET = '#b060ff';

/** Top-down level map for the seed browser: floors shaded by height, doors and keys in their colours, secrets tinted. */
export function drawThumbnail(canvas: HTMLCanvasElement, map: MapData, size: number): void {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const v of map.vertices) {
    x0 = Math.min(x0, v.x);
    y0 = Math.min(y0, v.y);
    x1 = Math.max(x1, v.x);
    y1 = Math.max(y1, v.y);
  }
  const scale = Math.min((size - 2 * PAD) / (x1 - x0), (size - 2 * PAD) / (y1 - y0));
  const ox = (size - (x1 - x0) * scale) / 2;
  const oy = (size - (y1 - y0) * scale) / 2;
  const tx = (x: number) => ox + (x - x0) * scale;
  const ty = (y: number) => size - oy - (y - y0) * scale; // map y points north, screen y down

  sectorPolygons(map).forEach((polys, s) => {
    ctx.fillStyle = sectorColor(map.sectors[s]!);
    ctx.beginPath();
    for (const poly of polys) {
      for (const loop of [poly.outer, ...poly.holes]) {
        loop.forEach((vi, i) => {
          const p = map.vertices[vi]!;
          if (i === 0) ctx.moveTo(tx(p.x), ty(p.y));
          else ctx.lineTo(tx(p.x), ty(p.y));
        });
        ctx.closePath();
      }
    }
    ctx.fill('evenodd');
  });

  for (const ld of map.linedefs) {
    const F = map.sectors[ld.front.sector]!;
    const B = ld.back ? map.sectors[ld.back.sector]! : undefined;
    if (B && F.floor === B.floor) continue;
    const a = map.vertices[ld.v1]!;
    const b = map.vertices[ld.v2]!;
    ctx.strokeStyle = B ? STEP_EDGE : WALL;
    ctx.lineWidth = B ? 1 : 1.25;
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(a.y));
    ctx.lineTo(tx(b.x), ty(b.y));
    ctx.stroke();
  }

  const r = Math.max(2.5, 40 * scale);
  for (const t of map.things) {
    const x = tx(t.x);
    const y = ty(t.y);
    const key = keyOfThing(t.type);
    if (t.type === ThingType.PlayerStart) {
      // Arrow in the start facing (map angle, CCW from east).
      const a = (t.angle * Math.PI) / 180;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * r * 1.4, y - Math.sin(a) * r * 1.4);
      ctx.lineTo(x + Math.cos(a + 2.4) * r, y - Math.sin(a + 2.4) * r);
      ctx.lineTo(x + Math.cos(a - 2.4) * r, y - Math.sin(a - 2.4) * r);
      ctx.fill();
    } else if (t.type === ThingType.Exit) {
      ctx.fillStyle = '#60e070';
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    } else if (isEnemyThing(t.type)) {
      // Bigger dot for the mini boss and boss.
      ctx.fillStyle = '#ff4a3a';
      ctx.beginPath();
      ctx.arc(x, y, t.type >= 40 ? r * 1.4 : r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (t.type === ThingType.Health) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - r * 0.9, y - r * 0.3, r * 1.8, r * 0.6);
      ctx.fillRect(x - r * 0.3, y - r * 0.9, r * 0.6, r * 1.8);
    } else if (key >= 0) {
      ctx.fillStyle = KEY_COLORS[key]!;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.3);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.3);
      ctx.lineTo(x - r, y);
      ctx.fill();
    }
  }
}

function sectorColor(s: Sector): string {
  const door = doorKindOf(s);
  if (door === DoorKind.Auto) return '#9a9a9a';
  if (door === DoorKind.Key) return KEY_COLORS[s.tag] ?? '#ffffff';
  if (door === DoorKind.Secret) return SECRET;
  // Brighter when higher: platforms and stairs pop, pits sink.
  const l = Math.max(18, Math.min(92, 48 + s.floor * 0.7));
  if (secretOf(s) >= 0) return `rgb(${l * 0.8} ${l * 0.45} ${l * 1.1})`;
  if (s.floorTex === BaseTex.Slime) return `rgb(${l * 0.55} ${l * 1.05} ${l * 0.5})`;
  return `rgb(${l} ${l * 0.95} ${l * 0.86})`;
}

import type { MapData } from '@proc-fps/core';
import type { PlayerState } from '@proc-fps/sim';

/** North-up debug automap drawn on a 2D canvas overlay. */
export function drawAutomap(canvas: HTMLCanvasElement, map: MapData, p: PlayerState, scale = 0.5): void {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, w, h);
  const s = scale * dpr;
  const tx = (x: number) => w / 2 + (x - p.x) * s;
  const ty = (y: number) => h / 2 - (y - p.y) * s;

  ctx.lineWidth = Math.max(1, dpr);
  for (const ld of map.linedefs) {
    const a = map.vertices[ld.v1]!;
    const b = map.vertices[ld.v2]!;
    if (!ld.back) ctx.strokeStyle = '#e04838';
    else {
      const F = map.sectors[ld.front.sector]!;
      const B = map.sectors[ld.back.sector]!;
      if (F.floor !== B.floor) ctx.strokeStyle = '#e8b040';
      else if (F.ceil !== B.ceil) ctx.strokeStyle = '#8a7a50';
      else continue;
    }
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(a.y));
    ctx.lineTo(tx(b.x), ty(b.y));
    ctx.stroke();
  }
  for (const t of map.things) {
    ctx.fillStyle = t.type === 2 ? '#60e070' : '#6090ff';
    ctx.fillRect(tx(t.x) - 3 * dpr, ty(t.y) - 3 * dpr, 6 * dpr, 6 * dpr);
  }
  // Player arrow
  const len = 18 * dpr;
  const cx = w / 2;
  const cy = h / 2;
  const c = Math.cos(p.angle);
  const sn = Math.sin(p.angle);
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - c * len * 0.6, cy + sn * len * 0.6);
  ctx.lineTo(cx + c * len, cy - sn * len);
  ctx.lineTo(cx + Math.cos(p.angle + 2.5) * len * 0.5, cy - Math.sin(p.angle + 2.5) * len * 0.5);
  ctx.moveTo(cx + c * len, cy - sn * len);
  ctx.lineTo(cx + Math.cos(p.angle - 2.5) * len * 0.5, cy - Math.sin(p.angle - 2.5) * len * 0.5);
  ctx.stroke();
}

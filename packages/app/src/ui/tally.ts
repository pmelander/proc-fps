/**
 * The end-of-level tally, as in Doom's intermission: each `[data-count]` number counts up from
 * zero in turn, ticking as it goes and landing with a thunk. The HTML already holds the final
 * text, so skipping (any key or click) just stops the count there. Render-only.
 */
const SECONDS_PER_COUNT = 0.7;
const PAUSE = 0.25;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function show(el: HTMLElement, n: number): void {
  const format = el.dataset.format;
  el.textContent = format === 'time' ? clock(n) : format === 'score' ? `${el.textContent?.startsWith('+') ? '+' : ''}${n.toLocaleString('en-US')}` : String(n);
}

/** Counts `root`'s numbers up; returns a function that skips to the end. */
export function tally(root: HTMLElement, sound: (kind: 'tick' | 'done') => void): () => void {
  const items = [...root.querySelectorAll<HTMLElement>('[data-count]')].map((el) => ({ el, to: Number(el.dataset.count) || 0, text: el.textContent ?? '' }));
  let stopped = false;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    for (const i of items) i.el.textContent = i.text;
  };
  for (const i of items) show(i.el, 0);
  let k = 0;
  let startedAt = performance.now() + PAUSE * 1000;
  let lastTick = -1;
  const frame = (now: number) => {
    if (stopped) return;
    const item = items[k];
    if (!item) return finish();
    const t = Math.max(0, Math.min(1, (now - startedAt) / (SECONDS_PER_COUNT * 1000)));
    show(item.el, Math.round(item.to * t));
    const step = Math.floor(t * 12);
    if (t > 0 && t < 1 && step !== lastTick && item.to > 0) {
      lastTick = step;
      sound('tick');
    }
    if (t >= 1) {
      item.el.textContent = item.text;
      sound('done');
      k++;
      startedAt = now + PAUSE * 1000;
      lastTick = -1;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return finish;
}

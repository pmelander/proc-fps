/**
 * A menu the old way: the mouse or the keys (W/S or the arrows to move, Enter, Space or E to
 * choose, A/D or left/right to change a setting, Esc to go back). Items are the container's
 * `[data-item]` elements; the chosen one carries `.sel` (style.css draws the pointer). Only the
 * menu on top listens: opening one suspends the one beneath until it closes.
 */
export interface MenuOptions {
  /** An item was chosen. */
  choose: (item: HTMLElement) => void;
  /** A setting item was turned left (-1) or right (+1). */
  adjust?: (item: HTMLElement, dir: -1 | 1) => void;
  /** Esc: back out. */
  back?: () => void;
  /** Feedback: 'move' when the selection moves, 'choose', 'adjust', 'back'. */
  sound?: (kind: 'move' | 'choose' | 'adjust' | 'back') => void;
  /** Keys that choose, besides Enter (default Space and E). */
  chooseKeys?: readonly string[];
  /** Milliseconds after opening before keys count (so a key held from play does not choose at once). */
  delay?: number;
}

const stack: Menu[] = [];

export class Menu {
  private index = 0;
  private readonly opened = performance.now();
  private readonly onKey = (e: KeyboardEvent) => this.key(e);
  private readonly onMove = (e: Event) => this.hover(e);
  private readonly onClick = (e: Event) => this.click(e);

  constructor(private readonly root: HTMLElement, private readonly opts: MenuOptions) {
    stack.push(this);
    addEventListener('keydown', this.onKey);
    root.addEventListener('mousemove', this.onMove);
    root.addEventListener('click', this.onClick);
    this.select(Math.max(0, this.items().findIndex((i) => i.classList.contains('sel'))), false);
  }

  private items(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>('[data-item]')].filter((i) => !i.hidden && !i.closest('[hidden]'));
  }

  /** Refreshes the selection after the items change. */
  refresh(): void {
    this.select(Math.min(this.index, this.items().length - 1), false);
  }

  select(i: number, sound = true): void {
    const items = this.items();
    if (!items.length) return;
    const next = (i + items.length) % items.length;
    if (sound && next !== this.index) this.opts.sound?.('move');
    this.index = next;
    items.forEach((el, k) => el.classList.toggle('sel', k === next));
  }

  get selected(): HTMLElement | undefined {
    return this.items()[this.index];
  }

  close(): void {
    removeEventListener('keydown', this.onKey);
    this.root.removeEventListener('mousemove', this.onMove);
    this.root.removeEventListener('click', this.onClick);
    stack.splice(stack.indexOf(this), 1);
  }

  private key(e: KeyboardEvent): void {
    if (stack[stack.length - 1] !== this || this.root.closest('[hidden]') || e.repeat) return;
    if (performance.now() - this.opened < (this.opts.delay ?? 0)) return;
    const item = this.selected;
    const choose = ['Enter', 'NumpadEnter', ...(this.opts.chooseKeys ?? ['Space', 'KeyE'])];
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.select(this.index + 1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.select(this.index - 1);
    else if ((e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD') && item && this.opts.adjust && 'adjust' in item.dataset) {
      this.opts.sound?.('adjust');
      this.opts.adjust(item, e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : 1);
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.select(this.index - 1);
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') this.select(this.index + 1); else if (choose.includes(e.code) && item) {
      this.opts.sound?.('choose');
      this.opts.choose(item);
    } else if (e.code === 'Escape' && this.opts.back) {
      this.opts.sound?.('back');
      this.opts.back();
    } else return;
    e.preventDefault();
  }

  private hover(e: Event): void {
    if (stack[stack.length - 1] !== this) return;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
    const i = item ? this.items().indexOf(item) : -1;
    if (i >= 0 && i !== this.index) this.select(i);
  }

  private click(e: Event): void {
    if (stack[stack.length - 1] !== this) return;
    const target = e.target as HTMLElement;
    const arrow = target.closest<HTMLElement>('[data-dir]');
    const item = target.closest<HTMLElement>('[data-item]');
    if (!item) return;
    e.stopPropagation();
    if (arrow && this.opts.adjust) {
      this.opts.sound?.('adjust');
      this.opts.adjust(item, arrow.dataset.dir === '-1' ? -1 : 1);
      return;
    }
    if ('adjust' in item.dataset && this.opts.adjust) {
      this.opts.sound?.('adjust');
      this.opts.adjust(item, 1);
      return;
    }
    this.opts.sound?.('choose');
    this.opts.choose(item);
  }
}

import { DEFAULT_OPTIONS, OPTION_DEFS, adjustOption, saveOptions, type OptionDef, type Options } from '../options.js';
import { Menu, type MenuOptions } from './menu.js';

/**
 * The options panel, shared by the title and pause screens: a menu of settings turned with
 * left/right (or the arrows, or a click), a line on the chosen one, Reset and Back. Every change
 * is saved and handed to `apply` at once, so the game behind the panel shows it straight away.
 */
export function optionValueHtml(def: OptionDef, o: Options): string {
  if (!('min' in def)) return o[def.key] ? 'On' : '<span class="dim">Off</span>';
  const v = o[def.key];
  if (!def.bar) return def.format(v);
  const steps = (def.max - def.min) / def.step;
  const on = (v - def.min) / def.step;
  return `<span class="bar">${Array.from({ length: steps }, (_, i) => `<i${i < on ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

export function optionsPanelHtml(o: Options): string {
  return `<h2 class="heading">Options</h2><div class="stripe"></div>` +
    `<nav class="menu options">${OPTION_DEFS.map((d) =>
      `<button type="button" data-item data-adjust data-option="${d.key}">${d.label} <span class="value"><i data-dir="-1">◀</i> <span class="v">${optionValueHtml(d, o)}</span> <i data-dir="1">▶</i></span></button>`).join('')}` +
    `<button type="button" data-item data-action="reset">Reset to defaults</button>` +
    `<button type="button" data-item data-action="back">Back</button></nav>` +
    `<p class="hint"></p>`;
}

export class OptionsPanel {
  private readonly menu: Menu;
  private readonly observer: MutationObserver;

  constructor(
    private readonly el: HTMLElement,
    private options: Options,
    private readonly apply: (o: Options) => void,
    sound: MenuOptions['sound'],
    private readonly onClose: () => void,
  ) {
    el.innerHTML = optionsPanelHtml(options);
    el.hidden = false;
    const hint = el.querySelector('.hint') as HTMLElement;
    this.menu = new Menu(el, {
      choose: (item) => {
        if (item.dataset.action === 'reset') this.set({ ...DEFAULT_OPTIONS });
        if (item.dataset.action === 'back') this.close();
      },
      adjust: (item, dir) => {
        const key = item.dataset.option as keyof Options | undefined;
        if (key) this.set(adjustOption(this.options, key, dir));
      },
      back: () => this.close(),
      ...(sound ? { sound } : {}),
    });
    const showHint = () => {
      const key = this.menu.selected?.dataset.option;
      const action = this.menu.selected?.dataset.action;
      hint.textContent = OPTION_DEFS.find((d) => d.key === key)?.hint ?? (action === 'reset' ? 'Every option back as it came.' : '');
    };
    this.observer = new MutationObserver(showHint);
    this.observer.observe(el.querySelector('.menu')!, { subtree: true, attributes: true, attributeFilter: ['class'] });
    showHint();
  }

  private set(o: Options): void {
    this.options = o;
    saveOptions(o);
    this.apply(o);
    for (const d of OPTION_DEFS) {
      const v = this.el.querySelector(`[data-option="${d.key}"] .v`);
      if (v) v.innerHTML = optionValueHtml(d, o);
    }
  }

  close(): void {
    this.observer.disconnect();
    this.menu.close();
    this.el.hidden = true;
    this.onClose();
  }
}

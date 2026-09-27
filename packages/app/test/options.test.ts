import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, OPTION_DEFS, adjustOption, loadOptions, sanitize } from '../src/options.js';
import { optionsPanelHtml } from '../src/ui/optionspanel.js';

describe('options', () => {
  it('fall back to the defaults without storage', () => {
    expect(loadOptions()).toEqual(DEFAULT_OPTIONS);
  });

  it('make stored values valid: in range, on a step, the right type', () => {
    expect(sanitize({ sensitivity: 99, fov: 75, music: -3, invert: 'yes', bob: false, junk: 1 })).toEqual({
      ...DEFAULT_OPTIONS,
      sensitivity: 30,
      fov: 76,
      music: 0,
      bob: false,
    });
    expect(sanitize('nonsense')).toEqual(DEFAULT_OPTIONS);
    expect(sanitize({ fov: Number.NaN })).toEqual(DEFAULT_OPTIONS);
  });

  it('turn a step at a time within range, and flip toggles either way', () => {
    let o = { ...DEFAULT_OPTIONS };
    o = adjustOption(o, 'fov', 1);
    expect(o.fov).toBe(76);
    for (let i = 0; i < 40; i++) o = adjustOption(o, 'music', -1);
    expect(o.music).toBe(0);
    expect(adjustOption(o, 'shake', -1).shake).toBe(false);
    expect(adjustOption(o, 'shake', 1).shake).toBe(false);
    expect(DEFAULT_OPTIONS.fov).toBe(74); // untouched
  });

  it('list every option in the panel, with Reset and Back', () => {
    const html = optionsPanelHtml(DEFAULT_OPTIONS);
    for (const d of OPTION_DEFS) expect(html).toContain(`data-option="${d.key}"`);
    expect(html).toContain('data-action="reset"');
    expect(html).toContain('data-action="back"');
    expect(html).toContain('1.0×');
  });
});

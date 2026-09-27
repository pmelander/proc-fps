import { Rng } from '@proc-fps/core';
import { mix, synth, type Voice } from './synth.js';

/**
 * The game's sound set, designed from a seed: every sound has a fixed recipe (so a door always
 * sounds like a door) with seeded variation in pitch and length, so each level sounds a little
 * different but consistent. Wind-ups get their own sounds: they are part of the telegraph.
 */
export type SoundId =
  | 'shot' | 'hit' | 'kill' | 'hurt' | 'death'
  | 'door' | 'locked' | 'key' | 'health' | 'secret' | 'exit' | 'exitHum' | 'step'
  | 'windup' | 'windupMelee' | 'windupHitscan'
  | 'launch' | 'melee' | 'snipe'
  | 'charge' | 'punch' | 'gib'
  | 'reload' | 'reloaded';

type Recipe = Voice[];

const RECIPES: Record<SoundId, Recipe> = {
  // An energy scattergun: a zap, a hard crack, a wide noise blast and a sub-bass thump.
  shot: [
    { wave: 'square', freq: 1800, freqEnd: 140, attack: 0, sustain: 0.01, release: 0.12, volume: 0.3, duty: 0.3 },
    { wave: 'noise', freq: 4000, freqEnd: 900, attack: 0, sustain: 0.01, release: 0.05, volume: 0.6 },
    { wave: 'noise', freq: 1600, freqEnd: 120, attack: 0.002, sustain: 0.05, release: 0.35, volume: 0.75, lowpass: 2600 },
    { wave: 'sine', freq: 95, freqEnd: 32, attack: 0, sustain: 0.04, release: 0.25, volume: 0.9 },
  ],
  // The coils recharging: a rising whine through the cooldown.
  charge: [{ wave: 'sine', freq: 260, freqEnd: 1100, attack: 0.05, sustain: 0.3, release: 0.12, volume: 0.18, vibrato: { depth: 0.03, rate: 24 } }],
  // Reloading: the spent cell ejects with a hiss, a fresh one slides in and charges up.
  reload: [
    { wave: 'noise', freq: 2400, freqEnd: 600, attack: 0, sustain: 0.03, release: 0.12, volume: 0.35 },
    { wave: 'square', freq: 220, freqEnd: 160, attack: 0.25, sustain: 0.03, release: 0.05, volume: 0.25, duty: 0.3 },
    { wave: 'sine', freq: 180, freqEnd: 950, attack: 0.35, sustain: 0.55, release: 0.1, volume: 0.18, vibrato: { depth: 0.02, rate: 20 } },
  ],
  // Locked and ready: a hard double click.
  reloaded: [
    { wave: 'square', freq: 1300, freqEnd: 500, attack: 0, sustain: 0.01, release: 0.04, volume: 0.35, duty: 0.25 },
    { wave: 'noise', freq: 3000, freqEnd: 1200, attack: 0.05, sustain: 0.005, release: 0.04, volume: 0.3 },
  ],
  punch: [
    { wave: 'sine', freq: 140, freqEnd: 45, attack: 0, sustain: 0.02, release: 0.12, volume: 0.8 },
    { wave: 'noise', freq: 900, freqEnd: 200, attack: 0, sustain: 0.01, release: 0.08, volume: 0.4 },
  ],
  gib: [
    { wave: 'noise', freq: 700, freqEnd: 120, attack: 0, sustain: 0.06, release: 0.4, volume: 0.5, lowpass: 1400 },
    { wave: 'saw', freq: 120, freqEnd: 50, attack: 0, sustain: 0.03, release: 0.2, volume: 0.3, lowpass: 700 },
  ],
  hit: [
    { wave: 'square', freq: 160, freqEnd: 60, attack: 0, sustain: 0.02, release: 0.08, volume: 0.4 },
    { wave: 'noise', freq: 900, freqEnd: 300, attack: 0, sustain: 0, release: 0.05, volume: 0.25 },
  ],
  kill: [
    { wave: 'saw', freq: 220, freqEnd: 40, attack: 0.005, sustain: 0.05, release: 0.45, volume: 0.4, vibrato: { depth: 0.08, rate: 18 }, lowpass: 1800 },
    { wave: 'noise', freq: 600, freqEnd: 100, attack: 0, sustain: 0.02, release: 0.3, volume: 0.25 },
  ],
  hurt: [{ wave: 'square', freq: 240, freqEnd: 110, attack: 0, sustain: 0.03, release: 0.15, volume: 0.45, duty: 0.25, vibrato: { depth: 0.1, rate: 30 } }],
  death: [{ wave: 'saw', freq: 300, freqEnd: 30, attack: 0.01, sustain: 0.2, release: 1.2, volume: 0.5, vibrato: { depth: 0.12, rate: 6 }, lowpass: 1200 }],
  door: [
    { wave: 'noise', freq: 180, freqEnd: 90, attack: 0.05, sustain: 0.22, release: 0.15, volume: 0.4, lowpass: 500 },
    { wave: 'sine', freq: 62, freqEnd: 55, attack: 0.05, sustain: 0.22, release: 0.15, volume: 0.25 },
  ],
  locked: [{ wave: 'square', freq: 140, freqEnd: 140, attack: 0, sustain: 0.2, release: 0.05, volume: 0.3, arpeggio: [1, 0.94], arpeggioTime: 0.11 }],
  key: [{ wave: 'square', freq: 660, freqEnd: 660, attack: 0, sustain: 0.24, release: 0.12, volume: 0.28, duty: 0.25, arpeggio: [1, 1.25, 1.5, 2], arpeggioTime: 0.06 }],
  health: [{ wave: 'triangle', freq: 440, freqEnd: 880, attack: 0, sustain: 0.1, release: 0.12, volume: 0.35 }],
  secret: [{ wave: 'sine', freq: 523, freqEnd: 523, attack: 0, sustain: 0.45, release: 0.3, volume: 0.35, arpeggio: [1, 1.26, 1.5, 2, 2.52], arpeggioTime: 0.09 }],
  exit: [{ wave: 'square', freq: 392, freqEnd: 392, attack: 0, sustain: 0.5, release: 0.4, volume: 0.28, duty: 0.4, arpeggio: [1, 1.26, 1.5, 2], arpeggioTime: 0.12 }],
  // The exit pad's low throb, repeated while you are near it: find the way out by ear.
  exitHum: [
    { wave: 'sine', freq: 110, freqEnd: 110, attack: 0.35, sustain: 0.5, release: 0.45, volume: 0.3, vibrato: { depth: 0.012, rate: 5 } },
    { wave: 'triangle', freq: 330, freqEnd: 330, attack: 0.35, sustain: 0.5, release: 0.45, volume: 0.07, vibrato: { depth: 0.01, rate: 7 } },
  ],
  step: [{ wave: 'noise', freq: 400, freqEnd: 200, attack: 0, sustain: 0.005, release: 0.04, volume: 0.1, lowpass: 800 }],
  windup: [{ wave: 'saw', freq: 90, freqEnd: 260, attack: 0.05, sustain: 0.25, release: 0.05, volume: 0.22, lowpass: 1500 }],
  windupMelee: [
    { wave: 'noise', freq: 200, freqEnd: 420, attack: 0.02, sustain: 0.2, release: 0.1, volume: 0.3, lowpass: 900 },
    { wave: 'saw', freq: 70, freqEnd: 95, attack: 0.02, sustain: 0.2, release: 0.1, volume: 0.2, lowpass: 600 },
  ],
  // Lasts about as long as the sniper's charge (60 ticks): hear it, break line of sight.
  windupHitscan: [{ wave: 'sine', freq: 300, freqEnd: 1400, attack: 0.1, sustain: 0.8, release: 0.1, volume: 0.22, vibrato: { depth: 0.02, rate: 12 } }],
  launch: [{ wave: 'noise', freq: 1200, freqEnd: 300, attack: 0.005, sustain: 0.04, release: 0.2, volume: 0.35, lowpass: 3000 }],
  melee: [{ wave: 'noise', freq: 3000, freqEnd: 500, attack: 0, sustain: 0.01, release: 0.1, volume: 0.4 }],
  snipe: [{ wave: 'square', freq: 1600, freqEnd: 200, attack: 0, sustain: 0.02, release: 0.15, volume: 0.35, duty: 0.2 }],
};

/** Every sound, synthesized for a seed. Deterministic: the same seed makes the same samples. */
export function designSounds(seed: string, sampleRate?: number): Record<SoundId, Float32Array<ArrayBuffer>> {
  const rng = new Rng(seed).fork('sound');
  const out = {} as Record<SoundId, Float32Array<ArrayBuffer>>;
  for (const id of Object.keys(RECIPES) as SoundId[]) {
    const pitch = rng.range(0.88, 1.12);
    const length = rng.range(0.9, 1.1);
    out[id] = mix(
      RECIPES[id].map((v, i) =>
        synth(
          {
            ...v,
            freq: v.freq * pitch,
            freqEnd: v.freqEnd * pitch,
            sustain: v.sustain * length,
            release: v.release * length,
            seed: rng.int(1, 0x7fffffff) + i,
          },
          sampleRate,
        ),
      ),
    );
  }
  return out;
}

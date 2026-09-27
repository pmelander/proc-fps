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
  | 'charge' | 'gib'
  | 'reload' | 'reloaded'
  | 'saw' | 'sawHit' | 'shielded'
  | 'bolt' | 'boltBlast' | 'switch'
  | 'roar' | 'slam' | 'windupSlam' | 'summon' | 'bossDeath'
  | 'grenadeFire' | 'explode' | 'grenadePickup';

type Recipe = Voice[];

const RECIPES: Record<SoundId, Recipe> = {
  // An energy scattergun, heavy: a low zap, a hard crack, a long blast of noise, a distorted boom
  // and a deep sub-bass thump that rolls on after it.
  shot: [
    { wave: 'square', freq: 900, freqEnd: 80, attack: 0, sustain: 0.015, release: 0.16, volume: 0.26, duty: 0.35 },
    { wave: 'noise', freq: 3200, freqEnd: 700, attack: 0, sustain: 0.012, release: 0.06, volume: 0.55 },
    { wave: 'noise', freq: 1100, freqEnd: 70, attack: 0.002, sustain: 0.08, release: 0.6, volume: 0.8, lowpass: 1700 },
    { wave: 'saw', freq: 72, freqEnd: 26, attack: 0, sustain: 0.07, release: 0.45, volume: 0.55, lowpass: 380 },
    { wave: 'sine', freq: 60, freqEnd: 22, attack: 0, sustain: 0.09, release: 0.6, volume: 0.9 },
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
  // A heavy bolter round: a crack, a punch, a short blast of noise, a distorted boom and a sub-bass
  // thump, all kept short enough to stack at its rate of fire without turning to mush.
  bolt: [
    { wave: 'noise', freq: 3000, freqEnd: 800, attack: 0, sustain: 0.012, release: 0.05, volume: 0.55 },
    { wave: 'square', freq: 260, freqEnd: 60, attack: 0, sustain: 0.015, release: 0.09, volume: 0.3, duty: 0.35 },
    { wave: 'noise', freq: 900, freqEnd: 90, attack: 0.002, sustain: 0.04, release: 0.25, volume: 0.6, lowpass: 1400 },
    { wave: 'saw', freq: 60, freqEnd: 28, attack: 0, sustain: 0.04, release: 0.22, volume: 0.45, lowpass: 320 },
    { wave: 'sine', freq: 55, freqEnd: 24, attack: 0, sustain: 0.05, release: 0.3, volume: 0.9 },
  ],
  // A bolt bursting where it hit: a deep, rolling thud.
  boltBlast: [
    { wave: 'noise', freq: 1000, freqEnd: 80, attack: 0, sustain: 0.04, release: 0.35, volume: 0.7, lowpass: 1800 },
    { wave: 'saw', freq: 55, freqEnd: 25, attack: 0, sustain: 0.04, release: 0.25, volume: 0.4, lowpass: 300 },
    { wave: 'sine', freq: 60, freqEnd: 22, attack: 0, sustain: 0.05, release: 0.35, volume: 0.7 },
  ],
  // The launcher: a hollow thunk and a pop.
  grenadeFire: [
    { wave: 'sine', freq: 200, freqEnd: 60, attack: 0, sustain: 0.03, release: 0.15, volume: 0.8 },
    { wave: 'noise', freq: 1500, freqEnd: 400, attack: 0, sustain: 0.01, release: 0.1, volume: 0.35, lowpass: 2000 },
  ],
  // A grenade bursting: a long, deep blast with a rolling tail.
  explode: [
    { wave: 'noise', freq: 1200, freqEnd: 50, attack: 0, sustain: 0.08, release: 0.9, volume: 0.9, lowpass: 1600 },
    { wave: 'saw', freq: 55, freqEnd: 22, attack: 0, sustain: 0.1, release: 0.6, volume: 0.5, lowpass: 280 },
    { wave: 'sine', freq: 50, freqEnd: 18, attack: 0, sustain: 0.12, release: 0.9, volume: 1 },
  ],
  // Picking one up: a metallic clink.
  grenadePickup: [{ wave: 'square', freq: 1100, freqEnd: 1100, attack: 0, sustain: 0.05, release: 0.1, volume: 0.25, duty: 0.25, arpeggio: [1, 1.5], arpeggioTime: 0.05 }],
  // A boss moving to its next phase: a long, torn roar.
  roar: [
    { wave: 'saw', freq: 110, freqEnd: 60, attack: 0.08, sustain: 0.7, release: 0.5, volume: 0.45, vibrato: { depth: 0.25, rate: 9 }, lowpass: 900 },
    { wave: 'noise', freq: 800, freqEnd: 250, attack: 0.1, sustain: 0.6, release: 0.5, volume: 0.35, lowpass: 1200 },
    { wave: 'square', freq: 220, freqEnd: 140, attack: 0.1, sustain: 0.5, release: 0.4, volume: 0.12, duty: 0.3, vibrato: { depth: 0.1, rate: 14 } },
  ],
  // A slam landing: a crushing boom with a rumble after.
  slam: [
    { wave: 'noise', freq: 900, freqEnd: 60, attack: 0, sustain: 0.06, release: 0.7, volume: 0.8, lowpass: 1500 },
    { wave: 'sine', freq: 48, freqEnd: 20, attack: 0, sustain: 0.1, release: 0.8, volume: 1 },
    { wave: 'saw', freq: 60, freqEnd: 25, attack: 0, sustain: 0.08, release: 0.5, volume: 0.4, lowpass: 300 },
  ],
  // A slam winding up: a rising grinding rumble, as long as the wind-up.
  windupSlam: [
    { wave: 'saw', freq: 40, freqEnd: 90, attack: 0.1, sustain: 0.6, release: 0.1, volume: 0.35, vibrato: { depth: 0.2, rate: 22 }, lowpass: 500 },
    { wave: 'noise', freq: 300, freqEnd: 900, attack: 0.2, sustain: 0.5, release: 0.1, volume: 0.25, lowpass: 1200 },
  ],
  // A boss calling its pack: a howl.
  summon: [
    { wave: 'sine', freq: 260, freqEnd: 520, attack: 0.1, sustain: 0.4, release: 0.3, volume: 0.25, vibrato: { depth: 0.06, rate: 6 } },
    { wave: 'saw', freq: 130, freqEnd: 180, attack: 0.1, sustain: 0.4, release: 0.3, volume: 0.2, vibrato: { depth: 0.08, rate: 7 }, lowpass: 1400 },
  ],
  // A boss dying: a falling, breaking roar.
  bossDeath: [
    { wave: 'saw', freq: 180, freqEnd: 25, attack: 0.02, sustain: 0.6, release: 1.4, volume: 0.5, vibrato: { depth: 0.3, rate: 7 }, lowpass: 1100 },
    { wave: 'noise', freq: 900, freqEnd: 80, attack: 0.02, sustain: 0.4, release: 1.2, volume: 0.5, lowpass: 1500 },
    { wave: 'sine', freq: 55, freqEnd: 20, attack: 0, sustain: 0.3, release: 1.2, volume: 0.8 },
  ],
  // Swapping guns: a heavy mechanical clunk and a latch.
  switch: [
    { wave: 'noise', freq: 600, freqEnd: 200, attack: 0, sustain: 0.03, release: 0.08, volume: 0.4, lowpass: 1200 },
    { wave: 'square', freq: 180, freqEnd: 120, attack: 0.12, sustain: 0.02, release: 0.05, volume: 0.25, duty: 0.4 },
  ],
  // The chainsword revving up and running: a putting two-stroke engine under a whining chain.
  saw: [
    { wave: 'saw', freq: 70, freqEnd: 120, attack: 0.02, sustain: 0.6, release: 0.18, volume: 0.35, vibrato: { depth: 0.35, rate: 34 }, lowpass: 1400 },
    { wave: 'square', freq: 420, freqEnd: 780, attack: 0.08, sustain: 0.5, release: 0.15, volume: 0.1, duty: 0.2, vibrato: { depth: 0.06, rate: 50 } },
    { wave: 'noise', freq: 1800, freqEnd: 900, attack: 0.05, sustain: 0.55, release: 0.15, volume: 0.18, lowpass: 2600 },
  ],
  // Teeth biting into flesh.
  sawHit: [
    { wave: 'noise', freq: 1200, freqEnd: 400, attack: 0, sustain: 0.05, release: 0.1, volume: 0.45, lowpass: 1800 },
    { wave: 'saw', freq: 160, freqEnd: 90, attack: 0, sustain: 0.05, release: 0.08, volume: 0.3, vibrato: { depth: 0.2, rate: 60 } },
  ],
  // A blow turned away mid-attack: a ringing clang.
  shielded: [
    { wave: 'square', freq: 980, freqEnd: 900, attack: 0, sustain: 0.02, release: 0.25, volume: 0.25, duty: 0.3 },
    { wave: 'triangle', freq: 1960, freqEnd: 1800, attack: 0, sustain: 0.01, release: 0.3, volume: 0.15 },
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

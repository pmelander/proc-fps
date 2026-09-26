import { Rng } from '@proc-fps/core';
import { SAMPLE_RATE, synth, type Voice } from './synth.js';

/**
 * Pattern-based music generator. `composeSong` turns a seed into a short loop (key, mode, tempo,
 * a four-chord progression, and 16-step bass, drum and arpeggio patterns); `Music` plays it on
 * WebAudio in two layers: calm (pad, bass, hats) always, combat (kick, snare, arpeggio) faded in
 * by `setIntensity`.
 */
export interface Song {
  bpm: number;
  /** MIDI note of the key's root, in the bass register. */
  root: number;
  /** Semitone offsets of the mode's seven degrees. */
  scale: number[];
  /** Scale degree of each bar's chord. */
  progression: number[];
  /** Per 16th step: semitones above the chord root, or null for a rest. */
  bass: (number | null)[];
  kick: boolean[];
  snare: boolean[];
  hat: boolean[];
  /** Per 16th step: chord tone index (0–3, 3 = root an octave up), or null. */
  arp: (number | null)[];
}

const MODES = [
  [0, 2, 3, 5, 7, 8, 10], // natural minor
  [0, 1, 3, 5, 7, 8, 10], // phrygian
  [0, 2, 3, 5, 7, 9, 10], // dorian
  [0, 2, 3, 5, 7, 8, 11], // harmonic minor
];
const PROGRESSIONS = [
  [0, 5, 6, 4],
  [0, 3, 4, 0],
  [0, 6, 5, 6],
  [0, 1, 0, 6],
  [0, 5, 3, 4],
];
export const STEPS = 16;

export function composeSong(seed: string): Song {
  const rng = new Rng(seed).fork('music');
  const steps = <T>(f: (i: number) => T) => Array.from({ length: STEPS }, (_, i) => f(i));
  return {
    bpm: rng.int(88, 128),
    root: rng.int(38, 45),
    scale: rng.pick(MODES),
    progression: rng.pick(PROGRESSIONS),
    bass: steps((i) => (i % 8 === 0 ? 0 : rng.chance(0.28) ? rng.pick([0, 7, 12]) : null)),
    kick: steps((i) => i % 8 === 0 || ([6, 10, 14].includes(i) && rng.chance(0.3))),
    snare: steps((i) => i % 8 === 4),
    hat: steps((i) => i % 2 === 0 || rng.chance(0.4)),
    arp: steps(() => (rng.chance(0.6) ? rng.int(0, 3) : null)),
  };
}

/** MIDI notes of the chord built on `degree` (a triad, plus the root an octave up). */
export function chordTones(song: Song, degree: number): number[] {
  const note = (d: number) => song.root + song.scale[d % 7]! + 12 * Math.floor(d / 7);
  return [note(degree), note(degree + 2), note(degree + 4), note(degree) + 12];
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const LOOKAHEAD = 0.12;
const TICK_MS = 25;

export class Music {
  private readonly calm: GainNode;
  private readonly combat: GainNode;
  private readonly cache = new Map<string, AudioBuffer>();
  private timer: number | undefined;
  private step = 0;
  private next = 0;
  private readonly stepSeconds: number;

  constructor(private readonly ctx: AudioContext, out: AudioNode, private readonly song: Song) {
    this.calm = ctx.createGain();
    this.combat = ctx.createGain();
    this.combat.gain.value = 0;
    this.calm.connect(out);
    this.combat.connect(out);
    this.stepSeconds = 60 / song.bpm / 4;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 0 = calm, 1 = full combat layer. */
  setIntensity(x: number): void {
    this.combat.gain.setTargetAtTime(Math.max(0, Math.min(1, x)), this.ctx.currentTime, 0.8);
  }

  private schedule(): void {
    while (this.next < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.next);
      this.next += this.stepSeconds;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const s = this.song;
    const i = step % STEPS;
    const tones = chordTones(s, s.progression[Math.floor(step / STEPS) % s.progression.length]!);
    if (i === 0) for (const n of tones.slice(0, 3)) this.play('pad', n + 12, t, this.calm);
    const bass = s.bass[i];
    if (bass !== null && bass !== undefined) this.play('bass', tones[0]! + bass, t, this.calm);
    if (s.hat[i]) this.play('hat', 0, t, this.calm);
    if (s.kick[i]) this.play('kick', 0, t, this.combat);
    if (s.snare[i]) this.play('snare', 0, t, this.combat);
    const arp = s.arp[i];
    if (arp !== null && arp !== undefined) this.play('arp', tones[arp]! + 24, t, this.combat);
  }

  private play(instrument: string, note: number, t: number, into: AudioNode): void {
    const key = `${instrument}:${note}`;
    let buf = this.cache.get(key);
    if (!buf) {
      const samples = synth(this.voice(instrument, note));
      buf = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buf.copyToChannel(samples, 0);
      this.cache.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(into);
    src.start(t);
  }

  private voice(instrument: string, note: number): Voice {
    const f = midiToHz(note);
    const bar = this.stepSeconds * STEPS;
    switch (instrument) {
      case 'pad': return { wave: 'triangle', freq: f, freqEnd: f, attack: 0.3, sustain: Math.max(0.1, bar - 0.6), release: 0.3, volume: 0.1, lowpass: 900 };
      case 'bass': return { wave: 'saw', freq: f, freqEnd: f, attack: 0.005, sustain: this.stepSeconds, release: 0.16, volume: 0.3, lowpass: 650 };
      case 'arp': return { wave: 'square', freq: f, freqEnd: f, attack: 0.004, sustain: 0.04, release: 0.12, volume: 0.1, duty: 0.25, lowpass: 3000 };
      case 'kick': return { wave: 'sine', freq: 150, freqEnd: 40, attack: 0, sustain: 0.02, release: 0.16, volume: 0.6 };
      case 'snare': return { wave: 'noise', freq: 1800, freqEnd: 900, attack: 0, sustain: 0.01, release: 0.12, volume: 0.28, lowpass: 5000, seed: 7 };
      default: return { wave: 'noise', freq: 9000, freqEnd: 9000, attack: 0, sustain: 0, release: 0.03, volume: 0.08, seed: 3 };
    }
  }
}

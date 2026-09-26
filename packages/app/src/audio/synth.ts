/**
 * A small jsfxr-style synthesizer: one voice in, mono samples out. Pure and deterministic (its
 * noise comes from a seeded generator), so the same parameters always make the same sound and it
 * runs in Node for tests. WebAudio only ever plays the buffers it returns.
 */
export type Wave = 'square' | 'saw' | 'triangle' | 'sine' | 'noise';

export interface Voice {
  wave: Wave;
  /** Start and end frequency in Hz; the pitch slides exponentially between them. */
  freq: number;
  freqEnd: number;
  /** Seconds. */
  attack: number;
  sustain: number;
  release: number;
  /** Peak level, 0–1. */
  volume: number;
  /** Square duty cycle, 0–1. */
  duty?: number;
  /** Vibrato depth (fraction of pitch) and rate (Hz). */
  vibrato?: { depth: number; rate: number };
  /** Frequency multipliers stepped through every `arpeggioTime` seconds (chimes, fanfares). */
  arpeggio?: number[];
  arpeggioTime?: number;
  /** One-pole low-pass cutoff in Hz (omit for none). */
  lowpass?: number;
  /** Seed for the noise wave. */
  seed?: number;
}

export const SAMPLE_RATE = 44100;

export function voiceDuration(v: Voice): number {
  return v.attack + v.sustain + v.release;
}

export function synth(v: Voice, sampleRate = SAMPLE_RATE): Float32Array<ArrayBuffer> {
  const total = voiceDuration(v);
  const n = Math.max(1, Math.round(total * sampleRate));
  const out = new Float32Array(n);
  const duty = v.duty ?? 0.5;
  const ratio = v.freqEnd / v.freq;
  let phase = 0;
  let noiseValue = 0;
  let lastCycle = -1;
  let rng = (v.seed ?? 1) >>> 0 || 1;
  const nextNoise = () => {
    rng ^= rng << 13;
    rng ^= rng >>> 17;
    rng ^= rng << 5;
    return ((rng >>> 0) / 0xffffffff) * 2 - 1;
  };
  const alpha = v.lowpass ? 1 - Math.exp((-2 * Math.PI * v.lowpass) / sampleRate) : 1;
  let filtered = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    let f = v.freq * Math.pow(ratio, t / total);
    if (v.vibrato) f *= 1 + v.vibrato.depth * Math.sin(2 * Math.PI * v.vibrato.rate * t);
    if (v.arpeggio?.length) f *= v.arpeggio[Math.min(v.arpeggio.length - 1, Math.floor(t / (v.arpeggioTime ?? 0.08)))]!;
    phase += f / sampleRate;
    const p = phase - Math.floor(phase);
    let s: number;
    switch (v.wave) {
      case 'square': s = p < duty ? 1 : -1; break;
      case 'saw': s = 2 * p - 1; break;
      case 'triangle': s = 1 - 4 * Math.abs(p - 0.5); break;
      case 'sine': s = Math.sin(2 * Math.PI * p); break;
      case 'noise': {
        // A new random value every half cycle: pitch still shapes the noise's colour.
        const cycle = Math.floor(phase * 2);
        if (cycle !== lastCycle) {
          lastCycle = cycle;
          noiseValue = nextNoise();
        }
        s = noiseValue;
        break;
      }
    }
    const env =
      t < v.attack ? t / Math.max(v.attack, 1e-6) : t < v.attack + v.sustain ? 1 : Math.pow(1 - (t - v.attack - v.sustain) / Math.max(v.release, 1e-6), 2);
    filtered += alpha * (s - filtered);
    out[i] = Math.max(-1, Math.min(1, filtered * env * v.volume));
  }
  return out;
}

/** Sums voices into one buffer (layered sounds, e.g. a shot = noise burst + tone). */
export function mix(parts: readonly Float32Array[]): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) for (let i = 0; i < p.length; i++) out[i] = out[i]! + p[i]!;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]!));
  return out;
}

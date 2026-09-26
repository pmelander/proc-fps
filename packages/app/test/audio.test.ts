import { describe, expect, it } from 'vitest';
import { STEPS, chordTones, composeSong } from '../src/audio/music.js';
import { designSounds } from '../src/audio/sounds.js';
import { synth, voiceDuration, type Voice } from '../src/audio/synth.js';

const tone: Voice = { wave: 'square', freq: 440, freqEnd: 220, attack: 0.01, sustain: 0.05, release: 0.1, volume: 0.5 };

describe('synth', () => {
  it('renders the voice for its full length, within [-1, 1], with no NaNs', () => {
    for (const wave of ['square', 'saw', 'triangle', 'sine', 'noise'] as const) {
      const s = synth({ ...tone, wave, lowpass: 3000, vibrato: { depth: 0.05, rate: 8 } }, 8000);
      expect(s.length).toBe(Math.round(voiceDuration(tone) * 8000));
      expect(s.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
      expect(s.some((v) => Math.abs(v) > 0.1)).toBe(true);
    }
  });

  it('is deterministic, noise included', () => {
    const noise = { ...tone, wave: 'noise' as const, seed: 42 };
    expect(synth(noise, 8000)).toEqual(synth(noise, 8000));
  });
});

describe('sound set', () => {
  it('is the same for a seed and differs between seeds', () => {
    const a = designSounds('level-1', 8000);
    expect(designSounds('level-1', 8000).shot).toEqual(a.shot);
    expect(designSounds('level-2', 8000).shot).not.toEqual(a.shot);
  });

  it('gives the sniper charge about the length of its wind-up (60 ticks = 1 s)', () => {
    const s = designSounds('x', 8000).windupHitscan;
    expect(s.length / 8000).toBeGreaterThan(0.8);
    expect(s.length / 8000).toBeLessThan(1.2);
  });
});

describe('music', () => {
  it('composes a deterministic 16-step loop over four chords', () => {
    const song = composeSong('level-1');
    expect(composeSong('level-1')).toEqual(song);
    for (const track of [song.bass, song.kick, song.snare, song.hat, song.arp]) expect(track).toHaveLength(STEPS);
    expect(song.progression).toHaveLength(4);
    expect(song.kick[0]).toBe(true);
    const tones = chordTones(song, song.progression[1]!);
    expect(tones).toHaveLength(4);
    expect(tones[3]! - tones[0]!).toBe(12);
  });
});

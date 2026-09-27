import { Music, composeSong } from './music.js';
import { designSounds, type SoundId } from './sounds.js';
import { SAMPLE_RATE } from './synth.js';

const SFX_VOLUME = 0.7;
const MUSIC_VOLUME = 0.3;
/** Distance (map units) at which a sound is at half volume. */
const HALF_DISTANCE = 640;

export interface Listener {
  x: number;
  y: number;
  /** Map radians. */
  yaw: number;
}

/**
 * WebAudio front end. Browsers only allow audio after a user gesture, so nothing is created
 * until `unlock()` (called on the click that starts the game). Sounds and music come from the
 * level seed; positional sounds are panned and attenuated relative to the listener.
 */
export class AudioEngine {
  private ctx: AudioContext | undefined;
  private sfx: GainNode | undefined;
  private musicOut: GainNode | undefined;
  private music: Music | undefined;
  private buffers = new Map<SoundId, AudioBuffer>();
  musicOn = true;
  soundOn = true;

  constructor(private readonly seed: string) {}

  /** Starts audio (on a user gesture); `music: false` for sounds only (the title screen's menus). */
  unlock(opts: { music?: boolean } = {}): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = SFX_VOLUME;
    this.sfx.connect(master);
    this.musicOut = ctx.createGain();
    this.musicOut.gain.value = this.musicOn ? MUSIC_VOLUME : 0;
    this.musicOut.connect(master);
    for (const [id, samples] of Object.entries(designSounds(this.seed, SAMPLE_RATE)) as [SoundId, Float32Array<ArrayBuffer>][]) {
      const buf = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buf.copyToChannel(samples, 0);
      this.buffers.set(id, buf);
    }
    if (opts.music === false) return;
    this.music = new Music(ctx, this.musicOut, composeSong(this.seed));
    this.music.start();
  }

  /** Plays a sound; with a position it is panned and quieter with distance from the listener. */
  play(id: SoundId, at?: { x: number; y: number }, listener?: Listener, rate = 1): void {
    const ctx = this.ctx;
    const buf = this.buffers.get(id);
    if (!ctx || !buf || !this.sfx || !this.soundOn) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    let node: AudioNode = src;
    if (at && listener) {
      const dx = at.x - listener.x;
      const dy = at.y - listener.y;
      const gain = ctx.createGain();
      gain.gain.value = 1 / (1 + Math.sqrt(dx * dx + dy * dy) / HALF_DISTANCE);
      const pan = ctx.createStereoPanner();
      // Left of the view direction pans left.
      pan.pan.value = dx === 0 && dy === 0 ? 0 : -Math.sin(Math.atan2(dy, dx) - listener.yaw) * 0.8;
      node.connect(gain);
      gain.connect(pan);
      node = pan;
    }
    node.connect(this.sfx);
    src.start();
  }

  setIntensity(x: number): void {
    this.music?.setIntensity(x);
  }

  toggleMusic(): void {
    this.musicOn = !this.musicOn;
    if (this.musicOut && this.ctx) this.musicOut.gain.setTargetAtTime(this.musicOn ? MUSIC_VOLUME : 0, this.ctx.currentTime, 0.1);
  }

  toggleSound(): void {
    this.soundOn = !this.soundOn;
  }
}

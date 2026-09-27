import { EMPTY_INPUT, type InputFrame } from '@proc-fps/sim';

const MOUSE_SENSITIVITY = 0.0019; // rad per pixel
const KEY_TURN = 0.035; // rad per tick
/**
 * Heavy armour turns at most this fast (rad per tick: about 275°/s and 170°/s). A faster flick
 * is not lost, only spread over the next ticks, so the aim still lands where the mouse went.
 */
const MAX_TURN = 0.08;
const MAX_LOOK = 0.05;

/** DOM → InputFrame. The only place that knows about keyboards and mice. */
export class InputSampler {
  private readonly keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  /** Look the mouse asked for that the turn cap has not applied yet (radians). */
  private pendingTurn = 0;
  private pendingLook = 0;
  private fire = false;
  private melee = false;

  constructor(private readonly element: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (this.locked) this.keys.add(e.code);
      if (e.code === 'Tab' || e.code === 'F2' || e.code === 'F8') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.fire = true;
      if (this.locked && e.button === 2) this.melee = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.melee = false;
    });
    // The right button swings the chainsword: no context menu while playing.
    addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /** Consumes accumulated mouse motion; call once per sim tick. */
  sample(): InputFrame {
    if (!this.locked) {
      this.pendingTurn = this.pendingLook = 0;
      return { ...EMPTY_INPUT };
    }
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const frame: InputFrame = {
      move: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'),
      strafe: k('KeyD') - k('KeyA'),
      turn: 0,
      look: 0,
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      fire: this.fire,
      use: this.keys.has('KeyE') || this.keys.has('Space'),
      reload: this.keys.has('KeyR'),
      melee: this.melee || this.keys.has('KeyV'),
    };
    this.pendingTurn += -this.mouseDX * MOUSE_SENSITIVITY + (k('ArrowLeft') - k('ArrowRight')) * KEY_TURN;
    this.pendingLook += -this.mouseDY * MOUSE_SENSITIVITY;
    frame.turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, this.pendingTurn));
    frame.look = Math.max(-MAX_LOOK, Math.min(MAX_LOOK, this.pendingLook));
    this.pendingTurn -= frame.turn;
    this.pendingLook -= frame.look;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return frame;
  }
}

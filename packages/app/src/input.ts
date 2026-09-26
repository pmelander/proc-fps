import { EMPTY_INPUT, type InputFrame } from '@proc-fps/sim';

const MOUSE_SENSITIVITY = 0.0025; // rad per pixel
const KEY_TURN = 0.045; // rad per tick

/** DOM → InputFrame. The only place that knows about keyboards and mice. */
export class InputSampler {
  private readonly keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private fire = false;

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
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /** Consumes accumulated mouse motion; call once per sim tick. */
  sample(): InputFrame {
    if (!this.locked) return { ...EMPTY_INPUT };
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    const frame: InputFrame = {
      move: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'),
      strafe: k('KeyD') - k('KeyA'),
      turn: -this.mouseDX * MOUSE_SENSITIVITY + (k('ArrowLeft') - k('ArrowRight')) * KEY_TURN,
      look: -this.mouseDY * MOUSE_SENSITIVITY,
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      fire: this.fire,
      use: this.keys.has('KeyE') || this.keys.has('Space'),
    };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return frame;
  }
}

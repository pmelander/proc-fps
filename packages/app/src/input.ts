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
  /** The right button: the grenade. */
  private throwing = false;
  /** A weapon asked for since the last tick: a slot (1, 2, …), a step of the wheel, or Q for the last one. */
  private wantSlot = -1;
  private wantStep = 0;
  private wantLast = false;
  private lastWeapon = 0;
  private heldWeapon = 0;
  /** Mouse sensitivity as a multiple of the tuned default, and mouse up looking down (options.ts). */
  sensitivity = 1;
  invertLook = false;

  constructor(private readonly element: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (this.locked) this.keys.add(e.code);
      if (this.locked && /^Digit[1-9]$/.test(e.code)) this.wantSlot = Number(e.code.slice(5)) - 1;
      if (this.locked && e.code === 'KeyQ') this.wantLast = true;
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
      if (this.locked && e.button === 2) this.throwing = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.throwing = false;
    });
    addEventListener('wheel', (e) => {
      if (this.locked && e.deltaY !== 0) this.wantStep += e.deltaY > 0 ? 1 : -1;
    });
    // The right button lobs a grenade: no context menu while playing.
    addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /**
   * Consumes accumulated mouse motion and weapon requests; call once per sim tick. `weapon` is the
   * gun in hand and `weapons` how many there are: a request resolves to a weapon index here, so the
   * recorded input (and the replay) holds the choice itself.
   */
  sample(weapon = 0, weapons = 1): InputFrame {
    if (weapon !== this.heldWeapon) {
      this.lastWeapon = this.heldWeapon;
      this.heldWeapon = weapon;
    }
    if (!this.locked) {
      this.pendingTurn = this.pendingLook = 0;
      this.wantSlot = -1;
      this.wantStep = 0;
      this.wantLast = false;
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
      // E (or Space) opens key doors and secret walls; the right button lobs a grenade.
      use: this.keys.has('KeyE') || this.keys.has('Space'),
      grenade: this.throwing,
      reload: this.keys.has('KeyR'),
      // The chainsword has no key of its own: firing with an enemy in reach swings it (sim).
      melee: false,
      weapon: this.wantSlot >= 0 && this.wantSlot < weapons ? this.wantSlot
        : this.wantStep !== 0 ? (((weapon + this.wantStep) % weapons) + weapons) % weapons
        : this.wantLast ? this.lastWeapon
        : -1,
    };
    this.wantSlot = -1;
    this.wantStep = 0;
    this.wantLast = false;
    this.pendingTurn += -this.mouseDX * MOUSE_SENSITIVITY * this.sensitivity + (k('ArrowLeft') - k('ArrowRight')) * KEY_TURN;
    this.pendingLook += (this.invertLook ? 1 : -1) * this.mouseDY * MOUSE_SENSITIVITY * this.sensitivity;
    frame.turn = Math.max(-MAX_TURN, Math.min(MAX_TURN, this.pendingTurn));
    frame.look = Math.max(-MAX_LOOK, Math.min(MAX_LOOK, this.pendingLook));
    this.pendingTurn -= frame.turn;
    this.pendingLook -= frame.look;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return frame;
  }
}
